const { getDb } = require('../db');
const crypto = require('crypto');
const config = require('../config');

/*
  Production error tracking.

  The point of this is to find out something is broken BEFORE a client emails
  to say so. Four things can break and all four land here: a route throwing
  5xx, an API call failing in the browser, a React component crashing into a
  white screen, and an uncaught script error or promise rejection.

  Three properties matter more than the capture itself, and all three are
  painful to retrofit, so they are built in from the start:

  1. GROUPING. One broken component in a render loop can emit thousands of
     identical errors a minute. Everything is fingerprinted and counted, so
     that arrives as a single row saying "4,182 times" rather than as 4,182
     rows that bury everything else.

  2. SCRUBBING. Error payloads casually carry passwords, tokens and session
     cookies. They are stripped on the way IN, not hidden on the way out, so
     the secret is never written down in the first place.

  3. A CEILING. A storm must never be able to fill the database or slow the
     app down. Writes are capped per window, and reporting failures are
     swallowed: error tracking that can itself take the site down is worse
     than none.
*/

const COLLECTION = 'errorEvents';

// Keys whose values never get stored, at any depth.
const SECRET_KEYS = [
  'password', 'currentpassword', 'newpassword', 'passwordhash',
  'token', 'sharetoken', 'apitoken', 'apikey', 'secret', 'authorization',
  'cookie', 'session', 'credential', 'jwt', 'refreshtoken', 'accesstoken',
];

// Anything that looks like a secret regardless of the key it arrived under.
const SECRET_VALUE_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bapify_api_[A-Za-z0-9]+/gi,
  /\bsk_[A-Za-z0-9]{16,}/gi,
  /\bre_[A-Za-z0-9]{16,}/gi,
  /\b[A-Fa-f0-9]{32,}\b/g, // long hex: session ids, hashes
];

function scrubString(input) {
  let out = String(input == null ? '' : input);
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, '[redacted]');
  // Emails are useful for support but are still personal data; keep the
  // domain so "everyone on one workspace" is still visible, drop the rest.
  out = out.replace(/\b[^\s@]+@([^\s@]+\.[^\s@]+)\b/g, '[email]@$1');
  return out.slice(0, 2000);
}

function scrub(value, depth = 0) {
  if (value == null || depth > 4) return null;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      if (SECRET_KEYS.includes(String(k).toLowerCase())) { out[k] = '[redacted]'; continue; }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return null;
}

/*
  Groups errors that are "the same problem".

  Deliberately excludes anything varying per occurrence (ids, timestamps,
  numbers, quoted values), because otherwise the same bug hit by 200 users
  produces 200 separate groups and the whole point is lost.
*/
function fingerprint({ kind, message, source, route, status }) {
  const normalisedMessage = String(message || '')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    /*
      Any token of 4+ characters mixing letters and digits is an identifier,
      not prose: "6a7d0", "job17b", "index-C3CBpQ90". Without this, short
      Mongo-ish ids survived normalisation and the same bug seen by fifty
      users produced fifty separate groups, which then tripped the new-group
      rate cap and started dropping unrelated errors entirely. Real words
      never contain digits, so this cannot collapse distinct messages.
    */
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{4,}\b/g, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .slice(0, 300);
  const normalisedRoute = String(route || '')
    .replace(/\/[0-9a-f]{16,}/gi, '/<id>')
    .replace(/\/\d+/g, '/<n>');
  const basis = [kind, normalisedMessage, source || '', normalisedRoute, status || ''].join('|');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

/*
  Write ceiling. Counts distinct writes in a rolling window; past the cap the
  service stops persisting until the window rolls. Existing groups still get
  their counter bumped (that is a cheap in-place update), so a storm still
  shows its true scale without generating unbounded new documents.
*/
const WINDOW_MS = 60 * 1000;
const MAX_NEW_GROUPS_PER_WINDOW = 40;
let windowStartedAt = 0;
let newGroupsThisWindow = 0;

function allowNewGroup() {
  const now = Date.now();
  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now;
    newGroupsThisWindow = 0;
  }
  newGroupsThisWindow += 1;
  return newGroupsThisWindow <= MAX_NEW_GROUPS_PER_WINDOW;
}

