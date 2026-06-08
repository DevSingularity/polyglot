import fs from 'fs';
import vm from 'vm';
const path = 'D:/GitHub/codegraph-ai/server/app.js';
const src = fs.readFileSync(path, 'utf8');
try {
  const mod = new vm.SourceTextModule(src, { url: `file://${path}` });
  await mod.link(() => {});
  await mod.evaluate();
  console.log('Compiled ok');
} catch (e) {
  console.error('Compile error:', e);
  if (e.loc) console.error('Location:', e.loc);
  process.exit(1);
}
