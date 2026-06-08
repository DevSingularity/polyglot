import crypto from 'node:crypto';
import { QueryAgent } from '../../../agents/query/QueryAgent.js';
import { ChatAgent } from '../../../agents/query/ChatAgent.js';
import { AnalysisAgent } from '../../../agents/analysis/AnalysisAgent.js';
import { SnippetAnalyzerAgent } from '../../../agents/analysis/SnippetAnalyzerAgent.js';
import { pgPool, redisClient } from '../../../infrastructure/connections.js';
import { createGraphRepository } from '../../../infrastructure/db/graphRepositoryFactory.js';
import { createChatClient, createEmbeddingClient } from '../../../services/ai/llmProvider.js';
import { errors } from '../../../utils/errors.js';

const aiRouteProvider = process.env.AI_ROUTE_PROVIDER || 'gemini';
const ragRouteProvider = process.env.AI_RAG_PROVIDER || 'gemini';
const chatClient = createChatClient({ provider: aiRouteProvider });
const defaultChatModel = chatClient.model;
const embeddingClient = createEmbeddingClient({ provider: ragRouteProvider });

const STREAM_CACHE_TTL = 60 * 60;

function streamCacheKey(jobId, question) {
  const hash = crypto
    .createHash('sha256')
    .update(`${jobId}:${question}`)
    .digest('hex');
  return `stream:explain:${hash}`;
}

function toGraphFromRows(nodeRows = [], edgeRows = []) {
  const depsBySource = new Map();
  for (const row of edgeRows) {
    if (!depsBySource.has(row.source_path)) depsBySource.set(row.source_path, []);
    depsBySource.get(row.source_path).push(row.target_path);
  }
  const graph = {};
  for (const node of nodeRows) {
    graph[node.file_path] = {
      deps: depsBySource.get(node.file_path) || [],
      type: node.file_type,
      declarations: node.declarations || [],
      metrics: node.metrics || {},
      summary: node.summary || null,
    };
  }
  return graph;
}

