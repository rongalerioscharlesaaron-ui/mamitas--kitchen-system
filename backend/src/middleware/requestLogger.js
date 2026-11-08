// Logs method, path, status and time. It never logs bodies, cookies or query strings,
// because those can contain passwords or tokens.
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const path = req.originalUrl.split('?')[0];
    console.log(`${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
}