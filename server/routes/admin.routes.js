const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { getDb } = require('../db');
const { hashPassword, generateTempPassword } = require('../utils/password');
const { parseUserAgent } = require('../utils/ua');
const config = require('../config');
const { DEFAULT_PLANS } = require('./pricing.routes');
const { defaultsForNewUser, adjustCredits, setCredits } = require('../services/credits.service');

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
      const count = await db.collection('submittedLinks').countDocuments({
        at: { $gte: new Date(dateStr + 'T00:00:00.000Z'), $lte: new Date(dateStr + 'T23:59:59.999Z') }
      });
      days14.push({ date: dateStr, count });
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
    const { disabled, resetPassword, revokeSessions, creditsDelta, setCredits: setCreditsTo, plan } = req.body;
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

router.get('/ledger', requireAdmin, async (req, res, next) => {
  try {
    const { user, type, from, to } = req.query;
    const query = {};
    if (user) query.username = user;
    if (type) query.type = type;
    if (from || to) {
      query.at = {};
      if (from) query.at.$gte = new Date(from);
      if (to) query.at.$lte = new Date(to + 'T23:59:59.999Z');
    }

    const db = getDb();
    const links = await db.collection('submittedLinks').find(query).sort({ at: -1 }).limit(500).toArray();
    res.json({ ledger: links });
  } catch (err) {
    next(err);
  }
});

router.get('/sessions', requireAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const logins = await db.collection('loginHistory').find({}).sort({ at: -1 }).limit(100).toArray();
    res.json({ sessions: logins });
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
// APIFY SPEND
// ============================================================

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

const _actorNameCache = new Map();
async function getActorName(actId, apiKey) {
  if (_actorNameCache.has(actId)) return _actorNameCache.get(actId);
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${actId}?token=${apiKey}`);
    if (!res.ok) throw new Error('actor fetch failed');
    const json = await res.json();
    const label = `${json.data.username}/${json.data.name}`;
    _actorNameCache.set(actId, label);
    return label;
  } catch (e) {
    _actorNameCache.set(actId, actId);
    return actId;
  }
}

router.get('/apify-usage', requireAdmin, async (req, res, next) => {
  try {
    const apiKey = config.apifyApiKey;
    const usageRes = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${apiKey}`);
    if (!usageRes.ok) throw new Error(`Apify usage API error ${usageRes.status}`);
    const usageJson = await usageRes.json();
    const u = usageJson.data;

    const meRes = await fetch(`https://api.apify.com/v2/users/me?token=${apiKey}`);
    if (!meRes.ok) throw new Error(`Apify account API error ${meRes.status}`);
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
      for (const [actId, val] of totals.entries()) {
        const name = await getActorName(actId, apiKey);
        byActor.push({ actId, name, usd: val.usd, runs: val.runs });
      }
      byActor.sort((a, b) => b.usd - a.usd);
    }

    const usdToInr = await getUsdToInrRate();

    res.json({
      cycleStart: u.usageCycle.startAt,
      cycleEnd: u.usageCycle.endAt,
      totalUsd: spent,
      monthlyCreditsUsd: monthlyCredits,
      remainingBalanceUsd: remainingBalance,
      byActor,
      usdToInr,
      daily: (u.dailyServiceUsages || []).map((day) => ({
        date: day.date.slice(0, 10),
        usd: day.totalUsageCreditsUsd,
      })),
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
  usdPerProfilePost: 0.0027,
  profilePostsPerReport: 6,
  usdPerFollowerLookup: 0.0036,
  creditsPerReel: 1,
  creditsPerProfile: 5,
};

const COST_ACTORS = [
  { key: 'usdPerReel', id: 'apify~instagram-reel-scraper', label: 'Reel scraper', unit: 'per reel' },
  { key: 'usdPerProfilePost', id: 'apify~instagram-post-scraper', label: 'Profile post scraper', unit: 'per post' },
  { key: 'usdPerFollowerLookup', id: 'apify~instagram-followers-count-scraper', label: 'Followers scraper', unit: 'per profile' },
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
    const out = {};
    for (const [actId, v] of totals.entries()) {
      out[actId] = v.runs > 0 ? v.usd / v.runs : null;
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

    const reelCostUsd = model.usdPerReel;
    const profileCostUsd = (model.usdPerProfilePost * model.profilePostsPerReport) + model.usdPerFollowerLookup;

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

    const actors = COST_ACTORS.map((a) => ({
      id: a.id,
      label: a.label,
      unit: a.unit,
      baselineUsd: model[a.key],
      liveAvgUsd: liveAverages[a.id] != null ? liveAverages[a.id] : null,
    }));

    res.json({
      model,
      usdToInr: rate,
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