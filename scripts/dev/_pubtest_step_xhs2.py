# -*- coding: utf-8 -*-
"""联调②：小红书 —— 先给页面挂 pub-shadow-hook（add_init_script 模拟 document_start），
reload 后全链路重跑：传图（分片喂）→ 填字 → SEND dry → 捕获拦截点击测试。
红线：绝不真点发布（拦截测试里五类事件全部 stopImmediatePropagation）。"""
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
HOOK = ROOT + '\\extension\\lib\\pub-shadow-hook.js'
IMGS = [ROOT + '\\tmp\\npcard1_zoom.png', ROOT + '\\tmp\\npcard2_zoom.png']


def load_npa():
    out = subprocess.check_output(['node', 'scripts/dev/_npa_dump.js'], cwd=ROOT)
    return json.loads(out.decode('utf-8'))


def js_call(fn_src, arg):
    return '(' + fn_src + ')(' + json.dumps(arg, ensure_ascii=True) + ')'


# 捕获拦截点击测试：找到按钮后，五类事件全部在「目标捕获阶段」截断——
# 证明事件确实打到了这颗按钮（hit 各为 true），但应用自己的处理器一个都跑不到（绝不误发）
JS_TAP_TEST = r'''(() => {
  const roots = [document];
  const walk = (node) => { for (const el of node.querySelectorAll('*')) { if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); } } };
  walk(document);
  (window.__npaShadowRoots || []).forEach(r => { if (!roots.includes(r)) roots.push(r); });
  let btn = null;
  for (const root of roots) {
    for (const e of root.querySelectorAll('button')) {
      if ((e.innerText || '').trim() === '发布' && e.getBoundingClientRect().width > 0) { btn = e; break; }
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
    cls: String(btn.className || ''), inShadow: btn.getRootNode() !== document,
    x: Math.round(r.x), y: Math.round(r.y) };
})()'''


def main():
    npa = load_npa()
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = None
        for p in ctx.pages:
            if 'creator.xiaohongshu.com' in p.url and 'publish' in p.url:
                page = p
                break
        if not page:
            print('没找到小红书发布页')
            return
        page.bring_to_front()
        time.sleep(0.5)

        # ── 1) 挂钩子 + reload（reload 会清掉页面上现存的草稿填充，后面全部重来）──
        page.add_init_script(path=HOOK)
        page.reload(wait_until='load')
        print('reloaded')
        ready = False
        for _ in range(40):
            time.sleep(0.5)
            try:
                ready = page.evaluate("!!document.querySelector('.tiptap.ProseMirror, input[type=file]')")
            except Exception:
                ready = False
            if ready:
                break
        print('editor ready:', ready)

        hookinfo = page.evaluate(
            "() => ({ on: !!window.__npaShadowHookOn, roots: (window.__npaShadowRoots||[]).length,"
            " host: !!document.querySelector('xhs-publish-btn'),"
            " hostOpen: !!(document.querySelector('xhs-publish-btn') || {}).shadowRoot })")
        print('hook:', json.dumps(hookinfo, ensure_ascii=False))

        probe = page.evaluate(js_call(npa['NPA_PROBE'], {'pid': 'xhs'}))
        print('probe:', json.dumps(probe, ensure_ascii=False))

        # ── 2) 切图文页签 → 分片喂 2 张卡图 → 上传 ──
        tabr = page.evaluate(js_call(npa['NPA_XHS_TAB'], {'isVideo': False}))
        print('tab:', tabr)
        time.sleep(0.8)
        for i, fp in enumerate(IMGS):
            raw = open(fp, 'rb').read()
            b64 = base64.b64encode(raw).decode('ascii')
            key = 'pub:test:' + str(i) + '|' + fp.split('\\')[-1]
            r = page.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': key, 'b64': b64, 'done': True}))
            print('buf add', key, len(b64), r)
        keys = ['pub:test:' + str(i) + '|' + fp.split('\\')[-1] for i, fp in enumerate(IMGS)]
        up = page.evaluate('(' + npa['NPA_XHS_UPLOAD'] + ')(' + json.dumps({'keys': keys, 'isVideo': False}, ensure_ascii=True) + ')')
        print('upload:', json.dumps(up, ensure_ascii=False))

        # ── 3) 填字 ──
        fl = page.evaluate(js_call(npa['NPA_XHS_FILL'], {
            'title': '联调标题·开壳版',
            'body': '第一段：钩子版重跑，发布按钮应当抓得到了。\n第二段：话题芯片照旧。',
            'tags': ['引流获客', '副业思维'],
        }))
        print('fill:', json.dumps(fl, ensure_ascii=False))
        time.sleep(0.6)

        # ── 4) SEND dry ──
        dry = page.evaluate(js_call(npa['NPA_XHS_SEND'], {'dry': True}))
        print('send(dry):', json.dumps(dry, ensure_ascii=False))

        # ── 5) 捕获拦截点击测试（绝不真发）──
        tap = page.evaluate(JS_TAP_TEST)
        print('tap-test:', json.dumps(tap, ensure_ascii=False))

        page.screenshot(path=f'{SHOTS}/xhs_hook_rerun.png')
        print('shot ->', f'{SHOTS}/xhs_hook_rerun.png')


if __name__ == '__main__':
    main()
