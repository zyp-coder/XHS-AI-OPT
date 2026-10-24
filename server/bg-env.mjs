/* 服务器试用 demo · 后台副本的"假浏览器环境"
 * ------------------------------------------------------------
 * 干什么：把 server/bg/background.js（extension/background.js 的逐字节副本）搬进 Node 原样跑，
 *         给它垫一套够启动、够指定动作用的 chrome.* 假件。
 * 规矩：
 *   · server/bg/ 是只读副本——要改先改 extension/ 再重拷，别在副本里动刀；
 *   · 这里垫的全是"存储 / 定时器 / 网络"。碰平台的真活（开标签页、注脚本、点按钮）
 *     在这套环境里没有真身：路由层压根不放那些动作进来（dev-server 的白名单）。
 *   · AI 调用是本环境唯一的"真出门"：出门口把 config 里存的标记 Key
 *     换成 server/.env 里的真 Key——客户的浏览器永远拿不到真 Key。
 *   · v4 免费额度：出门口真要换真 Key 的话，先问 dev-server 的闸门（这个账号还有免费
 *     次数吗）——有就换、记一笔（谁在用由 dev-server 认）；没有了直接抛"填自己的 Key"，
 *     真 Key 不出门。闸门/记账都挂在本次请求的上下文上（dev-server 用 AsyncLocalStorage 挂）。
 *   · v5 分账本：storage.local 不再直通"那一本账"，而是每次操作现问 bookFor(当前账号)
 *     （dev-server 给的定位函数）——每个账号一个 storage.local（自己的小账本）；
 *     没有请求上下文（启动初始化/种子/维护）时落账号模板。
 */
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

/** 存进账本的"占位 Key"：出门口按它换真 Key；客户看到的永远只是这串标记 */
export const DEMO_KEY_MARKER = '__demo-server-key__';

function makeEvent(log, label) {
  const fns = new Set();
  return {
    addListener(fn) { fns.add(fn); },
    removeListener(fn) { fns.delete(fn); },
    hasListener(fn) { return fns.has(fn); },
    _fire(...args) {
      for (const fn of fns) {
        try { fn(...args); } catch (e) { log(`[事件] ${label} 监听器炸了：${e.message}`); }
      }
    },
    _size() { return fns.size; },
  };
}

/**
 * 启动后台副本。
 * @param {object} o
 * @param {string} o.dir      server/bg/ 目录
 * @param {object} o.store    账本真源对象（与 dev-server 共用同一个引用，就地改）
 * @param {()=>Promise} o.persist  落盘函数
 * @param {string} [o.aiKey]  server/.env 里的真 AI Key（出门口换用；空＝没配）
 * @param {(s:string)=>void} [o.log]
 * @param {()=>({ip:string,accountId:string,swaps:number}|null)} [o.requesterCtx]  当前请求的上下文（出门口/存储靠它认"是谁、落哪本小账本"）
 * @param {(accountId:string|null)=>object} [o.bookFor]  v5 分账本定位：当前账号的小账本（null＝账号模板）
 * @param {(ctx:{ip:string,accountId:string})=>boolean} [o.canUseServerKey]  免费额度闸门：这个账号还能不能用服务器 Key
 * @param {string|()=>string} [o.quotaBlockedMessage]  被额度拦下时回给调用方的话
 * @returns {{dispatch:(msg:object)=>Promise<object>, version:string}}
 */
