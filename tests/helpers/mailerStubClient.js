const STUB_PORT = Number(process.env.REELYTIC_MAILER_STUB_PORT || 3458);
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

/*
  Test-process side of mailerStub.js's tiny HTTP server (see that file for
  why this can't just be a plain require -- the capture lives in the
  server's own process). A short poll rather than one shot: the route
  handler that triggers the email (signup, resend, forgot-password) has
  already returned its HTTP response by the time this is called, but the
  fetch to the stub's own listener is still one more async hop behind it.
*/
async function waitForEmailTo(to, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${STUB_URL}/last-email?to=${encodeURIComponent(to)}`);
    const { email } = await res.json();
    if (email) return email;
    if (Date.now() > deadline) {
      throw new Error(`No email captured for ${to} within ${timeoutMs}ms. Is the server running with REELYTIC_MAILER_STUB set?`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function resetMailerStub() {
  await fetch(`${STUB_URL}/reset`, { method: 'POST' });
}

// Text bodies are built by mailer.service.js's own buildOtpEmailText /
// buildPasswordResetEmailText -- these patterns are lifted directly from
// that literal wording, not guessed, so a change to that copy is what
// breaks these on purpose rather than silently drifting out of sync.
function extractOtpCode(text) {
  const m = text.match(/Or enter this code: (\d{6})/);
  return m ? m[1] : null;
}

function extractVerifyLinkParams(text) {
  const m = text.match(/Verify instantly: (\S+)/);
  if (!m) return null;
  const url = new URL(m[1]);
  return { username: url.searchParams.get('u'), token: url.searchParams.get('t') };
}

function extractResetToken(text) {
  const m = text.match(/choose a new one:\n(\S+)/);
  if (!m) return null;
  return new URL(m[1]).searchParams.get('token');
}

module.exports = { waitForEmailTo, resetMailerStub, extractOtpCode, extractVerifyLinkParams, extractResetToken };
