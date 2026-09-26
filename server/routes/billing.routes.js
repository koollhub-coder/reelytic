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
  What an order costs, decided here and nowhere else. The browser used to send
  its own `amount` and that number went straight to Razorpay, so an edited
  request could buy any plan for one rupee. The client still shows a price,
  but it is only display: this is what gets charged.

  Mirrors the pricing pages' current maths exactly (Pricing.jsx and
  BillingPlans.jsx, ANNUAL_DISCOUNT = 0.9), so nobody's checkout total moves.
*/
const ANNUAL_DISCOUNT = 0.9;
const BILLING_PERIODS = new Set(['monthly', 'annual']);

function priceRupees(plan, billing) {
    const monthly = Number(plan.monthly);
    if (!Number.isFinite(monthly) || monthly <= 0) return null;
    return billing === 'annual' ? Math.round(monthly * ANNUAL_DISCOUNT) : monthly;
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
async function fulfillOrder(razorpayOrderId, { checkCapture = false, capturedAmount, capturedCurrency } = {}) {
    const db = getDb();
    const filter = { razorpayOrderId, status: 'created' };
    // The webhook knows what was actually captured. Anything other than the
    // amount this order was created for (in paise), including no amount at
    // all, grants nothing.
    const captureOk = !checkCapture || (
        Number.isFinite(Number(capturedAmount)) && (!capturedCurrency || capturedCurrency === 'INR')
    );
    if (checkCapture) filter.amount = captureOk ? Number(capturedAmount) : -1;
    const order = await db.collection('billingOrders').findOneAndUpdate(
        filter,
        { $set: { status: 'paid', paidAt: new Date() } }
    );
    if (!order) {
        if (checkCapture) {
            const pending = await db.collection('billingOrders').findOne({ razorpayOrderId, status: 'created' });
            if (pending) {
                await db.collection('billingOrders').updateOne(
                    { _id: pending._id, status: 'created' },
                    { $set: { status: 'amount_mismatch', capturedAmount: Number(capturedAmount), capturedCurrency: capturedCurrency || null, flaggedAt: new Date() } }
                );
                console.error(`[Billing] Order ${razorpayOrderId} captured ${capturedAmount} ${capturedCurrency || ''} but expected ${pending.amount}. Credits not granted.`);
            }
        }
        return null; // already fulfilled, no such order, or the amount was wrong
    }

    const plan = await resolvePlan(order.planId);
    if (!plan) return null;

    const newBalance = await adjustCredits(order.username, plan.credits);
    await db.collection('users').updateOne({ username: order.username }, { $set: { plan: plan.id } });
    return { username: order.username, plan, credits: newBalance };
}

// Team members share the owner's plan and credits (see middleware/auth.js)
// but never manage billing themselves -- a member changing the whole
// account's plan or payment method is not a decision they should be able to
// make alone. Checked before anything else in both routes below.
function requireAccountOwner(req, res) {
    if (req.currentUser.username !== req.currentUser.effectiveUsername) {
        res.status(403).json({ error: 'Only the account owner can manage billing. Ask them to change the plan.' });
        return false;
    }
    return true;
}

router.post('/create-order', requireLogin, async (req, res, next) => {
    try {
        if (!requireAccountOwner(req, res)) return;
        // Any `amount` in the body is ignored on purpose; see priceRupees.
        const { planId } = req.body || {};
        const billing = (req.body && req.body.billing) || 'monthly';
        if (!planId) {
            return res.status(400).json({ error: 'Choose a plan first.' });
        }
        if (!BILLING_PERIODS.has(billing)) {
            return res.status(400).json({ error: 'Choose monthly or annual billing.' });
        }
        const plan = await resolvePlan(planId);
        if (!plan) return res.status(400).json({ error: 'Unknown plan.' });
        const amountRupees = priceRupees(plan, billing);
        if (!amountRupees) return res.status(400).json({ error: 'This plan cannot be bought online. Contact us to activate it.' });
        const expectedPaise = Math.round(amountRupees * 100);

        if (!razorpay.isConfigured()) {
            // DUMMY MODE -- no real Razorpay credentials configured yet.
            // Checkout.jsx recognizes this keyId shape and routes to the
            // "contact us to activate" flow instead of opening a payment form.
            return res.json({
                id: `order_dummy_${Date.now()}`,
                amount: expectedPaise,
                currency: 'INR',
                keyId: 'rzp_test_YOUR_KEY_ID',
                planId,
                billing,
            });
        }

        const username = req.currentUser.username;
        const order = await razorpay.createOrder({
            amountRupees,
            receipt: `plan_${planId}_${username}_${Date.now()}`.slice(0, 40), // Razorpay caps receipt at 40 chars
            notes: { username, planId, billing },
        });
        if (Number(order.amount) !== expectedPaise) {
            throw new Error(`Razorpay order ${order.id} came back for ${order.amount} paise, expected ${expectedPaise}`);
        }

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
            billing,
            // Paise. Computed here from the plan, and equal to what Razorpay
            // recorded (checked above). The webhook grants credits only when
            // the captured amount matches this.
            amount: expectedPaise,
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
        if (!requireAccountOwner(req, res)) return;
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
        const payment = (event.payload && event.payload.payment && event.payload.payment.entity) || {};
        const orderId = payment.order_id;
        if (orderId) {
            try {
                await fulfillOrder(orderId, { checkCapture: true, capturedAmount: payment.amount, capturedCurrency: payment.currency });
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
