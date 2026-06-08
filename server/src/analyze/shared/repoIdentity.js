import { parseGitHubRepoUrl } from '../services/githubApi.service.js';
import { inferRepositoryName, inferRepositoryOwner } from '../../shared/repoHelpers.js';

export { inferRepositoryName, inferRepositoryOwner };

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