/**
 * settings.js — 设置页面逻辑
 */
'use strict';

// 本会话内是否已完成账号绑定验证（成功即置位，防止验证后仍判断为未验证）
let _accountVerifiedInSession = false;

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

// ── 侧栏分组折叠/展开（点分组标题折叠该组，状态存本地） ──
const GROUP_DEFAULT_EXPANDED = { accounts: true, ops: true, auto: false, data: false };
function collapseGroup(group, collapsed) {
  let el = group.nextElementSibling;
  while (el && !el.classList.contains('tab-group')) {
    if (el.classList.contains('tab-item')) el.style.display = collapsed ? 'none' : '';
    el = el.nextElementSibling;
  }
}
async function loadSidebarGroups() {
  const saved = {};
  try { const r = await chrome.storage.local.get('settings_tab_groups'); Object.assign(saved, (r && r.settings_tab_groups) || {}); } catch (_) {}
  document.querySelectorAll('.tab-group').forEach(group => {
    const key = group.getAttribute('data-group') || '';
    const expanded = (key in saved) ? saved[key] : (GROUP_DEFAULT_EXPANDED[key] !== false);
    group.classList.toggle('collapsed', !expanded);
    collapseGroup(group, !expanded);
  });
}
document.querySelectorAll('.tab-group').forEach(group => {
  group.addEventListener('click', async () => {
    const collapsed = group.classList.toggle('collapsed');
    collapseGroup(group, collapsed);
    const key = group.getAttribute('data-group') || '';
    if (!key) return;
    try {
      const r = await chrome.storage.local.get('settings_tab_groups');
      const saved = (r && r.settings_tab_groups) || {};
      saved[key] = !collapsed;
      await chrome.storage.local.set({ settings_tab_groups: saved });
    } catch (_) {}
  });
});
loadSidebarGroups();

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
  product: { name: '我的产品', promoGoal: '', guideText: '', description: '', targetKeywords: [], sellPoints: [], username: '', cta: '私信"玄铁剑"领试用版', coverHook: '', coverTemplate: null },
  myAccountNames: [],
  ai: { apiKey: '', apiBaseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-turbo-32k', temperature: 0.8, maxTokens: 4096, fallbackApiKey: '', fallbackApiBaseUrl: '', fallbackModel: '' },
  scriptStyle: {
    scriptPurpose: 'sell',
    purposeMinChars: 100, purposeMaxChars: 300,
    toneMannerisms: '',
    personaSample: '',
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
// 基本配置（产品配置 / 封面设置）
// ══════════════════════════════════════════════════════════════

async function loadProductConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  document.getElementById('productName').value = cfg.product.name || '';
  // 推广目标（已合并原「引导方式」）：回显已存目标；旧数据无目标但填过引导去向的，按工具引流处理
  initStyleTemplates();
  const goal = cfg.product.promoGoal || (cfg.product.guideText ? 'tool' : '');
  document.getElementById('styleTemplateSelect').value = goal;
  document.getElementById('productGuide').value = cfg.product.guideText || '';
  updatePromoGoalUI(goal);
  document.getElementById('myAccountNames').value = (cfg.myAccountNames || []).join('\n');
  renderSellPointList(cfg.product.sellPoints || [], _productLibLocked);
}

async function loadCoverConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  document.getElementById('productUsername').value = cfg.product.username || '';
  document.getElementById('productCta').value = cfg.product.cta || '';
  document.getElementById('coverHookInput').value = cfg.product.coverHook || '';
  renderCoverPreview(cfg.product.coverTemplate);
  bindCoverTemplate();
}

document.getElementById('saveProductBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  // ★ 产品名必填：话术、知识库引用都要用到产品名，为空会生成为"我的产品"，这里强提醒并拦截
  const _name = document.getElementById('productName').value.trim();
  if (!_name) {
    showMsg('productSaveMsg', '⚠️ 请先填写产品名称——话术会带上产品名，留空会生成"我的产品"', 'err', 4000);
    document.getElementById('productName')?.focus();
    return;
  }
  cfg.product.name = _name;
  // 引导去向已并入「推广目标」：仅工具引流模式下输入框可见，此时才随基本配置一起保存
  if (document.getElementById('guideRow').style.display !== 'none') {
    cfg.product.guideText = document.getElementById('productGuide').value.trim();
  }
  // 产品卖点：收集 1~10 个（标题/内容/配图），并反向聚合出 description 供提示词/{product_description} 使用
  const sellPoints = collectSellPoints();
  if (!_productLibLocked) {
    cfg.product.sellPoints = sellPoints.slice(0, 10);
    const descLines = [];
    cfg.product.sellPoints.forEach((s, i) => {
      const t = (s.title || '').trim(), c = (s.content || '').trim();
      if (t && c) descLines.push(t + '：' + c);
      else if (t) descLines.push(t);
      else if (c) descLines.push(c);
    });
    cfg.product.description = descLines.join('\n');
  }
  cfg.myAccountNames = document.getElementById('myAccountNames').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  await setStorage('config', cfg);
  showMsg('productSaveMsg', '✅ 已保存', 'ok');
});

document.getElementById('saveCoverBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  cfg.product.username = document.getElementById('productUsername').value.trim();
  cfg.product.cta = document.getElementById('productCta').value.trim() || '私信"玄铁剑"领试用版';
  cfg.product.coverHook = document.getElementById('coverHookInput').value.trim();
  cfg.product.coverTemplate = _currentCoverTemplate;
  await setStorage('config', cfg);
  showMsg('coverSaveMsg', '✅ 已保存', 'ok');
});

// ══════════════════════════════════════════════════════════════
// 产品卖点维护（1~10 个，每个含 标题/内容/配图）
// ══════════════════════════════════════════════════════════════
let _productLibLocked = false;

function renderSellPointList(sellPoints, locked) {
  const listEl = document.getElementById('sellPointList');
  if (!listEl) return;
  const list = Array.isArray(sellPoints) ? sellPoints.slice(0, 10) : [];
  if (locked) {
    listEl.style.opacity = '0.55';
    listEl.style.pointerEvents = 'none';
  }
  listEl.innerHTML = list.length ? list.map((s, i) => sellPointCardHtml(s, i, locked)).join('')
    : '<div style="font-size:12px;color:#999;border:1px dashed #d7d9de;border-radius:8px;padding:10px 12px;">还没有卖点。点下方「＋ 添加卖点」，每个卖点填 标题 + 内容，有需要可配一张图。</div>';
  wireSellPointListEvents(list.length);
}

function sellPointCardHtml(s, i, locked) {
  const t = esc((s && s.title) || '');
  const c = esc((s && s.content) || '');
  const img = (s && s.image) || '';
  return '<div class="sp-card" data-idx="' + i + '" style="border:1px solid #e3e7f0;border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fbfcfe;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;">' +
    '<span style="font-size:12px;font-weight:700;color:#c41d3c;">卖点 ' + (i + 1) + '/10</span>' +
    '<button type="button" class="sp-remove" data-idx="' + i + '" ' + (locked ? 'disabled style="opacity:.4"' : '') + ' style="border:1px solid #f2c2cd;border-radius:6px;background:#fff;color:#c41d3c;font-size:11px;cursor:pointer;padding:2px 8px;">🗑 删除</button></div>' +
    '<div style="display:flex;gap:8px;align-items:flex-start;">' +
    '<div style="flex:1;min-width:0;">' +
    '<input type="text" class="sp-title" data-idx="' + i + '" value="' + t + '" maxlength="40" placeholder="卖点标题（喂给评论/文案提示词）"' + (locked ? ' disabled' : '') + ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;margin-bottom:6px;">' +
    '<textarea class="sp-content" data-idx="' + i + '" rows="2" placeholder="卖点内容（喂给评论/文案提示词，越具体越好）"' + (locked ? ' disabled' : '') + ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;line-height:1.5;resize:vertical;">' + c + '</textarea>' +
    '<div style="font-size:10px;color:#999;margin-top:2px;">提示词中可用 {product_description} 引用全部卖点；发笔记选中此卖点时，会列出下方配图</div>' +
    '</div>' +
    '<div class="sp-img" data-idx="' + i + '" style="flex:none;width:104px;">' +
    (img
      ? '<img src="' + img + '" data-idx="' + i + '" style="width:104px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #eee;display:block;cursor:pointer;" title="点击更换" class="sp-img-pick">' +
        '<button type="button" class="sp-img-clear" data-idx="' + i + '" ' + (locked ? 'disabled style="opacity:.4"' : '') + ' style="width:100%;margin-top:4px;font-size:10px;padding:1px 0;border:1px solid #e3bbb;border-radius:5px;background:#fff;color:#a00;cursor:pointer;">清除</button>'
      : '<label class="sp-img-add" data-idx="' + i + '" style="display:flex;align-items:center;justify-content:center;width:104px;height:72px;border:1px dashed #bbb;border-radius:6px;font-size:10px;color:#999;cursor:pointer;background:#fff;">＋ 配图<input type="file" accept="image/*" class="sp-file" data-idx="' + i + '" style="display:none;"' + (locked ? ' disabled' : '') + '></label>') +
    '</div></div></div>';
}

function wireSellPointListEvents(count) {
  const listEl = document.getElementById('sellPointList');
  if (!listEl) return;

  const btn = document.getElementById('addSellPointBtn');
  if (btn) btn.onclick = () => {
    if (_productLibLocked) { showMsg('productSaveMsg', '🔒 产品卖点为企业版功能，当前版本不可用', 'err'); return; }
    const childCount = listEl.querySelectorAll('.sp-card').length;
    if (childCount >= 10) { showMsg('productSaveMsg', '⚠️ 最多添加 10 个卖点', 'err'); return; }
    listEl.insertAdjacentHTML('beforeend', sellPointCardHtml({}, childCount, _productLibLocked));
    wireSellPointListEvents(childCount + 1);
  };

  listEl.querySelectorAll('.sp-remove').forEach(b => b.onclick = () => {
    if (_productLibLocked) return;
    const card = b.closest('.sp-card');
    if (card) card.remove();
  });

  listEl.querySelectorAll('.sp-img-clear').forEach(b => b.onclick = () => {
    if (_productLibLocked) return;
    const card = b.closest('.sp-card');
    const col = card ? card.querySelector('.sp-img') : null;
    if (!col) return;
    const idx = card.getAttribute('data-idx');
    col.innerHTML = '<label style="display:flex;align-items:center;justify-content:center;width:104px;height:72px;border:1px dashed #bbb;border-radius:6px;font-size:10px;color:#999;cursor:pointer;background:#fff;">＋ 配图\n<input type="file" accept="image/*" class="sp-file" data-idx="' + idx + '" style="display:none;"></label>';
    wireSellPointListEvents(count);
  });

  listEl.querySelectorAll('.sp-file').forEach(inp => inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const card = inp.closest('.sp-card');
    const col = card ? card.querySelector('.sp-img') : null;
    if (!col) return;
    const idx = card.getAttribute('data-idx');
    const reader = new FileReader();
    reader.onload = (ev) => {
      col.innerHTML = '<img src="' + ev.target.result + '" data-idx="' + idx + '" style="width:104px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #eee;display:block;cursor:pointer;" title="点击更换">' +
        '<button type="button" class="sp-img-clear" data-idx="' + idx + '" style="width:100%;margin-top:4px;font-size:10px;padding:1px 0;border:1px solid #e3bbb;border-radius:5px;background:#fff;color:#a00;cursor:pointer;">清除</button>';
      wireSellPointListEvents(count);
    };
    reader.readAsDataURL(file);
  });
}

function collectSellPoints() {
  const listEl = document.getElementById('sellPointList');
  const out = [];
  if (!listEl) return out;
  listEl.querySelectorAll('.sp-card').forEach((card) => {
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    if (Number.isNaN(idx)) idx = out.length;
    while (out.length < idx) out.push({});
    const title = (card.querySelector('.sp-title') ? card.querySelector('.sp-title').value : '').trim();
    const content = (card.querySelector('.sp-content') ? card.querySelector('.sp-content').value : '').trim();
    let image = '';
    const img = card.querySelector('.sp-img img');
    if (img) image = img.getAttribute('src') || '';
    out[idx] = { title, content, image };
  });
  return out.filter(s => s && (String(s.title).trim() || String(s.content).trim() || String(s.image || '')));
}

