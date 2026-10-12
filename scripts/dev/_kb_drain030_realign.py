# -*- coding: utf-8 -*-
"""六十七改补记（二）：drain030 改口径重开——「已停用·不做排期代发」→「定时发布＝排进发布队列到点发」。

老板口径：「改一下 drain030，口径对齐发布队列」。
只改 drain030 一条的四个字段：title / tags / content / isActive(False→True)；其余 59 条逐条比对不许动。
终检：旧口径句零残留（别再对外讲 / 不做排期 / 不代填发布页 / 已停用 / 能力边界）、禁用词零命中、
「限流」持平、60 条与 id 顺序不变、纯 CRLF。
"""
import json
import pathlib

KB = pathlib.Path('资料/小红书AI引流工具知识库.json')

OLD_TITLE = '（已停用）发笔记·定时发布：扩展不做排期代发'
NEW_TITLE = '发笔记·定时发布：排进「发布队列」到点发（可开「✋ 过目」）'
NEW_TAGS = ['发笔记', '定时发布', '排期', '发布队列', '到点发']
NEW_CONTENT = '''🔥 处理什么问题：内容备好了，可「几点发、哪天发」老忘、到点手忙脚乱；想固定成节奏又坚持不住。

📐 怎么算：定时发布＝把备好的篇排进「发笔记 → 发布队列」——每个位子带日期和时间（默认 12:00，快捷 08:00 / 12:00 / 19:00 / 21:00＋自定），到点自动发；想让这一条自己盯一眼，就把位子开「✋ 过目」——到点先备好一切、停在发布前等你点。到点发之前，AI 按这篇要发的每家平台的规矩各改一版（拿掉敏感说法）。

⌨️ 输入什么：在「发布队列」点「＋ 排一篇」从档案里挑篇、给位子定时间；要过目的位子点开 ✋。

📤 得出什么结果：排好的那天到点自己发出去（或停在发布前等你点）；发完的篇落进页底「📜 最近发过」，各家的链接都存着。

📊 相关口径：发布节奏仍是小红书冷启动与稳定权重的重要一环——账号诊断给的节奏是建议，发布队列替你把它落成一个个带时间的位子；缺料的位子状态章上会标出来，用救援钮（✍ 去定稿 / 📁 交文件 / 👁 适配稿）补齐；视频号要微信扫码登录、会过期——没登录到点跳过它、别家照发。

📱 操作路径：发笔记 → 发布队列 → 「＋ 排一篇」从档案挑篇 → 定位子、定时间（要过目就开 ✋）→ 到点它自己发（或等你点）。'''

FORBID = ['防封', '反爬', '养号', '规避', '封号']
COUNT_EQ = ['限流']
GONE = ['别再对外讲', '不做排期', '不代填发布页', '已停用', '能力边界']


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace(',\n', ', \n')


def main():
    raw = KB.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    data = json.loads(raw)
    assert dump(data) == raw.replace('\r\n', '\n'), '序列化风格复刻失败：重建后与原文不一致，先对齐格式再改内容'
    ids_before = [e['id'] for e in data]

    by = {e['id']: e for e in data}
    assert 'drain030' in by, '缺条目 drain030'
    e = by['drain030']
    assert e['title'] == OLD_TITLE, 'drain030 标题与脚本预期不符：' + e['title']
    assert e['isActive'] is False, 'drain030 不是停用态'
    assert '已停用' in e['tags'], 'drain030 tags 里没有已停用'

    e['title'] = NEW_TITLE
    e['tags'] = NEW_TAGS
    e['content'] = NEW_CONTENT
    e['isActive'] = True

    text = dump(data)
    assert OLD_TITLE not in text, '旧标题还在'
    for w in GONE:
        assert w not in text, f'旧口径残留：{w}'
    assert text.count(NEW_TITLE) == 1, '新标题命中数不为 1'

    for w in FORBID:
        assert w not in text, f'命中禁用词：{w}'
    for w in COUNT_EQ:
        assert text.count(w) == raw.count(w), f'「{w}」次数变了：{raw.count(w)} → {text.count(w)}'

    data2 = json.loads(text)
    for a, b in zip(data, data2):
        assert a == b or a['id'] == 'drain030', f'误改 {a["id"]}'

    KB.write_bytes(text.replace('\n', eol).encode('utf-8'))
    raw2 = KB.read_bytes()
    assert raw2.count(b'\r\n') == raw2.count(b'\n'), '落盘不是纯 CRLF'
    d2 = json.loads(raw2.decode('utf-8'))
    assert [x['id'] for x in d2] == ids_before, 'id 顺序变了'
    assert len(d2) == 60, f'条数变了：{len(d2)}'
    assert d2[[x['id'] for x in d2].index('drain030')]['isActive'] is True, 'drain030 未启用'
    print(f'OK：drain030 改口径重开（已停用 → 现行口径、isActive True）；共 {len(d2)} 条，纯 CRLF {len(raw2)} 字节')


if __name__ == '__main__':
    main()
