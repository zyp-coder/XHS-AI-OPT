// ============================================================
// 小红书评论助手 — Popup v6（独立插件版，无需后台服务）
// 功能：提取评论 → AI挖掘潜在客户 → 生成话术 → 发送回复
// ============================================================
'use strict';

// ========== 独立窗口模式：从 URL 获取目标标签页 ID ==========
const urlParams = new URLSearchParams(window.location.search);
const TARGET_TAB_ID = parseInt(urlParams.get('tabId')) || null;

/** 获取要操作的小红书标签页（优先用窗口传入的 tabId，后备查询 activeTab） */
async function getTargetTab() {
  if (TARGET_TAB_ID) {
    try {
      const tab = await chrome.tabs.get(TARGET_TAB_ID);
      if (tab && tab.url && tab.url.includes('xiaohongshu.com')) return tab;
    } catch (_) {}
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let pageData = null;

// ========== 本地回复记录管理（chrome.storage.local） ==========
const REPLIED_KEY = 'replied_comments';

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
  document.getElementById('adminBtn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  try {
    await startup();
  } catch (e) {
    console.error('startup error:', e);
    const msg = e.message || String(e);
    const mc = document.getElementById('mainContent');
    if (mc) {
      while (mc.firstChild) mc.removeChild(mc.firstChild);
      const errDiv = document.createElement('div');
      errDiv.className = 'empty-state';
      errDiv.innerHTML = `<div class="emoji">❌</div><p style="color:#c62828;">${esc(msg)}</p>
        <button id="retryBtn" class="retry-btn">🔄 重试</button>`;
      mc.appendChild(errDiv);
    }
    document.getElementById('retryBtn')?.addEventListener('click', refreshData);
    setStatus('❌ ' + msg, 'error');
  }
});

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
  let result = null;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await sleep(400);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    } catch (e2) {}
  }

  if (!result || !result.comments || result.comments.length === 0) {
    setStatus('⚠️ 未找到评论，请确认在笔记页面', 'error');
    showEmpty('未找到评论，请确认在<b>笔记详情页</b>（不是首页或搜索页）');
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

  // 自动开始商机挖掘
  setStatus('<span class="loading-spinner"></span> AI 正在扫描评论，挖掘潜在客户...', '');
  await loadProspecting(document.getElementById('mainContent'));
}

// ========== 刷新 ==========
async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  btn.textContent = '⏳';
  btn.disabled = true;
  btn.style.opacity = '0.5';
  pageData = null;
  hideEmpty();
  document.getElementById('noteInfo').style.display = 'none';
  await startup();
  btn.textContent = '🔄';
  btn.disabled = false;
  btn.style.opacity = '1';
}

