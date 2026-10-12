/* 二维码编码器自测（第一步）：把若干条文本编成矩阵，写成 JSON 给 Python 侧解回来比对
   用法：node scripts/dev/_gen_qr_samples.mjs
   下一步：python3 scripts/dev/_check_qr_roundtrip.py */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '../..');
const QR = require(path.join(ROOT, 'bridge/lib/qr.js'));

/* 覆盖：本地中转 / 云中转 / 最长 / 中文 / 边界长度（各版本容量切换处） */
const SAMPLES = [
  'http://192.168.1.23:8788/#p=K7M2QP4X',
  'http://127.0.0.1:8788/#p=ABCD1234',
  'https://xin-xhs-bridge.example.workers.dev/#p=Q7W2E9R4',
  '日常浏览 · 队列看板',
  'x'.repeat(14),      // 版本 1-M 的容量上限
  'x'.repeat(15),      // 逼到版本 2
  'x'.repeat(106),     // 版本 6
  'x'.repeat(213),     // 版本 10-M 的容量上限
];

const out = [];
for (const text of SAMPLES) {
  const qr = QR.encode(text);
  out.push({ text, version: qr.version, mask: qr.mask, size: qr.size, rows: qr.rows() });
}

/* 超容量必须明确报错，别画出个残缺的码 */
let tooLong = '';
try { QR.encode('x'.repeat(QR.maxBytes() + 1)); } catch (e) { tooLong = e.message; }
if (!tooLong) { console.error('❌ 超容量没报错'); process.exit(1); }

const dest = path.join(ROOT, 'scripts/dev/_qr_samples.json');
writeFileSync(dest, JSON.stringify(out, null, 0), 'utf8');
console.log('✅ 编码 ' + out.length + ' 条 → ' + path.relative(ROOT, dest).replace(/\\/g, '/'));
out.forEach(o => console.log('   v' + o.version + ' mask' + o.mask + ' ' + String(o.size) + '×' + String(o.size) + '  ' + o.text.slice(0, 42) + (o.text.length > 42 ? '…' : '')));
console.log('✅ 超容量（' + (QR.maxBytes() + 1) + ' 字节）已按预期报错：' + tooLong);
console.log('\n下一步：python3 scripts/dev/_check_qr_roundtrip.py');
