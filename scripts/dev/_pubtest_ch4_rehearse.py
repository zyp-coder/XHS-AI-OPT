# -*- coding: utf-8 -*-
"""视频号彩排·新通路（contentDocument 主框架版）：
全程在顶层页 MAIN world 里跑（Playwright evaluate＝与 chrome.scripting MAIN 注入同款环境），
NPA_CH_* 自己从同源 iframe 的 contentDocument 进表单——验 2026-10-09 冻死修复后的新路。
喂料 → PROBE → UPLOAD → FILL（种子同款文本）→ SEND dry → 截图。绝不真发。"""
import base64
import json
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

ROOT = 'D:\\AIproject\\小红书运营'
SHOTS = 'tmp/pubtest_shots'
VIDEO = ROOT + '\\资料\\视频\\客户模板样片\\演示片-六幕四版式.mp4'
KEY = 'pub:test:ch4|演示片-六幕四版式.mp4'
ADAPTED = {
    'title': '彩排篇 视频号过目',
    'body': '第一段：这是发布链的彩排稿，视频号版本。\n第二段：到点后会在发布前一步停下，等人过目。',
    'tags': ['#彩排', '#过目'],
}

JS_SCAN = r'''(() => {
  const hit = (d) => { try { return !!(d && d.querySelector('.input-editor, [class*="input-editor"]')); } catch (e) { return false; } };
  let doc = null, where = null;
  if (hit(document)) { doc = document; where = 'top'; }
  else for (const f of document.querySelectorAll('iframe')) {
    let d = null; try { d = f.contentDocument; } catch (e) { continue; }
    if (hit(d)) { doc = d; where = 'iframe'; break; }
  }
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = { where, href: location.href.slice(0, 90) };
  if (!doc) return out;
  const v = doc.querySelector('video');
  out.video = v ? { src: String(v.currentSrc || v.src || '').slice(0, 70), dur: Math.round((v.duration || 0) * 10) / 10 } : null;
  const eds = [...doc.querySelectorAll('[contenteditable]')].filter(vis).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
  const ed = eds[0];
  out.edText = ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 160) : null;
  out.topics = ed ? [...ed.querySelectorAll('span')].filter(s => /topic|hl/i.test(String(s.className))).map(s => (s.textContent || '').slice(0, 20)).slice(0, 8) : [];
  const sti = [...doc.querySelectorAll('input')].find(i => /短标题|标题/.test(i.placeholder || ''));
  out.stitle = sti ? sti.value : null;
  const pubs = [...doc.querySelectorAll('button,div,span')].filter(e => { const t = (e.innerText || '').trim(); return (t === '发表' || t === '发布') && e.children.length <= 2 && vis(e); }).sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
  out.pub = pubs.length ? { n: pubs.length, first: (pubs[0].innerText || '').trim(), disabled: !!pubs[0].disabled } : null;
  const dlg = [];
  for (const d of [document, doc]) {
    try { d.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="modal"]').forEach(el => { if (vis(el)) dlg.push(String(el.className).slice(0, 36) + '::' + (el.innerText || '').replace(/\n/g, '|').slice(0, 60)); }); } catch (e) {}
  }
  out.dlg = [...new Set(dlg)].slice(0, 6);
  const txt = ((doc.body ? doc.body.innerText : '') + ' ' + (document.body ? document.body.innerText : ''));
  out.busy = /文件上传中|上传中|处理中/.test(txt);
  return out;
})()'''

JS_CLEAR_DLG = r'''((async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) { let d = null; try { d = f.contentDocument; } catch (e) { continue; } if (d) docs.push(d); }
  for (const d of docs) {
    const dlgs = [...d.querySelectorAll('[class*="dialog"],[class*="Dialog"]')].filter(x => vis(x) && /切换视频号/.test(x.innerText || ''));
    if (!dlgs.length) continue;
    const btns = [...dlgs[0].querySelectorAll('button,div,span')].filter(e => vis(e) && /取消切换|暂不切换|取消/.test((e.innerText || '').trim()) && e.children.length <= 1);
    if (!btns.length) return { dlg: true, clicked: null };
    const el = btns[btns.length - 1];
    const r = el.getBoundingClientRect();
    const W = d.defaultView || window;
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: W };
    el.dispatchEvent(new W.PointerEvent('pointerdown', o));
    el.dispatchEvent(new W.MouseEvent('mousedown', o));
    el.dispatchEvent(new W.PointerEvent('pointerup', o));
    el.dispatchEvent(new W.MouseEvent('mouseup', o));
    el.dispatchEvent(new W.MouseEvent('click', o));
    await sleep(600);
    return { dlg: true, clicked: (el.innerText || '').trim() };
  }
  return { none: true };
})())'''

