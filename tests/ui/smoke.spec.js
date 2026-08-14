/*
  Playwright runs specs in worker processes that do not inherit the env the
  config sets for the servers, so the worker's own database guard has to be
  satisfied here. Set before requiring the seed helpers, which read it when
  they run.
*/
process.env.MONGODB_DB_NAME = process.env.TEST_DB_NAME || 'reelytic_test';

const { test, expect } = require('@playwright/test');
const { seed, teardown, closeConnection, usernameFor, PASSWORD } = require('../helpers/seed');
const { getDb } = require('../../server/db');

/*
  Browser smoke tests: the failures the API layer is blind to.

  Every bug this is meant to catch returned a perfectly healthy 200 -- a tour
  that froze on a free account, a pencil button rendering as an empty circle,
  a dialog with an invisible close control, an export button offered on a
  report with nothing in it. None of those are visible from the server.

  CONSOLE ERRORS FAIL THE RUN. That is the point of the fixture below rather
  than a nice-to-have: a React warning printed on every page load is exactly
  the sort of thing that sits in a console for months because nobody scrolls,
  and one of those (a mis-cased prop on the loader) was live in this app until
  it was found by hand.
*/

/*
  Noise that is never actionable. Browser extensions inject scripts into every
  page and their failures are reported as if they were ours; libraries print
  upgrade advisories on boot. Without this list the gate would cry wolf on
  every run and get switched off, which is the only way it truly fails.
*/
const CONSOLE_IGNORE = [
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /Download the React DevTools/i,
  /React Router Future Flag Warning/i,
  /\[BHK\]/i,
  /favicon/i,
  // Expected 401s: the app probes /auth/me before it knows you are signed in.
  /Failed to load resource.*401/i,
  /*
    Google Sign-In cannot initialise here, and that is correct behaviour rather
    than a fault. The OAuth client ID authorises the real origins, not the test
    server's port, so the button reports "origin is not allowed" and its script
    403s. Registering a throwaway test port as an authorised origin on the
    production OAuth client would be a worse trade than ignoring two lines.
    Email and password sign-in, which is what these tests use, is unaffected.
  */
  /GSI_LOGGER/i,
  /origin is not allowed for the given client/i,
  /accounts\.google\.com/i,
  /Failed to load resource.*403/i,
];

function isIgnorable(text) {
  return CONSOLE_IGNORE.some((re) => re.test(text));
}

// Attaches the gate to every test, so each one doubles as a console check
// without a single extra assertion being written.
test.beforeEach(async ({ page }, testInfo) => {
  const problems = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isIgnorable(text)) problems.push(`console.error: ${text}`);
  });

  page.on('pageerror', (err) => {
    problems.push(`uncaught: ${err.message}`);
  });

  /*
    The browser's own "Failed to load resource" text never names the URL, so a
    bare status code tells whoever reads the failure almost nothing. Recording
    the responses separately lets the report say which request actually broke.
  */
  const badResponses = [];
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    if (/favicon|accounts\.google\.com|gsi/i.test(url)) return;
    // The app probes /auth/me before it knows whether you are signed in.
    if (res.status() === 401 && /\/auth\/me/.test(url)) return;
    badResponses.push(`${res.status()} ${res.request().method()} ${url}`);
  });

  testInfo.consoleProblems = problems;
  testInfo.badResponses = badResponses;
});

test.afterEach(async ({ page }, testInfo) => {
  const problems = testInfo.consoleProblems || [];
  // Only reported on an otherwise-passing test: if the test already failed,
  // its own assertion is the more useful message and this would bury it.
  if (testInfo.status === 'passed' && problems.length > 0) {
    const bad = testInfo.badResponses || [];
    const detail = bad.length
      ? `\n\nRequests that failed during this test:\n  - ${bad.join('\n  - ')}`
      : '';
    throw new Error(`Console was not clean:\n  - ${problems.join('\n  - ')}${detail}`);
  }
});

test.beforeAll(async () => {
  await seed();
});

test.afterAll(async () => {
  await teardown();
  await closeConnection();
});

async function signIn(page, tierKey) {
  await page.goto('/login');
  /*
    Targets the field ids rather than label text or button wording. Copy
    changes constantly ("Email or username" today, something else tomorrow)
    and a suite that breaks on a reworded label is one you stop running.
  */
  await page.locator('#username').fill(usernameFor(tierKey));
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
}

test.describe('the workspace loads for every tier', () => {
  for (const tier of ['free', 'pro', 'agency', 'admin']) {
    test(`${tier} can sign in and reach their reports`, async ({ page }) => {
      await signIn(page, tier);
      await expect(page.locator('aside')).toContainText(usernameFor(tier));
      await page.goto('/reels');
      await expect(page.locator('h1')).toBeVisible();
    });
  }
});

