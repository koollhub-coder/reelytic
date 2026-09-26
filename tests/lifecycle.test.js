const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs } = require('./helpers/client');
const { getDb } = require('../server/db');
const { needsWiderFetch, PROFILE_MIN_RELIABLE_SAMPLE } = require('../server/services/apify.service');

/*
  needsWiderFetch is a pure function -- exported unwrapped by the scraper
  stub seam (see the "Pure helpers: no network, nothing to stub" note in
  apify.service.js), so it's the real implementation here regardless of
  REELYTIC_SCRAPER_STUB. The network retry it gates on can only really be
  proven against the real actor (the paid canary); this is where the
  DECISION itself gets covered for free.
*/
describe('needsWiderFetch (the profile widen-retry decision)', () => {
  test('retries when the sample is thin and Apify gave everything asked for', () => {
    assert.equal(needsWiderFetch(2, 8, 8), true);
  });

  test('does not retry when the sample already meets the reliable minimum', () => {
    assert.equal(needsWiderFetch(PROFILE_MIN_RELIABLE_SAMPLE, 8, 8), false);
  });

  test('does not retry when the account itself had fewer than requested -- more depth cannot help', () => {
    assert.equal(needsWiderFetch(2, 5, 8), false);
  });
});

/*
  The job lifecycle, run end to end against the stubbed scraper.

  These are the paths that cost money to reach with the real Apify actors,
  which is precisely why they were never routinely tested and why several
  bugs have lived in them: reports where every link is invalid, partial
  failures, retries, and the credit accounting that rides along with each.

  Everything here goes through the real engine, the real routes and the real
  database. Only the network call at the very edge is substituted.
*/

let agent;
let jobCounter = 0;

// Creates a report in the state the upload step would leave it: rows parsed,
// nothing processed yet, waiting to be started.
async function createPendingJob({ type = 'reel', urls, owner = 'pro' }) {
  jobCounter += 1;
  const id = `rgr_job_lc_${jobCounter}`;
  const rows = urls.map((url, i) => ({ i, input: { url }, state: 'pending', result: null }));

  await getDb().collection('jobs').insertOne({
    _id: id,
    ownerUsername: usernameFor(owner),
    type,
    status: 'preview',
    fileName: 'lifecycle-fixture.txt',
    cursor: 0,
    counts: { total: rows.length, success: 0, failed: 0, invalid: 0, creditsSpent: 0 },
    rows,
    createdAt: new Date(),
  });
  return id;
}

// The engine runs asynchronously after /start returns, so tests wait for a
// terminal state rather than sleeping a fixed amount and hoping.
async function waitForStatus(jobId, wanted = ['done', 'paused', 'failed'], timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getDb().collection('jobs').findOne({ _id: jobId });
    if (job && wanted.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  const job = await getDb().collection('jobs').findOne({ _id: jobId });
  throw new Error(`Report ${jobId} never reached ${wanted.join('/')}, stuck at "${job && job.status}"`);
}

before(async () => {
  await seed();
  await startServer();
  agent = await loginAs('pro');
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('a normal reel run', () => {
  test('processes every link and marks the report done', async () => {
    const id = await createPendingJob({ urls: [
      'https://www.instagram.com/reel/OK1/',
      'https://www.instagram.com/reel/OK2/',
      'https://www.instagram.com/reel/OK3/',
    ] });

    const started = await agent.post(`/jobs/${id}/start`, {});
    assert.ok(started.ok, `start should be accepted, got ${started.status} ${JSON.stringify(started.data)}`);

    const job = await waitForStatus(id);
    assert.equal(job.status, 'done');
    assert.equal(job.counts.success, 3, 'all three links should have succeeded');
    assert.equal(job.counts.failed, 0);
    assert.ok(job.rows.every((r) => r.state === 'done' && r.result), 'every row should carry a result');
  });

  test('charges credits for successful items and records the balance either side', async () => {
    const before = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    const id = await createPendingJob({ urls: [
      'https://www.instagram.com/reel/OK10/',
      'https://www.instagram.com/reel/OK11/',
    ] });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);

    const after = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    assert.equal(job.counts.success, 2);
    assert.equal(before - after, job.counts.creditsSpent, 'the balance must fall by exactly what the run counted');
    /*
      The reconciliation the credit audit performs, asserted here so the
      concurrency bug that silently lost charges cannot come back: opening
      balance minus credits used has to equal the closing balance.
    */
    assert.equal(
      job.creditsBefore - job.counts.creditsSpent, job.creditsAfter,
      `run does not reconcile: ${job.creditsBefore} - ${job.counts.creditsSpent} != ${job.creditsAfter}`
    );
  });
});

describe('a report where every link fails', () => {
  test('finishes as done with zero successes rather than hanging', async () => {
    const id = await createPendingJob({ urls: [
      'https://www.instagram.com/reel/FAIL1/',
      'https://www.instagram.com/reel/FAIL2/',
    ] });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);

    assert.equal(job.status, 'done', 'a total failure is still a finished report, not a stuck one');
    assert.equal(job.counts.success, 0);
    assert.ok(job.counts.failed > 0, 'the failures should be counted');
  });

  test('charges nothing when nothing succeeded', async () => {
    const before = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;
    const id = await createPendingJob({ urls: ['https://www.instagram.com/reel/FAIL9/'] });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);
    const after = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    assert.equal(job.counts.creditsSpent, 0, 'a failed item is free');
    assert.equal(before, after, 'the balance must not move when nothing succeeded');
  });
});

