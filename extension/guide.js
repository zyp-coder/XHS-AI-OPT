/* 新手引导（扩展版）· 2026-10-16 前置流程重排
   ① 看过＝按产品记下 localStorage 'xhs_guide_seen:<产品id>'（换产品重新弹）
   ② 出口：进门弹出来的 → 回工作台并落到「账号规划 · 问卷」（带 openQuiz=1，tabId 原样带回）；
      工作台顶栏回看的（?from=bar）→ 只回工作台
   ③ 三个签 + ?mod= 带页定位（和公网版一致） */
(function () {
  'use strict';

  /* ① 按产品记「看过」 */
  try {
    chrome.storage.local.get('current_tenant_id', function (r) {
      var cur = (r && r.current_tenant_id) || 'default';
      try { localStorage.setItem('xhs_guide_seen:' + cur, '1'); } catch (_) {}
    });
  } catch (_) {}

  /* ② 出口按钮 */
  var qs = new URLSearchParams(location.search);
  var from = qs.get('from') || '';
  var tabId = qs.get('tabId');
  function applyExit(el) {
    if (!el) return;
    if (from === 'bar') {
      el.textContent = '了解，回工作台。';
      el.setAttribute('href', 'popup.html?mode=big' + (tabId ? ('&tabId=' + encodeURIComponent(tabId)) : ''));
    }
    /* 默认（进门弹出来的）：文案和 href 已在页面上——下一步去填问卷 */
  }
  applyExit(document.getElementById('gdExit'));
  applyExit(document.getElementById('gdExitBottom'));
  /* 新开大窗时带着 tabId：把两个出口链接都补上当前 tabId */
  if (tabId) {
    ['gdExit', 'gdExitBottom'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && from !== 'bar') el.setAttribute('href', 'popup.html?mode=big&openQuiz=1&tabId=' + encodeURIComponent(tabId));
    });
  }

  /* ③ 三个签 + 带页定位 */
  function setTab(m) {
    document.querySelectorAll('.mtab').forEach(function (b) { b.classList.toggle('active', b.dataset.mod === m); });
    document.querySelectorAll('.mod-panel').forEach(function (p) { p.classList.toggle('show', p.dataset.mod === m); });
  }
  function flash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  function applyMod(m) {
    if (!m) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (m === 'note' || m === 'huoke' || m === 'ai') {
      setTab(m);
      var card = document.getElementById('m2');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { flash(card); }, 350);
    } else if (m === 'account' || m === 'settings') {
      var b = document.querySelector('[data-blk="' + m + '"]');
      if (b) {
        b.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () { flash(b); }, 350);
      }
    }
  }
  document.querySelectorAll('.mtab').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.dataset.mod); });
  });
  var mod0 = qs.get('mod') || '';
  if (mod0) setTimeout(function () { applyMod(mod0); }, 150);
})();
