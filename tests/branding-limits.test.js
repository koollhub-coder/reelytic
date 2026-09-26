const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { seed, teardown, closeConnection } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs } = require('./helpers/client');

/*
  Settings told people "PNG, JPG or SVG, max 2MB" while the server took WEBP
  too and refused anything over 1MB, so a 1.5MB logo passed the page and
  failed on save. The page now reads the limits from the server, and this
  pins that the limits it is sent are the ones the save enforces.
*/

let pro;
let limits;

const dataUri = (mime, bytes) => `data:${mime};base64,${Buffer.alloc(bytes, 1).toString('base64')}`;

before(async () => {
  await seed();
  await startServer();
  pro = await loginAs('pro');
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('logo upload limits come from one place', () => {
  test('the branding endpoint sends the logo limits', async () => {
    const res = await pro.get('/settings/report-branding');
    assert.equal(res.status, 200);
    limits = res.data.logoLimits;
    assert.ok(limits, 'logoLimits must be sent');
    assert.equal(limits.maxBytes, 1024 * 1024);
    assert.ok(limits.types.includes('image/webp'));
    assert.equal(limits.types.length, limits.typeNames.length);
  });

  test('a file just under the sent limit saves', async () => {
    const res = await pro.patch('/settings/report-branding', { logoDataUri: dataUri('image/webp', limits.maxBytes - 1024) });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  });

  test('a file over the sent limit is refused with the same number', async () => {
    const res = await pro.patch('/settings/report-branding', { logoDataUri: dataUri('image/png', limits.maxBytes + 64 * 1024) });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /1MB/);
  });

  test('a type outside the sent list is refused', async () => {
    const res = await pro.patch('/settings/report-branding', { logoDataUri: dataUri('image/gif', 100) });
    assert.equal(res.status, 400);
    assert.ok(!limits.types.includes('image/gif'));
  });

  test('the Settings page no longer hardcodes its own limit', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'pages', 'Settings.jsx'), 'utf8');
    assert.ok(!/Max 2MB/.test(src), 'stale 2MB hint is back');
    assert.ok(!/MAX_LOGO_BYTES\s*=/.test(src), 'Settings must read the limit from the server, not define its own');
  });
});
