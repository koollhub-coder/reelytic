const config = require('../config');
const { getV2FetchDepth } = require('./profilePipeline.service');

const REEL_ACTOR = 'apify~instagram-reel-scraper';
// Full-metrics actor: returns share_count / repost_count / save_count, which the
// stock reel scraper does not reliably return. Verified real output 2026-07-23.
const REEL_ANALYTICS_ACTOR = 'patient_discovery~instagram-reel-analytics-by-url';
// Which actor powers reel reports. 'analytics' = full metrics (shares/reposts),
// 'basic' = the older cheaper actor without shares. Override via .env REEL_ACTOR.
const REEL_MODE = String(process.env.REEL_ACTOR || 'analytics').toLowerCase();
// The analytics actor's input field name. Confirm via Apify Console -> Input tab
// -> API button, and override here if it differs.
const REEL_ANALYTICS_INPUT_FIELD = process.env.REEL_ANALYTICS_INPUT_FIELD || 'postUrls';
const PROFILE_ACTOR = 'apify~instagram-post-scraper';
const FOLLOWERS_ACTOR = 'apify~instagram-followers-count-scraper';

// Profile reports must land a stable count of "normal" reels rather than
// whatever N happened to come back, and a single viral outlier shouldn't
// blow up the average. See selectProfileReels() below.
const PROFILE_FETCH_MAX = Number(process.env.PROFILE_FETCH_MAX || 12);
// V2 (Express) trims the top/bottom TRIM_PCT of fetched reels by view count
// (in log space -- see selectProfileReelsV2) rather than hard-excluding
// anything past a fixed multiplier of the median. Validated offline against
// already-paid-for real Apify data (2026-07-29): at a fetch depth of 8, this
// keeps the worst-case reported-average error to roughly a third of what the
// legacy median+3x-band method produces at the same fetch depth, so cutting
// the fetch cost doesn't cost as much accuracy as it otherwise would.
const PROFILE_V2_TRIM_PCT = Number(process.env.PROFILE_V2_TRIM_PCT || 0.15);
const OUTLIER_MULTIPLIER = Number(process.env.OUTLIER_MULTIPLIER || 3);
// Two-sided outlier exclusion (drop unusually LOW performers too, not just
// viral spikes) is standard practice among creator-analytics tools -- default
// changed to on. Still overridable via .env for an instant rollback.
const OUTLIER_LOWER_BOUND_ENABLED = String(process.env.OUTLIER_LOWER_BOUND_ENABLED ?? 'true').toLowerCase() === 'true';
const PROFILE_TARGET_REELS = 6;

/*
  Below this many organic (post-filter) reels, a profile's average is
  reported with a caveat rather than presented as equal in confidence to
  every other row. Matches the admin panel's own floor on the fetch-depth
  input (min=4) -- that number was already treated as the edge of usable
  before this constant existed.

  V2 ONLY. Used two ways, by design the same threshold both times:
    1. scrapeProfilesBatchV2 below: below this AND the account's own recent
       history could plausibly hold more (Apify gave us everything we asked
       for), it is worth ONE wider re-fetch before giving up.
    2. jobEngine.service.js: after that re-fetch (or the decision to skip
       it), still below this means the row reports as-is but carries
       lowSample: true so the client sees the caveat instead of a number
       that looks exactly as confident as an 8-post average.
*/
const PROFILE_MIN_RELIABLE_SAMPLE = Number(process.env.PROFILE_MIN_RELIABLE_SAMPLE || 4);
// How much wider the one retry asks, and the hard ceiling on that ask --
// doubling an already-generous depth should never turn into an unbounded
// or surprisingly expensive single call.
const RETRY_FETCH_MULTIPLIER = 2;
const RETRY_FETCH_MAX_DEPTH = 30;

/*
  Both reel actors are normalized into ONE flat shape so metrics.service.js
  never has to care which actor ran:
    views, likes, comments, shares, reposts, saves,
    ownerUsername, ownerFullName, shortCode, url, timestamp
  The analytics actor nests everything under `metrics` / `user`; the stock actor
  is already flat. Missing values stay undefined (never faked).
*/
function normalizeReelItem(item) {
  if (!item || typeof item !== 'object') return item;
  const m = item.metrics;
  if (!m || typeof m !== 'object') return item; // stock actor: already flat

  const u = item.user || {};
  return {
    ...item,
    // views: this actor exposes plays; view_count is frequently null.
    videoPlayCount: m.play_count ?? m.ig_play_count ?? undefined,
    videoViewCount: m.view_count ?? undefined,
    likesCount: m.like_count ?? undefined,
    commentsCount: m.comment_count ?? undefined,
    sharesCount: m.share_count ?? undefined,
    repostCount: m.repost_count ?? undefined,
    saveCount: m.save_count ?? undefined,
    ownerUsername: u.username || item.ownerUsername,
    ownerFullName: u.full_name || item.ownerFullName,
    ownerFollowersCount: m.user_follower_count ?? undefined,
    shortCode: item.code || item.shortCode,
    url: item.url || (item.code ? `https://www.instagram.com/reel/${item.code}/` : undefined),
    timestamp: item.taken_at_date || item.timestamp,
  };
}


