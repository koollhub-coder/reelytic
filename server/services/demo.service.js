const { ObjectId } = require('mongodb');
const { getDb } = require('../db');

/*
  The sample report a new client is dropped into on their first login.

  Why a real job document rather than a mocked-up screen: the whole point is
  that they learn the actual interface. A separate "demo mode" UI teaches
  them a screen that does not exist, and has to be maintained in parallel
  forever. This is a genuine job row that flows through the real report
  view, the real export, the real share dialog.

  ---------------------------------------------------------------------
  THE SANDBOX BOUNDARY, because this is the part that must not leak:

  A demo job unlocks the paid features (shareable links, agency branding)
  so a free-tier client can see what they do. That unlock is scoped to
  `isDemo: true` on THIS job and is enforced server-side at each call site,
  never by hiding a button. Concretely:

    - hasFeature() is NOT modified. Real entitlement logic is untouched.
    - Route handlers grant access when `hasFeature(...) || job.isDemo`, so
      the exemption is visible at the point it is used and cannot silently
      widen to a real report.
    - Branding is carried ON the demo job (`demoBranding`) instead of being
      written to the client's account settings, so seeing branded output
      never grants the ability to set their own.
    - No credits are charged and no scraping happens: every figure below is
      static sample data.

  A demo job therefore proves the feature exists without granting it.
  ---------------------------------------------------------------------

  Figures are plausible mid-tier Indian creator numbers, deliberately varied
  (one strong performer, one weak) so the report's best/worst callouts and
  the typical-ER median have something real to say.
*/

const DEMO_FILE_NAME = 'sample-campaign.xlsx';

const DEMO_CREATORS = [
  { username: 'arjunmehra',   followers: 184300, views: 412500, likes: 21840, comments: 612, shares: 1840, saves: 3120 },
  { username: 'the.simran',   followers: 98700,  views: 288100, likes: 14260, comments: 431, shares: 1120, saves: 2040 },
  { username: 'kabirshoots',  followers: 246000, views: 196400, likes: 9870,  comments: 288, shares: 640,  saves: 1180 },
  { username: 'nehaonreels',  followers: 61200,  views: 154900, likes: 8940,  comments: 372, shares: 810,  saves: 1460 },
  { username: 'rhea.styles',  followers: 132400, views: 121600, likes: 5210,  comments: 154, shares: 390,  saves: 720 },
  { username: 'devfoodie',    followers: 45800,  views: 98300,  likes: 6740,  comments: 298, shares: 720,  saves: 1310 },
  { username: 'aanya.travels',followers: 210500, views: 76400,  likes: 2980,  comments: 88,  shares: 210,  saves: 340 },
  { username: 'zaid.fitness', followers: 87300,  views: 213700, likes: 12480, comments: 504, shares: 1340, saves: 2380 },
];

function engagementRate(c) {
  // Same shape as the real reel formula so the demo cannot teach a number
  // the product does not actually produce.
  const engagement = c.likes + c.comments + c.shares + c.saves;
  return c.views > 0 ? Number(((engagement / c.views) * 100).toFixed(2)) : 0;
}

function buildDemoRows() {
  return DEMO_CREATORS.map((c, i) => ({
    i: i + 1,
    state: 'done',
    input: {
      url: `https://www.instagram.com/reel/DEMO${String(i + 1).padStart(4, '0')}/`,
      original: {
        'Creator': `@${c.username}`,
        'Brief': i % 2 === 0 ? 'Launch film' : 'Product demo',
        'Posted': '2026-08-0' + ((i % 7) + 1),
      },
    },
    result: {
      username: c.username,
      followers: c.followers,
      views: c.views,
      likes: c.likes,
      comments: c.comments,
      shares: c.shares,
      reposts: Math.round(c.shares * 0.35),
      saves: c.saves,
      er: engagementRate(c),
      likesEstimated: false,
    },
    error: null,
    fromCache: false,
  }));
}

/*
  Branding shown on the demo report only. Lives on the job, never on the
  client's settings document, so a free-tier account can see what a branded
  client report looks like without gaining the ability to brand real ones.
*/
const DEMO_BRANDING = {
  agencyName: 'Your Agency',
  accentColor: '#E23E57',
  logoDataUri: null,
};

async function createDemoJob(username) {
  const db = getDb();
  const rows = buildDemoRows();
  const jobId = new ObjectId().toHexString();
  const now = new Date();

  const jobDoc = {
    _id: jobId,
    type: 'reel',
    ownerUsername: username,
    status: 'done',
    fileName: DEMO_FILE_NAME,
    // { name, renamedTo } objects, matching the shape parse.service.js
    // produces for a real upload -- ColumnsModal and the preview table both
    // read c.name/c.renamedTo, so a bare string array here left both
    // undefined for every column (same value for all three -> the
    // duplicate-key React warning the regression console gate caught).
    originalColumns: ['Creator', 'Brief', 'Posted'].map((name) => ({ name, renamedTo: name })),
    rows,
    avgRowMs: 1400,
    counts: {
      total: rows.length,
      valid: rows.length,
      invalid: 0,
      duplicates: 0,
      processed: rows.length,
      success: rows.length,
      failed: 0,
      skipped: 0,
      // No credits were spent: nothing was scraped.
      creditsSpent: 0,
    },
    cursor: rows.length,
    reelPipelineMode: 'express',
    creditsPerItem: 0,
    // The sandbox marker. Every exemption keys off this and nothing else.
    isDemo: true,
    demoBranding: DEMO_BRANDING,
    // Recorded so the credit audit shows this run cost the client nothing
    // rather than leaving it unverifiable.
    creditsBefore: null,
    creditsAfter: null,
    startedAt: new Date(now.getTime() - 47000),
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection('jobs').insertOne(jobDoc);
  return jobDoc;
}

// One demo per client. Returning the existing one keeps "Replay the tour"
// idempotent instead of littering History with duplicates.
async function getOrCreateDemoJob(username) {
  const db = getDb();
  const existing = await db.collection('jobs').findOne({ ownerUsername: username, isDemo: true });
  if (existing) return existing;
  return createDemoJob(username);
}

async function deleteDemoJob(username) {
  const db = getDb();
  await db.collection('jobs').deleteMany({ ownerUsername: username, isDemo: true });
}

module.exports = { getOrCreateDemoJob, deleteDemoJob, DEMO_FILE_NAME, DEMO_BRANDING };
