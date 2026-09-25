const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../db');
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');
const { validateUsername } = require('../services/identity.service');
const { hasFeature, getUserFeatures } = require('../services/features.service');
const { DEFAULT_PLANS } = require('./pricing.routes');
const { sendTransactionalEmail, buildTeamInviteEmailHtml, buildTeamInviteEmailText } = require('../services/mailer.service');

/*
  Team seats: one paying account (the owner) can invite other logins that
  share its plan, credits, and every report/campaign it owns. See
  middleware/auth.js for how a member's session resolves to the owner's
  data (effectiveUsername) -- this file only ever manages the invite/seat
  bookkeeping itself, never touches jobs/campaigns/credits directly.

  Deliberately simple: two roles only (owner, member), no per-member
  permissions. A member can do everything the owner's plan allows except
  manage billing (see billing.routes.js requireAccountOwner) and manage the
  team itself (every route below past the two public ones is owner-only).
*/

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const APP_URL = config.appUrl;

async function resolveOwnerMaxSeats(ownerUser) {
  const db = getDb();
  const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
  const plans = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
  const plan = plans.find((p) => p.id === ownerUser.plan);
  // Admin/unlimited accounts (no matching plan row) get an effectively
  // unlimited seat count rather than the default of 1 -- 1 would otherwise
  // lock an admin-provisioned "unlimited" account out of using this at all.
  if (ownerUser.role === 'admin' || ownerUser.plan === 'unlimited') return 999;
  return (plan && typeof plan.maxTeamSeats === 'number') ? plan.maxTeamSeats : 1;
}

function requireOwner(req, res) {
  if (req.currentUser.username !== req.currentUser.effectiveUsername) {
    res.status(403).json({ error: 'Only the account owner can manage the team.' });
    return false;
  }
  return true;
}