async function fetchFromApify(actorId, actorInput, retries = 2, timeoutMs = 120000) {
  const apiKey = config.apifyApiKey;
  if (!apiKey || apiKey === 'your_apify_api_key_here' || apiKey === 'mock_apify_key') {
    throw new Error('Scraping service is not configured. Contact an administrator to add API credentials.');
  }

  // Actor IDs stay in "owner~name" form as-is -- Apify's API requires the tilde,
  // converting it to a slash breaks the URL (this bit us once already).
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}`;

  // for (let attempt = 0; attempt <= retries; attempt++) {
  //   const controller = new AbortController();
  //   const timeout = setTimeout(() => controller.abort(), 120000);

  //   try {
  //     const response = await fetch(url, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify(actorInput),
  //       signal: controller.signal
  //     });
  //     clearTimeout(timeout);

  //     if (!response.ok) {
  //       if ((response.status >= 500 || response.status === 429) && attempt < retries) {
  //         await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
  //         continue;
  //       }
  //       const text = await response.text();
  //       throw new Error(`Apify error HTTP ${response.status}: ${text}`);
  //     }

  //     const items = await response.json();
  //     const arr = Array.isArray(items) ? items : [items];
  //     console.log('[Apify Raw Response Item]:', JSON.stringify(arr[0], null, 2));
  //     return arr;
  //   } catch (err) {
  //     clearTimeout(timeout);
  //     if (attempt === retries) {
  //       throw new Error(err.message || 'Apify network request failed');
  //     }
  //     await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
  //   }
  // }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const callStart = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actorInput),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const elapsedMs = Date.now() - callStart;
      console.log(`[Apify Timing] ${actorId} attempt ${attempt + 1}/${retries + 1} -- HTTP ${response.status} in ${elapsedMs}ms`);

      if (!response.ok) {
        if ((response.status >= 500 || response.status === 429) && attempt < retries) {
          console.log(`[Apify Retry] ${actorId} -- retrying after ${(attempt + 1) * 2000}ms backoff`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
          continue;
        }
        await response.text();
        throw new Error(`Scraping request failed (HTTP ${response.status})`);
      }

      const items = await response.json();
      const arr = Array.isArray(items) ? items : [items];
      console.log('[Apify Raw Response Item]:', JSON.stringify(arr[0], null, 2));
      return arr;
    } catch (err) {
      clearTimeout(timeout);
      const elapsedMs = Date.now() - callStart;
      console.log(`[Apify Timing] ${actorId} attempt ${attempt + 1}/${retries + 1} -- FAILED after ${elapsedMs}ms: ${err.message}`);
      if (attempt === retries) {
        throw new Error('Could not reach the scraping service. Please try again.');
      }
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
    }
  }
}

/*
  Same job as fetchFromApify, but via Apify's async run API (start -> poll ->
  read dataset) instead of the run-sync-get-dataset-items convenience
  endpoint -- the sync endpoint never exposes a run id in its response
  (checked: no id in the body or headers), so it's structurally impossible
  to look up what a sync call actually cost after the fact. This is slightly
  slower (a few extra round trips) but returns the REAL, exact usageTotalUsd
  Apify billed for the run, not an estimate. Used where real per-call cost
  attribution matters (reel reports, see costEstimate.service.js's Express
  reel rates going away in favor of this). Bounded like fetchFromApify: no
  open-ended retries, a hard poll timeout, so a struggling actor can't hang
  a batch the way the original follower fast-path bug did.
*/
async function fetchFromApifyWithCost(actorId, actorInput, { retries = 1, pollTimeoutMs = 150000 } = {}) {
  const apiKey = config.apifyApiKey;
  if (!apiKey || apiKey === 'your_apify_api_key_here' || apiKey === 'mock_apify_key') {
    throw new Error('Scraping service is not configured. Contact an administrator to add API credentials.');
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actorInput),
      });
      if (!startRes.ok) throw new Error(`Scraping request failed to start (HTTP ${startRes.status})`);
      const { data: started } = await startRes.json();

      const pollStart = Date.now();
      let run = started;
      while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) {
        if (Date.now() - pollStart > pollTimeoutMs) throw new Error('Scraping run took too long');
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${started.id}?token=${apiKey}`);
        if (!pollRes.ok) throw new Error(`Could not check scraping run status (HTTP ${pollRes.status})`);
        run = (await pollRes.json()).data;
      }
      if (run.status !== 'SUCCEEDED') throw new Error(`Scraping run did not succeed (status: ${run.status})`);

      // usageTotalUsd can lag a few seconds behind the status flip to
      // SUCCEEDED (confirmed empirically during this project's cost
      // investigation) -- re-fetch once after a short wait so the cost
      // figure is the real, settled one.
      await new Promise((r) => setTimeout(r, 6000));
      const finalRes = await fetch(`https://api.apify.com/v2/actor-runs/${started.id}?token=${apiKey}`);
      const finalRun = finalRes.ok ? (await finalRes.json()).data : run;

      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${finalRun.defaultDatasetId}/items?token=${apiKey}&clean=true`);
      if (!itemsRes.ok) throw new Error(`Could not read scraping results (HTTP ${itemsRes.status})`);
      const items = await itemsRes.json();

      return { items: Array.isArray(items) ? items : [items], usageTotalUsd: finalRun.usageTotalUsd || 0, runId: started.id };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    }
  }
  throw new Error(lastErr?.message || 'Could not reach the scraping service. Please try again.');
}

async function scrapeReel(url) {
  const items = await scrapeReels([url]);
  const item = items[0];
  if (!item) throw new Error('Instagram returned no data for this reel');
  return item;
}

const SHARE_LINK_RE = /\/share\//i;
const SHORTCODE_RE = /\/(?:reel|reels|p)\/([a-zA-Z0-9_-]+)/;

function extractShortcode(url) {
  const m = String(url || '').match(SHORTCODE_RE);
  return m ? m[1] : null;
}

/*
  /share/{code} and /share/reel/{code} are redirect wrappers -- the code in
  the URL is NOT the real shortcode (confirmed: a share link that opens fine
  in a browser and resolves fine via the Apify console was still failing
  through this pipeline, because batch results couldn't be matched back to
  it). Instagram serves the redirect on a plain GET, so following it here
  gets the canonical /reel/{code} URL before the actor ever sees it -- both
  for a cleaner actor input and so the real shortcode is known for matching.
*/
async function resolveShareLink(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      }
    });
    clearTimeout(timeout);
    return res.url || url;
  } catch (err) {
    console.warn(`[Apify] Could not resolve share link ${url}: ${err.message}`);
    return url; // fall back to the original -- let the actor try it as-is
  }
}

/*
  Aligns a batch actor response back to the ORIGINAL input urls/order (jobEngine
  tracks rows by the url the user submitted, not the resolved one). Matches by
  shortcode first (most reliable -- works even if the actor reorders or the
  input was a resolved share link), then by the actor's own echoed url, then
  falls back to positional matching only when the counts line up exactly.
*/
function alignReelResults(resolvedList, items) {
  const list = items || [];
  const byShortcode = new Map();
  const byUrl = new Map();
  for (const item of list) {
    const sc = item.shortCode || item.code;
    if (sc && !byShortcode.has(sc)) byShortcode.set(sc, item);
    if (item.url && !byUrl.has(item.url)) byUrl.set(item.url, item);
  }

  const positionalOk = list.length === resolvedList.length;

  return resolvedList.map((entry, idx) => {
    if (entry.shortcode && byShortcode.has(entry.shortcode)) return byShortcode.get(entry.shortcode);
    if (byUrl.has(entry.effective)) return byUrl.get(entry.effective);

    /*
      Positional matching is a LAST resort, and only when this entry gave us
      no identity to check against.

      Confirmed live: a request for the nonexistent reel "ZZZnonexistent99"
      came back in a 3-for-3 run, so positionalOk was true, and that row was
      handed @taapsee's unrelated reel DVEGQskiMcy -- 164,130 likes and 19.7M
      followers, against a link the client never submitted. Wrong-creator data
      in a client report is far worse than a row marked failed, and a failed
      row is recoverable through Retry failed.

      So: if we know the shortcode we wanted and it is not in the response,
      the answer is "no data", never "here is whatever came back in this
      slot".
    */
    if (entry.shortcode) return null;
    if (positionalOk) return list[idx];
    return null;
  });
}

/*
  Batch entry point. COST NOTE: the analytics actor bills a per-RUN start fee
  ($0.002) plus a per-result fee ($0.0025). One call per reel pays the start fee
  every single time ($0.0045/reel); batching N reels into one run amortizes it
  (50 reels -> ~$0.0025/reel). Always prefer batching for large jobs.

  Returns an array the SAME LENGTH and ORDER as `urls`, with `null` for any
  url that didn't come back -- callers don't need their own matching logic.
*/
async function scrapeReels(urls) {
  const list = Array.isArray(urls) ? urls : [urls];

  const resolvedList = await Promise.all(list.map(async (u) => {
    if (SHARE_LINK_RE.test(u)) {
      const resolved = await resolveShareLink(u);
      return { original: u, effective: resolved, shortcode: extractShortcode(resolved) };
    }
    return { original: u, effective: u, shortcode: extractShortcode(u) };
  }));
  const effectiveUrls = resolvedList.map(r => r.effective);

  let items;
  let runCostUsd = null;
  if (REEL_MODE === 'analytics') {
    const input = { [REEL_ANALYTICS_INPUT_FIELD]: effectiveUrls };
    // Real cost capture (see fetchFromApifyWithCost) -- powers the exact
    // per-reel spend breakdown on the Usage & Spend page, not an estimate.
    const { items: raw, usageTotalUsd } = await fetchFromApifyWithCost(REEL_ANALYTICS_ACTOR, input);
    items = (raw || []).map(normalizeReelItem);
    runCostUsd = usageTotalUsd;
  } else {
    // Legacy/basic actor -- cheaper, but does not return shares/reposts/saves.
    const raw = await fetchFromApify(REEL_ACTOR, {
      username: effectiveUrls,
      resultsLimit: effectiveUrls.length,
      includeSharesCount: true,
      skipPinnedPosts: false,
      skipTrialReels: false,
    });
    items = (raw || []).map(normalizeReelItem);
  }

  const aligned = alignReelResults(resolvedList, items);
  // Attached, not returned separately -- arrays are objects, so this rides
  // along without changing scrapeReels' return shape for any existing
  // caller. Pro-rated evenly across the requested urls (not just the ones
  // that matched) -- the actor was paid for attempting all of them.
  aligned.runCostUsd = runCostUsd;
  aligned.costPerRequestedUsd = runCostUsd != null && list.length > 0 ? runCostUsd / list.length : null;
  return aligned;
}

// A view count of null means genuinely hidden/missing (never coerced to 0 --
// summing a fabricated 0 into an average is exactly the corruption this
// guards against). -1 is a known Apify "hidden" sentinel on some actors.
function postViews(p) {
  const raw = p.videoPlayCount ?? p.playCount;
  if (raw === undefined || raw === null || raw === -1) return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

// Actors are inconsistent about the post-date field name (and unit: unix
// seconds vs ms vs ISO string) -- try known candidates, tolerant of all three
// formats. Falls back to 0 (oldest) with a warning if truly absent, so a
// missing field fails loud in logs rather than silently reordering results.
const TIMESTAMP_KEYS = ['timestamp', 'takenAtTimestamp', 'taken_at_timestamp', 'taken_at', 'taken_at_date', 'takenAt', 'date'];
function postTimestamp(p) {
  for (const k of TIMESTAMP_KEYS) {
    const v = p[k];
    if (v === undefined || v === null || v === '') continue;
    const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : new Date(v).getTime();
    if (!isNaN(t)) return t;
  }
  console.warn(`[Metrics] No timestamp field found for post ${p.shortCode || p.code || p.url || 'unknown'}, keys present:`, Object.keys(p).join(','));
  return 0;
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/*
  Picks the PROFILE_TARGET_REELS (6) reels a profile report should be built
  from, out of up to PROFILE_FETCH_MAX (12) fetched candidates:
    0. Exclude pinned posts and non-Reel posts (photos/carousels) up front.
    1. Sort the remaining candidates by post date, most-recent-first. THIS IS
       THE ROOT-CAUSE FIX for a confirmed live bug: the actor's raw return
       order is NOT reliably chronological (verified: the same actor returned
       pinned posts in Nov -> Aug -> Dec order), so without this sort, which
       reels end up in "the most recent 6" was luck of the draw. Confirmed on
       a real account: production picked a May 28 reel over the account's
       actual most recent (Jul 21) reel purely because of return order.
    2. Discard reels whose views are unusually high OR unusually low vs. the
       candidate median (two-sided -- see OUTLIER_MULTIPLIER/
       OUTLIER_LOWER_BOUND_ENABLED) -- this is standard practice among
       creator-analytics tools, not just a viral-spike guard.
    3. Take the most recent 6 of what's left ("normal" reels).
    4. If outlier removal left fewer than 6, backfill from the discarded
       outliers closest to the median (ties broken by recency) until back at
       6 (or out of candidates).
  Returns `selected` (the final 6, or fewer) plus `candidates`: EVERY post
  that was fetched, each tagged with why it was or wasn't included -- this
  powers both the transparency UI (Task 6) and the "how is this calculated"
  panel, so a client can see exactly which of a creator's recent posts were
  considered and why.
*/
function selectProfileReels(posts) {
  const allPosts = posts || [];
  const isReelPost = (p) => p.videoPlayCount !== undefined || p.playCount !== undefined;
  const anyReel = allPosts.some(p => !p.isPinned && isReelPost(p));

  // reasonFor: post -> final reason. Set once per post, overwritten only by
  // the very last pass (selected -> 'included') so every post ends up with
  // exactly one final status.
  const reasonFor = new Map();
  for (const p of allPosts) {
    if (p.paidPartnership === true) reasonFor.set(p, 'sponsored');
    else if (Array.isArray(p.coauthorProducers) && p.coauthorProducers.length > 0) reasonFor.set(p, 'collab');
    else if (p.isPinned) reasonFor.set(p, 'pinned');
    else if (anyReel && !isReelPost(p)) reasonFor.set(p, 'not_a_reel');
  }

  const videoPosts = allPosts.filter(p => !reasonFor.has(p));

  // Root-cause fix: sort by recency AFTER capping at the fetch limit -- the
  // actor's raw order is not reliably chronological (see comment above).
  const candidates = videoPosts.slice(0, PROFILE_FETCH_MAX).slice().sort((a, b) => postTimestamp(b) - postTimestamp(a));

  if (candidates.length === 0) {
    return { selected: [], reelsSkippedAsOutliers: 0, candidates: buildCandidateStatusList(allPosts, reasonFor) };
  }

  const withViews = [];
  for (const p of candidates) {
    if (postViews(p) === null) reasonFor.set(p, 'missing_views');
    else withViews.push(p);
  }

  const med = median(withViews.map(postViews));

  const normal = [];
  const outliers = [];
  for (const p of withViews) {
    const v = postViews(p);
    const tooHigh = med > 0 && v > med * OUTLIER_MULTIPLIER;
    const tooLow = OUTLIER_LOWER_BOUND_ENABLED && med > 0 && v < med / OUTLIER_MULTIPLIER;
    if (tooHigh) { outliers.push(p); reasonFor.set(p, 'outlier_high'); }
    else if (tooLow) { outliers.push(p); reasonFor.set(p, 'outlier_low'); }
    else normal.push(p);
  }

  let selected = normal.slice(0, PROFILE_TARGET_REELS);
  for (const p of normal.slice(PROFILE_TARGET_REELS)) reasonFor.set(p, 'beyond_top_6');

  let backfilledCount = 0;
  if (selected.length < PROFILE_TARGET_REELS && outliers.length > 0) {
    const need = PROFILE_TARGET_REELS - selected.length;
    // Closest-to-median first; ties broken by recency (most-recent-first) --
    // backfill must also respect the date-sort fix above.
    const byClosenessToMedian = [...outliers].sort((a, b) => {
      const diff = Math.abs(postViews(a) - med) - Math.abs(postViews(b) - med);
      return diff !== 0 ? diff : postTimestamp(b) - postTimestamp(a);
    });
    const backfill = byClosenessToMedian.slice(0, need);
    backfilledCount = backfill.length;
    selected = selected.concat(backfill);
  }

  // Final pass: everything actually selected is 'included', overwriting any
  // outlier_high/outlier_low tag a backfilled item picked up above.
  for (const p of selected) reasonFor.set(p, 'included');

  return {
    selected,
    reelsSkippedAsOutliers: outliers.length - backfilledCount,
    candidates: buildCandidateStatusList(allPosts, reasonFor),
  };
}

/*
  V2 (Express) equivalent of selectProfileReels(), used ONLY by
  scrapeProfilesBatchV2 -- the legacy pipeline's selectProfileReels() above is
  completely untouched by this.

  V2 fetches fewer candidates than legacy (default 8, see
  profilePipeline.service.js's V2 fetch depth setting) to cut cost, but a
  smaller candidate pool makes median+3x-band hard exclusion unstable -- one
  borderline reel flipping in or out of the band swings the whole average
  (this was measured directly: up to a 375% swing on individual accounts at a
  fetch depth of 6 using the legacy method). Instead this:
    1. Excludes pinned posts and anything with no usable view count (same as
       legacy).
    2. Sorts the rest by view count in LOG space (view counts are
       approximately log-normal -- a 10x viral reel is a mild outlier in log
       space instead of a catastrophic one in linear space).
    3. Trims the bottom and top PROFILE_V2_TRIM_PCT (15% each side by
       default) instead of hard-excluding past a fixed multiplier -- this
       degrades gracefully as the candidate pool shrinks, rather than
       flipping badly at the margin.
    4. Averages the remainder in log space too (see computeProfileMetricsV2),
       which further dampens the influence of whatever's left near the edges.
  Validated offline against real, already-paid-for Apify data before this was
  written -- see the estimator bootstrap in this project's cost-reduction
  investigation.
*/
function selectProfileReelsV2(posts) {
  const allPosts = posts || [];
  const reasonFor = new Map();
  for (const p of allPosts) {
    if (p.isSponsored) reasonFor.set(p, 'sponsored');
    else if (p.isCollab) reasonFor.set(p, 'collab');
    else if (p.isPinned) reasonFor.set(p, 'pinned');
  }

  const withViews = [];
  for (const p of allPosts) {
    if (reasonFor.has(p)) continue;
    if (postViews(p) === null) reasonFor.set(p, 'missing_views');
    else withViews.push(p);
  }

  if (withViews.length === 0) {
    return { selected: [], reelsSkippedAsOutliers: 0, candidates: buildCandidateStatusList(allPosts, reasonFor) };
  }

  const byViewsAsc = [...withViews].sort((a, b) => postViews(a) - postViews(b));
  const trimCount = Math.floor(PROFILE_V2_TRIM_PCT * byViewsAsc.length);
  const trimmedLow = trimCount > 0 ? byViewsAsc.slice(0, trimCount) : [];
  const trimmedHigh = trimCount > 0 ? byViewsAsc.slice(byViewsAsc.length - trimCount) : [];
  const trimmedSet = new Set([...trimmedLow, ...trimmedHigh]);
  for (const p of trimmedLow) reasonFor.set(p, 'outlier_low');
  for (const p of trimmedHigh) reasonFor.set(p, 'outlier_high');

  const included = withViews.filter((p) => !trimmedSet.has(p));
  // Most-recent-first, matching legacy's presentation (same date-sort fix
  // applies here -- the actor's raw order is not reliably chronological).
  const selected = included.slice().sort((a, b) => postTimestamp(b) - postTimestamp(a));
  for (const p of selected) reasonFor.set(p, 'included');

  return {
    selected,
    reelsSkippedAsOutliers: trimmedSet.size,
    candidates: buildCandidateStatusList(allPosts, reasonFor),
  };
}

function buildCandidateStatusList(allPosts, reasonFor) {
  return allPosts.map(p => {
    const reason = reasonFor.get(p) || 'included';
    const ts = postTimestamp(p);
    return {
      shortCode: p.shortCode || p.code || '',
      url: p.url || (p.shortCode ? `https://www.instagram.com/reel/${p.shortCode}/` : ''),
      timestamp: ts ? new Date(ts).toISOString() : null,
      views: postViews(p),
      included: reason === 'included',
      reason,
    };
  }).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}

