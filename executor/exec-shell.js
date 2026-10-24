/* 执行器 · 外壳（服务器正式版 · v3）
 *
 * 这只手干三件事：
 *   ① 挂线——用配对号（XHD-XXXX）在服务器认领 → 拿到一份"挂线凭据"（handId＋token）
 *   ② 听令——长轮询挂着服务器那根线：服务器一有活，毫秒级收到；心跳每 15 秒对一次账
 *   ③ 干活——按档位放行，在本机浏览器里真跑（发笔记 / 获客；客服/日常浏览后接）
 *
 * v3（D 期）：凭据失效（换机重挂 / 网页解绑）＝当场收队——心跳对账发现"这只手不认了"时，
 *   正在跑的活也停下来（不再干完这一趟），状态转「挂线失效」，等用户重新填配对号挂线。
 *
 * 干活靠的是搬进来的扩展内核（exec-core.js）：
 *   · 服务器当大脑——写稿、按平台适配、要 AI 说的话都发生在服务器；这只手只做机械动作
 *     （开页 / 传图 / 填字 / 点发布 / 翻列表 / 打开笔记）。
 *   · 所以执行器不需要 AI Key：真发链直接调内核里的「发布动作」段 _npPubBgDeliver；
 *     获客里那些"要 AI 说话"的动作（评论生成）由下面那层「AI 出门口」把请求发回服务器出网。
 *
 * 规矩（§8.2）：包只认服务器——服务器熔断＝当场全停（重启也逃不掉）；不接服务器不干活。
 * 状态真源：chrome.storage.local['ex.state']；面板盯着它。
 * ⚠️ 整个外壳包在 IIFE 里：内核是字节复制搬来的（顶层一堆 const），撞名会让后台整体不启动。 */
(() => {

const DEFAULT_SERVER = 'http://127.0.0.1:8799';
const TIER_RANK = { '免费': 0, '基础': 1, '升级': 2, '全功能': 3 };
const KIND_NEED = { self_test: 0, note_publish: 1, batch_send: 0, film: 1, acquire: 2, daily_browse: 2, leads: 3 };
const KIND_LABEL = { self_test: '自检', note_publish: '发笔记', batch_send: '整页发送', film: '本机出片', acquire: '获客', daily_browse: '日常浏览', leads: 'AI客服' };
/* 活 → 看档位表哪一格（#11 接单后再查一次：以服务器随单带来的 edition 为准） */
const KIND_CELL = { note_publish: 'notePublish', batch_send: 'batchSend', film: 'videoFilm', acquire: 'autoWater', daily_browse: 'dailyBrowse', leads: 'prospectList' };
const CELL_LABEL = { notePublish: '发笔记', batchSend: '整页发送', videoFilm: '字效编辑器', autoWater: '获客', dailyBrowse: '日常浏览', prospectList: '线索' };

/* 这只手"会哪些活"：挂线/心跳随报；服务器遇到不会的直接提示升级，不硬派（换手 12A） */
const HAND_VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (_) { return ''; } })();
const HAND_CAPS = [
  'self_test', 'note_publish', 'batch_send', 'film', 'acquire', 'daily_browse', 'leads',
  'acquire:round', 'acquire:search', 'acquire:scan', 'acquire:backfill', 'acquire:open', 'acquire:refresh',
  'leads:watch', 'leads:dm',
  'workwin:1', 'ticket:1',
];
const WW = self.WorkWin || null;   // 干活专用窗口 + 整页锁 + 一次性通行证（exec-workwin.js）
const AC = self.AcctCheck || null;  // 平台认号（exec-acct-check.js）：挂线认一次、每开一次干活窗口各认一次

let earsOn = false;
let running = false;
let keepActivity = false;   // AI客服（监听）下完令别把状态栏抹回"待命"
let currentCmd = null;      // 正在跑的这一单（关窗时要按失败回报）
let abortNote = '';         // 干活窗口被关 / 被收队的原因
let loginAbort = false;     // 这一单撞上登录过期：停手、失败回执带 needLogin
const LOGIN_FAIL_NOTE = '小红书的登录过期了——机器人已经停手。请在干活窗口里扫码登录，登录好后重新点开始';
/* 开工前对号：没登录时留扫码页等人，扫完自动接着干这一单。
   搜索单服务器只给 20 分钟（等 10 分钟 + 干活 15 分钟会顶到时限），所以搜索只等 5 分钟。 */
const PREWAIT_JOB_MS = 10 * 60 * 1000;
const PREWAIT_SEARCH_MS = 5 * 60 * 1000;
const BIND_WAIT_MS = 10 * 60 * 1000;
function preLoginWaitMs(cmd) {
  const op = String((cmd && cmd.params && cmd.params.op) || '');
  return (cmd && cmd.kind === 'acquire' && op === 'search') ? PREWAIT_SEARCH_MS : PREWAIT_JOB_MS;
}

/* ── 排期归服务器管（v3 · 排期自动下单）：按掉内核自己的"到点"引擎 ──
 * 内核（exec-core.js，字节复制、不许改）里自带两套自排期：
 *   ① 日常浏览保底时钟（daily-browse-tick）——到点自己把机器人拉起来；
 *   ② 发布队列到点（np-pub-tick）——到点自己适配稿、自己发。
 * 网页版里它们是引擎；执行器里"到点"由服务器排（server/exec-sched.mjs 下同一批单），
 * 两套同时开着＝同一件事被两边各拉一次（双排期）。所以装载时把这两套按掉——
 * 只按"自排期"（闹钟＋重排函数），不动发布动作本体 _npPubBgDeliver（服务器下的发布单照走它）。
 * 内核的启动钩子挂在微任务里（装载时同步按掉可能赶在它前面）→ 延后 2 秒补一枪；
 * 就算漏了，闹钟响时的派发也是查全局函数名——拿到的同样是被换过的空壳，不会真跑。 */
function silenceKernelSchedulers() {
  try { chrome.alarms.clear('daily-browse-tick', () => {}); } catch (_) {}
  try { chrome.alarms.clear('np-pub-tick', () => {}); } catch (_) {}
  try { _dbEnsureTick = async () => {}; } catch (_) {}                       // 不再重挂日常浏览保底时钟
  try { _dbAutoTick = async () => ({ ok: true, off: 'executor' }); } catch (_) {}
  try { _dbAutoKick = async () => ({ ok: true, off: 'executor' }); } catch (_) {}
  try { _npPubBgRearm = async () => {}; } catch (_) {}                       // 不再重挂发布队列到点
  try { _npPubBgTick = async () => {}; } catch (_) {}
}
silenceKernelSchedulers();
setTimeout(silenceKernelSchedulers, 2000);

/* ── 存储小工具 ── */
const get = async (k) => (await chrome.storage.local.get(k))[k];
const set = (k, v) => chrome.storage.local.set({ [k]: v });
const getCred = () => get('ex.cred');
const getState = () => get('ex.state').then((s) => s || { status: 'unpaired', reason: '还没挂线' });
const setState = (s) => set('ex.state', { ...s, at: Date.now() });
const setActivity = (text) => {
  /* 顺手把这句话推到干活窗口的罩子上：客户看到的是「搜索中 1/8」，不是一直「正在准备…」 */
  try { if (WW && typeof WW.setStep === 'function') WW.setStep(text); } catch (_) {}
  return set('ex.activity', { text, at: Date.now() });
};
/* 心跳每通上一次就盖个时间戳——面板据此区分「在线」和「连不上服务器」 */
const touchLink = () => set('ex.link', { okAt: Date.now() });
/* 登录过期等扫码：状态里钉一面旗，面板才知道该把「在线待命」换成琥珀色停手提示。
   kind：job＝干到一半登录过期（扫完要回网页重点）；auto＝开工前对号（扫完自己接着干）；
         bind＝面板点「认一下」（扫完自己认号）。 */
const setLoginWait = async (v, kind) => setState({
  ...(await getState()), loginWait: !!v, loginKind: v ? String(kind || 'job') : '',
});
const setStopping = (v) => set('ex.stopping', !!v);
const isStopping = async () => !!((await get('ex.stopping')));
/* 「停这一趟」的时间戳（去重用：心跳会反复带同一个 stopAt，比自己记住的那个新才动手） */
const markStopAt = (at) => set('ex.stopAt', Number(at) || Date.now());
const stopAtSeen = async () => Number(await get('ex.stopAt')) || 0;
/* 领回来的档位表：存一份，断网/下次开机沿用（后台 lib/edition.js 开机自己捞） */
const saveGrant = (ed) => {
  if (!ed || !ed.features) return;
  set('ed.grant', { at: Date.now(), tier: ed.tier || '', label: ed.tierLabel || ed.label || '', draftOnly: !!ed.draftOnly, onTrial: !!ed.onTrial, features: ed.features });
};

/* ── 写稿/话术规则：客户包里不带，挂上线后向服务器领一份 ──
 * 真源在服务器（server/bg/lib/default-prompts.js）；执行器只拿「当前这一版」，落进
 * chrome.storage.local['prompts']，内核照旧用 Storage.getPrompt 取。服务器版本号变了
 * （心跳/派单回包里带 rulesVersion）就重领；退出挂线/凭据失效时把这批规则收回。 */
async function fetchRules(force) {
  const cred = await getCred();
  if (!cred || !cred.server) return { ok: false, reason: '还没挂线' };
  const cur = await get('ex.rulesVersion');
  let j;
  try {
    const r = await fetch(cred.server + '/api/exec/prompts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handId: cred.handId, token: cred.token }),
    });
    j = await r.json();
  } catch (e) {
    return { ok: false, reason: '连不上服务器：' + ((e && e.message) || e) };
  }
  if (!j || !j.ok || !j.prompts) return { ok: false, reason: (j && j.error) || '服务器没给到规则' };
  if (!force && j.version && j.version === cur) {
    await set('ex.rulesLatest', Date.now());
    return { ok: true, unchanged: true };
  }
  try {
    if (typeof Storage !== 'undefined' && Storage && Storage.set) await Storage.set(Storage.KEYS.PROMPTS, j.prompts);
    else await set('prompts', j.prompts);
  } catch (e) {
    return { ok: false, reason: '规则写不进本机：' + ((e && e.message) || e) };
  }
  await set('ex.rulesVersion', String(j.version || ''));
  await set('ex.rulesLatest', Date.now());
  await report(`📚 已从服务器领到写稿/话术规则（${Object.keys(j.prompts).length} 个场景）`);
  return { ok: true, version: j.version };
}

async function clearRules() {
  try {
    if (typeof Storage !== 'undefined' && Storage && Storage.KEYS && Storage.KEYS.PROMPTS) {
      await chrome.storage.local.remove(Storage.KEYS.PROMPTS);
    } else {
      await chrome.storage.local.remove('prompts');
    }
  } catch (_) { try { await chrome.storage.local.remove('prompts'); } catch (_) {} }
  await chrome.storage.local.remove(['ex.rulesVersion', 'ex.rulesLatest']);
}

