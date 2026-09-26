/*
  node scripts/perf/bench-api.js <label>

  Times every API endpoint a person's day actually touches, against a realistic
  amount of data (60 reports of 200 rows, 800 creators, 3,000 ledger rows), on the
  real server process, one endpoint at a time, N=15 sequential requests each after
  two warm-ups. Writes perf-results/<label>-api.json.
*/
const { median, pct, saveResult, seedBulk, cleanupBulk } = require('./lib');
const { seed, teardown, closeConnection } = require('../../tests/helpers/seed');
const { startServer, stopServer, BASE_URL } = require('../../tests/helpers/server');
const { loginAs, anonymousAgent } = require('../../tests/helpers/client');

const http = require('http');
const label = process.argv[2] || 'run';

// Bytes actually sent over the wire for one request, asking for compression the way a browser does.
function wireBytes(agent, endpoint) {
  return new Promise((resolve) => {
    const req = http.request(BASE_URL + '/api' + endpoint, { headers: { 'Accept-Encoding': 'gzip, br', ...(agent && agent.cookie ? { Cookie: agent.cookie } : {}) } }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ bytes: n, encoding: res.headers['content-encoding'] || 'none' }));
    });
    req.on('error', () => resolve({ bytes: null, encoding: 'error' }));
    req.end();
  });
}
const N = Number(process.env.BENCH_N || 15);

(async () => {
  await seed();
  const ctx = await seedBulk();
  await startServer();
  const pro = await loginAs('pro');
  const admin = await loginAs('admin');
  const anon = anonymousAgent ? anonymousAgent() : null;

  const first = await pro.get('/jobs?limit=1');
  const jobId = first.data.jobs[0].id;

  const cases = [
    ['GET /auth/me', pro, '/auth/me'],
    ['GET /me/stats?days=14 (dashboard)', pro, '/me/stats?days=14'],
    ['GET /jobs (history, 100 reports)', pro, '/jobs'],
    ['GET /jobs?limit=10', pro, '/jobs?limit=10'],
    ['GET /jobs/:id (open a report)', pro, `/jobs/${jobId}`],
    ['GET /jobs/:id/rows (results page)', pro, `/jobs/${jobId}/rows?page=1&limit=25&state=all`],
    ['GET /campaigns', pro, '/campaigns'],
    ['GET /creators?limit=50', pro, '/creators?limit=50'],
    ['GET /creators/summary', pro, '/creators/summary'],
    ['GET /settings/report-branding', pro, '/settings/report-branding'],
    ['GET /pricing/plans (public)', anon || pro, '/pricing/plans'],
    ['GET /help/facts (public)', anon || pro, '/help/facts'],
    ['GET /public/campaigns/:token (client portal)', anon || pro, `/public/campaigns/${ctx.portalToken}`],
    ['GET /admin/clients', admin, '/admin/clients'],
    ['GET /admin/ledger?limit=1000', admin, '/admin/ledger?page=1&limit=1000'],
    ['GET /admin/sessions?limit=1000', admin, '/admin/sessions?page=1&limit=1000'],
    ['GET /admin/platform-credits', admin, '/admin/platform-credits'],
  ];

  const out = { label, at: new Date().toISOString(), n: N, endpoints: {}, scenarios: {} };
  for (const [name, agent, url] of cases) {
    for (let i = 0; i < 2; i += 1) await agent.get(url);
    const times = [];
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < N; i += 1) {
      const t0 = performance.now();
      const res = await agent.get(url);
      times.push(performance.now() - t0);
      status = res.status;
      bytes = JSON.stringify(res.data).length;
    }
    const wire = await wireBytes(agent, url);
    out.endpoints[name] = { status, bytes, wireBytes: wire.bytes, encoding: wire.encoding, median: Math.round(median(times)), p95: Math.round(pct(times, 0.95)), min: Math.round(Math.min(...times)) };
    console.log(`${name.padEnd(48)} ${String(status).padEnd(4)} median ${String(out.endpoints[name].median).padStart(5)} ms   p95 ${String(out.endpoints[name].p95).padStart(5)} ms   ${(bytes / 1024).toFixed(1)} KB`);
  }

  // What a person waits for when they open a page: every call it makes at once.
  const scenarios = {
    'Open Dashboard (me + stats + jobs, parallel)': () => Promise.all([pro.get('/auth/me'), pro.get('/me/stats?days=14'), pro.get('/jobs?limit=10')]),
    'Open History (me + jobs + campaigns, parallel)': () => Promise.all([pro.get('/auth/me'), pro.get('/jobs'), pro.get('/campaigns')]),
    'Open Creators (me + list + summary + campaigns, parallel)': () => Promise.all([pro.get('/auth/me'), pro.get('/creators?limit=50'), pro.get('/creators/summary'), pro.get('/campaigns')]),
  };
  for (const [name, fn] of Object.entries(scenarios)) {
    await fn();
    const times = [];
    for (let i = 0; i < N; i += 1) {
      const t0 = performance.now();
      await fn();
      times.push(performance.now() - t0);
    }
    out.scenarios[name] = { median: Math.round(median(times)), p95: Math.round(pct(times, 0.95)) };
    console.log(`${name.padEnd(58)} median ${String(out.scenarios[name].median).padStart(5)} ms   p95 ${String(out.scenarios[name].p95).padStart(5)} ms`);
  }

  // Sixteen people at once hitting the two heaviest calls.
  const burst = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 16 }, (_, k) => (k % 2 ? pro.get('/jobs') : pro.get('/me/stats?days=14'))));
    burst.push(performance.now() - t0);
  }
  out.scenarios['16 simultaneous dashboard+history calls'] = { median: Math.round(median(burst)), p95: Math.round(Math.max(...burst)) };
  console.log(`16 simultaneous dashboard+history calls: median ${out.scenarios['16 simultaneous dashboard+history calls'].median} ms`);

  // The job engine itself, with the scraper stubbed to answer instantly, so what is left is the
  // engine's own bookkeeping (database round trips per link).
  {
    const { getDb } = require('../../server/db');
    const { usernameFor } = require('../../tests/helpers/seed');
    const times = [];
    for (let run = 0; run < 3; run += 1) {
      const id = `perf_engine_${run}`;
      const rows = Array.from({ length: 60 }, (_, i) => ({ i, input: { url: `https://www.instagram.com/reel/OK${run}x${i}/` }, state: 'pending', result: null }));
      await getDb().collection('jobs').insertOne({ _id: id, ownerUsername: usernameFor('pro'), type: 'reel', status: 'preview', fileName: 'engine.txt', cursor: 0, counts: { total: 60, success: 0, failed: 0, invalid: 0, creditsSpent: 0 }, rows, createdAt: new Date(), perfBulk: true });
      const t0 = performance.now();
      await pro.post(`/jobs/${id}/start`, {});
      for (;;) {
        const j = await getDb().collection('jobs').findOne({ _id: id }, { projection: { status: 1 } });
        if (j && j.status === 'done') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      times.push(performance.now() - t0);
    }
    out.scenarios['Run a 60-link report (scraper stubbed, engine bookkeeping only)'] = { median: Math.round(median(times)), p95: Math.round(Math.max(...times)) };
    console.log(`Run a 60-link report, engine only: median ${Math.round(median(times))} ms`);
  }

  console.log('\nSaved', saveResult(label, 'api', out));
  await stopServer();
  await cleanupBulk();
  await teardown();
  await closeConnection();
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  try { await stopServer(); await cleanupBulk(); await teardown(); await closeConnection(); } catch (e) { /* best effort */ }
  process.exit(1);
});
