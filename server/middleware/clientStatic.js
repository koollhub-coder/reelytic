const fs = require('fs');
const path = require('path');
const express = require('express');

/*
  Serves the built client (client/dist), fast.

  WHY THIS EXISTS. The client used to be served by a bare express.static
  mounted AFTER the session middleware and the JSON body parser, which meant:
    - every JS, CSS and image request first went through the session store, i.e.
      one database round trip, before a single byte of a file could be sent;
    - nothing was compressed (a 394 KB bundle went over the wire as 394 KB);
    - hashed files that can never change were sent with no long cache lifetime,
      so every visit revalidated every file;
    - even the HTML shell waited on the session lookup, so time-to-first-byte
      for a signed-in person included a database trip.

  This mounts BEFORE all of that and fixes each point:
    - Brotli and gzip copies are written at build time (scripts/precompress.js)
      at maximum quality, and the best one the browser accepts is sent as is.
      Nothing is compressed per request, so it costs no CPU.
    - /assets/* are content-hashed by Vite, so they are cached for a year and
      marked immutable. A new deploy has new names.
    - index.html is the one file whose name never changes, so it is always
      revalidated (cheap: a 304), which is how a new deploy is noticed at once.
    - It never touches the session, so a page request is answered from memory.
*/

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const YEAR = 'public, max-age=31536000, immutable';

function buildIndex(dist) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(br|gz)$/.test(entry.name)) continue;
      const rel = '/' + path.relative(dist, full).split(path.sep).join('/');
      const ext = path.extname(entry.name).toLowerCase();
      const stat = fs.statSync(full);
      files.set(rel, {
        full,
        ext,
        size: stat.size,
        mtime: stat.mtime,
        br: fs.existsSync(full + '.br') ? full + '.br' : null,
        gz: fs.existsSync(full + '.gz') ? full + '.gz' : null,
        etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      });
    }
  };
  if (fs.existsSync(dist)) walk(dist);
  return files;
}

function cacheControlFor(rel) {
  if (rel === '/index.html' || rel === '/landing.html') return 'no-cache';
  if (rel.startsWith('/assets/') || rel.startsWith('/fonts/')) return YEAR;
  if (/\.(png|ico|jpg|jpeg|webp|svg)$/.test(rel)) return 'public, max-age=604800';
  return 'public, max-age=3600';
}

function sendFile(req, res, rel, meta) {
  const accept = String(req.headers['accept-encoding'] || '');
  let file = meta.full;
  let encoding = null;
  if (meta.br && /\bbr\b/.test(accept)) { file = meta.br; encoding = 'br'; }
  else if (meta.gz && /\bgzip\b/.test(accept)) { file = meta.gz; encoding = 'gzip'; }

  res.setHeader('Content-Type', TYPES[meta.ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', cacheControlFor(rel));
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('ETag', encoding ? meta.etag.replace('W/"', `W/"${encoding}-`) : meta.etag);
  res.setHeader('Last-Modified', meta.mtime.toUTCString());
  if (encoding) res.setHeader('Content-Encoding', encoding);

  if (req.headers['if-none-match'] === res.getHeader('ETag')) return res.status(304).end();

  const stream = fs.createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  res.setHeader('Content-Length', fs.statSync(file).size);
  if (req.method === 'HEAD') return res.end();
  stream.pipe(res);
  return undefined;
}

function clientStatic(dist) {
  const router = express.Router();
  let files = buildIndex(dist);
  const indexHtml = () => files.get('/index.html');

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();

    let rel;
    try { rel = decodeURIComponent(req.path); } catch (e) { return next(); }
    // The landing page is prerendered (see client/scripts/prerender-landing.mjs); everything else is
    // the ordinary app shell.
    if (rel === '/') rel = files.has('/landing.html') ? '/landing.html' : '/index.html';

    const meta = files.get(rel);
    if (meta && TYPES[meta.ext]) return sendFile(req, res, rel, meta);
    if (meta) {
      // images and fonts: not worth compressing, but they still get long cache lifetimes
      res.setHeader('Cache-Control', cacheControlFor(rel));
      return res.sendFile(meta.full, { cacheControl: false });
    }

    // A path with a file extension that does not exist is a real 404, not a page.
    if (path.extname(rel)) return next();

    // Any other path is a page inside the single-page app. Answered here, before the
    // session and body parsing, straight from memory.
    const index = indexHtml();
    if (index) return sendFile(req, res, '/index.html', index);
    return next();
  });

  router.rescan = () => { files = buildIndex(dist); };
  return router;
}

module.exports = { clientStatic };
