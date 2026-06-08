import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

// Mock DB and cache before router import
vi.mock('../src/infrastructure/connections.js', () => ({
  pgPool: {
    query: async (sql) => {
      if (String(sql).includes('WITH latest_repo_jobs')) {
        return {
          rows: [
            {
              repository_id: 'repo-1',
              source: 'github',
              full_name: 'octo/repo',
              github_owner: 'octo',
              github_repo: 'repo',
              default_branch: 'main',
              id: 'repo-1',
              job_id: 'job-1',
              latest_completed_job_id: 'job-1',
              status: 'completed',
              branch: 'main',
              node_count: 10,
              edge_count: 20,
              analyzed_at: new Date().toISOString(),
            },
          ],
        };
      }

      if (String(sql).includes('SELECT COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }

      return { rows: [] };
    },
  },
  redisClient: {},
}));

vi.mock('../src/infrastructure/cache.js', () => ({
  buildAnalysisHistoryCacheKey: () => 'history-key',
  cacheTtl: { analysisHistorySeconds: 60 },
  readJsonCache: async () => null,
  writeJsonCache: async () => {},
}));

vi.mock('../src/utils/authUser.js', () => ({
  getAuthUser: () => ({ id: 'auth-1' }),
  resolveDatabaseUserId: async () => 'db-user-id',
}));

import analyzeRouter from '../src/analyze/routes/analyze.routes.js';

describe('analysis history', () => {
  let app;
  let server;

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
    app.use(cookieParser());
    app.use('/api/analyze', analyzeRouter);
    server = http.createServer(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.close();
  });

  it('returns analysis history (MISS cache path)', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/history`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const body = await res.json();
    expect(Array.isArray(body.repositories)).toBe(true);
    expect(body.summary.totalAnalyzed).toBe(1);
  });
});
