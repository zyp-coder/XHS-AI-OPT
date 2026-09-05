/**
 * auto-water.js — 一键灌水核心引擎
 * 运行在 background service worker 上下文
 * 职责：状态机、调度、密钥验证、流程编排
 */

/* ─── 密钥验证 ─── */
// djb2 哈希算法
function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash;
}

// 预生成的有效密钥哈希列表（线下分发用）
// 注意：必须用归一化后的密钥计算哈希（与 validateLicenseKey 一致）
const VALID_LICENSE_HASHES = [
  djb2Hash(normalizeKey('XHS-PRO-2025-A1B2')),
  djb2Hash(normalizeKey('XHS-PRO-2025-C3D4')),
  djb2Hash(normalizeKey('XHS-PRO-2025-E5F6')),
  djb2Hash(normalizeKey('XHS-PRO-2025-G7H8')),
  djb2Hash(normalizeKey('XHS-PRO-2025-J9K0')),
  djb2Hash(normalizeKey('XHS-VIP-2025-M1N2')),
  djb2Hash(normalizeKey('XHS-VIP-2025-P3Q4')),
  djb2Hash(normalizeKey('XHS-VIP-2025-R5S6')),
  djb2Hash(normalizeKey('XHS-VIP-2025-T7U8')),
  djb2Hash(normalizeKey('XHS-VIP-2025-W9X0')),
];

function normalizeKey(key) {
  return (key || '').replace(/[\s\-]/g, '').toUpperCase();
}

function validateLicenseKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  const hash = djb2Hash(normalized);
  return VALID_LICENSE_HASHES.includes(hash);
}

/* ─── 状态常量 ─── */
const PHASE = {
  IDLE: 'IDLE',
  SEARCHING: 'SEARCHING',
  SCREENING: 'SCREENING',
  WATERING: 'WATERING',
  WAITING: 'WAITING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  STOPPED: 'STOPPED',
  ERROR: 'ERROR',
};

const ALARM_NEXT = 'auto-water-next';
const ALARM_RESUME_HOURS = 'auto-water-resume-hours';

