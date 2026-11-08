import { env } from '../config/env.js';
import { forbidden } from '../utils/httpError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Browsers always say which website a write request came from. Reject any website
// except the React app. Tools like curl send no Origin and are not a browser risk.
export function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== env.corsOrigin) {
    throw forbidden('Request origin is not allowed.');
  }
  next();
}