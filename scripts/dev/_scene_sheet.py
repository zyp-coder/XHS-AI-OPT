# -*- coding: utf-8 -*-
"""按分幕表在每幕「中点」抽一帧，拼成 6 列接触表，用来肉眼扫画面上的平台词。"""
import json, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from render_video import FF, probe_duration

OUT = Path('资料/视频/AI雕兄口播稿/成片/_校验')
OUT.mkdir(parents=True, exist_ok=True)

def sheet(film, starts_json, offset, tag, cols=6, w=216, h=384):
    meta = json.loads(Path(starts_json).read_text(encoding='utf-8'))
    starts, total = [float(x) for x in meta['starts']], meta['total']
    mids = [offset + (starts[i] + (starts[i+1] if i+1 < len(starts) else total)) / 2
            for i in range(len(starts))]
    with tempfile.TemporaryDirectory() as td:
        for i, t in enumerate(mids):
            subprocess.run([FF, '-hide_banner', '-v', 'error', '-ss', f'{t:.2f}',
                            '-i', str(film), '-frames:v', '1', '-vf', f'scale={w}:{h}',
                            str(Path(td) / f'{i:02d}.jpg')], check=True)
        n = len(mids)
        rows = (n + cols - 1) // cols
        dst = OUT / f'{tag}-{n}幕.jpg'
        subprocess.run([FF, '-hide_banner', '-v', 'error', '-y', '-i',
                        str(Path(td) / '%02d.jpg'), '-vf', f'tile={cols}x{rows}',
                        str(dst)], check=True)
        print(f'{dst.name}  {rows*cols} 格 · 片长 {probe_duration(film):.1f}s')

M = Path('资料/视频/AI雕兄口播稿')
P = M / '配音'
sheet(M/'成片/AI雕兄-竖屏-抖音版-成片-封面首帧-带BGM.mp4', P/'配音-长版-晓晓-抖音.starts.json', 2.3, '长版')
sheet(M/'9问快闪/AI雕兄-9问-抖音版-成片-封面首帧-带BGM.mp4', P/'配音-9问-晓晓-抖音.starts.json', 2.3, '9问')
sheet(M/'系统优势总结/AI雕兄-优势-抖音版-成片-封面首帧-带BGM.mp4', P/'配音-优势-晓晓-抖音.starts.json', 2.3, '优势')
sheet(M/'短版45s/AI雕兄-短版-抖音版-成片-带BGM.mp4', P/'配音-短版-晓晓-抖音.starts.json', 0.8, '短版')
