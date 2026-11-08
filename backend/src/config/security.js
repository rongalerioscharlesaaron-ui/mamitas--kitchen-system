export const security = {
  cookieName: 'mk_session',
  sessionHours: 8,
  bcryptCost: 12,
  maxFailedLogins: 5,
  lockMinutes: 15,
  minPasswordLength: 10,
  maxPasswordBytes: 72, // bcrypt only uses the first 72 bytes
};