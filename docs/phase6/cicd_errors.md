# CI/CD Error Documentation — Best Practices Implementation

**Date:** 2026-06-08
**Branch:** Changes from implementing `docs/phase6/best_practices_guide.md`
**CI Pipeline:** `.github/workflows/ci.yml`

---

## Error Summary

| # | Error | Severity | Root Cause | Files Affected |
|---|---|---|---|---|
| 1 | `ERR_MODULE_NOT_FOUND: Cannot find package 'pino'` | **Critical** | `pino` added to `logger.js` but not in `package.json` | `server/src/utils/logger.js` → cascades to 20+ files |
| 2 | `Upload test returns 500 instead of 202` | **Critical** | Cascading failure from Error #1 | `test/upload.feature.test.js` |
| 3 | Rolldown parse error: `await` outside async | **Critical** | Pre-existing bug in `graphRepositoryFactory.js` | `server/src/infrastructure/db/graphRepositoryFactory.js` |
| 4 | Vitest empty test suite errors (21 files) | **Medium** | Pre-existing: test files contain no test suites | `test/*.test.js` (21 files) |

---

## Error #1 — Missing `pino` Package (Critical)

### Symptom
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pino' imported from
D:\GitHub\codegraph-ai\server\src\utils\logger.js
```

### Root Cause
The `logger.js` file was upgraded from a console-based logger to use `pino`:
```js
// server/src/utils/logger.js (CHANGED)
import pino from 'pino';
export const logger = pino({ ... });
```

But `pino` was **never added to `server/package.json`** dependencies.

### Impact
This error cascades to **every file that imports `logger.js`** (directly or transitively):

| Direct importers | Transitive importers |
|---|---|
| `analysisQueue.js` | `app.js` (via `requestLogger`) |
| `github.webhook.js` | `repositories.routes.js` (via `errorHandler.middleware.js`) |
| `GitHubPRService.js` | `ai.routes.js` (via `errorHandler.middleware.js`) |
| `FunctionChunker.js` | `analysisQueue.js` → all agent files |
| `cache.js` (dynamic import) | `errorHandler.middleware.js` → all route files |
| `errorHandler.middleware.js` | `graphRepositoryFactory.js` |
| `cacheMetricsPersistence.js` | Every test that imports any of the above |

**Result:** 20+ test files fail to load, 34 individual tests fail.

### Fix Required
```bash
cd server && npm install pino
```

---

## Error #2 — Upload Test Returns 500 Instead of 202

### Symptom
```
FAIL test/upload.feature.test.js > upload analyze flow > enqueues analysis job and returns 202 with jobId
AssertionError: expected 500 to be 202
```

### Root Cause
Cascading failure from Error #1. The `upload.controller.js` imports `logger.js` (transitively through `analysisQueue.js`), which fails to load due to missing `pino`. The route handler throws a 500 error.

### Fix Required
Resolved by fixing Error #1 (installing `pino`).

---

## Error #3 — Rolldown Parse Error: `await` Outside Async

### Symptom
```
RolldownError: Parse failure:
`await` is only allowed within async functions and at the top levels of modules
17:   const { logger } = await import("/src/utils/logger.js");
At file: /src/infrastructure/db/graphRepositoryFactory.js:17:21
```

### Root Cause
In `graphRepositoryFactory.js`, there's a top-level `await import()` inside a **non-async function**:

```js
// graphRepositoryFactory.js:17 — BROKEN
const { logger } = await import("/src/utils/logger.js");
```

This is inside `createGraphRepository()` which is **not** marked as `async`. The `await` keyword is only valid inside `async` functions or at the module's top-level scope.

### Impact
Vitest's Rolldown bundler cannot parse this file, causing test failures for any test that imports modules depending on `graphRepositoryFactory.js`.

### Fix Required
Either:
1. Make `createGraphRepository` async and await all callers, OR
2. Replace `await import()` with a static `import` at the top of the file

---

## Error #4 — Vitest Empty Test Suite Warnings (21 files)

### Symptom
```
FAIL test/ai.queries.test.js [ test/ai.queries.test.js ]
Error: No test suite found in file D:/GitHub/codegraph-ai/server/test/ai.queries.test.js
```

(Repeats for 21 test files)

### Root Cause
These test files exist but contain no actual `describe()`/`it()`/`test()` blocks. They are placeholder files with only setup code or no exports. Vitest treats them as failed suites because they load but define zero tests.

### Affected Files
- `test/ai.queries.test.js`
- `test/ai.snippet-impact.test.js`
- `test/ai.suggest-refactor.test.js`
- `test/cache.metrics.test.js`
- `test/cacheMetricsPersistence.test.js`
- `test/createPrCommit.test.js`
- `test/dynamic-db-selection.test.js`
- `test/function-chunker.test.js`
- `test/githubBrowser.feature.test.js`
- `test/graph-rag-expander.test.js`
- `test/graph.heatmap.test.js`
- `test/history.feature.test.js`
- `test/jobs.stream.auth.test.js`
- `test/localPicker.feature.test.js`
- `test/parser.multilang.test.js`
- `test/pr-comment.test.js`
- `test/repositories.cache-metrics.test.js`
- `test/snippet.analyzer.confidence.test.js`
- `test/vitest.setup.js`

### Impact
These inflate the test failure count but are **pre-existing** — not caused by the best practices changes.

---

## CI Pipeline Results

### Client Build
| Step | Status |
|---|---|
| `npm ci` | ✅ Pass (after clean install) |
| `npm run build` (vite build) | ✅ Pass (with chunk size warning) |

### Server Unit Tests (vitest)
| Step | Status |
|---|---|
| `npm run test:unit` | ❌ 22 failed / 4 passed (26 total) |

### Server Integration Tests (node --test)
| Step | Status |
|---|---|
| `npm test` | ❌ 26 failed / 8 passed (34 total) |

---

## Pre-existing vs. New Errors

| Error | Pre-existing? | Caused by best practices changes? |
|---|---|---|
| #1 Missing `pino` | **No** | **Yes** — `logger.js` was rewritten to use `pino` |
| #2 Upload test 500 | **No** | **Yes** — cascading from #1 |
| #3 `await` outside async | **Yes** | **No** — existed before changes |
| #4 Empty test suites | **Yes** | **No** — existed before changes |

---

## Required Fixes (Not Applied Yet)

1. **Install `pino`:** `cd server && npm install pino`
2. **Fix `graphRepositoryFactory.js`:** Make `createGraphRepository` async or use static import
3. (Optional) Populate empty test suites or exclude them from test runs
