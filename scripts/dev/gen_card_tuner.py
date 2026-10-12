# -*- coding: utf-8 -*-
"""生成名片白底版的「调色台」：把 名片.html 的样式与两面 markup 原样内联，外套一层旋钮面板
（拨了实时看效果、一键出配置行）。改颜色只动 KNOBS / PRESETS 这张字段字典。

用法：python3 scripts/dev/gen_card_tuner.py  →  资料/推广物料/名片调色台.html
定稿：把老板发回的那行配置写进 名片.html 白底版 body.bw 的变量默认值，再重跑 render_promo.py。
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / '资料' / '推广物料' / '名片.html'
OUT = ROOT / '资料' / '推广物料' / '名片调色台.html'

# 旋钮字段字典：(中文名, 键, [(选项中文名, CSS 变量, 色块/None)])
KNOBS = [
    ('底色', 'bg', [
        ('纯白', {'--w-bg': '#fff'}, '#fff'),
        ('米白', {'--w-bg': '#fbf8f0'}, '#fbf8f0'),
        ('白·淡金晕', {'--w-bg': 'radial-gradient(60mm 44mm at 100% -8%,rgba(192,138,30,.10),transparent 62%),#fff'}, '#fdf3dd'),
        ('浅暖灰', {'--w-bg': '#f4f3ef'}, '#f4f3ef'),
    ]),
    ('金色点缀', 'gold', [
        ('不要金（全黑）', {'--w-brand': '#111', '--w-title': '#000', '--w-num': '#000'}, '#111'),
        ('少：圆点+线', {'--w-brand': '#c08a1e', '--w-title': '#000', '--w-num': '#000'}, '#c08a1e'),
        ('中：+定位句', {'--w-brand': '#c08a1e', '--w-title': '#a8791c', '--w-num': '#000'}, '#a8791c'),
        ('足：+号码', {'--w-brand': '#c08a1e', '--w-title': '#a8791c', '--w-num': '#a8791c'}, '#8a6510'),
    ]),
    ('二维码外框', 'qr', [
        ('细金框', {'--w-qr': '#c08a1e'}, '#c08a1e'),
        ('细黑框', {'--w-qr': '#111'}, '#111'),
        ('浅灰框', {'--w-qr': '#d5d8dd'}, '#d5d8dd'),
        ('不要框', {'--w-qr': 'transparent'}, 'transparent'),
    ]),
    ('底纹', 'tex', [
        ('纯平', {'--w-tex-d': 'none', '--w-tex': 'none', '--w-tex-size': 'auto'}, None),
        ('淡网格', {'--w-tex-d': 'block',
                 '--w-tex': 'linear-gradient(rgba(0,0,0,.035) 1px,transparent 1px),'
                            'linear-gradient(90deg,rgba(0,0,0,.035) 1px,transparent 1px)',
                 '--w-tex-size': '6mm 6mm'}, None),
        ('淡点星', {'--w-tex-d': 'block',
                 '--w-tex': 'radial-gradient(rgba(0,0,0,.10) .3mm,transparent .3mm),'
                            'radial-gradient(rgba(0,0,0,.07) .26mm,transparent .26mm)',
                 '--w-tex-size': '11mm 9mm,13mm 12mm'}, None),
    ]),
]

# 预设＝起点不是答案：一键套用后还能接着拨；
# 第一条必须和 名片.html 里 body.bw 的变量默认值一致（那是成品现状）
PRESETS = [
    ('白底·金线（推荐＝成品现状）', {'bg': '纯白', 'gold': '中：+定位句', 'qr': '细金框', 'tex': '纯平'}),
    ('米白·暖调', {'bg': '米白', 'gold': '足：+号码', 'qr': '细金框', 'tex': '淡点星'}),
    ('金晕·足金', {'bg': '白·淡金晕', 'gold': '足：+号码', 'qr': '细金框', 'tex': '纯平'}),
    ('极简黑白（切白底那版）', {'bg': '纯白', 'gold': '不要金（全黑）', 'qr': '细黑框', 'tex': '纯平'}),
]

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>名片 · 白底配色台</title>
<style>
__CARD_STYLE__
</style>
<style>
  html,body{background:#e9ebef;}
  body{color:#1a1d23;}
  .wrap{display:flex;gap:26px;padding:22px;align-items:flex-start;box-sizing:border-box;}
  .panel{flex:none;width:306px;position:sticky;top:22px;background:#fff;border-radius:12px;
         padding:16px 18px 18px;box-shadow:0 4px 18px rgba(20,26,44,.10);}
  .panel h1{font-size:15px;font-weight:800;margin:0 0 4px;letter-spacing:.2px;}
  .panel .sub{font-size:11.5px;color:#6d737e;line-height:1.6;margin-bottom:12px;}
  .knob{margin:12px 0 0;}
  .knob .kl{font-size:12px;font-weight:700;color:#39404b;margin-bottom:6px;}
  .opts{display:flex;flex-wrap:wrap;gap:6px;}
  .opts button{font:inherit;font-size:12px;line-height:1;padding:6px 9px;border:1px solid #d8dbe0;
               background:#fff;border-radius:7px;cursor:pointer;color:#2a303a;display:flex;align-items:center;}
  .opts button:hover{border-color:#b9bec6;}
  .opts button.on{border-color:#c08a1e;background:#fdf6e6;color:#8a5f0a;font-weight:800;}
  .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;
      border:1px solid rgba(0,0,0,.16);}
  .presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;}
  .presets button{font:inherit;font-size:12px;padding:6px 10px;border:1px solid #d8dbe0;background:#f7f8fa;
                  border-radius:7px;cursor:pointer;}
  .presets button:hover{border-color:#b9bec6;background:#fff;}
  .hr{height:1px;background:#eceef1;margin:14px 0 0;}
  #cfg{width:100%;box-sizing:border-box;margin-top:7px;font:12px/1.6 Consolas,"Courier New",monospace;
       padding:8px;border:1px solid #d8dbe0;border-radius:7px;background:#fafbfc;color:#222;resize:vertical;}
  .copy{width:100%;margin-top:8px;font:inherit;font-size:13px;font-weight:800;padding:9px;border:0;
        border-radius:8px;background:#1f2430;color:#fff;cursor:pointer;}
  .copy:hover{background:#2b3140;}
  .tip{font-size:11px;color:#7a808b;line-height:1.6;margin-top:9px;}
  .stage{flex:1;display:flex;flex-direction:column;gap:26px;min-width:0;}
  .shot{display:flex;flex-direction:column;gap:8px;}
  .shot .cap{font-size:12px;color:#5c626d;font-weight:700;letter-spacing:.3px;}
  .cwshell{width:calc(90mm * 1.5);height:calc(54mm * 1.5);}
  .cw{transform:scale(1.5);transform-origin:top left;}
  .cw .card{box-shadow:0 3px 14px rgba(20,25,40,.16);}
</style>
</head>
<body class="bw">
<div class="wrap">
  <aside class="panel">
    <h1>名片 · 白底配色台</h1>
    <div class="sub">只调颜色，文案与版面一个字不动。拨到顺眼为止，点最下面「复制配置」，把那行发我就固化成成品（PDF / 预览图重出）。</div>
    <div class="knob"><div class="kl">一键起点</div><div class="presets" id="presets"></div></div>
    <div class="hr"></div>
    <div id="knobs"></div>
    <div class="hr"></div>
    <label class="kl" style="display:block;margin-top:12px;">配置行（发我这行就行）</label>
    <textarea id="cfg" rows="3" readonly></textarea>
    <button class="copy" id="copyBtn">复制配置</button>
    <div class="tip">二维码本身没动，四种外框都照扫；深色版不受这里影响。</div>
  </aside>
  <main class="stage">
    <div class="shot"><div class="cap">正面</div><div class="cwshell"><div class="cw">__CARD_F__</div></div></div>
    <div class="shot"><div class="cap">背面</div><div class="cwshell"><div class="cw">__CARD_B__</div></div></div>
  </main>
</div>
<script>
const KNOBS = __KNOBS__;
const PRESETS = __PRESETS__;
const picked = {};

function apply() {
  const opt = {};
  KNOBS.forEach(k => {
    const name = picked[k.key];
    const o = k.opts.find(x => x.name === name);
    if (o) Object.assign(opt, o.vars);
  });
  Object.keys(opt).forEach(v => document.body.style.setProperty(v, opt[v]));
  const line = '名片白底配色：' + KNOBS.map(k => k.label + '=' + picked[k.key]).join(' ｜ ');
  document.getElementById('cfg').value = line;
}

function paint() {
  document.querySelectorAll('#knobs .opts button').forEach(b => {
    b.classList.toggle('on', picked[b.dataset.key] === b.dataset.name);
  });
  apply();
}

function build() {
  const box = document.getElementById('knobs');
  KNOBS.forEach(k => {
    const wrap = document.createElement('div');
    wrap.className = 'knob';
    const t = document.createElement('div');
    t.className = 'kl';
    t.textContent = k.label;
    wrap.appendChild(t);
    const opts = document.createElement('div');
    opts.className = 'opts';
    k.opts.forEach(o => {
      const b = document.createElement('button');
      b.dataset.key = k.key;
      b.dataset.name = o.name;
      if (o.swatch) {
        const s = document.createElement('span');
        s.className = 'sw';
        s.style.background = o.swatch;
        b.appendChild(s);
      }
      b.appendChild(document.createTextNode(o.name));
      b.onclick = () => { picked[k.key] = o.name; paint(); };
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    box.appendChild(wrap);
  });

  const pbox = document.getElementById('presets');
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => { Object.assign(picked, p.pick); paint(); };
    pbox.appendChild(b);
  });

  document.getElementById('copyBtn').onclick = () => {
    const el = document.getElementById('cfg');
    el.removeAttribute('readonly');
    el.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    el.setAttribute('readonly', 'readonly');
    if (!ok && navigator.clipboard) { navigator.clipboard.writeText(el.value); ok = true; }
    const btn = document.getElementById('copyBtn');
    btn.textContent = ok ? '已复制 ✓' : '复制失败，手动选中上面那行';
    setTimeout(() => { btn.textContent = '复制配置'; }, 1600);
  };
}

Object.assign(picked, PRESETS[0].pick);
build();
paint();
</script>
</body>
</html>
"""


def main() -> None:
    html = SRC.read_text(encoding='utf-8')
    style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
    cards = re.findall(r'<section class="card">.*?</section>', html, re.S)
    if len(cards) != 2:
        raise SystemExit('名片.html 里应当正好两面卡片，实际 %d' % len(cards))

    knobs = [{'key': k, 'label': lb,
              'opts': [{'name': n, 'vars': v} for n, v, _ in opts]}
             for lb, k, opts in KNOBS]
    presets = [{'name': n, 'pick': p} for n, p in PRESETS]

    page = (PAGE
            .replace('__CARD_STYLE__', style)
            .replace('__CARD_F__', cards[0])
            .replace('__CARD_B__', cards[1])
            .replace('__KNOBS__', json.dumps(knobs, ensure_ascii=False))
            .replace('__PRESETS__', json.dumps(presets, ensure_ascii=False)))
    OUT.write_text(page, encoding='utf-8')
    print('已生成 %s' % OUT)


if __name__ == '__main__':
    main()
