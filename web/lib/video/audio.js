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

  g.Voice = { SR, RATES, GAP, HEAD, TAIL, speak, timeline, pcm, pickRate, encodeTo };
})(window);
