const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { getDb, queryId } = require('../db');
const { startJob, pauseJob, resetJob, retryFailedRows } = require('../services/jobEngine.service');
const { costForRun, costPerItem } = require('../services/credits.service');
const { getActiveJobPointer, clearActiveJobPointer } = require('../services/activeJob.service');
const { hasFeature } = require('../services/features.service');

// Escapes regex special characters in free-text search input before it's
// used to build a MongoDB $regex -- otherwise a search term like "a.b*c"
// would be interpreted as a pattern instead of literal text.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const ownerUsername = req.currentUser.role === 'admin' && req.query.user ? req.query.user : req.currentUser.username;
    const query = { ownerUsername };

    // Creator search spans every report's individual rows, not just the
    // job-level fields, so it goes through submittedLinks (where each row's
    // resolved username actually lives) and narrows the job list to matches.
    const creator = (req.query.creator || '').trim();
    if (creator) {
      const matches = await db.collection('submittedLinks').find({
        username: ownerUsername,
        resolvedUsername: { $regex: escapeRegex(creator), $options: 'i' },
      }).project({ jobId: 1 }).toArray();
      const matchingJobIds = new Set(matches.map((m) => m.jobId));
      if (matchingJobIds.size === 0) return res.json({ jobs: [], total: 0, page: 1, limit: 100, hasMore: false });
      query._id = { $in: [...matchingJobIds].map((id) => queryId(id)) };
    }

    // Paged, not a flat .limit(100). The old hard cap meant an account with
    // more than 100 reports simply could not reach the older ones -- they
    // weren't paginated, they were unreachable. Defaults keep the previous
    // page-one behaviour for any caller that doesn't pass params.
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));

    const total = await db.collection('jobs').countDocuments(query);
    const jobs = await db.collection('jobs')
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const slim = jobs.map(j => ({
      id: j._id,
      type: j.type,
      fileName: j.fileName,
      status: j.status,
      counts: j.counts,
      createdAt: j.createdAt,
      startedAt: j.startedAt || null,
      finishedAt: j.finishedAt || null,
      ownerUsername: j.ownerUsername,
      campaignId: j.campaignId || null
    }));

    res.json({ jobs: slim, total, page, limit, hasMore: page * limit < total });
  } catch (err) {
    next(err);
  }
});

// Assigns or clears which campaign a report belongs to. Purely organizational
// -- works regardless of report status, and never touches anything the
// report engine itself reads (rows, counts, status, the active-report
// pointer). campaignId: null clears it back to "no campaign".
router.patch('/:id/campaign', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { campaignId } = req.body || {};
    if (campaignId) {
      const campaign = await db.collection('campaigns').findOne({ _id: queryId(campaignId) });
      if (!campaign || campaign.ownerUsername !== job.ownerUsername) {
        return res.status(400).json({ error: 'Campaign not found' });
      }
    }

    await db.collection('jobs').updateOne(
      { _id: queryId(req.params.id) },
      { $set: { campaignId: campaignId || null, updatedAt: new Date() } }
    );
    res.json({ success: true, campaignId: campaignId || null });
  } catch (err) {
    next(err);
  }
});

// Rehydration endpoint: the client holds no run state of its own (jobId lives
// only in React state today, which is why switching tabs or refreshing wipes
// an in-progress run) -- on mount it asks this for "do I have an existing
// report of this type to resume?" instead of always starting at the upload
// screen. Backed by an explicit per-user+type pointer (see
// activeJob.service.js), not a "most recent" query -- a query-based heuristic
// lets an older job resurface the instant the current one is discarded.
router.get('/active', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const type = req.query.type;
    if (type !== 'reel' && type !== 'profile') return res.status(400).json({ error: 'type must be reel or profile' });

    const pointerId = await getActiveJobPointer(req.currentUser.username, type);
    if (!pointerId) return res.json({ job: null });

    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(pointerId) });
    if (!job || job.ownerUsername !== req.currentUser.username) return res.json({ job: null });

    res.json({ job });
  } catch (err) {
    next(err);
  }
});

