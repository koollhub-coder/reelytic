const { getDb, queryId } = require('../db');
const { scrapeReel, scrapeProfile, scrapeFollowers } = require('./apify.service');
const { getCached, setCache } = require('./cache.service');
const { computeReelMetrics, computeProfileMetrics } = require('./metrics.service');
const { recordLedgerEntry } = require('./ledger.service');
const { chargeSuccess, costPerItem } = require('./credits.service');
const { getLearnedAvgMs, recordJobTiming, DEFAULT_AVG_MS } = require('./learnedTiming.service');

const activeJobs = new Map(); // jobId -> { abort: boolean }

const REEL_BATCH = 3;
const PROFILE_BATCH = 2;

async function startJob(jobId) {
  const db = getDb();
  const jobsColl = db.collection('jobs');
  const job = await jobsColl.findOne({ _id: queryId(jobId) });
  if (!job || job.status === 'running') return;

  activeJobs.set(jobId, { abort: false });
  await jobsColl.updateOne({ _id: queryId(jobId) }, { $set: { status: 'running', pausedReason: null } });

  processJobLoop(jobId).catch(err => {
    console.error(`[JobEngine] Error in job ${jobId}:`, err);
    jobsColl.updateOne({ _id: queryId(jobId) }, { $set: { status: 'paused', pausedReason: 'error' } }).catch(() => { });
    activeJobs.delete(jobId);
  });
}

async function pauseJob(jobId) {
  const ctrl = activeJobs.get(jobId);
  if (ctrl) ctrl.abort = true;
  activeJobs.delete(jobId);
  const db = getDb();
  await db.collection('jobs').updateOne({ _id: queryId(jobId) }, { $set: { status: 'paused', pausedReason: 'user-paused' } });
}

