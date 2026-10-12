# -*- coding: utf-8 -*-
"""诊断⑭：下拉开着时逐级试三种输入通路（execCommand / 模型粘贴 / 点中），
看哪种能让建议列表跟上我们的词，并验证点条目能否落芯片。
状态前提：正文已复位 + 末尾 '#' + 下拉已开（⑬留下的态）。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_BASE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  window.__pEd = ed;
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  return { boxText: box ? box.innerText.replace(/\n/g, '|').trim().slice(0, 200) : null,
           ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-60) };
})()'''

JS_DUMP = r'''(() => {
  const ed = window.__pEd;
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  return { boxText: box ? box.innerText.replace(/\n/g, '|').trim().slice(0, 300) : null,
           ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-80),
           chips: [...ed.querySelectorAll('[class*="tag-hash"], [class*="mention"], [data-slate-type]')].map(e => String(e.className).slice(0, 40) + '::' + (e.textContent || '').slice(0, 20)).slice(0, 6),
           htmlTail: ed.innerHTML.slice(-400) };
})()'''

JS_TYPE_EXEC = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.execCommand('insertText', false, '引流获客');
  await sleep(1200);
  return { done: true };
})()'''

JS_MODEL_PASTE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__pEd;
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
  if (!ace) return { ok: false, msg: '没摸到 ace' };
  const dt = new DataTransfer();
  dt.setData('text/plain', '引流获客');
  dt.setData('text/html', '<div>引流获客</div>');
  ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  await sleep(1500);
  return { ok: true };
})()'''

JS_CLICK_HIT = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  if (!box) return { ok: false, msg: '下拉没了' };
  const cands = [...box.querySelectorAll('div')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 60 && r.height > 16 && (e.innerText || '').trim() && e.children.length <= 3;
  });
  const el = cands.filter(e => /引流/.test(e.innerText || '')).pop() || cands.pop();
  if (!el) return { ok: false, msg: '没条目' };
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const t = document.elementFromPoint(cx, cy) || el;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  t.dispatchEvent(new PointerEvent('pointerdown', o));
  t.dispatchEvent(new MouseEvent('mousedown', o));
  t.dispatchEvent(new PointerEvent('pointerup', o));
  t.dispatchEvent(new MouseEvent('mouseup', o));
  t.dispatchEvent(new MouseEvent('click', o));
  await sleep(1000);
  return { ok: true, picked: (el.innerText || '').replace(/\n/g, '|').slice(0, 40) };
})()'''


def dump(page, label):
    print(f'-- {label} --', json.dumps(page.evaluate(JS_DUMP), ensure_ascii=False, indent=1))


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'creator.douyin.com' in p.url and 'post' in p.url)
        page.bring_to_front()
        time.sleep(0.3)

        print('== 基态 ==', json.dumps(page.evaluate(JS_BASE), ensure_ascii=False))

        print('== ① execCommand 打字 ==', json.dumps(page.evaluate(JS_TYPE_EXEC), ensure_ascii=False))
        dump(page, '① 之后')
        page.screenshot(path='tmp/pubtest_shots/dy_topic4_exec.png')

        print('== ② 模型粘贴 ==', json.dumps(page.evaluate(JS_MODEL_PASTE), ensure_ascii=False))
        dump(page, '② 之后')
        page.screenshot(path='tmp/pubtest_shots/dy_topic4_paste.png')

        print('== ③ 点条目 ==', json.dumps(page.evaluate(JS_CLICK_HIT), ensure_ascii=False))
        dump(page, '③ 之后')
        page.screenshot(path='tmp/pubtest_shots/dy_topic4_click.png')


if __name__ == '__main__':
    main()
