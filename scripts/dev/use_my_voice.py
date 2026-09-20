# -*- coding: utf-8 -*-
"""用你自己的录音替换 AI 配音：响度归一 + 静音裁剪 + 按幕拼接 → 配音-我的声音.m4a + .starts.json

用法：
  # 1) 逐幕录音（推荐，最稳，单幕可重录）：01.m4a … 18.m4a 放进 配音/我的录音/ 后
  python3 scripts/dev/use_my_voice.py
  # 2) 整篇一次录（幕间停 1.5~2s）：配音/我的录音/ 里只放一个音频文件
  python3 scripts/dev/use_my_voice.py --single
  # 3) 自定义目录 / 只要一份不带配音的合成
  python3 scripts/dev/use_my_voice.py --in "配音/我的录音-第二版"

产出后直接渲染（脚本会自己读同名 .starts.json 精确分幕）：
  python3 scripts/dev/render_video.py --audio "资料/视频/AI雕兄口播稿/配音/配音-我的声音.m4a"

幕间静默会自动加长到“让该幕动画播完”所需的时间，所以录快一点也不会切掉动画。
"""
import argparse, json, re, sys, wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render_video import FF, run, probe_duration, MAT, audio_analysis, scene_starts

HTML = MAT / 'AI雕兄-动效演示-竖屏.html'
OUTDIR = MAT / '配音'
EXT = ('.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac', '.opus', '.wma')
SR = 44100

GAP = 0.55          # 幕间基础静默（秒）
ENTRY = 0.9         # 入场动画固定开销（秒）
TYPE_EXTRA = 1.6    # 打字机/逐字类动画的额外预留（秒）


def scene_needs(html_path):
    """每幕动画需要的最短展示时间：取该幕最大 --d 延迟 + 入场开销，计数器另算。"""
    html = html_path.read_text(encoding='utf-8')
    out = []
    for name, block in re.findall(r'<section class="scene" data-name="([^"]+)">(.*?)</section>', html, re.S):
        text = ''.join(re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', p))
                       for p in re.findall(r'<p>(.*?)</p>', block, re.S))
        need = 0.0
        ds = [float(x) for x in re.findall(r'--d:([\d.]+)s', block)]
        if ds:
            need = max(ds) + ENTRY
        for dl, du in re.findall(r'data-delay="(\d+)"[^>]*?data-dur="(\d+)"', block):
            need = max(need, (int(dl) + int(du)) / 1000 + 0.3)
        if 'data-speed=' in block:
            need = max(need, TYPE_EXTRA + (max(ds) if ds else 0.0))
        out.append({'name': name, 'chars': len(text), 'need': round(need, 1)})
    return out


def clean(src, dst):
    """响度归一 + 掐掉首尾静音，统一成 44.1kHz 单声道 wav。"""
    trim = ('silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak,'
            'areverse,'
            'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak,'
            'areverse')
    run([FF, '-hide_banner', '-y', '-i', str(src),
         '-af', f'loudnorm=I=-16:TP=-1.5:LRA=11,{trim}',
         '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le', str(dst)])
    return probe_duration(dst)


def natural_key(p):
    nums = re.findall(r'\d+', p.stem)
    return (int(nums[0]) if nums else 10 ** 6, p.name)


