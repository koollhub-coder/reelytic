const { recordError } = require('../services/errorTracking.service');

/*
  Last stop for anything a route throws.

  Beyond answering the request, this now records the failure so a 500 in
  production is something we find out about from the Health page rather than
  from a client emailing to say the app is broken. 4xx are deliberately not
  recorded: a rejected password or a validation failure is the app working
  correctly, and logging those would bury the real faults.
*/
function errorHandler(err, req, res, next) {
  console.error('[Reelytic Error]', err);
  const status = err.status || 500;

  if (status >= 500) {
    // Fire and forget. recordError never throws, and the client's response
    // must not wait on a logging write.
    recordError({
      kind: 'server',
      message: err.message || 'Internal Server Error',
      stack: err.stack,
      route: `${req.method} ${req.originalUrl || req.url}`,
      status,
      username: req.session && req.session.username,
      userAgent: req.headers && req.headers['user-agent'],
      extra: { code: err.code || null },
    });
  }

  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'SERVER_ERROR'
  });
}

module.exports = { errorHandler };
