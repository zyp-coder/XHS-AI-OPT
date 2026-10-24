/**
 * account-guard.js — 🛡 账号安全（行为层加固）单一真源
 *
 * 口径＝《资料/账号行为层加固设计.md》（2026-10-11 老板已圈）：平台认的是「干活的节奏像机器」，
 * 这层管「一天动多少 / 什么时候动」，与「拟人化与频率」页（管每步停多久）各管各的。
 *
 *   ① 总挡位三档（保守/谨慎/正常）× 日波动 0.6~1.0（凌晨定死，当天不再变）
 *   ② 三条硬规矩：静默期 21:00–09:00（09:00 后随机 0~40 分钟起床）/ 每周单休（随机抽 1 天，当周固定可换）/ 干歇节拍（每小时最多动 30 分钟）
 *   ③ 两条缓冲：发笔记前 15 分钟只浏览、发布后 30 分钟全停、发笔记当天其他动作打折（保守 5 折 / 谨慎 7.5 折 / 正常不打折）；采集收口
 *   ④ 体检卡：记警告/限流降一级、处罚直落保守、已在保守再记只提醒、恢复手动
 *
 * 存储键（随租户切换的键在 tenant.js 里；发布侧 np_pub_guard 跟发布队列一样是全局的）：
 *   account_guard  { level, restWeek, restDay }            挡位 + 本周休息日
 *   guard_daily    { date, wave, wakeDelayMin, used{}, beatH, beatMin, beatLast }   当日账本
 *   account_health [ { t, kind, note, at, before, after, floor } ]                  体检卡历史
 *   np_pub_guard   { leadUntil, busySince, postUntil, defers{} }   发布前/后缓冲 + 顺延账（background 发布链写，这里读）
 *                  leadUntil＝下一位子的到点时刻（发布前 15 分钟＝它前面那个窗口）；defers＝{行key:{to,reason}}
 *
 * 注意：本文件被 background.js（importScripts）、popup.html / settings.html（经典 <script>）共用，
 *       只写顶层 const，不要碰裸 window（后台 SW 会整体不启动）。
 */

