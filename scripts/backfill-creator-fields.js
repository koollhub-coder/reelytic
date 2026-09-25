/*
  One-time backfill for the fields the Creators screen now sorts and filters
  on: reel.avgViews / profile.avgViews / bestType / bestAvgViews, and an
  estimated gender (see server/services/gender.service.js).

  Additive only: it sets fields that did not exist before and never touches a
  gender someone set by hand (genderSource 'manual'). Safe to run more than
  once. Run with:  node scripts/backfill-creator-fields.js
*/
require('dotenv').config();
const { connectDb, getDb, closeDb } = require('../server/db');
const { inferGender } = require('../server/services/gender.service');
const { BEST_TYPE_EXPR, BEST_VIEWS_EXPR } = require('../server/services/creatorDb.service');

(async () => {
  await connectDb();
  const coll = getDb().collection('analyzedCreators');

  // Derived numbers, recomputed from the raw totals already on every row.
  await coll.updateMany({}, [
    {
      $set: {
        'reel.avgViews': { $cond: [{ $gt: ['$reel.count', 0] }, { $round: [{ $divide: ['$reel.totalViews', '$reel.count'] }, 0] }, 0] },
        'profile.avgViews': { $cond: [{ $gt: ['$profile.count', 0] }, { $round: [{ $divide: ['$profile.totalViews', '$profile.count'] }, 0] }, 0] },
      },
    },
    { $set: { bestType: BEST_TYPE_EXPR } },
    { $set: { bestAvgViews: BEST_VIEWS_EXPR } },
  ]);

  // Gender, estimated from the name. Manual values are left alone.
  const rows = await coll.find({}, { projection: { name: 1, username: 1, genderSource: 1 } }).toArray();
  const ops = [];
  let female = 0;
  let male = 0;
  for (const r of rows) {
    if (r.genderSource === 'manual') continue;
    const g = inferGender({ name: r.name, username: r.username });
    if (!g) continue;
    if (g === 'female') female += 1; else male += 1;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { gender: g, genderSource: 'inferred' } } } });
  }
  if (ops.length) await coll.bulkWrite(ops);

  console.log(JSON.stringify({ creators: rows.length, female, male, unknown: rows.length - female - male }));
  await closeDb();
})().catch((e) => { console.error(e); process.exit(1); });
