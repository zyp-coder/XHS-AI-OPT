/**
 * daily-browse.js — 🌿 日常浏览（② 起随获客开通，不列入对外功能清单）
 *
 * 形态（2026-09-26 定稿）：它不是独立功能，而是**队列里的一种流程项**——
 *   · 配置在「获客 → 任务配置 → 🌿 日常浏览」三级 tab，与关键词池/盯的账号/推广目标并排；
 *   · 队列按「每 N 格获客插 1 轮」自动塞（也可在队列页手动塞一轮），执行器一格一格串行跑；
 *   · 一轮 = 挑一个方向 → 在它的内容里泛刷若干篇（滚动停留 + 按概率打开/点赞/收藏，
 *     顺手评论/回复/关注），只写日常浏览自己的账，绝不进获客台账（见设计文档 §五）。
 *
 * 本文件只负责：配置与归一化、方向轮转与配额、每日记账、日志、状态。
 * 真正在页面上干活的是 content.js 的 browseRound，由执行器（auto-bot.js）驱动。
 *
 * 存储（均随租户切换，见 lib/tenant.js TENANT_SCOPED_KEYS）：
 *   daily_browse_config   配置（方向 / 队列插入规则 / 节奏与概率 / 本地句池）
 *   daily_browse_daily    每日计数 { date, count, byDirection, comments, replies, follows, rounds }
 *   daily_browse_last     最近一轮明细（页面侧落盘，排查用）
 *   daily_browse_log      运行日志（最多 200 条，新在前）
 *   daily_browse_stop_at  「停止本轮」信号（页面侧每个单位检查一次）
 *
 * 同时被 background（importScripts）与 popup（<script>）加载：顶层不许裸写 window。
 */
