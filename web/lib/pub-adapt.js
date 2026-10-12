/**
 * pub-adapt.js — 发布台 · 页面动作库（三家创作者后台的「传图填字 → 停/发」）
 *
 * 约定（很重要）：
 *  1) 这里的 NPA_* 全是「自包含注入函数」——由 background 用
 *     chrome.scripting.executeScript({ func: NPA_xx, args: [...] }) 注入到目标页面执行。
 *     函数体会被序列化，**不准引用本文件/外部的任何变量**（除了入参 args 和浏览器全局）。
 *     因此每个函数内部自带一份小工具（sleep / 可见判断 / 合成点击…）——是有意重复。
 *  2) 入参只走可结构化克隆的普通对象；文件走 base64 分片（NPA_BUF_ADD 攒、平台上传函数拼 File）。
 *     分片攒在 window.__npaBuf（同一扩展在同 frame 的注入共享同一世界，多次注入能接力）。
 *  3) 合成事件（dispatchEvent）三家都已实测吃得下：填入用它、话题芯片走「打字开下拉 → 点条目」。
 *     抖音上传的 input 是「点击时才创建、从不进 DOM」——先 NPA_DY_HOOK（MAIN world）再点上传区。
 *     小红书「发布」按钮封在 <xhs-publish-btn> 的 closed shadow 里——靠 lib/pub-shadow-hook.js
 *     （document_start·MAIN 强制 open 并记档）开壳后，NPA_XHS_SEND 才找得到它。
 *  4) 本文件不碰站外接口，只有页面内的 DOM 动作（老板红线：就浏览器扩展的形式）。
 *  5) 点击一律走 humanClick 拟真（2026-10-11 防风控加固）：轨迹移动 → 悬停 → 按下 → 抬起，
 *     落点 ±2px、时序随机——磨掉「凭空闪现 / 永远正中 / 零间隔」三个机器特征。
 *     填字不做逐字模拟（内容本来就是复制粘贴场景，一次性填入即真）。
 *     humanClick 在各函数体内联一份——同 1) 的约束（会被序列化，引不了外部）。
 *  6) 节奏加厚（2026-10-11 四十三改，发布方式三档同批）：进页先安顿 2~6 秒并随便晃几步鼠标；
 *     每处落字前 / 落完各停一拍；全自动发布前整页下限 60~90 秒＋贴到按钮旁停 1~3 秒再点；
 *     发完定住 2~5 秒再走。目的是把「填完即发、开页即动手」的节奏磨成人的节奏。
 *  7) 手发核收（四十三改）：NPA_PUB_CHECK——hold 档「备好等您点」把页面交到用户手上后，
 *     background 在标签页一动 / 每分钟时注入这里看「点了发布没有」；只认明确成功特征，
 *     拿不准一律算没发（误报会把没发的标成已发，比漏报糟）。
 */

/* 分片大小（base64 字符数；3MB ≈ 2.2MB 原始文件一片） */
const NPA_CHUNK = 3 * 1024 * 1024;

/* ── 通用：攒分片（三家用同一套；key 形如 pub:<篇id>:<i>） ── */
const NPA_BUF_ADD = function (args) {
  const { key, b64, done } = args;
  const w = window;
  if (!w.__npaBuf) w.__npaBuf = {};
  if (!w.__npaBuf[key]) w.__npaBuf[key] = { parts: [], done: false };
  const rec = w.__npaBuf[key];
  rec.parts.push(b64 || '');
  if (done) rec.done = true;
  return { ok: true, parts: rec.parts.length, done: rec.done };
};
const NPA_BUF_CLEAR = function (args) {
  const w = window;
  if (w.__npaBuf && args && args.key) delete w.__npaBuf[args.key];
  return { ok: true };
};
/* 由分片拼出 File（供各平台上传统一调用；不导出，写在各函数体内的同名小工具里） */

/* ── 通用：探针（登录没有 / 页面到没到） ── */
const NPA_PROBE = function (args) {
  const pid = (args && args.pid) || '';
  const url = location.href;
  const txt = (document.body ? document.body.innerText : '').slice(0, 4000);
  const loginByUrl = /(^|\/\/)([^/]*\.)?(login|sso)\b/i.test(url) || /\/login/i.test(url);
  const loginByText = /扫码登录|登录后|请登录|二维码登录/.test(txt);
  const out = { url: url, login: loginByUrl || loginByText, ready: true };
  if (pid === 'xhs') {
    /* 发布按钮在 <xhs-publish-btn> 的 shadow 里——只认精确「发布」，别把导航「发布笔记」算进来 */
    const hasPub = (root) => {
      let els = [];
      try { els = root.querySelectorAll('button'); } catch (e) { return false; }
      for (const e of els) if ((e.innerText || '').trim() === '发布' && e.getBoundingClientRect().width > 0) return true;
      return false;
    };
    const host = document.querySelector('xhs-publish-btn');
    out.publishBtn = hasPub(document) || (host && host.shadowRoot && hasPub(host.shadowRoot)) ||
      (window.__npaShadowRoots || []).some(hasPub);
    out.shadowHook = !!window.__npaShadowHookOn;
    out.editor = !!document.querySelector('.tiptap.ProseMirror, .ql-editor');
  } else if (pid === 'douyin') {
    out.editor = !!document.querySelector('.zone-container[contenteditable], [contenteditable="true"]');
    out.publishBtn = !!([...document.querySelectorAll('button')].find(b => /^(发布|发布并保存)$/.test((b.innerText || '').trim())));
  } else if (pid === 'channels') {
    out.form = !!document.querySelector('.input-editor');
  }
  return out;
};

/* ── 通用：手发核收（四十三改）：hold 档交出页面后「您点完发布没有」看一眼。
   成功特征按各家发布后落点 + 成功吐司写（视频号吐司在表单 iframe 里，连同源 iframe 一起扫）；
   只认明确成功，拿不准算没发（误报会把没发的标成已发）。── */
const NPA_PUB_CHECK = function (args) {
  const pid = (args && args.pid) || '';
  const href = location.href;
  const texts = [];
  try { if (document.body) texts.push(document.body.innerText.slice(0, 6000)); } catch (e) {}
  try {
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.body) texts.push(d.body.innerText.slice(0, 6000));
    }
  } catch (e) {}
  const t = texts.join('\n');
  if (pid === 'xhs') {
    if (/\/publish\/success/.test(href) || /发布成功/.test(t)) return { sent: true, url: href };
  } else if (pid === 'douyin') {
    if (/\/content\/manage/.test(href) || /发布成功|作品发布成功/.test(t)) return { sent: true, url: href };
  } else if (pid === 'channels') {
    if (/\/platform\/post\/list|\/platform\/post\/created/.test(href) || /发表成功|发布成功|已发表/.test(t)) return { sent: true, url: href };
  }
  return { sent: false, url: href };
};

/* ═══════════════ 📕 小红书（creator.xiaohongshu.com/publish/publish） ═══════════════
   已探明：图文 input[accept=".jpg,.jpeg,.png,.webp"][multiple] 常驻 .img-list；
   标题 input[placeholder*=标题]（原生 setter + input 事件）；
   正文 .tiptap.ProseMirror（execCommand insertText）；
   话题＝打字 '#词' 开 .tippy-box 下拉 → 点 .item → 落 a.tiptap-topic；
   页面里有屏幕外克隆（负坐标），一切找元素都走「可见优先」。 */

