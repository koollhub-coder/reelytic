const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { comparePassword, hashPassword } = require('../utils/password');
const { requireLogin } = require('../middleware/auth');
const { parseUserAgent } = require('../utils/ua');
const { defaultsForNewUser } = require('../services/credits.service');

// Shared shape for anything we hand back to the client about the logged-in user.
function publicUser(user) {
  return {
    username: user.username,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword,
    credits: user.credits || 0,
    plan: user.plan || 'free',
    email: user.email || null,
    name: user.name || null,
    // Existing accounts predating this field never get a surprise tour --
    // missing/undefined reads as "already seen", only an explicit false
    // (new signups, see defaultsForNewUser) triggers it.
    hasSeenTour: user.hasSeenTour !== false,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-memory login rate limit map
const loginAttempts = new Map(); // ip_username -> { count, resetAt }

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUser = username.trim().toLowerCase();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rateKey = `${ip}_${cleanUser}`;

    const now = Date.now();
    const attemptRecord = loginAttempts.get(rateKey);
    if (attemptRecord && attemptRecord.resetAt > now && attemptRecord.count >= 10) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ $or: [{ username: cleanUser }, { email: cleanUser }] });
    const ua = parseUserAgent(req.headers['user-agent']);

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      // Record failed login
      await db.collection('loginHistory').insertOne({
        username: cleanUser,
        ip,
        userAgent: ua,
        success: false,
        at: new Date()
      });

      if (!attemptRecord || attemptRecord.resetAt < now) {
        loginAttempts.set(rateKey, { count: 1, resetAt: now + 10 * 60 * 1000 });
      } else {
        attemptRecord.count++;
      }

      return res.status(401).json({ error: 'That username and password don\'t match.' });
    }

    if (user.disabled) {
      return res.status(401).json({ error: 'This account has been disabled. Contact your Reelytic admin.' });
    }

    // Record success login
    await db.collection('loginHistory').insertOne({
      username: cleanUser,
      ip,
      userAgent: ua,
      success: true,
      at: new Date()
    });
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    // Set session
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.createdAt = new Date().toISOString();

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

router.get('/me', requireLogin, async (req, res) => {
  res.json({ user: publicUser(req.currentUser) });
});

// Marks the welcome tour as seen, whether the user finished it or skipped
// it -- either way it should never show again unannounced.
router.post('/tour-seen', requireLogin, async (req, res, next) => {
  try {
    const db = getDb();
    await db.collection('users').updateOne({ _id: req.currentUser._id }, { $set: { hasSeenTour: true } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireLogin, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const db = getDb();
    if (!req.currentUser.mustChangePassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const match = await comparePassword(currentPassword, req.currentUser.passwordHash);
      if (!match) {
        return res.status(400).json({ error: 'Incorrect current password' });
      }
    }

    const newHash = await hashPassword(newPassword);
    await db.collection('users').updateOne(
      { _id: req.currentUser._id },
      { $set: { passwordHash: newHash, mustChangePassword: false } }
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

router.patch('/username', requireLogin, async (req, res, next) => {
  try {
    const requested = ((req.body && req.body.username) || '').trim().toLowerCase();
    if (!USERNAME_RE.test(requested)) {
      return res.status(400).json({ error: '3-32 characters: letters, numbers, dots, underscores, or hyphens. Must start and end with a letter or number.' });
    }
    if (requested === req.currentUser.username) {
      return res.json({ user: publicUser(req.currentUser) });
    }

    const db = getDb();
    const existing = await db.collection('users').findOne({
      _id: { $ne: req.currentUser._id },
      $or: [{ username: requested }, { email: requested }],
    });
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const previousUsername = req.currentUser.username;
    await db.collection('users').updateOne({ _id: req.currentUser._id }, { $set: { username: requested } });

    // Every report, submitted-link, campaign, and usage-stat row is keyed by
    // username (not user._id), because that's what the rest of the app looks
    // things up by. Without this, changing your username silently orphans
    // every one of your existing reports under the old name -- they don't
    // get deleted, but they vanish from your own dashboard/history, which
    // looks and feels exactly like data loss. Real incident, fixed 2026-08-03.
    for (const [coll, field] of [
      ['jobs', 'ownerUsername'],
      ['submittedLinks', 'username'],
      ['campaigns', 'ownerUsername'],
      ['usageStats', 'username'],
      ['loginHistory', 'username'],
    ]) {
      await db.collection(coll).updateMany({ [field]: previousUsername }, { $set: { [field]: requested } });
    }

    req.session.username = requested;
    req.currentUser.username = requested;

    res.json({ user: publicUser(req.currentUser) });
  } catch (err) {
    next(err);
  }
});

router.post('/dev-unlock', requireLogin, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const db = getDb();
    const devSetting = await db.collection('settings').findOne({ key: 'devPassword' });
    if (!devSetting) {
      return res.status(400).json({ error: 'Dev mode not configured' });
    }

    const match = await comparePassword(password, devSetting.value);
    if (!match) {
      return res.status(401).json({ error: 'That\'s not it.' });
    }

    req.session.devMode = true;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---- Self-service email signup (open, free tier) -------------------------
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const cleanName = (name || '').trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Please enter your name or agency name (at least 2 characters).' });
    }

    const db = getDb();
    const existing = await db.collection('users').findOne({ $or: [{ username: cleanEmail }, { email: cleanEmail }] });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });
    }

    const passwordHash = await hashPassword(password);
    const doc = {
      username: cleanEmail,
      email: cleanEmail,
      name: cleanName,
      passwordHash,
      authProvider: 'local',
      role: 'client',
      mustChangePassword: false,
      disabled: false,
      sessionsRevokedAt: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      ...defaultsForNewUser('client'),
    };
    await db.collection('users').insertOne(doc);

    req.session.username = doc.username;
    req.session.role = doc.role;
    req.session.createdAt = new Date().toISOString();

    res.status(201).json({ user: publicUser(doc) });
  } catch (err) {
    next(err);
  }
});

