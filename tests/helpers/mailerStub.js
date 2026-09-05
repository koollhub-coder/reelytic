const http = require('http');

/*
  Stand-in for mailer.service.js's Resend call, loaded only when
  REELYTIC_MAILER_STUB points at this file (see the seam in
  mailer.service.js). Mirrors scraperStub.js's role for Apify: it exists so
  signup, OTP resend, the magic-link verify and forgot-password can be
  exercised for free and without a real inbox, by capturing what WOULD have
  been sent instead of sending it.

  The captured emails live in the SERVER's process, a separate Node process
  from the one running the test file (see tests/helpers/server.js) -- so a
  test can't just `require('./mailerStub').sent`, that would be a second,
  empty instance. Instead this module opens its own tiny HTTP server, on
  REELYTIC_MAILER_STUB_PORT, that the test process queries directly. Kept
  fully separate from the real Express app rather than added as a route
  there, so nothing about this exists on a production server even in
  principle -- the only thing mailer.service.js gained is the seam that
  loads this file, and that seam already refuses to run when NODE_ENV is
  production.
*/

const sent = [];

async function sendTransactionalEmail({ to, subject, html, text }) {
  sent.push({ to, subject, html, text, at: Date.now() });
}

// Newest first, so a resend correctly shadows the email it replaces without
// the caller having to know how many were sent.
function lastEmailTo(to) {
  for (let i = sent.length - 1; i >= 0; i -= 1) {
    if (sent[i].to === to) return sent[i];
  }
  return null;
}

const port = Number(process.env.REELYTIC_MAILER_STUB_PORT || 3458);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && url.pathname === '/reset') {
    sent.length = 0;
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/last-email') {
    const to = url.searchParams.get('to');
    const email = to ? lastEmailTo(to) : null;
    res.end(JSON.stringify({ email }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port);
// Never keeps the server process itself alive on its own -- the same
// listener the real Express app opens already does that; this one just
// rides along and gets killed with it.
server.unref();

module.exports = { sendTransactionalEmail };
