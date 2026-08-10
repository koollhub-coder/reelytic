/*
  A small in-process IP rate limiter for the unauthenticated public routes.

  Everything else in the app sits behind requireLogin, which is its own
  throttle: you need an account to get anywhere. The /api/public/* routes have
  no such floor. Their only guard is a 128-bit share token, and while guessing
  one is not realistically feasible, an unauthenticated endpoint that runs a
  database lookup (and, for the export, builds a whole workbook in memory) is
  worth putting a ceiling on regardless. A single IP hammering the export was
  previously bounded only by how fast the server could generate XLSX files.

  Deliberately in-process rather than Redis-backed: this app runs as a single
  Render instance, and a dependency-free limiter that works today beats a
  distributed one that needs infrastructure we don't have. If Reelytic ever
  runs more than one instance, this needs to move to shared storage, since
  each instance would otherwise enforce its own separate allowance.
*/

// ip -> { count, resetAt }
const buckets = new Map();

// Without this the map grows one entry per unique IP forever. Cheap to sweep
// because expired buckets are exactly the ones we no longer need.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS);
// Don't hold the process open on shutdown just for a cleanup timer.
if (sweeper.unref) sweeper.unref();

/**
 * @param {object} opts
 * @param {number} opts.windowMs  Length of the sliding window.
 * @param {number} opts.max       Requests allowed per IP per window.
 * @param {string} opts.message   What the caller sees when they exceed it.
 * @param {string} [opts.scope]   Keeps separate counts for separate routes.
 */
function rateLimit({ windowMs, max, message, scope = 'default' }) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const key = `${scope}_${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED', retryAfter });
    }

    return next();
  };
}

module.exports = { rateLimit };
