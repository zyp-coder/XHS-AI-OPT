# -*- coding: utf-8 -*-
"""e2e 铺数据（走控制台页）：预检 Edition/数据库 → 修空壳 xhsCase 库 →
铺 待发篇(np_notes) + 待发区料(np_pub_files + IDB blob) + 队列行/时间/过目开关。
到点执行路径：alarm → tick → 用缓存适配稿 → 三家 ✋过目（不点发布）。"""
import base64
import json
import sys
import time
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
ROOT = 'D:\\AIproject\\小红书运营'
VIDEO = ROOT + '\\资料\\视频\\客户模板样片\\演示片-六幕四版式.mp4'

NID = 'e2e20261009a'
DAYCODE = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][datetime.now().isoweekday() % 7]
KIND = '案例'
SLOT = 'w1:' + DAYCODE + ':' + KIND
LINE = SLOT + '|' + NID
DUE = datetime.now().timestamp() + 130  # 约 2 分钟后到点
DUE_HHMM = datetime.fromtimestamp(DUE).strftime('%H:%M')

NOTE_TITLE = '彩排篇·三平台过目'
DRAFT = ('这篇是发布链的彩排稿，用来把到点自动发这条通路从头到尾走一遍。\n'
         '第一段讲清楚：稿子会按三家的口径各自备一版。\n'
         '第二段讲清楚：到点以后会在发布前一步停下来，等人过目。')
ADAPTED = {
    'xhs': {'title': '彩排篇｜三平台过目',
            'body': '第一段：这是发布链的彩排稿，小红书版本。\n第二段：到点后会在发布前一步停下，等人过目。',
            'tags': ['#彩排', '#过目'], 'at': int(time.time() * 1000)},
    'douyin': {'title': '彩排篇·三平台过目',
               'body': '第一段：这是发布链的彩排稿，抖音版本。\n第二段：到点后会在发布前一步停下，等人过目。',
               'tags': ['#彩排', '#过目'], 'at': int(time.time() * 1000)},
    'channels': {'title': '彩排篇 视频号过目',
                 'body': '第一段：这是发布链的彩排稿，视频号版本。\n第二段：到点后会在发布前一步停下，等人过目。',
                 'tags': ['#彩排', '#过目'], 'at': int(time.time() * 1000)},
}

PREFLIGHT = r'''(async () => {
  const out = {};
  out.edition = (typeof Edition !== 'undefined') ? { ok: true, notePublish: Edition.hasFeature('notePublish') } : { ok: false };
  out.dbs = (indexedDB.databases ? await indexedDB.databases() : 'n/a');
  out.storeNames = await new Promise(res => {
    const req = indexedDB.open('xhsCase', 1);
    req.onsuccess = () => { const db = req.result; const names = [...db.objectStoreNames]; db.close(); res(names); };
    req.onerror = () => res('err');
  });
  out.alarms = await new Promise(res => { try { chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + x.scheduledTime))); } catch (e) { res('err:' + e); } });
  return out;
})()'''

JS_FIX_DB = r'''(async () => {
  const del = await new Promise(res => { const r = indexedDB.deleteDatabase('xhsCase'); r.onsuccess = () => res('deleted'); r.onerror = () => res('err'); r.onblocked = () => res('blocked'); });
  return del;
})()'''

