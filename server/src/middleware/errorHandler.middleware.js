import { logger } from '../utils/logger.js';

export function errorHandler(err, _req, res, _next) {
  const upstreamStatus =
    err?.status ??
    err?.statusCode ??
    err?.response?.status ??
    null;

  const statusCode = Number.isInteger(upstreamStatus) && upstreamStatus >= 100
    ? upstreamStatus
    : 500;

  let message = err?.message || 'Internal server error';

  if (statusCode === 429) {
    message =
      'AI provider quota exceeded. Add credits at platform.openai.com/billing, ' +
      'or switch to Anthropic / Gemini by setting AI_PROVIDER in your server .env.';
  } else if (statusCode === 503 || message.toLowerCase().includes('not configured')) {
    message =
      'AI provider is not configured. Set AI_API_KEY (and optionally AI_PROVIDER) ' +
      'in your server .env file, then restart the server.';
  } else if (statusCode === 401 && message.toLowerCase().includes('api')) {
    message =
      'AI API key is invalid or expired. Check AI_API_KEY in your server .env file.';
  }

  if (statusCode >= 500) {
    logger.error({ statusCode, message: err?.message, stack: err?.stack }, 'unhandled error');
  }

  return res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && err?.stack
      ? { stack: err.stack }
      : {}),
  });
}
