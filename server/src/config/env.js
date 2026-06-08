const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
];

// Auth-related vars are only needed when the auth routes are active.
// Integration tests that don't test auth can skip them.
const AUTH_ONLY = new Set(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']);

export function validateEnv() {
  const isTest = Boolean(process.env.VITEST) || process.argv.includes('--test');

  const missing = REQUIRED.filter((key) => {
    if (!process.env[key]) {
      // In test environments, skip the GitHub OAuth / session vars —
      // those services are mocked or not exercised.
      if (isTest && AUTH_ONLY.has(key)) return false;
      return true;
    }
    return false;
  });

  if (missing.length > 0) {
    const msg = `[startup] Missing required env vars: ${missing.join(', ')}`;
    if (isTest) {
      // Warn but don't kill the process — let tests run and fail naturally
      // if they actually need the missing vars.
      console.warn(msg);
    } else {
      console.error(msg);
      process.exit(1);
    }
  }
}