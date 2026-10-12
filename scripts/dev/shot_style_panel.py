# -*- coding: utf-8 -*-
"""调风格面板自检：截「面板 UI」+ 若干组配置下的整屏静帧，人工过一眼版式有没有坏。

用法：
    python3 scripts/dev/shot_style_panel.py            # 只截图
    python3 scripts/dev/shot_style_panel.py --export   # 另外真出一版 MP4（验编码链路）
输出：%TEMP%/xhs_style_check/*.png|*.mp4
"""
import os
import pathlib
import sys
from playwright.sync_api import sync_playwright

EXPORT = '--export' in sys.argv
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # Windows 控制台默认 GBK，打印中文会炸
except Exception:
    pass
ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGE = ROOT / '资料' / '视频' / '客户模板样片' / '调风格.html'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_style_check'
OUT.mkdir(parents=True, exist_ok=True)

# (文件名, 配置覆盖, 取哪一秒, 可选：截图前执行的 JS)
# 默认稿子是 6 幕演示（覆盖 4 种版式）：01 居中 0.8–7.01 / 02 左对齐 7.01–11.57 /
# 03 要点列表 11.57–17.18 / 04 数字幕 17.18–22.14 / 05 居中 22.14–26.1 / 06 收口 26.1–30.24
CASES = [
    ('1-居中一句话-01痛点', {}, 3.9, None),
    ('2-左对齐-02观点', {}, 9.3, None),
    ('3-要点列表-03关键', {}, 14.4, None),
    ('4-数字幕-04打法', {}, 19.7, None),
    ('5-居中-06收口CTA', {}, 28.2, None),
    ('6-米白纸感-列表', {'bg': 'paper', 'accent': '#B5542F', 'font': 'serif', 'em': 'swipe',
                    'texture': 'paper', 'label': 'tag', 'leading': 'normal'}, 14.4, None),
    ('7-浅灰科技-数字幕', {'bg': 'light', 'accent': '#2563EB', 'label': 'rule',
                     'texture': 'grid', 'font': 'sans'}, 19.7, None),
    ('8-藏蓝青绿-左对齐', {'bg': 'navy', 'accent': '#14B8A6', 'label': 'hair', 'pace': 'snappy',
                     'font': 'sans', 'texture': 'grid'}, 9.3, None),
    ('9-楷体-居中', {'bg': 'dark', 'font': 'kai', 'accent': '#D4AF37', 'glow': 'off',
                  'label': 'bar', 'size': 'l'}, 24.1, None),
    ('10-长句自动断行', {'bg': 'paper', 'font': 'serif', 'size': 'l'},
     3.4, "() => { const s = window._TL().scenes[0];"
          " s.lines = ['一个人做小红书，凌晨还在发笔记，三个月过去，一个咨询都没有。'];"
          " s.em = [{l: 0, t: '一个咨询都没有'}]; }"),
    ('11-片头', {}, 0.42, None),
]


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctxb = b.new_context(viewport={'width': 1600, 'height': 950}, accept_downloads=True)
        pg = ctxb.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.goto(PAGE.as_uri())
        pg.wait_for_timeout(900)
        pg.evaluate('() => window._fonts()')   # 等内置字体就绪，否则静帧是回退字体画的
        pg.wait_for_timeout(300)

        # 内置字体到底有没有生效：拿同一个 woff2 用另一个家族名注册，两边像素一样才算数
        # （本机装了同款系统字体，只比家族名会被系统字体蒙混过去）
        probe = pg.evaluate("""async () => {
            const c = document.createElement('canvas');
            c.width = 900; c.height = 140;
            const x = c.getContext('2d');
            const draw = fam => {
                x.fillStyle = '#000'; x.fillRect(0, 0, 900, 140);
                x.fillStyle = '#fff'; x.font = '700 62px ' + fam; x.textBaseline = 'middle';
                x.fillText('一个人做小红书，凌晨', 10, 70);
                return c.toDataURL();
            };
            const f = new FontFace('__emb_probe__', 'url(fonts/NotoSansSC-subset.woff2)');
            await f.load();
            document.fonts.add(f);
            const reg = [...document.fonts].filter(d => d.family.indexOf('Noto') >= 0);
            return {
                same: draw('"Noto Sans SC"') === draw('"__emb_probe__"'),
                differsFromFallback: draw('"Noto Sans SC"') !== draw('"HarmonyOS Sans SC"'),
                status: reg.map(d => d.family + ':' + d.status).join(' '),
            };
        }""")
        print('内置字体：', '✅ 生效' if probe['same'] else '❌ 与内置文件不一致（落回系统字体了）')
        print('  已注册：', probe['status'], '' if probe['differsFromFallback'] else '⚠️ 与回退字体渲染相同，复核 fonts.js')

        if EXPORT:
            pg.evaluate("() => window._draw(14.4, Object.assign({}, Renderer.DEFAULT_CFG,"
                        " {bg:'navy', accent:'#14B8A6', label:'rule', font:'sans', texture:'grid'}))")
            n = pg.evaluate('() => Math.round(window._TL().dur * 30)')
            print(f'开始导出（{n} 帧，等一会儿）…')
            pg.set_default_timeout(300000)
            with pg.expect_download(timeout=300000) as d:
                pg.click('#export')
            f = OUT / 'panel-export.mp4'
            d.value.save_as(str(f))
            print('导出 →', f, f.stat().st_size, 'bytes')
            print('面板提示：', pg.text_content('#msg'))

        pg.screenshot(path=str(OUT / '0-面板UI.png'))
        print('面板 UI →', OUT / '0-面板UI.png')

        pg.evaluate('window._pause()')
        # 把预览放大到 1:1（不动 DOM 结构，播放循环还活着）
        pg.evaluate("""() => {
            const cv = document.getElementById('cv');
            cv.style.width = '1080px'; cv.style.height = '1920px'; cv.style.borderRadius = '0';
            document.querySelector('main').style.height = 'auto';
            document.querySelector('.stage').style.overflow = 'visible';
            document.querySelector('.panel').style.display = 'none';
            document.documentElement.style.overflow = 'visible';
            document.body.style.overflow = 'visible';
        }""")
        pg.wait_for_timeout(200)

        for name, cfg, t, js in CASES:
            # 每例都从默认配置起手再套覆盖，避免上一例的旋钮漏到下一例
            pg.evaluate('([c, tt]) => window._draw(tt, Object.assign({}, Renderer.DEFAULT_CFG, c))', [cfg, t])
            if js:
                pg.evaluate(js)
                pg.evaluate('(tt) => window._draw(tt, null)', t)
            pg.wait_for_timeout(120)
            box = pg.locator('#cv').bounding_box()
            pg.screenshot(path=str(OUT / (name + '.png')), full_page=True,
                          clip={'x': box['x'], 'y': box['y'], 'width': box['width'], 'height': box['height']})
            print(name, '→', t, 's', cfg or '(默认)')

        state = pg.evaluate('window._state()')
        print('页面状态：', {k: state[k] for k in ('t', 'audioOk', 'playing')})
        print('cfg：', pg.evaluate('document.getElementById("cfgline").textContent'))
        b.close()

    if errs:
        print('\n⚠️ 控制台报错：')
        for e in errs[:20]:
            print('  ', e)
        return 1
    print('\n无控制台报错。输出目录：', OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
