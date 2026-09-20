// ============================================================
// 小红书评论助手 — Popup v6（独立插件版，无需后台服务）
// 功能：提取评论 → AI挖掘潜在客户 → 生成话术 → 发送回复
// ============================================================
'use strict';

// 本会话内是否已完成账号绑定验证（成功即置位，防止后续轮询重新弹验证遮罩）
let _acctVerifiedInSession = false;

// ========== 窗口形态 ==========
const urlParams = new URLSearchParams(window.location.search);
const TARGET_TAB_ID = parseInt(urlParams.get('tabId')) || null;
const MODE_BIG = urlParams.get('mode') === 'big'; // 大窗（带框总览）
// body 标记窗口形态：big=大窗总览 / small=小窗分步
if (document.body) {
  document.body.setAttribute('data-mode', MODE_BIG ? 'big' : 'small');
}
// 独立窗口（由 background 用 ?tabId= 打开）→ 标记 body，应用无边框面板样式
if (TARGET_TAB_ID && document.body) {
  document.body.setAttribute('data-standalone', '1');
}

/** 获取要操作的小红书标签页（优先用窗口传入的 tabId，后备查询 activeTab） */
async function getTargetTab() {
  if (TARGET_TAB_ID) {
    try {
      const tab = await chrome.tabs.get(TARGET_TAB_ID);
      if (tab && tab.url && tab.url.includes('xiaohongshu.com')) return tab;
    } catch (_) {}
  }
  // ★ 小窗/无 tabId：优先取当前聚焦的小红书标签页（保证 openNote 后能切到笔记评论）
  const xhsTabs = await chrome.tabs.query({ url: '*://www.xiaohongshu.com/*' });
  const active = xhsTabs.find(t => t.active);
  if (active && active.id != null) return active;
  if (xhsTabs && xhsTabs.length > 0) return xhsTabs[0];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let pageData = null;
let kbImages = []; // 知识库匹配的图片

/* ========== 敏感数据读写：落盘为密文，页面里统一走这两个口子拿到明文 ========== */
/** 读敏感 key（knowledge_base / prospect_list / watering_logs / replied_comments …）的明文 */
async function readPlain(key) {
  const d = await chrome.storage.local.get(key);
  if (typeof DataPrivacy === 'undefined') return d[key];
  return DataPrivacy.unlock(key, d[key]);
}
/** 写敏感 key（自动加密落盘） */
async function writePlain(key, value) {
  const v = (typeof DataPrivacy !== 'undefined' && value !== undefined && value !== null)
    ? await DataPrivacy.lock(key, value) : value;
  await chrome.storage.local.set({ [key]: v });
}
/** 读 config 明文（AI Key 等字段自动解密） */
async function readConfigPlain() {
  const d = await chrome.storage.local.get('config');
  const cfg = (d && d.config) || {};
  return (typeof DataPrivacy === 'undefined') ? cfg : DataPrivacy.unlockConfig(cfg);
}
/** 写 config（AI Key 等字段自动加密落盘） */
async function writeConfigPlain(cfg) {
  const v = (typeof DataPrivacy === 'undefined') ? cfg : await DataPrivacy.lockConfig(cfg);
  await chrome.storage.local.set({ config: v, wizard_done: Date.now() });
}

// ========== 本地回复记录管理（chrome.storage.local） ==========
const REPLIED_KEY = 'replied_comments';

// ========== 灌水总结记录（今天灌了多少、灌了哪些评论/话术，最多保留 500 条） ==========
const WATER_LOGS_KEY = 'watering_logs';
const WATER_LOGS_LIMIT = 500;

/** 读取全部灌水明细（新→旧） */
async function getWaterLogs() {
  try {
    const logs = (await readPlain(WATER_LOGS_KEY)) || [];
    return Array.isArray(logs) ? logs : [];
  } catch (_) { return []; }
}

/** 追加一条灌水明细（新记录在最前，超出上限裁剪最旧） */
async function addWaterLog(entry) {
  try {
    const logs = await getWaterLogs();
    logs.unshift({ ...entry, ts: Date.now() });
    if (logs.length > WATER_LOGS_LIMIT) logs.length = WATER_LOGS_LIMIT;
    await writePlain(WATER_LOGS_KEY, logs);
  } catch (_) {}
}

/** 清空灌水明细 */
async function clearWaterLogs() {
  try { await writePlain(WATER_LOGS_KEY, []); } catch (_) {}
}

/** 本地日期 YYYY-MM-DD（不用 toISOString，避免 UTC 时区差一天） */
function _localDateStr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 💧 灌水总结模态框：今天/本周/累计统计 + 按天分组明细（时间/笔记/评论/话术） */
async function renderWaterSummary(container) {
  const logs = await getWaterLogs();
  const now = new Date();
  const todayStr = _localDateStr(now.getTime());
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime(); // 本周一 00:00
  let today = 0, week = 0;
  const groups = new Map();
  for (const l of logs) {
    if (_localDateStr(l.ts) === todayStr) today++;
    if (l.ts >= weekStart) week++;
    const day = _localDateStr(l.ts);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(l);
  }

  let listHtml = '';
  if (logs.length === 0) {
    listHtml = '<div style="text-align:center;color:#999;padding:30px 0;font-size:12px;">还没有灌水记录<br><span style="font-size:11px;">发送第一条回复后，会在这里显示：今天灌了多少、灌了哪些评论和话术</span></div>';
  }
  for (const [day, items] of groups) {
    const d = new Date(day + 'T00:00:00');
    const dayLabel = day === todayStr ? '今天' : (d.getMonth() + 1) + '月' + d.getDate() + '日';
    listHtml += `<div style="margin:12px 0 6px;font-weight:600;color:#374151;font-size:12px;">📅 ${dayLabel}（${items.length} 条）</div>`;
    items.forEach((l, idx) => {
      const time = new Date(l.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const srcTag = l.source === 'batch' ? '<span style="color:#7c3aed;">批量</span>' : '<span style="color:#059669;">逐条</span>';
      const commentSnippet = String(l.comment || '');
      listHtml += `
      <div style="border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;margin-bottom:8px;background:#fff;font-size:11px;line-height:1.6;">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <span style="font-weight:600;color:#1f2937;word-break:break-all;">${esc(l.noteTitle || '（无标题）')}</span>
          <span style="color:#999;white-space:nowrap;">${time} ${srcTag}</span>
        </div>
        <div style="color:#6b7280;margin-top:2px;">@${esc(l.author || '匿名')} 的评论：${esc(commentSnippet.slice(0, 80))}${commentSnippet.length > 80 ? '…' : ''}</div>
        <div style="color:#333;margin-top:2px;background:#f9fafb;border-radius:4px;padding:4px 6px;">💬 ${esc(l.replyText || '（无话术内容）')}</div>
        <div style="margin-top:4px;text-align:right;">
          <button class="copy-log-btn" data-log-idx="${idx}" style="font-size:10px;padding:1px 8px;background:#f0f0f0;border:1px solid #ddd;border-radius:3px;cursor:pointer;">复制话术</button>
        </div>
      </div>`;
    });
  }

  if (!container) return;
  container.innerHTML = `
    <div style="padding:6px 2px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:16px;color:var(--ink);">💧 灌水总结</h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="wsClearBtn" style="padding:5px 12px;font-size:11px;cursor:pointer;background:#fff;color:#d32f2f;border:1px solid #f0c2c2;border-radius:8px;">🗑 清空记录</button>
          <button id="wsRefreshBtn" style="padding:5px 12px;font-size:11px;cursor:pointer;background:var(--primary-bg);color:var(--primary);border:1px solid #cfe3fb;border-radius:8px;font-weight:600;">🔄 刷新</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:110px;background:var(--green-bg);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:26px;font-weight:700;color:var(--green);">${today}</div><div style="font-size:11px;color:#666;">今天</div></div>
        <div style="flex:1;min-width:110px;background:var(--amber-bg);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:26px;font-weight:700;color:var(--amber);">${week}</div><div style="font-size:11px;color:#666;">本周</div></div>
        <div style="flex:1;min-width:110px;background:var(--primary-bg);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:26px;font-weight:700;color:var(--primary);">${logs.length}</div><div style="font-size:11px;color:#666;">累计</div></div>
      </div>
      <div style="font-size:11px;line-height:1.6;">${listHtml}</div>
    </div>`;

  container.querySelector('#wsRefreshBtn').onclick = () => renderWaterSummary(container);
  container.querySelector('#wsClearBtn').onclick = async () => {
    if (!confirm('确定清空全部灌水记录？此操作不可恢复。')) return;
    await clearWaterLogs();
    renderWaterSummary(container);
  };
  // 复制话术（事件委托）
  container.querySelectorAll('.copy-log-btn').forEach(btn => {
    btn.onclick = () => {
      const log = logs[parseInt(btn.dataset.logIdx)];
      if (!log) return;
      navigator.clipboard.writeText(log.replyText || '').then(() => {
        btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = '复制话术'; }, 1200);
      }).catch(() => {});
    };
  });
}

// ========== 点赞记录（内存，刷新/关闭即清零） ==========
let likedComments = []; // { author, textSnippet, time }

function renderLikedList() {
  let container = document.getElementById('likedListContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'likedListContainer';
    const mc = document.getElementById('mainContent');
    if (mc) mc.appendChild(container);
  }
  if (likedComments.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <details style="margin-top:8px;" open>
      <summary style="font-size:12px;font-weight:500;color:#555;cursor:pointer;padding:4px 0;">
        👍 已点赞（${likedComments.length}个）
      </summary>
      ${likedComments.map((item, i) => {
        const timeStr = item.time ? new Date(item.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<div style="padding:4px 8px;margin:2px 0;background:#f0fdf4;border-radius:4px;font-size:11px;line-height:1.5;">
          <span style="color:#059669;font-weight:500;">@${esc(item.author)}</span>
          <span style="color:#999;font-size:10px;margin-left:4px;">${timeStr}</span>
          <div style="color:#333;margin-top:1px;">${esc(item.textSnippet)}</div>
        </div>`;
      }).join('')}
    </details>
  `;
}

/** 获取当前笔记的本地已回复记录列表 */
async function getLocalRepliedForNote(noteUrl) {
  if (!noteUrl) return [];
  const map = (await readPlain(REPLIED_KEY)) || {};
  return map[noteUrl] || [];
}

/** 将一条回复保存到本地存储 */
async function addLocalReply(noteUrl, author, comment) {
  if (!noteUrl) return;
  const map = (await readPlain(REPLIED_KEY)) || {};
  if (!map[noteUrl]) map[noteUrl] = [];
  const exists = map[noteUrl].some(e => e.author === author && e.comment === comment);
  if (!exists) {
    map[noteUrl].push({ author, comment, repliedAt: Date.now() });
    await writePlain(REPLIED_KEY, map);
  }
}

/** 获取某篇笔记的本地已回复次数（防拉黑检查） */
async function getNoteReplyCount(noteUrl) {
  if (!noteUrl) return 0;
  const list = await getLocalRepliedForNote(noteUrl);
  return list.length;
}

/** 创建已回复提醒 Banner DOM 元素 */
function createRepliedBanner(count) {
  const div = document.createElement('div');
  const bgColor = '#fff3cd', borderColor = '#ffc107', textColor = '#856404';
  div.style.cssText = `padding:10px 14px;border-radius:6px;margin-bottom:10px;font-size:13px;font-weight:600;background:${bgColor};border:1px solid ${borderColor};color:${textColor};line-height:1.5;`;
  div.innerHTML = `📢 本条笔记已有 <strong>${count}</strong> 条回复记录，已自动从扫描中排除`;
  return div;
}

// ========== 初始化 ==========
/* ─── 左面板宽度可拖拽调节（拖中间分隔条） ─── */
function initPanelResizer() {
  const divider = document.getElementById('divider');
  const panelLeft = document.getElementById('panelLeft');
  if (!divider || !panelLeft) return;
  // 恢复上次保存的宽度
  try {
    chrome.storage.local.get('panel_left_width', function (d) {
      const w = d['panel_left_width'];
      if (w && !isNaN(w)) { panelLeft.style.width = w + 'px'; panelLeft.style.maxWidth = w + 'px'; }
    });
  } catch (_) {}
  let dragging = false;
  divider.addEventListener('mousedown', function (e) {
    if (divider.style.display === 'none' || panelLeft.style.display === 'none') return;
    dragging = true;
    divider.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    const rect = panelLeft.getBoundingClientRect();
    let w = e.clientX - rect.left;
    if (w < 200) w = 200;
    if (w > 620) w = 620;
    panelLeft.style.width = w + 'px';
    panelLeft.style.maxWidth = w + 'px';
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = Math.round(panelLeft.getBoundingClientRect().width);
    try { chrome.storage.local.set({ panel_left_width: w }); } catch (_) {}
  });
}

// ═══ 拟人化挡位（与设置页「⏱️ 停留时间」共享 delay_config / delay_preset）：顶部一键套用 ═══
const POPUP_DELAY_PRESETS = [
  { level:0, name:'0 极速·裸跑',
    cfg:{ browseDwell:{min:0,max:0}, typingCharDelay:{min:0,max:0}, likeGap:{min:300,max:300}, lazyLoadWait:{min:300,max:300}, retryBackWait:{min:300,max:300}, retryOpenWait:{min:800,max:800}, noteOpenBuffer:{min:300,max:300}, preSendGap:{min:400,max:400}, batchItemGap:{min:0,max:0} } },
  { level:1, name:'1 轻装·少量',
    cfg:{ browseDwell:{min:500,max:1000}, typingCharDelay:{min:0,max:0}, likeGap:{min:300,max:500}, lazyLoadWait:{min:300,max:600}, retryBackWait:{min:300,max:500}, retryOpenWait:{min:800,max:1200}, noteOpenBuffer:{min:300,max:500}, preSendGap:{min:300,max:600}, batchItemGap:{min:1000,max:2000} } },
  { level:2, name:'2 标准拟人（推荐）',
    cfg:{ browseDwell:{min:1200,max:2000}, typingCharDelay:{min:15,max:30}, likeGap:{min:300,max:600}, lazyLoadWait:{min:700,max:1100}, retryBackWait:{min:500,max:900}, retryOpenWait:{min:1100,max:2200}, noteOpenBuffer:{min:500,max:900}, preSendGap:{min:400,max:700}, batchItemGap:{min:4000,max:8000} } },
  { level:3, name:'3 保守拟人',
    cfg:{ browseDwell:{min:2000,max:4000}, typingCharDelay:{min:20,max:40}, likeGap:{min:800,max:1500}, lazyLoadWait:{min:1200,max:2000}, retryBackWait:{min:900,max:1500}, retryOpenWait:{min:2000,max:3500}, noteOpenBuffer:{min:1000,max:1800}, preSendGap:{min:800,max:1200}, batchItemGap:{min:8000,max:15000} } },
  { level:4, name:'4 重度·新号',
    cfg:{ browseDwell:{min:4000,max:8000}, typingCharDelay:{min:30,max:50}, likeGap:{min:1500,max:3000}, lazyLoadWait:{min:2000,max:3500}, retryBackWait:{min:1500,max:2500}, retryOpenWait:{min:3000,max:5000}, noteOpenBuffer:{min:1800,max:3000}, preSendGap:{min:1200,max:2000}, batchItemGap:{min:15000,max:30000} } },
  { level:5, name:'5 极致从容',
    cfg:{ browseDwell:{min:8000,max:15000}, typingCharDelay:{min:40,max:80}, likeGap:{min:3000,max:6000}, lazyLoadWait:{min:3500,max:6000}, retryBackWait:{min:2500,max:4000}, retryOpenWait:{min:5000,max:8000}, noteOpenBuffer:{min:3000,max:5000}, preSendGap:{min:1500,max:2500}, batchItemGap:{min:30000,max:60000} } },
];
const POPUP_DELAY_ROUND_LIMIT = { 0: 0, 1: 30, 2: 20, 3: 12, 4: 8, 5: 5 };
const POPUP_DELAY_KEYS = ['browseDwell','typingCharDelay','likeGap','lazyLoadWait','retryBackWait','retryOpenWait','noteOpenBuffer','preSendGap','batchItemGap'];
function popupPresetLevel(cfg) {
  const mid = c => ((Number(c.min)||0)+(Number(c.max)||0))/2;
  let total = 0; POPUP_DELAY_KEYS.forEach(k => { const m = (cfg&&cfg[k])?mid(cfg[k]):0; total += (k==='typingCharDelay'? m*1000 : m); });
  let best = 2, bd = Infinity;
  for (const p of POPUP_DELAY_PRESETS) { const t = POPUP_DELAY_KEYS.reduce((s,k)=>{ const m=(p.cfg[k])?mid(p.cfg[k]):0; return s+(k==='typingCharDelay'?m*1000:m); },0); const d=Math.abs(total-t); if(d<bd){bd=d;best=p.level;} }
  return best;
}
async function initDelayPresetSelector() {
  const sel = document.getElementById('plDelayPreset');
  if (!sel) return;
  POPUP_DELAY_PRESETS.forEach(p => { const o = document.createElement('option'); o.value = p.level; o.textContent = p.name; sel.appendChild(o); });
  let level = 2;
  try {
    const stored = (await chrome.storage.local.get(['delay_preset','delay_config'])) || {};
    const lvl = stored.delay_preset;
    if (lvl != null && POPUP_DELAY_PRESETS.some(p=>p.level===Number(lvl))) level = Number(lvl);
    else level = popupPresetLevel(stored.delay_config || {});
  } catch (_) {}
  sel.value = String(level);
  sel.addEventListener('change', async () => {
    const lvl = Number(sel.value);
    const p = POPUP_DELAY_PRESETS.find(x => x.level === lvl);
    if (!p) return;
    const cfg = {}; POPUP_DELAY_KEYS.forEach(k => cfg[k] = { min: p.cfg[k].min, max: p.cfg[k].max });
    try { await chrome.storage.local.set({ delay_config: cfg, delay_preset: lvl }); } catch (_) {}
    const pr = POPUP_DELAY_ROUND_LIMIT[lvl] != null ? POPUP_DELAY_ROUND_LIMIT[lvl] : 0;
    try {
      const aw = (await chrome.storage.local.get('auto_water_config')) || {};
      const cfg2 = aw.auto_water_config || {}; cfg2.schedule = cfg2.schedule || {}; cfg2.schedule.perRound = pr;
      await chrome.storage.local.set({ auto_water_config: cfg2 });
    } catch (_) {}
  });
}
document.addEventListener('DOMContentLoaded', async () => {
  initDelayPresetSelector();
  // ★ 立即用 DOM API 写入 mainContent，测试容器可操作性
  const mc = document.getElementById('mainContent');
  if (mc) {
    const loadMsg = document.createElement('div');
    loadMsg.style.cssText = 'padding:40px;text-align:center;font-size:14px;color:#555;';
    loadMsg.innerHTML = '⏳ 加载中...<br><span style="font-size:11px;color:#999;">如果持续显示此条，检查控制台(F12)错误</span>';
    mc.appendChild(loadMsg);
  }
  document.getElementById('refreshBtn')?.addEventListener('click', refreshData);
  document.getElementById('rescanBtn')?.addEventListener('click', refreshData);
  // ★ 首次设置：还没配 AI Key → 直接在 popup 内嵌两步面板（备份恢复 / 配置 AI），验证后在本人主页检测到缺 Key 即展示
  ensureFirstSetup();
  // 主功能 Tab：一级（诊断/发笔记/获客/用户清单）+ 获客二级（获客助手/灌水总结）+ 用户清单二级（清单/A触达/B问答）
  document.getElementById('tabCommentAssistant')?.addEventListener('click', () => switchMainTab('comment'));
  document.getElementById('tabNotifGroup')?.addEventListener('click', () => switchMainTab('notifAll'));
  document.getElementById('tabNotifAll')?.addEventListener('click', () => switchMainTab('notifAll'));
  document.getElementById('tabNotifComment')?.addEventListener('click', () => switchMainTab('notifComment'));
  document.getElementById('tabNotifLike')?.addEventListener('click', () => switchMainTab('notifLike'));
  document.getElementById('tabNotifFollow')?.addEventListener('click', () => switchMainTab('notifFollow'));
  document.getElementById('tabNotifAi')?.addEventListener('click', () => switchMainTab('notifAi'));
  document.getElementById('tabNotifConfig')?.addEventListener('click', () => switchMainTab('aiCsScene'));
  document.getElementById('tabMsgGroup')?.addEventListener('click', () => switchMainTab('prospectMsg'));
  document.getElementById('tabProspectList')?.addEventListener('click', () => switchMainTab('prospectMsg'));
  document.getElementById('tabAiCsQa')?.addEventListener('click', () => switchMainTab('aiCsQa'));
  document.getElementById('tabWaterSummary')?.addEventListener('click', () => switchMainTab('waterSummary'));
  document.getElementById('tabNotePublish')?.addEventListener('click', () => switchMainTab('notePublish'));
  document.getElementById('tabDiagnose')?.addEventListener('click', () => switchMainTab('diagnose'));
  document.getElementById('tabHuoke')?.addEventListener('click', () => switchMainTab('comment'));
  // ★ 默认落到「账号诊断」Tab（与按钮高亮一致；小窗模式后续仍强制收敛为状态卡）
  switchMainTab('diagnose');
  bindProspectModals();
  wireAccountGuardWatcher();
  document.getElementById('adminBtn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  addLog('获客助手已加载', 'info');
  // ★ 先应用版本限制（隐藏不属于本版本的功能、到期锁定）
  await applyEditionToPopup();
  // 初始化顶部租户切换器
  initTenantSwitcher();
  // ★ 窗口形态分流：大窗 = 全部操作；小窗 = 只读状态卡
  if (MODE_BIG) {
    // 大窗：显示全部 tab，隐藏切换按钮
    document.getElementById('bigWindowBtn')?.remove();
  } else {
    // 小窗 = 只读状态卡：隐藏功能 tab，把界面收敛为纯状态卡（全宽）
    ['tabCommentAssistant', 'tabWaterSummary', 'tabNotePublish', 'tabHuoke', 'tabNotifGroup', 'tabMsgGroup'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const _subT = document.getElementById('subTabs'); if (_subT) _subT.style.display = 'none';
    const _subT2 = document.getElementById('subTabs2'); if (_subT2) _subT2.style.display = 'none';
    const _subT3 = document.getElementById('subTabs3'); if (_subT3) _subT3.style.display = 'none';
    // 隐藏双栏/工具栏，只留状态卡（mainContent）
    const pl = document.getElementById('panelLeft');
    const dv = document.getElementById('divider');
    const rt = document.querySelector('.right-toolbar');
    const ni = document.getElementById('noteInfo');
    const sb = document.getElementById('statusBar');
    if (pl) pl.style.display = 'none';
    if (dv) dv.style.display = 'none';
    if (rt) rt.style.display = 'none';
    if (ni) ni.style.display = 'none';
    if (sb) sb.style.display = 'none';
    // 「↗ 大窗」按钮：手动打开大窗总览
    const _bigWinBtn = document.getElementById('bigWindowBtn');
    if (_bigWinBtn) _bigWinBtn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ action: 'openBigWindow', senderTab: null }).catch(() => {});
    });
    // 第一次点图标自动开大窗；之后仅显示状态卡（不打扰）
    chrome.storage.local.get('_big_ever_opened', (r) => {
      if (!r._big_ever_opened) {
        chrome.storage.local.set({ _big_ever_opened: true });
        chrome.runtime.sendMessage({ action: 'openBigWindow', senderTab: null }).catch(() => {});
      }
    });
    // 只读状态卡 + 轮询
    startStatusPolling();
  }
  // 初始化左侧笔记搜索面板（仅在含灌水功能的版本启用；不自动刷新评论助手）
  if (editionFeatureOn('autoWater')) {
    window.AutoWaterApp?.activate();
  }
  // 左面板宽度拖拽（始终可用，即便非灌水版分隔条被隐藏也不影响）
  initPanelResizer();
  // ★ 弹窗刚打开时并没有真的在抓页面（要等用户点「评论刷新」或从左侧列表打开笔记），
  //   所以这里把状态条与内容区落到「待机」态，别再一直显示“正在提取页面数据…”骗人。
  setStatus('⏸️ 待机中：点右上「🔄 评论刷新」开始扫描当前笔记' + (editionFeatureOn('autoWater') ? '，或从左侧列表打开一篇笔记' : ''), '');
  showIdle();
});

/* ─── 首次设置（内嵌在 popup）：验证后若缺 AI Key 直接展示；备份恢复 / 配置AI 分栏 ─── */
const FS_PROVIDERS = {
  deepseek:  { baseUrl: 'https://api.deepseek.com/v1',         models: [['deepseek-v4-flash', 'deepseek-v4-flash（新，快、省，推荐）'], ['deepseek-v4-pro', 'deepseek-v4-pro（新，更强，费 token）']] },
  openai:    { baseUrl: 'https://api.openai.com/v1',           models: [['gpt-4.1', 'GPT-4.1（旗舰，推荐）'], ['gpt-4.1-mini', 'GPT-4.1 Mini（性价比）'], ['gpt-4o-mini', 'GPT-4o Mini']] },
  qwen:      { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [['qwen-plus', 'Qwen Plus（均衡，推荐）'], ['qwen-turbo', 'Qwen Turbo'], ['qwen-max', 'Qwen Max'], ['qwen3.7-plus', 'Qwen3.7 Plus（最新）'], ['qwen3.7-max', 'Qwen3.7 Max（最新旗舰）']] },
  qianfan:   { baseUrl: 'https://qianfan.baidubce.com/v2',      models: [['ernie-4.5-turbo-32k', 'ERNIE 4.5 Turbo 32K（最便宜、推荐）'], ['ernie-4.5-turbo-128k', 'ERNIE 4.5 Turbo 128K']] },
  siliconflow:{ baseUrl: 'https://api.siliconflow.cn/v1',      models: [['deepseek-ai/DeepSeek-V4-Flash', 'DeepSeek V4 Flash'], ['Qwen/Qwen3.5-397B-A17B', 'Qwen3.5 397B（旗舰）'], ['zai-org/GLM-5.2', 'GLM-5.2（智谱）']] },
  gemini:    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [['gemini-2.5-flash', 'Gemini 2.5 Flash（免费，推荐）'], ['gemini-2.0-flash', 'Gemini 2.0 Flash（免费）']] },
  openrouter:{ baseUrl: 'https://openrouter.ai/api/v1',         models: [['deepseek/deepseek-chat-v3.2:free', 'DeepSeek V3.2（free）'], ['google/gemini-2.0-flash-001', 'Gemini 2.0 Flash']] },
  groq:      { baseUrl: 'https://api.groq.com/openai/v1',       models: [['llama-3.3-70b-versatile', 'Llama 3.3 70B（免费快）']] },
  zhipu:     { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: [['glm-4-flash', 'GLM-4-Flash（免费模型）'], ['glm-4-air', 'GLM-4-Air']] },
  custom:    { baseUrl: '', models: [] },
};
function fsProviderOf(val, id) {
  if (val === 'custom') return (document.getElementById(id)?.value || '').trim();
  return (FS_PROVIDERS[val] && FS_PROVIDERS[val].baseUrl) || '';
}
function fsFillModel(prov, cur, selId) {
  const sel = document.getElementById(selId); if (!sel) return;
  sel.innerHTML = '';
  const cfg = FS_PROVIDERS[prov];
  if (!cfg || prov === 'custom') {
    const quick = [['deepseek-v4-flash', 'deepseek-v4-flash（DeepSeek 新）'], ['gemini-2.5-flash', 'Gemini 2.5 Flash（免费）'], ['glm-4-flash', 'GLM-4-Flash（智谱免费）'], ['gpt-4o-mini', 'gpt-4o-mini（OpenAI）'], ['ernie-4.5-turbo-32k', 'ernie-4.5-turbo-32k（千帆）']];
    if (cur) { const o = new Option('当前：' + cur, cur, true, true); sel.appendChild(o); }
    quick.forEach(m => sel.appendChild(new Option(m[1], m[0])));
    return;
  }
  let has = !cur;
  cfg.models.forEach(m => { if (m[0] === cur) has = true; const o = new Option(m[1], m[0], false, m[0] === cur); sel.appendChild(o); });
  if (!has && cur) sel.insertBefore(new Option('当前：' + cur, cur, true, true), sel.firstChild);
}
function ensureFirstSetup() {
  (async function () {
    try {
      const got = await readConfigPlain();
      const ai = got.ai || {};
      if (ai.apiKey || ai.fallbackApiKey) return; // 已配置 AI，不展示
      if (document.getElementById('firstSetupPanel')) return;
      const ROOT = document.createElement('div');
      ROOT.id = 'firstSetupPanel';
      ROOT.style.cssText = 'position:fixed;inset:0;z-index:99980;background:rgba(22,22,26,0.97);color:#fff;overflow:auto;padding:22px 24px;box-sizing:border-box;';
      ROOT.innerHTML = `
        <style>
          .fs-col{background:#26262b;border:1px solid #33333a;border-radius:12px;padding:16px;}
          .fs-col h3{font-size:14px;margin:0 0 4px;}
          .fs-col .sub{font-size:12px;color:#a6a6b0;line-height:1.7;margin:0 0 12px;}
          .fs-field{margin-bottom:12px;}
          .fs-field label{display:block;font-size:12px;color:#a6a6b0;margin-bottom:5px;}
          .fs-field select,.fs-field input[type=password],.fs-field input[type=text]{width:100%;background:#1a1a1f;border:1px solid #3a3a44;border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;outline:none;}
          .fs-field select:focus,.fs-field input:focus{border-color:#5b8dff;}
          .fs-btn{width:100%;padding:10px;border:none;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;}
          .fs-primary{background:#ff274b;color:#fff;}
          .fs-import{background:transparent;border:1px dashed #5b8dff;color:#b9ceff;}
          .fs-msg{font-size:12px;line-height:1.6;margin-top:10px;min-height:16px;color:#7bd88f;}
          .fs-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:720px;margin:0 auto;}
          @media(max-width:560px){.fs-grid{grid-template-columns:1fr;}}
        </style>
        <div style="max-width:720px;margin:0 auto;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="font-size:26px;">🎯</span><h2 style="margin:0;font-size:18px;">先完成首次设置，才能开干</h2>
            <button id="fsClose" title="稍后再说" style="margin-left:auto;border:none;background:transparent;color:#aaa;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <p style="font-size:12.5px;color:#a6a6b0;margin:0 0 16px;">两种方式任选一种：<b>新装填 AI</b>，<b>迁移从备份恢复</b>。选服务商即可自动带出地址和模型，不用手敲 URL。</p>
          <div class="fs-grid">
            <div class="fs-col">
              <h3>📦 从备份恢复</h3>
              <p class="sub">导入之前导出的备份文件，产品、知识库、话术、AI 配置自动还原。</p>
              <input type="file" id="fsRestoreFile" accept="application/json,.json" style="display:none;">
              <label for="fsRestoreFile" id="fsRestoreBtn" class="fs-btn fs-import" style="display:block;text-align:center;cursor:pointer;">⬆ 选择备份文件导入</label>
              <div class="fs-msg" id="fsRestoreMsg"></div>
            </div>
            <div class="fs-col">
              <h3>⚙️ 配置 AI（日常对话 / 回复）</h3>
              <p class="sub">选一个已注册的服务商，填它的 API Key。Key 只存在你本地浏览器。</p>
              <div class="fs-field"><label>API 提供商</label><select id="fsProvider">
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="qwen">通义千问（阿里云）</option>
                <option value="siliconflow">硅基流动 SiliconFlow</option>
                <option value="qianfan">百度千帆 Qianfan</option>
                <option value="gemini">Google Gemini（免费）</option>
                <option value="openrouter">OpenRouter（免费路由）</option>
                <option value="groq">Groq（免费快）</option>
                <option value="zhipu">智谱 GLM（免费）</option>
                <option value="custom">自定义（手动填写地址）</option>
              </select></div>
              <div class="fs-field" id="fsCustomUrlWrap" style="display:none;"><label>自定义 API Base URL</label><input type="text" id="fsCustomUrl" placeholder="https://your-api.com/v1"></div>
              <div class="fs-field"><label>模型</label><select id="fsModel"><option value="" disabled selected>正在加载模型…</option></select></div>
              <div class="fs-field"><label>API Key *</label><input type="password" id="fsApiKey" placeholder="sk-…" autocomplete="off" style="font-family:monospace;"></div>
              <button class="fs-btn fs-primary" id="fsSave">保存并开始使用</button>
              <div class="fs-msg" id="fsMsg"></div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(ROOT);

      const $ = (s) => ROOT.querySelector('#' + s);
      const msg = (el, txt, ok) => { if (!el) return; el.style.color = ok === false ? '#ffb3c1' : ok === true ? '#7bd88f' : '#d3d3dc'; el.textContent = txt; };
      $('fsClose').onclick = () => ROOT.remove();
      // 提供商 → 模型联动
      const syncProv = () => {
        const p = $('fsProvider').value;
        const pcfg = FS_PROVIDERS[p];
        $('fsCustomUrlWrap').style.display = p === 'custom' ? '' : 'none';
        if (pcfg && p !== 'custom') $('fsCustomUrl').value = pcfg.baseUrl || '';
        fsFillModel(p, $('fsModel').value, 'fsModel');
      };
      $('fsProvider').addEventListener('change', syncProv);
      syncProv();
      // 从备份恢复
      $('fsRestoreBtn').onclick = () => $('fsRestoreFile').click();
      $('fsRestoreFile').onchange = async () => {
        const f = $('fsRestoreFile').files && $('fsRestoreFile').files[0];
        if (!f) return;
        const m = $('fsRestoreMsg'); msg(m, '读取备份文件…', false);
        let text = await f.text();
        if (CryptoBox.isFileEnvelope(text)) {
          const pw = await CryptoBox.askPassword({
            title: '输入备份口令',
            hint: '这个备份是加密文件，请输入导出时设置的口令。',
            okText: '解密导入',
          });
          if (!pw.ok) { $('fsRestoreFile').value = ''; return msg(m, '', false); }
          msg(m, '解密中…', false);
          try { text = await CryptoBox.decryptFile(text, pw.password); }
          catch (err) { $('fsRestoreFile').value = ''; return msg(m, '❌ ' + ((err && err.message) || err), false); }
        }
        let backup = null;
        try { backup = JSON.parse(text); } catch (_) { return msg(m, '❌ 文件不是合法的 JSON 备份', false); }
        if (!backup || !backup.tenants || !backup.data) return msg(m, '❌ 不是有效的备份文件（缺 tenants/data）', false);
        msg(m, '合并导入中…', false);
        let r = null;
        try { r = await chrome.runtime.sendMessage({ action: 'importAllData', data: { backup } }); } catch (e) { r = null; }
        if (!r || !r.ok) return msg(m, '❌ 导入失败：' + ((r && r.error) || '后台未响应'), false);
        await chrome.storage.local.set({ wizard_done: Date.now() });
        const cfg = (await readConfigPlain()).ai || {};
        msg(m, '✅ 已导入 ' + (r.importedTenants || 0) + ' 个产品。' + ((cfg.apiKey || cfg.fallbackApiKey) ? 'AI 配置已就绪！' : '备份里没 AI Key，请在右侧填写。'), true);
        $('fsRestoreFile').value = '';
        if (cfg.apiKey || cfg.fallbackApiKey) setTimeout(() => ROOT.remove(), 900);
      };
      // 保存 AI
      $('fsSave').onclick = async () => {
        const key = $('fsApiKey').value.trim();
        const m = $('fsMsg');
        const p = $('fsProvider').value;
        if (p === 'custom' && !/^https?:\/\//i.test($('fsCustomUrl').value.trim())) return msg(m, '请填正确的自定义 API 地址（以 http:// 开头），或改选服务商', false);
        if (!key) return msg(m, '请填写 API Key', false);
        const cfg = await readConfigPlain();
        cfg.ai = cfg.ai || {};
        cfg.ai.apiKey = key;
        cfg.ai.apiBaseUrl = fsProviderOf(p, 'fsCustomUrl') || 'https://api.deepseek.com/v1';
        cfg.ai.model = $('fsModel').value.trim() || 'deepseek-v4-flash';
        await writeConfigPlain(cfg);
        msg(m, '✅ 已保存，AI 已就绪！', true);
        setTimeout(() => ROOT.remove(), 700);
        try { if (typeof applyEditionToPopup === 'function') applyEditionToPopup(); } catch (_) {}
      };
    } catch (e) { console.error('[首次设置] 面板初始化失败:', e); }
    })();
}

/* ─── 主功能 Tab 切换：评论助手 / 灌水总结 / 用户清单(+AI客服) ─── */
let _chatFollowLoaded = false;
let _aiCsSceneLoaded = false;
let _aiCsQaLoaded = false;
let _prospectListLoaded = false;
let _touchQueue = [];          // 批量触达队列（草拟·确认，逐条）
let _touchBatchActive = false; // 批量触达是否进行中
let _touchBusy = false;        // 触达推进防重入锁
let _plHideBlocked = false;    // 是否隐藏"私信受限"
let _inboundAiScreen = true;   // 私信进线是否默认开 AI 筛选（筛掉刷号玩/无关）
let _selectedIds = new Set();  // 用户清单多选：勾选删除
let _outboundCollapsed = true; // 消息桶：我方触达分组默认折叠
let _syncInFlight = false;     // 通知同步防重入
const NOTIF_SYNC_CAP = 150;     // 单次同步新增上限（降为150，控制单次抓取体量以免动作过于集中）
function switchMainTab(name) {
  const tabComment = document.getElementById('tabCommentAssistant');
  const tabWater = document.getElementById('tabWaterSummary');
  const tabNote = document.getElementById('tabNotePublish');
  const tabDiag = document.getElementById('tabDiagnose');
  const tabHuoke = document.getElementById('tabHuoke');
  const tabNotifGroup = document.getElementById('tabNotifGroup');
  const tabMsgGroup = document.getElementById('tabMsgGroup');
  const tabNotifAll = document.getElementById('tabNotifAll');
  const tabNotifComment = document.getElementById('tabNotifComment');
  const tabNotifLike = document.getElementById('tabNotifLike');
  const tabNotifFollow = document.getElementById('tabNotifFollow');
  const tabNotifAi = document.getElementById('tabNotifAi');
  const tabNotifConfig = document.getElementById('tabNotifConfig');
  const tabProspectList = document.getElementById('tabProspectList');
  const tabQa = document.getElementById('tabAiCsQa');
  const subTabs = document.getElementById('subTabs');    // 获客分组
  const subTabs2 = document.getElementById('subTabs2');  // 通知分组
  const subTabs3 = document.getElementById('subTabs3');  // 消息分组
  const mc = document.getElementById('mainContent');
  const fc = document.getElementById('chatFollowContent');
  const pc = document.getElementById('prospectContent');
  const wc = document.getElementById('waterSummaryContent');
  const nc = document.getElementById('notePublishContent');
  const dc = document.getElementById('diagnoseContent');
  const scc = document.getElementById('aiCsSceneContent');
  const qcc = document.getElementById('aiCsQaContent');
  const _hideAll = () => { [mc, fc, pc, wc, nc, dc, scc, qcc].forEach(el => { if (el) el.style.display = 'none'; }); };
  const _markTop = (el) => {
    [tabComment, tabWater, tabNote, tabDiag, tabHuoke, tabNotifGroup, tabMsgGroup, tabProspectList, tabQa, tabNotifAll, tabNotifComment, tabNotifLike, tabNotifFollow, tabNotifAi, tabNotifConfig].forEach(t => { if (t) t.classList.remove('active'); });
    if (el) el.classList.add('active');
  };
  const _hideSub = () => { if (subTabs) subTabs.style.display = 'none'; if (subTabs2) subTabs2.style.display = 'none'; if (subTabs3) subTabs3.style.display = 'none'; };
  // 获客分组只有「获客助手」一个子页时（无灌水的版本），整条二级 Tab 栏隐藏，避免空条
  const _showSubHuoke = () => { if (subTabs) subTabs.style.display = document.getElementById('tabWaterSummary') ? '' : 'none'; if (subTabs2) subTabs2.style.display = 'none'; if (subTabs3) subTabs3.style.display = 'none'; };
  const _showSubNotif = () => { if (subTabs) subTabs.style.display = 'none'; if (subTabs2) subTabs2.style.display = ''; if (subTabs3) subTabs3.style.display = 'none'; };
  const _showSubMsg = () => { if (subTabs) subTabs.style.display = 'none'; if (subTabs2) subTabs2.style.display = 'none'; if (subTabs3) subTabs3.style.display = ''; };
  // ★ 通知分组下切子页前清掉通知二级高亮
  const _clearNotifSub = () => { [tabNotifAll, tabNotifComment, tabNotifLike, tabNotifFollow, tabNotifAi, tabNotifConfig].forEach(t => { if (t) t.classList.remove('active'); }); };
  const _clearMsgSub = () => { if (tabProspectList) tabProspectList.classList.remove('active'); if (tabQa) tabQa.classList.remove('active'); };

  if (name === 'notifAll' || name === 'notifComment' || name === 'notifLike' || name === 'notifFollow' || name === 'notifAi') {
    // 🔔 通知：按来源渠道看线索（不分渠道=全部）
    const CHANNEL_TAB = { notifAll: '', notifComment: 'comment', notifLike: 'like', notifFollow: 'follow', notifAi: 'ai' };
    const TAB_EL = { notifAll: tabNotifAll, notifComment: tabNotifComment, notifLike: tabNotifLike, notifFollow: tabNotifFollow, notifAi: tabNotifAi };
    _plStage = 'notif';
    _plChannelSel = CHANNEL_TAB[name] || '';
    _markTop(tabNotifGroup); _showSubNotif(); _clearNotifSub(); if (TAB_EL[name]) TAB_EL[name].classList.add('active'); _hideAll(); if (pc) pc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('prospectList'); _setProspectCleanMode(true);
    if (pc) loadProspectList(pc);
    return;
  }
  if (name === 'aiCsScene') {
    // 配置-通知（通知分组 · 配置）
    _plStage = 'notif'; _plChannelSel = ''; _markTop(tabNotifGroup); _showSubNotif(); _clearNotifSub(); if (tabNotifConfig) tabNotifConfig.classList.add('active'); _hideAll(); if (scc) scc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('prospectList'); _setProspectCleanMode(true);
    if (scc && !_aiCsSceneLoaded) { _aiCsSceneLoaded = true; renderAiCsScene(scc); }
    return;
  }
  if (name === 'prospectMsg') {
    // 📨 消息：用户清单（先挂住，待重做）
    _plStage = 'msg'; _markTop(tabMsgGroup); _showSubMsg(); _clearMsgSub(); if (tabProspectList) tabProspectList.classList.add('active'); _hideAll(); if (pc) pc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('prospectList'); _setProspectCleanMode(true);
    if (pc) loadProspectList(pc);
    return;
  }
  if (name === 'aiCsQa') {
    // 配置-消息（消息分组 · 配置）
    _markTop(tabMsgGroup); _showSubMsg(); _clearMsgSub(); if (tabQa) tabQa.classList.add('active'); _hideAll(); if (qcc) qcc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('prospectList'); _setProspectCleanMode(true);
    if (qcc && !_aiCsQaLoaded) { _aiCsQaLoaded = true; renderAiCsQa(qcc); }
    return;
  }
  if (name === 'waterSummary') {
    _markTop(tabHuoke); _showSubHuoke(); if (tabWater) tabWater.classList.add('active'); _hideAll(); if (wc) wc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('waterSummary');
    if (wc && !_waterSummaryLoaded) { _waterSummaryLoaded = true; renderWaterSummary(wc); }
    return;
  }
  if (name === 'notePublish') {
    _markTop(tabNote); _hideSub(); _hideAll(); if (nc) nc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('prospectList'); _setProspectCleanMode(true);
    if (nc && !_notePublishLoaded) { _notePublishLoaded = true; renderNotePublish(nc); }
    return;
  }
  if (name === 'diagnose') {
    _markTop(tabDiag); _hideSub(); _hideAll(); if (dc) dc.style.display = '';
    _setPanelLeftVisible(false); _setToolbarMode('prospectList'); _setProspectCleanMode(true);
    if (dc && !_diagLoaded) { _diagLoaded = true; renderDiagnosis(dc); }
    return;
  }
  // comment（获客助手）或默认
  _markTop(tabHuoke); _showSubHuoke(); if (tabComment) tabComment.classList.add('active'); _hideAll(); if (mc) mc.style.display = '';
  _setPanelLeftVisible(true); _setToolbarMode('comment'); _setProspectCleanMode(false);
}

// ★ 获客清单页：隐藏评论助手的整个工具栏（标题/返回列表/下拉按钮/刷新/设置）+ 状态栏 + noteInfo，只留清单内容
function _setProspectCleanMode(on) {
  const rt = document.querySelector('.right-toolbar');
  const sb = document.getElementById('statusBar');
  const ni = document.getElementById('noteInfo');
  const bl = document.getElementById('btnBackToList');
  const set = (el, d) => { if (el) el.style.display = d; };
  if (on) {
    set(rt, 'none'); set(sb, 'none'); set(ni, 'none'); set(bl, 'none');
  } else {
    set(rt, ''); set(sb, ''); set(ni, '');
    // bl(返回列表) 由评论区自身控制展示，这里不强制恢复
  }
}
let _waterSummaryLoaded = false;
let _notePublishLoaded = false;
let _diagLoaded = false;

/* ═══════════ ✍️ 发笔记（知识库 → AI 生成成稿 → 一键发布小红书笔记） ═══════════ */
function _npEl(container, id) { return container ? container.querySelector('#' + id) : null; }

let _npWiz = null;
let _npWizKeys = ['卖点', '人群', '话题', '成稿'];
let _lastScanWasAuto = false; // ★ 本次刷新是否由机器人/自动模式驱动（抓取异常时走"跳过"而非红色打断）

async function npUsedPool() {
  try { const d = await chrome.storage.local.get('np_used_topics'); const a = Array.isArray(d['np_used_topics']) ? d['np_used_topics'] : []; return a.map(x => (x && x.text) || '').filter(Boolean); } catch (_) { return []; }
}
async function npAddUsed(text) {
  if (!text) return;
  try { const d = await chrome.storage.local.get('np_used_topics'); const list = Array.isArray(d['np_used_topics']) ? d['np_used_topics'] : []; list.unshift({ text, fingerprint: String(text), addedAt: Date.now() }); if (list.length > 500) list.length = 500; await chrome.storage.local.set({ 'np_used_topics': list }); } catch (_) {}
}

// ✍️ 发笔记：AI 四层选题向导（卖点 → 人群 → 话题 → 成稿），不知识库先行
async function renderNotePublish(container) {
  _npWiz = { step: 0, sellPoints: [], chosen: [], concept: null, chosenTopicIdx: -1, chosenPeople: [], loading: false, prodName: '', sellImages: [] };
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line);font-weight:600;color:var(--ink);">
      <span>✍️ 发笔记 · AI 四层选题</span>
    </div>
    <div id="npSteps" style="padding:10px 14px;border-bottom:1px solid var(--line);font-size:11px;"></div>
    <div id="npWizBody" style="padding:12px 14px;"></div>
    <div id="npWizNav" style="padding:10px 14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap;"></div>
  `;
  _npActiveContainer = container;
  ensureNpDelegation();
  _npWiz.prodName = await getProductName();
  await npWizRender(container);
}

function npStepBar(container) {
  const el = _npEl(container, 'npSteps');
  if (!el || !_npWiz) return;
  const step = _npWiz.step;
  // 连接线（分隔两个 step），step 已过或当前进度后的线点亮
  const link = (after) =>
    '<span style="flex:1;height:2px;border-radius:2px;background:' +
    ((after < step || after <= step) ? 'linear-gradient(90deg,#ff2442,#ff6675);' : '#e5e6eb;') +
    'margin:0 4px 20px;"></span>';
  const badge = (i) => {
    const on = i < step;         // 已完成
    const cur = i === step;      // 当前
    const done = on || cur;
    const clickable = i <= step; // 可跳转：回到已完成/当前步骤
    return (clickable
      ? '<button type="button" data-ngo="' + i + '" style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1;flex:none;border:none;cursor:pointer;color:' +
        (done ? '#fff' : '#9aa0ac') +
        ';background:' + (done ? 'linear-gradient(135deg,#ff2442,#ff6675)' : '#eef0f4') +
        ';box-shadow:' + (cur ? '0 0 0 3px #ffe9ec;' : 'none') + '" title="跳转到此步骤">' + (on ? '✓' : (i + 1)) + '</button>'
      : '<span style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1;flex:none;color:#9aa0ac;background:#eef0f4;">' + (i + 1) + '</span>');
  };
  const label = (i) =>
    '<span style="text-align:center;font-size:11px;line-height:1.2;color:' +
    (i === step ? '#ff2442' : (i < step ? '#333' : '#9aa0ac')) +
    ';font-weight:' + (i === step ? '800' : '600') + ';">' +
    _npWizKeys[i] + '<br><span style="color:' + (i < step ? '#ff2442' : '#c6cad2') + ';font-weight:500;font-size:10px;">' +
    (onLabel(i)) + '</span></span>';
  el.innerHTML =
    '<div style="display:flex;align-items:flex-start;">' +
    _npWizKeys.map((s, i) =>
      '<div style="display:flex;flex-direction:column;align-items:center;width:44px;flex:none;">' + badge(i) + label(i) + '</div>' +
      (i < _npWizKeys.length - 1 ? link(i) : '')
    ).join('') + '</div>';
  el.querySelectorAll('[data-ngo]').forEach(elBtn => elBtn.addEventListener('click', function () {
    npGo(container, parseInt(this.getAttribute('data-ngo'), 10));
  }));
}
function npGo(container, i) {
  if (!_npWiz) return;
  if (i < 0 || i >= _npWizKeys.length || i > _npWiz.step) return; // 只能回到已达步骤，不许跳未来
  _npWiz.step = i;
  npStepBar(container); renderStep(container); npNav(container, navForStep());
}
function onLabel(i) {
  if (i === 0) return '卖的什么';
  if (i === 1) return '给谁看';
  if (i === 2) return '聊什么';
  return '定稿';
}
/** 成稿页顶部：本次发笔记的工作流选择汇总 */
function npChoicesSummary() {
  const w = _npWiz; if (!w) return '';
  const topic = (w.concept && w.concept.topics && w.concept.topics[w.chosenTopicIdx] && w.concept.topics[w.chosenTopicIdx].topic) || '';
  const sell = (w.chosen || []).map(x => x.point || x).filter(Boolean);
  const people = (w.chosenPeople || []).map(p => (p && p.name) || '').filter(Boolean);
  const cell = (label, icon, items, fallback) =>
    '<div style="flex:1;min-width:120px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 10px;">' +
    '<div style="font-size:10px;color:#8a929e;font-weight:700;margin-bottom:3px;">' + icon + ' ' + label + '</div>' +
    (items.length ? items.map(x => '<div style="font-size:11px;color:#333;font-weight:600;line-height:1.5;">' + esc(x) + '</div>').join('') : '<div style="font-size:11px;color:#bbb;">' + esc(fallback) + '</div>') +
    '</div>';
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px;">' +
    cell('① 卖点', '🎯', sell, '未选') +
    cell('② 人群', '👥', people, '未选') +
    cell('③ 话题', '💬', topic ? [topic] : [], '未选') +
    '<div style="width:100%;font-size:10px;color:#9aa0ac;">④ 成稿 · 已按以上 ①②③ 生成，下面直接定稿：</div>' +
    '</div>';
}
function npBody(container, html) { const el = _npEl(container, 'npWizBody'); if (el) el.innerHTML = html; }
function npNav(container, items) { const el = _npEl(container, 'npWizNav'); if (el) el.innerHTML = items || ''; }
function btnWiz(cls, label, primary, disabled) {
  return '<button class="' + cls + '" type="button" style="padding:8px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;' + (primary ? 'border:none;background:linear-gradient(135deg,#ff2442,#ff6373);color:#fff;' : 'border:1px solid var(--line);background:#fff;color:#666;') + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
}

async function npWizRender(container) {
  if (!_npWiz) return;
  if (_npWiz.step === 0 && !_npWiz.sellPoints.length && !_npWiz.loading) { await npLoadSellPoints(container); return; }
  if (_npWiz.step >= 1 && !_npWiz.concept && !_npWiz.loading) { await npLoadConcept(container); return; }
  npStepBar(container);
  renderStep(container);
  npNav(container, navForStep());
}

async function npLoadSellPoints(container) {
  _npWiz.loading = true;
  // ① 优先使用用户在「设置→基本配置→产品卖点」维护的卖点（含配图），直接列出可选
  try {
    const c = await readConfigPlain();
    const spList = (c && c.product && c.product.sellPoints) || [];
    const manual = spList.filter(s => s && (String(s.title || '').trim() || String(s.content || '').trim()));
    if (manual.length) {
      _npWiz.sellPoints = manual.map(s => ({
        point: String(s.title || '').trim(),
        why: String(s.content || '').trim(),
        type: '', play: '',
        image: String(s.image || ''),
        manual: true,
      }));
      _npWiz.strategy = '来自你在「设置→基本配置→产品卖点」维护的卖点，选中后下方会列出对应配图';
      _npWiz.loading = false;
      await npWizRender(container);
      return;
    }
  } catch (_) {}
  // ② 未维护卖点时，退回 AI 从产品描述提炼
  npBody(container, '<div style="font-size:12px;color:#888;">⏳ AI 正在从你的产品提炼可推的卖点…</div>');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'aiGenerateSellPoints' });
    _npWiz.sellPoints = (res && res.sell_points) || [];
    _npWiz.strategy = (res && res.strategy) || '';
  } catch (e) {
    npBody(container, '<div style="font-size:12px;color:#d32f2f;">提炼卖点失败，请在设置里填产品名/卖点：' + ((e && e.message) || e) + '</div>');
    _npWiz.loading = false; return;
  }
  _npWiz.loading = false;
  await npWizRender(container);
}

async function npLoadConcept(container) {
  _npWiz.loading = true;
  npBody(container, '<div style="font-size:12px;color:#888;">⏳ AI 正在推导目标人群 + 候选话题…</div>');
  try {
    const used = await npUsedPool();
    _npWiz.usedPool = used;
    const res = await chrome.runtime.sendMessage({ action: 'aiGenerateConcept', sellPoints: _npWiz.chosen, usedPool: used });
    _npWiz.concept = res;
  } catch (e) {
    npBody(container, '<div style="font-size:12px;color:#d32f2f;">加载人群/话题失败：' + ((e && e.message) || e) + '</div>');
    _npWiz.loading = false; return;
  }
  _npWiz.loading = false;
  await npWizRender(container);
}

function renderStep(container) {
  const s = _npWiz.step;
  if (s === 0) {
    const sp = _npWiz.sellPoints || [];
    const chosenIdx = _npWiz.chosen.map(x => x.__i);
    const strategyHtml = (_npWiz.strategy ? '<div style="font-size:11px;color:#666;background:#fff7f8;border-radius:8px;padding:6px 10px;margin-bottom:8px;">🎯 你的产品整体打法：' + esc(_npWiz.strategy) + '</div>' : '');
    npBody(container, '<div style="font-size:12px;font-weight:700;color:#333;margin-bottom:6px;">① 选这次要推的卖点（可多选，每篇只推 1~2 个）</div>' + strategyHtml +
      (sp.length ? sp.map((p, i) =>
        '<label style="display:flex;gap:8px;align-items:flex-start;padding:8px;margin-bottom:6px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font-size:12px;color:#333;">' +
        '<input type="checkbox" class="np-spk" data-i="' + i + '"' + (chosenIdx.includes(i) ? ' checked' : '') + '>' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;">' + esc(p.point || '') + (p.type ? ' <span style="font-size:10px;color:#fff;background:' + ((p.type === '工具') ? '#2563eb' : '#c026a3') + ';border-radius:6px;padding:0 4px;">' + esc(p.type) + '</span>' : '') + '</div>' +
        (p.why ? '<div style="font-size:11px;color:#666;margin-top:2px;">' + esc(p.why) + '</div>' : '') +
        (p.play ? '<div style="font-size:11px;color:#1f6feb;margin-top:2px;">打法：' + esc(p.play) + '</div>' : '') +
        (p.image ? '<div style="font-size:10px;color:#c026a3;margin-top:3px;">📷 已配图，选中后作文案配图元素</div>' : '') +
        '</div>' +
        (p.image ? '<img src="' + p.image + '" style="flex:none;width:56px;height:52px;object-fit:cover;border-radius:6px;border:1px solid #eee;">' : '') +
        '</label>').join('')
        : '<div style="font-size:11px;color:#999;">暂无可选卖点，点换一批</div>'));
    return;
  }
  if (s === 1) {
    const opts = (_npWiz.concept && _npWiz.concept.people_options) || [];
    const selIdx = (_npWiz.chosenPeople || []).map(p => p && p.__i);
    npBody(container, '<div style="font-size:12px;font-weight:700;color:#333;margin-bottom:6px;">② 选这次要覆盖的人群（可多选，成稿会针对你勾的人群写）</div>' +
      (opts.length ? opts.map((p, i) =>
        '<label style="display:flex;gap:8px;align-items:flex-start;padding:8px;margin-bottom:6px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font-size:12px;color:#333;">' +
        '<input type="checkbox" class="np-ppc" data-i="' + i + '"' + (selIdx.includes(i) ? ' checked' : '') + '>' +
        '<div><div style="font-weight:600;">' + esc(p.name || '（人群）') + '</div>' +
        (p.pain ? '<div style="font-size:11px;color:#666;margin-top:2px;">痛点：' + esc(p.pain) + '</div>' : '') +
        (p.scene ? '<div style="font-size:11px;color:#1f6feb;margin-top:2px;">场景：' + esc(p.scene) + '</div>' : '') +
        (p.timing ? '<div style="font-size:11px;color:#8a6d3b;margin-top:2px;">时机：' + esc(p.timing) + '</div>' : '') + '</div></label>').join('')
        : '<div style="font-size:11px;color:#999;">暂无候选人群，点换一批</div>'));
    return;
  }
  if (s === 2) {
    const ts = ((_npWiz.concept && _npWiz.concept.topics) || []);
    npBody(container, '<div style="font-size:12px;font-weight:700;color:#333;margin-bottom:6px;">③ 选一个话题（点选；附推荐逻辑 + 是否与已发同类）</div>' +
      (ts.length ? ts.map((t, i) => {
        const cf = _npTopicConflict(t.topic);
        return '<label class="np-tp" style="display:block;padding:8px;margin-bottom:6px;border:1px solid ' + (i === _npWiz.chosenTopicIdx ? '#ff2442' : 'var(--line)') + ';border-radius:8px;background:' + (i === _npWiz.chosenTopicIdx ? '#fff5f6' : '#fff') + ';cursor:pointer;font-size:12px;color:#333;">' +
        '<input type="radio" name="npTopic" class="np-tpc" data-i="' + i + '"' + (i === _npWiz.chosenTopicIdx ? ' checked' : '') + '> <b>' + esc(t.topic || '') + '</b>' +
        (t.angle ? '<div style="font-size:11px;color:#666;margin-top:2px;">切入点：' + esc(t.angle) + '</div>' : '') +
        (t.target ? '<div style="font-size:11px;color:#666;">瞄：' + esc(t.target) + '</div>' : '') +
        (cf ? '<div style="font-size:11px;color:#b45309;margin-top:3px;">⚠️ 与本号已发过同类：「' + esc(cf) + '」。同类多了容易审美疲劳——想突破建议选其他角度；若你新切入有差异化也仍可用</div>'
          : '<div style="font-size:11px;color:#2e7d32;margin-top:3px;">✅ 与本号已发内容不重复，可放心选</div>') +
        (t.rationale ? '<div style="font-size:11px;color:#8a6d3b;margin-top:3px;">🧭 推荐逻辑：' + esc(t.rationale) + '</div>' : '') +
        '</label>';
      }).join('') : '<div style="font-size:11px;color:#999;">暂无候选话题，点换一批</div>'));
    return;
  }
  if (s === 3) {
    npBody(container, npChoicesSummary() +
      '<div style="font-size:12px;font-weight:700;color:#333;margin-bottom:6px;">④ 成稿（标题/正文/配图文案可再改）</div>' +
      '<div id="npTitles" style="margin-bottom:8px;"></div>' +
      '<div style="font-size:11px;font-weight:700;color:#333;margin:8px 0 4px;">📝 正文</div>' +
      '<textarea id="npResult" rows="8" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:12px;line-height:1.6;resize:vertical;"></textarea>' +
      '<div id="npTags" style="margin:8px 0;"></div>' +
      '<div id="npKbMd" style="margin:8px 0;"></div>' +
      '<div id="npMindMap" style="margin:8px 0;"></div>' +
      '<div id="npCover" style="margin:8px 0;"></div>' +
      '<div id="npSelf" style="margin:8px 0;"></div>' +
      '<div id="npPromptPack" style="margin:8px 0;"></div>' +
      '<div id="npExtras" style="font-size:11px;color:#666;background:#f7f7f8;border-radius:8px;padding:8px 10px;margin-top:8px;"></div>');
    npBuildDraft(container);
  }
}

async function npBuildDraft(container) {
  _npImgResults = [];
  _npCoverAi = null; // 重新生成成稿时，封面回到「规则排版」
  const tl = (_npWiz.concept && _npWiz.concept.topics) || [];
  const t = tl[(_npWiz.chosenTopicIdx >= 0 && _npWiz.chosenTopicIdx < tl.length) ? _npWiz.chosenTopicIdx : 0] || {};
  const sellPointStr = (_npWiz.chosen || []).map((x, i) => {
    const t = String(x.point || x || '').trim();
    const c = String(x.content || x.why || '').trim();
    return (t && c) ? t + '：' + c : (t || c);
  }).filter(Boolean).join('；');
  const sellImages = (_npWiz.chosen || []).map(x => (x && x.image) || '').filter(Boolean);
  _npWiz.sellImages = sellImages;
  try {
    const res = await chrome.runtime.sendMessage({
      action: 'aiRewriteNote',
      topic: t.topic || '',
      sellPoint: sellPointStr,
      sellImages: sellImages,
      people: (_npWiz.chosenPeople || []).map(p => ({ name: (p && p.name) || '', pain: (p && p.pain) || '', scene: (p && p.scene) || '', timing: (p && p.timing) || '' })),
      productName: _npWiz.prodName,
      kb: null,
    });
    const d = res && res.data;
    if (_npWiz) _npWiz.draft = d;
    if (d && d.content) {
      renderNpMaterial(container, d);
      npRenderCover(container);
      const sc = (d.selfComment && String(d.selfComment).trim()) ? [String(d.selfComment).trim()] : [];
      _npWiz.selfCands = sc;
      _npWiz.selfIdx = 0;
      renderNpSelf(container);
      // 配图文案 MD + 思维导图：按当前话题从知识库生成，再渲染成树状脑图
      renderNpMindMapBlock(container);
      npLoadKbMd(container, t.topic || _npWiz.prodName);
      // 提示词包：拼好整合资料，供生成 文案/封面配图/口播/视频 提示词
      renderNpPromptPack(container);
      npPackBuildCtx(container);
    }
    else { const te = _npEl(container, 'npResult'); if (te) te.value = (res && res.copy) || ''; }
  } catch (e) {
    const te = _npEl(container, 'npResult'); if (te) te.value = '生成成稿失败：' + ((e && e.message) || e);
  }
}

function navForStep() {
  const s = _npWiz.step;
  const back = (s > 0) ? btnWiz('np-wiz-prev', '上一步', false) : '';
  if (s === 0) return back + ' <span style="flex:1;"></span> ' + btnWiz('np-wiz-again', '🔀 换一批', false) + ' ' + btnWiz('np-wiz-next', '下一步 →', true, true);
  if (s === 1) return back + ' <span style="flex:1;"></span> ' + btnWiz('np-wiz-again', '🔀 换成别人群/话题', false) + ' ' + btnWiz('np-wiz-next', '用了所选人群 · 去看话题 →', true, true);
  if (s === 2) return back + ' <span style="flex:1;"></span> ' + btnWiz('np-wiz-again', '🔀 换一批', false) + ' ' + btnWiz('np-wiz-next', '就用这篇 →', true, true);
  return back + ' ' + btnWiz('np-copy-result', '📋 复制成稿', true) + ' <span style="flex:1;"></span> ' + btnWiz('np-wiz-again', '🔄 重新生成', false) + ' ' + btnWiz('np-wiz-next', '↩ 再来一篇(新卖点)', false);
}

// 🤖 AI 生成文案：选参考素材 + 引导话题 → AI 生成 → 复制
let _npActiveKB = null;
let _npActiveContainer = null;
let _npDelegated = false;
function ensureNpDelegation() {
  if (_npDelegated) return;
  _npDelegated = true;
  document.addEventListener('click', function (ev) {
    const t = ev.target;
    const nc = document.getElementById('notePublishContent') || _npActiveContainer;
    if (!nc) return;
    if (t && t.closest('.np-gen')) { npGenerateNote(nc); return; }
    if (t && t.closest('.np-gen-again')) { npGenerateNote(nc); return; }
    if (t && t.closest('.np-copy-result')) { npCopyResult(nc); return; }
    if (t && t.closest('.np-refresh')) { _notePublishLoaded = false; renderNotePublish(nc); return; }
    if (t && t.closest('.np-wiz-next')) { npWizNext(nc); return; }
    if (t && t.closest('.np-wiz-prev')) { if (_npWiz && _npWiz.step > 0) { _npWiz.step--; npWizRender(nc); } return; }
    if (t && t.closest('.np-wiz-again')) { npWizAgain(nc); return; }
    if (t && t.closest('.np-spk')) { npCollectChosen(nc); return; }
    if (t && t.closest('.np-ppc')) { npCollectPeople(nc); return; }
    if (t && t.closest('.np-tp')) { const item = t.closest('.np-tp'); const rb = item.querySelector('.np-tpc'); if (rb) rb.checked = true; _npWiz.chosenTopicIdx = (rb ? parseInt(rb.getAttribute('data-i'), 10) : 0) || 0; const navEl = _npEl(nc, 'npWizNav'); const nb = navEl ? navEl.querySelector('.np-wiz-next') : null; if (nb) nb.disabled = false; return; }
    if (t && t.closest('.np-copy-self')) { const elt = t.closest('.np-copy-self'); const value = elt.getAttribute('data-text') || ''; if (value) { copyToClipboard(value).then(() => { try { if (typeof toast === 'function') toast('置顶自评已复制'); } catch (_) {} }).catch(() => {}); } return; }
    if (t && t.closest('.np-self-again')) { loadSelfComment(nc); return; }
    if (t && t.closest('.np-self-pick')) { const i = parseInt(t.closest('.np-self-pick').getAttribute('data-i'), 10); if (!isNaN(i)) npSelfPick(nc, i); return; }
    if (t && t.closest('.np-self-copy')) { const el = t.closest('.np-self-copy'); const v = el.getAttribute('data-text') || ''; if (v && typeof copyToClipboard === 'function') copyToClipboard(v).then(() => { if (typeof toast === 'function') toast('置顶自评已复制'); }).catch(() => {}); return; }
    // 配图文案 MD：生成 / 重排 / 渲染思维导图 / 复制 / 下载
    if (t && t.closest('.np-mm-ai')) { npAiKbMd(nc); return; }
    if (t && t.closest('.np-mm-render')) { npRenderMindMapFromTextarea(nc); return; }
    if (t && t.closest('.np-mm-copy')) { const cv = _npMindCanvas; if (cv) { copyImageToClipboard(cv.toDataURL('image/png')).then(ok => { if (typeof toast === 'function') toast(ok ? '思维导图已复制，去小红书粘贴' : '复制失败，请点「下载」'); }).catch(() => { if (typeof toast === 'function') toast('复制失败，请点「下载」'); }); } return; }
    if (t && t.closest('.np-mm-dl')) { const cv = _npMindCanvas; if (cv) downloadImageDataUrl(cv.toDataURL('image/png'), 'mindmap.png'); return; }
    if (t && t.closest('.np-pack-gen')) { npPackGen(nc); return; }
    if (t && t.closest('.np-pack-copy')) { const k = t.closest('.np-pack-copy').getAttribute('data-k') || ''; const v = (_npPackResult && _npPackResult[k]) || ''; if (v && typeof copyToClipboard === 'function') copyToClipboard(v).then(() => { if (typeof toast === 'function') toast('已复制「' + ({ copy: '文案', cover: '封面配图', voice: '口播稿', video: '视频稿' }[k] || k) + '」提示词，去粘贴使用'); }).catch(() => {}); return; }
    if (t && t.closest('.np-cover-ai')) { npAiLayoutCover(nc); return; }
    if (t && t.closest('.np-cover-copy')) { const cv = _npCoverCanvas; if (cv) { copyImageToClipboard(cv.toDataURL('image/png')).then(ok => { if (typeof toast === 'function') toast(ok ? '封面已复制，去小红书粘贴' : '复制失败，请点「下载」'); }).catch(() => { if (typeof toast === 'function') toast('复制失败，请点「下载」'); }); } return; }
    if (t && t.closest('.np-cover-dl')) { const cv = _npCoverCanvas; if (cv) downloadImageDataUrl(cv.toDataURL('image/png'), 'cover.png'); return; }
  });
}

function npCollectPeople(nc) {
  const opts = (_npWiz && _npWiz.concept && _npWiz.concept.people_options) || [];
  const body = _npEl(nc, 'npWizBody');
  const idx = [];
  if (body) body.querySelectorAll('.np-ppc:checked').forEach(cb => { const i = parseInt(cb.getAttribute('data-i'), 10); if (!isNaN(i)) idx.push(i); });
  _npWiz.chosenPeople = idx.map(i => Object.assign({ __i: i }, opts[i] || {}));
  const navEl = _npEl(nc, 'npWizNav');
  const nextBtn = navEl ? navEl.querySelector('.np-wiz-next') : null;
  if (_npWiz.step === 1 && nextBtn) nextBtn.disabled = !_npWiz.chosenPeople.length;
}

function npCollectChosen(nc) {
  const sp = (_npWiz && _npWiz.sellPoints) || [];
  const body = _npEl(nc, 'npWizBody');
  const idx = [];
  if (body) body.querySelectorAll('.np-spk:checked').forEach(cb => { const i = parseInt(cb.getAttribute('data-i'), 10); if (!isNaN(i)) idx.push(i); });
  _npWiz.chosen = idx.slice(0, 2).map(i => ({ __i: i, point: (sp[i] && sp[i].point) || '', why: (sp[i] && sp[i].why) || '', content: (sp[i] && sp[i].content) || (sp[i] && sp[i].why) || '', image: (sp[i] && sp[i].image) || '' }));
  const navEl = _npEl(nc, 'npWizNav');
  const nextBtn = navEl ? navEl.querySelector('.np-wiz-next') : null;
  if (_npWiz.step === 0 && nextBtn) nextBtn.disabled = !_npWiz.chosen.length;
}

async function npWizNext(nc) {
  if (!_npWiz) return;
  if (_npWiz.step === 0) { npCollectChosen(nc); if (!_npWiz.chosen.length) { if (typeof toast === 'function') toast('请先选要推的卖点', 'error'); return; } }
  if (_npWiz.step === 1) { npCollectPeople(nc); if (!(_npWiz.chosenPeople || []).length) { if (typeof toast === 'function') toast('请至少选一个人群', 'error'); return; } }
  if (_npWiz.step === 2 && _npWiz.chosenTopicIdx < 0) { if (typeof toast === 'function') toast('请先选一个话题', 'error'); return; }
  if (_npWiz.step === 3) { _npWiz.sellPoints = []; _npWiz.chosen = []; _npWiz.concept = null; _npWiz.chosenTopicIdx = -1; _npWiz.step = 0; await npWizRender(nc); return; }
  _npWiz.step++;
  if (_npWiz.step === 2 && _npWiz.chosenTopicIdx < 0 && (_npWiz.concept && (_npWiz.concept.topics || []).length)) _npWiz.chosenTopicIdx = 0;
  if (_npWiz.step === 1 && !_npWiz.concept) { await npWizRender(nc); return; }
  if (_npWiz.step === 1) { npStepBar(nc); renderStep(nc); npNav(nc, navForStep()); return; }
  await npWizRender(nc);
}

async function npWizAgain(nc) {
  if (!_npWiz) return;
  const s = _npWiz.step;
  if (s === 0) { _npWiz.sellPoints = []; _npWiz.chosen = []; }
  else if (s === 1 || s === 2) { _npWiz.concept = null; _npWiz.chosenTopicIdx = -1; _npWiz.chosenPeople = []; }
  else if (s === 3) { npBuildDraft(nc); return; }
  await npWizRender(nc);
}

// 判断某个话题是否与本号已发过的话题"同类"（核心字重叠度），用于提示；返回命中那条原文，无则 null
function _npTopicConflict(topic) {
  const used = (_npWiz && _npWiz.usedPool) || [];
  if (!used.length) return null;
  const stop = '的了我你他因为它这个是就是很都在和跟与也还应该让给对把被能会见就没要着'.split('');
  const core = (s) => {
    const a = String(s || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
    const ks = {};
    let out = '';
    for (const ch of a) { if (!stop.includes(ch) && !ks[ch]) { ks[ch] = 1; out += ch; } }
    return out;
  };
  const cc = core(topic);
  if (!cc || !cc.length) return null;
  for (const u of used) {
    const uc = core(u);
    if (!uc || !uc.length) continue;
    let hit = 0;
    for (const ch of cc) if (uc.includes(ch)) hit++;
    if (hit >= Math.min(3, cc.length) && hit >= 3) return u; // 核心字重叠 ≥3 即判同类
  }
  return null;
}

let _npNote = { title: '', tags: [], titleIdx: 0 };
let _npImgResults = [];
let _lastNoteDraft = null;
async function getProductName() {
  try { const c = await readConfigPlain(); return (c.product && c.product.name) || ''; } catch (_) { return ''; }
}

async function npGenerateNote(container) {
  const refSel = _npEl(container, 'npRefSel');
  const topicEl = _npEl(container, 'npTopic');
  const statusEl = _npEl(container, 'npStatus');
  const topic = (topicEl && topicEl.value || '').trim();
  if (!topic) { if (statusEl) { statusEl.textContent = '⚠️ 请先填写引导话题描述'; statusEl.style.color = '#e07b00'; } return; }
  const refId = refSel && refSel.value;
  const kb = (refId && Array.isArray(_npActiveKB)) ? _npActiveKB.find(x => String(x.id) === String(refId)) : null;
  const genBtn = container.querySelector('.np-gen');
  if (genBtn) { genBtn.disabled = true; genBtn.textContent = '🤖 生成中…'; }
  if (statusEl) { statusEl.textContent = '⏳ AI 生成中，请稍候…'; statusEl.style.color = '#666'; }
  try {
    const prodName = await getProductName();
    const res = await chrome.runtime.sendMessage({ action: 'aiRewriteNote', topic, kb: kb ? { title: kb.title, content: kb.content, tags: kb.tags || [] } : null, productName: prodName });
    if (statusEl) { statusEl.textContent = '✅ 已生成 —— 点选标题 / 编辑正文，再「复制成稿」'; statusEl.style.color = '#2e7d32'; }
    const d = res && res.data;
    if (d && d.content) renderNpMaterial(container, d);
    else {
      const text = (res && res.copy) || '';
      const wrap = _npEl(container, 'npResultWrap'); if (wrap) wrap.style.display = 'block';
      const resultEl = _npEl(container, 'npResult'); if (resultEl) resultEl.value = text;
      _npNote = { title: '', tags: [], titleIdx: 0 };
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '❌ 生成失败：' + ((e && e.message) || e); statusEl.style.color = '#d32f2f'; }
  } finally {
    if (genBtn) { genBtn.disabled = false; genBtn.textContent = '🤖 生成文案'; }
  }
}

function renderNpMaterial(container, d) {
  _lastNoteDraft = d || null;
  _npNote = { title: '', tags: (d.tags || []).slice(), titleIdx: 0 };
  const wrap = _npEl(container, 'npResultWrap'); if (wrap) wrap.style.display = 'block';
  const titles = d.titles || [];
  const titlesBox = _npEl(container, 'npTitles');
  if (titlesBox) {
    titlesBox.innerHTML = '<div style="font-size:11px;font-weight:700;color:#333;margin-bottom:4px;">选择标题</div>' + titles.map((t, i) =>
      '<label style="display:flex;gap:6px;align-items:flex-start;padding:6px 8px;margin-bottom:4px;border:1px solid ' + (i === 0 ? '#ff2442' : 'var(--line)') + ';border-radius:8px;background:' + (i === 0 ? '#fff5f6' : '#fff') + ';cursor:pointer;font-size:12px;line-height:1.5;color:#333;">' +
      '<input type="radio" name="npTitle" value="' + i + '"' + (i === 0 ? ' checked' : '') + ' style="margin-top:2px;">' +
      '<span>' + esc(t) + '</span></label>').join('');
    titlesBox.querySelectorAll('input[name="npTitle"]').forEach(r => r.addEventListener('change', function () {
      _npNote.titleIdx = parseInt(this.value, 10) || 0;
      _npNote.title = titles[_npNote.titleIdx] || '';
      // 封面标题跟随所选标题
      if (d && d.cover && _npNote.title) d.cover.title = _npNote.title;
      npRenderCover(container);
    }));
    _npNote.title = titles[0] || '';
    // 默认封面就用第一个标题
    if (d && d.cover && _npNote.title) d.cover.title = _npNote.title;
  }
  const resultEl = _npEl(container, 'npResult'); if (resultEl) resultEl.value = d.content || '';
  renderNpTags(container, d);
  const ext = _npEl(container, 'npExtras');
  const parts = [];
  if (d.timeTip) parts.push('⏰ 建议发布：' + esc(d.timeTip));
  if (ext) ext.innerHTML = parts.join('<br>');
}

function renderNpSelf(container) {
  const box = _npEl(container, 'npSelf');
  if (!box) return;
  const cands = (_npWiz && _npWiz.selfCands) || [];
  const idx = (_npWiz && _npWiz.selfIdx) || 0;
  const cur = cands[idx] || '';
  box.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
      '<div style="font-size:11px;font-weight:700;color:#333;">📌 置顶自评（发完 1 小时内贴）</div>' +
      '<button class="np-self-again" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 8px;">🔄 换一批</button>' +
    '</div>' +
    (cands.length ? cands.map((c, i) => '<label style="display:flex;gap:6px;align-items:flex-start;margin-bottom:4px;font-size:11px;cursor:pointer;color:#555;">' +
      '<input type="radio" name="npSelf" class="np-self-pick" data-i="' + i + '"' + (i === idx ? ' checked' : '') + ' style="margin-top:2px;"> <span>' + esc(c) + '</span></label>').join('') : '<div style="font-size:11px;color:#999;">置顶自评生成中…</div>') +
    (cur ? '<div style="background:#fff7e6;border:1px solid #f0e0b8;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.7;margin-top:4px;">' + esc(cur) + '</div>' : '') +
    (cur ? '<button class="np-self-copy" data-text="' + String(cur).replace(/"/g, '&quot;') + '" style="border:1px solid #ff2442;border-radius:6px;background:#fff;color:#ff2442;font-size:11px;cursor:pointer;padding:2px 10px;margin-top:4px;">📋 复制置顶自评</button>' : '');
}

async function loadSelfComment(container) {
  const tl = (_npWiz && _npWiz.concept && _npWiz.concept.topics) || [];
  const t = tl[(_npWiz && _npWiz.chosenTopicIdx >= 0 && _npWiz.chosenTopicIdx < tl.length) ? _npWiz.chosenTopicIdx : 0] || {};
  try {
    const res = await chrome.runtime.sendMessage({
      action: 'aiGenerateSelfComment',
      topic: t.topic || '',
      sellPoint: (_npWiz.chosen || []).map(x => x.point || x).join('、'),
      people: (_npWiz.chosenPeople || []).map(p => ({ name: (p && p.name) || '', pain: (p && p.pain) || '' })),
      productName: _npWiz.prodName,
    });
    const cands = (res && res.candidates) || [];
    if (!cands.length) { npSelfFallback(container); return; }
    _npWiz.selfCands = cands;
    _npWiz.selfIdx = 0;
  } catch (_) { npSelfFallback(container); return; }
  renderNpSelf(container);
}

function npSelfFallback(container) {
  const d = (_npWiz && _npWiz.draft) || {};
  const sc = (d && d.selfComment && String(d.selfComment).trim()) ? [String(d.selfComment).trim()] : ['这篇对你有用的话，评论区聊聊，我基本每天都回。'];
  if (_npWiz) { _npWiz.selfCands = sc; _npWiz.selfIdx = 0; }
  renderNpSelf(container);
}

function npSelfPick(container, i) {
  if (!_npWiz) return;
  _npWiz.selfIdx = i;
  renderNpSelf(container);
}

function renderNpTags(container, d) {
  const box = _npEl(container, 'npTags');
  if (!box) return;
  box.innerHTML = '<div style="font-size:11px;font-weight:700;color:#333;margin-bottom:4px;"># 话题标签（点 × 删）</div>' + (_npNote.tags.length ? _npNote.tags.map((t, ti) =>
    '<span style="display:inline-flex;align-items:center;gap:4px;margin:3px 4px 0 0;background:#fff;border:1px solid #f3c2cd;border-radius:10px;padding:1px 8px;font-size:11px;color:#c02;">#' + esc(String(t).replace(/^#/, '')) +
    '<button type="button" data-ti="' + ti + '" style="border:none;background:none;color:#c02;cursor:pointer;font-size:12px;">×</button></span>').join('') : '<span style="font-size:11px;color:#999;">（未添加标签）</span>');
  box.querySelectorAll('[data-ti]').forEach(b => b.addEventListener('click', function () { _npNote.tags.splice(parseInt(this.getAttribute('data-ti'), 10), 1); renderNpTags(container); }));
}

// ═══════════════ 配图文案 MD + 思维导图（Canvas 树状，3:4） ═══════════════
let _npMindCanvas = null;   // 当前思维导图 canvas

// 注入「配图文案 MD」编辑块 + 思维导图预览块
function renderNpMindMapBlock(container) {
  const mdBox = _npEl(container, 'npKbMd');
  const mmBox = _npEl(container, 'npMindMap');
  if (!mdBox) return;
  mdBox.innerHTML =
    '<div style="border:1px solid #e9d5ff;border-radius:10px;padding:10px;background:#faf8ff;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
    '<div style="font-size:11px;font-weight:700;color:#7c3aed;">🧠 配图文案（从知识库生成 · 可编辑，再生成思维导图）</div>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
    '<button type="button" class="np-mm-ai" style="border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:6px;font-size:11px;cursor:pointer;padding:2px 8px;">🤖 AI 重排成树状</button>' +
    '<button type="button" class="np-mm-render" style="border:1px solid #0e7490;background:#ecfeff;color:#0e7490;border-radius:6px;font-size:11px;cursor:pointer;padding:2px 8px;">🧠 生成思维导图</button>' +
    '</div></div>' +
    '<textarea id="npKbMdText" spellcheck="false" rows="9" placeholder="配图文案（Markdown，树状：# 主标题 / ## 分支 / - 子项）…" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #e7e8ec;border-radius:8px;font-size:12px;line-height:1.7;font-family:\'Consolas\',\'Cascadia Code\',monospace;resize:vertical;white-space:pre;"></textarea>' +
    '</div>';
  if (mmBox) {
    mmBox.innerHTML =
      '<div style="border:1px solid #dbe4f0;border-radius:10px;padding:10px;background:#fafcff;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' +
      '<div style="font-size:11px;font-weight:700;color:#1f6feb;">🧠 思维导图预览（配图 · 3:4）</div>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
      '<button type="button" class="np-mm-copy" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 10px;">📋 复制图</button>' +
      '<button type="button" class="np-mm-dl" style="padding:2px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#666;font-size:11px;cursor:pointer;">⬇ 下载</button>' +
      '</div></div>' +
      '<canvas id="npMindCanvas" width="1000" height="1333" style="width:220px;border-radius:8px;border:1px solid #dfe8f5;background:#f5f7fb;max-width:100%;"></canvas>' +
      '<div style="font-size:11px;color:#999;margin-top:6px;">改上方文案后点「🧠 生成思维导图」刷新配图。</div>' +
      '</div>';
  }
}

// 从知识库（按话题关键词过滤）生成树状 MD，回填 textarea 并渲染思维导图
async function npLoadKbMd(container, topic) {
  const ta = document.getElementById('npKbMdText');
  if (!ta) return;
  let kb = [];
  try { kb = (await readPlain('knowledge_base')) || []; } catch (_) {}
  const md = npKbTreeMarkdown(kb, topic);
  ta.value = md;
  npRenderMindMapFromTextarea(container);
}

/* ═══════════════ 🎁 提示词包：整合资料 + 风格快问快答 → 文案/封面配图/口播/视频 提示词 ═══════════════ */
let _npPackResult = null; // { copy, cover, voice, video }

// 渲染提示词包折叠区块（含快问快答、整合资料、生成按钮、四类结果、发笔记流程图）
function renderNpPromptPack(container) {
  const box = _npEl(container, 'npPromptPack');
  if (!box) return;
  box.innerHTML =
    '<div style="border:1px solid #ffd9c0;border-radius:10px;background:#fffaf6;">' +
    '<div class="np-pack-toggle" style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;padding:10px 12px;cursor:pointer;">' +
    '<div style="font-size:12px;font-weight:700;color:#f97316;">🎁 提示词包（文案 / 封面&配图 / 口播稿 / 视频生成稿）</div>' +
    '<span style="font-size:11px;color:#f97316;">︿ 收起 / 展开</span></div>' +
    '<div class="np-pack-body" style="padding:8px 12px 12px;">' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px;">' +
    '<button type="button" class="np-pack-gen" style="padding:6px 14px;border:none;border-radius:8px;background:#f97316;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">🤖 生成提示词包</button>' +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px;font-size:11px;color:#333;">' +
    '<label style="display:flex;align-items:center;gap:4px;">封面配色<select class="np-pack-qa" data-k="coverStyle" style="margin-left:2px;padding:3px 4px;border:1px solid #eee;border-radius:6px;font-size:11px;">' +
    '<option value="auto">默认</option><option value="brand">固定品牌色</option><option value="pop">高饱和碰撞色</option><option value="minimal">简约留白</option><option value="tech">数据科技感</option></select></label>' +
    '<label style="display:flex;align-items:center;gap:4px;">主播口播风格<select class="np-pack-qa" data-k="voiceStyle" style="margin-left:2px;padding:3px 4px;border:1px solid #eee;border-radius:6px;font-size:11px;">' +
    '<option value="auto">默认</option><option value="friendly">亲切日常</option><option value="pro">干货专业</option><option value="punchy">快节奏高能</option><option value="emo">情绪共鸣</option></select></label>' +
    '<label style="display:flex;align-items:center;gap:4px;">视频形式<select class="np-pack-qa" data-k="videoForm" style="margin-left:2px;padding:3px 4px;border:1px solid #eee;border-radius:6px;font-size:11px;">' +
    '<option value="talk">口播讲解</option><option value="slide">图文动态轮播</option><option value="vlog">实拍混剪</option><option value="avatar">数字人</option></select></label>' +
    '<label style="display:flex;align-items:center;gap:4px;">时长<select class="np-pack-qa" data-k="duration" style="margin-left:2px;padding:3px 4px;border:1px solid #eee;border-radius:6px;font-size:11px;">' +
    '<option value="15s">15s</option><option value="30s" selected>30s</option><option value="60s">60s</option></select></label>' +
    '</div>' +
    '<div style="font-size:11px;color:#333;margin:0 0 4px;">📝 本篇还想说的 / 特殊需求（选填）：</div>' +
    '<input type="text" class="np-pack-extra" placeholder="例：想强调赠品活动 / 别提到价格 / 重点写给新手…" style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #eee;border-radius:6px;font-size:12px;margin:0 0 8px;">' +
    '<div style="font-size:11px;color:#b45309;margin:0 0 4px;">📦 整合资料（可编辑，生成时按此来）：</div>' +
    '<textarea class="np-pack-ctx" spellcheck="false" rows="7" wrap="off" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #eee;border-radius:6px;font-size:11.5px;line-height:1.6;font-family:\'Consolas\',monospace;white-space:pre-wrap;"></textarea>' +
    '<div id="npPackFlow" style="margin:10px 0 0;font-size:11.5px;color:#555;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px 10px;line-height:1.8;">' +
    '<div style="font-weight:700;color:#f97316;margin-bottom:4px;">📖 发笔记流程</div>' +
    '① 复制上面「正文」里的成稿文案 → 去小红书「＋」新建图文；<br>' +
    '② 上传「封面」的 PNG（🎨 封面区块 复制/下载）；<br>' +
    '③ 上传「思维导图」配图（🧠 配图区块 复制/下载）；<br>' +
    '④ 贴上标题 + 正文 + 话题标签，发布；<br>' +
    '⑤ 发布后 1 小时内贴「置顶自评」；<br>' +
    '⑥ 想发视频/更精配图：用下面 封面&配图/口播/视频 提示词 → 去 千问/即梦/可灵/剪映 生成 → 按视频或图文发布。' +
    '</div>' +
    '<div id="npPackRes" style="margin-top:10px;"></div>' +
    '</div></div>';
  // 收起/展开
  const toggle = box.querySelector('.np-pack-toggle');
  const body = box.querySelector('.np-pack-body');
  if (toggle && body) toggle.addEventListener('click', () => { body.style.display = body.style.display === 'none' ? '' : 'none'; });
}

// 规则拼接「整合资料」：人设 + 产品/卖点 + 知识库 + 本次笔记 + 快问快答
async function npPackBuildCtx(container) {
  const ta = _npEl(container, 'npPackCtx') || document.querySelector('.np-pack-ctx');
  if (!ta) return;
  let cfg = {}, kb = [];
  try { cfg = await readConfigPlain(); kb = (await readPlain('knowledge_base')) || []; } catch (_) {}
  const per = cfg.persona || {};
  const prod = cfg.product || {};
  const ss = cfg.scriptStyle || {};
  const parts = [];
  parts.push('【账号人设】' + String(per.text || per.personaIntro || '').trim() || '（未建人设）');
  if (ss.personaIntro) parts.push('【人设一句话】' + String(ss.personaIntro).trim());
  if (ss.toneMannerisms) parts.push('【口癖/语气】' + String(ss.toneMannerisms).trim());
  parts.push('【产品】' + String(prod.name || '未填').trim());
  if (prod.description) parts.push('【产品简介】' + String(prod.description).trim());
  const sp = (Array.isArray(prod.sellPoints) ? prod.sellPoints : []).filter(s => s && (String(s.title || '').trim() || String(s.content || '').trim()));
  if (sp.length) parts.push('【产品卖点】\n' + sp.map((s, i) => (i + 1) + '. ' + String(s.title || s.content || '').trim() + (s.content ? '：' + String(s.content).trim() : '')).join('\n'));
  const d = (_npWiz && _npWiz.draft) || {};
  const title = (d.titles && d.titles[(_npNote && _npNote.titleIdx || 0)]) || ((d.titles && d.titles[0]) || '');
  const topic = (_npWiz && _npWiz.concept && _npWiz.concept.topics && _npWiz.concept.topics[_npWiz.chosenTopicIdx >= 0 ? _npWiz.chosenTopicIdx : 0] && _npWiz.concept.topics[_npWiz.chosenTopicIdx >= 0 ? _npWiz.chosenTopicIdx : 0].topic) || title || '';
  parts.push('【本次笔记】');
  parts.push('话题：' + (topic || ''));
  parts.push('标题：' + (title || ''));
  parts.push('正文：' + String(d.content || '').trim());
  if ((d.tags || []).length) parts.push('话题标签：' + d.tags.map(t => '#' + String(t).replace(/^#/, '')).join(' '));
  const people = (_npWiz && _npWiz.chosenPeople || []).map(p => (p && p.name) || '').filter(Boolean);
  if (people.length) parts.push('面向人群：' + people.join('、'));
  const cov = (d.cover && d.cover.title) ? '封面大标题：' + d.cover.title : '';
  if (cov) parts.push(cov);
  // 配图文案 MD（当前思维导图内容）做知识补充
  const mmTa = document.getElementById('npKbMdText');
  const mm = mmTa ? mmTa.value : '';
  if (mm) parts.push('【配图文案/知识要点】\n' + mm);
  // 快问快答 + 自定义
  const qa = {};
  boxQaKeys.forEach(k => { const el = _npEl(container, 'npPack' + k[caps(k)]) || document.querySelector('.np-pack-qa[data-k="' + k + '"]'); if (el) qa[k] = el.value; });
  parts.push('【封面配色风格】' + ({ auto: '默认', brand: '固定品牌色', pop: '高饱和碰撞色', minimal: '简约留白', tech: '数据科技感' }[qa.coverStyle] || '默认'));
  parts.push('【主播口播风格】' + ({ auto: '默认', friendly: '亲切日常', pro: '干货专业', punchy: '快节奏高能', emo: '情绪共鸣' }[qa.voiceStyle] || '默认'));
  parts.push('【视频形式】' + ({ talk: '口播讲解', slide: '图文动态轮播', vlog: '实拍混剪', avatar: '数字人' }[qa.videoForm] || '口播讲解') + '（' + (qa.duration || '30s') + '）');
  const extraEl = _npEl(container, 'npPackExtra') || document.querySelector('.np-pack-extra');
  const extra = extraEl ? String(extraEl.value || '').trim() : '';
  if (extra) parts.push('【本篇额外要求/想说的】' + extra);
  ta.value = parts.join('\n\n');
}

const boxQaKeys = ['coverStyle', 'voiceStyle', 'videoForm', 'duration'];
function caps(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// 调后台 AI 生成四类提示词并回填
async function npPackGen(container) {
  const ctxEl = _npEl(container, 'npPackCtx') || document.querySelector('.np-pack-ctx');
  const btn = container.querySelector('.np-pack-gen');
  const resBox = _npEl(container, 'npPackRes');
  if (!ctxEl || !resBox) return;
  const ctx = String(ctxEl.value || '').trim();
  if (!ctx) { toast('整合资料为空，先点「生成」前请确认有内容', 'error'); return; }
  const qa = {};
  boxQaKeys.forEach(k => { const el = _npEl(container, 'npPack' + caps(k)) || document.querySelector('.np-pack-qa[data-k="' + k + '"]'); if (el) qa[k] = el.value; });
  const extraEl = _npEl(container, 'npPackExtra') || document.querySelector('.np-pack-extra');
  const extra = extraEl ? String(extraEl.value || '').trim() : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中…'; }
  resBox.innerHTML = '<div style="font-size:12px;color:#888;">⏳ 正在生成文案 / 封面配图 / 口播稿 / 视频稿…</div>';
  try {
    const r = await chrome.runtime.sendMessage({ action: 'genPromptPack', data: { ctx, coverStyle: qa.coverStyle, voiceStyle: qa.voiceStyle, videoForm: qa.videoForm, duration: qa.duration, extra } });
    if (r && r.ok && r.result) {
      _npPackResult = r.result;
      renderNpPackResults(container, r.result);
    } else throw new Error((r && r.error) || '生成失败');
  } catch (e) {
    resBox.innerHTML = '<div style="font-size:12px;color:#d33;">❌ ' + esc(e.message || '生成失败') + '</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '🤖 生成提示词包'; }
}

function npPackResHtml(k, title, icon) {
  const txt = (_npPackResult && _npPackResult[k]) || '';
  return '<div style="margin:8px 0;border:1px solid #f1d9c0;border-radius:8px;padding:8px 10px;background:#fff;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">' +
    '<div style="font-size:12px;font-weight:700;color:#f97316;">' + icon + ' ' + title + '</div>' +
    '<button type="button" class="np-pack-copy" data-k="' + k + '" style="border:1px solid #f97316;border-radius:6px;background:#fff;color:#f97316;font-size:11px;cursor:pointer;padding:2px 10px;">📋 复制</button>' +
    '</div>' +
    (txt ? '<pre style="font-size:11.5px;color:#333;background:#fff7f0;border-radius:6px;padding:6px 8px;margin:0;white-space:pre-wrap;word-break:break-all;font-family:inherit;">' + esc(txt) + '</pre>' : '<div style="font-size:11px;color:#999;">（未生成）</div>') +
    '</div>';
}
function renderNpPackResults(container, result) {
  const box = _npEl(container, 'npPackRes');
  if (!box) return;
  _npPackResult = result;
  box.innerHTML =
    npPackResHtml('copy', '文案提示词', '✍️') +
    npPackResHtml('cover', '封面 & 配图生成提示词', '🖼') +
    npPackResHtml('voice', '口播稿（旁白）', '🎙') +
    npPackResHtml('video', '视频生成稿', '🎬');
}

// 🤖 AI 重排配图文案为更清晰的树状
async function npAiKbMd(container) {
  const ta = document.getElementById('npKbMdText');
  const btn = container.querySelector('.np-mm-ai');
  if (!ta) return;
  let kb = [];
  try { kb = (await readPlain('knowledge_base')) || []; } catch (_) {}
  const topic = ((_npWiz && _npWiz.draft && _npWiz.draft.titles && _npWiz.draft.titles[0])) || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 重排中…'; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'aiKbTree', data: { kb, topic } });
    if (r && r.ok && r.markdown) { ta.value = r.markdown; npRenderMindMapFromTextarea(container); toast('✅ 已按 AI 重排，可直接改或生成思维导图'); }
    else throw new Error((r && r.error) || '重排失败');
  } catch (e) { toast('AI 重排失败：' + ((e && e.message) || e), 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 重排成树状'; }
}

// 从 textarea 当前文案渲染思维导图
function npRenderMindMapFromTextarea(container) {
  const ta = document.getElementById('npKbMdText');
  const cv = document.getElementById('npMindCanvas');
  if (!ta || !cv) return;
  const md = ta.value || '';
  const W = 1000, H = 1333;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  npDrawMindMap(c, md, W, H);
  const x = cv.getContext('2d');
  cv.width = W; cv.height = H;
  x.drawImage(canvas, 0, 0);
  cv.style.width = '220px';
  _npMindCanvas = cv;
}

// 解析 Markdown 为层级树（# 标题 + 缩进 - 子项）；返回根节点 {text, children}
function npParseMdTree(md) {
  const root = { text: 'root', children: [], lvl: 0 };
  const stack = [root];
  let lastHeading = 1;
  const push = (lvl, text) => {
    while (stack[stack.length - 1].lvl >= lvl) stack.pop();
    const parent = stack[stack.length - 1];
    const node = { text: text || '·', children: [], lvl };
    parent.children.push(node);
    stack.push(node);
  };
  const lines = String(md || '').split('\n');
  for (const raw of lines) {
    const ln = raw.replace(/\s+$/, '');
    if (!ln.trim()) continue;
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { lastHeading = h[1].length; push(lastHeading, String(h[2] || '').replace(/\*\*/g, '').trim() || '分支'); continue; }
    const dash = ln.match(/^(\s*)[-*•]\s+(.*)$/);
    if (dash) {
      const sp = dash[1].replace(/\t/g, '  ').length;
      const indent = Math.max(1, Math.floor(sp / 2) + 1);
      push(lastHeading + indent, String(dash[2] || '').replace(/\*\*/g, '').trim());
      continue;
    }
    if (ln.trim()) push(lastHeading + 1, ln.trim());
  }
  return root;
}

// 把树画成 3:4 canvas（上到下树状：根→分支→子项，带连接线；文本自动换行、按行高预留，保证所有要点都显示）
function _mmWrap(text, fs, maxW) {
  const lines = []; let cur = '', cw = 0;
  for (const ch of String(text || '')) {
    const w = (ch.charCodeAt(0) > 255) ? fs : fs * 0.62;
    if (cw + w > maxW && cur) { lines.push(cur); cur = ch; cw = w; } else { cur += ch; cw += w; }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

function npDrawMindMap(c, md, W, H) {
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#eef2fb');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const root = npParseMdTree(md);
  const kids = root.children;
  const padX = 58, topPad = 96, botPad = 36;
  const areaW = W - padX * 2, areaH = H - topPad - botPad;

  // 标题 = 第 1 个 # 一级标题
  const firstH1 = kids.find(n => n.lvl === 1);
  const title = (firstH1 && firstH1.text) || '知识架构';
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  let titleFs = 54;
  c.font = 'bold ' + titleFs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
  while (titleFs > 30 && c.measureText(title).width > areaW * 0.94) { titleFs -= 2; c.font = 'bold ' + titleFs + 'px "Microsoft YaHei","PingFang SC",sans-serif'; }
  c.fillStyle = '#0f172a';
  c.fillText(title, W / 2, Math.round(topPad * 0.5));

  const bodyKids = kids.filter(n => n.lvl >= 2);
  const payload = (bodyKids.length ? bodyKids : kids).filter(n => n !== firstH1);
  let leafCount = 0;
  function countLeaves(n) { if (n.children.length) n.children.forEach(countLeaves); else leafCount++; }
  payload.forEach(countLeaves);
  if (!leafCount) {
    c.fillStyle = '#8592a6'; c.font = '22px "Microsoft YaHei",sans-serif'; c.textAlign = 'left';
    c.fillText('（配图文案为空）', padX, topPad + 30);
    return;
  }
  const colW = areaW / leafCount;

  // 叶子列 + 父节点中心
  let idx = 0;
  function setLeaf(n) { if (n.children.length) n.children.forEach(setLeaf); else n._c = idx++; }
  payload.forEach(setLeaf);
  function center(n) { if (n.children.length) { n.children.forEach(center); let s = 0, m = 0; n.children.forEach(ch => { s += ch._cx; m++; }); n._cx = s / m; } else { n._cx = n._c * colW + colW / 2; } }
  payload.forEach(center);
  const nodes = [];
  function collect(n) { nodes.push(n); n.children.forEach(collect); }
  payload.forEach(collect);
  // 深度 + 子树叶子跨度
  nodes.forEach(n => { if (!n.children.length) n._sub = 1; });
  function span(n) { if (n.children.length) { n.children.forEach(span); n._sub = n.children.reduce((s, ch) => s + ch._sub, 0); } }
  payload.forEach(span);
  let maxDepth = 0;
  function depthOf(n, d) { n._d = d; if (d > maxDepth) maxDepth = d; n.children.forEach(ch => depthOf(ch, d + 1)); }
  payload.forEach(n => depthOf(n, 0));

  // 每个节点：自动字号 + 换行 + 盒尺寸（宽度按子树跨度占用）；过长自动整体缩放
  const avail = H - topPad - botPad - 12;
  let fsScale = 1;
  function sizeNodes() {
    nodes.forEach(n => {
      const fs = Math.max(11, Math.round((28 - n._d * 2) * fsScale));
      const budget = Math.max(140, Math.min(areaW * 0.92, (n._sub / leafCount) * areaW * 0.96));
      const lines = _mmWrap(n.text, fs, budget - fs * 0.7);
      const maxLineLen = Math.max.apply(null, lines.map(x => String(x || '').length));
      const bw = Math.max(108, Math.min(budget, maxLineLen * fs * 0.98 + fs * 0.9));
      const bh = Math.max(fs * 2.4, lines.length * fs * 1.5 + fs * 0.7 + 12);
      n._fs = fs; n._lines = lines; n._bw = bw; n._bh = bh;
    });
  }
  function layoutY() {
    const rows = {};
    nodes.forEach(n => { (rows[n._d] = rows[n._d] || []).push(n); });
    const rowH = {};
    for (let d = 0; d <= maxDepth; d++) { const arr = rows[d] || []; rowH[d] = arr.length ? Math.max.apply(null, arr.map(x => x._bh)) + 14 : 22; }
    const yTop = {};
    let y = topPad + 6;
    for (let d = 0; d <= maxDepth; d++) { yTop[d] = y; y += rowH[d]; }
    return { rows, rowH, yTop, total: y - (topPad + 6) };
  }
  sizeNodes();
  let L = layoutY();
  let guard = 8;
  while (L.total > avail && fsScale > 0.55 && guard-- > 0) {
    fsScale *= 0.88;
    sizeNodes();
    L = layoutY();
  }
  const rowH = L.rowH, yTop = L.yTop;

  // 连接线
  c.lineWidth = 2;
  nodes.forEach(n => {
    if (!n.children.length) return;
    const cx0 = padX + n._cx;
    const ybot = yTop[n._d] + rowH[n._d] / 2 + n._bh / 2;
    n.children.forEach(ch => {
      const cx1 = padX + ch._cx;
      const ytop = yTop[ch._d] + rowH[ch._d] / 2 - ch._bh / 2;
      c.strokeStyle = 'rgba(124,58,237,0.32)';
      c.beginPath(); c.moveTo(cx0, ybot); c.lineTo(cx1, (ybot + ytop) / 2); c.lineTo(cx1, ytop); c.stroke();
    });
  });

  // 节点盒 + 换行文本
  const colors = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#db2777', '#0891b2'];
  nodes.forEach(n => {
    const cx = padX + n._cx;
    const x = Math.max(padX, Math.min(W - padX - n._bw, cx - n._bw / 2));
    const y = yTop[n._d] + rowH[n._d] / 2 - n._bh / 2;
    c.fillStyle = colors[n._d % colors.length];
    _mmRoundRect(c, x, y, n._bw, n._bh, n._bh / 2); c.fill();
    c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.font = 'bold ' + n._fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    let ty = y + n._fs * 0.62;
    const lineH = n._fs * 1.5;
    n._lines.forEach(ln => { c.fillText(ln, x + n._fs * 0.5, ty); ty += lineH; });
  });
}

function _mmRoundRect(c, x, y, w, h, r) {
  r = Math.min(r || 0, h / 2, w / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ═══════════════ 封面合成（背景图 + 标题） ═══════════════
let _npCoverOpts = null; // { username, name, hook, cta, template }

async function npRenderCover(container) {
  const box = _npEl(container, 'npCover');
  const d = (_npWiz && _npWiz.draft) || null;
  const cover = (d && d.cover) ? d.cover : null;
  if (!box) return;
  if (!cover || (!cover.title && !cover.points && !cover.subtitle)) { box.innerHTML = ''; return; }
  // 读取封面基础字段
  if (!_npCoverOpts) {
    try {
      const cfg = await readConfigPlain();
      const p = cfg.product || {};
      const per = cfg.persona || {};
      _npCoverOpts = {
        template: (p.coverTemplate && p.coverTemplate.image) ? p.coverTemplate.image : null,
        hook: p.coverHook || per.coverHook || '',
        titleColor: '#ffffff',
        titleSize: 0,      // 0=按长度自动；>0 为固定字号
        fontFamily: '',
      };
    } catch (_) { _npCoverOpts = { template: null, hook: '', titleColor: '#ffffff', titleSize: 0, fontFamily: '' }; }
  }
  box.innerHTML =
    '<div style="border:1px solid #dbe4f0;border-radius:10px;padding:10px;background:#fafcff;">' +
    '<div class="toolbar-title" style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' +
    '<div style="font-size:11px;font-weight:700;color:#1f6feb;">🎨 封面（你导入的背景图 + 大标题）</div>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
    '<button type="button" class="np-cover-ai" style="border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:6px;font-size:11px;cursor:pointer;padding:2px 10px;">🤖 AI 重排标题</button>' +
    '<button type="button" class="np-cover-copy" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 10px;">📋 复制封面</button>' +
    '<button type="button" class="np-cover-dl" style="padding:2px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#666;font-size:11px;cursor:pointer;">⬇ 下载</button>' +
    '</div></div>' +
    '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">' +
    '<canvas id="npCoverCanvas" width="400" height="533" style="width:200px;border-radius:8px;border:1px solid #dfe8f5;background:#eee;"></canvas>' +
    '<div style="flex:1;min-width:200px;">' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">' +
    '<label style="font-size:11px;color:#333;">字号<input type="number" class="np-cover-input" data-k="titleSize" min="0" max="400" step="5" value="' + ((_npCoverOpts.titleSize) || 0) + '" style="width:60px;margin-left:4px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;"></label>' +
    '<label style="font-size:11px;color:#333;">颜色<input type="color" class="np-cover-input" data-k="titleColor" value="' + ((_npCoverOpts.titleColor) || '#ffffff') + '" style="width:34px;height:26px;padding:0;border:1px solid #ddd;border-radius:6px;margin-left:4px;cursor:pointer;"></label>' +
    '<label style="font-size:11px;color:#333;">字体<select class="np-cover-input" data-k="fontFamily" style="margin-left:4px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px;">' +
    '<option value="">默认黑体</option>' +
    '<option value="SimHei"' + (_npCoverOpts.fontFamily === 'SimHei' ? ' selected' : '') + '>黑体</option>' +
    '<option value="SimSun"' + (_npCoverOpts.fontFamily === 'SimSun' ? ' selected' : '') + '>宋体</option>' +
    '<option value="YouYuan"' + (_npCoverOpts.fontFamily === 'YouYuan' ? ' selected' : '') + '>圆体</option>' +
    '<option value="KaiTi"' + (_npCoverOpts.fontFamily === 'KaiTi' ? ' selected' : '') + '>楷体</option>' +
    '<option value="Arial Black"' + (_npCoverOpts.fontFamily === 'Arial Black' ? ' selected' : '') + '>Arial</option>' +
    '</select></label>' +
    '<span style="font-size:10px;color:#999;">字号 0 = 按标题长度自动</span>' +
    '</div>' +
    '<div style="font-size:11px;color:#999;line-height:1.7;">背景图来自「设置→封面设置」或「账号诊断」导入的封面图；标题跟随你上面选的标题，改字号/颜色/字体实时生效。</div>' +
    '</div></div></div>';
  const canvas = box.querySelector('#npCoverCanvas');
  box.querySelectorAll('.np-cover-input').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.getAttribute('data-k');
    _npCoverOpts[k] = k === 'titleSize' ? (parseInt(inp.value, 10) || 0) : inp.value;
    renderCoverCanvas(canvas, cover, _npCoverOpts);
  }));
  renderCoverCanvas(canvas, cover, _npCoverOpts);
  _npCoverCanvas = canvas;
}
let _npCoverCanvas = null;
let _npCoverAi = null; // AI 排版覆盖：{ lines:[...], size:Number, vertical:'top'|'center' }；null=纯规则

// ★ 封面标题：按字符数（规则）决策 行数/起始字号/垂直位置；配合 coverFitBlock 做宽度兜底
function npCoverPick(textLen) {
  if (textLen <= 6)  return { maxLines: 1, startSize: 168, vertical: 'center' };
  if (textLen <= 10) return { maxLines: 1, startSize: 144, vertical: 'center' };
  if (textLen <= 14) return { maxLines: 2, startSize: 122, vertical: 'top' };
  if (textLen <= 22) return { maxLines: 2, startSize: 106, vertical: 'top' };
  return { maxLines: 3, startSize: 94, vertical: 'top' };
}

// 🤖 AI 重排封面：把标题按语义分行/定点，覆盖规则结果（标题偏长偏挤时救场）
async function npAiLayoutCover(nc) {
  const canvas = _npCoverCanvas;
  const cover = (_npWiz && _npWiz.draft && _npWiz.draft.cover) || null;
  if (!canvas || !cover || !cover.title) { if (typeof toast === 'function') toast('还没有封面标题，先完成成稿', 'error'); return; }
  const btn = nc.querySelector('.np-cover-ai');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 排版中…'; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'aiCoverLayout', data: { title: cover.title, subtitle: cover.subtitle || '' } });
    if (r && r.ok && r.lines && r.lines.length) {
      _npCoverAi = { lines: r.lines, size: r.size, vertical: r.vertical || 'top' };
      renderCoverCanvas(canvas, cover, _npCoverOpts);
      if (typeof toast === 'function') toast('✅ 已按 AI 排版覆盖（可再点「复制封面」导出，点「重新生成」可回到规则排版）');
    } else {
      throw new Error((r && r.error) || 'AI 未返回排版');
    }
  } catch (e) {
    if (typeof toast === 'function') toast('AI 重排失败：' + ((e && e.message) || e), 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 重排封面'; }
}

// 将给定文字按最大宽度换行（<n 行）
function coverWrapLines(ctx, text, maxW, fontSize, lineHeight) {
  const chars = String(text || '').split('');
  const lines = [];
  let cur = '';
  ctx.font = Math.round(fontSize * lineHeight) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
  for (const ch of chars) {
    const t = cur + ch;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = ch; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('');
  return lines;
}

// 自适应：从 start 起向下二分找能装下的字号；始终返回安全结果（行高/宽度约束内）
function coverFitBlock(ctx, text, start, min, maxW, maxH, maxLines, lineHeight) {
  const scale = (drawLh) => (s) => (Math.round(s * drawLh)) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
  function trySize(sz) {
    ctx.font = scale(lineHeight)(sz);
    const lines = coverWrapLines(ctx, text, maxW, sz, lineHeight);
    if (lines.length > maxLines) return null;
    const h = lines.length * sz * lineHeight;
    if (h > maxH) return null;
    return { sz, lines, h };
  }
  let r = trySize(start);
  if (r) return r;
  let lo = min, hi = start;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const tr = trySize(mid);
    if (tr) { r = tr; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (r) return r;
  // 兜底：最小字号 + 强制截断到 maxLines
  ctx.font = scale(lineHeight)(min);
  let lines = coverWrapLines(ctx, text, maxW, min, lineHeight);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);
  let h = lines.length * min * lineHeight;
  if (h > maxH) { lines = lines.slice(0, Math.max(1, Math.floor(maxH / (min * lineHeight)))); h = lines.length * min * lineHeight; }
  return { sz: min, lines, h };
}

function renderCoverCanvas(canvas, cover, o) {
  if (!canvas || !cover) return;
  const W = 1000, H = 1333;
  canvas.width = W; canvas.height = H;
  canvas.style.width = '200px';
  const c = canvas.getContext('2d');
  const padX = Math.round(W * 0.07);
  const maxW = W - padX * 2;

  let bgImg = null;
  if (o.template) {
    bgImg = new Image();
    bgImg.onload = () => draw();
    bgImg.onerror = () => { drawGrad(); draw(); };
    bgImg.src = o.template;
  } else {
    drawGrad();
    draw();
  }

  function drawGrad() {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a1a2e'); g.addColorStop(0.5, '#16213e'); g.addColorStop(1, '#0f3460');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  function fillBg() {
    if (bgImg && bgImg.width) {
      const iw = bgImg.width, ih = bgImg.height, r = W / H, ir = iw / ih;
      let sw, sh;
      if (ir > r) { sh = ih; sw = ih * r; } else { sw = iw; sh = iw / r; }
      c.drawImage(bgImg, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
    } else drawGrad();
  }

  function draw() {
    fillBg();
    // 轻压暗一层，保证标题可读
    const alpha = (cover.grad && cover.grad.alpha) || 0.45;
    const scrim = c.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0, 'rgba(0,0,0,' + (alpha * 0.9).toFixed(2) + ')');
    scrim.addColorStop(0.55, 'rgba(0,0,0,' + (alpha * 0.3).toFixed(2) + ')');
    scrim.addColorStop(1, 'rgba(0,0,0,' + (alpha * 1).toFixed(2) + ')');
    c.fillStyle = scrim; c.fillRect(0, 0, W, H);

    c.textBaseline = 'alphabetic';
    c.textAlign = 'center';
    const titleText = cover.title || '';
    const lh = cover.lineHeight || 1.12;
    // 标题：规则按长度选字号，用户可在封面设置里改 字号/颜色/字体
    const pick = npCoverPick(String(titleText).length);
    const fam = o.fontFamily
      ? (o.fontFamily + ',"Microsoft YaHei","PingFang SC",sans-serif')
      : '"Microsoft YaHei","PingFang SC",sans-serif';
    let titleLines, titleSz;
    if (_npCoverAi && Array.isArray(_npCoverAi.lines) && _npCoverAi.lines.length) {
      titleLines = _npCoverAi.lines.map(s => String(s).trim()).filter(Boolean);
      titleSz = _npCoverAi.size || pick.startSize;
    } else {
      const startSz = (o.titleSize && o.titleSize > 0) ? o.titleSize : pick.startSize;
      const minSz  = (o.titleSize && o.titleSize > 0) ? 20 : 40;
      const fit = coverFitBlock(c, titleText, startSz, minSz, maxW, H * 0.5, pick.maxLines, lh);
      titleLines = fit.lines; titleSz = fit.sz;
    }
    const titleFh = Math.round(titleSz * lh);
    const blocksH = titleLines.length * titleFh;
    // 竖中上部当作标题区（cover 主视觉）
    const areaTop = H * 0.24, areaH = H * 0.44;
    const blockTop = areaTop + (areaH - blocksH) / 2;
    c.fillStyle = o.titleColor || '#ffffff';
    c.font = 'bold ' + titleFh + 'px ' + fam;
    titleLines.forEach((ln, i) => { c.fillText(ln, W / 2, blockTop + (i + 1) * titleFh); });
    // 副标题
    const subText = cover.subtitle || '';
    if (subText) {
      const subFit = coverFitBlock(c, subText, 64, 32, maxW * 0.9, H * 0.12, 2, lh);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.font = Math.round(subFit.sz * lh) + 'px ' + fam;
      const subY = blockTop + blocksH + subFit.sz * 1.7;
      subFit.lines.forEach((ln, i) => c.fillText(ln, W / 2, subY + i * subFit.sz * lh));
    }
  }
}


async function copyImageToClipboard(dataURL) {
  try {
    const res = await fetch(dataURL);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (_) { return false; }
}
function downloadImageDataUrl(dataURL, name) {
  const a = document.createElement('a');
  a.href = dataURL; a.download = name || 'note_img.png';
  document.body.appendChild(a); a.click(); a.remove();
}

async function npCopyResult(container) {
  const resultEl = _npEl(container, 'npResult');
  const statusEl = _npEl(container, 'npStatus');
  const body = (resultEl && resultEl.value || '').trim();
  if (!body) { if (statusEl) { statusEl.textContent = '暂无可复制的成稿'; statusEl.style.color = '#e07b00'; } return; }
  const title = _npNote.title || '';
  const tagLine = (_npNote.tags || []).map(t => '#' + String(t).replace(/^#/, '').trim()).join(' ');
  const parts = [];
  if (title) parts.push(title);
  parts.push(body);
  if (tagLine) parts.push(tagLine);
  try {
    await copyToClipboard(parts.join('\n'));
    await npAddUsed(title || parts[0] || '小红书笔记'); // 记入"已发送池"，下次不再推荐同题
    if (statusEl) { statusEl.textContent = '✅ 成稿已复制，去小红书粘贴发布即可'; statusEl.style.color = '#2e7d32'; }
  } catch (e) { if (statusEl) { statusEl.textContent = '❌ 复制失败'; statusEl.style.color = '#d32f2f'; } }
}
async function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

// 左侧笔记列表 + 拖拽分隔条显隐（评论跟进 Tab 下不需要）
function _setPanelLeftVisible(visible) {
  const pl = document.getElementById('panelLeft');
  const dv = document.getElementById('divider');
  if (pl) pl.style.display = visible ? '' : 'none';
  if (dv) dv.style.display = visible ? '' : 'none';
}

// 工具栏「📤 自动评论 / 🔄 评论刷新」按当前 Tab 绑定不同功能：
//   评论助手 = 原功能（当前笔记页）；评论跟进 = 通知页全部回复 / 通知页重新同步
let _followBatchBtn = null, _followRefreshBtn = null;
let _plRefreshBtn = null, _plSettingsBtn = null;
function _setToolbarMode(mode) {
  const group = document.getElementById('commentBtnGroup');
  const refresh = document.getElementById('refreshBtn');
  if (!group) return;
  const isComment = (mode === 'comment');
  group.style.display = isComment ? '' : 'none';
  if (refresh) refresh.style.display = isComment ? '' : 'none';
  if (mode === 'prospectList') {
    if (!_plRefreshBtn) {
      _plRefreshBtn = document.createElement('button');
      _plRefreshBtn.className = 'refresh-btn';
      _plRefreshBtn.textContent = '🔄 刷新清单';
      _plRefreshBtn.title = '重新加载用户清单';
      _plRefreshBtn.addEventListener('click', () => {
        const pc = document.getElementById('prospectContent');
        if (pc) loadProspectList(pc);
      });
      _plSettingsBtn = document.createElement('button');
      _plSettingsBtn.className = 'refresh-btn';
      _plSettingsBtn.textContent = '⚙️ 收录设置';
      _plSettingsBtn.title = '设置收录关键词（命中即入库）';
      _plSettingsBtn.style.marginLeft = '4px';
      _plSettingsBtn.addEventListener('click', () => editTargetKeywords());
      refresh.parentNode.appendChild(_plRefreshBtn);
      refresh.parentNode.appendChild(_plSettingsBtn);
    }
    _plRefreshBtn.style.display = '';
    _plSettingsBtn.style.display = '';
    if (_followBatchBtn) _followBatchBtn.style.display = 'none';
    if (_followRefreshBtn) _followRefreshBtn.style.display = 'none';
  } else if (mode === 'chatFollow') {
    if (!_followBatchBtn) {
      _followBatchBtn = document.createElement('button');
      _followBatchBtn.className = 'batch-send-btn';
      _followBatchBtn.textContent = '🤖 通知页全部回复';
      _followBatchBtn.title = '在通知页自动回复所有待回复会话：AI 生成 → 自动发送 → 3~8 秒随机间隔';
      _followBatchBtn.addEventListener('click', () => {
        const fc = document.getElementById('chatFollowContent');
        if (fc) batchChatFollowReply(fc);
      });
      _followRefreshBtn = document.createElement('button');
      _followRefreshBtn.className = 'refresh-btn';
      _followRefreshBtn.textContent = '🔄 通知页刷新';
      _followRefreshBtn.title = '重新从通知页提取通知流并重组会话';
      _followRefreshBtn.addEventListener('click', () => {
        const fc = document.getElementById('chatFollowContent');
        if (fc) loadChatFollow(fc);
      });
      refresh.parentNode.appendChild(_followBatchBtn);
      refresh.parentNode.appendChild(_followRefreshBtn);
    }
    _followBatchBtn.style.display = '';
    _followRefreshBtn.style.display = '';
    if (_plRefreshBtn) _plRefreshBtn.style.display = 'none';
    if (_plSettingsBtn) _plSettingsBtn.style.display = 'none';
  } else if (mode === 'waterSummary') {
    if (_followBatchBtn) _followBatchBtn.style.display = 'none';
    if (_followRefreshBtn) _followRefreshBtn.style.display = 'none';
    if (_plRefreshBtn) _plRefreshBtn.style.display = 'none';
    if (_plSettingsBtn) _plSettingsBtn.style.display = 'none';
  } else {
    if (_followBatchBtn) _followBatchBtn.style.display = 'none';
    if (_followRefreshBtn) _followRefreshBtn.style.display = 'none';
    if (_plRefreshBtn) _plRefreshBtn.style.display = 'none';
    if (_plSettingsBtn) _plSettingsBtn.style.display = 'none';
  }
}

// 重渲染评论跟进列表（发送/标记/批量完成后调用）
async function reloadChatFollow() {
  const fc = document.getElementById('chatFollowContent');
  if (fc && fc.style.display !== 'none') await loadChatFollow(fc);
}

/* ═══════════ 小窗评论助手：三分屏 （StepFlow） ═══════════ */
// 屏1：笔记列表（左栏全宽）→ 屏2：单篇进度 → 屏3：逐条评论处理
const StepFlow = {
  note: null,          // 当前选中的笔记
  prospects: [],       // 当前笔记的商机（一次一条）
  pos: 0,              // 屏3 当前处理位置
  list: [],            // 屏3 待处理队列（优先商机）
  running: false,

  // 进入屏1：左栏全宽
  enterStep1() {
    const layout = document.querySelector('.split-layout');
    if (!layout) return;
    layout.classList.remove('step2', 'step3');
    layout.classList.add('step1');
    document.getElementById('stepBar')?.remove();
    // 让左栏可见、右栏隐藏
    _setPanelLeftVisible(true);
    const right = document.querySelector('.panel-right');
    if (right) right.style.display = '';
    const mc = document.getElementById('mainContent');
    if (mc) mc.innerHTML = '';
  },

  // 进入屏2：单篇进度
  async enterStep2(note) {
    this.note = note || this.note || {};
    const layout = document.querySelector('.split-layout');
    if (!layout) return;
    layout.classList.remove('step1', 'step3');
    layout.classList.add('step2');
    _setPanelLeftVisible(false);
    // 构建待处理队列：优先商机，其次全部未回复评论
    await this._buildQueue();
    this._renderStep2();
    this._publish();
  },

  async _buildQueue() {
    this.prospects = pageData?.prospects || [];
    // 商机优先
    this.list = this.prospects.slice();
    // 若没有商机，退回全部未回复评论
    if (this.list.length === 0 && pageData?.comments) {
      this.list = pageData.comments.map((c, i) => ({
        index: i,
        author: c.author,
        original_comment: c.content,
        suggested_copies: [''], // 空话术，手动填
        userLink: c.userLink || '',
      }));
    }
    this.pos = 0;
  },

  _renderStep2() {
    const total = this.list.length;
    const done = this.prospects.filter(p => p._sent).length;
    const doneTotal = (pageData?.comments?.length || 0);
    const mc = document.getElementById('mainContent');
    if (!mc) return;
    const title = (this.note?.title || '当前笔记').slice(0, 40);
    mc.innerHTML = `
      <div class="step-bar">
        <button class="back-link" id="step2Back">← 列表</button>
        <span class="step-title">📄 ${esc(title)}</span>
        <span class="step-progress" id="step2Prog">${done}/${doneTotal} 已处理</span>
      </div>
      <div class="step-panel">
        <div class="step2-stats">
          <div class="step2-stat" style="color:#333;"><div class="num">${total}</div><div class="lbl">本篇评论</div></div>
          <div class="step2-stat amber"><div class="num">${total - done}</div><div class="lbl">待处理</div></div>
          <div class="step2-stat green"><div class="num">${done}</div><div class="lbl">已处理</div></div>
        </div>
        <button class="step2-start-btn" id="step2Start" ${total === 0 ? 'disabled' : ''}>🎯 开始逐条处理（${total} 条）</button>
        <div style="font-size:11px;color:#888;margin-top:10px;text-align:center;">优先处理 AI 判定为商机的评论</div>
      </div>`;
    document.getElementById('step2Back')?.addEventListener('click', () => {
      showEmpty();
      this.enterStep1();
    });
    document.getElementById('step2Start')?.addEventListener('click', () => this.enterStep3());
  },

  // 进入屏3：逐条
  enterStep3() {
    if (this.list.length === 0) return;
    const layout = document.querySelector('.split-layout');
    if (!layout) return;
    layout.classList.remove('step1', 'step2');
    layout.classList.add('step3');
    _setPanelLeftVisible(false);
    this.pos = 0;
    this.running = true;
    this._renderStep3();
    this._publish();
  },

  _renderStep3() {
    if (this.pos >= this.list.length) {
      // 全部完成
      this._publish();
      const mc = document.getElementById('mainContent');
      mc.innerHTML = `
        <div class="step-bar">
          <button class="back-link" id="step3DoneBack">← 返回列表</button>
          <span class="step-title">✅ 全部处理完成</span>
        </div>
        <div style="text-align:center;padding:60px 20px;">
          <div style="font-size:40px;margin-bottom:12px;">🎉</div>
          <div style="font-size:16px;font-weight:700;color:#333;">本篇 ${this.list.length} 条已全部处理</div>
          <div style="font-size:12px;color:#888;margin-top:8px;">去下一篇文章继续？</div>
        </div>`;
      document.getElementById('step3DoneBack')?.addEventListener('click', () => {
        showEmpty();
        this.enterStep1();
      });
      this.running = false;
      return;
    }
    const item = this.list[this.pos];
    this._publish();
    const idx = (item.index !== undefined ? item.index : this.pos);
    const author = item.author || '匿名';
    const quote = String(item.original_comment || item.content || '');
    const copies = (item.suggested_copies && item.suggested_copies.length
      ? item.suggested_copies
      : (item.suggested_copy ? [item.suggested_copy] : [''])
    ).map(c => stripVersionPrefix(String(c || '').trim())).filter(Boolean);
    const labels = (item.copy_labels && item.copy_labels.length ? item.copy_labels : []).map(s => String(s || '').trim());
    const defaultCopy = copies[0] || '';
    const isProspect = !!this.prospects.some(p => p.index === idx || p.author === author);

    const mc = document.getElementById('mainContent');
    mc.innerHTML = `
      <div class="step-bar">
        <button class="back-link" id="step3Back">← 进度</button>
        <span class="step-title">${isProspect ? '🎯' : '💬'} ${esc(author)}</span>
        <span class="step-progress">处理中 ${this.pos + 1}/${this.list.length}</span>
      </div>
      <div class="step3-wrap">
        <div class="step3-card">
          <div class="step3-author">@${esc(author)}</div>
          <div class="step3-quote">“${esc(quote.slice(0, 200))}${quote.length > 200 ? '…' : ''}”</div>
          <div class="step3-tabs" id="step3Tabs"></div>
          <textarea class="step3-textarea" id="step3Text" placeholder="输入回复内容...">${esc(defaultCopy)}</textarea>
          <div class="step3-flash" id="step3Flash"></div>
          <div class="step3-actions">
            <button class="send" id="step3Send">📤 发送这条</button>
            <button class="copy" id="step3Copy">📋 复制</button>
            <button class="skip" id="step3Skip">⏭ 跳过</button>
          </div>
        </div>
      </div>`;

    // 版本切换
    const tabsBox = document.getElementById('step3Tabs');
    copies.forEach((cp, vi) => {
      const b = document.createElement('button');
      b.className = 'step3-tab' + (vi === 0 ? ' active' : '');
      b.textContent = '版本' + (vi + 1) + (labels && labels[vi] ? ' · ' + labels[vi] : '');
      b.onclick = () => {
        document.querySelectorAll('.step3-tab').forEach(t => t.classList.remove('active'));
        b.classList.add('active');
        document.getElementById('step3Text').value = cp;
      };
      tabsBox.appendChild(b);
    });

    document.getElementById('step3Back')?.addEventListener('click', () => this.enterStep2(this.note));
    document.getElementById('step3Copy')?.addEventListener('click', () => {
      const t = document.getElementById('step3Text');
      if (!t) return;
      navigator.clipboard.writeText(t.value).then(() => {
        this._flash('已复制 ✓');
      }).catch(() => {});
    });
    document.getElementById('step3Skip')?.addEventListener('click', () => { this.pos++; this._publish(); this._renderStep3(); });

    // 发送这条（复用 sendReply 机制）
    document.getElementById('step3Send')?.addEventListener('click', async () => {
      const textarea = document.getElementById('step3Text');
      const replyText = (textarea ? textarea.value : '').trim();
      if (!replyText) { this._flash('⚠️ 请输入回复内容', 'err'); return; }
      const sendBtn = document.getElementById('step3Send');
      sendBtn.disabled = true;
      sendBtn.textContent = '发送中...';
      this._flash('正在发送...', 'warn');
      try {
        const tab = await getTargetTab();
        if (!tab) { this._flash('❌ 不在小红书页面', 'err'); sendBtn.disabled = false; sendBtn.textContent = '📤 发送这条'; return; }
        addLog(`📤 分步：发送给 @${author}...`, 'info');
        const result = await sendTabMessageWithTimeout(tab.id, {
          action: 'sendReply', author, originalText: quote, replyText, commentIdx: idx, userLink: item.userLink || '',
          images: kbImages, humanize: false,
        }, 60000);
        if (result && result.success) {
          try { addLocalReply(pageData?.url || '', author, quote); } catch (_) {}
          const p = this.prospects.find(p => p.index === idx || p.author === author);
          if (p) p._sent = true;
          this._flash('✅ 已发送，自动进入下一条');
          setTimeout(() => { this.pos++; this._publish(); this._renderStep3(); }, 500);
        } else {
          this._flash(`❌ ${(result && result.error) || '发送失败'}`, 'err');
          sendBtn.disabled = false;
          sendBtn.textContent = '📤 发送这条';
        }
      } catch (e) {
        this._flash('⚠️ ' + String(e.message || e), 'err');
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 发送这条';
      }
    });
  },

  _flash(msg, kind) {
    const el = document.getElementById('step3Flash');
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'err' ? '#d32f2f' : kind === 'warn' ? '#ff8f00' : '#2e7d32';
  },

  // 供外部：笔记打开后进入屏2（小窗模式）
  async activateForNote(note, onSmall) {
    if (!onSmall) return;
    await this.enterStep2(note);
  },
  reset() {
    this.note = null; this.prospects = []; this.pos = 0; this.list = []; this.running = false;
  },

  // ★ 把当前处理状态发布到 storage，供小窗「只读状态卡」读取
  _publish() {
    const st = {
      ts: Date.now(),
      note: this.note ? (this.note.title || '') : '',
      stage: this.running ? 'processing' : (this.list.length ? 'ready' : 'idle'),
      total: this.list.length,
      done: this.prospects ? this.prospects.filter(p => p._sent).length : 0,
      pos: Math.min(this.pos + 1, Math.max(this.list.length, 1)),
      author: (this.list[this.pos] || {}).author || '',
    };
    try { chrome.storage.local.set({ _step_status: st }); } catch (_) {}
  },
};

// 大窗：打开笔记或分步变化时，把状态发布给小窗
function publishStepStatus(note, stageExtra) {
  try {
    const noteTitle = (pageData && (pageData.title || (pageData.noteData && pageData.noteData.title))) || (note ? (note.title || '') : '');
    const st = {
      ts: Date.now(),
      note: noteTitle,
      stage: stageExtra || (pageData && pageData.prospects ? 'ready' : 'processing'),
      total: (pageData && pageData.comments ? pageData.comments.length : 0),
      done: (pageData && pageData.prospects ? pageData.prospects.filter(p => p._sent).length : 0),
      pos: 0,
      author: '',
    };
    chrome.storage.local.set({ _step_status: st });
    return st;
  } catch (_) { return null; }
}

// 小窗：评论助手 tab 初始进入屏1（小窗状态卡模式不再走分步交互，保留此函数兼容）
function initStepFlow() {
  if (MODE_BIG) return;
  const layout = document.querySelector('.split-layout');
  if (layout) { layout.classList.add('step1'); }
}

/* ═══════════ 小窗只读状态卡 ═══════════ */
function renderStepStatusCard() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  chrome.storage.local.get('_step_status', (r) => {
    const st = (r && r._step_status) || null;
    if (!st) {
      // 大窗尚未开始处理 → 显示引导
      mc.innerHTML = `
        <div style="text-align:center;padding:40px 24px;">
          <div style="font-size:38px;margin-bottom:12px;">🖥️</div>
          <div style="font-size:15px;font-weight:700;color:#333;margin-bottom:8px;">小蝉书助手 · 大窗已开启</div>
          <div style="font-size:12px;color:#888;line-height:1.8;">处理在大窗进行，本窗口实时同步状态</div>
          <button class="step2-start-btn" id="goBigBtn" style="margin-top:18px;">🚀 切换到大窗</button>
        </div>`;
      wireGoBig();
      return;
    }
    const prog = st.total ? Math.round((st.pos / st.total) * 100) : 0;
    const stageText =
      (st.stage === 'processing') ? '⏳ 正在处理评论' :
      (st.stage === 'ready') ? '✅ 待开始逐条' : '⛔ 空闲';
    mc.innerHTML = `
      <div style="padding:20px 22px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span style="font-size:14px;font-weight:700;color:#333;">🖥️ 大窗状态</span>
          <button id="goBigBtn" style="padding:5px 12px;font-size:11px;background:var(--xhs-red);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">↗ 切换到大窗</button>
        </div>
        <div style="background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);">
          <div style="font-size:12px;color:#888;">当前笔记</div>
          <div style="font-size:14px;font-weight:600;color:#222;margin:4px 0 14px;word-break:break-all;">${esc(st.note || '（无）')}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="font-size:20px;font-weight:700;color:var(--xhs-red);">${st.pos}/${st.total}</div>
            <div style="flex:1;height:8px;background:#f0f0f2;border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${prog}%;background:var(--grad-red);border-radius:4px;transition:width .3s;"></div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;">
            <span>${stageText}</span>
            <span>已处理 ${st.done} · 完成 ${prog}%</span>
          </div>
        </div>
        <div style="text-align:center;font-size:11px;color:#bbb;margin-top:10px;">状态每 2 秒刷新 · ${new Date(st.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>`;
    wireGoBig();
  });
}

function wireGoBig() {
  const btn = document.getElementById('goBigBtn');
  if (btn) btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openBigWindow', senderTab: null }).catch(() => {});
  });
}

// 小窗：周期性轮询状态
function startStatusPolling() {
  if (MODE_BIG) return;
  renderStepStatusCard();
  setInterval(renderStepStatusCard, 2000);
}

/* ═══════════ 获客清单模块（v2 · 销售管线：线索/商机/客户） ═══════════ */
const PL_PAGE_SIZE = 50;
let _plFilter = { keyword: '' };                             // 搜索
let _plFilter2 = { channel: '', touch: [], related: '' }; // 渠道 / 状态多选 / 是否相关
let _plShowDiscarded = false;                                 // 已废弃(回收站)视图：🗑 标废的可在此恢复/彻底删
let _plPage = 0;
let _plData = { list: [], allTags: [], fullList: [] };
let _plStage = 'all'; // 子视图：all / notif(通知) / msg(消息)
let _plChannelSel = ''; // 通知渠道筛选：''全部 / comment / like / follow / ai
let _currentShown = []; // 当前 tab 渲染出来的那批（批量触达/生成话术作用于它，而非全量）
let _plMsg = false;   // true = 消息台(/chat会话一览)视图

// 意向色点
function _plDot(intent) {
  const cls = intent === 'high' ? 'high' : (intent === 'medium' ? 'medium' : 'low');
  return `<span class="pl-dot ${cls}" title="意向：${intent || '未画像'}"></span>`;
}
function _intentLabel(v) { return v === 'high' ? '高' : v === 'medium' ? '中' : v === 'low' ? '低' : ''; }

// ── v2 字段访问器（二级管线：lead / prospect）──
const _plGetStage = p => (p && p.stage) || 'lead';
const _plFunnel = p => (p && p.funnel) || { step: 'pending', dmCount: 0, lastDmAt: null };
// ★ 双桶：msg=消息(对方进线/有往来会话)；notif=通知(没进线)。
//   ★ 我"主动触达"过的通知线索不因建了会话就跳到消息桶——等对方回了(进线)才算消息；没回的就留在通知里显示"已触达/待回复"
const _plBucket = p => {
  if (!p) return 'notif';
  if (p.inbound || p.direction === 'inbound' || (p.source && p.source.stageEntry === '消息')) return 'msg';
  return 'notif';
};
// ★ 同一个人跨渠道/跨桶的全部记录 id（userId 相同 或 昵称相同，排除未知用户）→ 状态/触达按人全局同步（双向）
function _samePersonIds(person) {
  if (!person || !person.id) return [];
  const out = new Set();
  const uid = person.userId ? String(person.userId).toLowerCase() : '';
  const nick = person.nickname ? String(person.nickname).replace(/\s+/g, '').toLowerCase() : '';
  const hasNick = !!(nick && nick !== '未知用户' && nick !== 'unknownuser');
  for (const q of (_plData.list || [])) {
    if (!q || !q.id || q.id === person.id) continue;
    const qu = q.userId ? String(q.userId).toLowerCase() : '';
    const qn = q.nickname ? String(q.nickname).replace(/\s+/g, '').toLowerCase() : '';
    const shareUid = uid && qu && uid === qu;
    const shareNick = hasNick && qn && qn === nick && qn !== '未知用户';
    if (shareUid || shareNick) out.add(q.id);
  }
  return Array.from(out);
}
const _isOutbound = p => p.direction === 'outbound' || (!p.direction && !p.inbound && !!p.convId);
const _plEntry = p => ((p && p.source && p.source.stageEntry) || '');

// ★ 渠道：和"来源"字段对应 —— 评论 / 点赞&收藏 / 关注 / AI
const _plChannel = p => {
  const e = _plEntry(p) || ((p && p.signalType) || '');
  if (e === '关注') return '关注';
  if (e === '点赞' || e === '收藏') return '赞藏';
  if (e === '回复' || e === '评论' || e === '互动') return '评论';
  if (e === 'AI路由' || e === '关键词命中' || e === '评论跟进') return 'AI';
  return '';
};

// ★ 触达标识：未触达 / 已触达 / 待回复 / 已转商机（优先级 商机 > 待回复 > 已触达 > 未触达）
function _plTouchState(p) {
  const st = _plGetStage(p);
  if (st === 'prospect' || p.convId || p.inbound || p.themReplied) return 'prospect';
  if (p.awaitingReply) return 'awaiting';
  if (_isOutbound(p) || p.dmStatus === 'sent') return 'touched';
  return 'untouched';
}

// ═══ 统一状态模型（6 档）═══
const PL_STATUS_ALL = ['待触达', '已触达', '谈单中', '流失中', '已成交', '已废弃'];
const STATUS_RANK = { '待触达': 1, '已触达': 2, '谈单中': 3, '流失中': 4, '已成交': 5, '已废弃': 6 };
const STATUS_RANK_REV = { 1: '待触达', 2: '已触达', 3: '谈单中', 4: '流失中', 5: '已成交', 6: '已废弃' };
// 旧数据迁移：历史「已回复」按「谈单中」显示（不改底层值）
function _rawStatusOf(p) { const s = (p && p.status) || ''; return (s === '已回复') ? '谈单中' : s; }
const _isMsgRecord = p => _plBucket(p) === 'msg';
// 流失中：该人已达「已触达/谈单中」这一级（已确认联系），且最后一条消息距今 ≥3 天、对方未回（等对方回）
function _isLost(q) {
  if (!(q.awaitingReply) && q.lastFrom !== 'me' && !_isOutbound(q)) return false; // 不在等对方回 → 不算流失
  const raw = (q.lastConvFp && q.lastConvFp.at);
  let t = 0;
  if (typeof raw === 'number') t = raw;
  else if (raw) { t = Date.parse(String(raw)); if (isNaN(t)) t = 0; }
  if (!t) return false;
  return (Date.now() - t) >= 3 * 24 * 3600 * 1000;
}
// ★ 一个人的「有效状态」：取该人所有记录里最高优先（跨渠道跨桶统一；流失中为时间派生）
// 该人是否在消息桶里已有同名/同 id 的记录（→ 视为已被触达，用户清单不再显示为未接触）
function _hasMsgSibling(person) {
  if (!person) return false;
  const full = (_plData && _plData.fullList) || [];
  if (!full.length) return false;
  const _nm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const uid = person.userId ? String(person.userId).toLowerCase() : '';
  const nick = _nm(person.nickname);
  return full.some(q => {
    if (!q || q.id === person.id) return false;
    if (!(q.inbound || q.direction === 'inbound' || (q.source && q.source.stageEntry === '消息'))) return false;
    if (uid && q.userId) return String(q.userId).toLowerCase() === uid;
    if (nick && nick !== '未知用户' && _nm(q.nickname)) return _nm(q.nickname) === nick;
    return false;
  });
}
function _personStatus(person) {
  const ids = person ? [person.id, ..._samePersonIds(person)] : [];
  let rank = 0;
  const recs = (_plData.list || []).filter(q => q && q.id && ids.includes(q.id));
  if (!recs.length) return _rawStatusOf(person) || '待触达';
  for (const q of recs) {
    const s = _rawStatusOf(q);
    let r;
    if (s === '已废弃') r = 6;
    else if (s === '已成交') r = 5;
    else if (s === '谈单中') r = 3;
    else if (s === '已触达' || _isMsgRecord(q)) r = 2;
    else r = 1;
    if ((r === 2 || r === 3) && _isLost(q)) r = 4; // 已确认联系且 3 天未回 → 流失中
    if (r > rank) rank = r;
  }
  return STATUS_RANK_REV[rank] || '待触达';
}

// ★ 统一状态机：每桶仅 3 态，单一派生出口（不再多头判断底层字段）
const PL_STATE_META = {
  untouched: { t: '未触达', c: '#2563eb', bg: '#eff6ff' },   // 通知：进池没动手
  touched: { t: '已触达·待回复', c: '#b45309', bg: '#fffbeb' }, // 通知：我发了等对方回
  prospect: { t: '已转商机', c: '#7c3aed', bg: '#f5f3ff' }, // 通知：对方回→已转商机
  open: { t: '未转化', c: '#059669', bg: '#ecfdf5' },       // 消息：在谈没成交
  converted: { t: '已转化', c: '#92400e', bg: '#fef3c7' }, // 消息：已成交
  other: { t: '其他', c: '#6b7280', bg: '#f3f4f6' },       // 消息：未收录/受限/杂项
};
function _plClosed(p) { return p.status === '已成交' || (p.funnel && p.funnel.step === 'closed'); }
function _plStateOf(p, bucket) {
  const st = _plGetStage(p);
  if (bucket === 'msg') {
    if (_plClosed(p)) return 'converted';
    if (st === 'prospect' || (st === 'lead' && p.awaitingReply)) return 'open';
    return 'other';
  }
  if (st === 'prospect') return 'prospect';
  if (p.awaitingReply) return 'touched';
  return 'untouched';
}
function _plSatisfies(p, key, bucket) {
  if (!key) return true;
  return _plStateOf(p, bucket) === key;
}
// 层内子状态定义
const PL_STAGE_META = {
  lead: { t: '🎇 线索', c: '#0f766e', bg: '#ecfdf5' },
  prospect: { t: '🎯 商机', c: '#7c3aed', bg: '#f5f3ff' },
};
const PL_FUNNEL = {
  pending: { t: '待触达', c: '#2563eb', bg: '#eff6ff' },
  touched: { t: '已触达', c: '#b45309', bg: '#fffbeb' },
  replied: { t: '已回复', c: '#059669', bg: '#ecfdf5' },
  talking: { t: '谈单中', c: '#7c3aed', bg: '#f5f3ff' },
  closed: { t: '已成交', c: '#92400e', bg: '#fef3c7' },
};
const PL_DEFAULT_STATUSES = ['待触达', '已触达', '谈单中', '流失中', '已成交', '已废弃'];
const PL_ENTRY_BADGE = {
  '点赞': { t: '💗点赞', c: '#0e7490', bg: '#ecfeff' },
  '收藏': { t: '⭐收藏', c: '#d97706', bg: '#fffbeb' },
  '关注': { t: '👣关注', c: '#475569', bg: '#f1f5f9' },
  '回复': { t: '💬回复', c: '#059669', bg: '#ecfdf5' },
  '评论': { t: '💬评论', c: '#4f46e5', bg: '#eef2ff' },
  '关键词命中': { t: '🔑关键词', c: '#b45309', bg: '#fffbeb' },
  'AI路由': { t: '🧠AI', c: '#7c3aed', bg: '#f5f3ff' },
  '消息': { t: '💬消息', c: '#0e7490', bg: '#ecfeff' },
  '评论跟进': { t: '💬AI客服', c: '#059669', bg: '#ecfdf5' },
  '手动': { t: '✋手动', c: '#475569', bg: '#f1f5f9' },
};

// 层徽章：商机池显示用户维护的状态，线索池显示层级
const _plStatusColor = (s) => ({ '待触达': '#2563eb', '已触达': '#b45309', '谈单中': '#7c3aed', '流失中': '#d97706', '已成交': '#92400e', '已废弃': '#6b7280', '已回复': '#7c3aed' }[s] || '#6b7280');
function _plStageBadge(p) {
  const s = _plGetStage(p);
  if (s === 'prospect') { const st = p.status || '待触达'; return `<span class="pl-badge" style="background:#eef2ff;color:${_plStatusColor(st)};">${esc(st)}</span>`; }
  const m = PL_STAGE_META.lead; return `<span class="pl-badge" style="background:${m.bg};color:${m.c};">${m.t}</span>`;
}
// 来源徽章
function _plEntryBadge(p) {
  const m = PL_ENTRY_BADGE[_plEntry(p)];
  if (!m) return '';
  return `<span class="pl-origin" style="background:${m.bg};color:${m.c};">${m.t}</span>`;
}
// ── 多来源辅助：读记录历次渠道 channels[]（旧数据兜底从 source 推导）──
const _CH_PRIO = { '评论': 0, '点赞&收藏': 1, 'AI': 2, '关注': 3 };
const _CH_ENTRY_TYPE = { '关注': '关注', '点赞': '点赞&收藏', '收藏': '点赞&收藏', '回复': '评论', '评论': '评论', '互动': '评论', 'AI路由': 'AI', '关键词命中': 'AI', '评论跟进': 'AI', '消息': '' };
function _channelsOf(p) {
  if (p && Array.isArray(p.channels) && p.channels.length) return p.channels;
  const e = (p && p.source && p.source.stageEntry) || '';
  if (!e) return [];
  return [{ type: _CH_ENTRY_TYPE[e] || '评论', entry: e, comment: (p.source && p.source.comment) || p.likedComment || '', noteTitle: (p.source && p.source.noteTitle) || '', nTime: p.nTime || null, nTimeStr: p.nTimeStr || '', signalText: (p.source && p.source.signalText) || '' }];
}
function _bestChannel(p) {
  const cs = _channelsOf(p);
  if (!cs.length) return null;
  return cs.slice().sort((a, b) => (_CH_PRIO[a.type] !== undefined ? _CH_PRIO[a.type] : 9) - (_CH_PRIO[b.type] !== undefined ? _CH_PRIO[b.type] : 9))[0];
}
function _channelsBadge(p) {
  const seen = new Set();
  return _channelsOf(p).map(c => {
    const m = PL_ENTRY_BADGE[c.entry] || PL_ENTRY_BADGE[c.type == null ? '' : c.type];
    if (!m) return '';
    if (seen.has(m.t)) return '';
    seen.add(m.t);
    return `<span class="pl-origin" style="background:${m.bg};color:${m.c};">${m.t}</span>`;
  }).filter(Boolean).join(' ');
}
function _notifContent(p) {
  const c = _bestChannel(p);
  if (!c) return '<span style="color:#c0c4cc;">—</span>';
  if (c.type === '评论' && c.comment) return `📝 <span title="${esc(c.comment)}">${esc(String(c.comment).slice(0, 80))}</span>`;
  if (c.noteTitle) return `📕 <span title="${esc(c.noteTitle)}">${esc(String(c.noteTitle).slice(0, 40))}</span>`;
  const t = c.signalText || c.comment || '';
  return t ? esc(String(t).slice(0, 80)) : '<span style="color:#c0c4cc;">—</span>';
}
function _channelTimeVal(p) {
  const c = _bestChannel(p);
  return fmtDateTime((c && c.nTime) || p.nTime || p.updatedAt);
}
// 层内"下一步"建议（体现"接触过没 → 下一步该做啥"）
function _plNextHint(p) {
  const s = _plGetStage(p);
  if (s === 'lead') return '🎇 线索 · 未接触：私信触达→对方回复即升商机；点「🧠 高意向跟进」优先追';
  return `⏩ 商机 · 已在跟进，状态由你维护（可改状态列表）`;
}

// 收录关键词设置（弹窗编辑 config.product.targetKeywords）
async function editTargetKeywords() {
  const config = await getConfigSafe();
  const kws = (config.product && config.product.targetKeywords) || [];
  const joined = kws.join('，');
  const val = window.prompt('收录关键词（命中评论即自动入清单，多个用逗号分隔）：', joined);
  if (val === null) return;
  const list = val.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
  await updateConfig({ product: { targetKeywords: list } });
  addLog(`⚙️ 收录关键词已更新：${list.join('、') || '（空）'}`, 'info');
  const pc = document.getElementById('prospectContent');
  if (pc && pc.style.display !== 'none') loadProspectList(pc);
}

// 商机池状态列表管理（用户手工维护：状态可增删改，每个商机挂一个）
async function editProspectStatus() {
  const config = await getConfigSafe();
  const cur = (config.prospect && config.prospect.statuses) || PL_DEFAULT_STATUSES;
  const val = window.prompt('商机状态列表（每个商机可选一个状态，逗号分隔）：\n例：待触达，已回复，谈单中，已成交', cur.join('，'));
  if (val === null) return;
  const list = val.split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean);
  await updateConfig({ prospect: { statuses: list } });
  addLog(`⚙️ 商机状态已更新：${list.join('、') || '（空）'}`, 'info');
  const pc = document.getElementById('prospectContent');
  if (pc && pc.style.display !== 'none') loadProspectList(pc);
}

async function getConfigSafe() {
  const resp = await chrome.runtime.sendMessage({ action: 'getConfig' });
  return (resp && resp.config) || {};
}
async function updateConfig(partial) {
  const config = await getConfigSafe();
  await chrome.runtime.sendMessage({ action: 'updateConfig', data: partial });
  return config;
}

// 主渲染
async function loadProspectList(container) {
  container.innerHTML = '';
  const loading = document.createElement('div');
  loading.style.cssText = 'padding:30px;text-align:center;color:#666;font-size:13px;';
  loading.textContent = '⏳ 加载用户清单...';
  container.appendChild(loading);

  const resp = await chrome.runtime.sendMessage({ action: 'getProspectList', data: { filter: _plFilter, includeDiscarded: _plShowDiscarded } });
  if (resp && resp.ok && (!resp.list || resp.list.length === 0)) {
    addLog(`[拉取] ok=true 返回=${(resp.list || []).length} | 活动key=${resp._rawActive} | 租户快照=${resp._snapCount} | 当前租户=${resp._cur} | discard=${_plShowDiscarded} stage=${_plStage}`, 'warn');
  }
  if (!resp || !resp.ok) {
    loading.textContent = '❌ 加载失败：' + ((resp && resp.error) || '未知错误');
    return;
  }
  // 统计条用全量数据（不带筛选），避免筛选后统计数字跟着变
  let fullList = [];
  try {
    const full = await chrome.runtime.sendMessage({ action: 'getProspectList', data: {} });
    if (full && full.ok) fullList = full.list || [];
  } catch (_) {}
  // 商机状态列表（用户可手工维护）——从配置读取
  let statuses = [];
  try {
    const cfg = await getConfigSafe();
    statuses = (cfg.prospect && cfg.prospect.statuses) || [];
  } catch (_) {}
  _plData = { list: resp.list || [], allTags: resp.allTags || [], fullList, statuses };
  try {
    renderProspectList(container);
  } catch (e) {
    addLog('❌ 渲染用户清单出错：' + (e && e.message) + '　' + ((e && e.stack || '').split('\n')[1] || ''), 'error');
    const er = document.createElement('div');
    er.style.cssText = 'padding:14px;color:#c62828;font-size:12px;line-height:1.6;';
    er.innerHTML = '❌ 渲染清单出错：' + esc((e && e.message) || e) + '<br><span style="color:#888;font-size:11px;">已在实时日志里打印出错位置，把 `❌ 渲染用户清单出错` 那行发我。</span>';
    container.appendChild(er);
  }
}

// 清空列表下拉：可只清「消息(对方进线)」桶，或全部清空（备份安全提示）
// 统一时间格式：yyyy-MM-dd HH:mm（支持 ms/秒时间戳、可解析日期串；解析失败回显原文）
function fmtDateTime(t) {
  if (t === undefined || t === null || t === '') return '';
  let d;
  if (typeof t === 'object' && t instanceof Date) { d = t; }
  else {
    const s = String(t);
    if (/^\d+$/.test(s)) { const n = Number(s); d = new Date(n > 1e12 ? n : n * 1000); }
    else d = new Date(s);
  }
  if (!d || isNaN(+d)) return String(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 清空列表下拉：可只清「消息(对方进线)」桶，或全部清空（备份安全提示）
function buildBucketClearSelect(container) {
  const sel = document.createElement('select');
  sel.title = '清空列表';
  sel.style.cssText = 'font-size:11px;padding:4px 6px;border:1px solid #e2e8f0;border-radius:8px;color:#b45309;background:#fffbeb;cursor:pointer;';
  sel.innerHTML = '<option value="">🗑 清空…</option><option value="msg">清空消息(对方进线)</option><option value="notif">清空通知</option><option value="all">全部清空(消息+通知)</option>';
  sel.addEventListener('change', async () => {
    const v = sel.value;
    sel.value = '';
    if (!v) return;
    const label = { msg: '消息列表(对方进线)', notif: '通知列表', all: '全部获客清单' }[v];
    if (!confirm(`确认清空「${label}」？此操作不可恢复。\n（建议先到设置页「💾 备份/恢复」导出一份再清）`)) return;
    try {
      if (v === 'all') await chrome.runtime.sendMessage({ action: 'clearProspects', data: {} });
      else await chrome.runtime.sendMessage({ action: 'clearProspectBucket', data: { bucket: v } });
      addLog('🗑 已清空' + label, 'warn');
      if (container) loadProspectList(container);
      else if (typeof renderProspectList === 'function') renderProspectList(document.querySelector('.prospect-wrap') || document.body);
    } catch (e) { window.alert('清空失败：' + (e && e.message || e)); }
  });
  return sel;
}

function renderProspectList(container) {
  container.innerHTML = '';
  const allList = _plData.list;
  // ★ "已废弃"= 一种状态；多选 chips ＝ 并集筛选（选中越多显示越多）
  const _isDisc = (p) => !!(p && (p.status === '已废弃' || p.discarded === true));
  const _touchSel = Array.isArray(_plFilter2.touch) && _plFilter2.touch.length ? _plFilter2.touch.slice() : [];
  // 🗑 已废弃管理视图：仅当【只勾选「已废弃」】进入（可恢复/彻底删）；与其它状态一起多选则按普通状态并集筛选
  const _dedicatedDisc = _touchSel.length === 1 && _touchSel[0] === '已废弃';
  _plShowDiscarded = _dedicatedDisc;
  let list;
  // 🗑 已废弃视图：只显示标废的，不做渠道/触达/相关过滤
  if (_dedicatedDisc) {
    list = allList.filter(_isDisc);
  } else {
    if (_plStage === 'all') {
      list = allList.slice();
    } else {
      list = allList.filter(p => _plBucket(p) === _plStage); // 双桶：msg(消息) / notif(通知)
    }
    if (_plHideBlocked) list = list.filter(p => !p.dmBlocked);
    // ★「通知」按渠道 tab 过滤（全部/评论/点赞&收藏/关注/AI）
    if (_plStage === 'notif' && _plChannelSel) {
      const chMap = { comment: '评论', like: '赞藏', follow: '关注', ai: 'AI' };
      const want = chMap[_plChannelSel];
      if (want) list = list.filter(p => _plChannel(p) === want);
    }
    // ★ 状态多选筛选：多选=并集（命中任一选中状态即保留）；未选=默认隐藏已废弃
    if (_touchSel.length) {
      list = list.filter(p => _touchSel.includes(_personStatus(p)));
    } else {
      list = list.filter(p => !_isDisc(p));
    }
  }
  _currentShown = list.slice(); // ★ 记录当前 tab 筛出的这批，供批量触达/生成话术用
  // ★ 一人一行：同 userId/昵称合并（触达状态按"人"算，任一渠道触达过，其余渠道也算已触达；
//  重复时保留触达进度更高/状态更优的那条）
  {
    const best = new Map();
    const prio = (x) => ({ untouched: 0, touched: 1, awaiting: 2, prospect: 3 }[_plTouchState(x)] !== undefined ? { untouched: 0, touched: 1, awaiting: 2, prospect: 3 }[_plTouchState(x)] : 0);
    const unionCh = (a, b) => {
      const out = (Array.isArray(a) ? a : []).slice();
      for (const c of (Array.isArray(b) ? b : [])) {
        if (!c || !c.type) continue;
        const i = out.findIndex(x => x && String(x.type) === String(c.type));
        if (i >= 0) out[i] = { ...out[i], ...c, type: out[i].type };
        else out.push(c);
      }
      return out;
    };
    for (const p of list) {
      const k = p.userId ? 'id:' + String(p.userId).toLowerCase() : ('nick:' + (p.nickname || '').toLowerCase());
      if (!k || k === 'nick:') { best.set('__uniq_' + best.size, p); continue; }
      const cur = best.get(k);
      if (!cur) { best.set(k, p); }
      else {
        const up = prio(p) > prio(cur) ? p : cur;
        best.set(k, { ...up, channels: unionCh(_channelsOf(cur), _channelsOf(p)) });
      }
    }
    list = Array.from(best.values());
  }
  // 消息桶：只把"已来回过的我方触达"折叠进独立分组；待回复(awaitingReply)outbound 进主列表置顶
  let outList = [];
  if (_plStage === 'msg') {
    outList = list.filter(p => _isOutbound(p) && !p.awaitingReply);
    const pendingOut = list.filter(p => _isOutbound(p) && p.awaitingReply); // 我方触达·对方未回 → 置顶
    list = list.filter(p => !_isOutbound(p));
    if (pendingOut.length) list = pendingOut.concat(list);
  }
  const total = list.length;
  const _isDisc2 = (p) => !!(p && (p.status === '已废弃' || p.discarded === true));
  const fullList = (_plData.fullList || allList).filter(p => (_plShowDiscarded || _touchSel.includes('已废弃')) ? true : !_isDisc2(p));
  // ★ 排序：待回复优先；回评(入口'回复')/高意向次之；其余按意向权重再按时间新到旧
  const _plEv = (p) => (p.profile && p.profile.intentLevel) || (p.affinity && p.affinity.intentLevel) || 'medium';
  const _intentRank = (p) => ({ high: 2, medium: 1, low: 0 }[_plEv(p)] !== undefined ? { high: 2, medium: 1, low: 0 }[_plEv(p)] : 1);
  const _replyRank = (p) => (_plEntry(p) === '回复' ? 1 : 0);
  // 最近活跃时间：优先会话最后消息时间，其次本地更新时间，避免用"收录时间"导致新旧倒置
  const _plActivity = (p) => {
    const raw = p.lastConvFp && p.lastConvFp.at;
    if (raw) { const t = (typeof raw === 'number') ? raw : Date.parse(String(raw)); if (!isNaN(t)) return t; }
    return (p.updatedAt || p.createdAt || 0);
  };
  // 消息桶排序键：XHS 会话 DOM 顺序(order, 0=最新在前)；没有则退回活跃时间倒序
  // 最近活跃/通知时间：优先通知真实时间 nTime，其次会话/更新时间
  const _nTimeOf = (p) => {
    if (p.nTime) { const n = +p.nTime; if (n > 0) return n; }
    const raw = p.lastConvFp && p.lastConvFp.at;
    if (raw) { const t = (typeof raw === 'number') ? raw : Date.parse(String(raw)); if (!isNaN(t)) return t; }
    return (p.updatedAt || p.createdAt || 0);
  };
  list = list.slice().sort((a, b) => _plActivity(b) - _plActivity(a)); // 消息/通知按"最后一条消息时间"倒序（最新在前），对齐小红书原序

  // 【诊断】列表空时，把存储与分桶情况写到"实时日志"，便于定位"没入库"还是"没显示"
  if (list.length === 0 && !_plShowDiscarded) {
    try {
      addLog(`[诊断] 存储=${allList.length} | 通知桶=${allList.filter(p => _plBucket(p) === 'notif').length} | 消息桶=${allList.filter(p => _plBucket(p) === 'msg').length} | 当前视图=${_plStage} | discarded=${_plShowDiscarded}`, 'warn');
      if (allList.length) {
        addLog('[诊断] 示例：' + allList.slice(0, 6).map(p => `${p.nickname || '?'}/${_plBucket(p)}/stage=${p.stage || '?'}/entry=${(p.source && p.source.stageEntry) || '?'}`).join('；'), 'warn');
      }
    } catch (_) {}
  }

  // 统计条：只在「全部」显示（消息/通知按用户要求不显示顶部指标）
  if (_plStage === 'all') {
    const stats = document.createElement('div');
    stats.className = 'pl-stats';
    const plN = (pred) => fullList.filter(pred).length;
    stats.style.cssText = 'font-size:11px;color:#6b7280;padding:2px 10px 4px;display:flex;gap:14px;flex-wrap:wrap;';
    stats.innerHTML =
      `<span>共 ${fullList.length} 人</span>` +
      `<span>📨 对方进线 ${plN(p => p.inbound || p.direction === 'inbound')}</span>` +
      `<span>⚪ 我方触达 ${plN(p => _isOutbound(p) || p.direction === 'outbound')}</span>` +
      `<span>🔔 通知 ${plN(p => _plBucket(p) === 'notif')}</span>`;
    container.appendChild(stats);
  }

  // 批量操作条（按层出ロ）
  const batch = document.createElement('div');
  batch.className = 'pl-batch';
  if (_plStage === 'msg') {
    // ── 消息工具条：[✨生成AI话术▾] [🔄刷新消息▾] ──
    const grp = document.createElement('span');
    grp.style.cssText = 'display:inline-flex;gap:6px;align-items:center;';
    const mkOpt = (html, style) => { const o = document.createElement('div'); o.innerHTML = html; o.style.cssText = style || 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#1a1a1a;'; o.addEventListener('mouseenter', () => { o.style.background = '#f3f0ff'; }); o.addEventListener('mouseleave', () => { o.style.background = ''; }); return o; };
    // [✨生成AI话术 ▾]（下拉 = 批量联系TA）
    const genWrap = document.createElement('span');
    genWrap.className = 'plNotifGroup';
    genWrap.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #ef4444;border-radius:8px;';
    const genBtn = document.createElement('button');
    genBtn.id = 'plMsgGenBtn'; genBtn.textContent = '✨ 生成AI话术';
    genBtn.style.cssText = 'padding:5px 12px;border:none;border-radius:8px 0 0 8px;background:#fef2f2;color:#dc2626;font-weight:600;cursor:pointer;font-size:11px;';
    genBtn.title = '为当前消息生成AI回复话术（红色=联系TA同款，点左侧主区批量生成）';
    const genCaret = document.createElement('button');
    genCaret.id = 'plMsgGenCaret'; genCaret.textContent = '▾';
    genCaret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #fca5a5;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:11px;';
    const genMenu = document.createElement('div');
    genMenu.className = 'plNotifMenu';
    genMenu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:61;min-width:150px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optContact = mkOpt('💬 批量联系TA', 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#dc2626;font-weight:600;');
    genMenu.appendChild(optContact);
    genWrap.append(genBtn, genCaret, genMenu);
    genBtn.addEventListener('click', () => { genMsgDrafts(container); });
    genCaret.addEventListener('click', () => { genMenu.style.display = genMenu.style.display === 'block' ? 'none' : 'block'; });
    optContact.addEventListener('click', async () => { genMenu.style.display = 'none'; await batchContactMsg(container); });
    // [🔄刷新消息 ▾]（下拉 = 清空消息）
    const refWrap = document.createElement('span');
    refWrap.className = 'plNotifGroup';
    refWrap.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #f59e0b;border-radius:8px;';
    const inb = document.createElement('button');
    inb.id = 'plSyncInbound'; inb.textContent = '🔄 刷新消息';
    inb.style.cssText = 'padding:5px 12px;border:none;border-radius:8px 0 0 8px;background:#fffbeb;color:#b45309;font-weight:600;cursor:pointer;font-size:11px;';
    const refCaret = document.createElement('button');
    refCaret.id = 'plMsgRefCaret'; refCaret.textContent = '▾';
    refCaret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #fde3a7;background:#fffbeb;color:#b45309;cursor:pointer;font-size:11px;';
    const refMenu = document.createElement('div');
    refMenu.className = 'plNotifMenu';
    refMenu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:60;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optClear = mkOpt('🧹 清空消息');
    refMenu.appendChild(optClear);
    refWrap.append(inb, refCaret, refMenu);
    inb.addEventListener('click', () => syncChatInbound(container));
    refCaret.addEventListener('click', () => { refMenu.style.display = refMenu.style.display === 'block' ? 'none' : 'block'; });
    optClear.addEventListener('click', async () => { refMenu.style.display = 'none'; await clearMsgBucketOnly(container); });
    if (!window.__plMsgOuterBound) {
      window.__plMsgOuterBound = true;
      document.addEventListener('click', (e) => {
        document.querySelectorAll('.plNotifMenu').forEach(m => {
          const g = m.closest('.plNotifGroup');
          if (m.style.display === 'block' && !(g && g.contains(e.target))) m.style.display = 'none';
        });
      });
    }
    grp.append(genWrap, refWrap);
    batch.appendChild(grp);
  } else if (_plStage === 'all') {
    // 全视桶：刷新通知 + 刷新消息 两个按钮（通知桶的刷新已并入下方「更多」下拉）
    const nb = document.createElement('button');
    nb.textContent = '🔄 刷新通知';
    nb.id = 'plSyncNotif';
    nb.style.cssText = 'font-size:11px;padding:5px 12px;border:1px solid #0e7490;background:#ecfeff;color:#0e7490;border-radius:8px;cursor:pointer;font-weight:600;';
    nb.addEventListener('click', async () => { await _refreshCurrentTab(container); });
    batch.appendChild(nb);
    const inb = document.createElement('button');
    inb.textContent = '🔄 刷新消息';
    inb.id = 'plSyncInbound';
    inb.style.cssText = 'font-size:11px;padding:5px 12px;border:1px solid #f59e0b;background:#fffbeb;color:#b45309;border-radius:8px;cursor:pointer;font-weight:600;';
    inb.addEventListener('click', () => syncChatInbound(container));
    batch.appendChild(inb);
    batch.appendChild(buildBucketClearSelect(container));
  }
  // ★ 通知工具条：✨生成AI话术▾ / 🔄刷新通知▾（批量改状态已移到下方筛选行最前）
  let bsOpts = '';
  if (!_plShowDiscarded && _plStage === 'notif') {
    const bsList = (() => { const l = PL_STATUS_ALL.slice(); if (!l.includes('已触达')) l.unshift('已触达'); if (!l.includes('已废弃')) l.push('已废弃'); return l; })();
    bsOpts = `<option value="">批量改状态(${_selectedIds.size})…</option>` + bsList.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    const grp = document.createElement('span');
    grp.style.cssText = 'display:inline-flex;gap:6px;align-items:center;';
    const mkOpt = (html, style) => { const o = document.createElement('div'); o.innerHTML = html; o.style.cssText = style || 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#1a1a1a;'; o.addEventListener('mouseenter', () => { o.style.background = '#f3f0ff'; }); o.addEventListener('mouseleave', () => { o.style.background = ''; }); return o; };
    // [✨ 生成AI话术 ▾]（下拉 = 自动触达）
    const genWrap = document.createElement('span');
    genWrap.className = 'plNotifGroup';
    genWrap.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #ef4444;border-radius:8px;';
    const genBtn = document.createElement('button');
    genBtn.id = 'plGenDraftBtn'; genBtn.textContent = '✨ 生成AI话术';
    genBtn.style.cssText = 'padding:5px 12px;border:none;border-radius:8px 0 0 8px;background:#fef2f2;color:#dc2626;font-weight:600;cursor:pointer;font-size:11px;';
    genBtn.title = '为通知里的线索生成AI触达话术（红色=联系TA同款，点左侧主区批量生成）';
    const genCaret = document.createElement('button');
    genCaret.id = 'plGenCaret'; genCaret.textContent = '▾';
    genCaret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #fca5a5;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:11px;';
    const genMenu = document.createElement('div');
    genMenu.className = 'plNotifMenu';
    genMenu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:61;min-width:180px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optTouch = mkOpt('⚡ 自动触达', 'padding:8px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:#dc2626;font-weight:600;');
    genMenu.appendChild(optTouch);
    genWrap.append(genBtn, genCaret, genMenu);
    genBtn.addEventListener('click', () => { genMissingDrafts(container, false); });
    genCaret.addEventListener('click', () => { genMenu.style.display = genMenu.style.display === 'block' ? 'none' : 'block'; });
    optTouch.addEventListener('click', async () => { genMenu.style.display = 'none'; await genMissingDrafts(container, false); if (typeof batchTouchAuto === 'function') batchTouchAuto(container); });
    // [🔄 刷新通知 ▾]（下拉只剩 清空列表）
    const group = document.createElement('div');
    group.className = 'plNotifGroup';
    group.style.cssText = 'position:relative;display:inline-flex;align-items:stretch;border:1px solid #0e7490;border-radius:8px;';
    const rf = document.createElement('button'); rf.id = 'plNotifRefresh'; rf.textContent = '🔄 刷新通知'; rf.style.cssText = 'padding:5px 12px;border:none;background:#ecfeff;color:#0e7490;font-weight:600;cursor:pointer;font-size:11px;';
    const caret = document.createElement('button'); caret.id = 'plNotifMore'; caret.textContent = '▾'; caret.style.cssText = 'padding:5px 9px;border:none;border-left:1px solid #bae6fd;background:#ecfeff;color:#0e7490;cursor:pointer;font-size:11px;';
    const menu = document.createElement('div'); menu.id = 'plNotifMenu'; menu.className = 'plNotifMenu'; menu.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);right:0;z-index:60;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:4px;';
    const optClear = mkOpt('🧹 清空列表');
    menu.appendChild(optClear);
    group.appendChild(rf); group.appendChild(caret); group.appendChild(menu);
    const closeMenu = () => { menu.style.display = 'none'; };
    rf.addEventListener('click', () => _refreshCurrentTab(container));
    caret.addEventListener('click', () => { menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; });
    optClear.addEventListener('click', async () => { closeMenu(); await clearAllProspects(container); });
    if (!window.__plNotifOuterBound) {
      window.__plNotifOuterBound = true;
      document.addEventListener('click', (e) => {
        document.querySelectorAll('.plNotifMenu').forEach(m => {
          const g = m.closest('.plNotifGroup');
          if (m.style.display === 'block' && !(g && g.contains(e.target))) m.style.display = 'none';
        });
      });
    }
    grp.append(genWrap, group);
    batch.appendChild(grp);
  }
  // 消息视图：批量改状态下拉（消息桶无「待触达」，状态列表对应过滤）
  if (_plStage === 'msg' && !_plShowDiscarded) {
    const bsList = PL_STATUS_ALL.filter(s => s !== '待触达');
    bsOpts = `<option value="">批量改状态(${_selectedIds.size})…</option>` + bsList.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }
  if (!_plShowDiscarded && batch.childNodes.length) container.appendChild(batch);

  // 筛选行：左=批量改状态 + 状态(chips) ｜ 右=昵称搜索
  const filter = document.createElement('div');
  filter.className = 'pl-filter';
  filter.innerHTML = `
    ${(_plStage !== 'all' && !_plShowDiscarded) ? `<select id="plBatchStatus" style="font-size:11px;padding:3px 8px;border:1px solid #c4b5fd;border-radius:6px;color:#6d28d9;background:#faf5ff;">${bsOpts}</select>` : ''}
    <span style="font-size:11px;color:#888;white-space:nowrap;">状态</span>
    <span id="plTouchChips" style="display:inline-flex;gap:4px;flex-wrap:wrap;"></span>
    <span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <input id="plSearch" placeholder="🔍 搜索昵称" style="width:92px;min-width:0;" value="${esc(_plFilter.keyword)}">
    </span>`;
  container.appendChild(filter);
  // ★ 状态多选 ＝ 点选 chips（唯一的状态筛选项；选"已废弃"即进已废弃视图）
  //   消息桶必然已联系 → 不提供「待触达」筛项
  const _STATUS_OPTS = (_plStage === 'msg') ? PL_STATUS_ALL.filter(s => s !== '待触达') : PL_STATUS_ALL.slice();
  const _touchSet = new Set(Array.isArray(_plFilter2.touch) ? _plFilter2.touch : []);
  const chipsBox = filter.querySelector('#plTouchChips');
  const paintChips = () => {
    chipsBox.innerHTML = _STATUS_OPTS.map((s) => {
      const on = _touchSet.has(s);
      return `<span class="plat-chip" data-s="${s}" style="cursor:pointer;font-size:11px;border:1px solid ${on ? '#7c3aed' : '#d5c8f5'};background:${on ? '#f3f0ff' : '#fff'};color:${on ? '#7c3aed' : '#6d28d9'};border-radius:12px;padding:2px 9px;">${s}</span>`;
    }).join('');
  };
  paintChips();
  chipsBox.querySelectorAll('.plat-chip').forEach((c) => c.addEventListener('click', () => {
    const s = c.dataset.s;
    if (_touchSet.has(s)) _touchSet.delete(s); else _touchSet.add(s);
    _plFilter2.touch = Array.from(_touchSet);
    paintChips();
    applyFilterHelper();
  }));
  // ★ 批量改状态：下拉选即生效（对勾选的人）
  container.querySelector('#plBatchStatus')?.addEventListener('change', async (e) => {
    const status = e.target.value; e.target.value = '';
    const ids = Array.from(_selectedIds);
    if (!ids.length) { addLog('⚠️ 未勾选任何客户', 'warn'); return; }
    if (!status) { addLog('⚠️ 未选择要改成哪个状态', 'warn'); return; }
    if (!window.confirm(`确认将 ${ids.length} 个客户的状态改为「${status}」？`)) return;
    let n = 0; const totalIds = [];
    const _plById = (i) => _plData.list.find(p => p && p.id === i);
    for (const id of ids) {
      const pg = _plById(id);
      const sibs = pg ? [id, ..._samePersonIds(pg)] : [id];
      for (const sid of sibs) { if (!totalIds.includes(sid)) totalIds.push(sid); }
    }
    for (const sid of totalIds) {
      try { await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: sid, updates: { status } } }); n++; } catch (_) {}
    }
    _selectedIds.clear();
    addLog(`✅ 已批量改状态为「${status}」：${n}/${totalIds.length}` + (totalIds.length > ids.length ? '（含同人他渠道记录）' : ''), 'success');
    loadProspectList(container);
  });
  const applyFilter = () => {
    _plFilter.keyword = filter.querySelector('#plSearch').value.trim();
    applyFilterHelper();
  };
  const applyFilterHelper = () => { _plPage = 0; loadProspectList(container); };
  filter.querySelector('#plSearch').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });

  

  // 空态
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'pl-empty';
    if (_plStage === 'msg') {
      empty.innerHTML = '📨 消息桶暂无记录。<br>点上方「🔄 刷新消息」直接从 /chat 消息中心拉取你与客户的对话。';
      container.appendChild(empty);
      return;
    }
    empty.innerHTML = '🎯 清单为空。<br>在「获客助手」扫描笔记时，点击商机卡片的「➕ 入清单」，或用关键词收录命中评论。';
    container.appendChild(empty);
    return;
  }

  // 分页
  const pageCount = Math.max(1, Math.ceil(total / PL_PAGE_SIZE));
  _plPage = Math.min(_plPage, pageCount - 1);
  const pageList = list.slice(_plPage * PL_PAGE_SIZE, (_plPage + 1) * PL_PAGE_SIZE);

  // 表头 + tbody
  const table = document.createElement('table');
  table.className = 'pl-table';
  const isMsgView = _plStage === 'msg';
  const isNotifView = _plStage === 'notif';
  table.innerHTML = isMsgView
    ? `<thead><tr>
      <th class="pl-col-sel"><input type="checkbox" id="plHeaderSelectAll" class="pl-sel-all" title="全选本页" style="accent-color:#7c3aed;"></th>
      <th class="pl-col-user">用户</th>
      <th class="pl-col-who">收发</th>
      <th class="pl-col-msg">最近消息</th>
      <th class="pl-col-time">时间</th>
      <th class="pl-col-act">操作</th>
      <th class="pl-col-x"></th>
    </tr></thead>`
    : isNotifView
    ? `<thead><tr>
      <th class="pl-col-sel"><input type="checkbox" id="plHeaderSelectAll" class="pl-sel-all" title="全选本页" style="accent-color:#7c3aed;"></th>
      <th class="pl-col-user">用户</th>
      <th class="pl-col-src2">来源</th>
      <th class="pl-col-msg">最近内容</th>
      <th class="pl-col-time">时间</th>
      <th class="pl-col-act">操作</th>
      <th class="pl-col-x"></th>
    </tr></thead>`
    : `<thead><tr>
      <th class="pl-col-sel"><input type="checkbox" id="plHeaderSelectAll" class="pl-sel-all" title="全选本页" style="accent-color:#7c3aed;"></th>
      <th class="pl-col-user">用户</th>
      <th class="pl-col-src">来源</th>
      <th class="pl-col-state">状态</th>
      <th class="pl-col-msg">最近 / 来源内容</th>
      <th class="pl-col-act">操作</th>
      <th class="pl-col-x"></th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);

  // 行
  pageList.forEach(p => {
    const s = _plGetStage(p);
    const pf = p.profile || {};
    const tagsHtml = (Array.isArray(pf.tags) && pf.tags.length ? pf.tags.map(esc).join(' · ') : '');
    const idHtml = p.userId ? `ID:${esc(p.userId)}` : '';
    const nickMeta = [tagsHtml && ('标签:' + tagsHtml), idHtml, p.keywordHit].filter(Boolean).join(' · ');
    // ★ 私信受限标记（对方隐私设置/未关注，暂时无法私信）
    const blockedHtml = p.dmBlocked
      ? `<div class="pl-id-blocked">⛔ 私信受限：对方隐私设置或未关注，暂无法私信 — 可在评论区破冰，或关注后待通过再试。${esc(p.dmBlockedAt ? new Date(p.dmBlockedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</div>`
      : '';
    const isBlocked = !!p.dmBlocked;
    const srcComment = ((p.source && p.source.comment) || '').slice(0, 80);
    const srcNote = ((p.source && p.source.noteTitle) || '').slice(0, 40);
    // 评论跟进的历史对话（我们自己回复过+对方的发言），供查看"之前跟他说过啥"
    const chatHistory = (Array.isArray(p.chatHistory) && p.chatHistory.length) ? p.chatHistory : null;
    const chatHistoryHtml = chatHistory
      ? `<details class="pl-chat">
          <summary>💬 历史对话（${chatHistory.length} 条）▸</summary>
          <div class="pl-chat-body">${chatHistory.map(function (h) {
            const who = h.role === 'assistant' ? '<b style="color:#059669;">我</b>' : '<b style="color:#2563eb;">对方</b>';
            return `<div class="pl-chat-line">${who}：${esc(String(h.content || '').slice(0, 120))}</div>`;
          }).join('')}</div>
        </details>`
      : '';

    // 层内"状态/下一步"下拉（v2：所有行都显示漏斗状态，方便给手动回应过的人打标；已废弃也是状态之一）
    let statusSel = '';
    // 消息桶记录必然已联系（最低已触达）→ 状态下拉不提供「待触达」
    const stList = (isMsgView ? PL_STATUS_ALL.filter(s => s !== '待触达') : PL_STATUS_ALL.slice());
    let _curStatus = _personStatus(p);
    if (!stList.includes(_curStatus)) _curStatus = '待触达';
    // ★ 有消息往来的人在简介中不应显示为"未接触/待触达"
    if ((_curStatus === '待触达' || _curStatus === '' || _curStatus === '未接触') && _hasMsgSibling(p)) _curStatus = '已触达';
    statusSel = `<select class="pl-status" data-plid="${p.id}" data-kind="status" title="漏斗状态：手动回应对应的人可改成 谈单中/已成交/已废弃 等">${stList.map(st => `<option value="${esc(st)}" ${st === _curStatus ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select>`;
    // 产品相关"只读"徽章（🟢相关/⚪无关；想看判定或手动改 → 打开画像弹窗把"意图"设成 高/中/低）
    // 单条动作：一律「联系TA」＝打开私信弹窗自己写（去卖/触达合并，不再区分）
    let actions = `<button class="act send" data-plid="${p.id}" data-action="dm" title="联系TA：打开私信自己写话术，可用「优化话术」">💬 联系TA</button>`;
    // 底部动作（普通视图：状态/联系TA + 主页；已废弃视图：恢复 + 彻底删）
    let foot;
    if (_plShowDiscarded) {
      foot = `<span style="font-size:11px;color:#888;">已废弃 · 想恢复请在状态下拉自己改</span>` +
             `<button class="act send" data-plid="${p.id}" data-action="purge" title="彻底删除（不可恢复）" style="border:1px solid #dc2626;background:#fee2e2;color:#b91c1c;">🗑 彻底删</button>`;
    } else {
      foot = `${statusSel}${actions}` +
             `<button class="pl-home" data-plid="${p.id}" data-action="locate" title="打开该用户主页">📎</button>`;
    }

    // 最近/来源内容（表格中间列）：消息桶→"最后一句话谁·说了什么·何时"；通知→评论/来源笔记
    const _lastWho = (p.lastFrom === 'them' || p.inbound || p.themReplied || p.direction === 'inbound') ? '对方' : ((p.lastFrom === 'me' || p.direction === 'outbound') ? '我方' : '');
    const _lastTime = (() => {
      const t = (p.lastConvFp && p.lastConvFp.at) || p.lastDmAt || p.updatedAt;
      if (t === undefined || t === null || t === '') return '';
      try {
        const d = new Date(t);
        if (!isNaN(+d)) { const now = new Date(); if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); return (d.getMonth() + 1) + '-' + d.getDate(); }
      } catch (_) {}
      // 拿不到时间戳 → 回显原始时间串（如 08-17）
      return (p.lastConvFp && p.lastConvFp.at) ? String(p.lastConvFp.at) : '';
    })();
    const _lastTxt = String(p.lastMsg || '').slice(0, 40);
    // 收发列：我方(绿)/对方(蓝)
    const whoHtml = _lastWho ? `<span style="font-weight:600;color:${_lastWho === '我方' ? '#059669' : '#2563eb'};">${_lastWho}</span>` : '';
    // 时间列：正规 yyyy-MM-dd HH:mm
    const timeVal = fmtDateTime((p.lastConvFp && p.lastConvFp.at) || p.lastDmAt || p.updatedAt);
    const draftHtml = p.dmDraft ? `<span title="${esc(p.dmDraft)}" style="display:block;color:#7c3aed;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">💬话术：${esc((p.dmDraft || '').slice(0, 40))}${(p.dmDraft || '').length > 40 ? '…' : ''}</span>` : '';
    // 消息视图：最近消息列只放文本（收发/时间已拆到各自列）
    const msgTextCell = `<span title="${esc(p.lastMsg || '')}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📨 ${esc(_lastTxt || '对方私信了你，尽快回复')}</span>${draftHtml}`;
    // 非消息视图：最近/来源内容列（评论 / 笔记标题 + 话术）
    const msgCell = (srcComment
      ? `<span title="${esc(srcComment)}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📝 ${esc(srcComment)}</span>`
      : (srcNote
        ? `<span title="${esc(srcNote)}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📕 ${esc(srcNote)}</span>`
        : '<span style="color:#c0c4cc;">—</span>')) + draftHtml;
    const userCell = `<span class="pl-nick">${esc(p.nickname || '未知用户')}${p.unread ? ' <b style="color:#dc2626;">●</b>' : ''}</span>${isBlocked ? '<span class="pl-badge" style="background:#fef2f2;color:#b91c1c;">⛔受限</span>' : ''}${(p.nTimeStr ? `<span style="font-size:10px;color:#9ca3af;margin-left:2px;">🕐${esc(p.nTimeStr)}</span>` : '')}${nickMeta ? `<div class="pl-nickmeta">${nickMeta}</div>` : ''}`;
    const selCell = `<input type="checkbox" class="pl-sel" data-plid="${p.id}" ${_selectedIds.has(p.id) ? 'checked' : ''} title="勾选后可在列表底部批量删除">`;

    const tr = document.createElement('tr');
    tr.className = 'pl-row';
    tr.dataset.plid = p.id;
    if (isMsgView) {
      tr.innerHTML = `
      <td class="pl-col-sel">${selCell}</td>
      <td class="pl-col-user">${userCell}</td>
      <td class="pl-col-who">${whoHtml}</td>
      <td class="pl-col-msg">${msgTextCell}</td>
      <td class="pl-col-time">${timeVal}</td>
      <td class="pl-col-act"><div class="pl-foot">${foot}</div></td>
      <td class="pl-col-x"><button class="pl-toggle" data-plid="${p.id}" title="展开详情">▸</button></td>`;
    } else if (isNotifView) {
      const nContent = _notifContent(p) + draftHtml;
      tr.innerHTML = `
      <td class="pl-col-sel">${selCell}</td>
      <td class="pl-col-user">${userCell}</td>
      <td class="pl-col-src2">${_channelsBadge(p)}</td>
      <td class="pl-col-msg">${nContent}</td>
      <td class="pl-col-time">${_channelTimeVal(p)}</td>
      <td class="pl-col-act"><div class="pl-foot">${foot}</div></td>
      <td class="pl-col-x"><button class="pl-toggle" data-plid="${p.id}" title="展开详情">▸</button></td>`;
    } else {
      tr.innerHTML = `
      <td class="pl-col-sel">${selCell}</td>
      <td class="pl-col-user">${userCell}</td>
      <td class="pl-col-src">${_plEntryBadge(p)}</td>
      <td class="pl-col-state"><span class="pl-badge" style="background:#eef2ff;color:${_plStatusColor(_curStatus)};">${esc(_curStatus)}</span></td>
      <td class="pl-col-msg">${msgCell}</td>
      <td class="pl-col-act"><div class="pl-foot">${foot}</div></td>
      <td class="pl-col-x"><button class="pl-toggle" data-plid="${p.id}" title="展开详情">▸</button></td>`;
    }
    tbody.appendChild(tr);

    // 详情行（默认收起；包含画像/历史对话/回复建议）
    const detail = document.createElement('tr');
    detail.className = 'pl-detail pl-row-detail';
    detail.dataset.plid = p.id;
    detail.style.display = 'none';
    detail.innerHTML = `<td colspan="7" style="padding:8px 12px;">
      ${blockedHtml}
      <div class="pl-hint">${_plNextHint(p)}</div>
      ${p.dmDraft ? `<div class="pl-source" style="color:#7c3aed;">💬 触达话术：${esc(p.dmDraft)}</div>` : ''}
      ${srcComment ? `<div class="pl-source">📝 评论：${esc(srcComment)}</div>` : ''}
      ${srcNote ? `<div class="pl-source">📕 来源：${esc(srcNote)}</div>` : ''}
      ${chatHistoryHtml}
      ${(s === 'prospect' && pf.intentLevel) ? `<textarea class="pl-reply-text" data-plid="${p.id}" placeholder="回复建议（自动生成，可修改）..." style="width:100%;min-width:560px;">${esc((p.replySuggest || '').trim())}</textarea>` : ''}
    </td>`;
    tbody.appendChild(detail);
  });
  // ★ 自动生成回复（默认给每个未生成过的卡片填充，串行避免并发打爆）
  {
    const needGen = [];
    container.querySelectorAll('.pl-reply-text').forEach(ta => {
      const person = list.find(p => p.id === ta.dataset.plid);
      if (person && person.stage === 'prospect' && person.profile && !(person.replySuggest || '').trim()) needGen.push(ta.dataset.plid);
    });
    if (needGen.length) {
      let chain = Promise.resolve();
      let done = 0;
      needGen.forEach(id => {
        chain = chain.then(async () => {
          const ta = container.querySelector(`.pl-reply-text[data-plid="${id}"]`);
          const person = list.find(p => p.id === id);
          if (!ta || !person || (person.replySuggest || '').trim()) return;
          try {
            const text = await generateDmText(person);
            if (ta) ta.value = text;
            person.replySuggest = text;
            try { await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { replySuggest: text } } }); } catch (_) {}
            done++;
            if (done === 1 || done % 10 === 0) addLog(`🤖 已自动生成 ${done}/${needGen.length} 条回复建议`, 'info');
          } catch (_) {}
        });
      });
    }
  }

  // ── 层内"状态/下一步"下拉（写入 v2 子状态；写 closed 自动升客户池）──
  container.querySelectorAll('.pl-status').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.plid;
      const v = sel.value || '';
      const kind = sel.dataset.kind || 'status'; // status
      const person = list.find(p => p.id === id);
      if (!person) return;
      try {
        const updates = { status: v };
        const ids = [id, ..._samePersonIds(person)]; // 同人其余渠道/跨桶记录一并同步
        for (const sid of ids) {
          await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: sid, updates } }).catch(() => {});
        }
        addLog(`✅ ${person.nickname} 商机状态 → ${v}` + (ids.length > 1 ? `（已同步 ${ids.length} 条渠道记录）` : ''), 'success');
        loadProspectList(container);
      } catch (e) {
        addLog(`❌ 更新状态失败：${e.message}`, 'error');
      }
    });
  });
  // ── 层内动作 + 底部动作（主页/移除） ──
  container.querySelectorAll('.pl-foot button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.plid;
      const action = btn.dataset.action;
      const person = list.find(p => p.id === id);
      if (!person) return;
      if (action === 'locate') {
        btn.disabled = true; const _o = btn.textContent; btn.textContent = '⏳...';
        addLog(`📎 打开主页：${person.nickname}`, 'info');
        try {
          const r = await chrome.runtime.sendMessage({ action: 'enrichProspectByProfile', data: { person } });
          if (r && r.ok && r.xhsId) addLog(`✅ 已打开并抓取 ${r.name || person.nickname} · 小红书号:${r.xhsId}`, 'success');
          else if (r && r.ok) addLog(`✅ 已打开用户主页：${person.nickname}`, 'success');
          else addLog(`⚠️ ${(r && r.error) || '未完成'}`, 'warn');
          loadProspectList(container);
        } catch (e) { addLog(`❌ 打开主页失败：${e.message}`, 'error'); }
        btn.disabled = false; btn.textContent = _o; return;
      }
      else if (action === 'restore') {
        try {
          // 恢复 = 把「已废弃」状态改回「待触达」（废弃已并入状态体系）
          await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { status: '待触达', discarded: false } } });
          addLog(`↩️ 已恢复：${person.nickname}`, 'success');
        } catch (e) { addLog(`❌ 恢复失败：${e.message}`, 'error'); }
        loadProspectList(container); return;
      }
      else if (action === 'purge') {
        if (!window.confirm(`⚠️ 确认彻底删除 ${person.nickname}？该记录不可恢复！`)) return;
        await chrome.runtime.sendMessage({ action: 'deleteProspect', data: { id, hard: true } });
        addLog(`🗑️ 已彻底删除：${person.nickname}`, 'info');
        loadProspectList(container); return;
      }
      else if (action === 'remove') {
        if (!window.confirm(`确认将 ${person.nickname} 标废（移出清单，可在「🗑 已废弃」恢复）？`)) return;
        await chrome.runtime.sendMessage({ action: 'deleteProspect', data: { id } });
        addLog(`🗑️ 已标废：${person.nickname}`, 'info');
        loadProspectList(container); return;
      }
      else if (action === 'reply') {
        // 有会话 / 或领一个会话：先"逐条归因"该客户是否回过你 → 是则升商机(已回复)，否则标已触达·待回复；都在 /chat 里打开
        const convId = person.convId || '';
        const btnO = btn.textContent; btn.disabled = true; btn.textContent = '⏳ 判定…';
        if (convId) {
          try {
            const r = await chrome.runtime.sendMessage({ action: 'scanChatReply', data: { convId, personId: person.id, nickname: person.nickname } });
            if (r && r.ok) {
              if (r.promoted) addLog(`🎯 ${person.nickname}：对方回过你 → 已升级为商机（已回复）`, 'success');
              else addLog(r.theirs ? `💬 ${person.nickname}：对方回过你（商机池）` : `💬 ${person.nickname}：暂无对方回复，标「已触达·待回复」`, r.theirs ? 'success' : 'warn');
            } else addLog(`❌ 判定失败：${(r && r.error) || '未知'}`, 'error');
          } catch (e) { addLog('❌ 判定失败：' + e.message, 'error'); }
        } else {
          addLog('⚠️ 暂无会话，改为私信触达', 'warn');
          openDmModal(person);
          touchScenePrefill(person);
        }
        btn.disabled = false; btn.textContent = btnO;
        loadProspectList(container); return;
      }
      else if (action === 'profile') { runProfileOne([person], container); return; }
      else if (action === 'dm') {
        // 联系TA = 打开私信弹窗，直接自己写话术发；打开即自动填入已生成的 AI 话术（无则自动生成）
        //   同时把该人所有渠道记录的"待触达"置为"已触达"（状态跨渠道同步）
        openDmModal(person);
        if (!person.status || person.status === '待触达') {
          const ids = [id, ..._samePersonIds(person)];
          await Promise.all(ids.map(sid => chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: sid, updates: { status: '已触达' } } }).catch(() => {})));
          if (container) loadProspectList(container);
        }
        return;
      }
      else if (action === 'maint') {
        // 成交维护话术：按 after_sale 场景生成 → 开私信弹窗填入
        btn.disabled = true; const _o2 = btn.textContent; btn.textContent = '⏳…';
        try {
          const r = await chrome.runtime.sendMessage({ action: 'aiCsTouch', data: { key: 'after_sale', person } });
          openDmModal(person);
          const dt = document.getElementById('dmText'); if (dt) dt.value = (r && r.ok && r.draft) || '';
          if (r && r.ok) addLog(`📣 已按「成交维护」生成 ${person.nickname} 的话术`, 'success');
        } catch (e) { addLog('❌ 维护话术生成失败：' + e.message, 'error'); }
        btn.disabled = false; btn.textContent = _o2;
        return;
      }
      else if (action === 'close') {
        // 成交在商机状态上作标注（不单独建客户层）
        await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { status: '已成交', funnel: Object.assign({}, _plFunnel(person), { step: 'closed' }) } } });
        addLog(`💰 ${person.nickname} 已成交标注（成交一般走线下/微信）`, 'success');
        loadProspectList(container); return;
      }
      else if (action === 'promote') {
        // AI 判断：适合的线索 → 标「高意向·待跟单」置顶（不升商机；商机=对方真回复，见 _isTwoWay）
        const _o = btn.textContent; btn.disabled = true; btn.textContent = '🧠 判断中…';
        try {
          const r = await chrome.runtime.sendMessage({ action: 'judgeLeadPromotion', data: { id } });
          if (r && r.ok) {
            if (r.promote) {
              await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { intentLevel: 'high', affinity: Object.assign({}, person.affinity || {}, { intentLevel: 'high' }) } } });
              addLog(`🧠 AI 判断高意向 → 已将 ${person.nickname} 置顶为「高意向·待跟单」（${r.reason || ''}）`, 'success');
            } else {
              addLog(`⏸ AI 判断暂不适合跟进：${r.reason || '需求不强'}（留在线索池，可稍后再判）`, 'warn');
            }
          } else {
            throw new Error((r && r.error) || 'AI 判断失败');
          }
        } catch (e) {
          addLog('❌ 升格判断失败：' + e.message, 'error');
        }
        btn.disabled = false; btn.textContent = _o;
        loadProspectList(container); return;
      }
    });
  });
  // ── 多选：勾选待删除；表头复选框=全选本页 ──
  const _syncHeaderSel = () => {
    const hdr = container.querySelector('#plHeaderSelectAll');
    const cbs = container.querySelectorAll('.pl-sel');
    let on = 0; cbs.forEach(cb => { if (cb.checked) on++; });
    if (hdr) { hdr.checked = cbs.length > 0 && on === cbs.length; hdr.indeterminate = on > 0 && on < cbs.length; }
  };
  const _selCountUI = () => {
    const d = document.getElementById('plBatchStatus');
    if (d && d.options.length) d.options[0].text = '批量改状态(' + _selectedIds.size + ')…';
    _syncHeaderSel();
  };
  const hdrSel = container.querySelector('#plHeaderSelectAll');
  if (hdrSel) hdrSel.addEventListener('change', () => {
    const on = hdrSel.checked;
    container.querySelectorAll('.pl-sel').forEach(cb => { cb.checked = on; });
    _selectedIds.clear();
    if (on) container.querySelectorAll('.pl-sel').forEach(cb => { if (cb.dataset.plid) _selectedIds.add(cb.dataset.plid); });
    _selCountUI();
  });
  container.querySelectorAll('.pl-sel').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.plid;
      if (cb.checked) _selectedIds.add(id); else _selectedIds.delete(id);
      _selCountUI();
    });
  });
  _syncHeaderSel();
  // ── 表格行：展开/收起详情 ──
  const _toggleDetail = (plid) => {
    const d = container.querySelector(`.pl-detail[data-plid="${plid}"]`);
    const t = container.querySelector(`.pl-toggle[data-plid="${plid}"]`);
    if (!d) return;
    const show = d.style.display === 'none';
    d.style.display = show ? '' : 'none';
    if (t) t.textContent = show ? '▾' : '▸';
  };
  container.querySelectorAll('.pl-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); _toggleDetail(btn.dataset.plid); });
  });
  container.querySelectorAll('tr.pl-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button,select,input')) return;
      _toggleDetail(tr.dataset.plid);
    });
  });

  // ── 复制回复 ──
  container.querySelectorAll('.copy-inline').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.plid;
      const ta = container.querySelector(`.pl-reply-text[data-plid="${id}"]`);
      if (!ta || !ta.value) return;
      try {
        await navigator.clipboard.writeText(ta.value);
        btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1200);
      } catch (_) { ta.select(); document.execCommand('copy'); btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1200); }
    });
  });
  // 分页控制
  const pageNav = document.createElement('div');
  pageNav.className = 'pl-page';
  pageNav.innerHTML = `
    <button id="plPrev" ${_plPage === 0 ? 'disabled' : ''}>‹ 上一页</button>
    <span>第 ${_plPage + 1} / ${pageCount} 页 · 共 ${total} 人</span>
    <button id="plNext" ${_plPage >= pageCount - 1 ? 'disabled' : ''}>下一页 ›</button>`;
  container.appendChild(pageNav);
  pageNav.querySelector('#plPrev').addEventListener('click', () => { _plPage--; renderProspectList(container); });
  pageNav.querySelector('#plNext').addEventListener('click', () => { _plPage++; renderProspectList(container); });

  // ── 消息桶：⚪ 我方触达 折叠分组（默认收起，点开查看/去卖） ──
  if (_plStage === 'msg' && outList.length) {
    const sec = document.createElement('div');
    sec.className = 'pl-batch';
    const h = document.createElement('button');
    h.textContent = (_outboundCollapsed ? '▸' : '▾') + ' 我方触达（' + outList.length + '，默认收起的运营会话）';
    h.style.cssText = 'width:100%;text-align:left;font-size:12px;padding:6px 8px;border:1px solid var(--line);background:#f9fafb;color:#6b7280;border-radius:8px;cursor:pointer;font-weight:600;';
    h.addEventListener('click', () => { _outboundCollapsed = !_outboundCollapsed; renderProspectList(container); });
    sec.appendChild(h);
    if (!_outboundCollapsed) {
      outList.slice(0, 60).forEach(p => {
        const row = document.createElement('div');
        row.className = 'pl-card';
        const _s = _plStateOf(p, 'msg'); const _m = PL_STATE_META[_s] || PL_STATE_META.other;
        row.innerHTML =
          `<div class="pl-card-top"><span class="pl-nick">⚪ ${esc(p.nickname || '未知')}</span><span class="pl-badge" style="background:${_m.bg};color:${_m.c};">${_m.t}</span></div>` +
          `<div class="pl-source">📨 ${esc((p.lastMsg || '').slice(0, 60))}</div>` +
          `<div class="pl-foot"><button class="act send" data-plid="${p.id}" title="打开 /chat 会话开始卖">💬 去卖</button></div>`;
        const btn = row.querySelector('[data-plid]');
        btn.addEventListener('click', () => {
          const cid = p.convId || '';
          if (!cid) { addLog('⚠️ 无会话，请先从通知桶触达', 'warn'); return; }
          addLog(`💬 打开 ${p.nickname || '对方'} 的会话（去卖）`, 'info');
          chrome.runtime.sendMessage({ action: 'openChat', data: { convId: cid, personId: p.id } }).then(r => {
            if (r && r.ok) addLog('✅ 已打开会话', 'success'); else addLog('❌ 打开失败：' + ((r && r.error) || '未知'), 'error');
          }).catch(e => addLog('❌ 打开会话失败：' + e.message, 'error'));
        });
        container.appendChild(row);
      });
    }
    container.appendChild(sec);
  }

  }

// ═══════════ 消息台：/chat 会话一览（销售主战场：和客户聊+成交） ═══════════
const _stageLabel = (s) => s === 'prospect' ? '🎯商机' : (s === 'lead' ? '🎇线索' : '');

// 刷新通知：只刷小红书通知（评论/@）数据，不再顺带刷消息 / 不跳页
async function _refreshCurrentTab(container) {
  const ok = await syncNotifToLeads(container);   // 只刷通知数据（含冷却：太频繁会跳过）
  if (!ok) return;
  await genMissingDrafts(container, false);       // 补生成没话术的
  if (container) loadProspectList(container);
}
async function syncNotifToLeads(container, opts) {
  const b = document.getElementById('plNotifRefresh') || document.getElementById('plSyncNotif');
  const bReset = document.getElementById('plNotifRefresh') ? '🔄 刷新通知' : '🔄 增量刷新通知';
  if (window.__lastNotifSyncAt && (Date.now() - window.__lastNotifSyncAt < 20000)) {
    const sec = Math.ceil((20000 - (Date.now() - window.__lastNotifSyncAt)) / 1000);
    addLog(`⏳ 刷新太频繁，请等 ${sec}s 再试`, 'warn');
    return false;
  }
  window.__lastNotifSyncAt = Date.now();
  if (_syncInFlight) return false;
  _syncInFlight = true;
  if (b) { b.disabled = true; b.textContent = '⏳ 刷新中…'; }
  // AI 打"是否产品相关"标记：配置了 AI 就走标记（不剔除任何人）；未配 AI 则仅全量收录
  const screen = true;
  addLog('🔄 增量刷新通知（前3屏）...', 'info');
  try {
    const r = await chrome.runtime.sendMessage({ action: 'collectLikersFromNotif', data: { screen, cap: NOTIF_SYNC_CAP } });
    if (r && r.ok) {
      const it = r.intents || {};
      const extra = [];
      if (it.high) extra.push('高' + it.high);
      if (it.medium) extra.push('中' + it.medium);
      if (it.low) extra.push('低' + it.low);
      const intendText = (screen && extra.length) ? '　意向：' + extra.join('/') : '';
      const capText = r.capped ? `　（另有 ${r.capped} 条超出上限，下轮再处理）` : '';
      const tabs = r.tabCounts || {};
      const tabText = (Object.keys(tabs).length) ? '　分工：' + ['评论和@', '新增关注', '赞和收藏'].filter(t => tabs[t] !== undefined).map(t => `${t}:${tabs[t]}`).join(' / ') : '';
      const aiTxt = screen
        ? ((r.aiError) ? ` ⚠️AI失败(${r.aiError})` : (r.screened ? ` · AI已标记 ${r.screened}（相关${it.high || 0}/中${it.medium || 0}/无关${it.low || 0}）` : ' · 未配AI或无需标记'))
        : '';
      addLog(`🔔 刷新通知：新增 ${r.added} · 已存在 ${r.already}` + tabText + capText + aiTxt, r.aiError ? 'warn' : 'success');
    } else {
      const err = (r && r.error) || '未知错误';
      addLog('❌ 刷新通知失败：' + err, 'error');
      if (b) window.alert('刷新通知失败：' + err + '\n\n请确保已登录小红书网页版并打开过通知页面。');
    }
    if (container) loadProspectList(container);
  } catch (e) {
    addLog('❌ 刷新通知失败：' + e.message, 'error');
    if (b) window.alert('刷新通知失败：' + e.message + '\n\n请先打开小红书网页版并登录。');
    if (container) loadProspectList(container);
  }
  _syncInFlight = false;
  if (b) { b.disabled = false; b.textContent = bReset; }
  return true;
}

// 刷新消息：拉 /chat 会话，AI 筛掉刷号玩/无关，相关的自动收进消息桶（未读标红）
async function syncChatInbound(container) {
  const b = document.getElementById('plSyncInbound');
  if (b) { b.disabled = true; b.textContent = '⏳ 刷新消息…'; }
  addLog('🔄 刷新消息（全量收录，不筛选）：读取 /chat 会话...', 'info');
  try {
    const r = await chrome.runtime.sendMessage({ action: 'syncChatInbound', data: { screen: false, full: true } });
    if (r && r.ok) {
      const ignTxt = (r.added > 0 || r.updated > 0 ? ' · 全量收录 ' + r.total + ' 条' : ' · 无可新增');
      addLog(`📨 刷新消息：新增 ${r.added} · 更新 ${r.updated} · 未读 ${r.unread}${ignTxt}`, r.unread > 0 ? 'warn' : 'success');
      if (container) {
        await loadProspectList(container); // 刷新桶视图（消息桶已持久化，直接列出）
      }
    } else {
      const err = (r && r.error) || '未知错误';
      addLog('❌ 刷新消息失败：' + err, 'error');
      if (b) window.alert('刷新消息失败：' + err + '\n\n请确认已登录小红书网页版并打开过消息中心。');
      if (container) loadProspectList(container);
    }
  } catch (e) {
    addLog('❌ 刷新消息失败：' + e.message, 'error');
    if (container) loadProspectList(container);
  }
  if (b) { b.disabled = false; b.textContent = '🔄 刷新消息'; }
}
async function loadChatView(container) {
  // 清掉统计/筛选等剩余内容（消息台自绘）
  container.querySelectorAll('.pl-stats,.pl-filter,.pl-batch,.pl-page,.pl-empty').forEach((el) => el.remove());
  const box = document.createElement('div');
  box.style.cssText = 'padding:4px 10px 10px;';
  box.innerHTML = `<div style="font-size:12px;color:#0f766e;padding:2px 2px 6px;">💬 消息中心(/chat) · 和客户聊 + 成交就在这里</div>
    <button id="plChatSync" style="font-size:12px;padding:6px 14px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:8px;cursor:pointer;font-weight:600;">🔄 同步消息</button>
    <div id="plChatList" style="margin-top:8px;"></div>`;
  container.appendChild(box);
  const listEl = box.querySelector('#plChatList');
  const syncBtn = box.querySelector('#plChatSync');
  const doSync = async () => {
    syncBtn.disabled = true; syncBtn.textContent = '⏳ 同步中…';
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:12px;">正在读取 /chat 会话…</div>';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'getChatConversations', data: {} });
      if (!r || !r.ok) throw new Error((r && r.error) || '读取失败');
      renderChatRows(listEl, r.items || []);
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#d33;font-size:12px;">❌ ${esc(e.message || '同步失败')}<br>请确认小红书网页版已登录并打开过消息中心。</div>`;
    }
    syncBtn.disabled = false; syncBtn.textContent = '🔄 同步消息';
  };
  syncBtn.addEventListener('click', doSync);
  doSync();
}

function renderChatRows(listEl, items) {
  if (!items.length) { listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:12px;">消息中心还没有会话。有人给你发消息、或你给商机发过私信后，这里就会出现。</div>'; return; }
  listEl.innerHTML = '';
  items.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'pl-card';
    const matchBadge = c.matched
      ? `<span class="pl-badge" style="background:${c.stage === 'prospect' ? '#f5f3ff;color:#7c3aed' : '#ecfdf5;color:#0f766e'}">${_stageLabel(c.stage) || '已在清单'}${c.status ? ' · ' + esc(c.status) : ''}</span>`
      : `<span class="pl-badge" style="background:#f3f4f6;color:#6b7280;">未收录</span>`;
    card.innerHTML = `
      <div class="pl-card-top">
        <span class="pl-nick">${esc(c.partnerName || '未知')}</span>
        ${matchBadge}
        ${c.time ? `<span style="font-size:11px;color:#8a8f99;margin-left:auto;">${esc(c.time)}</span>` : ''}
      </div>
      <div class="pl-source" style="font-size:12px;">📨 ${esc(c.lastMsg || '（无消息）')}</div>
      <div style="margin-top:8px;display:none;" class="pl-chat-draft" data-cid="${esc(c.convId)}">
        <textarea class="pl-draft-text" rows="3" style="width:100%;box-sizing:border-box;font-size:12px;font-family:inherit;border:1px solid #e5d9ff;border-radius:8px;padding:6px 8px;" placeholder="AI 草拟将出现在这里，可修改…"></textarea>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <button class="pl-draft-copy" style="font-size:11px;padding:4px 10px;border:1px solid #10b981;background:#ecfdf5;color:#059669;border-radius:6px;cursor:pointer;">📋 复制</button>
          <button class="pl-draft-open" style="font-size:11px;padding:4px 10px;border:1px solid #3b82f6;background:#eff6ff;color:#2563eb;border-radius:6px;cursor:pointer;">💬 打开会话</button>
          <button class="pl-draft-send" style="font-size:11px;padding:4px 10px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:6px;cursor:pointer;font-weight:600;">✈️ 发送</button>
        </div>
      </div>
      <div class="pl-foot">
        <button class="pl-ai" data-cid="${esc(c.convId)}" data-pid="${c.personId || ''}" title="AI 帮你起草一条回复">🤖 AI 草拟</button>
        <button class="pl-home" data-cid="${esc(c.convId)}" data-pid="${c.personId || ''}" title="打开 /chat 会话">➤ 开聊</button>
      </div>`;
    card.querySelector('.pl-home')?.addEventListener('click', () => {
      const pid = card.querySelector('.pl-home').dataset.pid;
      chrome.runtime.sendMessage({ action: 'openChat', data: { convId: c.convId, personId: pid || undefined } }).then((r) => {
        if (r && r.ok) addLog(`💬 已打开会话：${c.partnerName}`, 'success');
        else addLog('❌ 打开会话失败：' + ((r && r.error) || '未知'), 'error');
      }).catch((e) => addLog('❌ 打开会话失败：' + e.message, 'error'));
    });
    // AI 草拟
    card.querySelector('.pl-ai')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const draftBox = card.querySelector('.pl-chat-draft');
      const ta = card.querySelector('.pl-draft-text');
      if (draftBox.style.display !== 'none') { draftBox.style.display = 'none'; return; }
      draftBox.style.display = 'block';
      b.disabled = true; b.textContent = '⏳ 生成中…';
      ta.value = '';
      try {
        const txt = await chatDraftFor(c);
        ta.value = txt;
        b.disabled = false; b.textContent = '🤖 AI 草拟';
      } catch (err) {
        ta.value = '';
        ta.placeholder = '❌ 生成失败：' + (err.message || '未知') + '（可手动输入）';
        b.disabled = false; b.textContent = '🤖 AI 草拟';
      }
    });
    card.querySelector('.pl-draft-copy')?.addEventListener('click', () => {
      const ta = card.querySelector('.pl-draft-text');
      if (!ta || !ta.value) return;
      const c1 = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(ta.value) : Promise.reject();
      c1.catch(() => { ta.select(); document.execCommand('copy'); });
      const btn = card.querySelector('.pl-draft-copy');
      btn.textContent = '✅ 已复制'; setTimeout(() => { btn.textContent = '📋 复制'; }, 1200);
    });
    card.querySelector('.pl-draft-open')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openChat', data: { convId: c.convId, personId: c.personId || undefined } }).then((r) => {
        if (r && r.ok) addLog(`💬 已打开 ${c.partnerName} 的会话，粘贴草稿即可发送`, 'success');
        else addLog('❌ 打开会话失败：' + ((r && r.error) || '未知'), 'error');
      }).catch((err) => addLog('❌ 打开会话失败：' + err.message, 'error'));
    });
    // ✈️ 发送（导航 /chat 会话 → 注入 → 发送；命中商机联系即升格）
    card.querySelector('.pl-draft-send')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const ta = card.querySelector('.pl-draft-text');
      const msg = (ta && ta.value || '').trim();
      if (!msg) { addLog('⚠️ 先让 AI 草拟或手写内容再发送', 'warn'); return; }
      b.disabled = true; const _o = b.textContent; b.textContent = '⏳ 发送中…';
      try {
        const r = await chrome.runtime.sendMessage({ action: 'chatSend', data: { convId: c.convId, personId: c.personId || undefined, partnerName: c.partnerName, text: msg } });
        if (r && r.ok) addLog(`✅ 已发送给 ${c.partnerName}${c.personId ? '（商机已联系·升格）' : '（已收录为商机）'}`, 'success');
        else addLog(`❌ 发送失败${(r && r.limited) ? '（可能被私信限制，建议评论破冰）' : ''}：${(r && r.error) || '未知'}`, 'error');
      } catch (err) { addLog('❌ 发送失败：' + err.message, 'error'); }
      b.disabled = false; b.textContent = _o;
    });
    listEl.appendChild(card);
  });
}

// 为某个 /chat 会话生成一条 AI 回复草拟（有商机则用其画像，无则按对话上下文）
async function chatDraftFor(c) {
  let person = { nickname: c.partnerName || '对方', source: { comment: c.lastMsg || '', noteTitle: '消息中心', userUrl: '' } };
  if (c.personId) {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'getProspectList', data: {} });
      const hit = ((r && r.list) || []).find(p => p.id === c.personId);
      if (hit) person = hit;
    } catch (_) {}
  }
  // A 场景：消息跟单（chat_follow）优先，失败则退回 per-person 私信话术
  try {
    const t = await chrome.runtime.sendMessage({ action: 'aiCsTouch', data: { key: 'chat_follow', person, context: c.lastMsg || '' } });
    if (t && t.ok && t.draft) return t.draft;
  } catch (_) {}
  const resp = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person } });
  if (resp && resp.ok && resp.dmText) return resp.dmText;
  throw new Error((resp && resp.error) || 'AI 未返回草拟');
}

// ═══════════ AI客服：触达场景(A) + 客户问答话术库(B) ═══════════
let _aiCs = null;
const AI_CS_PURPOSES = [['sell', '🛍 卖货'], ['brand', '🏷 品牌种草'], ['profile', '👤 主页涨粉'], ['likes', '👍 养数据'], ['trend', '🔥 蹭热点'], ['auto', '🧩 自动']];
const AI_CS_ENABLED = { 'draft': '仅草拟·人工确认', 'auto': '自动发送', 'off': '关闭' };
// 引导方式（下拉）：告诉 AI「在这条话术里，重点引导对方去做什么动作」；空 = 跟随产品配置
const AI_CS_GUIDANCE = [
  ['', '跟随产品承接（默认）'],
  ['私信我', '私信我'],
  ['私信我留个邮箱，我把资料发你', '引导留邮箱（成交）'],
  ['看我主页置顶笔记', '引导看主页置顶'],
  ['看我主页简介', '引导看主页简介'],
];

// 加载 AI客服 config（共用）
async function _aiCsLoad() {
  const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} });
  if (!r || !r.ok) throw new Error((r && r.error) || '读取失败');
  return r.config;
}

// ═══ A · 触达场景（按场景配，点开即用） ═══
async function renderAiCsScene(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:13px;">加载 配置-通知…</div>';
  let cfg;
  try { cfg = await _aiCsLoad(); } catch (e) {
    container.innerHTML = '<div style="padding:20px;color:#d33;font-size:13px;">❌ ' + esc(e.message || '加载失败') + '</div>';
    return;
  }
  _aiCs = cfg;
  const ch = _aiCs.channels || {};
  const g = _aiCs.guide || {};
  const CH_KEYS = ['comment', 'like', 'follow', 'ai'];
  const CH_META = { comment: '💬 评论/回复', like: '👍 点赞/收藏', follow: '👣 关注', ai: '🧠 AI抓回' };
  const CH_DESC = {
    comment: '对方评论/回复过你 → 先接住 TA 的原话话题，再自然带一句产品/引导',
    like: '对方点赞了你的笔记 → 顺着 TA 赞的那个话题续下去，再带销售/引导',
    follow: '对方刚关注你 → 破冰自我介绍 + 价值预告 + 引导',
    ai: 'AI 从话题/评论匹配回来的 → 破冰呼应其需求 + 引导',
  };
  const CH_EXAMPLE = {
    comment: '示例：你那条评论里说“用了也一般”→ 先接这句聊感受，再说“我后来研究出个更省的用法，方便的话…”。',
    like: '示例：TA 赞了你那条“新手怎么选”的笔记 → “看来你也在这块踩过坑？后来我是这么解决的，想听的话…”。',
    follow: '示例：“谢谢关注～我是做××的，帮你整理过一套新手避坑资料，要不要发你？”。',
    ai: '示例：“看到你很关心××这个问题，我正好整理过，先给你个思路，需要的话我把资料发你。”',
  };
  const channelCards = `<table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead><tr style="background:#faf7ff;color:#6d28d9;">
      <th style="text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);">渠道</th>
      <th style="text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);">基调</th>
      <th style="text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);">示例</th>
      <th style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap;">字数 (min~max)</th>
    </tr></thead>
    <tbody>${CH_KEYS.map((k) => {
      const c = ch[k] || { minChars: 30, maxChars: 90 };
      return `<tr style="border-bottom:1px solid #f0edff;vertical-align:top;">
        <td style="padding:6px 8px;font-weight:600;white-space:nowrap;">${CH_META[k]}</td>
        <td style="padding:6px 8px;color:#444;">${CH_DESC[k]}</td>
        <td style="padding:6px 8px;color:#7c3aed;">${CH_EXAMPLE[k]}</td>
        <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
          <input class="aiCs-ch-min" data-k="${k}" type="number" title="最少字数" style="width:52px" value="${c.minChars}">~
          <input class="aiCs-ch-max" data-k="${k}" type="number" title="最多字数" style="width:52px" value="${c.maxChars}">
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
  const GUIDE_PRESETS = [['私信我留个邮箱，我把资料发你', '留邮箱发资料'], ['看我主页置顶笔记', '看主页置顶'], ['私信我', '私信我'], ['看我主页简介', '看主页简介'], ['小程序下单', '小程序下单']];
  const guideChips = GUIDE_PRESETS.map(([v, l], i) => {
    const active = g.deliver === v;
    return `<span class="aiCs-guidechip" data-v="${esc(v)}" data-i="${i}" style="cursor:pointer;font-size:11px;border:1px solid ${active ? '#7c3aed' : '#d5c8f5'};background:${active ? '#f3f0ff' : '#fff'};color:${active ? '#7c3aed' : '#6d28d9'};border-radius:14px;padding:3px 10px;">${l}</span>`;
  }).join('');
  container.innerHTML = `
    <div style="padding:10px 12px;border-bottom:1px solid var(--line);">
      <div style="font-weight:700;font-size:14px;">⚙️ 配置-通知 · 渠道基调 + 成交引导</div>
      <div style="font-size:11px;color:#888;margin-top:2px;">按线索来源渠道定首触话术（AI 生成，不手写）；对方露出购买意向时自动切「销售促成」按成交引导推进。</div>
    </div>
    <div style="padding:10px 12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button class="aiCsSave" style="font-size:12px;padding:6px 14px;border:none;border-radius:8px;background:#ff274b;color:#fff;cursor:pointer;font-weight:600;">💾 保存</button>
        <button class="aiCsExport" style="font-size:12px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">⬇ 导出</button>
        <button class="aiCsImport" style="font-size:12px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">⬆ 导入</button>
      </div>
      <div style="font-weight:700;font-size:13px;margin:4px 0;">🧭 渠道基调</div>
      <div class="aiCsChannels">${channelCards}</div>
      <div style="font-weight:700;font-size:13px;margin:14px 0 4px;">💰 成交/引导（4 渠道共用）</div>
      <div style="border:1px solid #f3e8ff;border-radius:8px;padding:8px 10px;background:#fcfaff;">
        <div style="font-size:11px;color:#555;margin-bottom:5px;">引导方式（点击选择，告诉 AI 引导对方来这）</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${guideChips}<span class="aiCs-guidechip" data-v="CUSTOM" data-i="-1" style="cursor:pointer;font-size:11px;border:1px solid ${g.deliver && !GUIDE_PRESETS.some(x => x[0] === g.deliver) ? '#7c3aed' : '#d5c8f5'};background:${g.deliver && !GUIDE_PRESETS.some(x => x[0] === g.deliver) ? '#f3f0ff' : '#fff'};color:#6d28d9;border-radius:14px;padding:3px 10px;">✏️ 自定义</span></div>
        <input id="aiCsGuideDeliver" placeholder="自定义承接，如：私信我留个邮箱，我把资料发你" style="width:100%;box-sizing:border-box;margin-top:6px;font-size:11px;padding:4px 6px;border:1px solid #e6d5ff;border-radius:6px;" value="${esc(g.deliver || '')}">
        <div style="font-size:11px;color:#8a8f99;margin-top:3px;">「引导」＝这条触达让 AI 引导对方干嘛（留邮箱/看置顶/私信/下单…）；话术 AI 生成，不手写。</div>
        <div style="margin-top:6px;font-size:11px;display:flex;align-items:center;gap:6px;">优惠活动<input id="aiCsGuideTips" placeholder="可选，例：报体验价 / 送赠品 / 强调售后" style="flex:1;min-width:0;font-size:11px;padding:4px 6px;border:1px solid #e6d5ff;border-radius:6px;" value="${esc(g.tips || '')}"></div>
        <div style="font-size:11px;color:#8a8f99;margin-top:3px;">例：报 9.9 体验价 / 下单送个赠品 / 强调"售后一对一，不满意可退"。</div>
      </div>
    </div>`;
  container.querySelector('.aiCsSave')?.addEventListener('click', () => saveAiCsChannels(container));
  container.querySelector('.aiCsExport')?.addEventListener('click', exportAiCs);
  container.querySelector('.aiCsImport')?.addEventListener('click', importAiCs);
  container.querySelectorAll('.aiCs-guidechip').forEach((chip) => chip.addEventListener('click', () => {
    const val = chip.dataset.v;
    const d = document.getElementById('aiCsGuideDeliver');
    if (d) { if (val === 'CUSTOM') d.focus(); else d.value = val; }
    container.querySelectorAll('.aiCs-guidechip').forEach((c) => { c.style.borderColor = '#d5c8f5'; c.style.background = '#fff'; c.style.color = '#6d28d9'; });
    chip.style.borderColor = '#7c3aed'; chip.style.background = '#f3f0ff'; chip.style.color = '#7c3aed';
  }));
}

// 保存 配置-通知：渠道基调 + 成交引导
// 批量生成话术（更多下拉/刷新后自动调用）
async function genMissingDrafts(container, forceAll) {
  const src = (_currentShown && _currentShown.length) ? _currentShown : (_plData.list || []);
  const targets = src.filter(p => p && p.id && !(p.discarded === true) && (p.status !== '已废弃') && _plBucket(p) === 'notif' && !p.convId && (forceAll || !String((p.dmDraft || '')).trim()));
  if (!targets.length) { addLog(forceAll ? '📭 当前无符合生成的话术' : '📭 都已生成话术，无需补充', 'info'); return; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'batchGenDmDrafts', data: { persons: targets } });
    if (r && r.ok) addLog(`✨ 话术生成：${forceAll ? '重写 ' : '补充 '}${r.generated} 条 · 失败 ${r.failed.length}`, r.failed.length ? 'warn' : 'success');
    else addLog('❌ 生成话术失败：' + ((r && r.error) || '未知'), 'error');
  } catch (e) { addLog('❌ 生成话术失败：' + e.message, 'error'); }
  if (container) loadProspectList(container); // 生成后立即刷新列表，让话术即时显示
}
// ── 消息视图：给消息桶里还没话术的人补生成 AI 话术 ──
async function genMsgDrafts(container) {
  const src = (_currentShown && _currentShown.length) ? _currentShown : (_plData.list || []);
  const targets = src.filter(p => p && p.id && !(p.discarded === true) && (p.status !== '已废弃') && _plBucket(p) === 'msg' && !String((p.dmDraft || '')).trim());
  if (!targets.length) { addLog('📭 消息视图都已生成话术，无需补充', 'info'); return; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'batchGenDmDrafts', data: { persons: targets } });
    if (r && r.ok) addLog(`✨ 消息话术生成：补 ${r.generated} 条 · 失败 ${r.failed.length}`, r.failed.length ? 'warn' : 'success');
    else addLog('❌ 生成话术失败：' + ((r && r.error) || '未知'), 'error');
  } catch (e) { addLog('❌ 生成话术失败：' + e.message, 'error'); }
  if (container) loadProspectList(container);
}
// ── 消息视图：只清空「消息」桶 ──
async function clearMsgBucketOnly(container) {
  if (!window.confirm('确认清空「消息（对方进线）列表」？此操作不可恢复。\n（建议先在设置页「💾 备份/恢复」备份）')) return;
  try {
    const r = await chrome.runtime.sendMessage({ action: 'clearProspectBucket', data: { bucket: 'msg' } });
    _selectedIds.clear();
    addLog('🧹 已清空消息列表', 'success');
  } catch (e) { window.alert('清空失败：' + e.message); }
  if (container) loadProspectList(container);
}
// ── 消息视图：批量联系TA（只发给勾选的消息桶人员；没话术的先补生成，再经 /chat 发送）──
async function batchContactMsg(container) {
  const ids = Array.from(_selectedIds);
  const leads = _plData.list.filter(p => p && p.id && ids.includes(p.id) && _plBucket(p) === 'msg');
  if (!leads.length) { addLog('⚠️ 未勾选任何消息里的人可联系', 'warn'); return; }
  const noDraft = leads.filter(p => !String((p.dmDraft || '')).trim());
  if (noDraft.length) { try { await chrome.runtime.sendMessage({ action: 'batchGenDmDrafts', data: { persons: noDraft } }); } catch (_) {} }
  let fresh = [];
  try { const rr = await chrome.runtime.sendMessage({ action: 'getProspectList', data: {} }); if (rr && rr.ok) fresh = rr.list || []; } catch (_) {}
  const _find = (id) => fresh.find(p => p && p.id === id);
  if (!window.confirm(`将自动给以下 ${leads.length} 人发跟进私信：\n${leads.map(l => '· ' + (l.nickname || '未知')).join('\n')}\n\n确定？`)) return;
  setLockBanner(true, 'msgContact');
  let ok = 0, fail = 0;
  for (const l of leads) {
    const p = _find(l.id) || l;
    let draft = (p.dmDraft || '').trim();
    if (!draft) { try { const g = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person: p } }); draft = ((g && g.ok && g.dmText) || '').trim(); } catch (_) {} }
    if (!draft) { fail++; addLog(`⚠️ ${p.nickname || l.nickname}：无话术，跳过`, 'warn'); continue; }
    if (!(p.convId || l.convId)) { fail++; addLog(`⚠️ ${p.nickname || l.nickname}：无会话 id，跳过`, 'warn'); continue; }
    try {
      const r = await chrome.runtime.sendMessage({ action: 'chatSend', data: { convId: (p.convId || l.convId), text: draft, personId: (p.id || l.id) } });
      if (r && r.ok) { ok++; addLog(`✉️ 已联系 ${p.nickname || l.nickname}`, 'success'); } else { fail++; addLog(`❌ ${p.nickname || l.nickname}：${(r && r.error) || '发送失败'}`, 'error'); }
    } catch (e) { fail++; addLog(`❌ ${p.nickname || l.nickname}：${e.message}`, 'error'); }
    await new Promise(r => setTimeout(r, 900));
  }
  setLockBanner(false);
  addLog(`📮 批量联系完成：成功 ${ok} · 失败 ${fail}`, fail ? 'warn' : 'success');
  if (container) loadProspectList(container);
}
// 清空全部（更多下拉）
async function clearAllProspects(container) {
  if (!window.confirm('⚠️ 确定清空【全部】获客清单吗？共 ' + (_plData.fullList.length) + ' 人将被删除，不可恢复！')) return;
  if (window.prompt('请输入 清空 两个字确认（防手滑）') !== '清空') { addLog('⏸ 已取消清空（确认文字不对）', 'warn'); return; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'clearProspects', data: {} });
    if (r && r.ok) { _selectedIds.clear(); addLog('🧹 已清空全部获客清单', 'success'); }
    else addLog('❌ 清空失败：' + ((r && r.error) || '未知'), 'error');
  } catch (e) { addLog('❌ 清空失败：' + e.message, 'error'); }
  loadProspectList(container);
}

function saveAiCsChannels(container) {
  const q = (sel) => container.querySelector(sel);
  const CH_KEYS = ['comment', 'like', 'follow', 'ai'];
  const channels = {};
  CH_KEYS.forEach((k) => {
    const base = (_aiCs.channels && _aiCs.channels[k]) || {};
    const v = (sel) => parseInt(q(sel + `[data-k="${k}"]`) && q(sel + `[data-k="${k}"]`).value, 10);
    channels[k] = {
      ...base,
      minChars: v('.aiCs-ch-min') || base.minChars || 30,
      maxChars: v('.aiCs-ch-max') || base.maxChars || 90,
    };
  });
  const deliver = (q('#aiCsGuideDeliver') && q('#aiCsGuideDeliver').value.trim()) || '';
  const tips = (q('#aiCsGuideTips') && q('#aiCsGuideTips').value.trim()) || '';
  chrome.runtime.sendMessage({ action: 'saveAiCsConfig', data: { partial: { channels, guide: { deliver, tips } } } }).then((r) => {
    if (r && r.ok) { _aiCs = r.config; addLog('✅ 配置-通知 已保存', 'success'); }
    else addLog('❌ 保存失败：' + ((r && r.error) || '未知'), 'error');
  }).catch((e) => addLog('❌ 保存失败：' + e.message, 'error'));
}

// ═══ B · 客户问答话术库（别人问、AI 答） ═══
async function renderAiCsQa(container) {
  container.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:13px;">加载 AI客服·问答话术库…</div>';
  let cfg;
  try { cfg = await _aiCsLoad(); } catch (e) {
    container.innerHTML = '<div style="padding:20px;color:#d33;font-size:13px;">❌ ' + esc(e.message || '加载失败') + '</div>';
    return;
  }
  _aiCs = cfg;
  container.innerHTML = `
    <div style="padding:10px 12px;border-bottom:1px solid var(--line);">
      <div style="font-weight:700;font-size:14px;">📖 AI客服 · B 客户问答话术库</div>
      <div style="font-size:11px;color:#888;margin-top:2px;">客户问了、AI 答：本地关键词路由优先，AI 兜底；模板可用 {产品} {价格} {卖点} 等变量。</div>
    </div>
    <div style="padding:10px 12px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button class="aiCsSave" style="font-size:12px;padding:6px 14px;border:none;border-radius:8px;background:#ff274b;color:#fff;cursor:pointer;font-weight:600;">💾 保存</button>
        <button class="aiCsExport" style="font-size:12px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">⬇ 导出</button>
        <button class="aiCsImport" style="font-size:12px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;">⬆ 导入</button>
        <button class="aiCsKb" style="font-size:12px;padding:6px 12px;border:1px solid #059669;background:#ecfdf5;color:#059669;border-radius:8px;cursor:pointer;">📥 话术→知识库</button>
        <button class="aiCsGen" style="font-size:12px;padding:6px 12px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:8px;cursor:pointer;">✨ AI 生成默认话术</button>
      </div>
      <div class="aiCs-qa"></div>
      <button class="aiCsQaAdd" style="font-size:12px;padding:5px 12px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:8px;cursor:pointer;margin-top:6px;">＋ 新增分类</button>
      <div style="font-weight:700;font-size:13px;margin:14px 0 4px;">🧪 试问答（验证路由与话术）</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="aiCsTestIn" type="text" placeholder="模拟客户说一句：几号发货？/ 贵不贵 / 我零基础适合吗…" style="flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:12px;">
        <button class="aiCsTestBtn" style="font-size:12px;padding:6px 12px;border:1px solid #0e7490;background:#ecfeff;color:#0e7490;border-radius:8px;cursor:pointer;">🤖 应答</button>
      </div>
      <div class="aiCsTestOut" style="font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;"></div>
    </div>`;
  renderAiCsQaList(container);
  container.querySelector('.aiCsSave')?.addEventListener('click', () => saveAiCs(container, 'qa'));
  container.querySelector('.aiCsExport')?.addEventListener('click', exportAiCs);
  container.querySelector('.aiCsImport')?.addEventListener('click', importAiCs);
  container.querySelector('.aiCsGen')?.addEventListener('click', () => aiCsGenDefaults());
  container.querySelector('.aiCsKb')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'qaToKb', data: {} }).then((r) => {
      if (r && r.ok) addLog(`📥 已将 ${r.added}/${r.total} 条话术同步进知识库（分类 客服·XX）`, 'success');
      else addLog('❌ 同步失败：' + ((r && r.error) || '未知'), 'error');
    }).catch(e => addLog('❌ 同步失败：' + e.message, 'error'));
  });
  container.querySelector('.aiCsQaAdd')?.addEventListener('click', () => { _aiCs.qa.push({ id: 'qa_' + Date.now().toString(36), category: '新分类', keywords: [], mode: 'template', auto: 'draft', enabled: true, answer: '' }); renderAiCsQaList(container); });
  container.querySelector('.aiCsTestBtn')?.addEventListener('click', () => aiCsTest(container));
  container.querySelector('.aiCsTestIn')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') aiCsTest(container); });
}

function renderAiCsScenes(container) {
  const box = container.querySelector('.aiCs-scenes'); if (!box) return;
  box.innerHTML = '';
  if (!_aiCs.scenes || Object.keys(_aiCs.scenes).length === 0) {
    box.innerHTML = '<div style="border:1px dashed var(--line);border-radius:8px;padding:18px;text-align:center;color:var(--sub);font-size:12px;">暂无触达场景<br><span style="font-size:11px;color:#aaa;">场景在「设置页 → AI客服·场景话术」或后台配置</span></div>';
    return;
  }
  for (const [k, s] of Object.entries(_aiCs.scenes)) {
    const purp = AI_CS_PURPOSES.map(([v, l]) => `<option value="${v}" ${s.purpose === v ? 'selected' : ''}>${l}</option>`).join('');
    const modeOpts = ['draft', 'auto'].map(v => `<option value="${v}" ${s.mode === v ? 'selected' : ''}>${AI_CS_ENABLED[v]}</option>`).join('');
    const guideOpts = AI_CS_GUIDANCE.map(([v, l]) => `<option value="${esc(v)}" ${String(s.guidance || '') === v ? 'selected' : ''}>${l}</option>`).join('');
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#fff;';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;"><input type="checkbox" class="aic-sc-on" data-k="${k}" ${s.enabled ? 'checked' : ''}>${esc(s.name)}</label>
        <span style="margin-left:auto;display:flex;gap:4px;align-items:center;font-size:11px;">
          打法<select class="aic-sc-purpose" data-k="${k}">${purp}</select>
          模式<select class="aic-sc-mode" data-k="${k}">${modeOpts}</select>
          字数 <input class="aic-sc-min" data-k="${k}" type="number" style="width:46px" value="${s.minChars}">~<input class="aic-sc-max" data-k="${k}" type="number" style="width:46px" value="${s.maxChars}">
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:11px;">
        <label style="display:flex;align-items:center;gap:4px;">🎯 引导<select class="aic-sc-guide" data-k="${k}" style="font-size:11px;">${guideOpts}</select></label>
        <span style="color:#8a8f99;">「引导」＝这条触达要让 AI 引导对方干嘛（留邮箱/看主页置顶/私信）；话术由 AI 按此场景生成，不在这里手写</span>
      </div>`;
    box.appendChild(card);
  }
}

function renderAiCsQaList(container) {
  const box = container.querySelector('.aiCs-qa'); if (!box) return;
  if (!_aiCs.qa || _aiCs.qa.length === 0) {
    box.innerHTML = '<div style="border:1px dashed var(--line);border-radius:8px;padding:18px;text-align:center;color:var(--sub);font-size:12px;">暂无客户问答话术<br><span style="font-size:11px;color:#aaa;">点击下方「＋ 添加话术」新建，别人问、AI 按此应答</span></div>';
    return;
  }
  box.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead><tr style="background:#f5f3ff;color:#6d28d9;">
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;width:26px;">启用</th>
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;">分类</th>
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;">关键词</th>
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;">模式</th>
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;">触发</th>
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;min-width:200px;">话术</th>
      <th style="padding:5px 8px;border-bottom:1px solid var(--line);width:30px;"></th>
    </tr></thead>
    <tbody>${_aiCs.qa.map((e, i) => {
      const mode = e.mode === 'ai' ? 'ai' : 'template';
      const auto = AI_CS_ENABLED[Object.prototype.hasOwnProperty.call(AI_CS_ENABLED, e.auto) ? e.auto : 'draft'];
      return `<tr style="border-bottom:1px solid #f0edff;vertical-align:top;">
        <td style="padding:6px 8px;"><input type="checkbox" class="aic-qa-on" data-i="${i}" ${e.enabled !== false ? 'checked' : ''}></td>
        <td style="padding:6px 8px;"><input class="aic-qa-cat" data-i="${i}" type="text" value="${esc(e.category)}" style="width:90px;font-size:12px;font-weight:600;border:1px solid #eee;border-radius:6px;padding:4px;"></td>
        <td style="padding:6px 8px;"><input class="aic-qa-kw" data-i="${i}" type="text" placeholder="触发关键词，逗号分隔" value="${esc((e.keywords || []).join('，'))}" style="width:130px;font-size:11px;border:1px solid #eee;border-radius:6px;padding:4px;"></td>
        <td style="padding:6px 8px;"><select class="aic-qa-mode" data-i="${i}" style="font-size:11px;">
          <option value="template" ${mode === 'template' ? 'selected' : ''}>模板</option>
          <option value="ai" ${mode === 'ai' ? 'selected' : ''}>AI</option>
        </select></td>
        <td style="padding:6px 8px;"><select class="aic-qa-auto" data-i="${i}" style="font-size:11px;">
          <option value="draft" ${e.auto === 'draft' ? 'selected' : ''}>草拟·确认</option>
          <option value="auto" ${e.auto === 'auto' ? 'selected' : ''}>自动</option>
          <option value="off" ${e.auto === 'off' ? 'selected' : ''}>关闭</option>
        </select></td>
        <td style="padding:6px 8px;"><textarea class="aic-qa-ans" data-i="${i}" rows="2" placeholder="话术（模板可用 {产品}{价格} 等；AI 模式写引导/要点）" style="width:100%;box-sizing:border-box;font-size:11px;border:1px solid #eee;border-radius:6px;padding:4px 6px;">${esc(e.answer || '')}</textarea></td>
        <td style="padding:6px 8px;"><button class="aic-qa-del" data-i="${i}" style="border:none;background:none;color:#d32f2f;cursor:pointer;font-size:12px;" title="删除">🗑</button></td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
  box.querySelectorAll('.aic-qa-del').forEach(b => b.addEventListener('click', () => { _aiCs.qa.splice(parseInt(b.dataset.i, 10), 1); renderAiCsQaList(container); }));
}

function _aiCsGatherScenes(container) {
  const scenes = {};
  Object.keys(_aiCs.scenes).forEach(k => {
    const s = _aiCs.scenes[k];
    // 固定话术模板已从 UI 移除（配置=引导目标，话术由 AI 生成）；模板保留原样不改
    scenes[k] = {
      ...s,
      enabled: !!container.querySelector(`.aic-sc-on[data-k="${k}"]`)?.checked,
      purpose: container.querySelector(`.aic-sc-purpose[data-k="${k}"]`)?.value || s.purpose,
      mode: container.querySelector(`.aic-sc-mode[data-k="${k}"]`)?.value || 'draft',
      minChars: parseInt(container.querySelector(`.aic-sc-min[data-k="${k}"]`)?.value, 10) || s.minChars,
      maxChars: parseInt(container.querySelector(`.aic-sc-max[data-k="${k}"]`)?.value, 10) || s.maxChars,
      guidance: container.querySelector(`.aic-sc-guide[data-k="${k}"]`)?.value || '',
    };
  });
  return scenes;
}
const _aiCsGatherQa = function (container) {
  return Array.from(container.querySelectorAll('.aic-qa-cat')).map(ta => {
    const i = parseInt(ta.dataset.i, 10);
    const e = _aiCs.qa[i] || { id: 'qa_' + i };
    return {
      id: e.id || ('qa_' + Date.now().toString(36) + i),
      category: ta.value.trim() || '未命名',
      keywords: (container.querySelector(`.aic-qa-kw[data-i="${i}"]`)?.value || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean),
      mode: container.querySelector(`.aic-qa-mode[data-i="${i}"]`)?.value || 'template',
      auto: container.querySelector(`.aic-qa-auto[data-i="${i}"]`)?.value || 'draft',
      enabled: !!container.querySelector(`.aic-qa-on[data-i="${i}"]`)?.checked,
      answer: container.querySelector(`.aic-qa-ans[data-i="${i}"]`)?.value || '',
    };
  });
};

// ✨ AI 生成默认话术：按 人设 + 产品卖点 + 知识库 起草 A场景模板 和 B问答答案，填入 _aiCs 供预览（需再点"保存"才落库）
async function aiCsGenDefaults() {
  const cfg = { scenes: (_aiCs && _aiCs.scenes) || {}, qa: (_aiCs && _aiCs.qa) || [] };
  try {
    const r = await chrome.runtime.sendMessage({
      action: 'genDefaultAiCS',
      data: { sceneKeys: Object.keys(cfg.scenes), qa: cfg.qa.map(q => ({ category: q && q.category })) },
    });
    if (!r || !r.ok) throw new Error((r && r.error) || '生成失败');
    let scFilled = 0, qaFilled = 0;
    for (const k of Object.keys(r.scenes || {})) {
      if (cfg.scenes[k] && r.scenes[k]) { cfg.scenes[k].templates = [r.scenes[k]]; cfg.scenes[k].template = r.scenes[k]; scFilled++; }
    }
    for (const g of (r.qa || [])) {
      const e = cfg.qa.find(x => x && x.category === g.category);
      if (e && g.answer) { e.answer = g.answer; if (!e.mode) e.mode = 'template'; qaFilled++; }
    }
    addLog(`✨ AI 已按人设/卖点生成默认话术：场景 ${scFilled} 条 · 问答 ${qaFilled} 条（预览后可改，别忘了「💾 保存」）`, 'success');
    // 只重绘内存里的列表（不重新拉取/不落库，保住刚生成的预览）
    try {
      const sceneBox = document.getElementById('aiCsSceneContent'); if (sceneBox) renderAiCsScenes(sceneBox);
      const qaBox = document.getElementById('aiCsQaContent'); if (qaBox) renderAiCsQaList(qaBox);
    } catch (_) {}
  } catch (e) { addLog('❌ 生成默认话术失败：' + e.message, 'error'); }
}

async function saveAiCs(container, which) {
  // 每次只保存当前 tab 的那部分，另一部分用已加载的 _aiCs 兜底，避免误清空
  const partial = (which === 'qa')
    ? { qa: _aiCsGatherQa(container) }
    : { scenes: _aiCsGatherScenes(container) };
  try {
    const r = await chrome.runtime.sendMessage({ action: 'saveAiCsConfig', data: { partial } });
    if (r && r.ok) { _aiCs = r.config; addLog('💾 AI客服配置已保存', 'success'); }
    else addLog('❌ 保存失败：' + ((r && r.error) || '未知'), 'error');
  } catch (e) { addLog('❌ 保存失败：' + e.message, 'error'); }
}

async function exportAiCs() {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} });
    const pw = await CryptoBox.askPassword({
      title: '设置导出加密口令',
      hint: 'AI客服配置导出为<b>加密文件</b>（含话术与问答），请设一个口令并记牢；导入时要用同一个口令。',
      okText: '加密导出', confirm: true,
    });
    if (!pw.ok) return;
    const text = await CryptoBox.encryptFile(JSON.stringify((r && r.config) || {}, null, 2), pw.password);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-cs-config-' + new Date().toISOString().slice(0, 10) + '.enc.json';
    a.click(); URL.revokeObjectURL(a.href);
    addLog('✅ AI客服配置已加密导出（A场景 + B问答，需口令才能导入）', 'success');
  } catch (e) { addLog('❌ 导出失败：' + e.message, 'error'); }
}

function importAiCs() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        let val = String(rd.result || '');
        if (CryptoBox.isFileEnvelope(val)) {
          const pw = await CryptoBox.askPassword({
            title: '输入配置口令',
            hint: '这是加密导出的 AI客服配置文件，请输入导出时设置的口令。',
            okText: '解密导入',
          });
          if (!pw.ok) return;
          try { val = await CryptoBox.decryptFile(val, pw.password); }
          catch (err) { addLog('❌ ' + (err.message || err), 'error'); return; }
        }
        JSON.parse(val); // 提前校验格式，给出友好报错
        chrome.runtime.sendMessage({ action: 'importAiCsConfig', data: { json: val } }).then((r) => {
          if (r && r.ok) {
            _aiCs = r.config;
            // 重新渲染 A/B 两个二级 Tab
            ['aiCsSceneContent', 'aiCsQaContent'].forEach((id) => {
              const c = document.getElementById(id);
              if (c) {
                if (id === 'aiCsSceneContent') { _aiCsSceneLoaded = false; if (c.style.display !== 'none') { _aiCsSceneLoaded = true; renderAiCsScene(c); } }
                else { _aiCsQaLoaded = false; if (c.style.display !== 'none') { _aiCsQaLoaded = true; renderAiCsQa(c); } }
              }
            });
            addLog('✅ 导入成功：' + r.imported, 'success');
          }
          else addLog('❌ 导入失败：' + ((r && r.error) || '未知'), 'error');
        }).catch(e => addLog('❌ 导入失败：' + e.message, 'error'));
      } catch (_) { addLog('❌ 导入失败：不是合法的 JSON 文件', 'error'); }
    };
    rd.onerror = () => { addLog('❌ 导入失败：文件读取错误', 'error'); };
    rd.readAsText(file, 'utf-8');
  });
  input.click();
}

async function aiCsTest(container) {
  const inn = container.querySelector('.aiCsTestIn');
  const out = container.querySelector('.aiCsTestOut');
  if (!inn || !out) return;
  const q = inn.value.trim();
  if (!q) return;
  out.innerHTML = '<span class="loading-spinner" style="display:inline-block;width:12px;height:12px;border:2px solid;border-top-color:transparent;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>路由中…';
  try {
    const r = await chrome.runtime.sendMessage({ action: 'aiCsRespond', data: { incoming: q } });
    if (r && r.ok) {
      out.innerHTML = `<div style="background:#f1f5f9;border-radius:6px;padding:6px 8px;">🎯 分类 <b>${esc(r.category)}</b> · ${r.mode === 'ai' ? 'AI生成' : '模板'}<br><div style="margin-top:4px;">${esc(r.reply)}</div></div>`;
    } else {
      out.innerHTML = '<div style="color:#d33;">❌ ' + esc((r && r.error) || '应答失败') + '</div>';
    }
  } catch (e) { out.innerHTML = '<div style="color:#d33;">❌ ' + esc(e.message) + '</div>'; }
}

// 通知回访：枚举待回复 → 按 notif_reply 场景草拟 → 发送（replyNotification 三重定位）
async function loadNotifReplies(container) {
  const box = container.querySelector('.aiCsNotifList');
  const btn = container.querySelector('.aiCsNotifSync');
  if (!box) return;
  box.innerHTML = '<div style="font-size:12px;color:#888;">同步通知页…</div>';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 同步中…'; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'getPendingNotifs', data: {} });
    if (!r || !r.ok) throw new Error((r && r.error) || '同步失败');
    const items = r.items || [];
    if (!items.length) { box.innerHTML = '<div style="font-size:12px;color:#888;">暂无待回复通知（你被回的新消息都在这里）。</div>'; }
    else {
      box.innerHTML = '';
      items.slice(0, 25).forEach((it, i) => renderNotifCard(box, it, i));
    }
  } catch (e) {
    box.innerHTML = '<div style="font-size:12px;color:#d33;">❌ ' + esc(e.message || '同步失败') + '<br>请确认小红书网页版已登录并打开。</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 同步待回复通知'; }
}

function renderNotifCard(box, it, i) {
  const card = document.createElement('div');
  card.className = 'pl-card';
  card.innerHTML = `
    <div class="pl-card-top"><span class="pl-nick">${esc(it.userName || '对方')}</span><span style="font-size:11px;color:#8a8f99;margin-left:auto;">${esc(it.time || '')}</span></div>
    <div class="pl-source" style="font-size:12px;">💬 ${esc(it.incoming)}</div>
    <textarea class="pl-draft-text" rows="2" style="width:100%;box-sizing:border-box;font-size:12px;border:1px solid #e5d9ff;border-radius:8px;padding:6px 8px;margin-top:6px;" placeholder="草拟（按 notif_reply 场景）…"></textarea>
    <div style="display:flex;gap:6px;margin-top:6px;">
      <button class="nf-ai" style="font-size:11px;padding:4px 10px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:6px;cursor:pointer;">🤖 按场景草拟</button>
      <button class="nf-send" style="font-size:11px;padding:4px 10px;border:1px solid #ef4444;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;">📤 发送</button>
    </div>`;
  const ta = card.querySelector('.pl-draft-text');
  const aiBtn = card.querySelector('.nf-ai');
  const sendBtn = card.querySelector('.nf-send');
  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true; aiBtn.textContent = '⏳ 生成中…';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'aiCsTouch', data: { key: 'notif_reply', context: it.incoming, person: { nickname: it.userName, source: { comment: it.incoming } } } });
      if (r && r.ok) ta.value = r.draft;
      else throw new Error((r && r.error) || '生成失败');
    } catch (e) { ta.value = ''; ta.placeholder = '❌ ' + (e.message || '生成失败'); }
    aiBtn.disabled = false; aiBtn.textContent = '🤖 按场景草拟';
  });
  sendBtn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { addLog('⚠️ 先草拟或手写内容', 'warn'); return; }
    sendBtn.disabled = true; sendBtn.textContent = '⏳ 发送中…';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'sendNotifReply', data: { idx: it.idx, replyText: text, userId: it.userId, userName: it.userName, latestText: it.incoming } });
      if (r && r.ok) { addLog('✅ 已回复 ' + (it.userName || ''), 'success'); card.remove(); }
      else addLog('❌ 回访失败：' + ((r && r.error) || '未知'), 'error');
    } catch (e) { addLog('❌ 回访失败：' + e.message, 'error'); }
    sendBtn.disabled = false; sendBtn.textContent = '📤 发送';
  });
  box.appendChild(card);
}

// 单个/批量画像
async function runProfileOne(targets, container) {
  const candidates = targets.map(p => ({
    id: p.id,
    userId: p.userId,
    nickname: p.nickname,
    source: p.source,
  }));
  addLog(`⚡ 开始画像 ${candidates.length} 人...`, 'info');
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'profileProspects', data: { candidates } });
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || '画像失败');
    if (resp.applied && resp.applied.length > 0) {
      addLog(`✅ 画像完成：${resp.applied.length} 人已生成画像`, 'success');
      // 允许手动微调（逐个弹出编辑）
      const editable = resp.applied.filter(a => a.id);
      if (editable.length > 0) {
        // 打开第一个的编辑弹窗（数据已落库，编辑后重新加载）
        const person = targets.find(t => t.id === editable[0].id);
        if (person) {
          openProfileModal(person, container);
          return;
        }
      }
    } else {
      addLog('⚠️ 画像完成，但 AI 未返回可用结果，请重试或手动编辑', 'warn');
    }
  } catch (e) {
    addLog('❌ 画像失败：' + e.message, 'error');
    window.alert('画像失败：' + e.message);
  }
  loadProspectList(container);
}

// 画像编辑弹窗
function openProfileModal(person, container) {
  const mask = document.getElementById('profileModal');
  if (!mask) return;
  const pf = person.profile || {};
  document.getElementById('pfTags').value = (pf.tags || []).join(',');
  document.getElementById('pfIdentity').value = pf.identity || '';
  document.getElementById('pfNeeds').value = pf.needs || '';
  document.getElementById('pfPain').value = pf.painPoints || '';
  document.getElementById('pfAngle').value = pf.dmAngle || '';
  mask.classList.add('open');
  mask.dataset.plid = person.id;
}

// 私信弹窗
function openDmModal(person) {
  const mask = document.getElementById('dmModal');
  if (!mask) return;
  mask.dataset.plid = person.id;
  const profile = person.profile || {};
  const src = person.source || {};
  const summaryHtml =
    `<b>${esc(person.nickname)}</b> · 意向：${profile.intentLevel || '未画像'}<br>` +
    (profile.identity ? `身份：${esc(profile.identity)}<br>` : '') +
    (profile.needs ? `需求：${esc(profile.needs)}<br>` : '') +
    (profile.painPoints ? `痛点：${esc(profile.painPoints)}<br>` : '') +
    (profile.dmAngle ? `切入：${esc(profile.dmAngle)}<br>` : '') +
    `来源：${esc(src.comment || '').slice(0, 60)}`;
  document.getElementById('dmModalSummary').innerHTML = summaryHtml;
  const _preset = (person && person.dmDraft) || '';
  const dmTextEl = document.getElementById('dmText');
  dmTextEl.value = _preset;
  dmTextEl.placeholder = _preset ? '私信内容...' : '正在生成话术…';
  document.getElementById('dmResult').textContent = '';
  const dmT = document.getElementById('dmTiming'); if (dmT) dmT.textContent = '';
  const dmTB = document.getElementById('dmTimingBtn'); if (dmTB) { dmTB.disabled = false; dmTB.textContent = '🎯 判断销售时机'; }
  document.getElementById('dmGenBtn').disabled = false;
  document.getElementById('dmSendBtn').disabled = false;
  // 升格按钮仅"线索池"显示（私信前可先 AI 判断是否值得升商机）；商机池隐藏
  const prom = document.getElementById('dmPromoteBtn');
  if (prom) { prom.disabled = false; prom.textContent = '🧠 高意向跟进'; prom.style.display = (_plGetStage(person) === 'lead') ? '' : 'none'; }
  mask.classList.add('open');
  // 无现成话术时，打开即自动生成并填入，生成后写回 dmDraft，下次直接命中
  if (!_preset.trim()) {
    generateDmText(person).then((t) => {
      const el = document.getElementById('dmText');
      if (t && el && mask.classList.contains('open')) { el.value = t; el.placeholder = '私信内容...'; }
      if (t && person && person.id) chrome.runtime.sendMessage({ action: 'updateProspect', data: { id: person.id, updates: { dmDraft: t } } }).catch(() => {});
    }).catch(() => {});
  }
}

// 生成私信话术（AI）
async function generateDmText(person) {
  const resp = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person } });
  if (resp && resp.ok && resp.dmText) return resp.dmText;
  throw new Error((resp && resp.error) || 'AI 话术生成失败');
}

// 私信发送流程（含 AI 生成 + 人工确认）
async function sendDmFlow(person, auto, textOverride) {
  const text = (typeof textOverride === 'string' && textOverride)
    ? textOverride
    : (document.getElementById('dmText') ? document.getElementById('dmText').value.trim() : '');
  if (!text) {
    addLog('❌ 私信内容为空', 'error');
    return false;
  }
  const resp = await chrome.runtime.sendMessage({
    action: 'sendDm',
    data: { person, text, aiGenerated: true },
  });
  if (resp && resp.ok && resp.navigating) {
    addLog(`ℹ️ ${resp.notice || '已打开用户主页，请手动发送'}：${person.nickname}`, 'warn');
    const r = document.getElementById('dmResult');
    if (r) { r.textContent = resp.notice || '已打开用户主页，请手动发送'; r.className = 'pl-result warn'; }
    return false;
  }
  if (!resp || !resp.ok) {
    const limited = resp && resp.limited;
    addLog(`❌ 私信发送失败${limited ? '（可能被限制，建议改为评论互动破冰）' : ''}：${(resp && resp.error) || '未知'}`, 'error');
    if (!auto) {
      const r = document.getElementById('dmResult');
      if (r) r.textContent = (resp && resp.error) || '发送失败';
    }
    return false;
  }
  return true;
}

// 弹窗按钮绑定（在文档初始化处调用一次）
function bindProspectModals() {
  const dmMask = document.getElementById('dmModal');
  const dmGenBtn = document.getElementById('dmGenBtn');
  const dmSendBtn = document.getElementById('dmSendBtn');
  const dmText = document.getElementById('dmText');
  const dmResult = document.getElementById('dmResult');
  if (dmMask) {
    dmMask.addEventListener('click', e => { if (e.target === dmMask) closeDmModal(); });
    document.getElementById('dmCancelBtn')?.addEventListener('click', closeDmModal);
    const dmSceneBtn = document.getElementById('dmSceneBtn');
    dmSceneBtn?.addEventListener('click', async () => {
      const person = getPlPerson(dmMask.dataset.plid);
      if (!person) return;
      // ★ 不传 key → 由后台按 层/渠道 动态选 A 触达场景（线索→dm_first/notif_reply；商机→chat_follow/after_sale）
      dmSceneBtn.disabled = true; dmSceneBtn.textContent = '⏳ 场景话术中…'; dmResult.textContent = '';
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'aiCsTouch', data: { key: '', person } });
        if (resp && resp.ok) {
          dmText.value = resp.draft || '';
          dmResult.textContent = '🎧 已按「' + (resp.scene || sceneKey) + '」场景生成（可改用「AI生成」走画像话术）';
          dmResult.className = 'pl-result ok';
        } else { dmResult.textContent = (resp && resp.error) || '生成失败'; dmResult.className = 'pl-result fail'; }
      } catch (e) { dmResult.textContent = e.message; dmResult.className = 'pl-result fail'; }
      dmSceneBtn.disabled = false; dmSceneBtn.textContent = '🎧 场景话术';
    });
    dmGenBtn?.addEventListener('click', async () => {
      const person = getPlPerson(dmMask.dataset.plid);
      const raw = dmText.value.trim();
      if (!raw) { dmResult.textContent = '先在上面输入你的话术，再点「优化话术」'; dmResult.className = 'pl-result warn'; return; }
      dmGenBtn.disabled = true;
      dmGenBtn.textContent = '✨ 优化中...';
      dmResult.textContent = '';
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'optimizeDm', data: { text: raw, person } });
        if (resp && resp.ok && resp.text) {
          dmText.value = resp.text;
          dmResult.textContent = '✅ 已优化：改得更自然口语（不改变原意图/引导），请再检查后发送';
          dmResult.className = 'pl-result ok';
        } else {
          dmResult.textContent = (resp && resp.error) || '优化失败';
          dmResult.className = 'pl-result fail';
        }
      } catch (e) {
        dmResult.textContent = e.message;
        dmResult.className = 'pl-result fail';
      }
      dmGenBtn.disabled = false;
      dmGenBtn.textContent = '✨ 优化话术';
    });
    // 🎯 AI 判断销售时机：决定是否现在用统一话术联系该候选
    const dmTimingBtn = document.getElementById('dmTimingBtn');
    const dmTiming = document.getElementById('dmTiming');
    dmTimingBtn?.addEventListener('click', async () => {
      const person = getPlPerson(dmMask.dataset.plid);
      if (!person) return;
      dmTimingBtn.disabled = true;
      dmTimingBtn.textContent = '🎯 判断中...';
      dmTiming.innerHTML = '<span class="loading-spinner" style="display:inline-block;width:12px;height:12px;border:2px solid;border-top-color:transparent;border-radius:50%;margin-right:6px;vertical-align:middle;"></span> AI 正在判断销售时机...';
      dmTiming.className = 'pl-result';
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'judgeSaleTiming', data: { person } });
        if (resp && resp.ok) {
          const map = {
            now: { t: '🔥 时机成熟', c: '#16a34a' },
            warm_up: { t: '🌡️ 先破冰', c: '#f59e0b' },
            wait: { t: '⏳ 暂缓', c: '#6b7280' },
          };
          const m = map[resp.timing] || { t: resp.timing, c: '#6b7280' };
          dmTiming.innerHTML =
            `<div style="font-size:14px;font-weight:600;color:${m.c};">${m.t} · 意向：${resp.intent === 'high' ? '高' : resp.intent === 'medium' ? '中' : '低'}</div>` +
            `<div style="font-size:12px;color:#666;margin-top:3px;">💡 ${esc(resp.reason || '')}</div>` +
            ` ${resp.hook ? `<div style="font-size:12px;color:#7c3aed;margin-top:3px;">🎣 切入：${esc(resp.hook)}</div>` : ''}` +
            (resp.suggestedAction ? `<div style="font-size:13px;font-weight:600;color:${m.c};margin-top:5px;">✅ 建议：${esc(resp.suggestedAction)}</div>` : '');
          dmTiming.className = 'pl-result ok';
          addLog(`🎯 ${person.nickname} 销售时机：${m.t}（${resp.intent || ''}）— ${(resp.reason || '').slice(0, 40)}`, 'info');
        } else {
          dmTiming.textContent = (resp && resp.error) || '判断失败';
          dmTiming.className = 'pl-result fail';
        }
      } catch (e) {
        dmTiming.textContent = e.message;
        dmTiming.className = 'pl-result fail';
      }
      dmTimingBtn.disabled = false;
      dmTimingBtn.textContent = '🎯 判断销售时机';
    });
    // ⚡ 画像/编辑：进私信弹窗右上角，发信前先画像（无画像自动跑 AI，已有直接编辑）
    const dmProfileBtn = document.getElementById('dmProfileBtn');
    dmProfileBtn?.addEventListener('click', async () => {
      const person = getPlPerson(dmMask.dataset.plid);
      if (!person) return;
      if (person.profile && person.profile.intentLevel) {
        openProfileModal(person, null);
      } else {
        addLog(`⚡ 为 @${person.nickname} AI 画像...`, 'info');
        await runProfileOne([person], document.getElementById('prospectContent') || document.body);
      }
    });
    // 🧠 高意向跟进（仅线索在用）：私信前的 AI 判断，合适即升商机
    const dmPromoteBtn = document.getElementById('dmPromoteBtn');
    dmPromoteBtn?.addEventListener('click', async () => {
      const id = dmMask.dataset.plid;
      const person = getPlPerson(id);
      if (!person || _plGetStage(person) !== 'lead') return;
      dmPromoteBtn.disabled = true; dmPromoteBtn.textContent = '🧠 判断中…';
      try {
        const r = await chrome.runtime.sendMessage({ action: 'judgeLeadPromotion', data: { id } });
        if (r && r.ok) {
          if (r.promote) {
            await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { intentLevel: 'high', affinity: Object.assign({}, person.affinity || {}, { intentLevel: 'high' }) } } });
            addLog(`🧠 AI 判断高意向 → 已将 ${person.nickname} 置顶为「高意向·待跟单」（${r.reason || ''}）`, 'success');
            dmPromoteBtn.style.display = 'none';
          } else {
            addLog(`⏸ AI 判断暂不适合跟进：${r.reason || '需求不强'}`, 'warn');
          }
        } else {
          addLog('❌ 升格判断失败：' + ((r && r.error) || '未知'), 'warn');
        }
      } catch (e) {
        addLog('❌ 升格判断异常：' + e.message, 'warn');
      }
      dmPromoteBtn.disabled = false; dmPromoteBtn.textContent = '🧠 高意向跟进';
    });
    dmSendBtn?.addEventListener('click', async () => {
      const person = getPlPerson(dmMask.dataset.plid);
      if (!person) return;
      dmSendBtn.disabled = true;
      const ok = await sendDmFlow(person, false);
      if (ok) {
        dmResult.textContent = '✅ 私信已发送';
        dmResult.className = 'pl-result ok';
        addLog(`✅ 私信已发送给 ${person.nickname}`, 'success');
        setTimeout(() => { closeDmModal(); loadProspectList(document.getElementById('prospectContent')); }, 900);
      } else {
        dmSendBtn.disabled = false;
      }
    });
  }
  const pfMask = document.getElementById('profileModal');
  if (pfMask) {
    pfMask.addEventListener('click', e => { if (e.target === pfMask) closeProfileModal(); });
    document.getElementById('pfCancelBtn')?.addEventListener('click', closeProfileModal);
    document.getElementById('pfSaveBtn')?.addEventListener('click', async () => {
      const id = pfMask.dataset.plid;
      const tags = document.getElementById('pfTags').value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
      const profile = {
        tags,
        identity: document.getElementById('pfIdentity').value.trim(),
        needs: document.getElementById('pfNeeds').value.trim(),
        painPoints: document.getElementById('pfPain').value.trim(),
        dmAngle: document.getElementById('pfAngle').value.trim(),
      };
      const resp = await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { profile } } });
      if (resp && resp.ok) {
        addLog('✅ 画像已保存', 'success');
        closeProfileModal();
        loadProspectList(document.getElementById('prospectContent'));
      }
    });
  }
}
function closeDmModal() { document.getElementById('dmModal')?.classList.remove('open'); if (_touchBatchActive) { setTimeout(() => _touchNext(), 120); } }
function closeProfileModal() { document.getElementById('profileModal')?.classList.remove('open'); }

// 触达：按渠道自动生成 A 场景话术预填私信弹窗（dm_first / notif_reply / chat_follow 由后台推导）
async function touchScenePrefill(person) {
  const dt = document.getElementById('dmText'); if (!dt) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'aiCsTouch', data: { key: '', person } });
    if (resp && resp.ok && resp.draft) {
      dt.value = resp.draft;
      const r = document.getElementById('dmResult');
      if (r && r.textContent === '') { r.textContent = '🎧 已按「' + (resp.scene || '触达') + '」场景预填，可修改后发送'; r.className = 'pl-result ok'; }
    }
  } catch (e) { /* 预填失败不阻塞，仍可手动「场景话术/AI生成」 */ }
}

// ★ 批量触达（全自动）：只处理【勾选】的通知线索，AI 草拟后自动发送，逐条随机间隔发送
async function batchTouchAuto(container) {
  const ids = Array.from(_selectedIds);
  if (!ids.length) { addLog('⚠️ 未勾选任何线索：请先勾选要触达的人，再点批量触达', 'warn'); return; }
  let leads = _plData.list.filter(p => p && p.id && ids.includes(p.id) && _plBucket(p) === 'notif' && !p.convId && !p.dmBlocked);
  if (!leads.length) { addLog('⚠️ 勾选的人里没有可自动触达的（可能已在会话/受限/非通知桶）', 'warn'); return; }
  if (!window.confirm(`将自动私信以下 ${leads.length} 人：\n${leads.map(l => '· ' + (l.nickname || '未知')).join('\n')}\n\n请确认无 <b>微信/链接</b> 等违规词（请自行确认内容合规），且已登录小红书。`)) return;
  const _s = (ms) => new Promise(r => setTimeout(r, ms));
  setLockBanner(true, 'touchAuto');
  let ok = 0, blocked = 0, fail = 0;
  for (const p of leads) {
    const nick = p.nickname || '未知';
    try {
      // ① 话术优先用「刷新时已存好的 dmDraft」；没有（未走刷新/老数据）才临时 AI 写一次
      let draft = (p.dmDraft || '').trim();
      let via = '刷新已存';
      if (!draft) {
        via = 'AI现写';
        const r = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person: p } });
        draft = ((r && r.ok && r.dmText) || '').trim();
      }
      if (!draft) { fail++; addLog(`⚠️ ${nick}：没有可发送的话术，跳过`, 'warn'); continue; }
      // ② 自动发送（后台导航聊天窗 + 发送）
      const sent = await chrome.runtime.sendMessage({ action: 'sendDm', data: { person: p, text: draft, aiGenerated: true } });
      if (sent && sent.ok) { ok++; addLog(`✉️ 已自动触达 ${nick}（${via}）`, 'success'); }
      else if (sent && sent.limited) { blocked++; addLog(`⛔ ${nick}：私信受限，跳过`, 'warn'); }
      else throw new Error((sent && sent.error) || '发送失败');
    } catch (e) {
      if (e && e.limited) { blocked++; addLog(`⛔ ${nick}：私信受限，跳过`, 'warn'); }
      else { fail++; addLog(`❌ ${nick}：${e.message}`, 'error'); }
    }
    await _s(3000 + Math.random() * 5000); // 逐条随机 3~8 秒，避免连发
  }
  setLockBanner(false, 'touchAuto');
  _selectedIds.clear();
  addLog(`🏁 批量触达完成：成功 ${ok} · 受限 ${blocked} · 失败 ${fail}`, ok > 0 ? 'success' : (fail ? 'error' : 'warn'));
  loadProspectList(container);
}

// 批量触达：仅线索池逐条预填 A 场景话术到私信弹窗，发送或关闭即进入下一位（草拟·确认，无自动）
function batchTouchDraft(list, container) {
  const leads = (list || []).filter(p => p && p.id && _plBucket(p) === 'notif' && !p.convId && !p.dmBlocked);
  if (!leads.length) { addLog('⚠️ 当前没有可触达的线索', 'warn'); return; }
  addLog(`✉️ 开始批量触达 ${leads.length} 条线索（逐条确认，发送或关闭弹窗进入下一位）`, 'info');
  _touchQueue = leads.slice();
  _touchNext();
}
function _touchNext() {
  if (_touchBusy) return; _touchBusy = true;
  let person = null;
  while (_touchQueue.length) {
    const c = _touchQueue.shift();
    if (c && c.id && _plBucket(c) === 'notif' && !c.convId) { person = c; break; }
  }
  if (!person) {
    _touchBatchActive = false;
    addLog('✅ 批量触达结束', 'success');
    const pc = document.getElementById('prospectContent');
    if (pc && pc.style.display !== 'none') loadProspectList(pc);
    _touchBusy = false; return;
  }
  _touchBatchActive = true;
  addLog(`✉️ 触达 @${(person.nickname || '未知')}：请在弹窗确认/修改后发送，关闭或发送即进入下一位`, 'info');
  openDmModal(person);
  touchScenePrefill(person);
  _touchBusy = false;
}
function getPlPerson(id) {
  return _plData.list.find(p => p.id === id) || null;
}

/* ─── 版本 / 授权控制 ─── */
let _editionCache = null;

/** 获取版本状态（带缓存），失败时返回 null */
async function getEditionStatus() {
  if (_editionCache) return _editionCache;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'getEdition' });
    if (resp && resp.edition) { _editionCache = resp; return resp; }
  } catch (e) {
    console.warn('[版本] 获取版本状态失败:', e);
  }
  return null;
}

/** 判断某功能在当前版本是否可用（默认放行，避免消息失败误锁） */
function editionFeatureOn(name) {
  if (!_editionCache || !_editionCache.edition || !_editionCache.edition.features) return true;
  return !!_editionCache.edition.features[name];
}

/** 显示到期锁定全屏遮罩，锁死所有操作 */
function showExpiredMask(edition) {
  if (document.getElementById('editionExpiredMask')) return;
  const licensee = (edition && edition.licensee) ? ('（授权：' + esc(edition.licensee) + '）') : '';
  const mask = document.createElement('div');
  mask.id = 'editionExpiredMask';
  mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(30,30,30,0.94);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
  mask.innerHTML = `
    <div style="font-size:44px;margin-bottom:12px;">⛔</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:8px;">授权已到期</div>
    <div style="font-size:13px;color:#ddd;line-height:1.7;max-width:280px;">
      当前版本使用期限已结束${licensee}，功能已锁定。<br>如需继续使用，请联系服务商续期或获取新版本。
    </div>`;
  document.body.appendChild(mask);
}

/** 显示无网络锁定遮罩（无法获取网络时间，安全策略锁定） */
function showNoNetworkMask() {
  if (document.getElementById('editionExpiredMask')) return;
  const mask = document.createElement('div');
  mask.id = 'editionExpiredMask';
  mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(30,30,30,0.94);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
  mask.innerHTML = `
    <div style="font-size:44px;margin-bottom:12px;">🌐</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:8px;">无法连接网络</div>
    <div style="font-size:13px;color:#ddd;line-height:1.7;max-width:280px;">
      本插件需要联网运行以验证授权状态。<br>请检查网络连接后重试。
    </div>`;
  document.body.appendChild(mask);
}

/** 在顶栏状态徽标上展示版本与剩余天数 */
function renderEditionBadge(status) {
  const ed = status && status.edition; if (!ed) return;
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  let txt = ed.label || '';
  if (!ed.neverExpires) {
    const d = status.remainingDays;
    if (typeof d === 'number') txt += d <= 0 ? '｜今天到期' : `｜剩${d}天`;
  }
  badge.textContent = txt || '就绪';
  const bound = ed.boundAccount || {};
  const bindTxt = bound.xhsId ? (bound.name ? `｜绑定：${bound.xhsId}（${bound.name}）` : `｜绑定：${bound.xhsId}`) : '';
  badge.title = (ed.licensee ? ('授权：' + ed.licensee) : '') + bindTxt;
}

/** 账号绑定校验与展示（绑定版）：顶栏提示绑定号；校验不过则全屏锁定 */
async function applyAccountBindToPopup() {
  try {
    const st = await getEditionStatus();
    if (!st || !st.edition || !st.edition.hasBinding) return;
    const bound = st.edition.boundAccount || { xhsId: '', name: '' };
    const badge = document.getElementById('statusBadge');
    if (badge) {
      badge.title = (badge.title || '') + (bound.name ? `｜绑定：${bound.xhsId}（${bound.name}）` : `｜绑定：${bound.xhsId}`);
    }
    let r = null;
    try { r = await chrome.runtime.sendMessage({ action: 'accountGuarantee' }); } catch (_) {}
    const ok = !!(r && r.ok);
    const badgeEl = document.getElementById('statusBadge');
    if (badgeEl && ok) {
      badgeEl.textContent = (badgeEl.textContent || '') + ' ✓';
    }
    if (!ok && !_acctVerifiedInSession && !document.getElementById('accountLockBanner')) {
      const reason = (r && r.reason) || '账号不匹配';
      const b = document.createElement('div');
      b.id = 'accountLockBanner';
      b.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(30,30,30,0.95);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
      b.innerHTML = `
        <div style="font-size:44px;margin-bottom:12px;">🔒</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px;">账号校验未通过</div>
        <div style="font-size:13px;color:#ddd;line-height:1.9;max-width:330px;">
          本工具已绑定小红书号「${esc(bound.xhsId || '')}」，仅该账号可使用。<br>
          ${esc(reason)}<br>
          打开你自己的小红书「我的」主页，保持网页打开，然后回来点下方按钮。<br>
          <span id="acctPopVerifyMsg" style="display:block;color:#ffd666;margin-top:6px;min-height:18px;font-size:12px;"></span>
        </div>
        <div style="margin-top:16px;display:flex;gap:10px;">
          <button id="acctPopVerifyBtn" onclick="verifyAccountNow()" style="padding:9px 20px;border:none;border-radius:8px;background:#ff274b;color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:transform .08s ease, background-color .15s ease, opacity .2s ease;box-shadow:0 2px 6px rgba(255,39,75,.35);">立即验证</button>
          <button onclick="document.getElementById('accountLockBanner').remove()" style="padding:9px 16px;border:1px solid #555;border-radius:8px;background:transparent;color:#bbb;font-size:14px;cursor:pointer;">知道了</button>
        </div>
        <style>
          #acctPopVerifyBtn:active{ transform:scale(.93); }
          #acctPopVerifyBtn[data-loading="1"]{ opacity:.75; cursor:wait; }
          @keyframes acctSpin{ to{ transform:rotate(360deg);} }
          .acct-spinner{ display:inline-block; width:14px; height:14px; margin-right:6px; vertical-align:-2px; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:acctSpin .7s linear infinite; }
          #acctPopVerifyMsg{ transition:opacity .15s ease; }
        </style>`;
      document.body.appendChild(b);
    }
  } catch (_) {}
}

/** 监听账号校验缓存变化：在其它入口(设置/向导)验证通过后，本弹窗立即解锁，无需重开 */
function wireAccountGuardWatcher() {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes['_acct_guard']) return;
      const v = changes['_acct_guard'].newValue;
      if (v && v.matched) {
        _acctVerifiedInSession = true;
        const b = document.getElementById('accountLockBanner'); if (b) b.remove();
        const msg = document.getElementById('acctPopVerifyMsg'); if (msg) msg.textContent = '';
        if (typeof ensureFirstSetup === 'function') ensureFirstSetup(); // 验证通过且缺 AI → 直接在 popup 展示首次设置
        if (typeof applyAccountBindToPopup === 'function') applyAccountBindToPopup();
      }
    });
  } catch (_) {}
}

/** 弹窗锁定遮罩的“立即验证”：主动请求 background 探测当前小红书的打开页面实时校验 */
async function verifyAccountNow() {
  const btn = document.getElementById('acctPopVerifyBtn');
  const msg = document.getElementById('acctPopVerifyMsg');
  if (msg) { msg.textContent = ''; msg.style.color = '#ffd666'; }
  if (btn) {
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn.innerHTML = '<span class="acct-spinner"></span>验证中…';
  }
  const t0 = Date.now();
  let r = null;
  try { r = await chrome.runtime.sendMessage({ action: 'accountGuarantee', forceNow: true }); } catch (e) { r = null; }
  const wait = Math.max(0, 750 - (Date.now() - t0)); // 至少展示 0.75s，别点完一闪而过
  await new Promise(res => setTimeout(res, wait));
  if (r && r.ok) {
    _acctVerifiedInSession = true;
    if (typeof ensureFirstSetup === 'function') ensureFirstSetup(); // 验证通过且缺 AI → 直接在 popup 展示首次设置
    if (msg) { msg.textContent = '✅ 验证通过，已解锁'; msg.style.color = '#7bd88f'; }
    if (btn) { btn.dataset.loading = '0'; btn.disabled = false; btn.innerHTML = '✓ 已通过'; }
    setTimeout(() => {
      const banner = document.getElementById('accountLockBanner');
      if (banner) banner.remove();
    }, 500);
    return;
  }
  if (btn) {
    btn.dataset.loading = '0';
    btn.disabled = false;
    btn.innerHTML = '重新验证';
  }
  if (msg) { msg.textContent = '❌ ' + ((r && r.reason) || '验证失败，请确认已在网页版登录绑定账号并打开本人主页后重试'); msg.style.color = '#ffb3c1'; }
}

/** 应用版本限制：到期锁定 + 按功能开关灰显并标注受限功能（不隐藏，让用户知道升级可解锁） */
async function applyEditionToPopup() {
  const status = await getEditionStatus();
  if (!status || !status.edition) return; // 拿不到就放行（dev 或消息异常）
  const ed = status.edition;
  // 1) 无网络锁定
  if (status.noNetwork) { showNoNetworkMask(); return; }
  // 2) 到期锁定
  if (status.expired) { showExpiredMask(ed); return; }
  // 3) 顶栏展示版本
  renderEditionBadge(status);
  // 3.5) 账号绑定（绑定版）：校验当前登录账号
  applyAccountBindToPopup();
  // 4) 批量发送（自动评论）——未开通时灰显锁定 ▾ 下拉入口
  if (!ed.features || !ed.features.batchSend) {
    const btn = document.getElementById('commentCaret');
    if (btn) {
      btn.disabled = true;
      btn.dataset.locked = '1';
      btn.style.opacity = '0.45';
      btn.style.cursor = 'not-allowed';
      btn.style.filter = 'grayscale(1)';
      btn.title = '当前版本（' + (ed.label || '') + '）不含整页批量发送，仅支持逐条一键发送；升级更高版本解锁';
    }
  }
  // 4) 租户切换器：三档全开（tenant 恒为 true），不再做灰显锁定
  // 5) 一键灌水笔记列表（左侧面板依赖灌水功能）——未开通时直接隐藏整个笔记列表，右侧评论助手占满窗口自适应
  if (!ed.features || !ed.features.autoWater) {
    const panelLeft = document.getElementById('panelLeft');
    const divider = document.getElementById('divider');
    if (panelLeft) panelLeft.style.display = 'none';
    if (divider) divider.style.display = 'none';
    document.getElementById('tabWaterSummary')?.remove(); // 灌水总结随灌水一起：无灌水则无总结可看
  }
  // 6) 通知/消息——非开通版本隐藏一级 tab
  if (!ed.features || !ed.features.prospectList) {
    ['tabNotifGroup', 'tabMsgGroup', 'tabNotifConfig', 'tabAiCsQa'].forEach(id => document.getElementById(id)?.remove());
    const _subT2 = document.getElementById('subTabs2'); if (_subT2) _subT2.style.display = 'none';
    const _subT3 = document.getElementById('subTabs3'); if (_subT3) _subT3.style.display = 'none';
    const _scanSel = document.getElementById('plScanFreq2'); // 🤖 自动扫频率（依赖通知/消息的自动扫）
    if (_scanSel && _scanSel.parentElement) _scanSel.parentElement.style.display = 'none';
  }
  // 7) 发笔记——未开通版本隐藏 tab 按钮
  if (!ed.features || !ed.features.notePublish) {
    document.getElementById('tabNotePublish')?.remove();
  }
}

/* ─── 租户切换器（顶部下拉框）─── */
async function initTenantSwitcher() {
  const sel = document.getElementById('tenantSwitcher');
  if (!sel) return;
  if (sel.dataset.locked === '1') return; // 版本限制已锁定，不再填充租户列表
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'listTenants' });
    const tenants = (resp && resp.tenants) || [];
    const currentId = resp && resp.currentId;
    sel.innerHTML = '';
    tenants.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (t.id === currentId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.dataset.current = currentId || '';
  } catch (e) {
    console.warn('[租户] 加载列表失败:', e);
  }
  sel.onchange = async () => {
    const id = sel.value;
    if (!id || id === sel.dataset.current) return;
    sel.disabled = true;
    addLog('🏢 正在切换租户…', 'info');
    try {
      const r = await chrome.runtime.sendMessage({ action: 'switchTenant', data: { id } });
      if (r && r.ok !== false) {
        // 切换后整个数据集都变了，直接重载弹窗最干净（重跑 startup + 左侧面板）
        location.reload();
      } else {
        throw new Error(r && r.error || '切换失败');
      }
    } catch (e) {
      addLog('❌ 切换租户失败：' + (e.message || e), 'error');
      sel.value = sel.dataset.current || '';
      sel.disabled = false;
    }
  };
}

// ★ 驱动网页上那条红色状态栏（内容脚本在小红书页里），让它反映 AI 分析/已完成
//   这些发生在 popup/background、内容脚本本身不知道的阶段。
async function _setTabStatusBar(text) {
  try {
    const t = await getTargetTab();
    if (t && t.id != null) await chrome.tabs.sendMessage(t.id, { action: 'setStatusBar', text });
  } catch (_) {}
}
async function _finishTabStatusBar() {
  try {
    const t = await getTargetTab();
    if (t && t.id != null) await chrome.tabs.sendMessage(t.id, { action: 'finishStatusBar' });
  } catch (_) {}
}
// ★ 评论加载完 → 跳回助手窗口（只有从笔记列表“打开”触发才会跳，手动刷新不跳）。
//   _focus_restore 只由 openNote 设置。
async function _restorePopupFocus() {
  try {
    const _fd = await chrome.storage.local.get('_focus_restore');
    const fr = _fd['_focus_restore'];
    if (fr && (Date.now() - (fr.ts || 0) < 120000)) {
      try {
        const selfWin = await chrome.windows.getCurrent();
        if (selfWin && selfWin.id != null) {
          await chrome.windows.update(selfWin.id, { focused: true, drawAttention: true });
        }
      } catch (_) {}
      addLog('↩️ 评论已加载完成，已切回助手窗口', 'info');
    }
    if (fr) { try { await chrome.storage.local.remove('_focus_restore'); } catch (_) {} }
  } catch (_) {}
}

async function startup() {
  hideEmpty();
  setStatus('检查 AI 配置...', '');

  // 通过 background.js 检查 AI 配置
  let configOk = false;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'checkConfig' });
    configOk = resp?.configured === true;
  } catch (_) {}

  if (!configOk) {
    setBadge('未配置 AI', 'offline');
    setStatus('⚠️ 请先配置 API Key', 'error');
    showEmpty('请先点击 <b>⚙️ 设置</b> 配置 API Key 和产品名称后再使用');
    return;
  }
  setBadge('AI 就绪', '');

  const tab = await getTargetTab();
  if (!tab || !tab.url || !tab.url.includes('xiaohongshu.com')) {
    hideStatus();
    showEmpty();
    return;
  }

  setStatus('提取页面评论...', '');
  addLog('📄 正在提取页面评论...', 'info');

  // ── 页面类型守卫 + 自愈重试 ──
  // 有时小红书会在笔记详情页里瞬时灌入列表/卡片内容（或 SPA 还没切完），
  // 守卫抓到"页面不对"时不再直接放弃：停掉本次 → 停顿 → 返回并重新打开笔记 → 再扫描。
  // 中间刻意加入随机停顿，让节奏更自然。
  const isNoteUrl = (u) => /xiaohongshu\.com\/(explore|discovery\/item)\//.test(u || '');
  const initialUrl = tab.url || '';
  const curNoteId = _noteIdFromUrl(initialUrl);
  _scanDoneFired = false;               // 每开一篇：重置"已发完成信号"标记
  _scanCurNoteId = curNoteId || _scanCurNoteId;
  startScanHeartbeat(curNoteId);               // ★ 扫描心跳开始（此时 curNoteId 已定义；必须放这，别放前面造成 TDZ 引用报错）
  // ★ 先拿搜索抛到的笔记列表当“对照表”（可能为空），用来精确识别背景信息流卡片
  const foundNotes = await loadFoundNotes();
  // ★ [debug] 无论有没有对照表都打一行，方便定位卡点：能看到 tab/当前URL/笔记列表数
  addLog(`🔎 [debug] 准备扫描：tab=${tab.id} noteId=${curNoteId || '无'} url=${String(initialUrl || '').slice(0, 42)} 对照表=${foundNotes.length} 条`, 'info');
  if (foundNotes.length > 0) {
    addLog(`🗂️ 已加载搜索抛到的 ${foundNotes.length} 条笔记列表，将用它交叉核对、剔除被当成评论的卡片`, 'info');
  }
  const MAX_TRY = 3;
  let result = null;
  // ★ 整体扫描预算：即使 content.js 一直不响应/自愈反复重开，整段"提取评论"也最多花 90s，
  //   到点立即收尾广播，避免无限卡在"提取页面评论"（配合上方各 content 调用的超时形成双保险）。
  const extractDeadline = Date.now() + 90000;

  for (let attempt = 1; attempt <= MAX_TRY; attempt++) {
    if (Date.now() > extractDeadline) {
      addLog('⏱ 评论提取超时（90s），跳过本篇避免卡住', 'warn');
      break;
    }
    // ★ 第一步：轻量页面类型预检（不滚动、不采集）。错页立刻走自愈重试，省掉白滚一轮评论区的时间
    let pre = null;
    addLog(`→ 预检页面类型（等 content.js 响应，上限 20s）…`, 'info');
    try {
      pre = await sendTabMessageWithTimeout(tab.id, { action: 'checkPageType' }, 20000);
      addLog(`→ 预检返回：${pre ? (pre.notNotePage ? ('非笔记页(卡片×' + pre.cardLinkCount + ')') : '是笔记页(可滚动)') : '无结果'}`, 'info');
    } catch (e) {
      // content.js 尚未注入 → 注入后再查
      addLog(`→ content 未响应（${e && e.message ? e.message : '超时'}），尝试注入 content.js…`, 'warn');
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await sleep(400);
        pre = await sendTabMessageWithTimeout(tab.id, { action: 'checkPageType' }, 20000);
        addLog(`→ 注入后预检返回：${pre ? (pre.notNotePage ? '非笔记页' : '是笔记页') : '仍无结果'}`, 'info');
      } catch (_e2) {
        addLog(`→ ⚠️ 注入 content.js 仍失败/超时（${_e2 && _e2.message ? _e2.message : '未知'}）`, 'error');
      }
    }
  
    let badPage = false;
    if (pre && pre.notNotePage) {
      // 预检就发现不是笔记详情页 → 不滚动不提取，直接进入下方自愈重试
      addLog(`⚠️ 预检：当前不是笔记详情页（卡片×${pre.cardLinkCount || 0}），跳过滚动采集，直接重试`, 'warn');
      result = { _notNotePage: true, _cardLinkCount: pre.cardLinkCount || 0, comments: [] };
      badPage = true;
    } else {
      // ★ 第二步：页面类型没问题，才滚动评论区多翻几屏、展开更多回复
      // （loadMoreComments 是页面侧滚完、DOM 稳定后才返回的，这里 await 保证“滚完才采集”）
      try {
        addLog(`📜 正在多翻几页、加载更多评论...（第 ${attempt}/${MAX_TRY} 次）`, 'info');
        const loadResult = await sendTabMessageWithTimeout(tab.id, { action: 'loadMoreComments', maxRounds: 3 }, 45000);
        if (loadResult?.success) {
          addLog(`📜 评论加载完成，页面共约 ${loadResult.commentCount || '?'} 条`, 'success');
        } else if (loadResult?.notNotePage) {
          addLog('⚠️ 页面没有“评论”标记，疑似外页/信息流，已跳过滚动加载（交给自愈重试）', 'warn');
        }
      } catch (_) {
        // content.js 尚未注入时忽略，下面 extract 会兜底重试注入
      }
  
      // ★ 第三步：滚动结束后才提取（上一步 await 已保证顺序）
      result = null;
      addLog(`→ 开始抓取评论（extract，上限 40s）…`, 'info');
      try {
        result = await sendTabMessageWithTimeout(tab.id, { action: 'extract' }, 40000);
      } catch (e) {
        addLog(`→ extract 未响应（${e && e.message ? e.message : '超时'}），尝试注入 content.js…`, 'warn');
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          await sleep(400);
          result = await sendTabMessageWithTimeout(tab.id, { action: 'extract' }, 40000);
        } catch (e2) {
          addLog(`→ ⚠️ 注入后 extract 仍失败/超时（${e2 && e2.message ? e2.message : '未知'}）`, 'error');
        }
      }
      if (result && Array.isArray(result.comments)) {
        addLog(`→ extract 返回 ${result.comments.length} 条（候选${result._sourceLabel ? '/' + result._sourceLabel : ''}）`, 'info');
      } else {
        addLog(`→ ⚠️ extract 无结果（result=${result ? Object.keys(result).join(',') : 'null'}）`, 'warn');
      }
  
      // ★ 第四步：用搜索列表交叉核对：看这次抓到的“评论”里有多少其实是背景信息流卡片
      // （预检只能拦“整页都不对”，拦不住“详情页里瞬时灌入信息流”，所以这道校验仍保留）
      let feedDetected = false;
      if (result && Array.isArray(result.comments) && result.comments.length > 0) {
        const cc = crossCheckComments(result.comments, foundNotes, curNoteId);
        if (cc.removed.length > 0) {
          addLog(`🧭 交叉核对：${cc.removed.length}/${result.comments.length} 条“评论”命中笔记列表（作者/点赞数/标题都对得上），它们是背景卡片而非真评论，已剔除`, 'warn');
          result.comments = cc.kept;
          // 剔除后真评论所剩无几（或剔掉的占绝大多数）→ 判定抓到的是信息流
          if (cc.kept.length < 2 || cc.removed.length >= (cc.removed.length + cc.kept.length) * 0.6) {
            feedDetected = true;
          }
        }
      }
  
      // 对"页面类型不对"（抓到卡片而非评论）或交叉核对判定为信息流 → 触发自愈重试
      badPage = !!(result && result._notNotePage) || feedDetected;
    }
    if (!badPage) break;
    if (attempt >= MAX_TRY) break; // 用完次数，交给下面的守卫统一报错

    // 找出要重新打开的笔记 URL（当前页或进入时的 URL，只要它像笔记页）
    const curTab = await getTargetTab();
    const targetUrl = isNoteUrl(curTab?.url) ? curTab.url
                    : (isNoteUrl(initialUrl) ? initialUrl : null);
    if (!curTab || !targetUrl) break; // URL 本身就不是笔记页，无法自动恢复

    addLog(`⚠️ 检测到抓的是笔记卡片/背景信息流而非评论，停掉本次，返回后重新打开笔记重试`, 'warn');

    // 1) 返回上一页（先退出再重试），停顿时长读设置页「停留时间」配置（技术下限 300ms）
    const backWait = await getDwellMs('retryBackWait', 300);
    setStatus(`⚠️ 页面内容异常，正在返回…（第 ${attempt}/${MAX_TRY} 次重试）`, 'warn');
    try { await chrome.tabs.sendMessage(curTab.id, { action: 'goBack' }); } catch (_) {}
    await sleep(backWait);

    // 2) 重新打开这篇笔记，等 SPA/页面加载（技术下限 800ms），再进入下一轮扫描
    const openWait = await getDwellMs('retryOpenWait', 800);
    setStatus(`⚠️ 正在重新打开笔记，约 ${Math.round(openWait / 1000)} 秒后重新扫描…`, 'warn');
    try { await chrome.tabs.update(curTab.id, { url: targetUrl }); } catch (_) {}
    await sleep(openWait);
  }

  // ★ 评论加载/重试循环已结束 → 立刻跳回助手窗口，让用户看到接下来的 AI 分析（而不是干等）
  await _restorePopupFocus();

  // ★ 页面类型守卫：重试后仍不是笔记详情页 → 拦住，不把卡片当评论喂给 AI
  if (result && result._notNotePage) {
    await _finishTabStatusBar();
    setStatus('⚠️ 请先点开一篇笔记再扫描', 'error');
    showEmpty('多次返回重开后仍抓到<b>笔记卡片</b>而不是评论。<br>请手动点开具体的<b>一篇笔记详情页</b>（能看到评论区）再点扫描。');
    addLog(`⚠️ 重试 ${MAX_TRY} 次后仍不是笔记详情页（卡片×${result._cardLinkCount || 0}），已阻止把卡片当评论发给 AI`, 'warn');
    broadcastAiScanDone(false); // ★ 页面类型不对，本篇作废，通知机器人返回列表
    return;
  }

  if (!result || !result.comments || result.comments.length === 0) {
    await _finishTabStatusBar();
    setStatus('⚠️ 未找到评论，请确认在笔记页面', 'error');
    showEmpty('未找到评论，请确认在<b>笔记详情页</b>（不是首页或搜索页）');
    broadcastAiScanDone(false); // ★ 本篇无评论，通知机器人返回列表
    return;
  }

  // 使用候选2（索引1），若有
  const candidates = result._candidates || [];
  if (candidates.length >= 2 && candidates[1].comments.length > 0) {
    pageData = { ...result };
    pageData.comments = candidates[1].comments;
    pageData.threads = extractThreadsSafe(candidates[1].comments);
    // 标记候选来源
    pageData._sourceLabel = candidates[1].label || '候选2';
  } else {
    pageData = result;
    pageData._sourceLabel = '默认';
  }

  showNoteInfo(pageData);
  hideStatus();

  // ★ 防重复灌水：若笔记里已有“我的名字”的评论 → 直接判定已灌水、跳过 AI、记入清单
  try {
    const myComment = await findMyCommentInNote(pageData.comments || []);
    if (myComment) {
      if (forceRescan) {
        // 循环计划：不拦截、不标记已灌水，只把自己这条评论记入已回复记录（防重扫时当商机）
        try { await addLocalReply(pageData.url || '', myComment.author || '', myComment.content || ''); } catch (_) {}
      } else {
        addLog(`✅ 发现本篇已有你的评论（@${esc(myComment.author)}），判定为已灌水，跳过 AI 分析`, 'success');
        await markNoteWateredBySelf(pageData.url || '', myComment);
        await _finishTabStatusBar();
        broadcastAiScanDone(false); // ★ 本篇已有自己的评论，跳过分析，通知机器人返回列表
        return;
      }
    }
  } catch (e) {
    console.warn('[防重复] 检查自己评论异常:', e);
  }

  // 自动开始商机挖掘
  setStatus('<span class="loading-spinner"></span> AI 正在扫描评论，挖掘潜在客户...', '');
  addLog('🔍 开始商机挖掘...', 'info');
  await loadProspecting(document.getElementById('mainContent'));
}

// ========== 刷新 ==========
/** 判断当前标签页是否是笔记内容页（含笔记详情浮层/侧滑窗，URL 不一定变） */
async function isNotePage() {
  try {
    const tab = await getTargetTab();
    if (!tab || !tab.url) return false;
    // 笔记页 URL 格式：xiaohongshu.com/explore/{noteId}（/discovery/item/ 也是笔记详情）
    if (/xiaohongshu\.com\/(explore|discovery\/item)\//.test(tab.url)) return true;

    // ★ 小红书打开笔记常用“详情浮层/侧滑窗”，背景 URL 仍是搜索/信息流页、不跳转。
    //   单看 URL 会误判成“不是笔记页”而跳过刷新。这里问 content 脚本（与扫描器同口径，
    //   能识别浮层里的回复框/评论区滚动容器），确认确实是笔记内容页才算数。
    if (!/xiaohongshu\.com/.test(tab.url)) return false;
    try {
      const resp = await sendTabMessageWithTimeout(tab.id, { action: 'checkPageType' }, 3000);
      if (resp && resp.success) return resp.notNotePage === false;
      return false;
    } catch (_) { return false; }
  } catch (_) {
    return false;
  }
}

async function refreshData() {
  // ★ 循环计划强制模式：一次性标志在函数最开头读取并立即清除——
  //   中途任何提前 return（非笔记页/无评论等）都不会残留，影响下次手动操作
  const forceRescan = !!window.__forceRescan;
  window.__forceRescan = false;
  // ★ 记住"这是否自动模式/机器人带跑的扫描"：整篇处理期间持续有效。
  //   抓取异常等"单篇结单"时，据此让 popup 走"跳过本篇"而非弹红色打断界面。
  _lastScanWasAuto = forceRescan;

  // 开关：只有当前页面是笔记内容页才刷新
  const onNotePage = await isNotePage();
  if (!onNotePage) {
    addLog('⚠️ 当前页面不是笔记内容页，跳过刷新', 'warn');
    return;
  }

  addLog('🔄 刷新笔记...', 'info');

  // 屏蔽自动灌水和自动评论按钮
  const caretBtn = document.getElementById('commentCaret');
  const botBtn = document.getElementById('botToggleBtn');
  if (caretBtn) { caretBtn.disabled = true; caretBtn.style.opacity = '0.5'; }
  if (botBtn) { botBtn.disabled = true; botBtn.style.opacity = '0.5'; }

  const btn = document.getElementById('refreshBtn');
  btn.textContent = '⏳';
  btn.disabled = true;
  btn.style.opacity = '0.5';
  pageData = null;
  hideEmpty();
  document.getElementById('noteInfo').style.display = 'none';
  // 从持久化存储加载已灌水记录（而不是清空）
  const wateredUrls = await loadWateredNoteUrls();
  _wateredSet = new Set();
  for (const url of wateredUrls) {
    _wateredSet.add(url);
  }
  let _scanErr = null;
  try {
    await startup();
  } catch (e) {
    _scanErr = e;
  }
  btn.textContent = '🔄 评论刷新';
  btn.disabled = false;
  btn.style.opacity = '1';

  // ★ 跳回助手窗口已前移到 startup() 内部（评论加载完、AI 分析前就跳）：_restorePopupFocus()。
  //   这里只做兜底清理：startup 提前 return/抛异常时，把残留的 _focus_restore 标记清掉，
  //   避免下次手动刷新被误判为“从列表打开”而乱跳。
  try { await chrome.storage.local.remove('_focus_restore'); } catch (_) {}

  // 释放自动灌水和自动评论按钮
  if (caretBtn) { caretBtn.disabled = false; caretBtn.style.opacity = '1'; }
  if (botBtn) { botBtn.disabled = false; botBtn.style.opacity = '1'; }

  // ★ 兜底：扫描期间任何异常都要显式报出来 + 广播放行，绝不许"崩了但看起来像卡住"
  if (_scanErr) {
    console.error('[刷新] 扫描异常:', _scanErr);
    addLog('❌ 扫描中止：' + (_scanErr.message || String(_scanErr)), 'error');
    setStatus('❌ 扫描出错：' + String(_scanErr.message || _scanErr).slice(0, 60), 'error');
    broadcastAiScanDone(false);
  }
}
/** 刷新评论助手（供左侧面板打开笔记后调用） */
window.refreshCommentAssistant = refreshData;
/** 查询已灌水笔记 URL 集合（供左侧面板调用） */
window.getWateredNoteUrls = loadWateredNoteUrls;

// ========== 批量串行发送 ==========
// ★ 是否正在“自动批量发送”（自动评论）：决定发送时是否走自然节奏。
//   true=批量/自动（节奏放慢）；false=手动逐条一键发送（快速，不磨蹭）
let _batchSending = false;

// 互动行为配置（设置页「⏱️ 停留时间」Tab 的「🤝 互动行为」区，存 behavior_config）：
// autoFollow：发评论前是否自动关注（默认开，保持既有行为）；followEvery：批量时每隔几条关注一次（1=每条）
async function getBehaviorConfig() {
  try {
    const r = await chrome.storage.local.get('behavior_config');
    return { autoFollow: true, followEvery: 1, ...(r.behavior_config || {}) };
  } catch (_) {
    return { autoFollow: true, followEvery: 1 };
  }
}

async function batchSendAll() {
  // 版本闸门：未开通不含整页批量发送（按钮已灰显，这里双保险）
  if (!editionFeatureOn('batchSend')) {
    addLog('🔒 当前版本不支持整页批量发送，请逐条使用「一键发送」；升级更高版本可解锁', 'warn');
    return;
  }
  const caretBtn = document.getElementById('commentCaret');
  const refreshBtn = document.getElementById('refreshBtn');
  const sendBtns = Array.from(document.querySelectorAll('.send-btn:not(.watered)'));

  if (sendBtns.length === 0) {
    addLog('⚠️ 没有待发送的评论（已全部灌水或无商机）', 'warn');
    return;
  }

  addLog(`📤 开始批量发送，共 ${sendBtns.length} 条评论`, 'info');
  // ★ 标记“自动批量发送中”：只有自动发送才走自然节奏（浏览停留 + 逐字输入）；
  //   手动逐条点“一键发送”不需要这些，走快速通道
  _batchSending = true;
  if (caretBtn) { caretBtn.disabled = true; caretBtn.style.opacity = '0.5'; }
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.style.opacity = '0.5'; }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < sendBtns.length; i++) {
    const btn = sendBtns[i];
    const author = btn.dataset.author || '未知';

    // 重新检查按钮状态（可能已被其他逻辑处理）
    if (btn.classList.contains('watered') || btn.disabled) {
      addLog(`⏭ @${author} 已灌水，跳过`, 'info');
      continue;
    }

    addLog(`📤 [${i + 1}/${sendBtns.length}] 发送给 @${author}...`, 'info');

    // ★ 等这条评论“处理完毕”（成功或失败都会置 data-send-done）；
    // 失败时能立刻推进下一条，不再因为等 .watered 而干等 120 秒
    btn.removeAttribute('data-send-done'); // 清掉上一轮可能残留的标记
    const donePromise = new Promise((resolve) => {
      if (btn.dataset.sendDone || btn.classList.contains('watered')) { resolve(); return; }
      const timer = setTimeout(() => { obs.disconnect(); resolve(); }, 150000); // 终极兵底，正常不会触发
      const obs = new MutationObserver(() => {
        if (btn.dataset.sendDone || btn.classList.contains('watered')) {
          clearTimeout(timer);
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(btn, { attributes: true, attributeFilter: ['class', 'data-send-done'] });
    });

    // 点击发送按钮
    btn.click();

    await donePromise;
    // 以 .watered 为准判定成功/失败
    if (btn.classList.contains('watered')) {
      addLog(`✅ @${author} 发送成功`, 'success');
      successCount++;
    } else {
      addLog(`⚠️ @${author} 发送失败，继续下一个`, 'warn');
      failCount++;
    }

    // ★ 批量条间发送间隔：随机 3~8 秒（用户要求；手动逐条发送不加此间隔）
    if (i < sendBtns.length - 1) {
      const gap = 3000 + Math.floor(Math.random() * 5000);
      addLog(`⏸ 发送间隔：停 ${(gap / 1000).toFixed(1)}s 再发下一条...`, 'info');
      await sleep(gap);
    }
  }

  addLog(`🏁 批量发送完成：成功 ${successCount} 条，失败 ${failCount} 条`, successCount > 0 ? 'success' : 'warn');

  _batchSending = false; // ★ 批量结束，恢复手动快速通道
  if (caretBtn) { caretBtn.disabled = false; caretBtn.style.opacity = '1'; }
  if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.style.opacity = '1'; }
}

// ========== 评论跟进（通知页对话回复） ==========
// ★ 用户核心要求：把时间戳平铺的通知流按用户组装成对话上下文给 AI；保存待回复消息的定位，绝不回错人/回错消息。
//   流程：extractNotifications（content.js 提取，含 idx 定位）→ chatFollowSync（background 组装+落库）
//        → chatFollowReply（AI 生成）→ replyNotification（content.js 三重定位发送）→ chatFollowMarkSent（落库防重）

// 获取当前活动标签页，并确认是通知页
async function _ensureNotificationTab() {
  const tab = await getTargetTab();
  if (!tab || !tab.id) return null;
  if (!(tab.url && tab.url.includes('/notification'))) return null;
  return tab;
}

// 同步通知页：提取 → background 组装落库 → 返回会话列表
async function chatFollowSync() {
  const tab = await _ensureNotificationTab();
  if (!tab) return null;
  addLog('🔄 同步通知页：提取通知流...', 'info');
  let extractResp = null;
  try {
    extractResp = await chrome.tabs.sendMessage(tab.id, { action: 'extractNotifications' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await sleep(400);
      extractResp = await chrome.tabs.sendMessage(tab.id, { action: 'extractNotifications' });
    } catch (_) {}
  }
  if (!extractResp || !extractResp.success) {
    throw new Error((extractResp && extractResp.error) || '提取通知失败（页面可能未加载完成）');
  }
  addLog(`📥 提取到 ${extractResp.count} 条通知，正在按用户组装对话...`, 'info');
  const bgResp = await chrome.runtime.sendMessage({ action: 'chatFollowSync', data: { items: extractResp.items } });
  if (!bgResp || !bgResp.ok) {
    throw new Error((bgResp && bgResp.error) || '会话组装失败');
  }
  const convs = bgResp.conversations || [];
  const pendingCount = convs.filter(c => c.needReply).length;
  addLog(`✅ 组装完成：${convs.length} 个会话（其中 ${pendingCount} 条待回复）`, pendingCount > 0 ? 'success' : 'info');

  // ★ 顺带收集"赞了我们内容/评论"的人（点赞户）→ 自动入库（点赞户可直接发销售资料）
  try {
    const lk = await chrome.tabs.sendMessage(tab.id, { action: 'collectLikers' });
    if (lk && lk.success && (lk.items || []).length) {
      const lr = await chrome.runtime.sendMessage({ action: 'collectLikers', data: { items: lk.items } });
      const addN = (lr && lr.added) ? lr.added : 0;
      const alN = (lr && lr.already) ? lr.already : 0;
      addLog(`🤍 顺带收录点赞户 ${lk.items.length} 人（新增 ${addN} / 已存在 ${alN}）`, addN > 0 ? 'success' : 'info');
    }
  } catch (_) {}

  return { conversations: convs, pendingCount };
}

// 主视图：同步 + 渲染会话卡片
async function loadChatFollow(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
  document.getElementById('noteInfo').style.display = 'none';
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'padding:20px;text-align:center;color:#666;';
  loadingDiv.innerHTML = '<div class="loading-spinner" style="margin:0 auto 8px;"></div><div>同步通知页（提取+组装对话）...</div>';
  container.appendChild(loadingDiv);

  let data = null;
  try {
    data = await chatFollowSync();
  } catch (e) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const errDiv = document.createElement('div');
    errDiv.className = 'empty-prospect';
    errDiv.innerHTML = `<div style="font-size:28px;margin-bottom:10px;">⚠️</div>
      <div style="font-size:14px;color:#c62828;margin-bottom:6px;font-weight:500;">${esc(e.message)}</div>
      <div style="font-size:12px;color:#555;line-height:1.6;">请打开 <strong>https://www.xiaohongshu.com/notification</strong> 后重试</div>
      <button id="retryChatFollowBtn" class="retry-btn">🔄 重试同步</button>`;
    container.appendChild(errDiv);
    document.getElementById('retryChatFollowBtn')?.addEventListener('click', () => loadChatFollow(container));
    setStatus('⚠️ AI客服同步失败', 'error');
    return;
  }
  if (!data) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-prospect';
    emptyDiv.innerHTML = `<div style="font-size:28px;margin-bottom:10px;">📍</div>
      <div style="font-size:14px;color:#333;margin-bottom:6px;font-weight:500;">请先打开小红书通知页</div>
      <div style="font-size:12px;color:#555;line-height:1.6;">AI客服需要读取 <strong>xiaohongshu.com/notification</strong><br>打开通知页后点「🔄 重试」</div>
      <button id="retryChatFollowBtn" class="retry-btn">🔄 重试</button>`;
    container.appendChild(emptyDiv);
    document.getElementById('retryChatFollowBtn')?.addEventListener('click', () => loadChatFollow(container));
    setStatus('📍 需要打开通知页', 'warn');
    return;
  }
  renderChatFollow(container, data);
  setStatus(`💬 AI客服：${data.conversations.length} 个会话 · ${data.pendingCount} 条待回复`, data.pendingCount > 0 ? 'success' : '');
}

// 渲染会话卡片列表
function renderChatFollow(container, data) {
  while (container.firstChild) container.removeChild(container.firstChild);
  const { conversations, pendingCount } = data;

  // 顶部操作条
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 4px;border-bottom:1px solid #eee;margin-bottom:8px;flex-wrap:wrap;';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:13px;font-weight:700;color:#333;';
  title.textContent = `💬 AI客服：${conversations.length} 个会话 · ${pendingCount} 条待回复`;
  toolbar.appendChild(title);
  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:6px;';
  const batchBtn = document.createElement('button');
  batchBtn.className = 'batch-send-btn';
  batchBtn.id = 'chatFollowBatchBtn';
  batchBtn.textContent = pendingCount > 0 ? `🤖 全部回复 (${pendingCount})` : '🤖 全部回复';
  batchBtn.disabled = pendingCount === 0;
  batchBtn.title = '串行回复所有待回复会话：AI 生成 → 自动发送 → 3~8 秒随机间隔';
  const syncBtn = document.createElement('button');
  syncBtn.className = 'refresh-btn';
  syncBtn.id = 'chatFollowSyncBtn';
  syncBtn.textContent = '🔄 重新同步';
  const histBtn = document.createElement('button');
  histBtn.className = 'refresh-btn';
  histBtn.id = 'chatFollowHistBtn';
  histBtn.textContent = '📜 回复历史';
  histBtn.title = '查看 AI 已发出的所有回复记录（时间 / 对方消息 / 我的回复）';
  btnGroup.appendChild(batchBtn);
  btnGroup.appendChild(syncBtn);
  btnGroup.appendChild(histBtn);
  toolbar.appendChild(btnGroup);
  container.appendChild(toolbar);

  // 首次使用提示：通知页看不到“我是否已手动回复过”，避免重复打扰
  if (conversations.length > 0) {
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:#8d6e63;background:#fff8e1;border:1px solid #ffe0b2;border-radius:6px;padding:6px 8px;margin-bottom:8px;line-height:1.6;';
    tip.innerHTML = '💡 通知页看不出「我是否已手动回复过」：若你曾在页面上手动回过某人，请在该会话点 <b>⏭ 手动回复过了</b> 跳过，避免重复回复；每条只会发一次。';
    container.appendChild(tip);
  }

  if (conversations.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-prospect';
    emptyDiv.innerHTML = '<div style="font-size:28px;margin-bottom:10px;">📭</div><div style="font-size:14px;color:#333;font-weight:500;">通知页暂无通知</div><div style="font-size:12px;color:#555;margin-top:6px;">没有可跟进的会话</div>';
    container.appendChild(emptyDiv);
  }

  for (const conv of conversations) {
    container.appendChild(createChatFollowCard(conv));
  }

  document.getElementById('chatFollowBatchBtn')?.addEventListener('click', () => batchChatFollowReply(container));
  document.getElementById('chatFollowSyncBtn')?.addEventListener('click', () => loadChatFollow(container));
  document.getElementById('chatFollowHistBtn')?.addEventListener('click', () => showChatFollowHistory(container));
}

// 回复历史视图：从独立存储读取所有 AI 已发出的回复（最新在前）
async function showChatFollowHistory(container) {
  let list = [];
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'chatFollowGetReplyHistory' });
    if (resp && resp.ok) list = resp.list || [];
  } catch (_) {}
  while (container.firstChild) container.removeChild(container.firstChild);

  // 顶栏：返回 + 标题
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid #eee;margin-bottom:8px;';
  const backBtn = document.createElement('button');
  backBtn.className = 'refresh-btn';
  backBtn.textContent = '⬅ 返回会话';
  backBtn.addEventListener('click', () => reloadChatFollow());
  bar.appendChild(backBtn);
  const title = document.createElement('span');
  title.style.cssText = 'font-size:13px;font-weight:700;color:#333;';
  title.textContent = `📜 回复历史（${list.length} 条）`;
  bar.appendChild(title);
  container.appendChild(bar);

  if (list.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-prospect';
    emptyDiv.innerHTML = '<div style="font-size:28px;margin-bottom:10px;">🗒️</div><div style="font-size:14px;color:#333;font-weight:500;">还没有回复记录</div><div style="font-size:12px;color:#555;margin-top:6px;">AI 自动发出回复后会记录在这里（手动跳过 / AI 判定不回复的不记录）</div>';
    container.appendChild(emptyDiv);
    return;
  }

  for (const it of list) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid #e5e5e5;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff;';
    const timeStr = new Date(it.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;';
    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-size:13px;font-weight:700;color:#333;';
    nameEl.textContent = `👤 ${it.userName || '未知用户'}`;
    head.appendChild(nameEl);
    const timeEl = document.createElement('span');
    timeEl.style.cssText = 'font-size:11px;color:#999;';
    timeEl.textContent = timeStr;
    head.appendChild(timeEl);
    const tag = document.createElement('span');
    tag.style.cssText = 'font-size:10px;background:#e8f5e9;color:#2e7d32;padding:1px 6px;border-radius:8px;margin-left:auto;';
    tag.textContent = '✅ 已回复';
    head.appendChild(tag);
    card.appendChild(head);
    const replied = document.createElement('div');
    replied.style.cssText = 'font-size:12px;color:#555;background:#fafafa;border-radius:6px;padding:6px 8px;margin-bottom:6px;line-height:1.5;';
    replied.innerHTML = `<b>对方：</b>${esc(it.repliedIncoming || '（未知）')}`;
    card.appendChild(replied);
    const reply = document.createElement('div');
    reply.style.cssText = 'font-size:12px;color:#1976d2;background:#f0f7ff;border-radius:6px;padding:6px 8px;line-height:1.5;';
    reply.innerHTML = `<b>我的回复：</b>${esc(it.replyText || '')}`;
    card.appendChild(reply);
    container.appendChild(card);
  }
}

// 会话状态标签
function _chatFollowStatusLabel(conv) {
  if (conv.stale) return { text: '📌 已离线', color: '#999', bg: '#f0f0f0' };
  if (conv.sold) return { text: '💰 已销售', color: '#7b1fa2', bg: '#f3e5f5' };
  if (conv.needReply) return { text: '🔴 待回复', color: '#c62828', bg: '#fdecea' };
  return { text: '✅ 已回复', color: '#1f9d55', bg: '#e8f5e9' };
}

// 创建单张会话卡片
function createChatFollowCard(conv) {
  const card = document.createElement('div');
  card.style.cssText = 'border:1px solid #e5e5e5;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#fff;';
  card.dataset.userId = conv.userId;

  // 头部：昵称 + 状态标签 + 轮数
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;';
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-size:13px;font-weight:700;color:#333;';
  nameEl.textContent = `👤 ${conv.userName || '未知用户'}`;
  head.appendChild(nameEl);
  const label = _chatFollowStatusLabel(conv);
  const tagEl = document.createElement('span');
  tagEl.style.cssText = `font-size:11px;font-weight:600;color:${label.color};background:${label.bg};padding:2px 8px;border-radius:10px;`;
  tagEl.textContent = label.text;
  head.appendChild(tagEl);
  const metaEl = document.createElement('span');
  metaEl.style.cssText = 'font-size:11px;color:#999;margin-left:auto;';
  metaEl.textContent = `${conv.turnCount} 轮` + (conv.lastReplyAt ? ` · ${new Date(conv.lastReplyAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '');
  head.appendChild(metaEl);
  card.appendChild(head);

  // 对话预览：完整历史（旧→新），超长可滚动——历史上下文必须全部可见，AI 的回复依据都在里面
  const histPreview = document.createElement('div');
  histPreview.style.cssText = 'font-size:12px;color:#555;line-height:1.6;margin-bottom:8px;background:#fafafa;border-radius:6px;padding:6px 8px;max-height:160px;overflow-y:auto;';
  const history = conv.history || [];
  if (history.length > 0) {
    histPreview.innerHTML = history.map(m => {
      const who = m.role === 'user' ? (conv.userName || '对方')
        : (m.role === 'context' ? '我此前的评论/回复' : '我的回复');
      return `<div><b>${esc(who)}：</b>${esc(m.content.length > 60 ? m.content.slice(0, 60) + '…' : m.content)}</div>`;
    }).join('');
  } else {
    histPreview.textContent = '（无对话记录）';
  }
  card.appendChild(histPreview);

  // 待回复：显示对方最新消息 + 操作按钮；AI 生成后显示预览与发送按钮
  if (conv.needReply && conv.pendingIncoming) {
    const pendingBox = document.createElement('div');
    pendingBox.style.cssText = 'border:1px dashed #ffb3b3;background:#fff8f8;border-radius:6px;padding:8px;margin-bottom:8px;';
    const pendingTitle = document.createElement('div');
    pendingTitle.style.cssText = 'font-size:11px;font-weight:700;color:#c62828;margin-bottom:4px;';
    pendingTitle.textContent = '📩 最新消息（待回复）';
    pendingBox.appendChild(pendingTitle);
    const pendingText = document.createElement('div');
    pendingText.style.cssText = 'font-size:12px;color:#333;line-height:1.6;';
    pendingText.textContent = conv.pendingIncoming;
    pendingBox.appendChild(pendingText);
    card.appendChild(pendingBox);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    const genBtn = document.createElement('button');
    genBtn.className = 'batch-send-btn';
    genBtn.textContent = '🤖 AI 生成回复';
    genBtn.style.padding = '5px 12px;font-size:12px;';
    genBtn.addEventListener('click', () => generateChatFollowReply(conv, card, genBtn));
    actions.appendChild(genBtn);
    // 手动回复过了 → 标记跳过（记录 lastRepliedIncoming 防重复，不追加回复正文）
    const skipBtn = document.createElement('button');
    skipBtn.className = 'refresh-btn';
    skipBtn.textContent = '⏭ 手动回复过了';
    skipBtn.style.padding = '5px 12px;font-size:12px;';
    skipBtn.title = '若你已在页面上手动回复过这条，点此标记，避免重复回复';
    skipBtn.addEventListener('click', async () => {
      skipBtn.disabled = true;
      const markResp = await chrome.runtime.sendMessage({ action: 'chatFollowMarkSent', data: { userId: conv.userId, replyText: '', lastRepliedIncoming: conv.pendingIncoming } });
      if (markResp && markResp.ok) {
        addLog(`⏭ @${conv.userName} 已标记为手动回复过（跳过）`, 'info');
        await reloadChatFollow();
      } else {
        addLog(`⚠️ @${conv.userName} 标记失败：${(markResp && markResp.error) || '未知错误'}`, 'error');
        skipBtn.disabled = false;
      }
    });
    actions.appendChild(skipBtn);
    card.appendChild(actions);
  }
  return card;
}

// AI 生成回复（单条）：生成后渲染预览 + 发送按钮
async function generateChatFollowReply(conv, card, genBtn) {
  genBtn.disabled = true;
  genBtn.textContent = '🤖 生成中...';
  try {
    setLockBanner(true, 'chatFollowReply');
    const resp = await chrome.runtime.sendMessage({ action: 'chatFollowReply', data: { userId: conv.userId } });
    if (!resp || !resp.ok) {
      throw new Error((resp && resp.error) || 'AI 生成失败');
    }
    addLog(`🤖 @${conv.userName} AI 判断 [${resp.action}]：${resp.reason || ''}`, resp.action === 'sell' ? 'warn' : 'info');
    if (!resp.reply) {
      // AI 认为无需回复（礼貌结束语 / 已无待回复内容）
      if (resp.ending) {
        // 礼貌性结束语（谢谢/收到类）：自动标记已处理，下次同步不再提示，也不会重复回复
        genBtn.textContent = '⏭ 无需回复（已标记）';
        const markResp = await chrome.runtime.sendMessage({ action: 'chatFollowMarkSent', data: { userId: conv.userId, replyText: '', lastRepliedIncoming: conv.pendingIncoming } });
        addLog(`✅ @${conv.userName} 礼貌性结束语，已标记跳过（不再提示）`, markResp && markResp.ok ? 'success' : 'warn');
        await reloadChatFollow();
        return;
      }
      genBtn.textContent = '⏭ 无需回复';
      return;
    }

    // 渲染预览区
    const preview = document.createElement('div');
    preview.style.cssText = 'border:1px solid #c8e6c9;background:#f1f8f1;border-radius:6px;padding:8px;margin-top:8px;';
    const actionColor = resp.action === 'sell' ? '#7b1fa2' : (resp.action === 'noop' ? '#999' : '#1976d2');
    const actionName = resp.action === 'sell' ? '💰 销售' : (resp.action === 'noop' ? '🤝 客套' : '💬 闲聊');
    const headLine = document.createElement('div');
    headLine.style.cssText = 'font-size:11px;font-weight:700;margin-bottom:4px;';
    headLine.innerHTML = `<span style="color:${actionColor};">${actionName}</span> <span style="color:#888;font-weight:400;">${esc(resp.reason || '')}</span>`;
    preview.appendChild(headLine);
    const replyText = document.createElement('div');
    replyText.style.cssText = 'font-size:13px;color:#333;line-height:1.6;margin-bottom:8px;';
    replyText.textContent = resp.reply;
    preview.appendChild(replyText);
    const sendRow = document.createElement('div');
    sendRow.style.cssText = 'display:flex;gap:6px;';
    const sendBtn = document.createElement('button');
    sendBtn.className = 'batch-send-btn';
    sendBtn.textContent = '✅ 发送这条回复';
    sendBtn.style.padding = '5px 12px;font-size:12px;';
    sendBtn.addEventListener('click', () => sendChatFollowReply(conv, resp.reply, card, sendBtn));
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'refresh-btn';
    cancelBtn.textContent = '✖ 放弃';
    cancelBtn.style.padding = '5px 12px;font-size:12px;';
    cancelBtn.addEventListener('click', () => { preview.remove(); genBtn.disabled = false; genBtn.textContent = '🤖 AI 生成回复'; });
    sendRow.appendChild(sendBtn);
    sendRow.appendChild(cancelBtn);
    preview.appendChild(sendRow);
    card.appendChild(preview);
    genBtn.textContent = '✅ 已生成（点上方发送）';
  } catch (e) {
    addLog(`❌ @${conv.userName} AI 生成失败：${e.message}`, 'error');
    genBtn.textContent = '🤖 AI 生成回复';
    genBtn.disabled = false;
  } finally {
    setLockBanner(false, 'chatFollowReply');
  }
}

// 发送单条回复（content.js 三重定位发送 → 落库防重 → 重渲染）
async function sendChatFollowReply(conv, replyText, card, sendBtn) {
  sendBtn.disabled = true;
  sendBtn.textContent = '⏳ 发送中...';
  try {
    setLockBanner(true, 'chatFollowSend');
    const tab = await _ensureNotificationTab();
    if (!tab) throw new Error('通知页已关闭或切换，无法发送');
    const resp = await chrome.tabs.sendMessage(tab.id, {
      action: 'replyNotification',
      idx: conv.pendingIdx,
      replyText,
      userId: conv.userId,
      userName: conv.userName,
      latestText: conv.pendingIncoming, // 发送前校验：该位置的消息必须还是这条
    });
    if (!resp || !resp.success) {
      throw new Error((resp && resp.error) || '发送失败');
    }
    addLog(`✅ 已回复 @${conv.userName}（${resp.via || ''}）`, 'success');
    // 落库：追加回复、清空待回复定位、记住回复的是哪条，防止下次同步重复回复
    const markResp = await chrome.runtime.sendMessage({ action: 'chatFollowMarkSent', data: { userId: conv.userId, replyText, lastRepliedIncoming: conv.pendingIncoming } });
    if (!markResp || !markResp.ok) {
      addLog(`⚠️ 回复已发出，但状态落库失败：${(markResp && markResp.error) || '未知错误'}（下次同步可能重复提示，可手动忽略）`, 'warn');
    }
    // 重渲染整个列表（刷新状态标签）
    await reloadChatFollow();
  } catch (e) {
    addLog(`❌ @${conv.userName} 发送失败：${e.message}`, 'error');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '✅ 发送这条回复'; }
  } finally {
    setLockBanner(false, 'chatFollowSend');
  }
}

// 全部串行回复（AI 生成 → 发送 → 3~8 秒随机间隔）
async function batchChatFollowReply(container) {
  let convs = [];
  try {
    const data = await chatFollowSync();
    if (!data) return;
    convs = data.conversations.filter(c => c.needReply && c.pendingIncoming);
  } catch (e) {
    addLog(`❌ 批量回复前置同步失败：${e.message}`, 'error');
    return;
  }
  if (convs.length === 0) {
    addLog('📭 没有待回复的会话', 'info');
    return;
  }

  setLockBanner(true, 'chatFollow');
  let okCount = 0, skipCount = 0, failCount = 0;
  try {
    for (let i = 0; i < convs.length; i++) {
      const conv = convs[i];
      addLog(`🤖 [${i + 1}/${convs.length}] @${conv.userName}：AI 生成回复...`, 'info');
      let gen = null;
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'chatFollowReply', data: { userId: conv.userId } });
        if (resp && resp.ok) gen = resp;
        else throw new Error((resp && resp.error) || 'AI 生成失败');
      } catch (e) {
        addLog(`⚠️ [${i + 1}/${convs.length}] @${conv.userName} 生成失败：${e.message}，跳过`, 'warn');
        failCount++;
        continue;
      }
      if (!gen.reply) {
        addLog(`⏭ [${i + 1}/${convs.length}] @${conv.userName} AI 判定无需回复（${gen.reason || 'noop'}），标记已处理`, 'info');
        try { await chrome.runtime.sendMessage({ action: 'chatFollowMarkSent', data: { userId: conv.userId, replyText: '' } }); } catch (_) {}
        skipCount++;
        continue;
      }
      addLog(`💬 [${i + 1}/${convs.length}] @${conv.userName} AI 判断 [${gen.action}]：${gen.reply.slice(0, 50)}${gen.reply.length > 50 ? '…' : ''}`, gen.action === 'sell' ? 'warn' : 'info');
      // 发送（三重定位保障在 content.js）
      const tab = await _ensureNotificationTab();
      if (!tab) throw new Error('通知页已关闭或切换，批量中止');
      const sendResp = await chrome.tabs.sendMessage(tab.id, {
        action: 'replyNotification',
        idx: conv.pendingIdx,
        replyText: gen.reply,
        userId: conv.userId,
        userName: conv.userName,
        latestText: conv.pendingIncoming,
      });
      if (!sendResp || !sendResp.success) {
        addLog(`❌ [${i + 1}/${convs.length}] @${conv.userName} 发送失败：${(sendResp && sendResp.error) || '未知错误'}，跳过`, 'error');
        failCount++;
        continue;
      }
      okCount++;
      addLog(`✅ [${i + 1}/${convs.length}] @${conv.userName} 回复成功（${sendResp.via || ''}）`, 'success');
      try {
        await chrome.runtime.sendMessage({ action: 'chatFollowMarkSent', data: { userId: conv.userId, replyText: gen.reply, lastRepliedIncoming: conv.pendingIncoming } });
      } catch (_) {}
      // 条间发送间隔：随机 3~8 秒（最后一条不用等）
      if (i < convs.length - 1) {
        const gap = 3000 + Math.floor(Math.random() * 5000);
        addLog(`⏸ 发送间隔：停 ${(gap / 1000).toFixed(1)}s 再回复下一位...`, 'info');
        await sleep(gap);
      }
    }
  } catch (e) {
    addLog(`⛔ 批量回复中断：${e.message}`, 'error');
  } finally {
    setLockBanner(false, 'chatFollow');
  }
  addLog(`🏁 批量回复完成：成功 ${okCount}，跳过 ${skipCount}，失败 ${failCount}`, okCount > 0 ? 'success' : 'warn');
  // 重新同步渲染（页面 DOM 已更新，重建会话）
  await loadChatFollow(container);
}

// ========== 商机挖掘 ==========
// skipScreen=true：跳过评论量门槛，把不足 10 条的评论也强塞给 AI（空态里“仍要 AI 全量分析”按钮用）

// ── 同行碰撞笔记判定（获客时"不灌水、只收求分享线索") ──
//  逻辑：某笔记评论区里"求分享/求资料/求带/想要/蹲..."等求取类评论占比过高，
//  说明这是同行引流/资料钩子笔记，评论早已挤满各路中介的灌水，此刻再上去灌水极易碰撞/被淹/被拉黑。
//  → 这种笔记不灌水；改为把"求分享"的评论用户收进用户清单线索池，并备好触达词供私聊（不浪费这篇的获客价值）。
const REQ_SHARE_RE = /(求(分享|一份|一[份套发]|资料|带|模板|教程|资源|电子(版)?|报价|私(信|聊)?|发|领)|发我(一|[一1])?份|分享(我|给我|一份|一下)|发一下|发你吗|我要(一份|一个)|想要(一份|一个)|蹲(蹲|一个?|一波)?|蹲蹲|怎么领|哪里([可]?以|能)|能[不]?能(发|给我)|求求|谢谢?[发您你了]?我)/;
const SHARE_DENSITY_MIN = 0.15;  // 求分享评论占比 ≥15%
const SHARE_HITS_MIN = 2;        // 且至少命中 2 条，才判定为碰撞
const _shareNorm = (s) => String(s || '').replace(/^@/, '').replace(/\s+/g, '').toLowerCase().trim();
/** 检测某评论是否为"求分享/求取"类（本地启发式，不烧 AI） */
function _isReqShareComment(c) {
  return REQ_SHARE_RE.test(_shareNorm(c && c.content));
}
/** 判定笔记是否属于"同行碰撞、不应灌水"：命中返回 [{author,content,userLink}...]，未命中返回 [] */
function collisionShareHits(comments) {
  const hits = (comments || []).filter(_isReqShareComment);
  const density = comments && comments.length > 0 ? hits.length / comments.length : 0;
  if (hits.length >= SHARE_HITS_MIN && density >= SHARE_DENSITY_MIN) return hits;
  return [];
}
/** 读取"碰撞笔记 → 只收线索不灌水"开关（默认开，可在设置 behavior_config 关闭） */
async function collisionLeadModeEnabled() {
  try {
    const d = await chrome.storage.local.get('behavior_config');
    const c = (d && d.behavior_config) || {};
    return c.collisionLeadMode !== false;
  } catch (_) { return true; }
}
// 调试钩子：window.__collisionDebug=true 时打印判定明细，便于调阈值
window.__collisionShareLog = function(msg){ if (window.__collisionDebug) addLog(msg, 'warn'); };

// skipScreen=true：跳过评论量门槛，把不足 10 条的评论也强塞给 AI（空态里“仍要 AI 全量分析”按钮用）
async function loadProspecting(container, skipScreen) {
  // 清空容器，用 DOM 方法添加加载提示（不用 innerHTML）
  while (container.firstChild) container.removeChild(container.firstChild);
  // 重置点赞记录（新扫描 = 新笔记，清空旧列表）
  likedComments = [];

  // ★ 顶部醒目 Banner：先检查本地已回复记录
  let repliedBanner = null;
  let allRepliedKeys = new Set();
  try {
    const localReplied = await getLocalRepliedForNote(pageData.url || '');
    if (localReplied.length > 0) {
      localReplied.forEach(e => allRepliedKeys.add(e.author + '||' + e.comment));
      repliedBanner = createRepliedBanner(localReplied.length);
      container.appendChild(repliedBanner);
    }
  } catch (_) {}

  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'padding:20px;text-align:center;color:#666;';
  loadingDiv.innerHTML = '<div class="loading-spinner" style="margin:0 auto 8px;"></div><div>AI 正在扫描评论...</div>';
  container.appendChild(loadingDiv);

  try {
    // 先检查已回复的评论，过滤掉
    let filteredComments = pageData.comments || [];
    let filteredCount = 0;

    // 从本地存储获取已回复列表
    let localReplied = [];
    try {
      localReplied = await getLocalRepliedForNote(pageData.url || '');
    } catch (_) {}

    // 合并去重（key = author||content）
    addLog('📋 检查本地已回复记录...', 'info');
    const localKeys = new Set(localReplied.map(e => e.author + '||' + e.comment));
    allRepliedKeys = new Set([...localKeys]);
    filteredComments = (pageData.comments || []).filter(c => !allRepliedKeys.has((c.author || '') + '||' + (c.content || '')));
    filteredCount = (pageData.comments || []).length - filteredComments.length;

    // 构建索引映射：filteredIndex → originalIndex
    const originalIdxMap = [];
    const _allComments = pageData.comments || [];
    const _mapKeys = new Set(allRepliedKeys);
    _allComments.forEach((c, i) => {
      if (!_mapKeys.has((c.author || '') + '||' + (c.content || ''))) {
        originalIdxMap.push(i);
      }
    });

    // 如果有已回复记录，更新或插入 Banner
    if (filteredCount > 0) {
      if (!repliedBanner) {
        repliedBanner = createRepliedBanner(filteredCount);
        container.insertBefore(repliedBanner, container.firstChild);
      } else {
        repliedBanner.innerHTML = `📢 本条笔记已有 <strong>${allRepliedKeys.size}</strong> 条回复记录，已自动从扫描中排除`;
      }
    }

    // 如果全部已回复，直接提示
    if (filteredComments.length === 0) {
      while (container.firstChild) container.removeChild(container.firstChild);
      if (repliedBanner) container.appendChild(repliedBanner);
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-prospect';
      emptyDiv.innerHTML = `
        <div style="font-size:28px;margin-bottom:10px;">✅</div>
        <div style="font-size:14px;color:#333;margin-bottom:6px;font-weight:500;">所有评论都已回复过</div>
        <div style="font-size:12px;color:#555;line-height:1.6;">已过滤 <strong>${filteredCount}</strong> 条已回复评论。</div>
        <button id="retryProspectBtn" class="retry-btn">🔄 重新扫描</button>`;
      container.appendChild(emptyDiv);
      document.getElementById('retryProspectBtn')?.addEventListener('click', async () => {
        addLog('🔄 重新扫描（所有已回复）', 'info');
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await refreshData();
      });
      setStatus('✅ 所有评论已回复', 'success');
      await _finishTabStatusBar();
      broadcastAiScanDone(false); // ★ 本篇无待发评论，通知机器人返回列表
      return;
    }

    // ★ 同行碰撞笔记：评论区"求分享"占比过高 → 判定为同行引流/资料钩子笔记，
    //   不灌水（避免碰撞/被淹/被拉黑），改为把"求分享"用户收入线索池 + 备触达词供私聊。
    if (await collisionLeadModeEnabled()) {
      let shareHits = [];
      try { shareHits = collisionShareHits(filteredComments); } catch (_) {}
      if (shareHits.length > 0) {
        const _leadsOn = editionFeatureOn('prospectList');
        addLog(`🚦 判定为本篇为同行碰撞笔记：${shareHits.length}/${filteredComments.length} 条为求分享评论，本笔记不灌水` + (_leadsOn ? '，改收求分享线索' : ''), 'warn');
        window.__collisionShareLog(`碰撞明细：${shareHits.map(h => '@' + (h.author || '?')).join('、')}`);
        await renderShareLeads(container, shareHits, { repliedBanner });
        // ★ 本篇无待发评论（lead 模式不灌水）→ 通知机器人返回列表 / 去下一篇，严格流水线不卡死
        //   与其它"无商机"出口一致：只广播 broadcastAiScanDone(false)，不额外 noteDone，避免双信号重复推进下篇
        broadcastAiScanDone(false);
        await _finishTabStatusBar();
        return;
      }
    }

    // ★ 评论量门槛：刚起量/没流量的文章评论不足，没有挖掘价值 → 直接退出，不劳烦 AI。
    //   评论 ≥10 条才值得挖（skipScreen=true 时跳过，强制全量分析）
    if (skipScreen) {
      addLog('⏩ 已按你的要求跳过评论量门槛（不足 10 条也全量分析）', 'warn');
    } else if (filteredComments.length < 10) {
      while (container.firstChild) container.removeChild(container.firstChild);
      if (repliedBanner) container.appendChild(repliedBanner);
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-prospect';
      emptyDiv.innerHTML = `
        <div style="font-size:28px;margin-bottom:10px;">📉</div>
        <div style="font-size:14px;color:#333;margin-bottom:6px;font-weight:500;">评论不足 10 条，跳过商机挖掘</div>
        <div style="font-size:12px;color:#555;line-height:1.6;">刚起量的文章评论太少（当前 <strong>${filteredComments.length}</strong> 条），<br>没有值得挖掘的商机，已直接退出。</div>
        <button id="forceAiBtn" class="retry-btn">🤖 仍要 AI 全量分析</button>
        <button id="retryProspectBtn" class="retry-btn">🔄 重新扫描</button>`;
      container.appendChild(emptyDiv);
      document.getElementById('forceAiBtn')?.addEventListener('click', async () => {
        addLog('🤖 手动要求：评论不足 10 条仍要 AI 分析', 'warn');
        setStatus('<span class="loading-spinner"></span> AI 全量分析中...', '');
        await loadProspecting(container, true);
      });
      document.getElementById('retryProspectBtn')?.addEventListener('click', async () => {
        addLog('🔄 重新扫描（评论不足）', 'info');
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await refreshData();
      });
      setStatus('📉 评论不足 10 条，已跳过', 'success');
      await _finishTabStatusBar();
      broadcastAiScanDone(false); // ★ 本篇无商机结束，通知机器人返回列表
      return;
    }

    // ★ 把“到底抓到了啥”显示在评论助手日志里，方便每次核对拓取结果
    // 同时做一个“疑似拓错”自检：若大量评论正文都是纯数字/万（很可能把点赞数当成了正文），就高亮告警
    try {
      const _shown = filteredComments.slice(0, 30);
      addLog(`🔍 本次共拓到 ${(pageData.comments || []).length} 条评论（过滤已回复后待分析 ${filteredComments.length} 条），下面逐条列出让你核对：`, 'info');
      let _numLike = 0;
      _shown.forEach((c, i) => {
        const body = (c.content || '').trim();
        const isNumLike = /^[\d,\.\s万k＋+]+$/i.test(body); // 正文只剩数字/万/k → 很可能是点赞数
        if (isNumLike) _numLike++;
        const flag = isNumLike ? ' ⚠️疑似点赞数而非正文' : '';
        addLog(`  ${i + 1}. @${esc(c.author || '?')}: ${esc(body.slice(0, 60))}${body.length > 60 ? '…' : ''}${flag}`, isNumLike ? 'warn' : 'info');
      });
      if (filteredComments.length > _shown.length) {
        addLog(`  …其余 ${filteredComments.length - _shown.length} 条未列出`, 'info');
      }
      // 自检汇总：过半评论都是纯数字 → 大概率把点赞数当成了正文
      if (_shown.length >= 3 && _numLike >= Math.ceil(_shown.length * 0.5)) {
        addLog(`⚠️ 自检：${_numLike}/${_shown.length} 条评论正文都是纯数字，极可能拓取时把“点赞数/互动数”当成了评论正文，真正的评论文字没抓到！这会导致 AI 无法判断商机。`, 'warn');
      }
    } catch (_) {}

    // 本地计数检查对这篇博文的评论次数，防止被拉黑
    let noteCommentWarning = '';
    try {
      const noteCount = await getNoteReplyCount(pageData.url || '');
      if (noteCount >= 5) {
        noteCommentWarning = `⚠️ 你已在这篇笔记下回复过 ${noteCount} 次，建议不要再回复了，容易被博主拉黑！`;
      } else if (noteCount >= 3) {
        noteCommentWarning = `⚠️ 你已在这篇笔记下回复过 ${noteCount} 次，注意控制频率`;
      } else if (noteCount > 0) {
        noteCommentWarning = `📝 你在这篇笔记下回复过 ${noteCount} 次`;
      }
    } catch (_) {}

    // 通过 background.js 请求商机挖掘（skipAiScreen：“仍要 AI 全量分析”按钮同时跳过本地预筛和 AI 快筛）
    const requestData = { ...pageData, comments: filteredComments, skipAiScreen: !!skipScreen };
    // ★ AI 返回期间也锁定界面，并告知“AI 正在思考”（网络请求可能要十几秒，防止用户此时手动操作）
    setLockBanner(true, 'aiThinking');
    _startAiThinkingTicker();
    // ★ 同步让网页那条红色状态栏也显示“AI 分析中”（AI 跑在 background，内容脚本自己不知道）
    await _setTabStatusBar('🤖 AI 正在分析评论、生成话术…（请稍候）');
    addLog('🤖 AI 开始分析评论、生成话术（网络请求中，请稍候）...', 'info');
    let bgResp;
    // ★ AI 调用也设超时：findProspects 在 background 可能因网络/AI 服务长期不返回（无超时 → 刷新评论会永久卡在
    //   “AI 分析”这一步）。超时后走下方统一 catch：显示明确错误 + broadcastAiScanDone 放行（机器人可去下一篇），绝不无限等。
    const FIND_PROSPECTS_TIMEOUT = 180000;
    let _ft = null;
    const _timed = new Promise((_, reject) => {
      _ft = setTimeout(() => {
        const e = new Error('商机挖掘超时（' + Math.round(FIND_PROSPECTS_TIMEOUT / 1000) + 's），AI 未返回结果，已跳过本篇');
        e._timeout = true;
        reject(e);
      }, FIND_PROSPECTS_TIMEOUT);
    });
    try {
      bgResp = await Promise.race([
        chrome.runtime.sendMessage({ action: 'findProspects', data: requestData }),
        _timed,
      ]);
    } finally {
      if (_ft) clearTimeout(_ft);
      // 无论成败都先停读秒并解锁（后续点赞/发送等流程会各自重新锁定）
      _stopAiThinkingTicker();
      setLockBanner(false, 'aiThinking');
      // ★ 整条流程到此结束 → 网页红色状态栏停读秒、切“等待用户操作”
      await _finishTabStatusBar();
    }
    if (!bgResp?.ok) {
      const scanErr = new Error(bgResp?.error || '商机挖掘失败');
      scanErr.aiRaw = bgResp?.aiRaw || ''; // 解析失败时携带 AI 完整原始回复，供排查/手动使用
      throw scanErr;
    }
    const result = bgResp;

    const prospects = result.prospects || [];
    const summary = result.summary || '';

    // ★ 快筛打断：AI 判定抓到的根本不是真实评论（点赞数/昵称/界面文字）→ 不做大分析，直接提示重拓。
    //   ★ 自动模式（机器人带跑）下不弹红色"打断"界面、不阻塞——只记一条"跳过本篇"，交给机器人去下一篇。
    if (result.captureError) {
      if (_lastScanWasAuto) {
        addLog(`⏭ 本篇抓取异常，自动跳过（AI 快筛：${result.captureError}）`, 'warn');
        broadcastAiScanDone(false); // ★ 通知机器人返回列表 / 去下一篇
        return;
      }
      while (container.firstChild) container.removeChild(container.firstChild);
      const errDiv = document.createElement('div');
      errDiv.className = 'empty-prospect';
      errDiv.innerHTML = `
        <div style="font-size:28px;margin-bottom:10px;">🛑</div>
        <div style="font-size:14px;color:#c62828;margin-bottom:6px;font-weight:500;">抓取内容可能不是真实评论</div>
        <div style="font-size:12px;color:#555;line-height:1.6;max-width:400px;margin:0 auto;">AI 快筛发现：${esc(result.captureError)}<br>已打断分析，请重新扫描重拓评论。</div>
        <button id="retryProspectBtn" class="retry-btn">🔄 重新扫描</button>`;
      container.appendChild(errDiv);
      document.getElementById('retryProspectBtn')?.addEventListener('click', async () => {
        addLog('🔄 重新扫描（抓取异常打断）', 'info');
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await refreshData();
      });
      addLog(`🛑 AI 判定抓取内容异常，已打断分析：${result.captureError}`, 'warn');
      setStatus('🛑 抓取内容异常，已打断', 'error');
      broadcastAiScanDone(false); // ★ 抓取异常打断，通知机器人返回列表
      return;
    }

    // ★ 快筛判定无价值：几秒就出结果，大分析根本没跑 → 省下 15~30 秒
    if (result.screenedByAi && prospects.length === 0) {
      while (container.firstChild) container.removeChild(container.firstChild);
      const fastDiv = document.createElement('div');
      fastDiv.className = 'empty-prospect';
      fastDiv.innerHTML = `
        <div style="font-size:28px;margin-bottom:10px;">⚡</div>
        <div style="font-size:14px;color:#333;margin-bottom:6px;font-weight:500;">AI 快筛：本篇无相关商机</div>
        <div style="font-size:12px;color:#555;line-height:1.6;max-width:400px;margin:0 auto;">${esc(summary || '评论中没有与产品相关的需求/痛点')}<br>快筛仅耗时 ${((result.screenMs || 0) / 1000).toFixed(1)} 秒，已跳过完整分析。</div>
        <button id="forceAiBtn" class="retry-btn">🤖 仍要 AI 全量分析</button>
        <button id="retryProspectBtn" class="retry-btn">🔄 重新扫描</button>`;
      container.appendChild(fastDiv);
      document.getElementById('forceAiBtn')?.addEventListener('click', async () => {
        addLog('🤖 手动要求：跳过快筛，全量交给 AI 分析', 'warn');
        setStatus('<span class="loading-spinner"></span> AI 全量分析中...', '');
        await loadProspecting(container, true);
      });
      document.getElementById('retryProspectBtn')?.addEventListener('click', async () => {
        addLog('🔄 重新扫描（快筛无商机）', 'info');
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await refreshData();
      });
      addLog(`⚡ AI 快筛（${((result.screenMs || 0) / 1000).toFixed(1)} 秒）：本篇无相关商机，已跳过完整分析，省下约 20 秒`, 'success');
      setStatus('⚡ AI 快筛：本篇无相关商机', 'success');
      broadcastAiScanDone(false); // ★ 本篇无商机结束，通知机器人返回列表
      return;
    }

    kbImages = result.images || []; // 存储知识库匹配的图片（已按标签筛选）
    const kbMatchedEntries = result.matchedEntries || []; // 匹配的知识库条目
    addLog(`✅ AI分析完成：发现 ${prospects.length} 个潜在客户`, 'success');
    
    // 日志：显示匹配的知识库条目
    if (kbMatchedEntries.length > 0) {
      addLog(`📚 知识库匹配 ${kbMatchedEntries.length} 条：`, 'info');
      kbMatchedEntries.forEach((entry, i) => {
        const roleTag = entry.role ? `[${entry.role}]` : '';
        const imgTag = entry.hasImage ? '🖼️' : '';
        addLog(`  ${i + 1}. ${roleTag}${entry.title} ${imgTag}`, 'info');
        addLog(`     ${entry.contentPreview}`, 'info');
      });
    } else {
      addLog('📚 知识库未匹配到相关条目', 'warn');
    }
    
    // 日志：显示待发送的图片
    if (kbImages.length > 0) {
      addLog(`🖼️ 待发送图片 ${kbImages.length} 张（带“产品操作”标签的条目）：`, 'info');
      kbImages.forEach((img, i) => {
        addLog(`  ${i + 1}. ${img.title}`, 'info');
      });
    } else {
      addLog('🖼️ 无待发送图片（匹配的知识库条目无“产品操作”标签）', 'info');
    }
    
    // 日志：显示给AI的完整提示词（用于调试）
    const prompts = result.prompts || {};
    if (prompts.system || prompts.user) {
      addLog('━━━━━━━━━━ 📝 AI提示词（调试用）━━━━━━━━━━', 'info');
      addLog('【System Prompt】', 'info');
      addLog(prompts.system || '(空)', 'info');
      addLog('【User Prompt】', 'info');
      addLog(prompts.user || '(空)', 'info');
      addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    }
    
    const commentCount = pageData?.comments?.length || 0;
    const VERSION_LABELS = ['A', 'B', 'C'];
    const VERSION_NAMES = ['朋友分享型', '数据分析型', '产品介绍型'];

    console.log('[商机挖掘] 原始响应:', JSON.stringify(result, null, 2));

    // ★ 验证每个 prospect 的索引映射是否正确（商机抓取后验证）
    //   如果 AI 返回的 index 有偏移（常见于 0-based vs 1-based 混淆），
    //   通过 author + content 片段在所有评论中查找正确匹配
    console.log('[验证] filteredCount:', filteredCount, 'originalIdxMap:', JSON.stringify(originalIdxMap));
    (prospects || []).forEach((p, i) => {
      const origIdx = originalIdxMap[p.index] !== undefined ? originalIdxMap[p.index] : p.index;
      const pageComment = pageData.comments && pageData.comments[origIdx];
      if (pageComment) {
        const authorMatch = p.author === pageComment.author;
        const aiText = (p.original_comment || '').slice(0, 30);
        const pageText = (pageComment.content || '').slice(0, 30);
        const contentMatch = pageText && aiText && (pageText.includes(aiText) || aiText.includes(pageText));
        console.log(`[验证] Prospect ${i}: AI.index=${p.index} → origIdx=${origIdx}, ` +
          `author: AI="${p.author}" vs 页面="${pageComment.author}" (${authorMatch ? '✓' : '✗'}), ` +
          `text: "${aiText}" vs "${pageText}" (${contentMatch ? '✓' : '✗'})`);
        p._verified = authorMatch && contentMatch;
        p._origIdx = origIdx;
        if (!authorMatch || !contentMatch) {
          // ★ 索引不匹配：尝试在所有评论中通过 author + content 片段查找正确评论
          //   这修正了 AI 可能的 off-by-one 错误（0-based vs 1-based 混淆）
          console.warn(`[验证] ⚠️ 索引不匹配, 尝试全文搜索修正...`);
          let foundIdx = -1;
          const aiAuthor = p.author;
          const aiText30 = (p.original_comment || '').slice(0, 30);
          for (let ci = 0; ci < (pageData.comments || []).length; ci++) {
            const cc = pageData.comments[ci];
            if (!cc) continue;
            const ccText30 = (cc.content || '').slice(0, 30);
            if (aiAuthor === cc.author && ccText30 && aiText30 &&
                (ccText30.includes(aiText30) || aiText30.includes(ccText30))) {
              foundIdx = ci;
              console.log(`[验证] ✓ 通过 author+text 匹配到正确评论: idx=${ci}`);
              break;
            }
          }
          if (foundIdx >= 0) {
            p.author = pageData.comments[foundIdx].author;
            p.original_comment = pageData.comments[foundIdx].content;
            p._origIdx = foundIdx;
            p._verified = true;
          } else {
            // 没找到匹配，用原始索引的数据（至少还能点进去看）
            console.warn(`[验证] ⚠️ 未找到匹配, 使用 origIdx=${origIdx} 的数据`);
            p.author = pageComment.author;
            p.original_comment = pageComment.content;
          }
          p._wasFixed = true;
        }
      } else {
        console.warn(`[验证] ⚠️ Prospect ${i}: origIdx=${origIdx} 在 pageData.comments 中不存在`);
        p._verified = false;
        p._origIdx = -1;
      }
    });
    const hasMismatch = prospects.some(p => !p._verified);

    // ========== 自动点赞（低成本的 ID 曝光 — 对每个潜在商机都赞） ==========
    // ★ 整批点赞交给 content.js 在同一把锁内串行完成（含每次之间的等待间隔），
    // 不再在 popup 侧逐个 sleep+发消息（那样等待间隔处于锁外，会被其它操作插入）
    (async () => {
      try {
        const tab = await getTargetTab();
        if (!tab) return;
        const likeList = [];
        for (const p of prospects) {
          const idx = p._origIdx !== undefined && p._origIdx >= 0
            ? p._origIdx
            : (originalIdxMap[p.index] !== undefined ? originalIdxMap[p.index] : p.index);
          const author = p.author || '';
          const actualComment = (pageData.comments && pageData.comments[idx] && pageData.comments[idx].content) || '';
          const originalText = actualComment || p.original_comment || '';
          const userLink = (pageData.comments && pageData.comments[idx] && pageData.comments[idx].userLink) || '';
          if (!author || !originalText) continue;
          likeList.push({ author, originalText, commentIdx: idx, userLink });
        }
        if (likeList.length === 0) return;
        addLog(`👍 开始自动点赞 ${likeList.length} 个用户（全程锁定串行）...`, 'info');
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'likeCommentsBatch', list: likeList });
        } catch (_) {}
      } catch (_) {}
    })();

    // ========== 用 DOM API 重新渲染（避开 innerHTML 潜在的兼容问题） ==========
    // 清空容器
    while (container.firstChild) container.removeChild(container.firstChild);

    // ★ 重新插入已回复 Banner（如果有）
    if (repliedBanner) container.appendChild(repliedBanner);

    // 1) 原始响应折叠面板
    const details = document.createElement('details');
    details.style.cssText = 'margin-bottom:6px;font-size:11px;';
    const summaryEl = document.createElement('summary');
    summaryEl.style.cssText = 'cursor:pointer;color:#999;padding:4px;';
    summaryEl.textContent = '📄 API 原始响应（点击展开）';
    details.appendChild(summaryEl);
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#f5f5f5;padding:6px;border-radius:4px;font-size:10px;max-height:120px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#333;';
    pre.textContent = JSON.stringify(result, null, 2);
    details.appendChild(pre);
    container.appendChild(details);

    // 2) 统计栏
    const stats = document.createElement('div');
    stats.className = 'scan-stats';
    if (filteredCount > 0) {
      stats.innerHTML = `📊 共 ${commentCount} 条评论 · <span style="display:inline-block;background:#fff3cd;color:#856404;padding:0 6px;border-radius:3px;font-weight:600;">已过滤 ${filteredCount} 条已回复</span> · 发现 ${prospects.length} 个潜在客户`;
    } else {
      stats.textContent = `📊 共 ${commentCount} 条评论 · 发现 ${prospects.length} 个潜在客户`;
    }
    container.appendChild(stats);

    // 博文评论次数提示
    if (noteCommentWarning) {
      const warnDiv = document.createElement('div');
      warnDiv.style.cssText = 'font-size:11px;padding:6px 10px;border-radius:4px;margin-bottom:6px;background:#fff3e0;color:#e65100;border:1px solid #ffe0b2;line-height:1.5;';
      warnDiv.textContent = noteCommentWarning;
      container.appendChild(warnDiv);
    }

    // 3) 卡片或空状态
    if (prospects.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-prospect';
      emptyDiv.innerHTML = `
        <div style="font-size:28px;margin-bottom:10px;">🔍</div>
        <div style="font-size:14px;color:#333;margin-bottom:6px;font-weight:500;">本轮未发现潜在客户</div>
        <div style="font-size:12px;color:#555;line-height:1.6;max-width:400px;margin:0 auto;">${esc(summary || '没有用户表现出与产品相关的明确需求，试试在其他笔记页面使用。')}</div>
        <button id="retryProspectBtn" class="retry-btn">🔄 重新扫描</button>
        <div style="margin-top:6px;font-size:11px;color:#aaa;">💡 建议：找与你产品领域相关的笔记</div>`;
      container.appendChild(emptyDiv);
      document.getElementById('retryProspectBtn')?.addEventListener('click', async () => {
        addLog('🔄 重新扫描（未发现客户）', 'info');
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await refreshData();
      });
      setStatus('🎯 扫描完成 · 未发现潜在客户', 'success');
      broadcastAiScanDone(false); // ★ 本篇无商机结束，通知机器人返回列表
      return;
    }

    setStatus(`🎯 发现 ${prospects.length} 个潜在客户`, 'success');

    // ★ 大窗：扫描完成发布状态给小窗只读卡
    if (MODE_BIG) publishStepStatus(null, 'ready');

    // 摘要
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'prospect-summary';
    summaryDiv.textContent = summary;
    container.appendChild(summaryDiv);

    /* ★ 小窗分步模式：不渲染全卡片，改进入「屏2 进度 / 屏3 逐条」 */
    if (!MODE_BIG && typeof StepFlow !== 'undefined') {
      // 保存商机与评论索引映射，供 StepFlow 逐条使用
      pageData.prospects = prospects.map((p, i) => {
        const idx = p._origIdx !== undefined && p._origIdx >= 0
          ? p._origIdx
          : (originalIdxMap[p.index] !== undefined ? originalIdxMap[p.index] : p.index);
        return Object.assign({}, p, { index: idx });
      });
      pageData.prospectsFull = prospects;
      StepFlow.reset();
      StepFlow.note = { title: (pageData.title || (pageData.noteData && pageData.noteData.title) || '当前笔记') };
      await StepFlow.enterStep2(StepFlow.note);
      setStatus('✅ 评论分析完成，进入分步处理', 'success');
      return; // 不再渲染卡片列表（屏3 逐条消费）
    }

    // 卡片
    prospects.forEach((p, i) => {
      // 优先使用验证阶段修正的 _origIdx，否则通过映射表计算
      const idx = p._origIdx !== undefined && p._origIdx >= 0
        ? p._origIdx
        : (originalIdxMap[p.index] !== undefined ? originalIdxMap[p.index] : p.index);
      const author = p.author || (pageData.comments[idx] ? pageData.comments[idx].author : '');
      // 优先使用页面实际评论原文（避免AI截断导致无法在页面上定位）
      const actualComment = (pageData.comments && pageData.comments[idx] && pageData.comments[idx].content) || '';
      const content = actualComment || p.original_comment || p.content || '';
      // 获取用户主页链接（用于精准定位）
      const userLink = (pageData.comments && pageData.comments[idx] && pageData.comments[idx].userLink) || '';
      // 清洗 AI 可能在内容里附带的版本前缀（"版本A：" / "A：" / "（版本A正文，...）"等），并剔除空串话术
      const copies = (p.suggested_copies && p.suggested_copies.length > 0
        ? p.suggested_copies
        : (p.suggested_copy ? [p.suggested_copy] : [])
      ).map(c => stripVersionPrefix(String(c || '').trim())).filter(Boolean);
      const copyLabels = (Array.isArray(p.copy_labels) ? p.copy_labels : []).map(s => String(s || '').trim());
      const versionLabels = VERSION_LABELS;
      const versionNames = VERSION_NAMES;
      // ★ 默认选中 AI 推荐的 best 版（0=A 1=B 2=C）；自动灌水发送时也用该版
      const bestIdx = (copies.length > 0 && Number.isInteger(p.best_index) && p.best_index >= 0 && p.best_index < copies.length) ? p.best_index : 0;

      // 日志：显示AI生成的每版话术
      addLog(`💬 商机${i + 1} @${p.author || '未知'} 的话术：`, 'info');
      copies.forEach((copy, vi) => {
        const charCount = copy.length;
        const tag = copies.length > 1 ? `版本${vi + 1}${vi === bestIdx ? '（推荐）' : ''}${copyLabels[vi] ? ' · ' + copyLabels[vi] : ''}` : '话术';
        addLog(`  [${tag}] (${charCount}字):`, 'info');
        addLog(`    ${copy.slice(0, 150)}${copy.length > 150 ? '...' : ''}`, 'info');
      });

      const card = document.createElement('div');
      card.className = 'card prospect-card';
      card.dataset.currentVersion = String(bestIdx);

      // 构建版本切换按钮（纯文字，不带【】标记）；只有一版/没有话术时不显示切换条
      let tabsHtml = copies.length > 1 ? '<div class="version-tabs" style="display:flex;gap:4px;margin-bottom:6px;">' : '';
      copies.forEach((_, vi) => {
        const active = vi === bestIdx ? ' active' : '';
        const vName = versionNames[vi] || '';
        const label = (vi === bestIdx ? '⭐ ' : '') + '版本' + (vi + 1) + (copyLabels[vi] ? ' · ' + copyLabels[vi] : '');
        tabsHtml += `<button class="version-tab${active}" data-prospect="${i}" data-ver="${vi}">${label}</button>`;
      });
      if (copies.length > 1) tabsHtml += '</div>';

      const defaultCopy = (copies[bestIdx] || '') ? esc(copies[bestIdx]) : '';
      const defaultRaw = copies[bestIdx] || '';

      const verifiedBadge = p._verified
        ? ''
        : p._wasFixed
          ? '<span style="display:inline-block;font-size:10px;background:#fff3cd;color:#856404;padding:1px 6px;border-radius:3px;margin-left:4px;">已修正</span>'
          : '<span style="display:inline-block;font-size:10px;background:#fce4e4;color:#c62828;padding:1px 6px;border-radius:3px;margin-left:4px;">⚠️ 索引异常</span>';

      card.innerHTML = `
        <div class="prospect-badge">潜在客户 #${i + 1}${verifiedBadge}</div>
        <div class="prospect-meta">
          <span class="prospect-author comment-clickable" data-idx="${idx}">@${esc(author)}</span>
          <span style="font-size:11px;color:#999;">${esc(p.approach || '回复')}</span>
        </div>
        <div class="prospect-quote">“${esc(content) || '（原评论缺失）'}”</div>
        <div class="prospect-reason">💡 ${esc(p.interest_reason || '')}</div>
        <div class="prospect-reply-box">
          <div class="prospect-reply-label">✍️ 回复话术（可编辑 · 点击版本切换）</div>
          ${tabsHtml}
          <div class="reply-box">
            <textarea id="replyText_${i}" rows="5" placeholder="${copies.length ? '输入回复内容...' : '（AI 未生成话术，可手动输入）'}">${defaultCopy}</textarea>
          </div>
          <div class="reply-actions">
            <button class="copy-btn" data-prospect="${i}" data-raw="${esc(defaultRaw)}">复制</button>
            <button class="locate-btn" data-prospect="${i}" data-idx="${idx}" data-author="${esc(author)}" data-original="${esc(content)}" data-userlink="${esc(userLink)}">📍 定位</button>
            <button class="interact-btn" data-prospect="${i}" data-idx="${idx}" data-author="${esc(author)}" data-original="${esc(content)}" data-userlink="${esc(userLink)}">💗 点赞关注</button>
            <button class="send-btn" data-prospect="${i}" data-idx="${idx}" data-author="${esc(author)}" data-original="${esc(content)}" data-userlink="${esc(userLink)}">
              📤 一键发送
            </button>
            ${editionFeatureOn('prospectList') ? `<button class="addlist-btn" data-prospect="${i}" data-idx="${idx}" data-author="${esc(author)}" data-original="${esc(content)}" data-userlink="${esc(userLink)}" style="font-size:11px;padding:3px 8px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:4px;cursor:pointer;">➕ 入清单</button>` : ''}
          </div>
          <div id="sendResult_${i}" class="send-result"></div>
        </div>`;
      container.appendChild(card);
    });

    // ── AI 筛选入库（不再靠关键词：AI 从评论里筛出值得收进清单跟进的人，可一键全入库）──
    //    线索入库属「通知/私信」获客清单（全功能版专属），未开通版本不显示这块
    if (editionFeatureOn('prospectList')) try {
      const aiCapture = document.createElement('details');
      aiCapture.style.cssText = 'margin:6px 0;font-size:11px;border:1px solid #c4b5fd;border-radius:6px;padding:6px;background:#f5f3ff;';
      const aiSummary = document.createElement('summary');
      aiSummary.style.cssText = 'cursor:pointer;color:#6d28d9;font-weight:600;';
      aiSummary.textContent = '🧠 AI 筛选入库（筛出值得跟进的人，不靠关键词）';
      aiCapture.appendChild(aiSummary);
      const aiBody = document.createElement('div');
      aiBody.style.cssText = 'margin-top:6px;';
      aiBody.innerHTML = '<button id="aiRunCapture" style="width:100%;font-size:11px;padding:5px;border:1px solid #7c3aed;background:#fff;color:#6d28d9;border-radius:6px;cursor:pointer;">⚡ 开始 AI 筛选</button><div id="aiCapHint" style="color:#999;margin-top:4px;">点击后用 AI 从评论区挑出值得收进清单的人（宽口径，先收再跟进）</div>';
      aiCapture.appendChild(aiBody);
      container.appendChild(aiCapture);

      aiBody.querySelector('#aiRunCapture').addEventListener('click', async () => {
        const btn = aiBody.querySelector('#aiRunCapture');
        const hintEl = aiBody.querySelector('#aiCapHint');
        const comments = (filteredComments || []).map((c, i) => ({ idx: i, author: c.author, content: c.content, userLink: c.userLink }));
        if (!comments.length) { hintEl.textContent = '❌ 本页没有可筛评论'; return; }
        btn.disabled = true; btn.textContent = '⏳ AI 筛选中...'; hintEl.textContent = '';
        try {
          const pname = (await getConfigSafe()).product?.name || '';
          const r = await chrome.runtime.sendMessage({ action: 'aiScreenCapture', data: { comments, productHint: pname } });
          if (!r || !r.ok) throw new Error((r && r.error) || 'AI 筛选失败');
          const picked = r.picked || [];
          if (!picked.length) { hintEl.textContent = '😐 AI 认为这条没有值得收的人'; btn.disabled = false; btn.textContent = '⚡ 开始 AI 筛选'; return; }
          // 渲染候选列表
          hintEl.innerHTML = '';
          const listEl = document.createElement('div');
          picked.forEach((c, hi) => {
            const m = (c.userLink || '').match(/\/user\/(?:profile\/)?([\w-]+)/);
            const rowEl = document.createElement('div');
            rowEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding:3px 0;border-top:1px solid #e9e0ff;';
            rowEl.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">@${esc(c.author || '?')}：${esc((c.content || '').slice(0, 40))} <span style="color:#a78bfa;">${esc(c.why || '')}</span></span>
              <button class="ai-cap-add" style="flex:none;font-size:10px;padding:2px 8px;border:1px solid #7c3aed;background:#fff;color:#6d28d9;border-radius:4px;cursor:pointer;" data-i="${hi}" data-idx="${c.idx}">➕ 入库</button>`;
            rowEl.querySelector('.ai-cap-add').addEventListener('click', async (e) => {
              const b2 = e.currentTarget; b2.disabled = true;
              const per = picked[parseInt(b2.dataset.i, 10)];
              const mm = (per.userLink || '').match(/\/user\/(?:profile\/)?([\w-]+)/);
              const r2 = await chrome.runtime.sendMessage({ action: 'addProspect', data: {
                userId: mm ? mm[1] : '', nickname: per.author || '未知用户',
                source: { noteTitle: pageData.title || '', noteUrl: pageData.url || '', comment: per.content || '', userUrl: per.userLink || '' },
                keywordHit: 'AI筛选', origin: 'AI筛选',
              } });
              b2.textContent = (r2 && r2.ok) ? '✅' : '❌';
              setTimeout(() => { b2.textContent = '➕ 入库'; b2.disabled = false; }, 1500);
            });
            listEl.appendChild(rowEl);
          });
          hintEl.appendChild(listEl);
          const allB = document.createElement('button');
          allB.style.cssText = 'width:100%;margin-top:5px;font-size:11px;padding:4px;border:1px solid #7c3aed;background:#ede9fe;color:#6d28d9;border-radius:4px;cursor:pointer;';
          allB.textContent = `✅ 全部入库 ${picked.length} 条`;
          allB.addEventListener('click', async () => {
            allB.disabled = true; let ok = 0;
            for (const per of picked) {
              const mm = (per.userLink || '').match(/\/user\/(?:profile\/)?([\w-]+)/);
              await chrome.runtime.sendMessage({ action: 'addProspect', data: { userId: mm ? mm[1] : '', nickname: per.author || '未知用户', source: { noteTitle: pageData.title || '', noteUrl: pageData.url || '', comment: per.content || '', userUrl: per.userLink || '' }, keywordHit: 'AI筛选', origin: 'AI筛选' } });
              ok++;
            }
            allB.textContent = `✅ 已入库 ${ok} 条`; addLog(`🧠 AI 筛选入库：已入库 ${ok} 条`, 'success');
            setTimeout(() => { allB.textContent = `✅ 全部入库 ${picked.length} 条`; allB.disabled = false; }, 1800);
          });
          listEl.appendChild(allB);
          hintEl.appendChild(listEl);
        } catch (e) { hintEl.textContent = '❌ ' + e.message; }
        btn.disabled = false; btn.textContent = '⚡ 重新 AI 筛选';
      });
    } catch (_) {}

    bindScrollToComment();

    document.querySelectorAll('.prospect-card .copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prospectIdx = btn.dataset.prospect;
        const textarea = document.getElementById(`replyText_${prospectIdx}`);
        if (!textarea) return;
        const text = textarea.value.trim();
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '已复制 ✓';
          setTimeout(() => { btn.textContent = '复制'; }, 1500);
        });
      });
    });

    // 版本切换
    document.querySelectorAll('.version-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const prospectIdx = tab.dataset.prospect;
        const verIdx = parseInt(tab.dataset.ver);
        const p = prospects[parseInt(prospectIdx)];
        if (!p) return;
        const copies = (p.suggested_copies && p.suggested_copies.length > 0
          ? p.suggested_copies
          : (p.suggested_copy ? [p.suggested_copy] : [])
        ).map(c => stripVersionPrefix(String(c || '').trim())).filter(Boolean);
        const rawText = copies[verIdx] || '';
        const textarea = document.getElementById(`replyText_${prospectIdx}`);
        if (textarea) {
          textarea.value = rawText;
        }
        // 更新高亮
        const card = tab.closest('.prospect-card');
        if (card) {
          card.querySelectorAll('.version-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
        }
      });
    });

    document.querySelectorAll('.send-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const prospectIdx = btn.dataset.prospect;
        const commentIdx = btn.dataset.idx;
        const author = btn.dataset.author;
        const original = btn.dataset.original;
        const userLink = btn.dataset.userlink || '';

        const textarea = document.getElementById(`replyText_${prospectIdx}`);
        if (!textarea) return;

        const replyText = textarea.value.trim();
        if (!replyText) {
          showSendResult(prospectIdx, '请输入回复内容', 'fail');
          return;
        }

        btn.disabled = true;
        btn.textContent = '发送中...';
        btn.classList.add('sending');

        try {
          const tab = await getTargetTab();
          if (!tab) {
            showSendResult(prospectIdx, '不在小红书页面', 'fail');
            btn.disabled = false;
            btn.textContent = '📤 一键发送';
            btn.classList.remove('sending');
            return;
          }

          // ★ 直接执行发送（sendReplyToComment 内部已包含：定位评论 → 高亮闪烁 → 点击回复 → 填入 → 发送）
          //   （前置互动「点赞→关注→停顿」已迁移到独立的「💗 点赞关注」按钮，需要时先手动点它再发送）
          addLog(`发送回复给 @${author}...`, 'info');
          showSendResult(prospectIdx, '<span class="loading-spinner"></span> 正在定位评论并发送...', '');
          const result = await sendTabMessageWithTimeout(tab.id, {
            action: 'sendReply', author, originalText: original, replyText, commentIdx: parseInt(commentIdx), userLink,
            images: kbImages, // 传递知识库图片
            humanize: _batchSending, // ★ 只有自动批量发送才走逐字输入；手动一键发送走快速通道
          }, 60000);
          if (result && result.success) {
            if (result.verified) {
              addLog(`✅ 回复 @${author} 成功（已验证）`, 'success');
              showSendResult(prospectIdx, '✅ 回复已发送并验证通过', 'ok');
            } else {
              addLog(`⚠️ 回复 @${author} 已尝试发送（未验证）`, 'warn');
              showSendResult(prospectIdx, '⚠️ 已尝试发送但未验证到。很可能已发出，请先刷新页面确认，不要直接再点一次（防重复评论）', 'warn');
            }
            // 标记按钮为"已灌水" (req 1)
            markAsWatered(prospectIdx, author, original);
            // 保存到本地存储
            try {
              addLocalReply(pageData?.url || '', author, original);
            } catch (_) {}
          } else {
            addLog(`❌ 回复 @${author} 失败: ${result?.error || '未知'}`, 'error');
            showSendResult(prospectIdx, `❌ ${result?.error || '发送失败'}`, 'fail');
          }
        } catch (e) {
          // ★ 通道断裂（message port closed 等）≠ 发送失败：页面侧很可能已把评论发出去了，
          // 不能显示“❌ 失败”误导用户重发 → 重复评论
          const msg = String(e?.message || e);
          if (/message port closed|Receiving end does not exist|context invalidated/i.test(msg)) {
            addLog(`⚠️ 与页面通道中断，回复 @${author} 可能已发出: ${msg}`, 'warn');
            showSendResult(prospectIdx, '⚠️ 与页面的连接中断，但回复很可能已发出。请先刷新页面确认，不要直接重发（防重复评论）', 'warn');
          } else {
            showSendResult(prospectIdx, `❌ ${msg}`, 'fail');
          }
        }
        btn.disabled = false;
        btn.textContent = '📤 一键发送';
        btn.classList.remove('sending');
        // ★ 无论成功/失败都置“处理完毕”标记（已含前置点赞+关注+发送），
        // 供批量发送循环判断推进；失败时也能立刻进下一条，不再干等超时
        btn.dataset.sendDone = String(Date.now());
      });
    });

    // ── 前置互动按钮（点赞+关注，不发送）——原「一键发送」里的前置互动独立出来，由用户手动控制 ──
    document.querySelectorAll('.interact-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const prospectIdx = btn.dataset.prospect;
        const commentIdx = btn.dataset.idx;
        const author = btn.dataset.author;
        const original = btn.dataset.original;
        const userLink = btn.dataset.userlink || '';

        btn.disabled = true;
        btn.textContent = '互动中...';
        btn.classList.add('working');

        try {
          const tab = await getTargetTab();
          if (!tab) {
            showSendResult(prospectIdx, '不在小红书页面', 'fail');
            btn.disabled = false;
            btn.textContent = '💗 点赞关注';
            btn.classList.remove('working');
            return;
          }

          // 点赞（失败不阻断后续关注）
          let liked = false;
          try {
            showSendResult(prospectIdx, '<span class="loading-spinner"></span> 正在为 @' + author + ' 点赞...', '');
            const likeResult = await chrome.tabs.sendMessage(tab.id, {
              action: 'likeComment', author, originalText: original, commentIdx: parseInt(commentIdx), userLink,
            });
            if (likeResult?.success) {
              liked = true;
              likedComments.push({
                author,
                textSnippet: (original || '').slice(0, 60),
                time: Date.now(),
              });
              renderLikedList();
              addLog(likeResult.alreadyLiked ? `@${author} 已点过赞` : `已为 @${author} 点赞`, 'info');
            } else {
              addLog(`点赞 @${author} 失败: ${likeResult?.error || '未知'}`, 'warn');
            }
          } catch (_) {}

          // 关注（按行为配置开关；先停 preSendGap 再关注，像真人操作间隔）
          let followed = false;
          try {
            const behavior = await getBehaviorConfig();
            if (behavior.autoFollow !== false) {
              await sleep(await getDwellMs('preSendGap', 0));
              showSendResult(prospectIdx, '<span class="loading-spinner"></span> 正在关注 @' + author + '...', '');
              await chrome.tabs.sendMessage(tab.id, { action: 'followUser', author });
              followed = true;
              addLog(`已关注 @${author}`, 'info');
            } else {
              addLog(`⏭ 按配置跳过关注 @${author}`, 'info');
            }
          } catch (_) {}

          if (liked || followed) {
            const parts = [];
            if (liked) parts.push('已点赞');
            if (followed) parts.push('已关注');
            showSendResult(prospectIdx, `✅ 前置互动完成：${parts.join(' + ')} @${author}`, 'ok');
          } else {
            showSendResult(prospectIdx, '⚠️ 点赞/关注均未成功，请看日志', 'warn');
          }
        } catch (e) {
          showSendResult(prospectIdx, `❌ ${String(e?.message || e)}`, 'fail');
        }
        btn.disabled = false;
        btn.textContent = '💗 点赞关注';
        btn.classList.remove('working');
      });
    });

    // ── 加入获客清单按钮 ──
    document.querySelectorAll('.addlist-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const author = btn.dataset.author;
        const original = btn.dataset.original;
        const userLink = btn.dataset.userlink || '';
        const idx = parseInt(btn.dataset.idx);
        // 提取 userId（从 userLink /user/{id}）
        const m = (userLink || '').match(/\/user\/(?:profile\/)?([\w-]+)/);
        const userId = m ? m[1] : '';
        const person = {
          userId,
          nickname: author || '未知用户',
          source: {
            noteTitle: pageData.title || '',
            noteUrl: pageData.url || '',
            comment: original || '',
            userUrl: userLink || '',
            stageEntry: 'AI路由',   // ★ 搜索评论的商机卡片 → 主动联系 → 直接进商机池
          },
          keywordHit: null,
          origin: '手动',
          stage: 'lead',       // ★ 主动联系的商机：我方单方收集、未双向 → 进线索池，触达后对方回复才升商机
        };
        btn.disabled = true;
        try {
          const resp = await chrome.runtime.sendMessage({ action: 'addProspect', data: person });
          if (resp && resp.ok) {
            btn.textContent = resp.added ? '✅ 已入清单' : '✅ 已在清单';
            addLog(`${resp.added ? '➕ 已加入' : '➖ 已在'}用户清单：@${author}`, 'success');
          } else {
            btn.textContent = '➕ 入清单';
            btn.disabled = false;
            addLog(`❌ 加入清单失败：${(resp && resp.error) || '未知'}`, 'error');
          }
        } catch (e) {
          btn.textContent = '➕ 入清单';
          btn.disabled = false;
          addLog(`❌ 加入清单失败：${e.message}`, 'error');
        }
        setTimeout(() => { btn.textContent = resp && resp.ok ? (resp.added ? '➕ 入清单' : '➕ 入清单') : '➕ 入清单'; btn.disabled = false; }, 2000);
      });
    });

    // ── 定位按钮（手动定位评论、点击回复，但不自动发送） ──
    document.querySelectorAll('.locate-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const prospectIdx = btn.dataset.prospect;
        const commentIdx = btn.dataset.idx;
        const author = btn.dataset.author;
        const original = btn.dataset.original;
        const userLink = btn.dataset.userlink || '';

        btn.disabled = true;
        btn.textContent = '定位中...';

        try {
          const tab = await getTargetTab();
          if (!tab) {
            showSendResult(prospectIdx, '不在小红书页面', 'fail');
            btn.disabled = false;
            btn.textContent = '📍 定位';
            return;
          }

          showSendResult(prospectIdx, '<span class="loading-spinner"></span> 正在定位评论...', '');
          const result = await chrome.tabs.sendMessage(tab.id, {
            action: 'locateReply', author, originalText: original, commentIdx: parseInt(commentIdx), userLink,
          });
          if (result && result.success) {
            showSendResult(prospectIdx, '✅ 已定位并打开回复框，请手动输入', 'ok');
          } else {
            showSendResult(prospectIdx, `❌ ${result?.error || '定位失败'}`, 'fail');
          }
        } catch (e) {
          showSendResult(prospectIdx, `❌ ${e.message}`, 'fail');
        }
        btn.disabled = false;
        btn.textContent = '📍 定位';
      });
    });

    // ★ 商机已成功渲染完毕（#mainContent 里已存在 .send-btn）→ 通知机器人“本篇扫描成功、可开始发送”。
    //   修复：成功路径此前从不广播（broadcastAiScanDone 全仓库都只传 false），机器人收不到成功信号，
    //   只能靠 _waterCurrentNote 里对 #mainContent .send-btn 的 DOM 监听兜底——若卡片/按钮不在该容器或监听没兜住，
    //   机器人就会干等 180s 超时后返回“没发送”，而自动点赞早已执行（表现为“只点赞、不发送”），
    //   且因未登记 noteChecked/markWatered，同一篇被循环计划反复挑中、无限循环。
    broadcastAiScanDone(true);

  } catch (e) {
    console.error('[商机挖掘] 错误:', e);
    setStatus(`❌ 扫描失败: ${e.message}`, 'error');
    while (container.firstChild) container.removeChild(container.firstChild);
    const errDiv = document.createElement('div');
    errDiv.className = 'empty-state';
    errDiv.style.cssText = 'padding:20px;';
    errDiv.innerHTML = `
      <div class="emoji">😵</div>
      <p style="color:#c62828;font-size:14px;">AI 调用失败</p>
      <p style="font-size:11px;color:#555;margin-top:4px;">${esc(e.message)}</p>
      ${e.aiRaw ? `<details style="margin-top:8px;text-align:left;background:#f7f7f7;border:1px solid #e0e0e0;border-radius:6px;padding:8px;"><summary style="cursor:pointer;font-size:11px;font-weight:600;color:#333;">📋 AI 原始回复（${e.aiRaw.length} 字 · 点击展开）</summary><pre style="white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;margin:8px 0 0;font-size:11px;line-height:1.5;color:#444;">${esc(e.aiRaw)}</pre><button id="copyAiRawBtn" class="retry-btn" style="margin-top:8px;font-size:11px;">📋 复制全文</button></details>` : ''}
      <button id="retryAiBtn" class="retry-btn">🔄 重试</button>`;
    container.appendChild(errDiv);
    broadcastAiScanDone(false); // ★ AI 分析失败，通知机器人返回列表（不再干等 180s 超时）
    document.getElementById('copyAiRawBtn')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(e.aiRaw); } catch (_) {}
    });
    document.getElementById('retryAiBtn')?.addEventListener('click', async () => {
      setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
      await loadProspecting(container);
    });
  }
}

// ========== 同行碰撞笔记 → 只收求分享线索、不灌水 ==========
// 判定命中的"求分享"评论 → 收入用户清单线索池(stage=lead) + 为每人生成触达词（可编辑）+ 一键私信触达。
// 不渲染 .send-btn → 手动获客/自动灌水对本篇都不会发评论。
async function renderShareLeads(container, shareHits, opts) {
  opts = opts || {};
  while (container.firstChild) container.removeChild(container.firstChild);
  if (opts.repliedBanner) container.appendChild(opts.repliedBanner);

  const noteCommentWarning = opts.noteCommentWarning || '';
  if (noteCommentWarning) {
    const warnDiv = document.createElement('div');
    warnDiv.style.cssText = 'font-size:11px;padding:6px 10px;border-radius:4px;margin-bottom:6px;background:#fff3e0;color:#e65100;border:1px solid #ffe0b2;line-height:1.5;';
    warnDiv.textContent = noteCommentWarning;
    container.appendChild(warnDiv);
  }

  const _leadsOn = editionFeatureOn('prospectList');   // 获客清单（通知/私信）为全功能版专属

  // 统计横幅
  const banner = document.createElement('div');
  banner.style.cssText = 'font-size:12px;padding:8px 10px;border-radius:6px;margin-bottom:8px;background:#fff4e5;color:#8a5a00;border:1px solid #f6d9a8;line-height:1.5;';
  banner.innerHTML = _leadsOn
    ? `🚦 判定为<b>同行碰撞笔记</b>（评论区 ${shareHits.length} 条求分享），<b>本笔记不灌水</b>。<br>已将 ${shareHits.length} 位"求分享"用户收入<b>用户清单 · 线索池</b>，备好触达词可直接<b>私信触达</b>。`
    : `🚦 判定为<b>同行碰撞笔记</b>（评论区 ${shareHits.length} 条求分享），<b>本笔记不灌水</b>。`;
  container.appendChild(banner);

  const noteTitle = (pageData && pageData.title) || (pageData && pageData.noteData && pageData.noteData.title) || '';
  const noteUrl = (pageData && pageData.url) || '';

  const stats = document.createElement('div');
  stats.className = 'scan-stats';
  stats.textContent = _leadsOn
    ? `🎇 ${shareHits.length} 位求分享用户已入线索池 · 不评论（避免碰撞）`
    : `🚫 本篇不评论（避免碰撞）· 直接换下一篇`;
  container.appendChild(stats);

  // 无获客清单版本：只提示「本篇不灌水」，不写线索池、不给私信入口
  if (!_leadsOn) return;

  for (let i = 0; i < shareHits.length; i++) {
    const h = shareHits[i] || {};
    const author = h.author || '未知用户';
    const content = (h.content || '');
    const userLink = h.userLink || '';
    const m = String(userLink || '').match(/\/user\/?(?:profile\/)?([\w-]+)/);
    const userId = m && m[1] ? m[1] : '';
    // 预填一份可用的触达词模板（避免每次扫描都烧 N 次 AI；用户可用「✨ 生成触达词」换成 AI 个性化版）
    const defaultDm = `看到你在「${(noteTitle || '那篇笔记')}」下求分享，正好我手上有相关的整理，可以发你。有需要的话跟我说，我发你。`;

    const card = document.createElement('div');
    card.className = 'card prospect-card';
    card.dataset.leadIdx = String(i);
    card.innerHTML = `
      <div class="prospect-badge">🎇 求分享线索 #${i + 1}<span style="display:inline-block;font-size:10px;background:#ecfdf5;color:#0f766e;padding:1px 6px;border-radius:3px;margin-left:4px;">线索池</span></div>
      <div class="prospect-meta">
        <span class="prospect-author">@${esc(author)}</span>
        <span style="font-size:11px;color:#999;">在「${esc((noteTitle || '本篇笔记').slice(0, 20))}」下求分享</span>
      </div>
      <div class="prospect-quote">“${esc(content) || '（原文缺失）'}”</div>
      <div style="font-size:11px;color:#999;margin:2px 0 6px;">💬 已加入用户清单线索池 — 私信对方即自动升为商机</div>
      <div class="prospect-reply-box">
        <div class="prospect-reply-label">💬 私信触达词（可编辑 · 一键生成后直接发）</div>
        <div class="reply-box">
          <textarea id="leadDm_${i}" rows="4" placeholder="点击「✨ 生成触达词」或手动输入私信内容...">${esc(defaultDm)}</textarea>
        </div>
        <div class="reply-actions">
          <button class="lead-gen-btn" data-i="${i}" ${userId ? '' : 'style="display:none;"'}>✨ 生成触达词</button>
          <button class="lead-dm-btn" data-i="${i}">💌 私信触达</button>
        </div>
        <div id="leadResult_${i}" class="send-result"></div>
      </div>`;
    container.appendChild(card);
  }

  // ── 入池：逐人 addProspect（线索池 stage=lead）──
  const listRespPromise = Promise.all(shareHits.map((h) => {
    const m2 = String(h.userLink || '').match(/\/user\/?(?:profile\/)?([\w-]+)/);
    const uid = m2 && m2[1] ? m2[1] : '';
    const person = {
      userId: uid,
      nickname: h.author || '未知用户',
      source: {
        noteTitle,
        noteUrl,
        comment: h.content || '',
        userUrl: h.userLink || '',
        stageEntry: '求分享',   // 入口口径：求分享线索 → 线索池
      },
      origin: '评论',
      stage: 'lead',            // 线索池（未接触）
    };
    return chrome.runtime.sendMessage({ action: 'addProspect', data: person }).catch(() => null);
  }));

  // ── 按钮事件 ──
  // 生成触达词：复用 background 的 prospect_dm 生成私信话术
  container.querySelectorAll('.lead-gen-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.i, 10);
      const h = shareHits[i];
      if (!h) return;
      btn.disabled = true; btn.textContent = '⏳ 生成中...';
      const mm = String(h.userLink || '').match(/\/user\/?(?:profile\/)?([\w-]+)/);
      const person = {
        userId: mm && mm[1] ? mm[1] : '',
        nickname: h.author || '未知用户',
        source: { noteTitle, noteUrl, comment: h.content || '', userUrl: h.userLink || '', stageEntry: '求分享' },
        stage: 'lead',
      };
      try {
        const r = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person } });
        const ta = document.getElementById('leadDm_' + i);
        if (ta && r && r.ok && r.dmText) { ta.value = r.dmText; addLog(`✨ 已为 @${esc(h.author || '')} 生成触达词`, 'success'); }
        else { ta && ta.setAttribute('placeholder', '生成失败，请手写并继续'); addLog('⚠️ 触达词生成失败，可手写', 'warn'); }
      } catch (e) {
        addLog('⚠️ 触达词生成异常：' + String(e && e.message || e).slice(0, 80), 'warn');
      } finally {
        btn.disabled = false; btn.textContent = '✨ 生成触达词';
      }
    });
  });

  // 私信触达：调 background sendDm（开主页→点私信→聊天窗→发送）
  container.querySelectorAll('.lead-dm-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.i, 10);
      const h = shareHits[i];
      if (!h) return;
      const ta = document.getElementById('leadDm_' + i);
      const text = (ta && ta.value.trim()) || '';
      const resEl = document.getElementById('leadResult_' + i);
      if (!text) { if (resEl) resEl.innerHTML = '<span style="color:#b45309;">⚠️ 请先生成或填写触达词</span>'; return; }
      const mm = String(h.userLink || '').match(/\/user\/?(?:profile\/)?([\w-]+)/);
      const person = {
        userId: mm && mm[1] ? mm[1] : '',
        nickname: h.author || '未知用户',
        source: { noteTitle, noteUrl, comment: h.content || '', userUrl: h.userLink || '', stageEntry: '求分享' },
        stage: 'lead',
      };
      btn.disabled = true; btn.textContent = '⏳ 私信中...';
      if (resEl) resEl.innerHTML = '<span class="loading-spinner"></span> 正在打开主页并发送私信...';
      try {
        const r = await chrome.runtime.sendMessage({ action: 'sendDm', data: { person, text, aiGenerated: false } });
        if (r && r.ok) {
          if (resEl) resEl.innerHTML = '<span style="color:#1f9d55;">✅ 私信已发送（触达完成·待对方回复升商机）</span>';
          addLog(`💌 已向 @${esc(h.author || '')} 发送私信触达`, 'success');
          btn.textContent = '✅ 已私信';
        } else {
          if (resEl) resEl.innerHTML = '<span style="color:#d14343;">❌ ' + esc(((r && r.error) || '').slice(0, 60) || '发送失败') + '</span>';
          addLog('⚠️ 私信未完成：' + String((r && (r.notice || r.error)) || '未知').slice(0, 80), 'warn');
          btn.disabled = false; btn.textContent = '💌 私信触达';
        }
      } catch (e) {
        const msg = (e && e.limited) ? '对方防骚扰/需先关注，请改为评论破冰' : (String((e && e.message) || e).slice(0, 80));
        if (resEl) resEl.innerHTML = '<span style="color:#d14343;">❌ ' + esc(msg) + '</span>';
        addLog('⚠️ 私信异常：' + msg, 'warn');
        btn.disabled = false; btn.textContent = '💌 私信触达';
      }
    });
  });

  // 入池结果回填（等待 addProspect 完成，幂等：已存在则当作成功）
  try {
    const results = await listRespPromise;
    const added = results.filter(r => r && r.ok).length;
    addLog(`🎇 已确认 ${added}/${shareHits.length} 位求分享用户进入线索池（其余可能已在清单中）`, added > 0 ? 'success' : 'info');
  } catch (_) {}

  setStatus(`🎇 已收 ${shareHits.length} 位求分享线索（不灌水）`, 'success');
}

function showSendResult(prospectIdx, msg, type) {
  const el = document.getElementById(`sendResult_${prospectIdx}`);
  if (el) {
    el.innerHTML = msg;
    el.className = 'send-result ' + type;
    setTimeout(() => { el.innerHTML = ''; }, 4000);
  }
}

// ========== 操作日志系统 (req 3) ==========
let _logCount = 0;
function addLog(msg, type) {
  type = type || 'info';
  _logCount++;
  const panel = document.getElementById('logPanel');
  if (!panel) return;
  panel.style.display = 'block';
  // 如果只有初始提示，移除它
  if (panel.children.length === 1 && panel.children[0].textContent.includes('操作日志将显示在这里')) {
    panel.innerHTML = '';
  }
  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + type;
  entry.dataset.src = 'flow';
  entry.innerHTML = `<span class="log-time">${timeStr}</span>${msg}`;
  panel.appendChild(entry);
  // 自动滚动到底部
  panel.scrollTop = panel.scrollHeight;
  // 最多保留 200 条防止内存泄漏
  while (panel.children.length > 200) panel.removeChild(panel.firstChild);
  // ★ 同步镜像一份到锁定遮罩的日志区（锁定时遮罩盖住了下方日志，在这里仍能看）；最新放最上面
  window.__xhsMirrorLog(msg, type, timeStr, 'flow', '💧');
  console.log(`[${timeStr}] ${msg}`);
}

// ★ 共享日志镜像器：把一条日志同时写进【遮罩实时日志】。bot(🤖 auto-bot) 与自动灌水(💧 auto-water/popup) 两条来源都走这里，
//   并支持"全部 / 🤖只有 bot / 💧只有自动灌水"过滤——这样 bot 运行时，它的操作轨迹也能在锁屏遮罩上看得见、可分。
//   source ∈ 'bot' | 'flow'；tag 为遮罩里的来源角标。
window.__overlayLogFilter = 'all';
window.__xhsMirrorLog = function (msg, type, timeStr, source, tag) {
  source = source || 'flow';
  tag = tag || (source === 'bot' ? '🤖' : '💧');
  var ovLog = document.getElementById('lockOverlayLog');
  if (!ovLog) return;
  var f = window.__overlayLogFilter || 'all';
  if (f !== 'all' && f !== source) return;
  var c = { info: '#2a72c9', success: '#1f9d55', warn: '#b8730a', error: '#d14343' }[type] || '#5a4a2a';
  var line = document.createElement('div');
  line.dataset.src = source;                       // 供"只看 bot"过滤使用
  line.style.color = c;
  line.style.padding = '2px 0';
  line.style.borderBottom = '1px dashed #eee2c8';
  line.innerHTML = '<span style="color:#a8a090;margin-right:6px;">' + timeStr + '</span>' +
    (tag ? '<span style="color:#c41d3c;font-weight:700;margin-right:6px;">' + tag + '</span>' : '') + msg;
  ovLog.insertBefore(line, ovLog.firstChild); // 倒置：新的插到最前面
  ovLog.scrollTop = 0; // 回到顶部看最新
  while (ovLog.children.length > 200) ovLog.removeChild(ovLog.lastChild);
};
window.__setOverlayLogFilter = function (f) { window.__overlayLogFilter = f || 'all'; };
// 对已渲染的行也生效（切换过滤后，把不符合来源的行隐藏/恢复）
window._applyOverlayFilter = function () {
  var ovLog = document.getElementById('lockOverlayLog');
  if (!ovLog) return;
  var f = window.__overlayLogFilter || 'all';
  Array.prototype.forEach.call(ovLog.children, function (line) {
    var s = line.dataset.src || 'flow';
    line.style.display = (f === 'all' || s === f) ? '' : 'none';
  });
};

// ========== 操作锁状态展示（与 content.js 串行锁联动） ==========
let _lockHideTimer = null;

// AI 思考读秒：AI 请求跑在 background，content.js 的 statusUpdate 不会来，
// 所以在 popup 侧自己计时，每秒刷新遮罩顶部“当前动作”行，让用户知道 AI 在处理而非卡死
let _aiThinkingTimer = null;
let _aiStreamChars = 0; // ★ 流式：AI 已生成字数（由 aiStreamProgress 消息刷新）
function _startAiThinkingTicker() {
  _stopAiThinkingTicker();
  _aiStreamChars = 0;
  const t0 = Date.now();
  const tick = () => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const ovStatus = document.getElementById('lockOverlayStatus');
    // 有流式进度就显示“已生成 N 字”（证明在实时吐字、没卡死），否则只显示等待秒数
    if (ovStatus) {
      ovStatus.textContent = _aiStreamChars > 0
        ? `🤖 AI 正在生成话术…已生成 ${_aiStreamChars} 字（${sec} 秒）`
        : `🤖 AI 正在分析评论、生成话术…已等待 ${sec} 秒`;
    }
  };
  tick();
  _aiThinkingTimer = setInterval(tick, 1000);
}
function _stopAiThinkingTicker() {
  if (_aiThinkingTimer) { clearInterval(_aiThinkingTimer); _aiThinkingTimer = null; }
  _aiStreamChars = 0;
}

function setLockBanner(locked, label) {
  const banner = document.getElementById('lockBanner');
  const overlay = document.getElementById('lockOverlay');
  const textEl = document.getElementById('lockBannerText');
  const overlayTextEl = document.getElementById('lockOverlayText');
  const labelMap = {
    sendReply: '正在发送评论',
    locateReply: '正在定位评论',
    followUser: '正在关注用户',
    likeComment: '正在点赞评论',
    likeBatch: '正在批量点赞',
    scrollToComment: '正在定位评论',
    loadMoreComments: '正在加载更多评论',
    aiThinking: 'AI 正在分析评论、生成话术',
    chatFollow: '正在串行回复AI客服',
    chatFollowReply: '正在生成并回复评论',
    chatFollowSend: '正在发送评论回复',
  };
  if (locked) {
    if (_lockHideTimer) { clearTimeout(_lockHideTimer); _lockHideTimer = null; }
    const action = labelMap[label] || '操作进行中';
    if (textEl) textEl.textContent = `🔒 ${action}，请稍候…（串行执行，防止评论错位，此时请勿手动操作）`;
    if (overlayTextEl) overlayTextEl.textContent = `🔒 ${action}，请勿手动操作…（自动化正在执行，稍后自动解锁）`;
    if (banner) banner.style.display = 'flex';
    if (overlay) {
      // 首次弹出遮罩时，把主日志面板最近的记录同步过来（倒置：最新在上），让用户有上下文
      if (overlay.style.display !== 'flex') {
        const ovLog = document.getElementById('lockOverlayLog');
        const panel = document.getElementById('logPanel');
        if (ovLog && panel) {
          ovLog.innerHTML = '';
          // 面板是“旧→新”顺序，取最后 40 条后倒序逐条追加，使最新的在最上面
          const entries = Array.from(panel.children).slice(-40).reverse();
          for (const e of entries) {
            const line = document.createElement('div');
            line.style.color = '#8a7a58';
            line.style.padding = '2px 0';
            line.style.borderBottom = '1px dashed #eee2c8';
            line.innerHTML = e.innerHTML;
            ovLog.appendChild(line);
          }
          ovLog.scrollTop = 0;
        }
        // 首次弹出先把当前动作行置为开场提示（后续由 statusUpdate 不断刷新）
        const ovStatus = document.getElementById('lockOverlayStatus');
        if (ovStatus) ovStatus.textContent = `⚙️ ${action}…`;
      }
      overlay.style.display = 'flex';
    }
  } else {
    // 延迟隐藏，避免连续发送时横幅/遮罩闪烁
    if (_lockHideTimer) clearTimeout(_lockHideTimer);
    _lockHideTimer = setTimeout(() => {
      if (banner) banner.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
      _lockHideTimer = null;
    }, 500);
  }
}

// 监听 content.js 广播的锁状态变化
chrome.runtime.onMessage.addListener((request) => {
  if (request && request.action === 'lockStateChanged') {
    setLockBanner(request.locked, request.label);
  }
  // 批量点赞进度：content.js 每点一个就广播一条，据此实时更新已点赞列表
  if (request && request.action === 'likeProgress' && request.success) {
    try {
      likedComments.push({
        author: request.author || '',
        textSnippet: (request.originalText || '').slice(0, 60),
        time: Date.now(),
      });
      renderLikedList();
      console.log(`[自动点赞] ${request.author}: ${request.alreadyLiked ? '已点过' : '已点赞'}`);
    } catch (_) {}
  }
  // ★ 当前动作（含等待读秒）：content.js 每切一步/每过一秒都广播，刷新遮罩顶部“正在干啥”
  if (request && request.action === 'statusUpdate') {
    const ovStatus = document.getElementById('lockOverlayStatus');
    if (ovStatus && request.text) {
      ovStatus.textContent = request.text;
    }
  }
  // ★ AI 流式生成进度：background 每生成一段就广播已生成字数，让用户看到实时在吐字（读秒器会接手显示）
  if (request && request.action === 'aiStreamProgress') {
    _aiStreamChars = request.chars || 0;
  }
  // ★ AI 两阶段切换：background 在“快筛→生成话术”之间广播，同步刷新日志和网页红色状态条
  if (request && request.action === 'aiPhase') {
    if (request.phase === 'screening') {
      addLog(`⚡ AI 第1步：快筛 ${request.count || ''} 条评论价值 + 核对抓取质量…（只要几秒）`, 'info');
      _setTabStatusBar('⚡ AI 第1步：快筛评论价值、核对抓取…');
    } else if (request.phase === 'generating') {
      addLog('🤖 AI 第2步：为选中的评论生成话术…（网络请求中，请稍候）', 'info');
      _setTabStatusBar('🤖 AI 第2步：正在生成话术…（请稍候）');
    }
  }
});

// ========== 笔记列表交叉核对（用搜索抛到的 foundNotes 剔除“把卡片当评论”）==========
// 思路：搜索功能早已把笔记列表（作者+点赞数+标题）存到 auto_water_state.searchState.foundNotes。
// 一旦“评论”的 作者+正文 恰好等于某张卡片的 作者+点赞数（或正文命中某个笔记标题），
// 就能 100% 判定它是背景信息流里的卡片而非真评论。
const _AW_STATE_KEY = 'auto_water_state';

/** 读取搜索抛到的笔记列表（可能为空——用户没走过搜索时） */
async function loadFoundNotes() {
  try {
    const data = await chrome.storage.local.get(_AW_STATE_KEY);
    const st = data[_AW_STATE_KEY];
    return (st && st.searchState && st.searchState.foundNotes) || [];
  } catch (_) {
    return [];
  }
}

/** 归一化：去 @/空白、转小写 */
function _normMatch(s) {
  return String(s || '').replace(/^@/, '').replace(/\s+/g, '').toLowerCase().trim();
}

/** 当前页 URL 里的 noteId（用于排除“当前笔记本身”，不把它当背景卡片） */
function _noteIdFromUrl(u) {
  const m = String(u || '').match(/\/(?:explore|discovery\/item|search_result)\/([a-f0-9]+)/);
  return m ? m[1] : '';
}

/** 把一条“评论”与笔记列表比对，命中则说明它其实是列表卡片 */
function _commentMatchesNoteCard(c, notes, curNoteId) {
  const author = _normMatch(c.author);
  const body = _normMatch(c.content);
  if (!body) return false;
  const bodyIsNumeric = /^[\d.,]+[\u4e07wk\uff0b+]*$/i.test(body); // 正文就是个数字/万 → 像点赞数
  for (const n of notes) {
    if (curNoteId && n.noteId === curNoteId) continue; // 跳过当前笔记自身
    const nAuthor = _normMatch(n.author);
    const nLikes = _normMatch(n.likes);
    const nTitle = _normMatch(n.title);
    // 规则1：作者对得上 + （正文等于该片点赞数 或 正文就是个数字）
    if (nAuthor && author && author === nAuthor && ((nLikes && body === nLikes) || bodyIsNumeric)) {
      return true;
    }
    // 规则2：正文命中某篇笔记标题（标题够长才算，避免误伤）
    if (nTitle && nTitle.length >= 6 && (body === nTitle || body.includes(nTitle) || nTitle.includes(body))) {
      return true;
    }
  }
  return false;
}

/** 交叉核对：返回 { kept, removed }（removed = 被判定为笔记卡片的假评论） */
function crossCheckComments(comments, notes, curNoteId) {
  if (!notes || notes.length === 0) return { kept: comments, removed: [] };
  const kept = [], removed = [];
  for (const c of comments) {
    if (_commentMatchesNoteCard(c, notes, curNoteId)) removed.push(c);
    else kept.push(c);
  }
  return { kept, removed };
}

// ========== 已灌水跟踪（持久化到 chrome.storage.local）==========
const WATERED_KEY = 'watered_notes';
let _wateredSet = new Set(); // 内存缓存，存 "noteUrl||author||originalText"

/** 获取所有已灌水的笔记 URL 集合 */
async function loadWateredNoteUrls() {
  try {
    const data = await chrome.storage.local.get(WATERED_KEY);
    return new Set(data[WATERED_KEY] || []);
  } catch (_) {
    return new Set();
  }
}

/** 保存一条已灌水笔记 URL 到持久存储 */
async function saveWateredNoteUrl(noteUrl) {
  if (!noteUrl) return;
  try {
    const data = await chrome.storage.local.get(WATERED_KEY);
    const urls = data[WATERED_KEY] || [];
    if (!urls.includes(noteUrl)) {
      urls.push(noteUrl);
      await chrome.storage.local.set({ [WATERED_KEY]: urls });
    }
  } catch (_) {}
}

function markAsWatered(prospectIdx, author, originalText) {
  const btn = document.querySelector(`.send-btn[data-prospect="${prospectIdx}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '✅ 已灌水';
    btn.classList.remove('sending');
    btn.classList.add('watered');
    btn.style.background = '#9ca3af';
    // 整条评论卡片也变灰 (req 5)
    const card = btn.closest('.prospect-card');
    if (card) {
      card.style.opacity = '0.5';
      card.style.background = '#f0f0f0';
      card.style.borderLeftColor = '#9ca3af';
      card.classList.add('watered');
    }
  }
  // 也记住已灌水状态
  if (pageData?.url) {
    _wateredSet.add(pageData.url + '||' + author + '||' + originalText);
    // 持久化到 storage
    saveWateredNoteUrl(pageData.url);
  }
  // 通知左侧笔记列表 (req 2)
  window._notifyNoteWatered && window._notifyNoteWatered(pageData?.url || '');
  noteDone(noteIdFrom(pageData?.url), { sent: true, reason: 'watered' }); // 严格流水线：本篇已成功发送
  // ★ 灌水总结：记录本次发送明细（话术取文本框当前值，可能被用户编辑过）
  try {
    const replyEl = document.getElementById('replyText_' + prospectIdx);
    addWaterLog({
      noteUrl: pageData?.url || '',
      noteTitle: pageData?.title || '',
      author: author || '',
      comment: originalText || '',
      replyText: replyEl && replyEl.value ? replyEl.value.trim() : '',
      source: _batchSending ? 'batch' : 'manual',
    });
  } catch (_) {}
}

// ========== 防重复灌水：检测“我的名字”已在评论里 ==========
/** 读取用户在设置里维护的“我的小红书昵称”（归一化）。
 *  不缓存：只是本地读取，开销极小；保证设置里新增名字后无需重开弹窗即生效。 */
async function loadMyAccountNames() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'getConfig' });
    const names = (resp && resp.config && resp.config.myAccountNames) || [];
    return names.map(n => _normMatch(n)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** 在评论里找“我的名字”；命中则返回那条评论，否则 null */
async function findMyCommentInNote(comments) {
  const myNames = await loadMyAccountNames();
  if (!myNames || myNames.length === 0) return null;
  for (const c of (comments || [])) {
    const author = _normMatch(c.author);
    if (!author) continue;
    if (myNames.includes(author)) return c;
  }
  return null;
}

/** 因“发现自己的评论”而把整篇笔记标为已灌水（存本地 + 通知列表 + 渲染提示） */
async function markNoteWateredBySelf(noteUrl, myComment) {
  // 1. 存本地已灌水清单
  try { await saveWateredNoteUrl(noteUrl); } catch (_) {}
  // 2. 把自己这条评论也记入已回复记录（防下次重扫又当商机）
  try { await addLocalReply(noteUrl, myComment.author || '', myComment.content || ''); } catch (_) {}
  // 3. 通知左侧笔记列表标为已灌水
  try { window._notifyNoteWatered && window._notifyNoteWatered(noteUrl); } catch (_) {}
  noteDone(noteIdFrom(noteUrl), { sent: true, reason: 'already_watered' }); // 严格流水线：本篇已灌水
  // 4. 主区域渲染一个明确提示，不再调 AI
  const container = document.getElementById('mainContent');
  if (container) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const div = document.createElement('div');
    div.className = 'empty-prospect';
    div.innerHTML = `
      <div style="font-size:28px;margin-bottom:10px;">✅</div>
      <div style="font-size:14px;color:#333;margin-bottom:6px;font-weight:500;">本篇已灌水（检测到你的评论）</div>
      <div style="font-size:12px;color:#555;line-height:1.6;">已发现 <strong>@${esc(myComment.author || '')}</strong> 的评论，已自动记入已灌水清单并跳过 AI。</div>`;
    container.appendChild(div);
  }
  setStatus('✅ 本篇已灌水（已有你的评论）', 'success');
}

// ========== 已打开笔记跟踪（持久化到 chrome.storage.local） ==========
const OPENED_KEY = 'opened_notes';

/** 获取所有已打开的笔记 URL 集合 */
async function loadOpenedNoteUrls() {
  try {
    const data = await chrome.storage.local.get(OPENED_KEY);
    return new Set(data[OPENED_KEY] || []);
  } catch (_) {
    return new Set();
  }
}

/** 保存一条已打开的笔记 URL 到持久存储 */
async function saveOpenedNoteUrl(noteUrl) {
  if (!noteUrl) return;
  try {
    const data = await chrome.storage.local.get(OPENED_KEY);
    const urls = data[OPENED_KEY] || [];
    if (!urls.includes(noteUrl)) {
      urls.push(noteUrl);
      await chrome.storage.local.set({ [OPENED_KEY]: urls });
    }
  } catch (_) {}
}

/** 查询已打开笔记 URL 集合（供左侧面板调用） */
window.getOpenedNoteUrls = loadOpenedNoteUrls;
/** 保存已打开笔记 URL（供左侧面板调用） */
window.saveOpenedNoteUrl = saveOpenedNoteUrl;

// ========== 点击评论跳转到页面 ==========
function bindScrollToComment() {
  document.querySelectorAll('.comment-clickable').forEach(el => {
    el.addEventListener('click', async () => {
      let author, originalText;
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx) && pageData.comments && pageData.comments[idx]) {
        const comment = pageData.comments[idx];
        author = comment.author;
        originalText = comment.content;
      } else {
        return;
      }

      const tab = await getTargetTab();
      if (!tab) return;

      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'scrollToComment', author, originalText,
        });
      } catch (e) { /* 忽略 */ }
    });
  });
}

// ========== 线程提取（供候选2使用） ==========
function authorMatch(name, target) {
  if (!name || !target) return false;
  if (name === target) return true;
  const a = name.replace(/^@/, '').trim();
  const b = target.replace(/^@/, '').trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a));
}

function extractThreadsSafe(flat) {
  if (!flat || !Array.isArray(flat)) return [];

  const hasPosition = flat.some(c => c._left != null);
  if (hasPosition) {
    const minLeft = Math.min(...flat.map(c => c._left));
    const INDENT_THRESHOLD = 15;
    const threads = [];
    let current = null;
    for (let i = 0; i < flat.length; i++) {
      const c = flat[i];
      const indent = c._left - minLeft;
      if (indent < INDENT_THRESHOLD) {
        current = { author: c.author, content: c.content, replies: [], _commentIdx: i };
        threads.push(current);
      } else if (current) {
        current.replies.push({ author: c.author, content: c.content, replyTo: c.replyTo || '' });
      }
    }
    return threads;
  }

  const threads = [], used = new Set();
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i];
    if (c.replyTo || used.has(i)) continue;
    const replies = [];
    for (let j = i + 1; j < flat.length; j++) {
      const r = flat[j];
      if (used.has(j)) continue;
      if (!r.replyTo) continue;
      if (authorMatch(r.replyTo, c.author) || replies.some(p => authorMatch(r.replyTo, p.author))) {
        replies.push({ author: r.author, content: r.content, replyTo: r.replyTo });
        used.add(j);
      }
    }
    threads.push({ author: c.author, content: c.content, replies: replies.slice(0, 15), _commentIdx: i });
    used.add(i);
  }
  return threads;
}

// ========== 工具函数 ==========

/**
 * 清洗 AI 输出内容里可能残留的版本前缀标签
 * 例如："版本A：xxx" / "A: xxx" / "（版本A正文，朋友分享型...）xxx" → "xxx"
 */
function stripVersionPrefix(text) {
  if (!text) return '';
  // 去掉括号包裹的描述说明行（如"（版本A正文，朋友分享型，...）"）
  text = text.replace(/^[（(][^）)]{0,40}[）)]\s*/u, '');
  // 去掉 "版本A：" / "版本A:" / "A：" / "A:" 前缀
  text = text.replace(/^(版本\s*[A-Ca-c]\s*[：:：]\s*|[A-Ca-c]\s*[：:：]\s*)/u, '');
  return text.trim();
}

function showNoteInfo(data) {
  const el = document.getElementById('noteInfo');
  el.style.display = 'block';
  el.className = 'note-info active';  // req 5: 浅黄高亮
  const noteId = data.url ? (data.url.match(/\/explore\/([a-f0-9]+)/) || data.url.match(/\/note\/([a-f0-9]+)/) || [])[1] : '';
  el.innerHTML = `
    <div class="note-title">${esc(data.title || '(无标题)')}</div>
    <div class="note-meta">
      <span>👤 ${esc(data.author || '未知')}</span>
      <span>💬 ${data.comments.length} 条评论</span>
      <span>📡 ${esc(data._sourceLabel || '默认')}</span>
      ${noteId ? `<span style="font-size:10px;color:#bbb;font-family:monospace;">#${noteId.slice(0, 8)}</span>` : ''}
    </div>`;
  // 通知左侧笔记列表当前打开的笔记 (req 6)
  if (window._notifyNoteOpened && noteId) {
    window._notifyNoteOpened(noteId);
  }
}
function setBadge(text, cls) {
  const el = document.getElementById('statusBadge');
  el.textContent = text;
  el.className = 'badge' + (cls ? ' ' + cls : '');
}
function setStatus(text, cls) {
  const el = document.getElementById('statusBar');
  el.innerHTML = text;
  el.className = 'status-bar' + (cls ? ' ' + cls : '');
  el.style.display = text ? 'block' : 'none';
}
function hideStatus() {
  document.getElementById('statusBar').style.display = 'none';
}
function hideEmpty() {
  const el = document.getElementById('mainContent');
  if (el) while (el.firstChild) el.removeChild(el.firstChild);
}
/** 待机态：弹窗刚打开、还没开始任何扫描时的内容区占位（不要调 refreshData，避免自动抓页） */
function showIdle() {
  const el = document.getElementById('mainContent');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<div class="emoji">☕</div><p>待机中，当前<b>未扫描任何笔记</b></p>
    <p style="font-size:11px;color:#999;line-height:1.8;">已在笔记详情页 → 点右上「🔄 评论刷新」<br>或在左侧输入关键词搜索后点笔记「🔗 打开」</p>`;
  el.appendChild(div);
}
function showEmpty(msg) {
  const el = document.getElementById('mainContent');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  const div = document.createElement('div');
  div.className = 'empty-state';
  if (msg) {
    div.innerHTML = `<div class="emoji">😕</div><p>${msg}</p>
      <button id="retryBtn" class="retry-btn">🔄 重试</button>`;
    el.appendChild(div);
    document.getElementById('retryBtn')?.addEventListener('click', refreshData);
  } else {
    div.innerHTML = `<div class="emoji">👀</div><p>请在 <b>小红书笔记页面</b> 点击插件图标</p>`;
    el.appendChild(div);
  }
}
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ★ 扫描心跳：auto-bot 靠它判断"popup 是否真在扫描这篇"（扫描没起来/中途挂死都能快速收尾，不必干等 180s）
//   与 popup.js 同窗口共享，auto-bot 侧读 window.__scanLastBeat / __scanRunning / __scanActiveNoteId
window.__scanLastBeat = 0;
window.__scanRunning = false;
window.__scanActiveNoteId = '';
let __scanBeatTimer = null;
function touchScanBeat() { window.__scanLastBeat = Date.now(); }
function startScanHeartbeat(noteId) {
  window.__scanRunning = true;
  window.__scanActiveNoteId = noteId || _scanCurNoteId || '';
  touchScanBeat();
  if (!__scanBeatTimer) {
    __scanBeatTimer = setInterval(function () {
      if (window.__scanRunning) touchScanBeat();
    }, 6000);
  }
}
function stopScanHeartbeat() { window.__scanRunning = false; }

// ★ AI 扫描结束广播（供 auto-bot 监听）：本篇"无商机地结束"（无商机/AI失败/评论不足/无评论）时喊一嗓子，
//   机器人收到信号立即返回列表，不再干等 180s 超时；带 noteId 供 bot 做血缘校验，防串篇误结
function broadcastAiScanDone(ok) {
  stopScanHeartbeat();
  try { window.dispatchEvent(new CustomEvent('xhsAiScanDone', { detail: { ok: !!ok, noteId: _scanCurNoteId || '' } })); } catch (_) {}
  noteDone(null, { sent: false, reason: 'scan_done' }); // 扫描结束·无需发送 → 本篇"处理完"
}

// ═══ 统一"本篇处理完成"信号（严格自动灌水用）═══
// popup.js 与 auto-water-app.js 同在一个 window；auto 流水线每开一篇就等这一个信号（sent=true 已发出 / false 无需发），
// 收到即推进下一篇。以下 3 处各自代表一种"结单"：成功发送 / 已灌水 / 扫描结束无需发。
let _scanCurNoteId = '';
let _scanDoneFired = false;
function noteDone(id, res) {
  stopScanHeartbeat();
  if (_scanDoneFired) return;                 // 一篇最多发一次，防止"已灌水"等双信号把流水线推进两次
  _scanDoneFired = true;
  if (id) _scanCurNoteId = id;
  try { window.dispatchEvent(new CustomEvent('xhsNoteDone', { detail: { noteId: _scanCurNoteId, res: res || {} } })); } catch (_) {}
}
function noteIdFrom(url) { try { return _noteIdFromUrl(url || ''); } catch (_) { return ''; } }

// ★ 带超时的页面消息发送：防止 content.js 挂起时 popup 永久等待（超时后按"可能已发出"处理，不重发）
function sendTabMessageWithTimeout(tabId, msg, timeoutMs) {
  timeoutMs = timeoutMs || 60000;
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error('页面无响应（' + Math.round(timeoutMs / 1000) + 's），可能已发出，请刷新页面确认后再操作')), timeoutMs))
  ]);
}

// 停留时间配置（设置页「⏱️ 停留时间」，存 delay_config）：未配置的键用默认表兜底
// 实际停留 = 设定值 + 随机上浮最多 50%；floor 为技术下限（防页面没加载完就开扫）
const DELAY_POPUP_DEFAULTS = { browseDwell: 0, typingCharDelay: 0, likeGap: 0, lazyLoadWait: 300, retryBackWait: 300, retryOpenWait: 800, noteOpenBuffer: 300, preSendGap: 500, batchItemGap: 0 };
async function getDwellMs(key, floor) {
  // 新{key:{min,max}}区间随机；旧数值 n → min=n、max≈n*1.6
  let v = await (async function () {
    let c;
    try {
      const r = await chrome.storage.local.get('delay_config');
      c = (r.delay_config || {})[key];
    } catch (_) { c = undefined; }
    if (c === undefined) c = DELAY_POPUP_DEFAULTS[key];
    let minV = 0, maxV = 0;
    if (c && typeof c === 'object') { minV = Math.max(0, Number(c.min) || 0); maxV = Math.max(0, Number(c.max) || 0); }
    else { minV = maxV = Math.max(0, Number(c) || 0); if (maxV) maxV = Math.round(maxV * 1.6); }
    if (maxV > minV) return minV + Math.random() * (maxV - minV);
    return minV;
  })();
  return Math.max(floor || 0, v);
}

/* ═══════════ 🧭 账号诊断：6 步工作流（资料→人设/风格→产品卖点→知识库→规划/封面→报告） ═══════════ */
var _diagState = { profile: null, persona: '', kbCount: 0, accountType: '', notePlan: null, report: null, busy: '' };
var _diagStep = 1;
var DIAG_PERSONA_QUESTIONS = [
  '你是谁？介绍一下你的身份、职业，或现在正在做的事。',
  '在这个领域/产品上你有过哪些真实的经历？做了多久、帮过多少人、或亲自踩过哪些坑？',
  '你最拿手、最想让别人知道的干货或专业积累是什么？',
  '你的小红书账号定位是什么？主要分享什么、写给谁看？',
  '你希望评论区互动时的"人设"是哪种（专业靠谱 / 接地气过来人 / 随性朋友…）？有没有特别的口吻或语气？',
];

// ★ 统一问卷（10 问）：人设/产品卖点/内容规划 合并成一套，只答一次，AI 三处共用
var DIAG_UNIFIED_QUESTIONS = [
  '你是谁？介绍一下你的身份、职业，或现在正在做的事。',
  '你的产品/服务是什么？主要帮人解决什么问题、给谁用？',
  '相比竞品或以前的用法，它最大的 2-3 个优势或差异点是什么？',
  '有没有具体数字、效果、案例，或你亲身经历/踩过的坑，能证明它的价值、建立信任？',
  '你的目标客户是谁？他们购买/关注前最常问、最担心、最容易踩坑的点是什么？',
  '在你的领域里，你最拿手、最想让别人记住的干货观点或结论是什么？',
  '你的账号定位：主要分享什么内容、写给谁看？',
  '你希望互动时的「人设」是哪种（专业靠谱 / 接地气过来人 / 随性朋友）、有没有特别口吻？',
  '用户最可能在什么场景/需求下想起你、怎么找到你（引流方式）？',
  '内容规划：一篇图文大概几页、多久发一篇、什么时间段发？',
];
var DIAG_KB_QUESTIONS = [
  '你的产品/服务是什么？主要帮人解决什么问题、满足什么需求？',
  '你的目标客户是谁？他们购买前最常问、最担心、最容易踩坑的点是什么？',
  '你有哪些亲身经验或案例（做过的事、帮过谁、踩过的坑），能用来建立信任和给建议？',
  '有没有具体的数字、价格、政策或行业数据，客户需要知道的？',
  '你最想让大家记住你的 2-3 个专业观点或干货结论是什么？',
];
var DIAG_ACCOUNT_TYPES = ['干货分享型', '测评型', '生活方式种草型', '教程/步骤型', '经验情感型', '资料整理型', '个人IP/创始人型'];
var DIAG_PLAN_QUESTIONS = [
  '你的笔记主要想讲什么内容？（可结合人设/产品卖点/知识库来定）',
  '主要写给谁看（目标人群）？他们最关心、最需要什么？',
  '一套图文你打算发几页？（不确定就写"帮我定"）',
  '你打算多久发一篇、在什么时间段发？',
];
var DIAG_PURPOSES = [
  ['sell', '🛍️ 卖产品（获客转化）'],
  ['brand', '🏷️ 品牌种草（信任/口碑）'],
  ['profile', '👤 主页涨粉（引流主页）'],
  ['likes', '👍 互动涨赞（提升活跃）'],
  ['trend', '🔥 蹭热点（借话题/大V）'],
  ['auto', '🧩 综合自动（每条看菜下饭）'],
  ];
var DIAG_SELL_QUESTIONS = [
  '你的产品/服务是什么？主要帮人解决什么问题、给谁用？',
  '相比竞品或以前的用法，它最大的 2-3 个优势或差异点是什么？',
  '有没有具体数字、效果、案例能证明它的价值？',
  '用户最可能在什么场景/需求下想起它、怎么找到你？',
  ];
var DIAG_GUIDE_OPTS = [
  ['🔍 搜索产品/关键词', '打开小红书搜索「{产品}」了解更多，或点我头像看主页'],
  ['👤 点头像进主页', '想看更多干货可以点我头像进主页'],
  ['✉️ 私信我领取', '私信我"领取"获取试用/资料，手把手教你'],
  ['🔗 评论区 @ / 链接', '想了解的可以看评论区 @我，或点我头像'],
  ['📍 微信 / 公众号 / App', '详细见我主页或公众号，点我头像看介绍'],
  ['🚫 不引流（纯品牌/口碑）', ''],
  ];
function _dEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _dBtn(id, label, sub, color) {
  return '<button id="' + id + '" class="btn ' + (color || 'btn-primary') + '" style="margin-right:8px;margin-bottom:8px;">' + label + (sub ? '<span style="font-size:11px;opacity:.8;margin-left:4px;">' + sub + '</span>' : '') + '</button>';
}
async function _diagSay(method, data) { return await chrome.runtime.sendMessage({ action: method, data: data || {} }); }
async function _diagGetCfg() { return await readConfigPlain(); }
async function _diagSaveCfg(cfg) { await chrome.storage.local.set({ config: (typeof DataPrivacy !== 'undefined') ? await DataPrivacy.lockConfig(cfg) : cfg }); }
function _diagCard(innerHtml) { return '<div style="border:1px solid #e7eaf0;border-radius:12px;padding:14px 16px;background:#fff;box-shadow:0 1px 3px rgba(24,24,40,.05);">' + innerHtml + '</div>'; }
function _diagLabel(txt) { return '<div style="font-size:12px;color:#333;margin-bottom:4px;">' + txt + '</div>'; }
function _diagStepTitle(no, txt) {
  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
    '<span style="min-width:26px;width:26px;height:26px;border-radius:8px;background:var(--xhs-red);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;">' + no + '</span>' +
    '<span style="font-weight:700;font-size:15px;color:#1f1f1f;">' + txt + '</span></div>';
}
function renderDiagnosis(container) {
  _diagState = { profile: null, persona: '', kbCount: 0, accountType: '', notePlan: null, report: null, busy: '' };
  _diagStep = 1;
container.innerHTML = [
    '<div style="padding:14px 16px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#ffffff,#fff7fa);">',
    '  <div style="font-weight:700;font-size:15px;color:var(--ink);">🧭 账号诊断 · 7 步工作流</div>',
    '  <div style="font-size:11px;color:#888;margin-top:4px;line-height:1.7;">抓主页 → 问卷(10问)→ 人设/风格 → 产品卖点 → 知识库 → 内容规划&封面 → 深度报告。人设/卖点/规划共用同一份问卷回答，只答一次。</div>',
    '</div>',
    '<div id="diagBody" style="padding:14px;font-size:13px;color:#333;"></div>',
  ].join('');
  diagGo(1);
}
function diagGo(n) {
  _diagStep = n;
  const b = document.getElementById('diagBody'); if (!b) return;
  const items = [[1, '①', '账号资料'], [2, '②', '问卷'], [3, '③', '人设/风格'], [4, '④', '产品卖点'], [5, '⑤', '知识库'], [6, '⑥', '规划/封面'], [7, '⑦', '深度报告']];
  b.innerHTML = '<div style="display:flex;gap:2px;align-items:flex-start;margin-bottom:14px;">' + items.map(function (it, ix) {
    const t = it[0];
    const done = t < n, cur = t === n;
    let circ = 'width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin:0 auto;';
    if (cur) circ += 'background:var(--xhs-red);color:#fff;box-shadow:0 0 0 3px rgba(255,36,66,.16);';
    else if (done) circ += 'background:#0a7b5a;color:#fff;';
    else circ += 'background:#eef0f4;color:#b6bac6;';
    const label = 'font-size:10px;text-align:center;margin-top:4px;white-space:nowrap;' + (cur ? 'color:var(--xhs-red);font-weight:700;' : (done ? 'color:#0a7b5a;' : 'color:#9aa0ad;'));
    return '<div data-go="' + t + '" style="flex:1;cursor:pointer;' + (ix < items.length - 1 ? 'background:linear-gradient(90deg,transparent 0,transparent 100%);' : '') + '">' +
      '<div style="' + circ + '">' + (done ? '✓' : it[1]) + '</div>' +
      '<div style="' + label + '">' + it[2] + '</div>' +
      '</div>';
  }).join('') + '</div><div id="diagStepBody"></div>';
  b.querySelectorAll('[data-go]').forEach(function (el) { el.onclick = function () { diagGo(parseInt(el.getAttribute('data-go'), 10)); }; });
  const body = document.getElementById('diagStepBody');
  if (n === 1) diagStep1(body);
  else if (n === 2) diagStepQuiz(body);
  else if (n === 3) diagStep2(body);
  else if (n === 4) diagStep3(body);
  else if (n === 5) diagStep4(body);
  else if (n === 6) diagStep5(body);
  else diagStep6(body);
}
function _diagNeedProfile(body) {
  body.innerHTML = _diagCard('<div style="color:#888;">请先完成 ① 抓取主页。</div>' + _dBtn('diagGoto1', '去 ① 抓取主页'));
  document.getElementById('diagGoto1')?.addEventListener('click', function () { diagGo(1); });
}

/* ── ① 账号资料 ── */
function diagStep1(body) {
  if (!body) return;
  if (_diagState.profile) { diagRenderProfile(body); return; }
  body.innerHTML = _diagCard(
'<div style="font-weight:700;font-size:15px;color:#1f1f1f;">① 抓取你的小红书主页</div>' +
    '<div style="font-size:12px;color:#888;margin:2px 0 10px;">抓回账号昵称、简介、发过的笔记（只要标题即可）。需已在小红书网页版登录、能在本人「我的」主页采集。</div>' +
    _dBtn('diagFetchBtn', '① 抓取我的主页', '(需已登录小红书)') + '<span id="diagFetchMsg" style="font-size:12px;color:#0a7b5a;"></span>'
) + '<div style="margin-top:10px;color:#999;font-size:12px;">②~⑦ 在工作流后面，抓完主页再继续。</div>';
  document.getElementById('diagFetchBtn')?.addEventListener('click', diagFetchProfile);
}
async function diagFetchProfile() {
  const msg = document.getElementById('diagFetchMsg'); const btn = document.getElementById('diagFetchBtn');
  if (!btn || _diagState.busy) return;
  _diagState.busy = 'fetch'; btn.disabled = true; btn.textContent = '正在抓取本人主页…'; if (msg) msg.textContent = '正在打开/读取，请稍候…';
  try {
    const r = await _diagSay('extractOwnProfile');
    if (!r || !r.ok || !r.profile) throw new Error((r && (r.reason || r.error)) || '抓取失败');
_diagState.profile = r.profile;
    // ★ 防重复灌水：默认用抓到的号主个人身份（昵称优先，其次小红书号）兜底
    try {
      const cfg = await _diagGetCfg();
      const names = (cfg.myAccountNames && cfg.myAccountNames.length) ? cfg.myAccountNames : [];
      const acc = (r.profile.name || '').trim() || (r.profile.xhsId || '').trim();
      if (acc && !names.some(function (n) { return !n || n === acc; })) {
        if (names.length) names.push(acc); else names.push(acc);
        cfg.myAccountNames = names;
        await _diagSaveCfg(cfg);
      }
    } catch (_) {}
    const b = document.getElementById('diagStepBody'); if (b) diagRenderProfile(b);
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ 抓取失败：' + (e.message || e); } }
  finally { _diagState.busy = ''; btn.disabled = false; btn.textContent = '① 重新抓取我的主页'; }
}
function diagRenderProfile(body) {
  const p = _diagState.profile || {};
  const notes = (p.notes || []).map(function (n, i) { return (i + 1) + '. ' + (n.title || '（未命名）'); }).join('\n');
  const stat = function (v, l) { return '<div style="text-align:center;flex:1;"><div style="font-weight:700;font-size:15px;">' + _dEsc(v || '-') + '</div><div style="font-size:11px;color:#999;">' + l + '</div></div>'; };
  body.innerHTML = _diagCard(
    '<div style="display:flex;gap:12px;align-items:center;">' +
    '<div style="width:52px;height:52px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:24px;flex:none;">👤</div>' +
    '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:15px;">' + _dEsc(p.name || '未命名') + '</div>' +
    '<div style="font-size:11px;color:#999;">小红书号：' + _dEsc(p.xhsId || '-') + '</div>' +
    '<div style="font-size:12px;color:#666;margin-top:2px;white-space:pre-wrap;word-break:break-word;">' + _dEsc(p.desc || '（暂无简介）') + '</div></div></div>' +
    '<div style="display:flex;margin:10px 0 4px;">' + stat(p.fans, '粉丝') + stat(p.follows, '关注') + stat(p.likes, '获赞') + '</div>'
  ) + '<div style="margin-top:12px;border:1px solid #eee;border-radius:8px;padding:10px;background:#fafbfc;"><b style="font-size:13px;">发过的笔记 (' + (p.notes || []).length + ')</b><div style="white-space:pre-wrap;font-size:12px;color:#555;margin-top:4px;">' + _dEsc(notes || '（未读到）') + '</div></div>' +
'<div style="margin-top:14px;">' + _dBtn('diagNextBtn', '下一步：② 问卷', '', 'btn-primary') + _dBtn('diagRefetchBtn', '重新抓取', '', 'btn-outline') + '</div>';
  document.getElementById('diagNextBtn')?.addEventListener('click', function () { diagGo(2); });
  document.getElementById('diagRefetchBtn')?.addEventListener('click', function () { _diagState.profile = null; diagGo(1); });
}

/* ── ② 问卷（10问统一收集：人设/产品/内容规划只答一次，后续步骤复用） ── */
function diagStepQuiz(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
  body.innerHTML =
    _diagCard(
      _diagStepTitle('②', '问卷 · 10 问一次问清') +
      '<div style="font-size:12px;color:#888;margin:4px 0;">这 10 问覆盖【人设 / 产品卖点 / 内容规划】，答一次，后面③人设④卖点⑥规划都复用。答得越具体，AI 出的越像你本人。</div>' +
      '<div style="font-size:12px;color:#888;margin:6px 0 4px;">账号简介（已带入，可改）：</div>' +
      '<textarea id="diagQuizBio" rows="2" style="width:100%;box-sizing:border-box;">' + _dEsc(_diagState.profile.desc || '') + '</textarea>' +
      '<div id="diagQuiz_Qs" style="margin-top:6px;"></div>' +
      _dBtn('diagQuizNext', '✓ 保存问卷 → 去③人设') + '<span id="diagQuizMsg" style="font-size:12px;color:#0a7b5a;"></span>'
    );
  document.getElementById('diagQuiz_Qs').innerHTML = DIAG_UNIFIED_QUESTIONS.map(function (q, i) {
    return '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + _dEsc(q) + '</div>' +
      '<textarea class="diagQuiz_Q" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="你的回答…"></textarea></div>';
  }).join('');
  // 预填上次已答（从②返回再来不重打）
  const answers = _diagState.unifiedAnswers || [];
  if (answers.length) {
    document.querySelectorAll('.diagQuiz_Q').forEach(function (ta) {
      const a = answers[parseInt(ta.getAttribute('data-i'), 10)];
      if (a && a.answer) ta.value = a.answer;
    });
  }
  document.getElementById('diagQuizNext')?.addEventListener('click', function () {
    const answers2 = Array.from(document.querySelectorAll('.diagQuiz_Q')).map(function (el) { return { answer: el.value.trim() }; });
    _diagState.unifiedAnswers = answers2;
    _diagState.userBio = (document.getElementById('diagQuizBio') || {}).value ? document.getElementById('diagQuizBio').value.trim() : '';
    const msg = document.getElementById('diagQuizMsg');
    const filled = answers2.filter(function (a) { return a.answer; }).length;
    if (msg) msg.textContent = '已保存 ' + filled + ' 题，去生成人设…';
    diagGo(3);
  });
}

/* ── ③ 人设评定 + 话术风格（复用②问卷回答） ── */
function diagStep2(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
body.innerHTML =
    _diagCard(
      _diagStepTitle('③', '人设/风格 · 立住"你是谁"') +
      '<div id="diagPStatus" style="font-size:12px;color:#666;margin:6px 0;"></div>' +
      '<div style="font-size:12px;color:#888;margin:4px 0;">你已在②问卷答过（身份/经历/干货/口吻等）。点「✨ 用问卷回答生成人设并保存」即可复用②的回答。</div>' +
      _dBtn('diagPBuild', '✨ 用问卷回答生成人设并保存') + '<span id="diagPMsg" style="font-size:12px;color:#0a7b5a;"></span>'
    ) +
    '<div style="margin-top:10px;">' + _diagCard(
      '<div style="font-weight:700;font-size:14px;">说话风格 · 反 AI 味</div>' +
      '<div style="font-size:12px;color:#888;margin:4px 0;">人设定"你是谁"，这里定"你怎么说话"，都写回「设置→话术风格」。</div>' +
      _diagLabel('评论目的') + '<select id="diagPurp" style="width:100%;box-sizing:border-box;margin-bottom:8px;">' + DIAG_PURPOSES.map(function (p) { return '<option value="' + p[0] + '">' + _dEsc(p[1]) + '</option>'; }).join('') + '</select>' +
      _diagLabel('话术字数范围') + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">最少 <input id="diagMinC" type="number" min="20" max="500" step="10" style="width:70px;"> 最多 <input id="diagMaxC" type="number" min="50" max="500" step="10" style="width:70px;"></div>' +
      _diagLabel('口癖池（抽 1-2 个自然用上，逗号/顿号分隔）') + '<textarea id="diagTone" rows="2" style="width:100%;box-sizing:border-box;margin-bottom:8px;" placeholder="例：说实话、我记得、当时也是"></textarea>' +
      _diagLabel('博主口吻样本（贴 3-5 条你自己真实发过的评论，AI 跟随你的语感）') + '<textarea id="diagSample" rows="3" style="width:100%;box-sizing:border-box;margin-bottom:8px;" placeholder="每行一条你的真实评论…"></textarea>' +
      _dBtn('diagStyleSave', '💾 保存说话风格') + '<span id="diagStyleMsg" style="font-size:12px;color:#0a7b5a;"></span>'
) + '</div>' +
    '<div style="margin-top:10px;">' + _diagCard(
      '<div style="font-weight:700;font-size:13px;">人设正文（可改）</div>' +
      '<div style="font-size:12px;color:#888;margin:4px 0;">生成后可直接在这里修改，再点保存；想补经历/口吻也可自己加。</div>' +
      '<textarea id="diagPEdit" rows="6" style="width:100%;box-sizing:border-box;white-space:pre-wrap;" placeholder="你的人设正文会出现在这里，可编辑…"></textarea>' +
      _dBtn('diagPEditSave', '💾 保存修改后的人设') + '<span id="diagPEditMsg" style="font-size:12px;color:#0a7b5a;"></span>'
    ) + '</div>' +
'<div style="margin-top:12px;">' + _dBtn('diagStep3Btn', '下一步：④ 产品卖点', '', 'btn-primary') + _dBtn('diagSkipBtn', '跳过人设', '', 'btn-outline') + '</div>';
document.getElementById('diagPBuild')?.addEventListener('click', diagPersonaBuild);
  document.getElementById('diagPEditSave')?.addEventListener('click', diagPersonaEditSave);
  document.getElementById('diagStyleSave')?.addEventListener('click', diagStyleSave);
document.getElementById('diagStep3Btn')?.addEventListener('click', function () { diagGo(4); });
  document.getElementById('diagSkipBtn')?.addEventListener('click', function () { diagGo(4); });
  diagPersonaStatus();
  diagStylePrefill();
}
async function diagPersonaStatus() {
  const st = document.getElementById('diagPStatus'); const edit = document.getElementById('diagPEdit');
  try {
    const r = await _diagSay('getPersona'); const p = (r && r.persona) || null;
    if (!p || !p.text) { if (st) st.textContent = '⚠️ 还没有人设。①先答②问卷，再在③点「用问卷回答生成」即可。'; return; }
    _diagState.persona = p.text;
    if (st) st.innerHTML = '✅ 已有保存的人设（' + (p.updatedAt ? new Date(p.updatedAt).toLocaleString('zh-CN') : '') + '）';
    if (edit && !edit.dataset.touched) edit.value = p.text;
  } catch (_) {}
}
async function diagPersonaBuild() {
  const btn = document.getElementById('diagPBuild'); const msg = document.getElementById('diagPMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 生成中…'; if (msg) msg.textContent = '';
  try {
    const bio = _diagState.userBio || ((document.getElementById('diagQuizBio') || {}).value || '').trim() || '';
    const answers = _diagState.unifiedAnswers || Array.from((document.querySelectorAll('.diagQuiz_Q, .diagP_Q') || [])).map(function (el) { return { answer: el.value }; });
    const r = await _diagSay('aiPersonaBuild', { bio: bio, answers: answers });
    if (!r || !r.persona || !r.persona.text) throw new Error((r && r.error) || 'AI 未返回人设');
    const saved = await _diagSay('setPersona', { persona: r.persona });
    if (!saved || !saved.ok) throw new Error('保存失败');
    _diagState.persona = r.persona.text;
    const edit = document.getElementById('diagPEdit'); if (edit) { edit.value = r.persona.text; edit.dataset.touched = ''; }
    const st = document.getElementById('diagPStatus'); if (st) st.innerHTML = '✅ 已生成并保存，可在下方编辑后再存。';
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已生成，可在下方改后再点保存。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; btn.textContent = t; }
}
async function diagPersonaEditSave() {
  const btn = document.getElementById('diagPEditSave'); const msg = document.getElementById('diagPEditMsg');
  const edit = document.getElementById('diagPEdit');
  if (!btn) return; const text = (edit && edit.value) ? edit.value.trim() : '';
  if (!text) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '人设内容不能为空'; } return; }
  btn.disabled = true; if (msg) msg.textContent = '';
  try {
    const persona = { text: text, bio: _diagState.profile ? _diagState.profile.desc : '', updatedAt: Date.now() };
    const saved = await _diagSay('setPersona', { persona: persona });
    if (!saved || !saved.ok) throw new Error('保存失败');
    _diagState.persona = text; if (edit) edit.dataset.touched = '';
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已保存修改后的人设。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; }
}
async function diagStylePrefill() {
  try {
    const cfg = await _diagGetCfg(); const s = cfg.scriptStyle || {};
    if (s.scriptPurpose) { const el = document.getElementById('diagPurp'); if (el) el.value = s.scriptPurpose; }
    if (s.purposeMinChars != null) { const el = document.getElementById('diagMinC'); if (el) el.value = s.purposeMinChars; }
    if (s.purposeMaxChars != null) { const el = document.getElementById('diagMaxC'); if (el) el.value = s.purposeMaxChars; }
    if (s.toneMannerisms) { const el = document.getElementById('diagTone'); if (el) el.value = s.toneMannerisms; }
    if (s.personaSample) { const el = document.getElementById('diagSample'); if (el) el.value = s.personaSample; }
  } catch (_) {}
}
async function diagStyleSave() {
  const btn = document.getElementById('diagStyleSave'); const msg = document.getElementById('diagStyleMsg');
  if (!btn) return; btn.disabled = true; if (msg) msg.textContent = '';
  try {
    const cfg = await _diagGetCfg(); cfg.scriptStyle = cfg.scriptStyle || {};
    cfg.scriptStyle.scriptPurpose = (document.getElementById('diagPurp') || {}).value || 'auto';
    cfg.scriptStyle.purposeMinChars = parseInt((document.getElementById('diagMinC') || {}).value, 10) || 100;
    cfg.scriptStyle.purposeMaxChars = parseInt((document.getElementById('diagMaxC') || {}).value, 10) || 300;
    cfg.scriptStyle.toneMannerisms = ((document.getElementById('diagTone') || {}).value || '').trim();
    cfg.scriptStyle.personaSample = ((document.getElementById('diagSample') || {}).value || '').trim();
    await _diagSaveCfg(cfg);
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已保存说话风格（写回「设置→话术风格」）。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; }
}

var _diagSellCount = 0;
function diagSellAddRow(title, content) {
  const list = document.getElementById('diagSellList'); if (!list) return;
  const i = _diagSellCount++;
  const row = document.createElement('div');
  row.style.cssText = 'border:1px solid #eee;border-radius:8px;padding:6px 8px;margin-bottom:6px;background:#fafbfc;';
  row.innerHTML = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;"><b style="font-size:12px;">卖点</b><button type="button" class="diagSellDel" data-i="' + i + '" style="margin-left:auto;border:none;background:none;color:#c62828;cursor:pointer;font-size:12px;">🗑 删</button></div>' +
    '<input class="diagSellTitle" data-i="' + i + '" type="text" maxlength="40" placeholder="卖点标题，例如：几秒出对比结果" value="' + _dEsc(title || '') + '" style="width:100%;box-sizing:border-box;margin-bottom:4px;">' +
    '<textarea class="diagSellContent" data-i="' + i + '" rows="1" placeholder="卖点内容" style="width:100%;box-sizing:border-box;">' + _dEsc(content || '') + '</textarea>';
  list.appendChild(row);
  row.querySelector('.diagSellDel').onclick = function () { row.remove(); };
}
function _diagClearSellRows() {
  const list = document.getElementById('diagSellList'); if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
}
/* ── ③ 产品与卖点 ── */
function diagStep3(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
  body.innerHTML = _diagCard(
    _diagStepTitle('④', '产品与卖点') +
    '<div style="font-size:12px;color:#888;margin:4px 0 8px;">你的产品/服务是什么、卖点有哪些、怎么引导用户找到你。写回「设置→产品配置」。</div>' +
    _diagLabel('产品名称') + '<input id="diagProdName" type="text" placeholder="例：贷款计算器小程序" style="width:100%;box-sizing:border-box;margin-bottom:10px;">' +
    '<div style="border-top:1px solid #eee;padding-top:10px;">' +
      '<div style="font-weight:700;font-size:13px;color:#333;">卖点</div>' +
      '<div style="font-size:12px;color:#888;margin:4px 0;">已在②用同一套 10 问答过（产品/优势/客户/证据/引流）。点「✨ 用 AI 提炼卖点」直接生成，或手动加。</div>' +
      _dBtn('diagSellAi', '✨ 用 AI 提炼卖点') + '<span id="diagSellAiMsg" style="font-size:12px;color:#0a7b5a;"></span>' +
      _dBtn('diagSellImportBtn', '📥 导入卖点', '', 'btn-outline') +
      '<div id="diagSellImpBox" style="display:none;margin:6px 0;"><textarea id="diagSellImp" rows="3" placeholder="每行一条：标题：内容&#10;或粘一段 JSON 数组 [{title,content}]"></textarea>' + _dBtn('diagSellImportDo', '导入', '', 'btn-primary') + '<span id="diagSellImpMsg" style="font-size:12px;color:#0a7b5a;"></span></div>' +
      '<div id="diagSellList" style="margin-top:8px;"></div>' + _dBtn('diagSellAdd', '＋ 手动添加卖点', '', 'btn-outline') +
    '</div>' +
    '<div style="border-top:1px solid #eee;padding-top:10px;margin-top:6px;">' +
      _diagLabel('引导方式（想让用户怎么找到你？选一个）') +
      '<div id="diagGuideOpts" style="display:flex;flex-wrap:wrap;gap:6px;">' + DIAG_GUIDE_OPTS.map(function (op) { return '<button type="button" class="diagGuideChip" data-v="' + _dEsc(op[1]) + '" style="font-size:12px;padding:5px 10px;border:1px solid #dfe3ea;border-radius:14px;background:#f6f7f9;color:#555;cursor:pointer;">' + _dEsc(op[0]) + '</button>'; }).join('') + '</div>' +
      '<div id="diagGuideCustomRow" style="margin-top:4px;display:none;"><input id="diagGuideCustom" type="text" placeholder="自定义引导文案…" style="width:100%;box-sizing:border-box;margin-top:4px;"></div>' +
      _dBtn('diagGuideCustomBtn', '✏️ 自定义', '', 'btn-outline') +
    '</div>' +
    _dBtn('diagProdSave', '💾 保存产品配置') + '<span id="diagProdMsg" style="font-size:12px;color:#0a7b5a;"></span>'
  ) + '<div style="margin-top:12px;">' + _dBtn('diagStep4Btn', '下一步：⑤ 知识库', '', 'btn-primary') + '</div>';
  document.querySelectorAll('.diagGuideChip').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.diagGuideChip').forEach(function (x) { x.style.background = '#f6f7f9'; x.style.color = '#555'; x.style.borderColor = '#dfe3ea'; });
      b.style.background = 'var(--xhs-red)'; b.style.color = '#fff'; b.style.borderColor = 'var(--xhs-red)';
      _diagGuide = b.getAttribute('data-v');
      document.getElementById('diagGuideCustomRow') && (document.getElementById('diagGuideCustomRow').style.display = 'none');
    };
  });
  document.getElementById('diagGuideCustomBtn')?.addEventListener('click', function () { document.getElementById('diagGuideCustomRow').style.display = 'block'; });
  document.getElementById('diagSellAi')?.addEventListener('click', diagSellAiBuild);
  document.getElementById('diagSellImportBtn')?.addEventListener('click', function () { const b = document.getElementById('diagSellImpBox'); if (b) b.style.display = b.style.display === 'none' ? '' : 'none'; });
  document.getElementById('diagSellImportDo')?.addEventListener('click', diagSellImport);
  document.getElementById('diagSellAdd')?.addEventListener('click', function () { diagSellAddRow(); });
  document.getElementById('diagProdSave')?.addEventListener('click', diagProdSave);
  document.getElementById('diagStep4Btn')?.addEventListener('click', function () { diagGo(5); });
  diagProdPrefill();
}
var _diagGuide = '';
async function diagSellAiBuild() {
  const btn = document.getElementById('diagSellAi'); const msg = document.getElementById('diagSellAiMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 提炼中…'; if (msg) msg.textContent = '';
  try {
    const answers = (_diagState.unifiedAnswers && _diagState.unifiedAnswers.length) ? _diagState.unifiedAnswers : Array.from((document.querySelectorAll('.diagSellQ') || [])).map(function (el) { return { answer: el.value }; });
    const existing = Array.from(document.querySelectorAll('.diagSellTitle, .diagSellContent') || []) ? (function () { const byI = {}; Array.from(document.querySelectorAll('.diagSellTitle')).forEach(function (el) { byI[el.getAttribute('data-i')] = byI[el.getAttribute('data-i')] || {}; byI[el.getAttribute('data-i')].title = el.value.trim(); }); Array.from(document.querySelectorAll('.diagSellContent')).forEach(function (el) { byI[el.getAttribute('data-i')] = byI[el.getAttribute('data-i')] || {}; byI[el.getAttribute('data-i')].content = el.value.trim(); }); return Object.keys(byI).map(function (k) { return byI[k]; }); })() : [];
    const r = await _diagSay('aiSellPointBuild', { answers: answers, existing: existing });
    if (!r || !r.ok || !Array.isArray(r.sellPoints) || !r.sellPoints.length) throw new Error((r && r.error) || 'AI 未提炼出卖点');
    _diagClearSellRows();
    r.sellPoints.forEach(function (s) { diagSellAddRow(s.title, s.content); });
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已提炼 ' + r.sellPoints.length + ' 条卖点（可再增删改）。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; btn.textContent = t; }
}
function diagSellImport() {
  const inp = document.getElementById('diagSellImp'); const msg = document.getElementById('diagSellImpMsg');
  const text = (inp && inp.value || '').trim(); if (msg) msg.textContent = '';
  if (!text) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '请先粘贴要导入的卖点'; } return; }
  let items = null;
  try { const a = JSON.parse(text); if (Array.isArray(a)) items = a.map(function (e) { return { title: (e && (e.title || e.name)) || '', content: (e && (e.content || e.desc)) || '' }; }); } catch (_) {}
  if (!items) {
    items = text.split(/\n+/).map(function (line) {
      const s = String(line).trim(); if (!s) return null;
      const ci = s.indexOf('：'); const cj = s.indexOf(':');
      const c = (ci > 0 && (cj < 0 || ci < cj)) ? ci : cj;
      if (c > 0) return { title: s.slice(0, c).trim(), content: s.slice(c + 1).trim() };
      return { title: s.slice(0, 12), content: s };
    }).filter(Boolean);
  }
  items = items.filter(function (s) { return s && (s.title || s.content); });
  if (!items.length) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '没解析到有效卖点（格式：标题：内容）'; } return; }
  _diagClearSellRows();
  items.forEach(function (s) { diagSellAddRow(s.title, s.content); });
  if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已导入 ' + items.length + ' 条卖点，记得点「保存产品配置」。'; }
}
async function diagProdPrefill() {
  try {
    const cfg = await _diagGetCfg(); const p = cfg.product || {};
    if (p.name && p.name !== '我的产品') { const el = document.getElementById('diagProdName'); if (el) el.value = p.name; }
    if (p.guideText) { _diagGuide = p.guideText; document.querySelectorAll('.diagGuideChip').forEach(function (b) { if (b.getAttribute('data-v') === p.guideText) { b.style.background = 'var(--xhs-red)'; b.style.color = '#fff'; b.style.borderColor = 'var(--xhs-red)'; } }); }
    (p.sellPoints || []).filter(function (s) { return s && (s.title || s.content); }).forEach(function (s) { diagSellAddRow(s.title, s.content); });
  } catch (_) {}
}
async function diagProdSave() {
  const btn = document.getElementById('diagProdSave'); const msg = document.getElementById('diagProdMsg');
  if (!btn) return; btn.disabled = true; if (msg) msg.textContent = '';
  try {
    const byI = {};
    Array.from(document.querySelectorAll('.diagSellTitle')).forEach(function (el) { byI[el.getAttribute('data-i')] = byI[el.getAttribute('data-i')] || {}; byI[el.getAttribute('data-i')].title = el.value.trim(); });
    Array.from(document.querySelectorAll('.diagSellContent')).forEach(function (el) { byI[el.getAttribute('data-i')] = byI[el.getAttribute('data-i')] || {}; byI[el.getAttribute('data-i')].content = el.value.trim(); });
    const sell = Object.keys(byI).map(function (k) { return { title: byI[k].title || '', content: byI[k].content || '', image: '' }; }).filter(function (s) { return s.title || s.content; }).slice(0, 10);
    const desc = sell.map(function (s) { return (s.title && s.content) ? s.title + '：' + s.content : (s.title || s.content); }).join('\n');
    let guide = _diagGuide;
    const customRow = document.getElementById('diagGuideCustomRow');
    if (customRow && customRow.style.display !== 'none') { guide = ((document.getElementById('diagGuideCustom') || {}).value || '').trim(); }
    const cfg = await _diagGetCfg(); const name = ((document.getElementById('diagProdName') || {}).value || '').trim();
    if (!name) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '⚠️ 请先填产品名称'; } return; }
    cfg.product = cfg.product || {};
    cfg.product.name = name;
    cfg.product.sellPoints = sell;
    cfg.product.description = desc;
    cfg.product.guideText = guide || '';
    await _diagSaveCfg(cfg);
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已保存产品配置（写回「设置→产品配置」）。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; }
}

/* ── ④ 知识库 ── */
function diagStep4(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
  body.innerHTML =
_diagCard(_diagStepTitle('⑤', '知识库 · 让回复有干货') +
'<div style="font-size:12px;color:#888;margin:4px 0;">知识库的素材（产品/客户/经验/数据/干货）已在②问卷答过。点「✨ 用问卷整理成知识库」即可，或粘贴/上传文件导入已有知识。写回「设置→知识库」。</div>' +
      '<div style="font-size:12px;color:#333;margin:6px 0 4px;">方式一 · 复用②问卷回答生成：</div>' +
      _dBtn('diagKBuild', '✨ 用问卷回答生成知识库') + '<span id="diagKMsg" style="font-size:12px;color:#0a7b5a;"></span>' +
      '<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px;"><div style="font-size:12px;color:#333;margin-bottom:4px;">方式二 · 导入已有知识：</div>' +
      '<textarea id="diagKImp" rows="4" placeholder="每行一条：标题：内容&#10;或直接粘一段 JSON 数组：[{\"title\":\"..\",\"content\":\"..\"}]" style="width:100%;box-sizing:border-box;margin-bottom:6px;"></textarea>' +
      _dBtn('diagKImport', '📥 导入知识库') + '<span id="diagKIMsg" style="font-size:12px;color:#0a7b5a;"></span><br>' +
      _dBtn('diagKFileBtn', '📁 导入文件') + '<input type="file" id="diagKFile" accept=".json,.txt,application/json,text/plain" style="display:none;">' +
      '<span id="diagKFMsg" style="font-size:12px;color:#999;"></span></div>') +
    '<div style="margin-top:12px;">' + _dBtn('diagStep5Btn', '下一步：⑥ 内容规划 & 封面', '', 'btn-primary') + _dBtn('diagSkipBtn', '跳过知识库', '', 'btn-outline') + '</div>';
  document.getElementById('diagKBuild')?.addEventListener('click', diagKbBuild);
  document.getElementById('diagKImport')?.addEventListener('click', diagKbImport);
  document.getElementById('diagKFileBtn')?.addEventListener('click', function () { const f = document.getElementById('diagKFile'); if (f) f.click(); });
  document.getElementById('diagKFile')?.addEventListener('change', diagKbImportFile);
  document.getElementById('diagStep5Btn')?.addEventListener('click', function () { diagGo(6); });
  document.getElementById('diagSkipBtn')?.addEventListener('click', function () { diagGo(6); });
}
async function diagKbBuild() {
  const btn = document.getElementById('diagKBuild'); const msg = document.getElementById('diagKMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 生成中…'; if (msg) msg.textContent = '';
try {
    // 复用②问卷回答（产品/客户/经验/数据/干货已覆盖），不再单独答 5 问
    const unified = _diagState.unifiedAnswers || Array.from((document.querySelectorAll('.diagQuiz_Q, .diagK_Q') || [])).map(function (el) { return { answer: el.value }; });
    const answers = unified.map(function (a, i) { return { q: (DIAG_UNIFIED_QUESTIONS[i] || ''), answer: (a && a.answer) || a.q || '' }; });
    const r = await _diagSay('aiKbBuild', { answers: answers });
    if (!r || !r.ok || !Array.isArray(r.entries) || !r.entries.length) throw new Error((r && r.error) || 'AI 未生成知识库');
    const saved = await _diagSay('aiKbSave', { entries: r.entries });
    const n = (saved && saved.added) || 0;
    if (msg) { msg.style.color = '#0a7b5a'; msg.innerHTML = '✅ 已生成 ' + r.entries.length + ' 条，新写入 ' + n + ' 条（重复自动跳过）。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; btn.textContent = t; }
}
async function diagKbImport() {
  const btn = document.getElementById('diagKImport'); const msg = document.getElementById('diagKIMsg');
  if (!btn) return; const text = ((document.getElementById('diagKImp') || {}).value || '').trim();
  if (!text) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '请先粘贴要导入的内容'; } return; }
  btn.disabled = true; if (msg) msg.textContent = '';
  try {
    const r = await _diagSay('aiKbImport', { text: text });
    if (!r || !r.ok) throw new Error((r && r.error) || '导入失败');
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已导入 ' + (r.added || 0) + ' 条（重复自动跳过）。'; }
} catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; }
}
async function diagKbImportFile() {
  const input = document.getElementById('diagKFile'); const msg = document.getElementById('diagKFMsg');
  const file = input && input.files && input.files[0]; if (!file) return;
  if (msg) msg.textContent = '';
  if (file.size > 2 * 1024 * 1024) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '⚠️ 文件太大（限 2MB）'; } input.value = ''; return; }
  try {
    const rawText = await new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('读取文件失败')); };
      r.readAsText(file, 'utf-8');
    });
    const trimmed = String(rawText || '').trim();
    if (!trimmed) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '文件是空的'; } input.value = ''; return; }
    const imp = await _diagSay('aiKbImport', { text: trimmed });
    if (!imp || !imp.ok) throw new Error((imp && imp.error) || '导入失败');
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '📁 ' + file.name + '：已导入 ' + (imp.added || 0) + ' 条（重复自动跳过）。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { if (input) input.value = ''; }
}

/* ── ⑤ 内容规划 & 封面 ── */
function diagStep5(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
  body.innerHTML =
    _diagCard(_diagStepTitle('⑥', '内容规划 & 封面') +
      '<div style="font-size:12px;color:#888;margin:4px 0;">选账号类型，AI 用②的同一套 10 问直接出笔记规划；再补封面设置。</div>' +
      _diagLabel('你的账号属于哪种？（选一个或自填）') + '<div id="diagPlanType" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' + DIAG_ACCOUNT_TYPES.map(function (ty) { return '<button type="button" class="planTypeChip" data-v="' + _dEsc(ty) + '" style="font-size:12px;padding:5px 10px;border:1px solid #dfe3ea;border-radius:14px;background:#f6f7f9;color:#555;cursor:pointer;">' + _dEsc(ty) + '</button>'; }).join('') + '</div>' +
'<input id="diagPlanTypeCustom" type="text" placeholder="其他，自己输入…" style="width:100%;box-sizing:border-box;margin-bottom:10px;">' +
      '<div style="font-size:12px;color:#888;margin:2px 0 6px;">内容规划（几页/频率/人群等）已复用②的统一问答，直接生成即可。</div>' +
      _dBtn('diagPlanBuild', '✨ 生成笔记内容规划') + '<span id="diagPlanMsg" style="font-size:12px;color:#0a7b5a;"></span>') +
'<div id="diagPlanResult" style="margin-top:10px;"></div>' +
    '<div style="margin-top:10px;">' + _diagCard(
      '<div style="font-weight:700;font-size:14px;">封面设置</div>' +
      '<div style="font-size:12px;color:#888;margin:4px 0;">起封面昵称、引流文案、一句话定位；再导入一张图作发笔记的封面底图（3:4），写回「设置→封面设置」。</div>' +
      _diagLabel('小红书昵称（封面署名）') + '<input id="diagCoverUser" type="text" maxlength="20" placeholder="例如：AI雕兄" style="width:100%;box-sizing:border-box;margin-bottom:8px;">' +
      _diagLabel('发行引流方式（封面下板块）') + '<input id="diagCoverCta" type="text" maxlength="30" placeholder="例如：私信领试用版" style="width:100%;box-sizing:border-box;margin-bottom:8px;">' +
      _diagLabel('页面封面简介（封面一句话）') + '<input id="diagCoverHook" type="text" maxlength="24" placeholder="例如：大厂码农" style="width:100%;box-sizing:border-box;margin-bottom:8px;">' +
      _diagLabel('封面底图（发笔记时用作底图模板）') +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">' +
        '<button type="button" id="diagCoverImgBtn" style="font-size:12px;padding:6px 12px;border:1px solid #d8dee9;border-radius:8px;background:#fff;color:#555;cursor:pointer;">📁 导入图片</button>' +
        '<input type="file" id="diagCoverFile" accept="image/*" style="display:none;">' +
        '<button type="button" id="diagCoverImgClear" style="font-size:12px;padding:5px 10px;border:1px solid #f2c2cd;border-radius:8px;background:#fff;color:#c41d3c;cursor:pointer;">🗑 清除底图</button>' +
      '</div>' +
      '<div id="diagCoverPreview" style="display:none;margin-bottom:8px;"><img id="diagCoverImgEl" style="max-width:110px;max-height:110px;object-fit:cover;border-radius:8px;border:1px solid #dfe8f5;display:block;"></div>' +
      '<div style="font-size:11px;color:#999;margin-bottom:8px;">3:4 竖图；导入后存为产品封底，发笔记时直接作底图。</div>' +
      _dBtn('diagCoverSave', '💾 保存封面设置') + '<span id="diagCoverMsg" style="font-size:12px;color:#0a7b5a;"></span>'
    ) + '</div>' +
    '<div style="margin-top:12px;">' + _dBtn('diagStep6Btn', '下一步：⑦ 深度报告', '', 'btn-primary') + '</div>';
  document.getElementById('diagPlanTypeCustom').value = '';
  document.querySelectorAll('.planTypeChip').forEach(function (b) { b.onclick = function () { document.querySelectorAll('.planTypeChip').forEach(function (x) { x.style.background = '#f6f7f9'; x.style.color = '#555'; x.style.borderColor = '#dfe3ea'; }); b.style.background = 'var(--xhs-red)'; b.style.color = '#fff'; b.style.borderColor = 'var(--xhs-red)'; _diagState.accountType = b.getAttribute('data-v'); }; });
document.getElementById('diagPlanTypeCustom')?.addEventListener('input', function (e) { if (e.target.value.trim()) { _diagState.accountType = e.target.value.trim(); document.querySelectorAll('.planTypeChip').forEach(function (x) { x.style.background = '#f6f7f9'; x.style.color = '#555'; x.style.borderColor = '#dfe3ea'; }); } });
  document.getElementById('diagPlanBuild')?.addEventListener('click', diagPlanBuild);
  document.getElementById('diagCoverSave')?.addEventListener('click', diagCoverSave);
  document.getElementById('diagCoverImgBtn')?.addEventListener('click', function () { const f = document.getElementById('diagCoverFile'); if (f) f.click(); });
  document.getElementById('diagCoverFile')?.addEventListener('change', diagCoverImgPick);
  document.getElementById('diagCoverImgClear')?.addEventListener('click', function () { _diagCoverImg = ''; var p = document.getElementById('diagCoverPreview'); if (p) p.style.display = 'none'; });
  document.getElementById('diagStep6Btn')?.addEventListener('click', function () { diagGo(7); });
  diagCoverPrefill();
}
var _diagCoverImg = '';
function diagCoverImgPick() {
  const input = document.getElementById('diagCoverFile'); const file = input && input.files && input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = function () {
    _diagCoverImg = String(r.result || '');
    const el = document.getElementById('diagCoverImgEl'); if (el) el.src = _diagCoverImg;
    const p = document.getElementById('diagCoverPreview'); if (p) p.style.display = '';
  };
  r.readAsDataURL(file);
}
async function diagCoverPrefill() {
  try {
    const cfg = await _diagGetCfg(); const p = cfg.product || {};
    if (p.username) { const el = document.getElementById('diagCoverUser'); if (el) el.value = p.username; }
    if (p.cta) { const el = document.getElementById('diagCoverCta'); if (el) el.value = p.cta; }
    if (p.coverHook) { const el = document.getElementById('diagCoverHook'); if (el) el.value = p.coverHook; }
    if (p.coverTemplate && p.coverTemplate.image) {
      _diagCoverImg = p.coverTemplate.image;
      const el = document.getElementById('diagCoverImgEl'); if (el) el.src = _diagCoverImg;
      const pv = document.getElementById('diagCoverPreview'); if (pv) pv.style.display = '';
    }
  } catch (_) {}
}
async function diagCoverSave() {
  const btn = document.getElementById('diagCoverSave'); const msg = document.getElementById('diagCoverMsg');
  if (!btn) return; btn.disabled = true; if (msg) msg.textContent = '';
  try {
    const cfg = await _diagGetCfg(); cfg.product = cfg.product || {};
    cfg.product.username = ((document.getElementById('diagCoverUser') || {}).value || '').trim();
    cfg.product.cta = ((document.getElementById('diagCoverCta') || {}).value || '').trim() || '私信领试用版';
    cfg.product.coverHook = ((document.getElementById('diagCoverHook') || {}).value || '').trim();
    // 封面底图：导入的图片 → 存为发笔记用的 coverTemplate
    const old = cfg.product.coverTemplate || {};
    if (_diagCoverImg) cfg.product.coverTemplate = { image: _diagCoverImg, w: 0, h: 0, preview: '', topBand: 0.14, bottomBand: 0.18 };
    else if (old && old.image) cfg.product.coverTemplate = null;
    await _diagSaveCfg(cfg);
    if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已保存封面设置（含底图，发笔记会用它作底）。'; }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; }
}
async function diagPlanBuild() {
  const btn = document.getElementById('diagPlanBuild'); const msg = document.getElementById('diagPlanMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 生成中…'; if (msg) msg.textContent = '';
  let type = _diagState.accountType;
  const cus = document.getElementById('diagPlanTypeCustom'); if (cus && cus.value.trim()) type = cus.value.trim();
try {
    // 复用②的统一 10 问回答（含人群/内容/页数/频率），不再重复提问
    const unified = _diagState.unifiedAnswers || Array.from((document.querySelectorAll('.diagPlan_Q, .diagP_Q') || [])).map(function (el, i) { return { answer: el.value }; });
    const answers = unified.map(function (a, i) { return { q: (DIAG_UNIFIED_QUESTIONS[i] || ''), answer: (a && a.answer) || a.q || '' }; });
    if (!type) throw new Error('请先选择/填写账号类型');
    const r = await _diagSay('aiNotePlan', { profile: _diagState.profile, persona: _diagState.persona, accountType: type || '', answers: answers });
    if (!r || !r.ok || !r.plan) throw new Error((r && r.error) || 'AI 未生成内容规划');
    _diagState.notePlan = r.plan;
    diagRenderPlan();
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { btn.disabled = false; btn.textContent = t; }
}
function diagRenderPlan() {
  const p = _diagState.notePlan || {};
  const box = document.getElementById('diagPlanResult'); if (!box) return;
  const topics = Array.isArray(p.topics) ? p.topics : [];
  const perPage = Array.isArray(p.perPage) ? p.perPage : [];
  let h = '<div style="border:1px solid #e5e8ee;border-radius:10px;padding:12px;background:#f8fafd;"><div style="font-weight:700;font-size:14px;">📚 内容规划结果</div>' +
    '<div style="font-size:12px;margin-top:4px;"><b>账号类型：</b>' + _dEsc(p.accountType || '') + '</div>' +
    (p.contentFocus ? '<div style="font-size:12px;margin-top:4px;"><b>讲什么内容：</b>' + _dEsc(p.contentFocus) + '</div>' : '') +
    (p.targetPeople ? '<div style="font-size:12px;margin-top:4px;"><b>主要人群：</b>' + _dEsc(p.targetPeople) + '</div>' : '') +
    (p.pageCount ? '<div style="font-size:12px;margin-top:4px;"><b>建议页数：</b>' + _dEsc(p.pageCount) + ' 页</div>' : '') +
    (perPage.length ? '<div style="font-size:12px;margin-top:4px;"><b>每页作用：</b><div style="white-space:pre-wrap;margin-left:8px;">' + perPage.map(function (x, i) { return 'P' + (i + 1) + '. ' + _dEsc(x); }).join('\n') + '</div></div>' : '') +
    (p.frequency ? '<div style="font-size:12px;margin-top:4px;"><b>发布频率：</b>' + _dEsc(p.frequency) + '</div>' : '') +
    (p.timing ? '<div style="font-size:12px;margin-top:4px;"><b>发布时间：</b>' + _dEsc(p.timing) + '</div>' : '') +
    (topics.length ? '<div style="font-size:12px;margin-top:6px;"><b>选题池：</b>' + topics.map(function (x) { return '<div style="font-size:12px;margin:2px 0 2px 8px;">· ' + _dEsc(x.title || '') + (x.angle ? '（' + _dEsc(x.angle) + '）' : '') + '</div>'; }).join('') + '</div>' : '') +
    '</div>';
  box.innerHTML = h;
}

/* ── ⑥ 深度报告 ── */
function diagStep6(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
  body.innerHTML = _diagCard(_diagStepTitle('⑦', '深度评估报告') +
    '<div style="font-size:12px;color:#888;margin:4px 0;">综合主页、人设/风格、产品卖点、知识库、内容规划与封面，产出一份带整改优先级的深度报告。</div>' +
    _dBtn('diagReportBuild', '✨ 生成深度评估报告') + '<span id="diagReportMsg" style="font-size:12px;color:#0a7b5a;"></span>') +
    '<div id="diagReportResult" style="margin-top:10px;"></div>';
  document.getElementById('diagReportBuild')?.addEventListener('click', diagDeepReportBuild);
  if (_diagState.report) diagRenderReport();
}
async function diagDeepReportBuild() {
  const btn = document.getElementById('diagReportBuild'); const msg = document.getElementById('diagReportMsg');
  if (!btn || _diagState.busy) return; _diagState.busy = 'report';
  btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 生成中…'; if (msg) msg.textContent = '';
  try {
    const planText = _diagState.notePlan ? JSON.stringify(_diagState.notePlan) : '';
    const r = await _diagSay('aiDeepReport', { profile: _diagState.profile, persona: _diagState.persona, accountType: _diagState.accountType, planText: planText });
    if (!r || !r.ok || !r.report) throw new Error((r && r.error) || 'AI 未生成报告');
    _diagState.report = r.report;
    diagRenderReport();
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
  finally { _diagState.busy = ''; btn.disabled = false; btn.textContent = t; }
}
function diagRenderReport() {
  const r = _diagState.report || {};
  const box = document.getElementById('diagReportResult'); if (!box) return;
  const sections = Array.isArray(r.sections) ? r.sections : [];
  const priorities = Array.isArray(r.priorities) ? r.priorities : [];
  const risks = Array.isArray(r.risks) ? r.risks : [];
  const block = function (label, txt) { return txt ? '<div style="font-size:12px;margin-top:4px;"><b>' + label + '：</b>' + txt + '</div>' : ''; };
  let h = '<div style="border:1px solid #e5e8ee;border-radius:10px;padding:12px;background:#f8fafd;">' +
    '<div style="font-weight:700;font-size:14px;">📋 深度评估报告</div>' +
    (r.overall ? '<div style="font-size:13px;color:#c41d3c;margin-top:4px;font-weight:600;">' + _dEsc(r.overall) + '</div>' : '') +
    (r.summary ? '<div style="font-size:12px;margin-top:4px;">' + _dEsc(r.summary) + '</div>' : '') +
    (r.positioning ? block('定位/人设问题', _dEsc(r.positioning.issue)) + block('定位/人设建议', _dEsc(r.positioning.suggestion)) : '') +
    (r.personaReview ? block('人设问题', _dEsc(r.personaReview.issue)) + block('人设建议', _dEsc(r.personaReview.suggestion)) : '') +
    (r.kbReview ? block('知识库问题', _dEsc(r.kbReview.issue)) + block('知识库建议', _dEsc(r.kbReview.suggestion)) : '') +
    (r.structure ? block('笔记架构建议', '<span style="white-space:pre-wrap;">' + _dEsc(r.structure) + '</span>') : '') +
    (r.frequency ? block('发布频率与时间', _dEsc(r.frequency)) : '') + '</div>';
  h += '<div style="margin-top:8px;">' + sections.map(function (s) { return '<div style="border:1px solid #eee;border-radius:8px;padding:8px 10px;background:#fff;margin-top:6px;"><div style="font-weight:600;font-size:13px;">' + _dEsc(s.name) + '</div>' + (s.issue ? '<div style="font-size:12px;color:#d33;margin-top:2px;">问题：' + _dEsc(s.issue) + '</div>' : '') + (s.suggestion ? '<div style="font-size:12px;color:#0a7b5a;margin-top:2px;">建议：' + _dEsc(s.suggestion) + '</div>' : '') + '</div>'; }).join('') + '</div>';
  h += (priorities.length ? '<div style="margin-top:8px;"><b>⚡ 优先整改</b><ol style="margin:4px 0 0 18px;">' + priorities.map(function (x) { return '<li style="font-size:12px;">' + _dEsc(x) + '</li>'; }).join('') + '</ol></div>' : '');
  h += (risks.length ? '<div style="margin-top:8px;"><b>⚠️ 风险提醒</b><ul style="margin:4px 0 0 18px;">' + risks.map(function (x) { return '<li style="font-size:12px;">' + _dEsc(x) + '</li>'; }).join('') + '</ul></div>' : '');
  h += '<div style="margin-top:12px;">' + _dBtn('diagCopyBtn', '📋 复制报告', '', 'btn-outline') + '</div>';
  box.innerHTML = h;
  document.getElementById('diagCopyBtn')?.addEventListener('click', diagCopyReport);
}
async function diagCopyReport() {
  const r = _diagState.report || {};
  const sections = Array.isArray(r.sections) ? r.sections : [];
  const lines = ['【深度评估报告】', r.overall || '', r.summary || ''];
  if (r.positioning && r.positioning.suggestion) lines.push('定位/人设建议：' + r.positioning.suggestion);
  (Array.isArray(r.priorities) ? r.priorities : []).forEach(function (x, i) { lines.push((i + 1) + '. ' + x); });
  sections.forEach(function (s) { lines.push('【' + (s.name || '') + '】问题：' + (s.issue || '') + '；建议：' + (s.suggestion || '')); });
  const btn = document.getElementById('diagCopyBtn');
  try { await copyToClipboard(lines.filter(Boolean).join('\n')); if (btn) btn.textContent = '✅ 已复制'; } catch (_) {}
}