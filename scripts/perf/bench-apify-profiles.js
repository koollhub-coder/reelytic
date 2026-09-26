/*
  node scripts/perf/bench-apify-profiles.js <label> --spend

  Profile reports: how long the app's real profile scraper takes for 5 and 10 profiles in one run,
  and for three runs of 5 side by side (what the engine does today). Spends about 25 rupees.
*/
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { saveResult } = require('./lib');
const label = process.argv[2] || 'run';
if (!process.argv.includes('--spend')) { console.log('Re-run with --spend (costs about 25 rupees).'); process.exit(0); }

(async () => {
  process.env.MONGODB_DB_NAME = process.env.REAL_DB_NAME || 'reelytic';
  const { connectDb, getDb } = require('../../server/db');
  await connectDb();
  const jobs = await getDb().collection('jobs').find({ type: 'profile', status: 'done', 'counts.success': { $gte: 15 } }).sort({ createdAt: -1 }).limit(1).project({ rows: 1 }).toArray();
  const { scrapeProfilesBatchV2, extractUsername } = require('../../server/services/apify.service');
  const names = (jobs[0] ? jobs[0].rows : []).filter((r) => r.state === 'done').map((r) => extractUsername(r.input.url)).filter(Boolean);
  console.log(`have ${names.length} profiles`);
  if (names.length < 15) throw new Error('need a finished profile report with at least 15 profiles');
  const out = { label, at: new Date().toISOString(), experiments: {} };
  const time = async (name, fn) => {
    const t0 = performance.now();
    const r = await fn();
    out.experiments[name] = { ms: Math.round(performance.now() - t0) };
    console.log(name.padEnd(46), out.experiments[name]);
    return r;
  };
  await time('5 profiles in one run', () => scrapeProfilesBatchV2(names.slice(0, 5)));
  await time('10 profiles in one run', () => scrapeProfilesBatchV2(names.slice(5, 15)));
  await time('15 profiles, 3 runs of 5 at once (today)', () => Promise.all([0, 5, 10].map((i) => scrapeProfilesBatchV2(names.slice(i, i + 5)))));
  console.log('\nSaved', saveResult(label, 'apify-profiles', out));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