// ══════════════════════════════════════════════════════════════
// 封面底图模板管理（AI 生成候选 / 上传导入 / 预览 / 清除；三段式：上署名·中留白·下引流）
// ══════════════════════════════════════════════════════════════
let _coverBound = false;
let _currentCoverTemplate = null;

function renderCoverPreview(tpl) {
  _currentCoverTemplate = (tpl && tpl.image) ? tpl : null;
  const wrap = document.getElementById('coverPreview');
  if (!wrap) return;
  const clearBtn = document.getElementById('coverClearBtn');
  if (clearBtn) clearBtn.style.display = _currentCoverTemplate ? '' : 'none';
  if (_currentCoverTemplate) {
    wrap.innerHTML = '<div style="font-size:12px;font-weight:600;color:#1f6feb;margin-bottom:4px;">当前底图模板：</div>' +
      '<img src="' + _currentCoverTemplate.image + '" style="max-width:150px;border-radius:8px;border:1px solid #dfe8f5;display:block;">';
  } else {
    wrap.innerHTML = '<div style="font-size:12px;color:#999;">（还没有底图模板，封面会用渐变+文字兜底生成）</div>';
  }
}

function bindCoverTemplate() {
  if (_coverBound) return; _coverBound = true;
  const genBtn = document.getElementById('coverGenBtn');
  if (genBtn) genBtn.addEventListener('click', async () => {
    const box = document.getElementById('coverCandidates');
    if (box) box.innerHTML = '<div style="font-size:12px;color:#888;">⏳ AI 正在按用户名+人设生成封面底图候选…</div>';
    try {
      const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
      const persona = cfg.persona || {};
      const coverHook = cfg.product.coverHook || persona.coverHook || '';
      const r = await chrome.runtime.sendMessage({ action: 'genCoverTemplate', data: { username: cfg.product.username || '', productName: cfg.product.name || '', persona: (persona.text || ''), coverHook } });
      const cands = (r && r.candidates) || [];
      if (!cands.length) throw new Error((r && r.reason) || 'AI 未返回候选');
      box.innerHTML = '<div style="font-size:12px;font-weight:600;color:#1f6feb;margin-bottom:4px;">请选一个风格候选（可「一键生图」或「复制提示词」去外部出图）：</div>' +
        cands.map((c, i) =>
          '<div style="border:1px solid #dfe8f5;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#fff;">' +
          '<div style="font-size:12px;font-weight:600;color:#333;">候选 ' + (i + 1) + '：' + esc(c.name || '') + '</div>' +
          '<pre style="font-size:11px;color:#555;background:#f7f8fb;border-radius:6px;padding:6px 8px;white-space:pre-wrap;word-break:break-all;margin:4px 0;max-height:90px;overflow:auto;font-family:monospace;line-height:1.5;">' + esc(c.prompt || '') + '</pre>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
          '<button type="button" class="cover-gen-one" data-prompt="' + String(c.prompt || '').replace(/"/g, '&quot;') + '" data-name="' + esc(c.name || '') + '" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 10px;">🖼 一键生底图</button>' +
          '<button type="button" class="cover-copy-one" data-prompt="' + String(c.prompt || '').replace(/"/g, '&quot;') + '" style="padding:2px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#666;font-size:11px;cursor:pointer;">📋 复制提示词</button>' +
          '<span class="cover-gen-msg" style="font-size:11px;color:#0a7b5a;"></span>' +
          '</div></div>').join('');
      box.querySelectorAll('.cover-copy-one').forEach(b => b.onclick = () => { const v = b.getAttribute('data-prompt') || ''; if (v) copyText(v).then(() => showMsg('coverSaveMsg', '✅ 提示词已复制，可去千问/生图工具出图', 'ok')); });
      box.querySelectorAll('.cover-gen-one').forEach(b => b.onclick = async () => {
        const msg = b.parentNode.querySelector('.cover-gen-msg');
        if (msg) msg.textContent = '⏳ 生成中…(约10~30秒)';
        try {
          const rr = await chrome.runtime.sendMessage({ action: 'generateNoteImage', prompt: b.getAttribute('data-prompt') || '' });
          const img = (rr && rr.image) || '';
          if (!img) throw new Error('未返回图片');
          _currentCoverTemplate = { image: img, w: 0, h: 0, preview: '', topBand: 0.14, bottomBand: 0.18 };
          renderCoverPreview(_currentCoverTemplate);
          if (msg) { msg.textContent = '✅ 已设为底图模板（记得点「保存基本配置」）'; }
        } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
      });
    } catch (e) {
      if (box) box.innerHTML = '<div style="font-size:12px;color:#d32f2f;">生成候选失败：' + (e.message || e) + '</div>';
    }
  });

  const upBtn = document.getElementById('coverUpBtn');
  const fileInput = document.getElementById('coverFileInput');
  if (upBtn) upBtn.addEventListener('click', () => { if (fileInput) fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      _currentCoverTemplate = { image: ev.target.result, w: 0, h: 0, preview: '', topBand: 0.14, bottomBand: 0.18 };
      renderCoverPreview(_currentCoverTemplate);
      showMsg('coverSaveMsg', '✅ 已设为底图模板（记得点「保存封面设置」）', 'ok', 3000);
    };
    reader.readAsDataURL(file);
  });

  const clearBtn = document.getElementById('coverClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => { _currentCoverTemplate = null; renderCoverPreview(null); showMsg('coverSaveMsg', '已清除底图模板', 'ok', 2000); });
}

// 简单复制工具（settings 页无 navigator.clipboard 权限保障时降级）
function copyText(t) {
  return navigator.clipboard ? navigator.clipboard.writeText(t).catch(() => {}) : Promise.resolve();
}

// ══════════════════════════════════════════════════════════════
// AI 配置
// ══════════════════════════════════════════════════════════════
const PROVIDER_CONFIG = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-chat', label: 'Chat 模型（非推理，快、省，推荐）' },
      { value: 'deepseek-v4-flash', label: '推理模型（思考深、慢、费 token）' },
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
  custom: {
    baseUrl: '',
    models: [],
  },
};

/* 自定义模式下可快速选用的常用模型（选完即用，无需手敲），按“非推理/推理”两组展示 */
const QUICK_MODELS = {
  normal: [
    { value: 'deepseek-chat', label: 'deepseek-chat（DeepSeek 官方）' },
    { value: 'deepseek-v3', label: 'deepseek-v3' },
    { value: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek-V3.2（硅基流动）' },
    { value: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5 397B（硅基流动）' },
    { value: 'ernie-4.5-turbo-32k', label: 'ernie-4.5-turbo-32k（千帆最便宜）' },
    { value: 'ernie-3.5-128k', label: 'ernie-3.5-128k（千帆便宜）' },
  ],
  reasoning: [
    { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    { value: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek-V4-Flash（硅基流动）' },
  ],
};

function populateModelSelect(provider, selectedModel, selId) {
  const sel = document.getElementById(selId || 'apiModel');
  if (!sel) return;
  sel.innerHTML = '';
  const cfg = PROVIDER_CONFIG[provider];
  if (!cfg || provider === 'custom') {
    // 自定义模式：当前模型 + 非推理/推理两组推荐（中转站也能直接选，不用手敲）
    populateCustomModelSelect(selectedModel || '', selId || 'apiModel');
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

/* 自定义模式下拉：当前模型置顶选中 + 非推理/推理两组推荐 */
function populateCustomModelSelect(currentModel, selId) {
  const sel = document.getElementById(selId || 'apiModel');
  if (!sel) return;
  sel.innerHTML = '';
  const cur = document.createElement('option');
  cur.value = currentModel || '';
  cur.textContent = currentModel ? `当前：${currentModel}` : '（请选择下方模型，或手动输入模型名）';
  cur.selected = true;
  sel.appendChild(cur);
  const used = new Set([currentModel]);
  [
    { label: '非推理模型（快、省，推荐）', list: QUICK_MODELS.normal },
    { label: '推理模型（思考深、慢、费 token）', list: QUICK_MODELS.reasoning },
  ].forEach(g => {
    const items = g.list.filter(m => !used.has(m.value));
    if (items.length === 0) return;
    const grp = document.createElement('optgroup');
    grp.label = g.label;
    items.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
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

/* 多模态模型：提供商切换时同步 Base URL + 模型下拉 */
document.getElementById('fallbackApiProvider')?.addEventListener('change', () => {
  const provider = document.getElementById('fallbackApiProvider').value;
  const customGroup = document.getElementById('fallbackCustomBaseUrlGroup');
  if (provider === 'custom') {
    customGroup.style.display = 'block';
    populateModelSelect('custom', '', 'fallbackApiModel');
  } else {
    customGroup.style.display = 'none';
    const cfg = PROVIDER_CONFIG[provider];
    if (cfg) {
      document.getElementById('fallbackApiBaseUrlCustom').value = cfg.baseUrl;
      populateModelSelect(provider, cfg.models[0]?.value, 'fallbackApiModel');
    }
  }
});

/* 根据 Base URL 反推提供商（与主模型逻辑一致） */
function detectProviderByBaseUrl(baseUrl) {
  for (const [key, pCfg] of Object.entries(PROVIDER_CONFIG)) {
    if (key !== 'custom' && pCfg.baseUrl === baseUrl) return key;
  }
  return 'custom';
}

async function loadAiConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  document.getElementById('apiKey').value = cfg.ai.apiKey || '';

  // 确定 provider
  const savedBaseUrl = cfg.ai.apiBaseUrl || 'https://api.deepseek.com/v1';
  const savedModel = cfg.ai.model || 'deepseek-chat';
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
    // 自定义模式：当前模型置顶 + 常用模型快捷选择
    populateCustomModelSelect(savedModel);
  } else {
    document.getElementById('customBaseUrlGroup').style.display = 'none';
    document.getElementById('apiBaseUrlCustom').value = PROVIDER_CONFIG[detectedProvider]?.baseUrl || savedBaseUrl;
    populateModelSelect(detectedProvider, savedModel);
  }

  document.getElementById('temperature').value = String(cfg.ai.temperature ?? 0.8);
  document.getElementById('maxTokens').value = String(cfg.ai.maxTokens || 2000);

  // 多模态模型
  document.getElementById('fallbackApiKey').value = cfg.ai.fallbackApiKey || '';
  const fbBase = cfg.ai.fallbackApiBaseUrl || '';
  const fbModel = cfg.ai.fallbackModel || '';
  const fbProvider = detectProviderByBaseUrl(fbBase);
  document.getElementById('fallbackApiProvider').value = fbProvider;
  if (fbProvider === 'custom') {
    document.getElementById('fallbackCustomBaseUrlGroup').style.display = 'block';
    document.getElementById('fallbackApiBaseUrlCustom').value = fbBase;
    populateCustomModelSelect(fbModel, 'fallbackApiModel');
  } else {
    document.getElementById('fallbackCustomBaseUrlGroup').style.display = 'none';
    document.getElementById('fallbackApiBaseUrlCustom').value = PROVIDER_CONFIG[fbProvider]?.baseUrl || fbBase;
    populateModelSelect(fbProvider, fbModel, 'fallbackApiModel');
  }
}

document.getElementById('toggleApiKey')?.addEventListener('click', () => {
  const input = document.getElementById('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('toggleFallbackApiKey')?.addEventListener('click', () => {
  const input = document.getElementById('fallbackApiKey');
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
  cfg.ai.model = document.getElementById('apiModel').value.trim() || 'deepseek-chat';
  // ★ 用户显式保存过模型：自动迁移不再覆盖（尊重手动选择），也不再自动回退旧模型
  cfg.ai._modelLocked = true;
  delete cfg.ai._prevModel;
  cfg.ai.temperature = parseFloat(document.getElementById('temperature').value) || 0.8;
  cfg.ai.maxTokens = parseInt(document.getElementById('maxTokens').value) || 2000;
  // 多模态模型
  cfg.ai.fallbackApiKey = document.getElementById('fallbackApiKey').value.trim() || '';
  const fbProvider = document.getElementById('fallbackApiProvider').value;
  if (fbProvider === 'custom') {
    cfg.ai.fallbackApiBaseUrl = document.getElementById('fallbackApiBaseUrlCustom').value.trim() || '';
  } else {
    cfg.ai.fallbackApiBaseUrl = PROVIDER_CONFIG[fbProvider]?.baseUrl || '';
  }
  cfg.ai.fallbackModel = document.getElementById('fallbackApiModel').value.trim() || '';
  // 备用 key/model 三选一：key 有但缺 base 或 model 时清空，避免半配置
  if (cfg.ai.fallbackApiKey && (!cfg.ai.fallbackApiBaseUrl || !cfg.ai.fallbackModel)) {
    cfg.ai.fallbackApiKey = cfg.ai.fallbackApiBaseUrl = cfg.ai.fallbackModel = '';
  }
  await setStorage('config', cfg);
  showMsg('aiSaveMsg', '✅ 已保存' + (cfg.ai.fallbackApiKey ? '（含多模态模型）' : ''), 'ok');
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
  const primary = {
    apiKey: document.getElementById('apiKey').value.trim() || cfg.ai.apiKey,
    apiBaseUrl: baseUrl,
    model: document.getElementById('apiModel').value.trim() || cfg.ai.model,
    temperature: 0, maxTokens: 512,
  };

  // 多模态模型（若已填）
  const fbKey = document.getElementById('fallbackApiKey').value.trim() || cfg.ai.fallbackApiKey;
  let fallback = null;
  if (fbKey) {
    const fbProvider = document.getElementById('fallbackApiProvider').value;
    let fbBase;
    if (fbProvider === 'custom') {
      fbBase = document.getElementById('fallbackApiBaseUrlCustom').value.trim() || cfg.ai.fallbackApiBaseUrl;
    } else {
      fbBase = PROVIDER_CONFIG[fbProvider]?.baseUrl || cfg.ai.fallbackApiBaseUrl;
    }
    const fbModel = document.getElementById('fallbackApiModel').value.trim() || cfg.ai.fallbackModel;
    if (fbBase && fbModel) {
      fallback = { apiKey: fbKey, apiBaseUrl: fbBase, model: fbModel, temperature: 0, maxTokens: 512 };
    }
  }

  const tryOne = async (label, aiConfig) => {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'testAiConnection', data: { aiConfig } });
      if (resp?.ok) return `✅ ${label}：${resp.message || '连接成功'}`;
      return `❌ ${label}：${resp?.error || resp?.message || '连接失败'}`;
    } catch (e) {
      return `❌ ${label}：${e.message}`;
    }
  };

  const lines = [await tryOne('Chat 模型', primary)];
  if (fallback) lines.push(await tryOne('多模态模型', fallback));

  resultEl.style.display = 'block';
  resultEl.className = 'test-result ' + (lines.some(l => l.includes('✅')) ? 'ok' : 'err');
  resultEl.innerHTML = lines.join('<br>');

  btn.disabled = false;
  btn.textContent = '🔌 测试连接';
});

// ══════════════════════════════════════════════════════════════
// 话术风格
// ══════════════════════════════════════════════════════════════
async function loadStyleConfig() {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  const ss = cfg.scriptStyle || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  // 字数控制（评论目的版：单范围；兼容旧统一 minChars/maxChars）
  setVal('purposeMinChars', ss.purposeMinChars ?? ss.minChars ?? (ss.aMinChars ?? 100));
  setVal('purposeMaxChars', ss.purposeMaxChars ?? ss.maxChars ?? (ss.aMaxChars ?? 300));
  // 评论目的
  setVal('scriptPurposeSelect', ss.scriptPurpose || 'sell');
  // 反AI味：口癖池 + 口吻样本
  setVal('toneMannerisms', ss.toneMannerisms || '');
  setVal('personaSample', ss.personaSample || '');
  initStyleTemplates();
}

// ══════════════ 账号人设管理器（显示 / AI建人设 / 保存 / 重置） ══════════════
const PERSONA_QUESTIONS = [
  '你是谁？介绍一下你的身份、职业，或现在正在做的事。',
  '在这个领域/产品上你有过哪些真实的经历？做了多久、帮过多少人、或亲自踩过哪些坑。',
  '你最拿手、最想让别人知道的干货或专业积累是什么？',
  '你的小红书账号定位是什么？主要分享什么、写给谁看？',
  '你希望评论区互动时的"人设感"是哪种（专业靠谱 / 接地气过来人 / 随性朋友…）？有没有特别的口吻或语气？',
];
let _personaBound = false;
async function personaSay(method, data) {
  return await chrome.runtime.sendMessage({ action: method, data: data || {} });
}
function personaSetStatus(html, cls) {
  const el = document.getElementById('personaStatus'); if (!el) return;
  el.innerHTML = html || ''; el.style.color = (cls === 'err' ? '#c62828' : cls === 'ok' ? '#0a7b5a' : '#666');
}
function personaRenderStatus(p) {
  const st = document.getElementById('personaStatus'); if (!st) return;
  if (p && p.text) {
    const t = p.updatedAt ? new Date(p.updatedAt).toLocaleString('zh-CN') : '';
    st.innerHTML = '<b>✅ 已保存人设</b>' + (t ? '（' + t + '）' : '') + '<br><span style="white-space:pre-wrap;">' + String(p.text).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>';
    st.style.color = '#0a7b5a';
  } else {
    st.innerHTML = '⚠️ 还没有人设。点下方"用 AI 建人设"生成，或自己写一份保存。';
    st.style.color = '#b8730a';
  }
}
function _esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function personaRenderQuestions(qa) {
  const wrap = document.getElementById('personaQuestions'); if (!wrap) return;
  wrap.innerHTML = '';
  PERSONA_QUESTIONS.forEach((q, i) => {
    const val = (qa && qa['q' + (i + 1)]) ? String(qa['q' + (i + 1)]) : '';
    const row = document.createElement('div'); row.style.marginBottom = '8px';
    row.innerHTML = '<div style="font-size:12px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + _esc(q) + '</div>' +
      '<textarea class="personaQ" data-k="q' + (i + 1) + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="你的回答…">' + _esc(val) + '</textarea>';
    wrap.appendChild(row);
  });
}
async function loadPersonaManager() {
  try {
    const r = await personaSay('getPersona');
    const p = (r && r.persona) || null;
    personaRenderStatus(p);
    personaRenderQuestions(p && p.qa ? p.qa : null);
    if (p && p.bio) { const b = document.getElementById('personaBio'); if (b && !b.value) b.value = p.bio; }
    if (p && p.text) { const m = document.getElementById('personaManual'); if (m && !m.value) m.value = p.text; }
  } catch (_) {}
  personaBind();
}
function personaBind() {
  if (_personaBound) return; _personaBound = true;
  const readBtn = document.getElementById('personaReadBioBtn');
  if (readBtn) readBtn.addEventListener('click', async () => {
    readBtn.disabled = true; readBtn.textContent = '…读取中';
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      let desc = '', name = '';
      if (tab && tab.id && /xiaohongshu\.com/.test(tab.url || '')) {
        try { const r = await chrome.tabs.sendMessage(tab.id, { action: 'getProfileDesc' }); if (r && r.desc) { desc = r.desc; name = r.name || ''; } }
        catch (_) {
          try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); await new Promise(r => setTimeout(r, 300)); } catch (_) {}
          try { const r = await chrome.tabs.sendMessage(tab.id, { action: 'getProfileDesc' }); if (r && r.desc) { desc = r.desc; name = r.name || ''; } } catch (_) {}
        }
      }
      if (desc) {
        const b = document.getElementById('personaBio'); if (b) b.value = desc;
        const n = document.getElementById('personaSelectAllPaste');
        personaSetStatus((name ? '读到账号：' + _esc(name) + '；' : '') + '✅ 已读取简介，可以继续答题或直接建人设。', 'ok');
      } else {
        personaSetStatus('⚠️ 没抓到简介。请先打开【你自己小红书的主页】（能显示简介的那页）再点一次；或直接粘贴到下面输入框。', 'err');
      }
    } finally { readBtn.disabled = false; readBtn.textContent = '🧲 读取我当前打开的本主页简介'; }
  });

  const buildBtn = document.getElementById('personaBuildBtn');
  if (buildBtn) buildBtn.addEventListener('click', async () => {
    buildBtn.disabled = true; buildBtn.textContent = '⏳ AI 整合中…';
    const bio = (document.getElementById('personaBio') || {}).value ? document.getElementById('personaBio').value.trim() : '';
    const answers = Array.from(document.querySelectorAll('.personaQ')).map(el => ({ answer: el.value }));
    const msg = document.getElementById('personaBuildMsg'); if (msg) msg.textContent = '';
    try {
      const r = await personaSay('aiPersonaBuild', { bio, answers });
      if (r && r.persona && r.persona.text) {
        const saved = await personaSay('setPersona', { persona: r.persona });
        personaRenderStatus(saved && saved.persona ? saved.persona : r.persona);
        const m = document.getElementById('personaManual'); if (m) m.value = r.persona.text;
        if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已生成并保存人设。'; }
      } else { throw new Error((r && r.error) || 'AI 未返回人设'); }
    } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
    finally { buildBtn.disabled = false; buildBtn.textContent = '✨ 用 AI 整理成人设并保存'; }
  });

  const saveBtn = document.getElementById('personaSaveManualBtn');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const text = (document.getElementById('personaManual') || {}).value ? document.getElementById('personaManual').value.trim() : '';
    if (!text) { personaSetStatus('⚠️ 请先在"或自己写一份人设"里填内容再保存。', 'err'); return; }
    try {
      const bio = (document.getElementById('personaBio') || {}).value ? document.getElementById('personaBio').value.trim() : '';
      const answers = Array.from(document.querySelectorAll('.personaQ')).map(el => ({ answer: el.value }));
      const qa = {}; PERSONA_QUESTIONS.forEach((_, i) => { qa['q' + (i + 1)] = answers[i] ? answers[i].answer : ''; });
      const saved = await personaSay('setPersona', { persona: { text, bio, qa, updatedAt: Date.now() } });
      if (saved && saved.ok) { personaRenderStatus(saved.persona); personaSetStatus(''); }
      else throw new Error('后台没返回成功');
    } catch (e) { personaSetStatus('❌ 保存失败：' + (e.message || e), 'err'); }
  });

  const resetBtn = document.getElementById('personaResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    if (!confirm('确认重置账号人设？重置后需重新填写/重新生成。')) return;
    try { await personaSay('clearPersona'); } catch (_) {}
    const b = document.getElementById('personaBio'); if (b) b.value = '';
    const m = document.getElementById('personaManual'); if (m) m.value = '';
    personaRenderQuestions(null);
    personaRenderStatus(null);
  });
}

