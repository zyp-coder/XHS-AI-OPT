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

// ========== 本地回复记录管理（chrome.storage.local） ==========
const REPLIED_KEY = 'replied_comments';

// ========== 灌水总结记录（今天灌了多少、灌了哪些评论/话术，最多保留 500 条） ==========
const WATER_LOGS_KEY = 'watering_logs';
const WATER_LOGS_LIMIT = 500;

/** 读取全部灌水明细（新→旧） */
async function getWaterLogs() {
  try {
    const data = await chrome.storage.local.get(WATER_LOGS_KEY);
    const logs = data[WATER_LOGS_KEY] || [];
    return Array.isArray(logs) ? logs : [];
  } catch (_) { return []; }
}

/** 追加一条灌水明细（新记录在最前，超出上限裁剪最旧） */
async function addWaterLog(entry) {
  try {
    const logs = await getWaterLogs();
    logs.unshift({ ...entry, ts: Date.now() });
    if (logs.length > WATER_LOGS_LIMIT) logs.length = WATER_LOGS_LIMIT;
    await chrome.storage.local.set({ [WATER_LOGS_KEY]: logs });
  } catch (_) {}
}

/** 清空灌水明细 */
async function clearWaterLogs() {
  try { await chrome.storage.local.set({ [WATER_LOGS_KEY]: [] }); } catch (_) {}
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
  const data = await chrome.storage.local.get(REPLIED_KEY);
  const map = data[REPLIED_KEY] || {};
  return map[noteUrl] || [];
}

