/**
 * settings.js — 设置页面逻辑
 */
'use strict';

// ── Tab 切换 ────────────────────────────────────────────────
document.querySelectorAll('.tab-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    const panel = document.getElementById('tab-' + item.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

// ── 工具函数 ────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function showMsg(elId, msg, type, duration = 3000) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'save-msg ' + type;
  if (duration > 0) setTimeout(() => { el.textContent = ''; }, duration);
}
function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatNum(n) {
  if (n === undefined || n === null) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return String(n);
}

// ── Storage 读写（直接操作 chrome.storage.local） ───────────
async function getStorage(key) {
  const r = await chrome.storage.local.get(key);
  return r[key];
}
async function setStorage(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ── 默认配置结构 ─────────────────────────────────────────────
const DEFAULT_CONFIG = {
  product: { name: '我的产品', guideText: '微信小程序', description: '', targetKeywords: [] },
  ai: { apiKey: '', apiBaseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', temperature: 0.8, maxTokens: 2000 },
  scriptStyle: {
    versionAStyle: '口语化，像朋友聊天，可以带点小八卦感；引用个人经历类知识库数据，讲自己当时的具体故事',
    versionBStyle: '用数据和逻辑说服人，给出完整分析思路——"你现在 XX 情况，按 YY 计算，每月能省/多花 ZZ 元，10 年下来差距是 WW 万"，必须有具体数字支撑；引用专业数据/政策类知识库数据',
    versionCStyle: '找这个话题里的搞笑点、反常识点，或者编一个和话题有点相关的奇怪/离谱小故事或类比，目的是让人看了想笑或者觉得"这是什么奇怪逻辑"而停下来看完；可以夸张、可以自嘲、可以用荒诞比喻，最后一句自然带出产品；禁止正经说教',
  },
  keywordFilter: { enabled: false, includeKeywords: [], excludeKeywords: [], minCommentLength: 5 },
  roleKeywords: {
    '中介': ['中介', '房产中介', '置业顾问', '经纪人', '卖房', '房源'],
    '装修博主': ['装修', '设计', '改造', '翻新', '家装', '软装', '硬装'],
    '房贷科普博主': ['房贷', '利率', 'LPR', '月供', '贷款', '公积金', '按揭', '首付'],
    '普通用户': ['买房', '购房', '看房', '上车', '刚需', '房奴'],
  },
};

function deepMerge(base, over) {
  const r = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] !== null && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      r[k] = deepMerge(base[k] || {}, over[k]);
    } else {
      r[k] = over[k];
    }
  }
  return r;
}

// ══════════════════════════════════════════════════════════════
// 基本配置
// ══════════════════════════════════════════════════════════════
let includeKeywords = [], excludeKeywords = [];

function renderTagContainer(containerId, keywords, onRemove) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = '';
  keywords.forEach((kw, i) => {
    const span = document.createElement('span');
    span.className = 'tag-item';
    span.innerHTML = `${esc(kw)} <span class="remove-tag" data-i="${i}">×</span>`;
    span.querySelector('.remove-tag').addEventListener('click', () => onRemove(i));
    c.appendChild(span);
  });
}

function initTagInput(inputId, containerId, keywords, onRemove) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !keywords.includes(val)) {
        keywords.push(val);
        renderTagContainer(containerId, keywords, onRemove);
      }
      input.value = '';
    }
  });
}

async function loadBasicConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  document.getElementById('productName').value = cfg.product.name || '';
  document.getElementById('productGuide').value = cfg.product.guideText || '';
  document.getElementById('productDescription').value = cfg.product.description || '';
  const fe = document.getElementById('filterEnabled');
  fe.checked = !!cfg.keywordFilter.enabled;
  document.getElementById('filterOptions').style.display = fe.checked ? 'block' : 'none';
  document.getElementById('filterStatusText').textContent = fe.checked ? '开启（按关键词过滤）' : '关闭（扫描所有评论）';
  document.getElementById('minCommentLength').value = cfg.keywordFilter.minCommentLength || 5;
  includeKeywords = [...(cfg.keywordFilter.includeKeywords || [])];
  excludeKeywords = [...(cfg.keywordFilter.excludeKeywords || [])];
  renderTagContainer('includeTagContainer', includeKeywords, i => {
    includeKeywords.splice(i, 1);
    renderTagContainer('includeTagContainer', includeKeywords, () => {});
  });
  renderTagContainer('excludeTagContainer', excludeKeywords, i => {
    excludeKeywords.splice(i, 1);
    renderTagContainer('excludeTagContainer', excludeKeywords, () => {});
  });
}

