import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty' } }
    : {}),
});

export default logger;

export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;

    if (status >= 400) {
      logger.warn({ method, url: originalUrl, status, ms }, 'request completed with error');
    } else {
      logger.info({ method, url: originalUrl, status, ms }, 'request completed');
    }
  });

  next();
}