// ── 推广目标（基本配置 Tab）：目标决定判定口径 + 引导去哪；话术打法由「话术风格」Tab 的「评论目的」决定
//   guide: null = 工具引流，去向由用户在区块内的输入框填写；'' = 不引流；其他 = 固定去向
const STYLE_TEMPLATES = {
  tool: {
    name: '🛠️ 工具/应用引流（引导对方去用你的产品，如小程序/App/网站）',
    guide: null,
    a: '', b: '', c: '',
  },
  brand: {
    name: '🏷️ 品牌推广（只卖品牌价值，不引流）',
    guide: '',
    a: '', b: '', c: '',
  },
  profile: {
    name: '👤 个人主页引流（涨粉/把人沉淀到自己主页）',
    guide: '个人主页（点头像进入）',
    a: '', b: '', c: '',
  },
};

function initStyleTemplates() {
  const sel = document.getElementById('styleTemplateSelect');
  if (!sel || sel.options.length > 1) return; // 已填充过
  Object.keys(STYLE_TEMPLATES).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = STYLE_TEMPLATES[key].name;
    sel.appendChild(opt);
  });
}

// 按当前选中的推广目标切换引导去向输入框显隐与提示文案
function updatePromoGoalUI(goal) {
  const row = document.getElementById('guideRow');
  const hint = document.getElementById('promoGoalHint');
  if (!row || !hint) return;
  row.style.display = goal === 'tool' ? 'block' : 'none';
  const hints = {
    '': '选推广目标后点「应用」，自动设定判定口径与引导去向并保存；话术打法请到「话术风格」Tab 选「评论目的」',
    tool: '填写引导对方去哪（如：微信小程序/App），点「应用」后生效；话术会自然推荐对方去用你的产品',
    brand: '品牌推广不引流：话术只讲品牌价值与口碑，不会引导去任何平台/主页，无需填写去向',
    profile: '自动引导对方点头像进入你的个人主页，无需填写去向',
  };
  hint.innerHTML = hints[goal] || hints[''];
}

