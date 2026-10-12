# -*- coding: utf-8 -*-
"""e2e 修复（首跑踩坑后）：seed 把 blob 写在了 pub:<id>:0|名（多带后缀）→ 后台真源键是 pub:<id>:0。
本脚本：挪键 → 清 np_pub_ran/np_pub_log（首跑已被记成「今天跑过」）→ npPubRearm → 看闹钟。"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
CONSOLE_URL = 'chrome-extension://' + EXT_ID + '/popup.html'
NID = 'e2e20261009a'
LINE = 'w1:fri:案例|' + NID
WRONG_KEY = 'pub:' + NID + ':0|演示片-六幕四版式.mp4'
RIGHT_KEY = 'pub:' + NID + ':0'

JS_STATE = r'''(async () => {
  const d = await chrome.storage.local.get(['np_notes','np_pub_ran','np_pub_log','np_pub_files','np_pub_watch','np_pub_plats','np_queue_times']);
  const note = (d.np_notes || []).find(n => n && n.id === NID_) || null;
  return {
    status: note ? note.status : 'GONE',
    ran: d.np_pub_ran, logN: (d.np_pub_log || []).length,
    files: d.np_pub_files, watch: d.np_pub_watch,
    plats: d.np_pub_plats || {}, times: d.np_queue_times,
  };
})()'''.replace('NID_', "'" + NID + "'")

JS_MOVE = r'''(async (p) => {
  const openDb = () => new Promise((res, rej) => {
    const req = indexedDB.open('xhsCase', 1);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await openDb();
  const get = (key) => new Promise((res, rej) => {
    const g = db.transaction('case', 'readonly').objectStore('case').get(key);
    g.onsuccess = () => res(g.result || null);
    g.onerror = () => rej(g.error);
  });
  const put = (rec) => new Promise((res, rej) => {
    const tx = db.transaction('case', 'readwrite');
    tx.objectStore('case').put(rec);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
  const del = (key) => new Promise((res, rej) => {
    const tx = db.transaction('case', 'readwrite');
    tx.objectStore('case').delete(key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
  const out = { before: [], after: [] };
  out.before = await new Promise(res => {
    const g = db.transaction('case', 'readonly').objectStore('case').getAllKeys();
    g.onsuccess = () => res(g.result.map(k => String(k)));
  });
  const rec = await get(p.wrong);
  if (!rec || !rec.blob) { out.err = 'wrong key 没料'; db.close(); return out; }
  await put({ key: p.right, blob: rec.blob, at: Date.now() });
  await del(p.wrong);
  const back = await get(p.right);
  out.moved = back && back.blob ? { size: back.blob.size, name: back.blob.name, type: back.blob.type } : null;
  out.after = await new Promise(res => {
    const g = db.transaction('case', 'readonly').objectStore('case').getAllKeys();
    g.onsuccess = () => res(g.result.map(k => String(k)));
  });
  db.close();
  return out;
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

        print('== 修前 ==')
        print(json.dumps(page.evaluate(JS_STATE), ensure_ascii=False, indent=1))

        print('== IDB 挪键 ==')
        print(json.dumps(page.evaluate(JS_MOVE, {'wrong': WRONG_KEY, 'right': RIGHT_KEY}), ensure_ascii=False, indent=1))

        print('== 清 ran/log ==')
        r = page.evaluate(r'''(async (p) => {
          const d = await chrome.storage.local.get(['np_pub_ran', 'np_pub_log']);
          const ran = Object.assign({}, d.np_pub_ran || {}); delete ran[p.line];
          await chrome.storage.local.set({ np_pub_ran: ran, np_pub_log: [] });
          const d2 = await chrome.storage.local.get(['np_pub_ran', 'np_pub_log']);
          return { ran: d2.np_pub_ran, logN: (d2.np_pub_log || []).length };
        })()''', {'line': LINE})
        print(json.dumps(r, ensure_ascii=False))

        print('== npPubRearm ==')
        print(' ', page.evaluate("async () => { try { return await chrome.runtime.sendMessage({ action: 'npPubRearm' }); } catch (e) { return 'ERR:' + e; } }"))
        import time
        time.sleep(1)
        print('  闹钟:', page.evaluate("async () => await new Promise(res => chrome.alarms.getAll(a => res(a.map(x => x.name + '@' + new Date(x.scheduledTime).toTimeString().slice(0, 8)))))"))

        print('== 修后 ==')
        print(json.dumps(page.evaluate(JS_STATE), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
