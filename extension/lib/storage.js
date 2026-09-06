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
  // ★ 评论跟进：通知页会话状态（按用户分组的对话上下文 + 待回复定位）
  CHAT_FOLLOW_STATE: 'chat_follow_state',
  // ★ 评论跟进：回复历史（每次 AI 实际发出的回复，独立于会话状态，跨同步保留）
  CHAT_FOLLOW_REPLY_HISTORY: 'chat_follow_reply_history',
  // ★ 获客清单：候选人群（按租户隔离）
  PROSPECT_LIST: 'prospect_list',
  // ★ 豆瓣获其实清单：私信历史
  PROSPECT_DM_HISTORY: 'prospect_dm_history',
  // ★ 发笔记：已用选题/卖点指纹池（用于剔除已发送过的题目）
  NP_USED_TOPICS: 'np_used_topics',
};

/* ─── 默认配置 ─── */
const DEFAULT_CONFIG = {
  product: {
    name: '我的产品',
    promoGoal: '',
    guideText: '',
    description: '',
    targetKeywords: [],
    // ★ 产品卖点（1~10 个）：{ title, content, image }。title/content 喂评论/文案提示词；
    //   image(base64 配图) 在「发笔记」选中该卖点时列出，作为文案配图元素加工。
    sellPoints: [],
    // ★ 封面合成：小红书昵称(上板块)、引流方式(下板块)、独立封面底图模板(中部留白)
    username: '',
    cta: '私信"玄铁剑"领试用版',
    coverHook: '',        // 手填覆盖的封面简介；留空则用 config.persona.coverHook（AI 沉淀）
    coverTemplate: null,   // { image: base64, w, h, preview, topBand, bottomBand }
  },
  // ★ 我的小红书账号昵称（可多个）。评论助手扫描时，若发现笔记里已有我的名字的评论，
  //   就直接判定这篇已灌水、跳过 AI，并记入已灌水清单。
  myAccountNames: [],
  // ★ 账号人设（由「设置→话术风格→我的账号人设」的 AI 建人设流程生成并保存）：
  //   { text: 整合后的人设正文（注入评论/文案生成用）, bio: 账号简介原文, qa: {q1..q5}, updatedAt, footer, coverHook }
  persona: null,
  ai: {
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.8,
    maxTokens: 4096,
    // 备用模型（主模型失败时自动切换，可选）
    fallbackApiKey: '',
    fallbackApiBaseUrl: '',
    fallbackModel: '',
  },
  scriptStyle: {
    // ★ 本次评论目的（驱动打法选择的轴）：sell=卖产品 / likes=博点赞 / trend=蹭热度
    scriptPurpose: 'sell',
    // 字数控制（评论目的版：单范围；兼容旧统一 minChars/maxChars）
    purposeMinChars: 100, purposeMaxChars: 300,
    // 口癖池（可自定义，逗号/顿号/换行分隔；留空用内置池）
    toneMannerisms: '',
    // 博主口吻样本：贴 3-5 条真实评论，让 AI 跟随你本人的语感/节奏（few-shot）
    personaSample: '',
    // 账号人设/主页简介+卖点概述：一句话讲清"我是谁、做啥的、有什么干货/经历"，AI 生成评论时必须自然用进去
    personaIntro: '',
    // ── 以下为旧版 A/B/C 配置，仅在老配置里保留兼容用，新流程不再读取 ──
    aMinChars: 100, aMaxChars: 300,
    bMinChars: 100, bMaxChars: 300,
    cMinChars: 150, cMaxChars: 300,
    versionAStyle: '',
    versionBStyle: '',
    versionCStyle: '',
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
  // ★ 商机池状态列表（用户可手工维护：给每个商机挂一个自定义状态）
  prospect: {
    statuses: ['待触达', '已回复', '谈单中', '已成交'],
  },
  // ★ 客户管理：沉睡判定标准（用户自行定义）
  customer: {
    dormantDays: 14, // 超过 N 天无有效互动视为"沉睡"（配合 AI 分类用）
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
  let cfg = await get(KEYS.CONFIG);
  cfg = deepMerge(DEFAULT_CONFIG, cfg || {});
  // ★ 默认模型自动迁移：推理模型（v4-flash/v4-pro 等）思考过程常占满输出上限导致正文为空、
  //   又慢又贵；本项目任务均为常规文本生成，非推理模型（deepseek-chat 等）更快更稳。
  //   老配置里若仍是推理模型 → 自动切换并记住旧模型名（中转站不认新模型名时由 ai-client 自动回退）
  const MODEL_OVERRIDE = {
    'deepseek-v4-flash': 'deepseek-chat',
    'deepseek-v4-pro': 'deepseek-chat',
    'deepseek-ai/DeepSeek-V4-Flash': 'deepseek-ai/DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-V4-Pro': 'deepseek-ai/DeepSeek-V3.2',
  };
  const oldModel = cfg.ai && cfg.ai.model;
  const newModel = MODEL_OVERRIDE[oldModel];
  // 用户显式保存过模型（_modelLocked）时不自动迁移，尊重手动选择
  if (newModel && newModel !== oldModel && !cfg.ai._modelLocked) {
    cfg.ai._prevModel = oldModel; // 记住旧模型名，供自动回退使用
    cfg.ai.model = newModel;
    await set(KEYS.CONFIG, cfg);
    console.log(`[小红书助手] AI 模型已自动切换：${oldModel} → ${newModel}（非推理，避免思考占满输出上限）`);
  }
  return cfg;
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

/* ─── 评论跟进：会话状态 ───
 * 结构：{ conversations: { userId: { userName, history:[{role,content}], turnCount, needReply, pendingIdx, pendingIncoming, sold, lastReplyAt } }, lastSyncAt }
 * 说明：页面通知流为真相，每次同步时重建 history；sold（已销售标记）是页面里看不到的，必须保留旧值
 */
async function getChatFollowState() {
  return (await get(KEYS.CHAT_FOLLOW_STATE)) || { conversations: {} };
}

async function setChatFollowState(state) {
  await set(KEYS.CHAT_FOLLOW_STATE, state);
}

/* ─── 评论跟进：回复历史（最新在前，最多保留 200 条）─── */
async function getChatFollowReplyHistory() {
  return (await get(KEYS.CHAT_FOLLOW_REPLY_HISTORY)) || [];
}

async function addChatFollowReplyHistory(entry) {
  const list = (await get(KEYS.CHAT_FOLLOW_REPLY_HISTORY)) || [];
  list.unshift(entry);
  if (list.length > 200) list.length = 200;
  await set(KEYS.CHAT_FOLLOW_REPLY_HISTORY, list);
  return list;
}

/* ─── 一键灌水：默认配置 ─── */
const DEFAULT_AUTO_WATER_CONFIG = {
  keywords: [],
  schedule: {
    minInterval: 180,
    maxInterval: 600,
    dailyMax: 20,
    perRound: 10,          // 每轮灌水建议处理笔记篇数（随拟人挡位联动）
    kwIdx: 0,              // 当前要搜索的关键词下标（逐词推进：灌完一个点下一个，不批量刷新）
    autoAdvance: false,    // 自动推进总开关（严格流水线）
    autoStopWhen: 'perRound', // 判据：perRound=处理满每轮篇数算一词灌完；all=处理完当前词全部未灌才算
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

/* ─── 单篇灌水进度 ─── */
const WATER_PROGRESS_KEY = '_single_water_progress';

async function setSingleWaterProgress(msg) {
  await set(WATER_PROGRESS_KEY, { msg, updatedAt: Date.now() });
}

async function getSingleWaterProgress() {
  return await get(WATER_PROGRESS_KEY);
}

async function clearSingleWaterProgress() {
  await chrome.storage.local.remove(WATER_PROGRESS_KEY);
}

/* ─── 灌水总结：每次发送成功的明细（时间/笔记/评论/话术） ─── */
const WATER_LOGS_KEY = 'watering_logs';
const WATER_LOGS_LIMIT = 500; // 最多保留 500 条，超出裁剪最旧的

async function getWaterLogs() {
  const logs = (await get(WATER_LOGS_KEY)) || [];
  return Array.isArray(logs) ? logs : [];
}

/** 记录一条灌水明细（新记录放最前面） */
async function addWaterLog(entry) {
  const logs = await getWaterLogs();
  logs.unshift({ ...entry, ts: Date.now() });
  if (logs.length > WATER_LOGS_LIMIT) logs.length = WATER_LOGS_LIMIT;
  await set(WATER_LOGS_KEY, logs);
  return logs.length;
}

async function clearWaterLogs() {
  await set(WATER_LOGS_KEY, []);
}

/* ─── 获客清单 ─── */
async function getProspectList() {
  const raw = (await get(KEYS.PROSPECT_LIST)) || [];
  if (!Array.isArray(raw)) return [];
  // v2 䞩时迁移：命中旧结构则转换，一次性落库（幂等）
  let anyChanged = false;
  const list = raw.map(p => {
    const { person, changed } = _migrateOldProspect(p);
    if (changed) anyChanged = true;
    return person;
  });
  if (anyChanged) await set(KEYS.PROSPECT_LIST, list);
  return list;
}

async function saveProspectList(list) {
  await set(KEYS.PROSPECT_LIST, list);
}

/** 添加候选人（判重主键 userId，已存在则更新来源并返回 false） */
// 从主页链接里的 /user/profile/{id} 提取稳定用户 id（userLink / source.userUrl）
function _idFromUrl(person) {
  const u = (person && (person.userUrl || (person.source && person.source.userUrl))) || '';
  const m = String(u).match(/\/user\/(?:profile\/)?([a-z0-9_-]{6,})/i);
  return m ? m[1] : '';
}

// 来源优先级（从高到低）：评论跟进 > 评论 > 手动 > 点赞 > AI筛选。
// 同一个人多次进入时，origin 取优先级最高的来源，而不是"最后一次"。
// ★ v2 中 origin 仅作合并权重 + 徽章排错，不再承担"层"的语义（层由 stage 决定）。
const ORIGIN_PRIORITY = { '评论跟进': 5, '评论': 4, '手动': 3, '点赞': 2, 'AI筛选': 1 };
function _originWin(cur, neu) {
  const c = ORIGIN_PRIORITY[cur] || 0, n = ORIGIN_PRIORITY[neu] || 0;
  return n > c ? neu : cur;
}

/* ─── 获客清单：v1 → v2 迁移（惰性 + 幂等） ───
 * v1 用三套状态（dmStatus / customerStatus / intentLevel）+ origin / isLiker / keywordHit='__liker__'。
 * v2 收敛为「二级管线」：stage = lead（线索，未接触）/ prospect（商机，已接触）。
 *  - lead.prospect 只是"接触过没"：对线索池做了动作（私信/接触）即自动升为商机；
 *  - 客户不单独分层（成交不依赖私信控制），成交只在 prospect.funnel.step='closed' 作标注。
 * 迁移只在读到旧字段时才发生并一次性落库；已是 v2 的记录只做容器归一化（幂等）。
 */
const _STEP_FROM_DM = { pending: 'pending', invalid: 'pending', sent: 'touched', touched: 'touched', replied: 'replied', talking: 'talking', converted: 'closed', closed: 'closed' };
const _STATUS_FROM_STEP = { pending: '待触达', touched: '已触达', replied: '已回复', talking: '谈单中', closed: '已成交' };
const _DEFAULT_PROSPECT_STATUS = '待触达';
const _ORIGIN_TO_ENTRY = { '评论跟进': '评论跟进', '评论': '评论', '手动': '手动', '点赞': '点赞', 'AI筛选': 'AI路由' };

function _isLikerRec(p) {
  return !!(p && (p.isLiker || p.keywordHit === '__liker__' || p.origin === '点赞'));
}

// origin → stageEntry 口径（v2 不依赖 origin 定层，仅兜底转换显示用）
function _originToEntry(origin) {
  return _ORIGIN_TO_ENTRY[origin] || '';
}

// 无显式 stage 时，依据入口口径 + 旧状态推断所在层（二级：lead / prospect）
function _inferStage(person) {
  const entry = person.stageEntry || (person.source && person.source.stageEntry) || _originToEntry(person.origin);
  // 主动/对话/被主动联系 → 商机池；被动信号 → 线索池待接触
  if (entry === 'AI路由' || entry === '评论跟进' || entry === '回复' || entry === '消息' || entry === '手动') return 'prospect';
  if (person.dmStatus === 'converted') return 'prospect';
  if (String(person.customerStatus || '') && ['intent', 'sales', 'after_sale', 'dormant'].includes(person.customerStatus)) return 'prospect';
  return 'lead'; // 默认待接触：点赞/关注/关键词/普通评论先进线索池
}

/**
 * 迁移单条记录到 v2。返回 { person, changed }（changed=true 表示发生过变动，需写回）。
 * 幂等：已含 stage 的记录仅做容器归一化，不重复转换；只有确实变了才置 changed。
 */
function _migrateOldProspect(p) {
  if (!p || typeof p !== 'object') return { person: p, changed: false };
  let m = { ...p };
  let changed = false;
  const isLiker = _isLikerRec(p);
  const dm = String(p.dmStatus || '');
  const cs = String(p.customerStatus || '');

  // ── ① v1 → v2 转换（仅当尚无 stage）──
  if (!p.stage) {
    if (isLiker) {
      m.stage = 'lead';
    } else if (cs && (cs === 'intent' || cs === 'sales' || cs === 'after_sale' || cs === 'dormant')) {
      // 旧客户层已废弃：曾是客户 → 收敛到商机(已接触)，funnel.closed 保留"成交/售后"痕迹
      m.stage = 'prospect';
      m.funnel = { step: 'closed', dmCount: p.dmCount || 0, lastDmAt: p.lastDmAt || null };
      delete m.account; delete m.accountValue;
    } else if (dm === 'converted') {
      m.stage = 'prospect';
      m.funnel = { step: 'closed', dmCount: p.dmCount || 0, lastDmAt: p.lastDmAt || null };
    } else if (dm && Object.prototype.hasOwnProperty.call(_STEP_FROM_DM, dm)) {
      m.stage = 'prospect';
      m.funnel = { step: _STEP_FROM_DM[dm] || 'pending', dmCount: p.dmCount || 0, lastDmAt: p.lastDmAt || null };
    } else {
      m.stage = _inferStage(p); // 尊重入口口径：回复/主动联系 → prospect，否则 lead
    }
    changed = true;
  }

  // ── ② 层内容器归一化（v1/v2 都执行）+ 确保无残留旧 customer/account ──
  if (m.stage === 'prospect' && !m.funnel) { m.funnel = { step: 'pending', dmCount: p.dmCount || 0, lastDmAt: p.lastDmAt || null }; changed = true; }
  if (m.stage === 'prospect' && !m.status) { m.status = _STATUS_FROM_STEP[m.funnel.step] || _DEFAULT_PROSPECT_STATUS; changed = true; }
  if (m.stage === 'lead' && !m.lead) { m.lead = { signalCount: 0, signals: [], lastSignalAt: null }; changed = true; }
  if (m.account) { delete m.account; changed = true; }
  if (m.stage === 'customer') { m.stage = 'prospect'; if (!m.funnel) m.funnel = { step: 'closed', dmCount: p.dmCount || 0, lastDmAt: p.lastDmAt || null }; if (!m.status) m.status = '已成交'; changed = true; }

  // ── ③ affinity：意向仅作排序权重 ──
  if (!m.affinity) { m.affinity = { intentLevel: p.intentLevel || (p.profile && p.profile.intentLevel) || 'medium' }; changed = true; }

  // ── ④ source + stageEntry 兜底 ──
  const src = (m.source && typeof m.source === 'object') ? m.source : {};
  if (!src.stageEntry) { src.stageEntry = _originToEntry(p.origin) || (isLiker ? '点赞' : (m.stage === 'prospect' ? 'AI路由' : '评论')); changed = true; }
  m.source = src;

  // ── ⑤ 清 v1 旧字段 ──
  if (!p.stage) {
    delete m.dmStatus; delete m.lastDmAt; delete m.likedComment; delete m.isLiker;
    delete m.customerStatus; delete m.accountValue;
    if (m.keywordHit === '__liker__') delete m.keywordHit;
    changed = true;
  }

  return { person: m, changed };
}

/**
 * 把调用方可能传的 v1 写入口径换算成 v2（防止旧写者弄脏 v2 记录）。
 * 例如 dmStatus→funnel.step、customerStatus→account.status、isLiker/likedComment→lead 信号。
 */
function _coerceUpdateStages(updates) {
  const out = { ...(updates || {}) };
  if ('dmStatus' in out) {
    out.funnel = Object.assign({}, out.funnel && typeof out.funnel === 'object' ? out.funnel : {}, {
      step: _STEP_FROM_DM[out.dmStatus] || 'pending', dmCount: out.dmCount || 0, lastDmAt: out.lastDmAt || null,
    });
    delete out.dmStatus;
  }
  if ('dmCount' in out) { if (out.funnel && typeof out.funnel === 'object') out.funnel.dmCount = out.dmCount; delete out.dmCount; }
  if ('lastDmAt' in out) { if (out.funnel && typeof out.funnel === 'object') out.funnel.lastDmAt = out.lastDmAt; delete out.lastDmAt; }
  if ('customerStatus' in out) { delete out.customerStatus; } // 客户层已废弃，忽略旧写入
  // 层升级标准化：调用方把 target 传成 customer → 收敛为 prospect（funnel.closed 标注）
  if (out.stage === 'customer') { out.stage = 'prospect'; out.funnel = Object.assign({ step: 'closed', dmCount: 0, lastDmAt: null }, out.funnel && typeof out.funnel === 'object' ? out.funnel : {}); delete out.account; }
  if (out.isLiker) {
    out.lead = Object.assign({ signalCount: 1, signals: ['liked'], lastSignalAt: Date.now() }, out.lead && typeof out.lead === 'object' ? out.lead : {});
  }
  delete out.isLiker; delete out.likedComment;
  return out;
}

async function addProspect(person) {
  const list = await getProspectList();
  // ★ 去重：稳定主键 = userId（或从 source.userUrl 里的 /user/profile/{id} 提取），
  //   保证"同一个人的不同 entry"合并成一条，避免跨入口重复。都没取到 id 才按昵称兜底。
  const id = person.userId || _idFromUrl(person); // person.userUrl / person.source.userUrl
  const _idOf = (p) => (p && p.userId) || _idFromUrl(p);
  let idx = -1;
  if (id) {
    const lk = String(id).toLowerCase();
    idx = list.findIndex(p => {
      const pid = _idOf(p);
      return !!pid && String(pid).toLowerCase() === lk;
    });
  } else if (person.nickname) {
    idx = list.findIndex(p => !_idOf(p) && p.nickname && p.nickname === person.nickname);
  }
  if (idx >= 0) {
    // 合并：更新信息，但 origin 按优先级取（不追最后）；isLiker/点赞内容做并集，避免低优先级来源洗掉
    const prev = list[idx];
    const merged = { ...prev, ...person, updatedAt: Date.now() };
    merged.origin = _originWin(prev.origin || '', person.origin || prev.origin || '');
    merged.isLiker = !!(prev.isLiker || person.isLiker);
    merged.likedComment = merged.likedComment || prev.likedComment || '';
    list[idx] = merged;
    await set(KEYS.PROSPECT_LIST, list);
    return { added: false, person: list[idx] };
  }
const entry = {
    id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: person.userId || '',
    nickname: person.nickname || '未知用户',
    source: { ...(person.source || {}), stageEntry: person.stageEntry || (person.source && person.source.stageEntry) || _originToEntry(person.origin) || '评论' },
    keywordHit: person.keywordHit || null,
    profile: person.profile || null,
    // ★ v2：一条 stage（lead/prospect）+ 层内子状态
    stage: person.stage || _inferStage(person),
    lead: { signalCount: 0, signals: [], lastSignalAt: null },
    funnel: null,
    convId: person.convId || '',   // ★ 消息中心会话 id（/chat/{convId}），用于消息台直接跳转目标会话
    affinity: { intentLevel: (person.profile && person.profile.intentLevel) || person.intentLevel || 'medium' },
    chatHistory: Array.isArray(person.chatHistory) ? person.chatHistory : null, // 评论跟进的历史对话（记录我们跟对方说过啥）
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // 客户层已废弃：调用方仍传 customer → 收敛到商机
  if (entry.stage === 'customer') entry.stage = 'prospect';
  // 补齐层内容器
  if (entry.stage === 'prospect') { entry.funnel = { step: _STEP_FROM_DM[person.dmStatus] || 'pending', dmCount: person.dmCount || 0, lastDmAt: person.lastDmAt || null }; entry.status = person.status || _STATUS_FROM_STEP[entry.funnel.step] || _DEFAULT_PROSPECT_STATUS; }
  else entry.lead = { signalCount: person.isLiker ? 1 : 0, signals: person.isLiker ? ['liked'] : [], lastSignalAt: person.isLiker ? Date.now() : null };
  list.unshift(entry);
  await set(KEYS.PROSPECT_LIST, list);
  return { added: true, person: entry };
}

async function updateProspect(id, updates) {
  const list = await getProspectList();
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return null;
  // 把 v1 写入口径换算成 v2，再合并 + 归一化，防止旧写者弄脏结构
  const coerced = _coerceUpdateStages(updates || {});
  const merged = Object.assign({}, list[idx], coerced, { updatedAt: Date.now() });
  list[idx] = _migrateOldProspect(merged).person;
  await set(KEYS.PROSPECT_LIST, list);
  return list[idx];
}

async function deleteProspect(id) {
  const list = await getProspectList();
  await set(KEYS.PROSPECT_LIST, list.filter(p => p.id !== id));
  return { ok: true };
}

/* ─── 获客清单：私信历史 ─── */
async function getDmHistory() {
  return (await get(KEYS.PROSPECT_DM_HISTORY)) || [];
}

async function addDmRecord(record) {
  const list = await getDmHistory();
  list.unshift({
    id: 'dm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sentAt: Date.now(),
    ...record,
  });
  if (list.length > 200) list.length = 200;
  await set(KEYS.PROSPECT_DM_HISTORY, list);
  return list[0];
}

/* ─── 发笔记：已用选题池（剔除已发送过） ─── */
async function loadUsedTopics() {
  const d = (await get(KEYS.NP_USED_TOPICS)) || [];
  return Array.isArray(d) ? d : [];
}
async function addUsedTopic(item) {
  const list = await loadUsedTopics();
  list.unshift({ text: String((item && item.text) || '').trim(), fingerprint: (item && item.fingerprint) || '', addedAt: Date.now() });
  if (list.length > 500) list.length = 500;
  await set(KEYS.NP_USED_TOPICS, list);
  return list;
}
async function clearUsedTopics() {
  await set(KEYS.NP_USED_TOPICS, []);
}
/**
 * 过滤掉与已用池重复的候选（语义去重：两段文本去除停用字后的核心词集合有较大交叠即判重复）
 * @param {string[]} candidates
 * @returns {string[]} 过滤后的候选
 */
async function filterOutUsed(candidates) {
  const used = await loadUsedTopics();
  const usedSet = used.map(u => (u.fingerprint || u.text || '')).filter(Boolean);
  const stop = '的了我你他它这个是就是很都在和跟与也还应该让给对把被能会一个说着在有要不起'.split('');
  const core = (s) => {
    const a = (String(s) || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
    const ks = {};
    for (const ch of a) { if (!stop.includes(ch)) ks[ch] = (ks[ch] || 0) + 1; }
    return Object.keys(ks).join('');
  };
  const usedCores = usedSet.map(core).filter(Boolean);
  const out = [];
  outer: for (const c of (candidates || [])) {
    const cc = core(c);
    if (!cc) { out.push(c); continue; }
    for (const uc of usedCores) {
      let hit = 0;
      for (const ch of cc) if (uc.includes(ch)) hit++;
      if (hit >= 3 && hit >= Math.min(3, cc.length)) continue outer; // 核心字重叠多 → 判重复
    }
    out.push(c);
  }
  return out;
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
  // single water progress
  setSingleWaterProgress, getSingleWaterProgress, clearSingleWaterProgress,
  // watering summary logs
  getWaterLogs, addWaterLog, clearWaterLogs,
  // chat follow (评论跟进：通知页会话状态)
  getChatFollowState, setChatFollowState,
  getChatFollowReplyHistory, addChatFollowReplyHistory,
  // prospect list (获客清单)
  getProspectList, saveProspectList, addProspect, updateProspect, deleteProspect,
  getDmHistory, addDmRecord,
  // 发笔记：已用选题池
  loadUsedTopics, addUsedTopic, clearUsedTopics, filterOutUsed,
};

// 支持 ES module 和 Service Worker importScripts 两种方式
if (typeof module !== 'undefined') {
  module.exports = Storage;
}
