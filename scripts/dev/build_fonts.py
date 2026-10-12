# -*- coding: utf-8 -*-
"""把系统里的 OFL 字体子集化，做成随扩展分发的小体积 woff2。

为什么要子集：整字重可变字体 17~25MB，扩展不能这么胖。只留 GB2312 全字表 + 常用标点符号，
一个文件覆盖 wght 100~900 全部字重（可变字体，不用按字重拆文件）。

为什么不用 HarmonyOS Sans：它的授权只许「免费商用 + 随软件嵌入」，**禁止修改（子集化算修改）
与单独分发**，所以打包进付费扩展不合规。Noto Sans/Serif SC 是 OFL 1.1（明文允许修改与再分发，
须随附授权文本、不得单独售卖字体）。楷体同理不能打包，代码里继续用系统 KaiTi/STKaiti。

用法：
  python3 scripts/dev/build_fonts.py              # 出到 资料/视频/客户模板样片/fonts/
  python3 scripts/dev/build_fonts.py --out extension/fonts
"""
import argparse
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # Windows 控制台默认 GBK
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / '资料' / '视频' / '客户模板样片' / 'fonts'
SYS_FONTS = {
    'NotoSansSC-VF.ttf': 'C:/Windows/Fonts/NotoSansSC-VF.ttf',
    'NotoSerifSC-VF.ttf': 'C:/Windows/Fonts/NotoSerifSC-VF.ttf',
}
# 出片自己会用到、但 GB2312 里没有的字符（破折号、弯引号、省略号、圈码…）
EXTRA = ('—–‘’“”…·×÷°′″①②③④⑤⑥⑦⑧⑨⑩★☆●○■□▲△◆◇→←↑↓√✓✗'
         '【】〔〕〈〉《》「」『』〖〗　、。，．；：？！（）')
ASCII = ''.join(chr(c) for c in range(0x20, 0x7F))
RANGES = [  # Latin-1 / 常用标点 / 圈码序号 / 箭头 / 几何 / 数学 / 全角
    (0x00A0, 0x00FF), (0x2000, 0x206F), (0x2190, 0x21FF), (0x2460, 0x24FF),
    (0x25A0, 0x25FF), (0x2605, 0x2606), (0x3000, 0x303F), (0xFF00, 0xFFEF),
]


def gb2312_chars():
    """GB2312 全字表（6763 汉字 + 符号），离线生成，不依赖任何词表文件。"""
    out = set()
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return out


def charset():
    chars = set(ASCII) | gb2312_chars() | set(EXTRA)
    for a, b in RANGES:
        chars |= {chr(c) for c in range(a, b + 1)}
    return ''.join(sorted(chars))


def build(src: Path, dst: Path, text: str):
    opts = subset.Options()
    opts.flavor = 'woff2'          # 浏览器原生支持，比 ttf 小 ~40%
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_legacy = True
    opts.name_languages = ['*']
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.drop_tables = []
    font = TTFont(str(src))
    sub = subset.Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)
    dst.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(dst))
    font.close()
    return dst.stat().st_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    a = ap.parse_args()
    out = Path(a.out)
    if not out.is_absolute():
        out = ROOT / out

    text = charset()
    print(f'字表 {len(text)} 字符（GB2312 全表 + 标点符号 + ASCII）')
    total = 0
    for name, src in SYS_FONTS.items():
        src_p = Path(src)
        if not src_p.exists():
            raise SystemExit(f'找不到源字体 {src_p}')
        dst = out / name.replace('-VF.ttf', '-subset.woff2').replace('NotoSansSC', 'NotoSansSC')
        size = build(src_p, dst, text)
        total += size
        print(f'  {dst.name:26s} {size / 1048576:.2f}MB  （源 {src_p.stat().st_size / 1048576:.1f}MB）')
    print(f'合计 {total / 1048576:.2f}MB → {out}')


if __name__ == '__main__':
    main()
