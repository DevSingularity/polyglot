export const REPOSITORIES_LIST_SQL = `
  WITH repos_with_latest AS (
    SELECT
      r.id AS repository_id,
      r.source,
      r.full_name,
      r.github_owner,
      r.github_repo,
      r.default_branch,
      r.last_scanned_at,
      r.scan_count,
      r.is_starred,
      r.created_at,
      aj.id AS latest_job_id,
      aj.status AS latest_job_status,
      aj.overall_confidence AS latest_job_confidence,
      aj.branch AS latest_job_branch,
      aj.node_count AS latest_job_node_count,
      aj.edge_count AS latest_job_edge_count,
      COALESCE(aj.completed_at, aj.created_at) AS latest_analyzed_at
    FROM repositories r
    LEFT JOIN LATERAL (
      SELECT id, status, overall_confidence, branch, node_count, edge_count, completed_at, created_at
      FROM analysis_jobs
      WHERE repository_id = r.id
      ORDER BY COALESCE(completed_at, created_at) DESC
      LIMIT 1
    ) aj ON TRUE
    WHERE r.owner_id = $1
  )
  SELECT *
  FROM repos_with_latest
  ORDER BY is_starred DESC, COALESCE(latest_analyzed_at, last_scanned_at, created_at) DESC
  LIMIT $2 OFFSET $3
`;

export const REPOSITORIES_COUNT_SQL = `
  SELECT COUNT(*)::int AS total
  FROM repositories
  WHERE owner_id = $1
`;

export const REPOSITORY_EXISTS_SQL = `
  SELECT id, source, full_name, default_branch
  FROM repositories
  WHERE id = $1 AND owner_id = $2
  LIMIT 1
`;

export const REPOSITORY_JOBS_SQL = `
  SELECT
    id,
    branch,
    status,
    overall_confidence,
    file_count,
    node_count,
    edge_count,
    error_summary,
    started_at,
    completed_at,
    created_at
  FROM analysis_jobs
  WHERE repository_id = $1
  ORDER BY COALESCE(completed_at, created_at) DESC
  LIMIT $2 OFFSET $3
`;

export const REPOSITORY_JOBS_COUNT_SQL = `
  SELECT COUNT(*)::int AS total
  FROM analysis_jobs
  WHERE repository_id = $1
`;

export const TOGGLE_STAR_SQL = `
  UPDATE repositories
  SET is_starred = $1
  WHERE id = $2 AND owner_id = $3
  RETURNING id, is_starred
`;

export const CHECK_STAR_SQL = `
  SELECT id, is_starred
  FROM repositories
  WHERE id = $1 AND owner_id = $2
  LIMIT 1
`;
