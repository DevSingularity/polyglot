import { vi } from 'vitest';

// Provide lightweight mock implementations for pgPool and redisClient
const mockPgPool = {
  query: async (sql) => {
    const s = String(sql || '').toLowerCase();

    // Common patterns used in tests - return simple safe defaults
    if (s.includes('select count(*)')) return { rows: [{ total: 0 }] };
    if (s.includes('with latest_repo_jobs')) return { rows: [] };
    if (s.includes('select id') || s.includes('insert into users')) return { rows: [{ id: 'mock-user-id' }], rowCount: 1 };
    // Default empty result
    return { rows: [], rowCount: 0 };
  },
  on: () => {},
  end: async () => {},
};

const mockRedisClient = {
  get: async () => null,
  set: async () => 'OK',
  del: async () => 1,
  on: () => {},
};

vi.mock('../src/infrastructure/connections.js', () => ({
  pgPool: mockPgPool,
  redisClient: mockRedisClient,
}));

// Ensure VITEST env var is present for modules that check it
process.env.VITEST = '1';
