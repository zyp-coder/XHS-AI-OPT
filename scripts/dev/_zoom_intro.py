# -*- coding: utf-8 -*-
"""临时：300dpi 放大截 开头介绍块 / 三档卡片，肉眼核对；改完删除。"""
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = (ROOT / '资料' / '推广物料' / 'A4传单.html').as_uri()
TMP = ROOT / 'logs' / '_zoom'
TMP.mkdir(parents=True, exist_ok=True)


def main() -> None:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for tag, cls, sel in (('黑白', None, '.intro'), ('彩色', 'color', '.intro'),
                              ('黑白', None, '.tiers'), ('彩色', 'color', '.tiers')):
            p = b.new_page(viewport={'width': 900, 'height': 1300}, device_scale_factor=300 / 96)
            p.goto(URL)
            if cls:
                p.evaluate('(c) => document.body.classList.add(c)', cls)
            p.emulate_media(media='print')
            p.wait_for_timeout(400)
            el = p.locator(sel).first
            out = TMP / ('%s-%s.png' % (tag, sel.strip('.')))
            el.screenshot(path=str(out))
            print('wrote', out)
            p.close()
        b.close()


if __name__ == '__main__':
    main()