export async function bootBackground({
  dir, store, persist, aiKey = '', log = console.log,
  requesterCtx = null, bookFor = null, canUseServerKey = null, quotaBlockedMessage = '',
}) {
  const say = (s) => log(`[bg] ${s}`);
  const realFetch = globalThis.fetch;
  const warnOnce = new Set();
  const warnUnknownApi = (path) => {
    if (warnOnce.has(path)) return;
    warnOnce.add(path);
    say(`未垫的 API 被摸了：${path}（按无操作处理）`);
  };

  /* ── 存储：local 按请求路由到对应小账本（真源就是 dev-server 那份）；
   *    sync/session 只活在内存。bagOrFn 每次操作现解析——别在启动时定死，
   *    否则切账号后还会写进启动那一刻那本账。 ── */
  const memSync = {};
  const memSession = {};
  const storageChanged = makeEvent(say, 'storage.onChanged');
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const pick = (bag, keys) => {
    if (keys == null) return clone(bag);
    const out = {};
    if (typeof keys === 'string') { if (keys in bag) out[keys] = clone(bag[keys]); return out; }
    if (Array.isArray(keys)) { for (const k of keys) if (k in bag) out[k] = clone(bag[k]); return out; }
    for (const k of Object.keys(keys)) out[k] = (k in bag) ? clone(bag[k]) : clone(keys[k]);
    return out;
  };
  function areaOf(bagOrFn, isLocal) {
    const bagNow = () => (typeof bagOrFn === 'function' ? bagOrFn() : bagOrFn);
    const fire = (changes) => {
      if (!Object.keys(changes).length) return;
      storageChanged._fire(changes, isLocal ? 'local' : 'managed');
    };
    return {
      get(keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        const p = Promise.resolve(pick(bagNow(), keys));
        return cb ? (p.then((r) => cb(r)), undefined) : p;
      },
      set(items, cb) {
        const bag = bagNow();
        const changes = {};
        for (const k of Object.keys(items || {})) {
          changes[k] = (k in bag) ? { oldValue: clone(bag[k]), newValue: clone(items[k]) } : { newValue: clone(items[k]) };
          bag[k] = clone(items[k]);
        }
        const p = (async () => { if (isLocal) await persist(); fire(changes); })();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      remove(keys, cb) {
        const bag = bagNow();
        const ks = typeof keys === 'string' ? [keys] : (keys || []);
        const changes = {};
        for (const k of ks) if (k in bag) { changes[k] = { oldValue: clone(bag[k]) }; delete bag[k]; }
        const p = (async () => { if (isLocal) await persist(); fire(changes); })();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      clear(cb) {
        const bag = bagNow();
        const changes = {};
        for (const k of Object.keys(bag)) { changes[k] = { oldValue: clone(bag[k]) }; delete bag[k]; }
        const p = (async () => { if (isLocal) await persist(); fire(changes); })();
        return cb ? (p.then(() => cb()), undefined) : p;
      },
      QUOTA_BYTES: 10485760,
    };
  }
  /* 当前请求的账号 → 对应小账本；没有请求上下文 → 账号模板（启动初始化/种子/维护走这里） */
  const localBag = () => {
    const req = typeof requesterCtx === 'function' ? requesterCtx() : null;
    if (typeof bookFor === 'function') return bookFor(req && req.accountId);
    return store;
  };
  const localArea = areaOf(localBag, true);
  localArea.onChanged = storageChanged;

  /* ── runtime：onMessage 的监听器要抓住（路由的落点就是它） ── */
  const msgEvent = makeEvent(say, 'runtime.onMessage');
  const externalEvent = makeEvent(say, 'runtime.onMessageExternal');
  const SENDER = { id: 'demo-bg', tab: null, url: '', origin: '' };

  const events = {
    onStartup: makeEvent(say, 'runtime.onStartup'),
    onInstalled: makeEvent(say, 'runtime.onInstalled'),
    onConnect: makeEvent(say, 'runtime.onConnect'),
    onSuspend: makeEvent(say, 'runtime.onSuspend'),
    onMessage: msgEvent,
    onMessageExternal: externalEvent,
    tabsRemoved: makeEvent(say, 'tabs.onRemoved'),
    tabsUpdated: makeEvent(say, 'tabs.onUpdated'),
    tabsCreated: makeEvent(say, 'tabs.onCreated'),
    tabsActivated: makeEvent(say, 'tabs.onActivated'),
    tabsReplaced: makeEvent(say, 'tabs.onReplaced'),
    winRemoved: makeEvent(say, 'windows.onRemoved'),
    winFocus: makeEvent(say, 'windows.onFocusChanged'),
    alarmEvent: makeEvent(say, 'alarms.onAlarm'),
    actionClicked: makeEvent(say, 'action.onClicked'),
    notifClicked: makeEvent(say, 'notifications.onClicked'),
    notifClosed: makeEvent(say, 'notifications.onClosed'),
  };

  /* ── 出门口：AI 请求真出门；把标记 Key 换成 server/.env 的真 Key。
   *    v4 起多一道闸：这次真要动服务器 Key 的话——先过免费额度（用完不再换、
   *    直接抛"填自己的 Key"）；能过就记一笔，谁在烧由请求上下文认。── */
  async function envFetch(url, opts) {
    const u = typeof url === 'string' ? url : String((url && url.url) || url);
    if (/^(demo|chrome-extension):/i.test(u)) {
      return new Response('', { status: 404, statusText: 'demo: no such resource' });
    }
    let o = opts;
    const headerHasMarker = (v) => typeof v === 'string' && v.includes(DEMO_KEY_MARKER);
    const headersHaveMarker = (h) => {
      if (!h) return false;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        for (const [, v] of h) if (headerHasMarker(v)) return true;
        return false;
      }
      for (const k of Object.keys(h)) if (headerHasMarker(h[k])) return true;
      return false;
    };
    /* ★ 免费额度闸门（v5 起挂账号）：真要换真 Key 先看这个账号的额度够不够；过了记一笔。
     *   一个动作里烧多笔也只算这个动作一次——计次由上层（dev-server）按动作汇总。 */
    if (aiKey && o && o.headers && headersHaveMarker(o.headers)) {
      const req = typeof requesterCtx === 'function' ? requesterCtx() : null;
      if (req && req.accountId) {
        if (typeof canUseServerKey === 'function' && !canUseServerKey(req)) {
          const msg = typeof quotaBlockedMessage === 'function' ? quotaBlockedMessage() : (quotaBlockedMessage || '免费次数用完了');
          throw new Error(msg);
        }
        req.swaps = (req.swaps || 0) + 1;
      } else if (!warnOnce.has('quota-noctx')) {
        warnOnce.add('quota-noctx');
        say('⚠ 这次出门要动服务器 Key，但没挂着账号上下文（认不出是谁在烧）——照放行不计数，反复出现要查');
      }
    }
    if (o && o.headers) {
      const h = o.headers;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        let touched = false;
        for (const [k, v] of h) if (headerHasMarker(v)) { if (!aiKey) throw new Error('演示服务器还没配 AI Key（server/.env 的 AI_API_KEY）'); h.set(k, v.split(DEMO_KEY_MARKER).join(aiKey)); touched = true; }
        if (touched) o = { ...o, headers: h };
      } else {
        let touched = false;
        const nh = {};
        for (const k of Object.keys(h)) {
          const v = h[k];
          if (headerHasMarker(v)) {
            if (!aiKey) throw new Error('演示服务器还没配 AI Key（server/.env 的 AI_API_KEY）');
            nh[k] = v.split(DEMO_KEY_MARKER).join(aiKey);
            touched = true;
          } else nh[k] = v;
        }
        if (touched) o = { ...o, headers: nh };
      }
    }
    return realFetch(url, o);
  }

  /* ── chrome.* 假件 ── */
  const chrome = {
    runtime: {
      id: 'demo-bg-copy',
      lastError: undefined,
      getManifest: () => ({ version: 'demo-v5', name: '小红书助手（demo 后台副本）' }),
      getURL: (p) => 'demo://bg/' + String(p || ''),
      sendMessage: (msg, cb) => {
        const p = dispatch(msg);
        return cb ? (p.then((r) => cb(r)), undefined) : p;
      },
      onMessage: msgEvent,
      onMessageExternal: externalEvent,
      onStartup: events.onStartup,
      onInstalled: events.onInstalled,
      onConnect: events.onConnect,
      onSuspend: events.onSuspend,
      openOptionsPage: () => say('openOptionsPage（demo 不接）'),
      setUninstallURL: () => {},
    },
    storage: {
      local: localArea,
      sync: areaOf(memSync, false),
      session: areaOf(memSession, false),
      onChanged: storageChanged,
    },
    alarms: {
      create: () => {},
      clear: (n, cb) => { const p = Promise.resolve(false); return cb ? (p.then(cb), undefined) : p; },
      clearAll: () => Promise.resolve(false),
      get: (n, cb) => { const p = Promise.resolve(undefined); return cb ? (p.then(cb), undefined) : p; },
      getAll: (cb) => { const p = Promise.resolve([]); return cb ? (p.then(cb), undefined) : p; },
      onAlarm: events.alarmEvent,
    },
    action: {
      setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setBadgeTextColor: () => {},
      setTitle: () => {}, setIcon: () => {}, enable: () => {}, disable: () => {},
      onClicked: events.actionClicked,
    },
    tabs: {
      query: (q, cb) => { const p = Promise.resolve([]); return cb ? (p.then(cb), undefined) : p; },
      get: (id, cb) => { const p = Promise.resolve(null); return cb ? (p.then(cb), undefined) : p; },
      create: (o, cb) => { const p = Promise.resolve({ id: -1 }); return cb ? (p.then(cb), undefined) : p; },
      update: () => Promise.resolve({}),
      remove: () => Promise.resolve(),
      reload: () => Promise.resolve(),
      sendMessage: () => Promise.reject(new Error('demo：服务器侧没有真实标签页，这个动作要装了扩展才能用')),
      onRemoved: events.tabsRemoved, onUpdated: events.tabsUpdated, onCreated: events.tabsCreated,
      onActivated: events.tabsActivated, onReplaced: events.tabsReplaced,
    },
    scripting: {
      executeScript: () => Promise.resolve([{ result: null }]),
      insertCSS: () => Promise.resolve(), removeCSS: () => Promise.resolve(),
    },
    windows: {
      getCurrent: (o, cb) => { const p = Promise.resolve({ id: 1 }); return cb ? (p.then(cb), undefined) : p; },
      getAll: (o, cb) => { const p = Promise.resolve([]); return cb ? (p.then(cb), undefined) : p; },
      create: () => Promise.resolve({ id: -1 }),
      update: () => Promise.resolve({}),
      remove: () => Promise.resolve(),
      onRemoved: events.winRemoved, onFocusChanged: events.winFocus,
    },
    notifications: {
      create: (id, o, cb) => { const p = Promise.resolve('demo'); return cb ? (p.then(cb), undefined) : p; },
      clear: () => {}, onClicked: events.notifClicked, onClosed: events.notifClosed,
    },
    permissions: {
      contains: (o, cb) => { const p = Promise.resolve(true); return cb ? (p.then(cb), undefined) : p; },
      request: (o, cb) => { const p = Promise.resolve(true); return cb ? (p.then(cb), undefined) : p; },
      remove: () => Promise.resolve(true),
      onAdded: makeEvent(say, 'permissions.onAdded'), onRemoved: makeEvent(say, 'permissions.onRemoved'),
    },
    i18n: { getMessage: (k) => k, getUILanguage: () => 'zh-CN' },
    contextMenus: { create: () => {}, removeAll: () => {}, onClicked: makeEvent(say, 'contextMenus.onClicked') },
    tabGroups: {
      query: () => Promise.resolve([]), get: () => Promise.resolve(null),
      update: () => Promise.resolve(null), onUpdated: makeEvent(say, 'tabGroups.onUpdated'),
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    offscreen: { createDocument: () => Promise.resolve(), closeDocument: () => Promise.resolve() },
  };

  /* 兜底：没垫到的 chrome.* 记一笔、按无操作处理（跟网页垫片一个路数） */
  const chromeProxy = new Proxy(chrome, {
    get(t, prop) {
      if (prop in t) return t[prop];
      const key = 'chrome.' + String(prop);
      return new Proxy(function () {}, {
        get(_t2, p2) {
          if (p2 === 'addListener' || p2 === 'removeListener') return () => {};
          if (p2 === 'hasListener') return () => false;
          if (p2 === 'then') return undefined;
          warnUnknownApi(key + '.' + String(p2));
          return new Proxy(function () {}, { get: () => undefined, apply: () => Promise.resolve(undefined) });
        },
        apply: () => { warnUnknownApi(key); return Promise.resolve(undefined); },
      });
    },
  });

  /* ── 组装 vm 环境 ── */
  const sandbox = {
    console: {
      log: (...a) => say(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
      warn: (...a) => say('⚠ ' + a.map(String).join(' ')),
      error: (...a) => say('✖ ' + a.map(String).join(' ')),
      info: (...a) => say(a.map(String).join(' ')),
      debug: () => {},
    },
    chrome: chromeProxy,
    fetch: envFetch,
    Response,
    Headers,
    Request,
    AbortController,
    AbortSignal,
    crypto: webcrypto,
    TextEncoder, TextDecoder,
    URL, URLSearchParams,
    Blob, FormData, ReadableStream, WritableStream,
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    structuredClone,
    queueMicrotask,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance,
    navigator: { userAgent: 'demo-server', platform: 'demo', language: 'zh-CN', languages: ['zh-CN'], onLine: true },
    indexedDB: undefined,
    location: undefined,
    document: undefined,
    window: undefined,
    self: undefined,
    importScripts: (...files) => {
      for (const f of files) {
        const fp = join(dir, f);
        let code;
        try { code = readFileSync(fp, 'utf8'); }
        catch (e) { throw new Error(`importScripts 找不到 ${f}：${e.message}`); }
        runInContext(code, ctx, { filename: f });
      }
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = createContext(sandbox);

  /* 副本里的漏网异步错误：记一笔别让整个 demo 服务器塌掉 */
  process.on('unhandledRejection', (err) => {
    say('未处理的异步错误：' + ((err && err.message) || err));
  });

  /* ── 路由落点：等后台自己的 onMessage 监听器回应 ── */
  function dispatch(message, timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve) => {
      let done = false;
      const respond = (r) => {
        if (done) return;
        done = true;
        resolve(r && typeof r === 'object' ? r : { ok: false, error: '后台没有回应（空响应）' });
      };
      if (!msgEvent._size()) { resolve({ ok: false, error: '后台副本没有注册消息监听器（启动失败？）' }); return; }
      msgEvent._fire(message, SENDER, respond);
      setTimeout(() => respond({ ok: false, error: `后台动作超时（${Math.round(timeoutMs / 60000)} 分钟没回）` }), timeoutMs);
    });
  }

  /* ── 加载副本 ── */
  let bgCode;
  try { bgCode = readFileSync(join(dir, 'background.js'), 'utf8'); }
  catch (e) { throw new Error(`读不到 ${join(dir, 'background.js')}：${e.message}`); }
  say('开始加载后台副本…');
  try { runInContext(bgCode, ctx, { filename: 'server/bg/background.js' }); }
  catch (e) { throw new Error(`后台副本启动失败：${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`); }
  if (!msgEvent._size()) throw new Error('后台副本加载完但没注册 onMessage 监听器');
  say(`后台副本已就位（onMessage 监听器 ${msgEvent._size()} 个）`);

  return {
    dispatch,
    version: 'demo-v5',
  };
}
