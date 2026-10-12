# -*- coding: utf-8 -*-
"""四十七改（④ 挑稿改「5 部手机并排」）知识库口径同步——一次性脚本。

知识库正文大量是人工措辞，整体 json.dump 回去会把不是本轮的措辞一起改动（还破落盘风格：
条目之间与行尾是「, 」、LF、4 空格缩进）。所以这里只做精确子串替换，每条断言必须恰好命中一次。

跑法：PYTHONIOENCODING=utf-8 python3 scripts/dev/_kb_phone_row.py

注：③ 话题卡、素材库卡的「卡」不属本轮（本轮只动 ④ 挑稿的样稿呈现：卡 → 并排的手机）。
"""

import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
KB = os.path.join(ROOT, '资料', '小红书AI引流工具知识库.json')

# (说明, 原文, 新文)
EDITS = [
    # ── drain028 发笔记向导：④ 段（样稿＝手机、点手机定稿、缺料手机） ──
    ('drain028 ④ 样稿手机',
     '一种写法一张卡，卡上写明这种写法换的是哪一样',
     '一种写法一台手机（几部并排摆着挑），屏上写明这种写法换的是哪一样'),
    ('drain028 ④ 点中哪台手机',
     '**点中哪张卡＝这条定成「这条线 · 那种写法」，那篇正文直接当 ⑤ 的底稿接着改，不再让 AI 从零写一篇**',
     '**点中哪台手机＝这条定成「这条线 · 那种写法」，那篇正文直接当 ⑤ 的底稿接着改，不再让 AI 从零写一篇**'),
    ('drain028 ④ 缺料手机',
     '时那张卡标「🕳 缺料 · 补一条素材再来」——写明缺什么料、回 ① 补一条素材再点「🔁 重新 AI 生成这批」重出，**不给「就用这篇」、也不硬编年代 / 人名 / 典故**。',
     '时那台手机画成虚线空屏、标「🕳 缺料 · 补一条素材再来」——写明缺什么料、回 ① 补一条素材再点「🔁 重新 AI 生成这批」重出，**不给「就用这篇」、也不硬编年代 / 人名 / 典故**。'),

    # ── nav005 发笔记 4 页：④ 点手机 + 缺料手机 ──
    ('nav005 ④ 点中哪台手机',
     '点中哪张卡＝这条定成「这条线 · 那种写法」且那篇正文直接当 ⑤ 的底稿',
     '点中哪台手机＝这条定成「这条线 · 那种写法」且那篇正文直接当 ⑤ 的底稿'),
    ('nav005 ④ 缺料手机',
     '时那张卡标「🕳 缺料 · 补一条素材再来」（写明缺什么料 + 回 ① 补素材再点「🔁」重出），不给「就用这篇」、不硬编',
     '时那台手机画成虚线空屏、标「🕳 缺料 · 补一条素材再来」（写明缺什么料 + 回 ① 补素材再点「🔁」重出），不给「就用这篇」、不硬编'),
]


def main():
    import json
    raw = io.open(KB, encoding='utf-8', newline='').read()
    assert '\r' not in raw, '源头是 LF，先确认没被改成 CRLF'
    items_before = json.loads(raw)
    body = raw
    for name, old, new in EDITS:
        n = body.count(old)
        assert n == 1, '%s：原文命中 %d 次（要求恰好 1 次）' % (name, n)
        body = body.replace(old, new)
    for name, old, _ in EDITS:
        assert old not in body, '%s：替换后原文仍在' % name
    items_after = json.loads(body)
    assert len(items_after) == len(items_before) == 49, '条目数不该变：%d → %d' % (len(items_before), len(items_after))
    assert [e.get('id') for e in items_after] == [e.get('id') for e in items_before], '条目顺序与 id 不许动'
    assert '\r' not in body, '别把 LF 写成 CRLF'
    io.open(KB, 'w', encoding='utf-8', newline='').write(body)
    print('✅ 知识库四十七改口径：%d 处替换（%d 条条目、顺序不变）' % (len(EDITS), len(items_after)))
    for name, _, _ in EDITS:
        print('   ·', name)


if __name__ == '__main__':
    main()
