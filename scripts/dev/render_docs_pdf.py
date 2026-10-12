# -*- coding: utf-8 -*-
"""把 资料/视频 下按 A4 排版的 HTML 渲染成 PDF，把 1080px 竖版海报渲染成 PNG（Playwright 无头 Chromium）。

A4 文档：页面里每屏都是一个 .page（210×297mm，page-break-after），所以改完 HTML 重跑即可。
竖版海报：html/body 定宽 1080px，整张就是 .page / .poster 一个元素，元素截图即为成图（背景在 body 上，会一起截进去）。
演示稿 mock：演示稿/scene*.html 是一整屏 1280×900 的模拟界面，整屏截图落到 pdf素材/（供 推广PDF.html 引用）。

用法：
    python3 scripts/dev/render_docs_pdf.py                  # 渲染 JOBS + POSTERS + SCENES 里的全部
    python3 scripts/dev/render_docs_pdf.py 推广PDF           # 只渲染文件名含该关键词的
    python3 scripts/dev/render_docs_pdf.py --preview        # A4 额外逐页存 PNG（前 2 页 + 末页，自检用）
"""
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / '资料' / '视频'

# (源 HTML, 输出 PDF)，A4 多页文档
JOBS = [
    ('推广PDF.html', '推广PDF.pdf'),
    ('功能演示.html', '功能演示.pdf'),
]

# (源 HTML, 输出 PNG, 整张图的容器选择器)，1080px 竖版海报 / 笔记配图
POSTERS = [
    ('配图1-痛点.html', '配图1-痛点.png', '.page'),
    ('配图2-断症.html', '配图2-断症.png', '.page'),
    ('配图3-练剑.html', '配图3-练剑.png', '.page'),
    ('配图4-截流复盘.html', '配图4-截流复盘.png', '.page'),
    ('商业海报.html', '商业海报.png', '.poster'),
    ('商业海报.html', '商业海报.pdf', None),
]

# (源 HTML, 输出 PNG)，1280×900 演示稿整屏截图
SCENES = [
    ('演示稿/scene1-note.html', 'pdf素材/scene1-note.png'),
    ('演示稿/scene2-popup.html', 'pdf素材/scene2-popup.png'),
    ('演示稿/scene3-autowater.html', 'pdf素材/scene3-autowater.png'),
]


def save_pdf(page, o):
    """直接写正式名会被看图器/WPS 的句柄搞成 EINVAL，临时名必须放同目录（跨盘 replace 会 WinError 17）。"""
    tmp = o.with_name(o.name + '.new')
    err = None
    for attempt in range(5):
        try:
            page.pdf(path=str(tmp), prefer_css_page_size=True, print_background=True)
            os.replace(tmp, o)
            return o.stat().st_size
        except Exception as e:
            err = e
            try:
                tmp.unlink()
            except OSError:
                pass
            page.wait_for_timeout(800)
    raise err


def render(page, src, out, preview):
    s = DOCS / src
    if not s.exists():
        print('缺源文件:', s)
        return
    page.goto(s.as_uri(), wait_until='load')
    page.wait_for_timeout(500)          # 等图片解码与字体测量
    o = DOCS / out
    size = save_pdf(page, o)
    print(f'  {src} -> {out}  {size // 1024} KB')
    if not preview:
        return
    n = page.locator('.page').count()
    picks = [0] if n < 3 else [0, 1, n - 1]
    for i in picks:
        png = DOCS / f'_预览-{o.stem}-第{i + 1}页.png'
        page.locator('.page').nth(i).screenshot(path=str(png))
        print('   预览:', png.name)


def shoot(page, src, out, sel, pdf=False):
    """海报出图：整张图就是一个容器元素，元素截图即成品（Windows 上目标被看图器占用会 EINVAL，先写临时名再换）。"""
    s = DOCS / src
    if not s.exists():
        print('缺源文件:', s)
        return
    page.goto(s.as_uri(), wait_until='load')
    page.wait_for_timeout(500)
    o = DOCS / out
    if pdf:
        print(f'  {src} -> {out}  {save_pdf(page, o) // 1024} KB')
        return
    tmp = o.with_name(o.stem + '.tmp.png')      # 扩展名要留着，Playwright 靠它判格式
    for attempt in range(5):
        try:
            page.locator(sel).first.screenshot(path=str(tmp))
            os.replace(tmp, o)
            box = page.locator(sel).first.bounding_box()
            print(f'  {src} -> {out}  {round(box["width"])}×{round(box["height"])}  {o.stat().st_size // 1024} KB')
            return
        except Exception as e:
            try:
                tmp.unlink()
            except OSError:
                pass
            if attempt == 4:
                print('  失败:', out, str(e)[:140])
            else:
                page.wait_for_timeout(800)


def shoot_scene(page, src, out):
    """演示稿 mock → 整屏 PNG（固定 1280×900 视口，整页截，不裁）。"""
    s = DOCS / src
    if not s.exists():
        print('缺源文件:', s)
        return
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(s.as_uri(), wait_until='load')
    page.wait_for_timeout(400)
    o = DOCS / out
    tmp = o.with_name(o.stem + '.tmp.png')
    err = None
    for attempt in range(5):
        try:
            page.screenshot(path=str(tmp), full_page=True)
            os.replace(tmp, o)
            box = page.evaluate('() => [document.body.scrollWidth, document.body.scrollHeight]')
            print(f'  {src} -> {out}  {box[0]}×{box[1]}  {o.stat().st_size // 1024} KB')
            return
        except Exception as e:
            err = e
            try:
                tmp.unlink()
            except OSError:
                pass
            page.wait_for_timeout(800)
    print('  失败:', out, str(err)[:140])


def main():
    keys = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview = '--preview' in sys.argv
    jobs = [j for j in JOBS if not keys or any(k in j[0] for k in keys)]
    posters = [p for p in POSTERS if not keys or any(k in p[0] for k in keys)]
    scenes = [s for s in SCENES if not keys or any(k in s[0] for k in keys)]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1240, 'height': 1754})
        for src, out in jobs:
            render(page, src, out, preview)
        if posters:
            page.set_viewport_size({'width': 1080, 'height': 900})
            for src, out, sel in posters:
                shoot(page, src, out, sel, pdf=not sel)
        for src, out in scenes:
            shoot_scene(page, src, out)
        browser.close()


main()