/* 干活前兜一道：从没领到过规则就不硬干（AI 环节会没词）；领到过就交给心跳盯版本 */
async function ensureRules() {
  const v = await get('ex.rulesVersion');
  if (!v) {
    const r = await fetchRules(true);
    if (!r.ok) throw new Error('写稿/话术规则还没从服务器取到（' + (r.reason || '连不上') + '）——这单先不干');
    return;
  }
  const at = Number(await get('ex.rulesLatest')) || 0;
  if (Date.now() - at > 30 * 60 * 1000) await fetchRules(false);
}

async function report(text) {
  const cred = await getCred();
  if (!cred || !cred.server) return;
  try {
    await fetchT(cred.server + '/api/exec/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handId: cred.handId, token: cred.token, text }),
    }, 10000);
  } catch { /* 服务器不在/不回话就算了，别把整趟活挂死 */ }
}

/* 带超时的 fetch：网络半断、服务器接了不回时，回执和进度不能无限等 */
async function fetchT(url, opts, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch (_) {} }, ms || 10000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: ac.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/* ── AI 出门口：执行器上不落 AI Key ──
 * 内核里那些"要 AI 说话"的动作（获客评论、客服话术…）本来是直连 AI 服务商的。
 * 这只手不拿 Key——把内核的 AiClient.chatCompletion 换成"把 system/user 发回服务器，
 * 服务器拿自己的真 Key 出网、把内容原样带回来"。删掉这段，执行器一调 AI 就报"没配 Key"。 */
/* 不设本地回退：包只认服务器（AI 一律经服务器出网）。 */
if (typeof AiClient !== 'undefined' && AiClient) {
  AiClient.chatCompletion = async function (cfg, system, user) {
    const cred = await getCred();
    if (!cred || !cred.server) throw new Error('还没挂线：AI 调用要经服务器出网（先填配对号挂上）');
    let j;
    try {
      const r = await fetch(cred.server + '/api/exec/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handId: cred.handId, token: cred.token, system: String(system || ''), user: String(user || ''), maxTokens: Number((cfg && cfg.maxTokens) || 0) }),
      });
      j = await r.json();
    } catch (e) {
      throw new Error('连不上服务器（AI 出网得靠服务器）：' + ((e && e.message) || e));
    }
    if (!j || !j.ok) throw new Error((j && j.error) || '服务器 AI 出网失败');
    return { content: String(j.content || ''), usage: j.usage || {} };
  };
}

/* 执行器本机没有 AI Key（AI 一律经服务器出网），但宿主页的 startup() 把 checkConfig 的
   configured 当硬闸——不认这一条，评论就永远不扫。给配置补一个占位 Key，真出网仍走上面那道口。 */
try {
  if (typeof Storage !== 'undefined' && Storage && typeof Storage.getConfig === 'function') {
    const _getConfig = Storage.getConfig.bind(Storage);
    Storage.getConfig = async function (...a) {
      const cfg = await _getConfig(...a);
      if (cfg && cfg.ai && !cfg.ai.apiKey && !cfg.ai.fallbackApiKey) cfg.ai.apiKey = 'executor-via-server';
      return cfg;
    };
  }
} catch (_) {}

/* ── 挂线：配对号上岗（配对号在网页账号那行；服务器按码发挂线凭据） ── */
async function pair(server, code, label) {
  const srv = String(server || DEFAULT_SERVER).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(srv)) return { ok: false, msg: '服务器地址要 http:// 或 https:// 开头' };
  const cd = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,5}-[A-Z0-9]{4}$/.test(cd)) return { ok: false, msg: '配对号看着不对（应该像 XHD-4K7Q 这样，中间一个短横）' };
  let j;
  try {
    const r = await fetch(srv + '/api/exec/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cd, label: label || '', ua: navigator.userAgent, version: HAND_VERSION, caps: HAND_CAPS }),
    });
    j = await r.json();
  } catch {
    return { ok: false, msg: '连不上服务器（地址对吗？服务器开着吗？）' };
  }
  if (!j.ok) return { ok: false, msg: j.error || '挂线失败' };
  await set('ex.cred', { server: srv, handId: j.handId, token: j.token, account: j.account, serverName: j.serverName || '服务器' });
  saveGrant(j.edition);
  await setState({ status: 'active', reason: '', tier: j.tier, tierRank: j.tierRank || TIER_RANK[j.tier] || 0 });
  await touchLink();
  await setActivity('已挂线，待命');
  await fetchRules(true).catch(() => {});
  await report(`🔗 执行器已挂线（${(j.account && j.account.name) || cd}）——耳朵上线`);
  earLoop();
  /* 挂上那一刻各认一次号：小红书 + 抖音。哪个没登录/没给权限，那一格先空着，不影响另一个。
     认不上不拦挂线（客户可以先挂上、登录好再在面板点「认一下」）。 */
  let bindRes = null;
  if (AC) {
    try {
      if (AC.setBindings) await AC.setBindings(j.bindings || {});
      bindRes = await AC.bindPlatforms(['xhs', 'douyin'], { onStep: (t) => { setActivity(t); } });
      const okList = ['xhs', 'douyin'].filter((p) => bindRes[p] && bindRes[p].status === 'ok');
      const miss = ['xhs', 'douyin'].filter((p) => !bindRes[p] || bindRes[p].status !== 'ok');
      await setActivity(okList.length ? '已认号：' + okList.map((p) => (p === 'xhs' ? '小红书' : '抖音')).join('、') : '挂上了：两个平台都还没认上号');
      if (miss.length) {
        const bad = miss.map((p) => (p === 'xhs' ? '小红书' : '抖音')).join('、');
        await report(`⚠️ 这两个平台的号还没认上：${bad}——在面板点「认一下」补齐（哪个平台没登录就先登录）`);
      }
    } catch (e) {
      await report('⚠️ 认号没跑完：' + ((e && e.message) || e) + '——可以在面板点「认一下」重试');
    }
  }
  return { ok: true, tier: j.tier, bindings: bindRes };
}

async function logout() {
  await clearRules();
  await chrome.storage.local.remove(['ex.cred', 'ex.stopping', 'ex.stopAt', 'ed.grant']);
  await setActivity('已退出');
  await setState({ status: 'unpaired', reason: '已退出挂线' });
  return { ok: true };
}

/* ── 心跳对账：问服务器"还熔断着吗 / 我什么档" ── */
async function heartbeatOnce() {
  const cred = await getCred();
  if (!cred) return;
  /* 等扫码的窗口关了/等超时了：状态旗子还举着，活动文案得跟着改——别让人对着关掉的窗口找二维码。
     只管「干到一半登录过期」那种；开工前对号和面板认号自己会收尾，别把倒计时盖掉。 */
  try {
    const st0 = await getState();
    if (st0.loginWait && (st0.loginKind || 'job') === 'job' && !running
      && WW && typeof WW.isLoginWait === 'function' && !WW.isLoginWait()) {
      await setActivity('登录过期：干活窗口已经关了；重新点开始时再开窗扫码');
    }
  } catch (_) {}
  try {
    const r = await fetch(cred.server + '/api/exec/heartbeat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handId: cred.handId, token: cred.token, version: HAND_VERSION, caps: HAND_CAPS }),
    });
    const j = await r.json();
    await touchLink();
    if (!j.ok) return;
    if (j.valid === false) {
      /* D 期：凭据不认了（被换机重挂 / 网页解绑 / 账号没了）——当场收队：正在跑的活也停，
         状态转「挂线失效」；本机凭据留着（面板会转回"未挂线"那张表单，重新填配对号即可）。 */
      await setStopping(true);
      workStop();
      await chrome.storage.local.remove('ed.grant');   // 不是这位的客户机了：档位表收回，回到进门默认
      await clearRules();                              // 写稿/话术规则也一并收回
      await setState({ status: 'unpaired', reason: (j.reason || '挂线失效') + '——这台已解绑或被新机器替换' });
      return;
    }
    saveGrant(j.edition);
    /* 服务器换了规则版本 → 重新领一份（没变就不动，省流量） */
    const rv = String(j.rulesVersion || '');
    if (rv && rv !== String((await get('ex.rulesVersion')) || '')) await fetchRules(false);
    const cur = await getState();
    if (j.killed) {
      if (cur.status !== 'killed') { await setState({ status: 'killed', reason: '服务器一键熔断', tier: j.tier, tierRank: j.tierRank }); await setActivity('服务器熔断：全部停着'); await report('🔴 心跳对账：服务器在熔断中——保持锁定'); }
      return;
    }
    if (cur.status !== 'active' || cur.tier !== j.tier) {
      await setState({ status: 'active', reason: '', tier: j.tier, tierRank: j.tierRank });
      if (cur.status === 'killed') await report('🟢 心跳对账：服务器已解冻——功能恢复');
    }
    /* 「⏹ 停这一趟」的补递：执行器正忙着跑活时没挂长轮询、停令推不进去——靠心跳这一路补上。
       按时间戳去重：只有比本机记住的那个更新才动手（不然每 15 秒都会重放一次）。 */
    const stopAt = Number(j.stopAt) || 0;
    if (stopAt && stopAt > (await stopAtSeen())) {
      await markStopAt(stopAt);
      await setStopping(true);
      workStop();
      await report('⏹ 收到「停这一趟」（心跳补递的）：这一趟收队，队列进度不丢');
    }
  } catch { /* 掉线：保持现状，不闪崩 */ }
}

/* ── 耳朵：长轮询，服务器一有令就收到 ── */
async function earLoop() {
  if (earsOn) return;
  earsOn = true;
  for (;;) {
    const cred = await getCred();
    if (!cred) { earsOn = false; return; }
    let j = null;
    try {
      const r = await fetch(cred.server + '/api/exec/poll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handId: cred.handId, token: cred.token }),
      });
      j = await r.json();
    } catch {
      await new Promise((r2) => setTimeout(r2, 3000));
      continue;
    }
    /* 这里不盖「通上话」时间戳：长轮询最多挂 25 秒，回包可能来自断网前的请求，会把断线判断拖慢 */
    if (!j || j.valid === false) { await heartbeatOnce(); await new Promise((r2) => setTimeout(r2, 4000)); continue; }
    const cmd = j.cmd;
    saveGrant(j.edition || (cmd && cmd.edition));
    /* 随单/长轮询回包带了新规则版本 → 先领最新规则再干活 */
    const rv = String(j.rulesVersion || '');
    if (rv && rv !== String((await get('ex.rulesVersion')) || '')) await fetchRules(false);
    if (!cmd) continue;
    if (cmd.type === 'lock') {
      await setState({ status: 'killed', reason: cmd.reason || '服务器一键熔断' });
      await setActivity('服务器熔断：全部停着');
      workStop();
      await report('🔒 收到熔断令：本机功能当场全停');
    } else if (cmd.type === 'unlock') {
      const cred2 = await getCred();
      if (cred2) await heartbeatOnce();
      await report('🟢 收到解冻令：功能恢复');
    } else if (cmd.type === 'stop') {
      /* 同一条停令可能走两条路（跑活中＝心跳补递；空闲＝长轮询）——按时间戳去重，只认第一次 */
      const at = Number(cmd.at) || Date.now();
      if (at > (await stopAtSeen())) {
        await markStopAt(at);
        await setStopping(true);
        workStop();
        await setActivity('收到「停这一趟」，收队中…');
        await report('⏹ 收到「停这一趟」：这一趟做完当前这一步就停（队列进度不丢）');
      }
    } else if (cmd.type === 'run') {
      await runWork(cmd);
    }
  }
}