// ========== 商机挖掘 ==========
async function loadProspecting(container) {
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
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await loadProspecting(container);
      });
      setStatus('✅ 所有评论已回复', 'success');
      return;
    }

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

    // 通过 background.js 请求商机挖掘
    const requestData = { ...pageData, comments: filteredComments };
    const bgResp = await chrome.runtime.sendMessage({ action: 'findProspects', data: requestData });
    if (!bgResp?.ok) throw new Error(bgResp?.error || '商机挖掘失败');
    const result = bgResp;

    const prospects = result.prospects || [];
    const summary = result.summary || '';
    const commentCount = pageData?.comments?.length || 0;
    const VERSION_LABELS = ['A', 'B', 'C'];
    const VERSION_NAMES = ['朋友分享型', '数据分析型', '荒诞吸睛型'];

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
    // 与渲染并行执行，不阻塞 UI。点赞本身无成本，目的是让作者看到你的 ID
    (async () => {
      try {
        const tab = await getTargetTab();
        if (!tab) return;
        for (const p of prospects) {
          const idx = p._origIdx !== undefined && p._origIdx >= 0
            ? p._origIdx
            : (originalIdxMap[p.index] !== undefined ? originalIdxMap[p.index] : p.index);
          const author = p.author || '';
          const actualComment = (pageData.comments && pageData.comments[idx] && pageData.comments[idx].content) || '';
          const originalText = actualComment || p.original_comment || '';
          const userLink = (pageData.comments && pageData.comments[idx] && pageData.comments[idx].userLink) || '';
          if (!author || !originalText) continue;
          // 间隔 500~1000ms，避免触发风控
          await sleep(500 + Math.random() * 500);
          try {
            const r = await chrome.tabs.sendMessage(tab.id, {
              action: 'likeComment', author, originalText, commentIdx: idx, userLink,
            });
            if (r?.success) {
              likedComments.push({
                author,
                textSnippet: originalText.slice(0, 60),
                time: Date.now(),
              });
              renderLikedList();
              console.log(`[自动点赞] ${author}: ${r.alreadyLiked ? '已点过' : '已点赞'}`);
            }
          } catch (_) {}
        }
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
        <div style="font-size:12px;color:#555;line-height:1.6;max-width:400px;margin:0 auto;">${esc(summary || '没有用户表现出对房贷计算的明确需求，试试在其他笔记页面使用。')}</div>
        <button id="retryProspectBtn" class="retry-btn">🔄 重新扫描</button>
        <div style="margin-top:6px;font-size:11px;color:#aaa;">💡 建议：找与房贷、利率、买房相关的笔记</div>`;
      container.appendChild(emptyDiv);
      document.getElementById('retryProspectBtn')?.addEventListener('click', async () => {
        setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
        await loadProspecting(container);
      });
      setStatus('🎯 扫描完成 · 未发现潜在客户', 'success');
      return;
    }

    setStatus(`🎯 发现 ${prospects.length} 个潜在客户`, 'success');

    // 摘要
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'prospect-summary';
    summaryDiv.textContent = summary;
    container.appendChild(summaryDiv);

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
      // 清洗 AI 可能在内容里附带的版本前缀（"版本A：" / "A：" / "（版本A正文，...）"等）
      const copies = (p.suggested_copies && p.suggested_copies.length > 0
        ? p.suggested_copies
        : (p.suggested_copy ? [p.suggested_copy] : [''])
      ).map(c => stripVersionPrefix(String(c || '')));
      const versionLabels = VERSION_LABELS;
      const versionNames = VERSION_NAMES;

      const card = document.createElement('div');
      card.className = 'card prospect-card';
      card.dataset.currentVersion = '0';

      // 构建版本切换按钮（纯文字，不带【】标记）
      let tabsHtml = '<div class="version-tabs" style="display:flex;gap:4px;margin-bottom:6px;">';
      copies.forEach((_, vi) => {
        const active = vi === 0 ? ' active' : '';
        const vName = versionNames[vi] || '';
        const label = '版本' + versionLabels[vi] + (vName ? ' · ' + vName : '');
        tabsHtml += `<button class="version-tab${active}" data-prospect="${i}" data-ver="${vi}" style="flex:1;padding:4px 6px;border-radius:4px;border:1px solid #374151;background:${vi === 0 ? '#2563eb' : '#1f2937'};color:${vi === 0 ? '#fff' : '#9ca3af'};font-size:11px;cursor:pointer;">${label}</button>`;
      });
      tabsHtml += '</div>';

      const defaultCopy = (copies[0] || '') ? esc(copies[0]) : '';
      const defaultRaw = copies[0] || '';

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
        <div class="prospect-quote">“${esc(content)}”</div>
        <div class="prospect-reason">💡 ${esc(p.interest_reason || '')}</div>
        <div class="prospect-reply-box">
          <div class="prospect-reply-label">✍️ 回复话术（可编辑 · 点击版本切换）</div>
          ${tabsHtml}
          <div class="reply-box">
            <textarea id="replyText_${i}" rows="5">${defaultCopy}</textarea>
          </div>
          <div class="reply-actions">
            <button class="copy-btn" data-prospect="${i}" data-raw="${esc(defaultRaw)}">复制</button>
            <button class="send-btn" data-prospect="${i}" data-idx="${idx}" data-author="${esc(author)}" data-original="${esc(content)}" data-userlink="${esc(userLink)}">
              📤 一键发送
            </button>
          </div>
          <div id="sendResult_${i}" class="send-result"></div>
        </div>`;
      container.appendChild(card);
    });

    // 重新扫描按钮
    const rescanDiv = document.createElement('div');
    rescanDiv.style.cssText = 'margin-top:8px;';
    rescanDiv.innerHTML = '<button id="rescanBtn" class="retry-btn">🔄 重新扫描</button>';
    container.appendChild(rescanDiv);

    // 绑定事件
    document.getElementById('rescanBtn')?.addEventListener('click', async () => {
      setStatus('<span class="loading-spinner"></span> 重新扫描中...', '');
      await loadProspecting(container);
    });

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
        const copies = p.suggested_copies && p.suggested_copies.length > 0
          ? p.suggested_copies
          : (p.suggested_copy ? [p.suggested_copy] : ['']);
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
          showSendResult(prospectIdx, '<span class="loading-spinner"></span> 正在定位评论并发送...', '');
          const result = await chrome.tabs.sendMessage(tab.id, {
            action: 'sendReply', author, originalText: original, replyText, commentIdx: parseInt(commentIdx), userLink,
          });
          if (result && result.success) {
            if (result.verified) {
              showSendResult(prospectIdx, '✅ 回复已发送并验证通过', 'ok');
            } else {
              showSendResult(prospectIdx, '⚠️ 已尝试发送（点了发布+按了回车），请刷新页面确认', 'warn');
            }
            // 保存到本地存储
            try {
              addLocalReply(pageData?.url || '', author, original);
            } catch (_) {}
            // 发送回复后关注该用户
            try {
              await chrome.tabs.sendMessage(tab.id, {
                action: 'followUser', author,
              });
              console.log(`[关注] 已尝试关注 ${author}`);
            } catch (_) {}
            // 顺便点赞（低成本的 ID 曝光）
            try {
              const likeResult = await chrome.tabs.sendMessage(tab.id, {
                action: 'likeComment', author, originalText: original, commentIdx: parseInt(commentIdx), userLink,
              });
              if (likeResult?.success) {
                likedComments.push({
                  author,
                  textSnippet: (original || '').slice(0, 60),
                  time: Date.now(),
                });
                renderLikedList();
                if (likeResult.alreadyLiked) {
                  console.log(`[点赞] ${author} 的评论已点过赞`);
                } else {
                  console.log(`[点赞] 已为 ${author} 点赞, 点赞后状态: ${likeResult.liked ? '已赞' : '需确认'}`);
                }
              } else {
                console.warn(`[点赞] 点赞失败: ${likeResult?.error || '未知'}`);
              }
            } catch (_) {}
          } else {
            showSendResult(prospectIdx, `❌ ${result?.error || '发送失败'}`, 'fail');
          }
        } catch (e) {
          showSendResult(prospectIdx, `❌ ${e.message}`, 'fail');
        }
        btn.disabled = false;
        btn.textContent = '📤 一键发送';
        btn.classList.remove('sending');
      });
    });

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
      <button id="retryAiBtn" class="retry-btn">🔄 重试</button>`;
    container.appendChild(errDiv);
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
  el.innerHTML = `
    <div class="note-title">${esc(data.title || '(无标题)')}</div>
    <div class="note-meta">
      <span>👤 ${esc(data.author || '未知')}</span>
      <span>💬 ${data.comments.length} 条评论</span>
      <span>📡 ${esc(data._sourceLabel || '默认')}</span>
    </div>`;
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