/* ─── 核心引擎 ─── */
const AutoWater = {

  /* 获取当前状态 */
  async getStatus() {
    const state = await Storage.getAutoWaterState();
    const config = await Storage.getAutoWaterConfig();
    const todayCount = await Storage.getAutoWaterDailyCount();
    return {
      ...state,
      licensed: config.licensed,
      todayCount,
      dailyMax: config.schedule.dailyMax,
      keywords: config.keywords,
    };
  },

  /* 激活密钥 */
  async activateLicense(key) {
    if (!validateLicenseKey(key)) {
      return { ok: false, error: '密钥无效' };
    }
    const config = await Storage.getAutoWaterConfig();
    config.licenseKeyHash = String(djb2Hash(normalizeKey(key)));
    config.licensed = true;
    await Storage.setAutoWaterConfig(config);
    return { ok: true };
  },

  /* 检查是否已授权 */
  async isLicensed() {
    const config = await Storage.getAutoWaterConfig();
    return !!config.licensed;
  },

  /* 启动灌水流程 */
  async start() {
    const config = await Storage.getAutoWaterConfig();
    if (!config.licensed) {
      return { ok: false, error: '请先激活会员密钥' };
    }
    if (!config.keywords || config.keywords.length === 0) {
      return { ok: false, error: '请先在设置中配置搜索关键词' };
    }

    const aiConfig = await Storage.getConfig();
    if (!aiConfig.ai?.apiKey) {
      return { ok: false, error: '请先配置 AI API Key' };
    }

    // 初始化状态
    const initialState = {
      phase: PHASE.SEARCHING,
      keywords: [...config.keywords],
      currentKeywordIdx: 0,
      queue: [],
      currentIndex: 0,
      totalWatered: 0,
      totalSkipped: 0,
      logs: [],
      startedAt: Date.now(),
      error: null,
    };
    await Storage.setAutoWaterState(initialState);
    this._log(initialState, '开始一键灌水流程');

    // 不 await _runStep()，让流程异步执行，立即返回响应
    this._runStep().catch(err => {
      console.error('[一键灌水] _runStep 异常:', err);
    });
    return { ok: true };
  },

  /* 停止 */
  async stop() {
    const state = await Storage.getAutoWaterState();
    state.phase = PHASE.STOPPED;
    state.stoppedAt = Date.now();
    await Storage.setAutoWaterState(state);
    await this._clearAlarms();
    this._log(state, '用户手动停止');
  },

  /* 暂停 */
  async pause() {
    const state = await Storage.getAutoWaterState();
    if (state.phase === PHASE.WATERING || state.phase === PHASE.WAITING) {
      state.phase = PHASE.PAUSED;
      state.pausedAt = Date.now();
      await Storage.setAutoWaterState(state);
      await this._clearAlarms();
      this._log(state, '用户暂停');
    }
  },

  /* 恢复 */
  async resume() {
    const state = await Storage.getAutoWaterState();
    if (state.phase === PHASE.PAUSED) {
      state.phase = PHASE.WATERING;
      await Storage.setAutoWaterState(state);
      this._log(state, '用户恢复');
      await this._runStep();
    }
  },

  /* alarm 触发回调 */
  async handleAlarm(alarmName) {
    if (alarmName === ALARM_NEXT || alarmName === ALARM_RESUME_HOURS) {
      const state = await Storage.getAutoWaterState();
      if (state.phase === PHASE.WAITING || state.phase === PHASE.PAUSED) {
        // 检查调度约束
        const check = await this._checkSchedule();
        if (!check.canProceed) {
          if (check.reason === 'outside_active_hours') {
            state.phase = PHASE.PAUSED;
            await Storage.setAutoWaterState(state);
            // 设闹钟到下一个活跃时段
            if (check.nextCheckSeconds > 0) {
              chrome.alarms.create(ALARM_RESUME_HOURS, { delayInMinutes: check.nextCheckSeconds / 60 });
            }
            return;
          }
          if (check.reason === 'daily_limit_reached') {
            state.phase = PHASE.COMPLETED;
            state.completedAt = Date.now();
            state.completeReason = '今日已达上限';
            await Storage.setAutoWaterState(state);
            return;
          }
        }
        state.phase = PHASE.WATERING;
        await Storage.setAutoWaterState(state);
        await this._runStep();
      }
    }
  },

  /* ─── 内部：执行下一步 ─── */
  async _runStep() {
    let state = await Storage.getAutoWaterState();

    // 如果已停止/完成，不执行
    if ([PHASE.STOPPED, PHASE.COMPLETED, PHASE.IDLE].includes(state.phase)) return;

    try {
      switch (state.phase) {
        case PHASE.SEARCHING:
          await this._doSearch(state);
          break;
        case PHASE.SCREENING:
          await this._doScreening(state);
          break;
        case PHASE.WATERING:
          await this._doWatering(state);
          break;
        default:
          break;
      }
    } catch (e) {
      state = await Storage.getAutoWaterState();
      state.error = e.message || String(e);
      this._log(state, `错误: ${e.message}`);
      // 尝试继续下一个
      if (state.phase === PHASE.WATERING) {
        state.currentIndex++;
        state.totalSkipped++;
        await Storage.setAutoWaterState(state);
        await this._scheduleNext(state);
      } else {
        state.phase = PHASE.ERROR;
        await Storage.setAutoWaterState(state);
      }
    }
  },

  /* ─── 搜索阶段 ─── */
  async _doSearch(state) {
    const keyword = state.keywords[state.currentKeywordIdx];
    this._log(state, `搜索关键词: ${keyword}`);

    // 获取目标 tab
    const tab = await this._getXhsTab();
    if (!tab) {
      throw new Error('未找到小红书标签页，请先打开小红书网站');
    }

    // 导航到搜索页
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_note`;
    await chrome.tabs.update(tab.id, { url: searchUrl });

    // 等待页面加载
    await this._waitForTabLoad(tab.id, 15000);

    // 提取搜索结果
    let results;
    try {
      results = await chrome.tabs.sendMessage(tab.id, { action: 'extractSearchResults' });
    } catch (e) {
      // content script 可能还没加载，注入一下
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await this._sleep(1000);
      results = await chrome.tabs.sendMessage(tab.id, { action: 'extractSearchResults' });
    }

    if (!results || !results.notes || results.notes.length === 0) {
      this._log(state, `关键词 "${keyword}" 未找到搜索结果`);
      // 尝试下一个关键词
      return await this._nextKeyword(state);
    }

    // 尝试滚动加载更多
    for (let i = 0; i < 3; i++) {
      try {
        const more = await chrome.tabs.sendMessage(tab.id, { action: 'scrollLoadMore' });
        if (more && more.notes && more.notes.length > 0) {
          // 合并去重
          const existingIds = new Set(results.notes.map(n => n.noteId));
          for (const note of more.notes) {
            if (!existingIds.has(note.noteId)) {
              results.notes.push(note);
              existingIds.add(note.noteId);
            }
          }
        }
        if (!more || !more.hasMore) break;
      } catch (_) { break; }
    }

    this._log(state, `搜索到 ${results.notes.length} 篇笔记`);

    // 过滤已灌水的
    const newNotes = [];
    for (const note of results.notes) {
      if (!await Storage.isNoteWatered(note.noteId)) {
        newNotes.push(note);
      }
    }
    this._log(state, `过滤后 ${newNotes.length} 篇未灌水`);

    if (newNotes.length === 0) {
      return await this._nextKeyword(state);
    }

    // 进入筛选阶段
    state.phase = PHASE.SCREENING;
    state._searchResults = newNotes;
    await Storage.setAutoWaterState(state);
    await this._doScreening(state);
  },

  /* ─── AI 筛选阶段 ─── */
  async _doScreening(state) {
    const notes = state._searchResults || [];
    if (notes.length === 0) {
      return await this._nextKeyword(state);
    }

    const keyword = state.keywords[state.currentKeywordIdx];
    this._log(state, `AI 筛选 ${notes.length} 篇标题...`);

    // 构建标题列表文本
    const titlesText = notes.map((n, i) =>
      `${i}. @${n.author || '未知'}: ${n.title || '无标题'}${n.likes ? ' (赞:' + n.likes + ')' : ''}`
    ).join('\n');

    // 获取配置
    const config = await Storage.getConfig();
    const awConfig = await Storage.getAutoWaterConfig();

    // 获取剩余可灌水数量
    const todayCount = await Storage.getAutoWaterDailyCount();
    const remaining = Math.max(1, awConfig.schedule.dailyMax - todayCount);

    // 渲染提示词
    const context = {
      keyword,
      product_name: config.product.name,
      product_description: config.product.description,
      product_guide: config.product.guideText,
      titles_text: titlesText,
      max_count: String(Math.min(remaining, notes.length)),
    };

    let promptTemplate = await Storage.getPrompt('title_screening');
    if (!promptTemplate) {
      promptTemplate = DEFAULT_PROMPTS?.title_screening;
    }
    if (!promptTemplate) {
      throw new Error('未找到 title_screening 提示词模板');
    }

    const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(promptTemplate, context, '');

    // 调用 AI
    const { content } = await AiClient.chatCompletion(config.ai, systemPrompt, userPrompt);

    // 解析结果
    const parsed = Utils.extractJson(content);
    if (!parsed || !parsed.selected || parsed.selected.length === 0) {
      this._log(state, 'AI 未筛选出合适的笔记');
      return await this._nextKeyword(state);
    }

    // 构建灌水队列
    const queue = [];
    for (const item of parsed.selected) {
      const note = notes[item.index];
      if (note) {
        queue.push({
          noteId: note.noteId,
          url: note.url || `https://www.xiaohongshu.com/explore/${note.noteId}`,
          title: note.title || item.title,
          author: note.author || item.author,
          reason: item.reason,
          priority: item.priority || 'medium',
        });
      }
    }

    this._log(state, `筛选出 ${queue.length} 篇待灌水`);

    // 进入灌水阶段
    state.phase = PHASE.WATERING;
    state.queue = queue;
    state.currentIndex = 0;
    state._searchResults = null; // 清理
    state.screenResult = {
      keyword,
      selected: queue,
      rejectedCount: parsed.rejected_count || 0,
      summary: parsed.summary || '',
    };
    await Storage.setAutoWaterState(state);
    await this._doWatering(state);
  },

  /* ─── 灌水阶段 ─── */
  async _doWatering(state) {
    if (state.currentIndex >= state.queue.length) {
      // 当前关键词队列完成，尝试下一个关键词
      return await this._nextKeyword(state);
    }

    // 检查调度约束
    const check = await this._checkSchedule();
    if (!check.canProceed) {
      if (check.reason === 'daily_limit_reached') {
        state.phase = PHASE.COMPLETED;
        state.completedAt = Date.now();
        state.completeReason = '今日已达上限';
        await Storage.setAutoWaterState(state);
        this._log(state, '今日灌水已达上限，停止');
        return;
      }
      if (check.reason === 'outside_active_hours') {
        state.phase = PHASE.PAUSED;
        await Storage.setAutoWaterState(state);
        if (check.nextCheckSeconds > 0) {
          chrome.alarms.create(ALARM_RESUME_HOURS, { delayInMinutes: check.nextCheckSeconds / 60 });
        }
        this._log(state, '当前不在活跃时段，暂停');
        return;
      }
    }

    const item = state.queue[state.currentIndex];
    this._log(state, `灌水 [${state.currentIndex + 1}/${state.queue.length}]: ${item.title}`);

    // 导航到笔记页
    const tab = await this._getXhsTab();
    if (!tab) throw new Error('未找到小红书标签页');

    await chrome.tabs.update(tab.id, { url: item.url });
    await this._waitForTabLoad(tab.id, 15000);

    // 提取页面数据（复用现有 extract）
    let pageData;
    try {
      pageData = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await this._sleep(1000);
      pageData = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    }

    if (!pageData || !pageData.comments || pageData.comments.length === 0) {
      this._log(state, '该笔记无评论，跳过');
      state.currentIndex++;
      state.totalSkipped++;
      await Storage.setAutoWaterState(state);
      await this._scheduleNext(state);
      return;
    }

    // AI 商机挖掘（复用现有 findProspects）
    const config = await Storage.getConfig();
    const requestData = {
      comments: pageData.comments,
      title: pageData.title || '',
      description: pageData.description || '',
      author: pageData.author || '',
    };

    let prospectsResult;
    try {
      prospectsResult = await chrome.runtime.sendMessage({
        action: 'findProspects',
        data: requestData,
      });
    } catch (e) {
      this._log(state, `AI 商机挖掘失败: ${e.message}`);
      state.currentIndex++;
      state.totalSkipped++;
      await Storage.setAutoWaterState(state);
      await this._scheduleNext(state);
      return;
    }

    if (!prospectsResult || !prospectsResult.ok || !prospectsResult.prospects || prospectsResult.prospects.length === 0) {
      this._log(state, '未发现商机，跳过');
      // 记录为已处理但无商机
      await Storage.addAutoWaterRecord(item.noteId, {
        url: item.url,
        title: item.title,
        author: item.author,
        replyContent: '',
        status: 'no_prospect',
      });
      state.currentIndex++;
      state.totalSkipped++;
      await Storage.setAutoWaterState(state);
      await this._scheduleNext(state);
      return;
    }

    // 选择第一个有有效话术的商机
    let targetProspect = null;
    let replyText = '';
    for (const p of prospectsResult.prospects) {
      if (p.suggested_copies && p.suggested_copies.length > 0) {
        targetProspect = p;
        replyText = p.suggested_copies[0]; // 使用版本A
        break;
      }
    }

    if (!targetProspect) {
      this._log(state, '无有效话术，跳过');
      state.currentIndex++;
      state.totalSkipped++;
      await Storage.setAutoWaterState(state);
      await this._scheduleNext(state);
      return;
    }

    // 发送回复（复用现有 sendReply）
    try {
      const commentIdx = typeof targetProspect.comment_index === 'number'
        ? targetProspect.comment_index
        : (typeof targetProspect.index === 'number' ? targetProspect.index : 0);

      // 找到对应评论的 userLink
      const targetComment = pageData.comments[commentIdx];
      const userLink = targetComment?.userLink || '';
      const author = targetProspect.author || targetComment?.author || '';
      const originalText = targetProspect.original_comment || targetComment?.content || '';

      const sendResult = await chrome.tabs.sendMessage(tab.id, {
        action: 'sendReply',
        author,
        originalText,
        replyText,
        commentIdx,
        userLink,
      });

      if (sendResult && sendResult.success) {
        this._log(state, `灌水成功: ${item.title}`);
        await Storage.addAutoWaterRecord(item.noteId, {
          url: item.url,
          title: item.title,
          author: item.author,
          replyContent: replyText,
          status: 'success',
        });
        await Storage.incrementAutoWaterDailyCount();
        state.totalWatered++;

        // 自动点赞+关注
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'likeComment', author, originalText, commentIdx, userLink });
        } catch (_) {}
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'followUser', author });
        } catch (_) {}
      } else {
        this._log(state, `灌水失败: ${sendResult?.error || '未知错误'}`);
        await Storage.addAutoWaterRecord(item.noteId, {
          url: item.url,
          title: item.title,
          author: item.author,
          replyContent: replyText,
          status: 'failed',
        });
      }
    } catch (e) {
      this._log(state, `发送异常: ${e.message}`);
      await Storage.addAutoWaterRecord(item.noteId, {
        url: item.url,
        title: item.title,
        author: item.author,
        replyContent: replyText,
        status: 'failed',
      });
    }

    state.currentIndex++;
    await Storage.setAutoWaterState(state);
    await this._scheduleNext(state);
  },

  /* ─── 调度：下一个关键词 ─── */
  async _nextKeyword(state) {
    state.currentKeywordIdx++;
    if (state.currentKeywordIdx >= state.keywords.length) {
      state.phase = PHASE.COMPLETED;
      state.completedAt = Date.now();
      state.completeReason = '所有关键词已处理完毕';
      await Storage.setAutoWaterState(state);
      this._log(state, '全部关键词处理完毕');
      return;
    }
    state.phase = PHASE.SEARCHING;
    state._searchResults = null;
    await Storage.setAutoWaterState(state);
    await this._runStep();
  },

  /* ─── 调度：随机延迟后继续 ─── */
  async _scheduleNext(state) {
    if (state.phase === PHASE.STOPPED || state.phase === PHASE.COMPLETED) return;

    const config = await Storage.getAutoWaterConfig();
    const delay = this._getNextDelay(config.schedule);

    state.phase = PHASE.WAITING;
    state.nextActionAt = Date.now() + delay * 1000;
    await Storage.setAutoWaterState(state);

    this._log(state, `等待 ${(delay / 60).toFixed(1)} 分钟后继续...`);
    chrome.alarms.create(ALARM_NEXT, { delayInMinutes: delay / 60 });
  },

  /* ─── 调度约束检查 ─── */
  async _checkSchedule() {
    const config = await Storage.getAutoWaterConfig();
    const schedule = config.schedule;
    const now = new Date();
    const hour = now.getHours();

    // 活跃时段检查
    if (hour < schedule.activeHoursStart || hour >= schedule.activeHoursEnd) {
      // 计算到下一个活跃时段的秒数
      let nextCheckSeconds;
      if (hour < schedule.activeHoursStart) {
        nextCheckSeconds = (schedule.activeHoursStart - hour) * 3600 - now.getMinutes() * 60;
      } else {
        nextCheckSeconds = (24 - hour + schedule.activeHoursStart) * 3600 - now.getMinutes() * 60;
      }
      return { canProceed: false, reason: 'outside_active_hours', nextCheckSeconds };
    }

    // 日上限检查
    const todayCount = await Storage.getAutoWaterDailyCount();
    if (todayCount >= schedule.dailyMax) {
      return { canProceed: false, reason: 'daily_limit_reached' };
    }

    return { canProceed: true };
  },

  /* ─── 随机延迟算法 ─── */
  _getNextDelay(schedule) {
    const min = schedule.minInterval || 180;
    const max = schedule.maxInterval || 600;
    let base = min + Math.random() * (max - min);
    // ±20% 抖动
    const jitter = base * (Math.random() * 0.4 - 0.2);
    let delay = base + jitter;
    // 10% 概率长休息
    if (Math.random() < 0.10) {
      delay += 120 + Math.random() * 480;
    }
    return Math.max(60, Math.round(delay));
  },

  /* ─── 工具方法 ─── */
  async _getXhsTab() {
    const tabs = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' });
    if (tabs.length > 0) return tabs[0];
    // 没有就创建一个
    const tab = await chrome.tabs.create({ url: 'https://www.xiaohongshu.com' });
    await this._waitForTabLoad(tab.id, 10000);
    return tab;
  },

  _waitForTabLoad(tabId, timeoutMs) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeoutMs);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          // 额外等待 JS 渲染
          setTimeout(resolve, 1500);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  async _clearAlarms() {
    try {
      await chrome.alarms.clear(ALARM_NEXT);
      await chrome.alarms.clear(ALARM_RESUME_HOURS);
    } catch (_) {}
  },

  _log(state, msg) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (!state.logs) state.logs = [];
    state.logs.push(entry);
    // 只保留最近 100 条日志
    if (state.logs.length > 100) state.logs = state.logs.slice(-100);
    console.log(`[一键灌水] ${msg}`);
    // 立即持久化
    Storage.setAutoWaterState(state);
  },
};

if (typeof module !== 'undefined') {
  module.exports = AutoWater;
}
