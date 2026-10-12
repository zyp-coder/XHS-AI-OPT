/* 首次设置向导：2 步——① 填 AI 配置 ② 绑定账号验证；产品/人设/知识库在「诊断&配置」里配 */
(function () {
  'use strict';
/* 提供商 / 模型清单：都在 lib/ai-providers.js（与设置页、弹窗、后台共用一份） */
function detectProviderByBaseUrl(baseUrl) {
  for (const k of Object.keys(PROVIDER_CONFIG)) { if (k !== 'custom' && PROVIDER_CONFIG[k].baseUrl === baseUrl) return k; }
  return 'custom';
}
function fillModelSelect(selId, provider, selectedModel) {
  const sel = document.getElementById(selId); if (!sel) return;
  sel.innerHTML = '';
  const cfg = PROVIDER_CONFIG[provider];
  if (!cfg || provider === 'custom') { // 自定义模式：当前 + 常用模型快捷选
    if (selectedModel) {
      const opt = document.createElement('option'); opt.value = selectedModel; opt.textContent = '当前：' + selectedModel; opt.selected = true; sel.appendChild(opt);
    }
    const mk = (val, label, group) => {
      const o = document.createElement('option'); o.value = val; o.textContent = (group ? '[非推理] ' : '') + label; if (val === selectedModel) o.selected = true; sel.appendChild(o);
    };
    QUICK_MODELS.normal.forEach(m => mk(m.value, m.label, false));
    QUICK_MODELS.reasoning.forEach(m => mk(m.value, m.label, true));
    return;
  }
  let hasSelected = !selectedModel;
  cfg.models.forEach(m => {
    if (m.value === selectedModel) hasSelected = true;
    const opt = document.createElement('option'); opt.value = m.value; opt.textContent = m.label;
    if (m.value === selectedModel) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!hasSelected && selectedModel) {
    const opt = document.createElement('option'); opt.value = selectedModel; opt.textContent = '当前：' + selectedModel; opt.selected = true; sel.insertBefore(opt, sel.firstChild);
  }
}
function wireProviderSelects() {
  const sync = () => {
    const p = document.getElementById('apiProvider') && document.getElementById('apiProvider').value;
    const pcfg = PROVIDER_CONFIG[p];
    const cust = document.getElementById('customBaseUrlGroup');
    if (cust) cust.style.display = p === 'custom' ? '' : 'none';
    if (pcfg && p !== 'custom') { const cb = document.getElementById('customBaseUrl'); if (cb) cb.value = pcfg.baseUrl || ''; }
    const curModel = document.getElementById('apiModel') ? document.getElementById('apiModel').value : '';
    fillModelSelect('apiModel', p, curModel);
  };
  document.getElementById('apiProvider')?.addEventListener('change', sync);
  sync();
  const msync = () => {
    const p = document.getElementById('mmApiProvider') && document.getElementById('mmApiProvider').value;
    const pcfg = PROVIDER_CONFIG[p];
    const cust = document.getElementById('mmCustomBaseUrlGroup');
    if (cust) cust.style.display = p === 'custom' ? '' : 'none';
    if (pcfg && p !== 'custom') { const cb = document.getElementById('mmCustomBaseUrl'); if (cb) cb.value = pcfg.baseUrl || ''; }
    const curModel = document.getElementById('mmApiModel') ? document.getElementById('mmApiModel').value : '';
    fillModelSelect('mmApiModel', p, curModel);
  };
  document.getElementById('mmApiProvider')?.addEventListener('change', msync);
  msync();
}
function providerOfSelect(providerVal, customBaseUrlId) {
  if (providerVal === 'custom') return (document.getElementById(customBaseUrlId)?.value || '').trim();
  return (PROVIDER_CONFIG[providerVal] && PROVIDER_CONFIG[providerVal].baseUrl) || '';
}
function prefillAiSelects(ai) {
  ai = ai || {};
  if (ai.apiKey) { const el = document.getElementById('apiKey'); if (el) el.value = ai.apiKey; }
  const prov = detectProviderByBaseUrl(ai.apiBaseUrl || '');
  const pSel = document.getElementById('apiProvider'); if (pSel) pSel.value = prov;
  const custGroup = document.getElementById('customBaseUrlGroup'); if (custGroup) custGroup.style.display = prov === 'custom' ? '' : 'none';
  if (prov === 'custom') { const cb = document.getElementById('customBaseUrl'); if (cb) cb.value = ai.apiBaseUrl || ''; }
  fillModelSelect('apiModel', prov, ai.model || '');
  // 多模态
  const fbBase = ai.fallbackApiBaseUrl || '';
  const fbProv = detectProviderByBaseUrl(fbBase);
  const fbSel = document.getElementById('mmApiProvider'); if (fbSel) fbSel.value = fbProv;
  const fbCustGroup = document.getElementById('mmCustomBaseUrlGroup'); if (fbCustGroup) fbCustGroup.style.display = fbProv === 'custom' ? '' : 'none';
  if (fbProv === 'custom') { const cb = document.getElementById('mmCustomBaseUrl'); if (cb) cb.value = fbBase; }
  if (ai.fallbackApiKey) { const el = document.getElementById('mmApiKey'); if (el) el.value = ai.fallbackApiKey; }
  fillModelSelect('mmApiModel', fbProv, ai.fallbackModel || '');
}
  const GOALS = [
    { key: 'tool',    name: '精准获客 · 卖产品', desc: '盯着有需求的人回，话术引导去用你的产品/扫码/点我头像。', guide: '打开小红书搜「{PRODUCT}」，或点我头像进主页看详细介绍' },
    { key: 'brand',   name: '品牌口碑 · 种草',   desc: '广撒网做口碑互动，把品牌可信度立住，不硬拉人去买。', guide: '' },
    { key: 'profile', name: '主页引流 · 涨粉',   desc: '靠干货吸引人，结尾自然引导对方点头像看你主页。', guide: '想看更多干货可以点我头像进主页，我每天更新' },
  ];
  const PERSONA_QUESTIONS = [
    '你是谁？介绍一下你的身份、职业，或现在正在做的事。',
    '在这个领域/产品上你有过哪些真实的经历？做了多久、帮过多少人、或亲自踩过哪些坑。',
    '你最拿手、最想让别人知道的干货或专业积累是什么？',
    '你的小红书账号定位是什么？主要分享什么、写给谁看？',
    '你希望评论区互动时的"人设感"是哪种（专业靠谱 / 接地气过来人 / 随性朋友…）？有没有特别的口吻或语气？',
  ];
  const KB_QUESTIONS = [
    '你的产品/服务是什么？主要帮人解决什么问题、满足什么需求？',
    '你的目标客户是谁？他们购买前最常问、最担心、最容易踩坑的点是什么？',
    '你有哪些亲身经验或案例（做过的事、帮过谁、踩过的坑），能用来建立信任和给建议？',
    '有没有具体的数字、价格、政策或行业数据，客户需要知道的？',
    '你最想让大家记住你的 2-3 个专业观点或干货结论是什么？',
];
  const DEFAULT = {
    product: { name: '我的产品', promoGoal: '', guideText: '', description: '', sellPoints: [] },
    ai: { apiKey: '', apiBaseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', temperature: 0.8, maxTokens: 2000 },
  };

  const $ = (s) => document.getElementById(s);
  const getCfg = async () => deepMerge(DEFAULT, (await getSt('config')) || {});
  const setCfg = (c) => setSt('config', c);
  const getSt = async (k) => (await chrome.storage.local.get(k))[k];
  const setSt = (k, v) => chrome.storage.local.set({ [k]: v });
  function deepMerge(base, over) {
    const r = { ...base };
    for (const k of Object.keys(over || {})) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        r[k] = deepMerge(base[k] || {}, over[k]);
      } else { r[k] = over[k]; }
    }
    return r;
  }

let step = 1;
  let restored = false; // 已从备份恢复 → 跳过 AI 配置填写
  let cfg = null;
  let selGoal = 'tool';
  let mmOpen = false;
  let spItems = [];
  let wizPersonaText = '';
  let wizKbItems = [];

  function spEsc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function renderSpList() {
    const box = $('spList'); if (!box) return;
    if (!spItems.length) spItems.push({ title: '', content: '', image: '' });
    box.innerHTML = spItems.map((s, i) => spCardHtml(s, i)).join('');
    wireSpEvents();
  }
  function spCardHtml(s, i) {
    const t = spEsc(s.title), c = spEsc(s.content), img = (s.image) || '';
    return '<div class="sp-card" data-idx="' + i + '">' +
      '<div class="sp-head"><b>卖点 ' + (i + 1) + '/10</b><button type="button" class="sp-rm" data-idx="' + i + '">🗑 删除</button></div>' +
      '<div class="sp-body"><div class="sp-fields">' +
      '<input type="text" class="sp-title" data-idx="' + i + '" value="' + t + '" maxlength="40" placeholder="卖点标题，例如：几秒出对比结果">' +
      '<textarea class="sp-content" data-idx="' + i + '" rows="2" placeholder="卖点内容，例如：输入月供和首付，立马算出等额本金的省钱差异，提前还到底划不划算">' + c + '</textarea>' +
      '</div><div class="sp-img" data-idx="' + i + '">' +
      (img
        ? '<img src="' + img + '" data-idx="' + i + '" title="点击更换配图">' +
          '<button type="button" class="clr" data-idx="' + i + '">清除</button>'
        : '<label style="display:flex;align-items:center;justify-content:center;width:86px;height:64px;border:1px dashed var(--dim);border-radius:8px;font-size:11px;color:var(--dim);cursor:pointer;">＋ 配图<input type="file" accept="image/*" class="sp-file" data-idx="' + i + '" style="display:none;"></label>') +
      '</div></div></div>';
  }
  function wireSpEvents() {
    const box = $('spList'); if (!box) return;
    const add = $('spAddBtn');
    if (add) add.onclick = () => {
      if (spItems.length >= 10) { alert('最多 10 个卖点'); return; }
      spItems.push({ title: '', content: '', image: '' }); renderSpList();
    };
    box.querySelectorAll('.sp-rm').forEach(b => b.onclick = () => {
      const idx = parseInt(b.getAttribute('data-idx'), 10);
      if (!Number.isNaN(idx)) { spItems.splice(idx, 1); renderSpList(); }
    });
    box.querySelectorAll('.sp-title').forEach(inp => inp.oninput = () => { const i = parseInt(inp.getAttribute('data-idx'), 10); spItems[i] = spItems[i] || {}; spItems[i].title = inp.value; });
    box.querySelectorAll('.sp-content').forEach(inp => inp.oninput = () => { const i = parseInt(inp.getAttribute('data-idx'), 10); spItems[i] = spItems[i] || {}; spItems[i].content = inp.value; });
    box.querySelectorAll('.clr').forEach(b => b.onclick = () => {
      const i = parseInt(b.getAttribute('data-idx'), 10);
      const folder = b.closest('.sp-img'); if (!folder) return;
      spItems[i] = spItems[i] || {}; spItems[i].image = '';
      folder.innerHTML = '<label style="display:flex;align-items:center;justify-content:center;width:86px;height:64px;border:1px dashed var(--dim);border-radius:8px;font-size:11px;color:var(--dim);cursor:pointer;">＋ 配图<input type="file" accept="image/*" class="sp-file" data-idx="' + i + '" style="display:none;"></label>';
      wireSpEvents();
    });
    box.querySelectorAll('.sp-file').forEach(inp => inp.onchange = () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      const i = parseInt(inp.getAttribute('data-idx'), 10);
      const folder = inp.closest('.sp-img'); if (!folder) return;
      const r = new FileReader();
      r.onload = (ev) => {
        const s = ev.target.result;
        spItems[i] = spItems[i] || {}; spItems[i].image = s;
        folder.innerHTML = '<img src="' + s + '" data-idx="' + i + '" title="点击更换配图">' +
          '<button type="button" class="clr" data-idx="' + i + '">清除</button>';
        wireSpEvents();
      };
      r.readAsDataURL(file);
    });
  }

  /* 知识库八分类：lib/ai-providers.js 的 KB_CATEGORIES */
  function renderWizKb() {
    const box = $('wizKbList'); if (!box) return;
    if (!wizKbItems.length) { box.innerHTML = '<div style="font-size:12px;color:var(--dim);">还没有知识，点下面"➕ 添加一条知识"。</div>'; return; }
    box.innerHTML = '';
    wizKbItems.forEach((e, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'border:1px solid #eee;border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#fff;';
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
          '<b style="font-size:12.5px;">知识 ' + (i + 1) + '</b>' +
          '<select class="wizKbCat" data-i="' + i + '" style="font-size:12px;border:1px solid #ddd;border-radius:6px;padding:2px 4px;">' +
            KB_CATEGORIES.map(c => '<option value="' + spEsc(c) + '"' + (e.category === c ? ' selected' : '') + '>' + spEsc(c) + '</option>').join('') +
          '</select>' +
          '<button type="button" class="wizKbDel" data-i="' + i + '" style="margin-left:auto;font-size:12px;border:none;background:none;color:#c62828;cursor:pointer;">🗑 删除</button>' +
        '</div>' +
        '<input type="text" class="wizKbTitle" data-i="' + i + '" value="' + spEsc(e.title) + '" maxlength="40" placeholder="标题，例如：提前还房贷怎么选" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:6px;margin-bottom:4px;font-size:12.5px;">' +
        '<textarea class="wizKbContent" data-i="' + i + '" rows="2" placeholder="内容，例如：等额本金适合想降月供但不考虑货币贬值的人，等额本息前期利息多但月供稳。" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:6px;font-size:12.5px;">' + spEsc(e.content) + '</textarea>';
      box.appendChild(row);
    });
  }
  function wireWizKb() {
    const add = $('wizKbAddBtn');
    if (add) add.onclick = () => { wizKbItems.push({ title: '', category: '产品介绍', content: '' }); renderWizKb(); };
    const box = $('wizKbList'); if (!box) return;
    box.onclick = (ev) => {
      const del = ev.target.closest('.wizKbDel'); if (!del) return;
      const i = parseInt(del.getAttribute('data-i'), 10);
      if (!Number.isNaN(i)) { wizKbItems.splice(i, 1); renderWizKb(); }
    };
    box.oninput = (ev) => {
      const t = ev.target;
      const i = parseInt(t.getAttribute('data-i'), 10);
      if (Number.isNaN(i)) return;
      wizKbItems[i] = wizKbItems[i] || {};
      if (t.classList.contains('wizKbTitle')) wizKbItems[i].title = t.value;
      else if (t.classList.contains('wizKbContent')) wizKbItems[i].content = t.value;
      else if (t.classList.contains('wizKbCat')) wizKbItems[i].category = t.value;
    };
  }

  function renderPersonaWizard() {
    const box = $('personaWizQuestions'); if (!box) return;
    box.innerHTML = PERSONA_QUESTIONS.map((q, i) =>
      '<div style="margin-bottom:8px;"><div style="font-size:12.5px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + spEsc(q) + '</div>' +
      '<textarea class="personaWizQ" data-k="q' + (i + 1) + '" rows="2" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:6px;" placeholder="你的回答…"></textarea></div>'
    ).join('');
  }
  function wizSetMsg(txt, isErr) {
    const m = $('personaWizMsg'); if (!m) return;
    m.textContent = txt; m.style.color = isErr ? '#c62828' : '#0a7b5a';
  }
  function wirePersonaWizard() {
    const readBtn = $('personaWizReadBtn');
    if (readBtn) readBtn.onclick = async () => {
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
        const st = $('personaWizStatus'); if (!st) return;
        if (desc) { const b = $('personaWizBio'); if (b) b.value = desc; st.textContent = (name ? '读到账号：' + name + '；' : '') + '✅ 已读取简介，可以继续答题或直接整理。'; st.style.color = '#0a7b5a'; }
        else { st.textContent = '⚠️ 没抓到简介。请先打开【你自己小红书的主页】（能显示简介的那页）再点一次；或直接粘贴到下面。'; st.style.color = '#c62828'; }
      } finally { readBtn.disabled = false; readBtn.textContent = '🧲 读取我本主页简介'; }
    };
    const buildBtn = $('personaWizBuildBtn');
    if (buildBtn) buildBtn.onclick = async () => {
      buildBtn.disabled = true; const t = buildBtn.textContent; buildBtn.textContent = '⏳ AI 整合中…'; wizSetMsg('');
      try {
        const bio = ($('personaWizBio') || {}).value ? $('personaWizBio').value.trim() : '';
        const answers = Array.from(document.querySelectorAll('.personaWizQ') || []).map(el => ({ answer: el.value }));
        const r = await chrome.runtime.sendMessage({ action: 'aiPersonaBuild', data: { bio, answers } });
        if (!r || !r.persona || !r.persona.text) throw new Error((r && r.error) || 'AI 未返回人设');
        wizPersonaText = r.persona.text;
        const q = $('personaQuick'); if (q) q.value = r.persona.text;
        wizSetMsg('✅ 已生成人设，点"下一步"保存即可。');
      } catch (e) { wizSetMsg('❌ ' + (e.message || e), true); }
      finally { buildBtn.disabled = false; buildBtn.textContent = t; }
    };
  }

  function renderKbWizard() {
    const box = $('kbWizQuestions'); if (!box) return;
    box.innerHTML = KB_QUESTIONS.map((q, i) =>
      '<div style="margin-bottom:8px;"><div style="font-size:12.5px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + spEsc(q) + '</div>' +
      '<textarea class="kbWizQ" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:6px;" placeholder="你的回答…"></textarea></div>'
    ).join('');
  }
  function wireKbWizard() {
    const buildBtn = $('kbWizBuildBtn');
    if (!buildBtn) return;
    buildBtn.onclick = async () => {
      buildBtn.disabled = true; const t = buildBtn.textContent; buildBtn.textContent = '⏳ AI 生成中…';
      const msg = $('kbWizMsg'); if (msg) msg.textContent = '';
      try {
        const answers = Array.from(document.querySelectorAll('.kbWizQ') || []).map(el => ({ answer: el.value }));
        const r = await chrome.runtime.sendMessage({ action: 'aiKbBuild', data: { answers } });
        if (!r || !r.ok || !Array.isArray(r.entries) || !r.entries.length) throw new Error((r && r.error) || 'AI 未生成知识库');
        const added = r.entries.map(e => ({ id: e.id, title: e.title, category: e.category || '产品介绍', content: e.content, tags: Array.isArray(e.tags) ? e.tags : [], createdAt: Date.now() }));
        wizKbItems = wizKbItems.concat(added);
        renderWizKb();
        if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已生成 ' + added.length + ' 条知识，可在下方再调整，点"下一步"保存。'; }
      } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
      finally { buildBtn.disabled = false; buildBtn.textContent = t; }
    };
  }

