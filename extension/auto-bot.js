/**
 * auto-bot.js — 自动灌水机器人（纯事件驱动版）
 * 
 * 独立于现有代码，仅通过操作界面按钮实现自动化：
 *   1. 自动点击"开始搜索" → 等待搜索结果
 *   2. 自动点击每个笔记的"打开"按钮 → 等待评论加载
 *   3. 自动点击每个潜在客户的"一键发送"按钮
 *   4. 重复直到所有笔记处理完毕
 *
 * 所有等待均通过 MutationObserver 实现，零固定延时，纯串行执行。
 *
 * 使用方法：打开 popup 后，点击工具栏的 "🤖 自动" 按钮启动。
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

    /** 启动 */
    start: async function (mode) {
      if (this.running) {
        botLog('⏳ 机器人已在运行中', 'warn');
        return;
      }
      // ★ 跨引擎互斥：auto-bot 与左侧"▶ 自动灌水"(startAutoAdvance) 不能同时跑，
      //   否则两会抢同一个 xhsNoteDone 信号、互相吞、可能双发/串篇
      if (window.__botEngineBusy === 'autoAdvance') {
        botLog('⏳ 左侧「▶ 自动灌水」正在运行，请先停止它再启动本机器人', 'warn');
        return;
      }
      window.__botEngineBusy = 'bot';
      this.running = true;
      this.stopped = false;
      this.mode = mode === 'cycle' ? 'cycle' : 'cold';
      botLog('🤖 ===== 自动灌水机器人启动（' + (this.mode === 'cycle' ? '🔄 循环计划' : '🧊 冷启动') + '） =====', 'info');
      this._updateUI(true);

      try {
        if (this.mode === 'cycle') {
          await this._cycleMain();
        } else {
          await this._mainLoop();
        }
      } catch (e) {
        if (e.message === '手动停止') {
          botLog('⏹ 机器人已手动停止', 'warn');
        } else {
          botLog('❌ 机器人异常: ' + e.message, 'error');
          console.error('[AutoBot]', e);
        }
      }

      window.__botEngineBusy = '';
      this.running = false;
      this._updateUI(false);
      if (!this.stopped) {
        botLog('🏁 ===== 自动灌水机器人完成 =====', 'success');
      }
    },

    /** 停止 */
    stop: function () {
      this.stopped = true;
      botLog('⏹ 收到停止信号，等待当前操作完成后停止...', 'warn');
      this._updateUI(false);
    },

    /** 检查是否应停止 */
    _checkStop: function () {
      if (this.stopped) throw new Error('手动停止');
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
      var tab = null, reloaded = false;
      var deadline = Date.now() + 12000;
      var ready = false;
      while (Date.now() < deadline) {
        var q = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://www.xiaohongshu.com/*'] }).catch(function () { return []; });
        tab = q && q[0];
        var curl = tab ? (tab.url || '') : '';
        if (tab && /\/search_result/.test(curl)) {
          // 已在搜索页：确认笔记卡片已渲染
          var cnt = await chrome.tabs.sendMessage(tab.id, { action: 'countSearchNotes' }).catch(function () { return { count: 0 }; });
          if (cnt && cnt.count > 0) { ready = true; break; }
        } else if (!reloaded && tab) {
          // 未在搜索页（可能退回首页）→ 兜底 reload 到搜索结果页，并置标记等待渲染
          reloaded = true;
          try { chrome.tabs.update(tab.id, { url: '/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_search_result_note' }); } catch (_) {}
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
      self._checkStop();
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

    /* ─── 主循环（纯串行） ─── */
    _mainLoop: async function () {
      var self = this;
      // ★ 入口硬门禁：冷启动/循环必须先用关键词列表做过搜索，绝不灌旧列表。
      //   列表为空时，把输入框里还没添加的词先加进去。
      var kwFirst = '';
      var kwList = [];
      try {
        var _raw = await new Promise(function (res) { chrome.storage.local.get('auto_water_config', res); });
        kwList = (((_raw['auto_water_config'] || {}).keywords) || []).slice();
      } catch (_) {}
      var kwInput = $('#awKeywordPopup');
      var typed = kwInput ? String(kwInput.value || '').trim() : '';
      if (typed && kwList.indexOf(typed) === -1) kwList.push(typed);
      kwList = kwList.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; });
      // 去重保序
      var seen = {}, uniq = [];
      for (var _i = 0; _i < kwList.length; _i++) { if (!seen[kwList[_i]]) { seen[kwList[_i]] = 1; uniq.push(kwList[_i]); } }
      kwList = uniq;
      kwFirst = kwList[0] || '';
      if (!kwFirst) {
        botLog('❌ 冷启动失败：还没有任何搜索关键词。请先在左上方添加关键词（回车或点＋），形成关键词列表后，再点「🧊 冷启动·自动灌水」', 'error');
        return;
      }
      botLog('📌 自动灌水 · 本次关键词列表（共 ' + kwList.length + ' 个）："' + kwList.join('、').slice(0, 40) + '"', 'info');
      // ★ 把关键词列表写进 auto_water_config，搜索引擎（searchNotes）按列表逐个搜索
      try {
        var raw2 = await new Promise(function (res) { chrome.storage.local.get('auto_water_config', res); });
        var cfg = (raw2 && raw2['auto_water_config']) || {};
        cfg.keywords = kwList;
        await new Promise(function (res) { chrome.storage.local.set({ auto_water_config: cfg }, res); });
        if (kwFirst) await new Promise(function (res) { chrome.storage.local.set({ _aw_last_keyword: kwFirst }, res); });
      } catch (_) {}

      // ===== Step 1: 搜索（复用循环计划同一套搜索流程） =====
      var foundNotes = await self._doSearchRound();
      if (!foundNotes) {
        botLog('⏭ 冷启动结束：搜索未能产生笔记列表', 'warn');
        return;
      }

// ===== Step 2: 遍历每个笔记（串行，逐屏推进 — 方案A） =====
      // ★ 列表永远 = 当前页可见项，绝不脱节:
      //   本屏可见的笔记逐篇处理完 → 滚动搜索页加载下一屏 → popup 重渲染新一批 → 继续，到底为止。
      //   规避旧逻辑"列表登记了一堆滚动后的卡片，但回顶后靠下的卡片不在 DOM"导致的 CTRL+F 找不到。
      var handledNotes = {};
      var screenGuard = 0;   // 一轮最多翻几屏，防死循环
      var SCREEN_MAX = 30;
      var notes = $$('#noteList .note-item');
      if (notes.length === 0) {
        botLog('⚠️ 笔记列表为空，冷启动结束', 'warn');
        return;
      }

      while (screenGuard++ < SCREEN_MAX) {
        self._checkStop();
        notes = $$('#noteList .note-item');
        // 按 noteId 挑第一篇“本次未处理过”的笔记（逐屏推进后整列由 popup 重渲染，仍按 noteId 去重跳过）
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

        // ★ 单篇出错只跳过本篇，绝不拖垮整个冷启动（否则一异常整轮"断"）
        try {
          var openBtn = note.querySelector('.btn-open-note');
          if (!openBtn || openBtn.disabled || openBtn.dataset.watered === 'true' || openBtn.dataset.opened === 'true') {
            var titleEl = note.querySelector('.note-title');
            var ti = titleEl ? titleEl.textContent.trim().slice(0, 30) : ('#' + num);
            botLog('⏭ 笔记 "' + ti + '" 已灌水/已打开，跳过', 'info');
            continue;
          }

          var titleEl2 = note.querySelector('.note-title');
          var noteTitle = titleEl2 ? titleEl2.textContent.trim().slice(0, 30) : ('#' + num);
          botLog('📄 步骤2：打开笔记 "' + noteTitle + '" (' + num + '/' + notes.length + ')', 'info');

          // 点击打开笔记，同时监听成功/失败
          openBtn.click();
          botLog('  → 已点击打开，等待笔记加载...', 'info');

          var openOk = false;
          try {
            // 三路监听成功/跳过/失败（打开失败时按钮短暂显示 ⏭ 或 ❌，3 秒后恢复——必须用 MutationObserver 第一时间捕获）
            var openResult = await Promise.race([
              waitText(openBtn, '✅ 已打开', 60000).then(function () { return 'success'; }),
              waitText(openBtn, '⏭', 60000).then(function () { return 'skip'; }),
              waitText(openBtn, '❌', 60000).then(function () { return 'fail'; })
            ]);
            if (openResult === 'success') {
              openOk = true;
              botLog('  ✅ 笔记加载完成', 'success');
            } else if (openResult === 'skip') {
              botLog('  ⏭ 笔记被跳过（页面脚本不可用/未定位到链接）', 'warn');
            } else {
              botLog('  ❌ 笔记打开失败（按钮显示 ❌）', 'error');
            }
          } catch (e) {
            botLog('  ⚠️ 笔记加载超时（60s），跳过', 'warn');
          }

          // ★ 方案A下列表与页面实时一致，单篇打开失败多属偶发（页面瞬时态）→ 直接返回列表、跳过本篇继续
          if (!openOk) {
            await self._goBackToList();
            continue;
          }

          // ===== Step 3: 等待 AI 分析并逐个发送（与循环计划共用同一套发送流程） =====
          var wRes = await self._waterCurrentNote(noteTitle, note, nid);
          var sentCount = wRes ? wRes.count : 0;
          // ★ 扫过却没东西可发（AI 判定无商机/评论不足）→ 记一笔"扫过了"（只加冷却、不占浇水次数），
          //   避免冷启动里已打开未灌水的笔记在逐屏推进时又被挑出来反复打开刷同一页
          if (sentCount <= 0 && wRes && wRes.reason === 'empty' && window.NoteTrend) {
            try { await window.NoteTrend.noteChecked(nid || ''); } catch (_) {}
          }
          if (sentCount > 0 && window.NoteTrend) {
            try { await window.NoteTrend.markWatered(nid || ''); } catch (_) {}
          }

          // ===== Step 4: 返回列表（恢复打开按钮），处理下一篇 =====
          await self._goBackToList();
          botLog('  ✅ 笔记 "' + noteTitle + '" 处理完毕', 'success');
        } catch (e) {
          botLog('  ⚠️ 处理笔记 "' + (noteTitle || ('#' + num)) + '" 出错：' + (e && e.message ? e.message : e) + '，跳到下一篇', 'warn');
          try { await self._goBackToList(); } catch (_) {}
        }
      }

      botLog('📊 所有笔记处理完成！', 'success');
    },

    /* ============================================================
       循环计划模式（每 scanIntervalMin 分钟一轮）
       每轮：搜索 → 点赞采样（renderResults 自动做）→ 挑"增长中"的笔记 → 强制打开 → 等 AI → 发送 → 下一轮
       ============================================================ */
    _cycleMain: async function () {
      var self = this;
      var round = 0;
      var config = { scanIntervalMin: 2, maxPerRound: 3 };
      try {
        if (window.NoteTrend) {
          var c = await window.NoteTrend.getConfig();
          if (c) config = c;
        }
      } catch (_) {}
      botLog('🔄 循环计划启动：每 ' + config.scanIntervalMin + ' 分钟扫描一轮，每轮最多评论 ' + config.maxPerRound + ' 篇增长中的笔记（度控制可在设置页调整）', 'info');

      while (true) {
        self._checkStop();
        round++;
        botLog('🔁 ===== 第 ' + round + ' 轮扫描开始 =====', 'info');

        // Step 1: 搜索（复用冷启动同一套搜索流程）
        var foundNotes = await self._doSearchRound();
        if (!foundNotes) {
          botLog('⚠️ 本轮搜索失败/无结果，等待下一轮', 'warn');
          await self._waitNextRound(config, round);
          continue;
        }

        // Step 2: 等点赞采样落库 → 挑"增长中"笔记（度控制过滤）
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
          botLog('⏭ 本轮没有符合条件的增长中笔记（需≥2次采样且点赞在涨；灌水达上限/冷却中的不挑），等待下一轮', 'info');
          await self._waitNextRound(config, round);
          continue;
        }
        botLog('🎯 本轮挑选 ' + picked.length + ' 篇增长中笔记：' + picked.map(function (p) { return String(p.title || p.noteId || '').slice(0, 10); }).join('、'), 'success');

        // Step 3: 逐篇强制打开（无视已灌水标记）→ 等 AI → 发送 → 返回
        for (var pi = 0; pi < picked.length; pi++) {
          self._checkStop();
          var note = picked[pi];
          // ★ 从当前搜索结果 DOM 里匹配这篇笔记，取其实时标题/链接/索引，避免用趋势库历史标题导致 CTRL+F 失败
          var live = null;
          for (var mi = 0; mi < foundNotes.length; mi++) {
            if (foundNotes[mi].dataset.noteId === (note.noteId || '')) {
              var linkEl = foundNotes[mi].querySelector('.note-title a');
              live = {
                noteId: note.noteId,
                title: linkEl ? (linkEl.textContent || '').trim() : note.title,
                url: linkEl ? (linkEl.getAttribute('href') || note.url) : note.url,
                index: mi,
              };
              break;
            }
          }
          var title = String((live && live.title) || note.title || note.noteId || '').slice(0, 30);
          botLog('📄 打开增长笔记 "' + title + '" (' + (pi + 1) + '/' + picked.length + ')', 'info');
          try {
            var openOk = await self._openNoteForce(note, live);
            if (!openOk) {
              await self._goBackToList();
            } else {
              var wRes = await self._waterCurrentNote(title, null, note.noteId || (live && live.noteId) || '');
              var sent = wRes ? wRes.count : 0;
              // ★ 扫过却没东西可发（AI 判定无商机）→ 只加冷却、不占浇水次数，
              //   循环计划下一轮才不会被当成"增长中"反复打开刷同一页
              if (sent <= 0 && wRes && wRes.reason === 'empty' && window.NoteTrend) {
                try { await window.NoteTrend.noteChecked(note.noteId || (live && live.noteId) || ''); } catch (_) {}
              }
              if (sent > 0 && window.NoteTrend) {
                try { await window.NoteTrend.markWatered(note.noteId || (live && live.noteId) || ''); } catch (_) {}
              }
              await self._goBackToList();
            }
          } catch (enote) {
            botLog('  ⚠️ 处理笔记 "' + title + '" 出错：' + (enote && enote.message ? enote.message : enote) + '，跳到下一篇', 'warn');
            try { await self._goBackToList(); } catch (_) {}
          }
        }

        // Step 4: 等待下一轮（可中断）
        await self._waitNextRound(config, round);
      }
    },

    /* ─── 搜索一轮：点搜索按钮 → 等结果面板 + 笔记列表；返回 note-item 数组（两模式共用） ─── */
    _doSearchRound: async function () {
      var self = this;
      self._checkStop();
      // ★ 方案B：先校验搜索关键词输入框。输入框为空时回退到已校验的关键词列表（冷启动/循环是从列表读的，输入框往往是空的）。
      //   只有两者都为空才判定"拒绝用旧列表直接刷"。
      var kwInput = $('#awKeywordPopup');
      var kw = kwInput ? String(kwInput.value || '').trim() : '';
      if (!kw) {
        try {
          var _raw = await new Promise(function (res) { chrome.storage.local.get('auto_water_config', res); });
          var _kwList = ((_raw['auto_water_config'] || {}).keywords) || [];
          for (var _ki = 0; _ki < _kwList.length; _ki++) {
            var _k = String(_kwList[_ki] || '').trim();
            if (_k) { kw = _k; break; }
          }
        } catch (_) {}
        if (kw) {
          try { if (kwInput) kwInput.value = kw; } catch (_) {}
        }
      }
      if (!kw) {
        botLog('❌ 搜索关键词为空：请在左上方输入框填写关键词后再启动自动灌水（拒绝用旧列表直接刷）', 'error');
        return null;
      }
      botLog('🔍 用关键词 "' + String(kw).slice(0, 15) + '" 搜索：点击"开始搜索"...', 'info');
      var searchBtn = $('#btnSearch');
      if (!searchBtn) {
        botLog('❌ 未找到搜索按钮', 'error');
        return null;
      }
      searchBtn.click();
      botLog('  → 已点击搜索按钮，等进入"搜索中"...', 'info');

      try {
        // ★ 先等进入"搜索中"态：doSearch 会切到 searching 面板、隐藏/清掉旧结果，
        //   避免用 `#noteList` 里残留的旧 .note-item（它们只是 display:none 没销毁）拿到旧列表开刷
        await waitPanel('panelSearching', 45000);
        botLog('  → 已在搜索中', 'info');
        // 再等"结果"面板重新激活 + 列表出新条目（新关键词的结果）
        await waitPanel('panelResults', 45000);
        botLog('  → 搜索结果面板已激活', 'success');
        await waitElement('#noteList .note-item', 45000);
        var foundNotes = $$('#noteList .note-item');
        botLog('  ✅ 搜索完成，找到 ' + foundNotes.length + ' 篇笔记', 'success');
        // ★ [诊断] 打印前几篇笔记标题，确认是不是当前关键词"房贷"的结果（看清到底有没有带上关键词）
        try {
          var _titles = foundNotes.slice(0, 5).map(function (n) {
            var a = n.querySelector('.note-title a');
            return (a ? a.textContent : '').trim().slice(0, 20) || '(无标题/noteId=' + (n.dataset.noteId || '').slice(0, 8) + ')';
          });
          botLog('  📋 [诊断] 前5篇：' + _titles.join(' / '), 'info');
        } catch (_) {}

        // 等搜索结果页稳定：列表可能还在滚动加载、网页 SPA 路由可能还没绑定完成——
        // 立刻点笔记链接经常被吞（页面没跳转但报了成功），缓冲 2 秒后再开始打开
        botLog('  → 等待搜索结果页稳定（2 秒）...', 'info');
        await sleep(2000);
        return foundNotes;
      } catch (e) {
        botLog('❌ 搜索超时（45s），请检查搜索是否正常', 'error');
        return null;
      }
    },

    /* ─── 强制打开（循环计划）：不走 DOM 按钮，直接 background openNote + popup 刷新链路 ───
     * 打开前置一次性标志 __forceRescan：popup 重新分析时无视"已有我的评论"拦截（但仍过滤已回复评论）
     */
    _openNoteForce: async function (note, live) {
      try {
        window.__forceRescan = true;
        // ★ 用"当前搜索结果 DOM"里的实时标题/链接/索引定位，而不是趋势库里的历史标题——
        //   历史标题可能与当前卡片文字有细微差异（emoji/截断/空格），导致 CTRL+F 匹配失败、打开失败
        var payload = {
          noteId: note.noteId || (live && live.noteId),
          url: (live && live.url) || note.url,
          title: (live && live.title) || note.title,
          author: note.author || (live && live.author) || '',
        };
        // 带上当前搜索结果中的原始索引，作为内容脚本定位的后备（找不到标题时按索引点）
        if (live && live.index !== undefined) payload.rawLinkIndex = live.index;
        var resp = await sendMsg('openNote', { note: payload });
        if (resp && resp.ok) {
          botLog('  ✅ 笔记已打开（' + (resp.ready ? '详情页就绪' : '就绪超时，仍尝试扫描') + '），刷新评论助手...', 'success');
          if (window.refreshCommentAssistant) {
            try { window.refreshCommentAssistant(); } catch (_) {}
          }
          return true;
        }
        botLog('  ⏭ 打开失败/跳过：' + ((resp && resp.error) || '未知原因'), 'warn');
        return false;
      } catch (e) {
        botLog('  ⚠️ 打开异常：' + e.message, 'warn');
        return false;
      }
    },

    /* ─── 等待 AI 分析 + 逐个发送（两模式共用）；waitWateredEl 传笔记列表项时可监听"列表项已灌水"（冷启动） ───
     * 返回 { count, reason }：reason ∈ watered/empty/timeout/nobtns/sent/failed */
    _waterCurrentNote: async function (noteTitle, waitWateredEl, noteId) {
      var self = this;
      botLog('  ⏳ 等待 AI 分析（约 15~90 秒）...期间页面保持轻微划动（防后台节流），AI 完成后自动停止', 'info');
      var nudgeStopped = false;
      var nudgeTimer = setInterval(function () {
        if (nudgeStopped) return;
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          var t = tabs && tabs[0];
          if (!t || !/xiaohongshu\.com/.test(t.url || '')) return;
          try {
            var p = chrome.tabs.sendMessage(t.id, { action: 'nudgeScroll' });
            if (p && typeof p.catch === 'function') p.catch(function () {});
          } catch (_) {}
        });
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
        return { count: 0, reason: 'watered' };
      }
      if (sendWait !== 'sendbtn') {
        botLog('  → 无潜在客户（' + (sendWait === 'empty' ? 'AI 判定无商机/评论不足' : '180s 超时') + '），返回列表', 'info');
        return { count: 0, reason: sendWait === 'empty' ? 'empty' : 'timeout' };
      }

      var sendBtns = $$('#mainContent .send-btn:not(.watered)');
      if (!sendBtns || sendBtns.length === 0) {
        botLog('  → 笔记 "' + noteTitle + '" 无待发送评论，返回列表', 'info');
        return { count: 0, reason: 'nobtns' };
      }
      botLog('  💬 发现 ' + sendBtns.length + ' 个潜在客户', 'success');

      var sentCount = 0;
      var toProfile = []; // ★ 收集本篇新入清单的商机，结尾批量跑 AI 画像（获客逻辑）
      for (var si = 0; si < sendBtns.length; si++) {
        self._checkStop();

        // ★ 自动评论条间防反爬间隔（手动逐条发送不加此间隔）：
        //   优先用设置里的 batchItemGap 区间随机；未配置时默认 3~8s；自用版(_noDelayApplied) 为 0 零等待
        if (si > 0) {
          var gapMs = 0;
          try {
            var dc = await new Promise(function (res) { chrome.storage.local.get('delay_config', res); });
            var dcv = (dc && dc.delay_config) || {};
            var c = dcv.batchItemGap;
            if (c && typeof c === 'object') {
              gapMs = (Number(c.min) || 0) + Math.random() * Math.max(0, (Number(c.max) || 0) - (Number(c.min) || 0));
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
        botLog('📤 一键发送给 @' + author + ' (' + (si + 1) + '/' + sendBtns.length + ')', 'info');

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

      return { count: sentCount, reason: sentCount > 0 ? 'sent' : 'failed' };
    },

    /* ─── 一轮完成 → 可中断等待下一轮（日志显示下一轮时间） ─── */
    _waitNextRound: async function (config, round) {
      var self = this;
      var mins = (config && config.scanIntervalMin) || 2;
      var nextAt = new Date(Date.now() + mins * 60000);
      var hh = String(nextAt.getHours()).padStart(2, '0');
      var mm = String(nextAt.getMinutes()).padStart(2, '0');
      botLog('⏳ 第 ' + round + ' 轮完成。下一轮将于 ' + hh + ':' + mm + ' 自动开始（约 ' + mins + ' 分钟后）...', 'info');
      // 刷新一下左侧列表的打标徽标（新采样已落库）
      try { if (window._refreshTrendBadges) window._refreshTrendBadges(); } catch (_) {}
      var deadline = Date.now() + mins * 60000;
      while (Date.now() < deadline) {
        self._checkStop();
        await sleep(Math.min(5000, Math.max(1000, deadline - Date.now())));
      }
    },

    /* ─── 更新 UI 按钮状态 ─── */
    _updateUI: function (running) {
      var sel = document.getElementById('botModeSelect');
      if (sel) sel.disabled = running;
      var btn = document.getElementById('botToggleBtn');
      if (!btn) return;
      if (running) {
        btn.textContent = '⏹ 停止';
        btn.style.cssText =
          'padding:4px 10px;font-size:12px;border:1px solid #dc2626;' +
          'background:#dc2626;color:#fff;border-radius:4px;cursor:pointer;' +
          'transition:all 0.15s;font-weight:500;white-space:nowrap;';
      } else {
        btn.textContent = '🤖 自动';
        btn.style.cssText =
          'padding:4px 10px;font-size:12px;border:1px solid #059669;' +
          'background:#fff;color:#059669;border-radius:4px;cursor:pointer;' +
          'transition:all 0.15s;font-weight:500;white-space:nowrap;';
      }
    },
  };

  /* ============================================================
     挂载到 window
     ============================================================ */
  window.AutoBot = bot;
  window.startAutoBot = function () { bot.start(); };
  window.stopAutoBot = function () { bot.stop(); };

  /* ============================================================
     添加启动按钮到工具栏
     ============================================================ */
  function initUI() {
    if (document.getElementById('botToggleBtn')) return;

    var slot = document.getElementById('leftBotSlot');
    if (!slot) {
      setTimeout(initUI, 500);
      return;
    }

    var sel = document.createElement('select');
    sel.id = 'botModeSelect';
    sel.innerHTML = '<option value="cold">🧊 冷启动</option><option value="cycle">🔄 循环计划</option>';
    sel.title = '自动灌水模式：🧊冷启动=看到笔记就灌（灌过的跳过）；🔄循环计划=每隔一段时间扫描一次，只挑点赞增长中的笔记评论（无视已灌水标记，但受度控制约束）';
    sel.style.cssText =
      'padding:3px 4px;font-size:11px;border:1px solid #d0d0d0;border-radius:4px;background:#fff;color:#333;margin-right:4px;'; // 运行中禁用（_updateUI 处理）
    slot.appendChild(sel);

    var btn = document.createElement('button');
    btn.id = 'botToggleBtn';
    btn.textContent = '🤖 自动';
    btn.title = '启动/停止自动灌水机器人（🧊冷启动 / 🔄循环计划）';
    btn.style.cssText =
      'padding:4px 10px;font-size:12px;border:1px solid #059669;' +
      'background:#fff;color:#059669;border-radius:4px;cursor:pointer;' +
      'transition:all 0.15s;font-weight:500;white-space:nowrap;';
    btn.addEventListener('mouseenter', function () {
      if (!bot.running) btn.style.background = '#ecfdf5';
    });
    btn.addEventListener('mouseleave', function () {
      if (!bot.running) btn.style.background = '#fff';
    });
    btn.addEventListener('click', function () {
      if (bot.running) { bot.stop(); return; }
      var modeSel = document.getElementById('botModeSelect');
      bot.start(modeSel ? modeSel.value : 'cold');
    });

    slot.appendChild(btn);
    botLog('🤖 自动灌水机器人已加载（纯事件驱动版），点击「🤖 自动」启动', 'info');
  }

  // DOM 就绪后初始化
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initUI();
  } else {
    document.addEventListener('DOMContentLoaded', initUI);
  }
})();