// Per-row triage note/flag -- purely organizational, like campaign
// assignment: never touches the metrics themselves. Lets a user mark a row
// Approved or Flagged with a short note while reviewing a report, before
// sending the numbers upstream to their own client.
router.patch('/:id/rows/:rowIndex', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rowIndex = parseInt(req.params.rowIndex, 10);
    const rowExists = (job.rows || []).some((r) => r.i === rowIndex);
    if (!rowExists) return res.status(404).json({ error: 'Row not found' });

    const { flag, note } = req.body || {};
    if (flag !== null && flag !== undefined && flag !== 'approved' && flag !== 'flagged') {
      return res.status(400).json({ error: 'flag must be "approved", "flagged", or null' });
    }
    const cleanFlag = flag || null;
    const cleanNote = String(note || '').slice(0, 280);

    await db.collection('jobs').updateOne(
      { _id: queryId(req.params.id), 'rows.i': rowIndex },
      { $set: { 'rows.$.flag': cleanFlag, 'rows.$.note': cleanNote, updatedAt: new Date() } }
    );

    res.json({ success: true, flag: cleanFlag, note: cleanNote });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/rows', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });

    const page = parseInt(req.query.page || '1', 10);
    const limit = 50;
    const state = req.query.state; // all, valid, invalid, duplicate

    let filtered = job.rows;
    if (state === 'valid') filtered = job.rows.filter(r => r.state !== 'invalid' && r.state !== 'duplicate');
    else if (state === 'invalid') filtered = job.rows.filter(r => r.state === 'invalid');
    else if (state === 'duplicates') filtered = job.rows.filter(r => r.state === 'duplicate');

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    res.json({
      total,
      page,
      limit,
      rows: paginated
    });
  } catch (err) {
    next(err);
  }
});

