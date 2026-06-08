import fs from 'fs';
const path = 'D:/GitHub/codegraph-ai/server/app.js';
const src = fs.readFileSync(path, 'utf8');
const dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(src);
import(dataUrl).then(()=>console.log('imported data url ok')).catch(e=>{console.error(e.stack || e); process.exit(1)});
