# -*- coding: utf-8 -*-
"""诊断⑥：按步骤复刻 NPA_DY_FILL 全流程，每步之间采样 + 带标记 MutationObserver。
reload → 等编辑器 → 设标题 → insert#1 → 打话题×2 → insert#2（修复）→ 全链路采样。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

BODY = '第一段：彩排——干净页重开，全选替换一步到位。\n第二段：后面接话题芯片。'
TITLE = '彩排标题·抖音'
TAGS = ['引流获客', '副业思维']

JS_INSTALL = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  if (!ed) return false;
  window.__pl = [];
  window.__npaProbe = { ed };
  ed.dataset.npaProbe = '1';
  window.__t0 = performance.now();
  const mark = (d) => window.__pl.push({ t: Math.round(performance.now() - window.__t0), ev: 'MARK', d: d });
  window.__mark = mark;
  new MutationObserver(muts => {
    for (const m of muts) {
      const tgt = (m.target.tagName || '') + (m.target.getAttribute && m.target.getAttribute('data-line-wrapper') !== null ? '[lw]' : '');
      window.__pl.push({ t: Math.round(performance.now() - window.__t0), m: m.type, tgt: tgt,
        add: m.addedNodes.length, rm: m.removedNodes.length,
        txt: (m.target.textContent || '').replace(/\u200b/g, '').slice(0, 36) });
    }
  }).observe(ed.parentElement, { childList: true, subtree: true, characterData: true });
  ['beforeinput', 'input'].forEach(k =>
    ed.addEventListener(k, e => window.__pl.push({ t: Math.round(performance.now() - window.__t0), ev: k, it: e.inputType || '', d: (e.data || '').slice(0, 30) }), true));
  return true;
})()'''

JS_SAMPLE = r'''(() => {
  const cur = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const keep = !!(cur && cur.dataset.npaProbe === '1');
  const sel = window.getSelection();
  let car = '';
  try {
    if (cur && sel.rangeCount && cur.contains(sel.anchorNode)) car = 'a' + sel.anchorOffset + '/f' + sel.focusOffset + '/r' + sel.rangeCount;
  } catch (e) { car = 'err'; }
  const blocks = cur ? [...cur.children].map(c => (c.textContent || '').replace(/\u200b/g, '').slice(0, 30)) : [];
  return { keep, n: cur ? cur.children.length : -1, car, blocks,
           t: cur ? (cur.textContent || '').replace(/\u200b/g, '').slice(0, 150) : '' };
})()'''

JS_TITLE = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__mark('title-set');
  const ti = [...document.querySelectorAll('input')].find(i => /标题/.test(i.placeholder || ''));
  if (!ti) return { ok: false };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(ti, '彩排标题·抖音');
  ti.dispatchEvent(new Event('input', { bubbles: true }));
  ti.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(500);
  return { ok: true, v: ti.value };
})()'''

JS_INSERT = r'''(async (n) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__npaProbe.ed;
  window.__mark('insert#' + n + '-start');
  const rect = ed.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, view: window };
  ed.dispatchEvent(new PointerEvent('pointerdown', o));
  ed.dispatchEvent(new MouseEvent('mousedown', o));
  ed.dispatchEvent(new PointerEvent('pointerup', o));
  ed.dispatchEvent(new MouseEvent('mouseup', o));
  ed.dispatchEvent(new MouseEvent('click', o));
  ed.focus();
  await sleep(300);
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(ed);
  sel.removeAllRanges();
  sel.addRange(rng);
  await sleep(250);
  const ok = document.execCommand('insertText', false, '第一段：彩排——干净页重开，全选替换一步到位。\n第二段：后面接话题芯片。');
  await sleep(1200);
  const clean = (s) => String(s || '').replace(/[\u200b\n\r]/g, '');
  const want = clean('第一段：彩排——干净页重开，全选替换一步到位。\n第二段：后面接话题芯片。');
  const pass = clean(ed.textContent) === want;
  window.__mark('insert#' + n + '-done pass=' + pass);
  if (pass) {
    const rng2 = document.createRange();
    rng2.selectNodeContents(ed);
    rng2.collapse(false);
    const sel2 = window.getSelection();
    sel2.removeAllRanges();
    sel2.addRange(rng2);
  }
  return { ok, pass, t: clean(ed.textContent).slice(0, 100) };
})()'''

JS_TAGS = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__npaProbe.ed;
  const out = [];
  for (const tg of ['引流获客', '副业思维']) {
    window.__mark('tag:' + tg + '-space');
    document.execCommand('insertText', false, ' ');
    window.__mark('tag:' + tg + '-hash');
    document.execCommand('insertText', false, '#' + tg);
    let box = null;
    for (let i = 0; i < 20 && !box; i++) {
      await sleep(200);
      const b = document.querySelector('[class*="mention-suggest-item-container"]');
      if (b && b.getBoundingClientRect().width >= 4) box = b;
    }
    if (box) {
      window.__mark('tag:' + tg + '-click-dd');
      const r = box.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const t = document.elementFromPoint(cx, cy) || box;
      const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
      t.dispatchEvent(new PointerEvent('pointerdown', o));
      t.dispatchEvent(new MouseEvent('mousedown', o));
      t.dispatchEvent(new PointerEvent('pointerup', o));
      t.dispatchEvent(new MouseEvent('mouseup', o));
      t.dispatchEvent(new MouseEvent('click', o));
      await sleep(350);
      out.push({ tg, dd: true });
    } else {
      window.__mark('tag:' + tg + '-no-dd-space');
      document.execCommand('insertText', false, ' ');
      out.push({ tg, dd: false });
    }
  }
  return { out, t: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 150) };
})()'''

JS_LOG = '''(() => ({ log: (window.__pl || []).slice(-70), now: Math.round(performance.now() - (window.__t0 || 0)) }))()'''


def watch(page, label, seconds):
    print(f'-- watch {label} ({seconds}s) --')
    last = None
    n = int(seconds / 0.5)
    for i in range(n):
        time.sleep(0.5)
        s = page.evaluate(JS_SAMPLE)
        line = json.dumps(s, ensure_ascii=False)
        if line != last:
            print(f'  t+{(i + 1) * 0.5:4.1f}s {line}')
            last = line


def dump_log(page, label):
    d = page.evaluate(JS_LOG)
    print(f'== LOG {label} ==')
    for e in d['log']:
        print('   ', json.dumps(e, ensure_ascii=False))


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
        print('install:', page.evaluate(JS_INSTALL))
        watch(page, '恢复落地', 3)

        print('== title ==', json.dumps(page.evaluate(JS_TITLE), ensure_ascii=False))
        watch(page, '设标题后', 3)

        print('== insert#1 ==', json.dumps(page.evaluate(JS_INSERT, 1), ensure_ascii=False))
        watch(page, 'insert#1 后静置', 8)
        dump_log(page, 'insert#1')

        print('== tags ==', json.dumps(page.evaluate(JS_TAGS), ensure_ascii=False))
        watch(page, 'tags 后静置', 8)
        dump_log(page, 'tags')

        print('== insert#2 ==', json.dumps(page.evaluate(JS_INSERT, 2), ensure_ascii=False))
        watch(page, 'insert#2 后静置', 8)
        dump_log(page, 'insert#2')

        page.screenshot(path='tmp/pubtest_shots/dy_fill_steps.png')
        print('shot -> tmp/pubtest_shots/dy_fill_steps.png')


if __name__ == '__main__':
    main()
