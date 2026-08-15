/*
  Stand-in for the Apify scrapers, loaded only when REELYTIC_SCRAPER_STUB
  points at this file (see the seam in server/services/apify.service.js).

  It exists so the job lifecycle can be exercised for free: start, partial
  failure, every-link-invalid, retry, discard. Those paths are where the
  engine's real complexity lives, and every one of them costs money to reach
  through the real actors, which is why they were effectively never tested.

  THE SHAPES HERE ARE NOT INVENTED. They mirror what jobEngine actually
  consumes, and getting them wrong is silent: the engine catches a bad shape,
  marks the rows failed and pauses the report, so the tests fail with
  "paused !== done" and no hint as to why. Specifically:

    scrapeReels(urls)            -> ARRAY aligned to urls (null for a miss),
                                    carrying .costPerRequestedUsd. Items use
                                    ownerUsername, not username.
    scrapeFollowers*(names)      -> Map keyed by LOWERCASED username,
                                    optionally carrying .usageTotalUsd.
    scrapeProfilesBatch*(names)  -> Map keyed by LOWERCASED username, each
                                    entry { posts, candidatesFetched,
                                    followerInfo, ... }.

  Behaviour is driven by the URL so a test states its intent by choosing a
  link rather than by configuring mocks:

    .../reel/OK<n>/    succeeds        .../reel/FAIL<n>/   returns nothing
    <name>_ok          succeeds        <name>_fail         returns nothing
*/

function shortcodeOf(url) {
  const m = String(url).match(/\/reel\/([^/?#]+)/i);
  return m ? m[1] : String(url);
}

function isFailure(token) {
  return /FAIL/i.test(String(token));
}

// Stable pseudo-random derived from the token, so numbers are varied between
// links but identical for the same link on every run.
function seedOf(token) {
  return String(token).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

async function scrapeReels(urls) {
  // Array, index-aligned to `urls`, null where the upstream had nothing.
  const out = urls.map((url) => {
    const code = shortcodeOf(url);
    if (isFailure(code)) return null;
    const seed = seedOf(code);
    return {
      url,
      shortCode: code,
      ownerUsername: `stub_${code.toLowerCase()}`,
      videoViewCount: 1000 + (seed % 500),
      videoPlayCount: 1000 + (seed % 500),
      likesCount: 100 + (seed % 50),
      commentsCount: 10 + (seed % 5),
      timestamp: new Date().toISOString(),
    };
  });
  // Attached to the array, exactly as the real implementation does.
  out.costPerRequestedUsd = 0.0026;
  return out;
}

function followersMapFor(usernames) {
  const map = new Map();
  for (const name of usernames) {
    if (isFailure(name)) continue;
    map.set(String(name).toLowerCase(), {
      username: name,
      followersCount: 5000 + (seedOf(name) % 1000),
    });
  }
  return map;
}

async function scrapeFollowersBatch(usernames) {
  return followersMapFor(usernames);
}

async function scrapeFollowersBatchExpress(usernames) {
  return followersMapFor(usernames);
}

async function scrapeFollowersBatchWithCost(usernames) {
  const map = followersMapFor(usernames);
  map.usageTotalUsd = 0.001;
  return map;
}

// Eight recent reels per creator, descending in age, so the outlier trimming
// and averaging in metrics.service have realistic material to work on.
//
// A name containing ALLCOLLAB is the one deliberate exception: real Apify
// candidates fetched, but every single one excluded (collab, in this case),
// same as selectProfileReelsV2 in apify.service.js would produce for an
// account whose recent posts are entirely collabs. Everything else here
// returns posts pre-filtered, bypassing that selection step entirely -- this
// is the one case a test needs to reach the "candidates fetched, nothing
// eligible survived" path in jobEngine.service.js.
function profileEntry(name) {
  const seed = seedOf(name);
  if (/ALLCOLLAB/i.test(name)) {
    return {
      username: name,
      posts: [],
      candidates: Array.from({ length: 5 }, (_, i) => ({
        shortCode: `${name}_r${i}`, included: false, reason: 'collab',
      })),
      candidatesFetched: 5,
      reelsSkippedAsOutliers: 0,
      followerInfo: { username: name, followersCount: 10000 + (seed % 5000) },
    };
  }
  // Thin but non-zero: stands in for what scrapeProfilesBatchV2 hands back
  // AFTER its own widen-retry has already run (that retry, and the network
  // call it makes, is only exercisable against the real actor -- this
  // covers what jobEngine.service.js does with whatever count it is finally
  // given, which is the part that can be tested for free).
  if (/THIN/i.test(name)) {
    const posts = Array.from({ length: 2 }, (_, i) => ({
      shortCode: `${name}_r${i}`,
      videoViewCount: 3000 + i * 100,
      videoPlayCount: 3000 + i * 100,
      likesCount: 300 + i * 10,
      commentsCount: 15 + i,
      timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    }));
    return {
      username: name,
      posts,
      candidates: posts.map((p) => ({ shortCode: p.shortCode, included: true, reason: 'included' })),
      candidatesFetched: posts.length,
      reelsSkippedAsOutliers: 0,
      followerInfo: { username: name, followersCount: 10000 + (seed % 5000) },
    };
  }
  const posts = Array.from({ length: 8 }, (_, i) => ({
    shortCode: `${name}_r${i}`,
    videoViewCount: 2000 + i * 100 + (seed % 100),
    videoPlayCount: 2000 + i * 100 + (seed % 100),
    likesCount: 200 + i * 10,
    commentsCount: 20 + i,
    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    isSponsored: false,
    isCollab: false,
  }));
  return {
    username: name,
    posts,
    candidates: posts,
    candidatesFetched: posts.length,
    reelsSkippedAsOutliers: 0,
    followerInfo: { username: name, followersCount: 10000 + (seed % 5000) },
  };
}

async function scrapeProfilesBatchV2(usernames) {
  const map = new Map();
  for (const name of usernames) {
    if (!name || isFailure(name)) continue;
    map.set(String(name).toLowerCase(), profileEntry(name));
  }
  return map;
}

async function scrapeProfilesBatch(usernames) {
  return scrapeProfilesBatchV2(usernames);
}

async function scrapeReel(url) {
  const [item] = await scrapeReels([url]);
  return item || null;
}

async function scrapeProfile(username) {
  const map = await scrapeProfilesBatchV2([username]);
  return map.get(String(username).toLowerCase()) || null;
}

module.exports = {
  scrapeReel,
  scrapeReels,
  scrapeProfile,
  scrapeProfilesBatch,
  scrapeProfilesBatchV2,
  scrapeFollowersBatch,
  scrapeFollowersBatchExpress,
  scrapeFollowersBatchWithCost,
};
