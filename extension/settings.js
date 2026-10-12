/**
 * settings.js — 设置页面逻辑
 */
'use strict';

// 内嵌进弹窗左栏「设置」（iframe ?embed=1）：隐藏自带侧栏，导航交给弹窗外层那套二级 tab。
// 必须赶在首帧前生效——本文件是 parser-blocking 的尾脚本，在 paint 之前执行，不会闪一下侧栏。
if (/[?&]embed=1/.test(location.search)) document.documentElement.dataset.embed = '1';
// 内嵌时禁用本页的「切换租户」：切换只在弹窗顶栏那个下拉框里做（避免两处入口各切一半）
const _EMBED = document.documentElement.dataset.embed === '1';

// 本会话内是否已完成账号绑定验证（成功即置位，防止验证后仍判断为未验证）
let _accountVerifiedInSession = false;

// ── Tab 切换 ────────────────────────────────────────────────
// 每个 Tab 的一次性加载钩子
const TAB_MOUNT = {};
// 这几个页的正文是 JS 现画的，必须挂在 TAB_MOUNT 上：弹窗左栏是 settingsOpenTab(tab) 直接切，
// 不会点侧栏（内嵌时侧栏本来就看不见），只挂 click 的话那条路会落到一个空 body。
// 函数声明会提升，所以这里放心前引后文的 load*。
TAB_MOUNT.leadtouch = () => loadLeadTouch();
TAB_MOUNT.leadtask = () => loadLeadTask();
TAB_MOUNT.logs = () => loadLogs();
TAB_MOUNT.theme = () => renderThemeSettings();
TAB_MOUNT.guard = () => renderGuardSettings();

async function settingsOpenTab(tab) {
  const item = document.querySelector('.tab-item[data-tab="' + tab + '"]');
  const panel = document.getElementById('tab-' + tab);
  // 有些页的侧栏条目已经撤了（客服话术 / 拟人化与触达——分别在 诊断&配置·线索 里内嵌打开），
  // 这些页只认面板在不在，别再拿侧栏条目当准入条件
  if (!panel) return false;
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  if (item) item.classList.add('active');
  panel.classList.add('active');
  if (location.hash !== '#' + tab) { try { location.hash = tab; } catch (_) {} }
  document.querySelector('.main')?.scrollTo(0, 0);
  // 高级配置弹窗是页面级浮层（不属于哪一页）：切页时收掉，别盖在新页上
  const advModal = document.getElementById('delayAdvModal');
  if (advModal) advModal.style.display = 'none';
  if (TAB_MOUNT[tab]) await TAB_MOUNT[tab]();
  return true;
}
window.settingsOpenTab = settingsOpenTab;

document.querySelectorAll('.tab-item').forEach(item => {
  item.addEventListener('click', () => { settingsOpenTab(item.dataset.tab); });
});

// 深链：弹窗的 ⚙️ / 业务页「去配置」都是 settings.html#aics 这样打开的；
// 已经开着设置页时再点，hash 变化同样触发切页
function _applyHash() {
  const t = (location.hash || '').replace(/^#/, '');
  if (t) settingsOpenTab(t);
}
window.addEventListener('hashchange', _applyHash);
// 首次深链要等整份脚本跑完再切：TAB_MOUNT 里那些 load* 会读本文件后面才声明的 const（DEFAULT_CONFIG 等），
// 解析期就切会撞 TDZ（弹窗里的内嵌页都是带 hash 打开的：settings.html?embed=1#delays …）
window.addEventListener('DOMContentLoaded', _applyHash);

// 问号只管出说明：点在折叠块标题里的问号，别顺手把那个块收起来
document.addEventListener('click', (e) => {
  if (e.target.closest('.qhelp')) { e.preventDefault(); e.stopPropagation(); }
}, true);

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

// ── Storage 读写（直接操作 chrome.storage.local；敏感 key 与 AI Key 字段在此加解密） ───────────
async function getStorage(key) {
  const r = await chrome.storage.local.get(key);
  const raw = r[key];
  if (typeof DataPrivacy === 'undefined' || raw === undefined || raw === null) return raw;
  if (key === 'config') return DataPrivacy.unlockConfig(raw);
  return DataPrivacy.unlock(key, raw);   // 敏感 key 解出明文；其余 key 原样返回
}
async function setStorage(key, value) {
  let v = value;
  if (typeof DataPrivacy !== 'undefined' && value !== undefined && value !== null) {
    v = (key === 'config') ? await DataPrivacy.lockConfig(value) : await DataPrivacy.lock(key, value);
  }
  await chrome.storage.local.set({ [key]: v });
}

// ── 默认配置结构 ─────────────────────────────────────────────
const DEFAULT_CONFIG = {
  product: { name: '我的产品', promoGoal: '', guideText: '', description: '', targetKeywords: [], commentPurpose: '', sellPoints: [], cta: '私信"玄铁剑"领试用版', coverHook: '' },
  myAccountNames: [],
  ai: { apiKey: '', apiBaseUrl: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.5-turbo-32k', temperature: 0.8, maxTokens: 4096, fallbackApiKey: '', fallbackApiBaseUrl: '', fallbackModel: '' },
  scriptStyle: {
    purposeMinChars: 100, purposeMaxChars: 300,
    toneMannerisms: '',
    toneProfile: '',
    toneAnswers: [],
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
// 产品 & 引导 & 同城挡位：整页已撤（2026-09-25 并进「诊断&配置 → 基础配置」；
// 评论区承接 2026-09-25 又搬去「获客 → 任务配置 → 🎯 推广目标」），
// 产品名称/卖点在诊断里维护，这里不再有任何入口与读写
// ══════════════════════════════════════════════════════════════

// 简单复制工具（settings 页无 navigator.clipboard 权限保障时降级）
function copyText(t) {
  return navigator.clipboard ? navigator.clipboard.writeText(t).catch(() => {}) : Promise.resolve();
}

// ══════════════════════════════════════════════════════════════
// AI 配置
// ══════════════════════════════════════════════════════════════
/* AI 服务商 / 模型清单 / 常用模型：都在 lib/ai-providers.js（与弹窗、首次设置向导、后台共用一份） */

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

/* 备用 / 看图模型：提供商切换时同步 Base URL + 模型下拉 */
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
    // 自定义模式：当前模型置顶 + 常用模型快捷选择
    populateCustomModelSelect(savedModel);
  } else {
    document.getElementById('customBaseUrlGroup').style.display = 'none';
    document.getElementById('apiBaseUrlCustom').value = PROVIDER_CONFIG[detectedProvider]?.baseUrl || savedBaseUrl;
    populateModelSelect(detectedProvider, savedModel);
  }

  document.getElementById('temperature').value = String(cfg.ai.temperature ?? 0.8);
  document.getElementById('maxTokens').value = String(cfg.ai.maxTokens || 2000);

  // 备用 / 看图模型
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
  // 服务商域名授权必须在点击手势里、其他 await 之前要（火山方舟没写进 manifest host_permissions）
  const grantedMain = await ensureProviderHostGranted(document.getElementById('apiProvider').value);
  const grantedFb = await ensureProviderHostGranted(document.getElementById('fallbackApiProvider').value);
  const granted = grantedMain && grantedFb;
  const cfg = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
  cfg.ai.apiKey = document.getElementById('apiKey').value.trim();
  const provider = document.getElementById('apiProvider').value;
  if (provider === 'custom') {
    cfg.ai.apiBaseUrl = document.getElementById('apiBaseUrlCustom').value.trim() || 'https://api.deepseek.com/v1';
  } else {
    cfg.ai.apiBaseUrl = PROVIDER_CONFIG[provider]?.baseUrl || 'https://api.deepseek.com/v1';
  }
  cfg.ai.model = document.getElementById('apiModel').value.trim() || 'deepseek-v4-flash';
  // ★ 用户显式保存过模型：自动迁移不再覆盖（尊重手动选择），也不再自动回退旧模型
  cfg.ai._modelLocked = true;
  delete cfg.ai._prevModel;
  cfg.ai.temperature = parseFloat(document.getElementById('temperature').value) || 0.8;
  cfg.ai.maxTokens = parseInt(document.getElementById('maxTokens').value) || 2000;
  // 备用 / 看图模型
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
  showMsg('aiSaveMsg',
    granted ? '✅ 已保存' + (cfg.ai.fallbackApiKey ? '（含备用模型）' : '')
            : '⚠️ 已保存，但服务商域名的访问授权没拿到——调用时会被浏览器拦下（再点一次保存，并在弹窗里选「允许」）',
    granted ? 'ok' : 'err');
});

document.getElementById('testAiBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('testAiBtn');
  const resultEl = document.getElementById('testResult');
  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.style.display = 'none';

  // 域名授权必须在点击手势里、其他 await 之前要（没授权的话下面只会测出「网络错误」）
  const grantedTest = await ensureProviderHostGranted(document.getElementById('apiProvider').value);

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

  // 备用 / 看图模型（若已填）
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
  if (fallback) lines.push(await tryOne('备用（看图）模型', fallback));
  if (!grantedTest) {
    lines.unshift('⚠️ 未拿到该服务商域名的访问授权，下面的失败多半是被浏览器跨域拦下——先点「保存 AI 配置」并在弹窗里选「允许」，再回来测');
  }

  resultEl.style.display = 'block';
  resultEl.className = 'test-result ' + (lines.some(l => l.includes('✅')) ? 'ok' : 'err');
  resultEl.innerHTML = lines.join('<br>');

  btn.disabled = false;
  btn.textContent = '🔌 测试连接';
});

