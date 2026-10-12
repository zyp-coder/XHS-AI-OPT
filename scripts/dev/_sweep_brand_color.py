"""把「品牌红」字面量换成主题变量（一次性脚本，改完就删）
口径：
  · 只换品牌色一族的字面量，危险红（#d92d20/#dc2626/#c62828/#ef4444…）与琥珀色一律不动
  · 深色浮层上的红（账号锁定遮罩的按钮 #ff274b、暗色 FS 弹窗的 #ffb3c1）不动——那里换成石墨黑会看不见
  · 渐变整段换（半截换会生成非法 CSS）
"""
import io, re, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

GRADS = [
    ('var(--xhs-red,#ff2442)', 'var(--c-brand)'),
    ('linear-gradient(90deg,#ff2442,#ff6675)', 'var(--grad-brand)'),
    ('linear-gradient(135deg,#ff2442,#ff6675)', 'var(--grad-brand)'),
    ('linear-gradient(135deg,#ff2442,#ff6373)', 'var(--grad-brand)'),
    ('linear-gradient(90deg, var(--xhs-red), #ff6b6b)', 'var(--grad-brand)'),
    ('linear-gradient(180deg, var(--xhs-red), #ff6b6b)', 'var(--grad-brand)'),
    ('linear-gradient(180deg,#ffffff,#fff7fa)', 'linear-gradient(180deg,var(--c-surface),var(--c-brand-soft))'),
    ('linear-gradient(90deg,#fff0f3,#ffe3e8)', 'linear-gradient(90deg,var(--c-brand-soft),var(--c-brand-soft2))'),
]

ALPHA = [
    ('rgba(255, 36, 66, .08)', 'var(--c-brand-a08)'),
    ('rgba(255,36,66,.08)', 'var(--c-brand-a08)'),
    ('rgba(255, 36, 66, .07)', 'var(--c-brand-a08)'),
    ('rgba(255,36,66,0.12)', 'var(--c-brand-a15)'),
    ('rgba(255,36,66,0.08)', 'var(--c-brand-a08)'),
    ('rgba(255, 36, 66, .13)', 'var(--c-brand-a15)'),
    ('rgba(255,36,66,.15)', 'var(--c-brand-a15)'),
    ('rgba(255, 36, 66, .15)', 'var(--c-brand-a15)'),
    ('rgba(255,36,66,.35)', 'var(--c-brand-a40)'),
    ('rgba(255,36,66,.4)', 'var(--c-brand-a40)'),
]

HEX = {
    '#ff2442': 'var(--c-brand)',
    '#ff6373': 'var(--c-brand-hi)',
    '#ff6675': 'var(--c-brand-hi)',
    '#ff3b57': 'var(--c-brand-hi)',
    '#d81b36': 'var(--c-brand-ink)',
    '#c41d3c': 'var(--c-brand-ink)',
    '#c62a42': 'var(--c-brand-ink)',
    '#d64052': 'var(--c-brand-ink)',
    '#8a3a4e': 'var(--c-brand-ink)',
    '#c66a7f': 'var(--c-ink-3)',
    '#ffbcc6': 'var(--c-brand-line)',
    '#ffd7dd': 'var(--c-brand-line)',
    '#f3d9de': 'var(--c-brand-line)',
    '#f6c9d3': 'var(--c-brand-line)',
    '#ffd6de': 'var(--c-brand-line)',
    '#f3c8ce': 'var(--c-brand-line)',
    '#f6e3e7': 'var(--c-brand-line)',
    '#ffe4e9': 'var(--c-brand-soft2)',
    '#ffe9ec': 'var(--c-brand-soft2)',
    '#fff1f3': 'var(--c-brand-soft)',
    '#fff5f5': 'var(--c-brand-soft)',
    '#fff5f6': 'var(--c-brand-soft)',
    '#fff5f7': 'var(--c-brand-soft)',
    '#fff7f8': 'var(--c-brand-soft)',
    '#fff7fa': 'var(--c-brand-soft)',
    '#fff8fa': 'var(--c-brand-soft)',
    '#fffafb': 'var(--c-brand-soft)',
    '#fffdfd': 'var(--c-surface)',
}

FILES = ['extension/popup.html', 'extension/popup.js', 'extension/settings.css', 'extension/settings.js',
         'extension/ui.css', 'extension/lib/video/video.css']

total = 0
for f in FILES:
    try:
        src = io.open(f, encoding='utf-8').read()
    except OSError:
        print('! 缺文件', f); continue
    out = src
    hits = []
    for a, b in GRADS + ALPHA:
        n = out.count(a)
        if n:
            out = out.replace(a, b)
            hits.append('%s×%d' % (a, n))
    # hex 大小写不敏感：先把大写形态也吃掉
    for k, v in HEX.items():
        n = 0
        for variant in (k, k.upper()):
            c = out.count(variant)
            if c:
                out = out.replace(variant, v)
                n += c
        if n:
            hits.append('%s×%d' % (k, n))
    if out != src:
        io.open(f, 'w', encoding='utf-8', newline='').write(out)
        total += len(hits)
        print('== %s\n   %s' % (f, '  '.join(hits)))
print('\n共 %d 组替换' % total)

# 复查：还剩哪些「红族」字面量（排除已知要保留的深色浮层与危险色）
print('\n── 残留复查（品牌红族）──')
pat = re.compile(r'#(ff2442|ff2[0-9a-f]{3}|ff6[0-9a-f]{3}|ffb[0-9a-f]{3}|ffc[0-9a-f]{3}|ffd[0-9a-f]{3}|ffe[0-9a-f]{3}|fff[0-9a-f]{3})|rgba\(255,\s*36,\s*66', re.I)
for f in FILES:
    try:
        for i, line in enumerate(io.open(f, encoding='utf-8').read().split('\n'), 1):
            for m in pat.finditer(line):
                print('  %s:%d  %s' % (f, i, line.strip()[:150]))
                break
    except OSError:
        pass
