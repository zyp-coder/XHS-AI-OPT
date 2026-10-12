# -*- coding: utf-8 -*-
"""自测：三十二改 ?v=51——视频生成台三补（① 取景 / ② 时间线 / ③ 真晓晓）在 Edge + file:// 下过一遍。

用法：python3 scripts/dev/_smoke_g32.py
自测前清 profile（脚本里做）；截图落 tmp/_g32_shots/。
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
DEMO = ROOT / 'tmp' / '三方向demo.html'
SHOTS = ROOT / 'tmp' / '_g32_shots'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_g32_probe'
BAD = []


def check(name, cond, extra=''):
    if not cond:
        BAD.append(name)
    print(('  ✓ ' if cond else '  ✗ ') + name + (f' — {extra}' if extra else ''))


def drag(pg, x1, y1, x2, y2, steps=10):
    pg.mouse.move(x1, y1)
    pg.mouse.down()
    for i in range(1, steps + 1):
        pg.mouse.move(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps)
    pg.mouse.up()


def rect(pg, sel):
    return pg.evaluate(
        '() => { const e = document.querySelector(%r); if (!e) return null; e.scrollIntoView({block:"center"});'
        ' const r = e.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; }' % sel)


def shot(pg, sel, name):
    pg.locator(sel).first.screenshot(path=str(SHOTS / name))


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        shutil.rmtree(OUT / 'profile', ignore_errors=True)
        ctx = None
        for kw in ({'channel': 'msedge'}, {}):
            try:
                ctx = p.chromium.launch_persistent_context(
                    str(OUT / 'profile'), headless=False, viewport={'width': 1360, 'height': 860}, **kw)
                print('浏览器 =', kw.get('channel', 'chromium'))
                break
            except Exception as e:
                print('起不来', kw.get('channel', 'chromium'), str(e)[:80])
        if ctx is None:
            raise SystemExit('浏览器起不来')

        pg = ctx.new_page()
        pg.set_default_timeout(15000)
        errs = []
        pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        pg.goto(DEMO.as_uri())
        pg.wait_for_timeout(500)

        # ── 进生成台 ──
        pg.evaluate('navG()')
        pg.wait_for_timeout(400)
        check('进生成台（① 进料）', pg.evaluate('!!document.getElementById("gCv")'))
        check('Edge 里跑（真晓晓前提）', pg.evaluate('(navigator.userAgent||"").includes(" Edg/")'))

        # ── ① 默认取景＝现在的居中裁剪（老档一样） ──
        d = pg.evaluate('''() => {
          const m = MATS[gMat]; const f = gFitOf(m);
          const win = gFitWin(m, 640, 360);
          return { isOn: gFitIsOn(m), z: f.z, cx: f.cx, cy: f.cy, contain: !!f.contain, win: win };
        }''')
        check('默认取景＝居中裁满（z=1 cx=cy=.5）', (not d['isOn']) and d['z'] == 1 and d['cx'] == .5 and d['cy'] == .5)
        check('默认窗口＝居中裁剪', abs(d['win']['x'] - 218.75) < .5 and abs(d['win']['w'] - 202.5) < .5 and abs(d['win']['h'] - 360) < .5,
              f"x={d['win']['x']:.1f} w={d['win']['w']:.1f} h={d['win']['h']:.1f}")
        check('预置段有讲解词（🔊 有词可听）', pg.evaluate('!!(MATS[gMat].segs[0].vo)'), pg.evaluate('MATS[gMat].segs[0].vo')[:24] + '…')
        check('左侧没有 📐 标（没取过景）', not pg.evaluate('() => document.querySelector(".mat-menu").innerHTML.includes("取景调过")'))

        # ── ② 分镜扫描（进料后台扫，1.2s 出） ──
        pg.wait_for_timeout(1700)
        marks = pg.evaluate('() => (MATS[gMat].marks || []).length')
        check('分镜扫出 4 个切换点', marks == 4, f'marks={marks}')
        check('分镜横条渲染 4 个点', pg.evaluate('document.querySelectorAll("#tlMarks i").length') == 4)
        check('素材列表挂 🎬 4 徽章', pg.evaluate('() => document.querySelector(".mat-menu").innerHTML.includes("🎬 4")'))
        check('播放头在', pg.evaluate('!!document.getElementById("gTlHead")'))
        ra = pg.evaluate('document.getElementById("tlRa").textContent')
        rb = pg.evaluate('document.getElementById("tlRb").textContent')
        check('A/B 时间读数在', ra.startswith('A ') and rb.startswith('B '), f'{ra} / {rb}')
        shot(pg, '#tlBox', '01_tl_default.png')

        # ── ② 点分镜点跳转（150s 那个） ──
        pg.evaluate('document.querySelectorAll("#tlMarks i")[1].click()')
        pg.wait_for_timeout(200)
        t = pg.evaluate('gVid.t')
        check('点分镜点跳到 150s', abs(t - 150) < .1, f't={t}')
        hl = pg.evaluate('parseFloat(document.getElementById("gTlHead").style.left)')
        check('播放头跟到 29.76%', abs(hl - 150 / 504 * 100) < .1, f'left={hl}%')

        # ── ② 拖轨道＝scrub（拖哪看哪） ──
        r = rect(pg, '#tlTrack')
        drag(pg, r['x'] + r['w'] * .2, r['y'] + r['h'] / 2, r['x'] + r['w'] * .4, r['y'] + r['h'] / 2)
        pg.wait_for_timeout(150)
        t = pg.evaluate('gVid.t')
        hl = pg.evaluate('parseFloat(document.getElementById("gTlHead").style.left)')
        check('拖轨道，画面跟到 ~40%', abs(t - 201.6) < 3, f't={t:.1f}')
        check('播放头跟到 ~40%', abs(hl - 40) < .6, f'left={hl}%')

        # ── ② B 拖到 7:00 分镜点附近（轻吸） ──
        r = rect(pg, '#tlB')
        rd = rect(pg, '#tlTrack')
        drag(pg, r['x'] + r['w'] / 2, r['y'] + r['h'] / 2,
             rd['x'] + rd['w'] * (83.8 / 100), rd['y'] + rd['h'] / 2)
        pg.wait_for_timeout(150)
        b = pg.evaluate('ab.b')
        check('B 轻吸到分镜点 7:00', abs(b * 504 / 100 - 420) < .01, f'b={b:.4f}% → {b * 504 / 100:.2f}s')
        rb = pg.evaluate('document.getElementById("tlRb").textContent')
        check('B 读数=7:00', rb == 'B 7:00', rb)

        # ── ② A 拖到 2:30 分镜点附近（轻吸）＋ 画面跟到把手 ──
        r = rect(pg, '#tlA')
        rd = rect(pg, '#tlTrack')
        drag(pg, r['x'] + r['w'] / 2, r['y'] + r['h'] / 2,
             rd['x'] + rd['w'] * (29.5 / 100), rd['y'] + rd['h'] / 2)
        pg.wait_for_timeout(150)
        a = pg.evaluate('ab.a')
        check('A 轻吸到分镜点 2:30', abs(a * 504 / 100 - 150) < .01, f'a={a:.4f}% → {a * 504 / 100:.2f}s')
        ra = pg.evaluate('document.getElementById("tlRa").textContent')
        check('A 读数=2:30', ra == 'A 2:30', ra)
        check('画面跟到把手（A=150s）', abs(pg.evaluate('gVid.t') - 150) < 1)
        kl = pg.evaluate('parseFloat(document.getElementById("tlKeep").style.left)')
        kw = pg.evaluate('parseFloat(document.getElementById("tlKeep").style.width)')
        check('绿色取段条跟上（left=A width=B-A）', abs(kl - a) < .05 and abs(kw - (b - a)) < .05,
              f'left={kl:.2f}% w={kw:.2f}%')
        shot(pg, '#tlBox', '02_tl_after_ab.png')

        # ── ① 缩放滑块 ×2 ──
        pg.evaluate('''() => {
          const el = document.querySelector('#v-g input[type=range]');
          el.value = '2';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }''')
        pg.wait_for_timeout(300)
        d = pg.evaluate('''() => {
          const m = MATS[gMat]; const win = gFitWin(m, 640, 360);
          return { z: gFitOf(m).z, zv: document.getElementById("gFitZv").textContent,
                   win: win, on: gFitIsOn(m),
                   badge: document.querySelector(".mat-menu").innerHTML.includes("取景调过") };
        }''')
        check('滑块 ×2 生效', d['z'] == 2 and d['zv'] == '×2.00', f"z={d['z']} 读数={d['zv']}")
        check('框收窄（w=101.25）', abs(d['win']['w'] - 101.25) < .6 and abs(d['win']['h'] - 180) < .6,
              f"w={d['win']['w']:.2f} h={d['win']['h']:.2f}")
        check('左侧 📐 标亮起', d['badge'] and d['on'])

        # ── ① 拖取景框（按住白框挪位） ──
        r = rect(pg, '#gCv')
        cx0 = pg.evaluate('gFitOf(MATS[gMat]).cx')
        # 源坐标 640×360 里，框心现在在 (320,180)；往左拖 40 源像素
        x1 = r['x'] + 320 * r['w'] / 640
        y1 = r['y'] + 180 * r['h'] / 360
        drag(pg, x1, y1, x1 - 40 * r['w'] / 640, y1)
        pg.wait_for_timeout(150)
        cx1 = pg.evaluate('gFitOf(MATS[gMat]).cx')
        check('拖框挪位（cx 左移 40/640）', abs(cx1 - (cx0 - 40 / 640)) < .02, f'cx {cx0:.3f}→{cx1:.3f}')
        shot(pg, '#gCv', '03_fit_zoom_drag.png')

        # ── ① 整屏缩进（不裁不缩、滑块停用） ──
        pg.evaluate('() => [...document.querySelectorAll("#v-g .chip")].find(c => c.textContent.includes("整屏缩进")).click()')
        pg.wait_for_timeout(300)
        d = pg.evaluate('''() => {
          const m = MATS[gMat]; const f = gFitOf(m); const win = gFitWin(m, 640, 360);
          return { contain: !!f.contain, z: f.z, cx: f.cx, cy: f.cy, win: win,
                   dis: document.querySelector("#v-g input[type=range]").disabled };
        }''')
        check('整屏缩进开', d['contain'] and d['z'] == 1 and d['cx'] == .5 and d['cy'] == .5)
        check('整屏＝整个画面进片（占满整块）', d['win']['w'] == 640 and d['win']['h'] == 360 and d['win']['x'] == 0 and d['win']['y'] == 0,
              f"win={d['win']}")
        check('整屏时滑块停用', d['dis'] is True)
        shot(pg, '#gCv', '04_contain.png')

        # ── ① 复位 ──
        pg.evaluate('() => [...document.querySelectorAll("#v-g .chip")].find(c => c.textContent.includes("复位")).click()')
        pg.wait_for_timeout(300)
        d = pg.evaluate('''() => {
          const m = MATS[gMat]; const f = gFitOf(m);
          return { on: gFitIsOn(m), z: f.z, cx: f.cx, cy: f.cy, contain: !!f.contain,
                   dis: document.querySelector("#v-g input[type=range]").disabled,
                   badge: document.querySelector(".mat-menu").innerHTML.includes("取景调过") };
        }''')
        check('复位回默认', (not d['on']) and d['z'] == 1 and d['cx'] == .5 and d['cy'] == .5 and (not d['contain']))
        check('复位后滑块恢复、📐 标消失', (not d['dis']) and (not d['badge']))

        # ── ③ ① 里 🔊 听＝真晓晓（合成走 Edge 免费通道） ──
        note = pg.evaluate('() => document.querySelector("#v-g").innerHTML.includes("出片同一把嗓子（晓晓）")')
        check('段卡标注「试听＝出片同一把嗓子（晓晓）」', note)
        pg.evaluate('() => [...document.querySelectorAll("#v-g button")].find(b => b.textContent.includes("🔊 听")).click()')
        t0 = time.time()
        cache1 = 0
        while time.time() - t0 < 40:
            pg.wait_for_timeout(500)
            cache1 = pg.evaluate('Object.keys(SAY.cache).length')
            if cache1 >= 1:
                break
        fails = pg.evaluate('Object.keys(SAY.fail).length')
        check('🔊 听：晓晓合成出音频', cache1 >= 1, f'cache={cache1} fail={fails} 用时{time.time() - t0:.1f}s')

        # ── ② 大组装：预览画面＝取景框口径 + 播放整段＝晓晓 ──
        pg.evaluate('() => [...document.querySelectorAll("#v-g button")].find(b => b.textContent.includes("下一步")).click()')
        pg.wait_for_timeout(600)
        cv2 = pg.evaluate('''() => { const c = document.getElementById("aCv");
          return c ? { w: c.width, h: c.height } : null; }''')
        check('② 预览画布＝竖屏 540×960', cv2 is not None and cv2['w'] == 540 and cv2['h'] == 960, f'{cv2}')
        check('② 提示写了「取景框裁出来的」', pg.evaluate('() => document.querySelector("#v-g").innerHTML.includes("源片按 ① 取景框裁出来的")'))
        t0 = time.time()
        cache2 = 0
        while time.time() - t0 < 40:
            pg.wait_for_timeout(500)
            cache2 = pg.evaluate('Object.keys(SAY.cache).length')
            if cache2 >= 2:
                break
        check('② 进场预热：每条讲解都有晓晓音频', cache2 >= 2, f'cache={cache2} 用时{time.time() - t0:.1f}s')
        pg.evaluate('() => [...document.querySelectorAll("#v-g button")].find(b => b.textContent.includes("播放整段")).click()')
        pg.wait_for_timeout(1200)
        check('播放整段起了（预览在走）', pg.evaluate('aVid.playing'), f"t={pg.evaluate('aVid.t'):.1f}")
        ap = pg.evaluate('!!SAY.a')
        check('播放整段时有晓晓音频在放', ap)
        shot(pg, '#aCv', '05_preview.png')
        pg.evaluate('aVidStop()')

        # ── 全程无脚本报错 ──
        check('全程无控制台错误', not errs, '; '.join(errs[:3]))

        print()
        print('=' * 56)
        if BAD:
            print(f'不通过 {len(BAD)} 项：')
            for x in BAD:
                print('  ✗ ' + x)
        else:
            print('全部通过 ✓')
        print('截图在', SHOTS)
        ctx.close()
        return 1 if BAD else 0


if __name__ == '__main__':
    sys.exit(main())
