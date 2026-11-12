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

  /* ── 「⏸ 暂停 / ▶ 继续」：让执行器停在下一个检查点（不结束这一趟、不丢进度）──
     服务器记一笔 pauseOn，长轮询挂着就当场送；执行器忙着跑活就靠 15 秒心跳补。 */
  async function pauseRun(on) {
    try {
      const r = await fetch('api/exec/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !!on }),
      });
      const j = await r.json();
      if (j && j.demo === 'need-account') return { ok: false, error: j.error || '先登录' };
      if (!j || !j.ok) return { ok: false, error: (j && j.error) || '服务器没受理' };
      return { ok: true, delivered: !!j.delivered, on: !!j.on };
    } catch (e) { return { ok: false, error: '暂停没送到服务器：' + e.message }; }
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

  /* 🔧 一次性迁移（2026-10-28 晚）：每轮上限改叫「每个词最多打开几篇」，出厂 20 篇。
     配置真源在这一侧（执行器那本账每次下单都被快照盖掉），所以迁移必须落在网页这本。
     只把还停在老默认（3 篇 / 上一版迁移给的 10 篇）的调到 20；手动改过的不动。 */
  async function migrateRoundCap20() {
    try {
      const F = 'perround_bumped_20';
      const r = await chrome.storage.local.get(['note_trend_config', 'auto_water_config', F]);
      if (!r || r[F]) return;
      const nt = r.note_trend_config || null;
      const aw = r.auto_water_config || null;
      const sch = (aw && aw.schedule) || {};
      const old = (v) => { const n = Number(v); return n === 3 || n === 10; };
      const out = {};
      if (nt && old(nt.maxPerRound)) out.note_trend_config = Object.assign({}, nt, { maxPerRound: 20 });
      if (aw && old(sch.perRound)) out.auto_water_config = Object.assign({}, aw, { schedule: Object.assign({}, sch, { perRound: 20 }) });
      out[F] = Date.now();
      await chrome.storage.local.set(out);
    } catch (_) {}
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

  /* ── ① 工作台的「开始 / 停止 / 暂停」：不管机器人脚本有没有先加载，点了就一定给执行器发单 ──
     以前这三颗钮靠「等 window.AutoBot 出现再改它的方法」接上；页面加载慢、或按钮先出现时，
     点了只在本页翻个样子，执行器那头什么也没收到。现在直接在页面最外层接住点击，不再往下传。 */
  let lastInflight = false;
  let localStopAt = 0;

  const botHandle = () => window.AutoBot || null;

  async function doStart() {
    // 口径 × 节奏 ＋ 这次跑多少条（0/空＝不限）
    const scope = (document.getElementById('botScopeSel') || {}).value || 'all';
    const pace = (document.getElementById('botPaceSel') || {}).value || 'interval';
    const qEl = document.getElementById('botRunQuota');
    const runQuota = Math.max(0, parseInt((qEl && qEl.value), 10) || 0);
    const b = botHandle();
    localStopAt = 0;
    lastInflight = true;      // 先当"在跑"：连点两下也别又发一单
    if (b) { b.running = true; b.paused = false; try { b._updateUI(true); } catch (_) {} }
    benchNotice('已把这一轮派给执行器，等它接……');
    /* manual:true＝老板亲手点的这一下：静默期也跑（只这一趟）
       queueBehind:true＝机器正忙时点的那一下：排到队尾，等手上这一小段跑完接着跑（不会打断正在跑的） */
    const r = await order('acquire', { scope: scope, pace: pace, manual: true, queueBehind: true, runQuota: runQuota });
    if (!r.ok) {
      lastInflight = false;
      if (b) { b.running = false; try { b._updateUI(false); } catch (_) {} }
      benchNotice('下单没成：' + r.error, 'error');
      say('下单没成：' + r.error, 'error');
      return r;
    }
    const msg = r.delivered
      ? '执行器在线，当场开跑（进度看下面）'
      : (r.ahead > 0
        ? `已排队，前面还有 ${r.ahead} 段——手上这段跑完就接着跑`
        : '执行器不在线——单排着了，等它上线就跑');
    benchNotice(msg, 'success');
    say(msg, 'success');
    return r;
  }

  async function doStop() {
    const b = botHandle();
    localStopAt = Date.now();
    lastInflight = false;
    if (b) { b.running = false; b.paused = false; try { b._updateUI(false); } catch (_) {} }
    benchNotice('已让执行器停这一趟……');
    const r = await stopRun();
    if (!r.ok) {
      benchNotice('喊停没送到：' + r.error, 'error');
      say('喊停没送到：' + r.error, 'error');
      return r;
    }
    benchNotice('已送出「停这一趟」', 'success');
    say('已送出「停这一趟」', 'success');
    return r;
  }

  async function doPause(want) {
    const b = botHandle();
    if (b) { b.paused = !!want; try { b._updateUI(true); } catch (_) {} }
    benchNotice(want ? '已让执行器暂停：这一步做完就停下等……' : '已让执行器继续……');
    const r = await pauseRun(want);
    if (!r.ok) {
      if (b) { b.paused = !want; try { b._updateUI(true); } catch (_) {} }
      benchNotice((want ? '暂停' : '继续') + '没送到：' + r.error, 'error');
      say((want ? '暂停' : '继续') + '没送到：' + r.error, 'error');
      return r;
    }
    const done = want ? '已暂停：这一步做完就停下等（点「继续」接着跑）' : '已继续，接着跑';
    benchNotice(done, want ? 'warn' : 'success');
    say(done, want ? 'warn' : 'success');
    return r;
  }

  function wireBenchButtons() {
    if (document.__benchBtnsWired) return;
    document.__benchBtnsWired = true;
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('#botToggleBtn, #botPauseBtn') : null;
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();     // 别再让旧的处理再发一遍
      if (t.id === 'botPauseBtn') { const b = botHandle(); doPause(!(b && b.paused)); return; }
      const b = botHandle();
      if ((b && b.running) || lastInflight) doStop();
      else doStart();
    }, true);
    log('已直接接管工作台的「开始 / 停止 / 暂停」→ 给执行器下单（不等机器人脚本先加载）');
  }

  /* ── 机器人的方法也接到同一套动作上（程序里调到 start/stop/pause 时也真的是发单）── */
  function patchBot() {
    const bot = window.AutoBot;
    if (!bot) return false;
    if (bot.__orderedBridge) return true;
    bot.__orderedBridge = true;

    bot.start = function () { return doStart(); };
    bot.stop = function () { return doStop(); };
    bot.pause = function () { return doPause(true); };
    bot.resume = function () { return doPause(false); };
    bot.togglePause = function () { return doPause(!bot.paused); };

    log('已接管队列页的「🤖 开始 / ⏹ 停止 / ⏸ 暂停」→ 给执行器下单');
    return true;
  }

  /* ── 工作台上那条「点了有没有用」的提示：摆在「现在在干」上面一行，不再只往收着的日志里写 ── */
  let noticeEl = null, noticeTimer = 0, noticeWanted = false;

  function benchNotice(text, type) {
    const live = document.getElementById('benchLive');
    if (!live || !live.parentNode) return;
    if (!noticeEl || !document.body.contains(noticeEl)) {
      noticeEl = document.createElement('div');
      noticeEl.id = 'benchNotice';
      live.parentNode.insertBefore(noticeEl, live);
    }
    const s = String(text || '').trim();
    const tone = type === 'error' ? ['#fef2f2', '#b91c1c', '#fca5a5']
      : type === 'warn' ? ['#fffbeb', '#92400e', '#fcd34d']
        : type === 'success' ? ['#f0fdf4', '#166534', '#86efac']
          : ['#eff6ff', '#1e40af', '#bfdbfe'];
    const ico = type === 'error' ? '⚠️ ' : type === 'success' ? '✅ ' : type === 'warn' ? '⏸ ' : 'ℹ️ ';
    noticeEl.style.cssText = 'margin:0 0 8px;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.6;'
      + 'background:' + tone[0] + ';color:' + tone[1] + ';border:1px solid ' + tone[2] + ';';
    noticeEl.textContent = s ? ico + s : '';
    noticeWanted = !!s;
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = 0; }
    if (s && type !== 'error') {
      noticeTimer = setTimeout(() => { noticeWanted = false; syncBenchChrome(); }, 20000);
    }
    syncBenchChrome();
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
      scenario: String(d.scenario || ''), force: !!d.force,
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
    const r = await order('acquire', { op: 'scan' });
    if (!r.ok) { say('扫描没派成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say(r.delivered ? '执行器在线，正在逐词扫来源……' : '执行器不在线——单排着了', 'success');
    return ordered(r);
  }

  async function onDrainReplenish() {
    say('补开未打开已派给执行器……');
    /* manual:true＝手点的那一下：这一趟放静默期，只这一趟 */
    const r = await order('acquire', { op: 'backfill', manual: true });
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
      scope: 'all', pace: 'once', manual: true,
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

  /* ── 「去登录」（2026-11-04）：网页不自己开登录页，派一单让装执行器的那台电脑打开、等人扫码 ──
     顶栏红标 / 发笔记工作台红字 /「今天」小窗共用这一张口。 */
  window.__xhsExecRelogin = async function (platform) {
    const p = String(platform || 'xhs');
    const nm = ({ xhs: '小红书', douyin: '抖音', channels: '视频号' })[p] || '平台';
    const r = await order('relogin', { platform: p });
    if (!r.ok) { say('让那台电脑打开' + nm + '登录页没成：' + r.error, 'error'); return { ok: false, error: r.error }; }
    say('已经让装执行器的那台电脑打开' + nm + '登录页——去它屏幕上扫码，登好这里自己变回来');
    return { ok: true, cmdId: r.cmdId };
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
     2026-10-29 起顶栏那颗「执行器」链接归账号用（只写「哪一档 · 绑没绑」，点开是绑定教程），
     这里不再抢它：有右上账号菜单的页面 → 两颗钮摆进菜单里；没有菜单的页面（自测 / 老副本）
     → 退回原来的样子，链接当状态灯。出片页仍不摆。 */
  let strip = null, chip = null, stopBtnEl = null, unBtnEl = null;

  /* ── 停手横幅（2026-10-23）：搜索链被账号安全/静默期/登录过期/搜索失败挡下时，网页顶上醒目提醒。
     登录过期红条、其它橙条，都点「知道了」收起；手动「停这一趟」不弹（服务器直接撤链，这里读不到 stopped）。 ── */
  let execBanner = null, execBannerKey = '', execBannerDismissed = '', execBannerTitle = null, execBannerBody = null, execBannerLink = null;

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
    version: { red: false, href: 'setup.html', linkText: '去更新',
      title: '🔄 这台电脑上的执行器要更新一下',
      body: '版本对不上，网页派的活会先发不过去。点右边下载新包，解压后双击「更新.bat」，装好按一下浏览器的「重新加载」，活就能接着派。' },
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
    const link = document.createElement('a');
    link.href = 'setup.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'flex:none;display:none;border-radius:6px;padding:4px 10px;font-size:12px;'
      + 'text-decoration:none;cursor:pointer;font-family:inherit;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '知道了';
    btn.style.cssText = 'flex:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;';
    btn.addEventListener('click', () => { execBannerDismissed = execBannerKey; box.style.display = 'none'; });
    box.appendChild(txt);
    box.appendChild(link);
    box.appendChild(btn);
    document.body.appendChild(box);
    execBannerLink = link;
    execBanner = box;
    return box;
  }

  function showExecBanner(kind, key, bodyText) {
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
    if (execBannerLink) {
      if (b.href) {
        execBannerLink.href = b.href;
        execBannerLink.textContent = b.linkText || '去处理';
        execBannerLink.style.display = 'inline-block';
        execBannerLink.style.border = '1px solid ' + (b.red ? '#fca5a5' : '#fdba74');
        execBannerLink.style.background = '#fff';
        execBannerLink.style.color = b.red ? '#991b1b' : '#9a3412';
      } else {
        execBannerLink.style.display = 'none';
      }
    }
    if (execBannerDismissed === key) { box.style.display = 'none'; return; }
    if (execBannerKey !== key) {
      execBannerKey = key;
      execBannerTitle.textContent = b.title;
      execBannerBody.textContent = bodyText || b.body;
      box.style.display = 'flex';
    }
  }

  /* 认号对不上 / 没登录（2026-10-23）：只停那一个平台，另一个照跑。
     文案直接摊开「绑的是谁、这台现在登的是谁」，客户自己就能判断怎么处理。 */
  const BIND_LABEL = { xhs: '小红书', douyin: '抖音' };
  /* 掉登录 / 登错号：认号结果每 5 秒随这趟回来，喂给顶栏右侧那颗红标（web/popup.js 里的 XhsLoginAlert）。
     红标画得出来的页面就不再叠那条浮层红条；没有红标位的页面（老副本）红条继续兜底。 */
  function feedLoginAlert(j, orders) {
    if (!window.XhsLoginAlert) return false;
    window.XhsLoginAlert.setAcc({ bindState: j.bindState, bindings: j.bindings });
    const pending = (orders || []).some((c) => c && c.kind === 'relogin' && (c.state === 'queued' || c.state === 'sent'));
    window.XhsLoginAlert.setPending(pending);
    return window.XhsLoginAlert.rows().length > 0 && !!document.getElementById('hdrLoginAlert');
  }

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
    if (execBannerLink) execBannerLink.style.display = 'none';
    if (execBannerDismissed === a.key) { box.style.display = 'none'; return; }
    if (execBannerKey !== a.key) {
      execBannerKey = a.key;
      execBannerTitle.textContent = a.title;
      execBannerBody.textContent = a.body;
      box.style.display = 'flex';
    }
  }

  /* 老板暂停（2026-10-25）：顶栏下一行灰字，不弹红、不挡操作；恢复后自己收掉 */
  let pauseLine = null;
  function paintPauseLine(pause) {
    const ps = [];
    if (pause && pause.xhs) ps.push('小红书这头：老板暂停了获客');
    if (pause && pause.douyin) ps.push('抖音这头：老板暂停了发笔记和获客');
    if (!ps.length) {
      if (pauseLine) { pauseLine.remove(); pauseLine = null; }
      return;
    }
    if (!pauseLine || !document.body.contains(pauseLine)) {
      const hdr = document.querySelector('.header');
      if (!hdr || !hdr.parentNode) return;
      pauseLine = document.createElement('div');
      pauseLine.id = 'execPauseLine';
      pauseLine.style.cssText = 'background:#f3f4f6;color:#6b7280;border-bottom:1px solid #e5e7eb;'
        + 'font-size:12px;line-height:1.6;padding:5px 16px;font-family:inherit;';
      hdr.parentNode.insertBefore(pauseLine, hdr.nextSibling);
    }
    pauseLine.textContent = ps.join('；') + '（恢复后自动接着派，正在跑的那一趟不受影响）';
  }

  const MINI_CSS = 'border:1px solid var(--c-line-2);background:var(--c-surface);color:var(--c-ink-3);'
    + 'border-radius:var(--r-sm);height:28px;padding:0 8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;';

  async function onStopClick(btn) {
    btn.disabled = true;
    const r = await stopRun();
    say(r.ok ? '已送出「停这一趟」' : '喊停没送到：' + r.error, r.ok ? 'success' : 'error');
    setTimeout(() => { btn.disabled = false; }, 1200);
  }
  async function onUnbindClick(btn) {
    if (!window.confirm('解绑这台电脑？\n解绑后这台浏览器就不再干活了（正在跑的活会停下）；换新电脑时在新电脑上登录挂线即可。')) return;
    btn.disabled = true;
    const r = await unpair();
    say(r.ok ? '已解绑这台电脑——可在新电脑上重新登录挂线' : '解绑没成：' + r.error, r.ok ? 'success' : 'error');
    setTimeout(() => { btn.disabled = false; tick(); }, 1200);
  }
  function makeExecBtns(css) {
    stopBtnEl = document.createElement('button');
    stopBtnEl.type = 'button';
    stopBtnEl.textContent = '⏹ 停这一趟';
    stopBtnEl.style.cssText = css + 'display:none;';
    stopBtnEl.addEventListener('click', () => onStopClick(stopBtnEl));
    /* D 期：「解绑这台电脑」——换机前先摘线 / 旧电脑丢了也能把线摘掉 */
    unBtnEl = document.createElement('button');
    unBtnEl.type = 'button';
    unBtnEl.textContent = '解绑';
    unBtnEl.title = '把这只执行器从服务器摘掉（换电脑前 / 旧电脑不要了）——之后可在新电脑重新登录挂线';
    unBtnEl.style.cssText = css + 'display:none;';
    unBtnEl.addEventListener('click', () => onUnbindClick(unBtnEl));
  }

  function ensureStrip() {
    if (strip && document.body.contains(strip)) return strip;
    /* 公网版：顶栏那颗链接已经改成「哪一档 · 绑没绑」（点开是绑定教程），执行器不再占它；
       这两颗钮摆进右上账号菜单，接着「执行器」那一行。 */
    const ops = document.getElementById('hdrExecOps');
    if (ops) {
      strip = ops;
      chip = null;
      makeExecBtns(MINI_CSS);
      ops.appendChild(stopBtnEl);
      ops.appendChild(unBtnEl);
      return strip;
    }
    const hdr = document.querySelector('.hdr-right');
    const link = hdr && hdr.querySelector('a.hdr-link[href="setup.html"]');
    if (link) {
      /* 没有账号菜单的页面（自测 / 老副本）：照旧点亮那颗按钮当状态灯 */
      chip = link;
      strip = hdr;
      chip.textContent = '🖐 执行器：查询中…';
      chip.style.maxWidth = 'min(46vw, 420px)';
      chip.style.overflow = 'hidden';
      chip.style.textOverflow = 'ellipsis';
      chip.removeAttribute('target');
      chip.addEventListener('click', (ev) => { if (chip.classList.contains('exec-paired')) ev.preventDefault(); });
      makeExecBtns(MINI_CSS);
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
    makeExecBtns(darkCss);
    stopBtnEl.style.display = '';
    unBtnEl.style.display = '';
    strip.appendChild(chip);
    strip.appendChild(stopBtnEl);
    strip.appendChild(unBtnEl);
    document.body.appendChild(strip);
    return strip;
  }

  /* ── 工作台那两块（2026-10-28 确认单）──
     ①「现在在干」：一句话说清队列跑到哪（第几项×词×类 / 最近一个动作 / 执行器在不在线）；
     ② 操作日志：执行器干活时每 1.5 秒往回凑一句，这里按条补齐、带时间。
     句子全部来自执行器自己的回传（/api/exec/orders 里的 reports），网页这边只做归拢、排版、去重。
     两块都只在「工作台」那一页出现（下面 syncBenchChrome 按 mainContent 显没显来收放）。 */
  const seenReport = new Set();   // 已经画过的行（时间＋来源＋内容）——同一句不画两遍
  let logFollow = true;           // 跟着滚：新日志来了滚到底
  let logFolded = true;           // 默认收着：只留标题栏，点「▴ 展开日志」才铺开
  let logFirstFill = true;        // 首屏只铺最近 80 条，别一上来刷几百行
  let liveSig = '';               // 状态条上一次的样子（没变就别重画，免得绿点动画每 5 秒抖一下）

  const benchEls = () => ({
    box: document.getElementById('benchLive'),
    qbar: document.getElementById('benchQueueBar'),
    wrap: document.getElementById('logWrap'),
    panel: document.getElementById('logPanel'),
    count: document.getElementById('logCount'),
  });

  const clock8 = (t) => String(t == null ? '' : t).slice(0, 8);
  const pad2 = (n) => String(n).padStart(2, '0');
  const hms = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  const dayKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  /* 回执时间：新账本每行带 at（毫秒，服务器按本机时区给），老账本只有 t 字符串——那批时间戳一半是 UTC、
     一半是本地，没法还原成哪天。所以一律以 at 为准，没有 at 的老行当「不是今天」，工作台只铺当天的。 */
  function reportTime(r) {
    const at = Number(r && r.at) || 0;
    if (at) { const d = new Date(at); return { at, tm: hms(d), day: dayKey(d) }; }
    return { at: 0, tm: clock8(r && r.t), day: '' };
  }
  const hhmm = (ms) => {
    const n = Number(ms) || 0;
    if (!n) return '';
    const d = new Date(n);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const mmss = (ms) => {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  /* 队列项的类型名带小图标（「💬 最新」）——状态条上只要字 */
  const stripIco = (s) => String(s || '').replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '').trim();

  /* 一条回执拆成行：执行器会把几行凑在一条里（用 ｜ 隔开），拆开才看得清。
     文字头上可能叠了两三层 🤖（执行器自己一顶、回传口再一顶），只留左侧那一颗来源图标。 */
  function reportLines(r) {
    let text = String((r && r.text) || '');
    let src = '🖐';
    if (/^🤖/.test(text)) { src = '🤖'; text = text.replace(/^(?:🤖\s*)+/, ''); }
    return text.split('｜').map((s) => s.trim()).filter(Boolean).map((s) => ({ src, text: s }));
  }

  /* 技术行（打开笔记／已打开／跑法／处理完毕／返回列表）压暗：照铺，但别跟评论、结果、失败抢眼 */
  const DIM_RE = /^(?:📄\s*打开笔记|✅\s*笔记已打开|✅\s*笔记 ".*?" 处理完毕|⚡\s*跑法|⬅\s*返回列表)/;

  function logLineType(text) {
    if (/^❌|^🔴|^🛑/.test(text)) return 'error';
    if (/⚠️|出错|没跑成|失败/.test(text)) return 'warn';
    if (DIM_RE.test(text)) return 'dim';
    if (/^✅|^🏁/.test(text)) return 'success';
    return 'info';
  }

  function logCountPaint() {
    const { panel, count } = benchEls();
    if (!panel || !count) return;
    const n = panel.querySelectorAll('.log-entry').length;
    count.textContent = n ? '（今天 ' + n + ' 条 · 点顶栏「📜 运行日志」能按天往回翻）' : '';
  }

  function panelScrollTail() {
    const { panel } = benchEls();
    if (panel && logFollow) panel.scrollTop = panel.scrollHeight;
  }

  /* 占位那句只按 id 撤，别整块清空——本机那两块先写的行不能一起被抹掉 */
  function clearPh(panel) {
    if (!panel) return;
    const ph = panel.querySelector('#logPh');
    if (ph) { ph.remove(); panel.dataset.ph = '0'; return; }
    if (panel.dataset.ph === '1') { panel.innerHTML = ''; panel.dataset.ph = '0'; }
  }

  /* 画一条日志行（同一句画过就跳过） */
  function paintLogLine(t, src, text) {
    const { panel } = benchEls();
    if (!panel) return false;
    const key = clock8(t) + '|' + src + '|' + text;
    if (seenReport.has(key)) return false;
    seenReport.add(key);
    clearPh(panel);
    panel.querySelectorAll('.log-entry.new').forEach((x) => x.classList.remove('new'));
    const d = document.createElement('div');
    d.className = 'log-entry ' + logLineType(text) + ' new';
    d.title = text;
    const tm = document.createElement('span');
    tm.className = 'log-time';
    tm.textContent = clock8(t);
    const sc = document.createElement('span');
    sc.textContent = src;
    sc.style.cssText = 'margin-right:6px;font-size:11px';
    d.appendChild(tm); d.appendChild(sc);
    d.appendChild(document.createTextNode(text));
    panel.appendChild(d);
    while (panel.children.length > 400) panel.removeChild(panel.firstChild);
    panelScrollTail();
    return true;
  }

  function paintReports(reports) {
    const list = Array.isArray(reports) ? reports : [];
    if (!list.length) return;
    /* 只铺当天的：服务器那本环形账跨天留着，昨天的几趟混进来，看着就像「没在动」 */
    const today = dayKey(new Date());
    const todays = list.filter((r) => reportTime(r).day === today);
    if (!todays.length) return;
    let batch = todays;
    if (logFirstFill) { batch = todays.slice(-80); logFirstFill = false; }
    let n = 0;
    batch.forEach((r) => {
      const tm = reportTime(r).tm;
      reportLines(r).forEach((ln) => { if (paintLogLine(tm, ln.src, ln.text)) n++; });
    });
    if (n) logCountPaint();
  }

  /* 日志里「打开笔记」那行：老写法是 (N/M)；2026-11-10 起执行器报的是
     (这一趟第 N 篇 · 本屏 X/Y)——本屏会翻屏、X 会从 1 重数，所以「第几篇」按这一趟算。 */
  function noteOpenMatch(x) {
    const t = String(x || '');
    let m = t.match(/^📄\s*打开(?:增长)?笔记\s*"(.+)"\s*\(\s*这一趟第\s*(\d+)\s*篇\s*·\s*本屏\s*(\d+)\/(\d+)\s*\)/);
    if (m) return { title: m[1], idx: Number(m[2]), total: Number(m[4]), screen: Number(m[3]), screenTotal: Number(m[4]) };
    m = t.match(/^📄\s*打开(?:增长)?笔记\s*"(.+)"\s*\((\d+)\/(\d+)\)/);
    return m ? { title: m[1], idx: Number(m[2]), total: Number(m[3]) } : null;
  }

  /* 把一叠回执读出「跑到哪」：队列项、当前打开哪篇、刚发了什么、下一个到点、这一轮的战果
     （2026-11-05 改：只报「这一趟」——遇到开跑那句或第 1 项就从零算；
       收人分「这一趟 / 今天」；另算一句「现在这一步」，跑的时候卡片直接显示） */
  function readProgress(reports) {
    const out = {
      pos: null, nextAt: '', summary: null, last: null, badLine: null, tailBad: false,
      note: null,   // 这一趟最后打开的那篇：{ title, idx, total, t }
      said: null,   // 刚发出去的那句：{ kind:'note'|'reply'|'bad', text, t, bad }
      lastAt: 0,    // 今天最后一条回执的时刻（毫秒）——没有队单时靠它判断「本机手点开的这趟还在不在动」
      waits: null,  // 正在等下一项到点：{ at:'19:50', t }
      paused: null, // 点了暂停：{ t }
      ended: false, endedOk: false,   // 最后一句是收尾（🏁 跑完 / ⏹ 停了）
      step: null,             // 现在这一步：{ text, t }
      runCount: null,         // 这一趟跑了几项（🏁 那句里带的「本次跑了 X 项」）
      runHadPos: false,       // 这一趟有没有见到「第 N 项」
      collectedRun: 0,        // 这一趟收进清单几个人
      collectedDay: 0,        // 今天一共收进清单几个人
    };
    const collectedRun = new Set();
    const collectedDay = new Set();
    const today = dayKey(new Date());
    /* 开跑：上一趟的笔记 / 评语 / 战果都不再算「现在」 */
    const runStart = () => {
      collectedRun.clear();
      out.pos = null; out.note = null; out.said = null; out.step = null;
      out.summary = null; out.runCount = null; out.runHadPos = false;
      out.ended = false; out.endedOk = false; out.waits = null; out.paused = null; out.nextAt = '';
    };
    (Array.isArray(reports) ? reports : []).forEach((r) => {
      const rt = reportTime(r);
      if (rt.day !== today) return;
      if (rt.at > out.lastAt) out.lastAt = rt.at;
      reportLines(r).forEach((ln) => {
        const x = ln.text;
        if (/^=+\s*自动灌水启动/.test(x)) runStart();
        out.last = { t: rt.tm, text: x };
        let m = x.match(/^▶ 第 (\d+)(?: 项| 次搜索| 次主页扫描| 轮)：(.+?) × 「(.+?)」/);
        if (m) {
          if (Number(m[1]) === 1 && out.runHadPos) runStart();
          out.pos = { seq: Number(m[1]), kind: stripIco(m[2]), kw: m[3], t: rt.tm };
          out.runHadPos = true;
          out.nextAt = ''; out.waits = null; out.paused = null; out.ended = false; out.endedOk = false;
        }
        m = x.match(/^⏳ 第 \d+ 项跑完。队列里的下一项将于 (\d{1,2}:\d{2}) 自动开始/);
        if (m) { out.nextAt = m[1]; out.waits = { at: m[1], t: rt.tm }; out.ended = false; }
        if ((m = x.match(/^⏸ 已暂停/))) { out.paused = { t: rt.tm }; out.waits = null; }
        else if (/^▶ 已继续/.test(x)) out.paused = null;
        else if (/^🏁/.test(x)) { out.ended = true; out.endedOk = true; out.waits = null; out.paused = null; }
        else if (/^⏹|^⏸ =====|^🛑|^❌|^🔴/.test(x)) { out.ended = true; out.endedOk = false; out.waits = null; out.paused = null; }
        if ((m = x.match(/本次跑了\s*(\d+)\s*项/))) out.runCount = Number(m[1]);
        const openM = noteOpenMatch(x);
        if (openM) {
          out.note = { title: openM.title, idx: openM.idx, total: openM.total, t: rt.tm };
          out.said = null;   // 换了篇：上一篇的评语不再算「刚发」
        } else if ((m = x.match(/^✅ 已发一级评论(?:（(.+?)）)?：(.+)$/))) {
          out.said = { kind: 'note', run: m[1] || '', text: m[2], t: rt.tm, bad: false };
        } else if ((m = x.match(/^⚠️\s*一级评论发送失败：(.+)$/))) {
          out.said = { kind: 'bad', text: '一级评论发送失败：' + m[1], t: rt.tm, bad: true };
        } else if ((m = x.match(/^✅\s*@(.+?)\s*发送成功$/))) {
          out.said = { kind: 'reply', who: m[1], text: '已回复 @' + m[1], t: rt.tm, bad: false };
        }
        if ((m = x.match(/^🕵️\s*已收进获客清单：@(.+?)(?:（|$)/))) { collectedRun.add(m[1]); collectedDay.add(m[1]); }
        m = x.match(/(?:获客|日常浏览)跑完一轮：搜到 (\d+) 篇 · 评论 (\d+) 条/);
        if (m) out.summary = { found: Number(m[1]), comments: Number(m[2]), t: rt.tm };
        if (/^⚠️|^⏸|^⏹|^🛑|^❌|^🔴/.test(x)) out.badLine = { t: rt.tm, text: x };
        const st = stepOf(x);
        if (st) out.step = { text: st, t: rt.tm };
      });
    });
    out.collectedRun = collectedRun.size;
    out.collectedDay = collectedDay.size;
    if (out.summary) { out.summary.collectedRun = out.collectedRun; out.summary.collectedDay = out.collectedDay; }
    /* 最后落的一句话是「⚠️ / ⏸」那类：这一趟其实是停住了，别报「跑完」 */
    out.tailBad = !!(out.last && /^⚠️|^⏸|^🛑|^❌|^🔴/.test(out.last.text));
    return out;
  }

  /* 日志里最后一句 → 一句「现在在干什么」。看不懂的句子不硬编，卡片就不显示这一步 */
  function stepOf(x) {
    const t = String(x || '');
    let m;
    if ((m = t.match(/^🔍\s*搜「(.+?)」的\s*(.+)$/))) return '正在搜「' + m[1] + '」· ' + stripIco(m[2]).slice(0, 18);
    if (/等这一轮搜索真跑完/.test(t)) return '正在等搜索结果回来';
    if (/^🔎\s*「.+?」×.+?：排序已点上/.test(t)) return '正在按排序挑笔记';
    if (/排序没点上/.test(t)) return '排序没点上，按页面顺序继续';
    if (/换词没成功|换词后页面/.test(t)) return '换词没成功，这一行先跳过';
    if ((m = t.match(/搜索完成，这一轮名单\s*(\d+)\s*篇/))) return '搜到 ' + m[1] + ' 篇，准备打开第一篇';
    const om = noteOpenMatch(t);
    if (om) {
      if (om.screen) return '正在打开第 ' + om.idx + ' 篇（本屏 ' + om.screen + '/' + om.screenTotal + '）';
      return '正在打开第 ' + om.idx + '/' + om.total + ' 篇';
    }
    if (/笔记已打开/.test(t)) return '笔记已打开，正在读正文和评论区';
    if (/返回列表/.test(t)) return '正在返回列表';
    if (/^✅\s*已发一级评论/.test(t)) return '刚发了一条一级评论';
    if ((m = t.match(/^✅\s*@(.+?)\s*发送成功/))) return '刚回复了 @' + m[1];
    if ((m = t.match(/^🕵️\s*已收进获客清单：@(.+?)(?:（|$)/))) return '正在收人进清单（刚收 @' + m[1] + '）';
    if (/处理完毕/.test(t)) return '这一篇处理完了';
    if (/所有笔记处理完成/.test(t)) return '这一行的笔记都处理完了';
    if ((m = t.match(/^⏭\s*(.+)$/))) return '跳过一篇：' + cutTitle(m[1], 26);
    if (/已滚动到搜索底部/.test(t)) return '搜索列表翻到底了';
    if (/滚动加载下一屏/.test(t)) return '正在加载下一屏笔记';
    return '';
  }

  /* 条上第二人行：标题超过 22 个字截断，鼠标停上去看全（(3/16) 单独一截，不跟着截） */
  function cutTitle(s, n) {
    const t = String(s || '');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  /* ── 现在在干：五种样子（没跑 / 已派下没接 / 在跑 / 跑完 / 停了）＋ 执行器没挂 ── */
  function paintLive(j) {
    const { box } = benchEls();
    if (!box) return;
    const h = (j && j.hand) || {};
    const orders = Array.isArray(j && j.orders) ? j.orders : [];
    const d = readProgress(j && j.reports);
    const cur = orders.find((c) => c && (c.state === 'queued' || c.state === 'sent')) || null;
    const last = orders.find((c) => c && (c.state === 'done' || c.state === 'failed')) || null;
    /* 服务器记的暂停旗子最准：执行器的「⏸」那行还没回传时，也别把停着的一趟说成「正在跑」 */
    if (j && j.botPause && j.botPause.on && cur && !d.paused) d.paused = { t: hhmm(j.botPause.at) };
    const who = h.name || '执行器';
    /* 没有在跑的队单时，凭回执自己看：本机手点「开始」开的这趟不走队单，
       只看回执里有没有比上一单更新的动静（10 分钟内算还在跑） */
    const orderAt = last ? (Number(last.doneAt || last.createdAt) || 0) : 0;
    const fresh = !!d.lastAt && d.lastAt > orderAt + 1000 && (Date.now() - d.lastAt < 10 * 60000);

    let cls = '', st = '', side = '', now = null, go = false;
    let noteRow = null;   // { title, idx, total, stale }——stale＝上一趟开的那篇，标「上次打开」
    let stepRow = null;   // 现在这一步：{ text, tm }
    let sayRow = null;    // { text, tm, bad, plain, icon }
    const staleNote = (n) => (n ? Object.assign({}, n, { stale: true }) : null);
    /* 收尾时摆什么：这一趟一项都没跑到就不要摆「搜到 0 篇 · 评论 0 条」 */
    const finishNow = () => {
      const noWork = d.runCount === 0 || (!d.runHadPos && !d.pos);
      if (noWork) return { type: 'none' };
      return d.summary ? { type: 'summary', summary: d.summary } : null;
    };
    if (!h.paired || !h.online) {
      st = '这个号的执行器没在线';
      sayRow = { text: h.paired ? '挂着线但没回话——去它那台电脑上看一眼' : '装上执行器、登录挂线后，这里就会显示它在干什么', plain: true, icon: '🖐' };
      if (h.paired && h.lastSeen) side = '最后见到它 ' + hhmm(h.lastSeen);
      go = true;
    } else if (cur && cur.state === 'queued') {
      cls = 'is-wait'; st = '已派给执行器，等它接';
      side = who + ' · 在线 · 已等 ' + mmss(Date.now() - (cur.createdAt || Date.now()));
      sayRow = { text: '队列单已经送到这台机器的门口', plain: true, icon: '⏳' };
    } else if (cur && cur.state === 'sent' && (d.paused || d.waits)) {
      /* 单子在跑，但机器人自己报了「暂停」/「等下一项到点」——别一律写成「正在跑」 */
      cls = 'is-wait';
      st = d.paused ? '已暂停' : '在等时间';
      side = who + ' · 在线' + (cur && cur.state === 'sent' && d.nextAt ? ' · 下一项 ' + d.nextAt : '') + (j.killed ? ' · 🔴熔断中' : '');
      noteRow = d.waits ? staleNote(d.note) : null;
      sayRow = {
        text: d.paused ? '你点了暂停，点工作台上的「▶ 继续」接着跑' : ('这一项跑完了，' + d.waits.at + ' 自动接着跑'),
        tm: (d.paused || d.waits).t,
        plain: true,
        icon: d.paused ? '⏸' : '⏳',
      };
    } else if (cur && cur.state === 'sent' && d.ended && (Date.now() - d.lastAt < 2 * 60000)) {
      /* 机器人已经报了收尾、单子还没被服务器标完成：这一小会儿别接着说「正在跑」 */
      cls = d.endedOk ? 'is-done' : 'is-stop';
      st = d.endedOk ? '这一趟跑完了' : '这一趟停在半路';
      side = who + ' · 在线' + (j.killed ? ' · 🔴熔断中' : '');
      noteRow = staleNote(d.note);
      if (d.endedOk) now = finishNow();
      const eb = !d.endedOk && ((d.badLine && d.badLine.text) || (d.last && d.last.text));
      if (eb) sayRow = { text: eb, tm: (d.badLine && d.badLine.t) || (d.last && d.last.t) || '', bad: true, plain: true };
      else if (d.last && !(now && now.type === 'none')) sayRow = { text: d.last.text, tm: d.last.t, plain: true };
    } else if (cur && cur.state === 'sent') {
      cls = 'is-run'; st = '正在跑';
      if (d.pos) now = { type: 'pos', pos: d.pos };
      side = who + ' · 在线' + (d.nextAt ? ' · 下一个约 ' + d.nextAt : '') + (j.killed ? ' · 🔴熔断中' : '');
      noteRow = d.note;
      if (d.step) stepRow = d.step;
      else if (!d.note) stepRow = { text: '刚开跑，正在准备第一项', icon: '👉' };
      if (d.said) sayRow = { text: d.said.text, tm: d.said.t, bad: d.said.bad };
      else if (!d.note) sayRow = { text: '跑起来了，等它报第一句', plain: true, icon: '💬' };
    } else if (!cur && fresh && (d.paused || d.waits)) {
      /* 本机手点开的这趟：正在按计划歇着 */
      cls = 'is-wait';
      st = d.paused ? '已暂停' : '在等时间';
      side = who + (h.online ? ' · 在线' : ' · 离线') + (d.waits ? ' · 下一项 ' + d.waits.at : '');
      noteRow = d.waits ? staleNote(d.note) : null;
      sayRow = {
        text: d.paused ? '你点了暂停，点工作台上的「▶ 继续」接着跑' : ('这一项跑完了，' + d.waits.at + ' 自动接着跑'),
        tm: (d.paused || d.waits).t,
        plain: true,
        icon: d.paused ? '⏸' : '⏳',
      };
    } else if (!cur && fresh && !d.ended) {
      /* 本机手点开的这趟：正在操作——照队单在跑那样，把当前这一项、打开哪篇、刚发了什么都铺出来 */
      cls = 'is-run'; st = '正在跑';
      if (d.pos) now = { type: 'pos', pos: d.pos };
      side = who + (h.online ? ' · 在线' : ' · 离线');
      noteRow = d.note;
      if (d.step) stepRow = d.step;
      else if (!d.note) stepRow = { text: '刚开跑，正在准备第一项', icon: '👉' };
      if (d.said) sayRow = { text: d.said.text, tm: d.said.t, bad: d.said.bad };
      else if (!d.note) sayRow = { text: '跑起来了，等它报第一句', plain: true, icon: '💬' };
    } else if (!cur && d.ended && d.lastAt > orderAt) {
      /* 本机手点开的这趟已经收尾 */
      cls = d.endedOk ? 'is-done' : 'is-stop';
      st = d.endedOk ? '这一趟跑完（' + hhmm(d.lastAt) + '）' : '这一趟停住了';
      side = who + (h.online ? ' · 在线' : ' · 离线');
      noteRow = staleNote(d.note);
      if (d.endedOk) now = finishNow();
      const b = !d.endedOk && ((d.badLine && d.badLine.text) || (d.last && d.last.text));
      if (b) sayRow = { text: b, tm: (d.badLine && d.badLine.t) || (d.last && d.last.t) || '', bad: true, plain: true };
      else if (d.said) sayRow = { text: d.said.text, tm: d.said.t, bad: d.said.bad };
      else if (d.last && !(now && now.type === 'none')) sayRow = { text: d.last.text, tm: d.last.t, plain: true };
    } else if (last && last.state === 'done' && last.ok && d.tailBad) {
      /* 单子记的是「跑完」，可最后一句是 ⚠️/⏸/⏹（跑太久收尾、队列停在半路…）——照实说停，别报完成 */
      cls = 'is-stop'; st = '这一趟停住了';
      side = who + (h.online ? ' · 在线' : ' · 离线');
      noteRow = staleNote(d.note);
      const b = (d.badLine && d.badLine.text) || (d.last && d.last.text) || '没报原因';
      sayRow = { text: b, tm: (d.badLine && d.badLine.t) || (d.last && d.last.t) || '', bad: true, plain: true };
    } else if (last && last.state === 'done' && last.ok) {
      cls = 'is-done'; st = '这一趟跑完' + (last.doneAt ? '（' + hhmm(last.doneAt) + '）' : '');
      side = who + (h.online ? ' · 在线' : ' · 离线');
      noteRow = staleNote(d.note);
      now = finishNow();
      if (d.said) sayRow = { text: d.said.text, tm: d.said.t, bad: d.said.bad };
      else if (d.last && !(now && now.type === 'none')) sayRow = { text: d.last.text, tm: d.last.t, plain: true };
    } else if (last && last.state === 'failed') {
      cls = 'is-stop'; st = '停了';
      side = who + (h.online ? ' · 在线' : ' · 离线');
      noteRow = staleNote(d.note);
      /* 没跑成：回执自己写的 note 最准（如「浏览器被占用」），没写才拿日志里最后那句坏话 */
      sayRow = {
        text: last.note || (d.badLine && d.badLine.text) || '没跑成，原因没回',
        tm: (d.badLine && d.badLine.t) || (last.doneAt ? hhmm(last.doneAt) : ''),
        bad: true,
        plain: true,
      };
    } else {
      st = '今天还没开跑';
      side = who + (h.online ? ' · 在线' : ' · 离线');
      sayRow = {
        text: last ? '上次跑完 ' + (new Date(last.doneAt || last.createdAt || 0).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)) : '这个号还没跑过',
        plain: true,
        icon: '🕘',
      };
    }

    const sig = [cls, st, side, now ? JSON.stringify(now) : '', noteRow ? JSON.stringify(noteRow) : '',
      stepRow ? JSON.stringify(stepRow) : '', sayRow ? JSON.stringify(sayRow) : '', go].join('|');
    if (sig === liveSig) return;
    liveSig = sig;

    box.className = 'bench-live ' + cls;
    box.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'bl-row';
    const dot = document.createElement('span'); dot.className = 'bl-dot';
    const stEl = document.createElement('span'); stEl.className = 'bl-st'; stEl.textContent = st;
    row.appendChild(dot); row.appendChild(stEl);
    if (now && now.type === 'pos') {
      const pos = now.pos;
      const nowEl = document.createElement('span'); nowEl.className = 'bl-now';
      nowEl.appendChild(document.createTextNode('第 ' + pos.seq + ' 项 × '));
      const kw = document.createElement('b'); kw.textContent = pos.kw;
      nowEl.appendChild(kw);
      nowEl.appendChild(document.createTextNode(' × ' + pos.kind));
      row.appendChild(nowEl);
    } else if (now && now.type === 'none') {
      const nowEl = document.createElement('span'); nowEl.className = 'bl-now';
      nowEl.textContent = '这一趟没有到点的活（0 项）';
      row.appendChild(nowEl);
    } else if (now && now.type === 'summary') {
      const s = now.summary;
      const nowEl = document.createElement('span'); nowEl.className = 'bl-now';
      nowEl.appendChild(document.createTextNode('搜到 '));
      const a = document.createElement('b'); a.textContent = s.found + ' 篇';
      nowEl.appendChild(a);
      nowEl.appendChild(document.createTextNode(' · 评论 '));
      const b = document.createElement('b'); b.textContent = s.comments + ' 条';
      nowEl.appendChild(b);
      if (s.collectedRun || s.collectedDay) {
        nowEl.appendChild(document.createTextNode(' · 收进清单 '));
        const c = document.createElement('b'); c.textContent = '这一趟 ' + (s.collectedRun || 0) + ' 人';
        nowEl.appendChild(c);
        nowEl.appendChild(document.createTextNode(' · 今天 '));
        const c2 = document.createElement('b'); c2.textContent = (s.collectedDay || 0) + ' 人';
        nowEl.appendChild(c2);
      }
      row.appendChild(nowEl);
    }
    if (go) {
      const a = document.createElement('a');
      a.className = 'bl-go'; a.href = 'setup.html'; a.textContent = '去装／去开';
      a.style.textDecoration = 'none';
      row.appendChild(a);
    }
    if (side) {
      const sd = document.createElement('span'); sd.className = 'bl-side'; sd.textContent = side;
      row.appendChild(sd);
    }
    box.appendChild(row);

    /* 第二段：机器现在开着哪篇笔记、这一项里的第几篇；收尾后留着就标「上次打开」 */
    if (noteRow && noteRow.title) {
      const nr = document.createElement('div'); nr.className = 'bl-note' + (noteRow.stale ? ' is-stale' : '');
      const ic = document.createElement('span'); ic.className = 'ico'; ic.textContent = noteRow.stale ? '🕘' : '📄';
      const tx = document.createElement('span'); tx.className = 'tx';
      tx.textContent = (noteRow.stale ? '上次打开：' : '') + cutTitle(noteRow.title, 22);
      tx.title = noteRow.title;
      nr.appendChild(ic); nr.appendChild(tx);
      if (noteRow.total) {
        const cnt = document.createElement('span'); cnt.className = 'cnt';
        cnt.textContent = '(' + noteRow.idx + '/' + noteRow.total + ')';
        nr.appendChild(cnt);
      }
      box.appendChild(nr);
    }

    /* 第三段：现在这一步（只在「正在跑」时出现） */
    if (stepRow && stepRow.text) {
      const sr = document.createElement('div');
      sr.className = 'bl-step';
      const ic = document.createElement('span'); ic.className = 'ico';
      ic.textContent = stepRow.icon || '👉';
      const tx = document.createElement('span'); tx.className = 'tx';
      tx.textContent = '现在：' + stepRow.text;
      tx.title = stepRow.text;
      sr.appendChild(ic); sr.appendChild(tx);
      if (stepRow.tm) {
        const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = stepRow.tm;
        sr.appendChild(tm);
      }
      box.appendChild(sr);
    }

    /* 第四段：刚发出去的那句话（回复评论者只有 @谁，正文客户机没回传） */
    if (sayRow) {
      const sr = document.createElement('div');
      sr.className = 'bl-say' + (sayRow.bad ? ' is-bad' : '');
      const ic = document.createElement('span'); ic.className = 'ico';
      ic.textContent = sayRow.icon || (sayRow.bad ? '⚠️' : '💬');
      const tx = document.createElement('span'); tx.className = 'tx';
      tx.textContent = (sayRow.plain || sayRow.bad) ? sayRow.text : '刚发：' + sayRow.text;
      tx.title = sayRow.text;
      sr.appendChild(ic); sr.appendChild(tx);
      if (sayRow.tm) {
        const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = sayRow.tm;
        sr.appendChild(tm);
      }
      box.appendChild(sr);
    }
  }

  /* ── 这一趟的记录（2026-10-28 第二轮确认单 4A）──
     中间那块「待机中，当前未扫描任何笔记」换成：这一趟扫了哪些笔记、每篇评论了什么、收了谁、
     给谁备了什么话、为什么停。数据两路拼：
       ① 当天的回执圈（整趟的篇名 / 评论前 24 字 / 失败 / 收人 / 收尾那句话）；
       ② 最近一单回执里带的日志尾巴（服务器只留约 2000 字，只有这里有话术全文）。 */
  const REC_LIMIT = 40;           // 一屏最多铺多少篇（防一次画几百张卡）
  let recSig = '';                // 记录上一次的样子（没变就不重画）
  let recOpen = '';               // 展开的是哪一篇（按标题记；空＝都收起）
  let benchMode = 'rec';          // rec＝这一趟的记录；drill＝点了「打开」之后的评论视图
  let drillNote = null;
  let lastBenchJ = null;          // 最近一次轮询拿到的单子（从评论视图切回记录时照着它重画）

  function parseDetail(raw) {
    let src = String(raw || '');
    let meta = null;
    const head = src.trim().slice(0, 1);
    if (head === '{' || head === '[') {
      /* 机器那份（JSON）：能解开就只拿里面的日志尾巴；解不开（服务器只留 2000 字、被截断过的）
         就一个字都不摊——老板要看的是「干了什么」，不是一段代码 */
      try {
        const o = JSON.parse(src);
        meta = (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
        src = String((meta && (meta.logTail || meta.log)) || '');
      } catch (_) {
        return { blocks: [], tail: [], work: [], sentTo: new Set(), meta: null };
      }
    }
    const lines = src.split('\n')
      .map((s) => s.replace(/\s+$/, '').trim())
      .filter((s) => s && !/^操作日志将显示在这里/.test(s));
    const items = lines.map((s) => {
      const m = s.match(/^(\d{1,2}:\d{2}:\d{2})\s*(.*)$/);
      return m ? { tm: m[1], text: m[2] } : { tm: '', text: s };
    });
    const blocks = [];
    const tail = [];    // 收尾：⏹ 上限 / ⏸ 队列停在哪
    const work = [];    // 干活窗口：被碰几次、切走几次
    const sentTo = new Set();
    let cur = null, pendingWho = '', pendingCopy = null;
    const open = (it) => {
      const b = { tm: it.tm, title: '', idx: 0, total: 0, rows: [], says: [], copies: [] };
      blocks.push(b); cur = b; return b;
    };
    items.forEach((it) => {
      const x = it.text;
      let m;
      const om = noteOpenMatch(x);
      if (om) {
        const b = open(it);
        b.title = om.title; b.idx = om.idx; b.total = om.total;
        pendingWho = ''; pendingCopy = null;
        return;
      }
      if (!cur) open(it);
      if (pendingCopy) { pendingCopy.text = x; cur.copies.push(pendingCopy); pendingCopy = null; return; }
      /* 昵称里带空格（「@H a n .」）也要认全，所以不能拿 \S+ 截 */
      if ((m = x.match(/^💬\s*商机\s*\d+\s*@(.+?)\s*的话术：/))) { pendingWho = m[1].trim(); return; }
      if ((m = x.match(/^\[(.+?)\]\s*\((\d+)字\)[:：]?$/))) {
        pendingCopy = { who: pendingWho, tag: m[1], len: Number(m[2]), text: '' };
        return;
      }
      if ((m = x.match(/^✅\s*@(.+?)\s*发送成功$/))) {
        sentTo.add(m[1]);
        cur.rows.push({ tm: it.tm, text: x, cls: 'ok' });
        return;
      }
      if ((m = x.match(/^✅ 已发一级评论(?:（(.+?)）)?：(.+)$/))) {
        cur.rows.push({ tm: it.tm, text: '✅ 发了一条一级评论（' + (m[1] || '跑法没报') + '）', cls: 'ok' });
        cur.says.push({ who: '我发的评论：', text: m[2], tag: '客户机只回传前 24 字' });
        return;
      }
      if (/^⏹|^⏸|^🛑|^❌|^🔴/.test(x)) { tail.push({ tm: it.tm, text: x }); return; }
      if (/^干活窗口：/.test(x)) { work.push({ tm: it.tm, text: x }); return; }
      cur.rows.push({ tm: it.tm, text: x, cls: /⚠️|失败/.test(x) ? 'bad' : '' });
    });
    return { blocks, tail, work, sentTo, meta };
  }

  /* 最近这一趟是哪一单：有在跑的（等接 / 已送到）就是它，否则拿最近跑完或失败的那单 */
  /* 「打开」单只是让执行器把那篇打开，不算一趟活——否则点一下卡片，记录就被这张空单顶掉 */
  const isOpenOnly = (c) => !!(c && c.params && c.params.op === 'open');

  function roundAnchor(j) {
    const orders = (Array.isArray(j && j.orders) ? j.orders : []).filter((c) => c && !isOpenOnly(c));
    const live = orders.find((c) => c.state === 'queued' || c.state === 'sent') || null;
    const done = orders.filter((c) => c.state === 'done' || c.state === 'failed')
      .sort((a, b) => (b.doneAt || b.createdAt || 0) - (a.doneAt || a.createdAt || 0))[0] || null;
    return { live, done, one: live || done };
  }

  /* 把当天的回执摊成「这一趟」：抬头（哪一格活）＋ 一篇一行（打开／发了什么／收了谁／为什么停，细节点行展开）＋ 收尾。
     话术全文只在最近一单回执的日志尾巴里（服务器只留约 2000 字），按笔记标题贴回那张行上。 */
  function buildRound(j) {
    const a = roundAnchor(j);
    const prog = readProgress(j && j.reports);
    /* 本机手点开的这趟没有队单：10 分钟内有回执、最后一句不是收尾＝还在跑（暂停也算） */
    const localLive = !a.live && !!prog.lastAt && !prog.ended && (Date.now() - prog.lastAt < 10 * 60000);
    const today = dayKey(new Date());
    const from = a.one ? (Number(a.one.createdAt) || 0) - 10000 : 0;
    const lines = [];
    (Array.isArray(j && j.reports) ? j.reports : []).forEach((r) => {
      const rt = reportTime(r);
      if (rt.day !== today) return;
      if (from && rt.at && rt.at < from) return;
      reportLines(r).forEach((ln) => lines.push({ tm: rt.tm, text: ln.text }));
    });

    const out = {
      live: !!a.live || localLive, one: a.one, cards: [], head: null, summary: null, end: [], misc: [],
      found: 0, comments: 0, collected: 0, startTm: '', endTm: '', hasAny: lines.length > 0,
    };
    const seen = new Set();
    let card = null;
    lines.forEach((ln) => {
      const x = ln.text; let m;
      out.startTm = out.startTm || ln.tm;
      out.endTm = ln.tm;
      if ((m = x.match(/^▶ 第 (\d+)(?: 项| 次搜索| 次主页扫描| 轮)：(.+?) × 「(.+?)」/))) {
        out.head = { seq: Number(m[1]), kind: m[2].trim(), kw: m[3] };
        return;
      }
      const om = noteOpenMatch(x);
      if (om) {
        card = { tm: ln.tm, title: om.title, idx: om.idx, total: om.total, rows: [], says: [], copies: [], bad: false };
        out.cards.push(card);
        return;
      }
      if ((m = x.match(/^(?:获客|日常浏览)跑完一轮：搜到 (\d+) 篇 · 评论 (\d+) 条/))) {
        out.found = Number(m[1]);
        out.summary = { found: Number(m[1]), comments: Number(m[2]) };
        return;
      }
      if (/^⏹|^⏸|^🛑|^❌|^🔴/.test(x)) { out.end.push(ln); return; }
      if ((m = x.match(/^✅ 已发一级评论(?:（(.+?)）)?：(.+)$/))) {
        out.comments++;
        if (card) {
          card.rows.push({ tm: ln.tm, text: '✅ 发了一条一级评论（' + (m[1] || '跑法没报') + '）', cls: 'ok' });
          card.says.push({ who: '我发的评论：', text: m[2], tag: '客户机只回传前 24 字' });
        } else out.misc.push(ln);
        return;
      }
      if ((m = x.match(/^🕵️\s*已收进获客清单：@(.+?)(?:（|$)/))) {
        if (seen.has(m[1])) return;
        seen.add(m[1]);
        out.collected = seen.size;
        if (card) card.rows.push({ tm: ln.tm, text: x, cls: 'ok' });
        else out.misc.push(ln);
        return;
      }
      if (/^⚠️|失败|出错|没跑成/.test(x)) {
        if (card) { card.rows.push({ tm: ln.tm, text: x, cls: 'bad' }); card.bad = true; }
        else out.misc.push(ln);
        return;
      }
      if (DIM_RE.test(x)) {
        if (card) card.rows.push({ tm: ln.tm, text: x, cls: 'dim' });
        else out.misc.push(ln);
        return;
      }
      if (card) card.rows.push({ tm: ln.tm, text: x, cls: /^✅/.test(x) ? 'ok' : '' });
      else out.misc.push(ln);
    });

    /* ② 话术全文：从最近一单回执的日志尾巴里拆，按标题贴回对应的卡
       （新执行器把给人看的那段另放 log；老单只有 detail——里面是 JSON 的话 parseDetail 自己会剥） */
    const raw = String((a.done && (a.done.log || a.done.detail)) || '');
    if (raw.trim()) {
      const d = parseDetail(raw);
      d.blocks.forEach((b) => {
        let c = b.title ? out.cards.find((x) => x.title === b.title) : null;
        if (!c) {
          c = { tm: b.tm, title: b.title || '', idx: b.idx, total: b.total, rows: [], says: [], copies: [], bad: false };
          out.cards.push(c);
        }
        if (!c.tm && b.tm) c.tm = b.tm;
        b.copies.forEach((cp) => c.copies.push({
          who: cp.who, len: cp.len, text: cp.text, sent: d.sentTo.has(cp.who),
        }));
        b.rows.forEach((r) => {
          if (/^✅\s*@.+发送成功$/.test(r.text)) return;   // 已经在话术那条的「已发出」标签里说了
          if (r.cls === 'bad') c.bad = true;
          if (!c.rows.some((y) => y.text === r.text)) c.rows.push({ tm: r.tm, text: r.text, cls: r.cls });
        });
        b.says.forEach((s) => {
          if (!c.says.some((y) => y.text === s.text)) c.says.push(s);
        });
      });
      if (!out.hasAny && d.blocks.length) out.hasAny = true;   // 回执圈被挤掉了：光凭明细也照铺
      if (!out.startTm && d.blocks[0] && d.blocks[0].tm) out.startTm = d.blocks[0].tm;
      /* 回执 JSON 里带着这一趟的总账：实时播报被挤掉时，拿它把抬头和战果补齐 */
      if (d.meta) {
        if (!out.head && prog.pos) out.head = { seq: prog.pos.seq, kind: '搜索', kw: prog.pos.kw };
        out.found = out.found || Number(d.meta.found) || 0;
        out.comments = out.comments || Number(d.meta.comments) || 0;
        if (!out.summary && (out.found || out.comments)) {
          out.summary = { found: out.found, comments: out.comments };
        }
      }
    }
    /* 报告的和明细的两路拼在一起，按时刻把每张卡里的行顺回来 */
    out.cards.forEach((c) => {
      c.rows.sort((x, y) => String(x.tm || '~').localeCompare(String(y.tm || '~')));
    });

    /* 单子自己记着失败原因：没别的收尾句子时拿它垫红条 */
    if (!out.end.length && a.done && a.done.state === 'failed') {
      out.end.push({ tm: hhmm(a.done.doneAt || a.done.createdAt), text: '没跑成：' + (a.done.note || '原因没回') });
    }
    if (!out.startTm && a.one) out.startTm = hhmm(a.one.createdAt) || '';
    if (!out.endTm && a.done) out.endTm = hhmm(a.done.doneAt) || '';
    if (!out.comments && out.summary) out.comments = out.summary.comments || 0;
    return out;
  }

  /* 一段话术（评论正文 / 给谁备好的话） */
  function sayBox(s, sent) {
    const box = document.createElement('div');
    box.className = 'say' + (sent ? ' sent' : '');
    const who = document.createElement('span');
    who.className = 'who'; who.textContent = s.who || '';
    box.appendChild(who);
    if (s.len) box.appendChild(document.createTextNode('（' + s.len + ' 字）'));
    if (s.tag) {
      const g = document.createElement('span');
      g.className = 'tag'; g.textContent = s.tag;
      box.appendChild(g);
    }
    box.appendChild(document.createElement('br'));
    box.appendChild(document.createTextNode(s.text || '（空）'));
    return box;
  }

  /* 顶栏右边那句：正在跑第几项 / 今天搜到几篇 */
  function paintRecSide(r) {
    const side = document.getElementById('recSide');
    if (!side) return;
    const nodes = [];
    if (r.live && r.head) {
      nodes.push(document.createTextNode('正在跑：第 ' + r.head.seq + ' 项 × '));
      const b = document.createElement('b');
      b.textContent = '「' + r.head.kw + '」';
      nodes.push(b);
    } else if (r.found || r.comments) {
      nodes.push(document.createTextNode('今天搜到 '));
      const a = document.createElement('b'); a.textContent = String(r.found || 0);
      nodes.push(a);
      nodes.push(document.createTextNode(' 篇'));
      if (r.comments) {
        nodes.push(document.createTextNode(' · 评论 '));
        const b = document.createElement('b'); b.textContent = String(r.comments);
        nodes.push(b);
        nodes.push(document.createTextNode(' 条'));
      }
    } else {
      nodes.push(document.createTextNode('今天还没搜到笔记'));
    }
    const key = nodes.map((n) => n.textContent || '').join('');
    if (side.dataset.key === key) return;
    side.dataset.key = key;
    side.innerHTML = '';
    nodes.forEach((n) => side.appendChild(n));
  }

  /* 中间那块：这一趟的记录。没变就不重画（每 5 秒轮询一次，重画会打断老板看的位置） */
  function renderRecord(j) {
    const host = document.getElementById('benchRecord');
    if (!host) return;
    lastBenchJ = j || null;
    const h = (j && j.hand) || {};
    const r = buildRound(j);
    paintRecSide(r);
    if (benchMode !== 'rec') { recSig = ''; return; }   // 点开一篇之后这块让给评论视图
    const sig = JSON.stringify([!!h.paired, !!h.online, h.lastSeen || 0, r.live,
      r.one ? r.one.id + '|' + r.one.state + '|' + (r.one.doneAt || 0) : '', r.hasAny,
      r.cards, r.head, r.summary, r.end, r.misc, r.found, r.comments, r.collected, r.startTm, r.endTm]);
    if (sig === recSig) return;
    recSig = sig;

    host.innerHTML = '';
    const mk = (tag, cls, text) => {
      const d = document.createElement(tag);
      if (cls) d.className = cls;
      if (text != null) d.textContent = text;
      return d;
    };
    const add = (node) => { host.appendChild(node); return node; };

    /* 执行器掉线：照铺最后一次的记录，顶上提醒一句 */
    if (h.paired && !h.online && r.hasAny) {
      add(mk('div', 'offline-tip', '🖐 执行器没回话，下面是它最后一次回的'
        + (h.lastSeen ? '（' + hhmm(h.lastSeen) + '）' : '') + '——等它那台电脑上的执行器连回来，这里会接着长。'));
    }

    if (!r.hasAny) {
      const box = mk('div', 'r-empty');
      const ic = mk('div', 'ic', '📭'); ic.style.fontSize = '30px';
      box.appendChild(ic);
      box.appendChild(mk('div', 't', '今天还没跑过'));
      box.appendChild(mk('div', 's', h.paired
        ? '去「队列」页开始一轮——跑起来这里就一篇一篇往上长。'
        : '先把执行器装上、挂上线；跑起来这里就有记录。'));
      const go = mk('button', 'go', '去队列页看看');
      go.type = 'button';
      go.onclick = () => { try { switchMainTab('queue'); } catch (_) {} };
      box.appendChild(go);
      add(box);
      return;
    }

    /* 抬头：这一趟几点到几点 · 哪一格活 · 战果 */
    const head = add(mk('div', 'r-head'));
    const span = r.startTm
      ? r.startTm + (r.live ? ' – 现在' : (r.endTm && r.endTm !== r.startTm ? ' – ' + r.endTm : ''))
      : (r.live ? '正在跑' : '');
    head.appendChild(document.createTextNode('这一趟：' + (span ? span + ' · ' : '')));
    if (r.head) head.appendChild(mk('span', 'r-kw', r.head.kind + ' × 「' + r.head.kw + '」'));
    const bits = [];
    if (r.found) bits.push('搜到 ' + r.found + ' 篇');
    if (r.comments) bits.push('评论 ' + r.comments + ' 条');
    if (r.collected) bits.push('收进清单 ' + r.collected + ' 人');
    if (bits.length) head.appendChild(mk('span', 'r-side', bits.join(' · ')));

    /* 一篇一行：表格只放看得懂的五样；细节（评论全文 / 收进谁 / 备好的话 / 机器那几句）点行展开 */
    const cards = r.cards.slice(0, REC_LIMIT);
    const tw = add(mk('div', 'rtab-wrap'));
    const tab = mk('table', 'rtab');
    const cg = mk('colgroup');
    ['33%', '28%', '10%', '15%', '8%', '64px'].forEach((w) => {
      const col = mk('col');
      col.style.width = w;
      cg.appendChild(col);
    });
    tab.appendChild(cg);
    const thead = mk('thead');
    const htr = mk('tr');
    ['笔记', '我发了什么', '收进清单', '状态', '时间', ''].forEach((t) => htr.appendChild(mk('th', '', t)));
    thead.appendChild(htr);
    tab.appendChild(thead);
    const tbody = mk('tbody');
    const rfail = roundFail(r);
    const lastFull = r.cards[r.cards.length - 1];
    cards.forEach((c, i) => {
      const isNow = r.live && i === r.cards.length - 1 && !r.summary;
      tbody.appendChild(recRow(c, i, isNow, c === lastFull ? rfail : ''));
    });
    tab.appendChild(tbody);
    tw.appendChild(tab);
    if (r.cards.length > REC_LIMIT) {
      add(mk('div', 'offline-tip', '这一趟还有 ' + (r.cards.length - REC_LIMIT) + ' 篇没铺上来（一屏最多 ' + REC_LIMIT + ' 篇）'));
    }

    /* 收尾：为什么停 */
    if (r.end.length) {
      add(mk('div', 'end', r.end.map((t) => (t.tm ? t.tm + ' ' : '') + t.text).join('　')));
    }
  }

  /* ── 这一趟的表格：一行一篇，点行展开细节 ── */
  const elem = (tag, cls, text) => {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  };

  const recKey = (c, i) => String(c.title || ('#' + i));

  /* 这一趟是不是以失败收的尾（登录过期、内核报错、干到一半崩了）。
     这种句子只落在收尾里，不进任何一篇的行，所以只有最后那一篇能被它打断 */
  function roundFail(r) {
    const end = (r && r.end) || [];
    for (let i = end.length - 1; i >= 0; i--) {
      const t = String(end[i].text || '');
      if (/^❌|^🔴/.test(t)) return t.replace(/^[❌🔴]\s*/, '');
      if (/^没跑成[：:]/.test(t)) return t.replace(/^没跑成[：:]\s*/, '');
      if (/^⏹|^⏸|^🛑/.test(t)) return '';   // 正常收 / 到上限停下：不算失败
    }
    return '';
  }

  /* 一行能看出来的三件事：评论发没发、收了谁、为什么没成 */
  function recInfo(c) {
    const people = [];
    let noProspect = false, failLine = '';
    (c.rows || []).forEach((row) => {
      const tx = String(row.text || '');
      const m = tx.match(/^🕵️\s*已收进获客清单：@(.+?)(?:（|$)/);
      if (m && people.indexOf('@' + m[1]) < 0) people.push('@' + m[1]);
      if (/无潜在顾客|无商机/.test(tx)) noProspect = true;
      if (!failLine && (row.cls === 'bad' || /发送失败|没发出去/.test(tx))) {
        failLine = tx.replace(/^⚠️\s*/, '');
      }
    });
    return { people: people, noProspect: noProspect, failLine: failLine, sent: (c.says || []).length };
  }

  function recStat(c, isNow, stopFail) {
    const k = recInfo(c);
    if (k.failLine) return { cls: 'warn', text: k.noProspect ? '没发出去 · 无商机' : '没发出去' };
    if (isNow) return { cls: 'run', text: '还在看评论区' };
    if (stopFail) return { cls: 'warn', text: '没跑成' };
    if (k.sent) return { cls: 'ok', text: '已发评论' };
    if (k.noProspect) return { cls: 'none', text: '无商机' };
    return { cls: 'none', text: '—' };
  }

  function recRow(c, i, isNow, rfail) {
    const info = recInfo(c);
    /* 这一趟被失败打断、这篇还什么都没干成：算它头上（已经发出去的就不算它） */
    const stopFail = rfail && !info.sent && !info.people.length && !info.failLine ? rfail : '';
    const st = recStat(c, isNow, stopFail);
    const key = recKey(c, i);
    const open = recOpen === key;
    const frag = document.createDocumentFragment();

    const tr = elem('tr', 'note-row' + (isNow ? ' is-now' : '')
      + (st.cls === 'warn' ? ' is-warn' : '') + (open ? ' is-open' : ''));
    tr.onclick = (e) => {
      if (e.target && e.target.closest && e.target.closest('.rc-open')) return;
      recOpen = open ? '' : key;
      recSig = '';
      if (lastBenchJ) renderRecord(lastBenchJ);
    };

    const t1 = elem('td', 'rc-nt');
    t1.appendChild(elem('span', 'rc-caret', '▶'));
    if (c.total) t1.appendChild(elem('span', 'rc-idx', c.idx + '/' + c.total));
    const tt = elem('span', 'rc-tt', c.title || '（这篇没报标题）');
    tt.title = c.title || '';
    t1.appendChild(tt);

    const t2 = elem('td', 'rc-say' + (info.sent ? '' : ' mute'));
    if (info.sent) {
      const s0 = String((c.says[0] && c.says[0].text) || '');
      t2.textContent = '「' + s0 + '」';
      t2.title = s0;
    } else t2.textContent = '—';

    const t3 = elem('td', 'rc-ppl' + (info.people.length ? '' : ' mute'));
    if (info.people.length) {
      t3.appendChild(elem('b', '', String(info.people.length)));
      t3.appendChild(document.createTextNode(' 人'));
    } else t3.textContent = '—';

    const t4 = elem('td');
    const pill = t4.appendChild(elem('span', 'rpill ' + st.cls));
    pill.appendChild(elem('span', 'dot'));
    pill.appendChild(document.createTextNode(st.text));

    const t5 = elem('td', 'rc-time', String(c.tm || '').slice(0, 5));

    const t6 = elem('td', 'rc-go');
    if (c.title) {
      const btn = t6.appendChild(elem('button', 'rc-open', '打开'));
      btn.type = 'button';
      btn.dataset.title = c.title;
      btn.title = '让执行器在它那台电脑上打开这一篇（接着可以点「评论刷新」）';
    }

    [t1, t2, t3, t4, t5, t6].forEach((td) => tr.appendChild(td));
    frag.appendChild(tr);

    if (open) {
      const dtr = elem('tr', 'det');
      const td = dtr.appendChild(elem('td'));
      td.colSpan = 6;
      td.appendChild(recDetail(c, info, isNow, stopFail));
      frag.appendChild(dtr);
    }
    return frag;
  }

  function recDetail(c, info, isNow, stopFail) {
    const box = elem('div', 'rdet');

    const r1 = elem('div', 'rdet-row');
    r1.appendChild(elem('div', 'rdet-k', '我发的评论'));
    const v1 = r1.appendChild(elem('div', 'rdet-v' + (info.sent ? '' : ' mute')));
    if (info.sent) {
      (c.says || []).forEach((s) => v1.appendChild(sayBox({ who: '', len: s.len, tag: s.tag, text: s.text }, false)));
    } else if (info.failLine) v1.textContent = '这篇一条都没发出去——' + info.failLine;
    else if (stopFail) v1.textContent = '这篇没跑成——' + stopFail;
    else v1.textContent = '这篇没发评论';
    box.appendChild(r1);

    if (info.people.length) {
      const r2 = elem('div', 'rdet-row');
      r2.appendChild(elem('div', 'rdet-k', '收进清单'));
      const v2 = r2.appendChild(elem('div', 'rdet-v'));
      info.people.forEach((w) => v2.appendChild(elem('span', 'whochip', w + '（待私信）')));
      box.appendChild(r2);
    }

    if ((c.copies || []).length) {
      const nSent = c.copies.filter((x) => x.sent).length;
      box.appendChild(elem('h6', '', '给这些人备好的话（' + c.copies.length + ' 条'
        + (nSent ? ' · ' + nSent + ' 条已发出' : ' · 这一趟一条都没发出去') + '）'));
      c.copies.forEach((x) => box.appendChild(sayBox({
        who: x.who, len: x.len, tag: x.sent ? '已发出' : '备好 · 未发', text: x.text,
      }, x.sent)));
      const missing = info.people.length - c.copies.length;
      if (missing > 0) {
        box.appendChild(elem('div', 'rdet-v mute', '还有 ' + missing + ' 个人备好的话没带回执里（执行器只回最近几十行）'));
      }
    } else if (info.people.length) {
      box.appendChild(elem('div', 'rdet-v mute', '这 ' + info.people.length + ' 个人备好的话没在这一趟的回执里（执行器只回最近几十行）'));
    }

    if ((c.rows || []).length) {
      box.appendChild(elem('h6', '', '机器那几句'));
      c.rows.forEach((row) => {
        const d = box.appendChild(elem('div', 'drow' + (row.cls ? ' ' + row.cls : '')));
        if (row.tm) d.appendChild(elem('span', 'tm', row.tm));
        d.appendChild(document.createTextNode(row.text));
      });
    }

    if (isNow) box.appendChild(elem('div', 'drow', '⏳ 这篇还在看评论区（约 15~90 秒）…跑完这趟会就地变成记录'));
    if (!info.sent && !info.people.length && !(c.rows || []).length && !stopFail) {
      box.appendChild(elem('div', 'rdet-v mute', '这篇没留下明细'));
    }
    return box;
  }

  /* 点卡上的「打开」之后：切回评论视图（评论由执行器在那台电脑上抓，网页这头只做落脚点）。
     画在 #benchRecord 里，不碰 #mainContent——小窗模式下 popup.js 每 2 秒会拿状态卡把它重写一遍。 */
  function paintDrill() {
    const mc = document.getElementById('benchRecord');
    if (!mc) return;
    const note = drillNote || {};
    mc.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'drill-bar';
    bar.style.display = 'flex';
    const t = document.createElement('span');
    t.className = 'db-t';
    t.textContent = '📄 ' + (note.title || '这一篇');
    t.title = String(note.title || '');
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'db-back';
    back.textContent = '⬅ 回到这一趟';
    back.onclick = () => setBenchMode('rec');
    bar.appendChild(t);
    bar.appendChild(back);

    const box = document.createElement('div');
    box.className = 'drill-box';
    box.innerHTML = '已让执行器去它那台电脑上打开这一篇。<br>'
      + '要抓评论、找商机，点上面右边的「🔄 评论刷新」——那是在执行器那台电脑上干活，进度看下面的日志。<br>'
      + '<b>网页这头看不到评论区</b>（评论只在执行器本机），这里只做「回到这一趟」的落脚点。';
    mc.appendChild(bar);
    mc.appendChild(box);
  }

  function setBenchMode(mode, note) {
    benchMode = mode === 'drill' ? 'drill' : 'rec';
    drillNote = benchMode === 'drill' ? (note || drillNote || null) : null;
    recSig = '';                     // 切回来要把记录重画一遍
    if (benchMode === 'drill') paintDrill();
    else if (lastBenchJ) renderRecord(lastBenchJ);
    syncBenchChrome();
  }

  /* 卡上的「打开」：只带标题（回执里没留 noteId / 链接），执行器那边按标题站内搜着打开 */
  async function openFromRecord(title) {
    const t = String(title || '').trim();
    if (!t) return;
    const note = { noteId: '', url: '', title: t, author: '' };
    setBenchMode('drill', note);
    await saveActiveNote(note);
    say('正在让执行器打开《' + cutTitle(t, 16) + '》……');
    const r = await order('acquire', { op: 'open', note: note });
    if (!r.ok) { say('打开没派成：' + r.error, 'error'); return; }
    say(r.delivered ? '执行器在线，正打开这篇……' : '执行器不在线——单排着了', 'success');
  }

  function wireRecord() {
    const host = document.getElementById('benchRecord');
    if (!host || host.dataset.wired) return;
    host.dataset.wired = '1';
    host.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.rc-open') : null;
      if (!b) return;
      e.preventDefault();
      openFromRecord(b.dataset.title);
    });
  }

  /* 这几块只在「队列 → 🧐 工作台 · 小红书」这一格出现。
     在不在这一格看：队列页带 active，且页内横签停在 work（window.__xhsDqTab）；
     记录视图下 mainContent 是藏着的，不能拿它的显隐当判断；平台页签没开的账号当作小红书。 */
  function benchPlat() {
    const bar = document.getElementById('wbPlatBar');
    if (!bar || bar.style.display === 'none') return 'xhs';
    const on = bar.querySelector('.wb-plat-tab.on');
    return on ? String(on.dataset.wbplat || 'xhs') : 'xhs';
  }

  function benchPageOn() {
    /* 2026-11-12：工作台并进「获客 → 队列」第三格——队列页且停在工作台那格才算在；
       基础版没有队列页，工作台还是单独一屏，认平台页签露没露 */
    const t = document.getElementById('tabQueue');
    if (t && t.classList.contains('active')) return window.__xhsDqTab === 'work';
    const bar = document.getElementById('wbPlatBar');
    return !!(bar && bar.style.display !== 'none');
  }

  /* 队列页（2026-11-12）：队列条从工作台搬到了「获客 → 队列」，显隐跟着那条二级页走 */
  function queuePageOn() {
    const t = document.getElementById('tabQueue');
    return !!(t && t.classList.contains('active'));
  }

  function syncBenchChrome() {
    const { box, qbar, wrap, panel } = benchEls();
    const on = benchPageOn() && benchPlat() === 'xhs';
    if (!on && benchMode !== 'rec') { benchMode = 'rec'; drillNote = null; recSig = ''; }
    const rec = on && benchMode === 'rec';
    const drill = on && benchMode === 'drill';
    const pr = document.querySelector('.panel-right');
    const sl = document.querySelector('.split-layout');
    if (pr) { pr.classList.toggle('wb-rec', rec); pr.classList.toggle('wb-drill', drill); }
    if (sl) { sl.classList.toggle('wb-rec', rec); sl.classList.toggle('wb-drill', drill); }
    const rc = document.getElementById('benchRecord');
    if (rc) rc.style.display = on ? '' : 'none';      // 两种模式都占着中间那块
    /* 队列页三个页内横签：切到周历 / 工作台就别再把今天的清单放出来 */
    if (qbar) qbar.style.display = (queuePageOn() && !window.__xhsDqWeek && window.__xhsDqTab !== 'work') ? '' : 'none';
    if (box) box.style.display = on ? '' : 'none';
    if (noticeEl) noticeEl.style.display = (on && noticeWanted) ? '' : 'none';   // 点了有没有用那条提示
    if (wrap) wrap.style.display = on ? '' : 'none';
    paintLogFold();
    if (panel && panel.dataset.ph == null) panel.dataset.ph = '1';
  }

  /* 日志默认收着：只留一条「📜 操作日志 · 今天 N 条」，点开才铺到原来那个高度。
     显隐交给 .is-folded 的样式（popup.js 每来一句日志都会把面板设成 block，内联样式压不住类） */
  function paintLogFold() {
    const { wrap } = benchEls();
    const foldBtn = document.getElementById('logFoldBtn');
    if (wrap) wrap.classList.toggle('is-folded', logFolded);
    if (foldBtn) foldBtn.textContent = logFolded ? '▴ 展开全部日志' : '▾ 收起日志';
  }

  function wireBenchChrome() {
    const { panel, wrap } = benchEls();
    if (panel && panel.dataset.ph == null) panel.dataset.ph = '1';
    const followBtn = document.getElementById('logFollowBtn');
    const clearBtn = document.getElementById('logClearBtn');
    const foldBtn = document.getElementById('logFoldBtn');
    wireRecord();
    if (followBtn && !followBtn.dataset.wired) {
      followBtn.dataset.wired = '1';
      followBtn.onclick = () => {
        logFollow = !logFollow;
        followBtn.classList.toggle('on', logFollow);
        followBtn.textContent = logFollow ? '↓ 跟着滚' : '⏸ 不跟着滚';
        if (logFollow) panelScrollTail();
      };
    }
    if (clearBtn && !clearBtn.dataset.wired) {
      clearBtn.dataset.wired = '1';
      clearBtn.onclick = () => {
        if (!panel) return;
        panel.innerHTML = '';
        panel.dataset.ph = '0';
        const tip = document.createElement('div');
        tip.className = 'log-entry info';
        tip.textContent = '已清屏——新日志来了接着往下记';
        panel.appendChild(tip);
        logCountPaint();
      };
    }
    if (foldBtn && !foldBtn.dataset.wired) {
      foldBtn.dataset.wired = '1';
      foldBtn.onclick = () => {
        logFolded = !logFolded;
        paintLogFold();
        if (!logFolded) panelScrollTail();
      };
    }
    /* 平台页签 / 顶栏显隐 / 二级 tab 一变就重算：
       切页时 popup.js 会把 .content 全收起来（benchRecord 也在里面），
       没开平台页签的账号（那份页签一直藏着）就得靠二级 tab 的 active 认「在不在工作台」 */
    const pb = document.getElementById('wbPlatBar');
    if (pb && window.MutationObserver && !pb.dataset.benchWired) {
      pb.dataset.benchWired = '1';
      new MutationObserver(syncBenchChrome).observe(pb,
        { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    }
    const tq = document.getElementById('tabQueue');
    if (tq && window.MutationObserver && !tq.dataset.benchWired) {
      tq.dataset.benchWired = '1';
      new MutationObserver(syncBenchChrome).observe(tq, { attributes: true, attributeFilter: ['class'] });
    }
    const mc = document.getElementById('mainContent');
    if (mc && window.MutationObserver && !mc.dataset.benchWired) {
      mc.dataset.benchWired = '1';
      new MutationObserver(syncBenchChrome).observe(mc, { attributes: true, attributeFilter: ['style'] });
    }
    window.__xhsBenchSync = syncBenchChrome;   // 队列页切内外横签时，popup 那头喊一声重算
    syncBenchChrome();
  }

  /* 本机那两块（🤖 机器人 / 💧 自动灌水）以前自己往面板里塞行、用自己的时间戳、占位那句还清不掉。
     现在它们一律走这里：同一根面板、同一套时间与图标。返回 false 表示面板不在（由调用方自己兜底）。 */
  function benchLocalLog(text, src, type, timeStr) {
    const { panel } = benchEls();
    if (!panel) return false;
    let s = String(text || '').trim();
    /* 本机那两块的句子自己头上带一颗图标（「🤖 自动灌水已就绪」），左侧已经画了来源——别再叠一颗 */
    if (src === '🤖') s = s.replace(/^(?:🤖\s*)+/, '').trim();
    else if (src === '💧') s = s.replace(/^(?:💧\s*)+/, '').trim();
    if (!s) return false;
    clearPh(panel);
    panel.querySelectorAll('.log-entry.new').forEach((x) => x.classList.remove('new'));
    const d = document.createElement('div');
    d.className = 'log-entry ' + (type || logLineType(s)) + ' new';
    d.dataset.src = src === '🤖' ? 'bot' : 'flow';
    d.title = s;
    const tm = document.createElement('span');
    tm.className = 'log-time';
    tm.textContent = timeStr || hms(new Date());
    const sc = document.createElement('span');
    sc.textContent = src || '💧';
    sc.style.cssText = 'margin-right:6px;font-size:11px';
    d.appendChild(tm); d.appendChild(sc);
    d.appendChild(document.createTextNode(s));
    panel.appendChild(d);
    while (panel.children.length > 400) panel.removeChild(panel.firstChild);
    panelScrollTail();
    logCountPaint();
    return true;
  }
  window.__XHS_BENCH_LOG__ = benchLocalLog;

  /* 把执行器报的话写进工作台那根日志面板（点开"获客 → 工作台"就看得见实时进度） */
  function pushLog(text, type) {
    try {
      const { panel } = benchEls();
      if (!panel) return;
      const s = String(text || '').trim();
      if (!s) return;
      if (panel.dataset.ph == null) panel.dataset.ph = '1';
      clearPh(panel);
      const now = new Date();
      const t = now.toLocaleTimeString('zh-CN', { hour12: false });
      const div = document.createElement('div');
      div.className = 'log-entry ' + (type || 'info') + ' new';
      div.dataset.src = 'exec';
      div.title = s;
      const tm = document.createElement('span');
      tm.className = 'log-time';
      tm.textContent = t;
      const sc = document.createElement('span');
      sc.textContent = '🖐';
      sc.style.cssText = 'color:#0a6b8a;font-weight:700;margin-right:6px;font-size:11px';
      div.appendChild(tm); div.appendChild(sc);
      div.appendChild(document.createTextNode(s));
      panel.querySelectorAll('.log-entry.new').forEach((x) => x.classList.remove('new'));
      panel.appendChild(div);
      while (panel.children.length > 400) panel.removeChild(panel.firstChild);
      panelScrollTail();
      logCountPaint();
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
    paintPauseLine(j.pause);
    const orders = Array.isArray(j.orders) ? j.orders : [];
    const h = j.hand || {};
    /* 掉登录 / 登错号：认号结果每 5 秒随这趟回来，喂给顶栏右侧那颗红标（全站主提醒） */
    const loginAlertOn = feedLoginAlert(j, orders);
    /* 搜索链：服务器记下的「这一轮 + 后面还有哪几类 + 下一类什么时候派」。
       工作台那边拿它画顶行和后面几类；这里拿它的停手原因弹横幅。 */
    const chain = j.chain || null;
    window.__xhsChain = chain;
    /* 队列跑动摘要（2026-11-10）：客户机那本队列账只在本机，公网这边靠执行器捎上来。
       变了才重画队列条（8 秒一轮，别每次轮询都重建 DOM）。 */
    const bench = (j.bench && typeof j.bench === 'object') ? j.bench : null;
    const benchSig = bench
      ? JSON.stringify(bench.running || null) + '|' + (Array.isArray(bench.done) ? bench.done.length : 0)
        + '|' + ((bench.done && bench.done[0] && bench.done[0].at) || 0) + '|' + (bench.at || 0)
      : '';
    if (window.__xhsExecBenchSig !== benchSig) {
      window.__xhsExecBenchSig = benchSig;
      window.__xhsExecBench = bench;
      window.__xhsBenchPainted = false;
    }
    /* 队列那块要晚一拍才加载：等它在了再画；画过一次就等下次摘要变了再画 */
    if (!window.__xhsBenchPainted && typeof window.renderBenchQueueBar === 'function') {
      window.__xhsBenchPainted = true;
      try { window.renderBenchQueueBar(); } catch (_) {}
    }
    const chainStop = (chain && chain.status === 'stopped' && chain.stopKind && chain.stopKind !== 'manual') ? chain : null;
    /* 认号红条：停手原因优先显示搜索链的；没有就显示错号/没登录（只停那一个平台） */
    const loginCmd = !chainStop
      ? orders.find((c) => c && c.needLogin && c.state === 'failed')
      : null;
    const loginStale = loginCmd && orders.some((c) => c && c.state === 'done' && c.ok
      && (c.createdAt || 0) > (loginCmd.doneAt || loginCmd.createdAt || 0));
    const bindAlert = (!chainStop && !loginCmd && !loginAlertOn) ? bindAlertOf(j) : null;
    /* 版本对不上（2026-10-30）：服务器按最新包认版本，旧包一条活都派不出去 —— 直接在网页上让他去更新 */
    const wantVer = String(j.expectVersion || '');
    const handVer = String(h.version || '');
    const verStale = !!(h.paired && wantVer && handVer !== wantVer);
    if (chainStop) {
      showExecBanner(chainStop.stopKind, String(chainStop.id || '') + '|' + chainStop.stopKind);
    } else if (loginCmd && !loginStale) {
      showExecBanner('login', 'cmd|' + String(loginCmd.id || ''));
    } else if (bindAlert) {
      showBindBanner(bindAlert);
    } else if (verStale) {
      showExecBanner('version', 'ver|' + handVer + '|' + wantVer,
        '版本对不上：这台电脑上装的是 ' + (handVer || '旧版') + '，现在要 ' + wantVer
        + '。网页派的活会先发不过去。点右边下载新包，解压后双击「更新.bat」，装好按一下浏览器的「重新加载」，活就能接着派。');
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
    /* 队列页那颗「开始」在公网版只负责下单：单在跑就把按钮维持成「停止」、暂停钮照服务器记的状态翻；
       单跑完了再把"运行中"的视觉收回来，否则队列页一直显示在跑、笔记列表的「打开」也会被"工作台正忙"挡住 */
    const inflight = orders.some((c) => c && (c.state === 'queued' || c.state === 'sent'));
    lastInflight = inflight;
    const botPause = (j && j.botPause) || {};
    const pausedNow = !!botPause.on;
    {
      const b = window.AutoBot;
      const stopGrace = !!localStopAt && (Date.now() - localStopAt < 30000);   // 刚点过「停」：给它收尾的时间，别又把按钮翻回「停止」
      if (b) {
        if (inflight && !stopGrace) {
          if (!b.running) { b.running = true; try { b._updateUI(true); } catch (_) {} }
          if (!!b.paused !== pausedNow) { b.paused = pausedNow; try { b._updateUI(true); } catch (_) {} }
        } else if (!inflight && b.running) {
          if (b.paused) b.paused = false;
          b.running = false; try { b._updateUI(false); } catch (_) {}
          localStopAt = 0;
        }
      }
    }
    const el = ensureStrip();
    guideFromHand(h);
    /* 执行器把 🤖 日志也走这条进度口回传（后台看）：网页上这颗只显示真正的活进度 */
    const reports = (Array.isArray(j.reports) ? j.reports : []).filter((x) => !/^🤖/.test(String((x && x.text) || '')));
    const latest = reports.length ? reports[reports.length - 1] : null;
    const who = h.paired ? (h.name || '已挂线') : '还没挂';
    /* 公网版这颗链接归账号用（写「哪一档 · 绑没绑」），这里 chip 是空的，一个字都别碰 */
    if (chip) {
      chip.onclick = null;   // 没挂时走 <a> 原生跳转（href=setup.html）；挂了由 click 监听拦下
      chip.classList.toggle('exec-paired', !!h.paired);
      if (h.paired) {
        const curOrd = orders.find((c) => c && (c.state === 'queued' || c.state === 'sent')) || null;
        const liveWord = curOrd
          ? (curOrd.state === 'queued' ? '等接单' : (pausedNow ? '已暂停' : '正在跑'))
          : '';
        chip.textContent = '🖐 ' + who + (h.online ? ' · 在线' : ' · 离线') + (h.tier ? ' · ' + h.tier + '档' : '')
          + (j.killed ? ' · 🔴熔断中' : '');
        chip.style.cursor = '';
        chip.title = latest
          ? '执行器：' + (h.label || '') + '　最近活动：' + latest.text
          : '执行器：' + (h.label || '') + '　（还没动静）';
        if (liveWord) chip.textContent += ' · ' + liveWord;
        else if (latest) chip.textContent += ' · ' + String(latest.text).slice(0, 24);
      } else {
        /* 免费档/演示号没有下载入口：顶栏这颗也不写「去装」（点进去装机页只会让他看档位） */
        const noHand = !!(window.XhsExecBar && guideAcct &&
          (XhsExecBar.isDemo(guideAcct) || !XhsExecBar.isPaid(guideAcct)));
        chip.textContent = noHand ? '🖐 执行器：239 起档位带的 · 看怎么开' : '🖐 执行器：还没挂 · 去装';
        chip.style.cursor = 'pointer';
        chip.title = noHand ? '执行器是 239 起档位带的——开通后回装机页就有下载和配对号'
          : '还没挂执行器——下载装上、登录挂线后，这里会显示它在干什么';
      }
    }
    const opsBox = document.getElementById('hdrExecOps');
    if (opsBox) opsBox.style.display = h.paired ? '' : 'none';          // 菜单里那两颗钮：没挂执行器时整块不摆
    if (stopBtnEl) stopBtnEl.style.display = h.paired ? '' : 'none';
    if (unBtnEl) unBtnEl.style.display = h.paired ? '' : 'none';
    /* 工作台那两块：日志按条补齐（🤖 的也要，老板要看在打开哪篇、评论了几条）＋ 顶上「现在在干」 */
    paintReports(j.reports);
    paintLive(j);
    renderRecord(j);
    syncBenchChrome();
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

  /* ── 📜 运行日志（2026-11-05）──
     顶栏那颗「📜 运行日志」开它：把 /api/exec/orders 里的 reports 按天往回翻，
     点类别筛（搜索/打开/评论/跳过/失败），失败标红，整段能复制。
     只读服务器那本账，不碰执行器、也不另存一份。 */
  const RL = { open: false, reports: [], snaps: [], day: '', filter: 'all', timer: 0, openIds: new Set(), full: {} };
  const RL_FILTERS = [
    { k: 'all', name: '全部' },
    { k: 'notes', name: '📝 逐篇记录' },
    { k: 'search', name: '搜索' },
    { k: 'open', name: '打开' },
    { k: 'comment', name: '评论' },
    { k: 'skip', name: '跳过' },
    { k: 'fail', name: '失败' },
  ];
  const rlEl = (id) => document.getElementById(id);

  function rlDayOf(r) { return reportTime(r).day; }

  function rlDayName(d) {
    if (d === dayKey(new Date())) return '今天';
    if (d === dayKey(new Date(Date.now() - 86400000))) return '昨天';
    if (d === dayKey(new Date(Date.now() - 172800000))) return '前天';
    return String(d || '').length >= 10 ? d.slice(5) : d;
  }

  function rlMatch(t) {
    const f = RL.filter;
    if (f === 'all') return true;
    if (f === 'fail') return /^❌|^🔴|^🛑|^⚠️|失败|超时|没跑|打不开|没点上/.test(t);
    if (f === 'search') return /搜索|换词|排序|搜到|关键词/.test(t);
    if (f === 'open') return /打开/.test(t);
    if (f === 'comment') return /评论|回复/.test(t);
    if (f === 'skip') return /跳过|⏭/.test(t);
    return true;
  }

  /* 选中的那一天 → 一行一条（执行器会把几句凑在一条里，拆开才看得清） */
  function rlLines() {
    const out = [];
    (RL.reports || []).forEach((r) => {
      if (!r || rlDayOf(r) !== RL.day) return;
      const tm = reportTime(r).tm;
      reportLines(r).forEach((ln) => {
        if (!rlMatch(ln.text)) return;
        out.push({ tm: tm, src: ln.src, text: ln.text, type: logLineType(ln.text) });
      });
    });
    return out;
  }

  /* ── 逐篇记录（2026-11-05）：执行器每跑完一篇，回传「读到的正文 + 读到的评论 + 为什么这么决定」。
     老板要按篇回看、自己判断哪些该评——所以这里不加工，把读到的原样摊开。 */
  const rlDayOfSnap = (s) => {
    const at = Number(s && s.at) || Number(s && s.ts) || 0;
    return at ? dayKey(new Date(at)) : '';
  };
  const rlSnapList = () => (RL.snaps || [])
    .filter((s) => s && rlDayOfSnap(s) === RL.day)
    .sort((a, b) => (Number(a.at) || Number(a.ts) || 0) - (Number(b.at) || Number(b.ts) || 0));
  const RL_MODE_NAME = { note: '只评笔记', both: '评笔记＋回评论区', reply: '只回评论区', people: '只收人' };
  const rlModeText = (m) => RL_MODE_NAME[m] || m || '—';
  /* 每篇的「笔记层结论」：大V/竞对 · 刚起来 · 本篇怎么做 */
  const RL_ACT = { grab: '抢首评', comment: '值得评', reply: '只回评论', collect: '只收人', skip: '跳过' };
  function rlReviewText(rv) {
    if (!rv || typeof rv !== 'object') return '';
    const who = rv.matched === 'highv' ? '👑 大V' : rv.matched === 'rival' ? '🕵️ 竞对' : '';
    const fresh = rv.fresh ? '⏱ 刚起来' : '';
    const act = rv.fallback ? '没判成·按玩法' : (RL_ACT[rv.action] || (rv.verdict === 'blocked' ? '跳过' : ''));
    return [who, fresh, act].filter(Boolean).join(' · ');
  }
  function rlReviewTip(rv) {
    if (!rv || typeof rv !== 'object') return '';
    return [
      rv.freshWhy ? ('判成「刚起来」：' + rv.freshWhy) : '',
      rv.reason ? ('AI 判断：' + rv.reason) : '',
      rv.why ? ('这一篇这么做：' + rv.why) : '',
    ].filter(Boolean).join('\n');
  }

  function rlSnapEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function rlRenderFull(holder, full) {
    holder.textContent = '';
    holder.appendChild(rlSnapEl('div', 'rl-note-body', (full && full.body) || '（没读到正文）'));
    const fcs = (full && Array.isArray(full.comments)) ? full.comments : [];
    if (fcs.length) {
      const ol = rlSnapEl('ol', 'rl-note-cm');
      fcs.forEach((c) => {
        const li = rlSnapEl('li', c && c.hot ? 'hot' : '', '');
        li.textContent = (c && c.hot ? '🔥 ' : '') + '@' + ((c && c.a) || '用户')
          + (c && c.l ? '（' + c.l + '）' : '') + '：' + ((c && c.t) || '');
        ol.appendChild(li);
      });
      holder.appendChild(ol);
    } else {
      holder.appendChild(rlSnapEl('div', 'rl-note-meta', '（这一篇没读到评论）'));
    }
  }

  function rlPaintSnaps(list) {
    const arr = rlSnapList();
    if (!arr.length) {
      list.appendChild(rlSnapEl('div', 'rl-empty', '这一天还没有逐篇记录（新版执行器跑完一篇才会记；之前那些篇没留）'));
      return;
    }
    arr.forEach((s) => {
      const sent = Number(s.sent) || 0;
      const card = rlSnapEl('div', 'rl-note' + (sent > 0 ? ' sent' : ''));
      const h = rlSnapEl('div', 'rl-note-h');
      h.appendChild(rlSnapEl('span', 'rl-note-tm', reportTime(s).tm));
      h.appendChild(rlSnapEl('span', 'rl-note-title', s.title || '（没读到标题）'));
      h.appendChild(rlSnapEl('span', 'rl-note-badge', sent > 0 ? ('已发 ' + sent + ' 条') : '没发'));
      card.appendChild(h);
      const rvTxt = rlReviewText(s.noteReview);
      if (rvTxt) {
        const rv = rlSnapEl('div', 'rl-note-meta', '🧠 ' + rvTxt);
        const rvTip = rlReviewTip(s.noteReview);
        if (rvTip) rv.title = rvTip;
        card.appendChild(rv);
      }
      card.appendChild(rlSnapEl('div', 'rl-note-dec', '🖊 ' + (s.decide || '（这版执行器没记决定）') + (s.reason ? '（原因：' + s.reason + '）' : '')));
      card.appendChild(rlSnapEl('div', 'rl-note-meta',
        '策略：' + rlModeText(s.mode) + ' · 正文 ' + (Number(s.bodyLen) || 0) + ' 字 · 评论共 ' + (Number(s.totalComments) || 0) + ' 条'
        + (s.readErr ? ' · 读取有状况：' + s.readErr : '')));

      /* 正文/评论不塞进 8 秒一次的轮询里（慢网会被拖死）：点开这一篇再去服务器取全文 */
      const det = document.createElement('details');
      const storedN = Math.min(10, Number(s.totalComments) || 0);
      det.appendChild(rlSnapEl('summary', '', '展开看正文' + (storedN ? '和前 ' + storedN + ' 条评论' : '')));
      const holder = rlSnapEl('div', 'rl-note-full', '');
      det.appendChild(holder);
      if (RL.full[s.id]) rlRenderFull(holder, RL.full[s.id]);
      det.addEventListener('toggle', async () => {
        if (!det.open) { RL.openIds.delete(s.id); return; }
        RL.openIds.add(s.id);
        if (RL.full[s.id]) { rlRenderFull(holder, RL.full[s.id]); return; }
        if (det.dataset.loaded) return;
        det.dataset.loaded = '1';
        holder.textContent = '正在取这一篇的正文和评论…';
        try {
          const r = await fetch('api/exec/notesnap/get', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id }),
          });
          const j = await r.json();
          if (!j || !j.ok) throw new Error((j && j.error) || '取不到');
          RL.full[s.id] = j.snap || {};
          rlRenderFull(holder, RL.full[s.id]);
        } catch (e) {
          det.dataset.loaded = '';
          holder.textContent = '这次没取到：' + ((e && e.message) || e) + '（收起再点开试一次）';
        }
      });
      card.appendChild(det);
      if (RL.openIds.has(s.id)) det.open = true;   // 每 8 秒重画一次，展开着的这篇别给合上
      list.appendChild(card);
    });
  }

  /* 逐篇记录的样式：挂在执行桥里就地注入，不用改 popup.html（那份网页还有别的改动在并行，少碰一处少一处冲突） */
  function rlEnsureStyle() {
    if (document.getElementById('rlNoteStyle')) return;
    const st = document.createElement('style');
    st.id = 'rlNoteStyle';
    st.textContent = [
      '.rl-note{border:1px solid #ece3df;border-left:3px solid #c41d3c;border-radius:8px;background:#fff;padding:8px 10px;margin:0 0 8px;font-size:12px;line-height:1.6}',
      '.rl-note.sent{border-left-color:#2e9e5b}',
      '.rl-note-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}',
      '.rl-note-tm{color:#999;font-variant-numeric:tabular-nums}',
      '.rl-note-title{font-weight:700;color:#222}',
      '.rl-note-badge{font-size:11px;padding:1px 6px;border-radius:9px;background:#fdecef;color:#c41d3c}',
      '.rl-note.sent .rl-note-badge{background:#eaf7ef;color:#1f7a45}',
      '.rl-note-dec{color:#333;margin-top:2px;font-weight:600}',
      '.rl-note-meta{color:#999;font-size:11px;margin-top:2px}',
      '.rl-note details{margin-top:6px;border-top:1px dashed #efe6e2;padding-top:6px}',
      '.rl-note summary{cursor:pointer;color:#8a6b62;font-size:11px;font-weight:600}',
      '.rl-note-body{white-space:pre-wrap;word-break:break-word;background:#faf7f5;border-radius:6px;padding:6px 8px;margin:6px 0;color:#444}',
      '.rl-note-cm{margin:4px 0 0;padding-left:18px;color:#444}',
      '.rl-note-cm li{margin:2px 0}',
      '.rl-note-cm li.hot{color:#b3163a;font-weight:600}',
      '.rl-note-tip{background:#fff7f4;border:1px dashed #e7c9bf;border-radius:6px;padding:6px 9px;margin:0 0 8px;font-size:12px;color:#8a4a3a}',
    ].join('');
    document.head.appendChild(st);
  }

  function rlPaint() {
    const box = rlEl('rlDays');
    const chips = rlEl('rlChips');
    const list = rlEl('rlList');
    const sub = rlEl('rlSub');
    if (!box || !chips || !list) return;
    const days = Array.from(new Set(
      (RL.reports || []).map(rlDayOf).concat((RL.snaps || []).map(rlDayOfSnap))
    ).filter(Boolean)).sort().reverse();
    if (!days.length) days.push(dayKey(new Date()));
    if (days.indexOf(RL.day) < 0) RL.day = days[0];
    box.innerHTML = '';
    days.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-day' + (d === RL.day ? ' on' : '');
      b.dataset.d = d;
      b.textContent = rlDayName(d);
      b.title = d;
      box.appendChild(b);
    });
    chips.innerHTML = '';
    RL_FILTERS.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-chip' + (f.k === RL.filter ? ' on' : '');
      b.dataset.k = f.k;
      b.textContent = f.name;
      chips.appendChild(b);
    });
    const lines = rlLines();
    if (sub) {
      const head = rlDayName(RL.day) + (RL.day && RL.day !== rlDayName(RL.day) ? '（' + RL.day + '）' : '');
      sub.textContent = (RL.paired === false)
        ? '这台电脑还没挂上执行器'
        : head + (RL.filter === 'notes'
          ? ' · 共 ' + rlSnapList().length + ' 篇'
          : ' · 共 ' + lines.length + ' 条 · 逐篇 ' + rlSnapList().length + ' 篇 · 服务器留着最近几天，更早的会被顶掉');
    }
    list.innerHTML = '';
    if (RL.filter === 'notes') { rlPaintSnaps(list); return; }
    /* 不在「逐篇记录」这栏时，也给一句入口提示——不然老板不知道每一篇的正文/评论记在哪儿 */
    const snapN = rlSnapList().length;
    if (snapN) list.appendChild(rlSnapEl('div', 'rl-note-tip',
      '📝 这一天记了 ' + snapN + ' 篇：每一篇读到的正文、读到的评论、为什么评/不评——点上面「📝 逐篇记录」按篇展开'));
    if (!lines.length) {
      const e = document.createElement('div');
      e.className = 'rl-empty';
      e.textContent = RL.filter === 'all' ? '这一天还没有日志' : '这个类别下这一天没有日志';
      list.appendChild(e);
      return;
    }
    lines.forEach((l) => {
      const d = document.createElement('div');
      d.className = 'rl-line ' + l.type;
      const tm = document.createElement('span');
      tm.className = 't';
      tm.textContent = l.tm || '';
      const sc = document.createElement('span');
      sc.className = 't';
      sc.textContent = l.src || '';
      const tx = document.createElement('span');
      tx.textContent = l.text;
      d.appendChild(tm); d.appendChild(sc); d.appendChild(tx);
      list.appendChild(d);
    });
    list.scrollTop = list.scrollHeight;
  }

  async function rlFetch() {
    const list = rlEl('rlList');
    try {
      const r = await fetch('api/exec/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.error) || '取不到日志');
      RL.reports = Array.isArray(j.reports) ? j.reports : [];
      RL.snaps = Array.isArray(j.noteSnaps) ? j.noteSnaps : [];
      RL.paired = !!(j.hand && j.hand.paired);
      rlPaint();
    } catch (e) {
      if (!list) return;
      list.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'rl-empty';
      d.textContent = '这次没取到日志：' + ((e && e.message) || e) + '（网络不稳就点「↻ 刷新」再试）';
      list.appendChild(d);
    }
  }

  function rlOpen() {
    const m = rlEl('runLogModal');
    if (!m) return;
    m.style.display = 'flex';
    RL.open = true;
    rlFetch();
    if (!RL.timer) {
      RL.timer = setInterval(() => { if (RL.open) rlFetch(); }, 8000);
    }
  }

  function rlClose() {
    const m = rlEl('runLogModal');
    if (m) m.style.display = 'none';
    RL.open = false;
    if (RL.timer) { clearInterval(RL.timer); RL.timer = 0; }
  }

  function rlCopyFallback(txt, done) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { say('复制没成功，可以手动选中日志再复制', 'warn'); }
    ta.remove();
  }

  async function rlCopy() {
    /* 逐篇记录这栏：复制成「标题 / 决定 / 正文 / 评论」的纯文本，老板拿去做分析好喂给别的工具。
       正文和评论不在轮询里，所以这一下现去服务器取全文（只点一次才取）。 */
    if (RL.filter === 'notes') {
      const list = rlSnapList();
      if (!list.length) { say('这一天没有逐篇记录', 'warn'); return; }
      say('正在取这一天的正文和评论…', 'info');
      let arr = list;
      try {
        const r = await fetch('api/exec/notesnap/get', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: 1 }),
        });
        const j = await r.json();
        if (j && j.ok && Array.isArray(j.snaps) && j.snaps.length) {
          const want = new Set(list.map((s) => s.id));
          const got = j.snaps.filter((s) => s && want.has(s.id));
          if (got.length) arr = got;
        }
      } catch (_) {}
      const txt = arr.map((s) => [
        '《' + (s.title || '') + '》 ' + reportTime(s).tm + (Number(s.sent) > 0 ? '（已发 ' + s.sent + ' 条）' : '（没发）'),
        '决定：' + (s.decide || '') + (s.reason ? '（' + s.reason + '）' : ''),
        '正文：' + (s.body || ''),
        '评论（共 ' + (Number(s.totalComments) || (s.comments || []).length) + ' 条，列出前 ' + ((s.comments || []).length) + ' 条）：',
        (s.comments || []).map((c, i) => (i + 1) + '. ' + (c && c.hot ? '[商机] ' : '') + '@' + ((c && c.a) || '') + '：' + ((c && c.t) || '')).join('\n'),
      ].join('\n')).join('\n\n----------\n\n');
      const done = () => say('逐篇记录已复制（' + arr.length + ' 篇）', 'success');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done).catch(() => rlCopyFallback(txt, done));
          return;
        }
      } catch (_) {}
      rlCopyFallback(txt, done);
      return;
    }
    const lines = rlLines();
    const txt = lines.map((l) => (l.tm ? l.tm + ' ' : '') + l.text).join('\n');
    if (!txt) { say('这一天没有可复制的日志', 'warn'); return; }
    const done = () => say('日志已复制（' + lines.length + ' 条）', 'success');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(() => rlCopyFallback(txt, done));
        return;
      }
    } catch (_) {}
    rlCopyFallback(txt, done);
  }

  function wireRunLog() {
    rlEnsureStyle();
    const btn = rlEl('hdrRunLogBtn');
    if (btn && !btn.dataset.rlBound) {
      btn.dataset.rlBound = '1';
      btn.addEventListener('click', rlOpen);
    }
    const m = rlEl('runLogModal');
    if (!m || m.dataset.rlBound) return;
    m.dataset.rlBound = '1';
    m.addEventListener('click', (e) => { if (e.target === m) rlClose(); });
    const x = rlEl('rlClose'); if (x) x.addEventListener('click', rlClose);
    const rf = rlEl('rlRefresh'); if (rf) rf.addEventListener('click', rlFetch);
    const cp = rlEl('rlCopy'); if (cp) cp.addEventListener('click', rlCopy);
    const days = rlEl('rlDays');
    if (days) days.addEventListener('click', (e) => {
      const b = e.target.closest('.rl-day');
      if (!b || !b.dataset.d) return;
      RL.day = b.dataset.d;
      rlPaint();
    });
    const chips = rlEl('rlChips');
    if (chips) chips.addEventListener('click', (e) => {
      const b = e.target.closest('.rl-chip');
      if (!b || !b.dataset.k) return;
      RL.filter = b.dataset.k;
      rlPaint();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && RL.open) rlClose(); });
  }

  /* ── 挂线与轮询 ── */
  function boot() {
    wireRunLog();
    if (NO_STRIP) {
      log('出片页桥已就位：只挂出片下单口');
      return;
    }
    migrateRoundCap20();
    patchRuntime();
    patchRefreshClick();
    wireBenchButtons();
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
    wireBenchChrome();
    tick();
    setInterval(tick, 5000);
    log('执行器桥已就位（开始/停止、搜索、截流、评刷、整页发送、私信、监听 → 下单；停/解绑在右上账号菜单里）');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
