# -*- coding: utf-8 -*-
"""客户模板：一份文案数据 → ① 出配音用的幕页 ② canvas 出片用的分幕时间轴。

两套内置稿子：
  sample = 3 幕 81 字（就是已出的 4 条风格样片那条）
  demo   = 6 幕 · 覆盖全部幕版式（居中一句话 / 左对齐 / 要点列表 / 数字幕），用来验收模板承载力

新笔记：分幕从口播稿现生成，不复用上一支片子——在「调风格.html」里粘口播稿点「生成分幕」，
「下载分幕 JSON」给我，然后（--scenes 就是那个文件，--as 是新笔记的标识）：
  python3 scripts/dev/gen_sample.py --scenes 分幕-xxx.json --as 新笔记
  python3 scripts/dev/tts_voice.py --html "资料/视频/客户模板样片/新笔记文案.html" \
      --voice zh-CN-XiaoxiaoNeural --rate "+20%" --gap 0.5 \
      --out "资料/视频/客户模板样片/配音-新笔记-晓晓.m4a"
  python3 scripts/dev/gen_sample.py --scenes 分幕-xxx.json --as 新笔记 --timeline
  python3 scripts/dev/render_style_film.py --script 新笔记 --cfg "<面板复制的那行>"
改内置稿子的文案只改本文件的 SCENES / SCENES_DEMO，再跑同样三条命令。
"""
import argparse, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / '资料' / '视频' / '客户模板样片'
HEAD, TAIL = 0.8, 1.4          # 片头 / 片尾留白（与现有口播片一致）
LAYOUTS = ('center', 'left', 'list', 'number')   # 与 scenes.js 的 Renderer.LAYOUTS 对齐

# ---- 3 幕 · 81 字，取自已合规的短版稿：痛点 → 观点 → 收口 ----
SCENES = [
    dict(label='01', name='痛点',
         text='小生意做线上，两个问题没想明白。',
         lines=['小生意做线上，', '两个问题没想明白。'],
         em=[dict(l=1, t='两个问题')]),
    dict(label='02', name='观点',
         text='真正的获客，是去他已经在搜、已经在问的地方接住他。',
         lines=['真正的获客，', '是去他已经在搜、', '已经在问的地方接住他。'],
         em=[dict(l=2, t='接住他')]),
    dict(label='03', name='收口',
         text='想跑通这套，联系我免费做个测评——前大厂码农，方向对不对，做一次就知道。私信我。',
         lines=['想跑通这套，', '联系我免费做个测评', '前大厂码农，方向对不对，', '做一次就知道。私信我。'],
         em=[dict(l=3, t='私信我')]),
]

# ---- 6 幕 · 全部幕版式各来一次，看模板能不能撑住真实内容 ----
SCENES_DEMO = [
    dict(label='01', name='痛点', layout='center',
         text='一个人做小红书，凌晨还在发笔记。三个月过去，一个咨询都没有。',
         lines=['一个人做小红书，', '凌晨还在发笔记。', '三个月过去，一个咨询都没有。'],
         em=[dict(l=2, t='一个咨询都没有')]),
    dict(label='02', name='观点', layout='left',
         text='不是你不行。是你从头到尾，都在瞎使劲。',
         lines=['不是你不行。', '是你从头到尾，', '都在瞎使劲。'],
         em=[dict(l=2, t='瞎使劲')]),
    dict(label='03', name='关键', layout='list',
         text='真正管用的就三步：找对人，说对话，在他已经在的地方接住他。',
         lines=['找对人', '说对话', '在他已经在的地方接住他'],
         em=[]),
    dict(label='04', name='打法', layout='number',
         text='这套系统里有十二种打法，每一种都对应一个具体场景。',
         lines=['12 种打法', '每一种，对应一个具体场景'],
         em=[]),
    dict(label='05', name='背书', layout='center',
         text='前大厂码农，方向对不对，做一次就知道。',
         lines=['前大厂码农，', '方向对不对，', '做一次就知道。'],
         em=[dict(l=2, t='做一次就知道')]),
    dict(label='06', name='收口', layout='center',
         text='私信我，免费给你做一次测评。',
         lines=['私信我，', '免费给你做一次测评。'],
         em=[dict(l=0, t='私信我')]),
]

SCRIPTS = {
    'sample': dict(scenes=SCENES, page='样片文案.html', tl='timeline.js', gvar='TIMELINE',
                   audio='配音-样片-晓晓.m4a', title='客户模板样片 · 15s 文案'),
    'demo':   dict(scenes=SCENES_DEMO, page='演示文案.html', tl='timeline-demo.js', gvar='TIMELINE_DEMO',
                   audio='配音-演示-晓晓.m4a', title='客户模板演示片 · 6 幕'),
}