/* 这一单要不要开"干活专用窗口"（监听开关、自检不用开） */
function needsWorkWindow(cmd) {
  if (cmd.kind === 'self_test') return false;
  if (cmd.kind === 'leads') {
    const p = cmd.params || {};
    return p.op === 'dm' || !!(p.person || (Array.isArray(p.people) && p.people.length));
  }
  return ['note_publish', 'batch_send', 'film', 'acquire', 'daily_browse'].includes(cmd.kind);
}

/* 回执里带上干活窗口的账：被碰几次、切走几次、要人处理几次 */
function attachWorkStats(detail, stats) {
  if (!stats) return detail || '';
  const line = `干活窗口：被碰 ${stats.touch || 0} 次 · 切走 ${stats.focusLost || 0} 次 · 要人处理 ${stats.human || 0} 次`;
  const s = String(detail || '');
  if (!s) return line;
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && !Array.isArray(o)) { o.work = stats; return JSON.stringify(o); }
  } catch (_) {}
  return s + '\n' + line;
}

/* ── 干活：按档位放行，在本机浏览器里真跑 ── */
async function runWork(cmd) {
  const st = await getState();
  if (st.status === 'killed') { await ack(cmd.id, false, '已被服务器熔断，没跑'); return; }
  if (st.status !== 'active') { await ack(cmd.id, false, '还没挂线，没跑'); return; }
  /* 档位以"服务器随单带来的"为准（服务器一改档，下一单立即生效，不用等心跳） */
  if (cmd.tier && cmd.tier !== st.tier) await setState({ ...st, tier: cmd.tier, tierRank: cmd.tierRank });
  const effTier = cmd.tier || st.tier;
  const effRank = (typeof cmd.tierRank === 'number') ? cmd.tierRank : (TIER_RANK[effTier] || 0);
  const need = KIND_NEED[cmd.kind] || 0;
  if (effRank < need) {
    await ack(cmd.id, false, `本档（${effTier}）没开「${KIND_LABEL[cmd.kind] || cmd.kind}」`);
    return;
  }
  /* #11 动作级双查：接单后再按"随单带来的那张表"核一格（服务器那道闸被绕过 / 表刚改也不怕）。
     edition 没带来的老单退回上面的档位数字判据。 */
  const cell = KIND_CELL[cmd.kind];
  if (cell && cmd.edition && cmd.edition.features && cmd.edition.features[cell] !== true) {
    await ack(cmd.id, false, `本档（${cmd.edition.label || effTier}）没开「${CELL_LABEL[cell] || cell}」——执行器没干`);
    return;
  }
  if (cmd.kind === 'note_publish' && cmd.edition && cmd.edition.draftOnly) {
    await ack(cmd.id, false, '免费档只到写稿——这单没真发（要发先开档位）');
    return;
  }
  if (running) { await ack(cmd.id, false, '上一趟还没跑完，这条先排着'); return; }
  /* 登录过期还在等扫码：平台不让人干活，这一单不跑，按「要扫码登录」回报（自检不碰平台，照跑） */
  if (cmd.kind !== 'self_test' && WW && WW.isLoginWait && WW.isLoginWait()) {
    await ack(cmd.id, false, LOGIN_FAIL_NOTE, '', { needLogin: true });
    return;
  }
  /* 写稿/话术规则没领到就不硬干（自检不碰平台，也不需要规则） */
  if (cmd.kind !== 'self_test') {
    try { await ensureRules(); } catch (e) { await ack(cmd.id, false, (e && e.message) || '规则没准备好'); return; }
  }

  running = true;
  currentCmd = cmd;
  abortNote = '';
  loginAbort = false;
  await setLoginWait(false);
  await setStopping(false);
  const usesWin = needsWorkWindow(cmd);
  /* 每开一次干活窗口，两个平台各认一遍；同一个窗口里跑多久都不重复查（缓存按窗口 id）。
     这一单用到哪个平台就只卡哪个平台——另一个平台不对也不连坐。
     放在 beginTask 之前：认号开的页不该被干活窗口上锁、也不该算进这单的「被碰」次数。
     小红书没登录：留扫码页、把窗端到前面等人；扫完自动接着干这一单（搜索单最多等 5 分钟）。 */
  if (usesWin && WW && AC) {
    const platsNeed = (typeof AC.platformsOf === 'function') ? AC.platformsOf(cmd) : [AC.platformOf(cmd)].filter(Boolean);
    if (platsNeed.length) {
      try {
        const winId = await WW.ensureWindow({ focus: false });
        await setActivity('认号：这次要发哪几家就各认一遍…');
        const res = await AC.checkPlatforms(platsNeed, {
          winId, cacheKey: 'win:' + winId,
          waitLoginMs: preLoginWaitMs(cmd),
          shouldStop: isStopping,
          onLoginWait: (on) => setLoginWait(on, 'auto'),
          onStep: (t) => { setActivity(t); },
        });
        const bad = platsNeed.map((p) => ({ p: p, why: AC.blockReason(p, res[p]) })).filter((x) => x.why);
        const needLogin = bad.some((x) => res[x.p] && res[x.p].status === 'loggedout');
        if (bad.length === platsNeed.length) {
          throw Object.assign(new Error(bad[0].why || '认号没通过'), { needLogin });
        }
        if (bad.length) {
          /* 一家掉队不连坐（2026-10-24）：这家这次先不发、写进结果；其余平台照跑 */
          const drop = {};
          bad.forEach((x) => { drop[x.p] = x.why; });
          if (cmd.params && Array.isArray(cmd.params.platforms)) {
            cmd.params.platforms = cmd.params.platforms.filter((x) => bad.every((b) => String((x && x.platform) || x || '') !== b.p));
            if (!cmd.params.platforms.length) throw Object.assign(new Error(bad[0].why || '认号没通过'), { needLogin });
            cmd.params.platform = String((cmd.params.platforms[0] && cmd.params.platforms[0].platform) || cmd.params.platform || 'xhs');
          }
          if (cmd.params) cmd.params.platDrop = drop;
          try { await report('⚠️ ' + bad.map((x) => x.why).join('；') + '——这家这次先不发，别家照常发'); } catch (_) {}
        }
      } catch (e) {
        running = false;
        currentCmd = null;
        await setLoginWait(false);
        const why = (e && e.message) || '认号没通过';
        await ack(cmd.id, false, why, '', { needLogin: !!(e && e.needLogin) });
        return;
      }
    }
  }

  if (usesWin && WW) {
    try {
      await WW.beginTask(cmd.kind, { label: KIND_LABEL[cmd.kind] || cmd.kind, cmdId: cmd.id });
    } catch (e) {
      running = false;
      currentCmd = null;
      await ack(cmd.id, false, '干活窗口开不起来：' + ((e && e.message) || e));
      return;
    }
  }

  let ok = true;
  let noteText = '';
  let detail = '';
  try {
    detail = await execKind(cmd);
    /* 平台在干活途中弹了登录墙：这一单不算跑完，按登录过期回报 */
    if (loginAbort) throw new Error(abortNote || LOGIN_FAIL_NOTE);
    noteText = `「${KIND_LABEL[cmd.kind] || cmd.kind}」跑完`;
  } catch (e) {
    ok = false;
    /* 失败也带 detail：获客那种"跑到平台那步没成"的，干的活的日志尾巴全在 exDetail 里，
       服务器/验收要看得见机器人到底跑到哪一步（没它就只剩一句"出错了"） */
    detail = (e && e.exDetail) || '';
    if (abortNote) noteText = abortNote;
    else if (String(e && e.message) === 'STOPPED') noteText = '被"⏹ 停这一趟"中途叫停';
    else noteText = '跑的时候出错：' + (e && e.message);
  } finally {
    running = false;
    /* AI客服（监听）是长驻的：下完令它就一直活着，别把状态栏改回"待命"；
       登录过期要留着那句提示（面板上看得见），也不改回"待命" */
    if (!keepActivity && !loginAbort) await setActivity('待命');
    keepActivity = false;
  }

  if (abortNote) { ok = false; noteText = abortNote; }
  const stats = (usesWin && WW) ? WW.getStats() : null;
  /* 先收工窗/放锁，再回报：放锁是本地的、立刻能做，回报要等网络；
     网络半断时 ack/report 有超时兜底，但页面不该陪着一起锁住。 */
  if (usesWin && WW && !abortNote) {
    try { await WW.finish(ok, noteText); } catch (_) {}
    /* 干完不关窗：面板这行别写「待命」，写这扇窗还在等人 */
    try {
      const held = WW.handedOver && WW.handedOver();
      if (held) await setActivity(held.ok ? '这趟完了 · 干活窗还开着（页面交给你）' : '这趟停在半路 · 干活窗还开着（页面留给你看）');
    } catch (_) {}
  }
  await ack(cmd.id, ok, noteText, attachWorkStats(detail, stats), { needLogin: loginAbort && !ok });
  currentCmd = null;
}

/* ── 干活分流 ── */
async function execKind(cmd) {
  if (cmd.kind === 'self_test') return await runSelfTest();
  if (cmd.kind === 'note_publish') return await runNotePublish(cmd.params || {});
  if (cmd.kind === 'batch_send') return await runBatchSend(cmd.params || {});
  if (cmd.kind === 'film') return await runFilm(cmd.params || {});
  /* 获客这一门里还有几种"单步"活（服务器网页上那几颗原先没接的钮）：
     搜索 / 截流扫一轮 / 补开未打开 / 打开一篇 / 评论刷新。没带 op 的仍是跑一整轮。 */
  if (cmd.kind === 'acquire') {
    const op = String((cmd.params && cmd.params.op) || 'round');
    if (op === 'search') return await runSearch(cmd.params || {});
    if (op === 'scan') return await runDrainScan(cmd.params || {});
    if (op === 'backfill') return await runDrainBackfill(cmd.params || {});
    if (op === 'open') return await runOpenNote(cmd.params || {});
    if (op === 'refresh') return await runRefreshNote(cmd.params || {});
    return await runAcquire('acquire', cmd.params || {});
  }
  /* 日常浏览与获客走同一条路：都是"把机器人叫起来跑一轮队列"。
     区别只在服务器随单带来的快照里放什么——日常浏览的 snapshot 里带的是
     daily_browse_config ＋ 一条手插的日常项（方向），机器人照样从队首跑。 */
  if (cmd.kind === 'daily_browse') return await runAcquire(cmd.kind, cmd.params || {});
  /* AI客服（🛰 新消息监听）：这条不用宿主页——哨兵本来就住在后台（内核 exec-core.js 里），
     服务器下个开关令，这只手把内核的监听开关掰一下就行。
     带 op:'dm' 的是"网页上点发送私信"那一颗：直接调内核的发私信动作（它自己开主页/聊天页）。 */
  if (cmd.kind === 'leads') return await runLeads(cmd.params || {});
  throw new Error(`执行器还没接这条活（${cmd.kind}）`);
}

