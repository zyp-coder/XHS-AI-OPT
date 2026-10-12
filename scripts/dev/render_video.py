# -*- coding: utf-8 -*-
"""动效演示 HTML → 视频：CDP 逐帧抓屏 → ffmpeg 编码 →（可选）与配音对轴合成。

用法：
  # 预览：只渲前 3 幕，按页面自然节奏（5.2 字/秒 + 1.4 秒呼吸），用于检查画质与节奏
  python3 scripts/dev/render_video.py --preview 3

  # 正式（全自动）：配音有 .starts.json 就按精确分幕卡点，没有才靠句间停顿切幕
  python3 scripts/dev/render_video.py --audio "资料/视频/AI雕兄口播稿/配音/配音-最终.m4a"
  配音稿整段粘贴文本：资料/视频/AI雕兄口播稿/AI雕兄-配音-粘贴版.txt（剪映「文本朗读」用）

  # 配 BGM：音乐自动铺满全片、按人声电平行定标垫底（--bgm-db 18 = 比人声低 18dB）
  python3 scripts/dev/render_video.py --audio "…/配音-最终.m4a" --bgm "…/bgm/轻音乐.mp3"
  # 已出好片只想补音乐（不重渲染画面，约 1 分钟）
  python3 scripts/dev/render_video.py --bgm-add "…/成片/AI雕兄-竖屏-成片.mp4" --bgm "…/bgm/轻音乐.mp3"

不依赖系统 ffmpeg：自动使用剪映自带的 ffmpeg.exe（含 h264_mf / nvenc 硬件编码器）。
"""
import argparse, asyncio, base64, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAT = ROOT / '资料' / '视频' / 'AI雕兄口播稿'
OUTDIR = MAT / '成片'
W, H = 1080, 1920
RATE, TAIL, MIN_MS = 5.2, 1.4, 4200
JPEG_Q = 92
CAPTURE_LAG = 0.10          # 抓屏管线固有延迟（页面改状态到画面帧落地约 3 帧）
LEAD = 0.30                 # 画面比配音早到多久换幕（秒）


def find_ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    apps = Path(os.environ.get('LOCALAPPDATA', '')) / 'JianyingPro' / 'Apps'
    cands = sorted(apps.glob('*/ffmpeg.exe')) if apps.is_dir() else []
    if cands:
        return str(cands[-1])
    sys.exit('找不到 ffmpeg（系统 PATH 和剪映目录都没有）')


FF = find_ffmpeg()


