const config = require('../config');
const { getDb } = require('../db');
const { estimateItemCostUsd } = require('./costEstimate.service');
const { getProfilePipelineMode } = require('./profilePipeline.service');
const { getReelPipelineMode } = require('./reelPipeline.service');
const { CREDIT_COST } = require('./credits.service');

/*
  How many Reelytic credits the platform can actually deliver.

  Nobody gets an unlimited pool, admin included. The only real limit on this
  product is the money Apify lets us spend each billing cycle, so the admin's
  credit balance IS that limit, converted into credits:

      left to spend     = the cycle's Apify allowance - what is already used
      cost per credit   = what one credit costs us to fulfil, measured per report type
      credits available = left to spend / cost per credit

  Reels and profiles cost us different amounts per credit (a Reel is 1 credit
  and a profile is 5, but a profile costs us far less than 5 Reels), so there
  are two honest answers. The balance uses the cautious one, the credits that
  are covered whatever the mix of work turns out to be, and both are shown.

  Nothing here is stored. It is recomputed from Apify's own numbers (cached for
  a minute), so a run made by any client immediately lowers what admin sees.
*/

const CACHE_MS = 60 * 1000;
const STALE_OK_MS = 6 * 60 * 60 * 1000;   // if Apify is unreachable, keep showing the last good figure this long
let cache = null;                         // { at, value }

// Pure, so the arithmetic can be tested and audited without any network.
function buildCapacity({ monthlyUsd, spentUsd, reelUsd, profileUsd, creditsPerReel, creditsPerProfile }) {
  const leftUsd = Math.max(0, monthlyUsd - spentUsd);
  const reelUsdPerCredit = reelUsd / creditsPerReel;
  const profileUsdPerCredit = profileUsd / creditsPerProfile;
  const floorSafe = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const ifOnlyReels = floorSafe(leftUsd / reelUsdPerCredit);
  const ifOnlyProfiles = floorSafe(leftUsd / profileUsdPerCredit);
  // The dearer credit is the one that is always covered, whatever gets run.
  const dearest = Math.max(reelUsdPerCredit, profileUsdPerCredit);
  return {
    leftUsd,
    reelUsdPerCredit,
    profileUsdPerCredit,
    dearestUsdPerCredit: dearest,
    ifOnlyReels,
    ifOnlyProfiles,
    guaranteedCredits: floorSafe(leftUsd / dearest),
  };
}

async function readApify() {
  // Tests set this so they never depend on the network or on a real account.
  if (process.env.PLATFORM_APIFY_STUB && process.env.NODE_ENV !== 'production') {
    const stub = JSON.parse(process.env.PLATFORM_APIFY_STUB);
    return { monthlyUsd: stub.monthlyUsd, spentUsd: stub.spentUsd, planName: stub.planName || 'Stub', cycleStart: null, cycleEnd: null };
  }
  const key = config.apifyApiKey;
  if (!key || key === 'your_apify_api_key_here' || key === 'mock_apify_key') throw new Error('Apify is not configured');
  const get = async (url) => {
    const res = await fetch(`${url}?token=${key}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Apify returned ${res.status}`);
    return (await res.json()).data;
  };
  const [me, usage] = await Promise.all([get('https://api.apify.com/v2/users/me'), get('https://api.apify.com/v2/users/me/usage/monthly')]);
  const plan = me.plan || {};
  const monthlyUsd = plan.monthlyUsageCreditsUsd != null ? plan.monthlyUsageCreditsUsd : plan.maxMonthlyUsageUsd;
  return {
    monthlyUsd: Number(monthlyUsd) || 0,
    spentUsd: Number(usage.totalUsageCreditsUsdAfterVolumeDiscount) || 0,
    planName: plan.id || null,
    cycleStart: usage.usageCycle && usage.usageCycle.startAt,
    cycleEnd: usage.usageCycle && usage.usageCycle.endAt,
  };
}

async function compute() {
  const apify = await readApify();
  const [profileMode, reelMode] = await Promise.all([getProfilePipelineMode(), getReelPipelineMode()]);
  const [profileUsd, reelUsd] = await Promise.all([estimateItemCostUsd('profile', profileMode), estimateItemCostUsd('reel', reelMode)]);
  const capacity = buildCapacity({
    monthlyUsd: apify.monthlyUsd,
    spentUsd: apify.spentUsd,
    reelUsd,
    profileUsd,
    creditsPerReel: CREDIT_COST.reel,
    creditsPerProfile: CREDIT_COST.profile,
  });

  // What clients are already holding, so admin can see at a glance whether more
  // credits have been handed out than Apify can fund.
  const [agg] = await getDb().collection('users').aggregate([
    { $match: { role: { $ne: 'admin' } } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$credits', 0] } } } },
  ]).toArray();

  return {
    apify,
    costs: {
      reelUsd, profileUsd,
      creditsPerReel: CREDIT_COST.reel, creditsPerProfile: CREDIT_COST.profile,
      reelUsdPerCredit: capacity.reelUsdPerCredit, profileUsdPerCredit: capacity.profileUsdPerCredit,
    },
    capacity: {
      leftUsd: capacity.leftUsd,
      ifOnlyReels: capacity.ifOnlyReels,
      ifOnlyProfiles: capacity.ifOnlyProfiles,
      dearestUsdPerCredit: capacity.dearestUsdPerCredit,
      guaranteedCredits: capacity.guaranteedCredits,
    },
    heldByClients: (agg && agg.total) || 0,
    computedAt: new Date().toISOString(),
    stale: false,
  };
}

async function getPlatformCredits({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_MS) return cache.value;
  try {
    const value = await compute();
    cache = { at: now, value };
    return value;
  } catch (err) {
    if (cache && now - cache.at < STALE_OK_MS) return { ...cache.value, stale: true, staleReason: err.message };
    return { unavailable: true, reason: err.message, capacity: { guaranteedCredits: 0 } };
  }
}

// The single number admin's balance is set to everywhere.
async function getAdminCredits() {
  const p = await getPlatformCredits();
  return (p && p.capacity && p.capacity.guaranteedCredits) || 0;
}

function resetPlatformCreditsCache() { cache = null; }

module.exports = { buildCapacity, getPlatformCredits, getAdminCredits, resetPlatformCreditsCache };
