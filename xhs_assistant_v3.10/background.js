/**
 * background.js — Service Worker
 * 职责：消息路由 + AI 调用编排 + 首次安装初始化
 */

importScripts(
  'lib/storage.js',
  'lib/utils.js',
  'lib/ai-client.js',
  'lib/default-prompts.js',
  'lib/knowledge-search.js',
  'lib/prompt-renderer.js',
  'lib/seed-data.js',
  'lib/auto-water.js'
);

/* ─── 首次安装初始化 ─── */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    // 预置知识库种子数据（45条：34条房贷知识 + 11条话术模板）
    const existingKb = await Storage.getKnowledgeBase();
    if (!existingKb || existingKb.length === 0) {
      await Storage.importKnowledgeBase(SEED_KNOWLEDGE_BASE);
      console.log('[小红书助手] 已预置知识库:', SEED_KNOWLEDGE_BASE.length, '条');
    }
    console.log('[小红书助手] 首次安装，已初始化默认配置');
  } else if (details.reason === 'update') {
    // 升级时确保新的默认 prompt 场景存在
    const existing = await Storage.getPrompts();
    const updates = {};
    for (const [scene, prompt] of Object.entries(DEFAULT_PROMPTS)) {
      if (!existing[scene]) {
        updates[scene] = prompt;
      }
    }
    if (Object.keys(updates).length > 0) {
      const merged = { ...existing, ...updates };
      await chrome.storage.local.set({ [Storage.KEYS.PROMPTS]: merged });
      console.log('[小红书助手] 升级，新增场景提示词:', Object.keys(updates));
    }
    // 升级时也检查知识库是否需要导入种子数据
    const existingKb = await Storage.getKnowledgeBase();
    if (!existingKb || existingKb.length === 0) {
      await Storage.importKnowledgeBase(SEED_KNOWLEDGE_BASE);
      console.log('[小红书助手] 升级，已补充知识库种子:', SEED_KNOWLEDGE_BASE.length, '条');
    }
    // 迁移旧版话术库数据到知识库（兼容 v3.8 及之前版本）
    try {
      const { script_library } = await chrome.storage.local.get('script_library');
      if (script_library && Array.isArray(script_library) && script_library.length > 0) {
        const migrated = script_library.map(s => ({
          id: Date.now().toString() + Math.random(),
          title: s.title || '',
          content: s.content || '',
          category: '话术模板',
          role: s.role || '',
          tags: Array.isArray(s.tags) ? s.tags : [],
          isActive: s.isActive !== false,
          createdAt: Date.now(),
        }));
        const kb = await Storage.getKnowledgeBase();
        kb.push(...migrated);
        await chrome.storage.local.set({ [Storage.KEYS.KNOWLEDGE_BASE]: kb });
        await chrome.storage.local.remove('script_library');
        console.log('[小红书助手] 已迁移话术库:', migrated.length, '条到知识库');
      }
    } catch (_) { /* 无旧数据可忽略 */ }
  }
});

