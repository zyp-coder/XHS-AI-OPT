# -*- coding: utf-8 -*-
"""临时：扫描「开头段宽度 -> 行数」，找不改行数的最小文本宽度；改完删除。"""
import pathlib

from playwright.sync_api import sync_playwright

MM = 25.4 / 96
ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = (ROOT / '资料' / '推广物料' / 'A4传单.html').as_uri()

JS = r"""
(payload) => {
  const {pl, gap, shotW} = payload;
  const st = document.getElementById('__sweep') || (() => {
    const s = document.createElement('style'); s.id = '__sweep'; document.head.appendChild(s); return s;
  })();
  st.textContent = `.intro{padding-left:${pl}mm;}`
    + `.intro .row{gap:${gap}mm;}`
    + `.shotcol{width:${shotW}mm;}`;
  const txt = document.querySelector('.intro .txt');
  const p = document.querySelector('.intro .txt p:not(.hi)');
  const cs = getComputedStyle(p);
  const rowH = document.querySelector('.intro .row').getBoundingClientRect().height;
  const shotH = document.querySelector('.shotcol').getBoundingClientRect().height;
  return {txtW: txt.getBoundingClientRect().width / %(MM)s,
          lines: Math.round(p.getBoundingClientRect().height / parseFloat(cs.lineHeight) * 10) / 10,
          pH: p.getBoundingClientRect().height / %(MM)s,
          rowH: rowH / %(MM)s, shotH: shotH / %(MM)s};
}
""" % {'MM': MM}


def main() -> None:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 900, 'height': 1300})
        p.goto(URL)
        p.emulate_media(media='print')
        p.wait_for_timeout(300)
        print('pl    gap  shotW  -> txtW    lines  pH      rowH    shotH')
        for pl in (4.5, 5.5):
            for gap in (3.5, 4.0):
                for shotW in (32, 34, 35, 36, 37, 38, 39, 40):
                    r = p.evaluate(JS, {'pl': pl, 'gap': gap, 'shotW': shotW})
                    print('%-5s %-4s %-6s -> %-7.2f %-6s %-7.2f %-7.2f %-7.2f'
                          % (pl, gap, shotW, r['txtW'], r['lines'], r['pH'], r['rowH'], r['shotH']))
        b.close()


if __name__ == '__main__':
    main()
