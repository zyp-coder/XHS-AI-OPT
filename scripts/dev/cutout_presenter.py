# -*- coding: utf-8 -*-
"""半身像完整处理链：去水印 → 抠浅色背景 → 底部渐隐 → 镜像 → 输出 png/webp
   改图后依次跑本脚本 + embed_presenter.py 即可更新两个 HTML 里的形象。"""
import os, pathlib
import numpy as np
from PIL import Image, ImageFilter

D = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
SRC = D / 'a1457d8df2bf809057b56a38ef5009a9.jpg'
PNG = D / 'AI雕兄-形象-透明.png'
WEBP = D / 'AI雕兄-形象-透明.webp'

# ── 1 抠图：从四边向内传播，吃掉与边缘连通的浅色区域（含投影和右下角水印）
im = Image.open(SRC).convert('RGB')
W, H = im.size
a = np.asarray(im).astype(np.int16)
lum = a.mean(axis=2)
sat = a.max(axis=2) - a.min(axis=2)
bg_like = ((lum > 140) & (sat < 30)) | ((lum > 150) & (sat < 22))

seed = np.zeros((H, W), bool)
seed[0, :] = seed[-1, :] = True
seed[:, 0] = seed[:, -1] = True
region = seed & bg_like
for i in range(4000):
    grow = region.copy()
    grow[1:, :] |= region[:-1, :]
    grow[:-1, :] |= region[1:, :]
    grow[:, 1:] |= region[:, :-1]
    grow[:, :-1] |= region[:, 1:]
    grow &= bg_like
    if grow.sum() == region.sum():
        break
    region = grow

alpha = Image.fromarray(np.where(region, 0, 255).astype(np.uint8), 'L')
alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
out = im.convert('RGBA')
out.putalpha(alpha)
out = out.transpose(Image.FLIP_LEFT_RIGHT)      # 镜像：让他朝向画面中心

# ── 2 底部渐隐：躯干自然融进背景
w, h = out.size
arr = np.asarray(out).astype(np.float32)
from_i = int(h * 0.86)
ramp = np.ones(h, np.float32)
ramp[from_i:] = np.linspace(1, 0, h - from_i) ** 1.5
arr[:, :, 3] *= ramp[:, None]
out = Image.fromarray(arr.astype(np.uint8), 'RGBA').resize((720, int(720 * h / w)), Image.LANCZOS)

out.save(PNG, optimize=True)
out.save(WEBP, quality=92, method=6)
print('bg removed %.1f%% (iters %d)' % (region.mean() * 100, i))
print('out', out.size, '| png %.0f KB | webp %.0f KB' % (os.path.getsize(PNG) / 1024, os.path.getsize(WEBP) / 1024))
