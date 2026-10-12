# -*- coding: utf-8 -*-
"""check_note_draft.py 的 ④ 段按五十二/五十三改口径改写：
   ④ 唯一前进路＝点中某台样稿「就用这篇 →」（「先不挑 · 让 AI 写一篇」已撤）；
   重烧这一批的入口是页脚那颗「🔀 重写这批」（.np-wiz-again），旧的 .npVarGen 已不存在。"""
import io

P = r"D:\AIproject\小红书运营\scripts\dev\check_note_draft.py"
raw = io.open(P, "rb").read()
eol = "\r\n" if b"\r\n" in raw else "\n"
s = raw.decode("utf-8").replace("\r\n", "\n")

NEXT_OLD = "        expect(page.locator('.np-wiz-next')).to_have_text('先不挑 · 让 AI 写一篇 →')\n"
NEXT_NEW = "        assert page.locator('.np-wiz-next').count() == 0, '④ 唯一前进路＝点中某台样稿「就用这篇 →」（「先不挑 · 让 AI 写一篇」已撤）'\n"
assert s.count(NEXT_OLD) == 2, s.count(NEXT_OLD)
s = s.replace(NEXT_OLD, NEXT_NEW)

assert s.count("'#npWizBody .npVarGen'") == 3, s.count("'#npWizBody .npVarGen'")
s = s.replace("page.locator('#npWizBody .npVarGen').click()", "page.locator('.np-wiz-again').click()")

SUBS = [
    ("改完只提示\"这批是旧口径写的\"，不许自动再烧一发；点常驻的「🔁 重新 AI 生成这批」才按新口径重出",
     "改完只提示\"这批是旧口径写的\"，不许自动再烧一发；点页脚那颗「🔀 重写这批」才按新口径重出"),
    ("# 点常驻的「🔁 重新 AI 生成这批」＝按现在的口径重出（老板：「再加一个重新AI生成的按钮」）",
     "# 点页脚那颗「🔀 重写这批」＝按现在的口径重出（老板：「再加一个重新AI生成的按钮」）"),
    ("改口径只提示不重烧，点「🔁 重新 AI 生成这批」才按新口径重出",
     "改口径只提示不重烧，点「🔀 重写这批」才按新口径重出"),
]
for o, n in SUBS:
    assert s.count(o) == 1, (s.count(o), o[:30])
    s = s.replace(o, n)

assert "npVarGen" not in s
io.open(P, "w", encoding="utf-8", newline="").write(s.replace("\n", eol))
print("ok, eol=%r" % eol)
