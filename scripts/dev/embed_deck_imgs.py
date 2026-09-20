# -*- coding: utf-8 -*-
"""动效演示 HTML 的配图：按幕裁切 → base64 内嵌（替换 <img id=...> 的 src，可重复执行）

幕2 用 求推荐1/2.jpg 的搜索页顶部（搜索框 + 笔记封面），幕7 用 个人实战.jpg 的指标行。
图片换新后重跑本脚本即可更新两个 HTML。
"""
import base64, pathlib, re
from PIL import Image

D = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
CROP_DIR = D / '配图'
CROP_DIR.mkdir(exist_ok=True)

CROPS = {
    'img-qiu3': ('求推荐3.jpg', (0, 0, 1280, 1010), '求推荐3-裁切.jpg'),
    'img-qiu2': ('求推荐2.jpg', (0, 0, 1280, 1010), '求推荐2-裁切.jpg'),
    'img-pf': ('个人实战.jpg', (0, 712, 1280, 1190), '个人实战-指标.jpg'),
    'img-pfcurve': ('个人实战.jpg', (0, 1752, 1280, 2310), '个人实战-曲线.jpg'),
}

uris = {}
for key, (name, box, outname) in CROPS.items():
    im = Image.open(D / name).convert('RGB').crop(box)
    p = CROP_DIR / outname
    im.save(p, quality=92)
    data = p.read_bytes()
    uris[key] = 'data:image/jpeg;base64,' + base64.b64encode(data).decode()
    print('%-9s %-24s %dx%d  %.0f KB' % (key, p.name, im.width, im.height, len(data) / 1024))

for f in ('AI雕兄-动效演示-竖屏.html', 'AI雕兄-动效演示.html'):
    p = D / f
    t = p.read_text(encoding='utf-8')
    for key, uri in uris.items():
        t, n = re.subn(r'(<img id="%s"[^>]*?src=")[^"]*(")' % key, lambda m: m.group(1) + uri + m.group(2), t)
        if n != 1:
            raise SystemExit('!! %s 中匹配到 %d 处 %s' % (f, n, key))
    p.write_text(t, encoding='utf-8')
    print('-> %s  %.0f KB' % (f, p.stat().st_size / 1024))
