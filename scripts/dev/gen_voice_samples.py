# -*- coding: utf-8 -*-
"""给「调风格」面板出音色试听样音：一条短句，每个音色念一遍 → 客户模板样片/样音/<中文名>.m4a。

音色清单跟 资料/视频/客户模板样片/voices.js 一一对应，那边加音色这边也要加。
  python3 scripts/dev/gen_voice_samples.py          # 缺哪个补哪个
  python3 scripts/dev/gen_voice_samples.py --force  # 全重出
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_video import FF, probe_duration, run
from tts_voice import SAMPLE_TXT, speak

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / '资料' / '视频' / '客户模板样片' / '样音'
VOICES = [('zh-CN-XiaoxiaoNeural', '晓晓'), ('zh-CN-XiaoyiNeural', '晓伊'),
          ('zh-CN-YunxiNeural', '云希'), ('zh-CN-YunyangNeural', '云扬'),
          ('zh-CN-YunjianNeural', '云健')]
RATE = '+20%'      # 跟出片同口径，客户听到的就是成片里的速度


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='已有的也重出')
    a = ap.parse_args()
    DIR.mkdir(parents=True, exist_ok=True)
    for v, n in VOICES:
        out = DIR / (n + '.m4a')
        if out.exists() and not a.force:
            print(f'{n}：已有 {out.stat().st_size / 1024:.0f}KB，跳过')
            continue
        mp3 = out.with_suffix('.mp3')
        asyncio.run(speak(SAMPLE_TXT, v, mp3, RATE))
        run([FF, '-hide_banner', '-y', '-i', str(mp3), '-c:a', 'aac', '-b:a', '96k', str(out)])
        mp3.unlink()
        print(f'{n}：{out.name}  {probe_duration(out):.1f}s  {out.stat().st_size / 1024:.0f}KB')


if __name__ == '__main__':
    main()
