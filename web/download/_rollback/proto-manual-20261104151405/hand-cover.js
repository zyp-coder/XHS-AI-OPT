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
  let last = { state: 'running', step: '正在准备…', count: '', result: '', touch: 0, wait: false, waitUntil: 0, waitWhy: '' };
  /* 「已 3 分 20 秒」按这一步什么时候开始的自己走：日志不更新也一直走，人一眼看得出是等还是卡 */
  let stepAt = Date.now();
  let stalled = false;

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    return m > 0 ? (m + ' 分 ' + (s % 60) + ' 秒') : (s + ' 秒');
  }

  /* 蒙层跟着页面深浅走：浅色页盖 20% 黑，深色页盖 8% 白——深色底上压黑肉眼看不见 */
  function veil() {
    let dark = false;
    try {
      const lum = (s) => {
        const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(s || '');
        if (!m) return null;
        if (m[4] !== undefined && +m[4] < 0.5) return null;
        return 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
      };
      const el = document.body || document.documentElement;
      const bgL = lum(getComputedStyle(el).backgroundColor)
        ?? lum(getComputedStyle(document.documentElement).backgroundColor);
      const txtL = lum(getComputedStyle(el).color);
      dark = bgL != null ? bgL < 110 : (txtL != null && txtL > 150);
    } catch (_) {}
    return dark ? 'rgba(255,255,255,.08)' : 'rgba(10,12,18,.2)';
  }

  function render(m) {
    if (!m) return;
    const moved = (m.step != null && String(m.step) !== String(last.step))
      || (m.count != null && String(m.count) !== String(last.count))
      || (m.wait != null && !!m.wait !== !!last.wait)
      || (m.waitUntil != null && (Number(m.waitUntil) || 0) !== (Number(last.waitUntil) || 0))
      || (m.waitWhy != null && String(m.waitWhy || '') !== String(last.waitWhy || ''));
    if (m.state != null) last.state = m.state;
    if (m.step != null) last.step = m.step;
    if (m.count != null) last.count = m.count;
    if (m.result != null) last.result = m.result;
    if (m.touch != null) last.touch = m.touch;
    if (m.wait != null) last.wait = !!m.wait;
    if (m.waitUntil != null) last.waitUntil = Number(m.waitUntil) || 0;
    if (m.waitWhy != null) last.waitWhy = String(m.waitWhy || '');
    if (moved) { stepAt = Date.now(); stalled = false; }
    /* 盖板还没装上（通行证刚验过的那 100ms 里）也先把状态记下，install 时直接按最新画 */
    if (!cover) return;

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
      /* 下一趟活开工：盖回去（整块 HTML 重铺，refs 和「停这一趟」的点击要一起重挂） */
      cover.handed = false;
      cover.el.setAttribute('style', cover.fullStyle);
      cover.el.innerHTML = cover.fullHtml;
      bindFullRefs();
      stepAt = Date.now();
      stalled = false;
      document.title = '机器人干活中 · 请勿操作';
    }
    cover.el.style.background = veil();
    if (last.state === 'human') {
      if (cover.head) { cover.head.textContent = '🖐 机器人干活中 · 请勿操作'; cover.head.style.color = '#e8eaf0'; }
      try { document.title = '机器人干活中 · 请勿操作'; } catch (_) {}
      cover.step.textContent = '这一步要你本人处理（验证码 / 登录失效）';
      cover.result.style.color = '#fbbf24';
      cover.result.textContent = '只解开平台那一页；处理完自动再锁，机器人接着干。';
    } else {
      paintRunning();
      cover.result.textContent = '';
    }
    cover.count.textContent = last.count ? String(last.count) : '';
    cover.touch.textContent = last.touch ? ('挡住了 ' + last.touch + ' 次误碰') : '';
    tickCover();
  }

  /* 两种样子分开说：等时间（为什么等 + 还有多久） / 正在操作（当前这一步） */
  function paintRunning() {
    if (!cover || cover.handed) return;
    if (last.wait) {
      if (cover.head) {
        cover.head.textContent = '⏳ 机器人正在等时间 · 请勿操作';
        cover.head.style.color = '#fbbf24';
      }
      const left = last.waitUntil ? Math.max(0, last.waitUntil - Date.now()) : 0;
      cover.step.textContent = String(last.waitWhy || '下一项还没到点')
        + (left ? '（还有 ' + fmtDur(left) + '）' : '');
      cover.elapsed.textContent = '';
      try { document.title = '⏳ 机器人等时间 · 请勿操作'; } catch (_) {}
    } else {
      if (cover.head) {
        cover.head.textContent = '🖐 机器人干活中 · 请勿操作';
        cover.head.style.color = '#e8eaf0';
      }
      cover.step.textContent = String(last.step || '正在准备…');
      try { document.title = '机器人干活中 · 请勿操作'; } catch (_) {}
    }
  }

  /* 每秒走一拍：已过多久 + 90 秒没进展就变黄、放出「停这一趟」。
     状态要本人处理（验证码/登录）不算卡住——那是机器人在等人。 */
  function tickCover() {
    if (!cover || cover.handed) return;
    if (last.state === 'done' || last.state === 'failed') return;
    const dur = Date.now() - stepAt;
    /* 等时间：不显示「已 X」，每秒刷新还有多久（paintRunning 里算） */
    if (last.wait) paintRunning();
    else if (cover.elapsed) cover.elapsed.textContent = '· 已 ' + fmtDur(dur);
    /* 机器人按计划歇着（定时轮间隔 / 暂停）不是卡住：work-boot 会递 wait=true */
    const isStall = dur >= 90000 && last.state !== 'human' && !last.wait;
    if (isStall !== stalled) {
      stalled = isStall;
      if (cover.warn) cover.warn.style.display = isStall ? '' : 'none';
      if (cover.stopBtn) cover.stopBtn.style.display = isStall ? '' : 'none';
    }
    if (isStall && cover.warn) {
      cover.warn.textContent = '⚠ 这一步卡住了：' + fmtDur(dur) + ' 没进展——页面可能没反应，可以点下面「停这一趟」收队';
    }
  }

  /* 整块盖板上的 refs 与「停这一趟」：初次安装和交还后再盖回来都要重挂一遍 */
  function bindFullRefs() {
    cover.head = cover.el.querySelector('.hc-head');
    cover.step = cover.el.querySelector('.hc-step');
    cover.elapsed = cover.el.querySelector('.hc-elapsed');
    cover.count = cover.el.querySelector('.hc-count');
    cover.result = cover.el.querySelector('.hc-result');
    cover.touch = cover.el.querySelector('.hc-touch');
    cover.warn = cover.el.querySelector('.hc-warn');
    cover.stopBtn = cover.el.querySelector('.hc-stop');
    if (cover.stopBtn && !cover.stopBtn.dataset.bound) {
      cover.stopBtn.dataset.bound = '1';
      cover.stopBtn.addEventListener('click', () => {
        if (cover.stopBtn.disabled) return;
        cover.stopBtn.disabled = true;
        cover.stopBtn.textContent = '已喊停，做完当前这一步就停…';
        cover.stopBtn.style.opacity = '.7';
        if (cover.warn) cover.warn.textContent = '⏹ 已收到「停这一趟」：做完当前这一步就收队，队列进度不丢';
        try { chrome.runtime.sendMessage({ type: 'ex.stop' }, () => { try { void chrome.runtime.lastError; } catch (_) {} }); } catch (_) {}
        try { if (window.AutoBot && typeof window.AutoBot.stop === 'function') window.AutoBot.stop(); } catch (_) {}
      });
    }
  }

  function install() {
    if (document.getElementById('__handCover')) return;
    const origTitle = document.title || '';
    const el = document.createElement('div');
    el.id = '__handCover';
    el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;'
      + 'justify-content:center;background:' + veil() + ';color:#e8eaf0;'
      + 'font:14px/1.75 system-ui,-apple-system,"Microsoft YaHei",sans-serif;text-align:center;');
    el.innerHTML = '<div style="margin-top:14px;max-width:min(760px,94vw);padding:10px 18px 11px;'
      + 'border-radius:14px;background:rgba(12,15,22,.78);box-shadow:0 8px 24px rgba(0,0,0,.28);">'
      + '<div class="hc-head" style="font-size:22px;font-weight:800;letter-spacing:.5px">🖐 机器人干活中 · 请勿操作</div>'
      + '<div style="margin-top:2px;font-size:14px;color:#e6e9ef"><span class="hc-step"></span>'
      + '<span class="hc-elapsed" style="margin-left:6px;font-size:12px;color:#9aa3b5"></span></div>'
      + '<div class="hc-count" style="font-size:12px;color:#9aa3b5"></div>'
      + '<div class="hc-result" style="font-size:13px;color:#86efac;min-height:0"></div>'
      + '<div class="hc-touch" style="font-size:12px;color:#fbbf24"></div>'
      + '<div class="hc-warn" style="display:none;margin-top:4px;font-size:13px;color:#fbbf24"></div>'
      + '<div style="margin-top:8px"><button class="hc-stop" type="button" style="display:none;cursor:pointer;'
      + 'border:0;border-radius:10px;padding:7px 18px;background:#b45309;color:#fff;'
      + 'font:600 13px system-ui,-apple-system,\'Microsoft YaHei\',sans-serif">⏹ 停这一趟</button></div>'
      + '<div style="font-size:11px;color:#8b93a5">点、打字、滚动、右键都不生效；这一趟干完，页面就交回给你，窗不关。</div>'
      + '</div>';
    (document.documentElement || document.body).appendChild(el);
    cover = {
      el,
      origTitle,
      fullStyle: el.getAttribute('style'),
      fullHtml: el.innerHTML,
      handed: false, barT: null, barR: null,
    };
    bindFullRefs();
    document.title = '机器人干活中 · 请勿操作';

    const block = (e) => {
      if (!e.isTrusted || cover.handed) return;
      /* 「停这一趟」是这层盖板上唯一的出口：它自己那颗按钮不挡 */
      try { if (e.target && e.target.closest && e.target.closest('.hc-stop')) return; } catch (_) {}
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } catch (_) {}
    };
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keypress', 'keyup',
      'dragstart', 'selectstart'].forEach((ev) => {
      try { window.addEventListener(ev, block, { capture: true, passive: false }); } catch (_) {}
    });
    setInterval(tickCover, 1000);
    render(last);
  }

  window.HandCover = {
    set(m) {
      if (m && typeof m === 'object') render(m);
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