document.getElementById('styleTemplateSelect')?.addEventListener('change', (e) => {
  updatePromoGoalUI(e.target.value); // 只切 UI，点「应用」才落库
});

document.getElementById('applyStyleTemplateBtn')?.addEventListener('click', async () => {
  const key = document.getElementById('styleTemplateSelect').value;
  if (!key || !STYLE_TEMPLATES[key]) { showMsg('productSaveMsg', '请先选择推广目标', 'err'); return; }
  const tpl = STYLE_TEMPLATES[key];
  const guideInput = document.getElementById('productGuide');
  // 引导去向：工具引流取用户输入（必填），其余目标由样板固定
  let guideVal;
  if (tpl.guide === null) {
    guideVal = guideInput.value.trim();
    if (!guideVal) { showMsg('productSaveMsg', '请先填写引导去向（例：微信小程序）再应用', 'err'); guideInput.focus(); return; }
  } else {
    guideVal = tpl.guide;
  }
  const guideDesc = guideVal === '' ? '不引流（只讲品牌价值）' : '引导去向设为「' + guideVal + '」';
  if (!confirm('将应用「' + tpl.name + '」：\n\n1. ' + guideDesc + '\n2. 设定评论判定的口径（话术打法由「话术风格」Tab 的「评论目的」决定，不受此影响）\n\n应用后立即保存生效，继续？')) return;
  // 1) 同步表单 UI
  guideInput.value = guideVal;
  // 2) 直接落库（只动推广目标/引导去向，不碰基本配置其他未保存项；话术风格已改用「评论目的」体系）
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  cfg.product.promoGoal = key;
  cfg.product.guideText = guideVal;
  await setStorage('config', cfg);
  showMsg('productSaveMsg', '✅ 已应用并保存：' + guideDesc + '（判定口径已切换，打法请到「话术风格」Tab 选评论目的）', 'ok');
});

document.getElementById('saveStyleBtn')?.addEventListener('click', async () => {
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  // 字数控制（单范围，校验 + 自动纠正大小关系）
  const readPair = (minId, maxId, dMin, dMax) => {
    let mn = parseInt(document.getElementById(minId)?.value, 10);
    let mx = parseInt(document.getElementById(maxId)?.value, 10);
    if (!Number.isFinite(mn) || mn <= 0) mn = dMin;
    if (!Number.isFinite(mx) || mx <= 0) mx = dMax;
    if (mn > mx) { const t = mn; mn = mx; mx = t; }
    return [mn, mx];
  };
  const [pMn, pMx] = readPair('purposeMinChars', 'purposeMaxChars', 100, 300);
  cfg.scriptStyle.purposeMinChars = pMn;
  cfg.scriptStyle.purposeMaxChars = pMx;
  // 清理旧字数字段与旧 A/B/C 风格字段，避免混淆（新流程不再读取）
  delete cfg.scriptStyle.minChars; delete cfg.scriptStyle.maxChars;
  delete cfg.scriptStyle.aMinChars; delete cfg.scriptStyle.aMaxChars;
  delete cfg.scriptStyle.bMinChars; delete cfg.scriptStyle.bMaxChars;
  delete cfg.scriptStyle.cMinChars; delete cfg.scriptStyle.cMaxChars;
  delete cfg.scriptStyle.versionAStyle; delete cfg.scriptStyle.versionBStyle; delete cfg.scriptStyle.versionCStyle;
  // 评论目的 + 反AI味配置
  cfg.scriptStyle.scriptPurpose = document.getElementById('scriptPurposeSelect').value || 'sell';
  cfg.scriptStyle.toneMannerisms = document.getElementById('toneMannerisms').value.trim();
  cfg.scriptStyle.personaSample = document.getElementById('personaSample').value.trim();
  await setStorage('config', cfg);
  const nameMap = { sell: '卖产品', brand: '品牌种草', profile: '主页涨粉', likes: '互动涨赞', trend: '蹭热点', auto: '综合自动' };
  showMsg('styleSaveMsg', '✅ 已保存（目的：' + (nameMap[cfg.scriptStyle.scriptPurpose] || cfg.scriptStyle.scriptPurpose) + ' · 字数 ' + pMn + '-' + pMx + ' 字）', 'ok');
});

// ══════════════════════════════════════════════════════════════
// 知识库
// ══════════════════════════════════════════════════════════════
let kbData = [], kbEditId = null;

async function loadKnowledgeBase() {
  kbData = (await getStorage('knowledge_base')) || [];
  updateKbTagFilter();
  renderKbList();
}

// 更新标签筛选下拉框
function updateKbTagFilter() {
  const select = document.getElementById('kbTagFilter');
  if (!select) return;
  const currentVal = select.value;
  // 收集所有唯一标签
  const allTags = new Set();
  kbData.forEach(e => {
    if (Array.isArray(e.tags)) {
      e.tags.forEach(t => { if (t && t.trim()) allTags.add(t.trim()); });
    }
  });
  // 重建选项
  select.innerHTML = '<option value="">全部标签</option>';
  [...allTags].sort().forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    select.appendChild(opt);
  });
  // 恢复之前的选择
  if (currentVal && allTags.has(currentVal)) {
    select.value = currentVal;
  }
}

