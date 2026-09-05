const crypto = require('crypto');

/*
  Same "dormant without a key" contract as mailer.service.js and
  alerting.service.js: no RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET means every
  call here throws a clear, specific error immediately rather than silently
  producing a fake order or a signature check that can never pass.
*/
function isConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function getClient() {
  if (!isConfigured()) {
    throw new Error('Razorpay is not configured on this server yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (see .env.example).');
  }
  // Lazy require: importing the SDK at module load would make every route
  // file that touches billing.routes.js fail to boot in dev/test
  // environments that never install it, for a feature that's optional
  // until real keys exist.
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// amountRupees is a plain rupee number (e.g. 1499); Razorpay orders are
// created in paise, so this is the one place that *100 happens -- every
// caller elsewhere deals in rupees, matching how plans are priced.
async function createOrder({ amountRupees, receipt, notes }) {
  const instance = getClient();
  const order = await instance.orders.create({
    amount: Math.round(amountRupees * 100),
    currency: 'INR',
    receipt,
    notes,
  });
  return order;
}

// Razorpay's own documented verification: HMAC-SHA256 of "order_id|payment_id"
// using the account's key secret, compared against the signature Razorpay's
// checkout handler returns. Anyone can forge an order_id/payment_id pair,
// but only Razorpay (who has the key secret) can produce a signature that
// matches -- that's what actually proves the payment happened, not the mere
// presence of these fields.
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!isConfigured()) return false;
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  // Constant-time compare -- a plain === here would let a timing attack
  // narrow down the correct signature byte by byte.
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(String(signature), 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// Webhook payloads are signed the same HMAC-SHA256 way, but over the raw
// request body with a SEPARATE secret (the webhook secret set in Razorpay's
// dashboard, not the API key secret) -- kept as its own function since it's
// checked against a different env var and a different input shape.
function verifyWebhookSignature({ rawBody, signature }) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(String(signature), 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = {
  isConfigured,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
