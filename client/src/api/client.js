import { reportApiFailure } from '../utils/errorReporter';

// Pages a signed-out visitor is meant to reach directly. A 401 from the
// routine "am I logged in" check on any of these is expected, not a session
// expiring mid-use, so it must never force-navigate away from them (that
// bug sent every logged-out visitor straight to /login, skipping Landing,
// Pricing, and Signup entirely).
const PUBLIC_PATHS = ['/', '/login', '/signup', '/pricing', '/dev-unlock', '/terms', '/privacy', '/forgot-password', '/reset-password', '/verify-email', '/team/accept'];

// /share/<token> and /portal/<token> take a dynamic token per link, so they
// can't live in the exact-match list above -- without this, AuthContext's
// routine /auth/me check 401s for every signed-out visitor (which is the
// entire point of a share or portal link) and this same redirect bounced
// them straight to /login before PublicReport/ClientPortal ever got a
// chance to render.
function isPublicPath(pathname) {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/share/') || pathname.startsWith('/portal/');
}

export async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // A first-load GET the page already started (see the inline script in index.html) is used once, if fresh.
  let res = null;
  const early = window.__early && window.__early[endpoint];
  if (early && (!options.method || options.method === 'GET')) {
    delete window.__early[endpoint];
    if (Date.now() - early.t < 15000) res = await early.p;
  }
  if (!res) {
    res = await fetch(`/api${endpoint}`, {
      ...options,
      headers
    });
  }

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

    /*
      Report the ones that indicate something is actually wrong.

      403 is excluded along with the 401 handled above: both are the app
      working correctly (a paid feature correctly refused, a session
      correctly expired), and recording them would bury real faults under
      thousands of non-events. 5xx always counts. 4xx above 403 counts too,
      because a 404 on a route the app itself just linked to, or a 400 on a
      payload the app itself built, is a bug on our side.
    */
    if (res.status !== 403) {
      reportApiFailure({ path: endpoint, status: res.status, message: err.message });
    }
    throw err;
  }

  if (res.status === 204) {
    return null;
  }

  return await res.json();
}
