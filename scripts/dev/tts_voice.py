# -*- coding: utf-8 -*-
"""用微软神经语音（edge-tts）生成配音：--sample 出试听样音；否则逐幕合成再拼接。

逐幕合成的好处：每幕的起止时刻是算准的，渲染脚本读同名 .starts.json 直接按精确分幕卡点，
不再依赖语音停顿检测。用法：
  python3 scripts/dev/tts_voice.py --sample                    # 3 个男声各读第 1 幕
  python3 scripts/dev/tts_voice.py --voice zh-CN-YunyangNeural  # 整篇合成 配音/配音-最终.mp3

换片子（如 9问快闪）时给 --html 指动效页：幕文本按页里的 <p> 取、幕间静默按每幕动画时长自适应；
--sample 配 --html 就是读该页前两幕，配 --tag 给样音加后缀，避免盖掉长版样音。"""
import argparse, asyncio, hashlib, json, re, shutil, sys
from pathlib import Path
import edge_tts

sys.path.insert(0, str(Path(__file__).parent))
from render_video import FF, run, probe_duration
from use_my_voice import scene_needs

ROOT = Path(__file__).resolve().parents[2]
MAT = ROOT / '资料' / '视频' / 'AI雕兄口播稿'
PASTE = MAT / 'AI雕兄-配音-粘贴版.txt'
OUTDIR = MAT / '配音'
SAMPLES = ['zh-CN-YunyangNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural']
SAMPLE_TXT = ('一个人做小红书，凌晨还在发笔记——三个月过去，一个咨询都没有。\n'
              '不是你不行。是你从头到尾，都在瞎使劲。')
GAP = 0.7       # 幕间静默（秒）
SR = 44100


async def speak(text, voice, out, rate, tries=4):
    """edge-tts 是社区接口，偶发抽风（NoAudioReceived），隔几秒重试即可。"""
    for k in range(tries):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(str(out))
            if out.exists() and out.stat().st_size > 1000:
                return
            err = '返回空音频'
        except Exception as e:
            err = f'{type(e).__name__}: {e}'
        wait = 3 * (k + 1)
        print(f'    合成失败（{err}），{wait}s 后重试 {k + 1}/{tries - 1}')
        await asyncio.sleep(wait)
    raise SystemExit(f'语音合成失败：{err}')


def scene_texts(html_path):
    """按动效页取每幕口播文本（.notes-src 里的 <p>，保留标点）。"""
    html = html_path.read_text(encoding='utf-8')
    out = []
    for _name, block in re.findall(r'<section class="scene" data-name="([^"]+)">(.*?)</section>',
                                   html, re.S):
        ps = [re.sub(r'<[^>]+>', '', p).strip() for p in re.findall(r'<p>(.*?)</p>', block, re.S)]
        out.append('\n'.join(p for p in ps if p))
    return out


def cache_path(cache, text, voice, rate):
    """同一句 + 同一音色语速就复用上次的合成结果，改词重跑时只补改动的那几幕。"""
    return cache / (hashlib.md5(f'{voice}|{rate}|{text}'.encode()).hexdigest()[:12] + '.mp3')


def to_wav(src, dst):
    run([FF, '-hide_banner', '-y', '-i', str(src), '-ar', str(SR), '-ac', '1',
         '-c:a', 'pcm_s16le', str(dst)])


