// 图文分镜张数「按内容类型」自检（2026-11-02）
// 覆盖：五条线的总张数 / 分镜张数（含封面扣 1）、短稿降档、干货步骤多放到 6、认不出按干货、
//       ③ 改过的线盖过排产、档案上那列 type 落库、后台提示词按范围切且不再写死 4~6、四份副本一致。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(ROOT + p)).digest('hex');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

/* ── 1. 从 web/popup.js 里把判型与张数那段拎出来跑（跟真代码同一份） ── */
const popup = read('web/popup.js');
const a = popup.indexOf('const NP_DSH_COUNT');
const b = popup.indexOf('function npDshRange(w)');
const end = popup.indexOf('\n}\n', popup.indexOf('return { key: key', b)) + 3;
ok(a > 0 && b > a && end > b, 'popup.js 里找得到 NP_DSH_COUNT ~ npDshRange');
const KEYS = ['tale', 'echo', 'meme', 'hot', 'howto'];
const npWritePickNow = w => {
  const wr = w && w.write;
  if (wr && KEYS.includes(wr.type)) return { type: wr.type, kind: wr.kind || '' };
  const pi = w && w.planItem;
  if (pi && KEYS.includes(pi.type)) return { type: pi.type, kind: pi.kind || '' };
  return { type: '', kind: '' };
};
const npCoverOn = w => !(w && w.shots && w.shots.cv && w.shots.cv.on === false);
const M = new Function('npWritePickNow', 'npCoverOn', popup.slice(a, end) + '\nreturn {npDshTypeKey,npDshRange,npDshStepCount,npDshIsKnow};')(npWritePickNow, npCoverOn);
const mk = (text, extra) => Object.assign({ draft: { content: text } }, extra || {});
const long = '字'.repeat(900);
const longSteps = '1. 一步\n2. 二步\n3. 三步\n4. 四步\n5. 五步\n' + long;
const short = '字'.repeat(300);
const range = w => M.npDshRange(w);
const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want);

/* 干货：3~4 总图（含封面）；不要封面＝全分镜；步骤特别多＝最多 6 */
let r = range(mk(long, { planItem: { type: 'howto' } }));
ok(r.key === 'howto' && eq(r.total, [3, 4]) && eq(r.shot, [2, 3]) && r.cover === 1, '干货：总 3~4（含封面）→ 分镜 2~3');
r = range(mk(long, { planItem: { type: 'howto' }, shots: { cv: { on: false } } }));
ok(eq(r.total, [3, 4]) && eq(r.shot, [3, 4]) && r.cover === 0, '干货·不要封面：分镜 3~4');
r = range(mk(longSteps, { planItem: { type: 'howto' } }));
ok(eq(r.total, [3, 6]) && eq(r.shot, [2, 5]) && /步骤多/.test(r.why), '干货·5 步起：总最多 6 → 分镜 2~5');
r = range(mk('第一件看料\n第二件摸面\n第三件比价\n第四件写单\n' + long, { planItem: { type: 'howto' } }));
ok(eq(r.total, [3, 4]) && eq(r.shot, [2, 3]), '干货·4 步（第一件写法）：仍在 3~4，不放宽');

/* 感悟 / 热点：7~8 总图；正文太短降到 4~5 */
for (const k of ['tale', 'hot']) {
  r = range(mk(long, { planItem: { type: k } }));
  ok(r.key === k && eq(r.total, [7, 8]) && eq(r.shot, [6, 7]), k + '：总 7~8 → 分镜 6~7');
  r = range(mk(short, { planItem: { type: k } }));
  ok(eq(r.total, [4, 5]) && eq(r.shot, [3, 4]) && /正文短/.test(r.why), k + '·短稿：总 4~5 → 分镜 3~4');
}

/* 情绪 / 热梗：4~5；极短 3 */
for (const line of ['情绪', '热梗 · 干货']) {
  const k = line.indexOf('热梗') >= 0 ? 'meme' : 'echo';
  r = range(mk(long, { drainPick: { line: line } }));
  ok(r.key === k && eq(r.total, [4, 5]) && eq(r.shot, [3, 4]), k + '：总 4~5 → 分镜 3~4');
  r = range(mk(short, { drainPick: { line: line } }));
  ok(eq(r.total, [3, 3]) && eq(r.shot, [2, 2]), k + '·极短：总 3 → 分镜 2');
}

