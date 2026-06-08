import path from 'path';
import { parseGitHubRepoUrl } from '../services/githubApi.service.js';

export function inferRepositoryName({ source, fullName, githubRepo }) {
  if (githubRepo) return githubRepo;
  if (!fullName) return source === 'local' ? 'Local repository' : 'Unknown repository';

  if (source === 'local') {
    const normalized = String(fullName).replace(/\\/g, '/');
    return path.posix.basename(normalized) || 'Local repository';
  }

  const parts = String(fullName).split('/').filter(Boolean);
  return parts[1] || parts[0] || 'Unknown repository';
}

export function inferRepositoryOwner({ source, fullName, githubOwner }) {
  if (githubOwner) return githubOwner;
  if (source === 'local') return 'local';

  const parts = String(fullName || '').split('/').filter(Boolean);
  return parts[0] || 'unknown';
}

export function buildRepositoryIdentity(input) {
  if (input?.source === 'local') {
    return {
      source: 'local',
      fullName: input.localPath,
      githubOwner: null,
      githubRepo: null,
      defaultBranch: null,
      branch: null,
    };
  }

  const github = input?.github || {};
  let owner = github.owner || null;
  let repo = github.repo || null;

  if ((!owner || !repo) && github.url) {
    const parsed = parseGitHubRepoUrl(github.url);
    owner = parsed.owner;
    repo = parsed.repo;
  }

  if (!owner || !repo) {
    const err = new Error('GitHub source requires owner/repo or a valid GitHub URL.');
    err.statusCode = 400;
    throw err;
  }

  return {
    source: 'github',
    fullName: `${owner}/${repo}`,
    githubOwner: owner,
    githubRepo: repo,
    defaultBranch: github.branch || null,
    branch: github.branch || null,
  };
}