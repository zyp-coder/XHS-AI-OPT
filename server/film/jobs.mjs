/* jobs.mjs — 云端出片：排队账本 + 出片工人。
 *
 * 规矩冻在 资料/云端出片-确认单.md，这里逐条对上：
 *   先来后到、一次跑 1 条（旋钮）· 每人每天 10 条（旋钮）· 单条最多 60 幕 / 3 分钟（旋钮）
 *   素材与成片留 7 天（旋钮）后删 · 磁盘告急只删「已取回过」的 · 服务重启不把出过的片重跑一遍
 *   失败自动重跑 1 次，再失败把原因写在任务上（配音取不到 / 底图拿不到 / 云端忙不过来 / 磁盘满）
 *
 * 认两种人：网页版（cookie 会话）与扩展（挂线凭据 handId+token，走执行器通道那份 checkCred）。
 * 碰平台的动作一条也不在这儿——这里只画片子，发还是客户机自己点。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { speakScenes, VOICES, voiceName, probe as ttsProbe } from './tts.mjs';
import { renderFilm, buildVoice, timelineOf, findBrowser, findFFmpeg } from './render.mjs';

export const STATE_LABEL = {
  queued: '云端排队中', running: '云端出片中', ready: '云端待取',
  taken: '已取回', failed: '出片失败', canceled: '已取消',
};
const LAYOUTS = ['center', 'left', 'list', 'number'];
const PUMP_MS = 5000;          // 每 5 秒看一眼队列（新单当场也会踢一次，不用等）
const LOW_WATER = 800 * 1024 * 1024;   // 磁盘低于这个数先腾地方，腾不开就停收新活

const n0 = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
const now = () => Date.now();
const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** 幕字段兜齐（跟客户机 lib/video/scenes.js 的 normalize 同一口径：缺行、行超宽、编号没给都补一下） */
export function normScenes(list) {
  const out = (Array.isArray(list) ? list : []).map((s, i) => {
    const lines = (s && s.lines || []).map(x => String(x).trim()).filter(Boolean);
    const text = String((s && s.text) || lines.join('') || '').trim();
    const em = ((s && s.em) || []).map(e => ({ l: Number(e && e.l) || 0, t: String((e && e.t) || '').trim() }))
      .filter(e => e.t)
      .map(e => (lines[e.l] && lines[e.l].indexOf(e.t) >= 0 ? e : { l: lines.findIndex(l => l.indexOf(e.t) >= 0), t: e.t }))
      .filter(e => e.l >= 0).slice(0, 1);
    const j = Object.assign({}, s, {
      label: String((s && s.label) || (i + 1)).padStart(2, '0'),
      name: String((s && s.name) || (lines[0] || '')).slice(0, 6),
      text,
      lines: lines.length ? lines : [text],
      em,
      layout: LAYOUTS.indexOf(s && s.layout) >= 0 ? s.layout : 'center',
    });
    if (!j.cardSrc) delete j.cardSrc;
    return j;
  }).filter(s => s.text || (s.lines && s.lines.length));
  return out;
}

