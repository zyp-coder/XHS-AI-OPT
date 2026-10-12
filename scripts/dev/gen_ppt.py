# -*- coding: utf-8 -*-
"""从讲稿生成 AI雕兄 演讲 PPT（备注含完整讲稿）"""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

BG = RGBColor(0x11, 0x14, 0x18)
GOLD = RGBColor(0xD4, 0xAF, 0x37)
RED = RGBColor(0xE8, 0x50, 0x3A)
GRAY = RGBColor(0x8A, 0x92, 0x9C)
WHITE = RGBColor(0xF5, 0xF5, 0xF5)
DIM = RGBColor(0xB8, 0xBD, 0xC4)
FONT = '微软雅黑'

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]


def add_slide(notes=''):
    s = prs.slides.add_slide(BLANK)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = BG
    if notes:
        s.notes_slide.notes_text_frame.text = notes
    return s


def para(tf, text, size=28, color=WHITE, bold=False, first=False,
         space_before=10, space_after=10, align=PP_ALIGN.LEFT):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.text = text
    p.alignment = align
    p.space_before = Pt(space_before)
    p.space_after = Pt(space_after)
    for r in p.runs:
        r.font.size = Pt(size)
        r.font.color.rgb = color
        r.font.bold = bold
        r.font.name = FONT
    return p


def title(tf, text, color=WHITE, size=40):
    return para(tf, text, size=size, color=color, bold=True, first=True, space_after=18)


# ── 1 封面 ────────────────────────────────────────────
s = add_slide('''一个人做小红书，凌晨还在发笔记——三个月过去，一个咨询都没有。

不是你不行。是你从头到尾，都在瞎使劲。''')
box = s.shapes.add_textbox(Inches(1), Inches(2.1), Inches(11.3), Inches(3.2))
tf = box.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.text = '很多小生意做线上流量'
p.alignment = PP_ALIGN.CENTER
for r in p.runs:
    r.font.size = Pt(52); r.font.color.rgb = WHITE; r.font.bold = True; r.font.name = FONT
para(tf, '两个问题没想明白', size=52, color=GOLD, bold=True, align=PP_ALIGN.CENTER, space_before=0)
para(tf, '—— 小红书获客体系分享 ——', size=22, color=GRAY, align=PP_ALIGN.CENTER, space_before=26)

# ── 2 两个问题 ─────────────────────────────────────────
s = add_slide('''很多小生意做线上流量，两个问题没想明白。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.6), Inches(11), Inches(4.5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '两个问题没想明白')
para(tf, '①  只盯视频号，丢了陌生人搜索种草的流量', size=32, color=WHITE, space_before=24)
para(tf, '②  做小红书，跟着流量博主刷笔记等流量', size=32, color=WHITE, space_before=16)

# ── 3 问题一 ───────────────────────────────────────────
s = add_slide('''视频号能增加曝光，但是对于客户来说，你就是个陌生人在自卖自夸。
小红书的用户是主动在平台上搜索，陌生人来讲经验、讲感受，反而可信。
你不去，丢的是正在找答案的人。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '问题一｜只盯视频号')
para(tf, '视频号 = 曝光', size=30, color=RED, space_before=16)
para(tf, '但在客户眼里：一个陌生人在自卖自夸', size=24, color=DIM)
para(tf, '小红书 = 主动搜索', size=30, color=GOLD, space_before=28)
para(tf, '陌生人来讲经验、讲感受 —— 反而可信', size=24, color=DIM)
para(tf, '你不去，丢的是正在找答案的人', size=26, color=WHITE, bold=True, space_before=28)

