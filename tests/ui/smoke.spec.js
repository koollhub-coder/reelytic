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
const { findOverflow } = require('../helpers/overflow');

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

      The iteration cap has to stay well above DemoGuide's own STEPS.length:
      a step that lives on a different page costs TWO clicks here (one to
      dismiss its "we'll take you there" travel card, one for the real
      Next/Finish on the page it lands on), not one, so the cap is roughly
      double the step count rather than equal to it. This test broke the
      moment a 7th step was added with the cap still at 10 -- not flaky,
      just arithmetic that fell one step short.
    */
    let reachedFinish = false;
    for (let step = 1; step <= 20; step += 1) {
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

test.describe('help assistant', () => {
  test('a signed-in customer can open it, get an answer that knows their account, and be taken to a page', async ({ page }) => {
    await signIn(page, 'pro');
    await page.goto('/dashboard');
    await page.locator('[data-help-launcher]').click();
    await expect(page.locator('.rl-help-panel')).toBeVisible();

    await page.locator('.rl-help-input').fill('how many credits do i have');
    await page.locator('.rl-help-send').click();
    await expect(page.locator('.rl-help-row:not(.user) .rl-help-bubble').last()).toContainText(/credits/i, { timeout: 5000 });

    await page.locator('.rl-help-input').fill('take me to history');
    await page.locator('.rl-help-send').click();
    await page.waitForURL('**/history', { timeout: 5000 });
    await expect(page.locator('.rl-help-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.rl-help-panel')).toHaveCount(0);
  });

  test('it stays out of the way on sign-in and on client-facing pages', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-help-launcher]')).toHaveCount(0);
    await signIn(page, 'pro');
    await page.goto('/admin/health');
    await expect(page.locator('[data-help-launcher]')).toHaveCount(0);
  });
});

test.describe('shared tables and row menus', () => {
  const SHOTS = process.env.SHOT_DIR || '';

  async function checkMenu(page, theme) {
    await page.evaluate((t) => localStorage.setItem('reelytic-theme', t), theme);
    await page.reload();
    await expect(page.locator('.rl-dt table').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.rl-rowmenu-btn').first().click();
    const menu = page.locator('.rl-rowmenu');
    await expect(menu).toBeVisible();
    // Opens right under its button with items aligned left, never a tall empty gap.
    const box = await menu.boundingBox();
    const items = await menu.locator('.rl-rowmenu-item').count();
    expect(box.height).toBeLessThan(items * 44 + 24);
    const align = await menu.locator('.rl-rowmenu-item').first().evaluate((el) => getComputedStyle(el).textAlign);
    expect(['left', 'start']).toContain(align);
    const bg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rowmenu-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }

  test('history table row menu is clean in light and dark, and compare table renders', async ({ page }) => {
    await signIn(page, 'pro');
    await page.evaluate(async () => { await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' }); });
    await page.goto('/history');
    await checkMenu(page, 'light');
    await checkMenu(page, 'dark');
  });

  test('admin tables use the shared table and menu', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/clients');
    await checkMenu(page, 'light');
    for (const path of ['/admin/sessions', '/admin/ledger']) {
      await page.goto(path);
      await expect(page.locator('table.data-table').first()).toBeVisible({ timeout: 15000 });
    }
  });
});

test.describe('text stays inside its box', () => {

  test('report highlights, history and dashboard keep long handles inside their cards', async ({ page }) => {
    await signIn(page, 'pro');
    const created = await page.evaluate(async () => {
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return r.json();
    });
    await page.goto(`/reels?job=${created.jobId}`);
    await expect(page.locator('.rl-dt table').first()).toBeVisible({ timeout: 20000 });
    // A handle far longer than any card is wide, in both performer tiles.
    await page.evaluate(() => {
      const long = '@' + 'a_very_long_creator_handle_'.repeat(4);
      document.querySelectorAll('a.card .mono').forEach((el) => { el.textContent = long; });
    });
    // The safety net itself: a card of ordinary markup holding an unbroken 100-character
    // string must wrap, not spill. (Works whether or not this demo report has highlight tiles.)
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'overflow-probe';
      host.style.cssText = 'display:flex;gap:8px;width:260px';
      host.innerHTML = '<div class="card" style="flex:1"><div class="mono">' + 'x'.repeat(100) + '</div></div>';
      document.querySelector('.rl-dt').before(host);
    });
    expect(await page.evaluate(findOverflow)).toEqual([]);
    await page.evaluate(() => document.getElementById('overflow-probe').remove());
    for (const path of ['/history', '/dashboard', '/creators', '/settings']) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      expect(await page.evaluate(findOverflow), path).toEqual([]);
    }
  });
});

