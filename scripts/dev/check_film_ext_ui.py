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

    # 顶上那条＝这一篇的工作流（七十一改：「🎙 口播稿／🎬 分幕」两站并成一屏一站）：
    # 单开一页没有前头那几站可回，只剩 🎬 分幕 → 发布；一行放下、当前站那颗点亮（⑤卡片底图整块已撤，底图按画面表自动铺）
    lay = pg.evaluate('''() => {
        const ws = [...document.querySelectorAll('#flowBar .wst')];
        const lab = (x) => { const l = x.querySelector('.wlbl'); return String((l && l.firstChild ? l.firstChild.textContent : '')).trim(); };
        const cur = ws.find(x => !!x.querySelector('.wdot.cur'));
        return { labels: ws.map(lab),
                 rows: [...new Set(ws.map(x => Math.round(x.getBoundingClientRect().top)))].length,
                 on: cur ? lab(cur) : '',
                 nCol: document.querySelectorAll('.col').length,
                 steps: ['prevStep', 'nextStep'].filter(id => !!document.getElementById(id)) };
    }''')
    assert lay['labels'] == ['🎬 分幕', '发布'], lay['labels']
    assert lay['nCol'] == 2 and lay['rows'] == 1 and lay['on'] == '🎬 分幕', lay
    assert not lay['steps'], '底栏不该再有步进（一站一屏）：%s' % lay['steps']
    print('PASS: 顶上工作流条＝%s（一行放下），单开一页只这两站、亮在「🎬 分幕」；音色·风格在「⚙ 音色与风格」弹层里' % ' / '.join(lay['labels']))

    # 口播稿框把这一栏剩下的高度吃掉（不再是固定 270px）：量它跟栏高 / 预览的关系
    hh = pg.evaluate('''() => {
        const s = document.getElementById('script').getBoundingClientRect();
        const c = document.getElementById('cv').getBoundingClientRect();
        const r = document.querySelector('.col.script').getBoundingClientRect();
        return { s: Math.round(s.height), ch: Math.round(c.height), rBottom: Math.round(r.bottom),
                 rH: Math.round(r.height), fBottom: Math.round(s.bottom), free: Math.round(r.bottom - s.bottom) };
    }''')
    assert hh['s'] > 260, '口播稿框该跟着栏高撑（>260px），实际 %spx' % hh['s']
    # 底下只该留「那颗一路跑完的钮 + 字数」那一行（≈60px），不该空出一大截
    assert abs(hh['free']) <= 70, '稿栏底下还空着 %spx（口播稿框没撑满）' % hh['free']
    assert hh['fBottom'] <= hh['rBottom'] + 2, '口播稿框该出到栏底：%s' % hh
    print('PASS: 口播稿框 %spx（稿栏 %spx 高 · 预览 %spx 高），撑到只剩底下一行按钮' % (hh['s'], hh['rH'], hh['ch']))

    # ① 试听：粘一段稿 → 点那颗一路跑完（没配 AI → 本机规则兜底）→ 试听
    pg.fill('#script', '一个人做小红书，凌晨还在发笔记。\n真正管用的就三步：找对人，说对话，接住他。')
    pg.click('#gen')
    pg.wait_for_function('() => Film.scenes.length >= 2 && !Film.genBusy')
    print('分幕 =', pg.evaluate('() => Film.scenes.length'))
    assert pg.locator('.col.scenes').is_visible() and pg.locator('#scenes .scene').count() == pg.evaluate('() => Film.scenes.length'), \
        '切完幕右边那栏该跟着长出幕卡（一屏两栏，不用切站）'
    print('PASS: 一路跑完右边幕栏直接长出幕卡（同屏，不用再切站）', flush=True)
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
    print('默认亮在 =', pg.evaluate('''() => { const x = document.querySelector('#flowBar .wst'); if (!x) return '';
          const cur = [...document.querySelectorAll('#flowBar .wst')].find(y => y.querySelector('.wdot.cur'));
          const l = cur && cur.querySelector('.wlbl'); return l && l.firstChild ? String(l.firstChild.textContent).trim() : ''; }'''),
          '(该是分幕这一站)  工作流条=', pg.evaluate('''() => [...document.querySelectorAll('#flowBar .wst')].map(x => {
            const l = x.querySelector('.wlbl'); return l && l.firstChild ? String(l.firstChild.textContent).trim() : ''; })'''))

    # ③ 旋钮 UI 有没有把当前值标出来
    print('旋钮数 =', pg.evaluate('() => document.querySelectorAll("#knobs .chip, #knobs input").length'),
          ' 选中数 =', pg.evaluate('() => document.querySelectorAll("#knobs .chip.on").length'))
    print('预设 =', pg.evaluate('() => [...document.querySelectorAll("#presets .chip")].map(c => c.textContent)'))
    if errs:
        print('页面报错 =', errs[:5])
    ctx.close()
