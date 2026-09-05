const { getDb, queryId } = require('../db');

/*
  The creator database: every Instagram creator an account has ever run a
  reel or profile report on, deduped to one row per creator, built up
  incrementally as reports run rather than computed on read.

  WHY A SEPARATE MAINTAINED COLLECTION, NOT A LIVE AGGREGATION.
  Every successful row already lands in submittedLinks (see
  ledger.service.js), with the creator's username and metrics right there --
  it would be possible to $group that collection into a creator view on
  every page load. That works fine at hundreds of rows. It does not work at
  the scale this is built for (an agency's history running into the
  hundreds of thousands of analyzed links, this view needing to stay
  searchable and paginated in well under a second): a live aggregation
  re-scans and re-groups the same growing history on every single request.
  recordAnalyzedCreator below does that grouping ONCE, incrementally, at the
  moment a row succeeds -- after that, reading this collection is a plain
  indexed query, not a re-aggregation.

  WHY jobIds INSTEAD OF A SNAPSHOTTED CAMPAIGN TAG.
  A report can be moved between campaigns after it finishes (see History's
  campaign reassignment) or start with no campaign at all and get one
  later. Storing "which campaign was this creator seen under" as a fixed
  value captured at scrape time would go stale the moment someone
  reassigns the report. Storing the job ids instead and joining against
  jobs.campaignId live, at read time (see server/routes/creators.routes.js),
  means the tag shown is always whatever that report is filed under RIGHT
  NOW, with no separate step needed to keep it in sync. Capped to the most
  recent 20 per creator (see $slice below) so a creator analyzed hundreds
  of times doesn't grow this array without bound -- recent campaigns are
  what the tag display actually needs.

  WHY name/profileLink/followers ARE "LATEST WINS", NOT AVERAGED.
  A creator's display name and follower count change over time; the metric
  totals below should reflect their whole history, but showing a follower
  count averaged across three years of scrapes would be a made-up number
  nobody asked for. Every new appearance overwrites these three fields with
  whatever was just seen, so the card always shows the most current read.

  WHY THE UPDATE IS A PIPELINE, NOT A PLAIN $set/$inc.
  The filter bar (routes/creators.routes.js) needs to sort and range-filter
  by average engagement rate and by "times analyzed" -- neither is a raw
  stored counter, both are derived from reel.totalEr/reel.count etc, and a
  keyset-paginated query can only sort/filter on a field that actually
  exists on the document with an index behind it. Computing avgEr at READ
  time (as this used to) means there is nothing to put that index on. So
  this update is a two-stage aggregation pipeline: stage 1 bumps the raw
  counters exactly like the old $inc did, stage 2 recomputes reel.avgEr /
  profile.avgEr / timesAnalyzed / bestAvgEr FROM those just-updated
  counters, all inside one atomic upsert -- the derived fields can never
  drift out of sync with the totals because they're computed from them in
  the same operation, not written separately.
*/

function creatorId(ownerUsername, username) {
  return `${ownerUsername}::${username}`;
}

// Same escaping jobs.routes.js's creator-search already uses -- a search
// term like "a.b*c" must be matched literally, not compiled as a pattern.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/*
  Called once per successfully-completed row (see jobEngine.service.js,
  right alongside the existing recordLedgerEntry call for the same row) and
  by the one-time backfill script for every already-completed row in
  existing history -- same function either way, so there is only ever one
  place this grouping logic lives.

  `result` is the row's full computed result (metrics.service.js's
  computeReelMetrics/computeProfileMetrics output): whichever fields exist
  for that report type is exactly what's summed below. Silently returns for
  a row with no resolved username -- nothing to file a row under.