function paintSteps() {
    for (let i = 1; i <= 2; i++) $('s' + i).classList.toggle('on', i <= step);
  }
  function showPage(n) {
    for (let i = 1; i <= 2; i++) $('page' + i).classList.toggle('hidden', i !== n);
    $('prevB').style.display = n === 1 ? 'none' : '';
    $('nextB').innerHTML = n === 1 ? '下一步：验证账号' : '下一步';
  }

function toggleMM() {
    mmOpen = !mmOpen;
    const body = $('mmBody'); const caret = $('mmCaret');
    if (body) body.classList.toggle('hidden', !mmOpen);
    if (caret) caret.textContent = mmOpen ? '－' : '＋';
  }
  function paintGoals() {
    const box = $('goals'); box.innerHTML = '';
    GOALS.forEach(g => {
      const el = document.createElement('div');
      el.className = 'goal' + (g.key === selGoal ? ' on' : '');
      el.innerHTML = `<em>✓</em><b>${g.name}</b><span>${g.desc}</span>`;
      el.onclick = () => { selGoal = g.key; paintGoals(); };
      box.appendChild(el);
    });
  }

function validStep(n) {
    if (n === 1) {
      if (restored) return true; // 已从备份恢复 → AI 配置已存在，无需再填
      const prov = $('apiProvider').value;
      if (prov === 'custom') {
        const cu = $('customBaseUrl').value.trim();
        if (!/^https?:\/\//i.test(cu)) { alert('请填一个正确的自定义 API 地址（以 http:// 开头），或改选上方服务商'); return false; }
      }
      if (!$('apiKey').value.trim()) { alert('请填 API Key'); return false; }
    }
    return true;
  }

async function next() {
    if (!validStep(step)) return;
    if (step === 1) {
      // 服务商域名授权要在点击手势里要（火山方舟没写进 manifest；没授权 AI 调用会被浏览器拦下）
      const granted = await ensureProviderHostGranted($('apiProvider').value);
      if (!granted) alert('没拿到该服务商域名的访问授权，AI 调用会被浏览器拦下。可先继续，之后到「设置 → AI 模型配置」再点一次保存，并在弹窗里选「允许」。');
      step = 2; paintSteps(); showPage(step); await prefillVerify(); return;
    }
    // step===2：验证按钮动作
  }

  async function prev() { if (step > 1) { step--; paintSteps(); showPage(step); } }

  async function loadBound() {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'getEdition' });
      const b = (r && r.edition && r.edition.boundAccount) || {};
      $('bXhs').textContent = b.xhsId ? b.xhsId + (b.name ? '（' + b.name + '）' : '') : '--';
    } catch (_) { $('bXhs').textContent = '读取失败'; }
  }

