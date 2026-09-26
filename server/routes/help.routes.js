const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

/*
  The help assistant's feedback loop.

  The assistant itself is static and runs entirely in the browser (see
  client/src/components/HelpBot.jsx), so it needs no server to answer. This
  route exists for one reason: to hear about the questions it could not answer
  and the answers people found unhelpful, so we know what to write next.

  PRIVACY. What is stored is deliberately thin:
    - no username, no IP address, nothing that ties an event to a person;
    - the words typed are kept ONLY for questions it failed to answer, because
      that text is the whole point, and even then emails, long digit runs and
      links are masked and the length is capped;
    - a question it did answer records only WHICH answer was shown.
  Events expire on their own (TTL index in db.js).

  Public on purpose: visitors on the marketing pages can use the assistant
  too. The rate limit below is what stops it being used to fill the database.
*/

const KINDS = new Set(['answered', 'tentative', 'suggest', 'fallback', 'rated']);
const WITH_TEXT = new Set(['tentative', 'suggest', 'fallback']);

const logLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  scope: 'help-log',
  message: 'Too many requests.',
});

// Strip anything that looks like personal data out of a typed question.
function maskText(raw) {
  return String(raw || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/(?:www\.)?instagram\.com\/\S*/gi, '[link]')
    .replace(/\d[\d\s-]{5,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

const keyOf = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

router.post('/log', logLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const kind = String(body.kind || '');
    if (!KINDS.has(kind)) return res.status(400).json({ error: 'Unknown kind' });

    const doc = {
      kind,
      route: String(body.route || '').slice(0, 60),
      createdAt: new Date(),
    };
    if (body.entryId) doc.entryId = String(body.entryId).replace(/[^a-z0-9-]/gi, '').slice(0, 60);
    if (kind === 'rated') doc.helpful = body.helpful === true;
    if (WITH_TEXT.has(kind) && body.q) {
      doc.q = maskText(body.q);
      doc.qKey = keyOf(doc.q);
      if (!doc.qKey) delete doc.q;
    }

    await getDb().collection('helpEvents').insertOne(doc);
    res.status(204).end();
  } catch (err) {
    // Logging must never look like a failure to the person chatting.
    res.status(204).end();
  }
});

// Numbers the assistant quotes, read from their single source of truth so an
// answer can never drift from what the product actually charges. Public: it is
// the same information the Pricing page and upload screen already show.
router.get('/facts', (req, res) => {
  const { CREDIT_COST, FREE_SIGNUP_CREDITS } = require('../services/credits.service');
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ creditsPerReel: CREDIT_COST.reel, creditsPerProfile: CREDIT_COST.profile, freeCredits: FREE_SIGNUP_CREDITS });
});

// What the team reads: what to write next, and what is not landing.
router.get('/admin/summary', requireAdmin, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 120);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const events = getDb().collection('helpEvents');
    const inWindow = { createdAt: { $gte: since } };

    const [byKind, unanswered, topEntries, unhelpful, helpful] = await Promise.all([
      events.aggregate([{ $match: inWindow }, { $group: { _id: '$kind', n: { $sum: 1 } } }]).toArray(),
      events.aggregate([
        { $match: { ...inWindow, kind: { $in: ['fallback', 'suggest', 'tentative'] }, qKey: { $exists: true }, dismissed: { $ne: true } } },
        { $group: { _id: '$qKey', q: { $first: '$q' }, n: { $sum: 1 }, last: { $max: '$createdAt' }, kinds: { $addToSet: '$kind' } } },
        { $sort: { n: -1, last: -1 } },
        { $limit: 60 },
      ]).toArray(),
      events.aggregate([
        { $match: { ...inWindow, kind: { $in: ['answered', 'tentative'] }, entryId: { $exists: true } } },
        { $group: { _id: '$entryId', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 15 },
      ]).toArray(),
      events.aggregate([
        { $match: { ...inWindow, kind: 'rated', helpful: false, entryId: { $exists: true } } },
        { $group: { _id: '$entryId', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 10 },
      ]).toArray(),
      events.countDocuments({ ...inWindow, kind: 'rated', helpful: true }),
    ]);

    const counts = Object.fromEntries(byKind.map((r) => [r._id, r.n]));
    const asked = (counts.answered || 0) + (counts.tentative || 0) + (counts.suggest || 0) + (counts.fallback || 0);
    res.json({
      days,
      asked,
      answered: (counts.answered || 0) + (counts.tentative || 0),
      unanswered: (counts.suggest || 0) + (counts.fallback || 0),
      thumbsUp: helpful,
      thumbsDown: counts.rated ? counts.rated - helpful : 0,
      questions: unanswered.map((r) => ({ key: r._id, q: r.q, count: r.n, lastAt: r.last, kinds: r.kinds })),
      topAnswers: topEntries.map((r) => ({ entryId: r._id, count: r.n })),
      notHelpful: unhelpful.map((r) => ({ entryId: r._id, count: r.n })),
    });
  } catch (err) {
    next(err);
  }
});

// Mark a question as handled (an answer was written for it) so it leaves the list.
router.post('/admin/dismiss', requireAdmin, async (req, res, next) => {
  try {
    const key = keyOf(req.body && req.body.key);
    if (!key) return res.status(400).json({ error: 'Nothing to dismiss' });
    const r = await getDb().collection('helpEvents').updateMany({ qKey: key }, { $set: { dismissed: true } });
    res.json({ dismissed: r.modifiedCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.maskText = maskText;