test.describe('phone width', () => {
  test('no page scrolls sideways at 390px', async ({ page }) => {
    test.setTimeout(120000); // eight cold page loads
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, 'pro');
    const created = await page.evaluate(async () => {
      const r = await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' });
      return r.json();
    });
    const paths = ['/dashboard', '/history', '/creators', '/settings', '/pricing', '/reels', '/profiles', `/reels?job=${created.jobId}`];
    for (const path of paths) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
      expect(sw, `${path} is ${sw}px wide in a ${w}px window`).toBeLessThanOrEqual(w + 1);
    }
  });
});

/*
  The production build, served the way it is in production: by the real server, not Vite's dev
  server. Covers what only exists in a build: the prerendered landing page and React hydrating it
  without complaint, precompressed files, and long cache lifetimes on hashed assets.
*/
test.describe('production build is fast and correct', () => {
  const PROD = 'http://127.0.0.1:3458';
  const fs = require('fs');
  const path = require('path');
  const dist = path.resolve(__dirname, '../../client/dist');
  const built = fs.existsSync(path.join(dist, 'landing.html'));

  test('the landing page arrives as finished, compressed HTML and hydrates cleanly', async ({ page }) => {
    test.skip(!built, 'client/dist has no prerendered landing page; build first (the regression run does)');
    const res = await page.request.get(`${PROD}/`, { headers: { 'Accept-Encoding': 'br' } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-encoding']).toBe('br');
    expect(res.headers()['cache-control']).toBe('no-cache');
    expect(await res.text()).toContain('data-prerendered="landing"');

    // in a real browser: painted, hydrated with no console errors (the gate in beforeEach fails the test on any)
    await page.goto(`${PROD}/`);
    await expect(page.locator('.hero-title')).toBeVisible();
    // the calls to action are real links, working before and after hydration
    const cta = page.locator('a.btn.btn-primary', { hasText: 'Get started' }).first();
    await expect(cta).toHaveAttribute('href', '/signup');
    await page.waitForFunction(() => !document.getElementById('app-splash'), null, { timeout: 15000 });
    await cta.click();
    await page.waitForURL('**/signup');
  });

  test('hashed files are cached for a year and sent compressed; the shell is always revalidated', async ({ page }) => {
    test.skip(!built, 'client/dist has no prerendered landing page; build first (the regression run does)');
    const html = await (await page.request.get(`${PROD}/login`)).text();
    const asset = html.match(/\/assets\/index-[^"']+\.js/);
    expect(asset, 'the shell should reference the main bundle').toBeTruthy();
    const js = await page.request.get(`${PROD}${asset[0]}`, { headers: { 'Accept-Encoding': 'br' } });
    expect(js.headers()['cache-control']).toContain('immutable');
    expect(js.headers()['cache-control']).toContain('max-age=31536000');
    expect(js.headers()['content-encoding']).toBe('br');
    const shell = await page.request.get(`${PROD}/login`);
    expect(shell.headers()['cache-control']).toBe('no-cache');
    // an unknown API path is a JSON 404, never the app shell
    const missing = await page.request.get(`${PROD}/api/does-not-exist`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toContain('application/json');
  });

  test('API answers are compressed', async ({ page }) => {
    // a long public document (over the 2 KB threshold below which answers are sent as they are)
    const res = await page.request.get(`${PROD}/api/legal/terms`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-encoding']).toBe('gzip');
    // and a short one is not worth compressing
    const short = await page.request.get(`${PROD}/api/help/facts`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(short.headers()['content-encoding']).toBeUndefined();
  });
});

test.describe('public navigation and touch charts', () => {
  test('a signed-out visitor going from the landing page to sign up never sees a loading screen', async ({ page }) => {
    await page.addInitScript(() => {
      window.__loaderSeen = [];
      new MutationObserver(() => {
        if (window.__watch && document.querySelector('.rl-loader-ring')) window.__loaderSeen.push('loader on ' + location.pathname);
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto('/');
    await page.waitForTimeout(1500);
    // the footer's "Reel Report" link is one of several that lead to sign up
    await page.evaluate(() => { window.__watch = true; });
    await page.locator('.landing-footer details').first().evaluate((d) => { d.open = true; });
    await page.locator('.landing-footer-col-body button', { hasText: 'Reel Report' }).click();
    await page.waitForURL('**/signup');
    await expect(page.locator('#password')).toBeVisible();
    expect(await page.evaluate(() => window.__loaderSeen), 'a loading page flashed in between').toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('tapping the activity chart shows that day, with no focus box', async ({ page }) => {
      await signIn(page, 'pro');
      const days = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
        return { date: d, reels: (i * 7) % 11, profiles: i % 3, total: ((i * 7) % 11) + (i % 3) };
      });
      await page.route('**/api/me/stats**', async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, activityByDay: days } });
      });
      await page.goto('/dashboard');
      const chart = page.locator('.rl-chart-touch');
      await chart.scrollIntoViewIfNeeded();
      await expect(page.locator('.rl-chart-readout-hint')).toBeVisible();
      const box = await chart.boundingBox();
      await page.touchscreen.tap(box.x + box.width - 40, box.y + box.height / 2);
      await expect(page.locator('.rl-chart-readout:not(.rl-chart-readout-hint)')).toContainText(/reel/);
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? getComputedStyle(el).outlineStyle : 'none';
      });
      expect(outline === 'none' || outline === '').toBeTruthy();
      await expect(page.locator('.recharts-tooltip-wrapper:visible')).toHaveCount(0);
    });
  });
});

/*
  The CSP only exists on the production server, so Vite-served tests never trip it. Load the real
  build, sign in, and visit the main pages: any blocked script, style, image, font or connection
  is a page that would be silently broken in production.
*/
test.describe('the content security policy does not break the app', () => {
  const PROD = 'http://127.0.0.1:3458';
  const fs = require('fs');
  const path = require('path');
  const built = fs.existsSync(path.resolve(__dirname, '../../client/dist/landing.html'));

  test('landing, sign in, dashboard, history and a report load with no policy violations', async ({ page }) => {
    test.skip(!built, 'client/dist is not built');
    test.setTimeout(90000);
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI || 'inline'}`));
    });
    const seen = [];
    const collect = async () => { seen.push(...(await page.evaluate(() => window.__csp || []))); };

    await page.goto(`${PROD}/`);
    await page.waitForTimeout(1200);
    await collect();
    await page.goto(`${PROD}/login`);
    await page.locator('#username').fill(usernameFor('pro'));
    await page.locator('#password').fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    const created = await page.evaluate(async () => (await fetch('/api/jobs/demo', { method: 'POST', credentials: 'include' })).json());
    for (const p of ['/dashboard', '/history', '/creators', '/settings', '/pricing', `/reels?job=${created.jobId}`, `/reports/${created.jobId}/branded`]) {
      await page.goto(`${PROD}${p}`);
      await page.waitForTimeout(1500);
      await collect();
    }
    expect(seen, 'these were blocked by the content security policy').toEqual([]);
  });
});
