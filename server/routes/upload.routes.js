const express = require('express');
const router = express.Router();
const multer = require('multer');
const { ObjectId } = require('mongodb');
const { requireLogin, requireChangePasswordCheck } = require('../middleware/auth');
const { parseSpreadsheetBuffer } = require('../services/parse.service');
const { getDb } = require('../db');
const { getLearnedAvgMs } = require('../services/learnedTiming.service');

const upload = multer({
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

router.post('/:type(reel|profile)', requireLogin, requireChangePasswordCheck, upload.single('file'), async (req, res, next) => {
  try {
    const type = req.params.type;
    let buffer;
    let filename = 'pasted-links.txt';

    if (req.file) {
      buffer = req.file.buffer;
      filename = req.file.originalname;
    } else if (req.body && req.body.links) {
      buffer = Buffer.from(req.body.links, 'utf8');
      filename = 'pasted-links.txt';
    } else {
      return res.status(400).json({ error: 'No file or links provided' });
    }

    const parsed = await parseSpreadsheetBuffer(buffer, filename, type);
    const db = getDb();

    const jobId = new ObjectId().toHexString();
    const learnedAvgMs = await getLearnedAvgMs(type);

    const jobDoc = {
      _id: jobId,
      type,
      ownerUsername: req.currentUser.username,
      status: 'preview',
      fileName: filename,
      originalColumns: parsed.originalColumns,
      rows: parsed.rows,
      avgRowMs: learnedAvgMs,
      counts: parsed.counts,
      cursor: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('jobs').insertOne(jobDoc);

    res.json({
      jobId,
      fileName: filename,
      columns: parsed.originalColumns,
      totalRows: parsed.counts.total,
      validRows: parsed.counts.valid,
      counts: parsed.counts,
      rowsSample: parsed.rows.slice(0, 100)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
