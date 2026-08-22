const { recordError } = require('../services/errorTracking.service');

/*
  Last stop for anything a route throws.

  Beyond answering the request, this now records the failure so a 500 in
  production is something we find out about from the Health page rather than
  from a client emailing to say the app is broken. 4xx are deliberately not
  recorded: a rejected password or a validation failure is the app working
  correctly, and logging those would bury the real faults.
*/
// What a 500 shows a user who set no err.userMessage of their own -- the
// real cause (err.message) still goes to recordError below and from there
// to Slack, so nothing is actually lost, it just doesn't get read out loud
// to whoever happened to be signing up when a third-party API hiccupped.
const GENERIC_SERVER_MESSAGE = "Something went wrong on our end. Please try again in a moment, or contact support if this keeps happening.";

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

  /*
    A 500's err.message is written for the Slack/Health-page audience (it
    names the failing third party, includes its raw response text, etc) --
    exactly the internal detail a signed-out visitor should never see. A
    route that wants to say something specific and safe sets err.userMessage
    explicitly (see the OTP-mail failure paths in auth.routes.js); anything
    else falls back to one generic line. 4xx errors are unaffected: those
    messages are written by the route itself for the user to read (bad
    password, invalid input), not leaked internals.
  */
  const clientMessage = status >= 500
    ? (err.userMessage || GENERIC_SERVER_MESSAGE)
    : (err.message || 'Internal Server Error');

  res.status(status).json({
    error: clientMessage,
    code: err.code || 'SERVER_ERROR'
  });
}

module.exports = { errorHandler };