function extractUsername(urlOrUsername) {
  const match = String(urlOrUsername).match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return match ? match[1] : String(urlOrUsername).replace(/^@/, '').trim();
}

/*
  Batch entry point -- apify~instagram-post-scraper accepts multiple usernames
  per run, so N profiles in one job can share one actor call instead of N
  separate ones (this is the fix for 10-15 profile jobs taking 10+ minutes).
  Returns Map<lowercased username, { posts, reelsAnalyzed, reelsSkippedAsOutliers, candidatesFetched }>.
  A username absent from the actor's response still gets an entry with
  candidatesFetched: 0 so the caller can tell "fetched but empty" apart from
  "never came back."
*/
async function scrapeProfilesBatch(usernamesOrUrls) {
  const list = Array.isArray(usernamesOrUrls) ? usernamesOrUrls : [usernamesOrUrls];
  const clean = list.map(extractUsername);

  // Verified working input for apify~instagram-post-scraper (real test run,
  // $0.0027/post with detail -- pay-per-event pricing, confirmed twice).
  //
  // TODO: this actor needs a "Detailed data" flag set for videoPlayCount to
  // come through at all (confirmed: without it, views are missing). The
  // exact field name is NOT yet confirmed -- to get it: open this actor in
  // Apify Console -> Input tab -> set "How detailed do you want the data?"
  // to "Detailed data" -> click the "API" button (top right) -> copy the
  // JSON body shown there -> add that field into the object below.
  // Until then, profile reports will come back with views = 0.
  //
  // Cost cap: resultsLimit is per-username on this actor, so batching does
  // not raise the per-profile fetch cap -- still PROFILE_FETCH_MAX (12) each.
  const items = await fetchFromApify(PROFILE_ACTOR, {
    username: clean,
    resultsLimit: PROFILE_FETCH_MAX,
    skipPinnedPosts: true,
  });

  const byUser = new Map();
  for (const item of (items || [])) {
    const key = String(item.ownerUsername || '').toLowerCase();
    if (!key) continue;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(item);
  }

  const result = new Map();
  for (const uname of clean) {
    const key = uname.toLowerCase();
    const posts = byUser.get(key) || [];
    const { selected, reelsSkippedAsOutliers, candidates } = selectProfileReels(posts);
    result.set(key, {
      posts: selected,
      reelsAnalyzed: selected.length,
      reelsSkippedAsOutliers,
      candidatesFetched: posts.length,
      candidates,
    });
  }
  return result;
}