function renderKbList() {
  const list = document.getElementById('kbList');
  if (!list) return;
  const q = (document.getElementById('kbSearch')?.value || '').toLowerCase();
  const selectedTag = document.getElementById('kbTagFilter')?.value || '';
  const filtered = kbData.filter(e => {
    // 搜索文本过滤
    const matchSearch = !q || (e.title || '').toLowerCase().includes(q) || (e.content || '').toLowerCase().includes(q);
    // 标签过滤
    const matchTag = !selectedTag || (Array.isArray(e.tags) && e.tags.some(t => t.trim() === selectedTag));
    return matchSearch && matchTag;
  });
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-tip">暂无匹配条目</div>';
    return;
  }
  filtered.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'item-card' + (entry.isActive === false ? ' inactive' : '');
    const tags = Array.isArray(entry.tags) ? entry.tags.map(t => `<span class="item-tag">${esc(t)}</span>`).join('') : '';
    const roleBadge = entry.role ? `<span class="item-tag" style="background:#e8f4fd;color:#1a73e8;">${esc(entry.role)}</span>` : '';
    const imageBadge = entry.image ? `<span class="item-tag" style="background:#fef3c7;color:#d97706;">🖼️ 有图</span>` : '';
    card.innerHTML = `
      <div class="item-info">
        <div class="item-title">${esc(entry.title || '（无标题）')}</div>
        <div class="item-meta">${roleBadge} ${imageBadge} ${esc(entry.category || '通用')} · ${formatDate(entry.createdAt)} ${tags}</div>
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
  // 图片预览
  const imgPreview = document.getElementById('kbImagePreview');
  const imgInput = document.getElementById('kbImageInput');
  const imgDelete = document.getElementById('kbImageDelete');
  if (entry?.image) {
    imgPreview.src = entry.image;
    imgPreview.style.display = 'block';
    imgDelete.style.display = 'inline-block';
  } else {
    imgPreview.style.display = 'none';
    imgPreview.src = '';
    imgDelete.style.display = 'none';
  }
  if (imgInput) imgInput.value = '';
  document.getElementById('kbModal').style.display = 'flex';
}

function closeKbModal() { document.getElementById('kbModal').style.display = 'none'; }

async function saveKbEntry() {
  const title = document.getElementById('kbTitle').value.trim();
  const content = document.getElementById('kbContent').value.trim();
  if (!title || !content) { alert('标题和内容不能为空'); return; }
  
  // 处理图片
  let image = null;
  const imgInput = document.getElementById('kbImageInput');
  const imgFile = imgInput?.files?.[0];
  
  if (imgFile) {
    // 有新图片，读取为 base64
    image = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(imgFile);
    });
  } else if (kbEditId) {
    // 编辑模式且无新图，保留原图
    const existing = kbData.find(e => e.id === kbEditId);
    image = existing?.image || null;
  }
  
  const entry = {
    id: kbEditId || (Date.now().toString()),
    title,
    category: document.getElementById('kbCategory').value.trim() || '通用',
    content,
    tags: document.getElementById('kbTags').value.split(',').map(t => t.trim()).filter(Boolean),
    role: document.getElementById('kbRole').value.trim() || '',
    isActive: document.getElementById('kbIsActive').checked,
    image: image,
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
  updateKbTagFilter();
  renderKbList();
}

async function deleteKbEntry(id) {
  if (!confirm('确认删除这条知识库条目？')) return;
  kbData = kbData.filter(e => e.id !== id);
  await setStorage('knowledge_base', kbData);
  updateKbTagFilter();
  renderKbList();
}

document.getElementById('addKbBtn')?.addEventListener('click', () => openKbModal(null));
document.getElementById('closeKbModal')?.addEventListener('click', closeKbModal);
document.getElementById('cancelKbModal')?.addEventListener('click', closeKbModal);
document.getElementById('saveKbEntry')?.addEventListener('click', saveKbEntry);

// 图片上传预览
document.getElementById('kbImageInput')?.addEventListener('change', function(e) {
  const file = e.target.files[0];
  const preview = document.getElementById('kbImagePreview');
  const deleteBtn = document.getElementById('kbImageDelete');
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.style.display = 'block';
      deleteBtn.style.display = 'inline-block';
    };
    reader.readAsDataURL(file);
  }
});

// 删除图片
document.getElementById('kbImageDelete')?.addEventListener('click', function() {
  const preview = document.getElementById('kbImagePreview');
  const input = document.getElementById('kbImageInput');
  preview.src = '';
  preview.style.display = 'none';
  this.style.display = 'none';
  input.value = '';
});

document.getElementById('kbSearch')?.addEventListener('input', renderKbList);
document.getElementById('kbTagFilter')?.addEventListener('change', renderKbList);
document.getElementById('exportKbBtn')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(kbData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `knowledge_base_${Date.now()}.json`;
  a.click();
});
document.getElementById('clearKbBtn')?.addEventListener('click', async () => {
  if (!confirm(`确认清空所有知识库条目？（共 ${kbData.length} 条）\n\n建议先导出备份再清空。`)) return;
  kbData = [];
  await setStorage('knowledge_base', kbData);
  updateKbTagFilter();
  renderKbList();
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
    updateKbTagFilter();
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
  prospect_screener: { scene_name: '商机快筛（AI 价值判断+抓取自检）' },
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
    <div class="prompt-field">
      <label>System Prompt（占位符会自动替换：{product_name} {product_guide} {product_description} {promo_goal_name} {promo_goal_rules} {purpose_name} {purpose_guidance} {purpose_catalog} {tone_words} {persona_sample} {purpose_min_chars}/{purpose_max_chars} {comments_text} {max_opportunities} 等）</label>
      <textarea id="editSystemPrompt" style="height:420px">${esc(prompt.system_prompt || '')}</textarea>
    </div>
    <div class="prompt-field">
      <label>User Prompt 模板（{note_title} {comments_text} {comment_content} 等占位符会自动替换）</label>
      <textarea id="editUserPrompt" style="height:260px">${esc(prompt.user_prompt_template || '')}</textarea>
    </div>
    <div class="prompt-actions">
      <button class="btn-primary" id="savePromptBtn">保存</button>
      <button class="btn-secondary" id="resetPromptBtn">恢复默认</button>
      <span id="promptSaveMsg" class="save-msg" style="margin-left:8px;align-self:center"></span>
    </div>`;

  document.getElementById('savePromptBtn')?.addEventListener('click', async () => {
    // ★ 保存前提醒：插件升级/浏览器重启时会用最新默认模板覆盖自定义内容（设计如此，保证新版提示词一定生效）
    if (!confirm('提醒：自定义提示词在插件升级或浏览器重启后，会被最新的默认模板覆盖（保证新版优化能生效）。\n\n建议自行备份修改内容。确认保存？')) return;
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
// 一键灌水（只保留灌水历史；搜索关键词已移到 popup 左上方输入框，调度功能早已下线）
// ══════════════════════════════════════════════════════════════
async function loadAutoWaterConfig() {
  await Promise.all([loadAutoWaterHistory(), loadNoteTrendConfig()]);
}

/* ─── 循环计划设置（note_trend_config，与 popup 侧 lib/note-trend.js 共用同一 key 与默认值） ─── */
const NT_DEFAULT_CONFIG = { maxPerRound: 3, maxPerNote: 2, cooldownHours: 24, scanIntervalMin: 2 };

async function loadNoteTrendConfig() {
  try {
    const cfg = Object.assign({}, NT_DEFAULT_CONFIG, (await getStorage('note_trend_config')) || {});
    const ids = ['ntMaxPerRound', 'ntMaxPerNote', 'ntCooldownHours', 'ntScanIntervalMin'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = cfg[id.replace('ntMaxPerRound', 'maxPerRound').replace('ntMaxPerNote', 'maxPerNote').replace('ntCooldownHours', 'cooldownHours').replace('ntScanIntervalMin', 'scanIntervalMin')];
    });
    const msg = document.getElementById('ntSaveMsg');
    if (msg) msg.textContent = '';
  } catch (_) {}
}

document.getElementById('ntSaveBtn')?.addEventListener('click', async () => {
  const ids = ['maxPerRound', 'maxPerNote', 'cooldownHours', 'scanIntervalMin'];
  const cfg = {};
  const elIds = { maxPerRound: 'ntMaxPerRound', maxPerNote: 'ntMaxPerNote', cooldownHours: 'ntCooldownHours', scanIntervalMin: 'ntScanIntervalMin' };
  for (const k of ids) {
    const el = document.getElementById(elIds[k]);
    const v = parseInt(el ? el.value : '', 10);
    if (!isNaN(v) && v > 0) cfg[k] = v;
  }
  await setStorage('note_trend_config', cfg);
  const msg = document.getElementById('ntSaveMsg');
  if (msg) {
    msg.textContent = '✅ 已保存：每轮最多 ' + cfg.maxPerRound + ' 篇 / 每篇最多 ' + cfg.maxPerNote + ' 次 / 冷却 ' + cfg.cooldownHours + ' 小时 / 间隔 ' + cfg.scanIntervalMin + ' 分钟';
    setTimeout(() => { msg.textContent = ''; }, 4000);
  }
});

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

// 清空历史
document.getElementById('awClearHistoryBtn')?.addEventListener('click', async () => {
  if (!confirm('确认清空所有灌水历史？')) return;
  await setStorage('auto_water_history', {});
  loadAutoWaterHistory();
});

// ══════════════════════════════════════════════════════════════
// 停留时间（delay_config：区间随机 min~max，单位毫秒，默认 = 技术下限：能跑通的最快值）
// ══════════════════════════════════════════════════════════════
const DELAY_DEFAULT = { browseDwell: {min:0,max:0}, typingCharDelay: {min:0,max:0}, likeGap: {min:0,max:0}, lazyLoadWait: {min:300,max:300}, retryBackWait: {min:300,max:300}, retryOpenWait: {min:800,max:800}, noteOpenBuffer: {min:300,max:300}, preSendGap: {min:500,max:500}, batchItemGap: {min:0,max:0} };
// 拟人推荐值 = 区间（min~max 随机）
const DELAY_RECOMMEND = { browseDwell: {min:1200,max:2000}, typingCharDelay: {min:15,max:30}, likeGap: {min:300,max:600}, lazyLoadWait: {min:700,max:1100}, retryBackWait: {min:500,max:900}, retryOpenWait: {min:1100,max:2200}, noteOpenBuffer: {min:400,max:800}, preSendGap: {min:300,max:500}, batchItemGap: {min:4000,max:8000} };
const DELAY_KEYS = Object.keys(DELAY_DEFAULT);

// ═══ 拟人化挡位（0~5）：一键套用整套「停留/间隔」，挡位越高越慢越安全 ═══
const DELAY_PRESETS = [
  { level:0, name:'极速 · 裸跑', daily:'不限', desc:'完全不拟人，贴着技术下限最快跑。仅建议自用小号/单篇测试，批量高风险。批量点赞仍保留 300ms 保底间隔防连点。',
    cfg:{ browseDwell:{min:0,max:0}, typingCharDelay:{min:0,max:0}, likeGap:{min:300,max:300}, lazyLoadWait:{min:300,max:300}, retryBackWait:{min:300,max:300}, retryOpenWait:{min:800,max:800}, noteOpenBuffer:{min:300,max:300}, preSendGap:{min:400,max:400}, batchItemGap:{min:0,max:0} } },
  { level:1, name:'轻装 · 单篇/少量', daily:'≤20', desc:'只留底线缓冲，适合快速试探或低量测试。',
    cfg:{ browseDwell:{min:500,max:1000}, typingCharDelay:{min:0,max:0}, likeGap:{min:300,max:500}, lazyLoadWait:{min:300,max:600}, retryBackWait:{min:300,max:500}, retryOpenWait:{min:800,max:1200}, noteOpenBuffer:{min:300,max:500}, preSendGap:{min:300,max:600}, batchItemGap:{min:1000,max:2000} } },
  { level:2, name:'标准拟人（推荐默认）', daily:'≤10', desc:'模拟真人浏览/逐字打字/点赞间隔/条间间隔，日常稳定，推荐使用。',
    cfg:{ browseDwell:{min:1200,max:2000}, typingCharDelay:{min:15,max:30}, likeGap:{min:300,max:600}, lazyLoadWait:{min:700,max:1100}, retryBackWait:{min:500,max:900}, retryOpenWait:{min:1100,max:2200}, noteOpenBuffer:{min:500,max:900}, preSendGap:{min:400,max:700}, batchItemGap:{min:4000,max:8000} } },
  { level:3, name:'保守拟人', daily:'≤8', desc:'间隔拉长约一倍，加思考停顿，适合对量不敏感但求稳。',
    cfg:{ browseDwell:{min:2000,max:4000}, typingCharDelay:{min:20,max:40}, likeGap:{min:800,max:1500}, lazyLoadWait:{min:1200,max:2000}, retryBackWait:{min:900,max:1500}, retryOpenWait:{min:2000,max:3500}, noteOpenBuffer:{min:1000,max:1800}, preSendGap:{min:800,max:1200}, batchItemGap:{min:8000,max:15000} } },
  { level:4, name:'重度拟人 · 养号', daily:'≤5', desc:'更长随机间隔，适合新号养号或平台严打窗口。',
    cfg:{ browseDwell:{min:4000,max:8000}, typingCharDelay:{min:30,max:50}, likeGap:{min:1500,max:3000}, lazyLoadWait:{min:2000,max:3500}, retryBackWait:{min:1500,max:2500}, retryOpenWait:{min:3000,max:5000}, noteOpenBuffer:{min:1800,max:3000}, preSendGap:{min:1200,max:2000}, batchItemGap:{min:15000,max:30000} } },
  { level:5, name:'极致防御', daily:'≤3', desc:'处处关卡、超长随机，单篇都耗时数分钟，追求极限存活。',
    cfg:{ browseDwell:{min:8000,max:15000}, typingCharDelay:{min:40,max:80}, likeGap:{min:3000,max:6000}, lazyLoadWait:{min:3500,max:6000}, retryBackWait:{min:2500,max:4000}, retryOpenWait:{min:5000,max:8000}, noteOpenBuffer:{min:3000,max:5000}, preSendGap:{min:1500,max:2500}, batchItemGap:{min:30000,max:60000} } },
];

function _delayVal(k) {
  const c = DELAY_DEFAULT[k];
  return { min: c && c.min != null ? c.min : 0, max: c && c.max != null ? c.max : 0 };
}

async function loadDelayConfig() {
  const saved = (await getStorage('delay_config')) || {};
  for (const k of DELAY_KEYS) {
    // 兼容旧数值 / 新 {min,max}
    let v = saved[k];
    let minVal, maxVal;
    if (v && typeof v === 'object') { minVal = Math.max(0, parseInt(v.min, 10) || 0); maxVal = Math.max(0, parseInt(v.max, 10) || 0); }
    else if (v !== undefined) { minVal = maxVal = Math.max(0, parseInt(v, 10) || 0); }
    else { const d = _delayVal(k); minVal = d.min; maxVal = d.max; }
    const mi = document.getElementById('dl_' + k + '_min');
    const ma = document.getElementById('dl_' + k + '_max');
    if (mi) mi.value = String(minVal);
    if (ma) ma.value = String(maxVal);
  }
  // 互动行为（behavior_config）
  const bh = { autoFollow: true, followEvery: 1, ...((await getStorage('behavior_config')) || {}) };
  const followChk = document.getElementById('bhAutoFollow');
  if (followChk) followChk.checked = bh.autoFollow !== false;
  const everyInput = document.getElementById('bhFollowEvery');
  if (everyInput) everyInput.value = Math.max(1, parseInt(bh.followEvery, 10) || 1);
  await presetOnLoad();
}

function fillDelayInputs(values) {
  for (const k of DELAY_KEYS) {
    let v = values[k];
    let minVal, maxVal;
    if (v && typeof v === 'object') { minVal = Math.max(0, parseInt(v.min, 10) || 0); maxVal = Math.max(0, parseInt(v.max, 10) || 0); }
    else { minVal = maxVal = Math.max(0, parseInt(v, 10) || 0); }
    const mi = document.getElementById('dl_' + k + '_min');
    const ma = document.getElementById('dl_' + k + '_max');
    if (mi) mi.value = minVal;
    if (ma) ma.value = maxVal;
  }
}

document.getElementById('delaySaveBtn')?.addEventListener('click', async () => {
  const cfg = {};
  for (const k of DELAY_KEYS) {
    const mi = parseInt(document.getElementById('dl_' + k + '_min')?.value, 10);
    const ma = parseInt(document.getElementById('dl_' + k + '_max')?.value, 10);
    cfg[k] = { min: Math.max(0, mi || 0), max: Math.max(0, ma || 0) };
  }
  await setStorage('delay_config', cfg);
  // 互动行为一并保存
  await setStorage('behavior_config', {
    autoFollow: !!document.getElementById('bhAutoFollow')?.checked,
    followEvery: Math.max(1, parseInt(document.getElementById('bhFollowEvery')?.value, 10) || 1),
  });
  showMsg('delaySaveMsg', '✅ 已保存（区间随机，立即生效）', 'success');
});

document.getElementById('delayRecommendBtn')?.addEventListener('click', () => {
  fillDelayInputs(DELAY_RECOMMEND);
  showMsg('delaySaveMsg', '已填入拟人推荐区间，点「保存」生效', 'success');
});

document.getElementById('delayZeroBtn')?.addEventListener('click', () => {
  fillDelayInputs(DELAY_DEFAULT);
  showMsg('delaySaveMsg', '已恢复默认（技术下限，最快），点「保存」生效', 'success');
});

/* ─── 拟人化挡位（一键套用 + 预计灌完时间） ─── */
function _presetCfgFromInputs() {
  const cfg = {};
  for (const k of DELAY_KEYS) {
    const mi = document.getElementById('dl_' + k + '_min');
    const ma = document.getElementById('dl_' + k + '_max');
    cfg[k] = { min: parseInt(mi?.value, 10) || 0, max: parseInt(ma?.value, 10) || 0 };
  }
  return cfg;
}
function _mid(c) { return c ? ((Number(c.min) || 0) + (Number(c.max) || 0)) / 2 : 0; }
// 用加权“积温”把当前配置近似判定为最近挡位（typingCharDelay 的 ms 级权重加大）
function _weightedTotal(cfg) {
  const w = k => (k === 'typingCharDelay' ? 1000 : 1);
  return DELAY_KEYS.reduce((s, k) => s + _mid(cfg[k]) * w(k), 0);
}
function _closestPreset(cfg) {
  const t = _weightedTotal(cfg);
  let best = 2, bestD = Infinity;
  for (const p of DELAY_PRESETS) { const d = Math.abs(_weightedTotal(p.cfg) - t); if (d < bestD) { bestD = d; best = p.level; } }
  return best;
}
// 当前滑杆挡位（合法返回 0~5，含 0=裸跑；非法则按已填区间就近判定）
function _presetLevel() {
  const v = document.getElementById('delayPreset')?.value;
  const n = (v === '' || v === undefined || v === null) ? NaN : Number(v);
  return DELAY_PRESETS.some(p => p.level === n) ? n : _closestPreset(_presetCfgFromInputs());
}
// 预计灌完时间（cfg 配置，nr 每轮篇数）→ 秒（单篇=打开+浏览+懒加载+AI估算3s+打字+发前+发后0.7；篇间=条间）
function _estimateRoundSec(cfg, nr) {
  const sec = k => _mid(cfg[k]) / 1000;
  const per = sec('noteOpenBuffer') + sec('browseDwell') + sec('lazyLoadWait') + 3 + sec('typingCharDelay') + sec('preSendGap') + 0.7;
  const r = Math.max(1, Math.floor(nr || 10));
  return per * r + sec('batchItemGap') * (r - 1);
}
const DELAY_ROUND_LIMIT = { 0: 0, 1: 30, 2: 20, 3: 12, 4: 8, 5: 5 }; // 每轮可处理笔记篇数（挡位越高越保守；0=不限=以每日上限为准；1档放松到30/2档20）
function _fmtMin(sec) {
  if (!(sec > 0)) return '<1 分钟';
  const m = sec / 60;
  if (m < 60) return '约 ' + Math.ceil(m) + ' 分钟';
  const h = Math.floor(m / 60), mm = m % 60;
  return '约 ' + h + ' 小时' + (mm >= 1 ? ' ' + Math.ceil(mm) + ' 分' : '');
}
function renderPreset(level, cfg) {
  const p = DELAY_PRESETS.find(x => x.level === level) || DELAY_PRESETS[2];
  const slider = document.getElementById('delayPreset');
  const nameEl = document.getElementById('delayPresetName');
  const descEl = document.getElementById('delayPresetDesc');
  const estEl = document.getElementById('delayPresetEst');
  const nr = parseInt(document.getElementById('dl_estimateRound')?.value, 10) || 10;
  if (slider) slider.value = level;
  if (nameEl) nameEl.textContent = '挡位 ' + p.level + ' · ' + p.name;
  if (descEl) descEl.textContent = '每日建议 ' + p.daily + ' 篇 ｜ ' + p.desc;
  const roundVal = Math.max(0, parseInt(document.getElementById('dl_estimateRound')?.value, 10) || 0);
  const roundEl = document.getElementById('delayPresetRound');
  if (roundEl) roundEl.textContent = (roundVal <= 0 ? '不限（以每日上限为准）' : '≤ ' + roundVal + ' 篇');
  if (estEl) estEl.textContent = (roundVal > 0 ? _fmtMin(_estimateRoundSec(cfg || _presetCfgFromInputs(), roundVal)) : '每轮不限，无法预估');
}
async function presetOnLoad() {
  const saved = (await getStorage('delay_config')) || {};
  const savedLvl = await getStorage('delay_preset');
  let level = (savedLvl != null) ? Number(savedLvl) : _closestPreset(saved);
  if (!DELAY_PRESETS.find(x => x.level === level)) level = 2;
  renderPreset(level, saved);
}
document.getElementById('delayPreset')?.addEventListener('input', async (e) => {
  const lvl = Number(e.target.value);
  const p = DELAY_PRESETS.find(x => x.level === lvl);
  if (!p) return;
  fillDelayInputs(p.cfg);
  const pr = DELAY_ROUND_LIMIT[lvl] != null ? DELAY_ROUND_LIMIT[lvl] : 0;
  const erEl = document.getElementById('dl_estimateRound');
  if (erEl) erEl.value = pr;
  renderPreset(lvl, p.cfg);
  await setStorage('delay_preset', lvl);
  try { // 每轮处理篇数随挡位联动（即时写入一键灌水配置；0=不限=以每日上限为准）
    const aw = (await getStorage('auto_water_config')) || {};
    aw.schedule = aw.schedule || {};
    aw.schedule.perRound = pr;
    await setStorage('auto_water_config', aw);
  } catch (_) {}
  showMsg('delaySaveMsg', '已套用 挡位' + lvl + '（' + p.name + '），确定后点「保存」生效', 'success');
});
['delayPreset', 'dl_estimateRound'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', async () => {
    renderPreset(_presetLevel(), _presetCfgFromInputs());
    if (id === 'dl_estimateRound') {            // 自定义每轮篇数 → 即时写入（0=不限）
      try {
        const rv = Math.max(0, parseInt(document.getElementById('dl_estimateRound')?.value, 10) || 0);
        const aw = (await getStorage('auto_water_config')) || {};
        aw.schedule = aw.schedule || {};
        aw.schedule.perRound = rv;
        await setStorage('auto_water_config', aw);
      } catch (_) {}
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 初始化
// ══════════════════════════════════════════════════════════════
async function init() {
  await applyEditionToSettings();
  await applyAccountVerifyToSettings();
  // ★ 其它入口(弹窗/向导)验证通过后，本设置页立即解锁，无需重开
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes['_acct_guard']) return;
      const v = changes['_acct_guard'].newValue;
      if (v && v.matched && !_accountVerifiedInSession) {
        _accountVerifiedInSession = true;
        const m = document.getElementById('accountVerifyMask'); if (m) m.remove();
        const msg = document.getElementById('acctVerifyMsg'); if (msg) { msg.textContent = '✅ 已在其它入口验证通过，已解锁'; msg.style.color = '#7bd88f'; }
      }
    });
  } catch (_) {}
  await Promise.all([
    loadTenants(),
    loadProductConfig(),
    loadAiConfig(),
    loadStyleConfig(),
    loadKnowledgeBase(),
    loadPrompts(),
    loadLogs(),
    loadAutoWaterConfig(),
    loadDelayConfig(),
  ]);
}

