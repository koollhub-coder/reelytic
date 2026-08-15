const { getDb } = require('../db');

/*
  Returns { inserted, duplicate } instead of swallowing every outcome the
  same way. `inserted: true` means this call just recorded the FIRST
  success for this job+url -- the caller (jobEngine.service.js) charges
  credits only in that case. `duplicate: true` means the unique index on
  { jobId, url, result: 'success' } (see db.js) rejected the insert because
  a success record for this exact row already exists: this is the expected,
  safe shape of a crash-and-resume replay, not an error, and the caller must
  NOT charge again. Any other failure also comes back as
  { inserted: false, duplicate: false } -- an unconfirmed insert is treated
  the same as a duplicate for billing purposes (fail closed: no confirmed
  new record, no charge), and is logged since that case IS a real problem.
*/
async function recordLedgerEntry({ username, type, jobId, url, result, resolvedUsername, metrics, pipelineMode, estimatedCostUsd, fromCache, costSource, cachedAt }) {
  const db = getDb();
  const cached = result === 'success' && !!fromCache;

  let inserted = false;
  let duplicate = false;
  try {
    await db.collection('submittedLinks').insertOne({
      username,
      type,
      jobId,
      url,
      resolvedUsername: resolvedUsername || null,
      // Which pipeline actually ran this specific item, and what it's
      // estimated to have cost (0 for cache hits -- no Apify call happened).
      // Real Apify billing is account-wide, not per-request, so this is a
      // computed estimate using measured per-item rates for whichever mode
      // was active at the time -- see costEstimate.service.js. Powers the
      // per-client cost breakdown on the Usage & Spend page.
      pipelineMode: pipelineMode || null,
      /*
        How the cost figure on this row was arrived at. Without this the
        drilldown could only ask "is estimatedCostUsd null?", which is false
        for a cache hit's legitimate 0 and so labelled genuinely-free items
        as "measured" next to an unexplained 0.0000.

          cached    -- served from cache, no Apify call, cost is a true zero
          measured  -- a real per-run Apify cost captured at scrape time
                       (reels only; see scrapeReels' costPerRequestedUsd)
          estimated -- the flat measured-rate estimate for the active method
      */
      fromCache: cached,
      // When the reused figure was originally scraped. Admin-only: it is how
      // you tell "free because we already had it" from "free because we are
      // serving a number that is a week stale", which is a cache-TTL
      // decision, not something a client ever needs to see.
      cachedAt: cached && cachedAt ? new Date(cachedAt) : null,
      costSource: result === 'success' ? (cached ? 'cached' : (costSource || 'estimated')) : null,
      estimatedCostUsd: result === 'success' ? (cached ? 0 : (estimatedCostUsd ?? null)) : 0,
      // Flattened, report-shaped metrics snapshot so admin exports don't need
      // to re-join against the job doc later.
      metrics: metrics ? {
        views: metrics.views ?? metrics.avgViews ?? 0,
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        reposts: metrics.reposts ?? 0,
        saves: metrics.saves ?? 0,
        er: metrics.er ?? metrics.avgEr ?? 0,
        followers: metrics.followers ?? 0,
      } : null,
      result, // success | failed | invalid
      at: new Date()
    });
    inserted = true;
  } catch (e) {
    if (e.code === 11000) {
      duplicate = true;
    } else {
      console.warn('[Ledger Service Error]', e.message);
    }
  }

  // Only counted for a genuinely new record -- a duplicate-blocked replay
  // must not inflate the day's stats a second time either.
  if (inserted) {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      await db.collection('usageStats').updateOne(
        { username, date: todayStr },
        {
          $inc: {
            [type === 'reel' ? 'reelJobs' : 'profileJobs']: 1,
            itemsProcessed: 1,
            [result === 'success' ? 'success' : 'failed']: 1
          }
        },
        { upsert: true }
      );
    } catch (e) {
      console.warn('[Ledger Service Error]', e.message);
    }
  }

  return { inserted, duplicate };
}

module.exports = { recordLedgerEntry };
