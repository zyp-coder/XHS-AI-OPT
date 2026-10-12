# -*- coding: utf-8 -*-
"""真机自检：把 extension/ 当扩展装上，在真实浏览器里跑一趟出片台，出一条带配音的 MP4。

优先用本机装的 Edge（channel='msedge'，跟客户机一致、有 AAC），没有就退 Chrome，再退 Chromium。
用法：python3 scripts/dev/check_film_ext.py
落盘：%TEMP%/xhs_film_ext/出片台自检.mp4
"""
import base64
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
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_film_ext'
OUT.mkdir(parents=True, exist_ok=True)

# 短稿：3 幕、覆盖三种版式，出片快一点，够验完整链路
SCRIPT = ('一个人做小红书，凌晨还在发笔记。三个月过去，一个咨询都没有。\n'
          '真正管用的就三步：找对人，说对话，在他已经在的地方接住他。\n'
          '私信我，免费给你做一次测评。')


def launch(p):
    for kw in ({'channel': 'msedge'}, {'channel': 'chrome'}, {}):
        try:
            ctx = p.chromium.launch_persistent_context(
                str(OUT / 'profile'), headless=False, accept_downloads=True,
                args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], **kw)
            print('浏览器 =', kw.get('channel', 'chromium'))
            return ctx
        except Exception as e:
            print('起不来', kw.get('channel', 'chromium'), str(e)[:80])
    raise SystemExit('三种浏览器都起不来')


PROBE = """async () => {
  const out = {};
  const a = async (codec, extra) => {
    try {
      const r = await AudioEncoder.isConfigSupported(Object.assign(
        { codec, sampleRate: 24000, numberOfChannels: 1, bitrate: 96000 }, extra || {}));
      return !!r.supported;
    } catch (e) { return 'err: ' + (e && e.message); }
  };
  out['aac mp4a.40.2'] = await a('mp4a.40.2');
  out['aac 44k'] = await a('mp4a.40.2', { sampleRate: 44100 });
  out['opus'] = await a('opus');
  try {
    const v = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 8000000, framerate: 30 });
    out['h264'] = !!v.supported;
  } catch (e) { out['h264'] = 'err'; }
  out.hasAudioEncoder = typeof AudioEncoder !== 'undefined';
  return out;
}"""


def ext_id(ctx):
    t0 = time.time()
    while time.time() - t0 < 15:
        if ctx.service_workers:
            return ctx.service_workers[0].url.split('/')[2]
        time.sleep(0.3)
    raise SystemExit('没拿到扩展 ID')


with sync_playwright() as p:
    shutil.rmtree(OUT / 'profile', ignore_errors=True)   # 上一次是硬停的会留下锁：不清就会「浏览器已关闭」假报错
    ctx = launch(p)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))

    pg.goto(f'chrome-extension://{ext_id(ctx)}/video.html')
    print('页面 =', pg.url)
    print('UA =', pg.evaluate('() => navigator.userAgent'))
    print('是 Edge =', pg.evaluate('() => EdgeTTS.isEdge()'))
    print('编码器支持 =', pg.evaluate(PROBE))
    print('选的采样率 =', pg.evaluate('() => Voice.pickRate()'))
    print('字体 =', pg.evaluate('async () => { await Fonts.ready; return document.fonts.check(\'700 40px "Noto Sans SC"\'); }'))

    # ① 粘稿 → 生成分幕
    pg.fill('#script', SCRIPT)
    pg.click('#gen')
    pg.wait_for_timeout(400)
    n = pg.evaluate('() => Film.scenes.length')
    print('分幕 =', n, '幕', pg.evaluate('() => Film.scenes.map(s => s.layout)'))
    print('估算 =', pg.evaluate('() => document.getElementById("est").textContent'))

    # ② 出片
    t0 = time.time()
    pg.click('#go')
    for _ in range(300):                      # 最多等 10 分钟
        pg.wait_for_timeout(2000)
        st = pg.evaluate('() => document.getElementById("st").textContent')
        if '完成' in st or '失败' in st:
            break
    print('出片状态 =', st, f'（{time.time() - t0:.0f}s）')
    warn = pg.evaluate('() => { const w = document.getElementById("warn"); return w.hidden ? "" : w.textContent; }')
    if warn:
        print('提示 =', warn)

    blob = pg.evaluate('() => Film.lastBlob ? { size: Film.lastBlob.size, name: Film.lastName } : null')
    print('产物 =', blob)
    if blob:
        b64 = pg.evaluate("""async () => {
          const buf = new Uint8Array(await Film.lastBlob.arrayBuffer());
          let s = ''; const CH = 0x8000;
          for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
          return btoa(s);
        }""")
        out = OUT / '出片台自检.mp4'
        out.write_bytes(base64.b64decode(b64))
        print('落盘 =', out, f'{out.stat().st_size / 1048576:.1f}MB')
        print('时间轴 =', pg.evaluate('() => ({ dur: Film.tl.dur, scenes: Film.tl.scenes.map(s => [+s.start.toFixed(2), +s.end.toFixed(2)]) })'))

    if errs:
        print('--- 控制台 ---')
        for e in errs[:12]:
            print(' ', e)
    ctx.close()