document.getElementById('filterEnabled')?.addEventListener('change', e => {
  document.getElementById('filterOptions').style.display = e.target.checked ? 'block' : 'none';
  document.getElementById('filterStatusText').textContent = e.target.checked ? '开启（按关键词过滤）' : '关闭（扫描所有评论）';
});

initTagInput('includeKeywordInput', 'includeTagContainer', includeKeywords, i => {
  includeKeywords.splice(i, 1);
  renderTagContainer('includeTagContainer', includeKeywords, () => {});
});
initTagInput('excludeKeywordInput', 'excludeTagContainer', excludeKeywords, i => {
  excludeKeywords.splice(i, 1);
  renderTagContainer('excludeTagContainer', excludeKeywords, () => {});
});

document.getElementById('saveBasicBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  cfg.product.name = document.getElementById('productName').value.trim();
  cfg.product.guideText = document.getElementById('productGuide').value.trim();
  cfg.product.description = document.getElementById('productDescription').value.trim();
  cfg.keywordFilter.enabled = document.getElementById('filterEnabled').checked;
  cfg.keywordFilter.includeKeywords = [...includeKeywords];
  cfg.keywordFilter.excludeKeywords = [...excludeKeywords];
  cfg.keywordFilter.minCommentLength = parseInt(document.getElementById('minCommentLength').value) || 5;
  await setStorage('config', cfg);
  showMsg('basicSaveMsg', '✅ 已保存', 'ok');
});

// ══════════════════════════════════════════════════════════════
// AI 配置
// ══════════════════════════════════════════════════════════════
const PROVIDER_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（快速，性价比高，推荐）' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（最强推理）' },
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
  custom: {
    baseUrl: '',
    models: [],
  },
};

function populateModelSelect(provider, selectedModel) {
  const sel = document.getElementById('apiModel');
  if (!sel) return;
  sel.innerHTML = '';
  const cfg = PROVIDER_CONFIG[provider];
  if (!cfg || provider === 'custom') {
    // 自定义模式下模型也手动输入
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（自定义模式下请手动输入模型名）';
    sel.appendChild(opt);
    return;
  }
  cfg.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    if (m.value === selectedModel) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onProviderChange() {
  const provider = document.getElementById('apiProvider').value;
  const customGroup = document.getElementById('customBaseUrlGroup');
  if (provider === 'custom') {
    customGroup.style.display = 'block';
    populateModelSelect('custom', '');
  } else {
    customGroup.style.display = 'none';
    const cfg = PROVIDER_CONFIG[provider];
    if (cfg) {
      document.getElementById('apiBaseUrlCustom').value = cfg.baseUrl;
      populateModelSelect(provider, cfg.models[0]?.value);
    }
  }
}

document.getElementById('apiProvider')?.addEventListener('change', onProviderChange);

async function loadAiConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  document.getElementById('apiKey').value = cfg.ai.apiKey || '';

  // 确定 provider
  const savedBaseUrl = cfg.ai.apiBaseUrl || 'https://api.deepseek.com/v1';
  const savedModel = cfg.ai.model || 'deepseek-v4-flash';
  let detectedProvider = 'custom';
  for (const [key, pCfg] of Object.entries(PROVIDER_CONFIG)) {
    if (key !== 'custom' && pCfg.baseUrl === savedBaseUrl) {
      detectedProvider = key;
      break;
    }
  }
  document.getElementById('apiProvider').value = detectedProvider;

  if (detectedProvider === 'custom') {
    document.getElementById('customBaseUrlGroup').style.display = 'block';
    document.getElementById('apiBaseUrlCustom').value = savedBaseUrl;
    // 自定义模式，模型直接填
    const sel = document.getElementById('apiModel');
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = savedModel;
    opt.textContent = savedModel || '（请输入模型名）';
    opt.selected = true;
    sel.appendChild(opt);
  } else {
    document.getElementById('customBaseUrlGroup').style.display = 'none';
    document.getElementById('apiBaseUrlCustom').value = PROVIDER_CONFIG[detectedProvider]?.baseUrl || savedBaseUrl;
    populateModelSelect(detectedProvider, savedModel);
  }

  document.getElementById('temperature').value = String(cfg.ai.temperature ?? 0.8);
  document.getElementById('maxTokens').value = String(cfg.ai.maxTokens || 2000);
}

