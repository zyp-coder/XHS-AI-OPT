/* exec-workwin.js — 干活专用窗口 + 整页锁 + 一次性通行证（2026-10-21 换手第一段）
 *
 * 三件事：
 *   ① 干活开一个专用窗口：1280×820、屏幕居中；一趟只开一个，干完不关——页面交回给人，
 *      下一趟活来了复用同一扇窗（只有登录过期那一趟扫完码才收窗）。
 *      机器人自己开的小红书页，在干活期间都被挪进这个窗；窗里换页不另开窗。
 *      （浏览器只允许标签在普通窗口之间挪动，弹出式小窗接不住机器人开的页，
 *      所以这里是普通窗口；地址栏/标签栏拦不死，靠整页锁和一次性通行证兜住。）
 *   ② 平台页整页上锁：点、打字、滚动、右键都不生效（只挡人手：isTrusted=true 才拦，
 *      机器人自己的程序化点击照走）。被碰次数记进这一单的回执。
 *   ③ 内部页一次性通行证：?t=<票> 换页用，用一次就作废；手工改网址、旧的 ?aw=1 一律进不来。
 *
 * 浏览器做不到的（不对外承诺）：窗口置顶、拦住关浏览器/杀扩展、拦住切窗口和浏览器快捷键。
 * 关窗口＝当场回报并收队；关浏览器/杀扩展＝心跳断，服务器按掉线处理。
 */
