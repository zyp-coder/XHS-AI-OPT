# -*- coding: utf-8 -*-
"""把 3 个知识库 JSON 的分类统一成 8 类口径（一次性脚本，跑完可删）。

统一分类：产品介绍 / 玩法与机制 / 数据·成本 / 客户痛点 / 避坑经验 / 个人经历 / 使用技巧 / 笔记架构
做法：解析校验 + 纯文本定点替换 category 值，不动 JSON 格式与其余字段。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

# 旧分类 -> 新分类（只做等价映射，不重新判档，避免一次性大改）
OLD2NEW = {
    '专业知识': '数据·成本',
    '数据资料': '数据·成本',
}

JOBS = {
    '资料/房贷计算器知识库.json': {},        # 已在 2026-09-21 完成（专业知识 -> 数据·成本 12 条）
    '资料/绿茶渣男鉴别器知识库.json': {},    # 已完成（专业知识 -> 数据·成本 11 条）
    '资料/小红书AI引流工具知识库.json': {'数据资料': 5},
}


def main():
    for rel, expect in JOBS.items():
        p = ROOT / rel
        text = p.read_text(encoding='utf-8')
        data = json.loads(text)
        for old, n in expect.items():
            new = OLD2NEW.get(old)
            if not new:
                raise SystemExit(f'没有 {old!r} 的映射')
            hits = [e for e in data if e.get('category') == old]
            assert len(hits) == n, f'{rel}: 期望 {n} 条 {old}，实际 {len(hits)} 条'
            key = f'"category": "{old}"'
            assert text.count(key) == n, f'{rel}: 文本里 {key} 出现 {text.count(key)} 次'
            text = text.replace(key, f'"category": "{new}"')
            print(f'{rel}: {old} -> {new}（{n} 条）')
        p.write_text(text, encoding='utf-8', newline='')
    print('全部完成')


main()
