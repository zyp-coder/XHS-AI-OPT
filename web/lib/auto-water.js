/**
 * auto-water.js — 笔记搜索 + 已灌水状态检查
 * 运行在 background service worker 上下文
 * 职责：关键词搜索笔记、标记已灌水状态
 * 注意：自动灌水/AI筛选/调度功能已移除（功能策略调整）；
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
      perRound: Number(config.schedule?.perRound) || 0,   // 0=不限（真源＝note_trend_config.maxPerRound）
      keywords: config.keywords || [],
    };
  },

  /* ── 搜索笔记：一次只搜“当前目标词”，默认按该词「到点该跑的类型」逐个搜：
     最新 1 搜 + TOP（每个勾选排序各 1 搜）+ 本地 1 搜 + 求助（每个求助词各 1 搜）
     不批量遍历所有关键词（避免反复刷新小红书页）
     opts.kw       队列点单：就搜这个词（不用列表指针，也不顺延到别的词）
     opts.scenario 前台手点了某一类（获客页的类型按钮）→ 只搜这一类、立刻搜、不顺延到别的词
     opts.force    忽略“到点”判断 ─── */
  async searchNotes(opts) {
    const o = opts || {};
    const only = o.scenario ? String(o.scenario) : '';
    // ★ 盯的账号（👤）：o.profile = 博主主页链接 → 直接开他的主页扒最近的笔记，
    //   不搜词、不看词池、不碰列表指针（词池空也照样跑）
    const acctUrl = String(o.profile || '').trim();
    const config = await Storage.getAutoWaterConfig();
    console.log('[一键灌水] searchNotes - 读取到配置:', JSON.stringify(config));
    let all = (config.keywords || []).filter(Boolean);
    if (acctUrl) all = [String(o.label || '').trim() || acctUrl];
    if (all.length === 0) {
      return { ok: false, error: '请先在左上方输入框填写搜索关键词，再按回车/点搜索' };
    }
    // 当前目标词 = 列表指针 kwIdx（0 起），越界回 0
    let start = parseInt(config.schedule && config.schedule.kwIdx, 10);
    if (!Number.isFinite(start) || start < 0 || start >= all.length) start = 0;
    // ★ 队列跑的是「词 × 类型」这一项：词直接来自队列项，必须精确命中，不能顺延
    if (o.kw && !acctUrl) {
      const want = String(o.kw).trim();
      const at = all.indexOf(want);
      if (at < 0) return { ok: false, error: '「' + want + '」不在启用词里（可能被停用/移除了）：去「🎯 获客 → 任务配置 → 📚 关键词池」重新勾上' };
      start = at;
    }

    // ★ 一个关键词 → N 个搜索动作（类型 × 筛选）：与截流「扫描一轮」共用同一套派生规则
    //   只有"到点该搜"的类型才进清单（节奏在「任务配置 → 📚 关键词池」表头整列设）；
    //   本词一个动作都没到点 → 顺延到下一个词；全都没到点 → 直接提示，不白刷小红书页
    let scanCfg = null;
    try { scanCfg = await drainGetScanCfg(); } catch (e) {
      console.warn('[一键灌水] 读取扫描来源失败，回退只搜最新:', (e && e.message) || e);
    }
    let idx = -1, plan = [];
    const skipped = [];
    if (acctUrl) {
      // 盯的账号：一个主页 = 一个动作（kind=profile → 开他的主页，不搜词）
      idx = 0;
      plan = [{ kind: 'profile', k: acctUrl, term: acctUrl, sort: '', scenario: drainScenarioId(o.scenario || 'highv') }];
    } else if (scanCfg && only) {
      // 前台手点：只认这一个类型，也不顺延（她点的就是这个词这类）
      let p = [];
      try { p = drainKeywordPasses(all[start], scanCfg, 0, { only, force: true }); } catch (_) { p = []; }
      if (!p.length) {
        const meta = (typeof DRAIN_TYPE_META !== 'undefined') ? DRAIN_TYPE_META.find(m => m.scenario === only) : null;
        if (meta && meta.needCity && !String(scanCfg.city || '').trim()) {
          return { ok: false, error: '「' + all[start] + '」要搜「' + (drainPassLabel({ scenario: only }) || only) + '」，但还没设城市：「📍本地」搜的是「账号规划 → 基础配置」里的同城城市，去那里抓一下主页或手填。' };
        }
        return { ok: false, error: '「' + all[start] + '」没勾「' + (drainPassLabel({ scenario: only }) || only) + '」这一类：到「任务配置 → 📚 关键词池」把这个词这一列的格勾上，或换一个词。' };
      }
      idx = start; plan = p;
    } else if (scanCfg && o.kw) {
      // 队列点单（没指定类型时才走这）：就跑这个词「到点该跑的类型」，一个都没到点也不换词
      let p = [];
      try { p = drainKeywordPasses(all[start], scanCfg, 0, { force: !!o.force }); } catch (_) { p = []; }
      if (!p.length) {
        return { ok: false, error: '「' + all[start] + '」的搜索动作还没到点：到「任务配置 → 📚 关键词池」表头把这列的节奏改成「每轮跑」，或等「隔N小时」到点再来。' };
      }
      idx = start; plan = p;
    } else if (scanCfg) {
      for (let n = 0; n < all.length; n++) {
        const i = (start + n) % all.length;
        let p = [];
        try { p = drainKeywordPasses(all[i], scanCfg); } catch (_) { p = []; }
        if (p.length) { idx = i; plan = p; break; }
        skipped.push(all[i]);
      }
    }
    if (idx < 0) {
      if (scanCfg) {
        return {
          ok: false,
          error: '「' + skipped.join('、') + '」的搜索动作都还没到点：到「任务配置 → 📚 关键词池」表头把这列的节奏改成「每轮跑」，或等「隔N小时」到点再来；也可以直接在词标签上选类型手点一个词，立刻搜这一类。',
        };
      }
      idx = start;
      plan = [{ scenario: 'latest', term: all[idx], sort: 'latest' }];
    }
    const keyword = all[idx];
    if (skipped.length) console.log('[一键灌水] 跳过未到点的词: ' + skipped.join('、') + ' → 改搜 "' + keyword + '"');
    // 指针推进到实际要搜的词，下次点搜索从这里接着走（盯的账号不占词池指针）
    if (!acctUrl && idx !== start) {
      try {
        const raw = await chrome.storage.local.get('auto_water_config');
        const aw = raw['auto_water_config'] || {};
        aw.schedule = aw.schedule || {};
        aw.schedule.kwIdx = idx;
        await chrome.storage.local.set({ auto_water_config: aw });
      } catch (_) {}
    }

    // ★ 新一轮搜索作废旧任务：旧任务卡在 sendMessage 时再点搜索，不会双任务互踩 state
    this._searchGen = (this._searchGen || 0) + 1;

    const searchState = {
      searching: true,
      keywords: [keyword],            // 只搜这一个词
      currentKeywordIdx: 0,
      currentKeyword: keyword,
      plan,                           // 本词的搜索动作清单（一个词 N 搜）
      planIdx: 0,
      planTotal: plan.length,
      typeStats: {},                  // { latest: { found: 12 }, top: {...} } 供前台逐类显示
      foundNotes: [],
      totalKeywords: 1,
      completedKeywords: 0,
      kwIdx: acctUrl ? null : idx,    // 该词在完整列表中的位置（盯的账号不占词池指针 → null）
      kwTotal: acctUrl ? null : all.length,   // 完整列表长度（用于 UI 显示第几个/共几个）
      acct: !!acctUrl,                // 这一趟是"进某人主页扒笔记"（不是搜词）
      scenario: plan[0].scenario,
      searchStartedAt: Date.now(),    // popup 超时兜底用
    };
    await Storage.setAutoWaterState({
      phase: 'IDLE',
      searchState,
      searchResults: null,
      logs: [],
      error: null,
    });
    console.log('[一键灌水] 开始' + (acctUrl ? '盯主页' : '搜索当前词') + ': "' + keyword + '"（列表第 ' + (idx + 1) + '/' + all.length + '），本趟 ' + plan.length + ' 个动作: ' + plan.map(p => drainPassLabel(p)).join(' / '));

    this._doSearchNotes().catch(err => {
      console.error('[一键灌水] searchNotes 异常:', err);
      this._syncError(err).catch(() => {});
    });
    return { ok: true, keyword: keyword, kwIdx: idx, kwTotal: all.length, acct: !!acctUrl, planTotal: plan.length, plan: plan.map(p => drainPassLabel(p)) };
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

  /* ─── 按「标题搜出来 → 匹配作者 → 点开」打开笔记（当前页没这张卡片时的通路，替代冷开 /explore/） ───
     ① 先让页面像真人一样用页头搜索框搜标题，再在结果里按 noteId/标题+作者 匹配后点开；
     ② 页内没搜成（当前页连搜索框都没有，或页面中途真刷新了）→ 由背景侧导航到搜索页（普通搜索 URL）再点一次。
     返回 { ok, via, noteId } 或 { ok:false, error } */
  async _openBySearch(tab, item) {
    const title = String((item && item.title) || '').trim();
    const author = String((item && item.author) || '').trim();
    const noteId = String((item && item.noteId) || '').trim();
    if (!title) return { ok: false, error: '这篇没标题，搜不了名字' };

    let resp = null;
    try {
      resp = await this._send(tab.id, { action: 'openNoteBySearch', title, author, noteId }, 45000);
    } catch (e) {
      console.warn('[一键灌水] 页内搜索打开失败:', e && e.message ? e.message : e);
    }
    if (resp && resp.ok) return { ok: true, via: 'search:' + (resp.matchedBy || '?'), noteId: resp.noteId || noteId };
    // 页面明确说「搜过了、就是没匹配上」→ 不再折腾导航（省一轮 20 秒往返）；miss=true 表示"确实搜不到"（截流列表据此作废）
    if (resp && resp.searched) return { ok: false, error: resp.error || '搜索结果里没匹配上这篇', miss: !!resp.miss };

    // 导航到搜索页时要用页面算好的同一个搜索词（「标题末尾减3字」），没有就用整条标题兜底
    const url = DRAIN_SEARCH_URL((resp && resp.term) || title);
    console.log('[一键灌水] 页内搜不了，导航到搜索页再点开:', title);
    try {
      await chrome.tabs.update(tab.id, { url });
      await this._waitForTabLoad(tab.id, 20000);
      await this._sleep(1200);
    } catch (e) {
      return { ok: false, error: '打开搜索页失败: ' + (e && e.message ? e.message : e) };
    }
    let resp2 = null;
    try {
      resp2 = await this._send(tab.id, { action: 'openNoteBySearch', title, author, noteId, resultsReady: true }, 40000);
    } catch (e) {
      return { ok: false, error: '搜索结果页没响应: ' + (e && e.message ? e.message : e) };
    }
    if (resp2 && resp2.ok) return { ok: true, via: 'search-nav:' + (resp2.matchedBy || '?'), noteId: resp2.noteId || noteId };
    return { ok: false, error: (resp2 && resp2.error) || '搜索结果里没匹配上这篇', miss: !!(resp2 && resp2.miss) };
  },

  /* ── 单篇打开笔记（模拟用户点击笔记链接，触发 SPA 路由跳转） ─── */
  async openNote(note) {
    // ★ 允许只有标题没 ID 的笔记（截流列表里的旧笔记常有标题没 ID）：走搜索通路即可打开
    if (!note || (!note.noteId && !note.title)) {
      return { ok: false, error: '笔记信息不完整（既没有 ID 也没有标题）', stage: 'params' };
    }

    const item = {
      noteId: note.noteId || '',
      url: note.url || (note.noteId ? `https://www.xiaohongshu.com/explore/${note.noteId}` : ''),
      title: note.title || '',
      author: note.author || '',
    };

    await handleDrainTrackNote(note);
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

    // ★ 点开后轮询笔记详情页“就绪”（有评论区/回复框）；未就绪则自愈重试（最多 2 次，总上限 20 秒）。
    //   搜索结果页刚加载完 SPA 路由可能未绑定、列表还在虚拟滚动重排，编程点击常被吞掉，
    //   第二次点击时页面已稳定，成功率大增。retryFn 传哪个通路的“再开一次”。
    const _awaitReady = async (t0, retryFn) => {
      const buffer = await this._dwell('noteOpenBuffer', 300);
      await this._sleep(buffer);
      let ready = await this._waitNoteReady(tab.id, 4000);
      let retries = 0;
      while (!ready && retries < 2 && Date.now() - t0 < 20000) {
        retries++;
        console.log(`[一键灌水] 笔记未就绪（${Math.round((Date.now() - t0) / 100) / 10}s），第 ${retries} 次重试打开...`);
        if (retryFn) { try { await retryFn(); } catch (_) {} }
        await this._sleep(500);
        ready = await this._waitNoteReady(tab.id, 4000);
      }
      const waitedMs = Date.now() - t0;
      console.log('[一键灌水] 笔记就绪状态:', ready, '重试次数:', retries, '等待(ms):', waitedMs);
      return { ready, retries, waitedMs };
    };
    const _clickMsg = { action: 'clickNoteLink', title: item.title, noteId: item.noteId, rawLinkIndex: note.rawLinkIndex };

    try {
      // ①：当前搜索结果页里就有这张卡片 → 直接点（最快最准，保持原通路）
      // 生成 trusted click event，XHS 无法区分是真用户还是脚本
      if (item.noteId) {
        let resp = null;
        try { resp = await this._send(tab.id, _clickMsg, 15000); }
        catch (e) { console.warn('[一键灌水] 点击笔记链接失败（转搜索通路）:', e && e.message ? e.message : e); }
        if (resp && resp.clicked) {
          console.log('[一键灌水] 已点击笔记链接, method:', resp.method);
          const r = await _awaitReady(Date.now(), () => this._send(tab.id, _clickMsg, 15000));
          return { ok: true, success: true, message: '已打开笔记', noteTitle: item.title, noteId: item.noteId, ready: r.ready, waitedMs: r.waitedMs, via: 'click' };
        }
        console.log('[一键灌水] 当前页没有这张卡片 → 改走「搜标题 → 匹配作者 → 点开」通路');
      }

      // ②：搜索通路（列表里的旧笔记、只有标题没 ID 的笔记都走这里；不再冷开 /explore/）
      const t1 = Date.now();
      const alt = await this._openBySearch(tab, item);
      if (alt.ok) {
        console.log('[一键灌水] ✅ 搜索通路打开成功（' + alt.via + '）:', item.title);
        const r = await _awaitReady(t1, () => this._openBySearch(tab, item));
        return { ok: true, success: true, message: '已打开笔记（搜索通路）', noteTitle: item.title, noteId: alt.noteId || item.noteId, ready: r.ready, waitedMs: Date.now() - t1, via: 'search' };
      }
      return { ok: false, skipped: true, error: alt.error || '没能在搜索结果里匹配到这篇笔记', noteTitle: item.title, noteId: item.noteId };
    } catch (e) {
      // content script 不可用（常见于扩展重载后旧标签页脚本丢失）：重新注入 content.js 再试一次，
      // 而不是直接跳过——否则重载扩展后第一次点开任何笔记都会“页面脚本不可用”
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await this._sleep(300);
        const t2 = Date.now();
        const alt = await this._openBySearch(tab, item);
        if (alt.ok) {
          const r = await _awaitReady(t2, () => this._openBySearch(tab, item));
          console.log('[一键灌水] 重注入 content.js 后重试打开成功, 就绪:', r.ready, '重试次数:', r.retries);
          return { ok: true, success: true, message: '已打开笔记（搜索通路·重注入后）', noteTitle: item.title, noteId: alt.noteId || item.noteId, ready: r.ready, waitedMs: Date.now() - t2, via: 'search' };
        }
        return { ok: false, skipped: true, error: alt.error || '未能在搜索结果里匹配到这篇笔记，已跳过', noteTitle: item.title, noteId: item.noteId };
      } catch (e2) {
        // 重注入后仍不可用：跳过本篇
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
    // 本屏与首屏同属一次关键词搜索 → 沿用当前搜索类型（最新笔记 / 搜索TOP）
    let curSc = 'latest';
    try { const st0 = await Storage.getAutoWaterState(); curSc = (st0.searchState && st0.searchState.scenario) || 'latest'; } catch (_) {}
    notes.forEach(n => { n.scenario = curSc; });
    await handleDrainTrackNotes({ notes });
    // 用当前可见快照整体替换列表（不跨屏累积），保证后续打开的一定在 DOM 里可定位
    try {
      const st = await Storage.getAutoWaterState();
      if (st.searchState) {
        st.searchState.foundNotes = notes;
        st.searchResults = notes;
        st.searchState.searching = false;
        await Storage.setAutoWaterState(st);
      }
    } catch (e) {
      console.warn('[一键灌水] advanceResults 更新状态失败:', e);
    }
    return { ok: true, hasMore, newNotes: notes.length };
  },

  /* ─── 从当前搜索结果里删掉一篇（工作台笔记列表的 🗑，2026-09-25 三十一改）───
   * 只动列表快照（searchResults / searchState.foundNotes）：笔记池（截流池）与灌水记录都不动，
   * 删了只是"这一趟搜索里不再排它"。执行器跑着的时候调用方会拦住（列表正被翻屏整体替换）。 */
  async removeSearchResult(data) {
    const noteId = String((data && data.noteId) || '');
    const url = String((data && data.url) || '').split('?')[0];
    if (!noteId && !url) return { ok: false, error: '缺 noteId / url' };
    const hit = (n) => !!n && (
      (noteId && String(n.noteId || '') === noteId) ||
      (url && String(n.url || '').split('?')[0] === url)
    );
    try {
      const st = await Storage.getAutoWaterState();
      const before = (st.searchResults || []).length;
      st.searchResults = (st.searchResults || []).filter(n => !hit(n));
      if (st.searchState && Array.isArray(st.searchState.foundNotes)) {
        st.searchState.foundNotes = st.searchState.foundNotes.filter(n => !hit(n));
      }
      await Storage.setAutoWaterState(st);
      return { ok: true, removed: Math.max(0, before - (st.searchResults || []).length) };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  },

  /* ─── 内部：按搜索动作清单逐个搜（当前关键词 × 派生类型/筛选） ───
   * ★ 防卡死三件套：
   *   1. 所有 tabs.sendMessage 走 _send 带超时（页面繁忙/content script 卡死不再无限等）
   *   2. 导航异常（标签页被关等）catch 后跳过本搜，不中断整轮
   *   3. try/finally 收尾：无论正常完成/中途异常/被新任务取代，当前任务若仍是“最新”就关闭 searching 并落 searchResults
   *      （否则 searching 永远 true，popup 永久显示“正在搜索”） */
  async _doSearchNotes() {
    const gen = this._searchGen || 0;
    try {
      let state = await Storage.getAutoWaterState();
      const plan = state.searchState?.plan || [];
      if (!plan.length) return;
      const keyword = state.searchState.currentKeyword || '';

      // ★ 排序/类型由搜索动作清单自带（最新 / 点赞最多 / …）；搜索页不再勾「未看过」范围筛选
      //   （去重靠笔记池的冷却/复核，跟截流那条通路口径一致）
      const typeStats = {};   // 类型累计（最新/TOP/本地/求助各找到几篇）
      const passStats = [];   // 每一搜找到几篇（与 plan 下标对齐）

      for (let i = 0; i < plan.length; i++) {
        state = await Storage.getAutoWaterState();
        if (!state.searchState?.searching || gen !== this._searchGen) {
          console.log('[一键灌水] _doSearchNotes: 搜索被中断或被新任务取代');
          return;
        }

        const pass = plan[i];
        passStats[i] = 0;
        state.searchState.planIdx = i;
        state.searchState.scenario = pass.scenario;
        state.searchState.typeStats = typeStats;
        state.searchState.passStats = passStats;
        await Storage.setAutoWaterState(state);
        console.log('[一键灌水] 搜索动作 ' + (i + 1) + '/' + plan.length + ': ' + drainPassLabel(pass) + ' → ' + pass.term);

        const tab = await this._getXhsTab();
        if (!tab) {
          console.error('[一键灌水] 未找到小红书标签页');
          continue;
        }

        // ★ 盯的账号（kind=profile）：开他的个人主页；词（kind 缺省）才拼搜索 URL
        const isProfile = pass.kind === 'profile';
        const searchUrl = isProfile
          ? (String(pass.term).startsWith('http') ? String(pass.term) : 'https://www.xiaohongshu.com' + String(pass.term))
          : DRAIN_SEARCH_URL(pass.term);
        console.log('[一键灌水] [诊断] 导航URL:', searchUrl, '| 当前tab:', tab.url);
        try {
          await chrome.tabs.update(tab.id, { url: searchUrl });
          await this._waitForTabLoad(tab.id, 15000);
        } catch (navErr) {
          // 标签页被关闭等导航异常：跳过本搜（外层 finally 保证状态收尾）
          console.error('[一键灌水] 导航到搜索页失败，跳过本搜:', navErr.message);
          continue;
        }

        // ★ 按本搜的排序筛一遍搜索页，失败只降级不阻塞
        //   主页没有排序筛选这回事，跳过（主页本来就按时间倒序）
        const sortKey = isProfile ? '' : (pass.sort || '');
        if (sortKey) {
          try {
            await this._send(tab.id, { action: 'applySearchFilter', sortKey }, 8000);
            await this._sleep(900);
          } catch (fe) {
            console.warn('[一键灌水] 应用搜索排序失败(忽略): sort=' + sortKey, fe && fe.message || fe);
          }
        }

        // ★ 记「这个词 × 这个类型刚跑过」：词池里设成「隔几小时跑」的据此算下次到点时间
        //   盯的账号记在主页链接上（drainAccountState 按同一个键查）
        try { await drainMarkPassRan(pass.k || keyword, pass.scenario); } catch (me) {
          console.warn('[一键灌水] 记录搜索时间失败(忽略):', (me && me.message) || me);
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
          console.log('[一键灌水] 本搜无结果:', drainPassLabel(pass), '|', pass.term);
          state = await Storage.getAutoWaterState();
          if (state.searchState) {
            state.searchState.planIdx = i;
            state.searchState.typeStats = typeStats;
            state.searchState.passStats = passStats;
            await Storage.setAutoWaterState(state);
          }
          continue;
        }

        // ★ 方案A：初始只提取【当前可见首屏】，不再提前滚动累积。
        //   小红书搜索页是虚拟瀑布流，顶部卡片滚过后会被回收 → 累积的“离线卡片”打开时 CTRL+F 必找不到。
        //   更深的笔记改由冷启动机器人/AutoWater.advanceResults() 滚动加载下一屏时再逐屏替换进来（列表永远=可见）。

        passStats[i] = (results.notes || []).length;
        typeStats[pass.scenario] = { found: ((typeStats[pass.scenario] || {}).found || 0) + (results.notes || []).length };
        await handleDrainTrackNotes({ notes: (results.notes || []).map(n => Object.assign({ scenario: pass.scenario }, n)) });
        state = await Storage.getAutoWaterState();
        if (!state.searchState) return;

        // 归一化标题作为去重键（定位笔记按标题 CTRL+F，同标题留多份没意义）
        //   标题为空/无标题时回退用 noteId，避免多篇空标题被误并成一篇。
        const _titleKey = function (n) {
          const t = (n.title || '').replace(/\s+/g, '').trim();
          return t && t !== '无标题' ? 't:' + t : 'id:' + (n.noteId || '');
        };

        let addedCount = 0;
        // 已入库标题集（同一关键词的各搜之间、跨关键词都按标题去重）
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
              scenario: pass.scenario,   // 本搜的类型（最新/TOP/本地/求助）
              searchIndex: note.searchIndex,
              rawLinkIndex: note.rawLinkIndex,
              linkHref: note.linkHref,
              watered: await Storage.isNoteWatered(note.noteId),
            });
            existingKeys.add(k);
            addedCount++;
          }
        }

        state.searchState.planIdx = i + 1;
        state.searchState.typeStats = typeStats;
        state.searchState.passStats = passStats;
        state.searchState.scenario = pass.scenario;
        await Storage.setAutoWaterState(state);
        console.log('[一键灌水] 搜索动作 ' + (i + 1) + '/' + plan.length + ' 完成（' + drainPassLabel(pass) + '）: 新增 ' + addedCount + ' 篇, 累计 ' + state.searchState.foundNotes.length + ' 篇');
      }
    } finally {
      // ★ 收尾：只有自己仍是“最新任务”才关闭 searching + 落 searchResults（新任务的 state 不能被误清）
      try {
        const st = await Storage.getAutoWaterState();
        if (st.searchState && gen === this._searchGen) {
          st.searchState.searching = false;
          st.searchState.completedKeywords = (st.searchState.keywords || []).length;
          st.searchState.planIdx = (st.searchState.plan || []).length;
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
    // ★ 双引擎方案：优先用已绑定的「💧 灌水工作台」专属 tab，避免与客服 tab 抢同一个页面
    try {
      const t = await getEngineTab('water');
      if (t && t.id) { console.log('[一键灌水] 使用绑定的灌水工作台标签页:', t.id); return t; }
    } catch (_) {}
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
   实际停留 = 区间随机 min~max（更自然）；floor 为技术下限。
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
