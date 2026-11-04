/* 执行器 · 面板：只做三件事——挂线/退出、看状态、停这一趟。
   走独立端口：内核会抢答 runtime 消息，端口这条不会被截胡。 */
const $ = (id) => document.getElementById(id);
let panelPort = null;
function ensurePort() {
  if (panelPort) return panelPort;
  panelPort = chrome.runtime.connect({ name: 'ex-panel' });
  panelPort.onDisconnect.addListener(() => { panelPort = null; });
  return panelPort;
}
function send(type, extra, timeoutMs) {
  return new Promise((resolve) => {
    let p;
    try { p = ensurePort(); } catch (e) { resolve({ error: '面板通道打不开：' + ((e && e.message) || e) }); return; }
    const reqId = Math.random().toString(16).slice(2);
    const onMsg = (m) => {
      if (!m || m.reqId !== reqId) return;
      try { p.onMessage.removeListener(onMsg); } catch (_) {}
      clearTimeout(timer);
      resolve(m.data);
    };
    const timer = setTimeout(() => {
      try { p.onMessage.removeListener(onMsg); } catch (_) {}
      resolve({ error: '面板通道超时' });
    }, timeoutMs || 60000);
    p.onMessage.addListener(onMsg);
    try { p.postMessage({ type, reqId, ...(extra || {}) }); }
    catch (e) { clearTimeout(timer); resolve({ error: (e && e.message) || '发不出去' }); }
  });
}

/* 心跳 15 秒一次、长轮询最多挂 25 秒——超过 35 秒没通上话就是真连不上了 */
const LINK_STALE_MS = 35000;
let msgTimer = null;
let staleMsg = false;
let alertKey = '';
let rendering = false;

function say(text, cls) {
  clearTimeout(msgTimer);
  $('msg').textContent = text || '';
  $('msg').className = 'msg ' + (cls || '');
  if (text) msgTimer = setTimeout(() => { $('msg').textContent = ''; $('msg').className = 'msg'; }, cls === 'err' ? 12000 : 8000);
}
function saySticky(text, cls) {
  clearTimeout(msgTimer);
  $('msg').textContent = text || '';
  $('msg').className = 'msg ' + (cls || '');
}
function clearMsg() {
  clearTimeout(msgTimer);
  $('msg').textContent = '';
  $('msg').className = 'msg';
}

