const { getDb } = require('../db');

/* =====================================================================
   credits.service.js: single source of truth for the credit system.

   Change costs / free grant HERE and nowhere else.
   ===================================================================== */

// Credits charged per successfully-processed item, by report type.
// Matches the public pricing copy: 1 reel = 1 credit, 1 profile ≈ 5 credits.
const CREDIT_COST = {
  reel: 1,
  profile: 5,
};

// Credits handed to a brand-new self-signup (free tier).
const FREE_SIGNUP_CREDITS = 10;

// Admins get an effectively-unlimited pool so internal runs are never blocked.
const ADMIN_CREDITS = 1000000;

function costPerItem(type) {
  return CREDIT_COST[type] || 1;
}

// Worst-case cost of a run (every chargeable item succeeds).
function costForRun(type, itemCount) {
  return costPerItem(type) * itemCount;
}

// Default credit/plan fields stamped onto every new user document. Admins
// skip the client-facing welcome tour -- they already know the product --
// every new client account gets it on their first login, whether they
// self-signed-up or an agency admin provisioned them.
function defaultsForNewUser(role = 'client') {
  return {
    plan: role === 'admin' ? 'unlimited' : 'free',
    credits: role === 'admin' ? ADMIN_CREDITS : FREE_SIGNUP_CREDITS,
    hasSeenTour: role === 'admin',
  };
}

async function getBalance(username) {
  const db = getDb();
  const u = await db.collection('users').findOne({ username });
  return u ? (u.credits || 0) : 0;
}

/*
  Adjust a user's balance by delta (can be negative). Never lets it go below 0.
  Returns the new balance, or null if the user doesn't exist.

  ATOMIC ON PURPOSE. This used to read the document, compute `credits + delta`
  in Node, and write the result back. The job engine charges one item at a time
  and does not await each charge, so a run with N successful items had N of
  these read-modify-write cycles overlapping: they all read the same starting
  balance and then wrote their own total over each other. Almost every charge
  in a batch was lost, and the credit audit caught it as runs that "do not
  balance" -- 30 profiles counted as 150 credits used while the account only
  dropped by 15.

  Doing the arithmetic inside the update, as a pipeline, means the database
  applies each charge to whatever the balance actually is at that moment, so
  concurrent charges add up instead of clobbering one another. The $max keeps
  the floor at zero without needing a separate read.
*/
async function adjustCredits(username, delta) {
  const db = getDb();
  const res = await db.collection('users').findOneAndUpdate(
    { username },
    [{
      $set: {
        credits: {
          $max: [0, { $add: [{ $ifNull: ['$credits', 0] }, delta] }],
        },
      },
    }],
    { returnDocument: 'after', projection: { credits: 1 } }
  );
  const doc = res && (res.value !== undefined ? res.value : res);
  if (!doc) return null;
  return doc.credits;
}

// Explicitly set a user's balance (admin "set to N"). Clamped at 0.
async function setCredits(username, value) {
  const db = getDb();
  const next = Math.max(0, Math.round(value));
  const r = await db.collection('users').updateOne({ username }, { $set: { credits: next } });
  return r.modifiedCount > 0 ? next : null;
}

// Charge for exactly one successful item. Used by the job engine per success.
async function chargeSuccess(username, type) {
  return adjustCredits(username, -costPerItem(type));
}

// Backfill: stamp credits/plan onto any pre-existing user missing them.
// Safe to run every boot, only touches users without a `credits` field.
async function backfillCredits() {
  const db = getDb();
  const users = await db.collection('users').find({}).toArray();
  for (const u of users) {
    if (typeof u.credits !== 'number') {
      const d = defaultsForNewUser(u.role);
      await db.collection('users').updateOne(
        { username: u.username },
        { $set: { credits: d.credits, plan: u.plan || d.plan } }
      );
    }
  }
}

module.exports = {
  CREDIT_COST,
  FREE_SIGNUP_CREDITS,
  ADMIN_CREDITS,
  costPerItem,
  costForRun,
  defaultsForNewUser,
  getBalance,
  adjustCredits,
  setCredits,
  chargeSuccess,
  backfillCredits,
};
