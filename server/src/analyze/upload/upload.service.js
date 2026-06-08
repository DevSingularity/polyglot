import { pgPool } from '../../infrastructure/connections.js';

export async function createOrGetRepository({ userId, repository }) {
  const result = await pgPool.query(
    `
      INSERT INTO repositories (
        owner_id,
        source,
        full_name,
        github_owner,
        github_repo,
        default_branch,
        last_scanned_at,
        scan_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
      ON CONFLICT (owner_id, full_name)
      DO UPDATE
      SET source = EXCLUDED.source,
          github_owner = COALESCE(EXCLUDED.github_owner, repositories.github_owner),
          github_repo = COALESCE(EXCLUDED.github_repo, repositories.github_repo),
          default_branch = COALESCE(EXCLUDED.default_branch, repositories.default_branch),
          last_scanned_at = NOW(),
          scan_count = repositories.scan_count + 1
      RETURNING id
    `,
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
    `
      INSERT INTO analysis_jobs (repository_id, user_id, branch, status)
      VALUES ($1, $2, $3, 'queued')
      RETURNING id
    `,
    [repositoryId, userId, branch || null],
  );

  return result.rows[0]?.id;
}