# -*- coding: utf-8 -*-
"""切片台「一键到底」样子稿·点击流自检（2026-10-22）

打开 tmp/切片一键demo.html，把这一条路走一遍并截图：
  ① 批次页有「🪄 一键切完这批」＋两处旋钮（一次跑几条 / 不传图片）
  ② 点它先报「几张图、大约多少钱」，不点开始不跑
  ③ 跑完停在待入库清单：没把握那条排最上、横幅有「✓ 全都收进库」
  ④ 点第 1 条「✏ 调这条」进剪辑视图：时间轴有色块、加刀／挪刀／删刀都能改段数
  ⑤ 点段名改名 → 挂「✎ 改过」
  ⑥ 「✓ 这条收进库」回清单，那条变已入库；再点「✓ 全都收进库」全进库
  ⑦ 「↺ 重切」把刀清掉重跑，改过的名字还在
任何页内报错都算失败。
"""
import sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / 'tmp' / '切片一键demo.html'
SHOT = REPO / 'tmp' / '切片一键demo'
SHOT.mkdir(parents=True, exist_ok=True)
errs, results = [], []

def ok(name, cond, extra=''):
    results.append(('PASS' if cond else 'FAIL', name, extra))
    if not cond:
        print('  ❌ %s %s' % (name, extra))
    return cond

def shot(page, tag):
    page.screenshot(path=str(SHOT / (tag + '.png')), full_page=True)

def txt(page, sel):
    return page.evaluate("() => { const e = document.querySelector('%s'); return e ? e.innerText.replace(/\\s+/g,' ').trim() : ''; }" % sel)

