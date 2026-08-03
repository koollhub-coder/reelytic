const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getDb, queryId } = require('../db');
const { generateExcelExport, generateCsvExport } = require('../services/export.service');

router.get('/:jobId', requireLogin, async (req, res, next) => {
  try {
    const rawId = req.params.jobId;
    const isCsv = rawId.endsWith('.csv');
    const jobId = rawId.replace(/\.(xlsx|csv)$/, '');

    const db = getDb();
    const job = await db.collection('jobs').findOne({ _id: queryId(jobId) });
    if (!job) return res.status(404).json({ error: 'Report not found' });
    if (job.ownerUsername !== req.currentUser.username && req.currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `reelytic-${job.type}-${dateStr}`;

    if (isCsv) {
      const csv = generateCsvExport(job);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    } else {
      const buffer = await generateExcelExport(job);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
