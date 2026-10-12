/* 手机桥 · 后台（每分钟把主扩展的只读快照推给中转，手机从那头取）
 *
 * 它是**独立的一个扩展**，跟主包彻底隔开：主包只多了一句 externally_connectable 白名单，
 * 权限、存储、代码都不掺和。卸掉它，主包照跑；装上它，还得先装主扩展。
 *
 * 三件事：
 *   ① 找主扩展（management 列一遍，谁能回 bridgeHello 就是它）→ 拿快照
 *   ② 按中转地址把快照推上去（电脑只出网、不开端口）
 *   ③ 配对码的登记 / 解绑（弹窗扫的那个二维码）
 */
importScripts('lib/ids.js', 'lib/relay.js');

const K_RELAY = 'bridge.relay';
const K_NAME = 'bridge.name';
const K_PAIR = 'bridge.pair';
const K_MAIN = 'bridge.mainId';
const K_MAIN_MANUAL = 'bridge.mainIdManual';
const K_LAST = 'bridge.last';
const ALARM = 'bridge-push';
/* 推快照的最小频率：云上 KV 免费版按「一天 1000 次写」算，所以
   · 内容在变（队列在跑）：最快 100 秒推一次 → 最坏一天 ~900 次，留了余量
   · 内容没变：5 分钟一次心跳，手机那边 12 分钟没动静才算离线（见 relay/phone/index.html） */
const PUSH_GAP_MS = 100 * 1000;
const PUSH_IDLE_MS = 5 * 60 * 1000;

/** 中转地址（默认本机版；云上地址在弹窗里改） */
async function relayBase() {
  const d = await chrome.storage.local.get(K_RELAY);
  return RelayClient.normBase(d[K_RELAY]) || RelayClient.DEFAULT_BASE;
}

/** 主扩展：先认弹窗里手填的 ID，再认自动找到的（缓存住了就不重新列一遍） */
async function findMain(force) {
  const d = await chrome.storage.local.get([K_MAIN, K_MAIN_MANUAL]);
  const manual = String(d[K_MAIN_MANUAL] || '').trim();
  if (manual) {
    const r = await askMain(manual, { action: 'bridgeHello' });
    if (r && r.ok) {
      await chrome.storage.local.set({ [K_MAIN]: manual, 'bridge.mainName': r.name || '', 'bridge.mainVer': r.app || '', 'bridge.mainAuto': false });
      return manual;
    }
    if (!d[K_MAIN]) await chrome.storage.local.remove(['bridge.mainName', 'bridge.mainVer']);
  }
  if (!force && d[K_MAIN]) return d[K_MAIN];
  let list = [];
  try { list = await chrome.management.getAll(); } catch (_) { list = []; }
  for (const it of list) {
    if (!it || it.id === chrome.runtime.id || it.type !== 'extension' || !it.enabled) continue;
    const r = await askMain(it.id, { action: 'bridgeHello' });
    if (r && r.ok) {
      await chrome.storage.local.set({ [K_MAIN]: it.id, 'bridge.mainName': r.name || '', 'bridge.mainVer': r.app || '', 'bridge.mainAuto': true });
      return it.id;
    }
  }
  await chrome.storage.local.remove([K_MAIN, 'bridge.mainName', 'bridge.mainVer', 'bridge.mainAuto']);
  return '';
}

/** 跨扩展问一句（主包白名单里只有手机桥，别家扩展问不问得到无所谓） */
function askMain(id, message) {
  return new Promise((resolve) => {
    try {
      const p = chrome.runtime.sendMessage(id, message, (r) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(r || null);
      });
      if (p && typeof p.then === 'function') p.then((r) => resolve(r || null)).catch(() => resolve(null));
    } catch (_) { resolve(null); }
  });
}

