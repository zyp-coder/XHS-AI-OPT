#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""知识库存量条目改口（二十八改收尾 · 2026-10-09）：发布台改名 + 待发→代发 + 任务配置两签化。

口径（逐字取自 popup.js / popup.html / 名词解析.html 现行文案，2026-10-09 核实）：
  发布队列（页面） → 发布台；页内两签＝📅 发布队列（签名保留）/ 🧬 笔记规划（从任务配置整块搬来）
  笔记状态「待发」 → 「代发」（草稿 → 代发 → 已发 → 已归档）；交文件副本收进「代发区」
  篇写好标「代发」那一刻按方向自动找最早的未来空位排进来（没空位先进页顶「🆕 写好等排期」，
  点「🎯 排进空位」再排）——popup.js npAutoPlaceNote / 发布台 tooltip
  任务配置＝两签：📄 内容基调（4 种基调＋知识·干货，一卡一条基调＝账号默认：铺垫/广告拖条、
  写法只单独拨字数；广告占比跟账号阶段走：冷启动期一成 · 成长期两三成 · 成熟期五成）
  / 🎨 出图风格（画面风格 / 印记 / 配文版式）；就一篇的临时拨在 ④ 挑稿页
  导图长图：1080×1440 竖版 → 1080 宽竖式（高度随内容长——主干再多也装得下）
  发笔记二级＝任务配置 / 笔记档案 / 发布台 / 素材库 / 复盘

