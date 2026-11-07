import { rateLimit } from 'express-rate-limit';

// Counts only failed attempts (status 400 and above) per device.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts from this device. Try again in 15 minutes.' },
});