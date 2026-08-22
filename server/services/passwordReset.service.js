/*
  Self-service "forgot password" tokens. Mirrors otp.service.js on purpose --
  same hash-at-rest, TTL-index self-cleanup, and one-pending-per-user shape --
  just a random link token instead of a 6-digit code, since the UI this backs
  is "email me a reset link", not "email me a code to type in".
*/
const crypto = require('crypto');
const { getDb } = require('../db');

const TOKEN_BYTES = 32;
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/*
  Issues a fresh token for `username`, replacing any still-pending one.
  Callers are expected to have already resolved the account and decided
  whether it's eligible (see auth.routes.js POST /forgot-password) -- this
  layer doesn't know or care whether the account has a password to reset.
*/
async function issueResetToken(username) {
  const db = getDb();
  const existing = await db.collection('passwordResets').findOne({ username });
  if (existing && Date.now() - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(existing.lastSentAt).getTime())) / 1000);
    const err = new Error(`Wait ${waitSec}s before requesting another reset email.`);
    err.code = 'COOLDOWN';
    err.waitSeconds = waitSec;
    throw err;
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const now = new Date();
  await db.collection('passwordResets').updateOne(
    { username },
    { $set: { username, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + EXPIRY_MS), lastSentAt: now } },
    { upsert: true }
  );
  return token;
}

/*
  Looks a raw token up by its hash. Deliberately does NOT delete the record
  here -- POST /reset-password calls this to validate before showing the
  form isn't broken, and again to actually consume it on submit; deleting on
  the first read would make the reset page a one-time-use link before the
  person ever types a new password.
*/
async function peekResetToken(token) {
  const db = getDb();
  const record = await db.collection('passwordResets').findOne({ tokenHash: hashToken(token) });
  if (!record) return { ok: false, reason: 'invalid' };
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await db.collection('passwordResets').deleteOne({ _id: record._id });
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, username: record.username };
}

async function consumeResetToken(token) {
  const result = await peekResetToken(token);
  if (!result.ok) return result;
  const db = getDb();
  await db.collection('passwordResets').deleteOne({ username: result.username });
  return result;
}

async function clearResetToken(username) {
  const db = getDb();
  await db.collection('passwordResets').deleteOne({ username });
}

module.exports = { issueResetToken, peekResetToken, consumeResetToken, clearResetToken, EXPIRY_MS };
