#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tts-voice.py — 云端出片用的念稿小程序：一次进一摞幕，一幕出一条 mp3，外加每幕的秒数。

为什么要它：微软那条免费念稿口子 2026-10 换了进门令牌（参数从 1- 起改成 2- 起，哈希也换了一代），
老版本库一律 403。跟社区库升级就行，所以云端装一个库、这边只调它，不自己抄那套令牌算法。

用法（Node 那边调，不用手敲）：
  python3 server/film/tts-voice.py --in 任务.json --out 目录
进的 JSON：{"scenes":[{"text":"第一句"},{"text":"第二句"}],"voice":"zh-CN-XiaoxiaoNeural","rate":"+20%"}
出的 JSON（打 stdout，一行）：{"ok":true,"files":["0.mp3","1.mp3"],"secs":[2.91,3.06],"voice":"…","rate":"…"}
秒数用 ffprobe 量（跟客户机那份同口径：每幕真实念多久就是多久，不靠字数估）。

念稿库版本不够会直接报错退出，不硬撑——报错里给出该跑的升级命令。
"""
import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path

MIN_VER = (7, 3, 1)          # 这版起跟上新令牌；老版全部 403


def die(msg):
    print(json.dumps({'ok': False, 'error': msg}, ensure_ascii=False))
    sys.exit(1)


def ver_of(s):
    m = re.findall(r'\d+', str(s or ''))
    return tuple(int(x) for x in m[:3]) if m else (0, 0, 0)


def check_lib():
    try:
        import edge_tts
    except Exception:
        die('服务器上没装念稿库（edge-tts）。装：pip3 install -i https://mirrors.aliyun.com/pypi/simple/ "edge-tts>=7.3.1"')
    v = ver_of(getattr(edge_tts, '__version__', ''))
    if v < MIN_VER:
        die('念稿库版本太老（现在是 %s，要 7.3.1 起）——老版用的进门令牌已被拒（403）。'
            '装：pip3 install -U -i https://mirrors.aliyun.com/pypi/simple/ "edge-tts>=7.3.1"' % ('.'.join(map(str, v)),))
    return edge_tts


def probe_secs(path):
    """用 ffprobe 量一条音频的秒数；量不到就报出来，别让画面跟声音对不上还看不出来。"""
    ff = os.environ.get('FILM_FFPROBE', 'ffprobe')
    p = subprocess.run([ff, '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'default=noprint_wrappers=1:nk=1', str(path)],
                       capture_output=True, text=True)
    if p.returncode != 0:
        die('ffprobe 量秒数失败：%s' % (p.stderr or '').strip()[:200])
    try:
        return round(float((p.stdout or '').strip()), 3)
    except ValueError:
        die('ffprobe 没回秒数（拿到：%r）' % (p.stdout or '')[:60])


async def speak(edge_tts, text, voice, rate, out_path):
    """念一句落一个 mp3；对面抽风就重试两次（客户机那份没这待遇，云端排队更要稳）。"""
    last = None
    for _ in range(3):
        try:
            buf = bytearray()
            com = edge_tts.Communicate(text, voice, rate=rate)
            async for chunk in com.stream():
                if chunk['type'] == 'audio':
                    buf.extend(chunk['data'])
            if not buf:
                raise RuntimeError('对面没给音频')
            Path(out_path).write_bytes(bytes(buf))
            return
        except Exception as e:
            last = e
            await asyncio.sleep(1.2)
    die('这一幕念不出来：%s' % (last,))


async def run(a):
    edge_tts = check_lib()
    job = json.loads(Path(a.inp).read_text(encoding='utf-8'))
    scenes = job.get('scenes') or []
    if not scenes:
        die('任务里没有幕（scenes 空）')
    voice = job.get('voice') or 'zh-CN-XiaoxiaoNeural'
    rate = job.get('rate') or '+20%'
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    files, secs = [], []
    for i, sc in enumerate(scenes):
        text = str(sc.get('text') or '').strip()
        name = '%d.mp3' % i
        path = out / name
        if not text:                       # 空幕不念：给一段静默，秒数由调用方按幕间静默算
            files.append('')
            secs.append(0.0)
            continue
        await speak(edge_tts, text, voice, rate, path)
        files.append(name)
        secs.append(probe_secs(path))
    print(json.dumps({'ok': True, 'files': files, 'secs': secs,
                      'voice': voice, 'rate': rate}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True, help='任务 JSON（scenes/voice/rate）')
    ap.add_argument('--out', required=True, help='mp3 落到哪个目录')
    a = ap.parse_args()
    asyncio.run(run(a))


if __name__ == '__main__':
    main()