export function createFilmJobs(ctx) {
  const { store, persist, resolveAccount, readEnv, getBlobFull, dataDir } = ctx;
  const JOB_DIR = path.join(dataDir, 'film-jobs');
  let running = 0, timer = null, bootAt = now();

  function knobs() {
    const e = readEnv();
    return {
      daily: n0(e.filmDaily, 10),
      conc: n0(e.filmConc, 1),
      maxScenes: n0(e.filmMaxScenes, 60),
      maxSecs: n0(e.filmMaxSecs, 180),
      keepDays: n0(e.filmKeepDays, 7),
      page: e.filmPage || `http://127.0.0.1:${ctx.port || 8799}/film-render.html`,
    };
  }
  function ensure() {
    if (!store.film_jobs || typeof store.film_jobs !== 'object') store.film_jobs = {};
  }
  const jobs = () => Object.values(store.film_jobs || {});
  const mine = (accId) => jobs().filter(j => j.acc === accId);
  const queue = () => jobs().filter(j => j.state === 'queued').sort((a, b) => a.submittedAt - b.submittedAt);
  const posOf = (j) => j.state === 'queued' ? (queue().findIndex(x => x.id === j.id) + 1) : 0;

  /** 交回给客户看的那张条：状态 + 位次 + 工序进度 + 失败原因 */
  function brief(j) {
    return {
      id: j.id, noteId: j.noteId || '', title: j.title || '', state: j.state, stateLabel: STATE_LABEL[j.state] || j.state,
      stage: j.stage || '', progress: j.progress || 0, pos: posOf(j), queuedAt: j.submittedAt,
      startedAt: j.startedAt || 0, doneAt: j.doneAt || 0, expiresAt: j.expiresAt || 0,
      err: j.err || '', tries: j.tries || 0, scenes: (j.scenes || []).length,
      dur: j.dur || 0, outSize: j.outSize || 0, hasOut: !!(j.outPath && fs.existsSync(j.outPath)),
      canTake: j.state === 'ready' || j.state === 'taken', canCancel: j.state === 'queued',
      takeUrl: j.token ? `/api/film/out/${j.id}?t=${j.token}` : '',
      voiceLabel: voiceName(j.voice) || j.voice, cfg: j.cfg || '',
    };
  }

  /** 谁在发：网页看 cookie，扩展看挂线凭据；都不认就 null */
  function who(body, req) {
    const acc = resolveAccount(req);
    if (acc) return acc;
    const c = ctx.execCh && ctx.execCh.api.checkCred(body || {});
    return c && c.ok ? c.acc : null;
  }

  function usedToday(accId) {
    const d = dayOf(now());
    return mine(accId).filter(j => j.state !== 'canceled' && dayOf(j.submittedAt) === d).length;
  }

  function diskFree() {
    try {
      const st = typeof fs.statfsSync === 'function' ? fs.statfsSync(dataDir) : fs.statvfsSync(dataDir);
      return Number(st.bavail) * Number(st.bsize);
    } catch (_) { return Infinity; }    // 量不出来就别拦，照常干活
  }

  function newId() { return 'film_' + randomBytes(6).toString('hex'); }
  const dirOf = (id) => path.join(JOB_DIR, id);

  /* ── 收单 ── */
  async function submit(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）才能用云端出片' };
    const k = knobs();
    const scenes = normScenes(body.scenes);
    if (!scenes.length) return { ok: false, error: '这份稿子没切出幕来——先在字效编辑器里点「✨ 出片稿 + 分幕」' };
    if (scenes.length > k.maxScenes) return { ok: false, error: `这一幕太多了（${scenes.length} 幕），云端一条最多 ${k.maxScenes} 幕——把稿子合几幕再出` };

    const secs = Math.round(scenes.reduce((a, s) => a + Math.max(1.2, s.text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length / 4.5), 0));
    if (secs > k.maxSecs) return { ok: false, error: `这条片估计 ${secs} 秒，云端一条最多 ${k.maxSecs} 秒（${Math.round(k.maxSecs / 60)} 分钟）——稿子删短一点，或分两篇出` };

    const noteId = String(body.noteId || '').slice(0, 40);
    if (noteId) {
      const dup = mine(acc.id).find(j => j.noteId === noteId && (j.state === 'queued' || j.state === 'running'));
      if (dup) return { ok: false, error: '这一条已经在云端排着了（不用连点），等它出完', job: brief(dup) };
    }
    const left = k.daily - usedToday(acc.id);
    if (left <= 0) return { ok: false, error: `今天云端出片的额度用完了（一天 ${k.daily} 条）——明天再来，或在设置里开「云端出不了时改用本机出片」` };

    const voice = VOICES.some(v => v[0] === body.voice) ? body.voice : 'zh-CN-XiaoxiaoNeural';
    const rate = /^[+-]\d{1,3}%$/.test(String(body.rate || '')) ? String(body.rate) : '+20%';
    const id = newId();
    const j = {
      id, acc: acc.id, accName: acc.name || '', noteId,
      title: String(body.title || '').slice(0, 40),
      scenes, cfg: String(body.cfg || '').slice(0, 400), voice, rate,
      cards: Array.isArray(body.cards) ? body.cards.slice(0, k.maxScenes).map(String) : [],
      state: 'queued', stage: '排队中', progress: 0, tries: 0,
      submittedAt: now(), token: randomBytes(8).toString('hex'),
    };
    store.film_jobs[id] = j;
    await persist();
    log(acc, `收单 ${id}（${scenes.length} 幕 · 约 ${secs}s · 前面排 ${posOf(j) - 1} 条）`);
    kick();
    return { ok: true, job: brief(j), quota: { used: usedToday(acc.id), left: left - 1, daily: k.daily } };
  }

  /* ── 查 / 列 / 撤 ── */
  function status(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）' };
    const j = store.film_jobs[String(body.id || '')];
    if (!j || j.acc !== acc.id) return { ok: false, error: '没找到这条出片任务' };
    return { ok: true, job: brief(j) };
  }
  function listMine(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）' };
    const k = knobs();
    const used = usedToday(acc.id);
    const list = mine(acc.id).sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 30).map(brief);
    return { ok: true, jobs: list, quota: { used, left: Math.max(0, k.daily - used), daily: k.daily } };
  }
  async function cancel(body, req) {
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）' };
    const j = store.film_jobs[String(body.id || '')];
    if (!j || j.acc !== acc.id) return { ok: false, error: '没找到这条出片任务' };
    if (j.state !== 'queued') return { ok: false, error: j.state === 'running' ? '这条已经在跑了，撤不下来——等它出完' : `这条已经${STATE_LABEL[j.state] || j.state}了` };
    j.state = 'canceled'; j.stage = '已取消'; j.doneAt = now();
    await persist();
    log(acc, `撤单 ${j.id}`);
    return { ok: true, job: brief(j) };
  }

  /* ── 取回：GET /api/film/out/<id>?t=<令牌>，整片原样交出去 ── */
  function handleOut(req, res, url) {
    ensure();
    const id = decodeURIComponent(url.pathname.slice('/api/film/out/'.length));
    const j = store.film_jobs[id];
    if (!j) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 没这条出片任务'); return true; }
    if (!j.token || j.token !== String(url.searchParams.get('t') || '')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('403 取回口令不对'); return true;
    }
    if (!j.outPath || !fs.existsSync(j.outPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(j.state === 'failed' ? '404 这条没出成片：' + (j.err || '出片失败') : '404 片子还没出来（还在排队/在跑）'); return true;
    }
    const size = fs.statSync(j.outPath).size;
    const name = encodeURIComponent(`成片-${(j.title || j.noteId || j.id).slice(0, 24)}.mp4`);
    res.writeHead(200, {
      'Content-Type': 'video/mp4', 'Content-Length': size,
      'Content-Disposition': `attachment; filename="film-${j.id}.mp4"; filename*=UTF-8''${name}`,
      'Cache-Control': 'no-store',
    });
    const st = fs.createReadStream(j.outPath);
    st.pipe(res);
    st.on('error', () => { try { res.destroy(); } catch (_) {} });
    res.on('finish', () => {
      if (j.state === 'ready') { j.state = 'taken'; j.takenAt = now(); j.stage = '已取回'; persist(); log(acc0(j), `取回 ${j.id}（${(size / 1048576).toFixed(1)}MB）`); }
    });
    return true;
  }
  const acc0 = (j) => ({ id: j.acc, name: j.accName });

  /* ── 底图换成画布能直接读的串：文件号→落仓字节，外链→云端自己下，data: 原样用 ── */
  async function cardDataUrl(src, accId) {
    const s = String(src || '');
    if (!s) return '';
    if (s.startsWith('data:')) return s;
    if (s.startsWith('blob:') || s.startsWith('/api/blob/') || s.startsWith('http://127.0.0.1')) {
      const id = s.replace(/^blob:\/?/, '').replace(/^\/?api\/blob\//, '').replace(/^https?:\/\/127\.0\.0\.1(:\d+)?\/api\/blob\//, '').slice(0, 24);
      const f = await getBlobFull(id);
      if (!f) throw new Error('底图在云端取不到（文件号 ' + id.slice(0, 12) + '）');
      if (f.acc && f.acc !== accId) throw new Error('底图不是这一位客户传的（文件号对不上人）');
      return `data:${f.m};base64,${f.buf.toString('base64')}`;
    }
    if (/^https?:/i.test(s)) {
      const r = await fetch(s, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('外链底图云端打不开（HTTP ' + r.status + '）');
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) throw new Error('外链底图太大了（超 12MB）');
      return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${buf.toString('base64')}`;
    }
    throw new Error('底图来路不认识：' + s.slice(0, 40));
  }

  async function mark(j, stage, progress) {
    const p = Math.max(0, Math.min(1, progress || 0));
    const moved = j.stage !== stage || Math.round(p * 40) !== Math.round((j.progress || 0) * 40);
    j.stage = stage; j.progress = p;
    if (moved) await persist();
  }

  /* ── 跑一条：对稿 → 配音（量真实秒数重排时间轴）→ 画画面 → 压片合声 ── */
  async function run(j) {
    const k = knobs();
    const dir = dirOf(j.id);
    fs.mkdirSync(dir, { recursive: true });
    j.startedAt = now();
    await mark(j, '对稿', 0.02);

    const lines = j.scenes.map(s => s.text);
    await mark(j, '配音', 0.06);
    const vo = await speakScenes(lines, {
      voice: j.voice, rate: j.rate, dir,
      onProgress: (i, n) => { mark(j, `配音 ${i}/${n}`, 0.06 + i / n * 0.14).catch(() => {}); },
    });
    const tl = timelineOf(j.scenes, vo.secs);
    j.dur = tl.dur; j.tl = { head: tl.head, gap: tl.gap, tail: tl.tail, dur: tl.dur, scenes: tl.scenes.map(s => ({ label: s.label, start: s.start, end: s.end })) };
    if (tl.dur > k.maxSecs) throw new Error(`这条片出来 ${tl.dur.toFixed(0)} 秒，超过云端一条 ${k.maxSecs} 秒的上限——稿子删短些，或分两篇出`);

    await mark(j, '准备底图', 0.22);
    const pool = {};
    for (let i = 0; i < tl.scenes.length; i++) {
      const src = (j.cards && j.cards[i]) || tl.scenes[i].cardSrc;
      if (!src) continue;
      if (!(src in pool)) {
        try { pool[src] = await cardDataUrl(src, j.acc); }
        catch (e) { throw new Error(`第 ${i + 1} 幕的底图云端拿不到（${e.message}）——改成选本机的图，或去掉这张底图再出`); }
      }
      tl.scenes[i].cardSrc = pool[src];
    }

    await mark(j, '配音合成', 0.28);
    const voice = await buildVoice({ dir, files: vo.files, secs: vo.secs, head: tl.head, gap: tl.gap, tail: tl.tail });

    const outPath = path.join(dir, 'out.mp4');
    await mark(j, '画画面', 0.32);
    const r = await renderFilm({
      pageUrl: k.page, job: { cfg: j.cfg, tl }, dir: path.join(dir, 'frames'), outPath, voice,
      onProgress: (i, n) => { mark(j, `画画面 ${Math.round(i / n * 100)}%`, 0.32 + i / n * 0.6).catch(() => {}); },
    });
    if (!r.bytes) throw new Error('压完片是空文件——云端这台机器的剪辑工具没跑利索');
    j.outPath = outPath; j.outSize = r.bytes; j.frames = r.frames;
    j.expiresAt = now() + k.keepDays * 86400000;
    await mark(j, '传回来', 1);
    j.state = 'ready'; j.doneAt = now(); j.err = '';
    await persist();
    log(acc0(j), `出好了 ${j.id}（${tl.dur.toFixed(1)}s · ${(r.bytes / 1048576).toFixed(1)}MB · 用时 ${((j.doneAt - j.startedAt) / 1000).toFixed(0)}s）`);
  }

  /* ── 队列工人：一次跑 conc 条；失败自动重跑 1 次，再失败把原因写在条上 ── */
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      ensure();
      const k = knobs();
      /* 服务重启：上一次进程里"正在跑"的那些不重跑（客户重新点一次才算新单） */
      for (const j of jobs()) if (j.state === 'running' && j.startedAt < bootAt) {
        j.state = 'failed'; j.stage = '失败'; j.err = '服务器这一趟重启打断了出片——请重新点一次出片'; j.doneAt = now();
        await persist();
      }
      if (running >= k.conc) return;
      if (diskFree() < LOW_WATER) {
        const freed = await sweep(true);
        if (diskFree() < LOW_WATER) {
          if (freed) console.log(`[film] 磁盘腾出 ${(freed / 1048576).toFixed(0)}MB（只删了已取回的）`);
          for (const j of queue()) { j.stage = '云端磁盘紧张，稍等一下'; }
          await persist();
          return;
        }
      }
      /* 名额一次填满（并发 1 时就是拿到一条就走） */
      while (running < k.conc) {
        const next = queue().find(j => !j._pick);
        if (!next) return;
        next._pick = true; next.state = 'running'; next.tries = (next.tries || 0) + 1; next.startedAt = now();
        running++;
        log(acc0(next), `开跑 ${next.id}（第 ${next.tries} 次）`);
        run(next).then(() => {
          delete next._pick;
        }, async (e) => {
          delete next._pick;
          const msg = String((e && e.message) || e || '出片失败').slice(0, 300);
          if (next.tries <= 1) {
            next.state = 'queued'; next.stage = '排队中（自动重跑第 2 次）'; next.err = ''; next.startedAt = 0;
            console.log(`[film] ${next.id} 这一趟没过（${msg}）——自动重跑第 2 次`);
          } else {
            next.state = 'failed'; next.stage = '失败'; next.err = msg; next.doneAt = now();
            next.expiresAt = now() + k.keepDays * 86400000;
            console.log(`[film] ${next.id} 两次都没过：${msg}`);
          }
          log(acc0(next), `任务 ${next.id} → ${STATE_LABEL[next.state]}${next.err ? '：' + next.err : ''}`);
          await persist();
        }).finally(async () => { running--; await persist(); kick(); });
      }
    } finally { pumping = false; }
  }

  /* ── 房务：素材与成片留 7 天（旋钮）。急用磁盘时先删「已取回过」的，没取回的不删。 ── */
  async function sweep(eager) {
    ensure();
    const k = knobs();
    const t = now();
    const keepMs = k.keepDays * 86400000;
    let freed = 0, changed = false;
    for (const j of jobs()) {
      const busy = j.state === 'queued' || j.state === 'running';
      /* 成片过期：ready 一直没人来取 → 留一句人话；其余状态把重活删掉、这条任务只留账 */
      if (!busy && j.outPath && (j.expiresAt || ((j.doneAt || 0) + keepMs)) < t) {
        if (j.state === 'ready') {
          j.state = 'failed'; j.stage = '失败'; j.err = `片子在云端放满 ${k.keepDays} 天没取，已经清掉了——重新点一次出片`;
          changed = true;
        }
        freed += rmDir(j);
        changed = true;
        continue;
      }
      if (eager && j.state === 'taken' && j.outPath) { freed += rmDir(j); changed = true; continue; }
      if (!busy && j.doneAt && t - j.doneAt > keepMs) {       // 老账整条抹掉（失败/取消/已取回满 7 天）
        freed += rmDir(j);
        delete store.film_jobs[j.id];
        changed = true;
      }
    }
    if (changed) await persist();
    return freed;
  }
  function rmDir(j) {
    let n = 0;
    try {
      const d = dirOf(j.id);
      if (fs.existsSync(d)) { n = dirSize(d); fs.rmSync(d, { recursive: true, force: true }); }
    } catch (_) { /* 删不动就算了，下一钩再试 */ }
    j.outPath = ''; j.outSize = 0;
    return n;
  }
  function dirSize(d) {
    let n = 0;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      n += f.isDirectory() ? dirSize(p) : (fs.statSync(p).size || 0);
    }
    return n;
  }

  /* ── 环境体检：缺什么一项项报（给客户机那张体检卡调） ── */
  function envProbe() {
    const tts = ttsProbe();
    const out = { ok: tts.ok, python: tts.python, lib: tts.lib, ffprobe: tts.ffprobe, browser: '', ffmpeg: '', page: knobs().page, daily: knobs().daily, conc: knobs().conc, maxSecs: knobs().maxSecs, queued: queue().length, running };
    try { out.browser = findBrowser(); } catch (e) { out.browser = '✗ ' + e.message; out.ok = false; }
    try { out.ffmpeg = findFFmpeg(); } catch (e) { out.ffmpeg = '✗ ' + e.message; out.ok = false; }
    return out;
  }

  const log = (acc, msg) => console.log(`[film] ${acc && acc.name || '?'} ${msg}`);
  let queued = false;
  function kick() {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; pump().catch(e => console.error('[film] 队列跑歪了：', e && e.message)); }, 30);
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => {
      pump().catch(e => console.error('[film] 队列跑歪了：', e && e.message));
      sweep().catch(e => console.error('[film] 房务没跑成：', e && e.message));
    }, PUMP_MS);
    if (timer.unref) timer.unref();
    console.log('[film] 云端出片工人上岗：先来后到，一次跑 ' + knobs().conc + ' 条，每人每天 ' + knobs().daily + ' 条');
  }

  return {
    start,
    api: { submit, status, listMine, cancel, handleOut, envProbe, knobs, pump: () => pump(), sweep: () => sweep(), brief, normScenes, STATE_LABEL },
  };
}
