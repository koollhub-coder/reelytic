const { connectDb, getDb, closeDb } = require('../../server/db');
const { hashPassword } = require('../../server/utils/password');
const { assertTestDatabase, testName, TEST_PREFIX } = require('./env');

/*
  Builds the world every test runs against: one account per tier, plus an
  admin, plus fixture reports.

  ONE ACCOUNT PER TIER IS THE WHOLE POINT. The entitlement matrix is the part
  of this product that is impossible to hold in your head and miserable to
  click through by hand -- five tiers times a handful of gated features times
  real-versus-sample data. Seeding them once here is what makes asserting
  every cell of that matrix cheap.

  Every account uses the same password so tests stay readable; they exist for
  seconds in a throwaway database and are deleted afterwards.
*/

const PASSWORD = 'regression-test-pw-1';

/*
  Mirrors the plan definitions in server/routes/pricing.routes.js. Kept as an
  explicit table rather than imported so that if someone changes a plan's
  feature flags, these tests FAIL rather than silently agreeing with the new
  value. A test that reads its expectations from the code it is testing
  cannot detect a regression in that code.
*/
const TIERS = [
  { key: 'free', plan: 'free', credits: 10, role: 'client', expect: { reportBranding: false, shareableLinks: false } },
  { key: 'starter', plan: 'starter', credits: 2000, role: 'client', expect: { reportBranding: false, shareableLinks: false } },
  { key: 'pro', plan: 'pro', credits: 5000, role: 'client', expect: { reportBranding: true, shareableLinks: true } },
  { key: 'agency', plan: 'agency', credits: 10000, role: 'client', expect: { reportBranding: true, shareableLinks: true } },
  { key: 'unlimited', plan: 'unlimited', credits: 999999, role: 'client', expect: { reportBranding: false, shareableLinks: false } },
  { key: 'admin', plan: 'unlimited', credits: 999999, role: 'admin', expect: { reportBranding: true, shareableLinks: true } },
];

function usernameFor(tierKey) {
  return testName(tierKey);
}

async function seed() {
  assertTestDatabase();
  await connectDb();
  const db = getDb();

  // Always start from nothing. A suite that depends on leftovers from a
  // previous run is a suite that passes locally and fails everywhere else.
  await teardown({ keepConnection: true });

  const passwordHash = await hashPassword(PASSWORD);
  const now = new Date();

  const users = TIERS.map((t) => ({
    username: usernameFor(t.key),
    email: `${usernameFor(t.key)}@regression.test`,
    passwordHash,
    role: t.role,
    plan: t.plan,
    credits: t.credits,
    authProvider: 'local',
    mustChangePassword: false,
    disabled: false,
    sessionsRevokedAt: null,
    hasSeenTour: true,
    createdAt: now,
    lastLoginAt: now,
  }));
  await db.collection('users').insertMany(users);

  /*
    A finished report owned by the free account, used to prove two different
    things: that its owner can reach it, and that nobody else can. Written
    directly rather than run through the engine because this fixture is about
    ownership and entitlements, not about the pipeline (that is Layer 3).
  */
  const ownedJob = {
    _id: `${TEST_PREFIX}job_owned`,
    ownerUsername: usernameFor('free'),
    type: 'reel',
    status: 'done',
    fileName: 'regression-fixture.xlsx',
    counts: { total: 2, success: 2, failed: 0, creditsSpent: 2 },
    creditsBefore: 12,
    creditsAfter: 10,
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    rows: [
      { input: { url: 'https://www.instagram.com/reel/AAAAAAAAAAA/' }, state: 'done', result: { username: 'fixture_one', views: 1000, likes: 100, comments: 10, er: 11 } },
      { input: { url: 'https://www.instagram.com/reel/BBBBBBBBBBB/' }, state: 'done', result: { username: 'fixture_two', views: 2000, likes: 100, comments: 10, er: 5.5 } },
    ],
  };

  // Same shape but owned by pro, so cross-account access can be tested in
  // both directions rather than only one.
  const otherJob = { ...ownedJob, _id: `${TEST_PREFIX}job_other`, ownerUsername: usernameFor('pro') };

  await db.collection('jobs').insertMany([ownedJob, otherJob]);

  return { tiers: TIERS, password: PASSWORD, jobs: { owned: ownedJob._id, other: otherJob._id } };
}

/*
  Deletes only what the suite created.

  Matching on the prefix rather than "everything in this database" is
  deliberate: the test database is cheap to recreate, but a teardown that
  truncates collections would be one misconfigured env var away from doing
  that to production.
*/
async function teardown({ keepConnection = false } = {}) {
  assertTestDatabase();
  await connectDb();
  const db = getDb();

  const prefixed = { $regex: `^${TEST_PREFIX}` };

  await Promise.all([
    db.collection('users').deleteMany({ username: prefixed }),
    db.collection('jobs').deleteMany({ ownerUsername: prefixed }),
    db.collection('jobs').deleteMany({ _id: prefixed }),
    db.collection('ledger').deleteMany({ username: prefixed }),
    db.collection('loginHistory').deleteMany({ username: prefixed }),
    db.collection('campaigns').deleteMany({ ownerUsername: prefixed }),
    db.collection('submittedLinks').deleteMany({ username: prefixed }),
    db.collection('errorEvents').deleteMany({ message: prefixed }),
  ]);

  return true;
}

/*
  Releases the Mongo pool. Without this a test file finishes its assertions
  and then hangs forever, because an open connection keeps Node's event loop
  alive and the test runner waits for it.
*/
async function closeConnection() {
  await closeDb();
}

module.exports = { seed, teardown, closeConnection, TIERS, PASSWORD, usernameFor };
