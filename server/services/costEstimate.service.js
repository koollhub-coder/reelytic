const { getV2FetchDepth } = require('./profilePipeline.service');

/*
  Per-item cost estimates used to attribute real spend back to the specific
  client/report that caused it. Apify bills the whole account, not any one
  Reelytic user, so this is a computed ESTIMATE (stamped onto each ledger
  entry at scrape time, using whichever pipeline was actually active for
  that call) rather than a literal per-request invoice -- the Usage & Spend
  page labels it as such. Rates below are real, measured figures from this
  project's cost investigation, not guesses:

  Profile Standard (legacy): apify~instagram-post-scraper (~$0.0017/post x12
  candidates) + apify~instagram-followers-count-scraper ($0.0026/profile +
  $0.001/run) -- matches the ~$0.0161-0.0171/profile figure already
  documented in apify.service.js's scrapeProfilesBatch.

  Profile Express (v2): instagram-scraper~instagram-profile-reels-scraper,
  $0.001/result, no flat run fee. Real measured cost on real client accounts
  at fetch depth 12 was $0.0105/profile (2026-07-30 investigation, matched
  the account's real production billing almost exactly). Scales linearly
  with the admin-configurable fetch depth (Scan Settings), so it's computed
  fresh from the current setting rather than hardcoded.

  Reel Standard: patient_discovery reel-analytics ($0.0025/result +
  $0.002/run) + apify followers ($0.0026/profile + $0.001/run) -- real
  measured cost on a real 200-link/137-success campaign: $0.7732 / 137 =
  $0.005643/reel.

  Reel Express: same analytics call, cheaper-with-fallback follower lookup
  -- real measured cost on a real 19-link/15-success batch: $0.0586 / 15 =
  $0.003907/reel.
*/

const PROFILE_STANDARD_COST_USD = 0.0165;
/*
  Re-measured 11 Aug 2026 by a controlled run against the live actors at
  production batch sizes (5 profiles/run, 15 reels/run), reading
  usageTotalUsd back per run. Four runs, perfectly repeatable: every profile
  run billed exactly $0.0400 for 40 results, every reel run exactly $0.0295.

    profile reels scraper : $0.001000 per result, so $0.012 at depth 12
    reel analytics        : $0.001967 per reel

  The previous 0.0105 was measured at a different time and ran ~14% under
  what the actor bills today.
*/
const PROFILE_V2_MEASURED_AT_DEPTH_12_USD = 0.012;
const REEL_STANDARD_COST_USD = 0.005643;
// Analytics ($0.001967, measured above) + the Express follower lookup
// ($0.000677, measured 2026-08-01). Only a fallback: the reel pipeline
// captures its real per-run cost at scrape time and uses that instead.
const REEL_EXPRESS_COST_USD = 0.002644;

// Follower-lookup-only portion of the two reel rates above (used once the
// reel analytics half is measured exactly per-run, see scrapeReels'
// runCostUsd/costPerRequestedUsd -- this constant then only has to cover
// the remaining, harder-to-itemize follower call). Real measured split from
// the same 2026-07-30 200-link campaign: followers = $0.3702 / 137 =
// $0.002702/reel. Express's real measured follower cost (2026-08-01,
// 13-creator test with the fast-path+fallback hybrid) was $0.0088/13 =
// $0.000677/creator -- far cheaper because most creators resolve for free.
const REEL_FOLLOWER_STANDARD_COST_USD = 0.002702;
const REEL_FOLLOWER_EXPRESS_COST_USD = 0.000677;

/*
  Per-run start fee on instagram-scraper~instagram-profile-reels-scraper,
  introduced by the actor author effective 2026-08-21. Every other event on
  that actor is unchanged.

  It is charged once per actor RUN, and scrapeProfilesBatchV2 sends
  PROFILE_BATCH_SIZE usernames per run, so the per-profile share is the fee
  divided by the batch size. Kept in step with PROFILE_BATCH_SIZE in
  jobEngine.service.js: if that batch size changes, this denominator has to
  change with it or every profile report's recorded cost drifts.
*/
const PROFILE_V2_RUN_START_FEE_USD = 0.0005;
const PROFILE_BATCH_SIZE = Number(process.env.PROFILE_BATCH_SIZE || 5);

async function profileExpressCostUsd() {
  const depth = await getV2FetchDepth();
  const perResult = PROFILE_V2_MEASURED_AT_DEPTH_12_USD * (depth / 12);
  // Without this term the Usage & Spend page would quietly under-report every
  // profile report from 21 Aug onward. Small per profile, but a cost figure
  // that is knowingly wrong is worse than one that is merely approximate.
  return perResult + (PROFILE_V2_RUN_START_FEE_USD / PROFILE_BATCH_SIZE);
}

// pipelineMode: 'legacy'|'v2' for profile, 'standard'|'express' for reel.
async function estimateItemCostUsd(type, pipelineMode) {
  if (type === 'reel') {
    return pipelineMode === 'express' ? REEL_EXPRESS_COST_USD : REEL_STANDARD_COST_USD;
  }
  return pipelineMode === 'v2' ? await profileExpressCostUsd() : PROFILE_STANDARD_COST_USD;
}

/*
  Fallback rate for ledger entries recorded before estimatedCostUsd existed.

  This used to return the STANDARD (legacy) rates, which are 2-6x the
  Express rates actually in use. Because a large share of historical rows
  carry no recorded cost, that fallback dominated the per-client totals on
  Usage & Spend: on 11 Aug 2026 the page reported $9.15 of client spend
  against a real cycle bill of $2.39, and the whole gap was this function
  pricing unrecorded rows at legacy rates. Summing only the rows that DO
  carry a cost gave $2.73, which tracks the real bill within ~14%.

  Express is what runs, so Express is what an unknown row should be priced
  at. It is still an approximation, but a defensible one rather than a
  systematic 3x overstatement.
*/
function fallbackCostUsd(type) {
  return type === 'reel' ? REEL_EXPRESS_COST_USD : (PROFILE_V2_MEASURED_AT_DEPTH_12_USD * (8 / 12));
}

module.exports = {
  estimateItemCostUsd,
  fallbackCostUsd,
  PROFILE_STANDARD_COST_USD,
  REEL_STANDARD_COST_USD,
  REEL_EXPRESS_COST_USD,
  REEL_FOLLOWER_STANDARD_COST_USD,
  REEL_FOLLOWER_EXPRESS_COST_USD,
};