// ══════════════════════════════════════════════════════════════
// 版本 / 授权控制
// ══════════════════════════════════════════════════════════════
async function applyEditionToSettings() {
  let status = null;
  try {
    status = await chrome.runtime.sendMessage({ action: 'getEdition' });
  } catch (e) { console.warn('[版本] 获取版本状态失败:', e); }
  if (!status || !status.edition) return; // 拿不到就放行
  const ed = status.edition;

  // 顶部展示版本名 + 到期信息
  renderSettingsEditionInfo(status);

  // 无网络：锁定
  if (status.noNetwork) { showSettingsNoNetworkMask(); return; }

  // 到期：全屏遮罩锁死
  if (status.expired) { showSettingsExpiredMask(ed); return; }

  // 产品库（trial 关闭）：灰显「产品卖点」并标注企业版功能（不隐藏）
  _productLibLocked = !ed.features || !ed.features.productLib;
  if (_productLibLocked) {
    const grp = document.getElementById('sellPointList');
    const wrap = grp && grp.closest('.form-group');
    if (grp) {
      grp.style.opacity = '0.55';
      grp.style.pointerEvents = 'none';
      grp.style.cursor = 'not-allowed';
      grp.setAttribute('title', '🔒 产品卖点为企业版功能，升级后解锁');
    }
    const addBtn = document.getElementById('addSellPointBtn');
    if (addBtn) { addBtn.disabled = true; addBtn.style.opacity = '0.55'; }
    if (wrap) {
      const label = wrap.querySelector('label');
      if (label && !label.querySelector('.edition-lock-badge')) {
        const badge = document.createElement('span');
        badge.className = 'edition-lock-badge';
        badge.style.cssText = 'font-size:11px;color:#e65100;background:#fff3e0;border:1px solid #ffe0b2;padding:1px 6px;border-radius:3px;margin-left:6px;';
        badge.textContent = '🔒 产品卖点为企业版功能（当前版本 ' + (ed.label || '') + ' 不可用）';
        label.appendChild(badge);
      }
    }
  }

  // 租户模式（trial / ent 关闭）：灰显 Tab + 面板加锁定提示，禁用面板内操作（不隐藏）
  if (!ed.features || !ed.features.tenant) {
    const tabItem = document.querySelector('.tab-item[data-tab="tenant"]');
    const panel = document.getElementById('tab-tenant');
    if (tabItem) {
      tabItem.style.opacity = '0.45';
      tabItem.textContent = '🔒 租户/产品';
      tabItem.title = '多租户为「企业版·多租户」专属功能，当前版本（' + (ed.label || '') + '）不可用';
    }
    if (panel) {
      // 面板顶部插入锁定提示条
      if (!panel.querySelector('.edition-lock-notice')) {
        const notice = document.createElement('div');
        notice.className = 'edition-lock-notice';
        notice.style.cssText = 'padding:10px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;color:#856404;font-size:13px;line-height:1.6;margin-bottom:14px;';
        notice.innerHTML = '🔒 多租户（多产品独立配置）属于「企业版·多租户」，当前版本（' + esc(ed.label || '') + '）不可用。如需同时运营多个产品，请联系服务商升级解锁。';
        const header = panel.querySelector('.panel-header');
        if (header) header.insertAdjacentElement('afterend', notice);
        else panel.insertAdjacentElement('afterbegin', notice);
      }
      // 禁用面板内所有操作控件；租户列表是异步渲染的，用 pointer-events 屏蔽
      panel.querySelectorAll('input, button, select, textarea').forEach(el => { el.disabled = true; });
      const list = document.getElementById('tenantList');
      if (list) { list.style.opacity = '0.5'; list.style.pointerEvents = 'none'; }
    }
    // 若租户 Tab 原本是默认激活态，改为激活「产品配置」（Tab 仍可点击查看锁定说明）
    if (tabItem && tabItem.classList.contains('active')) {
      tabItem.classList.remove('active');
      if (panel) panel.classList.remove('active');
      const basicTab = document.querySelector('.tab-item[data-tab="product"]');
      const basicPanel = document.getElementById('tab-product');
      if (basicTab) basicTab.classList.add('active');
      if (basicPanel) basicPanel.classList.add('active');
    }
  }

  // 知识库（试用版关闭）：灰显 Tab + 面板锁定
  if (!ed.features || !ed.features.knowledge) {
    lockSettingsTab({
      tab: 'knowledge',
      panelId: 'tab-knowledge',
      lockedLabel: '🔒 知识库',
      tabTitle: '知识库为企业版功能，当前版本（' + (ed.label || '') + '）不可用',
      notice: '🔒 知识库（录入专业知识、AI 生成时自动引用）属于企业版功能，当前版本（' + esc(ed.label || '') + '）不可用。升级企业版后可解锁，让回复更专业、更像真人。',
      listId: 'kbList',
    });
  }

  // 一键灌水（试用版关闭）：灰显 Tab + 面板锁定
  if (!ed.features || !ed.features.autoWater) {
    lockSettingsTab({
      tab: 'autowater',
      panelId: 'tab-autowater',
      lockedLabel: '🔒 一键灌水',
      tabTitle: '一键灌水为企业版功能，当前版本（' + (ed.label || '') + '）不可用',
      notice: '🔒 一键灌水（关键词批量搜笔记 + 笔记列表逐篇处理）属于企业版功能，当前版本（' + esc(ed.label || '') + '）不可用。升级企业版后可解锁批量获客。',
    });
  }
}

