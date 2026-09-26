const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { getDb, queryId } = require('../db');
const { hasFeature } = require('../services/features.service');

// Campaigns are a pure organizing layer on top of reports (jobs) -- a report
// still runs, pauses, and exports exactly as before whether or not it's
// tagged to a campaign. Deleting a campaign only detaches its reports
// (campaignId cleared back to none), it never touches the reports themselves.

/*
  Campaign avatar: same data-URI-on-document pattern as reportBranding.logoDataUri
  (server/services/branding.service.js) -- Render's filesystem is ephemeral, so a
  saved file path goes stale on the next deploy, and this app has no object
  storage wired up. A capped, validated data URI needs no new infrastructure and
  is trivial against MongoDB's 16MB document limit.
*/
const MAX_AVATAR_BYTES = 512 * 1024; // smaller than the 1MB logo cap -- this renders at ~40px, never full-size
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Throws a plain Error with a client-safe message -- the route handler turns
// that into a 400, never a 500. Returns null for "no avatar" (explicit clear).
function validateAvatarDataUri(avatarUrl) {
  if (avatarUrl === null || avatarUrl === '') return null;
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(avatarUrl);
  if (!match) throw new Error('Avatar must be an uploaded image file.');
  const [, mime, base64] = match;
  if (!ALLOWED_AVATAR_TYPES.includes(mime.toLowerCase())) {
    throw new Error('Avatar must be a PNG, JPG, or WEBP file.');
  }
  const approxBytes = Math.floor(base64.length * 0.75);
  if (approxBytes > MAX_AVATAR_BYTES) {
    throw new Error('Avatar file is too large. Use an image under 512KB.');
  }
  return avatarUrl;
}

/*
  One small summary per report, computed where the data lives.

  The campaign list used to load EVERY report the account owns, rows and all
  (a 200-row report is hundreds of kilobytes), pull it across the network, and add
  the rows up here. For an account with a few dozen reports that was tens of
  megabytes to draw a list of campaign names and four numbers. The database now
  adds up each report's rows itself and sends back only the totals.
*/
function summarizeJobLocally(job) {
  let views = 0;
  let weighted = 0;
  for (const row of job.rows || []) {
    if (row.state !== 'done' || !row.result) continue;
    const v = Number(row.result.views ?? row.result.avgViews ?? 0);
    const er = Number(row.result.er ?? row.result.avgEr ?? 0);
    views += v;
    weighted += er * v;
  }
  return {
    campaignId: job.campaignId || null,
    createdAt: job.createdAt || null,
    total: (job.counts && job.counts.total) || 0,
    success: (job.counts && job.counts.success) || 0,
    views,
    weighted,
  };
}

async function loadJobSummaries(db, ownerUsername) {
  const jobs = db.collection('jobs');
  if (typeof jobs.aggregate === 'function') {
    const rows = await jobs.aggregate([
      { $match: { ownerUsername } },
      {
        $project: {
          campaignId: 1,
          createdAt: 1,
          total: { $ifNull: ['$counts.total', 0] },
          success: { $ifNull: ['$counts.success', 0] },
          sums: {
            $reduce: {
              input: { $ifNull: ['$rows', []] },
              initialValue: { v: 0, w: 0 },
              in: {
                $let: {
                  vars: {
                    ok: { $and: [{ $eq: ['$$this.state', 'done'] }, { $ne: [{ $ifNull: ['$$this.result', null] }, null] }] },
                    views: { $convert: { input: { $ifNull: ['$$this.result.views', '$$this.result.avgViews'] }, to: 'double', onError: 0, onNull: 0 } },
                    er: { $convert: { input: { $ifNull: ['$$this.result.er', '$$this.result.avgEr'] }, to: 'double', onError: 0, onNull: 0 } },
                  },
                  in: {
                    $cond: [
                      '$$ok',
                      { v: { $add: ['$$value.v', '$$views'] }, w: { $add: ['$$value.w', { $multiply: ['$$er', '$$views'] }] } },
                      '$$value',
                    ],
                  },
                },
              },
            },
          },
        },
      },
    ]).toArray();
    return rows.map((r) => ({ campaignId: r.campaignId || null, createdAt: r.createdAt || null, total: r.total, success: r.success, views: r.sums.v, weighted: r.sums.w }));
  }
  // The local JSON fallback has no aggregation, so it sums in memory (dev only).
  const all = await jobs.find({ ownerUsername }).toArray();
  return all.map(summarizeJobLocally);
}

function computeRollup(summaries) {
  let totalLinks = 0;
  let successCount = 0;
  let totalViews = 0;
  let weightedErSum = 0; // sum(er * views), divided by totalViews for a views-weighted average
  let earliestAt = null;
  let latestAt = null;

  for (const job of summaries) {
    totalLinks += job.total;
    successCount += job.success;
    totalViews += job.views;
    weightedErSum += job.weighted;
    const created = job.createdAt ? new Date(job.createdAt).getTime() : null;
    if (created != null) {
      if (earliestAt == null || created < earliestAt) earliestAt = created;
      if (latestAt == null || created > latestAt) latestAt = created;
    }
  }

  return {
    reportCount: summaries.length,
    totalLinks,
    successCount,
    totalViews,
    avgEr: totalViews > 0 ? Math.round((weightedErSum / totalViews) * 100) / 100 : null,
    earliestAt: earliestAt != null ? new Date(earliestAt) : null,
    latestAt: latestAt != null ? new Date(latestAt) : null,
  };
}

