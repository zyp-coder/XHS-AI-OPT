"""八条叙事风格对照：把 _style_matrix.py 抓到的提示词与 8 份成稿合成一份对照 + 逐条自检。

跑法：python3 scripts/dev/_style_matrix_report.py
产物：tmp/style-matrix/八调子对照.md

自检三类（都按提示词里那条调子自己的要求来判，不是通用好文标准）：
  1) 配比：产品名第一次出现在正文的百分之几处 ≈ 这条调子的「产品 ≈ N%」
  2) 戒条：这条调子禁止的东西有没有出现（每条调子各有一套关键词）
  3) 红线：禁用词（防封/反爬/养号/规避）、站外导流、绝对化用词
"""
import json
import os
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
D = ROOT / (os.environ.get('SM_OUT') or 'tmp/style-matrix')
PROD = '小红书AI引流工具'

# 每条调子的戒条关键词（出现＝违反这条调子的戒条）
TABOO = {
    'literary': ['推荐', '入手', '超值', '别错过', '赶紧', '一定要买', '下单'],
    'story': ['第一点', '第二点', '首先', '其次', '总结一下', '建议大家'],
    'absurd': ['开玩笑', '哈哈', '逗你的', '别当真', '笑死'],
    'punchy': ['我记得那时候', '三年前', '那天下午', '心情', '感慨'],
    'sharp': ['看情况', '各有各的好', '因人而异', '不好说'],
    'slice': ['愿你', '共勉', '共情', '愿你我都', '记录下来就是意义'],
    'science': ['震惊', '必看', '神仙', '闭眼入', '天花板', '绝对'],
    'qna': ['建议大家', '一般来说', '视情况而定'],
}
RED = ['防封', '反爬', '养号', '规避']
OUTSIDE = ['微信', 'VX', 'vx', 'QQ', 'qq', '公众号', '链接', '二维码', '私域']
ABSOLUTE = ['最好', '第一', '永久', '保证', '100%', '绝对不']


def main():
    prompts = json.loads((D / 'prompts.json').read_text(encoding='utf-8'))
    rows, problems = [], []
    for i, p in enumerate(prompts, 1):
        f = D / ('%d-%s.draft.json' % (i, p['route']))
        d = json.loads(f.read_text(encoding='utf-8'))
        body = str(d.get('content') or '')
        plain = body.replace('\n', '')
        pos = plain.find(PROD)
        lead = round(pos / len(plain) * 100) if pos >= 0 and plain else None
        target = int(p['shape'].split('产品 ≈ ')[1].split('%')[0])
        hits = [w for w in TABOO[p['route']] if w in plain]
        red = [w for w in RED if w in plain]
        out = [w for w in OUTSIDE if w in plain]
        abso = [w for w in ABSOLUTE if w in plain]
        if hits:
            problems.append('%s 违反戒条：%s' % (p['route'], '、'.join(hits)))
        if red:
            problems.append('%s 踩红线：%s' % (p['route'], '、'.join(red)))
        if out:
            problems.append('%s 出现站外导流：%s' % (p['route'], '、'.join(out)))
        rows.append({'i': i, 'route': p['route'], 'style': p['style'], 'shape': p['shape'],
                     'taboo': p['taboo'], 'words': p['words'], 'titles': d.get('titles') or [],
                     'body': body, 'tags': d.get('tags') or [], 'timeTip': d.get('timeTip') or '',
                     'len': len(plain), 'paras': len([x for x in body.split('\n') if x.strip()]),
                     'prod_at': lead, 'target': target, 'hits': hits, 'abso': abso, 'pos': pos})

    md = ['# 八条叙事风格 · 同一选题对照（字数＝长 · 卖货话术＝轻带一句）', '',
          '选题：**我妈以为我在刷手机，其实我在店里捞客户**　｜　产品：小红书AI引流工具　｜　人群：一个人看店的小老板', '']
    md += ['| # | 调子 | 配比（这条调子自己的魂） | 正文字数 | 段数 | 产品首次出现在 |',
           '|---|---|---|---|---|---|']
    for r in rows:
        # 产品段只占收尾 N% ⇒ 首次出现该落在全文 (100−N)% 处附近
        want = 100 - r['target']
        at = ('%.0f%% 处（该 ~%d%%）' % (r['prod_at'], want)) if r['prod_at'] is not None else '— 全篇没提产品'
        if r['prod_at'] is not None and r['prod_at'] < want - 15:
            problems.append('%s 产品出现得太早：%d%% 处（该 %d%% 左右）——铺垫没铺够' % (r['route'], r['prod_at'], want))
        md.append('| %d | %s | %s | %d 字 | %d | %s |' % (
            r['i'], r['style'].split('：')[0].replace('★ 这篇的调子＝', ''), r['shape'].split('）：')[-1][:44],
            r['len'], r['paras'], at))
    md += ['']
    for r in rows:
        md += ['---', '', '## %d. %s' % (r['i'], r['style'].replace('★ 这篇的调子＝', '')), '',
               '**配比**：%s' % r['shape'].split('）：')[-1], '',
               '**戒条**：%s' % r['taboo'].split('）：')[-1], '',
               '**字数档**：%s' % r['words'].replace('· 字数：', ''), '']
        for t in r['titles']:
            md.append('- 标题：%s' % t)
        md += ['', r['body'], '',
               '标签：%s　｜　建议时段：%s' % ('、'.join(r['tags']), r['timeTip']),
               '', '> 正文字数 %d（不含换行）／ %d 段；产品名首次出现在第 %s 处（这条调子的目标是产品段只占收尾 ≈ %d%%）'
               % (r['len'], r['paras'],
                  ('%.0f%%' % r['prod_at']) if r['prod_at'] is not None else '全篇未出现', r['target']), '']
    (D / '八调子对照.md').write_text('\n'.join(md), encoding='utf-8')

    print('正文字数：', ', '.join('%s=%d' % (r['route'], r['len']) for r in rows))
    print('产品首次出现：', ', '.join('%s=%s%%(目标%d%%)' % (r['route'], r['prod_at'], r['target']) for r in rows))
    if problems:
        print('\n⚠ 有问题：')
        for p in problems:
            print('  -', p)
    else:
        print('\nPASS: 8 条都没踩自己调子的戒条，也没有红线词 / 站外导流')
    print('\n已写盘：', D / '八调子对照.md')


if __name__ == '__main__':
    main()
