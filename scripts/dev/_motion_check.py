# -*- coding: utf-8 -*-
"""量成片的「有效帧率」：按 30fps 抽帧比对相邻帧，重复帧越多说明抓屏越卡。"""
import subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from render_video import FF

def eff_fps(path, w=48, h=86):
    p = subprocess.run([FF, '-hide_banner', '-v', 'error', '-i', str(path),
                        '-vf', f'scale={w}:{h},format=gray', '-f', 'rawvideo', '-'],
                       capture_output=True)
    raw = p.stdout
    n = w * h
    frames = [raw[i * n:(i + 1) * n] for i in range(len(raw) // n)]
    same = sum(1 for a, b in zip(frames, frames[1:]) if a == b)
    tot = max(1, len(frames) - 1)
    return len(frames), same, 30.0 * (tot - same) / tot

for a in sys.argv[1:]:
    n, same, eff = eff_fps(a)
    print('%-52s %5d 帧 · 重复 %4d · 有效 ≈ %4.1f fps' % (Path(a).name, n, same, eff))
