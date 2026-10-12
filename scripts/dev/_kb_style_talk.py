# -*- coding: utf-8 -*-
"""一次性：发笔记加「④ 叙事风格 + 🎚 卖货话术比例」、撤主副调子（2026-09-28 三十六改）的资料侧同步 —— 知识库 JSON。

口径（真源 `extension/lib/note-plan.js` 的 STYLE_ROUTES / SELL_TALK，给人看的那份是
资料/功能与界面总表.md §2.9 与 资料/推广物料/使用说明.md 三十六改）：
发笔记向导 5 → **6 步**（卖点 → 人群 → 话题 → **叙事风格** → 成稿 → 出料）；
④ 叙事风格＝这条按什么调子讲（八条路线，默认沿用「诊断&配置 → ⑧ 规划」的账号调子，可就地换这一条）
＋ 🎚 卖货话术比例（不提产品 / 轻带一句 / 自然安利 / 主打推荐 四档，同样可就地改这一篇的）；
**主副调子（subRoute + 比例）整套已撤**。

改这 5 处（都是客户照着点会点错、或这轮之后会答错的地方）：
  drain028 发笔记向导：标题的步骤链补「叙事风格」；正文 ④ 拆成「叙事风格」+「写成稿」、⑤ 顺延成 ⑥
  pdesc001 产品定位总述：三大支柱里那句步骤链补「叙事风格」
  nav002   ⑧ 规划那节点：账号默认改成「按它怎么写 + 卖货话术占多少」
  nav005   发笔记 4 页：5 步 → 6 步，写清 ④ 是什么；操作路径同步
  nav006   发笔记能发到哪些平台：步骤链补「叙事风格」；操作路径 5 步 → 6 步
  drain030 （已停用）发笔记·定时发布：操作路径的步数同步成 6 步

格式安全：这个文件是「2 空格缩进 + 行尾 `, `（逗号带一个空格）」的序列化风格、LF 换行，
直接 json.dump 会整篇重排。脚本先把原文反序列化再按同一风格重建，要求与原文逐字节一致
（不一致就报错退出、不写盘），每条替换都断言「恰好命中 1 处」。
"""
import io
import sys
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / '资料' / '小红书AI引流工具知识库.json'

# 终检：新写的字不许带这些（前半＝对外合规底线，后半＝这轮之前的旧口径）
FORBID = [
    '防封', '反爬', '养号', '规避',
    '副调子', '主8:副2', '主7:副3', '5 步向导（卖点', '（走 5 步）', '走 5 步到成稿',
]


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace(',\n', ', \n')


def sub(node, key, old, new):
    text = node[key]
    n = text.count(old)
    assert n == 1, f"{node.get('id')}.{key}: 期望命中 1 处，实际 {n} 处 —— {old[:40]}"
    node[key] = text.replace(old, new)


def main():
    raw = KB.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    data = json.loads(raw)
    assert dump(data) == raw.replace('\r\n', '\n'), '序列化风格复刻失败：重建后与原文不一致，先对齐格式再改内容'

    by_id = {e['id']: e for e in data}
    for i in ('drain028', 'pdesc001', 'nav002', 'nav005', 'nav006', 'drain030'):
        assert i in by_id, f'缺条目 {i}'

    # ── drain028 · 发笔记向导 ────────────────────────────────────────
    d28 = by_id['drain028']
    sub(d28, 'title', '话题→成稿→出料', '话题→叙事风格→成稿→出料')
    sub(d28, 'content', '；④写成稿：',
        '；④叙事风格：定这条按什么调子讲（默认沿用「诊断&配置 → ⑧ 规划」定好的账号调子，'
        '八条路线可就地换这一条）＋这篇卖多少（卖货话术比例四档：不提产品 / 轻带一句 / 自然安利 / 主打推荐，'
        '改了只影响这一条，不动账号默认）；⑤写成稿：')
    sub(d28, 'content', '；⑤出料：', '；⑥出料：')

    # ── pdesc001 · 产品定位总述 ─────────────────────────────────────
    sub(by_id['pdesc001'], 'content', '（卖点→人群→话题→成稿→出料）', '（卖点→人群→话题→叙事风格→成稿→出料）')

    # ── nav002 · ⑧ 规划节点 ────────────────────────────────────────
    sub(by_id['nav002'], 'content',
        '顶上先定 🎨 调子（账号默认——笔记按它怎么写，发笔记默认沿用它、单篇可就地换）',
        '顶上先定 🎨 调子（账号默认——笔记按它怎么写、卖货话术占多少，发笔记默认沿用它、单篇可就地换）')

    # ── nav005 · 发笔记 4 页 ───────────────────────────────────────
    n5 = by_id['nav005']
    sub(n5, 'content',
        '再走 5 步向导（卖点 → 人群 → 话题 → 成稿 → 出料）；顶部常驻 🎨 调子＝沿用「诊断&配置 → ⑧ 规划」定好的账号调子，'
        '这一篇想换个讲法就地换（只改这一条，不动账号默认）。',
        '再走 6 步向导（卖点 → 人群 → 话题 → 叙事风格 → 成稿 → 出料）：④ 叙事风格＝这条按什么调子讲、卖多少——'
        '默认沿用「诊断&配置 → ⑧ 规划」定好的账号调子与卖货话术比例，八条路线可就地换这一条的、'
        '卖货话术比例四档（不提产品 / 轻带一句 / 自然安利 / 主打推荐）也能改（只动这一条，不动账号默认）。')
    sub(n5, 'content', '发笔记 → 写一篇（走 5 步）→ 需要的图去素材库备', '发笔记 → 写一篇（走 6 步）→ 需要的图去素材库备')

    # ── nav006 · 四平台 ────────────────────────────────────────────
    n6 = by_id['nav006']
    sub(n6, 'content', '再走 卖点 → 人群 → 话题 → 成稿 → 出料', '再走 卖点 → 人群 → 话题 → 叙事风格 → 成稿 → 出料')
    sub(n6, 'content', '走 5 步到成稿', '走 6 步到成稿')

    # ── drain030 · （已停用）定时发布 ──────────────────────────────
    sub(by_id['drain030'], 'content', '（5 步向导）', '（6 步向导）')

    out = dump(data)
    for bad in FORBID:
        assert bad not in out, f'终检失败：不该再出现「{bad}」'
    assert '"id": "drain028"' in out

    KB.write_bytes((out.replace('\n', eol) if eol == '\r\n' else out).encode('utf-8'))
    print('已写盘：', KB)
    for i in ('drain028', 'pdesc001', 'nav002', 'nav005', 'nav006', 'drain030'):
        e = by_id[i]
        print(' ', i, '|', e['title'])
        if i in ('nav005', 'nav006', 'drain030'):
            line = [x for x in e['content'].split('\n') if '操作路径' in x]
            if line:
                print('      ', line[0][:160])


if __name__ == '__main__':
    main()
