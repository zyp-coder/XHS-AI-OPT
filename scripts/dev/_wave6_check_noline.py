# -*- coding: utf-8 -*-
"""check_diagnosis_ui.py：④ 没定线那段——把从没落地过的「没定线——上面挑一条线」断言
   换成真断言（这一页不许自己烧 AI）。"""
import io

P = r"D:\AIproject\小红书运营\scripts\dev\check_diagnosis_ui.py"
raw = io.open(P, "rb").read()
eol = "\r\n" if b"\r\n" in raw else "\n"
src = raw.decode("utf-8").replace("\r\n", "\n")

A_OLD = """            # 没底子（没排产项也没话题）时：④ 先让挑线，不自动烧钱
            page.evaluate('''() => { _npWiz.step = 3; _npWiz.topics = [];"""
A_NEW = """            # 没底子（没排产项也没话题）时：④ 先让挑线，不自动烧钱
            reqs_noline = len(STATE['requests'])
            page.evaluate('''() => { _npWiz.step = 3; _npWiz.topics = [];"""

B_OLD = """            expect(page.locator('#npWizBody')).to_contain_text('没定线——上面挑一条线')
"""
B_NEW = """            assert len(STATE['requests']) == reqs_noline, '没定线这一页不能自己打 AI'
"""

for o in (A_OLD, B_OLD):
    assert src.count(o) == 1, (src.count(o), o[:50])
assert '没定线——上面挑一条线' not in src.replace(B_OLD, '')

src = src.replace(A_OLD, A_NEW).replace(B_OLD, B_NEW)
io.open(P, "w", encoding="utf-8", newline="").write(src.replace("\n", eol))
print("ok, eol=%r" % eol)
