import {
  fetchRepoFileContent,
  fetchRepoContents,
  fetchOwnedRepositories,
  fetchRepoBranches,
  fetchRepoDetails,
  fetchRepoTree,
  parseGitHubRepoUrl,
  resolvePublicRepository,
  updateRepoFileContent,
} from '../services/githubApi.service.js';
import { getGitHubToken } from '../../utils/authUser.js';

function resolveRepoFromQuery(req) {
  const source = req.query.source === 'owned' ? 'owned' : 'public';
  const token = source === 'owned' ? getGitHubToken(req) : undefined;

  const owner = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
  const repo = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
  const branch = typeof req.query.branch === 'string' ? req.query.branch.trim() : '';

  let targetOwner = owner;
  let targetRepo = repo;

  if ((!targetOwner || !targetRepo) && typeof req.query.url === 'string') {
    const parsed = parseGitHubRepoUrl(req.query.url);
    targetOwner = parsed.owner;
    targetRepo = parsed.repo;
  }

  if (!targetOwner || !targetRepo) {
    const err = new Error('Repository lookup requires owner/repo or a valid GitHub URL.');
    err.statusCode = 400;
    throw err;
  }

  return {
    source,
    token,
    owner: targetOwner,
    repo: targetRepo,
    branch,
  };
}