// renames: { oldName: newName } | removed: [name, ...] | order: [name, ...]
// (full desired column order). Applied in that sequence so an order array
// referencing a just-removed column is simply ignored rather than erroring.
router.patch('/:id/columns', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const { renames, removed, order } = req.body;
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.status !== 'preview') return res.status(400).json({ error: 'Can only edit columns in preview state' });

    let cols = job.originalColumns || [];
    if (renames) {
      cols = cols.map(c => ({
        name: c.name,
        renamedTo: renames[c.name] !== undefined ? renames[c.name] : (c.renamedTo || c.name)
      }));
    }
    if (Array.isArray(removed) && removed.length) {
      const removeSet = new Set(removed);
      cols = cols.filter(c => !removeSet.has(c.name));
    }
    if (Array.isArray(order) && order.length) {
      const byName = new Map(cols.map(c => [c.name, c]));
      const reordered = order.map(n => byName.get(n)).filter(Boolean);
      // Anything not mentioned in `order` (shouldn't happen from the UI, but
      // stay safe) keeps its relative position at the end rather than
      // silently disappearing.
      const mentioned = new Set(order);
      const missing = cols.filter(c => !mentioned.has(c.name));
      cols = [...reordered, ...missing];
    }

    await db.collection('jobs').updateOne(
      { _id: queryId(req.params.id) },
      { $set: { originalColumns: cols, updatedAt: new Date() } }
    );

    res.json({ success: true, columns: cols });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/start', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });

    const validRowsCount = job.rows.filter(r => r.state !== 'invalid' && r.state !== 'duplicate' && r.state !== 'skipped').length;

    if (validRowsCount > 2000 && !req.body.limitTo2000Confirmed) {
      return res.status(422).json({
        code: 'OVER_LIMIT',
        error: `Sheet has ${validRowsCount} valid links. Reelytic runs up to 2,000 per report.`,
        validRowsCount
      });
    }

    // If over limit and confirmed, mark rows after 2000 as skipped
    let rows = job.rows;
    if (validRowsCount > 2000 && req.body.limitTo2000Confirmed) {
      let activeValid = 0;
      rows = rows.map(r => {
        if (r.state !== 'invalid' && r.state !== 'duplicate' && r.state !== 'skipped') {
          activeValid++;
          if (activeValid > 2000) {
            return { ...r, state: 'skipped', error: 'Exceeded 2,000-link report limit' };
          }
        }
        return r;
      });
    }

    await db.collection('jobs').updateOne(
      { _id: queryId(req.params.id) },
      { $set: { rows, updatedAt: new Date() } }
    );

    // ---- Credit pre-flight: block a run the user can't afford (worst case) ----
    const chargeable = rows.filter(r => r.state !== 'invalid' && r.state !== 'duplicate' && r.state !== 'skipped').length;
    const cost = costForRun(job.type, chargeable);
    const balance = req.currentUser.credits || 0;
    if (balance < cost) {
      return res.status(402).json({
        code: 'INSUFFICIENT_CREDITS',
        error: `This run needs ${cost} credits (${chargeable} ${job.type}s × ${costPerItem(job.type)}), but you have ${balance}.`,
        needed: cost,
        balance,
        shortBy: cost - balance,
        perItem: costPerItem(job.type),
        chargeable,
      });
    }

    await startJob(req.params.id);
    res.json({ success: true, status: 'running', creditCost: cost });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/pause', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    await pauseJob(req.params.id);
    res.json({ success: true, status: 'paused' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resume', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    await startJob(req.params.id);
    res.json({ success: true, status: 'running' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    await resetJob(req.params.id);
    res.json({ success: true, status: 'preview' });
  } catch (err) {
    next(err);
  }
});

// Explicit "start new report" -- the only thing that clears the active-job
// pointer (see activeJob.service.js), so GET /active goes back to null and
// the next visit lands on a fresh upload screen, not an older report. A
// running job is paused first so nothing keeps burning Apify calls for a
// report the user has walked away from.
router.post('/:id/discard', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (job.status === 'running') {
      await pauseJob(req.params.id);
    }
    await db.collection('jobs').updateOne(
      { _id: queryId(req.params.id) },
      { $set: { dismissed: true, updatedAt: new Date() } }
    );
    const pointerId = await getActiveJobPointer(job.ownerUsername, job.type);
    if (pointerId === req.params.id) {
      await clearActiveJobPointer(job.ownerUsername, job.type);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Turns on the public, unauthenticated view of this report (see
// public.routes.js) by minting an opaque token -- deliberately not the job's
// own _id, so the link can be revoked independently of the report itself and
// isn't tied to whatever ID scheme the authenticated app happens to use.
// Idempotent: a link already handed to a client (email, Slack) must keep
// working on repeat clicks instead of silently rotating under them.
router.post('/:id/share', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let shareToken = job.shareToken;
    if (!shareToken) {
      // Minting a brand-new link requires the feature; a report that
      // already has one keeps working below regardless -- same
      // grandfathering rule as report branding (see settings.routes.js).
      if (!(await hasFeature(req.currentUser, 'shareableLinks'))) {
        return res.status(403).json({ error: 'Shareable links aren\'t available on your current plan. Upgrade to share reports with clients.', code: 'FEATURE_LOCKED' });
      }
      shareToken = crypto.randomBytes(16).toString('hex');
      await db.collection('jobs').updateOne(
        { _id: queryId(req.params.id) },
        { $set: { shareToken, updatedAt: new Date() } }
      );
    }
    res.json({ success: true, shareToken });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/share/revoke', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // $set to null rather than $unset -- the in-memory DB fallback (see
    // db.js MemoryCollection.updateOne) only implements $set/$inc/$push, so
    // $unset would silently no-op there and leave the link live.
    await db.collection('jobs').updateOne(
      { _id: queryId(req.params.id) },
      { $set: { shareToken: null, updatedAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/retry-failed', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    await retryFailedRows(req.params.id);
    res.json({ success: true, status: 'running' });
  } catch (err) {
    next(err);
  }
});

// Delta progress endpoint (Section 8)
router.get('/:id/progress', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const after = parseInt(req.query.after || '0', 10);
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Report not found' });

    // Delta updates: rows with index > after whose state changed or finished
    const updates = job.rows
      .filter(r => r.i > after && (r.state === 'done' || r.state === 'failed' || r.state === 'processing'))
      .map(r => ({ i: r.i, state: r.state, result: r.result, error: r.error, fromCache: r.fromCache }));

    res.json({
      status: job.status,
      counts: job.counts,
      cursor: job.cursor,
      etaMs: (job.rows.length - job.cursor) * (job.avgRowMs || 1500),
      currentRows: job.rows.slice(job.cursor, job.cursor + 5).map(r => ({ i: r.i, url: r.input.url })),
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      updates
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
