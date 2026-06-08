export const cacheKeys = {
  repositories: (userId, page, limit) => `cache:v1:repositories:user:${userId}:page:${page}:limit:${limit}`,
  analysisHistory: (userId, page, limit) => `cache:v1:analysis-history:user:${userId}:page:${page}:limit:${limit}`,
  repositoryJobs: (userId, repoId, page, limit) => `cache:v1:repository-jobs:user:${userId}:repo:${repoId}:page:${page}:limit:${limit}`,
  graphPayload: (jobId) => `cache:v1:graph:job:${jobId}`,
  streamExplain: (questionHash) => `stream:explain:${questionHash}`,
};
