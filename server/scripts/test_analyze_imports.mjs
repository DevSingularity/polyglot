const imports = [
  './src/analyze/middleware/validate.middleware.js',
  './src/analyze/githubBrowser/githubBrowser.controller.js',
  './src/analyze/prCommit/prCommit.controller.js',
  './src/analyze/history/history.controller.js',
  './src/analyze/localPicker/localPicker.controller.js',
  './src/analyze/upload/upload.controller.js'
];

(async ()=>{
  const base = new URL('../', import.meta.url);
  for (const s of imports) {
    try {
      console.log('importing', s);
      await import(new URL(s, base).href);
      console.log('OK', s);
    } catch (e) {
      console.error('FAIL', s, e.stack || e);
      process.exit(1);
    }
  }
  console.log('All OK');
})();
