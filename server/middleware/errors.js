function errorHandler(err, req, res, next) {
  console.error('[Reelytic Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'SERVER_ERROR'
  });
}

module.exports = { errorHandler };
