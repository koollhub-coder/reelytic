const { getDb } = require('../db');

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

  const set = { ownerUsername, username, lastAnalyzedAt: now, updatedAt: now };
  if (result.name) set.name = result.name;
  if (result.profileLink) set.profileLink = result.profileLink;
  if (result.followers != null) set.followers = result.followers;

  const inc = type === 'reel'
    ? {
        'reel.count': 1,
        'reel.totalViews': result.views || 0,
        'reel.totalLikes': result.likes || 0,
        'reel.totalComments': result.comments || 0,
        'reel.totalEr': result.er || 0,
      }
    : {
        'profile.count': 1,
        'profile.totalViews': result.avgViews || 0,
        'profile.totalEr': result.avgEr || 0,
      };

  const update = { $set: set, $setOnInsert: { firstAnalyzedAt: now }, $inc: inc };
  if (jobId) update.$push = { jobIds: { $each: [String(jobId)], $slice: -20 } };

  await db.collection('analyzedCreators').updateOne(
    { _id: creatorId(ownerUsername, username) },
    update,
    { upsert: true }
  );
}

/*
  Keyset (not skip/offset) pagination -- an offset-based "page 4,000" query
  degrades linearly with how far in you page, which is exactly the wrong
  shape for a collection meant to hold up to a million rows. `cursor` is an
  opaque token carrying the last row's (lastAnalyzedAt, _id): the next page
  asks for "everything older than that point, or exactly as old but sorting
  after it by id" -- the standard two-column keyset comparison, needed
  because lastAnalyzedAt alone isn't unique.

  Search is a case-insensitive PREFIX match (^term), not a substring match,
  and that's deliberate rather than a shortcut: MongoDB can only use a
  {username:1}/{name:1} index to serve a regex that's anchored at the start
  of the string. A substring search ("contains" anywhere) cannot use that
  index at all and degrades to a full collection scan -- fine at a thousand
  rows, not at a million. Prefix search is also just how this kind of
  lookup normally works elsewhere (GitHub, Twitter user search): type the
  start of a handle or name and matches narrow as you go.
*/
function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ t: row.lastAnalyzedAt, id: row._id })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const { t, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { t: new Date(t), id };
  } catch (e) {
    return null;
  }
}

async function searchAnalyzedCreators({ ownerUsername, isAdmin, search, cursor, limit = 30 }) {
  const db = getDb();
  const and = [];
  if (!isAdmin) and.push({ ownerUsername });
  const cleanSearch = (search || '').trim();
  if (cleanSearch) {
    const rx = new RegExp(`^${escapeRegex(cleanSearch)}`, 'i');
    and.push({ $or: [{ username: rx }, { name: rx }] });
  }
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (decoded) {
    and.push({ $or: [
      { lastAnalyzedAt: { $lt: decoded.t } },
      { lastAnalyzedAt: decoded.t, _id: { $lt: decoded.id } },
    ] });
  }

  const filter = and.length ? { $and: and } : {};
  const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 100);

  const rows = await db.collection('analyzedCreators')
    .find(filter)
    .sort({ lastAnalyzedAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .toArray();

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

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
    const { queryId } = require('../db');
    const jobDocs = await db.collection('jobs')
      .find({ _id: { $in: Array.from(jobIdSet).map((id) => queryId(id)) } }, { projection: { campaignId: 1 } })
      .toArray();
    campaignByJobId = new Map(jobDocs.map((j) => [String(j._id), j.campaignId || null]));
  }
  const campaignIdsNeeded = new Set(Array.from(campaignByJobId.values()).filter(Boolean));
  let campaignNameById = new Map();
  if (campaignIdsNeeded.size) {
    const { queryId } = require('../db');
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
      timesAnalyzed: (reel.count || 0) + (profile.count || 0),
      reel: {
        count: reel.count || 0,
        avgViews: reel.count ? Math.round(reel.totalViews / reel.count) : null,
        avgEr: reel.count ? Math.round((reel.totalEr / reel.count) * 100) / 100 : null,
      },
      profile: {
        count: profile.count || 0,
        avgViews: profile.count ? Math.round(profile.totalViews / profile.count) : null,
        avgEr: profile.count ? Math.round((profile.totalEr / profile.count) * 100) / 100 : null,
      },
      campaigns,
    };
  });

  return { creators, nextCursor };
}

module.exports = { recordAnalyzedCreator, searchAnalyzedCreators };
