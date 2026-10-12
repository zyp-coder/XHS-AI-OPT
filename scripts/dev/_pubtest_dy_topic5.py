# -*- coding: utf-8 -*-
"""诊断⑮：干净复位后走完整双话题循环——
按钮开下拉 → execCommand 打字 → 点精确匹配条目 → 验芯片；
再跑第二个词验证循环；末尾用模型粘贴扰动验证芯片在模型里（不是 DOM 假象）。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

GET_ACE = '''
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
'''

JS_RESET = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  window.__pEd = ed;
''' + GET_ACE + r'''
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
  const rng = document.createRange(); rng.selectNodeContents(ed); rng.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  return { clean: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 120), boxLeft: box ? box.innerText.trim().slice(0, 40) : null };
})()'''

JS_BTN = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const items = () => [...document.querySelectorAll('[class*="tag-hash-view-name"]')].filter(e => e.getBoundingClientRect().width > 0).length;
  if (items()) return { already: true, n: items() };
  const el = [...document.querySelectorAll('div,span,button,a')].filter(e => {
    const t = (e.innerText || '').trim();
    return /^#?\s*添加话题$/.test(t) && e.children.length <= 3;
  })[0];
  if (!el) return { ok: false, msg: '没找到按钮' };
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  for (let i = 0; i < 20 && !items(); i++) await sleep(200);
  const ed = window.__pEd;
  return { clicked: true, n: items(), ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-30) };
})()'''

JS_TYPE = r'''(async (tag) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.execCommand('insertText', false, tag);
  await sleep(1300);
  const names = [...document.querySelectorAll('[class*="tag-hash-view-name"]')].map(e => e.textContent.trim()).slice(0, 12);
  const ed = window.__pEd;
  return { names, ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-60) };
})'''

JS_CLICK = r'''(async (tag) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const spans = [...document.querySelectorAll('[class*="tag-hash-view-name"]')].filter(e => e.getBoundingClientRect().width > 0);
  let s = spans.find(e => e.textContent.trim() === tag);
  let how = 'exact';
  if (!s) { s = spans.find(e => e.textContent.includes(tag)); how = 'contains'; }
  if (!s) { s = spans[0]; how = 'first'; }
  if (!s) return { ok: false, msg: '没条目' };
  const r = s.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const t = document.elementFromPoint(cx, cy) || s;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  t.dispatchEvent(new PointerEvent('pointerdown', o));
  t.dispatchEvent(new MouseEvent('mousedown', o));
  t.dispatchEvent(new PointerEvent('pointerup', o));
  t.dispatchEvent(new MouseEvent('mouseup', o));
  t.dispatchEvent(new MouseEvent('click', o));
  await sleep(1000);
  const ed = window.__pEd;
  const chips = [...ed.querySelectorAll('[data-mention]')].map(e => (e.textContent || '').replace(/\u200b/g, '').trim());
  return { ok: true, how, picked: s.textContent.trim(),
           ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-90), chips };
})()'''

JS_SPACE_PASTE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__pEd;
  const dt = new DataTransfer();
  dt.setData('text/plain', ' ');
  dt.setData('text/html', '<div>&nbsp;</div>');
  ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  await sleep(1200);
  const chips = [...ed.querySelectorAll('[data-mention]')].map(e => (e.textContent || '').replace(/\u200b/g, '').trim());
  return { chips, ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-90) };
})()'''

JS_SAMPLE = r'''(() => {
  const ed = window.__pEd;
  const box = document.querySelector('[class*="mention-suggest-item-container"]');
  return { ed: (ed.textContent || '').replace(/\u200b/g, '').slice(-80),
           chips: [...ed.querySelectorAll('[data-mention]')].length,
           box: box ? box.innerText.replace(/\n/g, '|').trim().slice(0, 60) : null };
})()'''


def watch(page, label, seconds):
    print(f'-- watch {label} ({seconds}s) --')
    last = None
    for i in range(int(seconds * 2)):
        time.sleep(0.5)
        line = json.dumps(page.evaluate(JS_SAMPLE), ensure_ascii=False)
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

        print('== 复位 ==', json.dumps(page.evaluate(JS_RESET), ensure_ascii=False))
        page.keyboard.press('Escape')
        time.sleep(0.4)

        for tag in ['引流获客', '副业思维']:
            print(f'== 轮[{tag}] 开下拉 ==', json.dumps(page.evaluate(JS_BTN), ensure_ascii=False))
            print(f'== 轮[{tag}] 打字 ==', json.dumps(page.evaluate(JS_TYPE, tag), ensure_ascii=False))
            page.screenshot(path=f'tmp/pubtest_shots/dy_topic5_{tag}_list.png')
            print(f'== 轮[{tag}] 点 ==', json.dumps(page.evaluate(JS_CLICK, tag), ensure_ascii=False))
            page.screenshot(path=f'tmp/pubtest_shots/dy_topic5_{tag}_after.png')

        watch(page, '双芯片后', 6)
        print('== 模型扰动（粘空格） ==', json.dumps(page.evaluate(JS_SPACE_PASTE), ensure_ascii=False))
        watch(page, '扰动后', 4)
        page.screenshot(path=f'tmp/pubtest_shots/dy_topic5_final.png')


if __name__ == '__main__':
    main()
