/*
  The visual audit. NOT part of the normal regression run: it is a sweep, run
  on purpose (`npm run audit:ui`), that opens every page a client (and an
  admin) can reach at desktop and phone width, in light and dark, and:

    - saves a full-page screenshot of each one, to look at
    - fails on any text that leaves its box (tests/helpers/overflow.js)
    - fails on any page that scrolls sideways

  Screenshots land in AUDIT_DIR (default: ./audit-shots, git-ignored).
*/
process.env.MONGODB_DB_NAME = process.env.TEST_DB_NAME || 'reelytic_test';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { seed, teardown, closeConnection, usernameFor, PASSWORD } = require('../helpers/seed');
const { findOverflow } = require('../helpers/overflow');
const { getDb } = require('../../server/db');

const RUN = !!process.env.AUDIT_UI;
const OUT = process.env.AUDIT_DIR || path.resolve(__dirname, '../../audit-shots');

test.skip(!RUN, 'visual audit only runs with AUDIT_UI=1 (npm run audit:ui)');
test.describe.configure({ mode: 'serial' });

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];
const THEMES = ['dark', 'light'];

test.beforeAll(async () => {
  if (!RUN) return;
  fs.mkdirSync(OUT, { recursive: true });
  await seed();
});
test.afterAll(async () => {
  if (!RUN) return;
  await teardown();
  await closeConnection();
});

async function signIn(page, tier) {
  await page.goto('/login');
  await page.locator('#username').fill(usernameFor(tier));
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
}

const api = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}, { method, url, body });

async function sweep(page, label, urlPath, { vp, theme, wait = 1800, before } = {}) {
  await page.goto(urlPath);
  await page.evaluate((t) => localStorage.setItem('reelytic-theme', t), theme);
  await page.reload();
  await page.waitForTimeout(wait);
  if (before) await before(page);
  const file = path.join(OUT, `${label}-${vp.name}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(findOverflow);
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  return { label: `${label} (${vp.name}, ${theme})`, overflow, sideways: sw > w + 1 ? `${sw}px in a ${w}px window` : null };
}

test('every page, both widths, both themes', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  const problems = [];
  const note = (r) => {
    if (r.overflow.length) problems.push(`${r.label}: ${r.overflow.slice(0, 6).join(' | ')}`);
    if (r.sideways) problems.push(`${r.label}: page scrolls sideways, ${r.sideways}`);
  };

  // public pages first, signed out
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of THEMES) {
      for (const [label, p] of [['landing', '/'], ['login', '/login'], ['signup', '/signup'], ['pricing-public', '/pricing'], ['terms', '/terms']]) {
        note(await sweep(page, label, p, { vp, theme, wait: 2200 }));
      }
    }
  }

  // a signed-in workspace with real-looking content: several reports in a campaign, with a portal link
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'pro');
  const jobs = [];
  for (let i = 0; i < 3; i += 1) jobs.push((await api(page, 'POST', '/api/jobs/demo')).jobId);
  const campaign = await api(page, 'POST', '/api/campaigns', { name: 'Summer launch with a fairly long campaign name' });
  // the demo endpoint returns the same report each time, so make two more real ones by copying it
  {
    const db = getDb();
    const base = await db.collection('jobs').findOne({ ownerUsername: usernameFor('pro') });
    for (let i = 1; i <= 2; i += 1) {
      const { _id, ...rest } = base;
      await db.collection('jobs').insertOne({ ...rest, fileName: i === 1 ? 'week-2-creators.xlsx' : 'story-reshares-with-a-very-long-file-name-for-testing.xlsx', createdAt: new Date(Date.now() - i * 86400000 * 3) });
    }
  }
  const cid = campaign.campaign && campaign.campaign.id;
  for (const j of jobs) await api(page, 'PATCH', `/api/jobs/${j}/campaign`, { campaignId: cid });
  await getDb().collection('jobs').updateMany({ ownerUsername: usernameFor('pro'), 'rows.0': { $exists: true } }, { $set: { campaignId: cid } });
  const portal = await api(page, 'POST', `/api/campaigns/${cid}/portal`);
  const token = portal.portalToken;

  const clientPages = [
    ['dashboard', '/dashboard'],
    ['reels-upload', '/reels'],
    ['profiles-upload', '/profiles'],
    ['reels-done', `/reels?job=${jobs[0]}`],
    ['history', '/history'],
    ['creators', '/creators'],
    ['settings', '/settings'],
    ['pricing', '/pricing'],
    ['how-it-works', '/how-it-works'],
    ['branded', `/reports/${jobs[0]}/branded`],
    ['not-found', '/no-such-page'],
  ];
  if (token) clientPages.push(['portal', `/portal/${token}`]);
  else problems.push(`could not create a portal link to audit: campaign=${JSON.stringify(campaign)} portal=${JSON.stringify(portal)}`);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of THEMES) {
      for (const [label, p] of clientPages) note(await sweep(page, label, p, { vp, theme }));
    }
  }

  // admin
  await page.context().clearCookies();
  await signIn(page, 'admin');
  const adminPages = ['dashboard', 'clients', 'usage', 'cost-monitor', 'scan-settings', 'ledger', 'sessions', 'help', 'health', 'pricing'];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of THEMES) {
      for (const p of adminPages) note(await sweep(page, `admin-${p}`, `/admin/${p}`, { vp, theme, wait: p === 'usage' ? 9000 : 3500 }));
    }
  }

  fs.writeFileSync(path.join(OUT, 'problems.txt'), problems.join('\n') || 'none');
  expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
});
