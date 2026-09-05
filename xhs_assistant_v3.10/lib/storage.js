/**
 * storage.js — chrome.storage.local 封装
 * 统一管理：config / knowledge_base / script_library / prompts / replied_comments / ai_logs
 */

const KEYS = {
  CONFIG: 'config',
  KNOWLEDGE_BASE: 'knowledge_base',
  PROMPTS: 'prompts',
  REPLIED_COMMENTS: 'replied_comments',
  AI_LOGS: 'ai_logs',
  AUTO_WATER_CONFIG: 'auto_water_config',
  AUTO_WATER_HISTORY: 'auto_water_history',
  AUTO_WATER_STATE: 'auto_water_state',
  AUTO_WATER_DAILY: 'auto_water_daily',
};

/* ─── 默认配置 ─── */
const DEFAULT_CONFIG = {
  product: {
    name: '我的产品',
    guideText: '微信小程序',
    description: '产品功能简述',
    targetKeywords: [],
  },
  ai: {
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    temperature: 0.8,
    maxTokens: 2000,
  },
  scriptStyle: {
    versionAStyle: '口语化，像朋友聊天，可以带点小八卦感；引用个人经历类知识库数据，讲自己当时的具体故事',
    versionBStyle: '用数据和逻辑说服人，给出完整分析思路——"你现在XX情况，按YY计算，每月能省/多花ZZ元，10年下来差距是WW万"，必须有具体数字支撑；引用专业数据/政策类知识库数据',
    versionCStyle: '找这个话题里的搞笑点、反常识点，或者编一个和话题有点相关的奇怪/离谱小故事或类比...',
  },
  keywordFilter: {
    enabled: false,
    includeKeywords: [],
    excludeKeywords: [],
    minCommentLength: 5,
  },
  roleKeywords: {
    '中介': ['中介', '房产中介', '置业顾问', '经纪人', '卖房', '房源'],
    '装修博主': ['装修', '设计', '改造', '翻新', '家装', '软装', '硬装'],
    '房贷科普博主': ['房贷', '利率', 'LPR', '月供', '贷款', '公积金', '按揭', '首付'],
    '普通用户': ['买房', '购房', '看房', '上车', '刚需', '房奴'],
  },
};

