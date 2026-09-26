const { getDb } = require('../db');

/*
  Overlapping identical reads share one database round trip. A page opens with
  three or four API calls at once (who am I, my stats, my reports), and each of
  them used to look the same account up separately. Only calls that are in
  flight AT THE SAME TIME share; nothing is remembered afterwards, so a read
  that starts after a write always sees that write.
*/
const inflight = new Map();
function coalesce(key, fn) {
  const running = inflight.get(key);
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const findUser = (db, username) => coalesce('user:' + username, () => db.collection('users').findOne({ username }));

async function requireLogin(req, res, next) {
  if (!req.session || !req.session.username) {
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
  }
  // Most routes are mounted as requireLogin, requireChangePasswordCheck, and the
  // second of those calls this again. It used to repeat the whole account lookup.
  if (req.currentUser && req.currentUser.username === req.session.username) return next();

  try {
    const db = getDb();
    const user = await findUser(db, req.session.username);

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
    // Admin's balance is what Apify's remaining allowance can fund, not a stored
    // number. See platformCredits.service.js.
    if (user.role === 'admin') {
      const { getAdminCredits } = require('../services/platformCredits.service');
      req.currentUser = { ...user, credits: await getAdminCredits(), effectiveUsername: user.username };
      return next();
    }

    if (user.teamOwnerUsername) {
      const owner = await findUser(db, user.teamOwnerUsername);
      if (!owner || owner.disabled) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'This team account is no longer available.', code: 'REVOKED' });
      }
      /*
        A platform admin's pool is effectively unlimited (internal runs must
        never be blocked), and every credit spent from it is real money out of
        our pocket. Letting a member inherit that would hand out unlimited
        free usage to anyone linked to an admin. So a link to an admin is void:
        the person is treated as an ordinary, independent account with their
        own plan and credits, and is not shown as a team member.
      */
      if (owner.role === 'admin') {
        req.currentUser = { ...user, effectiveUsername: user.username, teamOwnerUsername: null };
        return next();
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
