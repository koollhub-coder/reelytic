const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/*
  Response headers and request checks that protect every page and API call.

  Hand-rolled rather than pulled in from helmet: the app already set its own
  headers here, the list is short, and the one part that needs care (the CSP
  hashes for the inline scripts in index.html) is specific to this build.
*/

const isProduction = () => process.env.NODE_ENV === 'production';

/*
  index.html and the prerendered landing.html carry small inline scripts
  (the early auth check, the theme-before-paint script, the preload map
  Vite injects). A CSP that blocks inline script would kill them, and
  'unsafe-inline' would throw away most of what a CSP is for, so each one is
  allowed by its exact hash. Read from the built files at boot, so a rebuild
  followed by the usual restart always matches. JSON-LD blocks are data, not
  script, and need no hash.

  The prerendered landing page also loads its stylesheets without blocking
  paint, via onload="this.media='all'" on each <link>. Event-handler
  attributes need 'unsafe-hashes' to be allowed by hash; that keyword only
  lets through handlers whose exact text is listed, nothing else. Without it
  the landing page's CSS never switches on.
*/
const sha256 = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

function decodeAttr(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function inlineHashes(distDir) {
  const scripts = new Set();
  const handlers = new Set();
  for (const name of ['index.html', 'landing.html']) {
    let html;
    try { html = fs.readFileSync(path.join(distDir, name), 'utf8'); } catch (e) { continue; }
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
      if (!m[2]) continue;
      scripts.add(sha256(m[2]));
    }
    const handlerRe = /<[a-z][^>]*?\son[a-z]+\s*=\s*("([^"]*)"|'([^']*)')/gi;
    while ((m = handlerRe.exec(html))) {
      handlers.add(sha256(decodeAttr(m[2] !== undefined ? m[2] : m[3])));
    }
  }
  return { scripts: [...scripts], handlers: [...handlers] };
}

// Every hash the page's script-src must carry, inline blocks and handlers.
function inlineScriptHashes(distDir) {
  const { scripts, handlers } = inlineHashes(distDir);
  return [...scripts, ...handlers];
}

/*
  Only what the app actually loads:
    - its own origin for everything, including the self-hosted fonts;
    - Google Identity Services for "Continue with Google" (script, button
      styles, the sign-in iframe and its calls), per Google's CSP guidance;
    - Razorpay's checkout script and the payment iframe it opens.
  Styles allow 'unsafe-inline': React writes style="" attributes throughout,
  the prerendered landing page has them baked into its HTML, and several
  pages render their own <style> blocks. Style injection is a far smaller
  risk than script injection, which stays locked to hashes.
  Images allow data: and blob: for uploaded logos and avatars, which are
  stored as data URIs.
*/
function buildCsp(distDir) {
  const google = 'https://accounts.google.com';
  const razorpay = 'https://*.razorpay.com';
  const { scripts, handlers } = inlineHashes(distDir);
  const inline = [...scripts, ...(handlers.length ? ["'unsafe-hashes'", ...handlers] : [])].join(' ');
  const directives = [
    "default-src 'self'",
    `script-src 'self' ${inline} ${google}/gsi/client https://checkout.razorpay.com ${razorpay}`.replace(/\s+/g, ' '),
    `style-src 'self' 'unsafe-inline' ${google}/gsi/style`,
    "font-src 'self' data:",
    `img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com ${razorpay}`,
    `connect-src 'self' ${google}/gsi/ ${razorpay}`,
    `frame-src ${google}/gsi/ ${razorpay}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${razorpay}`,
    "frame-ancestors 'none'",
  ];
  if (isProduction()) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function securityHeaders(distDir) {
  const csp = buildCsp(distDir);
  return function securityHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', csp);
    // Only over real HTTPS in production: on localhost it would do nothing
    // useful and could pin a developer's browser to https for the host.
    if (isProduction()) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

/*
  Share links, client portals and the API behind them are private to whoever
  holds the link. A crawler that finds one (pasted in a public doc, say) must
  not index it.
*/
function noindexPrivateLinks(req, res, next) {
  const p = req.path;
  if (p.startsWith('/share/') || p.startsWith('/portal/') || p.startsWith('/api/public/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
}

/*
  Cross-site request forgery guard for /api.

  The session cookie is SameSite=Lax, which already keeps it off a POST
  another site makes. This is the second fence, for older browsers and for
  anything Lax does not cover: a state-changing request that the browser
  itself labels as coming from another site is refused before it reaches a
  route. Browsers send Sec-Fetch-Site on every request; very old ones only
  send Origin, which is compared against this server's own origin instead.

  Requests with neither header come from non-browser clients (the test
  suite, scripts, Razorpay's servers). Those cannot carry a victim's cookie,
  so they are not a CSRF risk and pass through to the normal session checks.
  The Razorpay webhook is signed and cookie-less, and is always allowed.
*/
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT = new Set(['/api/billing/webhook']);

function originOf(url) {
  try { return new URL(url).origin; } catch (e) { return null; }
}

function crossSiteGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT.has(req.originalUrl.split('?')[0])) return next();

  const refuse = () => res.status(403).json({
    error: 'This request was blocked because it did not come from Reelytic. Refresh the page and try again.',
    code: 'CROSS_SITE',
  });

  const site = req.get('sec-fetch-site');
  if (site) {
    return (site === 'same-origin' || site === 'none') ? next() : refuse();
  }

  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = new Set([originOf(config.appUrl), `${req.protocol}://${req.get('host')}`]);
  return allowed.has(origin) ? next() : refuse();
}

module.exports = { securityHeaders, noindexPrivateLinks, crossSiteGuard, buildCsp, inlineScriptHashes };
