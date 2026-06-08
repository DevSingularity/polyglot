// V003__raw_content_properties.cypher
// CodeGraph AI — Raw content storage on CodeFile and Symbol nodes
// Enables true code-level RAG: LLM context contains actual source, not just AI summaries.
// Safe to run repeatedly. Every statement is semicolon-terminated for migrate.js.
// Compatible with Neo4j Community Edition 5.x

// ---------------------------------------------------------------------------
// New property indexes — CodeFile.rawContent
// ---------------------------------------------------------------------------
// rawContent stores the full source text of the file as ingested.
// We do NOT index the content itself (too large), but we index the
// presence flag so queries can skip files with no stored content.

CREATE INDEX codefile_has_raw_content IF NOT EXISTS
FOR (f:CodeFile) ON (f.hasRawContent);

// ---------------------------------------------------------------------------
// New property indexes — Symbol.bodySource
// ---------------------------------------------------------------------------
// bodySource stores the literal source lines of a function / method body.
// Indexed by kind so ChatAgent can filter to functions only during retrieval.

CREATE INDEX symbol_has_body_source IF NOT EXISTS
FOR (s:Symbol) ON (s.hasBodySource);

CREATE INDEX symbol_kind_body IF NOT EXISTS
FOR (s:Symbol) ON (s.kind, s.hasBodySource);

// ---------------------------------------------------------------------------
// Full-text index — function body search
// ---------------------------------------------------------------------------
// Enables keyword-in-code search alongside vector similarity in ChatAgent.
// Compatible with Neo4j Community 5.x (full-text indexing is not Enterprise-only).

CREATE FULLTEXT INDEX symbol_body_fulltext IF NOT EXISTS
FOR (s:Symbol) ON EACH [s.bodySource, s.name];

CREATE FULLTEXT INDEX codefile_content_fulltext IF NOT EXISTS
FOR (f:CodeFile) ON EACH [f.rawContent, f.path, f.summary];

// ---------------------------------------------------------------------------
// Relationship index — HAS_SYMBOL carries kind for filtering
// ---------------------------------------------------------------------------
// PersistenceAgent creates (CodeFile)-[:HAS_SYMBOL]->(Symbol).
// Indexing kind on this relationship lets ImpactAnalysisAgent
// restrict traversal to functions only without scanning all symbols.

CREATE INDEX has_symbol_rel_jobId IF NOT EXISTS
FOR ()-[r:HAS_SYMBOL]-() ON (r.jobId);

CREATE INDEX has_symbol_rel_kind IF NOT EXISTS
FOR ()-[r:HAS_SYMBOL]-() ON (r.kind);

// ---------------------------------------------------------------------------
// Backfill: mark existing CodeFile nodes as lacking raw content
// ---------------------------------------------------------------------------
// Repos ingested before V003 have no rawContent. Mark them explicitly so
// ChatAgent can identify and fall back to summary-only RAG for those files.

MATCH (f:CodeFile)
WHERE f.hasRawContent IS NULL
SET f.hasRawContent = false;

// ---------------------------------------------------------------------------
// Backfill: mark existing Symbol nodes as lacking body source
// ---------------------------------------------------------------------------

MATCH (s:Symbol)
WHERE s.hasBodySource IS NULL
SET s.hasBodySource = false;

// ---------------------------------------------------------------------------
// Backfill: ensure all Symbol nodes have a bodySource default
// ---------------------------------------------------------------------------
// Prevents null-pointer exceptions in ChatAgent context builder when
// it tries to read bodySource from a Symbol created before this migration.

MATCH (s:Symbol)
WHERE s.bodySource IS NULL
SET s.bodySource = '';

// ---------------------------------------------------------------------------
// Migration marker
// ---------------------------------------------------------------------------

MERGE (m:__Neo4jMigration { version: 'V003' })
SET m.filename    = 'V003__raw_content_properties.cypher',
    m.appliedAt   = datetime(),
    m.description = 'rawContent on CodeFile, bodySource on Symbol, full-text indexes for code-level RAG';
