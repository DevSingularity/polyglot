// V005__edge_line_numbers.cypher
// CodeGraph AI — Line-number properties on all code relationship types
// Enables line-level impact analysis: ImpactAnalysisAgent can now return
// exact line ranges (e.g. "lines 18-25") instead of only file paths.
// Mirrors the graph_edges source_lines / target_lines JSONB columns in Postgres.
// Safe to run repeatedly. Every statement is semicolon-terminated for migrate.js.
// Compatible with Neo4j Community Edition 5.x

// ---------------------------------------------------------------------------
// NOTE ON ARRAY PROPERTIES IN NEO4J
// ---------------------------------------------------------------------------
// Neo4j stores line ranges as integer arrays on relationships, e.g.:
//   sourceLines: [18, 25]   → call site starts at line 18, ends at line 25
//   targetLines: [42, 60]   → definition of the called symbol: lines 42–60
// A null or missing property means the parser did not capture line info
// (binary files, minified JS, etc.). ImpactAnalysisAgent must handle nulls.

// ---------------------------------------------------------------------------
// Relationship indexes — IMPORTS
// ---------------------------------------------------------------------------
// (CodeFile)-[:IMPORTS { jobId, sourceLines, targetLines }]->(CodeFile)

CREATE INDEX imports_rel_source_lines IF NOT EXISTS
FOR ()-[r:IMPORTS]-() ON (r.hasLineInfo);

// ---------------------------------------------------------------------------
// Relationship indexes — CALLS
// ---------------------------------------------------------------------------
// (Symbol)-[:CALLS { jobId, sourceLines, targetLines, callType }]->(Symbol)
// callType: 'direct' | 'dynamic' | 'callback' | 'unknown'

CREATE INDEX calls_rel_source_lines IF NOT EXISTS
FOR ()-[r:CALLS]-() ON (r.hasLineInfo);

CREATE INDEX calls_rel_call_type IF NOT EXISTS
FOR ()-[r:CALLS]-() ON (r.callType);

// ---------------------------------------------------------------------------
// Relationship indexes — DEFINES
// ---------------------------------------------------------------------------
// (CodeFile)-[:DEFINES { jobId, sourceLines }]->(Symbol)

CREATE INDEX defines_rel_source_lines IF NOT EXISTS
FOR ()-[r:DEFINES]-() ON (r.hasLineInfo);

// ---------------------------------------------------------------------------
// Relationship indexes — EXTENDS
// ---------------------------------------------------------------------------
// (Symbol)-[:EXTENDS { jobId, sourceLines }]->(Symbol)
// Symbol.kind = 'class' on both sides.

CREATE INDEX extends_rel_source_lines IF NOT EXISTS
FOR ()-[r:EXTENDS]-() ON (r.hasLineInfo);

// ---------------------------------------------------------------------------
// Relationship indexes — DEPENDS_ON
// ---------------------------------------------------------------------------
// (CodeFile)-[:DEPENDS_ON { jobId, manager, version }]->(CodeFile | Module)
// sourceLines not applicable here (manifest-level), but hasLineInfo = false
// must be set so filters stay consistent.

CREATE INDEX depends_on_rel_jobId IF NOT EXISTS
FOR ()-[r:DEPENDS_ON]-() ON (r.jobId);

CREATE INDEX depends_on_rel_manager IF NOT EXISTS
FOR ()-[r:DEPENDS_ON]-() ON (r.manager);

// ---------------------------------------------------------------------------
// Relationship indexes — USES
// ---------------------------------------------------------------------------
// (Symbol)-[:USES { jobId, sourceLines, targetLines, usageKind }]->(Symbol)
// usageKind: 'read' | 'write' | 'reference'

CREATE INDEX uses_rel_source_lines IF NOT EXISTS
FOR ()-[r:USES]-() ON (r.hasLineInfo);

CREATE INDEX uses_rel_usage_kind IF NOT EXISTS
FOR ()-[r:USES]-() ON (r.usageKind);