async function scrapeProfile(urlOrUsername) {
  const batch = await scrapeProfilesBatch([urlOrUsername]);
  const only = [...batch.values()][0];
  if (!only || only.candidatesFetched === 0) throw new Error('Instagram returned no data for this profile');
  return only;
}

/*
  Batch entry point -- same idea as scrapeProfilesBatch but for the followers
  actor. Returns Map<lowercased username, followerInfo|null>.
*/
async function scrapeFollowersBatch(usernamesOrUrls) {
  const list = Array.isArray(usernamesOrUrls) ? usernamesOrUrls : [usernamesOrUrls];
  const clean = list.map(extractUsername);

  // Verified real test: $0.0026/profile + $0.001 flat per run ~ $0.0036/profile.
  // Confirmed real output fields: followersCount, followsCount, userFullName,
  // userName, userUrl, userId.
  //
  // NOT verified: the input field name below ("usernames", plural) is a
  // best-effort guess based on this actor's own marketing copy -- the actual
  // Input tab wasn't checked for this one. If it's wrong, Apify will reject
  // the run immediately with a clear schema-validation error (visible in the
  // server console via the [Apify Raw Response Item] log, or as the thrown
  // error itself) -- check that the first time this runs for real.
  const items = await fetchFromApify(FOLLOWERS_ACTOR, { usernames: clean });

  const byUser = new Map();
  for (const item of (items || [])) {
    const key = String(item.userName || '').toLowerCase();
    if (key) byUser.set(key, item);
  }

  const result = new Map();
  for (const uname of clean) result.set(uname.toLowerCase(), byUser.get(uname.toLowerCase()) || null);
  return result;
}

