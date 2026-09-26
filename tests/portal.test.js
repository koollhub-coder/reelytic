const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs, createAgent } = require('./helpers/client');
const { getDb } = require('../server/db');

/*
  The client portal is what an agency shows a brand, so it has to say WHICH
  report each number came from. It used to be one flat list of creators with
  no sign of which report they belonged to, and no way to tell reports apart.
  Also covers: a campaign can be made without a picture, the per-account
  feature override list reaches every paid feature, and a free account can be
  handed the portal from the admin screen.
*/

let pro;
let free;
let admin;
let campaignId;

const row = (username, views, er) => ({
  i: 1, state: 'done', input: { url: `https://instagram.com/reel/${username}/` },
  result: { username, followers: 1000, views, likes: 50, comments: 5, er, avgViews: 0, avgEr: 0 },
});

before(async () => {
  await seed();
  await startServer();
  pro = await loginAs('pro');
  free = await loginAs('free');
  admin = await loginAs('admin');

  const made = await pro.post('/campaigns', { name: 'Portal test' });
  assert.equal(made.status, 200, `a campaign with no picture must be creatable: ${JSON.stringify(made.data)}`);
  campaignId = made.data.campaign.id;

  const db = getDb();
  await db.collection('jobs').insertMany([
    { _id: 'rgr_portal_a', ownerUsername: usernameFor('pro'), type: 'reel', status: 'done', fileName: 'week-one.xlsx', campaignId, counts: { total: 2, success: 2, failed: 0, creditsSpent: 2 }, createdAt: new Date('2026-09-01'), rows: [row('alpha', 1000, 4), row('beta', 3000, 8)] },
    { _id: 'rgr_portal_b', ownerUsername: usernameFor('pro'), type: 'reel', status: 'done', fileName: 'week-two.xlsx', campaignId, counts: { total: 1, success: 1, failed: 0, creditsSpent: 1 }, createdAt: new Date('2026-09-08'), rows: [row('gamma', 2000, 5)] },
  ]);
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('the client portal tells reports apart', () => {
  let token;
  let data;

  test('a portal link can be made and read with no login', async () => {
    const res = await pro.post(`/campaigns/${campaignId}/portal`, {});
    assert.equal(res.status, 200, JSON.stringify(res.data));
    token = res.data.portalToken;
    const anon = createAgent();
    const seen = await anon.get(`/public/campaigns/${token}`);
    assert.equal(seen.status, 200);
    data = seen.data;
  });

  test('every report gets its own summary line', () => {
    assert.equal(data.reports.length, 2);
    const byName = Object.fromEntries(data.reports.map((r) => [r.name, r]));
    assert.equal(byName['week-one.xlsx'].creators, 2);
    assert.equal(byName['week-one.xlsx'].totalViews, 4000);
    assert.equal(byName['week-two.xlsx'].creators, 1);
    // views-weighted engagement: (4*1000 + 8*3000) / 4000 = 7
    assert.equal(byName['week-one.xlsx'].avgEr, 7);
  });

  test('every creator row says which report it came from', () => {
    assert.equal(data.rows.length, 3);
    const keys = new Set(data.reports.map((r) => r.key));
    for (const r of data.rows) assert.ok(keys.has(r.reportKey), 'row must point at a report in the summary');
    const gamma = data.rows.find((r) => r.result.username === 'gamma');
    const week2 = data.reports.find((r) => r.name === 'week-two.xlsx');
    assert.equal(gamma.reportKey, week2.key);
  });

  test('the campaign totals still add up across reports', () => {
    assert.equal(data.campaign.reportCount, 2);
    assert.equal(data.campaign.totalViews, 6000);
  });

  test('no database ids or owner names leak into the public view', () => {
    const text = JSON.stringify(data);
    assert.ok(!text.includes('rgr_portal_a'), 'job id leaked');
    assert.ok(!text.includes(usernameFor('pro')), 'owner username leaked');
  });
});

describe('the admin can hand out any paid feature', () => {
  test('a free account cannot make a portal until it is granted', async () => {
    const made = await free.post('/campaigns', { name: 'Free try' });
    const blocked = await free.post(`/campaigns/${made.data.campaign.id}/portal`, {});
    assert.equal(blocked.status, 403);
  });

  test('every paid feature can be switched on from the admin screen', async () => {
    const clients = await admin.get('/admin/clients');
    const target = clients.data.clients.find((c) => c.username === usernameFor('free'));
    const all = { reportBranding: true, shareableLinks: true, pdfExport: true, creatorDatabase: true, teamSeats: true, clientPortal: true };
    const res = await admin.patch(`/admin/clients/${target.username}`, { featureOverrides: all });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const fresh = await loginAs('free');
    for (const key of Object.keys(all)) assert.equal(fresh.user.features[key], true, `${key} should be on`);
    const made = await fresh.post('/campaigns', { name: 'Free with override' });
    const ok = await fresh.post(`/campaigns/${made.data.campaign.id}/portal`, {});
    assert.equal(ok.status, 200);
  });

  test('turning team seats on gives a free account room to invite', async () => {
    const fresh = await loginAs('free');
    const team = await fresh.get('/team');
    assert.equal(team.status, 200, JSON.stringify(team.data));
    assert.ok(team.data.maxSeats >= 5, `expected at least 5 seats, got ${team.data.maxSeats}`);
  });
});