/* 认不出类型 → 干货；两段式按前段主基调；③ 改过的线盖过排产；档案记的 type 也认 */
r = range(mk(long, {}));
ok(r.key === 'howto' && eq(r.total, [3, 4]), '认不出类型 → 按干货 3~4');
r = range(mk(long, { drainPick: { line: '感悟 · 干货' } }));
ok(r.key === 'tale' && eq(r.total, [7, 8]), '两段式「感悟 · 干货」按前段感悟算');
r = range(mk(long, { write: { type: 'hot' }, planItem: { type: 'howto' } }));
ok(r.key === 'hot' && eq(r.total, [7, 8]), '③ 改过的线（热点）盖过排产（干货）');
r = range(mk(long, { noteType: 'echo' }));
ok(r.key === 'echo' && eq(r.total, [4, 5]), '档案记的 type（情绪）认得上');

/* 步骤计数 */
ok(M.npDshStepCount('1. 甲\n2. 乙\n3. 丙') === 3, '步骤计数：编号行');
ok(M.npDshStepCount('第一步先看；第二步再算；第三步落单') === 3, '步骤计数：第 N 步');
ok(M.npDshStepCount('第一件看料；第二件摸面；第三件比价；第四件写单') === 4, '步骤计数：第 N 件');
ok(M.npDshStepCount('第一招看；第二招摸；第三招比') === 3, '步骤计数：第 N 招');
ok(M.npDshIsKnow({ planItem: { type: 'howto' } }) === true && M.npDshIsKnow({ planItem: { type: 'tale' } }) === false, 'npDshIsKnow 只认干货');

/* ── 2. 分镜页文案 / 档位 / 补图路径 ── */
ok(/\[2, 3, 4, 5, 6, 7, 8\]\.map\(nChip\)/.test(popup), '分镜页档位补上 2 / 7 两档');
ok(popup.includes('按内容定＝这篇算「'), '分镜页写清「按内容定」按类型给范围');
ok(!/AI 自己定＝看内容切、宁少勿多/.test(popup), '旧的「AI 自己定 / 宁少勿多」文案已撤');
ok(/typeKey: rng\.key,[\s\S]{0,160}typeName: rng\.name,[\s\S]{0,160}shotMin: want \? 0 : rng\.shot\[0\]/.test(popup), '⑤ 生成分镜把料型与范围一起发给后台');
ok(/noteType: String\(note\.type \|\| ''\)/.test(popup) && /const rng = npDshRange\(w\);/.test(popup), '档案补图也走 npDshRange（不再写死 3）');
ok(!/shotN: 3/.test(popup), '档案补图不再写死 shotN: 3');
ok(/type: npDshTypeKey\(w\),/.test(popup), '档案落库带这一篇的内容类型');
ok(/\[2, 3, 4, 5, 6, 7, 8\]\.indexOf\(n\) >= 0/.test(popup), 'npShotsShape 的 shotN 认得 2~8');

/* ── 3. 后台分镜提示词：按范围切、不再写死 4~6 ── */
const BG = ['server/bg/background.js', 'executor/exec-core.js', 'extension/background.js', 'web/download/_proto/exec-core.js'];
for (const p of BG) {
  const s = read(p);
  ok(s.includes("const typeKey = String((data && data.typeKey)") && s.includes('const shotMin = ') && s.includes('const shotMax = '), p + '：按 typeKey / shotMin / shotMax 切');
  ok(s.includes('每一条都必须是一个完整、独立的点') && s.includes('前因一张、结果一张'), p + '：每张一个完整点 + 故事可拆两张');
  ok(!s.includes('宁少勿多（约 4~6 条') && !s.includes('宁少勿多约 4~6 条重点'), p + '：不再写死 4~6 条');
  ok(/return \[2, 3, 4, 5, 6, 7, 8\]\.indexOf\(n\) >= 0/.test(s), p + '：手点档位认得 2~8');
  ok(s.includes("type: o.line === 'd' ? 'tale' : 'howto'"), p + '：排产出的篇带内容类型');
}

/* ── 4. 四份副本（界面三份一致；后台三份一致） ── */
const pu = md5('executor/popup.js'), pu2 = md5('extension/popup.js'), pu3 = md5('web/download/_proto/popup.js');
ok(pu === pu2 && pu === pu3, '三份界面副本 popup.js 一致');
const b1 = md5('executor/exec-core.js'), b2 = md5('extension/background.js'), b3 = md5('web/download/_proto/exec-core.js');
ok(b1 === b2 && b1 === b3, '三份后台副本一致');

console.log(fails ? ('\n自检没全过：' + fails + ' 条 ✗') : '\n自检全过 ✅');
process.exit(fails ? 1 : 0);