def run(args, **kw):
    p = subprocess.run(args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', **kw)
    if p.returncode != 0:
        sys.exit(f'命令失败: {" ".join(map(str, args))}\n{p.stderr[-2000:]}')
    return p


def load_scenes(html_path):
    html = html_path.read_text(encoding='utf-8')
    out = []
    for name, block in re.findall(r'<section class="scene" data-name="([^"]+)">(.*?)</section>', html, re.S):
        ps = re.findall(r'<p>(.*?)</p>', block, re.S)
        text = ''.join(re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', p)) for p in ps)
        out.append({'name': name, 'chars': len(text)})
    return out


def natural_durations(scenes):
    return [max(MIN_MS, s['chars'] / RATE * 1000 + TAIL * 1000) / 1000 for s in scenes]


def audio_analysis(audio):
    log = run([FF, '-hide_banner', '-i', str(audio),
               '-af', 'silencedetect=noise=-35dB:d=0.18', '-f', 'null', '-']).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', log)
    if not m:
        sys.exit('读不出音频时长：' + log[-800:])
    total = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    sil = list(zip(starts, ends))
    chunks, cur = [], 0.0
    for s, e in sil:
        if s - cur > 0.06:
            chunks.append((cur, s))
        cur = max(cur, e)
    if total - cur > 0.06:
        chunks.append((cur, total))
    return total, chunks


def scene_starts(chunks, chars, lead=LEAD):
    """按字数比例把音频切成 len(chars) 段，边界吸附到最近的停顿处。"""
    total_chars, n = sum(chars), len(chars)
    base = chunks[0][0] if chunks else 0.0
    if len(chunks) < n:                      # 停顿太少，退化为按时长比例硬切
        span = (chunks[-1][1] if chunks else 0.0) - base
        starts, acc = [base], 0.0
        for c in chars[:-1]:
            acc += c / total_chars * span
            starts.append(base + acc)
        return starts, False
    cum, acc = [], 0.0
    for s, e in chunks:
        acc += e - s
        cum.append(acc)                      # 每个语音块的累计“净说话时长”
    starts, target = [base], 0.0
    for c in chars[:-1]:
        target += c / total_chars * (cum[-1] or 1)
        k = min(range(len(chunks) - 1), key=lambda i: abs(cum[i] - target))
        gap_s, gap_e = chunks[k][1], chunks[k + 1][0]
        starts.append(max(gap_s + 0.04, min((gap_s + gap_e) / 2 - lead, gap_e)))
    return starts, True


async def record(html_path, marks, end_t, frames_dir):
    import queue, threading
    from playwright.async_api import async_playwright
    frames, q = [], queue.Queue()

    def writer():
        idx = 0
        while True:
            item = q.get()
            if item is None:
                return
            ts, data = item
            p = frames_dir / f'f{idx:06d}.jpg'
            p.write_bytes(data)
            frames.append((ts, p))
            idx += 1

    th = threading.Thread(target=writer, daemon=True)
    th.start()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=[
            '--force-device-scale-factor=1', '--hide-scrollbars',
            '--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
            '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'])
        page = await browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        cdp = await page.context.new_cdp_session(page)
        await page.goto(html_path.as_uri())
        await page.wait_for_function('document.fonts.status === "loaded"')
        await page.add_style_tag(content=(
            '#hud,#notes,#toast{display:none!important}'
            'html,body{cursor:none!important;background:#000!important;overflow:hidden!important}'))
        await page.wait_for_timeout(400)
        # 页面加载时已自动进第 1 幕；先复位人物入场动画，再右左翻一次让第 1 幕重新入场（含计数器）
        await page.evaluate("""() => {
            const alive = el => getComputedStyle(el).animationName !== 'none';
            const host = document.getElementById('hostwrap');
            host.querySelectorAll('*').forEach(el => {
                if (!alive(el)) return;
                el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
            });
            const flip = k => window.dispatchEvent(new KeyboardEvent('keydown', {key: k, cancelable: true}));
            flip('ArrowRight'); flip('ArrowLeft');
        }""")

        # 帧时刻优先用 CDP 的 metadata.timestamp（真实捕获时刻，去掉编码/传输延迟）；
        # 缺失时退回到达时刻。整段只用同一条时钟，避免两种时间轴混用。
        ref = {'t0': None, 'meta': True}

        async def on_frame(params):
            arr = time.perf_counter()
            ts = (params.get('metadata') or {}).get('timestamp')
            await cdp.send('Page.screencastFrameAck', {'sessionId': params['sessionId']})
            if ref['t0'] is None:
                ref['meta'] = ts is not None
                ref['t0'] = ts if ref['meta'] else arr
            q.put((ts if ref['meta'] else arr, base64.b64decode(params['data'])))

        cdp.on('Page.screencastFrame', on_frame)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': JPEG_Q,
                                                'maxWidth': W, 'maxHeight': H, 'everyNthFrame': 1})

        while ref['t0'] is None:                        # 等第一帧 = 视频 t=0
            await asyncio.sleep(0.002)
        clock = time.time if ref['meta'] else time.perf_counter
        if not ref['meta']:
            print('提示：抓屏帧无 timestamp，退回到达时刻计时（画面可能整体晚 0.1s 左右）')
        # 抓到帧到页面改状态之间约有 3 帧管线延迟，实测换幕比计划晚 0.07~0.13s，这里提前补掉
        marks = [max(0.0, m - CAPTURE_LAG) for m in marks]
        delays = [max(0.0, (m - (clock() - ref['t0'])) * 1000) for m in marks]
        await page.evaluate("""(delays) => {
            window.__flips = [];
            const flip = () => {
                window.__flips.push(Date.now() / 1000);
                window.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', cancelable: true}));
            };
            delays.forEach(d => setTimeout(flip, d));
        }""", delays)
        await asyncio.sleep(max(0.0, ref['t0'] + end_t - clock()))
        flips = await page.evaluate('window.__flips || []')
        if flips:
            dev = max(abs(f - (ref['t0'] + m)) for f, m in zip(flips, marks))
            print(f'换幕校验：{len(flips)} 次 · 定时偏差最大 {dev * 1000:.0f}ms')
        await cdp.send('Page.stopScreencast')
        await page.wait_for_timeout(200)
        await browser.close()

    q.put(None)
    th.join()
    first = frames[0][0]
    span = frames[-1][0] - first
    out, med = [], 0.033
    if len(frames) > 1:
        g = sorted(frames[i + 1][0] - frames[i][0] for i in range(len(frames) - 1))
        med = g[len(g) // 2]
    for i, (t, p) in enumerate(frames):
        d = (frames[i + 1][0] - t) if i + 1 < len(frames) else max(end_t - (t - first), med)
        out.append((p, d))
    if abs(span - end_t) > 0.5:
        print(f'提示：画面实际跨度 {span:.1f}s，计划 {end_t:.1f}s（末帧已补齐到计划时长）')
    return out, frames, first


def probe_duration(path):
    log = run([FF, '-hide_banner', '-i', str(path), '-f', 'null', '-']).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', log)
    return (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))) if m else 0.0


