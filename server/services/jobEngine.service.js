const { getDb, queryId } = require('../db');
const { scrapeReels, scrapeProfilesBatch, scrapeProfilesBatchV2, scrapeFollowersBatch, scrapeFollowersBatchExpress, scrapeFollowersBatchWithCost, extractUsername } = require('./apify.service');
const { getCached, setCache } = require('./cache.service');
const { computeReelMetrics, computeProfileMetrics, computeProfileMetricsV2 } = require('./metrics.service');
const { recordLedgerEntry } = require('./ledger.service');
const { estimateItemCostUsd, REEL_STANDARD_COST_USD, REEL_EXPRESS_COST_USD } = require('./costEstimate.service');
const { chargeSuccess, costPerItem } = require('./credits.service');
const { getLearnedAvgMs, recordJobTiming, DEFAULT_AVG_MS } = require('./learnedTiming.service');

const activeJobs = new Map(); // jobId -> { abort: boolean }

// Reels: one analytics-actor run covers this many reels, amortizing its
// per-run start fee across the batch instead of paying it per reel (margin-critical).
const REEL_BATCH_SIZE = Number(process.env.REEL_BATCH_SIZE || 15);
// Profiles: usernames per post-scraper/followers-actor run.
const PROFILE_BATCH_SIZE = Number(process.env.PROFILE_BATCH_SIZE || 5);
// How many profile-actor batches run concurrently (rate-limit safety cap).
const PROFILE_CONCURRENCY = Number(process.env.PROFILE_CONCURRENCY || 3);

