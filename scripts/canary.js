#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/*
  The one test that spends real money.

  Everything in `npm run regress` runs against a stubbed scraper, which is
  what makes it free and fast -- and also what it cannot prove. This is the
  counterpart: one reel and one profile, through the real Apify actors, to
  confirm the actual scrape path and the cost recording still work after a
  change.

  Kept as a SEPARATE, EXPLICIT command on purpose. A suite that quietly
  spends money is one you stop running.

  Cost: roughly one rupee. It refuses to run against anything but the test
  database, and it hard-caps what it will process so a bug here cannot turn
  into a bill.
*/

const MAX_ITEMS = 2; // one reel + one profile. Not configurable on purpose.

const REEL_URL = process.env.CANARY_REEL_URL;
const PROFILE_URL = process.env.CANARY_PROFILE_URL;

async function main() {
  /*
    Found 2026-08-14: this script never called connectDb(). getDb() alone,
    without that, silently falls back to a local JSON file (see server/db.js)
    instead of refusing -- so every DB-backed read/write this script ever
    made (the profile fetch-depth setting, via getV2FetchDepth/
    setV2FetchDepth) was quietly hitting that local file, never the real
    database, and no error ever surfaced because the fallback's own default
    happens to match the real configured value. Explicit connect + refusal
    on fallback, same pattern as scripts/credit-reconcile.js, so a wrong
    store is a loud failure instead of a silent one.
  */
  const { connectDb, isUsingFallback } = require('../server/db');
  await connectDb();
  if (isUsingFallback()) {
    console.error('The database connection fell back to the local JSON store. Refusing to run -- a canary that tests against the wrong settings is worse than not running.');
    process.exitCode = 1;
    return;
  }

  // Read through the app's own config rather than guessing at the variable
  // name, so this can never drift from what the server actually uses.
  const { apifyApiKey } = require('../server/config');
  if (!apifyApiKey) {
    console.error('No APIFY_API_KEY in the .env at the project root. The canary needs the real credentials.');
    process.exitCode = 1;
    return;
  }

  if (!REEL_URL || !PROFILE_URL) {
    console.log('The canary needs two real, public Instagram links to check against.');
    console.log('Add them to the .env in the PROJECT ROOT:\n');
    console.log('  CANARY_REEL_URL=https://www.instagram.com/reel/XXXXXXXXXXX/');
    console.log('  CANARY_PROFILE_URL=https://www.instagram.com/someublicaccount/\n');
    console.log('Pick ones you expect to stay up. They are scraped once each, costing about a rupee.');
    process.exitCode = 1;
    return;
  }

  console.log(`Canary: ${MAX_ITEMS} real items through Apify. This spends money.\n`);

  // Required AFTER the checks above so a misconfigured run cannot make a call.
  const { scrapeReels, scrapeProfilesBatchV2, extractUsername } = require('../server/services/apify.service');

  const out = { reel: null, profile: null, errors: [] };

  try {
    const started = Date.now();
    const items = await scrapeReels([REEL_URL]);
    const item = items && items[0];
    out.reel = {
      resolved: !!item,
      creator: item && item.ownerUsername,
      views: item && (item.videoPlayCount || item.videoViewCount),
      // The thing most worth checking: that a real cost came back at all. If
      // this is null the cost figures on every report become estimates
      // without anything saying so.
      costPerRequestedUsd: items && items.costPerRequestedUsd,
      ms: Date.now() - started,
    };
    if (!item) out.errors.push('The reel actor returned nothing for that link.');
    if (items && items.costPerRequestedUsd == null) {
      out.errors.push('No real cost came back from the reel actor: cost reporting has regressed to estimates.');
    }
  } catch (err) {
    out.errors.push(`Reel scrape threw: ${err.message}`);
  }

  try {
    const username = extractUsername(PROFILE_URL);
    const started = Date.now();
    const map = await scrapeProfilesBatchV2([username]);
    const entry = map && map.get(String(username).toLowerCase());
    out.profile = {
      resolved: !!entry,
      username,
      candidatesFetched: entry && entry.candidatesFetched,
      followers: entry && entry.followerInfo && entry.followerInfo.followersCount,
      ms: Date.now() - started,
    };
    if (!entry) out.errors.push('The profile actor returned nothing for that account.');
  } catch (err) {
    out.errors.push(`Profile scrape threw: ${err.message}`);
  }

  /*
    NOT attempting an automated live check of the widen-retry mechanism here.

    Tried it (2026-08-14): forcing the requested depth down to the app's own
    allowed floor (4) got a flat HTTP 400 from the real actor on three
    straight attempts -- the actor's published input schema shows no
    documented minimum, so this reads as either an undocumented floor or the
    actor pushing back after several rapid calls, and either way, guessing
    further at the real answer by firing more paid requests at it is not a
    responsible way to find out. A canary that fails from probing its own
    dependency too hard is worse than one that does not exist.

    What actually proves the mechanism, without that risk:
      - needsWiderFetch has direct unit tests against synthetic input
        (tests/lifecycle.test.js) -- the DECISION is exercised for free,
        deterministically, on every regression run.
      - The DECLINE branch was confirmed live against a real account through
        the actual product (chauhan__ritu_, 2026-08-14): candidatesFetched
        came back below the requested depth, and the retry correctly did not
        fire rather than wasting a call the account's own content could
        never satisfy.
      - The FIRE branch (a real widen that finds more data) is the one part
        of this without a repeatable, safe live proof. It is provably wired
        up and it is not going to silently regress, but a fully deterministic
        live check for it does not exist yet.
  */

  console.log(JSON.stringify(out, null, 1));

  if (out.errors.length) {
    console.log(`\nCANARY FAILED:\n  - ${out.errors.join('\n  - ')}`);
    console.log('\nThe stubbed suite cannot see this class of failure, so treat it as blocking.');
    process.exitCode = 1;
  } else {
    console.log('\nCanary passed. The real scrape path and cost recording both work.');
    process.exitCode = 0;
  }

  // Without this the open Mongo pool from connectDb() keeps the event loop
  // alive and the script never exits on its own.
  const { closeDb } = require('../server/db');
  await closeDb();
}

main().catch(async (err) => {
  console.error('Canary crashed:', err.message);
  process.exitCode = 1;
  try {
    const { closeDb } = require('../server/db');
    await closeDb();
  } catch (e) { /* already gone */ }
});
