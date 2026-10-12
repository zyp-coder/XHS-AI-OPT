# -*- coding: utf-8 -*-
"""视频号彩排·空表单首传：按内容特征认空表单标签页 →
分片喂 → NPA_CH_UPLOAD（首传：无→有）→ NPA_CH_FILL（标题清洗版）→
等发表按钮亮 → NPA_CH_SEND dry → 不关页。绝不真发。"""
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
KEY = 'pub:test:ch1|演示片-六幕四版式.mp4'


def load_npa():
    out = subprocess.check_output(['node', 'scripts/dev/_npa_dump.js'], cwd=ROOT)
    return json.loads(out.decode('utf-8'))


def js_call(fn_src, arg):
    return '(' + fn_src + ')(' + json.dumps(arg, ensure_ascii=True) + ')'


JS_STATE = r'''(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const v = document.querySelector('video');
  const ed = [...document.querySelectorAll('[contenteditable]')].filter(vis)[0];
  const topics = ed ? [...ed.querySelectorAll('span')].filter(s => /topic|hl/i.test(String(s.className)))
    .map(s => String(s.className).slice(0, 30) + '::' + (s.textContent || '').slice(0, 24)) : [];
  const pub = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '发表');
  const sti = [...document.querySelectorAll('input')].find(i => /短标题/.test(i.placeholder || ''));
  const tip = document.body.innerText || '';
  return {
    video: v ? { src: String(v.currentSrc || v.src).slice(0, 60), w: v.videoWidth, dur: Math.round((v.duration || 0) * 10) / 10 } : null,
    edText: ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 110) : null,
    topics,
    stitle: sti ? sti.value : null,
    stitleErr: /特殊字符/.test(tip),
    pub: pub ? { disabled: !!pub.disabled } : null,
    busy: /文件上传中/.test(tip),
  };
})()'''

JS_CLEAR_DLG = r'''((async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const dlgs = [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"]')].filter(d => vis(d) && /切换视频号/.test(d.innerText || ''));
  if (!dlgs.length) return { none: true };
  const btns = [...dlgs[0].querySelectorAll('button,div,span')].filter(e => vis(e) && /取消切换|暂不切换|取消/.test((e.innerText || '').trim()) && e.children.length <= 1);
  if (!btns.length) return { dlg: true, clicked: null };
  const el = btns[btns.length - 1];
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  await sleep(600);
  return { dlg: true, clicked: (el.innerText || '').trim() };
})())'''


def find_form_frame(page):
    for _ in range(90):
        time.sleep(0.5)
        for f in page.frames:
            if '/micro/content/post/create' in (f.url or ''):
                try:
                    if f.evaluate("!!document.querySelector('.input-editor, [class*=\"input-editor\"]')"):
                        return f
                except Exception:
                    pass
    return None


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
        fr = None
        for p in chpages:
            f = find_form_frame(p)
            if not f:
                print('  有个标签表单没出来，跳过:', p.url[:80])
                continue
            st = f.evaluate(JS_STATE)
            print('  标签态:', json.dumps(st, ensure_ascii=False)[:200])
            if st.get('video') is None and page is None:
                page, fr = p, f
        if not page:
            print('没有空表单标签页，退出')
            return

        page.bring_to_front()
        print('认领空表单标签:', page.url)
        print('frame ok:', fr.url)
        print('清弹窗:', json.dumps(fr.evaluate(JS_CLEAR_DLG), ensure_ascii=False))
        print('初始态:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch3_fresh.png', timeout=15000)

        print('== 分片喂 ==')
        t0 = time.time()
        b64 = base64.b64encode(open(VIDEO, 'rb').read()).decode('ascii')
        chunks = [b64[i:i + 3 * 1024 * 1024] for i in range(0, len(b64), 3 * 1024 * 1024)]
        for i, ch in enumerate(chunks):
            r = fr.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': KEY, 'b64': ch, 'done': i == len(chunks) - 1}))
            print('  chunk', i, r)
        print('  喂完 %.1fs' % (time.time() - t0))

        print('== 真传（首传：无→有） ==')
        t0 = time.time()
        print(json.dumps(fr.evaluate(js_call(npa['NPA_CH_UPLOAD'], {'keys': [KEY]})), ensure_ascii=False))
        print('  耗时 %.1fs' % (time.time() - t0))
        print('传后态:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch3_uploaded.png', timeout=15000)

        print('== 填（标题带特殊字符，验清洗） ==')
        print(json.dumps(fr.evaluate(js_call(npa['NPA_CH_FILL'], {
            'title': '彩排短标题·视频号 2026',
            'body': '第一段：彩排——视频号描述几步到位。\n第二段：后面接话题芯片。',
            'tags': ['引流获客', '副业思维'],
        })), ensure_ascii=False))

        print('== 等发表按钮亮（最多 4 分钟） ==')
        t0 = time.time()
        last = None
        while time.time() - t0 < 240:
            time.sleep(1)
            st = fr.evaluate(JS_STATE)
            line = json.dumps({k: st[k] for k in ('stitle', 'stitleErr', 'pub', 'busy')}, ensure_ascii=False)
            if line != last:
                print('  t+%4.0fs %s' % (time.time() - t0, line))
                last = line
            if st.get('pub') and not st['pub']['disabled']:
                break
        print('末态:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch3_ready.png', timeout=15000)

        print('== send(dry) ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_SEND'], {'dry': True})), ensure_ascii=False))
        print('页保持不关（留给后面联调/清理）')


if __name__ == '__main__':
    main()
