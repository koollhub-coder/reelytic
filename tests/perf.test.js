const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const express = require('express');

const { clientStatic } = require('../server/middleware/clientStatic');
const { CoalescingStore } = require('../server/middleware/coalescingStore');
const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');

/*
  The speed work has to stay correct while it stays fast. These pin the parts where a mistake
  would be silent: static files served the wrong way (or a stale page served forever), sessions
  shared between requests, and an estimated cost overwriting one that was already real.
*/

describe('static client is served fast and correctly', () => {
  let dir;
  let server;
  let base;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-dist-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.mkdirSync(path.join(dir, 'fonts'));
    const js = 'console.log("hello world");'.repeat(200);
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), js);
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js.br'), zlib.brotliCompressSync(js));
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js.gz'), zlib.gzipSync(js));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>shell</html>'.repeat(60));
    fs.writeFileSync(path.join(dir, 'index.html.br'), zlib.brotliCompressSync('<html>shell</html>'.repeat(60)));
    fs.writeFileSync(path.join(dir, 'landing.html'), '<html>landing</html>'.repeat(60));
    fs.writeFileSync(path.join(dir, 'landing.html.br'), zlib.brotliCompressSync('<html>landing</html>'.repeat(60)));
    fs.writeFileSync(path.join(dir, 'fonts', 'f.woff2'), 'fontbytes');
    fs.writeFileSync(path.join(dir, 'logo.png'), 'pngbytes');

    const app = express();
    app.use(clientStatic(dir));
    app.get('/api/thing', (req, res) => res.json({ api: true }));
    app.use((req, res) => res.status(404).json({ error: 'Not found' }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  // raw http so nothing decompresses or hides the headers
  const get = (p, headers = {}) => new Promise((resolve, reject) => {
    http.get(base + p, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

  test('hashed assets: brotli when accepted, cached for a year, immutable', async () => {
    const r = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip, br' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], 'br');
    assert.match(r.headers['cache-control'], /max-age=31536000/);
    assert.match(r.headers['cache-control'], /immutable/);
    assert.equal(r.headers['vary'], 'Accept-Encoding');
    assert.ok(zlib.brotliDecompressSync(r.body).toString().startsWith('console.log'));
  });

  test('falls back to gzip, then to the plain file', async () => {
    const gz = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    const plain = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'identity' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.ok(plain.body.toString().startsWith('console.log'));
  });

  test('a matching ETag answers 304 with no body', async () => {
    const first = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'br' });
    const again = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'br', 'If-None-Match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
  });

  test('the shell is never cached blindly: no-cache on both the app shell and the landing page', async () => {
    for (const p of ['/dashboard', '/login', '/history']) {
      const r = await get(p, { 'Accept-Encoding': 'br' });
      assert.equal(r.status, 200);
      assert.equal(r.headers['cache-control'], 'no-cache');
      assert.match(zlib.brotliDecompressSync(r.body).toString(), /shell/);
    }
    const landing = await get('/', { 'Accept-Encoding': 'br' });
    assert.equal(landing.headers['cache-control'], 'no-cache');
    assert.match(zlib.brotliDecompressSync(landing.body).toString(), /landing/, '"/" must be the prerendered landing page');
  });

  test('images and fonts get long lifetimes; a missing file is a real 404, not the app shell', async () => {
    assert.match((await get('/fonts/f.woff2')).headers['cache-control'], /immutable/);
    assert.match((await get('/logo.png')).headers['cache-control'], /max-age=604800/);
    const missing = await get('/assets/nope.js');
    assert.equal(missing.status, 404);
  });

  test('API paths are left alone and never answered with the shell', async () => {
    const ok = await get('/api/thing');
    assert.equal(JSON.parse(ok.body.toString()).api, true);
    const missing = await get('/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.match(missing.headers['content-type'], /json/);
  });

  test('cannot read outside the build folder', async () => {
    // Only files that were indexed inside the build folder can ever be sent, so a traversal path is
    // just treated as an unknown page: it gets the app shell, never a file from disk.
    const r = await get('/..%2f..%2fetc%2fpasswd', { 'Accept-Encoding': 'identity' });
    assert.ok(!/root:/.test(r.body.toString()), 'a traversal attempt must not return a file from disk');
    const r2 = await get('/../../package.json', { 'Accept-Encoding': 'identity' });
    assert.ok(!/"name"/.test(r2.body.toString()), 'nor the project files');
  });
});

describe('sessions are shared only while a lookup is in flight', () => {
  test('simultaneous requests for one session cost one store read, and each gets its own copy', async () => {
    let reads = 0;
    const inner = {
      get(sid, cb) { reads += 1; setTimeout(() => cb(null, { cookie: {}, username: 'a', nested: { n: 1 } }), 20); },
      set(sid, s, cb) { cb && cb(); }, destroy(sid, cb) { cb && cb(); },
    };
    const store = new CoalescingStore(inner);
    const results = await Promise.all([1, 2, 3].map(() => new Promise((res) => store.get('sid1', (e, s) => res(s)))));
    assert.equal(reads, 1, 'three overlapping reads should share one');
    results[1].nested.n = 99;
    assert.equal(results[2].nested.n, 1, 'one request must never see another request\'s edits');
  });

  test('nothing is remembered afterwards: a later read goes back to the store', async () => {
    let reads = 0;
    const inner = { get(sid, cb) { reads += 1; setImmediate(() => cb(null, { username: 'a' })); }, set() {}, destroy() {} };
    const store = new CoalescingStore(inner);
    await new Promise((res) => store.get('sid', () => res()));
    await new Promise((res) => store.get('sid', () => res()));
    assert.equal(reads, 2, 'a logout or revocation must always be seen by the very next request');
  });
});

describe('a real cost only replaces an estimate', () => {
  before(async () => { await seed(); });
  after(async () => { await teardown(); await closeConnection(); });

  test('settleBatchCost upgrades estimated rows and leaves measured and cached rows alone', async () => {
    const { getDb } = require('../server/db');
    const { settleBatchCost } = require('../server/services/ledger.service');
    const db = getDb();
    const username = usernameFor('pro');
    const jobId = 'rgr_settle_job';
    await db.collection('submittedLinks').insertMany([
      { username, type: 'reel', jobId, url: 'https://x/1', result: 'success', costSource: 'estimated', estimatedCostUsd: 0.001 },
      { username, type: 'reel', jobId, url: 'https://x/2', result: 'success', costSource: 'measured', estimatedCostUsd: 0.005 },
      { username, type: 'reel', jobId, url: 'https://x/3', result: 'success', costSource: 'cached', estimatedCostUsd: 0 },
    ]);
    const changed = await settleBatchCost({ jobId, urls: ['https://x/1', 'https://x/2', 'https://x/3'], perItemUsd: 0.0034 });
    assert.equal(changed, 1);
    const rows = Object.fromEntries((await db.collection('submittedLinks').find({ jobId }).toArray()).map((r) => [r.url, r]));
    assert.equal(rows['https://x/1'].estimatedCostUsd, 0.0034);
    assert.equal(rows['https://x/1'].costSource, 'measured');
    assert.equal(rows['https://x/2'].estimatedCostUsd, 0.005, 'an already measured figure must not be overwritten');
    assert.equal(rows['https://x/3'].costSource, 'cached', 'a cache hit stays a true zero');
    assert.equal(await settleBatchCost({ jobId, urls: ['https://x/1'], perItemUsd: null }), 0, 'no figure, no change');
    await db.collection('submittedLinks').deleteMany({ jobId });
  });
});
