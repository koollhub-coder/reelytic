// Runs after `vite build`. Renders the landing page to real HTML and writes dist/landing.html:
// index.html with the finished page already inside #root, its stylesheet linked, and the
// loading splash removed (there is nothing left to wait for). The server sends this file for "/"
// and index.html for every other page (see server/middleware/clientStatic.js).
//
// Why: an ordinary single-page app shows nothing until its JavaScript has downloaded, parsed and
// run. For the one page every new visitor sees first, that is the slowest possible way to start.
// With the page prerendered the browser paints it as soon as the HTML, the stylesheet and a font
// have arrived; React then hydrates the markup in place (src/main.jsx).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(clientDir, 'dist');
const indexPath = path.join(dist, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('[prerender] dist/index.html not found. Run vite build first.');
  process.exit(1);
}

// The browser globals the app touches while rendering (never in an effect), so it can render in Node.
const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = store;
globalThis.sessionStorage = store;
globalThis.window = globalThis;
globalThis.window.location = { pathname: '/', search: '', hash: '', href: 'https://reelytic.invalid/', origin: 'https://reelytic.invalid' };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
globalThis.document = { documentElement: { setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} };

const vite = await createServer({
  root: clientDir,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  ssr: { noExternal: [] },
});

let markup;
try {
  const mod = await vite.ssrLoadModule('/src/prerender.jsx');
  markup = await mod.renderLandingHtml();
} finally {
  await vite.close();
}

if (!markup || !markup.includes('landing-hero') || markup.includes('Loading...')) {
  console.error('[prerender] The rendered page does not look like the landing page. Not writing landing.html.');
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// The stylesheet for the landing page normally arrives with its JavaScript chunk. Here the page is
// visible before that chunk runs, so link it in the head. Found from the route map that
// vite.config.js wrote into index.html.
const mapMatch = html.match(/var m=(\{.*?\});var r=m\[location\.pathname\]/s);
let landingCss = [];
if (mapMatch) {
  try { landingCss = (JSON.parse(mapMatch[1])['/'] || {}).css || []; } catch (e) { landingCss = []; }
}
// Critical CSS goes INLINE. A linked stylesheet is one more round trip before anything can be
// painted (on a slow phone connection that is the whole difference), so the styles the page needs
// are part of the HTML itself. The same files are still linked afterwards, without blocking, so
// the rest of the app finds them in cache when someone navigates on from here.
const mainLink = html.match(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/);
const cssHrefs = [mainLink && mainLink[1], ...landingCss.map((f) => '/' + f)].filter(Boolean);
const inlineCss = cssHrefs.map((href) => fs.readFileSync(path.join(dist, href.replace(/^\//, '')), 'utf8')).join('\n');
if (mainLink) html = html.replace(mainLink[0], '');
const asyncLinks = cssHrefs.map((href) => `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">`).join('\n    ');
html = html.replace('</head>', `    <style>${inlineCss}</style>\n    ${asyncLinks}\n  </head>`);
// The bundle is not needed to paint this page any more, only to make it interactive, so it must not
// compete with the HTML, styles and fonts for a slow connection's bandwidth.
html = html.replace('<script type="module" crossorigin src=', '<script type="module" crossorigin fetchpriority="low" src=');

// No splash: the page is already there.
html = html.replace(/<div id="app-splash">[\s\S]*?(?=<div id="root">)/, '');
if (html.includes('id="app-splash"')) {
  console.error('[prerender] Could not remove the splash from the page. Not writing landing.html.');
  process.exit(1);
}

html = html.replace('<div id="root"></div>', `<div id="root" data-prerendered="landing">${markup}</div>`);
if (!html.includes('data-prerendered="landing"')) {
  console.error('[prerender] Could not place the page inside #root.');
  process.exit(1);
}

fs.writeFileSync(path.join(dist, 'landing.html'), html);
console.log(`[prerender] dist/landing.html written (${(html.length / 1024).toFixed(0)} KB, page markup ${(markup.length / 1024).toFixed(0)} KB)`);
process.exit(0);
