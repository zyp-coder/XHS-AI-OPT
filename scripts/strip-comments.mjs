// 去掉 JS 里的注释：只删解析器认定的真注释，字符串与界面文案一个字不碰
// 用法：node scripts/strip-comments.mjs <文件或目录> [--write <输出目录>]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

export function stripComments(src) {
  const comments = [];
  const grab = (isBlock, _text, start, end) => { if (start >= end) return; comments.push({ isBlock, start, end }); };
  try {
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', onComment: grab });
  } catch (e) {
    comments.length = 0;
    try {
      for (const _t of acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'script', onComment: grab })) { /* 逐句扫一遍即可 */ }
    } catch (e2) {
      return { src, removed: 0, error: String(e.message).slice(0, 90) };
    }
  }
  comments.sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const c of comments) {
    if (c.start < at) continue;
    const body = src.slice(c.start, c.end);
    const nl = (body.match(/\n/g) || []).length;
    out += src.slice(at, c.start) + (c.isBlock ? (nl ? '\n'.repeat(nl) : ' ') : '');
    at = c.end;
  }
  return { src: out + src.slice(at), removed: comments.length, error: '' };
}

function jsFiles(target) {
  if (!statSync(target).isDirectory()) return [target];
  const out = [];
  for (const it of readdirSync(target)) {
    const p = join(target, it);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (it.endsWith('.js')) out.push(p);
  }
  return out;
}

// 自证：把两份代码各自拆成语句碎片逐条比对（注释本就不算碎片）
// 碎片完全一致 = 删掉的只有注释，代码一个字没变
function tokensOf(src) {
  const arr = [];
  for (const t of acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'script' })) {
    if (t.type.label === 'eof') break;
    arr.push(t.type.label + '|' + src.slice(t.start, t.end));
  }
  return arr;
}

export function verify(src, stripped) {
  let a, b;
  try { a = tokensOf(src); b = tokensOf(stripped); } catch (e) { return '碎片拆不出来：' + e.message; }
  if (a.length !== b.length) return '碎片条数不同 ' + a.length + ' vs ' + b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return '第 ' + (i + 1) + ' 个碎片变了：' + a[i] + ' → ' + b[i];
  }
  const nl = (s) => (s.match(/\n/g) || []).length;
  if (nl(src) !== nl(stripped)) return '换行行数不同 ' + nl(src) + ' vs ' + nl(stripped) + '（可能影响自动分句）';
  return '';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const wi = args.indexOf('--write');
  const outDir = wi >= 0 ? args[wi + 1] : '';
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const gz = (s) => gzipSync(Buffer.from(s), { level: 9 }).length;
  let tGz = 0, sGz = 0, bad = 0;
  for (const f of jsFiles(args[0])) {
    const src = readFileSync(f, 'utf8');
    const r = stripComments(src);
    const g0 = gz(src), g1 = r.error ? g0 : gz(r.src);
    tGz += g0; sGz += g1;
    const v = r.error ? '⚠️ 解析不过：' + r.error : verify(src, r.src);
    if (v) bad++;
    console.log('%s\n  压缩 %dB → %dB，省 %dB（注释 %d 条）｜ %s',
      f, g0, g1, g0 - g1, r.removed, v ? '❌ ' + v : '✔ 逐句核对一致');
    if (outDir && !r.error && !v) writeFileSync(join(outDir, basename(f)), r.src);
  }
  console.log('\n合计压缩 %dB → %dB，省 %dB（%s%%）｜ 有问题的文件 %d 个',
    tGz, sGz, tGz - sGz, ((tGz - sGz) * 100 / (tGz || 1)).toFixed(1), bad);
  if (bad) process.exitCode = 1;
}
