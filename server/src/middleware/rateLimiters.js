import rateLimit from 'express-rate-limit';

const base = {
  standardHeaders: true,
  legacyHeaders: false,
};

export const analyzeLimiter = rateLimit({ ...base, windowMs: 60_000, max: 30 });
export const aiLimiter = rateLimit({ ...base, windowMs: 60_000, max: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 30) });
export const shareLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, max: 30 });
export const defaultLimiter = rateLimit({ ...base, windowMs: 60_000, max: 120 });

export default { analyzeLimiter, aiLimiter, shareLimiter, defaultLimiter };
