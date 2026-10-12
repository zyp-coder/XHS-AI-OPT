# -*- coding: utf-8 -*-
"""临时：扫右列截图宽度，打印介绍段每行的实际文字，挑断行最顺的宽度；改完删除。"""
import pathlib

from playwright.sync_api import sync_playwright

NODES = r"""
() => {
  const wraps = [];
  const p = document.querySelector('.intro p:not(.hi)');
  const st = document.getElementById('__sw') || (() => {
    const s = document.createElement('style'); s.id = '__sw'; document.head.appendChild(s); return s;
  })();
  st.textContent = `.hero{grid-template-columns:1fr ${window.__w}mm;}`;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const t = [];
  while (walker.nextNode()) t.push(walker.currentNode);
  const rng = document.createRange();
  let lines = [], curTop = null, cur = '';
  for (const node of t) {
    for (let i = 0; i < node.data.length; i++) {
      rng.setStart(node, i); rng.setEnd(node, i + 1);
      const rect = rng.getBoundingClientRect();
      const top = rect.top;
      if (curTop === null || Math.abs(top - curTop) > 2) { 
        if (cur !== '') lines.push(cur);
        cur = node.data[i]; curTop = top;
      } else { cur += node.data[i]; }
    }
  }
  if (cur !== '') lines.push(cur);
  const els = document.querySelectorAll('.intro p, .intro p *');
  return lines;
}
"""


def main() -> None:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 900, 'height': 1300})
        p.goto((pathlib.Path('.') / '资料' / '推广物料' / 'A4传单.html').resolve().as_uri())
        p.emulate_media(media='print')
        p.wait_for_timeout(300)
        for w in (44, 45, 46, 46.5, 47, 47.5, 48, 48.5, 49):
            p.evaluate('(w) => { window.__w = w; }', w)
            lines = p.evaluate(NODES)
            print('shotW=%s -> %d 行' % (w, len(lines)))
            for i, ln in enumerate(lines):
                print('   %d| %s' % (i + 1, ln))
        b.close()


if __name__ == '__main__':
    main()
