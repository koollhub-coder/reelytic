const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'reelytic_test';
const API_PORT = 3458;
const WEB_PORT = 5199;

/*
  Browser-level smoke tests.

  Deliberately SMALL. Around fifteen checks, not a hundred and fifty. UI tests
  are the most brittle kind that exist, and a large suite that fails for
  cosmetic reasons is one you stop running -- which is worse than not having
  it. Everything here is anchored to data-tour / data-testid attributes rather
  than to visible text or CSS classes, so rewording a button or restyling a
  page can never fail a test, while a genuinely broken flow always does.

  Its real job is the class of bug the API layer cannot see: a screen that
  crashes, a control that is missing for a tier that should have it, an empty
  state offering an export of nothing, and console errors nobody noticed.

  Both servers are started and stopped by Playwright itself, so `npm run
  regress` works from a cold terminal with nothing already running.
*/
module.exports = defineConfig({
  testDir: './tests/ui',
  // Serial: these share one seeded database, and parallel workers would fight
  // over the same accounts and reports.
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: process.env.CI ? 'list' : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    // Kept only for failures, so a green run leaves nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
  },

  webServer: [
    {
      // The API, pointed at the test database and the stubbed scraper, so a
      // UI run cannot touch real data or spend money either.
      command: 'node server/index.js',
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 40000,
      env: {
        ...process.env,
        MONGODB_DB_NAME: TEST_DB_NAME,
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        SLACK_WEBHOOK_URL: '',
        RESEND_API_KEY: '',
        REELYTIC_SCRAPER_STUB: path.resolve(__dirname, 'tests', 'helpers', 'scraperStub.js'),
      },
    },
    {
      // Vite dev server, proxying /api at the test API rather than the real one.
      // --host 127.0.0.1 is required: Vite otherwise binds "localhost",
      // which resolves to ::1 on Windows, while Playwright polls 127.0.0.1
      // and reports the server as never ready.
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      cwd: path.resolve(__dirname, 'client'),
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 60000,
      env: { ...process.env, VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
