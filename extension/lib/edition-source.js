/**
 * edition-source.js — 「按档位表锁格」＋读表顺序（起始页 / 执行器 / 公网那台 三份逐字节相同）
 *
 * 档位归服务器之后，一份表在三处的走法：
 *   1) 领到过（服务器每 15 秒对账时塞回来的那八格，落在 chrome.storage.local['ed.grant']）→ 以它为准；
 *   2) 从没领到过（断网 / 还没配配对号）→ 用包里那张「进门默认」，顶栏挂一句「未联网核对」，不锁屏、不白屏；
 *   3) 锁格只做显示（让他少撞墙），派活闸（服务器不够档压根不派）才是最后一道真闸。
 *
 * 本文件由 popup.html 在 popup.js 之前装载；后台侧的合并在 lib/edition.js 里做（那边才有 EDITION）。
 */

window.XhsEdition = (() => {
  const GRANT_KEY = 'ed.grant';
  let _cache = null;
  let _watching = false;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── 读表 ── */

  function readGrant() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(null);
        chrome.storage.local.get(GRANT_KEY, (res) => {
          const g = res && res[GRANT_KEY];
          resolve(g && g.features ? g : null);
        });
      } catch (_) { resolve(null); }
    });
  }

  function askPackage() {
    return new Promise((resolve) => {
      try {
        const p = chrome.runtime.sendMessage({ action: 'getEdition' });
        if (p && typeof p.then === 'function') { p.then((r) => resolve(r || null), () => resolve(null)); return; }
        chrome.runtime.sendMessage({ action: 'getEdition' }, (r) => resolve(r || null));
      } catch (_) { resolve(null); }
    });
  }

  /** 领到的表盖在包内摘要上；没领到过就用包里那张（并记下「没核对」，顶栏要说一句） */
  function mergeStatus(pkg, grant) {
    if (!pkg || !pkg.edition) return null;
    const base = Object.assign({}, pkg.edition);
    if (!grant) {
      /* 断网不再锁屏：按包里进门默认显示，靠顶栏那句「未联网核对」说明来路 */
      return { ok: true, expired: !!pkg.expired, noNetwork: false, edition: base, remainingDays: pkg.remainingDays, checkedAt: 0 };
    }
    const ed = Object.assign(base, {
      features: Object.assign({}, base.features, grant.features),
      fromServer: true,
      tier: grant.tier || base.tier || '',
      draftOnly: !!grant.draftOnly,
      onTrial: !!grant.onTrial,
    });
    if (grant.label) ed.label = grant.label;
    return { ok: true, expired: !!(grant.expired || pkg.expired), noNetwork: false, edition: ed, remainingDays: null, checkedAt: Number(grant.at) || 0 };
  }

  async function status(force) {
    if (_cache && !force) return _cache;
    const pkg = await askPackage();
    const grant = await readGrant();
    /* 公网那台的回话本身就是服务器算的（答案里带 fromServer）→ 当作领到的表用 */
    const asGrant = grant || (pkg && pkg.edition && pkg.edition.fromServer ? pkg.edition : null);
    _cache = mergeStatus(pkg, asGrant);
    return _cache;
  }

  function has(name) {
    if (!_cache || !_cache.edition || !_cache.edition.features) return true;
    return !!_cache.edition.features[name];
  }

  /* ── 顶栏徽标 ── */

  function renderBadge(status) {
    const ed = status && status.edition; if (!ed) return;
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    let txt = ed.label || '';
    if (!ed.neverExpires) {
      const d = status.remainingDays;
      if (typeof d === 'number') txt += d <= 0 ? '｜今天到期' : `｜剩${d}天`;
    }
    if (!ed.fromServer) txt += '｜未联网核对';
    badge.textContent = txt || '就绪';
    const bound = ed.boundAccount || {};
    const bindTxt = bound.xhsId ? (bound.name ? `｜绑定：${bound.xhsId}（${bound.name}）` : `｜绑定：${bound.xhsId}`) : '';
    badge.title = (ed.licensee ? ('授权：' + ed.licensee) : '') + bindTxt
      + (ed.fromServer ? '｜格子表由服务器下发' : '｜没连上服务器，先按包里的进门默认显示');
  }

  /** 到期全屏锁：只在服务器判到期、或包本身到期且没领到表时出现 */
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

  /* ── 按表锁格（可逆：服务器改了表不用重开页面） ── */

  function injectStyle() {
    if (document.getElementById('xhsEditionStyle')) return;
    const st = document.createElement('style');
    st.id = 'xhsEditionStyle';
    st.textContent = '.xhs-ed-off{display:none!important;} .xhs-ed-off-soft{opacity:.45;cursor:not-allowed;filter:grayscale(1);}';
    document.head.appendChild(st);
  }
  const off = (el, soft) => { if (el) el.classList.add(soft ? 'xhs-ed-off-soft' : 'xhs-ed-off'); };
  const on = (el, soft) => { if (el) el.classList.remove(soft ? 'xhs-ed-off-soft' : 'xhs-ed-off'); };
  const byId = (id) => document.getElementById(id);

  /** 首次改动前把原样存进 data 属性，格子重新打开时按原样还回去 */
  function swapText(el, prop, next) {
    if (!el) return;
    const keep = 'data-ed-' + prop;
    if (!el.hasAttribute(keep)) el.setAttribute(keep, String(el[prop] == null ? '' : el[prop]));
    el[prop] = next;
  }
  function restoreText(el, prop) {
    if (!el) return;
    const keep = 'data-ed-' + prop;
    if (el.hasAttribute(keep)) { el[prop] = el.getAttribute(keep); el.removeAttribute(keep); }
  }
  function applyLocks(status) {
    injectStyle();
    const ed = status && status.edition;
    const f = (ed && ed.features) || {};
    const draftOnly = !!(ed && ed.draftOnly);
    /* 服务器发页时先挂的「按档预藏」类，JS 接手后摘掉；真正收放改由下面的 xhs-ed-off 管 */
    try { document.documentElement.classList.remove('ed-no-huoke', 'ed-no-prospect', 'ed-draft-only'); } catch (_) {}

    /* 整页发送：灰显 ▾ 入口（不是整块收起，逐条发送照旧能用） */
    const caret = byId('commentCaret');
    if (caret) {
      if (f.batchSend) {
        on(caret, true);
        caret.disabled = false;
        delete caret.dataset.locked;
        restoreText(caret, 'title');
      } else {
        swapText(caret, 'title', '当前版本（' + ((ed && ed.label) || '') + '）不含整页批量发送，仅支持逐条一键发送；升级更高版本解锁');
        caret.disabled = true;
        caret.dataset.locked = '1';
        off(caret, true);
      }
    }

    /* 获客：没开就把整块收掉——连「获客」这扇门一起收，工作台只活在获客下面 */
    const WATER_IDS = ['panelLeft', 'divider', 'subTabs', 'tabQueue', 'tabPool', 'tabTaskCfg', 'tabHuokeCfg', 'huokeCfgContent', 'tabCommentAssistant'];
    const huoke = byId('tabHuoke');
    const banner = document.querySelector('.right-toolbar .toolbar-title');
    const delaysTab = document.querySelector('#setTabs [data-stab="delays"]');
    if (!f.autoWater) {
      if (huoke) off(huoke);
      WATER_IDS.forEach((id) => off(byId(id)));
      if (banner) swapText(banner, 'innerHTML', '<span class="toolbar-title-bar"></span>评论助手');
    } else {
      if (huoke) on(huoke);
      WATER_IDS.forEach((id) => on(byId(id)));
      if (banner) restoreText(banner, 'innerHTML');
    }
    /* 拟人化与频率的入口在 获客 → ⚙️ 设置，设置页那条二级 tab 撤掉（免得两处入口） */
    if (delaysTab) { f.autoWater ? off(delaysTab) : on(delaysTab); }

    /* 线索（③ 起） */
    ['tabProspect', 'tabLeadCfg', 'leadCfgContent', 'tabLeadTaskCfg', 'leadTaskCfgContent']
      .forEach((id) => { f.prospectList ? on(byId(id)) : off(byId(id)); });

    /* 发笔记（① 起）：免费档只到写稿——发布台整页收掉 */
    ['tabNotePublish', 'noteTabs'].forEach((id) => { f.notePublish ? on(byId(id)) : off(byId(id)); });
    const pubDesk = byId('tabNoteQueue');
    if (pubDesk) { (f.notePublish && !draftOnly) ? on(pubDesk) : off(pubDesk); }

    /* 字效编辑器（随发笔记给）：不开也不整页藏掉——片台里画一块「升级解锁」的说明，
       顶上工作流条照常显示；整页藏掉会让人点进「🎬 分幕」看到一块空白 */
    const film = byId('filmContent');
    if (film) on(film);

    /* 锁完通知页面一声：档位变了（服务器改档/小灶）时，页面好把落在已收起页上的人接走 */
    try { window.dispatchEvent(new CustomEvent('xhs-edition-applied', { detail: { autoWater: !!f.autoWater } })); } catch (_) {}
  }

  /* ── 领到新表就当场重锁（不重开页面） ── */

  function watch(recheck) {
    if (_watching) return;
    _watching = true;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local' || !ch || !ch[GRANT_KEY]) return;
        recheck();
      });
    } catch (_) {}
  }

  async function applyToPopup(hooks) {
    const st = await status();
    if (!st || !st.edition) return;
    if (st.expired) { showExpiredMask(st.edition); return; }
    renderBadge(st);
    applyLocks(st);
    if (hooks && typeof hooks.bind === 'function') { try { await hooks.bind(); } catch (_) {} }
    watch(async () => {
      _cache = null;
      const next = await status(true);
      if (!next || !next.edition) return;
      if (next.expired) { showExpiredMask(next.edition); return; }
      renderBadge(next);
      applyLocks(next);
    });
  }

  return { status, has, applyLocks, applyToPopup, renderBadge, showExpiredMask, GRANT_KEY };
})();
