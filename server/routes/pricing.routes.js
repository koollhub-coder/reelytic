const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const DEFAULT_PLANS = [
    {
        id: 'starter',
        name: 'Starter',
        monthly: 1499,
        credits: 2000,
        blurb: 'For a single account running steady monthly reports.',
        features: [
            '2,000 credits / month',
            '~2,000 reel reports or ~500 profile reports',
            'Mix reels & profiles freely',
            'Full report history',
            'Creator database & search',
            'Email support',
            'Up to 2 team seats',
            'Persistent client portal',
        ],
        popular: false,
        // maxTeamSeats counts the account owner PLUS invited members (a
        // seat cap of 2 means the owner and one teammate) -- see
        // team.routes.js POST /invite, the only place this is read.
        maxTeamSeats: 2,
        featureFlags: { reportBranding: false, shareableLinks: false, creatorDatabase: true, teamSeats: true, clientPortal: true },
    },
    {
        id: 'pro',
        name: 'Pro',
        monthly: 3499,
        credits: 5000,
        blurb: 'For agencies running multiple clients at once.',
        features: [
            '5,000 credits / month',
            '~5,000 reel reports or ~1,250 profile reports',
            'Mix reels & profiles freely',
            'Full report history',
            'Creator database & search',
            'Priority email support',
            'Custom-branded client reports',
            'Shareable report links',
            'Up to 5 team seats',
            'Persistent client portal',
        ],
        popular: true,
        maxTeamSeats: 5,
        featureFlags: { reportBranding: true, shareableLinks: true, creatorDatabase: true, teamSeats: true, clientPortal: true },
    },
    {
        id: 'agency',
        name: 'Agency',
        monthly: 6999,
        credits: 10000,
        blurb: 'For high-volume shops running large campaigns.',
        features: [
            '10,000 credits / month',
            '~10,000 reel reports or ~2,500 profile reports',
            'Mix reels & profiles freely',
            'Full report history',
            'Creator database & search',
            'Priority support + onboarding call',
            'Custom-branded client reports',
            'Shareable report links',
            'Up to 15 team seats',
            'Persistent client portal',
        ],
        popular: false,
        maxTeamSeats: 15,
        featureFlags: { reportBranding: true, shareableLinks: true, creatorDatabase: true, teamSeats: true, clientPortal: true },
    },
];

router.get('/plans', async (req, res, next) => {
    try {
        const db = getDb();
        const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
        // IMPORTANT: must check length > 0, an empty array [] is truthy in JS
        // and would bypass the fallback, leaving the pricing page blank.
        const plans = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
        // Public and the same for everyone: the browser may reuse it for a few seconds instead of asking
        // on every page. Short on purpose, so an admin's price change still shows almost at once.
        res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=120');
        res.json({ plans });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
module.exports.DEFAULT_PLANS = DEFAULT_PLANS;