# -*- coding: utf-8 -*-
"""视频号彩排：删除旧视频 → 空表单 → 分片喂演示片 → NPA_CH_UPLOAD →
NPA_CH_FILL（描述+话题芯片）→ 采样稳定性 → NPA_CH_SEND dry。绝不真发。"""
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
KEY = 'pub:test:ch0|演示片-六幕四版式.mp4'


def load_npa():
    out = subprocess.check_output(['node', 'scripts/dev/_npa_dump.js'], cwd=ROOT)
    return json.loads(out.decode('utf-8'))


def js_call(fn_src, arg):
    return '(' + fn_src + ')(' + json.dumps(arg, ensure_ascii=True) + ')'


JS_DEL = r'''(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const btns = [...document.querySelectorAll('button,div,span')].filter(e => {
    const t = (e.innerText || '').trim();
    return t === '删除' && e.children.length <= 1 && vis(e);
  });
  if (!btns.length) return { ok: false, msg: '没见删除按钮' };
  const el = btns[0];
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  await sleep(900);
  /* 可能弹确认框 */
  const dlg = [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="modal"]')].filter(vis)
    .map(d => ({ cls: String(d.className).slice(0, 60), t: (d.innerText || '').replace(/\n/g, '|').slice(0, 80) }));
  const okBtns = [...document.querySelectorAll('button')].filter(e => {
    const t = (e.innerText || '').trim();
    return (t === '确定' || t === '确认' || t === '删除') && vis(e) && e !== el;
  });
  if (okBtns.length) {
    const b = okBtns[okBtns.length - 1];
    const r2 = b.getBoundingClientRect();
    const o2 = { bubbles: true, cancelable: true, clientX: r2.x + r2.width / 2, clientY: r2.y + r2.height / 2, view: window };
    b.dispatchEvent(new PointerEvent('pointerdown', o2));
    b.dispatchEvent(new MouseEvent('mousedown', o2));
    b.dispatchEvent(new PointerEvent('pointerup', o2));
    b.dispatchEvent(new MouseEvent('mouseup', o2));
    b.dispatchEvent(new MouseEvent('click', o2));
    await sleep(900);
    return { ok: true, dialog: dlg, confirmed: (b.innerText || '').trim() };
  }
  return { ok: true, dialog: dlg, confirmed: null };
})()'''

JS_STATE = r'''(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const v = document.querySelector('video');
  const ed = [...document.querySelectorAll('[contenteditable]')].filter(vis)[0];
  const topics = ed ? [...ed.querySelectorAll('span')].filter(s => /topic|hl/i.test(String(s.className)))
    .map(s => String(s.className).slice(0, 30) + '::' + (s.textContent || '').slice(0, 24)) : [];
  const pub = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === '发表');
  const tip = (document.body.innerText || '');
  return {
    video: v ? { src: String(v.currentSrc || v.src).slice(0, 40), w: v.videoWidth, h: v.videoHeight, dur: Math.round((v.duration || 0) * 10) / 10 } : null,
    edText: ed ? (ed.textContent || '').replace(/\u200b/g, '').slice(0, 120) : null,
    topics,
    pub: pub ? { disabled: !!pub.disabled, cls: String(pub.className).slice(0, 50) } : null,
    uploading: /上传中|处理中|转码/.test(tip) ? tip.match(/.{0,12}(上传中|处理中|转码).{0,12}/)[0] : null,
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


def main():
    npa = load_npa()
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next(p for p in ctx.pages if 'channels.weixin.qq.com/platform/post/create' in p.url)
        page.bring_to_front()
        time.sleep(0.5)
        fr = next(f for f in page.frames if '/micro/content/post/create' in (f.url or ''))
        print('frame ok:', fr.url)

        print('probe:', fr.evaluate('(' + npa['NPA_CH_PROBE_FRAME'] + ')()'))

        print('== ① 删旧视频 ==', json.dumps(fr.evaluate(JS_DEL), ensure_ascii=False))
        time.sleep(1)
        print('state:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch_after_del.png')

        print('== ② 分片喂 ==')
        b64 = base64.b64encode(open(VIDEO, 'rb').read()).decode('ascii')
        chunks = [b64[i:i + 3 * 1024 * 1024] for i in range(0, len(b64), 3 * 1024 * 1024)]
        for i, ch in enumerate(chunks):
            r = fr.evaluate(js_call(npa['NPA_BUF_ADD'], {'key': KEY, 'b64': ch, 'done': i == len(chunks) - 1}))
            print('  chunk', i, r)

        print('== ③ 真传 ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_UPLOAD'], {'keys': [KEY]})), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch_uploaded.png')
        print('state:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))

        print('== ④ 等发表亮 ==')
        for i in range(120):
            st = fr.evaluate(JS_STATE)
            if st['pub'] and not st['pub']['disabled']:
                print('  pub enabled at t+%ds' % i)
                break
            time.sleep(1)
        print('state:', json.dumps(fr.evaluate(JS_STATE), ensure_ascii=False))
        page.screenshot(path=f'{SHOTS}/ch_ready.png')

        print('== ⑤ 填 ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_FILL'], {
            'title': '彩排短标题·视频号',
            'body': '第一段：彩排——视频号描述几步到位。\n第二段：后面接话题芯片。',
            'tags': ['引流获客', '副业思维'],
        })), ensure_ascii=False))
        watch(page, fr, '填后', 6)
        page.screenshot(path=f'{SHOTS}/ch_filled.png')

        print('== ⑥ send(dry) ==', json.dumps(fr.evaluate(js_call(npa['NPA_CH_SEND'], {'dry': True})), ensure_ascii=False))


if __name__ == '__main__':
    main()
