# -*- coding: utf-8 -*-
"""生成推广物料用的两个二维码 + 实证图裁切。

视频码：由 VIDEO_URL 生成。换成真实链接后重跑本脚本，再跑 render_promo.py 重出物料即可。
        链接里含 example.com 时会在码上盖「待替换 勿印」警示条，防止拿占位码去印。
微信码：个人微信二维码无法程序生成——把微信 App「我的二维码」保存成
        assets/qr-wechat.png（正方形、白底）放进来即可；文件不存在时画占位图。
用法：
    python3 scripts/dev/gen_promo_qr.py
    python3 scripts/dev/gen_promo_qr.py --video-url "https://..."
"""
import argparse
import pathlib

import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
ASSETS = ROOT / '资料' / '推广物料' / 'assets'

VIDEO_URL = 'https://example.com/video'   # ← 真实视频链接填这里，或命令行 --video-url
QR_PX = 1200                              # 输出边长（约 35mm 印刷尺寸下 >800dpi）
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_REG = 'C:/Windows/Fonts/msyh.ttc'


def qr_image(url: str, px: int = QR_PX) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=10)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#141414', back_color='white').convert('RGB')
    return img.resize((px, px), Image.NEAREST)


def warn_band(img: Image.Image) -> Image.Image:
    """斜跨一条红带，写明这是占位码。"""
    w, h = img.size
    band = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    d.line([(0, 0), (w, h)], fill=(255, 36, 66, 255), width=int(h * 0.16))
    d.line([(0, h), (w, 0)], fill=(255, 36, 66, 255), width=int(h * 0.16))
    font = ImageFont.truetype(FONT_BOLD, int(h * 0.085))
    text = '待替换·勿印'
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.rectangle([(w - tw) / 2 - 26, (h - th) / 2 - 20, (w + tw) / 2 + 26, (h + th) / 2 + 20],
                fill=(255, 36, 66, 245))
    d.text(((w - tw) / 2 - box[0], (h - th) / 2 - box[1]), text, font=font, fill='white')
    return Image.alpha_composite(img.convert('RGBA'), band).convert('RGB')


def wechat_placeholder(px: int = QR_PX) -> Image.Image:
    img = Image.new('RGB', (px, px), 'white')
    d = ImageDraw.Draw(img)
    pad = int(px * 0.045)
    dash, gap, w = 26, 18, 6
    for x in range(pad, px - pad, dash + gap):
        d.rectangle([x, pad, min(x + dash, px - pad), pad + w], fill=(210, 214, 222))
        d.rectangle([x, px - pad - w, min(x + dash, px - pad), px - pad], fill=(210, 214, 222))
    for y in range(pad, px - pad, dash + gap):
        d.rectangle([pad, y, pad + w, min(y + dash, px - pad)], fill=(210, 214, 222))
        d.rectangle([px - pad - w, y, px - pad, min(y + dash, px - pad)], fill=(210, 214, 222))
    f_big = ImageFont.truetype(FONT_BOLD, int(px * 0.105))
    f_sm = ImageFont.truetype(FONT_REG, int(px * 0.055))
    lines = [('微信二维码', f_big, (60, 66, 78)), ('待替换', f_big, (255, 36, 66)),
             ('把微信「我的二维码」截图', f_sm, (140, 146, 158)),
             ('存为 assets/qr-wechat.png', f_sm, (140, 146, 158))]
    total = sum(int(d.textbbox((0, 0), t, font=f)[3] * 1.5) for t, f, _ in lines)
    y = (px - total) / 2
    for text, font, color in lines:
        box = d.textbbox((0, 0), text, font=font)
        d.text(((px - (box[2] - box[0])) / 2 - box[0], y), text, font=font, fill=color)
        y += int((box[3] - box[1]) * 1.5)
    return img


def crop_metric() -> None:
    """从「个人实战-指标」截出「累计用户数 1,412」一块，去掉旁边 4 个不相关的数字。"""
    src = ROOT / '资料' / '视频' / 'AI雕兄口播稿' / '配图' / '个人实战-指标.jpg'
    if not src.exists():
        print('skip metric crop, missing:', src)
        return
    im = Image.open(src)
    w, h = im.size
    box = (0, int(h * 0.08), int(w * 0.25), int(h * 0.72))
    im.crop(box).save(ASSETS / '实证-指标.jpg', quality=95)
    print('wrote', ASSETS / '实证-指标.jpg')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--video-url', default=VIDEO_URL, help='视频链接（默认用脚本里的 VIDEO_URL）')
    args = ap.parse_args()
    ASSETS.mkdir(parents=True, exist_ok=True)

    video = qr_image(args.video_url)
    if 'example.com' in args.video_url:
        video = warn_band(video)
        print('！视频码为占位链接，已盖「待替换」警示条:', args.video_url)
    video.save(ASSETS / 'qr-video.png')
    print('wrote', ASSETS / 'qr-video.png')

    wechat_path = ASSETS / 'qr-wechat.png'
    if not wechat_path.exists():
        wechat_placeholder().save(wechat_path)
        print('！微信码不存在，已生成占位图（把真实微信二维码覆盖到该路径即可）')
    else:
        print('微信码已存在，保持不动:', wechat_path)

    crop_metric()


if __name__ == '__main__':
    main()
