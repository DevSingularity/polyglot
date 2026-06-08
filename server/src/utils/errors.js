export class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export const errors = {
  notFound:    (msg = 'Not found')       => new AppError(msg, 404, 'NOT_FOUND'),
  forbidden:   (msg = 'Forbidden')       => new AppError(msg, 403, 'FORBIDDEN'),
  badRequest:  (msg = 'Bad request')     => new AppError(msg, 400, 'BAD_REQUEST'),
  unauthorized:(msg = 'Unauthorized')    => new AppError(msg, 401, 'UNAUTHORIZED'),
  internal:    (msg = 'Internal error')  => new AppError(msg, 500, 'INTERNAL'),
};

export default errors;
