# -*- coding: utf-8 -*-
"""
一次性：三档换盘（2026-10-09 老板定）后，把 知识库 JSON 里的档位口径拨到新边界。

新边界：① 基础版 ＝ 共有 + 发笔记（含出片台、四平台）；② 升级版 ＝ ① + 获客；③ 全功能版 ＝ ② + 线索。
涉及 6 处：
  ① ver001 怎么算：档位公式 + 三段「X 起有」行序（发笔记挪到 ①、获客挪到 ②、线索挪到 ③）
  ② ver001 输入什么：「想清两件事」的反问句随边界重写（获客＝②、线索＝③、发笔记三档都有）
  ③ nav004 标题：「（② 升级版起）」→「（③ 全功能版起）」（线索整块挪到 ③）
  ④ nav002 正文：「客户问答话术库 + 试问答（② 升级版起）」→「（③ 全功能版起）」
  ⑤ nav005 标题：「（③ 全功能版）」→「（① 基础版起）」（发笔记三档全开）
  ⑥ drain029 正文：「（全功能版功能，不用装剪辑软件」→「（不用装剪辑软件」（本机出片三档全开）

写盘要求：保持落盘风格（LF、行尾 `, `＝逗号+空格），不整篇 json.dump 重排。
脚本可重复跑：已替换过的条目会被跳过。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / '资料' / '小红书AI引流工具知识库.json'

REPL = [
    # ① ver001 怎么算：档位公式
    (
        '① 基础版 ¥239/月 ＝ 共有 + 获客；② 升级版 ¥399/月 ＝ ① + 线索；③ 全功能版 ¥539/月 ＝ ② + 发笔记。',
        '① 基础版 ¥239/月 ＝ 共有 + 发笔记；② 升级版 ¥399/月 ＝ ① + 获客；③ 全功能版 ¥539/月 ＝ ② + 线索。',
        1,
    ),
    # ① ver001 怎么算：三段「X 起有」拆开换位——先把旧前两段+发笔记开头换成发笔记开头
    (
        '① 起有获客（一键灌水 / 笔记列表 / 关键词维护·自动找词）；② 起有线索（线索触达 / 获客清单 / 通知回访 / 客服话术）；③ 才有发笔记（笔记档案 + 素材库，',
        '① 起有发笔记（笔记档案 + 素材库，',
        1,
    ),
    # ① ver001 怎么算：发笔记描述尾部收口 + 补回获客 / 线索两段（新：② 获客、③ 线索）
    (
        '本机出片（出片台那两种成片形式）就在这档里）。',
        '本机出片（出片台那两种成片形式）也在内）；② 起有获客（一键灌水 / 笔记列表 / 关键词维护·自动找词）；③ 起有线索（线索触达 / 获客清单 / 通知回访 / 客服话术）。',
        1,
    ),
    # ② ver001 输入什么：卡点两问随边界换位
    (
        '选档前只要想清两件事——要不要主动私信跟进客户（要＝至少 ②）、要不要自己出笔记和视频（要＝③）。',
        '选档前只要想清两件事——要不要在评论区获客（要＝至少 ②）、要不要主动私信跟进客户（要＝③）；只想写笔记、发笔记（含出片台、四平台），① 就够。',
        1,
    ),
    # ③ nav004 标题
    (
        '线索 4 页：通知 / 消息 / 任务配置 / 设置（② 升级版起）',
        '线索 4 页：通知 / 消息 / 任务配置 / 设置（③ 全功能版起）',
        1,
    ),
    # ④ nav002 正文
    (
        '客户问答话术库 + 试问答（② 升级版起）在「线索 → 任务配置」',
        '客户问答话术库 + 试问答（③ 全功能版起）在「线索 → 任务配置」',
        1,
    ),
    # ⑤ nav005 标题
    (
        '发笔记：笔记档案是主页，写文案 / 素材库 / 造图片 / 出片台 / 教程都在它底下（③ 全功能版）',
        '发笔记：笔记档案是主页，写文案 / 素材库 / 造图片 / 出片台 / 教程都在它底下（① 基础版起）',
        1,
    ),
    # ⑥ drain029 正文：本机出片不再是 ③ 专属
    (
        '在本机直接出一条竖版成片（全功能版功能，不用装剪辑软件；',
        '在本机直接出一条竖版成片（不用装剪辑软件；',
        1,
    ),
]

# 终检：改完这两个说法不许再出现（旧边界 / 旧档位标签）
FORBID = [
    '共有 + 获客',
    '② 升级版起',
    '（③ 全功能版）',
    '全功能版功能，',
    '③ 才有发笔记',
    '要不要自己出笔记和视频',
]

# 终检：这几个新说法必须落到位
REQUIRE = [
    ('ver001', '① 基础版 ¥239/月 ＝ 共有 + 发笔记'),
    ('ver001', '② 升级版 ¥399/月 ＝ ① + 获客'),
    ('ver001', '③ 全功能版 ¥539/月 ＝ ② + 线索'),
    ('ver001', '① 起有发笔记'),
    ('ver001', '② 起有获客'),
    ('ver001', '③ 起有线索'),
    ('nav004', '（③ 全功能版起）'),
    ('nav005', '（① 基础版起）'),
]


def dumps_style(obj, indent=2):
    text = json.dumps(obj, ensure_ascii=False, indent=indent)
    return text.replace(',\n', ', \n')


def style_check(data, raw):
    rebuilt = '[\n' + ', \n'.join('  ' + dumps_style(e).replace('\n', '\n  ') for e in data) + '\n]'
    if rebuilt != raw:
        raise SystemExit('✗ 风格复刻不一致，未写盘（序列化格式和原文件对不上）')


def main():
    raw = SRC.read_text(encoding='utf-8')
    data = json.loads(raw)
    style_check(data, raw)

    new_raw = raw
    done = []
    for old, new, want in REPL:
        got = new_raw.count(old)
        if got == 0:
            continue          # 重复跑：这一条已经换过了
        assert got == want, f'期望 {want} 处 {old[:26]}…，实际 {got} 处'
        new_raw = new_raw.replace(old, new)
        done.append(old[:24])
    if not done:
        print('· 无需改动（该换的都已换过）')
    else:
        out = json.loads(new_raw)  # 写前必须仍是合法 JSON
        assert len(out) == len(data)
        style_check(out, new_raw)  # 写前风格自检

        left = [(e['id'], pat) for e in out for pat in FORBID if pat in json.dumps(e, ensure_ascii=False)]
        if left:
            raise SystemExit(f'✗ 改完仍有旧口径残留：{left}')

        SRC.write_text(new_raw, encoding='utf-8')
        print(f'✓ 本次替换 {len(done)} 处：')
        for d in done:
            print('   ·', d + '…')

    back = {e['id']: e for e in json.loads(SRC.read_text(encoding='utf-8'))}
    for eid, pat in REQUIRE:
        assert pat in json.dumps(back[eid], ensure_ascii=False), f'✗ {eid} 缺新口径：{pat}'
    print(f'✓ 共 {len(back)} 条，未增删，id 唯一 {len(back) == 49}')
    print('✓ 新口径逐条抽查通过')


if __name__ == '__main__':
    main()
