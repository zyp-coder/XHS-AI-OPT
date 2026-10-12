# -*- coding: utf-8 -*-
"""联调③：抖音 —— MAIN world 装 input 钩子 → 打包版 NPA_DY_UPLOAD 加 2 图 →
NPA_DY_FILL 重填 → NPA_DY_SEND dry → 捕获拦截点击测试（绝不真发）。"""
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
    cls: String(btn.className || '').slice(0, 80), disabled: !!btn.disabled,
    x: Math.round(r.x), y: Math.round(r.y) };
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
            print('没找到抖音发布页：', [p.url for p in ctx.pages])
            return
        page.bring_to_front()
        time.sleep(0.5)
        print('url:', page.url)

        state = page.evaluate("() => ({imgs: (document.body.innerText.match(/已添加\\d+张图片/)||['无'])[0]})")
        print('before:', json.dumps(state, ensure_ascii=False))

        hook = page.evaluate('(' + npa['NPA_DY_HOOK'] + ')()')
        print('hook:', hook)

        # 图片已 ≥3 张就跳过重传（上传通路上一轮已验：3→5 张）
        cur = page.evaluate("() => { const m = document.body.innerText.match(/已添加(\\d+)张图片/); return m ? Number(m[1]) : 0; }")
        if cur < 3:
            for i, fp in enumerate(IMGS):
                b64 = base64.b64encode(open(fp, 'rb').read()).decode('ascii')
                key = 'pub:test:' + str(i) + '|' + fp.split('\\')[-1]
                r = page.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': key, 'b64': b64, 'done': True}))
                print('buf add', key, r)
            keys = ['pub:test:' + str(i) + '|' + fp.split('\\')[-1] for i, fp in enumerate(IMGS)]
            up = page.evaluate('(' + npa['NPA_DY_UPLOAD'] + ')(' + json.dumps({'keys': keys, 'isVideo': False}, ensure_ascii=True) + ')')
            print('upload:', json.dumps(up, ensure_ascii=False))
        else:
            print('upload skipped,已添加', cur, '张')

        fl = page.evaluate(js_call(npa['NPA_DY_FILL'], {
            'title': '联调标题·抖音版2',
            'body': '第一段：改版填字——全选替换一步到位。\n第二段：后面是话题芯片。',
            'tags': ['引流获客', '副业思维'],
        }))
        print('fill:', json.dumps(fl, ensure_ascii=False))
        time.sleep(0.6)

        dump = page.evaluate(r'''(() => {
          const ti = [...document.querySelectorAll('input')].find(i => /标题/.test(i.placeholder || ''));
          const ed = [...document.querySelectorAll('.zone-container[contenteditable], [contenteditable="true"]')].filter(e => e.getBoundingClientRect().width > 150)[0];
          return {title: (ti && ti.value) || '(none)',
                  text: (ed && ed.textContent || '').slice(0, 200),
                  chips: ed ? [...ed.querySelectorAll('[data-mention], span[data-e2e]')].map(s => s.textContent).slice(0, 8) : []};
        })()''')
        print('dump:', json.dumps(dump, ensure_ascii=False))

        dry = page.evaluate(js_call(npa['NPA_DY_SEND'], {'dry': True}))
        print('send(dry):', json.dumps(dry, ensure_ascii=False))

        tap = page.evaluate(JS_TAP_TEST)
        print('tap-test:', json.dumps(tap, ensure_ascii=False))

        page.screenshot(path=f'{SHOTS}/douyin_hook_rerun.png')
        print('shot ->', f'{SHOTS}/douyin_hook_rerun.png')


if __name__ == '__main__':
    main()
