# Polyglot Phase 6 — Feature Audit, Gap Analysis & Creator Guide
> Including Proper RAG Implementation Roadmap

Session implementation log for the work completed in this chat: [SESSION_IMPLEMENTATION_LOG_2026-06-08.md](SESSION_IMPLEMENTATION_LOG_2026-06-08.md)

---

## 1. Executive Summary

This document audits the Polyglot Phase 6 codebase against the Industry-Grade Feature Expansion Specification. It classifies every required feature as Implemented, Partial, or Missing, then provides a step-by-step Creator Guide to close every gap — without removing any existing code.

The codebase is substantially built. The agentic pipeline, dual-database graph storage, vector RAG, multi-turn chat, and repository explorer are all functional. The main gaps are: line-level impact analysis, raw code storage for true RAG, a directories DB table, an integrated code-editor impact trigger, and the PR-commit flow from the file editor.

---

## 2. Complete Feature Status Matrix

### 2.1 Backend — Ingestion & Parsing Pipeline

| Feature / Component | Status | Notes |
|---|---|---|
| Repository ingestion (GitHub + local) | ✅ Implemented | `IngestionAgent.js` handles GitHub API clone and local zip |
| Scanner — file discovery | ✅ Implemented | `ScannerAgent.js` traverses directory, builds manifest |
| Multi-language parser (JS/TS/Py/Go/SQL) | ✅ Implemented | `PolyglotParserAgent` + tree-sitter workers + `pythonWorker` |
| GraphBuilderAgent | ✅ Implemented | Builds node/edge map from parsed files |
| RelationshipExtractorAgent | ✅ Implemented | Extracts `IMPORTS`, `CALLS`, `DEFINES`, `EXTENDS` typed edges |
| EnrichmentAgent + ContractInferenceAgent | ✅ Implemented | AI-generated summaries and API contract inference |
| EmbeddingAgent (file-level) | ✅ Implemented | Batches file metadata → `text-embedding-3-small` → `file_embeddings` table |
| FunctionChunker (function-level) | ✅ Implemented | Embeds function name + calls + file summary → `function_embeddings` |
| PersistenceAgent | ✅ Implemented | Delegates to `graphRepo` (Postgres or Neo4j) |
| SupervisorAgent orchestration | ✅ Implemented | Full 10-step pipeline with status updates and audit logging |
| BullMQ analysis queue | ✅ Implemented | `analysisQueue.js` with async job processing |
| **Raw code content storage** | ❌ Missing | No `raw_content` column anywhere. Embeddings use AI summaries, not actual code |
| **Directories DB table** | ❌ Missing | No `directories` table. Structure fetched live from GitHub API each time |
| **Code Chunks table** | ❌ Missing | Spec requires chunk-level storage (`file_id`, `chunk_index`, `content`, `embedding`) |

---

### 2.2 Graph Storage — PostgreSQL + Neo4j

| Feature / Component | Status | Notes |
|---|---|---|
| PostgreSQL schema — core tables | ✅ Implemented | `users`, `repositories`, `analysis_jobs`, `graph_nodes`, `graph_edges` (migrations 001–008) |
| pgvector extension + `file_embeddings` | ✅ Implemented | ivfflat cosine index, 1536-dim vectors |
| `function_embeddings` table | ✅ Implemented | Migration 009 — ivfflat index, UNIQUE per job+file+function |
| `conversations` + `conversation_messages` | ✅ Implemented | Migration 009 — multi-turn chat history with trigger for `updated_at` |
| Neo4j dual-backend support | ✅ Implemented | `Neo4jGraphRepository.js` + `dbSelector.js` picks at job-time |
| Neo4j RAG context schema (V002) | ✅ Implemented | Cypher constraints + indexes for `ApiEndpoint`, `DatabaseTable`, `EventChannel` |
| **`directories` table (hierarchy storage)** | ❌ Missing | Spec requires `id`, `repository_id`, `parent_directory_id`, `path`, `depth_level` |
| **`files` table with `raw_content`** | ❌ Missing | Spec requires `raw_content TEXT` column. Currently only `graph_nodes` with metadata |

---

### 2.3 Impact Analysis