async function scrapeFollowers(urlOrUsername) {
  const batch = await scrapeFollowersBatch([urlOrUsername]);
  return [...batch.values()][0] || null; // graceful degrade -- profile report still completes without follower count
}

// Reel reports only (both Standard and Express's fallback) -- captures the
// REAL per-run cost via the async API instead of estimating, same reasoning
// as scrapeReels' cost capture. The profile-facing scrapeFollowersBatch()
// above is untouched -- this is a separate function specifically so legacy
// profile reports keep their exact original sync call and timing.
async function fetchOfficialFollowersWithCost(usernames) {
  if (usernames.length === 0) return { byUser: new Map(), usageTotalUsd: 0 };
  const { items, usageTotalUsd } = await fetchFromApifyWithCost(FOLLOWERS_ACTOR, { usernames });
  const byUser = new Map();
  for (const item of (items || [])) {
    const key = String(item.userName || '').toLowerCase();
    if (key) byUser.set(key, item);
  }
  return { byUser, usageTotalUsd };
}

// Reel Standard mode's follower lookup -- same actor and data as
// scrapeFollowersBatch, but with real cost capture for the Usage & Spend
// per-item breakdown.
async function scrapeFollowersBatchWithCost(usernamesOrUrls) {
  const list = Array.isArray(usernamesOrUrls) ? usernamesOrUrls : [usernamesOrUrls];
  const clean = list.map(extractUsername);
  const { byUser, usageTotalUsd } = await fetchOfficialFollowersWithCost(clean);
  const result = new Map();
  for (const uname of clean) result.set(uname.toLowerCase(), byUser.get(uname.toLowerCase()) || null);
  result.usageTotalUsd = usageTotalUsd;
  result.costPerRequestedUsd = clean.length > 0 ? usageTotalUsd / clean.length : 0;
  return result;
}

