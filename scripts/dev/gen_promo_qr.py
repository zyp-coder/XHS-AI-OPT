# -*- coding: utf-8 -*-
"""生成推广物料用的两个二维码 + 实证图裁切。

视频码 / 微信码：都不用程序「画」，而是从微信里导出的截图抠出来（--video-image / --wechat-image）。
        微信自己的码含平台元数据，重画容易画成一张没用的图；而且视频号「单条视频分享链接」
        （weixin.qq.com/sph/…）有有效期，过期后微信报「暂不支持此内容」——印出去就是死码。
        要印就印视频号「主页二维码」（永久有效），导出后存成 assets/qr-video-原图.png 再抠。
        没给图时：文件已存在就保持不动；不存在才画占位图并盖「待替换 勿印」警示条。
微信码：把微信 App「我的二维码」截图存成 assets/qr-wechat-原图.png，同样用 --wechat-image 抠；
        截图不是方的直接放会被槽位压扁，抠码会自动裁成正方形。
抠码靠 zxing-cpp 定位：python3 -m pip install zxing-cpp（找不到码时可手量坐标 --video-box x0,y0,x1,y1）。
用法：
    python3 scripts/dev/gen_promo_qr.py --video-image "资料/推广物料/assets/qr-video-原图.png"
    python3 scripts/dev/gen_promo_qr.py --video-image 视频号主页截图.png --wechat-image 微信码截图.png
    python3 scripts/dev/gen_promo_qr.py            # 只补缺的占位图 + 重裁实证图
    python3 scripts/dev/gen_promo_qr.py --video-url "https://..."   # 仅临时用；链接会过期，别拿去印
"""
import argparse
import pathlib

import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
ASSETS = ROOT / '资料' / '推广物料' / 'assets'

VIDEO_URL = 'https://weixin.qq.com/sph/AP1xL3b3cz'   # 真实视频链接（视频号）；换视频时改这里或命令行 --video-url
QR_PX = 1200                              # 输出边长（约 35mm 印刷尺寸下 >800dpi）
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_REG = 'C:/Windows/Fonts/msyh.ttc'


def qr_image(url: str, px: int = QR_PX) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=10)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#141414', back_color='white').convert('RGB')
    return img.resize((px, px), Image.NEAREST)


def fit_qr_from_image(src: pathlib.Path, px: int = QR_PX, box: str = None) -> Image.Image:
    """从微信导出的截图里抠二维码：定位码区 → 裁成正方形 → 补白边 → 缩到 px。

    只裁不重画：微信的码含平台元数据，重画出来可能扫不了。
    box 形如 'x0,y0,x1,y1'（原图像素），自动定位失败时手量兜底。
    """
    im = Image.open(src).convert('RGB')
    text = ''
    if box:
        x0, y0, x1, y1 = (int(v) for v in box.split(','))
    else:
        try:
            import zxingcpp
        except ImportError:
            raise SystemExit('缺 zxing-cpp：python3 -m pip install zxing-cpp（或用 --video-box 手量坐标）')
        found = zxingcpp.read_barcodes(im)
        if not found:
            raise SystemExit('没在 %s 里找到二维码：换张清楚点、四周留白的截图，或用 --video-box x0,y0,x1,y1' % src)
        pos = found[0].position                     # 四个角点，取外接矩形
        pts = [pos.top_left, pos.top_right, pos.bottom_right, pos.bottom_left]
        x0, y0 = min(p.x for p in pts), min(p.y for p in pts)
        x1, y1 = max(p.x for p in pts), max(p.y for p in pts)
        text = found[0].text

    side = max(x1 - x0, y1 - y0)
    out_side = int(side * 1.18)                 # 四周留静区，约等于二维码 4 个模块宽
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    bx0, by0 = int(round(cx - out_side / 2)), int(round(cy - out_side / 2))
    canvas = Image.new('RGB', (out_side, out_side), 'white')   # 截图边上的内容（头像、账号名）不进画面
    sx0, sy0 = max(bx0, 0), max(by0, 0)
    sx1, sy1 = min(bx0 + out_side, im.width), min(by0 + out_side, im.height)
    canvas.paste(im.crop((sx0, sy0, sx1, sy1)), (sx0 - bx0, sy0 - by0))
    out = canvas.resize((px, px), Image.LANCZOS)

    try:
        import zxingcpp
    except ImportError:
        pass
    else:
        chk = zxingcpp.read_barcodes(out)
        print('  抠码 %s → %s' % (src.name, chk[0].text if chk else '！裁后解不出，检查坐标/截图清晰度'))
    return out


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


def crop_backend() -> None:
    """从「个人实战」手机整屏截图裁出后台数据区：四个指标数字 + 趋势曲线，一张不拼接。

    裁剪框按原图 1280×2800 实测：顶 775px（指标数字上方）、底 2305px（坐标轴线下方）；
    只切掉手机状态栏、底部导航和图表下方的日期刻度，中间内容不裁。
    """
    src = ROOT / '资料' / '视频' / 'AI雕兄口播稿' / '个人实战.jpg'
    if not src.exists():
        print('skip backend crop, missing:', src)
        return
    im = Image.open(src)
    w, h = im.size
    im.crop((0, int(h * 0.277), w, int(h * 0.823))).save(ASSETS / '实证-后台.jpg', quality=92)
    print('wrote', ASSETS / '实证-后台.jpg')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--video-image', help='视频号「主页二维码」截图（推荐；印出去不会过期）')
    ap.add_argument('--video-box', help='自动找不到码时手量：x0,y0,x1,y1（原图像素）')
    ap.add_argument('--video-url', help='临时用：把链接画成二维码（视频号单条分享链接会过期，别拿去印）')
    ap.add_argument('--wechat-image', help='微信「我的二维码」截图')
    args = ap.parse_args()
    ASSETS.mkdir(parents=True, exist_ok=True)

    video_path = ASSETS / 'qr-video.png'
    if args.video_image:
        fit_qr_from_image(pathlib.Path(args.video_image), box=args.video_box).save(video_path)
        print('wrote', video_path)
    elif args.video_url:
        video = qr_image(args.video_url)
        if 'example.com' in args.video_url:
            video = warn_band(video)
            print('！占位链接，已盖「待替换」警示条:', args.video_url)
        else:
            print('！注意：链接画出来的码会随链接过期而失效——印刷品请改用 --video-image 抠视频号主页码')
        video.save(video_path)
        print('wrote', video_path)
    elif video_path.exists():
        print('视频码已存在，保持不动（换码：--video-image 传视频号主页二维码截图）:', video_path)
    else:
        warn_band(qr_image(VIDEO_URL)).save(video_path)
        print('！没视频码也没给图，已生成「待替换·勿印」占位码:', video_path)

    wechat_path = ASSETS / 'qr-wechat.png'
    if args.wechat_image:
        fit_qr_from_image(pathlib.Path(args.wechat_image)).save(wechat_path)
        print('wrote', wechat_path)
    elif wechat_path.exists():
        print('微信码已存在，保持不动:', wechat_path)
    else:
        wechat_placeholder().save(wechat_path)
        print('！微信码不存在，已生成占位图（把真实微信二维码覆盖到该路径即可）')

    crop_backend()


if __name__ == '__main__':
    main()
