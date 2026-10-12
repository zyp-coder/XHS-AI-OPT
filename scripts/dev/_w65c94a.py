# -*- coding: utf-8 -*-
"""check_note_imgwork.py 改口到六十五改：③ 只管断句 / ④ 一行两栏卡（★ 选句在这儿）/ ⑤ 只有合成视图"""
import io, os

p = 'scripts/dev/check_note_imgwork.py'
src = io.open(p, encoding='utf-8', newline='').read()
assert '\r\n' not in src
L = src.split('\n')
DASH = '\u2500'


def find(frag, n=1):
    idx = [i for i, l in enumerate(L) if frag in l]
    assert len(idx) == n, 'FIND %r -> %s' % (frag, idx)
    return idx[0]


# ── 9) 那一整段换成「⑤ 只有合成视图」──
a = find(DASH * 2 + ' 9)')
b = find(DASH * 2 + ' 10)')
NEW9 = r"""    # ── 9) ⑤ 只有合成视图：每张卡＝那一屏传回来的干净底图＋本地压上去的那一叠字（没有第二个视图）──
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /合成预览/.test(document.querySelector("#npPreviewBox").innerText)')
    head = box_text('#npPreviewBox')
    assert '合成预览（底图＋压字）' in head and '5屏·占图4张·已传回1张' in head, head[:220]
    assert page.locator('#npPreviewBox .np-imgwall').count() == 0, '⑤ 只剩一个视图，那颗「只看底图」的旋钮已撤'
    assert st('npFilmPicks(npS()).length') == 4, '不占图那屏不进这一套（封面这一版关了＝4 张卡）'
    for t in seg_texts()[:4]:
        assert t.replace(' ', '') in head, '每张卡压的就是这一屏定下来的那句：%s' % t
    assert SENT_2CHANGED.replace(' ', '') in head and SENTS[1].replace(' ', '') not in head, \
        '顶上那格改过、重列过之后，卡上压的是改后那一份'
    assert seg_texts()[4].replace(' ', '') not in head, '⬜ 过场那一屏不压字、不摆卡'
    assert page.locator('#npPreviewBox img').count() == 1, '挂上的那张当底图摊在卡上，字压在上面'
    assert '底图没传' in head and '还没传图' not in head, '缺底图的提醒写在卡下面那一行，不压在画面上'
    assert '配图1' in head and '配图4' in head and '配图5' not in head, '编号写在卡下面，过场不编号'
    assert '缺4屏分镜' in head and '跳到第一个缺分镜的屏' in head, '检查条跟预览摆在同一档顶上'

    page.locator('#npTabBody .np-imgtab[data-t="desc"]').click()
    page.wait_for_function('() => npTabOf(npS()) === "desc" && document.querySelectorAll(".np-shot").length === 5')
    goto_tab('preview')
    page.wait_for_function('() => document.querySelector("#npPreviewBox") && /合成预览/.test(document.querySelector("#npPreviewBox").innerText)')
    assert burned() == (0, 0), '预览切来切去一次 AI 都不烧'
    print('PASS: ⑤ 合成视图＝底图＋本地压字（4 张卡、过场不进、缺底图标红），切档零 AI', flush=True)

"""
del L[a:b]
L[a:a] = NEW9.split('\n')[:-1]
src = '\n'.join(L)

