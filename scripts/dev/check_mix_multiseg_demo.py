# -*- coding: utf-8 -*-
"""混剪「一屏拼几段」样子稿·点击流自检（2026-10-23）

打开 tmp/混剪拼段demo.html，把出片台分幕那一栏的新玩法走一遍并截图：
  ① 开局四屏都「还没配」，顶上那栏报 0／4 屏有料
  ② 点「✨ AI 先配一版」→ 每屏排成几节料，尾巴不足 2 秒的那节被摊掉
  ③ 料差一点 → 末节标「↻ 从头再播 X 秒」；差半秒以内不标
  ④ 同屏几节按原片里的先后排（不是挑的顺序）
  ⑤ 段比这一屏长 → 末节被话截短
  ⑥ 照片屏不拼，一屏就一张
  ⑦ 音效不跟换屏响，跟字弹出来那一下响，且分三档（坑→咚 / 好处→啵 / 平常→轻一下）
  ⑧ 「▶ 走一遍这一屏」播放头扫过去：当前节高亮、走到 ↻ 那截点名「从头再播」
  ⑨ 删到料不够 → 报「还差几秒」，顶上那栏点名这一屏要补
  ⑩ 「🎞 挑画面」点一格＝往这一屏后面加一节，累计秒数当场报
任何页内报错都算失败。
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / 'tmp' / '混剪拼段demo.html'
SHOT = REPO / 'tmp' / '混剪拼段demo'
SHOT.mkdir(parents=True, exist_ok=True)
errs, results = [], []


def ok(name, cond, extra=''):
    results.append(('PASS' if cond else 'FAIL', name, extra))
    if not cond:
        print('  \u274c %s %s' % (name, extra))
    return cond


def shot(page, tag):
    page.screenshot(path=str(SHOT / (tag + '.png')), full_page=True)


def txt(page, sel):
    return page.evaluate("() => { const e = document.querySelector('%s'); return e ? e.innerText.replace(/\\s+/g,' ').trim() : ''; }" % sel)


def scene_txt(page, i):
    return txt(page, '.scene[data-scene="%d"]' % i)


def segs(page, i):
    return page.evaluate("() => (state.mats[%d] || []).map(m => ({ n:m.name, p:m.play, l:m.loop, k:m.kind }))" % i)


def main():
    if not DEMO.exists():
        print('找不到样子稿：', DEMO)
        return 1
    with sync_playwright() as p:
        br = p.chromium.launch(channel='msedge', headless=True)
        page = br.new_context(viewport={'width': 1320, 'height': 1020}).new_page()
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.goto(DEMO.as_uri())
        page.wait_for_timeout(400)

        body = txt(page, 'body')
        ok('\u2460 顶部标着样子稿＋四屏都在', '样子稿' in body and body.count('念 ') >= 4)
        ok('\u2460 顶上那栏报 0／4 屏有料', '0\uff0f4 屏有料' in txt(page, '#mixBar'), txt(page, '#mixBar')[:70])
        ok('\u2460 每屏都写「还没配」', txt(page, '.scene[data-scene="0"]').count('还没配') == 1)
        shot(page, '1-empty')

        page.click('#matAuto')
        page.wait_for_timeout(350)
        tip = txt(page, '#toast')
        ok('\u2461 配完报「摊掉碎尾／从头再播／被话截短」', '摊进前一节' in tip and '从头再播' in tip and '截短' in tip, tip[:110])
        shot(page, '2-auto')

        s0 = segs(page, 0)
        ok('\u2462 第 1 屏 2 节（4.2s ＋ 3.1s）', len(s0) == 2 and s0[0]['n'] == '客厅走场' and s0[1]['n'] == '门口换鞋', str(s0))
        ok('\u2462 那条 0.9 秒的碎尾没进画面', all(x['n'] != '墙面同一面' for x in s0))
        ok('\u2462 差 1.3 秒 → 末节标「从头再播 1.3 秒」', abs(s0[1]['l'] - 1.3) < 0.01, str(s0[1]))
        ok('\u2462 那一节的 ↻ 写在画面行里', '1.3' in scene_txt(page, 0) and '够 8.6s' in scene_txt(page, 0))

        s1 = segs(page, 1)
        ok('\u2463 第 2 屏按原片先后排（水电开槽 a=1 排在厨房拆旧 a=2 前面）',
           len(s1) == 3 and s1[0]['n'] == '水电开槽' and s1[1]['n'] == '厨房拆旧', str(s1))
        ok('\u2464 第 2 屏末节被话截短成 2.8 秒（段本身 3.4 秒）', abs(s1[2]['p'] - 2.8) < 0.01, str(s1[2]))
        ok('\u2464 截短不用从头再播（第 2 屏没有 ↻）', s1[2]['l'] == 0)

        s2 = segs(page, 2)
        ok('\u2463 第 3 屏只差 0.2 秒 → 不标、算够', len(s2) == 2 and s2[0]['l'] == 0 and s2[1]['l'] == 0
           and '够 10.4s' in scene_txt(page, 2), str(s2))

        s3 = segs(page, 3)
        ok('\u2465 照片屏不拼：就一张照片，写着「一屏就一张」',
           len(s3) == 1 and s3[0]['k'] == 'photo' and '照片屏不拼' in scene_txt(page, 3), str(s3))

        ok('\u2467 讲坑那句响「咚」', '咚' in scene_txt(page, 1), scene_txt(page, 1)[-60:])
        ok('\u2467 讲好处那句配「啵」', '啵' in scene_txt(page, 2))
        ok('\u2467 平常那句只「轻一下」', '轻一下' in scene_txt(page, 0))
        ok('\u2467 顶上那栏不再提「跟画面切走响」', '屏有料' in txt(page, '#mixBar'))

        # 播放头扫一遍第 1 屏
        page.click('.scene[data-scene="0"] button[data-run="0"]')
        page.wait_for_timeout(650)
        pop = page.evaluate("() => { const e = document.getElementById('fPop'); return (e.classList.contains('on') ? e.textContent : ''); }")
        ok('\u2468 走到弹字那一刻响一声（轻一下）', pop == '轻一下!', repr(pop))
        page.wait_for_timeout(7600)
        now = page.evaluate("() => { const e = document.querySelector('.mseg.now'); return e ? e.innerText.replace(/\\s+/g,' ').trim() : ''; }")
        tag = txt(page, '#fSeg')
        ok('\u2468 播放头走到第 2 节（高亮换了）', '门口换鞋' in now, now)
        ok('\u2468 走到 ↻ 那截点名「从头再播」', '从头再播' in tag, tag)
        shot(page, '3-run')
        page.wait_for_timeout(1400)

        # 删到料不够（一节从头再播最多补 3 秒，再多就报还差几秒）
        for _ in range(2):
            page.locator('.scene[data-scene="1"] .mseg .x').last.click()
            page.wait_for_timeout(250)
        sd = segs(page, 1)
        bar = txt(page, '#mixBar')
        ok('\u2469 删到只剩一节 → 从头再播封顶 3 秒', len(sd) == 1 and abs(sd[0]['l'] - 3) < 0.01, str(sd))
        ok('\u2469 报「还差 3.6s」', '还差 3.6s' in scene_txt(page, 1), scene_txt(page, 1)[-70:])
        ok('\u2469 顶上那栏点名要补一段', '屏料不够长' in bar and '再补一段' in bar, bar[:110])
        shot(page, '4-short')

        # 挑画面追加
        page.click('#matAuto')
        page.wait_for_timeout(300)
        page.click('.scene[data-scene="2"] button[data-open="2"]')
        page.wait_for_timeout(300)
        head = txt(page, '#matBox')
        ok('\u246a 挑画面这层写着「点一格就加到后面」', '加到这一屏后面' in head, head[:70])
        page.fill('#matQuery', '阳台')
        page.wait_for_timeout(200)
        n = page.evaluate("() => document.querySelectorAll('.matcell').length")
        ok('\u246a 按名字搜只剩对得上的那格', n == 1, str(n))
        page.locator('.matcell').first.click()
        page.wait_for_timeout(300)
        t2 = txt(page, '#toast')
        s2b = segs(page, 2)
        ok('\u246a 加完报累计秒数／要几秒', '累计' in t2 and '要念 10.4s' in t2, t2[:100])
        ok('\u246a 第 3 屏多了第三节', len(s2b) == 3, str(s2b))
        shot(page, '5-pick')

        # 音效旋钮
        page.click('.mixbar [data-sfx]')
        page.wait_for_timeout(250)
        ok('\u246b 音效切「不要」→ 每屏那一行撤掉', page.evaluate("() => document.querySelectorAll('.sfxrow').length") == 0
           and '不要' in txt(page, '#mixBar'))
        page.click('.mixbar [data-sfx]')
        page.wait_for_timeout(250)
        ok('\u246b 切回来还在（跟字响）', page.evaluate("() => document.querySelectorAll('.sfxrow').length") == 4)

        # 四条口径写在底下
        rules = txt(page, '#rules')
        ok('\u246c 底下四条规矩写全（摊碎尾／从头再播／不重复／照片屏不拼）',
           '不足 2 秒' in rules and '从头再播' in rules and '只用一次' in rules and '照片屏不拼' in rules)

        br.close()

    bad = [r for r in results if r[0] == 'FAIL']
    print('\n' + '\n'.join('%s %s%s' % ('\u2705' if r[0] == 'PASS' else '\u274c', r[1], (' ｜ ' + r[2]) if r[2] and r[0] == 'FAIL' else '') for r in results))
    print('\n页内报错 %d 条' % len(errs))
    for e in errs[:8]:
        print('  \u26a0\ufe0f', e[:140])
    print('\n\u2500\u2500 结论：%s（截图在 tmp/混剪拼段demo/）\u2500\u2500' % ('全绿' if not bad and not errs else '有 %d 项没过' % (len(bad) + len(errs))))
    return 0 if not bad and not errs else 1


if __name__ == '__main__':
    sys.exit(main())
