import passport from 'passport';
import { createGitHubStrategy, validateGitHubOAuthEnv } from '../services/githubStrategy.service.js';
import { logger } from '../../utils/logger.js';

let initialized = false;

export function configureGitHubPassport() {
  if (initialized) return;

  const envCheck = validateGitHubOAuthEnv();
  if (!envCheck.valid) {
    logger.warn(`[auth] GitHub OAuth disabled. Missing env vars: ${envCheck.missing.join(', ')}`);
    return;
  }

  passport.use(createGitHubStrategy());
  initialized = true;

  logger.info(`[auth] GitHub OAuth callback URL: ${envCheck.callbackURL}`);
}
