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
