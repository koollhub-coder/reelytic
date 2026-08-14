const { BASE_URL } = require('./server');
const { PASSWORD, usernameFor } = require('./seed');

/*
  A tiny HTTP client that remembers a session cookie.

  Node's fetch has no cookie jar, and every meaningful thing this app does is
  behind a session. So each "agent" is one logged-in identity, and tests read
  as `await pro.get('/jobs')` rather than as cookie plumbing. Several agents
  coexist, which is what makes cross-account access tests possible: sign in as
  two tiers at once and try to read one's data with the other's session.
*/

function createAgent() {
  let cookie = null;

  async function request(method, endpoint, body, options = {}) {
    const headers = { ...(options.headers || {}) };
    let payload;

    if (body !== undefined && body !== null) {
      if (body instanceof URLSearchParams || typeof body === 'string') {
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(`${BASE_URL}${endpoint.startsWith('/api') ? '' : '/api'}${endpoint}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
    });

    // Keep whatever the server sets, including the rotated cookie a fresh
    // login issues.
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 400) }; }

    return { status: res.status, ok: res.ok, data, headers: res.headers };
  }

  return {
    get: (e, o) => request('GET', e, null, o),
    post: (e, b, o) => request('POST', e, b, o),
    patch: (e, b, o) => request('PATCH', e, b, o),
    put: (e, b, o) => request('PUT', e, b, o),
    del: (e, b, o) => request('DELETE', e, b, o),
    raw: request,
    get cookie() { return cookie; },
    clearSession() { cookie = null; },
  };
}

// Signs in one of the seeded tier accounts and hands back a ready agent.
// Throws on failure rather than returning a half-usable agent, because a
// silent auth failure would surface later as a confusing 401 in an unrelated
// assertion.
async function loginAs(tierKey) {
  const agent = createAgent();
  const username = usernameFor(tierKey);
  const res = await agent.post('/auth/login', { username, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Could not sign in seeded account "${username}": ${res.status} ${JSON.stringify(res.data)}`);
  }
  agent.username = username;
  agent.tier = tierKey;
  agent.user = res.data.user;
  return agent;
}

// An agent that has never logged in, for testing public and unauthenticated
// paths (share links, the error intake, anything that must reject anonymous
// callers).
function anonymousAgent() {
  const agent = createAgent();
  agent.tier = 'anonymous';
  return agent;
}

module.exports = { createAgent, loginAs, anonymousAgent };
