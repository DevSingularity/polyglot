import { redisClient } from '../../infrastructure/connections.js';
import {
  invalidateAnalysisHistoryCacheForUser,
  invalidateRepositoriesCacheForUser,
} from '../../infrastructure/cache.js';
import { enqueueAnalysisJob } from '../../queue/analysisQueue.js';
import { getAuthUser, resolveDatabaseUserId, getGitHubToken } from '../../utils/authUser.js';
import { buildRepositoryIdentity } from '../shared/repoIdentity.js';
import { createUploadRecord } from './upload.service.js';

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
    const { repositoryId, jobId } = await createUploadRecord({ userId, repository });

    if (!repositoryId || !jobId) {
      const err = new Error('Failed to create repository and analysis job.');
      err.statusCode = 500;
      throw err;
    }

    const queueInput = {
      ...req.body,
      repositoryId,
      userId,
      githubToken: getGitHubToken(req),
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
