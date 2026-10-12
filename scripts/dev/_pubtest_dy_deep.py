# -*- coding: utf-8 -*-
"""诊断⑨：深挖 ACE editor 实例（_viewModel/选区 API），找页面自带的填充/清空按钮；
测「点击文末 + 粘贴」能否把模型光标移到末尾。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_DEEP = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const fk = Object.keys(ed).find(k => k.startsWith('__reactFiber$'));
  let f = fk ? ed[fk] : null, steps = 0;
  while (f && steps < 10 && !(f.memoizedProps && f.memoizedProps.editor)) { f = f.return; steps++; }
  const edt = f && f.memoizedProps ? f.memoizedProps.editor : null;
  window.__edt = edt;
  const out = {};
  out.allKeys = Object.keys(edt).map(k => k + ':' + (typeof edt[k])).join(' | ');
  out.candidates = Object.keys(edt).filter(k => /select|clear|insert|focus|caret|range|content|text|value|children/i.test(k));
  const vm = edt._viewModel;
  out.vm = null;
  if (vm) {
    out.vm = {
      keys: Object.keys(vm).slice(0, 60).map(k => k + ':' + (typeof vm[k])).join(' | '),
      hasChildren: !!vm.children, childrenIsArr: Array.isArray(vm.children), childrenLen: vm.children && vm.children.length,
      hasSelection: 'selection' in vm,
    };
    if (vm.children && vm.children.length) {
      const c0 = vm.children[0];
      out.vmNode0 = Object.keys(c0).slice(0, 20).map(k => k + ':' + (typeof c0[k])).join(' | ');
      try {
        const txt = []; const walk = (n) => { if (n.text !== undefined) txt.push(n.text); else (n.children || []).forEach(walk); };
        vm.children.forEach(walk); out.vmText = txt.join('|').slice(0, 120);
      } catch (e) { out.vmText = 'ERR ' + e; }
    }
  }
  out.propsKeys = edt.props ? Object.keys(edt.props).slice(0, 40).join(',') : null;
  out.btnCands = [...document.querySelectorAll('button,div,span,a')].filter(e => /快速填写|清空|重新上传|删除草稿/.test((e.innerText || '').trim()) && e.children.length <= 2).map(e => ({ tag: e.tagName, t: (e.innerText || '').trim().slice(0, 24), cls: String(e.className).slice(0, 60) })).slice(0, 14);
  // 任一 fiber 链上还有没有别的 editor 对象（slate 本体可能在兄弟 prop 里）
  out.editorPropKeys = f && f.memoizedProps && f.memoizedProps.editor ? Object.keys(f.memoizedProps.editor).length : 0;
  out.fiberPropKeys = f && f.memoizedProps ? Object.keys(f.memoizedProps).join(',') : null;
  return out;
})()'''

JS_CLICKEND_PASTE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  window.__pEd = ed;
  const strings = [...ed.querySelectorAll('[data-string]')];
  const last = strings[strings.length - 1];
  let clickAt = null;
  if (last) {
    const r = last.getBoundingClientRect();
    clickAt = { x: r.right - 2, y: r.y + r.height / 2 };
    const o = { bubbles: true, cancelable: true, clientX: clickAt.x, clientY: clickAt.y, view: window };
    last.dispatchEvent(new PointerEvent('pointerdown', o));
    last.dispatchEvent(new MouseEvent('mousedown', o));
    last.dispatchEvent(new PointerEvent('pointerup', o));
    last.dispatchEvent(new MouseEvent('mouseup', o));
    last.dispatchEvent(new MouseEvent('click', o));
    ed.dispatchEvent(new MouseEvent('click', o));
  }
  await sleep(400);
  const dt = new DataTransfer();
  dt.setData('text/plain', '→END尾插测试。');
  dt.setData('text/html', '<div>→END尾插测试。</div>');
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  const cancelable = ed.dispatchEvent(ev);
  await sleep(700);
  return { clickAt, lastText: last ? (last.textContent || '').slice(0, 20) : null, pref: !cancelable, t: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 160) };
})()'''

JS_VM_SEL = r'''(async () => {
  // 尝试给 _viewModel 设选区（若它是 slate 形状），再粘贴看是否替换
  const ed = window.__pEd;
  const vm = window.__edt ? window.__edt._viewModel : null;
  const out = { vm: !!vm };
  if (!vm) return out;
  try { out.vmSelBefore = JSON.stringify(vm.selection); } catch (e) { out.vmSelBefore = 'ERR'; }
  // 找 findPath / end-of-doc：用 children 结构推最后一点
  let lastPath = null, lastOff = 0;
  try {
    const kids = vm.children;
    const li = kids.length - 1;
    let node = kids[li], path = [li];
    while (node && node.children && node.children.length) { const ni = node.children.length - 1; path.push(ni); node = node.children[ni]; }
    lastPath = path; lastOff = node && typeof node.text === 'string' ? node.text.length : 0;
    out.lastPath = path; out.lastOff = lastOff;
  } catch (e) { out.walkErr = String(e); }
  if (lastPath) {
    try {
      vm.selection = { anchor: { path: [lastPath[0], 0], offset: 0 }, focus: { path: lastPath, offset: lastOff } };
      out.setSel = 'ok';
    } catch (e) { out.setSel = 'ERR ' + e; }
  }
  await sleep(200);
  const dt = new DataTransfer();
  dt.setData('text/plain', 'XX替换测试。');
  dt.setData('text/html', '<div>XX替换测试。</div>');
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  ed.dispatchEvent(ev);
  await sleep(700);
  out.t = (ed.textContent || '').replace(/\u200b/g, '').slice(0, 160);
  return out;
})()'''

JS_SAMPLE = r'''(() => {
  const ed = window.__pEd || [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const vm = window.__edt ? window.__edt._viewModel : null;
  let mt = '';
  try { const txt = []; const walk = (n) => { if (n.text !== undefined) txt.push(n.text); else (n.children || []).forEach(walk); }; vm.children.forEach(walk); mt = txt.join('|').slice(0, 120); } catch (e) { mt = 'ERR'; }
  return { n: ed ? ed.children.length : -1, dom: ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 120) : '', model: mt };
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

        print('== DEEP ==')
        print(json.dumps(page.evaluate(JS_DEEP), ensure_ascii=False, indent=1))

        print('== 点击文末+粘贴 ==')
        print(json.dumps(page.evaluate(JS_CLICKEND_PASTE), ensure_ascii=False))
        watch(page, '尾插后', 3)

        print('== _viewModel 设选区替换 ==')
        print(json.dumps(page.evaluate(JS_VM_SEL), ensure_ascii=False))
        watch(page, '替换后', 5)
        page.screenshot(path='tmp/pubtest_shots/dy_vm.png')


if __name__ == '__main__':
    main()
