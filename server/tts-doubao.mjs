/** tts-doubao.mjs — 豆包（火山引擎）语音合成：一句文本进，一段 mp3 出（2026-11-03）。
 *
 * 两条口子，按服务器配的凭据自动选：
 *   v3（新版控制台 API Key，当前主用）
 *     POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
 *     header X-Api-Key / X-Api-Resource-Id / X-Api-Request-Id
 *     回包是 NDJSON：一行一个 JSON，音频在 data（base64），最后一行 code=20000000 收尾
 *   v1（旧版控制台 App ID + Access Token，留着兜底）
 *     POST https://openspeech.bytedance.com/api/v1/tts
 *     header Authorization: Bearer;<Access Token>（分号是官方格式）
 *     回包 { code:3000, data:"<base64 mp3>", addition:{ duration } }
 *
 * 一次最多约 1024 字节文本：超了按标点切块、依次念，再把 mp3 帧顺序拼起来（同一个编码参数，能连播）。
 * Key 只在这台服务器上：客户浏览器永远拿不到。
 */
import { randomBytes } from 'node:crypto';

export const DOUBAO_VOICES = [
  { id: 'zh_male_liufei_uranus_bigtts', name: '刘飞 2.0' },
  { id: 'zh_male_jieshuoxiaoming_uranus_bigtts', name: '解说小明 2.0' },
  { id: 'zh_male_ruyaqingnian_uranus_bigtts', name: '儒雅青年 2.0' },
  { id: 'zh_female_zhixingnv_uranus_bigtts', name: '知性女声 2.0' },
  { id: 'zh_male_kailangdidi_uranus_bigtts', name: '开朗弟弟 2.0' },
  { id: 'zh_female_wenrouxiaoya_uranus_bigtts', name: '温柔小雅 2.0' },
];
const VOICE_IDS = new Set(DOUBAO_VOICES.map(v => v.id));

export const ttsReady = (env) => !!(env && (env.ttsApiKey || (env.ttsAppId && env.ttsToken)));
export const isDoubaoVoice = (voice) => VOICE_IDS.has(String(voice || ''));

/* 2.0 官方音色（_uranus_/_saturn_）走 seed-tts-2.0；1.0 走 seed-tts-1.0 */
export function resourceIdOf(voice) {
  const v = String(voice || '');
  return /_uranus_|_saturn_/.test(v) ? 'seed-tts-2.0' : 'seed-tts-1.0';
}

/* 界面给的是 '+20%' 这种，接口要 0.2~3 的倍数；越界就夹到边上，别让一次手滑报成整单失败 */
export function rateRatio(rate) {
  const m = /^([+-]?)(\d{1,3})%$/.exec(String(rate || ''));
  const n = m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) / 100 : 0;
  return Math.min(3, Math.max(0.2, 1 + n));
}

/* 按 UTF-8 字节切块（接口上限 1024 字节，留出余量）。优先在句读处切，实在一长串没标点才硬切。 */
export function splitBytes(text, maxBytes = 900) {
  const s = String(text || '');
  const out = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur); cur = ''; };
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch, 'utf8') > maxBytes) {
      push();
      cur = ch;         // 这一字另起一块（标点打头也无所谓；一长串没标点就硬切）
      continue;
    }
    cur += ch;
  }
  push();
  return out.length ? out : [s];
}

function errText(code, msg, raw) {
  const c = Number(code);
  if (c === 3001) return '配音服务说这段字不合要求（3001）：' + (msg || raw || '');
  if (c === 3002) return '配音服务没权限用这个音色（3002）：' + (msg || raw || '');
  if (c === 3003) return '配音服务那边的并发/额度到线了（3003）：' + (msg || raw || '');
  if (c === 3005) return '配音服务处理这一段失败（3005）：' + (msg || raw || '');
  if (c === 3006) return '这个音色不在账号可用的列表里（3006）：' + (msg || raw || '');
  if (c === 3007) return '配音参数不对（3007）：' + (msg || raw || '');
  if (c === 4000 || c === 401 || c === 403) return '配音服务的凭据不对（App ID / Access Token）——去火山引擎控制台核对后填回 server/.env';
  return '配音服务回了个错（' + (code == null ? '?' : code) + '）：' + (msg || raw || '');
}

function errTextV3(code, msg) {
  const c = Number(code);
  if (c === 45000030) return '这个号还没开通「语音合成 2.0」——去火山引擎控制台「开通管理」把模型开通后再试';
  if (c === 45000000) return '配音服务的 API Key 不对——去控制台核对后填回 server/.env';
  if (c === 55000000) return '音色和接口资源对不上（55000000）：' + (msg || '');
  return '配音服务回了个错（' + (code == null ? '?' : code) + '）：' + (msg || '');
}

