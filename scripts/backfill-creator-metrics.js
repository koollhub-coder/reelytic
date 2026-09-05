#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/*
  One-time migration: populates reel.avgEr / profile.avgEr / timesAnalyzed /
  bestAvgEr on every analyzedCreators row that predates the filter bar (see
  creatorDb.service.js) -- rows recorded before this shipped only have the
  raw totals (reel.totalEr, reel.count, ...), not the derived fields the
  new sort/filter options query on. Recomputes them straight from those
  already-stored totals with the exact same pipeline expressions
  recordAnalyzedCreator now runs on every write, so this can never drift
  from what live writes compute.

  Doesn't touch jobs or re-derive anything from report history -- purely a
  read-and-recompute over analyzedCreators itself, so it's safe to re-run
  any time (idempotent: recomputing the same totals twice gives the same
  averages) and fast regardless of collection size.
*/

const { connectDb, getDb, closeDb } = require('../server/db');

async function run() {
  await connectDb();
  const db = getDb();

  const result = await db.collection('analyzedCreators').updateMany({}, [
    {
      $set: {
        'reel.count': { $ifNull: ['$reel.count', 0] },
        'reel.totalEr': { $ifNull: ['$reel.totalEr', 0] },
        'profile.count': { $ifNull: ['$profile.count', 0] },
        'profile.totalEr': { $ifNull: ['$profile.totalEr', 0] },
      },
    },
    {
      $set: {
        'reel.avgEr': { $cond: [{ $gt: ['$reel.count', 0] }, { $round: [{ $divide: ['$reel.totalEr', '$reel.count'] }, 2] }, 0] },
        'profile.avgEr': { $cond: [{ $gt: ['$profile.count', 0] }, { $round: [{ $divide: ['$profile.totalEr', '$profile.count'] }, 2] }, 0] },
        timesAnalyzed: { $add: ['$reel.count', '$profile.count'] },
      },
    },
    { $set: { bestAvgEr: { $max: ['$reel.avgEr', '$profile.avgEr'] } } },
  ]);

  console.log(`Done. Matched ${result.matchedCount} creator rows, modified ${result.modifiedCount}.`);
  await closeDb();
}

run().catch((err) => {
  console.error('[Backfill Error]', err);
  process.exit(1);
});
