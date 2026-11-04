/**
 * daily-browse.js — 🌿 日常浏览（② 起随获客开通，不列入对外功能清单）
 *
 * 形态（2026-10-30 定稿）：它不是独立功能，而是**队列里的一种流程项**——
 *   · 配置在「🔥 获客 → 队列 → 🌿 日常浏览」弹窗里：开不开、每轮刷几篇（上下限）、
 *     打开后怎么看法（秒退 / 看完 / 正常看的比例）、打开/赞/藏与顺手互动的概率；
 *   · 队列每趟开跑时插一轮到队首（也可在队列页手动塞一趟），执行器一格一格串行跑；
 *   · 一轮 = 刷首页推荐若干篇（滚动停留 + 按概率打开/点赞/收藏，顺手评论〔含回别人一句〕/关注），
 *     只写日常浏览自己的账，绝不进获客台账（见设计文档 §五）。
 *   · 固定刷首页：不再分「方向」，也就没有关键词 / 时段 / 每日配额那一层
 *     （2026-10-30 老板定：这个可以不需要了，就是刷首页的）。
 *
 * 本文件只负责：配置与归一化、每日记账、日志、状态。
 * 真正在页面上干活的是 content.js 的 browseRound，由执行器（auto-bot.js）驱动。
 *
 * 存储（均随租户切换，见 lib/tenant.js TENANT_SCOPED_KEYS）：
 *   daily_browse_config   配置（开关 / 每轮篇数上下限 / 节奏与概率 / 本地句池）
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

  // 🛡 账号安全（2026-10-11）：自动跑时段一律钳进 09:00–21:00——
  //    静默期 21:00–09:00 不跑；存量配置里跑出窗口的自动收进来（判定真源＝lib/account-guard.js）
  const GUARD_LO = 9 * 60, GUARD_HI = 21 * 60;

  /* 固定的那一档：日常浏览就是刷首页，不再有方向/关键词/时段/配额。
     老队列项里的 k 可能是 d1/d2/d3…，一律当这一档来跑（不丢欠账、不丢手塞的） */
  const DAILY_DIR = { id: 'd1', name: '日常浏览', enabled: true, keywords: [], windows: [] };

  const DEFAULT = {
    enabled: false,
    autorun: { enabled: false, from: '09:00', to: '21:00' },   // 每天自动开跑：这个时段里整条队列自动跑（保底时钟，见 §六）
    perRoundMin: 18,         // 一轮刷几篇（下限）
    perRoundMax: 22,         // 一轮刷几篇（上限）；每轮在这区间里随机取
    dwellMin: 8,             // 正常看：单篇停留秒数（下限）
    dwellMax: 25,            // 正常看：单篇停留秒数（上限）
    /* 打开后怎么看法（2026-10-30 老板定）：先按概率摇一档，再决定停多久——
       秒退＝打开 2~5 秒就退；看完＝视频播到结尾 / 图文翻到底（最长 2 分钟）；
       正常看＝上面那组 8~25 秒，占余下的比例（100 − 秒退 − 看完）。 */
    bounceRate: 25,          // 秒退比例（%）
    fullRate: 15,            // 看完比例（%）
    openRate: 60,            // 打开笔记的比例（%）
    likeRate: 25,            // 点赞比例（%）
    collectRate: 12,         // 收藏比例（%）
    /* 顺手互动只按概率走，不再设每日名额（2026-10-30 老板定）：
       真正的天花板是账号安全那道闸（account_guard，评论按挡位 12/25/45）。
       「评论」一项管两种说法：发一条新评论 / 回别人评论里的一句——不再单列「回复别人」。 */
    comment: { rate: 10 },   // 顺手评论：打开的笔记里，按这个概率发（含回别人一句）
    follow: { rate: 3 },     // 关注作者：打开的笔记里，按这个概率关注
    pool: [],                // 顺手评论的本地句池（AI 失败时兜底，随机取一条）
  };

  function _num(v, def, min, max) {
    const n = parseInt(v, 10);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  /* 'HH:MM' → 分钟数；不合法返回 null */
  function _hm(s) {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (parseInt(m[1], 10) % 24) * 60 + Math.min(59, parseInt(m[2], 10));
  }
  /* 🛡 分钟数 → 'HH:MM'（钳进用） */
  function _mkHM(m) { const x = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
  /* 🛡 单个时刻钳进 09:00–21:00；非法返回 def */
  function _clampClock(s, def) {
    const m = _hm(s);
    if (m == null) return def;
    return _mkHM(Math.max(GUARD_LO, Math.min(GUARD_HI, m)));
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

  /* 时段判断：空 = 全天；支持跨零点（20:00-01:00）。自动跑时段也走这一口 */
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

  const DailyBrowse = {
    DEFAULT: DEFAULT,

    /* 固定那一档（不给外部改） */
    dir() { return Object.assign({}, DAILY_DIR); },
    /* 老队列项按 k 找方向：现在只有一档，任何 k 都落回「日常浏览」
       （开关不在这里拦：手塞的一轮在关着的时候照跑，由派活那层判） */
    dirById() { return Object.assign({}, DAILY_DIR); },
    inWindow: inWindow,

    /* ─── 配置 ─── */
    norm(raw) {
      const src = (raw && typeof raw === 'object') ? raw : {};
      const c = Object.assign({}, DEFAULT, src);
      c.enabled = !!c.enabled;
      /* 老的层级整体作废：每 N 格插一轮、方向（关键词/时段/日配额）、旧的单值 perRound */
      delete c.insert; delete c.directions; delete c.keywords; delete c.kwIdx;
      delete c.windows; delete c.dailyQuota; delete c.intervalMin; delete c.perRound;
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
      c.perRoundMin = _num(src.perRoundMin, DEFAULT.perRoundMin, 1, 40);
      c.perRoundMax = _num(src.perRoundMax, DEFAULT.perRoundMax, c.perRoundMin, 40);
      c.dwellMin = _num(c.dwellMin, DEFAULT.dwellMin, 3, 120);
      c.dwellMax = _num(c.dwellMax, DEFAULT.dwellMax, c.dwellMin, 300);
      c.bounceRate = _num(c.bounceRate, DEFAULT.bounceRate, 0, 100);
      c.fullRate = _num(c.fullRate, DEFAULT.fullRate, 0, 100 - c.bounceRate);   // 两者合计不超过 100，余下＝正常看
      c.openRate = _num(c.openRate, DEFAULT.openRate, 0, 100);
      c.likeRate = _num(c.likeRate, DEFAULT.likeRate, 0, 100);
      c.collectRate = _num(c.collectRate, DEFAULT.collectRate, 0, 100);
      c.comment = { rate: _num((src.comment || {}).rate, DEFAULT.comment.rate, 0, 100) };
      delete c.reply;   // 「回复别人」并进「评论」一项，不再单列（2026-10-30）
      c.follow = { rate: _num((src.follow || {}).rate, DEFAULT.follow.rate, 0, 100) };
      /* 存量里关注还是老默认 8% → 一次性改成 3%（手调成别的值不动） */
      if (c.follow.rate === 8) c.follow.rate = DEFAULT.follow.rate;
      c.pool = (Array.isArray(c.pool) ? c.pool : []).map(s => String(s || '').trim()).filter(Boolean).slice(0, 40);
      return c;
    },

    async getConfig() {
      const d = await chrome.storage.local.get(CFG_KEY);
      return this.norm(d[CFG_KEY]);
    },

    async saveConfig(patch) {
      const cur = await this.getConfig();
      const merged = Object.assign({}, cur, patch || {});
      const cfg = this.norm(merged);
      await chrome.storage.local.set({ [CFG_KEY]: cfg });
      return cfg;
    },

    /* ─── 这一档现在能不能跑（只有总开关；时段与配额那一层已撤） ─── */
    pickDirection(cfgIn) {
      const cfg = this.norm(cfgIn);
      return cfg.enabled ? Object.assign({}, DAILY_DIR) : null;
    },
    hasWorkToday(cfgIn) {
      return !!this.norm(cfgIn).enabled;
    },
    /* 今天还会不会有活：现在开着就随时能刷（没有时段/配额这一层） */
    willWorkToday(cfgIn) {
      return !!this.norm(cfgIn).enabled;
    },
    /* 下一次"能跑"的时刻：开着就是现在 */
    nextOpenMs(cfgIn) {
      return this.norm(cfgIn).enabled ? Date.now() : 0;
    },

    /* 每天自动跑：现在该不该由后台把队列拉起来（开关 + 时段；起止相同＝全天） */
    autorunOn(cfgIn, nowMs) {
      const cfg = this.norm(cfgIn);
      const a = cfg.autorun || {};
      if (!a.enabled) return false;
      if (String(a.from) === String(a.to)) return true;
      return inWindow([{ start: a.from, end: a.to }], nowMs);
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

    /** 记一轮的账：views 篇数落这一档头上，顺手互动落全局计数 */
    async bumpDaily(patch) {
      const p = patch || {};
      const daily = await this.getDaily();
      const views = Number(p.views) || 0;
      const dirId = p.directionId || DAILY_DIR.id;
      daily.byDirection[dirId] = (Number(daily.byDirection[dirId]) || 0) + views;
      daily.count = (Number(daily.count) || 0) + views;
      daily.comments = (Number(daily.comments) || 0) + (Number(p.comments) || 0);
      daily.replies = (Number(daily.replies) || 0) + (Number(p.replies) || 0);
      daily.follows = (Number(daily.follows) || 0) + (Number(p.follows) || 0);
      daily.rounds = (Number(daily.rounds) || 0) + (p.countRound === false ? 0 : 1);
      await chrome.storage.local.set({ [DAILY_KEY]: daily });
      return daily;
    },

    /* 今天刷了多少（状态区展示用）：只有一档，不再按方向拆配额 */
    progress(cfgIn, dailyIn) {
      const daily = dailyIn || {};
      return [{ dir: Object.assign({}, DAILY_DIR), used: Number(daily.count) || 0 }];
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
      const d = await chrome.storage.local.get([LAST_KEY, LOG_KEY]);
      return {
        ok: true,
        cfg,
        progress: this.progress(cfg, daily),
        today: {
          count: daily.count, comments: daily.comments, replies: daily.replies,
          follows: daily.follows, rounds: daily.rounds,
        },
        inWindow: true,
        lastRound: d[LAST_KEY] || null,
        logs: (Array.isArray(d[LOG_KEY]) ? d[LOG_KEY] : []).slice(0, 60),
      };
    },
  };

  root.DailyBrowse = DailyBrowse;
  if (typeof module !== 'undefined' && module.exports) module.exports = DailyBrowse;
})(typeof globalThis !== 'undefined' ? globalThis : this);
