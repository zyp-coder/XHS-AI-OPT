# -*- coding: utf-8 -*-
"""从竖屏动效页提取讲稿，生成剪映「文本朗读」可直接整段粘贴的纯文本（无标题、无注记）。"""
import re, pathlib

SRC = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿\AI雕兄-动效演示-竖屏.html')
OUT = SRC.with_name('AI雕兄-配音-粘贴版.txt')

html = SRC.read_text(encoding='utf-8')
scenes = re.findall(r'<section class="scene" data-name="([^"]+)">(.*?)</section>', html, re.S)

blocks = []
for name, block in scenes:
    ps = re.findall(r'<p>(.*?)</p>', block, re.S)
    ps = [re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', p)) for p in ps]
    blocks.append('\n'.join(p for p in ps if p))

OUT.write_text('\n\n'.join(blocks) + '\n', encoding='utf-8')
print('saved:', OUT)
print('幕数:', len(blocks), '| 正文字数:', sum(len(b.replace('\n', '')) for b in blocks))
