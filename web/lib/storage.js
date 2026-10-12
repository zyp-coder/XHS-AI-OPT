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
  // ★ 发笔记：笔记档案（每写一篇留一档：成稿/提示词/口播稿 + 自己的发布状态）
  NP_NOTES: 'np_notes',
  // ★ 发笔记：素材库（只存引用 + ≤160px 缩略图索引，原图不入库）
  NP_ASSETS: 'np_assets',
  // ★ 发笔记：素材需求清单（AI 按 卖点 × 知识库 × 表现形式 算出来的「要备哪些图」+ 我的三态标记；可重建）
  NP_ASSET_NEEDS: 'np_asset_needs',
};

/* ─── 默认配置 ─── */
const DEFAULT_CONFIG = {
  product: {
    name: '我的产品',
    // ★ 产品名多值：names[0]＝主名、后面＝别名（喂提示词拼「主名（又名：A / B）」）。
    //   name 恒等于主名，读旧字段的地方一字不用改；空数组＝只有一个叫法。
    names: [],
    promoGoal: '',
    guideText: '',
    description: '',
    targetKeywords: [],
    // ★ 评论目的（6 选 1：sell/brand/profile/likes/trend/auto）：这一批商机评论打什么目的。
    //   入口在「获客助手」顶部的评论目的选择器（找商机时改）；留空 = 沿用旧 scriptStyle.scriptPurpose 或默认 sell
    //   （老配置兜底，见 background.resolveCommentPurpose）
    commentPurpose: '',
    // ★ 产品卖点（1~10 个）：{ title, content, image }。title/content 喂评论/文案提示词；
    //   image(base64 配图) 在「发笔记」选中该卖点时列出，作为文案配图元素加工。
    sellPoints: [],
    // ★ 承接兜底：引流方式（老配置兜底，新配置走 guideText；见 background 的 guide 兜底链）
    cta: '私信"玄铁剑"领试用版',
    coverHook: '',        // 一句话人设短语；AI 建人设时沉淀，注入账号诊断的评估上下文
  },
  // ★ 发笔记默认发到哪个平台（xhs/douyin/kuaishou/xianyu，真源见 lib/platforms.js）：
  //   向导① 选平台时写回这里，跟着产品（租户）走——换个产品不必重选；老配置没有这个键＝小红书
  notePlatform: '',
  // ★ 我的小红书账号昵称（可多个）。评论助手扫描时，若发现笔记里已有我的名字的评论，
  //   就直接判定这篇已灌水、跳过 AI，并记入已灌水清单。
  myAccountNames: [],
  // ★ 同城判定用城市（基础配置抓本人主页时记录，抓不到可手填）：
  //   { city: 城市/地区（如"深圳"，缺省时回落 IP 属地）, ipLocation: 主页 IP 属地（如"广东"）, source: auto|manual, updatedAt }
  //   评论助手扫评论时用它与评论人的属地匹配（同省即算同城）
  myCity: { city: '', ipLocation: '', source: '', updatedAt: 0 },
  // ★ 同城挡位（诊断&配置 → 基础配置 里切换）：
  //   'force'    = 同城就回：不管是不是商机，同城真人评论一律纳入回复
  //   'priority' = 同城优先：同城往前排 + 话术尽量走同城案例角度，但不强制纳入
  //   'off'      = 关闭：不单独对同城评论，same_city 一律 false
  sameCityMode: 'priority',
  // ★ 账号人设（由「设置→话术风格→我的账号人设」的 AI 建人设流程生成并保存）：
  //   { text: 整合后的人设正文（注入评论/文案生成用）, bio: 账号简介原文, qa: {q1..q5}, updatedAt, footer, coverHook }
  persona: null,
  ai: {
    apiKey: '',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    temperature: 0.8,
    maxTokens: 4096,
    // 备用模型（主模型失败时自动切换，可选）
    fallbackApiKey: '',
    fallbackApiBaseUrl: '',
    fallbackModel: '',
  },
  scriptStyle: {
    // ★ 评论目的只剩 product.commentPurpose（入口在获客助手）；此处不再默认，仅保留老配置里已有的值供兜底读取
    // 字数控制（评论目的版：单范围；兼容旧统一 minChars/maxChars）
    purposeMinChars: 100, purposeMaxChars: 300,
    // 口癖词（AI 按「人设 → 说话风格」3 问识别出来，逗号/顿号分隔；留空用内置池）
    toneMannerisms: '',
    // 我的口吻（AI 按 3 问回答识别出的语感画像，评论/私信的语气第一基准）
    toneProfile: '',
    // 那 3 问的原始回答（页面上回填用，不喂给提示词）
    toneAnswers: [],
    // 口吻样本（旧版手贴的评论；新流程由 AI 按回答仿写 3 条写入，作 few-shot 校准用词）
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
  // ★ AI客服：触达场景(A) + 客户问答话术库(B) —— 小红书获客/销售统一话术体系
  aiCustomerService: {
    scenes: {
      comment_first: { name: '评论首评', enabled: true, purpose: 'sell', mode: 'draft', minChars: 20, maxChars: 80, toneMannerisms: '', guidance: '主页', useKb: true, template: '这条说得太实在了，我也曾是这么过来的。关键别闷头试，{卖点1}。想少走弯路的可以看看{购买入口}，我把它整理成能直接用的了。', promptScene: 'scen_comment_first', schedule: { gapMin: 45, gapMax: 180, dailyMax: 15 } },
      comment_reply: { name: '评论回应', enabled: true, purpose: 'sell', mode: 'draft', minChars: 20, maxChars: 90, toneMannerisms: '', guidance: '主页', useKb: true, template: '', promptScene: 'scen_comment_reply', schedule: { gapMin: 45, gapMax: 180, dailyMax: 15 } },
      dm_first: { name: '私信首触', enabled: true, purpose: 'sell', mode: 'draft', minChars: 60, maxChars: 150, toneMannerisms: '', guidance: '私信', useKb: true, template: '', promptScene: 'scen_dm_first', schedule: { gapMin: 30, gapMax: 90, dailyMax: 20 } },
      chat_follow: { name: '消息跟单', enabled: true, purpose: 'sell', mode: 'draft', minChars: 40, maxChars: 120, toneMannerisms: '', guidance: '主页', useKb: true, template: '', promptScene: 'scen_chat_follow', schedule: { gapMin: 30, gapMax: 90, dailyMax: 20 } },
      after_sale: { name: '成交维护', enabled: true, purpose: 'brand', mode: 'draft', minChars: 40, maxChars: 120, toneMannerisms: '', guidance: '', useKb: true, template: '用到现在还顺手吗？有卡壳的地方别客气，直接跟我说，我帮你拆到能跑动。等跑顺了，把效果截图丢我看看，我再给你指指还能优化的点。', promptScene: 'scen_after_sale', schedule: { gapMin: 60, gapMax: 180, dailyMax: 10 } },
      notif_reply: { name: '通知回访', enabled: true, purpose: 'sell', mode: 'draft', minChars: 20, maxChars: 80, toneMannerisms: '', guidance: '主页', useKb: true, template: '', promptScene: 'scen_notif_reply', schedule: { gapMin: 30, gapMax: 120, dailyMax: 15 } },
      sales_close: { name: '销售促成', enabled: true, purpose: 'sell', mode: 'draft', minChars: 30, maxChars: 90, toneMannerisms: '', guidance: '私信', useKb: true, template: '', promptScene: 'scen_sales_close', schedule: { gapMin: 30, gapMax: 120, dailyMax: 15 } },
    },
    // ★ 渠道基调（配置-通知）：按线索来源渠道定首触策略，话术一律 AI 生成，不手写固定话术
    //   tone ＝ 用户自己补的基调（「线索 → 任务配置 → 🎙 渠道基调」里改，留空＝只说系统那套）
    channels: {
      comment: { name: '评论/回复', auto: 'draft', minChars: 30, maxChars: 90, dailyMax: 0, promptScene: 'scen_ch_comment', tone: '' },
      like: { name: '点赞', auto: 'draft', minChars: 30, maxChars: 90, dailyMax: 0, promptScene: 'scen_ch_like', tone: '' },
      follow: { name: '关注', auto: 'draft', minChars: 40, maxChars: 120, dailyMax: 0, promptScene: 'scen_ch_follow', tone: '' },
      ai: { name: 'AI抓回', auto: 'draft', minChars: 40, maxChars: 120, dailyMax: 0, promptScene: 'scen_ch_ai', tone: '' },
    },
    // ★ 成交/引导（产品级一份，4 渠道共用）：怎么引导成交
    guide: { deliver: '', tips: '' },
    qa: [
      { id: 'qa_logistics', category: '物流', keywords: ['几号发', '什么时候到', '有现货', '发货', '时效', '有没有货', '多久能收到'], mode: 'template', auto: 'draft', enabled: true, answer: '{产品}一般付款后 24 小时内发货（节假日顺延），默认快递，通常 2-3 天到。您留个收货地址我这就给您安排，到了我会第一时间提醒您。如果急用跟我说，我帮您备注加急尽早发出。' },
      { id: 'qa_detail', category: '产品细节', keywords: ['是什么', '怎么用', '几页', '多少', '包含什么', '有没有', '功能', '能不能这样'], mode: 'ai', auto: 'draft', enabled: true, answer: '按知识库+对方具体一句现场作答；骨架：关键在{卖点1}/{卖点2}/{卖点3}，需要可发成品图/案例参考。' },
      { id: 'qa_fit', category: '适用性追问', keywords: ['零基础', '适不适合', '我是', '新手', '可以不', '不会'], mode: 'template', auto: 'draft', enabled: true, answer: '这个主要看您的{适用人群}。像您这样的情况，用它最省事——因为{卖点1}。如果拿不准，您跟我说下具体情况，我帮您看适不适合、该从哪一步开始，不合适我不怂恿您。' },
      { id: 'qa_price', category: '比价', keywords: ['贵', '便宜', '优惠', '打折', '团购', '和xx比', '活动', '多少钱'], mode: 'template', auto: 'confirm', enabled: true, answer: '价格其实就{价格}，按月付费、不是一锤子买卖，用起来有问题我全程跟进。如果现在需要，我可以帮您申请点小优惠或赠品，就当交个朋友。' },
      { id: 'qa_order', category: '确认下单', keywords: ['怎么买', '怎么付款', '有货吗', '下单', '流程', '链接', '怎么购买'], mode: 'template', auto: 'confirm', enabled: true, answer: '下单很简单：确认没问题的话，我直接给到{购买入口}，您拍下即可，我全程跟进。付款后第一时间安排，后续使用有问题随时找我，不放心可以先{试用方式}。' },
      { id: 'qa_after', category: '售后顾虑', keywords: ['怕坑', '万一', '不好用', '能退吗', '退款', '售后', '被坑过', '不靠谱'], mode: 'template', auto: 'draft', enabled: true, answer: '您担心得对，花钱前谨慎应该的。我们这边：全程{产品}售后指导，不是卖了不管；真实用了不满意，我陪您把问题解决到。有顾虑咱先把条款/效果聊透再下单，不让您踩坑。' },
      { id: 'qa_ice', category: '破冰寒暄', keywords: ['你好', '在吗', '刚看到', '了解下', '路过', '哈喽'], mode: 'template', auto: 'auto', enabled: true, answer: '您好呀，看到您来啦～ 您是刚好刷到还是专门来问的？想了解{产品}怎么用、适合什么情况，跟我说一声，我给您讲明白。' },
      { id: 'qa_promo', category: '促销节点', keywords: ['活动', '双十一', '优惠活动', '限时', '节日', '福利'], mode: 'template', auto: 'confirm', enabled: true, answer: '正好赶上{活动}，现在下单有{优惠}（限时）。需要的话这波别错过，我把规格和到手价跟您说清，您再决定。' },
      { id: 'qa_fallback', category: '通用兜底', keywords: [], mode: 'ai', auto: 'off', enabled: true, answer: '您好，您问的这个我仔细看了。先跟您确认下我理解对没——{用户原话}？如果是指这方面，那{指向产品/让TA补充}；要是我会错意了，您再描述下，我重新给到参考。' },
    ],
  },
};

/* ─── 通用读写 ───
 * 敏感 key（知识库/获客清单/会话/日志等）与 config 内 AI Key 在本层统一加密落盘：
 * 写前加密、读后解密，调用方拿到的始终是明文；旧明文数据读取时原样返回（下次写入自动升级）。
 * ★ 直接读写 chrome.storage.local 的旁路代码必须走 DataPrivacy.lock/unlock，否则会写回明文。
 */
async function get(key) {
  const data = await chrome.storage.local.get(key);
  const raw = data[key];
  if (typeof DataPrivacy === 'undefined' || raw === undefined || raw === null) return raw;
  if (key === KEYS.CONFIG) return DataPrivacy.unlockConfig(raw);
  if (DataPrivacy.isEncKey(key)) return DataPrivacy.unlock(key, raw);
  return raw;
}

async function set(key, value) {
  let v = value;
  if (typeof DataPrivacy !== 'undefined' && value !== undefined && value !== null) {
    v = (key === KEYS.CONFIG) ? await DataPrivacy.lockConfig(value) : await DataPrivacy.lock(key, value);
  }
  await chrome.storage.local.set({ [key]: v });
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
  // ★ 默认模型自动迁移：老版还在用已下线的 deepseek-chat → 自动切到新 deepseek-v4-flash；
  //   不要再把 v4 模型改回聊天模型（deepseek-chat 已下线）。_modelLocked 时尊重手动。
  const MODEL_OVERRIDE = {
    'deepseek-chat': 'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-pro',
    'deepseek-ai/DeepSeek-V3.2': 'deepseek-ai/DeepSeek-V3.2',
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
    perRound: 10,          // 每轮灌水处理笔记篇数：真源＝note_trend_config.maxPerRound（设置页「灌水频率与去重」保存时同步过来），0=不限
    kwIdx: 0,              // 当前要搜索的关键词下标（逐词推进：灌完一个点下一个，不批量刷新）
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

/* ─── 评论记录（笔记池页尾「💧 评论记录」）：每次发送成功的明细（时间/笔记/评论/话术） ─── */
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
async function getProspectList(includeDiscarded) {
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
  // ★ 返回全部记录（含标废）；"隐藏标废"由前端渲染决定，避免底层读把数据滤没导致清单空
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

// 是否"已接触"：有会话 / 私信已实质推进（非 pending）# / 客户状态在经营中
// 是否已建立"双向对话"（对方回过你 / 主动找你 / 回你评论）→ 才是真商机。
// 仅"我发出私信 / 我打开会话 / 我触达过"对方还没回 → 不算（留在线索池待回复）。
function _isTwoWay(person) {
  if (!person || typeof person !== 'object') return false;
  if (person.themReplied) return true;                        // 对方回过
  if (person.inbound) return true;                            // 对方主动私信你（进线）
  if (person.convId && (person.unread || person.themReplied)) return true; // 有会话且对方来过消息
  const fu = person.funnel && person.funnel.step;
  if (fu && (fu === 'replied' || fu === 'talking' || fu === 'closed')) return true; // 进入已回复之后的阶段
  const cs = String(person.customerStatus || '');
  if (cs && ['intent', 'sales', 'after_sale', 'dormant'].includes(cs)) return true;
  // ★ 双向只认"真·进消息里说过话"（inbound / themReplied / convId+对方来消息）。
  //   通知页的"回评/回复/关注/点赞"即使对方回应过，只要还没进私信就算线索（lead），
  //   推进靠"我方用话术回复→进入消息→对方再回"才升商机。
  return false;
}

// 层判定：由【是否已建立双向对话】决定。
// 未双向（仅被触达/有意愿）→ 线索池(lead)；对方回过/主动 → 商机池(prospect)。
function _inferStage(person) {
  return _isTwoWay(person) ? 'prospect' : 'lead';
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

  // ── ②b 新规则：非双向（对方未回过/未主动）的商机 → 降回线索池，标"已触达·待回复" ──
  if (m.stage === 'prospect' && !_isTwoWay(m)) {
    const wasTouched = !!(String(m.dmStatus || '') && _STEP_FROM_DM[String(m.dmStatus)]) || !!(m.funnel && (m.funnel.step === 'touched' || m.funnel.step === 'pending'));
    m.stage = 'lead';
    if (m.funnel) { delete m.funnel; changed = true; }
    delete m.status; changed = true;
    if (wasTouched) m.awaitingReply = true;
    if (m.themReplied) { m.themReplied = false; changed = true; }
    if (!m.lead) { m.lead = { signalCount: 0, signals: [], lastSignalAt: null }; changed = true; }
  }

  // ── ③ affinity：意向仅作排序权重 ──
  if (!m.affinity) { m.affinity = { intentLevel: p.intentLevel || (p.profile && p.profile.intentLevel) || 'medium' }; changed = true; }

  // ── ④ source + stageEntry 兜底 ──
  const src = (m.source && typeof m.source === 'object') ? m.source : {};
  if (!src.stageEntry) { src.stageEntry = _originToEntry(p.origin) || (isLiker ? '点赞' : (m.stage === 'prospect' ? 'AI路由' : '评论')); changed = true; }
  m.source = src;

  // ── ④b 会话方向（direction）：老记录兜底推导。真进线→inbound；我发过/有过会话→outbound；否则空(通知/评论未进线) ──
  if (!m.direction) {
    const sent = String(m.dmStatus || '') && _STEP_FROM_DM[String(m.dmStatus)];
    if (m.inbound || m.stageEntry === '消息' || src.stageEntry === '消息') m.direction = 'inbound';
    else if (m.convId || sent || (m.funnel && m.funnel.step && m.funnel.step !== 'pending')) m.direction = 'outbound';
    else m.direction = '';
    changed = true;
  } else if (m.direction !== 'inbound' && m.direction !== 'outbound') {
    m.direction = (m.inbound || src.stageEntry === '消息') ? 'inbound' : '';
    changed = true;
  }

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

/* ─── 多来源渠道(channels[])：每条记录保留历次渠道，供「用户清单」一人多来源展示 ─── */
function _chEntryOf(person) {
  return (person && (person.stageEntry || (person.source && person.source.stageEntry))) || (person && person.origin ? _originToEntry(person.origin) : '') || '';
}
function _channelOfEntry(e) {
  if (e === '关注') return '关注';
  if (e === '点赞' || e === '收藏') return '点赞&收藏';
  if (e === '回复' || e === '评论' || e === '互动') return '评论';
  if (e === 'AI路由' || e === '关键词命中' || e === '评论跟进') return 'AI';
  return '';
}
function _makeChannelObj(person) {
  const src = (person && person.source) || {};
  const entry = _chEntryOf(person);
  return {
    type: _channelOfEntry(entry) || '评论',
    entry: entry || '评论',
    comment: src.comment || (person && person.likedComment) || '',
    noteTitle: src.noteTitle || '',
    userUrl: src.userUrl || '',
    nTime: (person && person.nTime) || null,
    nTimeStr: (person && person.nTimeStr) || '',
    signalText: src.signalText || (person && person.likedComment) || '',
  };
}
function _legacyChannel(prev) {
  const e = (prev && (prev.source && prev.source.stageEntry)) || (prev && prev.origin ? _originToEntry(prev.origin) : '');
  if (!e) return [];
  return [{ type: _channelOfEntry(e) || '评论', entry: e, comment: (prev.source && prev.source.comment) || prev.likedComment || '', noteTitle: (prev.source && prev.source.noteTitle) || '', userUrl: (prev.source && prev.source.userUrl) || '', nTime: prev.nTime || null, nTimeStr: prev.nTimeStr || '', signalText: (prev.source && prev.source.signalText) || '' }];
}
function _mergeChannels(existing, ch) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const has = (c) => c && c.type && String(c.type) === String(ch.type);
  const i = out.findIndex(has);
  if (i >= 0) out[i] = { ...out[i], ...ch, type: out[i].type };
  else out.push(ch);
  return out;
}

// 给已有记录追加一个渠道（已存在在触发场景：通知采集时同一个人第二次/更多次渠道命中）
async function appendChannel(id, person) {
  if (!id || !person) return { ok: false };
  const list = await getProspectList();
  const idx = list.findIndex(p => p && p.id === id);
  if (idx < 0) return { ok: false };
  const rec = list[idx];
  const merged = { ...rec };
  merged.channels = _mergeChannels(Array.isArray(rec.channels) ? rec.channels : _legacyChannel(rec), _makeChannelObj(person));
  list[idx] = merged;
  await set(KEYS.PROSPECT_LIST, list);
  return { ok: true };
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
    // 多来源：合并历次渠道（同渠道更新，跨渠道追加）
    merged.channels = _mergeChannels(
      Array.isArray(prev.channels) ? prev.channels : _legacyChannel(prev),
      _makeChannelObj(person)
    );
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
    // ★ 私信进线：对方主动私信你（inbound）+ 未读标记 + 最近一条消息
    inbound: !!person.inbound,
    direction: (person.direction === 'inbound' || person.direction === 'outbound') ? person.direction : (person.inbound ? 'inbound' : ''),
    unread: person.unread === true,
    lastMsg: person.lastMsg || '',
    lastConvFp: (person.lastConvFp && typeof person.lastConvFp === 'object') ? person.lastConvFp : null, // 最近见过会话最后消息 {msg,at}
    // ★ 双向对话：对方回过你（themReplied）/ 已触达待回复（awaitingReply）
    themReplied: !!(person.themReplied || person.inbound),
    themRepliedAt: person.themRepliedAt || null,
    promotedHow: person.promotedHow || '',
    awaitingReply: person.awaitingReply === true,
    // ★ 通知：AI 产品相关性标记 + 通知真实时间（新建条目必须显式保存，否则丢失）
    aiTag: person.aiTag || null,
    nTime: person.nTime || null,
    nTimeStr: person.nTimeStr || '',
    // 多来源渠道（历次信号）
    channels: Array.isArray(person.channels) ? person.channels : [_makeChannelObj(person)],
    order: person.order !== undefined ? person.order : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // 客户层已废弃：调用方仍传 customer → 收敛到商机
  if (entry.stage === 'customer') entry.stage = 'prospect';
  // 补齐层内容器
  if (entry.stage === 'prospect') {
    const twoWay = person.themReplied || person.inbound || entry.inbound || entry.themReplied;
    const step = twoWay ? 'replied' : (_STEP_FROM_DM[person.dmStatus] || 'pending');
    entry.funnel = { step, dmCount: person.dmCount || 0, lastDmAt: person.lastDmAt || null };
    entry.status = person.status || _STATUS_FROM_STEP[step] || _DEFAULT_PROSPECT_STATUS;
  }
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

async function deleteProspect(id, opts) {
  const hard = !!(opts && opts.hard);
  const list = await getProspectList(true); // 含已废弃，标废的不因换视图丢失
  const next = [];
  for (const p of list) {
    if (p.id !== id) { next.push(p); continue; }
    if (hard) continue; // 彻底删除：直接丢弃该记录
    next.push({ ...p, status: '已废弃' }); // 软标废 = 把状态改成"已废弃"（进回收站，可恢复）
  }
  await set(KEYS.PROSPECT_LIST, next);
  return { ok: true };
}

// 清空获客清单（一键全清）
async function clearProspectList() {
  await set(KEYS.PROSPECT_LIST, []);
  return { ok: true, cleared: true };
}

// 按桶清空（msg=消息/进线；notif=通知）：只删该桶记录，其它桶保留
async function clearProspectBucket(bucket) {
  const list = await getProspectList(true); // 含已废弃，删不依赖视图
  const isMsg = p => !!(p && (p.inbound || p.direction === 'inbound' || (p.source && p.source.stageEntry === '消息')));
  const next = [];
  let removed = 0;
  for (const p of list) {
    const inBuck = bucket === 'msg' ? isMsg(p) : !isMsg(p);
    if (inBuck) { removed++; continue; }
    next.push(p);
  }
  await set(KEYS.PROSPECT_LIST, next);
  return { ok: true, bucket, removed };
}

/* ─── AI客服：触达场景(A) + 客户问答话术库(B) 配置（按租户隔离，深合并默认） ─── */
async function getAiCsConfig() {
  const cfg = await getConfig();
  return {
    scenes: cfg.aiCustomerService && cfg.aiCustomerService.scenes ? cfg.aiCustomerService.scenes : DEFAULT_CONFIG.aiCustomerService.scenes,
    channels: cfg.aiCustomerService && cfg.aiCustomerService.channels ? cfg.aiCustomerService.channels : DEFAULT_CONFIG.aiCustomerService.channels,
    guide: cfg.aiCustomerService && cfg.aiCustomerService.guide ? cfg.aiCustomerService.guide : DEFAULT_CONFIG.aiCustomerService.guide,
    qa: (cfg.aiCustomerService && Array.isArray(cfg.aiCustomerService.qa)) ? cfg.aiCustomerService.qa : DEFAULT_CONFIG.aiCustomerService.qa,
  };
}

async function saveAiCsConfig(partial) {
  const cfg = await getConfig();
  const cur = cfg.aiCustomerService || {};
  cfg.aiCustomerService = { ...cur, ...(partial || {}) };
  await setConfig(cfg);
  return getAiCsConfig();
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
  // 通用读写（含敏感 key 的加解密）
  get, set,
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
  getProspectList, saveProspectList, addProspect, updateProspect, deleteProspect, clearProspectList, clearProspectBucket, appendChannel,
  getDmHistory, addDmRecord,
  // AI客服：场景+问答话术
  getAiCsConfig, saveAiCsConfig,
  // 发笔记：已用选题池
  loadUsedTopics, addUsedTopic, clearUsedTopics, filterOutUsed,
};

// 支持 ES module 和 Service Worker importScripts 两种方式
if (typeof module !== 'undefined') {
  module.exports = Storage;
}