/** 切到「上传图文 / 上传视频」页签（进错 tab 时 find input 落空） */
const NPA_XHS_TAB = function (args) {
  const want = (args && args.isVideo) ? '上传视频' : '上传图文';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  /* 拟真点击（约定见文件头 5）；内联是注入约束决定的，别外提成公共函数 */
  const humanClick = async (el) => {
    const r = el.getBoundingClientRect();
    const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
    const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const sx = window.__npaMouse.x, sy = window.__npaMouse.y;
    const base = { bubbles: true, cancelable: true, composed: true, view: window };
    const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, last = i === steps;
      const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
      const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
      const under = document.elementFromPoint(x, y) || el;
      under.dispatchEvent(ev(PointerEvent, 'pointermove', x, y));
      under.dispatchEvent(ev(MouseEvent, 'mousemove', x, y));
      await sleep(15 + Math.random() * 40);
    }
    el.dispatchEvent(ev(PointerEvent, 'pointerover', tx, ty));
    el.dispatchEvent(ev(PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    el.dispatchEvent(ev(MouseEvent, 'mouseover', tx, ty));
    el.dispatchEvent(ev(MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    await sleep(90 + Math.random() * 160);
    el.dispatchEvent(ev(PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
    el.dispatchEvent(ev(MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
    await sleep(50 + Math.random() * 80);
    el.dispatchEvent(ev(PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
    window.__npaMouse = { x: tx, y: ty };
  };
  return (async () => {
    /* 进页安顿（四十三改）：刚落页先停 2~6 秒、随便晃几步鼠标——磨掉「开页即动手」的节奏特征 */
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const settleUntil = Date.now() + 2000 + Math.random() * 4000;
    while (Date.now() < settleUntil) {
      const m = window.__npaMouse;
      m.x = Math.max(2, Math.min(window.innerWidth - 2, m.x + (Math.random() * 260 - 130)));
      m.y = Math.max(2, Math.min(window.innerHeight - 2, m.y + (Math.random() * 220 - 110)));
      const under = document.elementFromPoint(m.x, m.y);
      if (under) {
        const base = { bubbles: true, cancelable: true, composed: true, view: window };
        under.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: m.x, clientY: m.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base)));
        under.dispatchEvent(new MouseEvent('mousemove', Object.assign({ clientX: m.x, clientY: m.y }, base)));
      }
      await sleep(180 + Math.random() * 420);
    }
    const el = (() => {
      const cands = [...document.querySelectorAll('div,span,button,a')].filter(e => {
        if ((e.innerText || '').trim() !== want) return false;
        if (e.children.length > 2) return false;
        return vis(e);
      });
      if (!cands.length) return null;
      cands.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
      return cands[0];
    })();
    if (el) await humanClick(el);
    await sleep(900);
    return { ok: true, tab: want, clicked: !!el };
  })();
};

/** 传图/传视频：找常驻 input → 分片拼 File → DataTransfer 塞 → change → 等素材挂上编辑器 */
const NPA_XHS_UPLOAD = function (args) {
  const { keys, isVideo } = args;   // keys＝每份文件的 __npaBuf key
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  return (async () => {
    const pickInput = () => {
      const all = [...document.querySelectorAll('input[type="file"]')];
      const cand = all.filter(i => {
        const ac = String(i.accept || '');
        if (!ac) return false;
        if (/pdf|doc|ppt|\.txt/i.test(ac)) return false;     // 附件上传口，不要
        if (isVideo) return /video|mp4|mov|m4v|avi/i.test(ac);
        return /image|jpg|jpeg|png|webp/i.test(ac);
      });
      if (!cand.length) return null;
      const multi = cand.find(i => i.multiple) || cand[0];
      return multi;
    };
    let inp = null;
    for (let i = 0; i < 10 && !inp; i++) { inp = pickInput(); if (!inp) await sleep(600); }
    if (!inp) return { ok: false, msg: '没找到上传口（是不是还没进对应页签？）' };

    const buf = window.__npaBuf || {};
    const dt = new DataTransfer();
    const missed = [];
    for (const k of (keys || [])) {
      const rec = buf[k];
      if (!rec || !rec.done) { missed.push(k); continue; }
      const bin = atob(rec.parts.join(''));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const name = k.split('|')[1] || 'file';
      const mime = isVideo ? (/\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4') : (/\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');
      dt.items.add(new File([arr], name, { type: mime }));
      delete buf[k];
    }
    if (!dt.files.length) return { ok: false, msg: '文件分片没攒齐：' + missed.join(',') };
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));

    /* 等素材挂上：缩略图数量齐 / 视频等「更换」或时长的出现 */
    const needN = dt.files.length;
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const imgs = document.querySelectorAll('.img-list img, [class*="img-list"] img').length;
      if (!isVideo && imgs >= needN) return { ok: true, n: dt.files.length };
      if (isVideo) {
        const vt = document.querySelector('video, [class*="video-container"], [class*="videoBox"]');
        if (vt) return { ok: true, n: dt.files.length };
      }
    }
    return { ok: false, msg: '素材传上去了但没见编辑器就绪' };
  })();
};

/** 填标题 + 正文 + 话题（先清空再填——草稿恢复的旧内容不跟新稿混） */
const NPA_XHS_FILL = function (args) {
  const { title, body, tags } = args;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  /* 拟真点击（约定见文件头 5）；内联是注入约束决定的，别外提成公共函数 */
  const humanClick = async (el) => {
    const r = el.getBoundingClientRect();
    const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
    const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const sx = window.__npaMouse.x, sy = window.__npaMouse.y;
    const base = { bubbles: true, cancelable: true, composed: true, view: window };
    const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, last = i === steps;
      const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
      const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
      const under = document.elementFromPoint(x, y) || el;
      under.dispatchEvent(ev(PointerEvent, 'pointermove', x, y));
      under.dispatchEvent(ev(MouseEvent, 'mousemove', x, y));
      await sleep(15 + Math.random() * 40);
    }
    el.dispatchEvent(ev(PointerEvent, 'pointerover', tx, ty));
    el.dispatchEvent(ev(PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    el.dispatchEvent(ev(MouseEvent, 'mouseover', tx, ty));
    el.dispatchEvent(ev(MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    await sleep(90 + Math.random() * 160);
    el.dispatchEvent(ev(PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
    el.dispatchEvent(ev(MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
    await sleep(50 + Math.random() * 80);
    el.dispatchEvent(ev(PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
    window.__npaMouse = { x: tx, y: ty };
  };
  return (async () => {
    const warn = [];
    /* 标题 */
    const ti = [...document.querySelectorAll('input')].find(i => /标题/.test(i.placeholder || '') && vis(i));
    if (ti) {
      await humanClick(ti);
      await sleep(400 + Math.random() * 800);   // 点进停一拍（四十三改）
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(ti, String(title || ''));
      ti.dispatchEvent(new Event('input', { bubbles: true }));
      ti.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500 + Math.random() * 1000);  // 落完停一拍再挪去正文（四十三改）
    } else warn.push('标题框没找到');

    /* 正文编辑器：选可见的最宽的那个 tiptap */
    const eds = [...document.querySelectorAll('.tiptap.ProseMirror, [contenteditable="true"]')].filter(e => {
      if (!vis(e)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 200 && r.height > 40;
    });
    eds.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const ed = eds[0];
    if (!ed) return { ok: false, msg: '正文编辑器没找到', warn };
    await humanClick(ed);
    ed.focus();
    await sleep(400 + Math.random() * 800);   // 点进来停一拍（四十三改）
    /* 清空 */
    try { document.execCommand('selectAll'); document.execCommand('delete'); } catch (e) {}
    await sleep(150);
    /* 正文 */
    const put = (t) => { document.execCommand('insertText', false, t); };
    const lines = String(body || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i) document.execCommand('insertParagraph');
      put(lines[i]);
    }
    await sleep(500 + Math.random() * 1000);   // 落完停一拍再接话题（四十三改）
    /* 话题：打字 '#词' → 等下拉 → 点第一条 */
    for (const tg of (tags || [])) {
      document.execCommand('insertParagraph');
      put('#' + String(tg).replace(/^#/, ''));
      let item = null;
      for (let i = 0; i < 14 && !item; i++) {
        await sleep(150);
        const boxes = [...document.querySelectorAll('.tippy-box')].filter(b => vis(b) && b.querySelector('.item'));
        if (boxes.length) {
          const its = [...boxes[0].querySelectorAll('.item')];
          const want = String(tg).replace(/^#/, '');
          item = its.find(it => ((it.querySelector('.name') || {}).innerText || '').replace(/^#/, '') === want) || its[0];
        }
      }
      if (item) {
        await humanClick(item);
        await sleep(300);
      } else {
        put(' ');
        warn.push('话题「' + tg + '」下拉没出来，按纯文本留着了');
      }
    }
    return { ok: true, warn: warn };
  })();
};

/** 找（并可点）发布按钮。dry=true 只回报在不在、点的位置，不点。
    发布按钮封在 <xhs-publish-btn> 的 closed shadow 里——先靠 lib/pub-shadow-hook.js 开壳
    （window.__npaShadowRoots），这里把 document + 所有能到的 open shadow 都翻一遍。 */
const NPA_XHS_SEND = function (args) {
  const dry = !!(args && args.dry);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  const findBtn = () => {
    const roots = [document];
    const seen = new Set();
    const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
    (window.__npaShadowRoots || []).forEach(push);
    const walk = (node) => {
      let els = [];
      try { els = node.querySelectorAll('*'); } catch (e) { return; }
      for (const el of els) {
        if (el.shadowRoot) { push(el.shadowRoot); walk(el.shadowRoot); }
      }
    };
    walk(document);
    const pool = [];
    for (const root of roots) {
      let els = [];
      try { els = root.querySelectorAll('button,div,span,a'); } catch (e) { continue; }
      for (const e of els) {
        if ((e.innerText || '').trim() !== '发布') continue;   // 精确「发布」：撇开「发布笔记」「定时发布」
        if (e.children.length > 3) continue;
        if (root === document && e.getBoundingClientRect().x < 250) continue;   // 左栏导航不算
        if (!vis(e)) continue;
        pool.push(e);
      }
    }
    if (!pool.length) return null;
    pool.sort((a, b) => {
      const ba = a.tagName === 'BUTTON' ? 1 : 0, bb = b.tagName === 'BUTTON' ? 1 : 0;
      if (ba !== bb) return bb - ba;                                        // 真按钮优先
      return b.getBoundingClientRect().y - a.getBoundingClientRect().y;      // 再取最靠下的（底栏）
    });
    return pool[0];
  };
  const usable = (b) => {
    if (!b) return false;
    if (b.disabled) return false;
    if (b.getAttribute('aria-disabled') === 'true') return false;
    if (/disabled/i.test(String(b.className || ''))) return false;
    return true;
  };
  /* 拟真点击（约定见文件头 5）；composed 全保留——「发布」封在 <xhs-publish-btn> 的封闭
     shadow 里，事件不带 composed 出不了 shadow 边界（2026-10-09 实踩：缺它整条发布无反应） */
  const humanClick = async (b) => {
    const r = b.getBoundingClientRect();
    const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
    const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const sx = window.__npaMouse.x, sy = window.__npaMouse.y;
    const base = { bubbles: true, cancelable: true, composed: true, view: window };
    const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, last = i === steps;
      const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
      const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
      const under = document.elementFromPoint(x, y) || b;
      under.dispatchEvent(ev(PointerEvent, 'pointermove', x, y));
      under.dispatchEvent(ev(MouseEvent, 'mousemove', x, y));
      await sleep(15 + Math.random() * 40);
    }
    b.dispatchEvent(ev(PointerEvent, 'pointerover', tx, ty));
    b.dispatchEvent(ev(PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    b.dispatchEvent(ev(MouseEvent, 'mouseover', tx, ty));
    b.dispatchEvent(ev(MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    await sleep(90 + Math.random() * 160);
    b.dispatchEvent(ev(PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
    b.dispatchEvent(ev(MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
    await sleep(50 + Math.random() * 80);
    b.dispatchEvent(ev(PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
    b.dispatchEvent(ev(MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
    b.dispatchEvent(ev(MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
    window.__npaMouse = { x: tx, y: ty };
  };
  const checkDone = () => {
    if (!/publish\/publish/.test(location.href)) return { ok: true, sent: true, url: location.href };
    const t = (document.body ? document.body.innerText : '');
    if (/发布成功/.test(t.slice(0, 3000))) return { ok: true, sent: true, url: location.href };
    if (/发布失败|请勿提交|错误/.test(t.slice(0, 3000))) return { ok: false, msg: '页面报发布失败' };
    return null;
  };

  return (async () => {
    let btn = findBtn();
    if (!btn) return { ok: false, msg: '发布按钮没找到' + (window.__npaShadowHookOn ? '' : '（shadow 钩子没装上）') };
    const inShadow = !!(btn.getRootNode && btn.getRootNode() !== document);
    if (dry) {
      const dr = btn.getBoundingClientRect();
      return { ok: true, dry: true, text: (btn.innerText || '').trim(), tag: btn.tagName, inShadow,
        disabled: !usable(btn), x: Math.round(dr.x), y: Math.round(dr.y) };
    }
    /* 整页下限（四十三改）：开页到点发布之间至少隔 60~90 秒——磨掉「进页几十秒就发出去」的节奏 */
    const floorMs = 60000 + Math.random() * 30000;
    const past = performance.now();
    if (past < floorMs) await sleep(Math.min(floorMs - past, 95000));
    /* 图还在传/校验时「发布」是禁用态，点了白点——等它亮（≤60s），等不到也照点（下面还有重点击兜底） */
    for (let w = 0; w < 60 && !usable(btn); w++) { await sleep(1000); if (w % 5 === 4) btn = findBtn() || btn; }
    /* 点击 + 观察 ×4 轮：一轮 15 秒没动静就重扫按钮再点（React 可能已替换元素） */
    for (let attempt = 0; attempt < 4; attempt++) {
      btn = findBtn() || btn;
      if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
      /* 发布前凑近按钮旁挪几步再定住一拍（四十三改）：别「填完即发、直奔按钮」 */
      const preN = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < preN; i++) {
        const r = btn.getBoundingClientRect(), m = window.__npaMouse;
        const px = r.x + r.width / 2 + (Math.random() * 120 - 60), py = r.y + r.height / 2 + (Math.random() * 90 - 45);
        m.x = m.x + (px - m.x) * (i + 1) / preN + (Math.random() * 8 - 4);
        m.y = m.y + (py - m.y) * (i + 1) / preN + (Math.random() * 8 - 4);
        const under = document.elementFromPoint(m.x, m.y);
        if (under) {
          const base = { bubbles: true, cancelable: true, composed: true, view: window };
          under.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: m.x, clientY: m.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base)));
          under.dispatchEvent(new MouseEvent('mousemove', Object.assign({ clientX: m.x, clientY: m.y }, base)));
        }
        await sleep(120 + Math.random() * 260);
      }
      await sleep(1000 + Math.random() * 2000);   // 定住一拍再按（四十三改）
      await humanClick(btn);
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        const d = checkDone();
        if (d) {
          if (d.sent) await sleep(2000 + Math.random() * 3000);   // 发完定住看两眼再走（四十三改）
          return d;
        }
      }
    }
    return { ok: false, msg: '点了发布但一直在原地（重点了 4 轮）' };
  })();
};

/* ═══════════════ 🎵 抖音（creator.douyin.com/creator-micro/content/post/…） ═══════════════
   已探明：上传 input 是「点击上传区时临时创建、从不进 DOM」→ 必须先在 MAIN world 装
   createElement 钩子（NPA_DY_HOOK），再合成点击上传区，从钩子记录里拿引用塞文件。
   正文 .zone-container（先合成点击聚焦，再 execCommand）；话题＝打字 '#词' 开
   [class*=mention-suggest-item-container] 下拉 → 点条目 → 落 data-mention 芯片。 */

/** MAIN world：装「抓 file input」钩子。存 window.__npaDyInputs（数组） */
const NPA_DY_HOOK = function () {
  const w = window;
  if (!w.__npaDyHooked) {
    w.__npaDyHooked = true;
    w.__npaDyInputs = [];
    const orig = document.createElement;
    document.createElement = function (tag) {
      const el = orig.apply(this, arguments);
      try { if (String(tag).toLowerCase() === 'input') w.__npaDyInputs.push(el); } catch (e) {}
      return el;
    };
  }
  return { ok: true };
};

/** 点击上传入口 + 塞文件（MAIN world：要读 window.__npaDyInputs）
    2026-10-09 视频页实踩：视频页的文件口是页面加载就常驻的，点入口也不新建——
    所以「钩子新抓到的」优先，抓不到就退回页面现成的（accept 对得上的）那个口。 */
const NPA_DY_UPLOAD = function (args) {
  const { keys, isVideo } = args;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  /* 拟真点击（约定见文件头 5）；内联是注入约束决定的，别外提成公共函数 */
  const humanClick = async (el) => {
    const r = el.getBoundingClientRect();
    const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
    const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const sx = window.__npaMouse.x, sy = window.__npaMouse.y;
    const base = { bubbles: true, cancelable: true, composed: true, view: window };
    const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, last = i === steps;
      const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
      const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
      const under = document.elementFromPoint(x, y) || el;
      under.dispatchEvent(ev(PointerEvent, 'pointermove', x, y));
      under.dispatchEvent(ev(MouseEvent, 'mousemove', x, y));
      await sleep(15 + Math.random() * 40);
    }
    el.dispatchEvent(ev(PointerEvent, 'pointerover', tx, ty));
    el.dispatchEvent(ev(PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    el.dispatchEvent(ev(MouseEvent, 'mouseover', tx, ty));
    el.dispatchEvent(ev(MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    await sleep(90 + Math.random() * 160);
    el.dispatchEvent(ev(PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
    el.dispatchEvent(ev(MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
    await sleep(50 + Math.random() * 80);
    el.dispatchEvent(ev(PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
    window.__npaMouse = { x: tx, y: ty };
  };
  return (async () => {
    const w = window;
    if (!w.__npaDyHooked) return { ok: false, msg: '钩子没装上（注入顺序）' };
    /* 进页安顿（四十三改）：刚落页先停 2~6 秒、随便晃几步鼠标——磨掉「开页即动手」的节奏特征 */
    if (!w.__npaMouse) w.__npaMouse = { x: Math.random() * w.innerWidth, y: Math.random() * w.innerHeight };
    const settleUntil = Date.now() + 2000 + Math.random() * 4000;
    while (Date.now() < settleUntil) {
      const m = w.__npaMouse;
      m.x = Math.max(2, Math.min(w.innerWidth - 2, m.x + (Math.random() * 260 - 130)));
      m.y = Math.max(2, Math.min(w.innerHeight - 2, m.y + (Math.random() * 220 - 110)));
      const under = document.elementFromPoint(m.x, m.y);
      if (under) {
        const base = { bubbles: true, cancelable: true, composed: true, view: w };
        under.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: m.x, clientY: m.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base)));
        under.dispatchEvent(new MouseEvent('mousemove', Object.assign({ clientX: m.x, clientY: m.y }, base)));
      }
      await sleep(180 + Math.random() * 420);
    }
    const before = w.__npaDyInputs.length;
    const accOK = (i) => {
      const a = String(i.accept || '');
      return isVideo ? /video|mp4|mov|m4v|flv|avi/i.test(a) : /image|jpg|jpeg|png|webp/i.test(a);
    };
    /* 找上传入口：先「继续添加」/「上传」类按钮，再「点击上传/拖拽」短文案块（大容器文案长，不算） */
    const btn = [...document.querySelectorAll('button')].find(b => /^(继续添加|上传图片|上传视频|上传)$/.test((b.innerText || '').trim()) && vis(b))
      || [...document.querySelectorAll('div,span,label')].find(e => e.children.length <= 2 && (e.innerText || '').trim().length <= 60 && /点击上传|拖拽|上传图片|上传视频/.test((e.innerText || '').trim()) && vis(e));
    if (btn) await humanClick(btn);
    let inp = null;
    for (let i = 0; i < 12 && !inp; i++) {
      await sleep(250);
      const news = w.__npaDyInputs.slice(before).filter(x => x.type === 'file' && accOK(x));
      inp = news[news.length - 1]
        || [...document.querySelectorAll('input[type="file"]')].filter(accOK).pop()
        || null;
    }
    if (!inp) return { ok: false, msg: btn ? '点了上传区但没抓到文件口' : '上传口没找到（没入口、也没有现成文件口）' };

    const buf = w.__npaBuf || {};
    const dt = new DataTransfer();
    for (const k of (keys || [])) {
      const rec = buf[k];
      if (!rec || !rec.done) continue;
      const bin = atob(rec.parts.join(''));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const name = k.split('|')[1] || 'file';
      const mime = isVideo ? (/\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4') : (/\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg');
      dt.items.add(new File([arr], name, { type: mime }));
      delete buf[k];
    }
    if (!dt.files.length) return { ok: false, msg: '文件分片没攒齐' };
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));

    const needN = dt.files.length;
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      const t = document.body ? document.body.innerText : '';
      if (!isVideo) {
        const m = t.match(/已添加(\d+)张图片/);
        if (m && Number(m[1]) >= needN) return { ok: true, n: needN };
      } else {
        if (/作品封面|选择封面|封面/.test(t) && /地址|位置|发布/.test(t)) return { ok: true, n: 1 };
      }
    }
    return { ok: false, msg: '传了但没见上传完成' };
  })();
};

/** 填标题（20 字）+ 描述 + 话题芯片
    这台编辑器（ACE/editor-kit，data-slate-editor）自带模型层：execCommand 只改 DOM
    不改模型，打字 '#' 一触发 mention 插件按模型重渲，DOM 就被盖回去（验证通过只是假象）。
    正确通路＝React fiber 上挂着 ACE 实例（memoizedProps.editor）→ selection.selectAll()
    设模型全选 → 派发合成 paste（DataTransfer 带 text/plain + text/html 分段）→ 编辑器
    自己的粘贴通路在模型层整体替换。拿不到实例再退 DOM 老路（只当抢救，会带 warn）。
    另外这页挂载时（约 3.5s）会从服务端把草稿回灌进编辑器，回灌可能晚到、盖掉先填的字，
    所以：开填前等内容连续 2s 不动，替换完 2s 复核、被盖就重来，话题落完再终检。
    话题芯片走页面原生流程（已实测）：点「#添加话题」按钮（把 '#' 插进模型并真开下拉）→
    execCommand 打字（mention 会话激活时编辑器会把输入收进模型，建议列表跟着筛）→
    点 [class*="tag-hash-view-name"] 里和目标词匹配的条目 → 芯片落位（data-mention，模型级、稳）。
    （fiber 属性只在页面主世界可见——调用方必须用 MAIN world 注入。） */
const NPA_DY_FILL = function (args) {
  const { title, body, tags } = args;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** ACE 编辑器实例（fiber 链上 memoizedProps.editor，带 selection 模块） */
  const getAce = (el) => {
    try {
      const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      let f = fk ? el[fk] : null, steps = 0;
      while (f && steps < 12) {
        const pr = f.memoizedProps;
        if (pr && pr.editor && pr.editor.selection) return pr.editor;
        f = f.return; steps++;
      }
    } catch (_) {}
    return null;
  };
  /* 拟真点击（约定见文件头 5）；内联是注入约束决定的，别外提成公共函数 */
  const humanClick = async (el) => {
    const r = el.getBoundingClientRect();
    const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
    const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const sx = window.__npaMouse.x, sy = window.__npaMouse.y;
    const base = { bubbles: true, cancelable: true, composed: true, view: window };
    const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, last = i === steps;
      const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
      const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
      const under = document.elementFromPoint(x, y) || el;
      under.dispatchEvent(ev(PointerEvent, 'pointermove', x, y));
      under.dispatchEvent(ev(MouseEvent, 'mousemove', x, y));
      await sleep(15 + Math.random() * 40);
    }
    el.dispatchEvent(ev(PointerEvent, 'pointerover', tx, ty));
    el.dispatchEvent(ev(PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    el.dispatchEvent(ev(MouseEvent, 'mouseover', tx, ty));
    el.dispatchEvent(ev(MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    await sleep(90 + Math.random() * 160);
    el.dispatchEvent(ev(PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
    el.dispatchEvent(ev(MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
    await sleep(50 + Math.random() * 80);
    el.dispatchEvent(ev(PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
    window.__npaMouse = { x: tx, y: ty };
  };
  const clickAtCenter = async (el) => {   // 下拉条目：按矩形中心点 elementFromPoint 最里层，再拟真点击
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || el;
    await humanClick(t);
  };
  return (async () => {
    const warn = [];
    /* 标题 */
    const ti = [...document.querySelectorAll('input')].find(i => /标题/.test(i.placeholder || '') && vis(i));
    if (ti) {
      await humanClick(ti);
      await sleep(400 + Math.random() * 800);   // 点进停一拍（四十三改）
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(ti, String(title || '').slice(0, 30));
      ti.dispatchEvent(new Event('input', { bubbles: true }));
      ti.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500 + Math.random() * 1000);  // 落完停一拍再挪去描述（四十三改）
    } else warn.push('标题框没找到');

    /* 描述（zone-container）：先点击聚焦 → 全选 → 一次 insertText 整段（含 \n） */
    const eds = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => {
      const r = e.getBoundingClientRect();
      return vis(e) && r.width > 150 && r.height > 15;
    });
    eds.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const ed = eds[0];
    if (!ed) return { ok: false, msg: '描述框没找到', warn };
    await humanClick(ed);
    ed.focus();
    await sleep(400 + Math.random() * 800);   // 点进来停一拍（四十三改，原来 300 定值）
    const clean = (s) => String(s || '').replace(/[\u200b\n\r]/g, '');
    const want = clean(body);
    /* 草稿回灌可能还没落：先等内容连续 2s 不动（最多等 15s）再开填 */
    let prev = null, calm = 0;
    for (let i = 0; i < 30; i++) {
      const cur = clean(ed.textContent);
      if (cur === prev) { calm++; if (calm >= 4) break; } else { calm = 0; prev = cur; }
      await sleep(500);
    }
    /* 全选 + 一次替换；这台编辑器「对账打架」会吞插入，所以替换完必须核对——不对就再来。 */
    const setCaretEnd = () => {
      const rng = document.createRange();
      rng.selectNodeContents(ed);
      rng.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rng);
    };
    const ace = getAce(ed);
    if (!ace) warn.push('没摸到编辑器实例，按 DOM 替换试试（不保稳）');
    /* 主路：模型全选 + 合成 paste —— 编辑器自己的粘贴通路在模型层整体替换 */
    const pasteReplace = async () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', String(body || ''));
      dt.setData('text/html', String(body || '').split('\n').map(l => '<div>' + esc(l) + '</div>').join(''));
      try { ace.selection.selectAll(); } catch (_) {}
      await sleep(150);
      ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      await sleep(900);
      return clean(ed.textContent) === want;
    };
    const insertBody = async () => {
      if (ace && (await pasteReplace())) { setCaretEnd(); return true; }
      /* 退路：DOM 全选 + insertText（模型不认，只当抢救） */
      const sel = window.getSelection();
      const rng = document.createRange();
      rng.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(rng);
      await sleep(250);
      document.execCommand('insertText', false, String(body || ''));
      await sleep(1200);
      if (clean(ed.textContent) !== want) return false;
      setCaretEnd();   // 替换后光标会落在开头，话题要打在正文末尾，显式挪过去
      return true;
    };
    const typeTags = async () => {
      for (const tg of (tags || [])) {
        const word = String(tg).replace(/^#/, '');
        /* ① 点页面自带的「#添加话题」——它把 '#' 插进模型，并把 mention 下拉真开出来 */
        const btn = [...document.querySelectorAll('div,span,button,a')].find(e => {
          const t = (e.innerText || '').trim();
          return /^#?\s*添加话题$/.test(t) && e.children.length <= 3 && vis(e);
        });
        if (!btn) { warn.push('话题「' + tg + '」没找到「#添加话题」按钮，按纯文本留着了'); continue; }
        await humanClick(btn);
        /* ② 等下拉条目冒头 */
        let names = [];
        for (let i = 0; i < 20; i++) {
          await sleep(200);
          names = [...document.querySelectorAll('[class*="tag-hash-view-name"]')].filter(vis);
          if (names.length) break;
        }
        if (!names.length) { warn.push('话题「' + tg + '」下拉没出来，按纯文本留着了'); continue; }
        /* ③ 打字筛建议（会话激活时输入会进模型；建议列表实测跟着筛） */
        document.execCommand('insertText', false, word);
        /* ④ 等匹配条目：先精确、后包含（包含路多等 1.4s 让列表先筛完） */
        let hit = null;
        for (let i = 0; i < 15 && !hit; i++) {
          await sleep(200);
          const spans = [...document.querySelectorAll('[class*="tag-hash-view-name"]')].filter(vis);
          hit = spans.find(e => e.textContent.trim() === word) || null;
          if (!hit && i >= 7) hit = spans.find(e => e.textContent.includes(word)) || null;
        }
        if (!hit) { warn.push('话题「' + tg + '」下拉里没有，按纯文本留着了'); continue; }
        /* ⑤ 点中 → 芯片落位（data-mention） */
        await clickAtCenter(hit);
        await sleep(900);
      }
    };
    const squeeze = (s) => String(s || '').replace(/[\s\u200b]/g, '');
    const verifyAll = () => {
      const fin = squeeze(ed.textContent);
      return {
        body: fin.startsWith(squeeze(want)),
        tags: (tags || []).every(t => fin.includes(squeeze(String(t).replace(/^#/, '')))),
        fin,
      };
    };
    let okBody = false;
    for (let attempt = 0; attempt < 3 && !okBody; attempt++) okBody = await insertBody();
    if (!okBody) return { ok: false, msg: '描述没填利索（编辑器把插入吞了），框里现在是：' + clean(ed.textContent).slice(0, 40), warn };
    /* 静置复核：回灌/对账可能晚到，2s 后被动过就重插一遍 */
    await sleep(2000);
    if (clean(ed.textContent) !== want) {
      okBody = false;
      for (let attempt = 0; attempt < 3 && !okBody; attempt++) okBody = await insertBody();
      if (!okBody) return { ok: false, msg: '描述填完被页面盖了回去，重插没按住：' + clean(ed.textContent).slice(0, 40), warn };
      await sleep(1500);
      if (clean(ed.textContent) !== want) return { ok: false, msg: '描述反复被页面盖掉：' + clean(ed.textContent).slice(0, 40), warn };
    }

    await typeTags();
    /* 终检：话题落完静置 2s；正文被连根盖回去就整篇重填（含话题），两轮修不回就报错（绝不假装成功） */
    await sleep(2000);
    let v = verifyAll();
    if (!v.body) {
      let repaired = false;
      for (let a = 0; a < 2 && !repaired; a++) {
        okBody = false;
        for (let b = 0; b < 3 && !okBody; b++) okBody = await insertBody();
        if (!okBody) break;
        await sleep(1500);
        await typeTags();
        await sleep(2500);
        v = verifyAll();
        repaired = v.body;
      }
      if (!repaired) return { ok: false, msg: '描述被页面反复盖回去：' + v.fin.slice(0, 40), warn };
    }
    if (!v.tags) warn.push('话题没在描述里对上，回头过目时看一眼');
    return { ok: true, warn: warn };
  })();
};

/** 找（并可点）发布按钮 */
const NPA_DY_SEND = function (args) {
  const dry = !!(args && args.dry);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  /* 拟真点击（约定见文件头 5）；内联是注入约束决定的，别外提成公共函数 */
  const humanClick = async (el) => {
    const r = el.getBoundingClientRect();
    const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
    const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    const sx = window.__npaMouse.x, sy = window.__npaMouse.y;
    const base = { bubbles: true, cancelable: true, composed: true, view: window };
    const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, last = i === steps;
      const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
      const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
      const under = document.elementFromPoint(x, y) || el;
      under.dispatchEvent(ev(PointerEvent, 'pointermove', x, y));
      under.dispatchEvent(ev(MouseEvent, 'mousemove', x, y));
      await sleep(15 + Math.random() * 40);
    }
    el.dispatchEvent(ev(PointerEvent, 'pointerover', tx, ty));
    el.dispatchEvent(ev(PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    el.dispatchEvent(ev(MouseEvent, 'mouseover', tx, ty));
    el.dispatchEvent(ev(MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
    await sleep(90 + Math.random() * 160);
    el.dispatchEvent(ev(PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
    el.dispatchEvent(ev(MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
    await sleep(50 + Math.random() * 80);
    el.dispatchEvent(ev(PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
    el.dispatchEvent(ev(MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
    window.__npaMouse = { x: tx, y: ty };
  };
  return (async () => {
    const btns = [...document.querySelectorAll('button')].filter(b => /^(发布|发布并保存)$/.test((b.innerText || '').trim()) && vis(b));
    btns.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
    const btn = btns[0];
    if (!btn) return { ok: false, msg: '发布按钮没找到' };
    if (dry) return { ok: true, dry: true, text: (btn.innerText || '').trim(), disabled: !!btn.disabled };
    /* 整页下限（四十三改）：开页到点发布之间至少隔 60~90 秒 */
    const floorMs = 60000 + Math.random() * 30000;
    const past = performance.now();
    if (past < floorMs) await sleep(Math.min(floorMs - past, 95000));
    if (!window.__npaMouse) window.__npaMouse = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };
    /* 发布前凑近按钮旁挪几步再定住一拍（四十三改）：别「填完即发、直奔按钮」 */
    const preN = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < preN; i++) {
      const r = btn.getBoundingClientRect(), m = window.__npaMouse;
      const px = r.x + r.width / 2 + (Math.random() * 120 - 60), py = r.y + r.height / 2 + (Math.random() * 90 - 45);
      m.x = m.x + (px - m.x) * (i + 1) / preN + (Math.random() * 8 - 4);
      m.y = m.y + (py - m.y) * (i + 1) / preN + (Math.random() * 8 - 4);
      const under = document.elementFromPoint(m.x, m.y);
      if (under) {
        const base = { bubbles: true, cancelable: true, composed: true, view: window };
        under.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: m.x, clientY: m.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base)));
        under.dispatchEvent(new MouseEvent('mousemove', Object.assign({ clientX: m.x, clientY: m.y }, base)));
      }
      await sleep(120 + Math.random() * 260);
    }
    await sleep(1000 + Math.random() * 2000);   // 定住一拍再按（四十三改）
    await humanClick(btn);
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      /* 全文扫（吐司在 body 末尾，别截断） */
      const t = (document.body ? document.body.innerText : '');
      /* 平台弹手机验证码（2026-10-09 实测：点发布后触发「为确保是本人操作…」）——
         这是身份核验，留页给人工输码，不代过。 */
      if (/接收短信验证码/.test(t) || (/本人操作/.test(t) && /验证码/.test(t))) {
        return { ok: false, needVerify: true, msg: '要求手机验证码——验证框已弹出，请人工在页面输入（验证码发到账号绑定手机）' };
      }
      if (/发布成功|作品发布成功/.test(t)) { await sleep(2000 + Math.random() * 3000); return { ok: true, sent: true, url: location.href }; }
      if (/\/content\/manage/.test(location.href)) { await sleep(2000 + Math.random() * 3000); return { ok: true, sent: true, url: location.href }; }
      if (/发布失败|请检查/.test(t)) return { ok: false, msg: '页面报发布失败' };
    }
    return { ok: false, msg: '点了发布但 90 秒没见成功' };
  })();
};

/* ═══════════════ 🎥 视频号（channels.weixin.qq.com/platform/post/create） ═══════════════
   真表单在同源 iframe（/micro/content/post/create）里——主框架从 iframe.contentDocument 直取，
   全部动作只注主框架（world MAIN）。
   ⚠️ 别改回 allFrames / frameIds 找 frame：向「还在加载中」的 iframe 注脚本会永久吊死，
   连累之后所有跨帧注入（2026-10-09 实踩：整条发布链冻死在一个不返回的 exec 上）。
   input（antd）accept=video/*、常驻；描述 .input-editor；话题打字即转 span.hl.topic。 */

/** 表单出来了没：主文档里同源 iframe 的 contentDocument 中找编辑器/文件口 */
const NPA_CH_PROBE_FRAME = function () {
  const hit = (d) => { try { return !!(d && (d.querySelector('.input-editor, [class*="input-editor"]') || d.querySelector('input[type="file"][accept*="video"]'))); } catch (e) { return false; } };
  if (hit(document)) return { form: true, href: location.href, top: true };
  for (const f of document.querySelectorAll('iframe')) {
    let d = null;
    try { d = f.contentDocument; } catch (e) { continue; }
    if (hit(d)) return { form: true, href: String((d.location && d.location.href) || '').slice(0, 120) };
  }
  return { form: false, href: location.href };
};

/** 传视频（iframe 内：antd 常驻 input）
    就绪判定＝video 元素的 src 换新（空表单是「从没视频到有视频」，换发场景 src 必然变）。
    不能只看「有 video」——表单里已挂着旧视频时会假阳（2026-10-09 实踩）。 */
const NPA_CH_UPLOAD = function (args) {
  const { keys } = args;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const findDoc = () => {
    if (document.querySelector('input[type="file"][accept*="video"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('input[type="file"][accept*="video"]')) return d;
    }
    return null;
  };
  return (async () => {
    const doc = findDoc();
    if (!doc) return { ok: false, msg: '视频上传口没找到（表单还没出来）' };
    const W = doc.defaultView || window;
    const inp = doc.querySelector('input[type="file"][accept*="video"]');
    if (!inp) return { ok: false, msg: '视频上传口没找到' };
    /* 进页安顿（四十三改）：表单找到了先停 2~6 秒、随便晃几步鼠标——磨掉「开页即动手」的节奏特征 */
    if (!W.__npaMouse) W.__npaMouse = { x: Math.random() * W.innerWidth, y: Math.random() * W.innerHeight };
    const settleUntil = Date.now() + 2000 + Math.random() * 4000;
    while (Date.now() < settleUntil) {
      const m = W.__npaMouse;
      m.x = Math.max(2, Math.min(W.innerWidth - 2, m.x + (Math.random() * 260 - 130)));
      m.y = Math.max(2, Math.min(W.innerHeight - 2, m.y + (Math.random() * 220 - 110)));
      const under = doc.elementFromPoint(m.x, m.y);
      if (under) {
        const base = { bubbles: true, cancelable: true, composed: true, view: W };
        under.dispatchEvent(new W.PointerEvent('pointermove', Object.assign({ clientX: m.x, clientY: m.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base)));
        under.dispatchEvent(new W.MouseEvent('mousemove', Object.assign({ clientX: m.x, clientY: m.y }, base)));
      }
      await sleep(180 + Math.random() * 420);
    }
    const sig = (v) => (v ? String(v.currentSrc || v.src || '') : '');
    const before = sig(doc.querySelector('video'));
    const buf = window.__npaBuf || {};
    /* File/DataTransfer 用表单所在 document 的构造器，跨 realm 塞进 input.files 最稳 */
    const dt = new W.DataTransfer();
    for (const k of (keys || [])) {
      const rec = buf[k];
      if (!rec || !rec.done) continue;
      const bin = atob(rec.parts.join(''));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const name = k.split('|')[1] || 'file.mp4';
      dt.items.add(new W.File([arr], name, { type: /\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4' }));
      delete buf[k];
    }
    if (!dt.files.length) return { ok: false, msg: '文件分片没攒齐' };
    inp.files = dt.files;
    inp.dispatchEvent(new W.Event('change', { bubbles: true }));
    /* 等视频挂上：src 从无到有 / 从旧换新（最多 3 分钟） */
    for (let i = 0; i < 180; i++) {
      await sleep(1000);
      const cur = sig(doc.querySelector('video'));
      if (cur && cur !== before) return { ok: true, n: dt.files.length, src: cur.slice(0, 80) };
    }
    return { ok: false, msg: '传了但视频没挂上（src 没换新）' };
  })();
};

/** 填描述 + 话题 + （短标题若在）（表单在同源 iframe 的 contentDocument 里） */
const NPA_CH_FILL = function (args) {
  const { title, body, tags } = args;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const findDoc = () => {
    if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
    }
    return null;
  };
  return (async () => {
    const warn = [];
    const doc = findDoc();
    if (!doc) return { ok: false, msg: '描述框没找到（表单还没出来）', warn };
    const W = doc.defaultView || window;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    /* 拟真点击（约定见文件头 5）：事件用表单所在 document 的构造器发，页面监听才收得到；
       内联是注入约束决定的，别外提成公共函数 */
    const humanClick = async (el) => {
      const r = el.getBoundingClientRect();
      const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
      const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
      if (!W.__npaMouse) W.__npaMouse = { x: Math.random() * W.innerWidth, y: Math.random() * W.innerHeight };
      const sx = W.__npaMouse.x, sy = W.__npaMouse.y;
      const base = { bubbles: true, cancelable: true, composed: true, view: W };
      const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
      const steps = 3 + Math.floor(Math.random() * 4);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, last = i === steps;
        const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
        const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
        const under = doc.elementFromPoint(x, y) || el;
        under.dispatchEvent(ev(W.PointerEvent, 'pointermove', x, y));
        under.dispatchEvent(ev(W.MouseEvent, 'mousemove', x, y));
        await sleep(15 + Math.random() * 40);
      }
      el.dispatchEvent(ev(W.PointerEvent, 'pointerover', tx, ty));
      el.dispatchEvent(ev(W.PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
      el.dispatchEvent(ev(W.MouseEvent, 'mouseover', tx, ty));
      el.dispatchEvent(ev(W.MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
      await sleep(90 + Math.random() * 160);
      el.dispatchEvent(ev(W.PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
      el.dispatchEvent(ev(W.MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
      await sleep(50 + Math.random() * 80);
      el.dispatchEvent(ev(W.PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
      el.dispatchEvent(ev(W.MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
      el.dispatchEvent(ev(W.MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
      W.__npaMouse = { x: tx, y: ty };
    };
    /* 描述编辑器：contenteditable 是空属性，选择器用 [contenteditable] */
    const eds = [...doc.querySelectorAll('.input-editor, .input-editor [contenteditable], [contenteditable]')].filter(e => {
      const r = e.getBoundingClientRect();
      return vis(e) && r.width > 150 && r.height > 30;
    });
    eds.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const ed = eds[0];
    if (!ed) return { ok: false, msg: '描述框没找到', warn };
    await humanClick(ed);
    ed.focus();
    await sleep(400 + Math.random() * 800);   // 点进来停一拍（四十三改，原来 200 定值）
    try { doc.execCommand('selectAll'); doc.execCommand('delete'); } catch (e) {}
    await sleep(150);
    const put = (t) => { doc.execCommand('insertText', false, t); };
    const lines = String(body || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i) doc.execCommand('insertParagraph');
      put(lines[i]);
    }
    await sleep(200);
    /* 话题：这边打字就自动转芯片 */
    for (const tg of (tags || [])) {
      put(' ');
      put('#' + String(tg).replace(/^#/, '') + ' ');
      await sleep(250);
    }
    /* 短标题（有就填，没有不勉强）。这格校验会拦「特殊字符」（·—| 等中英标点都能触发
       「标题包含特殊字符」提示），只留汉字/字母/数字，其余符号换空格——免整单被卡。 */
    const ti = [...doc.querySelectorAll('input')].find(i => /短标题|标题/.test(i.placeholder || '') && vis(i));
    if (ti && title) {
      await humanClick(ti);
      await sleep(400 + Math.random() * 800);   // 点进停一拍（四十三改）
      const setter = Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value').set;
      const safeTitle = String(title).replace(/[^\u4e00-\u9fa5A-Za-z0-9 　]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
      setter.call(ti, safeTitle);
      ti.dispatchEvent(new W.Event('input', { bubbles: true }));
      ti.dispatchEvent(new W.Event('change', { bubbles: true }));
      ti.dispatchEvent(new W.Event('blur', { bubbles: true }));
    } else if (title) warn.push('短标题框没找到，标题并进描述头了');
    if (warn.length && title) {
      /* 兜底：标题并在描述开头 */
      await humanClick(ed);
      const sel = doc.getSelection();
      if (sel) { const rng = doc.createRange(); rng.selectNodeContents(ed); rng.collapse(true); sel.removeAllRanges(); sel.addRange(rng); }
      put(String(title) + '\n');
    }
    return { ok: true, warn: warn };
  })();
};

/** 找（并可点）「发表」按钮（表单在同源 iframe 的 contentDocument 里） */
const NPA_CH_SEND = function (args) {
  const dry = !!(args && args.dry);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const findDoc = () => {
    if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
    }
    return null;
  };
  return (async () => {
    const doc = findDoc();
    if (!doc) return { ok: false, msg: '表单还没出来（发表按钮找不到）' };
    const W = doc.defaultView || window;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    /* 拟真点击（约定见文件头 5）：事件用表单所在 document 的构造器发；内联是注入约束决定的 */
    const humanClick = async (el) => {
      const r = el.getBoundingClientRect();
      const tx = r.x + r.width / 2 + (r.width > 8 ? Math.random() * 4 - 2 : 0);
      const ty = r.y + r.height / 2 + (r.height > 8 ? Math.random() * 4 - 2 : 0);
      if (!W.__npaMouse) W.__npaMouse = { x: Math.random() * W.innerWidth, y: Math.random() * W.innerHeight };
      const sx = W.__npaMouse.x, sy = W.__npaMouse.y;
      const base = { bubbles: true, cancelable: true, composed: true, view: W };
      const ev = (C, t, x, y, o) => new C(t, Object.assign({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, o || {}));
      const steps = 3 + Math.floor(Math.random() * 4);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, last = i === steps;
        const x = last ? tx : sx + (tx - sx) * k + (Math.random() * 6 - 3);
        const y = last ? ty : sy + (ty - sy) * k + (Math.random() * 6 - 3);
        const under = doc.elementFromPoint(x, y) || el;
        under.dispatchEvent(ev(W.PointerEvent, 'pointermove', x, y));
        under.dispatchEvent(ev(W.MouseEvent, 'mousemove', x, y));
        await sleep(15 + Math.random() * 40);
      }
      el.dispatchEvent(ev(W.PointerEvent, 'pointerover', tx, ty));
      el.dispatchEvent(ev(W.PointerEvent, 'pointerenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
      el.dispatchEvent(ev(W.MouseEvent, 'mouseover', tx, ty));
      el.dispatchEvent(ev(W.MouseEvent, 'mouseenter', tx, ty, { bubbles: false, composed: false, cancelable: false }));
      await sleep(90 + Math.random() * 160);
      el.dispatchEvent(ev(W.PointerEvent, 'pointerdown', tx, ty, { button: 0, buttons: 1, pressure: 0.5 }));
      el.dispatchEvent(ev(W.MouseEvent, 'mousedown', tx, ty, { button: 0, buttons: 1 }));
      await sleep(50 + Math.random() * 80);
      el.dispatchEvent(ev(W.PointerEvent, 'pointerup', tx, ty, { button: 0, buttons: 0, pressure: 0 }));
      el.dispatchEvent(ev(W.MouseEvent, 'mouseup', tx, ty, { button: 0, buttons: 0 }));
      el.dispatchEvent(ev(W.MouseEvent, 'click', tx, ty, { button: 0, buttons: 0, detail: 1 }));
      W.__npaMouse = { x: tx, y: ty };
    };
    const btns = [...doc.querySelectorAll('button,div,span')].filter(e => {
      const t = (e.innerText || '').trim();
      if (t !== '发表' && t !== '发布') return false;
      if (e.children.length > 2) return false;
      return vis(e);
    });
    /* 真按钮优先：weui 把 <button> 包在 .weui-desktop-popover__wrp 里，包装层 innerText 同样是「发表」——
       点在包装层上事件只向上冒泡、到不了按钮里（2026-10-09 实踩：run3 就是点错这层才「点了没反应」）。
       再取最靠下的（排除页首导航）。 */
    btns.sort((a, b) => {
      const ba = a.tagName === 'BUTTON' ? 1 : 0, bb = b.tagName === 'BUTTON' ? 1 : 0;
      if (ba !== bb) return bb - ba;
      return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
    });
    const btn = btns[0];
    if (!btn) return { ok: false, msg: '发表按钮没找到' };
    /* 禁用态在 class 上（weui-desktop-btn_disabled），不是 disabled 属性 */
    const isOff = () => !!(btn.disabled || /_disabled/.test(String(btn.className || '')) || btn.getAttribute('aria-disabled') === 'true');
    if (dry) return { ok: true, dry: true, text: (btn.innerText || '').trim(), disabled: isOff() };
    /* 视频还在处理时按钮是灰的——等它亮（最多 2 分钟） */
    for (let i = 0; i < 120 && isOff(); i++) await sleep(1000);
    if (isOff()) return { ok: false, msg: '发表按钮一直灰着（视频可能还在处理）' };
    /* 整页下限（四十三改）：开页到点发布之间至少隔 60~90 秒 */
    const floorMs = 60000 + Math.random() * 30000;
    const past = performance.now();
    if (past < floorMs) await sleep(Math.min(floorMs - past, 95000));
    if (!W.__npaMouse) W.__npaMouse = { x: Math.random() * W.innerWidth, y: Math.random() * W.innerHeight };
    /* 发布前凑近按钮旁挪几步再定住一拍（四十三改）：别「填完即发、直奔按钮」 */
    const preN = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < preN; i++) {
      const r = btn.getBoundingClientRect(), m = W.__npaMouse;
      const px = r.x + r.width / 2 + (Math.random() * 120 - 60), py = r.y + r.height / 2 + (Math.random() * 90 - 45);
      m.x = m.x + (px - m.x) * (i + 1) / preN + (Math.random() * 8 - 4);
      m.y = m.y + (py - m.y) * (i + 1) / preN + (Math.random() * 8 - 4);
      const under = doc.elementFromPoint(m.x, m.y);
      if (under) {
        const base = { bubbles: true, cancelable: true, composed: true, view: W };
        under.dispatchEvent(new W.PointerEvent('pointermove', Object.assign({ clientX: m.x, clientY: m.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base)));
        under.dispatchEvent(new W.MouseEvent('mousemove', Object.assign({ clientX: m.x, clientY: m.y }, base)));
      }
      await sleep(120 + Math.random() * 260);
    }
    await sleep(1000 + Math.random() * 2000);   // 定住一拍再按（四十三改）
    await humanClick(btn);
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      /* 全文扫（别截断——吐司挂在 body 末尾，截前 4000 字会漏） */
      const t = (doc.body ? doc.body.innerText : '') + ' ' + (document.body ? document.body.innerText : '');
      if (/发表成功|发布成功|已发表/.test(t)) { await sleep(2000 + Math.random() * 3000); return { ok: true, sent: true, url: location.href }; }
      if (/\/platform\/post\/list|\/platform\/post\/created/.test(location.href)) { await sleep(2000 + Math.random() * 3000); return { ok: true, sent: true, url: location.href }; }
      if (/发表失败|发布失败|错误/.test(t)) return { ok: false, msg: '页面报发表失败' };
    }
    return { ok: false, msg: '点了发表但 90 秒没见成功' };
  })();
};
