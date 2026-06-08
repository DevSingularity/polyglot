# PolyGlot — Full-Stack Best Practices Guide

> **Scope:** Server (Express + BullMQ + Postgres + Neo4j + Redis) and Client (React + Redux Toolkit + Vite).  
> **Goal:** Systematic, prioritised improvements that increase maintainability, readability, and scalability — grounded in what the codebase actually looks like today.  
> Every section identifies the real problem, explains why it matters, and gives a concrete code example from your own patterns.

---

## Table of Contents

1. [Priority Map — Read This First](#1-priority-map--read-this-first)
2. [Server: Architecture & Structure](#2-server-architecture--structure)
3. [Server: Error Handling & Validation](#3-server-error-handling--validation)
4. [Server: Database Patterns](#4-server-database-patterns)
5. [Server: Caching Layer](#5-server-caching-layer)
6. [Server: Agents & Queue](#6-server-agents--queue)
7. [Server: Auth & Security](#7-server-auth--security)
8. [Server: Logging & Observability](#8-server-logging--observability)
9. [Client: Component Architecture](#9-client-component-architecture)
10. [Client: State Management (Redux)](#10-client-state-management-redux)
11. [Client: API Layer](#11-client-api-layer)
12. [Client: Error Boundaries & UX](#12-client-error-boundaries--ux)
13. [Cross-Cutting: Shared Types & Constants](#13-cross-cutting-shared-types--constants)
14. [Testing Strategy](#14-testing-strategy)
15. [Implementation Roadmap](#15-implementation-roadmap)

---

## 1. Priority Map — Read This First

Not everything here is equal urgency. Apply this order:

| Priority | Area | Risk if left unfixed |
|---|---|---|
| 🔴 **P0** | Duplicated `inferRepositoryName/Owner` across files | Silent divergence — the two copies will drift |
| 🔴 **P0** | Route files with inline SQL (repositories.routes.js, ai.routes.js) | Untestable, unswappable data layer |
| 🔴 **P0** | `console.log/error` sprinkled everywhere | No structured logs in production, impossible to filter |
| 🟠 **P1** | 1200–1700-line page components (DashboardPage, AnalyzeFilePage) | Every new feature makes the file harder to reason about |
| 🟠 **P1** | No request-level auth middleware — each handler calls `getAuthUser` manually | One missed call = auth bypass |
| 🟠 **P1** | Multiple `axios.create()` instances across client services | No shared interceptors, duplicated base config |
| 🟡 **P2** | No env-var validation at startup | Server boots with missing secrets, fails later at runtime |
| 🟡 **P2** | Redux slices with ad-hoc loading/error state shape | Inconsistent across features, causes repeated boilerplate |
| 🟢 **P3** | Missing barrel `index.js` exports in some feature folders | Noisy import paths |
| 🟢 **P3** | No JSDoc / type comments on public service functions | Fine for now, will matter when the team grows |

---

## 2. Server: Architecture & Structure

### 2.1 — Route files must not own logic

**The problem:** `repositories.routes.js` defines inline functions (`inferRepositoryName`, `inferRepositoryOwner`) and runs SQL queries directly from the route handler. `ai.routes.js` instantiates agents, creates AI clients, and defines SSE helpers inside the same file. These are three different layers collapsed into one.

**The rule:** Routes → Controllers → Services → Infrastructure. Each layer has one job.

```
server/src/api/repositories/
├── routes/
│   └── repositories.routes.js      ← HTTP wiring only: router.get('/', auth, controller)
├── controllers/
│   └── repositories.controller.js  ← req/res shaping, calls service
└── services/
    └── repositories.service.js     ← SQL queries, cache reads/writes
```

**Before (repositories.routes.js today):**
```js
// Route file doing SQL, cache, and business logic
router.get('/', async (req, res, next) => {
  const authUser = getAuthUser(req);
  if (!authUser?.id) return res.status(401).json({ error: 'Authentication required.' });
  // ... 60 more lines of SQL + cache logic
});
```

**After:**
```js
// repositories.routes.js — just wiring
import { listRepositoriesController } from '../controllers/repositories.controller.js';
import { requireAuth } from '../../../middleware/auth.middleware.js';

router.get('/', requireAuth, listRepositoriesController);

// repositories.controller.js — req/res only
export async function listRepositoriesController(req, res, next) {
  try {
    const result = await repositoriesService.list({
      userId: req.userId,      // set by requireAuth middleware
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 25,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

// repositories.service.js — data access
export async function list({ userId, page, limit }) {
  const offset = (page - 1) * limit;
  const cacheKey = buildRepositoriesListCacheKey({ userId, page, limit });
  const cached = await readJsonCache(redisClient, cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const [rows, countRow] = await Promise.all([
    pgPool.query(REPOSITORIES_LIST_SQL, [userId, limit, offset]),
    pgPool.query(REPOSITORIES_COUNT_SQL, [userId]),
  ]);

  const result = buildRepositoriesPayload(rows.rows, countRow.rows[0], { page, limit });
  await writeJsonCache(redisClient, cacheKey, result, cacheTtl.repositoriesSeconds);
  return result;
}
```

### 2.2 — `inferRepositoryName` / `inferRepositoryOwner` are duplicated

These two functions appear verbatim in both `analyze.controller.js` and `repositories.routes.js`. They will drift.

**Fix: extract once to `server/src/shared/repoHelpers.js`**

```js
// server/src/shared/repoHelpers.js
import path from 'path';

export function inferRepositoryName({ source, fullName, githubRepo }) {
  if (githubRepo) return githubRepo;
  if (!fullName) return source === 'local' ? 'Local repository' : 'Unknown repository';

  if (source === 'local') {
    return path.posix.basename(String(fullName).replace(/\\/g, '/')) || 'Local repository';
  }

  const parts = String(fullName).split('/').filter(Boolean);
  return parts[1] || parts[0] || 'Unknown repository';
}

export function inferRepositoryOwner({ source, fullName, githubOwner }) {
  if (githubOwner) return githubOwner;
  if (source === 'local') return 'local';
  return String(fullName || '').split('/').filter(Boolean)[0] || 'unknown';
}
```

Both files then import from this single source.

### 2.3 — Env-var validation at startup

The server boots happily with `JWT_SECRET=undefined` and fails only when the first user logs in. Validate everything before binding.

```js
// server/src/config/env.js
const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',       // or REDIS_HOST / REDIS_PORT
  'JWT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
];

export function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}
```

```js
// server/app.js — call before anything else
import { validateEnv } from './src/config/env.js';
validateEnv();
```

---

## 3. Server: Error Handling & Validation

### 3.1 — Auth as middleware, not per-handler copy-paste

**The problem:** Every protected handler starts with:
```js
const authUser = getAuthUser(req);
if (!authUser?.id) return res.status(401).json({ error: 'Authentication required.' });
const userId = await resolveDatabaseUserId(authUser);
```

One handler that omits this is an auth bypass. The pattern is also noisy.

**Fix: a `requireAuth` middleware that sets `req.userId`:**

```js
// server/src/middleware/auth.middleware.js
import { getAuthUser, resolveDatabaseUserId } from '../utils/authUser.js';

export async function requireAuth(req, res, next) {
  const authUser = getAuthUser(req);
  if (!authUser?.id) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const userId = await resolveDatabaseUserId(authUser);
  if (!userId) {
    return res.status(500).json({ error: 'Failed to resolve user record.' });
  }

  req.authUser = authUser;
  req.userId   = userId;
  next();
}
```

Every protected route becomes:
```js
router.get('/history',  requireAuth, listAnalysisHistoryController);
router.post('/',        requireAuth, validateAnalyzeBody, analyzeController);
```

Controllers shrink by ~10 lines each and the auth path is guaranteed consistent.

### 3.2 — Standardise operational errors

Errors today are built inline: `const err = new Error('...'); err.statusCode = 400; throw err;`. This pattern repeats 30+ times with no shared factory.

```js
// server/src/utils/errors.js
export class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export const errors = {
  notFound:    (msg = 'Not found')          => new AppError(msg, 404, 'NOT_FOUND'),
  forbidden:   (msg = 'Forbidden')          => new AppError(msg, 403, 'FORBIDDEN'),
  badRequest:  (msg = 'Bad request')        => new AppError(msg, 400, 'BAD_REQUEST'),
  unauthorized:(msg = 'Unauthorized')       => new AppError(msg, 401, 'UNAUTHORIZED'),
  internal:    (msg = 'Internal error')     => new AppError(msg, 500, 'INTERNAL'),
};
```

Usage:
```js
// Before
const err = new Error('GitHub source requires owner/repo or a valid GitHub URL.');
err.statusCode = 400;
throw err;

// After
import { errors } from '../../utils/errors.js';
throw errors.badRequest('GitHub source requires owner/repo or a valid GitHub URL.');
```

The error handler already reads `err.statusCode`, so this is drop-in compatible.

### 3.3 — Validation middleware belongs in a shared schema layer

`validate.middleware.js` in the analyze feature is good. The repositories and ai routes do their own ad-hoc validation inline. All validation should use a consistent schema library.

```js
// server/src/middleware/validate.js  (generic wrapper)
import Joi from 'joi';   // or zod — pick one

export function validate(schema, target = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[target], { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    req[target] = value;   // replace with coerced/stripped value
    next();
  };
}
```

```js
// analyze/schemas/analyze.schema.js
import Joi from 'joi';

export const analyzeBodySchema = Joi.object({
  source: Joi.string().valid('github', 'local').required(),
  github: Joi.when('source', {
    is: 'github',
    then: Joi.object({ owner: Joi.string(), repo: Joi.string(), url: Joi.string().uri(), branch: Joi.string() }),
  }),
  localPath: Joi.when('source', { is: 'local', then: Joi.string().required() }),
});
```

---

## 4. Server: Database Patterns

### 4.1 — SQL strings belong in query files, not inline

**The problem:** SQL is scattered inline across route handlers, controllers, and history. When a table column is renamed, you search the codebase for string fragments.

**Fix: co-locate SQL with the service that owns it:**

```js
// server/src/api/repositories/services/repositories.queries.js
export const REPOSITORIES_LIST_SQL = `
  WITH latest_repo_jobs AS (
    SELECT DISTINCT ON (r.id)
      r.id, r.source, r.full_name, r.github_owner, r.github_repo,
      r.default_branch, aj.id AS job_id, aj.status, aj.branch,
      aj.node_count, aj.edge_count,
      COALESCE(aj.completed_at, aj.created_at) AS analyzed_at
    FROM repositories r
    JOIN analysis_jobs aj ON aj.repository_id = r.id
    WHERE r.owner_id = $1
    ORDER BY r.id, COALESCE(aj.completed_at, aj.created_at) DESC
  )
  SELECT * FROM latest_repo_jobs ORDER BY analyzed_at DESC LIMIT $2 OFFSET $3
`;

export const REPOSITORIES_COUNT_SQL = `
  SELECT COUNT(*)::int AS total FROM repositories WHERE owner_id = $1
`;
```

This makes queries grep-able, testable in isolation, and easy to add `EXPLAIN ANALYZE` to.

### 4.2 — Wrap multi-step DB operations in transactions

`createOrGetRepository` + `createAnalysisJob` are two separate queries. If the second fails, an orphan repository row is left behind. Use a transaction:

```js
// upload.service.js
export async function createUploadRecord({ userId, repository }) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const repoResult = await client.query(UPSERT_REPOSITORY_SQL, [
      userId, repository.source, repository.fullName,
      repository.githubOwner, repository.githubRepo, repository.defaultBranch,
    ]);
    const repositoryId = repoResult.rows[0]?.id;

    const jobResult = await client.query(INSERT_ANALYSIS_JOB_SQL, [
      repositoryId, userId, repository.branch || null,
    ]);
    const jobId = jobResult.rows[0]?.id;

    await client.query('COMMIT');
    return { repositoryId, jobId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

### 4.3 — Never `SELECT *` in application queries

All SQL in the codebase uses `SELECT *` or wide `SELECT` lists that include columns the response never sends. Be explicit — it documents intent and prevents accidental exposure of new columns.

```sql
-- Before
SELECT * FROM repositories WHERE owner_id = $1

-- After
SELECT id, source, full_name, github_owner, github_repo, default_branch,
       last_scanned_at, scan_count, starred
FROM repositories
WHERE owner_id = $1
```

---

## 5. Server: Caching Layer

### 5.1 — Cache helpers are good — use them consistently

`infrastructure/cache.js` has well-designed helpers (`readJsonCache`, `writeJsonCache`, `invalidate*`). The problem is that some route handlers bypass them and hit the DB directly. **Any endpoint that reads list data must go through the cache helpers.**

### 5.2 — Extract cache-key builders into a single registry

Cache keys are currently built across multiple files. One typo = permanent cache miss.

```js
// server/src/infrastructure/cacheKeys.js
export const cacheKeys = {
  repositories: (userId, page, limit) => `user:${userId}:repos:p${page}:l${limit}`,
  analysisHistory: (userId, page, limit) => `user:${userId}:history:p${page}:l${limit}`,
  repositoryJobs: (userId, repoId) => `user:${userId}:repo:${repoId}:jobs`,
  graphPayload: (jobId) => `graph:${jobId}`,
  streamExplain: (jobId, questionHash) => `stream:explain:${jobId}:${questionHash}`,
};
```

### 5.3 — Cache invalidation needs an audit

After an upload, both `invalidateAnalysisHistoryCacheForUser` and `invalidateRepositoriesCacheForUser` are called — but only in `analyzeController`. If another code path updates repository data (the star toggle, for example), it must also invalidate the repositories cache. Centralise invalidation in the service, never in the controller:

```js
// repositories.service.js
export async function toggleStar(repoId, userId) {
  await pgPool.query('UPDATE repositories SET starred = NOT starred WHERE id = $1 AND owner_id = $2', [repoId, userId]);
  await invalidateRepositoriesCacheForUser(redisClient, userId); // always here, never in the route
}
```

---

## 6. Server: Agents & Queue

### 6.1 — Agent instantiation at module level vs. per-request

In `ai.routes.js`, agents (`QueryAgent`, `ChatAgent`, `AnalysisAgent`, `SnippetAnalyzerAgent`) are all constructed once at module import time and shared across all requests. This is fine for stateless agents but will cause subtle bugs if an agent accumulates any per-request state.

**Audit each agent:** if its `process()` method writes to `this.*` fields between calls, it must be constructed per-request (or per-job). Stateless agents can stay as module-level singletons.

```js
// Safe — agent is stateless, one instance is fine
const impactAgent = new ImpactAnalysisAgent();

// Unsafe if the agent has mutable per-run state
// Create inside the handler instead:
router.post('/analyze', requireAuth, async (req, res, next) => {
  const agent = new SnippetAnalyzerAgent();  // fresh per request
  // ...
});
```

### 6.2 — Queue worker error handling needs structured logging

```js
// analysisQueue.js — current
worker.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job?.id} failed:`, err.message);
});
```

This loses the stack trace and job input in production. Upgrade to structured logging (see §8) and include enough context to reproduce the failure:

```js
worker.on('failed', (job, err) => {
  logger.error('analysis_job_failed', {
    jobId: job?.id,
    input: job?.data?.input ? { source: job.data.input.source } : null, // no secrets
    error: err.message,
    stack: err.stack,
    attemptsMade: job?.attemptsMade,
  });
});
```

### 6.3 — `SupervisorAgent` should receive a logger, not use `console`

Currently `SupervisorAgent` calls `console.log` internally. Pass a logger instance so the context (jobId, userId) flows through every log line:

```js
// In analysisQueue.js worker
const supervisor = new SupervisorAgent({
  db: pgPool,
  redis: redisClient,
  logger: logger.child({ jobId: job.data.jobId }), // structured child logger
});
```

---

## 7. Server: Auth & Security

### 7.1 — GitHub token handling

`req.cookies?.github_token` is read in at least 8 different places across controllers and route handlers. This is brittle — if the cookie name ever changes, every reference breaks. Centralise it:

```js
// server/src/utils/authUser.js — add this
export function getGitHubToken(req) {
  return req.cookies?.github_token || null;
}
```

All handlers replace `req.cookies?.github_token` with `getGitHubToken(req)`.

### 7.2 — Rate limiters need to be shared, not re-declared

Each route file declares its own `rateLimit(...)` with slightly different configs (`windowMs`, `max`). The limiter instances don't share state, so a user hitting `/api/analyze` 30 times and `/api/ai` 30 times is not being limited holistically.

```js
// server/src/middleware/rateLimiters.js
import rateLimit from 'express-rate-limit';

const base = {
  standardHeaders: true,
  legacyHeaders: false,
};

export const analyzeLimiter  = rateLimit({ ...base, windowMs: 60_000, max: 30 });
export const aiLimiter       = rateLimit({ ...base, windowMs: 60_000, max: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 30) });
export const shareLimiter    = rateLimit({ ...base, windowMs: 15 * 60_000, max: 30 });
export const defaultLimiter  = rateLimit({ ...base, windowMs: 60_000, max: 120 });
```

### 7.3 — Path traversal guard is incomplete

`ai.routes.js` has one path traversal guard:
```js
if (filePath.includes('../') || filePath.includes('..\\')) { ... }
```

This misses encoded forms (`%2e%2e%2f`). Use `path.resolve` and check that the result stays inside the expected root:

```js
import path from 'path';

export function isSafePath(filePath, allowedRoot) {
  const resolved = path.resolve(allowedRoot, filePath);
  return resolved.startsWith(path.resolve(allowedRoot) + path.sep);
}
```

---

## 8. Server: Logging & Observability

### 8.1 — Replace `console` with a structured logger

The codebase uses `console.log`, `console.error`, and `process.stdout.write` directly. Structured logs are:
- Queryable in Datadog / Grafana / Loki without regex
- Filterable by `jobId`, `userId`, `statusCode`
- Consistent in format

```js
// server/src/utils/logger.js  (replace current file)
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty' } }
    : {}),
});

// Usage everywhere:
logger.info({ userId, jobId }, 'Analysis job enqueued');
logger.error({ err, jobId }, 'Analysis job failed');
```

The `requestLogger` middleware in `utils/logger.js` can be rewritten to use pino-http for automatic request/response logs with consistent field names.

### 8.2 — Health check should return degraded status, not 500

```js
// app.js — current health check
app.get('/health', async (_req, res) => {
  const checks = {};
  try { await pgPool.query('SELECT 1'); checks.postgres = 'ok'; }
  catch { checks.postgres = 'error'; }
  // ...
});
```

This currently returns `200` even when Postgres is down. Load balancers and uptime monitors rely on the status code:

```js
app.get('/health', async (_req, res) => {
  const checks = {};
  let healthy = true;

  try { await pgPool.query('SELECT 1'); checks.postgres = 'ok'; }
  catch (e) { checks.postgres = 'error'; healthy = false; }

  try { await redisClient.ping(); checks.redis = 'ok'; }
  catch (e) { checks.redis = 'error'; healthy = false; }

  const statusCode = healthy ? 200 : 503;
  return res.status(statusCode).json({ status: healthy ? 'ok' : 'degraded', checks });
});
```

---

## 9. Client: Component Architecture

### 9.1 — Page components are too large

| File | Lines | Problem |
|---|---|---|
| `AnalyzeFilePage.jsx` | 1739 | Single file with file browser, editor, PR flow, and AI chat |
| `DashboardPage.jsx` | 1238 | Repository list, search/filter, cache metrics, quick-actions, re-analysis |
| `UploadRepoForm.jsx` | 727 | GitHub picker, local picker, branch selector, form state |

Each of these should decompose to a thin page shell + focused sub-components. The rule: **a page component should be 100–200 lines max.** Its job is to compose, not implement.

**Example — DashboardPage decomposition:**

```
features/dashboard/
├── pages/
│   └── DashboardPage.jsx          ← ~80 lines, just layout + composition
├── components/
│   ├── RepositoryList.jsx          ← repository grid/table
│   ├── RepositoryCard.jsx          ← single repository item
│   ├── RepositorySearch.jsx        ← search + sort + filter bar
│   ├── QuickActions.jsx            ← static action cards
│   ├── CacheMetricsPanel.jsx       ← hit rate chart + metrics table
│   └── ReAnalyzeButton.jsx         ← confirm + dispatch analyzeCodebase
└── hooks/
    ├── useRepositoryList.js        ← pagination, search, sort state
    └── useCacheMetrics.js          ← polling + refresh logic
```

`DashboardPage.jsx` becomes:
```jsx
export default function DashboardPage() {
  return (
    <Layout>
      <QuickActions />
      <RepositorySearch />
      <RepositoryList />
      <CacheMetricsPanel />
    </Layout>
  );
}
```

### 9.2 — Extract custom hooks for complex local state

Whenever a component has 5+ `useState` / `useEffect` calls managing related state, extract a hook:

```js
// features/analyze/hooks/useFileEditor.js
export function useFileEditor({ repository, filePath }) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [sha, setSha] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isDirty = content !== originalContent;

  async function loadFile() { /* ... */ }
  async function saveFile({ commitMessage }) { /* ... */ }
  function resetChanges() { setContent(originalContent); }

  return { content, setContent, sha, saving, error, isDirty, loadFile, saveFile, resetChanges };
}
```

The component becomes a thin consumer:
```jsx
const { content, setContent, isDirty, saving, saveFile } = useFileEditor({ repository, filePath });
```

### 9.3 — Co-locate component, styles, and test

```
features/graph/components/UploadRepoForm/
├── index.jsx          ← public export (default export of the component)
├── GithubPicker.jsx   ← sub-component for GitHub repo selection
├── LocalPicker.jsx    ← sub-component for local path
├── BranchSelector.jsx ← branch dropdown
└── UploadRepoForm.test.jsx
```

---

## 10. Client: State Management (Redux)

### 10.1 — Standardise slice loading/error shape

Each slice uses a slightly different shape for async state:

```js
// graphSlice.js
status: 'idle' | 'loading' | 'succeeded' | 'failed'
error: null | string

// aiSlice.js
isLoading: boolean
streamingError: string | null

// analyzeSlice.js
loading: boolean
error: null
```

Pick one canonical shape and apply it everywhere:

```js
// server/src/shared/sliceState.js  (shared utility)
export const asyncState = {
  idle:    { status: 'idle',      error: null },
  loading: { status: 'loading',   error: null },
  success: { status: 'succeeded', error: null },
  failure: (error) => ({ status: 'failed', error }),
};

// In every slice:
extraReducers: (builder) => {
  builder
    .addCase(fetchRepositories.pending,   (state) => { Object.assign(state, asyncState.loading); })
    .addCase(fetchRepositories.fulfilled, (state, action) => {
      Object.assign(state, asyncState.success);
      state.repositories = action.payload.repositories;
    })
    .addCase(fetchRepositories.rejected,  (state, action) => {
      Object.assign(state, asyncState.failure(action.payload ?? action.error.message));
    });
},
```

### 10.2 — Selectors should be memoised and co-located

Today some selectors are inline inside components with `useSelector(state => state.dashboard.repositories.filter(...))`. Filtering inside `useSelector` without `createSelector` re-runs on every render.

```js
// features/dashboard/slices/dashboardSlice.js — co-locate selectors
import { createSelector } from '@reduxjs/toolkit';

const selectDashboard = (state) => state.dashboard;

export const selectAnalyzedRepositories = createSelector(
  selectDashboard,
  (dashboard) => dashboard.repositories,
);

export const selectFilteredRepositories = createSelector(
  selectAnalyzedRepositories,
  (_, searchTerm) => searchTerm,
  (repositories, searchTerm) =>
    searchTerm
      ? repositories.filter((r) => r.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : repositories,
);
```

### 10.3 — `createAsyncThunk` error shape should be consistent

Currently `rejectWithValue` is used in some thunks but not others, and what gets passed to it varies. Define a shared error serialiser:

```js
// client/src/app/thunkError.js
export function serializeThunkError(err) {
  return (
    err?.response?.data?.error ||
    err?.payload?.error ||
    err?.message ||
    'An unexpected error occurred.'
  );
}

// In every thunk:
} catch (err) {
  return rejectWithValue(serializeThunkError(err));
}
```

---

## 11. Client: API Layer

### 11.1 — One `axios` instance, not one per service file

**Current:**
```js
// graphService.js
const graphClient = axios.create({ baseURL: apiBaseUrl, withCredentials: true });

// aiService.js
const aiClient = axios.create({ baseURL: apiBaseUrl, withCredentials: true });

// analyzeService.js
const analyzeClient = axios.create({ baseURL: apiBaseUrl, withCredentials: true });
```

Three instances = three places to update when base config changes, and no shared interceptors for error handling or token refresh.

**Fix: one shared client:**

```js
// client/src/lib/apiClient.js
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor — centralised error normalisation
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status  = error.response?.status;
    const message = error.response?.data?.error || error.message;

    if (status === 401) {
      // Redirect to login or dispatch logout action
      window.location.href = '/login';
    }

    return Promise.reject({ status, message, raw: error });
  },
);
```

All service files import `apiClient` instead of calling `axios.create()`.

### 11.2 — SSE stream handling belongs in a single utility

`aiService.js` has a `readSseStream` function with its own buffer management. If SSE is used from another service in the future, this will be duplicated.

```js
// client/src/lib/sseStream.js
export async function readSseStream(response, { onChunk, onDone, onError } = {}) {
  if (!response.body) throw new Error('Streaming response body is not available.');

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          onChunk?.(payload);
          if (payload.done) { onDone?.(payload); return; }
        } catch { /* skip malformed SSE line */ }
      }
    }
    onDone?.({});
  } catch (err) {
    onError?.(err);
  } finally {
    reader.releaseLock();
  }
}
```

---

## 12. Client: Error Boundaries & UX

### 12.1 — No React Error Boundary exists

If `CytoscapeGraphView` or `FlowGraphView` throws a render-time error, the entire app unmounts. Add error boundaries at feature boundaries:

```jsx
// client/src/components/ErrorBoundary.jsx
import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-6 text-destructive">
          <p className="font-semibold">Something went wrong.</p>
          <p className="text-sm">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

```jsx
// Wrap risky features
<ErrorBoundary fallback={<GraphLoadError />}>
  <GraphView jobId={jobId} />
</ErrorBoundary>
```

### 12.2 — Loading and error states need shared primitives

Each page implements its own loading spinner and error message. Create shared primitives:

```jsx
// client/src/components/ui/AsyncState.jsx
export function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground p-6">
      <Loader2 className="animate-spin size-4" />
      <span>{message}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="p-6 text-destructive space-y-2">
      <p>{message}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
```

---

## 13. Cross-Cutting: Shared Types & Constants

### 13.1 — Repository source constants

`'github'` and `'local'` are stringly-typed across the entire stack. One typo is a silent bug.

```js
// server/src/shared/constants.js  (and client mirror)
export const REPO_SOURCE = Object.freeze({
  GITHUB: 'github',
  LOCAL:  'local',
});

export const JOB_STATUS = Object.freeze({
  QUEUED:     'queued',
  PROCESSING: 'processing',
  COMPLETED:  'completed',
  FAILED:     'failed',
});
```

### 13.2 — Consider a `shared/` package for true cross-stack constants

If the monorepo structure allows, a `packages/shared/` that both `server` and `client` import means the constants above are literally the same file. Until then, maintain a `server/src/shared/constants.js` and `client/src/lib/constants.js` that are kept in sync (and are easy to verify in code review).

---

## 14. Testing Strategy

### 14.1 — What to test at each layer

| Layer | Test type | What to cover |
|---|---|---|
| Service functions | Unit | SQL query shape, cache hit/miss, error paths |
| Controllers | Unit + mocks | Auth rejection, correct service call, response shape |
| Route integration | Supertest | Full HTTP cycle including middleware chain |
| Redux slices | Unit | Each `extraReducers` case, selector output |
| React components | React Testing Library | User interactions, conditional renders, error states |
| Agents | Unit | `process()` with mock inputs, `buildResult()` shape |

### 14.2 — Test file co-location

Keep tests next to the code they test:

```
upload/
├── upload.controller.js
├── upload.service.js
└── __tests__/
    ├── upload.controller.test.js
    └── upload.service.test.js
```

Not in a top-level `__tests__/` folder that mirrors the whole tree.

### 14.3 — Minimum test coverage targets (pragmatic)

Don't target 100%. Target the high-risk paths:

- Auth middleware: 100% branch coverage
- `createUploadRecord` transaction: success + rollback paths
- `inferRepositoryName` / `inferRepositoryOwner`: all branches
- Cache key builders: correct output for known inputs
- Error handler: status code resolution for each case

---

## 15. Implementation Roadmap

Apply these in waves, each wave keeping the app fully functional:

### Wave 1 — No-risk extractions (1–2 days)

1. Extract `inferRepositoryName` / `inferRepositoryOwner` to `server/src/shared/repoHelpers.js`, update both import sites.
2. Extract `getGitHubToken(req)` to `authUser.js`.
3. Create `server/src/utils/errors.js` (`AppError`, `errors.*`), start replacing inline error construction.
4. Create `server/src/middleware/rateLimiters.js`, replace the per-file `rateLimit()` declarations.
5. Create `client/src/lib/apiClient.js`, migrate `graphService.js` first (safest), then the others.

### Wave 2 — Structural (3–5 days)

6. Add `requireAuth` middleware; remove the per-handler auth boilerplate from all protected routes.
7. Add `validateEnv()` to startup.
8. Extract repositories route → controller → service (the biggest inline-SQL offender).
9. Extract AI route agents into `controllers/` + `services/` pattern.
10. Decompose `DashboardPage.jsx` into sub-components + hooks.

### Wave 3 — Quality (3–5 days)

11. Replace `console` calls with `pino` logger throughout server.
12. Wrap `createOrGetRepository` + `createAnalysisJob` in a DB transaction.
13. Standardise Redux slice loading/error shape across all slices.
14. Add `ErrorBoundary` wrappers around graph views and AI panel.
15. Add `LoadingState` / `ErrorState` shared components, refactor page-level loaders.

### Wave 4 — Hardening (ongoing)

16. Add env-var validation.
17. Replace path traversal `includes('..')` guard with `path.resolve` check.
18. Add integration tests for auth middleware and upload service transaction.
19. Begin `AnalyzeFilePage` decomposition (largest single file, most risk to leave monolithic).
20. Document public service function signatures with JSDoc.

---

## Quick-Reference Summary

```
SERVER
├── shared/
│   ├── repoHelpers.js       ← inferRepositoryName, inferRepositoryOwner
│   └── constants.js         ← REPO_SOURCE, JOB_STATUS
├── config/
│   └── env.js               ← validateEnv() at startup
├── utils/
│   ├── errors.js            ← AppError, errors.badRequest() etc.
│   ├── authUser.js          ← getAuthUser, resolveDatabaseUserId, getGitHubToken
│   └── logger.js            ← pino structured logger
├── middleware/
│   ├── auth.middleware.js   ← requireAuth (sets req.userId)
│   ├── rateLimiters.js      ← shared limiter instances
│   └── validate.js          ← generic Joi/Zod wrapper
└── each api/feature/
    ├── routes/              ← HTTP wiring only
    ├── controllers/         ← req/res shaping
    └── services/            ← SQL, cache, business logic

CLIENT
├── lib/
│   ├── apiClient.js         ← one axios instance, shared interceptors
│   ├── sseStream.js         ← readSseStream utility
│   └── constants.js         ← mirrors server constants
├── components/
│   ├── ErrorBoundary.jsx
│   └── ui/AsyncState.jsx    ← LoadingState, ErrorState
└── each feature/
    ├── pages/               ← thin shells, 100-200 lines max
    ├── components/          ← focused sub-components
    ├── hooks/               ← extracted local state logic
    ├── services/            ← api calls using apiClient
    └── slices/              ← consistent status/error shape + memoised selectors
```