# -*- coding: utf-8 -*-
"""抖音：hook showOpenFilePicker / input.click，真点击「继续添加」确认抖音用的哪条路。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

JS_HOOK = r'''(() => {
  window.__picker_calls = [];
  if (window.showOpenFilePicker) {
    const o = window.showOpenFilePicker;
    window.showOpenFilePicker = function(...a) {
      window.__picker_calls.push({fn: 'showOpenFilePicker', opts: JSON.stringify(a[0] || {}).slice(0, 200)});
      return o.apply(this, a);
    };
  } else {
    window.__picker_calls.push({fn: 'showOpenFilePicker-missing'});
  }
  const oc = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function(...a) {
    window.__picker_calls.push({fn: 'input.click', type: this.type, accept: this.accept || '', inDom: this.isConnected});
    return oc.apply(this, a);
  };
  return 'hooked';
})()'''


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                print(p.evaluate(JS_HOOK))
                try:
                    with p.expect_file_chooser(timeout=5000) as fc_info:
                        p.click('button:has-text("继续添加")', timeout=5000)
                    fc = fc_info.value
                    print('filechooser fired')
                    fc.set_files([])
                except Exception as ex:
                    print('fc err:', type(ex).__name__, str(ex)[:160])
                time.sleep(0.6)
                print('calls:', json.dumps(p.evaluate('() => window.__picker_calls'), ensure_ascii=False, indent=1))
                return


if __name__ == '__main__':
    main()