| Feature / Component | Status | Notes |
|---|---|---|
| ImpactAnalysisAgent — file-level BFS | ✅ Implemented | 6-hop BFS via Postgres `graph_edges` or Neo4j `IMPORTS` traversal |
| Dual-backend BFS (Neo4j + Postgres fallback) | ✅ Implemented | Reads `db_type` from `analysis_jobs`, falls back gracefully |
| ImpactAnalysisService (webhook/PR use) | ✅ Implemented | `findImpactedFiles()` + `analyzeChangeRisk()` for PR comment flow |
| `GET /:jobId/impact` endpoint | ✅ Implemented | Secured, rate-limited, returns direct/near/far transitive nodes |
| ImpactPanel UI (file-level) | ✅ Implemented | Red/orange/yellow severity groups with expandable node lists |
| **Line-level impact output** | ❌ Missing | Only file paths returned. Spec requires line ranges e.g. `"lines 18-25"` |
| **Code editor line selection → impact trigger** | ❌ Missing | `AnalyzeFilePage` has no click-a-line → run impact flow |
| **Right sidebar with dependency type labels** | ❌ Missing | Spec: sidebar showing `CALL` / `IMPORT` / `EXTENDS` per impacted entry |

---

### 2.4 RAG — Retrieval-Augmented Generation

| Feature / Component | Status | Notes |
|---|---|---|
| QueryAgent — semantic NLQ (one-shot) | ✅ Implemented | Embeds question → pgvector cosine → top-20 → keyword rerank → LLM JSON |
| ChatAgent — multi-turn streaming | ✅ Implemented | SSE stream, conversation history from DB, AbortSignal support |
| GraphRagExpander — graph-context expansion | ✅ Implemented | Expands seed paths via `graph_edges` neighbors or `Neo4jGraphRepository` |
| Function-level retrieval in ChatAgent | ✅ Implemented | Queries `function_embeddings`, attaches top matches to file context |
| Keyword reranking hybrid | ✅ Implemented | Combined score: keyword 0.5 + semantic 0.35 + position 0.15 |
| Redis cache for queries and streams | ✅ Implemented | TTL=1h, keyed by SHA-256(question), best-effort write |
| `POST /api/ai/chat` SSE endpoint | ✅ Implemented | Wired to `ChatAgent`, persists `conversation_messages` after stream |
| Saved queries table | ✅ Implemented | `saved_queries` table; `QueryAgent` inserts after each NLQ |
| **Raw code in RAG context** | ❌ Missing | LLM receives only summaries + declarations. Actual function bodies never retrieved |
| **Chunked code embeddings** | ❌ Missing | FunctionChunker embeds name+summary, not actual function body source |
| **Contextual re-ranker using actual code** | ❌ Missing | No code-aware reranking — only metadata haystack |

---

### 2.5 Frontend — Repository Explorer

| Feature / Component | Status | Notes |
|---|---|---|
| AnalyzePage — card-based directory explorer | ✅ Implemented | Windows Explorer-style cards per top-level directory, breadcrumb nav |
| File browser with directory drill-down | ✅ Implemented | `openDirectory` / `openFile` handlers, path segment breadcrumbs |
| AnalyzeFilePage — code viewer (Prism) | ✅ Implemented | Syntax highlight for 10+ languages, Prism.js integration |
| File edit mode with save | ⚠️ Partial | Edit/Save buttons exist but PR creation flow not wired end-to-end |
| AiPanel — inline chat on file page | ✅ Implemented | Right-side `AiPanel` on `AnalyzeFilePage` with streaming chat |
| **Code line selection → impact trigger** | ❌ Missing | No click-a-line handler that calls impact API |
| **Dependency Highlight Mode dropdown** | ❌ Missing | Spec requires dropdown enabling inline highlight of direct/indirect/referenced lines |
| **Inline code annotations (impact overlay)** | ❌ Missing | No gutter or inline markers showing impacted lines |

---

### 2.6 Frontend — AI / Chat

| Feature / Component | Status | Notes |
|---|---|---|
| AskPage — full-page chat | ✅ Implemented | `AskPage.jsx` with `ChatThread`, `ChatInput`, `SourceCitations` |
| ConversationSlice (Redux) | ✅ Implemented | `conversationSlice.js` manages active conversation + history |
| ChatThread component | ✅ Implemented | Renders user/assistant turns with streaming token append |
| SourceCitations component | ✅ Implemented | Renders highlighted file paths as clickable citations |
| ChatInput component | ✅ Implemented | Textarea with send, abort, and submit-on-enter |
| ConversationHistory sidebar | ✅ Implemented | `ConversationHistory.jsx` lists past sessions |
| QueryBar (one-shot NLQ) | ✅ Implemented | `QueryBar.jsx` for single-question search on graph page |
| QueryHistory list | ✅ Implemented | `QueryHistory.jsx` renders `saved_queries` from backend |

