/**
 * auto-bot.js — 自动灌水机器人（纯事件驱动版）
 * 
 * 独立于现有代码，仅通过操作界面按钮实现自动化：
 *   1. 自动点击"开始搜索" → 等待搜索结果
 *   2. 自动点击每个笔记的"打开"按钮 → 等待评论加载
 *   3. 自动点击每个潜在顾客的"一键发送"按钮
 *   4. 重复直到所有笔记处理完毕
 *
 * 所有等待均通过 MutationObserver 实现，零固定延时，纯串行执行。
 *
 * 使用方法：打开 popup 后，在左侧列表头选好「口径 × 节奏」，点「🤖 开始」启动。
 *   口径：全部未灌过（原🧊冷启动）/ 只追涨势（原🔄循环计划）
 *   节奏：一遍跑完 / 定时轮（每「扫描间隔」分钟一轮）
 */

(function () {
  'use strict';
  if (window.__xhsAutoBotLoaded) return;
  window.__xhsAutoBotLoaded = true;

  /* ============================================================
     工具函数
     ============================================================ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }

  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  /* 这一轮搜索（我刚点下去的那一轮）是不是已经跑完——不管它报的是什么词 */
  function _searchDoneThisRound(ss, t0) {
    ss = ss || {};
    var fresh = (Number(ss.searchStartedAt) || 0) >= t0 - 3000;   // 新一轮的开始时间必须在我点之前 3 秒内
    return !!(fresh && ss.searching === false);
  }
  /* 跑完了、而且词也对 */
  function _searchFreshEnough(ss, t0, wantKw) {
    ss = ss || {};
    var kwOk = !wantKw || String(ss.currentKeyword || '') === wantKw;
    return !!(_searchDoneThisRound(ss, t0) && kwOk);
  }
  /* TOP 玩法（活水）：笔记排在搜索前 30 名才值得补评论；同一篇 6 小时内最多补一条 */
  var TOP_MAX_POS = 30;
  var TOP_REWATER_MS = 6 * 3600000;
  /* 界面上这份名单和后台这一轮的结果对得上几篇（0＝完全是上一轮的名单） */
  function _listStateOverlap(domIds, wantIds) {
    var hit = 0;
    domIds = domIds || []; wantIds = wantIds || [];
    for (var i = 0; i < domIds.length; i++) { if (wantIds.indexOf(domIds[i]) >= 0) hit++; }
    return hit;
  }

  /* ─── 事件驱动的等待函数（MutationObserver） ─── */

  /**
   * 等待元素出现在 DOM 中
   * @param {string} selector  CSS 选择器
   * @param {number} timeout   超时毫秒（0=无限等待）
   * @param {Element} [root]   监听根节点（默认 document.body）
   * @returns {Promise<Element>}
   */
  /* ─── 事件驱动的等待函数（MutationObserver）───
   * 都返回带 .cancel() 的 Promise：竞速场景下，胜出的分支要主动 cancel 掉其余还没 settle 的
   * 等待，否则它们的 MutationObserver/timer 会滞留到永久，跨多篇笔记累积成内存/资源泄漏。 */
  function _attachCancel(p, disposers) {
    p.cancel = function () {
      (disposers || []).forEach(function (f) { try { f(); } catch (_) {} });
    };
    return p;
  }

  /**
   * 等待元素出现在 DOM 中
   * @param {string} selector  CSS 选择器
   * @param {number} timeout   超时毫秒（0=不自动超时，但要用 .cancel() 手动释放）
   * @param {Element} [root]   监听根节点（默认 document.body）
   * @returns {Promise<Element> & {cancel: Function}}
   */
  function waitElement(selector, timeout, root) {
    root = root || document.body;
    var disposers = [];
    var p = new Promise(function (resolve, reject) {
      var el = $(selector);
      if (el) { resolve(el); return; }

      var timer = null;
      var obs = new MutationObserver(function () {
        el = $(selector);
        if (el) {
          if (timer) clearTimeout(timer);
          try { obs.disconnect(); } catch (_) {}
          resolve(el);
        }
      });
      obs.observe(root, { childList: true, subtree: true });
      disposers.push(function () { if (timer) clearTimeout(timer); try { obs.disconnect(); } catch (_) {} });

      if (timeout > 0) {
        timer = setTimeout(function () {
          try { obs.disconnect(); } catch (_) {}
          reject(new Error('⏱ 超时: ' + selector + ' (' + timeout + 'ms)'));
        }, timeout);
      }
    });
    return _attachCancel(p, disposers);
  }

  /**
   * 等待目标元素的 class 包含指定名称
   * @param {Element} target    目标 DOM 元素
   * @param {string}  className 要等待的类名
   * @param {number}  timeout   超时毫秒
   * @returns {Promise<void> & {cancel: Function}}
   */
  function waitClass(target, className, timeout) {
    var disposers = [];
    var p = new Promise(function (resolve, reject) {
      if (target.classList.contains(className)) { resolve(); return; }

      var timer = null;
      var obs = new MutationObserver(function () {
        if (target.classList.contains(className)) {
          if (timer) clearTimeout(timer);
          try { obs.disconnect(); } catch (_) {}
          resolve();
        }
      });
      obs.observe(target, { attributes: true, attributeFilter: ['class'] });
      disposers.push(function () { if (timer) clearTimeout(timer); try { obs.disconnect(); } catch (_) {} });

      if (timeout > 0) {
        timer = setTimeout(function () {
          try { obs.disconnect(); } catch (_) {}
          reject(new Error('⏱ 超时等待类 ' + className + ' (' + timeout + 'ms)'));
        }, timeout);
      }
    });
    return _attachCancel(p, disposers);
  }

  /**
   * 等待目标元素的文本包含指定子串
   * @param {Element} target  目标元素
   * @param {string}  substr  期望包含的文本
   * @param {number}  timeout 超时毫秒
   * @returns {Promise<void> & {cancel: Function}}
   */
  function waitText(target, substr, timeout) {
    var disposers = [];
    var p = new Promise(function (resolve, reject) {
      if (target.textContent.indexOf(substr) !== -1) { resolve(); return; }

      var timer = null;
      var obs = new MutationObserver(function () {
        if (target.textContent.indexOf(substr) !== -1) {
          if (timer) clearTimeout(timer);
          try { obs.disconnect(); } catch (_) {}
          resolve();
        }
      });
      obs.observe(target, { childList: true, subtree: true, characterData: true });
      disposers.push(function () { if (timer) clearTimeout(timer); try { obs.disconnect(); } catch (_) {} });

      if (timeout > 0) {
        timer = setTimeout(function () {
          try { obs.disconnect(); } catch (_) {}
          reject(new Error('⏱ 超时等待文本 "' + substr + '" (' + timeout + 'ms)'));
        }, timeout);
      }
    });
    return _attachCancel(p, disposers);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* ─── 每日评论计数（队列页底部「今日评论 N」显示用）───
     2026-11-09 老板定：它只记账，不再当上限拦人。 */
  function _awTodayKey() { return new Date().toISOString().slice(0, 10); }
  async function _awDailyBump(n) {
    try {
      const r = await new Promise(function (res) { chrome.storage.local.get('auto_water_daily', res); });
      const d = (r && r['auto_water_daily']) || {};
      d[_awTodayKey()] = (Number(d[_awTodayKey()]) || 0) + (Number(n) || 0);
      await new Promise(function (res) { chrome.storage.local.set({ auto_water_daily: d }, res); });
      return d[_awTodayKey()];
    } catch (_) { return 0; }
  }

  /* ─── 发消息给 background（带超时兜底，防止后台不响应导致 bot 永久卡死） ─── */
  function sendMsg(action, data, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('消息超时(' + (timeoutMs || 10000) + 'ms)无响应: ' + action));
      }, timeoutMs || 10000);
      chrome.runtime.sendMessage({ action: action, data: data }, function (resp) {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!resp) reject(new Error('无响应: ' + action));
        else resolve(resp);
      });
    });
  }

  /* ─── AI 扫描结束信号（popup 广播：无商机/失败/评论不足时触发，收到即结束等待） ─── */
  var _aiSignalResolve = null;
  var _signalNoteId = '';        // 当前这份"扫描结束信号"在等哪篇笔记（用于血缘校验，防串篇）
  function _onAiScanDone(e) {
    var d = e && e.detail;
    var nid = (d && d.noteId) || '';
    // ★ 血缘校验：广播若带了 noteId，且不是我当前正在等的这篇，直接忽略——防止上（前）一篇的迟到信号误结当前篇
    if (nid && _signalNoteId && nid !== _signalNoteId) return;
    window.removeEventListener('xhsAiScanDone', _onAiScanDone);
    // ★ 2026-11-05：不再只带「成/不成」，把 popup 判定的真实原因一起带回来——
    //   以前 12 个不同出口全写成「无商机」，老板看不出到底卡在哪一步。
    var r = {
      ok: !!(d && d.ok),
      code: (d && d.code) || '',
      label: (d && d.label) || '',
      noteReview: (d && d.noteReview) || null
    };
    if (_aiSignalResolve) {
      var res = _aiSignalResolve;
      _aiSignalResolve = null;
      _signalNoteId = '';
      res(r);
    }
  }

  /**
   * 等待面板切换到 active 状态
   * @param {string} panelId  面板元素 ID
   * @param {number} timeout  超时毫秒
   * @returns {Promise<void>}
   */
  function waitPanel(panelId, timeout) {
    var el = document.getElementById(panelId);
    if (!el) return Promise.reject(new Error('面板不存在: ' + panelId));
    return waitClass(el, 'active', timeout);
  }

  /** 在 logPanel 末尾插入一条日志 */
  function botLog(msg, type) {
    type = type || 'info';
    var panel = document.getElementById('logPanel');
    if (panel) {
      panel.style.display = 'block';
      var now = new Date();
      var timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      /* 公网那套页面：面板由执行桥统一画（时间口径一致、占位按 id 撤）；扩展里没这个钩子就走老路 */
      var unified = (typeof window.__XHS_BENCH_LOG__ === 'function') &&
        window.__XHS_BENCH_LOG__(msg, '🤖', type, timeStr);
      if (!unified) {
        if (panel.children.length === 1 && panel.children[0].textContent.includes('操作日志将显示在这里')) {
          panel.innerHTML = '';
        }
        var entry = document.createElement('div');
        entry.className = 'log-entry ' + type;
        entry.dataset.src = 'bot';   // ★ 标记来源，配合"只看 bot"过滤
        entry.innerHTML = '<span class="log-time">' + timeStr + '</span><span class="log-src" style="color:#c41d3c;font-weight:700;margin-right:4px;font-size:10px;">🤖</span>' + msg;
        panel.appendChild(entry);
        panel.scrollTop = panel.scrollHeight;
        while (panel.children.length > 200) panel.removeChild(panel.firstChild);
      }
      // ★ 同步镜像到锁定遮罩日志（bot 运行时遮罩会盖住面板，以前 bot 的日志在遮罩上完全看不到）
      if (typeof window.__xhsMirrorLog === 'function') {
        try { window.__xhsMirrorLog(msg, type, timeStr, 'bot', '🤖'); } catch (_) {}
      }
      /* ★ 同一句也回传服务器：公网工作台的「操作日志 / 这一趟的记录」靠它显示
         「正在打开哪一篇 / 已经跑了哪些篇」。网页自己（非扩展页）跑时没有后台可发，跳过。 */
      try {
        if (location.protocol === 'chrome-extension:' && chrome.runtime && chrome.runtime.sendMessage) {
          var _bp = chrome.runtime.sendMessage({ type: 'ex.botlog', text: msg });
          if (_bp && _bp.catch) _bp.catch(function () {});
        }
      } catch (_) {}
      console.log('[Bot][' + timeStr + '] ' + msg);
    }
  }
  /* 内核那段（搜索/换词/排序）不在这个页面里，写不进这条日志——给它个钩子，它自己会来拿 */
  window.__xhsBotLog = botLog;

  /* ============================================================
     自动灌水机器人核心
     ============================================================ */
  var bot = {
    running: false,
    stopped: false,
    paused: false,       // ★ 暂停：当前这一步做完就停在原地等（不像停止那样抛错退出、丢进度）
    waterTabId: null,    // ★ 双引擎：本引擎绑定的「💧 灌水工作台」标签页 id

    /** 解析/绑定水 tab：引擎只在它上面驱动页面，绝不碰客服 tab */
    _ensureWaterTab: async function () {
      var self = this;
      if (self.waterTabId) { try { await chrome.tabs.get(self.waterTabId); return self.waterTabId; } catch (_) { self.waterTabId = null; } }
      try {
        var r = await sendMsg('getEngineTab', { kind: 'water' });
        if (r && r.tabId) { self.waterTabId = r.tabId; return self.waterTabId; }
      } catch (_) {}
      return null;
    },

    /** 启动。scope=口径：all 全部未灌过 / growing 只追涨势；pace=节奏：once 一遍跑完 / interval 定时轮
     *  opts.auto=true＝后台保底时钟拉起来的自动跑：跑完不等于收工——今天还有活就驻留等它到点（见 _runQueue） */
    start: async function (scope, pace, opts) {
      if (this.running) {
        botLog('⏳ 机器人已在运行中', 'warn');
        return;
      }
      // 🛡 账号安全：静默期 / 起床前 / 发布占线 → 这趟不新起
      //    （网页上手点的单会带一张「手点这一轮」的放行票，静默期照跑；票是否有效由 AccountGuard 判）
      try {
        if (typeof AccountGuard !== 'undefined') {
          var _wall = await AccountGuard.blockAllReason();
          if (_wall) { botLog('🛡 ' + _wall.text, 'warn'); return { blocked: _wall.text }; }
        }
      } catch (_) {}
      window.__botEngineBusy = 'bot';
      this.running = true;
      this.stopped = false;
      this.paused = false;
      /* 按计划歇着（等下一项到点）：遮罩的"卡住"判据要放过这段，不然定时轮每歇一次就报黄 */
      this.waiting = false;
      this.waitUntil = 0;    // 等到的时刻（遮罩上倒计时用；0＝没有确定时刻）
      this.waitWhy = '';     // 在等什么（一句白话，遮罩直接显示）
      this.autoMode = !!(opts && opts.auto);
      /* 🧠 一趟＝队列里的一个细项（2026-11-09 老板定）：这一行跑完就收工，下一次再跑下一行。
         seg='daily' 只刷一轮首页；不带 seg 的老单（手点「开始」）也按「只跑一个细项」算。 */
      this.segMode = (opts && opts.seg === 'daily') ? 'daily' : 1;
      this._autoStopN = 0;
      /* 服务器按平台暂停/没认号算出来的"这趟跳过哪几头"（xhs / dy）：那几头的趟这轮一律不取 */
      this.skipPlats = (opts && Array.isArray(opts.skipPlats))
        ? opts.skipPlats.filter(function (p) { return p === 'xhs' || p === 'dy'; })
        : [];
      this.scope = scope === 'growing' ? 'growing' : 'all';
      this.pace = (pace === 'once' || pace === 'interval') ? pace : 'interval';
      // ★ 双引擎：启动即绑定水 tab（只在它上面驱动页面，客服走客服 tab，二者互不抢页）
      try { await this._ensureWaterTab(); } catch (_) {}
      // ★ 手动/自动互斥：运行期间禁用列表里的单篇「🔗 打开」，避免人工点开与执行器抢同一个页面
      this._setBotLock(true);
      botLog('🤖 ===== 自动灌水启动（口径：' + (this.scope === 'growing' ? '只追涨势' : '全部未灌过') +
        ' · 一趟一个细项' + (this.autoMode ? ' · 后台保底时钟拉起' : '') + '） =====', 'info');
      await this._codePairCheck();
      if (this.skipPlats.length) {
        /* 只提示今天队列里真被跳掉的那一头（2026-11-04）：跑小红书的趟别拿抖音的提示吓人 */
        var _hasPlat = {};
        try {
          var _p0 = drainQueuePlan(await drainGetScanCfg(), await drainGetQueue(), Date.now(), await drainDailyCtx());
          (_p0.todo || []).forEach(function (it) { if (it && it.plat) _hasPlat[it.plat] = true; });
        } catch (_) { this.skipPlats.forEach(function (p) { _hasPlat[p] = true; }); }
        var _hitPlats = this.skipPlats.filter(function (p) { return _hasPlat[p]; });
        if (_hitPlats.length) {
          botLog('⏸ 这趟跳过「' + _hitPlats.map(function (p) { return p === 'dy' ? '抖音' : '小红书'; }).join('、') +
            '」那一头（后台按了暂停 / 还没认号）', 'warn');
        }
      }
      this._updateUI(true);
      // 执行器状态：后台看门狗靠它判断"要不要再把窗口拉起来"（跑完/停掉都写回 false）
      await this._setRunFlag(true);
      if (!this.autoMode) {
        // 手动点开始＝人来过了：把"空转熔断"的标记清掉，让它再试；也解掉"今天不再自动拉起"
        try { await chrome.storage.local.remove('daily_browse_broken'); } catch (_) {}
        try { if (typeof DailyBrowse !== 'undefined' && DailyBrowse.clearHold) await DailyBrowse.clearHold(); } catch (_) {}
      }

      var queueDone = null;
      try {
        // ★ 队列执行器：跑的是「词 × 类型」这一格一格（到点的那些格子＝队列），一格 = 一次搜索 + 按口径灌水
        botLog('🧠 这一趟只跑队列里的一个细项：跑完就收工，下一次再跑下一行（两项之间公网随机歇 3~10 分钟）', 'info');
        queueDone = await this._runQueue();
      } catch (e) {
        if (e.message === '手动停止') {
          botLog('⏹ 机器人已手动停止', 'warn');
          // 自动跑被"人"按停：今天别再自动拉起来（明天照常；手动点开始即刻解除）
          if (this.autoMode) {
            try { if (typeof DailyBrowse !== 'undefined' && DailyBrowse.stop) await DailyBrowse.stop(); } catch (_) {}
            botLog('（今天不再自动拉起；明天按「每天自动跑」的时段继续，想现在接着跑就点「🤖 开始」）', 'info');
          }
        } else {
          botLog('❌ 机器人异常: ' + e.message, 'error');
          console.error('[AutoBot]', e);
        }
      }

      window.__botEngineBusy = '';
      window.__acqCurScenario = '';
      this.running = false;
      this._updateUI(false);
      this._setBotLock(false);
      await this._cqLive(null);   // 💬 评论条队列：这一趟跑完/被停 → 撤掉实时进度（不留"正在发"假象）
      await this._setRunFlag(false, queueDone);
      if (!this.stopped && queueDone !== null) {
        botLog(queueDone ? '🏁 ===== 自动灌水完成 =====' : '⏸ ===== 队列停在半路（已记欠账，下次点「🤖 开始」从那一项接着跑）=====',
          queueDone ? 'success' : 'warn');
      }
      // 🌿 自动跑：今天的活都干完了 → 请后台把「保底时钟自己开的那个窗」收掉（静默收工）
      if (this.autoMode && queueDone === true) await this._autoIdle();
    },

    /** 自动跑收工：让后台关掉"保底时钟自己拉起来的那个窗"（用户自己开的大窗绝不动） */
    _autoIdle: async function () {
      try { await chrome.runtime.sendMessage({ action: 'dailyAutoIdle' }); } catch (_) {}
    },

    /* ── 开跑前的代码配套检查（2026-11-05）──
       出过的事：新版判断跑在旧版读配置上，每一篇都被悄悄判成「不评」，日志里还看不出来。
       这里开跑前把三样对一遍：函数在不在 → 排班读不读得出「评论策略」→ 策略值认不认得。
       不配就红字喊出来（不拦着跑，但老板一眼能看见要重装）。 */
    _codePairCheck: async function () {
      var self = this;
      var bad = [];
      try {
        if (typeof drainGetScanCfg !== 'function') bad.push('读配置的段（drainGetScanCfg）不在');
        if (typeof drainPbPlan !== 'function') bad.push('算排班的段（drainPbPlan）不在');
        if (typeof drainPlaybookOf !== 'function') bad.push('玩法表（drainPlaybookOf）不在');
        if (typeof drainReadTabMetrics !== 'function') bad.push('读页面信息的段（drainReadTabMetrics）不在');
        if (!bad.length) {
          var p = drainPbPlan({ pbPlan: {} }, 'top');
          if (!p || typeof p.mode !== 'string' || !p.mode) bad.push('排班读不出「评论策略」（mode 空）');
          else if (['note', 'both', 'reply', 'people'].indexOf(p.mode) < 0) bad.push('评论策略的值不认识：' + p.mode);
        }
        ['_waterCurrentNote', '_postNoteComment', '_collectProspects'].forEach(function (k) {
          if (typeof self[k] !== 'function') bad.push('本页缺方法 ' + k);
        });
      } catch (e) {
        bad.push('自检自己出错了：' + ((e && e.message) || e));
      }
      if (bad.length) {
        botLog('  ❌ 代码没配套：' + bad.join('；') + ' → 这趟的「评不评」可能全判错，跑完请重新安装执行器', 'warn');
        return false;
      }
      botLog('  ✅ 代码配套自检通过：读配置 / 排班 / 评论策略 / 发送链都对得上', 'info');
      return true;
    },

    /** 执行器运行标记（后台看门狗只看这一个键；done=true 表示"到点的都跑完了"） */
    _setRunFlag: async function (running, done) {
      try {
        await chrome.storage.local.set({
          daily_browse_run_state: { running: !!running, done: !!done, at: Date.now(), auto: !!this.autoMode },
        });
      } catch (_) {}
    },

    /** 手动/自动互斥：列表单篇「🔗 打开」的启用/禁用交给左侧面板自己管（重渲染后也保持禁用） */
    _setBotLock: function (locked) {
      try {
        if (window.AutoWaterApp && window.AutoWaterApp.setBotLock) window.AutoWaterApp.setBotLock(locked);
      } catch (_) {}
    },

    /** 💬 评论条队列的实时进度（队列页「▶ 正在跑」下那一行 + 获客助手页顶栏都读它）
     *  传 null 清掉；只动 auto_water_state.live 一个键，绝不碰 searchState。
     *  整对象覆盖（不是合并）：调用方每次把 kw/scenario/篇/条 一并给全，免得残留上一条的作者。 */
    _cqLive: async function (o) {
      try {
        var d = await new Promise(function (res) { chrome.storage.local.get('auto_water_state', res); });
        var st = d['auto_water_state'] || {};
        st.live = o ? {
          kw: String(o.kw || ''), scenario: String(o.scenario || ''),
          title: String(o.title || ''), idx: Number(o.idx) || 0, total: Number(o.total) || 0,
          author: String(o.author || ''), ci: Number(o.ci) || 0, cTotal: Number(o.cTotal) || 0, sent: Number(o.sent) || 0,
          at: Date.now(),
        } : null;
        await chrome.storage.local.set({ auto_water_state: st });
      } catch (_) {}
    },

    /** 读「💧 灌水频率与去重」里的扫描间隔与趋势参数（maxPerRound 不再当限流用，兜底 0＝不限） */
    _trendConfig: async function () {
      var config = { scanIntervalMin: 10, maxPerRound: 0 };
      try {
        if (window.NoteTrend) {
          var c = await window.NoteTrend.getConfig();
          if (c) config = c;
        }
      } catch (_) {}
      return config;
    },

    /* ─── 队列执行器：串行跑「词 × 类型」一格一格 ───
     *   一趟＝只跑队首那一项（一个细项）：这一项跑完就收工，下一次再跑下一行；
     *   两项之间由公网随机歇 3~10 分钟，机器这边不自己排间隔。
     *   搜索起不来 → 当前项记欠账并停下（下次点开始从它接着跑）；
     *   配置表里已经没有这一格了 → 直接丢（改表＝改队列，不留死项） */
    _runQueue: async function () {
      var self = this;
      var round = 0, completed = 0;
      var dropped = {};   // 本次跑里"丢掉了、但还挂在队头"的项 → 防止原地反复重搜
      var ran = {};       // 本次跑已跑过的项（"每轮跑"的格子跑完仍算到点，一趟里不重复跑）
      /* 🧠 分段：一段只管一类活。日常浏览 2026-11-09 起是队列里的普通一行，
         seg=1 时照队列顺序取（轮到了就跑它），不再单独拦。 */
      if (self.segMode) {
        try {
          var _p0 = drainQueuePlan(await drainGetScanCfg(), await drainGetQueue(), Date.now(), await drainDailyCtx());
          if (self.segMode === 'daily') {
            (_p0.todo || []).forEach(function (it) {
              if (it && it.scenario !== 'daily') ran[_drainQKey(it.k, it.scenario, it.plat, it.passId)] = true;
            });
          }
          /* 开跑前提醒：缺属地 / 词已停用，别悄悄丢（2026-11-09） */
          var _warn = [];
          if ((_p0.noCity || []).length) {
            var _cw = {};
            (_p0.noCity || []).forEach(function (x) { if (x && x.k) _cw[x.k] = 1; });
            var _cwN = Object.keys(_cw);
            _warn.push('同城城市没填，「本地 / 异业」有 ' + _cwN.length + ' 个词跑不了（' + _cwN.slice(0, 5).join('、') + (_cwN.length > 5 ? '…' : '') + '）');
          }
          if ((_p0.stopped || []).length) {
            var _sw = (_p0.stopped || []).map(function (x) { return x && x.k; }).filter(Boolean);
            _warn.push(_sw.length + ' 个词已停用、不进队列（' + _sw.slice(0, 5).join('、') + (_sw.length > 5 ? '…' : '') + '）');
          }
          if (_warn.length) botLog('⚠️ 开跑前提醒：' + _warn.join('；') + ' —— 同城城市到「📊 诊断 → 基础配置 → 📍 城市」填，停用词到「获客 → 队列 → 配置」打开', 'warn');
        } catch (_) {}
      }
      while (true) {
        await self._checkStop();
        var item = await drainQueueTake(ran);
        if (!item) {
          /* 🧠 一趟只跑一个细项：这一项跑完/队列里没到点的了，就明确收工，不再接着啃下一行 */
          if (self.segMode) {
            botLog(self.segMode === 'daily'
              ? '✅ 这一段日常浏览刷完（下一次再刷下一轮）'
              : '✅ 队列里现在没有到点的细项（下一次再跑下一个）', 'success');
            return true;
          }
          var waitingN = 0, planNow = null;
          try {
            planNow = drainQueuePlan(await drainGetScanCfg(), await drainGetQueue(), Date.now(), await drainDailyCtx());
            waitingN = planNow.waiting.length;
          } catch (_) {}
          // 🌿 自动跑（保底时钟拉起来的）：到点的跑完不等于收工——今天还有活就守着，等到点再跑
          if (self.autoMode) {
            var rest = await self._autoRest(planNow);
            if (rest.waitMs > 0) {
              var nxt = new Date(Date.now() + rest.waitMs);
              botLog('⏳ 自动跑：到点的都跑完了（本次跑了 ' + completed + ' 项），今天还有活——' + rest.why +
                '，约 ' + String(nxt.getHours()).padStart(2, '0') + ':' + String(nxt.getMinutes()).padStart(2, '0') + ' 后再看队列', 'info');
              self.waitWhy = rest.why || '下一项还没到点';
              await self._autoSleep(rest.waitMs);
              continue;
            }
            botLog('🏁 自动跑：今天的活都干完了（本次跑了 ' + completed + ' 项）' + (rest.why ? '——' + rest.why : ''), 'success');
            return true;
          }
          botLog('🏁 队列里到点的都跑完了（本次跑了 ' + completed + ' 项）' +
            (waitingN ? '；还有 ' + waitingN + ' 项没到点（到「获客 → 任务配置」看那一列的节奏，或等它到点）' : '') +
            '——改表就是改队列，随时可再跑一趟', 'success');
          return true;
        }
        // 一趟里的去重键＝一次搜索（词|类型#筛选）：拆行后同一词的三次 TOP 各算各的，不能互相顶掉
        var ik = _drainQKey(item.k, item.scenario, item.plat, item.passId);
        /* 后台暂停 / 没认号的那一头：这趟不跑，记进 ran 别在队头原地空转 */
        if (item.plat && self.skipPlats.indexOf(item.plat) >= 0) {
          ran[ik] = true;
          continue;
        }
        if (dropped[ik]) {
          await drainQueueBlock(item, '跑不起来、又还挂在配置表里');
          ran[ik] = true;
          botLog('🔴 队头这一项「' + (item.label || item.k) + ' × ' + self._qTypeName(item.scenario) + '」跑不起来、又还挂在配置表里，先标红不空转——去「获客 → 任务配置」改这一格', 'warn');
          continue;
        }
        round++;
        var r = null;
        try {
          r = await self._runQueueItem(item, round);
        } catch (e) {
          // 被手动停止/异常抛出：把当前项记欠账（别让它悬在「▶ 正在跑」不动）
          try { await drainQueueHold(item, (e && e.message) === '手动停止' ? '被手动停止' : ('出错：' + ((e && e.message) || e))); } catch (_) {}
          throw e;
        }
        if (r && r.drop) { dropped[ik] = true; continue; }
        /* 🛑 整队停（到上限 / 账号安全拦下 / 页面没接上）：这些不是某一项的问题，换一项也没用 */
        if (r && r.stop && r.global) {
          try { await drainQueueHold(item, r.why || '跑不起来'); } catch (_) {}
          try { await drainQueueLastStop(item, r.why || '跑不起来', { global: true }); } catch (_) {}
          botLog('⏸ 队列停下：' + (r.why || '跑不起来') + '——已记欠账，下次点「🤖 开始」从这一项接着跑', 'warn');
          self._stats = self._stats || {};
          self._stats.note = '这一行没跑成：' + (r.why || '跑不起来');
          if (self.autoMode) {
            self._autoStopN = (self._autoStopN || 0) + 1;
            if (self._autoStopN >= 3) {
              try { await chrome.storage.local.set({ daily_browse_broken: { at: Date.now(), reason: '连续 3 次没跑起来（页面被手动占用 / 页面卡住 / 到上限）' } }); } catch (_) {}
              botLog('🛑 先停了：连续 ' + self._autoStopN + ' 次没跑起来。看一眼小红书页面是不是没打开 / 卡住了，回头点「🤖 开始」手动跑一趟', 'error');
            }
          }
          return false;
        }
        /* ⏭ 某一项跑不起来：记一笔就往下走，别让整条队列卡在它身上（老板 2026-10-30 定） */
        if (r && (r.block || r.stop)) {
          var _nm = '「' + (item.label || item.k) + ' × ' + self._qTypeName(item.scenario) + '」';
          var _why = r.why || '跑不起来';
          ran[ik] = true;
          var _nb = await drainQueueBlock(item, _why);
          try { await drainQueueLastStop(item, _why, { n: _nb }); } catch (_) {}
          if (r.block) {
            botLog('🔴 ' + _nm + '标红等你处理：' + _why + '——队列继续往下走', 'warn');
          } else if (_nb < 3) {
            await drainQueueHold(item, _why);
            botLog('⏭ ' + _nm + '先跳过（今天第 ' + _nb + ' 次没跑起来：' + _why + '），队列继续往下走', 'warn');
          } else {
            botLog('🔴 ' + _nm + '连续 ' + _nb + ' 次没跑起来，标红等你处理：' + _why + '——队列继续往下走', 'warn');
          }
          /* 🧠 分段：这一段没跑成也收工，把原因带回去（别接着啃下一行） */
          if (self.segMode) {
            self._stats = self._stats || {};
            self._stats.note = '这一行没跑成：' + _why;
            return false;
          }
          continue;
        }
        ran[ik] = true;   // 跑过的不再进这一趟（"每轮跑"的格子下一趟再来）
        completed++;
        self._autoStopN = 0;   // 跑通一项就把连续失败次数清零
        /* 🧠 一趟只跑一个细项：这一行跑完就收工——下一段由公网随机歇 3~10 分钟再派（2026-11-09） */
        if (self.segMode) return true;
        if (self.pace === 'interval') {
          // 后面还有到点的项才等这一轮；跑完最后一项直接收尾（否则白等一个间隔才报"跑完了"）
          var nextN = 0;
          try {
            var _pn = drainQueuePlan(await drainGetScanCfg(), await drainGetQueue(), Date.now(), await drainDailyCtx());
            nextN = _pn.todo.filter(it => !ran[_drainQKey(it.k, it.scenario, it.plat, it.passId)]).length;
          } catch (_) {}
          if (nextN > 0) {
            var config = await self._trendConfig();
            await self._waitNextRound(config, round);
          }
        }
      }
    },

    /* ─── 跑队列里的一项：搜索这一格 → 按口径灌水 → 记完成 / 记欠账 ─── */
    _runQueueItem: async function (item, seq) {
      var self = this;
      var card = self._qTypeName(item.scenario);
      self._guardStop = false;   // 🛡 总账拦下＝整项停下记欠账（额度已删，现在只留兜底）
      self._stats = { found: 0, comments: 0, notes: [] };
      /* 🧠 分段回执要说清"这一段是哪一行"（公网按它记账） */
      self._stats.segRow = {
        k: item.k, scenario: item.scenario, plat: item.plat || 'xhs',
        label: item.label || '', passLabel: item.passLabel || '',
      };
      self._curKw = item.k;              // 💬 评论条队列的实时进度要带上"这一项是哪个词 × 哪个类型"
      self._curScenario = item.scenario;
      window.__acqCurScenario = item.scenario || '';   // 这一格是哪个玩法：回评论区那句要跟着它
      /* 拆行后 seq 是「第几次搜索」；同一个词的热门会连着出现三次（点赞/评论/收藏最多） */
      var cardLine = card + (item.passLabel ? ' · ' + item.passLabel : '');
      var seqUnit = item.scenario === 'daily' ? ' 轮' : (item.acct ? ' 次主页扫描' : ' 次搜索');
      botLog('▶ 第 ' + seq + seqUnit + '：' + cardLine + ' × 「' + (item.label || item.k) + '」' +
        (item.carry ? '（接着上次没跑完的）' : '') + (item.manual ? '（手插到最前）' : ''), 'info');

      // 🌿 日常流程：不走「搜索 → 灌水」那条路，单独跑（见 _runDailyItem）
      if (item.scenario === 'daily') return await self._runDailyItem(item, seq);

      // 🎵 抖音那一趟：搜词 → 捞作品 → 进评论找问价的人（见 _runDouyinItem）
      if (item.plat === 'dy') return await self._runDouyinItem(item, seq);

      var notes = await self._doSearchRound(item);
      if (!notes) {
        var qe = self._qErr || { kind: 'hold', msg: '搜索没出结果' };
        /* 词被停用 / 属地没填：重试没用，直接标红等人工改配置；其余当可重试的失败 */
        if (qe.kind === 'drop') {
          botLog('🔴 这一项跑不了，标红等你处理：' + qe.msg, 'warn');
          return { block: true, why: qe.msg };
        }
        botLog('⚠️ 这一项没跑起来：' + qe.msg, 'warn');
        return { stop: true, why: qe.msg };
      }
      self._stats.found = notes.length;

      if (self.scope === 'growing') await self._roundGrowing(notes);
      else await self._roundAll(notes);

      /* 🛡 账号安全拦下：换一项也没用，整队停（队列页顶部会说清原因） */
      if (self._guardStop) {
        return { stop: true, global: true, why: '🛡 账号安全拦下，下次接着跑' };
      }
      /* 这一格该干的干完了：记完成、等公网派下一行 */
      await drainQueueFinish(item, {
        foundN: self._stats.found,
        commentN: self._stats.comments,
        notes: self._stats.notes,
        allSkipped: !!self._allSkipped,
        note: self._allSkipped
          ? ((self._skipOpenedToday >= self._stats.found && self._stats.found > 0)
            ? '搜到的今天都开过了（同一天不重开）'
            : '搜到的都评过了')
          : (self._stats.comments > 0 ? ('评论 ' + self._stats.comments + ' 条') : '没找到可评论的'),
      });
      botLog('✅ 第 ' + seq + seqUnit + '跑完（' + cardLine + '）：搜到 ' + self._stats.found + ' 篇 · ' +
        (self._allSkipped
          ? ((self._skipOpenedToday >= self._stats.found && self._stats.found > 0) ? '今天都开过了 · 0 条' : '都评过了 · 0 条')
          : ('评论 ' + self._stats.comments + ' 条')), 'success');
      return { done: true };
    },

    /* ─── 🎵 抖音那一趟：搜词 → 捞 20 条作品 → 逐条进评论找问价的人 ───
     *   只「看和记」：不发评论、不发私信、不关注（确认单 §二/§四）。
     *   网页这份没有抖音页可驱动（抖音只在执行器里跑），所以老实地记欠账、不冒充跑过。 */
    _runDouyinItem: async function (item, seq) {
      var self = this;
      await self._checkStop();
      botLog('🔴 抖音获客要在执行器里跑：网页这头没有抖音页，标红等你换到执行器跑', 'warn');
      return { block: true, why: '抖音获客要在执行器里跑（网页这头没有抖音页）' };
    },

    /* 🌿 自动跑：今天还剩哪些"还没到点"的活 → 值不值得守着（返回 {waitMs, why}；waitMs=0＝今天没活了）
     *   获客格子 / 盯的账号：它们自带"下次到点"。日常浏览没有时段/配额这一层（上午没插上就跑空了再补），
     *   不参与"要等多久"的判断。再拿自动跑时段收口：等不到那一刻就直接收工，别把窗口守过夜。 */
    _autoRest: async function (plan) {
      var self = this;
      var now = Date.now();
      var endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
      var cands = [];
      ((plan && plan.waiting) || []).forEach(function (w) {
        if (w.nextAt > 0 && w.nextAt <= endToday.getTime()) {
          cands.push({ at: w.nextAt, why: '「' + (w.label || w.k) + ' × ' + self._qTypeName(w.scenario) + '」还没到点' });
        }
      });
      var db = await drainDailyCtx();
      if (!cands.length) return { waitMs: 0, why: '今天没有还没到点的活了' };
      cands.sort(function (a, b) { return a.at - b.at; });
      var wait = Math.max(60000, Math.min(cands[0].at - now, 10 * 60000));
      // 自动跑时段收口：这一觉睡不到那一刻就别睡了（看门狗会在时段内再把它拉起来）
      try {
        if (db && db.cfg && db.cfg.autorun && db.cfg.autorun.enabled && typeof DailyBrowse !== 'undefined' && DailyBrowse.autorunOn) {
          if (!DailyBrowse.autorunOn(db.cfg, now + wait)) return { waitMs: 0, why: '已过今天的自动跑时段' };
        }
      } catch (_) {}
      return { waitMs: wait, why: cands[0].why };
    },

    /* 自动跑的驻留等待：可被「停止 / 暂停」打断（普通 sleep 打断不了） */
    _autoSleep: async function (ms) {
      var self = this;
      var deadline = Date.now() + Math.max(0, ms);
      self.waiting = true;
      self.waitUntil = deadline;
      if (!self.waitWhy) self.waitWhy = '下一项还没到点';
      try {
        while (Date.now() < deadline) {
          await self._checkStop();
          await sleep(Math.min(5000, Math.max(1000, deadline - Date.now())));
        }
        await self._checkStop();
      } finally { self.waiting = false; self.waitUntil = 0; self.waitWhy = ''; }
    },

    /* 队列项的类型名（表格里的口径名，如「💬 最新」） */
    _qTypeName: function (scenario) {
      var def = (typeof drainScenarioDef === 'function') ? (drainScenarioDef(scenario) || {}) : {};
      return (def.icon || '') + (def.label || String(scenario || ''));
    },

    /* ─── 🌿 队列里的日常流程项：挑一个方向 → 水 tab 进它的内容里 → 让页面泛刷一轮 ───
     *   一轮只记日常浏览自己的账（daily_browse_daily / daily_browse_last），
     *   绝不碰灌水 / 回复 / 获客台账（隔离口径见设计文档 §五）。
     *   页面侧每刷完一篇都会落一次 daily_browse_last，所以这里靠"轮询它对账"推进，
     *   不靠长消息的返回值——就算弹窗关了、页面自己也会把这一轮跑完并落账。 */
    _runDailyItem: async function (item, seq) {
      var self = this;
      await self._checkStop();
      var db = await drainDailyCtx();
      var cfg = db && db.cfg;
      if (!cfg) { botLog('⚠️ 读不到日常浏览配置（重开弹窗再试）', 'warn'); return { stop: true, what: 'daily', why: '读不到日常浏览配置（重开弹窗再试）' }; }
      var dir = (typeof DailyBrowse !== 'undefined') ? DailyBrowse.dirById(cfg, item.k) : null;
      if (!dir) { await drainQueueDrop(item.k, 'daily'); botLog('⏭ 这一轮日常流程作废：日常浏览已经关掉了', 'warn'); return { drop: true }; }

      // 该不该跑（只认总开关）→ 记一条完成跳过，别把整条队列堵在这一项上
      // 手插的一轮＝「现在就跑」：总开关拦不住它
      var skip = self._dailySkipReason(cfg, !!item.manual);
      if (skip) { await drainQueueFinish(item, { note: skip }); botLog('⏭ 这一轮跳过：' + skip, 'warn'); return { done: true }; }
      if (item.manual && !cfg.enabled) botLog('ℹ️ 日常浏览总开关是关的：这一轮是你手插的，照跑一次（队列不会自动排它）', 'info');

      // 🛡 账号安全：静默期/发布占线 → 这轮不跑（每段之间由公网歇 3~10 分钟；不再有每天额度）
      var _gw = null;
      try {
        if (typeof AccountGuard !== 'undefined') _gw = await AccountGuard.blockAllReason();
      } catch (_) {}
      if (_gw) {
        botLog('⏹ 🛡 ' + (_gw.text || '账号安全拦下这一轮') + '，这一项先跳过', 'warn');
        return { stop: true, why: '🛡 ' + (_gw.text || '账号安全拦下这一轮') };
      }

      /* 一轮刷几篇：在「下限~上限」之间随机取（默认 18~22） */
      var _mn = Math.max(1, Number(cfg.perRoundMin) || 18);
      var _mx = Math.max(_mn, Number(cfg.perRoundMax) || _mn);
      var count = _mn + Math.floor(Math.random() * (_mx - _mn + 1));
      var url = 'https://www.xiaohongshu.com/explore';

      var tabId = await self._ensureWaterTab();
      if (!tabId) { botLog('⚠️ 没找到「💧 灌水工作台」标签页，先停下', 'warn'); return { stop: true, global: true, why: '没找到「💧 灌水工作台」标签页（页面被关了 / 没打开）' }; }
      var roundId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      botLog('  → 进首页推荐，泛刷 ' + count + ' 篇（正常看 ' + cfg.dwellMin + '~' + cfg.dwellMax + 's，秒退 ' + (Number(cfg.bounceRate) || 0) + '%，看完 ' + (Number(cfg.fullRate) || 0) + '%）', 'info');
      try { await chrome.tabs.update(tabId, { url: url }); }
      catch (e) { botLog('⚠️ 打开浏览页失败：' + ((e && e.message) || e), 'warn'); return { stop: true, global: true, why: '打开浏览页失败：' + ((e && e.message) || e) }; }
      await self._dbWaitLoad(tabId, 20000);
      await self._checkStop();

      var opts = {
        roundId: roundId, total: count, count: count,
        dirId: dir.id, dirName: dir.name,
        dwellMin: cfg.dwellMin, dwellMax: cfg.dwellMax,
        openRate: cfg.openRate, likeRate: cfg.likeRate, collectRate: cfg.collectRate,
        /* 打开后怎么看法：秒退 / 看完 / 余下正常看（2026-10-30） */
        bounceRate: cfg.bounceRate, fullRate: cfg.fullRate,
        /* 顺手互动：只按概率走、不设每日名额（-1＝不限）；0% ＝ 这个动作不做。
           「评论」一项管发新评论和回别人一句两种说法；真正的天花板是账号安全那道闸 */
        comment: { rate: (cfg.comment || {}).rate, left: -1 },
        follow: { rate: (cfg.follow || {}).rate, left: -1 },
      };
      var sent = await self._dbStartRound(tabId, opts);
      if (!sent) { botLog('⚠️ 页面脚本没接上：可能页面没加载好，下次接着跑', 'warn'); return { stop: true, why: '页面脚本没接上（这一轮没发车）' }; }

      var r = null;
      try {
        r = await self._dbAwaitRound(roundId, count, cfg);
      } catch (e) {
        // 被手动停止 / 暂停中出错：让页面也尽快收尾，别在后台继续刷
        try { if (typeof DailyBrowse !== 'undefined') await DailyBrowse.stop(); } catch (_) {}
        throw e;
      }
      if (!r.ok) {
        var why = r.noStart ? '页面没动起来（可能被手动操作占着 / 页面没加载好）' : '这一轮跑太久，先收尾';
        botLog('⚠️ ' + why + '，这一项先跳过', 'warn');
        return { stop: true, why: why };
      }

      var last = r.last || {};
      var items = Array.isArray(last.items) ? last.items : [];
      var viewed = items.length;
      /* 这一趟的"刷了几篇日常"要跟着回执走到网页上：不然「搜到 0 篇」会被读成"根本没刷" */
      self._stats = self._stats || {};
      self._stats.daily = { name: dir.name, viewed: viewed };
      self._stats.segRow = { k: dir.id, scenario: 'daily', plat: 'xhs', label: dir.name || '日常浏览', passLabel: '' };
      var opened = items.filter(x => x && x.opened).length;
      var liked = items.filter(x => x && x.liked).length;
      var collected = items.filter(x => x && x.collected).length;
      var comments = Number(last.comments) || 0, replies = Number(last.replies) || 0, follows = Number(last.follows) || 0;
      // 🛡 账号安全：这轮实际发生过的动作如实过总账（页面按概率做的：浏览/赞/藏/评论回复/关注）
      try {
        if (typeof AccountGuard !== 'undefined') {
          if (viewed > 0) await AccountGuard.spendSelf('open', viewed);
          if (liked > 0) await AccountGuard.spendSelf('like', liked);
          if (collected > 0) await AccountGuard.spendSelf('save', collected);
          if ((comments + replies) > 0) await AccountGuard.spendSelf('comment', comments + replies);
          if (follows > 0) await AccountGuard.spendSelf('follow', follows);
        }
      } catch (_) {}
      if (typeof DailyBrowse !== 'undefined') {
        try {
          await DailyBrowse.bumpDaily({ directionId: dir.id, views: viewed, comments: comments, replies: replies, follows: follows });
          await DailyBrowse.log('一轮完成：「' + dir.name + '」' + (kw ? '搜「' + kw + '」' : '首页推荐') + ' 刷 ' + viewed + ' 篇' +
            (opened ? '，打开 ' + opened + ' 篇' : '') + (liked ? '，点赞 ' + liked : '') + (collected ? '，收藏 ' + collected : '') +
            (comments ? '，评论 ' + comments : '') + (replies ? '，回复 ' + replies : '') + (follows ? '，关注 ' + follows : ''));
        } catch (_) {}
      }
      await drainQueueFinish(item, {
        foundN: viewed, commentN: comments,
        note: viewed ? ('刷 ' + viewed + ' 篇' + (liked ? ' · 赞 ' + liked : '') + (collected ? ' · 藏 ' + collected : '') +
          (comments ? ' · 评论 ' + comments : '') + (follows ? ' · 关注 ' + follows : '')) : '一篇都没刷到',
      });
      botLog('✅ 第 ' + seq + ' 项跑完：「' + dir.name + '」刷 ' + viewed + ' 篇' +
        (liked ? ' · 赞 ' + liked : '') + (collected ? ' · 藏 ' + collected : '') +
        (comments ? ' · 评论 ' + comments : '') + (replies ? ' · 回复 ' + replies : '') + (follows ? ' · 关注 ' + follows : ''), 'success');
      return { done: true };
    },

    /* 今天这一轮还能不能跑（不能跑＝跳过这一轮，不堵队列）
       force＝手塞的一轮：用户当下点了「塞一趟」，总开关不拦它 */
    _dailySkipReason: function (cfg, force) {
      if (!force && (!cfg || !cfg.enabled)) return '日常浏览已关（在「获客 → 队列 → 🌿 日常浏览」里打开）';
      return '';
    },
    _dbLast: async function () {
      try {
        var d = await new Promise(function (res) { chrome.storage.local.get('daily_browse_last', res); });
        return d['daily_browse_last'] || null;
      } catch (_) { return null; }
    },
    /* 页面加载完 + 稳定一下再发车（onUpdated 没等到就按兜底时间放行） */
    _dbWaitLoad: function (tabId, timeoutMs) {
      return new Promise(function (resolve) {
        var done = false;
        var finish = function () { if (done) return; done = true; try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {} resolve(); };
        var listener = function (id, info) { if (id === tabId && info && info.status === 'complete') setTimeout(finish, 1500); };
        try { chrome.tabs.onUpdated.addListener(listener); } catch (_) {}
        setTimeout(finish, timeoutMs || 20000);
        setTimeout(function () {
          try { chrome.tabs.get(tabId, function (t) { if (!chrome.runtime.lastError && t && t.status === 'complete') finish(); }); } catch (_) {}
        }, 1500);
      });
    },
    /* 发车：把这一轮交给页面侧跑。发出去就不等返回值了（这一轮要跑好几分钟，
       靠 daily_browse_last 对账推进，见 _dbAwaitRound）；返回 false＝页面脚本没接上 */
    _dbStartRound: async function (tabId, opts) {
      var ping = function () {
        // checkSearchReady 是页面侧最轻的一条路由（不需抢锁）：能应答＝内容脚本在
        return Promise.race([
          chrome.tabs.sendMessage(tabId, { action: 'checkSearchReady' }).then(function () { return true; }).catch(function () { return false; }),
          sleep(3000).then(function () { return false; }),
        ]);
      };
      var alive = await ping();
      if (!alive) {
        // 扩展刚重载过 → 当前页面没有内容脚本：补注入一次再试
        try { await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }); } catch (_) {}
        await sleep(1000);
        alive = await ping();
      }
      if (!alive) return false;
      try {
        var p = chrome.tabs.sendMessage(tabId, { action: 'browseRound', opts: opts });
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (_) { return false; }
      return true;
    },
    /* 等页面把这一轮跑完：先等它"开跑"（落一次 daily_browse_last），再等 done 标记 */
    _dbAwaitRound: async function (roundId, count, cfg) {
      var self = this;
      var t0 = Date.now();
      var startMs = 90000;
      var _dMax = Number(cfg.dwellMax) || 25;
      /* 一篇最多可能占到「看完」的 2 分钟封顶（没配看完就按正常看的视频上限算） */
      var _perNote = Math.max(_dMax, Math.min(_dMax * 1.6, 120), Number(cfg.fullRate) > 0 ? 120 : 0);
      var runMs = Math.round(count * ((_perNote + 40) * 1000) + 120000);
      var started = false, lastN = -1;
      while (true) {
        await sleep(2000);
        await self._checkStop();
        var elapsed = Date.now() - t0;
        if (!started && elapsed > startMs) return { ok: false, noStart: true };
        if (started && elapsed > runMs) return { ok: false, timeout: true };
        var last = await self._dbLast();
        if (!last || last.roundId !== roundId) continue;
        started = true;
        var n = (last.items || []).length;
        if (n !== lastN) { lastN = n; if (n) botLog('  🌿 已刷 ' + n + '/' + count + ' 篇…', 'info'); }
        if (last.done) return { ok: true, last: last };
      }
    },

    /* 标题归一：判重用（去空白、去尾部省略号/标点，截 60 字） */
    _noteTitleKey: function (t) {
      return String(t || '').replace(/\s+/g, '').replace(/[。．.…,.!！?？~～;；:：]+$/g, '').slice(0, 60);
    },

    /* TOP 活水：同一篇补过评论的时间（drain_top_water = { noteId/标题: at }；只留 7 天） */
    _topWaterLog: async function () {
      try {
        var d = await chrome.storage.local.get('drain_top_water');
        return (d && d.drain_top_water) || {};
      } catch (_) { return {}; }
    },
    _topWaterMark: async function (key) {
      try {
        var d = await chrome.storage.local.get('drain_top_water');
        var m = (d && d.drain_top_water) || {};
        var now = Date.now(), cut = now - 7 * 86400000;
        Object.keys(m).forEach(function (k) { if (!(Number(m[k]) > cut)) delete m[k]; });
        if (key) m[key] = now;
        await chrome.storage.local.set({ drain_top_water: m });
      } catch (_) {}
    },

    /* 「今天开过」账本（drain_open_day = { day, items: { 笔记ID/标题: at } }）：
       2026-11-10 老板定：打开过、但没评上的笔记以前一点痕都不留，下一行/下一趟又把它开一遍；
       打开成功就记一笔，当天这一篇不再重开。跨天自动清。
       TOP 玩法不查这本账——它本来就要回看我的评论还在不在前排。 */
    _openDayKey: function () {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    _openDayLog: async function () {
      var today = this._openDayKey();
      try {
        var r = await chrome.storage.local.get('drain_open_day');
        var log = (r && r['drain_open_day']) || null;
        if (!log || log.day !== today || !log.items) return { day: today, items: {} };
        return log;
      } catch (_) { return { day: today, items: {} }; }
    },
    _openDayHas: async function (key) {
      if (!key) return false;
      try { var log = await this._openDayLog(); return !!log.items[key]; } catch (_) { return false; }
    },
    _openDayMark: async function (key) {
      if (!key) return;
      try {
        var log = await this._openDayLog();
        log.items[key] = Date.now();
        var ks = Object.keys(log.items);
        if (ks.length > 600) {
          ks.sort(function (a, b) { return (Number(log.items[a]) || 0) - (Number(log.items[b]) || 0); })
            .slice(0, ks.length - 600)
            .forEach(function (k2) { delete log.items[k2]; });
        }
        await chrome.storage.local.set({ drain_open_day: log });
      } catch (_) {}
    },

    /* ─── 口径「全部未灌过」：当前结果逐屏推进，看到就灌（已灌过/队列已跑过的跳过） ─── */
    _roundAll: async function () {
      var self = this;
      // ★ 列表永远 = 当前页可见项，绝不脱节:
      //   本屏可见的笔记逐篇处理完 → 滚动搜索页加载下一屏 → popup 重渲染新一批 → 继续，到底为止。
      //   避免旧逻辑"列表登记了一堆滚动后的卡片，但回顶后靠下的卡片不在 DOM"导致的 CTRL+F 找不到。
      var handledNotes = {};
      var handledTitles = {};   // ★ 同一趟里按标题再挡一道（翻屏后列表重排会出「标题一样、ID 不同」的卡片）
      var screenGuard = 0;   // 一轮最多翻几屏，防死循环
      var SCREEN_MAX = 30;
      /* 2026-11-09 老板定：这一行不再设「每轮最多处理 N 篇 / 每天最多 N 条」——
         搜到的笔记逐篇过完，把这一细项一次刷完。只保留页面卡住的 2 分钟看门狗（那不是限流）。 */
      var _triesThisRun = 0;   // 这一行实际点开的篇数（只用于日志）
      self._allSkipped = false;
      self._skipOpenedToday = 0;   // 这一行里因为「今天已经开过」被跳过的篇数（只用于收尾那句话）
      var _seenNotes = 0, _skipNotes = 0;
      /* 💧 TOP 玩法看「活水」：已评过 / 队列跑过都不等于不用看——
         先打开看我的评论还在不在前排；还在 → 不动，掉出去 → 补一条。
         「我的昵称」没配就查不了活水，这一行先不评（开跑前提醒会说明去哪填）。 */
      var isTop = String(self._curScenario || '') === 'top';
      var topNames = [], topLog = {};
      if (isTop) {
        try { topNames = (typeof drainMyAccountNames === 'function') ? await drainMyAccountNames() : []; } catch (_) { topNames = []; }
        try { topLog = await self._topWaterLog(); } catch (_) { topLog = {}; }
        if (!topNames.length) botLog('⚠️ TOP 玩法要查活水（我的评论还在不在前排），但「我的小红书昵称」还没配——这一行先不评，去「📊 诊断 → 基础配置 → 我的小红书昵称」填上再跑', 'warn');
      }
      var notes = $$('#noteList .note-item');
      if (notes.length === 0) {
        botLog('⚠️ 笔记列表为空，结束本轮', 'warn');
        return false;
      }

      while (screenGuard++ < SCREEN_MAX) {
        await self._checkStop();
        if (self._guardStop) break;   // 🛡 总账拦下 → 整轮收队，上层记欠账（额度已删，只留兜底）
        notes = $$('#noteList .note-item');
        // 按 noteId 挑第一篇“本轮未处理过”的笔记（逐屏推进后整列由 popup 重渲染，仍按 noteId 去重跳过）
        var note = null, nid = '', num = 0;
        for (var k = 0; k < notes.length; k++) {
          var _id = notes[k].dataset.noteId || '';
          if (!handledNotes[_id]) { note = notes[k]; nid = _id; num = k + 1; break; }
        }
        if (!note) {
          // ★ 当前屏已全部处理 → 滚动加载下一屏，处理新一批
          var advOk = await self._advanceScreen();
          if (!advOk) break;
          continue;
        }
        handledNotes[nid] = true; // 先登记，逐屏推进时据此跳过已处理的，防重复
        _seenNotes++;

        // ★ 单篇出错只跳过本篇，绝不拖垮整轮（否则一异常整轮"断"）
        var noteTitle = '';
        try {
          var titleEl = note.querySelector('.note-title');
          noteTitle = titleEl ? titleEl.textContent.trim().slice(0, 30) : ('#' + num);
          var openBtn = note.querySelector('.btn-open-note');
          if (!openBtn) { _skipNotes++; botLog('⏭ 笔记 "' + noteTitle + '" 没有打开按钮，跳过', 'info'); continue; }
          var _tk = self._noteTitleKey(titleEl ? titleEl.textContent : '');
          if (isTop) {
            /* TOP：已灌过 / 队列跑过都不当跳过理由，交给下面的活水判断 */
            if (!topNames.length) { _skipNotes++; continue; }
            var _twKey = nid || ('t:' + (_tk || noteTitle));
            var _twLast = Number(topLog[_twKey]) || 0;
            if (_twLast && (Date.now() - _twLast) < TOP_REWATER_MS) {
              _skipNotes++;
              botLog('⏭ 笔记 "' + noteTitle + '" 6 小时内补过评论，先不动', 'info');
              continue;
            }
            /* 名次按这一趟一路数下来（num 只是本屏第几张，翻屏会从 1 重数） */
            if (_seenNotes > TOP_MAX_POS) {
              _skipNotes++;
              botLog('⏭ 笔记 "' + noteTitle + '" 排在搜索第 ' + _seenNotes + ' 位（前 ' + TOP_MAX_POS + ' 名外），补了也没人看见', 'info');
              continue;
            }
          } else {
            // 已灌水 → 跳过（与列表徽标「全部未灌过」口径同源）
            if (openBtn.dataset.watered === 'true') {
              _skipNotes++;
              botLog('⏭ 笔记 "' + noteTitle + '" 已灌水，跳过', 'info');
              continue;
            }
            // 队列里已经跑过这一篇（工作台那个「✅ 队列已跑过」标）→ 也跳过，别再开一遍重评
            var qBtn = note.querySelector('.note-q');
            if (qBtn && qBtn.dataset.qdone === 'true') {
              _skipNotes++;
              botLog('⏭ 笔记 "' + noteTitle + '" 队列里已跑过，跳过', 'info');
              continue;
            }
            /* 今天已经开过这一篇（打开过但没评上的以前不留痕）→ 当天不再重开 */
            var _odKey = nid || ('t:' + (_tk || self._noteTitleKey(noteTitle)));
            if (await self._openDayHas(_odKey)) {
              _skipNotes++;
              self._skipOpenedToday++;
              botLog('⏭ 笔记 "' + noteTitle + '" 今天已经开过，不重开', 'info');
              continue;
            }
          }
          /* ★ 同一趟里同一标题只开一次：翻屏后虚拟列表会重排出「标题一样、ID 不同」的卡片，
             光按 noteId 去重挡不住（按标题点开会把已经评过的那篇再开一遍） */
          if (_tk && handledTitles[_tk]) {
            _skipNotes++;
            botLog('⏭ 笔记 "' + noteTitle + '" 这一趟已经开过（翻屏后名单重排），跳过', 'info');
            continue;
          }
          if (_tk) handledTitles[_tk] = true;
          _triesThisRun++;
          botLog('📄 打开笔记 "' + noteTitle + '" (这一趟第 ' + _triesThisRun + ' 篇 · 本屏 ' + num + '/' + notes.length + ')', 'info');
          self._cqNoteIdx = num; self._cqNoteTotal = notes.length;
          await self._cqLive({ kw: self._curKw, scenario: self._curScenario, title: noteTitle, idx: num, total: notes.length });

          /* TOP 要越过后台「已有我的评论」拦截（force），不然一篇「上回评过、这回掉榜」的明明该补，
             会被内容脚本直接判成已灌水跳过 */
          var openOk = await self._openNote(self._noteFromList(nid), { recordOpened: true, force: isTop });
          if (!openOk) {
            if (self._guardStop) break;   // 🛡 总账拦下 → 收队（压根没离开列表，不用回退）
            // ★ 方案A下列表与页面实时一致，单篇打开失败多属偶发（页面瞬时态）→ 直接返回列表、跳过本篇继续
            await self._goBackToList();
            continue;
          }
          /* 打开成功就记「今天开过」（不等有没有评上）：竞对这类只收人不评论的，
             以前开完一痕不留，下一行/下一趟又把同一批全量重开一遍 */
          if (!isTop) {
            try { await self._openDayMark(nid || ('t:' + (_tk || self._noteTitleKey(noteTitle)))); } catch (_) {}
          }

          /* 💧 TOP 活水：打开后先看我那条评论还在不在前排（位置 + 点赞）。
             前 3 位＝黄金位；4~10 位但有人赞（≥3）＝还在榜——都不用动；
             掉出前排 / 这条搜索里没占位 → 补一条。查不到（页面没回话 / 没配昵称）这次不补。 */
          if (isTop) {
            var mc = null;
            try { mc = (typeof drainReadMyCommentFromTab === 'function') ? await drainReadMyCommentFromTab(self.waterTabId, topNames) : null; } catch (_) { mc = null; }
            if (!mc || !mc.checked) {
              _skipNotes++;
              botLog('  ⚠️ 活水没查成（页面没回话），这篇这次不补，下一圈再看', 'warn');
              await self._goBackToList();
              continue;
            }
            var _mcLikes = Number(mc.likes) || 0;
            var _alive = !!(mc.found && ((mc.rank > 0 && mc.rank <= 3) || (mc.rank <= 10 && _mcLikes >= 3)));
            var _where = mc.found
              ? ('我的评论在第 ' + mc.rank + ' 位' + (mc.likes != null ? ' · 👍' + mc.likes : ''))
              : '这条搜索里还没我的评论';
            botLog('  💧 活水：' + _where + ' → ' + (_alive ? '还在前排，这篇不补' : (mc.found ? '掉出前排，补一条' : '还没占位，补一条')), _alive ? 'info' : 'warn');
            if (_alive) {
              _skipNotes++;
              await self._goBackToList();
              continue;
            }
          }

          // ===== 等 AI 分析并逐个发送 =====
          var wRes = await self._waterCurrentNote(noteTitle, isTop ? null : note, nid);
          var sentCount = wRes ? wRes.count : 0;
          if (isTop && sentCount > 0) {
            /* 这一篇补过了：6 小时内不再补（记在 drain_top_water，重启也不忘） */
            try { await self._topWaterMark(_twKey); topLog[_twKey] = Date.now(); } catch (_) {}
          }
          if (sentCount > 0) {
            await _awDailyBump(sentCount); // ★ 只记账：今天发了多少条（不再设每日上限）
            self._stats.comments += sentCount; // ★ 队列项汇总：这一项评论了几条
            // ★ 笔记级明细：✅ 已完成 里折叠展示；id 让工作台笔记列表能精确标出「队列跑过没」
            self._stats.notes.push({ id: nid || '', t: noteTitle, s: sentCount });
          }
          // ★ 扫过却没东西可发（AI 判定无商机/评论不足/不适合评论）→ 记一笔"扫过了"（只加冷却、不占浇水次数），
          //   避免已打开未灌水的笔记在逐屏推进时又被挑出来反复打开刷同一页
          if (sentCount <= 0 && wRes && (wRes.reason === 'empty' || wRes.reason === 'lurk' || wRes.reason === 'skip') && window.NoteTrend) {
            try { await window.NoteTrend.noteChecked(nid || ''); } catch (_) {}
          }
          if (sentCount > 0 && window.NoteTrend) {
            try { await window.NoteTrend.markWatered(nid || ''); } catch (_) {}
          }

          // ===== 返回列表（恢复打开按钮），处理下一篇 =====
          await self._goBackToList();
          botLog('  ✅ 笔记 "' + noteTitle + '" 处理完毕', 'success');
        } catch (e) {
          botLog('  ⚠️ 处理笔记 "' + (noteTitle || ('#' + num)) + '" 出错：' + (e && e.message ? e.message : e) + '，跳到下一篇', 'warn');
          try { await self._goBackToList(); } catch (_) {}
        }
      }

      /* 这一搜扫到的每一篇都是「已灌水 / 队列已跑过」→ 队列行要写「都评过了」，别装作没找到 */
      self._allSkipped = (_seenNotes > 0 && _skipNotes === _seenNotes);
      botLog('📊 所有笔记处理完成！', 'success');
      return true;
    },

    /* ─── 口径「只追涨势」：从趋势库挑点赞增长中的笔记（度控制：每篇总次数/同篇冷却/复核冷却） ─── */
    _roundGrowing: async function (foundNotes) {
      var self = this;
      var config = await self._trendConfig();
      /* 2026-11-09 老板定：这一行不设「每轮最多处理」——挑到多少篇就跑多少篇 */
      config.maxPerRound = 0;
      // 等点赞采样落库 → 挑"增长中"的笔记
      try { if (window.NoteTrend) await window.NoteTrend.flushSamples(); } catch (_) {}
      // ★ 只从"当前这轮搜索结果"里挑：用本轮 DOM 笔记的 noteId 作为候选池，
      //   避免从历史累积趋势库挑出不在当前页面的笔记 → 打开时 CTRL+F 找不到
      var allowedIds = {};
      for (var fi = 0; fi < foundNotes.length; fi++) {
        var _nid = foundNotes[fi].dataset.noteId;
        if (_nid) allowedIds[_nid] = true;
      }
      var picked = [];
      var statText = '';
      try {
        if (window.NoteTrend) {
          var trends = await window.NoteTrend.getTrends();
          picked = window.NoteTrend.pickCycleNotes(trends, config, Date.now(), allowedIds);
          // ★ 趋势库分布统计：便于判断是"真没增长"还是"采样没进来"
          var nHot = 0, nGrow = 0, nFlat = 0, nDown = 0, nNew = 0;
          for (var sid in trends) {
            var st = trends[sid];
            if (!st || !st.samples || st.samples.length < 2) { nNew++; continue; }
            if (st.tag === 'hot') nHot++;
            else if (st.tag === 'growing') nGrow++;
            else if (st.tag === 'flat') nFlat++;
            else if (st.tag === 'down') nDown++;
            else nNew++;
          }
          statText = '📊 趋势库 ' + Object.keys(trends).length + ' 篇（🔥快速增长 ' + nHot + ' / 📈增长中 ' + nGrow + ' / ⚪平稳 ' + nFlat + ' / 📉下滑 ' + nDown + ' / 🆕观察中' + nNew + '）';
        }
      } catch (_) {}
      botLog(statText || '📊 趋势库为空（本轮搜索未产生采样，需重新搜索）', 'info');
      if (picked.length === 0) {
        botLog('⏭ 本轮没有符合条件的增长中笔记（需≥2次采样且点赞在涨；灌水达上限/冷却中的不挑）', 'info');
        return true;
      }
      botLog('🎯 本轮挑选 ' + picked.length + ' 篇增长中笔记：' + picked.map(function (p) { return String(p.title || p.noteId || '').slice(0, 10); }).join('、'), 'success');

      // 逐篇打开（追涨复核：无视已灌水标记）→ 等 AI → 发送 → 返回
      for (var pi = 0; pi < picked.length; pi++) {
        await self._checkStop();
        if (self._guardStop) break;   // 🛡 总账拦下 → 整轮收队，上层记欠账（额度已删，只留兜底）
        var note = picked[pi];
        var nid = note.noteId || '';
        // ★ 用当前搜索结果里的实时标题/链接/索引定位（趋势库里的历史标题可能与卡片文字有细微差异）
        var payload = self._noteFromList(nid) || {};
        if (!payload.title) payload.title = note.title;
        if (!payload.url) payload.url = note.url;
        var title = String(payload.title || nid).slice(0, 30);
        botLog('📄 打开增长笔记 "' + title + '" (' + (pi + 1) + '/' + picked.length + ')', 'info');
        self._cqNoteIdx = pi + 1; self._cqNoteTotal = picked.length;
        await self._cqLive({ kw: self._curKw, scenario: self._curScenario, title: title, idx: pi + 1, total: picked.length });
        try {
          // ★ 追涨复核：force 置 __forceRescan，无视"已有我的评论"拦截
          var openOk = await self._openNote(payload, { force: true });
          if (!openOk) {
            if (self._guardStop) break;   // 🛡 总账拦下 → 收队（压根没离开列表，不用回退）
            await self._goBackToList();
          } else {
            var wRes = await self._waterCurrentNote(title, null, nid);
            var sent = wRes ? wRes.count : 0;
            if (sent > 0) {
              await _awDailyBump(sent); // ★ 只记账：今天发了多少条（不再设每日上限）
              self._stats.comments += sent; // ★ 队列项汇总：这一项评论了几条
              // ★ 笔记级明细：✅ 已完成 里折叠展示；id 让工作台笔记列表能精确标出「队列跑过没」
              self._stats.notes.push({ id: nid || '', t: title, s: sent });
            }
            // ★ 扫过却没东西可发（AI 判定无商机/不适合评论）→ 只加复核冷却、不占浇水次数，
            //   下一轮才不会被当成"增长中"反复打开刷同一页
            if (sent <= 0 && wRes && (wRes.reason === 'empty' || wRes.reason === 'lurk' || wRes.reason === 'skip') && window.NoteTrend) {
              try { await window.NoteTrend.noteChecked(nid); } catch (_) {}
            }
            if (sent > 0 && window.NoteTrend) {
              try { await window.NoteTrend.markWatered(nid); } catch (_) {}
            }
            await self._goBackToList();
          }
        } catch (enote) {
          botLog('  ⚠️ 处理笔记 "' + title + '" 出错：' + (enote && enote.message ? enote.message : enote) + '，跳到下一篇', 'warn');
          try { await self._goBackToList(); } catch (_) {}
        }
      }
      return true;
    },

    /** 停止 */
    stop: function () {
      this.paused = false;   // 暂停中也能直接停：先解掉暂停，让等着的那一处走到 _checkStop 抛错退出
      this.stopped = true;
      this.waitUntil = 0;
      this.waitWhy = '';
      botLog('⏹ 收到停止信号，等待当前操作完成后停止...', 'warn');
      this._updateUI(false);
    },

    /** 暂停：不打断正在发的那一条，等它做完，到下一个检查点停下等着（进度、页面都留在原地） */
    pause: function () {
      if (!this.running || this.paused) return;
      this.paused = true;
      this.waitUntil = 0;
      this.waitWhy = '已暂停（点工作台上的「▶ 继续」接着跑）';
      botLog('⏸ 已暂停：当前这一步做完就停下等（点「▶ 继续」接着跑，进度不丢）', 'warn');
      this._updateUI(true);
    },

    /** 继续：从暂停的那一步往下接着跑 */
    resume: function () {
      if (!this.paused) return;
      this.paused = false;
      this.waitWhy = '';
      botLog('▶ 已继续，接着跑', 'info');
      this._updateUI(true);
    },

    /** 暂停开关（顶栏按钮走它） */
    togglePause: function () {
      if (this.paused) this.resume(); else this.pause();
    },

    /** 检查是否应停止；暂停中就在这儿等着（恢复后自动续跑）。
     *  所有长流程的检查点都是它，所以暂停＝下一个检查点生效，不会发一半就断 */
    _checkStop: async function () {
      if (this.stopped) throw new Error('手动停止');
      if (!this.paused) return;
      while (this.paused) {
        if (this.stopped) throw new Error('手动停止');
        await sleep(400);
      }
    },

    /* ─── 返回列表：点击「⬅ 返回」恢复按钮，为下一篇做准备 ─── */
    _goBackToList: async function () {
      var self = this;
      var backBtn = document.getElementById('btnBackToList');
      // ★ 返回用「这一行正在搜的词」（不拿配置里第一个词兜底：队列一行可能是别的词，回错词页面就全对不上了）
      var kw = '';
      try {
        var _s = await new Promise(function (res) { chrome.storage.local.get('auto_water_state', res); });
        var _ss = ((_s['auto_water_state'] || {}).searchState) || {};
        var _pl = _ss.plan || [];
        var _p = _pl[_ss.planIdx] || _pl[_pl.length - 1] || null;
        if (_p && !_p.kind && _p.term && !/^https?:/i.test(_p.term)) kw = String(_p.term);
      } catch (_) {}
      if (!kw) { try { var _r = await new Promise(function (res) { chrome.storage.local.get('auto_water_config', res); }); kw = (((_r['auto_water_config'] || {}).keywords) || [])[0] || ''; } catch (_) {} }
      // ★ 不再用“按钮是否可见”来判断：时序常使可见性为 none，导致跳过返回、紧接笔记导航错乱（“断”）。
      //   .click() 对隐藏元素同样触发事件，这里始终点击以触发 popup 的 goBack（重置 UI + 让 tab 回搜索页）
      if (backBtn) {
        backBtn.click();
        botLog('  ⬅ 返回列表...', 'info');
      } else if (self.waterTabId) {
        try {
          chrome.tabs.sendMessage(self.waterTabId, { action: 'goBack' }).catch(function () {});
        } catch (_) {}
      } else {
        try {
          var tabs0 = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' });
          if (tabs0 && tabs0[0]) {
            chrome.tabs.sendMessage(tabs0[0].id, { action: 'goBack' }).catch(function () {});
          }
        } catch (_) {}
      }

      // ★ 等待 tab 回到“搜索页”且该页笔记已渲染（countSearchNotes>0）才继续，
      //   避免在刚 reload / 还没渲染的搜索页上立刻开下一篇 → “未定位到笔记”
      var tabId = self.waterTabId || null;
      var reloaded = false;
      var backStart = Date.now();
      var deadline = backStart + 15000;
      var ready = false;
      while (Date.now() < deadline) {
        var curl = '';
        if (tabId) { try { curl = (await chrome.tabs.get(tabId)).url || ''; } catch (_) {} }
        else {
          var q = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] }).catch(function () { return []; });
          if (q && q[0]) { tabId = q[0].id; curl = (q[0].url || ''); }
        }
        if (tabId && /\/search_result/.test(curl)) {
          // 已在搜索页：确认笔记卡片已渲染
          var cnt = await chrome.tabs.sendMessage(tabId, { action: 'countSearchNotes' }).catch(function () { return { count: 0 }; });
          if (cnt && cnt.count > 0) { ready = true; break; }
        } else if (!reloaded && tabId && Date.now() - backStart > 7000) {
          // ★ 先给「浏览器返回」7 秒：返回是 SPA 跳转，头一两秒人还在笔记页是正常的。
          //   以前第一轮轮询就强刷搜索页，等于每开一篇就把结果页重载一次（排序丢了、顺序也变了），
          //   后面的笔记全对不上——这才是「页面明明有、却说没有这篇」的主凶（2026-11-05 实锤）。
          reloaded = true;
          try { chrome.tabs.update(tabId, { url: '/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_search_result_note' }); } catch (_) {}
        }
        await sleep(500);
      }
      if (!ready) botLog('  ⏳ 返回列表确认超时（搜索页未就绪），仍继续...', 'warn');

      // 等待弹窗列表仍有数据 + 小缓冲
      try { await waitElement('#noteList .note-item', 8000); } catch (_) {}
      await sleep(1000);
    },

    /* ─── 翻下一屏（方案A）：当前屏可见笔记处理完后调用。
     * 1) 通知 background 在搜索结果页再往下滚动一屏，重新提取“当前可见快照”，替换 searchResults（列表永远=可见）。
     * 2) 强制 popup 重渲染列表，让后续打开/续开基于新一批可见卡片。
     * 返回 true=还有新的一屏可继续处理；false=已到底/失败，停止推进。 */
    _advanceScreen: async function () {
      var self = this;
      await self._checkStop();
      botLog('  📄 当前屏已处理完，滚动加载下一屏（保持列表与页面一致）...', 'info');
      var resp = null;
      try { resp = await sendMsg('advanceResults'); } catch (_) { resp = null; }
      if (!resp || !resp.ok || resp.hasMore === false) {
        botLog(resp && resp.ok && resp.hasMore === false ? '  🏁 已滚动到搜索底部，没有更多笔记' : '  ⏭ 滚动加载下一屏失败/无更多，结束本次', 'warn');
        return false;
      }
      // 强制 popup 重渲染：让 #noteList 刷新为当前可见快照（resultsRendered 复位后再走一遍 refreshStatus）
      if (window.AutoWaterApp && typeof window.AutoWaterApp.forceRerender === 'function') {
        try { await window.AutoWaterApp.forceRerender(); } catch (_) {}
      }
      await sleep(800);
      return true;
    },

    /* ─── 搜队列里的一项＝「这个词 × 这一类」：走前台入口精确搜，不顺延到别的词 ───
     *   成功 → note-item 数组；失败 → null，并把原因写进 self._qErr = { kind:'drop'|'hold', msg }
     *   drop＝配置表里已经没有这一格了（没勾这类/词被停用）→ 该丢掉；
     *   hold＝搜索没起来/超时 → 记欠账，下次接着跑 */
    _doSearchRound: async function (item) {
      var self = this;
      await self._checkStop();
      self._qErr = null;
      if (!item || !item.k) { self._qErr = { kind: 'hold', msg: '队列项不完整（缺关键词）' }; return null; }
      var card = self._qTypeName(item.scenario);
      // ★ 盯的账号（👤 高V/竞对）：进他的个人主页扒最近的笔记——盯人走主页，不是拿名字去搜
      if (item.acct) {
        if (typeof window._useAcct !== 'function') { self._qErr = { kind: 'hold', msg: '前台入口未就绪（重开弹窗再试）' }; return null; }
        var lbl = item.label || item.k;
        botLog('👤 进「' + lbl + '」的主页，扒 ' + card + '（盯人走主页，不搜名字）...', 'info');
        var a = null;
        var at0 = Date.now();
        try { a = await window._useAcct(item.k, item.scenario, item.label || ''); } catch (e) { a = { ok: false, error: (e && e.message) || String(e) }; }
        if (!a || !a.ok) {
          var aem = (a && a.error) || '主页没打开';
          self._qErr = /取消盯|已不在/.test(aem) ? { kind: 'drop', msg: aem } : { kind: 'hold', msg: aem };
          return null;
        }
        return await self._awaitSearchResults(item, at0);
      }
      if (typeof window._useKw !== 'function') { self._qErr = { kind: 'hold', msg: '前台搜索入口未就绪（重开弹窗再试）' }; return null; }
      // 词在启用列表里的下标：与 searchNotes 读的是同一份 auto_water_config.keywords（词池＝唯一真源）
      var words = [];
      try { words = await drainSyncEnabledKeywords(); } catch (_) {}
      var idx = words.indexOf(item.k);
      if (idx < 0) { self._qErr = { kind: 'drop', msg: '「' + item.k + '」已不在启用词里（被停用/移除了）' }; return null; }
      botLog('🔍 搜「' + item.k + '」的 ' + card + (item.passLabel ? ' · ' + item.passLabel : '') +
        '（只跑这一搜，不顺延到别的词/别的筛选）...', 'info');
      var r = null;
      var t0 = Date.now();
      try { r = await window._useKw(idx, item.scenario, item.passId); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
      if (!r || !r.ok) {
        var em = (r && r.error) || '搜索没起来';
        // ⚙️ 配置表已经不含这一格／城市没设（这类根本搜不了）→ 「改表＝改队列」，直接丢；其余（网络/超时）留欠账
        self._qErr = /没勾|不在启用词|还没设城市/.test(em) ? { kind: 'drop', msg: em } : { kind: 'hold', msg: em };
        return null;
      }
      return await self._awaitSearchResults(item, t0);
    },

    /* 点完搜索 → 等这一轮搜索「真跑完」→ 核对界面名单确实是这一轮的结果 → 返回笔记列表
       等多久按本词有几个搜索动作放宽；超时或名单对不上都返回 null（这一项记欠账，不硬跑） */
    _awaitSearchResults: async function (item, startedBefore) {
      var self = this;
      await self._checkStop();
      item = item || {};
      var wantKw = (!item.acct && item.k) ? String(item.k) : '';
      var t0 = Number(startedBefore) || Date.now();
      var planTotal = 1;
      try {
        var _st = await new Promise(function (res) { chrome.storage.local.get('auto_water_state', res); });
        planTotal = Number(((_st['auto_water_state'] || {}).searchState || {}).planTotal) || 1;
      } catch (_) {}
      /* ★ 等的是「后台把这一轮搜完」，不是「面板亮没亮」：面板会沿用上一次的状态，等它等于白等。
         换词 + 核词 + 点排序都要时间，BASE 给到 60 秒；同一个词的多个搜索动作再加。 */
      var searchWaitMs = 60000 + 30000 * (Math.max(1, planTotal) - 1);
      if (planTotal > 1) botLog('  → 本词 ' + planTotal + ' 个搜索动作各搜一遍（等结果上限 ' + Math.round(searchWaitMs / 1000) + 's）', 'info');
      botLog('  → 等这一轮搜索真跑完（最多 ' + Math.round(searchWaitMs / 1000) + ' 秒）…', 'info');

      var st = null;
      var lastSs = null;
      var deadline = Date.now() + searchWaitMs;
      while (Date.now() < deadline) {
        await self._checkStop();
        st = null;
        try {
          var raw = await new Promise(function (res) { chrome.storage.local.get('auto_water_state', res); });
          st = raw['auto_water_state'] || null;
        } catch (_) {}
        if (st && !st.error) {
          lastSs = st.searchState || null;
          /* ★ 这一轮一跑完就收手——不再为「词对不上」死等到超时；词不对当场说清两个词 */
          if (_searchDoneThisRound(st.searchState, t0)) {
            var _gotKw = String((st.searchState || {}).currentKeyword || '');
            if (wantKw && _gotKw && _gotKw !== wantKw) {
              var _mm = '这一行要搜「' + wantKw + '」，后台实际跑的是「' + _gotKw + '」——对不上，先不跑';
              botLog('🔴 ' + _mm, 'error');
              self._qErr = { kind: 'hold', msg: _mm };
              return null;
            }
            break;
          }
        }
        st = null;
        await sleep(700);
      }
      if (!st) {
        /* 日志要跟页面对得上：把后台最后报的词/进度、以及小红书页现在的网址一起带出来 */
        var _info = '';
        try {
          if (lastSs) {
            _info = ' · 后台词「' + (lastSs.currentKeyword || '—') + '」第 ' +
              ((Number(lastSs.planIdx) || 0) + 1) + '/' + (Number(lastSs.planTotal) || 1) + ' 搜' +
              (lastSs.searching ? '·还在搜' : '·已跑完');
          }
        } catch (_) {}
        try {
          var _tabs = await new Promise(function (res) { chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' }, res); });
          if (_tabs && _tabs[0] && _tabs[0].url) _info += ' · 页面：' + String(_tabs[0].url).slice(0, 120);
        } catch (_) {}
        var tmo = '搜索超时（' + Math.round(searchWaitMs / 1000) + 's）' + _info;
        botLog('❌ ' + tmo + '，这一项先不算跑过', 'error');
        self._qErr = { kind: 'hold', msg: tmo };
        return null;
      }

      var ss2 = st.searchState || {};
      var wantIds = (ss2.foundNotes || []).map(function (n) { return String((n && n.noteId) || ''); }).filter(Boolean);
      if (!wantIds.length) {
        var _pe = Number(ss2.pageErrors) || 0, _po = Number(ss2.pageOk) || 0;
        /* 搜了但一篇没出来、而且有错误 → 当没跑成，留欠账；页面正常只是真没结果 → 这一项算跑完（0 篇） */
        if (_pe > 0 && _po === 0) {
          var _bad0 = '这一轮搜索没成功（换词/排序没过关），等下一轮再跑';
          botLog('⚠️ ' + _bad0, 'warn');
          self._qErr = { kind: 'hold', msg: _bad0 };
          return null;
        }
        botLog('  ⚠️ 这一轮没搜到笔记（0 篇）', 'warn');
        return [];
      }
      try {
        await waitElement('#noteList .note-item', 15000);
        var items = $$('#noteList .note-item');
        var domIds = items.map(function (li) { return String(li.dataset.noteId || ''); }).filter(Boolean);
        var hit = _listStateOverlap(domIds, wantIds);
        /* ★ 界面上这串名单必须和这一轮搜出来的结果对得上；对不上就整项不跑（不再拿旧名单去点新页面） */
        if (wantIds.length && (!domIds.length || hit === 0)) {
          var bad = '这一轮的名单和搜索结果对不上（界面 ' + domIds.length + ' 篇 / 结果 ' + wantIds.length + ' 篇），先不跑，等下一轮';
          botLog('🔴 ' + bad, 'error');
          self._qErr = { kind: 'hold', msg: bad };
          return null;
        }
        var _titles = items.slice(0, 3).map(function (n) {
          var a = n.querySelector('.note-title a');
          return ((a ? a.textContent : '') || '').trim().slice(0, 16) || '(无标题)';
        });
        botLog('  ✅ 搜索完成，这一轮名单 ' + items.length + ' 篇（已核对对上）| 前3篇：' + _titles.join(' / '), 'success');
        botLog('  → 等待搜索结果页稳定（2 秒）...', 'info');
        await sleep(2000);
        return items;
      } catch (e) {
        botLog('🔴 这一轮的结果没在页面上出现，先不跑', 'error');
        self._qErr = { kind: 'hold', msg: '搜索结果没渲染出来' };
        return null;
      }
    },

    /* ─── 统一打开笔记（原冷启动"点列表按钮"与循环计划"openNote 直连"合并成这一条） ───
     * 都走 background 的 openNote（content 侧按标题定位 + rawLinkIndex 兜底），差别只在两个开关：
     *   opts.force=true      → 置一次性标志 __forceRescan，重新分析时无视"已有我的评论"拦截（追涨复核专用）
     *   opts.recordOpened=true → 打开成功写进 opened_notes（「已灌水清单」里能看到；口径「全部未灌过」靠 watered 标记与队列标跳过）
     */
    _openNote: async function (note, opts) {
      opts = opts || {};
      // 每篇重新认人：默认还是队列这一格的口径，popup 判出大V/竞对后会在 window.__noteReview 里改
      this._noteScenario = this._curScenario || '';
      this._noteReview = null;
      /* 上一篇判出的大V/竞对不能留给下一篇：每开一篇先把口径和结论清回这一格原来的玩法 */
      try { window.__acqCurScenario = this._curScenario || ''; window.__noteReview = null; } catch (_) {}
      try {
        // 🛡 账号安全：打开笔记＝总账「打开浏览」一笔；被拦下 → 不开（上层据 _guardStop 收队记欠账）
        if (typeof AccountGuard !== 'undefined') {
          var _g = await AccountGuard.decide('open', 1);
          if (!_g.ok) {
            this._guardStop = true;
            botLog('  🛡 停止打开：' + _g.text, 'warn');
            return false;
          }
        }
        if (opts.force) window.__forceRescan = true;
        /* ★ 等足 60 秒：打开笔记内部要「点卡片 → 等详情页就绪 → 没就绪再点两次」，最坏 50 多秒；
           以前只等 10 秒，慢一点就被判失败，随后又去「返回列表」跟它抢页面 → 一篇都开不进去 */
        var resp = await sendMsg('openNote', { note: note }, 60000);
        if (resp && resp.ok) {
          try { if (typeof AccountGuard !== 'undefined') await AccountGuard.spend('open', 1); } catch (_) {}
          botLog('  ✅ 笔记已打开（' + (resp.ready ? '详情页就绪' : '就绪超时，仍尝试扫描') + '）', 'success');
          if (opts.recordOpened && note && note.url && window.saveOpenedNoteUrl) {
            try { await window.saveOpenedNoteUrl(note.url); } catch (_) {}
          }
          // ★ 跑法表：find==='commenters' 的口径（最新/TOP/求助/竞对/高V）都要扫评论区找商机；
          //   只有「本地」是评完笔记本身就走，省掉 15~90s 的 AI 扫描。
          var pbOpen = (typeof drainPlaybookOf === 'function') ? drainPlaybookOf(self._curScenario) : null;
          if (!pbOpen || pbOpen.find === 'commenters') {
            if (window.refreshCommentAssistant) {
              try { window.refreshCommentAssistant(); } catch (_) {}
            }
          } else {
            botLog('  ' + pbOpen.icon + ' 跑法「' + pbOpen.name + '」：只评笔记本身，不扫评论区', 'info');
          }
          return true;
        }
        // ★ 定位失败（CTRL+F 未命中/脚本不可用）与真报错分开记：前者是"跳过"，后者是"失败"
        var skipped = !!(resp && resp.skipped);
        botLog('  ' + (skipped ? '⏭' : '❌') + ' 打开失败/跳过：' + ((resp && resp.error) || '未知原因'), skipped ? 'warn' : 'error');
        return false;
      } catch (e) {
        var _em = (e && e.message) || String(e);
        botLog('  ⚠️ 打开异常：' + _em + (/超时|无响应/.test(_em) ? '（页面脚本没回话——把打开的小红书页面刷一下再跑，或点一次扩展「重新加载」）' : ''), 'warn');
        return false;
      }
    },

    /* ─── 取某篇笔记的实时信息：优先从当前列表查 searchResults 原始对象（带 rawLinkIndex 等页面定位信息），
     * 查不到再退回列表 DOM 的标题/链接（页面重绘/不在本批时不至于拿不到标题） ─── */
    _noteFromList: function (noteOrId) {
      var nid = (typeof noteOrId === 'string')
        ? noteOrId
        : ((noteOrId && noteOrId.dataset && noteOrId.dataset.noteId) || (noteOrId && noteOrId.noteId) || '');
      var n = null;
      try {
        if (window.AutoWaterApp && window.AutoWaterApp.getNoteById) n = window.AutoWaterApp.getNoteById(nid);
      } catch (_) {}
      if (n) return n;
      var li = null;
      try {
        li = nid ? document.querySelector('#noteList .note-item[data-note-id="' + String(nid).replace(/["\\]/g, '') + '"]') : null;
      } catch (_) {}
      var a = li ? li.querySelector('.note-title a') : null;
      return {
        noteId: nid,
        url: a ? (a.getAttribute('href') || '') : '',
        title: a ? (a.textContent || '').trim() : '',
      };
    },

    /* ─── 给内容脚本发消息（带超时兜底）：超时/无响应都 reject，调用方各自收拾 ─── */
    _tabSend: function (tabId, msg, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var done = false;
        var t = setTimeout(function () {
          if (done) return;
          done = true;
          reject(new Error('页面无响应(' + Math.round((timeoutMs || 30000) / 1000) + 's)'));
        }, timeoutMs || 30000);
        try {
          chrome.tabs.sendMessage(tabId, msg, function (resp) {
            if (done) return;
            done = true;
            clearTimeout(t);
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (!resp) reject(new Error('页面无响应'));
            else resolve(resp);
          });
        } catch (e) {
          if (!done) { done = true; clearTimeout(t); reject(e); }
        }
      });
    },

    /* ─── 页面脚本还在不在：不在就补装一份（扩展重载、整页刷新会把上一份冲掉）。
       返回 true＝页面这头确实能回话 ─── */
    _ensureContentScript: async function (tabId) {
      var ping = async function () {
        try {
          var r = await chrome.tabs.sendMessage(tabId, { action: 'checkSearchReady' });
          return !!r;
        } catch (_) { return false; }
      };
      if (await ping()) return true;
      try { await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] }); } catch (_) {}
      await sleep(900);
      return await ping();
    },

    /* ─── 「我的账号名」（设置里维护）：防把自己刚发的评论当成商机再回一遍。
     *   读一次缓存 60s，不每条评论都问一次 background。 ─── */
    _myNames: async function () {
      var self = this;
      if (self._myNamesCache && (Date.now() - self._myNamesCache.at) < 60000) return self._myNamesCache.list;
      var list = [];
      try { if (typeof loadMyAccountNames === 'function') list = await loadMyAccountNames(); } catch (_) {}
      self._myNamesCache = { at: Date.now(), list: list };
      return list;
    },

    /* ─── 一级评论：按跑法表在「笔记本身」下发一条评论（最新=抢位 / TOP=活水 / 本地=地域信任 /
     *   求助=作者侧 / 高V=借势）。评论内容走截流话术库（口径＝当前类型），属地用扫描配置里的城市兜底。
     *   返回 { count, reason }：1=发出去了，0=没发出去（reason 里带原因） ─── */
    _postNoteComment: async function (noteTitle, noteId, pb, opts) {
      var self = this;
      opts = opts || {};
      var tId = self.waterTabId || 0;
      if (!tId) return { count: 0, reason: 'failed', error: '没绑定灌水标签页' };
      /* 2026-11-05：点开笔记后整页刷新会把页面脚本冲掉，评论就发不出去（报「Receiving end does not exist」）。
         发之前先确页面这头能回话，不在就补装一份。 */
      if (!(await self._ensureContentScript(tId))) {
        botLog('  ⚠️ 详情页脚本没接上（补装后仍没回话），这条评论可能发不出去', 'warn');
      }
      // 整篇改过的口径（大V/竞对认人）优先：评论生成、属地、话术都按这个场景走
      var sc = opts.scenario || self._noteScenario || self._curScenario || 'latest';
      var label = (typeof drainPlaybookLabel === 'function') ? drainPlaybookLabel(sc) : sc;

      // ① 等详情页就绪（评论区/回复框出现才动手，最多 12s；超时也试一把，别把偶发慢页当失败）
      var deadline = Date.now() + 12000;
      var ready = false;
      while (Date.now() < deadline) {
        await self._checkStop();
        try {
          var rr = await self._tabSend(tId, { action: 'checkNoteReady' }, 8000);
          if (rr && rr.ready) { ready = true; break; }
        } catch (_) {}
        await sleep(600);
      }
      if (!ready) botLog('  ⏳ 详情页就绪等超时（12s），仍尝试发一级评论...', 'warn');

      // ② 生成评论（background 调 AI；属地/区域没传就吃扫描配置里的城市；
      //    正文/作者一起喂给 AI——「造梗」要接住正文里的具体点，「不适合就不评」也得看正文）
      var cfgCity = '';
      try { var c = await drainGetScanCfg(); cfgCity = String(((c || {}).city) || '').trim(); } catch (_) {}
      var nMeta = {};
      try { if (typeof drainReadTabMetrics === 'function') nMeta = (await drainReadTabMetrics(tId)) || {}; } catch (_) {}
      /* 2026-11-10：判这篇的那次 AI 请求已经顺手写好评论了，这里直接用，不再单独烧一次；
         没带回来（AI 没回来/老包）才退回单独生成。 */
      var pre = (opts && opts.noteReview) || null;
      var preComment = '';
      if (pre && !pre.fallback && (pre.verdict === 'grab' || pre.verdict === 'worth')) {
        preComment = String(pre.comment || '').trim();
        if (preComment && typeof drainLooksMetaText === 'function' && drainLooksMetaText(preComment)) preComment = '';
      }
      var g = null;
      try {
        g = preComment
          ? { ok: true, comment: preComment }
          : await sendMsg('drainComment', {
            scenario: sc, noteTitle: noteTitle || nMeta.title || '', noteContent: nMeta.content || '', noteAuthor: nMeta.author || '',
            keyword: self._curKw || '', city: cfgCity, region: '',
            painText: '',
            /* 笔记类型表判出的动作 / 提店档（2026-11-12）：只在这篇真的判出来了才传，没传＝老口径 */
            store: (opts && opts.store) || '',
            act: (opts && opts.act) || '',
          }, 60000);
        if (preComment) botLog('  💬 用「判这篇」同一次请求写好的那句评论（省一次 AI）', 'info');
      } catch (e) { g = { ok: false, error: (e && e.message) || String(e) }; }
      // ★ 不适合就不评：AI 自己判断这篇（或博主口吻）不适合露面评论 → 跳过，别硬发一条尴尬评论
      if (g && g.ok && g.skip) {
        botLog('  ⏭ AI 判断这篇不适合评论（' + (g.reason || '口吻/内容不合适') + '），跳过一级评论', 'info');
        return { count: 0, reason: 'skip', error: g.reason || '' };
      }
      var text = String(((g || {}).comment) || '').trim();
      if (!g || !g.ok || !text) {
        var ge = (g && g.error) || 'AI 没生成出评论';
        botLog('  ❌ 一级评论生成失败：' + ge, 'warn');
        return { count: 0, reason: 'failed', error: ge };
      }

      // 🛡 账号安全：评论＝总账「评论+回复」一笔；被拦下 → 这条不发（上层收队记欠账）
      try {
        if (typeof AccountGuard !== 'undefined') {
          var _gc = await AccountGuard.decide('comment', 1);
          if (!_gc.ok) {
            self._guardStop = true;
            botLog('  🛡 一级评论被拦下：' + _gc.text, 'warn');
            return { count: 0, reason: 'guard', error: _gc.text };
          }
        }
      } catch (_) {}

      // ③ 发到笔记评论区
      await self._cqLive({
        kw: self._curKw, scenario: sc, title: noteTitle,
        idx: (self._cqNoteIdx || 0), total: (self._cqNoteTotal || 0),
        author: '笔记作者', ci: 0, cTotal: 1, sent: 0,
      });
      var res = null;
      var _sendComment = async function () {
        return await self._tabSend(tId, {
          action: 'sendNoteComment', text: text, title: noteTitle || '', noteId: noteId || '',
        }, 60000);
      };
      try { res = await _sendComment(); }
      catch (e) { res = { success: false, error: (e && e.message) || String(e) }; }
      /* 页面脚本掉线（整页刷新/扩展重载）→ 补装一份再发一次，别把这一条白扔掉 */
      if (!res || !res.success) {
        var _re0 = String((res && res.error) || '');
        if (/Receiving end|Could not establish|message port|Extension context|页面无响应|内容脚本/i.test(_re0)) {
          botLog('  🔁 详情页脚本掉线（' + (_re0 || '没回话') + '）→ 补装后重发一次', 'warn');
          try { await chrome.scripting.executeScript({ target: { tabId: tId }, files: ['content.js'] }); } catch (_) {}
          await sleep(1200);
          try { res = await _sendComment(); }
          catch (e2) { res = { success: false, error: (e2 && e2.message) || String(e2) }; }
        }
      }
      if (res && res.success) {
        try { if (typeof AccountGuard !== 'undefined') await AccountGuard.spend('comment', 1); } catch (_) {}
        botLog('  ✅ 已发一级评论（' + label + '）：' + text.slice(0, 60) + (text.length > 60 ? '…' : ''), 'success');
        return { count: 1, reason: 'sent', comment: text };
      }
      var re = (res && res.error) || '发送没成功';
      botLog('  ⚠️ 一级评论发送失败：' + re, 'warn');
      return { count: 0, reason: 'failed', error: re };
    },

    /* ─── 只收人不回复 —— 把评论区里 AI 判有商机的人收进获客清单（待触达），一条都不发。
     *   竞对（埋伏）、最新/TOP/高V（交完自己那条一级评论后顺带扫）都走这里。
     *   不传 dmStatus ⇒ 落「待触达」，等客户自己去发第一条私信。
     *   ncCount = 本篇一级评论的成绩（0/1），并入返回值给上层统计口径用。 ─── */
    _collectProspects: async function (noteTitle, sendBtns, ncCount) {
      var self = this;
      var myNames = await self._myNames();
      var found = 0;
      var toProfile = [];
      for (var i = 0; i < sendBtns.length; i++) {
        await self._checkStop();
        var b = sendBtns[i];
        if (b.dataset.lurkDone) continue;   // 同一趟里同一按钮不打两次
        b.dataset.lurkDone = '1';
        var bAuthor = b.dataset.author || '未知用户';
        // ★ 防把自己收进清单：昵称命中「我的账号名」的直接跳过
        if (myNames.length && typeof _normMatch === 'function' && myNames.indexOf(_normMatch(bAuthor)) >= 0) {
          botLog('  ⏭ @' + bAuthor + ' 是自己（我的账号名），跳过', 'info');
          continue;
        }
        var uidM = (b.dataset.userlink || '').match(/\/user\/(?:profile\/)?([\w-]+)/);
        var curNid = window._scanCurNoteId || '';
        var person = {
          userId: uidM ? uidM[1] : '',
          nickname: bAuthor,
          source: {
            noteTitle: noteTitle || '',
            noteUrl: curNid ? ('https://www.xiaohongshu.com/explore/' + curNid) : '',
            comment: b.dataset.original || '',
            userUrl: b.dataset.userlink || '',
            scenario: self._curScenario || '',
          },
          origin: '评论',
        };
        try {
          var addResp = await sendMsg('addProspect', person, 8000);
          if (addResp && addResp.ok) {
            found++;
            botLog('  🕵️ 已收进获客清单：@' + person.nickname + (addResp.added === false ? '（已在清单，已更新）' : '') + '（待私信）', 'success');
            if (addResp.person && addResp.person.id) {
              toProfile.push({ id: addResp.person.id, userId: addResp.person.userId, nickname: addResp.person.nickname, source: addResp.person.source });
            }
          } else {
            botLog('  ⚠️ 收进获客清单失败：@' + person.nickname + ' ' + ((addResp && addResp.error) || ''), 'warn');
          }
        } catch (e) {
          botLog('  ⚠️ 收进获客清单失败：@' + person.nickname + ' ' + ((e && e.message) || e), 'warn');
        }
      }
      // ★ AI 获客画像：异步 + 超时兜底，不阻塞返回列表
      if (toProfile.length > 0) {
        botLog('  🤖 正在为 ' + toProfile.length + ' 个潜伏目标跑 AI 获客画像（后台异步执行）...', 'info');
        var profP = sendMsg('profileProspects', { candidates: toProfile });
        var profTimeout = new Promise(function (res) {
          setTimeout(function () { res({ ok: false, error: 'AI 画像超时(20s)，已跳过' }); }, 20000);
        });
        Promise.race([profP, profTimeout]).then(function (pr) {
          if (pr && pr.ok) botLog('  ✅ AI 获客画像完成：' + ((pr.applied || []).length) + ' 人已打标', 'success');
          else botLog('  ⚠️ AI 获客画像未完成：' + ((pr && pr.error) || '超时/失败'), 'warn');
        }).catch(function (e3) {
          botLog('  ⚠️ AI 获客画像失败：' + (e3 && e3.message ? e3.message : String(e3)), 'warn');
        });
      }
      return { count: ncCount || 0, reason: (ncCount > 0) ? 'sent' : 'lurk', prospects: found };
    },

    /* ─── 等待 AI 分析 + 逐个发送（两个口径共用）；waitWateredEl 传笔记列表项时可监听"列表项已灌水"（逐屏灌水） ───
     * 返回 { count, reason }：reason ∈ watered/empty/timeout/nobtns/sent/failed/lurk/skip */
    _waterCurrentNote: async function (noteTitle, waitWateredEl, noteId) {
      var self = this;
      // ★ 跑法表（按笔记类型的口径分派；sc 为空=老入口，按原样走"评论区找人+回复"）
      var sc = self._curScenario || '';
      var pb = (sc && typeof drainPlaybookOf === 'function') ? drainPlaybookOf(sc) : null;
      // ★ 「玩法配置」里这一玩法的评论策略（2026-11-04）：没配过就跑现网那套（评＋回评、每篇 3 人、收人）
      var plan = null;
      var cfgScan0 = null;
      try {
        if (sc && typeof drainGetScanCfg === 'function' && typeof drainPbPlan === 'function') {
          cfgScan0 = await drainGetScanCfg();
          plan = drainPbPlan(cfgScan0, sc);
        }
      } catch (_) {}
      // ★ 2026-11-05 代码配套自检：配置读出来了、但「评论策略」读不出来，就是新版判断配了旧版读法。
      //   这种错配会把每一篇都悄悄判成「不评笔记、只收人」，一条报错都没有（11-05 那次就是它）。
      //   宁可回落玩法表默认跑法，也要红字喊出来。
      if (plan && (typeof plan.mode !== 'string' || !plan.mode)) {
        botLog('  ❌ 代码没配套：排班配置里读不出「评论策略」（该字段缺失）→ 本篇改按玩法表默认跑法执行，请重新安装执行器', 'warn');
        plan = null;
      }
      var ncCount = 0;   // 「评笔记本身」那一条的成绩（0/1）
      var postNote = pb ? (plan ? (plan.mode === 'both' || plan.mode === 'note') : pb.send !== 'none') : true;
      var replyCommenters = pb ? (plan ? (plan.mode === 'both' || plan.mode === 'reply') : pb.send === 'both') : true;
      var scanCommenters = !pb || pb.find === 'commenters';   // 本地不扫评论区，其余类型都扫
      var collectOn = plan ? plan.collect !== false : true;
      var modeText = plan
        ? (({ note: '只评笔记', both: '评笔记＋回评论区', reply: '只回评论区', people: '只收人' })[plan.mode] || ('未知（' + plan.mode + '）'))
        : (pb ? ('玩法表默认：' + (({ both: '评笔记＋回评论区', none: '只埋伏', reply: '只回评论区' })[pb.send] || pb.send)) : '老入口：评＋回评');
      botLog('  ⚙️ 这篇的评论策略：' + modeText
        + ((plan && Number(plan.cap) >= 1) ? '（每篇最多回 ' + plan.cap + ' 人）' : ''), 'info');

      /* ─── 每篇留痕（2026-11-05）：正文 + 读到的评论 + 本篇怎么决定的 ───
         老板要能回看「这一篇写了什么、评论里都有谁、我为什么没评」，所以每一篇、每一个出口都留痕，不留哑巴分支。 */
      var snap = {
        noteId: noteId || '',
        title: noteTitle || '',
        scenario: sc || '',
        mode: plan ? plan.mode : (pb ? 'pb默认' : '老入口'),
        body: '',
        bodyLen: 0,
        totalComments: 0,
        comments: [],
        hotNames: [],
        readErr: '',
        decide: '',
        reason: '',
        sent: 0,
        noteComment: '',   // 在笔记本身下面发的那一条（老板要回看「评了啥」）
        replies: [],       // 回了评论区的谁、回了什么
        result: '',
        ts: Date.now()
      };
      function snapClip(s, n) {
        s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n) + '…' : s;
      }
      async function readNoteSnapshot() {
        var tId = self.waterTabId || 0;
        if (!tId) snap.readErr = '找不到笔记页面';
        else try {
          var r = await self._tabSend(tId, { action: 'extract' }, 8000);
          if (r && r._notNotePage) snap.readErr = '当前页不是笔记详情页';
          else if (!r) snap.readErr = '页面没回内容';
          else {
            snap.title = r.title || snap.title;
            var body = String(r.description || '');
            snap.bodyLen = body.length;
            snap.body = body.slice(0, 4000);
            var cs = Array.isArray(r.comments) ? r.comments : [];
            snap.totalComments = cs.length;
            snap.comments = cs.slice(0, 10).map(function (c) {
              return {
                a: String((c && c.author) || '用户').slice(0, 24),
                t: String((c && c.content) || '').slice(0, 120),
                l: String((c && c.location) || ''),
                rp: String((c && c.replyTo) || '')
              };
            });
          }
        } catch (e) {
          snap.readErr = (e && e.message) ? e.message : String(e);
        }
        // 正文读不到：退一步拿页面元信息（og:description）补上，至少让老板知道这篇讲什么
        if (!snap.body) {
          try {
            if (tId && typeof drainReadTabMetrics === 'function') {
              var m = await drainReadTabMetrics(tId);
              if (m && m.content) { snap.bodyLen = String(m.content).length; snap.body = String(m.content).slice(0, 4000); }
              if (m && m.title && !snap.title) snap.title = m.title;
            }
          } catch (_) {}
        }
        // 📝 正文摘要（日志里只放前 150 字，全文另存进快照）
        if (snap.body) {
          botLog('  📝 《' + snapClip(snap.title, 30) + '》正文 ' + snap.bodyLen + ' 字：' + snapClip(snap.body, 150), 'info');
        } else {
          botLog('  📝 正文没读到' + (snap.readErr ? '（' + snap.readErr + '）' : '') + '，这篇只能按标题《' + snapClip(snap.title, 30) + '》判断', 'warn');
        }
        // 💬 评论前 10 条（昵称 / 属地 / 40 字；判成有商机的标 🔥）
        var hot = {};
        (snap.hotNames || []).forEach(function (n) { var k = String(n).trim(); if (k) hot[k] = 1; });
        if (snap.comments.length) {
          var hotN = 0;
          botLog('  💬 读到 ' + snap.totalComments + ' 条评论，列前 ' + snap.comments.length + ' 条：', 'info');
          snap.comments.forEach(function (c, i) {
            c.hot = !!hot[String(c.a).trim()];
            if (c.hot) hotN++;
            botLog('     ' + (c.hot ? '🔥 ' : '') + (i + 1) + '. @' + c.a + (c.l ? '（' + c.l + '）' : '') + '：' + snapClip(c.t, 40), c.hot ? 'success' : 'info');
          });
          if (!hotN && snap.hotNames.length) {
            botLog('  ⚠️ 扫出来的人在读到的前 ' + snap.comments.length + ' 条里没对上号（可能更靠后），不影响发送', 'warn');
          }
        } else {
          botLog('  💬 评论区一条都没读到' + (snap.readErr ? '（' + snap.readErr + '）' : '') + '——多半是评论还没加载出来', 'warn');
        }
      }
      // 每个出口都走它：读快照 → 打一行「本篇决定」→ 上报服务端（供网页「这一趟的记录」展开看）
      function finishSnap(res, decide, reason) {
        return (async function () {
          res = res || {};
          await readNoteSnapshot();
          snap.decide = decide || '';
          snap.reason = reason || '';
          snap.sent = res.count || 0;
          snap.result = res.reason || '';
          botLog('  🖊 本篇决定：' + snap.decide + (snap.reason ? '（原因：' + snap.reason + '）' : ''), snap.sent > 0 ? 'success' : 'info');
          try { chrome.runtime.sendMessage({ type: 'ex.notesnap', snap: snap }); } catch (_) {}
          return res;
        })();
      }

      // 🧠 先挖后评（2026-11-08）：不再先评笔记再挖。先等这一篇的「商机挖掘＋笔记结论」回来，
      //   再按结论决定 抢首评 / 评一句 / 回评论区 / 只收人 / 跳过（见下方 decide）。
      botLog('  ⏳ 先等这一篇的商机挖掘＋笔记结论（约 15~90 秒）...期间页面保持轻微划动（防后台节流），AI 完成后自动停止', 'info');
      var nudgeStopped = false;
      var nudgeTimer = setInterval(function () {
        if (nudgeStopped) return;
        // ★ 双引擎：只对绑定的水 tab 划动，绝不碰客服 tab / 其它页面
        var tId = self.waterTabId || 0;
        if (!tId) return;
        try {
          var p = chrome.tabs.sendMessage(tId, { action: 'nudgeScroll' });
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (_) {}
      }, 4000);
      function stopNudge() {
        nudgeStopped = true;
        if (nudgeTimer) { clearInterval(nudgeTimer); nudgeTimer = null; }
      }

      // ★ 本篇开始等信号前：登记归属 + 清零心跳，让"心跳计时"只认这篇的扫描
      _signalNoteId = noteId || '';
      window.__scanLastBeat = 0;

      // ★ 监听 popup 广播的"本篇扫描结束"信号（无商机/失败/评论不足时广播），收到立即结束等待，不再干等 180s 超时
      var aiSignalPromise = new Promise(function (resolve) {
        _aiSignalResolve = resolve;
        _signalNoteId = noteId || '';
        window.addEventListener('xhsAiScanDone', _onAiScanDone);
      });

      // ★ 心跳感知的等待上限（替代固定 180s 干等）：
      //   ① 扫描一直没起来（20s 心跳仍为 0，如 openNote 成功但 popup 根本没进扫描）→ 提前收尾，别再傻等
      //   ② 扫描中途心跳停滞 70s（疑似挂死）→ 提前收尾
      //   ③ 超过绝对上限 180s 一律收尾兜底
      //   （正常扫描 popup 会持续心跳，绝不影响它慢慢分析；真正保底仍是 broadcast/sendbtn 信号）
      var _dlTimer = null;
      var _dlCancel = null;
      var deadlinePromise = new Promise(function (resolve) {
        var _t0 = Date.now();
        _dlTimer = setInterval(function () {
          var _beat = window.__scanLastBeat || 0;
          var _now = Date.now();
          if (_now - _t0 > 180000) { clearInterval(_dlTimer); resolve('timeout'); return; }
          if (_beat === 0 && _now - _t0 > 20000) { clearInterval(_dlTimer); resolve('timeout'); return; }
          if (_beat > 0 && _now - _beat > 70000) { clearInterval(_dlTimer); resolve('timeout'); return; }
        }, 1500);
      });
      _dlCancel = function () { if (_dlTimer) clearInterval(_dlTimer); };

      // ★ 收集所有"可能永远不 settle"的等待臂。竞速分出胜负后，必须主动 cancel 掉其余还没结束的，
      //   否则它们的 MutationObserver / interval 会滞留、跨多篇笔记累积成资源泄漏。
      var sendArm = waitElement('#mainContent .send-btn', 0);
      var wateredArm = waitWateredEl ? waitClass(waitWateredEl, 'watered', 0) : null;
      var _aiSignalInfo = null;   // popup 广播回来的真实原因（code/label），「不评」那行照它写
      var races = [
        sendArm.then(function () { return 'sendbtn'; }),
        aiSignalPromise.then(function (r) { _aiSignalInfo = r; return (r && r.ok) ? 'sendbtn' : 'empty'; }),
        deadlinePromise
      ];
      if (wateredArm) races.push(wateredArm.then(function () { return 'watered'; }));

      var sendWait;
      try {
        sendWait = await Promise.race(races);
      } catch (_) { sendWait = 'timeout'; }
      // ★ 无论谁赢：摘掉信号监听 + 清归属 + cancel 掉其余等待臂（防泄漏），再停划动
      if (_aiSignalResolve) _aiSignalResolve = null;
      _signalNoteId = '';
      window.removeEventListener('xhsAiScanDone', _onAiScanDone);
      try { if (_dlCancel) _dlCancel(); } catch (_) {}
      try { if (sendArm && typeof sendArm.cancel === 'function') sendArm.cancel(); } catch (_) {}
      try { if (wateredArm && typeof wateredArm.cancel === 'function') wateredArm.cancel(); } catch (_) {}
      stopNudge(); // AI 分析结束（成功/失败/超时），停止划动

      if (sendWait === 'watered') {
        botLog('  → 笔记已判定已灌水（已有我的评论），跳过 AI 分析', 'info');
        return await finishSnap({ count: ncCount, reason: ncCount > 0 ? 'sent' : 'watered' }, '不评：这一篇已经有我的评论', '补灌会重复，跳过');
      }

      /* ── 先挖后评：收 popup 带回来的「笔记层结论」，再决定这一篇怎么做 ──
         ① 作者在「👤 盯的账号」名单里（按主页 id 认，认不上再看昵称）→ 整篇改按大V / 竞对口径，
            不管这篇是从哪个玩法搜出来的；
         ② 「刚起来」只认发布时间＋赞＋评论三条（发布时间读不到就不判），
         ③ AI 判值不值得露面；AI 没回来就保留玩法原样，但绝不判抢首评；
         ④ 玩法里配的评论策略是上限：只能更保守，不能越过它。 */
      var review = null;
      try {
        var rv0 = window.__noteReview || null;
        if (rv0 && rv0.verdict && (!noteId || !rv0.noteId || rv0.noteId === noteId)) review = rv0;
      } catch (_) {}
      if (!review && _aiSignalInfo && _aiSignalInfo.noteReview) review = _aiSignalInfo.noteReview;

      var scEff = (review && review.matched) ? review.matched : ((review && review.strategy) || window.__acqCurScenario || sc);
      var pbEff = pb;
      var planEff = plan;
      if (scEff !== sc) {
        try { pbEff = drainPlaybookOf(scEff); } catch (_) {}
        try { planEff = drainPbPlan(cfgScan0, scEff); } catch (_) {}
      }
      /* 笔记类型表（2026-11-12）：这一篇判成哪几类，就按表取动作 / 提店 / 收人。
         渠道排班那套动作只当老包 / 判不出类型时的兜底；判出来了就以表为准。 */
      var _typeMode = (review && review.typeMode) || '';
      if (_typeMode) {
        planEff = Object.assign({}, planEff || {}, {
          mode: _typeMode === 'rate' ? (review.typeAct || 'note') : (_typeMode === 'silent' ? 'people' : ''),
          store: (_typeMode === 'rate' && review.typeStore) ? review.typeStore : ((planEff && planEff.store) || 'none'),
          collect: _typeMode === 'block' ? false : (review.typeCollect !== false),
        });
        botLog('  📝 按笔记类型表跑：' + (review.mainType || '普通帖')
          + (_typeMode === 'rate' ? ('｜' + ({ note: '只评笔记', both: '评笔记＋回评论区', reply: '只回评论区', people: '只收人' }[planEff.mode] || planEff.mode)
            + '｜提店「' + ({ none: '不提', identity: '只提身份', case: '讲案例', store: '可报店名' }[planEff.store] || planEff.store) + '」'
            + '｜' + (planEff.collect ? '收人' : '不收人'))
            : (_typeMode === 'silent' ? '｜不留言 · 只收人' : '｜完全不碰')), 'info');
      }
      self._noteScenario = scEff;
      self._noteReview = review;
      snap.scenario = scEff || '';
      snap.mode = planEff ? planEff.mode : (pbEff ? 'pb默认' : '老入口');
      /* 换了口径（或按类型表改过动作），回不回评论区 / 收不收人也要重算 */
      replyCommenters = planEff ? (planEff.mode === 'both' || planEff.mode === 'reply') : (pbEff ? pbEff.send === 'both' : true);
      collectOn = planEff ? planEff.collect !== false : true;
      if (review && review.strategy && !review.matched && scEff !== sc) {
        var _srcPbName = ((typeof drainPlaybookOf === 'function' && (drainPlaybookOf(sc) || {}).name) || sc);
        var _effPbName = ((typeof drainPlaybookOf === 'function' && (drainPlaybookOf(scEff) || {}).name) || scEff);
        botLog('  🔀 这篇按「' + _effPbName + '」的口径走（次数仍记在「' + _srcPbName + '」）', 'info');
      }

      var sendBtns = (sendWait === 'sendbtn') ? $$('#mainContent .send-btn:not(.watered)') : [];
      var hasProsp = !!(sendBtns && sendBtns.length);
      var fresh = !!(review && review.fresh);
      var fallback = !review || review.fallback !== false;
      var dec = null;
      try {
        dec = drainDecideNote({
          matched: (review && review.matched) || '',
          verdict: (review && review.verdict) || '',
          fresh: fresh,
          mode: planEff ? planEff.mode : '',
          typeMode: _typeMode,
          hasProspects: hasProsp,
          collect: planEff ? planEff.collect !== false : true,
          fallback: fallback,
          blockReason: (review && (review.block || review.reason)) || '',
        });
      } catch (_) {}
      if (!dec) {
        var _allowNote = planEff ? (planEff.mode === 'note' || planEff.mode === 'both') : (pbEff ? pbEff.send !== 'none' : true);
        dec = { action: _allowNote ? 'comment' : (hasProsp ? 'collect' : 'skip'), text: _allowNote ? '按原玩法评一句' : '只收人', reason: '结论没算出来，按玩法原样处理' };
      }
      var reviewText = review
        ? ('作者=' + ((review.matched === 'highv') ? '大V' : (review.matched === 'rival' ? '竞对' : '普通'))
          + ' · ' + (review.fresh ? '刚起来' : '不算刚起来')
          + ' · ' + ({ grab: '值得抢首评', worth: '可以评一句', none: '不值得评', blocked: '不适合露面' }[review.verdict] || (review.verdict || '结论没回来')))
        : '没有笔记结论（按玩法原样）';
      snap.noteReview = {
        matched: (review && review.matched) || '',
        strategy: (review && review.strategy) || '',
        noteType: (review && review.noteType) || '',
        noteTypes: (review && review.noteTypes) || [],
        mainType: (review && review.mainType) || '',
        typeMode: _typeMode,
        typeAct: (review && review.typeAct) || '',
        typeStore: (review && review.typeStore) || '',
        verdict: (review && review.verdict) || '',
        fresh: fresh,
        freshWhy: (review && review.freshWhy) || '',
        reason: (review && review.reason) || '',
        fallback: fallback,
        action: dec.action,
        text: dec.text,
        why: dec.reason || '',
      };
      botLog('  🧠 笔记结论：' + reviewText, 'info');
      botLog('  🧭 本篇怎么做：' + dec.text + (dec.reason ? '（' + dec.reason + '）' : ''), 'info');

      /* ── 评笔记：抢首评 / 评一句 / 大V借势（同一入口，按结论只发一次）── */
      if (dec.action === 'grab' || dec.action === 'comment') {
        if (pbEff) botLog('  ' + pbEff.icon + ' 跑法「' + pbEff.name + '」：' + pbEff.tip, 'info');
        var ncRes = await self._postNoteComment(noteTitle, noteId, pbEff, {
          scenario: scEff, noteReview: review,
          /* 判出类型了就按类型表的提店档 / 动作走；退回单独生成评论时也照这档 */
          store: (review && _typeMode === 'rate' && review.typeStore) || '',
          act: (review && _typeMode === 'rate' && review.typeAct) || '',
        });
        ncCount = (ncRes && ncRes.count) || 0;
        if (ncRes && ncRes.comment) snap.noteComment = String(ncRes.comment).slice(0, 200);
        // 🛡 总账拦下：直接收队
        if (ncRes && ncRes.reason === 'guard') {
          return await finishSnap({ count: 0, reason: 'guard', error: ncRes.error || '' }, '不评：这一篇先停手', '账号总账拦下：' + (ncRes.error || '账号安全'));
        }
        if (!ncCount) botLog('  ⏭ 笔记评论没发出去（' + ((ncRes && (ncRes.error || ncRes.reason)) || '未知') + '）', 'warn');
      } else if (pbEff && planEff && planEff.mode === 'reply') {
        botLog('  ' + pbEff.icon + ' 跑法「' + pbEff.name + '」：这一趟只回评论区，不在笔记下面评', 'info');
      }

      if (dec.action === 'skip') {
        return await finishSnap(
          { count: ncCount, reason: ncCount > 0 ? 'sent' : 'skip' },
          ncCount > 0 ? '只在笔记下评了 1 条，评论区不动' : ('不评：' + (dec.text || '这篇不适合')),
          dec.reason || reviewText
        );
      }
      if (!hasProsp) {
        var emptyWhy = sendWait === 'sendbtn'
          ? '扫描完了，页面没有可发送的评论'
          : (sendWait === 'empty'
            ? ((_aiSignalInfo && _aiSignalInfo.label) || 'AI 扫描结束了，但没带原因')
            : '180 秒没等到 AI 分析结果（页面可能卡住、或根本没进扫描）');
        botLog('  → 这篇评论区没可发的人：' + emptyWhy, 'info');
        return await finishSnap(
          { count: ncCount, reason: ncCount > 0 ? 'sent' : (sendWait === 'empty' ? 'empty' : (sendWait === 'timeout' ? 'timeout' : 'nobtns')) },
          ncCount > 0 ? '只在笔记下评了 1 条，评论区没回人' : '不评：没找到值得评论的人',
          emptyWhy
        );
      }
      // ★ 记下「本篇被判成有商机的人」，供快照里给对应评论标 🔥（收人流程会把按钮点掉，所以先记名字）
      try {
        snap.hotNames = sendBtns.map(function (b) { return String((b.dataset && b.dataset.author) || ''); }).filter(Boolean);
      } catch (_) {}
      // ★ 不逐条回评论区（只评笔记 / 只收人 / 竞对 / 大V）：扫出来的人按「收不收人」决定进不进清单
      if (dec.action === 'collect' || !replyCommenters) {
        var pbNone = !!(planEff ? planEff.mode === 'people' : (pbEff && pbEff.send === 'none'));
        var collectEff = planEff ? planEff.collect !== false : collectOn;
        // 大V笔记：老口径不主动捞评论区的人（只回接我话的人，popup 已按 replyTo 筛过）；
        // 按笔记类型表跑时，收不收人以表里那一格为准（2026-11-12）
        if (scEff === 'highv' && !_typeMode) {
          return await finishSnap(
            { count: ncCount, reason: ncCount > 0 ? 'sent' : 'lurk' },
            ncCount > 0 ? '大V写法：只评了笔记，不主动捞评论区的人' : '不评：大V这篇没露面',
            reviewText
          );
        }
        if (!collectEff) {
          botLog('  ⏭ 这个玩法配的是「不收人」：扫到的 ' + sendBtns.length + ' 个人不写入清单', 'info');
          return await finishSnap({ count: ncCount, reason: ncCount > 0 ? 'sent' : 'lurk' }, '不评：这个玩法配的是「不收人」', '扫到 ' + sendBtns.length + ' 个人，配置决定一个都不收');
        }
        botLog('  ' + (pbNone ? '🕵️ 发现 ' : '📥 发现 ') + sendBtns.length + ' 个有商机的评论者（'
          + (pbNone ? '只埋伏不评论' : '只收进获客清单，不逐条回复') + '）', 'success');
        return await finishSnap(
          await self._collectProspects(noteTitle, sendBtns, ncCount),
          pbNone ? '不评：只埋伏，把 ' + sendBtns.length + ' 个人收进清单' : '不评：只收人，不逐条回复',
          '评论策略是「' + (planEff ? planEff.mode : modeText) + '」'
        );
      }
      botLog('  💬 发现 ' + sendBtns.length + ' 个潜在顾客', 'success');

      var sentCount = 0;
      var capHit = false;
      var toProfile = []; // ★ 收集本篇新入清单的商机，结尾批量跑 AI 画像（获客逻辑）
      var myNames = await self._myNames();   // ★ 防自回复：一级评论刚发出去可能被扫成候选
      if (planEff && Number(planEff.cap) >= 1 && sendBtns.length > planEff.cap) {
        botLog('  🎯 这一篇最多回 ' + planEff.cap + ' 个人，超出的只收进清单', 'info');
      }
      for (var si = 0; si < sendBtns.length; si++) {
        await self._checkStop();
        // 到数就停：这篇已回够 N 个人（设置里的「每篇回几个人」）
        if (planEff && Number(planEff.cap) >= 1 && sentCount >= planEff.cap) { capHit = true; break; }

        // ★ 自动评论条间发送间隔（手动逐条发送不加此间隔）：
        //   优先用设置里的 batchItemGap 区间随机；未配置时默认 3~8s；自用版(_noDelayApplied) 为 0 零等待
        if (si > 0) {
          var gapMs = 0;
          try {
            var dc = await new Promise(function (res) { chrome.storage.local.get('delay_config', res); });
            var dcv = (dc && dc.delay_config) || {};
            var c = dcv.batchItemGap;
            if (c && typeof c === 'object') {
              var lo = Number(c.min) || 0, hi = Math.max(lo, Number(c.max) || 0);
              gapMs = lo + Math.random() * (hi - lo);
              // ★ 节奏控制：即使挡位0(裸跑)配置区间为 0，也给最小 3~6s 保底，避免 0 间隔瞬时连发
              if (gapMs < 3000) gapMs = 3000 + Math.floor(Math.random() * 3000);
            } else if (typeof c === 'number' && c > 0) {
              gapMs = Math.round(c * 1.1);
            } else {
              gapMs = 3000 + Math.floor(Math.random() * 5000);
            }
          } catch (_) { gapMs = 3000 + Math.floor(Math.random() * 5000); }
          if (gapMs > 0) {
            botLog('  ⏸ 条间间隔：停 ' + (gapMs / 1000).toFixed(1) + 's 再发下一条...', 'info');
            await sleep(gapMs);
          }
        }

        // 重新查询发送按钮（★ 不能按固定下标 si 取：已发出的按钮会被 popup 打上 .watered 从列表移除，列表会“变短”，
        //   用下标取会隔一个跳一个、漏发一半。改为每次都取“第一个还没处理过的”：未发出、且没失败过（无 data-send-done）才点；
        //   已成功(.watered)被排除、已失败(仅 data-send-done)不重复点 → 不会对同一按钮原地死循环，也能发全。）
        var currentSendBtns = $$('#mainContent .send-btn:not(.watered)');
        var sendBtn = null;
        for (var _qi = 0; _qi < currentSendBtns.length; _qi++) {
          if (!currentSendBtns[_qi].dataset.sendDone) { sendBtn = currentSendBtns[_qi]; break; }
        }
        if (!sendBtn) {
          botLog('  ⏭ 发送按钮已全部处理完（剩余都是已失败/已处理），返回列表', 'info');
          continue;
        }

        var author = sendBtn.dataset.author || '未知';
        // ★ 防自回复：昵称命中「我的账号名」= 自己刚发的那条，标已处理跳过（不回自己的评论）
        if (myNames.length && typeof _normMatch === 'function' && myNames.indexOf(_normMatch(author)) >= 0) {
          sendBtn.dataset.sendDone = '1';
          botLog('  ⏭ @' + author + ' 是自己（我的账号名），跳过', 'info');
          continue;
        }
        // 🛡 账号安全：每条回复＝总账「评论+回复」一笔；被拦下 → 本篇停止剩余发送（上层收队记欠账）
        try {
          if (typeof AccountGuard !== 'undefined') {
            var _gr = await AccountGuard.decide('comment', 1);
            if (!_gr.ok) {
              self._guardStop = true;
              botLog('  🛡 发送被拦下：' + _gr.text + '，本篇停止剩余发送', 'warn');
              break;
            }
          }
        } catch (_) {}
        botLog('📤 一键发送给 @' + author + ' (' + (si + 1) + '/' + sendBtns.length + ')', 'info');
        // 💬 评论条队列：本条进度（队列页 + 获客助手页都读这一行；sent 是本篇已发成功的条数）
        await self._cqLive({ kw: self._curKw, scenario: (self._noteScenario || self._curScenario), title: noteTitle, idx: (self._cqNoteIdx || 0), total: (self._cqNoteTotal || 0), author: author, ci: si + 1, cTotal: sendBtns.length, sent: sentCount });

        // 使用 MutationObserver 等待 .watered 类出现；
        // ★ 同时监听 data-send-done（popup 发送成功/失败都会置该标记）——失败时立即推进，不再干等超时
        var wateredPromise = new Promise(function (resolve, reject) {
          if (sendBtn.classList.contains('watered') || sendBtn.dataset.sendDone) {
            resolve();
            return;
          }
          var timer = setTimeout(function () {
            obs.disconnect();
            reject(new Error('超时（20s）'));
          }, 20000);
          var obs = new MutationObserver(function () {
            if (sendBtn.classList.contains('watered') || sendBtn.dataset.sendDone) {
              clearTimeout(timer);
              obs.disconnect();
              resolve();
            }
          });
          obs.observe(sendBtn, { attributes: true, attributeFilter: ['class', 'data-send-done'] });
        });

        // 点击发送（★ 单独 try：若元素刚被 SPA 回收/移除，click 抛错也不允许拖垮整篇——记一句继续发下一条）
        try {
          sendBtn.click();
          botLog('  → 已点击发送，等待完成...', 'info');
        } catch (_e) {
          botLog('  ⚠️ @' + author + ' 点击发送报错（元素可能已被页面回收），跳过该条', 'warn');
          continue;
        }

        try {
          await wateredPromise;
          if (sendBtn.classList.contains('watered')) {
            botLog('  ✅ @' + author + ' 发送成功', 'success');
            sentCount++;
            try {
              var _rt = String(sendBtn.dataset.replyText || '').trim();
              if (_rt && snap.replies.length < 20) snap.replies.push({ a: String(author).slice(0, 24), t: _rt.slice(0, 120) });
            } catch (_) {}
            try { if (typeof AccountGuard !== 'undefined') await AccountGuard.spend('comment', 1); } catch (_) {}
            // 💬 评论条队列：成功一条 → 刷新"本篇已发 N/M"
            await self._cqLive({ kw: self._curKw, scenario: (self._noteScenario || self._curScenario), title: noteTitle, idx: (self._cqNoteIdx || 0), total: (self._cqNoteTotal || 0), author: author, ci: si + 1, cTotal: sendBtns.length, sent: sentCount });
            // ★ 自动把成功发送的商机写入获客清单（去重按 userId）；这个玩法配「不收人」就跳过
            //   ★ 非阻塞 + 3秒超时兜底：写入清单绝不许卡住“返回列表”主流程
            if (collectOn) try {
              // ★ 修正 userId 提取：userLink 形如 /user/profile/5f_abc 或 /user/5f_abc。
              //   （旧正则 /user/(\w+) 会错把 "profile" 当 userId，导致所有人并成一条 → 清单只显示一个）
              var uidM = (sendBtn.dataset.userlink || '').match(/\/user\/(?:profile\/)?([\w-]+)/);
              // ★ 补全来源笔记 URL：popup 会把当前这篇的 noteId 挂到 _scanCurNoteId，据此拼出标准笔记链接，
              //   避免获客清单里的来源笔记丢失（旧实现 noteUrl 恒为空）
              var _curNid = window._scanCurNoteId || '';
              var person = {
                userId: uidM ? uidM[1] : '',
                nickname: sendBtn.dataset.author || author || '未知用户',
                source: {
                  noteTitle: noteTitle || '',
                  noteUrl: _curNid ? ('https://www.xiaohongshu.com/explore/' + _curNid) : '',
                  comment: sendBtn.dataset.original || '',
                  userUrl: sendBtn.dataset.userlink || '',
                  scenario: self._noteScenario || self._curScenario || '',
                },
                dmStatus: 'sent',
                dmCount: 1,
                lastDmAt: Date.now(),
                origin: '评论',
              };
              var addP = sendMsg('addProspect', person);
              var addTimeout = new Promise(function (res) {
                setTimeout(function () { res({ ok: false, error: '写入清单超时(3s)，已跳过' }); }, 3000);
              });
              Promise.race([addP, addTimeout]).then(function (addResp) {
                var addedWord = (addResp && addResp.ok && addResp.added === false) ? '（已在清单，已更新）' : '';
                if (addResp && addResp.ok && addResp.person && addResp.person.id) {
                  toProfile.push({ id: addResp.person.id, userId: addResp.person.userId, nickname: addResp.person.nickname, source: addResp.person.source });
                }
                botLog('  ➕ 已自动写入获客清单：@' + (person.nickname || '') + addedWord, 'success');
              }).catch(function (e2) {
                botLog('  ⚠️ 写入获客清单失败：' + (e2 && e2.message ? e2.message : String(e2)), 'warn');
              });
            } catch (e2) {
              botLog('  ⚠️ 写入获客清单失败：' + (e2 && e2.message ? e2.message : String(e2)), 'warn');
            }
          } else {
            botLog('  ⚠️ @' + author + ' 发送失败（popup 已结束本次处理），继续下一个', 'warn');
          }
        } catch (e) {
          botLog('  ⚠️ @' + author + ' 发送' + e.message + '，继续下一个', 'warn');
        }
      }

      // 到数就停之后：剩下的评论者按「收不收人」处理（只收进清单，不再回复）
      if (capHit) {
        var restBtns = $$('#mainContent .send-btn:not(.watered)').filter(function (b) { return !b.dataset.sendDone; });
        if (!restBtns.length) {
          botLog('  ✅ 这一篇已回够 ' + planEff.cap + ' 个人，没有剩下的人', 'info');
        } else if (collectOn) {
          botLog('  📥 这一篇已回够 ' + planEff.cap + ' 个人，剩下 ' + restBtns.length + ' 个只收进清单', 'info');
          await self._collectProspects(noteTitle, restBtns, 0);
        } else {
          botLog('  ⏭ 这一篇已回够 ' + planEff.cap + ' 个人，剩下 ' + restBtns.length + ' 个（这个玩法不收人，不再处理）', 'info');
        }
      }

      // ★ AI 获客逻辑：本篇灌完，把新入清单的商机批量跑 AI 画像（意向/需求/人群标签）。
      //   非阻塞 + 超时兜底：AI 慢/没配 key 也不影响返回列表、继续灌水下篇。
      if (toProfile.length > 0) {
        botLog('  🤖 正在为 ' + toProfile.length + ' 个新商机跑 AI 获客画像（后台异步执行）...', 'info');
        var profP = sendMsg('profileProspects', { candidates: toProfile });
        var profTimeout = new Promise(function (res) {
          setTimeout(function () { res({ ok: false, error: 'AI 画像超时(20s)，已跳过' }); }, 20000);
        });
        Promise.race([profP, profTimeout]).then(function (pr) {
          if (pr && pr.ok) botLog('  ✅ AI 获客画像完成：' + ((pr.applied || []).length) + ' 人已打标（意向/需求/人群）', 'success');
          else botLog('  ⚠️ AI 获客画像未完成：' + ((pr && pr.error) || '超时/失败'), 'warn');
        }).catch(function (e3) {
          botLog('  ⚠️ AI 获客画像失败：' + (e3 && e3.message ? e3.message : String(e3)), 'warn');
        });
      }

      return await finishSnap(
        { count: sentCount + ncCount, reason: (sentCount + ncCount) > 0 ? 'sent' : 'failed' },
        (sentCount + ncCount) > 0
          ? ('已处理：评论区回了 ' + sentCount + ' 人' + (ncCount ? '，笔记下评了 1 条' : ''))
          : '没评成：人点完了，但一条都没发出去',
        (sentCount + ncCount) > 0 ? ('评论策略「' + (planEff ? (({ note: '只评笔记', both: '评笔记＋回评论区', reply: '只回评论区', people: '只收人' })[planEff.mode] || planEff.mode) : modeText) + '」') : '每条都发送失败/被拦下（详见上面的 ⚠️ 行）'
      );
    },

    /* ─── 一项跑完 → 可中断等待下一项（定时轮：把一天的额度摊开跑） ─── */
    _waitNextRound: async function (config, round) {
      var self = this;
      var mins = (config && config.scanIntervalMin) || 10;
      var nextAt = new Date(Date.now() + mins * 60000);
      var hh = String(nextAt.getHours()).padStart(2, '0');
      var mm = String(nextAt.getMinutes()).padStart(2, '0');
      botLog('⏳ 第 ' + round + ' 项跑完。队列里的下一项将于 ' + hh + ':' + mm + ' 自动开始（约 ' + mins + ' 分钟后）...', 'info');
      var deadline = Date.now() + mins * 60000;
      self.waiting = true;
      self.waitUntil = deadline;
      self.waitWhy = '下一项 ' + hh + ':' + mm + ' 到点后自己开跑';
      try {
        while (Date.now() < deadline) {
          await self._checkStop();
          await sleep(Math.min(5000, Math.max(1000, deadline - Date.now())));
        }
      } finally { self.waiting = false; self.waitUntil = 0; self.waitWhy = ''; }
    },

    /* ─── 更新 UI：执行器两个参数在运行中禁用，按钮切「开始/停止」 ─── */
    _updateUI: function (running) {
      ['botScopeSel', 'botPaceSel'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = running;
      });
      var pauseBtn = document.getElementById('botPauseBtn');
      if (pauseBtn) {
        var paused = !!bot.paused;
        pauseBtn.style.display = running ? '' : 'none';
        pauseBtn.className = 'bot-toggle ' + (paused ? 'paused' : 'pausable');
        pauseBtn.innerHTML = (window.Ic ? window.Ic(paused ? 'play' : 'pause', 'ic-sm') : '') + (paused ? '继续' : '暂停');
        pauseBtn.title = paused
          ? '继续跑：从暂停的那一步接着往下，队列进度和页面都还在'
          : '暂停：当前这一步做完就停下等（进度不丢，点「继续」接着跑）';
      }
      var btn = document.getElementById('botToggleBtn');
      if (!btn) return;
      btn.innerHTML = (window.Ic ? window.Ic(running ? 'stop' : 'play', 'ic-sm') : '') + (running ? '停止' : '开始');
      btn.classList.toggle('running', !!running);
      btn.title = running
        ? '停止队列（当前：' + (bot.scope === 'growing' ? '只追涨势' : '全部未灌过') + ' · ' + (bot.pace === 'interval' ? '定时轮：每 N 分钟一项' : '一遍跑完') + '）'
        : '按队列跑：「获客 → 任务配置」表里到点的「词 × 类型」逐项串行跑（口径 × 节奏）';
    },
  };

  /* ============================================================
     挂载到 window
     ============================================================ */
  window.AutoBot = bot;
  window.startAutoBot = function () { var p = readParams(); bot.start(p[0], p[1]); };
  window.stopAutoBot = function () { bot.stop(); };
  window.toggleAutoBotPause = function () { bot.togglePause(); };

  /* 读列表头上的执行器参数：[口径, 节奏] */
  function readParams() {
    var s = document.getElementById('botScopeSel');
    var p = document.getElementById('botPaceSel');
    return [s ? s.value : 'all', p ? p.value : 'once'];
  }

  /* ============================================================
     绑定列表头的执行器控件（控件本体在 popup.html 里，不再由这里注入）
     ============================================================ */
  function initUI() {
    var btn = document.getElementById('botToggleBtn');
    if (!btn) {
      setTimeout(initUI, 500);
      return;
    }
    if (btn.dataset.botBound) return;
    btn.dataset.botBound = 'true';
    btn.addEventListener('click', function () {
      if (bot.running) { bot.stop(); return; }
      var p = readParams();
      bot.start(p[0], p[1]);
    });
    var pauseBtn = document.getElementById('botPauseBtn');
    if (pauseBtn && !pauseBtn.dataset.botBound) {
      pauseBtn.dataset.botBound = 'true';
      pauseBtn.addEventListener('click', function () { bot.togglePause(); });
    }
    botLog('🤖 自动灌水已就绪：列表头选「口径 × 节奏」，点「🤖 开始」启动', 'info');
  }

  // DOM 就绪后初始化
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initUI();
  } else {
    document.addEventListener('DOMContentLoaded', initUI);
  }
})();
