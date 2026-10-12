# -*- coding: utf-8 -*-
"""六十七改补记（二）：nav005 的 tags 里残留旧叫法「出片台」→「渲染任务」。

上轮全量改口只扫了 title/content、漏扫 tags（检索权重里 tags ×10，不能留旧词）。
只改 nav005 一条的 tags 一项，其余 59 条逐条比对不许动。
"""
import json
import pathlib

KB = pathlib.Path('资料/小红书AI引流工具知识库.json')

OLD_TAGS = ['发笔记', '素材库', '笔记档案', '出片台', '口播稿']
NEW_TAGS = ['发笔记', '素材库', '笔记档案', '渲染任务', '口播稿']


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace(',\n', ', \n')


def main():
    raw = KB.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    data = json.loads(raw)
    assert dump(data) == raw.replace('\r\n', '\n'), '序列化风格复刻失败'
    ids_before = [e['id'] for e in data]

    by = {e['id']: e for e in data}
    assert by['nav005']['tags'] == OLD_TAGS, 'nav005 tags 与脚本预期不符：' + repr(by['nav005']['tags'])
    by['nav005']['tags'] = NEW_TAGS

    text = dump(data)
    assert '出片台' not in text, '「出片台」仍在'
    data2 = json.loads(text)
    for a, b in zip(data, data2):
        assert a == b or a['id'] == 'nav005', f'误改 {a["id"]}'

    KB.write_bytes(text.replace('\n', eol).encode('utf-8'))
    raw2 = KB.read_bytes()
    assert raw2.count(b'\r\n') == raw2.count(b'\n'), '落盘不是纯 CRLF'
    d2 = json.loads(raw2.decode('utf-8'))
    assert [x['id'] for x in d2] == ids_before, 'id 顺序变了'
    assert len(d2) == 60, f'条数变了：{len(d2)}'
    print(f'OK：nav005 标签出片台→渲染任务；共 {len(d2)} 条，纯 CRLF {len(raw2)} 字节')


if __name__ == '__main__':
    main()