---

### 2.7 Auth, API, and Infrastructure

| Feature / Component | Status | Notes |
|---|---|---|
| GitHub OAuth + JWT auth | ✅ Implemented | `passport-github2` strategy, httpOnly JWT cookie, `AuthGuard` |
| Plan guard middleware | ✅ Implemented | `planGuard.middleware.js` — extensible for feature gating |
| Rate limiting on all sensitive routes | ✅ Implemented | `express-rate-limit` on `/ai`, `/graph/share`, `/graph/functions` |
| Redis infrastructure | ✅ Implemented | `cache.js` with `buildGraphCacheKey`, invalidation helpers |
| GitHub PR Service | ✅ Implemented | `GitHubPRService.js` — `createPR`, `addComment`, `updateFile` |
| GitHub webhook handler | ✅ Implemented | `github.webhook.js` — triggers impact analysis on push events |
| PR comment routes | ✅ Implemented | `pr-comment.routes.js` posts impact summary as PR review comment |
| VSCode extension | ✅ Implemented | `HoverProvider`, `GraphPanel`, `ApiClient` in `vscode-extension/` |
| **PR commit from file editor (end-to-end)** | ✅ Implemented | Save/create-PR opens a branch-aware modal, loads GitHub branches, creates a safe feature branch, commits there, and opens the PR when requested |

---

## 3. Gap Summary

| Gap | What Needs to Be Built |
|---|---|
| G1: `raw_content` storage | Add `raw_content TEXT` column to `graph_nodes` (or new `files` table). Store actual file source during persistence. |
| G2: Code chunk embeddings | Embed actual function body source, not just name+summary. Store in `function_nodes.body_source`. |
| G3: `directories` table | Migration 010: create `directories` table (`id`, `repository_id`, `parent_directory_id`, `directory_name`, `path`, `depth_level`). |
| G4: Directory hierarchy ingestion | During `SupervisorAgent` pipeline, traverse extracted repo tree and `INSERT` into `directories` table. |
| G5: Line-level impact output | Extend `graph_edges` with `source_lines`/`target_lines` JSONB. `ImpactAnalysisAgent` returns line ranges per impacted file. |
| G6: Line selection → impact trigger | In `AnalyzeFilePage`, add `onClick` handler per line. Selected range calls `/api/graph/:jobId/impact?node=...&lines=...` |
| G7: Impact right sidebar | Add a collapsible right panel in `AnalyzeFilePage` listing impacted files with line ranges and edge type labels. |
| G8: Dependency Highlight Mode | Add dropdown in `AnalyzeFilePage` toolbar. When ON, selected line triggers graph traversal; UI highlights lines red/orange/yellow. |
| G9: PR commit from editor | ✅ Completed | The editor now uses the branch/PR modal and `/api/analyze/commit` to branch first, commit second, and optionally open a PR. |
| G10: RAG with actual code context | Pass top-N function body snippets (`raw_content` slices) directly into LLM context alongside existing metadata. |

### 3.1 PR Commit Flow — What Happens Now

The editor save path is now explicit and branch-safe:

1. **User clicks Save or Create PR**
  - `AnalyzeFilePage` opens a modal instead of sending a direct commit.
  - The modal loads the repository branch list from GitHub so the user can choose valid source and target branches.

2. **The modal is prefilled**
  - `baseBranch` / `targetBranch`
  - `sourceBranch` / new feature branch name
  - commit message
  - PR title
  - PR body

3. **Protect main is enforced**
  - The toggle defaults to ON and is stored per repository.
  - Generated branch names are sanitized so path fragments like `.gitignore` cannot become invalid Git refs.
  - The server rejects any head branch that resolves to `main`.

4. **The client posts to `/api/analyze/commit`**
  - Payload includes `owner`, `repo`, `path`, `content`, `sha`, `sourceBranch`, `targetBranch`, `commitMessage`, and `createPullRequest` when applicable.

5. **The server creates or reuses the feature branch**
  - It resolves the repo default branch.
  - It finds the base branch SHA.
  - If needed, it creates `refs/heads/<sourceBranch>` from the selected base.

6. **The file is committed to that branch**
  - GitHub Contents API updates the file on the feature branch.
  - If PR creation is requested, the server opens a PR from `sourceBranch` into `targetBranch`.

7. **The UI receives a clear result**
  - Success responses include `savedBranch`, `baseBranch`, `prUrl`, and `prNumber`.
  - Any GitHub ref or permission issue is surfaced in the modal.

