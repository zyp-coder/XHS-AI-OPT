/* render.mjs — 云端造片工序：偷偷开一个没界面的浏览器逐帧要画面 → 喂给剪辑工具压片 → 合上配音。
 *
 * 为什么不让浏览器自己压片：那样又把「挑浏览器」从客户机搬到服务器上（Linux 上那些自带编码器
 * 有没有、好不好使全看发行版）。这边浏览器只画画，编码压片合声全交给剪辑工具，服务器装什么浏览器都不影响出片。
 *
 * 三样外部东西全可指路（旋钮，云端和本机同一套代码）：
 *   FILM_BROWSER  浏览器程序路径   FILM_FFMPEG / FILM_FFPROBE  剪辑工具   FILM_PAGE  造片页地址
 *
 * 用法：
 *   const r = await renderFilm({ pageUrl, job, dir, outPath, onProgress });
 * job.tl 的幕必须已经带上真实秒数排好的 start/end（由 jobs.mjs 按配音量出的 secs 算）。
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FPS = 30, W = 1080, H = 1920, SR = 24000;

const CAND_BROWSER = [
  process.env.FILM_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
].filter(Boolean);
const which = c => { try { return spawnSync(process.platform === 'win32' ? 'where' : 'which', [c], { encoding: 'utf8' }).status === 0; } catch (_) { return false; } };

export function findBrowser() {
  const hit = CAND_BROWSER.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (hit) return hit;
  if (which('microsoft-edge') || which('edge')) return 'microsoft-edge';
  if (which('google-chrome') || which('chrome')) return 'google-chrome';
  throw new Error('这台机器上没找到浏览器（给 FILM_BROWSER 指个路：云端要装无头浏览器，见 server/deploy-cloud.sh）');
}
export function findFFmpeg() {
  const p = process.env.FILM_FFMPEG || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (p.includes(path.sep) || path.isAbsolute(p)) {
    if (fs.existsSync(p)) return p;
  } else if (which(p)) return p;
  throw new Error('这台机器上没有剪辑工具 ffmpeg（给 FILM_FFMPEG 指个路；云端装法见 server/deploy-cloud.sh）');
}

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/** 起一个没界面的浏览器，等它把调试口开起来，回 {proc, wsUrl, close} */
async function openBrowser(url, profileDir) {
  const exe = findBrowser();
  const port = await freePort();
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--disable-background-timer-throttling',
    '--remote-allow-origins=*', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    '--window-size=420,260', url,
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });
  proc.on('error', e => { stderr += ' 起不动：' + (e && e.message || e); });

  const deadline = Date.now() + 25000;
  let list = null;
  while (Date.now() < deadline) {
    if (proc.killed || proc.exitCode) break;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      list = await r.json();
      if (Array.isArray(list) && list.length) break;
    } catch (_) { /* 调试口还没开起来 */ }
    await new Promise(r => setTimeout(r, 200));
  }
  const page = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl) || (list || [])[0];
  if (!page || !page.webSocketDebuggerUrl) {
    try { proc.kill(); } catch (_) {}
    throw new Error('浏览器开起来了但调试口没应答（多半是这台机器的浏览器版本太老）' + (stderr ? '：' + stderr.slice(-200) : ''));
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('连浏览器调试口超时')), 15000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = e => { clearTimeout(t); rej(new Error('连不上浏览器调试口：' + (e && e.message || '对端拒绝'))); };
  });

  let seq = 0;
  const pend = new Map();
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(String(ev.data)); } catch (_) { return; }
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.rej(new Error(m.error.message || JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  return {
    proc, send,
    async eval(expr, awaitPromise = true) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || '页里报错');
      }
      return r.result && r.result.value;
    },
    async close() { try { ws.close(); } catch (_) {} try { proc.kill(); } catch (_) {} try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {} },
  };
}