// ══════════════════════════════════════════════════════════════
// 🔔 线索（弹窗「线索」下面的两页）
//   · 设置    #tab-leadtouch ＝ 扫描节奏两件：整轮扫描间隔（多久扫一次新线索）+ 新消息监听（对方刚回早点知道）
//   · 任务配置 #tab-leadtask  ＝ 触达场合（私信 / 通知回访）AI 说话带什么去向：🎙 渠道基调 / 💰 成交引导
//   基调/引导讲的是私信 / 通知回访这类触达场合的承接，可以更直接；评论里的承接在「获客 → 任务配置 → 🎯 推广目标」
// ══════════════════════════════════════════════════════════════
const TR_CH_META = { comment: '💬 评论/回复', like: '👍 点赞/收藏', follow: '👣 关注', ai: '🧠 AI抓回' };
const TR_CH_DESC = {
  comment: '先接住对方评论原话话题，再带一句产品/引导',
  like: '顺着TA赞的话题续下去，再带销售/引导',
  follow: '破冰自我介绍 + 价值预告 + 引导',
  ai: '破冰呼应需求 + 引导',
};
const TR_GUIDE_DEFAULT = '私信我';   // 成交引导留空时的兜底（与后台 handleChannelDraftForPerson 同一口径）

// 本页挂载（#tab-leadtouch）：两件事——整轮扫描间隔 + 新消息监听，保存按钮共用，其余都在 任务配置 那页
async function loadLeadTouch() {
  const sel = document.getElementById('ltScanFreq');
  if (sel) {
    let on = false, iv = 20;
    try {
      on = (await getStorage('prospect_scan_auto')) === true;
      iv = parseInt((await getStorage('prospect_scan_interval_min')) || '20', 10) || 20;
    } catch (_) {}
    sel.value = on ? String(iv) : 'off';
    // 老数据里可能存过 2/10（当年没下限，后台实际按 20 跑）——落不到选项上就显示成 20
    if (sel.selectedIndex < 0) sel.value = '20';
  }
  const mw = document.getElementById('mwFreq');
  if (mw) {
    let on = false, sec = 30;
    try {
      on = (await getStorage('msg_watch_on')) === true;
      sec = parseInt((await getStorage('msg_watch_tick')) || '30', 10) || 30;
    } catch (_) {}
    mw.value = on ? String(sec) : 'off';
    if (mw.selectedIndex < 0) mw.value = '30';   // 后台硬下限 30s，存过更小的值就显示成 30
  }
}

// 落库：两件都走后台唯一入口（写 storage + 排/清闹钟）
document.getElementById('ltSaveBtn')?.addEventListener('click', async () => {
  const sel = document.getElementById('ltScanFreq');
  const on = !!sel && sel.value !== 'off';
  const iv = on ? Math.max(20, parseInt(sel.value, 10) || 20) : 0;
  const mwSel = document.getElementById('mwFreq');
  const mwOn = !!mwSel && mwSel.value !== 'off';
  const mwSec = mwOn ? Math.max(30, parseInt(mwSel.value, 10) || 30) : 0;
  try {
    const r = await chrome.runtime.sendMessage({ action: 'setAutoScanChat', data: { enabled: on, intervalMin: iv } });
    if (!r || r.ok === false) throw new Error((r && r.error) || '保存失败');
    const r2 = await chrome.runtime.sendMessage({ action: 'setMsgWatch', data: { enabled: mwOn, tickSec: mwSec } });
    if (!r2 || r2.ok === false) throw new Error((r2 && r2.error) || '保存失败');
  } catch (e) { showMsg('ltSaveMsg', '❌ ' + (e.message || e), 'err'); return; }
  showMsg('ltSaveMsg', '✅ 已保存', 'ok');
});

// ── 📮 任务配置（#tab-leadtask）：页内四个横 tab（渠道基调 / 成交引导 / 话术配置 / 试问答），一次只显那一节 ──
let _ltTaskSec = 'ch';
function renderLtTaskSec(sec) {
  _ltTaskSec = sec;
  const box = document.getElementById('ltCfgTabs');
  if (box) box.querySelectorAll('[data-sec]').forEach(b => b.classList.toggle('active', b.getAttribute('data-sec') === sec));
  document.querySelectorAll('#tab-leadtask .cfgsec').forEach(d => {
    d.style.display = d.getAttribute('data-sec') === sec ? '' : 'none';
  });
  // 页底那颗「保存」管的是渠道基调与成交引导；话术配置自己带「💾 保存全部」，试问答没有要存的
  const bar = document.querySelector('#tab-leadtask .toolbar');
  if (bar) bar.style.display = (sec === 'ch' || sec === 'guide') ? '' : 'none';
  if (sec === 'qa') mountAiCsBody();
}
document.getElementById('ltCfgTabs')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sec]');
  if (b) renderLtTaskSec(b.getAttribute('data-sec'));
});

async function loadLeadTask() {
  await loadTouchTone();
  renderLtTaskSec(_ltTaskSec);
}

// 当前读到的 aiCs（channels 是整对象覆盖，保存时得把没改的键一起带着）
let _trAiCs = null;
async function loadTouchTone() {
  const box = document.getElementById('trChannels');
  if (!box) return;
  // 渠道基调（四个渠道各干什么，每条可再补一句自己的基调）+ 字数：字数真源是「诊断&配置 → 人设 → 说话风格」，这里只读
  let chars = {};
  try { chars = (deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {})).scriptStyle || {}; } catch (_) { chars = {}; }
  const mn = Number(chars.purposeMinChars) > 0 ? Number(chars.purposeMinChars) : 100;
  const mx = Number(chars.purposeMaxChars) > 0 ? Number(chars.purposeMaxChars) : 300;
  // 成交引导（私信 · 触达用）：存 aiCs.guide，与客服话术库同一份配置
  let guide = {};
  try {
    const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} });
    if (r && r.ok) { _trAiCs = r.config || null; guide = (_trAiCs && _trAiCs.guide) || {}; }
  } catch (_) {}
  const chs = (_trAiCs && _trAiCs.channels) || {};
  // 表格填空（2026-09-25 三十一改）：原来是四张卡（各带一段说明 + 一个输入框），换成一张表——
  // 「渠道 / 系统怎么说 / 你的基调」三列，第三列直接填；说明挪到列头，字数口径挪到表脚
  box.innerHTML =
    '<div class="tr-ch-wrap">' +
      '<table class="tr-ch-table" aria-label="渠道基调">' +
        '<colgroup><col class="tr-ch-c1"><col class="tr-ch-c2"><col class="tr-ch-c3"></colgroup>' +
        '<thead><tr><th scope="col">渠道</th><th scope="col">系统怎么说</th><th scope="col">你的基调</th></tr></thead>' +
        '<tbody>' + Object.keys(TR_CH_META).map(k => {
          const c = chs[k] || {};
          return '<tr>' +
            '<td class="tr-ch-name">' + TR_CH_META[k] + '</td>' +
            '<td class="tr-ch-desc">' + TR_CH_DESC[k] + '</td>' +
            '<td><input type="text" class="tr-ch-tone" data-ch="' + k + '" maxlength="60" value="' + esc(String(c.tone || '')) + '" ' +
            'placeholder="留空＝只用系统那套" title="例：先聊两句家常再谈正事"></td>' +
            '</tr>';
        }).join('') + '</tbody>' +
      '</table>' +
      '<div class="tr-ch-foot">字数跟随「诊断&amp;配置 → 人设 → 说话风格」：<b>' + mn + '~' + mx + '</b> 字（要改去那里，四个渠道一起生效）</div>' +
    '</div>';
  const d = document.getElementById('trGuideDeliver'); if (d) d.value = guide.deliver || TR_GUIDE_DEFAULT;   // 默认「私信我」，看得见的就是会用的
}

// 落库：写进 aiCs.guide + 各渠道 tone（channels 是整对象覆盖，先把读到的原值铺开再改 tone）
async function saveTouchTone() {
  const d = document.getElementById('trGuideDeliver');
  if (!d) return;
  const deliver = (d.value || '').trim();
  const channels = {};
  const src = (_trAiCs && _trAiCs.channels) || {};
  Object.keys(TR_CH_META).forEach(k => {
    const el = document.querySelector('.tr-ch-tone[data-ch="' + k + '"]');
    channels[k] = Object.assign({}, src[k] || {}, { tone: el ? String(el.value || '').trim() : String((src[k] || {}).tone || '') });
  });
  const r = await chrome.runtime.sendMessage({ action: 'saveAiCsConfig', data: { partial: { guide: { deliver, tips: '' }, channels } } });
  if (!r || !r.ok) throw new Error((r && r.error) || '保存失败');
  if (r.config) _trAiCs = r.config;
}

document.getElementById('ltToneSaveBtn')?.addEventListener('click', async () => {
  try { await saveTouchTone(); } catch (e) { showMsg('ltToneMsg', '❌ ' + (e.message || e), 'err'); return; }
  showMsg('ltToneMsg', '✅ 已保存', 'ok');
});