router.get('/', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const ownerUsername = req.currentUser.role === 'admin' && req.query.user ? req.query.user : req.currentUser.effectiveUsername;

    const [campaigns, jobs] = await Promise.all([
      db.collection('campaigns').find({ ownerUsername }).sort({ createdAt: -1 }).toArray(),
      loadJobSummaries(db, ownerUsername),
    ]);

    const jobsByCampaign = new Map();
    const uncategorized = [];
    for (const job of jobs) {
      if (job.campaignId) {
        if (!jobsByCampaign.has(job.campaignId)) jobsByCampaign.set(job.campaignId, []);
        jobsByCampaign.get(job.campaignId).push(job);
      } else {
        uncategorized.push(job);
      }
    }

    const result = campaigns.map((c) => ({
      id: c._id,
      name: c.name,
      avatarUrl: c.avatarUrl || null,
      createdAt: c.createdAt,
      ...computeRollup(jobsByCampaign.get(c._id) || []),
    }));

    res.json({
      campaigns: result,
      uncategorized: computeRollup(uncategorized),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (name.length > 80) return res.status(400).json({ error: 'Campaign name is too long' });

    let avatarUrl = null;
    try {
      // A campaign made without a picture (the API, or a client that omits the field) is fine.
      avatarUrl = validateAvatarDataUri(req.body && req.body.avatarUrl !== undefined ? req.body.avatarUrl : null);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const db = getDb();
    const campaign = {
      _id: new ObjectId().toHexString(),
      name,
      avatarUrl,
      ownerUsername: req.currentUser.effectiveUsername,
      createdAt: new Date(),
    };
    await db.collection('campaigns').insertOne(campaign);
    res.json({ campaign: { id: campaign._id, name: campaign.name, avatarUrl: campaign.avatarUrl, createdAt: campaign.createdAt } });
  } catch (err) {
    next(err);
  }
});

// Avatar-only update (rename support can be added the same way later, but
// nothing currently needs it). Same ownership check as delete below.
router.patch('/:id', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.collection('campaigns').findOne({ _id: queryId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.ownerUsername !== req.currentUser.effectiveUsername) return res.status(403).json({ error: 'Forbidden' });

    let avatarUrl;
    try {
      avatarUrl = validateAvatarDataUri(req.body && req.body.avatarUrl);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await db.collection('campaigns').updateOne({ _id: queryId(req.params.id) }, { $set: { avatarUrl } });
    res.json({ campaign: { id: campaign._id, name: campaign.name, avatarUrl } });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.collection('campaigns').findOne({ _id: queryId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.ownerUsername !== req.currentUser.effectiveUsername) return res.status(403).json({ error: 'Forbidden' });

    await db.collection('campaigns').deleteOne({ _id: queryId(req.params.id) });
    await db.collection('jobs').updateMany(
      { campaignId: req.params.id, ownerUsername: req.currentUser.effectiveUsername },
      { $set: { campaignId: null } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/*
  Persistent client portal: a single, non-expiring link that shows a campaign's
  whole rolled-up performance, unlike the per-report share link in
  jobs.routes.js (POST /:id/share) which covers one report and can expire.
  Same token shape and same "mint only once, read-only status, explicit
  revoke" pattern as that file, just stored on the campaign document instead
  of the job -- see public.routes.js GET /campaigns/:token for how it's
  resolved on the other end, with no login.
*/
function portalState(campaign) {
  return {
    portalToken: campaign.portalToken || null,
    portalViews: campaign.portalViews || 0,
    portalLastViewedAt: campaign.portalLastViewedAt || null,
  };
}

router.post('/:id/portal', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.collection('campaigns').findOne({ _id: queryId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.ownerUsername !== req.currentUser.effectiveUsername) return res.status(403).json({ error: 'Forbidden' });

    if (!campaign.portalToken && !(await hasFeature(req.currentUser, 'clientPortal'))) {
      return res.status(403).json({ error: 'The client portal isn\'t available on your current plan. Upgrade to give clients a living link to this campaign.', code: 'FEATURE_LOCKED' });
    }

    let portalToken = campaign.portalToken;
    const update = {};
    if (!portalToken) {
      portalToken = crypto.randomBytes(16).toString('hex');
      update.portalToken = portalToken;
      update.portalViews = 0;
      update.portalLastViewedAt = null;
    }
    await db.collection('campaigns').updateOne({ _id: queryId(req.params.id) }, { $set: update });
    res.json({ success: true, ...portalState({ ...campaign, ...update }) });
  } catch (err) {
    next(err);
  }
});

// Read-only status, same reasoning as GET /jobs/:id/share -- opening the
// dialog to look at it must not itself mint a link nobody asked for.
router.get('/:id/portal', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.collection('campaigns').findOne({ _id: queryId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.ownerUsername !== req.currentUser.effectiveUsername) return res.status(403).json({ error: 'Forbidden' });
    res.json(portalState(campaign));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/portal/revoke', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.collection('campaigns').findOne({ _id: queryId(req.params.id) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.ownerUsername !== req.currentUser.effectiveUsername) return res.status(403).json({ error: 'Forbidden' });

    // $set to null, not $unset -- same reason as jobs.routes.js's share
    // revoke: the in-memory DB fallback only implements $set/$inc/$push.
    await db.collection('campaigns').updateOne(
      { _id: queryId(req.params.id) },
      { $set: { portalToken: null } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
