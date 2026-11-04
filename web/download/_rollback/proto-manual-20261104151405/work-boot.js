/* 执行器 · 干活宿主页的引导（2026-10-21 换手第一段）
 *
 * 一句话：这页只在"一次性通行证验过"之后才干活——
 *   等机器人（AutoBot）和前台搜索入口（_useKw/_useAcct）就绪 → 按 URL 上的
 *   口径×节奏跑一轮 → 用 port 把结果回给执行器后台（exec-shell）。
 *
 * 换手后多了一样东西：整页遮罩「机器人干活中 · 请勿操作」。
 *   · 遮罩盖住这一页的全部界面（工作台是内部页，客户不该点）；
 *   · 只挡人手（isTrusted=true 的事件），机器人自己的程序化点击照走；
 *   · 步骤 / 被碰次数 / 结果都从后台广播 ex.work.step 来。
 *
 * 与 exec-core.js（内核）的分工：内核出存储/动作/AI；本页只负责"把机器人叫起来"。
 * 内核是逐字节副本、不许改；本页是执行器自己的（可以改）。 */
(() => {
  const q = new URLSearchParams(location.search || '');
  const scope = q.get('scope') === 'growing' ? 'growing' : 'all';
  const pace = q.get('pace') === 'interval' ? 'interval' : 'once';
  const seq = q.get('seq') || '';
  /* 单步活：act 空＝跑机器人一轮（获客/日常浏览）；
     act=refresh＝对着那一篇刷新评论；act=batch_send＝先刷新再整页发送。 */
  const act = q.get('act') || '';
  /* 服务器按平台暂停/没认号算出来的"这趟跳过哪几头"（xhs / dy，逗号分隔） */
  const skipPlats = String(q.get('skip') || '').split(',').map((s) => s.trim()).filter((s) => s === 'xhs' || s === 'dy');
  /* 人手点的「▶ 开始」＝现在就跑：队列里没有到点的活，就让机器人自动塞一轮日常浏览 */
  const plug = q.get('plug') === '1';
  /* 🎯 这次跑多少条评论（网页队列页填的，0=不限）：跑到数就收工，下次再填 */
  const quota = Math.max(0, Number(q.get('quota')) || 0);

  let port = null;
  let finished = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── 整页遮罩（hand-cover.js 负责盖，这里只递状态） ── */
  function setCover(m) {
    try { if (window.HandCover) window.HandCover.set(m); } catch (_) {}
  }

  /* 遮罩上的"当前步骤"：机器人按计划歇着（定时轮间隔 / 手动暂停）时标 wait，
     遮罩改说「在等时间」并走倒计时，不会把"等下一项到点"误报成卡住 */
  function stepCover(step) {
    const bot = window.AutoBot;
    const paused = !!(bot && bot.paused);
    const waiting = !!(bot && bot.waiting);
    setCover({
      state: 'running', step,
      wait: paused || waiting,
      waitUntil: (!paused && waiting) ? (Number(bot && bot.waitUntil) || 0) : 0,
      waitWhy: paused ? '已暂停' : (waiting ? String((bot && bot.waitWhy) || '') : ''),
    });
  }

  /* 结果只报一次：卡住自动收尾和机器人自己收尾可能前后脚，谁先到算谁的 */
  function finish(o) {
    if (finished) return false;
    finished = true;
    try { if (port) port.postMessage(o); } catch (_) {}
    return true;
  }

  /* ── 卡住看门狗（2026-11-03 老板定）──
   *   90 秒没进展：遮罩自己变黄（hand-cover.js 每秒走）；
   *   满 2 分钟：这里当场收尾——按住机器人，把页面地址和页面上的报错带回来，队列记欠账。
   *   机器人自己歇着等下一轮（定时轮间隔 / 手动暂停）不算卡住。 */
  const STUCK_MS = 2 * 60 * 1000;
  let lastProgressAt = Date.now();
  let lastStepSeen = '';
  let lastCountSeen = '';
  let stuckFired = false;
  let botPromise = null;      // 卡住时等它 5 秒：能自己收掉就按它自己的结果报

  function noteProgress() { if (!stuckFired) lastProgressAt = Date.now(); }

  function armWatchdog() {
    lastProgressAt = Date.now();
    setInterval(async () => {
      if (finished || stuckFired) return;
      const bot = window.AutoBot;
      if (bot && (bot.paused || bot.waiting)) { lastProgressAt = Date.now(); return; }
      if (Date.now() - lastProgressAt >= STUCK_MS) {
        stuckFired = true;
        await finishStuck();
      }
    }, 1000);
  }

  /* 页面卡死时读一把"停在哪"：机器人开的平台页 + 页面上露出来的报错。
     页面真卡死时注入不会回话，最多等 3 秒就放手。 */
  async function snapshotPage(timeoutMs) {
    const out = { url: '', title: '', err: '' };
    let tab = null;
    try {
      const tabs = await chrome.tabs.query({});
      const plat = tabs.filter((t) => /xiaohongshu\.com|douyin\.com|channels\.weixin\.qq\.com/.test(String(t.url || '')));
      tab = plat.find((t) => t.active)
        || plat.sort((a, b) => (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0))[0]
        || null;
    } catch (_) {}
    if (!tab || tab.id == null) return out;
    out.url = String(tab.url || '');
    out.title = String(tab.title || '');
    try {
      if (!chrome.scripting || !chrome.scripting.executeScript) return out;
      const r = await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const pick = (sels) => {
              for (const s of sels) {
                let els = [];
                try { els = document.querySelectorAll(s); } catch (_) { continue; }
                for (const el of els) {
                  const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
                  if (t) return t.slice(0, 120);
                }
              }
              return '';
            };
            return { err: pick(['.err-msg', '.error-msg', '.toast', '.d-toast', '.modal-error', '[class*="error"]', '[class*="toast"]']) };
          },
        }),
        new Promise((r2) => setTimeout(() => r2(null), timeoutMs || 3000)),
      ]);
      const res = r && r[0] && r[0].result;
      if (res && res.err) out.err = String(res.err);
    } catch (_) {}
    return out;
  }

  async function finishStuck() {
    const held = Date.now() - lastProgressAt;
    setCover({ state: 'running', step: '⚠ 这一步卡住了，正在收尾…' });
    try { if (window.AutoBot && typeof window.AutoBot.stop === 'function') window.AutoBot.stop(); } catch (_) {}
    if (botPromise) await Promise.race([botPromise.then(() => 0, () => 0), sleep(5000)]);
    if (finished) return;   // 机器人在这几秒里自己收掉了：按它自己的结果报，不硬判失败
    finished = true;        // 先占住结果位：后面机器人再收掉也只算这一份（不再改报"跑完了"）
    const info = await snapshotPage(3000);
    const mins = Math.max(2, Math.round(held / 60000));
    const where = info.url
      ? ('页面停在「' + (info.title || '没标题') + '」' + info.url)
      : '页面地址没读出来（页面可能已经卡死）';
    const why = '卡住 ' + mins + ' 分钟没进展：' + where + (info.err ? '；页面报错：' + info.err : '');
    /* 机器人那头还悬着、来不及记欠账：这里替它记，下次开跑从这一项接着跑 */
    let item = null;
    try {
      if (typeof drainQueueHoldRunning === 'function') item = await drainQueueHoldRunning('这一步卡住了：' + why.slice(0, 160));
    } catch (_) {}
    if (item && typeof drainQueueLastStop === 'function') {
      try { await drainQueueLastStop(item, why, { global: true }); } catch (_) {}
    }
    setCover({ state: 'failed', result: '⏱ ' + why + '——已记欠账，回工作台再点一次开始' });
    try { if (port) port.postMessage({ ev: 'done', ok: false, seq, error: '⏱ ' + why + '——已记欠账，回工作台再点一次开始', logTail: readLog(), stuck: true }); } catch (_) {}
  }

  /* ── 等一次性通行证验过（hand-mode 负责验票；手工打开永远等不到） ── */
  async function waitHand(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (window.__XHS_HAND__ === true) return true;
      if (window.__XHS_HAND_BLOCKED__) return false;
      await sleep(100);
    }
    return window.__XHS_HAND__ === true;
  }

  /* 工作台那根日志面板的尾巴——机器人干到哪一步，服务器/验收要看得见。 */
  function readLog() {
    try {
      const panel = document.getElementById('logPanel');
      if (!panel) return '';
      const lines = Array.from(panel.querySelectorAll('.log-entry')).slice(-40).map((e) => String(e.textContent || '').replace(/\s+/g, ' ').trim());
      return lines.join('\n');
    } catch (_) { return ''; }
  }
  function lastLogLine() {
    const s = readLog();
    if (!s) return '';
    const lines = s.split('\n').filter(Boolean);
    return lines.length ? String(lines[lines.length - 1]).slice(0, 90) : '';
  }

  // 等三个都就绪：机器人 / 前台搜索入口 / 笔记列表容器（popup.html 里本来就有）
  async function waitReady(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (window.AutoBot && typeof window._useKw === 'function' && typeof window._useAcct === 'function'
        && document.getElementById('noteList') && document.getElementById('logPanel')) return true;
      await sleep(250);
    }
    return false;
  }

  async function start() {
    if (act === 'refresh') setCover({ state: 'running', step: '正在打开这一篇、刷新评论…' });
    else if (act === 'batch_send') setCover({ state: 'running', step: '正在刷新评论、准备整页发送…' });
    else setCover({ state: 'running', step: '正在把机器人叫起来…' });

    try { port = chrome.runtime.connect({ name: 'aw-round' }); } catch (_) {}
    const post = (o) => { try { if (port) port.postMessage(o); } catch (_) {} };

    // 熔断/停止：后台通过 port 喊一声，让机器人当场停（当前这一步做完就停）
    try {
      port.onMessage.addListener((m) => {
        if (m && m.ev === 'stop') {
          try { window.AutoBot && window.AutoBot.stop(); } catch (_) {}
          setCover({ state: 'running', step: '收到「停这一趟」：做完当前这一步就停…' });
        } else if (m && m.ev === 'pause') {
          try { window.AutoBot && window.AutoBot.pause(); } catch (_) {}
          setCover({ state: 'running', step: '已暂停（网页上点「继续」接着跑）', wait: true, waitWhy: '已暂停' });
        } else if (m && m.ev === 'resume') {
          try { window.AutoBot && window.AutoBot.resume(); } catch (_) {}
          setCover({ state: 'running', step: '接着跑…' });
        }
      });
    } catch (_) {}
    // 后台断了（扩展被关 / 服务线程崩了）：机器人别接着乱跑
    try {
      port.onDisconnect.addListener(() => {
        port = null;
        if (finished) return;
        try { window.AutoBot && window.AutoBot.stop(); } catch (_) {}
        setCover({ state: 'failed', result: '执行器后台断线了：这一趟停在这一步，不记为成功。' });
      });
    } catch (_) {}

    // 跑一轮可能好几分钟——每 20 秒跟后台碰一下，别让执行器后台被闲收走（MV3 服务线程闲 30 秒会睡）
    setInterval(() => post({ ev: 'tick' }), 20000);
    // 步骤面板：从工作台日志尾巴上读一行，盖到遮罩上；换了新行＝有进展
    setInterval(() => {
      if (finished) return;
      const line = lastLogLine();
      if (!line) return;
      if (line !== lastStepSeen) { lastStepSeen = line; noteProgress(); }
      stepCover(line);
    }, 1800);

    // 后台广播的步骤 / 被碰次数 / 结果（步骤或条数变了都算有进展）
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (!m || m.type !== 'ex.work.step') return;
        const step = (m.step != null) ? String(m.step) : '';
        const count = (m.count != null) ? String(m.count) : '';
        if ((step && step !== lastStepSeen) || (count && count !== lastCountSeen)) {
          if (step) lastStepSeen = step;
          if (count) lastCountSeen = count;
          noteProgress();
        }
        setCover(m);
      });
    } catch (_) {}

    armWatchdog();
    post({ ev: 'hello', seq });
    const ok = await waitReady(60000);
    if (!ok) {
      finish({ ev: 'done', ok: false, error: '宿主页没就绪（机器人或前台搜索入口没起来）', seq, logTail: readLog() });
      setCover({ state: 'failed', result: '工作台没起来，这一趟没跑成。' });
      return;
    }
    post({ ev: 'ready', seq });
    setCover({ state: 'running', step: '工作台就绪，开始干活…' });

    /* 账号安全闸：静默期 / 单休 / 起床前 / 发布占线 —— 挡下就当场记「没跑成」并说清原因，
       绝不当成跑完了报 0 条（10-26 老板定）。手点的单带「手点这一轮」放行票，静默期这趟照跑。 */
    try {
      if (typeof AccountGuard !== 'undefined') {
        const wall = await AccountGuard.blockAllReason();
        if (wall) {
          finish({ ev: 'done', ok: false, seq, error: '🛡 ' + wall.text, logTail: readLog() });
          setCover({ state: 'failed', result: '🛡 ' + wall.text });
          return;
        }
      }
    } catch (_) {}

    /* 评论刷新：宿主页对着 URL 上的 tabId 那一篇抓评论 + AI 分析 */
    if (act === 'refresh') {
      try {
        if (typeof window.refreshCommentAssistant !== 'function') throw new Error('宿主页没有「评论刷新」（版本不对）');
        await window.refreshCommentAssistant();
        const n = document.querySelectorAll('#mainContent .prospect-card').length;
        finish({ ev: 'done', ok: true, seq, logTail: readLog(), stats: { comments: n, found: n, notes: 0 } });
      } catch (e) {
        finish({ ev: 'done', ok: false, seq, error: (e && e.message) || String(e), logTail: readLog() });
      }
      return;
    }

    /* 整页发送：先刷新把商机摆出来，再交给宿主页的逐条发送（它自己过账号安全的闸） */
    if (act === 'batch_send') {
      try {
        if (typeof window.refreshCommentAssistant !== 'function') throw new Error('宿主页没有「评论刷新」（版本不对）');
        if (typeof window.batchSendAll !== 'function') throw new Error('宿主页没有「整页发送」（版本不对）');
        await window.refreshCommentAssistant();
        const btns = Array.from(document.querySelectorAll('.send-btn'));
        const before = btns.filter((b) => b.classList.contains('watered')).length;
        await window.batchSendAll();
        const after = Array.from(document.querySelectorAll('.send-btn'));
        const sent = after.filter((b) => b.classList.contains('watered')).length - before;
        const failed = after.filter((b) => b.dataset.sendDone && !b.classList.contains('watered')).length;
        finish({
          ev: 'done', ok: true, seq, logTail: readLog(),
          stats: { sent: Math.max(0, sent), failed, left: Math.max(0, after.length - (before + Math.max(0, sent)) - failed), total: after.length },
        });
      } catch (e) {
        finish({ ev: 'done', ok: false, seq, error: (e && e.message) || String(e), logTail: readLog() });
      }
      return;
    }

    try {
      botPromise = window.AutoBot.start(scope, pace, { skipPlats, plug, quota });
      /* 开跑前网页上已经按了暂停：机器人一就位就停在检查点（别等它跑完一轮） */
      (async () => {
        try {
          const pd = await chrome.storage.local.get('ex.pauseOn');
          if (!pd || !pd.ex.pauseOn) return;
          for (let i = 0; i < 40 && !finished; i++) {
            if (window.AutoBot && window.AutoBot.running) { window.AutoBot.pause(); return; }
            await sleep(250);
          }
        } catch (_) {}
      })();
      const rb = await botPromise;
      if (rb && rb.blocked) {
        finish({ ev: 'done', ok: false, seq, error: '🛡 ' + rb.blocked, logTail: readLog() });
        setCover({ state: 'failed', result: '🛡 ' + rb.blocked });
        return;
      }
      const st = (window.AutoBot && window.AutoBot._stats) || {};
      finish({
        ev: 'done', ok: true, seq, logTail: readLog(),
        stats: { comments: Number(st.comments) || 0, found: Number(st.found) || 0, notes: (st.notes || []).length, leads: Number(st.leads) || 0, daily: st.daily || null },
      });
    } catch (e) {
      finish({ ev: 'done', ok: false, seq, error: (e && e.message) || String(e), logTail: readLog() });
    }
  }

  (async () => {
    if (!(await waitHand(8000))) return;   // 手工打开 / 票不对：hand-mode 会挡页，这里什么都不做
    start();
  })();
})();
