# -*- coding: utf-8 -*-
"""四十六改（③ 话题改「话题域 + 一句真事」两栏；④ 缺料降级 skipped 卡）知识库口径同步——一次性脚本。

知识库正文大量是人工措辞，整体 json.dump 回去会把不是本轮的措辞一起改动（还破落盘风格：
条目之间与行尾是「, 」、LF、4 空格缩进）。所以这里只做精确子串替换，每条断言必须恰好命中一次。

跑法：PYTHONIOENCODING=utf-8 python3 scripts/dev/_kb_topic_fact.py
"""

import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
KB = os.path.join(ROOT, '资料', '小红书AI引流工具知识库.json')

# (说明, 原文, 新文)
EDITS = [
    # ── drain028 发笔记向导：③ 段（题＝话题域 + 一句真事）+ ④ 段（缺料降级） ──
    ('drain028 ③ 段',
     '③挑话题：基于人群真实痛点+该平台生态给候选话题（含为什么选它、避开已发过的；抖音/快手是能开拍的视频选题，闲鱼是买家会搜的宝贝方向）；',
     '③挑话题：基于人群真实痛点+该平台生态给候选话题——**题按「抽象」出：每张卡两栏——话题域（不带结论 / 反转 / 清单 / 产品名）+ 一句真事（这个域底下一件具体的小事，不许编）**，自检要过三关：遮住产品还立得住、这题底下能想出三个不同的场景、题里没把剧情写完（含为什么选它、避开已发过的；抖音/快手是能开拍的视频选题，闲鱼是买家会搜的宝贝方向）；那句真事是成稿打底的凭据——会跟着进 ④挑稿 / ⑤成稿 / 改稿；'),
    ('drain028 ④ 段缺料',
     '不想挑就点「先不挑 · 让 AI 写一篇 →」回老路子。',
     '不想挑就点「先不挑 · 让 AI 写一篇 →」回老路子；某种写法确实缺料（它要的来路 / 工艺 / 老规矩这类素材都没有）时那张卡标「🕳 缺料 · 补一条素材再来」——写明缺什么料、回 ① 补一条素材再点「🔁 重新 AI 生成这批」重出，**不给「就用这篇」、也不硬编年代 / 人名 / 典故**。'),

    # ── nav005 发笔记 4 页：③ 两栏题 + ④ 缺料卡 ──
    ('nav005 ③ 两栏题',
     '）：④ 挑稿＝先定这条走哪条线',
     '）；③ 话题的题按「抽象」出——每张卡两栏＝话题域 + 一句真事（题里不许出现剧情 / 结论 / 清单 / 产品名，那句真事是成稿打底的凭据）；④ 挑稿＝先定这条走哪条线'),
    ('nav005 ④ 缺料卡',
     '不想挑点「先不挑 · 让 AI 写一篇 →」；这一页顶部是「🔀 内容类型',
     '不想挑点「先不挑 · 让 AI 写一篇 →」；某种写法确实缺料（来路 / 工艺 / 老规矩这类素材都没有）时那张卡标「🕳 缺料 · 补一条素材再来」（写明缺什么料 + 回 ① 补素材再点「🔁」重出），不给「就用这篇」、不硬编；这一页顶部是「🔀 内容类型'),
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
    print('✅ 知识库四十六改口径：%d 处替换（%d 条条目、顺序不变）' % (len(EDITS), len(items_after)))
    for name, _, _ in EDITS:
        print('   ·', name)


if __name__ == '__main__':
    main()
