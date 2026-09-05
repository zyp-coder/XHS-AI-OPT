/**
 * auto-water.js — 笔记搜索 + 已灌水状态检查
 * 运行在 background service worker 上下文
 * 职责：关键词搜索笔记、标记已灌水状态
 * 注意：自动灌水/AI筛选/调度功能已移除（防爬策略调整）；
 *       旧「会员密钥」卡密层已删除，灌水功能统一由版本开关（edition.js autoWater）管控
 */

/* ─── 状态常量（简化版：仅保留搜索和错误） ─── */
const PHASE = {
  IDLE: 'IDLE',
  SEARCHING: 'SEARCHING',
  ERROR: 'ERROR',
};

/* ─── 核心引擎（仅搜索 + 状态检查） ─── */
const AutoWater = {

  /* 获取当前状态 */
  async getStatus() {
    const state = await Storage.getAutoWaterState();
    const config = await Storage.getAutoWaterConfig();
    const todayCount = await Storage.getAutoWaterDailyCount();
    return {
      ...state,
      todayCount,
      dailyMax: config.schedule?.dailyMax || 20,
      perRound: config.schedule?.perRound || 10,
      keywords: config.keywords || [],
    };
  },

  /* ── 搜索笔记：一次只搜“当前目标词”，不批量遍历所有关键词（避免反复刷新小红书页/被风控） ─── */
  async searchNotes() {
    const config = await Storage.getAutoWaterConfig();
    console.log('[一键灌水] searchNotes - 读取到配置:', JSON.stringify(config));
    const all = (config.keywords || []).filter(Boolean);
    if (all.length === 0) {
      return { ok: false, error: '请先在左上方输入框填写搜索关键词，再按回车/点搜索' };
    }
    // 当前目标词 = 列表指针 kwIdx（0 起），越界回 0
    let idx = parseInt(config.schedule && config.schedule.kwIdx, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= all.length) idx = 0;
    const keyword = all[idx];

    // ★ 新一轮搜索作废旧任务：旧任务卡在 sendMessage 时再点搜索，不会双任务互踩 state
    this._searchGen = (this._searchGen || 0) + 1;

    const searchState = {
      searching: true,
      keywords: [keyword],            // 只搜这一个词
      currentKeywordIdx: 0,
      currentKeyword: keyword,
      foundNotes: [],
      totalKeywords: 1,
      completedKeywords: 0,
      kwIdx: idx,                     // 该词在完整列表中的位置
      kwTotal: all.length,            // 完整列表长度（用于 UI 显示第几个/共几个）
      searchStartedAt: Date.now(),    // popup 超时兜底用
    };
    await Storage.setAutoWaterState({
      phase: 'IDLE',
      searchState,
      searchResults: null,
      logs: [],
      error: null,
    });
    console.log('[一键灌水] 开始搜索当前词: "' + keyword + '"（列表第 ' + (idx + 1) + '/' + all.length + '）');

    this._doSearchNotes().catch(err => {
      console.error('[一键灌水] searchNotes 异常:', err);
      this._syncError(err).catch(() => {});
    });
    return { ok: true, keyword: keyword, kwIdx: idx, kwTotal: all.length };
  },

  /* 取消搜索 */
  async cancelSearch() {
    const state = await Storage.getAutoWaterState();
    if (state.searchState) {
      state.searchState.searching = false;
      await Storage.setAutoWaterState(state);
    }
    return { ok: true };
  },

  /* ── 单篇打开笔记（模拟用户点击笔记链接，触发 SPA 路由跳转） ─── */
  async openNote(note) {
    if (!note || !note.noteId) {
      return { ok: false, error: '笔记信息不完整', stage: 'params' };
    }

    const item = {
      noteId: note.noteId,
      url: note.url || `https://www.xiaohongshu.com/explore/${note.noteId}`,
      title: note.title || '',
      author: note.author || '',
    };

    console.log('[一键灌水] openNote:', item.title);
    const tab = await this._getXhsTab();
    if (!tab) {
      return { ok: false, error: '未找到小红书标签页', stage: 'tab' };
    }

    // ★★ 关键：先把小红书标签页切到前台并聚焦窗口。
    //   小红书评论区是懒加载（靠元素进入可视区触发）；标签页留在后台时浏览器会节流，
    //   评论区根本不渲染/不加载 → 抓不到评论。这正是“手动进没事、列表打开抓不到”的坑。
    //   激活后等一小会儿让页面从节流态恢复、开始渲染。
    // ★ 切前台前先记住“用户原来在哪个窗口/标签”，等评论加载完后由 popup 切回去（见 refreshData）。
    try {
      const prev = await chrome.windows.getLastFocused({ populate: true });
      const act = (prev.tabs || []).find(t => t.active);
      await chrome.storage.local.set({
        _focus_restore: { windowId: prev.id, tabId: act ? act.id : null, ts: Date.now() },
      });
    } catch (e) {
      console.warn('[一键灌水] 记录原窗口失败:', e);
    }
    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      await this._sleep(300);
    } catch (e) {
      console.warn('[一键灌水] 激活标签页失败（继续尝试）:', e);
    }

    try {
      // 模拟用户点击笔记链接 -> SPA 客户端路由跳转
      // 生成 trusted click event，XHS 无法区分是真用户还是脚本
      const resp = await this._send(tab.id, { action: 'clickNoteLink', title: item.title, noteId: item.noteId, rawLinkIndex: note.rawLinkIndex }, 15000);
      if (resp && resp.clicked) {
        console.log('[一键灌水] 已点击笔记链接, method:', resp.method);
        // 点击后轮询笔记详情页“就绪”（有评论区/回复框）；未就绪则自动重试点击——
        // 搜索结果页刚加载完 SPA 路由可能未绑定、列表还在虚拟滚动重排，编程点击常被吞掉，
        // 第二次点击时页面已稳定，成功率大增（最多重试 2 次，总上限 20 秒）
        const buffer = await this._dwell('noteOpenBuffer', 300);
        await this._sleep(buffer);
        const _t0 = Date.now();
        let ready = await this._waitNoteReady(tab.id, 4000);
        let retries = 0;
        while (!ready && retries < 2 && Date.now() - _t0 < 20000) {
          retries++;
          console.log(`[一键灌水] 笔记未就绪（${Math.round((Date.now() - _t0) / 100) / 10}s），第 ${retries} 次重试点击...`);
          try {
            await this._send(tab.id, { action: 'clickNoteLink', title: item.title, noteId: item.noteId, rawLinkIndex: note.rawLinkIndex }, 15000);
          } catch (_) {}
          await this._sleep(500);
          ready = await this._waitNoteReady(tab.id, 4000);
        }
        const waitedMs = Date.now() - _t0;
        console.log('[一键灌水] 笔记就绪状态:', ready, '重试次数:', retries, '等待(ms):', waitedMs);
        return { ok: true, success: true, message: '已打开笔记', noteTitle: item.title, noteId: item.noteId, ready: ready, waitedMs: waitedMs };
      }
      // ★ CTRL+F 三次都没点中：绝不降级为直接甩 URL（冷开 /explore/ 极易触发反爬），直接跳过本篇
      console.log('[一键灌水] clickNoteLink 未命中，跳过本篇（不降级导航）');
      return { ok: false, skipped: true, error: '未定位到笔记（CTRL+F 试了 3 次仍未命中），已跳过', noteTitle: item.title, noteId: item.noteId };
    } catch (e) {
      // content script 不可用（常见于扩展重载后旧标签页脚本丢失）：重新注入 content.js 再试一次，
      // 而不是直接跳过——否则重载扩展后第一次点开任何笔记都会“页面脚本不可用”
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await this._sleep(300);
        const retry = await this._send(tab.id, { action: 'clickNoteLink', title: item.title, noteId: item.noteId, rawLinkIndex: note.rawLinkIndex }, 15000);
        if (retry && retry.clicked) {
          // 与上方主路径一致：未就绪则重试点击（最多 2 次，总上限 20 秒）
          const buffer = await this._dwell('noteOpenBuffer', 300);
          await this._sleep(buffer);
          const _t1 = Date.now();
          let ready = await this._waitNoteReady(tab.id, 4000);
          let retries = 0;
          while (!ready && retries < 2 && Date.now() - _t1 < 20000) {
            retries++;
            try {
              await this._send(tab.id, { action: 'clickNoteLink', title: item.title, noteId: item.noteId, rawLinkIndex: note.rawLinkIndex }, 15000);
            } catch (_) {}
            await this._sleep(500);
            ready = await this._waitNoteReady(tab.id, 4000);
          }
          console.log('[一键灌水] 重注入 content.js 后重试打开成功, 就绪:', ready, '重试次数:', retries);
          return { ok: true, success: true, message: '已打开笔记', noteTitle: item.title, noteId: item.noteId, ready: ready, waitedMs: buffer + (Date.now() - _t1) };
        }
        return { ok: false, skipped: true, error: '未定位到笔记（CTRL+F 试了 3 次仍未命中），已跳过', noteTitle: item.title, noteId: item.noteId };
      } catch (e2) {
        // 重注入后仍不可用：不降级导航，直接跳过本篇
        console.log('[一键灌水] content script 不可用（重注入后仍失败）:', e2.message);
        return { ok: false, skipped: true, error: '页面脚本不可用，已跳过', noteTitle: item.title, noteId: item.noteId };
      }
    }
  },

  /* ─── 翻下一屏（方案A）：在当前搜索结果页再往下滚动一屏，重新提取“当前可见快照”，
   * 替换 searchResults / foundNotes（列表永远=当前可见项，绝不累积滚动后的离线卡片 → 根除“CTRL+F 找不到”脱节）。
   * 返回 { ok, hasMore, newNotes }；hasMore=false 表示已滚动到底。 */
  async advanceResults() {
    const tab = await this._getXhsTab();
    if (!tab) return { ok: false, error: '未找到小红书标签页' };
    if (!/\/search_result/.test(tab.url || '')) {
      return { ok: false, error: '当前不在搜索结果页，无法加载下一屏' };
    }
    let more = null;
    try { more = await this._send(tab.id, { action: 'scrollLoadMore' }, 15000); }
    catch (e) { return { ok: false, error: '滚动加载失败: ' + (e && e.message ? e.message : e) }; }
    const notes = (more && more.notes) || [];
    const hasMore = !!(more && more.hasMore);
    // 用当前可见快照整体替换列表（不跨屏累积），保证后续打开的一定在 DOM 里可定位
    try {
      const st = await Storage.getAutoWaterState();
      if (st.searchState) {
        st.searchState.foundNotes = notes;
        st.searchState.searchResults = notes;
        st.searchState.searching = false;
        await Storage.setAutoWaterState(st);
      }
    } catch (e) {
      console.warn('[一键灌水] advanceResults 更新状态失败:', e);
    }
    return { ok: true, hasMore, newNotes: notes.length };
  },

  /* ─── 内部：遍历所有关键词搜索笔记 ───
   * ★ 防卡死三件套：
   *   1. 所有 tabs.sendMessage 走 _send 带超时（页面繁忙/content script 卡死不再无限等）
   *   2. 导航异常（标签页被关等）catch 后跳过该关键词，不中断整轮
   *   3. try/finally 收尾：无论正常完成/中途异常/被新任务取代，当前任务若仍是“最新”就关闭 searching 并落 searchResults
   *      （否则 searching 永远 true，popup 永久显示“正在搜索”） */
  async _doSearchNotes() {
    const gen = this._searchGen || 0;
    try {
      let state = await Storage.getAutoWaterState();
      const keywords = state.searchState?.keywords || [];
      if (keywords.length === 0) return;

      for (let i = 0; i < keywords.length; i++) {
        state = await Storage.getAutoWaterState();
        if (!state.searchState?.searching || gen !== this._searchGen) {
          console.log('[一键灌水] _doSearchNotes: 搜索被中断或被新任务取代');
          return;
        }

        const keyword = keywords[i];
        state.searchState.currentKeyword = keyword;
        state.searchState.currentKeywordIdx = i;
        await Storage.setAutoWaterState(state);
        console.log('[一键灌水] 搜索关键词:', keyword, '(' + (i + 1) + '/' + keywords.length + ')');

        const tab = await this._getXhsTab();
        if (!tab) {
          console.error('[一键灌水] 未找到小红书标签页');
          continue;
        }

        const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_search_result_note';
        console.log('[一键灌水] [诊断] 导航搜索URL:', searchUrl, '| 当前tab:', tab.url);
        try {
          await chrome.tabs.update(tab.id, { url: searchUrl });
          await this._waitForTabLoad(tab.id, 15000);
        } catch (navErr) {
          // 标签页被关闭等导航异常：跳过该关键词（外层 finally 保证状态收尾）
          console.error('[一键灌水] 导航到搜索页失败，跳过关键词:', navErr.message);
          continue;
        }

        let results;
        try {
          results = await this._send(tab.id, { action: 'extractSearchResults' }, 15000);
        } catch (e) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js'],
            });
            await this._sleep(1000);
            results = await this._send(tab.id, { action: 'extractSearchResults' }, 15000);
          } catch (e2) {
            console.error('[一键灌水] 提取搜索结果失败:', e2);
            continue;
          }
        }

        if (!results || !results.notes || results.notes.length === 0) {
          console.log('[一键灌水] 关键词无结果:', keyword);
          state = await Storage.getAutoWaterState();
          if (state.searchState) {
            state.searchState.completedKeywords = i + 1;
            state.searchState.currentKeyword = keyword;
            await Storage.setAutoWaterState(state);
          }
          continue;
        }

        // ★ 方案A：初始只提取【当前可见首屏】，不再提前滚动累积。
        //   小红书搜索页是虚拟瀑布流，顶部卡片滚过后会被回收 → 累积的“离线卡片”打开时 CTRL+F 必找不到。
        //   更深的笔记改由冷启动机器人/AutoWater.advanceResults() 滚动加载下一屏时再逐屏替换进来（列表永远=可见）。

        state = await Storage.getAutoWaterState();
        if (!state.searchState) return;

        // 归一化标题作为去重键（定位笔记按标题 CTRL+F，同标题留多份没意义）
        //   标题为空/无标题时回退用 noteId，避免多篇空标题被误并成一篇。
        const _titleKey = function (n) {
          const t = (n.title || '').replace(/\s+/g, '').trim();
          return t && t !== '无标题' ? 't:' + t : 'id:' + (n.noteId || '');
        };

        let addedCount = 0;
        // 已入库标题集（跨关键词也按标题去重）
        const existingKeys = new Set(state.searchState.foundNotes.map(_titleKey));
        for (const note of (results.notes || [])) {
          const k = _titleKey(note);
          if (!existingKeys.has(k)) {
            state.searchState.foundNotes.push({
              noteId: note.noteId,
              url: note.url || 'https://www.xiaohongshu.com/explore/' + note.noteId,
              title: note.title || '无标题',
              author: note.author || '未知',
              likes: note.likes || '',
              stats: note.stats || [], // 卡片统计全量（点赞/收藏/评论，按 DOM 顺序，平台不拆分语义）
              keyword: keyword,
              searchIndex: note.searchIndex,
              rawLinkIndex: note.rawLinkIndex,
              linkHref: note.linkHref,
              watered: await Storage.isNoteWatered(note.noteId),
            });
            existingKeys.add(k);
            addedCount++;
          }
        }

        state.searchState.completedKeywords = i + 1;
        state.searchState.currentKeyword = keyword;
        await Storage.setAutoWaterState(state);
        console.log('[一键灌水] 关键词 "' + keyword + '" 完成: 新增 ' + addedCount + ' 篇, 累计 ' + state.searchState.foundNotes.length + ' 篇');
      }
    } finally {
      // ★ 收尾：只有自己仍是“最新任务”才关闭 searching + 落 searchResults（新任务的 state 不能被误清）
      try {
        const st = await Storage.getAutoWaterState();
        if (st.searchState && gen === this._searchGen) {
          st.searchState.searching = false;
          st.searchState.completedKeywords = (st.searchState.keywords || []).length;
          st.searchResults = st.searchState.foundNotes;
          await Storage.setAutoWaterState(st);
          console.log('[一键灌水] 搜索结束（收尾），共找到 ' + (st.searchResults?.length || 0) + ' 篇笔记');
        }
      } catch (finalErr) {
        console.error('[一键灌水] 搜索收尾失败:', finalErr);
      }
    }
  },

  /* ─── 工具方法 ─── */

  /* 带超时的 tabs.sendMessage：页面导航中/主线程繁忙/content script 卡死时不再无限等待。
     超时或接收端不存在 → reject，由调用方 catch 走跳过/重试分支 */
  _send(tabId, msg, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        reject(new Error('内容脚本响应超时（' + (msg && msg.action || '?') + '）'));
      }, timeoutMs || 10000);
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });
  },

  async _getXhsTab() {
    const activeTabs = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*', active: true });
    if (activeTabs.length > 0) {
      console.log('[一键灌水] 使用当前活跃标签页:', activeTabs[0].id);
      return activeTabs[0];
    }
    const tabs = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' });
    if (tabs.length > 0) {
      console.log('[一键灌水] 使用已打开的 XHS 标签页:', tabs[0].id);
      return tabs[0];
    }
    console.log('[一键灌水] 未找到 XHS 标签页，创建新标签页');
    const tab = await chrome.tabs.create({ url: 'https://www.xiaohongshu.com' });
    await this._waitForTabLoad(tab.id, 10000);
    return tab;
  },

  _waitForTabLoad(tabId, timeoutMs) {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() {
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

  _sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  },

  /* 停留时间配置（设置页「⏱️ 停留时间」，存 delay_config，默认 0）：
   实际停留 = 区间随机 min~max（更防爬）；floor 为技术下限。
   兼容旧数值 n → min=n、max≈n*1.6 */
  async _dwell(key, floor) {
    let c;
    try {
      const r = await chrome.storage.local.get('delay_config');
      c = (r.delay_config || {})[key];
    } catch (_) { c = undefined; }
    let minV = 0, maxV = 0;
    if (c && typeof c === 'object') { minV = Math.max(0, Number(c.min) || 0); maxV = Math.max(0, Number(c.max) || 0); }
    else { minV = maxV = Math.max(0, Number(c) || 0); if (maxV) maxV = Math.round(maxV * 1.6); }
    let v = 0;
    if (maxV > minV) v = minV + Math.random() * (maxV - minV);
    else v = minV;
    return Math.max(floor || 0, v);
  },

  /* ── 轮询等待笔记详情页就绪（有评论区/回复框，不是卡片过渡态） ──
     就绪了就立即返回 true（快）；超时仍未就绪返回 false（交给上层自愈重试） */
  async _waitNoteReady(tabId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 8000);
    while (Date.now() < deadline) {
      try {
        const r = await this._send(tabId, { action: 'checkNoteReady' }, 6000);
        if (r && r.ready) return true;
      } catch (_) {
        // content.js 还没注入/页面切换中，稍后重试
      }
      await this._sleep(500);
    }
    return false;
  },

  _log(state, msg) {
    var entry = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    if (!state.logs) state.logs = [];
    state.logs.push(entry);
    if (state.logs.length > 100) state.logs = state.logs.slice(-100);
    console.log('[一键灌水] ' + msg);
    Storage.setAutoWaterState(state);
  },

  /* 将错误同步写入 state */
  async _syncError(err) {
    try {
      var state = await Storage.getAutoWaterState();
      state.phase = PHASE.ERROR;
      state.error = err.message || String(err);
      await Storage.setAutoWaterState(state);
    } catch (_) {}
  },
};

if (typeof module !== 'undefined') {
  module.exports = AutoWater;
}