const AccountGuard = (() => {
  'use strict';

  /* ─── 三档参数表（一天合计上限；打开浏览含：获客打开、截流扫描、日常浏览） ─── */
  const LEVELS = [
    { name: '保守', sub: '默认 · 最高风险保护', cap: { open: 60, like: 20, save: 8, comment: 12, follow: 4, dm: 8, post: 2 } },
    { name: '谨慎', sub: '量放开一档', cap: { open: 140, like: 45, save: 16, comment: 25, follow: 9, dm: 16, post: 3 } },
    { name: '正常', sub: '日常运营量', cap: { open: 240, like: 80, save: 28, comment: 45, follow: 16, dm: 30, post: 5 } },
  ];
  const KINDS = ['open', 'like', 'save', 'comment', 'follow', 'dm', 'post'];
  const KIND_NAMES = {
    open: '打开 / 浏览笔记', like: '点赞', save: '收藏', comment: '评论 + 回复',
    follow: '关注', dm: '私信', post: '发笔记',
  };
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];   // JS getDay(): 0=周日

  const QUIET_FROM_H = 21, QUIET_TO_H = 9;      // 静默期 21:00–09:00（固定）
  const WAKE_MAX_MIN = 40;                       // 09:00 后再随机等 0~40 分钟起床
  const BURST_MIN_PER_HOUR = 30;                 // 干歇节拍：每小时最多自动动 30 分钟
  const POST_LEAD_MIN = 15;                      // 发布前 15 分钟只浏览
  const POST_HOLD_MIN = 30;                      // 发布后 30 分钟不跑其他
  const POSTDAY_FACTOR = { '保守': 0.5, '谨慎': 0.75, '正常': 1 };   // 发笔记当天其他动作打折
  const BUSY_STALE_MS = 60 * 60000;              // 发布 busy 标记超 60 分钟当残留（SW 被掐断）忽略

  const K = { CFG: 'account_guard', DAILY: 'guard_daily', HEALTH: 'account_health', PUB: 'np_pub_guard' };

  /* ─── 小工具 ─── */
  function _num(v, def, min, max) {
    const n = Number(v);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  function _dstr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _todayKey(nowMs) { return _dstr(new Date(nowMs || Date.now())); }
  /* 本周（周一起算）的周一日期，做「当周固定」的分界 */
  function _weekKey(nowMs) {
    const d = new Date(nowMs || Date.now());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return _dstr(d);
  }
  function _at(d, h, m) { const x = new Date(d); x.setHours(h, m || 0, 0, 0); return x.getTime(); }
  function _inQuiet(nowMs) { const h = new Date(nowMs || Date.now()).getHours(); return h >= QUIET_FROM_H || h < QUIET_TO_H; }

  /* 写操作串行化（同一上下文内；跨上下文极小概率的读改写竞争可以容忍——封顶少算不超发太多） */
  let _wq = Promise.resolve();
  function _serial(fn) { const p = _wq.then(fn); _wq = p.catch(() => {}); return p; }

  /* ─── 读写 ─── */
  async function _get(key) { try { const d = await chrome.storage.local.get(key); return d ? d[key] : undefined; } catch (_) { return undefined; } }
  async function _set(obj) { try { await chrome.storage.local.set(obj); } catch (_) {} }

  function _normCfg(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const level = LEVELS.some(l => l.name === o.level) ? o.level : '保守';
    const rd = parseInt(o.restDay, 10);
    return { level, restWeek: String(o.restWeek || ''), restDay: (rd >= 0 && rd <= 6) ? rd : -1 };
  }
  /* 抽本周休息日：只从「今天起、到本周日为止」里挑（避免抽到已经过去的日子、这周白歇） */
  function _drawRestDay(nowMs) {
    const today = new Date(nowMs || Date.now()).getDay();
    const cands = [today];
    for (let i = 1; i < 7; i++) { const dow = (today + i) % 7; cands.push(dow); if (dow === 0) break; }
    return cands[Math.floor(Math.random() * cands.length)];
  }

  async function getCfg(nowMs) {
    const now = nowMs || Date.now();
    const cfg = _normCfg(await _get(K.CFG));
    const wk = _weekKey(now);
    if (cfg.restWeek !== wk || cfg.restDay < 0) {
      cfg.restWeek = wk;
      cfg.restDay = _drawRestDay(now);
      await _set({ [K.CFG]: cfg });
    }
    return cfg;
  }
  async function saveCfg(patch) {
    const cur = _normCfg(await _get(K.CFG));
    const next = Object.assign({}, cur, patch || {});
    if (next.level && !LEVELS.some(l => l.name === next.level)) next.level = cur.level;
    const rd = parseInt(next.restDay, 10);
    if (!(rd >= 0 && rd <= 6)) next.restDay = cur.restDay;
    if (patch && ('restDay' in patch || 'level' in patch)) next.restWeek = _weekKey();
    await _set({ [K.CFG]: next });
    return next;
  }

  function _normDaily(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const used = {};
    KINDS.forEach(k => { used[k] = Math.max(0, parseInt(((o.used || {})[k]), 10) || 0); });
    return {
      date: String(o.date || ''),
      wave: _num(o.wave, 0, 0.6, 1),
      wakeDelayMin: _num(o.wakeDelayMin, 0, 0, WAKE_MAX_MIN),
      used,
      beatH: isFinite(Number(o.beatH)) ? Number(o.beatH) : -1,
      beatMin: _num(o.beatMin, 0, 0, 600),
      beatLast: isFinite(Number(o.beatLast)) ? Number(o.beatLast) : -1,
    };
  }
  function _freshDaily(nowMs) {
    const used = {};
    KINDS.forEach(k => { used[k] = 0; });
    return {
      date: _todayKey(nowMs),
      wave: Math.round((0.6 + Math.random() * 0.4) * 100) / 100,   // 日波动 0.6~1.0，当天定死
      wakeDelayMin: Math.floor(Math.random() * (WAKE_MAX_MIN + 1)),
      used, beatH: -1, beatMin: 0, beatLast: -1,
    };
  }
  async function getDaily(nowMs) {
    const now = nowMs || Date.now();
    let d = _normDaily(await _get(K.DAILY));
    if (d.date !== _todayKey(now)) { d = _freshDaily(now); await _set({ [K.DAILY]: d }); }
    return d;
  }

  async function _getPub() {
    const o = (await _get(K.PUB)) || {};
    return {
      leadUntil: Number(o.leadUntil) || 0,
      busySince: Number(o.busySince) || 0,
      postUntil: Number(o.postUntil) || 0,
      defers: (o.defers && typeof o.defers === 'object') ? o.defers : {},
    };
  }
  async function _setPub(patch) {
    const cur = await _getPub();
    await _set({ [K.PUB]: Object.assign({}, cur, patch || {}) });
  }

  /* ─── 判定 ─── */
  function _restToday(cfg, nowMs) { return cfg.restDay >= 0 && cfg.restDay === new Date(nowMs).getDay(); }
  function _beforeWake(daily, nowMs) {
    const d = new Date(nowMs);
    const wake = _at(d, QUIET_TO_H, 0) + daily.wakeDelayMin * 60000;
    return nowMs >= _at(d, QUIET_TO_H, 0) && nowMs < wake;
  }
  /* 每天都会挡的墙（休息日 / 静默期 / 起床前 / 发布占线 / 发布后缓冲）→ {code,text,at?} | null
     at＝预计恢复时刻（发布后缓冲＝postUntil；占线＝结束时间未知，给"尽快复查"） */
  function _wall(cfg, daily, pub, nowMs) {
    if (_restToday(cfg, nowMs)) return { code: 'rest', text: '今天是本周的单休日——全停一天（想换日子：设置 → 🛡 账号安全）' };
    if (_inQuiet(nowMs)) return { code: 'quiet', text: '静默期（21:00–09:00）不跑——顺延到 09:00 后' };
    if (_beforeWake(daily, nowMs)) return { code: 'quiet', text: '还没到起床时间（09:00 后随机等 0~40 分钟）——稍后再来' };
    if (pub.busySince && nowMs - pub.busySince < BUSY_STALE_MS) return { code: 'hold', text: '正在发笔记这一趟——其他自动化先让路', at: nowMs };
    if (pub.postUntil > nowMs) return { code: 'hold', text: '刚发完笔记——30 分钟内不跑其他自动化', at: pub.postUntil };
    return null;
  }
  /* 发布前 15 分钟「只浏览不动手」：leadUntil 存的是下一位子的到点时刻，窗口＝它前面的 15 分钟 */
  function _lead(pub, nowMs) {
    return (pub.leadUntil > nowMs && nowMs >= pub.leadUntil - POST_LEAD_MIN * 60000)
      ? { code: 'hold', text: '马上要发笔记——发布前 15 分钟只浏览不动手' } : null;
  }
  function _burstHit(daily, nowMs) {
    return daily.beatH === new Date(nowMs).getHours() && daily.beatMin >= BURST_MIN_PER_HOUR;
  }

  /* 当天这个动作的实际上限：挡位 × 日波动 ×（发笔记当天其他动作打折） */
  function capOf(kind, cfg, daily) {
    const lv = LEVELS.find(l => l.name === cfg.level) || LEVELS[0];
    let cap = Math.round((lv.cap[kind] || 0) * daily.wave);
    if (kind !== 'post' && (daily.used.post || 0) > 0) cap = Math.round(cap * (POSTDAY_FACTOR[cfg.level] || 1));
    return cap;
  }

  /* 只读检查：现在能不能做 kind 的动作（不扣账）。返回 { ok, code, text, used, cap, level, wave } */
  async function decide(kind, n, nowMs) {
    if (KINDS.indexOf(kind) < 0) kind = 'open';
    n = Math.max(1, parseInt(n, 10) || 1);
    const now = nowMs || Date.now();
    const cfg = await getCfg(now), daily = await getDaily(now), pub = await _getPub();
    return _check(kind, n, cfg, daily, pub, now);
  }
  function _check(kind, n, cfg, daily, pub, now) {
    const cap = capOf(kind, cfg, daily);
    const used = daily.used[kind] || 0;
    const base = { used, cap, level: cfg.level, wave: daily.wave };
    const wall = _wall(cfg, daily, pub, now);
    if (wall) return Object.assign({ ok: false }, wall, base);
    // 发布前 15 分钟「只浏览不动手」：open（含收藏/点赞？不——浏览指开页看，动手都不行）与 post 不拦
    if (kind !== 'post' && kind !== 'open') {
      const lead = _lead(pub, now);
      if (lead) return Object.assign({ ok: false }, lead, base);
    }
    if (_burstHit(daily, now)) return Object.assign({ ok: false, code: 'burst', text: '这一小时已经动够 30 分钟了——歇到下一个小时' }, base);
    if (used + n > cap) return Object.assign({ ok: false, code: 'cap', text: '今天「' + (KIND_NAMES[kind] || kind) + '」的额度用完了（' + used + ' / ' + cap + '）——明天再来' }, base);
    return Object.assign({ ok: true }, base);
  }

  /* 发布链自查：不拿「发布占线 / 发布后缓冲 / 发布前留空」拦自己（那三把是拦其他动作的）；
     静默 / 单休 / 起床 / 干歇 / 额度照查——给到点那趟在 busy 挂着时逐行自查用 */
  async function decideSelf(kind, n, nowMs) {
    if (KINDS.indexOf(kind) < 0) kind = 'open';
    n = Math.max(1, parseInt(n, 10) || 1);
    const now = nowMs || Date.now();
    const cfg = await getCfg(now), daily = await getDaily(now);
    return _check(kind, n, cfg, daily, { leadUntil: 0, busySince: 0, postUntil: 0 }, now);
  }

  /* 只读：墙上有没有挡（不含动作自己的额度/节拍）——给「闹钟该不该起跑」用 */
  async function blockAllReason(nowMs) {
    const now = nowMs || Date.now();
    const cfg = await getCfg(now), daily = await getDaily(now), pub = await _getPub();
    return _wall(cfg, daily, pub, now);
  }

  /* 扣账（先查后记，记步进账本 + 干歇节拍逐分钟打点）。返回同 decide */
  async function spend(kind, n, nowMs) {
    if (KINDS.indexOf(kind) < 0) kind = 'open';
    n = Math.max(1, parseInt(n, 10) || 1);
    const now = nowMs || Date.now();
    return _serial(async () => {
      const cfg = await getCfg(now), daily = await getDaily(now), pub = await _getPub();
      const g = _check(kind, n, cfg, daily, pub, now);
      if (!g.ok) return g;
      daily.used[kind] = (daily.used[kind] || 0) + n;
      const h = new Date(now).getHours(), mk = Math.floor(now / 60000);
      if (daily.beatH !== h) { daily.beatH = h; daily.beatMin = 1; daily.beatLast = mk; }
      else if (daily.beatLast !== mk) { daily.beatMin = Math.min(60, daily.beatMin + 1); daily.beatLast = mk; }
      await _set({ [K.DAILY]: daily });
      return { ok: true, used: daily.used[kind], cap: g.cap, level: cfg.level, wave: daily.wave };
    });
  }

  /* 动作已经真发出去了 → 只管如实记账（不再查墙与额度：账本要反映账号今天实际干了什么） */
  async function spendSelf(kind, n, nowMs) {
    if (KINDS.indexOf(kind) < 0) kind = 'open';
    n = Math.max(1, parseInt(n, 10) || 1);
    const now = nowMs || Date.now();
    return _serial(async () => {
      const daily = await getDaily(now);
      daily.used[kind] = (daily.used[kind] || 0) + n;
      const h = new Date(now).getHours(), mk = Math.floor(now / 60000);
      if (daily.beatH !== h) { daily.beatH = h; daily.beatMin = 1; daily.beatLast = mk; }
      else if (daily.beatLast !== mk) { daily.beatMin = Math.min(60, daily.beatMin + 1); daily.beatLast = mk; }
      await _set({ [K.DAILY]: daily });
      const cfg = _normCfg(await _get(K.CFG));
      return { ok: true, used: daily.used[kind], level: cfg.level, wave: daily.wave };
    });
  }

  /* 下一次「可以动手」的时刻：墙上挡 → 顺延到下一个工作日 09:00（跨休息日）；节拍到顶 → 下一个整点 */
  async function nextAllowedAt(kind, nowMs) {
    const now = nowMs || Date.now();
    const cfg = await getCfg(now), daily = await getDaily(now), pub = await _getPub();
    const wall = _wall(cfg, daily, pub, now);
    if (wall) return { code: wall.code, text: wall.text, at: wall.at || nextRunAt(now, cfg, daily) };
    if (kind !== 'post' && kind !== 'open') {
      const lead = _lead(pub, now);
      if (lead) return { code: lead.code, text: lead.text, at: pub.leadUntil };
    }
    if (_burstHit(daily, now)) {
      const d = new Date(now); d.setHours(d.getHours() + 1, 0, 0, 0);
      return { code: 'burst', text: '这一小时已经动够 30 分钟了——歇到下一个小时', at: d.getTime() };
    }
    return null;   // 现在就能动
  }

  /* 下一个「工作日 09:00」（跳过休息日/今晚静默；wake 随机只影响当天） */
  function nextRunAt(nowMs, cfg, daily) {
    const now = nowMs || Date.now();
    for (let i = 0; i < 10; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i);
      if (cfg.restDay >= 0 && cfg.restDay === d.getDay()) continue;
      const s = _at(d, QUIET_TO_H, 0);
      if (i === 0) {
        const wake = s + daily.wakeDelayMin * 60000;
        if (now < wake) return wake;
        if (now < _at(d, QUIET_FROM_H, 0)) return now;
        continue;
      }
      return s;
    }
    return _at(new Date(now), QUIET_TO_H, 0);
  }

  /* ─── 发布链的三把缓冲（background 写、大家读） ─── */
  /* 顺延账：{ [行key]: { to, reason } } —— 到点的行撞静默/单休/额度尽头时写；跑到了就清 */
  async function _defers() { return (await _getPub()).defers; }
  /** 写若干行的顺延；keepKeys 给定时顺手清掉已不存在的行（线被删 / 篇被撤） */
  async function _deferMany(entries, keepKeys) {
    const cur = (await _getPub()).defers;
    const has = Array.isArray(keepKeys) ? new Set(keepKeys.map(String)) : null;
    const next = {};
    Object.keys(cur).forEach(k => { if (!has || has.has(k)) next[k] = cur[k]; });
    Object.keys(entries || {}).forEach(k => { next[k] = entries[k]; });
    await _setPub({ defers: next });
  }
  async function _clearDefer(lineKey) {
    const cur = (await _getPub()).defers;
    if (!(String(lineKey) in cur)) return;
    const next = Object.assign({}, cur);
    delete next[String(lineKey)];
    await _setPub({ defers: next });
  }
  const pub = {
    get: _getPub,
    patch: _setPub,
    /* 发布这趟开始：占线（其他自动化先让路） */
    async start() { await _setPub({ busySince: Date.now(), leadUntil: 0 }); },
    /* 这趟跑完：published=true 时加 30 分钟全停缓冲 */
    async end(published) {
      const patch = { busySince: 0 };
      if (published) patch.postUntil = Date.now() + POST_HOLD_MIN * 60000;
      await _setPub(patch);
    },
    /* 排下一篇到点时写：leadUntil＝那个到点时刻（发布前 15 分钟＝它前面的窗口）；0=今天没有待发的了 */
    async lead(untilMs) { await _setPub({ leadUntil: Number(untilMs) || 0 }); },
    /* 顺延账（发布队列到点撞静默/休息日/额度尽头时写） */
    defers: _defers, deferMany: _deferMany, clearDefer: _clearDefer,
  };

  /* ─── 体检卡 ─── */
  async function _healthList() {
    const l = await _get(K.HEALTH);
    return Array.isArray(l) ? l : [];
  }
  /** 记一笔：警告/限流 → 降一级；处罚 → 直落保守；已在保守再记 → 只记不动（floor=true） */
  async function record(rec) {
    rec = rec || {};
    const kind = ['警告', '限流', '处罚'].indexOf(rec.kind) >= 0 ? rec.kind : '警告';
    return _serial(async () => {
      const cfg = _normCfg(await _get(K.CFG));
      const before = cfg.level;
      let after = before, floor = false;
      const idx = LEVELS.findIndex(l => l.name === before);
      if (kind === '处罚') after = '保守';
      else after = LEVELS[Math.max(0, idx - 1)].name;   // 警告 / 限流：降一级
      floor = (after === before);
      if (!floor) await _set({ [K.CFG]: Object.assign({}, cfg, { level: after }) });
      const list = await _healthList();
      const item = { t: String(rec.t || _todayKey()), kind, note: String(rec.note || ''), at: Date.now(), before, after, floor };
      list.push(item);
      await _set({ [K.HEALTH]: list.slice(-100) });
      return { ok: true, level: after, floor, item };
    });
  }
  /** 恢复一档（手动；已在正常则不动）。返回新挡位 */
  async function recover() {
    return _serial(async () => {
      const cfg = _normCfg(await _get(K.CFG));
      const idx = LEVELS.findIndex(l => l.name === cfg.level);
      const next = LEVELS[Math.min(LEVELS.length - 1, idx + 1)];
      if (next.name !== cfg.level) await _set({ [K.CFG]: Object.assign({}, cfg, { level: next.name }) });
      return { ok: true, level: next.name };
    });
  }

  /* ─── 汇总快照（弹窗小标 / 设置页 / 队列页读它） ─── */
  async function status(nowMs) {
    const now = nowMs || Date.now();
    const cfg = await getCfg(now), daily = await getDaily(now), pubB = await _getPub();
    const wall = _wall(cfg, daily, pubB, now);
    return {
      ok: true,
      level: cfg.level,
      wave: daily.wave,
      rows: KINDS.map(k => ({ kind: k, name: KIND_NAMES[k], used: daily.used[k] || 0, cap: capOf(k, cfg, daily) })),
      rest: { day: cfg.restDay, name: WEEKDAYS[cfg.restDay] || '', today: _restToday(cfg, now), week: cfg.restWeek },
      quiet: { from: '09:00', to: '21:00', inQuiet: _inQuiet(now), beforeWake: _beforeWake(daily, now), wakeDelayMin: daily.wakeDelayMin },
      burst: { h: new Date(now).getHours(), min: (daily.beatH === new Date(now).getHours() ? daily.beatMin : 0), max: BURST_MIN_PER_HOUR },
      blocked: wall,
      health: await _healthList(),
      at: now,
    };
  }

  return {
    LEVELS, KINDS, KIND_NAMES, WEEKDAYS,
    QUIET_FROM_H, QUIET_TO_H, WAKE_MAX_MIN, BURST_MIN_PER_HOUR, POST_LEAD_MIN, POST_HOLD_MIN, POSTDAY_FACTOR,
    KEYS: K,
    getCfg, saveCfg, getDaily, capOf,
    decide, decideSelf, blockAllReason, spend, spendSelf, nextAllowedAt, nextRunAt,
    pub,
    record, recover, healthList: _healthList,
    status,
    inQuiet: _inQuiet,
    isRestToday: async (nowMs) => _restToday(await getCfg(nowMs), nowMs || Date.now()),
    _drawRestDay,
  };
})();

// 支持 Service Worker importScripts（挂到全局）与 CommonJS
if (typeof self !== 'undefined') {
  self.AccountGuard = AccountGuard;
}
if (typeof module !== 'undefined') {
  module.exports = AccountGuard;
}
