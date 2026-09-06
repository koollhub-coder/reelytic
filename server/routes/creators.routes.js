const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { requireLogin } = require('../middleware/auth');
const { hasFeature } = require('../services/features.service');
const { getDb, queryId } = require('../db');
const { searchAnalyzedCreators, exportAnalyzedCreators, getCreatorSummary, getCreatorReports } = require('../services/creatorDb.service');
const { generateCreatorsCsv } = require('../services/export.service');

/*
  The creator database: every creator this account (or, for an admin,
  every account on the platform) has ever run a reel or profile report on.
  See creatorDb.service.js for the collection this reads and why it's a
  maintained view rather than a live aggregation.

  Plan-gated the same way reportBranding/shareableLinks already are
  (server/services/features.service.js) -- Starter, Pro and Agency only.
  admin's hasFeature check is unconditionally true regardless of plan, so
  this never blocks an admin.

  isAdmin here decides scope, not just access: a non-admin's ownerUsername
  is forced to their own account no matter what the request asks for --
  the one thing this route must never do is let one client's request see
  another client's creator list.
*/

// Shared by every route in this file -- attaches req.isAdmin so handlers
// don't each recompute it, and refuses a locked-plan non-admin before any
// of them touch the database.
async function requireCreatorDbAccess(req, res, next) {
  try {
    req.isAdmin = req.currentUser.role === 'admin';
    if (!req.isAdmin && !(await hasFeature(req.currentUser, 'creatorDatabase'))) {
      return res.status(403).json({ error: 'The creator database isn\'t available on your current plan. Upgrade to Starter, Pro or Agency to unlock it.', code: 'FEATURE_LOCKED' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    // Admin sees every account's creators by default (the platform-wide
    // view this was built for) but can scope back to just their own with
    // ?scope=mine, same as the rest of the admin screens. A non-admin's
    // scope is always their own account -- the query string is simply
    // never consulted for them.
    const wantsAll = req.isAdmin && req.query.scope !== 'mine';

    const { creators, nextCursor } = await searchAnalyzedCreators({
      ownerUsername: req.currentUser.username,
      isAdmin: wantsAll,
      search: req.query.search,
      cursor: req.query.cursor,
      limit: req.query.limit,
      sort: req.query.sort,
      minFollowers: req.query.minFollowers,
      maxFollowers: req.query.maxFollowers,
      minEr: req.query.minEr,
      campaignId: req.query.campaignId,
    });

    res.json({ creators, nextCursor });
  } catch (err) {
    next(err);
  }
});

// Same filters as the list above, applied to the full matching set instead
// of one page -- see exportAnalyzedCreators for why that's a single capped
// read rather than a paginated loop.
router.get('/export.csv', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    const wantsAll = req.isAdmin && req.query.scope !== 'mine';

    const { rows, truncated } = await exportAnalyzedCreators({
      ownerUsername: req.currentUser.username,
      isAdmin: wantsAll,
      search: req.query.search,
      sort: req.query.sort,
      minFollowers: req.query.minFollowers,
      maxFollowers: req.query.maxFollowers,
      minEr: req.query.minEr,
      campaignId: req.query.campaignId,
    });

    const csv = generateCreatorsCsv(rows);
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="reelytic-creators-${dateStr}.csv"`);
    // The client checks this to tell someone their export was capped rather
    // than silently handing over a partial file with no sign it's short.
    if (truncated) res.setHeader('X-Reelytic-Export-Truncated', '1');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// The header line above the list ("1,248 creators · 184 analyzed this
// month · 73 with 5%+ ER") -- a stable orientation cue, deliberately
// unaffected by search/follower/campaign filters (see getCreatorSummary).
router.get('/summary', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    const wantsAll = req.isAdmin && req.query.scope !== 'mine';
    const summary = await getCreatorSummary({ ownerUsername: req.currentUser.username, isAdmin: wantsAll });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// The reports one creator has appeared in -- fetched only when a card is
// expanded (see getCreatorReports for why this is its own on-demand route
// rather than joined into the list above).
router.get('/:id/reports', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    const result = await getCreatorReports({
      ownerUsername: req.currentUser.username,
      isAdmin: req.isAdmin,
      creatorId: req.params.id,
    });
    if (!result) return res.status(404).json({ error: 'Creator not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/*
  Saved filter segments: a personal bookmark for a filter combination (e.g.
  "Micro creators, 5%+ ER, Puma campaign") so coming back to it later is one
  click instead of resetting every chip and dropdown by hand.

  Always scoped to the LOGGED-IN user, admin included -- unlike the list
  route above, a saved segment is never subject to ?scope=, because "things
  I look for" isn't account data the way the creator rows themselves are.
*/
router.get('/segments', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    const db = getDb();
    const segments = await db.collection('creatorSegments')
      .find({ ownerUsername: req.currentUser.username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ segments: segments.map((s) => ({ id: s._id, name: s.name, filters: s.filters, createdAt: s.createdAt })) });
  } catch (err) {
    next(err);
  }
});

router.post('/segments', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Give this view a name.' });
    if (name.length > 60) return res.status(400).json({ error: 'Name is too long.' });

    // Only the keys this feature actually understands are stored -- never
    // trust the client to hand back an arbitrary object that gets replayed
    // straight into a future query string.
    const raw = (req.body && req.body.filters) || {};
    const filters = {
      search: typeof raw.search === 'string' ? raw.search.slice(0, 200) : '',
      followerTier: typeof raw.followerTier === 'string' ? raw.followerTier : 'all',
      minEr: Number(raw.minEr) || 0,
      sort: typeof raw.sort === 'string' ? raw.sort : 'recent',
      campaignId: typeof raw.campaignId === 'string' ? raw.campaignId : '',
    };

    const db = getDb();
    const segment = {
      _id: new ObjectId().toHexString(),
      ownerUsername: req.currentUser.username,
      name,
      filters,
      createdAt: new Date(),
    };
    await db.collection('creatorSegments').insertOne(segment);
    res.json({ segment: { id: segment._id, name: segment.name, filters: segment.filters, createdAt: segment.createdAt } });
  } catch (err) {
    next(err);
  }
});

router.delete('/segments/:id', requireLogin, requireCreatorDbAccess, async (req, res, next) => {
  try {
    const db = getDb();
    const result = await db.collection('creatorSegments').deleteOne({
      _id: queryId(req.params.id),
      ownerUsername: req.currentUser.username,
    });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Saved view not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
