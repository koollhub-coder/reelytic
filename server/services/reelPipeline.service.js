const { getDb } = require('../db');

/*
  Global switch for which Reel Report pipeline runs for EVERY client's next
  reel report -- same pattern as profilePipeline.service.js. 'standard' is
  the ORIGINAL, untouched reel-report logic (exact current behavior, same
  actors, same per-batch follower lookups). 'express' is the new
  cost-reduction path added 2026-07-30: same primary analytics actor (no
  cheaper reliable alternative exists -- researched and tested several,
  none beat market rate without losing share/repost/save fields entirely),
  but follower lookups try a cheaper actor first and automatically fall back
  to the original reliable one per-creator on failure, so Express can never
  be less reliable than Standard, only cheaper when the fast path works.

  Deliberately global, not per-user, same reasoning as the profile toggle:
  one instant total rollback path, not a partial rollout.
*/

const SETTINGS_KEY = 'reelReportPipeline';
const DEFAULT_MODE = 'standard';

// Typical, not exact -- real per-report cost varies (see Usage & Spend's
// "measured" per-item figures). These match the real measured averages this
// project's cost investigation found: ~$0.005643/reel Standard, ~$0.003907
// Express, at a representative ~₹96/$1 rate.
const REEL_PIPELINE_INFO = {
  standard: {
    mode: 'standard',
    label: 'Standard',
    approxCostInr: '~₹0.54/reel',
    steps: [
      'Fetch this reel\'s views, likes, comments, shares, reposts, and saves',
      'Look up the creator\'s follower count (needed for engagement rate)',
    ],
  },
  express: {
    mode: 'express',
    label: 'Express',
    approxCostInr: '~₹0.37/reel',
    steps: [
      'Fetch this reel\'s views, likes, comments, shares, reposts, and saves. Identical to Standard, same data',
      'Look up the creator\'s follower count through a cheaper path first. If that specific creator can\'t be resolved that way, falls back to Standard\'s method automatically. Never less reliable, only sometimes cheaper',
    ],
  },
};

async function getReelPipelineMode() {
  const db = getDb();
  const doc = await db.collection('settings').findOne({ key: SETTINGS_KEY });
  const value = doc && doc.value;
  return (value === 'standard' || value === 'express') ? value : DEFAULT_MODE;
}

async function setReelPipelineMode(mode, adminUsername) {
  if (mode !== 'standard' && mode !== 'express') {
    throw new Error('mode must be "standard" or "express"');
  }
  const db = getDb();
  const previous = await getReelPipelineMode();

  await db.collection('settings').updateOne(
    { key: SETTINGS_KEY },
    { $set: { key: SETTINGS_KEY, value: mode } },
    { upsert: true }
  );

  await db.collection('pipelineToggleLog').insertOne({
    setting: SETTINGS_KEY,
    from: previous,
    to: mode,
    by: adminUsername || 'unknown',
    at: new Date(),
  });

  return mode;
}

module.exports = { getReelPipelineMode, setReelPipelineMode, REEL_PIPELINE_INFO, DEFAULT_MODE };
