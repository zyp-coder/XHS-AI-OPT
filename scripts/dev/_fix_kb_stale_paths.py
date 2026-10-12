# -*- coding: utf-8 -*-
"""
一次性：修 知识库 JSON 里的旧界面路径（页面搬家 / 改名后没跟上的那几句）。

背景：`_refresh_knowledge_pack.py` 的 RESIDUE_FORBID 只在「包内独有的文件」上跑终检，
REPO_MAP 成员（这份 JSON 就是）不在检查范围里，所以旧路径一直没被发现。两类：
  ① 拟人化页改版（二十八改）：细项进「⚙️ 高级配置」弹窗，路径＝获客 → ⚙️ 设置 → 🤖 拟人化与频率 → ⚙️ 高级配置
     命中：drain033（禁用写法 `灌水频率与去重」（获客 → ⚙️ 设置）`）、drain003 / drain034（同类）
  ② 设置页重组（二十九改前后）：知识库 / AI 模型配置 / 获客清单 都不在「设置」底下了，
     分别是 诊断&配置 ⑤ 知识库、设置 → AI 模型配置、线索 → 通知（获客清单）
     命中：drain006 / drain011 / drain026

写盘要求：保持落盘风格（LF、2 空格缩进、行尾 `, `＝逗号+空格），不整篇 json.dump 重排。
脚本可重复跑：已替换过的条目会被跳过。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / '资料' / '小红书AI引流工具知识库.json'

PATH = '获客 → ⚙️ 设置 → 🤖 拟人化与频率 → ⚙️ 高级配置'

REPL = [
    (
        '冷却时间都在「🤖 拟人化与频率 → 💧 灌水频率与去重」里自己调，入口＝获客 → ⚙️ 设置）',
        '冷却时间都在「💧 灌水频率与去重」里自己调，路径＝' + PATH + '）',
        1,
    ),
    (
        '量由「🤖 拟人化与频率 · 💧 灌水频率与去重」（获客 → ⚙️ 设置）里的「每轮最多处理（篇）」与每日上限双重兜底防失控。',
        '量由「💧 灌水频率与去重」里的「每轮最多处理（篇）」与每日上限双重兜底防失控（路径＝' + PATH + '）。',
        1,
    ),
    (
        '配合「🤖 拟人化与频率 → 💧 灌水频率与去重」的上限一起用。',
        '配合「⚙️ 高级配置 → 💧 灌水频率与去重」的上限一起用。',
        1,
    ),
    # ② 设置页重组后搬家的三句
    (
        '设置→知识库→添加条目（填标题/分类/内容/标签）→保存，AI 回评时自动引用，全程不用手动。',
        '诊断&配置 → ⑤ 知识库 → 「新增知识」（填标题 / 分类 / 内容 / 标签）→ 保存，AI 回评时自动引用，全程不用手动。',
        1,
    ),
    (
        '设置→AI配置→填 API Key→选提供商→选模型→保存→点「测试连接」。',
        '设置 → AI 模型配置 → 填 API Key → 选提供商 → 选模型 → 保存 → 点「🔌 测试连接」。',
        1,
    ),
    (
        '设置→获客清单→配收录关键词→每次扫描完点底部分折叠「一键入库」。',
        '线索 → 通知（获客清单）→ 点右上「⚙️ 收录设置」配收录关键词；扫到的商机会自动进清单，不用手动入库。',
        1,
    ),
]

# 终检用：与 _refresh_knowledge_pack.py 的 RESIDUE_FORBID 同源（本文件里这一条就是漏网的那条）
FORBID = [
    '打开微信',
    '搜小程序',
    '灌水总结',
    '最快档',
    '拟人化与触达',
    '「线索 → 设置」里配',
    '灌水频率与去重」（获客 → ⚙️ 设置）',
    '推广承接',
    '推广目标、评论区承接',
    '基础版没有获客',
    '已打开过的跳过',
    '队列表',
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
        assert got == want, f'期望 {want} 处 {old[:24]}…，实际 {got} 处'
        new_raw = new_raw.replace(old, new)
        done.append(old[:22])
    if not done:
        print('· 无需改动（该换的都已换过）')
    else:
        out = json.loads(new_raw)  # 写前必须仍是合法 JSON
        assert len(out) == len(data)
        style_check(out, new_raw)  # 写前风格自检

        left = [(e['id'], pat) for e in out for pat in FORBID if pat in json.dumps(e, ensure_ascii=False)]
        if left:
            raise SystemExit(f'✗ 改完仍有禁用说法残留：{left}')

        SRC.write_text(new_raw, encoding='utf-8')
        print(f'✓ 本次替换 {len(done)} 处：')
        for d in done:
            print('   ·', d + '…')

    back = json.loads(SRC.read_text(encoding='utf-8'))
    print(f'✓ 共 {len(back)} 条，未增删，id 唯一 {len({e["id"] for e in back}) == len(back)}')


if __name__ == '__main__':
    main()
