# -*- coding: utf-8 -*-
"""一次性：人设轴改「一句话」+ ⑧ 表改三行（2026-09-28 三十五改，详见 资料/推广物料/使用说明.md）。

口径（真源 `extension/lib/note-plan.js` 的 STAGE_PLAY 与 `extension/popup.js` 的 DIAG_QUIZ 第 9 题）：
个人人设＝一句话（你是谁、在干嘛、擅长什么、能帮客户什么），② 问卷第 9 题自己写，或让 ⑧ 的 AI 按资料写；
⑧ 顶部的表是三行＝三个阶段（冷启动 / 成长 / 成熟），每行写「这句话在这个阶段怎么说 + 建议调子」。

改 nav002 三处：
  1) 「10 个问题」→「13 个问题」；2) 「答 10 问」→「答 13 问」（问卷早已 13 题，这两处是旧数没跟上）
  3) ⑧ 那句里「账号阶段 × 个人人设二维表（按 ② 问卷里『你想让人觉得你是哪种人』…）」→ 一句话人设 × 三阶段表

格式安全：这个文件是「2 空格缩进 + 行尾 `, `（逗号带一个空格）」的序列化风格、CRLF 换行，
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

# 终检：新写的字不许带这些（前三＝对外合规底线，其余＝这轮之前的旧口径）
FORBID = [
    '防封', '反爬', '养号', '规避',
    '二维表', '想让人觉得你是哪种人', '六类人设', '6 类人设',
]


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace(',\n', ', \n')


def sub(entry, old, new):
    text = entry['content']
    n = text.count(old)
    assert n == 1, f"{entry['id']}: 期望命中 1 处，实际 {n} 处 —— {old[:40]}"
    entry['content'] = text.replace(old, new)


def main():
    raw = KB.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    data = json.loads(raw)
    assert dump(data) == raw.replace('\r\n', '\n'), '序列化风格复刻失败：重建后与原文不一致，先对齐格式再改内容'

    by_id = {e['id']: e for e in data}
    assert 'nav002' in by_id, '缺条目 nav002'

    n2 = by_id['nav002']
    sub(n2, '② 问卷：10 个问题一次问清，是唯一的生成口', '② 问卷：13 个问题一次问清，是唯一的生成口')
    sub(n2, '① 填产品与账号 → ② 答 10 问', '① 填产品与账号 → ② 答 13 问')
    sub(n2,
        '＋ 🧬 账号阶段 × 个人人设二维表（按 ② 问卷里「你想让人觉得你是哪种人」这一题点亮「你在这」那一格），再是内容规划',
        '＋ 🧬 一句话人设 × 三阶段表（人设＝② 问卷第 9 题里你自己写的那句话——你是谁、在干嘛、'
        '擅长什么、能帮客户什么；三行＝冷启动 / 成长 / 成熟，每行写「这句话在这个阶段怎么说 + 建议调子」，'
        '当前阶段那行标「你在这」），再是内容规划')

    text = dump(data)
    for w in FORBID:
        assert w not in text, f'残留旧说法/禁用词：{w}'
    KB.write_bytes(text.replace('\n', eol).encode('utf-8'))
    print(f'OK：知识库 JSON 已同步（{len(data)} 条）')


if __name__ == '__main__':
    main()
