/*
  Shared pieces for the performance benchmarks (scripts/perf/*).

  Everything runs against the throwaway test database (reelytic_test) and the
  stubbed scraper, never production data, and everything it inserts carries
  perfBulk: true so it can be removed again.

  The database is Atlas, so every number includes real network latency between
  this machine and Atlas. That is deliberate: latency to the database is the
  thing that makes most endpoints slow, so a benchmark that hid it would hide
  the problem. Compare runs against each other (before vs after); the absolute
  numbers on Render will differ, the ratios will not.
*/
process.env.MONGODB_DB_NAME = process.env.TEST_DB_NAME || 'reelytic_test';
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.resolve(__dirname, '../../perf-results');

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
}

function saveResult(label, kind, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${label}-${kind}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

// Deterministic pseudo-random so before and after runs see identical data.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function seedBulk({ jobs = 60, rowsPerJob = 200, creators = 800, ledger = 3000, logins = 3000 } = {}) {
  const { getDb } = require('../../server/db');
  const { usernameFor } = require('../../tests/helpers/seed');
  const db = getDb();
  const owner = usernameFor('pro');
  const rand = rng(42);
  const now = Date.now();

  const campaignIds = [];
  const campaigns = [];
  for (let c = 0; c < 6; c += 1) {
    const id = `perf_campaign_${c}`;
    campaignIds.push(id);
    campaigns.push({ _id: id, name: `Campaign ${c + 1}`, avatarUrl: null, ownerUsername: owner, createdAt: new Date(now - c * 86400000), perfBulk: true });
  }
  await db.collection('campaigns').insertMany(campaigns);

  const jobDocs = [];
  for (let j = 0; j < jobs; j += 1) {
    const rows = [];
    for (let r = 0; r < rowsPerJob; r += 1) {
      const views = Math.floor(rand() * 900000) + 500;
      const likes = Math.floor(views * (0.02 + rand() * 0.08));
      const comments = Math.floor(likes * 0.05);
      rows.push({
        i: r + 1,
        state: 'done',
        input: { url: `https://www.instagram.com/reel/PERF${j}x${r}/`, original: { Creator: `@perf_user_${j}_${r}`, Brief: 'Launch film' } },
        result: {
          username: `perf_user_${(j * 7 + r) % creators}`, followers: Math.floor(rand() * 500000) + 1000,
          views, likes, comments, shares: Math.floor(likes * 0.1), reposts: 3, saves: Math.floor(likes * 0.2),
          er: Number(((likes + comments) / views * 100).toFixed(2)), profileLink: 'https://www.instagram.com/x/', name: 'Perf User',
        },
        fromCache: false,
      });
    }
    const created = new Date(now - j * 6 * 3600000);
    jobDocs.push({
      _id: `perf_job_${j}`, ownerUsername: owner, type: j % 5 === 0 ? 'profile' : 'reel', status: 'done',
      fileName: `perf-report-${j}.xlsx`, counts: { total: rowsPerJob, processed: rowsPerJob, success: rowsPerJob, failed: 0, creditsSpent: rowsPerJob },
      cursor: rowsPerJob, createdAt: created, startedAt: created, finishedAt: new Date(created.getTime() + 600000),
      campaignId: j < 30 ? campaignIds[j % 6] : null, rows, perfBulk: true,
    });
  }
  // insert in slices: one insertMany of 60 x 200-row documents is over the driver's batch limit
  for (let i = 0; i < jobDocs.length; i += 10) await db.collection('jobs').insertMany(jobDocs.slice(i, i + 10));

  const creatorDocs = [];
  for (let c = 0; c < creators; c += 1) {
    const avgEr = Number((1 + rand() * 9).toFixed(2));
    const avgViews = Math.floor(rand() * 300000);
    creatorDocs.push({
      ownerUsername: owner, username: `perf_user_${c}`, name: `Perf Creator ${c}`, followers: Math.floor(rand() * 900000),
      gender: rand() > 0.5 ? 'female' : 'male', genderSource: 'inferred',
      reel: { count: 3, totalViews: avgViews * 3, totalLikes: 1000, totalComments: 50, totalEr: avgEr * 3, avgEr, avgViews },
      profile: { count: 0, totalViews: 0, totalEr: 0, avgEr: 0, avgViews: 0 },
      timesAnalyzed: 3, bestAvgEr: avgEr, bestType: 'reel', bestAvgViews: avgViews,
      firstAnalyzedAt: new Date(now - 30 * 86400000), lastAnalyzedAt: new Date(now - c * 3600000), updatedAt: new Date(now - c * 3600000),
      jobIds: [`perf_job_${c % jobs}`], perfBulk: true,
    });
  }
  await db.collection('analyzedCreators').insertMany(creatorDocs);

  const ledgerDocs = [];
  for (let l = 0; l < ledger; l += 1) {
    ledgerDocs.push({
      username: l % 3 === 0 ? owner : usernameFor('agency'), type: l % 4 === 0 ? 'profile' : 'reel', jobId: `perf_job_${l % jobs}`,
      url: `https://www.instagram.com/reel/PERFL${l}/`, result: 'success', resolvedUsername: `perf_user_${l % creators}`,
      at: new Date(now - l * 60000), perfBulk: true,
    });
  }
  await db.collection('submittedLinks').insertMany(ledgerDocs);

  const loginDocs = [];
  for (let l = 0; l < logins; l += 1) {
    loginDocs.push({ username: l % 2 ? owner : usernameFor('free'), ip: `10.0.${l % 250}.${l % 200}`, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36', success: l % 9 !== 0, at: new Date(now - l * 90000), perfBulk: true });
  }
  await db.collection('loginHistory').insertMany(loginDocs);

  // a portal link so the public campaign endpoint can be timed
  await db.collection('campaigns').updateOne({ _id: campaignIds[0] }, { $set: { portalToken: 'perfportaltoken00000000000000000', portalViews: 0 } });
  return { owner, campaignId: campaignIds[0], portalToken: 'perfportaltoken00000000000000000' };
}

async function cleanupBulk() {
  const { getDb } = require('../../server/db');
  const db = getDb();
  for (const c of ['jobs', 'campaigns', 'analyzedCreators', 'submittedLinks', 'loginHistory']) {
    await db.collection(c).deleteMany({ perfBulk: true });
  }
}

module.exports = { median, pct, saveResult, rng, seedBulk, cleanupBulk, RESULTS_DIR };