This fixes the earlier `422` caused by unsafe branch names and ensures the flow never falls back to committing directly to `main`.

---

## 4. RAG Implementation — Current State vs Proper RAG

### 4.1 Current RAG Architecture

The existing RAG pipeline is built on **metadata-only embeddings**. Here is the exact retrieval chain:

- **EmbeddingAgent** embeds: `"File: X\nType: module\nSummary: <AI text>\nExports: foo, bar\nImports from: y, z"`
- **FunctionChunker** embeds: `"Function: doAuth\nFile: auth.js\nKind: function\nCalls: verifyToken"`
- **ChatAgent** at query time: embeds question → cosine search `file_embeddings` → `GraphRagExpander` for neighbors → keyword rerank
- **Context sent to LLM**: file path + type + summary + declarations — **NO actual code**

This works well for architectural questions like *"what files handle auth?"* but fails for implementation-level questions like *"how does doAuth validate the JWT token?"* because the LLM never sees actual code.

---

### 4.2 Proper RAG — The Missing Piece

True code RAG requires three additions: (1) store raw code, (2) embed actual code bodies, (3) inject code snippets into LLM context.

#### Step 1: Migration — `raw_content` column

**File:** `server/src/infrastructure/migrations/010_raw_content.sql`

```sql
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS raw_content TEXT;
ALTER TABLE function_nodes ADD COLUMN IF NOT EXISTS body_source TEXT;
CREATE INDEX IF NOT EXISTS idx_fn_nodes_job_file_name
  ON function_nodes(job_id, file_path, name);
```

#### Step 2: Store `raw_content` during PersistenceAgent

In `PostgresGraphRepository.js`, extend the `graph_nodes` upsert to include `raw_content`. The raw source is available in `pipelineData.parsedFiles` produced by `PolyglotParserAgent`. Add a `rawContent` field to the graph node payload and pass it through the pipeline.

#### Step 3: FunctionChunker — embed actual function bodies

`FunctionChunker` currently embeds function name + file summary. The fix: populate `body_source` in `function_nodes` with actual source lines from the parser, then build the embedding text as:

```
Function: doAuth
File: auth.js
Body:
const token = req.headers.authorization...
```

This makes semantic search actually find implementation code instead of metadata descriptions.

#### Step 4: ChatAgent — inject code snippets into context

In `ChatAgent.process()`, after the `function_embeddings` query, for top matches with `distance < 0.30`, fetch `body_source` from `function_nodes` and include it in the context block:

```
[3] File: src/auth/auth.service.js
    Function: doAuth
    Source:
    async function doAuth(req) {
      const tok = req.headers.authorization...
```

The LLM now has actual code to reason over, not just an AI-generated summary.

#### Step 5: QueryAgent — enable code-level NLQ

`QueryAgent` currently only searches `file_embeddings`. Add a second parallel query against `function_embeddings` and merge results. Return `body_source` as part of `highlightedFiles` so the frontend can show the actual code snippet in `SourceCitations`.

---

### 4.3 Complete RAG Flow After Fixes

```
User asks: "How does session expiry work?"
    │
    ▼
1. Embed question → pgvector cosine → top-20 file candidates (unchanged)
    │
    ▼
2. GraphRagExpander fetches graph neighbors (unchanged)
    │
    ▼
3. NEW: query function_embeddings with same vector → top-12 function matches
    │
    ▼
4. For function matches with distance < 0.30: fetch body_source from function_nodes
    │
    ▼
5. Build context: file metadata + declarations + actual function body snippets
    │
    ▼
6. LLM receives real code → precise, grounded answers
    │
    ▼
7. SourceCitations renders file path + code snippet inline
```

---

## 5. Creator Guide — Step-by-Step Build Plan

Follow these tasks in order. Each is **additive** — nothing is removed from the existing codebase.

---

### TASK 1 — Migration 010: `raw_content` + `body_source`

**File to create:** `server/src/infrastructure/migrations/010_raw_content.sql`

- Add `raw_content TEXT` to `graph_nodes`
- Add `body_source TEXT` to `function_nodes`
- Both are nullable — existing rows remain valid

---

### TASK 2 — Migration 011: `directories` table

**File to create:** `server/src/infrastructure/migrations/011_directories.sql`