/**
 * 通用：灰显并锁定某个设置页 Tab（Tab 仍可点击查看锁定说明，但面板内所有操作禁用）
 * @param {{tab:string,panelId:string,lockedLabel:string,tabTitle:string,notice:string,listId?:string}} o
 */
function lockSettingsTab(o) {
  const tabItem = document.querySelector('.tab-item[data-tab="' + o.tab + '"]');
  const panel = document.getElementById(o.panelId);
  if (tabItem) {
    tabItem.style.opacity = '0.45';
    tabItem.textContent = o.lockedLabel;
    tabItem.title = o.tabTitle;
  }
  if (panel) {
    if (!panel.querySelector('.edition-lock-notice')) {
      const notice = document.createElement('div');
      notice.className = 'edition-lock-notice';
      notice.style.cssText = 'padding:10px 14px;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;color:#856404;font-size:13px;line-height:1.6;margin-bottom:14px;';
      notice.innerHTML = o.notice;
      const header = panel.querySelector('.panel-header');
      if (header) header.insertAdjacentElement('afterend', notice);
      else panel.insertAdjacentElement('afterbegin', notice);
    }
    panel.querySelectorAll('input, button, select, textarea').forEach(el => { el.disabled = true; });
    if (o.listId) {
      const list = document.getElementById(o.listId);
      if (list) { list.style.opacity = '0.5'; list.style.pointerEvents = 'none'; }
    }
  }
  // 若被锁 Tab 原本是激活态，改为激活「产品配置」
  if (tabItem && tabItem.classList.contains('active')) {
    tabItem.classList.remove('active');
    if (panel) panel.classList.remove('active');
    const basicTab = document.querySelector('.tab-item[data-tab="product"]');
    const basicPanel = document.getElementById('tab-product');
    if (basicTab) basicTab.classList.add('active');
    if (basicPanel) basicPanel.classList.add('active');
  }
}

/** 在侧栏头部展示版本与剩余天数 */
function renderSettingsEditionInfo(status) {
  const ed = status && status.edition; if (!ed) return;
  const header = document.querySelector('.sidebar-header');
  if (!header || document.getElementById('editionInfo')) return;
  let txt = ed.label || '';
  if (!ed.neverExpires && typeof status.remainingDays === 'number') {
    txt += status.remainingDays <= 0 ? '｜今天到期' : `｜剩 ${status.remainingDays} 天`;
  } else if (ed.neverExpires) {
    txt += '｜永久';
  }
  const el = document.createElement('div');
  el.id = 'editionInfo';
  el.style.cssText = 'font-size:11px;color:#999;padding:4px 12px 8px;line-height:1.5;';
  const bound = (ed.boundAccount && ed.boundAccount.xhsId) ? `｜绑定小红书号：${ed.boundAccount.xhsId}${ed.boundAccount.name ? '（' + ed.boundAccount.name + '）' : ''}` : '';
  el.textContent = txt + (ed.licensee ? `｜授权：${ed.licensee}` : '') + bound;
  header.insertAdjacentElement('afterend', el);
}

/* ═══════════ 账号绑定验证（绑定版：先登录+验证通过，才让用户使用/保存） ═══════════
 * 小红书没有别的地方能锁定查看“小红书号”，只有本人主页能读到。所以：
 *  1) 读取绑定号；
 *  2) 若绑定号存在且本地未验证 → 弹出校验遮罩，让用户在小红书网页版登录绑定账号后点“验证”；
 *  3) 验证由 background 打开本人主页比对小红书号（accountGuarantee）；
 *  4) 通过 → 移除遮罩；不通过 → 拦截，不给保存/使用。
 * 遮罩为全屏，未通过前设置页所有保存按钮都点不到，满足“验证通过才允许保存”。
 */
async function applyAccountVerifyToSettings() {
  let ed = null;
  try {
    const st = await chrome.runtime.sendMessage({ action: 'getEdition' });
    ed = st && st.edition;
  } catch (_) {}
  if (!ed || !ed.hasBinding) return; // 绑定版才需要验证
  const bound = ed.boundAccount || { xhsId: '', name: '' };
  // 本会话内已验证：直接放行，避免重开验证后仍提示（无需等 storage 传播/重开窗口）
  if (_accountVerifiedInSession) return;
  // 快速读本地校验缓存：已验证则放行
  try {
    const stat = await chrome.runtime.sendMessage({ action: 'accountStatus' });
    if (stat && stat.verified) return; // 已通过，直接放行
  } catch (_) {}
  showSettingsAccountVerifyMask(bound.xhsId, bound.name);
}

function showSettingsAccountVerifyMask(xhsId, name) {
  if (document.getElementById('accountVerifyMask')) return;
  const mask = document.createElement('div');
  mask.id = 'accountVerifyMask';
  mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(30,30,30,0.95);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
  mask.innerHTML = `
    <div style="font-size:44px;margin-bottom:12px;">🔒</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:6px;">请先验证你的小红书账号</div>
    <div style="font-size:13px;color:#ddd;line-height:1.9;max-width:350px;margin-bottom:16px;">
      本工具已绑定小红书号：<b style="color:#fff;">${esc(xhsId || '')}</b>${name ? ('（' + esc(name) + '）') : ''}<br>
      只有该账号能使用。请操作三步：<br>
      ① 在小红书网页版 <b>登录绑定的账号</b>；<br>
      ② 打开你自己的<b>「我的」主页</b>（别关，保持在网页标签里）；<br>
      ③ 回到这里点<b>「验证」</b>。
      <span id="acctVerifyMsg" style="display:block;color:#ffd666;margin-top:10px;min-height:18px;font-size:12px;"></span>
    </div>
    <button id="acctVerifyBtn" style="padding:10px 28px;border:none;border-radius:9px;background:#ff274b;color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:transform .08s ease, opacity .2s ease;">验 证</button>
    <style>
      #acctVerifyBtn:active{ transform:scale(.93); }
      #acctVerifyBtn[data-loading="1"]{ opacity:.75; cursor:wait; }
      @keyframes acctSpinS{ to{ transform:rotate(360deg);} }
      .acct-spinner-s{ display:inline-block; width:14px; height:14px; margin-right:6px; vertical-align:-2px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:acctSpinS .7s linear infinite; }
    </style>`;
  document.body.appendChild(mask);
  const btn = document.getElementById('acctVerifyBtn');
  const msg = document.getElementById('acctVerifyMsg');
  btn.addEventListener('click', async () => {
    if (btn.dataset.loading === '1') return;
    btn.dataset.loading = '1'; btn.disabled = true;
    btn.innerHTML = '<span class="acct-spinner-s"></span>验证中…';
    if (msg) { msg.textContent = ''; msg.style.color = '#ffd666'; }
    const t0 = Date.now();
    try {
      const r = await chrome.runtime.sendMessage({ action: 'accountGuarantee', forceNow: true });
      const wait = Math.max(0, 750 - (Date.now() - t0));
      await new Promise(res => setTimeout(res, wait));
      if (r && r.ok) {
        _accountVerifiedInSession = true;
        if (msg) { msg.textContent = '✅ 验证通过，已生效'; msg.style.color = '#7bd88f'; }
        btn.innerHTML = '✓ 已通过'; btn.dataset.loading = '0'; btn.disabled = true;
        setTimeout(() => {
          const m = document.getElementById('accountVerifyMask'); if (m) m.remove();
        }, 600);
      } else {
        btn.dataset.loading = '0'; btn.disabled = false; btn.innerHTML = '重新验证';
        if (msg) { msg.textContent = '❌ ' + ((r && r.reason) || '没找到你打开的主页，请确认已登录并在网页里打开自己的「我的」主页后重试'); msg.style.color = '#ffb3c1'; }
      }
    } catch (_) {
      btn.dataset.loading = '0'; btn.disabled = false; btn.innerHTML = '重新验证';
      if (msg) { msg.textContent = '❌ 验证失败（可能未登录小红书或网络异常），请稍后重试'; msg.style.color = '#ffb3c1'; }
    }
  });
}
function showSettingsExpiredMask(edition) {
  if (document.getElementById('editionExpiredMask')) return;
  const licensee = (edition && edition.licensee) ? ('（授权：' + esc(edition.licensee) + '）') : '';
  const mask = document.createElement('div');
  mask.id = 'editionExpiredMask';
  mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(30,30,30,0.94);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
  mask.innerHTML = `
    <div style="font-size:44px;margin-bottom:12px;">⛔</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:8px;">授权已到期</div>
    <div style="font-size:13px;color:#ddd;line-height:1.7;max-width:320px;">
      当前版本使用期限已结束${licensee}，功能已锁定。<br>如需继续使用，请联系服务商续期或获取新版本。
    </div>`;
  document.body.appendChild(mask);
}

/** 无网络锁定遮罩 */
function showSettingsNoNetworkMask() {
  if (document.getElementById('editionExpiredMask')) return;
  const mask = document.createElement('div');
  mask.id = 'editionExpiredMask';
  mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(30,30,30,0.94);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
  mask.innerHTML = `
    <div style="font-size:44px;margin-bottom:12px;">🌐</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:8px;">无法连接网络</div>
    <div style="font-size:13px;color:#ddd;line-height:1.7;max-width:320px;">
      本插件需要联网运行以验证授权状态。<br>请检查网络连接后重试。
    </div>`;
  document.body.appendChild(mask);
}

init().catch(console.error);

// ═════════════════════════════════════════════════════════
// 租户 / 产品管理
// ═════════════════════════════════════════════════════════
let _tenants = [], _currentTenantId = null;

async function loadTenants() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'listTenants' });
    _tenants = (resp && resp.tenants) || [];
    _currentTenantId = resp && resp.currentId;
  } catch (e) {
    _tenants = []; _currentTenantId = null;
  }
  renderTenantList();
}

function renderTenantList() {
  const box = document.getElementById('tenantList');
  if (!box) return;
  box.innerHTML = '';
  if (_tenants.length === 0) {
    box.innerHTML = '<div style="color:#999;font-size:12px;">暂无租户</div>';
    return;
  }
  _tenants.forEach(t => {
    const isCur = t.id === _currentTenantId;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;border:1px solid ' +
      (isCur ? '#e65100' : '#e0e0e0') + ';border-radius:6px;background:' + (isCur ? '#fff8f2' : '#fff') + ';';
    const name = document.createElement('span');
    name.style.cssText = 'flex:1;font-size:13px;font-weight:500;';
    name.textContent = t.name + (isCur ? '  ✅ 当前' : '');
    row.appendChild(name);

    if (!isCur) {
      const useBtn = document.createElement('button');
      useBtn.className = 'btn-primary';
      useBtn.style.cssText = 'padding:3px 10px;font-size:12px;';
      useBtn.textContent = '切换';
      useBtn.onclick = () => switchTenant(t.id);
      row.appendChild(useBtn);
    }
    const renameBtn = document.createElement('button');
    renameBtn.style.cssText = 'padding:3px 10px;font-size:12px;border:1px solid #d0d0d0;background:#fff;border-radius:4px;cursor:pointer;';
    renameBtn.textContent = '重命名';
    renameBtn.onclick = () => renameTenant(t.id, t.name);
    row.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'padding:3px 10px;font-size:12px;border:1px solid #e57373;background:#fff;color:#c62828;border-radius:4px;cursor:pointer;';
    delBtn.textContent = '删除';
    delBtn.disabled = _tenants.length <= 1;
    if (delBtn.disabled) { delBtn.style.opacity = '0.4'; delBtn.style.cursor = 'not-allowed'; delBtn.title = '至少保留一个租户'; }
    delBtn.onclick = () => deleteTenant(t.id, t.name);
    row.appendChild(delBtn);

    box.appendChild(row);
  });
}

async function switchTenant(id) {
  showMsg('tenantSaveMsg', '正在切换租户…', 'ok', 0);
  try {
    const r = await chrome.runtime.sendMessage({ action: 'switchTenant', data: { id } });
    if (r && r.ok === false) throw new Error(r.error || '切换失败');
    showMsg('tenantSaveMsg', '✅ 已切换，重新加载配置…', 'ok', 0);
    setTimeout(() => location.reload(), 400); // 重载设置页 → 各 Tab 显示新租户数据
  } catch (e) {
    showMsg('tenantSaveMsg', '❌ ' + (e.message || e), 'err');
  }
}

