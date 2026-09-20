# -*- coding: utf-8 -*-
"""从竖屏动效页提取每幕讲稿，生成配音稿。
配音已由 tts_voice.py 合成（配音/配音-最终.m4a + .starts.json），
有分幕表就按真实时长写，没有才退回按页面自然语速估算。"""
import json, re, pathlib

SRC = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿\AI雕兄-动效演示-竖屏.html')
OUT = SRC.with_name('AI雕兄-配音稿-竖屏.md')
STARTS = SRC.parent / '配音' / '配音-最终.starts.json'
RATE = 5.2   # 字/秒，与页面默认一致
TAIL = 1.4   # 幕尾留白（秒）

html = SRC.read_text(encoding='utf-8')
scenes = re.findall(
    r'<section class="scene" data-name="([^"]+)">(.*?)</section>', html, re.S)

def text_of(block):
    ps = re.findall(r'<p>(.*?)</p>', block, re.S)
    return [re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', p)) for p in ps]

meta = json.loads(STARTS.read_text(encoding='utf-8')) if STARTS.exists() else None
if meta:
    durs = [float(d) for d in meta['durations']]
    head = [
        '# AI 雕兄 · 竖屏配音稿（%d 幕）' % len(scenes),
        '',
        '> 与《AI雕兄-动效演示-竖屏.html》一一对应；每幕的 `<p>` 就是唯一讲稿真源。',
        '> 时长取自已合成的配音（配音-最终.m4a）：%s · 语速 %s · 幕间静默 %gs。'
        % (meta.get('voice', '?'), meta.get('rate', '?'), meta.get('gap', 0)),
        '> 改词后跑 gen_voice_paste.py 重建粘贴版，再用 tts_voice.py 重新合成即可。',
        '',
        '---',
        '',
    ]
else:
    durs = [max(4.2, sum(len(p) for p in text_of(b)) / RATE + TAIL) for _, b in scenes]
    head = [
        '# AI 雕兄 · 竖屏配音稿（%d 幕）' % len(scenes),
        '',
        '> 与《AI雕兄-动效演示-竖屏.html》自动播放节奏一一对应。',
        '> 尚未合成配音，时长按页面默认语速 5.2 字/秒 + 幕尾 1.4 秒估算（页面里按 `[` `]` 可调）。',
        '',
        '---',
        '',
    ]
lines = head
total = 0
for i, (name, block) in enumerate(scenes, 1):
    ps = text_of(block)
    chars = sum(len(p) for p in ps)
    dur = durs[i - 1] if i <= len(durs) else max(4.2, chars / RATE + TAIL)
    total += dur
    lines.append('## %02d · %s　`%.1f 秒 · %d 字`' % (i, name, dur, chars))
    lines.append('')
    for p in ps:
        lines.append('> ' + p + '  ')
    lines.append('')
lines += ['---', '', '合计 %.1f 秒（%.1f 分钟，含幕间静默）。' % (total, total / 60)]

OUT.write_text('\n'.join(lines), encoding='utf-8')
print('saved:', OUT)
print('scenes:', len(scenes), '| total: %.1fs' % total)
