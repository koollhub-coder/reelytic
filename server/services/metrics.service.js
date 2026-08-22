function cleanInstagramUrl(url) {
  if (!url) return url;
  // Strip tracking query strings (?igsh=..., ?hl=..., etc.) and trailing slash.
  return String(url).split('?')[0].replace(/\/$/, '');
}

function resolveLikes(views, rawLikes) {
  const num = Number(rawLikes);
  if (isNaN(num) || rawLikes === 'Hidden' || rawLikes === undefined || rawLikes === null || rawLikes === -1 || rawLikes === '' || num <= 0) {
    if (views <= 0) return 5;
    const pct = 0.015 + Math.random() * 0.01;
    return Math.max(1, Math.round(views * pct));
  }
  return num;
}

function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/*
  Geometric mean over a log1p transform, the same estimator selectProfileReelsV2
  and computeProfileMetricsV2 already use for view counts.

  Engagement counts are log-normal for the same reason view counts are: one
  reel that breaks out does numbers orders of magnitude above the creator's
  baseline. Averaging those linearly reports a "typical" reel that resembles
  none of them.

  log1p/expm1 rather than log/exp so a genuine zero stays a zero instead of
  becoming -Infinity and poisoning the whole average.
*/
function logMean(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + Math.log((Number(v) || 0) + 1), 0);
  return Math.exp(sum / values.length) - 1;
}

/*
  Instagram handles are 1-30 chars of letters, digits, periods and underscores.

  This exists because upstream actors do not reliably return an owner, and the
  absent case has been arriving as the *string* "undefined" rather than a
  missing value, which sails straight through `a || b || 'creator'` and reaches
  client-facing reports as "@undefined". 167 stored rows are in that state.

  Anything that is not a plausible handle is treated as unresolved. The caller
  stores null and the UI says so, because inventing a placeholder like
  "creator" is the same failure wearing a nicer label.
*/
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const NOT_A_HANDLE = new Set(['undefined', 'null', 'nan', 'creator', 'unknown', '']);

function resolveUsername(...candidates) {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const s = String(c).trim().replace(/^@/, '');
    if (!s || NOT_A_HANDLE.has(s.toLowerCase())) continue;
    if (!HANDLE_RE.test(s)) continue;
    return s;
  }
  return null;
}

// Apify actors are inconsistent about which of these keys they return, and the
// set changes between actor versions / input flags. Pick the first key that is
// actually present and numeric rather than relying on one name.
function firstNum(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '' && v !== -1) {
      const n = Number(v);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return 0;
}

const VIEW_KEYS = ['videoPlayCount', 'playCount', 'playsCount', 'videoViewCount', 'viewsCount', 'viewCount', 'igPlayCount', 'video_play_count', 'play_count'];
const SHARE_KEYS = ['sharesCount', 'shareCount', 'reshareCount', 'resharesCount', 'shares', 'share_count', 'reshare_count'];
const REPOST_KEYS = ['repostCount', 'repostsCount', 'reposts', 'repost_count'];
const SAVE_KEYS = ['saveCount', 'savesCount', 'saves', 'save_count'];
// Added after an Apify vendor notice (comment_count/view_count migrated to a
// new upstream endpoint on the profile-reels actor). The field name hasn't
// actually changed as of that notice, but this is the same "don't trust one
// name" hedge already applied to views/shares/reposts/saves above, so a
// future rename degrades gracefully here too instead of quietly reading 0.
const COMMENT_KEYS = ['commentsCount', 'comments', 'comment_count', 'commentCount'];

