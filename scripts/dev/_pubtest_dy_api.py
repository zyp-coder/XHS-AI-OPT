# -*- coding: utf-8 -*-
"""诊断⑩：枚举 ACE 模块（selection/inputModel/_contentState/delegator/undoModule）的方法，
找到「设置选区/全选」的入口，试调 → 粘贴替换。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_ENUM = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const fk = Object.keys(ed).find(k => k.startsWith('__reactFiber$'));
  let f = fk ? ed[fk] : null, steps = 0;
  while (f && steps < 10 && !(f.memoizedProps && f.memoizedProps.editor)) { f = f.return; steps++; }
  const edt = f.memoizedProps.editor;
  window.__edt = edt; window.__pEd = ed;
  const desc = (o) => {
    if (!o || typeof o !== 'object') return typeof o;
    return Object.keys(o).slice(0, 60).map(k => {
      const v = o[k];
      let t = typeof v;
      if (t === 'object' && v) t = Array.isArray(v) ? 'arr[' + v.length + ']' : 'obj{' + Object.keys(v).slice(0, 6).join(',') + '}';
      if (t === 'function') t = 'fn';
      return k + ':' + t;
    }).join(' | ');
  };
  const out = {};
  for (const name of ['selection', 'inputModel', '_contentState', 'delegator', 'pluginManager', 'undoModule', 'clipboard', 'modulesContainer', 'eventEmitter']) {
    out[name] = desc(edt[name]);
  }
  return out;
})()'''

JS_TRY_SELECTALL = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const edt = window.__edt, ed = window.__pEd;
  const out = { tried: [] };
  const sel = edt.selection;
  for (const cand of ['selectAll', 'select_all', 'all', 'setRange', 'setSelection', 'update', 'select', 'collapse']) {
    if (sel && typeof sel[cand] === 'function') out.tried.push(cand);
  }
  if (sel && typeof sel.selectAll === 'function') {
    try { sel.selectAll(); out.selectAll = 'called'; } catch (e) { out.selectAll = 'ERR ' + e; }
  } else if (sel && typeof sel.setSelection === 'function') {
    try { out.setSelectionRet = String(sel.setSelection()); } catch (e) { out.setSelection = 'ERR ' + e; }
  }
  await sleep(300);
  const dt = new DataTransfer();
  dt.setData('text/plain', 'YY替换试。');
  dt.setData('text/html', '<div>YY替换试。</div>');
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  const notPrevented = ed.dispatchEvent(ev);
  await sleep(700);
  out.t = (ed.textContent || '').replace(/\u200b/g, '').slice(0, 160);
  return out;
})()'''

JS_SAMPLE = r'''(() => {
  const ed = window.__pEd;
  return { n: ed ? ed.children.length : -1, dom: ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 140) : '' };
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

        print('== ENUM ==')
        print(json.dumps(page.evaluate(JS_ENUM), ensure_ascii=False, indent=1))

        print('== TRY selectAll + paste ==')
        print(json.dumps(page.evaluate(JS_TRY_SELECTALL), ensure_ascii=False))
        watch(page, '替换试后', 5)


if __name__ == '__main__':
    main()