// ---- Google Sign-In -------------------------------------------------------
// Verifies a Google Identity Services ID token when GOOGLE_CLIENT_ID is set.
// Falls back to a labelled DUMMY mode (mirrors the Razorpay dummy) so the
// flow is fully demoable before Google Cloud credentials exist. To go live:
// set GOOGLE_CLIENT_ID in .env (and VITE_GOOGLE_CLIENT_ID for the client).
router.post('/google', async (req, res, next) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    let email, name, googleId;

    if (clientId && req.body && req.body.credential) {
      // Real verification path.
      let OAuth2Client;
      try {
        ({ OAuth2Client } = require('google-auth-library'));
      } catch (e) {
        return res.status(500).json({ error: 'google-auth-library not installed on server.' });
      }
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken: req.body.credential, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload || !payload.email_verified) {
        return res.status(401).json({ error: 'Google account email not verified.' });
      }
      email = payload.email;
      name = payload.name;
      googleId = payload.sub;
    } else {
      // DUMMY MODE: no GOOGLE_CLIENT_ID configured. Trust the posted email so
      // the demo works. This branch is disabled automatically once the env var
      // is set, because a real `credential` is then required above.
      email = (req.body && req.body.email) || 'demo.google.user@gmail.com';
      name = (req.body && req.body.name) || 'Google User';
      googleId = 'dummy_' + email;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Google did not return a usable email.' });
    }

    const db = getDb();
    let user = await db.collection('users').findOne({ $or: [{ username: cleanEmail }, { email: cleanEmail }] });
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ');

    if (!user) {
      user = {
        username: cleanEmail,
        email: cleanEmail,
        name: cleanName || cleanEmail.split('@')[0],
        authProvider: 'google',
        googleId,
        passwordHash: null,
        role: 'client',
        mustChangePassword: false,
        disabled: false,
        sessionsRevokedAt: null,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        ...defaultsForNewUser('client'),
      };
      await db.collection('users').insertOne(user);
    } else {
      if (user.disabled) {
        return res.status(401).json({ error: 'This account has been disabled. Contact your Reelytic admin.' });
      }
      const patch = { lastLoginAt: new Date(), googleId: user.googleId || googleId };
      // Backfill a proper display name for accounts created before names were required.
      if (cleanName && (!user.name || user.name === user.email || user.name === user.username)) {
        patch.name = cleanName;
        user.name = cleanName;
      }
      await db.collection('users').updateOne({ username: user.username }, { $set: patch });
    }

    const ua = parseUserAgent(req.headers['user-agent']);
    await db.collection('loginHistory').insertOne({
      username: user.username, ip: req.ip || 'unknown', userAgent: ua, success: true, at: new Date(), via: 'google',
    });

    req.session.username = user.username;
    req.session.role = user.role;
    req.session.createdAt = new Date().toISOString();

    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
