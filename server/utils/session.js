/*
  Every way of signing in goes through startSession, so each one gets a brand
  new session id. Reusing the id a visitor already had before logging in
  (session fixation) would let anyone who planted or saw that pre-login
  cookie ride along into the signed-in session.
*/

const REMEMBER_ME_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function regenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/*
  rememberMe:
    true      30-day cookie
    false     browser-session cookie (dies when the browser closes);
              cookie.expires = false is express-session's way to do that
    undefined the app-wide 7-day default from index.js, for flows with no
              remember-me choice (OTP verify, Google, invite accept)
*/
async function startSession(req, user, { rememberMe } = {}) {
  await regenerate(req);
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.createdAt = new Date().toISOString();
  if (rememberMe === true) {
    req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE;
  } else if (rememberMe === false) {
    req.session.cookie.expires = false;
  }
}

/*
  New id for the session already signed in, keeping who it belongs to and
  how long its cookie lives. createdAt can be pinned so a revocation stamped
  at the same moment (see the password change route) spares this session.
*/
async function rotateSession(req, { createdAt } = {}) {
  const { username, role } = req.session;
  const lifetime = req.session.cookie.originalMaxAge;
  await regenerate(req);
  req.session.username = username;
  req.session.role = role;
  req.session.createdAt = createdAt || new Date().toISOString();
  if (lifetime == null) {
    req.session.cookie.expires = false;
  } else {
    req.session.cookie.maxAge = lifetime;
  }
}

module.exports = { startSession, rotateSession, REMEMBER_ME_MAX_AGE };
