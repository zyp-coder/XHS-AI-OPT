# -*- coding: utf-8 -*-
"""出片台第二趟：试听能不能放、风格改了记不记得住（存了刷新还在不在）。
用法：python3 scripts/dev/check_film_ext_ui.py
"""
import os
import pathlib
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

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / 'profile2'), headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}',
              '--autoplay-policy=no-user-gesture-required'])
    t0 = time.time()
    while time.time() - t0 < 15 and not ctx.service_workers:
        time.sleep(0.3)
    eid = ctx.service_workers[0].url.split('/')[2]
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    url = f'chrome-extension://{eid}/video.html'
    pg.goto(url)
    pg.wait_for_timeout(600)
    # profile2 是复用的：上一趟可能已经存过音色/风格/稿子，先清干净，下面那句「默认晓晓」才测得准
    pg.evaluate('() => chrome.storage.local.remove(["xhsFilmStyle", "xhsFilmVoice", "xhsFilmScript"])')
    pg.goto(url)
    pg.wait_for_timeout(600)

    def cfg():
        """③ 音色 / ④ 风格 收进「⚙ 音色与风格」弹层（#cfgMask）：要动这两块的控件先把弹层点开（开着就不重点）"""
        pg.evaluate('''() => { const m = document.getElementById('cfgMask');
            if (m && m.hidden) document.getElementById('cfgBtn').click(); }''')
        pg.wait_for_function('() => { const m = document.getElementById("cfgMask"); return !!m && !m.hidden; }')

    # ① 右侧两栏＝横置 tab：一行放下、同屏只开一栏、默认停在①口播稿（⑤卡片底图整块已撤，底图按画面表自动铺）
    lay = pg.evaluate('''() => {
        const tabs = [...document.querySelectorAll('#filmTabs .ftab')];
        return { labels: tabs.map(t => String((t.firstChild && t.firstChild.textContent) || '').trim()),
                 rows: [...new Set(tabs.map(t => Math.round(t.getBoundingClientRect().top)))].length,
                 on: [...document.querySelectorAll('.right .fsec.on')].map(s => s.getAttribute('data-sec')),
                 nSec: document.querySelectorAll('.right .fsec').length };
    }''')
    assert lay['labels'] == ['① 口播稿', '② 分幕'], lay['labels']
    assert lay['nSec'] == 2 and lay['rows'] == 1 and lay['on'] == ['script'], lay
    print('PASS: 右侧两栏是横置 tab（%s，一行放下），默认只开①口播稿；音色·风格在「⚙ 音色与风格」弹层里' % ' / '.join(lay['labels']))

    # ① 口播稿框把这一栏剩下的高度吃掉（不再是固定 270px）：量它跟右栏 / 预览的关系
    hh = pg.evaluate('''() => {
        const s = document.getElementById('script').getBoundingClientRect();
        const c = document.getElementById('cv').getBoundingClientRect();
        const r = document.querySelector('.right').getBoundingClientRect();
        const f = document.querySelector('.right .fsec.on').getBoundingClientRect();
        return { s: Math.round(s.height), ch: Math.round(c.height), rBottom: Math.round(r.bottom),
                 rH: Math.round(r.height), fBottom: Math.round(f.bottom), free: Math.round(r.bottom - f.bottom) };
    }''')
    assert hh['s'] > 260, '口播稿框该跟着栏高撑（>260px），实际 %spx' % hh['s']
    assert abs(hh['free']) <= 2, '右栏底下还空着 %spx（口播稿那一栏没撑满）' % hh['free']
    print('PASS: 口播稿框 %spx（右栏 %spx 高 · 预览 %spx 高），这一栏撑到底、没留空' % (hh['s'], hh['rH'], hh['ch']))

    # ① 试听：粘一段稿 → 点「🎬 生成分幕」（没配 AI → 本机规则兜底）→ 试听
    pg.fill('#script', '一个人做小红书，凌晨还在发笔记。\n真正管用的就三步：找对人，说对话，接住他。')
    pg.click('#gen')
    pg.wait_for_function('() => Film.scenes.length >= 2')
    print('分幕 =', pg.evaluate('() => Film.scenes.length'))
    assert pg.evaluate('() => document.querySelector(".right .fsec.on").getAttribute("data-sec")') == 'scenes', \
        '生成分幕后该自己落到②分幕（好接着改对白）'
    print('PASS: 生成分幕后自动落到②分幕')
    cfg()
    pg.click('#audition')
    for _ in range(60):
        pg.wait_for_timeout(1000)
        info = pg.evaluate('() => document.getElementById("audinfo").textContent')
        if info:
            break
    print('试听 =', info)
    print('时间轴 =', pg.evaluate('() => Film.tl && { dur: Film.tl.dur, sr: Film.sr }'))

    # ①-2 音色是一张表（音色 / 听感 / 适合），默认晓晓带「推荐」，点一行能换（表在「⚙ 音色与风格」弹层里）
    cfg()
    vt = pg.evaluate('''() => {
        const t = document.getElementById('voices');
        const on = t.querySelector('tr.vrow.on');
        return { head: [...t.querySelectorAll('th')].map(h => h.textContent.trim()),
                 rows: [...t.querySelectorAll('tr.vrow')].map(r => [...r.children].map(c => c.innerText.trim())),
                 on: on ? on.children[0].innerText.trim() : '' };
    }''')
    assert vt['head'] == ['音色', '听感', '适合'], vt['head']
    assert len(vt['rows']) == 5, '音色表该有 5 条：%s' % len(vt['rows'])
    assert vt['rows'][0][0].startswith('晓晓') and '推荐' in vt['rows'][0][0], vt['rows'][0]
    assert all(r[1] and r[2] for r in vt['rows']), '每条都要写听感与适合：%s' % vt['rows']
    assert vt['on'].startswith('晓晓'), '默认该选中晓晓：%r' % vt['on']
    assert pg.locator('#voices .chip').count() == 0, '音色不该再铺一排标签'
    pg.locator('#voices tr.vrow').nth(2).click()
    pg.wait_for_timeout(150)
    on2 = pg.evaluate('() => document.querySelector("#voices tr.vrow.on").children[0].innerText.trim()')
    chose = pg.evaluate('() => Film.voice')
    assert on2.startswith('云希') and chose == 'zh-CN-YunxiNeural', (on2, chose)
    print('PASS: 音色＝%s；默认选中「%s」，点第 3 行换到「%s」（Film.voice=%s）'
          % ('/'.join(r[0] for r in vt['rows']), vt['on'], on2, chose))

    # ② 改风格 → 存为默认 → 刷新看还在不在（「💾 存为默认风格」也在「⚙ 音色与风格」弹层里）
    pg.evaluate('() => { Film.cfg.accent = "#14B8A6"; Film.cfg.bg = "navy"; Film.cfg.label = "hair"; }')
    cfg()
    pg.click('#save')
    pg.wait_for_timeout(400)
    print('存 =', pg.evaluate('() => document.getElementById("saved").textContent'))

    pg.goto(url)
    pg.wait_for_timeout(800)
    print('刷新后 =', pg.evaluate('() => ({ accent: Film.cfg.accent, bg: Film.cfg.bg, label: Film.cfg.label })'))
    print('默认落在 =', pg.evaluate('() => document.querySelector(".right .fsec.on").getAttribute("data-sec")'),
          '(该是 script：口播稿)', ' tab=', pg.evaluate('() => [...document.querySelectorAll("#filmTabs .ftab")].map(b => b.textContent.trim())'))

    # ③ 旋钮 UI 有没有把当前值标出来
    print('旋钮数 =', pg.evaluate('() => document.querySelectorAll("#knobs .chip, #knobs input").length'),
          ' 选中数 =', pg.evaluate('() => document.querySelectorAll("#knobs .chip.on").length'))
    print('预设 =', pg.evaluate('() => [...document.querySelectorAll("#presets .chip")].map(c => c.textContent)'))
    if errs:
        print('页面报错 =', errs[:5])
    ctx.close()
