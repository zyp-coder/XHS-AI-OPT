# -*- coding: utf-8 -*-
"""二维码编码器自测（第二步）：把 JS 编出来的矩阵画成图，用 zxing 解回来比对。

要真机扫得通，就得让「另一个实现」认它——这里借 zxing-cpp 当裁判（和 gen_promo_qr.py 同一套依赖）。
用法：node scripts/dev/_gen_qr_samples.mjs 然后 python3 scripts/dev/_check_qr_roundtrip.py
"""
import json
import pathlib
import sys

import zxingcpp
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SAMPLES = ROOT / 'scripts' / 'dev' / '_qr_samples.json'
SCALE = 8        # 每个模块画 8 像素，够 zxing 看清
QUIET = 4        # 四周留 4 个模块的静区（规范要求）


def draw(rows: list) -> Image.Image:
    n = len(rows)
    side = (n + QUIET * 2) * SCALE
    img = Image.new('L', (side, side), 255)
    px = img.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '1':
                continue
            x0, y0 = (x + QUIET) * SCALE, (y + QUIET) * SCALE
            for dy in range(SCALE):
                for dx in range(SCALE):
                    px[x0 + dx, y0 + dy] = 0
    return img


def main() -> None:
    if not SAMPLES.exists():
        raise SystemExit('缺 %s：先跑 node scripts/dev/_gen_qr_samples.mjs' % SAMPLES.name)
    samples = json.loads(SAMPLES.read_text(encoding='utf-8'))
    out_dir = ROOT / 'scripts' / 'dev' / '_qr_out'
    out_dir.mkdir(exist_ok=True)

    fails = []
    for i, s in enumerate(samples):
        rows = s['rows']
        assert len(rows) == s['size'] and all(len(r) == s['size'] for r in rows), '矩阵不是正方形'
        img = draw(rows)
        img.save(out_dir / ('sample%d-v%d.png' % (i, s['version'])))
        found = zxingcpp.read_barcodes(img)
        if not found:
            fails.append((s, 'zxing 没解出来'))
            continue
        got = found[0].text
        if got != s['text']:
            fails.append((s, '解出来不一致：%r' % got[:60]))
            continue
        kind = '字节' if found[0].format else ''
        print('OK  v%-2d mask%d %dx%d 解得一致（%s）  %s' % (
            s['version'], s['mask'], s['size'], s['size'], kind,
            s['text'][:44] + ('…' if len(s['text']) > 44 else '')))

    if fails:
        for s, why in fails:
            print('FAIL v%s：%s' % (s['version'], why))
        print('\n%d/%d 条没通过；图在 scripts/dev/_qr_out/' % (len(fails), len(samples)))
        sys.exit(1)
    print('\n全部 %d 条经 zxing 解码一致（图在 scripts/dev/_qr_out/）' % len(samples))


if __name__ == '__main__':
    main()
