# -*- coding: utf-8 -*-
"""诊断⑫：接⑪——下拉已开，打「引流获客」→ 列条目 → 点中 → 验证 chip 落位与稳定性。
（先点页面「#添加话题」，再 execCommand 打字。）"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_ENSURE_OPEN = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const opened = () => !!document.querySelector('[class*="mention-suggest-item-container"]');
  window.__pEd = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  if (opened()) return { already: true };
  const btn = [...document.querySelectorAll('.toolbar-button, button, [class*="toolbar"] *')].find(e => /添加话题/.test(e.innerText || '') && e.getBoundingClientRect().width > 0);
  if (!btn) return { ok: false, msg: '没找到「#添加话题」按钮' };
  const r = btn.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  btn.dispatchEvent(new PointerEvent('pointerdown', o));
  btn.dispatchEvent(new MouseEvent('mousedown', o));
  btn.dispatchEvent(new PointerEvent('pointerup', o));
  btn.dispatchEvent(new MouseEvent('mouseup', o));
  btn.dispatchEvent(new MouseEvent('click', o));
  for (let i = 0; i < 20 && !opened(); i++) await sleep(200);
  return { clickedBtn: true, nowOpen: opened(), ed: (window.__pEd.textContent || '').replace(/\u200b/g, '').slice(-60) };
})()'''

JS_T = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  window.__pEd = ed;
  document.execCommand('insertText', false, '引流获客');
  await sleep(1200);
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  const items = box ? [...box.querySelectorAll('div,li,span')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 60 && r.height > 16 && (e.innerText || '').trim();
  }).slice(0, 8).map(e => ({ tag: e.tagName, t: (e.innerText || '').replace(/\n/g, '|').slice(0, 40), cls: String(e.className).slice(0, 46) })) : [];
  return { boxText: box ? box.innerText.replace(/\n/g, '|').slice(0, 100) : null, items, ed: ed.textContent.replace(/\u200b/g, '').slice(0, 120) };
})()'''

JS_CLICK = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  if (!box) return { ok: false };
  // 优先找含「引流」的最小条目
  let el = [...box.querySelectorAll('div,li,span')].filter(e => /引流/.test(e.innerText || '') && e.children.length <= 3).pop();
  if (!el) el = [...box.querySelectorAll('div,li,span')].filter(e => e.children.length <= 3 && (e.innerText || '').trim()).pop();
  if (!el) return { ok: false, msg: 'no item' };
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const t = document.elementFromPoint(cx, cy) || el;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  t.dispatchEvent(new PointerEvent('pointerdown', o));
  t.dispatchEvent(new MouseEvent('mousedown', o));
  t.dispatchEvent(new PointerEvent('pointerup', o));
  t.dispatchEvent(new MouseEvent('mouseup', o));
  t.dispatchEvent(new MouseEvent('click', o));
  await sleep(900);
  const ed = window.__pEd;
  return { ok: true, clicked: (el.innerText || '').slice(0, 30), t: ed.textContent.replace(/\u200b/g, '').slice(0, 130),
           chips: [...ed.querySelectorAll('[class*="mention"],[data-slate-type]')].map(e => e.textContent.slice(0, 20)).slice(0, 6),
           html: ed.innerHTML.slice(-500) };
})()'''

JS_SAMPLE = r'''(() => {
  const ed = window.__pEd || [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  return { t: ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 140) : '' };
})()'''


def watch(page, label, seconds):
    print(f'-- watch {label} ({seconds}s) --')
    last = None
    for i in range(int(seconds * 2)):
        time.sleep(0.5)
        s = page.evaluate(JS_SAMPLE)
        line = json.dumps(s, ensure_ascii=False)
        if line != last:
            print(f'  t+{(i + 1) * 0.5:4.1f}s {line}')
            last = line


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'creator.douyin.com' in p.url and 'post' in p.url)
        page.bring_to_front()
        time.sleep(0.3)

        print('== 确保下拉开 ==', json.dumps(page.evaluate(JS_ENSURE_OPEN), ensure_ascii=False))
        print('== 打字 ==', json.dumps(page.evaluate(JS_T), ensure_ascii=False, indent=1))
        page.screenshot(path='tmp/pubtest_shots/dy_topic_list.png')
        print('== 点条目 ==', json.dumps(page.evaluate(JS_CLICK), ensure_ascii=False, indent=1))
        watch(page, '点后', 6)
        page.screenshot(path='tmp/pubtest_shots/dy_topic_after.png')


if __name__ == '__main__':
    main()
