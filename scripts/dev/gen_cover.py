# -*- coding: utf-8 -*-
"""AI雕兄封面：HTML → JPG（Playwright headless Chromium 截图）。

用法：
  python3 scripts/dev/gen_cover.py            # 出 A/B/C 三版（默认 1080×1440，小红书 3:4）
  python3 scripts/dev/gen_cover.py -v a       # 只出 A 版
  python3 scripts/dev/gen_cover.py -W 1080 -H 1920   # 换尺寸（如 9:16）
"""
import argparse, asyncio
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAT = ROOT / '资料' / '视频' / 'AI雕兄口播稿'
HTML = MAT / 'AI雕兄-封面.html'
OUTDIR = MAT / '成片'
NAMES = {  # 文件名与 HTML 里的 data-v 一一对应
    'a': '封面-方案A-15天1000',
    'b': '封面-方案B-别学流量博主',
    'c': '封面-方案C-获客发愁',
    'd': '封面-定稿A+C',
    'e': '封面-9问快闪',
    'f': '封面-优势总结',
    'g': '封面-9问快闪-抖音',
    'h': '封面-优势总结-抖音',
}


MEASURE = """() => {
  const W = document.getElementById('stage').clientWidth;
  const PAD = 60;
  const rows = [];
  document.querySelectorAll('.title, .kicker, #nameplate').forEach(box => {
    if (getComputedStyle(box).display === 'none') return;
    box.querySelectorAll('*').forEach(el => {
      if (!el.textContent.trim()) return;
      const r = el.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(el).fontSize);
      const lh = parseFloat(getComputedStyle(el).lineHeight) || fs * 1.2;
      const lines = Math.round(r.height / lh);
      rows.push({
        sel: el.className, text: el.textContent.trim().slice(0, 20),
        w: Math.round(r.width), lines,
        over: (r.left < PAD - 1 || r.right > W - PAD + 1) ? '左右溢出' : (lines > 1 ? '折行' : ''),
      });
    });
  });
  return rows;
}"""


async def shoot(variant, w, h, out_path):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=['--force-device-scale-factor=1', '--hide-scrollbars'])
        page = await browser.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        await page.goto(HTML.as_uri() + f'?v={variant}&w={w}&h={h}')
        await page.wait_for_function('document.fonts.status === "loaded"')
        await page.wait_for_timeout(350)
        rows = await page.evaluate(MEASURE)
        for r in rows:
            flag = f'  ← {r["over"]}！' if r['over'] else ''
            print(f'    {r["text"]:<22} {r["w"]:>4}px × {r["lines"]} 行{flag}')
        await page.screenshot(path=str(out_path), type='jpeg', quality=95)
        await browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-v', '--variant', default='all', help='a / b / c / d / all')
    ap.add_argument('-W', '--width', type=int, default=1080)
    ap.add_argument('-H', '--height', type=int, default=1440)
    ap.add_argument('-s', '--suffix', default='', help='文件名后缀（如 -9x16，避免覆盖同名的 3:4 图）')
    a = ap.parse_args()
    variants = ['a', 'b', 'c', 'd'] if a.variant == 'all' else list(a.variant)

    async def run():
        for v in variants:
            out = OUTDIR / f'{NAMES[v]}{a.suffix}.jpg'
            await shoot(v, a.width, a.height, out)
            print(f'{out}  ({out.stat().st_size / 1024:.0f} KB)')

    OUTDIR.mkdir(exist_ok=True)
    asyncio.run(run())


if __name__ == '__main__':
    main()
