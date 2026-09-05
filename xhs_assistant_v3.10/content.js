// ============================================================
// 小红书评论助手 — 内容脚本 v3
// 功能：评论提取(按DOM顺序+备案过滤) / 线程结构 / 发送回复 / 点赞 / 关注 / 搜索页抓取
// ============================================================

(function () {
  'use strict';

  // ===== 备案/版权/法律信息过滤 =====
  const LEGAL_PATTERNS = [
    /沪ICP备\d+/,
    /营业执照/,
    /公网安备/,
    /增值电信业务经营许可证/,
    /医疗器械网络交易服务第三方平台备案/,
    /互联网药品信息服务资格证书/,
    /违法不良信息举报电话/,
    /网络文化经营许可证/,
    /网信算备\d+/,
    /行吟信息科技/,
    /©\s*\d{4}.*\d{4}/,
    /地址.*黄浦区/,
    /举报专区/,
    /个性化推荐算法/,
    /自营经营者信息/,
    /网上有害信息举报/,
    /上海市互联网举报中心/,
    /举报电话：?400/,
    /电话：?9501/,
  ];

  function isLegalOrGibberish(text) {
    if (text.length < 10) return false;
    for (const p of LEGAL_PATTERNS) {
      if (p.test(text)) return true;
    }
    const digitRatio = (text.match(/\d/g) || []).length / text.length;
    if (digitRatio > 0.4 && text.length > 30) return true;
    return false;
  }

  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract') {
      sendResponse(extractPageData());
      return true;
    }
    if (request.action === 'sendReply') {
      sendReplyToComment(request.author, request.originalText, request.replyText, request.commentIdx, request.userLink)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'scrollToComment') {
      scrollToComment(request.author, request.originalText)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'followUser') {
      followUser(request.author)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'likeComment') {
      likeComment(request.author, request.originalText, request.commentIdx, request.userLink)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 一键灌水：搜索页抓取 ──
    if (request.action === 'extractSearchResults') {
      sendResponse(extractSearchResults());
      return true;
    }
    if (request.action === 'scrollLoadMore') {
      scrollLoadMore()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    return true;
  });

  // ============================
  // 页面数据提取
  // ============================
  function extractPageData() {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const authorMeta = document.querySelector('meta[name="author"]');
    const title = ogTitle?.content || document.title.replace(/ - 小红书.*$/, '').trim() || '';
    const description = ogDesc?.content || '';
    const author = authorMeta?.content || '';
    const url = window.location.href;

    // 提取所有候选评论集
    const allCandidates = findAllCandidates();
    const best = allCandidates[0] || { comments: [] };
    const threads = extractThreads(best.comments || []);

    return {
      title, description, author, url,
      comments: best.comments || [],
      threads,
      _candidates: allCandidates,
    };
  }

  // ============================
  // 单条评论解析
  // ============================
  function parseCommentItem(el) {
    const text = el.textContent.trim();
    if (!text || text.length < 1) return null;
    if (isLegalOrGibberish(text)) return null;

    const authorEl = el.querySelector(
      'a[href*="/user/"], span[class*="name"], div[class*="user"], ' +
      'a:not([href*="explore"]):not([href*="search"])'
    );

    // 提取用户主页链接（唯一标识符，用于后续精准定位）
    const userLinkEl = el.querySelector('a[href*="/user/"]');
    const userLink = userLinkEl ? userLinkEl.getAttribute('href') : '';

    const allTexts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      const t = node.textContent.trim();
      if (t.length > 1 && node.parentElement && !['SCRIPT','STYLE'].includes(node.parentElement.tagName)) {
        allTexts.push(t);
      }
    }

    let authorName = '', content = '', replyTo = '';

    if (authorEl) {
      authorName = authorEl.textContent.trim();
      content = allTexts.filter(t => !authorName.includes(t) && !t.includes(authorName)).join(' ').trim();
    } else if (allTexts.length >= 2) {
      authorName = allTexts[0];
      content = allTexts.slice(1).join(' ').trim();
    } else {
      content = allTexts.join(' ').trim();
    }

    authorName = authorName.replace(/^@/, '').trim();

    const replyMatch = content.match(/^(回复\s*@?([^\s:：]+)\s*[:：]?\s*)/);
    if (replyMatch) {
      replyTo = replyMatch[2];
      content = content.slice(replyMatch[1].length).trim();
    }

    if (content.length < 2) return null;
    if (/^(赞|回复|举报|删除|编辑|分享|收藏|评论)$/.test(content)) return null;
    if (isLegalOrGibberish(content)) return null;

    return { author: authorName || '用户', content, replyTo, userLink };
  }

  // ============================
  // 多候选评论提取
  // ============================
  function findAllCandidates() {
    const candidates = [];
    const PAGE_W = window.innerWidth;
    const seen = new Set(); // dedup content keys within each extraction

    // 从容器中提取评论项（每个用户链接向上找包含元素）
    function extractFrom(container) {
      const items = [];
      const containerRect = container.getBoundingClientRect();
      const seenEls = new Set();
      for (const link of container.querySelectorAll('a[href*="/user/"]')) {
        let el = link.parentElement;
        while (el && el !== container) {
          if (el.querySelectorAll('a[href*="/user/"]').length !== 1) {
            el = el.parentElement; continue;
          }
          const linkText = link.textContent.trim();
          if (el.textContent.trim().replace(linkText, '').trim().length < 3) {
            el = el.parentElement; continue;
          }
          if (!seenEls.has(el)) {
            seenEls.add(el);
            const result = parseCommentItem(el);
            if (result) {
              const elRect = el.getBoundingClientRect();
              result._left = elRect.left - containerRect.left;
              const key = result.content.slice(0, 30) + (result.replyTo || '');
              if (!seen.has(key)) { seen.add(key); items.push(result); }
            }
          }
          break;
        }
      }
      return items;
    }

    // ---- 扫描所有 div，收集候选容器 ----
    const containers = [];
    for (const el of document.querySelectorAll('div')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 60) continue;
      if (rect.left < -10 || rect.top < -50) continue;
      const cnt = el.querySelectorAll('a[href*="/user/"]').length;
      if (cnt >= 2) {
        containers.push({ el, cnt, left: rect.left, w: rect.width, h: rect.height });
      }
    }
    containers.sort((a, b) => b.cnt - a.cnt);

    // 去重嵌套容器，保留最外层
    const uniqueContainers = [];
    for (const c of containers) {
      let isNested = false;
      for (const u of uniqueContainers) {
        if (u.el.contains(c.el)) { isNested = true; break; }
      }
      if (!isNested) uniqueContainers.push(c);
    }

    // 取前 5 个作为候选，分别提取
    let count = 0;
    for (const c of uniqueContainers) {
      if (count >= 5) break;
      const items = extractFrom(c.el);
      if (items.length > 0) {
        const side = c.left > PAGE_W * 0.25 ? '右侧' : '左侧';
        candidates.push({
          label: `候选${count + 1} (${side})`,
          desc: `${c.w.toFixed(0)}x${c.h.toFixed(0)} | ${c.cnt}个用户链接 | ${items.length}条`,
          comments: items,
        });
        count++;
      }
    }

    // ---- 后备：用户链接逐项遍历 ----
    if (candidates.length === 0) {
      const userLinks = document.querySelectorAll('a[href*="/user/"]');
      const fallbackItems = [];
      for (const link of userLinks) {
        let parent = link.parentElement;
        for (let d = 0; d < 5 && parent; d++) {
          const texts = [];
          const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while (node = walker.nextNode()) {
            const t = node.textContent.trim();
            if (t.length > 2 && node.parentElement !== link) texts.push(t);
          }
          const content = texts.filter(t => t !== link.textContent.trim()).join(' ').trim();
          if (content.length > 2 && content.length < 500 && !isLegalOrGibberish(content)) {
            fallbackItems.push({
              author: link.textContent.trim().replace(/^@/, '') || '用户',
              content,
              top: link.getBoundingClientRect().top,
            });
            break;
          }
          parent = parent.parentElement;
        }
      }
      fallbackItems.sort((a, b) => a.top - b.top);
      const deduped = [];
      const fs = new Set();
      for (const it of fallbackItems) {
        const k = it.content.slice(0, 30);
        if (!fs.has(k)) { fs.add(k); deduped.push(it); }
      }
      if (deduped.length > 0) {
        candidates.push({
          label: '后备 (逐链接)',
          desc: `${deduped.length}条`,
          comments: deduped,
        });
      }
    }

    // ---- 后备：暴力扫描 ----
    if (candidates.length === 0) {
      let bestContainer = null, bestCount = 0;
      for (const div of document.querySelectorAll('div[class]')) {
        const children = div.querySelectorAll(':scope > div');
        if (children.length < 3 || children.length > 50) continue;
        let cnt = 0;
        for (const c of children) { if (c.textContent.trim().length > 2) cnt++; }
        if (cnt > bestCount) { bestCount = cnt; bestContainer = div; }
      }
      if (bestContainer) {
        const bruteItems = [];
        const bs = new Set();
        for (const item of bestContainer.querySelectorAll(':scope > div')) {
          const text = item.textContent.trim();
          if (!text || text.length < 2 || isLegalOrGibberish(text)) continue;
          const k = text.slice(0, 30);
          if (bs.has(k)) continue;
          bs.add(k);
          const ae = item.querySelector('a[href*="/user/"], span[class*="name"]');
          bruteItems.push({
            author: ae ? ae.textContent.trim().replace(/^@/, '') : '用户',
            content: text,
          });
          if (bruteItems.length >= 20) break;
        }
        if (bruteItems.length > 0) {
          candidates.push({
            label: '后备 (暴力)',
            desc: `${bruteItems.length}条`,
            comments: bruteItems,
          });
        }
      }
    }

    return candidates;
  }

  // ============================
  // 线程结构提取
  // ============================

  // 作者名模糊匹配：处理前缀/后缀/@差异
  function authorMatch(name, target) {
    if (!name || !target) return false;
    if (name === target) return true;
    const a = name.replace(/^@/, '').trim();
    const b = target.replace(/^@/, '').trim();
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    if (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a))) return true;
    return false;
  }

  function extractThreads(flat) {
    if (!flat || flat.length === 0) return [];

    // 有位置数据 → 基于缩进分组（小红书评论区通过缩进表示层级，而非"回复 @"文本前缀）
    const hasPosition = flat.some(c => c._left != null);
    if (hasPosition) {
      const minLeft = Math.min(...flat.map(c => c._left));
      const INDENT_THRESHOLD = 15; // 像素：超过此缩进视为二级评论
      const threads = [];
      let current = null;

      for (let i = 0; i < flat.length; i++) {
        const c = flat[i];
        const indent = c._left - minLeft;

        if (indent < INDENT_THRESHOLD) {
          // 一级评论（新话题）
          current = {
            author: c.author,
            content: c.content,
            replies: [],
            _commentIdx: i,
          };
          threads.push(current);
        } else if (current) {
          // 二级评论（归入最近的一级评论下）
          current.replies.push({
            author: c.author,
            content: c.content,
            replyTo: c.replyTo || '',
            _commentIdx: i,
          });
        }
      }

      return threads;
    }

    // 无位置数据 → 回退到文本 replyTo 匹配（原逻辑）
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
          replies.push({ author: r.author, content: r.content, replyTo: r.replyTo, _commentIdx: j });
          used.add(j);
        }
      }
      threads.push({ author: c.author, content: c.content, replies: replies.slice(0, 15), _commentIdx: i });
      used.add(i);
    }
    return threads;
  }

  // ============================
  // 跳转到指定评论（滚动 + 高亮）
  // ============================
  async function scrollToComment(author, originalText) {
    const searchText = originalText.slice(0, 60);
    let bestMatch = null, bestScore = -1;

    // 遍历所有文本节点，找到最精确的匹配
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      const t = node.textContent.trim();
      if (!t.includes(searchText)) continue;

      // 向上找到最近的包含元素（非文本节点）
      let el = node.parentElement;
      if (!el) continue;

      const elText = el.textContent.trim();
      let score = 0;
      // 精确匹配原文（不含前缀）加分
      if (elText === originalText) score += 100;
      else if (elText.includes(originalText)) score += 50;
      // 作者名匹配加分
      if (author && elText.includes(author)) score += 20;
      // 元素越短（越精确）加分
      score += Math.max(0, 200 - elText.length);
      // 深度越深越精确
      let depth = 0, p = el;
      while (p.parentElement) { depth++; p = p.parentElement; }
      score += depth;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    if (!bestMatch) return { success: false, error: '未找到目标评论' };

    bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const origBg = bestMatch.style.background;
    bestMatch.style.transition = 'background 0.3s';
    bestMatch.style.background = '#fff3cd';
    await sleep(600);
    bestMatch.style.background = '#fff8e1';
    await sleep(400);
    bestMatch.style.background = origBg || 'transparent';
    return { success: true };
  }

  // ============================
  // 寻找评论元素（提取自 sendReplyToComment，供 locate + send 复用）
  // ============================
  function findCommentElement(author, originalText, commentIdx, userLink) {
    // ★ 首选方案：通过用户主页链接精准定位（最可靠）
    if (userLink) {
      const linkEl = document.querySelector(`a[href="${userLink}"]`);
      if (linkEl) {
        // 找到包含该链接且含有评论内容的父元素
        let el = linkEl.parentElement;
        while (el && el !== document.body) {
          const linkCount = el.querySelectorAll('a[href*="/user/"]').length;
          if (linkCount === 1 && el.textContent.trim().length > 10) {
            return el;
          }
          el = el.parentElement;
        }
        // 如果没找到合适的父元素，返回链接的最近评论容器
        return linkEl.closest('div') || linkEl.parentElement;
      }
    }

    const searchText = (originalText || '').slice(0, 60);
    if (!searchText) return null;

    // 首选方案：TreeWalker 精确文本匹配 + 多维打分
    let bestMatch = null, bestScore = -1;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      const t = node.textContent.trim();
      if (!t.includes(searchText)) continue;
      let el = node.parentElement;
      if (!el) continue;
      const elText = el.textContent.trim();
      let score = 0;
      if (elText === originalText) score += 100;
      else if (originalText && elText.includes(originalText)) score += 50;
      if (author && elText.includes(author)) score += 20;
      score += Math.max(0, 200 - elText.length);
      let depth = 0, p = el;
      while (p.parentElement) { depth++; p = p.parentElement; }
      score += depth;
      if (score > bestScore) { bestScore = score; bestMatch = el; }
    }
    if (bestMatch) return bestMatch;

    // 降级1：精确原文匹配
    if (originalText) {
      for (const el of document.querySelectorAll('div, span, p')) {
        const t = el.textContent.trim();
        if (t.includes(originalText) && t.length < originalText.length + 30) return el;
      }
    }

    // 降级2：前30字符匹配
    const shortText = originalText ? originalText.slice(0, 30) : '';
    if (shortText) {
      for (const el of document.querySelectorAll('div, span, p')) {
        const t = el.textContent.trim();
        if (t.includes(shortText) && t.length < (originalText || '').length + 60) return el;
      }
    }

    // 降级3：按作者名 + 内容片段
    if (author && originalText && originalText.length > 10) {
      for (const el of document.querySelectorAll('div, span, p')) {
        if (!el.textContent.includes(author)) continue;
        let parent = el.parentElement;
        for (let d = 0; d < 5 && parent; d++) {
          if (parent.textContent.trim().includes(originalText.slice(0, 20))) return parent;
          parent = parent.parentElement;
        }
      }
    }

    // 降级4：按评论索引
    if (commentIdx !== undefined && commentIdx >= 0) {
      const allSections = document.querySelectorAll('div, [class*="comment"], [class*="note-item"]');
      const primaryComments = Array.from(allSections).filter(el =>
        el.offsetParent !== null &&
        el.querySelector('a[href*="/user/"]') &&
        !el.querySelector('[class*="reply"] [class*="reply"]')
      );
      if (primaryComments.length > commentIdx) return primaryComments[commentIdx];
    }

    return null;
  }

  // ============================
  // 发送回复
  // ============================
  async function sendReplyToComment(author, originalText, replyText, commentIdx, userLink) {
    // ★ 先关闭已存在的回复输入框（避免上次回复的输入残留导致发错评论）
    try {
      const oldInput = findBottomReplyInput();
      if (oldInput && oldInput.offsetParent !== null) {
        // 按 Escape 键关闭（小红书 React 页面通常支持）
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        await sleep(400);
        // 如果还没关掉，尝试点击附近可能的关闭/取消按钮
        const stillOpen = findBottomReplyInput();
        if (stillOpen && stillOpen.offsetParent !== null) {
          const panel = stillOpen.closest('[class*="reply" i], [class*="footer" i], [class*="bottom" i]');
          if (panel) {
            const closeBtn = panel.querySelector('button, [class*="close" i], [class*="cancel" i], [class*="del" i]');
            if (closeBtn) closeBtn.click();
          }
        }
        await sleep(300);
      }
    } catch (_) {}

    // ===== 1. 找到目标评论 =====
    let bestMatch = findCommentElement(author, originalText, commentIdx, userLink);
    if (!bestMatch) return { success: false, error: '未找到目标评论在页面上的位置' };

    // ===== 2. 确保高亮可见（已定位时可能已高亮，补一个闪烁确认） =====
    bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);
    const origBg = bestMatch.style.background;
    bestMatch.style.transition = 'background 0.3s';
    bestMatch.style.background = '#fff3cd';
    await sleep(500);
    bestMatch.style.background = '#fff8e1';
    await sleep(300);
    bestMatch.style.background = origBg || 'transparent';

    // ===== 3. 查找回复按钮 =====
    const replyBtn = findReplyButtonNear(bestMatch);
    if (!replyBtn) return { success: false, error: '未找到回复按钮' };
    replyBtn.click();
    // 某些 React 版本不响应 click()，额外派发真实鼠标事件
    replyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // ===== 4. 等待回复输入框出现（最多等 4 秒）=====
    // 注意：回复框在页面底部的固定输入栏，不在评论旁边
    let inputEl = null;
    for (let i = 0; i < 8; i++) {
      await sleep(500);
      inputEl = findBottomReplyInput();
      if (inputEl) break;
    }
    if (!inputEl) return { success: false, error: '未找到回复输入框' };

    // ===== 5. 填入回复内容（兼容 React 受控组件） =====
    inputEl.focus();
    const isEditable = inputEl.contentEditable === 'true' || inputEl.contentEditable === 'plaintext-only';
    if (isEditable) {
      // 小红书评论回复框一般是 contentEditable div
      inputEl.innerHTML = '';
      // execCommand 能触发 React 的 onChange
      document.execCommand('insertText', false, replyText);
      // 额外派发 InputEvent 让 React 一定收到
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replyText }));
    } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      ).set;
      nativeSetter.call(inputEl, replyText);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      inputEl.textContent = replyText;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(400);

    // ===== 6. 发送 =====
    // 方法一：找附近的发布按钮
    const sendBtn = findSendButtonNear(inputEl);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    // 方法二：Enter 键（双重保障，很多 SNS 用 Enter 提交回复）
    await sleep(200);
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    await sleep(1000);

    // 验证：回复内容是否出现在页面上
    const verifyText = replyText.slice(0, 40);
    const verified = Array.from(document.querySelectorAll('div, span, p')).some(el => {
      const t = el.textContent.trim();
      return t.includes(verifyText) && t.length < replyText.length + 80;
    });
    return { success: true, verified, method: verified ? 'confirmed' : 'tried_both' };
  }

  function findReplyButtonNear(el) {
    const texts = ['回复', 'Reply'];
    if (texts.includes(el.textContent.trim())) return el;
    for (const c of el.children) { if (texts.includes(c.textContent.trim())) return c; }

    const elRect = el.getBoundingClientRect();
    let allCandidates = [];

    // ★ 逐层向上收集所有"回复"按钮，按视觉距离排序
    //   解决了评论区 DOM 中 comment-item 和 action-area 分离时，
    //   兄弟遍历（:scope > *）会先遇到其他评论的"回复"按钮的问题。
    let walk = el;
    for (let depth = 0; depth < 10; depth++) {
      if (!walk.parentElement) break;
      walk = walk.parentElement;

      // 在当前层级搜索"回复"按钮
      const btns = walk.querySelectorAll('button, a, span, div');
      for (const btn of btns) {
        if (texts.includes(btn.textContent.trim()) && btn.offsetParent !== null) {
          const btnRect = btn.getBoundingClientRect();
          const dist = Math.abs(btnRect.top - elRect.top);
          allCandidates.push({ btn, dist, level: depth });
        }
      }

      // 找到至少一个时，选视觉距离最近的（优先选同一层级的）
      if (allCandidates.length > 0) {
        // 按距离排序，选最近的
        allCandidates.sort((a, b) => a.dist - b.dist);
        const best = allCandidates[0];
        // 如果最近的距离<200px，认为有效
        if (best.dist < 200) return best.btn;
        // 否则继续向上找更深层级的候选
      }
    }

    // 所有层级都搜索完了，返回最近的一个（不管距离）
    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) => a.dist - b.dist);
      return allCandidates[0].btn;
    }

    return null;
  }

  function findBottomReplyInput() {
    // 小红书回复框在页面底部的固定栏，不是内嵌在评论下方
    const SELECTORS = 'textarea, div[contenteditable="true"], [role="textbox"], input[type="text"], [contenteditable], [placeholder]';
    const viewportH = window.innerHeight;
    let best = null, bestBottom = -Infinity;

    for (const inp of document.querySelectorAll(SELECTORS)) {
      if (inp.offsetParent === null) continue;
      const ir = inp.getBoundingClientRect();
      if (ir.top < 150) continue;                 // 跳过页面顶部的主评论输入框
      if (ir.width < 100 || ir.height < 20) continue; // 跳过太小元素
      if (ir.bottom > bestBottom) { bestBottom = ir.bottom; best = inp; } // 取最靠底部的
    }
    return best;
  }

  // ============================
  // 点赞评论（低成本的 ID 曝光方式）
  // ============================
  function findLikeButtonNear(el) {
    // 点赞关键词：小红书"赞"按钮，排除"已赞"
    const likeTexts = ['赞'];
    const likedTexts = ['已赞'];

    // 如果元素本身就是"赞"按钮
    const elText = el.textContent.trim();
    if (likeTexts.includes(elText)) return { btn: el, alreadyLiked: false };
    if (likedTexts.includes(elText)) return { btn: el, alreadyLiked: true };

    const elRect = el.getBoundingClientRect();
    let allCandidates = [];

    // 逐层向上搜索，同 `findReplyButtonNear` 策略
    let walk = el;
    for (let depth = 0; depth < 10; depth++) {
      if (!walk.parentElement) break;
      walk = walk.parentElement;

      const btns = walk.querySelectorAll('button, a, span, div');
      for (const btn of btns) {
        if (btn.offsetParent === null) continue;
        const text = btn.textContent.trim();
        if (likeTexts.includes(text)) {
          const btnRect = btn.getBoundingClientRect();
          const dist = Math.abs(btnRect.top - elRect.top);
          allCandidates.push({ btn, dist, level: depth, alreadyLiked: false });
        } else if (likedTexts.includes(text)) {
          const btnRect = btn.getBoundingClientRect();
          const dist = Math.abs(btnRect.top - elRect.top);
          allCandidates.push({ btn, dist, level: depth, alreadyLiked: true });
        }
      }

      if (allCandidates.length > 0) {
        allCandidates.sort((a, b) => a.dist - b.dist);
        if (allCandidates[0].dist < 200) return allCandidates[0];
      }
    }

    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) => a.dist - b.dist);
      return allCandidates[0];
    }
    return null;
  }

  async function likeComment(author, originalText, commentIdx, userLink) {
    const element = findCommentElement(author, originalText, commentIdx, userLink);
    if (!element) return { success: false, error: '未找到目标评论' };

    const result = findLikeButtonNear(element);
    if (!result) return { success: false, error: '未找到点赞按钮' };
    if (result.alreadyLiked) return { success: true, alreadyLiked: true };

    const btn = result.btn;
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await sleep(300);
    btn.click();
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(500);

    // 验证是否点赞成功
    const textAfter = btn.textContent.trim();
    const liked = textAfter.includes('已赞');
    return { success: true, alreadyLiked: false, liked };
  }

  function findSendButtonNear(inputEl) {
    const sendTexts = ['发送', '发布', 'Send'];
    const inputRect = inputEl.getBoundingClientRect();
    let best = null, bestDist = Infinity;
    for (const el of document.querySelectorAll('button, div[role="button"], [class*="send"], [class*="btn"], [class*="publish"]')) {
      if (el.offsetParent === null) continue;
      if (el.disabled) continue;
      const text = el.textContent.trim();
      if (!sendTexts.includes(text)) continue;
      const er = el.getBoundingClientRect();
      if (Math.abs(er.top - inputRect.top) > 200) continue; // 不和输入框在同一区域的就跳过
      const dist = Math.abs(er.top - inputRect.top) + Math.abs(er.left - inputRect.left);
      if (dist < bestDist) { bestDist = dist; best = el; }
    }
    return best;
  }

  // ============================
  // 关注用户
  // ============================
  async function followUser(author) {
    if (!author) return { success: false, error: '未提供用户名' };

    // 策略1：在评论区找关注按钮（用户名旁边的"关注"）
    const allLinks = document.querySelectorAll('a[href*="/user/"]');
    let targetLink = null;

    for (const link of allLinks) {
      const name = link.textContent.trim().replace(/^@/, '');
      if (name.includes(author) || author.includes(name)) {
        targetLink = link;
        break;
      }
    }

    if (!targetLink) {
      // 策略2：遍历所有文本找用户名
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        const t = node.textContent.trim();
        if (t === author || t === '@' + author) {
          targetLink = node.parentElement?.querySelector('a[href*="/user/"]');
          if (targetLink) break;
        }
      }
    }

    if (!targetLink) {
      return { success: false, error: `未找到用户 ${author} 在页面上` };
    }

    // 从用户链接向上找包含"关注"按钮的容器
    let cur = targetLink.parentElement;
    for (let d = 0; d < 8 && cur; d++) {
      const followBtns = cur.querySelectorAll('button, div[class*="follow"], span[class*="follow"]');
      for (const btn of followBtns) {
        const text = btn.textContent.trim();
        if (text === '关注' || text === 'Follow' || text === '+ 关注' || text === '➕关注') {
          if (!btn.disabled && !btn.classList.contains('followed')) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(300);
            btn.click();
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            // 等待关注生效
            await sleep(500);
            // 检查是否成功（按钮文字变化）
            const btnText = btn.textContent.trim();
            const followed = btnText.includes('已关注') || btnText.includes('Following');
            return { success: true, followed };
          }
        }
      }
      cur = cur.parentElement;
    }

    return { success: false, error: `未找到 ${author} 的关注按钮` };
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ============================
  // 一键灌水：搜索页抓取
  // ============================
  function extractSearchResults() {
    const notes = [];
    const seen = new Set();

    // 策略1：通过链接提取笔记卡片
    const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      // 提取 noteId
      const match = href.match(/\/explore\/([a-f0-9]+)/) || href.match(/\/search_result\/([a-f0-9]+)/);
      if (!match) continue;
      const noteId = match[1];
      if (seen.has(noteId)) continue;
      seen.add(noteId);

      // 向上找卡片容器（最多 8 层）
      let card = link;
      for (let i = 0; i < 8; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        // 检测是否为卡片容器：包含标题类文本 + 链接
        const textLen = card.textContent.trim().length;
        if (textLen > 20 && textLen < 500 && card.querySelectorAll('a').length <= 5) break;
      }

      // 提取标题
      let title = '';
      const titleEl = card.querySelector('[class*="title"], .note-title, span.title');
      if (titleEl) {
        title = titleEl.textContent.trim();
      } else {
        // 取卡片内最长的文本块作为标题
        const textBlocks = card.querySelectorAll('span, div, p');
        let maxLen = 0;
        for (const tb of textBlocks) {
          const t = tb.textContent.trim();
          if (t.length > maxLen && t.length > 4 && t.length < 200 && !t.includes('http')) {
            maxLen = t.length;
            title = t;
          }
        }
      }

      // 提取作者
      let author = '';
      const authorEl = card.querySelector('a[href*="/user/"], [class*="author"], [class*="name"]');
      if (authorEl) author = authorEl.textContent.trim();

      // 提取点赞数
      let likes = '';
      const likeEl = card.querySelector('[class*="like"], [class*="count"]');
      if (likeEl) {
        const likeText = likeEl.textContent.trim();
        if (/^\d/.test(likeText) || likeText.includes('万')) likes = likeText;
      }

      if (title || noteId) {
        notes.push({
          noteId,
          url: `https://www.xiaohongshu.com/explore/${noteId}`,
          title: title || '无标题',
          author: author || '未知',
          likes,
        });
      }
    }

    // 策略2：如果策略1结果太少，尝试扫描所有 section/div 容器
    if (notes.length < 3) {
      const sections = document.querySelectorAll('section, div[class*="note"], div[class*="card"]');
      for (const sec of sections) {
        const link = sec.querySelector('a[href*="/explore/"]');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/explore\/([a-f0-9]+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);

        const text = sec.textContent.trim();
        let title = '';
        const spans = sec.querySelectorAll('span');
        for (const sp of spans) {
          const t = sp.textContent.trim();
          if (t.length > 5 && t.length < 100 && !/^\d/.test(t)) { title = t; break; }
        }

        notes.push({
          noteId: m[1],
          url: `https://www.xiaohongshu.com/explore/${m[1]}`,
          title: title || text.slice(0, 60),
          author: '',
          likes: '',
        });
        if (notes.length >= 30) break;
      }
    }

    console.log(`[一键灌水] 搜索页提取到 ${notes.length} 篇笔记`);
    return { notes };
  }

  async function scrollLoadMore() {
    const beforeCount = document.querySelectorAll('a[href*="/explore/"]').length;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await sleep(2500);
    const afterCount = document.querySelectorAll('a[href*="/explore/"]').length;
    const newNotes = afterCount - beforeCount;
    const hasMore = newNotes > 0;
    // 重新提取
    const result = extractSearchResults();
    return { notes: result.notes, newCount: newNotes, hasMore };
  }

})();
