const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor, PASSWORD } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs } = require('./helpers/client');
const { getDb } = require('../server/db');
const { hashPassword } = require('../server/utils/password');

/*
  A team member works inside the owner's workspace: the owner's plan, credits,
  reports and data, none of their own. This file exists because two real
  faults slipped through without it, both found only by signing in as an actual
  team member:

    1. The sample report (and so the guided tour) was created under the
       member's own name and then refused by the ownership check, which looks
       at the owner's name. Every member's tour died silently.
    2. When an owner changed their username, their members kept pointing at the
       old name and lost access.
*/

let owner;
let member;
let stranger;

before(async () => {
  await seed();
  const db = getDb();
  await db.collection('users').insertOne({
    username: usernameFor('member'),
    email: `${usernameFor('member')}@regression.test`,
    passwordHash: await hashPassword(PASSWORD),
    role: 'client',
    plan: 'free',
    credits: 0,
    teamOwnerUsername: usernameFor('pro'),
    authProvider: 'local',
    mustChangePassword: false,
    disabled: false,
    sessionsRevokedAt: null,
    hasSeenTour: true,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  });
  await startServer();
  owner = await loginAs('pro');
  member = await loginAs('member');
  stranger = await loginAs('free');
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('a team member sees the owner\'s workspace', () => {
  test('gets the owner\'s plan, credits and features', () => {
    assert.equal(member.user.plan, 'pro');
    assert.equal(member.user.credits, 5000);
    assert.equal(member.user.isTeamMember, true);
    assert.equal(member.user.features.reportBranding, true);
  });

  test('can open the sample report the tour builds for them', async () => {
    const made = await member.post('/jobs/demo', {});
    assert.equal(made.status, 200);
    const opened = await member.get(`/jobs/${made.data.jobId}`);
    assert.equal(opened.status, 200, `the member's own sample must open, got ${opened.status}`);
  });

  test('owner and member share one sample instead of each getting a copy', async () => {
    const a = await owner.post('/jobs/demo', {});
    const b = await member.post('/jobs/demo', {});
    assert.equal(a.data.jobId, b.data.jobId);
  });

  test('can read the owner\'s reports, and a stranger cannot', async () => {
    const id = 'rgr_job_team_1';
    await getDb().collection('jobs').insertOne({
      _id: id, ownerUsername: usernameFor('pro'), type: 'reel', status: 'done', fileName: 'team.xlsx',
      counts: { total: 0, success: 0, failed: 0, creditsSpent: 0 }, createdAt: new Date(), rows: [],
    });
    assert.equal((await member.get(`/jobs/${id}`)).status, 200);
    assert.equal((await stranger.get(`/jobs/${id}`)).status, 403);
  });

  test('cannot manage billing', async () => {
    const res = await member.post('/billing/create-order', { planId: 'starter' });
    assert.equal(res.status, 403);
  });
});

describe('renaming the owner does not strand the team', () => {
  test('the member keeps their access after the owner changes username', async () => {
    const before = usernameFor('pro');
    const renamed = `${before}_renamed`;
    const res = await owner.patch('/auth/username', { username: renamed });
    assert.equal(res.status, 200, JSON.stringify(res.data));

    const db = getDb();
    const row = await db.collection('users').findOne({ username: usernameFor('member') });
    assert.equal(row.teamOwnerUsername, renamed);

    const fresh = await loginAs('member');
    assert.equal(fresh.user.plan, 'pro', 'the member must still see the owner\'s plan');
    assert.equal(fresh.user.isTeamMember, true);

    // put it back so teardown can find the account
    await db.collection('users').updateOne({ username: renamed }, { $set: { username: before } });
    await db.collection('users').updateMany({ teamOwnerUsername: renamed }, { $set: { teamOwnerUsername: before } });
  });
});

describe('a link to an admin account grants nothing', () => {
  let linked;
  before(async () => {
    // Someone linked to the platform admin, however that happened (there is no
    // UI for it). They must stay an ordinary account, not inherit the admin's
    // effectively unlimited pool.
    await getDb().collection('users').insertOne({
      username: usernameFor('adminlinked'),
      email: `${usernameFor('adminlinked')}@regression.test`,
      passwordHash: await hashPassword(PASSWORD),
      role: 'client', plan: 'free', credits: 3,
      teamOwnerUsername: usernameFor('admin'),
      authProvider: 'local', mustChangePassword: false, disabled: false, sessionsRevokedAt: null,
      hasSeenTour: true, createdAt: new Date(), lastLoginAt: new Date(),
    });
    linked = await loginAs('adminlinked');
  });

  test('keeps their own plan and credits instead of the admin\'s', async () => {
    const me = await linked.get('/auth/me');
    assert.equal(me.data.user.plan, 'free');
    assert.equal(me.data.user.credits, 3);
    assert.equal(me.data.user.isTeamMember, false);
    assert.equal(me.data.user.features.reportBranding, false);
  });

  test('cannot spend the admin\'s credits or touch the admin\'s data', async () => {
    const adminJob = 'rgr_job_admin_private';
    await getDb().collection('jobs').insertOne({
      _id: adminJob, ownerUsername: usernameFor('admin'), type: 'reel', status: 'done', fileName: 'admin.xlsx',
      counts: { total: 0, success: 0, failed: 0, creditsSpent: 0 }, createdAt: new Date(), rows: [],
    });
    assert.equal((await linked.get(`/jobs/${adminJob}`)).status, 403);
  });

  test('an admin cannot invite anyone into their workspace', async () => {
    const admin = await loginAs('admin');
    const res = await admin.post('/team/invite', { email: 'someone@example.com' });
    assert.equal(res.status, 403);
    assert.equal(res.data.code, 'ADMIN_NO_TEAM');
  });
});

describe('invites survive an owner rename, and expired ones free their seat', () => {
  const { anonymousAgent } = require('./helpers/client');

  test('an invite sent before the owner renames lands the member in the renamed workspace', async () => {
    const db = getDb();
    const original = usernameFor('pro');
    const renamed = `${original}_inv`;
    const email = `${usernameFor('invitee')}@regression.test`;
    // A fresh session: the earlier rename test moved the shared one's name.
    const inviter = await loginAs('pro');

    const sent = await inviter.post('/team/invite', { email });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const { token } = sent.data.invite;

    const res = await inviter.patch('/auth/username', { username: renamed });
    assert.equal(res.status, 200, JSON.stringify(res.data));

    try {
      const invite = await db.collection('teamInvites').findOne({ token });
      assert.equal(invite.teamOwnerUsername, renamed, 'the pending invite must follow the rename');

      const accepted = await anonymousAgent().post(`/team/invite/${token}/accept`, { username: usernameFor('invitee'), password: PASSWORD });
      assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
      assert.equal(accepted.data.user.plan, 'pro', 'the new member shares the owner\'s plan');

      const row = await db.collection('users').findOne({ username: usernameFor('invitee') });
      assert.equal(row.teamOwnerUsername, renamed);
    } finally {
      // put it back so teardown and later tests can find the account
      await db.collection('users').updateOne({ username: renamed }, { $set: { username: original } });
      await db.collection('users').updateMany({ teamOwnerUsername: renamed }, { $set: { teamOwnerUsername: original } });
      await db.collection('teamInvites').updateMany({ teamOwnerUsername: renamed }, { $set: { teamOwnerUsername: original } });
      await db.collection('users').deleteOne({ username: usernameFor('invitee') });
    }
  });

  test('expired pending invites do not use up seats', async () => {
    const db = getDb();
    const fresh = await loginAs('pro');
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.collection('teamInvites').insertMany([1, 2, 3, 4, 5].map((i) => ({
      token: `rgr_expired_${i}_${Date.now()}`,
      email: `${usernameFor('expired' + i)}@regression.test`,
      teamOwnerUsername: usernameFor('pro'),
      status: 'pending',
      createdAt: past,
      expiresAt: past,
    })));

    const res = await fresh.post('/team/invite', { email: `${usernameFor('seatcheck')}@regression.test` });
    assert.equal(res.status, 200, JSON.stringify(res.data));

    // And re-inviting an address whose earlier invite expired works too.
    const again = await fresh.post('/team/invite', { email: `${usernameFor('expired1')}@regression.test` });
    assert.equal(again.status, 200, JSON.stringify(again.data));
  });
});
