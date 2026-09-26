/*
  node scripts/perf/bench-pages.js <label>

  Loads the PRODUCTION build (client/dist, served by the real server) in a real
  Chromium under simulated networks, cold cache and warm cache, and records what
  a person feels: time to first byte, first paint, largest paint, and the moment
  the page's own content is actually on screen (splash gone), plus how many
  bytes and requests it took. Writes perf-results/<label>-pages.json.

  Build first:  npm run build  (or cd client && npx vite build)
*/
const { median, saveResult } = require('./lib');
const { seed, teardown, closeConnection } = require('../../tests/helpers/seed');
const { seedBulk, cleanupBulk } = require('./lib');
const { startServer, stopServer, BASE_URL } = require('../../tests/helpers/server');
const { loginAs } = require('../../tests/helpers/client');
const { chromium } = require('@playwright/test');

const label = process.argv[2] || 'run';
const RUNS = Number(process.env.BENCH_RUNS || 3);

const NETWORKS = [
  { name: 'Wi-Fi / fast', down: -1, up: -1, latency: 0, cpu: 1 },
  { name: '4G (9 Mbps, 60 ms)', down: (9 * 1024 * 1024) / 8, up: (1.5 * 1024 * 1024) / 8, latency: 60, cpu: 4 },
  { name: 'Slow 4G (1.6 Mbps, 150 ms)', down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, latency: 150, cpu: 4 },
];

const PAGES = [
  { name: 'Landing (signed out)', path: '/', ready: '.hero-title', auth: false },
  { name: 'Login', path: '/login', ready: '#username', auth: false },
  { name: 'Pricing', path: '/pricing', ready: 'h1', auth: false },
  { name: 'Dashboard (signed in)', path: '/dashboard', ready: '.rl-metric-grid', auth: true },
  { name: 'History (signed in)', path: '/history', ready: '.rl-tabs', auth: true },
  { name: 'Reel Report upload (signed in)', path: '/reels', ready: '.rl-onboarding-title', auth: true },
];

const INIT = (readySel) => `
  (() => {
    window.__perf = { lcp: 0, fcp: 0, ready: 0 };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
    } catch (e) {}
    const poll = () => {
      const el = document.querySelector(${JSON.stringify(readySel)});
      const splash = document.getElementById('app-splash');
      const loader = document.body && /Loading your workspace/.test(document.body.innerText || '');
      if (el && !loader && (!splash || splash.classList.contains('is-hidden'))) { window.__perf.ready = performance.now(); return; }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  })();
`;

async function measure(browser, net, pg, cookie, warm) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, userAgent: undefined });
  if (pg.auth && cookie) await context.addCookies([{ name: cookie.name, value: cookie.value, url: BASE_URL }]);
  const page = await context.newPage();
  await page.addInitScript(INIT(pg.ready));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (net.down >= 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: net.down, uploadThroughput: net.up, latency: net.latency });
  if (net.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: net.cpu });

  let bytes = 0;
  let requests = 0;
  let jsBytes = 0;
  const types = new Map();
  cdp.on('Network.responseReceived', (e) => types.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength || 0;
    requests += 1;
    if (types.get(e.requestId) === 'Script') jsBytes += e.encodedDataLength || 0;
  });

  const go = async () => {
    await page.goto(BASE_URL + pg.path, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__perf && window.__perf.ready > 0, null, { timeout: 120000 });
    await page.waitForTimeout(400);
  };

  if (warm) {
    await go(); // fills the browser cache
    bytes = 0; requests = 0; jsBytes = 0;
  }
  await go();
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, ...window.__perf };
  });
  await context.close();
  return { ...timing, bytes, requests, jsBytes };
}

(async () => {
  await seed();
  await seedBulk();
  await startServer();
  const agent = await loginAs('pro');
  const cookie = (() => { const [name, ...rest] = agent.cookie.split('='); return { name, value: rest.join('=') }; })();
  const browser = await chromium.launch();

  const out = { label, at: new Date().toISOString(), runs: RUNS, results: {} };
  const onlyPages = (process.env.BENCH_PAGES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const onlyNets = (process.env.BENCH_NETS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const net of NETWORKS) {
    if (onlyNets.length && !onlyNets.some((n) => net.name.toLowerCase().includes(n))) continue;
    out.results[net.name] = {};
    for (const pg of PAGES) {
      if (onlyPages.length && !onlyPages.some((p) => pg.name.toLowerCase().includes(p))) continue;
      out.results[net.name][pg.name] = {};
      for (const warm of [false, true]) {
        const samples = [];
        for (let i = 0; i < RUNS; i += 1) samples.push(await measure(browser, net, pg, cookie, warm));
        const pick = (k) => Math.round(median(samples.map((s) => s[k])));
        const row = { ttfb: pick('ttfb'), fcp: pick('fcp'), lcp: pick('lcp'), ready: pick('ready'), load: pick('load'), kb: Math.round(pick('bytes') / 1024), requests: pick('requests'), jsKb: Math.round(pick('jsBytes') / 1024) };
        out.results[net.name][pg.name][warm ? 'warm' : 'cold'] = row;
        console.log(`${net.name.padEnd(28)} ${pg.name.padEnd(32)} ${warm ? 'warm' : 'cold'}  ttfb ${String(row.ttfb).padStart(5)}  fcp ${String(row.fcp).padStart(5)}  lcp ${String(row.lcp).padStart(5)}  READY ${String(row.ready).padStart(5)} ms   ${String(row.kb).padStart(5)} KB (${row.jsKb} KB js)  ${row.requests} req`);
      }
    }
  }
  console.log('\nSaved', saveResult(label, 'pages', out));
  await browser.close();
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
