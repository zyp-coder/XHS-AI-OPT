# -*- coding: utf-8 -*-
"""视频号过目态标签点击实验：合成五连点 → 静观25s → 可信点击(Playwright真实输入) → 静观65s
   目的：判定 run3「点了发表但90秒没见成功」的根因（合成事件不吃？按钮找错？点太早？）"""
import sys, os, json, time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

EXT = 'eihbinbapmhgbohapphjmabbkgiflljd'
SHOTS = 'D:/AIproject/小红书运营/tmp/pubtest_shots'

JS_SCAN = """(() => {
  const txt = (d) => { try { return d.body ? d.body.innerText : ''; } catch(e) { return ''; } };
  let out = txt(document), frameFound = false;
  for (const f of document.querySelectorAll('iframe')) {
    try { if (f.contentDocument) { const t = txt(f.contentDocument); if (/彩排/.test(t)) { out = t; frameFound = true; break; } } } catch(e) {}
  }
  const findDoc = () => {
    if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null; try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
    }
    return null;
  };
  const doc = findDoc();
  let btnInfo = null;
  if (doc) {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btns = [...doc.querySelectorAll('button,div,span')].filter(e => {
      const t = (e.innerText || '').trim();
      if (t !== '发表' && t !== '发布') return false;
      if (e.children.length > 2) return false;
      return vis(e);
    });
    btns.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
    const btn = btns[0];
    if (btn) btnInfo = { text: (btn.innerText || '').trim(), disabled: !!btn.disabled, tag: btn.tagName, cls: String(btn.className || '').slice(0, 90) };
  }
  const toast = [];
  if (doc) {
    for (const e of doc.querySelectorAll('[class*=toast],[class*=Toast],[class*=message],[class*=notice],[class*=tip],[role=alert],[class*=dialog],[class*=Dialog]')) {
      try { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { const t = (e.innerText || '').trim(); if (t) toast.push(t.replace(/\\s+/g, ' ').slice(0, 100)); } } catch (e2) {}
    }
  }
  return { url: location.href, frameFound, hasE2E: /视频号过目|三平台过目/.test(out), hasOldReh: /描述几步到位/.test(out), tail: (out || '').slice(-260), btn: btnInfo, toast: toast.slice(0, 6) };
})()"""

JS_CH_CLICK = """(() => {
  const findDoc = () => {
    if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null; try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
    }
    return null;
  };
  const doc = findDoc();
  if (!doc) return { ok: false, msg: 'no form' };
  const W = doc.defaultView || window;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const btns = [...doc.querySelectorAll('button,div,span')].filter(e => {
    const t = (e.innerText || '').trim();
    if (t !== '发表' && t !== '发布') return false;
    if (e.children.length > 2) return false;
    return vis(e);
  });
  btns.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
  const btn = btns[0];
  if (!btn) return { ok: false, msg: 'no btn' };
  const info = { text: (btn.innerText || '').trim(), disabled: !!btn.disabled };
  const r = btn.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: W };
  btn.dispatchEvent(new W.PointerEvent('pointerdown', o));
  btn.dispatchEvent(new W.MouseEvent('mousedown', o));
  btn.dispatchEvent(new W.PointerEvent('pointerup', o));
  btn.dispatchEvent(new W.MouseEvent('mouseup', o));
  btn.dispatchEvent(new W.MouseEvent('click', o));
  return { ok: true, info };
})()"""

JS_CH_SCROLL = """(() => {
  const findDoc = () => {
    if (document.querySelector('.input-editor, [class*="input-editor"]')) return document;
    for (const f of document.querySelectorAll('iframe')) {
      let d = null; try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return d;
    }
    return null;
  };
  const doc = findDoc();
  if (!doc) return { ok: false };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const btns = [...doc.querySelectorAll('button,div,span')].filter(e => {
    const t = (e.innerText || '').trim();
    if (t !== '发表' && t !== '发布') return false;
    if (e.children.length > 2) return false;
    return vis(e);
  });
  btns.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
  const btn = btns[0];
  if (!btn) return { ok: false, msg: 'no btn' };
  btn.scrollIntoView({ block: 'center' });
  return { ok: true };
})()"""