// Reel Express mode only (see reelPipeline.service.js) -- Standard mode
// never calls this, only scrapeFollowersBatchWithCost() above.
const FOLLOWER_COUNT_FAST_ACTOR = 'andok~instagram-follower-counter';

/*
  Express equivalent of scrapeFollowersBatch(). Tries a cheaper follower-count
  actor first ($0.001/profile listed vs $0.0026/profile on the actor Standard
  uses -- confirmed real, accurate follower counts in testing, e.g. matched
  Nike's real ~291M), then falls back to the exact same reliable actor
  Standard uses for ANY username the fast path didn't return cleanly.
  Confirmed failure mode in testing: ~25% of real accounts hit a known
  Instagram API bug on business/creator profiles that this actor can't work
  around -- that's exactly what the fallback covers, so Express can only be
  as unreliable as Standard, never more, only cheaper on whatever fraction
  of creators the fast path handles.
*/
async function scrapeFollowersBatchExpress(usernamesOrUrls) {
  const list = Array.isArray(usernamesOrUrls) ? usernamesOrUrls : [usernamesOrUrls];
  const clean = list.map(extractUsername);
  const result = new Map();
  let fastItems = [];

  // retries=0, timeoutMs=45000: this is a COST optimization, not the
  // reliable path -- the fallback below already IS the reliable path
  // (Standard's own actor, with its normal retry budget). If the fast actor
  // is slow or having a bad day, we want to give up on it quickly and let
  // every username fall through, not burn fetchFromApify's default 3
  // attempts x 120s (up to 6 minutes) on an optional optimization before
  // even reaching the reliable fallback. Root cause of a real production
  // hang on 2026-08-01: this call used to inherit the default retries=2,
  // stalling an entire batch for minutes when the fast actor struggled.
  // Stays on the sync endpoint deliberately (not the cost-capturing async
  // one) -- adding polling round-trips here would slow down the common case
  // for every reel report just to measure a number that's been $0 in every
  // real test run so far (see FAST_PATH_COST_USD below).
  try {
    fastItems = await fetchFromApify(FOLLOWER_COUNT_FAST_ACTOR, {
      urls: clean.map((u) => `https://www.instagram.com/${u}`),
    }, 0, 45000);
  } catch (err) {
    console.warn('[Apify] Express follower fast-path failed entirely, falling back to standard actor for all:', err.message);
    fastItems = [];
  }

  const byUser = new Map();
  for (const item of (fastItems || [])) {
    const key = String(item.username || '').toLowerCase();
    if (key && !item.error && item.followerCount != null) byUser.set(key, item);
  }

  const needsFallback = [];
  let fastResolvedCount = 0;
  for (const uname of clean) {
    const key = uname.toLowerCase();
    const fast = byUser.get(key);
    if (fast) {
      fastResolvedCount++;
      result.set(key, {
        followersCount: fast.followerCount,
        followsCount: fast.followingCount,
        userFullName: fast.fullName,
        userName: fast.username,
        userUrl: `https://www.instagram.com/${fast.username}`,
      });
    } else {
      needsFallback.push(uname);
    }
  }

  // Every real run of this actor so far has billed $0 (checked directly
  // against Apify's own run list, repeatedly) -- treated as free rather
  // than estimated, since a made-up nonzero rate would be LESS accurate
  // than what's actually been observed every single time. If that ever
  // stops being true this will start under-counting and should be revisited.
  let fallbackCostUsd = 0;
  if (needsFallback.length > 0) {
    const { byUser: fallbackByUser, usageTotalUsd } = await fetchOfficialFollowersWithCost(needsFallback);
    fallbackCostUsd = usageTotalUsd;
    for (const uname of needsFallback) {
      const key = uname.toLowerCase();
      result.set(key, fallbackByUser.get(key) || null);
    }
  }

  result.usageTotalUsd = fallbackCostUsd;
  result.costPerRequestedUsd = clean.length > 0 ? fallbackCostUsd / clean.length : 0;
  return result;
}

