/*
  node scripts/perf/bench-apify-engine.js <label> --spend

  End to end, what a batch of reel links costs in TIME, old way against new way, with real
  Apify runs and the app's own code:

    old   15 links per run, one run after another, each run polled every 2 s with a fixed 6 s wait
          for the cost, then a follower lookup done the same way (a faithful copy of the old code)
    new   the app's real scrapeReels() and scrapeFollowersBatchWithCost() with deferred cost, 20 links
          per run, three runs at the same time

  Spends real money (about 30 rupees). Read-only on the database.
*/
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { saveResult } = require('./lib');
const label = process.argv[2] || 'run';
if (!process.argv.includes('--spend')) { console.log('Re-run with --spend (costs about 30 rupees).'); process.exit(0); }

const KEY = process.env.APIFY_API_KEY;
const REEL = 'patient_discovery~instagram-reel-analytics-by-url';
const FOLLOW = 'apify~instagram-followers-count-scraper';
const FIELD = process.env.REEL_ANALYTICS_INPUT_FIELD || 'postUrls';
const api = (p) => `https://api.apify.com/v2/${p}${p.includes('?') ? '&' : '?'}token=${KEY}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The old fetchFromApifyWithCost, copied as it was.
async function oldStyle(actor, input) {
  const start = await (await fetch(api(`acts/${actor}/runs`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json();
  let run = start.data;
  while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) {
    await sleep(2000);
    run = (await (await fetch(api(`actor-runs/${run.id}`))).json()).data;
  }
  await sleep(6000);
  const fin = (await (await fetch(api(`actor-runs/${run.id}`))).json()).data;
  const items = await (await fetch(api(`datasets/${fin.defaultDatasetId}/items?clean=true`))).json();
  return { items, usd: fin.usageTotalUsd };
}
async function oldBatch(urls) {
  const reels = await oldStyle(REEL, { [FIELD]: urls });
  const names = [...new Set(reels.items.map((i) => (i.user && i.user.username) || i.ownerUsername).filter(Boolean))];
  const followers = names.length ? await oldStyle(FOLLOW, { usernames: names }) : { usd: 0 };
  return reels.usd + followers.usd;
}

async function urlsFrom(n) {
  process.env.MONGODB_DB_NAME = process.env.REAL_DB_NAME || 'reelytic';
  const { connectDb, getDb } = require('../../server/db');
  await connectDb();
  const jobs = await getDb().collection('jobs').find({ type: 'reel', status: 'done', 'counts.success': { $gte: n } }).sort({ createdAt: -1 }).limit(1).project({ rows: 1 }).toArray();
  return (jobs[0] ? jobs[0].rows : []).filter((r) => r.state === 'done' && /instagram\.com\/(reel|p)\//.test(r.input.url)).slice(0, n).map((r) => r.input.url);
}

(async () => {
  const urls = await urlsFrom(60);
  console.log(`have ${urls.length} urls`);
  const out = { label, at: new Date().toISOString(), experiments: {} };
  const { scrapeReels, scrapeFollowersBatchWithCost } = require('../../server/services/apify.service');
  const newBatch = async (list) => {
    const reels = await scrapeReels(list, { deferCost: true });
    const names = [...new Set(reels.filter(Boolean).map((r) => r.ownerUsername).filter(Boolean))];
    const followers = names.length ? await scrapeFollowersBatchWithCost(names, { deferCost: true }) : null;
    return { reels, followers };
  };

  // 30 links, the old way: two batches of 15, one after the other
  let t0 = performance.now();
  const oldUsd = (await oldBatch(urls.slice(0, 15))) + (await oldBatch(urls.slice(15, 30)));
  out.experiments['30 links, old way (2 batches of 15, one after another)'] = { ms: Math.round(performance.now() - t0), usd: oldUsd };
  console.log('30 links, old way:', out.experiments['30 links, old way (2 batches of 15, one after another)']);

  // 30 links, the new way: two batches of 15 at once, results ready as soon as the data is
  t0 = performance.now();
  const two = await Promise.all([newBatch(urls.slice(0, 15)), newBatch(urls.slice(15, 30))]);
  const readyMs = Math.round(performance.now() - t0);
  const settled = await Promise.all(two.flatMap((b) => [b.reels.costPromise, b.followers && b.followers.costPromise]));
  out.experiments['30 links, new way (2 batches of 15 at once, cost settled later)'] = { ms: readyMs, costSettledExtraMs: Math.round(performance.now() - t0) - readyMs, usd: settled.reduce((a, b) => a + (b || 0), 0) };
  console.log('30 links, new way:', out.experiments['30 links, new way (2 batches of 15 at once, cost settled later)']);

  // 60 links, the new way: three batches of 20 at once
  t0 = performance.now();
  const three = await Promise.all([0, 20, 40].map((i) => newBatch(urls.slice(i, i + 20))));
  const ready60 = Math.round(performance.now() - t0);
  const settled60 = await Promise.all(three.flatMap((b) => [b.reels.costPromise, b.followers && b.followers.costPromise]));
  out.experiments['60 links, new way (3 batches of 20 at once, cost settled later)'] = { ms: ready60, costSettledExtraMs: Math.round(performance.now() - t0) - ready60, usd: settled60.reduce((a, b) => a + (b || 0), 0) };
  console.log('60 links, new way:', out.experiments['60 links, new way (3 batches of 20 at once, cost settled later)']);

  console.log('\nSaved', saveResult(label, 'apify-engine', out));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