*/
async function recordAnalyzedCreator({ ownerUsername, type, jobId, result }) {
  if (!ownerUsername || !result || !result.username) return;
  const db = getDb();
  const username = String(result.username).toLowerCase();
  const now = new Date();
  const isReel = type === 'reel';

  // Stage 1: bump raw counters (both reel.* and profile.* kept fully
  // present every call, incremented by 0 on the side this report isn't --
  // stage 2 needs both to always exist to compute timesAnalyzed/bestAvgEr).
  // $ifNull stands in for $setOnInsert / $inc, neither of which pipeline
  // updates support.
  const stage1 = {
    $set: {
      ownerUsername,
      username,
      lastAnalyzedAt: now,
      updatedAt: now,
      firstAnalyzedAt: { $ifNull: ['$firstAnalyzedAt', now] },
      ...(result.name ? { name: result.name } : {}),
      ...(result.profileLink ? { profileLink: result.profileLink } : {}),
      ...(result.followers != null ? { followers: result.followers } : {}),
      'reel.count': { $add: [{ $ifNull: ['$reel.count', 0] }, isReel ? 1 : 0] },
      'reel.totalViews': { $add: [{ $ifNull: ['$reel.totalViews', 0] }, isReel ? (result.views || 0) : 0] },
      'reel.totalLikes': { $add: [{ $ifNull: ['$reel.totalLikes', 0] }, isReel ? (result.likes || 0) : 0] },
      'reel.totalComments': { $add: [{ $ifNull: ['$reel.totalComments', 0] }, isReel ? (result.comments || 0) : 0] },
      'reel.totalEr': { $add: [{ $ifNull: ['$reel.totalEr', 0] }, isReel ? (result.er || 0) : 0] },
      'profile.count': { $add: [{ $ifNull: ['$profile.count', 0] }, isReel ? 0 : 1] },
      'profile.totalViews': { $add: [{ $ifNull: ['$profile.totalViews', 0] }, isReel ? 0 : (result.avgViews || 0)] },
      'profile.totalEr': { $add: [{ $ifNull: ['$profile.totalEr', 0] }, isReel ? 0 : (result.avgEr || 0)] },
      ...(jobId ? { jobIds: { $slice: [{ $concatArrays: [{ $ifNull: ['$jobIds', []] }, [String(jobId)]] }, -20] } } : {}),
    },
  };

  // Stage 2: derive avgEr per type from the counters stage 1 just set.
  const stage2 = {
    $set: {
      'reel.avgEr': { $cond: [{ $gt: ['$reel.count', 0] }, { $round: [{ $divide: ['$reel.totalEr', '$reel.count'] }, 2] }, 0] },
      'profile.avgEr': { $cond: [{ $gt: ['$profile.count', 0] }, { $round: [{ $divide: ['$profile.totalEr', '$profile.count'] }, 2] }, 0] },
      timesAnalyzed: { $add: ['$reel.count', '$profile.count'] },
    },
  };

  // Stage 3: bestAvgEr is whichever of the two is higher -- the single
  // number the "engagement rate" filter/sort actually queries on, so a
  // creator only measured via profile reports (or only via reels) still
  // shows up correctly instead of needing the filter to check both fields.
  const stage3 = { $set: { bestAvgEr: { $max: ['$reel.avgEr', '$profile.avgEr'] } } };

  await db.collection('analyzedCreators').updateOne(
    { _id: creatorId(ownerUsername, username) },
    [stage1, stage2, stage3],
    { upsert: true }
  );
}

/*
  Keyset (not skip/offset) pagination -- an offset-based "page 4,000" query
  degrades linearly with how far in you page, which is exactly the wrong
  shape for a collection meant to hold up to a million rows. `cursor` is an
  opaque token carrying the last row's (sort field value, _id): the next
  page asks for "everything past that point on the sort field, or exactly
  tied but sorting after it by id" -- the standard two-column keyset
  comparison, needed because no single sort field here is unique on its own.

  Which field that is depends on SORT_FIELDS below -- the filter bar offers
  more than one sort, and each one keyset-paginates on ITS OWN field rather
  than always on lastAnalyzedAt, or "most followers" would still be
  fetching pages in recency order underneath a followers-sorted first page.
  decodeCursor needs to know which field produced the cursor because dates
  and numbers serialize (and must deserialize) differently.

  Search is a case-insensitive PREFIX match (^term), not a substring match,
  and that's deliberate rather than a shortcut: MongoDB can only use a
  {username:1}/{name:1} index to serve a regex that's anchored at the start
  of the string. A substring search ("contains" anywhere) cannot use that
  index at all and degrades to a full collection scan -- fine at a thousand
  rows, not at a million. Prefix search is also just how this kind of
  lookup normally works elsewhere (GitHub, Twitter user search): type the
  start of a handle or name and matches narrow as you go.
*/
const SORT_FIELDS = {
  recent: 'lastAnalyzedAt',
  followers: 'followers',
  engagement: 'bestAvgEr',
  timesAnalyzed: 'timesAnalyzed',
};

