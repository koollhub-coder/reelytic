const { getDb } = require('../db');

/*
  Engagement-rate benchmarks, computed from reports Reelytic has already run.

  The point of this is context. "2.2% engagement rate" means nothing to an
  agency's client on its own; "2.2%, against a 3.4% median for creators this
  size" is a judgement they can act on. Nobody can copy it without the same
  history of runs, which is exactly why it's worth having.

  Two rules govern what leaves this file:

  1. Aggregate only. A band is a median and a count over many creators from
     many accounts. No username, no account, no individual figure is ever
     exposed, and a band below MIN_SAMPLE is dropped entirely rather than
     published thin -- both because a "median" over eight creators is noise
     dressed as authority, and because small groups are where aggregates
     start leaking information about the individuals in them.

  2. Median, not mean. Engagement rates are badly skewed: one viral reel at
     40% would drag a mean somewhere no real creator lives. The median is
     what an agency actually means by "typical".

  Reels and profiles are benchmarked separately and never mixed. A reel's ER
  is measured against one post's views; a profile's is an average across
  several. They are different numbers that happen to share a name.
*/

const BANDS = [
  { id: '<1K', label: 'under 1K followers', min: 0, max: 1000 },
  { id: '1K-10K', label: '1K to 10K followers', min: 1000, max: 10000 },
  { id: '10K-50K', label: '10K to 50K followers', min: 10000, max: 50000 },
  { id: '50K-250K', label: '50K to 250K followers', min: 50000, max: 250000 },
  { id: '250K-1M', label: '250K to 1M followers', min: 250000, max: 1000000 },
  { id: '1M+', label: 'over 1M followers', min: 1000000, max: Infinity },
];

// Below this a band is withheld rather than shown. See rule 1 above.
const MIN_SAMPLE = 30;

// Kept in step with reportContext.service.js and ReportSheet.jsx.
const MAX_PLAUSIBLE_ER = 100;

// Scanning every job is not something to do per page load. Benchmarks move
// on the scale of weeks, so a stale-by-hours answer is indistinguishable
// from a fresh one to anyone reading it.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = { value: null, expiresAt: 0 };

function bandFor(followers) {
  return BANDS.find((b) => followers >= b.min && followers < b.max) || null;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * p));
  return sortedValues[idx];
}

async function computeBenchmarks() {
  const db = getDb();
  /*
    Deliberately NOT filtered to status 'done'. A row that resolved is a real
    measurement whether or not the report around it was ever finished, and
    filtering on job status threw away roughly 100 perfectly good creator
    readings that happened to sit inside paused reports. Preview jobs are
    excluded because they contain no results at all, so skipping them is a
    free reduction in what gets scanned.
  */
  const jobs = await db.collection('jobs')
    .find({ status: { $ne: 'preview' } })
    .project({ type: 1, rows: 1 })
    .toArray();

  const buckets = { reel: {}, profile: {} };

  for (const job of jobs) {
    const type = job.type === 'reel' ? 'reel' : 'profile';
    for (const row of job.rows || []) {
      if (row.state !== 'done' || !row.result) continue;
      const followers = Number(row.result.followers) || 0;
      const er = Number(type === 'reel' ? row.result.er : row.result.avgEr);
      // A zero or missing ER is a row that failed to resolve properly, not a
      // creator with genuinely no engagement. Including them would drag every
      // band's median down and make every client's report look good.
      //
      // The upper bound matters for the same reason in reverse: rows written
      // by the old mismatched-estimator bug (see metrics.service.js) reach
      // 1363%, and a reference median must not be built partly from figures
      // the product itself refuses to display. Same constant as
      // reportContext.service.js and ReportSheet.jsx.
      if (!followers || !Number.isFinite(er) || er <= 0 || er > MAX_PLAUSIBLE_ER) continue;

      const band = bandFor(followers);
      if (!band) continue;
      (buckets[type][band.id] = buckets[type][band.id] || []).push(er);
    }
  }

  const result = { reel: {}, profile: {}, computedAt: new Date().toISOString() };
  for (const type of ['reel', 'profile']) {
    for (const band of BANDS) {
      const values = (buckets[type][band.id] || []).sort((a, b) => a - b);
      if (values.length < MIN_SAMPLE) continue;
      result[type][band.id] = {
        label: band.label,
        sampleSize: values.length,
        p25: Number(percentile(values, 0.25).toFixed(2)),
        median: Number(percentile(values, 0.5).toFixed(2)),
        p75: Number(percentile(values, 0.75).toFixed(2)),
      };
    }
  }
  return result;
}

async function getErBenchmarks() {
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  const value = await computeBenchmarks();
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

// Exported so tests and the admin view can force a recompute without
// waiting out the TTL.
function clearBenchmarkCache() {
  cache = { value: null, expiresAt: 0 };
}

module.exports = { getErBenchmarks, clearBenchmarkCache, bandFor, BANDS, MIN_SAMPLE };