/* ─── 消息路由 ─── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  const handlers = {
    findProspects: handleFindProspects,
    checkConfig: handleCheckConfig,
    testAiConnection: handleTestAiConnection,
    getConfig: handleGetConfig,
    // 一键灌水
    startAutoWater: () => AutoWater.start(),
    stopAutoWater: () => AutoWater.stop(),
    pauseAutoWater: () => AutoWater.pause(),
    resumeAutoWater: () => AutoWater.resume(),
    getAutoWaterStatus: () => AutoWater.getStatus(),
    activateLicense: (data) => AutoWater.activateLicense(data.key),
    checkLicense: () => AutoWater.isLicensed().then(licensed => ({ licensed })),
  };

  const handler = handlers[action];
  if (!handler) {
    sendResponse({ error: `未知 action: ${action}` });
    return false;
  }

  // 异步处理
  handler(message.data || message)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => {
      console.error(`[小红书助手] ${action} 失败:`, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    });

  return true; // 保持消息通道开放（异步）
});

/* ─── 商机挖掘 ─── */
async function handleFindProspects(data) {
  const config = await Storage.getConfig();

  if (!config.ai.apiKey) {
    throw new Error('未配置 API Key，请先在设置页面填写');
  }

  const { comments = [], title = '', description = '', author = '' } = data;
  if (comments.length === 0) {
    return { prospects: [], summary: '暂无评论' };
  }

  // 构建评论文本（0-based 编号）
  const commentsText = Utils.buildCommentsText(comments);

  // 构建渲染上下文
  const context = {
    note_title: title || '（无标题）',
    note_content: description || '',
    note_author: author || '作者',
    comment_count: String(comments.length),
    comments_text: commentsText,
    // 产品相关占位符
    product_name: config.product.name || '我的产品',
    product_guide: config.product.guideText || '',
    product_description: config.product.description || '',
    // 话术版本风格（从配置中读取）
    version_a_style: config.scriptStyle?.versionAStyle || '',
    version_b_style: config.scriptStyle?.versionBStyle || '',
    version_c_style: config.scriptStyle?.versionCStyle || '',
  };

  // 获取提示词模板（优先用户自定义，其次默认）
  let promptTemplate = await Storage.getPrompt('prospect_finder');
  if (!promptTemplate) {
    promptTemplate = DEFAULT_PROMPTS.prospect_finder;
  }

  // 搜索知识库（含角色检测、话术路由）
  const knowledgeBase = await Storage.getKnowledgeBase();
  const roleKeywords = config.roleKeywords || {};
  const kbContext = KnowledgeSearch.searchKnowledgeBase(knowledgeBase, context, roleKeywords);

  // 渲染 Prompt
  const { systemPrompt, userPrompt } = PromptRenderer.renderPrompt(
    promptTemplate, context, kbContext
  );

  console.log('[小红书助手] findProspects — 知识库注入:', !!kbContext);

  // 调用 AI（商机扫描需要更多 tokens，自动提升到 4000）
  const aiConfigForScan = { ...config.ai, maxTokens: Math.max(config.ai.maxTokens || 2000, 4000) };
  const { content, usage } = await AiClient.chatCompletion(aiConfigForScan, systemPrompt, userPrompt);

  // 解析 JSON
  const parsed = Utils.extractJson(content);
  if (!parsed) {
    throw new Error(`AI 返回格式错误，无法解析 JSON。原始回复：${content.slice(0, 200)}`);
  }

  let prospects = parsed.prospects || [];

  // 兼容处理：确保每个商机都有 suggested_copies 数组
  for (const p of prospects) {
    if (!Array.isArray(p.suggested_copies) || p.suggested_copies.length === 0) {
      const old = p.suggested_copy || p.suggested_reply || '';
      p.suggested_copies = old ? [old] : [];
    }
    // 统一字段名
    if (p.comment_index !== undefined) p.index = p.comment_index;
    if (p.opportunity) p.interest_reason = p.opportunity;
  }

  // 记录日志
  await Storage.addAiLog({
    scene: 'prospect_finder',
    tokensIn: usage.prompt_tokens || 0,
    tokensOut: usage.completion_tokens || 0,
    success: true,
    noteTitle: title,
    commentCount: comments.length,
    prospectsFound: prospects.length,
  });

  return {
    prospects,
    summary: parsed.summary || '',
    has_opportunity: parsed.has_opportunity !== false,
  };
}

/* ─── 检查配置状态 ─── */
async function handleCheckConfig() {
  const config = await Storage.getConfig();
  const hasApiKey = !!(config.ai && config.ai.apiKey);
  const productName = config.product?.name || '';
  return { hasApiKey, productName, configured: hasApiKey };
}

/* ─── 测试 AI 连接 ─── */
async function handleTestAiConnection(data) {
  const config = await Storage.getConfig();
  const aiConfig = data?.aiConfig || config.ai;
  const result = await AiClient.testConnection(aiConfig);
  return result;
}

/* ─── 获取配置（供 popup 读取产品名等） ─── */
async function handleGetConfig() {
  const config = await Storage.getConfig();
  // 不返回 apiKey 到前端
  const safe = { ...config, ai: { ...config.ai, apiKey: config.ai?.apiKey ? '***' : '' } };
  return { config: safe };
}

/* ─── 独立窗口管理（替代 default_popup，固定在左侧显示） ─── */
chrome.action.onClicked.addListener(async (tab) => {
  // 检查已有窗口，存在则聚焦
  const { popupWindowId } = await chrome.storage.local.get('popupWindowId');
  if (popupWindowId) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch (_) {
      await chrome.storage.local.remove('popupWindowId');
    }
  }

  // 在屏幕左侧创建独立窗口
  const url = chrome.runtime.getURL('popup.html?tabId=' + tab.id);
  const win = await chrome.windows.create({
    url: url,
    type: 'popup',
    width: 680,
    height: 900,
    left: 0,
    top: 0,
  });
  await chrome.storage.local.set({ popupWindowId: win.id });
});

// 窗口关闭时清理记录
chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get('popupWindowId', (data) => {
    if (data.popupWindowId === windowId) {
      chrome.storage.local.remove('popupWindowId');
    }
  });
});

/* ─── 一键灌水：闹钟调度 ─── */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name && alarm.name.startsWith('auto-water-')) {
    AutoWater.handleAlarm(alarm.name);
  }
});
