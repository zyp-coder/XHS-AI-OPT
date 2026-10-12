# -*- coding: utf-8 -*-
"""诊断⑤：抖音编辑器「全选替换后，内容何时被改回去」。
reload → 等编辑器 → 挂 MutationObserver + beforeinput 日志 → 全选 insertText 替换 →
静置 15s 观察（不碰键盘）→ 打字 '#' 观察 → 全选清空观察。只诊断不改业务代码。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_INSTALL = r'''(() => {
  const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  if (!ed) return false;
  window.__pl = [];
  const push = (o) => { if (window.__pl.length < 400) window.__pl.push(o); };
  window.__npaProbe = { ed };
  ed.dataset.npaProbe = '1';
  const t0 = performance.now();
  new MutationObserver(muts => {
    for (const m of muts) {
      push({ t: Math.round(performance.now() - t0), m: m.type, add: m.addedNodes.length, rm: m.removedNodes.length,
             txt: (m.target.textContent || '').replace(/\u200b/g, '').slice(0, 40) });
    }
  }).observe(ed.parentElement, { childList: true, subtree: true, characterData: true });
  ['beforeinput', 'input', 'compositionstart', 'compositionend'].forEach(k =>
    ed.addEventListener(k, e => push({ t: Math.round(performance.now() - t0), ev: k, it: e.inputType || '', tr: e.isTrusted, d: (e.data || '').slice(0, 24) }), true));
  window.__probeT0 = t0;
  return true;
})()'''

JS_SAMPLE = r'''(() => {
  const cur = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
  const keep = !!(cur && cur.dataset.npaProbe === '1');
  return { keep, n: cur ? cur.children.length : -1, t: cur ? (cur.textContent || '').replace(/\u200b/g, '').slice(0, 120) : '' };
})()'''

JS_INSERT = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__pl = []; window.__probeT0 = performance.now();
  const ed = window.__npaProbe.ed;
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
  sel.removeAllRanges(); sel.addRange(rng);
  await sleep(250);
  const ok = document.execCommand('insertText', false, '甲乙丙——替换测试一。\n第二行替换测试二。');
  await sleep(300);
  return { ok, after: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 100) };
})()'''

JS_HASH = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.execCommand('insertText', false, '#引流获客');
  await sleep(800);
  return { after: (window.__npaProbe.ed.textContent || '').replace(/\u200b/g, '').slice(0, 120),
           dd: document.querySelectorAll('[class*="mention-suggest-item-container"]').length };
})()'''

JS_CLEAR = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ed = window.__npaProbe.ed;
  const sel = window.getSelection();
  const rng = document.createRange();
  rng.selectNodeContents(ed);
  sel.removeAllRanges(); sel.addRange(rng);
  await sleep(250);
  const ok = document.execCommand('insertText', false, '');
  await sleep(500);
  return { ok, after: (ed.textContent || '').replace(/\u200b/g, '').slice(0, 80) };
})()'''

JS_LOG = '''(() => ({ log: (window.__pl || []).slice(-60), now: Math.round(performance.now() - (window.__probeT0 || 0)) }))()'''


def watch(page, label, seconds):
    print(f'-- watch {label} ({seconds}s) --')
    n = int(seconds / 0.5)
    last = None
    for i in range(n):
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
        print('editor mounted, install probe:', page.evaluate(JS_INSTALL))
        watch(page, '安装后静置（草稿恢复）', 3)

        print('== insert ==', json.dumps(page.evaluate(JS_INSERT), ensure_ascii=False))
        watch(page, '插入后静置（不碰键盘）', 15)
        print('LOG(insert):', json.dumps(page.evaluate(JS_LOG), ensure_ascii=False)[:4000])

        print('== hash ==', json.dumps(page.evaluate(JS_HASH), ensure_ascii=False))
        watch(page, '打字#后', 8)
        print('LOG(hash):', json.dumps(page.evaluate(JS_LOG), ensure_ascii=False)[:4000])

        print('== clear ==', json.dumps(page.evaluate(JS_CLEAR), ensure_ascii=False))
        watch(page, '清空后', 8)

        page.screenshot(path='tmp/pubtest_shots/dy_race.png')
        print('shot -> tmp/pubtest_shots/dy_race.png')


if __name__ == '__main__':
    main()
