# -*- coding: utf-8 -*-
"""诊断⑪：探索页面自带「#添加话题」按钮的流程——点它出现什么（输入框/列表），
试走完一整个加话题流程，看 chip 能否落上。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_FIND_BTN = r'''(() => {
  const cands = [...document.querySelectorAll('div,span,button,a')].filter(e => {
    const t = (e.innerText || '').trim();
    return /添加话题/.test(t) && e.children.length <= 3 && t.length <= 12;
  });
  return cands.map(e => ({ tag: e.tagName, t: e.innerText.trim(), cls: String(e.className).slice(0, 60), r: (() => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })() }));
})()'''

JS_CLICK_BTN = r'''(() => {
  const el = [...document.querySelectorAll('div,span,button,a')].filter(e => {
    const t = (e.innerText || '').trim();
    return /^#?\s*添加话题$/.test(t) && e.children.length <= 3;
  })[0];
  if (!el) return { ok: false };
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return { ok: true, r: [Math.round(r.x), Math.round(r.y)] };
})()'''

JS_SCAN = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const inputs = [...document.querySelectorAll('input,textarea')].filter(e => e.getBoundingClientRect().width > 10).map(e => ({ tag: e.tagName, ph: e.placeholder || '', cls: String(e.className).slice(0, 40), v: e.value || '' })).slice(0, 10);
  const popups = [...document.querySelectorAll('div')].filter(e => {
    const r = e.getBoundingClientRect();
    const cls = String(e.className || '');
    return r.width > 100 && r.height > 30 && r.height < 500 && /suggest|mention|popup|dropdown|panel/i.test(cls);
  }).map(e => ({ cls: String(e.className).slice(0, 60), t: (e.innerText || '').replace(/\n/g, '|').slice(0, 80) })).slice(0, 8);
  return { ed: ed ? ed.textContent.replace(/\u200b/g, '').slice(0, 100) : '', inputs, popups };
})()'''

JS_TRY_TYPE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 找 AddTopic 弹层里的输入框：刚出现的、可见的
  const inp = [...document.querySelectorAll('input,textarea')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 60 && r.height > 10 && !/标题/.test(e.placeholder || '');
  })[0];
  if (!inp) return { ok: false, msg: '没找到输入框' };
  const proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  inp.focus();
  setter.call(inp, '引流获客');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(1500);
  const items = [...document.querySelectorAll('div,li,span')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 80 && r.height > 20 && r.height < 60 && /引流/.test(e.innerText || '');
  }).map(e => ({ tag: e.tagName, t: (e.innerText || '').replace(/\n/g, '|').slice(0, 60), cls: String(e.className).slice(0, 50), r: (() => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })() })).slice(0, 10);
  return { ok: true, inpCls: String(inp.className).slice(0, 50), items };
})()'''

JS_CLICK_ITEM = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const items = [...document.querySelectorAll('div,li,span')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 80 && r.height > 20 && r.height < 60 && /引流/.test(e.innerText || '') && e.children.length <= 4;
  });
  const el = items[items.length - 1];
  if (!el) return { ok: false };
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const t = document.elementFromPoint(cx, cy) || el;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  t.dispatchEvent(new PointerEvent('pointerdown', o));
  t.dispatchEvent(new MouseEvent('mousedown', o));
  t.dispatchEvent(new PointerEvent('pointerup', o));
  t.dispatchEvent(new MouseEvent('mouseup', o));
  t.dispatchEvent(new MouseEvent('click', o));
  await sleep(800);
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const chips = [...document.querySelectorAll('[class*="mention"], [data-slate-type], span')].filter(e => {
    const c = String(e.className || '');
    return /mention|topic|hash/i.test(c) && (e.textContent || '').trim();
  }).map(e => String(e.className).slice(0, 40) + '::' + e.textContent.slice(0, 20)).slice(0, 6);
  return { ok: true, t: ed ? ed.textContent.replace(/\u200b/g, '').slice(0, 120) : '', chips, edHtml: ed ? ed.innerHTML.slice(0, 500) : '' };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'creator.douyin.com' in p.url and 'post' in p.url)
        page.bring_to_front()
        time.sleep(0.3)

        print('== 找按钮 ==', json.dumps(page.evaluate(JS_FIND_BTN), ensure_ascii=False))
        print('== 点它 ==', json.dumps(page.evaluate(JS_CLICK_BTN), ensure_ascii=False))
        time.sleep(1.2)
        page.screenshot(path='tmp/pubtest_shots/dy_addtopic_open.png')
        print('== 扫描 ==', json.dumps(page.evaluate(JS_SCAN), ensure_ascii=False, indent=1))
        print('== 试打字 ==', json.dumps(page.evaluate(JS_TRY_TYPE), ensure_ascii=False, indent=1))
        page.screenshot(path='tmp/pubtest_shots/dy_addtopic_typed.png')
        print('== 点条目 ==', json.dumps(page.evaluate(JS_CLICK_ITEM), ensure_ascii=False, indent=1))
        page.screenshot(path='tmp/pubtest_shots/dy_addtopic_after.png')


if __name__ == '__main__':
    main()