describe('a partially failing report', () => {
  test('counts successes and failures separately and still completes', async () => {
    const id = await createPendingJob({ urls: [
      'https://www.instagram.com/reel/OK20/',
      'https://www.instagram.com/reel/FAIL20/',
      'https://www.instagram.com/reel/OK21/',
    ] });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);

    assert.equal(job.status, 'done');
    assert.equal(job.counts.success, 2);
    assert.equal(job.counts.failed, 1);
    assert.equal(job.counts.creditsSpent, 2, 'only the two successes are chargeable');
  });

  test('retry-failed re-runs only the failed rows', async () => {
    const id = await createPendingJob({ urls: [
      'https://www.instagram.com/reel/OK30/',
      'https://www.instagram.com/reel/FAIL30/',
    ] });
    await agent.post(`/jobs/${id}/start`, {});
    await waitForStatus(id);

    const res = await agent.post(`/jobs/${id}/retry-failed`, {});
    assert.ok(res.ok, `retry should be accepted, got ${res.status}`);

    const job = await waitForStatus(id);
    // The stub fails that URL deterministically, so the retry legitimately
    // fails again. What matters is that the successful row was left alone
    // and not re-scraped (which would double-charge the client).
    assert.equal(job.counts.success, 1, 'the already-successful row must survive a retry');
  });
});

describe('a profile run', () => {
  test('produces one averaged row per creator', async () => {
    const id = await createPendingJob({
      type: 'profile',
      urls: ['https://www.instagram.com/creator_ok/', 'https://www.instagram.com/second_ok/'],
    });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);

    assert.equal(job.status, 'done');
    assert.equal(job.counts.success, 2);
    // Asserts the rows produced metrics, not that a particular field name
    // exists: the averaged profile result is a metrics object and the creator
    // handle is carried on the row, not necessarily inside it.
    assert.ok(job.rows.every((r) => r.state === 'done' && r.result), 'each creator row should resolve to a result');
    assert.ok(job.counts.creditsSpent > 0, 'a successful profile run is chargeable');
  });

  /*
    Regression for a real bug found 2026-08-14: an account whose every
    fetched candidate got excluded (collab, sponsored, pinned, missing
    views) still went through metricsFn on an empty sample, which reported
    a fabricated 0 avg views / 0% engagement as a normal success -- and
    charged for it. 8 of one real client's rows were exactly this before
    the fix. It must fail, visibly, and cost nothing.
  */
  test('a creator whose every fetched post is excluded fails instead of reporting a fake 0%', async () => {
    const before = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    const id = await createPendingJob({
      type: 'profile',
      urls: ['https://www.instagram.com/creator_ALLCOLLAB/'],
    });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);
    const after = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    assert.equal(job.status, 'done');
    assert.equal(job.counts.success, 0, 'must not count as a success');
    assert.equal(job.counts.failed, 1, 'must be counted as failed, not silently dropped');
    assert.equal(job.rows[0].state, 'failed');
    assert.ok(job.rows[0].error, 'the row must say why, not just fail silently');
    assert.equal(before, after, 'an excluded-to-empty profile must not be charged');
  });

  /*
    The other half of the same finding: thin but NOT zero. This must still
    succeed and charge normally -- a creator with genuinely few eligible
    posts is real information -- but the row must carry lowSample so the
    client sees this number for what it is instead of trusting it exactly
    as much as an 8-post average.
  */
  test('a creator with too few eligible posts still succeeds, but is flagged as a low sample', async () => {
    const before = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    const id = await createPendingJob({
      type: 'profile',
      urls: ['https://www.instagram.com/creator_THIN/'],
    });
    await agent.post(`/jobs/${id}/start`, {});
    const job = await waitForStatus(id);
    const after = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    assert.equal(job.status, 'done');
    assert.equal(job.counts.success, 1, 'a thin-but-nonzero sample is still a real result');
    assert.equal(job.rows[0].state, 'done');
    assert.equal(job.rows[0].result.reelsAnalyzed, 2);
    assert.equal(job.rows[0].result.lowSample, true, 'must be flagged so it does not read as a full-confidence average');
    assert.notEqual(before, after, 'a low-sample result is still a real result and still chargeable');
  });
});

