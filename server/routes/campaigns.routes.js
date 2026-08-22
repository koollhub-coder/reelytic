const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { getDb, queryId } = require('../db');

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

function computeRollup(jobs) {
  let totalLinks = 0;
  let successCount = 0;
  let totalViews = 0;
  let weightedErSum = 0; // sum(er * views), divided by totalViews for a views-weighted average
  let earliestAt = null;
  let latestAt = null;

  for (const job of jobs) {
    totalLinks += (job.counts && job.counts.total) || 0;
    successCount += (job.counts && job.counts.success) || 0;
    for (const row of job.rows || []) {
      if (row.state !== 'done' || !row.result) continue;
      const views = Number(row.result.views ?? row.result.avgViews ?? 0);
      const er = Number(row.result.er ?? row.result.avgEr ?? 0);
      totalViews += views;
      weightedErSum += er * views;
    }
    const created = job.createdAt ? new Date(job.createdAt).getTime() : null;
    if (created != null) {
      if (earliestAt == null || created < earliestAt) earliestAt = created;
      if (latestAt == null || created > latestAt) latestAt = created;
    }
  }

  return {
    reportCount: jobs.length,
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
    const ownerUsername = req.currentUser.role === 'admin' && req.query.user ? req.query.user : req.currentUser.username;

    const campaigns = await db.collection('campaigns').find({ ownerUsername }).sort({ createdAt: -1 }).toArray();
    const jobs = await db.collection('jobs').find({ ownerUsername }).toArray();

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
      avatarUrl = validateAvatarDataUri(req.body && req.body.avatarUrl);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const db = getDb();
    const campaign = {
      _id: new ObjectId().toHexString(),
      name,
      avatarUrl,
      ownerUsername: req.currentUser.username,
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
    if (campaign.ownerUsername !== req.currentUser.username) return res.status(403).json({ error: 'Forbidden' });

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
    if (campaign.ownerUsername !== req.currentUser.username) return res.status(403).json({ error: 'Forbidden' });

    await db.collection('campaigns').deleteOne({ _id: queryId(req.params.id) });
    await db.collection('jobs').updateMany(
      { campaignId: req.params.id, ownerUsername: req.currentUser.username },
      { $set: { campaignId: null } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
