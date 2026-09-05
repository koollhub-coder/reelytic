#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/*
  One-time backfill: populates the creator database (analyzedCreators, see
  creatorDb.service.js) from every job that already exists, so the feature
  launches with an account's real history already in it instead of only
  filling in from the day it shipped.

  Reads straight from jobs.rows[].result rather than submittedLinks --
  that's the ledger's own flattened metrics snapshot and is missing name/
  profileLink for older rows, while a job document's own row still carries
  the full result object jobEngine originally computed. Uses the exact
  same recordAnalyzedCreator() the live pipeline calls per successful row,
  so there is only ever one place this grouping logic lives and this
  script cannot silently drift from what real-time processing does.

  Safe to re-run: recordAnalyzedCreator's totals are additive ($inc), so
  running this twice would double-count every row. Guarded by a marker in
  `settings` so a second run refuses outright instead of quietly corrupting
  the averages -- delete that settings row first if a genuine re-backfill
  is ever actually needed (e.g. after wiping analyzedCreators on purpose).
*/

const { connectDb, getDb, closeDb } = require('../server/db');
const { recordAnalyzedCreator } = require('../server/services/creatorDb.service');

const MARKER_KEY = 'analyzedCreatorsBackfillDone';

async function run() {
  await connectDb();
  const db = getDb();

  const marker = await db.collection('settings').findOne({ key: MARKER_KEY });
  if (marker) {
    console.log(`Already backfilled at ${marker.at}. Delete the "${MARKER_KEY}" settings row first if you really mean to run this again.`);
    await closeDb();
    return;
  }

  const cursor = db.collection('jobs').find(
    {},
    { projection: { ownerUsername: 1, type: 1, rows: 1 } }
  );

  let jobsSeen = 0;
  let rowsRecorded = 0;

  while (await cursor.hasNext()) {
    const job = await cursor.next();
    jobsSeen += 1;
    if (!job.ownerUsername || !Array.isArray(job.rows)) continue;

    for (const row of job.rows) {
      if (row.state !== 'done' || !row.result || !row.result.username) continue;
      await recordAnalyzedCreator({
        ownerUsername: job.ownerUsername,
        type: job.type,
        jobId: String(job._id),
        result: row.result,
      });
      rowsRecorded += 1;
    }

    if (jobsSeen % 500 === 0) console.log(`...${jobsSeen} jobs scanned, ${rowsRecorded} rows recorded so far`);
  }

  await db.collection('settings').updateOne(
    { key: MARKER_KEY },
    { $set: { key: MARKER_KEY, at: new Date(), jobsSeen, rowsRecorded } },
    { upsert: true }
  );

  console.log(`Done. ${jobsSeen} jobs scanned, ${rowsRecorded} rows recorded into analyzedCreators.`);
  await closeDb();
}

run().catch((err) => {
  console.error('[Backfill Error]', err);
  process.exit(1);
});
