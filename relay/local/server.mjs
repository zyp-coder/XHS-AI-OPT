/* 中转 · 本地版（零依赖 Node，开局先在本机把整条链路跑通用）

   用法：node relay/local/server.mjs [端口]        （默认 8788）
   访问：
     · 电脑上自测     http://127.0.0.1:8788/
     · 手机（同一 Wi-Fi）http://<这台电脑的局域网 IP>:8788/
   说明：手机桥在电脑上走 127.0.0.1 推快照；手机页从局域网进来读——整条链路不需要任何云。
        上线给外面的手机用，再换 relay/worker（Cloudflare）或任意一台云主机。

   数据落在 relay/local/.data.json（已加进 .gitignore，不入库）。
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handle, sweep, RELAY_VER } from '../core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHONE_HTML = path.join(HERE, '..', 'phone', 'index.html');
const DATA_FILE = path.join(HERE, '.data.json');
const PORT = Number(process.argv[2]) || 8788;

/* ── 存储：整份 JSON 落盘，读写都排队（单进程单线程，够用） ── */
let db = { kv: {} };
try { if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { db = { kv: {} }; }
let saving = Promise.resolve();
function save() {
  saving = saving.then(() => fs.promises.writeFile(DATA_FILE, JSON.stringify(db), 'utf8')).catch(() => {});
  return saving;
}
const store = {
  async get(k) { return Object.prototype.hasOwnProperty.call(db.kv, k) ? db.kv[k] : null; },
  async put(k, v) { db.kv[k] = v; await save(); },
  async del(k) { delete db.kv[k]; await save(); },
  async list(prefix) {
    return Object.keys(db.kv).filter(k => k.startsWith(prefix)).map(k => ({ key: k, value: db.kv[k] }));
  },
};

/* ── HTTP ── */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 256 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      const html = fs.readFileSync(PHONE_HTML);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
      return res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS });
      return res.end('读不到手机页：' + PHONE_HTML);
    }
  }

  const body = (req.method === 'POST') ? await readBody(req) : {};
  const out = await handle(
    { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body },
    store,
    { lan: PHONE_BASES },
  );
  res.writeHead(out.status, { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...CORS });
  res.end(out.body);
});

/* 手机页从局域网进来要能连上：绑 0.0.0.0，并把这台机器的局域网地址打出来。
   169.254.*（网卡没拿到 DHCP 时的自留地址）手机连不上，直接滤掉；家里的网段排前面。 */
function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const it of (list || [])) {
      if (it && it.family === 'IPv4' && !it.internal && !/^169\.254\./.test(it.address)) out.push(it.address);
    }
  }
  return out.sort((a, b) => (rank(a) - rank(b)));
}
const rank = (ip) => (/^(192\.168\.|10\.)/.test(ip) ? 0 : (/^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 2));
/* 手机能直接开的地址（配对二维码就画它）。云部署时这一串为空，改用中转自己的域名 */
const PHONE_BASES = lanIPs().map((ip) => 'http://' + ip + ':' + PORT);

server.listen(PORT, '0.0.0.0', async () => {
  const n = await sweep(store);
  console.log('🌿 手机看板 · 中转（本地版）已启动  v' + RELAY_VER);
  console.log('   本机    : http://127.0.0.1:' + PORT + '/');
  for (const base of PHONE_BASES) console.log('   局域网  : ' + base + '/   ← 手机连同一个 Wi-Fi 可开');
  if (n) console.log('   清掉过期配对码 ' + n + ' 个');
  console.log('   数据文件: ' + path.relative(process.cwd(), DATA_FILE));
  setInterval(() => { sweep(store).catch(() => {}); }, 10 * 60 * 1000);   // 顺手清过期码
});
