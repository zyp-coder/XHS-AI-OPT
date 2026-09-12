// _probe_im.js - 小红书通知页(私信) DOM 勘探脚本（只读，不修改页面）
// 用法:
//   1. 在浏览器打开 https://www.xiaohongshu.com/notification
//   2. 按 F12 打开开发者工具 → Console 标签
//   3. 把本文件全部内容粘贴进 Console，按回车
//   4. 把输出的报告整段复制回来给我
(() => {
  'use strict';

  const out = [];
  const log = (s) => out.push(s);
  const esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);

  // 生成元素简写路径
  function briefPath(el) {
    let p = el.tagName.toLowerCase();
    if (el.id) p += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) {
      p += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return p;
  }

  // 向上找有 class 的祖先，辅助判断层级
  function ctxPath(el, depth = 3) {
    const parts = [];
    let cur = el;
    for (let i = 0; i < depth && cur; i++) {
      parts.unshift(briefPath(cur));
      cur = cur.parentElement;
    }
    return parts.join(' < ');
  }

  try {
    // ============ [1] 页面信息 ============
    log('===== [1] 页面信息 =====');
    log('URL: ' + location.href);
    log('Title: ' + document.title);
    log('ReadyState: ' + document.readyState);
    log('视口: ' + window.innerWidth + 'x' + window.innerHeight);

    // ============ [2] iframe 检测 ============
    log('');
    log('===== [2] iframe 检测 =====');
    const frames = [...document.querySelectorAll('iframe')];
    if (frames.length === 0) {
      log('无 iframe（消息直接在主页文档里）');
    } else {
      frames.forEach((f, i) => {
        log(`[${i}] src=${(f.src || '').slice(0, 200)} | 尺寸=${f.clientWidth}x${f.clientHeight}`);
      });
    }

    // ============ [3] 候选消息容器 ============
    log('');
    log('===== [3] 候选消息容器（按文本量 Top 10）=====');
    const all = [...document.querySelectorAll('div,section,main,ul')];
    const scored = all
      .map((el) => {
        const text = (el.innerText || '').trim();
        return { el, len: text.length, children: el.children.length, text: text.slice(0, 80) };
      })
      .filter((x) => x.len > 20)
      .sort((a, b) => b.len - a.len)
      .slice(0, 10);
    scored.forEach((s, i) => {
      log(`[${i}] ${briefPath(s.el)} | 文本${s.len}字 子项${s.children} | "${s.text}"`);
    });

    // ============ [4] 时间戳样本 ============
    log('');
    log('===== [4] 时间戳样本 =====');
    const timeRe = /(\d{1,2}:\d{2}|昨天|前天|\d+分钟前|\d+小时前|今天|\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2})/;
    const timeNodes = [...document.querySelectorAll('span,time,div')]
      .filter((el) => {
        const t = (el.innerText || '').trim();
        return t.length <= 30 && timeRe.test(t) && el.children.length === 0;
      })
      .slice(0, 15);
    timeNodes.forEach((el) => {
      log(`${briefPath(el)} | "${esc(el.innerText)}" | 位置: ${ctxPath(el, 2)}`);
    });

    // ============ [5] 输入框/发送按钮检测 ============
    log('');
    log('===== [5] 输入框 / 发送按钮检测 =====');
    const inputs = [
      ...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"], input[type="text"], input:not([type])'),
    ];
    if (inputs.length === 0) {
      log('未发现输入框（可能不在私信详情页，或输入框未渲染）');
    } else {
      inputs.forEach((el, i) => {
        log(`[${i}] ${briefPath(el)} | placeholder="${esc(el.getAttribute('placeholder'))}" | 可见=${!!(el.offsetWidth || el.offsetHeight)}`);
      });
    }
    const sendBtns = [...document.querySelectorAll('button, [role="button"], [class*="send" i], [class*="btn" i]')]
      .filter((el) => {
        const t = (el.innerText || '').trim();
        const c = String(el.className || '');
        return (t === '发送' || t === 'Send' || /send/i.test(c)) && (el.offsetWidth || el.offsetHeight);
      })
      .slice(0, 8);
    sendBtns.forEach((el, i) => {
      log(`[btn${i}] ${briefPath(el)} | 文本="${esc(el.innerText)}" | ${ctxPath(el, 2)}`);
    });

    // ============ [6] 消息项结构抽样 ============
    log('');
    log('===== [6] 最大容器消息项抽样（前3+后3）=====');
    const top = scored[0] && scored[0].el;
    if (top) {
      const items = [...top.children].filter((c) => (c.innerText || '').trim().length > 0);
      log(`容器: ${briefPath(top)}，直接子项 ${top.children.length} 个（含文本 ${items.length} 个）`);
      const sample = [...items.slice(0, 3), ...items.slice(-3)];
      sample.forEach((item, i) => {
        const t = (item.innerText || '').trim();
        const img = item.querySelector('img');
        log(`--- 子项#${i} ---`);
        log(`路径: ${ctxPath(item, 4)}`);
        log(`文本(${t.length}字): ${esc(t.slice(0, 200))}`);
        log(`头像: ${img ? (img.src || '').slice(0, 120) : '无'} | 子元素数: ${item.querySelectorAll('*').length}`);
        // 左侧/右侧分布（推断自己/对方）
        const r = item.getBoundingClientRect();
        log(`位置: left=${Math.round(r.left)} right=${Math.round(r.right)} width=${Math.round(r.width)}`);
      });
    }

    // ============ [7] 头像/昵称检测 ============
    log('');
    log('===== [7] 用户头像/昵称样本 =====');
    const avatars = [...document.querySelectorAll('img')].filter((img) => {
      const src = img.src || '';
      return /avatar|user|sns-avatar|pic/i.test(src) && img.offsetWidth > 0;
    }).slice(0, 8);
    avatars.forEach((img, i) => {
      log(`[${i}] ${img.src.slice(0, 120)} | ${img.offsetWidth}x${img.offsetHeight}`);
    });
    const nickEls = [...document.querySelectorAll('span,a')]
      .filter((el) => {
        const t = (el.innerText || '').trim();
        return t.length >= 2 && t.length <= 20 && el.children.length === 0;
      })
      .slice(0, 12);
    nickEls.forEach((el) => {
      log(`昵称候选: "${esc(el.innerText)}" | ${ctxPath(el, 2)}`);
    });

    // ============ [8] 滚动加载观察 ============
    log('');
    log('===== [8] 滚动加载观察 =====');
    const scrollers = [...document.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 200;
    }).slice(0, 5);
    if (scrollers.length === 0) {
      log('未发现独立滚动容器（可能整个页面滚动）');
    } else {
      scrollers.forEach((el) => {
        log(`${briefPath(el)} | 内容${el.scrollHeight}px / 可视${el.clientHeight}px | ${ctxPath(el, 2)}`);
      });
    }
  } catch (e) {
    log('勘探异常: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  }

  const report = out.join('\n');
  console.log(report);
  console.log('===== 勘探完成，请把以上报告整段复制给我 =====');
})();