/** 拿一份快照：主扩展没开着／被禁用了 → 给一份带说明的空快照（手机看得到"电脑在线，主扩展没开"） */
async function takeSnapshot() {
  const mainId = await findMain();
  if (!mainId) return { ok: false, err: '没找到主扩展（小红书评论助手），它装上并启用了吗', snapshot: null };
  const r = await askMain(mainId, { action: 'bridgeSnapshot' });
  if (!r || !r.ok) {
    await findMain(true);   // 可能刚升级换了 ID：清缓存，下一次自己找回来
    return { ok: false, err: '主扩展没回应（可能正在重启）', snapshot: null };
  }
  return { ok: true, err: '', snapshot: r.snapshot };
}

/** 一次上报：没配对就什么都不做（不联网、不空转）；force＝手动点「立即上报一次」 */
async function pushOnce(force) {
  const d = await chrome.storage.local.get([K_PAIR, K_LAST]);
  const pair = d[K_PAIR] || null;
  if (!pair || !pair.token) return { ok: false, err: 'not_paired' };
  const prev = d[K_LAST] || null;
  const base = await relayBase();
  const name = (await chrome.storage.local.get(K_NAME))[K_NAME] || pair.host || '这台电脑';
  const got = await takeSnapshot();
  const snapshot = got.snapshot || {
    at: Date.now(), app: '', queue: {}, run: {}, daily: { on: false }, autorun: { on: false }, err: got.err,
  };
  /* 只看内容：at 是每次快照都会变的时钟，不参与比对 */
  const digest = JSON.stringify(snapshot, (k, v) => (k === 'at' ? undefined : v));
  const since = Date.now() - ((prev && prev.at) || 0);
  if (!force && prev && prev.ok) {
    if (prev.digest === digest ? since < PUSH_IDLE_MS : since < PUSH_GAP_MS) {
      return { ok: true, skipped: true, err: '' };
    }
  }
  const r = await RelayClient.push(base, {
    deviceId: pair.deviceId, token: pair.token, host: name,
    ver: (got.snapshot && got.snapshot.app) || pair.ver || '', snapshot,
  });
  const last = { at: Date.now(), ok: !!r.ok, digest, err: r.ok ? (got.ok ? '' : got.err) : (r.net ? '连不上中转' : '中转拒绝了：' + (r.error || r.status || '')) };
  await chrome.storage.local.set({ [K_LAST]: last });
  return last;
}

/** 每分钟一次（闹钟跨 SW 重启存活；装/启动时都确保它在） */
async function ensureAlarm() {
  try {
    const a = await chrome.alarms.get(ALARM);
    if (!a || a.periodInMinutes !== 1) {
      chrome.alarms.clear(ALARM, () => chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 1 }));
    }
  } catch (_) {}
}
chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === ALARM) pushOnce(); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); });
ensureAlarm();

