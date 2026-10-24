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

/* 抖音网页权限只能在面板点击（用户手势）里去要，后台线程里弹不出来 */
function askDyPerm() {
  try {
    const r = chrome.permissions.request({ origins: ['https://www.douyin.com/*'] });
    return r && r.then ? r.catch(() => false) : Promise.resolve(false);
  } catch (_) { return Promise.resolve(false); }
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* 一格号：绑的是哪个 · 最近一次认号结果（对不上/没登录时给「认一下」） */
function paintBind(platform, bind, st) {
  const el = platform === 'xhs' ? $('kvXhs') : $('kvDy');
  const label = platform === 'xhs' ? '小红书' : '抖音';
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
    tail = ` <span class="who">没读出来</span>${link}`;
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
    $('kvTier').textContent = st.tier || '—';
    $('kvAct').textContent = (s.activity && s.activity.text) || '待命';
    paintBind('xhs', (s.bindings || {}).xhs, (s.bindState || {}).xhs);
    paintBind('douyin', (s.bindings || {}).douyin, (s.bindState || {}).douyin);

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
  say('挂线中…（挂上会各认一次小红书号、抖音号）');
  const r = await send('ex.pair', { server: $('server').value.trim(), code: $('code').value.trim(), label: '' }, 150000);
  if (r && r.ok) { say('挂线成功（' + (r.tier || '') + '档）', 'ok'); render(); }
  else say((r && r.error) || (r && r.msg) || '挂线失败', 'err');
}

async function bindPlatform(platform) {
  const label = platform === 'xhs' ? '小红书' : '抖音';
  if (platform === 'douyin') await askDyPerm();
  say(platform === 'xhs'
    ? '认号中：读一遍小红书…（没登录会留扫码页等你，最多 10 分钟）'
    : '认号中：读一遍' + label + '…');
  /* 小红书没登录会等扫码（10 分钟）＋扫完读主页 30 秒；等不够就报超时，后台还在等 */
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

/* 自动挂线（验收/演示用）：panel.html?auto=<服务器>,<配对号> */
(async () => {
  $('ver').textContent = '执行器 ' + chrome.runtime.getManifest().version;
  const auto = new URLSearchParams(location.search).get('auto');
  if (auto) {
    const [server, code] = auto.split(',');
    if (server) $('server').value = server;
    if (code) $('code').value = code;
    await pair();
  }
  render();
  setInterval(render, 1500);
})();