document.getElementById('toggleApiKey')?.addEventListener('click', () => {
  const input = document.getElementById('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('saveAiBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  cfg.ai.apiKey = document.getElementById('apiKey').value.trim();
  const provider = document.getElementById('apiProvider').value;
  if (provider === 'custom') {
    cfg.ai.apiBaseUrl = document.getElementById('apiBaseUrlCustom').value.trim() || 'https://api.deepseek.com/v1';
  } else {
    cfg.ai.apiBaseUrl = PROVIDER_CONFIG[provider]?.baseUrl || 'https://api.deepseek.com/v1';
  }
  cfg.ai.model = document.getElementById('apiModel').value.trim() || 'deepseek-v4-flash';
  cfg.ai.temperature = parseFloat(document.getElementById('temperature').value) || 0.8;
  cfg.ai.maxTokens = parseInt(document.getElementById('maxTokens').value) || 2000;
  await setStorage('config', cfg);
  showMsg('aiSaveMsg', '✅ 已保存', 'ok');
});

document.getElementById('testAiBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('testAiBtn');
  const resultEl = document.getElementById('testResult');
  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.style.display = 'none';

  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  // 先用页面上当前选择的值（可能尚未保存）
  const provider = document.getElementById('apiProvider').value;
  let baseUrl;
  if (provider === 'custom') {
    baseUrl = document.getElementById('apiBaseUrlCustom').value.trim() || cfg.ai.apiBaseUrl;
  } else {
    baseUrl = PROVIDER_CONFIG[provider]?.baseUrl || cfg.ai.apiBaseUrl;
  }
  const aiConfig = {
    apiKey: document.getElementById('apiKey').value.trim() || cfg.ai.apiKey,
    apiBaseUrl: baseUrl,
    model: document.getElementById('apiModel').value.trim() || cfg.ai.model,
    temperature: 0, maxTokens: 50,
  };

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'testAiConnection', data: { aiConfig } });
    resultEl.style.display = 'block';
    if (resp?.ok) {
      resultEl.className = 'test-result ok';
      resultEl.textContent = resp.message || '连接成功';
    } else {
      resultEl.className = 'test-result err';
      resultEl.textContent = resp?.error || resp?.message || '连接失败';
    }
  } catch (e) {
    resultEl.style.display = 'block';
    resultEl.className = 'test-result err';
    resultEl.textContent = e.message;
  }

  btn.disabled = false;
  btn.textContent = '🔌 测试连接';
});

// ══════════════════════════════════════════════════════════════
// 话术风格
// ══════════════════════════════════════════════════════════════
async function loadStyleConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  // 加载话术版本风格配置
  document.getElementById('versionAStyle').value = cfg.scriptStyle.versionAStyle || '';
  document.getElementById('versionBStyle').value = cfg.scriptStyle.versionBStyle || '';
  document.getElementById('versionCStyle').value = cfg.scriptStyle.versionCStyle || '';
}

document.getElementById('saveStyleBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  // 保存话术版本风格配置
  cfg.scriptStyle.versionAStyle = document.getElementById('versionAStyle').value.trim();
  cfg.scriptStyle.versionBStyle = document.getElementById('versionBStyle').value.trim();
  cfg.scriptStyle.versionCStyle = document.getElementById('versionCStyle').value.trim();
  await setStorage('config', cfg);
  showMsg('styleSaveMsg', '✅ 已保存', 'ok');
});

// ══════════════════════════════════════════════════════════════
// 知识库
// ══════════════════════════════════════════════════════════════
let kbData = [], kbEditId = null;

async function loadKnowledgeBase() {
  kbData = (await getStorage('knowledge_base')) || [];
  renderKbList();
}

