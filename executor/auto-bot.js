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

  /* ─── 节奏控制：每日/每轮次数门禁（读 auto_water_daily = { 'YYYY-MM-DD': count }，与设置页共享） ─── */
  function _awTodayKey() { return new Date().toISOString().slice(0, 10); }
  async function _awDailyUsed() {
    try {
      const r = await new Promise(function (res) { chrome.storage.local.get('auto_water_daily', res); });
      const d = (r && r['auto_water_daily']) || {};
      return Number(d[_awTodayKey()]) || 0;
    } catch (_) { return 0; }
  }
  async function _awDailyBump(n) {
    try {
      const r = await new Promise(function (res) { chrome.storage.local.get('auto_water_daily', res); });
      const d = (r && r['auto_water_daily']) || {};
      d[_awTodayKey()] = (Number(d[_awTodayKey()]) || 0) + (Number(n) || 0);
      await new Promise(function (res) { chrome.storage.local.set({ auto_water_daily: d }, res); });
      return d[_awTodayKey()];
    } catch (_) { return 0; }
  }
  /* 读 auto_water_config.schedule（dailyMax/perRound），0=不限 */
  async function _awSchedule() {
    try {
      const r = await new Promise(function (res) { chrome.storage.local.get('auto_water_config', res); });
      return ((r && r['auto_water_config'] && r['auto_water_config'].schedule) || {});
    } catch (_) { return {}; }
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
    var ok = !!(d && d.ok);
    if (_aiSignalResolve) {
      var r = _aiSignalResolve;
      _aiSignalResolve = null;
      _signalNoteId = '';
      r(ok);
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
      if (panel.children.length === 1 && panel.children[0].textContent.includes('操作日志将显示在这里')) {
        panel.innerHTML = '';
      }
      var now = new Date();
      var timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.dataset.src = 'bot';   // ★ 标记来源，配合"只看 bot"过滤
      entry.innerHTML = '<span class="log-time">' + timeStr + '</span><span class="log-src" style="color:#c41d3c;font-weight:700;margin-right:4px;font-size:10px;">🤖</span>' + msg;
      panel.appendChild(entry);
      panel.scrollTop = panel.scrollHeight;
      while (panel.children.length > 200) panel.removeChild(panel.firstChild);
      // ★ 同步镜像到锁定遮罩日志（bot 运行时遮罩会盖住面板，以前 bot 的日志在遮罩上完全看不到）
      if (typeof window.__xhsMirrorLog === 'function') {
        try { window.__xhsMirrorLog(msg, type, timeStr, 'bot', '🤖'); } catch (_) {}
      }
      console.log('[Bot][' + timeStr + '] ' + msg);
    }
  }

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
      // 🛡 账号安全：静默期 / 单休 / 起床前 / 发布占线 → 这趟不新起（手动点也一样，顺延到恢复时刻）
      try {
        if (typeof AccountGuard !== 'undefined') {
          var _wall = await AccountGuard.blockAllReason();
          if (_wall) { botLog('🛡 ' + _wall.text, 'warn'); return; }
        }
      } catch (_) {}
      window.__botEngineBusy = 'bot';
      this.running = true;
      this.stopped = false;
      this.paused = false;
      this.autoMode = !!(opts && opts.auto);
      this._autoStopN = 0;
      this.scope = scope === 'growing' ? 'growing' : 'all';
      this.pace = (pace === 'once' || pace === 'interval') ? pace : 'interval';
      // ★ 双引擎：启动即绑定水 tab（只在它上面驱动页面，客服走客服 tab，二者互不抢页）
      try { await this._ensureWaterTab(); } catch (_) {}
      // ★ 手动/自动互斥：运行期间禁用列表里的单篇「🔗 打开」，避免人工点开与执行器抢同一个页面
      this._setBotLock(true);
      botLog('🤖 ===== 自动灌水启动（口径：' + (this.scope === 'growing' ? '只追涨势' : '全部未灌过') +
        ' · 节奏：' + (this.pace === 'interval' ? '定时轮' : '一遍跑完') + (this.autoMode ? ' · 后台保底时钟拉起' : '') + '） =====', 'info');
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
        if (this.pace === 'interval') {
          var config = await this._trendConfig();
          botLog('⏳ 定时轮：每 ' + config.scanIntervalMin + ' 分钟跑队列里的一项（把额度摊开到一天；间隔在「🎯 获客 → ⚙️ 设置 → 🤖 拟人化与频率 → ⚙️ 高级配置」里改）', 'info');
        } else {
          botLog('▶ 一遍跑完：从队首连跑到队尾（去「🔁 队列」页看这一队：正在跑 / 待跑 / 已完成）', 'info');
        }
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

    /** 读「💧 灌水频率与去重」里的额度控制/节奏配置（NoteTrend 侧默认值兜底） */
    _trendConfig: async function () {
      var config = { scanIntervalMin: 10, maxPerRound: 3 };
      try {
        if (window.NoteTrend) {
          var c = await window.NoteTrend.getConfig();
          if (c) config = c;
        }
      } catch (_) {}
      return config;
    },

    /* ─── 队列执行器：串行跑「词 × 类型」一格一格 ───
     *   一遍跑完＝从队首连跑到队尾；定时轮＝每「扫描间隔」分钟跑一项（额度摊到一天）
     *   撞每日/每轮上限、搜索起不来 → 当前项记欠账并停下（下次点开始从它接着跑）；
     *   配置表里已经没有这一格了 → 直接丢（改表＝改队列，不留死项） */
    _runQueue: async function () {
      var self = this;
      var round = 0, completed = 0;
      var dropped = {};   // 本次跑里"丢掉了、但还挂在队头"的项 → 防止原地反复重搜
      var ran = {};       // 本次跑已跑过的项（"每轮跑"的格子跑完仍算到点，一趟里不重复跑）
      while (true) {
        await self._checkStop();
        var item = await drainQueueTake(ran);
        if (!item) {
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
        var ik = _drainQKey(item.k, item.scenario);
        if (dropped[ik]) {
          botLog('⏸ 队头这一项「' + (item.label || item.k) + ' × ' + self._qTypeName(item.scenario) + '」跑不起来、又还挂在配置表里，先停下不空转——去「获客 → 任务配置」改这一格', 'warn');
          return false;
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
        if (r && r.stop) {
          botLog('⏸ 队列停在「' + (item.label || item.k) + ' × ' + self._qTypeName(item.scenario) + '」这一项，已记欠账——下次点「🤖 开始」从它接着跑', 'warn');
          // 🌿 自动跑的"空转熔断"：连续三次都卡在同一类问题上（页面被占着 / 卡住），先别反复拉起
          if (self.autoMode) {
            self._autoStopN = (self._autoStopN || 0) + 1;
            if (self._autoStopN >= 3) {
              try { await chrome.storage.local.set({ daily_browse_broken: { at: Date.now(), reason: '连续 3 次没跑起来（页面被手动占用 / 页面卡住）' } }); } catch (_) {}
              botLog('🛑 自动跑先停了：连续 ' + self._autoStopN + ' 次没跑起来。看一眼小红书页面是不是没打开 / 卡住了，回头点「🤖 开始」手动跑一趟', 'error');
            }
          }
          return false;
        }
        ran[ik] = true;   // 跑过的不再进这一趟（"每轮跑"的格子下一趟再来）
        completed++;
        self._autoStopN = 0;   // 跑通一项就把连续失败次数清零
        if (self.pace === 'interval') {
          // 后面还有到点的项才等这一轮；跑完最后一项直接收尾（否则白等一个间隔才报"跑完了"）
          var nextN = 0;
          try {
            var _pn = drainQueuePlan(await drainGetScanCfg(), await drainGetQueue(), Date.now(), await drainDailyCtx());
            nextN = _pn.todo.filter(it => !ran[_drainQKey(it.k, it.scenario)]).length;
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
      self._capHit = false;
      self._guardStop = false;   // 🛡 总账拦下（额度用完/时段外）＝整项停下记欠账，跟普通"每日上限"分开报
      self._stats = { found: 0, comments: 0, notes: [] };
      self._curKw = item.k;              // 💬 评论条队列的实时进度要带上"这一项是哪个词 × 哪个类型"
      self._curScenario = item.scenario;
      botLog('▶ 第 ' + seq + ' 项：' + card + ' × 「' + (item.label || item.k) + '」' +
        (item.carry ? '（接着上次没跑完的）' : '') + (item.manual ? '（手插到最前）' : ''), 'info');

      // 🌿 日常流程：不走「搜索 → 灌水」那条路，单独跑（见 _runDailyItem）
      if (item.scenario === 'daily') return await self._runDailyItem(item, seq);

      var notes = await self._doSearchRound(item);
      if (!notes) {
        var qe = self._qErr || { kind: 'hold', msg: '搜索没出结果' };
        if (qe.kind === 'drop') {
          await drainQueueDrop(item.k, item.scenario);
          botLog('⏭ 这一项已从队列删掉：' + qe.msg, 'warn');
          return { drop: true };
        }
        await drainQueueHold(item, qe.msg);
        botLog('⚠️ 这一项没跑起来：' + qe.msg, 'warn');
        return { stop: true };
      }
      self._stats.found = notes.length;

      if (self.scope === 'growing') await self._roundGrowing(notes);
      else await self._roundAll(notes);

      if (self._capHit || self._guardStop) {
        await drainQueueHold(item, self._guardStop ? '🛡 账号安全拦下（额度用完/时段外），下次接着跑' : '今天已到上限，下次接着跑');
        return { stop: true };
      }
      await drainQueueFinish(item, {
        foundN: self._stats.found,
        commentN: self._stats.comments,
        notes: self._stats.notes,
        note: self._stats.comments > 0 ? ('评论 ' + self._stats.comments + ' 条') : '没找到可评论的',
      });
      botLog('✅ 第 ' + seq + ' 项跑完：搜到 ' + self._stats.found + ' 篇 · 评论 ' + self._stats.comments + ' 条', 'success');
      return { done: true };
    },

    /* 🌿 自动跑：今天还剩哪些"还没到点"的活 → 值不值得守着（返回 {waitMs, why}；waitMs=0＝今天没活了）
     *   ① 获客格子 / 盯的账号：它们自带"下次到点"；② 日常浏览：今天还有配额，只是还没到它那个时段。
     *   再拿自动跑时段收口：等不到那一刻（已过时段）就直接收工，别把窗口守过夜。 */
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
      try {
        // 只在"日常这一轮确实欠着"时才为它守着（每 N 格插 1 轮，已经跑到该它了）；
        // 而且要等的是"下一段时段开始"（现在就有方向可跑的话，队列早就把它取出来了）
        var owed = !!(plan && plan.dbOn && (Number(plan.everyN) || 0) > 0 && (Number(plan.sinceN) || 0) >= plan.everyN);
        if (owed && db && db.cfg && db.cfg.enabled && typeof DailyBrowse !== 'undefined') {
          var openAt = DailyBrowse.nextOpenMs ? DailyBrowse.nextOpenMs(db.cfg, db.daily, now) : 0;
          if (openAt > now + 60000 && openAt <= endToday.getTime()) cands.push({ at: openAt, why: '日常浏览还没到它那个时段' });
        }
      } catch (_) {}
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
      while (Date.now() < deadline) {
        await self._checkStop();
        await sleep(Math.min(5000, Math.max(1000, deadline - Date.now())));
      }
      await self._checkStop();
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
      if (!cfg) { await drainQueueHold(item, '读不到日常浏览配置'); botLog('⚠️ 读不到日常浏览配置（重开弹窗再试）', 'warn'); return { stop: true }; }
      var dir = (typeof DailyBrowse !== 'undefined') ? DailyBrowse.dirById(cfg, item.k) : null;
      if (!dir) { await drainQueueDrop(item.k, 'daily'); botLog('⏭ 这一轮日常流程作废：方向已经不在配置里了', 'warn'); return { drop: true }; }

      // 该不该跑（关掉 / 方向停用 / 配额满 / 不在时段）→ 记一条完成跳过，别把整条队列堵在这一项上
      // 手插的一轮＝「现在就跑」：总开关与时段拦不住它（方向停用、配额满仍然拦）
      var skip = self._dailySkipReason(cfg, db.daily, dir, !!item.manual);
      if (skip) { await drainQueueFinish(item, { note: skip }); botLog('⏭ 这一轮跳过：' + skip, 'warn'); return { done: true }; }
      if (item.manual && !cfg.enabled) botLog('ℹ️ 日常浏览总开关是关的：这一轮是你手插的，照跑一次（队列不会自动排它）', 'info');

      // 🛡 账号安全：静默期/单休/发布占线 → 这轮不跑；「打开浏览」额度用完 → 记欠账（下次接着跑）
      var _gw = null, _gLeft = Infinity;
      try {
        if (typeof AccountGuard !== 'undefined') {
          _gw = await AccountGuard.blockAllReason();
          if (!_gw) {
            var _gd = await AccountGuard.decide('open', 1);
            if (!_gd.ok) _gw = _gd;
            else _gLeft = Math.max(0, _gd.cap - _gd.used);
          }
        }
      } catch (_) {}
      if (_gw) {
        await drainQueueHold(item, '🛡 ' + (_gw.text || '账号安全拦下这一轮'));
        botLog('⏹ 🛡 ' + (_gw.text || '账号安全拦下这一轮') + '，记欠账下次接着跑', 'warn');
        return { stop: true };
      }

      var used = self._dailyUsed(db.daily, dir.id);
      var count = Math.max(1, Math.min(Number(cfg.perRound) || 6, dir.dailyQuota - used));
      if (_gLeft < count) count = Math.max(1, _gLeft);   // 🛡 别超「打开浏览」总账剩下的量
      var kws = (dir.keywords || []).filter(Boolean);
      var kw = kws.length ? kws[Math.floor(Math.random() * kws.length)] : '';
      var url = kw
        ? ('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_explore_feed')
        : 'https://www.xiaohongshu.com/explore';

      var tabId = await self._ensureWaterTab();
      if (!tabId) { await drainQueueHold(item, '没找到工作台标签页'); botLog('⚠️ 没找到「💧 灌水工作台」标签页，先停下', 'warn'); return { stop: true }; }
      var roundId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      botLog('  → 进' + (kw ? '搜索「' + kw + '」' : '首页推荐') + '，泛刷 ' + count + ' 篇（单篇停留 ' + cfg.dwellMin + '~' + cfg.dwellMax + 's）', 'info');
      try { await chrome.tabs.update(tabId, { url: url }); }
      catch (e) { await drainQueueHold(item, '打开浏览页失败'); botLog('⚠️ 打开浏览页失败：' + ((e && e.message) || e), 'warn'); return { stop: true }; }
      await self._dbWaitLoad(tabId, 20000);
      await self._checkStop();

      var opts = {
        roundId: roundId, total: count, count: count,
        dirId: dir.id, dirName: dir.name,
        dwellMin: cfg.dwellMin, dwellMax: cfg.dwellMax,
        openRate: cfg.openRate, likeRate: cfg.likeRate, collectRate: cfg.collectRate,
        // 顺手互动：只给"今天还剩几条"的预算（页面按概率发，发出去才算数）；上限 0 ＝ 不做这类动作
        comment: { rate: (cfg.comment || {}).rate, left: Math.max(0, (Number((cfg.comment || {}).dailyMax) || 0) - (Number(db.daily.comments) || 0)) },
        reply: { left: Math.max(0, (Number((cfg.reply || {}).dailyMax) || 0) - (Number(db.daily.replies) || 0)) },
        follow: { rate: (cfg.follow || {}).rate, left: Math.max(0, (Number((cfg.follow || {}).dailyMax) || 0) - (Number(db.daily.follows) || 0)) },
      };
      var sent = await self._dbStartRound(tabId, opts);
      if (!sent) { await drainQueueHold(item, '页面脚本没接上（这一轮没发车）'); botLog('⚠️ 页面脚本没接上：可能页面没加载好，下次接着跑', 'warn'); return { stop: true }; }

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
        await drainQueueHold(item, why);
        botLog('⚠️ ' + why + '，记欠账下次接着跑', 'warn');
        return { stop: true };
      }

      var last = r.last || {};
      var items = Array.isArray(last.items) ? last.items : [];
      var viewed = items.length;
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

    /* 今天这个方向还能不能跑（不能跑＝跳过这一轮，不堵队列）
       force＝手插的一轮：用户当下点了「塞一轮」，总开关与时段不拦它（方向停用、配额满仍然拦） */
    _dailySkipReason: function (cfg, daily, dir, force) {
      if (!force && (!cfg || !cfg.enabled)) return '日常浏览已关（配置在「获客 → 任务配置 → 🌿 日常浏览」）';
      if (!dir || dir.enabled === false) return '这个方向被停用了';
      if (this._dailyUsed(daily, dir.id) >= (Number(dir.dailyQuota) || 0)) return '「' + dir.name + '」今天已经刷满 ' + dir.dailyQuota + ' 篇';
      if (!force && typeof DailyBrowse !== 'undefined' && !DailyBrowse.inWindow(dir.windows, Date.now())) return '「' + dir.name + '」现在还不在时段内';
      return '';
    },
    _dailyUsed: function (daily, dirId) {
      return Number((((daily || {}).byDirection) || {})[dirId]) || 0;
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
      var runMs = Math.round(count * (((Number(cfg.dwellMax) || 25) + 40) * 1000) + 120000);
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

    /* ─── 口径「全部未灌过」：当前结果逐屏推进，看到就灌（已灌过/队列已跑过的跳过） ─── */
    _roundAll: async function () {
      var self = this;
      // ★ 列表永远 = 当前页可见项，绝不脱节:
      //   本屏可见的笔记逐篇处理完 → 滚动搜索页加载下一屏 → popup 重渲染新一批 → 继续，到底为止。
      //   避免旧逻辑"列表登记了一堆滚动后的卡片，但回顶后靠下的卡片不在 DOM"导致的 CTRL+F 找不到。
      var handledNotes = {};
      var screenGuard = 0;   // 一轮最多翻几屏，防死循环
      var SCREEN_MAX = 30;
      // ★ 节奏控制：本轮已处理篇数 + 每日已达上限（dailyMax/perRound，0=不限）
      var processedThisRun = 0;
      var _awSch = await _awSchedule();
      var _dailyMax = Number(_awSch.dailyMax) || 0;
      var _perRoundCap = Number(_awSch.perRound) || 0;
      var notes = $$('#noteList .note-item');
      if (notes.length === 0) {
        botLog('⚠️ 笔记列表为空，结束本轮', 'warn');
        return false;
      }

      while (screenGuard++ < SCREEN_MAX) {
        await self._checkStop();
        if (self._guardStop) break;   // 🛡 总账拦下（额度用完/时段外）→ 整轮收队，上层记欠账
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

        // ★ 节奏控制每日/每轮门禁：达到即停（队列执行器据此把这一项记欠账，下次接着跑）
        var _usedNow = await _awDailyUsed();
        if (_dailyMax > 0 && _usedNow >= _dailyMax) {
          self._capHit = true;
          botLog('⏹ 已达每日评论上限 ' + _dailyMax + ' 条（今天已发 ' + _usedNow + '），本轮结束', 'warn');
          break;
        }
        if (_perRoundCap > 0 && processedThisRun >= _perRoundCap) {
          self._capHit = true;
          botLog('⏹ 已达每轮处理上限 ' + _perRoundCap + ' 篇，本轮结束', 'warn');
          break;
        }

        // ★ 单篇出错只跳过本篇，绝不拖垮整轮（否则一异常整轮"断"）
        var noteTitle = '';
        try {
          var titleEl = note.querySelector('.note-title');
          noteTitle = titleEl ? titleEl.textContent.trim().slice(0, 30) : ('#' + num);
          var openBtn = note.querySelector('.btn-open-note');
          // 已灌水 → 跳过（与列表徽标「全部未灌过」口径同源）
          if (!openBtn || openBtn.dataset.watered === 'true') {
            botLog('⏭ 笔记 "' + noteTitle + '" 已灌水，跳过', 'info');
            continue;
          }
          // 队列里已经跑过这一篇（工作台那个「✅ 队列已跑过」标）→ 也跳过，别再开一遍重评
          var qBtn = note.querySelector('.note-q');
          if (qBtn && qBtn.dataset.qdone === 'true') {
            botLog('⏭ 笔记 "' + noteTitle + '" 队列里已跑过，跳过', 'info');
            continue;
          }
          botLog('📄 打开笔记 "' + noteTitle + '" (' + num + '/' + notes.length + ')', 'info');
          self._cqNoteIdx = num; self._cqNoteTotal = notes.length;
          await self._cqLive({ kw: self._curKw, scenario: self._curScenario, title: noteTitle, idx: num, total: notes.length });

          var openOk = await self._openNote(self._noteFromList(nid), { recordOpened: true });
          if (!openOk) {
            if (self._guardStop) break;   // 🛡 总账拦下 → 收队（压根没离开列表，不用回退）
            // ★ 方案A下列表与页面实时一致，单篇打开失败多属偶发（页面瞬时态）→ 直接返回列表、跳过本篇继续
            await self._goBackToList();
            continue;
          }

          // ===== 等 AI 分析并逐个发送 =====
          var wRes = await self._waterCurrentNote(noteTitle, note, nid);
          var sentCount = wRes ? wRes.count : 0;
          processedThisRun++; // ★ 节奏控制：本篇计入本轮处理篇数
          if (sentCount > 0) {
            await _awDailyBump(sentCount); // ★ 节奏控制：已发条数计入每日上限
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

      botLog('📊 所有笔记处理完成！', 'success');
      return true;
    },

    /* ─── 口径「只追涨势」：从趋势库挑点赞增长中的笔记（度控制：每轮上限/每篇总次数/同篇冷却/复核冷却） ─── */
    _roundGrowing: async function (foundNotes) {
      var self = this;
      var config = await self._trendConfig();
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
        if (self._guardStop) break;   // 🛡 总账拦下（额度用完/时段外）→ 整轮收队，上层记欠账
        // ★ 节奏控制每日门禁：达到即停下（队列执行器据此把这一项记欠账，下次接着跑）
        var _sch = await _awSchedule();
        var _dMax = Number(_sch.dailyMax) || 0;
        var _used = await _awDailyUsed();
        if (_dMax > 0 && _used >= _dMax) {
          self._capHit = true;
          botLog('⏹ 已达每日评论上限 ' + _dMax + ' 条（今天已发 ' + _used + '），本轮停止', 'warn');
          break;
        }
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
              await _awDailyBump(sent); // ★ 节奏控制：已发条数计入每日上限
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
      botLog('⏹ 收到停止信号，等待当前操作完成后停止...', 'warn');
      this._updateUI(false);
    },

    /** 暂停：不打断正在发的那一条，等它做完，到下一个检查点停下等着（进度、页面都留在原地） */
    pause: function () {
      if (!this.running || this.paused) return;
      this.paused = true;
      botLog('⏸ 已暂停：当前这一步做完就停下等（点「▶ 继续」接着跑，进度不丢）', 'warn');
      this._updateUI(true);
    },

    /** 继续：从暂停的那一步往下接着跑 */
    resume: function () {
      if (!this.paused) return;
      this.paused = false;
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
      // ★ 返回用搜索列表首关键词（不再依赖输入框单值）
      var kw = '';
      try { var _r = await new Promise(function (res) { chrome.storage.local.get('auto_water_config', res); }); kw = (((_r['auto_water_config'] || {}).keywords) || [])[0] || ''; } catch (_) {}
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
      var deadline = Date.now() + 12000;
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
        } else if (!reloaded && tabId) {
          // 未在搜索页（可能退回首页）→ 兜底 reload 到搜索结果页，并置标记等待渲染
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
        try { a = await window._useAcct(item.k, item.scenario, item.label || ''); } catch (e) { a = { ok: false, error: (e && e.message) || String(e) }; }
        if (!a || !a.ok) {
          var aem = (a && a.error) || '主页没打开';
          self._qErr = /取消盯|已不在/.test(aem) ? { kind: 'drop', msg: aem } : { kind: 'hold', msg: aem };
          return null;
        }
        return await self._awaitSearchResults();
      }
      if (typeof window._useKw !== 'function') { self._qErr = { kind: 'hold', msg: '前台搜索入口未就绪（重开弹窗再试）' }; return null; }
      // 词在启用列表里的下标：与 searchNotes 读的是同一份 auto_water_config.keywords（词池＝唯一真源）
      var words = [];
      try { words = await drainSyncEnabledKeywords(); } catch (_) {}
      var idx = words.indexOf(item.k);
      if (idx < 0) { self._qErr = { kind: 'drop', msg: '「' + item.k + '」已不在启用词里（被停用/移除了）' }; return null; }
      botLog('🔍 搜「' + item.k + '」的 ' + card + '（点单这一类，不顺延到别的词）...', 'info');
      var r = null;
      try { r = await window._useKw(idx, item.scenario); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
      if (!r || !r.ok) {
        var em = (r && r.error) || '搜索没起来';
        // ⚙️ 配置表已经不含这一格／城市没设（这类根本搜不了）→ 「改表＝改队列」，直接丢；其余（网络/超时）留欠账
        self._qErr = /没勾|不在启用词|还没设城市/.test(em) ? { kind: 'drop', msg: em } : { kind: 'hold', msg: em };
        return null;
      }
      return await self._awaitSearchResults();
    },

    /* 点完搜索 → 等「搜索中」→ 结果面板 → 笔记列表（等多久按本词有几个搜索动作放宽）；超时返回 null */
    _awaitSearchResults: async function () {
      var self = this;
      await self._checkStop();
      var planTotal = 1;
      try {
        var _st = await new Promise(function (res) { chrome.storage.local.get('auto_water_state', res); });
        planTotal = Number(((_st['auto_water_state'] || {}).searchState || {}).planTotal) || 1;
      } catch (_) {}
      var searchWaitMs = planTotal > 1 ? (45000 + 30000 * (planTotal - 1)) : 45000;
      if (planTotal > 1) botLog('  → 本词 ' + planTotal + ' 个搜索动作各搜一遍（等结果上限 ' + Math.round(searchWaitMs / 1000) + 's）', 'info');
      try {
        // ★ 先等进入"搜索中"态：结果面板与 #noteList 里的旧 .note-item 只是 display:none 没销毁，
        //   不等就取会拿到上一次搜索的旧列表
        await waitPanel('panelSearching', 45000);
        botLog('  → 已在搜索中', 'info');
        await waitPanel('panelResults', searchWaitMs);
        botLog('  → 搜索结果面板已激活', 'success');
        await waitElement('#noteList .note-item', searchWaitMs);
        var foundNotes = $$('#noteList .note-item');
        botLog('  ✅ 搜索完成，找到 ' + foundNotes.length + ' 篇笔记', 'success');
        try {
          var _titles = foundNotes.slice(0, 5).map(function (n) {
            var a = n.querySelector('.note-title a');
            return (a ? a.textContent : '').trim().slice(0, 20) || '(无标题/noteId=' + (n.dataset.noteId || '').slice(0, 8) + ')';
          });
          botLog('  📋 [诊断] 前5篇：' + _titles.join(' / '), 'info');
        } catch (_) {}
        // 等搜索结果页稳定：列表可能还在滚动加载、SPA 路由可能还没绑定完成，立刻点笔记常被吞
        botLog('  → 等待搜索结果页稳定（2 秒）...', 'info');
        await sleep(2000);
        return foundNotes;
      } catch (e) {
        var tmo = '搜索超时（' + Math.round(searchWaitMs / 1000) + 's）';
        botLog('❌ ' + tmo + '，请检查搜索是否正常', 'error');
        self._qErr = { kind: 'hold', msg: tmo };
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
      try {
        // 🛡 账号安全：打开笔记＝总账「打开浏览」一笔；额度用完 / 静默等 → 不开（上层据 _guardStop 收队记欠账）
        if (typeof AccountGuard !== 'undefined') {
          var _g = await AccountGuard.decide('open', 1);
          if (!_g.ok) {
            this._guardStop = true;
            botLog('  🛡 停止打开：' + _g.text, 'warn');
            return false;
          }
        }
        if (opts.force) window.__forceRescan = true;
        var resp = await sendMsg('openNote', { note: note });
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
        botLog('  ⚠️ 打开异常：' + e.message, 'warn');
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
    _postNoteComment: async function (noteTitle, noteId, pb) {
      var self = this;
      var tId = self.waterTabId || 0;
      if (!tId) return { count: 0, reason: 'failed', error: '没绑定灌水标签页' };
      var sc = self._curScenario || 'latest';
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
      var g = null;
      try {
        g = await sendMsg('drainComment', {
          scenario: sc, noteTitle: noteTitle || nMeta.title || '', noteContent: nMeta.content || '', noteAuthor: nMeta.author || '',
          keyword: self._curKw || '', city: cfgCity, region: '',
          painText: '',
        }, 60000);
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

      // 🛡 账号安全：评论＝总账「评论+回复」一笔；额度用完/时段外 → 这条不发（上层收队记欠账）
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
      try {
        res = await self._tabSend(tId, {
          action: 'sendNoteComment', text: text, title: noteTitle || '', noteId: noteId || '',
        }, 60000);
      } catch (e) { res = { success: false, error: (e && e.message) || String(e) }; }
      if (res && res.success) {
        try { if (typeof AccountGuard !== 'undefined') await AccountGuard.spend('comment', 1); } catch (_) {}
        botLog('  ✅ 已发一级评论（' + label + '）：' + text.slice(0, 24) + (text.length > 24 ? '…' : ''), 'success');
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
      var ncCount = 0;   // 「评笔记本身」那一条的成绩（0/1）
      var replyCommenters = !pb || pb.send === 'both';   // 只有求助（both）和老入口才逐条回复评论者
      var scanCommenters = !pb || pb.find === 'commenters';   // 本地不扫评论区，其余类型都扫

      // ① 对笔记本身发一条一级评论（最新=抢位 / TOP=活水 / 本地 / 高V=借势 / 求助=对楼主）
      if (pb && pb.send !== 'none') {
        botLog('  ' + pb.icon + ' 跑法「' + pb.name + '」：' + pb.tip, 'info');
        var ncRes = await self._postNoteComment(noteTitle, noteId, pb);
        ncCount = (ncRes && ncRes.count) || 0;
        if (!ncCount) {
          // 🛡 总账拦下（额度用完/时段外）：别再等 AI 分析，直接收队
          if (ncRes && ncRes.reason === 'guard') return { count: 0, reason: 'guard', error: ncRes.error || '' };
          var ncWhy = (ncRes && (ncRes.error || ncRes.reason)) || '未知';
          if (!scanCommenters) return { count: 0, reason: (ncRes && ncRes.reason === 'skip') ? 'skip' : 'failed', error: ncWhy };
          botLog('  ⏭ 一级评论没发出去（' + ncWhy + '），继续按评论区找商机...', 'warn');
        }
      }
      // ② 竞对（埋伏）：一个字都不发，扫出来的商机直接进清单待私信
      if (pb && pb.send === 'none') {
        botLog('  ' + pb.icon + ' 跑法「' + pb.name + '」：' + pb.tip, 'info');
      }
      botLog('  ⏳ 等待 AI 分析（约 15~90 秒）...期间页面保持轻微划动（防后台节流），AI 完成后自动停止', 'info');
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
      var races = [
        sendArm.then(function () { return 'sendbtn'; }),
        aiSignalPromise.then(function (ok) { return ok ? 'sendbtn' : 'empty'; }),
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
        return { count: ncCount, reason: ncCount > 0 ? 'sent' : 'watered' };
      }
      if (sendWait !== 'sendbtn') {
        botLog('  → 无潜在顾客（' + (sendWait === 'empty' ? 'AI 判定无商机/评论不足' : '180s 超时') + '），返回列表', 'info');
        return { count: ncCount, reason: ncCount > 0 ? 'sent' : (sendWait === 'empty' ? 'empty' : 'timeout') };
      }

      var sendBtns = $$('#mainContent .send-btn:not(.watered)');
      if (!sendBtns || sendBtns.length === 0) {
        botLog('  → 笔记 "' + noteTitle + '" 无待发送评论，返回列表', 'info');
        return { count: ncCount, reason: ncCount > 0 ? 'sent' : 'nobtns' };
      }
      // ★ 只收人不回复：竞对＝埋伏（不评论）；最新/TOP/高V＝交完自己那条露脸评论，顺手把有商机的人收进清单
      if (!replyCommenters) {
        var pbNone = !!(pb && pb.send === 'none');
        botLog('  ' + (pbNone ? '🕵️ 发现 ' : '📥 发现 ') + sendBtns.length + ' 个有商机的评论者（'
          + (pbNone ? '只埋伏不评论' : '只收进获客清单，不逐条回复') + '）', 'success');
        return await self._collectProspects(noteTitle, sendBtns, ncCount);
      }
      botLog('  💬 发现 ' + sendBtns.length + ' 个潜在顾客', 'success');

      var sentCount = 0;
      var toProfile = []; // ★ 收集本篇新入清单的商机，结尾批量跑 AI 画像（获客逻辑）
      var myNames = await self._myNames();   // ★ 防自回复：一级评论刚发出去可能被扫成候选
      for (var si = 0; si < sendBtns.length; si++) {
        await self._checkStop();

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
        // 🛡 账号安全：每条回复＝总账「评论+回复」一笔；额度用完/时段外 → 本篇停止剩余发送（上层收队记欠账）
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
        await self._cqLive({ kw: self._curKw, scenario: self._curScenario, title: noteTitle, idx: (self._cqNoteIdx || 0), total: (self._cqNoteTotal || 0), author: author, ci: si + 1, cTotal: sendBtns.length, sent: sentCount });

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
            try { if (typeof AccountGuard !== 'undefined') await AccountGuard.spend('comment', 1); } catch (_) {}
            // 💬 评论条队列：成功一条 → 刷新"本篇已发 N/M"
            await self._cqLive({ kw: self._curKw, scenario: self._curScenario, title: noteTitle, idx: (self._cqNoteIdx || 0), total: (self._cqNoteTotal || 0), author: author, ci: si + 1, cTotal: sendBtns.length, sent: sentCount });
            // ★ 自动把成功发送的商机写入获客清单（去重按 userId）
            //   ★ 非阻塞 + 3秒超时兜底：写入清单绝不许卡住“返回列表”主流程
            try {
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

      return { count: sentCount + ncCount, reason: (sentCount + ncCount) > 0 ? 'sent' : 'failed' };
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
      while (Date.now() < deadline) {
        await self._checkStop();
        await sleep(Math.min(5000, Math.max(1000, deadline - Date.now())));
      }
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
