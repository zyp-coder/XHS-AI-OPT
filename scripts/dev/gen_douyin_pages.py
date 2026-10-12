# -*- coding: utf-8 -*-
"""小红书轨动效页 → 抖音轨：把竞品平台名换成中性说法，其余画面一字不动。

用法：python3 scripts/dev/gen_douyin_pages.py
产出（与原页同目录，文件名加 -抖音版）：
  资料/视频/AI雕兄口播稿/AI雕兄-动效演示-竖屏-抖音版.html          ← 长版 18 幕
  资料/视频/AI雕兄口播稿/9问快闪/AI雕兄-9问-竖屏-抖音版.html       ← 9问快闪 11 幕
  资料/视频/AI雕兄口播稿/短版45s/AI雕兄-短版-竖屏-抖音版.html      ← 短版45s 7 幕
  资料/视频/AI雕兄口播稿/系统优势总结/AI雕兄-优势-竖屏-抖音版.html  ← 优势总结 11 幕

为什么这样派生：抖音是竞品平台，片中不出现「小红书」「视频号」；9问/短版/优势 的页由
gen_qa9_page.py / gen_short_page.py / gen_adv_page.py 生成，长版页无生成器、直接手改——
四条轨都以「小红书版页」为唯一源头，本脚本只做文本替换。**改完小红书版要重跑本脚本**，
否则抖音版是旧的（映射表里某条找不到原文时脚本会直接报错，不会静默产出带「小红书」的页）。
配音/渲染直接吃抖音版页（每幕 <p> 仍是口播唯一真源），封面见 AI雕兄-封面.html 的 g/h 版。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAT = ROOT / '资料' / '视频' / 'AI雕兄口播稿'

# 每条 = (原文, 替换)；出现 0 次即报错（说明小红书版页改过词，映射要跟着更新）
RULES = {
    '长版': (MAT / 'AI雕兄-动效演示-竖屏.html', [
        ('只盯视频号', '只盯自己的号'),
        ('<div class="ptag">视频号</div>', '<div class="ptag">自己的号</div>'),
        ('<div class="ptag gold">小红书</div>', '<div class="ptag gold">小某书</div>'),
        ('小红书搜「求推荐」', '搜「求推荐」'),
        ('视频号能增加曝光', '自己的号能增加曝光'),
        ('小红书不一样，用户是主动搜、主动问。', '但在搜索种草的平台上不一样，用户是主动搜、主动问。'),
        ('第二，做小红书，但跟着流量博主学打法。', '第二，做线上生意，但跟着流量博主学打法。'),
        ('小红书的机会', '线上的机会'),
        ('小生意做小红书的打法', '小生意做线上的打法'),
        ('真人加到产品 / 私域', '承接真人用户'),
        ('整套小红书获客体系', '整套线上获客体系'),
        ('15天承接了1000多个真人加到我的产品和私域', '15 天承接了 1000 多个真人'),
        ('小红书不是他的核心聊天软件', '平台不是他的核心聊天软件'),
    ]),
    '9问': (MAT / '9问快闪' / 'AI雕兄-9问-竖屏.html', [
        ('小红书评论区获客', '评论区获客'),
        ('小红书月活 ', '月活 '),
        ('小红书每天 8 亿次搜索', '每天 8 亿次搜索'),
        ('我不懂小红书', '我不懂线上'),
        ('不懂小红书怎么办', '不懂线上怎么办'),
    ]),
    '短版': (MAT / '短版45s' / 'AI雕兄-短版-竖屏.html', [
        ('只盯视频号', '只盯自己的号'),
        ('<div class="ptag">视频号</div>', '<div class="ptag">自己的号</div>'),
        ('<div class="ptag gold">小红书</div>', '<div class="ptag gold">小某书</div>'),
        ('第二，做了小红书，却跟着流量博主学打法', '第二，想在网上接客户，却跟着流量博主学打法'),
        ('真人加到产品 / 私域', '承接真人用户'),
    ]),
    '优势': (MAT / '系统优势总结' / 'AI雕兄-优势-竖屏.html', [
        ('很多人不知道<br>小红书怎么捞客', '很多人不知道<br>线上怎么捞客'),
        ('很多人不知道小红书怎么捞客', '很多人不知道线上怎么捞客'),
        ('研究了大量的小红书评论', '研究了大量的评论'),
        ('1000 多个真人加进了我微信', '1000 多个真人主动找我'),
    ]),
}

# 派生页里不该再出现的词（「小某书」是留的抖音化说法，不在列）
BANNED = ['小红书', '视频号', '私域', '微信']


def main():
    for label, (src, rules) in RULES.items():
        html = src.read_text(encoding='utf-8')
        print(f'{label} ← {src.name}')
        for old, new in rules:
            n = html.count(old)
            if n == 0:
                sys.exit(f'  × 找不到「{old}」——小红书版页的文案改过了，先更新本脚本的映射表')
            html = html.replace(old, new)
            print(f'  {n} 处  {old[:26]} → {new[:26]}')
        html = re.sub(r'<title>([^<]*)</title>', r'<title>\1 · 抖音版</title>', html, count=1)
        left = {w: html.count(w) for w in BANNED if html.count(w)}
        if left:
            sys.exit(f'  × 派生页里还剩平台词 {left}——映射表漏了，别产出这一版')
        dst = src.with_name(src.stem + '-抖音版.html')
        dst.write_text(html, encoding='utf-8')
        print(f'  → {dst.relative_to(MAT)}（{dst.stat().st_size / 1024:.0f} KB）')


if __name__ == '__main__':
    main()
