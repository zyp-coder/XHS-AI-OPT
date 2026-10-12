// 把 lib/pub-adapt.js 里的 NPA_* 函数导出成 JSON（供 Playwright 联调脚本直接注入页面）
// 用法：node scripts/dev/_npa_dump.js > /dev/null 之外，python 侧 execFile 调用
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'lib', 'pub-adapt.js'), 'utf-8');
const names = [...src.matchAll(/const (NPA_\w+)\s*=/g)].map(m => m[1]);
const FN = new Function(src + '\nreturn {' + names.join(',') + '};');
const obj = FN();
const out = {};
names.forEach(n => { out[n] = obj[n].toString(); });
process.stdout.write(JSON.stringify(out));
