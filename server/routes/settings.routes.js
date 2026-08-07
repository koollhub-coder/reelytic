const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getReportBranding, setReportBranding } = require('../services/branding.service');
const { hasFeature } = require('../services/features.service');

router.get('/', requireLogin, async (req, res) => {
  res.json({
    settings: {
      theme: 'system',
      timezone: 'Asia/Kolkata'
    }
  });
});

router.get('/report-branding', requireLogin, async (req, res, next) => {
  try {
    const branding = await getReportBranding(req.currentUser.username);
    res.json({ branding: branding || { logoDataUri: null, accentColor: null, agencyName: null, logoPosition: 'left', showAgencyName: true, showHighlights: true } });
  } catch (err) {
    next(err);
  }
});

router.patch('/report-branding', requireLogin, async (req, res, next) => {
  try {
    // Read access to already-saved branding is never gated (see GET above)
    // -- an existing report shouldn't lose its logo because the account
    // later moved to a plan without this feature. Only creating/editing it
    // requires the feature.
    if (!(await hasFeature(req.currentUser, 'reportBranding'))) {
      return res.status(403).json({ error: 'Report branding isn\'t available on your current plan. Upgrade to customize your reports.', code: 'FEATURE_LOCKED' });
    }
    const { logoDataUri, accentColor, agencyName, logoPosition, showAgencyName, showHighlights } = req.body || {};
    const branding = await setReportBranding(req.currentUser.username, { logoDataUri, accentColor, agencyName, logoPosition, showAgencyName, showHighlights });
    res.json({ success: true, branding });
  } catch (err) {
    // setReportBranding only ever throws a plain Error with a client-safe
    // validation message (bad color format, bad logo type/size) -- always
    // safe to surface directly as a 400.
    res.status(400).json({ error: err.message || 'Could not save branding' });
  }
});

module.exports = router;