/** 将一条回复保存到本地存储 */
async function addLocalReply(noteUrl, author, comment) {
  if (!noteUrl) return;
  const data = await chrome.storage.local.get(REPLIED_KEY);
  const map = data[REPLIED_KEY] || {};
  if (!map[noteUrl]) map[noteUrl] = [];
  const exists = map[noteUrl].some(e => e.author === author && e.comment === comment);
  if (!exists) {
    map[noteUrl].push({ author, comment, repliedAt: Date.now() });
    await chrome.storage.local.set({ [REPLIED_KEY]: map });
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

document.addEventListener('DOMContentLoaded', async () => {
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
  document.getElementById('batchSendBtn')?.addEventListener('click', batchSendAll);
  // ★ 首次使用引导：还没配过 AI Key → 顶部提示去走 3 步向导
  (async function firstRunHint() {
    try {
      const got = await chrome.storage.local.get('config');
      const ai = (got.config && got.config.ai) || {};
      if (ai.apiKey) return; // 已配置，不打扰
      const bar = document.createElement('div');
      bar.style.cssText = 'z-index:99980;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1a1a1f;color:#f2f2f4;font-size:12.5px;border-bottom:1px solid #33333a;';
      bar.innerHTML = '<span>🎯 还没配置 AI，功能用不了。</span>';
      const b = document.createElement('button');
      b.textContent = '去完成首次设置（5 步）';
      b.style.cssText = 'margin-left:auto;padding:6px 12px;border:none;border-radius:8px;background:#ff274b;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;';
      b.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('wizard.html') });
      bar.appendChild(b);
      (document.body || document.documentElement).insertBefore(bar, document.body.firstChild);
    } catch (_) {}
  })();
  // 主功能 Tab：一级（诊断/发笔记/获客/AI客服）+ 获客二级（获客助手/用户清单/灌水总结）
  document.getElementById('tabCommentAssistant')?.addEventListener('click', () => switchMainTab('comment'));
  document.getElementById('tabProspectList')?.addEventListener('click', () => switchMainTab('prospectList'));
  document.getElementById('tabWaterSummary')?.addEventListener('click', () => switchMainTab('waterSummary'));
  document.getElementById('tabNotePublish')?.addEventListener('click', () => switchMainTab('notePublish'));
  document.getElementById('tabDiagnose')?.addEventListener('click', () => switchMainTab('diagnose'));
  document.getElementById('tabHuoke')?.addEventListener('click', () => switchMainTab('comment'));
  // ★ 默认落到「账号诊断」Tab（与按钮高亮一致；小窗模式后续仍强制收敛为状态卡）
  switchMainTab('diagnose');
  bindProspectModals();
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
    ['tabCommentAssistant', 'tabProspectList', 'tabWaterSummary', 'tabNotePublish', 'tabHuoke'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const _subT = document.getElementById('subTabs'); if (_subT) _subT.style.display = 'none';
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

/* ─── 主功能 Tab 切换：评论助手 / 评论跟进 / 获客清单 ─── */
let _chatFollowLoaded = false;
let _prospectListLoaded = false;
let _autoProfiledOnce = false; // 本次 popup 生命周期内只自动画像一次
function switchMainTab(name) {
  const tabComment = document.getElementById('tabCommentAssistant');
  const tabFollow = document.getElementById('tabChatFollow');
  const tabProspect = document.getElementById('tabProspectList');
  const tabWater = document.getElementById('tabWaterSummary');
  const tabNote = document.getElementById('tabNotePublish');
  const tabDiag = document.getElementById('tabDiagnose');
  const tabHuoke = document.getElementById('tabHuoke');
  const subTabs = document.getElementById('subTabs');
  const mc = document.getElementById('mainContent');
  const fc = document.getElementById('chatFollowContent');
  const pc = document.getElementById('prospectContent');
  const wc = document.getElementById('waterSummaryContent');
  const nc = document.getElementById('notePublishContent');
  const dc = document.getElementById('diagnoseContent');
  const _hideAll = () => { if (mc) mc.style.display = 'none'; if (fc) fc.style.display = 'none'; if (pc) pc.style.display = 'none'; if (wc) wc.style.display = 'none'; if (nc) nc.style.display = 'none'; if (dc) dc.style.display = 'none'; };
  const _markTop = (el) => {
    [tabComment, tabFollow, tabProspect, tabWater, tabNote, tabDiag, tabHuoke].forEach(t => { if (t) t.classList.remove('active'); });
    if (el) el.classList.add('active');
  };
  const _hideSub = () => { if (subTabs) subTabs.style.display = 'none'; };
  const _showSub = () => { if (subTabs) subTabs.style.display = ''; };
  if (name === 'prospectList') {
    _markTop(tabHuoke); _showSub(); if (tabProspect) tabProspect.classList.add('active'); _hideAll(); if (pc) pc.style.display = '';
    _setPanelLeftVisible(false);
    _setToolbarMode('prospectList');
    _setProspectCleanMode(true); // ★ 获客清单页：隐藏“评论助手”标题/返回/刷新/设置/状态栏
    if (!_prospectListLoaded) { _prospectListLoaded = true; if (pc) loadProspectList(pc); }
  } else if (name === 'waterSummary') {
    _markTop(tabHuoke); _showSub(); if (tabWater) tabWater.classList.add('active'); _hideAll(); if (wc) wc.style.display = '';
    _setPanelLeftVisible(false);
    _setToolbarMode('waterSummary');
    if (wc && !_waterSummaryLoaded) { _waterSummaryLoaded = true; renderWaterSummary(wc); }
  } else if (name === 'notePublish') {
    _markTop(tabNote); _hideSub(); _hideAll(); if (nc) nc.style.display = '';
    _setPanelLeftVisible(false);
    _setToolbarMode('prospectList');
    _setProspectCleanMode(true); // ★ 发笔记页：隐藏“评论助手”标题/右侧按钮/待机状态栏
    if (nc && !_notePublishLoaded) { _notePublishLoaded = true; renderNotePublish(nc); }
  } else if (name === 'diagnose') {
    _markTop(tabDiag); _hideSub(); _hideAll(); if (dc) dc.style.display = '';
    _setPanelLeftVisible(false);
    _setToolbarMode('prospectList');
    _setProspectCleanMode(true); // ★ 账号诊断页：隐藏评论助手工具栏/状态栏，作为独立大功能
    if (dc && !_diagLoaded) { _diagLoaded = true; renderDiagnosis(dc); }
  } else {
    // comment（获客助手）或默认
    _markTop(tabHuoke); _showSub(); if (tabComment) tabComment.classList.add('active'); _hideAll(); if (mc) mc.style.display = '';
    _setPanelLeftVisible(true);
    _setToolbarMode('comment');
    _setProspectCleanMode(false); // 恢复评论助手标题/返回/状态栏
  }
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

/* ═══════════ ✍️ 发笔记（知识库 → 一键 / 定时发布小红书笔记） ═══════════ */
let _npSchedCache = null;
function _npEl(container, id) { return container ? container.querySelector('#' + id) : null; }
function npFmtWhen(ms) { const d = new Date(ms); return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

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
    return '<span style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1;flex:none;color:' +
      (done ? '#fff' : '#9aa0ac') +
      ';background:' + (done ? 'linear-gradient(135deg,#ff2442,#ff6675)' : '#eef0f4') +
      ';box-shadow:' + (cur ? '0 0 0 3px #ffe9ec;' : 'none') + '">' + (on ? '✓' : (i + 1)) + '</span>';
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
    const c = await chrome.storage.local.get('config');
    const spList = (c && c.config && c.config.product && c.config.product.sellPoints) || [];
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
      '<div style="font-size:12px;font-weight:700;color:#333;margin-bottom:6px;">④ 成稿（标题/正文/标签可再改）</div>' +
      '<div id="npTitles" style="margin-bottom:8px;"></div>' +
      '<div style="font-size:11px;font-weight:700;color:#333;margin:8px 0 4px;">📝 正文</div>' +
      '<textarea id="npResult" rows="8" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:12px;line-height:1.6;resize:vertical;"></textarea>' +
      '<div id="npTags" style="margin:8px 0;"></div>' +
      '<div id="npImages" style="margin:8px 0;"></div>' +
      '<div id="npCover" style="margin:8px 0;"></div>' +
      '<div id="npKv" style="margin:8px 0;"></div>' +
      '<div id="npSelf" style="margin:8px 0;"></div>' +
      '<div id="npExtras" style="font-size:11px;color:#666;background:#f7f7f8;border-radius:8px;padding:8px 10px;margin-top:8px;"></div>');
    npBuildDraft(container);
  }
}

async function npBuildDraft(container) {
  _npImgResults = [];
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
      npKvRender(container, d, sellPointStr);
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
  return back + ' ' + btnWiz('np-copy-result', '📋 复制成稿', true) + ' ' + btnWiz('np-export-pdf', '📄 导出 PDF', false) + ' <span style="flex:1;"></span> ' + btnWiz('np-wiz-again', '🔄 重新生成', false) + ' ' + btnWiz('np-wiz-next', '↩ 再来一篇(新卖点)', false);
}

async function npRenderScheduled(container) {
  const el = _npEl(container, 'npSchedList');
  if (!el) return;
  let list = [];
  try { list = (await chrome.runtime.sendMessage({ action: 'listScheduledPublishes' })) || []; _npSchedCache = list; } catch (_) {}
  const pend = list.filter(x => !x.done);
  if (!pend.length) { el.innerHTML = '<div style="font-size:11px;color:#bbb;padding:2px 0;">暂无定时任务</div>'; return; }
  el.innerHTML = pend.map(x => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed #eee;font-size:11px;">
      <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#333;">${esc(x.title)}</span>
      <span style="color:#e07b00;">🕒 ${npFmtWhen(x.when)}</span>
      <button data-id="${esc(x.id)}" class="np-cancel" style="flex:none;border:none;background:none;color:#d32f2f;cursor:pointer;font-size:11px;">取消</button>
    </div>`).join('');
  el.querySelectorAll('.np-cancel').forEach(btn => btn.addEventListener('click', () => npCancelSchedule(btn.getAttribute('data-id'), container)));
}
function _npSchedFor(entryId) {
  if (!_npSchedCache) return false;
  return _npSchedCache.some(x => String(x.id) === String(entryId) && !x.done);
}
async function npScheduleQuick(entryId, kbList, container) {
  const e = kbList.find(x => String(x.id) === String(entryId));
  if (!e) return;
  const d = prompt('定时提醒时间（格式：YYYY-MM-DD HH:mm）');
  if (!d) return;
  const when = new Date(d.replace(' ', 'T')).getTime();
  if (isNaN(when) || when <= Date.now()) { toast('时间格式不对或不是未来时间', 'error'); return; }
  await npDoSchedule(e, when, container);
}
async function npAddSchedule(container, kbList) {
  const sel = _npEl(container, 'npSchedSel'); const whenEl = _npEl(container, 'npSchedWhen');
  const entry = kbList.find(x => String(x.id) === String(sel && sel.value));
  const when = new Date((whenEl && whenEl.value) || '').getTime();
  if (!entry) { toast('请选择知识库条目', 'error'); return; }
  if (!when || isNaN(when) || when <= Date.now()) { toast('请选择未来的发布时间', 'error'); return; }
  await npDoSchedule(entry, when, container);
}
async function npDoSchedule(entry, when, container) {
  const btn = _npEl(container, 'npSchedBtn');
  if (btn) { btn.disabled = true; btn.textContent = '设定中…'; }
  try {
    await chrome.runtime.sendMessage({ action: 'scheduleNotePublish', when, id: entry.id, title: entry.title, content: entry.content, tags: entry.tags || [], image: entry.image || '' });
    toast('⏰ 已设定定时提醒：' + npFmtWhen(when));
  } catch (e) { toast('定时失败：' + ((e && e.message) || e), 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = '设定'; }
  await npRenderScheduled(container);
}
async function npCancelSchedule(id, container) {
  try { await chrome.runtime.sendMessage({ action: 'cancelScheduledPublish', id }); } catch (_) {}
  await npRenderScheduled(container);
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
    if (t && t.closest('.np-export-pdf')) { npExportPdf(nc); return; }
    if (t && t.closest('.np-refresh')) { _notePublishLoaded = false; renderNotePublish(nc); return; }
    if (t && t.closest('.np-sched-set')) { npAddSchedule(nc, _npActiveKB || []); return; }
    if (t && t.closest('.np-cancel')) { npCancelSchedule(t.closest('.np-cancel').getAttribute('data-id'), nc); return; }
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
    if (t && t.closest('.np-img-gen')) { const bi = parseInt(t.closest('.np-img-gen').getAttribute('data-i'), 10); if (!isNaN(bi)) npGenImage(nc, bi); return; }
    if (t && t.closest('.np-copy-img')) { const i2 = parseInt(t.closest('.np-copy-img').getAttribute('data-i'), 10); const url = _npImgResults[i2]; if (url) { copyImageToClipboard(url).then(ok => { if (typeof toast === 'function') toast(ok ? '图片已复制，去小红书粘贴' : '复制失败，请点「保存图」'); }).catch(() => { if (typeof toast === 'function') toast('复制失败，请点「保存图」'); }); } return; }
    if (t && t.closest('.np-dl-img')) { const i3 = parseInt(t.closest('.np-dl-img').getAttribute('data-i'), 10); if (_npImgResults[i3]) downloadImageDataUrl(_npImgResults[i3], 'note_img_' + (i3 + 1) + '.png'); return; }
    if (t && t.closest('.np-copy-sellimg')) { const src = t.closest('.np-copy-sellimg').getAttribute('data-src') || ''; if (src && typeof copyImageToClipboard === 'function') { copyImageToClipboard(src).then(ok => { if (typeof toast === 'function') toast(ok ? '卖点配图已复制，去小红书粘贴' : '复制失败，请点「存图」'); }).catch(() => { if (typeof toast === 'function') toast('复制失败，请点「存图」'); }); } return; }
    if (t && t.closest('.np-dl-sellimg')) { const src = t.closest('.np-dl-sellimg').getAttribute('data-src') || ''; const i4 = t.closest('.np-dl-sellimg').getAttribute('data-i') || '1'; if (src && typeof downloadImageDataUrl === 'function') downloadImageDataUrl(src, 'sellpt_img_' + i4 + '.png'); return; }
    if (t && t.closest('.np-cover-copy')) { const cv = _npCoverCanvas; if (cv) { copyImageToClipboard(cv.toDataURL('image/png')).then(ok => { if (typeof toast === 'function') toast(ok ? '封面已复制，去小红书粘贴' : '复制失败，请点「下载」'); }).catch(() => { if (typeof toast === 'function') toast('复制失败，请点「下载」'); }); } return; }
    if (t && t.closest('.np-cover-dl')) { const cv = _npCoverCanvas; if (cv) downloadImageDataUrl(cv.toDataURL('image/png'), 'cover.png'); return; }
    if (t && t.closest('.np-copy-plans')) { const d = _npWiz && _npWiz.draft; const plans = (d && d.imagePlans) || []; const lines = plans.map((pp, ii) => (pp.name ? pp.name + '：\n' : ('图' + (ii + 1) + '：\n')) + organizeNpImagePrompt(pp)); const txt = lines.join('\n\n——\n\n'); if (txt && typeof copyToClipboard === 'function') { copyToClipboard(txt).then(() => { if (typeof toast === 'function') toast('已复制全部配图提示词，去千问粘贴'); }).catch(() => {}); } return; }
    if (t && t.closest('.np-sheet-pdf')) { npOpenSheet(nc, 'pdf'); return; }
    if (t && t.closest('.np-sheet-image')) { npOpenSheet(nc, 'image'); return; }
    if (t && t.closest('.np-copy-planone')) { const el = t.closest('.np-copy-planone'); const v = el.getAttribute('data-text') || ''; if (v && typeof copyToClipboard === 'function') copyToClipboard(v).then(() => { if (typeof toast === 'function') toast('提示词已复制，去千问粘贴'); }).catch(() => {}); return; }
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
  try { const c = await chrome.storage.local.get('config'); return (c.config && c.config.product && c.config.product.name) || ''; } catch (_) { return ''; }
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
    }));
    _npNote.title = titles[0] || '';
  }
  const resultEl = _npEl(container, 'npResult'); if (resultEl) resultEl.value = d.content || '';
  renderNpTags(container, d);
  renderNpImages(container, d);
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

function renderNpImages(container, d) {
  const box = _npEl(container, 'npImages');
  if (!box) return;
  const plans = (d && d.imagePlans) || [];
  const sellImgs = ((_npWiz && _npWiz.sellImages) || []).slice(0, 10);
  const sellHtml = sellImgs.length
    ? '<div style="margin:6px 0;padding:8px;border:1px dashed #c026a3;border-radius:8px;background:#fffafd;">' +
      '<div style="font-size:11px;font-weight:700;color:#c026a3;margin-bottom:6px;">🎯 所选卖点的配图（已带入文案，可直接复制/加工或随笔记发布）</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
      sellImgs.map((src, si) => '<div style="text-align:center;max-width:104px;">' +
        '<img src="' + src + '" style="width:104px;height:88px;object-fit:cover;border-radius:6px;border:1px solid #eee;display:block;">' +
        '<button type="button" class="np-copy-sellimg" data-src="' + src + '" style="margin-top:4px;padding:2px 8px;border:1px solid #c026a3;border-radius:6px;background:#fff;color:#c026a3;font-size:10px;cursor:pointer;">📋 复制图</button>' +
        '<button type="button" class="np-dl-sellimg" data-src="' + src + '" data-i="' + si + '" style="margin-top:4px;margin-left:4px;padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:#666;font-size:10px;cursor:pointer;">⬇ 存图</button>' +
        '</div>').join('') +
      '</div></div>'
    : '';
  box.innerHTML = sellHtml +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:4px;"><div style="font-size:11px;font-weight:700;color:#333;">🖼 配图(详细文字素材 + 提示词)</div>' +
    '<span style="display:flex;gap:6px;align-items:center;">' +
    (plans.length ? '<button type="button" class="np-copy-plans" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 8px;">📋 复制全部提示词</button>' : '') +
    '<button type="button" class="np-sheet-pdf" style="border:1px solid #ff274b;border-radius:6px;background:#fff;color:#ff274b;font-size:11px;cursor:pointer;padding:2px 8px;">📄 产品介绍页 PDF</button>' +
    '<button type="button" class="np-sheet-image" style="border:1px solid #c026a3;border-radius:6px;background:#fff;color:#c026a3;font-size:11px;cursor:pointer;padding:2px 8px;">🖼 一屏卖点说明图</button>' +
    '</span></div>' +
    (plans.length ? plans.map((p, i) => {
    const cur = (_npImgResults && _npImgResults[i]) || '';
    const promptTxt = organizeNpImagePrompt(p);
    const shootTxt = organizeNpShoot(p);
    const planName = (p.name || ('图' + (i + 1)));
    return '<div style="margin:6px 0;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fff;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">' +
        '<div style="font-size:11px;font-weight:700;color:#ff2442;">' + esc(planName) + '</div>' +
        '<button type="button" class="np-copy-planone" data-i="' + i + '" data-text="' + String(promptTxt).replace(/"/g, '&quot;') + '" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 10px;">📋 复制提示词(扔千问)</button>' +
      '</div>' +
      (p.text ? '<div style="font-size:11px;color:#333;margin-bottom:2px;"><b>大字主文案：</b>' + esc(p.text) + '</div>' : '') +
      '<pre style="font-size:11px;color:#555;background:#f7f7f8;border-radius:6px;padding:6px 8px;margin:0 0 4px;white-space:pre-wrap;word-break:break-all;font-family:inherit;">' + esc(promptTxt) + '</pre>' +
      '<div style="font-size:11px;color:#6b4f00;background:#fff7e6;border-radius:6px;padding:5px 8px;">📷 你要准备的素材：' + esc(shootTxt) + '</div>' +
      (cur ? '<div style="margin-top:6px;"><img src="' + cur + '" style="max-width:170px;border-radius:8px;display:block;"><button type="button" class="np-copy-img" data-i="' + i + '" style="margin-top:6px;padding:3px 8px;border:1px solid #ff2442;border-radius:6px;background:#fff;color:#ff2442;font-size:11px;cursor:pointer;">📋 复制图</button> <button type="button" class="np-dl-img" data-i="' + i + '" style="padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:#fff;color:#666;font-size:11px;cursor:pointer;">⬇ 保存图</button></div>' : '') +
      '</div>';
  }).join('') : '<div style="font-size:11px;color:#999;">（文案稿未附配图建议，可纯文字发）</div>');
}

function organizeNpImagePrompt(p) {
  p = p || {};
  const s = (x) => String(x || '').trim();
  const lines = [];
  const big = s(p.text);
  const layout = s(p.layout);
  const style = s(p.style);
  const desc = s(p.desc);
  const shoot = s(p.shoot);
  lines.push('我提供了一张素材（截图/实拍，见附件）。请以它为主体/参考元素，帮我生成一张竖版 3:4 的小红书封面/配图，画面要符合：');
  if (big) lines.push('· 大字主文案：' + big);
  if (layout) lines.push('· 版式与文字摆放：' + layout);
  if (layout) { /* keep */ }
  if (style) lines.push('· 配色/风格/质感：' + style);
  if (desc) lines.push('· 整张画面最终效果：' + desc);
  if (shoot) lines.push('· 素材用途：' + shoot);
  lines.push('· 通用要求：构图简洁、主体突出、留白得当、文字清晰可读、层级分明、风格整体统一。');
  return lines.join('\n');
}
function organizeNpShoot(p) {
  const s = String((p && p.shoot) || '').trim();
  if (s) return s;
  return String((p && p.desc) || '一张能体现该文案主题的真实截图或实拍').trim();
}

// ═══════════════ 封面合成（Canvas 三段式：上署名 / 中内容 / 下引流，测量-自适应防出界） ═══════════════
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
      const c = await chrome.storage.local.get('config');
      const cfg = (c && c.config) || {};
      const p = cfg.product || {};
      const per = cfg.persona || {};
      _npCoverOpts = {
        username: p.username || '',
        name: p.name || '',
        hook: p.coverHook || per.coverHook || '',
        cta: p.cta || '',
        template: (p.coverTemplate && p.coverTemplate.image) ? p.coverTemplate : null,
      };
    } catch (_) { _npCoverOpts = { username: '', name: '', hook: '', cta: '', template: null }; }
    if (!_npCoverOpts.cta) _npCoverOpts.cta = '私信"玄铁剑"领试用版';
  }
  box.innerHTML =
    '<div style="border:1px solid #dbe4f0;border-radius:10px;padding:10px;background:#fafcff;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' +
    '<div style="font-size:11px;font-weight:700;color:#1f6feb;">🎨 封面合成（上署名·中内容·下引流）</div>' +
    '<div style="display:flex;gap:6px;align-items:center;">' +
    '<button type="button" class="np-cover-copy" style="border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;font-size:11px;cursor:pointer;padding:2px 10px;">📋 复制封面</button>' +
    '<button type="button" class="np-cover-dl" style="padding:2px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#666;font-size:11px;cursor:pointer;">⬇ 下载</button>' +
    '</div></div>' +
    '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">' +
    '<canvas id="npCoverCanvas" width="400" height="533" style="width:200px;border-radius:8px;border:1px solid #dfe8f5;background:#eee;"></canvas>' +
    '<div style="flex:1;min-width:180px;">' +
    '<div style="font-size:11px;color:#333;margin-bottom:2px;">封面简介（上板块人设标签）：</div>' +
    '<input type="text" class="np-cover-input" data-k="hook" maxlength="24" value="' + esc(_npCoverOpts.hook || '') + '" style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;margin-bottom:6px;font-family:inherit;">' +
    '<div style="font-size:11px;color:#333;margin-bottom:2px;">引流方式（下板块）：</div>' +
    '<input type="text" class="np-cover-input" data-k="cta" maxlength="40" value="' + esc(_npCoverOpts.cta || '') + '" style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:inherit;">' +
    '<div style="font-size:11px;color:#999;margin-top:6px;">改了会自动重排封面；标题/副标题来自成稿 AI（可在正文里改后点「重新生成」）。</div>' +
    '</div></div></div>';
  const canvas = box.querySelector('#npCoverCanvas');
  box.querySelectorAll('.np-cover-input').forEach(inp => inp.addEventListener('input', () => {
    _npCoverOpts[inp.getAttribute('data-k')] = inp.value;
    renderCoverCanvas(canvas, cover, _npCoverOpts);
  }));
  renderCoverCanvas(canvas, cover, _npCoverOpts);
  _npCoverCanvas = canvas;
}
let _npCoverCanvas = null;

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
  const topBand = 0.14, bottomBand = 0.18;
  const topEnd = Math.round(H * topBand);
  const botStart = Math.round(H * (1 - bottomBand));
  const padX = Math.round(W * 0.08);
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
    const alpha = (cover.grad && cover.grad.alpha) || 0.4;
    // 中部微压暗，保证文字可读
    const midGrad = c.createLinearGradient(0, topEnd, 0, botStart);
    midGrad.addColorStop(0, 'rgba(0,0,0,' + (alpha * 0.7) + ')');
    midGrad.addColorStop(1, 'rgba(0,0,0,' + alpha + ')');
    c.fillStyle = midGrad; c.fillRect(0, topEnd, W, botStart - topEnd);

    c.textBaseline = 'alphabetic';
    // ── 上板块：用户名 · 产品名 · 人设短语 ──
    const topText = [o.username, o.name, o.hook].filter(Boolean).join(' · ');
    let topSz = 40;
    c.font = 'bold ' + topSz + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    while (topSz > 26 && c.measureText(topText).width > maxW) { topSz -= 2; c.font = 'bold ' + topSz + 'px "Microsoft YaHei","PingFang SC",sans-serif'; }
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.fillText(topText, W / 2, topEnd / 2 + topSz * 0.35);

    // ── 中板块：标题 + 副标题 + 卖点（自适应防出界） ──
    const midTop = topEnd + (botStart - topEnd) * 0.12;
    const midBot = botStart - (botStart - topEnd) * 0.10;
    const midH = midBot - midTop;
    const baseSize = cover.baseSize || 88;
    const lh = cover.lineHeight || 1.12;
    const titleFit = coverFitBlock(c, cover.title || '', baseSize, 40, maxW, midH * 0.5, 3, lh);
    const subFit = coverFitBlock(c, cover.subtitle || '', Math.round(baseSize * 0.5), 28, maxW, midH * 0.2, 2, lh);
    const points = cover.points || [];
    let y = midTop;
    // 标题（居中，偏上）
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';
    c.font = 'bold ' + Math.round(titleFit.sz * lh) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    titleFit.lines.forEach((ln, i) => { c.fillText(ln, W / 2, y + (i + 1) * titleFit.sz * lh); });
    y += titleFit.h + Math.round(baseSize * 0.18);
    // 副标题
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.font = Math.round(subFit.sz * lh) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    if (subFit.lines[0]) c.fillText(subFit.lines[0], W / 2, y + subFit.sz * lh);
    y += subFit.h + Math.round(baseSize * 0.16);
    // 卖点（每条左侧竖条装饰）
    const ptSz = Math.max(30, Math.round(baseSize * 0.34));
    for (let i = 0; i < points.length; i++) {
      const block = coverFitBlock(c, points[i], ptSz, 26, maxW * 0.9, midH, 2, lh);
      c.fillStyle = 'rgba(255,120,120,0.95)';
      c.fillRect(W / 2 - maxW * 0.45, y - block.sz * 0.72, 6, block.sz * 1.1);
      c.fillStyle = 'rgba(255,255,255,0.95)';
      c.font = Math.round(block.sz * lh) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
      c.fillText(block.lines[0], W / 2, y + block.sz * lh);
      y += block.h + Math.round(ptSz * 0.5);
    }

    // ── 下板块：引流方式 ──
    const cta = o.cta || '';
    let ctaSz = 46;
    c.font = 'bold ' + ctaSz + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    while (ctaSz > 26 && c.measureText(cta).width > maxW) { ctaSz -= 2; c.font = 'bold ' + ctaSz + 'px "Microsoft YaHei","PingFang SC",sans-serif'; }
    c.fillStyle = '#ffd54f';
    c.textAlign = 'center';
    c.fillText(cta, W / 2, botStart + (H - botStart) / 2 + ctaSz * 0.35);
  }
}

async function npGenImage(nc, i) {
  const d = (_npWiz && _npWiz.draft) || _lastNoteDraft;
  const plans = (d && d.imagePlans) || [];
  const p = plans[i];
  if (!p) { if (typeof toast === 'function') toast('还没有这张图的素材，请先返回重新生成成稿', 'error'); return; }
  const prompt = (p.text || '') + (p.desc ? '，' + p.desc : '') + (p.style ? '，风格：' + p.style : '') + '，竖版3:4，小红书封面/配图风格';
  _npImgResults[i] = '';
  renderNpImages(nc, d);
  const msg = nc.querySelector('.np-imsg[data-i="' + i + '"]');
  if (msg) msg.textContent = '⏳ 生成中…';
  try {
    if (msg) msg.textContent = '⏳ 生成中…(多模态模型，约 10~30 秒)';
    const res = await chrome.runtime.sendMessage({ action: 'generateNoteImage', prompt });
    _npImgResults[i] = (res && res.image) || '';
    if (!_npImgResults[i]) throw new Error((res && res.reason) || '接口未返回图片');
  } catch (e) {
    _npImgResults[i] = '';
    if (msg) msg.textContent = '❌ ' + ((e && e.message) || e);
    else if (typeof toast === 'function') toast('生成失败：' + ((e && e.message) || e), 'error');
  }
  renderNpImages(nc, d);
}

/* ═══════════ 知识科普配图：背景 + 元素Canvas合成器 ═══════════ */
var _npKv = { pages: [], sellPoint: '' , _bound: false };
function _kvWrap(c, text, maxW, fs, lh) {
  const chars = String(text || '').split('');
  const lines = []; let cur = '';
  for (const ch of chars) {
    const t = cur + ch;
    if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = ch; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('');
  return lines;
}
function _kvRoundRect(c, x, y, w, h, r) {
  r = Math.min(r || 0, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function _kvDrawEl(c, el, W, H) {
  const x = (el.x == null ? 0.5 : el.x) * W;
  const y = (el.y == null ? 0.4 : el.y) * H;
  const wPix = (el.w == null ? 0.8 : el.w) * W;
  const fs = Math.max(14, el.fontSize || 58);
  const col = el.color || '#1f1f1f';
  const align = el.textAlign || 'center';
  const font = (el.weight === 'bold' ? 'bold ' : '') + fs + 'px "Microsoft YaHei","PingFang SC",sans-serif';
  const draw = () => {
    c.font = font; c.textAlign = align; c.textBaseline = 'top';
    let txt = String(el.text || '');
    if (el.type === 'point') txt = '● ' + txt;
    if (el.type === 'data') { c.fillStyle = col; }
    c.fillStyle = col;
    const MAXW = wPix * 0.96, lh = 1.18;
    const lines = _kvWrap(c, txt, MAXW, fs, lh);
    const lineH = fs * lh;
    // bg pill
    if (el.bg) {
      const tw = c.measureText(lines[0]).width;
      const pad = fs * 0.5;
      const totalW = tw + pad * 2;
      let rx = (align === 'center') ? x - totalW / 2 : (align === 'left' ? x : x - totalW);
      _kvRoundRect(c, rx, y - fs * 0.25, totalW, lineH * lines.length + fs * 0.5, el.radius == null ? fs * 0.55 : el.radius);
      c.fillStyle = el.bg; c.fill();
      c.fillStyle = col;
    }
    lines.forEach((ln, i) => c.fillText(ln, x, y + i * lineH));
    // left accent bar for point
    if (el.type === 'point' && el.bg) {
      c.fillStyle = col; c.fillRect(x - fs * 0.9, y + lineH * 0.15, 6, lineH * 0.7);
    }
  };
  draw();
  if (el.stroke) { c.strokeStyle = el.stroke; c.lineWidth = 3; _kvRoundRect(c, x - wPix * 0.4, y - fs * 0.4, wPix, (fs * 1.18 * ((el.text || '').length ? 1 : 1)) * 1.2, 12); c.stroke(); }
}
function _kvDrawBg(c, W, H, bgData) {
  if (bgData) {
    const img = new Image();
    img.onload = () => { const iw = img.width, ih = img.height, r = W / H, ir = iw / ih; let sw, sh; if (ir > r) { sh = ih; sw = ih * r; } else { sw = iw; sh = iw / r; } c.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H); };
    img.onerror = () => { _kvDrawBlank(c, W, H); };
    img.src = bgData;
    return;
  }
  _kvDrawBlank(c, W, H);
}
function _kvDrawBlank(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#f3f5fb');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // 轻装饰圆点
  c.fillStyle = 'rgba(255,39,75,0.10)';
  c.beginPath(); c.arc(W * 0.9, H * 0.08, 60, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(31,111,235,0.10)';
  c.beginPath(); c.arc(W * 0.08, H * 0.92, 80, 0, Math.PI * 2); c.fill();
}
function npKvDraw(canvas, page) {
  if (!canvas) return;
  const W = 1000, H = 1333;
  canvas.width = W; canvas.height = H;
  canvas.style.maxWidth = '160px'; canvas.style.aspectRatio = '3/4';
  const c = canvas.getContext('2d');
  if (page.bg) {
    const img = new Image();
    img.onload = () => { const iw = img.width, ih = img.height, r = W / H, ir = iw / ih; let sw, sh; if (ir > r) { sh = ih; sw = ih * r; } else { sw = iw; sh = iw / r; } c.clearRect(0, 0, W, H); c.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H); (page.layout || []).forEach((el) => _kvDrawEl(c, el, W, H)); };
    img.onerror = () => { c.clearRect(0, 0, W, H); _kvDrawBlank(c, W, H); (page.layout || []).forEach((el) => _kvDrawEl(c, el, W, H)); };
    img.src = page.bg;
  } else {
    c.clearRect(0, 0, W, H);
    _kvDrawBlank(c, W, H);
    (page.layout || []).forEach((el) => _kvDrawEl(c, el, W, H));
  }
  page.canvasUrl = canvas.toDataURL('image/png');
}
async function npKvLoadFor(draft) {
  const p = { pages: [] };
  try { const r = await chrome.storage.local.get('note_plan'); const plan = (r && r.note_plan) || {}; if (Array.isArray(plan.photoPlans) && plan.photoPlans.length) { p.pages = plan.photoPlans; } } catch (_) {}
  if (!p.pages.length) {
    const ip = (draft && draft.imagePlans) || [];
    p.pages = ip.length ? ip.map((x, i) => ({ page: x && x.name ? x.name : ('P' + (i + 1)), purpose: (x && x.text) || '', bgKind: '留白信息卡', suggest: (x && x.layout) || '', importHint: '无' })) : [ { page: '封面', purpose: '', bgKind: '留白信息卡', suggest: '', importHint: '无' }, { page: 'P2', purpose: '', bgKind: '数据卡', suggest: '', importHint: '无' } ];
  }
  return p;
}
function npKvPageCard(idx, ph) {
  const page = { idx, page: ph.page || ('P' + (idx + 1)), purpose: ph.purpose || '', bgKind: ph.bgKind || '留白信息卡', suggest: ph.suggest || '', importHint: ph.importHint || '无', bg: '', layout: null, aiPrompt: '' };
  return page;
}
function npKvRender(container, draft, sellPointStr) {
  const box = _npEl(container, 'npKv');
  if (!box) return;
  _npKv.sellPoint = sellPointStr || '';
  box.innerHTML = '<div style="border:1px solid #e5e8ee;border-radius:10px;padding:10px;background:#fafcff;">' +
    '<div style="font-size:12px;font-weight:700;color:#c026a3;margin-bottom:2px;">🧩 知识科普配图（背景 + 元素 Canvas 合成）</div>' +
    '<div style="font-size:11px;color:#888;margin-bottom:8px;">每页 = 背景（默认简约留白/可导入/AI提示词）＋ 元素（大字/要点/数据/对比/流程，前端 Canvas 画，不走文生图）。逐张出，失败只影响当前张；可一键生成剩余全部。</div>' +
    '<div id="npKvBody"></div>' +
    '<div style="margin-top:8px;">' + btnWiz('np-kv-all', '✨ 生成剩余全部', true, true) + ' <span id="npKvMsg" style="font-size:11px;color:#0a7b5a;"></span></div></div>';
  const ctx = { draft, sellPointStr };
  npKvLoadFor(draft).then((o) => { _npKv.pages = o.pages.map(npKvPageCard); npKvRenderBody(box, ctx); });
  npKvEnsureBind();
}
function npKvRenderBody(box, ctx) {
  const body = box.querySelector('#npKvBody'); if (!body) return;
  body.innerHTML = _npKv.pages.map((page, idx) => {
    const title = (page.bgKind || '留白信息卡').indexOf('案例') >= 0 ? '· 该页需真实背景' : '· 背景由前端自绘';
    return '<div class="npkv-card" data-kv="' + idx + '" style="border:1px solid #e5e8ee;border-radius:8px;padding:8px;margin-bottom:8px;background:#fff;">' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      '<span style="font-weight:700;font-size:12px;color:#1f1f1f;">🧾 ' + esc(page.page || ('P' + (idx + 1))) + '</span>' +
      '<span class="kv-bgkind" style="font-size:10px;color:#c026a3;background:#fdf0f6;border-radius:6px;padding:1px 6px;">' + esc(page.bgKind || '留白信息卡') + '</span>' +
      '<span style="font-size:10px;color:' + (title.indexOf('真实') >= 0 ? '#e07b00' : '#1f6feb') + ';">' + title + '</span>' +
      '<div style="margin-left:auto;display:flex;gap:4px;"></div></div>' +
      (page.purpose ? '<div style="font-size:11px;color:#666;margin-top:2px;">🎯 ' + esc(page.purpose) + '</div>' : '') +
      (page.importHint && page.importHint !== '无' ? '<div style="font-size:11px;color:#8a6d3b;margin-top:1px;">📥 建议：' + esc(page.importHint) + '</div>' : '') +
      '<div style="display:flex;gap:10px;align-items:flex-start;margin-top:6px;">' +
      '<canvas class="npkv-canvas" data-kv="' + idx + '" width="250" height="333" style="width:110px;border-radius:6px;border:1px solid #e5e8ee;background:#eee;"></canvas>' +
      '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:10px;color:#999;">背景</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;">' +
      '<button class="npkv-act" data-kv="' + idx + '" data-act="blank" style="font-size:10px;padding:2px 8px;border:1px solid #d8dee9;border-radius:6px;background:#fff;color:#555;cursor:pointer;">⬜ 简约</button>' +
      '<button class="npkv-act np-kv-import" data-kv="' + idx + '" data-act="import" style="font-size:10px;padding:2px 8px;border:1px solid #cbb;border-radius:6px;background:#fff;color:#a80;cursor:pointer;">📤 导入背景</button>' +
      '<input type="file" accept="image/*" class="npkv-file" data-kv="' + idx + '" style="display:none;">' +
      '<button class="npkv-act" data-kv="' + idx + '" data-act="aibg" style="font-size:10px;padding:2px 8px;border:1px solid #c9a;border-radius:6px;background:#fff;color:#c026a3;cursor:pointer;">🤖 背景提示词</button>' +
      '</div>' +
      '<div class="npkv-promptbox" data-kv="' + idx + '" style="display:none;margin-bottom:4px;"><textarea class="npkv-prompt" data-kv="' + idx + '" rows="2" placeholder="背景提示词…" style="width:100%;box-sizing:border-box;font-size:11px;"></textarea>' +
      '<button class="npkv-act" data-kv="' + idx + '" data-act="pcopy" style="font-size:10px;padding:2px 8px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#555;cursor:pointer;">📋 复制提示词</button></div>' +
      '<div style="font-size:10px;color:#999;margin-bottom:4px;">元素（布局 · Canvas 画）</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;">' +
      '<button class="npkv-act" data-kv="' + idx + '" data-act="layout" style="font-size:10px;padding:2px 10px;border:none;border-radius:6px;background:#c026a3;color:#fff;cursor:pointer;">✨ 布局元素</button>' +
      '<button class="npkv-act" data-kv="' + idx + '" data-act="copy" style="font-size:10px;padding:2px 8px;border:1px solid #1f6feb;border-radius:6px;background:#fff;color:#1f6feb;cursor:pointer;">📋 复制图</button>' +
      '<button class="npkv-act" data-kv="' + idx + '" data-act="dl" style="font-size:10px;padding:2px 8px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#666;cursor:pointer;">⬇ 下载</button>' +
      '</div></div></div></div>';
  }).join('');
  // initial draw blanks
  box; body.querySelectorAll('.npkv-canvas').forEach(function (cv) { const idx = parseInt(cv.getAttribute('data-kv'), 10); npKvDraw(cv, _npKv.pages[idx]); });
}
function npKvEnsureBind() {
  if (_npKv._bound) return; _npKv._bound = true;
  document.addEventListener('click', function (ev) {
    const t = ev.target;
    if (t && t.closest && t.closest('#npKv')) {
      const el = t.closest('.npkv-act'); if (el) { ev.preventDefault(); npKvAction(el); return; }
    }
  });
  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t && t.classList && t.classList.contains('npkv-file')) { const idx = parseInt(t.getAttribute('data-kv'), 10); npKvImport(idx, t); }
  });
}
function _npkvEl(idx, sel) { return document.querySelector('#npKvBody .npkv-card[data-kv="' + idx + '"] ' + sel); }
function _npkvCanvas(idx) { return document.querySelector('#npKvBody .npkv-canvas[data-kv="' + idx + '"]'); }
async function npKvAction(el) {
  const idx = parseInt(el.getAttribute('data-kv'), 10); const act = el.getAttribute('data-act');
  const page = _npKv.pages[idx]; if (!page) return;
  const msg = document.getElementById('npKvMsg');
  try {
    if (act === 'blank') { page.bg = ''; page.aiPrompt = ''; npKvDraw(_npkvCanvas(idx), page); }
    else if (act === 'import') { const f = document.querySelector('#npKvBody .npkv-file[data-kv="' + idx + '"]'); if (f) f.click(); }
    else if (act === 'aibg') { const r = await chrome.runtime.sendMessage({ action: 'aiBgPrompt', data: { page: page.page, purpose: page.purpose, bgKind: page.bgKind, sellPoint: _npKv.sellPoint } }); (r && r.ok && r.prompt) ? npKvShowPrompt(idx, r.prompt) : (() => { throw new Error((r && r.error) || 'AI 未返回'); })(); }
    else if (act === 'pcopy') { const ta = _npkvEl(idx, '.npkv-prompt'); if (ta && typeof copyToClipboard === 'function') copyToClipboard(ta.value.trim()).then(function () { if (msg) msg.textContent = '✅ 背景提示词已复制，去千问/生图工具跑'; }).catch(function () { if (typeof toast === 'function') toast('复制失败'); }); }
    else if (act === 'layout') { await npKvLayout(idx); }
    else if (act === 'copy') { const cv = _npkvCanvas(idx); if (cv && typeof copyImageToClipboard === 'function') { copyImageToClipboard(cv.toDataURL('image/png')).then(function (ok) { if (typeof toast === 'function') toast(ok ? '配图已复制，去小红书粘贴' : '复制失败，请点「下载」'); }).catch(function () { if (typeof toast === 'function') toast('复制失败，请点「下载」'); }); } }
    else if (act === 'dl') { const cv = _npkvCanvas(idx); if (cv && typeof downloadImageDataUrl === 'function') downloadImageDataUrl(cv.toDataURL('image/png'), 'kv_' + page.page + '.png'); }
  } catch (e) { if (msg) { msg.style.color = '#c62828'; msg.textContent = '❌ ' + (e.message || e); } }
}
function npKvShowPrompt(idx, prompt) {
  const page = _npKv.pages[idx];
  const box = _npkvEl(idx, '.npkv-promptbox'); if (box) box.style.display = '';
  const ta = _npkvEl(idx, '.npkv-prompt'); if (ta) ta.value = prompt;
}
async function npKvLayout(idx) {
  const page = _npKv.pages[idx];
  const draft = (_npWiz && _npWiz.draft) || {};
  const titles = (draft.titles || []);
  const mainTitle = (titles && titles[0]) || page.purpose || '';
  const pts = (page.purpose ? [page.purpose] : []).concat(_npKv.sellPoint ? [_npKv.sellPoint] : []);
  const btn = document.querySelector('#npKvBody .npkv-card[data-kv="' + idx + '"] .npkv-act[data-act="layout"]');
  if (btn) { btn.disabled = true; btn.textContent = '排版中…'; }
  try {
    const r = await chrome.runtime.sendMessage({ action: 'aiCanvasLayout', data: { sellPoint: _npKv.sellPoint, title: mainTitle, points: pts, purpose: page.purpose, bgKind: page.bgKind } });
    if (!r || !r.ok || !Array.isArray(r.elements) || !r.elements.length) throw new Error((r && r.error) || 'AI 未返回布局');
    page.layout = r.elements;
    npKvDraw(_npkvCanvas(idx), page);
    const msg = document.getElementById('npKvMsg'); if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已排版「' + page.page + '」'; }
  } finally { if (btn) { btn.disabled = false; btn.textContent = '✨ 布局元素'; } }
}
async function npKvImport(idx, input) {
  const f = input && input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async function () { const page = _npKv.pages[idx]; if (page) { page.bg = String(r.result || ''); const cv = _npkvCanvas(idx); if (cv) { const c = cv.getContext('2d'); const img = new Image(); img.onload = function () { c.clearRect(0, 0, 1000, 1333); const iw = img.width, ih = img.height, W = 1000, H = 1333, ir = iw / ih, rr = W / H; let sw, sh; if (ir > rr) { sh = ih; sw = ih * rr; } else { sw = iw; sh = iw / rr; } c.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H); (page.layout || []).forEach(function (el) { _kvDrawEl(c, el, W, H); }); page.canvasUrl = c.canvas.toDataURL('image/png'); }; img.src = page.bg; } } };
  r.readAsDataURL(f);
}
document.addEventListener('click', function (ev) { const t = ev.target; if (t && t.classList && t.classList.contains('np-kv-all')) { ev.preventDefault(); npKvAll(); } });
async function npKvAll() {
  const btn = document.querySelector('.np-kv-all'); const msg = document.getElementById('npKvMsg');
  const todo = _npKv.pages.filter(function (p) { return !p.layout; });
  if (btn) { btn.disabled = true; }
  let ok = 0, fail = 0;
  for (const page of todo) {
    try { await npKvLayout(page.idx); ok++; }
    catch (e) { fail++; }
  }
  if (btn) { btn.disabled = false; }
  if (msg) { msg.style.color = '#0a7b5a'; msg.textContent = '✅ 已生成 ' + ok + ' 张' + (fail ? ('，失败 ' + fail) : ''); }
}

/* ── 发笔记配图：一键把整篇的 imagePlans 串行生成到图（可选兜底） ── */
async function npExportPdf(nc) {
  try {
    const draft = (_npWiz && _npWiz.draft) || _lastNoteDraft || {};
    const resultEl = _npEl(nc, 'npResult');
    const bodyText = ((resultEl && resultEl.value) || draft.content || '').trim();
    if (!bodyText) { if (typeof toast === 'function') toast('还没有成稿内容，请先生成', 'error'); return; }
    const title = (_npNote && _npNote.title) || ((draft.titles || [])[0]) || '';
    const tags = ((_npNote && _npNote.tags) || (draft.tags) || []).map(t => '#' + String(t).replace(/^#/, '').trim()).join(' ');
    const plans = (draft.imagePlans) || [];
    const timeTip = draft.timeTip || '';
    const selfComment = draft.selfComment || '';
    const escB = esc, nl = (s) => escB(s || '').replace(/\r?\n/g, '<br>');
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const plansHtml = plans.length ? plans.map((p, i) =>
      `<tr><td class="pn">${escB(p.name || ('图' + (i + 1)))}</td>` +
      `<td class="pt">${nl(p.text)}</td>` +
      `<td class="pd">${nl(p.desc)}</td>` +
      `<td class="pp">${nl(organizeNpImagePrompt(p))}</td></tr>`).join('')
      : '<tr><td colspan="4" style="color:#888;">（无配图建议，可纯文字发）</td></tr>';
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escB(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.75 "Microsoft YaHei","PingFang SC",sans-serif;background:#f4f5f7;color:#1f1f1f;padding:24px}
  .bar{max-width:820px;margin:0 auto 14px;display:flex;gap:8px;align-items:center}
  .btn{padding:10px 18px;background:#ff274b;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
  .btn.ghost{background:#fff;color:#333;border:1px solid #d7d9de}
  .page{max-width:820px;margin:0 auto;background:#fff;border:1px solid #e7e8ec;border-radius:10px;padding:34px 40px}
  h1{font-size:22px;line-height:1.5;margin-bottom:6px}
  .meta{font-size:12px;color:#999;margin-bottom:18px;border-bottom:1px solid #eee;padding-bottom:10px}
  .sec{margin:18px 0}
  .sec .h{font-size:13px;font-weight:700;color:#ff274b;margin-bottom:6px}
  .content{white-space:normal;font-size:14px;line-height:1.85}
  .tags{margin-top:4px;font-size:13px;color:#c02;background:#fff5f6;border-radius:8px;padding:8px 12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px}
  th,td{border:1px solid #e7e7e7;padding:7px 9px;vertical-align:top;text-align:left}
  th{background:#f7f8fa;color:#555;font-weight:600}
  td.pn{font-weight:600;white-space:nowrap}
  tt{font-family:monospace;font-size:12.5px;color:#333}
  .sc{background:#fff7e6;border:1px solid #f0e0b8;border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.8}
  .foot{text-align:center;color:#aaa;font-size:11px;margin-top:22px}
  @media print{
    body{background:#fff;padding:0}
    .bar{display:none}
    .page{border:none;box-shadow:none;border-radius:0;padding:8px}
  }
</style></head><body>
<div class="bar"><button class="btn" onclick="window.print()">🖨 打印 / 另存为 PDF</button><button class="btn ghost" onclick="window.close()">关闭</button></div>
<div class="page">
  <h1>${nl(title)}</h1>
  <div class="meta">小红书发笔记 · 成稿导出 · ${dateStr}</div>
  <div class="content">${nl(bodyText)}</div>
  ${tags ? '<div class="sec tags">' + escB(tags) + '</div>' : ''}
  <div class="sec"><div class="h">🗂 配图占位</div><table><thead><tr><th>图位</th><th>大字文案</th><th>内容/风格</th><th>文案素材（可直接交给生图）</th></tr></thead><tbody>${plansHtml}</tbody></table></div>
  ${timeTip ? '<div class="sec"><div class="h">⏰ 建议发布时段</div><div>' + escB(timeTip) + '</div></div>' : ''}
  ${selfComment ? '<div class="sec"><div class="h">📌 置顶自评（发完 1 小时内贴）</div><div class="sc">' + escB(selfComment) + '</div></div>' : ''}
  <div class="foot">小红书评论助手 · 自动生成</div>
</div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},300);});</script>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try { await chrome.tabs.create({ url }); } catch (_) {
      const w = window.open(url, '_blank'); if (w && w.focus) w.focus();
    }
    if (typeof toast === 'function') toast('已打开导出页，点「打印/另存为 PDF」即可');
  } catch (e) {
    if (typeof toast === 'function') toast('导出失败：' + ((e && e.message) || e), 'error');
  }
}

async function npSheetData() {
  const d = {};
  try { d.cfg = (await chrome.storage.local.get('config')).config || {}; } catch (_) { d.cfg = {}; }
  try { d.kb = (await chrome.storage.local.get('knowledge_base')).knowledge_base || []; } catch (_) { d.kb = []; }
  d.note = (_npWiz && _npWiz.draft) || _lastNoteDraft || {};
  d.point = (_npWiz && _npWiz.chosen || []).map(x => ({ point: x.point, why: x.why })).filter(x => x.point);
  d.people = (_npWiz && _npWiz.chosenPeople || []).map(p => ({ name: p.name, pain: p.pain })).filter(p => p.name);
  return d;
}

function sheetCommonHtml() {
  return '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>';
}

function buildProductSheetHtml(d) {
  const escB = esc, nl = (s) => escB(s || '').replace(/\r?\n/g, '<br>');
  const prodName = escB((d.cfg.product && d.cfg.product.name) || d.note.title || '未命名产品');
  const prodDesc = (d.cfg.product && d.cfg.product.description) || '';
  const sell = d.point || [];
  const people = d.people || [];
  const kb = (d.kb || []).filter(e => e.isActive !== false && (e.title || e.content)).slice(0, 8);
  const sellHtml = sell.length ? sell.map((s2, i) => '<div class="sp" style="page-break-inside:avoid;"><div class="k">卖点' + (i + 1) + '</div><div class="t">' + escB(s2.point) + '</div>' + (s2.why ? '<div class="w">' + escB(s2.why) + '</div>' : '') + '</div>').join('')
    : (prodDesc ? '<div class="sp"><div class="t">' + nl(prodDesc) + '</div></div>' : '<div class="sp"><div class="t">（未提供卖点，请在基本配置填写产品简讯）</div></div>');
  const kbHtml = kb.length ? kb.map(k => '<div class="use" style="page-break-inside:avoid;"><b>' + escB(k.title || '知识要点') + '</b>' + (k.content ? '<div>' + escB(String(k.content).slice(0, 300)) + '</div>' : '') + '</div>').join('')
    : '<div style="color:#999;font-size:12px;">（尚未录入知识库，建议在「设置→知识库」补充行业知识/真实经历，让介绍更有干货）</div>';
  const peopleHtml = people.length ? people.map(p => escB(p.name) + (p.pain ? '｜' + escB(p.pain) : '')).join('　·　') : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escB((d.cfg.product && d.cfg.product.name) || '产品介绍')} · 产品介绍页</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.75 "Microsoft YaHei","PingFang SC",sans-serif;background:#fff;color:#1f1f1f;padding:26px}
  .page{max-width:720px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:30px 34px}
  .bar{max-width:720px;margin:0 auto 12px;display:flex;gap:8px}
  .btn{padding:10px 16px;border:none;border-radius:8px;background:#ff274b;color:#fff;font-weight:600;cursor:pointer}
  .btn.g{background:#fff;color:#333;border:1px solid #d7d9de}
  h1{font-size:24px;color:#ff274b;margin-bottom:4px}
  .slogan{font-size:15px;color:#333;margin-bottom:18px}
  .sec{margin:18px 0}
  .sec h2{font-size:16px;color:#1f1f1f;border-left:4px solid #ff274b;padding-left:9px;margin-bottom:10px;page-break-after:avoid}
  .sp{background:#fff7f9;border:1px solid #ffe0e6;border-radius:10px;padding:10px 14px;margin-bottom:8px}
  .sp .k{font-size:11px;color:#ff274b;font-weight:700}
  .sp .t{font-size:15px;font-weight:600;margin:2px 0}
  .sp .w{font-size:12.5px;color:#666}
  .use{background:#f7f9ff;border:1px solid #e3e9f7;border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:13px}
  .use b{color:#1f53c4}
  .ppl{font-size:12.5px;color:#666;margin-top:4px}
  .foot{text-align:center;color:#bbb;font-size:11px;margin-top:22px}
  @media print{body{padding:0}.bar{display:none}.page{border:none;border-radius:0;padding:6px}}
</style></head><body>
<div class="bar"><button class="btn" onclick="window.print()">🖨 导出 PDF</button><button class="btn g" onclick="window.close()">关闭</button></div>
<div class="page">
  <h1>${prodName}</h1>
  <div class="slogan">${nl(prodDesc)}</div>
  ${peopleHtml ? '<div class="ppl">🎯 主打人群：' + peopleHtml + '</div>' : ''}
  <div class="sec"><h2>🛠 核心卖点</h2>${sellHtml}</div>
  <div class="sec"><h2>📚 知识库 / 实力背书</h2>${kbHtml}</div>
  <div class="foot">${prodName} · 产品介绍 · 小红书运营助手生成</div>
</div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},300);});</script>
</body></html>`;
}

function buildOnePageSheetHtml(d) {
  const escB = esc, nl = (s) => escB(s || '').replace(/\r?\n/g, '<br>');
  const prodName = escB((d.cfg.product && d.cfg.product.name) || d.note.title || '我的产品');
  const prodDesc = (d.cfg.product && d.cfg.product.description) || (d.note.title || '');
  const sell = d.point || [];
  const kb = (d.kb || []).filter(e => e.isActive !== false && (e.title || e.content)).slice(0, 4);
  const sellHtml = sell.length ? sell.map((s2) => '<div class="cell"><b>' + escB(s2.point) + '</b>' + (s2.why ? '<p>' + escB(s2.why) + '</p>' : '') + '</div>').join('')
    : '<div class="cell"><b>' + nl(prodDesc) + '</b></div>';
  const kbHtml = kb.length ? kb.map(k => '<li>' + escB(k.title || (String(k.content).slice(0, 24) + '…')) + '</li>').join('') : '<li>行业经验 / 真实案例（可在知识库补充）</li>';
  const imagePrompt = [
    '用我给的文字生成一张"手机一屏能放下、但信息很详尽的卖点说明图"（竖版，手机海报横幅取景）：',
    '页头：产品名「' + prodName + '」+ 一行大字主打卖点·主色撞色、大字居中做视觉焦点；',
    '中间：核心卖点分条陈列，每条一个小标题 + 一行能看懂的解释，条目间留白清晰、层级分明；',
    '下方：知识库/实力背书 2~4 条要点小标签；',
    '结尾：一行行动引导（如"评论区聊聊 / 点头像看更多"）。',
    '整体：配色统一、信息密但不挤，手机一屏扫完可读，请把每句话都排进去。'
  ].join('\n');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${prodName} · 一屏卖点说明</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:15px/1.5 "Microsoft YaHei","PingFang SC",sans-serif;background:#444}
  .bar{max-width:520px;margin:10px auto;display:flex;gap:8px;align-items:center}
  .btn{padding:9px 14px;border:none;border-radius:8px;background:#ff274b;color:#fff;font-weight:600;cursor:pointer}
  .btn.g{background:#fff;color:#333;border:1px solid #ccc}
  .note{color:#eee;font-size:12px;flex:1}
  .phone{max-width:430px;margin:0 auto;background:#fff;color:#111;font-family:"Microsoft YaHei",sans-serif}
  .hd{background:#ff274b;color:#fff;padding:22px 22px 16px}
  .hd .p{font-size:12px;opacity:.85}
  .hd .n{font-size:26px;font-weight:800;line-height:1.2}
  .hd .s{font-size:13px;opacity:.92;margin-top:4px}
  .body{padding:16px 18px 6px}
  .body h3{font-size:13px;color:#ff274b;margin-bottom:8px}
  .cell{background:#fff7f9;border:1px solid #ffe0e6;border-radius:10px;padding:9px 12px;margin-bottom:8px}
  .cell b{font-size:15px}
  .cell p{font-size:12.5px;color:#555;margin-top:3px}
  .tags{margin:8px 18px 0}
  .tags h3{font-size:13px;color:#ff274b;margin-bottom:6px}
  .tags ul{list-style:none;padding:0}
  .tags li{display:inline-block;background:#f0f3ff;border:1px solid #dde5ff;color:#1f53c4;border-radius:12px;padding:3px 10px;font-size:12px;margin:0 4px 6px 0}
  .cta{margin:14px 18px 20px;background:#ff274b;color:#fff;text-align:center;padding:12px;border-radius:12px;font-weight:700;font-size:15px}
  .q{background:#f7f9ff;border:1px solid #e3e9f7;border-radius:10px;padding:10px 12px;margin:10px 18px 20px;font-size:12px;color:#333;white-space:pre-wrap;display:none}
  .q b{display:block;color:#1f53c4;margin-bottom:4px}
  .btn.cp{background:#1f6feb}
  @media print{body{background:#fff}.bar{display:none}.phone{margin:0 auto}} 
</style></head><body>
<div class="bar"><button class="btn" onclick="window.print()">🖨 导出 PDF</button><button class="btn cp" onclick="var el=document.getElementById('q');el.style.display='block';var t=el.innerText;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){el.innerHTML='<b>已复制给千问的提示词</b>'+t;});">📋 复制千问提示词</button><span class="note">图片：点右上「导出PDF」或对手机屏截图保存</span></div>
<div class="phone">
  <div class="hd"><div class="p">小红书 · 产品卖点一屏</div><div class="n">${prodName}</div><div class="s">${nl(prodDesc)}</div></div>
  <div class="body"><h3>核心卖点</h3>${sellHtml}</div>
  <div class="tags"><h3>实力背书</h3><ul>${kbHtml}</ul></div>
  <div class="cta">点我头像，看更多干货</div>
</div>
<div class="q" id="q"><b>把你的这段提示词 + 下方文字扔给千问，它会生成一张"一屏卖点说明图"：</b>${nl(imagePrompt)}</div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},300);});</script>
</body></html>`;
}

async function npOpenSheet(nc, kind) {
  try {
    const d = await npSheetData();
    const html = kind === 'image' ? buildOnePageSheetHtml(d) : buildProductSheetHtml(d);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try { await chrome.tabs.create({ url }); } catch (_) { const w = window.open(url, '_blank'); if (w && w.focus) w.focus(); }
    if (typeof toast === 'function') toast(kind === 'image' ? '已打开"一屏卖点说明"，可导出PDF或截图' : '已打开"产品介绍页"，点「导出 PDF」即可');
  } catch (e) {
    if (typeof toast === 'function') toast('生成失败：' + ((e && e.message) || e), 'error');
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
  const batch = document.getElementById('batchSendBtn');
  const refresh = document.getElementById('refreshBtn');
  if (!batch || !refresh) return;
  if (mode === 'prospectList') {
    batch.style.display = 'none';
    refresh.style.display = 'none';
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
    batch.style.display = 'none';
    refresh.style.display = 'none';
    if (!_followBatchBtn) {
      _followBatchBtn = document.createElement('button');
      _followBatchBtn.className = 'batch-send-btn';
      _followBatchBtn.textContent = '🤖 通知页全部回复';
      _followBatchBtn.title = '在通知页自动回复所有待回复会话：AI 生成 → 自动发送 → 3~8 秒间隔防反爬';
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
    batch.style.display = 'none';
    refresh.style.display = 'none';
    if (_followBatchBtn) _followBatchBtn.style.display = 'none';
    if (_followRefreshBtn) _followRefreshBtn.style.display = 'none';
    if (_plRefreshBtn) _plRefreshBtn.style.display = 'none';
    if (_plSettingsBtn) _plSettingsBtn.style.display = 'none';
  } else {
    batch.style.display = '';
    refresh.style.display = '';
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
let _plFilter = { keyword: '', tag: '', intent: '' };
let _plPage = 0;
let _plData = { list: [], allTags: [], fullList: [] };
let _plStage = 'all'; // 子视图：all(全部) / prospect(商机池) / lead(线索池)
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
const _plEntry = p => ((p && p.source && p.source.stageEntry) || '');

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
const PL_DEFAULT_STATUSES = ['待触达', '已回复', '谈单中', '已成交'];
const PL_ENTRY_BADGE = {
  '点赞': { t: '💗点赞', c: '#0e7490', bg: '#ecfeff' },
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
const _plStatusColor = (s) => ({ '待触达': '#2563eb', '已触达': '#b45309', '已回复': '#059669', '谈单中': '#7c3aed', '已成交': '#92400e' }[s] || '#6b7280');
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
// 层内"下一步"建议（体现"接触过没 → 下一步该做啥"）
function _plNextHint(p) {
  const s = _plGetStage(p);
  if (s === 'lead') return '🎇 线索 · 未接触：发个私信或手动升格，接触过就算商机';
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

  const resp = await chrome.runtime.sendMessage({ action: 'getProspectList', data: { filter: _plFilter } });
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
  renderProspectList(container);

  // ★ 打开获客清单即自动补全"未画像"的客户（本次 popup 生命周期只跑一次，完成后刷新显示）
  if (!_autoProfiledOnce) {
    _autoProfiledOnce = true;
    // v2：只给商机池（真需求待经营）补全画像，线索池/客户池不烧 AI
    const unpro = fullList.filter(p => p && p.id && p.stage === 'prospect' && !p.profile);
    const cands = unpro.filter(p => p.userId && p.nickname).map(p => ({ id: p.id, userId: p.userId, nickname: p.nickname, source: p.source || {} }));
    if (cands.length && !window.__autoProfiling) {
      window.__autoProfiling = true;
      addLog(`⚡ 自动为 ${cands.length} 位未画像客户补全画像...`, 'info');
      chrome.runtime.sendMessage({ action: 'profileProspects', data: { candidates: cands } })
        .then(function (r) {
          window.__autoProfiling = false;
          if (r && r.ok) {
            addLog(`✅ 自动画像完成：${(r.applied || []).length} 人已补全`, 'success');
            if (container && container.style.display !== 'none') loadProspectList(container);
          } else {
            addLog('⚠️ 自动画像未完成：' + ((r && r.error) || '失败'), 'warn');
          }
        })
        .catch(function (e) { window.__autoProfiling = false; addLog('❌ 自动画像失败：' + e.message, 'error'); });
    }
  }
}

function renderProspectList(container) {
  container.innerHTML = '';
  const allList = _plData.list;
  let list;
  if (_plStage === 'all') {
    list = allList.slice();
  } else {
    list = allList.filter(p => _plGetStage(p) === _plStage); // v2：按层过滤
  }
  const total = list.length;
  const fullList = _plData.fullList || allList;

  // ── v2 层级导航：全部 / 商机池 / 线索池 / 客户池 ──
  const subNav = document.createElement('div');
  subNav.className = 'pl-subnav';
  const STAGES = [['all', '🗂 全部'], ['prospect', '🎯 商机池'], ['lead', '🎇 线索池']];
  STAGES.forEach(([v, label]) => {
    const on = !_plMsg && _plStage === v;
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:5px 12px;border-radius:8px;border:1px solid ' + (on ? '#7c3aed' : 'var(--line)') + ';background:' + (on ? '#f5f3ff' : '#fff') + ';color:' + (on ? '#7c3aed' : 'var(--ink)') + ';font-size:12px;font-weight:600;cursor:pointer;';
    b.addEventListener('click', () => { _plMsg = false; _plStage = v; _plPage = 0; renderProspectList(container); });
    subNav.appendChild(b);
  });
  // 消息台（/chat 会话一览，销售主战场）
  const mb = document.createElement('button');
  mb.textContent = '💬 消息';
  mb.style.cssText = 'padding:5px 12px;border-radius:8px;border:1px solid ' + (_plMsg ? '#7c3aed' : 'var(--line)') + ';background:' + (_plMsg ? '#f5f3ff' : '#fff') + ';color:' + (_plMsg ? '#7c3aed' : 'var(--ink)') + ';font-size:12px;font-weight:600;cursor:pointer;';
  mb.addEventListener('click', () => { _plMsg = true; _plPage = 0; renderProspectList(container); });
  subNav.appendChild(mb);
  container.appendChild(subNav);

  // 消息台视图（/chat 会话一览）
  if (_plMsg) { loadChatView(container); return; }

  // 统计条（pipeline 口径）
  const stats = document.createElement('div');
  stats.className = 'pl-stats';
  const plN = (pred) => fullList.filter(pred).length;
  const cards = [
    { label: '总人数', num: fullList.length },
    { label: '商机池', num: plN(p => _plGetStage(p) === 'prospect') },
    { label: '线索池', num: plN(p => _plGetStage(p) === 'lead') },
    { label: '待触达', num: plN(p => _plGetStage(p) === 'prospect' && _plFunnel(p).step === 'pending') },
  ];
  cards.forEach(c => {
    const d = document.createElement('div');
    d.className = 'pl-stat-card';
    d.innerHTML = `<div class="num">${c.num}</div><div class="label">${c.label}</div>`;
    stats.appendChild(d);
  });
  container.appendChild(stats);

  // 批量操作条（按层出ロ）
  const batch = document.createElement('div');
  batch.className = 'pl-batch';
  if (_plStage === 'prospect') {
    const unpro = list.filter(p => !p.profile);
    const bBtn = document.createElement('button');
    bBtn.textContent = `⚡ 批量画像（${unpro.length} 人待补）`;
    bBtn.style.cssText = 'font-size:11px;padding:5px 12px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:8px;cursor:pointer;font-weight:600;';
    bBtn.disabled = unpro.length === 0;
    bBtn.addEventListener('click', () => runProfileOne(unpro, container));
    batch.appendChild(bBtn);
    // 状态管理：用户可增删改商机状态列表
    const stBtn = document.createElement('button');
    stBtn.textContent = '⚙️ 管理状态';
    stBtn.style.cssText = 'font-size:11px;padding:5px 12px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;cursor:pointer;font-weight:600;';
    stBtn.addEventListener('click', editProspectStatus);
    batch.appendChild(stBtn);
    const tip = document.createElement('span');
    tip.textContent = '⋯ 商机池＝已接触：画像 → 私信 → 谈单 → 成交';
    tip.style.cssText = 'font-size:11px;color:#0f766e;';
    batch.appendChild(tip);
  } else if (_plStage === 'lead') {
    const tip = document.createElement('span');
    tip.textContent = '💡 线索池＝未接触：发个私信 / 手动升格，接触过即自动进商机池';
    tip.style.cssText = 'font-size:11px;color:#0f766e;';
    batch.appendChild(tip);
  }
  if (batch.childNodes.length) container.appendChild(batch);

  // 筛选行
  const filter = document.createElement('div');
  filter.className = 'pl-filter';
  filter.innerHTML = `
    <input id="plSearch" placeholder="🔍 昵称搜索" style="flex:1;min-width:80px;" value="${esc(_plFilter.keyword)}">
    <select id="plTag"><option value="">标签</option></select>
    <select id="plIntent">
      <option value="">意向</option>
      <option value="high">高</option>
      <option value="medium">中</option>
      <option value="low">低</option>
    </select>`;
  container.appendChild(filter);

  const tagSel = filter.querySelector('#plTag');
  _plData.allTags.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    tagSel.appendChild(opt);
  });
  tagSel.value = _plFilter.tag || '';
  filter.querySelector('#plIntent').value = _plFilter.intent || '';

  const applyFilter = () => {
    _plFilter.keyword = filter.querySelector('#plSearch').value.trim();
    _plFilter.tag = tagSel.value;
    _plFilter.intent = filter.querySelector('#plIntent').value;
    _plPage = 0;
    loadProspectList(container);
  };
  filter.querySelector('#plSearch').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
  tagSel.addEventListener('change', applyFilter);
  filter.querySelector('#plIntent').addEventListener('change', applyFilter);

  

  // 空态
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'pl-empty';
    empty.innerHTML = '🎯 清单为空。<br>在「获客助手」扫描笔记时，点击商机卡片的「➕ 入清单」，或用关键词收录命中评论。';
    container.appendChild(empty);
    return;
  }

  // 分页
  const pageCount = Math.max(1, Math.ceil(total / PL_PAGE_SIZE));
  _plPage = Math.min(_plPage, pageCount - 1);
  const pageList = list.slice(_plPage * PL_PAGE_SIZE, (_plPage + 1) * PL_PAGE_SIZE);

  // 卡片
  pageList.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pl-card';
    const s = _plGetStage(p);
    const pf = p.profile || {};
    const tagsHtml = (Array.isArray(pf.tags) && pf.tags.length ? pf.tags.map(esc).join(' · ') : '');
    const idHtml = p.userId ? `ID:${esc(p.userId)}` : '';
    const nickMeta = [tagsHtml && ('标签:' + tagsHtml), idHtml, p.keywordHit].filter(Boolean).join(' · ');
    // 意向/身份/需求/痛点/切入 各占一行（只显示有值的）
    const infoRows = [
      ['意向', _intentLabel(pf.intentLevel)], ['身份', pf.identity], ['需求', pf.needs], ['痛点', pf.painPoints], ['切入', pf.dmAngle],
    ].filter(x => x[1]).map(([k, v]) => `<div class="pl-id-line"><b>${k}</b> <span>${esc(v)}</span></div>`).join('');
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

    // 层内"状态/下一步"下拉（v2：一个下拉按层绑到对应子状态）
    let statusSel = '';
    if (s === 'prospect') {
      const stList = (_plData.statuses && _plData.statuses.length) ? _plData.statuses : PL_DEFAULT_STATUSES;
      statusSel = `<select class="pl-status" data-plid="${p.id}" data-kind="status" title="商机状态（你维护，可改状态列表）">${stList.map(st => `<option value="${esc(st)}" ${(p.status || stList[0]) === st ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select>`;
    }

    // 层内动作（按出ロ绑定）：商机=画像/私信/成交；线索=私信(接触即转商机)/手动升格
    let actions = '';
    if (s === 'prospect') {
      actions =
        (pf.intentLevel ? '' : `<button class="act" data-plid="${p.id}" data-action="profile">⚡ 画像</button>`) +
        `<button class="act send" data-plid="${p.id}" data-action="dm">✉️ 私信</button>` +
        `<button class="act sell" data-plid="${p.id}" data-action="close" title="成交（此处仅标注，成交一般走线下/微信）">✔️ 成交</button>`;
    } else {
      actions =
        `<button class="act send" data-plid="${p.id}" data-action="dm" title="发私信即视为接触→自动进商机池">✉️ 私信</button>` +
        `<button class="act sell" data-plid="${p.id}" data-action="promote" title="主动升格为商机（已接触）">⚡ 升格商机</button>`;
    }

    card.innerHTML = `
      <div class="pl-card-top">
        <span class="pl-nick">${esc(p.nickname || '未知用户')}</span>
        ${_plDot(pf.intentLevel)}
        ${_plStageBadge(p)}
        ${_plEntryBadge(p)}
        ${nickMeta ? `<span class="pl-nickmeta">${nickMeta}</span>` : ''}
      </div>
      <div class="pl-hint">${_plNextHint(p)}</div>

      ${infoRows ? `<div class="pl-idinfo">${infoRows}</div>` : ''}
      ${srcComment ? `<div class="pl-source">📝 评论：${esc(srcComment)}</div>` : ''}
      ${srcNote ? `<div class="pl-source">📕 来源：${esc(srcNote)}</div>` : ''}
      ${chatHistoryHtml}

      ${(s === 'prospect' && pf.intentLevel) ? `<textarea class="pl-reply-text" data-plid="${p.id}" placeholder="回复建议（自动生成，可修改）...">${esc((p.replySuggest || '').trim())}</textarea>` : ''}

      <div class="pl-foot">
        <span class="pl-foot-left">
          ${statusSel}
          ${actions}
        </span>
        <span class="pl-foot-right">
          ${(s === 'prospect' && pf.intentLevel) ? `<button class="copy-inline pl-copy" data-plid="${p.id}" title="复制回复内容">📋 复制</button>` : ''}
          <button class="pl-home" data-plid="${p.id}" data-action="locate" title="打开该用户主页">📎 主页</button>
          <button class="remove" data-plid="${p.id}" data-action="remove" title="从清单移除">🗑️</button>
        </span>
      </div>`;
    container.appendChild(card);
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
        await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates } });
        addLog(`✅ ${person.nickname} 商机状态 → ${v}`, 'success');
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
      else if (action === 'remove') {
        if (!window.confirm('确认将该候选人从清单移除？')) return;
        await chrome.runtime.sendMessage({ action: 'deleteProspect', data: { id } });
        addLog(`🗑️ 已移除：${person.nickname}`, 'info');
        loadProspectList(container); return;
      }
      else if (action === 'profile') { runProfileOne([person], container); return; }
      else if (action === 'dm') {
        // 只要联系（点开私信开始触达）→ 线索自动升商机
        if (_plGetStage(person) === 'lead') {
          chrome.runtime.sendMessage({ action: 'markContacted', data: { id: person.id } }).catch(() => {});
        }
        openDmModal(person); return;
      }
      else if (action === 'close') {
        // 成交在商机状态上作标注（不单独建客户层）
        await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { status: '已成交', funnel: Object.assign({}, _plFunnel(person), { step: 'closed' }) } } });
        addLog(`💰 ${person.nickname} 已成交标注（成交一般走线下/微信）`, 'success');
        loadProspectList(container); return;
      }
      else if (action === 'promote') {
        if (!window.confirm(`确认将线索 ${person.nickname} 升格为商机（已接触）？`)) return;
        await chrome.runtime.sendMessage({ action: 'updateProspect', data: { id, updates: { stage: 'prospect', funnel: { step: 'pending', dmCount: 0, lastDmAt: null } } } });
        addLog(`➡️ ${person.nickname} 已升格为商机`, 'success');
        loadProspectList(container); return;
      }
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

  }

// ═══════════ 消息台：/chat 会话一览（销售主战场：和客户聊+成交） ═══════════
const _stageLabel = (s) => s === 'prospect' ? '🎯商机' : (s === 'lead' ? '🎇线索' : '');
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
  const resp = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person } });
  if (resp && resp.ok && resp.dmText) return resp.dmText;
  throw new Error((resp && resp.error) || 'AI 未返回草拟');
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
  document.getElementById('pfIntent').value = pf.intentLevel || 'medium';
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
  document.getElementById('dmText').value = '';
  document.getElementById('dmResult').textContent = '';
  const dmT = document.getElementById('dmTiming'); if (dmT) dmT.textContent = '';
  const dmTB = document.getElementById('dmTimingBtn'); if (dmTB) { dmTB.disabled = false; dmTB.textContent = '🎯 判断销售时机'; }
  document.getElementById('dmGenBtn').disabled = false;
  document.getElementById('dmSendBtn').disabled = false;
  mask.classList.add('open');
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
    dmGenBtn?.addEventListener('click', async () => {
      const person = getPlPerson(dmMask.dataset.plid);
      if (!person) return;
      dmGenBtn.disabled = true;
      dmGenBtn.textContent = '🤖 AI 生成中...';
      dmResult.textContent = '';
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'generateDm', data: { person } });
        if (resp && resp.ok) {
          dmText.value = resp.dmText || '';
          dmResult.textContent = '✅ AI 话术已生成，请预览并修改后发送';
          dmResult.className = 'pl-result ok';
        } else {
          dmResult.textContent = (resp && resp.error) || '生成失败';
          dmResult.className = 'pl-result fail';
        }
      } catch (e) {
        dmResult.textContent = e.message;
        dmResult.className = 'pl-result fail';
      }
      dmGenBtn.disabled = false;
      dmGenBtn.textContent = '🤖 AI 生成话术';
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
        intentLevel: document.getElementById('pfIntent').value,
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
function closeDmModal() { document.getElementById('dmModal')?.classList.remove('open'); }
function closeProfileModal() { document.getElementById('profileModal')?.classList.remove('open'); }
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
  // 4) 批量发送（自动评论）——试用版灰显锁定
  if (!ed.features || !ed.features.batchSend) {
    const btn = document.getElementById('batchSendBtn');
    if (btn) {
      btn.disabled = true;
      btn.dataset.locked = '1';
      btn.textContent = '🔒 自动评论（企业版）';
      btn.style.opacity = '0.45';
      btn.style.cursor = 'not-allowed';
      btn.style.filter = 'grayscale(1)';
      btn.title = '当前版本（' + (ed.label || '') + '）不含整页批量发送，仅支持逐条一键发送；升级企业版解锁';
    }
  }
  // 4) 租户切换器——非租户版灰显锁定
  if (!ed.features || !ed.features.tenant) {
    const sel = document.getElementById('tenantSwitcher');
    if (sel) {
      sel.disabled = true;
      sel.dataset.locked = '1';
      sel.innerHTML = '<option>🔒 多租户（企业版·多租户）</option>';
      sel.style.opacity = '0.5';
      sel.style.cursor = 'not-allowed';
      sel.title = '当前版本（' + (ed.label || '') + '）不含多产品/多租户切换，升级「企业版·多租户」解锁';
      const label = sel.previousElementSibling;
      if (label) { label.style.opacity = '0.5'; }
    }
  }
  // 5) 一键灌水笔记列表（左侧面板依赖灌水功能）——非企业版直接隐藏整个笔记列表，右侧评论助手占满窗口自适应
  if (!ed.features || !ed.features.autoWater) {
    const panelLeft = document.getElementById('panelLeft');
    const divider = document.getElementById('divider');
    if (panelLeft) panelLeft.style.display = 'none';
    if (divider) divider.style.display = 'none';
  }
  // 6) 获客清单——非开通版本隐藏 tab 按钮
  if (!ed.features || !ed.features.prospectList) {
    document.getElementById('tabProspectList')?.remove();
  }
  // 7) 发笔记——依赖知识库，非开通版本隐藏 tab 按钮
  if (!ed.features || !ed.features.knowledge) {
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
  // 中间刻意加入随机停顿，尽量像真人操作，避免被风控识别。
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

    // 1) 返回上一页（模拟真人先退出），停顿时长读设置页「停留时间」配置（技术下限 300ms）
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
  const batchBtn = document.getElementById('batchSendBtn');
  const botBtn = document.getElementById('botToggleBtn');
  if (batchBtn) { batchBtn.disabled = true; batchBtn.style.opacity = '0.5'; }
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
  if (batchBtn) { batchBtn.disabled = false; batchBtn.style.opacity = '1'; }
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
// ★ 是否正在“自动批量发送”（自动譄评）：决定发送时要不要模仿真人拖延。
//   true=批量/自动（慢慢骗反爬）；false=手动逐条一键发送（快速，不磨蹭）
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
  // 版本闸门：试用版不含整页批量发送（按钮已灰显，这里双保险）
  if (!editionFeatureOn('batchSend')) {
    addLog('🔒 当前版本不支持整页批量发送，请逐条使用「一键发送」；升级企业版可解锁', 'warn');
    return;
  }
  const batchBtn = document.getElementById('batchSendBtn');
  const sendBtns = Array.from(document.querySelectorAll('.send-btn:not(.watered)'));

  if (sendBtns.length === 0) {
    addLog('⚠️ 没有待发送的评论（已全部灌水或无商机）', 'warn');
    return;
  }

  addLog(`📤 开始批量发送，共 ${sendBtns.length} 条评论`, 'info');
  // ★ 标记“自动批量发送中”：只有自动发送才模仿真人（浏览滞留 + 逐字打字）骗反爬；
  //   手动逐条点“一键发送”不需要这些，走快速通道
  _batchSending = true;
  if (batchBtn) {
    batchBtn.disabled = true;
    batchBtn.textContent = '⏳ 发送中...';
  }

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

    // ★ 批量条间防反爬间隔：随机 3~8 秒（用户要求；手动逐条发送不加此间隔）
    if (i < sendBtns.length - 1) {
      const gap = 3000 + Math.floor(Math.random() * 5000);
      addLog(`⏸ 防反爬间隔：停 ${(gap / 1000).toFixed(1)}s 再发下一条...`, 'info');
      await sleep(gap);
    }
  }

  addLog(`🏁 批量发送完成：成功 ${successCount} 条，失败 ${failCount} 条`, successCount > 0 ? 'success' : 'warn');

  _batchSending = false; // ★ 批量结束，恢复手动快速通道
  if (batchBtn) {
    batchBtn.disabled = false;
    batchBtn.textContent = '📤 自动评论';
  }
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
  batchBtn.title = '串行回复所有待回复会话：AI 生成 → 自动发送 → 3~8 秒间隔防反爬';
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

// 全部串行回复（AI 生成 → 发送 → 3~8 秒防反爬间隔）
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
      // 条间防反爬间隔：随机 3~8 秒（最后一条不用等）
      if (i < convs.length - 1) {
        const gap = 3000 + Math.floor(Math.random() * 5000);
        addLog(`⏸ 防反爬间隔：停 ${(gap / 1000).toFixed(1)}s 再回复下一位...`, 'info');
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
// skipScreen=true：绕过评论量门槛，把不足 10 条的评论也强塞给 AI（空态里“仍要 AI 全量分析”按钮用）
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

    // ★ 评论量门槛：刚起量/没流量的文章评论不足，没有挖掘价值 → 直接退出，不劳烦 AI。
    //   评论 ≥10 条才值得挖（skipScreen=true 时绕过，强制全量分析）
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

    // 通过 background.js 请求商机挖掘（skipAiScreen：“仍要 AI 全量分析”按钮同时绕过本地预筛和 AI 快筛）
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
        addLog('🤖 手动要求：绕过快筛，全量交给 AI 分析', 'warn');
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

    // ========== 用 DOM API 重新渲染（绕过 innerHTML 潜在的兼容问题） ==========
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
        tabsHtml += `<button class="version-tab${active}" data-prospect="${i}" data-ver="${vi}" style="flex:1;padding:4px 6px;border-radius:4px;border:1px solid #374151;background:${vi === bestIdx ? '#2563eb' : '#1f2937'};color:${vi === bestIdx ? '#fff' : '#9ca3af'};font-size:11px;cursor:pointer;">${label}</button>`;
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
            <button class="addlist-btn" data-prospect="${i}" data-idx="${idx}" data-author="${esc(author)}" data-original="${esc(content)}" data-userlink="${esc(userLink)}" style="font-size:11px;padding:3px 8px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:4px;cursor:pointer;">➕ 入清单</button>
          </div>
          <div id="sendResult_${i}" class="send-result"></div>
        </div>`;
      container.appendChild(card);
    });

    // ── AI 筛选入库（不再靠关键词：AI 从评论里筛出值得收进清单跟进的人，可一键全入库） ──
    try {
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
          card.querySelectorAll('.version-tab').forEach(t => {
            t.style.background = '#1f2937';
            t.style.color = '#9ca3af';
          });
          tab.style.background = '#2563eb';
          tab.style.color = '#fff';
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
            humanize: _batchSending, // ★ 只有自动批量发送才模仿真人；手动一键发送走快速通道
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
          stage: 'prospect',       // ★ 主动联系的商机：直接从商机池开始，不从线索转
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
  '在这个领域/产品上你有过哪些真实的经历？做了多久、帮过多少人、或亲自踩过哪些坑。',
  '你最拿手、最想让别人知道的干货或专业积累是什么？',
  '你的小红书账号定位是什么？主要分享什么、写给谁看？',
  '你希望评论区互动时的"人设感"是哪种（专业靠谱 / 接地气过来人 / 随性朋友…）？有没有特别的口吻或语气？',
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
  ['likes', '👍 互动涨赞（养号/数据）'],
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
async function _diagGetCfg() { const r = await chrome.storage.local.get('config'); return (r && r.config) || {}; }
async function _diagSaveCfg(cfg) { await chrome.storage.local.set({ config: cfg }); }
function _diagCard(innerHtml) { return '<div style="border:1px solid #e7eaf0;border-radius:12px;padding:14px 16px;background:#fff;box-shadow:0 1px 3px rgba(24,24,40,.05);">' + innerHtml + '</div>'; }
function _diagLabel(txt) { return '<div style="font-size:12px;color:#333;margin-bottom:4px;">' + txt + '</div>'; }
function _diagStepTitle(no, txt) {
  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
    '<span style="min-width:26px;width:26px;height:26px;border-radius:8px;background:#c41d3c;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;">' + no + '</span>' +
    '<span style="font-weight:700;font-size:15px;color:#1f1f1f;">' + txt + '</span></div>';
}
function renderDiagnosis(container) {
  _diagState = { profile: null, persona: '', kbCount: 0, accountType: '', notePlan: null, report: null, busy: '' };
  _diagStep = 1;
container.innerHTML = [
    '<div style="padding:14px 16px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#ffffff,#fff7fa);">',
    '  <div style="font-weight:700;font-size:15px;color:var(--ink);">🧭 账号诊断 · 6 步工作流</div>',
    '  <div style="font-size:11px;color:#888;margin-top:4px;line-height:1.7;">抓主页 → 人设/风格 → 产品卖点 → 知识库 → 内容规划&封面 → 深度报告。设置项在这里填，自动写回「设置」；最后汇总成整改方案。</div>',
    '</div>',
    '<div id="diagBody" style="padding:14px;font-size:13px;color:#333;"></div>',
  ].join('');
  diagGo(1);
}
function diagGo(n) {
  _diagStep = n;
  const b = document.getElementById('diagBody'); if (!b) return;
  const items = [[1, '①', '账号资料'], [2, '②', '人设/风格'], [3, '③', '产品卖点'], [4, '④', '知识库'], [5, '⑤', '规划/封面'], [6, '⑥', '深度报告']];
  b.innerHTML = '<div style="display:flex;gap:2px;align-items:flex-start;margin-bottom:14px;">' + items.map(function (it, ix) {
    const t = it[0];
    const done = t < n, cur = t === n;
    let circ = 'width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin:0 auto;';
    if (cur) circ += 'background:#c41d3c;color:#fff;box-shadow:0 0 0 3px rgba(196,29,60,.16);';
    else if (done) circ += 'background:#0a7b5a;color:#fff;';
    else circ += 'background:#eef0f4;color:#b6bac6;';
    const label = 'font-size:10px;text-align:center;margin-top:4px;white-space:nowrap;' + (cur ? 'color:#c41d3c;font-weight:700;' : (done ? 'color:#0a7b5a;' : 'color:#9aa0ad;'));
    return '<div data-go="' + t + '" style="flex:1;cursor:pointer;' + (ix < items.length - 1 ? 'background:linear-gradient(90deg,transparent 0,transparent 100%);' : '') + '">' +
      '<div style="' + circ + '">' + (done ? '✓' : it[1]) + '</div>' +
      '<div style="' + label + '">' + it[2] + '</div>' +
      '</div>';
  }).join('') + '</div><div id="diagStepBody"></div>';
  b.querySelectorAll('[data-go]').forEach(function (el) { el.onclick = function () { diagGo(parseInt(el.getAttribute('data-go'), 10)); }; });
  const body = document.getElementById('diagStepBody');
  if (n === 1) diagStep1(body);
  else if (n === 2) diagStep2(body);
  else if (n === 3) diagStep3(body);
  else if (n === 4) diagStep4(body);
  else if (n === 5) diagStep5(body);
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
  ) + '<div style="margin-top:10px;color:#999;font-size:12px;">②~⑥ 在工作流后面，抓完主页再继续。</div>';
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
  '<div style="margin-top:14px;">' + _dBtn('diagNextBtn', '下一步：② 人设/风格', '', 'btn-primary') + _dBtn('diagRefetchBtn', '重新抓取', '', 'btn-outline') + '</div>';
  document.getElementById('diagNextBtn')?.addEventListener('click', function () { diagGo(2); });
  document.getElementById('diagRefetchBtn')?.addEventListener('click', function () { _diagState.profile = null; diagGo(1); });
}

/* ── ② 人设评定 + 话术风格 ── */
function diagStep2(body) {
  if (!body) return;
  if (!_diagState.profile) { _diagNeedProfile(body); return; }
  body.innerHTML =
    _diagCard(
      _diagStepTitle('②', '人设评定 · 立住"你是谁"') +
      '<div style="font-size:12px;color:#888;margin:4px 0;">下面 5 大问帮你把账号人设立住；答得越具体，AI 整理出的人设越像你本人。</div>' +
      '<div id="diagPStatus" style="font-size:12px;color:#666;margin:6px 0;"></div>' +
      '<div style="font-size:12px;color:#888;margin:6px 0 4px;">账号简介（已带入，可改）：</div>' +
      '<textarea id="diagP_Bio" rows="2" style="width:100%;box-sizing:border-box;">' + _dEsc(_diagState.profile.desc || '') + '</textarea>' +
      '<div id="diagP_Qs"></div>' + _dBtn('diagPBuild', '✨ 用 AI 整理成人设并保存') + '<span id="diagPMsg" style="font-size:12px;color:#0a7b5a;"></span>'
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
    '<div style="margin-top:12px;">' + _dBtn('diagStep3Btn', '下一步：③ 产品卖点', '', 'btn-primary') + _dBtn('diagSkipBtn', '跳过人设', '', 'btn-outline') + '</div>';
  document.getElementById('diagP_Qs').innerHTML = DIAG_PERSONA_QUESTIONS.map(function (q, i) {
    return '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + _dEsc(q) + '</div>' +
      '<textarea class="diagP_Q" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="你的回答…"></textarea></div>';
  }).join('');
document.getElementById('diagPBuild')?.addEventListener('click', diagPersonaBuild);
  document.getElementById('diagPEditSave')?.addEventListener('click', diagPersonaEditSave);
  document.getElementById('diagStyleSave')?.addEventListener('click', diagStyleSave);
  document.getElementById('diagStep3Btn')?.addEventListener('click', function () { diagGo(3); });
  document.getElementById('diagSkipBtn')?.addEventListener('click', function () { diagGo(3); });
  diagPersonaStatus();
  diagStylePrefill();
}
async function diagPersonaStatus() {
  const st = document.getElementById('diagPStatus'); const edit = document.getElementById('diagPEdit');
  try {
    const r = await _diagSay('getPersona'); const p = (r && r.persona) || null;
    if (!p || !p.text) { if (st) st.textContent = '⚠️ 还没有人设。答下面 5 问点生成即可。'; return; }
    _diagState.persona = p.text;
    if (st) st.innerHTML = '✅ 已有保存的人设（' + (p.updatedAt ? new Date(p.updatedAt).toLocaleString('zh-CN') : '') + '）';
    if (edit && !edit.dataset.touched) edit.value = p.text;
  } catch (_) {}
}
async function diagPersonaBuild() {
  const btn = document.getElementById('diagPBuild'); const msg = document.getElementById('diagPMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 生成中…'; if (msg) msg.textContent = '';
  try {
    const bio = (document.getElementById('diagP_Bio') || {}).value ? document.getElementById('diagP_Bio').value.trim() : '';
    const answers = Array.from((document.querySelectorAll('.diagP_Q') || [])).map(function (el) { return { answer: el.value }; });
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
    _diagStepTitle('③', '产品与卖点') +
    '<div style="font-size:12px;color:#888;margin:4px 0 8px;">你的产品/服务是什么、卖点有哪些、怎么引导用户找到你。写回「设置→产品配置」。</div>' +
    _diagLabel('产品名称') + '<input id="diagProdName" type="text" placeholder="例：贷款计算器小程序" style="width:100%;box-sizing:border-box;margin-bottom:10px;">' +
    '<div style="border-top:1px solid #eee;padding-top:10px;">' +
      '<div style="font-weight:700;font-size:13px;color:#333;">卖点</div>' +
      '<div style="font-size:12px;color:#888;margin:4px 0;">答下面几问让 AI 提炼，或直接手动加。</div>' +
      '<div id="diagSell_Qs"></div>' +
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
  ) + '<div style="margin-top:12px;">' + _dBtn('diagStep4Btn', '下一步：④ 知识库', '', 'btn-primary') + '</div>';
  document.getElementById('diagSell_Qs').innerHTML = DIAG_SELL_QUESTIONS.map(function (q, i) {
    return '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + _dEsc(q) + '</div>' +
      '<textarea class="diagSellQ" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="你的回答…"></textarea></div>';
  }).join('');
  document.querySelectorAll('.diagGuideChip').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.diagGuideChip').forEach(function (x) { x.style.background = '#f6f7f9'; x.style.color = '#555'; x.style.borderColor = '#dfe3ea'; });
      b.style.background = '#c41d3c'; b.style.color = '#fff'; b.style.borderColor = '#c41d3c';
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
  document.getElementById('diagStep4Btn')?.addEventListener('click', function () { diagGo(4); });
  diagProdPrefill();
}
var _diagGuide = '';
async function diagSellAiBuild() {
  const btn = document.getElementById('diagSellAi'); const msg = document.getElementById('diagSellAiMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 提炼中…'; if (msg) msg.textContent = '';
  try {
    const answers = Array.from((document.querySelectorAll('.diagSellQ') || [])).map(function (el) { return { answer: el.value }; });
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
    if (p.guideText) { _diagGuide = p.guideText; document.querySelectorAll('.diagGuideChip').forEach(function (b) { if (b.getAttribute('data-v') === p.guideText) { b.style.background = '#c41d3c'; b.style.color = '#fff'; b.style.borderColor = '#c41d3c'; } }); }
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
    _diagCard(_diagStepTitle('④', '知识库 · 让回复有干货') +
'<div style="font-size:12px;color:#888;margin:4px 0;">三种方式：答 5 问让 AI 生成；或粘贴/上传文件导入已有知识。写回「设置→知识库」。</div>' +
      '<div style="font-size:12px;color:#333;margin:6px 0 4px;">方式一 · 答 5 问生成：</div>' +
      '<div id="diagK_Qs"></div>' + _dBtn('diagKBuild', '✨ 用 AI 生成知识库') + '<span id="diagKMsg" style="font-size:12px;color:#0a7b5a;"></span>' +
      '<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px;"><div style="font-size:12px;color:#333;margin-bottom:4px;">方式二 · 导入已有知识：</div>' +
      '<textarea id="diagKImp" rows="4" placeholder="每行一条：标题：内容&#10;或直接粘一段 JSON 数组：[{\"title\":\"..\",\"content\":\"..\"}]" style="width:100%;box-sizing:border-box;margin-bottom:6px;"></textarea>' +
      _dBtn('diagKImport', '📥 导入知识库') + '<span id="diagKIMsg" style="font-size:12px;color:#0a7b5a;"></span><br>' +
      _dBtn('diagKFileBtn', '📁 导入文件') + '<input type="file" id="diagKFile" accept=".json,.txt,application/json,text/plain" style="display:none;">' +
      '<span id="diagKFMsg" style="font-size:12px;color:#999;"></span></div>') +
    '<div style="margin-top:12px;">' + _dBtn('diagStep5Btn', '下一步：⑤ 内容规划 & 封面', '', 'btn-primary') + _dBtn('diagSkipBtn', '跳过知识库', '', 'btn-outline') + '</div>';
  document.getElementById('diagK_Qs').innerHTML = DIAG_KB_QUESTIONS.map(function (q, i) {
    return '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + _dEsc(q) + '</div>' +
      '<textarea class="diagK_Q" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="你的回答…"></textarea></div>';
  }).join('');
document.getElementById('diagKBuild')?.addEventListener('click', diagKbBuild);
  document.getElementById('diagKImport')?.addEventListener('click', diagKbImport);
  document.getElementById('diagKFileBtn')?.addEventListener('click', function () { const f = document.getElementById('diagKFile'); if (f) f.click(); });
  document.getElementById('diagKFile')?.addEventListener('change', diagKbImportFile);
  document.getElementById('diagStep5Btn')?.addEventListener('click', function () { diagGo(5); });
  document.getElementById('diagSkipBtn')?.addEventListener('click', function () { diagGo(5); });
}
async function diagKbBuild() {
  const btn = document.getElementById('diagKBuild'); const msg = document.getElementById('diagKMsg');
  if (!btn) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '⏳ 生成中…'; if (msg) msg.textContent = '';
  try {
    const answers = Array.from((document.querySelectorAll('.diagK_Q') || [])).map(function (el) { return { answer: el.value }; });
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
    _diagCard(_diagStepTitle('⑤', '内容规划 & 封面') +
      '<div style="font-size:12px;color:#888;margin:4px 0;">先选账号类型、答 4 问，AI 出笔记规划；再补封面设置。</div>' +
      _diagLabel('你的账号属于哪种？（选一个或自填）') + '<div id="diagPlanType" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' + DIAG_ACCOUNT_TYPES.map(function (ty) { return '<button type="button" class="planTypeChip" data-v="' + _dEsc(ty) + '" style="font-size:12px;padding:5px 10px;border:1px solid #dfe3ea;border-radius:14px;background:#f6f7f9;color:#555;cursor:pointer;">' + _dEsc(ty) + '</button>'; }).join('') + '</div>' +
      '<input id="diagPlanTypeCustom" type="text" placeholder="其他，自己输入…" style="width:100%;box-sizing:border-box;margin-bottom:10px;">' +
      '<div id="diagPlan_Qs"></div>' + _dBtn('diagPlanBuild', '✨ 生成笔记内容规划') + '<span id="diagPlanMsg" style="font-size:12px;color:#0a7b5a;"></span>') +
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
    '<div style="margin-top:12px;">' + _dBtn('diagStep6Btn', '下一步：⑥ 深度报告', '', 'btn-primary') + '</div>';
  document.getElementById('diagPlanTypeCustom').value = '';
  document.querySelectorAll('.planTypeChip').forEach(function (b) { b.onclick = function () { document.querySelectorAll('.planTypeChip').forEach(function (x) { x.style.background = '#f6f7f9'; x.style.color = '#555'; x.style.borderColor = '#dfe3ea'; }); b.style.background = '#c41d3c'; b.style.color = '#fff'; b.style.borderColor = '#c41d3c'; _diagState.accountType = b.getAttribute('data-v'); }; });
  document.getElementById('diagPlanTypeCustom')?.addEventListener('input', function (e) { if (e.target.value.trim()) { _diagState.accountType = e.target.value.trim(); document.querySelectorAll('.planTypeChip').forEach(function (x) { x.style.background = '#f6f7f9'; x.style.color = '#555'; x.style.borderColor = '#dfe3ea'; }); } });
  document.getElementById('diagPlan_Qs').innerHTML = DIAG_PLAN_QUESTIONS.map(function (q, i) { return '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#333;margin-bottom:2px;">Q' + (i + 1) + '. ' + _dEsc(q) + '</div><textarea class="diagPlan_Q" data-i="' + i + '" rows="2" style="width:100%;box-sizing:border-box;" placeholder="你的回答…"></textarea></div>'; }).join('');
document.getElementById('diagPlanBuild')?.addEventListener('click', diagPlanBuild);
  document.getElementById('diagCoverSave')?.addEventListener('click', diagCoverSave);
  document.getElementById('diagCoverImgBtn')?.addEventListener('click', function () { const f = document.getElementById('diagCoverFile'); if (f) f.click(); });
  document.getElementById('diagCoverFile')?.addEventListener('change', diagCoverImgPick);
  document.getElementById('diagCoverImgClear')?.addEventListener('click', function () { _diagCoverImg = ''; var p = document.getElementById('diagCoverPreview'); if (p) p.style.display = 'none'; });
  document.getElementById('diagStep6Btn')?.addEventListener('click', function () { diagGo(6); });
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
    const answers = Array.from((document.querySelectorAll('.diagPlan_Q') || [])).map(function (el, i) { return { q: DIAG_PLAN_QUESTIONS[i] || '', answer: el.value }; });
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
  body.innerHTML = _diagCard(_diagStepTitle('⑥', '深度评估报告') +
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