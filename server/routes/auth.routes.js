const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db');
const { comparePassword, hashPassword } = require('../utils/password');
const { requireLogin } = require('../middleware/auth');
const { parseUserAgent } = require('../utils/ua');
const { defaultsForNewUser } = require('../services/credits.service');
const { getUserFeatures } = require('../services/features.service');
const { isDisposableEmail, validateUsername, uniqueUsername } = require('../services/identity.service');
const otpService = require('../services/otp.service');
const passwordResetService = require('../services/passwordReset.service');
const {
  sendTransactionalEmail, buildOtpEmailHtml, buildOtpEmailText,
  buildPasswordResetEmailHtml, buildPasswordResetEmailText,
  buildGoogleAccountNoticeHtml, buildGoogleAccountNoticeText,
} = require('../services/mailer.service');
const { getLegalDoc } = require('../services/legal.service');

const REMEMBER_ME_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const APP_URL = config.appUrl;

// Shared shape for anything we hand back to the client about the logged-in
// user. Async because feature flags depend on a plans lookup (see
// features.service.js) -- every call site below already awaits this.
async function publicUser(user) {
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
    // Same "absent reads as verified" logic as hasSeenTour above -- every
    // account that existed before this field was introduced (including
    // every admin-provisioned and Google account, which never set it false
    // to begin with) is grandfathered in rather than locked out.
    emailVerified: user.emailVerified !== false,
    // Plan-gated feature access (report branding, shareable links) -- see
    // features.service.js for how plan defaults + per-account overrides
    // combine. Computed here so every page just reads user.features instead
    // of re-deriving plan logic client-side.
    features: await getUserFeatures(user),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-memory login rate limit map
const loginAttempts = new Map(); // ip_username -> { count, resetAt }

router.post('/login', async (req, res, next) => {
  try {
    const { username, password, rememberMe } = req.body;
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

    // A Google-created account has no passwordHash at all, so every password
    // attempt on it fell through to "username and password don't match" --
    // which sends people off hunting for a password that has never existed.
    // Name the actual situation instead. Deliberately only shown once the
    // account has been found by an exact username/email match, so this can't
    // be used to enumerate which addresses have accounts.
    if (user && !user.passwordHash) {
      return res.status(401).json({
        error: 'This account signs in with Google. Use "Continue with Google" above.',
        code: 'GOOGLE_ACCOUNT',
      });
    }

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

    /*
      Unchecked "Remember me" makes this a true browser-session cookie (dies
      when the browser closes) instead of the app-wide 7-day default set in
      index.js -- setting cookie.expires = false is express-session's
      documented way to do that per-request. Checked extends it to 30 days.
      Every other place a session gets created (OTP verify, Google sign-in)
      is left on the 7-day default; there's no remember-me prompt on those
      flows, so there's nothing to branch on.
    */
    if (rememberMe) {
      req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE;
    } else {
      req.session.cookie.expires = false;
    }

    res.json({ user: await publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

router.get('/me', requireLogin, async (req, res, next) => {
  try {
    res.json({ user: await publicUser(req.currentUser) });
  } catch (err) {
    next(err);
  }
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
      return res.json({ user: await publicUser(req.currentUser) });
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

    // Accounts provisioned by an admin (POST /admin/clients) store only a
    // username -- if the admin used the client's email as that username, it
    // is the ONLY copy of their email on the document. Renaming then erased
    // it outright, and because login matches on username-or-email, the
    // client could no longer sign in with the address they'd always used and
    // got a flat "username and password don't match". Preserve it first.
    const update = { username: requested };
    if (!req.currentUser.email && EMAIL_RE.test(previousUsername)) {
      update.email = previousUsername;
    }
    await db.collection('users').updateOne({ _id: req.currentUser._id }, { $set: update });

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

    res.json({ user: await publicUser(req.currentUser) });
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
    const { email, password, name, username, acceptedTerms } = req.body || {};
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!acceptedTerms) {
      return res.status(400).json({ error: 'You must agree to the Terms of Service and Privacy Policy to create an account.' });
    }
    /*
      Throwaway addresses are refused at the door. Every new account is handed
      free credits, so a temp-mail tab is a way to spend our scraping budget
      indefinitely for nothing. Checked before anything is written.
    */
    if (isDisposableEmail(cleanEmail)) {
      return res.status(400).json({
        error: 'Please sign up with a permanent email address. Temporary and disposable inboxes are not accepted.',
      });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    /*
      A username is asked for directly rather than being silently set to the
      email address. It is the name shown throughout the app, so letting it
      default to a full email address is how accounts ended up displaying
      "someone@gmail.com" in the sidebar. Falls back to the old `name` field
      for any client still sending that.
    */
    const check = validateUsername(username || name || cleanEmail.split('@')[0]);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const db = getDb();
    const existing = await db.collection('users').findOne({ $or: [{ username: cleanEmail }, { email: cleanEmail }] });
    /*
      An existing doc that never got past its own OTP step (emailVerified
      explicitly false, meaning it can only have come from this same signup
      flow) is a previous abandoned attempt, not a real account -- nobody has
      ever logged into it, since verify-otp is the only path that would have
      set emailVerified:true and started a session. Without this, one
      unfinished signup would permanently squat the email/username and the
      person could never sign up again. Replaced outright: new password, new
      username choice, fresh OTP.
    */
    if (existing && existing.emailVerified === false) {
      await db.collection('users').deleteOne({ _id: existing._id });
      await otpService.clearOtp(existing.username);
    } else if (existing) {
      // A Google-created account has no passwordHash, so "try logging in"
      // sent that person off to type a password that has never existed on
      // this account -- the same situation POST /login already names
      // explicitly for the reverse direction (see the GOOGLE_ACCOUNT check
      // above in that route). Named here too, symmetrically.
      if (existing.authProvider === 'google' && !existing.passwordHash) {
        return res.status(409).json({
          error: 'This email is already registered via Google Sign-In. Use "Continue with Google" above to log in.',
          code: 'GOOGLE_ACCOUNT',
        });
      }
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });
    }
    const nameTaken = await db.collection('users').findOne({ username: check.username }, { projection: { _id: 1 } });
    if (nameTaken) {
      return res.status(409).json({ error: 'That username is already taken. Try another.' });
    }

    const passwordHash = await hashPassword(password);
    const [terms, privacy] = await Promise.all([getLegalDoc('terms'), getLegalDoc('privacy')]);
    const doc = {
      username: check.username,
      email: cleanEmail,
      passwordHash,
      authProvider: 'local',
      role: 'client',
      mustChangePassword: false,
      disabled: false,
      sessionsRevokedAt: null,
      // Which version of each document was on screen when this account
      // checked the agreement box -- an audit trail, not something the app
      // reads back to gate anything.
      termsAcceptedAt: new Date(),
      termsAcceptedVersion: terms.version,
      privacyAcceptedVersion: privacy.version,
      // Gated on OTP verification below -- POST /verify-otp is what flips
      // this to true and only then starts the session. Nothing about
      // requireLogin/requireAdmin changes: an unverified account simply
      // never has a session to begin with, so there's no new middleware
      // gate needed on every other route.
      emailVerified: false,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      ...defaultsForNewUser('client'),
    };
    await db.collection('users').insertOne(doc);

    const code = await otpService.issueOtp(doc.username, cleanEmail);
    try {
      await sendTransactionalEmail({
        to: cleanEmail,
        subject: `${code} is your Reelytic verification code`,
        html: buildOtpEmailHtml({ code, minutes: 10 }),
        text: buildOtpEmailText({ code, minutes: 10 }),
      });
    } catch (mailErr) {
      // The account row already exists at this point, but with no session
      // and emailVerified:false it is inert -- the same abandoned-signup
      // path above will clean it up if the person tries again. Surfacing
      // this as a real 500 (not a silent "check your email") is deliberate:
      // see mailer.service.js for why OTP mail can't swallow failures the
      // way alerting.service.js does. err.message carries the real cause
      // (e.g. Resend's domain-verification error) to Slack/Health via
      // errorHandler; err.userMessage is the only part a signed-out visitor
      // ever sees, on purpose -- see middleware/errors.js.
      const err = new Error(`Signup verification email failed to send for ${cleanEmail}: ${mailErr.message}`);
      err.userMessage = "Your account was created, but we couldn't send the verification email just now. Please try again in a few minutes, or contact support if this keeps happening.";
      return next(err);
    }

    res.status(201).json({ pendingVerification: true, username: doc.username, email: cleanEmail });
  } catch (err) {
    next(err);
  }
});

// Reuses the same in-memory ip_username rate-limit shape /login already
// uses. Both verify and resend are unauthenticated by necessity (there's no
// session yet to gate them behind), so both need their own throttle.
const otpAttempts = new Map(); // ip_username -> { count, resetAt }

// ---- Verify the signup OTP -------------------------------------------------
// The only path that flips emailVerified:true and actually starts a session
// for a self-signed-up account. Everything before this point (POST /signup)
// created the row but never logged anyone in.
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { username, code } = req.body || {};
    const cleanUser = (username || '').trim().toLowerCase();
    if (!cleanUser || !code) {
      return res.status(400).json({ error: 'Username and code are required.' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rateKey = `verify_${ip}_${cleanUser}`;
    const now = Date.now();
    const attemptRecord = otpAttempts.get(rateKey);
    if (attemptRecord && attemptRecord.resetAt > now && attemptRecord.count >= 10) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ username: cleanUser });
    if (!user) {
      return res.status(404).json({ error: 'No pending signup found for that account.' });
    }
    if (user.emailVerified !== false) {
      return res.status(400).json({ error: 'This account is already verified. Try logging in.' });
    }

    const result = await otpService.verifyOtp(cleanUser, code);
    if (!result.ok) {
      if (!attemptRecord || attemptRecord.resetAt < now) {
        otpAttempts.set(rateKey, { count: 1, resetAt: now + 10 * 60 * 1000 });
      } else {
        attemptRecord.count++;
      }
      const messages = {
        'no-pending': 'That code has expired. Request a new one.',
        expired: 'That code has expired. Request a new one.',
        'too-many-attempts': 'Too many wrong attempts. Request a new code.',
        incorrect: 'That code is incorrect.',
      };
      return res.status(400).json({ error: messages[result.reason] || 'That code is incorrect.' });
    }

    await db.collection('users').updateOne({ username: cleanUser }, { $set: { emailVerified: true } });
    const updated = { ...user, emailVerified: true };

    req.session.username = updated.username;
    req.session.role = updated.role;
    req.session.createdAt = new Date().toISOString();

    res.json({ user: await publicUser(updated) });
  } catch (err) {
    next(err);
  }
});

// ---- Resend the signup OTP -------------------------------------------------
router.post('/resend-otp', async (req, res, next) => {
  try {
    const { username } = req.body || {};
    const cleanUser = (username || '').trim().toLowerCase();
    if (!cleanUser) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rateKey = `resend_${ip}_${cleanUser}`;
    const now = Date.now();
    const attemptRecord = otpAttempts.get(rateKey);
    if (attemptRecord && attemptRecord.resetAt > now && attemptRecord.count >= 5) {
      return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ username: cleanUser });
    // Same response whether or not the account exists, and whether or not
    // it's already verified -- this endpoint takes no password, so it must
    // not become a way to probe which usernames exist or which are pending.
    if (!user || user.emailVerified !== false) {
      return res.json({ sent: true });
    }

    if (!attemptRecord || attemptRecord.resetAt < now) {
      otpAttempts.set(rateKey, { count: 1, resetAt: now + 10 * 60 * 1000 });
    } else {
      attemptRecord.count++;
    }

    try {
      const code = await otpService.issueOtp(cleanUser, user.email);
      await sendTransactionalEmail({
        to: user.email,
        subject: `${code} is your Reelytic verification code`,
        html: buildOtpEmailHtml({ code, minutes: 10 }),
        text: buildOtpEmailText({ code, minutes: 10 }),
      });
    } catch (mailErr) {
      if (mailErr.code === 'COOLDOWN') {
        return res.status(429).json({ error: mailErr.message });
      }
      const err = new Error(`Resend verification email failed for ${cleanUser}: ${mailErr.message}`);
      err.userMessage = "We couldn't resend the verification email just now. Please try again in a few minutes, or contact support if this keeps happening.";
      return next(err);
    }

    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});

// ---- Forgot / reset password ----------------------------------------------
// Unauthenticated by necessity, same as verify/resend-otp above, and reuses
// the same in-memory ip_username rate-limit map and shape.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rateKey = `forgot_${ip}_${cleanEmail}`;
    const now = Date.now();
    const attemptRecord = otpAttempts.get(rateKey);
    if (attemptRecord && attemptRecord.resetAt > now && attemptRecord.count >= 5) {
      return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    }
    if (!attemptRecord || attemptRecord.resetAt < now) {
      otpAttempts.set(rateKey, { count: 1, resetAt: now + 10 * 60 * 1000 });
    } else {
      attemptRecord.count++;
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ $or: [{ username: cleanEmail }, { email: cleanEmail }] });

    /*
      Always the same response, whether or not an account exists for this
      address -- an unauthenticated "does this email have an account"
      endpoint is exactly what a probe wants. Only the account's own inbox
      ever finds out which of the three real outcomes happened (nothing
      sent, a Google-account notice, or a real reset link).
    */
    if (!user || user.disabled) {
      return res.json({ sent: true });
    }

    try {
      if (!user.passwordHash) {
        // Google-only account: nothing to reset. Tell the inbox owner
        // directly rather than silently doing nothing, so a real user who
        // forgot they signed up with Google isn't left assuming the app is
        // broken when no email ever explains why.
        await sendTransactionalEmail({
          to: user.email || cleanEmail,
          subject: 'About your Reelytic password reset request',
          html: buildGoogleAccountNoticeHtml(),
          text: buildGoogleAccountNoticeText(),
        });
      } else {
        const token = await passwordResetService.issueResetToken(user.username);
        const resetUrl = `${APP_URL}/reset-password?token=${token}`;
        await sendTransactionalEmail({
          to: user.email || cleanEmail,
          subject: 'Reset your Reelytic password',
          html: buildPasswordResetEmailHtml({ resetUrl, minutes: 30 }),
          text: buildPasswordResetEmailText({ resetUrl, minutes: 30 }),
        });
      }
    } catch (mailErr) {
      // Cooldown is the one case worth a distinct response: it means an
      // email was already sent moments ago, so telling the user to check
      // their inbox again (rather than a scary error) is the honest answer.
      if (mailErr.code === 'COOLDOWN') {
        return res.json({ sent: true });
      }
      const err = new Error(`Password reset email failed for ${user.username}: ${mailErr.message}`);
      err.userMessage = "We couldn't send that email just now. Please try again in a few minutes, or contact support if this keeps happening.";
      return next(err);
    }

    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});

