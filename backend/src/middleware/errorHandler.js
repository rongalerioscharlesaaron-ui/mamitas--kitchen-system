import { HttpError } from '../utils/httpError.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// Decides what the client may see. Details of unexpected errors stay in the server log.
function describe(err) {
  if (err.type === 'entity.parse.failed') return [400, 'The request body is not valid JSON.'];
  if (err.type === 'entity.too.large') return [413, 'The request body is too large.'];
  if (err instanceof HttpError) return [err.status, err.message];

  switch (err.code) {
    case 'P0001': // raised by our own database rules, e.g. "Not enough Chicken Adobo in stock"
      return [400, err.message.replace(/(\d)\.0+(?!\d)/g, '$1')];
    case '23514': // check violation: our trigger messages are safe, table constraint names are not
      return [400, err.constraint ? 'That value is not allowed.' : err.message];
    case '23505':
      return [409, 'That record already exists.'];
    case '23503':
      return [409, 'This record is linked to other records.'];
    case '22P02':
    case '22003':
      return [400, 'One of the values is not valid.'];
    case '42501':
      return [403, 'This action is not allowed.'];
    default:
      return [500, 'Something went wrong on the server.'];
  }
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const [status, message] = describe(err);
  if (status >= 500) {
    console.error(err);
  } else {
    console.warn(`${req.method} ${req.originalUrl.split('?')[0]} -> ${status}: ${message}`);
  }
  return res.status(status).json({ error: message });
}