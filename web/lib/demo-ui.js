/* ============================================================
 * 演示号工作台标记（2026-10-18）——只在公网 web 那份 popup.html 里加载
 * ------------------------------------------------------------
 * 固定的 7 个公用演示号共用真实工作台：
 *   1) 顶栏右侧换成「🎭 演示号 · 某档｜退出演示」——点了退出登录、回账号页；
 *   2) 顶栏下面挂一条只读提示：人设 / 卖点 / 知识库 / 规划 / 问卷这些底子只读；
 *   3) 底子页面（诊断&配置、发布台→笔记规划）里，新增 / 编辑 / 删除 / 生成 / 导入
 *      这类入口当场拦下并提示「演示号只读，注册自己的号后可改」；
 *      查看 / 搜索 / 筛选 / 复制 / 导出 / 备份 / 刷新 照常可用。
 *   4) 获客·工作台那一屏本来要真扫小红书才有线上数据，演示号扫不到——
 *      这里按账本里的 demo_bench（服务器每天铺的示例评论 + 示例顾客 + 三版话术）
 *      照真实标记画出来，页顶挂一行「给顾客看效果用的」提示。
 * 服务器侧还有同样一套动作与存储拦截兜底（见 server/dev-server.mjs）。
 * ============================================================ */
(() => {
  'use strict';
  const RO_MSG = '演示号只读，注册自己的号后可改';
  const FOUNDATION = '#diagnoseContent, #nqPanePlan';
  /* 获客 / AI客服里会写账本或碰平台的动作：演示号一律不跑，换成「开自己的号」引导。
     纯 AI 草拟（generateDm / optimizeDm / chatFollowReply / aiCsTouch）与所有读取动作照常放行。 */
  const REAL_ACTIONS = new Set([
    'drainSaveScanCfg', 'drainSaveReplenishCfg', 'drainScan', 'drainReplenish', 'drainImportFound',
    'drainTrackNote', 'dailyAutoKick', 'sendNoteComment', 'aiGenerateDrainVariants',
    'saveAiCsConfig', 'importAiCsConfig', 'setAutoScanChat', 'setMsgWatch',
    'updateProspect', 'deleteProspect', 'addProspect', 'judgeLeadPromotion',
    'syncChatInbound', 'scanChatReply', 'chatFollowSync', 'chatFollowMarkSent',
    'collectLikersFromNotif', 'enrichProspectByProfile', 'profileProspects',
    'extractNotifications', 'getPendingNotifs', 'findProspects', 'followUser',
    'loadMoreComments', 'locateReply', 'replyNotification', 'sendNotifReply',
    'sendDm', 'sendDmBatch', 'sendReply', 'openChat',
  ]);
  /* 只读页里仍然放行的搜索 / 筛选输入 */
  const OK_INPUT_IDS = new Set(['diagKSearch', 'diagKFilterCat', 'diagKFilterStatus']);
  /* 只读页里仍然放行的按钮：看 / 搜 / 复制 / 导出 / 收起这类不动数据的事 */
  const OK_BTN_WORDS = ['查看', '预览', '复制', '导出', '备份', '刷新', '搜索', '筛选',
    '关闭', '取消', '返回', '收起', '展开', '上一页', '下一页', '下载', '放大', '缩小'];

  function say(msg) {
    try {
      if (typeof window.toast === 'function') { window.toast(msg, 'error'); return; }
    } catch (_) {}
    try { console.warn('[demo]', msg); } catch (_) {}
  }

  /* ── 点了要动真数据 / 真跑的动作：不弹红字，给两条真出路 ── */
  function showCta() {
    if (document.getElementById('demoCtaMask')) return;
    const mask = document.createElement('div');
    mask.id = 'demoCtaMask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(17,24,39,.38);display:flex;align-items:center;justify-content:center;padding:18px;';
    mask.innerHTML = ''
      + '<div style="width:min(480px,94vw);background:#fff;border:1px solid #eadfc4;border-radius:16px;padding:22px 24px;box-shadow:0 18px 48px rgba(0,0,0,.22);font-family:inherit;">'
      + '  <div style="font-size:16px;font-weight:800;color:#1f2937;">这一下要动真数据了</div>'
      + '  <div style="margin-top:9px;font-size:13px;line-height:1.85;color:#4b5563;">演示号里扫到的评论、私信来的顾客都是<b>示例数据</b>，只读——不会替你评论、私信、发笔记，也改不了状态。开自己的号、装上执行器，就能换成你自己的顾客和聊天记录。</div>'
      + '  <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px;">'
      + '    <button type="button" id="demoCtaLater" style="height:32px;padding:0 13px;border:1px solid #d7dbe0;border-radius:9px;background:#fff;color:#4b5563;font-size:12.5px;font-weight:700;cursor:pointer;">先随便看看</button>'
      + '    <a href="func-demo.html" target="_blank" rel="noopener" style="height:32px;padding:0 13px;display:inline-flex;align-items:center;border:1px solid #d7dbe0;border-radius:9px;background:#fff;color:#374151;font-size:12.5px;font-weight:700;text-decoration:none;">🎬 功能演示</a>'
      + '    <a href="executor.html" target="_blank" rel="noopener" style="height:32px;padding:0 13px;display:inline-flex;align-items:center;border:1px solid #d7dbe0;border-radius:9px;background:#fff;color:#374151;font-size:12.5px;font-weight:700;text-decoration:none;">🖐 执行器能干什么</a>'
      + '    <a href="account.html" style="height:32px;padding:0 14px;display:inline-flex;align-items:center;border-radius:9px;background:#b45309;color:#fff;font-size:12.5px;font-weight:800;text-decoration:none;">开自己的号 →</a>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(mask);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      try { mask.remove(); } catch (_) {}
    };
    document.addEventListener('keydown', onKey, true);
    mask.addEventListener('click', (e) => {
      if (e.target === mask || (e.target && e.target.id === 'demoCtaLater')) close();
    });
  }

  /* 拦截「真动作」：本地直接回只读，弹开号引导；服务器侧仍有一道同样的闸 */
  function installActionGuard() {
    const rt = window.chrome && window.chrome.runtime;
    if (!rt || typeof rt.sendMessage !== 'function' || rt.__xhsDemoGuard) return;
    const orig = rt.sendMessage;
    const onRes = (r) => { if (r && r.demo === 'readonly-foundation') showCta(); };
    rt.sendMessage = function (msg, cb) {
      const action = msg && msg.action;
      if (action && REAL_ACTIONS.has(action)) {
        showCta();
        const res = { ok: false, error: RO_MSG, demo: 'readonly-foundation' };
        if (typeof cb === 'function') { setTimeout(() => cb(res), 0); return undefined; }
        return Promise.resolve(res);
      }
      const ret = orig.call(rt, msg);
      const p = (ret && typeof ret.then === 'function') ? ret : Promise.resolve(ret);
      if (typeof cb === 'function') { p.then((r) => { onRes(r); cb(r); }); return undefined; }
      return p.then((r) => { onRes(r); return r; });
    };
    rt.__xhsDemoGuard = true;
    /* 有些按钮先在本机找页面 / 开标签，走不到 sendMessage——按固定 id 和文案在点击这一层拦住 */
    const REAL_BTN_IDS = new Set([
      'chatqStart', 'chatqSync', 'plNotifRefresh',
      'botToggleBtn', 'qAddDailyBtn', 'btnSearch', 'refreshBtn',
    ]);
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const btn = t.closest('button, a');
      if (!btn) return;
      const txt = String(btn.textContent || '').trim();
      if (REAL_BTN_IDS.has(btn.id) || txt === '💬 联系TA' || txt === '联系TA') {
        e.preventDefault();
        try { e.stopImmediatePropagation(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}
        showCta();
      }
    }, true);
    /* 队列「🤖 开始 / ⏹ 停止」走的是执行器下单口，不经 sendMessage——这一口也拦住 */
    if (typeof window.fetch === 'function' && !window.__xhsDemoFetchGuard) {
      window.__xhsDemoFetchGuard = true;
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : String((input && input.url) || '');
        if (/api\/exec\/(order|stop)(\?|$)/.test(url)) {
          showCta();
          return Promise.resolve({
            ok: false,
            json: async () => ({ ok: false, error: RO_MSG, demo: 'readonly-foundation' }),
          });
        }
        return origFetch.apply(this, arguments);
      };
    }
  }

  function inFoundation(el) {
    try { return !!(el && el.closest && el.closest(FOUNDATION)); } catch (_) { return false; }
  }

  function block(e) {
    e.preventDefault();
    try { e.stopImmediatePropagation(); } catch (_) {}
    try { if (e.stopPropagation) e.stopPropagation(); } catch (_) {}
    say(RO_MSG);
  }

  function allowedControl(el) {
    if (!el) return true;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (OK_INPUT_IDS.has(el.id)) return true;
      return tag === 'INPUT' && String(el.type || '').toLowerCase() === 'search';
    }
    if (tag === 'SUMMARY') return true;                        // 展开看详情
    if (el.closest('#diagPersonaTabs')) return true;           // 人设 / 说话风格 两个签只是换着看
    if (el.classList && (el.classList.contains('dg-tab') || el.classList.contains('nt-tab')
      || el.classList.contains('npar-filter'))) return true;   // 规划页那排线条／比例小签：只换着看
    const txt = String(el.textContent || '').trim();
    return OK_BTN_WORDS.some((w) => txt.indexOf(w) >= 0);
  }

  /* ── 拦截：点 / 键盘聚焦 / 变更，三道都堵在底子页面上 ── */
  function installGuards() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#tenantSwitcher') || t.closest('.hdr-tenant')) return block(e);
      if (t.closest('.audit-plan-push')) return block(e);
      if (!inFoundation(t)) return;
      const el = t.closest('button, a, input, select, textarea, label, summary, [role="button"], [contenteditable="true"]');
      if (!el) return;                                        // 点表格 / 正文只是看
      if (allowedControl(el)) return;
      block(e);
    }, true);

    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!inFoundation(el) || !el || !el.matches) return;
      if (!el.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (allowedControl(el)) return;
      try { el.blur(); } catch (_) {}
      say(RO_MSG);
    }, true);

    document.addEventListener('keydown', (e) => {
      const el = e.target;
      if (!inFoundation(el) || !el || !el.matches) return;
      if (!el.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (allowedControl(el)) return;
      e.preventDefault();
    }, true);

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!inFoundation(el) || !el) return;
      if (allowedControl(el)) return;
      e.preventDefault();
      try { e.stopImmediatePropagation(); } catch (_) {}
      say(RO_MSG);
    }, true);

    document.addEventListener('submit', (e) => {
      if (!inFoundation(e.target)) return;
      block(e);
    }, true);
  }

  function paintBadge(acc) {
    const right = document.querySelector('.hdr-right');
    if (!right) return;
    // 演示号不切产品（服务器也拦）——把产品切换收起来，给退出按钮腾位置
    const tenant = right.querySelector('.hdr-tenant');
    if (tenant) tenant.style.display = 'none';
    const old = document.getElementById('demoBadge');
    if (old) old.remove();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'demoBadge';
    btn.className = 'hdr-demo';
    btn.textContent = '🎭 演示号 · ' + (acc.tier || '全功能') + '｜退出演示';
    btn.title = '你正在公用演示号「' + (acc.demoLabel || acc.name || '') + '」里；点一下退出，回账号页换自己的号';
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '正在退出…';
      try {
        await fetch('api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (_) {}
      try { sessionStorage.removeItem('xhs_gate_c'); } catch (_) {}
      location.replace('account.html');
    });
    right.insertBefore(btn, right.firstChild);
  }

  function paintBanner() {
    if (document.getElementById('demoRoBanner')) return;
    const header = document.querySelector('.header');
    if (!header) return;
    const bar = document.createElement('div');
    bar.id = 'demoRoBanner';
    bar.innerHTML = '🎭 <b>这是公用演示号</b>：获客、AI客服里扫到的评论、私信来的顾客都是<b>示例数据</b>，只读；'
      + '人设 / 卖点 / 知识库 / 规划 / 问卷这些底子也只读——看和搜都行。'
      + '写稿、出图、出片照常用，<b>不会真发出去、也不会真评论或私信</b>。'
      + '<span style="display:inline-flex;gap:8px;margin-left:10px;vertical-align:middle;">'
      + '  <a href="func-demo.html" target="_blank" rel="noopener" style="color:#7a5a00;font-weight:700;text-decoration:underline;">🎬 功能演示</a>'
      + '  <a href="executor.html" target="_blank" rel="noopener" style="color:#7a5a00;font-weight:700;text-decoration:underline;">🖐 执行器能干什么</a>'
      + '  <a href="account.html" style="color:#7a5a00;font-weight:800;text-decoration:underline;">开自己的号 →</a>'
      + '</span>';
    header.insertAdjacentElement('afterend', bar);
  }

  /* ── 获客工作台这一屏：演示号进来就铺示例数据（账本 demo_bench，服务器每天重铺、只读）
      照 popup.js 真实渲染那一套的标记画：笔记条 + 统计栏 + 摘要 + 每张卡（版本切换 / 复制能用，
      定位 / 点赞关注 / 一键发送 / 入清单 这类要动真页面的，弹开自己号的引导）。 ── */
  const BENCH_HINT = '🎭 这一屏是<b>示例数据</b>，给顾客看效果用的——演示号不挂执行器，扫不到真评论，也不会替你发出去。';
  const BENCH_DO_BTNS = ['locate-btn', 'interact-btn', 'send-btn', 'addlist-btn'];
  let benchData = null, benchTries = 0, benchLastTry = 0;

  function bx(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function benchCardHtml(p, i) {
    const copies = (Array.isArray(p.suggested_copies) ? p.suggested_copies : [])
      .map((c) => String(c || '').trim()).filter(Boolean);
    const labels = Array.isArray(p.copy_labels) ? p.copy_labels : [];
    const best = (copies.length > 0 && Number.isInteger(p.best_index) && p.best_index >= 0 && p.best_index < copies.length) ? p.best_index : 0;
    const loc = String(p.location || '').trim();
    const sameCity = p.same_city === true;
    const locBadge = sameCity
      ? `<span style="display:inline-block;font-size:10px;background:#e3f2fd;color:#1565c0;font-weight:600;padding:1px 6px;border-radius:3px;margin-left:4px;">🏙 同城${loc ? ' · ' + bx(loc) : ''}</span>`
      : (loc ? `<span style="display:inline-block;font-size:10px;background:#f2f2f2;color:#888;padding:1px 6px;border-radius:3px;margin-left:4px;">${bx(loc)}</span>` : '');
    let tabsHtml = copies.length > 1 ? '<div class="version-tabs" style="display:flex;gap:4px;margin-bottom:6px;">' : '';
    copies.forEach((_, vi) => {
      const label = (vi === best ? '⭐ ' : '') + '版本' + (vi + 1) + (labels[vi] ? ' · ' + bx(labels[vi]) : '');
      tabsHtml += `<button class="version-tab${vi === best ? ' active' : ''}" data-prospect="${i}" data-ver="${vi}">${label}</button>`;
    });
    if (copies.length > 1) tabsHtml += '</div>';
    const raw = copies[best] || '';
    return `
      <div class="prospect-badge">潜在顾客 #${i + 1}${locBadge}<span class="cq-badge" style="display:none;"></span></div>
      <div class="prospect-meta">
        <span class="prospect-author">${bx(p.author || '示例·某位')}</span>
        <span style="font-size:11px;color:#999;">${bx(p.approach || '回复')}</span>
      </div>
      <div class="prospect-quote">“${bx(p.original_comment || '')}”</div>
      <div class="prospect-reason">💡 ${bx(p.interest_reason || '')}</div>
      <div class="prospect-reply-box">
        <div class="prospect-reply-label">✍️ 回复话术（可编辑 · 点击版本切换）</div>
        ${tabsHtml}
        <div class="reply-box">
          <textarea id="demoReply_${i}" rows="5" placeholder="输入回复内容...">${bx(raw)}</textarea>
        </div>
        <div class="reply-actions">
          <button class="copy-btn" data-prospect="${i}">复制</button>
          <button class="locate-btn" data-prospect="${i}">📍 定位</button>
          <button class="interact-btn" data-prospect="${i}">💗 点赞关注</button>
          <button class="send-btn" data-prospect="${i}">📤 一键发送</button>
          <button class="addlist-btn" data-prospect="${i}" style="font-size:11px;padding:3px 8px;border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:4px;cursor:pointer;">➕ 入清单</button>
        </div>
        <div id="demoSendResult_${i}" class="send-result"></div>
      </div>`;
  }

  function paintBench(main, b) {
    /* 真流程渲染前会清空内容区；这里也先把「待机中」那块占位撤掉，
       不然上面写着「未扫描任何笔记」、下面就是评论和话术，看着自相矛盾。 */
    main.querySelectorAll('.empty').forEach((el) => { try { el.remove(); } catch (_) {} });
    const sameCount = (b.prospects || []).filter((p) => p.same_city === true).length;
    const noteId = String(b.noteId || '').slice(0, 8);
    const hint = document.createElement('div');
    hint.id = 'demoBenchHint';
    hint.style.cssText = 'font-size:12px;line-height:1.7;color:#7a5a00;background:#fff8e1;border:1px solid #f2d98c;'
      + 'border-radius:8px;padding:8px 12px;margin-bottom:10px;';
    hint.innerHTML = BENCH_HINT;
    main.appendChild(hint);

    const box = document.createElement('div');
    box.id = 'demoBenchBox';
    const stats = document.createElement('div');
    stats.className = 'scan-stats';
    stats.textContent = `📊 共 ${(b.comments || []).length} 条评论 · 发现 ${b.prospects.length} 个潜在顾客${sameCount ? `（其中 🏙 同城 ${sameCount} 个）` : ''}`;
    box.appendChild(stats);
    if (b.summary) {
      const sm = document.createElement('div');
      sm.className = 'prospect-summary';
      sm.textContent = b.summary;
      box.appendChild(sm);
    }
    b.prospects.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'card prospect-card';
      card.innerHTML = benchCardHtml(p, i);
      box.appendChild(card);
    });
    main.appendChild(box);

    /* 笔记条（这一屏顶部那条黄色的「正在看哪一篇」） */
    const ni = document.getElementById('noteInfo');
    if (ni) {
      ni.style.display = 'block';
      ni.className = 'note-info active';
      ni.innerHTML = `
        <div class="note-title">${bx(b.title || '(无标题)')}</div>
        <div class="note-meta">
          <span>👤 ${bx(b.author || '未知')}</span>
          <span>💬 ${(b.comments || []).length} 条评论</span>
          <span>📡 ${bx(b.sourceLabel || '关键词命中')}</span>
          ${noteId ? `<span style="font-size:10px;color:#bbb;font-family:monospace;">#${noteId}</span>` : ''}
        </div>`;
    }
    try {
      if (typeof window.setStatus === 'function') window.setStatus(`🎯 发现 ${b.prospects.length} 个潜在顾客`, 'success');
    } catch (_) {}

    box.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!t || !box.contains(t)) return;
      if (t.classList.contains('version-tab')) {
        const i = t.dataset.prospect;
        const b2 = Number(t.dataset.ver);
        const copies = ((b.prospects[i] || {}).suggested_copies || []).map((c) => String(c || '').trim()).filter(Boolean);
        box.querySelectorAll(`.version-tab[data-prospect="${i}"]`).forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        const ta = document.getElementById('demoReply_' + i);
        if (ta) ta.value = copies[b2] || '';
        return;
      }
      if (t.classList.contains('copy-btn')) {
        const ta = document.getElementById('demoReply_' + t.dataset.prospect);
        const txt = ta ? String(ta.value || '').trim() : '';
        if (!txt) return;
        const done = () => {
          t.textContent = '已复制 ✓';
          setTimeout(() => { t.textContent = '复制'; }, 1200);
        };
        /* 公网那台是 http，navigator.clipboard 在非安全上下文里直接拒——退回选中文本再复制 */
        const legacy = () => {
          try {
            if (!ta) return false;
            ta.focus(); ta.select();
            const ok = document.execCommand('copy');
            if (window.getSelection) window.getSelection().removeAllRanges();
            if (ok) done();
            return ok;
          } catch (_) { return false; }
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(done).catch(legacy);
          } else { legacy(); }
        } catch (_) { legacy(); }
        return;
      }
      if (BENCH_DO_BTNS.some((c) => t.classList.contains(c))) showCta();
    }, true);
  }

  async function benchTick() {
    const main = document.getElementById('mainContent');
    if (!main || main.offsetParent === null) return;         // 人不在工作台这一页
    if (document.getElementById('demoBenchBox')) return;      // 已经铺好
    const now = Date.now();
    const fast = benchTries < 20;
    if (now - benchLastTry < (fast ? 600 : 8000)) return;
    benchLastTry = now; benchTries++;
    if (benchData === null && !fast && benchTries > 26) return;
    try {
      const r = await chrome.storage.local.get('demo_bench');
      const b = r && r.demo_bench;
      benchData = (b && Array.isArray(b.prospects) && b.prospects.length) ? b : null;
    } catch (_) { benchData = null; }
    if (!benchData) return;
    if (document.getElementById('demoBenchBox')) return;
    watchBench(main);
    paintBench(main, benchData);
  }

  /* 真流程偶尔会在这屏之后又画一次「待机中」，把示例卡整块盖掉。
     看到内容区被换了就马上补回来——否则要等下一轮轮询，客户眼前会空好几秒。 */
  let benchWatched = false;
  function watchBench(main) {
    if (benchWatched || typeof MutationObserver !== 'function') return;
    benchWatched = true;
    let last = 0;
    new MutationObserver(() => {
      if (!benchData || document.getElementById('demoBenchBox')) return;
      const now = Date.now();
      if (now - last < 400) return;
      last = now;
      const m = document.getElementById('mainContent');
      if (m && m.offsetParent !== null) paintBench(m, benchData);
    }).observe(main, { childList: true });
  }

  function startBench() {
    benchTick();
    setInterval(benchTick, 700);
  }

  async function boot() {
    let acc = null;
    try {
      const r = await fetch('api/auth/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (r.ok) { const j = await r.json(); acc = (j && j.account) || null; }
    } catch (_) {}
    if (!acc || acc.kind !== 'demo') return;
    try { window.__xhsDemoAccount = acc; } catch (_) {}
    paintBadge(acc);
    paintBanner();
    installActionGuard();
    installGuards();
    startBench();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
