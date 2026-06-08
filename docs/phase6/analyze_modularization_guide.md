# Analyze Module Modularization Guide

> **Goal:** Isolate each responsibility inside `server/src/analyze/` into its own self-contained sub-module, and keep the client `analyzeService.js` mirroring the same thin-wrapper shape. No route or payload contracts change.

---

## Table of Contents

1. [Current State — What's Wrong](#1-current-state--whats-wrong)
2. [Target Directory Structure](#2-target-directory-structure)
3. [Feature Modules to Extract](#3-feature-modules-to-extract)
   - [3.1 Upload / Enqueue Flow](#31-upload--enqueue-flow)
   - [3.2 Analysis History](#32-analysis-history)
   - [3.3 Local Picker Flow](#33-local-picker-flow)
   - [3.4 GitHub Repo Browser](#34-github-repo-browser)
   - [3.5 File View & Edit](#35-file-view--edit)
   - [3.6 PR / Commit Flow](#36-pr--commit-flow)
4. [Shared Helpers to Extract](#4-shared-helpers-to-extract)
5. [Rewiring Routes](#5-rewiring-routes)
6. [Client-Side (analyzeService.js)](#6-client-side-analyzeservicejs)
7. [Migration Order](#7-migration-order)
8. [Testing Checklist](#8-testing-checklist)

---

## 1. Current State — What's Wrong

`analyze.controller.js` is **800+ lines doing six jobs at once:**

| Responsibility | Functions |
|---|---|
| Upload & queue dispatch | `analyzeController`, `buildRepositoryIdentity`, `createOrGetRepository`, `createAnalysisJob` |
| Analysis history | `listAnalysisHistoryController` |
| Local picker | `validateLocalPathController`, `browseLocalPathController`, `localPickerCapabilitiesController` |
| GitHub repo browser | `resolvePublicRepoController`, `listOwnedReposController`, `listBranchesController`, `listRepositoryStructureController`, `listRepositoryDirectoryController` |
| File view & edit | `getRepositoryFileController`, `updateRepositoryFileController` |
| PR / commit | `createPrCommitController` |

Problems this creates:
- **Any change to one feature risks breaking the others** — they share the same import chain.
- **Onboarding is slow** — a new dev has to read the whole file to understand one feature.
- **Tests target one giant file** — coverage is hard to scope.
- **Routes, controller, and service logic are all in the same gravity well** — adding a new GitHub endpoint means editing files that also own the queue logic.

---

## 2. Target Directory Structure

```
server/src/analyze/
│
├── index.js                          ← re-exports the router (unchanged)
│
├── routes/
│   └── analyze.routes.js             ← thin router, imports from sub-module controllers
│
├── middleware/
│   └── validate.middleware.js        ← unchanged
│
├── shared/
│   ├── repoIdentity.js               ← buildRepositoryIdentity, inferRepositoryName, inferRepositoryOwner
│   └── repoQuery.js                  ← resolveRepoFromQuery (used by browser + file modules)
│
├── upload/
│   ├── upload.controller.js
│   └── upload.service.js             ← createOrGetRepository, createAnalysisJob
│
├── history/
│   └── history.controller.js
│
├── localPicker/
│   └── localPicker.controller.js
│
├── githubBrowser/
│   └── githubBrowser.controller.js   ← structure, directory, branches, resolve public, list owned
│
├── fileView/
│   └── fileView.controller.js        ← get + update file
│
└── prCommit/
    └── prCommit.controller.js        ← createPrCommitController + ghFetch helper
```

Each sub-module owns **exactly one feature boundary**. Controllers are thin HTTP adapters; business logic lives in services.

---

## 3. Feature Modules to Extract

### 3.1 Upload / Enqueue Flow

**What moves:** `buildRepositoryIdentity`, `createOrGetRepository`, `createAnalysisJob`, `analyzeController`.

**New files:**

`server/src/analyze/shared/repoIdentity.js`
```js
import path from 'path';
import { parseGitHubRepoUrl } from '../services/githubApi.service.js';

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
```

`server/src/analyze/upload/upload.service.js`
```js
import { pgPool } from '../../infrastructure/connections.js';

export async function createOrGetRepository({ userId, repository }) {
  const result = await pgPool.query(
    `INSERT INTO repositories (
        owner_id, source, full_name, github_owner,
        github_repo, default_branch, last_scanned_at, scan_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
      ON CONFLICT (owner_id, full_name) DO UPDATE
      SET source            = EXCLUDED.source,
          github_owner      = COALESCE(EXCLUDED.github_owner, repositories.github_owner),
          github_repo       = COALESCE(EXCLUDED.github_repo, repositories.github_repo),
          default_branch    = COALESCE(EXCLUDED.default_branch, repositories.default_branch),
          last_scanned_at   = NOW(),
          scan_count        = repositories.scan_count + 1
      RETURNING id`,
    [
      userId,
      repository.source,
      repository.fullName,
      repository.githubOwner,
      repository.githubRepo,
      repository.defaultBranch,
    ],
  );
  return result.rows[0]?.id;
}

export async function createAnalysisJob({ repositoryId, userId, branch }) {
  const result = await pgPool.query(
    `INSERT INTO analysis_jobs (repository_id, user_id, branch, status)
      VALUES ($1, $2, $3, 'queued')
      RETURNING id`,
    [repositoryId, userId, branch || null],
  );
  return result.rows[0]?.id;
}
```

`server/src/analyze/upload/upload.controller.js`
```js
import { redisClient } from '../../infrastructure/connections.js';
import {
  invalidateAnalysisHistoryCacheForUser,
  invalidateRepositoriesCacheForUser,
} from '../../infrastructure/cache.js';
import { enqueueAnalysisJob } from '../../queue/analysisQueue.js';
import { getAuthUser, resolveDatabaseUserId } from '../../utils/authUser.js';
import { buildRepositoryIdentity } from '../shared/repoIdentity.js';
import { createOrGetRepository, createAnalysisJob } from './upload.service.js';

export async function analyzeController(req, res, next) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser?.id) {
      return res.status(401).json({ error: 'Authentication required to start analysis jobs.' });
    }

    const userId = await resolveDatabaseUserId(authUser);
    if (!userId) {
      const err = new Error('Failed to resolve authenticated user record.');
      err.statusCode = 500;
      throw err;
    }

    const repository = buildRepositoryIdentity(req.body);
    const repositoryId = await createOrGetRepository({ userId, repository });

    if (!repositoryId) {
      const err = new Error('Failed to resolve repository record for analysis job.');
      err.statusCode = 500;
      throw err;
    }

    const jobId = await createAnalysisJob({ repositoryId, userId, branch: repository.branch });

    if (!jobId) {
      const err = new Error('Failed to create analysis job.');
      err.statusCode = 500;
      throw err;
    }

    await enqueueAnalysisJob({
      jobId,
      input: {
        ...req.body,
        repositoryId,
        userId,
        githubToken: req.cookies?.github_token,
      },
    });

    await invalidateAnalysisHistoryCacheForUser(redisClient, userId);
    await invalidateRepositoriesCacheForUser(redisClient, userId);

    return res.status(202).json({ jobId });
  } catch (err) {
    return next(err);
  }
}
```

---

### 3.2 Analysis History

**What moves:** `listAnalysisHistoryController` and its SQL + cache logic.

`server/src/analyze/history/history.controller.js`
```js
import { pgPool, redisClient } from '../../infrastructure/connections.js';
import {
  buildAnalysisHistoryCacheKey,
  cacheTtl,
  readJsonCache,
  writeJsonCache,
} from '../../infrastructure/cache.js';
import { getAuthUser, resolveDatabaseUserId } from '../../utils/authUser.js';
import { inferRepositoryName, inferRepositoryOwner } from '../shared/repoIdentity.js';

export async function listAnalysisHistoryController(req, res, next) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser?.id) {
      return res.status(401).json({ error: 'Authentication required to load analysis history.' });
    }

    const requestedUserId = typeof req.query?.userId === 'string' ? req.query.userId.trim() : null;
    if (requestedUserId && requestedUserId !== String(authUser.id)) {
      return res.status(403).json({ error: 'You can only access your own analysis history.' });
    }

    const page  = Math.max(1, Number.parseInt(req.query?.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const userId = await resolveDatabaseUserId(authUser);
    if (!userId) {
      const err = new Error('Failed to resolve authenticated user record.');
      err.statusCode = 500;
      throw err;
    }

    const cacheKey = buildAnalysisHistoryCacheKey({ userId, page, limit });
    const cached   = await readJsonCache(redisClient, cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    // ... (same SQL query as before, unchanged) ...
    // Build responsePayload, write to cache, return 200.

    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (err) {
    return next(err);
  }
}
```

> The SQL queries and response-shaping logic are **moved verbatim** — no logic change, only relocation.

---

### 3.3 Local Picker Flow

**What moves:** `validateLocalPathController`, `browseLocalPathController`, `localPickerCapabilitiesController`.

`server/src/analyze/localPicker/localPicker.controller.js`
```js
import { validateLocalRepository } from '../services/analyze.service.js';
import {
  getLocalPickerCapabilities,
  pickLocalDirectory,
} from '../services/localPicker.service.js';

export async function validateLocalPathController(req, res, next) {
  try {
    const result = await validateLocalRepository(req.body.path);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function browseLocalPathController(_req, res, next) {
  try {
    const selectedPath = await pickLocalDirectory();
    return res.status(200).json({ path: selectedPath });
  } catch (err) {
    return next(err);
  }
}

export async function localPickerCapabilitiesController(_req, res, next) {
  try {
    const capabilities = await getLocalPickerCapabilities();
    return res.status(200).json(capabilities);
  } catch (err) {
    return next(err);
  }
}
```

---

### 3.4 GitHub Repo Browser

**What moves:** `resolvePublicRepoController`, `listOwnedReposController`, `listBranchesController`, `listRepositoryStructureController`, `listRepositoryDirectoryController`.

`server/src/analyze/githubBrowser/githubBrowser.controller.js`
```js
import {
  fetchOwnedRepositories,
  fetchRepoBranches,
  fetchRepoContents,
  fetchRepoDetails,
  fetchRepoTree,
  resolvePublicRepository,
} from '../services/githubApi.service.js';
import { resolveRepoFromQuery } from '../shared/repoQuery.js';

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
    const result = await fetchOwnedRepositories({ token: req.cookies?.github_token });
    return res.status(200).json({
      repositories: result.repositories,
      scopes: result.scopes,
    });
  } catch (err) {
    // error-specific 401 / 403 handling stays identical to current code
    if (err.statusCode === 401) {
      return res.status(401).json({
        error: err.message,
        loginUrl: '/api/auth/github?reauth=1',
        action: 'Re-authenticate with GitHub…',
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

    // tree-walking logic stays identical, just moved here
    // ...

    return res.status(200).json({ repository: { ...}, truncated, directories, files });
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

    return res.status(200).json({ repository: { ... }, path: requestedPath, entries });
  } catch (err) {
    return next(err);
  }
}
```

---

### 3.5 File View & Edit

**What moves:** `getRepositoryFileController`, `updateRepositoryFileController`.

`server/src/analyze/fileView/fileView.controller.js`
```js
import {
  fetchRepoDetails,
  fetchRepoFileContent,
  parseGitHubRepoUrl,
  updateRepoFileContent,
} from '../services/githubApi.service.js';
import { resolveRepoFromQuery } from '../shared/repoQuery.js';

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
      repository: { owner: repoDetails.owner, repo: repoDetails.repo, ...},
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
    const token  = source === 'owned' ? req.cookies?.github_token : undefined;

    let targetOwner = req.body.owner || '';
    let targetRepo  = req.body.repo  || '';

    if ((!targetOwner || !targetRepo) && typeof req.body.url === 'string') {
      const parsed = parseGitHubRepoUrl(req.body.url);
      targetOwner  = parsed.owner;
      targetRepo   = parsed.repo;
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
```

---

### 3.6 PR / Commit Flow

**What moves:** `createPrCommitController` and the inline `ghFetch` helper.

`server/src/analyze/prCommit/prCommit.service.js`
```js
// Thin GitHub API helper — isolated here so prCommit.controller stays readable.
export async function ghFetch(method, apiPath, body, token) {
  const url = `https://api.github.com${apiPath}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'polyglot',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`GitHub API ${method} ${apiPath} failed: ${resp.status} ${text}`);
    err.statusCode = resp.status;
    throw err;
  }

  return resp.json();
}
```

`server/src/analyze/prCommit/prCommit.controller.js`
```js
import { ghFetch } from './prCommit.service.js';

export async function createPrCommitController(req, res, next) {
  try {
    const token = req.cookies?.github_token;
    if (!token) {
      const err = new Error('GitHub authentication required to create a PR.');
      err.statusCode = 401;
      throw err;
    }

    // Destructure + validate inputs (unchanged from current code)
    const { owner, repo, path, content, sourceBranch, targetBranch,
            branch, commitMessage, prTitle, prBody, createPullRequest, sha } = parseBody(req.body);

    // Fetch repo details, ensure head branch, commit file, create PR
    // (all logic moved verbatim, just calling ghFetch from the service)

    return res.status(200).json({ ok: true, prUrl, prNumber, savedBranch, baseBranch, file });
  } catch (err) {
    return next(err);
  }
}

// Private helper to keep the controller readable
function parseBody(body) {
  return {
    owner:             typeof body.owner         === 'string' ? body.owner.trim()         : '',
    repo:              typeof body.repo          === 'string' ? body.repo.trim()          : '',
    path:              typeof body.path          === 'string' ? body.path.trim()          : '',
    content:           typeof body.content       === 'string' ? body.content              : null,
    sourceBranch:      typeof body.sourceBranch  === 'string' && body.sourceBranch  ? body.sourceBranch  : null,
    targetBranch:      typeof body.targetBranch  === 'string' && body.targetBranch  ? body.targetBranch  : null,
    branch:            typeof body.branch        === 'string' && body.branch        ? body.branch        : null,
    commitMessage:     typeof body.commitMessage === 'string' ? body.commitMessage       : `Update ${body.path} via PolyGlot`,
    prTitle:           typeof body.prTitle       === 'string' ? body.prTitle             : `Update ${body.path}`,
    prBody:            typeof body.prBody        === 'string' ? body.prBody              : '',
    createPullRequest: body.createPullRequest !== false,
    sha:               typeof body.sha           === 'string' && body.sha           ? body.sha           : null,
  };
}
```

---

## 4. Shared Helpers to Extract

Two helpers are currently private functions inside `analyze.controller.js` but are used by multiple sub-modules after the split.

`server/src/analyze/shared/repoQuery.js`
```js
import { parseGitHubRepoUrl } from '../services/githubApi.service.js';

/**
 * Extracts owner/repo/branch/token from a GET query string.
 * Used by: githubBrowser, fileView.
 */
export function resolveRepoFromQuery(req) {
  const source = req.query.source === 'owned' ? 'owned' : 'public';
  const token  = source === 'owned' ? req.cookies?.github_token : undefined;

  let owner  = typeof req.query.owner  === 'string' ? req.query.owner.trim()  : '';
  let repo   = typeof req.query.repo   === 'string' ? req.query.repo.trim()   : '';
  const branch = typeof req.query.branch === 'string' ? req.query.branch.trim() : '';

  if ((!owner || !repo) && typeof req.query.url === 'string') {
    const parsed = parseGitHubRepoUrl(req.query.url);
    owner = parsed.owner;
    repo  = parsed.repo;
  }

  if (!owner || !repo) {
    const err = new Error('Repository lookup requires owner/repo or a valid GitHub URL.');
    err.statusCode = 400;
    throw err;
  }

  return { source, token, owner, repo, branch };
}
```

---

## 5. Rewiring Routes

`server/src/analyze/routes/analyze.routes.js` becomes a thin import hub — **no logic lives here.**

```js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

// Middleware
import {
  validateAnalyzeBody,
  validateBranchQuery,
  validateLocalPathBody,
  validatePublicRepoBody,
  validateRepoBrowserQuery,
  validateRepoFileQuery,
  validateRepoFileUpdateBody,
} from '../middleware/validate.middleware.js';

// Sub-module controllers
import { analyzeController }                                      from '../upload/upload.controller.js';
import { listAnalysisHistoryController }                          from '../history/history.controller.js';
import { validateLocalPathController, browseLocalPathController,
         localPickerCapabilitiesController }                      from '../localPicker/localPicker.controller.js';
import { resolvePublicRepoController, listOwnedReposController,
         listBranchesController, listRepositoryStructureController,
         listRepositoryDirectoryController }                      from '../githubBrowser/githubBrowser.controller.js';
import { getRepositoryFileController,
         updateRepositoryFileController }                         from '../fileView/fileView.controller.js';
import { createPrCommitController }                               from '../prCommit/prCommit.controller.js';

const router = Router();
const lim = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});

// Upload
router.post('/',                          lim, validateAnalyzeBody,           analyzeController);

// History
router.get('/history',                    lim,                                listAnalysisHistoryController);

// Local picker
router.get('/local/picker-capabilities',  lim,                                localPickerCapabilitiesController);
router.get('/local/browse',               lim,                                browseLocalPathController);
router.post('/local/validate',            lim, validateLocalPathBody,         validateLocalPathController);

// GitHub browser
router.post('/github/public/resolve',     lim, validatePublicRepoBody,        resolvePublicRepoController);
router.get('/github/repos',               lim,                                listOwnedReposController);
router.get('/github/branches',            lim, validateBranchQuery,           listBranchesController);
router.get('/github/structure',           lim, validateRepoBrowserQuery,      listRepositoryStructureController);
router.get('/github/contents',            lim, validateRepoBrowserQuery,      listRepositoryDirectoryController);

// File view & edit
router.get('/github/file',                lim, validateRepoFileQuery,         getRepositoryFileController);
router.put('/github/file',                lim, validateRepoFileUpdateBody,    updateRepositoryFileController);

// PR / commit
router.post('/commit',                    lim,                                createPrCommitController);

export default router;
```

The route table is now a **single-screen truth table** — you can see every endpoint, its middleware, and its controller in one pass.

---

## 6. Client-Side (analyzeService.js)

The client service already has a good shape — each method maps to exactly one server endpoint. The only improvement is splitting it so each feature boundary has its own service file, matching the server split:

```
client/src/features/analyze/services/
├── upload.service.js         ← analyzeCodebase (POST /)
├── history.service.js        ← getAnalysisHistory (GET /history)
├── localPicker.service.js    ← validateLocalPath, browse, capabilities
├── githubBrowser.service.js  ← structure, directory, branches, repos, resolve
├── fileView.service.js       ← getFileContent, saveFileContent
└── prCommit.service.js       ← commitCreatePR, saveProtectedBranch
```

Each file follows the exact same pattern — just narrower:

`client/src/features/analyze/services/prCommit.service.js`
```js
import axios from 'axios';
import { buildRepoParams } from './_shared.js';

const analyzeClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export const prCommitService = {
  async commitCreatePR(repository, options) {
    const { data } = await analyzeClient.post('/api/analyze/commit', {
      ...buildRepoParams(repository),
      ...options,
    });
    return data;
  },

  async saveProtectedBranch(repository, options) {
    const { data } = await analyzeClient.post('/api/analyze/commit', {
      ...buildRepoParams(repository),
      ...options,
      createPullRequest: false,
    });
    return data;
  },
};
```

`client/src/features/analyze/services/_shared.js`
```js
// Shared param builder — used by all client service files.
export function buildRepoParams(repository, extra = {}) {
  const params = {
    source: repository?.mode === 'owned' ? 'owned' : 'public',
    ...extra,
  };

  if (repository?.owner && repository?.repo) {
    params.owner = repository.owner;
    params.repo  = repository.repo;
  } else if (repository?.url) {
    params.url = repository.url;
  }

  if (repository?.branch) params.branch = repository.branch;

  return params;
}
```

Import sites that currently do `import { analyzeService } from './services/analyzeService'` change to import the specific service they need:

```js
// Before
import { analyzeService } from '../services/analyzeService';
analyzeService.commitCreatePR(...)

// After
import { prCommitService } from '../services/prCommit.service';
prCommitService.commitCreatePR(...)
```

---

## 7. Migration Order

Do this **one sub-module at a time**, not all at once, so the app stays green throughout:

```
Step 1  →  Extract shared/repoIdentity.js and shared/repoQuery.js
            (used everywhere; do this first so later steps can import from it)

Step 2  →  Extract upload/ (highest value, most requested)

Step 3  →  Extract history/

Step 4  →  Extract localPicker/

Step 5  →  Extract githubBrowser/

Step 6  →  Extract fileView/

Step 7  →  Extract prCommit/

Step 8  →  Slim down analyze.routes.js to the import hub shown above

Step 9  →  Delete analyze.controller.js (it should be empty by this point)

Step 10 →  Split client analyzeService.js into per-feature files
```

After each step: run lint + the test subset that covers that feature, confirm the route still responds as before.

---

## 8. Testing Checklist

For each extracted module, write or update tests to cover:

**Upload**
- `POST /api/analyze` → 401 when not authenticated
- `POST /api/analyze` → 202 + `jobId` for valid github source
- `POST /api/analyze` → 202 + `jobId` for valid local source
- Repository upsert is idempotent (second call does not duplicate rows)
- Analysis job is enqueued after DB insert
- Cache is invalidated for history and repositories after upload

**History**
- `GET /api/analyze/history` → 401 when not authenticated
- `GET /api/analyze/history` → 403 when requesting another user's history
- Returns paginated result + cache HIT on second call

**Local Picker**
- `POST /api/analyze/local/validate` → 200 for valid path
- `GET /api/analyze/local/browse` → returns selected path

**GitHub Browser**
- `GET /api/analyze/github/structure` → 400 without owner/repo
- `GET /api/analyze/github/repos` → 401 / 403 with correct error shapes

**File View**
- `GET /api/analyze/github/file` → 400 without path
- `PUT /api/analyze/github/file` → 403 for public source

**PR / Commit**
- `POST /api/analyze/commit` → 401 without token
- `POST /api/analyze/commit` → 400 when main is used as head branch
- `POST /api/analyze/commit` → 200 with `prUrl` when `createPullRequest = true`

---

## Summary

| Before | After |
|---|---|
| 1 controller file, ~800 lines | 6 controller files, ~50–120 lines each |
| 1 service file holding everything | 2 shared helpers + 2 upload service functions |
| Routes import from one giant controller | Routes import from focused sub-modules |
| Client has 1 service file with all methods | Client has 6 narrow service files + 1 shared helper |
| Any change risks any feature | Each feature is independently touchable |

No endpoint URLs change. No client payloads change. No database queries change. This is purely a **file and responsibility reorganization.**