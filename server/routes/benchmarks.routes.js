const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getErBenchmarks } = require('../services/benchmarks.service');

// Aggregate engagement-rate benchmarks. Safe to hand to any signed-in
// account: the service only ever returns band medians over large groups,
// never anything traceable to a creator or another agency (see
// benchmarks.service.js for the rules it enforces).
router.get('/', requireLogin, async (req, res, next) => {
  try {
    res.json({ benchmarks: await getErBenchmarks() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
