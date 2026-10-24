/**
 * gui.js — 小红书运营工具 · 网页版打包界面（本地运行，无需联网）
 *
 * 用法：node gui.js
 * Windows 双击配套的「一键启动打包程序.cmd」即可。
 *
 * ★ 2026-10-16 收口：打的就是发货包＝执行器（executor/）——只有手、不带开始按钮，
 *   客户装上填配对号挂线，干活从网页下单；档位真源在公网那台。
 *
 * 可靠说明：
 *  - 点“开始打包”用的是普通 HTML 表单 POST（不做 fetch、不做 JSON、不涉及跨域预检），
 *    只要页面能打开，提交就一定能发到本服务，几乎不可能再出现 Failed to fetch。
 *  - 打包结果在一个内嵌框里显示；结果也会写进《打包日志-gui.txt》供排查。
 *  - 启动时自动找空闲端口，避免上次残留进程占用导致用到旧页面。
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT0 = 8765;
const BUILD = path.join(ROOT, 'build.js');
const GUILOG = path.join(ROOT, '打包日志-gui.txt');
const ENV = path.join(ROOT, 'server', '.env');
/* 档位真源在公网那台（2026-10-16 收口）：包里这张只是进门默认，
   所以打完包要把「这位客户落在哪档」顺手同步到那台机器上——省得两边对不上。 */
