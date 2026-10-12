# -*- coding: utf-8 -*-
"""联调④：抖音「完整彩排」——reload 重开页（模拟发布台开新标签的干净状态）→
MAIN 钩子 → 分片喂 2 图 → NPA_DY_UPLOAD → NPA_DY_FILL（校验重试版）→
NPA_DY_SEND dry → 捕获拦截点击测试。绝不真发。"""
import base64
import json
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

ROOT = 'D:\\AIproject\\小红书运营'
SHOTS = 'tmp/pubtest_shots'
IMGS = [ROOT + '\\tmp\\npcard1_zoom.png', ROOT + '\\tmp\\npcard2_zoom.png']


def load_npa():
    out = subprocess.check_output(['node', 'scripts/dev/_npa_dump.js'], cwd=ROOT)
    return json.loads(out.decode('utf-8'))


def js_call(fn_src, arg):
    return '(' + fn_src + ')(' + json.dumps(arg, ensure_ascii=True) + ')'


JS_TAP_TEST = r'''(() => {
  const roots = [document];
  const walk = (node) => { for (const el of node.querySelectorAll('*')) { if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); } } };
  walk(document);
  let btn = null;
  for (const root of roots) {
    for (const e of root.querySelectorAll('button')) {
      const t = (e.innerText || '').trim();
      if ((t === '发布' || t === '发布并保存') && e.getBoundingClientRect().width > 0) { btn = e; break; }
    }
    if (btn) break;
  }
  if (!btn) return { ok: false, msg: '没找到发布按钮' };
  const hits = {};
  const mk = (n) => (ev) => { hits[n] = true; ev.stopImmediatePropagation(); ev.preventDefault(); };
  const kinds = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  const guards = {};
  kinds.forEach(k => { guards[k] = mk(k); btn.addEventListener(k, guards[k], true); });
  const r = btn.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  btn.dispatchEvent(new PointerEvent('pointerdown', o));
  btn.dispatchEvent(new MouseEvent('mousedown', o));
  btn.dispatchEvent(new PointerEvent('pointerup', o));
  btn.dispatchEvent(new MouseEvent('mouseup', o));
  btn.dispatchEvent(new MouseEvent('click', o));
  kinds.forEach(k => btn.removeEventListener(k, guards[k], true));
  return { ok: true, hits, text: (btn.innerText || '').trim(), tag: btn.tagName,
    disabled: !!btn.disabled, x: Math.round(r.x), y: Math.round(r.y) };
})()'''


def main():
    npa = load_npa()
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = None
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                page = p
                break
        if not page:
            print('没找到抖音发布页')
            return
        page.bring_to_front()
        time.sleep(0.5)

        page.reload(wait_until='load')
        print('reloaded')
        ready = False
        for _ in range(60):
            time.sleep(0.5)
            try:
                ready = page.evaluate("!!document.querySelector('.zone-container[contenteditable]')")
            except Exception:
                ready = False
            if ready:
                break
        print('editor ready:', ready, '| url:', page.url)

        print('hook:', page.evaluate('(' + npa['NPA_DY_HOOK'] + ')()'))

        for i, fp in enumerate(IMGS):
            b64 = base64.b64encode(open(fp, 'rb').read()).decode('ascii')
            key = 'pub:test:' + str(i) + '|' + fp.split('\\')[-1]
            r = page.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': key, 'b64': b64, 'done': True}))
            print('buf add', key, r)
        keys = ['pub:test:' + str(i) + '|' + fp.split('\\')[-1] for i, fp in enumerate(IMGS)]
        up = page.evaluate('(' + npa['NPA_DY_UPLOAD'] + ')(' + json.dumps({'keys': keys, 'isVideo': False}, ensure_ascii=True) + ')')
        print('upload:', json.dumps(up, ensure_ascii=False))

        fl = page.evaluate(js_call(npa['NPA_DY_FILL'], {
            'title': '彩排标题·抖音',
            'body': '第一段：彩排——干净页重开，全选替换一步到位。\n第二段：后面接话题芯片。',
            'tags': ['引流获客', '副业思维'],
        }))
        print('fill:', json.dumps(fl, ensure_ascii=False))

        # fill 返回后再盯 5 秒（半秒一采样），专门抓晚到的草稿回灌
        JS_TEXT = r'''(() => {
          const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
          return ed ? ed.textContent.replace(/\u200b/g,'').slice(0, 160) : '(no editor)';
        })()'''
        for tag, wait in [('+0.5s', 0.5), ('+1.5s', 1.0), ('+3s', 1.5), ('+5s', 2.0)]:
            time.sleep(wait)
            print('after fill', tag, ':', page.evaluate(JS_TEXT))
        time.sleep(0.5)

        dump = page.evaluate(r'''(() => {
          const ti = [...document.querySelectorAll('input')].find(i => /标题/.test(i.placeholder || ''));
          const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
          return {title: (ti && ti.value) || '(none)',
                  text: (ed && ed.textContent.replace(/\u200b/g,'') || '').slice(0, 200),
                  chips: ed ? [...ed.querySelectorAll('[data-mention]')].map(s => s.textContent).slice(0, 8) : []};
        })()''')
        print('dump:', json.dumps(dump, ensure_ascii=False))

        dry = page.evaluate(js_call(npa['NPA_DY_SEND'], {'dry': True}))
        print('send(dry):', json.dumps(dry, ensure_ascii=False))

        tap = page.evaluate(JS_TAP_TEST)
        print('tap-test:', json.dumps(tap, ensure_ascii=False))

        page.screenshot(path=f'{SHOTS}/douyin_rehearsal.png')
        print('shot ->', f'{SHOTS}/douyin_rehearsal.png')


if __name__ == '__main__':
    main()
