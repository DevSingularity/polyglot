import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

vi.mock('../src/analyze/services/githubApi.service.js', () => ({
  fetchRepoDetails: vi.fn(async ({ owner, repo }) => ({ owner, repo, fullName: `${owner}/${repo}`, defaultBranch: 'main' })),
  fetchRepoBranches: vi.fn(async () => (['main', 'dev'])),
  fetchRepoTree: vi.fn(async () => ({ truncated: false, tree: [ { path: 'src/index.js', type: 'blob', size: 123 }, { path: 'README.md', type: 'blob', size: 10 }, { path: 'lib/utils.js', type: 'blob', size: 20 } ] })),
  fetchRepoContents: vi.fn(async () => ([{ name: 'src', path: 'src', type: 'dir' }])),
  fetchRepoFileContent: vi.fn(async () => ({ path: 'README.md', content: 'hello' })),
  fetchOwnedRepositories: vi.fn(async () => ({ repositories: [{ owner: 'octo', repo: 'repo', fullName: 'octo/repo' }], scopes: [] })),
  resolvePublicRepository: vi.fn(async (url) => ({ owner: 'octo', repo: 'repo', fullName: 'octo/repo' })),
  updateRepoFileContent: vi.fn(async () => ({ path: 'file.txt', sha: 'new-sha', htmlUrl: 'https://github.com/octo/repo/blob/main/file.txt', commitSha: 'commit-sha' })),
  parseGitHubRepoUrl: vi.fn((url) => ({ owner: 'octo', repo: 'repo' })),
}));

import analyzeRouter from '../src/analyze/routes/analyze.routes.js';

describe('github browser endpoints', () => {
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

  it('lists branches for a repo', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/branches?owner=octo&repo=repo`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repository.fullName).toBe('octo/repo');
    expect(Array.isArray(body.branches)).toBe(true);
  });

  it('returns repository structure', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/structure?owner=octo&repo=repo`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repository.fullName).toBe('octo/repo');
    expect(Array.isArray(body.directories)).toBe(true);
    expect(Array.isArray(body.files)).toBe(true);
  });

  it('returns directory contents', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/contents?owner=octo&repo=repo&path=src`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('src');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('returns file content', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/file?owner=octo&repo=repo&path=README.md`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.path).toBe('README.md');
  });

  it('lists owned repos', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/repos`, { headers: { Cookie: 'github_token=tok' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.repositories)).toBe(true);
  });

  it('resolves public repo from URL', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/public/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/octo/repo' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fullName).toBe('octo/repo');
  });

  it('updates a file for owned repo', async () => {
    await new Promise((res) => server.listen(0, res));
    const { port } = server.address();
    const baseUrl = `http://localhost:${port}`;

    const res = await fetch(`${baseUrl}/api/analyze/github/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: 'github_token=tok' },
      body: JSON.stringify({ source: 'owned', owner: 'octo', repo: 'repo', path: 'file.txt', content: 'hi', message: 'msg', sha: 'old-sha' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.sha).toBe('new-sha');
  });
});