/* v3：新版 API Key 口子。回包是 NDJSON，把每行 data 拼起来。 */
async function synthOnceV3(text, o) {
  const env = o.env || {};
  const url = env.ttsEndpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(10000, Number(o.timeout) || 45000));
  const reqid = randomBytes(16).toString('hex');
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': String(env.ttsApiKey),
        'X-Api-Resource-Id': resourceIdOf(o.voice),
        'X-Api-Request-Id': reqid,
      },
      body: JSON.stringify({
        user: { uid: 'xhs-' + String(o.accId || 'server').slice(0, 32) },
        req_params: {
          text: String(text),
          speaker: String(o.voice),
          audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((rateRatio(o.rate) - 1) * 100) },
        },
      }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    const bufs = [];
    let bad = null;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim().replace(/^data:\s*/, '');
      if (!line) continue;
      let j = null;
      try { j = JSON.parse(line); } catch (_) { continue; }
      const h = j.header || {};
      const code = Number(h.code != null ? h.code : j.code);
      if (j.data) bufs.push(Buffer.from(String(j.data), 'base64'));
      if (code && code !== 0 && code !== 20000000) bad = { code, message: h.message || j.message || '' };
    }
    if (bad) throw new Error(errTextV3(bad.code, bad.message));
    if (!r.ok) throw new Error('配音接口没收这次请求（HTTP ' + r.status + '）：' + (txt.slice(0, 160) || ''));
    if (!bufs.length) throw new Error('配音接口没回音频');
    return { buf: Buffer.concat(bufs), durationMs: 0 };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('配音接口等太久了（' + Math.round((o.timeout || 45000) / 1000) + ' 秒没回）');
    throw e;
  } finally { clearTimeout(timer); }
}

/* 念一小块（≤900 字节）。回 { buf: Buffer, durationMs }。 */
async function synthOnce(text, o) {
  if (o.env && o.env.ttsApiKey) return synthOnceV3(text, o);
  const env = o.env || {};
  const url = env.ttsEndpoint || 'https://openspeech.bytedance.com/api/v1/tts';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(10000, Number(o.timeout) || 45000));
  const reqid = randomBytes(8).toString('hex');
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer;' + env.ttsToken },
      body: JSON.stringify({
        app: { appid: String(env.ttsAppId), token: String(env.ttsToken), cluster: env.ttsCluster || 'volcano_tts' },
        user: { uid: 'xhs-' + String(o.accId || 'server').slice(0, 32) },
        audio: { voice_type: String(o.voice), encoding: 'mp3', speed_ratio: rateRatio(o.rate) },
        request: { reqid, text: String(text), text_type: 'plain', operation: 'query' },
      }),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) {}
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new Error('配音服务的凭据不对（HTTP ' + r.status + '）——去火山引擎控制台核对 App ID / Access Token');
      throw new Error('配音接口没收这次请求（HTTP ' + r.status + '）：' + (txt.slice(0, 160) || ''));
    }
    if (!j) throw new Error('配音接口回了看不懂的内容');
    if (Number(j.code) !== 3000) throw new Error(errText(j.code, j.message, txt.slice(0, 160)));
    if (!j.data) throw new Error('配音接口没回音频');
    const buf = Buffer.from(String(j.data), 'base64');
    if (!buf.length) throw new Error('配音接口回的音频是空的');
    const dur = Number(j.addition && j.addition.duration);
    return { buf, durationMs: Number.isFinite(dur) ? dur : 0 };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('配音接口等太久了（' + Math.round((o.timeout || 45000) / 1000) + ' 秒没回）');
    throw e;
  } finally { clearTimeout(timer); }
}

/** 念一整句（自动切块、拼 mp3）。回 { audio: Buffer, durationMs, chunks }。 */
export async function synthDoubao(text, o) {
  o = o || {};
  if (!ttsReady(o.env)) throw new Error('服务器还没配豆包语音的 Key（API Key 或 App ID + Access Token）');
  if (!isDoubaoVoice(o.voice)) throw new Error('这个音色不在豆包列表里');
  const chunks = splitBytes(text);
  const bufs = [];
  let durationMs = 0;
  for (const c of chunks) {
    const r = await synthOnce(c, o);
    bufs.push(r.buf);
    durationMs += r.durationMs;
  }
  return { audio: Buffer.concat(bufs), durationMs, chunks: chunks.length };
}