describe('discard', () => {
  test('clears the active report without deleting its history', async () => {
    const id = await createPendingJob({ urls: ['https://www.instagram.com/reel/OK40/'] });
    await agent.post(`/jobs/${id}/start`, {});
    await waitForStatus(id);

    const res = await agent.post(`/jobs/${id}/discard`, {});
    assert.ok(res.ok, `discard should succeed, got ${res.status}`);

    // Discard is about clearing the CURRENT run. The report itself must
    // survive, because History and the client's audit trail depend on it.
    const job = await getDb().collection('jobs').findOne({ _id: id });
    assert.ok(job, 'discarding must not delete the report');
  });
});

describe('exports', () => {
  test('xlsx and csv both download for a finished report', async () => {
    const id = await createPendingJob({ urls: [
      'https://www.instagram.com/reel/OK50/',
      'https://www.instagram.com/reel/OK51/',
    ] });
    await agent.post(`/jobs/${id}/start`, {});
    await waitForStatus(id);

    for (const ext of ['xlsx', 'csv']) {
      const res = await agent.get(`/export/${id}.${ext}`);
      assert.ok(res.status === 200, `${ext} export should return 200, got ${res.status}`);
    }
  });
});

/*
  Editing a sheet after upload: replace it with a corrected file or add more
  links, then carry on from where the report was. The rules that matter are
  about money: finished links keep their results and are never charged again,
  only links that have not run yet can cost anything, and editing itself
  never moves the balance.

  URLs are written in normalized form (no trailing slash) because that is
  what a real upload stores, and rows are matched on exactly that.
*/
const reelUrl = (code) => `https://www.instagram.com/reel/${code}`;
const balanceOf = async () => (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

async function runToDone(urls) {
  const id = await createPendingJob({ urls });
  const started = await agent.post(`/jobs/${id}/start`, {});
  assert.ok(started.ok, `start should be accepted, got ${started.status}`);
  await waitForStatus(id, ['done']);
  return id;
}

describe('editing a sheet after upload', () => {
  test('a dry run says what would change and changes nothing', async () => {
    const id = await runToDone([reelUrl('OK300'), reelUrl('OK301')]);
    const before = await getDb().collection('jobs').findOne({ _id: id });

    const res = await agent.post(`/jobs/${id}/sheet`, { links: `${reelUrl('OK300')}\n${reelUrl('OK302')}`, mode: 'replace', dryRun: true });
    assert.ok(res.ok, JSON.stringify(res.data));
    assert.equal(res.data.summary.kept, 1, 'the finished link that is still in the sheet is kept');
    assert.equal(res.data.summary.added, 1, 'the new link would be added');
    assert.equal(res.data.summary.removed, 1, 'the link that is no longer in the sheet would be removed');

    const after = await getDb().collection('jobs').findOne({ _id: id });
    assert.deepEqual(after.rows.map((r) => r.input.url), before.rows.map((r) => r.input.url), 'a dry run must not touch the report');
    assert.equal(after.status, 'done');
  });

  test('adding links to a finished report reopens it and charges only for the new ones', async () => {
    const id = await runToDone([reelUrl('OK310'), reelUrl('OK311')]);
    const beforeEdit = await balanceOf();

    const edit = await agent.post(`/jobs/${id}/sheet`, { links: `${reelUrl('OK310')}\n${reelUrl('OK312')}\n${reelUrl('OK313')}`, mode: 'add' });
    assert.ok(edit.ok, JSON.stringify(edit.data));
    assert.equal(edit.data.summary.added, 2);
    assert.equal(edit.data.summary.alreadyInReport, 1, 'a link that is already in the report is not added twice');
    assert.equal(await balanceOf(), beforeEdit, 'editing the sheet must not spend anything');

    const paused = await getDb().collection('jobs').findOne({ _id: id });
    assert.equal(paused.status, 'paused', 'left paused, never started for the user');
    // Index 2 is the repeat of OK310 (shown as a duplicate, never run), so the
    // first link that actually still has to run sits at index 3.
    assert.equal(paused.cursor, 3, 'resumes at the first link that has not run');
    assert.equal(paused.counts.success, 2, 'the two finished links are still counted');

    const resumed = await agent.post(`/jobs/${id}/resume`, {});
    assert.ok(resumed.ok, JSON.stringify(resumed.data));
    const job = await waitForStatus(id, ['done']);

    assert.equal(job.counts.success, 4, 'all four links should now have results');
    assert.equal(beforeEdit - (await balanceOf()), 2, 'only the two new links may cost a credit each');
    assert.ok(job.rows.every((r) => r.state === 'done' || r.state === 'duplicate'), 'nothing left waiting');
  });

  test('replacing the sheet keeps finished results, retries failures, and drops what is gone', async () => {
    const id = await runToDone([reelUrl('OK320'), reelUrl('OK321'), reelUrl('FAIL322')]);
    const beforeEdit = await balanceOf();

    const edit = await agent.post(`/jobs/${id}/sheet`, { links: `${reelUrl('OK320')}\n${reelUrl('OK323')}\n${reelUrl('FAIL322')}`, mode: 'replace' });
    assert.ok(edit.ok, JSON.stringify(edit.data));
    assert.equal(edit.data.summary.kept, 1);
    assert.equal(edit.data.summary.added, 1);
    assert.equal(edit.data.summary.retry, 1, 'the link that failed before gets another try');
    assert.equal(edit.data.summary.removed, 1);
    assert.equal(edit.data.summary.removedWithResults, 1);

    await agent.post(`/jobs/${id}/resume`, {});
    const job = await waitForStatus(id, ['done']);
    const urls = job.rows.map((r) => r.input.url);
    assert.ok(!urls.includes(reelUrl('OK321')), 'the removed link is gone from the report');
    assert.equal(job.counts.success, 2, 'OK320 kept plus OK323 newly run');
    assert.equal(beforeEdit - (await balanceOf()), 1, 'only OK323 is a new success; OK320 is not charged twice');
  });

  test('a report cannot be edited while it is running', async () => {
    const id = await createPendingJob({ urls: [reelUrl('OK330')] });
    await getDb().collection('jobs').updateOne({ _id: id }, { $set: { status: 'running' } });
    const res = await agent.post(`/jobs/${id}/sheet`, { links: reelUrl('OK331'), mode: 'add' });
    assert.equal(res.status, 409);
    assert.equal(res.data.code, 'JOB_RUNNING');
  });

  test("someone else's report cannot be edited", async () => {
    const id = await createPendingJob({ urls: [reelUrl('OK340')], owner: 'starter' });
    const res = await agent.post(`/jobs/${id}/sheet`, { links: reelUrl('OK341'), mode: 'add' });
    assert.equal(res.status, 403);
  });

  test('editing a report that has not started replaces it in place, still a preview', async () => {
    const id = await createPendingJob({ urls: [reelUrl('OK350'), reelUrl('OK351')] });
    const res = await agent.post(`/jobs/${id}/sheet`, { links: `${reelUrl('OK352')}\nhttps://example.com/not-instagram`, mode: 'replace' });
    assert.ok(res.ok, JSON.stringify(res.data));
    const job = await getDb().collection('jobs').findOne({ _id: id });
    assert.equal(job.status, 'preview');
    assert.equal(job.cursor, 0);
    assert.equal(job.counts.total, 2);
    assert.equal(job.counts.valid, 1);
    assert.equal(job.counts.invalid, 1);
  });
});

/*
  Sponsored (paid partnership) and collab posts used to be thrown out of a
  profile's average. Clients asked for every Reel to count, so only pinned and
  non-Reel posts are set aside now. Pure functions, no network.
*/
describe('profile post selection', () => {
  const { selectProfileReels, selectProfileReelsV2 } = require('../server/services/apify.service');
  const day = (n) => `2026-08-0${n}T00:00:00Z`;

  test('legacy pipeline: sponsored and collab posts are included, pinned is not', () => {
    const mk = (n, extra = {}) => ({ videoPlayCount: 1000 + n, timestamp: day(n), ...extra });
    const { candidates } = selectProfileReels([
      mk(1), mk(2, { paidPartnership: true }), mk(3, { coauthorProducers: [{ id: 1 }] }), mk(4, { isPinned: true }), mk(5),
    ]);
    const reasons = candidates.map((c) => c.reason);
    assert.ok(!reasons.includes('sponsored') && !reasons.includes('collab'), `nothing should be excluded as sponsored/collab, got ${reasons}`);
    assert.equal(reasons.filter((r) => r === 'included').length, 4);
    assert.equal(reasons.filter((r) => r === 'pinned').length, 1);
  });

  test('Express pipeline: sponsored and collab posts are included, pinned is not', () => {
    const mk = (n, extra = {}) => ({ views: 1000 + n, videoPlayCount: 1000 + n, playCount: 1000 + n, timestamp: day(n), ...extra });
    const { candidates } = selectProfileReelsV2([
      mk(1), mk(2, { isSponsored: true }), mk(3, { isCollab: true }), mk(4, { isPinned: true }), mk(5), mk(6),
    ]);
    const reasons = candidates.map((c) => c.reason);
    assert.ok(!reasons.includes('sponsored') && !reasons.includes('collab'));
    assert.equal(reasons.filter((r) => r === 'pinned').length, 1);
  });
});

/*
  The profile actor renamed `owner` to `user` in Sep 2026. Only `owner` was
  read, so every post lost its username and every profile failed with "no
  data". Both output shapes must normalize to the same thing.
*/
describe('profile actor output shapes', () => {
  const { normalizeProfileReelItemV2 } = require('../server/services/apify.service');
  const base = { play_count: 5000, like_count: 100, comment_count: 4, shortcode: 'abc', taken_at: '2026-08-01T00:00:00Z' };

  test('new shape (user / follower_count) resolves the username and followers', () => {
    const n = normalizeProfileReelItemV2({ ...base, user: { username: 'someone', full_name: 'Some One', follower_count: 1234 } });
    assert.equal(n.ownerUsername, 'someone');
    assert.equal(n.ownerFollowersCount, 1234);
  });

  test('old shape (owner / followers) still works', () => {
    const n = normalizeProfileReelItemV2({ ...base, owner: { username: 'someone', full_name: 'Some One', followers: 99 } });
    assert.equal(n.ownerUsername, 'someone');
    assert.equal(n.ownerFollowersCount, 99);
  });
});

describe('profile actor pinned flag', () => {
  const { normalizeProfileReelItemV2 } = require('../server/services/apify.service');
  const base = { play_count: 5000, shortcode: 'abc', user: { username: 'someone' } };

  test('clips_tab_pinned_user_ids marks a Reel as pinned', () => {
    assert.equal(normalizeProfileReelItemV2({ ...base, clips_tab_pinned_user_ids: ['123'] }).isPinned, true);
  });
  test('the older pinned_for_users field still marks it pinned', () => {
    assert.equal(normalizeProfileReelItemV2({ ...base, pinned_for_users: [{ id: 1 }] }).isPinned, true);
  });
  test('an empty pin list means not pinned', () => {
    assert.equal(normalizeProfileReelItemV2({ ...base, clips_tab_pinned_user_ids: [] }).isPinned, false);
    assert.equal(normalizeProfileReelItemV2({ ...base }).isPinned, false);
  });
});

/*
  A sheet with no header row starts straight away with a link. The first row
  used to be read as a heading and that link vanished from the report.
*/
describe('sheet without a header row', () => {
  const ExcelJS = require('exceljs');
  const { parseSpreadsheetBuffer } = require('../server/services/parse.service');
  const links = ['https://www.instagram.com/reel/AAA111', 'https://www.instagram.com/reel/BBB222', 'https://www.instagram.com/reel/CCC333'];

  test('keeps the first link when there is no heading', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    links.forEach((l) => ws.addRow([l]));
    const out = await parseSpreadsheetBuffer(Buffer.from(await wb.xlsx.writeBuffer()), 'a.xlsx', 'reel');
    assert.equal(out.rows.length, 3);
    assert.ok(out.rows.every((r) => r.state === 'pending'));
    assert.equal(out.rows[0].input.url, 'https://www.instagram.com/reel/AAA111');
  });

  test('a normal heading row is still treated as a heading', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['Name', 'Reel Link']);
    ws.addRow(['a', links[0]]);
    ws.addRow(['b', links[1]]);
    const out = await parseSpreadsheetBuffer(Buffer.from(await wb.xlsx.writeBuffer()), 'b.xlsx', 'reel');
    assert.equal(out.rows.length, 2);
    assert.deepEqual(out.originalColumns.map((c) => c.name), ['Name', 'Reel Link']);
  });
});