def build_sequence(raw, first, fps, end_t, seq_dir):
    """把变帧率的抓屏帧铺成恒定 fps 的序列（硬链接，不占额外空间）。"""
    seq_dir.mkdir(exist_ok=True)
    n_out = max(1, round(end_t * fps))
    idx = 0
    for k in range(n_out):
        t = k / fps
        while idx + 1 < len(raw) and (raw[idx + 1][0] - first) <= t:
            idx += 1
        dst = seq_dir / f'{k:06d}.jpg'
        try:
            os.link(raw[idx][1], dst)
        except OSError:
            shutil.copyfile(raw[idx][1], dst)
    return n_out


def encode(seq_dir, out_mp4, fps):
    run([FF, '-hide_banner', '-y', '-framerate', str(fps), '-i', str(seq_dir / '%06d.jpg'),
         '-c:v', 'h264_mf', '-b:v', '16M', '-pix_fmt', 'yuv420p',
         '-movflags', '+faststart', str(out_mp4)])


def mean_db(path):
    """量一段音频的平均电平（dB），用来给 BGM 自动定标。"""
    log = run([FF, '-hide_banner', '-i', str(path), '-af', 'volumedetect', '-f', 'null', '-']).stderr
    m = re.search(r'mean_volume:\s*(-?[\d.]+) dB', log)
    return float(m.group(1)) if m else None


def bgm_gain(voice, music, below_db):
    """算出 BGM 要比人声低 below_db 分贝所需的增益。

    各自量平均电平再相减，这样用户换任何响度的音乐文件都不用重调参数。
    """
    v, m = mean_db(voice), mean_db(music)
    if v is None or m is None:
        print('提示：量电平失败，BGM 按 -18dB 固定增益处理')
        return -18.0
    gain = (v - below_db) - m
    print(f'BGM 电平：人声 {v:.1f}dB · 音乐 {m:.1f}dB · 增益 {gain:+.1f}dB'
          f'（音乐比人声低 {below_db:.0f}dB）')
    return gain


def bgm_graph(voice_label, music_label, dur, gain_db):
    """音乐铺满全片、压到人声之下、首尾淡入淡出。

    音乐靠输入端的 -stream_loop -1 循环（filter 里的 aloop 会挂死），这里只负责裁到片长。
    不做自动避让：这版剪映自带 ffmpeg 的 sidechaincompress 实测表现不可预期（同样的键电平，
    有的地方压 12dB 有的地方完全不压），所以用固定垫底电平，稳定可复现。
    """
    # amix 的 duration=longest 实测会多出约 0.8s（比最长输入还长），末尾再裁一刀钉死片长。
    return (f'[{music_label}]atrim=0:{dur:.3f},asetpts=N/SR/TB,'
            f'volume={gain_db:.2f}dB,afade=t=in:st=0:d=1.5,'
            f'afade=t=out:st={max(0.0, dur - 3.0):.3f}:d=3[bed];'
            f'[{voice_label}][bed]amix=inputs=2:duration=longest:normalize=0,'
            f'atrim=0:{dur:.3f},asetpts=N/SR/TB[aout]')