// ---------------------------------------------------------------------------
// Relationship indexes — EXPOSES_API, CONSUMES_API
// ---------------------------------------------------------------------------
// These already carry jobId (indexed in V002). Add line info index.

CREATE INDEX exposes_api_rel_line_info IF NOT EXISTS
FOR ()-[r:EXPOSES_API]-() ON (r.hasLineInfo);

CREATE INDEX consumes_api_rel_line_info IF NOT EXISTS
FOR ()-[r:CONSUMES_API]-() ON (r.hasLineInfo);

// ---------------------------------------------------------------------------
// Relationship indexes — USES_TABLE, USES_FIELD
// ---------------------------------------------------------------------------

CREATE INDEX uses_table_rel_line_info IF NOT EXISTS
FOR ()-[r:USES_TABLE]-() ON (r.hasLineInfo);

CREATE INDEX uses_field_rel_line_info IF NOT EXISTS
FOR ()-[r:USES_FIELD]-() ON (r.hasLineInfo);

// ---------------------------------------------------------------------------
// Relationship indexes — EMITS_EVENT, LISTENS_EVENT
// ---------------------------------------------------------------------------

CREATE INDEX emits_event_rel_line_info IF NOT EXISTS
FOR ()-[r:EMITS_EVENT]-() ON (r.hasLineInfo);

CREATE INDEX listens_event_rel_line_info IF NOT EXISTS
FOR ()-[r:LISTENS_EVENT]-() ON (r.hasLineInfo);

// ---------------------------------------------------------------------------
// Backfill: stamp hasLineInfo = false on all pre-V005 relationships
// ---------------------------------------------------------------------------
// Relationships created before V005 carry no line data.
// Stamping hasLineInfo = false lets ImpactAnalysisAgent use the index
// to skip null checks and cleanly identify un-enriched edges.
//
// Neo4j does not support a single MATCH over all relationship types, so
// each type is backfilled individually. CALL { } IN TRANSACTIONS avoids
// heap exhaustion on large graphs (Neo4j 5.x feature).

CALL {
  MATCH ()-[r:IMPORTS]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = [],
      r.targetLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:CALLS]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = [],
      r.targetLines = [],
      r.callType    = 'unknown'
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:DEFINES]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = [],
      r.targetLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:EXTENDS]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = [],
      r.targetLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:DEPENDS_ON]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:USES]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = [],
      r.targetLines = [],
      r.usageKind   = 'reference'
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:EXPOSES_API]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:CONSUMES_API]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:USES_TABLE]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:USES_FIELD]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:EMITS_EVENT]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = []
} IN TRANSACTIONS OF 5000 ROWS;

CALL {
  MATCH ()-[r:LISTENS_EVENT]-()
  WHERE r.hasLineInfo IS NULL
  SET r.hasLineInfo = false,
      r.sourceLines = []
} IN TRANSACTIONS OF 5000 ROWS;

// ---------------------------------------------------------------------------
// Compound traversal helper index — impact BFS hot path
// ---------------------------------------------------------------------------
// ImpactAnalysisAgent BFS touches (jobId + hasLineInfo) on every hop.
// A compound index on the two most-traversed relationship types
// avoids property lookups during the inner loop.

CREATE INDEX imports_bfs_composite IF NOT EXISTS
FOR ()-[r:IMPORTS]-() ON (r.jobId, r.hasLineInfo);

CREATE INDEX calls_bfs_composite IF NOT EXISTS
FOR ()-[r:CALLS]-() ON (r.jobId, r.hasLineInfo);

// ---------------------------------------------------------------------------
// Migration marker
// ---------------------------------------------------------------------------

MERGE (m:__Neo4jMigration { version: 'V005' })
SET m.filename    = 'V005__edge_line_numbers.cypher',
    m.appliedAt   = datetime(),
    m.description = 'sourceLines + targetLines integer arrays on all relationship types, hasLineInfo flag, BFS composite indexes';
