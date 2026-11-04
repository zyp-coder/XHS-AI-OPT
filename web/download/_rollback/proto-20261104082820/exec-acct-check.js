/* exec-acct-check.js — 平台认号（2026-10-23；视频号 2026-10-26 接入）
 *
 * 一个网页账号在每个平台锁一个号：
 *   · 小红书：打开本人「我的」主页，读 小红书号 + 主页内部 id
 *   · 抖音：打开 www.douyin.com/user/self，读本人 isLogin 段里的 抖音号 + uid/secUid
 *   · 视频号：打开 channels.weixin.qq.com/platform，读页面里的号 id / 昵称（优先站内 id，读不到用昵称）
 *
 * 什么时候查（2026-10-23 定，10-26 补视频号）：挂线时各认一次；之后每开一次干活窗口，用到的平台各认一遍；
 * 同一个窗口里跑多久都不再重复查。视频号每次真发前再核一遍（页面内读，不开新页）。
 * 查不到/对不上＝那个平台停手，别家照跑。
 *
 * 注意：抖音页面里混着别人的 secUid，只能认「本人已登录」那一段 JSON，不能抓页面上第一个。
 */
(() => {
  'use strict';

  const K_BINDINGS = 'ex.bindings';
  const K_CACHE = 'ex.acctCheck';
  const K_ACCT_TAB = 'ex.acctTab';
  const LABEL = { xhs: '小红书', douyin: '抖音', channels: '视频号' };
  const DOUYIN_ORIGINS = ['https://www.douyin.com/*'];
  const CHANNELS_ORIGINS = ['https://channels.weixin.qq.com/*'];
  const CHANNELS_HOME = 'https://channels.weixin.qq.com/platform';
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
  /* 只看页面自己给的登录信号。以前拿「不在自己主页且没有主页链接」当没登录——
     登录缓存读不到时会误判，现在由认号流程报「没认上」。 */
  function isLoggedOut(info) {
    if (!info || !info.ok) return false;
    return !!info.needLogin;
  }
  function mmss(ms) {
    const s = Math.max(0, Math.round(Number(ms) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* 手开兜底：干活窗口里已经开着的本人主页 → 就地读，不跳页。
     判据：有「编辑资料」＝硬标记；没有的话要页面像本人（无关注/私信按钮）且隔一会儿再看还是像，
     防别人的主页按钮还没画出来时误认。给了 selfUid 就还要 uid 对得上。 */
  async function readOpenedOwnProfile(winId, selfUid) {
    let tabs = [];
    try { tabs = await chrome.tabs.query(winId ? { windowId: winId } : {}); } catch (_) { return null; }
    for (const t of tabs) {
      if (!t || typeof t.id !== 'number') continue;
      if (!/^https?:\/\/(www\.)?xiaohongshu\.com\/user\/profile\//.test(String(t.url || ''))) continue;
      let info = await askWho(t.id);
      if (!info || !info.ok) continue;
      if (!info.xhsId && !info.uid) continue;
      if (selfUid && String(info.uid || '') !== String(selfUid)) continue;
      if (!info.editBtn) {
        if (!info.looksOwn) continue;
        await sleep(900);
        info = await askWho(t.id);
        if (!info || !info.ok || !info.looksOwn || info.followBtn) continue;
      }
      return { displayId: String(info.xhsId || ''), uid: String(info.uid || ''), name: String(info.name || '') };
    }
    return null;
  }

  /* ── 小红书：本人主页 → 小红书号 + 内部 id ──
     先定「我是谁」（站内「我」入口 / 本人主页的「编辑资料」/ 登录缓存），再打开这个 id 的主页核对；
     定不出自己、或对不上，就报「没认上」让人手开主页——绝不拿推荐流里的链接当自己（10-25 修）。
     opts.waitMs > 0：没登录就把登录页留着、把窗端到前面等扫码；扫上了自动接着读号。
     opts.holdTab：这张检查页由调用方决定收还是留（对上号收，没登录/错号/超时留给人看）。 */
  async function readXhs(winId, onStep, opts) {
    const o = opts || {};
    const waitMs = Math.max(0, Number(o.waitMs) || 0);
    const hold = !!o.holdTab;
    const NEED_MANUAL = '没认上：先在干活窗口里打开你自己小红书的「我的」主页，再点一次「认一下」';
    /* 已经手开着本人主页（有「编辑资料」）：就地读，先别开页——否则点第二次会把这张页跳走 */
    const opened = await readOpenedOwnProfile(winId);
    if (opened) return { status: 'ok', saw: opened, tabId: 0 };
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

      /* 定「我是谁」：页面自报 → 点站内「我」跳过去再读一遍 */
      let selfUid = String(info.selfUid || '');
      let selfSrc = String(info.selfSrc || '');
      if (!selfUid) {
        const r = await sendTab(tab.id, { action: 'openMine' }, 5000);
        if (r && r.clicked) {
          await tabComplete(tab.id, 20000);
          await sleep(1200);
          const got = await askWho(tab.id);
          if (got && got.ok) { info = got; selfUid = String(got.selfUid || ''); selfSrc = String(got.selfSrc || ''); }
        }
      }

      /* 认不出自己：不绑、不猜；干活窗口里要是手开着本人主页，就地读 */
      if (!selfUid) {
        const manual = await readOpenedOwnProfile(winId);
        if (manual) return { status: 'ok', saw: manual, tabId: hold ? tab.id : 0 };
        return { status: 'unknown', needManual: true, error: NEED_MANUAL, tabId: hold ? tab.id : 0 };
      }

      /* 打开这个 id 的主页核对：内部 id 要对上，且得是本人页（有「编辑资料」）或 id 来自站内「我」入口 */
      if (onStep) onStep('认号：打开小红书「我的」主页…');
      try { await chrome.tabs.update(tab.id, { url: 'https://www.xiaohongshu.com/user/profile/' + selfUid }); } catch (_) {}
      await tabComplete(tab.id, 25000);
      await sleep(1200);

      const retryUntil = Date.now() + (waitMs ? READ_RETRY_MS : 15000);
      let last = null;
      while (true) {
        const got = await askWho(tab.id);
        if (got && got.ok) {
          last = got;
          const sameId = String(got.uid || '') === selfUid;
          if (sameId && (got.looksOwn || selfSrc === 'nav') && (got.xhsId || got.name)) {
            return {
              status: 'ok',
              saw: { displayId: String(got.xhsId || ''), uid: selfUid, name: String(got.name || '') },
              tabId: hold ? tab.id : 0,
            };
          }
          if (isLoggedOut(got)) return { status: 'loggedout', error: '小红书没登录', tabId: hold ? tab.id : 0 };
        }
        if (Date.now() >= retryUntil) break;
        await sleep(1000);
      }

      const manual = await readOpenedOwnProfile(winId, selfUid);
      if (manual) return { status: 'ok', saw: manual, tabId: hold ? tab.id : 0 };
      const why = last && last.uid && String(last.uid) !== selfUid
        ? '打开的主页和登录的不是同一个号'
        : '没读到小红书号';
      return { status: 'unknown', needManual: true, error: NEED_MANUAL + '（' + why + '）', tabId: hold ? tab.id : 0 };
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

  /* ── 视频号：后台就是本人会话，登着谁就是谁 ──
     先找页面内嵌数据里的稳定编号（改名也不影响）；找不到才退到顶栏昵称。
     两样都没有就报「没认上」并把手边看到的名字带回去，绝不自己挑一个。 */
  const CH_READ = () => {
    const out = { login: false, displayId: '', uid: '', name: '', how: '', cands: [] };
    const url = String(location.href || '');
    let text = '';
    try { text = (document.body ? document.body.innerText : '').slice(0, 8000); } catch (_) {}
    if (/(^|\/\/)([^/]*\.)?(login|sso)\b/i.test(url) || /扫码登录|请使用微信扫码|微信扫码登录|登录后查看/.test(text)) return out;
    out.login = true;

    let html = '';
    try { html = document.documentElement ? document.documentElement.innerHTML : ''; } catch (_) {}
    const norm = html.replace(/\\"/g, '"');
    for (const k of ['finderId', 'finder_id', 'finderUsername', 'wxUsername', 'wx_username', 'exportId', 'export_id']) {
      const m = norm.match(new RegExp('"' + k + '"\\s*:\\s*"?([A-Za-z0-9_-]{4,64})"?'));
      if (m) { out.uid = m[1]; out.how = 'state:' + k; break; }
    }

    const BAD = /^(首页|内容管理|数据中心|互动管理|设置|发表|创建|视频号助手|通知|消息|帮助|退出|登录|切换账号|账号|我的|搜索|全部|暂无数据|加载中|视频号|评论|粉丝|动态)$/;
    const cands = [];
    const push = (s, why) => {
      const t = String(s || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 30 || BAD.test(t)) return;
      if (/^[\d\s:：%.,-]+$/.test(t)) return;
      if (cands.some((c) => c.t === t)) return;
      cands.push({ t: t, why: why });
    };
    try {
      for (const el of document.querySelectorAll('[class*="nick" i],[class*="account-name" i],[class*="accountName" i],[class*="user-name" i],[class*="username" i]')) {
        if (!el || el.offsetWidth < 1) continue;
        push(el.textContent, 'cls');
        if (cands.length >= 6) break;
      }
    } catch (_) {}
    if (!cands.length) {
      try {
        const W = window.innerWidth || 1280;
        for (const el of document.querySelectorAll('body *')) {
          if (el.children && el.children.length) continue;
          const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          if (!r || r.width < 1 || r.height < 1) continue;
          if (r.top > 90 || r.left < W * 0.55) continue;
          push(el.textContent, 'topright');
          if (cands.length >= 6) break;
        }
      } catch (_) {}
    }
    out.cands = cands.slice(0, 4).map((c) => c.t);
    const named = cands.find((c) => c.why === 'cls') || cands[0] || null;
    out.name = named ? named.t : '';
    if (named && !out.how) out.how = 'dom:' + named.why;
    out.displayId = out.uid || out.name;
    return out;
  };

  /* 在一张已经开着的视频号页上读身份（发布前核号用，不开新页） */
  async function readChannelsOn(tabId) {
    let got = null;
    for (let i = 0; i < 12; i++) {
      got = await runJs(tabId, CH_READ);
      if (got && (got.name || got.uid || !got.login)) break;
      await sleep(900);
    }
    return got || null;
  }

  async function readChannels(winId, onStep, opts) {
    const o = opts || {};
    let has = false;
    try { has = await chrome.permissions.contains({ origins: CHANNELS_ORIGINS }); } catch (_) { has = false; }
    if (!has) return { status: 'noperm', error: '没给视频号网页权限' };
    if (onStep) onStep('认号：打开视频号后台…');
    const tab = await openTab(winId, CHANNELS_HOME);
    try {
      const got = await readChannelsOn(tab.id);
      if (!got) return { status: 'unknown', error: '视频号后台没回话', tabId: o.holdTab ? tab.id : 0 };
      if (!got.login) {
        if (o.holdTab) focusTab(tab);
        return { status: 'loggedout', error: '视频号没登录', tabId: o.holdTab ? tab.id : 0 };
      }
      const saw = { displayId: String(got.displayId || ''), uid: String(got.uid || ''), name: String(got.name || '') };
      if (!saw.displayId) {
        const seen = (got.cands && got.cands.length) ? '（看到：' + got.cands.join(' / ') + '）' : '';
        return { status: 'unknown', error: '没读到视频号名字' + seen, tabId: o.holdTab ? tab.id : 0 };
      }
      return { status: 'ok', saw: saw, tabId: o.holdTab ? tab.id : 0 };
    } finally {
      if (!o.holdTab) await closeTab(tab.id);
    }
  }

  async function readPlatform(platform, winId, onStep, opts) {
    try {
      if (platform === 'xhs') return await readXhs(winId, onStep, opts);
      if (platform === 'douyin') return await readDouyin(winId, onStep);
      if (platform === 'channels') return await readChannels(winId, onStep, opts);
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
      const hold = waitMs > 0 || (p === 'channels' && !!o.holdOnBad);
      const got = await readPlatform(p, o.winId, o.onStep, {
        waitMs, holdTab: hold, shouldStop: o.shouldStop, onLoginWait: o.onLoginWait,
      });
      if (got.status !== 'ok') {
        results[p] = {
          status: got.status, saw: got.saw || null, at: Date.now(), error: got.error || '',
          timeout: !!got.timeout, waitMin: Number(got.waitMin) || 0, needManual: !!got.needManual,
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
          timeout: !!got.timeout, waitMin: Number(got.waitMin) || 0, needManual: !!got.needManual,
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
    const manualHint = platform === 'channels'
      ? `先在机器上打开视频号后台、用微信扫码登录好，再点一次「认一下视频号」`
      : `先在干活窗口打开你自己${label}的「我的」主页，再点一次「认一下${label}」`;
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
    if (r.status === 'unknown') {
      if (r.needManual) return `${label}认号没读出来——${manualHint}`;
      return `${label}认号没读出来（${(r && r.error) || '页面没就绪'}）——再点一次开始试试`;
    }
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
    readChannelsOn,
    requestDouyinPermission: () => chrome.permissions.request({ origins: DOUYIN_ORIGINS }),
    hasDouyinPermission: () => chrome.permissions.contains({ origins: DOUYIN_ORIGINS }).catch(() => false),
    requestChannelsPermission: () => chrome.permissions.request({ origins: CHANNELS_ORIGINS }),
    hasChannelsPermission: () => chrome.permissions.contains({ origins: CHANNELS_ORIGINS }).catch(() => false),
  };
})();
