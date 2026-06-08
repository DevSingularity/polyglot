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
      return res.status(401).json({
        error: 'Authentication required to load analysis history.',
      });
    }

    const requestedUserId = typeof req.query?.userId === 'string' ? req.query.userId.trim() : null;
    if (requestedUserId && requestedUserId !== String(authUser.id)) {
      return res.status(403).json({
        error: 'You can only access your own analysis history.',
      });
    }

    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const userId = await resolveDatabaseUserId(authUser);
    if (!userId) {
      const err = new Error('Failed to resolve authenticated user record.');
      err.statusCode = 500;
      throw err;
    }

    const historyCacheKey = buildAnalysisHistoryCacheKey({ userId, page, limit });
    const cachedHistory = await readJsonCache(redisClient, historyCacheKey);
    if (cachedHistory) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cachedHistory);
    }

    const [historyResult, countResult] = await Promise.all([
      pgPool.query(
        `
          WITH latest_repo_jobs AS (
            SELECT DISTINCT ON (r.id)
              r.id AS repository_id,
              r.source,
              r.full_name,
              r.github_owner,
              r.github_repo,
              r.default_branch,
              aj.id AS job_id,
              (
                SELECT aj_completed.id
                FROM analysis_jobs aj_completed
                WHERE aj_completed.repository_id = r.id
                  AND aj_completed.status = 'completed'
                ORDER BY COALESCE(aj_completed.completed_at, aj_completed.created_at) DESC
                LIMIT 1
              ) AS latest_completed_job_id,
              aj.status,
              aj.branch,
              aj.node_count,
              aj.edge_count,
              COALESCE(aj.completed_at, aj.created_at) AS analyzed_at
            FROM repositories r
            JOIN analysis_jobs aj ON aj.repository_id = r.id
            WHERE r.owner_id = $1
            ORDER BY r.id, COALESCE(aj.completed_at, aj.created_at) DESC
          )
          SELECT *
          FROM latest_repo_jobs
          ORDER BY analyzed_at DESC
          LIMIT $2 OFFSET $3
        `,
        [userId, limit, offset],
      ),
      pgPool.query(
        `
          SELECT COUNT(*)::int AS total
          FROM repositories r
          WHERE r.owner_id = $1
        `,
        [userId],
      ),
    ]);

    const repositories = historyResult.rows.map((row) => {
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
      const graphJobId = row.latest_completed_job_id || (row.status === 'completed' ? row.job_id : null);

      return {
        id: row.repository_id,
        jobId: graphJobId,
        latestJobId: row.job_id,
        name,
        owner,
        fullName: row.full_name,
        source: row.source,
        branch: row.branch || row.default_branch || null,
        analyzedAt: row.analyzed_at,
        nodeCount: Number.isFinite(row.node_count) ? row.node_count : null,
        edgeCount: Number.isFinite(row.edge_count) ? row.edge_count : null,
        status: row.status || 'completed',
      };
    });

    const totalAnalyzed = countResult.rows[0]?.total || 0;
    const uniqueOwners = new Set(repositories.map((repo) => repo.owner).filter(Boolean)).size;

    const responsePayload = {
      repositories,
      summary: {
        totalAnalyzed,
        lastAnalyzedAt: repositories[0]?.analyzedAt || null,
        uniqueOwners,
      },
      pagination: {
        page,
        limit,
        total: totalAnalyzed,
        totalPages: totalAnalyzed > 0 ? Math.ceil(totalAnalyzed / limit) : 0,
      },
    };

    await writeJsonCache(
      redisClient,
      historyCacheKey,
      responsePayload,
      cacheTtl.analysisHistorySeconds,
    );

    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (err) {
    return next(err);
  }
}