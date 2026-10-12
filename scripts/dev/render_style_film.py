# -*- coding: utf-8 -*-
"""按一行风格配置出成片：调风格.html 里逐帧编码（无声）→ ffmpeg 合上配音。

配置就是面板底下那行（点「复制配置」拿到的），直接贴进来：
  python3 scripts/dev/render_style_film.py --cfg "bg=paper; accent=#B5542F; font=serif; em=swipe; layouts=center,left,list,number; voice=zh-CN-YunxiNeural"
不传 --cfg 就用面板默认（A 深色品牌橙 + 晓晓）。

配置行里的 voice 决定两件事：① 合哪条配音（配音-<稿子>-<短名>.m4a）② 分幕时间轴按这条音色的
实际语速重算（不同音色念同一句长短不一样，硬套原时间轴会声画不同步）。
没配过音的先用 tts_voice.py 出一条，报错信息里会给出完整命令。

--script 除了内置的 demo / sample，也可以是新笔记（gen_sample.py --as <key> 那套，
文件按 timeline-<key>.js / 配音-<key>-<短名>.m4a / <key>文案.html 命名）。
输出：资料/视频/客户模板样片/成片-<时间戳>.mp4
"""
import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # Windows 控制台默认 GBK
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / '资料' / '视频' / '客户模板样片'
PAGE = DIR / '调风格.html'

# 中文短名跟 客户模板样片/voices.js 的清单一一对应，那边加音色这边也要加
VOICE_NAMES = {
    'zh-CN-XiaoxiaoNeural': '晓晓', 'zh-CN-XiaoyiNeural': '晓伊', 'zh-CN-YunxiNeural': '云希',
    'zh-CN-YunyangNeural': '云扬', 'zh-CN-YunjianNeural': '云健',
}
DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
# 稿子 → (时间轴全局变量, 配音文件名前缀, 幕页, 时间轴 js)；新笔记（--as 出来的）按同一套约定推
SCRIPTS = {
    'demo':   ('TIMELINE_DEMO', '配音-演示', '演示文案.html', 'timeline-demo.js'),
    'sample': ('TIMELINE', '配音-样片', '样片文案.html', 'timeline.js'),
}


def script_of(key):
    gvar, vo_pre, page, tl = SCRIPTS.get(key) or (
        'TIMELINE_' + key.upper().replace('-', '_'), f'配音-{key}', f'{key}文案.html', f'timeline-{key}.js')
    return gvar, vo_pre, page, DIR / tl


TTS_ARGS = '--rate "+20%" --gap 0.5'          # 跟已出的样片同口径


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        raise SystemExit('命令失败：' + ' '.join(str(c) for c in cmd) + '\n' + (p.stderr or '')[-1500:])
    return p.stdout, p.stderr


