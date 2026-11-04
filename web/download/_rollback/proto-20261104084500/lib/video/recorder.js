/* recorder.js — 边播边录兜底（只在没有 WebCodecs 的网页上用，比如公网 http）
 *
 * 做法：把现成的时间轴按真实速度画到 canvas，同时用浏览器自带 MediaRecorder 录下来。
 * 音轨只接传进来的合成配音（PCM），画面轨只接 canvas；全程不调用 getUserMedia，
 * 所以麦克风、系统声、旁边人说话都不会进片子。录的时候可以同时从扬声器放出来（monitor）。
 *
 * 用法：
 *   const rec = Recorder.start({ canvas, dur, draw, pcm, sampleRate, audioContext, onProgress });
 *   const { blob, ext } = await rec.promise;
 *   rec.cancel('已停下');          // 「⏹ 停」/ 录制中切走标签页
 */
(function (g) {
  'use strict';

  const MIMES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  function pickMime() {
    if (!g.MediaRecorder || typeof g.MediaRecorder.isTypeSupported !== 'function') return '';
    for (const m of MIMES) {
      try { if (g.MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return '';
  }

  function start(o) {
    let cancelled = false, why = '';
    const ctl = {
      get cancelled() { return cancelled; },
      get reason() { return why; },
      cancel(reason) {
        if (!cancelled) { cancelled = true; why = String(reason || '已停下'); }
      },
    };
    return { promise: run(o || {}, ctl), cancel: ctl.cancel };
  }

  async function run(o, ctl) {
    const cv = o.canvas;
    if (!cv || typeof cv.captureStream !== 'function') throw new Error('没有可录的画面');
    if (!g.MediaRecorder) throw new Error('这个浏览器没有录像功能（要用 Edge / Chrome 最新版）');
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) throw new Error('这个浏览器没有声音处理功能');
    const pcm = o.pcm;
    if (!pcm || !pcm.length) throw new Error('没有可录的配音');
    const dur = Math.max(0.1, Number(o.dur) || 0);
    const fps = Math.min(60, Math.max(24, Number(o.fps) || 30));
    const mime = pickMime();
    if (!mime) throw new Error('这个浏览器没有可用的录像格式');

    const ctx = cv.getContext('2d', { alpha: false });
    const ownAC = !o.audioContext;
    const ac = o.audioContext || new AC();
    let src = null, dest = null, stream = null, rec = null, raf = 0;
    let stopping = false, stopResolve = null, recErr = '';
    const stopped = new Promise(r => { stopResolve = r; });

    function stopNow() {
      if (stopping) return;
      stopping = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      try {
        if (rec && rec.state !== 'inactive') rec.stop();
        else stopResolve();
      } catch (_) { stopResolve(); }
    }

    function onVis() {
      if (!document.hidden) return;
      ctl.cancel('录制中切走了这个标签页——画面会卡住、声音还在走，这一条作废；回来重出一次');
      stopNow();
    }

    try {
      if (ac.state === 'suspended') { try { await ac.resume(); } catch (_) {} }
      if (ac.state !== 'running') throw new Error('浏览器把声音拦住了——先点一下页面空白处，再点出片');

      const sr = Number(o.sampleRate) || ac.sampleRate || 48000;
      const buf = ac.createBuffer(1, pcm.length, sr);
      buf.getChannelData(0).set(pcm);
      src = ac.createBufferSource();
      src.buffer = buf;
      dest = ac.createMediaStreamDestination();
      src.connect(dest);
      if (o.monitor !== false) src.connect(ac.destination);

      stream = cv.captureStream(fps);
      const vTracks = stream.getVideoTracks();
      const aTracks = dest.stream.getAudioTracks();
      if (!vTracks.length) throw new Error('画布没有给出画面轨');
      if (!aTracks.length) throw new Error('没接上配音轨');
      /* 只有这两路：画布 + 合成配音。没有 getUserMedia，麦克风不会出现在这里。 */
      const out = new MediaStream(vTracks.concat(aTracks));

      for (const m of MIMES) {
        if (!g.MediaRecorder.isTypeSupported(m)) continue;
        try {
          rec = new g.MediaRecorder(out, {
            mimeType: m, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 96_000,
            audioChannelCount: 1,
          });
          break;
        } catch (_) { rec = null; }
      }
      if (!rec) rec = new g.MediaRecorder(out);
      const usedMime = String(rec.mimeType || mime || '');
      const ext = /mp4/i.test(usedMime) ? 'mp4' : 'webm';

      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => stopResolve();
      rec.onerror = e => {
        recErr = String((e && e.error && e.error.message) || (e && e.name) || '录像出错');
        stopNow();
      };

      o.draw(ctx, 0);
      rec.start(1000);
      const t0 = ac.currentTime + 0.05;
      src.start(t0);
      document.addEventListener('visibilitychange', onVis, true);

      const frameMs = 1000 / fps;
      let nextDraw = 0, lastReport = 0;
      const tick = () => {
        if (ctl.cancelled) { stopNow(); return; }
        const t = ac.currentTime - t0;
        if (t >= dur) { stopNow(); return; }
        const now = performance.now();
        if (now >= nextDraw) {
          nextDraw = now + frameMs;
          o.draw(ctx, Math.max(0, t));
        }
        if (o.onProgress && now - lastReport > 400) {
          lastReport = now;
          o.onProgress(Math.max(0, t), dur);
        }
        raf = requestAnimationFrame(tick);
      };
      if (o.onProgress) o.onProgress(0, dur);
      raf = requestAnimationFrame(tick);

      await stopped;
      if (recErr) throw new Error('录像出错：' + recErr);
      if (ctl.cancelled) throw new Error(ctl.reason);
      if (!chunks.length) throw new Error('没录到成片——这台浏览器没把画面交出来，换 Edge 再试');
      const blob = new Blob(chunks, { type: usedMime.split(';')[0] || 'video/webm' });
      const info = {
        mime: usedMime, ext, dur, size: blob.size,
        audio: out.getAudioTracks().map(t => t.label),
        video: out.getVideoTracks().map(t => t.label),
        mic: false,
      };
      g.Recorder.lastInfo = info;
      return { blob, mime: usedMime, ext, dur, info };
    } finally {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis, true);
      try { src && src.stop(); } catch (_) {}
      try { stream && stream.getTracks().forEach(t => t.stop()); } catch (_) {}
      if (ownAC) { try { await ac.close(); } catch (_) {} }
    }
  }

  g.Recorder = { start, pickMime, MIMES, lastInfo: null };
})(window);