def concat(pieces, gaps, out_wav):
    import wave
    with wave.open(str(out_wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        for i, p in enumerate(pieces):
            r = wave.open(str(p), 'rb')
            w.writeframes(r.readframes(r.getnframes()))
            r.close()
            if i + 1 < len(pieces):
                w.writeframes(b'\x00\x00' * int(gaps[i] * SR))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='indir', default=str(OUTDIR / '我的录音'),
                    help='录音目录（默认 配音/我的录音）')
    ap.add_argument('--out', dest='outbase', default=str(OUTDIR / '配音-我的声音'),
                    help='输出文件名（不含扩展名）')
    ap.add_argument('--html', default=str(HTML),
                    help='动效页（读它决定幕数与每幕动画时长；短版要指到 短版45s/AI雕兄-短版-竖屏.html）')
    ap.add_argument('--single', action='store_true',
                    help='整篇一次录：按静音切幕（幕间要停 1.5~2s）')
    ap.add_argument('--gap', type=float, default=GAP, help='幕间基础静默秒数')
    a = ap.parse_args()

    indir = Path(a.indir)
    files = sorted((p for p in indir.iterdir() if p.suffix.lower() in EXT), key=natural_key) if indir.is_dir() else []
    if not files:
        sys.exit(f'{indir} 里没有音频文件（支持 {" ".join(EXT)}）')
    scenes = scene_needs(Path(a.html))
    n = len(scenes)
    print(f'幕数 {n} · 录音 {len(files)} 个 · 目录 {indir}')

    work = indir / '_work'
    work.mkdir(exist_ok=True)
    single = a.single or len(files) == 1
    if single:
        whole = [p for p in files if re.search(r'全文|整篇|完整|whole', p.stem)]
        if len(whole) == 1:
            files = whole
        elif len(files) > 1:
            sys.exit(f'整篇录音模式下目录里只能放一个音频（当前 {len(files)} 个，'
                     f'或把整篇命名为「全文.xxx」）：' + '、'.join(p.name for p in files))

    starts, durations = [], []
    if not single:
        if len(files) != n:
            sys.exit(f'逐幕录音需要 {n} 个文件（01…{n:02d}），当前 {len(files)} 个：' +
                     '、'.join(p.name for p in files))
        pieces, gaps = [], []
        t = 0.0
        for i, (p, sc) in enumerate(zip(files, scenes)):
            w = work / f'{i + 1:02d}.wav'
            d = clean(p, w)
            starts.append(round(t, 3))
            durations.append(round(d, 3))
            pieces.append(w)
            t += d
            if i + 1 < n:
                g = max(a.gap, sc['need'] - d)          # 幕间静默：至少 gap，且够动画播完
                gaps.append(round(g, 3))
                t += g
            print(f"  {i + 1:>2}/{n} {sc['name'][:16]:<18} {d:5.2f}s  ({sc['chars']:>3} 字)"
                  f"  动画需 {sc['need']:>4.1f}s" + (f'  幕间 +{gaps[-1]:.2f}s' if gaps else ''))
        total = t
        concat(pieces, gaps, work / 'all.wav')
    else:
        src = files[0]
        print(f'整篇录音：{src.name}（按静音切幕，边界吸附到最近的停顿）')
        total, chunks = audio_analysis(src)
        begins, snapped = scene_starts(chunks, [s['chars'] for s in scenes], lead=0.0)
        print(f'  语音块 {len(chunks)} · 边界吸附 {"开" if snapped else "关(退化为比例切)"}')
        if not snapped:
            sys.exit('这段录音里没找到足够多的停顿（幕间要停 1.5~2 秒再往下读），'
                     '或改用逐幕录音：把 18 段分别导出成 01…18')
        clean(src, work / 'all.wav')
        for i, sc in enumerate(scenes):
            end = begins[i + 1] if i + 1 < n else total
            d = end - begins[i]
            starts.append(round(begins[i], 3))
            durations.append(round(d, 3))
            rate = sc['chars'] / d if d > 0 else 0
            flag = '  <-- 语速异常，核对是否切错' if not (2.0 <= rate <= 8.5) else ''
            print(f"  {i + 1:>2}/{n} {sc['name'][:16]:<18} {d:5.2f}s  ({sc['chars']:>3} 字)"
                  f"  {rate:4.1f} 字/秒  动画需 {sc['need']:>4.1f}s{flag}")

    out_wav = work / 'all.wav'
    out_m4a = Path(a.outbase).with_suffix('.m4a')
    run([FF, '-hide_banner', '-y', '-i', str(out_wav), '-c:a', 'aac', '-b:a', '192k', str(out_m4a)])
    meta = {'voice': '我的录音', 'rate': '-', 'gap': a.gap, 'total': round(probe_duration(out_m4a), 2),
            'starts': starts, 'durations': durations}
    mj = Path(a.outbase).with_suffix('.starts.json')
    mj.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'-> {out_m4a.name}  {meta["total"]:.1f}s\n-> {mj.name}（{n} 幕精确分幕表）')
    print('渲染：python3 scripts/dev/render_video.py --audio "%s"' % out_m4a)


if __name__ == '__main__':
    main()
