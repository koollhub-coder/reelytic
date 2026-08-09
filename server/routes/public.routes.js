const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getReportBranding } = require('../services/branding.service');
const { generateSharedReportExcel } = require('../services/export.service');

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

function slimRow(row) {
  if (row.state !== 'done' || !row.result || !row.result.username) return null;
  const r = row.result;
  return {
    state: 'done',
    result: {
      username: r.username,
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

router.get('/reports/:token', async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ shareToken: req.params.token });
    if (!job) return res.status(404).json({ error: 'This link is invalid or has been turned off.' });

    const branding = await getReportBranding(job.ownerUsername);

    res.json({
      job: {
        type: job.type,
        fileName: job.fileName,
        createdAt: job.createdAt,
        rows: (job.rows || []).map(slimRow).filter(Boolean),
      },
      branding: branding || {},
    });
  } catch (err) {
    next(err);
  }
});

// Same token gate as the view above -- whoever can read the report can take
// the table with them. Only the report's own columns, not the client's
// original uploaded sheet.
router.get('/reports/:token/export.xlsx', async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ shareToken: req.params.token });
    if (!job) return res.status(404).json({ error: 'This link is invalid or has been turned off.' });

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
