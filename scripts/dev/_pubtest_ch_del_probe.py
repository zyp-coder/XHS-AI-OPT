# -*- coding: utf-8 -*-
"""视频号删除按钮诊断：点「删除」→ dump 弹层 outerHTML → 找确认元素点它 → 验视频消失。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

JS_DEL_FIRST = r'''(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = [...document.querySelectorAll('button,div,span')].filter(e => {
    const t = (e.innerText || '').trim();
    return t === '删除' && e.children.length <= 1 && vis(e);
  })[0];
  if (!el) return { ok: false, msg: '没见删除' };
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return { ok: true, cls: String(el.className).slice(0, 60) };
})()'''

JS_DUMP_POP = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(700);
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pops = [...document.querySelectorAll('[class*="popover"],[class*="Popover"],[class*="dialog"],[class*="Dialog"]')]
    .filter(vis).map(p => ({
      cls: String(p.className).slice(0, 70),
      html: p.outerHTML.slice(0, 900),
      kids: [...p.querySelectorAll('*')].filter(e => vis(e) && (e.innerText || '').trim() && e.children.length <= 1)
        .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0, 50), t: (e.innerText || '').trim().slice(0, 16) })).slice(0, 10),
    }));
  return { pops };
})()'''

JS_CLICK_CONFIRM = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pops = [...document.querySelectorAll('[class*="popover"],[class*="dialog"]')].filter(vis);
  let el = null;
  for (const p of pops) {
    const cands = [...p.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === '删除' && vis(e) && e.children.length <= 2);
    if (cands.length) { el = cands[cands.length - 1]; break; }
  }
  if (!el) return { ok: false, msg: '弹层里没有删除钮' };
  const r = el.getBoundingClientRect();
  const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || el;
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  t.dispatchEvent(new PointerEvent('pointerdown', o));
  t.dispatchEvent(new MouseEvent('mousedown', o));
  t.dispatchEvent(new PointerEvent('pointerup', o));
  t.dispatchEvent(new MouseEvent('mouseup', o));
  t.dispatchEvent(new MouseEvent('click', o));
  await sleep(1200);
  const v = document.querySelector('video');
  const tip = (document.body.innerText || '');
  return { ok: true, clickedTag: el.tagName, videoGone: !v,
           uploadZone: /上传时长|时长不超过/.test(tip), tip: tip.slice(0, 200) };
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'channels.weixin.qq.com/platform/post/create' in p.url)
        page.bring_to_front()
        time.sleep(0.5)
        fr = next(f for f in page.frames if '/micro/content/post/create' in (f.url or ''))

        print('== 点删除 ==', json.dumps(fr.evaluate(JS_DEL_FIRST), ensure_ascii=False))
        print('== dump 弹层 ==', json.dumps(fr.evaluate(JS_DUMP_POP), ensure_ascii=False, indent=1))
        page.screenshot(path='tmp/pubtest_shots/ch_del_probe.png')
        print('== 点确认 ==', json.dumps(fr.evaluate(JS_CLICK_CONFIRM), ensure_ascii=False))
        page.screenshot(path='tmp/pubtest_shots/ch_del_done.png')


if __name__ == '__main__':
    main()
