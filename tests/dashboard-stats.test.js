const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs } = require('./helpers/client');
const { getDb } = require('../server/db');

/*
  /me/stats and /admin/overview are both period-scoped by an explicit
  ?days= range (see me.routes.js's ALLOWED_RANGE_DAYS / admin.routes.js's
  OVERVIEW_RANGE_DAYS), not an all-time total. That split is exactly what
  used to produce a real bug: Dashboard.jsx's "No reports yet" hero read
  the WINDOWED totalCount to decide whether an account had ever used the
  product at all, so an account whose most recent activity happened to
  fall outside the selected window was told it had never submitted
  anything -- even with hundreds of historical reports. The fix was to
  derive that decision from recentJobs (fetched unscoped by date) instead.
  This file locks down the data both sides of that fix depend on.
*/

let agents = {};

before(async () => {
  await seed();
  await startServer();
  agents.pro = await loginAs('pro');
  agents.admin = await loginAs('admin');
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('/me/stats range handling', () => {
  test('an account with history only OUTSIDE the default window still has recentJobs, just a zero windowed count', async () => {
    const db = getDb();
    const username = usernameFor('pro');
    const outsideDefaultWindow = new Date();
    outsideDefaultWindow.setDate(outsideDefaultWindow.getDate() - 20); // > 14 days ago, < 30

    await db.collection('jobs').insertOne({
      _id: 'rgr_job_stats_outside_window',
      ownerUsername: username,
      type: 'reel',
      status: 'done',
      fileName: 'rgr-stats-fixture.xlsx',
      counts: { total: 1, success: 1, failed: 0, creditsSpent: 1 },
      createdAt: outsideDefaultWindow,
      rows: [],
    });
    await db.collection('submittedLinks').insertOne({
      jobId: 'rgr_job_stats_outside_window',
      username,
      type: 'reel',
      result: 'success',
      at: outsideDefaultWindow,
      url: 'https://www.instagram.com/reel/RGRSTATSFIXTURE/',
    });

    const defaultRes = await agents.pro.get('/me/stats');
    assert.equal(defaultRes.status, 200);
    assert.equal(defaultRes.data.days, 14, 'no ?days= should fall back to the 14-day default');
    assert.equal(defaultRes.data.totalCount, 0, 'the fixture link is outside the 14-day window, so the windowed count must be 0');
    assert.ok(
      defaultRes.data.recentJobs.some((j) => j.id === 'rgr_job_stats_outside_window'),
      'recentJobs is fetched unscoped by date -- the fixture job must still appear here even though it is outside the windowed count, or the "No reports yet" empty state would wrongly show for an account with real history'
    );

    const widerRes = await agents.pro.get('/me/stats?days=30');
    assert.equal(widerRes.status, 200);
    assert.equal(widerRes.data.days, 30);
    assert.ok(widerRes.data.totalCount >= 1, 'widening the range to 30 days must bring the fixture link into the windowed count');
    assert.equal(widerRes.data.activityByDay.length, 30, 'the chart array length must match the requested range');
  });

  test('an out-of-whitelist ?days= value falls back to the default rather than erroring or being accepted verbatim', async () => {
    const res = await agents.pro.get('/me/stats?days=999');
    assert.equal(res.status, 200);
    assert.equal(res.data.days, 14);
    assert.equal(res.data.activityByDay.length, 14);
  });
});

describe('/admin/overview range handling', () => {
  test('accepts a whitelisted range and rejects an arbitrary one the same way /me/stats does', async () => {
    const wide = await agents.admin.get('/admin/overview?days=90');
    assert.equal(wide.status, 200);
    assert.equal(wide.data.days, 90);
    assert.equal(wide.data.activityByDay.length, 90);

    const bogus = await agents.admin.get('/admin/overview?days=3');
    assert.equal(bogus.status, 200);
    assert.equal(bogus.data.days, 14, 'an unlisted range must fall back to the 14-day default, not be honored verbatim');
  });
});
