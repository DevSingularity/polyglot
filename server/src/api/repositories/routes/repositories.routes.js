import { Router } from 'express';
import { requireAuth } from '../../../middleware/auth.middleware.js';
import { isUuid } from '../../../utils/authUser.js';
import {
  listRepositoriesController,
  listRepositoryJobsController,
  toggleStarController,
  getCacheMetricsController,
  getCacheMetricsHistoryController,
  getCacheMetricsLatestController,
} from '../controllers/repositories.controller.js';

const router = Router();

router.get('/cache/metrics', requireAuth, getCacheMetricsController);
router.get('/cache/metrics/history', requireAuth, getCacheMetricsHistoryController);
router.get('/cache/metrics/latest', requireAuth, getCacheMetricsLatestController);
router.get('/', requireAuth, listRepositoriesController);

router.get('/:id/jobs', requireAuth, (req, res, next) => {
  const repositoryId = String(req.params?.id || '').trim();
  if (!isUuid(repositoryId)) {
    return res.status(400).json({ error: 'Invalid repository id.' });
  }
  next();
}, listRepositoryJobsController);

router.patch('/:id/star', requireAuth, (req, res, next) => {
  const repositoryId = String(req.params?.id || '').trim();
  if (!isUuid(repositoryId)) {
    return res.status(400).json({ error: 'Invalid repository id.' });
  }
  next();
}, toggleStarController);

export default router;