function renderKbList() {
  const list = document.getElementById('kbList');
  if (!list) return;
  const q = (document.getElementById('kbSearch')?.value || '').toLowerCase();
  const filtered = kbData.filter(e =>
    !q || (e.title || '').toLowerCase().includes(q) || (e.content || '').toLowerCase().includes(q)
  );
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-tip">暂无条目，点击"添加条目"开始</div>';
    return;
  }
  filtered.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'item-card' + (entry.isActive === false ? ' inactive' : '');
    const tags = Array.isArray(entry.tags) ? entry.tags.map(t => `<span class="item-tag">${esc(t)}</span>`).join('') : '';
    const roleBadge = entry.role ? `<span class="item-tag" style="background:#e8f4fd;color:#1a73e8;">${esc(entry.role)}</span>` : '';
    card.innerHTML = `
      <div class="item-info">
        <div class="item-title">${esc(entry.title || '（无标题）')}</div>
        <div class="item-meta">${roleBadge} ${esc(entry.category || '通用')} · ${formatDate(entry.createdAt)} ${tags}</div>
        <div class="item-content">${esc((entry.content || '').slice(0, 120))}${(entry.content || '').length > 120 ? '...' : ''}</div>
      </div>
      <div class="item-actions">
        <button class="btn-secondary btn-sm edit-kb-btn" data-id="${esc(entry.id)}">编辑</button>
        <button class="btn-danger del-kb-btn" data-id="${esc(entry.id)}">删除</button>
      </div>`;
    list.appendChild(card);
  });
  list.querySelectorAll('.edit-kb-btn').forEach(b => b.addEventListener('click', () => openKbModal(b.dataset.id)));
  list.querySelectorAll('.del-kb-btn').forEach(b => b.addEventListener('click', () => deleteKbEntry(b.dataset.id)));
}

function openKbModal(id) {
  kbEditId = id || null;
  const entry = id ? kbData.find(e => e.id === id) : null;
  document.getElementById('kbModalTitle').textContent = id ? '编辑条目' : '添加知识库条目';
  document.getElementById('kbTitle').value = entry?.title || '';
  document.getElementById('kbCategory').value = entry?.category || '';
  document.getElementById('kbContent').value = entry?.content || '';
  document.getElementById('kbTags').value = Array.isArray(entry?.tags) ? entry.tags.join(', ') : '';
  document.getElementById('kbRole').value = entry?.role || '';
  document.getElementById('kbIsActive').checked = entry ? (entry.isActive !== false) : true;
  document.getElementById('kbModal').style.display = 'flex';
}

function closeKbModal() { document.getElementById('kbModal').style.display = 'none'; }

async function saveKbEntry() {
  const title = document.getElementById('kbTitle').value.trim();
  const content = document.getElementById('kbContent').value.trim();
  if (!title || !content) { alert('标题和内容不能为空'); return; }
  const entry = {
    id: kbEditId || (Date.now().toString()),
    title,
    category: document.getElementById('kbCategory').value.trim() || '通用',
    content,
    tags: document.getElementById('kbTags').value.split(',').map(t => t.trim()).filter(Boolean),
    role: document.getElementById('kbRole').value.trim() || '',
    isActive: document.getElementById('kbIsActive').checked,
    createdAt: kbEditId ? (kbData.find(e => e.id === kbEditId)?.createdAt || Date.now()) : Date.now(),
  };
  if (kbEditId) {
    const idx = kbData.findIndex(e => e.id === kbEditId);
    if (idx >= 0) kbData[idx] = entry;
  } else {
    kbData.push(entry);
  }
  await setStorage('knowledge_base', kbData);
  closeKbModal();
  renderKbList();
}

async function deleteKbEntry(id) {
  if (!confirm('确认删除这条知识库条目？')) return;
  kbData = kbData.filter(e => e.id !== id);
  await setStorage('knowledge_base', kbData);
  renderKbList();
}