async function renameTenant(id, oldName) {
  const name = prompt('重命名租户：', oldName);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) { showMsg('tenantSaveMsg', '名称不能为空', 'err'); return; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'renameTenant', data: { id, name: trimmed } });
    if (r && r.ok === false) throw new Error(r.error || '重命名失败');
    await loadTenants();
    showMsg('tenantSaveMsg', '✅ 已重命名', 'ok');
  } catch (e) {
    showMsg('tenantSaveMsg', '❌ ' + (e.message || e), 'err');
  }
}

async function deleteTenant(id, name) {
  if (!confirm('确定删除租户「' + name + '」？\n该产品的配置、知识库、话术、已灌水记录将全部删除，无法恢复！')) return;
  try {
    const r = await chrome.runtime.sendMessage({ action: 'deleteTenant', data: { id } });
    if (r && r.ok === false) throw new Error(r.error || '删除失败');
    if (id === _currentTenantId) {
      showMsg('tenantSaveMsg', '✅ 已删除，重新加载…', 'ok', 0);
      setTimeout(() => location.reload(), 400);
    } else {
      await loadTenants();
      showMsg('tenantSaveMsg', '✅ 已删除', 'ok');
    }
  } catch (e) {
    showMsg('tenantSaveMsg', '❌ ' + (e.message || e), 'err');
  }
}

document.getElementById('createTenantBtn')?.addEventListener('click', async () => {
  const inp = document.getElementById('newTenantName');
  const name = (inp.value || '').trim();
  if (!name) { showMsg('tenantSaveMsg', '请先填写产品名称', 'err'); return; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'createTenant', data: { name } });
    if (r && r.ok === false) throw new Error(r.error || '新建失败');
    inp.value = '';
    await loadTenants();
    showMsg('tenantSaveMsg', '✅ 已新建「' + name + '」，点“切换”可切到该产品', 'ok');
  } catch (e) {
    showMsg('tenantSaveMsg', '❌ ' + (e.message || e), 'err');
  }
});

// Tab 切换时刷新日志
document.querySelector('[data-tab="logs"]')?.addEventListener('click', loadLogs);
// Tab 切换时刷新灌水历史
document.querySelector('[data-tab="autowater"]')?.addEventListener('click', loadAutoWaterConfig);

// Tab 切换时刷新封面设置 / 人设&话术风格
document.querySelector('[data-tab="cover"]')?.addEventListener('click', loadCoverConfig);
document.querySelector('[data-tab="persona"]')?.addEventListener('click', () => { loadPersonaManager(); loadStyleConfig(); });

// ═══════════ AI客服：设置镜像（场景A + 问答B + 导入导出 + 试问答） ═══════════
let _aics = null;
const _ae = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _AICS_PURP = [['sell', '卖货'], ['brand', '品牌'], ['profile', '涨粉'], ['likes', '养数'], ['trend', '热点'], ['auto', '自动']];
document.querySelector('[data-tab="aics"]')?.addEventListener('click', renderAiCsSettings);

async function renderAiCsSettings() {
  const box = document.getElementById('aicsBody'); if (!box) return;
  box.innerHTML = '<div style="padding:20px;color:#888;">加载 AI客服配置…</div>';
  let cfg;
  try { const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} }); if (!r || !r.ok) throw new Error((r && r.error) || '读取失败'); cfg = r.config; }
  catch (e) { box.innerHTML = '<div style="color:#d33;">❌ ' + _ae(e.message) + '</div>'; return; }
  _aics = cfg;
  box.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
      <button id="aicsSave" style="font-size:12px;padding:6px 14px;border:none;border-radius:8px;background:#ff274b;color:#fff;cursor:pointer;font-weight:600;">💾 保存全部</button>
      <button id="aicsExport" style="font-size:12px;padding:6px 12px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;cursor:pointer;">⬇ 导出</button>
      <button id="aicsImport" style="font-size:12px;padding:6px 12px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;cursor:pointer;">⬆ 导入</button>
    </div>
    <div style="font-weight:600;font-size:13px;margin:4px 0;">A · 触达场景</div>
    <div id="aicsScenes"></div>
    <div style="font-weight:600;font-size:13px;margin:12px 0 4px;">B · 客户问答话术库</div>
    <div id="aicsQa"></div>
    <div style="font-weight:600;font-size:13px;margin:12px 0 4px;">🧪 试问答</div>
    <div style="display:flex;gap:6px;"><input id="aicsIn" type="text" placeholder="模拟客户说一句，如：几号发货" style="flex:1;padding:6px 8px;border:1px solid #dfe3ea;border-radius:8px;font-size:12px;"><button id="aicsTest" style="font-size:12px;padding:6px 12px;border:1px solid #0e7490;background:#ecfeff;color:#0e7490;border-radius:8px;cursor:pointer;">应答</button></div>
    <div id="aicsOut" style="font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;"></div>`;
  paintAicsScenes(); paintAicsQa();
  document.getElementById('aicsSave')?.addEventListener('click', saveAicsSettings);
  document.getElementById('aicsExport')?.addEventListener('click', () => exportAicsSettings());
  document.getElementById('aicsImport')?.addEventListener('click', () => importAicsSettings());
  document.getElementById('aicsTest')?.addEventListener('click', () => testAics());
}

function paintAicsScenes() {
  const box = document.getElementById('aicsScenes'); if (!box) return;
  box.innerHTML = Object.keys(_aics.scenes).map(k => {
    const s = _aics.scenes[k];
    const purp = _AICS_PURP.map(([v, l]) => `<option value="${v}" ${s.purpose === v ? 'selected' : ''}>${l}</option>`).join('');
    const mode = `<select class="aics-sc-mode" data-k="${k}"><option value="draft" ${s.mode === 'draft' ? 'selected' : ''}>草拟</option><option value="auto" ${s.mode === 'auto' ? 'selected' : ''}>自动</option></select>`;
    return `<div style="display:flex;gap:6px;align-items:center;border:1px solid #eee;border-radius:6px;padding:5px 8px;margin-bottom:4px;font-size:12px;background:#fff;">
      <label style="display:flex;align-items:center;gap:3px;min-width:70px;"><input type="checkbox" class="aics-sc-on" data-k="${k}" ${s.enabled ? 'checked' : ''}>${_ae(s.name)}</label>
      <select class="aics-sc-purpose" data-k="${k}" style="font-size:11px;">${purp}</select>${mode}
    </div>`;
  }).join('');
}
function paintAicsQa() {
  const box = document.getElementById('aicsQa'); if (!box) return;
  box.innerHTML = _aics.qa.map((e, i) => `<div style="border:1px solid #eee;border-radius:6px;padding:5px 8px;margin-bottom:4px;background:#fff;">
    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
      <input class="aics-qa-cat" data-i="${i}" value="${_ae(e.category)}" style="width:80px;font-size:12px;font-weight:600;border:1px solid #eee;border-radius:5px;padding:3px;">
      <select class="aics-qa-mode" data-i="${i}" style="font-size:11px;"><option value="template" ${e.mode === 'template' ? 'selected' : ''}>模板</option><option value="ai" ${e.mode === 'ai' ? 'selected' : ''}>AI</option></select>
      <select class="aics-qa-auto" data-i="${i}" style="font-size:11px;"><option value="draft" ${e.auto === 'draft' ? 'selected' : ''}>草拟</option><option value="auto" ${e.auto === 'auto' ? 'selected' : ''}>自动</option><option value="off" ${e.auto === 'off' ? 'selected' : ''}>关闭</option></select>
      <label style="font-size:11px;display:flex;gap:2px;align-items:center;"><input type="checkbox" class="aics-qa-on" data-i="${i}" ${e.enabled !== false ? 'checked' : ''}>启用</label>
      <button class="aics-qa-del" data-i="${i}" style="margin-left:auto;border:none;background:none;color:#d32f2f;cursor:pointer;">🗑</button>
    </div>
    <input class="aics-qa-kw" data-i="${i}" value="${_ae((e.keywords || []).join('，'))}" placeholder="触发关键词" style="width:100%;box-sizing:border-box;font-size:11px;border:1px solid #eee;border-radius:5px;padding:3px;margin-top:4px;">
    <textarea class="aics-qa-ans" data-i="${i}" rows="1" placeholder="话术" style="width:100%;box-sizing:border-box;font-size:11px;border:1px solid #eee;border-radius:5px;padding:3px;margin-top:4px;">${_ae(e.answer || '')}</textarea>
  </div>`).join('');
  box.querySelectorAll('.aics-qa-del').forEach(b => b.addEventListener('click', () => { _aics.qa.splice(parseInt(b.dataset.i, 10), 1); paintAicsQa(); }));
}
function gatherAicsSettings() {
  const scenes = {}; Object.keys(_aics.scenes).forEach(k => {
    const s = _aics.scenes[k];
    const q = (sel) => document.querySelector(sel + '[data-k="' + k + '"]');
    scenes[k] = { ...s, enabled: !!document.querySelector('.aics-sc-on[data-k="' + k + '"]')?.checked, purpose: document.querySelector('.aics-sc-purpose[data-k="' + k + '"]')?.value || s.purpose, mode: document.querySelector('.aics-sc-mode[data-k="' + k + '"]')?.value || 'draft' };
  });
  const qa = Array.from(document.querySelectorAll('.aics-qa-cat')).map(ta => { const i = parseInt(ta.dataset.i, 10); const e = _aics.qa[i] || {}; return { id: e.id || ('qa_' + i), category: ta.value.trim() || '未命名', keywords: (document.querySelector('.aics-qa-kw[data-i="' + i + '"]')?.value || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean), mode: document.querySelector('.aics-qa-mode[data-i="' + i + '"]')?.value || 'template', auto: document.querySelector('.aics-qa-auto[data-i="' + i + '"]')?.value || 'draft', enabled: !!document.querySelector('.aics-qa-on[data-i="' + i + '"]')?.checked, answer: document.querySelector('.aics-qa-ans[data-i="' + i + '"]')?.value || '' }; });
  return { scenes, qa };
}
async function saveAicsSettings() {
  try { const r = await chrome.runtime.sendMessage({ action: 'saveAiCsConfig', data: { partial: gatherAicsSettings() } }); if (r && r.ok) { _aics = r.config; alert('✅ AI客服配置已保存'); } else alert('❌ 保存失败：' + ((r && r.error) || '未知')); }
  catch (e) { alert('❌ 保存失败：' + e.message); }
}
async function exportAicsSettings() { try { const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} }); const t = JSON.stringify((r && r.config) || {}, null, 2); await navigator.clipboard.writeText(t); alert('✅ 已复制 AI客服配置到剪贴板'); } catch (e) { alert('❌ ' + e.message); } }
function importAicsSettings() { const v = window.prompt('粘贴 AI客服配置 JSON（scenes / qa）'); if (!v || !v.trim()) return; chrome.runtime.sendMessage({ action: 'importAiCsConfig', data: { json: v } }).then(r => { if (r && r.ok) { _aics = r.config; renderAiCsSettings(); alert('✅ 导入成功：' + r.imported); } else alert('❌ 导入失败：' + ((r && r.error) || '未知')); }).catch(e => alert('❌ ' + e.message)); }
async function testAics() { const inn = document.getElementById('aicsIn'); const out = document.getElementById('aicsOut'); if (!inn || !out) return; const q = inn.value.trim(); if (!q) return; out.textContent = '路由中…'; try { const r = await chrome.runtime.sendMessage({ action: 'aiCsRespond', data: { incoming: q } }); out.innerHTML = r && r.ok ? ('🎯 ' + _ae(r.category) + ' · ' + (r.mode === 'ai' ? 'AI' : '模板') + '\n' + _ae(r.reply)) : ('❌ ' + _ae((r && r.error) || '失败')); } catch (e) { out.textContent = '❌ ' + e.message; } }
