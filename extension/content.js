// ============================================================
// 小红书评论助手 — 内容脚本 v3
// 功能：评论提取(按DOM顺序+备案过滤) / 线程结构 / 发送回复 / 点赞 / 关注 / 搜索页抓取
// ============================================================

(function () {
  'use strict';

  // 防止重复注入（多次 executeScript 时只运行一次）
  if (window.__xhsContentJSLoaded) return;
  window.__xhsContentJSLoaded = true;

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
    /保护个人信息/,
    /保护个人信息与资金安全/,
    /债务减免/,
    /征信修复/,
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

  // ===== 停留时间配置（设置页「⏱️ 停留时间」Tab，存 delay_config，单位毫秒，默认 = 技术下限：能跑通的最快值）=====
  // 实际停留 = 设定值 + 随机上浮最多 50%（节奏更自然）；带技术下限的项用 floor 兜底防功能失效
  const DELAY_DEFAULTS = { browseDwell: 1500, typingCharDelay: 20, likeGap: 450, lazyLoadWait: 900, retryBackWait: 300, retryOpenWait: 800, noteOpenBuffer: 700, preSendGap: 500, batchItemGap: 6000 };
  let _delayCfg = { ...DELAY_DEFAULTS };
  try {
    chrome.storage.local.get('delay_config').then(r => {
      if (r && r.delay_config) _delayCfg = { ...DELAY_DEFAULTS, ...r.delay_config };
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.delay_config) _delayCfg = { ...DELAY_DEFAULTS, ...(ch.delay_config.newValue || {}) };
    });
  } catch (_) {}
  function dwellMs(key, floor) {
    // 支持两种存法：旧 {key: 数值} 或新 {key: {min,max}}（区间随机、更自然）。
    // 旧数值 n → 视为 min=n、max≈n*1.6，保留旧的“至多上浮”随机性。
    const c = _delayCfg[key];
    let minV = 0, maxV = 0;
    if (c && typeof c === 'object') { minV = Math.max(0, Number(c.min) || 0); maxV = Math.max(0, Number(c.max) || 0); }
    else { minV = maxV = Math.max(0, Number(c) || 0); if (maxV) maxV = Math.round(maxV * 1.6); }
    let v = 0;
    if (maxV > minV) v = minV + Math.random() * (maxV - minV);
    else v = minV;
    return Math.max(floor || 0, v);
  }

  // ★ 拟人化填字助手：往输入框填入文本。
  //   fast=true 或 delay_config.typingCharDelay=0 → 一次性填入（手动/最快通道）；
  //   否则逐字输入 + 随机停顿（批量自动通道，受拟人挡位控制）。与评论发送共用同一套节奏。
  async function _typeInto(inputEl, text, fast) {
    if (!inputEl) return;
    const txt = String(text || '');
    const isEditable = inputEl.contentEditable === 'true' || inputEl.contentEditable === 'plaintext-only';
    // 清空现有内容
    try {
      if (isEditable) { inputEl.innerHTML = ''; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        const ns = Object.getOwnPropertyDescriptor(inputEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set;
        ns.call(inputEl, ''); inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else { inputEl.textContent = ''; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
    } catch (_) {}
    await sleep(80);
    const typingCfg = Math.max(0, Number(_delayCfg.typingCharDelay) || 0);
    if (fast || typingCfg <= 0) {
      // 快速通道：一次性填入全部文本，不逐字磨蹭
      if (isEditable) {
        document.execCommand('insertText', false, txt);
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: txt }));
      } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        const ns = Object.getOwnPropertyDescriptor(inputEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set;
        ns.call(inputEl, txt); inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else { inputEl.textContent = txt; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
      await sleep(50);
      return;
    }
    // 自然输入通道：逐字输入 + 随机停顿（节奏基于拟人挡位的 typingCharDelay）
    const perCharMs = typingCfg;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (i > 0 && i % (8 + Math.floor(Math.random() * 6)) === 0) await sleep(perCharMs * 2 + Math.random() * perCharMs * 2);
      if ('，。！？；、,.!?;'.includes(ch)) await sleep(perCharMs + Math.random() * perCharMs);
      const delay = perCharMs * (0.5 + Math.random() * 0.5);
      try {
        if (isEditable) {
          document.execCommand('insertText', false, ch);
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
          inputEl.value += ch; inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        } else { inputEl.textContent += ch; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
      } catch (_) {}
      await sleep(delay);
    }
    await sleep(perCharMs + Math.random() * perCharMs);
  }

  // ===== 全局操作锁：防止上一条评论没发完，第二条就开始定位/输入，导致“评论自己”/错位 =====
  let _operationLock = false;      // 当前是否有操作正在进行
  let _operationLockTime = 0;      // 上锁时间戳（用于死锁自愈）

  // ===== 防重复闸：记录上一条“成功发送”的目标，若下一条打开的回复框还是上一条那个目标
  //       （说明定位卡在上一条没挪动），而本次想发的是另一个人，就直接放弃，绝不重复发 =====
  let _lastSentTarget = null;      // { atName, author, textKey }（均为归一化后的字符串）

  // ===== 会话级防重复：记录本次会话已成功发送过的“评论指纹”（作者链接+正文前若干字）。
  //       只要定位又开到同一条评论（不管昵称读不读得到），就放弃，彻底杜绝重复评论 =====
  const _sessionSentSigs = new Set();

  // ===== 会话级防重复（一级评论）：笔记（标题/ID）+ 正文前若干字 作为指纹。
  //       一级评论没有"评论会话"可指纹，但同一篇笔记的同一句话发两遍同样是重复评论 =====
  const _sessionNoteCommentSigs = new Set();

  // 广播锁状态到 popup 页面（评论助手界面据此显示“操作进行中”横幅）
  function _broadcastLockState(locked, label) {
    try {
      chrome.runtime.sendMessage({ action: 'lockStateChanged', locked: locked, label: label || '' });
    } catch (_) {}
  }

  // 获取操作锁：若已有操作在进行，每 5s 重试一次，最多重试 3 次（共15s）就放弃；持锁超 30s 判为死锁强制释放
  async function acquireLock(label) {
    const RETRY_INTERVAL = 5000;   // 每次重试间隔 5s
    const MAX_RETRIES = 3;         // 最多重试 3 次
    let retries = 0;
    while (_operationLock) {
      if (Date.now() - _operationLockTime > 30000) {
        console.warn('[操作锁] ❗ 检测到超时死锁，强制释放');
        _operationLock = false;
        break;
      }
      if (retries >= MAX_RETRIES) {
        console.warn('[操作锁] ⏱ 重试 ' + MAX_RETRIES + ' 次仍被占用，放弃本次操作:', label);
        return false;
      }
      retries++;
      console.log('[操作锁] ⏳ 锁被占用，5s 后重试（' + retries + '/' + MAX_RETRIES + '）:', label);
      await sleepWithCountdown(RETRY_INTERVAL, `⚙️ 上一个操作还没完，排队中（${retries}/${MAX_RETRIES}）`);
    }
    _operationLock = true;
    _operationLockTime = Date.now();
    console.log('[操作锁] 🔒 获得锁:', label);
    _broadcastLockState(true, label);
    return true;
  }

  function releaseLock(label) {
    _operationLock = false;
    console.log('[操作锁] 🔓 释放锁:', label);
    _broadcastLockState(false, label);
  }

  // 心跳：长批次操作（如批量点赞）中途刷新持锁时间戳，避免被 30s 死锁自愈误判为死锁而提前释放
  function _touchLock() {
    if (_operationLock) _operationLockTime = Date.now();
  }

  // 找到小红书笔记详情弹层内部的滚动容器（评论区那一列），而不是背景页面
  // 小红书笔记详情是弹层，弹层里有独立滚动容器；直接 window.scrollBy 只会滚背景
  function getNoteScroller() {
    let best = null, bestScore = 0;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('div, section')) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      // 必须真的可滚动（内容高于可视高度）
      if (el.scrollHeight <= el.clientHeight + 20) continue;
      const r = el.getBoundingClientRect();
      if (r.height < vh * 0.3 || r.width < 200) continue;   // 太小的排除
      // 评论区通常是页面里最高的可滚动区域，用可滚动内容量当分数
      const score = (el.scrollHeight - el.clientHeight) + r.height;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  // ★ 滚动前先“CTRL+F”搜“评论”二字：内页一定有“共 N 条评论”标记，外页（首页/搜索/信息流）几乎没有“评论”二字
  // 用文本特征区分内外页，防止笔记弹层瞬时灌入信息流/外页时滚错目标（滚了背景页面也触发不了评论区懒加载）
  function findCommentMarker() {
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      if (window.find('评论')) {
        const anchor = sel.anchorNode;
        sel.removeAllRanges(); // 立即清除选中，避免页面文字被高亮
        if (anchor && anchor.parentElement) return { found: true, element: anchor.parentElement };
      }
    } catch (_) {}
    // 降级：TreeWalker 全文找“评论”文本节点（window.find 在某些嵌入环境可能不可用）
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if ((n.textContent || '').includes('评论')) {
          return { found: true, element: n.parentElement };
        }
      }
    } catch (_) {}
    return { found: false, element: null };
  }

  // 从“评论”标记元素向上找最近的滚动容器（评论区那一列），比全页打分更精准
  function scrollableAncestorOf(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const style = window.getComputedStyle(cur);
      let oy = style.overflowY;
      if (oy === 'visible') oy = style.overflow; // 简写 overflow 兜底
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && cur.scrollHeight > cur.clientHeight + 20) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // 在笔记弹层内滚动指定距离（找不到内部容器时才回退到整页滚动）
  function scrollNoteBy(delta) {
    const scroller = getNoteScroller();
    if (scroller) {
      scroller.scrollBy({ top: delta, behavior: 'smooth' });
      return true;
    }
    window.scrollBy({ top: delta, behavior: 'smooth' });
    return false;
  }

  // 点击笔记标题（弹层内的安全区域），借小红书自己的“点击他处收起回复框”机制关闭残留回复框
  // ⚠️ 只敢点标题：点弹层外面会关掉整个笔记；点其他元素可能误触链接/按钮
  function _clickNoteTitle() {
    let el = document.querySelector('#detail-title');
    if (!el) {
      // 降级：按 og:title 文本找标题节点（必须不在链接/按钮里，防误跳转）
      const t = (document.querySelector('meta[property="og:title"]')?.content || '')
        .replace(/ - 小红书.*$/, '').trim().slice(0, 20);
      if (t.length >= 4) {
        for (const cand of document.querySelectorAll('h1, h2, div, span')) {
          if (cand.offsetParent === null) continue;
          if (cand.closest('a, button, [role="button"]')) continue;
          const txt = cand.textContent.trim();
          if (txt && txt.length < 200 && txt.startsWith(t) && cand.children.length <= 2) { el = cand; break; }
        }
      }
    }
    if (!el || el.closest('a, button, [role="button"]')) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const opts = { bubbles: true, cancelable: true, clientX: r.left + Math.min(12, r.width / 2), clientY: r.top + Math.min(12, r.height / 2), button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    } catch (_) { return false; }
  }

  // 操作结束善后：让残留回复框自然失焦收起 + 等 DOM 稳定，避免污染下一条
  // ⚠️ 绝不能用 Esc——小红书笔记详情是弹层，发送后焦点已不在输入框，按 Esc 会直接关掉整个笔记退回搜索页
  async function settleAfterOperation() {
    try {
      const leftover = findBottomReplyInput();
      if (leftover && leftover.offsetParent !== null) {
        console.log('[操作锁] 检测到残留回复框，滚动评论区让其失焦收起');
        // 先让输入框主动失焦
        try { leftover.blur(); } catch (_) {}
        // 滚动笔记弹层内部的评论区（不是背景页面），让残留回复框失焦收起
        scrollNoteBy(-120);
        await sleep(400);
        scrollNoteBy(120);
        await sleep(400);
        // 滚动还没收起 → 点击笔记标题，用小红书自己的机制取消回复框
        const still = findBottomReplyInput();
        if (still && still.offsetParent !== null && _clickNoteTitle()) {
          console.log('[操作锁] 滚动未收起回复框，已点击笔记标题触发收起');
          await sleep(400);
        }
      }
      await sleep(600);
    } catch (_) {}
  }

  // ===== 账号绑定：仅在本人的「我的」主页读取并验证小红书号 =====
  // 小红书上没有别的地方能拿到登录账号的小红书号，只有在本人主页（“我的”页）才读得到。
  // 所以不做每次操作的闸门，而是在本人在主页时自动/手动读取一次并缓存结果：
  //   - 读取 binding(绑定号)；
  //   - 若当前正是本人主页 → 抓取“小红书号：xxx” → 与绑定号比对；
  //   - 把 { xhsId, matched } 写入 chrome.storage（background 的同名键），供 UI 锁定判断。
  const ACCOUNT_GUARD_KEY = '_acct_guard';
  function _xhsNormId(s) { return String(s || '').replace(/\s+/g, '').trim(); }

  let _editionBoundCache = null;
  async function _getEditionBound() {
    if (_editionBoundCache) return _editionBoundCache;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getEdition' });
      if (resp && resp.edition) {
        const ed = resp.edition;
        const xhsId = _xhsNormId((ed.boundAccount && ed.boundAccount.xhsId) || '');
        const obj = { hasBinding: !!xhsId, xhsId, name: (ed.boundAccount && ed.boundAccount.name) || '', tampered: !!ed.tampered };
        _editionBoundCache = obj;
        return obj;
      }
    } catch (_) {}
    const fallback = { hasBinding: false, xhsId: '', name: '', tampered: false };
    _editionBoundCache = fallback;
    return fallback;
  }

  async function _readAcctGuard() {
    try { const d = await chrome.storage.local.get(ACCOUNT_GUARD_KEY); return d[ACCOUNT_GUARD_KEY] || null; } catch (_) { return null; }
  }
  async function _writeAcctGuard(g) {
    try { await chrome.storage.local.set({ [ACCOUNT_GUARD_KEY]: g }); } catch (_) {}
  }

  /** 当前 URL 是否某用户主页 */
  function _isProfileUrl() {
    return /\/user\/profile\/[^/?#]+/.test(location.pathname + location.search);
  }

  /** 是否为本人主页。
   * 旧版网页：本人主页显示「编辑资料」按钮（别人的主页显示「关注」）。
   * 新版 AI 布局的主页已不再渲染「编辑资料」按钮，但本人主页会显示“小红书号：xxx”。
   * 这里只要满足其一即可认定“是本人在看自己的主页”，真正的校验口径是后续 xhsId === 绑定号。
   */
  function _isSelfProfile() {
    if (!_isProfileUrl()) return false;
    try {
      const bodyText = document.body ? document.body.innerText : '';
      if (bodyText.includes('编辑资料') || bodyText.includes('编辑个人资料')) return true;
      return /小红书号\s*[:：]?\s*[A-Za-z0-9_-]{4,}/.test(bodyText);
    } catch (_) { return false; }
  }

  /** 在本人的「我的」主页读取小红书号并与绑定号比对，把结果写缓存。返回校验结果对象 */
  async function _verifyOwnProfile() {
    const ed = await _getEditionBound();
    const res = {
      ok: false, bound: ed.hasBinding, tampered: ed.tampered,
      boundXhsId: ed.xhsId, checkedXhsId: '', matched: false, onOwnProfile: _isSelfProfile(),
    };
    if (ed.tampered) {
      await _writeAcctGuard({ xhsId: ed.xhsId, matched: false, tampered: true, at: Date.now() });
      return res;
    }
    if (!ed.hasBinding) { res.ok = true; return res; } // 未绑定无限制
    if (!_isSelfProfile()) {
      res.code = 'needOwnProfile';
      res.reason = '请打开你本人的小红书主页（“我的”页）后再验证';
      return res;
    }
    const prof = extractUserProfile();
    const cur = _xhsNormId(prof.xhsId);
    res.onOwnProfile = true;
    res.checkedXhsId = cur;
    res.matched = !!cur && cur === ed.xhsId;
    res.ok = res.matched;
    res.name = prof.name;
    if (!res.matched) res.reason = cur ? ('当前主页小红书号为「' + cur + '」（非绑定号 ' + ed.xhsId + '）') : '未读到当前主页的小红书号';
    await _writeAcctGuard({ xhsId: cur, name: prof.name || '', at: Date.now(), matched: res.matched });
    return res;
  }

  /** 在合适时机（本人在主页时）自动执行一次校验；非本人主页直接忽略 */
  async function _autoVerifyOwnProfile() {
    if (!_isSelfProfile()) return;
    try { await _verifyOwnProfile(); } catch (_) {}
  }

  // 串行执行包装：同一时刻只允许一个变更类操作（发送/定位）运行
  async function runExclusive(label, fn) {
    const ok = await acquireLock(label);
    if (!ok) {
      return { success: false, error: '上一条操作仍在进行中，本次已跳过（防止评论错位）' };
    }
    try {
      return await fn();
    } finally {
      await settleAfterOperation();
      releaseLock(label);
    }
  }
  /* 🛡 互动侧风控闸（四十四改）：评论/回复/私信发出前叫后台过一遍词表（联系方式/链接/平台黑话）。
     拦下＝这条不发（后台已记一笔+通知），不重处置；后台没答上（网络/更新中）＝放行不误伤。 */
  async function _interactGuard(text, kind, owner) {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'interactGuard', data: { text: text, kind: kind, owner: owner || '' } });
      if (r && r.ok === false) return { ok: false, error: r.error || '这条含风控词，已拦下' };
      return { ok: true };
    } catch (_) { return { ok: true }; }
  }
  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // ── 轻量页面类型预检（不滚动、不采集）：popup 扫描前先判断是不是笔记详情页，错页立刻重试省时间 ──
    if (request.action === 'checkPageType') {
      const cardLinkCount = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"]').length;
      const hasReplyInput = !!findBottomReplyInput();
      const hasScroller = !!getNoteScroller();
      // 与 extractPageData 的守卫同口径（预检阶段没有评论数，只看卡片数+回复框+滚动容器）
      sendResponse({
        success: true,
        notNotePage: cardLinkCount >= 3 && !hasReplyInput && !hasScroller,
        cardLinkCount,
      });
      return true;
    }
    // ★ 读取当前主页的昵称+简介（供「AI 建人设」用；读不到就返回空，绝不报错）
    if (request.action === 'getProfileDesc') {
      let desc = '', name = '';
      try {
        const _t = (el) => el ? String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '';
        const de = document.querySelector('[class*="user-desc"]') || (() => { const s = document.querySelector('[class*="desc"]'); return s && /简介|签名|介绍/.test(s.className) ? s : null; })();
        if (de) desc = _t(de).replace(/^简介[:：]?\s*/, '');
        if (!desc) { const od = document.querySelector('meta[name="description"]'); if (od) desc = String(od.getAttribute('content') || '').replace(/\s+小红薯.*$/, '').trim(); }
        const og = document.querySelector('meta[property="og:title"]');
        let rt = og ? og.content : (document.title || '');
        name = rt.replace(/\s*-\s*(小红书|个人主页).*$/, '').trim();
        if (name.length > 30) name = '';
      } catch (_) {}
      sendResponse({ ok: true, name, desc });
      return true;
    }
    if (request.action === 'extract') {
      sendResponse(extractPageData());
      return true;
    }
    if (request.action === 'loadMoreComments') {
      runExclusive('loadMoreComments', () => loadMoreComments(request.maxRounds))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ★ 由 popup 驱动网页上那条红色状态栏（AI 分析等阶段发生在 background，内容脚本本身不知道）
    if (request.action === 'setStatusBar') {
      _showStatus(request.text || '');
      sendResponse({ ok: true });
      return true;
    }
    // ★ 整条流程（加载评论 + AI 分析）结束 → 停读秒、切“等待用户操作”
    if (request.action === 'finishStatusBar') {
      _hideStatus();
      sendResponse({ ok: true });
      return true;
    }
    // ★ AI 分析期间的页面“轻划动”心跳：每几秒小幅滚动一次，保持页面活跃、防后台节流（由 auto-bot 驱动，AI 完成后自动停止）
    if (request.action === 'nudgeScroll') {
      try {
        // 方向随机的小幅滚动（偶尔反向一下更自然，也避免一直往一个方向滚到底）
        const dir = Math.random() < 0.25 ? -1 : 1;
        scrollNoteBy(dir * (100 + Math.floor(Math.random() * 150)));
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return; // 不占用操作锁（sendReply/like 等锁内任务不受影响）
    }
    if (request.action === 'sendReply') {
      _interactGuard(request.replyText, 'comment', request.author).then(g => {
        if (!g.ok) { sendResponse({ success: false, blocked: true, error: g.error }); return; }
        runExclusive('sendReply', () => sendReplyToComment(request.author, request.originalText, request.replyText, request.commentIdx, request.userLink, request.images, request.humanize))
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ success: false, error: e.message }));
      });
      return true;
    }
    if (request.action === 'scrollToComment') {
      runExclusive('scrollToComment', () => scrollToComment(request.author, request.originalText))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'locateReply') {
      runExclusive('locateReply', () => locateAndOpenReply(request.author, request.originalText, request.commentIdx, request.userLink))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'followUser') {
      runExclusive('followUser', () => followUser(request.author))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'likeComment') {
      runExclusive('likeComment', () => likeComment(request.author, request.originalText, request.commentIdx, request.userLink))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (request.action === 'likeCommentsBatch') {
      // 整批点赞（含中途等待）全程持同一把锁，不在间隔释锁
      runExclusive('likeBatch', () => likeCommentsBatch(request.list))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 🛰 新消息监听·哨兵：只看不滚的一次轻窥（后台闹钟每 30s 问一次） ──
    if (request.action === 'watchPeek') {
      try { sendResponse(watchPeek()); } catch (e) { sendResponse({ success: false, error: e.message }); }
      return true;
    }
    // ── 评论跟进：通知页（https://www.xiaohongshu.com/notification）提取通知流 ──
    if (request.action === 'extractNotifications') {
      runExclusive('extractNotifications', () => extractNotifications())
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客：收集"赞了我们内容/评论"的人（点赞页通知 → 全部进获客清单） ──
    if (request.action === 'collectLikers') {
      runExclusive('collectLikers', () => collectLikers(request))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客·消息台：读取消息中心(/chat)会话列表 ──
    if (request.action === 'collectChatConversations') {
      runExclusive('collectChatConversations', () => collectChatConversations(request))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客·消息台：在 /chat 会话页发送消息 ──
    if (request.action === 'chatSendMessage') {
      runExclusive('chatSendMessage', () => chatSendMessage(request.text || ''))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客：手工逐条归因——读当前 /chat 会话线程，判断对方是否回过你 ──
    if (request.action === 'scanChatConversation') {
      runExclusive('scanChatConversation', () => scanChatConversation())
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 评论跟进：通知页回复指定通知（三重定位保障，见 replyNotification 实现） ──
    if (request.action === 'replyNotification') {
      _interactGuard(request.replyText, 'notif', (request.userName || '通知回访')).then(g => {
        if (!g.ok) { sendResponse({ success: false, blocked: true, error: g.error }); return; }
        runExclusive('replyNotification', () => replyNotification(request))
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ success: false, error: e.message }));
      });
      return true;
    }
    // ── 获客清单：私信（打开用户主页 → 点私信 → 发送） ──
    if (request.action === 'sendUserDm') {
      _interactGuard(request.text, 'dm', request.userLink).then(g => {
        if (!g.ok) { sendResponse({ success: false, blocked: true, error: g.error }); return; }
        runExclusive('sendUserDm', () => sendUserDm(request.userLink, request.text))
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ success: false, error: e.message }));
      });
      return true;
    }
    // ── 获客清单：只打开私信聊天窗（不发送），用于验证"点私信按钮"一步 ──
    if (request.action === 'openDmChat') {
      runExclusive('openDmChat', () => openDmChat(request.userLink))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客清单：发私信（Step2，前提是已在用户主页，不再导航） ──
    if (request.action === 'sendDmOnProfile') {
      _interactGuard(request.text, 'dm', request.userLink).then(g => {
        if (!g.ok) { sendResponse({ success: false, blocked: true, error: g.error }); return; }
        runExclusive('sendDmOnProfile', () => sendDmOnProfile(request.userLink, request.text))
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ success: false, error: e.message }));
      });
      return true;
    }
    // ── 获客清单：现场定位私信按钮并高亮，告知用户找到了哪个按钮 ──
    if (request.action === 'locateDmButton') {
      try { sendResponse(locateDmButton()); } catch (e) { sendResponse({ found: false, error: e.message }); }
      return true;
    }
    // ── 获客清单：在已打开的聊天窗口输入并发送（不导航、不要求主页） ──
    if (request.action === 'sendDmToOpenChat') {
      _interactGuard(request.text, 'dm', request.userLink).then(g => {
        if (!g.ok) { sendResponse({ success: false, blocked: true, error: g.error }); return; }
        runExclusive('sendDmToOpenChat', () => sendDmToOpenChat(request.userLink, request.text))
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ success: false, error: e.message }));
      });
      return true;
    }
    // ── 获客清单：定位用户（A方案：在当前已登录 tab 内直达用户主页） ──
    if (request.action === 'openUserProfile') {
      try {
        const target = absUserUrl(request.userLink || request.url || '');
        if (!target) {
          sendResponse({ ok: false, error: '缺少用户主页链接，无法打开' });
          return true;
        }
        if (!isOnUserProfile(target)) {
          _showStatus('正在打开用户主页...');
          location.href = target;
        } else {
          _showStatus('已在目标用户主页');
        }
        sendResponse({ ok: true, navigating: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
    // ── 账号绑定：抓取用户主页的公开小红书号 + 主页昵称 ──
    if (request.action === 'extractUserProfile') {
      sendResponse(extractUserProfile());
      return true;
    }
    // ── 账号绑定：在（本）人主页读取并校验小红书号 ──
    if (request.action === 'verifyOwnProfile') {
      _verifyOwnProfile().then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    // ── 首条私信前置甄别：抓"来访者"主页的简介 + 笔记（只读），供 AI 判购买意向 ──
    if (request.action === 'extractGuestProfile') {
      extractGuestProfile().then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    // ── 账号诊断：在本人「我的」主页抓取完整资料（简介/头像/统计/笔记），只读 ──
    if (request.action === 'extractOwnProfile') {
      try {
        if (!_isSelfProfile()) {
          sendResponse({ ok: false, needOwnProfile: true, reason: '当前不在本人「我的」主页' });
          return true;
        }
        const profile = extractProfileFull();
        if (profile && profile.xhsId) profile.user_id = profile.xhsId;
        sendResponse({ ok: true, profile });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
    // ── 账号诊断：返回本人主页可访问的链接（供后台自动打开） ──
    if (request.action === 'getOwnProfileUrl') {
      try {
        let url = '';
        if (_isSelfProfile()) url = location.href.split('#')[0];
        else if (_isProfileUrl()) url = location.href.split('#')[0].split('?')[0];
        else {
          // 顶栏头像即本人主页入口链接
          const link = document.querySelector('a[href*="/user/profile/"]');
          if (link) url = link.href;
        }
        if (!url) {
          try {
            const u = localStorage.getItem('xhsu');
            if (u) { const o = JSON.parse(u); if (o && o.id) url = 'https://www.xiaohongshu.com/user/profile/' + o.id; }
          } catch (_) {}
        }
        sendResponse({ ok: !!url, url });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
    if (request.action === 'extractSearchResults') {
      sendResponse(extractSearchResults());
      return true;
    }
    // ── 一键灌水：驱动搜索页排序（排序由搜索动作清单自带；范围筛选已下线，不再勾「未看过」） ──
    if (request.action === 'applySearchFilter') {
      applySearchFilter(request.sortKey || '')
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    // ── 截流活水：查我的评论在评论区的位置/点赞 ──
    if (request.action === 'extractMyComment') {
      extractMyComment(request.names || [])
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (request.action === 'scrollLoadMore') {
      scrollLoadMore()
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 一键灌水：搜索页诊断 ──
    if (request.action === 'diagnoseSearchPage') {
      const exploreLinks = document.querySelectorAll('a[href*="/explore/"]');
      const noteLinks = document.querySelectorAll('a[href*="/note/"]');
      const allLinks = document.querySelectorAll('a[href*="/explore/"], a[href*="/note/"]');
      const sections = document.querySelectorAll('section');
      const feeds = document.querySelectorAll('[class*="feed"], [class*="note"], [class*="search"], [class*="result"]');
      sendResponse({
        url: window.location.href,
        exploreLinkCount: exploreLinks.length,
        noteLinkCount: noteLinks.length,
        totalNoteLinks: allLinks.length,
        sectionCount: sections.length,
        feedElementCount: feeds.length,
        bodyTextLen: (document.body.textContent || '').length,
        readyState: document.readyState,
        sampleLinks: Array.from(allLinks).slice(0, 5).map(a => a.href),
      });
      return true;
    }
    // ── 一键灌水：检查搜索页是否已渲染出笔记链接 ──
    if (request.action === 'checkSearchReady') {
      const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]');
      sendResponse({ ready: links.length > 0, count: links.length });
      return true;
    }
    // ── 检查笔记详情页是否已就绪（有评论区/回复框，且不是满屏卡片的过渡态） ──
    // 供打开笔记后轮询用：就绪了再抓，避免抓到 SPA 切换中的列表/卡片过渡内容
    if (request.action === 'checkNoteReady') {
      const cardLinkCount = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"]').length;
      const hasReplyInput = !!findBottomReplyInput();
      const hasScroller = !!getNoteScroller();
      // 就绪条件：出现回复框或评论区滚动容器；且不是“满屏卡片却无评论区”的过渡态
      const ready = (hasReplyInput || hasScroller) && !(cardLinkCount >= 3 && !hasReplyInput && !hasScroller);
      sendResponse({ ready, hasReplyInput, hasScroller, cardLinkCount });
      return true;
    }
    // ── 一键灌水：通过搜索框输入关键词（模拟真实用户搜索，SPA内部路由） ──
    if (request.action === 'searchViaInput') {
      searchViaInput(request.keyword).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 🌿 日常浏览：在信息流/搜索结果里自动浏览一轮（滚动/停留/可点赞收藏） ──
    if (request.action === 'browseRound') {
      runExclusive('🌿 日常浏览', () => browseRound(request.opts || {}))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
      return true;
    }
    // ── 一键灌水：查找笔记链接并返回坐标（供 CDP 可信点击） ──
    if (request.action === 'findNoteLink') {
      sendResponse(findNoteLinkCoords(request.title, request.noteId, request.searchIndex, request.rawLinkIndex));
      return true;
    }
    // ── 一键灌水：在搜索页点击笔记链接 ──
    if (request.action === 'clickNoteLink') {
      sendResponse(clickNoteLink(request.title, request.noteId, request.rawLinkIndex));
      return true;
    }
    // ── 打开笔记（稳健通路）：当前页没这张卡片时，搜「笔记名」→ 匹配作者名 → 再点开 ──
    if (request.action === 'openNoteBySearch') {
      openNoteBySearch(request).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
      return true;
    }
    // ── 发一条「对笔记本身的一级评论」（抢位/本地/活水 都用它，不点任何「回复」按钮） ──
    if (request.action === 'sendNoteComment') {
      _interactGuard(request.text, 'comment', '笔记评论').then(g => {
        if (!g.ok) { sendResponse({ success: false, blocked: true, error: g.error }); return; }
        runExclusive('✍️ 一级评论', () => sendNoteComment(request))
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ success: false, error: (e && e.message) || String(e) }));
      });
      return true;
    }
    // ── 一键灌水：高亮定位笔记（调试用） ──
    if (request.action === 'highlightNote') {
      highlightNote(request.title, request.noteId, request.searchIndex, request.rawLinkIndex).then(sendResponse);
      return true;
    }
    // ── 调试：列出页面所有 a[href*="/explore/"] 原始元素 ──
    if (request.action === 'debugListElements') {
      sendResponse(debugListElements());
      return true;
    }
    // ── 调试：高亮第 N 个原始元素 ──
    if (request.action === 'debugHighlightElement') {
      sendResponse(debugHighlightElement(request.index));
      return true;
    }
    // ── 定位笔记（优先按标题文字搜索，最可靠） ──
    if (request.action === 'locateNote') {
      // 有标题就用文字搜索（已验证最可靠）
      if (request.title) {
        const titleResult = locateNoteByTitle(request.title);
        if (titleResult) {
          const el = titleResult.element;
          const href = el.getAttribute('href') || '';
          const allLinks = document.querySelectorAll('a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sendResponse({ found: true, method: 'title_' + titleResult.method, actualHref: href });
          return true;
        }
      }
      // 无标题 / 文字搜索失败：试 rawLinkIndex
      const idx = request.rawLinkIndex;
      if (idx !== undefined && idx >= 0) {
        const linkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';
        const links = document.querySelectorAll(linkSelector);
        const el = links[idx];
        if (el) {
          const href = el.getAttribute('href') || '';
          debugHighlightElement(idx);
          sendResponse({ found: true, method: 'rawLinkIndex', actualHref: href });
          return true;
        }
      }
      sendResponse({ found: false, title: request.title });
      return true;
    }
    // ── CTRL+F 式按标题文字搜索定位 ──
    if (request.action === 'locateByTitle') {
      const result = locateNoteByTitle(request.title);
      if (result) {
        const el = result.element;
        const href = el.getAttribute('href') || '';
        // 高亮它
        const allLinks = document.querySelectorAll('a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]');
        const rawIdx = Array.from(allLinks).indexOf(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sendResponse({ found: true, method: result.method, score: result.score, actualHref: href, rawLinkIndex: rawIdx });
      } else {
        sendResponse({ found: false, title: request.title });
      }
      return true;
    }
    // ── 返回搜索结果页 ──
    // ★ 优先 SPA 后退：保留的搜索列表 DOM 仍可用于立即定位下一篇笔记；
    //   只有无法后退时才直接导航（极少见）。首页兜底由 bot 在 _goBackToList 里判断 URL 后处理
    if (request.action === 'goBack') {
      if (/\/search_result/.test(location.pathname)) {
        sendResponse({ success: true, alreadySearch: true });
        return true;
      }
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '/search_result';
      }
      sendResponse({ success: true });
      return true;
    }
    // 统计当前搜索页笔记卡片数量（供 bot 确认返回后搜索列表是否已渲染，避免在空页上开笔记）
    if (request.action === 'countSearchNotes') {
      try {
        const links = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/note/"]');
        sendResponse({ count: links.length, ready: links.length > 0 });
      } catch (_) { sendResponse({ count: 0, ready: false }); }
      return true;
    }
    return true;
  });

  // ============================
  // 页面数据提取
  // ============================
  // ============================
  // 挖掘商机前：滚动评论区多加载几屏评论 + 展开更多回复
  // 小红书评论区是懒加载，不滚动只有开头几条；这里滚到底若干轮，尽量把评论加载更全，让 AI 读到更多评论
  // ============================
  async function loadMoreComments(maxRounds) {
    const rounds = Math.max(1, maxRounds || 3);
    // ★ 滚动前先验证是笔记内页：搜“评论”二字。内页必有“共 N 条评论”标记，外页没有 → 外页直接跳过滚动（不滚背景）
    const marker = findCommentMarker();
    if (!marker.found) {
      _showStatus('⚠️ 页面没有“评论”标记，判定为外页/信息流，跳过滚动加载');
      return { success: false, notNotePage: true, reason: 'no_comment_marker' };
    }
    const countComments = () => document.querySelectorAll('a[href*="/user/"]').length;
    let last = countComments();
    let stable = 0;
    for (let i = 0; i < rounds; i++) {
      _showStatus(`📜 正在多翻页、加载更多评论（第 ${i + 1}/${rounds} 轮，已加载约 ${last} 条）`);
      // 1. 先点开页面上的"展开更多回复 / 查看更多"按钮，把楼中楼回复也展开
      //    ★ 别再遍历整页每个 div/span/button/a 并逐节点 offsetParent+textContent：
      //      小红书页面上万节点时这趟会强制走布局、把 content.js 主线程拖到不响应（结果=刷新评论卡死）。
      //      改为：同款广谱选择器，但加①数量上限②跳过大型容器（children 多的大区块，几乎不可能是展开按钮）③只读短文本——又快又不丢覆盖率。
      try {
        const NODES = document.querySelectorAll('div, span, button, a');
        let clicked = 0;
        const CAP = 25;                                   // ★ 节奏控制：单轮展开连点上限 40→25，避免机械连点
        for (let _n = 0; _n < NODES.length && clicked < CAP; _n++) {
          const b = NODES[_n];
          if (b.offsetParent === null) continue;
          if (b.children.length > 8) continue;   // 大型容器直接跳过，省掉昂贵的 textContent 读取
          let t = '';
          try { t = b.textContent.trim(); } catch (_) { continue; }
          if (t.length >= 2 && t.length <= 14 && /展开|查看更多|更多回复|条回复|展开更多/.test(t) && !/收起/.test(t)) {
            try { b.click(); } catch (_) {}
            clicked++;
            // ★ 节奏控制：每次展开随机停顿 300-850ms（去掉机械的 200ms 连点节拍），
            //   每连点 4 次再插一段更长的“人思考”停顿 1.2-2.4s
            await sleep(300 + Math.random() * 550);
            if (clicked % 4 === 0) await sleep(1200 + Math.random() * 1200);
          }
        }
      } catch (_) {}
      // 2. ★【方案B：平滑滚动三屏】不再“瞬移到底”，改为每次平滑下滚约一屏高度，连滚 rounds 次，更自然、DOM 更安静
      const scroller = scrollableAncestorOf(marker.element) || getNoteScroller();
      const step = (scroller && (scroller.clientHeight || scroller.innerHeight)) || window.innerHeight || 800;
      if (scroller && typeof scroller.scrollBy === 'function') {
        scroller.scrollBy({ top: step, behavior: 'smooth' });
      } else {
        scrollNoteBy(step);
      }
      await sleepWithCountdown(dwellMs('lazyLoadWait', 900), `📜 第 ${i + 1} 轮：平滑下滚一屏，等评论懒加载`);
      const now = countComments();
      if (now <= last) {
        stable++;
        if (stable >= 2) break; // 连续两轮无新增 → 已到底
      } else {
        stable = 0;
      }
      last = now;
    }
    // 滚回顶部，避免停在最底部影响后续定位
    _showStatus('📜 评论加载完毕，滚回顶部…');
    try {
      const scroller = scrollableAncestorOf(marker.element) || getNoteScroller();
      if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {}
    // ★ 等平滑滚动真正结束、DOM 稳定后才返回——popup 收到本响应后才会发起提取，保证“滚完才采集”
    await sleep(600);
    return { success: true, commentCount: countComments() };
  }

  function extractPageData() {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const authorMeta = document.querySelector('meta[name="author"]');
    const title = ogTitle?.content || document.title.replace(/ - 小红书.*$/, '').trim() || '';
    const description = ogDesc?.content || '';
    const author = authorMeta?.content || '';
    const url = window.location.href;
    // 🏷 话题采集：标题 + 正文（og:description）里的 #话题，供关键词列表「采集话题」取用
    const tags = pickHashTags((title || '') + ' ' + (description || ''), 12);

    // ★ 记住本篇笔记的标题/正文，供 parseCommentItem 过滤（避免把笔记标题当成评论拓下来）
    _noteTitleText = title || '';
    _noteDescText = description || '';

    // 提取所有候选评论集
    const allCandidates = findAllCandidates();
    const best = allCandidates[0] || { comments: [] };
    const threads = extractThreads(best.comments || []);

    // ★ 页面类型守卫：判断当前是不是“笔记详情页”。
    // 列表/搜索页特征：满屏笔记卡片（/explore//search_result/ 链接）而评论极少。
    // 详情页特征：有评论区滚动容器或底部回复输入框。
    const cardLinkCount = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"]').length;
    const hasReplyInput = !!findBottomReplyInput();
    const hasScroller = !!getNoteScroller();
    const commentCount = (best.comments || []).length;
    // 卡片很多、又既无回复框也无有效评论 → 判为非详情页
    const notNotePage = cardLinkCount >= 3 && !hasReplyInput && !hasScroller && commentCount < 2;

    return {
      title, description, author, url,
      tags,
      comments: best.comments || [],
      threads,
      _candidates: allCandidates,
      _notNotePage: notNotePage,
      _cardLinkCount: cardLinkCount,
    };
  }

  // ============================
  // 单条评论解析
  // ============================
  // ★ 本篇笔记的标题/正文（由 extractPageData 写入），用于排除把笔记本体误当成评论
  var _noteTitleText = '';
  var _noteDescText = '';
  // 判断一段内容是不是笔记标题/正文（而非真正的评论）
  function _isNoteTitleOrDesc(content) {
    const c = _normName(content || '');
    if (!c) return false;
    const t = _normName(_noteTitleText || '');
    const d = _normName(_noteDescText || '');
    // 与标题完全一致，或互为前缀（长度足够）→ 判为标题
    if (t && (c === t || (c.length >= 6 && (t.startsWith(c) || c.startsWith(t))))) return true;
    // 评论内容恰好是正文的开头一大段 → 判为笔记正文
    if (d && c.length >= 10 && (d.startsWith(c) || d === c)) return true;
    return false;
  }

  // 评论区「属地」词表（省/直辖市/自治区 + 港澳台 + 常见国家）：属地是固定枚举，用它兜底判定，
  // 避免把评论正文里的普通词误当属地
  const _REGION_RE = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|中国香港|中国澳门|中国台湾|香港|澳门|日本|美国|韩国|泰国|新加坡|马来西亚|印度尼西亚|菲律宾|越南|柬埔寨|缅甸|印度|巴基斯坦|阿联酋|沙特|以色列|土耳其|俄罗斯|乌克兰|英国|法国|德国|意大利|西班牙|葡萄牙|荷兰|比利时|瑞士|奥地利|瑞典|挪威|丹麦|芬兰|波兰|希腊|匈牙利|捷克|爱尔兰|冰岛|加拿大|墨西哥|巴西|阿根廷|智利|秘鲁|澳大利亚|新西兰|南非|埃及|摩洛哥|肯尼亚|尼日利亚)$/;
  const _isRegionWord = (s) => _REGION_RE.test(String(s || '').replace(/\s+/g, ''));

  /** 单条评论的属地（如「福建」）。
   *  小红书评论区固定把属地与时间同排渲染（.info .date > span.date + span.location）；
   *  这里以标准结构为主，另备结构兜底（找时间元素，取其后紧邻的短地域词），不依赖哈希 class。
   */
  function _pickCommentLocation(el) {
    const _t = (n) => (n ? String(n.textContent || '').replace(/\s+/g, ' ').trim() : '');
    try {
      // 1) 标准结构：location 元素
      const locEl = el.querySelector('.date .location, .info .location, [class*="location"]');
      if (locEl) {
        const s = _t(locEl);
        if (s && s.length <= 12 && !/\d/.test(s)) return s;
      }
      // 2) 结构兜底：定位时间元素 → 看紧邻兄弟 / 同元素内「时间 属地」的写法
      const nodes = el.querySelectorAll('span, div, p');
      for (const n of nodes) {
        if (n.children.length) continue;
        const s = _t(n);
        if (!s || s.length > 20) continue;
        if (!/^(\d+[秒分钟小时天周月年]前|昨天|今天|刚刚|\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|编辑于)/.test(s)) continue;
        let sib = n.nextElementSibling;
        for (let k = 0; k < 3 && sib; k++, sib = sib.nextElementSibling) {
          const st = _t(sib);
          if (st && st.length <= 12 && _isRegionWord(st)) return st;
        }
        const m = s.match(/(?:前|刚刚|昨天|今天)\s+([\u4e00-\u9fa5]{2,10})$/);
        if (m && _isRegionWord(m[1])) return m[1];
      }
    } catch (_) {}
    return '';
  }

  function parseCommentItem(el) {
    const text = el.textContent.trim();
    if (!text || text.length < 1) return null;
    if (isLegalOrGibberish(text)) return null;

    // ★ 排除“笔记卡片”被误当成评论：真实评论只含 /user/ 链接；
    // 而列表/搜索页的笔记卡片含跳转到其它笔记的链接（explore/note/search_result）
    if (el.querySelector('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/discovery/item/"]')) {
      return null;
    }

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
    if (_isNoteTitleOrDesc(content)) return null; // ★ 排除笔记标题/正文被误当成评论

    // ★ 属地（IP 显示的地区，如「福建」）：随评论一起带给 AI，供「同城」判定用
    const location = _pickCommentLocation(el);

    return { author: authorName || '用户', content, replyTo, userLink, location };
  }

  // ============================
  // 多候选评论提取
  // ============================

  // ★★ 用 CTRL+F 把“抓取范围”锁死在笔记浮层的评论区。
  //   根因：自动灌水是用 SPA 点击从搜索结果页进入，笔记以浮层弹窗盖在搜索网格上，
  //   背景搜索网格的 DOM 没销毁、仍在文档里，每张卡片都带一个作者 /user/ 链接，
  //   链接数会碾压真评论区，导致 findAllCandidates 按“链接最多”选到背景网格。
  //   对策：用 window.find 定位“条评论”这个锚点文字（只存在于浮层评论区标题，背景网格没有），
  //   从锚点向上圈出评论区容器，后续只在它内部扫描。
  function getCommentScopeRoot() {
    try {
      _resetFindCursorToTop();
      // 小红书评论区标题常为“共 128 条评论”/“128 条评论”，背景搜索网格不会出现这串
      if (window.find('条评论', false, false, false, false, true)) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const node = sel.getRangeAt(0).startContainer;
          let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
          // 从“条评论”锚点向上找“足够大、包住评论列表”的容器；
          // 一旦容器高度足够大且含多个 /user/ 链接，就认为到了评论区容器，
          // 但绝不爬到 body（否则又把背景网格圈进来）。
          let root = el;
          for (let d = 0; d < 12 && root && root.parentElement && root !== document.body; d++) {
            const r = root.getBoundingClientRect();
            if (r.height > window.innerHeight * 0.4 &&
                root.querySelectorAll('a[href*="/user/"]').length >= 2) {
              break;
            }
            root = root.parentElement;
          }
          try { sel.removeAllRanges(); } catch (_) {}
          if (root && root !== document.body && root !== document.documentElement) {
            console.log('[范围锁定] ✅ CTRL+F 锚定评论区容器:', root.tagName, (root.className || '').slice(0, 40));
            return root;
          }
        }
      }
    } catch (e) {
      console.warn('[范围锁定] CTRL+F 锚点异常，回退到浮层滚动容器:', e);
    }
    // 回退：笔记浮层内部滚动容器（也能排除背景网格）
    const scroller = getNoteScroller();
    if (scroller) {
      console.log('[范围锁定] ↩ 回退到浮层滚动容器');
      return scroller;
    }
    // 都没有 → 返回 null，由调用方决定是否扫全文档
    return null;
  }

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

    // ---- ★ 先用 CTRL+F 锁定笔记浮层评论区（背景搜索网格在范围外，天然排除）----
    const scopeRoot = getCommentScopeRoot();
    const scanRoot = scopeRoot || document; // 锁不到时才回退扫全文档（保底）

    // ---- 扫描范围内所有 div，收集候选容器 ----
    const containers = [];
    for (const el of scanRoot.querySelectorAll('div')) {
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

    // ---- 后备：用户链接逐项遍历（同样锁在 scanRoot 内）----
    if (candidates.length === 0) {
      const userLinks = scanRoot.querySelectorAll('a[href*="/user/"]');
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
          if (content.length > 2 && content.length < 500 && !isLegalOrGibberish(content) && !_isNoteTitleOrDesc(content)) {
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

    // ---- 后备：暴力扫描（同样锁在 scanRoot 内）----
    if (candidates.length === 0) {
      let bestContainer = null, bestCount = 0;
      for (const div of scanRoot.querySelectorAll('div[class]')) {
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

    // ★ 安全网：若锁定范围内一条都没抓到（可能锚点选偏/评论区结构特殊），
    //   回退到全文档再扫一遍，确保范围锁定绝不会“反而抓不到评论”。
    if (candidates.length === 0 && scanRoot !== document) {
      console.warn('[范围锁定] ⚠ 锁定范围内未抓到评论，回退全文档重扫');
      const docContainers = [];
      for (const el of document.querySelectorAll('div')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 60) continue;
        if (rect.left < -10 || rect.top < -50) continue;
        const cnt = el.querySelectorAll('a[href*="/user/"]').length;
        if (cnt >= 2) docContainers.push({ el, cnt, left: rect.left, w: rect.width, h: rect.height });
      }
      docContainers.sort((a, b) => b.cnt - a.cnt);
      const docUnique = [];
      for (const c of docContainers) {
        let nested = false;
        for (const u of docUnique) { if (u.el.contains(c.el)) { nested = true; break; } }
        if (!nested) docUnique.push(c);
      }
      let cnt2 = 0;
      for (const c of docUnique) {
        if (cnt2 >= 5) break;
        const items = extractFrom(c.el);
        if (items.length > 0) {
          const side = c.left > PAGE_W * 0.25 ? '右侧' : '左侧';
          candidates.push({
            label: `候选${cnt2 + 1} (${side})`,
            desc: `${c.w.toFixed(0)}x${c.h.toFixed(0)} | ${c.cnt}个用户链接 | ${items.length}条`,
            comments: items,
          });
          cnt2++;
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
    // 从用户主页链接提取 uid：只用于同文撞车时挑选 + 兜底手段。
    let uid = '';
    if (userLink && userLink.includes('/user/')) {
      uid = userLink.split('/user/')[1]?.split(/[?#]/)[0] || '';
    }

    // ★ 策略0（最高优先）：评论原文 CTRL+F 直接查找，最多试 3 次。
    //   AI 返回的 original_text 本来就是从本页抓下来的原文，搜到即命中，不需要打分。
    //   第1次用完整原文；没搜到就删掉最后 1 个字符再搜；仍没有就再删 1 个（共删 2 个）——
    //   专治尾部表情/特殊符号导致搜不到。都失败才落到下面的兜底链。
    const fullText = (originalText || '').trim();
    for (let attempt = 0; attempt < 3; attempt++) {
      const q = attempt === 0 ? fullText : fullText.slice(0, -attempt);
      if (!q || q.length < 2) break;
      const matches = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        if (!node.textContent.includes(q)) continue;
        const el = node.parentElement;
        if (!el) continue;
        // 跳过笔记标题/正文的命中（防正文引用了评论原文时误中）
        if (_isNoteTitleOrDesc(el.textContent.trim())) continue;
        matches.push(el);
      }
      if (matches.length === 1) {
        console.log('[定位评论] ✅ CTRL+F 第' + (attempt + 1) + '次唯一命中');
        return matches[0];
      }
      if (matches.length > 1) {
        // 同文撞车（多人刷同一句/重复文案）：挑容器里带目标作者主页链接的那条，没有就取第一条
        if (uid) {
          for (const el of matches) {
            let holder = el;
            for (let d = 0; d < 4 && holder && holder !== document.body; d++) {
              if (holder.querySelector('a[href*="/user/' + uid + '"]')) {
                console.log('[定位评论] ✅ CTRL+F 命中' + matches.length + '处，按作者链接选中');
                return el;
              }
              holder = holder.parentElement;
            }
          }
        }
        console.log('[定位评论] ⚠ CTRL+F 命中' + matches.length + '处，取第一处');
        return matches[0];
      }
      console.log('[定位评论] CTRL+F 第' + (attempt + 1) + '次未命中，尾部再删 1 字重试');
    }

    // ──── 以下全部是兜底（CTRL+F 3 次都没搜到才走到这） ────

    // 兜底1：前 60 字模糊匹配 + 多维打分（评论被折叠/截断、文本节点被拆分时用）
    const searchText = (originalText || '').trim().slice(0, 60);
    if (searchText) {
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
        // ★ 包含用户链接 → 大概率是评论（非笔记正文）
        if (el.querySelector('a[href*="/user/"]')) score += 120;
        // ★ 本元素或近邻容器里有目标作者的主页链接 → 强加分（专治相同文案的排歧）
        if (uid) {
          let holder = el;
          for (let d = 0; d < 4 && holder && holder !== document.body; d++) {
            if (holder.querySelector('a[href*="/user/' + uid + '"]')) { score += 150; break; }
            holder = holder.parentElement;
          }
        }
        // ★ 太长（>500字）→ 可能是笔记正文/长文，大幅扣分
        if (elText.length > 500) score -= 300;
        // ★ 位置偏下（>300px）→ 评论区可能性更大
        const r = el.getBoundingClientRect();
        if (r.top > 300) score += 40;
        let depth = 0, p = el;
        while (p.parentElement) { depth++; p = p.parentElement; }
        score += depth;
        if (score > bestScore) { bestScore = score; bestMatch = el; }
      }
      if (bestMatch) return bestMatch;
    }

    // 兜底2：通过用户主页链接定位。
    // 注意：同一用户发多条评论时此法只能命中第一条，所以排在原文匹配之后。
    if (userLink) {
      // ★ 多种方式匹配用户链接，兼容绝对/相对路径差异
      let linkEl = document.querySelector(`a[href="${userLink}"]`);
      if (!linkEl) {
        // 去掉域名部分尝试匹配相对路径
        const pathOnly = userLink.replace(/^https?:\/\/[^\/]+/, '');
        linkEl = document.querySelector(`a[href="${pathOnly}"], a[href*="${pathOnly}"]`);
      }
      if (!linkEl && uid) {
        // 提取用户ID尝试模糊匹配
        linkEl = document.querySelector(`a[href*="/user/${uid}"]`);
      }
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

  /* ── 状态叠加层（让用户看到当前操作进度）── 大号、置顶、带闪烁+读秒+缩短日志 */
  let _statusEl = null, _statusTitleEl = null, _statusLogEl = null, _statusSecEl = null;
  let _statusStartTs = 0, _statusTimer = null;
  const _statusLogLines = [];
  // 广播当前动作文字到 popup 遮罩（锁定时用户在遮罩里也能看到“目前在干啥”）
  function _broadcastStatus(text) {
    try {
      chrome.runtime.sendMessage({ action: 'statusUpdate', text: text || '' });
    } catch (_) {}
  }
  // 注入闪烁/呼吸光动画（只注一次）
  function _ensureStatusStyle() {
    if (document.getElementById('__xhs_status_style')) return;
    const st = document.createElement('style');
    st.id = '__xhs_status_style';
    st.textContent = '@keyframes __xhsBlink{0%,100%{opacity:1}50%{opacity:.2}}@keyframes __xhsGlow{0%,100%{box-shadow:0 6px 22px rgba(0,0,0,.35),0 0 0 0 rgba(255,45,85,.55)}50%{box-shadow:0 6px 22px rgba(0,0,0,.35),0 0 20px 5px rgba(255,45,85,.8)}}';
    (document.head || document.documentElement).appendChild(st);
  }
  function _showStatus(text) {
    _broadcastStatus(text); // ★ 同步告诉 popup 遮罩当前在做什么
    try {
      _ensureStatusStyle();
      if (!_statusEl) {
        _statusEl = document.createElement('div');
        _statusEl.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;background:linear-gradient(135deg,#ff2d55,#ff5b7f);color:#fff;padding:14px 22px;border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:none;transition:opacity .3s;max-width:82vw;min-width:320px;text-align:left;animation:__xhsGlow 1.4s ease-in-out infinite;';
        // 标题行：闪烁圆点 + 当前动作 + 读秒
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800;line-height:1.3;';
        const dot = document.createElement('span');
        dot.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#fff;flex:0 0 auto;animation:__xhsBlink .8s ease-in-out infinite;';
        _statusTitleEl = document.createElement('span');
        _statusTitleEl.style.cssText = 'flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        _statusSecEl = document.createElement('span');
        _statusSecEl.style.cssText = 'flex:0 0 auto;font-size:14px;font-weight:700;background:rgba(0,0,0,.28);padding:2px 10px;border-radius:10px;white-space:nowrap;';
        _statusSecEl.textContent = '⏱ 0s';
        header.appendChild(dot);
        header.appendChild(_statusTitleEl);
        header.appendChild(_statusSecEl);
        // 缩短日志区：最近几条动作
        _statusLogEl = document.createElement('div');
        _statusLogEl.style.cssText = 'margin-top:8px;font-size:12px;line-height:1.7;color:rgba(255,255,255,.92);border-top:1px solid rgba(255,255,255,.28);padding-top:6px;max-height:92px;overflow:hidden;';
        _statusEl.appendChild(header);
        _statusEl.appendChild(_statusLogEl);
        document.body.appendChild(_statusEl);
      }
      // 读秒计时器（首次显示或上次被 _hideStatus 清掉后重启）
      if (!_statusTimer) {
        _statusStartTs = Date.now();
        _statusTimer = setInterval(() => {
          if (!_statusSecEl) return;
          const sec = Math.floor((Date.now() - _statusStartTs) / 1000);
          _statusSecEl.textContent = '⏱ ' + sec + 's';
        }, 500);
      }
      if (_statusTitleEl) _statusTitleEl.textContent = text || '';
      // 追加缩短日志（连续相同不重复），保留最近 3 条历史
      if (text && _statusLogLines[_statusLogLines.length - 1] !== text) {
        _statusLogLines.push(text);
        while (_statusLogLines.length > 4) _statusLogLines.shift();
        if (_statusLogEl) {
          _statusLogEl.innerHTML = '';
          _statusLogLines.slice(0, -1).forEach(line => {
            const d = document.createElement('div');
            d.textContent = '· ' + line;
            _statusLogEl.appendChild(d);
          });
          _statusLogEl.style.display = _statusLogLines.length > 1 ? 'block' : 'none';
        }
      }
      _statusEl.style.opacity = '1';
    } catch (_) {}
  }
  function _hideStatus() {
    try {
      // 停读秒（操作已结束，不再计时）
      if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
      _statusStartTs = 0;
      _statusLogLines.length = 0;
      // ★ 不直接隐藏，而是切到“等待用户操作”的平静态（绿底、不闪烁）
      if (_statusEl) {
        _statusEl.style.background = 'linear-gradient(135deg,#34c759,#30b350)';
        _statusEl.style.animation = 'none';
        if (_statusSecEl) { _statusSecEl.textContent = '✓ 完成'; }
        if (_statusTitleEl) { _statusTitleEl.textContent = '✅ 已完成，等待用户操作'; }
        if (_statusLogEl) { _statusLogEl.innerHTML = ''; _statusLogEl.style.display = 'none'; }
        _statusEl.style.opacity = '1';
      }
      _broadcastStatus('已完成，等待用户操作');
    } catch (_) {}
  }

  // 带读秒的等待：每秒把“还剩几秒”广播给 popup，让用户知道正在等待而非卡死
  //   prefix 例：“等待回复框” → 显示“等待回复框…还剩 3 秒”
  async function sleepWithCountdown(ms, prefix) {
    let remain = Math.ceil(ms / 1000);
    while (remain > 0) {
      _showStatus(`${prefix}…还剩 ${remain} 秒`);
      const step = Math.min(1000, ms);
      await sleep(step);
      ms -= step;
      remain = Math.ceil(ms / 1000);
    }
  }

  /* ── 把 Ctrl+F(window.find) 的搜索光标显式归到文档最开头 ──
     window.find 从当前选区末尾往后搜；SPA 页面上一次操作的选区/焦点会残留，
     导致第二条从错误位置开始找。光 removeAllRanges 有时不够，这里显式把选区
     折叠到 document.body 的最开头，保证每次 find 都从头开始扫。 */
  function _resetFindCursorToTop() {
    try {
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      const range = document.createRange();
      // 选中整个 body 后折叠到起点——等价于把光标放到文档最顶部
      range.selectNodeContents(document.body);
      range.collapse(true);
      sel.addRange(range);
    } catch (_) {
      // 降级：至少把旧选区清掉
      try { window.getSelection()?.removeAllRanges(); } catch (__) {}
    }
  }

  /* ── 文本流定位回复按钮（window.find + elementFromPoint 视觉定位） ── */
  function findReplyByTextFlow(originalText) {
    if (!originalText) return null;
    const searchText = originalText.slice(0, 80).trim();
    if (searchText.length < 3) return null;
    try {
      _resetFindCursorToTop();
      // 1. 先定位目标评论正文（不用 wrapAround，避免 SPA 残留旧文字干扰）
      if (!window.find(searchText, false, false, false, false, true)) return null;
      // 2. 往后找"回复"，跳过内嵌在长文本里的
      for (let i = 0; i < 30; i++) {
        if (!window.find('回复', false, false, false, false, true)) return null;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const textNode = sel.getRangeAt(0).startContainer;
        const el = textNode.nodeType === Node.TEXT_NODE ? textNode.parentElement : textNode;
        if (!el || el === document.body) continue;
        const t = el.textContent.trim();
        if (t !== '回复' && t !== 'Reply') continue;

        // ===== 方案一：elementFromPoint 视觉定位 =====
        // 直接找该位置实际渲染的最深层元素，避开 offsetParent/DOM 层级问题
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const pointEl = document.elementFromPoint(cx, cy);
          if (pointEl && pointEl !== document.documentElement && pointEl !== document.body) {
            console.log('[文本流定位] ✅ elementFromPoint 命中:', pointEl.tagName, pointEl.className);
            // 上溯找可点击祖先（button、a、role=button、cursor:pointer）
            let clickable = pointEl;
            for (let d = 0; d < 5 && clickable && clickable !== document.body; d++) {
              const tag = clickable.tagName;
              const role = clickable.getAttribute('role');
              if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
                  role === 'button' || window.getComputedStyle(clickable).cursor === 'pointer') {
                console.log('[文本流定位] ↑ 上溯到可点击元素:', tag);
                return clickable;
              }
              clickable = clickable.parentElement;
            }
            return pointEl;
          }
        }

        // 降级：DOM 上溯（elementFromPoint 不可用时回退）
        console.log('[文本流定位] ⬇ 降级到 DOM 上溯');
        let walk = el;
        for (let d = 0; d < 6 && walk && walk !== document.body; d++) {
          const wt = walk.textContent.trim();
          if ((wt === '回复' || wt === 'Reply') && walk.offsetParent !== null) {
            // 找最深层的匹配子元素
            const allDesc = walk.querySelectorAll('*');
            let deepest = walk;
            for (const child of allDesc) {
              const ct = child.textContent.trim();
              if ((ct === '回复' || ct === 'Reply') && child.offsetParent !== null) {
                deepest = child;
              }
            }
            return deepest;
          }
          walk = walk.parentElement;
        }
      }
      return null;
    } catch (e) {
      console.error('[文本流定位] 异常:', e);
      return null;
    }
  }

  /* ── 稳健定位回复按钮：多策略 + 防重复感知（命中已发指纹会自动换方式重试） ──
     1) 文本流(Ctrl+F) 按原文定位——贴近“肉眼找哪条点哪条”；
        但两条评论开头相同会反复命中同一条，导致后一条漏发。
     2) 若①定位到的指纹撞上“本会话已发过的评论”，说明定位没挪动，
        换 DOM 定位（带 userLink，可区分不同的人）再试一次。
     返回：{ replyBtn, sig, via, duplicate }
       - replyBtn 有值：可发送，sig 为其评论指纹
       - replyBtn 为 null 且 duplicate=true：所有方式都只能指向“已发过的同一条”，应放弃以防重复
       - replyBtn 为 null 且 duplicate=false：根本没定位到按钮（未找到） */
  function _locateReplyBtn(author, originalText, commentIdx, userLink) {
    const tried = [];
    const tryOne = (btn, via) => {
      if (!btn) return null;
      const sig = _replyBtnCommentSig(btn, author, originalText);
      // 指纹撞上本会话已发过的 → 记下来，换下一种方式
      if (sig && _sessionSentSigs.has(sig)) { tried.push({ via, sig }); return null; }
      return { replyBtn: btn, sig, via, duplicate: false };
    };

    // 策略1：文本流 Ctrl+F（按原文，贴近肉眼）
    let r = tryOne(findReplyByTextFlow(originalText), '文本流(Ctrl+F)');
    if (r) return r;
    if (tried.length) {
      console.warn('[定位] 文本流命中的评论本会话已发过，换 DOM 定位重试（带 userLink 区分人）');
    }

    // 策略2：DOM 匹配（author + commentIdx + userLink，能区分不同的人）
    const bestMatch = findCommentElement(author, originalText, commentIdx, userLink);
    if (bestMatch) {
      r = tryOne(findReplyButtonNear(bestMatch), 'DOM匹配');
      if (r) return r;
    }

    // 所有方式都失败或都撞库
    if (tried.length > 0) {
      // 定位到了、但全都是“已发过的同一条” → 判定为重复，放弃
      return { replyBtn: null, sig: tried[0].sig, via: tried[0].via, duplicate: true, tried };
    }
    // 一种都没定位到 → 未找到按钮
    return { replyBtn: null, sig: '', via: '', duplicate: false, tried };
  }

  /* ── 模拟浏览节奏：随机滚动到评论区元素（停留时长由 delay_config.browseDwell 控制，0=整段跳过） ── */
  async function simulateHumanScroll(targetOriginalText) {
    if (!(_delayCfg.browseDwell > 0)) return; // 停留时间为 0 → 不模拟浏览，直接干活
    // ★ 方案一：通过评论内容定位，滚动实际评论元素
    const userLinks = document.querySelectorAll('a[href*="/user/"]');
    if (userLinks.length >= 2) {
      const steps = 2 + Math.floor(Math.random() * 2); // 2-3 次
      // 如果提供了目标文本，优先滚动到目标评论附近
      let candidates = Array.from(userLinks);
      if (targetOriginalText) {
        // 把目标评论排在前面
        const targetLinks = Array.from(userLinks).filter(link => {
          let p = link.parentElement;
          for (let d = 0; d < 5 && p; d++) {
            if (p.textContent.includes(targetOriginalText.slice(0, 30))) return true;
            p = p.parentElement;
          }
          return false;
        });
        if (targetLinks.length > 0) {
          // 目标评论作为第一次、最后一次滚动目标，中间随机插其他评论
          const middle = [];
          const others = Array.from(userLinks).filter(l => !targetLinks.includes(l));
          if (others.length > 0) middle.push(others[Math.floor(Math.random() * others.length)]);
          candidates = [targetLinks[0], ...middle, targetLinks[targetLinks.length - 1]];
        }
      }
      for (let i = 0; i < Math.min(steps, candidates.length); i++) {
        const link = candidates[i];
        const commentEl = link.closest('div') || link.parentElement;
        commentEl.scrollIntoView({
          behavior: 'smooth',
          block: i === 0 ? 'center' : (Math.random() > 0.5 ? 'start' : 'end')
        });
        // 停留阅读（时长可在设置页「停留时间」配置）
        await sleepWithCountdown(dwellMs('browseDwell'), `👀 浏览停留（第 ${i + 1} 段）`);
      }
      return;
    }
    // ★ 方案二：无评论 → 滚动笔记弹层内部容器（而非背景页面）
    scrollNoteBy((Math.random() - 0.5) * 400);
    await sleepWithCountdown(dwellMs('browseDwell'), '👀 浏览停留');
  }

  // ============================
  // 发送回复
  // ============================
  /* ── 把文本填进底部评论框（回复评论 / 对笔记的一级评论共用；节奏看 fast 与 delay_config.typingCharDelay） ── */
  async function _fillEditable(inputEl, text, fast) {
    _showStatus('正在输入内容...');
    inputEl.focus();
    await sleep(100);
    const isEditable = inputEl.contentEditable === 'true' || inputEl.contentEditable === 'plaintext-only';

    // 清空现有内容
    if (isEditable) {
      inputEl.innerHTML = '';
    } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      ).set;
      nativeSetter.call(inputEl, '');
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      inputEl.textContent = '';
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(80);

    // 逐字输入（每字延迟由 delay_config.typingCharDelay 控制，0=不逐字、一次性填入）
    const totalLen = text.length;
    const typingCfg = Math.max(0, Number(_delayCfg.typingCharDelay) || 0);

    if (fast || typingCfg <= 0) {
      // ★ 快速通道（手动一键发送）：一次性填入全部文本，不逐字磨蹭
      if (isEditable) {
        document.execCommand('insertText', false, text);
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          inputEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeSetter.call(inputEl, text);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        inputEl.textContent = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await sleep(50);
    } else {
      // ★ 自然节奏通道（自动批量发送）：逐字输入 + 随机停顿，控制操作频率；节奏均基于 typingCfg
      const perCharMs = typingCfg;

      for (let i = 0; i < totalLen; i++) {
        const char = text[i];

        // 每 8-14 个字停一次（约 2~4 倍每字延迟）
        if (i > 0 && i % (8 + Math.floor(Math.random() * 6)) === 0) {
          await sleep(perCharMs * 2 + Math.random() * perCharMs * 2);
        }
        if ('，。！？；、,.!?;'.includes(char)) {
          await sleep(perCharMs + Math.random() * perCharMs);
        }

        // 每字延迟：设定值的 50%~100% 随机
        const delay = perCharMs * (0.5 + Math.random() * 0.5);

        if (isEditable) {
          document.execCommand('insertText', false, char);
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
        } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
          inputEl.value += char;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          inputEl.textContent += char;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await sleep(delay);
      }

      // 输入完毕后直接发送，不再长停顿
      await sleep(perCharMs + Math.random() * perCharMs);
    }
  }

  /* ── 提交已填好的评论框（回复评论 / 对笔记的一级评论共用） ──
     返回 { success, verified, sentOk, sentVia }；opt.locatedSig/author/originalText 只有"回复"传，
     用于把这条回复记进防重复指纹与"上一条发给了谁"（一级评论不属于任何评论会话，不参与） */
  async function _submitFilledComment(inputEl, text, fast, opt) {
    const o = opt || {};
    _showStatus('发送评论...');
    await sleep(dwellMs('preSendGap', 400)); // 拟人挡位：点「发送」前先停留，避免打开即秒发

    // ★ 坐标级点击：PointerEvent + MouseEvent + click，覆盖 React 各种事件绑定
    async function _clickButton(el) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
      await sleep(20);
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      await sleep(20);
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
      await sleep(20);
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      await sleep(20);
      el.click();                                   // trusted event
      el.dispatchEvent(new MouseEvent('click', opts));
    }

    let sentOk = false;
    let sentVia = '';

    // ★ 发送成功三重信号（任一命中即认为已提交，立刻停手，不再补点/补回车）：
    //   ① 输入框从 DOM 消失（发送后面板收起）
    //   ② 页面上已出现本次文本（评论已渲染）
    //   ③ 输入框还在但内容已被清空（小红书有时发送成功只清空、不销毁节点）
    //   —— 这是"一条评论发出多条"的主因修复：原来只认①，实际已发出却判失败 → 继续点按钮/按 Enter → 重复提交
    const _echoOnPage = () => {
      const probe = (text || '').slice(0, 40);
      if (!probe) return false;
      const inputAlive = document.contains(inputEl);
      return Array.from(document.querySelectorAll('div, span, p')).some(el => {
        // 排除输入框自身及其容器：输入框里还没发出去的文字不算"已渲染的评论"
        if (inputAlive && (el.contains(inputEl) || inputEl.contains(el))) return false;
        const t = el.textContent.trim();
        return t.includes(probe) && t.length < text.length + 80;
      });
    };
    const _inputCleared = () => {
      try {
        const cur = (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT')
          ? (inputEl.value || '')
          : (inputEl.textContent || '');
        return cur.trim().length === 0;
      } catch (_) { return false; }
    };
    // 每次"补刀"前后都先自查：已经发出去了就绝不再点第二次
    function _stopIfSent(where) {
      if (sentOk) return true;
      let sig = '';
      if (!document.contains(inputEl)) sig = 'inputGone';
      else if (_echoOnPage()) sig = 'echoOnPage';
      else if (_inputCleared()) sig = 'inputCleared';
      if (sig) {
        sentOk = true;
        sentVia = sig;
        console.log('[发送] ✅ 已确认提交（' + sig + ' @ ' + where + '），停止后续补点，防重复');
        return true;
      }
      return false;
    }

    // ── 方案一：面板内找到了发送按钮 → 点击 ──
    const sendBtn = findSendButtonNear(inputEl);
    if (sendBtn) {
      console.log('[发送] ✅ 按钮:', sendBtn.tagName, sendBtn.textContent.trim());
      for (let attempt = 0; attempt < 3 && !sentOk; attempt++) {
        if (_stopIfSent('方案一第' + (attempt + 1) + '次点击前')) break;
        _showStatus(`点击发送 (${attempt + 1}/3)...`);
        sendBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await sleep(200);
        await _clickButton(sendBtn);
        await sleep(800);
        if (_stopIfSent('方案一第' + (attempt + 1) + '次点击后')) break;
      }
    }

    // ── 方案二：面板内所有靠右的元素（可能按钮没有"发送"文字）──
    if (!sentOk && !_stopIfSent('方案二前')) {
      _showStatus('面板右侧按钮...');
      let panel = inputEl.parentElement;
      for (let d = 0; d < 10 && panel; d++) {
        if (panel === document.body) break;
        if (window.getComputedStyle(panel).position === 'fixed') break;
        panel = panel.parentElement;
      }
      if (panel && panel !== document.body) {
        const ir = inputEl.getBoundingClientRect();
        for (const el of panel.querySelectorAll('button, [role="button"], a, span, div')) {
          if (el.offsetParent === null || el.disabled) continue;
          const r = el.getBoundingClientRect();
          // 在输入框同一行且靠右
          if (r.top < ir.top - 60 || r.top > ir.bottom + 120) continue;
          if (r.left <= ir.right) continue;
          _showStatus(`点:${el.textContent.trim().slice(0, 6)}`);
          await _clickButton(el);
          await sleep(500);
          if (_stopIfSent('方案二点击后')) break;
        }
      }
    }

    // ── 方案三：Enter ──
    if (!sentOk && !_stopIfSent('方案三前')) {
      inputEl.focus();
      await sleep(100);
      for (let attempt = 0; attempt < 3 && !sentOk; attempt++) {
        if (_stopIfSent('Enter第' + (attempt + 1) + '次前')) break;
        _showStatus(`Enter (${attempt + 1}/3)...`);
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        await sleep(600);
        if (_stopIfSent('Enter第' + (attempt + 1) + '次后')) break;
      }
    }

    // ── 方案四：全页面暴力 ──
    if (!sentOk && !_stopIfSent('方案四前')) {
      _showStatus('全局搜索...');
      for (const el of document.querySelectorAll('button, [role="button"], a')) {
        if (el.offsetParent === null || el.disabled) continue;
        const t = el.textContent.trim();
        if (t !== '发送' && t !== '发布' && t !== 'Send') continue;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.3 || r.top > window.innerHeight) continue;
        await _clickButton(el);
        await sleep(500);
        if (_stopIfSent('方案四点击后')) break;
      }
    }

    // 验证：轮询最多 2s，等内容渲染到页面上（比固定死等更少误报"未验证"）
    let verified = false;
    {
      const VERIFY_TIMEOUT = 2000, VERIFY_STEP = 250;
      const t0 = Date.now();
      while (Date.now() - t0 < VERIFY_TIMEOUT) {
        if (_echoOnPage()) { verified = true; break; }
        _showStatus('确认是否已出现…');
        await sleep(VERIFY_STEP);
      }
      if (!verified) verified = _echoOnPage();
      // 验证期间发现成功信号也补记 sentOk（供指纹入库防重复）
      if (verified && !sentOk) { sentOk = true; sentVia = 'echoOnPage'; }
    }

    // ★★★ 发送完毕最后一步：强制点击笔记标题关闭输入框 ★★★
    // 这是"一键发送"的最终收尾动作，必须在释放锁之前完成：
    //   1. 确保残留输入框彻底关闭（防止下一条发到上一条的框里）
    //   2. 只有点击标题成功后才算"发送完成"，才释放操作锁
    _showStatus('收尾：关闭输入框...');
    try {
      const curInput = findBottomReplyInput();
      if (curInput && curInput.offsetParent !== null) {
        try { curInput.blur(); } catch (_) {}
      }
    } catch (_) {}
    // 无论框是否可见都点标题——确保小红书内部状态也归位
    _clickNoteTitle();
    await sleep(500);
    // 二次确认：如果还没关掉，再点一次
    const _finalInput = findBottomReplyInput();
    if (_finalInput && _finalInput.offsetParent !== null) {
      console.log('[发送] 首次点标题未关闭输入框，再点一次');
      _clickNoteTitle();
      await sleep(400);
    }

    _hideStatus();
    // ★ 记录本次成功发送的目标，供下一条防重复闸比对（只有"回复评论"需要）
    if (o.locatedSig || o.author) {
      _lastSentTarget = {
        atName: _normName((o.atName || o.author || '')),
        author: _normName(o.author || ''),
        textKey: _normName((o.originalText || '').slice(0, 30)),
      };
    }
    // ★ 把本次实际定位到的评论指纹记入会话集合，同一条评论不会再发第二次。
    // 仅当确实发出去（verified 或 sentOk）才入库，避免"没发成却入库 → 下次补发反被拦"
    if (o.locatedSig && (verified || sentOk)) _sessionSentSigs.add(o.locatedSig);
    return { success: true, verified, sentOk, sentVia };
  }

  /* ── 关闭页面上残留的评论输入框（不许用 Esc——会关掉整个笔记弹层） ──
   * 三级降级：blur 失焦+滚动收起 → 点笔记标题 → 面板里的关闭类按钮 */
  async function _closeResidualInput() {
    const open = () => {
      try { const el = findBottomReplyInput(); return (el && el.offsetParent !== null) ? el : null; } catch (_) { return null; }
    };
    try {
      _showStatus('关闭已有评论框...');
      let cur = open();
      if (!cur) return;
      try { cur.blur(); } catch (_) {}
      scrollNoteBy(-120);
      await sleep(400);
      cur = open();
      if (cur && _clickNoteTitle()) { await sleep(400); cur = open(); }
      if (cur) {
        const panel = cur.closest('[class*="reply" i], [class*="footer" i], [class*="bottom" i]');
        if (panel) {
          const closeBtn = panel.querySelector('button, [class*="close" i], [class*="cancel" i], [class*="del" i]');
          if (closeBtn) closeBtn.click();
        }
      }
      await sleep(300);
    } catch (_) {}
  }

  /* ── 底线判断：这个输入框是不是「对笔记本身」的一级评论框 ──
   * 一级评论框 placeholder 是「说点什么…/留下你的评论」，不含 @ 与「回复」；
   * 回复某条评论时 placeholder 会变「回复 @昵称」→ 一律判否，防止一级评论发成对某人的回复。
   * 提不到任何文案时返回 ok:true（交给 findBottomReplyInput 的位置兜底）。 */
  function _isNoteLevelInput(inputEl) {
    const hint = collectReplyBoxHints(inputEl);
    if (!hint) return { ok: true, hint: '' };
    if (/回复|reply|@/i.test(hint)) return { ok: false, hint };
    return { ok: true, hint };
  }

  /* ── 对「笔记本身」发一条一级评论（最新抢位 / 本地点评 / 活水占位 都用它） ──
   * 与 sendReplyToComment 的区别：不点任何评论的「回复」按钮，直接用页面底部的一级评论框；
   * 提交/验证/收尾与回复共用 _submitFilledComment（同一套防重复三重信号）。
   * 一级评论不属于任何评论会话，故不写 _lastSentTarget / _sessionSentSigs。 */
  async function sendNoteComment(req) {
    const r = req || {};
    const fast = r.humanize !== true; // 默认快速通道；批量自动才逐字打字
    let text = String(r.text || '').trim();
    if (!text) return { success: false, error: '评论内容为空' };
    // 300 字硬截断（与 sendReplyToComment 同口径）
    if (text.length > 300) {
      let cut = text.slice(0, 300);
      const lastPunc = Math.max(
        cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('~'),
        cut.lastIndexOf('～'), cut.lastIndexOf('!'), cut.lastIndexOf('？'), cut.lastIndexOf('?')
      );
      if (lastPunc >= 240) cut = cut.slice(0, lastPunc + 1);
      console.warn('[一级评论] 内容 ' + text.length + ' 字超过小红书300字上限，已截断');
      text = cut;
    }

    const noteKey = (String(r.title || '') + '|' + String(r.noteId || location.pathname)).slice(0, 120);
    const textKey = _normName(text.slice(0, 30));
    const sig = noteKey + '||' + textKey;
    if (_sessionNoteCommentSigs.has(sig)) {
      console.warn('[一级评论] ⛔ 防重复：本会话已对同一篇笔记发过同样内容的评论，放弃');
      return { success: false, error: '防重复：这篇笔记本次会话已经发过同样内容的一级评论了' };
    }

    // 1. 先关掉残留输入框（尤其别把一级评论填进别人的回复框里）
    await _closeResidualInput();

    // 2. 等一级评论框出现（最多 5s）
    let inputEl = null;
    for (let i = 0; i < 10; i++) {
      inputEl = findBottomReplyInput();
      if (inputEl) break;
      _showStatus(`等待评论框…（${i * 0.5}s / 5s）`);
      await sleep(500);
    }
    if (!inputEl) { _hideStatus(); return { success: false, error: '未找到笔记底部的评论框（笔记可能未打开或未加载完）' }; }

    // 3. 底线校验：必须是「对笔记」的一级评论框，不是对某人回复的框
    for (let attempt = 0; attempt < 2; attempt++) {
      const chk = _isNoteLevelInput(inputEl);
      if (chk.ok) break;
      if (attempt === 1) {
        console.warn('[一级评论] ❌ 当前是评论回复框（线索:' + chk.hint + '），不是笔记评论框，放弃防错位');
        try { inputEl.blur(); } catch (_) {}
        _hideStatus();
        return { success: false, error: '当前打开的是对某条评论的回复框（' + chk.hint + '），不是笔记评论框，已放弃' };
      }
      // 先把这个回复框收起来，再找一次一级评论框
      await _closeResidualInput();
      inputEl = findBottomReplyInput();
      if (!inputEl) { _hideStatus(); return { success: false, error: '未找到笔记底部的评论框' }; }
      await sleep(300);
    }

    // 4. 填入 + 提交（与回复共用同一套发送/验证/收尾）
    inputEl.focus();
    await sleep(150);
    _showStatus('输入一级评论...');
    await _fillEditable(inputEl, text, fast);
    const sub = await _submitFilledComment(inputEl, text, fast, {});
    if (sub.verified || sub.sentOk) _sessionNoteCommentSigs.add(sig);
    console.log('[一级评论] 完成：verified=' + !!sub.verified + ' sentOk=' + !!sub.sentOk + ' via=' + (sub.sentVia || '-'));
    return { success: true, verified: sub.verified, sentOk: sub.sentOk, method: sub.verified ? 'confirmed' : (sub.sentOk ? (sub.sentVia || 'sendButton') : 'enterKey') };
  }

  async function sendReplyToComment(author, originalText, replyText, commentIdx, userLink, images, humanize) {
    // humanize=true （自动批量发送）：自然节奏——先停留浏览、逐字输入，控制操作频率。
    // humanize=false（手动逐条一键发送）：走快速通道，跳过浏览滞留、一次性填字，不磨蹭。
    const fast = !humanize;
    // ★ 小红书限制：单条评论不能超过300字，超出则硬截断（所有发送路径的统一收口）
    const XHS_MAX_LEN = 300;
    if (replyText && replyText.length > XHS_MAX_LEN) {
      console.warn('[发送回复] 内容 ' + replyText.length + ' 字超过小红书300字上限，已截断');
      // 优先在最后一个句末标点处截断，避免把话说一半
      let cut = replyText.slice(0, XHS_MAX_LEN);
      const lastPunc = Math.max(
        cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('~'),
        cut.lastIndexOf('～'), cut.lastIndexOf('!'), cut.lastIndexOf('？'), cut.lastIndexOf('?')
      );
      if (lastPunc >= XHS_MAX_LEN - 60) {
        cut = cut.slice(0, lastPunc + 1);
      }
      replyText = cut;
    }

    // ★ 先关闭已存在的回复输入框（避免上次回复的输入残留导致发错评论）
    await _closeResidualInput();

    // ===== 0.（已按用户要求移除）自动批量时不再单独“浏览停留阅读”＝点赞之后到发评论之间的等待已去掉，
    //     节奏控制改由“条间随机 3~8 秒间隔”承担（见 popup 批量发送与 auto-bot），不再逐条磨蹭 =====

    // ===== 1. 定位回复按钮（文本流 Ctrl+F 优先，DOM 定位降级） =====
    _showStatus('定位回复按钮...');
    let replyBtn = null;
    // ★ 稳健定位：文本流(Ctrl+F)优先，命中“本会话已发过的同一条”会自动换 DOM 定位重试（带 userLink 区分人）
    const loc = _locateReplyBtn(author, originalText, commentIdx, userLink);
    replyBtn = loc.replyBtn;
    const locatedSig = loc.sig;
    if (replyBtn) {
      console.log('[发送回复] ✅ 定位成功（' + loc.via + '）');
    }
    // 所有定位方式都只能指向“已发过的同一条” → 真重复，放弃
    if (!replyBtn && loc.duplicate) {
      console.warn('[发送回复] ⛔ 防重复：文本流与 DOM 定位都只能定到本会话已发过的同一条，放弃以防重复');
      scrollNoteBy(-60);
      await sleep(200);
      _hideStatus();
      return { success: false, error: '防重复：这条评论本次已经回复过了（换了定位方式仍只能定到同一条），已放弃' };
    }
    if (!replyBtn) {
      _hideStatus();
      return { success: false, error: '未找到回复按钮' };
    }

    // ===== 2. 滚动到回复按钮并高亮闪烁（快速通道跳过闪烁停顿） =====
    _showStatus('点击回复按钮...');
    replyBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!fast) {
      await sleep(200);
      const origBg = replyBtn.style.background;
      replyBtn.style.transition = 'background 0.3s';
      replyBtn.style.background = '#fff3cd';
      await sleep(400);
      replyBtn.style.background = origBg || 'transparent';
    }

    // ===== 3. 点击回复按钮 =====
    // ★ 先记录点击前已存在的输入框（可能是残留的上一条的），点击后比对是否换了新元素
    const _inputBeforeClick = findBottomReplyInput();
    replyBtn.click();
    replyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // ===== 4. 等待回复输入框出现（最多等 5 秒）=====
    let inputEl = null;
    for (let i = 0; i < 10; i++) {
      _showStatus(`等待回复输入框弹出…（${i * 0.5}s / 5s）`);
      await sleep(500);
      inputEl = findBottomReplyInput();
      if (inputEl) break;
    }
    if (!inputEl) {
      _hideStatus();
      return { success: false, error: '未找到回复输入框' };
    }

    // ★ 交叉验证：核对回复框目标 == 目标作者，防止“评论发错人 / 发成笔记评论”
    _showStatus('交叉验证回复对象...');
    let check = verifyReplyTarget(inputEl, author);
    // placeholder 可能没立即刷新，拿不准时等 400ms 再核一次
    if (author && (check.verdict === 'unknown' || check.verdict === 'note')) {
      await sleep(400);
      check = verifyReplyTarget(inputEl, author);
    }
    console.log('[发送回复] 交叉验证:', check.verdict, '| @' + (check.atName || ''), '| 目标@' + (author || ''), '| 线索:', check.hint);

    if (author && check.verdict === 'mismatch') {
      console.warn('[发送回复] ❌ 回复框目标是 @' + (check.atName || '?') + '，与目标作者 @' + author + ' 不符，放弃发送以防评论错位');
      try { inputEl.blur(); } catch (_) {}
      scrollNoteBy(-60);
      await sleep(300);
      _hideStatus();
      return { success: false, error: '交叉验证未通过：打开的是 @' + (check.atName || '?') + ' 的回复框（应为 @' + author + '），已放弃以防评论错位' };
    }
    if (author && check.verdict === 'note') {
      console.warn('[发送回复] ❌ 打开的是对笔记的一级评论框，而非目标评论的回复框，放弃发送');
      try { inputEl.blur(); } catch (_) {}
      scrollNoteBy(-60);
      await sleep(300);
      _hideStatus();
      return { success: false, error: '交叉验证未通过：这是对笔记的评论框而非目标评论的回复框，已放弃以防评论错位' };
    }
    if (check.verdict === 'match') {
      console.log('[发送回复] ✅ 交叉验证通过：确认回复 @' + author);
    } else {
      // verdict === 'unknown'（无 author 或 placeholder 提不到昵称）→ 退回原有“是否回复框 + 位置”校验
      const ph = (inputEl.getAttribute('placeholder') || inputEl.getAttribute('aria-label') || '').toLowerCase();
      const parentEl = inputEl.closest('[class*="reply" i],[class*="comment" i],[class*="footer" i],[class*="bottom" i]');
      const parentText = (parentEl ? parentEl.textContent : inputEl.parentElement?.textContent || '').toLowerCase();
      const isReplyContext = ph.includes('@') || ph.includes('回复') || ph.includes('reply') || parentText.includes('回复');
      if (!isReplyContext) {
        const ir = inputEl.getBoundingClientRect();
        const vh = window.innerHeight;
        if (ir.top >= vh * 0.7) {
          console.log('[发送回复] ✓ 输入框通过位置验证（底部固定区域）');
        } else {
          console.log('[发送回复] 误点：找到的输入框不是回复输入框，失焦后放弃');
          try { inputEl.blur(); } catch (_) {}
          await sleep(300);
          _hideStatus();
          return { success: false, error: '未找到回复输入框' };
        }
      }
    }

    // ===== 4.5 防重复闸：回复框目标跟"上一条成功发送"的目标相同 / 无法确认已切换，但本次想发的是另一个人 → 定位卡住了，放弃 =====
    // 两个子条件（满足任意一个就拦）：
    //   A) 回复框 @名字明确 == 上一条的人（boxStuckOnLast）
    //   B) 回复框 @名字读不到（unknown），但上一条刚发过一个「不同的人」→ 无法证明切换成功也不放行
    {
      const curBoxName = _normName(check.atName || '');
      const curAuthor = _normName(author || '');
      const curTextKey = _normName((originalText || '').slice(0, 30));
      if (_lastSentTarget) {
        // 本次想发的，是否与上一条成功发送的是"不同的一条"（作者或原文不同）
        const intendDifferent =
          (curAuthor && curAuthor !== _lastSentTarget.author) ||
          (curTextKey && curTextKey !== _lastSentTarget.textKey);
        // A) 回复框 @名字明确 == 上一条 → 定位根本没挪动
        const boxStuckOnLast =
          curBoxName && _lastSentTarget.atName && curBoxName === _lastSentTarget.atName;
        // B) 回复框身份不明（placeholder 提不到 @名字）：上一条是另一个人、刚发完就紧接着发第二条，
        //    无法证明回复框已切换 → 视为卡住，宁可报失败也不冒险发重复
        //    ★ 但如果点击回复按钮后拿到的是一个全新的 DOM 元素（与点击前不同），说明确实切换了，放行
        const inputIsNewElement = _inputBeforeClick && inputEl !== _inputBeforeClick;
        const boxUnknownButDangerous =
          !curBoxName && _lastSentTarget.atName && intendDifferent && !inputIsNewElement;
        if (intendDifferent && (boxStuckOnLast || boxUnknownButDangerous)) {
          const reason = boxStuckOnLast
            ? '回复框目标仍为上一条 @' + (check.atName || '?')
            : '无法确认回复框已切换到新目标（placeholder 读不到 @名字）';
          console.warn('[发送回复] ⛔ 防重复：' + reason +
            '，而本次应发给 @' + (author || '?') + '，放弃以防重复评论');
          try { inputEl.blur(); } catch (_) {}
          scrollNoteBy(-60);
          await sleep(300);
          _hideStatus();
          return { success: false, error: '防重复：' + reason + '（本次应发 @' + (author || '?') + '），已放弃以防评论错位。请手动刷新页面后重试' };
        }
      }
    }

    // ===== 5. 逐字输入回复内容（模拟真实打字，根据字数动态调整速度） =====
    await _fillEditable(inputEl, replyText, fast);

    // ===== 5.5 上传图片（如果有）=====
    if (images && images.length > 0) {
      _showStatus(`上传图片 (${images.length}张)...`);
      try {
        // 查找图片上传输入框
        const imageInput = document.querySelector('input[type="file"][accept*="image"], input[type="file"][accept*="*"]');
        if (imageInput) {
          for (let i = 0; i < images.length; i++) {
            const imgData = images[i];
            if (!imgData.image) continue;
            
            // 将 base64 转换为 File 对象
            const response = await fetch(imgData.image);
            const blob = await response.blob();
            const file = new File([blob], `image_${i}.png`, { type: blob.type });
            
            // 创建 DataTransfer 对象来设置文件
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            
            // 设置文件到 input
            imageInput.files = dataTransfer.files;
            imageInput.dispatchEvent(new Event('change', { bubbles: true }));
            
            console.log(`[发送] 已上传图片: ${imgData.title || '图片' + i}`);
            await sleep(1000); // 等待上传完成
          }
        } else {
          console.log('[发送] 未找到图片上传输入框，跳过图片上传');
        }
      } catch (err) {
        console.error('[发送] 图片上传失败:', err);
      }
    }

    // ===== 6. 发送（面板搜索+多事件类型点击；与「对笔记的一级评论」共用 _submitFilledComment） =====
    _showStatus('发送回复...');
    const sub = await _submitFilledComment(inputEl, replyText, fast, {
      locatedSig,
      atName: check.atName,
      author,
      originalText,
    });
    const verified = sub.verified, sentOk = sub.sentOk, sentVia = sub.sentVia;
    return { success: true, verified, method: verified ? 'confirmed' : (sentOk ? (sentVia || 'sendButton') : 'enterKey') };
  }

  /* ── 定位回复：仅定位+点击回复，不打字不发送，供手动操作 ── */
  async function locateAndOpenReply(author, originalText, commentIdx, userLink) {
    // ★ 先按浏览节奏滑动
    await simulateHumanScroll(originalText);

    let replyBtn = findReplyByTextFlow(originalText);
    if (!replyBtn) {
      const bestMatch = findCommentElement(author, originalText, commentIdx, userLink);
      if (bestMatch) replyBtn = findReplyButtonNear(bestMatch);
    }
    if (!replyBtn) return { success: false, error: '未找到回复按钮' };

    replyBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await sleep(200);
    const origBg = replyBtn.style.background;
    replyBtn.style.transition = 'background 0.3s';
    replyBtn.style.background = '#fff3cd';
    await sleep(400);
    replyBtn.style.background = origBg || 'transparent';

    replyBtn.click();
    replyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    let inputEl = null;
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      inputEl = findBottomReplyInput();
      if (inputEl) break;
    }
    if (!inputEl) return { success: false, error: '未找到回复输入框' };

    const ph = (inputEl.getAttribute('placeholder') || inputEl.getAttribute('aria-label') || '').toLowerCase();
    const parentEl = inputEl.closest('[class*="reply" i],[class*="comment" i],[class*="footer" i],[class*="bottom" i]');
    const parentText = (parentEl ? parentEl.textContent : inputEl.parentElement?.textContent || '').toLowerCase();
    const isReplyContext = ph.includes('@') || ph.includes('回复') || ph.includes('reply') || parentText.includes('回复');
    if (!isReplyContext) {
      const ir = inputEl.getBoundingClientRect();
      const vh = window.innerHeight;
      if (ir.top < vh * 0.7) {
        try { inputEl.blur(); } catch (_) {}
        await sleep(300);
        return { success: false, error: '未找到回复输入框' };
      }
    }

    inputEl.focus();
    _hideStatus();
    return { success: true };
  }

  /* ── 评论跟进：通知项容器（与 extractNotifications 的 idx 编号规则完全一致） ──
   * 通知页每个通知项是 div.container（勘探验证），用 .interaction-hint / .user-avatar 过滤掉页面其它同名节点。
   * 点击回复后输入框行内展开在通知项内部，不增加 container 数量 → idx 不漂移。
   * v2.0：XHS 时常改 class —— 主策略命中不了时，用"结构兜底"（按 用户主页链接 + 互动文本 找回通知项），
   *   并对无任何结果的场景做快照诊断，避免"无通知项"死角。
   */
  function _getNotificationContainers() {
    const main = Array.from(document.querySelectorAll('div.container'))
      .filter(el => el.querySelector('.interaction-hint') || el.querySelector('.user-avatar'));
    if (main.length) return main;
    // 兜底：每个"用户主页链接"向上取最小"含互动文本"的祖先 = 通知项
    const out = [];
    const seen = new Set();
    const actRe = /(赞了|关注了|收藏了|回复了|评论了|点赞|收藏|关注|你的评论|评论你的|回你)/;
    document.querySelectorAll('a[href*="/user/"]').forEach((a) => {
      let el = a;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        if (!el || seen.has(el)) break;
        const t = (el.textContent || '').replace(/\s+/g, ' ');
        if (t.length >= 4 && t.length < 400 && actRe.test(t)) { seen.add(el); out.push(el); break; }
      }
    });
    if (out.length) return out;
    // 终极兜底：直接按可见用户链接个数生成占位（正常通知页至少有头像链接）
    document.querySelectorAll('a[href*="/user/"]').forEach((a) => {
      const i = a.parentElement || a;
      const t = (i.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && !seen.has(i)) { seen.add(i); out.push(i); }
    });
    return out;
  }

  // 通知页为 0 时做诊断快照（存到 storage + 采样本），便于定位"读不到"的真正原因
  async function _notifDiag() {
    const sample = [];
    document.querySelectorAll('a[href*="/user/"]').slice(0, 10).forEach((a) => {
      let el = a;
      for (let i = 0; i < 4 && el; i++) { el = el.parentElement; if (!el) break; }
      const t = (el ? el.textContent : a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      sample.push({ href: (a.getAttribute('href') || '').slice(0, 80), text: t });
    });
    const report = {
      at: new Date().toISOString(),
      url: location.href,
      containerCount: Array.from(document.querySelectorAll('div.container')).length,
      hintCount: document.querySelectorAll('.interaction-hint').length,
      avatarCount: document.querySelectorAll('.user-avatar').length,
      userLinkCount: document.querySelectorAll('a[href*="/user/"]').length,
      bodySnippet: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 400),
      sample,
    };
    try { await new Promise((r) => chrome.storage.local.set({ '_prospect_notif_diag': report }, r)); } catch (_) {}
    return report;
  }

  /* ── 评论跟进：从通知项提取 user_id（用户主页链接里的稳定 ID） ── */
  function _extractNotificationUserId(container) {
    const link = container.querySelector('a[href*="/user/"]');
    if (!link) return '';
    const m = (link.getAttribute('href') || '').match(/\/user\/(?:profile\/)?([0-9a-f]{6,})/i);
    return m ? m[1] : '';
  }

  /* ── 评论跟进：提取通知流（DOM 顺序 = 时间倒序，idx 0 最新） ── */
  async function extractNotifications() {
    // 非通知页快速退出：连一个通知项都没有，不白滚 9 秒
    if (_getNotificationContainers().length === 0) {
      return { success: true, items: [], count: 0, url: window.location.href };
    }
    // 先滚动加载更多（通知页无“加载更多”按钮，靠滚动到底部触发无限加载；新内容追加在列表末尾，已有项 idx 不变）
    _showStatus('加载更多通知...');
    try {
      const scroller = document.scrollingElement || document.documentElement;
      let prevCount = -1;
      for (let round = 0; round < 6; round++) {
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(dwellMs('lazyLoadWait', 700)); // 拟人：每轮加载间隔受挡位控制
        const count = _getNotificationContainers().length;
        if (count === prevCount) break; // 滚动后数量没变 → 已加载到底
        prevCount = count;
      }
      window.scrollTo(0, 0); // 回到顶部，保持页面状态干净
      await sleep(dwellMs('browseDwell', 300)); // 拟人：读取前浏览停顿
    } catch (_) {}

    const containers = _getNotificationContainers();
    const items = [];
    containers.forEach((container, idx) => {
      // user_id（稳定标识，组装会话按它分组）
      const userId = _extractNotificationUserId(container);
      // 昵称（多级回退：新版页面昵称可能不在头像链接里）
      const userLink = container.querySelector('a[href*="/user/profile/"]');
      if (!userLink) { const _alt = container.querySelector('a[href*="/user/"]'); if (_alt && _alt.getAttribute('href')) userLink = _alt; }
      let userName = userLink ? userLink.textContent.trim() : '';
      if (!userName) {
        const nameEl = container.querySelector('.user-info .name, .user-info .nickname, .user-info .user-name, .interaction-user, .user-name, .nickname, .name');
        if (nameEl) userName = nameEl.textContent.trim();
      }
      if (!userName) {
        const info = container.querySelector('.user-info');
        if (info) {
          const firstA = Array.from(info.querySelectorAll('a')).find(a => a.textContent.trim());
          if (firstA) userName = firstA.textContent.trim();
        }
      }
      // 交互类型 + 相对时间
      const hintEl = container.querySelector('.interaction-hint');
      const timeSpan = hintEl ? hintEl.querySelector('.interaction-time') : null;
      const time = timeSpan ? timeSpan.textContent.trim() : '';
      // 对方消息（interaction-content）＝对方回复了我的评论
      const contentEl = container.querySelector('.interaction-content');
      const incoming = contentEl ? contentEl.textContent.trim() : '';
      // 我的原评论（quote-info）＝对方回复的那条评论（注意：不是我的回复！）
      const quoteEl = container.querySelector('.quote-info');
      const myComment = quoteEl ? quoteEl.textContent.trim() : '';
      // 是否可回复：有回复按钮（展开回复框时 action-reply 会被替换掉；"原评论已删除"也没有）
      const hasReplyBtn = !!container.querySelector('.action-reply');
      items.push({ idx, userId, userName, time, incoming, myComment, hasReplyBtn });
    });
    _hideStatus();
    return { success: true, items, count: items.length, url: window.location.href };
  }

  // 解析小红书通知相对时间（分钟前/小时前/昨天/n天前/月-日/年月日）→ {ts: 绝对时间戳, str: 原始片段}
  function _notifTime(txt) {
    const t = String(txt || '').replace(/\s+/g, ' ');
    const now = Date.now();
    let ts = 0, str = '';
    let m;
    if ((m = t.match(/(刚刚|刚才)/))) { ts = now; str = m[1]; }
    else if ((m = t.match(/(\d+)\s*分钟前/))) { ts = now - (+m[1]) * 60e3; str = m[0]; }
    else if ((m = t.match(/(\d+)\s*小时前/))) { ts = now - (+m[1]) * 3600e3; str = m[0]; }
    else if ((m = t.match(/昨天/))) { ts = now - 24 * 3600e3; str = m[0]; }
    else if ((m = t.match(/(\d+)\s*天前/))) { ts = now - (+m[1]) * 24 * 3600e3; str = m[0]; }
    else if ((m = t.match(/(\d{4})[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/))) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]); ts = d.getTime(); str = m[0];
    }
    else if ((m = t.match(/(\d{1,2})-(\d{1,2})/))) {
      const y = new Date().getFullYear(); ts = new Date(y, +m[1] - 1, +m[2]).getTime(); str = m[0];
    }
    return { ts, str };
  }

  // 从单个通知容器构造线索项：昵称多级兜底（头像链接无文本 / class 改名 / 从互动文本解析作者名）
  // + 被互动对象的笔记/评论标题多选择器适配（赞/藏 tab 的标题 class 与回复 tab 不同）。
  function _likerFromContainer(container, tabType) {
    // ★ 干净副本：每条通知项里都内嵌一个隐藏的删除/取消确认弹窗(.reds-alert，display:none 一直在 DOM，
    //   标题如「取消评论」，正文「将会清空已经输入的内容」)。若直接读 container.textContent 或宽泛匹配
    //   [class*="title"]，会把「取消评论」误当成对方消息正文。先克隆并剔掉所有 .reds-alert。
    let clean = container;
    try {
      clean = container.cloneNode(true);
      clean.querySelectorAll('.reds-alert').forEach((n) => n.remove());
    } catch (_) {}
    const txt = (clean.textContent || '').replace(/\s+/g, ' ');
    const userId = _extractNotificationUserId(container);
    // ★ 取昵称：通知项里可能同时有"头像链接(无文本)"和"昵称链接(有文本)"。
    //   优先挑带可见文本的 /user/ 锚点（昵称），头像链接只在没得选时兜底。
    const _userLinks = Array.from(container.querySelectorAll('a[href*="/user/"]'));
    const _named = _userLinks.find(a => (a.getAttribute('href') || '').match(/\/user\/(?:profile\/)?[0-9a-f]+/i) && (a.textContent || '').trim());
    const _ul = _named || _userLinks[0] || null;
    const userLink = _ul ? _ul.getAttribute('href') : '';
    // 昵称：优先 .user-info 里的昵称链接（主位置），再逐级兜底
    let userName = '';
    { const _uiA = container.querySelector('.user-info a[href*="/user/"]') || container.querySelector('.user-info a'); if (_uiA) userName = (_uiA.textContent || '').trim(); }
    if (!userName) userName = _ul && _ul.textContent ? _ul.textContent.trim() : '';
    if (!userName) {
      const _ne = container.querySelector('.user-info .name, .user-info .nickname, .interaction-user, .user-name, .nickname, .name, [class*="name"], [class*="nick"]');
      if (_ne) userName = _ne.textContent.trim();
    }
    if (!userName) {
      const m = txt.match(/^\s*([\u4e00-\u9fa5A-Za-z0-9_\-·]{2,16})\s*(?:赞了|收藏了|关注了|回复了|评论了|回复你的|关注你|回你)/);
      if (m) userName = m[1].trim();
    }
    // 昵称兜底3：链接文本是头像(图片无文本)时，从 /user/ 链接里挑最短非空 text（避免把时间/动词带进来）
    if (!userName) {
      for (const a of _userLinks) {
        const t = (a.textContent || '').trim();
        if (t && t.length <= 12) { userName = t; break; }
      }
    }
    // 昵称兜底4：头像 img 的 alt 常就是昵称；或链接 title 属性带着昵称
    if (!userName) {
      const _img = container.querySelector('a[href*="/user/"] img[alt]');
      const _alt = _img && (_img.getAttribute('alt') || '').trim();
      if (_alt && _alt.length <= 20) userName = _alt;
    }
    if (!userName) {
      for (const a of _userLinks) {
        const _t = (a.getAttribute('title') || '').trim();
        if (_t && _t.length <= 20) { userName = _t; break; }
      }
    }
    // 商机信号分类：★ tabType 优先（正在爬的通知 tab 就是真相，别靠文字猜，尤其"新增关注"绝不会变成点赞）
    let signalType = '';
    if (tabType === '新增关注') signalType = '关注';
    else if (tabType === '评论和@') signalType = '回复';
    else {
      // 其余（赞和收藏/兜底）才靠文字区分 回复/关注/收藏/点赞
      if (/(回复了你的|回复你的评论|评论了你的|评论你的|回复了你|回复你)/.test(txt)) signalType = '回复';
      else if (/(关注了你|关注了你的)/.test(txt)) signalType = '关注';
      else if (/(收藏了你的|收藏了你)/.test(txt)) signalType = '收藏';
      else if (/(赞了你的|赞了你|赞了)/.test(txt)) signalType = '点赞';
    }
    if (!signalType && txt.length > 0) signalType = '互动';
    if (!signalType) return null;
    // 被互动对象：点赞/收藏→笔记或评论标题；回复→对方回复的话
    const quoteEl = clean.querySelector('.quote-info');
    const likedComment = quoteEl ? quoteEl.textContent.trim() : '';
    // 对方消息正文（评论/回复内容）最直观——优先取它，兜底才回退到笔记标题链接。
    // ★ 不要用宽泛 [class*="title"]：会命中隐藏弹窗 .reds-alert-title「取消评论」。
    let likedNote = '';
    const _ic = clean.querySelector('.interaction-content');
    if (_ic && _ic.textContent.trim()) likedNote = _ic.textContent.trim();
    if (!likedNote) {
      const nLink = clean.querySelector('a[href*="/explore/"], a[href*="/discovery/"], .note-title, [class*="noteTitle"], [class*="note-title"], [class*="source-title"], [class*="interaction-note"]');
      if (nLink) likedNote = nLink.textContent.trim();
    }
    if (!likedNote) {
      const tEl = clean.querySelector('.note-title, [class*="note"], [class*="comment-title"]');
      if (tEl) likedNote = tEl.textContent.trim();
    }
    const ntv = _notifTime(txt);
    // 时间兜底：整块文本没解析出时，单独读时间行再解析
    if (!ntv.ts) {
      const _ti = clean.querySelector('.interaction-time, [class*="time"]');
      if (_ti) { const _tt = _notifTime(_ti.textContent.trim()); if (_tt.ts) { ntv.ts = _tt.ts; ntv.str = _tt.str; } }
    }
    if (!userName) _logMiss(container, '昵称缺失', userId);
    if (!ntv.ts) _logMiss(container, '时间缺失', userName || userId);
    return { userId, userName, userLink, signalType, likedComment, likedNote: likedNote.slice(0, 60), signalText: (txt.slice(0, 160) || ''), ts: ntv.ts, timeStr: ntv.str, time: ntv.str };
  }

  // 抓取诊断：昵称/时间没抓到时，把整条通知的原始 HTML 打上控制台，便于定位不同 DOM 变体
  function _logMiss(c, label, who) {
    try { console.warn('[抓取诊断] ' + label + '「' + (who || '?') + '」: ', c.outerHTML); } catch (_) {}
  }

  // ── 获客：收集"赞了我们内容/评论"的人。点赞的人意愿低但能直接发销售资料；
  //    每个点赞通知记录它赞的是我们的哪条评论（quote-info 即我们写的那条）。
  async function collectLikers(request) {
    if (!/\/notification/.test(location.href)) return { success: false, error: '不在通知页(/notification)，请先打开通知页' };
    // 已知用户集合（已在清单里的人，用于"滚到有重复即停"的增量）
    const known = new Set((request && request.existingIds) || []);
    const _knownUid = (c) => { const id = _extractNotificationUserId(c); return id ? String(id).toLowerCase() : ''; };
    // ★ 通知页顶部分类 tab：默认「评论和@」只展示回复；「赞和收藏」「新增关注」在别的 tab，必须逐个切过去才能收全。
    //   顺序：回复/关注类在前（高价值，且避免被单次 cap 窗口里的"赞"挤掉），赞和收藏最后。
    const NOTIF_TABS = ['评论和@', '新增关注', '赞和收藏'];
    const DEFAULT_TAB = '评论和@';
    const _tabs = () => [...document.querySelectorAll('.reds-tab-item')].filter(el => {
      const t = (el.textContent || '').trim();
      return NOTIF_TABS.includes(t);
    });
    // 轮询等待顶部 tab 出现（懒加载/慢网络/页面刚跳转兜底）
    let tabs = _tabs();
    for (let i = 0; i < 8 && tabs.length === 0; i++) {
      _showStatus('等待通知页 tab...');
      await sleep(1400 + Math.round(Math.random() * 900));
      tabs = _tabs();
    }
    if (tabs.length === 0) {
      // 顶tab都找不到但页面有通知项（结构大改）→ 退回到"当前 tab 直接收"的老逻辑
      const fallback = await _collectNotifTabAll();
      return fallback;
    }
    // 切到指定 tab 并强校验"真的切过去了"：
    //   ① 点后等它带上 active；② 等可见内容出现该 tab 的关键词（或确认 active 且内容加载稳定）
    const switchTab = async (name, kwRe) => {
      const isActive = () => {
        const t = _tabs().find(el => (el.textContent || '').trim() === name);
        return !!(t && /\bactive\b/.test(String(t.className || '')));
      };
      if (!isActive()) {
        const tab = _tabs().find(el => (el.textContent || '').trim() === name);
        if (!tab) return false;
        try { tab.click(); } catch (_) { try { tab.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window })); } catch (__) { return false; } }
      }
      // 等 active 出现（最多 ~2s）
      for (let i = 0; i < 6; i++) { if (isActive()) break; await sleep(500 + Math.round(Math.random() * 500)); }
      // 等该 tab 内容出现关键词，避免"还没渲染就仍停留在上一个 tab 的内容"（→ 重复 0 收）
      for (let i = 0; i < 6; i++) {
        const cs = _getNotificationContainers();
        if (cs.length && cs.some(c => kwRe.test(c.textContent || ''))) return true;
        await sleep(700 + Math.round(Math.random() * 600));
      }
      // 内容没关键词：若已确认 active 但恰好是空 tab，也允许收集（空则自然 0）
      return isActive();
    };
    const TAB_KW = {
      '赞和收藏': /(赞了|收藏了)/,
      '新增关注': /(关注了|关注了你|新增关注|关注你)/,
      '评论和@': /(回复了你的|评论了你的|评论你的|回复你的)/,
    };
    // 展开"历史/查看更多"按钮：XHS 通知各 tab 常用"查看历史/展开"收起旧记录，点一下再滚才能拉全
    const _clickExpand = async () => {
      const re = /(历史|查看全部|查看更多|展开|查看记录|往期)/;
      const cands = [...document.querySelectorAll('div,span,button,a,li')].filter(el => {
        const t = (el.textContent || '').trim();
        if (!t || t.length > 14) return false;
        if (el.children.length > 8) return false;
        if (!re.test(t)) return false;
        let r = { width: 0, height: 0 }; try { r = el.getBoundingClientRect(); } catch (_) {}
        return r.width > 30 && r.height > 18;
      });
      let clicked = 0;
      for (const el of cands.slice(0, 4)) {
        try { el.click(); clicked++; await sleep(900 + Math.round(Math.random() * 700)); } catch (_) { try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window })); clicked++; await sleep(900 + Math.round(Math.random() * 700)); } catch (__) {} }
      }
      return clicked;
    };
    const output = [];
    const seen = new Set();
    const tabCounts = {};
    for (const name of NOTIF_TABS) {
      const ok = await switchTab(name, TAB_KW[name]);
      if (!ok) continue; // 切不过去/找不到该 tab → 跳过，避免收错 tab
      await _clickExpand(); // 点开"历史/更多"，再滚才见全
      // 增量滚动：每滚 1 屏检查是否已撞上"已在清单里的人"；命中或到底则停
      //   → 前面全新不重复的数据会继续一路拉，保证又全又可控。
      // ★ 关键：有的 tab（如"新增关注"）列表在内层可滚动容器，用"从通知项向上找最近的滚容器"去滚，别只滚外层页面
      try {
        const MAX_SCR = 20;
        const _hasKnown = (cs) => Array.from(cs).some(c => _knownUid(c) && known.has(_knownUid(c)));
        const _realScroller = () => {
          const hints = Array.from(document.querySelectorAll('.interaction-hint')).map(e => e.closest('div')).filter(Boolean);
          for (let n of hints) {
            let el = n;
            for (let i = 0; i < 10 && el; i++) {
              if (el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test((window.getComputedStyle(el).overflowY || ''))) return el;
              el = el.parentElement;
            }
          }
          return document.scrollingElement || document.documentElement;
        };
        let prevCount = _getNotificationContainers().length;
        let hitKnown = _hasKnown(_getNotificationContainers());
        let rounds = 0;
        while (!hitKnown && rounds < MAX_SCR) {
          const sc = _realScroller();
          sc.scrollTop = sc.scrollHeight;
          await sleep(1000 + Math.round(Math.random() * 900)); // 拟人：慢一点 + 随机
          const cs = _getNotificationContainers();
          if (cs.length === prevCount) break; // 已到底
          prevCount = cs.length;
          hitKnown = _hasKnown(cs);
          rounds++;
        }
        try { (document.scrollingElement || document.documentElement).scrollTop = 0; } catch (_) {}
        await sleep(300 + Math.round(Math.random() * 400));
      } catch (_) {}
      let tabAdded = 0;
      for (const container of _getNotificationContainers()) {
const it = _likerFromContainer(container, name);
        if (!it || !it.signalType) continue;
        const seenKey = (it.userId || ('nick::' + it.userName)) + '::' + it.signalType;
        if (!seenKey || seen.has(seenKey)) continue;
        seen.add(seenKey);
        tabAdded++;
        output.push({ ...it, cursorKey: seenKey });
      }
      tabCounts[name] = tabAdded;
      // 诊断：新增关注 tab 若极少量，存快照便于定位（为什么只收到几条）
      if (name === '新增关注' && tabAdded <= 4) {
        try {
          const cs = _getNotificationContainers();
          const sc = (document.scrollingElement || document.documentElement);
          const diag = {
            at: new Date().toISOString(),
            tab: name,
            containers: cs.length,
            scrollables: [...document.querySelectorAll('*')].filter(el => { try { return el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(window.getComputedStyle(el).overflowY); } catch (_) { return false; } }).slice(0, 8).map(el => ({ tag: el.tagName, cls: String(el.className || '').slice(0, 60), sh: el.scrollHeight, ch: el.clientHeight })),
            samples: cs.slice(0, 5).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)),
            htmlSample: cs[0] ? String(cs[0].innerHTML || '').slice(0, 500) : '',
            bodySnip: ((document.body || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 300),
          };
          new Promise(r => chrome.storage.local.set({ '_prospect_follow_diag': diag }, r)).catch(() => {});
        } catch (_) {}
      }
      await sleep(1500 + Math.round(Math.random() * 1000)); // 切下一个 tab 前随机停顿，拟人
    }
    // ★ 还原到默认「评论和@」tab：不污染"评论跟进/通知回访"共用本页面读取的流程
    try { if (_tabs().some(t => (t.textContent || '').trim() === DEFAULT_TAB)) await switchTab(DEFAULT_TAB, TAB_KW[DEFAULT_TAB]); } catch (_) {}
    _hideStatus();
    _logNotifResult(output, tabCounts, known.size);
    return { success: true, items: output, count: output.length, url: location.href, tabCounts };
  }

  // 抓取诊断：每次刷新通知，把各 tab 采集到谁列到控制台，便于核对"最新的人有没有进来"
  function _logNotifResult(items, tabCounts, knownSize) {
    try {
      const names = (items || []).map(o => (o.userName || '?') + '@' + (o.signalType || '') + (o.userId ? '' : '(无id)')).slice(0, 40);
      console.warn('[抓取诊断·通知刷新] 已知=' + knownSize + ' tab计数=' + JSON.stringify(tabCounts || {}) + ' 采集=' + (items || []).length + ' 名单=' + JSON.stringify(names) + ' 地址=' + location.href);
    } catch (_) {}
  }

  // 获客搜集的兜底：顶部 tab 识别不到时的"当前可见 tab 直接收"（老逻辑，保留防回归）
  async function _collectNotifTabAll() {
    let containers = _getNotificationContainers();
    for (let i = 0; i < 6 && containers.length === 0; i++) {
      _showStatus('等待通知加载...');
      await sleep(1600 + Math.round(Math.random() * 900));
      containers = _getNotificationContainers();
    }
    if (containers.length === 0) {
      const diag = await _notifDiag();
      return {
        success: false,
        error: '通知页识别不到通知项（可能新版页面改了结构），已保存诊断快照：' + JSON.stringify({
          userLinks: diag.userLinkCount, containers: diag.containerCount, hint: diag.hintCount, avatar: diag.avatarCount,
        }),
        diag,
      };
    }
    _showStatus('加载通知...');
    try {
      const scroller = document.scrollingElement || document.documentElement;
      let prevCount = -1;
      for (let round = 0; round < 3; round++) {
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(1600 + Math.round(Math.random() * 900));
        const c = _getNotificationContainers().length;
        if (c === prevCount) break;
        prevCount = c;
      }
      window.scrollTo(0, 0);
      await sleep(300 + Math.round(Math.random() * 400));
    } catch (_) {}
    const seen = new Set();
    const likers = [];
    for (const container of _getNotificationContainers()) {
      const it = _likerFromContainer(container);
      if (!it || !it.signalType) continue;
      const seenKey = (it.userId || ('nick::' + it.userName)) + '::' + it.signalType;
      if (!seenKey || seen.has(seenKey)) continue;
      seen.add(seenKey);
      likers.push({ ...it, cursorKey: seenKey });
    }
    _hideStatus();
    _logNotifResult(likers, {}, 0);
    return { success: true, items: likers, count: likers.length, url: location.href };
  }

  // ── 获客·消息台：读取消息中心(/chat)的会话列表 ──
  // 每组 `div.xhs-im-conv-item` 提供 data-conv-id（会话id）与伙伴昵称/最近消息/时间。
  // 注意：列表不直接给 partner 的 userId；匹配获客清单靠 convId 或昵称。
  // 解析 /chat 会话"最后消息时间"（相对/绝对 → 时间戳；失败=0）
  function _chatTimeTs(txt, now) {
    const t = String(txt || '').trim();
    if (!t) return 0;
    let m;
    if (/(刚刚|刚才)/.test(t)) return now;
    if ((m = t.match(/(\d+)\s*分钟前/))) return now - (+m[1]) * 60e3;
    if ((m = t.match(/(\d+)\s*小时前/))) return now - (+m[1]) * 3600e3;
    if (/昨天/.test(t)) return now - 24 * 3600e3;
    if ((m = t.match(/(\d+)\s*天前/))) return now - (+m[1]) * 24 * 3600e3;
    if ((m = t.match(/(\d{4})[-年./]\s*(\d{1,2})[-月./]\s*(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    if ((m = t.match(/(\d{1,2})-(\d{1,2})/))) return new Date(new Date().getFullYear(), +m[1] - 1, +m[2]).getTime();
    if ((m = t.match(/(\d{1,2})月(\d{1,2})日/))) return new Date(new Date().getFullYear(), +m[1] - 1, +m[2]).getTime();
    return 0;
  }

  async function collectChatConversations(request) {
    if (!/\/chat/.test(location.href)) return { success: false, error: '不在消息中心(/chat)，请先打开 https://www.xiaohongshu.com/chat' };
    // ★ 已入库 convId 集合：本地方已有=早知道；只要"撞上第一条已知会话"就停（下面是更旧的已入库，无需再滚）
    const known = new Set(Array.isArray(request && request.knownConvIds) ? request.knownConvIds : []);
    const now = Date.now();
    // 真实内层滚动容器（会话列表是懒加载/虚拟化，只滚外层页面没用的）
    const _cScroller = () => {
      for (const n of Array.from(document.querySelectorAll('div.xhs-im-conv-item'))) {
        let el = n;
        for (let i = 0; i < 12 && el; i++) {
          if (el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test((window.getComputedStyle(el).overflowY || ''))) return el;
          el = el.parentElement;
        }
      }
      return document.scrollingElement || document.documentElement;
    };
    // ★ 逐屏快照去重：每滚一屏把所有已渲染会话读进 Map（虚拟化替换节点也不丢）；发现序号=最新在前
    const found = new Map();
    let order = 0;
    let stable = 0;
    let reachedBase = false; // 撞到第一条"已入库"会话 → 其下都是更旧已入库，停
    for (let rnd = 0; rnd < 40 && !reachedBase; rnd++) {
      let hadNew = false;
      document.querySelectorAll('div.xhs-im-conv-item').forEach((el) => {
        const convId = el.getAttribute('data-conv-id') || '';
        if (!convId || found.has(convId)) return;
        if (known.size && known.has(convId)) { reachedBase = true; return; } // 遇到已知 → 停止后再往下（不回滚已入库）
        const kind = el.getAttribute('data-conv-kind') || '';
        const name = (el.querySelector('.xhs-im-conv-item__name') || { textContent: '' }).textContent.trim();
        const time = (el.querySelector('.xhs-im-conv-item__time') || { textContent: '' }).textContent.trim();
        const timeTs = _chatTimeTs(time, now);
        const summary = (el.querySelector('.xhs-im-conv-item__summary-text, .xhs-im-conv-item__summary') || { textContent: '' }).textContent.trim();
        const img = el.querySelector('img.xhs-im-conv-item__avatar');
        const avatar = img ? (img.getAttribute('src') || '') : '';
        let hasUnread = false, unreadCount = 0;
        try {
          const badgeEl = el.querySelector('[class*="badge"], [class*="unread"], [class*="count"], [class*="dot"], [class*="notice"]');
          if (badgeEl) {
            const bt = (badgeEl.textContent || '').trim();
            hasUnread = !!bt && (/^\d+$/.test(bt) || bt === '●' || bt === 'NEW');
            const n = parseInt(bt, 10);
            if (!isNaN(n)) unreadCount = n;
          }
        } catch (_) {}
        const lastMsg = summary.slice(0, 300);
        const lastFrom = hasUnread ? 'them' : '';
        found.set(convId, { convId, convKind: kind, partnerName: name, time, timeTs, lastMsg, fullMsg: lastMsg, avatar, hasUnread, unreadCount, lastFrom, order: order++ });
        hadNew = true;
      });
      if (reachedBase) break;
      // 滚动加载下一屏
      const sc = _cScroller();
      sc.scrollTop = sc.scrollHeight;
      await sleep(800 + Math.round(Math.random() * 600)); // 拟人随机
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) break; // 已滚到底（首装/清库→全量回填）
      if (hadNew) stable = 0; else { stable++; if (stable >= 2) break; }
    }
    // ★ 抓取诊断：实际抓到条数 + 样本，方便与 XHS 后台核对
    try {
      const dNames = Array.from(found.values()).slice(0, 10).map(x => x.partnerName);
      console.warn('[抓取诊断] /chat 会话条数=' + found.size + ' 已知=' + known.size + ' 撞到已知=' + reachedBase + ' 样本=' + JSON.stringify(dNames) + ' 地址=' + location.href);
    } catch (_) {}
    try { (_cScroller()).scrollTop = 0; } catch (_) {} // 回顶部，别让用户以为内容没了
    const items = Array.from(found.values()).sort((a, b) => a.order - b.order); // 有序（最新在前）
    return { success: true, items, count: items.length, url: location.href, reachedBase };
  }

  /* ── 🛰 新消息监听·哨兵：一次"只看不滚"的轻窥 ──
     只读当前已渲染的 DOM：不滚动、不点击、不导航 → 页面上零改动。
     页面锁被别的操作占着就回 busy，让后台本轮直接跳过——哨兵不能走 runExclusive
     （那把锁会 5s×3 排队等锁 + 每次都跑 settleAfterOperation，30s 一次的哨兵用不起）。 */
  function watchPeek() {
    const out = { success: true, at: Date.now(), path: location.pathname, url: location.href, page: 'other' };
    if (_operationLock) return { success: true, busy: true, page: 'busy' };
    // ① /chat：会话列表未读标记 + 首屏会话 id（带 * = 有未读）
    if (/\/chat/.test(location.pathname)) {
      out.page = 'chat';
      const items = Array.from(document.querySelectorAll('div.xhs-im-conv-item'));
      const ids = []; let unread = 0;
      for (const el of items) {
        const id = el.getAttribute('data-conv-id') || '';
        if (!id) continue;
        const has = _convHasUnread(el);
        if (has) unread++;
        if (ids.length < 40) ids.push(has ? id + '*' : id);
      }
      out.n = items.length; out.unread = unread; out.convIds = ids;
      return out;
    }
    // ② /notification：前若干条通知的「用户id|互动类型」（是不是生人由后台比对清单）
    if (/\/notification/.test(location.pathname)) {
      out.page = 'notif';
      const cs = Array.from(_getNotificationContainers());
      const keys = [];
      for (const c of cs.slice(0, 15)) {
        const uid = _extractNotificationUserId(c);
        const txt = (c.textContent || '').replace(/\s+/g, ' ');
        const kind = (txt.match(/赞了|收藏了|关注了|回复了|评论了|回复了你|关注了你|评论你的|赞了你/) || [''])[0];
        keys.push((uid || '?') + '|' + kind);
      }
      out.n = cs.length; out.notifKeys = keys;
      return out;
    }
    // ③ 其它页：左侧导航的小尺寸纯数字节点（角标选择器未定时的兜底信号）
    out.navBadges = _navBadgeSnap();
    return out;
  }
  function _convHasUnread(el) {
    try {
      const b = el.querySelector('[class*="badge"], [class*="unread"], [class*="count"], [class*="dot"], [class*="notice"]');
      if (!b) return false;
      const t = (b.textContent || '').trim();
      return !!t && (/^\d+$/.test(t) || t === '●' || t === 'NEW');
    } catch (_) { return false; }
  }
  function _navBadgeSnap() {
    const out = [];
    try {
      const els = document.querySelectorAll('[class*="badge"],[class*="unread"],[class*="count"],[class*="dot"]');
      for (const el of els) {
        if (el.children && el.children.length) continue;
        const t = (el.textContent || '').trim();
        if (!/^\d{1,3}$/.test(t)) continue;
        let r = null; try { r = el.getBoundingClientRect(); } catch (_) { continue; }
        if (!r || r.width <= 0 || r.height <= 0 || r.width > 48 || r.height > 32) continue;
        const host = el.closest('a,[role="link"],li') || el.parentElement || el;
        let label = '';
        try { label = String((host.getAttribute && (host.getAttribute('aria-label') || host.getAttribute('title'))) || '').slice(0, 12); } catch (_) {}
        out.push(label + '#' + String(el.className || '').slice(0, 24) + '=' + t);
      }
    } catch (_) {}
    return out.sort().slice(0, 12);
  }

  // ── 获客·消息台：在 /chat 会话页发送消息（复用私信的 native setter + 发送按钮/回车 + 限制检测机制）
  async function chatSendMessage(text) {
    if (!/\/chat/.test(location.href)) return { success: false, definitive: true, error: '不在 /chat 会话页，请先打开会话' };
    const raw = String(text || '').trim();
    if (!raw) return { success: false, definitive: true, error: '内容为空' };
    const msg = raw.length > 300 ? raw.slice(0, 300) : raw;

    // 定位输入框（/chat 的编辑器 contenteditable 或通用）
    let inputEl = null;
    for (let i = 0; i < 12; i++) {
      inputEl = _findVisible(document.querySelector('.xhs-im-input-bar-editor[contenteditable="true"], .xhs-im-input-bar-editor, [contenteditable="true"]'));
      if (inputEl) break;
      await sleep(500);
    }
    if (!inputEl) return { success: false, definitive: true, error: '未找到 /chat 输入框（可能会话没打开）' };

    _showStatus('输入消息...');
    inputEl.focus();
    await sleep(dwellMs('noteOpenBuffer', 200)); // 拟人：聚焦后先停顿再输入
    await _typeInto(inputEl, msg);
    await sleep(300);
    await sleep(dwellMs('preSendGap', 400));

    _showStatus('发送消息...');
    const bar = document.querySelector('.xhs-im-input-bar');
    const pickSend = function () {
      const scope = bar || document;
      const btns = [...scope.querySelectorAll('.xhs-im-input-bar-actions button, .xhs-im-input-bar-actions [role="button"], .xhs-im-input-bar-actions svg, button, [role="button"]')].filter(function (el) { return _findVisible(el); });
      for (const el of btns) {
        const title = el.getAttribute('title') || '';
        const aria = el.getAttribute('aria-label') || '';
        const c = String(el.className || '');
        const svg = el.tagName === 'svg' ? ((el.querySelector('title') || { textContent: '' }).textContent || '') : '';
        if (title.includes('发送') || aria.includes('发送') || svg.includes('发送') || /send|发送/i.test(c)) return el;
      }
      // ★ /chat 的发送按钮是纯图标 `button.xhs-im-input-bar-action-btn`（无文字/aria/send 类，仅图标），真机勘探确认
      try { const ab = bar ? bar.querySelector('.xhs-im-input-bar-action-btn') : document.querySelector('.xhs-im-input-bar-action-btn'); if (ab && _findVisible(ab)) return ab; } catch (_) {}
      return null;
    };
    // 发送：按钮优先 → Enter 兜底，每次验证内容是否清空，未发成功就换下一法；发现"隐私限制"立即停手
    let sendBtn = pickSend();
    await sleep(400); // 给发送按钮出现留时间
    if (!sendBtn) sendBtn = pickSend(); // 文字写入后再查一次
    let sentOk = false, via = '';
    for (let attempt = 0; attempt < 4 && !sentOk; attempt++) {
      if (attempt === 0 && sendBtn) { _click(sendBtn); await sleep(700); via = 'button'; }
      else { _pressEnterDm(inputEl); await sleep(750); via = 'enter'; }
      if (_dmSent(inputEl)) { sentOk = true; break; }
      if (_detectPrivacy()) {
        _hideStatus();
        return { success: false, privacy: true, definitive: true, limited: true, error: '对方设置了隐私设置（或未关注你），暂时无法私信回复。建议① 评论区互动破冰后再试；② 或先关注对方待通过。此用户已标记"私信受限"。' };
      }
    }

    const limitRe = /(关注后才能|关注后即可|无法发送|不能发送|私信限制|被限制|防骚扰|对方.*关注|暂不支持|隐私设置|不能回复|回复不了)/;
    const limited = limitRe.test((document.body.innerText || '').slice(-1000));
    _hideStatus();
    if (limited && !sentOk) return { success: false, definitive: false, error: '检测到发送限制提示（可能对方未关注你/防骚扰），建议先评论互动破冰', limited: true };
    return { success: sentOk, definitive: false, via, error: sentOk ? '' : '发送未确认，请手动检查该会话' };
  }

  // ── 获客·逐条归因：读当前 /chat 会话的消息线程，判断"对方是否回过你" ──
  //   DOM 启发式：按消息条目的类名/归属区分 对方(left/other/peer) vs 我方(right/self/mine)。
  //   归不出类但存在消息时 → 保守视为"已接触过"(hasAny)。升级主判据=theirsCount>0。
  async function scanChatConversation() {
    if (!/\/chat/.test(location.href)) return { success: false, error: '不在 /chat 会话页，请先打开会话' };
    _showStatus('读取会话线程…');
    await sleep(dwellMs('browseDwell', 300)); // 拟人：读取会话前浏览停顿
    const rows = Array.from(document.querySelectorAll('[class*="message"], [class*="msg-item"], [class*="bubble"], [class*="im-msg"], [class*="conv-msg"], [class*="message-item"], [class*="item-container"]'));
    let theirs = 0, mine = 0, lastTheirs = '', lastMine = '';
    for (const el of rows) {
      const cls = String(el.className || '');
      const text = (el.innerText || '').trim();
      if (!text || text.length < 2) continue;
      const left = /left|other|peer|friend|receiver|receive|对方|they/i.test(cls);
      const right = /right|self|mine|own|sender|send|me\b|我方/i.test(cls);
      if (left || (!right && /left|other|peer|receiver/.test(cls))) { theirs++; lastTheirs = text; }
      else if (right) { mine++; lastMine = text; }
      // 类名无法归属的（无 left/right 特征）→ 跳过，不作为判断依据
    }
    // 兜底：挑不到归属类，但页面确实存在消息体 → 记 hasAny（不强推 theirs）
    const hasAny = !!document.querySelector('[class*="message"], [class*="msg"], [class*="bubble"]');
    _hideStatus();
    return {
      success: true,
      theirs,
      mine,
      hasTheirs: theirs > 0,
      theirsCount: theirs,
      mineCount: mine,
      hasAny,
      lastMsg: lastTheirs || lastMine,
      lastFrom: theirs > 0 ? 'them' : (mine > 0 ? 'me' : ''),
    };
  }

  /* ── 评论跟进：回复指定通知（★ 三重定位保障，用户核心要求：绝不能回错人/回错消息） ──
   * request: { idx, replyText, userId, userName, latestText }
   *   保障① idx 锚点：与提取时同一编号规则精确定位通知项
   *   保障② 发送前交叉校验：该位置的 user_id + 最新消息文本必须与目标一致，不一致立即中止，绝不盲发
   *   保障③ 文本兜底：idx 失效（列表变化）→ 用 user_id + 最新文本全列表搜索；找不到就报错
   */
  async function replyNotification(request) {
    const idx = request.idx;
    let replyText = request.replyText || '';
    const userId = request.userId || '';
    const userName = request.userName || '';
    const latestText = request.latestText || '';

    // ★ 300 字硬截断（小红书限制，与 sendReplyToComment 同口径）
    if (replyText.length > 300) {
      let cut = replyText.slice(0, 300);
      const lastPunc = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('~'), cut.lastIndexOf('～'), cut.lastIndexOf('!'), cut.lastIndexOf('？'), cut.lastIndexOf('?'));
      if (lastPunc >= 240) cut = cut.slice(0, lastPunc + 1);
      replyText = cut;
    }

    // ===== 1. 定位：① idx 锚点，失效时 ③ 文本兜底搜索 =====
    _showStatus('定位通知项...');
    let containers = _getNotificationContainers();
    let container = null;
    let via = '';
    if (idx >= 0 && idx < containers.length) {
      container = containers[idx];
      via = 'idx锚点';
    } else if (userId || latestText) {
      for (const c of containers) {
        const cUserId = _extractNotificationUserId(c);
        const cText = (c.querySelector('.interaction-content') || { textContent: '' }).textContent.trim();
        const idOk = !userId || (cUserId && cUserId === userId);
        const textOk = !latestText || (cText && (cText === latestText || cText.includes(latestText.slice(0, 20)) || latestText.includes(cText.slice(0, 20))));
        if (idOk && textOk) { container = c; via = '文本兜底'; break; }
      }
    }
    if (!container) {
      _hideStatus();
      return { success: false, error: '定位失败：未找到该通知项（页面可能已刷新，请重新同步后再回复）' };
    }

    // ===== 2. 保障②：发送前交叉校验（user_id + 最新消息文本必须一致） =====
    const curUserId = _extractNotificationUserId(container);
    const curText = (container.querySelector('.interaction-content') || { textContent: '' }).textContent.trim();
    if (userId && curUserId && curUserId !== userId) {
      _hideStatus();
      return { success: false, error: '定位校验未通过：该位置的通知用户与目标不一致（防止错位回复），请重新同步后再试' };
    }
    if (latestText && curText && curText !== latestText) {
      _hideStatus();
      return { success: false, error: '定位校验未通过：该位置的通知内容已变化（防止回错消息），请重新同步后再试' };
    }
    console.log('[通知回复] ✅ 定位确认（' + via + '）: @' + userName + '（' + curUserId + '）→ ' + curText.slice(0, 30));

    // ===== 3. 滚动到可视区并点击回复按钮 =====
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(dwellMs('noteOpenBuffer', 300)); // 拟人：定位到通知项后停留再交互
    const replyBtn = container.querySelector('.action-reply');
    if (!replyBtn) {
      _hideStatus();
      return { success: false, error: '该通知没有回复按钮（原评论可能已删除），已跳过' };
    }
    replyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);
    replyBtn.click();
    replyBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    replyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // ===== 4. 等待回复输入框出现（行内展开在通知项内部，idx 不漂移） =====
    _showStatus('等待回复输入框...');
    let inputEl = null;
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      inputEl = container.querySelector('textarea.comment-input');
      if (inputEl) break;
      // 兜底：全局找到的输入框必须确认在目标通知项内（在别的项里 = 定位错位，不采用）
      const globalInput = document.querySelector('textarea.comment-input');
      if (globalInput && container.contains(globalInput)) inputEl = globalInput;
    }
    if (!inputEl) {
      _hideStatus();
      return { success: false, error: '回复输入框未出现（可能页面结构变化），请手动重试' };
    }

    // ===== 5. 交叉验证 placeholder（“回复 {昵称}”） =====
    _showStatus('交叉验证回复对象...');
    let ph = inputEl.getAttribute('placeholder') || '';
    if (userName && ph && !ph.includes(userName) && !ph.includes('回复')) {
      await sleep(400); // placeholder 可能没立即刷新，等一次再核
      ph = inputEl.getAttribute('placeholder') || '';
    }
    if (userName && ph && ph.includes('回复') && !ph.includes(userName)) {
      const wrongName = ph.replace('回复', '').trim() || '?';
      try { inputEl.blur(); } catch (_) {}
      _hideStatus();
      return { success: false, error: '交叉验证未通过：打开的是“回复 ' + wrongName + '”的输入框（应为 ' + userName + '），已放弃以防回错人' };
    }

    // ===== 6. 填值（拟人：逐字输入，0 则一次性填入；触发 React onChange） =====
    _showStatus('输入回复内容...');
    inputEl.focus();
    await sleep(100);
    await _typeInto(inputEl, replyText);
    await sleep(80);

    // ===== 6.5 拟人：发送前先停留，避免秒发 =====
    await sleep(dwellMs('preSendGap', 400));

    // ===== 7. 发送（按钮优先，Enter 兜底；发送成功三重信号防重复提交） =====
    _showStatus('发送回复...');
    const sendBtn = container.querySelector('button.submit')
      || (inputEl.closest('.input-wrapper') ? inputEl.closest('.input-wrapper').querySelector('button.submit') : null)
      || document.querySelector('button.submit');
    const probe = replyText.slice(0, 40);
    const _sentSignals = () => {
      try {
        if (!document.contains(inputEl)) return 'inputGone';
        // 最精确：目标通知项内已出现本次回复（quote-info 更新）
        const quoteEl = container.querySelector('.quote-info');
        if (quoteEl) {
          const qt = quoteEl.textContent.trim();
          if (probe && qt.includes(probe)) return 'quoteUpdated';
        }
        const val = inputEl.value || '';
        if (val.trim().length === 0) return 'inputCleared';
        // 页面上已渲染本次回复文本（排除输入框自身）
        if (probe) {
          for (const el of document.querySelectorAll('div, span, p')) {
            if (el.contains(inputEl) || inputEl.contains(el)) continue;
            const t = el.textContent.trim();
            if (t.includes(probe) && t.length < replyText.length + 80) return 'echoOnPage';
          }
        }
      } catch (_) {}
      return '';
    };
    let sentOk = false;
    let sentVia = '';
    const _stopIfSent = (where) => {
      if (sentOk) return true;
      const sig = _sentSignals();
      if (sig) {
        sentOk = true; sentVia = sig;
        console.log('[通知回复] ✅ 已确认提交（' + sig + ' @ ' + where + '），停止后续补点，防重复');
        return true;
      }
      return false;
    };
    if (sendBtn) {
      for (let attempt = 0; attempt < 3 && !sentOk; attempt++) {
        if (_stopIfSent('按钮第' + (attempt + 1) + '次点击前')) break;
        _showStatus(`点击发送 (${attempt + 1}/3)...`);
        sendBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await sleep(200);
        sendBtn.click();
        sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(800);
        if (_stopIfSent('按钮第' + (attempt + 1) + '次点击后')) break;
      }
    }
    if (!sentOk) {
      inputEl.focus();
      await sleep(100);
      for (let attempt = 0; attempt < 3 && !sentOk; attempt++) {
        if (_stopIfSent('Enter第' + (attempt + 1) + '次前')) break;
        _showStatus(`Enter 发送 (${attempt + 1}/3)...`);
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        await sleep(600);
        if (_stopIfSent('Enter第' + (attempt + 1) + '次后')) break;
      }
    }

    // ===== 8. 收尾：关闭回复框（取消按钮优先，blur 兜底），防残留影响下一条 =====
    _showStatus('收尾：关闭回复框...');
    try {
      const cancelBtn = container.querySelector('.action-cancel');
      if (cancelBtn && inputEl.offsetParent !== null) cancelBtn.click();
      else { try { inputEl.blur(); } catch (_) {} }
      await sleep(400);
    } catch (_) {}

    _hideStatus();
    if (!sentOk) {
      return { success: false, error: '发送未确认（输入框仍保留内容），请手动检查该通知项', notSent: true };
    }
    return { success: true, verified: sentVia === 'echoOnPage' || sentVia === 'quoteUpdated' ? 'confirmed' : sentVia, via };
  }

  // ── 获客清单：私信（打开用户主页 → 点私信 → 发送） ──
  // ★ 说明：网页版「私信」入口的 DOM 结构因改版/设备而异。这里用多级选择器兜底：
  //   ①定位「私信」按钮（文本/class/aria） ②点开聊天窗 ③定位输入框 ④输入 ⑤定位发送按钮/回车
  //   任一环节找不到 → 返回明确错误并附 limited 标记（提示可能被陌生人私信限制），由 background 降级为「打开主页人工发」。
  function _findVisible(el) {
    if (!el) return null;
    try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? el : null; } catch (_) { return null; }
  }
  function _click(el) {
    if (!el) return;
    // 更接近真实鼠标：带真实元素中心坐标 + 完整 pointer/mouse 序列 + 原生 click 兜底
    try {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const base = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      el.dispatchEvent(new PointerEvent('pointerover', Object.assign({}, base, { pointerType: 'mouse' })));
      el.dispatchEvent(new MouseEvent('mouseover', Object.assign({}, base)));
      el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, { buttons: 1 })));
      el.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, base, { buttons: 1 })));
      el.focus && el.focus();
      el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, { buttons: 0 })));
      el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, base, { buttons: 0 })));
      el.dispatchEvent(new MouseEvent('click', Object.assign({}, base)));
    } catch (_) {}
    // 原生 click 兜底：让浏览器原生点击（某些 React 处理依赖原生事件派发）
    try { if (typeof el.click === 'function') el.click(); } catch (_) {}
  }

  // ★ 工作流拆分：先「打开主页」，再「发私信」，两步可独立验证。
  //   Step1 openUserProfile → 只导航到对方主页（不点私信）；
  //   Step2 sendDmOnProfile  → 前提是已在用户主页，才做「点私信→聊天窗→输入→发送」。
  //   导航会卸载内容脚本，所以发私信必须等已到主页后单独再触发一次。

  // 是否已在目标用户主页
  // 把可能为相对路径的 userLink 归一化成绝对 URL（/user/x → https://www.xiaohongshu.com/user/x），供导航与比对
  function absUserUrl(u) {
    if (!u) return '';
    u = String(u).trim().split('?')[0];
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    return location.origin + u;
  }

  function isOnUserProfile(userLink) {
    if (!userLink) return false;
    const target = absUserUrl(userLink);
    if (!target) return false;
    return location.href.split('?')[0].startsWith(target.split('?')[0]);
  }

  // 定位「私信/回复」按钮。★ 第一优先：私信按钮内含专属图标 class "xhs-user-im-btn-icon"（用户提供），
  //   取该 svg 的外层 button。比 XPath 更抗页面结构变化。
  function _findByDmXPath() {
    // ★★ 1) 首选精确 class：小红书私信按钮是 <button class="xhs-user-im-btn" title="发消息">（从真实 HTML 确认）
    try {
      const btn = document.querySelector('button.xhs-user-im-btn, button[title="发消息"], button[title="私信"], button[title="发私信"]');
      if (btn && _findVisible(btn)) {
        console.log('[DM定位] 命中 xhs-user-im-btn (title=' + (btn.getAttribute('title') || '') + ')');
        return btn;
      }
    } catch (_) {}
    // 2) 专属图标 class → 外层 button
    try {
      const svg = document.querySelector('svg.xhs-user-im-btn-icon');
      if (svg && svg.closest) {
        const btn2 = svg.closest('button') || svg.parentElement;
        if (btn2 && _findVisible(btn2)) {
          console.log('[DM定位] 命中专属图标 xhs-user-im-btn-icon →', btn2.tagName, (btn2.getAttribute('title') || ''));
          return btn2;
        }
      }
    } catch (_) {}
    // 3) 用户提供的完整 XPath（从 body 起）
    const fullPaths = [
      '/html/body/div[2]/div[1]/div[2]/div[2]/div/div[1]/div/div[2]/div[2]/div[1]/button',
      '//*[@id="userPageContainer"]/div[1]/div/div[2]/div[2]/div[1]/button',
      '//svg[contains(@class,"xhs-user-im-btn-icon")]/ancestor::button[1]',
      '//svg[contains(@class,"xhs-user-im-btn-icon")]/parent::*',
    ];
    for (const xp of fullPaths) {
      try {
        const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = r && r.singleNodeValue;
        if (node && _findVisible(node) && (node.tagName === 'BUTTON' || (node.querySelector || node.closest))) {
          const final = (node.tagName === 'BUTTON') ? node : (node.closest && node.closest('button'));
          if (final && _findVisible(final)) {
            console.log('[XPath] 命中:', xp);
            return final;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  // ★ 只打开私信聊天窗（不发送）：定位「私信」按钮 → 点开 → 等聊天窗输入框出现。
  //   独立成函数，供「💬 开私信」按钮验证，也复用于 sendDmOnProfile 的第一步。
  async function openDmChat(userLink) {
    // 0) 前提：必须在用户主页
    if (userLink && !isOnUserProfile(userLink)) {
      return { success: false, needLocate: true, error: '还未在目标用户主页，请先「📎 定位」打开该用户主页' };
    }
    // 1) 定位「私信」按钮。
    //   ★ 第一优先级：用户提供的精确 XPath（#userPageContainer/.../div[2]/div[2]/div[1]/button），用 document.evaluate 直接命中
    _showStatus('定位私信按钮...');
    await sleep(900);
    let dmBtn = _findByDmXPath();
    if (!dmBtn) {
      // 兜底：容器内第一个可见 button（按语义排除关注）
      const profileRoot = document.querySelector('#userPageContainer') || document.body;
      const isFollowText = (t) => t === '关注' || /^(已关注|互相关注|回关)$/.test(t) || (t && t.indexOf('关注') === 0 && t.length <= 5);
      for (const el of Array.from(profileRoot.querySelectorAll('button, [role="button"]'))) {
        if (!_findVisible(el)) continue;
        const t = (el.innerText || '').trim();
        const all = (t + (el.getAttribute('aria-label') || '') + (el.getAttribute('title') || '')).toLowerCase();
        if (isFollowText(t)) continue;
        if (/(私信|聊天|发消息|message)/.test(all) || (el.querySelector && el.querySelector('svg'))) { dmBtn = el; break; }
      }
    }
    if (!dmBtn) {
      console.log('[开私信诊断] 未命中，页面含 #userPageContainer=', !!document.querySelector('#userPageContainer'));
      _hideStatus();
      return { success: false, error: '未找到「私信」按钮（已打开主页）。请手动点击该用户的私信按钮。' };
    }
    _click(dmBtn);
    console.log('[开私信] 已点击:', dmBtn.tagName, (dmBtn.innerText || '').trim().slice(0, 6), (dmBtn.getAttribute('aria-label') || '').slice(0, 10));
    // 2) 点击私信按钮。★ 小红书网页版点「发消息」是 window.open 新开聊天窗口。
    //   拦截 window.open 阻止真弹窗，并保持拦截直到异步捕获到 URL（或超时），避免被浏览器当弹窗拦掉。
    //   捕获到 URL 后交给 background 在同一受控标签页导航过去。
    const cap = _captureWindowOpen();
    try { _click(dmBtn); } catch (_) {}
    // 轮询等异步 window.open 触发（最长 ~6s），期间不还原拦截器
    let chatUrl = '';
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      if (cap.url) { chatUrl = cap.url; break; }
    }
    try { cap.restore(); } catch (_) {}
    console.log('[开私信] 私信按钮点击后 window.open 捕获 URL:', chatUrl);
    // 若捕获到聊天 URL → 交给 background 本页导航（聊天窗口即此 URL）
    if (chatUrl) {
      return { success: true, chatReady: false, chatUrl: chatUrl };
    }
    _hideStatus();
    return { success: false, error: '已点击私信按钮，但未捕获到聊天窗地址（可能未登录、私信入口异常，或按钮用其它方式跳转），请手动发送。' };
  }

  // 拦截 window.open，记录打开的第一个 URL，并返回 null 阻止真弹窗。
  // ★ 还原由调用方在捕获到 URL（或超时）后显式调用 restore()，避免异步触发 window.open 时拦截器已被还原导致浏览器弹窗被拦。
  function _captureWindowOpen() {
    let url = '';
    const orig = window.open;
    try {
      window.open = function () {
        try { if (!url && typeof arguments[0] === 'string') url = arguments[0]; } catch (_) {}
        return null; // 阻止新弹窗（由 background 在本标签页导航到该 URL）
      };
    } catch (_) {}
    return {
      get url() { return url; },
      restore: function () { try { window.open = orig; } catch (_) {} },
    };
  }

  // Step2：发私信（假设已在用户主页）。仅点私信→聊天窗→输入→发送，不再导航。
  function _findDmSendBtn() {
  const all = document.querySelectorAll('button, [role="button"]');
  for (const el of all) {
    if (!_findVisible(el)) continue;
    const t = (el.innerText || '').trim();
    const aria = (el.getAttribute('aria-label') || '');
    const c = String(el.className || '');
    if (t === '发送' || aria.includes('发送') || /(^|[\s_-])(send|submit)([\s_-]|$)/i.test(c) || t === 'Send') return el;
  }
  return null;
}
function _pressEnterDm(inputEl) {
  if (!inputEl) return;
  ['keydown', 'keypress', 'keyup'].forEach(function (type) {
    try {
      inputEl.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    } catch (_) {}
  });
}
// 是否已发出：输入框内容被清空（小红书发送成功后清空输入区）
function _dmSent(inputEl) {
  try {
    if (!inputEl) return true;
    let v = '';
    if (inputEl.tagName === 'TEXTAREA') v = inputEl.value || '';
    else v = inputEl.innerText || inputEl.textContent || '';
    return !String(v).replace(/\s/g, '').length;
  } catch (_) { return false; }
}
// 检测"对方隐私设置/未关注无法私信"类提示
const _PRIVACY_RE = /(隐私设置|对方.*隐私|隐私.*(拒绝|关闭|禁止)|好友验证|开启.*验证|拒绝接收|拒收|无法私信|不能私信|不可以私信|不能给他|不能回复你|暂时.*回复不了|回复不了你|需要你关注|未关注.*私信|对方.*设置)/;
function _detectPrivacy() {
  try {
    const toast = document.querySelector('[class*="toast"], [class*="notice"], [class*="tip"], [role="alert"], [class*="modal"]');
    if (toast && toast.innerText) return _PRIVACY_RE.test(toast.innerText);
    const t = document.body ? document.body.innerText : '';
    return _PRIVACY_RE.test(t.slice(-1500));
  } catch (_) { return false; }
}
// ★ 私信发送：按钮优先 → Enter 兜底，每次发送后验证内容是否清空，未发成功就换下一法；发现"隐私限制"立即停手
async function _dmTrySend(inputEl) {
  const sendBtn = _findDmSendBtn();
  let sent = false;
  for (let attempt = 0; attempt < 4 && !sent; attempt++) {
    if (attempt === 0 && sendBtn) { _click(sendBtn); await sleep(650); }
    else { _pressEnterDm(inputEl); await sleep(750); }
    if (_dmSent(inputEl)) { sent = true; break; }
    if (_detectPrivacy()) return { sent: false, privacy: true };
  }
  return { sent: sent, privacy: false };
}

async function sendDmOnProfile(userLink, text) {
    // 0) 前提校验：必须在用户主页，否则拒绝并提示先定位
    if (userLink && !isOnUserProfile(userLink)) {
      return { success: false, error: '还未在目标用户主页，请先「📎 定位」打开该用户主页后再发送私信', needLocate: true };
    }

    // 1) 定位「私信」按钮。策略：以「关注」按钮为锚，在其相邻/同一操作条里挑一个"非关注、非其他动作"的可点元素。
    //   ★ 不依赖按钮文字/class（XHS 私信按钮常是纯图标，文字可能是"私信"也可能为空）。
    _showStatus('定位私信按钮...');
    await sleep(900);
    // ★ 作用域收缩到用户主页容器：#userPageContainer（用户提供的按钮就在这里面），排除其它页面噪音
    const profileRoot = document.querySelector('#userPageContainer') || document.body;
    const _clickables = () => Array.from(profileRoot.querySelectorAll('button, a, [role="button"]'));
    // 锚点：找「关注/已关注/回关」
    const isFollowText = (t) => t === '关注' || /^(已关注|互相关注|回关)$/.test(t) || (t && t.indexOf('关注') === 0 && t.length <= 5);
    let followBtn = null;
    for (const el of _clickables()) {
      if (!_findVisible(el)) continue;
      const t = (el.innerText || '').trim();
      const aria = (el.getAttribute('aria-label') || '');
      if (isFollowText(t) || isFollowText(aria)) { followBtn = el; break; }
    }
    // ★ 精确命中（用户提供的 XPath）优先
    let dmBtn = _findByDmXPath();
    if (!dmBtn) {
      // 兜底：容器内第一个可见 button（语义排除关注）
      const exactBtn = document.querySelector('#userPageContainer button');
      if (exactBtn && _findVisible(exactBtn) && !isFollowText((exactBtn.innerText || '').trim())) {
        dmBtn = exactBtn;
      }
    }
    // ★ 从「关注」附近挑：兄弟容器里，排除关注，挑最像发私信的
    const _looksLikeDm = (el) => {
      const t = (el.innerText || '').trim();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const all = t + '|' + aria + '|' + title;
      if (/(私信|发私信|聊天|发消息|发送消息|私聊|发短消息|message)/.test(all)) return true;
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && !t && el.querySelector && el.querySelector('svg')) return true;
      return false;
    };
    const _scoreDm = (el, follow) => {
      let s = 0;
      const t = (el.innerText || '').trim();
      const aria = ((el.getAttribute('aria-label') || '') + (el.getAttribute('title') || '')).toLowerCase();
      if (/(私信|发私信|聊天|发消息|message)/.test(aria) || t === '私信' || t === '发私信' || t === '聊天' || t === '发消息') s += 100;
      else if (/(私信|聊天|发消息|message|dm)/.test(aria + t)) s += 50;
      if (el.querySelector && el.querySelector('svg')) s += 5;
      if (follow) {
        const rb = follow.getBoundingClientRect(), eb = el.getBoundingClientRect();
        const d = Math.abs(rb.left - eb.left) + Math.abs(rb.top - eb.top);
        if (d < 200) s += 30 - Math.min(d, 30);
      }
      return s;
    };
    if (!dmBtn) {
      const followRow = (followBtn && followBtn.closest && (followBtn.closest('[class*="btn-group"],[class*="actions"],[class*="follow-row"],[class*="operation"],header'))) || (followBtn && followBtn.parentElement) || profileRoot;
      const pool = Array.from(followRow.querySelectorAll('button, a, [role="button"]'))
        .filter(function (el) { return _findVisible(el) && el !== followBtn; });
    // 打分选最像的
    let best = null, bestScore = -1;
    for (const el of pool) {
      if (el === followBtn) continue;
      if (t0(el) && isFollowText(t0(el))) continue; // 排除其它"关注"形按钮
      const s = _scoreDm(el, followBtn);
      if (s > bestScore) { bestScore = s; best = el; }
    }
    if (best && bestScore > 5) dmBtn = best;
    if (!dmBtn) {
      // 全页兜底：按 dm 语义
      for (const el of _clickables()) {
        if (!_findVisible(el) || el === followBtn) continue;
        if (_looksLikeDm(el) && _scoreDm(el, followBtn) > 3) { dmBtn = el; break; }
      }
    }
    function t0(el) { return (el.innerText || '').trim(); }
    if (!dmBtn) {
      const diag = _clickables().filter(function (el) { return _findVisible(el); }).slice(0, 25).map(function (el) {
        return '[' + el.tagName + ']' + ((el.innerText || '').trim().slice(0, 6)) + '|' + ((el.getAttribute('aria-label') || '').slice(0, 6));
      });
      console.log('[私信诊断] 关注:', !!(followBtn), '跟随行按钮数:', pool.length, '| 候选:', JSON.stringify(diag));
      _hideStatus();
      return { success: false, error: '未找到「私信」按钮（已打开对方主页。可能是未登录、对方关闭私信，或页面结构改版），请手动点击私信发送。', limited: true };
    }
    }
    // ★ 拦截 window.open：小红书点「发消息」会新开聊天窗口；捕获 URL 交给 background 本页导航发送。
    //   保持拦截直到异步捕获到 URL（或超时），避免被浏览器当弹窗拦掉
    const cap2 = _captureWindowOpen();
    try { _click(dmBtn); } catch (_) {}
    console.log('[私信] 已点击:', dmBtn.tagName, '|', (dmBtn.innerText || '').trim().slice(0, 6), '|', (dmBtn.getAttribute('aria-label') || '').slice(0, 10));
    let chatUrl2 = '';
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      if (cap2.url) { chatUrl2 = cap2.url; break; }
    }
    try { cap2.restore(); } catch (_) {}
    if (chatUrl2) {
      // 需要导航到聊天页后再发送：返回 chatUrl，由 background 加载该页并再次调用发送
      return { success: false, needNavigate: true, chatUrl: chatUrl2, error: '已打开聊天窗口地址，等待导航后发送' };
    }

    // 3) 等待聊天窗渲染，定位输入框（某些环境私信按钮在当前页直接展开输入框）
    _showStatus('等待聊天窗...');
    let inputEl = null;
    for (let i = 0; i < 12; i++) {
      await sleep(600);
      inputEl = _findVisible(document.querySelector('[contenteditable="true"]'))
        || _findVisible(document.querySelector('textarea[placeholder], [role="textbox"]'))
        || _findVisible(document.querySelector('textarea'));
      if (inputEl) break;
    }
    if (!inputEl) {
      _hideStatus();
      return { success: false, error: '聊天窗输入框未出现。可能被陌生人私信限制或页面异常，请手动发送。', limited: true };
    }

    // 4) 输入（native setter + input 事件，触发 React onChange）
    _showStatus('输入私信内容...');
    inputEl.focus();
    await sleep(120);
    const tag = inputEl.tagName.toLowerCase();
    let setter = null;
    try {
      setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      if (!setter && tag === 'div') setter = Object.getOwnPropertyDescriptor(window.HTMLDivElement.prototype, 'innerText').set;
    } catch (_) {}
    if (setter) setter.call(inputEl, text);
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    await sleep(dwellMs('preSendGap', 400)); // 拟人挡位：发送私信前先停留，避免即时跳发

    // 5) 发送（按钮优先，Enter 兜底，带验证重试；检测隐私限制则停手）
    _showStatus('发送私信...');
    const res = await _dmTrySend(inputEl);
    _hideStatus();
    if (res.privacy) {
      return { success: false, privacy: true, limited: true, error: '对方设置了隐私设置（或未关注你），暂时无法私信回复。建议：① 评论区互动破冰后再试；② 或去「消息台」用 /chat 直接开聊；③ 或先关注对方待通过。此用户已标记为"私信受限"，可在清单管理。' };
    }
    return { success: res.sent, error: res.sent ? '' : '发送未确认，请手动检查', verified: res.sent };
  }

  // 兼容入口入口：Step1(开主页，非主页时) + Step2(发私信)。导航会卸载脚本 → 优先返回 navigating 由前端再驱动一次
  async function sendUserDm(userLink, text) {
    const target = absUserUrl(userLink);
    if (target && !isOnUserProfile(target)) {
      _showStatus('正在打开用户主页...');
      location.href = target;
      return { success: false, navigating: true, error: '已开始导航到用户主页，请等页面加载完成后再点一次「发送」' };
    }
    return await sendDmOnProfile(userLink, text);
  }

  // ★ 现场定位「私信」按钮：找到后用红色高亮框 + 滚动到可视区，并返回按钮信息，让用户直观确认脚本找到了哪个。
  function locateDmButton() {
    const btn = _findByDmXPath();
    const info = {
      found: !!btn,
      tag: btn ? btn.tagName : '',
      className: btn ? String(btn.className || '') : '',
      title: btn ? (btn.getAttribute('title') || '') : '',
      text: btn ? (btn.innerText || '').trim().slice(0, 10) : '',
      aria: btn ? (btn.getAttribute('aria-label') || '') : '',
      visible: btn ? !!_findVisible(btn) : false,
      htmlSnippet: btn ? (btn.outerHTML || '').slice(0, 200) : '',
      onProfile: !!document.querySelector('#userPageContainer'),
    };
    if (!btn) {
      info.reason = '页面未找到 xhs-user-im-btn 按钮（可能不在该用户主页）';
      return info;
    }
    // 高亮：滚动到按钮 + 周围红色高亮框，遮罩其余区域，4 秒后自动清除
    try {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const r = btn.getBoundingClientRect();
      const mask = document.createElement('div');
      mask.style.cssText =
        'position:fixed;z-index:99999;pointer-events:none;' +
        'border:4px solid #ff2442;background:rgba(255,36,66,.15);' +
        'box-shadow:0 0 0 9999px rgba(0,0,0,.45);transition:box-shadow .2s;' +
        'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
      document.body.appendChild(mask);
      const tag = document.createElement('div');
      tag.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;left:' + r.left + 'px;top:' + (r.top - 26) + 'px;background:#ff2442;color:#fff;font-size:12px;padding:2px 8px;border-radius:4px;white-space:nowrap;';
      tag.textContent = '🟥 已定位私信按钮：' + (btn.getAttribute('title') || '私信') + ' (' + String(btn.className || '').slice(0, 30) + ')';
      document.body.appendChild(tag);
      setTimeout(function () { try { mask.remove(); tag.remove(); } catch (_) {} }, 5000);
    } catch (_) {}
    return info;
  }

  // ★ 在"已打开的聊天窗口"输入并发送。不要求主页、不导航——调用前 background 已把本标签页导航到聊天URL。
  async function sendDmToOpenChat(userLink, text) {
    _showStatus('等待聊天输入框...');
    let inputEl = null;
    for (let i = 0; i < 15; i++) {
      await sleep(700);
      inputEl = _findVisible(document.querySelector('[contenteditable="true"]'))
        || _findVisible(document.querySelector('textarea[placeholder], [role="textbox"]'))
        || _findVisible(document.querySelector('textarea'));
      if (inputEl) break;
    }
    if (!inputEl) {
      _hideStatus();
      return { success: false, error: '未能定位聊天窗口输入框。请在已打开的聊天窗口手动发送。' };
    }
    // 输入
    _showStatus('输入私信内容...');
    inputEl.focus();
    await sleep(120);
    let setter = null;
    try {
      setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      if (!setter && inputEl.tagName.toLowerCase() === 'div') setter = Object.getOwnPropertyDescriptor(window.HTMLDivElement.prototype, 'innerText').set;
    } catch (_) {}
    if (setter) setter.call(inputEl, text);
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    // 发送（按钮优先，Enter 兜底，带验证重试；检测隐私限制则停手）
    _showStatus('发送私信...');
    const res = await _dmTrySend(inputEl);
    _hideStatus();
    if (res.privacy) {
      return { success: false, privacy: true, limited: true, error: '对方设置了隐私设置（或未关注你），暂时无法私信回复。建议：① 评论区互动破冰后再试；② 或去「消息台」用 /chat 直接开聊；③ 或先关注对方待通过。此用户已标记为"私信受限"。' };
    }
    return { success: res.sent, error: res.sent ? '' : '发送未确认，请手动检查', verified: res.sent };
  }

  // ── 在用户主页抓取公开「小红书号」+ 主页昵称（抓不到静默返回 {}，绝不报错/不增加额外请求） ──
  function extractUserProfile() {
    const _val = (s) => String(s || '').replace(/\s+/g, '').trim();
    let xhsId = '';
    let name = '';
    const bodyText = document.body ? document.body.innerText : '';
    try {
      // 1) 公开小红书号：常见文本 "小红书号：123456789" / "小红书号123456789" / "小红书号:123…" 或 aria-label
      const reId = /小红书号[:：]?\s*([A-Za-z0-9_-]{4,})/;
      const mId = bodyText.match(reId);
      if (mId) xhsId = mId[1];
      if (!xhsId) {
        // 兜底：全页抓形如 \d{6,} 的数字串（排除明显的时间戳/年份）
        const nums = (bodyText.match(/\b\d{6,}\b/g) || []);
        if (nums.length > 0) xhsId = nums[0];
      }
      // 2) 主页昵称：优先 og:title / title
      const og = document.querySelector('meta[property="og:title"]');
      let rawTitle = og ? og.content : (document.title || '');
      // 形如 "昵称 - 小红书" 或 "昵称 - 个人主页 - 小红书"
      rawTitle = rawTitle.replace(/\s*-\s*(小红书|个人主页).*$/, '').trim();
      if (rawTitle && rawTitle.length <= 30) name = rawTitle;
    } catch (_) {}
    return { xhsId, name };
  }

  /** 主页上的城市/属地：本人主页通常渲染「小红书号：xxx  IP属地：广东」这类文本，
   *  用户设置过的地区（如有）优先，其次 IP 属地。抓不到返回空串，由诊断页手填兜底。 */
  function pickProfileLocation() {
    const out = { city: '', ipLocation: '' };
    try {
      const t = (document.body ? document.body.innerText : '') || '';
      const mIp = t.match(/(?:IP\s*属地)[:：]?\s*([\u4e00-\u9fa5]{2,10})/);
      if (mIp) out.ipLocation = mIp[1];
      const mCity = t.match(/(?:地区|所在地|常住地)[:：]\s*([\u4e00-\u9fa5]{2,10})/);
      if (mCity) out.city = mCity[1];
    } catch (_) {}
    if (!out.city) out.city = out.ipLocation;
    return out;
  }

  /** 单页笔记的统计：互动三连（点赞 / 收藏 / 评论）；失败返 { error } 不抛
   *  优先 aria-label，DOM 兜底：
   *   - aria-label 里以 '点赞' / '赞' / '收藏' / '评论' / '回复' 起头
   *   - 兜底：节点 [+所有 .count / .stat / .num 子节点] 抓 '数字' 部分
   *  返回 { likes:number, collects:number, comments:number, raw } —— 字段全填不到返 { error } */
  function parseNoteStats(panel) {
    if (!panel) return null;
    const out = { likes: 0, collects: 0, comments: 0, raw: '' };
    const txt = (el) => (el ? String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '');
    const num = (s) => {
      if (s == null) return 0;
      const str = String(s).replace(/[^\d.万]/g, '');
      const m = str.match(/(\d+(?:\.\d+)?)(万)?/);
      if (!m) return 0;
      let n = parseFloat(m[1]);
      if (m[2] === '万') n *= 10000;
      return Math.round(n);
    };
    const elFromAria = (key) => panel.querySelector(
      '[aria-label*="' + key + '"], [aria-label*="' + key.toUpperCase() + '"]'
    );
    /* --- ① 优先 aria-label --- */
    let cnt = 0;
    for (const k of ['点赞', '赞']) {
      const el = elFromAria(k);
      const v = num(txt(el));
      if (v > 0) { out.likes = v; cnt++; break; }
    }
    for (const k of ['收藏']) {
      const el = elFromAria(k);
      const v = num(txt(el));
      if (v > 0) { out.collects = v; cnt++; break; }
    }
    for (const k of ['评论', '回复']) {
      const el = elFromAria(k);
      const v = num(txt(el));
      if (v > 0) { out.comments = v; cnt++; break; }
    }
    /* --- ② 兜底：拿 .count/.stat 列表，按出现的顺序配 likes/collects/comments --- */
    if (cnt < 3) {
      const cells = Array.from(panel.querySelectorAll('[class*="count"], [class*="stat"], [class*="num"]'))
        .map(el => num(txt(el))).filter(n => n > 0);
      if (cells.length >= 1 && !out.likes) out.likes = cells[0];
      if (cells.length >= 2 && !out.collects) out.collects = cells[1];
      if (cells.length >= 3 && !out.comments) out.comments = cells[2];
    }
    /* --- ③ 兜不住：基本没抓到，返 error --- */
    if (!out.likes && !out.collects && !out.comments) {
      return { error: '没抓到任何数字（DOM 没出 .count，或者三连 aria-label 全空）' };
    }
    out.raw = JSON.stringify({ likes: out.likes, collects: out.collects, comments: out.comments });
    return out;
  }

  /** 抓主页 / 单条详情 — 抓到 stats 后通过 background 落 note_stats 表 */
  function pushStats(url, stats) {
    if (!url || !stats) return;
    const m = String(url).match(/\/explore\/([^?#]+)/);
    if (!m) return;
    try { chrome.runtime.sendMessage({ action: 'writeNoteStats', id: m[1], stats }).catch(() => {}); }
    catch (_) {}
  }

  /** 账号诊断：抓取本人「我的」主页完整资料（只读）。返回 { xhsId, name, desc, avatar, fans, follows, likes, notes } */
  function extractProfileFull(maxNotes) {
    maxNotes = maxNotes || 12;
    const t = (el) => (el ? String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '');
    const p = { xhsId: '', name: '', desc: '', avatar: '', fans: '', follows: '', likes: '', profile_url: '', notes: [], city: '', ipLocation: '' };
    // 基础（小红书号 + 昵称）
    const base = extractUserProfile();
    p.xhsId = base.xhsId;
    p.name = base.name;
    // 简介
    const descEl = document.querySelector('[class*="user-desc"]') || (() => { const s = document.querySelector('[class*="desc"]'); return s && /简介|签名|介绍/.test(s.className) ? s : null; })();
    if (descEl) p.desc = t(descEl).replace(/^简介[:：]?\s*/, '');
    if (!p.desc) {
      // 兜底：从 og:description 取（主页简介常在 meta description）
      const od = document.querySelector('meta[name="description"]');
      if (od) { const m = (od.getAttribute('content') || '').replace(/\s+小红薯.*$/, ''); if (m) p.desc = m; }
    }
    // 头像
    const avImg = document.querySelector('img[class*="avatar"], [class*="avatar"] img');
    if (avImg) p.avatar = (avImg.getAttribute('src') || avImg.getAttribute('data-src') || '').split('~')[0];
    // 统计：本人类主页三连（粉丝/关注/获赞）
    const countEls = Array.from(document.querySelectorAll('[class*="count"], [class*="stat"], [class*="info"]'));
    let cnt = [];
    for (const el of countEls) {
      const tx = t(el);
      if (/^[\d.,万亿+]+$/.test(tx) && tx.length <= 8 && cnt.length < 3) cnt.push(tx);
    }
    if (cnt.length >= 3) { p.fans = cnt[0]; p.follows = cnt[1]; p.likes = cnt[2]; }
    // 笔记列表
    try {
      const seen = new Set();
      const cards = document.querySelectorAll('a[href*="/explore/"], div[class*="note-item"], section[class*="note"]');
      for (const card of cards) {
        if (p.notes.length >= maxNotes) break;
        if (card.tagName === 'A') {
          const lnk = card.closest('a[href*="/explore/"]');
          const href = (lnk && lnk.getAttribute('href')) || card.getAttribute('href') || '';
          const m = href.match(/\/explore\/([^?]+)/);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          const coverImg = card.querySelector('img');
          p.notes.push({
            title: t(card.querySelector('[class*="title"]') || card).slice(0, 80),
            cover: coverImg ? (coverImg.getAttribute('src') || coverImg.getAttribute('data-src') || '').split('~')[0] : '',
            url: 'https://www.xiaohongshu.com' + href.split('?')[0],
          });
        } else {
          const lnk = card.querySelector('a[href*="/explore/"]');
          if (!lnk) continue;
          const href = lnk.getAttribute('href') || '';
          const m = href.match(/\/explore\/([^?]+)/);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          const coverImg = card.querySelector('img');
          p.notes.push({
            title: t(card.querySelector('[class*="title"]') || card).slice(0, 80),
            cover: coverImg ? (coverImg.getAttribute('src') || coverImg.getAttribute('data-src') || '').split('~')[0] : '',
            url: 'https://www.xiaohongshu.com' + href.split('?')[0],
          });
        }
      }
    } catch (_) {}
    // ★ 顺手读每条的 stats（profile 页抓不到时也不报错 —— ⚠️ 标记落库即可）
    try {
      for (const n of p.notes) {
        if (!n || !n.url) continue;
        const m = n.url.match(/\/explore\/([^?]+)/);
        if (!m) continue;
        const panel = document.querySelector('a[href*="/explore/' + m[1] + '"]');
        if (!panel) continue;
        const s = parseNoteStats(panel);
        if (s && !s.error) { n.stats = s; pushStats(n.url, s); }
        else n.statsError = (s && s.error) || 'unparsed';
      }
    } catch (_) {}
    p.profile_url = location.href.split('?')[0];
    // ★ 城市/属地：供评论助手「同城」判定（诊断页会落库，抓不到可手填）
    try {
      const loc = pickProfileLocation();
      p.city = loc.city;
      p.ipLocation = loc.ipLocation;
    } catch (_) {}
    return p;
  }

  // 抓"来访者"主页：先确认在用户主页 + 等简介/笔记渲染出来，再抓；防导航未完成就抓到旧页面
  async function extractGuestProfile() {
    // 一个配置文件/SPA 导航保护：不在用户主页 URL 直接报 notProfile（后台可据此降级/重试）
    if (!_isProfileUrl()) return { ok: false, notProfile: true, error: '当前不在用户主页(/user/profile/…)' };
    const _hasProfile = () => {
      const t = (el) => (el ? (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '');
      const hasDesc = (document.querySelector('[class*="user-desc"]') || [...document.querySelectorAll('[class*="desc"]')].some(s => /简介|签名|介绍/.test(s.className)) || false);
      const hasNotes = !!document.querySelector('a[href*="/explore/"], div[class*="note-item"], section[class*="note"]');
      return !!(hasDesc || hasNotes);
    };
    // 等到主页真的渲染出来（简介或笔记卡出现），最多 ~8s
    for (let i = 0; i < 12; i++) {
      if (_hasProfile()) break;
      await sleep(650);
    }
    const profile = extractProfileFull();
    if (!profile) return { ok: false, error: '主页读取失败' };
    // 空简介 + 空笔记 → 大概率没加载到，标记 notReady 让后台重试
    const hasAny = !!(String(profile.desc || '').trim() || (Array.isArray(profile.notes) && profile.notes.length));
    return { ok: true, notReady: !hasAny, profile };
  }

  function findReplyButtonNear(el) {
    function _matchReply(text) {
      const t = text.trim();
      if (t === '回复' || t === 'Reply') return true;
      if (t.length <= 6 && (t.includes('回复') || t.includes('Reply'))) return true;
      return false;
    }
    function _isClickable(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A') return true;
      if (el.getAttribute('role') === 'button') return true;
      return window.getComputedStyle(el).cursor === 'pointer';
    }
    function _refine(el) {
      try {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const p = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (p && p !== document.documentElement && p !== document.body) return p;
        }
      } catch (_) {}
      return el;
    }

    if (_matchReply(el.textContent)) return _refine(el);
    for (const c of el.children) { if (_matchReply(c.textContent)) return _refine(c); }

    const elRect = el.getBoundingClientRect();
    let allCandidates = [];

    let walk = el;
    for (let depth = 0; depth < 10; depth++) {
      if (!walk.parentElement) break;
      walk = walk.parentElement;

      const btns = walk.querySelectorAll('button, a, span, div');
      for (const btn of btns) {
        if (!_matchReply(btn.textContent) || btn.offsetParent === null) continue;
        const btnRect = btn.getBoundingClientRect();
        const dist = Math.abs(btnRect.top - elRect.top);
        allCandidates.push({ btn, dist, clickable: _isClickable(btn) });
      }

      if (allCandidates.length > 0) {
        allCandidates.sort((a, b) => {
          if (a.clickable !== b.clickable) return a.clickable ? -1 : 1;
          return a.dist - b.dist;
        });
        if (allCandidates[0].dist < 200 || allCandidates[0].clickable) {
          return _refine(allCandidates[0].btn);
        }
      }
    }

    if (allCandidates.length > 0) {
      allCandidates.sort((a, b) => {
        if (a.clickable !== b.clickable) return a.clickable ? -1 : 1;
        return a.dist - b.dist;
      });
      return _refine(allCandidates[0].btn);
    }

    return null;
  }

  function findBottomReplyInput() {
    const viewportH = window.innerHeight;
    let best = null, bestBottom = -Infinity;

    // ★ 方案一：优先搜底部固定容器（position:fixed/sticky）中的 contenteditable
    //   小红书回复框总是在底部固定栏，类名可能会变但位置是固定的
    for (const el of document.querySelectorAll('div, section, form')) {
      if (el.offsetParent === null) continue;
      const pos = window.getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const er = el.getBoundingClientRect();
      if (er.top < viewportH * 0.3 || er.top > viewportH) continue;
      if (er.width < 200) continue;
      const inp = el.querySelector('[contenteditable], textarea, [role="textbox"]');
      if (inp && inp.offsetParent !== null) return inp;
    }

    // ★ 方案二：直接搜底部 contenteditable（类名无关，只看位置和特征）
    const SELECTORS = [
      '[contenteditable]',
      'textarea',
      '[role="textbox"]',
      'input[type="text"]',
      'div[data-placeholder]',
      'div[placeholder]',
    ].join(', ');
    for (const inp of document.querySelectorAll(SELECTORS)) {
      if (inp.offsetParent === null) continue;
      const ir = inp.getBoundingClientRect();
      if (ir.top < viewportH * 0.4) continue;   // 必须在视口下半部分
      if (ir.width < 60 || ir.height < 18) continue;
      if (ir.bottom > bestBottom) { bestBottom = ir.bottom; best = inp; }
    }
    if (best) return best;

    // ★ 方案三：宽泛搜所有可见输入框（兜底）
    for (const inp of document.querySelectorAll('[contenteditable], textarea, [role="textbox"], input')) {
      if (inp.offsetParent === null) continue;
      const ir = inp.getBoundingClientRect();
      if (ir.top < viewportH * 0.3) continue;
      if (ir.width < 40 || ir.height < 15) continue;
      if (ir.bottom > bestBottom) { bestBottom = ir.bottom; best = inp; }
    }
    return best;
  }

  // ============================
  // 交叉验证：核对“打开的回复框目标 == 目标作者”
  // 小红书点某条评论“回复”后，底部输入框 placeholder 会变成 “回复 @对方昵称”；
  // 对笔记的一级评论框则是“说点什么…/留下你的评论”。借此判断是否开错了回复框，
  // 防止“评论发错人 / 发成对笔记的评论”。
  // ============================
  function _normName(s) {
    return (s || '')
      .replace(/[\s\u200b\uFE0F]/g, '')       // 去空白、零宽、变体选择符
      .replace(/[^\p{L}\p{N}]/gu, '')          // 只留字母数字（去 emoji/标点）
      .toLowerCase();
  }

  function collectReplyBoxHints(inputEl) {
    const texts = [];
    const push = (s) => { if (s && String(s).trim()) texts.push(String(s).trim()); };
    if (inputEl.getAttribute) {
      push(inputEl.getAttribute('placeholder'));
      push(inputEl.getAttribute('aria-label'));
      push(inputEl.getAttribute('data-placeholder'));
    }
    // placeholder 文案常放在回复框附近的兄弟/占位节点里
    const box = (inputEl.closest && inputEl.closest('[class*="inner" i],[class*="input" i],[class*="editor" i],[class*="content" i],[class*="reply" i],[class*="comment" i]')) || inputEl.parentElement;
    if (box) {
      box.querySelectorAll('[data-placeholder],[class*="placeholder" i]').forEach(n => {
        push(n.getAttribute && n.getAttribute('data-placeholder'));
        push(n.textContent);
      });
    }
    return texts.join(' | ');
  }

  // 从定位到的“回复按钮”反推它所属评论的指纹（作者主页链接 + 正文前 40 字），
  // 用于会话级防重复：同一条评论只能被发一次（不依赖回复框昵称能不能读到）。
  // 若从 DOM 抽不到指纹，用传入的 author+originalText 作降级指纹，保证总有稳定值可比。
  function _replyBtnCommentSig(replyBtn, author, originalText) {
    try {
      let el = replyBtn;
      for (let d = 0; d < 12 && el; d++) {
        const links = el.querySelectorAll && el.querySelectorAll('a[href*="/user/"]');
        const raw = (el.textContent || '').trim();
        // 取“包含用户链接、且文字量像单条评论（4~400 字）”的最小块，
        // 兼容一级评论与楼中楼回复（后者常含 @某人 链接，不能用“恰好一个链接”筛）
        if (links && links.length >= 1 && raw.length >= 4 && raw.length <= 400) {
          const href = (links[0].getAttribute('href') || '').split('?')[0];
          const txt = _normName(raw.slice(0, 60)).slice(0, 40);
          if (txt) return href + '||' + txt;
        }
        el = el.parentElement;
      }
    } catch (_) {}
    // ★ 降级指纹：DOM 抽不到时，用目标作者+原文拼一个，绝不返回空串以免防重复失效
    const fb = _normName((author || '') + '|' + (originalText || '').slice(0, 40));
    return fb && fb !== '|' ? 'fb::' + fb : '';
  }

  // 返回：{ verdict: 'match'|'mismatch'|'note'|'unknown', hint, atName }
  function verifyReplyTarget(inputEl, author) {
    const hint = collectReplyBoxHints(inputEl);
    if (!hint) return { verdict: 'unknown', hint: '' };
    const lower = hint.toLowerCase();
    const hasReplyKw = lower.includes('回复') || lower.includes('reply') || hint.includes('@');
    if (!hasReplyKw) {
      // 没有“回复/@” → 大概率是对笔记的一级评论框（说点什么/留下评论）
      return { verdict: 'note', hint };
    }
    // 提取 placeholder 里 @ 后面的昵称
    let atName = '';
    const m = hint.match(/回复\s*@?\s*([^\s|@]{1,40})|@\s*([^\s|@]{1,40})/);
    if (m) atName = m[1] || m[2] || '';
    // ★ 兜底：正则没提到时，用"去掉 @ 的作者名"到 hint 里模糊找（用户反馈去 @ 后能找到）。
    //   小红书 placeholder 常把名字写成 "尾狐的酒"（不带 @），正则含 @ 反而匹配不到 → 防重复误拦
    if (!atName && author) {
      const authorNorm = _normName(author);
      if (authorNorm && authorNorm.length >= 2 && lower.includes(authorNorm)) {
        atName = author;
      }
    }
    const na = _normName(author);
    const nb = _normName(atName);
    if (na && nb) {
      // 双向前缀匹配，兼容昵称被截断
      const shorter = na.length <= nb.length ? na : nb;
      const longer = na.length <= nb.length ? nb : na;
      const prefix = shorter.slice(0, Math.max(2, Math.floor(shorter.length * 0.6)));
      if (longer.includes(shorter) || longer.startsWith(prefix)) {
        return { verdict: 'match', hint, atName };
      }
      return { verdict: 'mismatch', hint, atName };
    }
    // 有“回复”关键字但提不到昵称 → 无法证伪，交给位置校验
    return { verdict: 'unknown', hint, atName };
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

  // 批量点赞：整个过程（含每次点赞之间的等待间隔）全程在同一把锁内串行执行，
  // 不会在等待间隔释锁；由 runExclusive('likeBatch', ...) 包裹，在 popup 侧只发一次消息。
  // 每点一个就广播一条进度，供 popup 实时更新“已点赞”列表。
  async function likeCommentsBatch(list) {
    const items = Array.isArray(list) ? list : [];
    const results = [];
    for (let i = 0; i < items.length; i++) {
      _touchLock(); // 心跳：刷新持锁时间，防止长批次被误判为死锁
      const it = items[i] || {};
      // 首个不等，之后每个间隔由 delay_config.likeGap 控制（0=不等）——这段等待也在锁内
      if (i > 0) {
        const gap = dwellMs('likeGap');
        if (gap > 0) await sleep(gap);
      }
      let r = { success: false };
      try {
        r = await likeComment(it.author, it.originalText, it.commentIdx, it.userLink);
      } catch (e) {
        r = { success: false, error: e.message };
      }
      results.push(r);
      // 广播单条进度（popup 据此更新已点赞列表）
      try {
        chrome.runtime.sendMessage({
          action: 'likeProgress',
          index: i,
          author: it.author || '',
          originalText: it.originalText || '',
          success: !!r.success,
          alreadyLiked: !!r.alreadyLiked,
        });
      } catch (_) {}
    }
    return { success: true, results, total: items.length };
  }

  function findSendButtonNear(inputEl) {
    // ★ 从 input 向上找回复面板（position:fixed / sticky 的容器）
    function _findPanel(el) {
      for (let d = 0; d < 10 && el; d++) {
        if (el === document.body || el === document.documentElement) break;
        const pos = window.getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') return el;
        el = el.parentElement;
      }
      return null;
    }
    function _clickableAncestor(el) {
      for (let d = 0; d < 5 && el && el !== document.body; d++) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ||
            window.getComputedStyle(el).cursor === 'pointer') return el;
        el = el.parentElement;
      }
      return null;
    }

    const panel = _findPanel(inputEl);
    if (!panel) {
      console.log('[findSendButton] ⚠ 未找到回复面板');
      return null;
    }
    const inputRect = inputEl.getBoundingClientRect();

    // 在面板内搜索 "发送"/"发布" 文字的元素
    let best = null, bestScore = -Infinity;
    for (const el of panel.querySelectorAll('button, [role="button"], a, span, div, [class*="send"], [class*="publish"]')) {
      if (el.offsetParent === null || el.disabled) continue;
      const t = el.textContent.trim();
      if (t !== '发送' && t !== '发布' && t !== 'Send' && t !== '提交') continue;
      const r = el.getBoundingClientRect();
      // 必须在输入框同一水平区域（50px 范围内）
      if (r.top < inputRect.top - 50 || r.top > inputRect.bottom + 100) continue;
      // 评分：越靠右越好（发送按钮通常在输入框右侧）
      const score = r.left;
      if (score > bestScore) { bestScore = score; best = el; }
    }

    if (best) {
      // 找到后向上取最近的可点击祖先
      const clickable = _clickableAncestor(best);
      const result = clickable || best;
      console.log('[findSendButton] ✅ 找到发送按钮:', result.tagName, result.textContent.trim());
      return result;
    }

    console.log('[findSendButton] ❌ 面板内未找到发送按钮');
    return null;
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

  // ── 获取笔记链接元素（基于用户 F12 验证的 XPath 模式） ──
  // XHS 搜索结果页 DOM 结构（已验证）：
  //   section > div > a[1] = 头像链接 (href*="/explore/")
  //   section > div > a[2] = 笔记链接 (href*="/search_result/")  ← 目标
  // 策略：每个 section 取第 2 个 a[href*="/explore/" 或 "/search_result/"] 作为笔记链接
  function getNoteLinkElements() {
    const linkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';
    const sections = document.querySelectorAll('section');
    const seen = new Set();
    const result = [];

    for (const section of sections) {
      const links = section.querySelectorAll(linkSelector);
      if (links.length === 0) continue;
      // ★ 遍历 section 内所有笔记链接，不再固定取第2个（小红书 DOM 结构会变）
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/explore\/([a-z0-9]+)/) || href.match(/\/search_result\/([a-z0-9]+)/) || href.match(/\/note\/([a-z0-9]+)/);
        if (!m) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        result.push(link);
      }
    }

    // 如果 section 方式找到结果就用它
    if (result.length >= 1) return result;

    // 回退：全部链接 + noteId 去重
    const allLinks = document.querySelectorAll(linkSelector);
    const allSeen = new Set();
    const fallback = [];
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/explore\/([a-z0-9]+)/) || href.match(/\/search_result\/([a-z0-9]+)/) || href.match(/\/note\/([a-z0-9]+)/);
      if (!m) continue;
      if (allSeen.has(m[1])) continue;
      allSeen.add(m[1]);
      fallback.push(link);
    }
    return fallback;
  }

  // ============================
  // 一键灌水：搜索页抓取
  // ============================
  // 🏷 话题抽取：从文本里挑 #话题（中英文/数字/Emoji，2~24 字），去重保序，最多 max 个
  function pickHashTags(text, max) {
    const out = [];
    const s = String(text || '');
    if (!s || s.indexOf('#') === -1) return out;
    // 先整段取到分隔符为止，再用长度过滤：超长串（>24）整条丢弃，不截断成假话题
    const re = /[#＃]([^\s#＃,，。；;!！?？、:："'“”（）()【】\[\]\/\\|<>@$%^&*+=~`]+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const t = String(m[1]).replace(/[.。，,、;；:：]+$/, '').trim();
      if (!t || t.length < 2 || t.length > 24) continue;
      if (/^\d+$/.test(t)) continue;
      if (out.indexOf(t) === -1) out.push(t);
      if (out.length >= (max || 12)) break;
    }
    return out;
  }

  function extractSearchResults() {
    const notes = [];
    const seen = new Set();
    let searchIdx = 0; // 记录笔记在搜索结果中的位置序号

    // 获取原始 DOM 索引映射（与 debug 模式一致）
    const allLinkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';
    const allRawLinks = document.querySelectorAll(allLinkSelector);

    // 策略1：通过链接提取笔记卡片（使用 getNoteLinkElements 排除头像链接）
    const links = getNoteLinkElements();
    // links 现在是 DOM 元素数组，forEach 遍历
    links.forEach(function(link) {
      // 计算该链接在原始 DOM 中的索引（用于后续定位/灌水）
      const rawLinkIndex = Array.from(allRawLinks).indexOf(link);
      const href = link.getAttribute('href') || '';
      // 提取 noteId
      const match = href.match(/\/explore\/([a-z0-9]+)/) || href.match(/\/search_result\/([a-z0-9]+)/);
      if (!match) return;
      const noteId = match[1];
      if (seen.has(noteId)) return;
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

      // 提取点赞数（严格数字校验：纯数字/千分位/带万，含字母的 ID 一律不算）
      const NUM_RE = /^[\d.,]+万?$/;
      let likes = '';
      let likeEl = null;
      const likeEls = card.querySelectorAll('[class*="like"], [class*="count"]');
      for (const le of likeEls) {
        const lt = (le.textContent || '').trim();
        if (NUM_RE.test(lt)) { likes = lt; likeEl = le; break; }
      }

      // ★ 卡片底部统计全抓（点赞/收藏/评论混在 count/num 类元素里，平台不拆分语义，不猜谜、全抓全展示）
      //   注意：class 含 "num" 的元素既有真统计（收藏/评论）也有笔记 ID（如 03ad5e）——
      //   不能删掉 num 选择器（否则收藏/评论抓不到），必须靠下方严格数字校验排除 ID
      const stats = [];
      const seenStatEls = new Set();
      for (const se of card.querySelectorAll('[class*="count"], [class*="like"], [class*="collect"], [class*="comment"], [class*="star"], [class*="fav"], [class*="num"], [class*="interact"]')) {
        if (seenStatEls.has(se) || (likeEl && se === likeEl)) continue;
        seenStatEls.add(se);
        const st = (se.textContent || '').trim();
        if (!NUM_RE.test(st)) continue; // 严格数字：排除 "03ad5e" 这类含字母的 ID，只留纯数字/带万统计
        if (st.length > 8) continue; // 防把大段文本当统计
        stats.push(st);
        if (stats.length >= 3) break; // 最多三个统计（赞/藏/评）
      }
      // 兜底：全抓为空时至少保留点赞数（老页面结构）
      if (stats.length === 0 && likes) stats.push(likes);
      // 若点赞数不在 stats 首位，把它补到最前，保证展示顺序=赞/藏/评
      if (likes && stats[0] !== likes && stats.indexOf(likes) === -1) stats.unshift(likes);

      if (title || noteId) {
        // 过滤安全提示/备案信息等非笔记内容
        if (title && LEGAL_PATTERNS.some(function(p) { return p.test(title); })) return;
        notes.push({
          noteId,
          url: `https://www.xiaohongshu.com/explore/${noteId}`,
          title: title || '无标题',
          author: author || '未知',
          likes,
          stats,
          tags: pickHashTags(card.textContent, 6),
          searchIndex: searchIdx++,
          linkHref: href,
          rawLinkIndex: rawLinkIndex,
        });
      }
    });

    // 策略2：如果策略1结果太少，尝试扫描所有 section/div 容器
    if (notes.length < 3) {
      const sections = document.querySelectorAll('section, div[class*="note"], div[class*="card"]');
      for (const sec of sections) {
        const link = sec.querySelector('a[href*="/explore/"], a[href*="/search_result/"]');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/explore\/([a-z0-9]+)/) || href.match(/\/search_result\/([a-z0-9]+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);

        const text = sec.textContent.trim();
        let title = '';
        const spans = sec.querySelectorAll('span');
        for (const sp of spans) {
          const t = sp.textContent.trim();
          if (t.length > 5 && t.length < 100 && !/^\d/.test(t)) { title = t; break; }
        }

        // 过滤安全提示/备案信息等非笔记内容
        const t2Title = title || text.slice(0, 60);
        if (t2Title && LEGAL_PATTERNS.some(function(p) { return p.test(t2Title); })) continue;

        notes.push({
          noteId: m[1],
          url: `https://www.xiaohongshu.com/explore/${m[1]}`,
          title: t2Title,
          author: '',
          likes: '',
          stats: [],
          tags: pickHashTags(text, 6),
          searchIndex: searchIdx++,
          linkHref: href,
          rawLinkIndex: Array.from(allRawLinks).indexOf(link),
        });
        if (notes.length >= 30) break;
      }
    }

    console.log(`[一键灌水] 搜索页提取到 ${notes.length} 篇笔记`);
    return { notes };
  }

  async function scrollLoadMore() {
    const beforeCount = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]').length;
    const beforeHeight = document.body.scrollHeight;
    const beforeScrollY = window.scrollY;
    // ★ 方案A：逐屏推进，一次只下滚【一个视口】，绝不再直接跳到底。
    //   直接 scrollTo(scrollHeight) 会一屏就把 top 翻到 bottom → 中间大量笔记被跳过，且到底后 hasMore 假性=假，
    //   流程提前收尾。改为按视口增量下滚，配合滚动距离真实变化判定是否还有更多，逐屏吃完整页。
    const viewport = Math.max(Math.round(window.innerHeight || 800), 400);
    window.scrollBy({ top: viewport, behavior: 'smooth' });
    await sleep(2500);
    const afterCount = document.querySelectorAll('a[href*="/explore/"], a[href*="/search_result/"]').length;
    const afterHeight = document.body.scrollHeight;
    const nowY = window.scrollY;
    const newNotes = afterCount - beforeCount;
    // ★ 虚拟瀑布流：顶部卡片回收后链接总数可能不增（滞进滞出），不能只看数量差。
    //   只要【真滚动了】＋【页高变高或还有新链接或还能继续往下滚】，就认为还有更多。
    const grewHeight = afterHeight > beforeHeight + 50;
    const reallyScrolled = Math.abs(nowY - beforeScrollY) > 50;
    const canScrollMore = (nowY + window.innerHeight) < document.body.scrollHeight - 50;
    const hasMore = reallyScrolled && (newNotes > 0 || grewHeight || canScrollMore);
    // 重新提取当前可见快照
    const result = extractSearchResults();
    return { notes: result.notes, newCount: newNotes, hasMore };
  }

  // ── 查找笔记链接并返回视口坐标（供 CDP 可信点击使用） ──
  function findNoteLinkCoords(title, noteId, searchIndex, rawLinkIndex) {
    const allLinkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';

    // 策略0：通过标题文字搜索（CTRL+F 式，最可靠）
    if (title) {
      const byTitle = locateNoteByTitle(title);
      if (byTitle) {
        const rect = byTitle.element.getBoundingClientRect();
        return {
          found: true,
          method: 'title_' + byTitle.method,
          matchRatio: byTitle.score,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    }

    // 策略1：通过 rawLinkIndex 直接定位
    if (rawLinkIndex !== undefined && rawLinkIndex >= 0) {
      const allLinks = document.querySelectorAll(allLinkSelector);
      const link = allLinks[rawLinkIndex];
      if (link) {
        const rect = link.getBoundingClientRect();
        return {
          found: true,
          method: 'rawLinkIndex',
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    }

    // 使用 getNoteLinkElements 获取有效笔记链接（排除头像链接）
    const noteLinks = getNoteLinkElements();

    // 策略2：通过 searchIndex 定位（与 extractSearchResults 索引一致）
    if (searchIndex !== undefined && searchIndex >= 0 && searchIndex < noteLinks.length) {
      const link = noteLinks[searchIndex];
      if (link) {
        const linkNoteId = link.getAttribute('href')?.match(/\/explore\/([a-z0-9]+)/)?.[1] || link.getAttribute('href')?.match(/\/search_result\/([a-z0-9]+)/)?.[1] || '';
        if (linkNoteId === noteId) {
          const rect = link.getBoundingClientRect();
          return {
            found: true,
            method: 'searchIndex',
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }
      }
    }

    // 策略3：通过 noteId 精确匹配
    if (noteId) {
      const linkById = document.querySelector(`a[href*="/explore/${noteId}"], a[href*="/note/${noteId}"], a[href*="/search_result/${noteId}"]`);
      if (linkById) {
        const rect = linkById.getBoundingClientRect();
        return {
          found: true,
          method: 'noteId',
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    }

    return { found: false, totalLinks: noteLinks.length };
  }

  // ── 通过搜索框输入关键词（模拟真实用户搜索，触发 SPA 内部路由） ──
  async function searchViaInput(keyword) {
    // 尝试多种可能的搜索框选择器
    const searchSelectors = [
      'input[type="text"][placeholder*="搜索"]',
      'input.search-input',
      'input[class*="search"]',
      'div[class*="search"] input',
      'header input[type="text"]',
      'nav input[type="text"]',
      'input[placeholder*="搜"]',
    ];

    let searchInput = null;
    for (const selector of searchSelectors) {
      searchInput = document.querySelector(selector);
      if (searchInput) break;
    }

    if (!searchInput) {
      // 尝试更宽泛的搜索
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const input of allInputs) {
        const placeholder = input.placeholder || '';
        const className = input.className || '';
        const parentClass = (input.parentElement?.className || '') + ' ' + (input.closest('header, nav, div[class*="search"]')?.className || '');
        if (placeholder.includes('搜索') || placeholder.includes('搜') ||
            className.includes('search') || parentClass.includes('search')) {
          searchInput = input;
          break;
        }
      }
    }

    if (!searchInput) {
      return { success: false, reason: '未找到搜索框', inputCount: document.querySelectorAll('input').length };
    }

    // 聚焦搜索框
    searchInput.focus();
    await sleep(300);

    // 清空现有内容
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    // 逐字输入关键词（模拟真实打字）
    for (const char of keyword) {
      searchInput.value += char;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await sleep(50 + Math.random() * 100);
    }

    await sleep(500);

    // 按 Enter 提交搜索
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));

    // 也尝试 form 提交
    const form = searchInput.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    }

    return { success: true, method: 'searchInput', selector: searchInput.className || searchInput.tagName };
  }

  // ═══════════ 一键灌水 · 驱动小红书搜索页的排序 ═══════════
  // sortKey: latest|likes|collects|comments  → 最新/点赞最多/收藏最多/评论最多
  const _XHS_SORT_LABEL = { latest: '最新', likes: '点赞最多', collects: '收藏最多', comments: '评论最多' };

  // 收集文本恰好等于 q 的“叶子元素”（无子元素的最终文本节点宿主）
  function _xfsExactEls(q) {
    const out = [];
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode(n) {
          if (out.length >= 300) return NodeFilter.FILTER_REJECT;
          if (n.childElementCount === 0 && String(n.textContent || '').trim() === q) out.push(n);
          return NodeFilter.FILTER_SKIP;
        },
      });
      while (walker.nextNode()) {}
    } catch (_) {}
    return out;
  }

  async function _xfsClickExact(q, tries, gap) {
    for (let i = 0; i < (tries || 10); i++) {
      const els = _xfsExactEls(q);
      if (els.length) { const el = els[els.length - 1]; try { el.click(); } catch (_) {} return true; }
      await new Promise(r => setTimeout(r, gap || 350));
    }
    return false;
  }

  // 在搜索页应用排序（宽松按文字匹配，失败只降级不卡死）
  async function applySearchFilter(sortKey) {
    const applied = [];
    try {
      if (sortKey && _XHS_SORT_LABEL[sortKey]) {
        const target = _XHS_SORT_LABEL[sortKey];
        // 1) 点开排序下拉（默认显示 综合/最新）
        let opened = await _xfsClickExact('综合', 3, 250);
        if (!opened) opened = await _xfsClickExact('最新', 3, 250);
        await new Promise(r => setTimeout(r, 450));
        // 2) 点目标选项；若下拉未开，退化为直接点目标文本
        let ok = await _xfsClickExact(target, 8, 400);
        if (!ok) ok = await _xfsClickExact(target, 3, 300);
        if (ok) applied.push('sort:' + sortKey);
      }
    } catch (_) {}
    return { ok: applied.length > 0, applied };
  }

  /* ═══════════ 截流活水 · 查「我的评论」在评论区的位置与点赞 ═══════════
     names: 我的小红书昵称列表（按 _normName 归一化后比较）；只扫评论区范围。
     返回 { ok, found, rank, likes, excerpt, author, total } */
  async function extractMyComment(names) {
    const want = (names || []).map(n => _normName(n)).filter(Boolean);
    if (!want.length) return { ok: false, error: '未配置我的小红书昵称' };
    const scanItems = () => {
      const root = getCommentScopeRoot() || document;
      const out = [];
      const seenEls = new Set();
      for (const link of root.querySelectorAll('a[href*="/user/"]')) {
        let el = link.parentElement;
        while (el && el !== root) {
          if (el.querySelectorAll('a[href*="/user/"]').length !== 1) { el = el.parentElement; continue; }
          const linkText = (link.textContent || '').trim();
          if (el.textContent.trim().replace(linkText, '').trim().length < 3) { el = el.parentElement; continue; }
          if (!seenEls.has(el)) { seenEls.add(el); out.push({ el, author: linkText }); }
          break;
        }
      }
      return out;
    };
    const parseCount = (t) => {
      const s = String(t == null ? '' : t).replace(/[,\s]/g, '').trim();
      if (s === '赞' || s === '点赞') return 0;
      if (!/^[\d.]+[万w]?$/i.test(s)) return null;
      const n = parseFloat(s);
      if (!Number.isFinite(n)) return null;
      return Math.round(n * (/万|w/i.test(s) ? 10000 : 1));
    };
    // 评论项里的点赞数：取项内最后一个数值型 like/count 叶子（评论项的赞控件在右下角）
    const likesOf = (el) => {
      let best = null;
      for (const n of el.querySelectorAll('[class*="like"],[class*="praise"],[class*="count"]')) {
        const v = parseCount((n.textContent || '').trim());
        if (v != null) best = v;
      }
      return best;
    };
    let items = scanItems();
    for (let round = 0; round < 3; round++) {
      const hit = items.find(it => it.author && want.includes(_normName(it.author)));
      if (hit) {
        const text = (hit.el.textContent || '').replace(hit.author, '').replace(/\s+/g, ' ').trim();
        return { ok: true, found: true, rank: items.indexOf(hit) + 1, likes: likesOf(hit.el), excerpt: text.slice(0, 60), author: hit.author, total: items.length };
      }
      if (round < 2) {   // 没找到：往下滚一屏触发评论区继续加载，再看一眼
        try { window.scrollBy(0, 700); } catch (_) {}
        await new Promise(r => setTimeout(r, 700));
        items = scanItems();
      }
    }
    return { ok: true, found: false, rank: 0, likes: null, excerpt: '', author: '', total: items.length };
  }

  /* ── 打开笔记（稳健通路）：当前页没这张卡片时，用「标题末尾减3字」站内搜 → 在结果里按作者名定位（等于真人 Ctrl+F 搜作者） → 点开 ──
     笔记列表里的旧笔记多半早已不在当前搜索页 DOM 里（页面重绘/翻屏/换了关键词），
     此时既不能直接点（找不到元素）也不能冷开 /explore/ 链接（常出异常页）。
     搜过一轮仍定位不到（结果里没有该标题+作者）→ 返回 miss=true，由 📋笔记列表 把这篇作废。
     返回 { ok, method, needNav, miss }：needNav=true 表示当前页连搜索框都没有，由背景侧先导航到搜索页再调一次。 */
  async function openNoteBySearch(req) {
    const title = String((req && req.title) || '').trim();
    const author = String((req && req.author) || '').trim();
    const noteId = String((req && req.noteId) || '').trim();
    const terms = _drainSearchTerms(title);
    // 0）这篇就在当前页 → 直接点（有 noteId 时 clickNoteLink 自己会做 DOM 闸门校验）
    if (noteId && document.querySelector('a[href*="/explore/' + noteId + '"], a[href*="/note/' + noteId + '"], a[href*="/search_result/' + noteId + '"]')) {
      const r0 = clickNoteLink(title, noteId, undefined);
      if (r0 && r0.clicked) return { ok: true, method: 'in_page:' + r0.method, noteId };
    }
    if (!terms.length) return { ok: false, needNav: false, searched: true, error: '这篇没标题（也没匹配到卡片），搜不了名字——请在笔记列表补一下标题' };
    if (!req.resultsReady) {
      // 1）像真人一样用页头搜索框搜「标题末尾减3字」；页面上没有搜索框 → 交给背景侧导航到搜索页
      const typed = await searchViaInput(terms[0]);
      if (!typed || !typed.success) {
        if (!/\/search_result/.test(location.pathname)) return { ok: false, needNav: true, term: terms[0], error: '当前页没有搜索框' };
      } else {
        // 等 SPA 路由切到搜索结果页
        const rt = Date.now() + 8000;
        while (Date.now() < rt && !/\/search_result/.test(location.pathname)) await sleep(300);
      }
    }
    // 2）等结果渲染 + 定位：一个搜索词等 ~10s，没有作者命中的卡片就换个写法再搜一次
    for (let ti = 0; ti < terms.length; ti++) {
      if (ti > 0) {
        const again = await searchViaInput(terms[ti]);
        if (!again || !again.success) break;
        await sleep(1500);
      }
      const deadline = Date.now() + 10000;
      let scrolled = 0;
      while (Date.now() < deadline) {
        await sleep(600);
        const hit = _findSearchCard({ title, author, noteId });
        if (hit) {
          const r = clickNoteLink(hit.title || title, hit.noteId || noteId, hit.rawLinkIndex);
          if (r && r.clicked) {
            console.log('[打开·搜索通路] ✅ 命中(' + hit.by + ')：' + String(hit.title || '').slice(0, 20));
            return { ok: true, method: 'search:' + r.method, matchedBy: hit.by, noteId: hit.noteId || noteId, term: terms[ti] };
          }
          return { ok: false, needNav: false, searched: true, error: '搜索结果里找到了这篇卡片，但点击没生效（页面可能还在渲染）' };
        }
        if (scrolled < 2 && Date.now() > deadline - 6000) { scrolled++; try { await scrollLoadMore(); } catch (_) {} }
      }
    }
    return { ok: false, needNav: false, searched: true, miss: true, term: terms[0],
      error: '按「' + terms[0].slice(0, 16) + '」搜过了，结果里没有作者「' + (author || '（没存作者名）') + '」的这篇' };
  }

  /* 搜索词：首选「标题末尾减3字」——取标题尾部 12 字再去掉最后 3 字（标题常以 emoji/话题标签收尾，整条带上反而搜不出）；
     没定位到再退回「整条标题去掉末尾 3 字」。两种写法一样时只留一个。 */
  function _drainSearchTerms(title) {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const out = [];
    const tail = t.length > 14 ? t.slice(-12) : t;
    const a = (tail.length > 6 ? tail.slice(0, -3) : tail).trim();
    if (a.length >= 4) out.push(a);
    const b = (t.length > 6 ? t.slice(0, -3) : t).trim();
    if (b.length >= 4 && out.indexOf(b) < 0) out.push(b);
    return out.length ? out : [t];
  }

  /* 在搜索结果里找目标卡片：作者名定位（Ctrl+F 的等价物）→ 作者命中的卡片里再用标题确认是哪一篇。
     没作者名（老笔记没存）才退回纯标题比对；标题可能被平台截断，故留"互相包含/前 12 字前缀"的模糊。 */
  function _findSearchCard(q) {
    let notes = [];
    try { notes = (extractSearchResults() || {}).notes || []; } catch (_) { return null; }
    if (!notes.length) return null;
    const nt = _normName(q.title);
    const na = _normName(q.author);
    if (q.noteId) {
      const byId = notes.find(n => n.noteId === q.noteId);
      if (byId) return Object.assign({}, byId, { by: 'noteId' });
    }
    if (!nt) return null;
    // 标题沾边：完全一致 / 互相包含（我们搜的是「标题末尾减3字」，卡片标题可能被平台截断）
    const titleHit = (n) => {
      const t = _normName(n.title);
      if (!t) return false;
      if (t === nt || t.includes(nt) || nt.includes(t)) return true;
      const cut = nt.slice(0, 12);
      return cut.length >= 6 && t.includes(cut);
    };
    if (na) {
      const same = notes.filter(n => _normName(n.author) === na);
      if (same.length) {
        const both = same.find(titleHit);
        if (both) return Object.assign({}, both, { by: '作者+标题' });
        if (same.length === 1) return Object.assign({}, same[0], { by: '作者' });
      }
      // 卡片上的昵称可能带后缀（「xx的日常」），按 Ctrl+F 的口径放宽成包含匹配，仍要求标题对得上
      if (na.length >= 2) {
        const loose = notes.filter(n => { const a = _normName(n.author); return !!a && (a.includes(na) || na.includes(a)); });
        if (loose.length) {
          const both2 = loose.find(titleHit);
          if (both2) return Object.assign({}, both2, { by: '作者(模糊)+标题' });
          if (loose.length === 1) return Object.assign({}, loose[0], { by: '作者(模糊)' });
        }
      }
    }
    const byTitle = notes.find(titleHit);
    if (byTitle) return Object.assign({}, byTitle, { by: na ? '标题(作者没对上)' : '标题' });
    return null;
  }

  // ── 在搜索页找到并点击指定笔记的链接（模拟用户点击） ──
  function clickNoteLink(title, noteId, rawLinkIndex) {
    const allLinkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';

    // ★【方案A：开箱即检】有 noteId 时，先确认当前页面 DOM 里真的存在该卡片，
    //   不存在就直接失败跳过，绝不 window.find / rawLinkIndex 去乱点别的卡片。
    if (noteId) {
      const gateLink = document.querySelector(`a[href*="/explore/${noteId}"], a[href*="/note/${noteId}"], a[href*="/search_result/${noteId}"]`);
      if (!gateLink) {
        console.log('[打开:跳过] 当前页面DOM不存在 noteId=' + noteId + ' 的卡片（页面已重绘/不在本批），跳过该笔记 title="' + String(title || '').slice(0, 20) + '"');
        return { clicked: false, reason: 'note_not_in_dom', noteId, title, skipped: true };
      }
    }

    // 策略0：CTRL+F 式按标题文字搜索点击，最多试 3 次：
    //   第1次用完整标题；找不到就删掉标题最后 1 个字符再试；仍找不到就再删 1 个字符（共删 2 个）。
    //   有些标题带 emoji / 被平台截断，删尾几字能提升命中率。locateNoteByTitle 要求标题长度>=2，删到过短则停。
    if (title) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const t = attempt === 0 ? title : title.slice(0, -attempt);
        if (!t || t.length < 2) break;
        const byTitle = locateNoteByTitle(t);
        if (byTitle) {
          byTitle.element.click();
          return { clicked: true, method: 'title_' + byTitle.method, matchRatio: byTitle.score, titleAttempt: attempt };
        }
        console.log('[一键灌水] CTRL+F 第' + (attempt + 1) + '次未命中，标题:', t.slice(0, 20));
      }
    }

    // 策略1：通过 rawLinkIndex 直接点击
    if (rawLinkIndex !== undefined && rawLinkIndex >= 0) {
      const allLinks = document.querySelectorAll(allLinkSelector);
      const link = allLinks[rawLinkIndex];
      if (link) {
        link.click();
        return { clicked: true, method: 'rawLinkIndex', rawLinkIndex };
      }
    }

    // 使用 getNoteLinkElements 获取有效笔记链接（排除头像链接）
    const allNoteLinks = getNoteLinkElements();

    // 策略2：通过 noteId 精确匹配链接
    if (noteId) {
      const linkById = document.querySelector(`a[href*="/explore/${noteId}"], a[href*="/note/${noteId}"], a[href*="/search_result/${noteId}"]`);
      if (linkById) {
        linkById.click();
        return { clicked: true, method: 'noteId' };
      }
    }

    // ★【诊断日志】三策略全失败，记录页面当前状态，一次性定位根因（卡片不在DOM？标题不匹配？索引错位？）
    try {
      const diagSections = document.querySelectorAll('section').length;
      const diagAllLinks = document.querySelectorAll(allLinkSelector).length;
      let hrefHasId = false, titleInText = false;
      try {
        hrefHasId = !!document.querySelector(`a[href*="/explore/${noteId}"]`);
        if (title && document.body && document.body.innerText) {
          titleInText = document.body.innerText.includes(title);
        }
      } catch (_) {}
      console.log('[诊断:打开失败] noteId=' + noteId + ' | title="' + String(title || '').slice(0, 20) +
        '" | rawLinkIndex=' + rawLinkIndex + ' | sections=' + diagSections + ' | 全部笔记链接=' + diagAllLinks +
        ' | href含noteId=' + hrefHasId + ' | 标题文字在页面innerText=' + titleInText +
        ' | 当前URL=' + location.href.slice(0, 80));
    } catch (_) {}

    return { clicked: false, reason: '未找到匹配笔记', totalLinks: allNoteLinks.length, noteId, title };
  }

  // ═══════════ 🌿 日常浏览（②③可用，不列入对外功能清单）：在信息流/搜索结果里做普通浏览动作 ═══════════
  // 一个「单位」= 挑一篇笔记：向下滚一段 → 停留 → 按概率点开 → 停留阅读 → 按概率点赞/收藏 → 退回信息流。
  // 节奏（时段/配额/停留/概率）由设置页「🌿 日常浏览」配置，background 侧 lib/daily-browse.js 驱动。
  function _dbRand(min, max) {
    const a = Number(min) || 0, b = Number(max) || 0;
    return a + Math.random() * Math.max(0, b - a);
  }
  function _dbSleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, Math.round(ms)))); }
  // 真人式点击：按中心点派发 pointer/mouse 全套事件（React 卡片只认这种，el.click() 常被吞）
  function _dbClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, o, { pointerType: 'mouse' })));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { pointerType: 'mouse' })));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }
  function _dbVisible(el) {
    if (!el || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return false;
    return r.bottom > 80 && r.top < (window.innerHeight - 60);
  }
  function _dbCardInfo(link) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/explore\/([a-z0-9]+)/) || href.match(/\/search_result\/([a-z0-9]+)/) || href.match(/\/note\/([a-z0-9]+)/);
    if (!m) return null;
    let title = '';
    try {
      const card = link.closest('section') || link.parentElement || link;
      const t = card.querySelector('[class*="title"], .title');
      title = ((t && t.textContent) || (card.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 40);
    } catch (_) {}
    return { noteId: m[1], title, el: link };
  }
  // 当前视口里可浏览的笔记卡片（同一 noteId 只留一张；skip = 本轮已处理过的）
  function _dbVisibleCards(skip) {
    const out = [], seen = new Set();
    let links = [];
    try { links = getNoteLinkElements(); } catch (_) { links = []; }
    for (const link of links) {
      const info = _dbCardInfo(link);
      if (!info || seen.has(info.noteId)) continue;
      seen.add(info.noteId);
      if (skip && skip.has(info.noteId)) continue;
      if (!_dbVisible(info.el)) continue;
      out.push(info);
    }
    return out;
  }
  function _dbIsNoteOpen() {
    try { return !!findBottomReplyInput(); } catch (_) { return false; }
  }
  // 笔记详情页的「赞 / 收藏」：优先按交互区 class 命中，再退回极短文案匹配；评论区里的赞一律排除
  function _dbFindEngageEl(kind) {
    const isLike = kind === 'like';
    const clsRe = isLike ? /like-wrapper|like-container|like-box/i : /collect-wrapper|collect-container|collect-box/i;
    const txtRe = isLike ? /^(赞|已赞|点赞|已点赞)$/ : /^(收藏|已收藏|收藏夹)$/;
    const cands = [];
    for (const el of document.querySelectorAll('div, span, button, a')) {
      if (el.offsetParent === null) continue;
      let cls = '';
      try { cls = String(el.className || ''); } catch (_) { cls = ''; }
      const txt = (el.textContent || '').trim();
      if (txt.length > 12) continue;
      const byCls = clsRe.test(cls);
      const byTxt = txtRe.test(txt);
      if (!byCls && !byTxt) continue;
      try { if (el.closest('[class*="comment"]')) continue; } catch (_) {}
      let depth = 0, p = el;
      while ((p = p.parentElement)) depth++;
      cands.push({ el, byCls, byTxt, depth, txt, cls });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (b.byCls - a.byCls) || (b.depth - a.depth));
    const c = cands[0];
    return { el: c.el, active: /active/i.test(c.cls) || /已赞|已收藏/.test(c.txt) };
  }
  // 收藏后会弹「选择收藏夹」：点掉弹层里的取消/关闭；兜底按 Esc
  async function _dbDismissDialog() {
    await _dbSleep(600);
    try {
      const btns = Array.from(document.querySelectorAll('button, div, span, a')).filter(el => {
        if (el.offsetParent === null) return false;
        const t = (el.textContent || '').trim();
        if (t !== '取消' && t !== '关闭') return false;
        try { return !!el.closest('[class*="modal"], [class*="dialog"], [class*="popover"], [class*="mask"], [class*="picker"], [class*="collect"]'); } catch (_) { return false; }
      });
      if (btns.length) {
        const el = btns[btns.length - 1];
        try { _dbClick(el); } catch (_) { try { el.click(); } catch (__) {} }
        await _dbSleep(500);
        return true;
      }
    } catch (_) {}
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await _dbSleep(400);
    } catch (_) {}
    return false;
  }
  // 退回信息流：优先点弹层关闭按钮，兜底 history.back()；等到回复框消失
  async function _dbCloseNote(timeoutMs) {
    const t0 = Date.now();
    const limit = timeoutMs || 9000;
    try {
      const closers = Array.from(document.querySelectorAll('[class*="close" i]')).filter(el => {
        if (el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.width > 90) return false;
        if (r.top > window.innerHeight * 0.35) return false;
        const t = (el.textContent || '').trim();
        return t.length === 0 || /^(关闭|返回|取消|×|✕|✖)$/.test(t);
      });
      if (closers.length) {
        try { _dbClick(closers[0]); } catch (_) {}
        await _dbSleep(700);
      }
    } catch (_) {}
    if (_dbIsNoteOpen() && window.history.length > 1) {
      try { window.history.back(); } catch (_) {}
    }
    while (Date.now() - t0 < limit) {
      if (!_dbIsNoteOpen()) return true;
      await _dbSleep(400);
    }
    return !_dbIsNoteOpen();
  }
  // 打开一篇笔记并停留阅读；返回 { opened, dwellMs }
  async function _dbOpenAndRead(card, dwellMinS, dwellMaxS) {
    const out = { opened: false, dwellMs: 0 };
    try {
      card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await _dbSleep(_dbRand(300, 700));
      try { _dbClick(card.el); } catch (_) { try { card.el.click(); } catch (__) {} }
    } catch (_) { return out; }
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (_dbIsNoteOpen()) { out.opened = true; break; }
      await _dbSleep(400);
    }
    if (!out.opened) return out;   // 点了没开（卡片重排/被吞）：不硬撑，退回信息流继续
    const dwellMs = Math.round(_dbRand(dwellMinS, dwellMaxS) * 1000);
    const steps = Math.max(1, Math.round(dwellMs / 12000));
    for (let i = 0; i < steps; i++) {
      _touchLock();
      await _dbSleep(dwellMs / steps);
      try {
        const sc = getNoteScroller();
        if (sc) sc.scrollBy({ top: Math.round(_dbRand(180, 520)), behavior: 'smooth' });
      } catch (_) {}
    }
    out.dwellMs = dwellMs;
    return out;
  }
  // 点赞 / 收藏当前打开的笔记
  async function _dbEngage(kind) {
    _touchLock();
    const found = _dbFindEngageEl(kind);
    if (!found) return { ok: false, error: '未找到' + (kind === 'like' ? '点赞' : '收藏') + '按钮' };
    if (found.active) return { ok: true, already: true };
    try {
      found.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await _dbSleep(_dbRand(250, 600));
      try { _dbClick(found.el); } catch (_) { try { found.el.click(); } catch (__) {} }
      await _dbSleep(_dbRand(600, 1100));
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    let ok = false;
    try { const after = _dbFindEngageEl(kind); ok = !!(after && after.active); } catch (_) {}
    if (kind === 'collect') await _dbDismissDialog();
    return { ok, clicked: true };
  }
  /* ── 🌿 日常浏览 · 顺手互动（P1 评论 / P2 回复 / P3 关注）──
     隔离口径：只在本轮返回的计数里记账，绝不写获客台账（见设计文档 §五）。
     两条硬规矩：
       ① 动作一律**函数直调**（sendNoteComment / sendReplyToComment / followUser）——
          走 chrome.runtime 的消息路由会二次抢同一把锁，必然失败；
       ② AI 只用来"生成一句自然的话 / 挑一条评论"，不带任何产品、知识库、话术资料。 */
  function _dbNoteMeta() {
    const out = { title: '', desc: '', author: '' };
    try {
      const og = document.querySelector('meta[property="og:title"]');
      const od = document.querySelector('meta[property="og:description"]');
      const am = document.querySelector('meta[name="author"]');
      out.title = String((og && og.content) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      out.desc = String((od && od.content) || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      out.author = String((am && am.content) || '').trim().slice(0, 30);
    } catch (_) {}
    if (!out.author) {
      try {
        const a = Array.from(document.querySelectorAll('a[href*="/user/"]'))
          .map(el => (el.textContent || '').replace(/^@/, '').trim())
          .filter(t => t && t.length <= 20);
        if (a.length) out.author = a[0];
      } catch (_) {}
    }
    return out;
  }
  // 调后台 AI（只算文本，不抢锁）：超时/没配 Key 都返回 { ok:false }，由调用方兜底
  function _dbAiAsk(action, data, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'AI 超时' }); } }, timeoutMs || 25000);
      try {
        chrome.runtime.sendMessage({ action: action, data: data || {} }, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp || { ok: false, error: '无响应' });
        });
      } catch (e) { clearTimeout(t); resolve({ ok: false, error: (e && e.message) || String(e) }); }
    });
  }
  function _dbPoolPick(pool) {
    return '';
  }
  // P1 顺手评论：AI 独立提示词生成一句 → 没有就跳过（不再取本地句池，2026-10-01）
  async function _dbTryComment(opts, st) {
    const c = opts.comment || {};
    if (!(st.commentLeft > 0)) return '';
    if (Math.random() * 100 >= (Number(c.rate) || 0)) return '';
    const meta = _dbNoteMeta();
    let text = '';
    const r = await _dbAiAsk('aiDailyComment', { title: meta.title, excerpt: meta.desc }, 25000);
    if (r && r.ok && String(r.text || '').trim()) text = String(r.text).trim().slice(0, 60);
    if (!text) { console.log('[日常浏览] 顺手评论跳过：AI 没给'); return ''; }
    _showStatus('🌿 顺手评论一句…');
    let res = null;
    try { res = await sendNoteComment({ text: text, noteId: (st.card && st.card.noteId) || '', title: meta.title, humanize: false }); }
    catch (e) { res = { success: false, error: (e && e.message) || String(e) }; }
    _hideStatus();
    if (!res || !res.success) { console.log('[日常浏览] 顺手评论没发出去：' + ((res && res.error) || '未知原因')); return ''; }
    st.comments++; st.commentLeft--;
    console.log('[日常浏览] 🌿 顺手评论已发：' + text);
    return text;
  }
  // P2 回复别人的评论：取评论 → AI 挑一条「值得回」的并给一句自然回复 → 直调 sendReplyToComment
  async function _dbTryReply(opts, st) {
    if (!(st.replyLeft > 0)) return null;
    let page = null;
    try { page = extractPageData(); } catch (_) { return null; }
    const flat = (page && page.comments) || [];
    if (flat.length < 2) return null;
    const me = _dbNoteMeta().author;
    const cands = [];
    for (let i = 0; i < flat.length && cands.length < 12; i++) {
      const c = flat[i];
      if (!c || !c.content) continue;
      if (String(c.content).trim().length < 4) continue;
      if (me && c.author && String(c.author).trim() === me) continue;   // 自己发的不回
      cands.push({ i: i, author: String(c.author || '').trim(), text: String(c.content).trim().slice(0, 120) });
    }
    if (!cands.length) return null;
    const r = await _dbAiAsk('aiDailyReply', { title: (page && page.title) || '', comments: cands }, 25000);
    if (!r || !r.ok || !String(r.text || '').trim()) return null;
    const target = cands.find(x => x.i === Number(r.pick)) || null;
    const text = String(r.text).trim().slice(0, 80);
    if (!target) return null;
    _showStatus('🌿 顺手回一条评论…');
    let res = null;
    try {
      res = await sendReplyToComment(target.author, target.text, text, target.i,
        (((flat[target.i] || {}).userLink) || ''), [], true);
    } catch (e) { res = { success: false, error: (e && e.message) || String(e) }; }
    _hideStatus();
    if (!res || !res.success) { console.log('[日常浏览] 顺手回复没发出去：' + ((res && res.error) || '未知原因')); return null; }
    st.replies++; st.replyLeft--;
    console.log('[日常浏览] 🌿 顺手回复已发给 @' + target.author + '：' + text);
    return { author: target.author, text: text };
  }
  // P3 关注作者：按概率关注当前笔记的作者（已关注/找不到就跳过）
  async function _dbTryFollow(opts, st) {
    const c = opts.follow || {};
    if (!(st.followLeft > 0)) return false;
    if (Math.random() * 100 >= (Number(c.rate) || 0)) return false;
    const author = _dbNoteMeta().author;
    if (!author) return false;
    _showStatus('🌿 顺手关注一下作者…');
    let r = null;
    try { r = await followUser(author); } catch (e) { r = { success: false, error: (e && e.message) || String(e) }; }
    _hideStatus();
    if (!r || !r.success) { console.log('[日常浏览] 关注没完成：' + ((r && r.error) || '未知原因')); return false; }
    st.follows++; st.followLeft--;
    console.log('[日常浏览] 🌿 已关注 @' + author);
    return true;
  }
  // 一轮日常浏览：count 篇；每篇结果顺手落到 daily_browse_last（后台被杀也能对账）
  async function browseRound(opts) {
    opts = opts || {};
    const count = Math.max(1, Math.min(8, parseInt(opts.count, 10) || 1));
    const dwellMinS = Math.max(2, Number(opts.dwellMin) || 8);
    const dwellMaxS = Math.max(dwellMinS, Number(opts.dwellMax) || 25);
    const openRate = Math.max(0, Math.min(100, Number(opts.openRate)) || 0);
    const likeRate = Math.max(0, Math.min(100, Number(opts.likeRate)) || 0);
    const collectRate = Math.max(0, Math.min(100, Number(opts.collectRate)) || 0);
    const roundId = opts.roundId || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const startedAt = Date.now();
    const maxMs = count * ((dwellMaxS + 30) * 1000) + 60000;   // 本轮硬上限，防止异常卡死
    const items = [];
    const picked = new Set();
    // 顺手互动的本轮预算（由执行器按"今日还剩多少"给下来）＋本轮已做几条
    const st = {
      card: null,
      comments: 0, replies: 0, follows: 0,
      commentLeft: Math.max(0, parseInt((opts.comment || {}).left, 10) || 0),
      replyLeft: Math.max(0, parseInt((opts.reply || {}).left, 10) || 0),
      followLeft: Math.max(0, parseInt((opts.follow || {}).left, 10) || 0),
    };
    const _persist = async (done) => {
      try {
        const rec = {
          roundId, startedAt, dirId: String(opts.dirId || ''), dirName: String(opts.dirName || ''),
          total: count, items: items.slice(), ts: Date.now(), url: location.href.slice(0, 120),
          comments: st.comments, replies: st.replies, follows: st.follows,
          done: !!done,
        };
        if (done) rec.doneAt = Date.now();
        await chrome.storage.local.set({ daily_browse_last: rec });
      } catch (_) {}
    };
    const _stopped = async () => {
      try { const d = await chrome.storage.local.get('daily_browse_stop_at'); return (d.daily_browse_stop_at || 0) > startedAt; } catch (_) { return false; }
    };
    // ★ 心跳补密：一轮持锁要 1~3 分钟，中间"点了笔记没打开"那段能有 20 多秒空档 → 定时刷新持锁时间
    const hb = setInterval(() => { try { _touchLock(); } catch (_) {} }, 3000);
    try {
    console.log('[日常浏览] 开始一轮：' + (opts.dirName ? '「' + opts.dirName + '」' : '') + '目标 ' + count + ' 篇，停留 ' + dwellMinS + '~' + dwellMaxS + 's，打开 ' + openRate + '%，赞 ' + likeRate + '%，藏 ' + collectRate + '%');
    await _persist(false);   // 先落"开跑"标记：执行器靠它对账（不用等长消息返回）
    for (let i = 0; i < count; i++) {
      if (Date.now() - startedAt > maxMs) { console.warn('[日常浏览] 本轮超过时间上限，提前收尾'); break; }
      if (await _stopped()) { console.log('[日常浏览] 收到停止指令，提前收尾'); break; }
      _touchLock();
      // 1) 向下滚一段 + 停留（普通浏览动作）
      try { window.scrollBy({ top: Math.round(_dbRand(320, Math.max(360, (window.innerHeight || 800) * 0.9))), behavior: 'smooth' }); } catch (_) {}
      await _dbSleep(_dbRand(700, 1600));
      const feedDwell = Math.round(_dbRand(dwellMinS, dwellMaxS) * 1000 * 0.4);
      _touchLock();
      await _dbSleep(feedDwell);
      // 2) 挑一张当前视口里的卡片
      let cards = _dbVisibleCards(picked);
      if (!cards.length) {
        try { window.scrollBy({ top: Math.round(_dbRand(400, 900)), behavior: 'smooth' }); } catch (_) {}
        await _dbSleep(1300);
        cards = _dbVisibleCards(picked);
      }
      if (!cards.length) { console.log('[日常浏览] 当前没有可浏览的卡片，本轮收尾'); break; }
      const card = cards[Math.floor(Math.random() * cards.length)];
      picked.add(card.noteId);
      st.card = card;
      const item = { noteId: card.noteId, title: card.title, opened: false, liked: false, collected: false, dwellMs: feedDwell, ts: Date.now() };
      // 3) 按概率打开笔记 → 停留阅读 → 按概率点赞/收藏 → 顺手评论/回复/关注 → 退回信息流
      if (Math.random() * 100 < openRate) {
        const r = await _dbOpenAndRead(card, dwellMinS, dwellMaxS);
        item.opened = !!r.opened;
        item.dwellMs = feedDwell + (r.dwellMs || 0);
        if (r.opened) {
          if (Math.random() * 100 < likeRate) { const lk = await _dbEngage('like'); item.liked = !!(lk && lk.ok); }
          if (Math.random() * 100 < collectRate) { const cl = await _dbEngage('collect'); item.collected = !!(cl && cl.ok); }
          // 🌿 顺手互动（P1 评论 / P2 回复 / P3 关注）：只记自己的账，不进获客台账
          if (!(await _stopped())) {
            const cmt = await _dbTryComment(opts, st);
            if (cmt) { item.commented = cmt; item.acts = (item.acts || 0) + 1; await _persist(false); }
            if (!(await _stopped())) {
              const rep = await _dbTryReply(opts, st);
              if (rep) { item.repliedTo = rep.author; item.acts = (item.acts || 0) + 1; await _persist(false); }
            }
            if (!(await _stopped())) {
              if (await _dbTryFollow(opts, st)) { item.followed = true; item.acts = (item.acts || 0) + 1; }
            }
          }
          await _dbCloseNote(9000);
        }
      }
      items.push(item);
      await _persist(false);
      console.log('[日常浏览] 第 ' + (i + 1) + '/' + count + ' 篇：' + (card.title || card.noteId) +
        (item.opened ? '（已打开 ' + Math.round(item.dwellMs / 1000) + 's）' : '（仅停留）') +
        (item.liked ? ' 👍' : '') + (item.collected ? ' ⭐' : '') +
        (item.commented ? ' 💬' : '') + (item.repliedTo ? ' ↩' : '') + (item.followed ? ' ➕' : ''));
    }
    await _persist(true);
    } finally {
      clearInterval(hb);
    }
    const summary = {
      ok: true, roundId, items,
      viewed: items.length,
      openedCount: items.filter(x => x.opened).length,
      likedCount: items.filter(x => x.liked).length,
      collectedCount: items.filter(x => x.collected).length,
      comments: st.comments, replies: st.replies, follows: st.follows,
      ms: Date.now() - startedAt,
    };
    console.log('[日常浏览] 本轮结束：浏览 ' + summary.viewed + ' 篇，打开 ' + summary.openedCount + ' 篇，点赞 ' + summary.likedCount +
      '，收藏 ' + summary.collectedCount + '，评论 ' + summary.comments + '，回复 ' + summary.replies + '，关注 ' + summary.follows);
    return summary;
  }

  /* ── 调试：列出页面所有 a[href*="/explore/"] / a[href*="/note/"] / a[href*="/search_result/"] 原始元素 ── */
  function debugListElements() {
    const linkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';
    const links = document.querySelectorAll(linkSelector);
    const noteLinkSet = new Set(getNoteLinkElements());
    const elements = [];
    for (let i = 0; i < links.length; i++) {
      const el = links[i];
      const href = el.getAttribute('href') || '';
      const m = href.match(/\/explore\/([a-z0-9]+)/) || href.match(/\/note\/([a-z0-9]+)/) || href.match(/\/search_result\/([a-z0-9]+)/);
      const rect = el.getBoundingClientRect();
      const isNoteLink = noteLinkSet.has(el);
      // 查找所属 section
      let sectionIdx = -1;
      let section = el.closest('section');
      if (section) {
        const allSections = document.querySelectorAll('section');
        for (let s = 0; s < allSections.length; s++) {
          if (allSections[s] === section) { sectionIdx = s; break; }
        }
      }
      elements.push({
        index: i,
        tagName: el.tagName,
        href: href,
        noteId: m ? m[1] : '',
        text: (el.textContent || '').trim().slice(0, 60),
        visible: rect.width > 0 && rect.height > 0,
        className: (el.className || '').slice(0, 40),
        isNoteLink: isNoteLink,
        sectionIdx: sectionIdx,
        // 在 section 内的 a 位置
        linkPosInSection: section ? Array.from(section.querySelectorAll('a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]')).indexOf(el) : -1,
      });
    }
    return { elements, total: elements.length };
  }

  /* ── 调试：高亮第 N 个原始元素（粗暴可靠版） ── */
  function debugHighlightElement(index) {
    const linkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';
    const links = document.querySelectorAll(linkSelector);
    if (index < 0 || index >= links.length) return { success: false, error: '索引超出范围' };
    const el = links[index];
    const href = el.getAttribute('href') || '';
    console.log('[调试高亮] #' + index + ' href=' + href);

    // 清除之前的高亮残留
    document.querySelectorAll('.xhs-dbg-banner, .xhs-dbg-overlay, .xhs-dbg-label').forEach(l => l.remove());

    // 1. 页面顶部红色横幅（100%能看到）
    const banner = document.createElement('div');
    banner.className = 'xhs-dbg-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#ff4444;color:#fff;padding:10px 16px;font-size:14px;font-weight:bold;text-align:center;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    banner.textContent = '🔍 高亮元素 #' + index + ' | ' + href.slice(0, 60);
    document.body.appendChild(banner);

    // 2. 滚动到元素
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 3. 等滚动完成后添加覆盖层和标签
    setTimeout(function() {
      const rect = el.getBoundingClientRect();
      // 红色边框覆盖层
      const overlay = document.createElement('div');
      overlay.className = 'xhs-dbg-overlay';
      overlay.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;box-sizing:border-box;border:5px solid #ff0000;background:rgba(255,0,0,0.15);';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = Math.max(rect.width, 10) + 'px';
      overlay.style.height = Math.max(rect.height, 10) + 'px';
      document.body.appendChild(overlay);
      // 浮动标签
      const label = document.createElement('div');
      label.className = 'xhs-dbg-label';
      label.style.cssText = 'position:fixed;z-index:99999;background:#ff4444;color:#fff;padding:3px 10px;border-radius:4px;font-size:13px;font-family:monospace;pointer-events:none;white-space:nowrap;font-weight:bold;';
      label.style.top = Math.max(0, rect.top - 30) + 'px';
      label.style.left = Math.max(0, rect.left) + 'px';
      label.textContent = '#' + index + ' ' + href;
      document.body.appendChild(label);
      // 定期刷新位置
      let count = 0;
      const iv = setInterval(function() {
        const nr = el.getBoundingClientRect();
        if (nr.width > 0 && nr.height > 0) {
          overlay.style.top = nr.top + 'px'; overlay.style.left = nr.left + 'px';
          overlay.style.width = Math.max(nr.width, 10) + 'px'; overlay.style.height = Math.max(nr.height, 10) + 'px';
          label.style.top = Math.max(0, nr.top - 30) + 'px'; label.style.left = Math.max(0, nr.left) + 'px';
        }
        if (++count > 10) clearInterval(iv);
      }, 500);
    }, 500);

    return { success: true, index };
  }

  /* ── 高亮定位笔记 ── */
  async function highlightNote(title, noteId, searchIndex, rawLinkIndex) {
    const allLinkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';

    // 策略0：通过 rawLinkIndex 直接定位（与 debug 查元素一致，最可靠）
    if (rawLinkIndex !== undefined && rawLinkIndex >= 0) {
      const allLinks = document.querySelectorAll(allLinkSelector);
      const el = allLinks[rawLinkIndex];
      if (el) {
        const href = el.getAttribute('href') || '';
        console.log('[定位调试] ✅ rawLinkIndex定位 #' + rawLinkIndex + ' href=' + href);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 清除之前的高亮
        document.querySelectorAll('.xhs-locate-banner, .xhs-locate-overlay, .xhs-locate-label').forEach(l => l.remove());
        // 页面横幅
        const banner = document.createElement('div');
        banner.className = 'xhs-locate-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#2563eb;color:#fff;padding:8px 14px;font-size:13px;font-weight:bold;text-align:center;font-family:sans-serif;';
        banner.textContent = '📍 定位 #' + rawLinkIndex + ': ' + href.slice(-30);
        document.body.appendChild(banner);
        setTimeout(function() { banner.remove(); }, 5000);
        // 覆盖层+标签
        setTimeout(function() {
          const rect2 = el.getBoundingClientRect();
          const ov2 = document.createElement('div');
          ov2.className = 'xhs-locate-overlay';
          ov2.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;border:4px solid #2563eb;background:rgba(37,99,235,0.12);';
          ov2.style.top = rect2.top + 'px'; ov2.style.left = rect2.left + 'px';
          ov2.style.width = Math.max(rect2.width, 10) + 'px'; ov2.style.height = Math.max(rect2.height, 10) + 'px';
          document.body.appendChild(ov2);
          const lb2 = document.createElement('div');
          lb2.className = 'xhs-locate-label';
          lb2.style.cssText = 'position:fixed;z-index:99999;background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-family:monospace;pointer-events:none;';
          lb2.style.top = Math.max(0, rect2.top - 26) + 'px'; lb2.style.left = Math.max(0, rect2.left) + 'px';
          lb2.textContent = '#' + rawLinkIndex + ' ' + href.slice(-30);
          document.body.appendChild(lb2);
          setTimeout(function() { ov2.remove(); lb2.remove(); }, 10000);
        }, 500);
        return { found: true, method: 'rawLinkIndex', rawLinkIndex, actualHref: href };
      }
    }

    // 策略1：通过 getNoteLinkElements + searchIndex 定位（旧方案，无 rawLinkIndex 时回退）
    const noteLinkEls = getNoteLinkElements();
    const validLinks = noteLinkEls.map(el => ({
      el,
      noteId: (el.getAttribute('href') || '').match(/\/explore\/([a-z0-9]+)/)?.[1] || (el.getAttribute('href') || '').match(/\/note\/([a-z0-9]+)/)?.[1] || (el.getAttribute('href') || '').match(/\/search_result\/([a-z0-9]+)/)?.[1] || '',
      href: el.getAttribute('href') || '',
    }));

    console.log('[定位调试] validLinks:', validLinks.length, 'searchIndex:', searchIndex, '期望noteId:', noteId);

    // 获取 searchIndex 位置的信息
    let actualAtPos = null;
    if (searchIndex !== undefined && searchIndex >= 0 && searchIndex < validLinks.length) {
      const item = validLinks[searchIndex];
      actualAtPos = {
        noteId: item.noteId,
        href: item.href,
        text: (item.el.textContent || '').trim().slice(0, 60),
      };
    }

    // 验证 searchIndex 位置是否匹配
    if (actualAtPos && actualAtPos.noteId === noteId) {
      console.log('[定位调试] ✅ 匹配成功');
      const el = validLinks[searchIndex].el;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.querySelectorAll('.xhs-locate-banner, .xhs-locate-overlay, .xhs-locate-label').forEach(l => l.remove());
      const banner = document.createElement('div');
      banner.className = 'xhs-locate-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#2563eb;color:#fff;padding:8px 14px;font-size:13px;font-weight:bold;text-align:center;font-family:sans-serif;';
      banner.textContent = '📍 定位成功: ' + (actualAtPos.href || '').slice(-30);
      document.body.appendChild(banner);
      setTimeout(function() { banner.remove(); }, 5000);
      setTimeout(function() {
        const rect2 = el.getBoundingClientRect();
        const ov2 = document.createElement('div');
        ov2.className = 'xhs-locate-overlay';
        ov2.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;border:4px solid #2563eb;background:rgba(37,99,235,0.12);';
        ov2.style.top = rect2.top + 'px'; ov2.style.left = rect2.left + 'px';
        ov2.style.width = Math.max(rect2.width, 10) + 'px'; ov2.style.height = Math.max(rect2.height, 10) + 'px';
        document.body.appendChild(ov2);
        const lb2 = document.createElement('div');
        lb2.className = 'xhs-locate-label';
        lb2.style.cssText = 'position:fixed;z-index:99999;background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-family:monospace;pointer-events:none;';
        lb2.style.top = Math.max(0, rect2.top - 26) + 'px'; lb2.style.left = Math.max(0, rect2.left) + 'px';
        lb2.textContent = actualAtPos.href.slice(-30);
        document.body.appendChild(lb2);
        setTimeout(function() { ov2.remove(); lb2.remove(); }, 10000);
      }, 500);
      return {
        found: true, method: 'searchIndex', searchIndex,
        actualHref: actualAtPos.href, expectedNoteId: noteId,
      };
    }

    // 不匹配：找这个 noteId 实际在哪个索引
    let foundAt = -1;
    for (let i = 0; i < validLinks.length; i++) {
      if (validLinks[i].noteId === noteId) { foundAt = i; break; }
    }

    console.log('[定位调试] ❌ 位置不匹配, 实际:', actualAtPos, '实际索引:', foundAt);
    return {
      found: false,
      searchIndex,
      error: '位置不匹配',
      actualAtPosition: actualAtPos || { noteId: '', href: '', text: '' },
      expectedNoteId: noteId,
      noteFoundAtIndex: foundAt,
      totalValidLinks: validLinks.length,
    };
  }

  /* ── CTRL+F 式：按笔记标题文字搜索定位（不受 DOM 索引变化影响） ── */
  function locateNoteByTitle(title) {
    if (!title || title.length < 2) return null;

    const linkSelector = 'a[href*="/explore/"], a[href*="/note/"], a[href*="/search_result/"]';
    const titleWords = title.split(/\s+/).filter(w => w.length >= 2);
    if (titleWords.length === 0) return null;

    // 模糊匹配：先精确匹配，如果不行就逐字去掉尾部再试
    function wordMatch(text, word) {
      if (text.includes(word)) return true;
      // 去掉最后1个字重试
      if (word.length > 4 && text.includes(word.slice(0, -1))) return true;
      // 去掉最后2个字重试
      if (word.length > 6 && text.includes(word.slice(0, -2))) return true;
      return false;
    }

    // 方案A：遍历每个 section，用整块文字匹配
    const sections = document.querySelectorAll('section');
    let bestSection = null;
    let bestSectionRatio = 0;

    for (const section of sections) {
      const text = section.textContent.trim();
      const matchCount = titleWords.filter(w => wordMatch(text, w)).length;
      const ratio = matchCount / titleWords.length;
      if (ratio > bestSectionRatio) {
        bestSectionRatio = ratio;
        bestSection = section;
      }
    }

    if (bestSection && bestSectionRatio >= 0.6) {
      const links = bestSection.querySelectorAll(linkSelector);
      // 第 2 个 a 是笔记链接（section/div/a[2]）
      const noteLink = links.length >= 2 ? links[1] : links[0];
      if (noteLink) {
        console.log('[locateByTitle] ✅ section匹配', '标题:', title.slice(0, 20), 'section占比:', bestSectionRatio);
        return { element: noteLink, method: 'title_section', score: bestSectionRatio };
      }
    }

    // 方案B：遍历所有链接，向上找容器匹配文字
    const allLinks = document.querySelectorAll(linkSelector);
    let bestLink = null;
    let bestRatio = 0;
    let bestDepth = 0;

    for (const link of allLinks) {
      let container = link.parentElement;
      for (let depth = 0; depth < 6 && container; depth++) {
        const text = container.textContent.trim();
        const matchCount = titleWords.filter(w => wordMatch(text, w)).length;
        const ratio = matchCount / titleWords.length;
        if (ratio > bestRatio || (ratio === bestRatio && depth < bestDepth)) {
          bestRatio = ratio;
          bestLink = link;
          bestDepth = depth;
        }
        container = container.parentElement;
      }
    }

    if (bestLink && bestRatio >= 0.6) {
      console.log('[locateByTitle] ✅ 容器匹配', '标题:', title.slice(0, 20), '占比:', bestRatio, '深度:', bestDepth);
      return { element: bestLink, method: 'title_fuzzy', score: bestRatio };
    }

    // 方案C：用 window.find 直接搜文字（非标准但 Chrome 支持）
    try {
      if (typeof window.find === 'function') {
        const found = window.find(title, false, false, true, false, true);
        if (found) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            let node = sel.getRangeAt(0).startContainer;
            while (node && node !== document.body) {
              if (node.nodeType === 1 && node.matches && node.matches(linkSelector)) {
                console.log('[locateByTitle] ✅ window.find匹配 标题:', title.slice(0, 20));
                return { element: node, method: 'window_find', score: 1 };
              }
              node = node.parentElement || node.parentNode;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[locateByTitle] window.find 失败:', e.message);
    }

    console.log('[locateByTitle] ❌ 未找到 标题:', title.slice(0, 30));
    return null;
  }

  // ── 账号绑定：在本人主页自动读取并验证一次（非本人主页自动忽略） ──
  if (!window.__xhsAccountGuardStarted) {
    window.__xhsAccountGuardStarted = true;
    let _lastAutoCheck = 0;
    const _bootVerify = () => {
      const now = Date.now();
      if (now - _lastAutoCheck > 60000) {   // 每分钟最多校验一次，避免频繁读写
        _lastAutoCheck = now;
        setTimeout(() => { _autoVerifyOwnProfile(); }, 1200);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootVerify, { once: true });
    else _bootVerify();
    // 小红书为 SPA，页面间切换不重载：定期探测，命中本人主页即验证
    setInterval(_bootVerify, 8000);
  }

})();

// ══════════════════════════════════════════════════════════════
// ⏱ 临时块：监听探针（仅 chrome.storage.local.watch_probe_on=true 时运行）
//   量三件事：
//     ① 5s 定时器在各可见性状态下的真实 tick 分布 → 判定"5s 提密"能否成立
//     ② 页面自发的未读/消息类请求时间线 + 重复 URL 排行 → 角标多久自刷新
//     ③ 角标数字变化时刻 → 顺带定位可用节点
//   报告落在 chrome.storage.local['watch_probe_report']，每 20s 一次
//   ★ 测完这一整块连同下面的一起删除（无其他文件依赖）
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.__xhsWatchProbe || window.top !== window.self) return;
  window.__xhsWatchProbe = true;

  const KEY = 'watch_probe_report';
  const OWNER_KEY = 'watch_probe_owner';   // 多标签页只让一页当领导，避免报告互相覆盖
  const RESET_AFTER_MS = 6 * 3600e3;   // 旧报告超过 6 小时自动重开，避免跨天混算
  const _sid = Math.random().toString(36).slice(2, 8);
  let R = null, _timer = null, _poll = null, _flushAt = 0, _ov = null, _leader = false, _bound = false;
  let _lastTick = 0, _lastVisAt = 0, _lastFocusAt = 0, _wasHidden = false, _wasFocused = false;
  const _netKeys = new Set();

  const _blank = () => ({
    startedAt: Date.now(), lastAt: Date.now(), sessions: 0,
    visibleMs: 0, hiddenMs: 0, focusedMs: 0, unfocusedMs: 0,
    tick: { total: 0, onTime: 0, soft: 0, hard: 0, huge: 0, max: 0 },
    resTotal: 0, netTotal: 0, net: [], hot: [],
    badgeCand: 0, badgeNow: '', badgeChanges: [], sessionLog: [], summary: '',
  });

  // ── 未读/消息类请求 + 重复 URL 排行（自己不发请求，只读页面已有的时间线） ──
  function _scanNet() {
    let es = [];
    try { es = performance.getEntriesByType('resource') || []; } catch (_) { return; }
    R.resTotal = es.length;
    const cnt = new Map();
    const WANT = /unread|notice|notif|message|msg|chat|im\/|count|badge|follow|comment|interact/i;
    for (const e of es) {
      const u = String(e.name || '');
      const k = u.split('?')[0].slice(-70);
      cnt.set(k, (cnt.get(k) || 0) + 1);
      if (!WANT.test(u)) continue;
      const id = Math.round(e.startTime) + '|' + k;
      if (_netKeys.has(id)) continue;
      _netKeys.add(id);
      R.net.push({ at: Date.now(), t: Math.round(e.startTime), ms: Math.round(e.duration), url: u.slice(0, 110) });
      R.netTotal++;
    }
    if (R.net.length > 120) R.net.splice(0, R.net.length - 120);
    if (_netKeys.size > 5000) _netKeys.clear();
    R.hot = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([u, c]) => c + '×' + u);
  }

  // ── 角标候选：小尺寸纯数字节点（不含子元素） ──
  function _badgeSnap() {
    let els = [];
    try {
      els = document.querySelectorAll('[class*="badge"],[class*="count"],[class*="unread"],[class*="dot"],[class*="red"],[class*="nav"],[class*="tab"],[class*="notice"]');
    } catch (_) { return ''; }
    const out = [];
    for (const el of els) {
      if (el.children && el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!/^\d{1,3}$/.test(t)) continue;
      let r = null; try { r = el.getBoundingClientRect(); } catch (_) { continue; }
      if (!r || r.width <= 0 || r.height <= 0 || r.width > 48 || r.height > 32) continue;
      out.push(String(el.className || el.tagName).slice(0, 40) + '=' + t);
    }
    R.badgeCand = out.length;
    return out.sort().join('|');
  }

  function _fmt(ms) { return (Math.round(ms / 600) / 100) + 'm'; }

  function _summary() {
    const t = R.tick;
    const pct = t.total ? Math.round((t.onTime / t.total) * 100) : 0;
    return '探针 ' + _fmt(Date.now() - R.startedAt)
      + '｜tick 准点 ' + pct + '%/共' + t.total
      + '｜软(6.5-15s) ' + t.soft + ' 硬(15-70s) ' + t.hard + ' 断(>70s) ' + t.huge + ' 最大 ' + t.max + 's'
      + '｜可见 ' + _fmt(R.visibleMs) + ' 隐藏 ' + _fmt(R.hiddenMs)
      + '｜有焦点 ' + _fmt(R.focusedMs)
      + '｜会话 ' + R.sessions + ' 次'
      + '｜角标变化 ' + R.badgeChanges.length + ' 次(现 ' + (R.badgeNow || '无') + ')'
      + '｜未读请求 ' + R.netTotal + ' 条';
  }

  function _flush() {
    if (!R) return;
    try {
      R.lastAt = Date.now();
      R.summary = _summary();
      const patch = { [KEY]: R };
      if (_leader) patch[OWNER_KEY] = { sid: _sid, at: Date.now(), url: location.href.slice(0, 60) };
      chrome.storage.local.set(patch);
    } catch (_) {}
  }

  function _overlay() {
    if (!_ov) {
      try {
        _ov = document.createElement('div');
        _ov.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;background:rgba(0,0,0,.72);color:#0f0;'
          + 'font:11px/1.5 monospace;padding:6px 9px;border-radius:6px;pointer-events:none;max-width:52vw;white-space:pre-wrap';
        (document.body || document.documentElement).appendChild(_ov);
      } catch (_) { _ov = null; }
    }
    if (_ov) _ov.textContent = R.summary + '\n' + (R.hot[0] || '') + '\n' + (R.hot[1] || '');
  }

  function _tick() {
    const now = performance.now();
    const gap = now - _lastTick; _lastTick = now;
    const t = R.tick;
    t.total++;
    if (gap <= 6500) t.onTime++;
    else if (gap <= 15000) t.soft++;
    else if (gap <= 70000) t.hard++;
    else t.huge++;
    if (gap > t.max) t.max = Math.round(gap);
    _scanNet();
    const snap = _badgeSnap();
    if (R.badgeNow && snap && snap !== R.badgeNow) {
      R.badgeChanges.push({ at: Date.now(), from: R.badgeNow, to: snap });
      if (R.badgeChanges.length > 50) R.badgeChanges.shift();
    }
    if (snap) R.badgeNow = snap;
    R.summary = _summary();
    _overlay();
    if (Date.now() - _flushAt > 20000) {
      _flushAt = Date.now(); _flush();
      // 领导位复核：被别的页抢走就退位待命（避免两边同写一份报告）
      try {
        chrome.storage.local.get(OWNER_KEY, (d) => {
          const o = d && d[OWNER_KEY];
          if (!o || o.sid !== _sid) { _leader = false; R = null; if (_timer) { clearInterval(_timer); _timer = null; } _waitLeader(); }
        });
      } catch (_) {}
    }
  }

  function _onVis() {
    if (!R || !_leader) return;   // 退位/停止后事件仍会进来，直接忽略
    const now = performance.now();
    const hidden = document.visibilityState === 'hidden';
    if (hidden !== _wasHidden) {
      const d = now - _lastVisAt;
      if (_wasHidden) R.hiddenMs += d; else R.visibleMs += d;
      _wasHidden = hidden; _lastVisAt = now;
      R.vis.push({ at: Date.now(), state: document.visibilityState });
      if (R.vis.length > 50) R.vis.shift();
      _flush();   // 状态切换是关键时刻，立刻落盘（也防 tab 被丢弃丢数据）
    }
    const f = document.hasFocus();
    if (f !== _wasFocused) {
      const d = now - _lastFocusAt;
      if (_wasFocused) R.focusedMs += d; else R.unfocusedMs += d;
      _wasFocused = f; _lastFocusAt = now;
      R.focus.push({ at: Date.now(), hasFocus: f });
      if (R.focus.length > 50) R.focus.shift();
    }
  }

  // 抢领导位：已有活着的领导（45s 内有心跳）就让位，只当待命页
  function _claim(cb) {
    try {
      chrome.storage.local.get(OWNER_KEY, (d) => {
        const o = d && d[OWNER_KEY];
        if (o && o.sid !== _sid && Date.now() - (o.at || 0) < 45000) return cb(false);
        try { chrome.storage.local.set({ [OWNER_KEY]: { sid: _sid, at: Date.now(), url: location.href.slice(0, 60) } }, () => cb(true)); }
        catch (_) { cb(false); }
      });
    } catch (_) { cb(false); }
  }

  function _become() {
    if (_timer || _leader) return;
    _leader = true;
    if (_poll) { clearInterval(_poll); _poll = null; }
    chrome.storage.local.get(KEY, (d) => {
      if (!_leader) return;
      const old = d && d[KEY];
      R = (old && old.startedAt && Date.now() - old.startedAt < RESET_AFTER_MS) ? old : _blank();
      R.sessions = (R.sessions || 0) + 1;
      R.sessionLog = (R.sessionLog || []).concat([{ at: Date.now(), url: location.href.slice(0, 80), total: R.tick.total }]).slice(-20);
      _lastTick = performance.now(); _lastVisAt = _lastTick; _lastFocusAt = _lastTick;
      _wasHidden = document.visibilityState === 'hidden';
      _wasFocused = document.hasFocus();
      if (!_bound) {
        _bound = true;
        document.addEventListener('visibilitychange', _onVis);
        window.addEventListener('focus', _onVis);
        window.addEventListener('blur', _onVis);
        window.addEventListener('pagehide', _flush);
      }
      _onVis(); _tick();
      _timer = setInterval(_tick, 5000);
      _flush();
      console.warn('[监听探针] 已启动（领导页 ' + _sid + '）· 报告键 ' + KEY);
    });
  }

  // 待命页：每 20s 试接班（领导页被关掉/丢弃时自动顶上）
  function _waitLeader() {
    if (_poll || _timer) return;
    _poll = setInterval(() => { _claim((ok) => { if (ok) _become(); }); }, 20000);
  }

  function _start() {
    if (_timer || _poll) return;
    _claim((ok) => { if (ok) _become(); else _waitLeader(); });
  }

  function _stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_poll) { clearInterval(_poll); _poll = null; }
    if (_leader) {
      if (R) { R.summary = _summary(); try { chrome.storage.local.set({ [KEY]: R }); } catch (_) {} }
      try { chrome.storage.local.remove(OWNER_KEY); } catch (_) {}
    }
    _leader = false; R = null;
    if (_ov) { try { _ov.remove(); } catch (_) {} _ov = null; }
  }

  // 开开关即启动（不必刷新页面）；关开关即停
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch.watch_probe_on) return;
      if (ch.watch_probe_on.newValue) _start(); else _stop();
    });
  } catch (_) {}
  try { chrome.storage.local.get('watch_probe_on', (d) => { if (d && d.watch_probe_on) _start(); }); } catch (_) {}
})();
