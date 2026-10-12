/* 手机桥 · 弹窗预览（开发用，不开扩展也能看弹窗长什么样）
   把 bridge/popup.html 原样拿来、chrome.* 打桩，用 ?state= 切三种状态，
   给浏览器截图核对布局与二维码（QR 是真画出来的）。
   用法：node scripts/dev/_popup_preview.mjs [端口]     （默认 8919）
   状态：paired＝已配对有数据 / nopair＝未配对 / stale＝已配对还没上报过 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = Number(process.argv[2]) || 8919;

const html = fs.readFileSync(path.join(ROOT, 'bridge/popup.html'), 'utf8');
const qr = fs.readFileSync(path.join(ROOT, 'bridge/lib/qr.js'), 'utf8');
const popup = fs.readFileSync(path.join(ROOT, 'bridge/popup.js'), 'utf8');

const STUB = `
<script>
(function () {
  var state = new URLSearchParams(location.search).get('state') || 'nopair';
  var now = Date.now();
  var BASE = {
    ok: true, base: 'http://127.0.0.1:8788', name: '\u529e\u516c\u5ba4\u7535\u8111', paired: true,
    pair: { deviceId: 'a1b2c3', code: 'SSTA9FEL', codeAt: now,
            url: 'http://192.168.3.243:8788/#p=SSTA9FEL', host: '\u529e\u516c\u5ba4\u7535\u8111' },
    main: { id: 'cpfhpplfnkmdhjnpjldfpfpbdjabgmnl', name: '\u5c0f\u7ea2\u4e66\u8bc4\u8bba\u52a9\u624b \u00b7 \u5f00\u53d1\u7248', ver: '3.15.7', auto: true },
    mainIdManual: '', relay: { ok: true, ver: '0.1.0', lan: ['http://192.168.3.243:8788'] },
    last: { at: now - 42000, ok: true, err: '' },
  };
  var STATES = {
    paired: BASE,
    nopair: Object.assign({}, BASE, { paired: false, pair: null, last: null,
      main: null, relay: { ok: false, net: true } }),
    stale: Object.assign({}, BASE, { last: null }),
  };
  var ACTIONS = {
    bridgeStatus: STATES[state],
    bridgePairNew: { ok: true, lan: true, pair: { deviceId: 'a1b2c3', code: 'NEWCODE7', codeAt: Date.now(),
      url: 'http://192.168.3.243:8788/#p=NEWCODE7', host: '\u529e\u516c\u5ba4\u7535\u8111' } },
    bridgeSetName: function (m) { return { ok: true, name: m.name || '\u8fd9\u53f0\u7535\u8111' }; },
    bridgeSetRelay: function (m) { return /^https?:\\/\\/\\S+$/i.test(String(m.base || '').trim()) ? { ok: true, base: String(m.base).trim() } : { ok: false, error: '\u5730\u5740\u8981\u5199\u6210 http://\u2026 \u6216 https://\u2026' }; },
    bridgeSetMainId: function (m) { var id = String(m.mainId || '').trim();
      if (id && !/^[a-p]{32}$/.test(id)) return { ok: false, error: '\u6269\u5c55 ID \u662f 32 \u4f4d\u5c0f\u5199\u5b57\u6bcd\uff08a\u2013p\uff09' };
      return { ok: true, mainId: id || 'cpfhpplfnkmdhjnpjldfpfpbdjabgmnl' }; },
    bridgePushNow: { ok: true },
    bridgeUnbind: { ok: true },
  };
  var deny = new URLSearchParams(location.search).get('denyperm') === '1';
  window.chrome = {
    permissions: { request: async function () { return !deny; } },
    runtime: { lastError: undefined, sendMessage: function (msg, cb) {
    var a = String((msg || {}).action || '');
    var r = typeof ACTIONS[a] === 'function' ? ACTIONS[a](msg) : (ACTIONS[a] || { ok: true });
    setTimeout(function () { cb(r); }, 30);
  } } };
})();
</script>
`;

const page = html
  .replace('<script src="lib/qr.js"></script>', STUB + '<script>\n' + qr + '\n</script>')
  .replace('<script src="popup.js"></script>', '<script>\n' + popup + '\n</script>');

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}).listen(PORT, '127.0.0.1', () => {
  console.log('弹窗预览: http://127.0.0.1:' + PORT + '/?state=paired|nopair|stale');
});
