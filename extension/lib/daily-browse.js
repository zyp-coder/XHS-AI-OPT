/**
 * daily-browse.js — 🌿 日常浏览（全功能版专属）
 * 运行在 background service worker 上下文
 *
 * 职责：按时段 + 每日配额，在「首页推荐」或按关键词搜索出的信息流里自动浏览笔记；
 *       单篇停留随机、按概率点开笔记、按概率点赞/收藏。
 *       页面动作全部由 content.js 的 browseRound 执行（本文件只负责节奏、配额、记账、日志）。
 *
 * 存储（均随租户切换，见 lib/tenant.js TENANT_SCOPED_KEYS）：
 *   daily_browse_config  配置（时段/配额/停留/概率/内容方向）
 *   daily_browse_daily   每日计数 { date, count, countedRounds }
 *   daily_browse_last    最近一轮明细（页面侧落盘，后台被杀也能对账）
 *   daily_browse_log     运行日志（最多 200 条，新在前）
 */

const DB_KEY = 'daily_browse_config';
const DB_DAILY = 'daily_browse_daily';
const DB_LAST = 'daily_browse_last';
const DB_LOG = 'daily_browse_log';
const DB_RUNNING = 'daily_browse_running';
const DB_NEXT = 'daily_browse_next_at';
const DB_STOP = 'daily_browse_stop_at';

const DB_ALARM = 'daily-browse-tick';

const DB_DEFAULT = {
  enabled: false,
  // 浏览时段（可多段；留空 = 全天）
  windows: [
    { start: '09:00', end: '11:30' },
    { start: '14:00', end: '17:30' },
    { start: '20:00', end: '22:30' },
  ],
  dailyQuota: 40,     // 每日浏览篇数上限
  perRound: 6,        // 每轮浏览篇数
  intervalMin: 25,    // 两轮之间的基础间隔（分钟，实际带随机抖动）
  dwellMin: 8,        // 单篇停留秒数（下限）
  dwellMax: 25,       // 单篇停留秒数（上限）
  openRate: 60,       // 打开笔记的比例（%）
  likeRate: 25,       // 点赞比例（%）
  collectRate: 12,    // 收藏比例（%）
  keywords: [],       // 内容方向（搜索关键词，可多个；留空 = 首页推荐）
  kwIdx: 0,           // 关键词轮换指针
};

