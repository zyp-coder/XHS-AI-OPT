# -*- coding: utf-8 -*-
"""把 资料/视频 下按 A4 排版的 HTML 渲染成 PDF（Playwright 无头 Chromium，打印背景 + 页面自带 @page 尺寸）。

页面里每屏都是一个 .page（210×297mm，page-break-after），所以改完 HTML 重跑本脚本即可：
    python3 scripts/dev/render_docs_pdf.py                  # 渲染 JOBS 里的全部
    python3 scripts/dev/render_docs_pdf.py 推广PDF           # 只渲染文件名含该关键词的
    python3 scripts/dev/render_docs_pdf.py --preview        # 额外逐页存 PNG（前 2 页 + 末页，自检用）
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / '资料' / '视频'

# (源 HTML, 输出 PDF)，都在 资料/视频 下
JOBS = [
    ('推广PDF.html', '推广PDF.pdf'),
    ('功能演示.html', '功能演示.pdf'),
]


def render(page, src, out, preview):
    s = DOCS / src
    if not s.exists():
        print('缺源文件:', s)
        return
    page.goto(s.as_uri(), wait_until='load')
    page.wait_for_timeout(500)          # 等图片解码与字体测量
    o = DOCS / out
    page.pdf(path=str(o), prefer_css_page_size=True, print_background=True)
    print(f'  {src} -> {out}  {o.stat().st_size // 1024} KB')
    if not preview:
        return
    n = page.locator('.page').count()
    picks = [0] if n < 3 else [0, 1, n - 1]
    for i in picks:
        png = DOCS / f'_预览-{o.stem}-第{i + 1}页.png'
        page.locator('.page').nth(i).screenshot(path=str(png))
        print('   预览:', png.name)


def main():
    keys = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview = '--preview' in sys.argv
    jobs = [j for j in JOBS if not keys or any(k in j[0] for k in keys)]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1240, 'height': 1754})
        for src, out in jobs:
            render(page, src, out, preview)
        browser.close()


main()
