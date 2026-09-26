const { getDb } = require('../db');
const { DEFAULT_PLANS } = require('../routes/pricing.routes');

/*
  Plan-gated feature flags (report branding, shareable links). Admin controls
  these two ways, both live in the Pricing Editor / Clients screens:
    - per-plan defaults: each plan object's `featureFlags: { key: bool }`,
      stored the same place as everything else on that plan (settings
      collection, key "pricingPlans") -- no schema change needed, PUT
      /admin/pricing-plans already persists whatever shape a plan object is.
    - per-account override: `user.featureOverrides: { key: true|false }`,
      set via PATCH /admin/clients/:username. true/false wins over whatever
      the plan says; a key simply absent means "use the plan default".

  A plan missing featureFlags entirely (an old custom plan saved before this
  existed) defaults every feature to OFF, not on -- silently granting access
  because of a missing field would be the wrong failure direction for a
  paid-feature gate. Admins already have full editing control to turn it on.
*/

const FEATURE_KEYS = ['reportBranding', 'shareableLinks', 'pdfExport', 'creatorDatabase', 'teamSeats', 'clientPortal'];

/*
  Read on every /auth/me (so every page load) and every feature check. The plans
  change a few times a year, so they are kept in memory for 20 seconds, and the
  admin's save clears them at once (invalidatePlansCache), so an edit shows
  immediately rather than after a wait.
*/
const PLANS_TTL_MS = 20 * 1000;
let plansCache = null;
let plansLoading = null;

function invalidatePlansCache() { plansCache = null; }

async function getPlans() {
  if (plansCache && Date.now() - plansCache.at < PLANS_TTL_MS) return plansCache.value;
  if (plansLoading) return plansLoading;
  plansLoading = (async () => {
    const db = getDb();
    const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
    const value = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
    plansCache = { at: Date.now(), value };
    return value;
  })().finally(() => { plansLoading = null; });
  return plansLoading;
}

// `plans` is optional -- pass it when the caller already has it (see
// getUserFeatures below) so this doesn't re-fetch the same settings
// document; single-key call sites (jobs.routes.js, settings.routes.js)
// omit it and this fetches it itself exactly as before.
async function hasFeature(user, featureKey, plans) {
  if (!FEATURE_KEYS.includes(featureKey)) return false;
  if (!user) return false;
  if (user.role === 'admin') return true;

  const override = user.featureOverrides && user.featureOverrides[featureKey];
  if (override === true) return true;
  if (override === false) return false;

  const resolvedPlans = plans || await getPlans();
  const plan = resolvedPlans.find((p) => p.id === user.plan);
  return !!(plan && plan.featureFlags && plan.featureFlags[featureKey] === true);
}

/*
  Checks all 3 feature keys for one user -- called on every /auth/me, so on
  every page load. It used to call hasFeature() 3 times with no plans
  argument, which meant 3 separate (if parallel) round trips fetching the
  exact same pricingPlans settings document. One fetch, shared across all
  three checks below, cuts this route's DB work by two thirds.
*/
async function getUserFeatures(user) {
  const plans = await getPlans();
  const entries = await Promise.all(FEATURE_KEYS.map(async (key) => [key, await hasFeature(user, key, plans)]));
  return Object.fromEntries(entries);
}

module.exports = { hasFeature, getUserFeatures, FEATURE_KEYS, invalidatePlansCache };
