# -*- coding: utf-8 -*-
"""诊断⑦：抖音编辑器类型识别 + 合成粘贴通路测试。
A) 读 editor 元素的 class/attrs/React fiber 链，判断 Slate/ProseMirror/Lexical/自研。
B) 全选 + 合成 paste（DataTransfer 文本）→ 观察 8s，再打字 '#' 看是否触发重渲回滚。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_IDENT = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  if (!ed) return { err: 'no ed' };
  const out = {
    cls: String(ed.className).slice(0, 120),
    attrs: [...ed.attributes].map(a => a.name + '=' + String(a.value).slice(0, 60)).slice(0, 20),
    keys: Object.keys(ed).slice(0, 40),
    outerHead: ed.outerHTML.slice(0, 300),
  };
  const fk = Object.keys(ed).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  out.fiberKey = fk || null;
  if (fk) {
    let f = ed[fk];
    out.chain = [];
    for (let i = 0; i < 14 && f; i++) {
      const t = f.type;
      const name = typeof t === 'string' ? t : (t && (t.displayName || t.name)) || (f.elementType && typeof f.elementType === 'string' ? f.elementType : '?');
      const propKeys = f.memoizedProps && typeof f.memoizedProps === 'object' ? Object.keys(f.memoizedProps).slice(0, 10).join(',') : '';
      out.chain.push({ i, name, propKeys });
      f = f.return;
    }
    const own = ed[fk];
    out.ownProps = own.memoizedProps ? Object.keys(own.memoizedProps).slice(0, 30) : null;
    out.stateNode = own.stateNode ? Object.keys(own.stateNode).slice(0, 30) : null;
  }
  // 往上看 zone-container 的 fiber
  let p = ed.parentElement, hops = 0, owner = null;
  while (p && hops < 8) {
    const k2 = Object.keys(p).find(k => k.startsWith('__reactFiber$'));
    if (k2 && p.className && String(p.className).includes('zone-container')) { owner = { hop: hops, cls: String(p.className).slice(0, 80), propKeys: Object.keys(p[k2].memoizedProps || {}).slice(0, 25) }; break; }
    p = p.parentElement; hops++;
  }
  out.zoneOwner = owner;
  out.pm = { hasProseMirror: !!document.querySelector('.ProseMirror'), edIsPM: ed.classList.contains('ProseMirror') };
  return out;
})()'''

JS_PASTE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__pl2 = []; window.__t2 = performance.now();
  const mk = (d) => window.__pl2.push({ t: Math.round(performance.now() - window.__t2), ev: 'MARK', d });
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  mk('start');
  ed.focus();
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(ed);
  sel.removeAllRanges(); sel.addRange(rng);
  await sleep(200);
  const dt = new DataTransfer();
  dt.setData('text/plain', 'AAAA粘贴测试一。\n第二行粘贴二。');
  dt.setData('text/html', '<div>AAAA粘贴测试一。</div><div>第二行粘贴二。</div>');
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  const notCanceled = ed.dispatchEvent(ev);
  mk('paste-dispatched defaultNotPrevented=' + notCanceled + ' evTrusted=' + ev.isTrusted);
  await sleep(600);
  return { notCanceled, t: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 120) };
})()'''

JS_SAMPLE = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  return { t: ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 130) : '(no ed)', n: ed ? ed.children.length : -1 };
})()'''

JS_HASH = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mk = (d) => window.__pl2.push({ t: Math.round(performance.now() - window.__t2), ev: 'MARK', d });
  mk('hash-typing');
  document.execCommand('insertText', false, '#测试');
  await sleep(600);
  return { dd: document.querySelectorAll('[class*="mention-suggest-item-container"]').length };
})()'''

JS_LOG2 = '''(() => ({ log: (window.__pl2 || []).slice(-40) }))()'''


def watch(page, label, seconds, dedupe=True):
    print(f'-- watch {label} ({seconds}s) --')
    last = None
    for i in range(int(seconds * 2)):
        time.sleep(0.5)
        s = page.evaluate(JS_SAMPLE)
        line = json.dumps(s, ensure_ascii=False)
        if line != last or not dedupe:
            print(f'  t+{(i + 1) * 0.5:4.1f}s {line}')
            last = line


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'creator.douyin.com' in p.url and 'post' in p.url)
        page.bring_to_front()
        time.sleep(0.3)

        print('== IDENT ==')
        print(json.dumps(page.evaluate(JS_IDENT), ensure_ascii=False, indent=1))

        print('== PASTE ==')
        print(json.dumps(page.evaluate(JS_PASTE), ensure_ascii=False))
        time.sleep(1.5)
        watch(page, 'paste 后', 8)
        print('LOG2:', json.dumps(page.evaluate(JS_LOG2), ensure_ascii=False))

        print('== HASH ==')
        print(json.dumps(page.evaluate(JS_HASH), ensure_ascii=False))
        watch(page, 'hash 后', 6)
        print('LOG2:', json.dumps(page.evaluate(JS_LOG2), ensure_ascii=False))


if __name__ == '__main__':
    main()
