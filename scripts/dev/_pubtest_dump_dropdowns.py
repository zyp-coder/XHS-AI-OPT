# -*- coding: utf-8 -*-
"""侦察：dump 小红书/抖音话题建议下拉的当前状态与条目 DOM。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

SHOTS = 'tmp/pubtest_shots'


def js_dump_xhs():
    return r'''(() => {
      const out = {suggestions: [], topics: [], editorPresent: false, title: ''};
      const ed = document.querySelector('[contenteditable="true"], .ql-editor, [contenteditable]');
      out.editorPresent = !!ed;
      const t = document.querySelector('input[placeholder*="标题"], input[placeholder*="填写标题"]');
      out.title = t ? t.value : '';
      document.querySelectorAll('a.tiptap-topic').forEach(a => out.topics.push((a.innerText || '').slice(0, 40)));
      // 不限类名：扫所有可见浮层里以 # 开头的小条目
      const seen = new Set();
      document.querySelectorAll('div,li,span,a').forEach(e => {
        const txt = (e.innerText || '').trim();
        if (!txt || txt.length > 30 || !txt.startsWith('#')) return;
        if (e.children.length > 2) return;
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (seen.has(e)) return;
        seen.add(e);
        const chain = [];
        let p = e;
        for (let i = 0; i < 5 && p; i++) { chain.push(p.tagName + (p.className ? '.' + String(p.className).split(' ').slice(0,2).join('.') : '')); p = p.parentElement; }
        out.suggestions.push({text: txt.slice(0, 30), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), chain, html: e.outerHTML.slice(0, 160)});
      });
      return out;
    })()'''


def js_dump_dy():
    return r'''(() => {
      const out = {suggest: [], chips: [], title: ''};
      const t = document.querySelector('input[placeholder*="标题"], input[placeholder*="填写"]');
      out.title = t ? t.value : '';
      document.querySelectorAll('[data-mention]').forEach(e => out.chips.push((e.innerText || '').slice(0, 40)));
      document.querySelectorAll('[class*="mention-suggest"]').forEach(e => {
        out.suggest.push({tag: e.tagName, cls: String(e.className).slice(0, 90), text: (e.innerText || '').trim().slice(0, 60),
          visible: (() => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()});
      });
      return out;
    })()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            u = p.url
            if 'creator.xiaohongshu.com' in u:
                p.bring_to_front()
                time.sleep(0.6)
                info = p.evaluate(js_dump_xhs())
                print('== XHS ==', u)
                print(json.dumps(info, ensure_ascii=False, indent=1))
                p.screenshot(path=f'{SHOTS}/xhs_dd_now.png')
            elif 'creator.douyin.com' in u:
                p.bring_to_front()
                time.sleep(0.6)
                info = p.evaluate(js_dump_dy())
                print('== DOUYIN ==', u)
                print(json.dumps(info, ensure_ascii=False, indent=1))
                p.screenshot(path=f'{SHOTS}/douyin_dd_now.png')


if __name__ == '__main__':
    main()
