# -*- coding: utf-8 -*-
"""把 资料/推广物料/*.html 渲染成可印刷的 PDF + 预览 PNG。

每份 HTML 是一套物料的两面（第 1 页正面、第 2 页背面）。两套物料的默认主题不同：
    A4传单 —— 默认黑白（自己大批量打省钱），彩色是备选（<body> 加 class="color"）：
        A4传单-黑白.pdf / -黑白-{正面,背面}.png     ← 默认主题，白底黑字
        A4传单-彩色.pdf / -彩色-{正面,背面}.png     ← 深色底 + 金色
        A4传单-出血版.pdf                           ← 彩色 + 四周各加 3mm 出血
    名片 —— 默认白底黑字（<body> 自带 class="bw"），深色底 + 金色是备选（去掉 body 的 class）：
        名片-白底.pdf / -白底-{正面,背面}.png       ← 默认主题，白底黑字
        名片-出血版.pdf                             ← 白底 + 四周各加 3mm 出血

改完 HTML 或换完二维码，重跑本脚本即可：
    python3 scripts/dev/render_promo.py
"""
import os
import pathlib
import re
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / '资料' / '推广物料'
OUT = SRC / '输出'
SCALE = 300 / 96   # 300dpi
PNG_ONLY = bool(os.environ.get('PROMO_PNG_ONLY'))   # 置 1 只出预览 PNG、不写 PDF（二维码未齐时用）

A4_BLEED = ':root{--pw:216mm;--ph:303mm;--px:15mm;--py:14mm;}@page{size:216mm 303mm;}'
CARD_BLEED = ':root{--cw:96mm;--ch:60mm;--cx:7.6mm;--cy:7mm;}@page{size:96mm 60mm;}'

# (源文件, 输出前缀, 正反面标签, 变体清单)
# 变体：(后缀, 注入 CSS, 给 body 加的 class, 是否出 PNG 预览)
JOBS = [
    ('A4传单.html', 'A4传单', ('正面', '背面'), [
        ('黑白', None, None, True),            # 传单默认（不加任何类）就是黑白版
        ('彩色', None, 'color', True),
        ('出血版', A4_BLEED, 'color', False),   # 出血只对彩色版有意义（满版深色底）
    ]),
    ('名片.html', '名片', ('正面', '背面'), [
        ('白底', None, None, True),            # 名片默认（HTML 的 <body> 已带 class="bw"）就是白底版
        ('出血版', CARD_BLEED, None, False),   # 白底 + 出血，印刷厂用
    ]),
]


def pdf_pages(path: pathlib.Path) -> int:
    return len(re.findall(rb'/Type\s*/Page[^s]', path.read_bytes()))


def save_png(locator, path: pathlib.Path) -> None:
    """截图写 PNG。整轮渲染中偶发 OSError(Errno 22)（文件没锁、单跑正常），
    退回内存缓冲写盘并重试，别让一个文件中断整轮渲染。"""
    try:
        locator.screenshot(path=str(path))
        return
    except OSError:
        data = locator.screenshot()
    for attempt in range(3):
        try:
            path.write_bytes(data)
            return
        except OSError:
            if attempt == 2:
                raise
            time.sleep(1.0)


def save_pdf(page, path: pathlib.Path) -> pathlib.Path:
    """PDF 被阅读器（如 WPS）占用时写 .new，已关掉的走替换，返回最新内容所在的文件。

    占用时抛的异常不固定：独占锁是 PermissionError，WPS 打开中的文件是 OSError(Errno 22)，
    两种都按「被占用」处理，别让一个文件中断整轮渲染。
    """
    try:
        page.pdf(path=str(path), prefer_css_page_size=True, print_background=True)
        return path
    except OSError:
        tmp = path.with_suffix('.pdf.new')
        page.pdf(path=str(tmp), prefer_css_page_size=True, print_background=True)
        try:
            os.replace(tmp, path)
            return path
        except OSError:
            print('  ！%s 被占用，新内容已写到 %s（关掉占用程序后改回原名即可）' % (path.name, tmp.name))
            return tmp


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for html_name, out_name, sides, variant_list in JOBS:
            src = SRC / html_name
            for tag, css, body_class, want_png in variant_list:
                page = browser.new_page(viewport={'width': 900, 'height': 1300},
                                        device_scale_factor=SCALE)
                page.goto(src.as_uri(), wait_until='load')
                if css:
                    page.add_style_tag(content=css)
                if body_class:
                    page.evaluate('(c) => document.body.classList.add(c)', body_class)
                page.emulate_media(media='print')
                page.wait_for_timeout(400)

                images = page.locator('.page, .card')
                n = images.count()
                overflow = page.evaluate(
                    "() => [...document.querySelectorAll('.page, .card')]"
                    ".map((e, i) => [i + 1, e.scrollHeight - e.clientHeight])"
                    ".filter(([, d]) => d > 2)")
                if overflow:
                    print('  ！溢出：第 %s 面超出 %spx'
                          % (', '.join(str(i) for i, _ in overflow), ', '.join(str(d) for _, d in overflow)))
                if want_png:
                    for i in range(n):
                        label = sides[i] if i < len(sides) else str(i + 1)
                        save_png(images.nth(i),
                                 OUT / ('%s-%s-%s.png' % (out_name, tag, label)))
                if PNG_ONLY:
                    print('%s-%s: %d 面, 仅出 PNG（PROMO_PNG_ONLY=1）%s'
                          % (out_name, tag, n, '' if not overflow else ' ！有溢出'))
                    page.close()
                    continue
                pdf = OUT / ('%s-%s.pdf' % (out_name, tag))
                written = save_pdf(page, pdf)
                pages = pdf_pages(written)
                flag = 'OK' if pages == n else '！页数异常'
                print('%s-%s: %d 面, PDF %d 页 %s%s'
                      % (out_name, tag, n, pages, flag, '' if not overflow else ' ！有溢出'))
                page.close()
        browser.close()
    print('输出目录:', OUT)


if __name__ == '__main__':
    main()
