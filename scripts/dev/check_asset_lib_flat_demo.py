# -*- coding: utf-8 -*-
"""素材库「平铺＋8 颗标签」样子稿·点击流自检（2026-10-24）

打开 tmp/素材库平铺demo.html，把新摆法走一遍并截图：
  ① 开局：所有段和照片平铺在一页（16 张卡），没有任何文件夹卡片
  ② 顶上就 8 颗标签，一颗不多；计数按折叠后的类算
  ③ 点「人物」只剩 2 段；再加一颗「现场/场景」＝取并集 6 段
  ④ 清空筛选回 16 段
  ⑤ 文件夹退成下拉：选「阳光小区」只剩 6 段
  ⑥ 搜「铲」只剩 1 段
  ⑦ 勾两段（一段备好、一段没备好）→ 底栏报「已选 2 段（1 段备好）」，按钮只带备好的 1 段
  ⑧ 「只看没标签的」只剩那 1 段
  ⑨ 「18 类怎么并成 8 颗」打开：8 个折叠块，「其他」里含价格 / 模板
  ⑩ 照片带「照片」角标，共 7 张
任何页内报错都算失败。
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / 'tmp' / '素材库平铺demo.html'
SHOT = REPO / 'tmp' / '素材库平铺demo'
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


def cards(page):
    return page.locator('.card').count()


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={'width': 1240, 'height': 1000})
        page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        page.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
        page.goto(DEMO.as_uri())
        page.wait_for_timeout(250)

        # ① 开局平铺
        ok('开局平铺 16 张卡', cards(page) == 16, 'actual=%d' % cards(page))
        ok('没有文件夹卡片', page.locator('.foldercard, .npl-foldercard').count() == 0)
        ok('统计行报共 16 段', '共 16 段' in txt(page, '#statLine'), txt(page, '#statLine'))
        shot(page, '01-开局平铺')

        # ② 就 8 颗标签
        chips = page.locator('.tchip')
        ok('顶上正好 8 颗标签', chips.count() == 8, 'actual=%d' % chips.count())
        counts = page.evaluate("() => window.NPL.counts()")
        want = {'人物': 2, '产品/材料': 1, '现场/场景': 4, '干活过程': 3,
                '前后对比': 2, '客户反馈': 2, '资质/凭据': 1, '其他': 2}
        ok('8 颗的计数按折叠后算对', counts == want, str(counts))

        # ③ 标签筛选：单颗 + 并集
        page.click('.tchip:has-text("人物")')
        page.wait_for_timeout(120)
        ok('点「人物」只剩 2 段', cards(page) == 2, 'actual=%d' % cards(page))
        page.click('.tchip:has-text("现场/场景")')
        page.wait_for_timeout(120)
        ok('再加「现场/场景」＝并集 6 段', cards(page) == 6, 'actual=%d' % cards(page))
        ok('两颗都亮着', page.locator('.tchip.on').count() == 2)
        shot(page, '02-两颗标签取并集')

        # ④ 清空
        page.click('#clear')
        page.wait_for_timeout(120)
        ok('清空筛选回 16 段', cards(page) == 16, 'actual=%d' % cards(page))

        # ⑤ 文件夹当下拉筛
        page.select_option('#folderSel', 'f1')
        page.wait_for_timeout(120)
        ok('选「阳光小区」只剩 6 段', cards(page) == 6, 'actual=%d' % cards(page))
        ok('下拉里有三个文件夹', page.locator('#folderSel option').count() == 4)
        shot(page, '03-文件夹下拉筛')

        # ⑥ 搜索
        page.fill('#q', '铲')
        page.wait_for_timeout(150)
        ok('搜「铲」只剩 1 段', cards(page) == 1, 'actual=%d' % cards(page))
        ok('搜到的正是「铲墙皮」', '铲墙皮' in txt(page, '.card'))
        shot(page, '04-搜索')
        page.click('#clear')
        page.wait_for_timeout(120)

        # ⑦ 勾选发案例
        page.click('.card[data-id="c1"] .pick')
        page.click('.card[data-id="c12"] .pick')
        page.wait_for_timeout(150)
        bar = txt(page, '#selBar')
        ok('底栏报已选 2 段（1 段备好）', '已选 2 段（1 段备好）' in bar, bar)
        ok('底栏点名 1 段没备好', '其中 1 段还差' in bar, bar)
        ok('按钮只带备好的 1 段', '用选中的 1 段发案例' in bar, bar)
        ok('勾中的卡有选中态', page.locator('.card.picked').count() == 2)
        shot(page, '05-勾选发案例')

        # ⑧ 只看没标签的
        page.click('#clear')
        page.wait_for_timeout(120)
        page.click('#onlyNoTag')
        page.wait_for_timeout(150)
        ok('只看没标签的只剩 1 段', cards(page) == 1, 'actual=%d' % cards(page))
        ok('那一段就是没起名那条', '还没起名' in txt(page, '.card'))
        shot(page, '06-只看没标签')
        page.click('#clear')
        page.wait_for_timeout(120)

        # ⑨ 折叠表
        page.click('#btnFold')
        page.wait_for_timeout(150)
        ok('折叠表打开了', page.locator('#mask.open').count() == 1)
        ok('折叠表 8 块', page.locator('.foldbox').count() == 8, 'actual=%d' % page.locator('.foldbox').count())
        other = page.locator('.foldbox').nth(7).inner_text()
        ok('「其他」里有价格和封面模板', ('价格/优惠信息' in other) and ('标题/封面模板' in other), other.replace('\n', ' '))
        shot(page, '07-折叠表')
        page.click('#foldClose')
        page.wait_for_timeout(120)
        ok('折叠表能关', page.locator('#mask.open').count() == 0)

        # ⑩ 照片角标
        ok('照片角标 7 张', page.locator('.kbadge:has-text("照片")').count() == 7,
           'actual=%d' % page.locator('.kbadge:has-text("照片")').count())
        ok('照片卡也在同一堆里（无单独分区）', page.locator('.grid > .card').count() == 16)
        ok('统计行报 7 张照片', '7 张照片' in txt(page, '#statLine'), txt(page, '#statLine'))

        ok('页内没有报错', not errs, ' | '.join(errs[:4]))

        b.close()

    fails = [r for r in results if r[0] == 'FAIL']
    print('\n%d 项：%d 过 / %d 失败' % (len(results), len(results) - len(fails), len(fails)))
    if fails:
        print('失败：')
        for f in fails:
            print('  - %s %s' % (f[1], f[2]))
        sys.exit(1)
    print('全绿')


if __name__ == '__main__':
    main()
