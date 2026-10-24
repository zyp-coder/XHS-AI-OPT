/* jobs.mjs — 口播那三档出口里两档的账本：② 发工单（照片＋稿＋音色，老板人工做片）＋ ① 自己念（逐句录视频，云端直接串成片）。
 *
 * 规矩冻在 资料/发笔记-口播选出口三档设计.md（上一版 资料/发笔记-口播工单设计.md §十一 已被它取代），这里逐条对上：
 *   两条走法共用一张单的壳：avatar＝照片数字人（进工单台、占每天接单额度）；self＝逐句录视频（不进台、不占额度，录齐云端直接串）
 *   voice＝旧的「一段段念录音」走法，已经归到 self 那一档；老单照旧读得完，新单不再产生
 *   每日接单量按老板的处理能力算【全站总量】（默认 9 单＝3 小时÷20 分钟），不是每人 9 单——self 一条也不占
 *   不做自动撤单、不做超时催办；「等你做」压过额度就在工单台上弹黄条
 *   成片/音轨/照片留 7 天（旋钮）后删 · 同一篇笔记只许一张未完结的单 · 取件认单上那枚口令
 *   碰平台的动作一条也不在这里——发还是客户机自己点；这里只收料、只等片回来。
 *
 * 认三种人：客户网页（cookie 会话）· 客户执行器（挂线凭据 handId+token，走 execCh.checkCred）
 *          · 老板工单台（x-admin-pass 头，与发放管理同一把；没配口令时只放本机）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const STATE_LABEL = {
  await_mat: '等客户交料', ready: '料齐了 · 等你做', making: '你在做',
  delivered: '片好了 · 正在送回', taken: '已送回 · 等位到点自动发',
  rejected: '退回补料', canceled: '已取消',
};
/** self 那一档的态另说（没人接单、没人做片，云端自己串）：界面按 route 挑这套词 */
export const STATE_LABEL_SELF = {
  await_mat: '还没录完', ready: '都录好了 · 正在串', delivered: '片好了 · 正在送回',
  taken: '已送回 · 等位到点自动发', canceled: '已取消',
};
export const ROUTE_LABEL = { avatar: '照片数字人（工单台）', self: '自己对着镜头念（逐句录视频）', voice: '真人原声（一段段念·旧走法）', selfup: '整条片加字幕（云端烧字）' };
/** 退回补料的几个固定原因（界面上点选，省得老板打字）——录音类那句已撤：自己念那档不归工单 */
export const REJECT_WHY = ['照片不清楚', '脸上有遮挡', '照片里不止一个人', '别的（自己写一句）'];

const LIP_MS = 45000;                 // 每 45 秒扫一遍房务（清过期用的）
const SUB_MAX_MS = 30 * 60000;        // 一条字幕最多烧 30 分钟，超时当没烧成（别把工人挂死）
const LOW_WATER = 800 * 1024 * 1024;
const n0 = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
const now = () => Date.now();
const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mins = (ms) => Math.max(0, Math.round((ms || 0) / 60000));

/** 口播稿切成一段一段：先按句号问号叹号切，一句太长（＞每段上限）再按逗号切，还是长就硬切。 */
export function splitSegs(text, maxPer = 40, maxSegs = 15) {
  const clean = String(text || '').replace(/\s+/g, '');
  if (!clean) return [];
  let parts = clean.split(/(?<=[。！？；?!;])/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let p of parts) {
    while (p.length > maxPer) {
      let cut = -1;
      for (const sep of ['，', '、', '；', ',']) { const i = p.lastIndexOf(sep, maxPer); if (i > 0) { cut = i + 1; break; } }
      if (cut <= 0) cut = maxPer;
      out.push(p.slice(0, cut)); p = p.slice(cut);
    }
    if (p) out.push(p);
  }
  if (out.length > maxSegs) {           // 段数超了就把尾巴并进最后一段，别硬砍掉客户的字
    const head = out.slice(0, maxSegs - 1);
    head.push(out.slice(maxSegs - 1).join(''));
    return head;
  }
  return out;
}

/** 剪辑工具（找不到不拦路：合并那步做不成，就把各段原样交给老板） */
const which = c => { try { return spawnSync(process.platform === 'win32' ? 'where' : 'which', [c], { encoding: 'utf8' }).status === 0; } catch (_) { return false; } };
function findFFmpeg() {
  const p = process.env.FILM_FFMPEG || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (p.includes(path.sep) || path.isAbsolute(p)) { if (fs.existsSync(p)) return p; }
  else if (which(p)) return p;
  throw new Error('这台机器上没有剪辑工具 ffmpeg（给 FILM_FFMPEG 指个路，云端装法见 server/deploy-cloud.sh）');
}
function findFFprobe() {
  const p = process.env.FILM_FFPROBE || (process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  if (p.includes(path.sep) || path.isAbsolute(p)) { if (fs.existsSync(p)) return p; }
  else if (which(p)) return p;
  throw new Error('这台机器上没有量时长的工具 ffprobe');
}
function runBin(bin, args, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 8 * 1024 * 1024, cwd: o.cwd, timeout: o.timeoutMs || 0 }, (err, stdout) => {
      if (err) reject(new Error(String(err.message || err).slice(0, 200)));
      else resolve(String(stdout || ''));
    });
  });
}

/** 字幕那一摞（ASS 文本，交给 ffmpeg 的 subtitles 滤镜＝libass 烧进画面）：
 *  一行一句，把片长按句数平均分；白字黑边、对齐压在画面底部（Alignment=2＝底部居中）。 */
