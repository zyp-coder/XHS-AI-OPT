# -*- coding: utf-8 -*-
"""临时探针：量 A4传单 每页 over + 每段末行富余（找给 IP 玩法加字的零高度位）；用完即删。"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = (ROOT / '资料' / '推广物料' / 'A4传单.html').as_uri()

JS = r"""
() => {
  const lineInfo = (el) => {    const range = document.createRange();
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width > 0.5 && r.height > 0.5) rects.push({t: Math.round(r.top), l: r.left, r: r.right});
      }
    }
    const map = new Map();
    for (const r of rects) {
      const cur = map.get(r.t) || {l: Infinity, r: -Infinity};
      cur.l = Math.min(cur.l, r.l); cur.r = Math.max(cur.r, r.r);
      map.set(r.t, cur);
    }
    const keys = [...map.keys()].sort((a, b) => a - b);
    const box = el.getBoundingClientRect();
    const last = keys.length ? map.get(keys[keys.length - 1]) : null;
    return {
      lines: keys.length,
      contW: +box.width.toFixed(1),
      lastUsed: last ? +(last.r - last.l).toFixed(1) : 0,
      head: last ? +(box.width - (last.r - last.l) - (last.l - box.left)).toFixed(1) : null,
      text: (el.textContent || '').trim().slice(0, 18),
    };
  };
  const out = { pages: [], paras: [] };
  const pages = [...document.querySelectorAll('.page')];
  out.pages = pages.map((pg, i) => ({ i: i + 1, over: pg.scrollHeight - pg.clientHeight }));
  const back = document.querySelector('.back');
  const qaList = back.querySelector('.qa-list');
  const qrbox = back.querySelector('.qrbox');
  out.backSlack = +(qrbox.getBoundingClientRect().top - qaList.getBoundingClientRect().bottom).toFixed(1);
  qaList.querySelectorAll('.qa').forEach((qa, qi) => {
    const qn = (qa.querySelector('.qb') || {}).textContent || String(qi + 1);
    qa.querySelectorAll('.qc > p, .qc-row p').forEach((p, pi) => {
      out.paras.push(Object.assign({ q: qn, p: pi + 1 }, lineInfo(p)));
    });
  });
  back.querySelectorAll('.flow span').forEach((s, i) => {
    out.paras.push(Object.assign({ q: '5-flow', p: i + 1 }, lineInfo(s)));
  });
  // 用真实字体量候选句宽度：对照 5-flow p1 的容器宽
  const span = back.querySelector('.flow span');
  const cs = getComputedStyle(span);
  const cv = document.createElement('canvas').getContext('2d');
  cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  out.font = cs.fontWeight + ' ' + cs.fontSize;
  out.flowW = +span.getBoundingClientRect().width.toFixed(1);
  out.current = +cv.measureText(span.textContent).width.toFixed(1);
  out.cands = [
    '帮您选题 → 圈人 → 整理素材 → 发笔记（IP 玩法立人设、知识、引流、案例）',
    '帮您选题 → 圈人 → 整理素材 → 发笔记（IP 玩法、知识、引流、案例四类）',
    '帮您选题 → 圈人 → 整理素材 → 发笔记（四类：IP 玩法 / 知识 / 引流 / 案例）',
    '帮您选题 → 圈人 → 整理素材 → 发笔记（含 IP 玩法立人设，按您的知识库出内容）',
    '帮您选题 → 圈人 → 整理素材 → 发笔记（IP 玩法立人设，另有知识 / 引流 / 案例）',
  ].map(t => ({ w: +cv.measureText(t).width.toFixed(1), t: t.slice(20) }));
  return out;
}
"""


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
            print('pages:', data['pages'], ' backSlack:', data['backSlack'])
            print('font:', data['font'], ' flowW:', data['flowW'], ' current:', data['current'])
            for c in data['cands']:
                print('  cand w=%s fit=%s | …%s' % (c['w'], c['w'] <= data['flowW'], c['t']))
            for d in data['paras']:
                print('Q%s p%s: lines=%s head=%s contW=%s | %s'
                      % (d['q'], d['p'], d['lines'], d['head'], d['contW'], d['text']))
            p.close()
        b.close()


if __name__ == '__main__':
    main()
