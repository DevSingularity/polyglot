import fs from 'fs';
import parser from '@babel/parser';
const path = 'D:/GitHub/codegraph-ai/server/app.js';
const src = fs.readFileSync(path, 'utf8');
try {
  parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  console.log('Parsed OK');
} catch (e) {
  console.error('Parse error:', e.message);
  console.error(e.loc);
  const lines = src.split(/\r?\n/);
  const ln = e.loc ? e.loc.line : null;
  if (ln) console.error('Line context:', lines[ln-1]);
  process.exit(1);
}
