/* encoder.js — canvas → H.264 MP4（WebCodecs + mp4-muxer），B2 链路的编码段
 *
 * 两个实测结论（别改回去）：
 *   · 不要用轮询 encodeQueueSize 来节流 —— 实测 152ms/帧 vs 23.5ms/帧
 *   · 用分段 flush：每 CHUNK 帧 await enc.flush()，编码器成批干，队列自然不会涨
 *   · 拿「同一张画面」测速度会得出假结果（同帧编码极快），要测就测真实变化画面
 *
 * 用法：const blob = await Encoder.encode({ canvas, dur, draw, onProgress })
 *   draw(ctx, t) 负责把第 t 秒的画面画到 canvas 上；canvas 必须是 1080×1920
 */
(function (global) {
  'use strict';

  const W = 1080, H = 1920, FPS = 30, BITRATE = 8_000_000, CHUNK = 40;
  let cached = null;

  async function pickCodec(preferHw) {
    if (cached && !preferHw) return cached;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.420028']) {
      const cfg = { codec, width: W, height: H, bitrate: BITRATE, framerate: FPS, latencyMode: 'quality' };
      if (preferHw) cfg.hardwareAcceleration = 'prefer-hardware';
      try {
        if ((await VideoEncoder.isConfigSupported(cfg)).supported) {
          if (!preferHw) cached = cfg;
          return cfg;
        }
      } catch (e) { /* 换下一个 codec 试 */ }
    }
    return null;
  }

  async function encode(o) {
    const cv = o.canvas;
    const ctx = cv.getContext('2d', { alpha: false });
    const total = Math.round(o.dur * FPS);
    const cfg = o.codec || await pickCodec(false);
    if (!cfg) throw new Error('这台机器上没有可用的 H.264 编码器');

    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxCfg = { target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' };
    const sr = (o.audio && o.audio.sampleRate) || 24000;
    if (o.audio) muxCfg.audio = { codec: 'aac', numberOfChannels: 1, sampleRate: sr };
    const muxer = new Mp4Muxer.Muxer(muxCfg);
    let encErr = '';
    const enc = new VideoEncoder({
      output: (c, m) => muxer.addVideoChunk(c, m),
      error: e => { encErr = String((e && e.message) || e); },
    });
    enc.configure(cfg);

    const t0 = performance.now();
    for (let i = 0; i < total; i++) {
      if (encErr) throw new Error('编码器报错：' + encErr);
      o.draw(ctx, i / FPS);
      const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(vf, { keyFrame: i % 30 === 0 });
      vf.close();
      if ((i + 1) % CHUNK === 0) await enc.flush();
      if (o.onProgress && i % 10 === 0) o.onProgress(i + 1, total, (performance.now() - t0) / 1000);
    }
    await enc.flush();
    enc.close();

    if (o.audio) {                       // 配音跟在画面后面编；muxer 按时间戳排，谁先谁后不影响
      if (o.onPhase) o.onPhase('audio');
      await global.Voice.encodeTo(muxer, o.audio.pcm, sr);
    }
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  }

  function dl(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  global.Encoder = { W, H, FPS, BITRATE, pickCodec, encode, dl };
})(window);
