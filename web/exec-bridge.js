/* ============================================================
 * 网页侧接真 · 执行器桥（B 期 · 2026-10-14）
 * ------------------------------------------------------------
 * 干什么：网页上那几个"真干活"的按钮，本身是照搬扩展的界面——在服务器版里它们不能自己干
 *        （服务器不碰平台）。这一层把它们翻成"给执行器下单"，再把执行器报回来的进度显示出来。
 *
 * 接哪几处：
 *   ① 获客 · 队列页「🤖 开始」 → 下单 acquire（把这一轮要用的配置快照带上）
 *   ② 「⏹ 停止」 → 让执行器停这一趟（stop 令）
 *   ③ 线索 · AI客服「开/关监听」 → 下单 leads（长驻哨兵住执行器后台）
 *   ④ 一条状态带 ＋ 把执行器的进度播报写进工作台那根日志面板（"网页见实时进度"）
 *
 * 只活在 web/ 副本里；extension/ 一个字不动（规矩照旧）。
 * 只挂"翻译层垫起来的壳"（chrome.runtime.id === 'demo-page'）——真扩展里这文件不会被加载。 */
(() => {
  if (!(window.chrome && window.chrome.runtime && window.chrome.runtime.id === 'demo-page')) return;
  if (window.__XHS_EXEC_BRIDGE__) return;
  window.__XHS_EXEC_BRIDGE__ = true;

  const log = (...a) => console.log('%c[执行器桥]', 'color:#0a6b8a', ...a);

  /* 出片页只要「派给执行器」这一个口：不摆右下角状态带，也不轮询订单（免得挡底栏、白跑请求）。 */
  const NO_STRIP = document.documentElement.hasAttribute('data-exec-no-strip');

  /* ── 下单 ── */
  async function order(kind, params) {
    try {
      const r = await fetch('api/exec/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind, params: params || {} }),
      });
      const j = await r.json();
      if (j && j.demo === 'need-account') return { ok: false, error: j.error || '先登录' };
      if (!j || !j.ok) return { ok: false, error: (j && j.error) || '服务器没接这单' };
      return { ok: true, cmdId: j.cmdId, delivered: !!j.delivered };
    } catch (e) { return { ok: false, error: '下单没送到服务器：' + e.message }; }
  }

  /* ── 「⏹ 停这一趟」：有专用口 /api/exec/stop（不是一条"活"）──
     修 bug（D 期）：先前这里把它当普通活发给了 /api/exec/order（kind='stop'），服务器不认这一种活、
     回"不认识的活：stop"，于是网页上那两个「停这一趟」（队列页的停止 + 右下角状态带）一直没停成。 */
  async function stopRun() {
    try {
      const r = await fetch('api/exec/stop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (j && j.demo === 'need-account') return { ok: false, error: j.error || '先登录' };
      if (!j || !j.ok) return { ok: false, error: (j && j.error) || '服务器没受理' };
      return { ok: true, delivered: !!j.delivered };
    } catch (e) { return { ok: false, error: '喊停没送到服务器：' + e.message }; }
  }

  /* ── 「解绑这台电脑」（D 期）：换机前先摘线 / 旧电脑丢了——把这只手从服务器摘掉 ── */
  async function unpair() {
    try {
      const r = await fetch('api/exec/unpair', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (j && j.demo === 'need-account') return { ok: false, error: j.error || '先登录' };
      if (!j || !j.ok) return { ok: false, error: (j && j.error) || '解绑没成' };
      return { ok: true };
    } catch (e) { return { ok: false, error: '解绑没送到服务器：' + e.message }; }
  }

  /* ── 配置快照：捡出这一轮要用的"配置"（运行态——跑到几点的账、欠账/队列——不捡，留在执行器本机） ── */
  async function snapshot(extra) {
    const out = {};
    try {
      const got = await chrome.storage.local.get(['drain_scan_cfg', 'auto_water_config', 'daily_browse_config']);
      for (const k of Object.keys(got)) if (got[k] !== undefined) out[k] = got[k];
    } catch (_) {}
    try {
      if (typeof readConfigPlain === 'function') { const cfg = await readConfigPlain(); if (cfg) out.config = cfg; }
    } catch (_) {}
    return Object.assign(out, extra || {});
  }

  /* ── 当前这一篇：「笔记列表」里点开/要操作的那篇 —— 评论刷新、整页发送都拿它当默认目标 ── */
  let activeNote = null;
  async function readActiveNote() {
    try {
      const got = await chrome.storage.local.get('sx_active_note');
      const n = got && got.sx_active_note;
      if (n && (n.noteId || n.url)) return n;
    } catch (_) {}
    return activeNote;
  }
  async function saveActiveNote(note) {
    const n = {
      noteId: String((note && note.noteId) || ''), url: String((note && note.url) || ''),
      title: String((note && note.title) || ''), author: String((note && note.author) || ''), at: Date.now(),
    };
    activeNote = n;
    try { await chrome.storage.local.set({ sx_active_note: n }); } catch (_) {}
    return n;
  }
  const ordered = (r, extra) => r.ok
    ? Object.assign({ ok: true, ordered: true, cmdId: r.cmdId, delivered: !!r.delivered }, extra || {})
    : { ok: false, error: r.error };

  /* ── ① 队列页「🤖 开始」/「⏹ 停止」：不在本页跑机器人，改成给执行器下单 / 喊停 ── */
  function patchBot() {
    const bot = window.AutoBot;
    if (!bot) return false;
    if (bot.__orderedBridge) return true;
    bot.__orderedBridge = true;

    bot.start = async function (scope, pace) {
      bot.running = true;                                   // 视觉照旧：按钮切成"停止"
      try { if (typeof bot._updateUI === 'function') bot._updateUI(true); } catch (_) {}
      say('已把这一轮派给执行器，等它回话……');
      const r = await order('acquire', { snapshot: await snapshot(), scope: scope || 'all', pace: pace || 'interval' });
      if (!r.ok) {
        bot.running = false; try { if (typeof bot._updateUI === 'function') bot._updateUI(false); } catch (_) {}
        say('下单没成：' + r.error, 'error');
        return r;
      }
      say(r.delivered ? '执行器在线，当场开跑（进度看下面）' : '执行器不在线——单排着了，等它上线就跑', 'success');
      return r;
    };

    bot.stop = async function () {
      say('已让执行器停这一趟……');
      const r = await stopRun();
      if (!r.ok) { say('喊停没送到：' + r.error, 'error'); return r; }
      bot.running = false; try { if (typeof bot._updateUI === 'function') bot._updateUI(false); } catch (_) {}
      say('已送出「停这一趟」', 'success');
      return r;
    };

    log('已接管队列页的「🤖 开始 / ⏹ 停止」→ 给执行器下单');
    return true;
  }

  /* ── ③ 网页上那些"原来点不动"的钮 → 全部翻成给执行器下单 ──
     服务器不碰平台，所以搜索 / 扫描 / 补开 / 打开 / 评刷 / 整页发送 / 私信，全得由执行器在它那台浏览器里干。
     这里只挂"翻译层垫起来的壳"（chrome.runtime.id === 'demo-page'），真扩展里不加载这个文件。 */
  async function onSearchNotes(d) {
    const kw = String(d.kw || '').trim();
    const profile = String(d.profile || '').trim();
    const label = String(d.label || '').trim();
    const word = kw || label || profile;
    say((profile ? '盯账号' : '搜索') + '已派给执行器' + (word ? '：「' + word + '」' : '') + '……');
    const r = await order('acquire', {
      op: 'search', kw: kw, profile: profile, label: label,
      scenario: String(d.scenario || ''), force: !!d.force, snapshot: await snapshot(),
    });
    if (!r.ok) { say('搜索没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    window.__xhsOrderedSearch = { at: Date.now(), cmdId: r.cmdId, keyword: word, kwIdx: 0, done: false };
    /* 新的搜索会撤掉旧的那串；先把网页上旧的链清掉，等下一轮轮询拿到新的 */
    window.__xhsChain = null;
    say(r.delivered ? '执行器在线，正在它那台浏览器里搜……' : '执行器不在线——单排着了，等它上线就搜', 'success');
    return ordered(r, { keyword: word, kwIdx: 0 });
  }

  async function onDrainScan() {
    say('截流扫一轮已派给执行器……');
    const r = await order('acquire', { op: 'scan', snapshot: await snapshot() });
    if (!r.ok) { say('扫描没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正在逐词扫来源……' : '执行器不在线——单排着了', 'success');
    return ordered(r);
  }

  async function onDrainReplenish() {
    say('补开未打开已派给执行器……');
    const r = await order('acquire', { op: 'backfill', snapshot: await snapshot() });
    if (!r.ok) { say('补开没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正在回看本轮没打开的笔记……' : '执行器不在线——单排着了', 'success');
    return ordered(r);
  }

  async function onOpenNote(d) {
    const n = (d && d.note) || null;
    if (!n) return { ok: false, error: '没说要打开哪一篇' };
    await saveActiveNote(n);
    say('正在让执行器打开《' + String(n.title || n.noteId || '').slice(0, 16) + '》……');
    const r = await order('acquire', { op: 'open', note: n });
    if (!r.ok) { say('打开没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正打开这篇……' : '执行器不在线——单排着了', 'success');
    return ordered(r, { noteId: String(n.noteId || '') });
  }

  async function onCancelSearch() {
    const chain = window.__xhsChain;
    const chainLive = !!(chain && (chain.status === 'waiting' || chain.status === 'running'));
    if (!window.__xhsOrderedSearch && !chainLive) return { ok: true, ordered: true };
    window.__xhsOrderedSearch = null;
    /* 搜索链还在等下一类：这一下也把它停掉（服务器会撤链，网页先清掉旧的） */
    if (chainLive) window.__xhsChain = null;
    say('已让执行器停这一趟搜索……');
    const r = await stopRun();
    if (!r.ok) { say('喊停没送到：' + r.error, 'error'); return { ok: false, error: r.error }; }
    return { ok: true, ordered: true };
  }

  async function onSendDm(d) {
    const person = (d && d.person) || null;
    const text = String((d && d.text) || '').trim();
    if (!person) return { ok: false, error: '没说要发给谁' };
    if (!text) return { ok: false, error: '私信内容为空' };
    say('私信已派给执行器：发给 ' + String(person.nickname || person.id || '') + '……');
    const r = await order('leads', { op: 'dm', person: person, text: text, force: !!(d && d.force) });
    if (!r.ok) { say('私信没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正在开聊天窗发……' : '执行器不在线——单排着了', 'success');
    return ordered(r);
  }

  async function onSendDmBatch(d) {
    const people = Array.isArray(d && d.people) ? d.people.filter((x) => x && x.person && String(x.text || '').trim()) : [];
    if (!people.length) return { ok: false, error: '没有可发的（先给这些线索生成话术）' };
    say('批量触达已派给执行器：' + people.length + ' 人……');
    const r = await order('leads', { op: 'dm', people: people });
    if (!r.ok) { say('批量触达没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正在逐条发（3~8 秒一条）……' : '执行器不在线——单排着了', 'success');
    return ordered(r, { people: people.length });
  }

  function patchRuntime() {
    const rt = window.chrome && window.chrome.runtime;
    if (!rt || typeof rt.sendMessage !== 'function' || rt.__execBridged) return;
    rt.__execBridged = true;
    const orig = rt.sendMessage.bind(rt);
    rt.sendMessage = function (msg, cb) {
      const action = msg && msg.action;
      let task = null;
      if (action === 'setMsgWatch') {
        const d = msg.data || {};
        task = (async () => {
          say(d.enabled ? '正在让执行器开监听（长驻哨兵住它后台）……' : '正在让执行器关监听……');
          const r = await order('leads', { on: !!d.enabled, tickSec: d.tickSec || 60 });
          if (!r.ok) { say('监听开关没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
          say(d.enabled ? '执行器已开监听' : '执行器已关监听', 'success');
          return { ok: true, enabled: !!d.enabled, tickSec: d.tickSec || 60 };
        })();
      } else if (action === 'searchNotes') {
        task = onSearchNotes(msg.data || {});
      } else if (action === 'cancelSearch') {
        task = onCancelSearch();
      } else if (action === 'drainScan') {
        task = onDrainScan();
      } else if (action === 'drainReplenish') {
        task = onDrainReplenish();
      } else if (action === 'openNote') {
        task = onOpenNote(msg.data || {});
      } else if (action === 'sendDm') {
        task = onSendDm(msg.data || {});
      } else if (action === 'sendDmBatch') {
        task = onSendDmBatch(msg.data || {});
      }
      if (!task) return orig(msg, cb);
      return cb ? (task.then(cb), undefined) : task;
    };
    log('已接管搜索 / 截流扫描 / 补开 / 打开笔记 / 私信 / 监听 → 给执行器下单');
  }

  /* ── 评论刷新：那颗钮是 addEventListener 绑的，拦不住 onclick，只能用捕获阶段截 ── */
  function patchRefreshClick() {
    if (window.__xhsRefreshClickBridged) return;
    window.__xhsRefreshClickBridged = true;
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('#refreshBtn,#rescanBtn') : null;
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      (async () => {
        const n = await readActiveNote();
        if (!n || (!n.noteId && !n.url)) { say('先在「笔记列表」里点开一篇，再来刷新评论（网页这头不知道你开的是哪篇）', 'warn'); return; }
        const t0 = b.textContent;
        b.disabled = true; b.textContent = '⏳ 已派给执行器';
        say('评论刷新已派给执行器：《' + String(n.title || n.noteId).slice(0, 16) + '》……');
        const r = await order('acquire', { op: 'refresh', note: n });
        if (!r.ok) say('评论刷新没派成：' + r.error, 'error');
        else say(r.delivered ? '执行器在线，正打开这篇抓评论 + AI 分析……' : '执行器不在线——单排着了', 'success');
        setTimeout(() => { b.disabled = false; b.textContent = t0 || '🔄 评论刷新'; }, 2500);
      })();
    }, true);
  }

  /* ── 整页发送：网页这份 batchSendAll 换成"下单"，不再在服务器侧假跑 ── */
  function patchBatchSend() {
    if (typeof window.batchSendAll !== 'function') return false;
    if (window.batchSendAll.__orderedBridge) return true;
    window.batchSendAll = async function () {
      const n = await readActiveNote();
      if (!n || (!n.noteId && !n.url)) { say('先点开一篇笔记（列表里点「打开」），再点整页发送', 'warn'); return; }
      say('整页发送已派给执行器：《' + String(n.title || n.noteId).slice(0, 16) + '》……');
      const r = await order('batch_send', { note: n });
      if (!r.ok) { say('整页发送没派成：' + r.error, 'error'); return; }
      say(r.delivered ? '执行器在线，正在这篇里刷新评论 + 逐条发……' : '执行器不在线——单排着了', 'success');
    };
    window.batchSendAll.__orderedBridge = true;
    log('已接管「整页发送」→ 给执行器下单');
    return true;
  }

  /* ── 「🌿 塞一轮日常流程」：网页侧调这里（队列照旧插队，另外给执行器下一单立刻跑一次） ── */
  window.__xhsExecDaily = async function (k, label) {
    say('🌿 日常浏览这一轮已派给执行器：' + (label || k));
    const r = await order('daily_browse', {
      daily: { k: String(k || ''), label: String(label || ''), scenario: 'daily' },
      snapshot: await snapshot(), scope: 'all', pace: 'once',
    });
    if (!r.ok) { say('日常浏览没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正把这一项插到它队首跑……' : '执行器不在线——单排着了', 'success');
    return ordered(r);
  };

  /* 出片页不摆状态带、不轮询全量订单；派完单只盯这一单——执行器回来说失败就当场弹窗。
     成功/排队不弹；执行器不在线时单还在队列里，等它上线跑失败也会走到这里。 */
  let filmWatchId = '', filmWatchTimer = null;
  function watchFilmOrder(cmdId) {
    const id = String(cmdId || '');
    if (!id) return;
    filmWatchId = id;
    if (filmWatchTimer) { clearTimeout(filmWatchTimer); filmWatchTimer = null; }
    const t0 = Date.now(), MAX = 30 * 60 * 1000;
    let delay = 5000;
    const poll = async () => {
      if (filmWatchId !== id) return;
      let c = null;
      try {
        const r = await fetch('api/exec/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        if (j && j.ok && Array.isArray(j.orders)) c = j.orders.find(x => x && String(x.id) === id) || null;
      } catch (_) {}
      if (filmWatchId !== id) return;
      if (c && c.state === 'failed') {
        filmWatchId = '';
        const why = String(c.note || '执行器回来说没成，但没留原因')
          .replace(/^跑的时候出错：/, '').replace(/^出片没成：/, '');
        if (NO_STRIP) {
          const st = document.getElementById('st');
          if (st) st.textContent = '出片没成';
          const w = document.getElementById('warn');
          if (w) { w.hidden = false; w.textContent = '出片没成：' + why; }
        }
        say('出片没成：' + why, 'error');
        alert('出片没成：' + why);
        return;
      }
      if (c && c.state === 'done') { filmWatchId = ''; return; }
      if (Date.now() - t0 >= MAX) { filmWatchId = ''; return; }
      if (Date.now() - t0 > 60000) delay = 15000;
      filmWatchTimer = setTimeout(poll, delay);
    };
    filmWatchTimer = setTimeout(poll, delay);
  }

  /* ── 出片前只读问一句：执行器在不在线（不排单、不留痕）。
     出片页照这个分流：在线仍派给执行器；不在线就本页自己出，不再排一条等它上线。 ── */
  window.__xhsExecOnline = async function () {
    try {
      const r = await fetch('api/exec/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (!j || !j.ok) return { ok: false, online: false, error: (j && j.error) || '问不到执行器状态' };
      const h = j.hand || {};
      return {
        ok: true, online: !!h.online, paired: !!h.paired,
        tierRank: Number(h.tierRank || 0), killed: !!j.killed,
      };
    } catch (e) {
      return { ok: false, online: false, error: '问不到执行器状态：' + e.message };
    }
  };

  /* ── 出片（web/video.js 用）：整份草稿随单走，执行器在那台机器上编、编完存它本机/下载 ── */
  window.__xhsExecFilm = async function (noteId, doc) {
    if (!noteId) return { ok: false, error: '没带上是哪一篇' };
    say('出片已派给执行器：《' + String((doc && doc.title) || noteId).slice(0, 16) + '》……');
    const r = await order('film', { noteId: String(noteId), doc: doc || null });
    if (!r.ok) { say('出片没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    watchFilmOrder(r.cmdId);
    say(r.delivered ? '执行器在线，正在那台机器上编（编完存它本机并下载）……' : '执行器不在线——单排着了', 'success');
    return ordered(r);
  };

  /* ── ④ 状态 ＋ 进度：轮询 /api/exec/orders，把执行器报的话写进工作台日志面板 ──
     不再另造浮层（右下角那块已撤）：顶栏右上角那颗「⬇️ 执行器」按钮本身就是状态灯——
     没挂＝「🖐 执行器：还没挂 · 去装」，点它去装机页；挂了＝「🖐 名字 · 在线/离线 · 档」，
     旁边只多挂 ⏹停这一趟 / 解绑 两颗小钮，全在顶栏里，不压页面内容。出片页仍不摆。 */
  let strip = null, chip = null, lastReportKey = '', stopBtnEl = null, unBtnEl = null;

  /* ── 停手横幅（2026-10-23）：搜索链被账号安全/静默期/登录过期/搜索失败挡下时，网页顶上醒目提醒。
     登录过期红条、其它橙条，都点「知道了」收起；手动「停这一趟」不弹（服务器直接撤链，这里读不到 stopped）。 ── */
  let execBanner = null, execBannerKey = '', execBannerDismissed = '', execBannerTitle = null, execBannerBody = null;

  const STOP_BANNERS = {
    login: { red: true, title: '🔐 小红书登录过期了，机器人已经停手',
      body: '去执行器那台电脑上弹出的「干活窗口」里扫码登录；登录好后回到这里重新点「搜索」或「开始」。后面几类先不跑。' },
    guard: { red: false, title: '🛡 账号安全挡下了，这一串活先停',
      body: '先别在这个号上接着操作。过一阵回工作台重新点「搜索」：会先跑最新，再按到点情况接着跑。' },
    quiet: { red: false, title: '🌙 到静默期了（21:00–09:00）',
      body: '后面几类今晚不跑。明早再点「搜索」接着来。' },
    fail: { red: false, title: '⚠️ 这一轮没跑起来，后面先停',
      body: '页面没打开或一篇都没拿到。检查执行器那台电脑的小红书页面，回来重新点「搜索」。' },
    offline: { red: false, title: '📴 执行器超过 24 小时没上线，这一串活作废了',
      body: '那台电脑一直没连上，后面几类先不跑。回来重新点「搜索」会重新起一轮。' },
  };

  function ensureExecBanner() {
    if (execBanner && document.body.contains(execBanner)) return execBanner;
    const box = document.createElement('div');
    box.id = 'execStopBanner';
    box.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:100000;'
      + 'display:none;align-items:flex-start;gap:12px;width:min(92vw,680px);box-sizing:border-box;'
      + 'border-radius:10px;padding:13px 15px;box-shadow:0 10px 30px rgba(120,53,15,.18);'
      + 'font-size:13px;line-height:1.65;font-family:inherit;';
    const txt = document.createElement('div');
    txt.style.cssText = 'flex:1;min-width:0;';
    execBannerTitle = document.createElement('div');
    execBannerTitle.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:2px;';
    execBannerBody = document.createElement('div');
    txt.appendChild(execBannerTitle);
    txt.appendChild(execBannerBody);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '知道了';
    btn.style.cssText = 'flex:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;';
    btn.addEventListener('click', () => { execBannerDismissed = execBannerKey; box.style.display = 'none'; });
    box.appendChild(txt);
    box.appendChild(btn);
    document.body.appendChild(box);
    execBanner = box;
    return box;
  }

  function showExecBanner(kind, key) {
    const b = STOP_BANNERS[kind] || STOP_BANNERS.fail;
    const box = ensureExecBanner();
    box.style.background = b.red ? '#fef2f2' : '#fff7ed';
    box.style.color = b.red ? '#7f1d1d' : '#7c2d12';
    box.style.border = '1px solid ' + (b.red ? '#fca5a5' : '#fdba74');
    box.style.borderLeft = '5px solid ' + (b.red ? '#dc2626' : '#ea580c');
    const btn = box.querySelector('button');
    if (btn) {
      btn.style.border = '1px solid ' + (b.red ? '#fca5a5' : '#fdba74');
      btn.style.background = '#fff';
      btn.style.color = b.red ? '#991b1b' : '#9a3412';
    }
    if (execBannerDismissed === key) { box.style.display = 'none'; return; }
    if (execBannerKey !== key) {
      execBannerKey = key;
      execBannerTitle.textContent = b.title;
      execBannerBody.textContent = b.body;
      box.style.display = 'flex';
    }
  }

  /* 认号对不上 / 没登录（2026-10-23）：只停那一个平台，另一个照跑。
     文案直接摊开「绑的是谁、这台现在登的是谁」，客户自己就能判断怎么处理。 */
  const BIND_LABEL = { xhs: '小红书', douyin: '抖音' };
  function bindAlertOf(j) {
    const st = j.bindState || {};
    for (const p of ['douyin', 'xhs']) {
      const s = st[p];
      if (!s) continue;
      if (s.status !== 'mismatch' && s.status !== 'loggedout') continue;
      const b = (j.bindings || {})[p] || {};
      const label = BIND_LABEL[p];
      const other = p === 'douyin' ? '小红书' : '抖音';
      if (s.status === 'mismatch') {
        const bound = (b.displayId || b.uid || '原来的号') + (b.name ? '（' + b.name + '）' : '');
        const saw = ((s.saw && (s.saw.displayId || s.saw.uid)) || '另一个号')
          + (s.saw && s.saw.name ? '（' + s.saw.name + '）' : '');
        return {
          key: 'bind|' + p + '|' + saw + '|' + (s.at || 0),
          title: '⛔ ' + label + '号对不上：' + label + '这一头停了',
          body: '这个网页账号绑的' + label + '号是 ' + bound + '，这台浏览器现在登录的是 ' + saw + '。'
            + other + '那边不受影响，照常跑。' + label + '的单会停在这里——换回原来的号登录，或找给你网址的人换绑，回来重新点开始就接着跑。',
        };
      }
      return {
        key: 'bind|' + p + '|loggedout|' + (s.at || 0),
        title: '🔐 ' + label + '没登录：' + label + '这一头先停',
        body: '去执行器那台电脑弹出的干活窗口里登录好' + label + '，回来重新点开始就接着跑。' + other + '那边照常跑。',
      };
    }
    return null;
  }

  function showBindBanner(a) {
    const box = ensureExecBanner();
    box.style.background = '#fef2f2';
    box.style.color = '#7f1d1d';
    box.style.border = '1px solid #fca5a5';
    box.style.borderLeft = '5px solid #dc2626';
    const btn = box.querySelector('button');
    if (btn) {
      btn.style.border = '1px solid #fca5a5';
      btn.style.background = '#fff';
      btn.style.color = '#991b1b';
    }
    if (execBannerDismissed === a.key) { box.style.display = 'none'; return; }
    if (execBannerKey !== a.key) {
      execBannerKey = a.key;
      execBannerTitle.textContent = a.title;
      execBannerBody.textContent = a.body;
      box.style.display = 'flex';
    }
  }

  const MINI_CSS = 'border:1px solid var(--c-line-2);background:var(--c-surface);color:var(--c-ink-3);'
    + 'border-radius:var(--r-sm);height:28px;padding:0 8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;';

  function ensureStrip() {
    if (strip && document.body.contains(strip)) return strip;
    const hdr = document.querySelector('.hdr-right');
    const link = hdr && hdr.querySelector('a.hdr-link[href="setup.html"]');
    if (link) {
      /* 就地点亮那颗按钮：它就是 chip，位置与样式全跟顶栏原生一致，不存在两块并排 */
      chip = link;
      strip = hdr;
      chip.textContent = '🖐 执行器：查询中…';
      chip.style.maxWidth = 'min(46vw, 420px)';
      chip.style.overflow = 'hidden';
      chip.style.textOverflow = 'ellipsis';
      chip.removeAttribute('target');
      chip.addEventListener('click', (ev) => { if (chip.classList.contains('exec-paired')) ev.preventDefault(); });
      stopBtnEl = document.createElement('button');
      stopBtnEl.type = 'button';
      stopBtnEl.textContent = '⏹ 停这一趟';
      stopBtnEl.style.cssText = MINI_CSS + 'display:none;';
      stopBtnEl.addEventListener('click', async () => {
        stopBtnEl.disabled = true;
        const r = await stopRun();
        say(r.ok ? '已送出「停这一趟」' : '喊停没送到：' + r.error, r.ok ? 'success' : 'error');
        setTimeout(() => { stopBtnEl.disabled = false; }, 1200);
      });
      /* D 期：「解绑这台电脑」——换机前先摘线 / 旧电脑丢了也能把线摘掉 */
      unBtnEl = document.createElement('button');
      unBtnEl.type = 'button';
      unBtnEl.textContent = '解绑';
      unBtnEl.title = '把这只执行器从服务器摘掉（换电脑前 / 旧电脑不要了）——之后可在新电脑重新登录挂线';
      unBtnEl.style.cssText = MINI_CSS + 'display:none;';
      unBtnEl.addEventListener('click', async () => {
        if (!window.confirm('解绑这台电脑？\n解绑后这台浏览器就不再干活了（正在跑的活会停下）；换新电脑时在新电脑上登录挂线即可。')) return;
        unBtnEl.disabled = true;
        const r = await unpair();
        say(r.ok ? '已解绑这台电脑——可在新电脑上重新登录挂线' : '解绑没成：' + r.error, r.ok ? 'success' : 'error');
        setTimeout(() => { unBtnEl.disabled = false; tick(); }, 1200);
      });
      link.parentNode.insertBefore(stopBtnEl, link.nextSibling);
      stopBtnEl.parentNode.insertBefore(unBtnEl, stopBtnEl.nextSibling);
      return strip;
    }
    /* 没有顶栏那颗按钮的页面（自测之类）才退回悬浮，且避开右下角 */
    strip = document.createElement('div');
    strip.id = 'execStatusStrip';
    strip.style.cssText = 'position:fixed;right:14px;top:64px;z-index:99999;max-width:420px;'
      + 'background:#0f2b36;color:#e8f4f7;border-radius:10px;padding:8px 12px;font-size:12px;line-height:1.6;'
      + 'box-shadow:0 6px 22px rgba(0,0,0,.28);display:flex;gap:10px;align-items:center;font-family:inherit;';
    const darkCss = 'border:1px solid rgba(255,255,255,.4);background:transparent;color:#e8f4f7;'
      + 'border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;';
    chip = document.createElement('span');
    chip.textContent = '执行器：查询中…';
    chip.style.cssText = darkCss + 'font-weight:600;border:none;';
    stopBtnEl = document.createElement('button');
    stopBtnEl.type = 'button';
    stopBtnEl.textContent = '⏹ 停这一趟';
    stopBtnEl.style.cssText = darkCss;
    stopBtnEl.addEventListener('click', async () => {
      stopBtnEl.disabled = true;
      const r = await stopRun();
      say(r.ok ? '已送出「停这一趟」' : '喊停没送到：' + r.error, r.ok ? 'success' : 'error');
      setTimeout(() => { stopBtnEl.disabled = false; }, 1200);
    });
    unBtnEl = document.createElement('button');
    unBtnEl.type = 'button';
    unBtnEl.textContent = '解绑';
    unBtnEl.title = '把这只执行器从服务器摘掉（换电脑前 / 旧电脑不要了）——之后可在新电脑重新登录挂线';
    unBtnEl.style.cssText = darkCss;
    unBtnEl.addEventListener('click', async () => {
      if (!window.confirm('解绑这台电脑？\n解绑后这台浏览器就不再干活了（正在跑的活会停下）；换新电脑时在新电脑上登录挂线即可。')) return;
      unBtnEl.disabled = true;
      const r = await unpair();
      say(r.ok ? '已解绑这台电脑——可在新电脑上重新登录挂线' : '解绑没成：' + r.error, r.ok ? 'success' : 'error');
      setTimeout(() => { unBtnEl.disabled = false; tick(); }, 1200);
    });
    strip.appendChild(chip);
    strip.appendChild(stopBtnEl);
    strip.appendChild(unBtnEl);
    document.body.appendChild(strip);
    return strip;
  }

  /* 把执行器报的话写进工作台那根日志面板（点开"获客 → 工作台"就看得见实时进度） */
  function pushLog(text, type) {
    try {
      const panel = document.getElementById('logPanel');
      if (!panel) return;
      panel.style.display = 'block';
      const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const div = document.createElement('div');
      div.className = 'log-entry ' + (type || 'info');
      div.dataset.src = 'exec';
      div.innerHTML = '<span class="log-time">' + t + '</span>'
        + '<span class="log-src" style="color:#0a6b8a;font-weight:700;margin-right:4px;font-size:10px;">🖐</span>'
        + String(text || '').replace(/</g, '&lt;');
      panel.appendChild(div);
      panel.scrollTop = panel.scrollHeight;
      while (panel.children.length > 200) panel.removeChild(panel.firstChild);
    } catch (_) {}
  }
  /* 状态带上的短提示：一律落进日志面板（页面里不再另开 toast，免得抢老板视线） */
  function say(text, type) { pushLog(text, type); }

  async function tick() {
    let j;
    try {
      const r = await fetch('api/exec/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      j = await r.json();
    } catch (_) { return; }
    if (!j || !j.ok) return;
    const orders = Array.isArray(j.orders) ? j.orders : [];
    /* 搜索链：服务器记下的「这一轮 + 后面还有哪几类 + 下一类什么时候派」。
       工作台那边拿它画顶行和后面几类；这里拿它的停手原因弹横幅。 */
    const chain = j.chain || null;
    window.__xhsChain = chain;
    const chainStop = (chain && chain.status === 'stopped' && chain.stopKind && chain.stopKind !== 'manual') ? chain : null;
    /* 认号红条：停手原因优先显示搜索链的；没有就显示错号/没登录（只停那一个平台） */
    const loginCmd = !chainStop
      ? orders.find((c) => c && c.needLogin && c.state === 'failed')
      : null;
    const loginStale = loginCmd && orders.some((c) => c && c.state === 'done' && c.ok
      && (c.createdAt || 0) > (loginCmd.doneAt || loginCmd.createdAt || 0));
    const bindAlert = (!chainStop && !loginCmd) ? bindAlertOf(j) : null;
    if (chainStop) {
      showExecBanner(chainStop.stopKind, String(chainStop.id || '') + '|' + chainStop.stopKind);
    } else if (loginCmd && !loginStale) {
      showExecBanner('login', 'cmd|' + String(loginCmd.id || ''));
    } else if (bindAlert) {
      showBindBanner(bindAlert);
    } else if (execBanner) execBanner.style.display = 'none';
    /* 搜索那一单跑完没有：跑完就把结果挂到 window.__xhsOrderedSearch 上，工作台那边下一轮轮询会取走显示 */
    const os = window.__xhsOrderedSearch;
    if (os && !os.done) {
      const c = (Array.isArray(j.orders) ? j.orders : []).find((x) => x && x.id === os.cmdId);
      if (c && (c.state === 'done' || c.state === 'failed')) {
        os.done = true; os.ok = !!c.ok; os.note = c.note || ''; os.detail = c.detail || ''; os.doneAt = c.doneAt || Date.now();
        if (!c.ok) say('搜索没跑成：' + (c.note || '执行器没回原因'), 'error');
      }
    }
    /* 队列页那颗「🤖 开始」在公网版只负责下单：单跑完了要把"运行中"的视觉收回来，
       否则队列页一直显示在跑，笔记列表的「打开」也会被"工作台正忙"挡住 */
    const inflight = (Array.isArray(j.orders) ? j.orders : []).some((c) => c && (c.state === 'queued' || c.state === 'sent'));
    if (!inflight) {
      const b = window.AutoBot;
      if (b && b.running) { b.running = false; try { if (typeof b._updateUI === 'function') b._updateUI(false); } catch (_) {} }
    }
    const el = ensureStrip();
    const h = j.hand || {};
    guideFromHand(h);
    const reports = Array.isArray(j.reports) ? j.reports : [];
    const latest = reports.length ? reports[reports.length - 1] : null;
    const who = h.paired ? (h.name || '已挂线') : '还没挂';
    chip.onclick = null;   // 没挂时走 <a> 原生跳转（href=setup.html）；挂了由 click 监听拦下
    chip.classList.toggle('exec-paired', !!h.paired);
    if (h.paired) {
      chip.textContent = '🖐 ' + who + (h.online ? ' · 在线' : ' · 离线') + (h.tier ? ' · ' + h.tier + '档' : '')
        + (j.killed ? ' · 🔴熔断中' : '');
      chip.style.cursor = '';
      chip.title = latest
        ? '执行器：' + (h.label || '') + '　最近活动：' + latest.text
        : '执行器：' + (h.label || '') + '　（还没动静）';
      if (latest) chip.textContent += ' · ' + String(latest.text).slice(0, 24);
    } else {
      /* 免费档/演示号没有下载入口：顶栏这颗也不写「去装」（点进去装机页只会让他看档位） */
      const noHand = !!(window.XhsExecBar && guideAcct &&
        (XhsExecBar.isDemo(guideAcct) || !XhsExecBar.isPaid(guideAcct)));
      chip.textContent = noHand ? '🖐 执行器：239 起档位带的 · 看怎么开' : '🖐 执行器：还没挂 · 去装';
      chip.style.cursor = 'pointer';
      chip.title = noHand ? '执行器是 239 起档位带的——开通后回装机页就有下载和配对号'
        : '还没挂执行器——下载装上、登录挂线后，这里会显示它在干什么';
    }
    if (stopBtnEl) stopBtnEl.style.display = h.paired ? '' : 'none';   // 没挂执行器时不摆这两个钮
    if (unBtnEl) unBtnEl.style.display = h.paired ? '' : 'none';
    if (latest) {
      const key = latest.t + '|' + latest.text;
      if (key !== lastReportKey) {
        if (lastReportKey) pushLog(latest.text, /⚠️|出错/.test(latest.text) ? 'warn' : (/✅/.test(latest.text) ? 'success' : 'info'));
        lastReportKey = key;
      }
    }
  }

  /* ── 装机引导横幅（2026-10-23）：顶栏下面那一条，跟起始页同一条、同一份判断 ──
     档位/演示号/配对号吃 /api/auth/me 那一份（服务器不加字段），挂没挂吃这里每 5 秒的 hand；
     hand.paired 由 false 变 true 的那一刻出绿条（点「知道了」或刷新就收）。 */
  let guideAcct = null, guideHost = null, guidePaired = null, guideCelebrate = false;

  function ensureGuideHost() {
    if (guideHost && document.body.contains(guideHost)) return guideHost;
    const hdr = document.querySelector('.header');
    if (!hdr || !hdr.parentNode) return null;
    const box = document.createElement('div');
    box.id = 'execGuideBar';
    box.style.cssText = 'padding:12px 16px 0;';
    hdr.parentNode.insertBefore(box, hdr.nextSibling);
    guideHost = box;
    return box;
  }
  function paintGuide(online) {
    const host = ensureGuideHost();
    if (!host || !window.XhsExecBar || !guideAcct) return;
    if (!guidePaired) host.dataset.acked = '';        // 回到「还没挂」态（解绑/换机）：横幅照旧能浮
    if (guidePaired && host.dataset.acked === '1') { host.innerHTML = ''; return; }   // 绿条点过「知道了」就不再弹
    XhsExecBar.mount(host, guideAcct,
      { paired: !!guidePaired, online: !!online, justPaired: guidePaired && guideCelebrate }, 'bench');
  }
  async function loadGuideAcct() {
    try {
      const r = await fetch('api/auth/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      guideAcct = (j && j.account) || null;
      if (guideAcct) { paintGuide(false); if (!guidePaired) tick(); }   // 账号到了才认得档位：顶栏那颗重画一次
    } catch (_) {}
  }
  function guideFromHand(h) {
    const paired = !!h.paired;
    if (guidePaired === false && paired) guideCelebrate = true;
    guidePaired = paired;
    paintGuide(h.online);
  }

  /* ── 挂线与轮询 ── */
  function boot() {
    if (NO_STRIP) {
      log('出片页桥已就位：只挂出片下单口');
      return;
    }
    patchRuntime();
    patchRefreshClick();
    let tries = 0;
    (function waitBot() {
      if (patchBot() || tries++ > 60) return;
      setTimeout(waitBot, 500);
    })();
    let tries2 = 0;
    (function waitBatchSend() {
      if (patchBatchSend() || tries2++ > 120) return;
      setTimeout(waitBatchSend, 500);
    })();
    ensureStrip();
    loadGuideAcct();
    tick();
    setInterval(tick, 5000);
    log('执行器桥已就位（开始/停止、搜索、截流、评刷、整页发送、私信、监听 → 下单；状态带在顶栏右上角）');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
