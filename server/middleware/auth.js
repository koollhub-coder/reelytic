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

    req.currentUser = user;
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