/** 跑一条剪辑工具命令，失败把尾部输出带出来 */
function ff(args) {
  return new Promise((res, rej) => {
    const p = spawn(findFFmpeg(), ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', rej);
    p.on('close', code => code === 0 ? res() : rej(new Error('剪辑工具这条命令没过（' + code + '）：' + err.slice(-300))));
  });
}

/** 逐幕 mp3 + 片头/幕间/片尾静默 → 一条对好轴的配音轨（24k 单声道 wav） */
export async function buildVoice(o) {
  const { dir, files, secs, head = 0.8, gap = 0.5, tail = 1.4 } = o;
  const items = [];
  const sil = async (tag, sec) => {
    if (!(sec > 0.001)) return null;
    const f = path.join(dir, `sil-${tag}.wav`);
    if (!fs.existsSync(f)) {
      await ff(['-y', '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=mono`, '-t', String(sec.toFixed(3)),
        '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', f]);
    }
    return f;
  };
  items.push(await sil('head', head));
  for (let i = 0; i < files.length; i++) {
    if (files[i]) {
      const wav = path.join(dir, `s${i}.wav`);
      await ff(['-y', '-i', path.join(dir, files[i]), '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', wav]);
      items.push(wav);
    } else {
      items.push(await sil('blank' + i, secs[i] || gap));   // 这一幕没字：按静默占住
    }
    if (i < files.length - 1) items.push(await sil('gap', gap));
  }
  items.push(await sil('tail', tail));
  const list = path.join(dir, 'voice-list.txt');
  fs.writeFileSync(list, items.filter(Boolean).map(f => "file '" + path.basename(f) + "'").join('\n') + '\n', 'utf8');
  const voice = path.join(dir, 'voice.wav');
  await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', voice]);
  return voice;
}

/** 全片秒数：跟客户机那份同一算法（片头 + 各幕 + 幕间静默 + 片尾） */
export function timelineOf(scenes, secs, o = {}) {
  const gap = o.gap === undefined ? 0.5 : o.gap;
  const head = o.head === undefined ? 0.8 : o.head;
  const tail = o.tail === undefined ? 1.4 : o.tail;
  let at = head;
  const out = scenes.map((s, i) => {
    const st = at, en = at + (secs[i] || gap);
    at = en + (i < scenes.length - 1 ? gap : 0);
    return Object.assign({}, s, { start: +st.toFixed(3), end: +en.toFixed(3) });
  });
  return { head, tail, gap, scenes: out, dur: +(at + tail).toFixed(3), audio: +(at - head).toFixed(3) };
}

/** 一帧一帧要画面，直接灌进剪辑工具压成带声 MP4 */
export async function renderFilm(o) {
  const { pageUrl, job, dir, outPath, onProgress } = o;
  const tl = job.tl;
  const frames = Math.round(tl.dur * FPS);
  fs.mkdirSync(dir, { recursive: true });
  const br = await openBrowser(pageUrl, path.join(dir, 'profile'));
  try {
    for (let i = 0; i < 100; i++) {                          // 等这页把脚本跑起来（本地 file:// 和网络都适用）
      if (await br.eval('!!window.__film', false)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const info = await br.eval('window.__film.load(' + JSON.stringify(job) + ')');
    if (!info || !info.frames) throw new Error('造片页没装上台子');

    const args = ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'mjpeg', '-i', 'pipe:0'];
    if (o.voice) args.push('-i', o.voice, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '96k', '-ar', String(SR), '-ac', '1');
    args.push('-c:v', 'libx264', '-preset', o.preset || 'veryfast', '-crf', String(o.crf || 22),
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', outPath);

    const p = spawn(findFFmpeg(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    const done = new Promise((res, rej) => {
      p.on('error', rej);
      p.on('close', code => code === 0 ? res() : rej(new Error('压片没过（' + code + '）：' + err.slice(-300))));
    });
    for (let i = 0; i < frames; i++) {
      const data = await br.eval(`window.__film.frame(${i},0.92)`, false);
      const buf = Buffer.from(String(data).slice(String(data).indexOf(',') + 1), 'base64');
      if (!p.stdin.write(buf)) await new Promise(r => p.stdin.once('drain', r));
      if (onProgress && (i % 30 === 0 || i === frames - 1)) onProgress(i + 1, frames);
    }
    p.stdin.end();
    await done;
    return { outPath, frames, dur: tl.dur, bytes: fs.existsSync(outPath) ? fs.statSync(outPath).size : 0, os: os.hostname() };
  } finally {
    await br.close();
  }
}

export default { renderFilm, buildVoice, timelineOf, findBrowser, findFFmpeg, FPS, W, H, SR };
