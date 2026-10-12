/* ============================================================
 * 服务器试用 demo · 翻译层 v0（chrome 垫片）
 * ------------------------------------------------------------
 * 干什么：把搬过来的界面骗住——它眼里还是「扩展」，其实底下是
 *         demo 环境：存储先给空（放内存里）、动作先吞掉。
 * 规矩：只活在 web/ 副本里；extension/ 原件一个字不动。
 * 哪报错补哪——控制台会给每条没垫住的调用记一笔（[垫片] …）。
 * 第 2 步：存储换成"真读真写服务器"；第 3 步：动作接去服务器。
 * ============================================================ */
(() => {
  if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) return;
  if (window.__XHS_DEMO_SHIM__) return;
  window.__XHS_DEMO_SHIM__ = true;

  const log = (...a) => console.log('%c[垫片]', 'color:#8a6d00', ...a);

  /* ── 存储：v0 先放内存（刷新即丢） ── */
  const mem = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function pick(keys) {
    const out = {};
    if (keys == null) { for (const k of Object.keys(mem)) out[k] = clone(mem[k]); return out; }
    if (typeof keys === 'string') { if (keys in mem) out[keys] = clone(mem[keys]); return out; }
    if (Array.isArray(keys)) { for (const k of keys) if (k in mem) out[k] = clone(mem[k]); return out; }
    for (const k of Object.keys(keys)) out[k] = (k in mem) ? clone(mem[k]) : clone(keys[k]);
    return out;
  }
  const changeFns = new Set();
  function fire(changes) {
    if (!Object.keys(changes).length) return;
    setTimeout(() => {
      for (const fn of changeFns) { try { fn(changes, 'local'); } catch (e) { console.warn('[垫片] onChanged 回调炸了', e); } }
    }, 0);
  }
  function area(name) {
    return {
      get(keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        if (name !== 'local') log(`storage.${name}.get（demo 只垫了 local，先返回空）`);
        const p = Promise.resolve(pick(keys));
        return cb ? (p.then(r => cb(r)), undefined) : p;
      },
      set(items, cb) {
        const changes = {};
        for (const k of Object.keys(items)) { changes[k] = { oldValue: clone(mem[k]), newValue: clone(items[k]) }; mem[k] = clone(items[k]); }
        fire(changes);
        const p = Promise.resolve();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      remove(keys, cb) {
        const ks = typeof keys === 'string' ? [keys] : (keys || []); const changes = {};
        for (const k of ks) { if (k in mem) { changes[k] = { oldValue: clone(mem[k]) }; delete mem[k]; } }
        fire(changes);
        const p = Promise.resolve();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      clear(cb) {
        const changes = {}; for (const k of Object.keys(mem)) { changes[k] = { oldValue: clone(mem[k]) }; delete mem[k]; }
        fire(changes);
        const p = Promise.resolve();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      onChanged: { addListener(fn) { changeFns.add(fn); }, removeListener(fn) { changeFns.delete(fn); }, hasListener(fn) { return changeFns.has(fn); } },
      QUOTA_BYTES: 10485760,
    };
  }
  const storage = {
    local: area('local'), sync: area('sync'), session: area('session'),
    onChanged: { addListener(fn) { changeFns.add(fn); }, removeListener(fn) { changeFns.delete(fn); }, hasListener(fn) { return changeFns.has(fn); } },
  };

  /* ── runtime：发动作先吞掉（第 3 步换成请求服务器） ── */
  const msgFns = new Set();
  const runtime = {
    id: 'demo-page',
    lastError: undefined,
    getManifest: () => ({ version: '0.0.0-demo', name: '小红书助手（试用 demo）' }),
    getURL: (p) => new URL(String(p || ''), location.href).toString(),
    sendMessage(msg, cb) {
      const action = (msg && msg.action) || '(无 action)';
      const reply = { ok: false, error: `[demo v0] 动作「${action}」还没接上服务器` };
      log('吞了一条动作:', action);
      const p = Promise.resolve(reply);
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
      contains: (o, cb) => { const p = Promise.resolve(false); return cb ? (p.then(cb), undefined) : p; },
      request: (o, cb) => { const p = Promise.resolve(false); return cb ? (p.then(cb), undefined) : p; },
      remove: () => Promise.resolve(false),
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
  log('翻译层 v0 已就位（存储＝内存、动作＝先吞）');
})();
