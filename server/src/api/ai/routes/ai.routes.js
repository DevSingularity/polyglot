import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../../middleware/auth.middleware.js';
import {
  suggestRefactorController,
  listQueriesController,
  queryGraphController,
  impactController,
  snippetImpactController,
  streamExplainController,
  streamChatController,
  listConversationsController,
  getConversationMessagesController,
} from '../controllers/ai.controller.js';
import path from 'path';

const router = Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
});

function isSafePath(filePath, allowedRoot) {
  const resolved = path.resolve(allowedRoot, filePath);
  return resolved.startsWith(path.resolve(allowedRoot) + path.sep);
}

router.use(aiLimiter);

router.post('/suggest-refactor', requireAuth, suggestRefactorController);
router.get('/queries', requireAuth, listQueriesController);
router.post('/query', requireAuth, queryGraphController);
router.post('/explain/stream', requireAuth, streamExplainController);
router.post('/impact', requireAuth, impactController);
router.post('/snippet-impact', requireAuth, snippetImpactController);
router.post('/chat', requireAuth, streamChatController);
router.get('/conversations', requireAuth, listConversationsController);
router.get('/conversations/:id/messages', requireAuth, getConversationMessagesController);

export default router;