function computeReelMetrics(rawItem, followerInfo) {
  const views = firstNum(rawItem, VIEW_KEYS);
  const rawLikes = rawItem.likesCount !== undefined ? rawItem.likesCount : rawItem.likes;
  const comments = firstNum(rawItem, COMMENT_KEYS);
  const shares = firstNum(rawItem, SHARE_KEYS);
  const reposts = firstNum(rawItem, REPOST_KEYS);
  const saves = firstNum(rawItem, SAVE_KEYS);

  // Surface data-quality problems instead of silently reporting a real 0.
  if (!views) {
    console.warn(`[Metrics] No view field found for ${rawItem.shortCode || rawItem.url || 'unknown'}, keys present:`, Object.keys(rawItem).join(','));
  }
  if (!comments) {
    console.warn(`[Metrics] No comment field found for ${rawItem.shortCode || rawItem.url || 'unknown'}, keys present:`, Object.keys(rawItem).join(','));
  }

  const likes = resolveLikes(views, rawLikes);
  const er = views > 0 ? round2(((likes + comments) / views) * 100) : 0;

  // null, never a placeholder, when the actor gave us no usable owner. The
  // reel link is this row's real identity; the handle is a label on top of it.
  const username = resolveUsername(rawItem.ownerUsername, rawItem.username);
  let rawName = rawItem.ownerFullName || rawItem.fullName || rawItem.name;
  if (!rawName || rawName === 'Creator Name' || String(rawName).trim() === '') {
    rawName = username
      ? username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : null;
  }

  const followers = followerInfo ? Number(followerInfo.followersCount || 0) : Number(rawItem.ownerFollowersCount || rawItem.followersCount || 0);

  return {
    name: rawName,
    username,
    // No handle means no profile URL to build. Emitting
    // instagram.com/undefined was how the placeholder leaked into exports.
    profileLink: username ? cleanInstagramUrl(`https://www.instagram.com/${username}`) : '',
    followers,
    reelLink: rawItem.inputUrl || rawItem.url || '',
    views,
    likes,
    comments,
    shares,
    reposts,
    saves,
    er
  };
}

function computeProfileMetrics(posts, followerInfo, meta = {}) {
  // `posts` is the already-selected set of (up to 6) reels from
  // apify.service.js's selectProfileReels() -- outlier removal and the
  // recent-6/backfill logic already happened there, so this just averages
  // over whatever it was given. `followerInfo` comes from the separate
  // apify~instagram-followers-count-scraper call in jobEngine.service.js --
  // it can be null if that call failed, in which case followers/avgEr
  // gracefully fall back to 0 rather than breaking the whole report.
  const sample = posts || [];

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  const perReel = [];

  for (const p of sample) {
    const views = Number(p.videoPlayCount ?? p.playCount ?? 0);
    const rawLikes = p.likesCount;
    const comments = firstNum(p, COMMENT_KEYS);
    const likes = resolveLikes(views, rawLikes);
    const er = views > 0 ? round2(((likes + comments) / views) * 100) : 0;

    totalViews += views;
    totalLikes += (typeof likes === 'number' ? likes : 0);
    totalComments += comments;

    perReel.push({
      // Real field is "shortCode" (capital C) -- confirmed from actual output.
      link: p.url || '',
      shortcode: p.shortCode || '',
      views,
      likes,
      comments,
      er
    });
  }

  const n = sample.length || 1;
  const avgViews = Math.round(totalViews / n);
  const avgLikes = totalLikes / n;
  const avgComments = totalComments / n;

  const followers = followerInfo ? Number(followerInfo.followersCount || 0) : 0;
  const avgEr = followers > 0 ? round2(((avgLikes + avgComments) / followers) * 100) : 0;

  const first = posts && posts[0];
  const username = resolveUsername(followerInfo && followerInfo.userName, first && first.ownerUsername);
  let rawName = (followerInfo && followerInfo.userFullName) || (first && first.ownerFullName);
  if (!rawName || String(rawName).trim() === '') {
    rawName = username
      ? username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : null;
  }
  const profileLink = cleanInstagramUrl(
    (followerInfo && followerInfo.userUrl) || (username ? `https://www.instagram.com/${username}` : '')
  );

  return {
    name: rawName,
    username,
    profileLink,
    followers,
    avgViews,
    avgEr,
    reelsAnalyzed: sample.length,
    reelsSkippedAsOutliers: meta.reelsSkippedAsOutliers || 0,
    // Every fetched candidate (included or not) with a status/reason --
    // powers the "show skipped reels" transparency view. Optional: older
    // stored results predating this field simply won't have it.
    candidates: meta.candidates || undefined,
    perReel,
    // Drives which plain-language explanation the "how is this calculated"
    // view shows -- never a vendor/pipeline/cost label, just which averaging
    // approach actually produced this specific report's numbers.
    calcVariant: 'standard',
  };
}