做法：先备份到 tmp/，按条目 id 在 title/content 里逐字替换（带处数断言），两处整段用标记区间替换，
tags 单独改；写完 json 复验 + 纯 CRLF + id 顺序 + 条数；写临时文件后 os.replace。
"""
import io
import json
import os
import shutil
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / '资料' / '小红书AI引流工具知识库.json'
BAK = ROOT / 'tmp' / '_kb_bak_pre_wave28.json'
TMP = ROOT / 'tmp' / '_kb_wave28_new.json'

FORBID = ['防封', '反爬', '养号', '规避', '封号']
COUNT_EQ = ['限流']


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace(',\n', ', \n')


# 每条：[(旧串, 新串, 期待命中数), ...]——在 title + content 两个字段里合计
PATCH = {
    'drain028': [
        ('账号默认（每种写法的「📐 篇幅配比」＝铺垫 / 展开 / 产品三块各占多少，和「🖋 字数」那一档）在「发笔记 → 任务配置」那张 **📄 五条线 × 写法**表上逐格改',
         '账号默认（每种基调的「📐 篇幅配比」＝铺垫 / 广告各占多少，和「🖋 字数」那一档）在「发笔记 → 任务配置 → 📄 内容基调」那些基调卡上改', 1),
    ],
    'drain029': [
        ('或排进「发布队列」到点发', '或排进「发布台」到点发', 1),
    ],
    'drain030': [
        ('发笔记·定时发布：排进「发布队列」到点发（可开「✋ 过目」）',
         '发笔记·定时发布：排进「发布台」到点发（可开「✋ 过目」）', 1),
        ('定时发布＝把备好的篇排进「发笔记 → 发布队列」——每个位子带日期和时间',
         '定时发布＝把备好的篇排进「发笔记 → 发布台 → 📅 发布队列」——每个位子带日期和时间', 1),
        ('到点自动发；想让这一条自己盯一眼，就把位子开「✋ 过目」',
         '到点自动发；篇写好标「代发」那一刻，按方向自动找最早的未来空位排进来，不用手动挑。想让这一条自己盯一眼，就把位子开「✋ 过目」', 1),
        ('在「发布队列」点「＋ 排一篇」从档案里挑篇、给位子定时间',
         '在「发布台 → 📅 发布队列」点「＋ 排一篇」从档案里挑篇、给位子定时间（篇标「代发」也会自动排进最早的空位）', 1),
        ('发布队列替你把它落成一个个带时间的位子',
         '发布台替你把它落成一个个带时间的位子', 1),
        ('📱 操作路径：发笔记 → 发布队列 → 「＋ 排一篇」从档案挑篇',
         '📱 操作路径：发笔记 → 发布台 → 📅 发布队列 → 「＋ 排一篇」从档案挑篇', 1),
    ],
    'drain031': [
        ('内容基调（人设 × 阶段 × 五条线写法，每种写法的篇幅配比与字数都在这页定账号默认，发笔记按它写）在「发笔记 → 任务配置」',
         '内容基调（4 种基调＋知识·干货的铺垫 / 广告与字数都在这页定账号默认，广告占比跟账号阶段走，发笔记按它写）在「发笔记 → 任务配置」', 1),
    ],
    'drain038': [
        ('出一张 1080×1440 竖版长图，标成「待发」回档案',
         '出一张 1080 宽的竖式长图（高度随内容长——主干再多也装得下），标成「代发」回档案', 1),
        ('出导图长图 → 回档案标「待发」。', '出导图长图 → 回档案标「代发」。', 1),
    ],
    'drain039': [
        ('出完回档案标「待发」。', '出完回档案标「代发」。', 1),
    ],
    'drain040': [
        ('稿子收进这一篇的档案、标成「待发」', '稿子收进这一篇的档案、标成「代发」', 1),
    ],
    'drain041': [
        ('配好音，标「待发」落档', '配好音，标「代发」落档', 1),
    ],
    'drain042': [
        ('（正文＋每屏图）标「待发」落档', '（正文＋每屏图）标「代发」落档', 1),
    ],
    'drain044': [
        ('（这一篇标「待发」）', '（这一篇标「代发」）', 1),
    ],
    'drain046': [
        ('发布队列：一页管排＋发——排期跟着笔记规划滚 3 周',
         '发布台：一页管排＋发——排期跟着笔记规划滚 3 周', 1),
        ('📐 怎么算：发布队列一页管排＋发。排：列表跟着「发笔记 → 任务配置 · 笔记规划」的每周排法往后滚 3 周（过去的日子不滚出来）；位子「＋ 排一篇」从档案里挑（发过的篇不进队列）。',
         '📐 怎么算：发布台一页管排＋发，页内两签（📅 发布队列 / 🧬 笔记规划）。排：📅 发布队列的列表跟着「发笔记 → 发布台 · 🧬 笔记规划」的每周排法往后滚 3 周（过去的日子不滚出来）；位子「＋ 排一篇」从档案里挑（发过的篇不进队列）。篇写好标「代发」那一刻，按方向自动找最早的未来空位排进来；排法里没空位就先待在页顶「🆕 写好等排期」，点「🎯 排进空位」再排。', 1),
        ('📱 操作路径：发笔记 → 发布队列 → 「＋ 排一篇」挑篇',
         '📱 操作路径：发笔记 → 发布台 → 📅 发布队列 → 「＋ 排一篇」挑篇', 1),
        ('收一份副本进「待发区」（发完自动清、原件还在你电脑里）',
         '收一份副本进「代发区」（发完自动清、原件还在你电脑里）', 1),
    ],
    'pdesc001': [
        ('也可以排进「发布队列」到点发', '也可以排进「发布台」到点发', 1),
    ],
    'ver001': [
        ('笔记档案 + 发布队列 + 素材库', '笔记档案 + 发布台 + 素材库', 1),
    ],
    'nav001': [
        ('发笔记＝任务配置（内容基调：🧬 账号阶段与人设 / 📄 内容基调 · 五条线 × 写法 / 🎚 话术比例）/ 笔记档案（这一块的主页）/ 发布队列 / 素材库',
         '发笔记＝任务配置（📄 内容基调 / 🎨 出图风格）/ 笔记档案（这一块的主页）/ 发布台（📅 发布队列＋🧬 笔记规划）/ 素材库 / 复盘', 1),
        ('写笔记的篇幅配比 / 字数 / 卖货话术比例＝发笔记 → 任务配置；',
         '写笔记的篇幅配比 / 字数＝发笔记 → 任务配置 → 📄 内容基调（广告占比跟账号阶段走）；每周排法与阶段计划＝发笔记 → 发布台 → 🧬 笔记规划；', 1),
    ],
    'nav005': [
        ('（二级＝任务配置 / 笔记档案（这一块的主页）/ 发布队列 / 素材库）',
         '（二级＝任务配置 / 笔记档案（这一块的主页）/ 发布台 / 素材库 / 复盘）', 1),
        ('账号默认的「📐 篇幅配比」（铺垫 / 展开 / 产品各占多少、约多少字）与「🖋 字数」逐线逐写法都在「发笔记 → 任务配置」那张 📄 五条线 × 写法表上定；',
         '账号默认的「📐 篇幅配比」（铺垫 / 广告各占多少、约多少字）与「🖋 字数」都在「发笔记 → 任务配置 → 📄 内容基调」那些基调卡上定；', 1),
        ('状态自己标：草稿 → 待发 → 已发 → 已归档', '状态自己标：草稿 → 代发 → 已发 → 已归档', 1),
    ],
}

# 整段替换（标记区间）：(起标记, 止标记, 新文, 止标记是否一并换掉)
SPANS = {
    'nav002': [(
        '内容基调整页在「发笔记 → 任务配置」',
        '一改上面每格的产品段按它重切）；',
        '内容基调那页在「发笔记 → 任务配置」，页内两签——📄 内容基调（4 种基调＋知识·干货，一卡一条基调＝账号默认：铺垫 / 广告拖那条卡的条、写法全跟主行走只单独拨字数；广告占比跟账号阶段走：冷启动期一成 · 成长期两三成 · 成熟期五成，就一篇的临时拨在 ④ 挑稿页）/ 🎨 出图风格（画面风格 / 印记 / 配文版式）；🧬 笔记规划（怎么用发笔记＋每周排法＋阶段计划）在「发布台」页内签；',
        True,
    )],
    'nav005': [(
        '⑥ 任务配置：内容基调那一页',
        '；「规划」那页只按这份基调排产。',
        '⑥ 任务配置：两张默认表（2026-10-01 从「诊断&配置」整页搬来）——📄 内容基调（4 种基调＋知识·干货的铺垫 / 广告与字数，全站账号默认只在这里改；广告占比跟账号阶段走）/ 🎨 出图风格（画面风格 / 印记 / 配文版式）；🧬 笔记规划（怎么用发笔记＋每周排法＋阶段计划）在「发布台」页内签',
        False,
    )],
}

# tags 单独改：id -> 旧 tag
TAG_FIX = {'drain030': '发布队列', 'drain046': '发布队列'}


def main():
    raw = KB.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    data = json.loads(raw)
    assert dump(data) == raw.replace('\r\n', '\n'), '序列化风格复刻失败：重建后与原文不一致，先对齐格式再改内容'
    assert raw.count('待发') == 9, f"「待发」处数变了：{raw.count('待发')}（期望 9）"
    assert raw.count('发布队列') == 15, f"「发布队列」处数变了：{raw.count('发布队列')}（期望 15）"
    ids_before = [e['id'] for e in data]

    BAK.parent.mkdir(exist_ok=True)
    shutil.copyfile(str(KB), str(BAK))

    by_id = {e['id']: e for e in data}
    got = {}
    for eid, patches in PATCH.items():
        assert eid in by_id, f'缺条目 {eid}'
        e = by_id[eid]
        for field in ('title', 'content'):
            txt = e.get(field) or ''
            for k, (old, new, n) in enumerate(patches):
                cnt = txt.count(old)
                if cnt:
                    txt = txt.replace(old, new)
                    got[(eid, k)] = got.get((eid, k), 0) + cnt
            e[field] = txt
        for k, (old, new, n) in enumerate(patches):
            assert got.get((eid, k), 0) == n, f'{eid} 第{k + 1}条命中 {got.get((eid, k), 0)} 次（期望 {n}）：{old[:30]}…'
            assert old not in ((e.get('title') or '') + (e.get('content') or '')), f'{eid} 第{k + 1}条替换后旧串还在'

    for eid, spans in SPANS.items():
        e = by_id[eid]
        txt = e.get('content') or ''
        for m, (start, end, new, eat_end) in enumerate(spans):
            i1 = txt.find(start)
            assert i1 >= 0, f'{eid} 段{m + 1}：起标记没找到 {start[:24]}…'
            assert txt.count(start) == 1, f'{eid} 段{m + 1}：起标记出现 {txt.count(start)} 次'
            i2 = txt.find(end, i1)
            assert i2 >= 0, f'{eid} 段{m + 1}：止标记没找到 {end[:24]}…'
            assert txt.find(end, i2 + 1) < 0, f'{eid} 段{m + 1}：止标记不止一处'
            tail = i2 + (len(end) if eat_end else 0)
            txt = txt[:i1] + new + txt[tail:]
        e['content'] = txt

    for eid, old_tag in TAG_FIX.items():
        e = by_id[eid]
        tags = e.get('tags') or []
        assert tags.count(old_tag) == 1, f'{eid} tags 里「{old_tag}」命中 {tags.count(old_tag)} 次（期望 1）'
        e['tags'] = [('发布台' if t == old_tag else t) for t in tags]

    text = dump(data)
    for w in FORBID:
        assert w not in text, f'命中禁用词：{w}'
    for w in COUNT_EQ:
        assert text.count(w) == raw.count(w), f'「{w}」次数变了：{raw.count(w)} → {text.count(w)}'
    for w in ['待发', '五条线 × 写法', '三个横 tab', '内容基调整页', '1080×1440', '竖版长图', '个人人设', '任务配置 · 笔记规划']:
        assert w not in text, f'改口后还有残留：{w}'

    n_q = text.count('发布队列')
    assert n_q == 7, f'「发布队列」改后应只剩 7 处（都带 📅），实为 {n_q}'
    i = 0
    while True:
        i = text.find('发布队列', i)
        if i < 0:
            break
        assert text[i - 1:i] == ' ', f'有一处「发布队列」没带 📅（@%d）' % i
        assert text[i - 2:i - 1] == '📅', f'有一处「发布队列」没带 📅（@%d）' % i
        i += 4
    assert text.count('代发区') == 1 and '待发区' not in text, '代发区/待发区收尾不对'

    TMP.write_bytes(text.replace('\n', eol).encode('utf-8'))
    os.replace(str(TMP), str(KB))

    raw2 = KB.read_bytes()
    assert raw2.count(b'\r\n') == raw2.count(b'\n'), '落盘不是纯 CRLF'
    data2 = json.loads(raw2.decode('utf-8'))
    assert [e['id'] for e in data2] == ids_before, 'id 顺序变了'
    assert len(data2) == len(data), f'条数变了：{len(data)} → {len(data2)}'

    total = sum(got.get((eid, k), 0) for eid, patches in PATCH.items() for k in range(len(patches)))
    n_span = sum(len(v) for v in SPANS.values())
    print(f'OK：条目替换 {len(PATCH)} 条、逐字替换 {total} 处；整段重写 {n_span} 段；tags 改 {len(TAG_FIX)} 条')
    print(f'共 {len(data2)} 条，纯 CRLF {len(raw2)} 字节；备份在 {BAK.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
