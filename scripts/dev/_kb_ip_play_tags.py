# -*- coding: utf-8 -*-
"""知识库追加校准：drain038~047 的 tags 里旧标「六卡」→「四方向」（2026-10-13）。

漏网情况：_kb_ip_play.py 只扫了 title+content，首轮未查 tags——这 9 条的 tags 里还挂着
「六卡」（drain037/040 已随主脚本改过）。弹层现为四方向（🎭 IP玩法 / 📚 知识 / 🔥 引流 /
🎬 案例），「六卡」这个词不再出现在界面上，统一换成「四方向」。tags 只置换这一个词、
其余 tag 与顺序不动。格式纪律同 _kb_ip_play.py（风格复刻自检 + 精确命中 + 写盘）。
"""
import io
import re
import sys
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / '资料' / '小红书AI引流工具知识库.json'

TARGETS = ['drain038', 'drain039', 'drain041', 'drain042', 'drain043',
           'drain044', 'drain045', 'drain046', 'drain047']

FORBID = ['防封', '反爬', '养号', '规避', '封号', '队列表', '灌水总结', '最快档',
          '拟人化与触达', '推广承接', '已打开过的跳过', '自己去小红书发', '打开微信',
          '造图片', '出片台', '写文案']
FORBID_RE = [
    re.compile(r'搜小程序'),
    re.compile(r'打开[^\n，。]{0,14}小程序'),
    re.compile(r'「线索 → 设置」里配'),
    re.compile(r'灌水频率与去重」（获客 → ⚙️ 设置）'),
    re.compile(r'推广目标、评论区承接'),
    re.compile(r'多产品（全功能版专属）'),
]
COUNT_EQ = ['限流']


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace(',\n', ', \n')


def main():
    raw = KB.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    data = json.loads(raw)
    assert dump(data) == raw.replace('\r\n', '\n'), '序列化风格复刻失败，先对齐格式再改内容'

    by_id = {e['id']: e for e in data}
    for i in TARGETS:
        assert i in by_id, f'缺条目 {i}'
        e = by_id[i]
        assert e['tags'].count('六卡') == 1, f'{i}.tags 里「六卡」不是恰好 1 个：{e["tags"]}'
        e['tags'] = ['四方向' if t == '六卡' else t for t in e['tags']]

    text = dump(data)
    for w in FORBID:
        assert w not in text, f'整库残留禁用词/旧说法：{w}'
    for rx in FORBID_RE:
        assert not rx.search(text), f'整库命中知识包禁则：{rx.pattern}'
    for w in COUNT_EQ:
        assert text.count(w) == raw.count(w), f'「{w}」出现次数变了'
    assert '六卡' not in text and '三个方向' not in text and '三方向' not in text, '还有旧口径残留'

    KB.write_bytes(text.replace('\n', eol).encode('utf-8'))
    print(f'OK：{len(TARGETS)} 条 tags 已校准（六卡 → 四方向），共 {len(data)} 条')


if __name__ == '__main__':
    main()