JS_BUF = r'''(() => { const b = window.__npaBuf || {}; const k = Object.keys(b)[0]; return k ? { key: k, parts: b[k].parts.length, done: !!b[k].done } : null; })()'''


def load_npa():
    out = subprocess.check_output(['node', 'scripts/dev/_npa_dump.js'], cwd=ROOT)
    return json.loads(out.decode('utf-8'))


def js_call(fn_src, arg=None):
    if arg is None:
        return '(' + fn_src + ')()'
    return '(' + fn_src + ')(' + json.dumps(arg, ensure_ascii=True) + ')'


def main():
    npa = load_npa()
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        chpages = [p for p in ctx.pages if 'channels.weixin.qq.com/platform/post/create' in p.url]
        print('视频号标签数:', len(chpages))
        if not chpages:
            print('没有视频号页')
            return

        page = None
        for p in chpages:
            try:
                p.bring_to_front()
                time.sleep(0.4)
                st = p.evaluate(JS_SCAN)
            except Exception as e:
                print('  标签扫不动，跳过:', str(e)[:100])
                continue
            tag = '空表单' if (st.get('where') and not st.get('video') and not (st.get('edText') or '').strip()) else \
                  ('有视频' if st.get('video') else ('有字' if (st.get('edText') or '').strip() else '无表单'))
            print('  标签态[%s]: %s' % (tag, json.dumps(st, ensure_ascii=False)[:220]))
            if page is None and st.get('where') and not st.get('video') and not (st.get('edText') or '').strip():
                page = p
        if page is None:
            print('没有空表单标签页，退出')
            return

        page.bring_to_front()
        time.sleep(0.4)
        print('认领空表单标签:', page.url)
        st = page.evaluate(JS_SCAN)
        print('PROBE 态:', json.dumps(st, ensure_ascii=False))
        if st.get('dlg'):
            print('发现弹窗，清:', json.dumps(page.evaluate(JS_CLEAR_DLG), ensure_ascii=False))
            time.sleep(0.8)
        print('== NPA_CH_PROBE_FRAME ==', json.dumps(page.evaluate(js_call(npa['NPA_CH_PROBE_FRAME'])), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch4_pre.png', timeout=15000)

        print('== 分片喂（顶层 MAIN world＝注入同款） ==')
        t0 = time.time()
        b64 = base64.b64encode(open(VIDEO, 'rb').read()).decode('ascii')
        chunks = [b64[i:i + 3 * 1024 * 1024] for i in range(0, len(b64), 3 * 1024 * 1024)]
        for i, ch in enumerate(chunks):
            r = page.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': KEY, 'b64': ch, 'done': i == len(chunks) - 1}))
            print('  chunk', i, r)
        print('  喂完 %.1fs  缓冲:' % (time.time() - t0), json.dumps(page.evaluate(JS_BUF), ensure_ascii=False))

        print('== NPA_CH_UPLOAD ==')
        t0 = time.time()
        print(' ', json.dumps(page.evaluate(js_call(npa['NPA_CH_UPLOAD'], {'keys': [KEY]})), ensure_ascii=False))
        print('  耗时 %.1fs' % (time.time() - t0))
        print('传后态:', json.dumps(page.evaluate(JS_SCAN), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch4_uploaded.png', timeout=15000)

        print('== NPA_CH_FILL ==', json.dumps(page.evaluate(js_call(npa['NPA_CH_FILL'], ADAPTED)), ensure_ascii=False))
        time.sleep(1.2)
        print('填后态:', json.dumps(page.evaluate(JS_SCAN), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch4_filled.png', timeout=15000)

        print('== NPA_CH_SEND dry ==', json.dumps(page.evaluate(js_call(npa['NPA_CH_SEND'], {'dry': True})), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch4_dry.png', timeout=15000)
        print('页保持不关（留给后面清理）')


if __name__ == '__main__':
    main()