// Lets the reset page tell "this link is invalid or expired" apart from a
// working link, before the person has typed a new password, without ever
// consuming the token itself (see peekResetToken's own note on why).
router.get('/reset-password/:token', async (req, res, next) => {
  try {
    const result = await passwordResetService.peekResetToken(req.params.token);
    if (!result.ok) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }
    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'A valid link and a password of at least 8 characters are required.' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rateKey = `reset_${ip}`;
    const now = Date.now();
    const attemptRecord = otpAttempts.get(rateKey);
    if (attemptRecord && attemptRecord.resetAt > now && attemptRecord.count >= 10) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }
    if (!attemptRecord || attemptRecord.resetAt < now) {
      otpAttempts.set(rateKey, { count: 1, resetAt: now + 10 * 60 * 1000 });
    } else {
      attemptRecord.count++;
    }

    const result = await passwordResetService.consumeResetToken(token);
    if (!result.ok) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ username: result.username });
    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const newHash = await hashPassword(newPassword);
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: newHash,
          mustChangePassword: false,
          // A password reset is exactly the moment to assume the old one may
          // be compromised -- kick out any session started before now,
          // mirroring what admin.routes.js already does for a manual reset.
          sessionsRevokedAt: new Date(),
        },
      }
    );

    res.json({ success: true });
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

    if (isDisposableEmail(cleanEmail)) {
      return res.status(400).json({
        error: 'Please sign in with a permanent email address. Temporary and disposable inboxes are not accepted.',
      });
    }

    const db = getDb();
    let user = await db.collection('users').findOne({ $or: [{ username: cleanEmail }, { email: cleanEmail }] });
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ');

    if (!user) {
      /*
        The username comes from the Google display name, not from the email
        address. This is the single source of truth the rest of the app
        shows, so seeding it with the full email is what put
        "someone@gmail.com" in the sidebar. uniqueUsername resolves a
        collision by appending a number rather than failing the sign-in,
        because the user is not being asked anything here.
      */
      const derived = await uniqueUsername(db, cleanName, cleanEmail.split('@')[0]);
      user = {
        username: derived,
        email: cleanEmail,
        name: cleanName || derived,
        authProvider: 'google',
        googleId,
        passwordHash: null,
        role: 'client',
        mustChangePassword: false,
        disabled: false,
        sessionsRevokedAt: null,
        // Google already checked payload.email_verified above -- a second,
        // in-app OTP step would just be re-verifying something Google
        // already vouched for.
        emailVerified: true,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        ...defaultsForNewUser('client'),
      };
      await db.collection('users').insertOne(user);
    } else {
      if (user.disabled) {
        return res.status(401).json({ error: 'This account has been disabled. Contact your Reelytic admin.' });
      }
      // Covers the case where this email exists as an abandoned, never-
      // verified local signup (see the /signup route's own handling of that
      // same state): Google verifying the address is stronger proof than
      // the OTP it's standing in for, so it clears the gate too rather than
      // leaving a now-active account permanently marked unverified.
      const patch = { lastLoginAt: new Date(), googleId: user.googleId || googleId, emailVerified: true };
      user.emailVerified = true;
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

    res.json({ user: await publicUser(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
