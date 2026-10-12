# -*- coding: utf-8 -*-
"""视频号修复逻辑验证：按「真 BUTTON + class 判禁用 + composed:true」点发表，全程观测
   → 抓真实成功信号 / 确认弹窗 / 失败提示。注：老板已点头真发，此实验发的就是测试稿。"""
import sys, os, json, time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SHOTS = 'D:/AIproject/小红书运营/tmp/pubtest_shots'
E2E_MARK = '这是发布链的彩排稿'

JS_FINDER = """const findDoc = () => {
  if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
  for (const f of document.querySelectorAll('iframe')) {
    let d = null; try { d = f.contentDocument; } catch (e) { continue; }
    if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
  }
  return null;
};
const pickBtn = (doc) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = [...doc.querySelectorAll('button,div,span')].filter(e => {
    const t = (e.innerText || '').trim();
    if (t !== '发表' && t !== '发布') return false;
    if (e.children.length > 2) return false;
    return vis(e);
  });
  cands.sort((a, b) => {
    const ba = a.tagName === 'BUTTON' ? 1 : 0, bb = b.tagName === 'BUTTON' ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
  });
  return cands;
};
const disOf = (el) => !!(el.disabled || /_disabled/.test(String(el.className || '')) || el.getAttribute('aria-disabled') === 'true');
"""

JS_SCAN = """(() => {
  %s
  const txt = (d) => { try { return d.body ? d.body.innerText : ''; } catch (e) { return ''; } };
  const doc = findDoc();
  let formHere = false, tail = '', toast = [], dialogs = [], btn = null;
  if (doc) {
    const t = txt(doc); formHere = t.indexOf('这是发布链的彩排稿') >= 0; tail = t.slice(-260);
    for (const e of doc.querySelectorAll('[class*=toast],[class*=message],[class*=notice],[role=alert]')) {
      try { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { const s = (e.innerText || '').trim(); if (s) toast.push(s.replace(/\\s+/g, ' ').slice(0, 90)); } } catch (e2) {}
    }
    for (const dlg of doc.querySelectorAll('.weui-desktop-dialog')) {
      try { const r = dlg.getBoundingClientRect(); if (r.width > 0 && r.height > 0) {
        const ti = dlg.querySelector('.weui-desktop-dialog__title');
        const bs = [...dlg.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
        dialogs.push({ title: (ti && ti.innerText || '').trim(), btns: bs.slice(0, 6) });
      } } catch (e2) {}
    }
    const cands = pickBtn(doc);
    if (cands.length) btn = { tag: cands[0].tagName, cls: String(cands[0].className || '').slice(0, 70), disabled: disOf(cands[0]), n: cands.length };
  }
  return { url: location.href, formHere, btn, toast: toast.slice(0, 4), dialogs: dialogs.slice(0, 3), tail };
})()""" % JS_FINDER

JS_CLICK = """(() => {
  %s
  const doc = findDoc();
  if (!doc) return { ok: false, msg: 'no form' };
  const W = doc.defaultView || window;
  const cands = pickBtn(doc);
  const summary = cands.map(e => ({ tag: e.tagName, cls: String(e.className || '').slice(0, 60), y: Math.round(e.getBoundingClientRect().y) }));
  const btn = cands[0];
  if (!btn) return { ok: false, msg: 'no btn' };
  if (disOf(btn)) return { ok: false, msg: 'still disabled', summary };
  const r = btn.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: W };
  btn.dispatchEvent(new W.PointerEvent('pointerdown', o));
  btn.dispatchEvent(new W.MouseEvent('mousedown', o));
  btn.dispatchEvent(new W.PointerEvent('pointerup', o));
  btn.dispatchEvent(new W.MouseEvent('mouseup', o));
  btn.dispatchEvent(new W.MouseEvent('click', o));
  return { ok: true, target: { tag: btn.tagName, cls: String(btn.className || '').slice(0, 70) }, summary };
})()""" % JS_FINDER

JS_CONFIRM = """(() => {
  %s
  const doc = findDoc();
  if (!doc) return { ok: false };
  const W = doc.defaultView || window;
  for (const dlg of doc.querySelectorAll('.weui-desktop-dialog')) {
    try { const r = dlg.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
      const bs = [...dlg.querySelectorAll('button')];
      const hit = bs.find(b => /^(确定|确认|继续|发表|确定发表|仍要发表)$/.test((b.innerText || '').trim()));
      if (!hit) continue;
      const hr = hit.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true, clientX: hr.x + hr.width / 2, clientY: hr.y + hr.height / 2, view: W };
      hit.dispatchEvent(new W.PointerEvent('pointerdown', o));
      hit.dispatchEvent(new W.MouseEvent('mousedown', o));
      hit.dispatchEvent(new W.PointerEvent('pointerup', o));
      hit.dispatchEvent(new W.MouseEvent('mouseup', o));
      hit.dispatchEvent(new W.MouseEvent('click', o));
      return { ok: true, clicked: (hit.innerText || '').trim() };
    } catch (e2) {}
  }
  return { ok: false };
})()""" % JS_FINDER

