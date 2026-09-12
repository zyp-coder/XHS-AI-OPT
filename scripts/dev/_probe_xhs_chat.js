// _probe_xhs_chat.js - 小红书 消息中心(/chat) DOM 勘探（阶段0 · 第二版：精准定位会话项 + 进 iframe 找聊天窗）
// 用途: ①确认会话项结构 + 能否拿到 partner 的 userId（用于对到获客清单）
//      ②打开会话后：输入框/发送按钮在顶层还是 iframe ③是否出现会话专属 URL / channel_id
// 用法:
//   1. 浏览器打开小红书网页版并登录，进入消息中心 https://www.xiaohongshu.com/chat
//   2. F12 → Console → 粘贴本文件 → 回车（会被 Chrome 要求先输入「允许粘贴」）
//   3. 脚本直接精准点击【第一条真实会话】(div.xhs-im-conv-item)，仅打开，绝不发送
//   4. 约 3.5 秒后自动输出 Part B；若没点开，手动点一条再运行 __probeChatPartB()
//   5. 把整段报告复制回来（尤其关注 [A3b] 会话项原始HTML、[B7] partner id、[B1] 是否出现 channel_id）
(() => {
  'use strict';

  const out = [];
  const log = (s) => out.push(s);
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

  function briefPath(el) {
    let p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) p += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return p;
  }
  function ctxPath(el, depth = 3) {
    const parts = []; let cur = el;
    for (let i = 0; i < depth && cur; i++) { parts.unshift(briefPath(cur)); cur = cur.parentElement; }
    return parts.join(' < ');
  }
  function isVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

  // 收集顶层 + 所有同源 iframe 的文档，便于统一搜索输入框等（聊天窗可能在 iframe 里）
  function docs() {
    const d = [document];
    document.querySelectorAll('iframe').forEach((f) => { try { if (f.contentDocument) d.push(f.contentDocument); } catch (_) {} });
    return d;
  }

  window.__probeChatPartA = function () {
    out.length = 0;
    log('===== [A1] 页面信息 =====');
    log('URL: ' + location.href);
    log('Title: ' + document.title);
    log('在消息中心(/chat)? ' + (/\/chat|\/im\//i.test(location.href) ? '是' : '否'));

    log('');
    log('===== [A2] 登录态 =====');
    const l = [...document.querySelectorAll('button,a,div,span')].filter((el) => { const t = (el.innerText || '').trim(); return /登录|立即登录|扫码登录/.test(t) && isVisible(el) && el.children.length === 0; });
    log(l.length ? '⚠️ 可能未登录' : '✓ 已登录');

    // ★ 直接取真实会话项（div.xhs-im-conv-item），不走通用评分（避免点错到顶部导航）
    let convs = [...document.querySelectorAll('div.xhs-im-conv-item')].filter(isVisible);
    log('');
    log('===== [A3] 真实会话项 (div.xhs-im-conv-item) =====');
    log('找到 ' + convs.length + ' 条可见会话');
    if (convs.length === 0) {
      log('没找到 .xhs-im-conv-item；改用遍历兜底：');
      docs().forEach((doc, di) => {
        [...doc.querySelectorAll('a,li,[role="button"]')].filter((e) => isVisible(e) && e.children.length > 1).slice(0, 40).forEach((el) => {
          const t = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
          if (t) log('  [' + di + '] ' + esc(t) + ' ' + briefPath(el));
        });
      });
    } else {
      const first = convs[0];
      convs.slice(0, 6).forEach((el, i) => {
        const nameEl = el.querySelector('.xhs-im-conv-item__content .xhs-im-conv-item__name, .xhs-im-conv-item__content > *') || el;
        const bottom = el.querySelector('.xhs-im-conv-item__bottom');
        // 头像 img（可能带 id/alt 线索）
        const img = el.querySelector('img');
        log(`[${i}] 名="${esc(el.innerText).slice(0, 24)}" | img.src="${(img && img.src || '').slice(0, 60)}" | img.alt="${esc(img && img.alt)}"`);
      });
      // dump 第一条会话项的原始 HTML（看有没有 data-* / id 线索）
      log('');
      log('===== [A3b] 第一条会话项 outerHTML（截断） =====');
      const h = first.outerHTML;
      log(h.length > 1500 ? h.slice(0, 1500) + ' …<truncated>' : h);

      log('');
      log('===== [A4] 精准点开第一条会话 =====');
      log('点击: ' + briefPath(first));
      try { first.click(); log('✓ 已点击，等待 3.5 秒渲染聊天窗...'); setTimeout(() => __probeChatPartB(), 3500); }
      catch (e) { log('✗ 点击异常: ' + e.message); }
    }
    console.log(out.join('\n'));
    console.log('若未自动点开，请手动点一条会话后运行 __probeChatPartB()');
  };

  window.__probeChatPartB = function () {
    log('');
    log('===== [B1] 当前状态 / 是否出现会话专属URL或channel_id =====');
    log('顶层URL: ' + location.href);
    log('顶层在 /chat/子路径? ' + (/\/chat\/|\/im\//i.test(location.href) ? '是' : '否'));
    log('URL query 参数 channel_id: ' + (new URLSearchParams(location.search).get('channel_id') || '(空)'));
    log('URL query 参数 channel_type: ' + (new URLSearchParams(location.search).get('channel_type') || '(空)'));
    [...document.querySelectorAll('iframe')].forEach((f, i) => {
      if (isVisible(f) && f.src) { log(`iframe[${i}] src=${(f.src || '').slice(0, 200)}`); try { const q = new URLSearchParams(new URL(f.src).search); log(`        iframe channel_id=${q.get('channel_id') || '(空)'}`); } catch (_) {} }
    });

    log('');
    log('===== [B7] 已开会话的伙伴 userId（aim: 聊天头部/头像里的 /user/ 链接或 id） =====');
    docs().forEach((doc, di) => {
      const ua = doc.querySelectorAll('a[href*="/user/"]');
      if (ua.length) {
        const seen = new Set();
        ua.forEach((a) => { const h = a.getAttribute('href') || ''; const m = h.match(/\/user\/(?:profile\/)?([a-zA-Z0-9_-]+)/); const k = m ? m[1] : h; if (!seen.has(k)) { seen.add(k); log(`  doc[${di}] /user/ 链接: ${h.slice(0, 60)}`); } });
      } else {
        log(`  doc[${di}] 未发现 /user/ 链接`);
      }
    });

    log('');
    log('===== [B2] iframe 检测 =====');
    const frames = [...document.querySelectorAll('iframe')];
    if (!frames.length) log('无 iframe');
    else frames.forEach((f, i) => log(`[${i}] src=${(f.src || '').slice(0, 180)} | ${f.clientWidth}x${f.clientHeight} | 可见=${isVisible(f)} doc=${f.contentDocument ? '可访问' : '跨域'}`));

    log('');
    log('===== [B3] 输入框（顶层+iframe） =====');
    let foundInput = false;
    docs().forEach((doc, di) => {
      const ins = [...doc.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"], input[type="text"], input:not([type])')].filter(isVisible);
      if (ins.length) { foundInput = true; ins.slice(0, 6).forEach((el, i) => { const ph = el.getAttribute('placeholder') || ''; log(`  doc[${di}][${i}] ${briefPath(el)}<${el.tagName}${el.getAttribute('contenteditable') ? '/ce' : ''}> ph="${esc(ph)}" | ${ctxPath(el, 3)}`); }); }
      else if (di === 0) log('  顶层未发现输入框');
    });
    if (!foundInput) log('❌ 顶层+iframe 都未发现可见输入框（会话没开出来，或聊天窗结构特殊）');

    log('');
    log('===== [B4] 发送按钮（顶层+iframe） =====');
    docs().forEach((doc, di) => {
      const s = [...doc.querySelectorAll('button, [role="button"], [class*="send" i], svg')]
        .filter((el) => { const t = (el.innerText || '').trim(); const c = String(el.className || ''); const aria = el.getAttribute('aria-label') || ''; const svg = el.tagName === 'svg' ? (el.querySelector('title')?.textContent || '') : ''; return isVisible(el) && (t === '发送' || aria.includes('发送') || svg.includes('发送') || /send|发送/i.test(c)); })
        .slice(0, 6);
      if (s.length) s.forEach((el, i) => log(`  doc[${di}][btn${i}] ${briefPath(el)} "${esc(el.innerText)}" | ${ctxPath(el, 2)}`));
      else if (di === 0) log('  顶层未发现发送按钮');
    });

    log('');
    log('===== [B5] 限制/提示文案 =====');
    const re = /(关注后才能|关注后即可|无法发送|不能发送|私信限制|被限制|防骚扰|开启私信|暂不支持)/;
    docs().forEach((doc, di) => {
      [...doc.querySelectorAll('div,span,p,section')].filter((el) => { const t = (el.innerText || '').trim(); return isVisible(el) && t.length >= 4 && t.length <= 60 && re.test(t) && el.children.length === 0; }).slice(0, 5).forEach((el) => log(`  doc[${di}] ⚠️ "${esc(el.innerText)}" | ${ctxPath(el, 3)}`));
    });

    log('');
    log('===== 完成 =====');
    log('重点回复我：①[B7] 里有没有 partner 的 /user/ 链接/ID？②[B1] 打开会话后 channel_id 或 iframe src 变没变？③[B3]/[B4] 输入框/发送按钮在哪层。');
    console.log(out.join('\n'));
  };

  console.log('===== 消息中心(/chat) 勘探 v2：（只读 + 点开一条会话，绝不发送）=====');
  __probeChatPartA();
})();