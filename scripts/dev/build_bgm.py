# -*- coding: utf-8 -*-
"""把几段音乐按时间轴拼成一条 BGM：段间交叉淡化、每段响度先归一到同一水平。

用法：
  python3 scripts/dev/build_bgm.py \
      "资料/视频/AI雕兄口播稿/配音/bgm/A-低沉氛围-Vastness.mp3:0:50.26" \
      "资料/视频/AI雕兄口播稿/配音/bgm/B-律动-MinimalTechno01.mp3:50.26:131.94" \
      "资料/视频/AI雕兄口播稿/配音/bgm/C-温暖钢琴-PianoReflections.mp3:131.94:174.8" \
      --out "资料/视频/AI雕兄口播稿/配音/bgm/BGM-三段情绪.m4a"

每段写「文件:开始秒:结束秒」，按片中时间排；末段的结束秒就是片长。
交叉淡化以边界时刻为中心（前后各 --xfade/2 秒），所以每段实际取
本段时长 + 相邻边界各半个淡化时长。BGM 最终比人声低多少由渲染脚本的
--bgm-db 统一决定，这里只保证三段之间响度一致。
"""
import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_video import FF, run, probe_duration


def parse_seg(s):
    path, begin, end = s.rsplit(':', 2)     # 从右切，避免吃掉盘符 d:
    return Path(path), float(begin), float(end)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('segs', nargs='+', metavar='文件:起:止')
    ap.add_argument('--out', required=True)
    ap.add_argument('--xfade', type=float, default=3.0, help='交叉淡化时长（秒，默认 3）')
    ap.add_argument('--lufs', type=float, default=-18.0, help='每段归一到几 LUFS（默认 -18）')
    a = ap.parse_args()

    segs = [parse_seg(s) for s in a.segs]
    if len(segs) < 2:
        sys.exit('至少两段；只有一段就直接用原文件')
    total, half = segs[-1][2], a.xfade / 2

    parts, lengths = [], []
    for i, (path, begin, end) in enumerate(segs):
        if not path.is_file():
            sys.exit(f'找不到文件：{path}')
        need = (end - begin) + (half if i else 0.0) + (half if i < len(segs) - 1 else 0.0)
        have = probe_duration(path)
        if have + 0.05 < need:
            sys.exit(f'{path.name} 只有 {have:.1f}s，这一段要 {need:.1f}s（含淡化预留）')
        lengths.append(need)
        parts.append(f'[{i}:a]loudnorm=I={a.lufs}:TP=-1.5:LRA=11,'
                     f'atrim=0:{need:.3f},asetpts=N/SR/TB[s{i}];')

    prev, chain = 's0', []
    for i in range(1, len(segs)):
        chain.append(f'[{prev}][s{i}]acrossfade=d={a.xfade}:c1=qsin:c2=qsin[x{i}];')
        prev = f'x{i}'
    graph = (''.join(parts) + ''.join(chain)
             + f'[{prev}]atrim=0:{total:.3f},asetpts=N/SR/TB[aout]')

    args = [FF, '-hide_banner', '-y']
    for path, _, _ in segs:
        args += ['-i', str(path)]
    args += ['-filter_complex', graph, '-map', '[aout]', '-ar', '44100',
             '-c:a', 'aac', '-b:a', '192k', str(a.out)]

    print(f'片长 {total:.2f}s · 交叉淡化 {a.xfade:.1f}s（以边界为中心）· 每段归一 {a.lufs:.0f} LUFS')
    for (path, begin, end), need in zip(segs, lengths):
        print(f'  {begin:7.2f} → {end:7.2f}s  本段 {end - begin:6.2f}s  取 {need:6.2f}s  {path.name}')
    run(args)
    print(f'-> {a.out}  {probe_duration(a.out):.2f}s')


if __name__ == '__main__':
    main()