document.getElementById('addKbBtn')?.addEventListener('click', () => openKbModal(null));
document.getElementById('closeKbModal')?.addEventListener('click', closeKbModal);
document.getElementById('cancelKbModal')?.addEventListener('click', closeKbModal);
document.getElementById('saveKbEntry')?.addEventListener('click', saveKbEntry);
document.getElementById('kbSearch')?.addEventListener('input', renderKbList);
document.getElementById('exportKbBtn')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(kbData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `knowledge_base_${Date.now()}.json`;
  a.click();
});
document.getElementById('importKbBtn')?.addEventListener('click', () => document.getElementById('kbImportFile').click());
document.getElementById('kbImportFile')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) { alert('JSON 格式错误，应为数组'); return; }
    if (!confirm(`导入 ${data.length} 条数据（将覆盖现有知识库）？`)) return;
    kbData = data;
    await setStorage('knowledge_base', kbData);
    renderKbList();
    alert('导入成功');
  } catch { alert('文件解析失败，请检查 JSON 格式'); }
  e.target.value = '';
});

// ══════════════════════════════════════════════════════════════
// 提示词管理
// ══════════════════════════════════════════════════════════════
let promptsData = {}, currentPromptScene = null;

// 默认提示词（内嵌，避免依赖 importScripts）
const DEFAULT_PROMPTS_INLINE = {
  prospect_finder: { scene_name: '商机发现（评论区挖掘）' },
  comment_analysis: { scene_name: '评论区分析' },
  title_screening: { scene_name: '灌水标题筛选' },
};

async function loadPrompts() {
  promptsData = (await getStorage('prompts')) || {};
  renderPromptSceneList();
}

function renderPromptSceneList() {
  const list = document.getElementById('promptSceneList');
  if (!list) return;
  list.innerHTML = '';
  Object.entries(DEFAULT_PROMPTS_INLINE).forEach(([scene, info]) => {
    const item = document.createElement('div');
    item.className = 'prompt-scene-item' + (scene === currentPromptScene ? ' active' : '');
    item.textContent = info.scene_name;
    item.dataset.scene = scene;
    item.addEventListener('click', () => openPromptEditor(scene));
    list.appendChild(item);
  });
}

function openPromptEditor(scene) {
  currentPromptScene = scene;
  const prompt = promptsData[scene] || {};
  const editor = document.getElementById('promptEditor');
  if (!editor) return;

  document.querySelectorAll('.prompt-scene-item').forEach(el => {
    el.classList.toggle('active', el.dataset.scene === scene);
  });

  editor.innerHTML = `
    <div class="prompt-field" style="flex:0 0 auto;max-height:600px">
      <label>System Prompt（{product_name} {product_guide} {product_description} 等占位符会自动替换）</label>
      <textarea id="editSystemPrompt" style="height:500px">${esc(prompt.system_prompt || '')}</textarea>
    </div>
    <div class="prompt-field" style="flex:0 0 auto;max-height:600px">
      <label>User Prompt 模板（{note_title} {comments_text} {comment_content} 等占位符会自动替换）</label>
      <textarea id="editUserPrompt" style="height:500px">${esc(prompt.user_prompt_template || '')}</textarea>
    </div>
    <div class="prompt-actions">
      <button class="btn-primary" id="savePromptBtn">保存</button>
      <button class="btn-secondary" id="resetPromptBtn">恢复默认</button>
      <span id="promptSaveMsg" class="save-msg" style="margin-left:8px;align-self:center"></span>
    </div>`;

  document.getElementById('savePromptBtn')?.addEventListener('click', async () => {
    if (!promptsData[scene]) promptsData[scene] = {};
    promptsData[scene].system_prompt = document.getElementById('editSystemPrompt').value;
    promptsData[scene].user_prompt_template = document.getElementById('editUserPrompt').value;
    promptsData[scene].scene_name = DEFAULT_PROMPTS_INLINE[scene]?.scene_name || scene;
    await setStorage('prompts', promptsData);
    showMsg('promptSaveMsg', '✅ 已保存', 'ok');
  });

  document.getElementById('resetPromptBtn')?.addEventListener('click', async () => {
    if (!confirm(`确认恢复「${DEFAULT_PROMPTS_INLINE[scene]?.scene_name}」的默认提示词？`)) return;
    // 从 background 获取默认值（需要插件安装时已初始化）
    // 简化处理：直接清空用户自定义，让 background 使用 default-prompts.js 中的值
    delete promptsData[scene];
    await setStorage('prompts', promptsData);
    openPromptEditor(scene);
    showMsg('promptSaveMsg', '✅ 已恢复默认', 'ok');
  });
}

