const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getDb } = require('../db');
const { adjustCredits } = require('../services/credits.service');
const { DEFAULT_PLANS } = require('./pricing.routes');
const razorpay = require('../services/razorpay.service');

async function resolvePlan(planId) {
    const db = getDb();
    const doc = await db.collection('settings').findOne({ key: 'pricingPlans' });
    const plans = (doc && doc.value && doc.value.length > 0) ? doc.value : DEFAULT_PLANS;
    return plans.find(p => p.id === planId) || null;
}

/*
  Grants a plan's credits for one order, exactly once. Shared by both the
  client-side checkout handler (verify-payment, below) and the webhook --
  whichever of the two fires first wins, the other is a no-op. Idempotency
  comes from billingOrders' unique index on razorpayOrderId (see db.js):
  the findOneAndUpdate only flips status created -> paid if it is still
  created, so a retried call (or the webhook arriving after the client
  already fulfilled the same order) touches nothing a second time.
*/
async function fulfillOrder(razorpayOrderId) {
    const db = getDb();
    const order = await db.collection('billingOrders').findOneAndUpdate(
        { razorpayOrderId, status: 'created' },
        { $set: { status: 'paid', paidAt: new Date() } }
    );
    if (!order) return null; // already fulfilled, or no such order

    const plan = await resolvePlan(order.planId);
    if (!plan) return null;

    const newBalance = await adjustCredits(order.username, plan.credits);
    await db.collection('users').updateOne({ username: order.username }, { $set: { plan: plan.id } });
    return { username: order.username, plan, credits: newBalance };
}

router.post('/create-order', requireLogin, async (req, res, next) => {
    try {
        const { planId, amount, billing } = req.body || {};
        if (!planId || !amount) {
            return res.status(400).json({ error: 'planId and amount are required' });
        }
        const plan = await resolvePlan(planId);
        if (!plan) return res.status(400).json({ error: 'Unknown plan.' });

        if (!razorpay.isConfigured()) {
            // DUMMY MODE -- no real Razorpay credentials configured yet.
            // Checkout.jsx recognizes this keyId shape and routes to the
            // "contact us to activate" flow instead of opening a payment form.
            return res.json({
                id: `order_dummy_${Date.now()}`,
                amount: Math.round(amount * 100),
                currency: 'INR',
                keyId: 'rzp_test_YOUR_KEY_ID',
                planId,
                billing,
            });
        }

        const username = req.currentUser.username;
        const order = await razorpay.createOrder({
            amountRupees: amount,
            receipt: `plan_${planId}_${username}_${Date.now()}`.slice(0, 40), // Razorpay caps receipt at 40 chars
            notes: { username, planId, billing: billing || '' },
        });

        // planId is locked in HERE, tied to the order Razorpay actually
        // created for THIS amount -- verify-payment below looks the plan up
        // by order id rather than trusting whatever planId a later request
        // claims, so paying for Starter can never be replayed as "grant me
        // Agency's credits."
        const db = getDb();
        await db.collection('billingOrders').insertOne({
            razorpayOrderId: order.id,
            username,
            planId,
            billing: billing || null,
            amount: order.amount, // paise, as Razorpay itself recorded it
            status: 'created',
            createdAt: new Date(),
        });

        res.json({ id: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, planId, billing });
    } catch (err) {
        next(err);
    }
});

/*
  Called by the client right after Razorpay's own checkout handler fires
  with a successful payment. Grants credits ONLY if the HMAC signature
  Razorpay returned actually verifies against this account's key secret --
  that's the one thing a client can't forge, since producing it requires
  the secret, which never reaches the browser. See fulfillOrder() above for
  why this is safe to call more than once (retries, or racing the webhook).
*/
router.post('/verify-payment', requireLogin, async (req, res, next) => {
    try {
        if (!razorpay.isConfigured()) {
            return res.status(503).json({ error: 'Online payments are not enabled yet. Contact us to activate a plan.' });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
        const ok = razorpay.verifyPaymentSignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });
        if (!ok) return res.status(400).json({ error: 'Payment could not be verified.' });

        const db = getDb();
        const order = await db.collection('billingOrders').findOne({ razorpayOrderId: razorpay_order_id });
        if (!order) return res.status(404).json({ error: 'Unknown order.' });
        // Only the account that created the order can fulfil it -- a valid
        // signature proves the payment happened, not that the caller is who
        // placed it, so this is still checked separately.
        if (order.username !== req.currentUser.username) {
            return res.status(403).json({ error: 'This order does not belong to your account.' });
        }

        const result = await fulfillOrder(razorpay_order_id);
        if (!result) {
            // Already fulfilled (by an earlier call, or the webhook winning
            // the race) -- not an error, the account already has its credits.
            const db2 = getDb();
            const freshOrder = await db2.collection('billingOrders').findOne({ razorpayOrderId: razorpay_order_id });
            const plan = freshOrder ? await resolvePlan(freshOrder.planId) : null;
            return res.json({ success: true, alreadyFulfilled: true, plan: plan ? plan.id : null });
        }

        res.json({ success: true, creditsAdded: result.plan.credits, credits: result.credits, plan: result.plan.id });
    } catch (err) {
        next(err);
    }
});

/*
  Reliability net, not the primary path: if the browser tab closes (or the
  network drops) between Razorpay's handler firing and verify-payment
  landing, the account would otherwise stay unpaid despite a successful
  charge. Razorpay calls this URL server-to-server once a payment actually
  captures, independent of what the client does. Configure the webhook URL
  (this route) and a webhook secret in the Razorpay dashboard; without
  RAZORPAY_WEBHOOK_SECRET set, this route 503s rather than trusting an
  unverifiable POST from the open internet.
*/
router.post('/webhook', async (req, res) => {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        return res.status(503).json({ error: 'Webhook not configured.' });
    }
    const signature = req.headers['x-razorpay-signature'];
    const ok = razorpay.verifyWebhookSignature({ rawBody: req.rawBody, signature });
    if (!ok) return res.status(400).json({ error: 'Invalid signature.' });

    const event = req.body || {};
    if (event.event === 'payment.captured') {
        const orderId = event.payload && event.payload.payment && event.payload.payment.entity
            && event.payload.payment.entity.order_id;
        if (orderId) {
            try {
                await fulfillOrder(orderId);
            } catch (err) {
                console.warn('[Razorpay Webhook] fulfillOrder failed', err.message);
            }
        }
    }

    // Razorpay only cares about the response status -- 200 acknowledges
    // receipt so it stops retrying this event.
    res.json({ received: true });
});

module.exports = router;