/*
  Records one error occurrence.

  NEVER THROWS and never blocks the caller. Every call site is already on an
  unhappy path, and an error tracker that can throw turns a handled 500 into
  an unhandled crash. Callers are expected to fire-and-forget this.
*/
async function recordError(input = {}) {
  try {
    const kind = String(input.kind || 'unknown').slice(0, 40);
    const message = scrubString(input.message || 'Unknown error');
    const source = scrubString(input.source || '').slice(0, 300);
    const route = scrubString(input.route || '').slice(0, 200);
    const status = input.status != null ? Number(input.status) : null;

    const id = fingerprint({ kind, message, source, route, status });
    const db = getDb();
    const now = new Date();

    const existing = await db.collection(COLLECTION).findOne(
      { _id: id },
      { projection: { _id: 1, affectedUsers: 1 } }
    );
    if (!existing && !allowNewGroup()) return { skipped: 'rate-capped' };

    /*
      Only record a user against a group if they are new to it and the list is
      still short.

      Decided here rather than in the update because $addToSet cannot take a
      $slice (that is $push only) -- pairing them is silently rejected by
      Mongo, which made every single write fail while this function's own
      catch swallowed the reason. Capping in code keeps the array bounded
      without needing an operator that does not exist.
    */
    const known = (existing && existing.affectedUsers) || [];
    const candidate = input.username ? String(input.username).slice(0, 64) : null;
    const affected = candidate && known.length < 50 && !known.includes(candidate) ? candidate : null;

    const update = {
      $setOnInsert: {
        _id: id,
        kind,
        message,
        source,
        route,
        status,
        firstSeenAt: now,
      },
      $set: {
        lastSeenAt: now,
        // resolvedAt lives in $set, not $setOnInsert -- $setOnInsert only
        // ever applies on the ONE write that creates the document, so
        // putting it there meant a group that recurred after being marked
        // (or auto-) resolved kept its old resolvedAt forever: the count
        // went up, lastSeenAt moved, but it stayed filed as fixed. Any fresh
        // occurrence reopens it, which is the whole point of tracking this
        // at all -- a bug that comes back is real news, not a duplicate.
        resolvedAt: null,
        // Only the most recent context is kept. Older copies of the same bug
        // add storage without adding information.
        lastContext: scrub({
          stack: input.stack ? String(input.stack).split('\n').slice(0, 12).join('\n') : null,
          userAgent: input.userAgent || null,
          appVersion: input.appVersion || null,
          extra: input.extra || null,
        }),
      },
      $inc: { count: 1 },
    };
    if (affected) update.$addToSet = { affectedUsers: affected };

    await db.collection(COLLECTION).updateOne({ _id: id }, update, { upsert: true });

    /*
      Alerting is a consequence of recording, not a separate concern the
      callers have to remember. Required lazily to avoid a circular import,
      and deliberately not awaited: sending an email must never delay the
      response to a user whose request has already failed.
    */
    try {
      const fresh = await db.collection(COLLECTION).findOne({ _id: id });
      require('./alerting.service')
        .maybeAlert(fresh, { isNew: !existing })
        .catch(() => { /* alerting failures stay silent */ });
    } catch (e) { /* never let alerting break capture */ }

    return { id };
  } catch (e) {
    // Deliberately silent beyond the console: see the note above.
    try { console.error('[ErrorTracking] failed to record:', e.message); } catch (_) { /* noop */ }
    return { skipped: 'record-failed' };
  }
}

/*
  Auto-resolves anything that has gone quiet.

  There is no way to positively confirm a bug fix from inside an error
  tracker -- the only honest signal available is "this stopped happening."
  So an open group with no new occurrence in config.healthAutoResolveDays
  (default 7) gets marked resolved on its own, exactly as if someone had
  clicked "Mark fixed" -- which is what this whole feature exists to save
  an admin from doing by hand, one row at a time, for things that were
  never going to recur anyway. Nothing is deleted: the row still exists,
  still shows up with "Include ones I have marked fixed" checked, and still
  reopens the instant it actually recurs (see recordError's $set.resolvedAt
  above) -- auto-resolving just means it stops counting as an open issue.

  Run lazily on read (same TTL-on-read shape as cache.service.js) rather
  than on a timer, so there is no separate scheduled job to keep alive --
  it self-corrects the moment anyone next looks at the Health page or the
  sidebar polls the unresolved badge.
*/
async function autoResolveStale() {
  try {
    const db = getDb();
    const days = Number(config.healthAutoResolveDays) || 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await db.collection(COLLECTION).updateMany(
      { resolvedAt: null, lastSeenAt: { $lt: cutoff } },
      { $set: { resolvedAt: new Date(), autoResolved: true } }
    );
  } catch (e) { /* best-effort, same as everything else in this file */ }
}

// Unresolved groups, newest activity first. Used by the admin Health page.
async function listErrors({ includeResolved = false, limit = 100 } = {}) {
  await autoResolveStale();
  const db = getDb();
  const query = includeResolved ? {} : { resolvedAt: null };
  return db.collection(COLLECTION)
    .find(query)
    .sort({ lastSeenAt: -1 })
    .limit(Math.min(Number(limit) || 100, 300))
    .toArray();
}

// Drives the badge in the admin nav. Counts groups, not occurrences: "3
// things are broken" is more actionable than "9,120 errors".
async function unresolvedCount() {
  try {
    await autoResolveStale();
    return await getDb().collection(COLLECTION).countDocuments({ resolvedAt: null });
  } catch (e) {
    return 0;
  }
}

async function resolveError(id, resolved = true) {
  const db = getDb();
  // A human clicking "Mark fixed"/"Reopen" is a deliberate decision, not the
  // silence-based guess autoResolveStale makes -- clearing autoResolved here
  // means the badge never claims credit the admin didn't ask it to take.
  await db.collection(COLLECTION).updateOne(
    { _id: String(id) },
    { $set: { resolvedAt: resolved ? new Date() : null, autoResolved: false } }
  );
  return true;
}

// Reappearing after being marked fixed is itself worth knowing about, so a
// resolved group reopens automatically when it next occurs.
async function ensureIndexes() {
  try {
    const db = getDb();
    await db.collection(COLLECTION).createIndex({ lastSeenAt: -1 });
    await db.collection(COLLECTION).createIndex({ resolvedAt: 1, lastSeenAt: -1 });
  } catch (e) { /* index creation is best-effort */ }
}

module.exports = {
  recordError,
  listErrors,
  unresolvedCount,
  resolveError,
  ensureIndexes,
  fingerprint,
  scrub,
  COLLECTION,
};
