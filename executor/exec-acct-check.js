/* exec-acct-check.js — 平台认号（2026-10-23）
 *
 * 一个网页账号在每个平台锁一个号：
 *   · 小红书：打开本人「我的」主页，读 小红书号 + 主页内部 id
 *   · 抖音：打开 www.douyin.com/user/self，读本人 isLogin 段里的 抖音号 + uid/secUid
 *
 * 什么时候查（2026-10-23 定）：挂线时各认一次；之后每开一次干活窗口，两个平台各认一遍；
 * 同一个窗口里跑多久都不再重复查。查不到/对不上＝那个平台停手，另一个平台照跑。
 *
 * 注意：抖音页面里混着别人的 secUid，只能认「本人已登录」那一段 JSON，不能抓页面上第一个。
 */
(() => {
  'use strict';

  const K_BINDINGS = 'ex.bindings';
  const K_CACHE = 'ex.acctCheck';
  const K_ACCT_TAB = 'ex.acctTab';
  const LABEL = { xhs: '小红书', douyin: '抖音' };
  const DOUYIN_ORIGINS = ['https://www.douyin.com/*'];
  const WAIT_POLL_MS = 3000;       // 等扫码：每 3 秒看一眼
  const READ_RETRY_MS = 30000;     // 扫上以后读主页：最多重试 30 秒
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getBindings() {
    try { return (await chrome.storage.local.get(K_BINDINGS))[K_BINDINGS] || {}; } catch (_) { return {}; }
  }
  async function setBindings(b) {
    if (!b || typeof b !== 'object') return;
    try { await chrome.storage.local.set({ [K_BINDINGS]: b }); } catch (_) {}
  }
  async function getCred() {
    try { return (await chrome.storage.local.get('ex.cred'))['ex.cred'] || null; } catch (_) { return null; }
  }
  async function post(path, body) {
    const cred = await getCred();
    if (!cred || !cred.server) return { ok: false, error: '还没挂线' };
    try {
      const r = await fetch(cred.server + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handId: cred.handId, token: cred.token, ...(body || {}) }),
      });
      return await r.json();
    } catch (e) { return { ok: false, error: (e && e.message) || '连不上服务器' }; }
  }

  /* ── 页面读写小工具 ── */
  async function tabComplete(tabId, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 25000)) {
      let t = null;
      try { t = await chrome.tabs.get(tabId); } catch (_) { return false; }
      if (t && t.status === 'complete') return true;
      await sleep(400);
    }
    return false;
  }
  async function sendTab(tabId, msg, timeoutMs) {
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(tabId, msg),
        sleep(timeoutMs || 6000).then(() => null),
      ]);
    } catch (_) { return null; }
  }
  async function injectContent(tabId) {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch (_) {}
    await sleep(250);
  }
  async function runJs(tabId, func) {
    try {
      const arr = await chrome.scripting.executeScript({ target: { tabId }, func });
      return arr && arr[0] ? arr[0].result : null;
    } catch (_) { return null; }
  }
  async function openTab(winId, url, active) {
    const opts = { url, active: active !== false };
    if (winId) opts.windowId = winId;
    const t = await chrome.tabs.create(opts);
    await tabComplete(t.id, 25000);
    await sleep(900);
    return t;
  }
  async function closeTab(tabId) {
    try { await chrome.tabs.remove(tabId); } catch (_) {}
  }

  /* 认号用的那张页记在会话里：下次认号先复用它（登录页/错号页留着时，不越开越多） */
  const tabStore = () => chrome.storage.session || chrome.storage.local;
  async function rememberTab(tabId) {
    try { await tabStore().set({ [K_ACCT_TAB]: tabId }); } catch (_) {}
  }
  async function forgetTab() {
    try { await tabStore().remove(K_ACCT_TAB); } catch (_) {}
  }
  async function openCheckTab(winId, url) {
    let tabId = 0;
    try { tabId = Number((await tabStore().get(K_ACCT_TAB))[K_ACCT_TAB]) || 0; } catch (_) { tabId = 0; }
    if (tabId) {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t && (!winId || t.windowId === winId)) {
          await chrome.tabs.update(tabId, { url, active: true });
          await tabComplete(tabId, 25000);
          await sleep(900);
          return await chrome.tabs.get(tabId);
        }
      } catch (_) {}
    }
    const t = await openTab(winId, url, true);
    await rememberTab(t.id);
    return t;
  }
  /* 要人扫码：把这张页和它所在的窗端到最前面 */
  async function focusTab(tab) {
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {}
    try { if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
  }
  async function askWho(tabId) {
    await injectContent(tabId);
    let info = await sendTab(tabId, { action: 'whoAmI' }, 8000);
    if (!info) { await injectContent(tabId); info = await sendTab(tabId, { action: 'whoAmI' }, 8000); }
    return info;
  }
  function isLoggedOut(info) {
    if (!info || !info.ok) return false;
    if (info.needLogin) return true;
    return !info.onOwn && !info.ownUrl;
  }
  function mmss(ms) {
    const s = Math.max(0, Math.round(Number(ms) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ── 小红书：本人主页 → 小红书号 + 内部 id ──
     opts.waitMs > 0：没登录就把登录页留着、把窗端到前面等扫码；扫上了自动接着读号。
     opts.holdTab：这张检查页由调用方决定收还是留（对上号收，没登录/错号/超时留给人看）。 */
  async function readXhs(winId, onStep, opts) {
    const o = opts || {};
    const waitMs = Math.max(0, Number(o.waitMs) || 0);
    const hold = !!o.holdTab;
    if (onStep) onStep('认号：打开小红书本人主页…');
    const tab = await openCheckTab(winId, 'https://www.xiaohongshu.com/explore');
    let inWait = false;
    const tellWait = async (on) => {
      if (inWait === !!on) return;
      inWait = !!on;
      try { if (o.onLoginWait) await o.onLoginWait(!!on); } catch (_) {}
    };
    try {
      let info = await askWho(tab.id);
      if (!info || !info.ok) return { status: 'unknown', error: '小红书页面没回话', tabId: hold ? tab.id : 0 };

      if (isLoggedOut(info)) {
        if (!waitMs) return { status: 'loggedout', error: '小红书没登录' };

        /* 没登录：不判失败，留在这张页上等人扫码 */
        await tellWait(true);
        await focusTab(tab);
        const t0 = Date.now();
        let gotIn = false;
        while (Date.now() - t0 < waitMs) {
          if (o.shouldStop) {
            try { if (await o.shouldStop()) return { status: 'stopped', error: '你按了停这一趟' }; } catch (_) {}
          }
          if (onStep) onStep('等扫码登录小红书…（还剩 ' + mmss(waitMs - (Date.now() - t0)) + '）');
          await sleep(WAIT_POLL_MS);
          try { await chrome.tabs.get(tab.id); } catch (_) { return { status: 'loggedout', error: '扫码页被关掉了' }; }
          const got = await askWho(tab.id);
          if (got && got.ok && !isLoggedOut(got)) { info = got; gotIn = true; break; }
        }
        if (!gotIn) {
          const mins = Math.max(1, Math.round(waitMs / 60000));
          return { status: 'loggedout', timeout: true, waitMin: mins, error: '等了 ' + mins + ' 分钟没扫码' };
        }
        if (onStep) onStep('认号：扫码成功，正在读主页…');
        await tellWait(false);
      }

      /* 登录了：读到本人主页为止。刚扫完页面还在跳，重试 30 秒 */
      const retryUntil = waitMs ? Date.now() + READ_RETRY_MS : Date.now();
      let saw = null;
      while (true) {
        if (!info || !info.ok) info = await askWho(tab.id);
        if (info && info.ok) {
          if (info.onOwn && (info.xhsId || info.uid)) {
            saw = { displayId: String(info.xhsId || ''), uid: String(info.uid || ''), name: String(info.name || '') };
            break;
          }
          if (!info.onOwn && info.ownUrl) {
            const bare = String(info.ownUrl).split('#')[0];
            if (bare && bare.indexOf('/user/profile/') > 0) {
              if (onStep) onStep('认号：打开小红书「我的」主页…');
              try { await chrome.tabs.update(tab.id, { url: bare }); } catch (_) {}
              await tabComplete(tab.id, 25000);
              await sleep(1200);
              info = null;
              continue;
            }
          }
          if (isLoggedOut(info)) {
            if (Date.now() >= retryUntil) return { status: 'loggedout', error: '小红书没登录' };
            await sleep(1200);
            info = null;
            continue;
          }
          info = null;
        }
        if (Date.now() >= retryUntil) break;
        await sleep(1000);
      }
      if (!saw) return { status: 'unknown', error: '没读到小红书号', tabId: hold ? tab.id : 0 };
      return { status: 'ok', saw: saw, tabId: hold ? tab.id : 0 };
    } finally {
      await tellWait(false);
      if (!hold) { await closeTab(tab.id); await forgetTab(); }
    }
  }

  /* ── 抖音：/user/self → 本人 isLogin 段 ── */
  const DY_READ = () => {
    const html = document.documentElement ? document.documentElement.innerHTML : '';
    const norm = html.replace(/\\"/g, '"').replace(/\\u002F/gi, '/');
    const text = document.body ? document.body.innerText : '';
    const out = { loggedIn: false, displayId: '', uid: '', secUid: '', name: '' };
    const i = norm.indexOf('"isLogin":true');
    if (i >= 0) {
      out.loggedIn = true;
      const seg = norm.slice(i, i + 8000);
      const j = seg.indexOf('"info":{');
      const box = j >= 0 ? seg.slice(j, j + 4000) : seg;
      const pick = (k) => {
        const m = box.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"'));
        return m ? m[1] : '';
      };
      out.uid = pick('uid'); out.secUid = pick('secUid');
      out.displayId = pick('shortId'); out.name = pick('nickname');
    }
    if (!out.displayId) {
      const m = text.match(/抖音号[:：]\s*([A-Za-z0-9_.-]{4,})/);
      if (m) out.displayId = m[1];
    }
    if (!out.name) {
      const t = String(document.title || '').replace(/\s*-\s*抖音.*$/, '').trim();
      if (t && t.length <= 30) out.name = t;
    }
    return out;
  };

  async function readDouyin(winId, onStep) {
    let has = false;
    try { has = await chrome.permissions.contains({ origins: DOUYIN_ORIGINS }); } catch (_) { has = false; }
    if (!has) return { status: 'noperm', error: '没给抖音网页权限' };
    if (onStep) onStep('认号：打开抖音本人主页…');
    const tab = await openTab(winId, 'https://www.douyin.com/user/self');
    try {
      let got = null;
      for (let i = 0; i < 10; i++) {
        got = await runJs(tab.id, DY_READ);
        if (got && got.loggedIn && (got.uid || got.displayId)) break;
        await sleep(900);
      }
      if (!got) return { status: 'unknown', error: '抖音页面没回话' };
      if (!got.loggedIn) return { status: 'loggedout', error: '抖音没登录' };
      const saw = { displayId: String(got.displayId || ''), uid: String(got.uid || ''), secUid: String(got.secUid || ''), name: String(got.name || '') };
      if (!saw.displayId && !saw.uid) return { status: 'unknown', saw, error: '没读到抖音号' };
      return { status: 'ok', saw };
    } finally {
      await closeTab(tab.id);
    }
  }

  async function readPlatform(platform, winId, onStep, opts) {
    try {
      if (platform === 'xhs') return await readXhs(winId, onStep, opts);
      if (platform === 'douyin') return await readDouyin(winId, onStep);
      return { status: 'unknown', error: '不认识的平台' };
    } catch (e) {
      return { status: 'unknown', error: (e && e.message) || '认号出错' };
    }
  }

  async function getState() {
    try { return (await chrome.storage.local.get('ex.bindState'))['ex.bindState'] || {}; } catch (_) { return {}; }
  }
  async function setState(results) {
    try { await chrome.storage.local.set({ 'ex.bindState': results || {} }); } catch (_) {}
  }

  /* ── 挂线时：读到什么就认什么（服务器会拒撞号/拒换号）
     面板点「认一下」时 opts.waitMs 让小红书没登录就先等扫码，扫上了自动认 ── */
  async function bindPlatforms(platforms, opts) {
    const o = opts || {};
    const results = {};
    for (const p of platforms) {
      const waitMs = p === 'xhs' ? Math.max(0, Number(o.waitMs) || 0) : 0;
      const got = await readPlatform(p, o.winId, o.onStep, {
        waitMs, holdTab: waitMs > 0, shouldStop: o.shouldStop, onLoginWait: o.onLoginWait,
      });
      if (got.status !== 'ok') {
        results[p] = {
          status: got.status, saw: got.saw || null, at: Date.now(), error: got.error || '',
          timeout: !!got.timeout, waitMin: Number(got.waitMin) || 0,
        };
        continue;   // holdTab 时检查页留在原地：没登录/读不出来都给人看
      }
      const j = await post('/api/exec/bind', { platform: p, binding: got.saw });
      if (j && j.bindings) await setBindings(j.bindings);
      results[p] = {
        status: j && j.ok ? 'ok' : 'mismatch',
        saw: got.saw, at: Date.now(),
        error: (j && j.error) || '',
      };
      /* 对上号才收检查页；服务器拒了（撞号/换号）就留着让人看清现在登的是哪个号 */
      if (got.tabId && results[p].status === 'ok') {
        await closeTab(got.tabId);
        await forgetTab();
      }
    }
    /* 按了停手/等待中被关页：不算这个平台的认号结论，别写进服务器 */
    const rep = {};
    for (const p of Object.keys(results)) {
      if (results[p].status !== 'stopped') rep[p] = results[p];
    }
    if (Object.keys(rep).length) await post('/api/exec/bind-report', { results: rep });
    await saveCache(o.cacheKey, results);
    await setState(results);
    return results;
  }

  /* ── 开窗时：按绑定的号核一遍；没绑的平台不查也不开页。
     opts.waitLoginMs > 0：小红书没登录就留页等人扫码，扫上自动接着核 ── */
  async function checkPlatforms(platforms, opts) {
    const o = opts || {};
    if (!o.force) {
      const cached = await readCache(o.cacheKey);
      /* 同一窗口里先查过一家、后一单要查两家：只缓存了一家的结论不能整份端上来，
         缺的那家必须真去页面看一遍 */
      if (cached && platforms.every((p) => Object.prototype.hasOwnProperty.call(cached, p))) return cached;
    }
    const bindings = await getBindings();
    const results = {};
    const report = {};
    for (const p of platforms) {
      const b = bindings[p];
      if (!b || !(b.uid || b.displayId)) { results[p] = { status: 'unbound', at: Date.now() }; continue; }
      const waitMs = p === 'xhs' ? Math.max(0, Number(o.waitLoginMs) || 0) : 0;
      const got = await readPlatform(p, o.winId, o.onStep, {
        waitMs, holdTab: waitMs > 0, shouldStop: o.shouldStop, onLoginWait: o.onLoginWait,
      });
      if (got.status !== 'ok') {
        results[p] = {
          status: got.status, saw: got.saw || null, at: Date.now(), error: got.error || '',
          timeout: !!got.timeout, waitMin: Number(got.waitMin) || 0,
        };
      } else {
        const same = (b.uid && got.saw.uid) ? b.uid === got.saw.uid
          : (!!b.displayId && b.displayId === got.saw.displayId);
        results[p] = { status: same ? 'ok' : 'mismatch', saw: got.saw, at: Date.now() };
        if (same && waitMs && o.onStep) {
          o.onStep('认号：对上了（' + (got.saw.displayId || got.saw.uid) + '）——接着干这一单');
        }
      }
      /* 检查页：对上号自己收掉；没登录/超时/错号/叫停都留着给人看 */
      if (got.tabId && (results[p].status === 'ok' || results[p].status === 'unknown')) {
        await closeTab(got.tabId);
        await forgetTab();
      }
      /* 等扫码期间不往网页报「没登录」：网页会喊「回去重新点开始」，跟自动续跑打架。
         最终超时由这一单的失败回执带 needLogin 报。 */
      const silent = !!waitMs && (results[p].status === 'loggedout' || results[p].status === 'stopped');
      if (results[p].status !== 'unbound' && !silent) report[p] = results[p];
    }
    if (Object.keys(report).length) {
      const j = await post('/api/exec/bind-report', { results: report });
      if (j && j.bindState) { /* 服务器只记账，不改本机 */ }
    }
    /* 只有「都对上 / 本来就没绑」才记成这个窗口的结论。对不上/没登录不缓存——
       客户换回正确号重新点开始，下一趟必须真的再看一眼，不能被上一次的错账挡住。 */
    const clean = platforms.every((p) => {
      const s = results[p] && results[p].status;
      return s === 'ok' || s === 'unbound';
    });
    if (clean) await saveCache(o.cacheKey, results);
    else await clearCache();
    await setState(Object.assign({}, await getState(), results));   // 两家分开查时不把另一家的结论擦掉
    return results;
  }

  /* 这一单要用哪个平台：发布按 params.platform，其余小红书活按 xhs */
  function platformOf(cmd) {
    if (!cmd) return '';
    if (cmd.kind === 'note_publish') return String((cmd.params && cmd.params.platform) || 'xhs');
    if (['acquire', 'daily_browse', 'leads', 'batch_send'].includes(cmd.kind)) return 'xhs';
    return '';
  }
  /* 发布单可能同时发几家（2026-10-24）：带 platforms 数组就全查；老单回落单平台 */
  function platformsOf(cmd) {
    if (!cmd) return [];
    if (cmd.kind === 'note_publish') {
      const arr = Array.isArray(cmd.params && cmd.params.platforms)
        ? cmd.params.platforms.map((x) => String((x && x.platform) || x || '')).filter(Boolean)
        : [];
      return arr.length ? Array.from(new Set(arr)) : [String((cmd.params && cmd.params.platform) || 'xhs')];
    }
    return [platformOf(cmd)].filter(Boolean);
  }

  function blockReason(platform, r) {
    if (!r || !platform) return '';
    const label = LABEL[platform] || platform;
    if (r.status === 'mismatch') {
      const saw = (r.saw && (r.saw.displayId || r.saw.uid)) || '另一个号';
      return `${label}号对不上：这台浏览器现在登录的是 ${saw}——换回绑定号登录，或找给你网址的人换绑`;
    }
    if (r.status === 'stopped') return '你按了停这一趟——这单先停了';
    if (r.status === 'loggedout') {
      if (r.timeout) {
        const mins = Number(r.waitMin) || 10;
        return `等了 ${mins} 分钟没扫码——这单先停了。在干活窗口登录好${label}，再点开始`;
      }
      return `${label}没登录——在干活窗口登录好再点开始`;
    }
    if (r.status === 'noperm') return `没给${label}网页权限——打开执行器面板点「认一下${label}」`;
    if (r.status === 'unknown') return `${label}认号没读出来（${(r && r.error) || '页面没就绪'}）——再点一次开始试试`;
    if (r.status === 'unbound') return `这个号还没认${label}号——打开执行器面板点「认一下${label}」`;
    return '';
  }

  /* 缓存：同一个干活窗口只认一次。key 由调用方给（win:<id> / leads） */
  async function readCache(key) {
    if (!key) return null;
    try {
      const area = chrome.storage.session || chrome.storage.local;
      const d = await area.get(K_CACHE);
      const c = d && d[K_CACHE];
      return c && c.key === key ? c.results : null;
    } catch (_) { return null; }
  }
  async function saveCache(key, results) {
    if (!key) return;
    try {
      const area = chrome.storage.session || chrome.storage.local;
      await area.set({ [K_CACHE]: { key, results, at: Date.now() } });
    } catch (_) {
      try { await chrome.storage.local.set({ [K_CACHE]: { key, results, at: Date.now() } }); } catch (_) {}
    }
  }
  async function clearCache() {
    try { await chrome.storage.session.remove(K_CACHE); } catch (_) {}
    try { await chrome.storage.local.remove(K_CACHE); } catch (_) {}
  }

  self.AcctCheck = {
    getBindings, setBindings, bindPlatforms, checkPlatforms,
    getState, platformOf, platformsOf, blockReason, clearCache,
    requestDouyinPermission: () => chrome.permissions.request({ origins: DOUYIN_ORIGINS }),
    hasDouyinPermission: () => chrome.permissions.contains({ origins: DOUYIN_ORIGINS }).catch(() => false),
  };
})();
