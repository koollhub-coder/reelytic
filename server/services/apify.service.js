const config = require('../config');

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


async function fetchFromApify(actorId, actorInput, retries = 2) {
  const apiKey = config.apifyApiKey;
  if (!apiKey || apiKey === 'your_apify_api_key_here' || apiKey === 'mock_apify_key') {
    throw new Error('Missing or invalid APIFY_API_KEY in .env file. Please add your real Apify API key to fetch live data from Instagram.');
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
    const timeout = setTimeout(() => controller.abort(), 120000);
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
        const text = await response.text();
        throw new Error(`Apify error HTTP ${response.status}: ${text}`);
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
        throw new Error(err.message || 'Apify network request failed');
      }
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
    }
  }
}

async function scrapeReel(url) {
  const items = await scrapeReels([url]);
  const item = items[0];
  if (!item) throw new Error('Instagram returned no data for this reel');
  return item;
}

/*
  Batch entry point. COST NOTE: the analytics actor bills a per-RUN start fee
  ($0.002) plus a per-result fee ($0.0025). One call per reel pays the start fee
  every single time ($0.0045/reel); batching N reels into one run amortizes it
  (50 reels -> ~$0.0025/reel). Always prefer batching for large jobs.
*/
async function scrapeReels(urls) {
  const list = Array.isArray(urls) ? urls : [urls];

  if (REEL_MODE === 'analytics') {
    const input = { [REEL_ANALYTICS_INPUT_FIELD]: list };
    const items = await fetchFromApify(REEL_ANALYTICS_ACTOR, input);
    return (items || []).map(normalizeReelItem);
  }

  // Legacy/basic actor -- cheaper, but does not return shares/reposts/saves.
  const items = await fetchFromApify(REEL_ACTOR, {
    username: list,
    resultsLimit: list.length,
    includeSharesCount: true,
    skipPinnedPosts: false,
    skipTrialReels: false,
  });
  return (items || []).map(normalizeReelItem);
}

async function scrapeProfile(urlOrUsername) {
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
  const items = await fetchFromApify(PROFILE_ACTOR, {
    username: [urlOrUsername],
    resultsLimit: 6,
    skipPinnedPosts: true,
  });
  if (!items || !items.length) throw new Error('Instagram returned no data for this profile');
  return items; // array of post objects -- metrics.service.js aggregates these into profile stats
}

function extractUsername(urlOrUsername) {
  const match = String(urlOrUsername).match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return match ? match[1] : String(urlOrUsername).replace(/^@/, '').trim();
}

async function scrapeFollowers(urlOrUsername) {
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
  const username = extractUsername(urlOrUsername);
  const items = await fetchFromApify(FOLLOWERS_ACTOR, { usernames: [username] });
  const item = items && items[0];
  return item || null; // graceful degrade -- profile report still completes without follower count
}

module.exports = { scrapeReel, scrapeReels, scrapeProfile, scrapeFollowers, normalizeReelItem };