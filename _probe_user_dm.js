// _probe_user_dm.js - 小红书用户主页「私信」入口 + 聊天窗 DOM 勘探（阶段0）
// 用途: 验证网页版私信可行性：①主页私信按钮存在性 ②聊天窗输入框/发送按钮结构 ③陌生人私信限制提示
// 用法:
//   1. 浏览器打开小红书网页版并登录，进入【任意一个非自己】的用户主页
//      （从某篇笔记评论区点作者头像/昵称即可进入）
//   2. F12 → Console 标签 → 把本文件全部内容粘贴进去 → 回车
//   3. 脚本会自动检测并【点击一次「私信」按钮】（仅打开聊天窗，不会发送任何消息）
//   4. 若自动点击后聊天窗没出现，请手动点「私信」，再在控制台输入 __probePartB() 回车
//   5. 把输出的报告整段复制回来
(() => {
  'use strict';

  const out = [];
  const log = (s) => out.push(s);
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

  // 元素简写路径
  function briefPath(el) {
    let p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) {
      p += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return p;
  }

  // 向上找有 class 的祖先
  function ctxPath(el, depth = 3) {
    const parts = [];
    let cur = el;
    for (let i = 0; i < depth && cur; i++) {
      parts.unshift(briefPath(cur));
      cur = cur.parentElement;
    }
    return parts.join(' < ');
  }

  // 元素是否可见
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // ============ Part A: 主页检测 + 自动点击私信 ============
  window.__probePartA = function () {
    out.length = 0;
    log('===== [A1] 页面信息 =====');
    log('URL: ' + location.href);
    log('Title: ' + document.title);
    log('ReadyState: ' + document.readyState);
    log('视口: ' + window.innerWidth + 'x' + window.innerHeight);

    // 登录态粗判：页面是否含"登录"按钮（未登录通常有）
    log('');
    log('===== [A2] 登录态粗判 =====');
    const loginBtns = [...document.querySelectorAll('button,a,div,span')]
      .filter((el) => {
        const t = (el.innerText || '').trim();
        return (t === '登录' || t === '立即登录' || t === '扫码登录') && isVisible(el) && el.children.length === 0;
      })
      .slice(0, 3);
    log(loginBtns.length > 0 ? '⚠️ 检测到「登录」按钮，可能未登录（私信按钮通常只有登录后才显示）' : '✓ 未发现登录按钮，大概率已登录');

    // 私信按钮候选
    log('');
    log('===== [A3] 「私信」按钮候选（按优先级） =====');
    const allCandidates = [...document.querySelectorAll('button,a,div,span,[role="button"]')].filter((el) => {
      const t = (el.innerText || '').trim();
      const c = String(el.className || '');
      const aria = (el.getAttribute('aria-label') || '');
      const hitText = t === '私信' || t.startsWith('私信');
      const hitCls = /(^|_)(send|chat|message|dm|im)(_|$)/i.test(c) || /send|chat|message/i.test(c);
      const hitAria = aria.includes('私信');
      return (hitText || hitCls || hitAria) && isVisible(el);
    });
    // 去重：优先 button/a/role=button，文本精确"私信"
    const scored = allCandidates
      .map((el) => {
        const t = (el.innerText || '').trim();
        const tag = el.tagName.toLowerCase();
        let score = 0;
        if (t === '私信') score += 10;
        if (t.startsWith('私信')) score += 5;
        if (tag === 'button' || tag === 'a') score += 4;
        if (el.getAttribute('role') === 'button') score += 2;
        if (el.children.length === 0) score += 1;
        return { el, score, t, tag };
      })
      .sort((a, b) => b.score - a.score);

    const shown = scored.slice(0, 8);
    if (shown.length === 0) {
      log('❌ 未找到「私信」按钮！');
      // 兜底：列出主页上所有可见按钮文本，方便判断页面结构
      log('---- 主页可见按钮/链接文本清单（兜底诊断） ----');
      const btns = [...document.querySelectorAll('button,a,[role="button"]')]
        .filter((el) => isVisible(el))
        .map((el) => ({ t: (el.innerText || '').trim().slice(0, 20), p: briefPath(el) }))
        .filter((x) => x.t.length > 0);
      const uniq = [];
      const seen = new Set();
      for (const b of btns) {
        const k = b.t;
        if (!seen.has(k)) { seen.add(k); uniq.push(b); }
      }
      uniq.slice(0, 25).forEach((b) => log(`  [${esc(b.t)}] ${b.p}`));
      log('');
      log('>>> 若上面有「关注/已关注」但无「私信」，可能是：①未登录 ②该用户关闭了私信入口 ③新版页面改版。');
      log('>>> 请截图主页给我（或把上面按钮清单贴回）。');
    } else {
      shown.forEach((s, i) => {
        log(`[${i}] <${s.tag}> "${esc(s.t)}" | 得分${s.score} | ${briefPath(s.el)} | 位置: ${ctxPath(s.el, 3)}`);
      });
      // 自动点击得分最高的
      const best = shown[0];
      log('');
      log('===== [A4] 自动点击私信按钮（仅打开聊天窗，不发送消息） =====');
      log(`点击目标: <${best.tag}> "${esc(best.t)}" @ ${briefPath(best.el)}`);
      try {
        best.el.click();
        log('✓ 已点击，等待 3.5 秒让聊天窗渲染...');
        setTimeout(() => {
          __probePartB();
        }, 3500);
      } catch (e) {
        log('✗ 点击异常: ' + e.message);
      }
    }
    console.log(out.join('\n'));
    console.log('===== 请等待 3.5 秒，Part B 会自动输出聊天窗检测结果 =====');
  };

  // ============ Part B: 聊天窗检测（自动点击后或手动点完私信后运行） ============
  window.__probePartB = function () {
    log('');
    log('===== [B1] 当前状态 =====');
    log('URL: ' + location.href);
    log('页面是否跳转: ' + (location.href !== window.__probeDmUrl ? '是（可能跳去了消息页）' : '否（聊天窗应在本页弹层内）'));

    // iframe 检测（聊天窗可能是 iframe）
    log('');
    log('===== [B2] iframe 检测 =====');
    const frames = [...document.querySelectorAll('iframe')];
    if (frames.length === 0) {
      log('无 iframe（聊天窗应直接在主页文档里）');
    } else {
      frames.forEach((f, i) => {
        log(`[${i}] src=${(f.src || '').slice(0, 180)} | 尺寸=${f.clientWidth}x${f.clientHeight} | 可见=${isVisible(f)}`);
      });
    }

    // 输入框检测
    log('');
    log('===== [B3] 输入框检测（聊天窗内容输入区） =====');
    const inputs = [
      ...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"], input[type="text"], input:not([type])'),
    ].filter((el) => isVisible(el));
    if (inputs.length === 0) {
      log('❌ 未发现可见输入框');
      // 诊断：列出最近 5 秒新增/变化的容器（聊天窗通常是新渲染的）
      log('---- 全部输入框（含不可见）: ' + document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]').length + ' 个 ----');
    } else {
      inputs.slice(0, 8).forEach((el, i) => {
        const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
        const ce = el.getAttribute('contenteditable');
        log(`[${i}] ${briefPath(el)} | 类型=${el.tagName}${ce ? '/contenteditable' : ''} | placeholder="${esc(ph)}" | ${ctxPath(el, 3)}`);
      });
    }

    // 发送按钮检测
    log('');
    log('===== [B4] 发送按钮检测 =====');
    const sendBtns = [...document.querySelectorAll('button, [role="button"], [class*="send" i], [class*="btn" i], svg')]
      .filter((el) => {
        const t = (el.innerText || '').trim();
        const c = String(el.className || '');
        const aria = el.getAttribute('aria-label') || '';
        const svgTitle = el.tagName === 'svg' ? (el.querySelector('title')?.textContent || '') : '';
        return isVisible(el) && (t === '发送' || aria.includes('发送') || svgTitle.includes('发送') || /send|发送/i.test(c));
      })
      .slice(0, 8);
    if (sendBtns.length === 0) {
      log('未发现明显的发送按钮（可能输入框在但发送按钮样式特殊，见下方候选）');
      const near = [...document.querySelectorAll('button,[role="button"]')].filter(isVisible).slice(0, 10);
      near.forEach((el) => log(`  候选按钮: "${esc((el.innerText || '').trim().slice(0, 12))}" | ${briefPath(el)}`));
    } else {
      sendBtns.forEach((el, i) => {
        log(`[btn${i}] ${briefPath(el)} | 文本="${esc(el.innerText)}" | ${ctxPath(el, 2)}`);
      });
    }

    // 限制/提示文案检测（陌生人私信限制）
    log('');
    log('===== [B5] 限制提示检测 =====');
    const limitRe = /(关注后才能|关注后即可|无法发送|不能发送|私信限制|对方.*关注|发送失败|被限制|防骚扰|开启私信|暂不支持)/;
    const limitHits = [...document.querySelectorAll('div,span,p,section')]
      .filter((el) => {
        const t = (el.innerText || '').trim();
        return isVisible(el) && t.length >= 4 && t.length <= 60 && limitRe.test(t) && el.children.length === 0;
      })
      .slice(0, 8);
    if (limitHits.length === 0) {
      log('未发现明显的限制提示文案');
    } else {
      limitHits.forEach((el) => {
        log(`⚠️ "${esc(el.innerText)}" | ${ctxPath(el, 3)}`);
      });
    }

    // 聊天窗整体容器判断：文本量最大的新容器
    log('');
    log('===== [B6] 聊天窗容器推断（文本量 Top 5 容器） =====');
    const all = [...document.querySelectorAll('div,section,main')];
    const scored = all
      .map((el) => ({ el, len: (el.innerText || '').trim().length, children: el.children.length }))
      .filter((x) => x.len > 30 && x.len < 5000 && x.children > 2)
      .sort((a, b) => b.len - a.len)
      .slice(0, 5);
    scored.forEach((s, i) => {
      log(`[${i}] ${briefPath(s.el)} | 文本${s.len}字 子项${s.children} | 位置: ${ctxPath(s.el, 2)} | 预览: "${esc(s.el.innerText).slice(0, 60)}"`);
    });

    log('');
    log('===== Part B 完成 =====');
    log('>>> 请把从 [A1] 开始的整段报告复制回来；若自动点击失败，请手动点「私信」后运行 __probePartB()');
    console.log(out.join('\n'));
  };

  // 记录点击前的 URL（判断是否跳转）
  window.__probeDmUrl = location.href;

  // 启动 Part A
  console.log('===== 开始勘探用户主页私信入口（只读 + 自动点击一次「私信」按钮，不发送消息） =====');
  __probePartA();
})();
