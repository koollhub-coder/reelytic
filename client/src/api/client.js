// Pages a signed-out visitor is meant to reach directly. A 401 from the
// routine "am I logged in" check on any of these is expected, not a session
// expiring mid-use, so it must never force-navigate away from them (that
// bug sent every logged-out visitor straight to /login, skipping Landing,
// Pricing, and Signup entirely).
const PUBLIC_PATHS = ['/', '/login', '/signup', '/pricing', '/dev-unlock'];

// /share/<token> takes a dynamic token per link, so it can't live in the
// exact-match list above -- without this, AuthContext's routine /auth/me
// check 401s for every signed-out visitor (which is the entire point of a
// share link) and this same redirect bounced them straight to /login before
// PublicReport ever got a chance to render.
function isPublicPath(pathname) {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/share/');
}

export async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (!isPublicPath(window.location.pathname)) {
      const suffix = data.code === 'REVOKED' ? '?reason=revoked' : '';
      window.location.href = `/login${suffix}`;
      throw new Error(data.error || 'Session expired');
    }
    throw new Error(data.error || 'Unauthorized');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `HTTP error ${res.status}`);
    err.code = data.code;
    err.data = data;
    throw err;
  }

  if (res.status === 204) {
    return null;
  }

  return await res.json();
}