JS_CH_MEASURE = """(() => {
  const findFrame = () => {
    for (const f of document.querySelectorAll('iframe')) {
      let d = null; try { d = f.contentDocument; } catch (e) { continue; }
      if (d && d.querySelector('.input-editor, [class*="input-editor"]')) return { f: f, d: d };
    }
    return { f: null, d: document };
  };
  const ff = findFrame();
  const d = ff.d;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const btns = [...d.querySelectorAll('button,div,span')].filter(e => {
    const t = (e.innerText || '').trim();
    if (t !== '发表' && t !== '发布') return false;
    if (e.children.length > 2) return false;
    return vis(e);
  });
  btns.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
  const btn = btns[0];
  if (!btn) return { ok: false, msg: 'no btn' };
  const r = btn.getBoundingClientRect();
  const off = ff.f ? ff.f.getBoundingClientRect() : { x: 0, y: 0 };
  return { ok: true, x: off.x + r.x + r.width / 2, y: off.y + r.y + r.height / 2, disabled: !!btn.disabled, text: (btn.innerText || '').trim() };
})()"""


def scan(pg, tag):
    try:
        r = pg.evaluate(JS_SCAN)
        print('[%s] scan %s' % (tag, json.dumps(r, ensure_ascii=False)[:700]))
        return r
    except Exception as e:
        print('[%s] scan ERR %s' % (tag, str(e)[:200]))
        return None


def shot(pg, name):
    try:
        pg.screenshot(path=os.path.join(SHOTS, name), timeout=8000)
        print('shot', name)
    except Exception as e:
        print('shotfail', name, str(e)[:80])


with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]

    cand = []
    for i, pg in enumerate(ctx.pages):
        if '/platform/post/create' not in pg.url:
            continue
        r = scan(pg, 'ch%d' % i)
        if r and r.get('frameFound'):
            cand.append((i, pg, r))
    e2e = [(i, pg, r) for (i, pg, r) in cand if r.get('hasE2E')]
    print('== CH tabs: %d, e2e-filled: %s ==' % (len(cand), [i for i, _, _ in e2e]))
    if not e2e:
        print('NO E2E TAB'); sys.exit(1)
    idx, pg, r0 = e2e[0]
    print('== pick tab #%d %s ==' % (idx, pg.url))
    shot(pg, 'lab_ch_00_before.png')

    print('== SYN click ==')
    syn = pg.evaluate(JS_CH_CLICK)
    print('syn ->', json.dumps(syn, ensure_ascii=False)[:300])
    time.sleep(4)
    shot(pg, 'lab_ch_01_syn4.png'); scan(pg, 'syn4')
    time.sleep(8)
    shot(pg, 'lab_ch_02_syn12.png'); scan(pg, 'syn12')
    time.sleep(15)
    r = scan(pg, 'syn27')

    moved = (r and r.get('hasE2E') is False)
    print('== after syn: hasE2E=%s url=%s ==' % (bool(r and r.get('hasE2E')), (r or {}).get('url')))
    if moved:
        print('SYN CLICK MOVED PAGE — stop'); sys.exit(0)

    print('== TRUSTED click ==')
    sc = pg.evaluate(JS_CH_SCROLL)
    print('scroll ->', json.dumps(sc, ensure_ascii=False)[:200])
    time.sleep(1.2)
    m = pg.evaluate(JS_CH_MEASURE)
    print('measure ->', json.dumps(m, ensure_ascii=False)[:300])
    if not m.get('ok'):
        print('NO BTN'); sys.exit(1)
    pg.bring_to_front()
    time.sleep(0.6)
    pg.mouse.click(m['x'], m['y'])
    print('trusted click at', round(m['x']), round(m['y']))
    time.sleep(4)
    shot(pg, 'lab_ch_03_tr4.png'); scan(pg, 'tr4')
    time.sleep(10)
    shot(pg, 'lab_ch_04_tr14.png'); scan(pg, 'tr14')
    time.sleep(20)
    shot(pg, 'lab_ch_05_tr34.png'); r = scan(pg, 'tr34')
    print('== after trusted: hasE2E=%s url=%s ==' % (bool(r and r.get('hasE2E')), (r or {}).get('url')))
    if r and r.get('hasE2E'):
        time.sleep(30)
        shot(pg, 'lab_ch_06_tr64.png'); scan(pg, 'tr64')
    print('== DONE ==')
