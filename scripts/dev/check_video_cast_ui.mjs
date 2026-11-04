// 视频出镜人 · 真页面跑一遍（headless Edge，另开独立 profile，不碰老板桌面浏览器）
// 验：分镜页顶上那条在 / 每段带【谁出场】/ ＋ 加人后本段多一个配角、别段不动 / 换下拉整片跟着换
// 跑法：node tmp/check_video_cast_ui.mjs
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const PROFILE = 'D:/AIproject/小红书运营/tmp/edge-prof-vcast';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const p = new Map();
const send = (m, q = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: q })); return new Promise((res, rej) => { p.set(i, { res, rej }); setTimeout(() => { if (p.has(i)) { p.delete(i); rej(new Error('超时 ' + m)); } }, 60000); }); };
const ev = async (code) => { const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true, timeout: 50000 }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '')); return r.result.value; };
const list = async () => { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) return await r.json(); } catch (_) {} await sleep(250); } throw new Error('CDP 没起来'); };

const ERR = [];
const ok = (name, cond, extra) => { if (!cond) ERR.push(name + (extra ? '：' + extra : '')); };

try {
  const tabs = await list();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('连不上 CDP')); });
  const pageErr = [];
  const net = { pending: new Map(), failed: [] };
  ws.onmessage = m => {
    const x = JSON.parse(m.data);
    if (x.id && p.has(x.id)) { const { res, rej } = p.get(x.id); p.delete(x.id); x.error ? rej(new Error(x.error.message)) : res(x.result); return; }
    if (x.method === 'Fetch.requestPaused') {
      // 假演示号：进门 / 存储 / 动作 全挡在本机，别让它读到真库、也别被带去登录页（不往本机库里灌测试号）
      const u = x.params.request.url;
      let obj;
      if (u.indexOf('/api/auth/me') >= 0) obj = { ok: true, account: { id: 'selftest', kind: 'demo', name: '自检' } };
      else if (u.indexOf('/api/storage/') >= 0) obj = { ok: true, items: {} };
      else obj = { ok: true, result: {} };
      const body = Buffer.from(JSON.stringify(obj)).toString('base64');
      send('Fetch.fulfillRequest', { requestId: x.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body })
        .catch(e => console.log('回失败：' + e.message));
      return;
    }
    if (x.method === 'Network.requestWillBeSent') net.pending.set(x.params.requestId, x.params.request.url);
    if (x.method === 'Network.responseReceived' && x.params.response.status >= 400) {
      net.failed.push(x.params.response.status + ' ' + x.params.response.url);
    }
    if (x.method === 'Network.loadingFinished' || x.method === 'Network.loadingFailed') {
      if (x.method === 'Network.loadingFailed') net.failed.push((net.pending.get(x.params.requestId) || '?') + ' — ' + x.params.errorText);
      net.pending.delete(x.params.requestId);
    }
    if (x.method === 'Runtime.exceptionThrown') pageErr.push((x.params.exceptionDetails.exception || {}).description || x.params.exceptionDetails.text);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // 前置门读的是 sessionStorage 里 5 分钟的缓存：先塞一份「演示号」结果，进门不再问服务器、也不会被踢去登录页
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    "try{sessionStorage.setItem('xhs_gate_c',JSON.stringify({t:Date.now(),err:false,me:{id:'selftest',kind:'demo',name:'自检'},isDemo:false,isDemoAccount:true,isOld:true}));}catch(e){}" });
  await send('Fetch.enable', { patterns: [
    { urlPattern: '*api/auth/me*', requestStage: 'Request' },
    { urlPattern: '*api/storage/*', requestStage: 'Request' },
    { urlPattern: '*api/action*', requestStage: 'Request' },
  ] });
  await send('Page.navigate', { url: 'http://127.0.0.1:8799/popup.html' });
  // 首屏是一串脚本排队下：慢的时候要十几秒到半分钟，等 npDvStepHtml 真上线
  let ready = false, lastDiag = '';
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try {
      lastDiag = await ev("JSON.stringify({ rs: document.readyState, u: location.href, n: document.scripts.length, b: ((document.body && document.body.innerText) || '').slice(0,40) })");
      if (await ev("typeof npDvStepHtml === 'function'") === true) { ready = true; break; }
    } catch (_) {}
  }
  console.log('等首屏：' + (ready ? '已装载' : '超时 ' + lastDiag));
  if (!ready) console.log('标签页：' + JSON.stringify((await list()).map(t => ({ t: t.type, u: t.url }))));
  if (!ready) console.log('卡住的请求：' + JSON.stringify([...net.pending.values()].slice(0, 12)) + '\n失败：' + JSON.stringify(net.failed.slice(0, 8)));
  // 装载后再压一秒：门或分页还有可能把人转走，稳住了才算数
  if (ready) {
    await sleep(1500);
    const still = await ev("typeof npDvStepHtml === 'function' && location.pathname.indexOf('popup.html') >= 0");
    if (still !== true) { ready = false; console.log('装载后被转走：' + await ev('location.href')); }
  }

  const boot = await ev(`JSON.stringify({ title: document.title, url: location.pathname, hasStep: typeof npDvStepHtml, hasChars: typeof _npChars, body: ((document.body && document.body.innerText) || '').slice(0,80) })`);
  console.log('开页：' + boot);
  const b = JSON.parse(boot);
  ok('页面加载', b.hasStep === 'function', '没找到 npDvStepHtml（可能没登录 / 落到起始页：' + b.url + '）');

  // 造一份最真实的分镜状态：两段、底稿里还留着旧的那行【谁出场】（老片）
  const out = await ev(`(() => {
    _npChars = { mainId: 'c1', list: [
      { id: 'c1', name: '老王', role: '装修工长', age: '38 岁', hair: '短寸', body: '微胖', cloth: '深蓝工装', hammers: ['左手腕的旧手表'], portraits: [{ id: 'p1', url: '/api/blob/p1' }] },
      { id: 'c2', name: '小林', role: '业主', age: '30 岁', hair: '齐肩发', body: '偏瘦', cloth: '米色针织衫', hammers: [], portraits: [] },
    ] };
    _npWiz = { dgen: { segs: [
      { role: '开场', text: '门一量，才知道之前的钱白花了。', prompt: '【谁出场】阿强——旧的那行\\n中景，他蹲在门口量门框。', t0: 0, t1: 5, secs: 5, si: 0 },
      { role: '展开', text: '尺寸不对，装上去全是麻烦。', prompt: '近景，他拿卷尺比划宽度。', t0: 5, t1: 12, secs: 7, si: 1 },
    ], shots: [{ role: '开场', t0: 0, t1: 5, secs: 5, us: [0] }, { role: '展开', t0: 5, t1: 12, secs: 7, us: [1] }], voice: '', charId: '', total: 12 } , shots: { charId: '' } };
    const html = npDvStepHtml(_npWiz);
    const pick = (re) => (html.match(re) || [])[0] || '';
    return JSON.stringify({
      bar: html.includes('🎭 这条片出镜'),
      sel: html.includes('<select id="npDvCharSel"'),
      opt: (html.match(/<option value="c[12]"[^>]*>[^<]*<\\/option>/g) || []),
      portrait: html.includes('定妆照会一起发'),
      dl: html.includes('np-dv-dlportrait'),
      eachCast: (html.match(/出镜：[^<]*/g) || []),
      castLine: (html.match(/【谁出场】[^<]*/g) || []),
      oldGone: !html.includes('阿强'),
      plus: (html.match(/np-dv-plus/g) || []).length,
      chips: (html.match(/np-dv-castchip/g) || []).length,
      bodyKeep: html.includes('中景，他蹲在门口量门框。'),
    });
  })()`);
  const d = JSON.parse(out);
  ok('顶上·这条片出镜', d.bar);
  ok('顶上·下拉', d.sel, '没有 #npDvCharSel');
  ok('顶上·下拉两选项（主角标出）', d.opt.length === 2 && /老王（主角）/.test(d.opt.join('')), JSON.stringify(d.opt));
  ok('顶上·定妆照状态', d.portrait);
  ok('顶上·下载钮', d.dl);
  ok('每段·标出镜', d.eachCast.length === 2 && d.eachCast[0].includes('老王'), JSON.stringify(d.eachCast));
  ok('每段·带谁出场', d.castLine.length === 2 && d.castLine[0].includes('老王，装修工长'), JSON.stringify(d.castLine));
  ok('每段·旧行剥掉', d.oldGone);
  ok('每段·底稿留着', d.bodyKeep);
  ok('每段·加人钮', d.plus === 2, '实际 ' + d.plus);
  ok('每段·人胶囊', d.chips === 4, '实际 ' + d.chips);   // 两段 × 两个人

  // 点第 1 段的「小林」：只第 1 段多一个配角
  const add = await ev(`(() => {
    npWizRender = () => {};
    npArchiveTouch = () => {};
    npDvCastToggle(0, 'c2', null);
    const g = _npWiz.dgen;
    return JSON.stringify({
      seg0: (npDvCastOf(_npWiz, g.segs[0]) || []).map(c => c.id),
      seg1: (npDvCastOf(_npWiz, g.segs[1]) || []).map(c => c.id),
      text0: npDvPromptText(_npWiz, g.segs[0]),
      text1: npDvPromptText(_npWiz, g.segs[1]),
      stored0: g.segs[0].prompt,
    });
  })()`);
  const a = JSON.parse(add);
  ok('加人·第 1 段两人', JSON.stringify(a.seg0) === '["c1","c2"]', JSON.stringify(a.seg0));
  ok('加人·第 2 段照旧一人', JSON.stringify(a.seg1) === '["c1"]', JSON.stringify(a.seg1));
  ok('加人·提示词写配角', a.text0.includes('配角小林，业主，30 岁') && a.text0.includes('大小主次分得清'));
  ok('加人·别段不受影响', !a.text1.includes('小林'));
  ok('加人·落库只存底稿', a.stored0 === '【谁出场】阿强——旧的那行\n中景，他蹲在门口量门框。', JSON.stringify(a.stored0));

  // 换整片的人：下拉改成小林 → 每段都换成小林，配角也清掉
  const sw = await ev(`(() => {
    _npMode = 'wiz'; _npOut = null;   // npS() 读的是这个：别让它指到上面那份演示稿
    ensureNpDelegation();             // 真页面上要等发笔记那页打开才挂上；这里先挂，模拟「已经开着」
    window.__sw = [];
    document.addEventListener('change', (e) => window.__sw.push((e.target && e.target.id) || '?'));
    const el = document.createElement('select'); el.id = 'npDvCharSel';
    el.innerHTML = '<option value="c1">老王</option><option value="c2">小林</option>';
    el.value = 'c2';
    document.body.appendChild(el);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.remove();
    const g = _npWiz.dgen;
    return JSON.stringify({
      mode: _npMode, same: npS() === _npWiz, fired: window.__sw, val: el.value,
      charId: g.charId,
      seg0: npDvPromptText(_npWiz, g.segs[0]),
      seg1: npDvPromptText(_npWiz, g.segs[1]),
    });
  })()`);
  const s2 = JSON.parse(sw);
  ok('换人·存住 dgen.charId', s2.charId === 'c2', JSON.stringify(s2.charId));
  ok('换人·第 1 段换成小林', s2.seg0.includes('【谁出场】小林，业主') && !s2.seg0.includes('老王'));
  ok('换人·第 2 段也换', s2.seg1.includes('【谁出场】小林，业主') && !s2.seg1.includes('老王'));

  ok('页面无脚本错误', pageErr.length === 0, pageErr.join(' | ').slice(0, 300));
} catch (e) {
  ERR.push('跑挂了：' + e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { edge.kill(); } catch (_) {}
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
}

if (ERR.length) {
  console.log('FAIL（' + ERR.length + ' 条）：');
  ERR.forEach(e => console.log('  ✗ ' + e));
  process.exit(1);
}
console.log('PASS：真页面上顶上那条 / 每段【谁出场】/ 按段加配角 / 换整片的人 都照预期走，页面无报错');
console.log('ALL PASS');
