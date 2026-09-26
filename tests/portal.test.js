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

/*
  A reel re-checked every week lands in every weekly report. The campaign
  totals used to add each check on top of the last, so one reel's views were
  counted once per week. The rollup now keeps only the newest result per reel;
  each report's own line still shows its own numbers.
*/
describe('a reel checked in two reports counts once in the campaign totals', () => {
  let data;
  const reel = (code, username, views, er, extra = {}) => ({
    i: 1, state: 'done', input: { url: `https://www.instagram.com/reel/${code}/?igsh=abc` },
    result: { username, followers: 1000, reelLink: `https://www.instagram.com/reel/${code}`, views, likes: 50, comments: 5, er, ...extra },
  });

  before(async () => {
    const made = await pro.post('/campaigns', { name: 'Recheck test' });
    const id = made.data.campaign.id;
    await getDb().collection('jobs').insertMany([
      { _id: 'rgr_recheck_1', ownerUsername: usernameFor('pro'), type: 'reel', status: 'done', fileName: 'check-1.xlsx', campaignId: id, createdAt: new Date('2026-09-01'), rows: [reel('SAMECODE1', 'delta', 1000, 2), reel('OTHERCODE', 'eps', 500, 4)] },
      // Same reel a week later, pasted with a different link form.
      { _id: 'rgr_recheck_2', ownerUsername: usernameFor('pro'), type: 'reel', status: 'done', fileName: 'check-2.xlsx', campaignId: id, createdAt: new Date('2026-09-08'), rows: [{ ...reel('SAMECODE1', 'delta', 3000, 6), input: { url: 'https://instagram.com/reels/SAMECODE1' } }] },
    ]);
    const portal = await pro.post(`/campaigns/${id}/portal`, {});
    const seen = await createAgent().get(`/public/campaigns/${portal.data.portalToken}`);
    assert.equal(seen.status, 200);
    data = seen.data;
  });

  test('total views use the newest check of each reel', () => {
    assert.equal(data.campaign.totalViews, 3500, 'old check of SAMECODE1 must not be added on top of the new one');
  });

  test('average engagement is weighted over distinct reels', () => {
    // (6*3000 + 4*500) / 3500 = 5.71
    assert.equal(data.campaign.avgEr, 5.71);
  });

  test('creators measured counts distinct reels', () => {
    assert.equal(data.campaign.creators, 2);
  });

  test('each report keeps its own numbers', () => {
    const byName = Object.fromEntries(data.reports.map((r) => [r.name, r]));
    assert.equal(byName['check-1.xlsx'].totalViews, 1500);
    assert.equal(byName['check-2.xlsx'].totalViews, 3000);
    assert.equal(data.rows.length, 3, 'every report row is still listed');
  });

  test('no shortcode-derived key or raw input leaks into the response', () => {
    const text = JSON.stringify(data);
    assert.ok(!text.includes('igsh=abc'), 'raw input url leaked');
    assert.ok(!text.includes('rgr_recheck'), 'job id leaked');
  });
});

/*
  Profile creators used to show 0 views and 0.00% in the portal, because the
  page read reel fields a profile result does not have. They now carry their
  real averages, and stay out of the campaign's total views, since a typical
  views-per-Reel figure is not views of anything in this campaign.
*/
describe('profile reports in a portal show their own numbers', () => {
  let data;
  const prof = (u, avgViews, avgEr) => ({ i: 1, state: 'done', input: { url: `https://www.instagram.com/${u}` }, result: { username: u, followers: 50000, avgViews, avgEr, reelsAnalyzed: 6 } });

  before(async () => {
    const made = await pro.post('/campaigns', { name: 'Mixed test' });
    const id = made.data.campaign.id;
    await getDb().collection('jobs').insertMany([
      { _id: 'rgr_mixed_reel', ownerUsername: usernameFor('pro'), type: 'reel', status: 'done', fileName: 'reels.xlsx', campaignId: id, createdAt: new Date('2026-09-01'), rows: [row('rho', 2000, 5)] },
      { _id: 'rgr_mixed_prof', ownerUsername: usernameFor('pro'), type: 'profile', status: 'done', fileName: 'profiles.xlsx', campaignId: id, createdAt: new Date('2026-09-02'), rows: [prof('sigma', 90000, 2), prof('tau', 30000, 3)] },
    ]);
    const portal = await pro.post(`/campaigns/${id}/portal`, {});
    data = (await createAgent().get(`/public/campaigns/${portal.data.portalToken}`)).data;
  });

  test('profile rows carry their real averages', () => {
    const sigma = data.rows.find((r) => r.result.username === 'sigma');
    assert.equal(sigma.reportType, 'profile');
    assert.equal(sigma.result.avgViews, 90000);
    assert.equal(sigma.result.avgEr, 2);
  });

  test('the profile report line gives its follower ER and no view total', () => {
    const line = data.reports.find((r) => r.name === 'profiles.xlsx');
    assert.equal(line.totalViews, null);
    assert.equal(line.avgEr, 2.5);
    assert.equal(line.erBasis, 'followers');
    assert.equal(data.reports.find((r) => r.name === 'reels.xlsx').erBasis, 'views');
  });

  test('campaign totals count Reel views only', () => {
    assert.equal(data.campaign.totalViews, 2000);
    assert.equal(data.campaign.avgEr, 5);
    assert.equal(data.campaign.creators, 3);
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
