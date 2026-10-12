# -*- coding: utf-8 -*-
"""小红书修复假设验证：发布按钮在封闭 shadow 里——合成事件加 composed:true 是否能穿透
   → 先合成点，无效再可信点（Playwright 真实输入）。老板已点头真发，发的就是测试稿。"""
import sys, os, json, time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SHOTS = 'D:/AIproject/小红书运营/tmp/pubtest_shots'

JS_LIB = """(() => {
  const roots = [document]; const seen = new Set();
  const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
  (window.__npaShadowRoots || []).forEach(push);
  const walk = (node) => { let els = []; try { els = node.querySelectorAll('*'); } catch (e) { return; }
    for (const el of els) { if (el.shadowRoot) { push(el.shadowRoot); walk(el.shadowRoot); } } };
  walk(document);
  window.__labRoots = roots;
})();"""

JS_SCAN = """(() => {
  const roots = [document]; const seen = new Set();
  const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
  (window.__npaShadowRoots || []).forEach(push);
  const walk = (node) => { let els = []; try { els = node.querySelectorAll('*'); } catch (e) { return; }
    for (const el of els) { if (el.shadowRoot) { push(el.shadowRoot); walk(el.shadowRoot); } } };
  walk(document);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  const pool = [];
  for (const root of roots) {
    let els = [];
    try { els = root.querySelectorAll('button,div,span,a'); } catch (e) { continue; }
    for (const e of els) {
      if ((e.innerText || '').trim() !== '发布') continue;
      if (e.children.length > 3) continue;
      if (root === document && e.getBoundingClientRect().x < 250) continue;
      if (!vis(e)) continue;
      pool.push(e);
    }
  }
  let btn = null;
  if (pool.length) {
    pool.sort((a, b) => {
      const ba = a.tagName === 'BUTTON' ? 1 : 0, bb = b.tagName === 'BUTTON' ? 1 : 0;
      if (ba !== bb) return bb - ba;
      return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
    });
    const b = pool[0];
    btn = { tag: b.tagName, cls: String(b.className || '').slice(0, 70), kids: b.children.length,
      inShadow: !!(b.getRootNode && b.getRootNode() !== document), aria: b.getAttribute('aria-disabled'),
      busy: b.getAttribute('aria-busy'), n: pool.length };
  }
  const toast = [];
  for (const e of document.querySelectorAll('[class*=toast],[class*=Toast],[class*=message],[class*=Message],[role=alert],[class*=dialog],[class*=Dialog]')) {
    try { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { const s = (e.innerText || '').trim(); if (s) toast.push(s.replace(/\\s+/g, ' ').slice(0, 110)); } } catch (e2) {}
  }
  return { url: location.href, btn, toast: toast.slice(0, 5), tail: (document.body ? document.body.innerText : '').slice(-220) };
})()"""

JS_CLICK = """(() => {
  const roots = [document]; const seen = new Set();
  const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
  (window.__npaShadowRoots || []).forEach(push);
  const walk = (node) => { let els = []; try { els = node.querySelectorAll('*'); } catch (e) { return; }
    for (const el of els) { if (el.shadowRoot) { push(el.shadowRoot); walk(el.shadowRoot); } } };
  walk(document);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  const pool = [];
  for (const root of roots) {
    let els = [];
    try { els = root.querySelectorAll('button,div,span,a'); } catch (e) { continue; }
    for (const e of els) {
      if ((e.innerText || '').trim() !== '发布') continue;
      if (e.children.length > 3) continue;
      if (root === document && e.getBoundingClientRect().x < 250) continue;
      if (!vis(e)) continue;
      pool.push(e);
    }
  }
  if (!pool.length) return { ok: false, msg: 'no btn' };
  pool.sort((a, b) => {
    const ba = a.tagName === 'BUTTON' ? 1 : 0, bb = b.tagName === 'BUTTON' ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
  });
  const btn = pool[0];
  const R = { bubbles: true, cancelable: true, composed: true };
  const r = btn.getBoundingClientRect();
  const o = Object.assign({ clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window }, R);
  btn.dispatchEvent(new PointerEvent('pointerdown', o));
  btn.dispatchEvent(new MouseEvent('mousedown', o));
  btn.dispatchEvent(new PointerEvent('pointerup', o));
  btn.dispatchEvent(new MouseEvent('mouseup', o));
  btn.dispatchEvent(new MouseEvent('click', o));
  return { ok: true, target: { tag: btn.tagName, cls: String(btn.className || '').slice(0, 70), inShadow: !!(btn.getRootNode && btn.getRootNode() !== document) } };
})()"""