// The full picture for the Settings page: the owner sees every seat and
// every pending invite; a member sees just who owns the workspace they're
// in and how many seats are in use, nothing they could act on.
router.get('/', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const isOwner = req.currentUser.username === req.currentUser.effectiveUsername;
    const ownerUsername = req.currentUser.effectiveUsername;
    const ownerUser = isOwner ? req.currentUser : await db.collection('users').findOne({ username: ownerUsername });
    if (!ownerUser) return res.status(404).json({ error: 'Team owner not found' });

    const members = await db.collection('users')
      .find({ teamOwnerUsername: ownerUsername })
      .project({ username: 1, name: 1, email: 1, createdAt: 1 })
      .toArray();

    const maxSeats = await resolveOwnerMaxSeats(ownerUser);
    const seats = [
      { username: ownerUser.username, name: ownerUser.name || ownerUser.username, email: ownerUser.email || null, isOwner: true, joinedAt: ownerUser.createdAt || null },
      ...members.map((m) => ({ username: m.username, name: m.name || m.username, email: m.email || null, isOwner: false, joinedAt: m.createdAt || null })),
    ];

    if (!isOwner) {
      return res.json({
        isOwner: false,
        ownerName: ownerUser.name || ownerUser.username,
        seatCount: seats.length,
        maxSeats,
      });
    }

    const pendingInvites = await db.collection('teamInvites')
      .find({ teamOwnerUsername: ownerUsername, status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      isOwner: true,
      seats,
      seatCount: seats.length,
      maxSeats,
      pendingInvites: pendingInvites.map((i) => ({
        token: i.token,
        email: i.email,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/invite', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    if (!(await hasFeature(req.currentUser, 'teamSeats'))) {
      return res.status(403).json({ error: 'Team seats aren\'t available on your current plan. Upgrade to invite teammates.', code: 'FEATURE_LOCKED' });
    }

    const cleanEmail = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const db = getDb();
    const ownerUsername = req.currentUser.username;

    const [memberCount, pendingCount, maxSeats] = await Promise.all([
      db.collection('users').countDocuments({ teamOwnerUsername: ownerUsername }),
      db.collection('teamInvites').countDocuments({ teamOwnerUsername: ownerUsername, status: 'pending' }),
      resolveOwnerMaxSeats(req.currentUser),
    ]);
    // +1 counts the owner's own seat.
    if (memberCount + pendingCount + 1 >= maxSeats) {
      return res.status(400).json({ error: `Your plan includes ${maxSeats} seat${maxSeats === 1 ? '' : 's'}. Remove someone or upgrade your plan to invite another.` });
    }

    const existingUser = await db.collection('users').findOne({ $or: [{ username: cleanEmail }, { email: cleanEmail }] });
    if (existingUser) {
      return res.status(409).json({ error: 'That email already has a Reelytic account.' });
    }
    const existingInvite = await db.collection('teamInvites').findOne({ teamOwnerUsername: ownerUsername, email: cleanEmail, status: 'pending' });
    if (existingInvite) {
      return res.status(409).json({ error: 'You already have a pending invite out to that email.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const invite = {
      token,
      email: cleanEmail,
      teamOwnerUsername: ownerUsername,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
    };
    await db.collection('teamInvites').insertOne(invite);

    const acceptUrl = `${APP_URL}/team/accept?t=${token}`;
    try {
      await sendTransactionalEmail({
        to: cleanEmail,
        subject: `${req.currentUser.name || ownerUsername} invited you to their Reelytic team`,
        html: buildTeamInviteEmailHtml({ inviterName: req.currentUser.name || ownerUsername, acceptUrl }),
        text: buildTeamInviteEmailText({ inviterName: req.currentUser.name || ownerUsername, acceptUrl }),
      });
    } catch (mailErr) {
      await db.collection('teamInvites').deleteOne({ token });
      const err = new Error(`Team invite email failed to send for ${cleanEmail}: ${mailErr.message}`);
      err.userMessage = "Couldn't send that invite email just now. Please try again in a few minutes.";
      return next(err);
    }

    res.json({ success: true, invite: { token: invite.token, email: invite.email, createdAt: invite.createdAt, expiresAt: invite.expiresAt } });
  } catch (err) {
    next(err);
  }
});

router.delete('/invite/:token', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    const db = getDb();
    const result = await db.collection('teamInvites').deleteOne({
      token: req.params.token,
      teamOwnerUsername: req.currentUser.username,
      status: 'pending',
    });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Invite not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Removes a seat -- the member's login still exists (their reports of their
// own, like the demo sample, are theirs), it just stops sharing the owner's
// plan/credits/data and drops back to a standalone free account.
router.delete('/:username', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    const db = getDb();
    const target = await db.collection('users').findOne({ username: req.params.username, teamOwnerUsername: req.currentUser.username });
    if (!target) return res.status(404).json({ error: 'That person is not on your team.' });

    await db.collection('users').updateOne(
      { username: req.params.username },
      { $unset: { teamOwnerUsername: '' }, $set: { plan: 'free', credits: 0 } }
    );
    // Ends any session they currently have open under the old shared plan,
    // same mechanism admin.routes.js already uses to force a re-login.
    await db.collection('users').updateOne({ username: req.params.username }, { $set: { sessionsRevokedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---- Public: invite acceptance (no session yet) ---------------------------

router.get('/invite/:token', async (req, res, next) => {
  try {
    const db = getDb();
    const invite = await db.collection('teamInvites').findOne({ token: req.params.token, status: 'pending' });
    if (!invite || new Date(invite.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'This invite is invalid or has expired.' });
    }
    const owner = await db.collection('users').findOne({ username: invite.teamOwnerUsername });
    res.json({ email: invite.email, ownerName: (owner && (owner.name || owner.username)) || 'a Reelytic account' });
  } catch (err) {
    next(err);
  }
});

router.post('/invite/:token/accept', async (req, res, next) => {
  try {
    const { name, username, password } = req.body || {};
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const db = getDb();
    const invite = await db.collection('teamInvites').findOne({ token: req.params.token, status: 'pending' });
    if (!invite || new Date(invite.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'This invite is invalid or has expired.' });
    }

    const check = validateUsername(username || name || invite.email.split('@')[0]);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const existing = await db.collection('users').findOne({ $or: [{ username: check.username }, { email: invite.email }] });
    if (existing) return res.status(409).json({ error: 'That username or email is already in use.' });

    const passwordHash = await hashPassword(password);
    const doc = {
      username: check.username,
      email: invite.email,
      name: (name || '').trim() || null,
      passwordHash,
      authProvider: 'local',
      role: 'client',
      teamOwnerUsername: invite.teamOwnerUsername,
      // No plan/credits of their own -- resolved live from the owner every
      // request (see middleware/auth.js). These are just an inert fallback
      // in case the owner relationship is ever removed later.
      plan: 'free',
      credits: 0,
      mustChangePassword: false,
      disabled: false,
      sessionsRevokedAt: null,
      emailVerified: true, // proven by receiving and clicking the invite link
      hasSeenTour: true, // the owner's workspace already has real data; skip the empty-account intro
      createdAt: new Date(),
      lastLoginAt: new Date(),
    };
    await db.collection('users').insertOne(doc);
    await db.collection('teamInvites').updateOne({ token: req.params.token }, { $set: { status: 'accepted', acceptedAt: new Date() } });

    req.session.username = doc.username;
    req.session.role = doc.role;
    req.session.createdAt = new Date().toISOString();

    // Mirrors middleware/auth.js's member-merge so this first response
    // already reflects the owner's plan/credits, not the inert 'free'/0
    // fallback stamped onto the member's own doc -- the very next /auth/me
    // call would show the same thing anyway, this just avoids a one-frame
    // flash of "Free plan, 0 credits" right after accepting an invite.
    const owner = await db.collection('users').findOne({ username: invite.teamOwnerUsername });
    const effective = owner ? { ...doc, plan: owner.plan, credits: owner.credits, featureOverrides: owner.featureOverrides } : doc;

    res.status(201).json({
      user: {
        username: doc.username,
        role: doc.role,
        mustChangePassword: false,
        credits: effective.credits || 0,
        plan: effective.plan || 'free',
        email: doc.email,
        name: doc.name,
        hasSeenTour: true,
        emailVerified: true,
        features: await getUserFeatures(effective),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
