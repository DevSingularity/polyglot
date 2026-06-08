const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
];

const AUTH_ONLY = new Set(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']);

function isTestEnvironment() {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST)
  );
}

export function validateEnv() {
  const test = isTestEnvironment();

  const missing = REQUIRED.filter((key) => {
    if (!process.env[key]) {
      if (test && AUTH_ONLY.has(key)) return false;
      return true;
    }
    return false;
  });

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
