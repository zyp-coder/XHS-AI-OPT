# -*- coding: utf-8 -*-
"""探针：Edge 打开 file:// 页面时，EdgeTTS 直连微软免费通道通不通（demo 里能不能真晓晓出声）。

沿用 check_film_ext.py 的起浏览器方式（channel='msedge'，有头）。
用法：python3 scripts/dev/_smoke_demo_tts.py
落盘：%TEMP%/xhs_tts_probe/probe.html（临时，跑完可删）
"""
import os
import pathlib
import shutil
import sys
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
LIB = (ROOT / 'extension/lib/video/tts-edge.js').read_text(encoding='utf-8')
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_tts_probe'
OUT.mkdir(parents=True, exist_ok=True)

HTML = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>tts probe</title></head><body>
<div id="out">idle</div>
<script>
__LIB__
</script>
<script>
async function go() {
  const o = document.getElementById('out');
  o.textContent = 'UA=' + navigator.userAgent + '\\nsecure=' + window.isSecureContext + '\\nisEdge=' + EdgeTTS.isEdge();
  try {
    const t0 = Date.now();
    const mp3 = await EdgeTTS.synth('防水施工前基层要怎么处理', { voice: 'zh-CN-XiaoxiaoNeural', rate: '+20%' });
    o.textContent += '\\nOK len=' + mp3.length + ' ms=' + (Date.now() - t0);
  } catch (e) {
    o.textContent += '\\nERR ' + ((e && e.message) || e);
  }
}
</script>
</body></html>"""

probe = OUT / 'probe.html'
probe.write_text(HTML.replace('__LIB__', LIB), encoding='utf-8')

with sync_playwright() as p:
    shutil.rmtree(OUT / 'profile', ignore_errors=True)
    ctx = None
    for kw in ({'channel': 'msedge'}, {}):
        try:
            ctx = p.chromium.launch_persistent_context(
                str(OUT / 'profile'), headless=False, **kw)
            print('浏览器 =', kw.get('channel', 'chromium'))
            break
        except Exception as e:
            print('起不来', kw.get('channel', 'chromium'), str(e)[:80])
    if ctx is None:
        raise SystemExit('浏览器起不来')

    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
    pg.goto(probe.as_uri())
    print('页面 =', pg.url)
    pg.evaluate('go()')
    t0 = time.time()
    txt = 'idle'
    while time.time() - t0 < 40:
        pg.wait_for_timeout(500)
        txt = pg.evaluate('() => document.getElementById("out").textContent')
        if 'OK len=' in txt or 'ERR ' in txt:
            break
    print('结果 =\n' + txt)
    if errs:
        print('--- 控制台 ---')
        for e in errs[:10]:
            print(' ', e)
    ctx.close()
