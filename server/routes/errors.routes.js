const express = require('express');
const router = express.Router();
const { recordError } = require('../services/errorTracking.service');

/*
  Intake for errors the browser sees.

  DELIBERATELY NOT BEHIND requireLogin. Half the failures worth knowing about
  happen before or around authentication: a crash on the login screen, a
  broken public share link, a session that expired mid-request. Requiring a
  session here would blind us to exactly those.

  Which makes it an unauthenticated write endpoint, so it is treated as one:
  hard rate limit per IP, small body cap, a fixed shape (nothing from the
  request is trusted as-is), and no response body worth harvesting. Anything
  over the limit is dropped silently with a 204, because telling a would-be
  abuser they hit a limit is free information.
*/

const WINDOW_MS = 60 * 1000;
const MAX_PER_IP_PER_WINDOW = 30;
const buckets = new Map(); // ip -> { count, resetAt }

// Keeps the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (b.resetAt < now) buckets.delete(ip);
}, 5 * 60 * 1000).unref?.();

function overLimit(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PER_IP_PER_WINDOW;
}

// Must stay in step with the kinds errorReporter.js sends and the labels
// Health.jsx renders. An unlisted kind is silently downgraded to
// 'client-error', which is how console-error reports first arrived
// mislabelled and unfindable by their own filter.
const ALLOWED_KINDS = new Set([
  'client-crash', 'client-error', 'client-rejection', 'api-failure', 'console-error',
]);

router.post('/', async (req, res) => {
  // Always 204, whatever happens. The browser has nothing useful to do with
  // a failure here, and a client stuck retrying a failing error-reporter is
  // its own outage.
  const done = () => res.status(204).end();

  try {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    if (overLimit(ip)) return done();

    const body = req.body || {};
    const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : 'client-error';

    await recordError({
      kind,
      message: body.message,
      stack: body.stack,
      source: body.source,
      route: body.route,
      status: body.status,
      // Trusted from the session, never from the payload: a client could
      // otherwise attribute its errors to any account it liked.
      username: req.session && req.session.username,
      userAgent: req.headers && req.headers['user-agent'],
      appVersion: body.appVersion,
      extra: body.extra,
    });
  } catch (e) {
    /* swallowed on purpose */
  }
  return done();
});

module.exports = router;
