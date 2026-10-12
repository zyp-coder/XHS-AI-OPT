# -*- coding: utf-8 -*-
"""一眼验：chrome.windows.create 的 state:'maximized' 在这台机器上到底吃不吃。
跑法：python3 scripts/dev/_probe_maximize.py
"""
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
EXT = pathlib.Path(__file__).resolve().parents[2] / 'extension'

PROBE = r'''async () => {
  const out = [];
  const url = chrome.runtime.getURL('popup.html?mode=big&tabId=0');
  const mk = async (opts) => {
    const w = await chrome.windows.create(Object.assign({ url: url, type: 'popup' }, opts));
    const id = w.id;
    await new Promise(r => setTimeout(r, 500));
    let a = await chrome.windows.get(id);
    out.push({ opts: JSON.stringify(opts), after: a.state, w: a.width, h: a.height, l: a.left, t: a.top });
    try {
      await chrome.windows.update(id, { state: 'maximized' });
      await new Promise(r => setTimeout(r, 500));
      a = await chrome.windows.get(id);
      out.push({ step: 'update→maximized', state: a.state, w: a.width, h: a.height });
    } catch (e) { out.push({ step: 'update→maximized', err: String(e) }); }
    await chrome.windows.remove(id);
    return null;
  };
  const wi = await chrome.windows.getCurrent();
  out.push({ step: 'current', state: wi.state, w: wi.width, h: wi.height });
  await mk({ state: 'maximized' });
  await mk({ width: 1160, height: 900 });
  const w2 = await chrome.windows.create({ url: url, type: 'popup' });
  for (let i = 0; i < 4; i++) {
    const r = await chrome.windows.update(w2.id, { state: 'maximized' });
    const g = await chrome.windows.get(w2.id);
    out.push({ step: 'immediate#' + i, retState: r && r.state, getState: g.state, w: g.width, h: g.height });
    await new Promise(r2 => setTimeout(r2, 220));
  }
  await chrome.windows.remove(w2.id);
  return out;
}'''

with tempfile.TemporaryDirectory(prefix='xhs-max-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        for row in sw.evaluate(PROBE):
            print(row, flush=True)
    finally:
        ctx.close()
