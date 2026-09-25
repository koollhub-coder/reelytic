const { getDb } = require('../db');

async function requireLogin(req, res, next) {
  if (!req.session || !req.session.username) {
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
  }

  try {
    const db = getDb();
    const user = await db.collection('users').findOne({ username: req.session.username });

    if (!user || user.disabled) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Account disabled or not found', code: 'REVOKED' });
    }

    if (user.sessionsRevokedAt && new Date(req.session.createdAt || 0) < new Date(user.sessionsRevokedAt)) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session revoked by administrator', code: 'REVOKED' });
    }

    /*
      Team seats: a member logs in with their own username/password, but
      every report, campaign, and credit they touch belongs to the team
      owner's account, not their own. `effectiveUsername` is the one field
      every data-ownership check in the route files was changed to use
      instead of `.username` -- see jobs/campaigns/creators/export/me/
      settings routes. Nothing in jobEngine.service.js, ledger.service.js,
      or credits.service.js had to change: they only ever act on whatever
      ownerUsername string a route handed them, and a job/campaign is now
      stamped with the OWNER's username at creation time, so billing and
      the crash-safe ledger invariant are untouched.

      Plan/credits/featureOverrides are also resolved from the owner's own
      document here, not the member's -- a member's own user doc carries
      none of those fields, so every existing hasFeature()/publicUser() call
      site keeps working unmodified: it just reads req.currentUser.plan the
      same way it always did, and that now happens to be the owner's plan.
    */
    if (user.teamOwnerUsername) {
      const owner = await db.collection('users').findOne({ username: user.teamOwnerUsername });
      if (!owner || owner.disabled) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'This team account is no longer available.', code: 'REVOKED' });
      }
      req.currentUser = {
        ...user,
        plan: owner.plan,
        credits: owner.credits,
        featureOverrides: owner.featureOverrides,
        effectiveUsername: owner.username,
        teamOwnerName: owner.name || owner.username,
      };
    } else {
      req.currentUser = { ...user, effectiveUsername: user.username };
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal authentication check error' });
  }
}

// async function requireAdmin(req, res, next) {
//   await requireLogin(req, res, async () => {
//     if (req.currentUser.role !== 'admin') {
//       return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
//     }
//     if (!req.session.devMode) {
//       return res.status(403).json({ error: 'Developer unlock required', code: 'DEV_UNLOCK_REQUIRED' });
//     }
//     next();
//   });
// }
async function requireAdmin(req, res, next) {
  await requireLogin(req, res, async () => {
    if (req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    }
    next();
  });
}

async function requireChangePasswordCheck(req, res, next) {
  await requireLogin(req, res, () => {
    if (req.currentUser.mustChangePassword && req.path !== '/auth/change-password' && req.path !== '/auth/logout' && req.path !== '/auth/me') {
      return res.status(403).json({ error: 'Must change password first', code: 'MUST_CHANGE_PASSWORD' });
    }
    next();
  });
}

module.exports = { requireLogin, requireAdmin, requireChangePasswordCheck };
