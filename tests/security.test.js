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

describe('cross-site requests cannot act for a signed-in user', () => {
  const evil = { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' };

  test('the session cookie is SameSite=Lax', async () => {
    const agent = anonymousAgent();
    const res = await agent.post('/auth/login', { username: usernameFor('pro'), password: require('./helpers/seed').PASSWORD });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') || '', /SameSite=Lax/i);
  });

  test('a form-encoded cross-site post to /api/team/invite is refused', async () => {
    const owner = await loginAs('pro');
    const email = `${usernameFor('csrf')}@regression.test`;
    const form = new URLSearchParams({ email });
    const res = await owner.post('/team/invite', form, { headers: evil });
    assert.equal(res.status, 403);
    assert.equal(res.data.code, 'CROSS_SITE');

    // Without the browser's cross-site labels the form body is still not
    // understood: nothing parses form encoding any more.
    const plain = await owner.post('/team/invite', form);
    assert.notEqual(plain.status, 200);

    const invite = await getDb().collection('teamInvites').findOne({ email });
    assert.equal(invite, null, 'no invite may be created by a form post');
  });

  test('the app\'s own same-origin JSON calls still work', async () => {
    const user = await loginAs('pro');
    const res = await user.post('/auth/tour-seen', {}, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(res.status, 200);
  });

  test('the Razorpay webhook is exempt', async () => {
    const res = await anonymousAgent().post('/billing/webhook', { event: 'x' }, { headers: evil });
    assert.notEqual(res.status, 403);
  });
});

describe('security headers and private links', () => {
  const fs = require('fs');
  const path = require('path');
  const { BASE_URL } = require('./helpers/server');
  const raw = (p) => fetch(BASE_URL + p, { redirect: 'manual' });

  test('every page carries a CSP that allows each inline script by hash, not unsafe-inline', async (t) => {
    const indexPath = path.resolve(__dirname, '..', 'client', 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) return t.skip('no client build');
    const { inlineScriptHashes } = require('../server/middleware/security');
    const res = await raw('/login');
    const csp = res.headers.get('content-security-policy') || '';
    const scriptSrc = (csp.split(';').find((d) => d.trim().startsWith('script-src')) || '');
    assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
    const hashes = inlineScriptHashes(path.dirname(indexPath));
    assert.ok(hashes.length > 0);
    for (const h of hashes) assert.ok(scriptSrc.includes(h), `missing ${h}`);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });

  test('share and portal pages and the public API say noindex', async () => {
    for (const p of ['/share/abc123', '/portal/abc123', '/api/public/reports/abc123']) {
      const res = await raw(p);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
    }
    const home = await raw('/pricing');
    assert.equal(home.headers.get('x-robots-tag'), null);
  });
});

describe('robots.txt names the real private paths', () => {
  test('disallows /share/ and /portal/', async () => {
    const { BASE_URL } = require('./helpers/server');
    const text = await (await fetch(`${BASE_URL}/robots.txt`)).text();
    assert.match(text, /^Disallow: \/share\/$/m);
    assert.match(text, /^Disallow: \/portal\/$/m);
  });
});

describe('production refuses a public session secret', () => {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const boot = (secret) => spawnSync(process.execPath, ['-e', "require('./server/config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: secret },
    encoding: 'utf8',
  });

  test('missing or default secrets stop the server from starting', () => {
    for (const secret of ['', 'reelytic_default_secret_key_change_me', 'reelytic_super_secret_key_12345']) {
      const run = boot(secret);
      assert.equal(run.status, 1, `secret "${secret}" must be refused`);
      assert.match(run.stderr, /SESSION_SECRET/);
    }
  });

  test('a real secret starts normally', () => {
    assert.equal(boot('rgr-' + require('crypto').randomBytes(24).toString('hex')).status, 0);
  });
});

describe('sessions', () => {
  const { PASSWORD } = require('./helpers/seed');
  const sid = (agent) => decodeURIComponent((agent.cookie || '').split('=')[1] || '').split('.')[0];

  test('signing in issues a new session id, even over an existing session', async () => {
    const agent = anonymousAgent();
    await agent.post('/auth/login', { username: usernameFor('free'), password: PASSWORD });
    const first = sid(agent);
    assert.ok(first);
    const again = await agent.post('/auth/login', { username: usernameFor('pro'), password: PASSWORD, rememberMe: true });
    assert.equal(again.status, 200);
    assert.notEqual(sid(agent), first, 'the pre-login session id must not carry over');
    assert.match(again.headers.get('set-cookie') || '', /Expires=/i, 'remember me still sets a lasting cookie');
    assert.equal((await agent.get('/auth/me')).data.user.username, usernameFor('pro'));
  });

  test('changing the password signs out other devices and keeps this one', async () => {
    const here = await loginAs('agency');
    const elsewhere = await loginAs('agency');
    const oldId = sid(here);

    const changed = await here.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'rgr-new-password-2' });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.notEqual(sid(here), oldId, 'the current session is re-issued');

    assert.equal((await here.get('/auth/me')).status, 200, 'the device that changed it stays signed in');
    const other = await elsewhere.get('/auth/me');
    assert.equal(other.status, 401);
    assert.equal(other.data.code, 'REVOKED');

    // Put the seeded password back for anything that runs later.
    await here.post('/auth/change-password', { currentPassword: 'rgr-new-password-2', newPassword: PASSWORD });
  });
});