async function runSelfTest() {
  await setActivity('自检中…');
  await report('🧪 自检开始（验线用：不碰平台）');
  for (let i = 1; i <= 3; i++) {
    await new Promise((r) => setTimeout(r, 700));
    if (await isStopping()) throw new Error('STOPPED');
    await setActivity(`自检中…（${i}/3）`);
  }
  await report('🧪 自检通过：这只手听得到、跑得动、回得了话');
  return JSON.stringify({ kind: 'self_test', steps: 3, ok: true, at: new Date().toISOString() });
}

/* ═══════════ 真发笔记（A 期真链）═══════════
 * 服务器当大脑：稿子 + 按平台适配好的文案 + 素材（图/片）都随命令带下来；
 * 这只手只干机械动作——把素材摆进内核的"代发区"，再调内核的发布动作真发。
 * params：{ note:{id,form,title}, platform:'xhs', adapted:{title,body,tags}, files:[{name,mime,b64}] }
 * 真发到平台那一下由老板自测；这里把除"点发布"以外的全部环节都走真。
 * 内核里那几个全局（_npPubBgDeliver / _npPubBgCaseDb / NP_PUB_BG_*）是 exec-core.js 搬进来的，直接用。 */
const CASE_DB = 'xhsCase', CASE_STORE = 'case', FILE_PREFIX = 'pub:';

function b64ToU8(b64) {
  const bin = atob(String(b64 || ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* 把随命令带来的素材摆进内核的"代发区"：账本里记 {n}，素材本体写进 xhsCase 仓（键 pub:<id>:<i>）。 */
async function stageFiles(id, files) {
  const db = await _npPubBgCaseDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CASE_STORE, 'readwrite');
    const store = tx.objectStore(CASE_STORE);
    files.forEach((f, i) => {
      const blob = new Blob([b64ToU8(f.b64)], { type: f.mime || 'application/octet-stream' });
      try { blob.name = String(f.name || ('file' + i)); } catch (_) {}
      store.put({ key: FILE_PREFIX + id + ':' + i, blob: blob });
    });
    tx.oncomplete = () => { try { db.close(); } catch (_) {} resolve(); };
    tx.onerror = () => { try { db.close(); } catch (_) {} reject(tx.error); };
  });
  const cur = (await chrome.storage.local.get('np_pub_files')).np_pub_files || {};
  cur[id] = { n: files.length, need: files.length, at: Date.now() };
  await chrome.storage.local.set({ np_pub_files: cur });
}

async function clearStaged(id) {
  try {
    const db = await _npPubBgCaseDb();
    const n = Number(((await chrome.storage.local.get('np_pub_files')).np_pub_files || {})[id] && ((await chrome.storage.local.get('np_pub_files')).np_pub_files[id].n) || 0);
    await new Promise((resolve) => {
      const tx = db.transaction(CASE_STORE, 'readwrite');
      const store = tx.objectStore(CASE_STORE);
      for (let i = 0; i < Math.max(1, n); i++) store.delete(FILE_PREFIX + id + ':' + i);
      tx.oncomplete = () => { try { db.close(); } catch (_) {} resolve(); };
      tx.onerror = () => { try { db.close(); } catch (_) {} resolve(); };
    });
  } catch (_) {}
  try {
    const m = (await chrome.storage.local.get('np_pub_files')).np_pub_files || {};
    delete m[id];
    await chrome.storage.local.set({ np_pub_files: m });
  } catch (_) {}
}

/* 素材两种来法，取回统一成 {name,mime,b64} 交给 stageFiles：
 *   老路＝命令里直接带 b64（网页手点的单）；排期路＝只带 blobId——素材托管在服务器
 *   data/blobs/（网页交料时存进去的），这只手凭挂线凭据从 /api/exec/blob 取原件。 */
async function fetchCommandFiles(filesIn) {
  const out = [];
  for (const f of filesIn) {
    if (f && f.b64) { out.push(f); continue; }
    const blobId = String((f && f.blobId) || '').trim();
    if (!blobId) continue;
    const cred = await getCred();
    if (!cred || !cred.server) throw new Error('还没挂线——取托管素材要连服务器');
    let j = null;
    try {
      const r = await fetch(cred.server + '/api/exec/blob', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handId: cred.handId, token: cred.token, blobId }),
      });
      j = await r.json();
    } catch (e) { throw new Error('取素材连不上服务器：' + ((e && e.message) || e)); }
    if (!j || !j.ok) throw new Error((j && j.error) || '服务器没给到这个素材');
    out.push({ name: j.name || (f && f.name) || '', mime: j.mime || (f && f.mime) || '', b64: String(j.b64 || '') });
  }
  return out;
}

const NP_PLAT_NAME = { xhs: '小红书', douyin: '抖音', channels: '视频号' };
const npPlatName = (p) => NP_PLAT_NAME[p] || p;

async function runNotePublish(p) {
  const note = p.note || {};
  const id = String(note.id || '').trim();
  if (!id) throw new Error('命令里没带"发哪一篇"');

  /* 两家并行：服务器/网页下的是"这一篇要发哪几家"（platforms[]，每家带自己的适配稿）。
     老单只带一个 platform，也照单收——一个平台就是长度 1 的数组。 */
  const src = (Array.isArray(p.platforms) && p.platforms.length)
    ? p.platforms
    : [{ platform: p.platform || 'xhs', adapted: p.adapted }];
  const seen = {};
  const drop = (p.platDrop && typeof p.platDrop === 'object') ? p.platDrop : {};
  const targets = src.map((x) => ({
    platform: String((x && x.platform) || x || '').trim(),
    adapted: (x && x.adapted) || null,
  })).filter((t) => {
    if (!t.platform || seen[t.platform]) return false;
    seen[t.platform] = 1;
    return !drop[t.platform];
  });
  if (!targets.length) {
    const why = Object.keys(drop).map((k) => drop[k]).filter(Boolean)[0];
    throw new Error(why || '命令里没带要发哪一家');
  }

  const filesIn = Array.isArray(p.files) ? p.files : [];
  if (!filesIn.length) throw new Error('命令里没带素材（图/片）——发布链没料可交');
  const sched = !!(p && p.sched);   // 排期单：服务器到点自动下的（与手点同一条链，规矩稍全）
  const hold = !!(p && p.hold);     // 这档是「备好等人点」：填好停在发布按钮前，人来点
  const names = targets.map((t) => npPlatName(t.platform));

  /* 🛡 账号安全的闸（改自动化执行节奏先过闸）：排期单＝内核"到点那趟"口径——任何墙都挡
     （静默/单休/起床前/发布占线），挡了就抛，回执带墙的话，服务器记『被账号安全的闸挡住（顺延）』；
     手点单＝内核「▶ 现在就发」口径——只有单休/静默期硬挡。再逐单 decideSelf（额度/干歇，
     不拿发布缓冲拦自己——与内核到点那趟同口径）。 */
  let wall = null;
  try { wall = await AccountGuard.blockAllReason(); } catch (_) {}
  if (wall && (sched || wall.code === 'rest' || wall.code === 'quiet')) throw new Error('🛡 ' + wall.text);
  if (sched) {
    let g = null;
    try { g = await AccountGuard.decideSelf('post', targets.length); } catch (_) {}
    if (g && g.ok === false) throw new Error('🛡 ' + g.text);
  }

  await setActivity('取素材…');
  await report(`📮 收到发笔记命令（${names.join('＋')}${sched ? '·排期到点' : ''}）：${filesIn.some((f) => f && !f.b64) ? '先从服务器取素材原件…' : '先把素材摆进代发区'}`);
  const files = await fetchCommandFiles(filesIn);
  if (!files.length) throw new Error('素材取空了——服务器没给到料');

  await setActivity('摆素材…');
  await stageFiles(id, files);

  const form = String(note.form || '图文');
  const fallbackAdapt = { title: note.title || '', body: note.draft || '', tags: [] };
  if (await isStopping()) { await clearStaged(id); throw new Error('STOPPED'); }

  /* 工作台实时条：一行一家。步骤/进度每变一次打服务器（节流），网页那边轮询着就能边跑边看 */
  const rows = targets.map((t) => ({ p: t.platform, st: 'wait', step: '', pct: null }));
  const rowOf = (plat) => rows.find((r) => r.p === plat);
  const liveAt = Date.now();
  const cred0 = await getCred();
  let liveTimer = 0, liveDirty = false, liveBusy = false, liveClosed = false;
  const livePayload = () => ({
    at: liveAt, why: sched ? 'at' : 'manual', ti: 0, pi: 0,
    notes: [{ id: id, plats: rows.map((r) => ({ p: r.p, st: r.st, step: r.step || '', pct: r.pct })) }],
  });
  const pushProg = async (body) => {
    if (!cred0 || !cred0.server) return;
    try {
      await fetchT(cred0.server + '/api/exec/progress', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ handId: cred0.handId, token: cred0.token }, body)),
      }, 10000);
    } catch (_) {}
  };
  const flushLive = async () => {
    if (liveClosed) return;
    if (liveBusy) { liveDirty = true; return; }
    liveBusy = true; liveDirty = false;
    await pushProg({ live: livePayload() });
    liveBusy = false;
    if (liveDirty && !liveClosed) { liveDirty = false; setTimeout(flushLive, 260); }
  };
  const kickLive = () => {
    liveDirty = true;
    if (liveTimer) return;
    liveTimer = setTimeout(() => { liveTimer = 0; flushLive(); }, 420);
  };
  const setRow = (plat, st, step, pct) => {
    const r = rowOf(plat);
    if (!r) return;
    r.st = st;
    if (step != null) r.step = step;
    if (pct !== undefined) r.pct = pct;
    kickLive();
  };

  const results = [];
  let sentAny = false;
  try { await AccountGuard.pub.start(); } catch (_) {}
  try {
    kickLive();

    /* 两家同时干：第一家马上开，后一家随机错开 0.8~2.2 秒（别同时开两个页面，像人才像）；
       每家各开各的标签页、各走各的填字/发布，谁先成谁先算，互不拖累。 */
    const jobs = targets.map(async (t, i) => {
      const plat = t.platform;
      if (i > 0) await _npPubBgSleep(800 + Math.round(Math.random() * 1400));
      if (await isStopping()) {
        setRow(plat, 'stopped', '', null);
        results.push({ platform: plat, ok: false, stopped: true });
        return;
      }
      setRow(plat, 'doing', 'page');
      await setActivity(`发${npPlatName(plat)}：开页面`);
      let res = null;
      try {
        res = await _npPubBgDeliver(
          { id: id, form: form },
          plat,
          t.adapted || fallbackAdapt,
          {
            watch: hold, manual: true,
            onStep: (step, pct) => {
              setRow(plat, 'doing', step || 'page', pct === undefined ? null : pct);
              const t2 = step === 'feed' ? `发${npPlatName(plat)}：传素材 ${pct || 0}%`
                : step === 'fill' ? `发${npPlatName(plat)}：填字`
                : step === 'send' ? `发${npPlatName(plat)}：点发布`
                : step === 'upload' ? `发${npPlatName(plat)}：等平台转完`
                : `发${npPlatName(plat)}：开页面`;
              setActivity(t2);
            },
          },
        );
      } catch (e) {
        res = { ok: false, msg: String((e && e.message) || e) };
      }
      res = res || { ok: false, msg: '没结果' };
      const one = {
        platform: plat,
        ok: !!res.ok,
        url: res.url || '',
        pending: !!res.pending,
        needVerify: !!res.needVerify,
        needLogin: !!res.needLogin,
        needPerm: !!res.needPerm,
        msg: res.msg || '',
        tabId: res.tabId,
        windowId: res.windowId,
        at: new Date().toISOString(),
      };
      if (one.ok) {
        sentAny = true;
        setRow(plat, 'ok', '', null);
      } else if (one.pending) setRow(plat, 'pending', '', null);
      else if (one.needVerify) setRow(plat, 'verify', '', null);
      else if (one.needLogin) setRow(plat, 'login', '', null);
      else if (one.needPerm) setRow(plat, 'perm', '', null);
      else setRow(plat, 'fail', '', null);
      results.push(one);
    });
    await Promise.all(jobs);

    /* 同一篇里已经发成的家记额度；停旗只影响没轮到的，不影响已经发出去的 */
    const sentN = results.filter((r) => r.ok).length;
    if (sentN) { try { await AccountGuard.spendSelf('post', sentN); } catch (_) {} }

    const stoppedAll = results.some((r) => r.stopped);
    const allOk = targets.every((t) => results.some((r) => r.platform === t.platform && r.ok));
    const okNames = results.filter((r) => r.ok).map((r) => npPlatName(r.platform));
    const badList = results.filter((r) => !r.ok && !r.stopped);
    const keepFiles = badList.some((r) => r.pending || r.needVerify || r.needLogin || r.needPerm);

    if (allOk) {
      await clearStaged(id);
      const links = results.filter((r) => r.ok && r.url).map((r) => npPlatName(r.platform) + '：' + r.url);
      await report(`✅ 「${KIND_LABEL.note_publish}」${names.join('＋')}都发出去了${links.length ? '（' + links.join('；') + '）' : ''}`);
      return JSON.stringify({ kind: 'note_publish', ok: true, platforms: results, at: new Date().toISOString() });
    }
    if (results.every((r) => r.stopped)) await clearStaged(id);

    /* 没发齐：把每家卡在哪说清楚（页面留着的那几种，工作台「等您接手」里能点） */
    const hasPending = badList.some((r) => r.pending);
    const pieces = badList.filter((r) => !r.pending).map((r) => {
      const nm = npPlatName(r.platform);
      if (r.needLogin) return nm + '没登录·等扫码';
      if (r.needPerm) return nm + '差一次授权';
      if (r.needVerify) return nm + '要手机验证码（页面留着）';
      return nm + '没上成（' + (r.msg || '未知原因') + '）';
    });
    if (hasPending) pieces.push('剩下备好停在发布按钮前，等您点发布');
    const stoppedN = results.filter((r) => r.stopped).length;
    const allPending = results.length > 0 && !stoppedN && results.every((r) => r.pending);
    let msg = allPending
      ? '备好停在发布按钮前了'
      : ((okNames.length ? '✅ ' + okNames.join('、') + '发成了；' : '') + pieces.join('；') + (stoppedN ? '；被"⏹ 停这一趟"叫停' : ''));
    try { await report('⚠️ ' + msg); } catch (_) {}
    const err = new Error(stoppedAll && !sentAny && !badList.length ? 'STOPPED' : msg);
    err.exDetail = JSON.stringify({ kind: 'note_publish', ok: false, partial: sentAny, platforms: results, at: new Date().toISOString() });
    throw err;
  } finally {
    try { await AccountGuard.pub.end(sentAny); } catch (_) {}
    clearTimeout(liveTimer);
    liveClosed = true;
    for (let i = 0; i < 40 && liveBusy; i++) await _npPubBgSleep(25);   // 等在飞的进度落地，别让旧的盖掉"收工"
    await pushProg({
      live: null,
      run: {
        at: Date.now(), why: sched ? 'at' : 'manual',
        stopped: results.some((r) => r.stopped),
        notes: [{ id: id, plats: rows.map((r) => ({ p: r.p, st: r.st, step: r.step || '', pct: r.pct })) }],
      },
    });
  }
}