(function (root) {
  'use strict';

  const CFG_KEY = 'daily_browse_config';
  const DAILY_KEY = 'daily_browse_daily';
  const LAST_KEY = 'daily_browse_last';
  const LOG_KEY = 'daily_browse_log';
  const STOP_KEY = 'daily_browse_stop_at';
  const HOLD_KEY = 'daily_browse_auto_hold';   // 手动停止本轮 → 今天不再自动拉起（明天照常）
  const LOG_KEEP = 200;
  const DIR_MAX = 6;

  // 🛡 账号安全（2026-10-11）：所有时段（方向时段与自动跑时段）一律钳进 09:00–21:00——
  //    静默期 21:00–09:00 不跑；存量配置里跑出窗口的自动收进来（判定真源＝lib/account-guard.js）
  const GUARD_LO = 9 * 60, GUARD_HI = 21 * 60;

  // 方向默认时段：上午 / 下午 / 晚上各一段（留空＝全天）
  const WINDOWS_DEFAULT = [
    { start: '09:00', end: '11:30' },
    { start: '14:00', end: '17:30' },
    { start: '20:00', end: '21:00' },
  ];

  const DEFAULT = {
    enabled: false,
    insert: { everyN: 3 },   // 队列里每 N 格获客插 1 轮日常流程；0 = 不自动塞（仍可手动塞）
    autorun: { enabled: false, from: '09:00', to: '21:00' },   // 每天自动跑：这个时段里整条队列自动跑（保底时钟，见 §六）
    directions: [],          // [{ id, name, enabled, keywords, windows, dailyQuota, weight }]
    perRound: 6,             // 一轮刷几篇
    dwellMin: 8,             // 单篇停留秒数（下限）
    dwellMax: 25,            // 单篇停留秒数（上限）
    openRate: 60,            // 打开笔记的比例（%）
    likeRate: 25,            // 点赞比例（%）
    collectRate: 12,         // 收藏比例（%）
    comment: { rate: 10, dailyMax: 5 },   // 顺手评论：按概率发、每日上限
    reply: { dailyMax: 2 },               // 回复别人评论：每日上限
    follow: { rate: 8, dailyMax: 3 },     // 关注作者：按概率、每日上限
    pool: [],                // 顺手评论的本地句池（AI 失败时兜底，随机取一条）
  };

  function _num(v, def, min, max) {
    const n = parseInt(v, 10);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  function _uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  /* 🛡 分钟数 → 'HH:MM'（钳进用） */
  function _mkHM(m) { const x = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
  /* 🛡 单个时刻钳进 09:00–21:00；非法返回 def */
  function _clampClock(s, def) {
    const m = _hm(s);
    if (m == null) return def;
    return _mkHM(Math.max(GUARD_LO, Math.min(GUARD_HI, m)));
  }

  function _normWindows(list, fallback) {
    const arr = Array.isArray(list) ? list : (fallback || []);
    return arr
      .map(w => ({ start: String((w && w.start) || '').trim(), end: String((w && w.end) || '').trim() }))
      .filter(w => /^\d{1,2}:\d{2}$/.test(w.start) && /^\d{1,2}:\d{2}$/.test(w.end))
      /* 🛡 账号安全：时段一律钳进 09:00–21:00（静默期不跑）；整段落在静默期的丢掉；
         起止相等＝全天语义，原样保留 */
      .map(w => {
        const a = _hm(w.start), b = _hm(w.end);
        if (a == null || b == null || a === b) return w;
        const na = Math.max(GUARD_LO, Math.min(GUARD_HI, a));
        const nb = b <= a ? GUARD_HI : Math.max(GUARD_LO, Math.min(GUARD_HI, b));   // 跨零点时段截断到 21:00
        return nb <= na ? null : { start: _mkHM(na), end: _mkHM(nb) };
      })
      .filter(Boolean)
      .slice(0, 6);
  }

  function normDirection(d, i) {
    const o = (d && typeof d === 'object') ? d : {};
    const kws = (Array.isArray(o.keywords) ? o.keywords : [])
      .map(s => String(s || '').trim()).filter(Boolean);
    return {
      id: String(o.id || ('d' + (i + 1))).slice(0, 24) || ('d' + (i + 1)),
      name: String(o.name || '').trim().slice(0, 10) || ('方向' + (i + 1)),
      enabled: o.enabled !== false,
      keywords: Array.from(new Set(kws)).slice(0, 12),   // 空 = 首页推荐（泛刷）
      windows: _normWindows(o.windows, WINDOWS_DEFAULT), // 空 = 全天
      dailyQuota: _num(o.dailyQuota, 40, 1, 300),
      weight: _num(o.weight, 1, 1, 5),
    };
  }

  /* 'HH:MM' → 分钟数；不合法返回 null */
  function _hm(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (parseInt(m[1], 10) % 24) * 60 + Math.min(59, parseInt(m[2], 10));
  }
  /* 这一段"下次结束"的时刻（毫秒）：今天这段已经结束就算明天那一段；全天/非法返回 0 */
  function winNextEnd(w, nowMs) {
    const a = _hm(w && w.start), b = _hm(w && w.end);
    if (a == null || b == null || a === b) return 0;
    const day = new Date(nowMs || Date.now()); day.setHours(0, 0, 0, 0);
    const mk = (off) => day.getTime() + off * 86400000 + b * 60000;
    for (const t of [mk(0), mk(1)]) if (t > nowMs) return t;
    return 0;
  }

  /* 时段判断：空 = 全天；支持跨零点（20:00-01:00） */
  function inWindow(windows, nowMs) {
    const wins = (windows || []).filter(Boolean);
    if (!wins.length) return true;
    const d = new Date(nowMs || Date.now());
    const cur = d.getHours() * 60 + d.getMinutes();
    const toMin = (s) => {
      const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return (parseInt(m[1], 10) % 24) * 60 + Math.min(59, parseInt(m[2], 10));
    };
    for (const w of wins) {
      const a = toMin(w && w.start), b = toMin(w && w.end);
      if (a == null || b == null || a === b) continue;
      if (a < b) { if (cur >= a && cur < b) return true; }
      else { if (cur >= a || cur < b) return true; }   // 跨零点
    }
    return false;
  }

  /* 没配方向时给一个「随便刷刷」（首页推荐）——开箱即用的泛刷入口 */
  function _seed() {
    return [normDirection({ id: 'd1', name: '随便刷刷', keywords: [] }, 0)];
  }

  const DailyBrowse = {
    DIR_MAX: DIR_MAX,
    DEFAULT: DEFAULT,
    newDirection(i) { return normDirection({ id: _uid() }, i || 0); },
    normDirection: normDirection,
    inWindow: inWindow,

    /* ─── 配置 ─── */
    norm(raw) {
      const src = (raw && typeof raw === 'object') ? raw : {};
      const c = Object.assign({}, DEFAULT, src);
      c.enabled = !!c.enabled;
      c.insert = { everyN: _num((src.insert || {}).everyN, DEFAULT.insert.everyN, 0, 20) };
      /* 🛡 账号安全：自动跑时段钳进 09:00–21:00（存量 08:30–22:30 自动收进来）；
         起止相等＝全天语义保留；钳完为空/跨零点 → 回默认 09:00–21:00 */
      let _aFrom = _clampClock((src.autorun || {}).from, DEFAULT.autorun.from);
      let _aTo = _clampClock((src.autorun || {}).to, DEFAULT.autorun.to);
      if (_aFrom !== _aTo && _hm(_aFrom) >= _hm(_aTo)) { _aFrom = DEFAULT.autorun.from; _aTo = DEFAULT.autorun.to; }
      c.autorun = {
        enabled: !!((src.autorun || {}).enabled),
        from: _aFrom,
        to: _aTo,
      };
      c.perRound = _num(c.perRound, DEFAULT.perRound, 1, 8);
      c.dwellMin = _num(c.dwellMin, DEFAULT.dwellMin, 3, 120);
      c.dwellMax = _num(c.dwellMax, DEFAULT.dwellMax, c.dwellMin, 300);
      c.openRate = _num(c.openRate, DEFAULT.openRate, 0, 100);
      c.likeRate = _num(c.likeRate, DEFAULT.likeRate, 0, 100);
      c.collectRate = _num(c.collectRate, DEFAULT.collectRate, 0, 100);
      c.comment = { rate: _num((src.comment || {}).rate, DEFAULT.comment.rate, 0, 100), dailyMax: _num((src.comment || {}).dailyMax, DEFAULT.comment.dailyMax, 0, 100) };
      c.reply = { dailyMax: _num((src.reply || {}).dailyMax, DEFAULT.reply.dailyMax, 0, 100) };
      c.follow = { rate: _num((src.follow || {}).rate, DEFAULT.follow.rate, 0, 100), dailyMax: _num((src.follow || {}).dailyMax, DEFAULT.follow.dailyMax, 0, 100) };
      c.pool = (Array.isArray(c.pool) ? c.pool : []).map(s => String(s || '').trim()).filter(Boolean).slice(0, 40);
      // 方向列表：老的「全局关键词 + 全局时段/配额」一次性收进一个方向（老用户升级不丢配置）
      let dirs = Array.isArray(src.directions) ? src.directions : null;
      if (!dirs) {
        const legacyKws = Array.isArray(src.keywords) ? src.keywords.map(s => String(s || '').trim()).filter(Boolean) : [];
        const legacyWin = _normWindows(src.windows, []);
        if (legacyKws.length || legacyWin.length) {
          dirs = [{ id: 'd1', name: '日常', keywords: legacyKws, windows: legacyWin, dailyQuota: _num(src.dailyQuota, 40, 1, 300), weight: 1 }];
        }
      }
      const seen = new Set();
      c.directions = (dirs || []).map(normDirection).filter(d => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      }).slice(0, DIR_MAX);
      if (!c.directions.length) c.directions = _seed();
      delete c.keywords; delete c.kwIdx; delete c.windows; delete c.dailyQuota; delete c.intervalMin;
      return c;
    },

    async getConfig() {
      const d = await chrome.storage.local.get(CFG_KEY);
      return this.norm(d[CFG_KEY]);
    },

    async saveConfig(patch) {
      const cur = await this.getConfig();
      const merged = Object.assign({}, cur, patch || {});
      if (patch && patch.directions) merged.directions = patch.directions;
      const cfg = this.norm(merged);
      await chrome.storage.local.set({ [CFG_KEY]: cfg });
      return cfg;
    },

    dirById(cfg, id) {
      return ((cfg || {}).directions || []).find(d => d.id === String(id || '')) || null;
    },

    /* ─── 方向轮转：启用 + 在时段内 + 没满今日配额 → 按权重随机挑一个 ─── */
    pickDirection(cfgIn, dailyIn, now) {
      const cfg = this.norm(cfgIn);
      const used = ((dailyIn || {}).byDirection) || {};
      const cands = [];
      for (const d of cfg.directions) {
        if (!d.enabled) continue;
        if ((Number(used[d.id]) || 0) >= d.dailyQuota) continue;
        if (!inWindow(d.windows, now)) continue;
        cands.push({ d, w: Math.max(1, d.weight || 1) });
      }
      if (!cands.length) return null;
      const total = cands.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total;
      for (const x of cands) { r -= x.w; if (r <= 0) return x.d; }
      return cands[cands.length - 1].d;
    },

    /* 现在这一刻有没有活可干（保底时钟与执行器驻留都读它） */
    hasWorkToday(cfgIn, dailyIn, now) {
      return !!this.pickDirection(cfgIn, dailyIn, now);
    },

    /* 今天日内还会不会有活：现在挑不出方向 ≠ 今天没活——可能只是还没到它那个时段。
       保底时钟靠它决定"要不要继续把窗口守着"（只看今天，不预告明天的时段） */
    willWorkToday(cfgIn, dailyIn, nowMs) {
      const cfg = this.norm(cfgIn);
      if (!cfg.enabled) return false;
      const now = nowMs || Date.now();
      const used = ((dailyIn || {}).byDirection) || {};
      const day = new Date(now); day.setHours(23, 59, 59, 999);
      const endToday = day.getTime();
      return cfg.directions.some(d => {
        if (!d.enabled) return false;
        if ((Number(used[d.id]) || 0) >= d.dailyQuota) return false;
        const wins = (d.windows || []).filter(Boolean);
        if (!wins.length) return true;                       // 全天
        return wins.some(w => { const e = winNextEnd(w, now); return e > 0 && e <= endToday; });
      });
    },

    /* 每天自动跑：现在该不该由后台把队列拉起来（开关 + 时段；起止相同＝全天） */
    autorunOn(cfgIn, nowMs) {
      const cfg = this.norm(cfgIn);
      const a = cfg.autorun || {};
      if (!a.enabled) return false;
      if (String(a.from) === String(a.to)) return true;
      return inWindow([{ start: a.from, end: a.to }], nowMs);
    },
    /* 下一次"有方向可跑"的时刻：现在就能跑 → now；今天之内等得到某段时段 → 这段的开始时刻；今天等不到 → 0
       （执行器驻留靠它决定"要不要接着等"，只看今天） */
    nextOpenMs(cfgIn, dailyIn, nowMs) {
      const cfg = this.norm(cfgIn);
      if (!cfg.enabled) return 0;
      const now = nowMs || Date.now();
      if (this.pickDirection(cfg, dailyIn, now)) return now;
      const used = ((dailyIn || {}).byDirection) || {};
      const day = new Date(now); day.setHours(0, 0, 0, 0);
      const endToday = day.getTime() + 86400000 - 1;
      let best = 0;
      for (const d of cfg.directions) {
        if (!d.enabled) continue;
        if ((Number(used[d.id]) || 0) >= d.dailyQuota) continue;
        for (const w of (d.windows || [])) {
          const a = _hm(w && w.start), b = _hm(w && w.end);
          if (a == null || b == null || a === b) continue;   // 全天/非法：pickDirection 那边已经判过
          for (const off of [0, 1]) {
            const t = day.getTime() + off * 86400000 + a * 60000;
            if (t <= now || t > endToday) continue;
            if (!best || t < best) best = t;
            break;
          }
        }
      }
      return best;
    },

    /* 每天自动跑：下一次"进入/离开"时段的时刻（状态区展示用） */
    autorunNextEdge(cfgIn, nowMs) {
      const cfg = this.norm(cfgIn);
      const a = cfg.autorun || {};
      if (!a.enabled) return 0;
      const on = winNextEnd({ start: a.from, end: a.to }, nowMs);
      if (on && on > nowMs) return on;
      const d = new Date(nowMs || Date.now()); d.setHours(0, 0, 0, 0);
      const st = _hm(a.from);
      return st == null ? 0 : d.getTime() + 86400000 + st * 60000;
    },

    /* ─── 每日计数 ─── */
    today() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },

    async getDaily() {
      const today = this.today();
      const d = (await chrome.storage.local.get(DAILY_KEY))[DAILY_KEY] || {};
      const byDirection = (d.byDirection && typeof d.byDirection === 'object') ? d.byDirection : {};
      if (d.date !== today) return { date: today, count: 0, byDirection: {}, comments: 0, replies: 0, follows: 0, rounds: 0 };
      const sum = Object.keys(byDirection).reduce((s, k) => s + (Number(byDirection[k]) || 0), 0);
      return {
        date: today,
        count: Number(d.count) || sum,
        byDirection,
        comments: Number(d.comments) || 0,
        replies: Number(d.replies) || 0,
        follows: Number(d.follows) || 0,
        rounds: Number(d.rounds) || 0,
      };
    },

    /** 记一轮的账：views 篇数落方向头上，顺手互动落全局计数 */
    async bumpDaily(patch) {
      const p = patch || {};
      const daily = await this.getDaily();
      const views = Number(p.views) || 0;
      if (p.directionId) daily.byDirection[p.directionId] = (Number(daily.byDirection[p.directionId]) || 0) + views;
      daily.count = (Number(daily.count) || 0) + views;
      daily.comments = (Number(daily.comments) || 0) + (Number(p.comments) || 0);
      daily.replies = (Number(daily.replies) || 0) + (Number(p.replies) || 0);
      daily.follows = (Number(daily.follows) || 0) + (Number(p.follows) || 0);
      daily.rounds = (Number(daily.rounds) || 0) + (p.countRound === false ? 0 : 1);
      await chrome.storage.local.set({ [DAILY_KEY]: daily });
      return daily;
    },

    /* 今日各方向的进度（状态区/配置页展示用） */
    progress(cfgIn, dailyIn, now) {
      const cfg = this.norm(cfgIn);
      const daily = dailyIn || { byDirection: {} };
      const used = daily.byDirection || {};
      return cfg.directions.map(d => {
        const u = Number(used[d.id]) || 0;
        return {
          dir: d, used: u, left: Math.max(0, d.dailyQuota - u),
          inWindow: inWindow(d.windows, now),
          ok: d.enabled && inWindow(d.windows, now) && u < d.dailyQuota,
        };
      });
    },

    /* ─── 日志 ─── */
    async log(text) {
      try {
        const d = await chrome.storage.local.get(LOG_KEY);
        const logs = Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : [];
        logs.unshift({ ts: Date.now(), text: String(text) });
        await chrome.storage.local.set({ [LOG_KEY]: logs.slice(0, LOG_KEEP) });
      } catch (_) {}
      console.log('[日常浏览] ' + text);
    },

    /* ─── 停止本轮（页面侧每个单位检查一次 daily_browse_stop_at）
     *   同时按住保底时钟"今天别再自动拉起"：人来按了停止，5 分钟后又被自动拉起来才叫见鬼。
     *   想恢复：点「🤖 开始」手动跑一趟（或把「每天自动跑」关一下再开）。 ─── */
    async stop() {
      const now = Date.now();
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      await chrome.storage.local.set({ [STOP_KEY]: now, [HOLD_KEY]: { until: end.getTime(), at: now } });
      return { ok: true, holdUntil: end.getTime() };
    },

    /* 手动开始 / 重新打开自动跑 → 解除"今天不再自动拉起" */
    async clearHold() {
      try { await chrome.storage.local.remove(HOLD_KEY); } catch (_) {}
    },
    /* 保底时钟读它：今天被按过停止就不自动拉起了 */
    async autoHoldUntil() {
      try { const d = await chrome.storage.local.get(HOLD_KEY); return (d[HOLD_KEY] || {}).until || 0; } catch (_) { return 0; }
    },

    /* ─── 状态（配置页状态区 / 队列页读） ─── */
    async getStatus() {
      const cfg = await this.getConfig();
      const daily = await this.getDaily();
      const now = Date.now();
      const d = await chrome.storage.local.get([LAST_KEY, LOG_KEY]);
      return {
        ok: true,
        cfg,
        progress: this.progress(cfg, daily, now),
        today: {
          count: daily.count, comments: daily.comments, replies: daily.replies,
          follows: daily.follows, rounds: daily.rounds,
        },
        inWindow: this.progress(cfg, daily, now).some(x => x.inWindow),
        lastRound: d[LAST_KEY] || null,
        logs: (Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : []).slice(0, 60),
      };
    },
  };

  root.DailyBrowse = DailyBrowse;
  if (typeof module !== 'undefined' && module.exports) module.exports = DailyBrowse;
})(typeof globalThis !== 'undefined' ? globalThis : this);