HTML_TPL = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}（{n} 幕）</title>
<!-- 本文件由 scripts/dev/gen_sample.py 生成，改文案请改脚本里的 SCENES 再重跑 -->
<style>
  body{{margin:0;padding:40px 28px;background:#141414;color:#eaeaea;
       font:16px/1.9 "Microsoft YaHei",sans-serif}}
  h1{{font-size:20px;margin:0 0 6px;color:#f97316}}
  .tip{{font-size:13px;color:#8a8a8a;margin-bottom:22px}}
  .scene{{border-left:3px solid #f97316;padding:10px 0 10px 18px;margin:0 0 22px}}
  .no{{font-size:12px;color:#f97316;letter-spacing:2px}}
  .lay{{font-size:11px;color:#7a7a7a;border:1px solid #333;border-radius:8px;padding:1px 7px;margin-left:8px}}
  p{{margin:4px 0 0;font-size:22px}}
</style>
</head>
<body>
<h1>{title}</h1>
<div class="tip">{n} 幕 · 共 {chars} 字 · 文案已按合规口径过一遍。改词只改下面的 &lt;p&gt;。</div>
{secs}
</body>
</html>
'''


def read_scenes(path):
    """读面板导出的分幕 JSON：{scenes:[{label,name,text,lines,em,layout}]}，缺的字段兜一下"""
    d = json.loads(Path(path).read_text(encoding='utf-8'))
    list_ = d['scenes'] if isinstance(d, dict) else d
    out = []
    for i, s in enumerate(list_):
        lines = [x.strip() for x in (s.get('lines') or []) if str(x).strip()]
        text = (s.get('text') or ''.join(lines)).strip()
        if not text:
            raise SystemExit(f'分幕表第 {i + 1} 幕既没 text 也没 lines，没法配音')
        em = [dict(l=int(e.get('l') or 0), t=str(e.get('t')).strip())
              for e in (s.get('em') or []) if str(e.get('t') or '').strip()]
        lay = s.get('layout') if s.get('layout') in LAYOUTS else 'center'
        out.append(dict(label=str(s.get('label') or i + 1).zfill(2), name=s.get('name') or '',
                        text=text, lines=lines or [text], em=em, layout=lay))
    return out


def script_conf(key, scenes=None):
    """内置稿子用 SCRIPTS 里的；--as 出来的新笔记按约定命名（跟 render_style_film.py 同一套）"""
    if scenes is None:
        return SCRIPTS[key]
    return dict(scenes=scenes, page=f'{key}文案.html', tl=f'timeline-{key}.js',
                gvar='TIMELINE_' + key.upper().replace('-', '_'),
                audio=f'配音-{key}-晓晓.m4a', title=f'{key} · {len(scenes)} 幕')


def write_html(cfg):
    secs = '\n'.join(
        f'<section class="scene" data-name="{s["label"]}-{s.get("name", "")}">\n'
        f'  <div class="no">{s["label"]} · {s.get("name", "")}'
        f'<span class="lay">{s.get("layout", "center")}</span></div>\n'
        f'  <p>{s["text"]}</p>\n</section>'
        for s in cfg['scenes'])
    chars = sum(len(s['text']) for s in cfg['scenes'])
    out = HTML_TPL.format(title=cfg['title'], n=len(cfg['scenes']), chars=chars, secs=secs)
    (DIR / cfg['page']).write_text(out, encoding='utf-8')
    print(f'幕页：{DIR / cfg["page"]}（{len(cfg["scenes"])} 幕 {chars} 字）')


def write_timeline(cfg):
    sj = (DIR / cfg['audio']).with_suffix('.starts.json')
    if not sj.exists():
        raise SystemExit(f'没有分幕表 {sj}，先跑一遍 tts_voice.py')
    sc_in = cfg['scenes']
    d = json.loads(sj.read_text(encoding='utf-8'))
    starts, last = d['starts'], len(sc_in) - 1
    if len(starts) != len(sc_in):
        raise SystemExit(f'分幕 {len(sc_in)} 幕、配音分幕表 {len(starts)} 幕，两边对不上——'
                         f'配音是按哪份幕页念的？幕页要和分幕 JSON 同源')
    scenes = []
    for i, s in enumerate(sc_in):
        st = round(HEAD + starts[i], 3)
        en = round(HEAD + starts[i + 1], 3) if i < last else round(HEAD + d['total'] + TAIL, 3)
        scenes.append(dict(label=s['label'], name=s.get('name', ''), layout=s.get('layout', 'center'),
                           start=st, end=en, text=s.get('text', ''), lines=s['lines'], em=s['em'],
                           cta=(i == last)))
    dur = scenes[-1]['end']
    body = json.dumps(dict(head=HEAD, tail=TAIL, dur=dur, audio=d['total'],
                           voice=d['voice'], scenes=scenes), ensure_ascii=False, indent=1)
    out = ('/* 由 scripts/dev/gen_sample.py --timeline 生成，勿手改 */\n'
           'window.' + cfg['gvar'] + ' = ' + body + ';\n')
    (DIR / cfg['tl']).write_text(out, encoding='utf-8')
    print(f'时间轴：{DIR / cfg["tl"]}  总长 {dur:.2f}s（配音 {d["total"]}s）')
    for c in scenes:
        print(f'  {c["label"]} {c["start"]:6.2f} → {c["end"]:6.2f}s  {c["layout"]:>7}  {len(c["lines"])} 行')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='sample', help='内置稿子（sample / demo），与 --scenes 二选一')
    ap.add_argument('--scenes', help='面板导出的分幕 JSON（新笔记走这条路）')
    ap.add_argument('--as', dest='key', default='新笔记', help='新笔记的标识，决定文件名与时间轴变量名')
    ap.add_argument('--timeline', action='store_true', help='读 .starts.json 写时间轴 js（默认只写幕页）')
    a = ap.parse_args()

    if a.scenes:
        CONF = script_conf(a.key, read_scenes(a.scenes))
    elif a.script in SCRIPTS:
        CONF = SCRIPTS[a.script]
    else:
        raise SystemExit(f'没有内置稿子「{a.script}」，内置的只有 {"/".join(sorted(SCRIPTS))}；'
                         f'新笔记请用 --scenes <分幕.json> --as <标识>')
    write_timeline(CONF) if a.timeline else write_html(CONF)
