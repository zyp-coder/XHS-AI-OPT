# -*- coding: utf-8 -*-
"""发布队列状态摸底（只读）：CDP 唤扩展 SW → 对 SW 目标求值，dump np_pub_* 存储与待发区 blob 键。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

EXT_ID = 'eihbinbapmhgbohapphjmabbkgiflljd'
SW_URL = 'chrome-extension://' + EXT_ID + '/background.js'


def find_ext_sw(ctx, b, wake=True):
    """找扩展 SW（Playwright ServiceWorker 对象）；没有就开 popup.html 唤醒。返回 (sw, popped_tab_id)"""
    def find():
        return next((s for s in ctx.service_workers if s.url.startswith(SW_URL)), None)

    sw = find()
    popped = None
    if not sw and wake:
        sess = b.new_browser_cdp_session()
        popped = sess.send('Target.createTarget', {'url': 'chrome-extension://' + EXT_ID + '/popup.html'})['targetId']
        for _ in range(40):
            time.sleep(0.5)
            sw = find()
            if sw:
                break
    return sw, popped


JS = r'''(async () => {
  const d = await chrome.storage.local.get(null);
  const out = { flag: (typeof NP_PUB_BG_DELIVER_READY !== 'undefined') ? NP_PUB_BG_DELIVER_READY : 'n/a' };
  out.keys = Object.keys(d);
  const q = d.note_queue || {};
  out.queue = Object.keys(q).map(k => k + ' => ' + JSON.stringify(q[k]));
  const notes = d.np_notes || [];
  out.notes = (Array.isArray(notes) ? notes : []).map(n => ({
    id: n.id, status: n.status, form: n.form,
    title: String(n.title || '').slice(0, 20),
    adapted: (n.pub && n.pub.adapted) ? Object.keys(n.pub.adapted) : null,
  }));
  out.times = d.np_queue_times || {};
  out.watch = d.np_pub_watch || {};
  out.plats = d.np_pub_plats || {};
  out.filesMeta = d.np_pub_files || {};
  out.ran = d.np_pub_ran || {};
  out.log = (d.np_pub_log || []).slice(0, 3);
  out.blobs = await new Promise(res => {
    const req = indexedDB.open('xhsCase', 1);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('case', 'readonly');
        const all = tx.objectStore('case').getAllKeys();
        all.onsuccess = () => { res((all.result || []).map(String).filter(k => k.indexOf('pub:') === 0)); db.close(); };
        all.onerror = () => { res('keys-err'); db.close(); };
      } catch (e) { res('tx-err:' + e); }
    };
    req.onerror = () => res('db-err');
  });
  return out;
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        sw, popped = find_ext_sw(ctx, b)
        if not sw:
            print('SW 起不来，退出')
            return
        print('SW ok:', sw.url[:90], ('（开了 popup 唤醒）' if popped else '（本来就在）'))
        try:
            out = sw.evaluate(JS)
            print(json.dumps(out, ensure_ascii=False, indent=1)[:4000])
        finally:
            if popped:
                try:
                    b.new_browser_cdp_session().send('Target.closeTarget', {'targetId': popped})
                    print('（popup 已关）')
                except Exception:
                    pass


if __name__ == '__main__':
    main()