# ── 4 问题二 ───────────────────────────────────────────
s = add_slide('''流量博主要的是流量，你要的是客户。
不是你不行，是你用流量博主的打法，做小生意的生意。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '问题二｜跟着流量博主刷笔记等流量')
para(tf, '流量博主要的是流量', size=34, color=WHITE, space_before=30)
para(tf, '你要的是客户', size=34, color=GOLD, bold=True, space_before=6)
para(tf, '不是你不行——是你用流量博主的打法，做小生意的生意', size=26, color=RED, bold=True, space_before=40)

# ── 5 正确姿势 ─────────────────────────────────────────
s = add_slide('''真正的获客不是等。
是去用户已经在搜、已经在问的地方，你要把他接住。
小红书的机会，不在你自嗨的笔记里，在别人正在被搜的笔记的评论区里。
你在里面专业回一句，真诚答一句，刷到的人就有可能和你互动。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.4), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '真正的获客，不是等')
para(tf, '去用户已经在搜、已经在问的地方 —— 把他接住', size=30, color=WHITE, space_before=22)
para(tf, '机会不在你自嗨的笔记里', size=28, color=GRAY, space_before=34)
para(tf, '在别人正在被搜的笔记的评论区里', size=30, color=GOLD, bold=True, space_before=8)
para(tf, '专业回一句，真诚答一句', size=24, color=DIM, space_before=30)

# ── 6 三层结构 ─────────────────────────────────────────
s = add_slide('''寻找有商机的笔记，评论区里获客，主页给信任，私信接需求。
这才是小生意做小红书的打法。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.5), Inches(11), Inches(4.8))
tf = box.text_frame; tf.word_wrap = True
title(tf, '小生意做小红书的三层结构')
para(tf, '评论区 · 获客        —— 寻找有商机的笔记，主动接人', size=30, color=WHITE, space_before=26)
para(tf, '主页 · 给信任       —— 让人一眼看出你专业、靠得住', size=30, color=WHITE, space_before=18)
para(tf, '私信 · 接需求       —— 把人接住，不漏', size=30, color=WHITE, space_before=18)
para(tf, '这才是小生意做小红书的打法', size=26, color=GOLD, bold=True, space_before=36)

# ── 7 转场 · 我的结果 ──────────────────────────────────
s = add_slide('''我以前在大厂写代码，现在把整套小红书获客体系都总结出来了；
我用它来给我的产品推广，就用我刚才说的体系，没投广告、没买流量，15天承接了1000多个真人加到我的产品/私域。
个人测试，效果因账号、品类、执行而异。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.6), Inches(11), Inches(4.6))
tf = box.text_frame; tf.word_wrap = True
title(tf, '先说一下我是怎么做的')
para(tf, '前大厂码农，现总结了一整套小红书获客体系', size=28, color=WHITE, space_before=24)
para(tf, '用它推广自己的产品：没投广告、没买流量', size=28, color=WHITE, space_before=14)
para(tf, '15 天，承接 1000+ 真人', size=48, color=GOLD, bold=True, space_before=30)
para(tf, '个人测试，效果因账号、品类、执行而异', size=20, color=GRAY, space_before=24)

# ── 8 我从哪来 ─────────────────────────────────────────
s = add_slide('''我最开始做了个房贷计算器，做完发现：没人搜得到我。
它没有关键词入口，天然流量起不来。
那我就想——客户到底在哪？''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.4), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '我最开始做了个房贷计算器')
para(tf, '做完发现：没人搜得到我', size=34, color=RED, bold=True, space_before=26)
para(tf, '没有关键词入口，天然流量起不来', size=26, color=DIM, space_before=14)
para(tf, '那我就想——', size=28, color=WHITE, space_before=40)
para(tf, '客户到底在哪？', size=44, color=GOLD, bold=True, space_before=10)

# ── 9 客户在哪 ─────────────────────────────────────────
s = add_slide('''找一个客户会主动搜、主动问的地方。
这东西好不好？那家店行不行？怎么买？怎么弄？
他一搜，需求就摆在那。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.4), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '找一个客户会主动搜、主动问的地方')
para(tf, '这东西好不好？  那家店行不行？', size=32, color=WHITE, space_before=30)
para(tf, '怎么买？  怎么弄？', size=32, color=WHITE, space_before=12)
para(tf, '他一搜 —— 需求就摆在那', size=34, color=GOLD, bold=True, space_before=45)

