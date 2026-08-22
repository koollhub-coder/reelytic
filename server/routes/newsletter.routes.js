const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

/*
  Backs the "Stay in the loop" signup in the Landing page footer. Deliberately
  real and working, not a decorative form that silently does nothing on
  submit -- a footer email capture that fails to actually capture anything is
  exactly the kind of thing that erodes trust in a product page, which is the
  one thing this page cannot afford right before a fundraise.

  No sending infrastructure is wired up yet (nothing emails this list) -- it
  only captures addresses for whenever that's built. Idempotent by design:
  resubscribing with the same address is a no-op, not a duplicate row.
*/

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const attempts = new Map(); // ip -> { count, resetAt }

router.post('/subscribe', async (req, res, next) => {
  try {
    const cleanEmail = ((req.body && req.body.email) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const record = attempts.get(ip);
    if (record && record.resetAt > now && record.count >= 5) {
      return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    }
    if (!record || record.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    } else {
      record.count++;
    }

    const db = getDb();
    await db.collection('newsletterSubscribers').updateOne(
      { email: cleanEmail },
      { $setOnInsert: { email: cleanEmail, subscribedAt: new Date() } },
      { upsert: true }
    );

    res.json({ subscribed: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