REPS = [
    # 文档头
    (u'⑤ 预览两视图」自检（老板 2026-10-02 五十七改口径；六十四改②③ 把 ② 收轻、③ 换成',
     u'⑤ 只有合成视图」自检（老板 2026-10-02 五十七改口径；六十四改② 把 ② 收轻；六十五改把 ★ 选句挪进 ④、③ 退回', 1),
    (u'台本身（带行号的正文框、点 ★ 立屏、拖行号、', u'台本身（带行号的正文框、按住行号圈屏、', 1),
    (u'③ 顶上那格文案（划重点的原料）+ ⑤ 预览两视图', u'③ 顶上那格文案（断句的原料）+ ⑤ 只有合成视图', 1),
    (u'  7) ⑤ 预览两视图：图文对照＝左整篇一屏一格、右边同一行就是那张图（不占图那屏也读得到，格子写明「这一屏不占图」，缺图标红）；\n     只看图墙＝只摆占图那几张；切来切去、回 ④ 都不重烧；',
     u'  7) ⑤ 只有合成视图一个视图：每张卡＝那一屏传回来的干净底图＋npCapPlan 那几行压在你点的『字位』那一格（不占图那屏不进这一套，缺底图写在卡下面那一行）；\n     切来切去、回 ④ 都不重烧（旧「只看底图」那颗已撤）；', 1),
    # 档位条 / 状态数字
    (u"assert '一句★都还没点' in tab_badge('cut')", u"assert '一行都还没圈' in tab_badge('cut')", 1),
    (u"assert '去③点某一行右边那颗★＝这一行立成一屏' in chk", u"assert '去③断句' in chk and '按住第m行行号拖到第n行' in chk", 1),
    (u"assert page.locator('#npPreviewBox .np-imgwall').count() == 0, '没屏就别摆预览视图那颗旋钮'",
     u"assert page.locator('#npPreviewBox .np-imgwall').count() == 0, '⑤ 只有合成视图一个视图（图墙那颗旋钮已撤）'", 1),
    (u"'点行号立的屏没单独挑 ★，npSegSync 顶的是这一屏头一句'",
     u"'点行号立的屏没在 ④ 另挑过那句，npSegSync 顶的是这一屏头一句'", 1),
    (u"assert '4屏都点了★' in tab_badge('cut')", u"assert '4屏都圈好了' in tab_badge('cut')", 1),
    (u"'5屏都点了★' in tab_badge('cut')", u"'5屏都圈好了' in tab_badge('cut')", 1),
    (u'★ 顶头一句、零 AI），档名上写「4 屏都点了 ★」', u'头一句自己顶上、零 AI），档名上写「4 屏都圈好了」', 1),
    (u"'★ 那句进档'", u"'选定那句（keySid）进档'", 1),
    (u'5 屏收行号 + ★ 那句 + 过场', u'5 屏收行号 + 选定那句 + 过场', 1),
    # 落档那一段：⑤ 已无图墙旋钮，过场那屏也不进合成视图
    (u"    page.wait_for_function('() => !!document.querySelector(\"#npPreviewBox .np-imgwall\")')\n    again = box_text('#npPreviewBox')",
     u"    page.wait_for_function('() => document.querySelector(\"#npPreviewBox\") && /合成预览/.test(document.querySelector(\"#npPreviewBox\").innerText)')\n    again = box_text('#npPreviewBox')", 1),
    (u"assert '5屏·占图4张·已传回1张' in again and SENT_EXTRA.replace(' ', '') in again",
     u"assert '5屏·占图4张·已传回1张' in again and SENT_EXTRA.replace(' ', '') not in again, '重进读的还是台上那一份（过场那屏不进合成视图）'", 1),
    (u"+ ⑤ 预览两视图（六十四改口径：② 收轻、③ 划重点）'", u"+ ⑤ 只有合成视图（六十五改口径：③ 只管断句、④ 管选句与配文、⑤ 一个视图）'", 1),
]

for old, new, n in REPS:
    c = src.count(old)
    assert c == n, 'REP count=%d want=%d :: %r' % (c, n, old[:70])
    src = src.replace(old, new)

# 收尾：这两词整支脚本里不该再有
src = src.replace(u'划重点', u'断句')
src = src.replace(u'图文对照', u'合成视图')

lines = src.split('\n')
left = [i + 1 for i, l in enumerate(lines)
        if (u'划重点' in l) or (u'图文对照' in l) or ('uiWall' in l) or (u'预览两视图' in l) or (u'只看图墙' in l)]
assert not left, 'LEFTOVER: %s' % left
print('wall refs:', [i + 1 for i, l in enumerate(lines) if 'np-imgwall' in l])
print('lines:', len(lines))
tmp = p + '.t94'
with io.open(tmp, 'w', encoding='utf-8', newline='') as f:
    f.write(src)
os.replace(tmp, p)
print('OK')
