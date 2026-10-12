# -*- coding: utf-8 -*-
"""抖音：Playwright 可信点击「继续添加」→ filechooser 对照。"""
import sys, json, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright

JS_COUNT_FILES = "() => [...document.querySelectorAll('input[type=file]')].map(e => ({accept: e.accept, multiple: e.multiple, connected: e.isConnected}))"


def main():
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
        ctx = b.contexts[0]
        for p in ctx.pages:
            if 'creator.douyin.com' in p.url and 'post' in p.url:
                p.bring_to_front()
                time.sleep(0.4)
                print('before:', p.evaluate(JS_COUNT_FILES))
                try:
                    with p.expect_file_chooser(timeout=6000) as fc_info:
                        p.click('button:has-text("继续添加")', timeout=5000)
                    fc = fc_info.value
                    print('filechooser fired! multiple =', fc.is_multiple())
                    print('input now:', p.evaluate(JS_COUNT_FILES))
                    # 先不传文件，取消掉
                    fc.set_files([])
                    print('cancelled via set_files([])')
                    time.sleep(0.6)
                    print('after:', p.evaluate(JS_COUNT_FILES))
                except Exception as ex:
                    print('no filechooser:', type(ex).__name__, str(ex)[:200])
                    print('input now:', p.evaluate(JS_COUNT_FILES))
                    p.screenshot(path='tmp/pubtest_shots/douyin_real_click.png')
                return


if __name__ == '__main__':
    main()