const DailyBrowse = {
  _running: false,
  _browseTabId: null,

  /* ─── 配置 ─── */
  _num(v, def, min, max) {
    const n = parseInt(v, 10);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  },

  norm(cfg) {
    const c = Object.assign({}, DB_DEFAULT, cfg || {});
    c.enabled = !!c.enabled;
    c.dailyQuota = this._num(c.dailyQuota, DB_DEFAULT.dailyQuota, 1, 300);
    c.perRound = this._num(c.perRound, DB_DEFAULT.perRound, 1, 8);
    c.intervalMin = this._num(c.intervalMin, DB_DEFAULT.intervalMin, 5, 240);
    c.dwellMin = this._num(c.dwellMin, DB_DEFAULT.dwellMin, 3, 120);
    c.dwellMax = this._num(c.dwellMax, DB_DEFAULT.dwellMax, c.dwellMin, 300);
    c.openRate = this._num(c.openRate, DB_DEFAULT.openRate, 0, 100);
    c.likeRate = this._num(c.likeRate, DB_DEFAULT.likeRate, 0, 100);
    c.collectRate = this._num(c.collectRate, DB_DEFAULT.collectRate, 0, 100);
    c.keywords = (Array.isArray(c.keywords) ? c.keywords : []).map(s => String(s || '').trim()).filter(Boolean).slice(0, 20);
    c.windows = (Array.isArray(c.windows) ? c.windows : DB_DEFAULT.windows)
      .map(w => ({ start: String((w && w.start) || '').trim(), end: String((w && w.end) || '').trim() }))
      .filter(w => /^\d{1,2}:\d{2}$/.test(w.start) && /^\d{1,2}:\d{2}$/.test(w.end))
      .slice(0, 6);
    c.kwIdx = this._num(c.kwIdx, 0, 0, Math.max(0, c.keywords.length - 1));
    return c;
  },

  async getConfig() {
    const d = await chrome.storage.local.get(DB_KEY);
    return this.norm(d[DB_KEY]);
  },

  async saveConfig(patch) {
    const cfg = this.norm(Object.assign({}, await this.getConfig(), patch || {}));
    // 换成「关键词」列表后指针越界 → 归零
    if (cfg.keywords.length && cfg.kwIdx >= cfg.keywords.length) cfg.kwIdx = 0;
    await chrome.storage.local.set({ [DB_KEY]: cfg });
    await this.applySchedule();
    return cfg;
  },

  /* ─── 每日计数 / 对账 ─── */
  _today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  async _getDaily() {
    const today = this._today();
    const d = (await chrome.storage.local.get(DB_DAILY))[DB_DAILY] || {};
    if (d.date !== today) return { date: today, count: 0, countedRounds: [] };
    return { date: today, count: d.count || 0, countedRounds: Array.isArray(d.countedRounds) ? d.countedRounds : [] };
  },

  async _bumpDaily(n, roundId) {
    const daily = await this._getDaily();
    daily.count = (daily.count || 0) + (n || 0);
    if (roundId) daily.countedRounds = (daily.countedRounds || []).concat([roundId]).slice(-20);
    await chrome.storage.local.set({ [DB_DAILY]: daily });
    return daily;
  },

  // 兜底对账：页面侧落下 daily_browse_last 但后台没记上（service worker 中途被回收）→ 补记一次
  async reconcile() {
    try {
      const d = await chrome.storage.local.get([DB_LAST, DB_DAILY]);
      const last = d[DB_LAST];
      if (!last || !last.roundId || !Array.isArray(last.items) || !last.items.length) return;
      const daily = await this._getDaily();
      if ((daily.countedRounds || []).includes(last.roundId)) return;
      await this._bumpDaily(last.items.length, last.roundId);
      console.log('[日常浏览] 对账补记上一轮 ' + last.items.length + ' 篇（roundId=' + last.roundId + '）');
    } catch (_) {}
  },

  async _log(text) {
    const line = '[' + new Date().toLocaleTimeString() + '] ' + text;
    try {
      const d = await chrome.storage.local.get(DB_LOG);
      const logs = Array.isArray(d[DB_LOG]) ? d[DB_LOG] : [];
      logs.unshift({ ts: Date.now(), text: String(text) });
      await chrome.storage.local.set({ [DB_LOG]: logs.slice(0, 200) });
    } catch (_) {}
    console.log('[日常浏览] ' + text);
    return line;
  },

  /* ─── 时段判断 ─── */
  inWindow(cfg, nowMs) {
    const wins = (cfg && cfg.windows) || [];
    if (!wins.length) return true;   // 未配时段 = 全天可跑
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
  },

  /* ─── 状态（设置页展示用） ─── */
  async getStatus() {
    const cfg = await this.getConfig();
    const daily = await this._getDaily();
    const d = await chrome.storage.local.get([DB_LAST, DB_LOG, DB_RUNNING, DB_NEXT]);
    return {
      ok: true,
      cfg,
      running: !!this._running || !!d[DB_RUNNING],
      runningInfo: d[DB_RUNNING] || null,
      inWindow: this.inWindow(cfg),
      todayCount: daily.count || 0,
      dailyQuota: cfg.dailyQuota,
      lastRound: d[DB_LAST] || null,
      nextAt: d[DB_NEXT] || 0,
      logs: (Array.isArray(d[DB_LOG]) ? d[DB_LOG] : []).slice(0, 60),
    };
  },

  /* ─── 闹钟：跑完再排下一次（不重叠、带抖动） ─── */
  _jitter(minutes) {
    const base = Math.max(1, parseInt(minutes, 10) || 1);
    const span = Math.min(10, Math.max(1, Math.floor(base / 2)));
    const j = (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * (span + 1));
    return Math.max(1, base + j);
  },

  async applySchedule() {
    try {
      if (typeof chrome.alarms === 'undefined') return;
      const cfg = await this.getConfig();
      chrome.alarms.clear(DB_ALARM, () => {});
      if (!cfg.enabled) {
        await chrome.storage.local.set({ [DB_NEXT]: 0 });
        return;
      }
      const delay = this._jitter(cfg.intervalMin);
      chrome.alarms.create(DB_ALARM, { delayInMinutes: delay });
      await chrome.storage.local.set({ [DB_NEXT]: Date.now() + delay * 60000 });
    } catch (e) { console.warn('[日常浏览] 排程失败:', e); }
  },

  async handleAlarm(name) {
    if (name !== DB_ALARM) return;
    try { await this.runRound({}); }
    catch (e) { await this._log('本轮异常：' + ((e && e.message) || e)); }
    await this.applySchedule();   // 跑完再随机排下一次
  },

  /* ─── 停止（设置页「停止」按钮：页面侧每个单位检查一次） ─── */
  async stop() {
    await chrome.storage.local.set({ [DB_STOP]: Date.now() });
    return { ok: true };
  },

  /* ─── 跑一轮 ─── */
  async runRound(opts) {
    opts = opts || {};
    const force = !!opts.force;   // 手动「立即运行一轮」：忽略开关与时段，但仍受每日配额约束
    if (this._running) return { ok: false, error: '上一轮还在浏览中', running: true };

    const cfg = await this.getConfig();
    if (!force) {
      if (!cfg.enabled) return { ok: false, error: '日常浏览未开启' };
      if (!this.inWindow(cfg)) return { ok: false, error: '当前不在配置的浏览时段内' };
    }
    await this.reconcile();
    const daily = await this._getDaily();
    const left = Math.max(0, (cfg.dailyQuota || 0) - (daily.count || 0));
    if (left <= 0) return { ok: false, error: '今日浏览已达上限（' + cfg.dailyQuota + ' 篇）' };
    const count = Math.max(1, Math.min(cfg.perRound || 6, left));

    this._running = true;
    await chrome.storage.local.set({ [DB_RUNNING]: { startedAt: Date.now(), count } });

    let tabId = null, prevFocus = null, targetLabel = '', result = null;
    try {
      const target = await this._pickTarget(cfg);
      targetLabel = target.label;
      const tab = await this._getBrowseTab();
      if (!tab || tab.id == null) throw new Error('未找到/无法打开小红书标签页');
      tabId = tab.id;
      this._browseTabId = tab.id;
      prevFocus = await this._rememberFocus();
      await this._activate(tab.id, tab.windowId);

      await this._log('开始一轮：' + targetLabel + ' · ' + count + ' 篇');
      try { await chrome.tabs.update(tab.id, { url: target.url }); } catch (e) { throw new Error('打开页面失败：' + ((e && e.message) || e)); }
      await this._waitForTabLoad(tab.id, 20000);
      await this._sleep(1500);

      const roundId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const payload = {
        action: 'browseRound',
        opts: {
          roundId, count,
          dwellMin: cfg.dwellMin, dwellMax: cfg.dwellMax,
          openRate: cfg.openRate, likeRate: cfg.likeRate, collectRate: cfg.collectRate,
        },
      };
      const timeout = Math.min(10 * 60 * 1000, count * ((cfg.dwellMax || 25) + 40) * 1000 + 60000);
      try {
        result = await this._send(tab.id, payload, timeout);
      } catch (e) {
        // 扩展刚重载过 → 当前页面没有内容脚本：重注入一次再试
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          await this._sleep(600);
          result = await this._send(tab.id, payload, timeout);
        } catch (e2) {
          result = { ok: false, error: '页面脚本不可用：' + ((e2 && e2.message) || e2) };
        }
      }
    } catch (e) {
      result = { ok: false, error: (e && e.message) || String(e) };
    } finally {
      this._running = false;
      try { await chrome.storage.local.remove(DB_RUNNING); } catch (_) {}
      await this._restoreFocus(prevFocus, tabId);
    }

    const items = (result && Array.isArray(result.items)) ? result.items : [];
    const openedCount = items.filter(x => x && x.opened).length;
    const likedCount = items.filter(x => x && x.liked).length;
    const collectedCount = items.filter(x => x && x.collected).length;
    const ok = !!(result && result.ok !== false && result.success !== false);
    if (items.length) {
      await this._bumpDaily(items.length, (result && result.roundId) || '');
      await this._log('本轮完成：浏览 ' + items.length + ' 篇' +
        (openedCount ? '，打开 ' + openedCount + ' 篇' : '') +
        (likedCount ? '，点赞 ' + likedCount : '') +
        (collectedCount ? '，收藏 ' + collectedCount : '') +
        '（' + targetLabel + '）');
    } else {
      await this._log('本轮未产生浏览：' + ((result && result.error) || '未知原因'));
    }
    return Object.assign({}, result, { ok, target: targetLabel, count });
  },

  /* ─── 内部 ─── */
  async _pickTarget(cfg) {
    const kws = cfg.keywords || [];
    if (!kws.length) return { url: 'https://www.xiaohongshu.com/explore', label: '首页推荐' };
    let idx = parseInt(cfg.kwIdx, 10) || 0;
    if (idx < 0 || idx >= kws.length) idx = 0;
    const kw = kws[idx];
    try {
      const next = Object.assign({}, cfg, { kwIdx: (idx + 1) % kws.length });
      await chrome.storage.local.set({ [DB_KEY]: next });
    } catch (_) {}
    return { url: 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_explore_feed', label: '搜索「' + kw + '」' };
  },

  // 浏览用标签页：优先「💧 灌水工作台」绑定的页，其次非当前活动的小红书页，最后新建
  async _getBrowseTab() {
    try {
      const t = await getEngineTab('water');
      if (t && t.id) return t;
    } catch (_) {}
    const tabs = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' });
    const idle = tabs.find(t => !t.active);
    if (idle) return idle;
    if (tabs.length) return tabs[0];
    return await chrome.tabs.create({ url: 'https://www.xiaohongshu.com/explore', active: false });
  },

  async _rememberFocus() {
    try {
      const prev = await chrome.windows.getLastFocused({ populate: true });
      const act = (prev.tabs || []).find(t => t.active);
      return { windowId: prev.id, tabId: act ? act.id : null };
    } catch (_) { return null; }
  },

  async _activate(tabId, windowId) {
    try {
      await chrome.tabs.update(tabId, { active: true });
      const wid = (windowId != null) ? windowId : (await chrome.tabs.get(tabId)).windowId;
      try { await chrome.windows.update(wid, { focused: true }); } catch (_) {}
      await this._sleep(400);
    } catch (e) { console.warn('[日常浏览] 切到前台失败（继续尝试）:', e); }
  },

  // 结束后把焦点还给用户：只有当焦点仍停在浏览页时才切回，用户自己切走了就不打扰
  async _restoreFocus(prev, browseTabId) {
    if (!prev || prev.windowId == null) return;
    try {
      const w = await chrome.windows.getLastFocused({ populate: true });
      const act = (w.tabs || []).find(t => t.active);
      if (act && browseTabId != null && act.id !== browseTabId) return;
      if (prev.tabId != null) { try { await chrome.tabs.update(prev.tabId, { active: true }); } catch (_) {} }
      await chrome.windows.update(prev.windowId, { focused: true });
    } catch (_) {}
  },

  _send(tabId, msg, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        reject(new Error('页面响应超时（' + ((msg && msg.action) || '?') + '）'));
      }, timeoutMs || 10000);
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });
  },

  _waitForTabLoad(tabId, timeoutMs) {
    return new Promise(function (resolve) {
      const timeout = setTimeout(function () {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeoutMs);
      function listener(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 1500);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  },

  _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
};

if (typeof module !== 'undefined') {
  module.exports = DailyBrowse;
}