JS_MEASURE = """(() => {
  const roots = [document]; const seen = new Set();
  const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
  (window.__npaShadowRoots || []).forEach(push);
  const walk = (node) => { let els = []; try { els = node.querySelectorAll('*'); } catch (e) { return; }
    for (const el of els) { if (el.shadowRoot) { push(el.shadowRoot); walk(el.shadowRoot); } } };
  walk(document);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  const pool = [];
  for (const root of roots) {
    let els = [];
    try { els = root.querySelectorAll('button,div,span,a'); } catch (e) { continue; }
    for (const e of els) {
      if ((e.innerText || '').trim() !== '发布') continue;
      if (e.children.length > 3) continue;
      if (root === document && e.getBoundingClientRect().x < 250) continue;
      if (!vis(e)) continue;
      pool.push(e);
    }
  }
  if (!pool.length) return { ok: false };
  pool.sort((a, b) => {
    const ba = a.tagName === 'BUTTON' ? 1 : 0, bb = b.tagName === 'BUTTON' ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
  });
  const btn = pool[0];
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()"""


def scan(pg, tag):
    try:
        r = pg.evaluate(JS_SCAN)
        print('[%s] %s' % (tag, json.dumps(r, ensure_ascii=False)[:650]))
        return r
    except Exception as e:
        print('[%s] scan ERR %s' % (tag, str(e)[:160]))
        return None


def shot(pg, name):
    try:
        pg.screenshot(path=os.path.join(SHOTS, name), timeout=8000)
        print('shot', name)
    except Exception as e:
        print('shotfail', name, str(e)[:70])


def gone(r):
    return bool(r) and ('/publish/publish' not in r.get('url', '') or (r.get('toast') and any('成功' in x for x in r['toast'])))


with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    cands = []
    for i, pg in enumerate(ctx.pages):
        if '/publish/publish' not in pg.url or 'target=image' in pg.url:
            continue
        try:
            pg.evaluate(JS_LIB)
            r = pg.evaluate(JS_SCAN)
        except Exception:
            continue
        print('xhs tab %d: btn=%s' % (i, json.dumps(r.get('btn'), ensure_ascii=False)))
        if r.get('btn'):
            cands.append((i, pg))
    if not cands:
        print('NO TARGET'); sys.exit(1)
    target = cands[-1]
    i, pg = target
    print('== pick xhs tab %d ==' % i)
    shot(pg, 'labx_00_before.png')

    c = pg.evaluate(JS_CLICK)
    print('syn click ->', json.dumps(c, ensure_ascii=False)[:400])
    t0 = time.time()
    while time.time() - t0 < 40:
        time.sleep(4)
        r = scan(pg, 'syn+%d' % int(time.time() - t0))
        if gone(r):
            break
    shot(pg, 'labx_01_syn_end.png')
    r = scan(pg, 'syn_end')
    if gone(r):
        print('== SYN+composed WORKED =='); sys.exit(0)

    print('== TRUSTED fallback ==')
    m = pg.evaluate(JS_MEASURE)
    print('measure ->', json.dumps(m, ensure_ascii=False)[:200])
    if m.get('ok'):
        pg.bring_to_front(); time.sleep(0.6)
        pg.mouse.click(m['x'], m['y'])
        print('trusted click at', round(m['x']), round(m['y']))
        t1 = time.time()
        while time.time() - t1 < 60:
            time.sleep(4)
            r = scan(pg, 'tr+%d' % int(time.time() - t1))
            if gone(r):
                break
        shot(pg, 'labx_02_trusted_end.png')
        r = scan(pg, 'tr_end')
        print('== trusted worked ==' if gone(r) else '== still nothing ==')
    print('== DONE ==')