async function saveAll() {
    // 快捷设置只保存 AI 配置；产品/人设/知识库/内容规划在「诊断&配置」工作流里配置
    const merged = deepMerge(cfg, {
      ai: {
        apiKey: $('apiKey').value.trim(),
        apiBaseUrl: providerOfSelect($('apiProvider').value, 'customBaseUrl') || 'https://api.deepseek.com/v1',
        model: $('apiModel').value.trim() || 'deepseek-v4-flash',
      },
    });
    // 多模态模型（选配）：填了 key 才启用
    const mmKey = $('mmApiKey') ? $('mmApiKey').value.trim() : '';
    if (mmKey) {
      const mmBase = providerOfSelect($('mmApiProvider').value, 'mmCustomBaseUrl');
      const mmM = $('mmApiModel') ? $('mmApiModel').value.trim() : '';
      if (mmBase && mmM) { merged.ai.fallbackApiKey = mmKey; merged.ai.fallbackApiBaseUrl = mmBase; merged.ai.fallbackModel = mmM; }
    } else { merged.ai.fallbackApiKey = merged.ai.fallbackApiBaseUrl = merged.ai.fallbackModel = ''; }
    await setCfg(merged);
    await setSt('wizard_done', Date.now());
    cfg = merged;
  }

  async function doVerify() {
    const btn = $('verifyBtn');
    if (btn.dataset.loading === '1') return;
    btn.dataset.loading = '1'; btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>验证中…';
    let r = null;
    try { r = await chrome.runtime.sendMessage({ action: 'accountGuarantee', forceNow: true }); } catch (_) { r = null; }
    const msg = document.createElement('div');
    msg.className = 'msg ' + ((r && r.ok) ? 'ok' : 'err');
    if (r && r.ok) {
      msg.textContent = '✅ 验证通过，配置已保存，可以使用啦。';
btn.innerHTML = '✓ 已通过'; btn.disabled = true;
      $('page2').appendChild(msg);
      setTimeout(() => { try { location.href = chrome.runtime.getURL('settings.html'); } catch (_) { window.close(); } }, 900);
    } else {
      msg.textContent = '❌ ' + ((r && r.reason) || '验证失败，请确认已在网页登录该号并打开自己的「我的」主页后重试');
      btn.dataset.loading = '0'; btn.disabled = false; btn.innerHTML = '重新验证';
      $('page4').appendChild(msg);
    }
  }

