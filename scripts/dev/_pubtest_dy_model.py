# -*- coding: utf-8 -*-
"""诊断⑧：Slate 模型选区 + 合成粘贴 = 真正替换。
A) 仅 DOM 全选 + paste（对照）  B) fiber 拿 editor 对象，设模型全选 + paste
C) 定型后打话题 → 点下拉 → 强制再触发一次 mention，看模型是否真吃下（重渲不丢）。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_SETUP = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  if (!ed) return { err: 'no ed' };
  window.__probeEd = ed;
  const fk = Object.keys(ed).find(k => k.startsWith('__reactFiber$'));
  let f = fk ? ed[fk] : null;
  let steps = 0;
  while (f && steps < 10 && !(f.memoizedProps && f.memoizedProps.editor)) { f = f.return; steps++; }
  const edt = f && f.memoizedProps ? f.memoizedProps.editor : null;
  window.__slate = edt || null;
  const out = { gotEditor: !!edt, fiberSteps: steps };
  if (edt) {
    try {
      out.editorKeys = Object.keys(edt).slice(0, 30);
      out.kids = edt.children.length;
      out.sel = edt.selection ? 'has' : 'null';
      const txt = []; const walk = (n) => { if (n.text !== undefined) txt.push(n.text); else (n.children || []).forEach(walk); };
      edt.children.forEach(walk);
      out.modelText = txt.join('|').slice(0, 120);
    } catch (e) { out.err2 = String(e); }
  }
  return out;
})()'''

JS_SAMPLE = r'''(() => {
  const ed = window.__probeEd;
  const edt = window.__slate;
  let modelText = '';
  try {
    const txt = []; const walk = (n) => { if (n.text !== undefined) txt.push(n.text); else (n.children || []).forEach(walk); };
    edt.children.forEach(walk);
    modelText = txt.join('|').slice(0, 130);
  } catch (e) { modelText = 'ERR ' + e; }
  return { n: ed.children.length, dom: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 130), model: modelText };
})()'''

JS_PASTE = r'''(async (html) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__probeEd;
  const edt = window.__slate;
  const dt = new DataTransfer();
  dt.setData('text/plain', 'ZZ甲一。\nZZ甲二。');
  dt.setData('text/html', '<div>ZZ甲一。</div><div>ZZ甲二。</div>');
  if (!html) dt.setData('text/html', '');
  // DOM 全选
  ed.focus();
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(ed);
  sel.removeAllRanges(); sel.addRange(rng);
  await sleep(200);
  // （可选）模型全选
  let modelSel = 'skipped';
  if (edt) {
    try {
      const kids = edt.children;
      const last = kids.length - 1;
      const lastLine = kids[last];
      const lastLeaf = lastLine.children[lastLine.children.length - 1];
      const endOffset = lastLeaf.text !== undefined ? lastLeaf.text.length : 0;
      edt.selection = { anchor: { path: [0, 0], offset: 0 }, focus: { path: [last, lastLine.children.length - 1], offset: endOffset } };
      modelSel = 'set';
    } catch (e) { modelSel = 'ERR ' + e; }
  }
  await sleep(100);
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  ed.dispatchEvent(ev);
  await sleep(700);
  return { modelSel, notCanceled: ed.dispatchEvent ? undefined : undefined, t: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 130) };
})()'''

JS_TYPETAG = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__probeEd;
  document.execCommand('insertText', false, ' ');
  document.execCommand('insertText', false, '#引流获客');
  let box = null;
  for (let i = 0; i < 20 && !box; i++) {
    await sleep(200);
    const b = document.querySelector('[class*="mention-suggest-item-container"]');
    if (b && b.getBoundingClientRect().width >= 4) box = b;
  }
  if (!box) return { dd: false };
  const r = box.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const t = document.elementFromPoint(cx, cy) || box;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  t.dispatchEvent(new PointerEvent('pointerdown', o));
  t.dispatchEvent(new MouseEvent('mousedown', o));
  t.dispatchEvent(new PointerEvent('pointerup', o));
  t.dispatchEvent(new MouseEvent('mouseup', o));
  t.dispatchEvent(new MouseEvent('click', o));
  await sleep(500);
  return { dd: true, t: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 130) };
})()'''

JS_CHIPS = r'''(() => {
  const ed = window.__probeEd;
  const chips = [...ed.querySelectorAll('[data-slate-type], [class*="mention"], span[data-mention]')].map(s => String(s.className).slice(0, 40) + '::' + (s.textContent || '').slice(0, 20)).slice(0, 8);
  return { chips, html: ed.innerHTML.slice(0, 400) };
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

        page.reload(wait_until='load')
        print('reloaded')
        for _ in range(60):
            time.sleep(0.5)
            if page.evaluate("!!document.querySelector('.zone-container[contenteditable]')"):
                break
        print('== SETUP ==', json.dumps(page.evaluate(JS_SETUP), ensure_ascii=False))
        watch(page, '初始', 2)

        print('== A: DOM全选+模型全选+paste(html) ==')
        print(json.dumps(page.evaluate(JS_PASTE, True), ensure_ascii=False))
        watch(page, 'A 后', 4)

        print('== B: paste(仅 plain，验证换行) ==')
        print(json.dumps(page.evaluate(JS_PASTE, False), ensure_ascii=False))
        watch(page, 'B 后', 4)

        print('== C: 打话题 #引流获客 + 点下拉 ==')
        print(json.dumps(page.evaluate(JS_TYPETAG), ensure_ascii=False))
        watch(page, 'C 后', 4)

        print('== 强制触发 mention 再渲一次（打字 #）==')
        page.evaluate("document.execCommand('insertText', false, '#副业思维');")
        watch(page, '再渲后', 6)

        print('== CHIPS ==', json.dumps(page.evaluate(JS_CHIPS), ensure_ascii=False)[:800])
        page.screenshot(path='tmp/pubtest_shots/dy_model.png')
        print('shot -> tmp/pubtest_shots/dy_model.png')


if __name__ == '__main__':
    main()
