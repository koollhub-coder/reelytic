const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, async (req, res) => {
  res.json({
    settings: {
      theme: 'system',
      timezone: 'Asia/Kolkata'
    }
  });
});

module.exports = router;
