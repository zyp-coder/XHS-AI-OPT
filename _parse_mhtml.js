// 从 MHTML 提取 HTML 部分，另存为 _notification_new.html（调试用临时脚本）
const fs = require('fs');
const src = process.argv[2];
const out = process.argv[3];
const raw = fs.readFileSync(src, 'utf8');
const bm = raw.match(/boundary="([^"]+)"/);
if (!bm) { console.error('no boundary'); process.exit(1); }
const boundary = '--' + bm[1];
const parts = raw.split(boundary);
let htmlPart = null;
for (const p of parts) {
  if (p.includes('Content-Type: text/html')) { htmlPart = p; break; }
}
if (!htmlPart) { console.error('no html part'); process.exit(1); }
const hb = htmlPart.indexOf('\r\n\r\n');
const headers = htmlPart.slice(0, hb);
const body = htmlPart.slice(hb + 4).replace(/\r\n$/, '');
const cte = (headers.match(/Content-Transfer-Encoding:\s*(\S+)/i) || [])[1] || '8bit';
console.log('CTE:', cte);
let html = body;
if (cte.toLowerCase().includes('quoted-printable')) {
  // quoted-printable 解码得到的是字节流（=XX 即字节值），需按 latin1 还原字节再转 UTF-8
  const bytes = body
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  html = Buffer.from(bytes, 'latin1').toString('utf8');
} else if (cte.toLowerCase().includes('base64')) {
  html = Buffer.from(body.replace(/[\r\n]/g, ''), 'base64').toString('utf8');
}
fs.writeFileSync(out, html);
console.log('HTML 长度:', html.length);
console.log('包含 notification:', html.includes('notification'));
console.log('container 数量:', (html.match(/class="container"/g) || []).length);
