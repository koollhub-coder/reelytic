const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { anonymousAgent } = require('./helpers/client');
const { getDb } = require('../server/db');

/*
  Holes that were open in production code and are now closed. Each test here
  was run against the old code first and failed; if one starts passing for
  the wrong reason, check it still fails with the fix reverted.
*/

before(async () => {
  await seed();
  await startServer();
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('Google sign-in never trusts a posted email', () => {
  test('an email with no Google token does not sign anyone in, not even the admin', async () => {
    const agent = anonymousAgent();
    const adminEmail = `${usernameFor('admin')}@regression.test`;
    const res = await agent.post('/auth/google', { email: adminEmail, name: 'Anyone' });
    assert.equal(res.status, 401, JSON.stringify(res.data));
    assert.equal(res.data.user, undefined);

    const me = await agent.get('/auth/me');
    assert.equal(me.status, 401, 'no session may exist after a rejected Google sign-in');
  });

  test('a made-up token is refused with a plain message', async () => {
    const res = await anonymousAgent().post('/auth/google', { credential: 'not-a-real-token' });
    assert.equal(res.status, 401);
    assert.doesNotMatch(JSON.stringify(res.data), /library|google-auth/i);
  });

  test('no account is created for the posted address', async () => {
    const email = `${usernameFor('ghost')}@regression.test`;
    await anonymousAgent().post('/auth/google', { email });
    const row = await getDb().collection('users').findOne({ email });
    assert.equal(row, null);
  });
});
