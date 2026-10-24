/* tts.mjs — 云端出片的配音口：调 server/film/tts-voice.py 去念，一幕一条 mp3，顺带量出每幕真实秒数。
 *
 * 为什么绕一道 Python：微软那条免费念稿口子 2026-10 换了进门令牌（参数从 1- 起改成 2- 起，哈希也换一代），
 * 自己抄那套位运算等于微软每改一次口径我们就要连夜重写一遍；跟着社区库升级只升一个包。老板 2026-10-16 定的这条。
 * 所以配音整条腿搬到这里，客户机那份浏览器代码（extension/lib/video/tts-edge.js）不再是出片的必经路
 * ——「客户机必须用 Edge」这条限制随云端出片一起解掉。
 *
 * 用法：
 *   const { files, secs, voice, rate } = await speakScenes(['第一句', '第二句'],
 *     { voice: 'zh-CN-XiaoxiaoNeural', rate: '+20%', dir: '/tmp/xxx', onProgress: (i, n) => {} });
 *   const list = await probe();      // 体检：这台机器念得出声吗（缺什么一项项报）
 * files[i] 是 dir 下的文件名（空幕给空串），secs[i] 是那一幕念了多久（ffprobe 量的，不靠字数估）。
 */
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VOICE_SCRIPT = path.join(HERE, 'tts-voice.py');

export const VOICES = [
  ['zh-CN-XiaoxiaoNeural', '晓晓'], ['zh-CN-XiaoyiNeural', '晓伊'], ['zh-CN-YunxiNeural', '云希'],
  ['zh-CN-YunyangNeural', '云扬'], ['zh-CN-YunjianNeural', '云健'],
];
export const voiceName = id => (VOICES.find(v => v[0] === id) || [, id])[1];

const py = () => process.env.FILM_PYTHON || 'python3';
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

/** 一次念一摞幕：写任务 JSON → 起 Python → 收每幕的 mp3 与秒数。 */
export function speakScenes(lines, o = {}) {
  const dir = o.dir;
  if (!dir) return Promise.reject(new Error('配音要先有个落盘的目录（dir）'));
  return new Promise((resolve, reject) => {
    mkdirSync(dir, { recursive: true });
    const inp = path.join(dir, 'tts-in.json');
    writeFileSync(inp, JSON.stringify({
      scenes: (lines || []).map(t => ({ text: String(t || '') })),
      voice: o.voice || 'zh-CN-XiaoxiaoNeural',
      rate: o.rate || '+20%',
    }), 'utf8');

    const child = spawn(py(), [VOICE_SCRIPT, '--in', inp, '--out', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} reject(new Error('配音念太久了（超 ' + Math.round((o.timeout || 600000) / 1000) + ' 秒）')); }, o.timeout || 600000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error('起不了念稿的程序（' + py() + '）：' + (e && e.message || e))); });
    child.on('close', code => {
      clearTimeout(timer);
      let j = null;
      String(out).split('\n').forEach(line => {
        const s = line.trim();
        if (s[0] === '{') { try { j = JSON.parse(s); } catch (_) { /* 中间行不是 JSON，忽略 */ } }
      });
      if (!j) return reject(new Error('念稿的程序没回话（退出码 ' + code + '）' + (err ? '：' + err.slice(-240) : '')));
      if (!j.ok) return reject(new Error(j.error || '念稿的程序报错'));
      resolve(j);
    });
  });
}

/** 体检：Python / 念稿库 / ffprobe 三样逐项报，缺哪样一眼看见。 */
export function probe() {
  const out = { python: '', lib: '', ffprobe: '', ok: false };
  const p = run(py(), ['--version']);
  if (p.error || p.status !== 0) { out.python = '起不了：' + py(); return out; }
  out.python = (p.stdout || p.stderr || '').trim().split('\n')[0];
  const lib = run(py(), ['-c', 'import edge_tts,sys;print(getattr(edge_tts,"__version__","?"))']);
  out.lib = lib.status === 0 ? (lib.stdout || '').trim() : '没装（pip3 install -i https://mirrors.aliyun.com/pypi/simple/ "edge-tts>=7.3.1"）';
  const ff = run(process.env.FILM_FFPROBE || 'ffprobe', ['-version']);
  out.ffprobe = ff.status === 0 ? (String(ff.stdout || '').split('\n')[0] || '在场') : '没装 ffmpeg/ffprobe';
  out.ok = /^\d/.test(out.lib) && out.ffprobe !== '没装 ffmpeg/ffprobe';
  return out;
}

/** 一句真念出去，确认这条口子当下可用（体检卡点「验一句」用）。 */
export async function speakOne(text, o = {}) {
  const r = await speakScenes([text || '这是一句测试。'], { dir: o.dir, voice: o.voice, rate: o.rate, timeout: o.timeout });
  return { secs: r.secs[0], file: r.files[0] };
}

export default { speakScenes, speakOne, probe, VOICES, voiceName, VOICE_SCRIPT };
