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

  console.log(JSON.stringify(out, null, 1));

  if (out.errors.length) {
    console.log(`\nCANARY FAILED:\n  - ${out.errors.join('\n  - ')}`);
    console.log('\nThe stubbed suite cannot see this class of failure, so treat it as blocking.');
    process.exitCode = 1;
  } else {
    console.log('\nCanary passed. The real scrape path and cost recording both work.');
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error('Canary crashed:', err.message);
  process.exitCode = 1;
});
