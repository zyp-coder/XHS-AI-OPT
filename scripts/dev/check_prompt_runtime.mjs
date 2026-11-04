// 提示词现场跑一遍：把 popup.js 里拼提示词的几个函数原样抠出来，用假数据真跑。
// 为什么单独一条：静态 grep 查不出「变量没定义」——2026-10-31 npImgPromptShot 里 ch 没了，
// 只要这张没点过人（own=false）就抛 ReferenceError，一键出图 / ↻ 重出当场哑火。
// 跑法：node scripts/dev/check_prompt_runtime.mjs
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
// 顶层常量（函数里直接引用的字符串/小对象）：对象按括号配平，字符串到行尾
function grabConst(name) {
  const at = src.indexOf('const ' + name + ' =');
  if (at < 0) throw new Error('在 popup.js 里找不到 const ' + name);
  let i = src.indexOf('=', at) + 1;
  while (src[i] === ' ') i++;
  if (src[i] === '{') {
    let d = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) return src.slice(at, src.indexOf(';', j) + 1); }
    }
  }
  return src.slice(at, src.indexOf('\n', i));
}

const need = ['npCharById', 'npCharMain', 'npCharFor', 'npCharLine', 'npCharsOfItem', 'npCharIdByName', 'npShotPromptText', 'npImgPromptShot'];
const consts = ['NP_LOOK_XHS', 'NP_NO_REAL_LINE'];
const _npChars = { mainId: 'c1', list: [
  { id: 'c1', name: '老王', role: '装修工长', age: '38 岁', hair: '短寸', body: '微胖', cloth: '深蓝工装', hammers: ['左手腕的旧手表'] },
  { id: 'c2', name: '小林', role: '业主', age: '30 岁', hair: '齐肩发', body: '偏瘦', cloth: '米色针织衫', hammers: [] },
] };

const ctx = vm.createContext({
  _npChars,
  npLookOf: () => ({ style: '手机随拍', motif: '', casting: '' }),
  npLookShape: () => ({}),
  npShotStyle: () => ({ tag: '手机随拍', stripStudio: false, visualNote: '', copyRule: '一句大白话', camera: true, rules: '' }),
  npVw: () => ({ size: '3:4' }),
  npDshIsKnow: () => false,
  npBriefBody: () => '门一量，才知道之前的钱白花了。',
  npBriefMsg: () => '先量门再下单',
  npBriefVisual: () => '',
  npBriefBg: () => '',
  npBriefCopy: (it) => String((it && it.keyText) || '').trim() || '门一量，才知道之前的钱白花了',
  npShotCameraLine: () => '【机位】像作者自己举着手机拍的，竖拍。',
  npStripStudioHints: (x) => x,
  NP_IMG_TEXT_EMPH: '字要大、笔画粗、对比强，缩略图里也能一眼读清，别缩成角落小字；',
  console,
});
vm.runInContext(consts.map(grabConst).join('\n') + '\n' + need.map(grab).join('\n'), ctx);

const w = { shots: { charId: '' } };
const base = { role: '展开', keyText: '四条照着买', text: '门一量，才知道之前的钱白花了。第二条更狠。', scene: '客厅', act: '比划宽度', face: '懊恼' };

const ERR = [];
const must = (name, out, needle) => { if (!out.includes(needle)) ERR.push(name + '：提示词里没有「' + needle + '」'); };

let a = '', b = '', c = '', d = '';
try { a = ctx.npImgPromptShot(w, Object.assign({ id: 'a', chars: [] }, base), 0, 7); }
catch (e) { ERR.push('没点人那张（own=false）抛错：' + e.message); }
try { b = ctx.npImgPromptShot(w, Object.assign({ id: 'b', chars: ['c1'] }, base), 1, 7); }
catch (e) { ERR.push('点了一个人那张抛错：' + e.message); }
try { c = ctx.npShotPromptText(w, Object.assign({ id: 'c', chars: ['c1', 'c2'] }, base), 2, 7, true); }
catch (e) { ERR.push('整组里两同框那张抛错：' + e.message); }
try { d = ctx.npShotPromptText(w, Object.assign({ id: 'd', chars: ['c1'] }, base), 3, 7, false); }
catch (e) { ERR.push('单张复制那张抛错：' + e.message); }

must('出图·图上写字提到最前', a, '这一张图上必须写字，只写「四条照着买」');
must('出图·末尾文案块', a, '【图上文案】');
must('出图·主角名', a, '老王');
must('出图·点名一人', b, '这一张出场的是这一个人');
must('整组·谁出场（两人）', c, '【谁出场】老王、小林');
must('整组·同框主次', c, '同框按主次分大小');
must('单张·谁出场带外形', d, '【谁出场】老王，装修工长，38 岁');
must('单张·图上文案块', d, '【图上文案】');

if (ERR.length) {
  console.log('FAIL（' + ERR.length + ' 条）：');
  ERR.forEach(e => console.log('  ✗ ' + e));
  process.exit(1);
}
console.log('PASS：出图 / 整组 / 单张三条路的提示词都能真跑出来，字、出场、外形都在');
console.log('ALL PASS');
