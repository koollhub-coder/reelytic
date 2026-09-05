const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { hasFeature } = require('../services/features.service');
const { searchAnalyzedCreators } = require('../services/creatorDb.service');

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
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const isAdmin = req.currentUser.role === 'admin';
    if (!isAdmin && !(await hasFeature(req.currentUser, 'creatorDatabase'))) {
      return res.status(403).json({ error: 'The creator database isn\'t available on your current plan. Upgrade to Starter, Pro or Agency to unlock it.', code: 'FEATURE_LOCKED' });
    }

    // Admin sees every account's creators by default (the platform-wide
    // view this was built for) but can scope back to just their own with
    // ?scope=mine, same as the rest of the admin screens. A non-admin's
    // scope is always their own account -- the query string is simply
    // never consulted for them.
    const wantsAll = isAdmin && req.query.scope !== 'mine';

    const { creators, nextCursor } = await searchAnalyzedCreators({
      ownerUsername: req.currentUser.username,
      isAdmin: wantsAll,
      search: req.query.search,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });

    res.json({ creators, nextCursor });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
