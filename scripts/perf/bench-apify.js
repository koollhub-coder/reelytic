/*
  node scripts/perf/bench-apify.js <label> [--spend]

  Times the REAL Apify calls this app makes, then the alternatives, on the same
  inputs. This spends real money (a few rupees). It refuses to run unless you
  pass --spend, and it never writes to the database.

  It reads a handful of real reel URLs from an existing report of yours (read
  only) so the inputs are genuine and public.

  Experiments
    current-reel     scrapeReels()            the code the app runs today
    current-follow   scrapeFollowersBatchWithCost()
    raw-*            the same actor called by hand with different options, to see
                     what start-up, polling, the fixed cost wait, memory and batch
                     size each contribute
*/
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { saveResult } = require('./lib');

const label = process.argv[2] || 'run';
if (!process.argv.includes('--spend')) {
  console.log('This benchmark spends real Apify credits (about 3 to 6 rupees). Re-run with --spend to go ahead.');
  process.exit(0);
}

const KEY = process.env.APIFY_API_KEY;
const REEL_ACTOR = 'patient_discovery~instagram-reel-analytics-by-url';
const FIELD = process.env.REEL_ANALYTICS_INPUT_FIELD || 'postUrls';
const FOLLOW_ACTOR = 'apify~instagram-followers-count-scraper';
const api = (p) => `https://api.apify.com/v2/${p}${p.includes('?') ? '&' : '?'}token=${KEY}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function pickUrls(n) {
  // read-only lookup in the real database for genuine public reel URLs; nothing is written
  process.env.MONGODB_DB_NAME = process.env.REAL_DB_NAME || 'reelytic';
  const { connectDb, getDb } = require('../../server/db');
  await connectDb();
  const db = getDb();
  const jobs = await db.collection('jobs').find({ type: 'reel', status: 'done', 'counts.success': { $gte: n } }).sort({ createdAt: -1 }).limit(1).project({ rows: 1 }).toArray();
  const rows = (jobs[0] ? jobs[0].rows : []).filter((r) => r.state === 'done' && /instagram\.com\/(reel|p)\//.test(r.input.url));
  return rows.slice(0, n).map((r) => r.input.url);
}

// A run started and waited on the way the app does today.
async function currentStyle(actor, input) {
  const t0 = now();
  const marks = {};
  const start = await (await fetch(api(`acts/${actor}/runs`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json();
  marks.startedMs = now() - t0;
  let run = start.data;
  while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) {
    await sleep(2000);
    run = (await (await fetch(api(`actor-runs/${run.id}`))).json()).data;
  }
  marks.finishedMs = now() - t0;
  await sleep(6000);
  const fin = (await (await fetch(api(`actor-runs/${run.id}`))).json()).data;
  marks.costSettledMs = now() - t0;
  const items = await (await fetch(api(`datasets/${fin.defaultDatasetId}/items?clean=true`))).json();
  marks.totalMs = now() - t0;
  return { marks, items, usd: fin.usageTotalUsd, memory: fin.options && fin.options.memoryMbytes, actorMs: fin.stats && fin.stats.runTimeSecs * 1000 };
}

// Long-poll: ask Apify to hold the request until the run is done, then read the data straight away.
async function fastStyle(actor, input, { memory } = {}) {
  const t0 = now();
  const marks = {};
  const q = `waitForFinish=60${memory ? `&memory=${memory}` : ''}`;
  let run = (await (await fetch(api(`acts/${actor}/runs?${q}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json()).data;
  marks.startedMs = now() - t0;
  while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(run.status)) {
    run = (await (await fetch(api(`actor-runs/${run.id}?waitForFinish=60`))).json()).data;
  }
  marks.finishedMs = now() - t0;
  const [items, prov] = await Promise.all([
    fetch(api(`datasets/${run.defaultDatasetId}/items?clean=true`)).then((r) => r.json()),
    fetch(api(`actor-runs/${run.id}`)).then((r) => r.json()).then((j) => j.data),
  ]);
  marks.totalMs = now() - t0;
  // what the cost reads at once, and again after the platform has settled
  const early = prov.usageTotalUsd;
  await sleep(8000);
  const late = (await (await fetch(api(`actor-runs/${run.id}`))).json()).data.usageTotalUsd;
  return { marks, items, usd: late, usdAtOnce: early, memory: prov.options && prov.options.memoryMbytes, actorMs: prov.stats && prov.stats.runTimeSecs * 1000 };
}

