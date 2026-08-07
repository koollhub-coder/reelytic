const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { getDb } = require('../db');
const { hashPassword, generateTempPassword } = require('../utils/password');
const { parseUserAgent } = require('../utils/ua');
const config = require('../config');
const { DEFAULT_PLANS } = require('./pricing.routes');
const { FEATURE_KEYS } = require('../services/features.service');
const { defaultsForNewUser, adjustCredits, setCredits } = require('../services/credits.service');
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
    const unattributedUsd = Math.max(0, spent - attributedUsd);

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
      { projection: { url: 1, type: 1, resolvedUsername: 1, estimatedCostUsd: 1, pipelineMode: 1, at: 1 } }
    ).sort({ at: -1 }).toArray();

    const usdToInr = await getUsdToInrRate();
    const items = entries.map((e) => ({
      url: e.url,
      type: e.type,
      resolvedUsername: e.resolvedUsername,
      pipelineMode: e.pipelineMode,
      costUsd: e.estimatedCostUsd != null ? e.estimatedCostUsd : fallbackCostUsd(e.type),
      // true = recorded at scrape time (reel items include a real, measured
      // analytics cost; see scrapeReels' costPerRequestedUsd). false = this
      // entry predates cost tracking and is backfilled with a flat rate.
      recordedLive: e.estimatedCostUsd != null,
      at: e.at,
    }));

    res.json({ username: req.params.username, items, usdToInr });
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
    const out = {};
    for (const [slug, v] of bySlug.entries()) {
      out[slug] = v.runs > 0 ? v.usd / v.runs : null;
    }
    return out;
  } catch (e) {
    return {};
  }
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

    const profileCostActors = profilePipelineMode === 'v2' ? PROFILE_COST_ACTORS_V2 : PROFILE_COST_ACTORS_LEGACY;
    const actors = [...REEL_COST_ACTORS, ...profileCostActors].map((a) => ({
      id: a.slug,
      label: a.label,
      unit: a.unit,
      baselineUsd: model[a.key],
      liveAvgUsd: liveAverages[a.slug] != null ? liveAverages[a.slug] : null,
    }));

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

module.exports = router;