// V004__directory_nodes.cypher
// CodeGraph AI — Directory node type and hierarchy relationships
// Mirrors the new PostgreSQL `directories` table so both DB backends
// represent the same navigable repo structure.
// Safe to run repeatedly. Every statement is semicolon-terminated for migrate.js.
// Compatible with Neo4j Community Edition 5.x

// ---------------------------------------------------------------------------
// Constraints — Directory uniqueness
// ---------------------------------------------------------------------------
// A directory is uniquely identified by (jobId, path) — same composite key
// used on CodeFile so cross-label joins are consistent.

CREATE CONSTRAINT directory_composite IF NOT EXISTS
FOR (d:Directory) REQUIRE (d.jobId, d.path) IS UNIQUE;

// Root directories are identified by depth = 0; enforce that the
// (jobId, directoryName, depth=0) combination is unique at root level
// via a separate constraint on the canonical root flag.

CREATE CONSTRAINT directory_root_composite IF NOT EXISTS
FOR (d:Directory) REQUIRE (d.jobId, d.isRoot, d.directoryName) IS UNIQUE;

// ---------------------------------------------------------------------------
// Constraints — Repository node (anchor for directory trees)
// ---------------------------------------------------------------------------
// SupervisorAgent creates one :Repository node per ingestion.
// If V001 didn't include this, add it now.

CREATE CONSTRAINT repository_unique IF NOT EXISTS
FOR (r:Repository) REQUIRE r.repositoryId IS UNIQUE;

// ---------------------------------------------------------------------------
// Performance indexes — Directory
// ---------------------------------------------------------------------------

// Primary filter: all queries start from jobId
CREATE INDEX directory_jobId IF NOT EXISTS
FOR (d:Directory) ON (d.jobId);

// Depth-level filter: AnalyzePage fetches top-level dirs (depth = 0) first
CREATE INDEX directory_depth IF NOT EXISTS
FOR (d:Directory) ON (d.depthLevel);

// Parent lookup: tree expansion walks up and down by parentPath
CREATE INDEX directory_parent_path IF NOT EXISTS
FOR (d:Directory) ON (d.parentPath);

// Combined: most common query pattern (jobId + depth)
CREATE INDEX directory_job_depth IF NOT EXISTS
FOR (d:Directory) ON (d.jobId, d.depthLevel);

// Directory name search: used in the AnalyzePage search box
CREATE INDEX directory_name IF NOT EXISTS
FOR (d:Directory) ON (d.directoryName);

// ---------------------------------------------------------------------------
// Performance indexes — Repository
// ---------------------------------------------------------------------------

CREATE INDEX repository_owner IF NOT EXISTS
FOR (r:Repository) ON (r.owner);

CREATE INDEX repository_name IF NOT EXISTS
FOR (r:Repository) ON (r.name);

// ---------------------------------------------------------------------------
// Relationship indexes — CONTAINS
// ---------------------------------------------------------------------------
// (Repository)-[:CONTAINS]->(Directory)  — top-level dirs
// (Directory)-[:CONTAINS]->(Directory)   — subdirectory nesting
// (Directory)-[:CONTAINS]->(CodeFile)    — files inside a directory
// All three share the same relationship type; jobId is always present.

CREATE INDEX contains_rel_jobId IF NOT EXISTS
FOR ()-[r:CONTAINS]-() ON (r.jobId);

// Order index: AnalyzePage renders directories before files
CREATE INDEX contains_rel_order IF NOT EXISTS
FOR ()-[r:CONTAINS]-() ON (r.nodeType);

// ---------------------------------------------------------------------------
// Relationship indexes — BELONGS_TO
// ---------------------------------------------------------------------------
// Reverse pointer: (CodeFile)-[:BELONGS_TO]->(Directory)
// Allows fast "which directory does this file live in?" lookups
// used by ImpactAnalysisAgent when grouping impacted files by directory.

CREATE INDEX belongs_to_rel_jobId IF NOT EXISTS
FOR ()-[r:BELONGS_TO]-() ON (r.jobId);

// ---------------------------------------------------------------------------
// Backfill: connect existing CodeFile nodes to synthetic root Directory
// ---------------------------------------------------------------------------
// Files ingested before V004 have no directory node. We synthesise a single
// root Directory per job so the UI can still render a tree.
// The SupervisorAgent will replace these with real directories on next run.

MATCH (f:CodeFile)
WHERE NOT (f)<-[:CONTAINS]-(:Directory)
  AND NOT (f)<-[:CONTAINS]-(:Repository)
WITH DISTINCT f.jobId AS jobId
MERGE (d:Directory {
  jobId:         jobId,
  path:          '__root__',
  directoryName: '/',
  depthLevel:    0,
  isRoot:        true,
  isSynthetic:   true
});

// Now link unparented files to the synthetic root
MATCH (f:CodeFile)
WHERE NOT (f)<-[:CONTAINS]-(:Directory)
  AND NOT (f)<-[:CONTAINS]-(:Repository)
MATCH (d:Directory { jobId: f.jobId, path: '__root__' })
MERGE (d)-[:CONTAINS { jobId: f.jobId, nodeType: 'file' }]->(f);

// Add reverse BELONGS_TO for backfilled files
MATCH (d:Directory { isSynthetic: true })-[:CONTAINS]->(f:CodeFile)
WHERE NOT (f)-[:BELONGS_TO]->(:Directory)
MERGE (f)-[:BELONGS_TO { jobId: f.jobId }]->(d);

// ---------------------------------------------------------------------------
// Migration marker
// ---------------------------------------------------------------------------

MERGE (m:__Neo4jMigration { version: 'V004' })
SET m.filename    = 'V004__directory_nodes.cypher',
    m.appliedAt   = datetime(),
    m.description = 'Directory nodes, CONTAINS hierarchy, BELONGS_TO reverse pointer, Repository anchor';
