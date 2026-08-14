const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { listErrors, unresolvedCount, resolveError } = require('../services/errorTracking.service');
const { getDb } = require('../db');
const { hashPassword, generateTempPassword } = require('../utils/password');
const { parseUserAgent } = require('../utils/ua');
const config = require('../config');
const { DEFAULT_PLANS } = require('./pricing.routes');
const { FEATURE_KEYS } = require('../services/features.service');
const { defaultsForNewUser, adjustCredits, setCredits, getBalance } = require('../services/credits.service');
const { generateClientLedgerExcel, generateClientLedgerCsv } = require('../services/export.service');
const { getProfilePipelineMode, setProfilePipelineMode, PROFILE_PIPELINE_INFO, getV2FetchDepth, setV2FetchDepth } = require('../services/profilePipeline.service');
const { getCacheTtlDays, setProfileCacheTtlDays, DEFAULT_PROFILE_CACHE_TTL_DAYS } = require('../services/cache.service');
const { getReelPipelineMode, setReelPipelineMode, REEL_PIPELINE_INFO } = require('../services/reelPipeline.service');
const { fallbackCostUsd } = require('../services/costEstimate.service');

router.get('/overview', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const reelJobs = await db.collection('jobs').countDocuments({ type: 'reel' });
    const profileJobs = await db.collection('jobs').countDocuments({ type: 'profile' });
    const linksProcessed = await db.collection('submittedLinks').countDocuments({});
    const successLinks = await db.collection('submittedLinks').countDocuments({ result: 'success' });
    const successRate = linksProcessed > 0 ? Math.round((successLinks / linksProcessed) * 100) : 100;

    const runningJobs = await db.collection('jobs').find({ status: 'running' }).toArray();
    const recentLogins = await db.collection('loginHistory').find({}).sort({ at: -1 }).limit(10).toArray();

    const now = new Date();
    const days14 = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayStart = new Date(dateStr + 'T00:00:00.000Z');
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
      const [reels, profiles] = await Promise.all([
        db.collection('submittedLinks').countDocuments({ type: 'reel', at: { $gte: dayStart, $lte: dayEnd } }),
        db.collection('submittedLinks').countDocuments({ type: 'profile', at: { $gte: dayStart, $lte: dayEnd } }),
      ]);
      days14.push({ date: dateStr, reels, profiles, count: reels + profiles });
    }

    res.json({
      stats: { reelJobs, profileJobs, linksProcessed, successRate },
      runningJobs: runningJobs.map(j => ({ id: j._id, owner: j.ownerUsername, type: j.type, counts: j.counts, cursor: j.cursor })),
      recentLogins,
      activity14Days: days14
    });
  } catch (err) {
    next(err);
  }
});

router.get('/clients', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const raw = await db.collection('users').find({}).toArray();
    const users = raw.map(({ passwordHash, ...rest }) => rest);
    res.json({ clients: users });
  } catch (err) {
    next(err);
  }
});

router.post('/clients', requireAdmin, async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });
    const cleanUser = username.trim().toLowerCase();

    const db = getDb();
    const existing = await db.collection('users').findOne({ username: cleanUser });
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    await db.collection('users').insertOne({
      username: cleanUser,
      // Admins routinely provision clients using their email as the username.
      // Storing it in `email` as well means the address survives a later
      // username change (see PATCH /auth/username) and stays a valid login
      // handle, instead of existing only as the username that just got
      // renamed out from under them.
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanUser) ? cleanUser : null,
      passwordHash,
      role: 'client',
      mustChangePassword: true,
      disabled: false,
      sessionsRevokedAt: null,
      createdAt: new Date(),
      lastLoginAt: null,
      ...defaultsForNewUser('client')
    });

    res.json({ success: true, tempPassword, username: cleanUser });
  } catch (err) {
    next(err);
  }
});

router.patch('/clients/:username', requireAdmin, async (req, res, next) => {
  try {
    const targetUser = req.params.username.toLowerCase();
    const { disabled, resetPassword, revokeSessions, creditsDelta, setCredits: setCreditsTo, plan, resetTour, featureOverrides } = req.body;
    const db = getDb();

    const update = {};
    let tempPassword = null;
    let newBalance;

    if (typeof disabled === 'boolean') {
      update.disabled = disabled;
      update.sessionsRevokedAt = new Date();
    }
    if (revokeSessions) {
      update.sessionsRevokedAt = new Date();
    }
    if (resetPassword) {
      tempPassword = generateTempPassword();
      update.passwordHash = await hashPassword(tempPassword);
      update.mustChangePassword = true;
      update.sessionsRevokedAt = new Date();
    }
    if (typeof plan === 'string' && plan) {
      update.plan = plan;
    }
    // One-shot re-arm, not a standing "always show" mode: this just puts the
    // account back into the exact same state a brand-new signup starts in.
    // The client's own next login-completion (POST /auth/tour-seen) flips it
    // straight back to seen, same as any first-time user -- nothing here
    // makes it show more than once.
    if (resetTour) {
      update.hasSeenTour = false;
    }
    // Per-account feature override, independent of plan (e.g. a sales trial
    // for a Starter account without changing their billing plan). Merged
    // shallowly against whatever's already set rather than replaced wholesale
    // -- a request touching just one key must not wipe the other. Written as
    // a plain top-level field ($set: { featureOverrides: {...} }), not Mongo
    // dot-notation, because the in-memory DB fallback's updateOne only does a
    // literal Object.assign and would create a bogus "featureOverrides.x" key
    // instead of a nested field.
    if (featureOverrides && typeof featureOverrides === 'object') {
      const existing = await db.collection('users').findOne({ username: targetUser });
      if (!existing) return res.status(404).json({ error: 'Client not found' });
      const merged = { ...(existing.featureOverrides || {}) };
      for (const key of Object.keys(featureOverrides)) {
        if (!FEATURE_KEYS.includes(key)) continue;
        const val = featureOverrides[key];
        // null explicitly clears the override back to "use the plan default"
        // -- hasFeature() only branches on === true/false, so null falls
        // through to the plan lookup exactly like an absent key would.
        if (val === true || val === false || val === null) merged[key] = val;
      }
      update.featureOverrides = merged;
    }

    if (Object.keys(update).length > 0) {
      await db.collection('users').updateOne({ username: targetUser }, { $set: update });
    }

    // Credit adjustments go through the credits service (clamped at 0).
    if (typeof setCreditsTo === 'number') {
      newBalance = await setCredits(targetUser, setCreditsTo);
    } else if (typeof creditsDelta === 'number' && creditsDelta !== 0) {
      newBalance = await adjustCredits(targetUser, creditsDelta);
    }

    if (newBalance === null) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ success: true, tempPassword, credits: newBalance });
  } catch (err) {
    next(err);
  }
});

