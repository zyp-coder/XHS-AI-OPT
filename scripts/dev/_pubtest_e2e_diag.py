# -*- coding: utf-8 -*-
"""e2e 失败复诊（三平台各开一个新标签，按修正后的调用形状来）：
A. 看 npShadowHook 注册态；
B. 小红书新标签：钩子在 MAIN/ISOLATED 两眼各看一次；
C. 视频号新标签：allFrames 正确写法（塞进 target）→ 找表单 frame；
D. 抖音视频页新标签：钩子 → 点上传入口 → 看文件口到底出没出（视频页 vs 图文页差异）。
用完把这三个新标签关掉。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
URL_XHS = 'https://creator.xiaohongshu.com/publish/publish?source=official'
URL_CH = 'https://channels.weixin.qq.com/platform/post/create'
URL_DY = 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page&media_type=video&type=new'

JS_REG = "chrome.scripting.getRegisteredContentScripts().then(l => l.map(s => ({id: s.id, matches: s.matches, world: s.world, runAt: s.runAt, allFrames: s.allFrames, persist: s.persistAcrossSessions})))"

JS_OPEN = "(async (url) => { const t = await chrome.tabs.create({ url: url, active: true }); return t.id; })"
JS_CLOSE = "(async (id) => { try { await chrome.tabs.remove(id); return true; } catch (e) { return String(e); } })"

JS_HOOK_STATE = r'''(async (p) => {
  const fn = function () {
    const host = document.querySelector('xhs-publish-btn');
    return { href: location.href.slice(0, 80), hook: !!window.__npaShadowHookOn,
      roots: (window.__npaShadowRoots || []).length, host: !!host, shadowOpen: !!(host && host.shadowRoot) };
  };
  const run = async (world) => {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId: p.tabId }, func: fn, args: [], world: world });
      return r[0] && r[0].result;
    } catch (e) { return 'ERR:' + String(e); }
  };
  return { main: await run('MAIN'), isolated: await run('ISOLATED') };
})'''

JS_CH_PROBE = r'''(async (p) => {
  const fn = function () {
    const has = !!document.querySelector('.input-editor, [class*="input-editor"]')
      || !!document.querySelector('input[type="file"][accept*="video"]');
    return { form: has, href: location.href.slice(0, 100) };
  };
  const pack = (r) => r.map(x => ({ f: x.frameId, hit: x.result ? x.result.form : null, href: x.result ? x.result.href : null, err: x.error ? String(x.error).slice(0, 80) : null }));
  const out = {};
  try { out.isoAll = pack(await chrome.scripting.executeScript({ target: { tabId: p.tabId, allFrames: true }, func: fn, args: [], world: 'ISOLATED' })); } catch (e) { out.isoAll = 'ERR:' + String(e); }
  try { out.mainAll = pack(await chrome.scripting.executeScript({ target: { tabId: p.tabId, allFrames: true }, func: fn, args: [], world: 'MAIN' })); } catch (e) { out.mainAll = 'ERR:' + String(e); }
  try { const t = await chrome.scripting.executeScript({ target: { tabId: p.tabId }, func: fn, args: [], world: 'ISOLATED' }); out.isoTopOnly = pack(t); } catch (e) { out.isoTopOnly = 'ERR:' + String(e); }
  return out;
})'''

JS_DY_PRE = r'''(async (p) => {
  const hook = function () {
    const w = window;
    if (!w.__npaDyHooked) {
      w.__npaDyHooked = true; w.__npaDyInputs = [];
      const orig = document.createElement;
      document.createElement = function (tag) {
        const el = orig.apply(this, arguments);
        try { if (String(tag).toLowerCase() === 'input') w.__npaDyInputs.push(el); } catch (e) {}
        return el;
      };
    }
    return { ok: true };
  };
  await chrome.scripting.executeScript({ target: { tabId: p.tabId }, func: hook, args: [], world: 'MAIN' });
  const dump = function () {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
    const btns = [...document.querySelectorAll('button')].filter(b => /^(继续添加|上传图片|上传视频|上传)$/.test((b.innerText || '').trim()) && vis(b))
      .map(b => ({ t: (b.innerText || '').trim(), cls: String(b.className || '').slice(0, 60) }));
    const zones = [...document.querySelectorAll('div,span,label')].filter(e => e.children.length <= 2 && /点击上传|拖拽|上传图片|上传视频/.test((e.innerText || '').trim()) && vis(e))
      .slice(0, 8).map(e => ({ tag: e.tagName, t: (e.innerText || '').trim().slice(0, 36), cls: String(e.className || '').slice(0, 50) }));
    const inputs = [...document.querySelectorAll('input[type="file"]')].map(i => ({ a: String(i.accept || '').slice(0, 44), multi: i.multiple }));
    return { href: location.href.slice(0, 110), hooked: !!window.__npaDyHooked, dyInputs: (window.__npaDyInputs || []).length,
      btns: btns, zones: zones, inputs: inputs,
      text: (document.body ? document.body.innerText : '').slice(0, 260).replace(/\n+/g, ' | ') };
  };
  const r = await chrome.scripting.executeScript({ target: { tabId: p.tabId }, func: dump, args: [], world: 'MAIN' });
  return r[0] && r[0].result;
})'''

JS_DY_CLICK = r'''(async (p) => {
  const clickFn = function () {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0; };
    const clickEl = (el) => {
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    };
    const w = window;
    const before = (w.__npaDyInputs || []).length;
    const btn = [...document.querySelectorAll('button')].find(b => /^(继续添加|上传图片|上传视频|上传)$/.test((b.innerText || '').trim()) && vis(b))
      || [...document.querySelectorAll('div,span,label')].find(e => e.children.length <= 2 && /点击上传|拖拽|上传图片|上传视频/.test((e.innerText || '').trim()) && vis(e));
    if (!btn) return { ok: false, msg: '上传入口没找到' };
    const picked = { tag: btn.tagName, t: (btn.innerText || '').trim().slice(0, 36), cls: String(btn.className || '').slice(0, 60) };
    clickEl(btn);
    return { ok: true, picked: picked, before: before };
  };
  const r1 = await chrome.scripting.executeScript({ target: { tabId: p.tabId }, func: clickFn, args: [], world: 'MAIN' });
  const res1 = r1[0] && r1[0].result;
  await new Promise(res => setTimeout(res, 2000));
  const dump2 = function () {
    const w = window;
    return { dyInputs: (w.__npaDyInputs || []).length,
      news: (w.__npaDyInputs || []).filter(x => x.type === 'file').length,
      allFileInputs: [...document.querySelectorAll('input[type="file"]')].map(i => ({ a: String(i.accept || '').slice(0, 44), multi: i.multiple })),
      text: (document.body ? document.body.innerText : '').slice(0, 300).replace(/\n+/g, ' | ') };
  };
  const r2 = await chrome.scripting.executeScript({ target: { tabId: p.tabId }, func: dump2, args: [], world: 'MAIN' });
  return { click: res1, after: r2[0] && r2[0].result };
})'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
        if not page:
            print('没有控制台页')
            return
        page.bring_to_front()

        print('== A. 已注册内容脚本 ==')
        print(json.dumps(page.evaluate(JS_REG), ensure_ascii=False, indent=1))

        print('== B. 小红书新标签：钩子两眼 ==')
        xid = page.evaluate(JS_OPEN, URL_XHS)
        print('  tabId', xid)
        time.sleep(9)
        print(json.dumps(page.evaluate(JS_HOOK_STATE, {'tabId': xid}), ensure_ascii=False, indent=1))

        print('== C. 视频号新标签：allFrames 找表单 frame ==')
        cid = page.evaluate(JS_OPEN, URL_CH)
        print('  tabId', cid)
        time.sleep(9)
        print(json.dumps(page.evaluate(JS_CH_PROBE, {'tabId': cid}), ensure_ascii=False, indent=1))

        print('== D. 抖音视频页新标签：点上传入口 ==')
        did = page.evaluate(JS_OPEN, URL_DY)
        print('  tabId', did)
        time.sleep(9)
        print('  前置:', json.dumps(page.evaluate(JS_DY_PRE, {'tabId': did}), ensure_ascii=False, indent=1))
        print('  点击:', json.dumps(page.evaluate(JS_DY_CLICK, {'tabId': did}), ensure_ascii=False, indent=1))
        try:
            dpage = [p for p in ctx.pages if 'post/video' in p.url]
            if dpage:
                dpage[-1].screenshot(path='tmp/pubtest_shots/diag_dy_video.png', timeout=15000)
                print('  📷 diag_dy_video.png')
                dpage[-1].keyboard.press('Escape')
        except Exception as e:
            print('  shot err:', str(e)[:100])

        print('== 收尾：关掉三个新标签 ==')
        for tid in (xid, cid, did):
            print('  close', tid, '->', page.evaluate(JS_CLOSE, tid))


if __name__ == '__main__':
    main()