// ============================================================================
// PIPELINE V2 (Express) -- single-actor profile scraping
//
// One call returns followers AND reels with real play_count, replacing the
// Standard two-actor pipeline (post-scraper + followers-scraper) above.
// Cheaper (~$0.006-0.007/profile vs ~$0.0161-0.0171/profile), but its view
// counts have not yet been fully cross-checked against Standard on a range of
// account sizes. This is why it exists as a TOGGLEABLE second pipeline, not a
// replacement -- see profilePipeline.service.js for the switch.
// ============================================================================
const PROFILE_REELS_ACTOR = 'instagram-scraper~instagram-profile-reels-scraper';

// Maps this actor's raw item shape onto the SAME normalized field names the
// legacy pipeline produces, so selectProfileReels() and computeProfileMetrics()
// don't need to know which pipeline ran.
function normalizeProfileReelItemV2(item) {
  if (!item || typeof item !== 'object') return item;
  const owner = item.owner || {};
  return {
    ...item,
    // play_count is the only trustworthy view metric here -- view_count is
    // confirmed stale/legacy on this actor, never read it.
    videoPlayCount: item.play_count ?? undefined,
    likesCount: item.like_count ?? undefined,
    commentsCount: item.comment_count ?? undefined,
    ownerUsername: owner.username || item.ownerUsername,
    ownerFullName: owner.full_name || item.ownerFullName,
    ownerFollowersCount: owner.followers ?? undefined,
    shortCode: item.shortcode || item.shortCode,
    url: item.reel_url || item.url || (item.shortcode ? `https://www.instagram.com/reel/${item.shortcode}/` : undefined),
    timestamp: item.taken_at,
    // pinned_for_users may be entirely absent when nothing is pinned --
    // absent must mean NOT pinned, not "unknown."
    isPinned: Array.isArray(item.pinned_for_users) && item.pinned_for_users.length > 0,
    // Real fields, confirmed present on every call this actor already makes
    // (checked directly against live output -- no extra cost, no extra
    // request, just fields that were already being paid for and ignored).
    isSponsored: item.is_paid_partnership === true || item.is_ad === true || item.is_affiliate === true,
    isCollab: Array.isArray(item.coauthor_producers) && item.coauthor_producers.length > 0,
  };
}

/*
  The retry decision, pulled out as its own pure function so it can be unit
  tested directly against synthetic data -- the network call it gates on
  lives inside scrapeProfilesBatchV2 below and can only really be exercised
  against the real actor (the paid canary), so the DECISION is where the
  free regression suite's coverage has to live instead.

  Only worth retrying if BOTH:
    - the organic sample is thin (below PROFILE_MIN_RELIABLE_SAMPLE), and
    - Apify actually gave us everything we asked for (candidatesFetched >=
      fetchDepth). If it gave us less than we asked, the account itself
      doesn't have more reels to offer -- asking wider would just spend an
      Apify call to learn that same fact a second time.
*/
function needsWiderFetch(selectedCount, candidatesFetched, fetchDepth) {
  return selectedCount < PROFILE_MIN_RELIABLE_SAMPLE && candidatesFetched >= fetchDepth;
}

/*
  V2 equivalent of scrapeProfilesBatch() -- SAME signature, SAME return shape
  (Map<username, { posts, reelsAnalyzed, reelsSkippedAsOutliers, candidatesFetched, candidates, followerInfo }>),
  so the job engine's dispatch point can call either one with zero downstream
  changes. Uses selectProfileReelsV2() (log-trimmed, see above), NOT the
  legacy selectProfileReels() -- these have diverged on purpose as of the
  2026-07-29 cost-reduction work. Fetch depth is admin-configurable (Scan
  Settings), read fresh per call rather than cached, same reasoning as the
  pipeline-mode toggle: a change should apply to the very next report.
  followerInfo is bundled here (owner.followers on every row) -- callers must
  NOT also call scrapeFollowersBatch() for this pipeline, that would be a
  wasted second call defeating the entire cost advantage.
*/
function groupByOwner(items) {
  const byUser = new Map();
  for (const item of items) {
    const key = String(item.ownerUsername || '').toLowerCase();
    if (!key) continue;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(item);
  }
  return byUser;
}

function buildProfileEntry(posts, { widenedFetch = false } = {}) {
  const { selected, reelsSkippedAsOutliers, candidates } = selectProfileReelsV2(posts);
  const followers = posts[0] && posts[0].ownerFollowersCount;
  return {
    posts: selected,
    reelsAnalyzed: selected.length,
    reelsSkippedAsOutliers,
    candidatesFetched: posts.length,
    candidates,
    // Bundled with the same call -- never coerced to 0 when genuinely absent.
    followerInfo: posts[0] ? {
      followersCount: followers === undefined ? null : followers,
      userName: posts[0].ownerUsername,
      userFullName: posts[0].ownerFullName,
      userUrl: `https://www.instagram.com/${posts[0].ownerUsername}`,
    } : null,
    // Surfaced only for "how is this calculated" transparency -- never
    // affects charging or the metrics themselves.
    widenedFetch,
  };
}

