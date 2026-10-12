# -*- coding: utf-8 -*-
"""二十九改清扫（一次性）：知识库仍有「挑知识 → 定话题 → 改稿」旧三站描述的 7 条 11 处，
改口到二十九改口径（挑了知识直接出稿、AI 自挑角度；🎲 换个角度重写＝角度不对的出口）。

口径依据：extension/popup.js ntKStations=['挑知识','改稿',...]；
background.js L6265「用户只挑了知识、没定话题…你自己挑一个最值得写的角度来写」。

玩法：备份原件 → 逐处精确子串替换（命中数必须 ==1，替完旧串必须不在）→
写临时文件 → os.replace 覆盖 → 终检（JSON 合法 / 60 条 / id 顺序不变 / 纯 CRLF）。
"""
import json
import os
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / '资料' / '小红书AI引流工具知识库.json'
TMP = ROOT / 'tmp'

REPL = [
    # ---- drain038 🧠 思维导图图文（3 处）----
    ('drain038',
     '这条路＝挑知识 → 定话题 → 改稿 → 🧠 出导图。前三站：① 挑知识——这趟讲哪条（1~3 条讲透不贪多、最多 3 条；知识条目上带着「写过没有」，AI 会提名没写过 / 最薄的类）；② 定话题——聊什么（候选表每行＝话题 / 这个题底下的一句真事 / 状态）；③ 改稿——AI 照这条知识直接出正文（不满意「✏️ 换个写法重写」）。',
     '这条路＝挑知识 → 改稿 → 🧠 出导图。前两站：① 挑知识——这趟讲哪条（1~3 条讲透不贪多、最多 3 条；知识条目上带着「写过没有」，AI 会提名没写过 / 最薄的类。挑了知识就是定了题——点「下一步」直接出稿，AI 自己从这条知识里挑个最值得写的角度开写）；② 改稿——AI 照这条知识直接出正文（角度不对点「🎲 换个角度重写」，写法不满意「✏️ 换个写法重写」）。'),
    ('drain038',
     '挑 1~3 条知识、点话题、改稿；导图工作区里可以',
     '挑 1~3 条知识、改稿；导图工作区里可以'),
    ('drain038',
     '跟着「下一步」走完前三站 → 出导图长图',
     '跟着「下一步」走完前两站 → 出导图长图'),
    # ---- drain039 ✨ 字体动效视频（3 处）----
    ('drain039',
     '前三站与知识线其它两条共用（挑知识 → 定话题 → 改稿）；出口「✨ 出片」进字效编辑器',
     '前两站与知识线其它两条共用（挑知识 → 改稿——挑了知识直接出稿）；出口「✨ 出片」进字效编辑器'),
    ('drain039',
     '挑知识、点话题、改稿；进编辑器后',
     '挑知识、改稿；进编辑器后'),
    ('drain039',
     '走完前三站 → 「✨ 出片」进字效编辑器',
     '走完前两站 → 「✨ 出片」进字效编辑器'),
    # ---- drain040 🎙 真人口播（3 处）----
    ('drain040',
     '前三站同知识线（挑知识 → 定话题 → 改稿），出口「🎙 收好口播稿」',
     '前两站同知识线（挑知识 → 改稿），出口「🎙 收好口播稿」'),
    ('drain040',
     '挑知识、点话题、改稿到说着顺口。',
     '挑知识、改稿到说着顺口。'),
    ('drain040',
     '走完前三站 → 「🎙 收好口播稿」',
     '走完前两站 → 「🎙 收好口播稿」'),
    # ---- drain047 复盘分析：指路句改到 ① 挑知识 ----
    ('drain047',
     '写进排产表；写稿选话题时「📚 按规划发」卡会摆出来，已排过的显示「📅 已排 周X」',
     '写进排产表；写稿挑知识时「📚 按规划发」卡会摆出来（① 挑知识页顶），已排过的显示「📅 已排 周X」'),
    # ---- drain019 账号诊断：操作路径指路句 ----
    ('drain019',
     '照着排产表发笔记（发笔记 ③ 挑话题时点「📚 按规划发」接下一篇）。',
     '照着排产表发笔记（发笔记 ① 挑知识时点「📚 按规划发」接下一篇）。'),
    # ---- nav005 界面地图：站点串改到知识线/引流线两条 ----
    ('nav005',
     '路上过的挑料 / 话题 / 挑稿 / 改稿几站就是原 6 步向导里的几步（更早建的老档还走原样 6 步向导）',
     '路上过的几站（知识线＝挑知识 → 改稿、引流线＝挑稿 → 改稿）就是原 6 步向导里的几步（更早建的老档还走原样 6 步向导）'),
    # ---- drain029 发笔记·改稿与出图：输入口径句 ----
    ('drain029',
     '⌨️ 输入什么：选定话题后一键生成，或直接给引导话题让 AI 写；改稿写一句要求（如「再短一点」「开头更勾人」），也可以点现成的快捷改法。',
     '⌨️ 输入什么：知识线挑好知识点「下一步」直接出稿（AI 自挑角度开写）、引流线点中一篇稿；改稿写一句要求（如「再短一点」「开头更勾人」），也可以点现成的快捷改法。'),
]


def main():
    raw = KB.read_bytes()
    text = raw.decode('utf-8')

    # 终检基线（改前）
    old_ids = [it['id'] for it in json.loads(text)]
    assert len(old_ids) == 60, f'改前条目数 {len(old_ids)} != 60'
    assert text.count('\r\n') == text.count('\n') == raw.count(b'\n'), '改前不是纯 CRLF'

    # 逐处替换（先全量断言命中数，再统一动手；任一处不中即整体放弃，不写文件）
    plan = []
    cur = text
    for eid, old, new in REPL:
        n = cur.count(old)
        assert n == 1, f'{eid}: 命中 {n} 次（应为 1）\n  old= {old[:60]}...'
        cur = cur.replace(old, new)
        assert old not in cur, f'{eid}: 替换后旧串仍存在'
        assert cur.count(new) >= 1, f'{eid}: 替换后新串不在'
        plan.append((eid, old, new))

    # 终检（改后）
    items = json.loads(cur)
    assert len(items) == 60, f'改后条目数 {len(items)} != 60'
    assert [it['id'] for it in items] == old_ids, 'id 顺序变了！'
    assert cur.count('\r\n') == cur.count('\n'), '改后不是纯 CRLF'
    for eid, old, new in plan:
        assert old not in cur, f'{eid}: 终检旧串仍在'
        n = cur.count(new)
        assert n == 1, f'{eid}: 终检新串命中 {n} 次（应为 1）'

    # 备份 + 临时文件 → os.replace
    ts = time.strftime('%Y%m%d-%H%M%S')
    bak = TMP / f'_kb_wave29_bak_{ts}.json'
    tmpf = TMP / f'_kb_wave29_tmp_{ts}.json'
    shutil.copy2(KB, bak)
    tmpf.write_bytes(cur.encode('utf-8'))
    os.replace(tmpf, KB)

    print(f'[OK] 备份: {bak}')
    print(f'[OK] 已写回: {KB}')
    print(f'[OK] 替换 {len(plan)} 处；60 条 / id 顺序 / 纯 CRLF 全过')
    for eid, old, new in plan:
        print(f'  - {eid}: {len(old)}字 → {len(new)}字  {old[:34]}…')


if __name__ == '__main__':
    main()
