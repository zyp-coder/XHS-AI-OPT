# -*- coding: utf-8 -*-
"""一次性改写 check_diagnosis_ui.py 的 ④ 前进路口径（五十三改）：
   「先不挑 · 让 AI 写一篇」已撤，④ 唯一前进路＝点中某台样稿手机「就用这篇 →」。
   先断言旧文本在位，再整块替换，最后守住没有残留。"""
import io

P = r"D:\AIproject\小红书运营\scripts\dev\check_diagnosis_ui.py"
raw = io.open(P, "rb").read()
eol = "\r\n" if b"\r\n" in raw else "\n"
src = raw.decode("utf-8").replace("\r\n", "\n")

OLD = """            # 不挑也能往下走：④ 的下一步永远是「先不挑 · 让 AI 写一篇」
            page.evaluate('''() => { _npWiz.step = 3; return npWizRender(document.getElementById('notePublishContent')); }''')
            expect(page.locator('#npWizBody')).to_contain_text('④ 挑稿', timeout=10000)
            expect(page.locator('.np-wiz-next')).to_contain_text('先不挑 · 让 AI 写一篇 →')
            assert page.locator('.np-wiz-next').is_enabled(), '④ 不许有走不下去的死路'
            assert page.locator('.np-wiz-again').count() == 1, '④ 的「重写这批」在导航条上'
"""
NEW = """            # ④ 的前进路只有一条：点中哪台就走哪篇（「先不挑 · 让 AI 写一篇」已撤）
            page.evaluate('''() => { _npWiz.step = 3; return npWizRender(document.getElementById('notePublishContent')); }''')
            expect(page.locator('#npWizBody')).to_contain_text('④ 挑稿', timeout=10000)
            assert page.locator('.np-wiz-next').count() == 0, '④ 不再有「下一步」：挑稿才是唯一直通 ⑤ 的动作'
            assert page.locator('.np-wiz-again').count() == 1, '④ 的「重写这批」在导航条上'
            expect(page.locator('#npWizNav')).to_contain_text('挑中哪篇就走哪篇')
            assert page.locator('#npWizBody .npVarPick').count() == page.locator('#npWizBody .npPhone').count(), \\
                '④ 不许有走不下去的死路：摆出来的每台手机都要带「就用这篇 →」'
"""

OLD_MSG = "check(page, '④ 没底子（没线）时不烧 AI、只让挑一条线；「先不挑 · 让 AI 写一篇」永远可点＝没有死路')"
NEW_MSG = "check(page, '④ 没底子（没线）时不烧 AI、只让挑一条线；定了线后每台样稿都带「就用这篇 →」＝没有死路（「先不挑 · 让 AI 写一篇」已撤）')"

OLD_SUM = "改了指望「🔁 重新 AI 生成这批」"
NEW_SUM = "改了指望「🔀 重写这批」"

for o in (OLD, OLD_MSG, OLD_SUM):
    assert src.count(o) == 1, (src.count(o), o[:60])

src = src.replace(OLD, NEW).replace(OLD_MSG, NEW_MSG).replace(OLD_SUM, NEW_SUM)
assert 'expect(page.locator(\'.np-wiz-next\'))' not in src, '仍留着「先不挑」那条 expect'
assert src.count("np-wiz-next") >= 1
io.open(P, "w", encoding="utf-8", newline="").write(src.replace("\n", eol))
print("ok, eol=%r" % eol)
