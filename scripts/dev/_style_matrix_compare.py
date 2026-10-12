"""两个选题 × 同八条调子：量一量"展开段被产品吞掉多少"。

跑法：python3 scripts/dev/_style_matrix_compare.py
产物：tmp/style-matrix-b/选题对照.md

两个变量各跑一遍（都＝同八条调子、同卖点/人群/人设、字数＝长、卖货话术＝轻带一句）：
  A 我妈以为我在刷手机，其实我在店里捞客户（标题里就写着产品）→ tmp/style-matrix-a2
  B 劝一个人看店的老板：先别急着发笔记（自带论证空间）      → tmp/style-matrix-b

量什么：
  · 产品名首次出现在正文的百分之几处（越靠后＝铺垫/展开自己撑得住）
  · **产品名出现之前**那段正文里的"机器词"命中数（清单 / 待触达 / 上限 / 队列 / 本机 / 浏览器扩展 …）
    —— 机器词是产品说明书的词，真人写笔记不会这么说；它在铺垫与展开里出现几次，
       就等于那块地方被产品解说吞掉了几次
"""
import json
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
A = ROOT / 'tmp' / 'style-matrix-a2'
B = ROOT / 'tmp' / 'style-matrix-b'
PROD = '小红书AI引流工具'

# 机器词＝产品说明书里的词（真人写笔记不会这么说话）
MECH = ['清单', '待触达', '已触达', '上限', '冷却', '队列', '排好队', '扫描', '收录',
        '素材库', '话术库', '本机', '浏览器扩展', '关键词', '自己跑', '自动']


def load(d):
    prompts = json.loads((d / 'prompts.json').read_text(encoding='utf-8'))
    out = []
    for i, p in enumerate(prompts, 1):
        f = d / ('%d-%s.draft.json' % (i, p['route']))
        if not f.exists():
            out.append({'route': p['route'], 'missing': True, 'style': p['style']})
            continue
        draft = json.loads(f.read_text(encoding='utf-8'))
        body = str(draft.get('content') or '')
        plain = body.replace('\n', '')
        pos = plain.find(PROD)
        before = plain if pos < 0 else plain[:pos]
        # 一个词命中几次就算几次（"清单"在一段里出现三回＝那段说了三次清单）
        hits = {w: before.count(w) for w in MECH if w in before}
        out.append({
            'route': p['route'], 'style': p['style'].replace('★ 这篇的调子＝', '').split('：')[0],
            'len': len(plain), 'paras': len([x for x in body.split('\n') if x.strip()]),
            'prod_at': (round(pos / len(plain) * 100) if pos >= 0 and plain else None),
            'mech': sum(hits.values()), 'hits': hits, 'before': before,
            'first': [x.strip() for x in body.split('\n') if x.strip()][:2],
        })
    return out


def main():
    a, b = load(A), load(B)
    md = ['# 换一个选题，八条调子重跑：A（标题里就写着产品） vs B（自带论证空间）', '',
          '同八条调子 / 同卖点 / 同人群 / 同人设 / 字数都点「长」/ 卖货话术都＝轻带一句。唯一变量＝选题。', '',
          '**机器词**＝清单 / 待触达 / 上限 / 冷却 / 队列 / 排好队 / 扫描 / 收录 / 素材库 / 话术库 / 本机 / 浏览器扩展 / 关键词 / 自己跑 / 自动。',
          '它出现在**产品名之前**的正文里几次，就等于铺垫与展开被产品解说吞掉几次。', '',
          '| 调子 | A 字数 | A 机器词 | A 产品首现 | B 字数 | B 机器词 | B 产品首现 |',
          '|---|---|---|---|---|---|---|']
    for x, y in zip(a, b):
        if x.get('missing') or y.get('missing'):
            md.append('| %s | — | — | — | — | — | — |' % (x.get('style') or x['route']))
            continue
        md.append('| %s | %d | **%d** | %s | %d | **%d** | %s |' % (
            x['style'], x['len'], x['mech'],
            ('%d%%' % x['prod_at']) if x['prod_at'] is not None else '未提',
            y['len'], y['mech'],
            ('%d%%' % y['prod_at']) if y['prod_at'] is not None else '未提'))
    sa, sb = sum(x['mech'] for x in a if not x.get('missing')), sum(y['mech'] for y in b if not y.get('missing'))
    md += ['', '合计机器词：A **%d** 处 → B **%d** 处' % (sa, sb), '']
    ms = ['# B 选题 · 八篇怎么开的头', '']
    for y in b:
        if y.get('missing'):
            continue
        ms += ['## %s' % y['style'], '']
        ms += ['> ' + p for p in y['first']]
        ms += ['', '（产品名首现在 %s 处；产品名之前出现机器词 %d 处）' % (
            ('%d%%' % y['prod_at']) if y['prod_at'] is not None else '未出现', y['mech']), '']
    (B / '选题对照.md').write_text('\n'.join(md + ms), encoding='utf-8')

    print('%-14s %-26s %s' % ('调子', 'A（我妈以为我在刷手机）', 'B（先别急着发笔记）'))
    for x, y in zip(a, b):
        if x.get('missing') or y.get('missing'):
            print('%-14s 缺稿：%s' % (x['route'], 'A ' if x.get('missing') else '' + 'B' if y.get('missing') else ''))
            continue
        print('%-14s 机器词 %-3d 产品首现 %-5s   机器词 %-3d 产品首现 %-5s' % (
            x['style'], x['mech'], ('%d%%' % x['prod_at']) if x['prod_at'] is not None else '—',
            y['mech'], ('%d%%' % y['prod_at']) if y['prod_at'] is not None else '—'))
    print('\n合计机器词：A %d → B %d' % (sa, sb))
    print('已写盘：', B / '选题对照.md')


if __name__ == '__main__':
    main()