JS_SCROLL = """(() => {
  %s
  const doc = findDoc(); if (!doc) return { ok: false };
  const cands = pickBtn(doc); const btn = cands[0];
  if (!btn) return { ok: false, msg: 'no btn' };
  btn.scrollIntoView({ block: 'center' });
  return { ok: true };
})()""" % JS_FINDER

JS_MEASURE = """(() => {
  %s
  let frame = null;
  if (!(findDoc() === document)) {
    for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument === findDoc()) { frame = f; break; } } catch (e) {} }
  }
  const doc = findDoc(); if (!doc) return { ok: false };
  const cands = pickBtn(doc); const btn = cands[0];
  if (!btn) return { ok: false };
  const r = btn.getBoundingClientRect();
  const off = frame ? frame.getBoundingClientRect() : { x: 0, y: 0 };
  return { ok: true, x: off.x + r.x + r.width / 2, y: off.y + r.y + r.height / 2, disabled: disOf(btn) };
})()""" % JS_FINDER


def scan(pg, tag):
    try:
        r = pg.evaluate(JS_SCAN)
        line = json.dumps(r, ensure_ascii=False)
        print('[%s] %s' % (tag, line[:600]))
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


def done(r):
    if not r:
        return False
    if '/platform/post/list' in r.get('url', '') or '/platform/post/created' in r.get('url', ''):
        return True
    if not r.get('formHere') and not r.get('dialogs'):
        return True
    return False


with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    target = None
    for i, pg in enumerate(ctx.pages):
        if '/platform/post/create' not in pg.url:
            continue
        try:
            r = pg.evaluate(JS_SCAN)
        except Exception:
            continue
        has = r.get('formHere')
        print('ch tab %d: formHere=%s btn=%s' % (i, has, json.dumps(r.get('btn'), ensure_ascii=False)))
        if has and target is None:
            target = (i, pg)
    if target is None:
        print('NO TARGET TAB'); sys.exit(1)
    i, pg = target
    print('== pick ch tab %d ==' % i)
    shot(pg, 'lab2_ch_00_before.png')

    click = pg.evaluate(JS_CLICK)
    print('click ->', json.dumps(click, ensure_ascii=False)[:600])
    if not click.get('ok'):
        print('CLICK FAILED'); sys.exit(1)

    t0 = time.time()
    shots = {6: 'lab2_ch_01_s6.png', 20: 'lab2_ch_02_s20.png', 50: 'lab2_ch_03_s50.png', 95: 'lab2_ch_04_s95.png'}
    confirmed = False
    last = 0
    while True:
        el = time.time() - t0
        time.sleep(4)
        el = time.time() - t0
        r = scan(pg, 't+%d' % int(el))
        if r and r.get('dialogs') and not confirmed:
            c = pg.evaluate(JS_CONFIRM)
            print('confirm dialog ->', json.dumps(c, ensure_ascii=False))
            if c.get('ok'):
                confirmed = True
        for k, fn in list(shots.items()):
            if el >= k:
                shot(pg, fn); del shots[k]
        if time.time() - t0 >= 95:
            break
    print('== SYN phase over ==')

    r = scan(pg, 'syn_end')
    if r and r.get('formHere') and (not r.get('url', '').endswith('/post/list')):
        print('== no effect — TRUSTED fallback ==')
        sc = pg.evaluate(JS_SCROLL)
        print('scroll ->', json.dumps(sc, ensure_ascii=False)[:150])
        time.sleep(1.2)
        m = pg.evaluate(JS_MEASURE)
        print('measure ->', json.dumps(m, ensure_ascii=False)[:200])
        if m.get('ok') and not m.get('disabled'):
            pg.bring_to_front(); time.sleep(0.6)
            pg.mouse.click(m['x'], m['y'])
            print('trusted click at', round(m['x']), round(m['y']))
            t1 = time.time()
            while time.time() - t1 < 60:
                time.sleep(4)
                r = scan(pg, 'tr+%d' % int(time.time() - t1))
                if r and (done(r) or (r.get('toast') and any('成功' in x for x in r['toast']))):
                    break
            shot(pg, 'lab2_ch_05_trusted.png')
    print('== DONE ==')