async function processJobLoop(jobId) {
  const db = getDb();
  const jobsColl = db.collection('jobs');
  const ctrl = activeJobs.get(jobId);

  let job = await jobsColl.findOne({ _id: queryId(jobId) });
  if (!job) return;

  const batchSize = job.type === 'reel' ? REEL_BATCH : PROFILE_BATCH;
  let cursor = job.cursor || 0;
  let rows = job.rows;
  let counts = job.counts;
  let avgRowMs = job.avgRowMs || DEFAULT_AVG_MS[job.type] || 2500;

  // Map of URL -> result for handling duplicate rows instantly without re-fetching
  const duplicateUrlMap = new Map();
  for (const r of rows) {
    if (r.state === 'done' && r.result) {
      duplicateUrlMap.set(r.input.url, r.result);
    }
  }

  // Per-job followers cache: if the same creator appears in multiple rows
  // (very common in agency sheets -- one creator, many reels), we only pay
  // for one followers-actor call per creator per job, not one per row.
  const followersCache = new Map(); // username -> Promise<followerInfo|null>
  function getFollowersCached(username) {
    if (!username) return Promise.resolve(null);
    const key = username.toLowerCase();
    if (!followersCache.has(key)) {
      followersCache.set(key, scrapeFollowers(key).catch(() => null));
    }
    return followersCache.get(key);
  }

  while (cursor < rows.length) {
    if (!ctrl || ctrl.abort) {
      break;
    }

    // Check latest status in DB in case of pause
    const currentJobDoc = await jobsColl.findOne({ _id: queryId(jobId) });
    if (!currentJobDoc || currentJobDoc.status !== 'running') {
      break;
    }

    const batchSlice = [];
    for (let i = cursor; i < Math.min(cursor + batchSize, rows.length); i++) {
      batchSlice.push({ index: i, row: rows[i] });
    }

    const batchPromises = batchSlice.map(async ({ index, row }) => {
      const startTime = Date.now();
      if (row.state === 'invalid' || row.state === 'skipped') {
        return { index, state: row.state, error: row.error };
      }

      if (row.state === 'duplicate' || duplicateUrlMap.has(row.input.url)) {
        const cachedRes = duplicateUrlMap.get(row.input.url);
        if (cachedRes) {
          return { index, state: 'done', result: cachedRes, fromCache: true, ms: 50 };
        }
      }

      try {
        // Check cache first
        let result = await getCached(row.input.url, job.type);
        let fromCache = true;

        if (!result) {
          fromCache = false;

          if (job.type === 'reel') {
            const rawItem = await scrapeReel(row.input.url);
            // Followers aren't in the reel actor's own output -- pull the
            // creator's username from the scraped reel, then use the shared
            // per-job cache so the same creator's followers aren't re-fetched
            // for every one of their reels in this batch.
            const followerInfo = await getFollowersCached(rawItem.ownerUsername);
            result = computeReelMetrics(rawItem, followerInfo);
          } else {
            const posts = await scrapeProfile(row.input.url);
            const username = posts && posts[0] && posts[0].ownerUsername;
            // Separate, smaller call -- if this fails for any reason the
            // report still completes, just without a Followers number.
            const followerInfo = await getFollowersCached(username);
            result = computeProfileMetrics(posts, followerInfo);
          }

          await setCache(row.input.url, job.type, result);
        }

        duplicateUrlMap.set(row.input.url, result);
        const ms = Date.now() - startTime;
        return { index, state: 'done', result, fromCache, ms };
      } catch (err) {
        const ms = Date.now() - startTime;
        return { index, state: 'failed', error: err.message || 'Scraping failed', ms };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    let batchSuccessCount = 0;
    let batchFailedCount = 0;
    let totalBatchMs = 0;

    for (const res of batchResults) {
      const row = rows[res.index];
      row.state = res.state;
      if (res.state === 'done') {
        row.result = res.result;
        row.fromCache = res.fromCache;
        row.error = null;
        counts.success++;
        counts.processed++;
        batchSuccessCount++;
        recordLedgerEntry({ username: job.ownerUsername, type: job.type, jobId, url: row.input.url, result: 'success' });
        // Charge credits per successful item (failures are free).
        chargeSuccess(job.ownerUsername, job.type).catch(() => { });
        counts.creditsSpent = (counts.creditsSpent || 0) + costPerItem(job.type);
      } else if (res.state === 'failed') {
        row.error = res.error;
        counts.failed++;
        counts.processed++;
        batchFailedCount++;
        recordLedgerEntry({ username: job.ownerUsername, type: job.type, jobId, url: row.input.url, result: 'failed' });
      } else if (res.state === 'invalid') {
        recordLedgerEntry({ username: job.ownerUsername, type: job.type, jobId, url: row.input.url, result: 'invalid' });
      }
      if (res.ms) totalBatchMs += res.ms;
    }

    cursor += batchSlice.length;
    const batchAvg = batchSlice.length > 0 ? totalBatchMs / batchSlice.length : 1500;
    avgRowMs = Math.round((avgRowMs * 0.7) + (batchAvg * 0.3));

    // Update DB atomically
    await jobsColl.updateOne(
      { _id: queryId(jobId) },
      {
        $set: {
          rows,
          counts,
          cursor,
          avgRowMs,
          updatedAt: new Date()
        }
      }
    );

    // Breather between batches
    await new Promise(r => setTimeout(r, 250));
  }

  // Check if job finished
  const finalCheck = await jobsColl.findOne({ _id: queryId(jobId) });
  if (finalCheck && finalCheck.cursor >= finalCheck.rows.length && finalCheck.status === 'running') {
    await jobsColl.updateOne(
      { _id: queryId(jobId) },
      { $set: { status: 'done', finishedAt: new Date(), updatedAt: new Date() } }
    );
    recordJobTiming(finalCheck.type, finalCheck.avgRowMs).catch(() => { });
  }

  activeJobs.delete(jobId);
}

async function resetJob(jobId) {
  await pauseJob(jobId);
  const db = getDb();
  const jobsColl = db.collection('jobs');
  const job = await jobsColl.findOne({ _id: queryId(jobId) });
  if (!job) return;

  const rows = job.rows.map(r => ({
    ...r,
    state: r.state === 'invalid' || r.state === 'duplicate' || r.state === 'skipped' ? r.state : 'pending',
    result: undefined,
    error: r.state === 'invalid' || r.state === 'duplicate' || r.state === 'skipped' ? r.error : null,
    fromCache: false
  }));

  const counts = {
    total: rows.length,
    processed: 0,
    failed: job.counts.invalid + job.counts.duplicates,
    success: 0,
    skipped: job.counts.skipped || 0
  };
  const learnedAvgMs = await getLearnedAvgMs(job.type);
  await jobsColl.updateOne(
    { _id: queryId(jobId) },
    {
      $set: {
        status: 'preview',
        cursor: 0,
        rows,
        counts,
        avgRowMs: learnedAvgMs,
        finishedAt: null,
        updatedAt: new Date()
      }
    }
  );
}

async function retryFailedRows(jobId) {
  const db = getDb();
  const jobsColl = db.collection('jobs');
  const job = await jobsColl.findOne({ _id: queryId(jobId) });
  if (!job) return;

  const rows = job.rows.map(r => {
    if (r.state === 'failed') {
      return { ...r, state: 'pending', error: null };
    }
    return r;
  });

  const failedCount = job.counts.failed;
  const counts = {
    ...job.counts,
    failed: job.counts.failed - failedCount,
    processed: job.counts.processed - failedCount
  };

  await jobsColl.updateOne(
    { _id: queryId(jobId) },
    { $set: { rows, counts, status: 'running' } }
  );

  startJob(jobId);
}

module.exports = { startJob, pauseJob, resetJob, retryFailedRows };