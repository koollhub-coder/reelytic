const { getDb } = require('../db');

async function recordLedgerEntry({ username, type, jobId, url, result, resolvedUsername, metrics, pipelineMode, estimatedCostUsd, fromCache, costSource, cachedAt }) {
  try {
    const db = getDb();
    const cached = result === 'success' && !!fromCache;
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

module.exports = { recordLedgerEntry };
