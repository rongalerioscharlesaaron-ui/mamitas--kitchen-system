import { badRequest } from './httpError.js';

export function parseId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw badRequest(`Invalid ${label}.`);
  return n;
}

export function text(value, field, { min = 1, max = 100 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} is required.`);
  const v = value.trim();
  if (v.length < min) throw badRequest(`${field} is required.`);
  if (v.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return v;
}

export function number(
  value,
  field,
  { min = null, max = null, integer = false, decimals = 3, allowEmpty = false } = {}
) {
  if (allowEmpty && (value === undefined || value === null || value === '')) return null;
  let n = value;
  if (typeof n === 'string' && n.trim() !== '') n = Number(n);
  if (typeof n !== 'number' || !Number.isFinite(n)) throw badRequest(`${field} must be a number.`);
  if (integer && !Number.isInteger(n)) throw badRequest(`${field} must be a whole number.`);
  const factor = 10 ** decimals;
  if (Math.abs(n * factor - Math.round(n * factor)) > 1e-6) {
    throw badRequest(`${field} can have at most ${decimals} decimal places.`);
  }
  if (min !== null && n < min) throw badRequest(`${field} must be at least ${min}.`);
  if (max !== null && n > max) throw badRequest(`${field} must be at most ${max}.`);
  return n;
}

export function date(value, field, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${field} must be a date (YYYY-MM-DD).`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} is not a valid date.`);
  }
  return value;
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function bool(value, field) {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`);
  return value;
}