function encodeCursor(row, sortField) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ v: row[sortField], id: row._id })).toString('base64url');
}

function decodeCursor(cursor, sortField) {
  try {
    const { v, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { v: sortField === 'lastAnalyzedAt' ? new Date(v) : v, id };
  } catch (e) {
    return null;
  }
}

/*
  Shared by searchAnalyzedCreators and exportAnalyzedCreators below, so the
  two can never quietly disagree about which rows a given filter combination
  matches -- an export that silently included a row the on-screen list
  excluded (or vice versa) would be a much worse bug than either function
  having a filter feature the other lacks.

  WHY THE CAMPAIGN FILTER IS A TWO-STEP LOOKUP, NOT A STORED FIELD.
  Same reasoning as the campaign TAG shown per row (see the module comment
  up top): a report can be reassigned to a different campaign after the
  fact, so "which campaign is this creator under" can only be answered
  correctly by asking jobs.campaignId right now, not by trusting a value
  written down earlier. Filtering by campaign is therefore: look up which
  jobs currently belong to that campaign, then match creators whose jobIds
  overlaps that set ($in) -- still a live answer, just computed once up
  front instead of per row.
*/
async function buildFilter({ db, ownerUsername, isAdmin, search, minFollowers, maxFollowers, minEr, campaignId }) {
  const and = [];
  if (!isAdmin) and.push({ ownerUsername });
  const cleanSearch = (search || '').trim();
  if (cleanSearch) {
    const rx = new RegExp(`^${escapeRegex(cleanSearch)}`, 'i');
    and.push({ $or: [{ username: rx }, { name: rx }] });
  }
  // Range filters (follower tier, minimum engagement rate) are independent
  // of which sort is active -- they narrow the same set no matter which
  // field the results happen to be ordered by.
  if (minFollowers != null && minFollowers !== '') and.push({ followers: { $gte: Number(minFollowers) } });
  if (maxFollowers != null && maxFollowers !== '') and.push({ followers: { $lte: Number(maxFollowers) } });
  if (minEr != null && minEr !== '') and.push({ bestAvgEr: { $gte: Number(minEr) } });
  if (campaignId) {
    const jobFilter = { campaignId: queryId(campaignId) };
    // A non-admin's own campaign list (client/src/pages/Creators.jsx only
    // ever offers campaigns GET /campaigns already scoped to them) can only
    // ever contain their own campaigns anyway, but scoping this lookup the
    // same way the rest of the filter is scoped costs nothing and closes
    // off a non-admin ever being able to probe another account's campaign
    // by id.
    if (!isAdmin) jobFilter.ownerUsername = ownerUsername;
    const jobDocs = await db.collection('jobs').find(jobFilter, { projection: { _id: 1 } }).toArray();
    // Empty on purpose when the campaign has no jobs: {$in: []} matches
    // nothing, which is the correct answer (a real, valid, empty result),
    // not an error.
    and.push({ jobIds: { $in: jobDocs.map((j) => String(j._id)) } });
  }
  return and;
}

async function searchAnalyzedCreators({ ownerUsername, isAdmin, search, cursor, limit = 30, sort, minFollowers, maxFollowers, minEr, campaignId }) {
  const db = getDb();
  const sortField = SORT_FIELDS[sort] || SORT_FIELDS.recent;
  const and = await buildFilter({ db, ownerUsername, isAdmin, search, minFollowers, maxFollowers, minEr, campaignId });

  const decoded = cursor ? decodeCursor(cursor, sortField) : null;
  if (decoded) {
    and.push({ $or: [
      { [sortField]: { $lt: decoded.v } },
      { [sortField]: decoded.v, _id: { $lt: decoded.id } },
    ] });
  }

  const filter = and.length ? { $and: and } : {};
  const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const rows = await db.collection('analyzedCreators')
    .find(filter)
    .sort({ [sortField]: -1, _id: -1 })
    .limit(pageSize + 1)
    .toArray();

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1], sortField) : null;

  // Campaign tags: a live join against jobs.campaignId (see the module
  // comment on why this can't be a value stored on the creator row), scoped
  // to just the job ids this page's creators actually carry -- bounded by
  // page size x 20, never by the collection's full size.
  const jobIdSet = new Set();
  for (const row of page) {
    for (const id of (row.jobIds || [])) jobIdSet.add(id);
  }
  let campaignByJobId = new Map();
  if (jobIdSet.size) {
    const jobDocs = await db.collection('jobs')
      .find({ _id: { $in: Array.from(jobIdSet).map((id) => queryId(id)) } }, { projection: { campaignId: 1 } })
      .toArray();
    campaignByJobId = new Map(jobDocs.map((j) => [String(j._id), j.campaignId || null]));
  }
  const campaignIdsNeeded = new Set(Array.from(campaignByJobId.values()).filter(Boolean));
  let campaignNameById = new Map();
  if (campaignIdsNeeded.size) {
    const campaignDocs = await db.collection('campaigns')
      .find({ _id: { $in: Array.from(campaignIdsNeeded).map((id) => queryId(id)) } }, { projection: { name: 1 } })
      .toArray();
    campaignNameById = new Map(campaignDocs.map((c) => [String(c._id), c.name]));
  }

  const creators = page.map((row) => {
    const campaignTagIds = new Set();
    for (const jobId of (row.jobIds || [])) {
      const cid = campaignByJobId.get(String(jobId));
      if (cid) campaignTagIds.add(String(cid));
    }
    const campaigns = Array.from(campaignTagIds)
      .map((id) => ({ id, name: campaignNameById.get(id) }))
      .filter((c) => c.name);

    const reel = row.reel || { count: 0, totalViews: 0, totalLikes: 0, totalComments: 0, totalEr: 0 };
    const profile = row.profile || { count: 0, totalViews: 0, totalEr: 0 };

    return {
      id: row._id,
      ownerUsername: row.ownerUsername,
      username: row.username,
      name: row.name || null,
      profileLink: row.profileLink || null,
      followers: row.followers ?? null,
      firstAnalyzedAt: row.firstAnalyzedAt,
      lastAnalyzedAt: row.lastAnalyzedAt,
      // avgEr/timesAnalyzed are stored now (see the pipeline update above),
      // computed here from the raw totals only as a fallback for a row that
      // somehow predates the migration that backfilled them.
      timesAnalyzed: row.timesAnalyzed ?? ((reel.count || 0) + (profile.count || 0)),
      reel: {
        count: reel.count || 0,
        avgViews: reel.count ? Math.round(reel.totalViews / reel.count) : null,
        avgEr: reel.count ? (reel.avgEr ?? Math.round((reel.totalEr / reel.count) * 100) / 100) : null,
      },
      profile: {
        count: profile.count || 0,
        avgViews: profile.count ? Math.round(profile.totalViews / profile.count) : null,
        avgEr: profile.count ? (profile.avgEr ?? Math.round((profile.totalEr / profile.count) * 100) / 100) : null,
      },
      campaigns,
    };
  });

  return { creators, nextCursor };
}

