import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

// Mock dependencies before importing the router
vi.mock('../src/analyze/upload/upload.service.js', () => ({
  createOrGetRepository: vi.fn(async () => 'repo-123'),
  createAnalysisJob: vi.fn(async () => 'job-456'),
}));
vi.mock('../src/queue/analysisQueue.js', () => ({ enqueueAnalysisJob: vi.fn(async () => true) }));
vi.mock('../src/infrastructure/cache.js', () => ({
  invalidateAnalysisHistoryCacheForUser: vi.fn(async () => {}),
  invalidateRepositoriesCacheForUser: vi.fn(async () => {}),
}));
vi.mock('../src/utils/authUser.js', () => ({
  getAuthUser: () => ({ id: 'auth-1' }),
  resolveDatabaseUserId: async () => 'db-user-id',
}));

import analyzeRouter from '../src/analyze/routes/analyze.routes.js';
import { enqueueAnalysisJob } from '../src/queue/analysisQueue.js';
import { createAnalysisJob } from '../src/analyze/upload/upload.service.js';

describe('upload analyze flow', () => {
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

  it('enqueues analysis job and returns 202 with jobId', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const payload = {
      source: 'github',
      github: {
        owner: 'octo',
        repo: 'repo',
        branch: 'main',
      },
    };

    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toBe('job-456');

    // ensure underlying queue and job creator were invoked
    expect(enqueueAnalysisJob).toHaveBeenCalled();
    expect(createAnalysisJob).toHaveBeenCalled();
  });
});
