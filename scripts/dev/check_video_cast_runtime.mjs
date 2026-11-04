// 视频出镜人现场跑一遍：把 popup.js 里拼【谁出场】的几个函数原样抠出来，用假数据真跑。
// 为什么单独一条：静态 grep 查不出「变量没定义 / 老行没剥干净」——
// 2026-11-01 这条要保证换人、按段加配角、老片手改过的提示词都不留旧人。
// 跑法：node scripts/dev/check_video_cast_runtime.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(path.join(ROOT, 'web/popup.js'), 'utf8');

function grab(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('在 popup.js 里找不到 ' + name + '()');
  let i = src.indexOf('{', at), d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
  throw new Error('函数括号没对上：' + name);
}

const need = ['npCharById', 'npCharMain', 'npCharFor', 'npCharLine', 'npDvCastOf', 'npDvCastLine', 'npDvStripCast', 'npDvPromptText'];
const chars = { mainId: 'c1', list: [
  { id: 'c1', name: '老王', role: '装修工长', age: '38 岁', hair: '短寸', body: '微胖', cloth: '深蓝工装', hammers: ['左手腕的旧手表'] },
  { id: 'c2', name: '小林', role: '业主', age: '30 岁', hair: '齐肩发', body: '偏瘦', cloth: '米色针织衫', hammers: [] },
  { id: 'c3', name: '阿强', role: '水电工', age: '42 岁', hair: '平头', body: '壮实', cloth: '灰背心', hammers: [] },
] };

const ctx = vm.createContext({ _npChars: chars, console });
vm.runInContext(need.map(grab).join('\n'), ctx);

const ERR = [];
const must = (name, out, needle) => { if (!out.includes(needle)) ERR.push(name + '：没找到「' + needle + '」\n     实际：' + out.slice(0, 160).replace(/\n/g, ' ⏎ ')); };
const mustNot = (name, out, needle) => { if (out.includes(needle)) ERR.push(name + '：不该有「' + needle + '」\n     实际：' + out.slice(0, 160).replace(/\n/g, ' ⏎ ')); };

const body = '中景，他蹲在门口量门框，镜头轻微晃。';

/* ① 默认：整片就是主角老王 */
const w0 = { dgen: { segs: [] } };
let t = ctx.npDvPromptText(w0, { prompt: body });
must('默认·带人', t, '【谁出场】老王，装修工长，38 岁');
must('默认·标记物', t, '固定不变：左手腕的旧手表');
must('默认·整片一人', t, '整片同一个人');
must('默认·底稿原样', t, body);
if (t.split('【谁出场】').length !== 2) ERR.push('默认：应只有一行【谁出场】，实际 ' + (t.split('【谁出场】').length - 1) + ' 行');

/* ② 换人：dgen.charId 指小林 */
const w1 = { dgen: { charId: 'c2', segs: [] } };
t = ctx.npDvPromptText(w1, { prompt: body });
must('换人·小林', t, '【谁出场】小林，业主，30 岁');
mustNot('换人·不留老王', t, '老王');

/* ③ 按段加配角：主角老王 + 这一段点小林 */
t = ctx.npDvPromptText(w0, { prompt: body, chars: ['c2'] });
must('加人·主角', t, '主角老王，装修工长，38 岁');
must('加人·配角', t, '配角小林，业主，30 岁');
must('加人·主次', t, '老王在画面中间动手，小林在旁搭手；两个人不是同一个人，大小主次分得清');

/* ④ 胶囊里也把主角点了（数组里有主角 id）：去重，不写成两个老王 */
const cs = ctx.npDvCastOf(w0, { chars: ['c1'] });
if (cs.length !== 1) ERR.push('去重：c1 应只算一个人，实际 ' + cs.length + ' 个');
t = ctx.npDvPromptText(w0, { prompt: body, chars: ['c1'] });
must('去重·仍一人', t, '整片同一个人');
mustNot('去重·不写主角配角', t, '配角');

/* ⑤ 老片：存档提示词里已经带着一行旧【谁出场】（换过人再打开） */
const old = '【谁出场】阿强，水电工，42 岁——旧的那行\n' + body;
t = ctx.npDvPromptText(w0, { prompt: old });
if (t.split('【谁出场】').length !== 2) ERR.push('老片：旧行没剥干净，出现 ' + (t.split('【谁出场】').length - 1) + ' 行【谁出场】');
mustNot('老片·不留旧人', t, '阿强');
must('老片·换成现在的人', t, '【谁出场】老王');
must('老片·底稿留着', t, body);

/* ⑥ 连着重几行旧行（历史脏数据）也只留最新一行 */
t = ctx.npDvPromptText(w0, { prompt: '【谁出场】旧甲\n【谁出场】旧乙\n' + body });
if (t.split('【谁出场】').length !== 2) ERR.push('多行旧行：应只剩 1 行，实际 ' + (t.split('【谁出场】').length - 1) + ' 行');
mustNot('多行旧行·旧甲', t, '旧甲');
mustNot('多行旧行·旧乙', t, '旧乙');

/* ⑦ 落库那一步：输入框里粘回来（还带着行首）→ 只存底稿，换人不会叠 */
const stored = ctx.npDvStripCast('【谁出场】老王——整片同一个人\n' + body);
if (stored !== body) ERR.push('落库：应只剩底稿，实际「' + stored.replace(/\n/g, ' ⏎ ') + '」');
if (ctx.npDvStripCast(stored) !== body) ERR.push('落库：剥两次应还是底稿');

/* ⑧ 图文那条不受影响：shots.charId 仍认 */
t = ctx.npDvCastLine({ shots: { charId: 'c3' } }, {});
must('图文·仍认 shots.charId', t, '阿强，水电工，42 岁');
/* 视频优先于图文：两个都设了听视频的 */
t = ctx.npDvCastLine({ shots: { charId: 'c3' }, dgen: { charId: 'c2' } }, {});
must('两条都在·听视频的', t, '小林');
mustNot('两条都在·不听图文的', t, '阿强');

/* ⑨ 一个角色都没有：不报错、不写人 */
ctx._npChars = null;
t = ctx.npDvPromptText(w0, { prompt: body });
if (t !== body) ERR.push('没角色：提示词应原样返回，实际「' + t.replace(/\n/g, ' ⏎ ') + '」');
if (ctx.npDvCastLine(w0, {}) !== '') ERR.push('没角色：行首应为空');
ctx._npChars = chars;
if (ctx.npCharFor(w0).id !== 'c1') ERR.push('恢复后：应回到主角 c1');

if (ERR.length) {
  console.log('FAIL（' + ERR.length + ' 条）：');
  ERR.forEach(e => console.log('  ✗ ' + e));
  process.exit(1);
}
console.log('PASS：默认一人 / 换人 / 按段加配角 / 老行剥净 / 落库底稿 / 图文兼容 / 没角色兜底，七条路都真跑过');
console.log('ALL PASS');