JS_SEED = r'''((p) => {
  const idbPut = (key, blob) => new Promise((res, rej) => {
    const req = indexedDB.open('xhsCase', 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('case')) db.createObjectStore('case', { keyPath: 'key' }); };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('case', 'readwrite');
        tx.objectStore('case').put({ key: key, blob: blob, at: Date.now() });
        tx.oncomplete = () => { db.close(); res(true); };
        tx.onerror = () => { db.close(); rej(tx.error); };
      } catch (e) { db.close(); rej(e); }
    };
    req.onerror = () => rej(req.error);
  });
  return (async () => {
    const now = Date.now();
    const note = {
      id: p.nid, status: '待发', form: '视频', title: p.title, draft: p.draft,
      platform: 'xhs', createdAt: now, updatedAt: now,
      pub: { adapted: p.adapted },
    };
    const d = await chrome.storage.local.get(['np_notes', 'note_queue', 'np_queue_times', 'np_pub_watch', 'np_pub_files', 'np_pub_ran']);
    const notes = (Array.isArray(d.np_notes) ? d.np_notes : []).filter(n => String(n && n.id) !== p.nid);
    notes.unshift(note);
    const q = Object.assign({}, d.note_queue || {});
    q[p.slot] = [p.nid];
    const times = Object.assign({}, d.np_queue_times || {}); times[p.line] = p.dueHHMM;
    const watch = Object.assign({}, d.np_pub_watch || {}); watch[p.line] = true;
    const files = Object.assign({}, d.np_pub_files || {}); files[p.nid] = { kind: 'video', n: 1, need: 1 };
    const ran = Object.assign({}, d.np_pub_ran || {}); delete ran[p.line];
    await chrome.storage.local.set({
      np_notes: notes, note_queue: q, np_queue_times: times,
      np_pub_watch: watch, np_pub_files: files, np_pub_ran: ran,
    });
    return { notes: notes.length, files: Object.keys(files).length, watch: watch };
  })();
})'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        page = next((p for p in ctx.pages if p.url.startswith(CONSOLE_URL)), None)
        if not page:
            print('没有控制台页——先跑 _pubtest_console.py')
            return
        page.bring_to_front()

        print('== 预检 ==')
        pre = page.evaluate(PREFLIGHT)
        print(json.dumps(pre, ensure_ascii=False))

        if not (pre.get('edition') or {}).get('notePublish'):
            print('!! notePublish 闸门没开，tick 会直接返回——先查版本身份')
        if pre.get('storeNames') == []:
            print('xhsCase 是空壳库（无 case 存储）——删掉重建')
            print('  ', page.evaluate(JS_FIX_DB))
            chk = page.evaluate("(async () => { const r = await new Promise(res => { const q = indexedDB.open('xhsCase', 1); q.onupgradeneeded = () => { q.result.createObjectStore('case', { keyPath: 'key' }); }; q.onsuccess = () => { const db = q.result; const n = [...db.objectStoreNames]; db.close(); res(n); }; }); return r; })()")
            print('  重建后 store:', chk)

        print('== 铺字（storage） ==')
        print(json.dumps(page.evaluate(JS_SEED, {
            'nid': NID, 'title': NOTE_TITLE, 'draft': DRAFT, 'adapted': ADAPTED,
            'slot': SLOT, 'line': LINE, 'dueHHMM': DUE_HHMM,
        }), ensure_ascii=False))

        print('== 铺料（视频 → xhsCase pub:%s:0） ==' % NID)
        data = open(VIDEO, 'rb').read()
        b64 = base64.b64encode(data).decode('ascii')
        chunks = [b64[i:i + 3 * 1024 * 1024] for i in range(0, len(b64), 3 * 1024 * 1024)]
        page.evaluate("() => { window.__e2eBuf = []; return true; }")
        for ch in chunks:
            page.evaluate("(c) => { window.__e2eBuf.push(c); return window.__e2eBuf.length; }", ch)
        r = page.evaluate(r'''(async () => {
          const b64 = window.__e2eBuf.join(''); window.__e2eBuf = null;
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const file = new File([u8], '演示片-六幕四版式.mp4', { type: 'video/mp4' });
          const key = 'pub:%s:0';   // 真源键与 popup 交文件一致：不带 |名（名随 File 对象走）
          await new Promise((res, rej) => {
            const req = indexedDB.open('xhsCase', 1);
            req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('case')) db.createObjectStore('case', { keyPath: 'key' }); };
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction('case', 'readwrite');
              tx.objectStore('case').put({ key: key, blob: file, at: Date.now() });
              tx.oncomplete = () => { db.close(); res(true); };
              tx.onerror = () => { db.close(); rej(tx.error); };
            };
            req.onerror = () => rej(req.error);
          });
          const back = await new Promise(res => {
            const req = indexedDB.open('xhsCase', 1);
            req.onsuccess = () => {
              const db = req.result;
              const g = db.transaction('case', 'readonly').objectStore('case').get(key);
              g.onsuccess = () => { db.close(); res(g.result ? { size: g.result.blob.size, name: g.result.blob.name, type: g.result.blob.type } : null); };
              g.onerror = () => { db.close(); res('geterr'); };
            };
          });
          return back;
        })()''' % NID)
        print('落库回读:', r)

        print('== 落定后总览 ==')
        print(json.dumps(page.evaluate(r'''(async () => {
          const d = await chrome.storage.local.get(['np_notes','note_queue','np_queue_times','np_pub_watch','np_pub_files','np_pub_ran','np_pub_log']);
          const note = (d.np_notes || []).find(n => n && n.id === '%s') || null;
          return {
            note: note ? { id: note.id, status: note.status, form: note.form, adapted: Object.keys((note.pub||{}).adapted||{}) } : null,
            queue: d.note_queue, times: d.np_queue_times, watch: d.np_pub_watch,
            files: d.np_pub_files, ran: d.np_pub_ran, log: (d.np_pub_log||[]).length,
          };
        })()''' % NID), ensure_ascii=False, indent=1))
        print('到点时刻:', DUE_HHMM, '（约2分钟后；tick 由 alarm 拉起）')


if __name__ == '__main__':
    main()
