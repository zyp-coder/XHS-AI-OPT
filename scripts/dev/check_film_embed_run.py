# -*- coding: utf-8 -*-
"""出片台内嵌版（弹窗 iframe）的两件真事——不是点开看看，是真出片：

  1) 出片中途切走左栏（iframe 被藏起来）：编码照跑不误，成片照样落地
  2) 成片是从弹窗里的 iframe 里点下载出来的：浏览器得放行（存得下、大小对得上）

跑法：python3 scripts/dev/check_film_embed_run.py
配音那条免费口子（Edge TTS）在这里桩掉——只验「编码 + 下载」，画面与音频都真编。
"""
import pathlib
import shutil
import time
import os
import sys

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'xhs_film_embed_run'
OUT.mkdir(parents=True, exist_ok=True)

SCRIPT = '第一段口播。\n第二段口播，收个尾。'


def boot(p):
    """起浏览器 + 装真扩展（playwright 默认塞的 --disable-extensions 跟 --load-extension 会撞车，装不上就重来）"""
    for i in range(5):
        prof = OUT / ('profile' if i == 0 else 'profile%d' % i)
        shutil.rmtree(prof, ignore_errors=True)
        ctx = p.chromium.launch_persistent_context(
            str(prof), headless=False, channel='msedge', accept_downloads=True,
            ignore_default_args=['--disable-extensions'],
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        t0 = time.time()
        while time.time() - t0 < 25 and not ctx.service_workers:
            time.sleep(0.3)
        if ctx.service_workers:
            return ctx
        print('  扩展没装起来（第 %d 趟），重来' % (i + 1), flush=True)
        ctx.close()
    raise RuntimeError('扩展装不上：连试 5 趟都没有 service worker')


with sync_playwright() as p:
    ctx = boot(p)
    errs = []
    page = ctx.new_page()
    page.set_viewport_size({'width': 1160, 'height': 900})
    page.set_default_timeout(30000)
    page.on('pageerror', lambda e: errs.append(str(e)))
    eid = ctx.service_workers[0].url.split('/')[2]
    page.goto(f'chrome-extension://{eid}/popup.html?mode=big')
    page.wait_for_function('typeof switchMainTab === "function"')
    if page.locator('#fsClose').is_visible():
        page.locator('#fsClose').click()
    # 出片台第一步先定「这一档要做成什么片」（不选就盖着进不去）——按档案那一行进来的口径进来
    page.evaluate('''() => { npGoFilm({ noteId: '', title: '内嵌自检那一篇', script: '', kind: 'PPT字体动效', shots: null }); return 1; }''')
    page.wait_for_function('''() => { const g = document.getElementById('filmGate');
        return !!g && getComputedStyle(g).display === 'none'; }''')
    page.wait_for_function('''() => { const f = document.getElementById('filmFrame');
        return !!(f && f.contentWindow && f.contentWindow.Film); }''')
    vf = [f for f in page.frames if 'video.html' in f.url][0]
    assert 'embed=1' in vf.url and vf.evaluate('document.documentElement.className') == 'embed', \
        '内嵌版该走紧凑样式（html.embed）'
    assert vf.evaluate('document.documentElement.scrollHeight <= innerHeight + 1'), \
        '内嵌版自己不该冒出滚动条（顶栏高度没算准时会多出几像素）'
    # 右侧两栏是横置 tab（① 口播稿 / ② 分幕；③ 音色 / ④ 风格 收进「⚙ 音色与风格」弹层）：
    # 一行放得下、不横向溢出（预览得按窗口高度缩，别把右边那栏挤出去）
    lay = vf.evaluate('''() => {
        const de = document.documentElement;
        const tabs = [...document.querySelectorAll('#filmTabs .ftab')];
        const clipped = tabs.filter(t => t.scrollWidth > t.clientWidth + 1).map(t => t.textContent.trim());
        return { n: tabs.length, labels: tabs.map(t => String((t.firstChild && t.firstChild.textContent) || '').trim()),
                 rows: [...new Set(tabs.map(t => Math.round(t.getBoundingClientRect().top)))].length,
                 overX: de.scrollWidth - innerWidth, on: document.querySelectorAll('.right .fsec.on').length, clipped };
    }''')
    assert lay['n'] == 2 and lay['labels'] == ['① 口播稿', '② 分幕'], \
        '右侧该是两条横置 tab（口播稿/分幕；音色·风格收进「⚙ 音色与风格」弹层），实际 %s' % lay['labels']
    assert lay['rows'] == 1, '两条 tab 该横在一行，实际排了 %d 行' % lay['rows']
    assert lay['overX'] <= 1, '内嵌版横向溢出了 %dpx（右栏被挤出弹窗）' % lay['overX']
    assert lay['on'] == 1, '一次只该开一栏，实际 %d' % lay['on']
    assert not lay['clipped'], 'tab 上的字被挤没：%s' % lay['clipped']
    print('PASS: 内嵌版两条横置 tab（① 口播稿 / ② 分幕）一行放下（无横向溢出），一次只开一栏', flush=True)

    # ① 口播稿框跟着预览的高度撑（过去固定 270px，稿子长就得在小框里滚）
    sz = vf.evaluate('''() => {
        const s = document.getElementById('script').getBoundingClientRect();
        const c = document.getElementById('cv').getBoundingClientRect();
        return { s: Math.round(s.height), sb: Math.round(s.bottom), cb: Math.round(c.bottom), ch: Math.round(c.height) };
    }''')
    assert sz['s'] > 300, '内嵌版口播稿框该跟着预览撑高（>300px），实际 %spx' % sz['s']
    assert abs(sz['sb'] - sz['cb']) < 120, '口播稿框底边该跟预览底边基本齐平：%s' % sz
    print('PASS: 内嵌版口播稿框 %spx（预览 %spx 高），底边与预览差 %spx'
          % (sz['s'], sz['ch'], abs(sz['sb'] - sz['cb'])), flush=True)

    # 桩掉配音（不联网），画面/音频照真编
    vf.evaluate('''() => {
        Voice.speak = async (scenes, o) => {
            const sr = o.sampleRate || 24000;
            const ac = new AudioContext({ sampleRate: sr });
            const parts = scenes.map(() => ac.createBuffer(1, Math.round(0.6 * sr), sr));
            await ac.close();
            return { parts, secs: parts.map(b => b.duration), sampleRate: sr };
        };
        return 1;
    }''')
    assert vf.evaluate('(t) => Film.loadScript(t)', SCRIPT) == 'ok'
    n_scenes = vf.evaluate('() => Film.scenes.length')
    print('分幕 =', n_scenes, flush=True)

    dls = []
    page.on('download', lambda d: dls.append(d))
    t0 = time.time()
    vf.locator('#go').click()

    # ① 出片刚起步就切走左栏：iframe 被 display:none 藏起来，编码该照跑
    page.wait_for_timeout(400)
    page.evaluate('switchMainTab("noteWrite")')
    hidden = page.evaluate('''() => {
        const c = document.getElementById('filmContent');
        return !!c && getComputedStyle(c).display === 'none';
    }''')
    assert hidden, '切走之后片台那一页该是藏起来的（这样才测得到「藏着也照编」）'
    assert vf.evaluate('() => Film.busy') is True, '切页那一刻它该正在出片'

    page.wait_for_function('''() => { const f = document.getElementById('filmFrame');
        return !!(f && f.contentWindow && f.contentWindow.Film.lastBlob); }''', timeout=180000)
    took = time.time() - t0
    size = vf.evaluate('() => Film.lastBlob.size')
    name = vf.evaluate('() => Film.lastName')
    assert size and size > 20000, '成片该有肉（实际 %r 字节）' % size
    print('PASS: 出片中途切走左栏，编码照跑完（%d 幕 · %d 字节 · %.1fs · %s）' % (n_scenes, size, took, name), flush=True)

    # ② 从 iframe 里点出来的下载，浏览器要放行
    t1 = time.time()
    while time.time() - t1 < 30 and not dls:
        page.wait_for_timeout(300)
    assert dls, '成片该被下载下来（iframe 里点出来的也得放行）'
    f_out = OUT / '成片.mp4'
    dls[0].save_as(str(f_out))
    got = f_out.stat().st_size
    assert got > 20000, '落盘的文件也得有肉（实际 %d 字节）' % got
    print('PASS: 成片从弹窗 iframe 里下载成功：%s（%d 字节，建议文件名 %s）'
          % (f_out, got, dls[0].suggested_filename), flush=True)

    # ③ 回片台看一眼：状态收干净了（不在出片中、按钮回到能点）
    page.evaluate('switchMainTab("noteFilm")')
    assert vf.evaluate('() => Film.busy') is False, '出完该把 busy 收掉'
    assert vf.evaluate('() => !document.getElementById("go").disabled'), '出完「开始」该能再点'
    print('PASS: 出完状态收干净（busy=false、「开始」可再点）', flush=True)

    shot = OUT / 'film-embed-done.png'
    page.screenshot(path=str(shot))
    print('SCREENSHOT:', shot, flush=True)

    # ④ 逃生口：单开一页（手上这份稿子要带过去，别让新页拿到旧的；单开那页是完整版布局）
    TYPED = '单开一页要带过去的稿子。'
    vf.locator('#filmTabs .ftab[data-sec="script"]').click()   # 分完幕停在②，要改稿先回①（两栏是横置 tab）
    vf.locator('#script').fill(TYPED)
    with ctx.expect_page(timeout=20000) as pinfo:
        vf.locator('#popout').click()
    vp = pinfo.value
    vp.wait_for_load_state()
    vp.wait_for_function('() => window.Film && document.getElementById("script").value')
    assert vp.evaluate('() => document.getElementById("script").value') == TYPED, '单开那页该是手上这份稿子'
    assert vp.evaluate('() => document.documentElement.className') == '', '单开那页该走完整版布局（不是 embed）'
    assert 'embed=1' not in vp.url, vp.url
    vp.close()
    print('PASS: 「在新标签页打开」单开一页，手上稿子带过去，layout 回完整版', flush=True)

    assert not errs, errs
    print('PASS: 无 pageerror', flush=True)
    ctx.close()
