/* ============================================================
 * 服务器试用 demo · 翻译层（chrome 垫片）
 * ------------------------------------------------------------
 * 干什么：把搬过来的界面骗住——它眼里还是「扩展」，其实底下是
 *         demo 环境。规矩：只活在 web/ 副本里；extension/ 原件一个字不动。
 * 现在到哪：
 *   v0（第 1 步）：存储＝内存、动作＝先吞，页面能翻。
 *   v1（第 2 步）：存储＝真读真写（服务器 data/store.json 是真账本，刷新不丢）；
 *                  跨文档 onChanged 走 BroadcastChannel（设置页换色、外面那层立刻变）。
 *   v2（第 3 步）：动作＝真发服务器（/api/action → 后台副本干活）；
 *                  白名单外的动作服务器会回「要扩展」，本层原样交给页面显示。
 *   v3（2026-10-13 中午）：账号守卫——工作台各页先问"有号吗"，没号送去账号页登录/领号；
 *                  存储/动作拿到 need-account 也走同一条送去。
 *   v5（2026-10-17）：账号独立成页；没号一律去 account.html，不再回起始页弹小卡。
 * 哪报错补哪——控制台会给每条没垫住的调用记一笔（[垫片] …）。
 * ============================================================ */
(() => {
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return;
  if (window.__XHS_DEMO_SHIM__) return;
  window.__XHS_DEMO_SHIM__ = true;

  const log = (...a) => console.log('%c[垫片]', 'color:#8a6d00', ...a);

  /* ── 云端请求忙碌指示（2026-10-20）：读/写账本、发动作、下单发笔记这些请求
   *    每次一趟网络来回，跨境慢时几秒——页面不动人以为卡死。在飞就显示顶部一条
   *    「云端数据收发中」小转圈；300ms 内回来不闪（免刷屏），首屏罩子还扣着时不叠加。 ── */
  const BUSY_API = /^api\/(storage|action|exec)\b/;
  let busyN = 0, busyEl = null, busyShowT = null, busyHideT = null;
  function busyUi() {
    if (busyEl) return busyEl;
    if (document.getElementById('wbLoadOverlay')) return null;   // 首屏罩子正在显示进度，不重复提示
    try {
      const st = document.createElement('style');
      st.textContent = '@keyframes wbBusySpin{to{transform:rotate(360deg)}}.wb-busy{position:fixed;top:0;left:12px;z-index:99996;display:flex;align-items:center;gap:7px;padding:6px 12px 7px;background:rgba(43,47,54,.92);color:#fff;font-size:12px;border-radius:0 0 9px 9px;box-shadow:0 2px 8px rgba(0,0,0,.18);pointer-events:none;opacity:0;transition:opacity .2s}.wb-busy i{display:inline-block;width:12px;height:12px;box-sizing:border-box;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:wbBusySpin .8s linear infinite}';
      document.head.appendChild(st);
      busyEl = document.createElement('div');
      busyEl.className = 'wb-busy';
      busyEl.innerHTML = '<i></i><span>云端数据收发中…</span>';
      document.documentElement.appendChild(busyEl);
    } catch (_) { busyEl = null; }
    return busyEl;
  }
  function busyStart() {
    busyN++;
    if (busyN !== 1) return;
    clearTimeout(busyHideT);
    busyShowT = setTimeout(() => { const el = busyUi(); if (el) el.style.opacity = '1'; }, 300);
  }
  function busyStop() {
    busyN = Math.max(0, busyN - 1);
    if (busyN !== 0) return;
    clearTimeout(busyShowT);
    busyHideT = setTimeout(() => { if (busyEl && busyN === 0) busyEl.style.opacity = '0'; }, 250);
  }
  if (window.top === window.self && typeof fetch === 'function') {
    const _fetch0 = window.fetch.bind(window);
    window.fetch = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
      if (!url || !BUSY_API.test(String(url).replace(/^\/+/, ''))) return _fetch0(input, init);
      busyStart();
      return _fetch0(input, init).finally(busyStop);
    };
  }

  /* ── 账号守卫（v5）：没号就把人带到账号页（只带顶层窗口；设置页是内嵌 iframe，不动它）── */
  let sentToAccount = false;
  function needAccount() {
    if (sentToAccount) return;
    if (window.top !== window.self) return;   // 内嵌 iframe：交给外层页面带
    if (/\/start\.html$/.test(location.pathname) || /\/account\.html$/.test(location.pathname) || location.pathname === '/') return;
    sentToAccount = true;
    log('还没登录——带你去账号页登录 / 领号');
    location.replace('account.html?need=1');
  }

  /* ── 存储 ──
   * local：真读真写——每笔进出都找服务器（data/store.json 是真账本）。
   * sync / session：demo 里没有对应概念，先留在内存（页面基本不用这两个区）。
   * onChanged：同一页里的监听照常触发；跨文档（设置 iframe ↔ 外面那层）走
   * BroadcastChannel 送到各家——对齐 chrome 里"设置页换了色、已开弹窗立刻跟着变"。 */
  const mem = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const changeFns = new Set();
  const bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('__demo_storage__') : null;
  if (bc) bc.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.__demoStorage && d.changes) fire(d.changes, true);
  });
  function fire(changes, fromRemote) {
    if (!changes || !Object.keys(changes).length) return;
    setTimeout(() => {
      for (const fn of changeFns) { try { fn(changes, 'local'); } catch (e) { console.warn('[垫片] onChanged 回调炸了', e); } }
    }, 0);
    if (!fromRemote && bc) { try { bc.postMessage({ __demoStorage: 1, changes }); } catch (_) {} }
  }
  /* 按 keys 从 items 里取（keys==null→全部；对象形式→缺席的用其默认值补上） */
  function pickFrom(items, keys) {
    if (keys == null) return clone(items);
    const out = {};
    if (typeof keys === 'string') { if (keys in items) out[keys] = clone(items[keys]); return out; }
    if (Array.isArray(keys)) { for (const k of keys) if (k in items) out[k] = clone(items[k]); return out; }
    for (const k of Object.keys(keys)) out[k] = (k in items) ? clone(items[k]) : clone(keys[k]);
    return out;
  }
  function normKeys(keys) { // 发给服务器"要哪些键"：null＝整个账本
    if (keys == null) return null;
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys.slice();
    return Object.keys(keys);
  }
  const srv = {
    async call(op, payload) {
      const r = await fetch('api/storage/' + op, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && j.demo === 'need-account') needAccount();   // 会话没了/没登录：带去账号页
      if (!j || !j.ok) throw new Error((j && j.error) || '服务器回错了');
      return j;
    },
  };
  function srvArea() { // local：真读真写
    return {
      get(keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        const p = (async () => {
          try { const j = await srv.call('get', { keys: normKeys(keys) }); return pickFrom(j.items || {}, keys); }
          catch (e) { log('存储读不动（服务器没开？）', e.message); return pickFrom({}, keys); }
        })();
        return cb ? (p.then(r => cb(r)), undefined) : p;
      },
      set(items, cb) {
        const p = (async () => {
          try {
            const j = await srv.call('set', { items });
            fire(j.changes || {}, false);
            /* 交文件落账（np_pub_files）→ 顺手把原素材托管一份到服务器（fire-and-forget）——
               排期到点时服务器要自己拿得到图/片（见 mirrorNoteFiles） */
            if (items && items.np_pub_files && typeof items.np_pub_files === 'object') {
              for (const id of Object.keys(items.np_pub_files)) { mirrorNoteFiles(id).catch(() => {}); }
            }
          }
          catch (e) { log('存储写不动（服务器没开？这次改动没进账本）', e.message); }
        })();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      remove(keys, cb) {
        const p = (async () => {
          try { const j = await srv.call('remove', { keys }); fire(j.changes || {}, false); }
          catch (e) { log('存储写不动（服务器没开？这次改动没进账本）', e.message); }
        })();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      clear(cb) {
        const p = (async () => {
          try { const j = await srv.call('clear', {}); fire(j.changes || {}, false); }
          catch (e) { log('存储写不动（服务器没开？这次改动没进账本）', e.message); }
        })();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      onChanged: { addListener(fn) { changeFns.add(fn); }, removeListener(fn) { changeFns.delete(fn); }, hasListener(fn) { return changeFns.has(fn); } },
      QUOTA_BYTES: 10485760,
    };
  }
  function memArea(name) { // sync / session：demo 没有对应概念，先放内存
    return {
      get(keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        log(`storage.${name}.get（demo 只垫了 local，先返回空）`);
        const p = Promise.resolve(pickFrom(mem, keys));
        return cb ? (p.then(r => cb(r)), undefined) : p;
      },
      set(items, cb) {
        const changes = {};
        for (const k of Object.keys(items)) { changes[k] = { oldValue: clone(mem[k]), newValue: clone(items[k]) }; mem[k] = clone(items[k]); }
        fire(changes, true);
        const p = Promise.resolve();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      remove(keys, cb) {
        const ks = typeof keys === 'string' ? [keys] : (keys || []); const changes = {};
        for (const k of ks) { if (k in mem) { changes[k] = { oldValue: clone(mem[k]) }; delete mem[k]; } }
        fire(changes, true);
        const p = Promise.resolve();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      clear(cb) {
        const changes = {}; for (const k of Object.keys(mem)) { changes[k] = { oldValue: clone(mem[k]) }; delete mem[k]; }
        fire(changes, true);
        const p = Promise.resolve();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      onChanged: { addListener(fn) { changeFns.add(fn); }, removeListener(fn) { changeFns.delete(fn); }, hasListener(fn) { return changeFns.has(fn); } },
      QUOTA_BYTES: 10485760,
    };
  }
  const storage = {
    local: srvArea(), sync: memArea('sync'), session: memArea('session'),
    onChanged: { addListener(fn) { changeFns.add(fn); }, removeListener(fn) { changeFns.delete(fn); }, hasListener(fn) { return changeFns.has(fn); } },
  };

  /* ── 真发笔记下单（A 期真链）：网页点「▶ 现在发」→ 服务器把活派给这只账号的执行器 ──
   * 翻译层在这儿把"扩展里的真跑动作"翻成"服务器下单"：
   *   ① 从账号小账本读这篇的稿（np_notes）与备料元数据（np_pub_files）
   *   ② 从浏览器"备料区"（IndexedDB xhsCase/case，键 pub:<篇id>:<i>）把图/片取出来 → base64
   *   ③ 连稿带料 POST 给 /api/exec/order（服务器只记账、不碰平台；真发在客户浏览器的执行器里跑）
   * A 期只接小红书（xhs）；多家适配稿排在后面。 */
  const CASE_DB = 'xhsCase', CASE_STORE = 'case', FILE_PREFIX = 'pub:';
  function idbStaged(id, n, prefix) {
    const pre = String(prefix || FILE_PREFIX);
    return new Promise((resolve) => {
      let out = [];
      let req;
      try { req = indexedDB.open(CASE_DB, 1); } catch (_) { return resolve(out); }
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(CASE_STORE)) db.createObjectStore(CASE_STORE, { keyPath: 'key' }); };
      req.onerror = () => resolve(out);
      req.onsuccess = () => {
        const db = req.result;
        let tx;
        try { tx = db.transaction(CASE_STORE, 'readonly'); } catch (_) { try { db.close(); } catch (_) {} return resolve(out); }
        const st = tx.objectStore(CASE_STORE);
        let left = Math.max(1, n);
        for (let i = 0; i < Math.max(1, n); i++) {
          const g = st.get(pre + id + ':' + i);
          g.onsuccess = () => {
            const rec = g.result;
            if (rec && rec.blob) out.push({ i: i, blob: rec.blob });
            if (--left <= 0) finish();
          };
          g.onerror = () => { if (--left <= 0) finish(); };
        }
        function finish() { try { db.close(); } catch (_) {} resolve(out.sort((a, b) => a.i - b.i)); }
      };
    });
  }
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => { const s = String(fr.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  /* ── 素材托管镜像（v6 · 排期自动下单要用）──
   * 排期到点时是服务器自己下单，那时网页可能根本没开着——所以素材得先存到服务器上：
   * 网页交料那一下（np_pub_files 落账）顺手把原素材按字节存进服务器（POST api/blob/put 原始二进制），
   * 索引写进账本 np_srv_files {篇id:[{id,name,mime,size}]}。服务器排期派单只带 blobId，
   * 执行器凭挂线凭据再从 /api/exec/blob 取原件（见 executor/exec-shell.js 的 fetchCommandFiles）。
   * 全程后备式：失败不拦页面——排期那侧缺料会记「没料」提示补齐，补齐那一刻自动接上。 */
  async function mirrorNoteFiles(id) {
    try {
      let bag;
      try { bag = (await srv.call('get', { keys: ['np_pub_files'] })).items || {}; }
      catch (_) { return; }
      const meta = (bag.np_pub_files || {})[id];
      /* 发布台二选一：out='long' 走 publong:<id>:<i>（长图那几张）；否则走 pub:（分图文 / 视频） */
      const isLong = String((meta && meta.out) || '') === 'long' && String((meta && meta.kind) || '') !== 'video';
      const n = meta ? (isLong
        ? Math.max(Number(meta.longN) || 0, Number(meta.longNeed) || 0, 0)
        : Math.max(Number(meta.n) || 0, Number(meta.need) || 0, 0)) : 0;
      if (!n) return;
      const packed = await idbStaged(id, n, isLong ? 'publong:' : FILE_PREFIX);
      if (!packed.length) return;
      const list = [];
      for (const p of packed) {
        const name = p.blob.name || ('file' + p.i);
        const mime = p.blob.type || 'application/octet-stream';
        try {
          const r = await fetch('api/blob/put?name=' + encodeURIComponent(name) + '&mime=' + encodeURIComponent(mime), { method: 'POST', body: p.blob });
          const j = await r.json();
          if (j && j.ok && j.id) list.push({ id: j.id, name: name, mime: mime, size: j.size || p.blob.size || 0 });
        } catch (_) {}
      }
      if (list.length !== packed.length) { log('素材托管没存全（' + list.length + '/' + packed.length + '）——下次交/下次发时再补'); return; }
      const cur = (await srv.call('get', { keys: ['np_srv_files'] })).items || {};
      const m = Object.assign({}, cur.np_srv_files || {});
      m[id] = list;
      await srv.call('set', { items: { np_srv_files: m } });
      log('素材已托管到服务器（' + list.length + ' 件）：' + id);
    } catch (e) { log('素材托管出错（不影响发，排期缺料会提示补齐）', e.message); }
  }
  /* 这轮接进开关/并行的两家；视频号先不接（原来的发法照旧） */
  const PUB_ROUND = ['xhs', 'douyin'];
  function pubIsVideoForm(form) {
    const f = String(form || '');
    return f === '视频' || f === '案例成片' || f.indexOf('口播') >= 0 || f === '数字人';
  }
  function pubPlatsFor(form) {
    if (typeof Platforms !== 'undefined' && Platforms.pubChannelsFor) {
      return Platforms.pubChannelsFor(pubIsVideoForm(form)).filter((p) => PUB_ROUND.indexOf(p) >= 0);
    }
    return PUB_ROUND.slice();
  }
  /** 这篇这次该发哪几家：每篇选好的（没过就按形式全发）∩ 本轮两家 ∩ 顶上总开关，再刨掉已经发成的家 */
  function pubSelFor(bag, id, form, key) {
    const can = pubPlatsFor(form);
    const lineKey = key ? (String(key) + '|' + id) : '';
    const rec = lineKey && bag.np_pub_plats ? bag.np_pub_plats[lineKey] : null;
    let sel = Array.isArray(rec) ? rec.filter((p) => can.indexOf(p) >= 0) : [];
    if (!sel.length) sel = can.slice();
    const sw = (bag.np_pub_switch && typeof bag.np_pub_switch === 'object') ? bag.np_pub_switch : {};
    const offAll = sel.every((p) => sw[p] === false);
    sel = sel.filter((p) => sw[p] !== false);
    const sent = (bag.np_pub_sent && bag.np_pub_sent[id]) || {};
    const left = sel.filter((p) => !(sent[p] && sent[p].ok));
    return { sel: left, offAll: offAll, sentAll: sel.length > 0 && left.length === 0 };
  }
  async function orderNotePublish(data) {
    const id = String((data && data.id) || '').trim();
    if (!id) return { ok: false, error: '没说要发哪一篇' };
    let bag;
    try { bag = (await srv.call('get', { keys: ['np_notes', 'np_pub_files', 'np_pub_switch', 'np_pub_plats', 'np_pub_sent'] })).items || {}; }
    catch (e) { return { ok: false, error: '读不到这篇的稿（服务器没开？）：' + e.message }; }
    const notes = Array.isArray(bag.np_notes) ? bag.np_notes : [];
    const note = notes.find((n) => n && String(n.id) === id);
    if (!note) return { ok: false, error: '这篇不在档案里了' };
    if (note.status === '草稿') return { ok: false, error: '「' + (note.title || '这篇') + '」还是草稿——先去档案定稿' };
    const meta = (bag.np_pub_files || {})[id];
    const isLong = String((meta && meta.out) || '') === 'long' && String((meta && meta.kind) || '') !== 'video';
    const n = meta ? (isLong
      ? Math.max(Number(meta.longN) || 0, Number(meta.longNeed) || 0, 1)
      : Math.max(Number(meta.n) || 0, Number(meta.need) || 0, 1)) : 0;
    if (!n) return { ok: false, error: '还缺料——点行里的「📁 交文件」把图/片交进来，再发' };
    mirrorNoteFiles(id).catch(() => {});   // 补一次托管（交料那次没镜像上也兜住——fire-and-forget，不拦下单）
    let packed;
    try { packed = await idbStaged(id, n, isLong ? 'publong:' : FILE_PREFIX); } catch (_) { packed = []; }
    if (!packed.length) return { ok: false, error: '备料在浏览器里找不到了——重新交一次文件再发' };
    const files = [];
    for (const p of packed) {
      try { files.push({ name: p.blob.name || ('file' + p.i), mime: p.blob.type || 'application/octet-stream', b64: await blobToB64(p.blob) }); } catch (_) {}
    }
    if (!files.length) return { ok: false, error: '素材读不出来——重新交一次文件再发' };
    const explicit = String((data && data.platform) || '');   // 🔁 重试只补点名的这一家（不受总开关/已发账影响）
    let sel;
    if (explicit) sel = [explicit];
    else {
      const r = pubSelFor(bag, id, note.form, data && data.key);
      if (!r.sel.length) {
        return { ok: false, error: r.sentAll
          ? '这篇选中的家都发过了——要重发某一家，去「📜 最近发过」点那一家的 🔁 重试'
          : '这篇选中的家都被总开关点暗了——先在发布队列顶上把要发的那家点亮' };
      }
      sel = r.sel;
    }
    const fallback = { title: note.title || '', body: note.draft || '', tags: [] };
    const platforms = sel.map((p) => ({
      platform: p,
      adapted: (note.pub && note.pub.adapted && note.pub.adapted[p]) || fallback,
    }));
    let j;
    try {
      const r = await fetch('api/exec/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'note_publish', params: { note: { id: id, form: note.form || '图文', title: note.title || '' }, platform: platforms[0].platform, platforms: platforms, files: files } }),
      });
      j = await r.json();
    } catch (e) { return { ok: false, error: '下单没送到服务器：' + e.message }; }
    if (j && j.demo === 'need-account') { needAccount(); return { ok: false, error: j.error || '先登录' }; }
    if (!j || !j.ok) return { ok: false, error: (j && j.error) || '服务器没接这单' };
    log('发笔记已下单：' + id + ' → 执行器（' + platforms.map((x) => x.platform).join('+') + '，' + files.length + ' 个素材）' + (j.delivered ? '（执行器在线，当场送达）' : '（执行器不在线，先排着）'));
    return { ok: true, ordered: true, cmdId: j.cmdId, delivered: !!j.delivered, platforms: platforms.map((x) => x.platform) };
  }

  /* ── runtime：动作真发服务器（/api/action → 后台副本干活） ── */
  const msgFns = new Set();
  const runtime = {
    id: 'demo-page',
    lastError: undefined,
    getManifest: () => ({ version: '0.0.0-demo', name: '小红书助手（试用 demo）' }),
    getURL: (p) => new URL(String(p || ''), location.href).toString(),
    sendMessage(msg, cb) {
      const action = (msg && msg.action) || '(无 action)';
      const p = (async () => {
        /* 真发笔记：不送到后台副本，直接翻译成"服务器下单"，派给这只账号的执行器去真发。
           npPubRetry＝发布台上那条「🔁 补发」，跟首发同一条链（同一个下单口）。 */
        if (msg && (msg.action === 'npPubRun' || msg.action === 'npPubRetry')) {
          try { return await orderNotePublish(msg.data || {}); }
          catch (e) { return { ok: false, error: '下单出错：' + (e && e.message) }; }
        }
        try {
          const r = await fetch('api/action', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg || {}),
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json();
          if (!j || !j.ok) throw new Error((j && j.error) || '服务器回错了');
          if (j.result && j.result.demo === 'need-account') needAccount();   // 没登录：带去账号页
          return j.result !== undefined ? j.result : { ok: true };
        } catch (e) {
          log(`动作「${action}」没送到服务器：` + e.message);
          return { ok: false, error: '[demo] 服务器没开或断了（' + e.message + '）', demo: 'offline' };
        }
      })();
      return cb ? (p.then(r => cb(r)), undefined) : p;
    },
    onMessage: { addListener(fn) { msgFns.add(fn); }, removeListener(fn) { msgFns.delete(fn); }, hasListener(fn) { return msgFns.has(fn); } },
    onConnect: { addListener() {} },
    connect() { return { postMessage() {}, disconnect() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }; },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    openOptionsPage() { log('openOptionsPage 被点了（demo 不接）'); },
  };

  /* ── 常用面：安全桩（真用到再补） ── */
  const noop = () => {};
  const evt = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });
  const chrome = {
    storage, runtime,
    tabs: {
      query: (q, cb) => { const p = Promise.resolve([]); return cb ? (p.then(cb), undefined) : p; },
      get: (id, cb) => { const p = Promise.resolve(null); return cb ? (p.then(cb), undefined) : p; },
      create: (o, cb) => { log('tabs.create（demo 先不真开页）', o); const p = Promise.resolve({ id: -1 }); return cb ? (p.then(cb), undefined) : p; },
      update: () => Promise.resolve({}),
      remove: () => Promise.resolve(),
      sendMessage: (id, m, cb) => { log('tabs.sendMessage（demo 先吞）', m && m.action); const p = Promise.resolve(undefined); return cb ? (p.then(cb), undefined) : p; },
      reload: () => Promise.resolve(),
      onUpdated: evt(), onRemoved: evt(), onActivated: evt(), onCreated: evt(),
    },
    scripting: {
      executeScript: (o) => { log('scripting.executeScript（demo 先吞）'); return Promise.resolve([{ result: null }]); },
      insertCSS: () => Promise.resolve(), removeCSS: () => Promise.resolve(),
    },
    permissions: {
      /* demo 里所有对外请求都走服务器，网页侧没有跨域授权这回事 → 一律"已授权"，
         免得设置页「保存 AI 配置」弹警告、测试连接被拦 */
      contains: (o, cb) => { const p = Promise.resolve(true); return cb ? (p.then(cb), undefined) : p; },
      request: (o, cb) => { const p = Promise.resolve(true); return cb ? (p.then(cb), undefined) : p; },
      remove: () => Promise.resolve(true),
      onAdded: evt(), onRemoved: evt(),
    },
    alarms: {
      create: noop,
      clear: (n, cb) => { const p = Promise.resolve(false); return cb ? (p.then(cb), undefined) : p; },
      clearAll: () => Promise.resolve(false),
      get: (n, cb) => { const p = Promise.resolve(undefined); return cb ? (p.then(cb), undefined) : p; },
      getAll: (cb) => { const p = Promise.resolve([]); return cb ? (p.then(cb), undefined) : p; },
      onAlarm: evt(),
    },
    notifications: {
      create: (id, o, cb) => { const p = Promise.resolve('demo'); return cb ? (p.then(cb), undefined) : p; },
      clear: noop, onClicked: evt(), onClosed: evt(),
    },
    windows: {
      getCurrent: (o, cb) => { const p = Promise.resolve({ id: 1, width: innerWidth, height: innerHeight }); return cb ? (p.then(cb), undefined) : p; },
      create: () => Promise.resolve({ id: -1 }), update: () => Promise.resolve({}), onFocusChanged: evt(), onRemoved: evt(),
    },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop, setIcon: noop, onClicked: evt() },
    i18n: { getMessage: (k) => k, getUILanguage: () => 'zh-CN' },
    downloads: {
      download: (o, cb) => { log('downloads.download（demo v0 先不开下载）', o && o.filename); const p = Promise.resolve(-1); return cb ? (p.then(cb), undefined) : p; },
    },
    contextMenus: { create: noop, removeAll: noop, onClicked: evt() },
    tabGroups: {
      query: (q, cb) => { const p = Promise.resolve([]); return cb ? (p.then(cb), undefined) : p; },
      get: () => Promise.resolve(null), update: () => Promise.resolve(null), onUpdated: evt(),
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
  };

  /* 兜底：还有没垫到的，记一笔（方便"哪报错补哪"） */
  const seen = new Set();
  const stubFn = function () { return Promise.resolve(undefined); };
  window.chrome = new Proxy(chrome, {
    get(t, prop) {
      if (prop in t) return t[prop];
      const key = 'chrome.' + String(prop);
      if (!seen.has(key)) { seen.add(key); log('未垫的 API 被摸了:', key); }
      return new Proxy(stubFn, {
        get(_t, p2) {
          if (p2 === 'addListener' || p2 === 'removeListener') return noop;
          if (p2 === 'hasListener') return () => false;
          return undefined;
        },
        apply: () => Promise.resolve(undefined),
      });
    },
  });
  log('翻译层 v4 已就位（存储＝真读真写服务器、动作＝真发服务器、账号守卫在岗、真发笔记＝下单派给执行器）');

  /* ── 进门先问：有号吗（v5）。没号 → 账号页登录/领号；服务器没开 → 什么都不做，保持老样（页面照翻）── */
  (async () => {
    try {
      if (window.top !== window.self) return;
      if (/\/start\.html$/.test(location.pathname) || /\/account\.html$/.test(location.pathname) || location.pathname === '/') return;
      const r = await fetch('api/auth/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.ok && !j.account) needAccount();
    } catch (_) { /* 服务器没开：不拦 */ }
  })();
})();
