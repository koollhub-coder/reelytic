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
            'Email support',
        ],
        popular: false,
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
            'Priority email support',
        ],
        popular: true,
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
            'Priority support + onboarding call',
        ],
        popular: false,
    },
];

router.get('/plans', async (req, res, next) => {
    try {
        const db = getDb();
        const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
        // IMPORTANT: must check length > 0 — an empty array [] is truthy in JS
        // and would bypass the fallback, leaving the pricing page blank.
        const plans = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
        res.json({ plans });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
module.exports.DEFAULT_PLANS = DEFAULT_PLANS;