const TIER_OF = { full: '全功能', 'comment-multi': '升级', comment: '基础' };
/* 公网口令只读本机 server/.env（这文件不进 Git），不写进仓库、也不回显在页面上 */
function adminPass() {
  try {
    const m = fs.readFileSync(ENV, 'utf8').match(/^\s*(?:export\s+)?DEMO_ADMIN_PASS\s*=\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch (_) { return ''; }
}
const pad2 = (n) => String(n).padStart(2, '0');
function gts() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function guiLog(l) { const line = `[${gts()}] ${l}`; try { fs.appendFileSync(GUILOG, line + '\r\n', 'utf8'); } catch (_) {} console.log(line); }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── 打包表单页（straight HTML form，内嵌结果显示） ────────── */
const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><title>小红书运营工具 · 一键打包</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 *{box-sizing:border-box;margin:0;padding:0}
 body{font:14px/1.6 "Microsoft YaHei","PingFang SC",sans-serif;background:#f5f6f8;color:#222}
 .wrap{max-width:640px;margin:24px auto;padding:0 16px 60px}
 .card{background:#fff;border:1px solid #e7e7e7;border-radius:14px;padding:22px 26px}
 h1{font-size:20px;margin-bottom:4px}.sub{color:#888;font-size:13px;margin-bottom:18px}
 .field{margin-bottom:16px}.field label{display:block;font-weight:600;margin-bottom:6px}
 .field .tip{color:#999;font-weight:400;font-size:12px}
 input[type=text],input[type=number],select{width:100%;padding:10px 12px;font-size:14px;border:1px solid #d3d6dc;border-radius:8px;background:#fbfbfc}
 input:focus,select:focus{outline:none;border-color:#ff274b;background:#fff}
 .row{display:flex;gap:14px}.row>div{flex:1}
 .btn{margin-top:6px;width:100%;padding:14px;font-size:16px;font-weight:600;color:#fff;background:#ff274b;border:none;border-radius:10px;cursor:pointer}
 .btn:hover{background:#e61f42}
 iframe#out{width:100%;height:300px;border:1px solid #e7e7e7;border-radius:10px;margin-top:16px;background:#fff;display:none}
 .info{color:#666;font-size:12.5px;margin-top:10px;line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
 <div class="card">
  <h1>小红书运营工具 · 一键打包</h1>
  <div class="sub">填好后点「开始打包」，生成客户直接可装的执行器 zip（只有手；干活从网页下单）。</div>
  <form method="post" action="/pack" target="out" id="f">
   <div class="field">
     <label>版本档位 <span class="tip">（包里进门默认；真表在公网那台，改档不用重打包）</span></label>
<select name="type">
       <option value="full">全功能版（发笔记 + 获客 + 线索 · ¥539/月）</option>
       <option value="comment-multi">升级版（发笔记 + 获客 · ¥399/月）</option>
       <option value="comment">基础版（发笔记 · ¥239/月）</option>
       <option value="pro">自用版（内部·零等待·全功能）</option>
     </select>
   </div>
   <div class="field">
     <label>客户名 / 授权对象（选填）</label>
     <input type="text" name="licensee" placeholder="例如：某公司 或 张三（会显示在包名上）">
     <div class="tip">不用绑号了——客户拿配对号挂上线，认号、认档都在服务器那边（见「发放管理 → 执行器发放」）。</div>
   </div>
   <div class="field">
     <label>这位客户（公网那台的手机号）<span class="tip">　选填——填了就打完包顺手把他的档位改成上面选的这档</span></label>
     <input type="text" name="phone" placeholder="他在起始页领号用的手机号（留空＝不动公网那台）">
     <div class="tip">档位真源在那台机器上，包里这张只是进门默认；这里对一下，他挂上线 15 秒内界面就跟上。自用版不需要同步。</div>
   </div>
   <div class="field">
     <label>公网那台地址</label>
     <input type="text" name="srv" value="http://127.0.0.1:8799/">
     <div class="tip">在本机跑着就填 127.0.0.1:8799；已经上云填云上那个网址。口令读本机 server/.env，不写进仓库。</div>
   </div>
   <div class="row">
     <div class="field"><label>进门默认天数</label><input type="number" name="days" value="30" min="1"></div>
     <div class="field"><label>输出目录</label><input type="text" name="out" value="dist"></div>
   </div>
   <button type="submit" class="btn" id="btn">开始打包</button>
   <div class="info">发货包＝执行器（只有手）。客户装机：解压 zip → Edge 打开 <b>edge://extensions</b> → 开启「开发者模式」→「加载解压缩的扩展」选解压后的文件夹 → 点插件图标填配对号挂线。</div>
  </form>
  <iframe name="out" id="out"></iframe>
 </div>
</div>
<script>
  var btn=document.getElementById('btn'), fr=document.getElementById('out');
  // 关键：不能在点击处理里【同步】禁用提交按钮，否则会取消表单提交。这里延迟一瞬再禁用。
  btn.addEventListener('click', function(){
    fr.style.display='block';
    window.setTimeout(function(){ btn.disabled=true; btn.textContent='正在打包…可能需要几秒，请等候，结果会显示在下面框里'; }, 100);
  });
  // 结果框加载完成（打包结果已到）→ 恢复按钮，可再打一个
  fr.addEventListener('load', function(){
    btn.disabled=false; btn.textContent='开始打包';
    window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
  });
</script>
</body>
</html>`;

/* ── 打包结果页（在 iframe 内显示） ───────────────────────── */
function renderResult(r, elapsedMs) {
  const dur = elapsedMs != null ? `（耗时 ${elapsedMs} ms）` : '';
  const head = r.ok ? `✅ 打包完成 ${dur}` : `❌ 打包失败 ${dur}`;
  const cls = r.ok ? 'ok' : 'err';
  const zip = r.zip ? `<div class="path">ZIP 压缩包：<b>${esc(r.zip)}</b></div>` : '';
  const err = (!r.ok && r.error) ? `<div class="err2">${esc(r.error)}</div>` : '';
  const sync = r.sync ? `<div class="${r.sync.ok ? 'sync' : (r.sync.skip ? 'sync skip' : 'err2')}">${r.sync.ok ? '↪ ' : '⚠ '}${esc(r.sync.note)}</div>` : '';
  const tip = r.ok
    ? '<div class="step">发货包＝执行器：解压 zip → Edge 打开 edge://extensions → 开「开发者模式」→「加载解压缩的扩展」选解压后的文件夹 → 插件图标里填配对号挂线</div>'
    : '<div class="step">没成功也没关系，把下面黑色日志发给服务商，或点「返回」再调一下参数重新打。</div>';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>打包结果</title>
<style>
 body{font:14px/1.6 "Microsoft YaHei",sans-serif;background:#fff;color:#222;padding:18px 20px}
 .head{font-size:17px;font-weight:600;margin-bottom:10px}.ok{color:#2e9e4f}.err{color:#d33}
 .path{font-size:13px;color:#444;word-break:break-all;margin-bottom:8px}
 .err2{color:#d33;font-size:13px;margin-bottom:8px}
 .sync{color:#2e7d32;font-size:13px;margin-bottom:8px}.sync.skip{color:#888}
 .step{font-size:12.5px;color:#666;line-height:1.8;margin-bottom:12px}
 pre{background:#1e1e1e;color:#c8ffc8;padding:12px;border-radius:8px;font:12px/1.6 Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto}
 a.back{display:inline-block;margin-top:10px;color:#ff274b;text-decoration:none;font-weight:600}
</style></head><body>
<div class="head ${cls}">${head}</div>${zip}${err}${sync}<div class="step">${tip}</div>
<pre>${esc(r.log || '')}</pre>
<a class="back" onclick="parent.document.getElementById('btn').click();return false" href="#">再打一次</a>
</body></html>`;
}

/* ── 执行打包（捕错误 + 超时 + 写日志） ───────────────────── */
function runPack(payload) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    const finish = (r) => {
      if (done) return; done = true;
      guiLog(`结果：ok=${r.ok}${r.error ? ' 错误=' + r.error : ''}${r.zip ? ' zip=' + r.zip : ''}`);
      if (!r.ok) guiLog(`打包进程输出(诊断)：\r\n${r.log || '(无)'}`);
      r.elapsedMs = Date.now() - t0;
      resolve(r);
    };
    const args = [payload.type, '--days', String(payload.days)];
    if (payload.licensee) args.push('--licensee', payload.licensee);
    if (payload.out && payload.out !== 'dist') args.push('--out', payload.out);
    guiLog(`收到打包请求：${JSON.stringify({ type: payload.type, licensee: payload.licensee || '(无)', phone: payload.phone || '(不同步公网)', srv: payload.srv || '(默认本机)', days: payload.days, out: payload.out || 'dist' })}`);
    if (!fs.existsSync(BUILD)) { finish({ ok: false, error: '找不到打包脚本 build.js（位置：' + BUILD + '）', log: '' }); return; }
    let child;
    try { child = spawn(process.execPath, [BUILD, ...args], { cwd: ROOT }); }
    catch (e) { finish({ ok: false, error: '无法启动打包进程：' + e.message, log: '' }); return; }
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', (e) => finish({ ok: false, error: '打包进程出错：' + e.message, log: (stdout + stderr).trim() }));
    child.on('close', (code) => {
      const out = stdout + stderr;
      const m = out.match(/ZIP\s*包\s*:\s*(.+)/);
      guiLog('打包进程已退出 exit=' + code);
      finish({ ok: code === 0, error: code === 0 ? '' : '打包失败，请看下方日志', log: out.trim(), zip: m ? m[1].trim() : '' });
    });
    setTimeout(() => { try { child.kill(); } catch (_) {} finish({ ok: false, error: '打包超时（>180 秒），已中止。请把输出目录改成简单路径后重试', log: (stdout + stderr).trim() }); }, 180000);
  });
}

function isLoopback(addr) { return !!addr && /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/.test(addr); }

/* ── 打完包顺手把「这位客户落在哪档」同步到公网那台 ──────────
   只改那台机器上的账，不动包；没成也只说一句，不出错包。 */
async function syncTier(payload) {
  const tier = TIER_OF[payload.type];
  if (!tier) return { skip: true, note: '自用版不用同步——公网那台不认识这一档' };
  if (!payload.phone) return { skip: true, note: '没填这位客户的手机号，所以没同步——记得去「发放管理 → 执行器发放」把他的档位对上' };
  const base = /^https?:\/\//.test(payload.srv) ? payload.srv : 'http://' + payload.srv;
  const url = base.replace(/\/?$/, '/') + 'api/admin/set-tier';
  const pass = adminPass();
  const headers = { 'Content-Type': 'application/json' };
  if (pass) headers['x-admin-pass'] = pass;
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ phone: payload.phone, tier }) });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) return { ok: false, note: '公网那台没改上：' + ((j && j.error) || ('HTTP ' + r.status)) + '——包照旧能用，档位去名单页手动对' };
    const name = (j.account && j.account.name) || payload.phone;
    return { ok: true, tier, note: '公网那台已把「' + name + '」开成「' + tier + '」' + (j.pairCode ? '，配对号 ' + j.pairCode + '（他到网页自己账号那行能看到）' : '') };
  } catch (e) {
    return { ok: false, note: '公网那台没连上（' + e.message + '）——包照旧能用，档位去名单页手动对' };
  }
}

/* ── HTTP 请求处理 ────────────────────────────────────────── */
function requestHandler(req, res) {
  const addr = req.socket.remoteAddress || '';
  if (!isLoopback(addr) && !isLoopback('::ffff:127.0.0.1')) { res.writeHead(403); res.end('forbidden'); return; }
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    guiLog('网页被访问（说明浏览器连到了本服务）');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cors });
    res.end(PAGE); return;
  }

  if (req.method === 'POST' && (req.url === '/' || req.url === '/pack' || req.url === '/index.html')) {
    guiLog('收到打包表单提交');
    /* 分片先攒成 Buffer，最后一次转文字：边到边拼字符串会把拆在两片中间的中文字咬坏 */
    const chunks = [];
    let bytes = 0;
    req.on('data', (c) => { bytes += c.length; if (bytes > 1e6) { req.destroy(); return; } chunks.push(c); });
    req.on('error', () => {});
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        const params = new URLSearchParams(body || '');
        const payload = {
          type: String(params.get('type') || 'test'),
          licensee: String(params.get('licensee') || '').trim(),
          phone: String(params.get('phone') || '').replace(/\D/g, ''),
          srv: String(params.get('srv') || 'http://127.0.0.1:8799/').trim(),
          days: parseInt(params.get('days'), 10) || 7,
          out: String(params.get('out') || 'dist').trim() || 'dist',
        };
        const r = await runPack(payload);
        if (r.ok) {
          r.sync = await syncTier(payload);
          guiLog('同步公网那台：' + r.sync.note);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cors });
        res.end(renderResult(r, r.elapsedMs));
      } catch (e) {
        guiLog('处理请求异常：' + (e && e.stack || e));
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderResult({ ok: false, error: '服务内部错误：' + (e && e.message || e), log: '', zip: '' }, 0));
      }
    });
    return;
  }
  res.writeHead(404); res.end('Not Found');
}

/* ── 自动找空闲端口（顺序尝试，每个端口用全新的 server，避免旧页/重复监听） ── */
function startOnFreePort(base, maxTries) {
  let i = 0;
  function attempt() {
    const port = base + i;
    const server = http.createServer(requestHandler);
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && i < maxTries) { i++; attempt(); }
      else { console.error('服务启动失败：', e.message); process.exit(1); }
    });
    server.listen(port, '0.0.0.0', () => {
      const url = `http://127.0.0.1:${port}`;
      guiLog('服务已启动，地址 ' + url);
      console.log('小红书运营工具 · 网页版打包界面已启动');
      console.log('地址：' + url);
      console.log('   如果浏览器没有自动打开，请手动复制上面地址粘贴到浏览器访问。');
      console.log('日志：' + GUILOG + '（每次打开页面、点打包都会写进来，出错就发这个文件）');
      console.log('（保持本窗口开启；关闭本窗口即退出程序。）');
      try { const { exec } = require('child_process'); exec(`start "" "${url}"`, () => {}); } catch (_) {}
    });
  }
  attempt();
}
startOnFreePort(PORT0, 15);