```sql
CREATE TABLE IF NOT EXISTS directories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id       UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  parent_directory_id UUID REFERENCES directories(id) ON DELETE CASCADE,
  directory_name      TEXT NOT NULL,
  path                TEXT NOT NULL,
  depth_level         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, path)
);

CREATE INDEX IF NOT EXISTS idx_dirs_repo_parent
  ON directories (repository_id, parent_directory_id);
```

---

### TASK 3 — PolyglotParserAgent: capture function body source

**File to edit:** `server/src/agents/parser/PolyglotParserAgent.js`

- When extracting function declarations via tree-sitter, capture `startLine` + `endLine`
- Slice the file buffer to produce `bodySource`: `fileLines.slice(startLine - 1, endLine).join('\n')`
- Pass `bodySource` through to the `functionNodes` map as `declaration.bodySource`

---

### TASK 4 — PostgresGraphRepository: persist `raw_content`

**File to edit:** `server/src/infrastructure/db/PostgresGraphRepository.js`

- In the `graph_nodes` upsert, add `raw_content = $N` to the `INSERT` and `UPDATE` clauses
- The value comes from `pipelineData.parsedFiles[filePath].rawContent`
- In the `function_nodes` upsert, add `body_source = $N` from `declaration.bodySource`

---

### TASK 5 — FunctionChunker: embed actual function bodies

**File to edit:** `server/src/agents/parser/FunctionChunker.js`

- Change the embedding text builder to include `body_source` when available:
  ```
  Function: ${fn.function_name}
  File: ${fn.file_path}
  Body:
  ${fn.body_source}
  ```
- Update the `INSERT` to persist `body_source` alongside the embedding
- Fallback gracefully to current metadata-only embedding when `body_source` is `null`

---

### TASK 6 — SupervisorAgent: persist directories

**File to edit:** `server/src/agents/core/SupervisorAgent.js`

- After `ScannerAgent` completes, walk `pipelineData.manifest` to extract all unique directory paths
- For each directory path, compute `parent_directory_id` by looking up the parent path in the already-inserted rows
- Bulk-insert into the new `directories` table using `repositoryId` from `pipelineData`

---

### TASK 7 — ChatAgent: inject function body snippets

**File to edit:** `server/src/agents/query/ChatAgent.js`

- After the existing `function_embeddings` query, for rows with `distance < 0.30`:
  ```sql
  SELECT body_source FROM function_nodes
  WHERE job_id = $1 AND file_path = $2 AND name = $3
  ```
- Append `body_source` into `buildContextBlock()` under the "Relevant functions" section
- Cap total code snippet tokens: truncate body to 400 chars max per function

---

### TASK 8 — QueryAgent: add function-level code retrieval

**File to edit:** `server/src/agents/query/QueryAgent.js`

- After the existing `file_embeddings` semantic query, run a parallel `function_embeddings` query
- Merge top function results into the context if their file is not already in `topFiles`
- Add `body_source` as a snippet field in the LLM context payload
- Return `body_source` in `highlightedFiles` array for frontend citations

---

### TASK 9 — `graph_edges`: add line number columns

**File to create:** `server/src/infrastructure/migrations/012_edge_line_numbers.sql`

```sql
ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS source_lines JSONB,  -- e.g. [18, 25]
  ADD COLUMN IF NOT EXISTS target_lines JSONB;
```

Populate during `RelationshipExtractorAgent` by capturing call-site line numbers from tree-sitter node positions.

---

### TASK 10 — ImpactAnalysisAgent: return line ranges

**File to edit:** `server/src/agents/analysis/ImpactAnalysisAgent.js`

- In `bfsPostgres()`, `SELECT source_lines, target_lines` from `graph_edges` alongside source/target paths
- Attach `lines: [startLine, endLine]` to each impacted node in the result
- In `bfsNeo4j()`, return `lineRange` property from the edge if stored in Neo4j

---

### TASK 11 — AnalyzeFilePage: line selection + impact sidebar

**File to edit:** `client/src/features/analyze/pages/AnalyzeFilePage.jsx`

- Replace static line rendering with per-line `<div>` elements, each with `data-line={lineNumber}`
- Add `onClick` handler that records `selectedLineStart` / `selectedLineEnd` in local state
- On selection, call `GET /api/graph/:jobId/impact?node=:filePath&lines=:start-:end`
- Add a collapsible `<ImpactSidebar />` component next to the code viewer
- `ImpactSidebar` renders: file name, line range badge, edge type label (`IMPORT` / `CALL` / `EXTENDS`)

---

### TASK 12 — Dependency Highlight Mode