// 内嵌在弹窗里时，本页只留「新建 / 改名 / 删除」，切换当前产品统一走弹窗顶栏下拉框（改的是问号气泡里的字）
function applyTenantIntro() {
  if (!_EMBED) return;
  const intro = document.getElementById('tenantIntro');
  if (intro) intro.setAttribute('data-tip', '一个租户 = 一个产品。这一页负责新建 / 改名 / 删除；切换当前产品请点弹窗顶栏那个下拉框（🏢），切完整套配置、知识库、记录一起换。新建的租户是一张白纸（空知识库 / 默认提示词），建完在顶栏下拉框里选它即可切过去。');
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
// 灌水频率与去重（原「一键灌水 → 灌水规则」页，已并进「拟人化与触达」）：
// 上限存 note_trend_config（与 popup 侧 lib/note-trend.js 共用同一 key 与默认值）；排序/类型归「任务配置·关键词池」，
// 搜索页不再勾「未看过」筛选（去重靠笔记池的冷却/复核）
// ══════════════════════════════════════════════════════════════
const NT_DEFAULT_CONFIG = { maxPerRound: 3, maxPerNote: 2, cooldownHours: 24, checkedHours: 2, scanIntervalMin: 2 };
const NT_EL_IDS = { maxPerRound: 'ntMaxPerRound', maxPerNote: 'ntMaxPerNote', cooldownHours: 'ntCooldownHours', checkedHours: 'ntCheckedHours', scanIntervalMin: 'ntScanIntervalMin' };
// 「每轮最多处理」现在住在「⚙️ 高级配置」弹窗里：主页面那行「每轮处理」在弹窗关着时读这份缓存
let _ntRoundCache = NT_DEFAULT_CONFIG.maxPerRound;

async function loadWaterFreq() {
  try {
    const cfg = Object.assign({}, NT_DEFAULT_CONFIG, (await getStorage('note_trend_config')) || {});
    _ntRoundCache = Math.max(0, parseInt(cfg.maxPerRound, 10) || 0);   // 挡位卡上的「每轮处理 xx 篇」用
    Object.entries(NT_EL_IDS).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.value = cfg[k];
    });
    const aw = (await getStorage('auto_water_config')) || {};
    // 每轮篇数只有一份真源（note_trend_config.maxPerRound）：顺手把运行时的 schedule.perRound 对齐，
    // 免得 UI 显示的篇数与 auto-bot 实际每轮上限是两套老值
    if (Number(aw.schedule && aw.schedule.perRound) !== Number(cfg.maxPerRound)) {
      aw.schedule = aw.schedule || {};
      aw.schedule.perRound = Number(cfg.maxPerRound) || 0;
      await setStorage('auto_water_config', aw);
    }
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
// 停留时间（delay_config：区间随机 min~max，单位毫秒，默认 = 技术下限：能跑通的最快值）
// ══════════════════════════════════════════════════════════════
const DELAY_DEFAULT = { browseDwell: {min:0,max:0}, typingCharDelay: {min:0,max:0}, likeGap: {min:0,max:0}, lazyLoadWait: {min:300,max:300}, retryBackWait: {min:300,max:300}, retryOpenWait: {min:800,max:800}, noteOpenBuffer: {min:300,max:300}, preSendGap: {min:500,max:500}, batchItemGap: {min:0,max:0} };
const DELAY_KEYS = Object.keys(DELAY_DEFAULT);

// ═══ 拟人化挡位（0~5）：表在 lib/delay-presets.js（与弹窗顶部选择器同一张） ═══
// 挡位刻度（0 极速·裸跑 … 5 极致从容）由表渲染，别再手写一份
function renderDelayTicks() {
  const row = document.getElementById('delayTickRow'); if (!row) return;
  row.innerHTML = DELAY_PRESETS.map(p => `<span>${p.level} ${p.short}</span>`).join('');
}

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
  await loadWaterFreq();   // 预计灌完要读「灌水频率与去重 → 每轮最多处理」的值，先填上
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

/* ─── ⚙️ 高级配置弹窗：灌水上限与冷却 / 各环节停留 / 互动行为一起保存 ───
   主页面只留挡位（2026-09-25）：以前这些是平铺的，保存按钮也在页尾，用户看不完也看不懂 */
function openDelayAdv() {
  const m = document.getElementById('delayAdvModal');
  if (!m) return;
  showMsg('delayAdvMsg', '');
  m.style.display = 'flex';
}
function closeDelayAdv() {
  const m = document.getElementById('delayAdvModal');
  if (m) m.style.display = 'none';
}
document.getElementById('delayAdvBtn')?.addEventListener('click', async () => {
  await loadDelayConfig();   // 打开即刷成落盘值（上次没保存的编辑作废，免得看着像存上了）
  openDelayAdv();
});
document.getElementById('delayAdvClose')?.addEventListener('click', closeDelayAdv);
document.getElementById('delayAdvCancel')?.addEventListener('click', closeDelayAdv);
document.getElementById('delayAdvModal')?.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'delayAdvModal') closeDelayAdv();
});

document.getElementById('delayAdvSave')?.addEventListener('click', async () => {
  const cfg = {};
  for (const k of DELAY_KEYS) {
    const mi = parseInt(document.getElementById('dl_' + k + '_min')?.value, 10);
    const ma = parseInt(document.getElementById('dl_' + k + '_max')?.value, 10);
    cfg[k] = { min: Math.max(0, mi || 0), max: Math.max(0, ma || 0) };
  }
  await setStorage('delay_config', cfg);
  // 灌水频率与去重（同一弹窗的上半截；没有一键灌水的版本整块被摘掉，这里读不到就当没填）
  const nt = {};
  Object.entries(NT_EL_IDS).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = parseInt(el.value, 10);
    if (isNaN(v)) return;
    if (k === 'maxPerRound') nt[k] = Math.max(0, v);      // 0=不限：要显式存下来
    else if (v > 0) nt[k] = v;
  });
  if (Object.keys(nt).length) {
    await setStorage('note_trend_config', nt);
    const aw = (await getStorage('auto_water_config')) || {};
    aw.schedule = aw.schedule || {};
    aw.schedule.perRound = Number(nt.maxPerRound) || 0;   // 灌水与循环计划共用这一个每轮篇数
    delete aw.filter; delete aw.coldFilter; delete aw.cycleFilter;   // 老的范围筛选开关已下线（搜索页不再勾「未看过」）
    await setStorage('auto_water_config', aw);
    if (nt.maxPerRound != null) _ntRoundCache = nt.maxPerRound;
  }
  // 互动行为一并保存（Bot 间隔在「线索 → 设置」那页，触达基调在「线索 → 任务配置」那页，各自有自己的保存）
  await setStorage('behavior_config', {
    autoFollow: !!document.getElementById('bhAutoFollow')?.checked,
    followEvery: Math.max(1, parseInt(document.getElementById('bhFollowEvery')?.value, 10) || 1),
  });
  // 逐项改过停留值 → 挡位滑块按「最近的那一档」回正（没改回原样就还是原来那档）
  const lvl = _closestPreset(cfg);
  await setStorage('delay_preset', lvl);
  renderPreset(lvl, cfg);
  showMsg('delayAdvMsg', '✅ 已保存（区间随机，立即生效）', 'ok');
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
const DELAY_PRESET_ROUND_ID = 'ntMaxPerRound';   // 每轮篇数唯一入口（本页「灌水频率与去重」），0=不限
function _presetLevelFromTable(n) { return DELAY_PRESETS.some(p => p.level === n); }
// 当前滑杆挡位（合法返回 0~5，含 0=裸跑；非法则按已填区间就近判定）
function _presetLevel() {
  const v = document.getElementById('delayPreset')?.value;
  const n = (v === '' || v === undefined || v === null) ? NaN : Number(v);
  return _presetLevelFromTable(n) ? n : _closestPreset(_presetCfgFromInputs());
}
// 预计灌完时间（cfg 配置，nr 每轮篇数）→ 秒（单篇=打开+浏览+懒加载+AI估算3s+打字+发前+发后0.7；篇间=条间）
function _estimateRoundSec(cfg, nr) {
  const sec = k => _mid(cfg[k]) / 1000;
  const per = sec('noteOpenBuffer') + sec('browseDwell') + sec('lazyLoadWait') + 3 + sec('typingCharDelay') + sec('preSendGap') + 0.7;
  const r = Math.max(1, Math.floor(nr || 10));
  return per * r + sec('batchItemGap') * (r - 1);
}
// 「每轮最多处理」在「⚙️ 高级配置」里：弹窗关着时读不到输入框，用 loadWaterFreq 缓存的那份
function _roundPerValue() {
  const el = document.getElementById(DELAY_PRESET_ROUND_ID);
  if (el) return Math.max(0, parseInt(el.value, 10) || 0);
  return Math.max(0, parseInt(_ntRoundCache, 10) || 0);
}
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
  if (slider) slider.value = level;
  if (nameEl) nameEl.textContent = '挡位 ' + p.level + ' · ' + p.name;
  if (descEl) descEl.textContent = '每日建议 ' + p.daily + ' 篇 ｜ ' + p.desc;
  const roundVal = _roundPerValue();
  const roundEl = document.getElementById('delayPresetRound');
  if (roundEl) roundEl.textContent = (roundVal <= 0 ? '不限（以每日上限为准）' : '≤ ' + roundVal + ' 篇');
  if (estEl) estEl.textContent = (roundVal > 0 ? _fmtMin(_estimateRoundSec(cfg || _presetCfgFromInputs(), roundVal)) : '每轮不限，无法预估');
}
async function presetOnLoad() {
  renderDelayTicks();
  const saved = (await getStorage('delay_config')) || {};
  const savedLvl = await getStorage('delay_preset');
  let level = (savedLvl != null) ? Number(savedLvl) : _closestPreset(saved);
  if (!_presetLevelFromTable(level)) level = 2;
  renderPreset(level, saved);
}
document.getElementById('delayPreset')?.addEventListener('input', async (e) => {
  const lvl = Number(e.target.value);
  const p = DELAY_PRESETS.find(x => x.level === lvl);
  if (!p) return;
  fillDelayInputs(p.cfg);
  renderPreset(lvl, p.cfg);
  // 拖完即生效：与弹窗顶部那个挡位选择器写同一份真源（delay_preset + delay_config），不必再点保存
  await setStorage('delay_preset', lvl);
  await setStorage('delay_config', p.cfg);
  showMsg('delaySaveMsg', '✅ 已套用 挡位' + lvl + '（' + p.name + '），已生效', 'ok');
});
// 每轮篇数在「⚙️ 高级配置 → 灌水频率与去重」里改：换值后挡位卡上的预计时间跟着重算
document.getElementById(DELAY_PRESET_ROUND_ID)?.addEventListener('input', () => {
  renderPreset(_presetLevel(), _presetCfgFromInputs());
});