export async function resolvePublicRepoController(req, res, next) {
  try {
    const result = await resolvePublicRepository(req.body.url);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function listOwnedReposController(req, res, next) {
  try {
    const result = await fetchOwnedRepositories({ token: getGitHubToken(req) });
    return res.status(200).json({
      repositories: result.repositories,
      scopes: result.scopes,
    });
  } catch (err) {
    if (err.statusCode === 401) {
      return res.status(401).json({
        error: err.message,
        loginUrl: '/api/auth/github?reauth=1',
        action:
          'Re-authenticate with GitHub. If this persists, revoke this app in GitHub Settings > Applications, then connect again.',
      });
    }

    if (err.statusCode === 404) {
      return res.status(401).json({
        error: 'GitHub token is missing, expired, or no longer authorized. Please reconnect GitHub.',
        loginUrl: '/api/auth/github?reauth=1',
        action:
          'Reconnect GitHub to refresh your token and repository access. If this persists, revoke the app authorization in GitHub Settings > Applications and connect again.',
      });
    }

    if (err.statusCode === 403 && err.code === 'INSUFFICIENT_SCOPE') {
      return res.status(403).json({
        error: err.message,
        requiredScopes: err.requiredScopes,
        grantedScopes: err.grantedScopes,
        loginUrl: '/api/auth/github?reauth=1',
        action:
          'Grant the required scopes. If GitHub does not prompt for new scopes, revoke the app authorization in GitHub Settings > Applications and reconnect.',
      });
    }

    return next(err);
  }
}

export async function listBranchesController(req, res, next) {
  try {
    const { token, owner, repo } = resolveRepoFromQuery(req);

    const [repoDetails, branches] = await Promise.all([
      fetchRepoDetails({ owner, repo, token }),
      fetchRepoBranches({ owner, repo, token }),
    ]);

    return res.status(200).json({
      repository: {
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        fullName: repoDetails.fullName,
        defaultBranch: repoDetails.defaultBranch,
      },
      branches,
    });
  } catch (err) {
    return next(err);
  }
}

export async function listRepositoryStructureController(req, res, next) {
  try {
    const { token, owner, repo, branch } = resolveRepoFromQuery(req);

    const [repoDetails, repoTree] = await Promise.all([
      fetchRepoDetails({ owner, repo, token }),
      fetchRepoTree({ owner, repo, ref: branch, token }),
    ]);

    const topLevelDirectories = new Map();
    const topLevelFiles = new Map();

    for (const entry of repoTree.tree) {
      const pathValue = String(entry?.path || '').trim();
      if (!pathValue) continue;

      const segments = pathValue.split('/').filter(Boolean);
      if (!segments.length) continue;

      const topLevelName = segments[0];

      if (segments.length === 1 && entry.type === 'blob') {
        topLevelFiles.set(topLevelName, {
          name: topLevelName,
          path: topLevelName,
          size: Number.isFinite(entry?.size) ? entry.size : 0,
          type: 'file',
        });
        continue;
      }

      if (!topLevelDirectories.has(topLevelName)) {
        topLevelDirectories.set(topLevelName, {
          name: topLevelName,
          path: topLevelName,
          fileCount: 0,
          subdirectories: new Set(),
        });
      }

      const current = topLevelDirectories.get(topLevelName);

      if (entry.type === 'blob') {
        current.fileCount += 1;
      }

      if (segments.length > 1) {
        current.subdirectories.add(segments[1]);
      }
    }

    const directories = Array.from(topLevelDirectories.values())
      .map((item) => ({
        name: item.name,
        path: item.path,
        fileCount: item.fileCount,
        subdirectories: Array.from(item.subdirectories)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const files = Array.from(topLevelFiles.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      repository: {
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        fullName: repoDetails.fullName,
        branch: branch || repoDetails.defaultBranch || null,
        defaultBranch: repoDetails.defaultBranch,
        htmlUrl: `https://github.com/${repoDetails.owner}/${repoDetails.repo}`,
      },
      truncated: repoTree.truncated,
      directories,
      files,
    });
  } catch (err) {
    return next(err);
  }
}

export async function listRepositoryDirectoryController(req, res, next) {
  try {
    const { token, owner, repo, branch } = resolveRepoFromQuery(req);
    const requestedPath = typeof req.query.path === 'string'
      ? req.query.path.trim().replace(/^\/+/, '').replace(/\/+$/, '')
      : '';

    const [repoDetails, entries] = await Promise.all([
      fetchRepoDetails({ owner, repo, token }),
      fetchRepoContents({ owner, repo, path: requestedPath, ref: branch, token }),
    ]);

    return res.status(200).json({
      repository: {
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        fullName: repoDetails.fullName,
        branch: branch || repoDetails.defaultBranch || null,
        defaultBranch: repoDetails.defaultBranch,
        htmlUrl: `https://github.com/${repoDetails.owner}/${repoDetails.repo}`,
      },
      path: requestedPath,
      entries,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getRepositoryFileController(req, res, next) {
  try {
    const { token, owner, repo, branch } = resolveRepoFromQuery(req);
    const requestedPath = typeof req.query.path === 'string'
      ? req.query.path.trim().replace(/^\/+/, '').replace(/\/+$/, '')
      : '';

    if (!requestedPath) {
      const err = new Error('File path is required to load repository file content.');
      err.statusCode = 400;
      throw err;
    }

    const [repoDetails, file] = await Promise.all([
      fetchRepoDetails({ owner, repo, token }),
      fetchRepoFileContent({ owner, repo, path: requestedPath, ref: branch, token }),
    ]);

    return res.status(200).json({
      repository: {
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        fullName: repoDetails.fullName,
        branch: branch || repoDetails.defaultBranch || null,
        defaultBranch: repoDetails.defaultBranch,
        htmlUrl: `https://github.com/${repoDetails.owner}/${repoDetails.repo}`,
      },
      file,
      canEdit: req.query.source === 'owned',
    });
  } catch (err) {
    return next(err);
  }
}

export async function updateRepositoryFileController(req, res, next) {
  try {
    const source = req.body.source === 'owned' ? 'owned' : 'public';
    const token = source === 'owned' ? getGitHubToken(req) : undefined;

    let targetOwner = req.body.owner || '';
    let targetRepo = req.body.repo || '';

    if ((!targetOwner || !targetRepo) && typeof req.body.url === 'string') {
      const parsed = parseGitHubRepoUrl(req.body.url);
      targetOwner = parsed.owner;
      targetRepo = parsed.repo;
    }

    if (!targetOwner || !targetRepo) {
      const err = new Error('Repository update requires owner/repo or a valid GitHub URL.');
      err.statusCode = 400;
      throw err;
    }

    if (source !== 'owned') {
      const err = new Error('Editing files is only supported for authenticated owned repositories.');
      err.statusCode = 403;
      throw err;
    }

    const updated = await updateRepoFileContent({
      owner: targetOwner,
      repo: targetRepo,
      path: req.body.path,
      ref: req.body.branch,
      token,
      content: req.body.content,
      sha: req.body.sha,
      message: req.body.message,
    });

    return res.status(200).json({
      file: {
        path: updated.path,
        sha: updated.sha,
        htmlUrl: updated.htmlUrl,
        commitSha: updated.commitSha,
      },
    });
  } catch (err) {
    return next(err);
  }
}