// ══════════════════════════════════════════════════════════════
// 日志统计
// ══════════════════════════════════════════════════════════════
async function loadLogs() {
  const logs = (await getStorage('ai_logs')) || [];
  const repliedMap = (await getStorage('replied_comments')) || {};

  // 统计
  const totalReplies = Object.values(repliedMap).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  const totalCalls = logs.length;
  const totalTokens = logs.reduce((s, l) => s + (l.tokensIn || 0) + (l.tokensOut || 0), 0);
  const successCount = logs.filter(l => l.success).length;
  const successRate = totalCalls > 0 ? Math.round(successCount / totalCalls * 100) + '%' : '-';

  document.getElementById('statTotalCalls').textContent = formatNum(totalCalls);
  document.getElementById('statTotalTokens').textContent = formatNum(totalTokens);
  document.getElementById('statTotalReplies').textContent = formatNum(totalReplies);
  document.getElementById('statSuccessRate').textContent = successRate;

  // 日志列表
  const logList = document.getElementById('logList');
  if (!logList) return;
  logList.innerHTML = '';
  if (logs.length === 0) {
    logList.innerHTML = '<div class="empty-tip">暂无日志</div>';
    return;
  }
  logs.slice(0, 100).forEach(log => {
    const item = document.createElement('div');
    item.className = 'log-item ' + (log.success ? 'ok' : 'err');
    item.innerHTML = `
      <div class="log-meta">${formatDate(log.timestamp)} · ${esc(log.scene || '-')}</div>
      <div class="log-content">
        Token: ${log.tokensIn || 0}in + ${log.tokensOut || 0}out
        ${log.noteTitle ? ` · 笔记: ${esc(String(log.noteTitle).slice(0, 20))}` : ''}
        ${log.prospectsFound !== undefined ? ` · 发现 ${log.prospectsFound} 个商机` : ''}
        ${!log.success && log.error ? ` · 错误: ${esc(String(log.error).slice(0, 60))}` : ''}
      </div>`;
    logList.appendChild(item);
  });
}

document.getElementById('clearLogsBtn')?.addEventListener('click', async () => {
  if (!confirm('确认清空所有 AI 调用日志？')) return;
  await setStorage('ai_logs', []);
  loadLogs();
});

// ══════════════════════════════════════════════════════════════
// 一键灌水设置
// ══════════════════════════════════════════════════════════════
let awKeywords = [];

const AW_DEFAULT = {
  keywords: [],
  licenseKeyHash: '',
  licensed: false,
  schedule: { minInterval: 180, maxInterval: 600, dailyMax: 20, activeHoursStart: 9, activeHoursEnd: 22 },
};

async function loadAutoWaterConfig() {
  const cfg = deepMerge(AW_DEFAULT, (await getStorage('auto_water_config')) || {});

  // 密钥状态
  const statusEl = document.getElementById('awLicenseStatus');
  if (statusEl) {
    statusEl.textContent = cfg.licensed ? '✅ 已激活' : '未激活';
    statusEl.style.color = cfg.licensed ? '#059669' : '#999';
  }

  // 关键词
  awKeywords = [...(cfg.keywords || [])];
  renderAwKeywords();

  // 调度
  document.getElementById('awMinInterval').value = cfg.schedule.minInterval || 180;
  document.getElementById('awMaxInterval').value = cfg.schedule.maxInterval || 600;
  document.getElementById('awDailyMax').value = cfg.schedule.dailyMax || 20;

  // 活跃时段下拉
  const startSel = document.getElementById('awActiveStart');
  const endSel = document.getElementById('awActiveEnd');
  if (startSel && startSel.options.length === 0) {
    for (let h = 0; h < 24; h++) {
      startSel.add(new Option(`${h}:00`, h));
      endSel.add(new Option(`${h}:00`, h));
    }
  }
  startSel.value = cfg.schedule.activeHoursStart ?? 9;
  endSel.value = cfg.schedule.activeHoursEnd ?? 22;

  // 历史
  await loadAutoWaterHistory();
}

function renderAwKeywords() {
  const container = document.getElementById('awKeywords');
  if (!container) return;
  // 移除旧 tag
  container.querySelectorAll('.tag').forEach(t => t.remove());
  const input = document.getElementById('awKeywordInput');
  awKeywords.forEach((kw, i) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.style.cssText = 'background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:12px;font-size:12px;display:inline-flex;align-items:center;gap:4px;';
    tag.innerHTML = `${esc(kw)} <span style="cursor:pointer;font-weight:bold;" data-idx="${i}">×</span>`;
    tag.querySelector('span').addEventListener('click', () => {
      awKeywords.splice(i, 1);
      renderAwKeywords();
    });
    container.insertBefore(tag, input);
  });
}

