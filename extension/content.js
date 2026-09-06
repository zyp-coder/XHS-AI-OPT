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
  // 实际停留 = 设定值 + 随机上浮最多 50%（更像真人）；带技术下限的项用 floor 兜底防功能失效
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
    // 支持两种存法：旧 {key: 数值} 或新 {key: {min,max}}（区间随机、更防爬）。
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

  // ===== 全局操作锁：防止上一条评论没发完，第二条就开始定位/输入，导致“评论自己”/错位 =====
  let _operationLock = false;      // 当前是否有操作正在进行
  let _operationLockTime = 0;      // 上锁时间戳（用于死锁自愈）

  // ===== 防重复闸：记录上一条“成功发送”的目标，若下一条打开的回复框还是上一条那个目标
  //       （说明定位卡在上一条没挪动），而本次想发的是另一个人，就直接放弃，绝不重复发 =====
  let _lastSentTarget = null;      // { atName, author, textKey }（均为归一化后的字符串）

  // ===== 会话级防重复：记录本次会话已成功发送过的“评论指纹”（作者链接+正文前若干字）。
  //       只要定位又开到同一条评论（不管昵称读不读得到），就放弃，彻底杜绝重复评论 =====
  const _sessionSentSigs = new Set();

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

  // ===== ✍️ 发笔记：在发布页自动填标题/正文/标签/知识库图片 =====
  const PENDING_NOTE_KEY = 'pending_note_publish';
  function _npTip(text, isErr) {
    try {
      let tip = document.getElementById('xhs-np-tip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'xhs-np-tip';
        tip.style.cssText = 'position:fixed;z-index:2147483646;left:16px;right:16px;bottom:16px;max-width:440px;margin:0 auto;padding:10px 14px;border-radius:10px;font:600 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.16);text-align:center;transition:opacity .3s;';
        document.documentElement.appendChild(tip);
      }
      tip.style.color = isErr ? '#d32f2f' : '#1f1f1f';
      tip.style.border = isErr ? '1px solid #fcd4d4' : '1px solid #e7e7e7';
      tip.textContent = text;
      clearTimeout(tip._t);
      if (text) tip._t = setTimeout(() => { tip.style.opacity = '0'; setTimeout(() => tip.remove(), 350); }, 4200);
    } catch (_) {}
  }
  function _npWait(fn, timeoutMs, intervalMs) {
    timeoutMs = timeoutMs || 6000; const int = intervalMs || 300; const t0 = Date.now();
    return new Promise((resolve) => {
      (function loop() {
        let v = null; try { v = fn(); } catch (_) {}
        if (v) return resolve(v);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(loop, int);
      })();
    });
  }
  function _npClick(el) {
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
  function _npType(el, text) {
    if (!el) return;
    el.focus();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = '';
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  async function _npEnter(el) {
    if (!el) return;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    await sleep(400);
  }
  async function _npUploadImage(dataUrl) {
    if (!dataUrl) return;
    try {
      const input = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
      if (!input) { _npTip('⚠️ 未找到图片上传框（发布页可能未加载图片区域）', true); return; }
      const blob = await (await fetch(dataUrl)).blob();
      const ext = (blob.type || 'image/png').split('/')[1] || 'png';
      const file = new File([blob], 'note_image.' + ext, { type: blob.type || 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(3500);
    } catch (e) { _npTip('⚠️ 图片上传失败：' + (e && e.message || e), true); }
  }
  function _npTopPublishBtn() {
    for (const el of document.querySelectorAll('button, [role="button"], a, span, div')) {
      if (el.offsetParent === null) continue;
      if ((el.textContent || '').trim() === '发布' && el.querySelector && !el.querySelector('button')) return el;
    }
    return null;
  }
  function _npSubmitBtn() {
    const cands = [];
    for (const el of document.querySelectorAll('button')) {
      if (el.offsetParent === null) continue;
      if ((el.textContent || '').trim() === '发布') cands.push(el);
    }
    return cands.length ? cands[cands.length - 1] : null;
  }
  async function fillNotePublish() {
    let st = {};
    try { st = await chrome.storage.local.get(PENDING_NOTE_KEY); } catch (_) {}
    const pending = st && st[PENDING_NOTE_KEY];
    if (!pending) return { success: false, error: '没有待发布的内容（请先在插件「发笔记」页选择一篇）' };
    const pn = location.pathname;
    if (pn.indexOf('/explore') !== 0 && pn.indexOf('/discovery') !== 0 && pn !== '/') {
      return { success: false, error: '当前不是小红书信息流页，已取消自动填入' };
    }
    try {
      _npTip('✍️ 开始填写：「' + (pending.title || '').slice(0, 18) + '」');
      const top = await _npWait(() => _npTopPublishBtn(), 8000);
      if (!top) return { success: false, error: '找不到「发布」入口，请在信息流页重试' };
      _npClick(top);
      await sleep(2500);
      const titleEl = await _npWait(() => document.querySelector('[class*="title"] input, [placeholder*="标题"], textarea[placeholder*="标题"], input[placeholder="标题"]'), 9000);
      if (titleEl) { _npType(titleEl, pending.title || ''); await sleep(300); }
      else return { success: false, error: '发布编辑器未打开（标题输入框未找到）' };
      const contentEl = document.querySelector('[class*="content"] [contenteditable="true"], [placeholder*="正文"], [contenteditable="true"]');
      if (contentEl) { _npType(contentEl, pending.content || ''); await sleep(300); }
      if (Array.isArray(pending.tags) && pending.tags.length) {
        for (const tag of pending.tags) {
          const ti = document.querySelector('[placeholder*="话题"], input[placeholder*="#"]');
          if (!ti) break;
          _npType(ti, tag); await _npEnter(ti);
        }
      }
      await _npUploadImage(pending.image);
      const submit = await _npWait(() => _npSubmitBtn(), 7000);
      if (!submit) {
        _npTip('✅ 内容已自动填入，请在新页面右下角点「发布」提交', false);
        try { await chrome.storage.local.remove(PENDING_NOTE_KEY); } catch (_) {}
        return { success: true, needManual: true };
      }
      _npClick(submit);
      await sleep(2000);
      try { await chrome.storage.local.remove(PENDING_NOTE_KEY); } catch (_) {}
      _npTip('✅ 已点击发布！请在小红书页面确认', false);
      return { success: true, published: true };
    } catch (e) {
      _npTip('❌ 发布失败：' + (e && e.message || e), true);
      return { success: false, error: (e && e.message) || String(e) };
    }
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
        // 方向随机的小幅滚动（偶尔反向一下更像真人，也避免一直往一个方向滚到底）
        const dir = Math.random() < 0.25 ? -1 : 1;
        scrollNoteBy(dir * (100 + Math.floor(Math.random() * 150)));
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return; // 不占用操作锁（sendReply/like 等锁内任务不受影响）
    }
    if (request.action === 'sendReply') {
      runExclusive('sendReply', () => sendReplyToComment(request.author, request.originalText, request.replyText, request.commentIdx, request.userLink, request.images, request.humanize))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
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
    // ── ✍️ 发笔记：自动填发布页并发布 ──
    if (request.action === 'fillNotePublish') {
      runExclusive('fillNotePublish', () => fillNotePublish())
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
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
      runExclusive('collectLikers', () => collectLikers())
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客·消息台：读取消息中心(/chat)会话列表 ──
    if (request.action === 'collectChatConversations') {
      runExclusive('collectChatConversations', () => collectChatConversations())
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
    // ── 评论跟进：通知页回复指定通知（三重定位保障，见 replyNotification 实现） ──
    if (request.action === 'replyNotification') {
      runExclusive('replyNotification', () => replyNotification(request))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客清单：私信（打开用户主页 → 点私信 → 发送） ──
    if (request.action === 'sendUserDm') {
      runExclusive('sendUserDm', () => sendUserDm(request.userLink, request.text))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
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
      runExclusive('sendDmOnProfile', () => sendDmOnProfile(request.userLink, request.text))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    // ── 获客清单：现场定位私信按钮并高亮，告知用户找到了哪个按钮 ──
    if (request.action === 'locateDmButton') {
      try { sendResponse(locateDmButton()); } catch (e) { sendResponse({ found: false, error: e.message }); }
      return true;
    }
    // ── 获客清单：在已打开的聊天窗口输入并发送（不导航、不要求主页） ──
    if (request.action === 'sendDmToOpenChat') {
      runExclusive('sendDmToOpenChat', () => sendDmToOpenChat(request.userLink, request.text))
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
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
        const CAP = 40;
        for (let _n = 0; _n < NODES.length && clicked < CAP; _n++) {
          const b = NODES[_n];
          if (b.offsetParent === null) continue;
          if (b.children.length > 8) continue;   // 大型容器直接跳过，省掉昂贵的 textContent 读取
          let t = '';
          try { t = b.textContent.trim(); } catch (_) { continue; }
          if (t.length >= 2 && t.length <= 14 && /展开|查看更多|更多回复|条回复|展开更多/.test(t) && !/收起/.test(t)) {
            try { b.click(); } catch (_) {}
            clicked++;
            await sleep(200);
          }
        }
      } catch (_) {}
      // 2. ★【方案B：平滑滚动三屏】不再“瞬移到底”，改为每次平滑下滚约一屏高度，连滚 rounds 次，更像真人、DOM 更安静
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

    return { author: authorName || '用户', content, replyTo, userLink };
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
        // 直接找该位置实际渲染的最深层元素，绕过 offsetParent/DOM 层级问题
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

  /* ── 模拟人类浏览行为：随机滚动到评论区元素（停留时长由 delay_config.browseDwell 控制，0=整段跳过） ── */
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
        // 停顿模拟阅读（时长可在设置页「停留时间」配置）
        await sleepWithCountdown(dwellMs('browseDwell'), `👀 模拟真人浏览阅读（第 ${i + 1} 段）`);
      }
      return;
    }
    // ★ 方案二：无评论 → 滚动笔记弹层内部容器（而非背景页面）
    scrollNoteBy((Math.random() - 0.5) * 400);
    await sleepWithCountdown(dwellMs('browseDwell'), '👀 模拟真人浏览');
  }

  // ============================
  // 发送回复
  // ============================
  async function sendReplyToComment(author, originalText, replyText, commentIdx, userLink, images, humanize) {
    // humanize=true （自动批量发送）：模仿真人——先滞留浏览、逐字打字，骗反爬。
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
    // ⚠️ 不能用 Esc（会关掉笔记弹层），改用 blur 失焦 + 滚动收起 + 点笔记标题 + closeBtn 三级降级
    try {
      _showStatus('关闭已有回复框...');
      const oldInput = findBottomReplyInput();
      if (oldInput && oldInput.offsetParent !== null) {
        try { oldInput.blur(); } catch (_) {}
        scrollNoteBy(-120);
        await sleep(400);
        // 降级1：滚动没收起 → 点击笔记标题，用小红书自己的“点击他处收起回复框”机制关闭
        const stillOpen = findBottomReplyInput();
        if (stillOpen && stillOpen.offsetParent !== null && _clickNoteTitle()) {
          console.log('[发送回复] 滚动未收起残留回复框，已点击笔记标题触发收起');
          await sleep(400);
        }
        // 降级2：还在 → 找面板里的关闭按钮
        const stillOpen2 = findBottomReplyInput();
        if (stillOpen2 && stillOpen2.offsetParent !== null) {
          const panel = stillOpen2.closest('[class*="reply" i], [class*="footer" i], [class*="bottom" i]');
          if (panel) {
            const closeBtn = panel.querySelector('button, [class*="close" i], [class*="cancel" i], [class*="del" i]');
            if (closeBtn) closeBtn.click();
          }
        }
        await sleep(300);
      }
    } catch (_) {}

    // ===== 0.（已按用户要求移除）自动批量时不再“模拟真人浏览阅读”＝点赞之后到发评论之间的等待已去掉，
    //     防爬节奏改由“条间随机 3~8 秒间隔”承担（见 popup 批量发送与 auto-bot），不再逐条磨蹭 =====

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
    _showStatus('正在输入回复内容...');
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
    const totalLen = replyText.length;
    const typingCfg = Math.max(0, Number(_delayCfg.typingCharDelay) || 0);

    if (fast || typingCfg <= 0) {
      // ★ 快速通道（手动一键发送）：一次性填入全部文本，不逐字磨蹭
      if (isEditable) {
        document.execCommand('insertText', false, replyText);
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replyText }));
      } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          inputEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeSetter.call(inputEl, replyText);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        inputEl.textContent = replyText;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await sleep(50);
    } else {
      // ★ 模仿真人通道（自动批量发送）：逐字输入 + 随机停顿，骗反爬；节奏均基于 typingCfg
      const perCharMs = typingCfg;

      for (let i = 0; i < totalLen; i++) {
        const char = replyText[i];

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

    // ===== 6. 发送（面板搜索+多事件类型点击）=====
    _showStatus('发送回复...');
    await sleep(dwellMs('preSendGap', 400)); // 拟人挡位：点「发送」前先停留，避免打开即秒发被判机器

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
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      await sleep(20);
      el.click();                                   // trusted event
      el.dispatchEvent(new MouseEvent('click', opts));
    }

    let sentOk = false;
    let sentVia = '';

    // ★ 发送成功三重信号（任一命中即认为已提交，立刻停手，不再补点/补回车）：
    //   ① 回复框从 DOM 消失（发送后面板收起）
    //   ② 页面上已出现本次回复文本（评论已渲染）
    //   ③ 回复框还在但内容已被清空（小红书有时发送成功只清空、不销毁节点）
    //   —— 这是“一条回复发出多条”的主因修复：原来只认①，实际已发出却判失败 → 继续点按钮/按 Enter → 重复提交
    const _echoOnPage = () => {
      const probe = (replyText || '').slice(0, 40);
      if (!probe) return false;
      const inputAlive = document.contains(inputEl);
      return Array.from(document.querySelectorAll('div, span, p')).some(el => {
        // 排除回复框自身及其容器：输入框里还没发出去的文字不算“已渲染的评论”
        if (inputAlive && (el.contains(inputEl) || inputEl.contains(el))) return false;
        const t = el.textContent.trim();
        return t.includes(probe) && t.length < replyText.length + 80;
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
    // 每次“补刀”前后都先自查：已经发出去了就绝不再点第二次
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

    // 验证：轮询最多 2s，等回复内容渲染到页面上（比固定死等更少误报"未验证"）
    let verified = false;
    {
      const VERIFY_TIMEOUT = 2000, VERIFY_STEP = 250;
      const t0 = Date.now();
      while (Date.now() - t0 < VERIFY_TIMEOUT) {
        if (_echoOnPage()) { verified = true; break; }
        _showStatus('确认回复是否已出现…');
        await sleep(VERIFY_STEP);
      }
      if (!verified) verified = _echoOnPage();
      // 验证期间发现成功信号也补记 sentOk（供指纹入库防重复）
      if (verified && !sentOk) { sentOk = true; sentVia = 'echoOnPage'; }
    }
  
    // ★★★ 发送完毕最后一步：强制点击笔记标题关闭回复框 ★★★
    // 这是"一键发送"的最终收尾动作，必须在释放锁之前完成：
    //   1. 确保残留回复框彻底关闭（防止下一条发到上一条的回复框里）
    //   2. 只有点击标题成功后才算"发送完成"，才释放操作锁
    //   3. 释放锁之后系统/用户才能进行下一个操作
    _showStatus('收尾：关闭回复框...');
    try { 
      const curInput = findBottomReplyInput();
      if (curInput && curInput.offsetParent !== null) {
        try { curInput.blur(); } catch (_) {}
      }
    } catch (_) {}
    // 无论回复框是否可见都点标题——确保小红书内部状态也归位
    _clickNoteTitle();
    await sleep(500);
    // 二次确认：如果还没关掉，再点一次
    const _finalInput = findBottomReplyInput();
    if (_finalInput && _finalInput.offsetParent !== null) {
      console.log('[发送回复] 首次点标题未关闭回复框，再点一次');
      _clickNoteTitle();
      await sleep(400);
    }
    console.log('[发送回复] ✅ 收尾完成，回复框已关闭，准备释放锁');
  
    _hideStatus();
    // ★ 记录本次成功发送的目标，供下一条防重复闸比对（回复框 @ 名优先，否则用目标作者）
    _lastSentTarget = {
      atName: _normName(check.atName || author || ''),
      author: _normName(author || ''),
      textKey: _normName((originalText || '').slice(0, 30)),
    };
    // ★ 把本次实际定位到的评论指纹记入会话集合，同一条评论不会再发第二次。
    // 仅当确实发出去（verified 或 sentOk）才入库，避免"没发成却入库 → 下次补发反被拦"
    if (locatedSig && (verified || sentOk)) _sessionSentSigs.add(locatedSig);
    return { success: true, verified, method: verified ? 'confirmed' : (sentOk ? (sentVia || 'sendButton') : 'enterKey') };
  }

  /* ── 定位回复：仅定位+点击回复，不打字不发送，供手动操作 ── */
  async function locateAndOpenReply(author, originalText, commentIdx, userLink) {
    // ★ 先模拟人类浏览滑动
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
   */
  function _getNotificationContainers() {
    return Array.from(document.querySelectorAll('div.container'))
      .filter(el => el.querySelector('.interaction-hint') || el.querySelector('.user-avatar'));
  }

  /* ── 评论跟进：从通知项提取 user_id（用户主页链接里的稳定 ID） ── */
  function _extractNotificationUserId(container) {
    const link = container.querySelector('a[href*="/user/profile/"]');
    if (!link) return '';
    const m = (link.getAttribute('href') || '').match(/\/user\/profile\/([0-9a-f]+)/i);
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
        await sleep(1500);
        const count = _getNotificationContainers().length;
        if (count === prevCount) break; // 滚动后数量没变 → 已加载到底
        prevCount = count;
      }
      window.scrollTo(0, 0); // 回到顶部，保持页面状态干净
      await sleep(300);
    } catch (_) {}

    const containers = _getNotificationContainers();
    const items = [];
    containers.forEach((container, idx) => {
      // user_id（稳定标识，组装会话按它分组）
      const userId = _extractNotificationUserId(container);
      // 昵称（多级回退：新版页面昵称可能不在头像链接里）
      const userLink = container.querySelector('a[href*="/user/profile/"]');
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

  // ── 获客：收集"赞了我们内容/评论"的人。点赞的人意愿低但能直接发销售资料；
  //    每个点赞通知记录它赞的是我们的哪条评论（quote-info 即我们写的那条）。
  async function collectLikers() {
    if (_getNotificationContainers().length === 0) {
      return { success: false, error: '通知页无通知项，请先打开设置→评论跟进→通知页 (xiaohongshu.com/notification)' };
    }
    // 滚动加载更多
    _showStatus('加载通知...');
    try {
      const scroller = document.scrollingElement || document.documentElement;
      let prevCount = -1;
      for (let round = 0; round < 6; round++) {
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(1200);
        const c = _getNotificationContainers().length;
        if (c === prevCount) break;
        prevCount = c;
      }
      window.scrollTo(0, 0);
      await sleep(200);
    } catch (_) {}
    const seen = new Set();
    const likers = [];
    for (const container of _getNotificationContainers()) {
      const userId = _extractNotificationUserId(container);
      if (!userId || seen.has(userId)) continue;
      const txt = (container.textContent || '');
      // ★ 商机信号分类（获客清单收录）：点赞/收藏我们的内容或评论 → 点赞；回复我们的评论 → 回复；关注我们 → 关注
      let signalType = '';
      if (/(关注了你|关注了你的)/.test(txt)) signalType = '关注';
      else if (/(回复了你的|回复你的评论|评论了你的|评论你的)/.test(txt)) signalType = '回复';
      else if (/(赞了你的|收藏了你的|赞了你的评论|赞了你的笔记|收藏了你的笔记|赞了你的分享|收藏了你的分享|赞了你的)|(赞了|收藏了)/.test(txt)) signalType = '点赞';
      // 兜底：确实有"你的"且有互动词，但难归类 → 归点赞
      if (!signalType && /(你的)/.test(txt)) signalType = '点赞';
      if (!signalType) continue;
      seen.add(userId);
      // 昵称
      const ul = container.querySelector('a[href*="/user/profile/"]');
      const userLink = ul ? ul.getAttribute('href') : '';
      let userName = ul ? ul.textContent.trim() : '';
      if (!userName) {
        const ne = container.querySelector('.user-info .name, .user-info .nickname, .interaction-user, .user-name, .nickname, .name');
        userName = ne ? ne.textContent.trim() : '';
      }
      // 互动对象内容（点赞→我们写的评论/笔记原文；回复→对方回复的话）
      const quote = container.querySelector('.quote-info');
      const likedComment = quote ? quote.textContent.trim() : '';
      const other = container.querySelector('.interaction-content');
      const likedNote = container.querySelector('.note-title, .content, [class*="title"]');
      likers.push({ userId, userName, userLink, signalType, likedComment, likedNote: (likedNote ? likedNote.textContent.trim() : (other ? other.textContent.trim() : '')).slice(0, 60), time: '' });
    }
    _hideStatus();
    return { success: true, items: likers, count: likers.length, url: window.location.href };
  }

  // ── 获客·消息台：读取消息中心(/chat)的会话列表 ──
  // 每组 `div.xhs-im-conv-item` 提供 data-conv-id（会话id）与伙伴昵称/最近消息/时间。
  // 注意：列表不直接给 partner 的 userId；匹配获客清单靠 convId 或昵称。
  async function collectChatConversations() {
    if (!/\/chat/.test(location.href)) return { success: false, error: '不在消息中心(/chat)，请先打开 https://www.xiaohongshu.com/chat' };
    const _vis = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (_) { return false; } };
    const items = [];
    const seen = new Set();
    document.querySelectorAll('div.xhs-im-conv-item').forEach((el) => {
      if (!_vis(el)) return;
      const convId = el.getAttribute('data-conv-id') || '';
      const kind = el.getAttribute('data-conv-kind') || '';
      if (!convId || seen.has(convId)) return;
      seen.add(convId);
      const name = (el.querySelector('.xhs-im-conv-item__name') || { textContent: '' }).textContent.trim();
      const time = (el.querySelector('.xhs-im-conv-item__time') || { textContent: '' }).textContent.trim();
      const summary = (el.querySelector('.xhs-im-conv-item__summary-text, .xhs-im-conv-item__summary') || { textContent: '' }).textContent.trim();
      const img = el.querySelector('img.xhs-im-conv-item__avatar');
      const avatar = img ? (img.getAttribute('src') || '') : '';
      items.push({ convId, convKind: kind, partnerName: name, time, lastMsg: summary.slice(0, 80), avatar, hasUnread: false });
    });
    return { success: true, items, count: items.length, url: location.href };
  }

  // ── 获客·消息台：在 /chat 会话页发送消息（复用私信的 native setter + 发送按钮/回车 + 限制检测机制）
  async function chatSendMessage(text) {
    if (!/\/chat/.test(location.href)) return { success: false, error: '不在 /chat 会话页，请先打开会话' };
    const raw = String(text || '').trim();
    if (!raw) return { success: false, error: '内容为空' };
    const msg = raw.length > 300 ? raw.slice(0, 300) : raw;

    // 定位输入框（/chat 的编辑器 contenteditable 或通用）
    let inputEl = null;
    for (let i = 0; i < 12; i++) {
      inputEl = _findVisible(document.querySelector('.xhs-im-input-bar-editor[contenteditable="true"], .xhs-im-input-bar-editor, [contenteditable="true"]'));
      if (inputEl) break;
      await sleep(500);
    }
    if (!inputEl) return { success: false, error: '未找到 /chat 输入框（可能会话没打开）' };

    _showStatus('输入消息...');
    inputEl.focus();
    await sleep(120);
    // native setter + input 事件触发 React onChange
    let setter = null;
    try { setter = Object.getOwnPropertyDescriptor(window.HTMLDivElement.prototype, 'innerText').set || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; } catch (_) {}
    if (setter) setter.call(inputEl, msg);
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: msg }));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    await sleep(dwellMs('preSendGap', 400));

    _showStatus('发送消息...');
    // 发送按钮优先（在输入栏附近找），Enter 兜底
    const scope = document.querySelector('.xhs-im-input-bar') || document;
    let sendBtn = null;
    for (const el of scope.querySelectorAll('button,[role="button"],[type="submit"],svg')) {
      if (!_findVisible(el)) continue;
      const t = (el.innerText || '').trim();
      const aria = (el.getAttribute('aria-label') || '');
      const c = String(el.className || '');
      const title = el.tagName === 'svg' ? ((el.querySelector('title') || { textContent: '' }).textContent || '') : '';
      if (t === '发送' || aria.includes('发送') || /send|发送/i.test(c) || /send|发送/i.test(title)) { sendBtn = el; break; }
    }
    let sentOk = false, via = '';
    if (sendBtn) { _click(sendBtn); await sleep(700); sentOk = true; via = 'button'; }
    else {
      for (let a = 0; a < 3; a++) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        await sleep(600); sentOk = true; via = 'enter'; break;
      }
    }

    const limitRe = /(关注后才能|关注后即可|无法发送|不能发送|私信限制|被限制|防骚扰|对方.*关注|暂不支持)/;
    const limited = limitRe.test((document.body.innerText || '').slice(-800));
    _hideStatus();
    if (limited) return { success: false, error: '检测到发送限制提示（可能对方未关注你/防骚扰），建议先评论互动破冰', limited: true };
    return { success: sentOk, via, error: sentOk ? '' : '发送未确认，请手动检查该会话' };
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
    await sleep(400);
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
      return { success: false, error: '回复输入框未出现（可能被风控或页面异常），请手动重试' };
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

    // ===== 6. 填值（native setter + input 事件，触发 React onChange） =====
    _showStatus('输入回复内容...');
    inputEl.focus();
    await sleep(100);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(inputEl, replyText);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);

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

    // 5) 发送（发送按钮优先，Enter 兜底）
    _showStatus('发送私信...');
    let sendBtn = null;
    const allSends = document.querySelectorAll('button, [role="button"]');
    for (const el of allSends) {
      if (!_findVisible(el)) continue;
      const t = (el.innerText || '').trim();
      const aria = (el.getAttribute('aria-label') || '');
      const c = String(el.className || '');
      if (t === '发送' || aria.includes('发送') || /send/i.test(c)) { sendBtn = el; break; }
    }
    let sentOk = false;
    if (sendBtn) {
      _click(sendBtn);
      await sleep(700);
      sentOk = true;
    } else {
      for (let a = 0; a < 3; a++) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        await sleep(600);
        sentOk = true;
        break;
      }
    }

    // 6) 检测限制提示
    const limitRe = /(关注后才能|关注后即可|无法发送|不能发送|私信限制|被限制|防骚扰|对方.*关注|暂不支持)/;
    const bodyText = (document.body.innerText || '');
    const limited = limitRe.test(bodyText.slice(-800));

    _hideStatus();
    if (limited) {
      return { success: false, error: '检测到私信限制提示（对方可能未关注你或开启防骚扰），建议改为评论互动破冰。', limited: true };
    }
    return { success: sentOk, error: sentOk ? '' : '发送未确认，请手动检查', verified: sentOk };
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
    // 发送（按钮优先，Enter 兜底）
    _showStatus('发送私信...');
    let sendBtn = null;
    const allSends = document.querySelectorAll('button, [role="button"]');
    for (const el of allSends) {
      if (!_findVisible(el)) continue;
      const t = (el.innerText || '').trim();
      const aria = (el.getAttribute('aria-label') || '');
      const c = String(el.className || '');
      if (t === '发送' || aria.includes('发送') || /send/i.test(c)) { sendBtn = el; break; }
    }
    let sentOk = false;
    if (sendBtn) { _click(sendBtn); await sleep(700); sentOk = true; }
    else {
      for (let a = 0; a < 3; a++) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        await sleep(600);
        sentOk = true; break;
      }
    }
    _hideStatus();
    return { success: sentOk, error: sentOk ? '' : '发送未确认，请手动检查', verified: sentOk };
  }

  // ── 在用户主页抓取公开「小红书号」+ 主页昵称（抓不到静默返回 {}，绝不报错/不加重反爬） ──
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

  /** 账号诊断：抓取本人「我的」主页完整资料（只读）。返回 { xhsId, name, desc, avatar, fans, follows, likes, notes } */
  function extractProfileFull(maxNotes) {
    maxNotes = maxNotes || 12;
    const t = (el) => (el ? String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '');
    const p = { xhsId: '', name: '', desc: '', avatar: '', fans: '', follows: '', likes: '', profile_url: '', notes: [] };
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
    p.profile_url = location.href.split('?')[0];
    return p;
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
