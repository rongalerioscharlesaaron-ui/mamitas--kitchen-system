// An error with an HTTP status. Throw it from any route and the error handler
// sends the right response.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const unauthorized = (message = 'Please log in.') => new HttpError(401, message);
export const forbidden = (message = 'You do not have permission to do this.') => new HttpError(403, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);