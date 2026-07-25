const express = require('express');
const router = express.Router();
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { getDb, queryId } = require('../db');
const { startJob, pauseJob, resetJob, retryFailedRows } = require('../services/jobEngine.service');
const { costForRun, costPerItem } = require('../services/credits.service');

router.get('/', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const query = req.currentUser.role === 'admin' && req.query.user ? { ownerUsername: req.query.user } : { ownerUsername: req.currentUser.username };
    const jobs = await db.collection('jobs').find(query).sort({ createdAt: -1 }).limit(100).toArray();

    const slim = jobs.map(j => ({
      id: j._id,
      type: j.type,
      fileName: j.fileName,
      status: j.status,
      counts: j.counts,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt || null,
      ownerUsername: j.ownerUsername
    }));

    res.json({ jobs: slim });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Job not found' });
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
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const page = parseInt(req.query.page || '1', 10);
    const limit = 100;
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

router.patch('/:id/columns', requireLogin, requireChangePasswordCheck, async (req, res, next) => {
  try {
    const { renames, removed } = req.body; // renames: { oldName: newName }
    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'preview') return res.status(400).json({ error: 'Can only edit columns in preview state' });

    let cols = job.originalColumns || [];
    if (renames) {
      cols = cols.map(c => ({
        name: c.name,
        renamedTo: renames[c.name] !== undefined ? renames[c.name] : (c.renamedTo || c.name)
      }));
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
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const validRowsCount = job.rows.filter(r => r.state !== 'invalid' && r.state !== 'duplicate' && r.state !== 'skipped').length;

    if (validRowsCount > 2000 && !req.body.limitTo2000Confirmed) {
      return res.status(422).json({
        code: 'OVER_LIMIT',
        error: `Sheet has ${validRowsCount} valid links. Reelytic runs up to 2,000 per job.`,
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
            return { ...r, state: 'skipped', error: 'Exceeded 2,000-link job limit' };
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
    if (!job) return res.status(404).json({ error: 'Job not found' });

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
      updates
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
