const express = require('express');
const router = express.Router();
const multer = require('multer');
const { ObjectId } = require('mongodb');
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { parseSpreadsheetBuffer } = require('../services/parse.service');
const { getDb } = require('../db');
const { getLearnedAvgMs } = require('../services/learnedTiming.service');
const { setActiveJobPointer } = require('../services/activeJob.service');
const { getProfilePipelineMode } = require('../services/profilePipeline.service');
const { getReelPipelineMode } = require('../services/reelPipeline.service');
const { costPerItem } = require('../services/credits.service');

const upload = multer({
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

router.post('/:type(reel|profile)', requireLogin, requireChangePasswordCheck, upload.single('file'), async (req, res, next) => {
  try {
    const type = req.params.type;
    let buffer;
    let filename = 'pasted-links.txt';
    let displayName = null;

    if (req.file) {
      buffer = req.file.buffer;
      filename = req.file.originalname;
    } else if (req.body && req.body.links) {
      buffer = Buffer.from(req.body.links, 'utf8');
      // Parsing always treats pasted text as plain .txt; the optional name
      // the person typed is only what History shows for the report.
      const typed = typeof req.body.name === 'string' ? req.body.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      displayName = typed || 'pasted-links.txt';
    } else {
      return res.status(400).json({ error: 'No file or links provided' });
    }

    const parsed = await parseSpreadsheetBuffer(buffer, filename, type);
    const db = getDb();

    const jobId = new ObjectId().toHexString();
    const learnedAvgMs = await getLearnedAvgMs(type);
    // Pinned at creation time, not re-read during processing -- if an admin
    // flips the global toggle while this job is paused/resumed, this report
    // stays internally consistent (all-legacy or all-v2) rather than mixing
    // pipelines within one report.
    const profilePipelineMode = type === 'profile' ? await getProfilePipelineMode() : undefined;
    const reelPipelineMode = type === 'reel' ? await getReelPipelineMode() : undefined;

    const creditsPerItem = costPerItem(type);
    const jobDoc = {
      _id: jobId,
      type,
      // effectiveUsername, not username: a team member's report is stamped
      // and billed to the account owner, not the member's own login. See
      // middleware/auth.js for how that's resolved.
      ownerUsername: req.currentUser.effectiveUsername,
      status: 'preview',
      fileName: displayName || filename,
      originalColumns: parsed.originalColumns,
      rows: parsed.rows,
      avgRowMs: learnedAvgMs,
      counts: parsed.counts,
      cursor: 0,
      profilePipelineMode,
      reelPipelineMode,
      creditsPerItem,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('jobs').insertOne(jobDoc);
    await setActiveJobPointer(req.currentUser.effectiveUsername, type, jobId);

    res.json({
      jobId,
      fileName: displayName || filename,
      columns: parsed.originalColumns,
      totalRows: parsed.counts.total,
      validRows: parsed.counts.valid,
      counts: parsed.counts,
      rowsSample: parsed.rows.slice(0, 100),
      creditsPerItem,
      estimatedCredits: creditsPerItem * parsed.counts.valid,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