(() => {
  'use strict';

  const WIN_W = 1280;
  const WIN_H = 820;
  const TICKET_TTL = 10 * 60 * 1000;     // 一张票 10 分钟内得用掉
  const HUMAN_WAIT = 5 * 60 * 1000;      // 人工处理最多等 5 分钟
  const LOGIN_WAIT = 10 * 60 * 1000;     // 登录过期：窗口留着让人扫码，最多等 10 分钟
  const K_WIN = 'ex.workWinId';
  const K_TICKETS = 'ex.tickets';
  const K_TASK = 'ex.workTask';

  let workWinId = 0;
  let task = null;
  let closingByUs = false;
  let closeTimer = null;
  let abortHandler = null;
  let loginHandler = null;
  let loginDoneHandler = null;
  let reporter = null;
  let lastPushAt = 0;
  let interrupted = null;   // 服务线程重启前没干完的那一单（外壳取走、按失败回报）

  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isPlatform = (url) => /^https?:\/\/([^/]+\.)?xiaohongshu\.com\//i.test(String(url || ''));

  /* session 存储：Chrome/Edge 102+ 有 session；老一点退回 local 加前缀（票本来就有期限） */
  const session = {
    async get(k) {
      try { return (await chrome.storage.session.get(k))[k]; }
      catch (_) { return (await chrome.storage.local.get('__s_' + k))['__s_' + k]; }
    },
    async set(obj) {
      try { await chrome.storage.session.set(obj); }
      catch (_) {
        const o = {};
        for (const k of Object.keys(obj)) o['__s_' + k] = obj[k];
        await chrome.storage.local.set(o);
      }
    },
    async remove(k) {
      try { await chrome.storage.session.remove(k); }
      catch (_) { await chrome.storage.local.remove('__s_' + k); }
    },
  };

  function reportLine(text) {
    try { if (reporter) reporter(String(text || '')); } catch (_) {}
    try { console.log('[干活窗口] ' + text); } catch (_) {}
  }

  /* ── 屏幕中央、看得见的整块工作区 ── */
  async function workArea() {
    try {
      if (chrome.system && chrome.system.display && chrome.system.display.getInfo) {
        const list = await chrome.system.display.getInfo();
        const p = list.find((x) => x.isPrimary) || list[0];
        if (p && p.workArea) return p.workArea;
      }
    } catch (_) {}
    try {
      const w = await chrome.windows.getLastFocused();
      if (w && w.width && w.height) return { left: w.left || 0, top: w.top || 0, width: w.width, height: w.height };
    } catch (_) {}
    return { left: 0, top: 0, width: WIN_W, height: WIN_H };
  }

  async function targetBounds() {
    const a = await workArea();
    const width = Math.max(960, Math.min(WIN_W, a.width - 40));
    const height = Math.max(640, Math.min(WIN_H, a.height - 40));
    return {
      left: Math.round(a.left + (a.width - width) / 2),
      top: Math.round(a.top + (a.height - height) / 2),
      width, height,
    };
  }

  async function ensureWindow(opts) {
    await bootReady;
    const b = await targetBounds();
    let win = null;
    if (workWinId) {
      try { win = await chrome.windows.get(workWinId); } catch (_) { workWinId = 0; }
    }
    if (!win) {
      const stored = Number(await session.get(K_WIN)) || 0;
      if (stored) {
        try { win = await chrome.windows.get(stored); workWinId = stored; }
        catch (_) { workWinId = 0; await session.remove(K_WIN); }
      }
    }
    if (win) {
      try {
        await chrome.windows.update(win.id, {
          state: 'normal', left: b.left, top: b.top, width: b.width, height: b.height,
          focused: !(opts && opts.focus === false),
        });
        return win.id;
      } catch (_) { workWinId = 0; }
    }
    const created = await chrome.windows.create({
      type: 'normal',
      focused: !(opts && opts.focus === false),
      left: b.left, top: b.top, width: b.width, height: b.height,
      url: chrome.runtime.getURL('work-idle.html'),
    });
    workWinId = created.id;
    await session.set({ [K_WIN]: workWinId });
    return workWinId;
  }

  /* 往专用窗里开一个页：占位页还在就顶替它；同一地址已开着就切过去并换新票 */
  async function openTab(url, opts) {
    const focus = !(opts && opts.focus === false);
    const winId = await ensureWindow({ focus });
    let tabs = [];
    try { tabs = await chrome.tabs.query({ windowId: winId }); } catch (_) {}
    const bare = String(url || '').split('#')[0];
    const same = tabs.find((t) => String(t.url || '').split('#')[0] === bare);
    if (same) {
      await chrome.tabs.update(same.id, { url, active: focus });
      return await chrome.tabs.get(same.id);
    }
    const idle = tabs.find((t) => String(t.url || '').includes('work-idle.html'));
    if (idle && tabs.length === 1) {
      await chrome.tabs.update(idle.id, { url, active: focus });
      return await chrome.tabs.get(idle.id);
    }
    return await chrome.tabs.create({ windowId: winId, url, active: focus });
  }

  async function closeWindow() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    const id = workWinId || Number(await session.get(K_WIN)) || 0;
    if (!id) { task = null; await session.remove(K_TASK); return; }
    closingByUs = true;
    try { await chrome.windows.remove(id); } catch (_) {}
    workWinId = 0;
    await session.remove(K_WIN);
    await session.remove(K_TASK);
    task = null;
    setTimeout(() => { closingByUs = false; }, 1500);
  }

  function closeAfter(ms) {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeWindow(); }, Math.max(0, Number(ms) || 0));
  }

  /* ── 任务状态 ── */
  async function beginTask(kind, meta) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (task && task.humanPoll) clearInterval(task.humanPoll);
    if (task && task.loginPoll) clearInterval(task.loginPoll);
    if (task && task.loginTimer) clearTimeout(task.loginTimer);
    await tidyHandedOver();
    task = {
      id: 'wt_' + Math.random().toString(16).slice(2, 10),
      kind: String(kind || ''),
      label: String((meta && meta.label) || kind || ''),
      startedAt: now(),
      state: 'running',
      step: '正在准备…',
      count: '',
      result: '',
      touchByTab: {},
      touch: 0,
      focusLost: 0,
      humanCount: 0,
      humanTab: 0,
      humanPoll: null,
      humanTimer: null,
      humanJustDone: 0,
      loginPoll: null,
      loginTimer: null,
      loginTab: 0,
      closeOnHumanDone: false,
      pendingFinish: null,
      failed: false,
      handedOver: false,
      locked: [],
      tabs: [],
      born: {},
      completed: false,
      aborted: false,
      abortReason: '',
    };
    await session.set({
      [K_TASK]: {
        id: task.id, kind: task.kind, label: task.label,
        cmdId: String((meta && meta.cmdId) || ''), startedAt: task.startedAt,
      },
    });
    await ensureWindow({ focus: true });
    broadcast();
    return task;
  }

  function getStats() {
    if (!task) return null;
    return {
      touch: Number(task.touch) || 0,
      focusLost: Number(task.focusLost) || 0,
      human: Number(task.humanCount) || 0,
      closed: !!task.aborted,
    };
  }

  function broadcast() {
    try {
      chrome.runtime.sendMessage({
        type: 'ex.work.step',
        state: task ? task.state : 'idle',
        step: task ? task.step : '',
        count: task ? task.count : '',
        result: task ? task.result : '',
        touch: task ? task.touch : 0,
      }).catch(() => {});
    } catch (_) {}
  }

  async function setStep(step, count) {
    if (!task) return;
    if (step != null) task.step = String(step);
    if (count != null) task.count = String(count);
    const t = now();
    if (t - lastPushAt < 900) return;
    lastPushAt = t;
    if (task.locked.length) {
      const payload = { step: task.step, count: task.count };
      for (const id of task.locked.slice()) pushLock(id, 'lock', payload);
    }
    broadcast();
  }

  /* ── 上锁 / 解锁 ──
     页面在导航/主线程卡死时 executeScript 可能一直不回：3 秒等不到就放手，
     不能因为一页没回话把整扇窗的收尾（放锁、交还给人）拖住。 */
  async function pushLock(tabId, mode, payload) {
    let timer = 0;
    try {
      await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId },
          func: lockPage,
          args: [mode, payload || {}],
        }),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('页面 3 秒没回话')), 3000); }),
      ]);
      return true;
    } catch (e) {
      console.warn('[干活窗口] 页面锁' + (mode === 'remove' ? '没解开' : '没挂上') + ' tab=' + tabId + '：' + ((e && e.message) || e));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function lockTab(tabId) {
    if (!task || tabId == null) return false;
    const ok = await pushLock(tabId, 'lock', { step: task.step, count: task.count });
    if (!ok) return false;
    if (!task.locked.includes(tabId)) task.locked.push(tabId);
    if (!task.tabs.includes(tabId)) task.tabs.push(tabId);
    return true;
  }

  async function unlockTab(tabId, mode, payload) {
    return await pushLock(tabId, mode, payload || {});
  }

  async function unlockAll() {
    if (!task) return;
    for (const id of task.locked.slice()) {
      try { await unlockTab(id, 'remove', {}); } catch (_) {}
    }
    task.locked = [];
  }

  /* 人工这一步：只放开平台页，工作台照样盖着 */
  async function humanRequired(reason, closeAfterHuman) {
    if (!task) return;
    if (task.humanJustDone && now() - task.humanJustDone < 30000) {
      task.failed = true;
      await finish(false, String(reason || '要你本人处理') + '（这一步你已处理，重新上锁）');
      return;
    }
    task.state = 'human';
    task.humanReason = String(reason || '要你本人处理');
    task.closeOnHumanDone = !!closeAfterHuman;
    if (closeAfterHuman) task.failed = true;
    task.humanCount++;

    let tabId = 0;
    try {
      const [active] = await chrome.tabs.query({ active: true, windowId: workWinId });
      if (active && isPlatform(active.url)) tabId = active.id;
    } catch (_) {}
    if (!tabId && task.tabs.length) tabId = task.tabs[task.tabs.length - 1];
    if (!tabId && task.locked.length) tabId = task.locked[0];
    task.humanTab = tabId || 0;

    if (tabId) await unlockTab(tabId, 'unlock', { reason: task.humanReason });
    startHumanPoll();
    if (task.humanTimer) clearTimeout(task.humanTimer);
    task.humanTimer = setTimeout(async () => {
      if (!task || task.state !== 'human') return;
      stopHumanPoll();
      task.humanTab = 0;
      reportLine('⏳ 人工这一步等了 5 分钟没处理完——这一单不记为成功；窗不关，页面留在这儿给你接着看');
      await finish(false, '人工处理超时', true);
    }, HUMAN_WAIT);

    broadcast();
    reportLine('🔓 ' + task.humanReason + '——锁暂时解开：这一步只让你本人处理，处理完自动再锁');
  }

  /* 登录过期：机器人当场停手，平台页解锁并切到前台让人扫码；窗口最多留 10 分钟。
     和验证码不同——验证码处理完接着干；登录过期这一单已经回报失败了，登录好后由人重新点开始。 */
  async function loginRequired(reason, tabId) {
    if (!task || task.state === 'login' || task.state === 'loginDone' || task.aborted) return;
    task.state = 'login';
    task.humanReason = String(reason || '小红书登录过期（要扫码）');
    task.failed = true;
    task.loginTab = 0;
    try {
      const [active] = await chrome.tabs.query({ active: true, windowId: workWinId });
      if (active && isPlatform(active.url)) task.loginTab = active.id;
    } catch (_) {}
    if (!task.loginTab && tabId) task.loginTab = tabId;
    if (!task.loginTab && task.tabs.length) task.loginTab = task.tabs[task.tabs.length - 1];
    if (!task.loginTab && task.locked.length) task.loginTab = task.locked[0];
    if (task.loginTab) {
      try { await chrome.tabs.update(task.loginTab, { active: true }); } catch (_) {}
      await unlockTab(task.loginTab, 'unlock', { reason: task.humanReason });
    }
    try { if (workWinId) await chrome.windows.update(workWinId, { focused: true }); } catch (_) {}
    startLoginPoll();
    if (task.loginTimer) clearTimeout(task.loginTimer);
    task.loginTimer = setTimeout(async () => {
      if (!task || task.state !== 'login') return;
      reportLine('⏳ 登录等了 10 分钟还没好——关窗；这一单已经按「登录过期」回报过，不记为成功');
      try { await finish(false, '登录等待超时', true); } catch (_) {}
    }, LOGIN_WAIT);
    broadcast();
    reportLine('🔐 ' + task.humanReason + '——机器人停手了：请在这个窗口扫码登录；登录好后窗口会自动关，回去重新点开始');
    try { if (loginHandler) loginHandler(task.humanReason); } catch (_) {}
  }

  function startLoginPoll() {
    if (!task) return;
    stopLoginPoll();
    task.loginPoll = setInterval(async () => {
      if (!task || task.state !== 'login' || !task.loginTab) return;
      const tabId = task.loginTab;
      try {
        const t = await chrome.tabs.get(tabId);
        if (!t || t.status !== 'complete' || !isPlatform(t.url)) return;
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: humanStillNeeded,
        });
        if (r && r.result === false) await loginDone(tabId);
      } catch (_) { /* 页关了 / 换页中：下一拍再看 */ }
    }, 2000);
  }

  function stopLoginPoll() {
    if (task && task.loginPoll) { clearInterval(task.loginPoll); task.loginPoll = null; }
  }

  async function loginDone(tabId) {
    if (!task || task.state !== 'login') return;
    if (task.loginTab && tabId && tabId !== task.loginTab) return;
    stopLoginPoll();
    if (task.loginTimer) { clearTimeout(task.loginTimer); task.loginTimer = null; }
    task.loginTab = 0;
    reportLine('✅ 登录好了——这个窗口马上关；回去重新点开始就行');
    try { if (loginDoneHandler) loginDoneHandler(); } catch (_) {}
    await finish(false, '登录好了，这一单已停；回去重新点开始', true);
  }

  function isLoginWait() {
    return !!(task && (task.state === 'login' || task.state === 'loginDone'));
  }

  function startHumanPoll() {
    if (!task) return;
    stopHumanPoll();
    task.humanPoll = setInterval(async () => {
      if (!task || task.state !== 'human' || !task.humanTab) return;
      const tabId = task.humanTab;
      try {
        const t = await chrome.tabs.get(tabId);
        if (!t || t.status !== 'complete' || !isPlatform(t.url)) return;
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: humanStillNeeded,
        });
        if (r && r.result === false) await humanDone(tabId);
      } catch (_) { /* 页关了 / 换页中：下一拍再看 */ }
    }, 2000);
  }

  function stopHumanPoll() {
    if (task && task.humanPoll) { clearInterval(task.humanPoll); task.humanPoll = null; }
  }

  async function humanDone(tabId) {
    if (!task || task.state !== 'human') return;
    if (task.humanTab && tabId && tabId !== task.humanTab) return;
    stopHumanPoll();
    if (task.humanTimer) { clearTimeout(task.humanTimer); task.humanTimer = null; }
    task.humanTab = 0;
    task.humanJustDone = now();
    const shouldClose = !!task.closeOnHumanDone;
    task.state = 'running';
    for (const id of task.locked.slice()) {
      await unlockTab(id, 'lock', { step: task.step, count: task.count });
    }
    broadcast();
    reportLine(shouldClose
      ? '🔒 人工处理完了，重新上锁；这一单的回执已按失败回报，等服务器重派'
      : '🔒 人工处理完了，重新上锁；机器人接着干');
    const pending = task.pendingFinish;
    task.pendingFinish = null;
    if (pending) { await finish(pending.ok, pending.text); return; }
    if (shouldClose) await finish(false, '人工处理完成，重新上锁');
  }

  /* 收尾不关窗：窗里那几页从「请勿操作」交回给人，顶上留一条结果。
     窗一直留着，直到人自己关掉；下一趟活来了复用这扇窗（见 beginTask → tidyHandedOver）。 */
  async function holdOpen(ok, text) {
    if (!task) return;
    for (const id of task.locked.slice()) {
      let t = null;
      try { t = await chrome.tabs.get(id); } catch (_) {}
      if (!t) continue;
      const inside = t.windowId === workWinId;
      try {
        await unlockTab(id, inside ? 'done' : 'remove',
          inside ? { ok: !!ok, text: String(text || ''), label: task.label || '' } : {});
      } catch (_) {}
    }
    task.locked = [];
    task.handedOver = true;
    broadcast();
    reportLine(ok
      ? '✅ 这趟干完了——窗不关：页面交给你，接着点没人管；下一趟活来了这扇窗自己接着用'
      : '⚠ 这趟停在半路——窗不关：页面留在这儿给你看到哪一步；回工作台再点一次开始');
  }

  /* 上一趟留下的页和那条「这趟完了」：这趟要用同一扇窗，先收干净。
     只收机器人自己开的那几页（人另开的不动），留最后一张不空窗——全关光会把窗一起关掉。 */
  async function tidyHandedOver() {
    if (!task || !task.handedOver) return;
    const prev = task;
    task = null;
    const alive = [];
    for (const id of prev.tabs.slice()) {
      try { await chrome.tabs.get(id); } catch (_) { continue; }
      try { await unlockTab(id, 'remove', {}); } catch (_) {}
      alive.push(id);
    }
    for (let i = 0; i + 1 < alive.length; i++) {
      try { await chrome.tabs.remove(alive[i]); } catch (_) {}
    }
    if (alive.length) reportLine('🧹 上一趟留下的页收了 ' + (alive.length - 1) + ' 张，这扇窗接着用');
  }

  function handedOver() {
    return task && task.handedOver ? { ok: task.state === 'done', text: task.result || '' } : null;
  }

  /* 干完 / 失败：窗不关，页面交回给人（登录过期那一趟例外——扫完码这一单已经停了，收窗让人回工作台重点）。
     赶到"人工这一步还没处理完"时先不收尾（人还在验证码页上），等处理完再走这里。 */
  async function finish(ok, text, force) {
    if (!task) return null;
    if (task.state === 'human' && !force) {
      task.pendingFinish = { ok: !!ok, text: String(text || '') };
      return getStats();
    }
    /* 登录过期：单已经按失败回报了，但窗口不能关——人还要在这里扫码。
       收尾由 loginDone / 10 分钟超时来做（那时 force=true）。 */
    if (task.state === 'login' && !force) {
      task.result = String(text || '');
      task.completed = true;
      broadcast();
      return getStats();
    }
    stopHumanPoll();
    stopLoginPoll();
    if (task.humanTimer) { clearTimeout(task.humanTimer); task.humanTimer = null; }
    if (task.loginTimer) { clearTimeout(task.loginTimer); task.loginTimer = null; }
    const wasLogin = task.state === 'login';
    task.state = ok ? 'done' : 'failed';
    task.result = String(text || '');
    task.completed = true;
    const stats = getStats();
    await session.remove(K_TASK);
    broadcast();
    if (wasLogin) {
      /* 登录过期那条线口径不动：扫完码这一单已经按失败回报了，窗收了，人回工作台重新点开始 */
      for (const id of task.locked.slice()) {
        try { await unlockTab(id, 'remove', {}); } catch (_) {}
      }
      closeAfter(3000);
    } else {
      await holdOpen(ok, task.result);
    }
    return stats;
  }

  function wasAborted() { return !!(task && task.aborted); }
  function abortReason() { return (task && task.abortReason) || ''; }
  function onAbort(fn) { abortHandler = fn; }
  function onLogin(fn) { loginHandler = fn; }
  function onLoginDone(fn) { loginDoneHandler = fn; }
  function setReporter(fn) { reporter = fn; }

  /* ── 一次性通行证 ── */
  async function issueTicket(kind) {
    const raw = new Uint8Array(18);
    crypto.getRandomValues(raw);
    const t = Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');
    let all = {};
    try { all = (await session.get(K_TICKETS)) || {}; } catch (_) {}
    const nowMs = now();
    for (const k of Object.keys(all)) if (!all[k] || all[k].exp < nowMs || all[k].used) delete all[k];
    all[t] = { kind: String(kind || ''), exp: nowMs + TICKET_TTL, createdAt: nowMs };
    await session.set({ [K_TICKETS]: all });
    return t;
  }

  async function consumeTicket(ticket, tabId) {
    const t = String(ticket || '');
    if (!t) return { ok: false };
    let all = {};
    try { all = (await session.get(K_TICKETS)) || {}; } catch (_) { return { ok: false }; }
    const rec = all[t];
    if (!rec || rec.used || rec.exp < now()) return { ok: false, error: '通行证不对或已经用过' };
    rec.used = true;
    rec.usedAt = now();
    rec.tabId = tabId || 0;
    await session.set({ [K_TICKETS]: all });
    return { ok: true, kind: rec.kind || '' };
  }

  /* ── 事件：新页、切页、加载完成、关窗、失焦 ── */
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (!task || !tab || tab.id == null) return;
    if (task.handedOver) return;   // 这趟已经交回给人了：他在窗里点出来的新页别抢、别锁
    task.born[tab.id] = now();
    const url = String(tab.pendingUrl || tab.url || '');
    if (!isPlatform(url)) return;   // 这一下还看不出是什么页：等 onUpdated 有网址了再收
    try { await ensureWindow({ focus: false }); } catch (_) { return; }
    if (tab.windowId !== workWinId) await adoptTab(tab.id);
    await lockTab(tab.id);
  });

  /* 机器人开的平台页，不管先在哪个窗口冒出来，都挪进干活窗口 */
  async function adoptTab(tabId) {
    if (!tabId || !workWinId) return false;
    try {
      await chrome.tabs.move(tabId, { windowId: workWinId, index: -1 });
      return true;
    } catch (_) {
      await sleep(350);
      try { await chrome.tabs.move(tabId, { windowId: workWinId, index: -1 }); return true; }
      catch (_) { return false; }
    }
  }

  chrome.tabs.onActivated.addListener(async (info) => {
    if (!task || !info || !info.tabId) return;
    if (task.handedOver) return;
    try {
      const t = await chrome.tabs.get(info.tabId);
      if (t && t.windowId === workWinId && isPlatform(t.url)) await lockTab(t.id);
    } catch (_) {}
  });

  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (!task || !info || !tab) return;
    if (task.handedOver) return;   // 交回给人了：他在窗里怎么翻都不再上锁
    if (!isPlatform(tab.url)) return;
    if (task.state === 'human' && task.humanTab === tabId) {
      /* 人工处理中换页了：重新给这一页挂"暂时解开"的条，别把登录页锁死 */
      await unlockTab(tabId, 'unlock', { reason: task.humanReason || '要你本人处理' });
      return;
    }
    if (task.state === 'login' || task.state === 'loginDone') {
      /* 等扫码期间不再往任何页上锁：登录页换页 / 跳转都让它保持可操作 */
      if (!task.loginTab || task.loginTab === tabId) task.loginTab = tabId;
      if (tabId === task.loginTab) await unlockTab(tabId, 'unlock', { reason: task.humanReason || '小红书登录过期' });
      return;
    }
    if (info.status !== 'complete') return;
    /* 不是这一单里开的、又不在干活窗里：客户自己的页，别去动 */
    if (!task.born[tabId] && tab.windowId !== workWinId && !task.locked.includes(tabId)) return;
    if (tab.windowId !== workWinId) await adoptTab(tabId);
    await lockTab(tabId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!task) return;
    delete task.born[tabId];
    task.locked = task.locked.filter((x) => x !== tabId);
    task.tabs = task.tabs.filter((x) => x !== tabId);
    if (task.humanTab === tabId) task.humanTab = 0;
  });

  chrome.windows.onRemoved.addListener(async (windowId) => {
    if (!workWinId || windowId !== workWinId) return;
    workWinId = 0;
    await session.remove(K_WIN);
    await session.remove(K_TASK);
    if (task) {
      if (task.loginPoll) { clearInterval(task.loginPoll); task.loginPoll = null; }
      if (task.loginTimer) { clearTimeout(task.loginTimer); task.loginTimer = null; }
    }
    if (task && !task.completed && !closingByUs && task.state !== 'login' && task.state !== 'loginDone') {
      const reason = '窗口被关：这一单停在这一步，服务器按掉线处理，不记为成功；重开浏览器后手会自己挂回来，等服务器重派';
      task.aborted = true;
      task.abortReason = reason;
      stopHumanPoll();
      reportLine('🛑 ' + reason);
      try { if (abortHandler) abortHandler(reason); } catch (_) {}
      const closedTask = task;
      task = null;
      /* 窗外的页解锁（窗里的页已随窗口没了） */
      for (const id of closedTask.locked.slice()) {
        try { await unlockTab(id, 'remove', {}); } catch (_) {}
      }
    } else {
      task = null;
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (!task || task.state !== 'running') return;
    if (!workWinId || windowId === chrome.windows.WINDOW_ID_NONE) return;
    if (windowId === workWinId) return;
    task.focusLost++;
  });

  /* ── 票据走专用端口：exec-core.js 的全局 onMessage 会抢着给"没有 action 的消息"回
        一句"未知 action"，页面只认第一份答复。票据的答复改从这条端口来回，绕开它。 ── */
  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== 'ex-ticket') return;
    port.onMessage.addListener(async (m) => {
      if (!m || m.type !== 'consume') return;
      let r = { ok: false, error: '通行证不对或已经用过' };
      try {
        r = await consumeTicket(m.ticket, port.sender && port.sender.tab && port.sender.tab.id);
      } catch (_) {}
      try { port.postMessage(r); } catch (_) {}
    });
  });

  /* ── 消息：被碰 / 要人（只记状态，不用回话） ── */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'ex.lock.touch') {
      if (task) {
        const tabId = (sender && sender.tab && sender.tab.id) || 0;
        const n = Math.max(0, Number(msg.touch) || 0);
        if (tabId) task.touchByTab[tabId] = Math.max(Number(task.touchByTab[tabId]) || 0, n);
        task.touch = Object.keys(task.touchByTab).reduce((a, k) => a + (Number(task.touchByTab[k]) || 0), 0);
        broadcast();
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'ex.lock.login') {
      const tabId = sender && sender.tab && sender.tab.id;
      if (task && tabId && task.state !== 'human') {
        loginRequired(String(msg.reason || '小红书登录过期（要扫码）'), tabId);
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'ex.lock.human') {
      const tabId = sender && sender.tab && sender.tab.id;
      if (task && task.state !== 'login' && task.state !== 'loginDone'
        && tabId && (tabId === task.humanTab || task.state !== 'human')) {
        humanRequired(String(msg.reason || '验证码 / 登录失效'), false);
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'ex.lock.humanDone') {
      const tabId = sender && sender.tab && sender.tab.id;
      humanDone(tabId);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  /* ── 启动清场：服务线程重启过，上一趟的窗不会再有人收——先清掉，免得留一个锁着的页。
     上一趟没干完的单记下来，外壳开机时会把它按"停在那一步"回报服务器，不假装成功。 ── */
  const bootReady = (async () => {
    try {
      const st = await session.get(K_TASK);
      if (st && st.cmdId) interrupted = st;
      const stored = Number(await session.get(K_WIN)) || 0;
      if (stored) {
        try { await chrome.windows.remove(stored); } catch (_) {}
        await session.remove(K_WIN);
      }
      await session.remove(K_TASK);
    } catch (_) {}
  })();

  async function takeInterrupted() {
    await bootReady;
    const x = interrupted;
    interrupted = null;
    return x;
  }

  /* ── 注入到平台页的整页锁（这段会被序列化，不能引用外面任何变量）── */
  function lockPage(mode, payload) {
    const ROOT_ID = '__xhs_exec_lock_root';
    const BAR_ID = '__xhs_exec_lock_bar';
    const state = window.__XHS_EXEC_LOCK_STATE__ || (window.__XHS_EXEC_LOCK_STATE__ = {
      installed: false, locked: false, human: false, touch: 0, lastTouch: 0,
      origTitle: document.title || '', observer: null, scanTimer: null, scanEvery: null,
      needHuman: false, loginNotified: false,
    });

    function visible(el) {
      try {
        if (!el || el.offsetParent === null) return false;
        const cs = getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      } catch (_) { return false; }
    }

    /* 返回 'login' / 'captcha' / ''。
       小红书的扫码墙实际文案是「登录后查看搜索结果 / 推荐」「扫码」「手机号登录」，
       不是连着写的「扫码登录」——旧判据就是漏在这儿。 */
    function humanKind() {
      const txt = (document.body && document.body.innerText || '').slice(0, 12000);
      if (/登录已过期|登录过期|请重新登录|重新登录|扫码登录|二维码登录|手机号登录|登录后(查看|推荐)|请先登录/.test(txt)) return 'login';
      if (/扫码[\s\S]{0,20}登录|登录[\s\S]{0,20}扫码/.test(txt)) return 'login';
      const loginSel = ['.login-container', '.login-modal', '.login-reason',
        '[class*="login-container"]', '[class*="login-modal"]'];
      for (const s of loginSel) {
        try {
          const el = document.querySelector(s);
          if (!visible(el)) continue;
          const t = String(el.innerText || '').replace(/\s+/g, '');
          if (/扫码|手机号登录|登录后|二维码/.test(t)) return 'login';
        } catch (_) {}
      }
      try {
        if (/(^|\/)(login|website-login)(\/|$)/i.test(location.pathname)) return 'login';
      } catch (_) {}
      if (/安全验证|拖动滑块|请完成验证|人机验证/.test(txt)) return 'captcha';
      const sel = ['#captcha', '.captcha', '[class*="captcha"]', '[class*="red-captcha"]', '[class*="verify-wrap"]'];
      for (const s of sel) {
        try { if (visible(document.querySelector(s))) return 'captcha'; } catch (_) {}
      }
      return '';
    }

    function notify(type, extra) {
      try { chrome.runtime.sendMessage(Object.assign({ type }, extra || {})).catch(() => {}); } catch (_) {}
    }

    function installOnce() {
      if (state.installed) return;
      state.installed = true;
      state.origTitle = document.title || state.origTitle;
      const block = (e) => {
        if (!state.locked || !e.isTrusted) return;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_) {}
        const t = Date.now();
        if (t - state.lastTouch < 700) return;
        state.lastTouch = t;
        state.touch++;
        const tip = document.querySelector('#' + ROOT_ID + ' .xl-tip');
        if (tip) tip.textContent = '挡住了：这一下没生效（第 ' + state.touch + ' 次）';
        notify('ex.lock.touch', { touch: state.touch });
      };
      state.block = block;
      const opts = { capture: true, passive: false };
      ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
        'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keypress', 'keyup',
        'dragstart', 'selectstart'].forEach((ev) => {
        try { window.addEventListener(ev, block, opts); } catch (_) {}
      });
      const scan = () => {
        if (!state.locked && !state.human) return;
        const kind = humanKind();
        if (kind === 'login') {
          state.needHuman = true;
          if (!state.loginNotified) {
            state.loginNotified = true;
            notify('ex.lock.login', { reason: '小红书登录过期（要扫码）' });
          }
          return;
        }
        if (state.loginNotified) state.loginNotified = false;
        if (kind === 'captcha' && !state.needHuman && state.locked) {
          state.needHuman = true;
          notify('ex.lock.human', { reason: '验证码 / 登录失效' });
        } else if (!kind && state.needHuman && state.human) {
          state.needHuman = false;
          notify('ex.lock.humanDone', {});
        }
      };
      state.scan = scan;
      /* 弹窗可能在上锁之前就已经在了（搜索页一打开就是登录墙）——不能只靠 DOM 变化触发。
         上锁后先扫一次，之后每 3 秒补扫，防止漏掉。 */
      try { if (!state.scanEvery) state.scanEvery = setInterval(scan, 3000); } catch (_) {}
      setTimeout(scan, 400);
      const startObserve = () => {
        try {
          if (state.observer) state.observer.disconnect();
          state.observer = new MutationObserver(() => {
            clearTimeout(state.scanTimer);
            state.scanTimer = setTimeout(scan, 600);
          });
          state.observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true, attributes: true, characterData: true,
          });
        } catch (_) {}
      };
      if (document.body) startObserve();
      else document.addEventListener('DOMContentLoaded', startObserve, { once: true });
    }

    function renderLock() {
      let root = document.getElementById(ROOT_ID);
      if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;'
          + 'justify-content:center;background:rgba(10,12,18,.92);color:#e8eaf0;backdrop-filter:blur(2px);'
          + 'font:14px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif;');
        root.innerHTML = '<div style="text-align:center;max-width:560px;padding:24px;">'
          + '<div style="font-size:42px;line-height:1">🖐</div>'
          + '<div style="font-size:13px;color:#9aa3b5;margin-top:14px">机器人正在干活</div>'
          + '<div style="font-size:22px;font-weight:800;margin-top:6px;letter-spacing:.5px">机器人干活中 · 请勿操作</div>'
          + '<div style="font-size:13px;color:#9aa3b5;margin-top:12px">这 2 分钟先别动这个窗口；点、打字、滚动、右键都不生效。</div>'
          + '<div class="xl-step" style="margin-top:20px;font-size:14px;color:#e6e9ef"></div>'
          + '<div class="xl-count" style="font-size:12px;color:#9aa3b5;margin-top:6px"></div>'
          + '<div class="xl-tip" style="font-size:12px;color:#fbbf24;margin-top:14px;min-height:18px"></div>'
          + '<div style="font-size:11px;color:#6b7280;margin-top:18px">被碰次数会记进这一单的回执；锁只挡人手，不挡机器人自己的点击。</div>'
          + '</div>';
        (document.body || document.documentElement).appendChild(root);
      }
      const st = root.querySelector('.xl-step');
      if (st) st.textContent = payload && payload.step ? String(payload.step) : '正在准备…';
      const ct = root.querySelector('.xl-count');
      if (ct) ct.textContent = payload && payload.count ? String(payload.count) : '';
      document.title = '机器人干活中 · 请勿操作';
    }

    function removeLock() {
      const root = document.getElementById(ROOT_ID);
      if (root) root.remove();
      /* 标题还原：有些页（纯文本页）本来没标题，不兜一层就把「请勿操作」留在标签上一整轮 */
      if (state.origTitle) document.title = state.origTitle;
      else {
        try { document.title = location.hostname || ''; } catch (_) {}
      }
    }

    function showHumanBar(reason) {
      let bar = document.getElementById(BAR_ID);
      if (!bar) {
        bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:2147483647;'
          + 'background:#b45309;color:#fff;font:13px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
          + 'padding:8px 14px;text-align:center;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.25)');
        (document.body || document.documentElement).appendChild(bar);
      }
      bar.textContent = '🔓 锁暂时解开：这一步只让你本人处理（' + (reason || '要你处理') + '），处理完自动再锁';
    }

    function removeHumanBar() {
      const bar = document.getElementById(BAR_ID);
      if (bar) bar.remove();
    }

    /* 这趟完了把页交回给人：顶上留一条不挡点的结果条（绿＝干完，橙＝停在半路），× 只收这一条 */
    function showDoneBar(payload) {
      const DONE_ID = '__xhs_exec_lock_done';
      const p = payload || {};
      const ok = p.ok !== false;
      let bar = document.getElementById(DONE_ID);
      if (!bar) {
        bar = document.createElement('div');
        bar.id = DONE_ID;
        bar.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:2147483646;'
          + 'display:flex;align-items:center;justify-content:center;gap:10px;pointer-events:none;'
          + 'color:#fff;font:13px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
          + 'padding:9px 40px 9px 16px;box-shadow:0 2px 10px rgba(0,0,0,.22)');
        const txt = document.createElement('span');
        txt.style.cssText = 'min-width:0;';
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.setAttribute('style', 'position:absolute;right:8px;top:50%;transform:translateY(-50%);'
          + 'pointer-events:auto;border:none;background:transparent;color:#fff;font:18px/1 system-ui;cursor:pointer;opacity:.75;');
        x.addEventListener('click', () => { try { bar.remove(); } catch (_) {} });
        bar.appendChild(txt);
        bar.appendChild(x);
        (document.body || document.documentElement).appendChild(bar);
      }
      bar.style.background = ok ? '#0a7b5a' : '#b45309';
      const line = (ok ? '✅ ' : '⚠ ') + (p.label ? '「' + p.label + '」' : '') + (ok ? '这趟干完了' : '这趟停在半路')
        + (p.text ? '：' + String(p.text).replace(/\s+/g, ' ') : '')
        + ' —— 这一页交给你，接着点没人管；下一趟活来了这扇窗自己接着用';
      bar.firstChild.textContent = line;
      bar.title = line;
    }

    function removeDoneBar() {
      const bar = document.getElementById('__xhs_exec_lock_done');
      if (bar) bar.remove();
    }

    installOnce();
    const m = String(mode || 'lock');
    if (m === 'unlock') {
      state.locked = false;
      state.human = true;
      removeLock();
      showHumanBar(payload && payload.reason);
      try { if (state.scan) state.scan(); } catch (_) {}
    } else if (m === 'remove') {
      state.locked = false;
      state.human = false;
      state.needHuman = false;
      state.loginNotified = false;
      removeLock();
      removeHumanBar();
      removeDoneBar();
    } else if (m === 'done') {
      state.locked = false;
      state.human = false;
      state.needHuman = false;
      state.loginNotified = false;
      removeLock();
      removeHumanBar();
      showDoneBar(payload);
    } else {
      state.locked = true;
      state.human = false;
      removeHumanBar();
      removeDoneBar();
      renderLock();
      setTimeout(() => { try { if (state.scan) state.scan(); } catch (_) {} }, 250);
    }
    return { ok: true, touch: state.touch };
  }

  function humanStillNeeded() {
    const txt = (document.body && document.body.innerText || '').slice(0, 12000);
    if (/登录已过期|登录过期|请重新登录|重新登录|扫码登录|二维码登录|手机号登录|登录后(查看|推荐)|请先登录/.test(txt)) return true;
    if (/扫码[\s\S]{0,20}登录|登录[\s\S]{0,20}扫码/.test(txt)) return true;
    const vis = (el) => {
      try {
        if (!el || el.offsetParent === null) return false;
        const cs = getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      } catch (_) { return false; }
    };
    const loginSel = ['.login-container', '.login-modal', '.login-reason',
      '[class*="login-container"]', '[class*="login-modal"]'];
    for (const s of loginSel) {
      try {
        const el = document.querySelector(s);
        if (!vis(el)) continue;
        const t = String(el.innerText || '').replace(/\s+/g, '');
        if (/扫码|手机号登录|登录后|二维码/.test(t)) return true;
      } catch (_) {}
    }
    try {
      if (/(^|\/)(login|website-login)(\/|$)/i.test(location.pathname)) return true;
    } catch (_) {}
    if (/安全验证|拖动滑块|请完成验证|人机验证/.test(txt)) return true;
    const sel = ['#captcha', '.captcha', '[class*="captcha"]', '[class*="red-captcha"]', '[class*="verify-wrap"]'];
    for (const s of sel) {
      try { if (vis(document.querySelector(s))) return true; } catch (_) {}
    }
    return false;
  }

  self.WorkWin = {
    beginTask, setStep, finish, closeAfter, closeWindow,
    humanRequired, humanDone, loginRequired, loginDone, isLoginWait,
    getStats, wasAborted, abortReason, handedOver,
    onAbort, onLogin, onLoginDone, setReporter,
    issueTicket, consumeTicket,
    ensureWindow, openTab,
    takeInterrupted,
    isPlatform,
  };
})();
