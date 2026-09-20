# -*- coding: utf-8 -*-
"""给竖屏成片接一个「封面首帧」：封面图静止 N 秒 → 原片，再重混配音与 BGM。

画面拼接走 concat 复制流（原片不重编码、不掉画质），音轨按 hold+lead_in 重新对齐：
BGM 从 0 起（正好在封面那段淡入），旁白推迟到封面走完再进。

用法：
  python3 scripts/dev/prepend_cover.py                      # 封面-定稿A+C-9x16.jpg 静止 1.5s
  python3 scripts/dev/prepend_cover.py --cover "成片/封面-方案A-15天1000.jpg" --hold 2.0
"""
import argparse, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from render_video import FF, mux, probe_duration, run  # noqa: E402

ROOT = HERE.parents[1]
MAT = ROOT / '资料' / '视频' / 'AI雕兄口播稿'
OUTDIR = MAT / '成片'
W, H, FPS = 1080, 1920, 30
BG_BLACK = '0x0e1116'          # 动效页底色，淡出到它再接第一幕不会闪


def cover_clip(cover, hold, out):
    """封面图 → 静止片段。末尾 0.4s 淡出，首帧保持完整封面（平台抓的封面就是它）。"""
    vf = (f'scale={W}:{H}:force_original_aspect_ratio=decrease,'
          f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG_BLACK},setsar=1,format=yuv420p,'
          f'fade=t=out:st={max(0.0, hold - 0.4):.2f}:d=0.4:color={BG_BLACK}')
    run([FF, '-hide_banner', '-y', '-loop', '1', '-framerate', str(FPS), '-t', f'{hold:.3f}',
         '-i', str(cover), '-vf', vf, '-c:v', 'h264_mf', '-b:v', '16M',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out)])


def concat_copy(parts, out):
    lst = out.with_suffix('.concat.txt')
    lst.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts), encoding='utf-8')
    run([FF, '-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst),
         '-c', 'copy', '-movflags', '+faststart', str(out)])
    lst.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cover', default=str(OUTDIR / '封面-定稿A+C-9x16.jpg'))
    ap.add_argument('--video', default=str(OUTDIR / 'AI雕兄-竖屏-成片-无声.mp4'))
    ap.add_argument('--voice', default=str(MAT / '配音' / '配音-我的声音.m4a'))
    ap.add_argument('--bgm', default=str(MAT / '配音' / 'bgm' / 'BGM-三段情绪.m4a'))
    ap.add_argument('--hold', type=float, default=1.5, help='封面静止多少秒')
    ap.add_argument('--lead-in', type=float, default=0.8, help='原片里画面先出多久后进旁白')
    ap.add_argument('--bgm-db', type=float, default=18.0)
    ap.add_argument('--out', help='输出 mp4（默认 成片/AI雕兄-竖屏-成片-封面首帧-带BGM.mp4）')
    ap.add_argument('--cover-clip', help='只出封面静帧片段，不拼接（调试用）')
    a = ap.parse_args()

    cover = Path(a.cover)
    clip = OUTDIR / '_封面首帧.mp4'
    if a.cover_clip:
        cover_clip(cover, a.hold, Path(a.cover_clip))
        print(f'封面片段：{a.cover_clip}')
        return

    src = Path(a.video)
    dur_src = probe_duration(src)
    cover_clip(cover, a.hold, clip)

    head = OUTDIR / 'AI雕兄-竖屏-成片-封面首帧-无声.mp4'
    concat_copy([clip, src], head)
    got = probe_duration(head)
    plan = dur_src + a.hold
    print(f'画面拼接：{dur_src:.2f}s + {a.hold:.2f}s = 计划 {plan:.2f}s · 实得 {got:.2f}s')
    if abs(got - plan) > 0.15:
        sys.exit('拼接后时长对不上，检查 concat 是否吞帧')

    out = Path(a.out) if a.out else OUTDIR / 'AI雕兄-竖屏-成片-封面首帧-带BGM.mp4'
    mux(head, Path(a.voice), out, a.hold + a.lead_in, Path(a.bgm), a.bgm_db)
    clip.unlink()
    print(f'成片：{out}  ({out.stat().st_size / 1048576:.1f} MB) · '
          f'封面 {a.hold:g}s + 原片 · 旁白延后 {a.hold + a.lead_in:g}s')


if __name__ == '__main__':
    main()
