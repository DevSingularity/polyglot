(async()=>{
  try {
    await import(new URL('../src/analyze/upload/upload.controller.js', import.meta.url).href);
    console.log('imported upload.controller ok');
  } catch (e) {
    console.error('ERROR importing upload.controller:', e.stack || e);
    process.exit(1);
  }
})();