**File to edit:** `client/src/features/analyze/pages/AnalyzeFilePage.jsx`

- Add a toolbar dropdown: `"Highlight Mode: Off | Dependencies | All Impacts"`
- When enabled and a line is selected, fetch impact data and store in Redux `impactHighlights` state
- Apply CSS classes `highlight-direct` (red), `highlight-near` (orange), `highlight-ref` (yellow) to matching line divs
- Layer on top of existing Prism highlighting using `position: relative` overlays — do not replace Prism

---

### TASK 13 — PR commit from file editor

**Status:** Completed.

The old prompt-based save flow has been replaced with the branch-aware modal and the shared `/api/analyze/commit` controller. The editor now loads branches, generates safe feature branch names, commits to that branch, and optionally opens a PR.

---

### TASK 14 — AnalyzePage dropdown: use `directories` table

**Files to edit:**

- Add `GET /api/analyze/structure/:repoId?source=db` endpoint that reads from the `directories` table
- Fall back to GitHub API live fetch if the `directories` table is empty (for repos ingested before this migration)
- In `AnalyzePage`, prefer the DB-backed structure — it renders faster and works offline

---

## 6. Safe Migration & Deploy Order

Run in this exact sequence to avoid breaking existing data:

1. Deploy migration **010** (`raw_content` + `body_source` columns — nullable, safe for existing rows)
2. Deploy migration **011** (`directories` table)
3. Deploy migration **012** (`graph_edges` line columns)
4. Backend: **Tasks 3–8** (parser → repository → FunctionChunker → ChatAgent → QueryAgent)
5. Backend: **Tasks 9–10** (line numbers in edges + impact output)
6. Backend: **Task 13** (commit routes)
7. Frontend: **Tasks 11–12** (line selection + highlight mode)
8. Frontend: **Task 13 wiring** (save → PR flow)
9. Frontend + Backend: **Task 14** (directories DB-backed structure)

> Re-run any repository that should benefit from `raw_content` / function body embeddings. Existing repos continue to work with summary-only RAG until re-scanned.

---

## 7. Key File Reference

| File | Role / Change Needed |
|---|---|
| `server/src/agents/core/SupervisorAgent.js` | Orchestrator — add directory ingestion step after scanner |
| `server/src/agents/parser/PolyglotParserAgent.js` | Add `body_source` capture via tree-sitter `startLine`/`endLine` |
| `server/src/agents/parser/FunctionChunker.js` | Embed actual function body, not just name+summary |
| `server/src/agents/query/ChatAgent.js` | Inject code snippets into LLM context for function-level RAG |
| `server/src/agents/query/QueryAgent.js` | Add `function_embeddings` retrieval to one-shot NLQ |
| `server/src/agents/analysis/ImpactAnalysisAgent.js` | Return `source_lines`/`target_lines` per impacted node |
| `server/src/infrastructure/db/PostgresGraphRepository.js` | Persist `raw_content` + `body_source` during upserts |
| `server/src/infrastructure/migrations/010_raw_content.sql` | **NEW** — nullable columns `raw_content`, `body_source` |
| `server/src/infrastructure/migrations/011_directories.sql` | **NEW** — hierarchical `directories` table |
| `server/src/infrastructure/migrations/012_edge_line_numbers.sql` | **NEW** — `source_lines`, `target_lines` JSONB on `graph_edges` |
| `server/src/analyze/routes/commit.routes.js` | **NEW** — `POST` endpoint → `GitHubPRService.createPR()` |
| `client/src/features/analyze/pages/AnalyzeFilePage.jsx` | Line selection, impact sidebar, dependency highlight mode, PR save flow |
| `client/src/features/analyze/slices/analyzeSlice.js` | Add `commitFile` thunk |

---

*All existing code is preserved — every gap is filled by addition only.*

## Implementation Done — Short Summary

| Feature | Status |
|---|---|
| Raw code storage (`raw_content`, `body_source`) | Completed |
| Directories table + persistence | Completed |
| Function body embeddings (`body_source`) | Completed |
| Line-level edges (`source_lines`, `target_lines`) | Completed |
| AnalyzeFilePage: line selection + snippet impact UI | Completed |
| Dependency highlight modes (Imports / Calls) | Completed |
| PR commit endpoint and client thunk (editor → PR) | Completed |
| DB-backed directories API / AnalyzePage integration | Missing |
| Repository rescan to populate edge line ranges | Pending (rescan required) |
| Frontend tests for AnalyzeFilePage behaviors | Missing |