# ── 10 陌生人种草 ──────────────────────────────────────
s = add_slide('''小红书跟别的平台不一样，它是陌生人种草。
用户不信硬广，信评论区里像真人的那一句。
你去那些正在被搜、正在被推的笔记下面，专业地回一句，真诚地答一句，刷到的人就可能点开你主页。
这，就是你的机会。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(11), Inches(5.2))
tf = box.text_frame; tf.word_wrap = True
title(tf, '小红书：陌生人种草')
para(tf, '用户不信硬广，信评论区里像真人的那一句', size=28, color=WHITE, space_before=20)
para(tf, '去正在被搜、正在被推的笔记下面', size=28, color=WHITE, space_before=20)
para(tf, '专业回一句，真诚答一句 → 他点开你主页', size=26, color=DIM, space_before=14)
para(tf, '这，就是你的机会', size=36, color=GOLD, bold=True, space_before=34)

# ── 11 主页/评论分工 ───────────────────────────────────
s = add_slide('''记住，做小生意的，跟流量博主完全是两套打法。
主页，是让你展示专业度的。
评论，才是帮你获客的。
主页给信任，评论接需求。
这才是小生意做小红书的真正打法。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.4), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '两套打法，别混用')
para(tf, '主页 —— 展示专业度 → 给信任', size=30, color=WHITE, space_before=24)
para(tf, '评论 —— 主动捞人   → 接需求', size=30, color=WHITE, space_before=16)
para(tf, '主页给信任，评论接需求', size=44, color=GOLD, bold=True, space_before=40)

# ── 12 卡点 ────────────────────────────────────────────
s = add_slide('''但这样就行了吗？还不行。
你在评论区捞到人，没法直接把他带走。
他在评论区刷到你，点个赞，划走了。
你说"来主页"，他为什么要来？他刷下一条了。
更现实的是，小红书不是他的核心聊天软件。
他可能一天打开一次，也可能几天才想起来看。
你的私信躺在他消息列表里，回慢一步，凉一半；回晚一天，忘干净。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.2), Inches(11), Inches(5.5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '但是——捞到了，带不走')
para(tf, '不能跳微信 / 不能发链接 / 只能说"来主页看看"', size=24, color=DIM, space_before=18)
para(tf, '他刷到你，点个赞，划走了', size=28, color=WHITE, space_before=22)
para(tf, '小红书不是他的核心聊天软件', size=28, color=WHITE, space_before=18)
para(tf, '回慢一步，凉一半；回晚一天，忘干净', size=32, color=RED, bold=True, space_before=22)

# ── 13 漏一个 ──────────────────────────────────────────
s = add_slide('''捞人不难，难的是接得住。
你辛辛苦苦捞的人，就这么漏了。
漏一个评论，漏一笔钱。漏一个私信，漏一个客户。
你天天在捞，天天在漏。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.5), Inches(11), Inches(4.8))
tf = box.text_frame; tf.word_wrap = True
title(tf, '接不住，就是白捞')
para(tf, '捞人不难，难的是接得住', size=32, color=WHITE, space_before=24)
para(tf, '漏一个评论，漏一笔钱', size=40, color=GOLD, bold=True, space_before=34)
para(tf, '漏一个私信，漏一个客户', size=40, color=GOLD, bold=True, space_before=10)
para(tf, '你天天在捞，天天在漏', size=28, color=RED, space_before=30)

