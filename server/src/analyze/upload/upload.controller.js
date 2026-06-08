import { redisClient } from '../../infrastructure/connections.js';
import {
  invalidateAnalysisHistoryCacheForUser,
  invalidateRepositoriesCacheForUser,
} from '../../infrastructure/cache.js';
import { enqueueAnalysisJob } from '../../queue/analysisQueue.js';
import { getAuthUser, resolveDatabaseUserId } from '../../utils/authUser.js';
import { buildRepositoryIdentity } from '../shared/repoIdentity.js';
import { createAnalysisJob, createOrGetRepository } from './upload.service.js';

export async function analyzeController(req, res, next) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser?.id) {
      return res.status(401).json({
        error: 'Authentication required to start analysis jobs.',
      });
    }

    const userId = await resolveDatabaseUserId(authUser);
    if (!userId) {
      const err = new Error('Failed to resolve authenticated user record.');
      err.statusCode = 500;
      throw err;
    }

    const repository = buildRepositoryIdentity(req.body);
    const repositoryId = await createOrGetRepository({ userId, repository });

    if (!repositoryId) {
      const err = new Error('Failed to resolve repository record for analysis job.');
      err.statusCode = 500;
      throw err;
    }

    const jobId = await createAnalysisJob({
      repositoryId,
      userId,
      branch: repository.branch,
    });

    if (!jobId) {
      const err = new Error('Failed to create analysis job.');
      err.statusCode = 500;
      throw err;
    }

    const queueInput = {
      ...req.body,
      repositoryId,
      userId,
      githubToken: req.cookies?.github_token,
      // optional forcing source for manual testing
      // forceNeo4j: true,
      // forcePostgres: true,
    };

    await enqueueAnalysisJob({
      jobId,
      input: queueInput,
    });

    await invalidateAnalysisHistoryCacheForUser(redisClient, userId);
    await invalidateRepositoriesCacheForUser(redisClient, userId);

    return res.status(202).json({ jobId });
  } catch (err) {
    return next(err);
  }
}