  /* [[HAND-AUTO-FILM]] */
  /* ── 执行器派单出片（?auto=1&noteId=…）：不给人点，接上草稿就自己出片 ──
     进不进得来由 hand-mode 的一次性通行证说了算（手工打开会被整页挡掉）；
     草稿由 exec-shell 随单摆进本机 xhsFilmDocs[noteId]；这里只负责按那篇的幕出片，
     出完用 film-round 回报（片长 / 大小 / 文件名 / 字体有没有下来）。片子自动下载、
     留在本机，不回传服务器。 */
  (function autoFilm() {
    const q = new URLSearchParams(location.search || '');
    if (q.get('auto') !== '1') return;
    const noteId = String(q.get('noteId') || '');
    let port = null;
    try { port = chrome.runtime.connect({ name: 'film-round' }); } catch (_) {}
    const post = (o) => { try { if (port) port.postMessage(o); } catch (_) {} };
    try {
      port.onMessage.addListener((m) => {
        if (m && m.ev === 'stop') { try { S.busy = false; } catch (_) {} }   // 编码里看到 busy=false 会当场抛
      });
    } catch (_) {}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const logTail = () => {
      const st = $('st') ? String($('st').textContent || '') : '';
      const wn = ($('warn') && !$('warn').hidden) ? String($('warn').textContent || '') : '';
      return [st, wn].filter(Boolean).join(' · ').slice(-1500);
    };
    const fail = (msg) => post({ ev: 'done', ok: false, error: msg, logTail: logTail() });
    const fontInfo = () => {
      try { return (window.Fonts && typeof Fonts.status === 'function') ? Fonts.status() : null; } catch (_) { return null; }
    };

    (async () => {
      /* 先等通行证验过：手工打开（没票/票用过）时 hand-mode 会挡页，这里一步都不跑 */
      const wt0 = Date.now();
      while (Date.now() - wt0 < 8000 && window.__XHS_HAND__ !== true && !window.__XHS_HAND_BLOCKED__) await sleep(100);
      if (window.__XHS_HAND__ !== true) { try { port && port.disconnect(); } catch (_) {} return; }
      post({ ev: 'hello', noteId });
      await S.ready;
      if (!noteId) return fail('没带 noteId');
      S.loadNote({ id: noteId });
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && !S.scenes.length) await sleep(200);
      if (!S.scenes.length) return fail('草稿没接上：这一篇没有可出的分幕');
      post({ ev: 'start', noteId, scenes: S.scenes.length });
      const baseline = S.lastBlob;
      const outAt0 = Number(S.outAt) || 0;
      await make();
      const ok = (Number(S.outAt) || 0) > outAt0 || (S.lastBlob && S.lastBlob !== baseline);
      if (!ok) return fail('出片没成：' + (logTail() || '没留下成片'));
      post({
        ev: 'done', ok: true, noteId,
        dur: (S.tl && S.tl.dur) || 0,
        size: S.lastBlob ? S.lastBlob.size : 0,
        name: S.lastName || '',
        fonts: fontInfo(),
        logTail: logTail(),
      });
    })().catch((e) => fail((e && e.message) || String(e)));
  })();
  /* [[/HAND-AUTO-FILM]] */

