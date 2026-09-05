const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, stopServer } = require('./helpers/server');
const { createAgent } = require('./helpers/client');
const { assertTestDatabase, testName } = require('./helpers/env');
const { connectDb, getDb, closeDb } = require('../server/db');
const {
  waitForEmailTo, extractOtpCode, extractVerifyLinkParams, extractResetToken,
} = require('./helpers/mailerStubClient');

/*
  New-account and account-recovery flows: signup's OTP-code and magic-link
  email verification, and forgot/reset password.

  None of this had test coverage before this file. Every one of these paths
  sends a real email carrying the one piece of data (a code or a token) the
  very next request needs -- which is exactly what made them untested: there
  was no free way to read what the email said, short of paying for a real
  inbox or hand-testing every time. mailerStub.js is the seam that fixes
  that, mirroring what scraperStub.js already does for Apify: the server
  process captures what it would have sent, and this file reads it back over
  the stub's own tiny HTTP listener (see mailerStub.js for why a plain
  require can't do it -- the server runs in a separate process).

  Each test signs up its own throwaway account with a unique email rather
  than sharing one, so tests can run in any order and never race each other
  over which email is "the latest" one sent.
*/

const createdUsernames = [];

function freshEmail(label) {
  return `${testName(label)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@regression.test`;
}

before(async () => {
  assertTestDatabase();
  await connectDb();
  await startServer();
});

after(async () => {
  const db = getDb();
  if (createdUsernames.length) {
    await Promise.all([
      db.collection('users').deleteMany({ username: { $in: createdUsernames } }),
      db.collection('otps').deleteMany({ username: { $in: createdUsernames } }),
      db.collection('passwordResets').deleteMany({ username: { $in: createdUsernames } }),
      db.collection('loginHistory').deleteMany({ username: { $in: createdUsernames } }),
    ]);
  }
  await stopServer();
  await closeDb();
});

async function signUp(label) {
  const agent = createAgent();
  const email = freshEmail(label);
  const res = await agent.post('/auth/signup', {
    username: `${label}${Date.now().toString().slice(-6)}`,
    email,
    password: 'a-strong-test-password-1',
    acceptedTerms: true,
  });
  assert.equal(res.status, 201, `signup should succeed: ${JSON.stringify(res.data)}`);
  createdUsernames.push(res.data.username);
  return { agent, email, username: res.data.username };
}

describe('signup -> email verification', () => {
  test('verifying with the OTP code logs the account in', async () => {
    const { agent, email, username } = await signUp('otp1');
    const mail = await waitForEmailTo(email);
    const code = extractOtpCode(mail.text);
    assert.ok(code, 'OTP email should contain a 6-digit code');

    const res = await agent.post('/auth/verify-otp', { username, code });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.user.username, username);

    // Proves this actually started a session, not just returned a 200.
    const me = await agent.get('/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.emailVerified, true);
  });

  test('a wrong code is rejected and never starts a session', async () => {
    const { agent, email, username } = await signUp('otpwrong');
    await waitForEmailTo(email); // don't race the send -- the row must exist before guessing against it
    const res = await agent.post('/auth/verify-otp', { username, code: '000000' });
    assert.equal(res.status, 400);

    const me = await agent.get('/auth/me');
    assert.equal(me.status, 401, 'a wrong code must not leave the account signed in');
  });

  test('the magic link in the same email logs the account in, same as the code does', async () => {
    const { agent, email, username } = await signUp('link1');
    const mail = await waitForEmailTo(email);
    const params = extractVerifyLinkParams(mail.text);
    assert.ok(params && params.token, 'OTP email should also contain a verify link with a token');
    assert.equal(params.username, username);

    const res = await agent.post('/auth/verify-otp-link', { username: params.username, token: params.token });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.user.username, username);
  });

  test('reusing an already-consumed magic link reports the account as already verified, not a broken link', async () => {
    const { agent, email, username } = await signUp('linkreuse');
    const mail = await waitForEmailTo(email);
    const { token } = extractVerifyLinkParams(mail.text);

    const first = await agent.post('/auth/verify-otp-link', { username, token });
    assert.equal(first.status, 200);

    /*
      A second POST with the same token -- an email client re-fetching the
      link, a duplicate tab, the React StrictMode double-invoke this exact
      pair of bugs surfaced during dev -- is exactly what
      VerifyEmailLink.jsx's own catch handler special-cases on the client.
      The server side of that contract is this: it has to say "already
      verified," not "invalid or expired," which is what a genuinely stale
      token looks like and would send someone off requesting a new one they
      don't need.
    */
    const second = await agent.post('/auth/verify-otp-link', { username, token });
    assert.equal(second.status, 400);
    assert.match(second.data.error, /already verified/i);
  });
});

describe('forgot password -> reset password', () => {
  test('the full loop: request a reset, use the link, log in with the new password', async () => {
    const { email, username } = await signUp('reset1');
    const otpMail = await waitForEmailTo(email);
    const verifyRes = await createAgent().post('/auth/verify-otp', { username, code: extractOtpCode(otpMail.text) });
    assert.equal(verifyRes.status, 200);

    const anon = createAgent();
    const forgot = await anon.post('/auth/forgot-password', { email });
    assert.equal(forgot.status, 200);
    assert.equal(forgot.data.sent, true);

    // The newest email to this address -- the reset link, sent after the
    // OTP one above -- see freshEmail()'s note on why using one address per
    // test makes this safe without an explicit reset between them.
    const resetMail = await waitForEmailTo(email);
    const token = extractResetToken(resetMail.text);
    assert.ok(token, 'reset email should contain a link with a token');

    const newPassword = 'a-different-test-password-2';
    const resetRes = await anon.post('/auth/reset-password', { token, newPassword });
    assert.equal(resetRes.status, 200, JSON.stringify(resetRes.data));

    const login = await createAgent().post('/auth/login', { username, password: newPassword });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.username, username);

    // The old password must be dead, not merely "a second valid one."
    const oldLogin = await createAgent().post('/auth/login', { username, password: 'a-strong-test-password-1' });
    assert.equal(oldLogin.status, 401);
  });

  test('an unknown email still reports "sent" -- this endpoint cannot be used to probe which addresses have accounts', async () => {
    const res = await createAgent().post('/auth/forgot-password', { email: 'no-such-account@regression.test' });
    assert.equal(res.status, 200);
    assert.equal(res.data.sent, true);
  });

  test('a made-up reset token is refused', async () => {
    const res = await createAgent().post('/auth/reset-password', { token: 'not-a-real-token', newPassword: 'whatever-12345' });
    assert.equal(res.status, 400);
  });
});
