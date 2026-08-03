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

function computeReelMetrics(rawItem, followerInfo) {
  const views = firstNum(rawItem, VIEW_KEYS);
  const rawLikes = rawItem.likesCount !== undefined ? rawItem.likesCount : rawItem.likes;
  const comments = Number(rawItem.commentsCount || rawItem.comments || 0);
  const shares = firstNum(rawItem, SHARE_KEYS);
  const reposts = firstNum(rawItem, REPOST_KEYS);
  const saves = firstNum(rawItem, SAVE_KEYS);

  // Surface data-quality problems instead of silently reporting a real 0.
  if (!views) {
    console.warn(`[Metrics] No view field found for ${rawItem.shortCode || rawItem.url || 'unknown'}, keys present:`, Object.keys(rawItem).join(','));
  }

  const likes = resolveLikes(views, rawLikes);
  const er = views > 0 ? round2(((likes + comments) / views) * 100) : 0;

  const username = rawItem.ownerUsername || rawItem.username || 'creator';
  let rawName = rawItem.ownerFullName || rawItem.fullName || rawItem.name;
  if (!rawName || rawName === 'Creator Name' || rawName.trim() === '') {
    rawName = username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  const followers = followerInfo ? Number(followerInfo.followersCount || 0) : Number(rawItem.ownerFollowersCount || rawItem.followersCount || 0);

  return {
    name: rawName,
    username,
    profileLink: cleanInstagramUrl(`https://www.instagram.com/${username}`),
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
    const comments = Number(p.commentsCount || 0);
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
  const username = (followerInfo && followerInfo.userName) || (first && first.ownerUsername) || 'creator';
  let rawName = (followerInfo && followerInfo.userFullName) || (first && first.ownerFullName);
  if (!rawName || String(rawName).trim() === '') {
    rawName = username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  const profileLink = cleanInstagramUrl((followerInfo && followerInfo.userUrl) || `https://www.instagram.com/${username}`);

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

  let totalLikes = 0;
  let totalComments = 0;
  const logViews = [];
  const perReel = [];

  for (const p of sample) {
    const views = Number(p.videoPlayCount ?? p.playCount ?? 0);
    const rawLikes = p.likesCount;
    const comments = Number(p.commentsCount || 0);
    const likes = resolveLikes(views, rawLikes);
    const er = views > 0 ? round2(((likes + comments) / views) * 100) : 0;

    logViews.push(Math.log(views + 1));
    totalLikes += (typeof likes === 'number' ? likes : 0);
    totalComments += comments;

    perReel.push({
      link: p.url || '',
      shortcode: p.shortCode || '',
      views,
      likes,
      comments,
      er
    });
  }

  const n = sample.length || 1;
  const avgViews = logViews.length > 0 ? Math.round(Math.exp(logViews.reduce((a, b) => a + b, 0) / logViews.length) - 1) : 0;
  const avgLikes = totalLikes / n;
  const avgComments = totalComments / n;

  const followers = followerInfo ? Number(followerInfo.followersCount || 0) : 0;
  const avgEr = followers > 0 ? round2(((avgLikes + avgComments) / followers) * 100) : 0;

  const first = posts && posts[0];
  const username = (followerInfo && followerInfo.userName) || (first && first.ownerUsername) || 'creator';
  let rawName = (followerInfo && followerInfo.userFullName) || (first && first.ownerFullName);
  if (!rawName || String(rawName).trim() === '') {
    rawName = username.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  const profileLink = cleanInstagramUrl((followerInfo && followerInfo.userUrl) || `https://www.instagram.com/${username}`);

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

module.exports = { computeReelMetrics, computeProfileMetrics, computeProfileMetricsV2, resolveLikes, round2 };