import { pgPool, redisClient } from '../../../infrastructure/connections.js';
import {
  buildRepositoriesListCacheKey,
  buildRepositoryJobsCacheKey,
  cacheTtl,
  invalidateRepositoriesCacheForUser,
  readJsonCache,
  writeJsonCache,
} from '../../../infrastructure/cache.js';
import { inferRepositoryName, inferRepositoryOwner } from '../../../shared/repoHelpers.js';
import { errors } from '../../../utils/errors.js';
import {
  REPOSITORIES_LIST_SQL,
  REPOSITORIES_COUNT_SQL,
  REPOSITORY_EXISTS_SQL,
  REPOSITORY_JOBS_SQL,
  REPOSITORY_JOBS_COUNT_SQL,
  TOGGLE_STAR_SQL,
  CHECK_STAR_SQL,
} from './repositories.queries.js';

function buildRepositoriesPayload(rows, countRow, { page, limit }) {
  const repositories = rows.map((row) => {
    const name = inferRepositoryName({
      source: row.source,
      fullName: row.full_name,
      githubRepo: row.github_repo,
    });
    const owner = inferRepositoryOwner({
      source: row.source,
      fullName: row.full_name,
      githubOwner: row.github_owner,
    });

    return {
      id: row.repository_id,
      name,
      owner,
      fullName: row.full_name,
      source: row.source,
      defaultBranch: row.default_branch || null,
      lastScannedAt: row.last_scanned_at || null,
      scanCount: Number.isFinite(row.scan_count) ? row.scan_count : 0,
      isStarred: row.is_starred || false,
      latestJob: row.latest_job_id
        ? {
            id: row.latest_job_id,
            status: row.latest_job_status,
            confidence: row.latest_job_confidence,
            branch: row.latest_job_branch || row.default_branch || null,
            nodeCount: Number.isFinite(row.latest_job_node_count) ? row.latest_job_node_count : null,
            edgeCount: Number.isFinite(row.latest_job_edge_count) ? row.latest_job_edge_count : null,
            analyzedAt: row.latest_analyzed_at || null,
          }
        : null,
    };
  });

  const total = countRow?.total || 0;
  return {
    repositories,
    pagination: {
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}

export async function list({ userId, page, limit }) {
  const offset = (page - 1) * limit;
  const cacheKey = buildRepositoriesListCacheKey({ userId, page, limit });
  const cached = await readJsonCache(redisClient, cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const [reposResult, countResult] = await Promise.all([
    pgPool.query(REPOSITORIES_LIST_SQL, [userId, limit, offset]),
    pgPool.query(REPOSITORIES_COUNT_SQL, [userId]),
  ]);

  const result = buildRepositoriesPayload(reposResult.rows, countResult.rows[0], { page, limit });
  await writeJsonCache(redisClient, cacheKey, result, cacheTtl.repositoriesListSeconds);
  return result;
}

export async function listJobs({ userId, repositoryId, page, limit }) {
  const offset = (page - 1) * limit;

  const repoResult = await pgPool.query(REPOSITORY_EXISTS_SQL, [repositoryId, userId]);
  if (repoResult.rowCount === 0) {
    throw errors.notFound('Repository not found.');
  }

  const cacheKey = buildRepositoryJobsCacheKey({ userId, repositoryId, page, limit });
  const cached = await readJsonCache(redisClient, cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const [jobsResult, countResult] = await Promise.all([
    pgPool.query(REPOSITORY_JOBS_SQL, [repositoryId, limit, offset]),
    pgPool.query(REPOSITORY_JOBS_COUNT_SQL, [repositoryId]),
  ]);

  const payload = {
    repository: {
      id: repoResult.rows[0].id,
      fullName: repoResult.rows[0].full_name,
      source: repoResult.rows[0].source,
      defaultBranch: repoResult.rows[0].default_branch || null,
    },
    jobs: jobsResult.rows.map((row) => ({
      id: row.id,
      branch: row.branch || null,
      status: row.status,
      confidence: row.overall_confidence,
      fileCount: Number.isFinite(row.file_count) ? row.file_count : null,
      nodeCount: Number.isFinite(row.node_count) ? row.node_count : null,
      edgeCount: Number.isFinite(row.edge_count) ? row.edge_count : null,
      errorSummary: row.error_summary || null,
      startedAt: row.started_at || null,
      completedAt: row.completed_at || null,
      createdAt: row.created_at || null,
    })),
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
      totalPages:
        (countResult.rows[0]?.total || 0) > 0
          ? Math.ceil((countResult.rows[0]?.total || 0) / limit)
          : 0,
    },
  };

  await writeJsonCache(redisClient, cacheKey, payload, cacheTtl.repositoryJobsSeconds);
  return payload;
}

export async function toggleStar({ repositoryId, userId }) {
  const repoResult = await pgPool.query(CHECK_STAR_SQL, [repositoryId, userId]);
  if (repoResult.rowCount === 0) {
    throw errors.notFound('Repository not found.');
  }

  const currentStarred = repoResult.rows[0].is_starred || false;
  const updateResult = await pgPool.query(TOGGLE_STAR_SQL, [!currentStarred, repositoryId, userId]);

  await invalidateRepositoriesCacheForUser(redisClient, userId);

  return {
    id: updateResult.rows[0].id,
    isStarred: updateResult.rows[0].is_starred,
  };
}
