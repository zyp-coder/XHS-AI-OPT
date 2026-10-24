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

  let port = null;
  let finished = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── 整页遮罩（hand-cover.js 负责盖，这里只递状态） ── */
  function setCover(m) {
    try { if (window.HandCover) window.HandCover.set(m); } catch (_) {}
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
    // 步骤面板：从工作台日志尾巴上读一行，盖到遮罩上
    setInterval(() => {
      if (finished) return;
      const line = lastLogLine();
      if (line) setCover({ state: 'running', step: line });
    }, 1800);

    // 后台广播的步骤 / 被碰次数 / 结果
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m && m.type === 'ex.work.step') setCover(m);
      });
    } catch (_) {}

    post({ ev: 'hello', seq });
    const ok = await waitReady(60000);
    if (!ok) {
      finished = true;
      post({ ev: 'done', ok: false, error: '宿主页没就绪（机器人或前台搜索入口没起来）', seq, logTail: readLog() });
      setCover({ state: 'failed', result: '工作台没起来，这一趟没跑成。' });
      return;
    }
    post({ ev: 'ready', seq });
    setCover({ state: 'running', step: '工作台就绪，开始干活…' });

    /* 评论刷新：宿主页对着 URL 上的 tabId 那一篇抓评论 + AI 分析 */
    if (act === 'refresh') {
      try {
        if (typeof window.refreshCommentAssistant !== 'function') throw new Error('宿主页没有「评论刷新」（版本不对）');
        await window.refreshCommentAssistant();
        const n = document.querySelectorAll('#mainContent .prospect-card').length;
        finished = true;
        post({ ev: 'done', ok: true, seq, logTail: readLog(), stats: { comments: n, found: n, notes: 0 } });
      } catch (e) {
        finished = true;
        post({ ev: 'done', ok: false, seq, error: (e && e.message) || String(e), logTail: readLog() });
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
        finished = true;
        post({
          ev: 'done', ok: true, seq, logTail: readLog(),
          stats: { sent: Math.max(0, sent), failed, left: Math.max(0, after.length - (before + Math.max(0, sent)) - failed), total: after.length },
        });
      } catch (e) {
        finished = true;
        post({ ev: 'done', ok: false, seq, error: (e && e.message) || String(e), logTail: readLog() });
      }
      return;
    }

    try {
      await window.AutoBot.start(scope, pace);
      const st = (window.AutoBot && window.AutoBot._stats) || {};
      finished = true;
      post({
        ev: 'done', ok: true, seq, logTail: readLog(),
        stats: { comments: Number(st.comments) || 0, found: Number(st.found) || 0, notes: (st.notes || []).length },
      });
    } catch (e) {
      finished = true;
      post({ ev: 'done', ok: false, seq, error: (e && e.message) || String(e), logTail: readLog() });
    }
  }

  (async () => {
    if (!(await waitHand(8000))) return;   // 手工打开 / 票不对：hand-mode 会挡页，这里什么都不做
    start();
  })();
})();