async function startJob(jobId) {
  const db = getDb();
  const jobsColl = db.collection('jobs');
  const job = await jobsColl.findOne({ _id: queryId(jobId) });
  if (!job || job.status === 'running') return;

  activeJobs.set(jobId, { abort: false });
  // Only stamp startedAt on the very first start -- resuming from pause must
  // not reset the clock, so "processing time" on completion reflects the
  // whole run, not just the time since the last resume.
  const update = { status: 'running', pausedReason: null };
  if (!job.startedAt) update.startedAt = new Date();
  await jobsColl.updateOne({ _id: queryId(jobId) }, { $set: update });

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

/*
  Resolves everything in a reel batch that needs an actual Apify call in ONE
  scrapeReels() run (instead of one call per reel -- this is the margin-critical
  change, see apify.service.js scrapeReels() cost note). Invalid/skipped rows
  pass straight through; duplicate rows get a free copy of the result they
  duplicate (no Apify call, no charge) rather than being re-scraped.
*/
async function processReelBatch(batchSlice, pipelineMode) {
  const results = [];
  const toScrape = [];

  for (const item of batchSlice) {
    const { index, row } = item;
    if (row.state === 'invalid' || row.state === 'skipped') {
      results.push({ index, state: row.state, error: row.error });
    } else if (row.state === 'duplicate') {
      results.push({ index, state: 'duplicate' });
    } else if (row.state === 'done') {
      // Already succeeded in an earlier pass (retry-failed resuming through
      // rows interspersed with ones that were never touched) -- carry through
      // as-is, no re-scrape, no re-charge.
      results.push({ index, state: 'already-done' });
    } else {
      toScrape.push(item);
    }
  }

  if (toScrape.length === 0) return results;

  // Per-URL result cache (cheap local/db lookup, not an Apify call) -- safe to
  // check in parallel for the whole batch before touching Apify at all.
  const cacheChecks = await Promise.all(toScrape.map(({ row }) => getCached(row.input.url, 'reel')));
  const needFetch = [];
  toScrape.forEach((item, i) => {
    if (cacheChecks[i]) {
      results.push({ index: item.index, state: 'done', result: cacheChecks[i], fromCache: true });
    } else {
      needFetch.push(item);
    }
  });

  if (needFetch.length === 0) return results;

  const urls = needFetch.map(({ row }) => row.input.url);
  let matched;
  try {
    // scrapeReels() already resolves /share/ links and aligns its response
    // back to `urls` order/length (null for anything that didn't come back).
    matched = await scrapeReels(urls);
  } catch (err) {
    const msg = err.message || 'Scraping failed';
    for (const { index } of needFetch) results.push({ index, state: 'failed', error: msg });
    return results;
  }

  // Followers aren't in the reel actor's own output -- collect the distinct
  // creators in this batch and fetch their follower counts in ONE call
  // rather than one per reel (the same creator posting many reels is common
  // in agency sheets).
  const creatorUsernames = [...new Set(matched.filter(Boolean).map(it => it.ownerUsername).filter(Boolean))];
  // Standard: scrapeFollowersBatchWithCost -- same actor/data as
  // scrapeFollowersBatch, real cost captured. Express: its own hybrid,
  // real cost only on whatever falls back to the paid actor (the free fast
  // path is treated as $0, matching every real run measured so far).
  const followersFn = pipelineMode === 'express' ? scrapeFollowersBatchExpress : scrapeFollowersBatchWithCost;
  const followersMap = creatorUsernames.length
    ? await followersFn(creatorUsernames).catch(() => new Map())
    : new Map();

  // Per-item cost: REAL spend for this exact batch on both halves -- the
  // analytics call (scrapeReels' costPerRequestedUsd) and the follower
  // lookup (followersMap.costPerRequestedUsd), both captured via Apify's
  // async run API, not estimated. Falls back to the flat rate constants
  // only if a cost figure is somehow missing (e.g. the followers call threw
  // and got swallowed above).
  const analyticsPerItemUsd = matched.costPerRequestedUsd != null
    ? matched.costPerRequestedUsd
    : (pipelineMode === 'express' ? REEL_EXPRESS_COST_USD : REEL_STANDARD_COST_USD);
  // Divided across every reel in THIS batch, not per unique creator -- a
  // creator posting multiple reels in one batch only gets looked up once,
  // so spreading their lookup cost across just their own reels would
  // double-count it against the other reels in the same batch.
  const followerPerItemUsd = followersMap.usageTotalUsd != null && needFetch.length > 0
    ? followersMap.usageTotalUsd / needFetch.length
    : 0;
  const itemCostUsd = analyticsPerItemUsd + followerPerItemUsd;

  needFetch.forEach(({ index, row }, i) => {
    const rawItem = matched[i];
    if (!rawItem) {
      results.push({ index, state: 'failed', error: 'Instagram returned no data for this link' });
      return;
    }
    const followerInfo = rawItem.ownerUsername ? (followersMap.get(rawItem.ownerUsername.toLowerCase()) || null) : null;
    const result = computeReelMetrics(rawItem, followerInfo);
    setCache(row.input.url, 'reel', result).catch(() => { });
    results.push({ index, state: 'done', result, fromCache: false, costUsd: itemCostUsd });
  });

  return results;
}

/*
  pipelineMode is read ONCE per job (see processJobLoop) and threaded down
  here rather than re-read per chunk -- it's a global setting, not something
  that should change mid-job, and re-reading per chunk would just be
  redundant DB traffic.
  Legacy: two calls (profile posts + a separate followers call).
  V2: one call bundles followers on every row -- calling scrapeFollowersBatch
  for v2 would be a wasted second call defeating its entire cost advantage.
*/
async function processProfileChunk(chunk, pipelineMode) {
  const usernames = chunk.map(({ row }) => extractUsername(row.input.url));
  let profilesMap;
  let followersMap = new Map();
  try {
    if (pipelineMode === 'v2') {
      profilesMap = await scrapeProfilesBatchV2(usernames);
    } else {
      [profilesMap, followersMap] = await Promise.all([
        scrapeProfilesBatch(usernames),
        scrapeFollowersBatch(usernames).catch(() => new Map())
      ]);
    }
  } catch (err) {
    const msg = err.message || 'Scraping failed';
    return chunk.map(({ index }) => ({ index, state: 'failed', error: msg }));
  }

  return chunk.map(({ index, row }, i) => {
    const key = usernames[i].toLowerCase();
    const profile = profilesMap.get(key);
    if (!profile || profile.candidatesFetched === 0) {
      return { index, state: 'failed', error: 'Instagram returned no data for this profile' };
    }
    const followerInfo = pipelineMode === 'v2' ? (profile.followerInfo || null) : (followersMap.get(key) || null);
    const metricsFn = pipelineMode === 'v2' ? computeProfileMetricsV2 : computeProfileMetrics;
    const result = metricsFn(profile.posts, followerInfo, {
      reelsSkippedAsOutliers: profile.reelsSkippedAsOutliers,
      candidates: profile.candidates,
    });
    setCache(row.input.url, 'profile', result).catch(() => { });
    return { index, state: 'done', result, fromCache: false };
  });
}

/*
  Same idea as processReelBatch but chunked into PROFILE_BATCH_SIZE usernames
  per Apify call, with up to PROFILE_CONCURRENCY chunks in flight at once --
  this is what brings a 10-15 profile job down from ~10 minutes (previously
  fully sequential, one profile-actor call + one followers-actor call each).
*/
async function processProfileBatch(batchSlice, pipelineMode) {
  const results = [];
  const toScrape = [];

  for (const item of batchSlice) {
    const { index, row } = item;
    if (row.state === 'invalid' || row.state === 'skipped') {
      results.push({ index, state: row.state, error: row.error });
    } else if (row.state === 'duplicate') {
      results.push({ index, state: 'duplicate' });
    } else if (row.state === 'done') {
      results.push({ index, state: 'already-done' });
    } else {
      toScrape.push(item);
    }
  }

  if (toScrape.length === 0) return results;

  const cacheChecks = await Promise.all(toScrape.map(({ row }) => getCached(row.input.url, 'profile')));
  const needFetch = [];
  toScrape.forEach((item, i) => {
    if (cacheChecks[i]) {
      results.push({ index: item.index, state: 'done', result: cacheChecks[i], fromCache: true });
    } else {
      needFetch.push(item);
    }
  });

  if (needFetch.length === 0) return results;

  const chunks = [];
  for (let i = 0; i < needFetch.length; i += PROFILE_BATCH_SIZE) {
    chunks.push(needFetch.slice(i, i + PROFILE_BATCH_SIZE));
  }

  for (let i = 0; i < chunks.length; i += PROFILE_CONCURRENCY) {
    const wave = chunks.slice(i, i + PROFILE_CONCURRENCY);
    const waveResults = await Promise.all(wave.map(chunk => processProfileChunk(chunk, pipelineMode)));
    for (const chunkResult of waveResults) results.push(...chunkResult);
  }

  return results;
}

async function processJobLoop(jobId) {
  const db = getDb();
  const jobsColl = db.collection('jobs');
  const ctrl = activeJobs.get(jobId);

  let job = await jobsColl.findOne({ _id: queryId(jobId) });
  if (!job) return;

  const batchSize = job.type === 'reel' ? REEL_BATCH_SIZE : PROFILE_BATCH_SIZE * PROFILE_CONCURRENCY;
  // Pinned on the job doc at creation (upload.routes.js), not re-read here --
  // keeps one report internally consistent even if paused/resumed across an
  // admin toggle flip. Older jobs predating this field default to legacy.
  const pipelineMode = job.profilePipelineMode || 'legacy';
  const reelPipelineMode = job.reelPipelineMode || 'standard';
  let cursor = job.cursor || 0;
  let rows = job.rows;
  let counts = job.counts;
  let avgRowMs = job.avgRowMs || DEFAULT_AVG_MS[job.type] || 2500;

  // Map of URL -> result, so a duplicate row can show a free copy of the
  // metrics it duplicates without a second Apify call or credit charge.
  const duplicateUrlMap = new Map();
  for (const r of rows) {
    if (r.state === 'done' && r.result) {
      duplicateUrlMap.set(r.input.url, r.result);
    }
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

    const batchStart = Date.now();
    const batchResults = job.type === 'reel'
      ? await processReelBatch(batchSlice, reelPipelineMode)
      : await processProfileBatch(batchSlice, pipelineMode);
    const totalBatchMs = Date.now() - batchStart;

    // Computed once per batch (not per row) -- avoids a DB read per success,
    // and the pipeline mode is already fixed for the whole job anyway.
    const batchPipelineMode = job.type === 'reel' ? reelPipelineMode : pipelineMode;
    const itemCostUsd = await estimateItemCostUsd(job.type, batchPipelineMode);

    for (const res of batchResults) {
      const row = rows[res.index];
      row.state = res.state;
      // Every row that reaches here has been handled (incl. invalid/duplicate/
      // skipped), so this is what makes the progress bar reach 100%.
      counts.processed++;

      if (res.state === 'done') {
        row.result = res.result;
        row.fromCache = res.fromCache;
        row.error = null;
        counts.success++;
        recordLedgerEntry({
          username: job.ownerUsername, type: job.type, jobId, url: row.input.url, result: 'success',
          resolvedUsername: res.result && res.result.username, metrics: res.result,
          pipelineMode: batchPipelineMode,
          // Reel: res.costUsd carries the real per-batch analytics spend
          // (see processReelBatch) -- only fall back to the flat estimate
          // if it's somehow missing. Profile: still the flat estimate.
          estimatedCostUsd: res.costUsd != null ? res.costUsd : itemCostUsd,
          fromCache: res.fromCache,
        });
        // Charge credits per successful item (failures are free).
        chargeSuccess(job.ownerUsername, job.type).catch(() => { });
        counts.creditsSpent = (counts.creditsSpent || 0) + costPerItem(job.type);
        duplicateUrlMap.set(row.input.url, res.result);
      } else if (res.state === 'failed') {
        row.error = res.error;
        counts.failed++;
        recordLedgerEntry({ username: job.ownerUsername, type: job.type, jobId, url: row.input.url, result: 'failed' });
      } else if (res.state === 'duplicate') {
        // Never scraped, never charged -- just a free preview of the row it duplicates.
        row.result = duplicateUrlMap.get(row.input.url) || row.result;
        row.fromCache = true;
      } else if (res.state === 'invalid') {
        recordLedgerEntry({ username: job.ownerUsername, type: job.type, jobId, url: row.input.url, result: 'invalid' });
      } else if (res.state === 'already-done') {
        // Already counted (success/credits/ledger) in an earlier pass -- row stays as-is.
        row.state = 'done';
      }
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
    ...job.counts,
    processed: 0,
    failed: 0,
    success: 0,
    creditsSpent: 0
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
        startedAt: null,
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

  // Resume the cursor at the earliest row that now needs (re-)processing.
  // Rows before it are all still in a terminal state (done/invalid/duplicate/
  // skipped), so counting them as already-processed keeps the progress bar
  // accurate; rows from here on are re-walked by processJobLoop, which passes
  // already-'done' rows through for free (see processReelBatch/ProfileBatch)
  // so nothing already successful gets re-scraped or re-charged.
  const firstPendingIdx = rows.findIndex(r => r.state === 'pending');
  const resumeCursor = firstPendingIdx === -1 ? rows.length : firstPendingIdx;

  const counts = {
    ...job.counts,
    failed: 0,
    processed: resumeCursor
  };

  await jobsColl.updateOne(
    { _id: queryId(jobId) },
    { $set: { rows, counts, cursor: resumeCursor, status: 'running' } }
  );

  startJob(jobId);
}

module.exports = { startJob, pauseJob, resetJob, retryFailedRows };