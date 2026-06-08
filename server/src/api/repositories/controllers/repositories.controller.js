import * as repositoriesService from '../services/repositories.service.js';

export async function listRepositoriesController(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));

    const result = await repositoriesService.list({
      userId: req.userId,
      page,
      limit,
    });

    if (result.fromCache) {
      res.setHeader('X-Cache', 'HIT');
    } else {
      res.setHeader('X-Cache', 'MISS');
    }

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function listRepositoryJobsController(req, res, next) {
  try {
    const repositoryId = String(req.params?.id || '').trim();
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));

    const result = await repositoriesService.listJobs({
      userId: req.userId,
      repositoryId,
      page,
      limit,
    });

    if (result.fromCache) {
      res.setHeader('X-Cache', 'HIT');
    } else {
      res.setHeader('X-Cache', 'MISS');
    }

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function toggleStarController(req, res, next) {
  try {
    const repositoryId = String(req.params?.id || '').trim();
    const result = await repositoriesService.toggleStar({
      repositoryId,
      userId: req.userId,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function getCacheMetricsController(req, res, next) {
  try {
    const { getCacheMetricsSnapshot } = await import('../../../infrastructure/cache.js');
    const { redisClient } = await import('../../../infrastructure/connections.js');

    const metrics = getCacheMetricsSnapshot();
    const readsTotal = metrics.readHit + metrics.readMiss;
    const writesTotal = metrics.writeSuccess + metrics.writeError;
    const invalidationsTotal = metrics.invalidationSuccess + metrics.invalidationFailure;

    return res.status(200).json({
      metrics,
      summary: {
        readsTotal,
        writesTotal,
        invalidationsTotal,
        hitRatePercent:
          readsTotal > 0 ? Number(((metrics.readHit / readsTotal) * 100).toFixed(2)) : null,
      },
      redis: {
        status: redisClient?.status || 'unavailable',
        connected: redisClient?.status === 'ready',
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
}

export async function getCacheMetricsHistoryController(req, res, next) {
  try {
    const { getCacheMetricsHistory, getCacheMetricsRetentionStatus } = await import('../../../infrastructure/cacheMetricsPersistence.js');

    const hoursParam = Math.max(1, Math.min(24, Number.parseInt(req.query.hours || '1', 10)));
    const endSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = endSeconds - hoursParam * 3600;

    const history = await getCacheMetricsHistory(startSeconds, endSeconds);
    const retention = await getCacheMetricsRetentionStatus();

    return res.status(200).json({
      history,
      retention,
      query: { hoursParam, startSeconds, endSeconds },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
}

export async function getCacheMetricsLatestController(req, res, next) {
  try {
    const { getLatestCacheMetrics, getCacheMetricsRetentionStatus } = await import('../../../infrastructure/cacheMetricsPersistence.js');

    const latest = await getLatestCacheMetrics();
    const retention = await getCacheMetricsRetentionStatus();

    return res.status(200).json({
      latest,
      retention,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
}