/* ═══════════ 获客一轮（B 期真链）═══════════
 * 服务器当大脑：服务器按"到点/手插"下一轮命令，命令里带这一轮要的配置快照（词池 / 筛选 / 话术 / 设置）。
 * 这只手只做机器人的事——把快照铺进本机存储，把「干活宿主页」叫起来跑一轮，收结果回执。
 * 机器人（auto-bot.js）住在宿主页 popup.html?aw=1 里（那是从扩展整份搬进来的工作台前台），
 * 碰平台的动作全在本机浏览器里跑（内核 exec-core.js 出存储/动作，宿主页负责把机器人叫起来）。
 * params：{ snapshot:{…要铺进存储的键…}, scope:'all'|'growing', pace:'once'|'interval' } */
const WORK_PORT = 'aw-round';
let workPort = null;      // 正在跑的宿主页端口（面板/熔断要喊停就走它）
let workResolve = null;   // 等这一轮结果的 resolve

/* 本机出片页（video.html?aw=1&auto=1）另走一根线：它不在宿主页里，回报不了 aw-round */
const FILM_PORT = 'film-round';
let filmPort = null;
let filmResolve = null;

try {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === WORK_PORT) {
      workPort = port;
      port.onMessage.addListener((m) => {
        if (!m) return;
        if (m.ev === 'done') {
          const r = workResolve; workResolve = null; workPort = null;
          if (r) r(m);
          try { port.disconnect(); } catch (_) {}
        }
      });
      port.onDisconnect.addListener(() => {
        if (workPort === port) workPort = null;
        /* 干活页还在跑、连接却断了＝窗口被关 / 页面崩了：当场按失败收队，别干等超时 */
        const r = workResolve;
        if (r) {
          workResolve = null;
          try { r({ ev: 'done', ok: false, error: '干活页断开了（窗口被关 / 页面崩了）' }); } catch (_) {}
        }
      });
      return;
    }
    if (port.name === FILM_PORT) {
      filmPort = port;
      port.onMessage.addListener((m) => {
        if (!m) return;
        if (m.ev === 'done') {
          const r = filmResolve; filmResolve = null; filmPort = null;
          if (r) r(m);
          try { port.disconnect(); } catch (_) {}
        }
      });
      port.onDisconnect.addListener(() => {
        if (filmPort === port) filmPort = null;
        const r = filmResolve;
        if (r) {
          filmResolve = null;
          try { r({ ev: 'done', ok: false, error: '出片页断开了（窗口被关 / 页面崩了）' }); } catch (_) {}
        }
      });
    }
  });
} catch (_) {}

function workStop() {
  try { if (workPort) workPort.postMessage({ ev: 'stop' }); } catch (_) {}
  try { if (filmPort) filmPort.postMessage({ ev: 'stop' }); } catch (_) {}
}

/* 把正在等的活当场叫醒（窗口被关时用）：runWork 拿到失败结果，照实回报，不干等超时 */
function workAbort(reason) {
  const why = String(reason || '干活窗口被关：这一单停在这一步，不记为成功');
  const r = workResolve; workResolve = null; workPort = null;
  if (r) { try { r({ ev: 'done', ok: false, error: why }); } catch (_) {} }
  const fr = filmResolve; filmResolve = null; filmPort = null;
  if (fr) { try { fr({ ev: 'done', ok: false, error: why }); } catch (_) {} }
}

if (WW) {
  WW.setReporter((text) => { report(text); });
  WW.onAbort((reason) => {
    abortNote = String(reason || '干活窗口被关：这一单停在这一步，不记为成功');
    if (currentCmd) setActivity(`「${KIND_LABEL[currentCmd.kind] || currentCmd.kind}」干活窗口被关，这一单停在这一步`);
    setStopping(true);
    workStop();
    workAbort(abortNote);
  });
  /* 登录过期：不是"窗口被关"，是平台不让人干了——停手、解锁让人扫码、这一单按失败回报。
     窗口由 WorkWin 留着（最多 10 分钟），登录好后它自己关。 */
  WW.onLogin(() => {
    loginAbort = true;
    abortNote = LOGIN_FAIL_NOTE;
    setLoginWait(true);
    if (currentCmd) setActivity('登录过期：请在干活窗口里扫码登录，登录好后重新点开始');
    setStopping(true);
    workStop();
    try { if (typeof AutoWater !== 'undefined' && AutoWater && typeof AutoWater.cancelSearch === 'function') AutoWater.cancelSearch().catch(() => {}); } catch (_) {}
    workAbort(abortNote);
  });
  WW.onLoginDone(() => {
    setLoginWait(false);
    setActivity('登录好了，可以重新点开始了');
    setStopping(false);
  });
}

/* ── 这几颗钮都是"对着一篇笔记干活"（打开 / 评论刷新 / 整页发送）──
 * 网页把当前那篇随单带来；没带就用这台机器上一次打开的（ex.lastNote）。
 * 网页那边点开笔记时也会先下一单 acquire op:'open'，本机就把这一篇记下来。 */
async function noteFromParams(p) {
  let n = (p && p.note) || null;
  const okNote = (x) => !!(x && (x.noteId || x.url || x.title));
  if (!okNote(n)) n = await get('ex.lastNote');
  if (!okNote(n)) throw new Error('命令里没带"哪一篇"——先在网页上点开一篇笔记，或从笔记列表里点进来');
  n = { noteId: String(n.noteId || ''), url: String(n.url || ''), title: String(n.title || ''), author: String(n.author || '') };
  await set('ex.lastNote', { ...n, at: Date.now() });
  return n;
}

/* 打开（或找回）这一篇的标签页：有网址就直开，只有标题就走内核「搜标题→匹配作者→点开」 */
async function ensureNoteLoaded(note) {
  const noteId = String(note.noteId || '').trim();
  const url = String(note.url || (noteId ? 'https://www.xiaohongshu.com/explore/' + noteId : '')).trim();
  if (url) {
    /* 干活期间一律开在专用窗口里（手不碰客户自己开的标签页）；开页由 WorkWin 负责 */
    let tab = null;
    try {
      tab = WW
        ? await WW.openTab(url, { focus: true })
        : await chrome.tabs.create({ url, active: true });
    } catch (e) { throw new Error('打不开这篇笔记的页面：' + (e && e.message)); }
    if (!tab || tab.id == null) throw new Error('打不开这篇笔记的页面');
    await waitTabLoadBg(tab.id, 25000);
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    await new Promise((r) => setTimeout(r, 1200));   // 评论区是懒加载的：切前台后稍等它开始渲染
    return { tabId: tab.id, noteId: noteId };
  }
  const r = await AutoWater.openNote(note);
  if (!r || r.ok !== true) throw new Error((r && r.error) || '没打开这篇笔记');
  const tab = await AutoWater._getXhsTab();
  if (!tab) throw new Error('没找到小红书标签页');
  return { tabId: tab.id, noteId: String(r.noteId || '') };
}