describe('exports cannot smuggle spreadsheet formulas', () => {
  const ExcelJS = require('exceljs');
  const exporter = require('../server/services/export.service');
  const evil = '=HYPERLINK("http://evil.example","click")';
  const job = {
    type: 'reel',
    fileName: '+cmd|calc',
    createdAt: new Date(),
    originalColumns: [{ name: 'Note', renamedTo: '@Note' }, { name: 'Delta', renamedTo: 'Delta' }],
    rows: [{
      state: 'done',
      input: { url: 'https://www.instagram.com/reel/AAA/', original: { Note: evil, Delta: '-5' } },
      result: { username: '-creator', views: 1000, likes: 50, comments: 5, er: 5.5, followers: 2000 },
    }],
  };

  test('CSV: formula-like text is prefixed, numbers and number-only text are not', () => {
    const csv = exporter.generateCsvExport(job);
    assert.ok(csv.includes(`"'${evil.replace(/"/g, '""')}"`), csv);
    assert.ok(csv.includes('"\'@Note"'));
    assert.ok(csv.includes('"\'-creator"'));
    assert.ok(csv.includes('"-5"'), 'a plain negative number stays as it is');
    assert.ok(csv.includes('"1000"'));
  });

  test('XLSX: every exporter writes formula-like text as prefixed text', async () => {
    const books = [
      await exporter.generateExcelExport(job),
      await exporter.generateSharedReportExcel({ job, branding: { agencyName: '=evil()' } }),
      await exporter.generateClientLedgerExcel('rgr_x', [{ at: new Date(), type: 'reel', result: 'success', resolvedUsername: '@who', url: evil, metrics: { views: 10 } }]),
    ];
    for (const buf of books) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
        const v = cell.value;
        if (v && typeof v === 'object' && v.formula) assert.fail(`formula cell ${cell.address}`);
        if (typeof v === 'string') assert.doesNotMatch(v, /^[=+@\t\r]|^-(?!\d)/, `unsafe text in ${cell.address}: ${v}`);
      })));
    }
  });

  test('creator database CSV and admin ledger CSV are covered too', () => {
    const creators = exporter.generateCreatorsCsv([{ name: '=1+1', username: 'x' }]);
    assert.ok(creators.includes('"\'=1+1"'));
    const ledger = exporter.generateClientLedgerCsv('rgr_x', [{ at: new Date(), type: 'reel', result: 'success', resolvedUsername: '+x', url: 'u', metrics: {} }]);
    assert.ok(ledger.includes('"\'+x"'));
  });
});

describe('the old developer unlock is gone', () => {
  test('POST /api/auth/dev-unlock no longer exists, even for an admin', async () => {
    const admin = await loginAs('admin');
    const res = await admin.post('/auth/dev-unlock', { password: 'Devcanonlyaccess' });
    assert.equal(res.status, 404);
  });
});