/* ── 弹窗要的四件事 ── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = (message && message.action) || '';
  const jobs = {
    /* 状态：中转通不通 / 主扩展找到没 / 上次上报成不成 */
    bridgeStatus: async () => {
      const base = await relayBase();
      const d = await chrome.storage.local.get([K_PAIR, K_NAME, K_MAIN, K_MAIN_MANUAL, 'bridge.mainName', 'bridge.mainVer', 'bridge.mainAuto', K_LAST]);
      const pair = d[K_PAIR] || null;
      const mainId = await findMain();
      const h = await RelayClient.health(base);
      return {
        base, name: d[K_NAME] || (pair && pair.host) || '这台电脑',
        paired: !!(pair && pair.token),
        pair: pair ? { deviceId: pair.deviceId, code: pair.code, codeAt: pair.codeAt, url: pair.url, host: pair.host } : null,
        main: mainId ? { id: mainId, name: d['bridge.mainName'] || '', ver: d['bridge.mainVer'] || '', auto: d['bridge.mainAuto'] !== false } : null,
        mainIdManual: d[K_MAIN_MANUAL] || '',
        relay: h.ok ? { ok: true, ver: h.ver, lan: h.lan || [] } : { ok: false, net: !!h.net },
        last: d[K_LAST] || null,
      };
    },
    /* 出配对码：已配对过就沿用同一个设备（旧手机不作废），只换一张新码 */
    bridgePairNew: async () => {
      const base = await relayBase();
      const d = await chrome.storage.local.get([K_PAIR, K_NAME]);
      const old = d[K_PAIR] || {};
      const deviceId = old.deviceId || RelayClient.randHex(32);
      const token = old.token || RelayClient.randHex(32);
      const code = RelayClient.newPairCode(8);
      const h = await RelayClient.health(base);
      const lan = (h.ok && Array.isArray(h.lan) && h.lan.length) ? pickLan(h.lan) : '';
      const url = RelayClient.pairUrl(lan || base, code);
      const mainId = await findMain();
      const hello = mainId ? await askMain(mainId, { action: 'bridgeHello' }) : null;
      const name = d[K_NAME] || old.host || '这台电脑';
      const r = await RelayClient.pairNew(base, {
        deviceId, token, pairCode: code, host: name, ver: (hello && hello.app) || '',
      });
      if (!r.ok) return { ok: false, error: r.net ? '连不上中转：先把中转跑起来（node relay/local/server.mjs）' : ('中转拒绝了：' + (r.error || r.status || '')), base, lan };
      const pair = { deviceId, token, code, codeAt: Date.now(), host: name, url, base, via: lan || base, ver: (hello && hello.app) || '' };
      await chrome.storage.local.set({ [K_PAIR]: pair });
      await chrome.storage.local.remove(K_LAST);   // 配对后第一次上报别被节流吞掉
      return { ok: true, pair, lan: !!lan };
    },
    bridgeSetRelay: async () => {
      const base = RelayClient.normBase(message.base);
      if (!/^https?:\/\/[^\s]+$/i.test(base)) return { ok: false, error: '地址要写成 http://… 或 https://…' };
      await chrome.storage.local.set({ [K_RELAY]: base });
      await chrome.storage.local.remove(K_LAST);   // 换了中转，旧记录不作数，下轮必推
      return { ok: true, base };
    },
    /* 兜底：自动找不到主扩展时，手填它的 ID（chrome://extensions 里能看到） */
    bridgeSetMainId: async () => {
      const id = String(message.mainId || '').trim();
      if (id && !/^[a-p]{32}$/.test(id)) return { ok: false, error: '扩展 ID 是 32 位小写字母（a–p）' };
      if (id) await chrome.storage.local.set({ [K_MAIN_MANUAL]: id });
      else await chrome.storage.local.remove([K_MAIN_MANUAL]);
      const found = await findMain(true);
      return { ok: true, mainId: found || '' };
    },
    bridgeSetName: async () => {
      const name = String(message.name || '').trim().slice(0, 20) || '这台电脑';
      await chrome.storage.local.set({ [K_NAME]: name });
      return { ok: true, name };
    },
    bridgeUnbind: async () => {
      const d = await chrome.storage.local.get(K_PAIR);
      const pair = d[K_PAIR] || null;
      if (pair && pair.token) await RelayClient.unbind(await relayBase(), { deviceId: pair.deviceId, token: pair.token });
      await chrome.storage.local.remove([K_PAIR, K_LAST]);
      return { ok: true };
    },
    /* 手动「立刻上报」：不管节流，推就是推 */
    bridgePushNow: async () => {
      const r = await pushOnce(true);
      return r;
    },
  };
  const job = jobs[action];
  if (!job) { sendResponse({ ok: false, error: '未知 action: ' + action }); return false; }
  job().then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

/* 家里往往有好几张网卡（虚拟机、Docker 也各报一个）：优先挑像家里/办公室那张的 */
function pickLan(list) {
  const ok = (list || []).filter((u) => /^https?:\/\//i.test(u) && !/169\.254\./.test(u));
  const nice = ok.find((u) => /\/\/(192\.168\.|10\.)/.test(u));
  return nice || ok[0] || '';
}
