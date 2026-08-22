const express = require('express');
const router = express.Router();
const { getLegalDoc, TYPES } = require('../services/legal.service');

// Public and unauthenticated -- the Terms/Privacy pages, and the checkbox
// copy on Signup, need to read this before anyone has a session.
router.get('/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!TYPES.includes(type)) {
      return res.status(404).json({ error: 'Not found.' });
    }
    const doc = await getLegalDoc(type);
    res.json({ type, ...doc });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
