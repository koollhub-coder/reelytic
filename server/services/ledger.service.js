const { getDb } = require('../db');

async function recordLedgerEntry({ username, type, jobId, url, result, resolvedUsername, metrics, pipelineMode, estimatedCostUsd, fromCache }) {
  try {
    const db = getDb();
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
      estimatedCostUsd: result === 'success' ? (fromCache ? 0 : (estimatedCostUsd ?? null)) : 0,
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
