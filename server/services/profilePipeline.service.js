const { getDb } = require('../db');

/*
  Global, single-source-of-truth switch for which profile-report pipeline
  runs for EVERY client's next profile report. Deliberately global, not
  per-user -- the whole point is one instant, total rollback path if the new
  pipeline misbehaves on real accounts, not a partial/gradual rollout.

  Stored the same way pricingPlans/costModel already are: one document in the
  `settings` collection, keyed by name, read fresh on every request (no
  in-process cache) so a toggle takes effect on the very next report with no
  stale-value window.
*/

const SETTINGS_KEY = 'profileReportPipeline';
const DEFAULT_MODE = 'legacy';

const PROFILE_PIPELINE_INFO = {
  legacy: {
    mode: 'legacy',
    label: 'Standard',
    steps: ['Fetch recent posts and reels', 'Look up follower count'],
    approxCostInr: '~₹1.45/profile',
  },
  v2: {
    mode: 'v2',
    label: 'Express',
    steps: ['Fetch posts, reels, and follower count together'],
    approxCostInr: '~₹0.55/profile',
  },
};

async function getProfilePipelineMode() {
  const db = getDb();
  const doc = await db.collection('settings').findOne({ key: SETTINGS_KEY });
  const value = doc && doc.value;
  return (value === 'legacy' || value === 'v2') ? value : DEFAULT_MODE;
}

async function setProfilePipelineMode(mode, adminUsername) {
  if (mode !== 'legacy' && mode !== 'v2') {
    throw new Error('mode must be "legacy" or "v2"');
  }
  const db = getDb();
  const previous = await getProfilePipelineMode();

  await db.collection('settings').updateOne(
    { key: SETTINGS_KEY },
    { $set: { key: SETTINGS_KEY, value: mode } },
    { upsert: true }
  );

  // Audit trail: this changes cost and data source for every client
  // immediately, so who/when/from/to needs to be retrievable.
  await db.collection('pipelineToggleLog').insertOne({
    setting: SETTINGS_KEY,
    from: previous,
    to: mode,
    by: adminUsername || 'unknown',
    at: new Date(),
  });

  return mode;
}

const V2_FETCH_DEPTH_KEY = 'profileV2FetchDepth';
const DEFAULT_V2_FETCH_DEPTH = Number(process.env.PROFILE_FETCH_MAX_V2 || 8);

// How many reels Express (v2) fetches per profile before trimming to the
// final analyzed set (see selectProfileReelsV2 in apify.service.js). Kept as
// a DB setting rather than a require-time constant so it can be tuned from
// Scan Settings without a server restart -- same pattern as the pipeline
// mode toggle above. The legacy pipeline's fetch depth (PROFILE_FETCH_MAX)
// is a separate, untouched constant.
async function getV2FetchDepth() {
  const db = getDb();
  const doc = await db.collection('settings').findOne({ key: V2_FETCH_DEPTH_KEY });
  const value = doc && Number(doc.value);
  return Number.isFinite(value) && value >= 4 ? value : DEFAULT_V2_FETCH_DEPTH;
}

async function setV2FetchDepth(depth, adminUsername) {
  const value = Number(depth);
  if (!Number.isFinite(value) || value < 4 || value > 20) {
    throw new Error('Fetch depth must be a number between 4 and 20');
  }
  const db = getDb();
  const previous = await getV2FetchDepth();
  await db.collection('settings').updateOne(
    { key: V2_FETCH_DEPTH_KEY },
    { $set: { key: V2_FETCH_DEPTH_KEY, value } },
    { upsert: true }
  );
  await db.collection('pipelineToggleLog').insertOne({
    setting: V2_FETCH_DEPTH_KEY,
    from: previous,
    to: value,
    by: adminUsername || 'unknown',
    at: new Date(),
  });
  return value;
}

module.exports = {
  getProfilePipelineMode, setProfilePipelineMode, PROFILE_PIPELINE_INFO, DEFAULT_MODE,
  getV2FetchDepth, setV2FetchDepth, DEFAULT_V2_FETCH_DEPTH,
};
