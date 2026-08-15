const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs } = require('./helpers/client');
const { getDb } = require('../server/db');
const { runBootstrap } = require('../server/bootstrap');
const { setCache, getCachedEntry } = require('../server/services/cache.service');
const { recordLedgerEntry } = require('../server/services/ledger.service');

/*
  Covers the production-safety review: Render restarting/redeploying while a
  report is mid-run. The dangerous window is Apify succeeding and the credit
  charge/ledger entry landing, but the process dying before the job's own
  row/cursor update reaches Mongo -- a resumed job then reprocesses that row.

  Rather than trying to kill the real server at an exact instant (flaky,
  timing-dependent, and would only prove one specific interleaving), the
  first test reconstructs the post-crash DB state directly -- exactly what
  jobEngine.service.js would have written up to that point, and nothing
  more -- then drives a real resume through the real spawned server, the
  same way a user clicking "Resume" would.
*/

let agent;
let jobCounter = 0;

async function createStalledJob({ url, owner = 'pro' }) {
  jobCounter += 1;
  const id = `rgr_job_crash_${jobCounter}`;
  const rows = [{ i: 0, input: { url }, state: 'pending', result: null }];

  await getDb().collection('jobs').insertOne({
    _id: id,
    ownerUsername: usernameFor(owner),
    type: 'reel',
    // Mirrors what bootstrap's startup sweep leaves behind, not
    // 'running' -- the crash already happened and the server already
    // rebooted by the time this test's job document exists.
    status: 'paused',
    pausedReason: 'server-restart',
    fileName: 'crash-fixture.txt',
    cursor: 0,
    counts: { total: 1, success: 0, failed: 0, invalid: 0, creditsSpent: 0 },
    rows,
    startedAt: new Date(),
    createdAt: new Date(),
  });
  return id;
}

async function waitForStatus(jobId, wanted = ['done', 'paused', 'failed'], timeoutMs = 15000) {
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

describe('a row already billed before the crash is not billed again on resume', () => {
  test('replaying the row does not move the balance a second time', async () => {
    const url = 'https://www.instagram.com/reel/OK_CRASH1/';
    const id = await createStalledJob({ url });

    const openingBalance = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;

    // Reconstruct exactly what a crash between chargeSuccess() succeeding
    // and the row/cursor write landing would leave behind: the ledger
    // already has a success record and the balance is already debited,
    // but the job document still thinks row 0 is pending -- because it is,
    // from Mongo's point of view, since that write never landed.
    await getDb().collection('submittedLinks').insertOne({
      username: usernameFor('pro'), type: 'reel', jobId: id, url,
      result: 'success', at: new Date(),
    });
    const phantomChargedBalance = openingBalance - 1;
    await getDb().collection('users').updateOne(
      { username: usernameFor('pro') },
      { $set: { credits: phantomChargedBalance } }
    );

    const res = await agent.post(`/jobs/${id}/resume`, {});
    assert.ok(res.ok, `resume should be accepted, got ${res.status}`);

    const job = await waitForStatus(id);
    assert.equal(job.status, 'done', 'the stalled row must still be recovered, not left stuck forever');
    assert.equal(job.rows[0].state, 'done', 'the row must end up done despite being replayed');

    const balanceAfterResume = (await getDb().collection('users').findOne({ username: usernameFor('pro') })).credits;
    assert.equal(
      balanceAfterResume, phantomChargedBalance,
      'a row already billed before the crash must not be charged a second time on resume'
    );
  });
});

describe('a crash/retry cannot create duplicate ledger records', () => {
  test('recordLedgerEntry rejects a second success insert for the same job+url', async () => {
    const jobId = 'rgr_ledger_dup_test';
    const url = 'https://www.instagram.com/reel/OK_LEDGER_DUP/';

    const first = await recordLedgerEntry({
      username: usernameFor('pro'), type: 'reel', jobId, url, result: 'success',
    });
    assert.equal(first.inserted, true, 'the first record for this job+url must insert cleanly');
    assert.equal(first.duplicate, false);

    // Same job, same url, same result -- exactly what a crash-and-resume
    // replay produces: the row gets re-scraped and jobEngine calls
    // recordLedgerEntry() again believing it might be new.
    const second = await recordLedgerEntry({
      username: usernameFor('pro'), type: 'reel', jobId, url, result: 'success',
    });
    assert.equal(second.inserted, false, 'a replayed success for the same row must not insert again');
    assert.equal(second.duplicate, true, 'it must be reported as a duplicate, not a silent success');

    const count = await getDb().collection('submittedLinks').countDocuments({ jobId, url, result: 'success' });
    assert.equal(count, 1, 'exactly one success ledger record must exist for this row, never two');
  });
});

describe('cache survives a normal server restart', () => {
  test('a cached entry is still readable after bootstrap runs again, as it does on every deploy', async () => {
    const url = 'https://www.instagram.com/reel/CACHE_SURVIVE/';
    await setCache(url, 'reel', { views: 12345 });

    // runBootstrap() is exactly what server/index.js runs on every boot.
    // Calling it again here simulates a real restart/redeploy without
    // spinning up a second server process.
    await runBootstrap();

    const entry = await getCachedEntry(url, 'reel');
    assert.ok(entry, 'a cache entry written before a restart must still be readable after one');
    assert.equal(entry.data.views, 12345);
  });
});
