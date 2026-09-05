const { spawn } = require('child_process');
const path = require('path');
const { TEST_DB_NAME } = require('./env');

/*
  Runs the real server against the test database.

  Deliberately the actual server process, started the way production starts
  it, rather than the Express app imported into the test process. Session
  middleware, the Mongo-backed session store, the route ordering, the error
  handler and the static fallback are all things that have broken before and
  none of them are exercised by calling route handlers directly. If the suite
  says the app works, it should mean the app, not a convincing model of it.

  The trade is a couple of seconds of startup, which is worth paying once.
*/

const TEST_PORT = Number(process.env.TEST_PORT || 3457);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const STARTUP_TIMEOUT_MS = 25000;

let child = null;

async function waitForReady() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Any routed response means Express is up and listening. A 401 from an
      // authenticated endpoint is a perfectly good readiness signal.
      const res = await fetch(`${BASE_URL}/api/auth/me`);
      if (res.status > 0) return true;
    } catch (e) {
      // connection refused while it boots
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Test server did not become ready on ${BASE_URL} within ${STARTUP_TIMEOUT_MS}ms`);
}

async function startServer({ silent = true } = {}) {
  if (child) return BASE_URL;

  child = spawn(process.execPath, [path.resolve(__dirname, '..', '..', 'server', 'index.js')], {
    env: {
      ...process.env,
      // The guard in env.js protects the test process; this is what protects
      // the SERVER process, which has its own connection.
      MONGODB_DB_NAME: TEST_DB_NAME,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      // Alerting must never fire from a test run. Blanking the credentials is
      // more reliable than remembering to guard every call site.
      SLACK_WEBHOOK_URL: '',
      RESEND_API_KEY: '',
      // Swaps the Apify scrapers for the deterministic stub, so the job
      // lifecycle can be exercised without spending anything. Refused
      // outright if NODE_ENV were production; see apify.service.js.
      REELYTIC_SCRAPER_STUB: require('path').resolve(__dirname, 'scraperStub.js'),
      // Same idea for outgoing email -- swaps mailer.service.js's Resend
      // call for a capture-only stub, so signup/OTP/forgot-password can be
      // driven through their real routes without a live inbox. See
      // mailerStub.js for why it needs its own port rather than being read
      // back via a plain require.
      REELYTIC_MAILER_STUB: require('path').resolve(__dirname, 'mailerStub.js'),
      REELYTIC_MAILER_STUB_PORT: String(process.env.REELYTIC_MAILER_STUB_PORT || 3458),
    },
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (silent) {
    // Captured rather than discarded: if startup fails, this is the only
    // explanation available.
    child.stdout.on('data', (d) => { lastOutput += d.toString(); });
    child.stderr.on('data', (d) => { lastOutput += d.toString(); });
  }

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[test server] exited with code ${code}\n${lastOutput.slice(-2000)}`);
    }
    child = null;
  });

  try {
    await waitForReady();
  } catch (err) {
    throw new Error(`${err.message}\n--- server output ---\n${lastOutput.slice(-2000)}`);
  }
  return BASE_URL;
}

let lastOutput = '';

async function stopServer() {
  if (!child) return;
  const proc = child;
  child = null;
  proc.kill();
  // Give it a moment to release the port so a re-run does not collide.
  await new Promise((r) => setTimeout(r, 250));
}

module.exports = { startServer, stopServer, BASE_URL, TEST_PORT };