function waitWorkResult(timeoutMs) {
  return new Promise((resolve) => {
    workResolve = resolve;
    setTimeout(() => {
      if (workResolve === resolve) {
        workResolve = null;
        resolve({ ev: 'done', ok: false, error: `跑超时（${Math.round((timeoutMs || 0) / 60000)} 分钟没回话）` });
      }
    }, timeoutMs || 15 * 60 * 1000);
  });
}

async function runHostOnce(qs, timeoutMs) {
  /* 内部页只认一次性通行证：票随网址带过去，hand-mode 验完当场作废（换手 1A） */
  const ticket = WW ? await WW.issueTicket('workbench') : '';
  const url = chrome.runtime.getURL('popup.html?mode=big' + (ticket ? '&t=' + ticket : '') + (qs ? '&' + qs : ''));
  let tab = null;
  try {
    tab = WW
      ? await WW.openTab(url, { focus: true })
      : await chrome.tabs.create({ url, active: true });
  } catch (e) { throw new Error('打不开干活宿主页：' + (e && e.message)); }
  if (await isStopping()) { workStop(); }
  const r = await waitWorkResult(timeoutMs);
  /* 窗口由 WorkWin 统一管（干完不关窗，下一趟复用同一扇）；没有 WorkWin 的兜底才手动收页 */
  if (!WW) { try { if (tab && tab.id != null) await chrome.tabs.remove(tab.id); } catch (_) {} }
  if (!loginAbort) await setActivity('待命');
  return r;
}

/* 快照只铺"配置"；本机跑出来的"运行态"（跑到几点 kwRuns、欠账/队列）要留住——
   否则隔 N 小时的列会轮轮都被当"从没跑过"。 */
async function laySnapshot(snapIn) {
  if (!snapIn || typeof snapIn !== 'object') return;
  const snap = Object.assign({}, snapIn);
  if (snap.drain_scan_cfg && typeof snap.drain_scan_cfg === 'object') {
    const cur = (await chrome.storage.local.get('drain_scan_cfg')).drain_scan_cfg || {};
    const keep = {};
    for (const k of ['kwRuns', 'lastScanAt', 'lastScanSummary']) if (cur[k] !== undefined) keep[k] = cur[k];
    snap.drain_scan_cfg = Object.assign({}, snap.drain_scan_cfg, keep);
  }
  await chrome.storage.local.set(snap);
}

async function runAcquire(kind, p) {
  const isDaily = kind === 'daily_browse';
  const label = isDaily ? '日常浏览' : '获客';
  await laySnapshot(p && p.snapshot);
  /* 「🌿 塞一轮日常流程」：网页把这一轮要跑的方向随单带来。本机的队列要自己插——
     网页那本账和执行器这本账是两本（配置从网页来，队列运行态在本机）。 */
  if (isDaily && p && p.daily && p.daily.k) {
    try {
      if (typeof drainQueuePushFront === 'function') {
        await drainQueuePushFront(String(p.daily.k), 'daily', String(p.daily.label || ''));
      }
    } catch (e) { console.warn('[执行器] 手插日常项失败:', e); }
  }
  const scope = p && p.scope === 'growing' ? 'growing' : 'all';
  const pace = p && p.pace === 'interval' ? 'interval' : 'once';
  const seq = String((p && p.seq) || '');

  await setActivity(`${label}：把机器人叫起来…`);
  await report(`${isDaily ? '🌿' : '🌾'} 收到${label}命令：起机器人跑一轮${(p && p.kw) ? `（${p.kw}）` : ''}`);

  /* 定时轮会在项与项之间歇（默认 10 分钟一项），15 分钟的上限不够；一遍跑完仍按 15 分钟 */
  const waitMs = pace === 'interval' ? 2 * 60 * 60 * 1000 : 15 * 60 * 1000;
  const r = await runHostOnce(
    `scope=${scope}&pace=${pace}&seq=${encodeURIComponent(seq)}`,
    waitMs);

  const logTail = String((r && r.logTail) || '');
  if (!r || !r.ok) {
    const why = (r && r.error) || '机器人没跑成';
    const err = new Error(why);
    err.exDetail = logTail.slice(-1800);
    throw err;
  }
  const st = r.stats || {};
  await report(`✅ ${label}跑完一轮：搜到 ${st.found || 0} 篇 · 评论 ${st.comments || 0} 条`);
  return JSON.stringify({
    kind: kind, ok: true, found: st.found || 0, comments: st.comments || 0, notes: st.notes || 0,
    at: new Date().toISOString(), logTail: logTail.slice(-1500),
  });
}

/* ═══════════ 获客里的单步活（网页上那几颗原先接不上的钮）═══════════ */

/* 今天收进获客池的笔记总数：按 noteId 去重，含别的词/截流扫描收的（确认单里的「今天共 M 篇」） */
async function drainDayTotal() {
  try {
    const d = await chrome.storage.local.get('drain_notes');
    const list = Array.isArray(d && d['drain_notes']) ? d['drain_notes'] : [];
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const seen = new Set();
    for (const n of list) {
      if (!n || Number(n.addedAt || 0) < t0.getTime()) continue;
      const id = String(n.noteId || n.url || n.id || '');
      if (id) seen.add(id);
    }
    return seen.size;
  } catch (_) { return 0; }
}

/* 🔎 搜索：起内核的搜索（真搜在它自己的异步任务里跑），盯 auto_water_state.searchState.searching
   由 true 变 false 就是这一轮搜完——结果落在 searchResults / searchState.foundNotes。
   一轮＝一类（2026-10-23 确认单）：这里只等第一类跑完，后面几类随回执交给服务器排期。 */
