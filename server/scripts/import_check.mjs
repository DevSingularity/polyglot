const modules = [
  'app.js',
  './src/analyze/index.js',
  './src/auth/index.js',
  './src/api/jobs/index.js',
  './src/api/graph/index.js',
  './src/api/ai/index.js',
  './src/api/repositories/index.js',
  './src/api/share/index.js',
  './src/api/webhooks/github.webhook.js',
  './src/api/webhooks/pr-comment.routes.js',
  './src/utils/logger.js',
  './src/middleware/notFound.middleware.js',
  './src/middleware/errorHandler.middleware.js',
  './src/infrastructure/connections.js',
  './src/services/ai/llmProvider.js'
];

(async () => {
  const base = new URL('../', import.meta.url);
  for (const m of modules) {
    try {
      console.log('importing', m);
      await import(new URL(m, base));
      console.log('OK', m);
    } catch (e) {
      console.error('FAIL', m, e.stack || e);
      process.exit(1);
    }
  }
  console.log('All imports succeeded');
})();
