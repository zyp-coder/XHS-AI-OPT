/* ===== 下拉菜单交互（纯视觉整合，通过外链加载以规避 CSP 内联限制） ===== */
(function () {
  function init() {
    document.addEventListener('click', function (e) {
      var caret = e.target.closest ? e.target.closest('.caret-btn') : null;
      var item = e.target.closest ? e.target.closest('.drop-item') : null;

      // 1) 点击三角 → 切换对应下拉
      if (caret) {
        e.stopPropagation();
        var group = caret.closest('.btn-group');
        var dd = group ? group.querySelector('.btn-dropdown') : null;
        var willOpen = dd ? !dd.classList.contains('open') : false;
        closeAll();
        if (dd && willOpen) {
          // ★ 下拉用 fixed 定位并按按钮实际坐标摆放，脱离 overflow:hidden 祖先的裁剪，
          //   避免在窄窗口里“只露出一半/被裁切”。弹窗内的 fixed 不会被子容器 overflow 裁掉。
          try {
            var g = group.getBoundingClientRect();
            var dw = dd.offsetWidth || 200;
            var left = g.left + g.width - dw;          // 优先右对齐到按钮右缘
            if (left < 8) left = 8;                    // 左缘越界则顶到左边，防止被弹出视口裁切
            if (left + dw > window.innerWidth) left = Math.max(8, window.innerWidth - dw - 8);
            dd.style.position = 'fixed';
            dd.style.left = left + 'px';
            dd.style.right = '';
            dd.style.top = (g.bottom + 6) + 'px';
          } catch (_) {}
          dd.classList.add('open');
        }
        return;
      }

      // 2) 点击下拉项 → 执行动作并关闭
      if (item) {
        var dd2 = item.closest('.btn-dropdown');
        var action = item.getAttribute('data-action') || item.getAttribute('data-rid');
        if (dd2) dd2.classList.remove('open');
        handleAction(action);
        return;
      }

      // 3) 点击其它区域 → 关闭所有下拉
      var inside = e.target.closest && e.target.closest('.btn-dropdown');
      if (!inside) closeAll();
    });

    // 按下 Esc 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  }

  function closeAll() {
    var all = document.querySelectorAll('.btn-dropdown.open');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('open');
  }

  function handleAction(action) {
    switch (action) {
      case 'search':
        var kb = document.getElementById('awKeywordPopup');
        var sr = document.getElementById('btnSearch');
        if (kb && sr) { if (kb.value.trim()) sr.click(); else kb.focus(); }
        break;
      case 'cold':
      case 'cycle':
        var sel = document.getElementById('botModeSelect');
        var bb = document.getElementById('botToggleBtn');
        if (sel) sel.value = (action === 'cycle') ? 'cycle' : 'cold';
        if (bb && !bb.disabled) bb.click();
        break;
      case 'refresh':
        var rd = document.getElementById('refreshBtn');
        if (rd && rd.click) rd.click();
        break;
      case 'send':
        var bs = document.getElementById('batchSendBtn');
        if (bs && bs.click) bs.click();
        break;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();