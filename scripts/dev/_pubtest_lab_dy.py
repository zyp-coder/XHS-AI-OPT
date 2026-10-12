# -*- coding: utf-8 -*-
"""抖音验证点击：关引导气泡 → 点真「发布」按钮（五连事件 composed:true）→ 观测成功信号/封面拦截
   老板已点头真发，发的就是测试稿。"""
import sys, os, json, time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SHOTS = 'D:/AIproject/小红书运营/tmp/pubtest_shots'

JS_DISMISS = """(() => {
  for (const e of document.querySelectorAll('button,div,span')) {
    const t = (e.innerText || '').trim();
    if (t !== '我知道了') continue;
    if (e.children.length > 1) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const o = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
    e.dispatchEvent(new PointerEvent('pointerdown', o));
    e.dispatchEvent(new MouseEvent('mousedown', o));
    e.dispatchEvent(new PointerEvent('pointerup', o));
    e.dispatchEvent(new MouseEvent('mouseup', o));
    e.dispatchEvent(new MouseEvent('click', o));
    return { ok: true, who: e.tagName + '.' + String(e.className || '').slice(0, 60) };
  }
  return { ok: false };
})()"""

JS_SCAN = """(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  const btns = [...document.querySelectorAll('button')].filter(b => /^(发布|发布并保存|暂存离开|保存草稿)$/.test((b.innerText || '').trim()) && vis(b))
    .map(b => ({ t: (b.innerText || '').trim(), cls: String(b.className || '').slice(0, 60), y: Math.round(b.getBoundingClientRect().y), dis: !!b.disabled || /disabled/i.test(String(b.className || '')) }));
  const toast = [];
  for (const e of document.querySelectorAll('[class*=toast],[class*=Toast],[class*=message],[class*=notice],[role=alert],[class*=modal],[class*=Modal]')) {
    try { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { const s = (e.innerText || '').trim(); if (s) toast.push(s.replace(/\\s+/g, ' ').slice(0, 130)); } } catch (e2) {}
  }
  const dialogs = [];
  for (const dlg of document.querySelectorAll('.semi-modal,[class*=semi-modal]')) {
    try { const r = dlg.getBoundingClientRect(); if (r.width > 0 && r.height > 0) {
      const bs = [...dlg.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
      dialogs.push({ txt: (dlg.innerText || '').replace(/\\s+/g, ' ').slice(0, 120), btns: bs.slice(0, 6) });
    } } catch (e2) {}
  }
  return { url: location.href, btns: btns.slice(0, 6), toast: toast.slice(0, 4), dialogs: dialogs.slice(0, 2), tail: (document.body ? document.body.innerText : '').slice(-200) };
})()"""

JS_CLICK = """(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
  const btns = [...document.querySelectorAll('button')].filter(b => /^(发布|发布并保存)$/.test((b.innerText || '').trim()) && vis(b));
  btns.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
  const btn = btns[0];
  if (!btn) return { ok: false, msg: 'no btn' };
  const r = btn.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  btn.dispatchEvent(new PointerEvent('pointerdown', o));
  btn.dispatchEvent(new MouseEvent('mousedown', o));
  btn.dispatchEvent(new PointerEvent('pointerup', o));
  btn.dispatchEvent(new MouseEvent('mouseup', o));
  btn.dispatchEvent(new MouseEvent('click', o));
  return { ok: true, target: { t: (btn.innerText || '').trim(), cls: String(btn.className || '').slice(0, 60) } };
})()"""

JS_CONFIRM = """(() => {
  for (const dlg of document.querySelectorAll('.semi-modal,[class*=semi-modal]')) {
    const r = dlg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    for (const b of dlg.querySelectorAll('button')) {
      const t = (b.innerText || '').trim();
      if (!/^(确定|确认|继续发布|继续|仍要发布|发表)$/.test(t)) continue;
      const br = b.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true, clientX: br.x + br.width / 2, clientY: br.y + br.height / 2, view: window };
      b.dispatchEvent(new PointerEvent('pointerdown', o));
      b.dispatchEvent(new MouseEvent('mousedown', o));
      b.dispatchEvent(new PointerEvent('pointerup', o));
      b.dispatchEvent(new MouseEvent('mouseup', o));
      b.dispatchEvent(new MouseEvent('click', o));
      return { ok: true, clicked: t };
    }
  }
  return { ok: false };
})()"""


def scan(pg, tag):
    try:
        r = pg.evaluate(JS_SCAN)
        print('[%s] %s' % (tag, json.dumps(r, ensure_ascii=False)[:700]))
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


def good(r):
    if not r:
        return False
    if '/content/manage' in r.get('url', ''):
        return True
    for t in (r.get('toast') or []):
        if '发布成功' in t or '作品发布成功' in t:
            return True
    return False


with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    cands = []
    for i, pg in enumerate(ctx.pages):
        u = pg.url
        if 'creator.douyin.com/creator-micro/content/post/video' not in u:
            continue
        try:
            r = pg.evaluate(JS_SCAN)
        except Exception:
            continue
        print('dy tab %d: btns=%s' % (i, json.dumps(r.get('btns'), ensure_ascii=False)[:280]))
        cands.append((i, pg))
    if not cands:
        print('NO TARGET'); sys.exit(1)
    i, pg = cands[-1]
    print('== pick dy tab %d ==' % i)
    d = pg.evaluate(JS_DISMISS)
    print('dismiss own-bubble ->', json.dumps(d, ensure_ascii=False)[:200])
    time.sleep(1)
    shot(pg, 'laby_00_before.png')

    c = pg.evaluate(JS_CLICK)
    print('click ->', json.dumps(c, ensure_ascii=False)[:300])
    if not c.get('ok'):
        print('NO BTN'); sys.exit(1)

    t0 = time.time()
    shots = {6: 'laby_01_s6.png', 25: 'laby_02_s25.png', 60: 'laby_03_s60.png', 95: 'laby_04_s95.png'}
    while True:
        time.sleep(4)
        el = time.time() - t0
        r = scan(pg, 't+%d' % int(el))
        if r and r.get('dialogs'):
            cf = pg.evaluate(JS_CONFIRM)
            print('confirm ->', json.dumps(cf, ensure_ascii=False)[:200])
        for k, fn in list(shots.items()):
            if el >= k:
                shot(pg, fn); del shots[k]
        if el >= 95 or good(r):
            break
    r = scan(pg, 'end')
    print('== good ==' if good(r) else '== no clear success ==')
    print('== DONE ==')
