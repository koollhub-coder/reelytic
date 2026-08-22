#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/*
  The one command you run before a deploy.

  Three layers of stubbed, free checks, then one real scrape.

  The first three touch nothing real: the test database is throwaway, the
  Apify scrapers are replaced by a stub, and no live account or report is
  read. That is what makes them fast enough to run before every deploy, and
  also what they cannot prove -- a stub always answers, so a genuinely broken
  actor or a change in Apify's response shape looks perfectly healthy.

  So the canary runs last: one real reel and one real profile, about a rupee.
  It is last on purpose. A broken build fails in the free layers and the run
  stops before spending anything.

  Prints a summary you can read in one glance, and exits non-zero if anything
  failed so it can gate a deploy script later. `npm run regress:free` skips
  the spending step.
*/

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'reelytic_test';

// A regression run must never be able to point at production, whatever is
// sitting in the shell's environment.
if (TEST_DB_NAME === 'reelytic') {
  console.error('TEST_DB_NAME is set to the production database name. Refusing to run.');
  process.exit(1);
}

const env = { ...process.env, MONGODB_DB_NAME: TEST_DB_NAME, NODE_ENV: 'test' };

const suites = [
  {
    /*
      Runs the actual `vite build` Render's Docker image runs, deliberately
      WITHOUT VITE_APP_URL -- this machine has its own client/.env with that
      var already set (gitignored, never seen by Render), so a normal local
      build always had it to lean on and never reproduced what broke the
      deploy. Every other suite here drives the app through Vite's DEV
      server (see playwright.config.js's webServer), which never runs the
      vite:build-html plugin at all -- so nothing else in this file could
      have caught a build-only failure like that one, no matter how
      thorough. This is the one suite standing in for "does this actually
      produce a deployable build," not just "does the app behave correctly
      once one exists."
    */
    name: 'BUILD: production client build (Render-clean env)',
    cmd: process.execPath,
    args: [path.resolve(__dirname, '..', 'client', 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    cwd: path.resolve(__dirname, '..', 'client'),
    // NODE_ENV=test (set below, for the API/UI suites' throwaway database)
    // must not leak into this one -- Vite's CLI only forces NODE_ENV to
    // 'production' for `build` when the var isn't already set, so
    // inheriting 'test' here silently produced an unminified, dev-shaped
    // bundle instead of the real production build Render ships.
    stripEnv: ['VITE_APP_URL', 'VITE_GOOGLE_CLIENT_ID', 'NODE_ENV'],
  },
  {
    name: 'API: entitlements, tiers, ownership',
    cmd: process.execPath,
    args: ['--test', 'tests/entitlements.test.js'],
  },
  {
    name: 'API: job lifecycle, credits, exports',
    cmd: process.execPath,
    args: ['--test', 'tests/lifecycle.test.js'],
  },
  {
    name: 'API: crash/restart recovery, billing idempotency',
    cmd: process.execPath,
    args: ['--test', 'tests/crash-recovery.test.js'],
  },
  {
    name: 'UI: browser smoke + console gate',
    // Invoked through its own CLI entry rather than `npx`, which on Windows
    // needs shell:true and then warns about unescaped arguments on every run.
    cmd: process.execPath,
    args: [require.resolve('@playwright/test/cli'), 'test'],
    // Skipped with a clear message, rather than failed, if the browser binary
    // was never installed: a missing dependency is not a regression.
    optional: true,
  },
  {
    name: 'LIVE: real scrape + cost recording',
    cmd: process.execPath,
    args: [path.resolve(__dirname, 'canary.js')],
    spends: true,
  },
];

const args = process.argv.slice(2);
// `regress:free` for a run that cannot cost anything: useful mid-change, when
// you want the fast feedback without a scrape on every save.
const noSpend = args.includes('--no-spend');
const only = args.find((a) => !a.startsWith('--'));
const results = [];

for (const suite of suites) {
  if (only && !suite.name.toLowerCase().includes(only.toLowerCase())) continue;
  if (suite.spends && noSpend) {
    results.push({ name: suite.name, ok: true, skipped: true, seconds: '0.0', reason: 'skipped: --no-spend' });
    continue;
  }

  process.stdout.write(`\n──────── ${suite.name}\n`);
  const started = Date.now();
  const suiteEnv = { ...env };
  if (suite.stripEnv) {
    for (const key of suite.stripEnv) delete suiteEnv[key];
  }
  const run = spawnSync(suite.cmd, suite.args, { env: suiteEnv, stdio: 'inherit', shell: !!suite.shell, cwd: suite.cwd });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const missingBrowser = suite.optional && run.status !== 0 && run.status !== 1;
  results.push({
    name: suite.name,
    ok: run.status === 0,
    skipped: missingBrowser,
    reason: missingBrowser ? 'skipped: browser not installed' : '',
    seconds,
  });
}

const line = '═'.repeat(58);
console.log(`\n${line}\n REGRESSION SUMMARY\n${line}`);
for (const r of results) {
  const badge = r.skipped ? 'SKIP' : (r.ok ? 'PASS' : 'FAIL');
  const tail = r.skipped ? (r.reason || '') : `${r.seconds}s`;
  console.log(` ${badge.padEnd(5)} ${r.name.padEnd(40)} ${tail}`);
}

const failed = results.filter((r) => !r.ok && !r.skipped);
const skipped = results.filter((r) => r.skipped);

// Each skip explains itself. A generic "something was skipped, try installing
// chromium" is worse than silence when the real reason was --no-spend.
if (skipped.some((r) => r.reason.includes('browser not installed'))) {
  console.log('\n The browser suite needs its browser installed once:');
  console.log('   npx playwright install chromium');
}

if (failed.length === 0) {
  const spent = results.some((r) => r.name.startsWith('LIVE') && !r.skipped);
  console.log(`\n All good. Nothing touched production.`);
  console.log(spent
    ? ' The live scrape ran: about a rupee spent, and the real Apify path works.'
    : ' The live scrape was skipped, so nothing was spent and the real Apify path is unproven.');
  console.log(' Before deploying, remember the manual checks: mobile at 390px, a dark/light pass,');
  console.log(' and the branded report print output.\n');
  process.exitCode = 0;
} else {
  console.log(`\n ${failed.length} suite(s) failed. Do not deploy until these are green.\n`);
  process.exitCode = 1;
}
