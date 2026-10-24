/* audio.js — 逐幕配音 → PCM → AAC，跟画面混成一条 MP4；顺手回每幕的精确秒数。
 *
 * 为什么要逐幕合成：每幕的起止时刻是算出来的，不是靠停顿检测猜的。换音色/换语速后
 * 整条时间轴按新秒数重排（跟 Python 管线 tts_voice.py → .starts.json → timeline.js 同一口径）。
 *
 * 用法：
 *   const { parts, secs } = await Voice.speak(scenes, { voice, rate, onProgress });
 *   const tl = Voice.timeline(scenes, secs);              // 每幕 start/end + 总长
 *   const pcm = Voice.pcm(parts, { gap, head, dur: tl.dur });
 *   Encoder.encode({ canvas, dur: tl.dur, draw, audio: { pcm, sampleRate: Voice.SR } });
 */
(function (g) {
  'use strict';

  /* 服务端给的是 24kHz 单声道 mp3，但系统 AAC 编码器不一定认 24k（Windows 上实测：24k 不支持、
     44.1k 支持）。所以挑一个这台机器编得动的采样率，让 AudioContext 在解码时顺手重采样。 */
  const RATES = [24000, 44100, 48000];
  const SR = 24000;      // 默认值，真正用哪个看 pickRate()
  const GAP = 0.5;       // 幕间静默（秒），跟 tts_voice.py --gap 0.5 同口径
  const HEAD = 0.8;      // 片头留白（配音从这一秒开始）
  const TAIL = 1.4;      // 片尾留白
  const BITRATE = 96000;

  let picked = 0;
  async function pickRate() {
    if (picked) return picked;
    if (!g.AudioEncoder) throw new Error('这个浏览器没有 WebCodecs 音频编码（要用 Edge / Chrome 最新版）');
    for (const sr of RATES) {
      try {
        const r = await AudioEncoder.isConfigSupported(
          { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 1, bitrate: BITRATE });
        if (r && r.supported) { picked = sr; return sr; }
      } catch (e) { /* 换下一个采样率试 */ }
    }
    throw new Error('这台机器上没有可用的 AAC 编码器，出不了带配音的片子');
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 逐幕念。回 AudioBuffer 数组（在内存里，不落盘）+ 每幕秒数。 */
  async function speak(scenes, o) {
    o = o || {};
    const sr = o.sampleRate || await pickRate();
    const gap = o.gap === undefined ? GAP : o.gap;
    const rate = o.rate || '+20%';
    const AC = g.AudioContext || g.webkitAudioContext;
    const ac = new AC({ sampleRate: sr });
    const parts = [], secs = [];
    try {
      for (let i = 0; i < scenes.length; i++) {
        const text = (scenes[i].text || (scenes[i].lines || []).join('')).trim();
        if (!text) { parts.push(ac.createBuffer(1, Math.round(gap * sr), sr)); secs.push(gap); continue; }
        const mp3 = await EdgeTTS.synth(text, { voice: o.voice, rate });
        parts.push(await ac.decodeAudioData(mp3.buffer.slice(0)));
        secs.push(parts[parts.length - 1].duration);
        if (o.onProgress) o.onProgress(i + 1, scenes.length);
      }
    } finally {
      try { await ac.close(); } catch (e) { /* 关不掉也不影响出片 */ }
    }
    return { parts, secs, sampleRate: sr };
  }

  /* 拿真实秒数把幕重排一遍：幕 i 从「片头 + 前面几幕 + 中间静默」开始。 */
  function timeline(scenes, secs, o) {
    o = o || {};
    const gap = o.gap === undefined ? GAP : o.gap;
    const head = o.head === undefined ? HEAD : o.head;
    const tail = o.tail === undefined ? TAIL : o.tail;
    let at = head;
    const out = scenes.map((s, i) => {
      const st = at, en = at + secs[i];
      at = en + (i < scenes.length - 1 ? gap : 0);
      return Object.assign({}, s, { start: +st.toFixed(3), end: +en.toFixed(3) });
    });
    const dur = +(at + tail).toFixed(3);
    return { head, tail, gap, dur, scenes: out, audio: +(at - head).toFixed(3) };
  }

  /* 拼成一条连续 PCM：片头静音 + 各幕 + 幕间静默，末尾补到整片长度。 */
  function pcm(parts, o) {
    o = o || {};
    const gap = o.gap === undefined ? GAP : o.gap;
    const head = o.head === undefined ? HEAD : o.head;
    const sr = o.sampleRate || picked || SR;
    const dur = o.dur;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    let at = Math.round(head * sr);
    for (let i = 0; i < parts.length; i++) {
      const buf = parts[i];
      const src = buf.getChannelData(0);
      const m = Math.min(src.length, n - at);
      if (m > 0) out.set(src.subarray(0, m), at);
      at += src.length;
      if (i < parts.length - 1) at += Math.round(gap * sr);
      if (at >= n) break;
    }
    return out;
  }

  /* ══ 混剪那一路的另外两条轨：背景音乐 + 跟字弹出来那一下响的音效 ══
     三条轨各自拼成「整片长」的 PCM，再按权重相加夹平——录制路和编码路拿的是同一份混好的 pcm，
     不用各修一遍混音。音量和案例那一路同尺度：配音 1 ／ 音乐 0.13。 */

  function offCtx(sr, secs) {
    const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctor) return null;
    return new Ctor(1, Math.max(1, Math.round(sr * secs)), sr);
  }
  async function renderOff(octx) {
    return await new Promise((res, rej) => {
      const p = octx.startRendering();
      if (p && p.then) p.then(res, rej);
      else octx.oncomplete = e => res(e.renderedBuffer);
    });
  }
  function tone(octx, dest, freq, t0, dur, type, gain) {
    if (!(dur > 0.06)) return;
    const o = octx.createOscillator();
    o.type = type || 'triangle';
    o.frequency.value = freq;
    const g = octx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain || 0.15, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function kick(octx, dest, t0, dur) {
    if (!(dur > 0.06)) return;
    const o = octx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t0);
    o.frequency.exponentialRampToValueAtTime(48, t0 + Math.min(0.12, dur));
    const g = octx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  /* 音乐循环种子 16 秒：1＝安静钢琴 C-Am-F-G 琶音；2＝轻快节奏 底鼓＋八分拨弦（跟案例那一路同一套） */
  const BGM_SEED = 16;
  async function bgm(kind, dur, sampleRate) {
    const sr = sampleRate || picked || SR;
    if (!kind || kind === 'off' || !(dur > 0.5)) return null;
    const octx = offCtx(sr, BGM_SEED);
    if (!octx) return null;
    const dest = octx.destination;
    if (kind === 'piano') {
      const CH = [[130.81, 261.63, 329.63, 392], [110, 220, 261.63, 329.63],
                  [174.61, 349.23, 440, 523.25], [196, 392, 493.88, 587.33]];
      for (let c = 0; c < 4; c++) {
        CH[c].forEach((f, n) => {
          const ts = c * 4 + n * 0.55;
          tone(octx, dest, f, ts, Math.min(2.2, BGM_SEED - ts - 0.05), 'triangle', 0.16);
        });
      }
    } else if (kind === 'beat') {
      const MEL = [329.63, 392, 440, 493.88, 440, 392, 329.63, 392];
      for (let b = 0; b * 0.5 < BGM_SEED - 0.1; b++) {
        const t0 = b * 0.5;
        kick(octx, dest, t0, Math.min(0.32, BGM_SEED - t0 - 0.02));
        tone(octx, dest, MEL[b % MEL.length], t0, Math.min(0.45, BGM_SEED - t0 - 0.02), 'triangle', 0.12);
      }
    } else return null;
    const seed = (await renderOff(octx)).getChannelData(0);
    const out = new Float32Array(Math.round(dur * sr));
    for (let at = 0; at < out.length; at += seed.length) {
      out.set(seed.subarray(0, Math.min(seed.length, out.length - at)), at);
    }
    const fade = Math.min(out.length, Math.round(sr * 0.9));   // 收尾淡出，别硬切
    for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
    return out;
  }
  /* 混剪那一路的音效＝跟字弹出来那一下响，不跟换屏响（老板 10-23）：
     这一句讲坑 → 闷一记「咚」；讲好处 → 轻亮一声「啵」；平常一句 → 极轻带一下。
     响的时刻＝styles.js 里重点词刷出来那一刻（sc.start + .42）。 */
  const EM_AT = 0.42;
  function thump(octx, dest, t0) {
    const o = octx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(105, t0);
    o.frequency.exponentialRampToValueAtTime(44, t0 + 0.16);
    const g = octx.createGain();
    g.gain.setValueAtTime(0.42, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + 0.26);
  }
  function blip(octx, dest, t0) {                        // 「啵」：两下上行的亮音，短
    tone(octx, dest, 784, t0, 0.1, 'triangle', 0.2);
    tone(octx, dest, 1175, t0 + 0.06, 0.14, 'triangle', 0.15);
  }
  function tick(octx, dest, t0) {                        // 平常一句：极轻带一下，别吵配音
    tone(octx, dest, 1568, t0, 0.07, 'sine', 0.07);
  }
  const SFX_BY_TONE = { low: thump, high: blip, flat: tick };
  /** level: 'off' 不要 ／ 其余（'word'，含旧档里的 'cut'／'cutland'）＝跟字响 */
  async function sfx(level, tl, sampleRate) {
    if (!level || level === 'off' || !tl || !tl.scenes || !tl.scenes.length) return null;
    const sr = sampleRate || picked || SR;
    const dur = Number(tl.dur) || 0;
    if (!(dur > 0.5)) return null;
    const marks = [];
    tl.scenes.forEach(sc => {
      const t = sc.start + EM_AT;
      if (!(t > 0) || t > dur - 0.3) return;
      marks.push({ t, kind: SFX_BY_TONE[sc.tone] ? sc.tone : 'flat' });
    });
    if (!marks.length) return null;
    const octx = offCtx(sr, dur);
    if (!octx) return null;
    const dest = octx.destination;
    marks.forEach(m => SFX_BY_TONE[m.kind](octx, dest, m.t));
    return (await renderOff(octx)).getChannelData(0);
  }
  /** 多条轨混成一条：tracks = [{ pcm, gain }]，短的用原样长度、总长取最长的一条 */
  function mix(tracks) {
    const list = (tracks || []).filter(t => t && t.pcm && t.pcm.length);
    if (!list.length) return new Float32Array(0);
    let n = 0;
    list.forEach(t => { n = Math.max(n, t.pcm.length); });
    if (list.length === 1 && (list[0].gain === undefined || list[0].gain === 1)) return list[0].pcm;
    const out = new Float32Array(n);
    for (const t of list) {
      const g = t.gain === undefined ? 1 : (Number(t.gain) || 0);
      const a = t.pcm;
      for (let i = 0; i < a.length; i++) out[i] += a[i] * g;
    }
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      out[i] = v > 0.98 ? 0.98 : (v < -0.98 ? -0.98 : v);
    }
    return out;
  }

  /* 把整条 PCM 编成 AAC 交给 muxer。分段 flush 的道理跟视频那边一样：别轮询队列。 */
  async function feed(enc, pcmData, sampleRate) {
    const sr = sampleRate || SR;
    const BLK = Math.round(sr / 10);          // 100ms 一块
    let err = '';
    for (let at = 0; at < pcmData.length; at += BLK) {
      if (err) throw new Error('音频编码报错：' + err);
      const frames = Math.min(BLK, pcmData.length - at);
      const data = new AudioData({
        format: 'f32-planar', sampleRate: sr, numberOfFrames: frames, numberOfChannels: 1,
        timestamp: Math.round(at * 1e6 / sr),
        data: pcmData.subarray(at, at + frames),
      });
      enc.encode(data);
      data.close();
      if ((at / BLK) % 40 === 39) await enc.flush();
    }
    await enc.flush();
  }

  /* 一步到位：编整条 PCM，chunk 直接进 muxer。 */
  async function encodeTo(muxer, pcmData, sampleRate) {
    const sr = sampleRate || SR;
    let err = '';
    const enc = new AudioEncoder({
      output: (c, m) => muxer.addAudioChunk(c, m),
      error: e => { err = String((e && e.message) || e); },
    });
    enc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: 1, bitrate: BITRATE });
    await feed(enc, pcmData, sr);
    enc.close();
    if (err) throw new Error('音频编码报错：' + err);
    await sleep(0);
  }

  g.Voice = { SR, RATES, GAP, HEAD, TAIL, speak, timeline, pcm, pickRate, encodeTo, mix, bgm, sfx };
})(window);
