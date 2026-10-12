# -*- coding: utf-8 -*-
"""临时量版面：打印每页 over（>0 溢出）+ 开头截图块的几何，改完删除。"""
import json
import pathlib

from playwright.sync_api import sync_playwright

MM = 25.4 / 96
ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = (ROOT / '资料' / '推广物料' / 'A4传单.html').as_uri()

JS = r"""
() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return {t: b.top, b: b.bottom, h: b.height, w: b.width, l: b.left, r: b.right}; };
  const lines = (e) => { const s = getComputedStyle(e);
    return Math.round(e.getBoundingClientRect().height / parseFloat(s.lineHeight) * 10) / 10; };
  return [...document.querySelectorAll('.page')].map((pg, i) => {
    const last = pg.querySelector('.qa-list .qa:last-child') || pg.querySelector('.qrbox');
    const tail = pg.querySelector('.lead') || pg.querySelector('.qrbox');
    const shot = pg.querySelector('.shotcol');
    const img = pg.querySelector('.shotcol img');
    const pEl = pg.querySelector('.intro p:not(.hi)');
    const out = {
      page: i + 1,
      over: pg.scrollHeight - pg.clientHeight,
      pageH: r(pg).h,
      intro: r(pg.querySelector('.intro')),
      trans: r(pg.querySelector('.trans')),
      qaList: r(pg.querySelector('.qa-list')),
      lastQa: r(last),
      tail: r(tail),
      slack: tail && last ? (r(tail).t - r(last).b) * %(MM)s : null,
      shot: r(shot), img: r(img),
      txtW: r(pg.querySelector('.intro')) ? r(pg.querySelector('.intro')).w : null,
      heroH: r(pg.querySelector('.hero')) ? r(pg.querySelector('.hero')).h : null,
      pLines: pEl ? lines(pEl) : null,
      pH: pEl ? r(pEl).h : null,
    };
    const tier = pg.querySelector('.tier');
    if (tier) out.tierH = r(tier).h;
    const tooLong = [...pg.querySelectorAll('.tier li')].map(li => lines(li));
    if (tooLong.length) out.liLines = tooLong;
    return out;
  });
}
""" % {'MM': MM}


def main() -> None:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for tag, cls in (('黑白', None), ('彩色', 'color')):
            p = b.new_page(viewport={'width': 900, 'height': 1300})
            p.goto(URL)
            if cls:
                p.evaluate('(c) => document.body.classList.add(c)', cls)
            p.emulate_media(media='print')
            p.wait_for_timeout(350)
            data = p.evaluate(JS)
            print('==== %s ====' % tag)
            for d in data:
                print(json.dumps(d, ensure_ascii=False))
            p.close()
        b.close()


if __name__ == '__main__':
    main()