(async () => {
  const out = { label, at: new Date().toISOString(), experiments: {} };
  const urls = await pickUrls(10);
  if (urls.length < 5) throw new Error('need at least 5 reel URLs in an existing report');
  console.log(`Using ${urls.length} real reel URLs.\n`);
  const rec = (name, r, extra = {}) => {
    const row = { totalMs: Math.round(r.marks.totalMs), startedMs: Math.round(r.marks.startedMs), finishedMs: Math.round(r.marks.finishedMs), costSettledMs: r.marks.costSettledMs ? Math.round(r.marks.costSettledMs) : null, actorRunMs: r.actorMs ? Math.round(r.actorMs) : null, usd: r.usd, usdAtOnce: r.usdAtOnce ?? null, memoryMb: r.memory, items: r.items.length, ...extra };
    out.experiments[name] = row;
    console.log(name.padEnd(46), JSON.stringify(row));
  };

  // 1. what the app does today
  rec('reel actor, today (2s polling + fixed 6s cost wait)', await currentStyle(REEL_ACTOR, { [FIELD]: urls }));
  // 2. long-poll, no fixed wait
  rec('reel actor, long-poll, no fixed wait', await fastStyle(REEL_ACTOR, { [FIELD]: urls }));
  // 3. memory
  for (const memory of [1024, 2048, 4096]) rec(`reel actor, long-poll, memory ${memory} MB`, await fastStyle(REEL_ACTOR, { [FIELD]: urls }, { memory }));
  // 4. batch size, per item
  for (const n of [5]) rec(`reel actor, long-poll, ${n} urls`, await fastStyle(REEL_ACTOR, { [FIELD]: urls.slice(0, n) }));
  // 5. two batches at once vs one after another
  {
    const a = urls.slice(0, 5);
    const b = urls.slice(5, 10);
    const t0 = now();
    await Promise.all([fastStyle(REEL_ACTOR, { [FIELD]: a }), fastStyle(REEL_ACTOR, { [FIELD]: b })]);
    // subtract the 8 s cost-settle wait both variants of this helper include
    out.experiments['2 batches of 5, in parallel (wall clock)'] = { totalMs: Math.round(now() - t0 - 8000) };
    console.log('2 batches of 5, in parallel (wall clock)'.padEnd(46), out.experiments['2 batches of 5, in parallel (wall clock)']);
  }
  // 6. the follower lookup
  const owners = [...new Set(out.experiments && [])];
  const first = await fastStyle(REEL_ACTOR, { [FIELD]: urls.slice(0, 3) });
  const usernames = [...new Set(first.items.map((i) => (i.user && i.user.username) || i.ownerUsername).filter(Boolean))];
  const analyticsFollowers = Object.fromEntries(first.items.map((i) => [((i.user && i.user.username) || i.ownerUsername), i.metrics && i.metrics.user_follower_count]));
  const cur = await currentStyle(FOLLOW_ACTOR, { usernames });
  rec('followers actor, today', cur);
  const fast = await fastStyle(FOLLOW_ACTOR, { usernames });
  rec('followers actor, long-poll', fast);
  const official = Object.fromEntries((fast.items || []).map((i) => [i.username || i.userName, i.followersCount ?? i.followers_count]));
  out.followerAgreement = usernames.map((u) => ({ user: u, fromReelActor: analyticsFollowers[u] ?? null, fromFollowerActor: official[u] ?? null }));
  console.log('\nFollower counts, reel actor vs follower actor:');
  console.table(out.followerAgreement);

  console.log('\nSaved', saveResult(label, 'apify', out));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
