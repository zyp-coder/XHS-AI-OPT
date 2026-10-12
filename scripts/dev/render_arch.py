# -*- coding: utf-8 -*-
"""渲染落地页配图：资料/推广物料/*.html → assets/*.png（2x）。

默认渲染「功能架构图」（改完 HTML 重跑本脚本即可盖正式图）：
    python3 scripts/dev/render_arch.py            # 盖 assets/功能架构图.png
    python3 scripts/dev/render_arch.py <输出路径>  # 出到指定路径（预览用，不动正式图）
指定源与输出（相对路径按仓库根解析）：
    python3 scripts/dev/render_arch.py --src 资料/推广物料/功能总览.html --out .tmpcheck/_预览.png
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SRC = ROOT / "资料/推广物料/功能架构图.html"
DEFAULT_OUT = ROOT / "资料/推广物料/assets/功能架构图.png"


def _resolve(p):
    path = Path(p)
    return path if path.is_absolute() else (ROOT / path).resolve()


def main():
    args = sys.argv[1:]
    src = DEFAULT_SRC
    out = None
    i = 0
    while i < len(args):
        if args[i] == "--src" and i + 1 < len(args):
            src = _resolve(args[i + 1])
            i += 2
        elif args[i] == "--out" and i + 1 < len(args):
            out = _resolve(args[i + 1])
            i += 2
        else:
            out = _resolve(args[i])
            i += 1
    if out is None:
        out = DEFAULT_OUT

    out.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1000, "height": 1200}, device_scale_factor=2)
        page.goto(src.as_uri(), wait_until="load")
        page.wait_for_timeout(300)
        sheet = page.locator(".sheet")
        box = sheet.bounding_box()
        sheet.screenshot(path=str(out))
        browser.close()
    print("输出: %s（%.0fx%.0f @2x）" % (out, box["width"], box["height"]))


main()
