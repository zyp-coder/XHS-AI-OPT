/**
 * ai-providers.js — AI 服务商/模型清单 + 知识库八分类（单一真源）
 *
 * 消费者：
 *   - settings.js（设置页 → AI 模型配置）      ← 经典 <script>（settings.html）
 *   - popup.js（弹窗内嵌首次设置）             ← 经典 <script>（popup.html）
 *   - wizard.js（首次设置向导）                ← 经典 <script>（wizard.html）
 *   - background.js（知识库分类校验/提示）      ← importScripts
 *
 * 模型条目统一结构：{ value, label }。
 * 注意：本文件在多个上下文共享，只用顶层 const 声明，不要写裸 window（后台会整体不启动）。
 */
const PROVIDER_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（新，快、省，推荐）' },
      { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（新，更强，费 token）' },
    ],
  },
  ark: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    // 方舟网关的 CORS 预检只放行 Content-Type、不放行 Authorization，后台 fetch 会被浏览器拦掉；
    // 主包 host_permissions 又刻意保持不动（已装客户机升级不被要求重新授权）→ 靠保存/测试时
    // 按需申请该域名授权，见 ensureProviderHostGranted()。改 baseUrl 时记得同步 needsHostGrant。
    needsHostGrant: true,
    models: [
      { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（快、省，推荐）' },
      { value: 'doubao-seed-2.1-pro', label: 'doubao-seed-2.1-pro（豆包旗舰）' },
      { value: 'doubao-seed-evolving', label: 'doubao-seed-evolving' },
      { value: 'doubao-seed-2.1-lite', label: 'doubao-seed-2.1-lite' },
      { value: 'doubao-seed-2.0-mini', label: 'doubao-seed-2.0-mini' },
      { value: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash' },
      { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（推理，费 token）' },
      { value: 'glm-5.3', label: 'glm-5.3（智谱旗舰）' },
      { value: 'glm-5.3-flash', label: 'glm-5.3-flash' },
      { value: 'kimi-k3', label: 'kimi-k3' },
      { value: 'kimi-k2.8-preview', label: 'kimi-k2.8-preview' },
      { value: 'kimi-k2.7-code', label: 'kimi-k2.7-code' },
      { value: 'minimax-m3', label: 'minimax-m3' },
      { value: 'ark-code-latest', label: 'ark-code-latest（跟随控制台所选模型）' },
    ],
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { value: 'gpt-4.1', label: 'GPT-4.1（最新旗舰，推荐）' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini（性价比）' },
      { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano（最快）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { value: 'qwen-turbo', label: 'Qwen Turbo（快速便宜）' },
      { value: 'qwen-plus', label: 'Qwen Plus（均衡，推荐）' },
      { value: 'qwen-max', label: 'Qwen Max（最强）' },
      { value: 'qwen3.7-max', label: 'Qwen3.7 Max（最新版旗舰）' },
      { value: 'qwen3.7-plus', label: 'Qwen3.7 Plus（最新版均衡）' },
    ],
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { value: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek V4 Flash' },
      { value: 'deepseek-ai/DeepSeek-V4-Pro', label: 'DeepSeek V4 Pro' },
      { value: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5 397B（旗舰）' },
      { value: 'Qwen/Qwen3.6-27B', label: 'Qwen3.6 27B' },
      { value: 'zai-org/GLM-5.2', label: 'GLM-5.2（智谱）' },
      { value: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2' },
    ],
  },
  qianfan: {
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: [
      { value: 'ernie-4.5-turbo-32k', label: 'ERNIE 4.5 Turbo 32K（最便宜、推荐）' },
      { value: 'ernie-4.5-turbo-128k', label: 'ERNIE 4.5 Turbo 128K（长上下文）' },
      { value: 'ernie-3.5-128k', label: 'ERNIE 3.5 128K（便宜）' },
      { value: 'deepseek-v3.2', label: 'DeepSeek-V3.2（千帆平台）' },
    ],
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（免费档，推荐）' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash（免费档）' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro（强，费额度）' },
    ],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { value: 'deepseek/deepseek-chat-v3.2:free', label: 'DeepSeek V3.2（free）' },
      { value: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B（free）' },
      { value: 'meta-llama/llama-3.3-70b-versatile:free', label: 'Llama 3.3 70B（free）' },
      { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    ],
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B（免费快）' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B（最快）' },
      { value: 'qwen/qwen2.5-32b', label: 'Qwen2.5 32B' },
    ],
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { value: 'glm-4-flash', label: 'GLM-4-Flash（免费模型）' },
      { value: 'glm-4-air', label: 'GLM-4-Air（便宜）' },
      { value: 'glm-4-plus', label: 'GLM-4-Plus' },
    ],
  },
  custom: {
    baseUrl: '',
    models: [],
  },
};

/* 自定义模式下可快速选用的常用模型（选完即用，无需手敲），按“非推理/推理”两组展示 */
const QUICK_MODELS = {
  normal: [
    { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（DeepSeek 新）' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（免费）' },
    { value: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5 397B（硅基流动）' },
    { value: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5 7B（硅基流动 free）' },
    { value: 'glm-4-flash', label: 'GLM-4-Flash（智谱免费）' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini（OpenAI）' },
    { value: 'ernie-4.5-turbo-32k', label: 'ernie-4.5-turbo-32k（千帆最便宜）' },
  ],
  reasoning: [
    { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    { value: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek-V4-Flash（硅基流动）' },
    { value: 'quiet-star/glm-4.6', label: 'GLM-4.6' },
  ],
};

/* 知识库八分类（background 校验 AI 产出、诊断⑥编辑表单的分类下拉都用这一份） */
const KB_CATEGORIES = ['产品介绍', '玩法与机制', '数据·成本', '顾客痛点', '避坑经验', '个人经历', '使用技巧', '笔记架构'];

/**
 * 按需申请某个服务商域名的访问权（只有标了 needsHostGrant 的才要）。
 * 必须在用户点击的手势里、且在其他 await 之前调用，否则 chrome.permissions.request 会被拒。
 * 返回 false = 用户没给授权，此时配置照常保存，但调用该服务商会被浏览器跨域拦下。
 */
async function ensureProviderHostGranted(providerKey) {
  const pcfg = PROVIDER_CONFIG[providerKey];
  if (!pcfg || !pcfg.needsHostGrant) return true;
  let pattern = '';
  try { pattern = new URL(pcfg.baseUrl).origin + '/*'; } catch (_) { return true; }
  if (typeof chrome === 'undefined' || !chrome.permissions) return false;
  try {
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    return !!(await chrome.permissions.request({ origins: [pattern] }));
  } catch (e) {
    console.warn('[AI] 申请域名访问权失败：', pcfg.baseUrl, (e && e.message) || e);
    return false;
  }
}