// Every link this client has ever submitted, with resolved username + full
// metrics, as a downloadable file (source: submittedLinks ledger).
router.get('/clients/:username/export.:ext(csv|xlsx)', requireAdmin, async (req, res, next) => {
  try {
    const targetUser = req.params.username.toLowerCase();
    const db = getDb();
    const entries = await db.collection('submittedLinks').find({ username: targetUser }).sort({ at: -1 }).toArray();

    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `reelytic-${targetUser}-links-${dateStr}`;

    if (req.params.ext === 'csv') {
      const csv = generateClientLedgerCsv(targetUser, entries);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    }
    const buffer = await generateClientLedgerExcel(targetUser, entries);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

router.get('/ledger', requireAdmin, async (req, res, next) => {
  try {
    const { user, type, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const query = {};
    if (user) query.username = user;
    if (type) query.type = type;
    if (from || to) {
      query.at = {};
      if (from) query.at.$gte = new Date(from);
      if (to) query.at.$lte = new Date(to + 'T23:59:59.999Z');
    }

    const db = getDb();
    const total = await db.collection('submittedLinks').countDocuments(query);
    const links = await db.collection('submittedLinks').find(query).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).toArray();
    res.json({ ledger: links, total, page, limit });
  } catch (err) {
    next(err);
  }
});

router.get('/sessions', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));

    const db = getDb();
    const total = await db.collection('loginHistory').countDocuments({});
    const logins = await db.collection('loginHistory').find({}).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).toArray();
    res.json({ sessions: logins, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PRICING PLANS
// ============================================================

router.get('/pricing-plans', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
    const plans = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
    res.json({ plans });
  } catch (err) {
    next(err);
  }
});

router.put('/pricing-plans', requireAdmin, async (req, res, next) => {
  try {
    const { plans } = req.body || {};
    if (!Array.isArray(plans)) {
      return res.status(400).json({ error: 'plans must be an array' });
    }
    const db = getDb();
    if (plans.length === 0) {
      await db.collection('settings').deleteOne({ key: 'pricingPlans' });
      return res.json({ ok: true, plans: DEFAULT_PLANS, reset: true });
    }
    for (const p of plans) {
      if (!p.id || !p.name || typeof p.monthly !== 'number' || typeof p.credits !== 'number') {
        return res.status(400).json({ error: 'Each plan needs id, name, monthly (number), and credits (number)' });
      }
    }
    await db.collection('settings').updateOne(
      { key: 'pricingPlans' },
      { $set: { key: 'pricingPlans', value: plans } },
      { upsert: true }
    );
    res.json({ ok: true, plans });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PROFILE REPORT DATA SOURCE (pipeline toggle)
// ============================================================
// Global, not per-client -- every client's NEXT profile report uses whichever
// mode is active at start time. See profilePipeline.service.js.

router.get('/settings/profile-pipeline', requireAdmin, async (req, res, next) => {
  try {
    const mode = await getProfilePipelineMode();
    res.json({ mode, info: PROFILE_PIPELINE_INFO });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings/profile-pipeline', requireAdmin, async (req, res, next) => {
  try {
    const { mode } = req.body || {};
    if (mode !== 'legacy' && mode !== 'v2') {
      return res.status(400).json({ error: 'mode must be "legacy" or "v2"' });
    }
    const updated = await setProfilePipelineMode(mode, req.currentUser.username);
    res.json({ success: true, mode: updated });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/profile-pipeline/log', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const log = await db.collection('pipelineToggleLog').find({ setting: 'profileReportPipeline' }).sort({ at: -1 }).limit(50).toArray();
    res.json({ log });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// REEL REPORT PIPELINE -- same pattern as profile-pipeline above, separate
// setting so toggling one report type never affects the other.
// ============================================================

router.get('/settings/reel-pipeline', requireAdmin, async (req, res, next) => {
  try {
    const mode = await getReelPipelineMode();
    res.json({ mode, info: REEL_PIPELINE_INFO });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings/reel-pipeline', requireAdmin, async (req, res, next) => {
  try {
    const { mode } = req.body || {};
    if (mode !== 'standard' && mode !== 'express') {
      return res.status(400).json({ error: 'mode must be "standard" or "express"' });
    }
    const updated = await setReelPipelineMode(mode, req.currentUser.username);
    res.json({ success: true, mode: updated });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/reel-pipeline/log', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const log = await db.collection('pipelineToggleLog').find({ setting: 'reelReportPipeline' }).sort({ at: -1 }).limit(50).toArray();
    res.json({ log });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// EXPRESS (V2) TUNING -- fetch depth + cache TTL. Both apply to Express
// mode's next report immediately, no restart. These are intentionally
// separate settings from the pipeline mode toggle above so tuning Express
// doesn't require flipping any client-visible switch.
// ============================================================

router.get('/settings/profile-v2-tuning', requireAdmin, async (req, res, next) => {
  try {
    const [fetchDepth, cacheTtlDays] = await Promise.all([
      getV2FetchDepth(),
      getCacheTtlDays('profile'),
    ]);
    res.json({ fetchDepth, cacheTtlDays, defaultCacheTtlDays: DEFAULT_PROFILE_CACHE_TTL_DAYS });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings/profile-v2-tuning', requireAdmin, async (req, res, next) => {
  try {
    const { fetchDepth, cacheTtlDays } = req.body || {};
    const updated = {};
    if (fetchDepth !== undefined) {
      updated.fetchDepth = await setV2FetchDepth(fetchDepth, req.currentUser.username);
    }
    if (cacheTtlDays !== undefined) {
      updated.cacheTtlDays = await setProfileCacheTtlDays(cacheTtlDays);
    }
    res.json({ success: true, ...updated });
  } catch (err) {
    if (err.message && (err.message.includes('must be') )) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ============================================================
// USAGE & SPEND
// ============================================================
// Talks to the scraping provider's billing API server-side only. The
// provider's identity, actor ids, and raw actor names must never reach the
// client (response body, error text, or otherwise) -- competitors and
// technical visitors inspecting network traffic must not be able to tell
// which scraping platform powers this. Everything below maps provider-side
// ids to internal, generic labels before anything is sent back.

// The provider's usage/actor-runs API reports actors by their opaque
// canonical id, not the "owner~name" slug used to call them -- so resolving
// a human label requires one extra provider-side lookup per distinct actor
// (cached, so it only happens once per actor per server process). The
// resolved owner~name is matched against this table and ONLY the mapped
// neutral label is ever kept; the raw id/name is discarded immediately
// after matching and never stored or returned.
const KNOWN_ACTOR_SLUGS = {
  'apify~instagram-reel-scraper': { slug: 'reel-scrape', label: 'Reel scraper' },
  'patient_discovery~instagram-reel-analytics-by-url': { slug: 'reel-analytics', label: 'Reel analytics' },
  'apify~instagram-post-scraper': { slug: 'profile-post', label: 'Profile post scraper' },
  'apify~instagram-followers-count-scraper': { slug: 'follower-lookup', label: 'Follower lookup' },
  'instagram-scraper~instagram-profile-reels-scraper': { slug: 'profile-reels', label: 'Profile reels scraper' },
};
const OTHER_ACTOR = { slug: 'other', label: 'Other scan call' };
const _actorResolveCache = new Map();
async function resolveActor(actId, apiKey) {
  if (_actorResolveCache.has(actId)) return _actorResolveCache.get(actId);
  let resolved = OTHER_ACTOR;
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${actId}?token=${apiKey}`);
    if (res.ok) {
      const json = await res.json();
      const ownerSlug = `${json.data.username}~${json.data.name}`;
      resolved = KNOWN_ACTOR_SLUGS[ownerSlug] || OTHER_ACTOR;
    }
  } catch (e) { /* keep the neutral fallback */ }
  _actorResolveCache.set(actId, resolved);
  return resolved;
}

let _inrRateCache = { rate: null, fetchedAt: 0 };
async function getUsdToInrRate() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (_inrRateCache.rate && Date.now() - _inrRateCache.fetchedAt < ONE_HOUR) return _inrRateCache.rate;
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR');
    if (!res.ok) throw new Error('rate fetch failed');
    const json = await res.json();
    _inrRateCache = { rate: json.rates.INR, fetchedAt: Date.now() };
    return _inrRateCache.rate;
  } catch (e) {
    return _inrRateCache.rate;
  }
}

router.get('/usage', requireAdmin, async (req, res, next) => {
  try {
    const apiKey = config.apifyApiKey;
    const usageRes = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apiKey}`);
    if (!usageRes.ok) throw new Error('Usage data is unavailable right now');
    const usageJson = await usageRes.json();
    const u = usageJson.data;

    const meRes = await fetch(`https://api.apify.com/v2/users/me?token=${apiKey}`);
    if (!meRes.ok) throw new Error('Account data is unavailable right now');
    const meJson = await meRes.json();
    const plan = meJson.data.plan || {};
    const monthlyCredits = plan.monthlyUsageCreditsUsd != null ? plan.monthlyUsageCreditsUsd : null;
    const spent = u.totalUsageCreditsUsdAfterVolumeDiscount;
    const remainingBalance = monthlyCredits !== null ? monthlyCredits - spent : null;

    const cycleStart = u.usageCycle.startAt;
    const runsRes = await fetch(
      `https://api.apify.com/v2/actor-runs?token=${apiKey}&desc=1&limit=1000&startedAfter=${encodeURIComponent(cycleStart)}`
    );
    let byActor = [];
    if (runsRes.ok) {
      const runsJson = await runsRes.json();
      const totals = new Map();
      for (const run of runsJson.data.items) {
        const cur = totals.get(run.actId) || { usd: 0, runs: 0 };
        cur.usd += run.usageTotalUsd || 0;
        cur.runs += 1;
        totals.set(run.actId, cur);
      }
      const byLabel = new Map();
      for (const [actId, val] of totals.entries()) {
        const { label } = await resolveActor(actId, apiKey);
        const cur = byLabel.get(label) || { usd: 0, runs: 0 };
        cur.usd += val.usd;
        cur.runs += val.runs;
        byLabel.set(label, cur);
      }
      byActor = [...byLabel.entries()].map(([label, val]) => ({ label, usd: val.usd, runs: val.runs }));
      byActor.sort((a, b) => b.usd - a.usd);
    }

    const usdToInr = await getUsdToInrRate();
    const profilePipelineMode = await getProfilePipelineMode();

    // Per-client attribution: Apify bills the whole account, not any one
    // Reelytic user, so there is no literal per-request invoice to read --
    // this sums each successful item's estimatedCostUsd (stamped on the
    // ledger entry at scrape time using whichever pipeline was actually
    // active then, see costEstimate.service.js), falling back to a flat
    // rate for older entries recorded before that field existed. The gap
    // between this sum and the real Apify total above is shown separately
    // as "unattributed" rather than hidden -- covers admin-side testing,
    // direct API calls, or anything else that never went through a report.
    const db = getDb();
    const entries = await db.collection('submittedLinks').find(
      { result: 'success', at: { $gte: new Date(cycleStart) } },
      { projection: { username: 1, type: 1, estimatedCostUsd: 1 } }
    ).toArray();

    const byUserMap = new Map();
    let attributedUsd = 0;
    for (const e of entries) {
      const cost = e.estimatedCostUsd != null ? e.estimatedCostUsd : fallbackCostUsd(e.type);
      attributedUsd += cost;
      const key = e.username || 'unknown';
      if (!byUserMap.has(key)) byUserMap.set(key, { username: key, reelCount: 0, reelUsd: 0, profileCount: 0, profileUsd: 0, totalUsd: 0 });
      const row = byUserMap.get(key);
      if (e.type === 'reel') { row.reelCount++; row.reelUsd += cost; } else { row.profileCount++; row.profileUsd += cost; }
      row.totalUsd += cost;
    }
    const byUser = [...byUserMap.values()].sort((a, b) => b.totalUsd - a.totalUsd);
    /*
      The gap between our per-item estimates and the real Apify bill, in BOTH
      directions.

      This used to be Math.max(0, spent - attributed), which could only ever
      report "real spend we could not attribute to a client". The opposite
      case -- our rate card charging more per item than Apify actually billed
      -- clamped silently to zero. On 11 Aug 2026 that hid a real 4x
      overstatement: estimates summed to $9.15 against a true cycle bill of
      $2.24, and the page reported a clean 0 gap.

      A cost model that drifts in either direction is worth seeing, so the
      variance is now signed and the ratio travels with it.
    */
    const unattributedUsd = Math.max(0, spent - attributedUsd);
    const overAttributedUsd = Math.max(0, attributedUsd - spent);
    const attributionRatio = spent > 0 ? attributedUsd / spent : null;

    res.json({
      cycleStart: u.usageCycle.startAt,
      cycleEnd: u.usageCycle.endAt,
      totalUsd: spent,
      monthlyCreditsUsd: monthlyCredits,
      remainingBalanceUsd: remainingBalance,
      byActor,
      byUser,
      attributedUsd,
      unattributedUsd,
      overAttributedUsd,
      attributionRatio,
      usdToInr,
      // Historical runs already reflect whichever actors were actually
      // called at the time -- this just tells the UI which mode is live NOW,
      // so nobody looking at a spend number wonders which pipeline it's from.
      profilePipelineMode,
      profilePipelineInfo: PROFILE_PIPELINE_INFO[profilePipelineMode],
      daily: (u.dailyServiceUsages || []).map((day) => ({
        date: day.date.slice(0, 10),
        usd: day.totalUsageCreditsUsd,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Drill-down for the "Spend by client" table -- every individual item a
// user was billed for this cycle, real reel-analytics cost where it's been
// captured (see scrapeReels' costPerRequestedUsd), estimated otherwise.
router.get('/usage/by-user/:username', requireAdmin, async (req, res, next) => {
  try {
    const apiKey = config.apifyApiKey;
    const usageRes = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apiKey}`);
    if (!usageRes.ok) throw new Error('Usage data is unavailable right now');
    const cycleStart = (await usageRes.json()).data.usageCycle.startAt;

    const db = getDb();
    const entries = await db.collection('submittedLinks').find(
      { username: req.params.username, result: 'success', at: { $gte: new Date(cycleStart) } },
      { projection: { url: 1, type: 1, resolvedUsername: 1, estimatedCostUsd: 1, pipelineMode: 1, at: 1, fromCache: 1, costSource: 1, cachedAt: 1 } }
    ).sort({ at: -1 }).toArray();

    const usdToInr = await getUsdToInrRate();
    let cachedCount = 0;
    const items = entries.map((e) => {
      /*
        Entries written before costSource existed have to be classified from
        what they do carry. A successful item costing exactly 0 can only have
        come from the cache: every live scrape rate is strictly positive, and
        a genuinely unknown cost is stored as null, not 0. Anything else with
        a recorded number is a flat-rate estimate, since only reels ever
        captured a real per-run figure and older rows did not distinguish.
      */
      const cached = e.fromCache != null
        ? !!e.fromCache
        : e.estimatedCostUsd === 0;
      const source = e.costSource
        || (cached ? 'cached' : (e.estimatedCostUsd != null ? 'estimated' : 'backfilled'));
      if (cached) cachedCount++;
      return {
        url: e.url,
        type: e.type,
        resolvedUsername: e.resolvedUsername,
        pipelineMode: e.pipelineMode,
        costUsd: e.estimatedCostUsd != null ? e.estimatedCostUsd : fallbackCostUsd(e.type),
        // cached | measured | estimated | backfilled -- drives the chip and
        // explains why a row can legitimately read as zero.
        costSource: source,
        cached,
        // When the reused data was originally scraped, so the admin can see
        // how stale a free item's figures were. Null on anything cached
        // before this was recorded, and on everything not cached.
        cachedAt: cached ? (e.cachedAt || null) : null,
        at: e.at,
      };
    });

    res.json({ username: req.params.username, items, usdToInr, cachedCount });
  } catch (err) {
    next(err);
  }
});

/*
  Credit audit: every report this client has run, with the balance they held
  going in, what the run charged, and the balance they held coming out.

  The three figures are recorded independently (creditsBefore at first start,
  creditsAfter at completion, creditsSpent accumulated per successful item),
  so comparing them is a genuine check rather than a restatement. Where
  before - spent != after, this says so instead of quietly showing the
  arithmetic it wishes were true: a mismatch means either the balance moved
  for another reason mid-run (an admin top-up) or a charge did not land, and
  both are things worth seeing.

  Apify cost is joined per job from the item ledger, which is what lets the
  admin put "what we charged them" and "what it cost us" on the same row.
*/
router.get('/usage/credits/:username', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const username = req.params.username;

    // Window the history. "All time" is the wrong default for a spend review
    // once a client has months of runs, and totals that silently mean
    // "everything ever" are the easiest number on a page to misread.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const rawDays = String(req.query.days || '30');
    const days = rawDays === 'all' ? null : Math.min(365, Math.max(1, Number(rawDays) || 30));
    const since = days ? new Date(Date.now() - days * DAY_MS) : null;

    const jobFilter = { ownerUsername: username, startedAt: { $ne: null } };
    if (since) jobFilter.startedAt = { $ne: null, $gte: since };

    const jobs = await db.collection('jobs').find(
      jobFilter,
      { projection: { type: 1, status: 1, counts: 1, createdAt: 1, startedAt: 1, finishedAt: 1, creditsBefore: 1, creditsAfter: 1, fileName: 1, creditDriftReason: 1 } }
    ).sort({ startedAt: -1 }).limit(500).toArray();

    /*
      What a credit is worth to us, so the page can answer "are we making
      money on this client?" rather than only "what did it cost?".

      Admins hold an effectively-infinite pool (ADMIN_CREDITS) and pay
      nothing, so for them a credit has no revenue attached and the balance
      is meaningless as a countdown. Reporting 999,634 as a balance invites
      exactly the confusion it caused: it is not a balance, it is what is
      left of a number that was never meant to be spent down.
    */
    const userDoc = await db.collection('users').findOne(
      { username },
      { projection: { plan: 1, credits: 1, role: 1 } }
    );
    const plan = (userDoc && userDoc.plan) || 'free';
    const unlimited = plan === 'unlimited' || (userDoc && userDoc.role === 'admin');

    let planPriceInr = null;
    let planCredits = null;
    if (!unlimited) {
      const planDoc = await db.collection('settings').findOne({ key: 'pricingPlans' });
      const plans = (planDoc && planDoc.value && planDoc.value.length > 0) ? planDoc.value : DEFAULT_PLANS;
      const match = plans.find((p) => p.id === plan);
      if (match && match.monthly && match.credits) {
        planPriceInr = match.monthly;
        planCredits = match.credits;
      }
    }

    // One pass over the ledger, grouped in memory: 200 separate per-job
    // aggregations would be 200 round trips for a page that refreshes.
    const jobIds = jobs.map((j) => String(j._id));
    const costRows = jobIds.length === 0 ? [] : await db.collection('submittedLinks').find(
      { jobId: { $in: jobIds }, result: 'success' },
      { projection: { jobId: 1, estimatedCostUsd: 1, type: 1, fromCache: 1 } }
    ).toArray();

    const costByJob = new Map();
    for (const r of costRows) {
      const key = String(r.jobId);
      if (!costByJob.has(key)) costByJob.set(key, { usd: 0, items: 0, cached: 0 });
      const bucket = costByJob.get(key);
      bucket.usd += r.estimatedCostUsd != null ? r.estimatedCostUsd : fallbackCostUsd(r.type);
      bucket.items++;
      const cached = r.fromCache != null ? !!r.fromCache : r.estimatedCostUsd === 0;
      if (cached) bucket.cached++;
    }

    const usdToInr = await getUsdToInrRate();
    const currentBalance = await getBalance(username);

    // Everything on this page is already in USD and converted at render time
    // by the currency toggle, so plan revenue is converted here rather than
    // shipping a second currency the client would have to reconcile.
    const revenuePerCreditUsd = (planPriceInr && planCredits && usdToInr)
      ? (planPriceInr / planCredits) / usdToInr
      : null;

    let totalSpent = 0;
    let totalCostUsd = 0;
    let totalItems = 0;
    let totalCached = 0;
    let unreconciled = 0;
    let explained = 0;

    const runs = jobs.map((j) => {
      const spent = (j.counts && j.counts.creditsSpent) || 0;
      const cost = costByJob.get(String(j._id)) || { usd: 0, items: 0, cached: 0 };
      const before = j.creditsBefore != null ? j.creditsBefore : null;
      const after = j.creditsAfter != null ? j.creditsAfter : null;
      // Only a run with both endpoints recorded can be checked at all;
      // anything older is reported as unverifiable, never as reconciled.
      const reconciled = (before != null && after != null) ? (before - spent === after) : null;
      /*
        A mismatch that has already been traced to the lost-update race and
        signed off by scripts/credit-reconcile.js. It stays visible, and the
        gap is still shown, but it stops counting towards the alarm: a known,
        fixed, closed fault reported as an open one forever is how a warning
        light gets ignored, and it would hide the next real mismatch among
        the noise.
      */
      const driftExplained = reconciled === false && !!j.creditDriftReason;
      if (reconciled === false && !driftExplained) unreconciled++;
      if (driftExplained) explained++;
      totalSpent += spent;
      totalCostUsd += cost.usd;
      totalItems += cost.items;
      totalCached += cost.cached;
      const revenueUsd = revenuePerCreditUsd != null ? spent * revenuePerCreditUsd : null;
      return {
        jobId: String(j._id),
        type: j.type,
        status: j.status,
        fileName: j.fileName || null,
        at: j.startedAt || j.createdAt,
        finishedAt: j.finishedAt || null,
        itemsCharged: cost.items,
        cachedItems: cost.cached,
        creditsBefore: before,
        creditsSpent: spent,
        creditsAfter: after,
        reconciled,
        driftExplained,
        driftReason: j.creditDriftReason || null,
        costUsd: cost.usd,
        revenueUsd,
        // Null rather than 0 when there is no revenue to compare against, so
        // an internal run never renders as a 100% loss.
        marginPct: (revenueUsd && revenueUsd > 0) ? ((revenueUsd - cost.usd) / revenueUsd) * 100 : null,
      };
    });

    const totalRevenueUsd = revenuePerCreditUsd != null ? totalSpent * revenuePerCreditUsd : null;

    res.json({
      username,
      runs,
      plan,
      unlimited,
      planPriceInr,
      planCredits,
      // Meaningless as a countdown on an unlimited pool, so the client is
      // told not to render it as one rather than being left to guess.
      currentBalance: unlimited ? null : currentBalance,
      days: days || 'all',
      totalSpent,
      totalCostUsd,
      totalItems,
      totalCached,
      totalRevenueUsd,
      totalMarginPct: (totalRevenueUsd && totalRevenueUsd > 0)
        ? ((totalRevenueUsd - totalCostUsd) / totalRevenueUsd) * 100
        : null,
      unreconciled,
      explained,
      verifiable: runs.filter((r) => r.reconciled !== null).length,
      usdToInr,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// COST MONITOR
// ============================================================

const DEFAULT_COST_MODEL = {
  usdPerReel: 0.004,
  // Batched analytics-actor cost per reel (start fee amortized across a batch run).
  // This is what actually powers reel reports today (REEL_ACTOR=analytics default).
  usdPerReelAnalytics: 0.0025,
  // Legacy profile pipeline (2 calls: post-scraper + followers-scraper).
  usdPerProfilePost: 0.0027,
  profilePostsPerReport: 6,
  usdPerFollowerLookup: 0.0036,
  // V2 profile pipeline (1 call, bundled followers) -- verified via Apify's
  // pricing API, Bronze tier, no actor-start fee.
  usdPerProfileReelResult: 0.00059,
  profilePostsFetchedV2: 12,
  creditsPerReel: 1,
  creditsPerProfile: 5,
};

// `actorId` is the real provider-side id, used ONLY server-side to match
// against live usage data -- it must never appear in a response. `slug` is
// the neutral internal id sent to the client instead.
// Reel-report actors always show, unaffected by the profile pipeline toggle.
const REEL_COST_ACTORS = [
  { key: 'usdPerReel', actorId: 'apify~instagram-reel-scraper', slug: 'reel-scrape', label: 'Reel scraper', unit: 'per reel' },
  {
    key: 'usdPerReelAnalytics', actorId: 'patient_discovery~instagram-reel-analytics-by-url', slug: 'reel-analytics',
    label: 'Reel analytics (shares/reposts)', unit: 'per reel'
  },
];
// Which profile-pipeline actors show depends on the active mode (see
// profilePipeline.service.js) -- never show both at once, that would make it
// ambiguous which numbers are actually live.
const PROFILE_COST_ACTORS_LEGACY = [
  { key: 'usdPerProfilePost', actorId: 'apify~instagram-post-scraper', slug: 'profile-post', label: 'Profile post scraper', unit: 'per post' },
  { key: 'usdPerFollowerLookup', actorId: 'apify~instagram-followers-count-scraper', slug: 'follower-lookup', label: 'Follower lookup', unit: 'per profile' },
];
const PROFILE_COST_ACTORS_V2 = [
  { key: 'usdPerProfileReelResult', actorId: 'instagram-scraper~instagram-profile-reels-scraper', slug: 'profile-reels', label: 'Profile reels scraper (Express)', unit: 'per result' },
];

async function liveActorAverages(apiKey) {
  try {
    const usageRes = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apiKey}`);
    if (!usageRes.ok) return {};
    const usageJson = await usageRes.json();
    const cycleStart = usageJson.data.usageCycle.startAt;
    // What Apify says the whole account actually spent this cycle. Used below
    // as a sanity check on the run list, which does not see everything.
    const cycleTotalUsd = usageJson.data.totalUsageCreditsUsdBeforeVolumeDiscount
      ?? usageJson.data.totalUsageCreditsUsd
      ?? null;
    const runsRes = await fetch(
      `https://api.apify.com/v2/actor-runs?token=${apiKey}&desc=1&limit=1000&startedAfter=${encodeURIComponent(cycleStart)}`
    );
    if (!runsRes.ok) return {};
    const runsJson = await runsRes.json();
    const totals = new Map();
    for (const run of runsJson.data.items) {
      const cur = totals.get(run.actId) || { usd: 0, runs: 0 };
      cur.usd += run.usageTotalUsd || 0;
      cur.runs += 1;
      totals.set(run.actId, cur);
    }
    // Aggregate by neutral slug (not the raw actId) so the caller can match
    // against REEL_COST_ACTORS/PROFILE_COST_ACTORS_* by slug directly.
    const bySlug = new Map();
    for (const [actId, v] of totals.entries()) {
      const { slug } = await resolveActor(actId, apiKey);
      const cur = bySlug.get(slug) || { usd: 0, runs: 0 };
      cur.usd += v.usd;
      cur.runs += v.runs;
      bySlug.set(slug, cur);
    }
    /*
      Raw totals only. This used to return usd/runs and the Cost Monitor
      printed it straight into a column headed "per reel" / "per result",
      which is not what it measured: one analytics run covers REEL_BATCH_SIZE
      reels and one profile run covers PROFILE_BATCH_SIZE profiles at the
      configured fetch depth. Comparing a per-RUN figure against a per-ITEM
      baseline reported drifts of +955% and +5968% on a pipeline that was
      costing exactly what it should. Dividing by the right denominator is
      the caller's job now, because only the caller knows how many items
      were actually sent to each actor.
    */
    const out = {};
    let observedUsd = 0;
    for (const [slug, v] of bySlug.entries()) {
      out[slug] = { usd: v.usd, runs: v.runs };
      observedUsd += v.usd;
    }

    /*
      How much of the cycle's real spend this run list can actually see.

      Measured on a live account on 11 Aug 2026: Apify reported 10 runs
      totalling $0.08 for a cycle that actually billed $2.24, because
      pay-per-result actor calls do not all surface as listable runs. A
      per-unit rate derived from 4% of the spend is not a live average, it
      is noise, and it is what made this table swing from +955% to -98%
      depending only on which denominator was used.

      So the coverage ratio travels with the data, and the caller refuses to
      publish a rate when the runs it can see do not represent the bill.
    */
    const coverage = (cycleTotalUsd && cycleTotalUsd > 0) ? observedUsd / cycleTotalUsd : null;
    return { bySlug: out, cycleStart, cycleTotalUsd, observedUsd, coverage };
  } catch (e) {
    return { bySlug: {}, cycleStart: null, cycleTotalUsd: null, observedUsd: 0, coverage: null };
  }
}

// Below this, the visible runs are too small a slice of the real bill for a
// per-unit rate computed from them to mean anything.
const MIN_RUN_COVERAGE = 0.6;

/*
  How many billable units each actor was actually asked for this cycle,
  counted from our own ledger. Cached items are excluded because no call was
  made for them, so including them would understate the real per-unit rate.

  The unit differs per actor and must match the baseline's unit exactly:
  a reel actor is billed per reel, the profile reels scraper per RESULT
  (so one profile counts as `fetchDepth` results), the follower lookup per
  profile.
*/
async function liveActorDivisors(db, cycleStart, model, fetchDepth) {
  const empty = { reelItems: 0, profileItems: 0 };
  if (!cycleStart) return empty;
  const rows = await db.collection('submittedLinks').find(
    { result: 'success', at: { $gte: new Date(cycleStart) } },
    { projection: { type: 1, fromCache: 1, estimatedCostUsd: 1 } }
  ).toArray();

  let reelItems = 0;
  let profileItems = 0;
  for (const r of rows) {
    const cached = r.fromCache != null ? !!r.fromCache : r.estimatedCostUsd === 0;
    if (cached) continue;
    if (r.type === 'reel') reelItems++;
    else profileItems++;
  }

  return {
    reelItems,
    profileItems,
    'reel-scrape': reelItems,
    'reel-analytics': reelItems,
    'profile-reels': profileItems * (fetchDepth || 12),
    'profile-post': profileItems * (model.profilePostsPerReport || 12),
    'follower-lookup': profileItems,
  };
}

router.get('/cost-monitor', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const modelDoc = await db.collection('settings').findOne({ key: 'costModel' });
    const model = { ...DEFAULT_COST_MODEL, ...(modelDoc && modelDoc.value ? modelDoc.value : {}) };

    const rate = await getUsdToInrRate();
    const liveAverages = await liveActorAverages(config.apifyApiKey);
    const profilePipelineMode = await getProfilePipelineMode();

    // Reel reports run on the analytics actor by default (see apify.service.js
    // REEL_MODE) -- its batched per-reel cost is the real driver of margin now.
    const reelCostUsd = model.usdPerReelAnalytics != null ? model.usdPerReelAnalytics : model.usdPerReel;
    // Whichever profile pipeline is currently active is what actually runs
    // for the next report -- margin math must match that, not both at once.
    const profileCostUsd = profilePipelineMode === 'v2'
      ? model.usdPerProfileReelResult * model.profilePostsFetchedV2
      : (model.usdPerProfilePost * model.profilePostsPerReport) + model.usdPerFollowerLookup;

    const plansDoc = await db.collection('settings').findOne({ key: 'pricingPlans' });
    const plans = (plansDoc && plansDoc.value && plansDoc.value.length > 0) ? plansDoc.value : DEFAULT_PLANS;

    const planMargins = plans.map((p) => {
      const credits = p.credits || 0;
      const priceInr = p.monthly || 0;
      const allReelsCostUsd = credits * (reelCostUsd / model.creditsPerReel);
      const allProfilesCostUsd = (credits / model.creditsPerProfile) * profileCostUsd;
      const toInr = (usd) => (rate ? usd * rate : null);
      const marginPct = (costInr) => (priceInr > 0 && costInr != null ? Math.round(((priceInr - costInr) / priceInr) * 1000) / 10 : null);
      const bestCostInr = toInr(allReelsCostUsd);
      const worstCostInr = toInr(allProfilesCostUsd);
      return {
        id: p.id,
        name: p.name,
        priceInr,
        credits,
        bestCaseCostInr: bestCostInr,
        worstCaseCostInr: worstCostInr,
        bestCaseMarginPct: marginPct(bestCostInr),
        worstCaseMarginPct: marginPct(worstCostInr),
        breakEvenInr: bestCostInr,
        marginHealthy: marginPct(worstCostInr) != null && marginPct(worstCostInr) >= 40,
      };
    });

    const fetchDepth = await getV2FetchDepth();
    const divisors = await liveActorDivisors(db, liveAverages.cycleStart, model, fetchDepth);

    const coverageOk = liveAverages.coverage != null && liveAverages.coverage >= MIN_RUN_COVERAGE;

    const profileCostActors = profilePipelineMode === 'v2' ? PROFILE_COST_ACTORS_V2 : PROFILE_COST_ACTORS_LEGACY;
    const actors = [...REEL_COST_ACTORS, ...profileCostActors].map((a) => {
      const spend = liveAverages.bySlug[a.slug];
      const units = divisors[a.slug] || 0;
      const canCompute = coverageOk && spend && units > 0;
      return {
        id: a.slug,
        label: a.label,
        unit: a.unit,
        baselineUsd: model[a.key],
        // Real spend on this actor divided by the units we actually sent it,
        // so it is directly comparable to the baseline beside it -- but only
        // published when the visible runs actually represent the bill.
        liveAvgUsd: canCompute ? spend.usd / units : null,
        liveSpendUsd: spend ? spend.usd : null,
        liveRuns: spend ? spend.runs : 0,
        liveUnits: units,
        unavailableReason: canCompute
          ? null
          : (!coverageOk ? 'coverage' : (!spend ? 'no-runs' : 'no-units')),
      };
    });

    res.json({
      model,
      usdToInr: rate,
      // No caching lag: read fresh every request, so flipping the toggle and
      // reloading this page immediately shows the new mode's actors/numbers.
      profilePipelineMode,
      profilePipelineInfo: PROFILE_PIPELINE_INFO[profilePipelineMode],
      costPerReport: { reelUsd: reelCostUsd, profileUsd: profileCostUsd },
      per1kReelsUsd: reelCostUsd * 1000,
      per1kProfilesUsd: profileCostUsd * 1000,
      actors,
      planMargins,
      // Surfaced so the page can explain an empty Live column instead of
      // leaving it looking broken.
      liveCoverage: liveAverages.coverage,
      liveObservedUsd: liveAverages.observedUsd,
      cycleTotalUsd: liveAverages.cycleTotalUsd,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/cost-monitor', requireAdmin, async (req, res, next) => {
  try {
    const { model } = req.body || {};
    if (!model || typeof model !== 'object') {
      return res.status(400).json({ error: 'model object required' });
    }
    const clean = {};
    for (const key of Object.keys(DEFAULT_COST_MODEL)) {
      if (typeof model[key] === 'number' && model[key] >= 0) clean[key] = model[key];
    }
    const db = getDb();
    await db.collection('settings').updateOne(
      { key: 'costModel' },
      { $set: { key: 'costModel', value: clean } },
      { upsert: true }
    );
    res.json({ ok: true, model: { ...DEFAULT_COST_MODEL, ...clean } });
  } catch (err) {
    next(err);
  }
});

/*
  Application health: what is currently broken in production.

  Grouped by fingerprint, so each row is a distinct fault with an occurrence
  count rather than one row per occurrence. This is the page that is supposed
  to tell us something is wrong before a client does.
*/
router.get('/health/errors', requireAdmin, async (req, res, next) => {
  try {
    const includeResolved = req.query.includeResolved === 'true';
    const errors = await listErrors({ includeResolved, limit: Number(req.query.limit) || 100 });
    res.json({ errors, unresolved: await unresolvedCount() });
  } catch (err) {
    next(err);
  }
});

// Drives the badge in the admin nav. Kept separate and deliberately tiny
// because it is polled: the full list would be wasteful to fetch on a timer.
router.get('/health/count', requireAdmin, async (req, res, next) => {
  try {
    res.json({ unresolved: await unresolvedCount() });
  } catch (err) {
    next(err);
  }
});

// Marking something resolved is a judgement call ("I have fixed this"), not a
// deletion. The group stays, and reopens by itself if the fault happens again.
router.patch('/health/errors/:id', requireAdmin, async (req, res, next) => {
  try {
    await resolveError(req.params.id, req.body && req.body.resolved !== false);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;