// CSV export deliberately doesn't paginate or join campaign tags -- it's
// one bulk read, capped rather than looped, because an export exists to
// hand someone a finished file, not to stream results into a UI. The
// campaign join in searchAnalyzedCreators above is bounded by page size (a
// few dozen jobIds at a time); doing that same join for up to
// EXPORT_ROW_CAP rows would mean an $in lookup against tens of thousands of
// job ids, which is the wrong trade for a column the CSV doesn't need
// anyway (a campaign filter narrows WHICH rows export; the campaign tag
// text itself is already visible on screen in the app).
const EXPORT_ROW_CAP = 20000;

async function exportAnalyzedCreators({ ownerUsername, isAdmin, search, sort, minFollowers, maxFollowers, minEr, campaignId }) {
  const db = getDb();
  const sortField = SORT_FIELDS[sort] || SORT_FIELDS.recent;
  const and = await buildFilter({ db, ownerUsername, isAdmin, search, minFollowers, maxFollowers, minEr, campaignId });
  const filter = and.length ? { $and: and } : {};

  const rows = await db.collection('analyzedCreators')
    .find(filter)
    .sort({ [sortField]: -1, _id: -1 })
    .limit(EXPORT_ROW_CAP + 1)
    .toArray();

  const truncated = rows.length > EXPORT_ROW_CAP;
  return { rows: truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows, truncated };
}

module.exports = { recordAnalyzedCreator, searchAnalyzedCreators, exportAnalyzedCreators };