# ── 14 路径四环 ────────────────────────────────────────
s = add_slide('''所以做小红书获客，不是发内容就完了。
是你得把这条路径接住：
搜索词铺好，让他搜得到你。
评论区互动，让他看见你。
私信接住，让他信你。
主页沉淀，让他到你手里。
中间断一环，人就没了。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.2), Inches(11), Inches(5.5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '把这条路径接住')
para(tf, '搜索词铺好      →  搜得到', size=30, color=WHITE, space_before=20)
para(tf, '评论区互动      →  看见你', size=30, color=WHITE, space_before=14)
para(tf, '私信接住        →  信你', size=30, color=WHITE, space_before=14)
para(tf, '主页沉淀        →  到你手里', size=30, color=WHITE, space_before=14)
para(tf, '中间断一环，人就没了', size=32, color=RED, bold=True, space_before=30)

# ── 15 三个感受 ① ──────────────────────────────────────
s = add_slide('''我跑通之后，最大的感受就三个。
第一，人设比内容重要。
用户搜到你，凭什么信你？凭什么加你？凭什么买你？
不是因为你发得多，是因为你看起来靠谱、专业、真实。
账号不会定位，发一堆没人看；不知道发啥，打开就愣。
本质上是人设没立住。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(11), Inches(5.2))
tf = box.text_frame; tf.word_wrap = True
title(tf, '①  人设比内容重要')
para(tf, '凭什么信你？凭什么加你？凭什么买你？', size=30, color=WHITE, space_before=26)
para(tf, '不是因为你发得多', size=26, color=GRAY, space_before=22)
para(tf, '是因为你看起来——靠谱、专业、真实', size=34, color=GOLD, bold=True, space_before=8)

# ── 16 三个感受 ② ──────────────────────────────────────
s = add_slide('''第二，获客才是做生意的本质。
客户已经在搜了，已经有需求了，你把他接住。
不是硬广，不是群发，是去评论区、搜索词、私信里，把已经有需求的人捞出来。
漏一个评论，就漏一笔钱；接住一个搜索，就多一个客户。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(11), Inches(5.2))
tf = box.text_frame; tf.word_wrap = True
title(tf, '②  获客才是做生意的本质')
para(tf, '客户已经在搜、已经有需求 —— 你把他接住', size=30, color=WHITE, space_before=24)
para(tf, '不是硬广，不是群发', size=26, color=GRAY, space_before=18)
para(tf, '漏一个评论，就漏一笔钱', size=32, color=GOLD, bold=True, space_before=30)
para(tf, '接住一个搜索，就多一个客户', size=32, color=GOLD, bold=True, space_before=8)

# ── 17 三个感受 ③ ──────────────────────────────────────
s = add_slide('''第三，一个人干，不能只靠拼命，得有章法。
发完不是结束，后面每一步都得有承接、有跟进、有调整。
哪条内容在带人，哪个动作有效，你心里得有数。
不然你根本不知道客户从哪来，也不知道人从哪漏。
光靠手动硬干，累死也跑不通。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.3), Inches(11), Inches(5.2))
tf = box.text_frame; tf.word_wrap = True
title(tf, '③  不能只靠拼命，得有章法')
para(tf, '发完不是结束 —— 承接、跟进、调整', size=30, color=WHITE, space_before=24)
para(tf, '哪条在带人、哪个动作有效，心里得有数', size=30, color=WHITE, space_before=18)
para(tf, '光靠手动硬干，累死也跑不通', size=30, color=RED, bold=True, space_before=30)

# ── 18 收尾 ────────────────────────────────────────────
s = add_slide('''2026了，还在为获客发愁？
前大厂码农，江湖散人。
我用AI雕兄跑通从0到1，纯内容获客，15天承接1000+真人。
效果因人而异。

联系我免费做个测评。
方向对不对，做一次就知道。
不合适，不勉强。''')
box = s.shapes.add_textbox(Inches(1.2), Inches(1.4), Inches(11), Inches(5))
tf = box.text_frame; tf.word_wrap = True
title(tf, '2026 了，还在为获客发愁？')
para(tf, '前大厂码农，江湖散人', size=26, color=DIM, space_before=20)
para(tf, 'AI 雕兄 · 纯内容获客 · 15 天承接 1000+ 真人', size=32, color=WHITE, bold=True, space_before=18)
para(tf, '效果因人而异', size=20, color=GRAY, space_before=8)
para(tf, '联系我免费做个测评', size=40, color=GOLD, bold=True, space_before=34)
para(tf, '方向对不对，做一次就知道 · 不合适，不勉强', size=24, color=DIM, space_before=12)

out = r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿\AI雕兄-演讲稿.pptx'
prs.save(out)
print('saved:', out, '| slides:', len(prs.slides.__iter__.__self__._sldIdLst))