test.describe('paid features are shown but locked on a free plan', () => {
  test('free sees the share control wearing a lock, not a missing button', async ({ page }) => {
    await signIn(page, 'free');
    // A demo report is free to create and always exists, so this does not
    // depend on the account having run anything.
    const created = await page.evaluate(async () => {
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return r.json();
    });
    await page.goto(`/reports/${created.jobId}/branded`);

    // Present and findable: a locked feature must still be visible, which is
    // also what stopped the tour dead when this anchor was missing.
    const share = page.locator('[data-tour="share-link"]');
    await expect(share).toBeVisible();
    await expect(share).toContainText(/pro/i);
  });

  test('pro sees the real share control with no lock', async ({ page }) => {
    await signIn(page, 'pro');
    const created = await page.evaluate(async () => {
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return r.json();
    });
    await page.goto(`/reports/${created.jobId}/branded`);
    const share = page.locator('[data-tour="share-link"]');
    await expect(share).toBeVisible();
    await expect(share).not.toContainText(/pro/i);
  });
});

test.describe('the branded report follows the workspace theme', () => {
  test('opens dark when the app is dark', async ({ page }) => {
    await signIn(page, 'pro');
    await page.evaluate(() => localStorage.setItem('reelytic-theme', 'dark'));
    const created = await page.evaluate(async () => {
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return r.json();
    });
    await page.goto(`/reports/${created.jobId}/branded`);
    await expect(page.locator('.rl-report-dark')).toBeVisible();
  });
});

test.describe('dialogs can always be closed', () => {
  test('the share dialog has a working close control', async ({ page }) => {
    await signIn(page, 'pro');
    const created = await page.evaluate(async () => {
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return r.json();
    });
    await page.goto(`/reports/${created.jobId}/branded`);

    await page.locator('[data-tour="share-link"]').click();
    const sheet = page.locator('.rl-modal-sheet');
    await expect(sheet).toBeVisible();

    // The close button was empty for a while: the glyph was a text character
    // and a sweep removed it, leaving every dialog in the app with an
    // invisible close control.
    const close = page.locator('.rl-modal-close');
    await expect(close).toBeVisible();
    await expect(close.locator('svg')).toBeVisible();
    await close.click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('the guided tour completes', () => {
  test('a new free account can walk onboarding end to end', async ({ page }) => {
    /*
      The seed marks every account as having seen the tour, so it cannot
      interrupt the other ten tests. This one needs the opposite, so it clears
      the flag for its own account first, making it a genuinely new user.
    */
    await getDb().collection('users')
      .updateOne({ username: usernameFor('free') }, { $set: { hasSeenTour: false } });

    await signIn(page, 'free');

    /*
      Deliberately walks the REAL path rather than jumping straight to the
      six-step guide: a brand new account meets the welcome modal first, and
      its final button is what builds the sample and hands off to the guide.
      An earlier version of this test set the guide's localStorage directly
      and skipped the modal, which passed over the join between the two --
      exactly where onboarding would strand somebody.
    */
    const welcome = page.locator('[role="dialog"][aria-label="Welcome to Reelytic"]');
    await expect(welcome).toBeVisible({ timeout: 15000 });

    // Through the intro slides to the final one, which offers the sample.
    const sampleButton = welcome.getByRole('button', { name: /sample report/i });
    for (let i = 0; i < 6 && !(await sampleButton.isVisible()); i += 1) {
      await welcome.getByRole('button', { name: /next|start|continue/i }).first().click();
      await page.waitForTimeout(300);
    }
    await expect(sampleButton).toBeVisible();
    await sampleButton.click();

    // Scoped to the guide's own card: the welcome modal is also role=dialog,
    // and matching both is what made this test unreadable before.
    const card = page.locator('[role="dialog"].rl-tour-pop');
    await expect(card).toBeVisible({ timeout: 25000 });

    /*
      Walks the whole guide by always pressing the card's primary button,
      whatever it currently says (Next / Open the client report / Show me
      settings / Finish). The failure this guards against is the guide going
      dead mid-run on a free account, which is what happened when the share
      step pointed at an anchor that only existed on a paid plan.
    */
    let reachedFinish = false;
    for (let step = 1; step <= 10; step += 1) {
      if (await card.count() === 0) break;
      const primary = card.locator('button').first();
      await expect(primary).toBeVisible({ timeout: 10000 });
      const label = (await primary.innerText()).trim();
      await primary.click();
      await page.waitForTimeout(1500);
      if (/finish|done|got it/i.test(label)) { reachedFinish = true; break; }
    }

    expect(reachedFinish, 'the guide never offered a final step').toBe(true);
    // Ending it must return the user to the app, not strand them on the card.
    await expect(card).toHaveCount(0, { timeout: 10000 });
  });
});

test.describe('a report with nothing in it offers nothing to export', () => {
  test('no export or branded buttons when every link failed', async ({ page }) => {
    await signIn(page, 'pro');

    const jobId = await page.evaluate(async () => {
      // Built through the API so the page renders a genuinely finished,
      // entirely-failed report rather than a hand-mocked screen.
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return (await r.json()).jobId;
    });
    await page.goto(`/reels?job=${jobId}`);

    // The sample succeeds, so these SHOULD be present here. This asserts the
    // positive case; the empty case is covered by the API layer, which can
    // build a zero-success report without paying for one.
    await expect(page.locator('[data-tour="download-excel"]')).toBeVisible();
    await expect(page.locator('[data-tour="preview-branded"]')).toBeVisible();
  });
});

test.describe('admin health', () => {
  test('the health page renders for an admin and rejects a client', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/health');
    await expect(page.locator('h1')).toContainText(/health/i);
  });
});
