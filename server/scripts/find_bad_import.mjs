import fs from 'fs';
import parser from '@babel/parser';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const appPath = serverDir + '/app.js';
const src = fs.readFileSync(appPath, 'utf8');
const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });

const imports = ast.program.body
  .filter((n) => n.type === 'ImportDeclaration')
  .map((n) => n.source.value);

console.log('Found imports:', imports.length);
imports.forEach((s, i) => console.log(i, s));

function makeTempModule(slice, idx) {
  const lines = slice.map((s, i) => `import '${s}';`);
  const content = lines.join('\n') + '\nexport default 0;';
  const tmpPath = `${serverDir}/scripts/tmp_import_${idx}.mjs`;
  fs.writeFileSync(tmpPath, content);
  return tmpPath;
}

async function testSlice(slice, idx) {
  const tmpPath = makeTempModule(slice, idx);
  try {
    await import('file://' + tmpPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function binarySearch(list) {
  let low = 0, high = list.length - 1;
  let failingRange = { low: 0, high: list.length - 1 };

  // If full list passes, nothing to do
  const fullTest = await testSlice(list, 'full');
  if (fullTest.ok) {
    console.log('All imports OK when imported together.');
    return null;
  }

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const slice = list.slice(low, mid + 1);
    console.log(`Testing slice [${low}..${mid}] (${slice.length} imports)`);
    const res = await testSlice(slice, `${low}_${mid}`);
    if (!res.ok) {
      // failing in this slice, narrow to this half
      failingRange = { low, high: mid };
      if (low === mid) return low;
      high = mid;
    } else {
      // first half OK, test second half
      if (mid + 1 > high) break; // nothing left
      low = mid + 1;
    }
  }
  return failingRange.low;
}

(async () => {
  const idx = await binarySearch(imports);
  if (idx === null) {
    console.log('No failing import found via binary search.');
    process.exit(0);
  }
  console.log('Failing import index:', idx, 'specifier:', imports[idx]);
})();