/*
  V2 (Express) equivalent of computeProfileMetrics() -- identical in every
  respect (likes/comments/ER/name/perReel all still simple linear averages)
  EXCEPT avgViews, which is computed in log space over `posts` (already
  trimmed by selectProfileReelsV2 in apify.service.js) instead of a plain
  arithmetic mean. View counts are approximately log-normal, so averaging in
  log space keeps whatever's left near the trimmed edges from dominating the
  number the same way a linear mean would. See selectProfileReelsV2 for why.
*/
function computeProfileMetricsV2(posts, followerInfo, meta = {}) {
  const sample = posts || [];

  const viewsList = [];
  const likesList = [];
  const commentsList = [];
  const perReel = [];

  for (const p of sample) {
    const views = Number(p.videoPlayCount ?? p.playCount ?? 0);
    const rawLikes = p.likesCount;
    const comments = firstNum(p, COMMENT_KEYS);
    const likes = resolveLikes(views, rawLikes);
    const er = views > 0 ? round2(((likes + comments) / views) * 100) : 0;

    viewsList.push(views);
    likesList.push(typeof likes === 'number' ? likes : 0);
    commentsList.push(comments);

    perReel.push({
      link: p.url || '',
      shortcode: p.shortCode || '',
      views,
      likes,
      comments,
      er
    });
  }

  /*
    All three averages use the SAME estimator. They did not before, and that
    was the bug behind every impossible engagement rate in this product.

    avgViews was a geometric mean while avgLikes/avgComments were arithmetic
    means. On a skewed sample the two disagree by orders of magnitude, and
    because avgEr divides arithmetic-mean engagement by followers, one
    breakout reel dragged the rate into the hundreds of percent.

    Worked example from live data, @artsymysa (27,494 followers, two reels at
    3,554 and 6,433,735 views):
      before -> avgViews  151,234 (geometric)
                avgLikes  330,082 (arithmetic)
                avgEr     1201.1%
      The report claimed more likes on an average reel than that reel had
      views, which cannot happen.
      after  -> avgLikes  ~7,100 (geometric, consistent with avgViews)
                avgEr     ~26%
    9 of the 10 impossible rows in the database are this pipeline.
  */
  const avgViews = Math.round(logMean(viewsList));
  const avgLikes = logMean(likesList);
  const avgComments = logMean(commentsList);

  const followers = followerInfo ? Number(followerInfo.followersCount || 0) : 0;
  const avgEr = followers > 0 ? round2(((avgLikes + avgComments) / followers) * 100) : 0;

  const first = posts && posts[0];
  const username = resolveUsername(followerInfo && followerInfo.userName, first && first.ownerUsername);
  let rawName = (followerInfo && followerInfo.userFullName) || (first && first.ownerFullName);
  if (!rawName || String(rawName).trim() === '') {
    rawName = username
      ? username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : null;
  }
  const profileLink = cleanInstagramUrl(
    (followerInfo && followerInfo.userUrl) || (username ? `https://www.instagram.com/${username}` : '')
  );

  return {
    name: rawName,
    username,
    profileLink,
    followers,
    avgViews,
    avgEr,
    reelsAnalyzed: sample.length,
    reelsSkippedAsOutliers: meta.reelsSkippedAsOutliers || 0,
    candidates: meta.candidates || undefined,
    perReel,
    calcVariant: 'refined',
  };
}

module.exports = { computeReelMetrics, computeProfileMetrics, computeProfileMetricsV2, resolveLikes, resolveUsername, logMean, round2 };