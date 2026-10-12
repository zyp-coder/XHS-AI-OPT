# -*- coding: utf-8 -*-
"""视频号彩排·新标签页版：空表单 → 分片喂 → NPA_CH_UPLOAD（首传：无→有）→
NPA_CH_FILL（标题清洗版）→ 采样 → NPA_CH_SEND dry → 关页。绝不真发。"""
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
URL = 'https://channels.weixin.qq.com/platform/post/create'


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


def watch(page, fr, label, seconds):
    print(f'-- watch {label} ({seconds}s) --')
    last = None
    for i in range(int(seconds * 2)):
        time.sleep(0.5)
        line = json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False)
        if line != last:
            print(f'  t+{(i + 1) * 0.5:4.1f}s {line}')
            last = line


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


def main():
    npa = load_npa()
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        chpages = [p for p in ctx.pages if 'channels.weixin.qq.com/platform/post/create' in p.url]
        if not chpages:
            print('没有视频号页')
            return
        page = chpages[-1]
        page.bring_to_front()
        print('复用新标签页:', page.url)
        fr = None
        for _ in range(90):
            time.sleep(0.5)
            for f in page.frames:
                if '/micro/content/post/create' in (f.url or ''):
                    try:
                        if f.evaluate("!!document.querySelector('.input-editor, [class*=\"input-editor\"]')"):
                            fr = f
                            break
                    except Exception:
                        pass
            if fr:
                break
        if not fr:
            print('表单 frame 没出来')
            return
        print('frame ok:', fr.url)
        print('清弹窗:', json.dumps(fr.evaluate(JS_CLEAR_DLG), ensure_ascii=False))
        print('probe:', fr.evaluate('(' + npa['NPA_CH_PROBE_FRAME'] + ')()'))
        print('初始态:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch2_fresh.png')

        print('== 分片喂 ==')
        b64 = base64.b64encode(open(VIDEO, 'rb').read()).decode('ascii')
        chunks = [b64[i:i + 3 * 1024 * 1024] for i in range(0, len(b64), 3 * 1024 * 1024)]
        for i, ch in enumerate(chunks):
            r = fr.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': KEY, 'b64': ch, 'done': i == len(chunks) - 1}))
            print('  chunk', i, r)

        print('== 真传 ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_UPLOAD'], {'keys': [KEY]})), ensure_ascii=False))
        print('传后态:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch2_uploaded.png')

        print('== 填 ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_FILL'], {
            'title': '彩排短标题·视频号',
            'body': '第一段：彩排——视频号描述几步到位。\n第二段：后面接话题芯片。',
            'tags': ['引流获客', '副业思维'],
        })), ensure_ascii=False))
        watch(page, fr, '填后', 6)
        page.screenshot(path=f'{SHOTS}/ch2_filled.png')

        print('== send(dry) ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_SEND'], {'dry': True})), ensure_ascii=False))
        page.close()
        print('new tab closed')


if __name__ == '__main__':
    main()
