const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getDb } = require('../db');
const { adjustCredits } = require('../services/credits.service');
const { DEFAULT_PLANS } = require('./pricing.routes');

async function resolvePlan(planId) {
    const db = getDb();
    const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
    const plans = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
    return plans.find(p => p.id === planId) || null;
}

// Once real Razorpay keys exist, replace the body of this route with:
//
//   const Razorpay = require('razorpay');
//   const instance = new Razorpay({
//     key_id: process.env.RAZORPAY_KEY_ID,
//     key_secret: process.env.RAZORPAY_KEY_SECRET,
//   });
//   const order = await instance.orders.create({
//     amount: Math.round(amount * 100), // paise
//     currency: 'INR',
//     receipt: `plan_${planId}_${Date.now()}`,
//   });
//   return res.json({ id: order.id, amount: order.amount, keyId: process.env.RAZORPAY_KEY_ID });
//
// The frontend checkout flow (client/src/pages/Checkout.jsx) already expects
// exactly this response shape, so no client changes are needed when you flip this on.

router.post('/create-order', requireLogin, async (req, res) => {
    const { planId, amount, billing } = req.body || {};
    if (!planId || !amount) {
        return res.status(400).json({ error: 'planId and amount are required' });
    }

    // DUMMY MODE -- no real Razorpay credentials configured yet.
    const mockOrder = {
        id: `order_dummy_${Date.now()}`,
        amount: Math.round(amount * 100),
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_ID',
        planId,
        billing,
    };

    res.json(mockOrder);
});

// Grant the plan's credits after a successful payment. In dummy mode the
// frontend calls this straight after the simulated checkout. Once real
// Razorpay is wired, call this only after verifying the payment signature.
router.post('/confirm', requireLogin, async (req, res, next) => {
    try {
        const { planId } = req.body || {};
        const plan = await resolvePlan(planId);
        if (!plan) return res.status(400).json({ error: 'Unknown plan.' });

        const username = req.currentUser.username;
        const newBalance = await adjustCredits(username, plan.credits);
        const db = getDb();
        await db.collection('users').updateOne({ username }, { $set: { plan: plan.id } });

        res.json({ success: true, creditsAdded: plan.credits, credits: newBalance, plan: plan.id });
    } catch (err) {
        next(err);
    }
});

module.exports = router;