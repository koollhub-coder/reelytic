const express = require('express');
const router = express.Router();
const { getDb, queryId } = require('../db');
const { getReportBranding } = require('../services/branding.service');
const { generateSharedReportExcel } = require('../services/export.service');
const { buildReportContext } = require('../services/reportContext.service');
const { rateLimit } = require('../middleware/rateLimit');

/*
  Every route in this file is intentionally unauthenticated -- it exists
  solely to serve the read-only branded-report view behind a share link
  (see jobs.routes.js POST /:id/share for how the token is minted, and
  BrandedReport.jsx / PublicReport.jsx for the client side).

  Lookups go by the opaque shareToken, never the job's own _id, and the
  response is a hand-built slim projection -- only the fields the report
  itself displays. Internal fields (raw input URLs, per-row flags/notes,
  error messages, cost/credit data) never leave this endpoint, regardless
  of what's actually stored on the job document.
*/

// Generous enough that nobody legitimately reading a report will ever see it
// (a page load is one request), tight enough to bound an automated caller.
const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  scope: 'public-view',
  message: 'Too many requests. Wait a moment and reload the page.',
});

// Deliberately stricter: each call builds an entire workbook in memory, so
// this is the expensive endpoint to leave uncapped.
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  scope: 'public-export',
  message: 'Too many downloads in a row. Wait a minute and try again.',
});

function slimRow(row) {
  // Deliberately no longer requires a username. It used to, which meant a row
  // whose creator failed to resolve vanished from the shared report entirely
  // while still appearing in the agency's own copy, so the two disagreed on
  // how many creators the campaign covered. The row travels; the client-side
  // renderer labels it honestly (see creatorLabel in ReportSheet.jsx).
  if (row.state !== 'done' || !row.result) return null;
  const r = row.result;
  return {
    state: 'done',
    result: {
      username: r.username ?? null,
      followers: r.followers ?? 0,
      views: r.views ?? 0,
      likes: r.likes ?? 0,
      comments: r.comments ?? 0,
      avgViews: r.avgViews ?? 0,
      er: r.er ?? 0,
      avgEr: r.avgEr ?? 0,
    },
  };
}

/*
  Resolves a share token to a job, or to the reason it can't be used.

  An expired link and a revoked one are deliberately given the SAME message.
  Confirming "this link existed but expired" tells a stranger they guessed a
  real token, which is exactly the signal a token is supposed to withhold.
  The owner sees the real expiry state in their own share dialog instead.
*/
async function resolveSharedJob(token) {
  const db = getDb();
  const job = await db.collection('jobs').findOne({ shareToken: token });
  if (!job) return { error: 'This link is invalid or has been turned off.' };

  if (job.shareExpiresAt && new Date(job.shareExpiresAt).getTime() <= Date.now()) {
    return { error: 'This link is invalid or has been turned off.' };
  }
  return { job };
}

router.get('/reports/:token', viewLimiter, async (req, res, next) => {
  try {
    const { job, error } = await resolveSharedJob(req.params.token);
    if (error) return res.status(404).json({ error });

    const branding = await getReportBranding(job.ownerUsername);

    /*
      Open tracking, so the agency can tell their client actually looked at
      the report. Fire-and-forget: a failed counter update must never stop
      the report from rendering, and $inc is atomic so concurrent opens
      can't clobber each other.

      Counts opens, not people. There's no cookie or fingerprint here, by
      choice -- the viewer is someone else's client who never agreed to
      anything, and a reload counting twice is a far smaller problem than
      quietly tracking individuals across a link we handed out.
    */
    getDb().collection('jobs').updateOne(
      { _id: queryId(job._id) },
      { $inc: { shareViews: 1 }, $set: { shareLastViewedAt: new Date() } }
    ).catch(() => {});

    /*
      Context is safe to send here. The benchmark half is an aggregate over
      many accounts with no individual figures in it, and the previous-report
      half is derived from the SAME agency's own campaign, which is the party
      that chose to share this link in the first place. It carries the prior
      report's name and headline totals only, never its rows.
    */
    const context = await buildReportContext(job).catch(() => ({ benchmark: null, previous: null }));

    res.json({
      job: {
        type: job.type,
        fileName: job.fileName,
        createdAt: job.createdAt,
        rows: (job.rows || []).map(slimRow).filter(Boolean),
      },
      branding: branding || {},
      context,
    });
  } catch (err) {
    next(err);
  }
});

/*
  The persistent client portal: a whole campaign's rolled-up performance
  behind one non-expiring link, instead of one report at a time. Same
  unauthenticated shape as /reports/:token above (opaque token, slim
  hand-picked projection, fire-and-forget view counter), just aggregated
  across every job tagged to the campaign rather than a single job.
*/
router.get('/campaigns/:token', viewLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.collection('campaigns').findOne({ portalToken: req.params.token });
    if (!campaign) return res.status(404).json({ error: 'This link is invalid or has been turned off.' });

    const jobs = await db.collection('jobs').find({ campaignId: campaign._id, ownerUsername: campaign.ownerUsername }).toArray();
    const branding = await getReportBranding(campaign.ownerUsername);

    getDb().collection('campaigns').updateOne(
      { _id: queryId(campaign._id) },
      { $inc: { portalViews: 1 }, $set: { portalLastViewedAt: new Date() } }
    ).catch(() => {});

    let totalViews = 0;
    let weightedErSum = 0;
    const rows = [];
    for (const job of jobs) {
      for (const row of job.rows || []) {
        const slim = slimRow(row);
        if (!slim) continue;
        const views = Number(slim.result.views ?? slim.result.avgViews ?? 0);
        const er = Number(slim.result.er ?? slim.result.avgEr ?? 0);
        totalViews += views;
        weightedErSum += er * views;
        rows.push({ ...slim, reportName: job.fileName || null, reportType: job.type, addedAt: job.createdAt });
      }
    }
    // Newest report's rows first, so a client re-opening a living link sees
    // whatever was most recently added at the top rather than buried below
    // an ever-growing older campaign history.
    rows.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

    res.json({
      campaign: {
        name: campaign.name,
        avatarUrl: campaign.avatarUrl || null,
        reportCount: jobs.length,
        totalViews,
        avgEr: totalViews > 0 ? Math.round((weightedErSum / totalViews) * 100) / 100 : null,
      },
      rows,
      branding: branding || {},
    });
  } catch (err) {
    next(err);
  }
});

// Same token gate as the view above -- whoever can read the report can take
// the table with them. Only the report's own columns, not the client's
// original uploaded sheet.
router.get('/reports/:token/export.xlsx', exportLimiter, async (req, res, next) => {
  try {
    const { job, error } = await resolveSharedJob(req.params.token);
    if (error) return res.status(404).json({ error });

    const branding = await getReportBranding(job.ownerUsername);
    const buffer = await generateSharedReportExcel({ job, branding: branding || {} });

    // Drop the source file's own extension first, otherwise an upload named
    // "links.txt" downloads as "links.txt.xlsx".
    const safeName = String(job.fileName || 'reelytic-report')
      .replace(/\.(xlsx?|csv|txt|tsv)$/i, '')
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 60) || 'reelytic-report';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
