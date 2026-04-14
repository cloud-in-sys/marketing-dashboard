export function errorHandler(err, c) {
  console.error('[error]', err);
  const status = err.status || 500;
  return c.json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  }, status);
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