async function runSearch(p) {
  if (typeof AutoWater === 'undefined' || !AutoWater || typeof AutoWater.searchNotes !== 'function') {
    throw new Error('内核里没有搜索动作（exec-core 不是这个版本）');
  }
  /* 🛡 开工前过账号安全的几道闸：静默 / 单休 / 起床 / 发布占线 / 当天额度 */
  let wall = null;
  try {
    if (typeof AccountGuard !== 'undefined' && AccountGuard) wall = await AccountGuard.blockAllReason();
  } catch (_) {}
  if (wall) throw new Error('🛡 ' + (wall.text || '账号安全这阵不让动'));
  try {
    if (typeof AccountGuard !== 'undefined' && AccountGuard && typeof AccountGuard.decideSelf === 'function') {
      const q = await AccountGuard.decideSelf('open', 1);
      if (q && q.ok === false) throw new Error('🛡 ' + (q.text || '今天打开笔记的额度用完了'));
    }
  } catch (e) {
    if (e && String(e.message || '').indexOf('🛡') === 0) throw e;
  }
  await laySnapshot(p && p.snapshot);
  const kw = String((p && p.kw) || '').trim();
  const profile = String((p && p.profile) || '').trim();
  const label = String((p && p.label) || '').trim();
  const scenario = String((p && p.scenario) || '').trim();
  await setActivity(profile ? '搜索：准备进他主页扒笔记…' : '搜索：准备起小红书页…');
  await report(profile
    ? `🔎 收到「盯账号」命令：${label || profile}${scenario ? '（' + scenario + '）' : ''}`
    : `🔎 收到搜索命令${kw ? '：' + kw : ''}${scenario ? '（' + scenario + '）' : '（按词池指针）'}`);

  const began = await AutoWater.searchNotes({
    kw: kw || undefined, profile: profile || undefined, label: label || undefined,
    scenario: scenario || undefined, force: !!(p && p.force),
  });
  if (!began || began.ok !== true) throw new Error((began && began.error) || '搜索没能开始');

  const t0 = Date.now();
  let st = null;
  let lastIdx = -1;
  let lastFound = -1;
  let lastMoveAt = Date.now();
  let fullSince = 0;
  let settledByGrace = false;
  for (;;) {
    if (await isStopping()) throw new Error('STOPPED');
    /* 登录墙一出现就地停：别让后面继续搜、更别报「捞到 0 篇」 */
    if (loginAbort) throw new Error(abortNote || LOGIN_FAIL_NOTE);
    st = await Storage.getAutoWaterState();
    const ss = (st && st.searchState) || null;
    if (!ss || ss.searching === false) break;
    const total = (ss.plan || []).length || 0;
    const idx = Number(ss.planIdx) || 0;
    const foundNow = (ss.foundNotes || []).length;
    /* 收尾没落盘兜底：搜索动作已经全走完（planIdx 到头）却还挂着 searching=true，
       再等 15 秒仍不见落定，就按跑完处理——不让人为一次存储抖动干等一刻钟。 */
    if (total > 0 && idx >= total) {
      if (!fullSince) fullSince = Date.now();
      else if (Date.now() - fullSince >= 15000) { settledByGrace = true; break; }
    } else fullSince = 0;
    if (idx !== lastIdx || foundNow !== lastFound) { lastIdx = idx; lastFound = foundNow; lastMoveAt = Date.now(); }
    /* 进度闹钟：3 分钟一格没动＝这一步卡死，早点收场让人重试 */
    if (Date.now() - lastMoveAt > 3 * 60 * 1000) {
      throw new Error(`搜索卡住了：停在 ${idx}/${total || '?'}，3 分钟没有进展（已找到 ${foundNow} 篇）——先「停这一趟」，稍后再点搜索`);
    }
    if (Date.now() - t0 > 15 * 60 * 1000) {
      throw new Error(`搜索跑了 15 分钟还没完（停在 ${idx}/${total || '?'}，已找到 ${foundNow} 篇）——先「停这一趟」，稍后再试`);
    }
    await setActivity(`搜索中：${ss.currentKeyword || kw || ''} ${idx}/${total || '?'}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (loginAbort) throw new Error(abortNote || LOGIN_FAIL_NOTE);
  if (settledByGrace) await report('🩹 搜索动作都走完了、收尾没落盘——已按跑完处理');

  const found = Array.isArray(st && st.searchResults)
    ? st.searchResults
    : ((st && st.searchState && st.searchState.foundNotes) || []);
  const done = (st && st.searchState) || {};
  /* 普通「收 0 篇」不算失败；页面一次都没打开/没拿到结果才算这一轮没跑起来 */
  const pageOk = done.pageOk == null ? 1 : Number(done.pageOk) || 0;
  const pageErr = Number(done.pageErrors) || 0;
  if (found.length === 0 && pageOk === 0) {
    throw new Error(pageErr
      ? '小红书搜索页没打开（' + pageErr + ' 次都没拿到结果）——这一轮停下，回头再点搜索'
      : '这一轮一篇都没拿到——页面可能没加载出来，回头再点搜索');
  }
  const word = done.currentKeyword || kw || label || profile;
  const round = done.round || began.round || '';
  const roundName = done.roundName || began.roundName || round;
  const remain = Array.isArray(began.remain) ? began.remain : [];
  const remainNames = Array.isArray(began.remainNames) ? began.remainNames : [];
  const dayTotal = await drainDayTotal();
  await report(`✅ 搜索跑完${word ? '（' + word + '）' : ''}：这一轮${roundName ? '「' + roundName + '」' : ''}收 ${found.length} 篇 · 今天共 ${dayTotal} 篇` +
    (remainNames.length ? `；后面还有 ${remainNames.join(' / ')}` : ''));
  return JSON.stringify({
    kind: 'acquire', op: 'search', ok: true, kw: word, found: found.length,
    round, roundName, remain, remainNames,
    latestNotDue: !!began.latestNotDue,
    dayTotal,
    notes: found.slice(0, 10).map((n) => ({
      noteId: (n && n.noteId) || '', title: (n && n.title) || '',
      url: (n && n.url) || '',
    })),
    at: new Date().toISOString(),
  });
}

/* 🧹 截流扫一轮：直接调内核那套来源扫描（它自己开专用小红书页逐词扫） */
async function runDrainScan(p) {
  if (typeof handleDrainScan !== 'function') throw new Error('内核里没有截流扫描动作（exec-core 不是这个版本）');
  await laySnapshot(p && p.snapshot);
  await setActivity('截流：扫一轮关键词来源…');
  await report('🧹 收到「截流扫一轮」命令');
  const r = await handleDrainScan({});
  if (!r || r.ok !== true) throw new Error((r && r.error) || '截流扫描没成');
  const s = r.summary || {};
  await report(`✅ 截流扫完：新 ${s.foundNew || 0} 篇 · 并入获客 ${s.imported || 0} · 池里共 ${s.total || 0} 篇`);
  return JSON.stringify({ kind: 'acquire', op: 'scan', ok: true, summary: s, at: new Date().toISOString() });
}

/* 🔁 补开本轮没打开的笔记（手动那颗，force 绕开自动开关） */
async function runDrainBackfill(p) {
  if (typeof handleDrainReplenish !== 'function') throw new Error('内核里没有补开动作（exec-core 不是这个版本）');
  await laySnapshot(p && p.snapshot);
  await setActivity('截流：补开没打开的…');
  await report('🔁 收到「补开未打开」命令');
  const r = await handleDrainReplenish({ round: true, force: true });
  if (r && r.ok === true && r.busy) {
    await report('⚠️ 本机已经有一轮补开在跑，这条没重复跑');
    return JSON.stringify({ kind: 'acquire', op: 'backfill', ok: true, busy: true, at: new Date().toISOString() });
  }
  if (!r || r.ok !== true) throw new Error((r && r.error) || '补开没成');
  const s = r.summary || {};
  await report(`✅ 补开完成：开 ${s.opened || 0} · 跳 ${s.skipped || 0} · 淘汰 ${s.expired || 0} · 失败 ${s.failed || 0}`);
  return JSON.stringify({ kind: 'acquire', op: 'backfill', ok: true, summary: s, at: new Date().toISOString() });
}

/* 打开一篇（网页列表里点进来）：把这一篇真的在本机浏览器里点开，并记住它——
   紧接着的「评论刷新 / 整页发送」不带 note 时就对这篇干活 */
async function runOpenNote(p) {
  const note = await noteFromParams(p);
  await setActivity('打开笔记：' + (note.title || note.noteId || ''));
  await report(`📖 收到「打开笔记」命令：《${note.title || note.noteId || ''}》`);
  const r = await AutoWater.openNote(note);
  if (!r || r.ok !== true) throw new Error((r && r.error) || '没打开这篇笔记');
  const saved = {
    noteId: String(r.noteId || note.noteId || ''), url: String(note.url || ''),
    title: String(note.title || ''), author: String(note.author || ''), at: Date.now(),
  };
  await set('ex.lastNote', saved);
  await report(`✅ 已在执行器浏览器里打开：《${saved.title || saved.noteId}》`);
  return JSON.stringify({
    kind: 'acquire', op: 'open', ok: true, noteId: saved.noteId, title: saved.title,
    via: r.via || '', ready: !!r.ready, at: new Date().toISOString(),
  });
}

/* 🔄 评论刷新：把这一篇打开 → 宿主页「评论刷新」把评论抓进助手并做 AI 分析 */
async function runRefreshNote(p) {
  const note = await noteFromParams(p);
  await setActivity('评论刷新：打开这一篇…');
  await report(`🔄 收到「评论刷新」命令：《${note.title || note.noteId || ''}》`);
  const info = await ensureNoteLoaded(note);
  const r = await runHostOnce(
    `act=refresh&tabId=${encodeURIComponent(info.tabId)}&seq=${encodeURIComponent((p && p.seq) || '')}`,
    12 * 60 * 1000);
  const logTail = String((r && r.logTail) || '');
  if (!r || !r.ok) {
    const err = new Error((r && r.error) || '评论刷新没成');
    err.exDetail = logTail.slice(-1800);
    throw err;
  }
  const st = r.stats || {};
  await report(`✅ 评论刷新跑完：这篇抓进 ${st.comments || 0} 条评论`);
  return JSON.stringify({
    kind: 'acquire', op: 'refresh', ok: true, noteId: info.noteId,
    comments: st.comments || 0, at: new Date().toISOString(),
  });
}

/* 📤 整页发送：先刷新（把评论商机摆出来）→ 再逐条发（宿主页自己过账号安全的闸） */
async function runBatchSend(p) {
  const note = await noteFromParams(p);
  await setActivity('整页发送：打开这一篇…');
  await report(`📤 收到「整页发送」命令：《${note.title || note.noteId || ''}》`);
  const info = await ensureNoteLoaded(note);
  const r = await runHostOnce(
    `act=batch_send&tabId=${encodeURIComponent(info.tabId)}&seq=${encodeURIComponent((p && p.seq) || '')}`,
    30 * 60 * 1000);
  const logTail = String((r && r.logTail) || '');
  if (!r || !r.ok) {
    const err = new Error((r && r.error) || '整页发送没成');
    err.exDetail = logTail.slice(-1800);
    throw err;
  }
  const st = r.stats || {};
  await report(`✅ 整页发送跑完：成功 ${st.sent || 0} 条 · 失败 ${st.failed || 0} 条 · 没发 ${st.left || 0} 条`);
  return JSON.stringify({
    kind: 'batch_send', ok: true, noteId: info.noteId,
    sent: st.sent || 0, failed: st.failed || 0, left: st.left || 0, total: st.total || 0,
    at: new Date().toISOString(),
  });
}

/* 🎬 本机出片：网页把这一篇的草稿（分幕/配音参数/底图引用）随单带下来，
   摆进本机 xhsFilmDocs，再打开 video.html?aw=1&auto=1 —— 那页接上草稿就自己出片，
   出完从 film-round 回报。片子留在本机（自动下载），不回传服务器。 */
async function runFilm(p) {
  const noteId = String((p && p.noteId) || '').trim();
  const doc = (p && p.doc && typeof p.doc === 'object') ? p.doc : null;
  if (!noteId) throw new Error('命令里没带"哪一篇"（noteId）');
  if (!doc || !Array.isArray(doc.scenes) || !doc.scenes.length) {
    throw new Error('这一篇还没有分幕——先在网页上把口播稿分好幕，再点出片');
  }
  const cur = (await chrome.storage.local.get('xhsFilmDocs')).xhsFilmDocs || {};
  cur[noteId] = Object.assign({}, cur[noteId] || {}, doc, { updatedAt: Date.now() });
  await chrome.storage.local.set({ xhsFilmDocs: cur });

  await setActivity('本机出片：准备…');
  await report(`🎬 收到出片命令：《${doc.title || noteId}》${doc.scenes.length} 幕`);

  const ticket = WW ? await WW.issueTicket('film') : '';
  const url = chrome.runtime.getURL('video.html?auto=1' + (ticket ? '&t=' + ticket : '') + '&noteId=' + encodeURIComponent(noteId));
  let tab = null;
  try {
    tab = WW
      ? await WW.openTab(url, { focus: true })
      : await chrome.tabs.create({ url, active: true });
  } catch (e) { throw new Error('打不开出片页：' + (e && e.message)); }
  if (await isStopping()) workStop();

  const r = await new Promise((resolve) => {
    filmResolve = resolve;
    setTimeout(() => {
      if (filmResolve === resolve) {
        filmResolve = null;
        resolve({ ev: 'done', ok: false, error: '出片超时（30 分钟没回话）' });
      }
    }, 30 * 60 * 1000);
  });
  if (!WW) { try { if (tab && tab.id != null) await chrome.tabs.remove(tab.id); } catch (_) {} }
  if (!loginAbort) await setActivity('待命');

  if (!r || !r.ok) {
    const err = new Error((r && r.error) || '出片没成');
    err.exDetail = String((r && r.logTail) || '').slice(-1800);
    throw err;
  }
  const mb = r.size ? (r.size / 1048576).toFixed(1) + 'MB' : '成片';
  const fontMissing = (r.fonts && Array.isArray(r.fonts.missing)) ? r.fonts.missing : [];
  if (fontMissing.length) {
    await report(`⚠️ 内置字体没下来（${fontMissing.join('、')}）——这条片用的是系统字体，字形会和预览有出入`);
  }
  await report(`✅ 出片完成：《${doc.title || noteId}》${r.dur ? Number(r.dur).toFixed(1) + 's · ' : ''}${mb}（文件已下载到这台电脑）`);
  return JSON.stringify({
    kind: 'film', ok: true, noteId, dur: Number(r.dur) || 0, size: Number(r.size) || 0,
    name: String(r.name || ''), fontMissing, at: new Date().toISOString(),
  });
}

/* ═══════════ AI客服 · 长驻监听（B 期）═══════════
 * 与获客/日常浏览完全不同：这条**不用宿主页**。哨兵（🛰 新消息监听）本来就住在后台——
 * 它是内核 exec-core.js 里那套 alarms 驱动的轻哨兵（每 30 秒读一眼私信未读、有真变化才抓），
 * 自己开一张「🛰 监听页」停在 /chat 待命。服务器下个开关令，这只手把内核的监听开关掰一下（handleSetMsgWatch），
 * 之后就由内核自己活着跑了——不用网页开着、不用宿主页。
 * params：{ on:true|false, tickSec:60 }
 * 注：消费的私信话术仍要 AI —— 那条走上面那层「AI 出门口」（AiClient 已被换成经服务器出网）。 */
const LEADS_ON = 'msg_watch_on', LEADS_TICK = 'msg_watch_tick', LEADS_STATE = 'msg_watch_state';

async function runLeads(p) {
  /* 网页上点「发送」那一颗：不是开关监听，是发一条私信 → 直接调内核的发私信动作 */
  if (p && (p.op === 'dm' || p.person)) return await runSendDm(p);
  const on = !!(p && p.on);
  const tickSec = Math.max(30, parseInt((p && p.tickSec), 10) || 60);
  if (typeof handleSetMsgWatch !== 'function') throw new Error('内核里没有监听开关（exec-core 不是这个版本）');

  /* AI客服是长驻的，没有干活窗口：开监听前先认一次小红书号（错号就不让它替别人盯着） */
  if (on && AC) {
    await setActivity('AI客服：先认一下小红书号…');
    const res = await AC.checkPlatforms(['xhs'], { force: true, onStep: (t) => { setActivity(t); } });
    const why = AC.blockReason('xhs', res.xhs);
    if (why) throw new Error(why);
  }

  keepActivity = on;
  await setActivity(on ? 'AI客服：把监听开起来…' : 'AI客服：把监听关掉…');
  await report(on ? '📡 收到 AI客服命令：开监听（长驻轻哨兵）' : '📭 收到 AI客服命令：关监听');

  const r = await handleSetMsgWatch({ enabled: on, tickSec });
  const watchOn = (await chrome.storage.local.get(LEADS_ON))[LEADS_ON] === true;
  const tick = (await chrome.storage.local.get(LEADS_TICK))[LEADS_TICK] || 0;
  const state = (await chrome.storage.local.get(LEADS_STATE))[LEADS_STATE] || {};

  if (on) { await setActivity('AI客服：监听中（每 ' + tick + ' 秒轻窥一次）'); await report(`✅ AI客服监听已开：每 ${tick} 秒轻窥一次，自己开「🛰 监听页」待命`); }
  else await report('✅ AI客服监听已关（监听页收掉）');

  return JSON.stringify({ kind: 'leads', ok: true, on: !!(r && r.enabled), tickSec: Number(tick) || 0, watchOn, state, at: new Date().toISOString() });
}

/* 网页上点「发送私信」：与自动跟单同一条链——先过账号安全的总账，发出去了才记这一笔。
   内核的 handleSendDm 自己会开聊天页、注入页面脚本、发送并落线索记录。 */
async function runSendDm(p) {
  if (Array.isArray(p && p.people) && p.people.length) return await runSendDmBatch(p);
  const person = (p && p.person) || null;
  const text = String((p && p.text) || '').trim();
  if (!person) throw new Error('命令里没带"发给谁"');
  if (!text) throw new Error('命令里没带私信内容');
  if (typeof handleSendDm !== 'function') throw new Error('内核里没有发私信动作（exec-core 不是这个版本）');

  await setActivity('AI客服：发一条私信…');
  await report(`📨 收到私信命令：发给 ${person.nickname || person.id || ''}`);
  const r = await sendDmOne(person, text, !!(p && p.force));
  if (r.pending) {
    await report('⚠️ 私信可能已发出、平台没回确认：已标记「待人工检查」（不会重发）');
    return JSON.stringify({ kind: 'leads', op: 'dm', ok: true, pending: true, notice: r.notice || '', at: new Date().toISOString() });
  }
  await report('✅ 私信发出去了');
  return JSON.stringify({ kind: 'leads', op: 'dm', ok: true, at: new Date().toISOString() });
}

/* 发一条：先过账号安全总账，发出去了才记账。gated 抛出去给上层分桶（批量里算"略过"） */
async function sendDmOne(person, text, force) {
  let gd = null;
  try { gd = await AccountGuard.decide('dm', 1); } catch (_) {}
  if (gd && gd.ok === false) throw new Error('🛡 ' + (gd.text || '账号安全拦下'));
  const r = await handleSendDm({ person, text, aiGenerated: true, force: force });
  if (r && r.ok === true) {
    try { await AccountGuard.spend('dm', 1); } catch (_) {}
    if (r.navigating) throw new Error(r.notice || '已打开对方主页，等页面加载完再点一次发送');
    return r;
  }
  if (r && r.gated) {
    const e = new Error(r.error || '这条线索意向不够，先别发（要发就在网页上点「仍要发送」）');
    e.gated = true;
    throw e;
  }
  if (r && r.limited) {
    const e = new Error(r.error || r.notice || '私信受限');
    e.limited = true;
    throw e;
  }
  throw new Error((r && (r.error || r.notice)) || '私信没发成');
}

/* 批量自动触达（网页上「⚡ 自动触达」整包派下来）：逐条发，3~8 秒一条，低意向/受限分桶继续下一条 */
async function runSendDmBatch(p) {
  if (typeof handleSendDm !== 'function') throw new Error('内核里没有发私信动作（exec-core 不是这个版本）');
  const people = (Array.isArray(p && p.people) ? p.people : [])
    .map((x) => ({ person: (x && x.person) || null, text: String((x && x.text) || '').trim() }))
    .filter((x) => x.person && x.text);
  if (!people.length) throw new Error('命令里没有可发的私信（人或话术为空）');

  await report(`📨 收到批量触达命令：${people.length} 人（逐条发，间隔 3~8 秒）`);
  let sent = 0, gated = 0, limited = 0, failed = 0;
  const fails = [];
  for (let i = 0; i < people.length; i++) {
    if (await isStopping()) throw new Error('STOPPED');
    const { person, text } = people[i];
    const nick = person.nickname || person.id || ('第' + (i + 1) + '位');
    await setActivity(`AI客服：批量触达 ${i + 1}/${people.length}（${nick}）`);
    try {
      await sendDmOne(person, text, !!(p && p.force));
      sent++;
      await report(`✅ 批量触达 ${i + 1}/${people.length}：@${nick} 发出去了`);
    } catch (e) {
      if (e && e.gated) { gated++; await report(`🚫 ${nick}：意向不够，已略过`); }
      else if (e && e.limited) { limited++; await report(`⛔ ${nick}：私信受限，已跳过`); }
      else { failed++; fails.push(nick + '：' + ((e && e.message) || e)); await report(`❌ ${nick}：${(e && e.message) || e}`); }
    }
    if (i < people.length - 1) await new Promise((r) => setTimeout(r, 3000 + Math.random() * 5000));
  }
  const summary = `批量触达：成功 ${sent} · 略过低意向 ${gated} · 受限 ${limited} · 失败 ${failed}`;
  if (!sent) {
    const err = new Error(summary + (fails.length ? '（' + fails.slice(0, 3).join('；') + '）' : ''));
    err.exDetail = fails.join('\n').slice(-1800);
    throw err;
  }
  await report('🏁 ' + summary);
  return JSON.stringify({ kind: 'leads', op: 'dm', ok: true, sent: sent, gated: gated, limited: limited, failed: failed, at: new Date().toISOString() });
}

async function ack(cmdId, ok, note, detail, extra) {
  const cred = await getCred();
  if (!cred) return;
  try {
    await fetchT(cred.server + '/api/exec/ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handId: cred.handId, token: cred.token, cmdId, ok,
        note: note || '', detail: detail || '', ...(extra || {}),
      }),
    }, 15000);
  } catch { /* 服务器不在，回执丢了就丢了（下次心跳再补） */ }
  await report(`${ok ? '✅' : '⚠️'} ${note || (ok ? '干完了' : '没干成')}`);
}

/* 面板拿一份快照：账号/状态/活动/连通 + 两个平台各绑的号、最近一次认号结果 */
async function snapshotData() {
  const [cred, st, act, link] = await Promise.all([getCred(), getState(), get('ex.activity'), get('ex.link')]);
  let bindings = {}, bindState = {};
  if (AC) {
    try { [bindings, bindState] = await Promise.all([AC.getBindings(), AC.getState()]); } catch (_) {}
  }
  return {
    ok: true,
    cred: cred ? { server: cred.server, account: cred.account, serverName: cred.serverName } : null,
    state: st, activity: act || { text: '' }, link: link || null,
    bindings: bindings || {}, bindState: bindState || {},
  };
}

/* 面板点「认一下」：读一遍这个平台 → 空着就绑上 / 相同就刷新 / 不同就报错（换绑找老板）
   小红书没登录：留扫码页等人，扫完自己认号（最多 10 分钟）；抖音不等 */
async function bindNow(platform) {
  const p = String(platform || '');
  if (!AC) return { ok: false, error: '认号模块没装上（这个包太旧）' };
  if (!['xhs', 'douyin'].includes(p)) return { ok: false, error: '不认识的平台：' + (p || '(空)') };
  const label = p === 'xhs' ? '小红书' : '抖音';
  await setActivity('认号：读一遍' + label + '…');
  let res = null;
  try {
    res = await AC.bindPlatforms([p], {
      onStep: (t) => { setActivity(t); },
      waitMs: p === 'xhs' ? BIND_WAIT_MS : 0,
      shouldStop: isStopping,
      onLoginWait: (on) => setLoginWait(on, 'bind'),
    });
  } catch (e) {
    await setLoginWait(false);
    return { ok: false, error: '认号出错：' + ((e && e.message) || e) };
  }
  await setLoginWait(false);
  const r = (res && res[p]) || { status: 'unknown' };
  if (r.status === 'ok') {
    await setActivity('已认上' + label + '号');
    return { ok: true, status: 'ok', result: r };
  }
  const why = r.error || AC.blockReason(p, r) || ('没认上' + label + '号');
  await setActivity(label + '号没认上');
  return { ok: false, error: why, result: r };
}

/* ── 面板专用通道 ──
   内核 exec-core 对所有 runtime 消息都会抢答一句「未知 action」，面板的挂线/状态回话会被它截胡。
   面板改走独立端口（内核不监听端口），这样「挂线成功/在线待命」才拿得到真回话。 */
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'ex-panel') return;
  port.onMessage.addListener(async (m) => {
    if (!m || !m.type) return;
    let data;
    try {
      if (m.type === 'ex.pair') data = await pair(m.server, m.code, m.label);
      else if (m.type === 'ex.logout') data = await logout();
      else if (m.type === 'ex.bind') data = await bindNow(m.platform);
      else if (m.type === 'ex.stop') { await setStopping(true); workStop(); data = { ok: true }; }
      else if (m.type === 'ex.snapshot') data = await snapshotData();
      else data = { error: '未知 type: ' + m.type };
    } catch (e) {
      data = { error: (e && e.message) || String(e) };
    }
    try { port.postMessage({ reqId: m.reqId, data }); } catch (_) {}
  });
});

/* ── 面板来的消息 ── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ex.pair') { pair(msg.server, msg.code, msg.label).then(sendResponse); return true; }
  if (msg && msg.type === 'ex.logout') { logout().then(sendResponse); return true; }
  if (msg && msg.type === 'ex.bind') { bindNow(msg.platform).then(sendResponse); return true; }
  if (msg && msg.type === 'ex.stop') { setStopping(true).then(() => { workStop(); sendResponse({ ok: true }); }); return true; }
  if (msg && msg.type === 'ex.snapshot') { snapshotData().then(sendResponse); return true; }
  return false;
});

/* ── 开机：对账 + 挂耳朵 ── */
async function boot() {
  await heartbeatOnce();
  const cred = await getCred();
  if (cred) {
    /* 服务线程中途重启：上一单没干完、窗也收了——按"停在那一步"回报，不假装成功 */
    if (WW) {
      try {
        const intr = await WW.takeInterrupted();
        if (intr && intr.cmdId) {
          await ack(intr.cmdId, false, '执行器中途重启：这一单停在那一步，不记为成功（服务器可重派）',
            JSON.stringify({ kind: intr.kind || '', interrupted: true, at: new Date().toISOString() }));
        }
      } catch (_) {}
    }
    const st = await getState();
    await fetchRules(false).catch(() => {});
    await report(`🟢 执行器已就位（${st.status === 'killed' ? '服务器在熔断中，保持锁定' : '待命'}）`);
    earLoop();
  }
}
boot();

/* MV3 服务工作线程闲 30 秒会被收走——20 秒碰一下浏览器 API 保持在线 */
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
/* 心跳对账：每 15 秒问一句服务器，防漏收指令 */
setInterval(heartbeatOnce, 15000);

})();
