const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const crypto = require('crypto');
const { anonymousAgent, loginAs } = require('./helpers/client');
const { getDb } = require('../server/db');

// The server process inherits this, so the webhook route is live and its
// signatures can be produced here. Never a real secret.
const WEBHOOK_SECRET = 'rgr_webhook_secret_for_tests';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

/*
  Holes that were open in production code and are now closed. Each test here
  was run against the old code first and failed; if one starts passing for
  the wrong reason, check it still fails with the fix reverted.
*/

before(async () => {
  await seed();
  await getDb().collection('billingOrders').deleteMany({ razorpayOrderId: { $regex: '^rgr_' } });
  await startServer();
});

after(async () => {
  await getDb().collection('billingOrders').deleteMany({ razorpayOrderId: { $regex: '^rgr_' } });
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('Google sign-in never trusts a posted email', () => {
  test('an email with no Google token does not sign anyone in, not even the admin', async () => {
    const agent = anonymousAgent();
    const adminEmail = `${usernameFor('admin')}@regression.test`;
    const res = await agent.post('/auth/google', { email: adminEmail, name: 'Anyone' });
    assert.equal(res.status, 401, JSON.stringify(res.data));
    assert.equal(res.data.user, undefined);

    const me = await agent.get('/auth/me');
    assert.equal(me.status, 401, 'no session may exist after a rejected Google sign-in');
  });

  test('a made-up token is refused with a plain message', async () => {
    const res = await anonymousAgent().post('/auth/google', { credential: 'not-a-real-token' });
    assert.equal(res.status, 401);
    assert.doesNotMatch(JSON.stringify(res.data), /library|google-auth/i);
  });

  test('no account is created for the posted address', async () => {
    const email = `${usernameFor('ghost')}@regression.test`;
    await anonymousAgent().post('/auth/google', { email });
    const row = await getDb().collection('users').findOne({ email });
    assert.equal(row, null);
  });
});

describe('the server decides what a plan costs', () => {
  test('an amount sent by the browser is ignored', async () => {
    const owner = await loginAs('starter');
    const monthly = await owner.post('/billing/create-order', { planId: 'pro', amount: 1, billing: 'monthly' });
    assert.equal(monthly.status, 200, JSON.stringify(monthly.data));
    assert.equal(monthly.data.amount, 3499 * 100, 'Pro monthly must cost the plan price, whatever was posted');

    const annual = await owner.post('/billing/create-order', { planId: 'pro', amount: 1, billing: 'annual' });
    assert.equal(annual.data.amount, Math.round(3499 * 0.9) * 100);

    const noAmount = await owner.post('/billing/create-order', { planId: 'starter' });
    assert.equal(noAmount.status, 200);
    assert.equal(noAmount.data.amount, 1499 * 100);
  });

  test('an unknown billing period is refused', async () => {
    const owner = await loginAs('starter');
    const res = await owner.post('/billing/create-order', { planId: 'pro', billing: 'lifetime' });
    assert.equal(res.status, 400);
  });

  async function webhook(orderId, amount) {
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: orderId, amount, currency: 'INR' } } },
    });
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    return anonymousAgent().post('/billing/webhook', body, {
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
    });
  }

  test('a captured payment smaller than the order grants nothing', async () => {
    const db = getDb();
    const username = usernameFor('free');
    const before = (await db.collection('users').findOne({ username })).credits;
    await db.collection('billingOrders').insertOne({
      razorpayOrderId: 'rgr_order_short', username, planId: 'starter', billing: 'monthly',
      amount: 149900, status: 'created', createdAt: new Date(),
    });

    const res = await webhook('rgr_order_short', 100);
    assert.equal(res.status, 200);
    const order = await db.collection('billingOrders').findOne({ razorpayOrderId: 'rgr_order_short' });
    assert.notEqual(order.status, 'paid');
    assert.equal((await db.collection('users').findOne({ username })).credits, before);
  });

  test('the full amount still grants the plan', async () => {
    const db = getDb();
    const username = usernameFor('free');
    const before = (await db.collection('users').findOne({ username })).credits;
    await db.collection('billingOrders').insertOne({
      razorpayOrderId: 'rgr_order_full', username, planId: 'starter', billing: 'monthly',
      amount: 149900, status: 'created', createdAt: new Date(),
    });

    await webhook('rgr_order_full', 149900);
    const order = await db.collection('billingOrders').findOne({ razorpayOrderId: 'rgr_order_full' });
    assert.equal(order.status, 'paid');
    assert.equal((await db.collection('users').findOne({ username })).credits, before + 2000);
  });
});