def join_wav(pieces, gap_wavs, out_wav):
    """把各幕 wav 与幕间静默按顺序拼成一个 wav（纯 PCM 拼接，不经过解复用器）。"""
    import wave
    with wave.open(str(out_wav), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        for i, p in enumerate(pieces):
            r = wave.open(str(p), 'rb')
            w.writeframes(r.readframes(r.getnframes()))
            r.close()
            if i < len(gap_wavs):
                g = wave.open(str(gap_wavs[i]), 'rb')
                w.writeframes(g.readframes(g.getnframes()))
                g.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', help='音色，如 zh-CN-YunyangNeural')
    ap.add_argument('--rate', default='+0%', help='语速，如 +8%%')
    ap.add_argument('--gap', type=float, default=GAP, help=f'幕间静默秒数（默认 {GAP}）')
    ap.add_argument('--sample', action='store_true', help='只读第 1 幕出试听样音')
    ap.add_argument('--out', help='整篇输出 mp3 路径')
    ap.add_argument('--html', help='动效页：按页里的幕取文本（不传则读长版的粘贴稿）')
    ap.add_argument('--tag', default='', help='样音文件名后缀，如 -9问')
    a = ap.parse_args()

    if a.sample:
        sd = OUTDIR / '样音'
        sd.mkdir(parents=True, exist_ok=True)
        tag = a.tag or ('' if a.rate == '+0%' else '-' + a.rate.lstrip('+').replace('%', ''))
        text = SAMPLE_TXT
        if a.html:
            sc = scene_texts(Path(a.html))
            text = '\n'.join(sc[:2])
        for v in ([a.voice] if a.voice else SAMPLES):
            out = sd / (v.split('-')[-1].replace('Neural', '') + tag + '.mp3')
            asyncio.run(speak(text, v, out, a.rate))
            print(f'样音 {out.name}  {probe_duration(out):.1f}s  ({v})')
        return

    if not a.voice:
        sys.exit('整篇合成需指定 --voice')

    needs = None
    if a.html:
        scenes = scene_texts(Path(a.html))
        needs = scene_needs(Path(a.html))
    else:
        scenes = [s for s in PASTE.read_text(encoding='utf-8').strip().split('\n\n') if s.strip()]
    out_mp3 = Path(a.out) if a.out else OUTDIR / '配音-最终.mp3'
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_mp3.parent / '_tts_tmp'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    cache = out_mp3.parent / '_tts_cache'
    cache.mkdir(exist_ok=True)

    def sil_wav(sec):
        p = tmp / f'sil-{sec:.3f}.wav'
        if not p.exists():
            run([FF, '-hide_banner', '-y', '-f', 'lavfi', '-i', f'anullsrc=r={SR}:cl=mono',
                 '-t', f'{sec:.3f}', '-c:a', 'pcm_s16le', str(p)])
        return p

    durs, pieces = [], []
    for i, s in enumerate(scenes, 1):
        mp3 = cache_path(cache, s, a.voice, a.rate)
        wav = tmp / f's{i:02d}.wav'
        for attempt in (1, 2):
            if not mp3.exists():
                asyncio.run(speak(s, a.voice, mp3, a.rate))
            try:
                to_wav(mp3, wav)
                break
            except SystemExit:
                if attempt == 2:
                    raise
                print('    缓存里的音频读不出来（上次中断留下的半截文件），删掉重合成')
                mp3.unlink(missing_ok=True)
        durs.append(probe_duration(wav))
        pieces.append(wav)

    # 幕间静默：至少 --gap，且要够该幕动画播完（--html 模式才拿得到动画时长）
    gaps = [round(max(a.gap, needs[i]['need'] - durs[i]), 3) for i in range(len(durs) - 1)] \
        if needs else [a.gap] * (len(durs) - 1)
    starts, t = [], 0.0
    for i, d in enumerate(durs):
        starts.append(round(t, 3))
        print(f'  {i + 1:>2} 幕  {d:5.1f}s  起 {starts[-1]:6.1f}s'
              + (f'  幕间 {gaps[i]:.2f}s' if i < len(gaps) else ''))
        t += d + (gaps[i] if i < len(gaps) else 0.0)

    # 直接拼 PCM：concat 解复用器会截断；剪映的 mp3_mf 编长音频也不可靠，逐个试到能用为止
    whole = tmp / 'whole.wav'
    join_wav(pieces, [sil_wav(g) for g in gaps], whole)
    expect = sum(durs) + sum(gaps)
    base = out_mp3.with_suffix('')
    total, out_audio = 0.0, None
    for codec, ext in (('mp3_mf', '.mp3'), ('aac', '.m4a')):
        cand = base.with_suffix(ext)
        run([FF, '-hide_banner', '-y', '-i', str(whole), '-c:a', codec, '-b:a', '192k', str(cand)])
        total = probe_duration(cand)
        if abs(total - expect) <= 0.5:
            out_audio = cand
            break
        print(f'提示：{codec} 编码长度 {total:.1f}s ≠ 预期 {expect:.1f}s，换下一种编码')
    if out_audio is None:
        out_audio = base.with_suffix('.wav')
        shutil.copyfile(whole, out_audio)
        total = probe_duration(out_audio)
    meta = {'voice': a.voice, 'rate': a.rate, 'gap': a.gap, 'gaps': gaps, 'total': total,
            'starts': starts, 'durations': durs}
    out_audio.with_suffix('.starts.json').write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'配音：{out_audio}  {total:.1f}s（{total / 60:.1f} 分钟）· 分幕表 {out_audio.stem}.starts.json')
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
