/*
  node scripts/perf/bench-apify-scale.js <label> --spend

  Two follow-up questions for the reel actor, using the fast (long-poll) call:
    1. how does one run scale with the number of links (10 / 20 / 40)?
    2. after a run is SUCCEEDED, how long until its reported cost is final?
  Spends a few rupees. Read-only on the database.
*/
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { saveResult } = require('./lib');
const label = process.argv[2] || 'run';
if (!process.argv.includes('--spend')) { console.log('Re-run with --spend (costs about 20 rupees).'); process.exit(0); }

const KEY = process.env.APIFY_API_KEY;
const ACTOR = 'patient_discovery~instagram-reel-analytics-by-url';
const FIELD = process.env.REEL_ANALYTICS_INPUT_FIELD || 'postUrls';
const api = (p) => `https://api.apify.com/v2/${p}${p.includes('?') ? '&' : '?'}token=${KEY}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function urlsFrom(n) {
  process.env.MONGODB_DB_NAME = process.env.REAL_DB_NAME || 'reelytic';
  const { connectDb, getDb } = require('../../server/db');
  await connectDb();
  const jobs = await getDb().collection('jobs').find({ type: 'reel', status: 'done', 'counts.success': { $gte: n } }).sort({ createdAt: -1 }).limit(1).project({ rows: 1 }).toArray();
  return (jobs[0] ? jobs[0].rows : []).filter((r) => r.state === 'done' && /instagram\.com\/(reel|p)\//.test(r.input.url)).slice(0, n).map((r) => r.input.url);
}

async function run(urls, timeline) {
  const t0 = performance.now();
  let r = (await (await fetch(api(`acts/${ACTOR}/runs?waitForFinish=60`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [FIELD]: urls }) })).json()).data;
  while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(r.status)) r = (await (await fetch(api(`actor-runs/${r.id}?waitForFinish=60`))).json()).data;
  const doneMs = performance.now() - t0;
  const items = await (await fetch(api(`datasets/${r.defaultDatasetId}/items?clean=true`))).json();
  const readMs = performance.now() - t0;
  let settle = null;
  if (timeline) {
    const samples = [];
    const s0 = performance.now();
    for (let i = 0; i < 30; i += 1) {
      const cur = (await (await fetch(api(`actor-runs/${r.id}`))).json()).data;
      samples.push({ ms: Math.round(performance.now() - s0), usd: cur.usageTotalUsd });
      await sleep(400);
    }
    settle = samples;
  }
  return { n: urls.length, items: items.length, doneMs: Math.round(doneMs), withDataMs: Math.round(readMs), actorSecs: r.stats && r.stats.runTimeSecs, usd: r.usageTotalUsd, settle };
}

(async () => {
  const urls = await urlsFrom(40);
  console.log(`have ${urls.length} urls`);
  const out = { label, at: new Date().toISOString(), scale: [], settle: null };
  for (const n of [10, 20, 40]) {
    if (urls.length < n) continue;
    const res = await run(urls.slice(0, n), n === 10);
    if (res.settle) { out.settle = res.settle; delete res.settle; }
    out.scale.push(res);
    console.log(JSON.stringify(res));
  }
  console.log('\nreported cost after the run finished (usd):');
  console.log((out.settle || []).map((s) => `${s.ms}ms:${s.usd}`).join('  '));
  console.log('\nSaved', saveResult(label, 'apify-scale', out));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
