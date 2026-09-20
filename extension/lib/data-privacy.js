/**
 * data-privacy.js — 数据治理：敏感 key 整块加密落盘 + 过期自动清除
 *
 * ① 落盘加密：ENC_KEYS 里的整块数据（知识库/获客清单/会话与私信/回复记录/运行日志）
 *    以密文形式存 chrome.storage.local；读写统一走本模块的 lock/unlock，旧明文自动升级。
 *    config 内的 AI Key 等字段按字段加密（SECRET_PATHS）。
 * ② 过期清除：客户数据按「最后活动时间」静默满 CUSTOMER_DAYS 天清除，
 *    运行数据满 RUNTIME_DAYS 天清除；活动 key 与各租户快照一视同仁。
 *
 * 依赖：crypto-box.js（同上下文需先加载）。
 */

(function (root) {
  'use strict';

  const CB = root.CryptoBox;

  // 需要整块加密落盘的 key（客户数据 + 业务资料 + 运行日志）
  const ENC_KEYS = [
    'knowledge_base',
    'script_library',
    'prospect_list',
    'prospect_dm_history',
    'chat_follow_state',
    'chat_follow_reply_history',
    'watering_logs',
    'ai_logs',
    'replied_comments',
    'auto_water_history',   // 自动灌水历史（笔记标题/链接 → 按运行数据 30 天清除）
  ];

  // 只做过期清除、不做整块加密的 key（纯计数，不含个人信息）
  const SWEEP_EXTRA_KEYS = ['auto_water_daily'];
  const SWEEP_KEYS = ENC_KEYS.concat(SWEEP_EXTRA_KEYS);

  // config 内需要字段级加密的路径
  const SECRET_PATHS = [['ai', 'apiKey'], ['ai', 'fallbackApiKey']];

  const CUSTOMER_DAYS = 90;   // 客户数据（获客清单/私信/评论）静默天数
  const RUNTIME_DAYS = 30;    // 运行数据（灌水历史/AI 日志/回复流水）保留天数
  const DAY = 86400000;

  const SWEEP_TENANT_PREFIX = 'tenant_data__';

  function isEncKey(key) { return ENC_KEYS.indexOf(key) >= 0; }

  /* ─── key 级整块加解密 ─── */
  async function lock(key, value) {
    if (!isEncKey(key) || value === undefined || value === null) return value;
    if (CB.isLocked(value)) return value;                 // 已是密文
    return CB.lockJSON(value);
  }

  /** 解出明文；非密文原样返回；解密失败返回 null（调用方按默认值处理，且不要回写） */
  async function unlock(key, raw) {
    if (raw === undefined || raw === null) return raw;
    if (!isEncKey(key)) return raw;
    if (!CB.isLocked(raw)) return raw;                    // 存量明文
    return CB.unlockJSON(raw, null);
  }

  /* ─── config 内敏感字段 ─── */
  async function lockConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const out = JSON.parse(JSON.stringify(cfg));
    for (const [p, f] of SECRET_PATHS) {
      const v = out[p] && out[p][f];
      if (typeof v === 'string' && v && !CB.isLocked(v)) out[p][f] = await CB.lockText(v);
    }
    return out;
  }

  async function unlockConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    for (const [p, f] of SECRET_PATHS) {
      const v = cfg[p] && cfg[p][f];
      if (typeof v === 'string' && CB.isLocked(v)) {
        const plain = await CB.unlockText(v);
        cfg[p][f] = plain || '';
      }
    }
    return cfg;
  }

  /* ─── 存量迁移：明文 → 密文（幂等） ─── */
  async function migrateStorage() {
    const all = await chrome.storage.local.get(null);
    const writes = {};
    let migrated = 0;
    let failed = 0;

    for (const k of ENC_KEYS) {
      const v = all[k];
      if (v === undefined || v === null) continue;
      if (CB.isLocked(v)) {
        const ok = (await CB.unlockJSON(v, null)) !== null;
        if (!ok) failed++;
        continue;
      }
      writes[k] = await CB.lockJSON(v);
      migrated++;
    }

    // config：AI Key 等字段级加密
    if (all.config && typeof all.config === 'object' && !CB.isLocked(all.config)) {
      const locked = await lockConfig(all.config);
      if (JSON.stringify(locked) !== JSON.stringify(all.config)) { writes.config = locked; migrated++; }
    }

    // 租户快照：内层同样是那些 key，逐块升级
    for (const k of Object.keys(all)) {
      if (k.indexOf(SWEEP_TENANT_PREFIX) !== 0) continue;
      const snap = all[k];
      if (!snap || typeof snap !== 'object') continue;
      let changed = false;
      const next = { ...snap };
      for (const ik of ENC_KEYS) {
        const v = next[ik];
        if (v === undefined || v === null || CB.isLocked(v)) continue;
        next[ik] = await CB.lockJSON(v);
        changed = true;
      }
      if (next.config && typeof next.config === 'object') {
        const locked = await lockConfig(next.config);
        if (JSON.stringify(locked) !== JSON.stringify(next.config)) { next.config = locked; changed = true; }
      }
      if (changed) { writes[k] = next; migrated++; }
    }

    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
    if (migrated) console.log(`[隐私] 已加密落盘 ${migrated} 处本地数据`);
    if (failed) console.warn(`[隐私] ${failed} 处密文无法解开（本机加密盐不匹配）`);
    return { migrated, failed };
  }

  /* ─── 过期清除 ─── */
  function _toMs(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0) return v > 1e11 ? v : v * 1000;
    if (typeof v === 'string' && v) {
      if (/^\d{10,13}$/.test(v)) return _toMs(Number(v));
      const t = Date.parse(v);
      return isNaN(t) ? 0 : t;
    }
    return 0;
  }
  function _latest() {
    let max = 0;
    for (let i = 0; i < arguments.length; i++) {
      const t = _toMs(arguments[i]);
      if (t > max) max = t;
    }
    return max;
  }
  function _stale(ts, cutoff) { return ts > 0 && ts < cutoff; }

  /** 客户数据：最后活动时间早于 cutoff 即清除 */
  function _sweepProspectList(list, cutoff) {
    if (!Array.isArray(list)) return { changed: false, removed: 0 };
    const keep = [];
    let removed = 0;
    for (const p of list) {
      if (!p || typeof p !== 'object') { keep.push(p); continue; }
      const chan = Array.isArray(p.channels) ? p.channels : [];
      const ts = _latest(
        p.themRepliedAt, p.lastDmAt, p.updatedAt, p.createdAt, p.nTime, p.lastMsgAt,
        p.funnel && p.funnel.lastDmAt, p.lead && p.lead.lastSignalAt,
        ...chan.map(c => c && c.nTime)
      );
      if (_stale(ts, cutoff)) { removed++; continue; }
      keep.push(p);
    }
    return removed ? { changed: true, removed, value: keep } : { changed: false, removed: 0 };
  }

  function _sweepListOf(recs, tsOf, cutoff) {
    if (!Array.isArray(recs)) return { changed: false, removed: 0 };
    const keep = recs.filter(r => !_stale(tsOf(r), cutoff));
    const removed = recs.length - keep.length;
    return removed ? { changed: true, removed, value: keep } : { changed: false, removed: 0 };
  }

  function _sweepRepliedComments(map, cutoff) {
    if (!map || typeof map !== 'object') return { changed: false, removed: 0 };
    let removed = 0, changed = false;
    const out = {};
    for (const url of Object.keys(map)) {
      const arr = Array.isArray(map[url]) ? map[url] : [];
      const keep = arr.filter(e => !_stale(_toMs(e && e.repliedAt), cutoff));
      removed += arr.length - keep.length;
      if (keep.length) out[url] = keep;
      if (keep.length !== arr.length) changed = true;
    }
    return changed ? { changed: true, removed, value: out } : { changed: false, removed: 0 };
  }

  function _sweepChatFollow(state, cutoff) {
    if (!state || typeof state !== 'object' || !state.conversations) return { changed: false, removed: 0 };
    let removed = 0;
    const convs = {};
    for (const uid of Object.keys(state.conversations)) {
      const c = state.conversations[uid] || {};
      // 没有回复时间戳的会话（待回复清单）不动，避免把待办清掉
      if (_stale(_toMs(c.lastReplyAt), cutoff)) { removed++; continue; }
      convs[uid] = c;
    }
    if (!removed) return { changed: false, removed: 0 };
    return { changed: true, removed, value: { ...state, conversations: convs } };
  }

  function _sweepWaterHistory(map, cutoff) {
    if (!map || typeof map !== 'object') return { changed: false, removed: 0 };
    let removed = 0;
    const out = {};
    for (const k of Object.keys(map)) {
      const rec = map[k];
      if (_stale(_toMs(rec && (rec.wateredAt || rec.ts)), cutoff)) { removed++; continue; }
      out[k] = rec;
    }
    return removed ? { changed: true, removed, value: out } : { changed: false, removed: 0 };
  }

  function _sweepDaily(map, cutoff) {
    if (!map || typeof map !== 'object') return { changed: false, removed: 0 };
    let removed = 0;
    const out = {};
    for (const d of Object.keys(map)) {
      const t = Date.parse(d + 'T00:00:00');
      if (!isNaN(t) && t < cutoff) { removed++; continue; }
      out[d] = map[d];
    }
    return removed ? { changed: true, removed, value: out } : { changed: false, removed: 0 };
  }

  /**
   * 对一份「key → 值」的数据体做过期清除（活动 key 或某个租户快照均可）。
   * 返回 { changed, removed: {key: n}, value: 新对象 }
   */
  function sweepBody(body, now) {
    const custCut = now - CUSTOMER_DAYS * DAY;
    const runCut = now - RUNTIME_DAYS * DAY;
    const removed = {};
    const out = { ...body };
    let changed = false;
    const apply = (k, r) => {
      if (!r.changed) return;
      out[k] = r.value;
      removed[k] = (removed[k] || 0) + r.removed;
      changed = true;
    };
    apply('prospect_list', _sweepProspectList(body.prospect_list, custCut));
    apply('prospect_dm_history', _sweepListOf(body.prospect_dm_history, r => _toMs(r && r.sentAt), custCut));
    apply('chat_follow_reply_history', _sweepListOf(body.chat_follow_reply_history, r => _toMs(r && (r.at || r.ts)), custCut));
    apply('replied_comments', _sweepRepliedComments(body.replied_comments, custCut));
    apply('chat_follow_state', _sweepChatFollow(body.chat_follow_state, custCut));
    apply('watering_logs', _sweepListOf(body.watering_logs, r => _toMs(r && r.ts), runCut));
    apply('ai_logs', _sweepListOf(body.ai_logs, r => _toMs(r && r.timestamp), runCut));
    apply('auto_water_history', _sweepWaterHistory(body.auto_water_history, runCut));
    apply('auto_water_daily', _sweepDaily(body.auto_water_daily, runCut));
    return { changed, removed, value: out };
  }

  /** 全量扫描：活动 key + 所有租户快照，逐条过期清除（密文先解后清再加密） */
  async function sweepExpired(now) {
    now = now || Date.now();
    const all = await chrome.storage.local.get(null);
    const writes = {};
    const total = {};
    let failed = 0;

    const body = {};
    for (const k of Object.keys(all)) if (SWEEP_KEYS.indexOf(k) >= 0) body[k] = all[k];

    if (Object.keys(body).length) {
      const plain = {};
      for (const k of Object.keys(body)) {
        const v = await unlock(k, body[k]);
        if (v === null) { failed++; continue; }   // 解不开就不动，避免误清
        plain[k] = v;
      }
      const r = sweepBody(plain, now);
      for (const k of Object.keys(r.removed)) total[k] = (total[k] || 0) + r.removed[k];
      for (const k of Object.keys(r.removed)) {
        writes[k] = isEncKey(k) ? await CB.lockJSON(r.value[k]) : r.value[k];
      }
    }

    for (const k of Object.keys(all)) {
      if (k.indexOf(SWEEP_TENANT_PREFIX) !== 0) continue;
      const snap = all[k];
      if (!snap || typeof snap !== 'object') continue;
      const plain = {};
      for (const ik of SWEEP_KEYS) {
        if (snap[ik] === undefined) continue;
        const v = await unlock(ik, snap[ik]);
        if (v === null) { failed++; continue; }
        plain[ik] = v;
      }
      const r = sweepBody(plain, now);
      if (!r.changed) continue;
      const next = { ...snap };
      for (const ik of Object.keys(r.removed)) {
        next[ik] = isEncKey(ik) ? await CB.lockJSON(r.value[ik]) : r.value[ik];
        total[ik] = (total[ik] || 0) + r.removed[ik];
      }
      writes[k] = next;
    }

    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
    const sum = Object.values(total).reduce((a, b) => a + b, 0);
    if (sum) console.log('[隐私] 过期清除：' + Object.entries(total).map(([k, n]) => `${k} ${n} 条`).join('、'));
    if (failed) console.warn(`[隐私] ${failed} 处密文无法解开，已跳过清除`);
    return { removed: total, failed };
  }

  /* ─── 启动：迁移 + 清除 ─── */
  let _running = null;
  function startup() {
    if (_running) return _running;
    _running = (async () => {
      try { await migrateStorage(); } catch (e) { console.error('[隐私] 迁移失败', e); }
      try { await sweepExpired(); } catch (e) { console.error('[隐私] 清除失败', e); }
    })();
    return _running;
  }

  const DataPrivacy = {
    ENC_KEYS, SECRET_PATHS, CUSTOMER_DAYS, RUNTIME_DAYS,
    isEncKey, lock, unlock, lockConfig, unlockConfig,
    migrateStorage, sweepBody, sweepExpired, startup,
  };

  root.DataPrivacy = DataPrivacy;
  if (typeof module !== 'undefined') module.exports = DataPrivacy;
})(typeof self !== 'undefined' ? self : this);