def mux(video, audio, out_mp4, lead_in, bgm=None, bgm_db=18.0):
    if bgm is None:
        run([FF, '-hide_banner', '-y', '-i', str(video), '-itsoffset', str(lead_in), '-i', str(audio),
             '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(out_mp4)])
        return
    dur = probe_duration(video)
    # 延迟不能靠 -itsoffset：它会把 lead_in 也加到 BGM 输入上，成片音频凭空长出一截。
    # 改成在滤镜里给旁白加等长静音，时间轴从 0 起，两条轨才对得齐。
    graph = (f'[1:a]adelay={int(lead_in * 1000)}:all=1[voice];'
             + bgm_graph('voice', '2:a', dur, bgm_gain(audio, bgm, bgm_db)))
    run([FF, '-hide_banner', '-y', '-i', str(video), '-i', str(audio),
         '-stream_loop', '-1', '-i', str(bgm),
         '-filter_complex', graph,
         '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
         '-movflags', '+faststart', str(out_mp4)])


def probe_audio_start(path):
    """量音轨的起点偏移（秒）——封面首帧版成片的旁白就是靠这个偏移做到「画面先出、旁白晚进」。"""
    log = run([FF, '-hide_banner', '-i', str(path), '-f', 'null', '-']).stderr
    m = re.search(r'Audio:.*?start ([\d.]+)', log)
    return float(m.group(1)) if m else 0.0


def add_bgm(video, bgm, out_mp4, bgm_db=18.0):
    """只给已有成片补 BGM（不重渲染画面，约 1 分钟）。

    封面首帧版成片的旁白是「音轨整体后移」实现的（音轨 start_time ≈ 2.28s）。滤镜会把这个
    偏移归零、又在写文件时扣掉，结果是旁白提前、片尾少一截。所以先把音轨时间戳显式压到 0
    （asetpts），再按偏移补 adelay —— 这样人声位置和总长都对得上。
    """
    dur = probe_duration(video)
    gain = bgm_gain(video, bgm, bgm_db)
    off = probe_audio_start(video)
    if off > 0.02:
        print(f'音轨起点偏移 {off:.2f}s —— 按原时间轴补回，旁白不提前、片尾不丢')
        voice = f'[0:a]asetpts=N/SR/TB,adelay={int(off * 1000)}:all=1[voice];'
    else:
        voice = '[0:a]asetpts=N/SR/TB[voice];'
    run([FF, '-hide_banner', '-y', '-i', str(video), '-stream_loop', '-1', '-i', str(bgm),
         '-filter_complex', voice + bgm_graph('voice', '1:a', dur, gain),
         '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
         '-movflags', '+faststart', str(out_mp4)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=str(MAT / 'AI雕兄-动效演示-竖屏.html'))
    ap.add_argument('--audio', help='配音 mp3（整篇一次读完）')
    ap.add_argument('--out', help='输出 mp4 路径')
    ap.add_argument('--preview', type=int, help='只渲前 N 幕（无配音，按页面自然节奏）')
    ap.add_argument('--lead-in', type=float, default=0.8, help='画面先出多久后进配音（秒）')
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--keep-frames', action='store_true')
    ap.add_argument('--bgm', help='背景音乐文件（铺满全片、垫在人声之下、首尾淡入淡出）')
    ap.add_argument('--bgm-db', type=float, default=18.0,
                    help='BGM 比人声低多少 dB（默认 18，越大音乐越轻）')
    ap.add_argument('--bgm-add', help='只给已有成片补 BGM，不重渲染画面')
    a = ap.parse_args()

    if a.bgm_add:
        if not a.bgm:
            sys.exit('补 BGM 需要同时给 --bgm')
        src = Path(a.bgm_add)
        dst = Path(a.out) if a.out else src.with_name(src.stem + '-带BGM.mp4')
        add_bgm(src, Path(a.bgm), dst, a.bgm_db)
        print(f'已补 BGM：{dst}  ({dst.stat().st_size / 1048576:.1f} MB)')
        return

    html_path = Path(a.html)
    scenes = load_scenes(html_path)
    n_all = len(scenes)
    if a.preview:
        scenes = scenes[:a.preview]
    n = len(scenes)
    print(f'幕数 {n} · 编码器 {Path(FF).name} @ {Path(FF).parent}')

    if a.audio:
        audio = Path(a.audio)
        total = probe_duration(audio)
        audio_end = total
        mark_times = None
        side = audio.with_suffix('.starts.json')          # 逐幕合成时附带的精确分幕表
        if side.exists():
            meta = json.loads(side.read_text(encoding='utf-8'))
            onsets = [float(x) for x in meta['starts']][:n]
            starts = [onsets[0]] + [max(onsets[i] - LEAD, onsets[i - 1] + 0.1)
                                    for i in range(1, len(onsets))]
            print(f'配音 {total:.1f}s · 音色 {meta.get("voice", "?")} · 精确分幕（逐幕合成 {len(onsets)} 幕）')
        else:
            total, chunks = audio_analysis(audio)
            starts, snapped = scene_starts(chunks, [s['chars'] for s in scenes])
            print(f'配音 {total:.1f}s · 语音块 {len(chunks)} · 边界吸附 {"开" if snapped else "关(退化为比例切)"}')
        mark_times = [a.lead_in + t for t in starts[1:]]
        end_t = a.lead_in + audio_end + TAIL
        for i, s in enumerate(scenes):
            end = starts[i + 1] if i + 1 < n else audio_end
            print(f"  {i+1:>2} {s['name'][:16]:<18} {end - starts[i]:6.1f}s  ({s['chars']:>3} 字)")
    else:
        durs = natural_durations(scenes)
        mark_times, t = [], a.lead_in
        for d in durs[:-1]:
            t += d
            mark_times.append(t)
        end_t = t + durs[-1] + TAIL
        print('模式：页面自然节奏（无配音）')

    out_mp4 = Path(a.out) if a.out else OUTDIR / ('预览.mp4' if a.preview else 'AI雕兄-竖屏-成片.mp4')
    silent = OUTDIR / (out_mp4.stem + '-无声.mp4')
    frames_dir = OUTDIR / '_frames'
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)

    covers = {'01': a.lead_in + 3.0, f'{n_all:02d}': end_t - 4.0}
    print(f'开始录制：{end_t:.1f}s ...')
    t_start = time.perf_counter()
    frames, raw, first_ts = asyncio.run(record(html_path, mark_times, end_t, frames_dir))
    real = time.perf_counter() - t_start
    gaps = sorted(d for _, d in frames)
    med = gaps[len(gaps) // 2] * 1000 if gaps else 0
    p95 = gaps[int(len(gaps) * 0.95)] * 1000 if gaps else 0
    janky = sum(1 for g in gaps if g > 0.1)
    print(f'抓到 {len(frames)} 帧 · 耗时 {real:.1f}s · 平均 {len(frames)/max(real,.001):.1f} fps · '
          f'帧间隔 中位 {med:.0f}ms / P95 {p95:.0f}ms · >100ms 的停顿 {janky} 次')
    if frames[0][0].stat().st_size < 20000:
        print('警告：首帧过小，可能是黑屏（GPU 参数不兼容），检查 --use-angle 设置')

    OUTDIR.mkdir(exist_ok=True)
    n_out = build_sequence(raw, first_ts, a.fps, end_t, frames_dir / 'seq')
    print(f'铺成 {n_out} 帧 @ {a.fps}fps = {n_out / a.fps:.2f}s')
    encode(frames_dir / 'seq', silent, a.fps)
    got = probe_duration(silent)
    print(f'时长校对：计划 {end_t:.1f}s · 成片 {got:.1f}s · 偏差 {got - end_t:+.2f}s')
    if abs(got - end_t) > 0.5:
        print('警告：时长偏差超过 0.5 秒，音画会整体错位')
    for label, t in covers.items():
        _, src = min(raw, key=lambda f: abs((f[0] - first_ts) - t))
        shutil.copyfile(src, OUTDIR / f'封面-{label}.jpg')
        print(f'  封面-{label}.jpg')
    if a.audio:
        mux(silent, Path(a.audio), out_mp4, a.lead_in,
            Path(a.bgm) if a.bgm else None, a.bgm_db)
        print(f'成片：{out_mp4}  ({out_mp4.stat().st_size/1048576:.1f} MB)'
              + (f'  · BGM {Path(a.bgm).name}（人声下 {a.bgm_db:g}dB）' if a.bgm else ''))
    else:
        silent.replace(out_mp4)
        print(f'无声画面：{out_mp4}  ({out_mp4.stat().st_size/1048576:.1f} MB)')
    if not a.keep_frames:
        shutil.rmtree(frames_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