async function scrapeProfilesBatchV2(usernamesOrUrls) {
  const list = Array.isArray(usernamesOrUrls) ? usernamesOrUrls : [usernamesOrUrls];
  const clean = list.map(extractUsername);
  const fetchDepth = await getV2FetchDepth();

  const raw = await fetchFromApify(PROFILE_REELS_ACTOR, {
    instagramUsernames: clean,
    postsPerProfile: fetchDepth,
  });
  // Read the dataset items directly (as returned above) rather than trusting
  // any run-summary item count -- Apify's platform has a confirmed stale-
  // summary race condition, not specific to one actor.
  const items = (raw || []).map(normalizeProfileReelItemV2);
  const byUser = groupByOwner(items);

  const result = new Map();
  const needsRetry = [];
  for (const uname of clean) {
    const key = uname.toLowerCase();
    const posts = byUser.get(key) || [];
    const entry = buildProfileEntry(posts);
    result.set(key, entry);
    if (needsWiderFetch(entry.reelsAnalyzed, entry.candidatesFetched, fetchDepth)) {
      needsRetry.push(key);
    }
  }

  /*
    One extra call, batched, covering only the accounts that came back thin
    AND where Apify had already given everything asked for the first time --
    the second half of that check is what stops this from re-asking accounts
    that structurally can't answer differently. If nobody in this batch
    qualifies, this whole block is skipped and cost is unchanged from before
    this existed.
  */
  if (needsRetry.length > 0) {
    const widerDepth = Math.min(fetchDepth * RETRY_FETCH_MULTIPLIER, RETRY_FETCH_MAX_DEPTH);
    try {
      const retryRaw = await fetchFromApify(PROFILE_REELS_ACTOR, {
        instagramUsernames: needsRetry,
        postsPerProfile: widerDepth,
      });
      const retryByUser = groupByOwner((retryRaw || []).map(normalizeProfileReelItemV2));
      for (const key of needsRetry) {
        const widerPosts = retryByUser.get(key) || [];
        // Only replace if the wider ask actually turned up more than the
        // first attempt -- a network hiccup on the retry must not make a
        // report worse than not retrying at all.
        if (widerPosts.length > (byUser.get(key) || []).length) {
          result.set(key, buildProfileEntry(widerPosts, { widenedFetch: true }));
        }
      }
    } catch (err) {
      // The first-pass results already in `result` stand as-is. A failed
      // retry is a missed improvement, not a reason to fail rows that
      // already succeeded once.
      console.warn('[Apify] Widened profile re-fetch failed, keeping first-pass results:', err.message);
    }
  }

  return result;
}

/*
  Test seam: lets the regression suite run the whole job pipeline without
  calling Apify or spending money.

  WHY IT EXISTS. Every scrape costs real money, so without this the only way
  to exercise the job lifecycle (start, partial failure, all-invalid, retry,
  discard, resume) is to pay for it, which means in practice nobody ever
  tests it. This is the one seam that makes that whole layer free.

  WHY IT IS SAFE.
    - It is refused outright when NODE_ENV is production. Not a warning, not
      a fallback: a throw. There is no configuration of a production box that
      can swap the scrapers.
    - It is off unless REELYTIC_SCRAPER_STUB names a module, so the default
      path is byte-for-byte the real one.
    - Dispatch happens at CALL time through `impl`, which is what makes the
      substitution work at all: jobEngine destructures these functions when it
      is required, so replacing module.exports afterwards would have no
      effect on the references it already holds.
*/
const impl = {
  scrapeReel, scrapeReels, scrapeProfile, scrapeProfilesBatch, scrapeFollowers, scrapeFollowersBatch,
  scrapeFollowersBatchExpress, scrapeFollowersBatchWithCost, scrapeProfilesBatchV2,
};

(function loadStubIfRequested() {
  const stubPath = process.env.REELYTIC_SCRAPER_STUB;
  if (!stubPath) return;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'REELYTIC_SCRAPER_STUB is set but NODE_ENV is production. '
      + 'Refusing to replace the scrapers on a production server.'
    );
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const stub = require(stubPath);
  for (const key of Object.keys(impl)) {
    if (typeof stub[key] === 'function') impl[key] = stub[key];
  }
  console.warn(`[Apify] SCRAPER STUB ACTIVE (${stubPath}) -- no real requests will be made.`);
}());

module.exports = {
  // Dispatched through `impl` so the stub can take effect. Behaviour is
  // identical to calling the functions directly when no stub is loaded.
  scrapeReel: (...a) => impl.scrapeReel(...a),
  scrapeReels: (...a) => impl.scrapeReels(...a),
  scrapeProfile: (...a) => impl.scrapeProfile(...a),
  scrapeProfilesBatch: (...a) => impl.scrapeProfilesBatch(...a),
  scrapeFollowers: (...a) => impl.scrapeFollowers(...a),
  scrapeFollowersBatch: (...a) => impl.scrapeFollowersBatch(...a),
  scrapeFollowersBatchExpress: (...a) => impl.scrapeFollowersBatchExpress(...a),
  scrapeFollowersBatchWithCost: (...a) => impl.scrapeFollowersBatchWithCost(...a),
  scrapeProfilesBatchV2: (...a) => impl.scrapeProfilesBatchV2(...a),

  // Pure helpers: no network, nothing to stub.
  normalizeReelItem, normalizeProfileReelItemV2, selectProfileReels, selectProfileReelsV2, extractUsername,
  needsWiderFetch,
  PROFILE_MIN_RELIABLE_SAMPLE,
};