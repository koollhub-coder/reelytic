const { getDb, queryId } = require('../db');
const { getErBenchmarks, bandFor } = require('./benchmarks.service');

/*
  The two pieces of context that turn a report from a table of numbers into
  something an agency can draw a conclusion from:

    benchmark  -- how this report's engagement compares to typical creators
                  of the same size (see benchmarks.service.js)
    previous   -- how it compares to the last report in the same campaign

  Both are computed here rather than in the client so the authenticated
  preview and the public share view can never disagree about them, and so
  the share view doesn't need access to the agency's other reports in order
  to render a comparison.
*/

/*
  Upper bound on a believable engagement rate.

  Deliberately identical to MAX_PLAUSIBLE_ER in
  client/src/components/ReportSheet.jsx. The report's "Typical ER" tile and the
  benchmark sentence rendered directly beneath it are computed in two different
  places, and if they filter over different row sets they print two different
  medians for the same report. That happened: 2.2% in the tile against 2.4% in
  the sentence, on a report holding five rows above 150%.

  If you change one, change the other.
*/
const MAX_PLAUSIBLE_ER = 100;

function headlineMetrics(job) {
  const isReel = job.type === 'reel';
  // No username requirement: a row that resolved its metrics but not its
  // creator is still a measurement, and excluding it here while the report
  // itself counts it would put the benchmark out of step with the table.
  const rows = (job.rows || []).filter((r) => r.state === 'done' && r.result);
  if (rows.length === 0) return null;

  const ers = rows
    .map((r) => Number(isReel ? r.result.er : r.result.avgEr))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= MAX_PLAUSIBLE_ER);

  const totalViews = rows.reduce((sum, r) => sum + (Number(r.result[isReel ? 'views' : 'avgViews']) || 0), 0);

  /*
    Both a mean and a median, and the benchmark comparison uses the median.

    Two reasons. First, comparing a mean to a median benchmark is simply the
    wrong comparison: the two statistics answer different questions, and
    lining them up produces a verdict that is an artefact of the mismatch.

    Second, this data really does contain values that break a mean. One live
    profile report carries a creator at 1201% engagement, which on its own
    lifts that report's mean ER from roughly 3.5% to 70% and would have had
    the report announce itself as "top quarter" on the strength of a single
    broken row. The median moves by a fraction of a point.
  */
  const sorted = [...ers].sort((a, b) => a - b);
  const medianEr = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;

  return {
    creators: rows.length,
    totalViews,
    meanEr: ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : 0,
    medianEr,
  };
}

/*
  Picks the band that describes this report's creators as a group.

  Uses the MEDIAN creator's band, not the average follower count. One
  celebrity in a roster of micro-influencers would drag a mean into the
  "over 1M" band and then benchmark the whole campaign against a peer group
  none of its creators belong to.
*/
function dominantBand(job) {
  const followers = (job.rows || [])
    .filter((r) => r.state === 'done' && r.result)
    .map((r) => Number(r.result.followers) || 0)
    .filter((f) => f > 0)
    .sort((a, b) => a - b);
  if (followers.length === 0) return null;
  return bandFor(followers[Math.floor(followers.length / 2)]);
}

async function buildBenchmarkContext(job) {
  const metrics = headlineMetrics(job);
  const band = dominantBand(job);
  if (!metrics || !band) return null;

  const benchmarks = await getErBenchmarks();
  const type = job.type === 'reel' ? 'reel' : 'profile';
  const stats = benchmarks[type] && benchmarks[type][band.id];
  // No entry means the band didn't clear the minimum sample size. Saying
  // nothing is correct here; a benchmark drawn from too few creators would
  // be worse than no benchmark at all.
  if (!stats) return null;

  const reportEr = metrics.medianEr;
  const diff = reportEr - stats.median;
  // A key, not a sentence fragment. The client owns the wording; the server
  // owns the verdict. Gluing half a sentence together across the two is how
  // you end up with copy that doesn't parse.
  let standing = 'in-line';
  if (reportEr >= stats.p75) standing = 'top-quarter';
  else if (reportEr <= stats.p25) standing = 'bottom-quarter';
  else if (diff > 0) standing = 'above-median';
  else if (diff < 0) standing = 'below-median';

  return {
    band: band.id,
    bandLabel: band.label,
    median: stats.median,
    p25: stats.p25,
    p75: stats.p75,
    sampleSize: stats.sampleSize,
    reportEr: Number(reportEr.toFixed(2)),
    standing,
  };
}

/*
  Compares this report to the previous one in the same campaign.

  "Previous" means the most recent report in the campaign created strictly
  before this one, so opening an older report shows what it looked like at
  the time rather than comparing it against something that came after it.
*/
async function buildPreviousContext(job) {
  if (!job.campaignId) return null;

  const db = getDb();
  const earlier = await db.collection('jobs')
    .find({
      campaignId: job.campaignId,
      ownerUsername: job.ownerUsername,
      // Matched in the query rather than checked afterwards. A campaign that
      // mixes reel and profile reports would otherwise lose the comparison
      // entirely whenever the nearest earlier report happened to be the
      // other type, instead of simply reaching past it to the right one.
      // The two engagement rates are differently defined and must never be
      // put on the same axis.
      type: job.type,
      createdAt: { $lt: job.createdAt },
      _id: { $ne: queryId(job._id) },
    })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  if (earlier.length === 0) return null;
  const prev = earlier[0];

  const now = headlineMetrics(job);
  const before = headlineMetrics(prev);
  if (!now || !before) return null;

  // A percentage change against a zero baseline is not a number anyone can
  // act on, so those come back as null and the client omits them.
  const pctChange = (a, b) => (b > 0 ? Number((((a - b) / b) * 100).toFixed(1)) : null);

  return {
    comparedTo: prev.fileName || 'previous report',
    comparedToDate: prev.createdAt,
    // Median here too, for the same reason the benchmark uses it: a single
    // broken row must not make a campaign look like it doubled.
    medianEr: { now: Number(now.medianEr.toFixed(2)), before: Number(before.medianEr.toFixed(2)), changePct: pctChange(now.medianEr, before.medianEr) },
    totalViews: { now: now.totalViews, before: before.totalViews, changePct: pctChange(now.totalViews, before.totalViews) },
    creators: { now: now.creators, before: before.creators, changePct: pctChange(now.creators, before.creators) },
  };
}

// One call so a page never has to know that these come from different places.
// Neither piece is load-bearing: if either throws, the report still renders
// without it rather than failing outright.
async function buildReportContext(job) {
  const [benchmark, previous] = await Promise.all([
    buildBenchmarkContext(job).catch(() => null),
    buildPreviousContext(job).catch(() => null),
  ]);
  return { benchmark, previous };
}

module.exports = { buildReportContext, headlineMetrics, dominantBand };