export function assText(sents, stepSecs) {
  const tc = (s) => {
    const v = Math.max(0, Number(s) || 0);
    const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
    return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  };
  /* ASS 里 \ 与 {} 是控制符，句子里出现就换掉；换行统一成一行 */
  const clean = (x) => String(x || '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '').replace(/\{/g, '（').replace(/\}/g, '）').trim();
  const lines = (sents || []).map((s, i) => `Dialogue: 0,${tc(i * stepSecs)},${tc((i + 1) * stepSecs)},Sub,,0,0,0,,${clean(s)}`).join('\n');
  return [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 720', 'PlayResY: 1280',
    'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Sub,Noto Sans CJK SC,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,40,40,64,1',
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    lines, '',
  ].join('\n');
}

export function createLipJobs(ctx) {
  const { store, persist, resolveAccount, readEnv, execCh, clientIp, dataDir } = ctx;
  const AQ = ctx.aiQuota || null;   // AI 额度钩子（server/ai-quota.mjs）：数字人只在「交片」那一刻扣 1 条
  const JOB_DIR = path.join(dataDir, 'lip-jobs');

  function knobs() {
    const e = readEnv();
    return {
      dailyCap: n0(e.lipDailyCap, 9),        // 全站一天接几单（＝老板可用小时 ÷ 20 分钟）
      perMins: n0(e.lipPerMins, 20),         // 一条大约占用几分钟
      dueHour: n0(e.lipDueHour, 18),         // 交片承诺：次日几点前
      capVoice: n0(e.lipCapVoice, 250),      // 甲路线字数上限
      capAvatar: n0(e.lipCapAvatar, 400),    // 乙路线字数上限
      capSelfUp: n0(e.lipCapSelfup, 900),    // 自己传整条片加字幕：这一条的字数上限
      maxPer: n0(e.lipSegMax, 40),           // 一段最长几字
      maxSegs: n0(e.lipSegCount, 15),        // 最多几段
      keepDays: n0(e.lipKeepDays, 7),        // 料与成片留几天
      maxPhoto: n0(e.lipMaxPhotoMB, 10) * 1024 * 1024,
      maxSeg: n0(e.lipMaxSegMB, 60) * 1024 * 1024,   // ① 逐句录：一句一句视频，比照片大得多
      maxWhole: n0(e.lipMaxWholeMB, 100) * 1024 * 1024,   // 客户自己传的整条片：加字幕才传这一份
      maxOut: n0(e.lipMaxOutMB, 220) * 1024 * 1024,
    };
  }

  function ensure() { if (!store.lip_jobs || typeof store.lip_jobs !== 'object') store.lip_jobs = {}; }
  const jobs = () => Object.values(store.lip_jobs || {});
  const mine = (accId) => jobs().filter(j => j.acc === accId);
  /** 今日全站已接几单（取消的不占额度；① 自己逐句录、整条片加字幕那两类一张也不占——都是系统自己干） */
  const usedTodayAll = () => jobs().filter(j => j.route !== 'self' && j.route !== 'selfup' && j.state !== 'canceled' && dayOf(j.submittedAt) === dayOf(now())).length;

  /** 预计交片时刻：次日 dueHour 点（"今天提、明天好"） */
  function dueAt(j) {
    if (j._due) return j._due;
    const d = new Date(j.submittedAt);
    d.setDate(d.getDate() + 1); d.setHours(knobs().dueHour, 0, 0, 0);
    j._due = d.getTime();
    return j._due;
  }

  /** 交回给客户/工单台看的那张条 */
  function brief(j) {
    const k = knobs();
    const got = (j.segFiles || []).filter(Boolean).length;
    return {
      id: j.id, acc: j.acc, accName: j.accName || '', noteId: j.noteId || '', title: j.title || '',
      token: j.token || '',
      route: j.route, routeLabel: ROUTE_LABEL[j.route] || j.route, state: j.state,
      stateLabel: STATE_LABEL[j.state] || j.state,
      script: j.script || '', segs: j.segs || [], segCount: (j.segs || []).length, segGot: got,
      segHas: (j.segFiles || []).map(Boolean),
      segLack: Math.max(0, (j.segs || []).length - got),
      photo: j.photo ? { name: j.photo.name, size: j.photo.size, at: j.photo.at } : null,
      voiceWish: j.voiceWish || '', agreePhoto: !!j.agreePhoto,
      lack: lackOf(j, k),
      submittedAt: j.submittedAt, matAt: j.matAt || 0, claimedAt: j.claimedAt || 0,
      deliveredAt: j.deliveredAt || 0, takenAt: j.takenAt || 0, dueAt: dueAt(j),
      waitedMins: mins(now() - j.submittedAt), overdue: j.route !== 'self' && now() > dueAt(j) && !['delivered', 'taken', 'canceled'].includes(j.state),
      workMins: j.claimedAt ? mins((j.deliveredAt || now()) - j.claimedAt) : 0,
      trackSecs: j.trackSecs || 0, trackErr: j.trackErr || '',
      selfErr: j.selfErr || '',   // 逐句录那一档：云端把各句串起来没串成时写这句（串不成也能一句一句下载）
      /* 字幕那一道（界面按这三个字段摆：排队里／烧好了／没成）：done＝新片已经顶掉旧片，能取的就是新的那条 */
      subState: j.subState || '', subMsg: j.subMsg || '', subCount: (j.subSents || []).length,
      canSub: !!(j.outPath && fs.existsSync(j.outPath)) && j.subState !== 'queue',
      canSubRevert: !!(j.prevOutPath && fs.existsSync(j.prevOutPath)),
      hasOut: !!(j.outPath && fs.existsSync(j.outPath)), outSize: j.outSize || 0,
      canTake: j.state === 'delivered' || j.state === 'taken',
      canCancel: j.state === 'await_mat' || j.state === 'ready' || j.state === 'rejected',
      canClaim: j.route !== 'self' && (j.state === 'ready' || j.state === 'rejected'),   // 逐句录那档没有「谁接单」这一步
      canDeliver: j.route !== 'self' && j.state === 'making',
      rejectWhy: j.rejectWhy || '',
      takeUrl: j.token ? `/api/lip/out/${j.id}?t=${j.token}` : '',
      fileUrls: j.token ? {
        photo: j.photo && j.photo.file ? `/api/lip/file/${j.id}?p=photo&t=${j.token}` : '',
        track: j.trackPath ? `/api/lip/file/${j.id}?p=track&t=${j.token}` : '',
        segs: (j.segFiles || []).map((n, i) => n ? `/api/lip/file/${j.id}?p=seg%3A${i}&t=${j.token}` : ''),
        out: j.outPath ? `/api/lip/file/${j.id}?p=out&t=${j.token}` : '',
      } : null,
    };
  }

  /** 缺哪样写哪样（人话，界面上直接摆） */
  function lackOf(j, k) {
    if (j.state === 'canceled' || j.state === 'taken' || j.state === 'delivered') return '';
    if (j.state === 'rejected') return '补：' + (j.rejectWhy || '按他说的原因');
    if (j.route === 'selfup') return j.outPath ? '' : '还没传整条片';
    if (j.route === 'avatar') return j.photo ? '' : '缺照片';
    const lack = (j.segCount || (j.segs || []).length) - (j.segFiles || []).filter(Boolean).length;
    const word = j.route === 'self' ? '句' : '段';
    const verb = j.route === 'self' ? '录' : '念';
    if (!j.segFiles) return '还没开始' + verb;
    return lack > 0 ? `还差 ${lack} ${word}没${verb}` : '';
  }

  /** 谁在发：网页看 cookie，执行器看挂线凭据（handId+token 在请求体里，与云端出片同一套） */
  function who(body, req) {
    const acc = resolveAccount(req);
    if (acc) return acc;
    const c = ctx.execCh && ctx.execCh.api.checkCred(body || {});
    return c && c.ok ? c.acc : null;
  }
  /** 老板侧：配了口令验头，没配只放本机（与发放管理、云端出片体检同一把） */
  function isBoss(req) {
    const pass = readEnv().adminPass;
    if (pass) return String(req.headers['x-admin-pass'] || '') === pass;
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp(req));
  }
  /** 交料那一头：会话/挂线凭据是本单的主人，或者举着单上那枚口令（手机上开念稿页就用这条） */
  function canFeed(j, body, req) {
    const acc = who(body, req);
    if (acc && acc.id === j.acc) return true;
    const t = String((body && body.t) || (req && req.headers['x-lip-token']) || '');
    return !!j.token && t === j.token;
  }

  function newId() { return 'lip_' + randomBytes(6).toString('hex'); }
  const dirOf = (id) => path.join(JOB_DIR, id);

  /* ── 建单 ── */
  async function submit(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）才能提交工单' };
    const k = knobs();
    const route = body.route === 'avatar' ? 'avatar' : body.route === 'self' ? 'self'
      : body.route === 'selfup' ? 'selfup' : body.route === 'voice' ? 'voice' : '';
    if (!route) return { ok: false, error: '先选一条出路：自己对着镜头念，还是发工单（交照片）' };
    const script = String(body.script || '').replace(/\r/g, '').trim();
    const len = script.replace(/[\s]/g, '').length;
    const cap = route === 'avatar' ? k.capAvatar : route === 'selfup' ? k.capSelfUp : k.capVoice;
    if (!script) return { ok: false, error: '口播稿是空的' };
    if (len > cap) return { ok: false, error: `稿子 ${len} 字，这一条上限 ${cap} 字——砍 ${len - cap} 字再交（念下来约 ${Math.round(len / 4.6)} 秒，太长了片子也压不住）` };
    if (route === 'avatar' && !body.agreePhoto) return { ok: false, error: '先勾一句「这张照片是我本人或已获本人同意」' };

    const noteId = String(body.noteId || '').slice(0, 40);
    if (noteId) {
      /* 整条片加字幕的单和别的出口各走各的：同一篇一边逐句录、一边传整条片不冲突，
         只有「这条片已经在云端排字幕」时不让连点。 */
      const dup = mine(acc.id).find(j => j.noteId === noteId &&
        (route === 'selfup'
          ? (j.route === 'selfup' && j.state !== 'canceled' && j.subState === 'queue')
          : (j.route !== 'selfup' && !['canceled', 'taken'].includes(j.state))));
      if (dup) return { ok: false, error: route === 'selfup' ? '这一篇的整条片正在云端排字幕（不用连点）' : '这一篇已经有一张单在走了（不用连点）', job: brief(dup) };
    }
    const isSelf = route === 'self' || route === 'selfup';   // 这两类都是系统自己干，不占老板每天接单额度
    /* 数字人占「每月 2 条」的额度：下单时先看一眼，没额度就不让建单（真扣在交片那一刻）。
       自己念、整条片加字幕两条路一条也不占。 */
    const aiq = route === 'avatar' && AQ ? AQ.info(acc) : null;
    if (aiq && !aiq.unlimited && Number(aiq.left) < 1) {
      return { ok: false, reason: 'ai-quota', error: '数字人额度用完了——加一份 30 元算力包（+2 条）或等下月 1 日恢复；同一篇改稿重做也算新的一条', aiQuota: aiq };
    }
    const left = isSelf ? k.dailyCap : k.dailyCap - usedTodayAll();
    if (!isSelf && left <= 0) return { ok: false, error: `今天排满了（一天只接 ${k.dailyCap} 条）——明天再来，或者先拿别的形式发出去` };

    const segMax = route === 'self' ? Math.max(k.maxSegs, 30) : k.maxSegs;      // 一句一段：250 字的稿子轻松切过 15 句
    const segs = route === 'avatar' || route === 'selfup' ? []
      : (Array.isArray(body.segs) && body.segs.length ? body.segs.map(s => String(s || '').trim()).filter(Boolean) : splitSegs(script, k.maxPer, segMax));
    if (route !== 'avatar' && route !== 'selfup' && segs.length > segMax) {
      if (route !== 'self') return { ok: false, error: `稿子切出来 ${segs.length} 段，最多 ${segMax} 段——砍几句再交` };
      segs.splice(segMax - 1, 0, segs.slice(segMax - 1).join(''));    // 逐句录：尾巴并进最后一句，不砍客户的字
      segs.length = segMax;
    }

    const id = newId();
    const j = {
      id, acc: acc.id, accName: acc.name || '', noteId,
      title: String(body.title || '').slice(0, 40),
      route, script, segs, segFiles: route === 'avatar' ? null : new Array(segs.length).fill(''),
      photo: null, voiceWish: String(body.voiceWish || '').slice(0, 30), agreePhoto: !!body.agreePhoto,
      state: 'await_mat', submittedAt: now(), token: randomBytes(8).toString('hex'),
    };
    store.lip_jobs[id] = j;
    await persist();
    if (route === 'avatar' && body.photoBlobId) {                 // 照片已在网页上选好：建单时一并搬进单里
      if (!await saveFromBlob(j, String(body.photoBlobId))) {
        delete store.lip_jobs[id]; await persist();
        return { ok: false, error: '照片拿不到（可能这一页开太久）——重新选一次照片再交' };
      }
    }
    await refresh(j);
    log(j, `建单 ${id}（${ROUTE_LABEL[route]}${segs.length ? ' · ' + segs.length + ' 句' : ''}）`);
    return { ok: true, job: brief(j), quota: { used: usedTodayAll(), left: Math.max(0, left - (isSelf ? 0 : 1)), daily: k.dailyCap },
      aiQuota: route === 'avatar' && AQ ? AQ.info(acc) : null,
      recordUrl: `/lip-record.html?job=${id}&t=${j.token}` };
  }

  /* ── 客户自己传的整条片（加字幕用）：一边收一边落盘，100MB 也不整份塞内存 ── */
  async function putWhole(j, req, url) {
    if (j.route !== 'selfup') return { ok: false, code: 400, error: '这张单不收整条片' };
    const k = knobs();
    const mime = String(url.searchParams.get('mime') || req.headers['content-type'] || '').split(';')[0].slice(0, 60);
    if (!/^video\/(mp4|quicktime|x-matroska|webm)|^\*$/.test(mime)) return { ok: false, code: 400, error: '整条片只收 mp4 / mov / mkv / webm' };
    const len = Number(req.headers['content-length'] || 0);
    if (len > k.maxWhole) {
      return { ok: false, code: 413, error: `整条片 ${(len / 1048576).toFixed(1)}MB，最大 ${Math.round(k.maxWhole / 1048576)}MB——先压一下再传` };
    }
    if (diskFree() < LOW_WATER + Math.max(len, k.maxWhole)) {
      return { ok: false, code: 507, error: '云端这台机器地方不够放这条片了——先清一清，回头再传（本机这条没动）' };
    }
    const dir = dirOf(j.id);
    fs.mkdirSync(dir, { recursive: true });
    const ext = /quicktime|mov/i.test(mime) ? 'mov' : /matroska/i.test(mime) ? 'mkv' : /webm/i.test(mime) ? 'webm' : 'mp4';
    const out = path.join(dir, 'whole.' + ext);
    const tmp = path.join(dir, 'whole.' + ext + '.part');
    let n = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        n += chunk.length;
        if (n > k.maxWhole) return cb(new Error('TOO_BIG'));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(req, counter, fs.createWriteStream(tmp));
      if (!n) throw new Error('空的，没传上来');
      const oldOut = j.outPath, oldPrev = j.prevOutPath;
      if (oldOut && oldOut !== out) { try { fs.unlinkSync(oldOut); } catch (_) {} }
      if (oldPrev) { try { fs.unlinkSync(oldPrev); } catch (_) {} }
      try { fs.unlinkSync(out); } catch (_) {}
      fs.renameSync(tmp, out);
      j.outPath = out; j.outSize = n;
      j.outName = `${(j.title || '口播').slice(0, 20)}·整条.${ext}`;
      j.prevOutPath = ''; j.prevOutSize = 0; j.prevOutName = '';
      j.subState = ''; j.subMsg = ''; j.subSents = [];
      j.state = 'delivered'; j.deliveredAt = now();
      j.expiresAt = now() + k.keepDays * 86400000;
      await persist();
      log(j, `交整条片 ${j.id}（${(n / 1048576).toFixed(1)}MB）`);
      return { ok: true, job: brief(j) };
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (e && e.message === 'TOO_BIG') return { ok: false, code: 413, error: `整条片超过 ${Math.round(k.maxWhole / 1048576)}MB——先压一下再传` };
      return { ok: false, code: 400, error: '整条片没传完：' + String((e && e.message) || e).slice(0, 80) };
    }
  }

  /* ── 交料：照片 / 一段段录音 / 老板的成片，都走这一个原始字节口 ── */
  async function putFile(body, req, url) {
    ensure();
    const j = store.lip_jobs[String(url.searchParams.get('job') || '')];
    if (!j) return { ok: false, code: 404, error: '没有这张工单（链接过期了？回笔记里重新点一次）' };
    if (!canFeed(j, { t: url.searchParams.get('t') }, req) && !(j.route && isBoss(req))) {
      return { ok: false, code: 403, error: '不是这一单的口令' };
    }
    const part = String(url.searchParams.get('part') || '');
    if (part === 'whole') return await putWhole(j, req, url);
    const sizeCap = part === 'out' ? knobs().maxOut : part === 'seg' ? knobs().maxSeg : knobs().maxPhoto;
    let buf;
    try { buf = await ctx.readRawBody(req); } catch (e) { return { ok: false, code: 400, error: e.message }; }
    if (!buf || !buf.length) return { ok: false, code: 400, error: '空的，没传上来' };
    if (buf.length > sizeCap) {
      const mb = (buf.length / 1048576).toFixed(1), cap = Math.round(sizeCap / 1048576);
      const what = part === 'out' ? '成片' : part === 'seg' ? '这一句' : '照片';
      return { ok: false, code: 400, error: `${what} ${mb}MB，最大 ${cap}MB——${part === 'seg' ? '这一句录太长了，停下重录短一点的' : '压缩一下再传'}` };
    }
    const mime = String(url.searchParams.get('mime') || req.headers['content-type'] || '').split(';')[0].slice(0, 60);
    fs.mkdirSync(dirOf(j.id), { recursive: true });
    let name = '', idx = -1;
    if (part === 'photo') {
      if (!/^image\/(jpe?g|png|webp)$/i.test(mime)) return { ok: false, code: 400, error: '照片只收 jpg / png / webp' };
      name = 'photo.' + (/png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpg');
      j.photo = { name: String(url.searchParams.get('name') || '照片.jpg').slice(0, 60), file: name, size: buf.length, mime };
    } else if (part === 'seg') {
      idx = Math.max(0, Math.min((j.segs || []).length - 1, Number(url.searchParams.get('i')) || 0));
      if (j.route === 'self') {   // ① 自己念：一句一段视频（露脸），录完这句立刻传这一句
        if (!/^video\/(webm|mp4|quicktime|x-matroska)$/i.test(mime)) return { ok: false, code: 400, error: '逐句录只收录出来的视频：webm / mp4 / mov / mkv' };
        name = `seg-${String(idx + 1).padStart(2, '0')}.` + (/mp4/i.test(mime) ? 'mp4' : /quicktime|mov/i.test(mime) ? 'mov' : /matroska/i.test(mime) ? 'mkv' : 'webm');
      } else {
        const ext = /mpeg|mp3/i.test(mime) ? 'mp3' : /wav/i.test(mime) ? 'wav' : /ogg/i.test(mime) ? 'ogg' : /mp4|aac|m4a/i.test(mime) ? 'm4a' : 'webm';
        name = `seg-${String(idx + 1).padStart(2, '0')}.${ext}`;
      }
    } else if (part === 'out') {
      if (!isBoss(req)) return { ok: false, code: 403, error: '传成片只开给工单台' };
      if (!/video\/(mp4|quicktime|x-matroska|webm)|^\*$/.test(mime)) return { ok: false, code: 400, error: '成片只收 mp4 / mov / mkv / webm' };
      name = 'out.' + (/quicktime|mov/i.test(mime) ? 'mov' : /matroska/i.test(mime) ? 'mkv' : /webm/i.test(mime) ? 'webm' : 'mp4');
      j.outName = String(url.searchParams.get('name') || '成片.mp4').slice(0, 60);
      j.outSize = buf.length;
    } else return { ok: false, code: 400, error: '不认识要交的是哪样：' + part };
    try { fs.writeFileSync(path.join(dirOf(j.id), name), buf); }
    catch (e) { return { ok: false, code: 500, error: '云端这台机器写文件没写成：' + e.message.slice(0, 80) }; }
    if (part === 'seg') j.segFiles[idx] = name;
    if (part === 'out') j.outPath = path.join(dirOf(j.id), name);
    await refresh(j);
    log(j, `交料 ${j.id} ${part}${idx >= 0 ? ' 第' + (idx + 1) + (j.route === 'self' ? '句' : '段') : ''}（${(buf.length / 1024).toFixed(0)}KB）`);
    return { ok: true, job: brief(j) };
  }

  /** 从素材仓取一件进来（网页那边先 /api/blob/put 再拿文件号交给建单口） */
  async function saveFromBlob(j, blobId) {
    if (!ctx.getBlobFull) return false;
    const f = await ctx.getBlobFull(blobId);
    if (!f) return false;
    fs.mkdirSync(dirOf(j.id), { recursive: true });
    const name = 'photo.' + (/png/i.test(f.m) ? 'png' : /webp/i.test(f.m) ? 'webp' : 'jpg');
    fs.writeFileSync(path.join(dirOf(j.id), name), f.buf);
    j.photo = { name: f.name || '照片.jpg', file: name, size: f.buf.length, mime: f.m };
    await refresh(j);
    return true;
  }

  /** 料齐没齐：齐了就转「料齐了 · 等你做」；① 自己念那一档齐了直接串成片，不经过工单台 */
  async function refresh(j) {
    if (j.state === 'await_mat' || j.state === 'rejected') {
      const ok = j.route === 'avatar' ? !!j.photo
        : !!j.segFiles && j.segFiles.length > 0 && j.segFiles.every(Boolean);
      if (ok) {
        j.state = 'ready'; j.matAt = j.matAt || now(); j.rejectWhy = '';
        if (j.route === 'voice' && !j.trackPath) await mergeTrack(j);
      }
    }
    /* 逐句录：每传上来一句都会走到这里；句齐了、还没片，就串一次。
       串不成不硬拦——selfErr 写好那句话，状态停在「都录好了」，每一句照样能单独下载。 */
    if (j.route === 'self' && ['ready', 'await_mat'].includes(j.state) && !j.outPath
      && j.segFiles && j.segFiles.length > 0 && j.segFiles.every(Boolean)) {
      await mergeSelf(j);
    }
    await persist();
  }

  /* ── ① 自己念：各句视频按顺序直接串起来，不重新编码（这台机器内存小，转码那种吃内存的活不在这干） ── */
  async function mergeSelf(j) {
    const dir = dirOf(j.id);
    const files = (j.segFiles || []).map(n => path.join(dir, n));
    j.selfErr = '';
    try {
      const exts = [...new Set((j.segFiles || []).map(n => path.extname(n).toLowerCase()))];
      if (exts.length > 1) throw new Error('各句录出来的格式不一样（' + exts.join('/') + '）');
      const ffmpeg = findFFmpeg();
      const list = path.join(dir, 'concat.txt');
      fs.writeFileSync(list, files.map(f => "file '" + path.basename(f) + "'").join('\n'), 'utf8');
      const out = path.join(dir, 'self.' + (exts[0] || '.mp4').replace('.', ''));
      await runBin(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
      try { fs.unlinkSync(list); } catch (_) {}
      j.outPath = out;
      j.outSize = fs.statSync(out).size;
      j.outName = `${(j.title || '口播').slice(0, 20)}·成片.` + (exts[0] || '.mp4').replace('.', '');
      j.trackSecs = await probeSecs(out);
      j.state = 'delivered'; j.deliveredAt = now();
      j.expiresAt = now() + knobs().keepDays * 86400000;
      log(j, `串成片 ${j.id}（${(j.outSize / 1048576).toFixed(1)}MB · ${j.trackSecs}秒 · ${files.length} 句）`);
    } catch (e) {
      j.outPath = '';
      j.selfErr = '各句没串成一条（' + String(e.message || e).slice(0, 60) + '）——每一句照样能一句一句下载，自己去剪映按顺序拼一下';
      console.log(`[lip] ${j.id} 逐句录串片没成：${e.message || e}`);
    }
    await persist();
  }

  /* ── 字幕这一道（2026-10-20 老板定稿）：片已经在云端了，客户点「给这条片加字幕」——
     字用这篇稿子里那几句，一行一句按片长平均分时间轴，烧在画面底部（ffmpeg 的 subtitles 滤镜＝libass）。
     这台机器内存小：先来后到，一次只烧一条。
     烧好的新片顶掉原来那条；旧片留在单的目录里按「料与片留 7 天」清，界面上给一句「↩ 不要了，回上一版」。 ── */
  async function sub(body, req) {
    ensure();
    const j = store.lip_jobs[String((body && body.id) || '')];
    if (!j) return { ok: false, error: '没找到这张工单' };
    if (!canFeed(j, body, req)) return { ok: false, code: 403, error: '不是这一单的口令' };
    if (!j.outPath || !fs.existsSync(j.outPath)) return { ok: false, error: '这条片还没到云端——先让片回来（自己念的那句一句录齐、工单的那边交回来），再回来加字幕' };
    if (j.subState === 'queue') return { ok: true, job: brief(j) };   // 重复点不重排
    const maxSents = j.route === 'selfup' ? 200 : 60;
    const sents = (Array.isArray(body.sents) ? body.sents : [])
      .map(s => String(s || '').replace(/[\r\n]+/g, ' ').trim()).filter(Boolean).slice(0, maxSents);
    if (!sents.length) return { ok: false, error: '一句要烧的话都没有——先回改稿那一站把话填上' };
    if (j.route === 'selfup') {
      const chars = sents.join('').replace(/\s/g, '').length;
      if (chars > knobs().capSelfUp) return { ok: false, error: `这篇稿子 ${chars} 字，加字幕最多 ${knobs().capSelfUp} 字——删短一点再烧` };
    }
    j.subSents = sents; j.subState = 'queue'; j.subAt = now(); j.subMsg = '';
    await persist(); log(j, `排字幕 ${j.id}（${sents.length} 句）`);
    subKick();
    return { ok: true, job: brief(j) };
  }

  /** ↩ 不要了，回上一版：把没烧字幕的那条换回成片位，带字幕那条作废 */
  async function subRevert(body, req) {
    ensure();
    const j = store.lip_jobs[String((body && body.id) || '')];
    if (!j) return { ok: false, error: '没找到这张工单' };
    if (!canFeed(j, body, req)) return { ok: false, code: 403, error: '不是这一单的口令' };
    if (!j.prevOutPath || !fs.existsSync(j.prevOutPath)) {
      return { ok: false, error: `没字幕的那一条不在云端了（超过 ${knobs().keepDays} 天会清）——这条先用带字幕的那版` };
    }
    const k = knobs();
    try { fs.unlinkSync(j.outPath); } catch (_) { /* 删不掉就算了，账已经换走 */ }
    j.outPath = j.prevOutPath; j.outSize = j.prevOutSize || 0; j.outName = j.prevOutName || j.outName;
    j.prevOutPath = ''; j.prevOutSize = 0; j.prevOutName = '';
    j.subState = ''; j.subMsg = ''; j.subSents = [];
    j.state = 'delivered'; j.deliveredAt = now();
    j.expiresAt = now() + k.keepDays * 86400000;
    await persist(); log(j, `回上一版 ${j.id}（没字幕的那条）`);
    return { ok: true, job: brief(j) };
  }

  async function burnSubs(j) {
    const k = knobs(), dir = dirOf(j.id), src = j.outPath;
    j.subMsg = '';
    try {
      if (!src || !fs.existsSync(src)) throw new Error('这条片不在云端了');
      const sents = (j.subSents || []).filter(Boolean);
      if (!sents.length) throw new Error('没有要烧的句子');
      const dur = (await probeSecs(src)) || j.trackSecs || 0;
      if (!dur) throw new Error('量不出这条片多长');
      const ffmpeg = findFFmpeg();
      const assName = 'subs.ass';
      fs.writeFileSync(path.join(dir, assName), assText(sents, dur / sents.length), 'utf8');
      const ext = path.extname(src) || '.mp4';
      const out = path.join(dir, `subbed-${now()}${ext}`);
      const head = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
        '-vf', 'subtitles=' + assName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
      if (ext === '.mp4' || ext === '.mov') head.push('-movflags', '+faststart');
      try {
        await runBin(ffmpeg, [...head, '-c:a', 'copy', out], { cwd: dir, timeoutMs: SUB_MAX_MS });   // 画面重编、声音原样搬
      } catch (e1) {
        await runBin(ffmpeg, [...head, '-c:a', 'aac', '-b:a', '128k', out], { cwd: dir, timeoutMs: SUB_MAX_MS });
      }
      const size = fs.statSync(out).size;
      if (!size) throw new Error('烧出来是空的');
      if (size > k.maxOut) { try { fs.unlinkSync(out); } catch (_) {} throw new Error(`烧出来 ${(size / 1048576).toFixed(0)}MB，比这一条的上限 ${Math.round(k.maxOut / 1048576)}MB 还大`); }
      const oldSize = j.outSize || 0, oldName = j.outName || '';
      j.prevOutPath = src; j.prevOutSize = oldSize; j.prevOutName = oldName;
      j.outPath = out; j.outSize = size;
      j.outName = `${(j.title || '口播').slice(0, 20)}·成片·带字幕${ext}`;
      j.trackSecs = (await probeSecs(out)) || dur;
      j.subState = 'done'; j.subDoneAt = now();
      j.state = 'delivered'; j.deliveredAt = now();
      j.expiresAt = now() + k.keepDays * 86400000;
      log(j, `烧字幕 ${j.id}（${sents.length} 句 · ${j.trackSecs}秒 · ${(size / 1048576).toFixed(1)}MB）`);
    } catch (e) {
      j.subState = 'fail';
      j.subMsg = '云端这一条没烧成（' + String(e.message || e).slice(0, 60) + '）——原来那条片没动，先按没字幕的发，回头再点一次';
      console.log(`[lip] ${j.id} 烧字幕没成：${e.message || e}`);
    }
    await persist();
  }

  /* 一次只烧一条的小工人（这台机器内存 896M，两条一起烧会被挤死）：排着的一根一根走 */
  let subBusy = false;
  const subWaiting = () => jobs().filter(j => j.subState === 'queue').sort((a, b) => (a.subAt || 0) - (b.subAt || 0));
  function subKick() {
    if (subBusy) return;
    setTimeout(() => { subRun().catch(e => console.error('[lip] 字幕这一趟跑歪了：', e && e.message)); }, 30);
  }
  async function subRun() {
    if (subBusy) return;
    subBusy = true;
    try {
      for (let j = subWaiting()[0]; j; j = subWaiting()[0]) {   // 每条走完都会离开「排队」，所以这一圈必定收尾
        if (diskFree() < LOW_WATER) {
          await sweep(true);
          if (diskFree() < LOW_WATER) {
            j.subState = 'fail'; j.subMsg = '云端这台机器地方不够了，这一条先不烧——原来那条片没动，清一清再点一次';
            await persist();
            continue;
          }
        }
        await burnSubs(j);
      }
    } finally { subBusy = false; }
    if (subWaiting().length) subKick();
  }

  /* ── 甲路线：各段接成一条完整音轨（剪辑工具在就直接合，不在就把原段交出去） ── */
  async function mergeTrack(j) {
    const dir = dirOf(j.id);
    const files = (j.segFiles || []).map(n => path.join(dir, n));
    j.trackErr = '';
    try {
      const ffmpeg = findFFmpeg();
      const list = path.join(dir, 'concat.txt');
      // 各段编码器不一样（浏览器录出来的 m4a/opus 混着来）→ 统一转 AAC 44.1k 再串，串得上也放得响
      const norm = files.map((f, i) => path.join(dir, `n${i}.m4a`));
      for (let i = 0; i < files.length; i++) {
        await runBin(ffmpeg, ['-y', '-i', files[i], '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k', norm[i]]);
      }
      fs.writeFileSync(list, norm.map(f => "file '" + path.basename(f) + "'").join('\n'), 'utf8');
      const out = path.join(dir, 'track.m4a');
      await runBin(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
      for (const f of norm) { try { fs.unlinkSync(f); } catch (_) {} }
      try { fs.unlinkSync(list); } catch (_) {}
      j.trackPath = out;
      j.trackSecs = await probeSecs(out);
      j.trackSize = fs.statSync(out).size;
    } catch (e) {
      j.trackPath = '';
      j.trackErr = '各段没接成一条（' + String(e.message || e).slice(0, 60) + '）——工单卡上一段一段照样能下载';
      console.log(`[lip] ${j.id} 合并音轨没成：${e.message || e}`);
    }
    await persist();
  }
  async function probeSecs(f) {
    try {
      const ffprobe = findFFprobe();
      const out = await runBin(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]);
      const n = Number(String(out).trim().split(/\s+/).pop());
      return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
    } catch (_) { return 0; }
  }

  /* ── 客户侧四口 ── */
  async function cancel(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）' };
    const j = store.lip_jobs[String(body.id || '')];
    if (!j || j.acc !== acc.id) return { ok: false, error: '没找到这张工单' };
    if (!['await_mat', 'ready', 'rejected'].includes(j.state)) {
      return { ok: false, error: j.state === 'making' ? '这条他已经接走了，撤不下来——等片回来' : `这条已经${STATE_LABEL[j.state] || j.state}了` };
    }
    j.state = 'canceled'; j.canceledAt = now();
    await persist(); log(j, `撤单 ${j.id}`);
    return { ok: true, job: brief(j) };
  }
  function status(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）' };
    const j = store.lip_jobs[String(body.id || '')];
    if (!j || j.acc !== acc.id) return { ok: false, error: '没找到这张工单' };
    return { ok: true, job: brief(j) };
  }
  function listMine(body, req) {
    ensure();
    const acc = who(body, req);
    if (!acc) return { ok: false, error: '先登录（或把执行器挂上线）' };
    const k = knobs();
    const used = usedTodayAll();
    const list = mine(acc.id).sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 30).map(brief);
    return { ok: true, jobs: list, quota: { used, left: Math.max(0, k.dailyCap - used), daily: k.dailyCap },
      aiQuota: AQ ? AQ.info(acc) : null,
      caps: { voice: k.capVoice, avatar: k.capAvatar, maxSegs: k.maxSegs, maxPer: k.maxPer }, dueLabel: dueLabel() };
  }
  const dueLabel = () => `明天 ${knobs().dueHour}:00 前`;

  /* ── 念稿页要的那张条（认单上口令，手机上不用登录） ── */
  function feed(id, t) {
    ensure();
    const j = store.lip_jobs[String(id || '')];
    if (!j || !j.token || String(t || '') !== j.token) return { ok: false, error: '链接不对或过期了——回笔记里重新点「开始念」' };
    return { ok: true, job: brief(j) };
  }

  /* ── 老板侧：列单 / 接单 / 交片 / 退回 / 按天汇总 ── */
  function listJobs(body, req) {
    ensure();
    if (!isBoss(req)) return { ok: false, code: 403, error: '口令不对' };
    const k = knobs();
    /* 工单台只看老板要动手的那些单：① 自己逐句录、整条片加字幕都是云端自己干，不进这张台 */
    const all = jobs().filter(j => j.route !== 'self' && j.route !== 'selfup').sort((a, b) => b.submittedAt - a.submittedAt);
    const today = dayOf(now());
    const wait = all.filter(j => ['ready', 'making', 'rejected'].includes(j.state));
    const madeToday = all.filter(j => j.deliveredAt && dayOf(j.deliveredAt) === today);
    const claimOpen = all.filter(j => j.state === 'making');
    const byDay = {};
    for (const j of all) {
      const d = dayOf(j.submittedAt);
      const b = byDay[d] = byDay[d] || { day: d, in: 0, made: 0, owing: 0, voice: 0, avatar: 0, minsSum: 0, minsN: 0 };
      if (j.state === 'canceled') continue;
      b.in++; b[j.route]++;
      if (j.deliveredAt) b.made++; else if (j.submittedAt > now() - 30 * 86400000) b.owing++;
      if (j.claimedAt && j.deliveredAt) { b.minsSum += mins(j.deliveredAt - j.claimedAt); b.minsN++; }
    }
    const days = Object.values(byDay).sort((a, b) => b.day < a.day ? -1 : 1).slice(0, 14)
      .map(b => ({ ...b, avgMins: b.minsN ? Math.round(b.minsSum / b.minsN) : 0 }));
    return {
      ok: true,
      jobs: all.filter(j => j.state !== 'canceled' || now() - (j.canceledAt || 0) < 3 * 86400000).map(brief),
      stats: {
        todayIn: all.filter(j => dayOf(j.submittedAt) === today && j.state !== 'canceled').length,
        waiting: wait.length, madeToday: madeToday.length,
        usedHours: Math.round((madeToday.reduce((a, j) => a + mins((j.deliveredAt || now()) - (j.claimedAt || j.submittedAt)), 0)
          + claimOpen.reduce((a, j) => a + mins(now() - j.claimedAt), 0)) / 60 * 10) / 10,
        dailyCap: k.dailyCap, perMins: k.perMins, left: Math.max(0, k.dailyCap - usedTodayAll()),
        overdue: wait.filter(j => now() > dueAt(j)).length,
      },
      knobsOut: { dailyCap: k.dailyCap, perMins: k.perMins, dueHour: k.dueHour, keepDays: k.keepDays, capVoice: k.capVoice, capAvatar: k.capAvatar },
      days, rejectWhy: REJECT_WHY, dueLabel: dueLabel(),
    };
  }
  async function claim(body, req) {
    ensure();
    if (!isBoss(req)) return { ok: false, error: '口令不对' };
    const j = store.lip_jobs[String(body.id || '')];
    if (!j) return { ok: false, error: '没找到这张工单' };
    if (!['ready', 'rejected'].includes(j.state)) return { ok: false, error: `这条现在是${STATE_LABEL[j.state] || j.state}，接不了` };
    j.state = 'making'; j.claimedAt = now();
    await persist(); log(j, `接单 ${j.id}`);
    return { ok: true, job: brief(j) };
  }
  /** 传回成片：先拿 putFile(part=out) 把文件递上来，再点这个口收尾 */
  async function deliver(body, req) {
    ensure();
    if (!isBoss(req)) return { ok: false, error: '口令不对' };
    const j = store.lip_jobs[String(body.id || '')];
    if (!j) return { ok: false, error: '没找到这张工单' };
    if (j.state !== 'making') return { ok: false, error: `这条现在是${STATE_LABEL[j.state] || j.state}——先点「我接这单」` };
    if (!j.outPath || !fs.existsSync(j.outPath)) return { ok: false, error: '成片还没传上来（先把文件递上来再点这个钮）' };
    /* 交片扣 1 条数字人额度（先档位、再算力包）。额度在客户下单时已经看过一遍；
       这里再扣一次是防「同时开着几张单」把额度冲穿——真冲穿了也照交片，记成超支，后续下单会被挡住。 */
    let over = false;
    if (j.route === 'avatar' && AQ && !j.aiQuotaCharged) {
      const acc = store.accounts[j.acc] || null;
      const t = AQ.take(acc);
      j.aiQuotaCharged = now();
      over = !!(t && t.over);
      j.aiQuotaOver = over;
    }
    j.state = 'delivered'; j.deliveredAt = now();
    j.expiresAt = now() + knobs().keepDays * 86400000;
    await persist(); log(j, `交片 ${j.id}（${(j.outSize / 1048576).toFixed(1)}MB · 用时 ${mins(j.deliveredAt - j.claimedAt)} 分钟）${j.route === 'avatar' ? (over ? ' · 数字人额度已超支' : ' · 扣数字人 1 条') : ''}`);
    return { ok: true, job: brief(j), aiQuotaOver: over };
  }
  async function reject(body, req) {
    ensure();
    if (!isBoss(req)) return { ok: false, error: '口令不对' };
    const j = store.lip_jobs[String(body.id || '')];
    if (!j) return { ok: false, error: '没找到这张工单' };
    if (['taken', 'delivered', 'canceled'].includes(j.state)) return { ok: false, error: `这条已经${STATE_LABEL[j.state]}了` };
    j.state = 'rejected'; j.rejectWhy = String(body.why || '要补料').slice(0, 60);
    /* 已交的料留着（退回通常是某一样不行，不必让客户全重录）；只把合好的音轨作废，等重交的段进来再合 */
    if (j.trackPath) { try { fs.unlinkSync(j.trackPath); } catch (_) { /* 删不掉就算了，重合会覆盖 */ } }
    j.trackPath = ''; j.trackSecs = 0; j.trackErr = ''; j.claimedAt = 0;
    await persist(); log(j, `退回 ${j.id}：${j.rejectWhy}`);
    return { ok: true, job: brief(j) };
  }

  /* ── 取件：GET /api/lip/out/<id>?t= 客户机取成片（一取就转「已送回」） ── */
  function handleOut(req, res, url) {
    ensure();
    const id = decodeURIComponent(url.pathname.slice('/api/lip/out/'.length));
    const j = store.lip_jobs[id];
    const plain = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
    if (!j) return plain(404, '404 没这张工单'), true;
    if (!j.token || j.token !== String(url.searchParams.get('t') || '')) return plain(403, '403 取回口令不对'), true;
    if (!j.outPath || !fs.existsSync(j.outPath)) {
      return plain(404, j.state === 'making' ? '404 他还在做，片子没回来' : '404 还没交片'), true;
    }
    streamFile(req, res, j, j.outPath, j.outName || '成片.mp4', () => {
      if (j.state === 'delivered') { j.state = 'taken'; j.takenAt = now(); persist(); log(j, `客户取回 ${j.id}`); }
    });
    return true;
  }
  /** 通用取一件：p=photo|track|seg:<i>|out；out 认单上口令，其余认老板或本单主人 */
  function handleFile(req, res, url) {
    ensure();
    const id = decodeURIComponent(url.pathname.slice('/api/lip/file/'.length));
    const j = store.lip_jobs[id];
    const plain = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
    if (!j) return plain(404, '404 没这张工单'), true;
    const t = String(url.searchParams.get('t') || ''), p = String(url.searchParams.get('p') || '');
    const owner = j.token && t === j.token;
    if (!owner && !isBoss(req) && !(resolveAccount(req) && resolveAccount(req).id === j.acc)) return plain(403, '403 没这个权限'), true;
    let f = '', name = '', inline = false;
    if (p === 'photo' && j.photo && j.photo.file) { f = path.join(dirOf(j.id), j.photo.file); name = j.photo.name; inline = true; }
    else if (p === 'track' && j.trackPath) { f = j.trackPath; name = `${(j.title || j.id).slice(0, 20)}·原声.m4a`; }
    else if (/^seg:(\d+)$/.test(p)) {
      const i = Number(/seg:(\d+)/.exec(p)[1]);
      if (!j.segFiles || !j.segFiles[i]) return plain(404, '404 这一段还没录'), true;
      f = path.join(dirOf(j.id), j.segFiles[i]); name = `${(j.title || '').slice(0, 16)}-第${i + 1}${j.route === 'self' ? '句' : '段'}.${path.extname(j.segFiles[i]).slice(1)}`;
    } else if (p === 'out' && j.outPath) { f = j.outPath; name = j.outName || '成片.mp4'; }
    if (!f || !fs.existsSync(f)) return plain(404, '404 这样料还没有'), true;
    streamFile(req, res, j, f, name, null, inline);
    return true;
  }
  function streamFile(req, res, j, f, name, onDone, inline) {
    let size;
    try { size = fs.statSync(f).size; } catch (e) { res.writeHead(404); res.end('404 文件读不出来'); return; }
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = { mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
      m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'application/octet-stream';
    const enc = encodeURIComponent(String(name || path.basename(f)));
    res.writeHead(200, {
      'Content-Type': mime, 'Content-Length': size,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="lip-${j.id}-${ext}"; filename*=UTF-8''${enc}`,
      'Cache-Control': 'no-store',
    });
    /* 成片可能上百兆：一边读一边交出去，别整份塞进内存 */
    const rs = fs.createReadStream(f);
    rs.on('error', () => { try { res.destroy(); } catch (_) {} });
    res.on('close', () => { try { rs.destroy(); } catch (_) {} });
    res.on('finish', () => { if (onDone) onDone(); });
    rs.pipe(res);
  }

  /* ── 房务：料与成片留 7 天（旋钮）；磁盘紧张先删已送回过的 ── */
  async function sweep(eager) {
    ensure();
    const k = knobs(), t = now(), keepMs = k.keepDays * 86400000;
    let freed = 0, changed = false;
    for (const j of jobs()) {
      const busy = ['await_mat', 'ready', 'making', 'rejected'].includes(j.state);
      if (!busy && (j.outPath || j.photo || (j.segFiles || []).some(Boolean))) {
        const exp = j.expiresAt || ((j.deliveredAt || j.canceledAt || j.submittedAt) + keepMs);
        if (exp < t) { freed += rmDir(j); changed = true; }
      }
      if (eager && j.state === 'taken' && j.outPath) {
        j.outPath = ''; j.outSize = 0; changed = true;      // 磁盘紧张：成片客户拿过了就删，账还留着
      }
      /* 烧字幕顶掉的那条旧片：留满 keepDays 单清这一份（界面上「↩ 不要了，回上一版」到这儿就没得回了）；磁盘紧张也先清它 */
      if (j.prevOutPath && (eager || t - (j.subDoneAt || j.subAt || 0) > keepMs)) {
        try { fs.unlinkSync(j.prevOutPath); } catch (_) { /* 删不动就算了，下一钩再试 */ }
        j.prevOutPath = ''; j.prevOutSize = 0; j.prevOutName = ''; changed = true;
      }
      /* 整条片加字幕的单：传上来放了 keepDays 还没烧成／没再动的，连片带账一起清（排队里的不动） */
      if (j.route === 'selfup' && j.subState !== 'queue' && j.state !== 'canceled'
        && t - (j.subDoneAt || j.subAt || j.submittedAt) > keepMs) {
        freed += rmDir(j); delete store.lip_jobs[j.id]; changed = true;
      }
      if (!busy && (j.deliveredAt || j.canceledAt) && t - (j.deliveredAt || j.canceledAt) > keepMs * 2) {
        freed += rmDir(j); delete store.lip_jobs[j.id]; changed = true;   // 满 14 天的老账整条抹掉
      }
    }
    if (diskFree() < LOW_WATER && !eager) {                 // 磁盘紧张：先把客户拿过的成片删掉腾地方
      const ff = await sweep(true);
      freed += ff;
      console.log(`[lip] 磁盘紧张，腾出 ${(ff / 1048576).toFixed(0)}MB（只删了已送回客户手里的）`);
    }
    if (changed) await persist();
    return freed;
  }
  function diskFree() {
    try {
      const st = typeof fs.statfsSync === 'function' ? fs.statfsSync(dataDir) : fs.statvfsSync(dataDir);
      return Number(st.bavail) * Number(st.bsize);
    } catch (_) { return Infinity; }
  }
  function rmDir(j) {
    let n = 0;
    try {
      const d = dirOf(j.id);
      if (fs.existsSync(d)) { n = dirSize(d); fs.rmSync(d, { recursive: true, force: true }); }
    } catch (_) { /* 删不动就算了，下一钩再试 */ }
    j.outPath = ''; j.trackPath = ''; j.outSize = 0;
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

  /* ── 体检：剪辑工具装没装、这张账本多大（工单台页头那一行用） ── */
  function envProbe() {
    const k = knobs();
    let bin = '';
    try { bin = 'ffmpeg 在（' + findFFmpeg() + '）'; }
    catch (e) { bin = '✗ ' + e.message + '——自己念那档串不成一条整片、旧走法合不成音轨，各句照样能下载'; }
    return { ok: true, bin, dailyCap: k.dailyCap, perMins: k.perMins, dueHour: k.dueHour, keepDays: k.keepDays,
      capVoice: k.capVoice, capAvatar: k.capAvatar, capSelfUp: k.capSelfUp,
      jobs: jobs().filter(j => j.route !== 'self' && j.route !== 'selfup').length,
      waiting: jobs().filter(j => j.route !== 'self' && j.route !== 'selfup' && ['ready', 'making'].includes(j.state)).length };
  }

  const log = (j, msg) => console.log(`[lip] ${(j && j.accName) || '?'} ${msg}`);
  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(() => { sweep().catch(e => console.error('[lip] 房务没跑成：', e && e.message)); }, LIP_MS);
    if (timer.unref) timer.unref();
    subKick();   // 上一次进程前排着没烧完的，接着烧（burnSubs 完事必定离开「排队」，不会来回转）
    const k = knobs();
    console.log(`[lip] 口播出口上岗：工单（照片）一天接 ${k.dailyCap} 条（每条约 ${k.perMins} 分钟）· 承诺${dueLabel()}好 · 照片≤${k.capAvatar}字/自己念≤${k.capVoice}字 · 一句一句录的不占额度 · 料与片留 ${k.keepDays} 天 · 字幕一次烧一条`);
  }

  return {
    start,
    api: {
      submit, cancel, status, listMine, feed, putFile, listJobs, claim, deliver, reject,
      sub, subRevert,
      handleOut, handleFile, envProbe, knobs, sweep: () => sweep(), brief, splitSegs, STATE_LABEL, ROUTE_LABEL,
      REJECT_WHY, dueLabel,
    },
  };
}