/* ─── 通用读写 ─── */
async function get(key) {
  const data = await chrome.storage.local.get(key);
  return data[key];
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/* ─── 初始化默认数据（首次安装时调用） ─── */
async function initializeDefaults(defaultPrompts) {
  const existing = await chrome.storage.local.get([
    KEYS.CONFIG, KEYS.PROMPTS, KEYS.KNOWLEDGE_BASE,
  ]);

  const updates = {};

  if (!existing[KEYS.CONFIG]) {
    updates[KEYS.CONFIG] = DEFAULT_CONFIG;
  }

  if (!existing[KEYS.PROMPTS] && defaultPrompts) {
    updates[KEYS.PROMPTS] = defaultPrompts;
  }

  if (!existing[KEYS.KNOWLEDGE_BASE]) {
    updates[KEYS.KNOWLEDGE_BASE] = [];
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

/* ─── Config ─── */
async function getConfig() {
  const cfg = await get(KEYS.CONFIG);
  // 深度合并，确保新增字段有默认值
  return deepMerge(DEFAULT_CONFIG, cfg || {});
}

async function setConfig(config) {
  await set(KEYS.CONFIG, config);
}

async function updateConfig(partial) {
  const current = await getConfig();
  const updated = deepMerge(current, partial);
  await set(KEYS.CONFIG, updated);
}

/* ─── 提示词 ─── */
async function getPrompts() {
  return (await get(KEYS.PROMPTS)) || {};
}

async function getPrompt(scene) {
  const prompts = await getPrompts();
  return prompts[scene] || null;
}

async function setPrompt(scene, promptObj) {
  const prompts = await getPrompts();
  prompts[scene] = promptObj;
  await set(KEYS.PROMPTS, prompts);
}

async function resetPrompt(scene, defaultPrompts) {
  if (defaultPrompts[scene]) {
    await setPrompt(scene, { ...defaultPrompts[scene] });
  }
}

async function resetAllPrompts(defaultPrompts) {
  await set(KEYS.PROMPTS, { ...defaultPrompts });
}

/* ─── 知识库 ─── */
async function getKnowledgeBase() {
  return (await get(KEYS.KNOWLEDGE_BASE)) || [];
}

async function addKnowledgeEntry(entry) {
  const kb = await getKnowledgeBase();
  const newEntry = {
    id: Date.now().toString(),
    createdAt: Date.now(),
    ...entry,
  };
  kb.push(newEntry);
  await set(KEYS.KNOWLEDGE_BASE, kb);
  return newEntry;
}

async function updateKnowledgeEntry(id, updates) {
  const kb = await getKnowledgeBase();
  const idx = kb.findIndex(e => e.id === id);
  if (idx >= 0) {
    kb[idx] = { ...kb[idx], ...updates, updatedAt: Date.now() };
    await set(KEYS.KNOWLEDGE_BASE, kb);
    return kb[idx];
  }
  return null;
}

async function deleteKnowledgeEntry(id) {
  const kb = await getKnowledgeBase();
  const filtered = kb.filter(e => e.id !== id);
  await set(KEYS.KNOWLEDGE_BASE, filtered);
}

async function importKnowledgeBase(entries) {
  const normalized = entries.map(e => ({
    id: e.id || Date.now().toString() + Math.random(),
    title: e.title || '',
    content: e.content || '',
    category: e.category || '通用',
    role: e.role || '',
    tags: Array.isArray(e.tags) ? e.tags : [],
    isActive: e.isActive !== false,
    createdAt: e.createdAt || Date.now(),
  }));
  await set(KEYS.KNOWLEDGE_BASE, normalized);
}

/* ─── 已回复评论 ─── */
async function getRepliedForNote(noteUrl) {
  const data = (await get(KEYS.REPLIED_COMMENTS)) || {};
  return data[noteUrl] || [];
}

async function addReplied(noteUrl, author, comment) {
  const data = (await get(KEYS.REPLIED_COMMENTS)) || {};
  if (!data[noteUrl]) data[noteUrl] = [];
  const exists = data[noteUrl].some(e => e.author === author && e.comment === comment);
  if (!exists) {
    data[noteUrl].push({ author, comment, repliedAt: Date.now() });
    await set(KEYS.REPLIED_COMMENTS, data);
  }
}

async function getNoteReplyCount(noteUrl) {
  const list = await getRepliedForNote(noteUrl);
  return list.length;
}

/* ─── AI 日志 ─── */
const MAX_LOGS = 500;

async function getAiLogs() {
  return (await get(KEYS.AI_LOGS)) || [];
}

async function addAiLog(logEntry) {
  const logs = await getAiLogs();
  logs.unshift({ ...logEntry, timestamp: Date.now() });
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
  await set(KEYS.AI_LOGS, logs);
}

async function clearAiLogs() {
  await set(KEYS.AI_LOGS, []);
}

/* ─── 工具 ─── */
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/* ─── 一键灌水：默认配置 ─── */
const DEFAULT_AUTO_WATER_CONFIG = {
  keywords: [],
  licenseKeyHash: '',
  licensed: false,
  schedule: {
    minInterval: 180,
    maxInterval: 600,
    dailyMax: 20,
    activeHoursStart: 9,
    activeHoursEnd: 22,
  },
};

async function getAutoWaterConfig() {
  const cfg = await get(KEYS.AUTO_WATER_CONFIG);
  return deepMerge(DEFAULT_AUTO_WATER_CONFIG, cfg || {});
}

async function setAutoWaterConfig(cfg) {
  await set(KEYS.AUTO_WATER_CONFIG, cfg);
}

async function getAutoWaterHistory() {
  return (await get(KEYS.AUTO_WATER_HISTORY)) || {};
}

async function addAutoWaterRecord(noteId, record) {
  const history = await getAutoWaterHistory();
  history[noteId] = { ...record, wateredAt: Date.now() };
  await set(KEYS.AUTO_WATER_HISTORY, history);
}

async function isNoteWatered(noteId) {
  const history = await getAutoWaterHistory();
  return !!history[noteId];
}

async function clearAutoWaterHistory() {
  await set(KEYS.AUTO_WATER_HISTORY, {});
}

async function getAutoWaterState() {
  return (await get(KEYS.AUTO_WATER_STATE)) || { phase: 'IDLE' };
}

async function setAutoWaterState(state) {
  await set(KEYS.AUTO_WATER_STATE, state);
}

async function getAutoWaterDailyCount() {
  const data = (await get(KEYS.AUTO_WATER_DAILY)) || {};
  const today = new Date().toISOString().slice(0, 10);
  return data[today] || 0;
}

async function incrementAutoWaterDailyCount() {
  const data = (await get(KEYS.AUTO_WATER_DAILY)) || {};
  const today = new Date().toISOString().slice(0, 10);
  data[today] = (data[today] || 0) + 1;
  await set(KEYS.AUTO_WATER_DAILY, data);
  return data[today];
}

/* ─── 导出 ─── */
const Storage = {
  KEYS,
  DEFAULT_CONFIG,
  DEFAULT_AUTO_WATER_CONFIG,
  initializeDefaults,
  // config
  getConfig, setConfig, updateConfig,
  // prompts
  getPrompts, getPrompt, setPrompt, resetPrompt, resetAllPrompts,
  // knowledge base
  getKnowledgeBase, addKnowledgeEntry, updateKnowledgeEntry, deleteKnowledgeEntry, importKnowledgeBase,
  // replied comments
  getRepliedForNote, addReplied, getNoteReplyCount,
  // ai logs
  getAiLogs, addAiLog, clearAiLogs,
  // auto water
  getAutoWaterConfig, setAutoWaterConfig,
  getAutoWaterHistory, addAutoWaterRecord, isNoteWatered, clearAutoWaterHistory,
  getAutoWaterState, setAutoWaterState,
  getAutoWaterDailyCount, incrementAutoWaterDailyCount,
};

// 支持 ES module 和 Service Worker importScripts 两种方式
if (typeof module !== 'undefined') {
  module.exports = Storage;
}
