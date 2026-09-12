// _probe_dm_v3.js - 小红书私聊勘探 v3（合并一轮跑完，只读，绝不全自动发送消息）
// 目的：判定"能不能自动给陌生人发私信"。
//   过去结论：能进主页、点不了主页「私信」按钮 → 自动私聊搁浅。
//   这轮重点验证唯一希望：**不点按钮，直接用 userId 打开 /chat/{userId} 是否就能到私信窗**。
// 用法（真机、已登录小红书网页版）：
//   1) 进入【任意一个非自己】的用户主页（从解析到过的评论点作者头像进入）
//   2) F12 → Console → 粘贴本文件 → 回车（会提示"允许粘贴"）
//   3) 在主页运行： __dmprobeProfile()
//       → 报告 A：私信按钮能不能点到、点开后的聊天地址长啥样
//   4) 把报告里/或用 __DM_UID='xxx' 设好对方 userId，运行：
//          __dmprobeTryUser()       // 在新标签页打开 /chat/{userId}，验证能否绕开按钮
//   5) 在刚打开的那个 /chat 页面里运行： __dmprobeChatSend()
//       → 报告 C：有无输入框/发送按钮，能不能发
//   6) 把三段报告整段复制回给我。
(async () => {
  'use strict';
  const _out = [];
  const _log = (s) => _out.push(s);
  const _esc = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const _isVis = (el) => { try { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (_) { return false; } };
  const _brief = (el) => { let p = (el && el.tagName || '').toLowerCase(); if (!p) return '(?)'; if (el.id) p += '#' + el.id; else if (typeof el.className === 'string' && el.className.trim()) p += '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.'); return p; };
  const _ctx = (el, d = 3) => { const a = []; let c = el; for (let i = 0; i < d && c; i++) { a.unshift(_brief(c)); c = c.parentElement; } return a.join(' < '); };
  const _flush = () => { const s = _out.join('\n'); _out.length = 0; console.log('===== 探针报告 v3 =====\n' + s + '\n===== 请把以上整段复制回给我 ====='); };

  // 拦截 window.open，返回捕获到的第一个 URL
  function _capWinOpen(durMs) {
    let url = ''; const orig = window.open;
    window.open = function () { try { if (!url && typeof arguments[0] === 'string') url = arguments[0]; } catch (_) {} return null; };
    return new Promise((res) => setTimeout(() => { try { window.open = orig; } catch (_) {} res(url); }, durMs || 6000));
  }

  // ============ 主页：私信按钮 + 点击触发地址 ============
  window.__dmprobeProfile = async function () {
    _log('===== [A1] 主页信息 =====');
    _log('URL: ' + location.href);
    _log('Title: ' + document.title);
    const mU = location.href.match(/\/user\/(?:profile\/)?([a-zA-Z0-9_-]{6,})/);
    _log('主页 userId: ' + (mU ? mU[1] : '(未识别；可 __DM_UID="xxx" 设好)'));
    _log('');
    _log('===== [A2] 登录态 =====');
    const lg = [...document.querySelectorAll('button,a,div,span')].find(e => _isVis(e) && ['登录', '立即登录', '扫码登录'].includes((e.innerText || '').trim()) && e.children.length === 0);
    _log(lg ? '⚠️ 可能未登录（私信按钮常需登录才显示）' : '✓ 大概率已登录');
    _log('');
    _log('===== [A3] 「私信/发消息」按钮候选 =====');
    const cands = [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(e => {
        const t = (e.innerText || '').trim(); const c = String(e.className || ''); const aria = e.getAttribute('aria-label') || '';
        return _isVis(e) && (t === '私信' || t === '发消息' || t.startsWith('私信') || /(^|_)(send|chat|message|dm|im)(_|$)/i.test(c) || aria.includes('私信') || /发消息|私信/.test(c));
      })
      .map(e => ({ e, tag: e.tagName.toLowerCase(), t: (e.innerText || '').trim().slice(0, 12), aria: (e.getAttribute('aria-label') || '').slice(0, 20), p: _brief(e), c: String(e.className || '') }));
    const uniq = [], seen = new Set();
    for (const x of cands) { const k = x.p + x.t; if (!seen.has(k)) { seen.add(k); uniq.push(x); } }
    const top = uniq.slice(0, 5);
    if (!top.length) {
      _log('❌ 未找到「私信/发消息」按钮（看下有没「关注」，有的话就是私信入口在别处/被改版）');
      _flush(); return;
    }
    top.forEach((x, i) => _log(`[${i}] <${x.tag}> "${x.t}" aria="${x.aria}" | ${x.p} | ${_ctx(x.e, 3)}`));
    _log('');
    _log('===== [A4] 自动点击 top「私信」，捕获 window.open =====');
    try {
      const capURL = _capWinOpen(7000);
      top[0].e.click();
      const url = await capURL;
      _log(url ? '✅ 捕获到 window.open URL: ' + url : '❌ 点了但没捕获 window.open（要么没反应、要么原地展开弹层/走 pushState）');
      if (url) {
        const q = new URLSearchParams(String(url).split('?')[1] || '');
        _log('channel_id=' + (q.get('channel_id') || '(空)') + '  channel_type=' + (q.get('channel_type') || '(空)'));
        const mId = String(url).match(/\/chat\/([^\/?]+)/i);
        _log('若含 /chat/{id} → id=' + (mId ? mId[1] : '(非 /chat 形态)'));
      }
    } catch (e) { _log('✗ 点击异常: ' + e.message); }
    _flush();
  };

  // ============ /chat 会话页：输入框 + 发送按钮 ============
  window.__dmprobeChatSend = function () {
    _log('===== [B1] 页面 =====');
    _log('URL: ' + location.href);
    _log('convId: ' + ((location.href.match(/\/chat\/([^\/?]+)/i) || [])[1] || '(非 /chat/{id})'));
    _log('');
    const bar = document.querySelector('.xhs-im-input-bar');
    _log('===== [B2] 输入栏容器 .xhs-im-input-bar =====');
    _log(bar ? '找到: ' + _brief(bar) : '未找到 .xhs-im-input-bar');
    if (bar) _log('HTML(head): ' + _esc(bar.outerHTML.slice(0, 1500)));
    _log('');
    const scope = bar || document;
    _log('===== [B3] 输入框 =====');
    const ins = [...scope.querySelectorAll('[contenteditable="true"],.xhs-im-input-bar-editor,textarea,[role="textbox"]')].filter(_isVis);
    if (!ins.length) _log('❌ 未见输入框'); else ins.slice(0, 5).forEach((el, i) => _log(`[in${i}] ${_brief(el)}<${el.tagName}${el.getAttribute('contenteditable') ? '/ce' : ''}> | ${_ctx(el, 3)}`));
    _log('===== [B4] 发送按钮 =====');
    const sends = [...scope.querySelectorAll('button,[role="button"],[class*="send" i],[type="submit"]')]
      .filter(e => { const t = (e.innerText || '').trim(); const c = String(e.className || ''); const aria = e.getAttribute('aria-label') || ''; const svg = e.tagName === 'svg' ? (((e.querySelector('title') || { textContent: '' }).textContent || '')) : ''; return _isVis(e) && (t === '发送' || aria.includes('发送') || svg.includes('发送') || /send/i.test(c)); })
      .slice(0, 6);
    if (!sends.length) { _log('❌ 未见明显发送按钮，按钮候选：'); [...scope.querySelectorAll('button')].filter(_isVis).slice(0, 8).forEach(e => _log('   ' + _esc((e.innerText || '').trim().slice(0, 10)) + ' cls=' + _esc(String(e.className || '')) + ' | ' + _brief(e))); }
    else sends.forEach((el, i) => _log(`[send${i}] ${_brief(el)} "${_esc((el.innerText || '').trim().slice(0, 10))}" cls="${_esc(String(el.className || '').slice(0, 60))}" | ${_ctx(el, 2)}`));
    _flush();
  };

  // ============ 核心：绕开按钮，直接开 /chat/{userId} ============
  window.__dmprobeTryUser = function () {
    const uid = (window.__DM_UID || '').trim() || (location.href.match(/\/user\/(?:profile\/)?([a-zA-Z0-9_-]{6,})/i) || [])[1] || '';
    if (!uid) { _log('缺少 userId：主页运行 __dmprobeProfile() 拿到，或控制台设 __DM_UID="xxx" 后重跑'); console.log(_out.join('\n')); return; }
    _log('===== [C] 尝试直接打开 /chat/' + uid + '（绕过私信按钮，新标签页） =====');
    window.open('https://www.xiaohongshu.com/chat/' + uid, '_blank');
    _log('已新开 /chat/' + uid + '。请切到那个页面运行 __dmprobeChatSend()，');
    _log('若 B3 有输入框 → 说明能绕按钮直达私信窗（自动化可行）；若无 → 需点按钮/别的方式，私聊暂只能"开主页手动"。');
    _flush();
  };

  console.log('小红书私聊勘探 v3 已注入。任选运行：\n  · 主页 → __dmprobeProfile()\n  · /chat 会话页 → __dmprobeChatSend()\n  · 绕按钮验证 → __dmprobeTryUser()（先设 __DM_UID）');
})();