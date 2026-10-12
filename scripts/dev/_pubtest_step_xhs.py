# -*- coding: utf-8 -*-
"""联调①：把 pub-adapt.js 的 NPA_XHS_* 直接注入测试窗口的小红书发布页跑一遍
（填标题/正文/话题芯片；SEND 只 dry，绝不点发布）。"""
import sys, json, subprocess, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

ROOT = 'D:\\AIproject\\小红书运营'
SHOTS = 'tmp/pubtest_shots'

def load_npa():
    out = subprocess.check_output(['node', 'scripts/dev/_npa_dump.js'], cwd=ROOT)
    return json.loads(out.decode('utf-8'))

def js_call(fn_src, arg):
    return '(' + fn_src + ')(' + json.dumps(arg, ensure_ascii=True) + ')'

def main():
    npa = load_npa()
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            u = p.url
            if 'creator.xiaohongshu.com' in u and 'publish' in u:
                p.bring_to_front()
                time.sleep(0.8)
                probe = p.evaluate(js_call(npa['NPA_PROBE'], {'pid': 'xhs'}))
                print('probe:', json.dumps(probe, ensure_ascii=False))
                # 先在图文页签（幂等）
                tab = p.evaluate(js_call(npa['NPA_XHS_TAB'], {'isVideo': False}))
                print('tab:', tab)
                time.sleep(0.8)
                r = p.evaluate(js_call(npa['NPA_XHS_FILL'], {
                    'title': '联调标题·卡图已就位',
                    'body': '第一段：这篇在验证自动填字。\n第二段：话题芯片应当出现在这一段之后。',
                    'tags': ['引流获客', '副业思维'],
                }))
                print('fill:', json.dumps(r, ensure_ascii=False))
                time.sleep(0.6)
                dump = p.evaluate(r'''(() => {
                  const ti = [...document.querySelectorAll('input')].find(i => /标题/.test(i.placeholder || ''));
                  const ed = [...document.querySelectorAll('.tiptap.ProseMirror')].filter(e => e.getBoundingClientRect().width > 200)[0];
                  return {title: ti ? ti.value : '(none)',
                          text: ed ? (ed.textContent || '').slice(0, 300) : '(none)',
                          chips: ed ? [...ed.querySelectorAll('a.tiptap-topic')].map(a => a.textContent) : []};
                })()''')
                print('dump:', json.dumps(dump, ensure_ascii=False, indent=1))
                dry = p.evaluate(js_call(npa['NPA_XHS_SEND'], {'dry': True}))
                print('send(dry):', json.dumps(dry, ensure_ascii=False))
                p.screenshot(path=f'{SHOTS}/xhs_fill_e2e.png')
                print('shot saved')
                return
        print('没找到小红书发布页')


if __name__ == '__main__':
    main()
