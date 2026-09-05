const express = require('express');
const router = express.Router();
const config = require('../config');

/*
  Served dynamically from Express (not static files in client/public) for
  one reason: both read config.appUrl at REQUEST time, so pointing the app
  at a new domain (tryreelytic.com once it's bought) is a single .env change
  that takes effect on the next restart -- no rebuild, no regenerating a
  static file, no chance of the sitemap silently still advertising an old
  domain after everything else has moved.

  Only the public, unauthenticated, genuinely-worth-indexing routes are
  listed. Everything behind login (reports, settings, admin, the app shell)
  is intentionally absent -- a crawler can't do anything useful with a page
  that immediately redirects it to /login, and listing those would just
  waste crawl budget on pages that don't exist for a signed-out visitor.
*/
/*
  lastmod is the real date each route's page content last changed (pulled
  from that file's own git history at the time this was written) -- not
  "now" on every request. A sitemap's lastmod is a trust signal search
  engines use to decide how often to re-crawl a page; stamping every route
  with the current timestamp on every hit would claim everything changes
  constantly, which is false and actively hurts that signal rather than
  helping it. Bump a route's date here when that page's real content changes.
*/
const PUBLIC_ROUTES = [
  { path: '/', changefreq: 'weekly', priority: '1.0', lastmod: '2026-08-23' },
  { path: '/pricing', changefreq: 'weekly', priority: '0.8', lastmod: '2026-08-22' },
  { path: '/login', changefreq: 'monthly', priority: '0.3', lastmod: '2026-08-22' },
  { path: '/signup', changefreq: 'monthly', priority: '0.5', lastmod: '2026-08-22' },
  { path: '/terms', changefreq: 'monthly', priority: '0.2', lastmod: '2026-08-22' },
  { path: '/privacy', changefreq: 'monthly', priority: '0.2', lastmod: '2026-08-22' },
];

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      // Everything that needs a session 404s or redirects for a crawler
      // anyway; disallowing it explicitly just saves the crawl budget.
      'Disallow: /reels',
      'Disallow: /profiles',
      'Disallow: /history',
      'Disallow: /settings',
      'Disallow: /dashboard',
      'Disallow: /billing',
      'Disallow: /checkout',
      'Disallow: /admin',
      'Disallow: /reports/',
      'Disallow: /api/',
      `Sitemap: ${config.appUrl}/sitemap.xml`,
    ].join('\n')
  );
});

router.get('/sitemap.xml', (req, res) => {
  const urls = PUBLIC_ROUTES.map(({ path, changefreq, priority, lastmod }) => `
  <url>
    <loc>${config.appUrl}${path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('');

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`
  );
});

module.exports = router;
