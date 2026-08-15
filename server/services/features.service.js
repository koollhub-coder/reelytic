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

const FEATURE_KEYS = ['reportBranding', 'shareableLinks', 'pdfExport'];

async function getPlans() {
  const db = getDb();
  const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
  return (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
}

async function hasFeature(user, featureKey) {
  if (!FEATURE_KEYS.includes(featureKey)) return false;
  if (!user) return false;
  if (user.role === 'admin') return true;

  const override = user.featureOverrides && user.featureOverrides[featureKey];
  if (override === true) return true;
  if (override === false) return false;

  const plans = await getPlans();
  const plan = plans.find((p) => p.id === user.plan);
  return !!(plan && plan.featureFlags && plan.featureFlags[featureKey] === true);
}

async function getUserFeatures(user) {
  const entries = await Promise.all(FEATURE_KEYS.map(async (key) => [key, await hasFeature(user, key)]));
  return Object.fromEntries(entries);
}

module.exports = { hasFeature, getUserFeatures, FEATURE_KEYS };