async function prefillVerify() {
    await saveAll();
    await loadBound();
    $('nextB').style.display = 'none';
    $('verifyBtn').textContent = '验证并完成';
  }

  // 从备份文件一键恢复：成功后带出 AI 配置，本步免填
  function wireRestore() {
    const btn = $('restoreBtn');
    const file = $('restoreFile');
    const msg = $('restoreMsg');
    if (!btn || !file || !msg) return;
    btn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      msg.classList.remove('ok', 'err', 'info', 'hidden');
      msg.style.display = ''; msg.style.color = 'var(--sub)';
      msg.textContent = '正在读取备份文件…';
      let backup = null;
      try { backup = JSON.parse(await f.text()); }
      catch (_) { msg.style.color = '#c62828'; msg.textContent = '❌ 文件不是合法的 JSON 备份'; return; }
      if (!backup || !backup.tenants || !backup.data) { msg.style.color = '#c62828'; msg.textContent = '❌ 不是有效的备份文件（缺 tenants/data）'; return; }
      msg.textContent = '正在合并导入备份数据…';
      let r = null;
      try { r = await chrome.runtime.sendMessage({ action: 'importAllData', data: { backup } }); } catch (e) { r = null; }
      if (!r || !r.ok) { msg.style.color = '#c62828'; msg.textContent = '❌ 导入失败：' + ((r && r.error) || '后台未响应'); return; }
      // 重新读取已被恢复的配置，预填 AI 字段
      cfg = await getCfg();
      restored = !!(cfg.ai && (cfg.ai.apiKey || cfg.ai.fallbackApiKey));
      prefillAiSelects(cfg.ai);
      const n = r.importedTenants || 0;
      msg.classList.add('ok'); msg.style.color = '#3dd68c';
      msg.textContent = restored
        ? '✅ 已导入 ' + n + ' 个产品，AI 配置已就绪，本步可跳过 AI 填写，直接点「下一步：验证账号」。'
        : '✅ 已导入 ' + n + ' 个产品，但备份里没有 AI Key，请继续在下方填写 AI 配置。';
      setSt('wizard_done', Date.now()); // 恢复即视为配置已就绪
    };
    file.addEventListener('change', () => { file.value = ''; });
  }

async function init() {
    cfg = await getCfg();
    // 事件优先绑定，即使预填出错也不影响按钮/下拉可用
    try { wireRestore(); } catch (e) { console.error('[向导] wireRestore:', e); }
    try { wireProviderSelects(); } catch (e) { console.error('[向导] wireProviderSelects:', e); }
    try { prefillAiSelects(cfg.ai); } catch (e) { console.error('[向导] prefill:', e); }
    try { paintSteps(); showPage(1); } catch (e) { console.error('[向导] 步骤渲染:', e); }
    $('nextB').onclick = next;
    $('prevB').onclick = prev;
    $('verifyBtn').onclick = doVerify;
    const mmToggle = $('mmToggle'); if (mmToggle) mmToggle.onclick = toggleMM;
  }
  init();
})();
