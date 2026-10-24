/* hand-cover.js — 干活窗口里"整页锁"的那一层（工作台 / 出片页共用）
 *
 * 只在拿到一次性通行证（window.__XHS_HAND__ === true）之后才盖。
 * 盖住这一页的全部界面，只挡人手（isTrusted=true 的事件），机器人自己的程序化点击照走。
 * 步骤 / 被碰次数 / 结果由后台广播 ex.work.step 送来；页面自己也可以调 HandCover.set()。
 * 这一趟干完不关窗：这层从全屏盖着收成顶部一条，页面交回给人随便点。
 */
(() => {
  if (window.top !== window) return;

  let cover = null;
  let last = { state: 'running', step: '正在准备…', count: '', result: '', touch: 0 };

  function render(m) {
    if (!cover || !m) return;
    if (m.state != null) last.state = m.state;
    if (m.step != null) last.step = m.step;
    if (m.count != null) last.count = m.count;
    if (m.result != null) last.result = m.result;
    if (m.touch != null) last.touch = m.touch;

    if (last.state === 'done' || last.state === 'failed') {
      /* 交回给人：整屏盖变成顶部一条，不挡点 */
      if (!cover.handed) {
        cover.handed = true;
        cover.el.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:2147483647;'
          + 'pointer-events:none;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;'
          + 'color:#fff;font:13px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
          + 'padding:9px 16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.22)');
        cover.el.innerHTML = '<b class="hc-t"></b><span class="hc-r"></span>';
        cover.barT = cover.el.querySelector('.hc-t');
        cover.barR = cover.el.querySelector('.hc-r');
        document.title = cover.origTitle || document.title;
      }
      const ok = last.state === 'done';
      cover.el.style.background = ok ? '#0a7b5a' : '#b45309';
      cover.barT.textContent = ok ? '✅ 这一趟干完了' : '⚠ 这一趟停在半路';
      cover.barR.textContent = String(last.result || (ok ? '干完了' : '没跑完'))
        + ' —— 这一页交给你，接着点没人管；下一趟活来了这扇窗自己接着用';
      return;
    }
    if (cover.handed) {
      /* 下一趟活开工：盖回去 */
      cover.handed = false;
      cover.el.setAttribute('style', cover.fullStyle);
      cover.el.innerHTML = cover.fullHtml;
      cover.step = cover.el.querySelector('.hc-step');
      cover.count = cover.el.querySelector('.hc-count');
      cover.result = cover.el.querySelector('.hc-result');
      cover.touch = cover.el.querySelector('.hc-touch');
      document.title = '机器人干活中 · 请勿操作';
    }
    if (last.state === 'human') {
      cover.el.style.background = 'rgba(24,18,8,.96)';
      cover.step.textContent = '这一步要你本人处理（验证码 / 登录失效）';
      cover.result.style.color = '#fbbf24';
      cover.result.textContent = '只解开平台那一页；处理完自动再锁，机器人接着干。';
    } else {
      cover.el.style.background = 'rgba(10,12,18,.94)';
      cover.step.textContent = String(last.step || '正在准备…');
      cover.result.textContent = '';
    }
    cover.count.textContent = last.count ? String(last.count) : '';
    cover.touch.textContent = last.touch ? ('挡住了 ' + last.touch + ' 次误碰') : '';
  }

  function install() {
    if (document.getElementById('__handCover')) return;
    const origTitle = document.title || '';
    const el = document.createElement('div');
    el.id = '__handCover';
    el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;'
      + 'justify-content:center;background:rgba(10,12,18,.94);color:#e8eaf0;backdrop-filter:blur(2px);'
      + 'font:14px/1.75 system-ui,-apple-system,"Microsoft YaHei",sans-serif;text-align:center;');
    el.innerHTML = '<div style="max-width:600px;padding:24px">'
      + '<div style="font-size:44px;line-height:1">🖐</div>'
      + '<div style="font-size:13px;color:#9aa3b5;margin-top:14px">机器人正在干活</div>'
      + '<div style="font-size:23px;font-weight:800;margin-top:6px;letter-spacing:.5px">机器人干活中 · 请勿操作</div>'
      + '<div style="font-size:13px;color:#9aa3b5;margin-top:10px">这扇窗只给机器人用：点、打字、滚动、右键都不生效。<br>这一趟干完，页面就交回给你，窗不关。</div>'
      + '<div class="hc-step" style="margin-top:20px;font-size:14px;color:#e6e9ef"></div>'
      + '<div class="hc-count" style="font-size:12px;color:#9aa3b5;margin-top:6px"></div>'
      + '<div class="hc-result" style="font-size:14px;color:#86efac;margin-top:14px;min-height:20px"></div>'
      + '<div class="hc-touch" style="font-size:12px;color:#fbbf24;margin-top:12px;min-height:18px"></div>'
      + '<div style="font-size:11px;color:#6b7280;margin-top:18px">锁只挡人手，不挡机器人自己的点击；被碰次数会记进这一单的回执。</div>'
      + '</div>';
    (document.documentElement || document.body).appendChild(el);
    cover = {
      el,
      origTitle,
      fullStyle: el.getAttribute('style'),
      fullHtml: el.innerHTML,
      handed: false, barT: null, barR: null,
      step: el.querySelector('.hc-step'),
      count: el.querySelector('.hc-count'),
      result: el.querySelector('.hc-result'),
      touch: el.querySelector('.hc-touch'),
    };
    document.title = '机器人干活中 · 请勿操作';

    const block = (e) => {
      if (!e.isTrusted || cover.handed) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_) {}
    };
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keypress', 'keyup',
      'dragstart', 'selectstart'].forEach((ev) => {
      try { window.addEventListener(ev, block, { capture: true, passive: false }); } catch (_) {}
    });
    render(last);
  }

  window.HandCover = {
    set(m) {
      if (m && typeof m === 'object') Object.assign(last, m);
      render(last);
    },
    state() { return last.state; },
  };

  /* 等通行证验过再盖（手工打开时 hand-mode 挡页，这里一动不动） */
  const t0 = Date.now();
  const timer = setInterval(() => {
    if (window.__XHS_HAND__ === true) {
      clearInterval(timer);
      if (document.body) install();
      else document.addEventListener('DOMContentLoaded', install, { once: true });
      try {
        chrome.runtime.onMessage.addListener((m) => {
          if (m && m.type === 'ex.work.step') render(m);
        });
      } catch (_) {}
      return;
    }
    if (window.__XHS_HAND_BLOCKED__ || Date.now() - t0 > 10000) clearInterval(timer);
  }, 100);
})();