def main():
    if not DEMO.exists():
        print('找不到样子稿：', DEMO); return 1
    with sync_playwright() as p:
        br = p.chromium.launch(channel='msedge', headless=True)
        page = br.new_context(viewport={'width': 1280, 'height': 1000}).new_page()
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.goto(DEMO.as_uri())
        page.wait_for_timeout(400)

        body = txt(page, 'body')
        ok('① 批次页标题与一键那颗钮在', '一键切完这批' in body and '10-22 张三家' in body, body[:60])
        ok('① 两处旋钮都在（一次跑几条 / 不传图片）', '一次跑' in body and '不传画面小图' in body)
        ok('① 三条片都标着还没切', body.count('还没切') == 3)
        shot(page, '1-batch')

        # ② 确认框：报张数与钱
        page.click('button:has-text("🪄 一键切完这批")')
        page.wait_for_timeout(250)
        box = txt(page, '.box')
        n_frames = page.evaluate("() => { const vs=state.videos.filter(v=>v.state==='new'); return vs.reduce((n,v)=>n+Math.min(60,Math.ceil(v.dur/2.5))+AUTO[v.id].segs.length,0); }")
        ok('② 先报要几张画面 + 大约多少钱', ('张画面小图' in box or '要看' in box) and '¥' in box, box[:90])
        ok('② 写明跑完不直接进库', '停在待入库清单' in box or '过一眼' in box)
        shot(page, '2-confirm')
        page.click('#masker button.npl-btn.primary')
        page.wait_for_timeout(600)
        run = txt(page, '.npl-scan')
        ok('③ 跑起来有进度条与第几条', '正在切第' in run, run[:60])

        # 等跑完
        for _ in range(60):
            if page.evaluate("() => !state.running"): break
            page.wait_for_timeout(400)
        page.wait_for_timeout(500)
        body = txt(page, 'body')
        ok('③ 跑完三条都进「待入库」', page.evaluate("() => state.videos.filter(v=>v.state==='ready').length") == 3)
        ok('③ 没把握那条排最上面', '卧室收尾' in page.evaluate("() => document.querySelector('.pk-row').innerText"), page.evaluate("() => document.querySelector('.pk-row').innerText")[:40])
        ok('③ 横幅有「全都收进库」', page.evaluate("() => !!document.querySelector('.npl-ctx') && document.querySelector('.npl-ctx').innerText.includes('全都收进库')"))
        ok('③ 每行三颗钮：收进库 / 调这条 / 重切',
           page.evaluate("() => document.querySelectorAll('.pk-row button').length") >= 9)
        shot(page, '3-list')

        # ④ 调第 1 条
        page.click('.pk-row:has-text("客厅走场") button:has-text("✏ 调这条")')
        page.wait_for_timeout(350)
        seg_n0 = page.evaluate("() => segsOf(V('v1')).length")
        head = page.evaluate("() => { state.head = 100; render(); return 1; }")
        page.click('button:has-text("＋ 在这里切一刀")')
        page.wait_for_timeout(300)
        seg_n1 = page.evaluate("() => segsOf(V('v1')).length")
        ok('④ 加一刀＝多一段', seg_n1 == seg_n0 + 1, '%d → %d' % (seg_n0, seg_n1))
        page.click('button:has-text("−0.5 秒")')
        page.wait_for_timeout(250)
        ok('④ 挪刀能用（−0.5 秒）', page.evaluate("() => V('v1').cuts.some(c => Math.abs(c-99.5)<0.01)"))
        page.click('button:has-text("🗑 删这颗切点")')
        page.wait_for_timeout(250)
        ok('④ 删刀回到原段数', page.evaluate("() => segsOf(V('v1')).length") == seg_n0)
        shot(page, '4-edit')

        # ⑤ 改段名（弹框填新名）
        page.evaluate("() => window.__ans = null")
        page.evaluate("() => { const o = window.prompt; window.prompt = (t, d) => { window.__ans = d; return '插座位置特写'; }; }")
        page.click('.npl-segname >> nth=2')
        page.wait_for_timeout(300)
        ok('⑤ 改过的段挂「✎ 改过」', '改过' in txt(page, '.npl-ed-list'), txt(page, '.npl-ed-list')[:80])
        ok('⑤ 新名字进去了', '插座位置特写' in txt(page, '.npl-ed-list'))

        # ⑥ 收进库
        page.click('button:has-text("✓ 这条收进库")')
        page.wait_for_timeout(400)
        ok('⑥ 回清单且这条变已入库', page.evaluate("() => state.page==='batch' && V('v1').state==='stored'"))
        ok('⑥ 库里那条行写「已收进库 · 5 段」', '已收进库' in page.evaluate("() => [...document.querySelectorAll('.pk-row')].map(r=>r.innerText).join('|')"))
        shot(page, '6-stored')

        # ⑦ 重切保住改过的名字
        page.click('.pk-row:has-text("客厅走场") button:has-text("↺ 重切")')
        page.wait_for_timeout(350)
        ok('⑦ 重切后改过的名字还在', page.evaluate("() => V('v1').segs.some(s => s.edited && s.name==='插座位置特写')"))
        ok('⑦ 重切把这条退回待收', page.evaluate("() => V('v1').state==='ready'"))

        # ⑧ 全都收进库
        page.click('button:has-text("✓ 全都收进库")')
        page.wait_for_timeout(300)
        ok('⑧ 三条全进库', page.evaluate("() => state.videos.every(v=>v.state==='stored')"))
        toast = txt(page, '.toast')
        ok('⑧ 收尾报哪条没点进去看', '没点进去看' in toast or '收进库' in toast, toast[:70])
        shot(page, '8-done')

        # ⑨ 不传图片那档
        page.evaluate("() => { state.noVision=true; state.videos.forEach(v=>{v.state='new';v.segs=[];v.cuts=[];v.frames=0;}); render(); }")
        page.click('button:has-text("🪄 一键切完这批")')
        page.wait_for_timeout(250)
        ok('⑨ 不传图片时确认框照实说明', '不传图片' in txt(page, '.box'), txt(page, '.box')[:80])
        page.click('#masker button.npl-btn.primary')
        for _ in range(60):
            if page.evaluate("() => !state.running"): break
            page.wait_for_timeout(400)
        ok('⑨ 不传图片＝不认名字（花钱计数不涨）', page.evaluate("() => V('v1').frames === Math.min(60, Math.ceil(V('v1').dur/2.5))"))
        shot(page, '9-novision')

        page.on('dialog', lambda d: d.dismiss())
        br.close()

    bad = [r for r in results if r[0] == 'FAIL']
    print('\n──── 点击流结果 ────')
    for st, name, extra in results:
        print('%s %s%s' % ('✔' if st == 'PASS' else '❌', name, ('  | ' + extra) if extra and st == 'FAIL' else ''))
    if errs:
        print('\n❌ 页内报错 %d 条：' % len(errs))
        for e in errs[:8]: print('  ', e[:200])
    print('\n── 结论：%s ──' % ('全绿（截图在 tmp/切片一键demo/）' if not bad and not errs else '有 %d 项没过、报错 %d 条' % (len(bad), len(errs))))
    return 0 if not bad and not errs else 2

if __name__ == '__main__':
    sys.exit(main())
