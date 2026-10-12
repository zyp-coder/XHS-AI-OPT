"""五条线 × 写法对照报告：读 tmp/type-matrix/draft-*.md，量出"这几篇到底散没散"。

跑法：python3 scripts/dev/_type_matrix_report.py   （TM_OUT 可换目录）
产物：tmp/type-matrix/五条线对照.md

口径（2026-09-29 四十二改：八类 → 五条线 × 4-5 写法，报告按"线·写法"出标签）：
  · 机器词＝产品名之前出现的行内黑话（清单/队列/关键词/素材库…）次数——越高＝铺垫被产品解说吞得越多
  · 产品首现% ＝ 产品名第一次出现的位置（字符占比）
  · 段数 / 汉字数 / 有无分点编号 / 开篇句 / 末句
  · 特征料命中：这一线（＋这种写法）该有的东西到底出现没有
"""
import os
import pathlib
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / (os.environ.get('TM_OUT') or 'tmp/type-matrix')

PRODUCT = '小红书AI引流工具'
MECH = ['清单', '待触达', '已触达', '上限', '冷却', '队列', '排好队', '扫描', '收录',
        '素材库', '话术库', '本机', '浏览器扩展', '关键词', '自己跑', '自动']

# 五条线（键 → 中文名）＋ 这一轮对照用到的那几种写法
LINES = {'tale': '故事线', 'echo': '共鸣线', 'meme': '热梗线', 'hot': '热点线', 'howto': '干货线'}
KINDS = {'scene': ('tale', '现场故事'), 'history': ('tale', '历史文化'), 'mirror': ('echo', '处境对号入座'),
         'docform': ('meme', '文体切换'), 'hotFit': ('hot', '热点理解→产品感悟'), 'steps': ('howto', '教程步骤')}

# 这一线的"特征料"
FEATURE = {
    'tale': ['后来', '那年', '那时候', '我记得', '最后', '一段'],
    'echo': ['其实', '承认', '心里', '不敢', '嘴', '谁'],
    'meme': ['梗', '笑', '一本正经', '离谱', '家人们', '台词'],
    'hot': ['最近', '大家', '都在说', '这阵子', '话题', '新闻'],
    'howto': ['怎么', '第一', '先', '然后', '照着', '避'],
}
# 这种写法自己的"特征料"（叠在线之上）
KIND_FEATURE = {
    'scene': ['我', '早上', '桌子', '手上', '店里', '进来'],
    'history': ['年前', '古代', '老', '从前', '旧', '年代', '祖', '传', '明朝', '清朝', '民国', '早年'],
    'mirror': ['你', '年纪', '阶段', '每天', '要是'],
    'docform': ['判决', '简历', '任务', '说明书', '菜单', '账本', '病历', '条'],
    'hotFit': ['最近', '都在', '话题', '大家', '这种事'],
    'steps': ['步', '先', '再', '然后', '准备', '顺序'],
}


def parse_key(stem):
    """draft-tale-scene.md / draft-tale.md / draft-scene.md 都要能读"""
    rest = stem.split('-', 1)[1] if '-' in stem else stem
    parts = rest.split('-')
    line, kind = '', ''
    for p in parts:
        if p in KINDS:
            line, kind = KINDS[p][0], p
        elif p in LINES:
            line = p
    return line or rest, kind


def sections(md):
    body = ''
    m = re.search(r'^##\s*正文\s*$(.*?)(^##\s|\Z)', md, re.S | re.M)
    if m:
        body = m.group(1).strip()
    return body


def label(line, kind):
    return LINES.get(line, line) + ((' · ' + KINDS[kind][1]) if kind else '')


def main():
    files = sorted(OUT.glob('draft-*.md'))
    assert files, '没找到 draft-*.md，先跑 _type_matrix.py 再出稿'
    rows = []
    for f in files:
        line, kind = parse_key(f.stem)
        md = f.read_text(encoding='utf-8')
        body = sections(md)
        paras = [p.strip() for p in body.split('\n') if p.strip()]
        han = len(re.findall(r'[\u4e00-\u9fff]', body))
        idx = body.find(PRODUCT)
        pos = round(idx / max(1, len(body)) * 100) if idx >= 0 else -1
        pre = body[:idx] if idx >= 0 else body
        mech = {w: pre.count(w) for w in MECH}
        mech_n = sum(mech.values())
        bullets = len(re.findall(r'^\s*(\d+[、.．]|[一二三四五六七八九十][、.]|第[一二三四五六七八九十]步)', body, re.M))
        feats = list(FEATURE.get(line, [])) + list(KIND_FEATURE.get(kind, []))
        feat = [w for w in feats if w in body]
        rows.append({
            'line': line, 'kind': kind, 'name': label(line, kind),
            'han': han, 'paras': len(paras),
            'pos': pos, 'mech': mech_n, 'mechTop': sorted(mech.items(), key=lambda x: -x[1])[:4],
            'bullets': bullets, 'open': (paras[0][:38] + '…') if paras else '',
            'end': (paras[-1][-30:]) if paras else '',
            'feat': feat, 'featHit': len(feat),
        })

    lines = ['# 同题五条线 · 逐篇实测对照', '',
             '选题：我妈以为我在刷手机，其实我在店里捞客户 ／ 调子焊死＝故事线自述（配比 21/69/10）／ 字数长档',
             '', '| 线 × 写法 | 汉字 | 段 | 产品首现 | 机器词 | 分点 | 特征料命中 |', '|---|---|---|---|---|---|---|']
    for r in rows:
        lines.append('| %s | %d | %d | %s | %d | %d | %d/%d |' % (
            r['name'], r['han'], r['paras'],
            ('%d%%' % r['pos']) if r['pos'] >= 0 else '未出现',
            r['mech'], r['bullets'], r['featHit'], len(FEATURE.get(r['line'], [])) + len(KIND_FEATURE.get(r['kind'], []))))
    tot_mech = sum(r['mech'] for r in rows)
    lines += ['', '合计机器词：%d 处（八类型那轮见历史报告；口径未变，可直接对照）' % tot_mech, '', '## 逐篇', '']
    for r in rows:
        lines += ['### %s' % r['name'],
                  '- 开篇：%s' % r['open'],
                  '- 末句：…%s' % r['end'],
                  '- 机器词：%d 处 %s' % (r['mech'], '、'.join('%s×%d' % (k, v) for k, v in r['mechTop'] if v)),
                  '- 这一类的特征料命中：%s' % ('、'.join(r['feat']) if r['feat'] else '（一个没中）'),
                  '']
    OUT.joinpath('五条线对照.md').write_text('\n'.join(lines), encoding='utf-8')

    for r in rows:
        print('%-24s 汉字%4d 段%2d 产品首现%4s 机器词%2d 分点%d 特征%d  ｜ %s'
              % (r['name'], r['han'], r['paras'],
                 ('%d%%' % r['pos']) if r['pos'] >= 0 else '-', r['mech'], r['bullets'],
                 r['featHit'], r['open']))
    print('\n合计机器词 %d 处；已写盘：%s' % (tot_mech, OUT / '五条线对照.md'))


main()