export async function suggestRefactorController(req, res, next) {
  const jobId = String(req.body?.jobId || '').trim();
  const filePath = String(req.body?.filePath || '').trim();

  if (!jobId || !filePath) {
    return res.status(400).json({ error: 'jobId and filePath are required.' });
  }

  try {
    const nodeResult = await pgPool.query(
      `SELECT file_path, file_type, declarations, metrics, summary
       FROM graph_nodes
       WHERE job_id = $1 AND file_path = $2
       LIMIT 1`,
      [jobId, filePath],
    );

    if (nodeResult.rowCount === 0) {
      return res.status(404).json({ error: 'File not found.' });
    }

    if (!chatClient.isConfigured()) {
      return res.status(503).json({ error: 'AI provider is not configured.' });
    }

    const node = nodeResult.rows[0];
    const exportsList = (node.declarations || []).map((d) => d?.name).filter(Boolean);

    const prompt = `You are a senior software architect reviewing a file in a dependency graph analysis.

File: ${node.file_path}
Type: ${node.file_type}
Lines of code: ${node.metrics?.loc || 'unknown'}
In-degree (files that import this): ${node.metrics?.inDegree || 0}
Out-degree (files this imports): ${node.metrics?.outDegree || 0}
Exports: ${exportsList.join(', ') || 'none'}
Summary: ${node.summary || 'no summary available'}

Respond with a JSON object:
{
  "concerns": ["list of specific architectural concerns"],
  "suggestions": ["list of concrete refactoring steps"],
  "priority": "high | medium | low",
  "estimatedEffort": "hours estimate as a string, e.g. '2-4 hours'"
}
Only respond with the JSON object.`;

    const completion = await chatClient.createChatCompletion({
      model: defaultChatModel,
      maxTokens: 400,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = completion?.content?.trim() || '';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { concerns: [], suggestions: content ? [content] : [], priority: 'medium', estimatedEffort: 'unknown' };
    }

    return res.status(200).json({
      filePath,
      concerns: Array.isArray(parsed?.concerns) ? parsed.concerns : [],
      suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
      priority: ['high', 'medium', 'low'].includes(parsed?.priority) ? parsed.priority : 'medium',
      estimatedEffort: typeof parsed?.estimatedEffort === 'string' && parsed.estimatedEffort.trim()
        ? parsed.estimatedEffort.trim()
        : 'unknown',
    });
  } catch (error) {
    return next(error);
  }
}

export async function listQueriesController(req, res, next) {
  const jobId = String(req.query?.jobId || '').trim();
  const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query?.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    if (jobId) {
      const ownership = await pgPool.query(
        `SELECT 1 FROM analysis_jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [jobId, req.userId],
      );
      if (ownership.rowCount === 0) {
        return res.status(404).json({ error: 'Analysis job not found for this user.' });
      }
    }

    const queryText = jobId
      ? `SELECT id, question, answer, highlights, confidence, created_at
         FROM saved_queries
         WHERE user_id = $1 AND job_id = $2
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`
      : `SELECT id, question, answer, highlights, confidence, created_at
         FROM saved_queries
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`;

    const params = jobId ? [req.userId, jobId, limit, offset] : [req.userId, limit, offset];
    const result = await pgPool.query(queryText, params);

    return res.status(200).json({
      queries: result.rows.map((row) => ({
        id: row.id,
        question: row.question,
        answer: row.answer,
        highlights: Array.isArray(row.highlights) ? row.highlights : [],
        confidence: row.confidence || null,
        createdAt: row.created_at,
      })),
      page,
      limit,
    });
  } catch (error) {
    return next(error);
  }
}

export async function queryGraphController(req, res, next) {
  const question = String(req.body?.question || '').trim();
  const jobId = String(req.body?.jobId || '').trim();

  if (!question || !jobId) {
    return res.status(400).json({ error: 'question and jobId are required.' });
  }

  if (question.length > 2000) {
    return res.status(400).json({ error: 'Question must be 2000 characters or fewer.' });
  }

  try {
    const agent = new QueryAgent({ db: pgPool, redis: redisClient, llmClient: chatClient, embeddingClient });
    const result = await agent.process({ question, jobId, userId: req.userId }, { jobId });

    if (result.status === 'failed') {
      try {
        const { logger } = await import('../../../utils/logger.js');
        logger.error({ jobId, errors: result.errors }, 'QueryAgent failed');
      } catch { /* logger unavailable */ }
      return res.status(400).json({
        error: result.errors?.[0]?.message || 'Unable to process query.',
        details: result.errors || [],
      });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    return next(error);
  }
}

export async function impactController(req, res, next) {
  const jobId = String(req.body?.jobId || '').trim();
  const filePath = String(req.body?.filePath || '').trim();

  if (!jobId || !filePath) {
    return res.status(400).json({ error: 'jobId and filePath are required.' });
  }

  try {
    const [nodesResult, edgesResult] = await Promise.all([
      pgPool.query(
        `SELECT file_path, file_type, declarations, metrics, summary
         FROM graph_nodes WHERE job_id = $1`,
        [jobId],
      ),
      pgPool.query(
        `SELECT source_path, target_path FROM graph_edges WHERE job_id = $1`,
        [jobId],
      ),
    ]);

    if (nodesResult.rowCount === 0) {
      return res.status(404).json({ error: 'No graph data found for this job.' });
    }

    const graph = toGraphFromRows(nodesResult.rows, edgesResult.rows);
    if (!graph[filePath]) {
      return res.status(404).json({ error: 'filePath not found in this job graph.' });
    }

    const edges = edgesResult.rows.map((row) => ({
      source: row.source_path,
      target: row.target_path,
    }));

    const analysisAgent = new AnalysisAgent();
    const result = await analysisAgent.process({ graph, edges, filePath }, { jobId });

    if (result.status === 'failed') {
      return res.status(400).json({
        error: result.errors?.[0]?.message || 'Unable to compute impact.',
        details: result.errors || [],
      });
    }

    return res.status(200).json({
      filePath,
      affectedFiles: result.data?.impactedFiles || [],
      deadCodeCandidates: result.data?.deadCodeCandidates || [],
    });
  } catch (error) {
    return next(error);
  }
}

export async function snippetImpactController(req, res, next) {
  const jobId = String(req.body?.jobId || '').trim();
  const filePath = String(req.body?.filePath || '').trim();
  const snippet = String(req.body?.snippet || '').trim();

  if (!jobId || !filePath || !snippet) {
    return res.status(400).json({ error: 'jobId, filePath, and snippet are required.' });
  }

  if (snippet.length > 8000) {
    return res.status(400).json({ error: 'Snippet must be 8000 characters or fewer.' });
  }

  function toSafePositiveInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  const lineStart = toSafePositiveInt(req.body?.lineStart);
  const lineEnd = toSafePositiveInt(req.body?.lineEnd);

  if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) {
    return res.status(400).json({ error: 'lineEnd must be greater than or equal to lineStart.' });
  }

  try {
    const ownership = await pgPool.query(
      `SELECT 1 FROM analysis_jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [jobId, req.userId],
    );
    if (ownership.rowCount === 0) {
      return res.status(404).json({ error: 'Analysis job not found for this user.' });
    }

    const graphCheck = await pgPool.query(
      `SELECT 1 FROM graph_nodes WHERE job_id = $1 LIMIT 1`,
      [jobId],
    );
    if (graphCheck.rowCount === 0) {
      return res.status(200).json({
        whatItDoes: null,
        fileImpact: null,
        codebaseImpact: null,
        confidence: '0%',
        confidenceScore: 0,
        impactedNodes: [],
        transitivelyImpactedFiles: [],
        notice: 'No analysis could be performed on the provided snippet yet.',
      });
    }

    const agent = new SnippetAnalyzerAgent({ db: pgPool });
    const result = await agent.process(
      { jobId, filePath, snippet, lineStart, lineEnd },
      { jobId },
    );

    if (result.status === 'failed') {
      const statusCode = Number(result.errors?.[0]?.code) || 400;

      return res.status(statusCode).json({
        error: result.errors?.[0]?.message || 'Unable to analyze snippet impact.',
        details: result.errors || [],
      });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    return next(error);
  }
}

export function streamExplainController(req, res) {
  const question = String(req.body?.question || '').trim();
  const jobId = String(req.body?.jobId || '').trim();

  if (!question || !jobId) {
    return res.status(400).json({ error: 'question and jobId are required.' });
  }

  if (!chatClient.isConfigured()) {
    return res.status(503).json({ error: 'AI provider is not configured for streaming.' });
  }

  let clientClosed = false;
  let streamSession = null;

  const closeStream = () => { streamSession?.cancel?.(); };
  const writeEvent = (payload) => {
    if (clientClosed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  req.on('close', () => { clientClosed = true; closeStream(); });

  (async () => {
    try {
      const ownership = await pgPool.query(
        `SELECT 1 FROM analysis_jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [jobId, req.userId],
      );
      if (ownership.rowCount === 0) {
        return res.status(404).json({ error: 'Analysis job not found for this user.' });
      }

      const cacheKey = streamCacheKey(jobId, question);
      let cachedText = null;
      try { cachedText = await redisClient.get(cacheKey); } catch { /* cache miss */ }

      if (cachedText) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Cache', 'HIT');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.write(`data: ${JSON.stringify({ text: cachedText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Cache', 'MISS');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      let fullText = '';

      streamSession = await chatClient.createStream({
        model: defaultChatModel,
        maxTokens: 500,
        messages: [{ role: 'user', content: question }],
        onText: (text) => {
          if (!clientClosed) {
            writeEvent({ text });
            fullText += text;
          }
        },
      });

      await streamSession.consume();

      if (fullText && redisClient) {
        try { await redisClient.setex(cacheKey, STREAM_CACHE_TTL, fullText); } catch { /* best-effort */ }
      }

      if (!clientClosed) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (error) {
      closeStream();
      if (res.headersSent) {
        if (!clientClosed && !res.writableEnded) {
          writeEvent({ error: error.message || 'Streaming failed.' });
          res.end();
        }
        return;
      }
      return res.status(500).json({ error: error.message || 'Streaming failed.' });
    }
  })();
}

export function streamChatController(req, res) {
  const question = String(req.body?.question || '').trim();
  const jobId = String(req.body?.jobId || '').trim();
  const conversationId = String(req.body?.conversationId || '').trim() || null;
  const historyLimit = Math.min(10, Math.max(0, Number(req.body?.historyLimit ?? 6)));

  if (!question || !jobId) {
    return res.status(400).json({ error: 'question and jobId are required.' });
  }

  if (question.length > 2000) {
    return res.status(400).json({ error: 'Question must be 2000 characters or fewer.' });
  }

  if (!chatClient.isConfigured()) {
    return res.status(503).json({ error: 'AI provider is not configured.' });
  }

  if (!embeddingClient.isConfigured()) {
    return res.status(503).json({ error: 'Embedding provider is not configured.' });
  }

  const abortController = new AbortController();
  let clientClosed = false;

  const writeSseEvent = (payload) => {
    if (clientClosed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  req.on('close', () => {
    clientClosed = true;
    abortController.abort();
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  (async () => {
    try {
      const ownership = await pgPool.query(
        `SELECT db_type FROM analysis_jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [jobId, req.userId],
      );

      if (ownership.rowCount === 0) {
        writeSseEvent({ type: 'error', message: 'Analysis job not found.' });
        return res.end();
      }

      const dbType = ownership.rows[0]?.db_type || 'postgres';
      const graphRepo = createGraphRepository(
        dbType === 'neo4j' ? { nodeCount: 9999 } : {},
        dbType === 'neo4j' ? { forceNeo4j: true } : { forcePostgres: true },
      );

      const agent = new ChatAgent({
        graphRepo,
        db: pgPool,
        redis: redisClient,
        llmClient: chatClient,
        embeddingClient,
      });

      const result = await agent.process({
        question,
        jobId,
        userId: req.userId,
        conversationId,
        historyLimit,
        signal: abortController.signal,
        onToken: (text) => {
          if (!clientClosed) writeSseEvent({ type: 'chunk', text });
        },
      }, { jobId });

      if (!clientClosed) {
        if (result.status === 'failed') {
          const errMsg = result.errors?.[0]?.message || 'Chat failed.';
          writeSseEvent({ type: 'error', message: errMsg });
        } else {
          writeSseEvent({
            type: 'done',
            sources: result.data?.sources || [],
            conversationId: result.data?.conversationId || null,
            confidence: result.data?.confidence || 'low',
            fallback: result.data?.fallback || false,
            cached: result.data?.cacheHit || false,
          });
        }
      }

      if (!res.writableEnded) res.end();
    } catch (error) {
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message || 'Chat failed.' });
      }
      writeSseEvent({ type: 'error', message: error.message || 'Chat failed.' });
      if (!res.writableEnded) res.end();
    }
  })();
}

export async function listConversationsController(req, res, next) {
  const jobId = String(req.query?.jobId || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

  if (!jobId) return res.status(400).json({ error: 'jobId is required.' });

  try {
    const { rows } = await pgPool.query(
      `
        SELECT c.id, c.title, c.created_at, c.updated_at,
               COUNT(m.id)::int AS message_count
        FROM conversations c
        LEFT JOIN conversation_messages m ON m.conversation_id = c.id
        WHERE c.user_id = $1 AND c.job_id = $2
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT $3
      `,
      [req.userId, jobId, limit],
    );

    return res.json({ conversations: rows });
  } catch (error) {
    return next(error);
  }
}

export async function getConversationMessagesController(req, res, next) {
  const convId = String(req.params.id || '').trim();
  if (!convId) return res.status(400).json({ error: 'Conversation ID is required.' });

  try {
    const { rows } = await pgPool.query(
      `
        SELECT m.id, m.role, m.content, m.source_files, m.confidence, m.created_at
        FROM conversation_messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.id = $1 AND c.user_id = $2
        ORDER BY m.created_at ASC
      `,
      [convId, req.userId],
    );

    return res.json({ messages: rows });
  } catch (error) {
    return next(error);
  }
}
