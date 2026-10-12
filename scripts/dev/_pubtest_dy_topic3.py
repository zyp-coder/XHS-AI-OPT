# -*- coding: utf-8 -*-
"""诊断⑬：清干净→重贴正文（模型层）→点「#添加话题」→深挖下拉面板结构
（有没有自带搜索框/条目长什么样），若有搜索框直接试 React setter 输入过滤。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_CLEAN = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  window.__pEd = ed;
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
  const ace = getAce(ed); window.__pAce = ace;
  const body = '第一段：彩排——干净页重开，全选替换一步到位。\n第二段：后面接话题芯片。';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dt = new DataTransfer();
  dt.setData('text/plain', body);
  dt.setData('text/html', body.split('\n').map(l => '<div>' + esc(l) + '</div>').join(''));
  if (ace) { try { ace.selection.selectAll(); } catch (_) {} }
  await sleep(150);
  ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  await sleep(900);
  return { ace: !!ace, clean: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 120) };
})()'''

JS_OPEN = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visItems = () => {
    const box = document.querySelector('[class*="mention-suggest-item-container"]');
    return box ? box.innerText.replace(/\n/g, '|').trim().length > 0 : false;
  };
  if (visItems()) return { already: true };
  const cands = [...document.querySelectorAll('div,span,button,a')].filter(e => {
    const t = (e.innerText || '').trim();
    return /^#?\s*添加话题$/.test(t) && e.children.length <= 3;
  });
  if (!cands.length) return { ok: false, msg: '没找到按钮' };
  const el = cands[0];
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  for (let i = 0; i < 20 && !visItems(); i++) await sleep(200);
  const ed = window.__pEd;
  return { cands: cands.length, tag: el.tagName, cls: String(el.className).slice(0, 60), open: visItems(), ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-40) };
})()'''

JS_DUMP = r'''(() => {
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  if (!box) return { none: true };
  const pr = box.parentElement;
  return {
    boxCls: String(box.className).slice(0, 90),
    boxText: box.innerText.replace(/\n/g, '|').slice(0, 300),
    boxHTML: box.outerHTML.slice(0, 1200),
    parentCls: pr ? String(pr.className).slice(0, 90) : '',
    parentHTML: pr ? pr.outerHTML.slice(0, 2000) : '',
    inputs: [...document.querySelectorAll('input')].map(i => ({
      ph: i.placeholder, cls: String(i.className).slice(0, 60),
      vis: i.getBoundingClientRect().width > 0, v: i.value,
    })).slice(0, 12),
  };
})()'''

JS_SEARCH = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ph = /搜索|话题/;
  const inp = [...document.querySelectorAll('input')].find(i => i.getBoundingClientRect().width > 0 && ph.test(i.placeholder || ''));
  if (!inp) return { skip: true, why: '可见输入框里没有带 搜索/话题 占位的' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '引流获客');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1500);
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  return { typed: true, boxText: box ? box.innerText.replace(/\n/g, '|').slice(0, 400) : null };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'creator.douyin.com' in p.url and 'post' in p.url)
        page.bring_to_front()
        time.sleep(0.3)

        print('== 复位 ==', json.dumps(page.evaluate(JS_CLEAN), ensure_ascii=False))
        print('== 开下拉 ==', json.dumps(page.evaluate(JS_OPEN), ensure_ascii=False))
        page.screenshot(path='tmp/pubtest_shots/dy_topic3_open.png')
        print('== dump ==', json.dumps(page.evaluate(JS_DUMP), ensure_ascii=False, indent=1))
        print('== 搜索框试输 ==', json.dumps(page.evaluate(JS_SEARCH), ensure_ascii=False, indent=1))
        page.screenshot(path='tmp/pubtest_shots/dy_topic3_search.png')


if __name__ == '__main__':
    main()