async function loadAutoWaterHistory() {
  const history = (await getStorage('auto_water_history')) || {};
  const entries = Object.entries(history).sort((a, b) => (b[1].wateredAt || 0) - (a[1].wateredAt || 0));
  const countEl = document.getElementById('awHistoryCount');
  const body = document.getElementById('awHistoryBody');
  if (countEl) countEl.textContent = `共 ${entries.length} 条记录`;
  if (body) {
    body.innerHTML = '';
    for (const [noteId, rec] of entries.slice(0, 100)) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #f0f0f0';
      const statusMap = { success: '✅ 成功', failed: '❌ 失败', no_prospect: '⚠️ 无商机' };
      const statusText = statusMap[rec.status] || rec.status || '-';
      const time = rec.wateredAt ? new Date(rec.wateredAt).toLocaleString() : '-';
      tr.innerHTML = `
        <td style="padding:5px 8px;" title="${esc(rec.url || '')}">${esc((rec.title || noteId).slice(0, 30))}</td>
        <td style="padding:5px 8px;">${statusText}</td>
        <td style="padding:5px 8px;">${time}</td>`;
      body.appendChild(tr);
    }
  }
}

// 关键词输入
document.getElementById('awKeywordInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = e.target.value.trim();
    if (val && !awKeywords.includes(val)) {
      awKeywords.push(val);
      renderAwKeywords();
    }
    e.target.value = '';
  }
});

// 激活密钥
document.getElementById('awActivateBtn')?.addEventListener('click', async () => {
  const key = document.getElementById('awLicenseKey').value.trim();
  if (!key) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'activateLicense', data: { key } });
    const statusEl = document.getElementById('awLicenseStatus');
    if (resp && resp.ok) {
      if (statusEl) { statusEl.textContent = '✅ 已激活'; statusEl.style.color = '#059669'; }
      document.getElementById('awLicenseKey').value = '';
    } else {
      if (statusEl) { statusEl.textContent = '❌ ' + (resp?.error || '激活失败'); statusEl.style.color = '#dc2626'; }
    }
  } catch (e) {
    document.getElementById('awLicenseStatus').textContent = '❌ ' + e.message;
  }
});

// 保存调度设置
document.getElementById('awSaveScheduleBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(AW_DEFAULT, (await getStorage('auto_water_config')) || {});
  cfg.keywords = [...awKeywords];
  cfg.schedule.minInterval = parseInt(document.getElementById('awMinInterval').value) || 180;
  cfg.schedule.maxInterval = parseInt(document.getElementById('awMaxInterval').value) || 600;
  cfg.schedule.dailyMax = parseInt(document.getElementById('awDailyMax').value) || 20;
  cfg.schedule.activeHoursStart = parseInt(document.getElementById('awActiveStart').value) || 9;
  cfg.schedule.activeHoursEnd = parseInt(document.getElementById('awActiveEnd').value) || 22;
  await setStorage('auto_water_config', cfg);
  alert('一键灌水设置已保存');
});

// 清空历史
document.getElementById('awClearHistoryBtn')?.addEventListener('click', async () => {
  if (!confirm('确认清空所有灌水历史？')) return;
  await setStorage('auto_water_history', {});
  loadAutoWaterHistory();
});

// ══════════════════════════════════════════════════════════════
// 初始化
// ══════════════════════════════════════════════════════════════
async function init() {
  await Promise.all([
    loadBasicConfig(),
    loadAiConfig(),
    loadStyleConfig(),
    loadKnowledgeBase(),
    loadPrompts(),
    loadLogs(),
    loadAutoWaterConfig(),
  ]);
}

init().catch(console.error);

// Tab 切换时刷新日志
document.querySelector('[data-tab="logs"]')?.addEventListener('click', loadLogs);
// Tab 切换时刷新灌水历史
document.querySelector('[data-tab="autowater"]')?.addEventListener('click', loadAutoWaterConfig);