// ══════════════════════════════════════════════════════════════
// 初始化
// ══════════════════════════════════════════════════════════════
async function init() {
  applyTenantIntro();
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
    loadAiConfig(),
    loadLogs(),
    loadDelayConfig(),
    loadLeadTouch(),
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

  // 租户模式：三档全开（tenant 恒为 true），不再做灰显锁定

  // 一键灌水（未开通时收起）：节奏/停留全版本都有（① 基础版靠设置页这条兜底改），只有「灌水频率与去重」那半页跟着灌水走
  if (!ed.features || !ed.features.autoWater) {
    document.getElementById('delayWaterFreq')?.remove();
  }

  // 「线索」整片随「线索」走（2026-10-01 五十二改：客服话术也并进了「线索 → 任务配置」，这里不再有独立一页）：
  // 没线索的版本既没有扫新线索（设置），也没有触达场合的基调、引导与问答话术（任务配置）
  if (!ed.features || !ed.features.prospectList) {
    document.getElementById('tab-leadtouch')?.remove();
    document.getElementById('tab-leadtask')?.remove();
  }

  // 拟人化与频率：② 升级版起（随获客开通），入口在 获客 → ⚙️ 设置，
  // 设置页这条侧栏撤掉；没开通获客的档（① 基础版 / 自定义包）留着兜底，否则那档没地方改节奏
  if (ed.features && ed.features.autoWater) {
    document.querySelector('.tab-item[data-tab="delays"]')?.remove();
  }

  // 日常浏览已搬进「获客 → 任务配置 → 🌿 日常浏览」三级 tab（2026-09-26），设置页这一页整块撤掉
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
  // 若被锁 Tab 原本是激活态，改为激活「租户 / 产品」（settings 页里唯一恒在的一页）
  if (tabItem && tabItem.classList.contains('active')) {
    tabItem.classList.remove('active');
    if (panel) panel.classList.remove('active');
    const basicTab = document.querySelector('.tab-item[data-tab="tenant"]');
    const basicPanel = document.getElementById('tab-tenant');
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

async function renderTenantList() {
  const box = document.getElementById('tenantList');
  if (!box) return;
  box.innerHTML = '';
  if (_tenants.length === 0) {
    box.innerHTML = '<div style="color:#999;font-size:12px;">暂无租户</div>';
    return;
  }
  // 预取每个租户的数据量：卖点 / 知识库 / 获客清单（当前租户读活动数据，其余读快照）
  const snapKey = t => 'tenant_data__' + t.id;
  const stats = {};
  for (const t of _tenants) {
    let cfg, kb, pl;
    if (t.id === _currentTenantId) {
      cfg = (await getStorage('config')) || {};
      kb = await getStorage('knowledge_base');
      pl = await getStorage('prospect_list');
    } else {
      const snap = (await getStorage(snapKey(t))) || {};
      const inner = snap[snapKey(t)] || {};
      cfg = await DataPrivacy.unlockConfig(inner.config || {});
      kb = await DataPrivacy.unlock('knowledge_base', inner.knowledge_base);
      pl = await DataPrivacy.unlock('prospect_list', inner.prospect_list);
    }
    stats[t.id] = {
      sell: (cfg.product && Array.isArray(cfg.product.sellPoints)) ? cfg.product.sellPoints.length : 0,
      kb: Array.isArray(kb) ? kb.length : 0,
      pl: Array.isArray(pl) ? pl.length : 0,
    };
  }
  _tenants.forEach(t => {
    const isCur = t.id === _currentTenantId;
    const s = stats[t.id];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;border:1px solid ' +
      (isCur ? 'var(--c-brand)' : '#e0e0e0') + ';border-radius:6px;background:' + (isCur ? 'var(--c-brand-soft)' : '#fff') + ';';
    const left = document.createElement('div');
    left.style.cssText = 'flex:1;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-size:13px;font-weight:500;';
    name.textContent = t.name + (isCur ? '  ✅ 当前' : '');
    left.appendChild(name);
    const stat = document.createElement('div');
    stat.style.cssText = 'font-size:11px;color:#888;margin-top:2px;display:flex;gap:10px;flex-wrap:wrap;';
    stat.innerHTML =
      '<span title="产品卖点数">🏷️ <b style="color:' + (s.sell > 0 ? 'var(--c-brand-text)' : '#bbb') + '">' + s.sell + '</b> 卖点</span>' +
      '<span title="知识库条目数">📚 <b style="color:' + (s.kb > 0 ? 'var(--c-brand-text)' : '#bbb') + '">' + s.kb + '</b> 知识库</span>' +
      '<span title="获客清单人数">👥 <b style="color:' + (s.pl > 0 ? 'var(--c-brand-text)' : '#bbb') + '">' + s.pl + '</b> 获客</span>';
    left.appendChild(stat);
    row.appendChild(left);

    if (!isCur && !_EMBED) {
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
    showMsg('tenantSaveMsg', '✅ 已新建「' + name + '」' + (_EMBED ? '，到弹窗顶栏下拉框里选它即可切过去' : '，点“切换”可切到该产品'), 'ok');
  } catch (e) {
    showMsg('tenantSaveMsg', '❌ ' + (e.message || e), 'err');
  }
});

// 日志 / AI客服 的刷新都挂 TAB_MOUNT（见文件头），这里不再重复挂 click

// ═══════════ AI客服：设置镜像（场景A + 问答B + 导入导出 + 试问答） ═══════════
let _aics = null;
const _ae = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ═══════════ 整机备份 / 恢复（导出全部租户 + 运行数据 / 合并导入） ═══════════
TAB_MOUNT.backup = renderBackup;

function renderBackup() {
  const box = document.getElementById('backupBody'); if (!box) return;
  box.innerHTML = `
    <div style="background:var(--c-brand-soft);border:1px solid var(--c-brand-line);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--c-brand-ink);line-height:1.7;margin-bottom:12px;">
      ⚠️ 备份文件包含 <b>API Key、账号绑定信息、获客清单/私信历史</b> 等敏感数据，导出时用你设置的<b>口令整体加密</b>，恢复时要输入同一口令；<b>口令无法找回</b>，请连同文件一起妥善保存、不要外传。
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button id="backupExport" style="font-size:13px;padding:10px 18px;border:none;border-radius:8px;background:var(--c-brand);color:var(--c-brand-on);cursor:pointer;font-weight:600;">⬇ 整机导出（所有产品 · 加密）</button>
      <button id="backupImport" style="font-size:13px;padding:10px 18px;border:1px solid #0e7490;background:#ecfeff;color:#0e7490;border-radius:8px;cursor:pointer;font-weight:600;">⬆ 整机导入（合并保留）</button>
      <input type="file" id="backupFile" accept=".json,application/json" style="display:none;">
    </div>
    <div id="backupMsg" style="font-size:12px;color:#0a7b5a;margin-top:10px;"></div>
    <label style="display:flex;align-items:flex-start;gap:6px;font-size:12px;color:#555;margin-top:10px;cursor:pointer;line-height:1.7;">
      <input type="checkbox" id="backupNoThumb" style="margin:3px 0 0;">
      <span><b>不含素材缩略图</b>：备份小一点——素材库里「我传的本机图」只留文件名，不带走那张 ≤160px 的预览小图（原图本来就不在库里，导入后重新传一张就能看回预览）。</span>
    </label>
    <div style="font-size:12px;color:#888;margin-top:10px;line-height:1.8;">导出（加密）：把<b>所有产品(租户)</b>的完整配置 + 获客清单/私信历史/已灌水/内容规划打成一份<b>口令加密</b>的文件。<br>导入（合并保留）：备份数据<b>并入</b>本地——备份里的配置会覆盖本地同名 key，本地独有的产品保留，备份里的新产品追加进来，不会清空现有配置。适合换版本/换机后还原（也支持早期未加密的旧备份）。</div>`;
  document.getElementById('backupExport')?.addEventListener('click', backupExport);
  document.getElementById('backupImport')?.addEventListener('click', () => { document.getElementById('backupFile')?.click(); });
  document.getElementById('backupFile')?.addEventListener('change', backupImportFile);
}

async function backupExport() {
  const msg = document.getElementById('backupMsg'); if (msg) msg.textContent = '正在打包全部数据…';
  const noThumb = !!(document.getElementById('backupNoThumb') || {}).checked;
  try {
    const r = await chrome.runtime.sendMessage({ action: 'exportAllData', data: { noThumb } });
    if (!r || !r.ok) throw new Error((r && r.error) || '导出失败');
    const pw = await CryptoBox.askPassword({
      title: '设置导出加密口令',
      hint: '备份文件包含 API Key、获客清单、私信与评论记录，将用这个口令整体加密。<b>口令无法找回</b>，请自行记牢；恢复时要用同一个口令。',
      okText: '加密导出', confirm: true,
    });
    if (!pw.ok) { if (msg) msg.textContent = ''; return; }
    const enc = await CryptoBox.encryptFile(JSON.stringify(r.backup), pw.password);
    const blob = new Blob([enc], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'xhs-ai-backup-' + new Date().toISOString().slice(0, 10) + '.enc.json';
    a.click(); URL.revokeObjectURL(a.href);
    if (msg) {
      const sm = (r.backup && r.backup.summary) || {};
      const lines = Object.entries(sm).map(([name, s]) =>
        `${name}：卖点${s.卖点数} · 话术库${s.话术库条数} · 知识库${s.知识库条数} · 获客${s.获客清单数} · 笔记档案${s.笔记档案数}` +
        (s.素材数 ? ` · 素材${s.素材数}` : '')).join('；');
      msg.textContent = '✅ 已加密导出 ' + (r.backup.tenants.length) + ' 个产品的完整备份' +
        (lines ? '　（' + lines + '）' : '') + (noThumb ? '　· 素材缩略图未含' : '') + '，请连同口令一起妥善保存。';
      msg.style.color = '#0a7b5a';
    }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 导出失败：' + (e.message || e); } }
}

async function backupImportFile(e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  const msg = document.getElementById('backupMsg'); if (msg) msg.textContent = '读取备份文件…';
  const raw = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(new Error('读取失败')); r.readAsText(file, 'utf-8'); });
  let text = raw;
  if (CryptoBox.isFileEnvelope(raw)) {
    const pw = await CryptoBox.askPassword({
      title: '输入备份口令',
      hint: '这个备份是加密文件，请输入导出时设置的口令。',
      okText: '解密导入',
    });
    if (!pw.ok) { if (msg) msg.textContent = ''; e.target.value = ''; return; }
    if (msg) msg.textContent = '解密中…';
    try { text = await CryptoBox.decryptFile(raw, pw.password); }
    catch (err) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (err.message || err); } e.target.value = ''; return; }
  }
  let backup;
  try { backup = JSON.parse(text); } catch (_) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 文件不是合法的 JSON 备份'; } e.target.value = ''; return; }
  if (!backup || !backup.tenants || !backup.data) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 不是有效的备份文件（缺 tenants/data）'; } e.target.value = ''; return; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'importAllData', data: { backup } });
    if (r && r.ok) { if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 导入完成：合并 ' + r.importedTenants + ' 个备份产品，本地现有 ' + r.tenants + ' 个产品已保留。'; } if (msg) msg.textContent += ' 刷新页面以加载全部数据…'; setTimeout(function () { location.reload(); }, 900); }
    else if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 导入失败：' + ((r && r.error) || '未知'); }
  } catch (err) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 导入失败：' + (err.message || err); } }
  e.target.value = '';
}

/* 切到「🗨 话术配置」那一 tab 才画；画过一次就复用（每次重画会把没点保存的编辑冲掉，也多烧一次读盘） */
let _aicsMounted = false;
function mountAiCsBody() {
  if (_aicsMounted && document.getElementById('aicsQa')) { paintAicsQa(); return; }
  _aicsMounted = true;
  renderAiCsSettings();
}
async function renderAiCsSettings() {
  const box = document.getElementById('aicsBody'); if (!box) return;
  box.innerHTML = '<div style="padding:20px;color:#888;">加载 AI客服配置…</div>';
  let cfg;
  try { const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} }); if (!r || !r.ok) throw new Error((r && r.error) || '读取失败'); cfg = r.config; }
  catch (e) { box.innerHTML = '<div style="color:#d33;">❌ ' + _ae(e.message) + '</div>'; return; }
  _aics = cfg;
  box.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
      <button id="aicsSave" style="font-size:12px;padding:6px 14px;border:none;border-radius:8px;background:var(--c-brand);color:var(--c-brand-on);cursor:pointer;font-weight:600;">💾 保存全部</button>
      <button id="aicsAdd" style="font-size:12px;padding:6px 12px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;cursor:pointer;">➕ 新增一条</button>
      <button id="aicsExport" style="font-size:12px;padding:6px 12px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;cursor:pointer;">⬇ 导出</button>
      <button id="aicsImport" style="font-size:12px;padding:6px 12px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;cursor:pointer;">⬆ 导入</button>
    </div>
    <div style="font-weight:600;font-size:13px;margin:4px 0 6px;">客户问答话术库</div>
    <div id="aicsQa"></div>
    <!-- 一条话术的编辑弹窗：列表页只负责看，改/新增都收在这里（改完先在内存里，点「💾 保存全部」才落盘） -->
    <div class="modal" id="aicsQaModal" style="display:none;">
      <div class="modal-box" style="width:560px;">
        <div class="modal-header">
          <h3 id="aicsQaModalTitle">编辑话术</h3>
          <button class="modal-close" id="aicsQaModalClose" title="关闭">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:10px;">
          <div>
            <label style="font-size:12px;color:#555;">分类</label>
            <input type="text" id="aicsQaCat" placeholder="例：发货 / 售后" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:6px;margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px;color:#555;">触发关键词<span style="font-size:11px;color:#999;"> · 逗号分隔</span></label>
            <input type="text" id="aicsQaKw" placeholder="例：发货，几天到，物流" style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:6px;margin-top:4px;">
          </div>
        </div>
        <div style="margin-top:10px;">
          <label style="font-size:12px;color:#555;">话术<span style="font-size:11px;color:#999;"> · 客户这么问时回什么</span></label>
          <textarea id="aicsQaAns" rows="6" placeholder="用客服口吻写清楚：先答问题，再给下一步。" style="width:100%;box-sizing:border-box;padding:8px;font-size:13px;line-height:1.7;border:1px solid #ddd;border-radius:6px;margin-top:4px;resize:vertical;"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px;">
          <div>
            <label style="font-size:12px;color:#555;">模式</label>
            <select id="aicsQaMode" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:6px;margin-top:4px;">
              <option value="template">模板（按话术原样回）</option>
              <option value="ai">AI（照意思重新组织）</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#555;">处理</label>
            <select id="aicsQaAuto" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid #ddd;border-radius:6px;margin-top:4px;">
              <option value="draft">草拟（等你确认）</option>
              <option value="auto">自动（直接发）</option>
              <option value="off">关闭（只记录）</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#555;">启用</label>
            <div style="margin-top:8px;"><label style="font-size:12px;color:#333;cursor:pointer;"><input type="checkbox" id="aicsQaOn"> 参与匹配</label></div>
          </div>
        </div>
        <div class="modal-footer" style="align-items:center;">
          <span id="aicsQaModalMsg" style="flex:1;font-size:12px;color:#d33;"></span>
          <button class="btn" id="aicsQaModalCancel" style="font-size:12px;padding:6px 12px;border:1px solid #dfe3ea;border-radius:8px;background:#fff;cursor:pointer;">取消</button>
          <button class="btn-primary" id="aicsQaModalOk" style="font-size:12px;padding:6px 14px;border:none;border-radius:8px;background:var(--c-brand);color:var(--c-brand-on);cursor:pointer;font-weight:600;">💾 保存这条</button>
        </div>
      </div>
    </div>`;
  paintAicsQa();
  document.getElementById('aicsSave')?.addEventListener('click', saveAicsSettings);
  document.getElementById('aicsAdd')?.addEventListener('click', () => {
    _aics.qa = Array.isArray(_aics.qa) ? _aics.qa : [];
    openAicsQaModal(-1);
  });
  document.getElementById('aicsExport')?.addEventListener('click', () => exportAicsSettings());
  document.getElementById('aicsImport')?.addEventListener('click', () => importAicsSettings());
  const inn = document.getElementById('aicsIn');
  inn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); testAics(); } });
  document.getElementById('aicsTest')?.addEventListener('click', () => testAics());
  document.getElementById('aicsChatClear')?.addEventListener('click', () => { _aicsChat = []; paintAicsChat(); });
  paintAicsChat();
  document.getElementById('aicsQaModalClose')?.addEventListener('click', closeAicsQaModal);
  document.getElementById('aicsQaModalCancel')?.addEventListener('click', closeAicsQaModal);
  document.getElementById('aicsQaModal')?.addEventListener('click', (ev) => { if (ev.target && ev.target.id === 'aicsQaModal') closeAicsQaModal(); });
  document.getElementById('aicsQaModalOk')?.addEventListener('click', saveAicsQaModal);
}

/* 话术库列表：一条一行卡片（分类 + 关键词 + 模式·处理 + 启用 + 编辑/删除），正文截断预览；
   改与新增都进弹窗，这里不铺表单 */
const AICS_QA_MODE = { template: '模板', ai: 'AI' };
const AICS_QA_AUTO = { draft: '草拟', auto: '自动', off: '关闭' };
function paintAicsQa() {
  const box = document.getElementById('aicsQa'); if (!box) return;
  const qa = (_aics && Array.isArray(_aics.qa)) ? _aics.qa : [];
  if (!qa.length) {
    box.innerHTML = '<div style="border:1px dashed #dfe3ea;border-radius:8px;padding:18px;text-align:center;color:#999;font-size:12px;">还没有客服话术——点上方「➕ 新增一条」加一条，或用「⬆ 导入」载入一份话术库。</div>';
    return;
  }
  box.innerHTML =
    '<div style="font-size:11px;color:#888;margin:0 0 8px;line-height:1.7;">共 ' + qa.length + ' 条'
      + '<span class="qhelp" tabindex="0" data-tip="模式＝「模板」按话术原样回、「AI」照意思重新组织；处理＝「草拟」等你确认、「自动」直接发、「关闭」只记录不回。" style="margin:0 5px;">?</span>'
      + '<b>改动先在本地，点上方「💾 保存全部」才生效。</b></div>' +
    qa.map((e, i) => {
      const kws = Array.isArray(e.keywords) ? e.keywords.filter(Boolean) : [];
      const off = e.enabled === false;
      const ans = String(e.answer || '').replace(/\s+/g, ' ').trim();
      return `<div class="aics-row" data-i="${i}" style="border:1px solid var(--c-line);border-radius:10px;background:${off ? '#fbfbfc' : 'var(--c-surface)'};padding:9px 11px;margin-bottom:8px;${off ? 'opacity:.62;' : ''}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:13px;color:#1f2937;">${_ae(e.category || '未命名')}</span>
          ${kws.length
            ? kws.map(k => `<span style="font-size:11px;color:#4b5563;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:1px 6px;">${_ae(k)}</span>`).join('')
            : '<span style="font-size:11px;color:#c7ccd4;">没填触发关键词</span>'}
          <span style="font-size:11px;color:${e.auto === 'auto' ? '#0a7b5a' : '#6b7280'};background:${e.auto === 'auto' ? '#ecfdf5' : '#f3f4f6'};border-radius:6px;padding:1px 6px;">${AICS_QA_MODE[e.mode] || '模板'} · ${AICS_QA_AUTO[e.auto] || '草拟'}</span>
          <span style="flex:1;"></span>
          <label style="font-size:11px;color:#555;cursor:pointer;user-select:none;"><input type="checkbox" class="aics-qa-on" data-i="${i}" ${off ? '' : 'checked'}> 启用</label>
          <button class="aics-qa-edit" data-i="${i}" style="font-size:11px;padding:3px 9px;border:1px solid #dfe3ea;border-radius:6px;background:#fff;cursor:pointer;">✏️ 编辑</button>
          <button class="aics-qa-del" data-i="${i}" title="删掉这条" style="border:none;background:none;color:#d32f2f;cursor:pointer;padding:2px;font-size:13px;">🗑</button>
        </div>
        <div style="font-size:12px;color:#374151;line-height:1.7;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${_ae(e.answer || '')}">${ans ? _ae(ans) : '<span style="color:#c7ccd4;">还没写话术</span>'}</div>
      </div>`;
    }).join('');
  box.querySelectorAll('.aics-qa-on').forEach(c => c.addEventListener('change', () => {
    const i = parseInt(c.dataset.i, 10);
    if (!_aics.qa[i]) return;
    _aics.qa[i].enabled = !!c.checked;
    paintAicsQa();
  }));
  box.querySelectorAll('.aics-qa-edit').forEach(b => b.addEventListener('click', () => openAicsQaModal(parseInt(b.dataset.i, 10))));
  box.querySelectorAll('.aics-qa-del').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.i, 10);
    const e = _aics.qa[i] || {};
    if (!confirm('删掉「' + (e.category || '未命名') + '」这条话术？（点「💾 保存全部」后彻底生效）')) return;
    _aics.qa.splice(i, 1);
    paintAicsQa();
  }));
}

/* i < 0 ＝ 新增 */
function openAicsQaModal(i) {
  const modal = document.getElementById('aicsQaModal'); if (!modal) return;
  const add = i < 0;
  const e = add ? { category: '', keywords: [], mode: 'template', auto: 'draft', enabled: true, answer: '' } : (_aics.qa[i] || {});
  modal.dataset.i = String(add ? -1 : i);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const title = document.getElementById('aicsQaModalTitle');
  if (title) title.textContent = add ? '➕ 新增话术' : '✏️ 编辑话术';
  set('aicsQaCat', String(e.category || ''));
  set('aicsQaKw', (Array.isArray(e.keywords) ? e.keywords : []).join('，'));
  set('aicsQaAns', String(e.answer || ''));
  set('aicsQaMode', e.mode === 'ai' ? 'ai' : 'template');
  set('aicsQaAuto', AICS_QA_AUTO[e.auto] ? e.auto : 'draft');
  const on = document.getElementById('aicsQaOn'); if (on) on.checked = e.enabled !== false;
  const msg = document.getElementById('aicsQaModalMsg'); if (msg) msg.textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('aicsQaCat')?.focus(), 30);
}
function closeAicsQaModal() {
  const modal = document.getElementById('aicsQaModal');
  if (modal) modal.style.display = 'none';
}
function saveAicsQaModal() {
  const modal = document.getElementById('aicsQaModal'); if (!modal) return;
  const msg = document.getElementById('aicsQaModalMsg');
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '') : ''; };
  const answer = val('aicsQaAns').trim();
  if (!answer) { if (msg) msg.textContent = '话术不能空着——客户这么问时回什么，得写一句。'; return; }
  const i = parseInt(modal.dataset.i, 10);
  const prev = (i >= 0 && _aics.qa[i]) ? _aics.qa[i] : {};
  const next = {
    id: prev.id || ('qa_' + Date.now()),
    category: val('aicsQaCat').trim() || '未命名',
    keywords: val('aicsQaKw').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean),
    mode: val('aicsQaMode') === 'ai' ? 'ai' : 'template',
    auto: AICS_QA_AUTO[val('aicsQaAuto')] ? val('aicsQaAuto') : 'draft',
    enabled: !!(document.getElementById('aicsQaOn') || {}).checked,
    answer,
  };
  _aics.qa = Array.isArray(_aics.qa) ? _aics.qa : [];
  if (i >= 0 && _aics.qa[i]) _aics.qa[i] = next; else _aics.qa.push(next);
  closeAicsQaModal();
  paintAicsQa();
}
function gatherAicsSettings() {
  // 渠道基调 / 成交引导已搬到「线索 → 任务配置」（settings 页 #tab-leadtask），这里只管问答话术库；
  // scenes 是触达场景的排期配置（私信触发用），本页没有界面，原样带着走别弄丢。
  // qa 由列表的启停开关与编辑弹窗直接写进 _aics.qa，这里只做规范化兜底
  const scenes = _aics.scenes || {};
  const qa = (Array.isArray(_aics.qa) ? _aics.qa : []).map((e, i) => ({
    id: e.id || ('qa_' + i),
    category: String(e.category || '').trim() || '未命名',
    keywords: (Array.isArray(e.keywords) ? e.keywords : []).map(k => String(k || '').trim()).filter(Boolean),
    mode: e.mode === 'ai' ? 'ai' : 'template',
    auto: AICS_QA_AUTO[e.auto] ? e.auto : 'draft',
    enabled: e.enabled !== false,
    answer: String(e.answer || ''),
  }));
  return { scenes, qa };
}
async function saveAicsSettings() {
  try { const r = await chrome.runtime.sendMessage({ action: 'saveAiCsConfig', data: { partial: gatherAicsSettings() } }); if (r && r.ok) { _aics = r.config; alert('✅ AI客服配置已保存'); } else alert('❌ 保存失败：' + ((r && r.error) || '未知')); }
  catch (e) { alert('❌ 保存失败：' + e.message); }
}
async function exportAicsSettings() {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} });
    const t = JSON.stringify((r && r.config) || {}, null, 2);
    const blob = new Blob([t], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aics_config_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    alert('✅ 已下载 AI客服配置为 JSON 文件（导入时可直接粘贴该文件内容，或到后台「提示词/知识库」用文件导入）');
  } catch (e) { alert('❌ ' + e.message); }
}
function importAicsSettings() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.style.display = 'none'; document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const val = String(rd.result || '');
        JSON.parse(val);
        chrome.runtime.sendMessage({ action: 'importAiCsConfig', data: { json: val } }).then(r => { if (r && r.ok) { _aics = r.config; renderAiCsSettings(); alert('✅ 导入成功：' + r.imported); } else alert('❌ 导入失败：' + ((r && r.error) || '未知')); }).catch(e => alert('❌ ' + e.message));
      } catch (_) { alert('❌ 导入失败：不是合法的 JSON 文件'); }
    };
    rd.onerror = () => alert('❌ 导入失败：文件读取错误');
    rd.readAsText(file, 'utf-8');
  });
  input.click();
}
/* 试问答＝会话形式（老板：「多次问，多次答的」）：一问一答各一条气泡，记录在本页留着方便对比，
   改完话术回来接着问，不用重开一页。只试不发——走的还是 aiCsRespond 那条路由。 */
let _aicsChat = [];
function paintAicsChat() {
  const box = document.getElementById('aicsChat'); if (!box) return;
  if (!_aicsChat.length) { box.innerHTML = '<div style="font-size:12px;color:#999;">还没有对话——在下面输入一句客户可能说的话，点「发送」。</div>'; return; }
  box.innerHTML = _aicsChat.map(function (row) {
    const mine = row.role === 'me';
    return '<div style="align-self:' + (mine ? 'flex-end' : 'flex-start') + ';max-width:82%;' +
      'padding:6px 10px;border-radius:10px;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;' +
      (mine ? 'background:var(--c-brand-soft,#fdecef);color:#333;' : 'background:#fff;border:1px solid #e3e7f0;color:#333;') + '">' +
      (mine ? '' : '<span style="color:#98a2b3;font-size:11px;">' + (row.tag ? _ae(row.tag) + ' · ' : '') + '</span>') +
      _ae(row.text) + '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}
async function testAics() {
  const inn = document.getElementById('aicsIn'); const box = document.getElementById('aicsChat');
  if (!inn || !box) return;
  const q = inn.value.trim(); if (!q) return;
  if (_aicsChat.some(function (r) { return r.pending; })) return;
  _aicsChat.push({ role: 'me', text: q });
  _aicsChat.push({ role: 'bot', text: '路由中…', pending: true });
  inn.value = '';
  paintAicsChat();
  try {
    const r = await chrome.runtime.sendMessage({ action: 'aiCsRespond', data: { incoming: q } });
    const last = _aicsChat[_aicsChat.length - 1];
    last.pending = false;
    if (r && r.ok) { last.tag = '🎯 ' + (r.category || '未分类') + ' · ' + (r.mode === 'ai' ? 'AI' : '模板'); last.text = r.reply || '（空应答）'; }
    else { last.tag = '失败'; last.text = '❌ ' + ((r && r.error) || '失败'); }
  } catch (e) {
    const last = _aicsChat[_aicsChat.length - 1];
    last.pending = false; last.tag = '失败'; last.text = '❌ ' + e.message;
  }
  paintAicsChat();
}


/* ── 界面主题（🎨 tab）────────────────────────────────────────
   配色本身在 theme.js（预设表 + 由基色推浅底/淡边/悬停深一档）。
   这一页只负责「选」：点预设或填一个自定义色 → Theme.save() → 本页立刻变，
   已经开着的弹窗 / 字效编辑器靠 chrome.storage.onChanged 自己跟上，不用重开。
   主题值存在 ui_theme（在 lib/tenant.js 的 TENANT_SCOPED_KEYS 里：跟着租户走，也进备份）。 */
let _themeWired = false;
function _themeMsg(txt, kind) { showMsg('themeSaveMsg', txt, kind || 'ok'); }

async function renderThemeSettings() {
  const box = document.getElementById('themePresets');
  if (!box || typeof Theme === 'undefined') return;
  _themeWire();
  const cur = await Theme.read();
  const card = (id, dot, name, desc, on) =>
    '<button type="button" class="theme-card' + (on ? ' on' : '') + '" data-t="' + esc(id) + '" title="' + esc(desc) + '">' +
      '<span class="tc-dot" style="background:' + esc(dot) + ';"></span>' +
      '<span class="tc-n">' + esc(name) + '</span>' +
      '<span class="tc-hex">' + esc(dot) + '</span>' +
      (on ? '<span class="tc-cur">✓ 在用</span>' : '') +
    '</button>';
  box.innerHTML = Theme.PRESETS.map(p => card(p.id, p.brand, p.name, p.desc, cur.preset === p.id)).join('') +
    (cur.preset === 'custom' ? card('custom', String(cur.custom || '#1f2329'), '自定义', '自己填的那个色', true) : '');
  // 自定义那两格回填当前色（当前是预设时回填该预设的基色，方便在以它为基础微调）
  const col = document.getElementById('themeCustomColor');
  const hex = document.getElementById('themeCustomHex');
  if (col && hex) {
    const v = (cur.preset === 'custom' && cur.custom) ? String(cur.custom) : (Theme.presetOf(cur.preset) || Theme.presetOf(Theme.DEFAULT)).brand;
    col.value = v; hex.value = v;
  }
}

async function applyThemePreset(id) {
  const cur = await Theme.read();
  await Theme.save({ preset: id, custom: String(cur.custom || '') });
  _themeMsg(id === 'custom' ? '已用自定义色' : '已换成「' + ((Theme.presetOf(id) || {}).name || id) + '」');
  renderThemeSettings();
}

async function applyThemeCustom() {
  const hexEl = document.getElementById('themeCustomHex');
  const m = /^#?([0-9a-f]{6})$/i.exec(String((hexEl && hexEl.value) || '').trim());
  if (!m) { _themeMsg('色值要写成 #rrggbb（例：#4f46e5）', 'err'); return; }
  const hex = '#' + m[1].toLowerCase();
  await Theme.save({ preset: 'custom', custom: hex });
  _themeMsg('已用色值 ' + hex);
  renderThemeSettings();
}

function _themeWire() {
  if (_themeWired) return;
  const panel = document.getElementById('tab-theme');
  if (!panel) return;
  _themeWired = true;
  panel.addEventListener('click', (e) => {
    const c = e.target.closest('.theme-card');
    if (c) { applyThemePreset(c.dataset.t); return; }
    if (e.target.closest('#themeCustomBtn')) { applyThemeCustom(); return; }
    if (e.target.closest('#themeResetBtn')) { applyThemePreset(Theme.DEFAULT); return; }
  });
  const col = document.getElementById('themeCustomColor');
  const hex = document.getElementById('themeCustomHex');
  if (col && hex) {
    // 挑色器松手就存（不搞「先预览再确认」——多一步反而要用户记着点保存）
    col.addEventListener('change', () => { hex.value = col.value; applyThemeCustom(); });
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyThemeCustom(); });
  }
}

/* ── 🛡 账号安全（镜像 demo ?v=63）：总挡位 / 额度墙 / 静默期 / 单休 / 体检卡 ──
   真源在 lib/account-guard.js（后台闹钟与各自动化的执行闸读同一份账本）；
   本页只做「看与调」：点挡位卡 / 点休息日 / 记体检卡 → AccountGuard.saveCfg / record。 */
const GD_ROWS = [
  ['open', '📖 打开 / 浏览笔记'], ['like', '👍 点赞'], ['save', '⭐ 收藏'],
  ['comment', '💬 评论 + 回复'], ['follow', '➕ 关注'], ['dm', '✉️ 私信'],
  ['post', '📝 发笔记'],
];
// 周一..周日 的显示序；dow 是 JS getDay()（0=周日）
const GD_DAYS = [['周一', 1], ['周二', 2], ['周三', 3], ['周四', 4], ['周五', 5], ['周六', 6], ['周日', 0]];
let _gdRecKind = '警告';
let _gdWired = false;

function _gdActText(r) {
  if (r.floor) return r.kind === '处罚' ? '已在最保守档——建议先把自动化停几天' : '已在最保守档——再收就是停一停（建议手动全停几天）';
  if (r.kind === '处罚') return '挡位已自动落到「保守」（原「' + r.before + '」）';
  return '挡位已自动降一级：「' + r.before + '」→「' + r.after + '」';
}

async function renderGuardSettings() {
  const box = document.getElementById('guardBody');
  if (!box) return;
  if (typeof AccountGuard === 'undefined') { box.innerHTML = '<div class="empty-tip">账号安全组件没加载上，刷新一下这页试试。</div>'; return; }
  _gdWire();
  const st = await AccountGuard.status();
  const cards = AccountGuard.LEVELS.map(l => {
    const on = l.name === st.level;
    const c = l.cap;
    return '<div class="gd-card' + (on ? ' on' : '') + '" data-level="' + esc(l.name) + '">' +
      '<div class="gd-name">' + (on ? '✅ ' : '') + esc(l.name) + '</div>' +
      '<div class="gd-tag">' + esc(l.sub) + '</div>' +
      '<div class="gd-nums">📖 打开 ' + c.open + ' · 👍 点赞 ' + c.like + ' · ⭐ 收藏 ' + c.save + '<br>💬 评论+回复 ' + c.comment + ' · ➕ 关注 ' + c.follow + '<br>✉️ 私信 ' + c.dm + ' · 📝 发笔记 ' + c.post + '</div></div>';
  }).join('');
  const byKind = {};
  st.rows.forEach(r => { byKind[r.kind] = r; });
  const wall = GD_ROWS.map(row => {
    const r = byKind[row[0]] || { used: 0, cap: 0 };
    const raw = r.used || 0, cap = r.cap || 0;
    const full = cap > 0 && raw >= cap;
    const pct = cap > 0 ? Math.min(100, Math.round(raw / cap * 100)) : 0;
    const cls = full ? ' full' : (pct >= 80 ? ' hot' : '');
    return '<div class="gd-wallrow"><div class="wl">' + row[1] + '</div>' +
      '<div class="gd-bar"><i class="gd-fill' + cls + '" style="width:' + (full ? 100 : pct) + '%;"></i></div>' +
      '<div class="wn' + (full ? ' full' : '') + '">' + raw + ' / ' + cap + (full ? ' · 停手' : ' · 余 ' + (cap - raw)) + '</div></div>';
  }).join('');
  const days = GD_DAYS.map(d => '<button type="button" class="gd-day' + (d[1] === st.rest.day ? ' rest' : '') + '" data-dow="' + d[1] + '">' + d[0] + (d[1] === st.rest.day ? ' · 休' : '') + '</button>').join('');
  const health = st.health.slice().reverse();
  const recs = health.length ? health.map(r =>
    '<div class="gd-rec"><div class="rt">' + esc(r.t) + '<span class="rk ' + (r.kind === '处罚' ? 'rk-pun' : 'rk-warn') + '">' + esc(r.kind) + '</span></div>' +
    '<div class="rn">' + esc(r.note || '（没写详情）') + '</div>' +
    '<div class="ra ' + (r.floor ? 'floor' : 'down') + '">' + esc(_gdActText(r)) + '</div></div>').join('')
    : '<div class="gd-note" style="margin-top:2px;">还没记过——收到平台的警告 / 限流 / 处罚时，来这儿记一笔（挡位会自动收紧）。</div>';
  box.innerHTML =
    '<div class="gd-wrap">' +
    '<div class="gd-sec"><h4>① 总挡位 · 点一张卡＝那天所有自动化的合计上限</h4>' +
    '<div class="gd-cards">' + cards + '</div>' +
    '<div class="gd-wave">今日额度 ＝ 挡位基准 × <b>今日波动 ' + st.wave.toFixed(1) + '</b>（每天凌晨随机抽 0.6~1.0——同样「' + esc(st.level) + '」，有的日子只跑六成。）</div>' +
    '<div id="gdSaveMsg" class="save-msg"></div></div>' +
    '<div class="gd-sec"><h4>② 今天各动作还剩多少（一天合计：灌水 / 获客 / 截流 / 日常浏览 / 私信 / 发笔记…一起算）</h4>' + wall +
    '<div class="gd-note">到量就停手、剩下的等明天——各功能不再各算各的，合计封顶。</div></div>' +
    '<div class="gd-sec"><h4>🌙 静默期 21:00 – 09:00 · 一律不跑</h4>' +
    '<div class="gd-tl"><span class="seg-off" style="flex:0 0 37.5%;"></span><span class="seg-on" style="flex:1;"></span><span class="seg-off" style="flex:0 0 12.5%;"></span></div>' +
    '<div class="gd-tlx"><span style="left:0;">00:00</span><span style="left:37.5%;transform:translateX(-50%);">09:00 · 开工（再随机等 0~40 分钟才动）</span><span style="left:87.5%;transform:translateX(-50%);">21:00 · 收工</span><span style="right:0;">24:00</span></div>' +
    '<div class="gd-note">到 21:00 自动停下，早上 9 点前一律不动。<b>发布队列到点撞上静默期 → 自动顺延到第二天 9 点后</b>（工作台回执注明「因静默期顺延」）；存量功能里超出的时段（如日常浏览）自动钳进 09:00–21:00。</div>' +
    '<div class="gd-note">白天也不是一直动：<b>每小时最多自动动 30 分钟</b>，剩下半小时歇着——「连着干」比「干得多」更扎眼。</div></div>' +
    '<div class="gd-sec"><h4>🛌 每周单休 · 点一天就是那天的休息日</h4>' +
    '<div class="gd-days">' + days + '</div>' +
    '<div class="gd-note">每周随机抽 1 天整个停（这周是 <b>' + (st.rest.day >= 0 ? esc(st.rest.name) : '还没定') + '</b>）——那天不发笔记、不灌水、不获客，什么都不跑。想换天，点一下就是它。</div></div>' +
    '<div class="gd-sec"><h4>🩺 账号体检卡 <span class="badge ' + (st.level === '保守' ? 'ok' : 'warn') + '" style="margin-left:6px;">当前挡位：' + esc(st.level) + '</span> <span style="font-size:var(--fs-xs);color:var(--c-ink-3);">记过 ' + st.health.length + ' 笔</span></h4>' +
    recs +
    '<div style="margin-top:10px;"><button class="btn-primary btn-sm" id="gdRecOpen">＋ 记一笔</button></div>' +
    '<div class="gd-note">收到警告 / 限流：挡位自动降一级；收到处罚：直接落到「保守」；已在「保守」再收到 → 红字提醒（建议先停几天）。<b>恢复要手动</b>——觉得稳了想跑多点，到上面点卡自己调。</div></div>' +
    '<div class="gd-foot">这一页和「拟人化与频率」页各管各的：那边管每一步停多久，这边管一天能干多少、什么时候不许干。所有功能（灌水 / 获客 / 截流 / 日常浏览 / 私信 / 发布台）跑之前都过这一道闸：额度没了等明天，静默 / 休息日顺延。</div>' +
    // 记一笔弹层（默认收着；.modal 自带 display:flex，用行内 none 盖掉）
    '<div class="modal" id="gdRecModal" style="display:none;">' +
      '<div class="modal-box">' +
        '<div class="modal-header"><h3>🩺 记一笔平台动作</h3><button class="modal-close" id="gdRecClose">✕</button></div>' +
        '<div style="font-size:var(--fs-sm);color:var(--c-ink-2);line-height:1.8;">收到平台的警告 / 限流 / 处罚，记在这里——挡位自动收紧，不用自己盯：<b>警告、限流降一级；处罚直接落到「保守」</b>。</div>' +
        '<div class="gd-radios" id="gdKinds" style="margin-top:12px;">' +
          ['警告', '限流', '处罚'].map(k => '<button type="button" class="gd-radio' + (k === _gdRecKind ? ' on' : '') + '" data-k="' + k + '">' + k + '</button>').join('') +
        '</div>' +
        '<div class="gd-recdate"><span>发生日期</span><input type="date" id="gdRecDate"><span style="font-size:var(--fs-xs);color:var(--c-ink-3);">补记历史日期时改这里（默认今天）</span></div>' +
        '<textarea id="gdNote" class="gd-recbox" rows="3" placeholder="平台怎么说这个的、原文、时间范围（可不填）"></textarea>' +
        '<div class="gd-modalfoot"><span class="gd-mf-hint">记完就按新挡位跑，从下一个动作开始生效</span>' +
        '<span style="display:flex;gap:8px;"><button class="btn-secondary btn-sm" id="gdRecCancel">取消</button><button class="btn-primary btn-sm" id="gdRecSave">保存</button></span></div>' +
      '</div>' +
    '</div>' +
    '</div>';
}

function _gdOpenRec() {
  _gdRecKind = '警告';
  const m = document.getElementById('gdRecModal');
  if (!m) return;
  // 每次打开都重置到「警告」＋清空备注（防上次残留）
  m.querySelectorAll('#gdKinds .gd-radio').forEach(b => b.classList.toggle('on', b.dataset.k === '警告'));
  const note = document.getElementById('gdNote');
  if (note) note.value = '';
  const date = document.getElementById('gdRecDate');
  if (date) {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    date.value = today;
    date.max = today;   // 不能记未来的日期
  }
  m.style.display = 'flex';
}
function _gdCloseRec() { const m = document.getElementById('gdRecModal'); if (m) m.style.display = 'none'; }

async function _gdSaveRec() {
  if (typeof AccountGuard === 'undefined') return;
  const note = document.getElementById('gdNote');
  const date = document.getElementById('gdRecDate');
  const t = date && date.value ? date.value : '';
  let r = null;
  try { r = await AccountGuard.record({ kind: _gdRecKind, note: (note && note.value) || '', t }); } catch (_) {}
  _gdCloseRec();
  await renderGuardSettings();
  if (r) {
    const act = r.floor
      ? '已在最保守档——建议先把自动化停几天'
      : (_gdRecKind === '处罚' ? '挡位已落到「保守」' : '挡位已降一级到「' + r.level + '」');
    showMsg('gdSaveMsg', '记下了——' + act);
  } else {
    showMsg('gdSaveMsg', '没记上（存储写入失败），再试一次', 'err');
  }
}

function _gdWire() {
  if (_gdWired) return;
  const panel = document.getElementById('tab-guard');
  if (!panel) return;
  _gdWired = true;
  panel.addEventListener('click', async (e) => {
    const card = e.target.closest('.gd-card');
    if (card && typeof AccountGuard !== 'undefined') {
      if (card.classList.contains('on')) return;   // 点已选中的卡不动（同 demo）
      await AccountGuard.saveCfg({ level: card.dataset.level });
      await renderGuardSettings();
      showMsg('gdSaveMsg', '挡位切到「' + card.dataset.level + '」——今天各功能的额度上限跟着换了（体检卡降挡后想放宽，也在这手动调）');
      return;
    }
    const day = e.target.closest('.gd-day');
    if (day && typeof AccountGuard !== 'undefined') {
      const dow = parseInt(day.dataset.dow, 10);
      const nm = (GD_DAYS.find(d => d[1] === dow) || [''])[0];
      await AccountGuard.saveCfg({ restDay: dow });
      await renderGuardSettings();
      showMsg('gdSaveMsg', '这周的休息日改成' + nm + '了——那天所有自动化不跑');
      return;
    }
    if (e.target.closest('#gdRecOpen')) { _gdOpenRec(); return; }
    if (e.target.closest('#gdRecClose') || e.target.closest('#gdRecCancel')) { _gdCloseRec(); return; }
    const k = e.target.closest('#gdKinds .gd-radio');
    if (k) {
      _gdRecKind = k.dataset.k || '警告';
      panel.querySelectorAll('#gdKinds .gd-radio').forEach(b => b.classList.toggle('on', b === k));
      return;
    }
    if (e.target.closest('#gdRecSave')) { _gdSaveRec(); return; }
  });
}
