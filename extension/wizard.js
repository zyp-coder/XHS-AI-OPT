/* 首次设置向导：2 步——① 填 AI 配置 ② 绑定账号验证；产品/人设/知识库在「账号诊断」里配 */
(function () {
  'use strict';
  const PROVIDERS = {
    deepseek:  { baseUrl: 'https://api.deepseek.com/v1',         models: [{ v: 'deepseek-chat', l: 'deepseek-chat（非推理·快·推荐）' }, { v: 'deepseek-v4-flash', l: 'deepseek-v4-flash（推理）' }] },
    openai:    { baseUrl: 'https://api.openai.com/v1',           models: [{ v: 'gpt-4.1', l: 'gpt-4.1（旗舰）' }, { v: 'gpt-4.1-mini', l: 'gpt-4.1-mini（性价比）' }, { v: 'gpt-4o-mini', l: 'gpt-4o-mini' }] },
    qwen:      { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [{ v: 'qwen-plus', l: 'Qwen Plus（均衡·推荐）' }, { v: 'qwen-turbo', l: 'Qwen Turbo（快·便宜）' }, { v: 'qwen-max', l: 'Qwen Max（最强）' }] },
    qianfan:   { baseUrl: 'https://qianfan.baidubce.com/v2',      models: [{ v: 'ernie-4.5-turbo-32k', l: 'ERNIE 4.5 Turbo 32K（便宜·推荐）' }, { v: 'ernie-4.5-turbo-128k', l: 'ERNIE 4.5 Turbo 128K' }] },
    siliconflow:{ baseUrl: 'https://api.siliconflow.cn/v1',      models: [{ v: 'deepseek-ai/DeepSeek-V4-Flash', l: 'DeepSeek V4 Flash' }, { v: 'Qwen/Qwen3.5-397B-A17B', l: 'Qwen3.5 397B（旗舰）' }] },
    custom:    { baseUrl: '', models: [{ v: 'deepseek-chat', l: 'deepseek-chat' }] },
  };
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
  // 多模态模型（选配）：默认通义千问 Qwen3.7 Plus
  const MM_PROVIDERS = {
    qwen:    { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [{ v: 'qwen3.7-plus', l: 'Qwen3.7 Plus（默认·均衡）' }, { v: 'qwen3.7-max', l: 'Qwen3.7 Max（旗舰）' }, { v: 'qwen-vl-max-latest', l: 'Qwen-VL Max（图像理解）' }, { v: 'qwen-plus', l: 'Qwen Plus' }, { v: 'qwen-max', l: 'Qwen Max' }] },
    openai:  { baseUrl: 'https://api.openai.com/v1', models: [{ v: 'gpt-4.1', l: 'GPT-4.1' }, { v: 'gpt-4o', l: 'GPT-4o' }] },
    custom:  { baseUrl: '', models: [{ v: '', l: '自定义（在下方地址填）' }] },
  };
  const DEFAULT = {
    product: { name: '我的产品', promoGoal: '', guideText: '', description: '', sellPoints: [] },
    ai: { apiKey: '', apiBaseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.8, maxTokens: 2000 },
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
  let cfg = null;
  let selProvider = 'deepseek';
  let selGoal = 'tool';
  let selMM = 'qwen';
  let mmOpen = false;
  let mmModel = 'qwen3.7-plus';
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

  const KB_CATS = ['通用', '产品介绍', '客户痛点', '避坑经验', '数据/价格', '使用技巧', '行业干货'];
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
            KB_CATS.map(c => '<option value="' + spEsc(c) + '"' + (e.category === c ? ' selected' : '') + '>' + spEsc(c) + '</option>').join('') +
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
    if (add) add.onclick = () => { wizKbItems.push({ title: '', category: '通用', content: '' }); renderWizKb(); };
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
        const added = r.entries.map(e => ({ id: e.id, title: e.title, category: e.category || '通用', content: e.content, createdAt: Date.now() }));
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

  function paintProviders() {
    const box = $('providers'); box.innerHTML = '';
    Object.keys(PROVIDERS).forEach(key => {
      const el = document.createElement('div');
      el.className = 'provider' + (key === selProvider ? ' on' : '');
      el.textContent = { deepseek: 'DeepSeek', openai: 'OpenAI', qwen: '通义千问', qianfan: '百度千帆', siliconflow: '硅基流动', custom: '自定义' }[key];
      el.onclick = () => { selProvider = key; paintProviders(); paintModels(); };
      box.appendChild(el);
    });
    paintModels();
  }
  function paintModels() {
    const m = $('model');
    const prov = PROVIDERS[selProvider] || PROVIDERS.custom;
    m.innerHTML = '';
    prov.models.forEach(x => { const o = document.createElement('option'); o.value = x.v; o.textContent = x.l; m.appendChild(o); });
    if (cfg && cfg.ai.apiKey && !cfg.ai.model) { /* keep default */ }
    $('baseUrl').placeholder = prov.baseUrl || 'https://…/v1';
  }
  function paintMMProviders() {
    const box = $('mmProviders'); if (!box) return; box.innerHTML = '';
    Object.keys(MM_PROVIDERS).forEach(key => {
      const el = document.createElement('div');
      el.className = 'provider' + (key === selMM ? ' on' : '');
      el.textContent = { qwen: '通义千问', openai: 'OpenAI', custom: '自定义' }[key];
      el.onclick = () => { selMM = key; paintMMProviders(); paintMMModel(); };
      box.appendChild(el);
    });
    paintMMModel();
  }
  function paintMMModel() {
    const m = $('mmModel'); if (!m) return;
    const prov = MM_PROVIDERS[selMM] || MM_PROVIDERS.custom;
    m.innerHTML = '';
    prov.models.forEach(x => {
      const o = document.createElement('option'); o.value = x.v; o.textContent = x.l;
      if (x.v === mmModel) o.selected = true;
      m.appendChild(o);
    });
    const b = $('mmBaseUrl'); if (b) b.placeholder = prov.baseUrl || 'https://…/v1';
    if (b && !b.dataset.touched) b.value = prov.baseUrl || '';
  }
  function toggleMM() {
    mmOpen = !mmOpen;
    const body = $('mmBody'); const caret = $('mmCaret');
    if (body) body.classList.toggle('hidden', !mmOpen);
    if (caret) caret.textContent = mmOpen ? '－' : '＋';
    if (mmOpen) paintMMProviders();
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
      const prov = PROVIDERS[selProvider] || PROVIDERS.custom;
      const baseUrl = $('baseUrl').value.trim() || prov.baseUrl;
      if (!/^https?:\/\//i.test(baseUrl)) { alert('请填一个正确的 API 地址（以 http:// 开头）'); return false; }
      if (selProvider !== 'custom' && !baseUrl) { alert('请填 API 地址'); return false; }
      if (!$('apiKey').value.trim()) { alert('请填 API Key'); return false; }
    }
    return true;
  }

async function next() {
    if (!validStep(step)) return;
    if (step === 1) { step = 2; paintSteps(); showPage(step); await prefillVerify(); return; }
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
    const prov = PROVIDERS[selProvider] || PROVIDERS.custom;
    // 快捷设置只保存 AI 配置；产品/人设/知识库/内容规划在「账号诊断」工作流里配置
    const merged = deepMerge(cfg, {
      ai: { apiKey: $('apiKey').value.trim(), apiBaseUrl: $('baseUrl').value.trim() || prov.baseUrl, model: $('model').value },
    });
    // 多模态模型（选配）：填了 key 才启用，默认 qwen3.7-plus
    const mmKey = $('mmApiKey') ? $('mmApiKey').value.trim() : '';
    if (mmKey) {
      const mmProv = MM_PROVIDERS[selMM] || MM_PROVIDERS.custom;
      const mmBase = ($('mmBaseUrl') ? $('mmBaseUrl').value.trim() : '') || mmProv.baseUrl;
      const mmM = $('mmModel') ? $('mmModel').value.trim() : '';
      if (mmBase && mmM) { merged.ai.fallbackApiKey = mmKey; merged.ai.fallbackApiBaseUrl = mmBase; merged.ai.fallbackModel = mmM; }
    }
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

  async function init() {
    cfg = await getCfg();
    // 预填
    if (cfg.ai.apiKey) { $('apiKey').value = cfg.ai.apiKey; }
if (cfg.ai.apiBaseUrl) $('baseUrl').value = cfg.ai.apiBaseUrl;
    for (const k of Object.keys(PROVIDERS)) { if (PROVIDERS[k].baseUrl && cfg.ai.apiBaseUrl === PROVIDERS[k].baseUrl) selProvider = k; }
    // 多模态预填：已有 fallback 配置则对齐
    if (cfg.ai.fallbackModel) mmModel = cfg.ai.fallbackModel;
    const fbBase = cfg.ai.fallbackApiBaseUrl || '';
    for (const k of Object.keys(MM_PROVIDERS)) { if (MM_PROVIDERS[k].baseUrl && fbBase === MM_PROVIDERS[k].baseUrl) selMM = k; }
    if (cfg.ai.fallbackApiKey) { $('mmApiKey').value = cfg.ai.fallbackApiKey; $('mmBaseUrl').value = fbBase; $('mmBaseUrl').dataset.touched = '1'; }
    paintProviders(); paintSteps(); showPage(1);
    // 事件
    $('nextB').onclick = next;
    $('prevB').onclick = prev;
    $('verifyBtn').onclick = doVerify;
    const mmToggle = $('mmToggle'); if (mmToggle) mmToggle.onclick = toggleMM;
    const mmInputBase = $('mmBaseUrl'); if (mmInputBase) mmInputBase.addEventListener('input', () => { mmInputBase.dataset.touched = '1'; });
    if (cfg.ai.apiKey) { $('model').value = cfg.ai.model || PROVIDERS[selProvider].models[0].v; }
  }
  init();
})();
