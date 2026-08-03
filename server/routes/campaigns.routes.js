const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { getDb, queryId } = require('../db');

// Campaigns are a pure organizing layer on top of reports (jobs) -- a report
// still runs, pauses, and exports exactly as before whether or not it's
// tagged to a campaign. Deleting a campaign only detaches its reports
// (campaignId cleared back to none), it never touches the reports themselves.

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

    const db = getDb();
    const campaign = {
      _id: new ObjectId().toHexString(),
      name,
      ownerUsername: req.currentUser.username,
      createdAt: new Date(),
    };
    await db.collection('campaigns').insertOne(campaign);
    res.json({ campaign: { id: campaign._id, name: campaign.name, createdAt: campaign.createdAt } });
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