def cfg_voice(line, default=DEFAULT_VOICE):
    for p in line.split(';'):
        k, _, v = p.partition('=')
        if k.strip() == 'voice':
            return v.strip() or default
    return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cfg', default='', help='面板「复制配置」那行；不传用默认')
    ap.add_argument('--script', default='demo', help='demo / sample，或新笔记的标识（--as 那个）')
    ap.add_argument('--out', default='', help='输出 mp4 路径；不传按时间戳命名')
    ap.add_argument('--no-audio', action='store_true', help='只出无声画面（配音自己合）')
    a = ap.parse_args()

    gvar, vo_pre, page, tl_path = script_of(a.script)
    if not tl_path.exists():
        raise SystemExit(
            f'没有这套稿子的时间轴 {tl_path}，先在「调风格.html」粘口播稿 → 生成分幕 → 下载分幕 JSON，再跑：\n'
            f'  python3 scripts/dev/gen_sample.py --scenes <分幕.json> --as {a.script} --timeline')
    voice = cfg_voice(a.cfg)
    short = VOICE_NAMES.get(voice)
    if not short:
        raise SystemExit(f'音色 {voice} 不在清单里（{"/".join(VOICE_NAMES.values())}）；'
                         f'要加就先加进 voices.js 和本脚本的 VOICE_NAMES')
    vo_path = DIR / f'{vo_pre}-{short}.m4a'
    starts_json = vo_path.with_suffix('.starts.json')
    out = Path(a.out) if a.out else DIR / ('成片-' + datetime.datetime.now().strftime('%m%d-%H%M') + '.mp4')
    silent = out.with_name(out.stem + '.无声.mp4')

    if not a.no_audio and not starts_json.exists():
        raise SystemExit(
            f'「{short}」还没给这套稿子配过音，先跑：\n'
            f'  python3 scripts/dev/tts_voice.py --html "{DIR / page}" --voice {voice} '
            f'{TTS_ARGS} --out "{vo_path}"\n'
            f'再跑本脚本（配音会落在 {vo_path.name}）')

    # 这条音色的实际分幕时刻：画面时间轴按它重算，声音才不会跑在画面前面
    recut = None
    if starts_json.exists():
        d = json.loads(starts_json.read_text(encoding='utf-8'))
        recut = {'starts': d['starts'], 'total': d['total'], 'voice': voice}
        print(f'配音 {short} · {d["total"]:.2f}s · 语速 {d.get("rate", "?")}')
    else:
        print(f'配音 {short}：没有分幕表，按面板自带时间轴出画面')

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={'width': 1500, 'height': 900}, accept_downloads=True).new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(PAGE.as_uri())
        pg.wait_for_timeout(800)
        if errs:
            raise SystemExit('面板自身报错：' + errs[0])
        pg.add_script_tag(path=str(tl_path))      # 把这条稿子的时间轴挂上去（面板自带的只是样片）
        if a.script not in SCRIPTS:
            print(f'稿子 {a.script}：{tl_path.name}')

        head, dur, lays = pg.evaluate("""([gf, line, recut]) => {
            const TL = window[gf];
            if (!TL) return [0, 0, '⚠️'];
            window._useTL(TL);
            if (line) {
                const c = Renderer.parseCfg(line);
                (c.layouts || '').split(',').map(s => s.trim())
                    .forEach((k, i) => { if (TL.scenes[i]) TL.scenes[i].layout = k || 'center'; });
                delete c.layouts;
                window._draw(0, c);
            }
            if (recut) {
                const H = TL.head, T = TL.tail, last = TL.scenes.length - 1;
                TL.scenes.forEach((s, i) => {
                    s.start = H + recut.starts[i];
                    s.end = i < last ? H + recut.starts[i + 1] : H + recut.total + T;
                });
                TL.audio = recut.total; TL.dur = H + recut.total + T; TL.voice = recut.voice;
            }
            return [TL.head, TL.dur, TL.scenes.map(s => s.layout || 'center').join(',')];
        }""", [gvar, a.cfg, recut])
        if lays == '⚠️':
            raise SystemExit(f'{tl_path.name} 里没有 window.{gvar}，核一下变量名')

        # 内置字体没就绪就开编，整片会用回退字体画，客户机上没法补
        status = pg.evaluate("""async () => {
            await window._fonts();
            return [...document.fonts].filter(f => f.family.indexOf('Noto') >= 0)
                .map(f => f.family + ':' + f.status).join(' ');
        }""")
        print('内置字体：', status or '⚠️ 一个都没注册，复核 fonts.js')
        if 'loaded' not in status:
            raise SystemExit('内置字体没加载上，先修 fonts.js 再出片')

        print(f'稿子 {a.script} · {dur:.2f}s · 版式 {lays} · 编码 {round(dur * 30)} 帧…')
        pg.set_default_timeout(600000)
        with pg.expect_download(timeout=600000) as d:
            pg.click('#export')
        d.value.save_as(str(silent))
        b.close()
    print('画面 →', silent.name, f'{silent.stat().st_size / 1048576:.1f}MB')

    if a.no_audio:
        silent.replace(out)
        print('成片 →', out)
        return

    if not vo_path.exists():
        raise SystemExit(f'没有配音 {vo_path}')
    run(['ffmpeg', '-hide_banner', '-y', '-i', str(silent), '-itsoffset', f'{head:g}', '-i', str(vo_path),
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(out)])
    silent.unlink()

    js, _ = run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', str(out)])
    info = json.loads(js)
    v = next(s for s in info['streams'] if s['codec_type'] == 'video')
    au = next(s for s in info['streams'] if s['codec_type'] == 'audio')
    _, err = run(['ffmpeg', '-hide_banner', '-i', str(out), '-af', 'volumedetect', '-f', 'null', '-'])
    mean = next((l.split(']')[1].strip() for l in err.splitlines() if 'mean_volume' in l), '?')
    print(f'成片 → {out}')
    print(f'  {v["width"]}x{v["height"]} · {v["codec_name"]} · {float(info["format"]["duration"]):.1f}s · '
          f'{out.stat().st_size / 1048576:.1f}MB · 配音 {short} {au["codec_name"]}（{mean}）')


if __name__ == '__main__':
    main()
