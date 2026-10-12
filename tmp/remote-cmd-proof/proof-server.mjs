/* 服务器远程指挥扩展 · 最小证明 · 小服务（端口 8798，零依赖）
 * 只干三件事：① 控制台把命令交上来（/send） ② 扩展长轮询取走（/pull） ③ 收回报（/report 扩展、/page-say 页面）
 * 全程写时间戳证据链，GET /log 可看。服务器自己绝不碰任何页面——它只负责"递纸条"。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.PORT || 8798);
const HOLD_MS = 25000; // 长轮询最长挂多久

const log = [];
const waiters = []; // 正挂着等命令的扩展（长轮询挂起中）
const queue = [];   // 没有扩展在等时，命令先排队
let extOnline = false;
let seq = 0;

const T0 = Date.now();
const stamp = () => new Date().toISOString().replace('T', ' ').slice(11, 23);
function add(kind, text) {
  const row = { t: stamp(), kind, text };
  log.push(row);
  console.log(`[${row.t}] ${kind.padEnd(4)} ${text}`);
}

const HEAD = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...HEAD });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); }
    });
  });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);

    if (req.method === 'OPTIONS') return json(res, 204, {});

    if (p === '/pull') {
      if (!extOnline) { extOnline = true; add('EXT', '🟢 扩展上线：长轮询挂上，正等服务器命令'); }
      if (queue.length) {
        const cmd = queue.shift();
        add('SRV', `📤 命令送达扩展（取走排队的命令）：${cmd.text}`);
        return json(res, 200, { cmd });
      }
      const w = { res, timer: null };
      w.timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        json(res, 200, { cmd: null });
      }, HOLD_MS);
      waiters.push(w);
      req.on('close', () => {
        const i = waiters.indexOf(w);
        if (i >= 0) { waiters.splice(i, 1); clearTimeout(w.timer); }
      });
      return;
    }

    if (p === '/send') {
      const b = await readBody(req);
      const cmd = { id: 'c' + (++seq), text: String(b.text || '(空命令)') };
      add('WEB', `🖱 你在控制台点了个按钮：${cmd.text}`);
      if (waiters.length) {
        const w = waiters.shift();
        clearTimeout(w.timer);
        add('SRV', `📤 命令隔空送达扩展（它正挂着等）：${cmd.text}`);
        json(w.res, 200, { cmd });
      } else {
        queue.push(cmd);
        add('SRV', `⏳ 扩展此刻不在线，命令先排队：${cmd.text}`);
      }
      return json(res, 200, { ok: true, id: cmd.id });
    }

    if (p === '/report') {
      const b = await readBody(req);
      add('EXT', String(b.text || ''));
      return json(res, 200, { ok: true });
    }

    if (p === '/page-say') {
      const b = await readBody(req);
      add('PAGE', `目标页面自己报告：我的标题现在是「${b.title}」`);
      return json(res, 200, { ok: true });
    }

    if (p === '/log') return json(res, 200, log);

    if (p === '/') return await sendFile(res, join(ROOT, 'control.html'));
    if (p.endsWith('.html')) {
      const fp = normalize(join(ROOT, p));
      if (fp.startsWith(normalize(ROOT))) return await sendFile(res, fp);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + req.url);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 ' + e.message);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[证明] 服务器起来了 → http://127.0.0.1:${PORT}/control.html （控制台）`));

async function sendFile(res, fp) {
  const buf = await readFile(fp);
  const type = extname(fp).toLowerCase() === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, ...HEAD });
  res.end(buf);
}
