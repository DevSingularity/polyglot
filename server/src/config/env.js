const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
];

function isTestEnvironment() {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST)
  );
}

export function validateEnv() {
  const test = isTestEnvironment();

  const missing = REQUIRED.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const msg = `[startup] Missing required env vars: ${missing.join(', ')}`;
    if (test) {
      console.warn(msg);
    } else {
      console.error(msg);
      process.exit(1);
    }
  }
}