/* 抖音 / 视频号网页权限只能在面板点击（用户手势）里去要，后台线程里弹不出来 */
function askDyPerm() {
  try {
    const r = chrome.permissions.request({ origins: ['https://www.douyin.com/*'] });
    return r && r.then ? r.catch(() => false) : Promise.resolve(false);
  } catch (_) { return Promise.resolve(false); }
}
function askChPerm() {
  try {
    const r = chrome.permissions.request({ origins: ['https://channels.weixin.qq.com/*'] });
    return r && r.then ? r.catch(() => false) : Promise.resolve(false);
  } catch (_) { return Promise.resolve(false); }
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* 一格号：绑的是哪个 · 最近一次认号结果（对不上/没登录时给「认一下」） */
const BIND_EL = { xhs: 'kvXhs', douyin: 'kvDy', channels: 'kvCh' };
const BIND_LABEL = { xhs: '小红书', douyin: '抖音', channels: '视频号' };
function paintBind(platform, bind, st) {
  const el = $(BIND_EL[platform]);
  if (!el) return;
  const label = BIND_LABEL[platform] || platform;
  const link = `<button type="button" class="lk" data-bind="${platform}">认一下</button>`;
  const b = bind || null;
  const s = st || null;
  if (!b || (!b.displayId && !b.uid)) {
    el.className = 'warn';
    el.innerHTML = `还没绑${label}号${link}`;
    return;
  }
  const id = esc(b.displayId || b.uid);
  const name = b.name ? ` <span class="who">（${esc(b.name)}）</span>` : '';
  let cls = 'ok';
  let tail = '';
  if (s && s.status === 'mismatch') {
    cls = 'bad';
    const saw = esc((s.saw && (s.saw.displayId || s.saw.uid)) || '另一个号');
    tail = ` <span class="who">对不上：现在登的是 ${saw}</span>${link}`;
  } else if (s && s.status === 'loggedout') {
    cls = 'bad';
    tail = ` <span class="who">没登录</span>${link}`;
  } else if (s && s.status === 'noperm') {
    cls = 'warn';
    tail = ` <span class="who">没给网页权限</span>${link}`;
  } else if (s && s.status === 'unknown') {
    cls = 'warn';
    const manual = platform === 'channels'
      ? '先打开视频号后台、微信扫码登录好，再点一次'
      : `先打开你自己${label}的「我的」主页，再点一次`;
    tail = s.needManual
      ? ` <span class="who">${manual}</span>${link}`
      : ` <span class="who">没读出来</span>${link}`;
  } else if (s && s.status === 'unbound') {
    cls = 'warn';
    tail = `${link}`;
  }
  el.className = cls;
  el.innerHTML = id + name + tail;
}

async function render() {  if (rendering) return;
  rendering = true;
  try {
    const s = await send('ex.snapshot');
    if (!s || s.error) {
      /* 一时读不到就保持原样，别翻回「还没挂线」吓人 */
      if (!staleMsg) { staleMsg = true; saySticky('一时读不到执行器状态，正在重试…', 'warn'); }
      return;
    }
    if (staleMsg) { staleMsg = false; clearMsg(); }

    const st = s.state || { status: 'unpaired' };
    const cred = s.cred;
    const unpaired = !cred || st.status === 'unpaired';
    $('viewUnpaired').style.display = unpaired ? '' : 'none';
    $('viewPaired').style.display = unpaired ? 'none' : '';
    if (unpaired) {
      const reason = String(st.reason || '').trim();
      const show = !!reason && reason !== '还没挂线' && reason !== '已退出挂线';
      $('unpairedWhy').style.display = show ? '' : 'none';
      $('unpairedWhy').textContent = show ? reason : '';
      return;
    }

    $('kvAccount').textContent = (cred.account && cred.account.name) || '—';
    $('kvTier').textContent = st.tierLabel || st.tier || '—';
    $('kvAct').textContent = (s.activity && s.activity.text) || '待命';
    const cfgAt = Number(s.cfg && s.cfg.at) || 0;
    $('kvCfg').textContent = cfgAt
      ? ('已从公网刷新 · ' + new Date(cfgAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      : '还没刷新（第一次动作前会刷）';
    $('kvCfg').className = cfgAt ? 'ok' : '';
    paintBind('xhs', (s.bindings || {}).xhs, (s.bindState || {}).xhs);
    paintBind('douyin', (s.bindings || {}).douyin, (s.bindState || {}).douyin);
    paintBind('channels', (s.bindings || {}).channels, (s.bindState || {}).channels);

    const loginWait = !!st.loginWait;
    const loginKind = String(st.loginKind || 'job');
    const okAt = Number(s.link && s.link.okAt) || 0;
    const stale = !okAt || Date.now() - okAt > LINK_STALE_MS;

    let icon = '🟢', line = '在线待命', cls = '';
    if (st.status === 'killed') { icon = '🔴'; line = '已被服务器熔断 —— 全部停着'; cls = 'bad'; }
    else if (loginWait) {
      icon = '🟡';
      line = loginKind === 'auto' ? '停手等登录 —— 扫码后自动接着干这一单'
        : loginKind === 'bind' ? '停手等登录 —— 扫码后自动认号'
        : '停手等登录 —— 扫码登录后重新点开始';
      cls = 'warn';
    }
    else if (stale) { icon = '🟡'; line = okAt ? '连不上服务器，正在重试…' : '正在连服务器…'; cls = 'warn'; }

    const key = cls === 'bad' ? 'bad' : (loginWait ? 'login' : (stale ? 'stale' : ''));
    if (key && key !== alertKey) clearMsg();
    alertKey = key;

    $('stateIcon').textContent = icon;
    $('stateLine').textContent = line;
    $('stateLine').className = 'state-t' + (cls ? ' ' + cls : '');
  } finally {
    rendering = false;
  }
}

async function pair() {
  askDyPerm();
  say('挂线中…（挂上会各认一次号：小红书、抖音；视频号授权过才顺手认）');
  const r = await send('ex.pair', { server: $('server').value.trim(), code: $('code').value.trim(), label: '' }, 150000);
  if (r && r.ok) { say('挂线成功（' + (r.tier || '') + '档）', 'ok'); render(); }
  else say((r && r.error) || (r && r.msg) || '挂线失败', 'err');
}

async function bindPlatform(platform) {
  const label = BIND_LABEL[platform] || platform;
  if (platform === 'douyin') await askDyPerm();
  if (platform === 'channels') {
    const ok = await askChPerm();
    if (!ok) { say('没允许——认视频号要打开视频号后台看一眼，点「允许」再试', 'err'); return; }
  }
  say(platform === 'xhs'
    ? '认号中：读一遍小红书…（没登录会留扫码页等你，最多 10 分钟）'
    : (platform === 'channels'
      ? '认号中：读一遍视频号…（没登录会把视频号后台留着，扫完码再点一次）'
      : '认号中：读一遍' + label + '…'));
  /* 小红书没登录会等扫码（10 分钟）＋扫完读主页 30 秒；视频号留页等人扫码；等不够就报超时 */
  const wait = platform === 'xhs' ? 660000 : 90000;
  const r = await send('ex.bind', { platform }, wait);
  if (r && r.ok) say('✓ 已认上' + label + '号', 'ok');
  else say((r && r.error) || ('没认上' + label + '号'), 'err');
  render();
}

$('btnPair').onclick = pair;
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest ? e.target.closest('[data-bind]') : null;
  if (!t) return;
  bindPlatform(t.getAttribute('data-bind'));
});
$('btnLogout').onclick = async () => {
  if (!window.confirm('退出挂线？\n退出后这只手当场停下，规则也会清掉；要干活得重新填配对号挂上。')) return;
  await send('ex.logout');
  say('已退出挂线');
  render();
};
$('btnStop').onclick = async () => { await send('ex.stop'); say('已叫停这一趟', 'ok'); render(); };

/* ── 📦 本机素材仓（2026-10-26 老板口径）──
   发过 / 要发的东西在这台电脑上留一份原件；同一篇再发直接拿来用，不走网络。
   这里能看清单、把原件导到电脑的「下载」里、不要了删掉。
   面板页和执行器是同一个来源，直接读同一块存储，不用麻烦后台。 */
const LIB_KEY = 'ex.lib';
const LIB_DB = 'xhsCase', LIB_STORE = 'case';
function libDb() {
  return new Promise((resolve, reject) => {
    let rq;
    try { rq = indexedDB.open(LIB_DB, 1); } catch (e) { reject(e); return; }
    rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(LIB_STORE)) db.createObjectStore(LIB_STORE, { keyPath: 'key' }); };
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => resolve(rq.result);
  });
}
async function libGetBlob(key) {
  const db = await libDb();
  try {
    return await new Promise((res) => {
      const g = db.transaction(LIB_STORE, 'readonly').objectStore(LIB_STORE).get(String(key));
      g.onsuccess = () => res((g.result && g.result.blob) || null);
      g.onerror = () => res(null);
    });
  } finally { try { db.close(); } catch (_) {} }
}
async function libDel(noteId) {
  const all = (await chrome.storage.local.get(LIB_KEY))[LIB_KEY] || {};
  const ent = all[noteId];
  if (!ent) return;
  try {
    const db = await libDb();
    await new Promise((res) => {
      const tx = db.transaction(LIB_STORE, 'readwrite');
      const st = tx.objectStore(LIB_STORE);
      (ent.files || []).forEach((f, i) => st.delete(f.key || ('pub:' + noteId + ':' + i)));
      tx.oncomplete = () => { try { db.close(); } catch (_) {} res(); };
      tx.onerror = () => { try { db.close(); } catch (_) {} res(); };
    });
  } catch (_) {}
  delete all[noteId];
  await chrome.storage.local.set({ [LIB_KEY]: all });
  say('删掉了这一篇的本机素材', 'ok');
  renderLib();
}
function libSaveFile(blob, name) {
  try {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name || '素材';
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { a.remove(); URL.revokeObjectURL(u); } catch (_) {} }, 4000);
  } catch (_) {}
}
const libMB = (n) => (Math.max(0, Number(n) || 0) / 1048576).toFixed(1);
function libWhen(t) {
  const d = new Date(Number(t) || 0);
  if (!Number(t)) return '';
  const p = (x) => String(x).padStart(2, '0');
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
let libOpen = false;
async function renderLib() {
  const card = $('viewLib');
  if (!card) return;
  let all = {};
  try { all = (await chrome.storage.local.get(LIB_KEY))[LIB_KEY] || {}; } catch (_) {}
  const ids = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  if (!ids.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  const bytes = ids.reduce((n, id) => n + (all[id].files || []).reduce((m, f) => m + (Number(f.size) || 0), 0), 0);
  $('libSum').textContent = ids.length + ' 篇 · ' + libMB(bytes) + 'MB';
  $('btnLib').textContent = libOpen ? '收起清单' : ('看清单（' + ids.length + ' 篇）');
  const list = $('libList');
  list.style.display = libOpen ? '' : 'none';
  if (!libOpen) { list.innerHTML = ''; return; }
  list.innerHTML = ids.map((id) => {
    const ent = all[id] || {};
    const fs = ent.files || [];
    const sz = fs.reduce((m, f) => m + (Number(f.size) || 0), 0);
    const nm = String((fs[0] && fs[0].name) || '素材');
    return '<div class="librow" data-id="' + esc(id) + '">' +
      '<div class="nm">' + esc(nm) + '<i>' + fs.length + ' 件 · ' + libMB(sz) + 'MB · ' + libWhen(ent.at) + ' 放进来的</i></div>' +
      '<button type="button" data-lib-exp="' + esc(id) + '">💾 导出</button>' +
      '<button type="button" data-lib-del="' + esc(id) + '">🗑</button>' +
      '</div>';
  }).join('');
}
$('btnLib').onclick = () => { libOpen = !libOpen; renderLib(); };
document.addEventListener('click', async (e) => {
  const t = e.target && e.target.closest ? e.target.closest('[data-lib-exp],[data-lib-del]') : null;
  if (!t) return;
  const expId = t.getAttribute('data-lib-exp');
  const delId = t.getAttribute('data-lib-del');
  if (expId) {
    const all = (await chrome.storage.local.get(LIB_KEY))[LIB_KEY] || {};
    const ent = all[expId];
    if (!ent) { say('这篇不在仓里了', 'err'); renderLib(); return; }
    const fs = ent.files || [];
    let n = 0;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i] || {};
      const blob = await libGetBlob(f.key || ('pub:' + expId + ':' + i));
      if (!blob) continue;
      libSaveFile(blob, f.name || ('素材' + (i + 1)));
      n++;
    }
    say(n ? ('已把 ' + n + ' 件存到电脑的「下载」里') : '原件读不出来了（可能被清过）', n ? 'ok' : 'err');
    return;
  }
  if (delId) {
    if (!window.confirm('删掉这一篇在本机的素材？\n删了下次要发同一篇，就得重新交一次文件。')) return;
    await libDel(delId);
  }
});
renderLib();
setInterval(renderLib, 5000);

/* 自动挂线（验收/演示用）：panel.html?auto=<服务器>,<配对号> */
(async () => {
  $('ver').textContent = '执行器 ' + chrome.runtime.getManifest().version;
  const auto = new URLSearchParams(location.search).get('auto');
  /* 按客户打的包里带 prefill.json：打开面板就把地址和配对号填好，客户只点「挂上」 */
  if (!auto) {
    try {
      const rr = await fetch(chrome.runtime.getURL('prefill.json'));
      if (rr.ok) {
        const p = await rr.json();
        if (p && p.server) $('server').value = p.server;
        if (p && p.code && !$('code').value) $('code').value = p.code;
      }
    } catch (_) { /* 通用包里没有这份，忽略 */ }
  }
  if (auto) {
    const [server, code] = auto.split(',');
    if (server) $('server').value = server;
    if (code) $('code').value = code;
    await pair();
  }
  render();
  /* 打开面板＝刷一次配置（首屏就把公网最新那份拉进缓存） */
  send('ex.cfg').catch(() => {}).then(() => render());
  setInterval(render, 1500);
})();
