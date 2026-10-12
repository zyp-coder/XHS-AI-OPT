// A4 自检脚本：collections + clips 双表 + npArchiveCoerce collectionIds 字段
// 用 node 直接跑；不依赖扩展运行时
const NP_C = 'np_collections';
const NP_K = 'np_clips';

function nid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function npCol(name, src) {
  return { id: nid(), name: String(name || '').slice(0, 30), source: String(src || ''), clips: [], at: Date.now() };
}
function npClipI(kind, ref) {
  return { id: 'k' + nid(), kind: String(kind || 'video'), ref: String(ref || ''), at: Date.now() };
}
let _npCurClipUrl = null;
function npClipPlayRelease() { if (_npCurClipUrl) { try { URL.revokeObjectURL(_npCurClipUrl); } catch (_) {} _npCurClipUrl = null; } }
function npClipPlay(blob) {
  if (!(blob instanceof Blob)) return '';
  npClipPlayRelease();
  try { _npCurClipUrl = URL.createObjectURL(blob); }
  catch (_) { _npCurClipUrl = null; }
  return _npCurClipUrl || '';
}

const store = {};
function npColR() { const a = store[NP_C]; return Array.isArray(a) ? a : []; }
function npColW(list) { store[NP_C] = list; }
function npClipR() { const a = store[NP_K]; return Array.isArray(a) ? a : []; }
function npClipW(list) { store[NP_K] = list; }
function npAsNeedsR() { return { needs: [{ id: 'n1', source: 'sell|free' }, { id: 'n2', source: 'kb|kitchen' }] }; }
function npAsGaps() {
  const cols = npColR();
  if (!cols.length) return [];
  const needs = (npAsNeedsR().needs) || [];
  return cols.map(c => {
    const s = String(c.source || '');
    if (!s) return { id: c.id, missing: false };
    if (!/^(sell|kb)\|/.test(s)) return { id: c.id, missing: true };
    const need = needs.find(n => n && n.source === s);
    return need ? { id: c.id, missing: false, needId: need.id } : { id: c.id, missing: true };
  });
}
function npArchiveCoerce(old) {
  if (!old || typeof old !== 'object') return null;
  return Object.assign({}, old, {
    _sv: 1, dir: old.dir || 'old', kOut: old.kOut || '', dOut: old.dOut || '',
    mind: old.mind || null, voiceUrl: old.voiceUrl || '', voiceError: old.voiceError || null,
    dgenDocs: Array.isArray(old.dgenDocs) ? old.dgenDocs : [], asm: old.asm || null,
    collectionIds: Array.isArray(old.collectionIds) ? old.collectionIds.filter(x => typeof x === 'string') : [],
  });
}

let total = 0, fail = 0;
const pass = (n, c, det) => {
  total++;
  if (!c) fail++;
  console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : ''));
};

// 1. Read/Write
pass('初读空表 cols', npColR().length === 0);
pass('初读空表 clips', npClipR().length === 0);

const c1 = npCol('免费测漏实拍', 'sell|free');
pass('c1 id 前缀 c', /^c[a-z0-9]+$/.test(c1.id), c1.id);
pass('c1 name 截断', c1.name === '免费测漏实拍');
pass('c1 source 保留', c1.source === 'sell|free');
pass('c1 clips=[]', Array.isArray(c1.clips) && c1.clips.length === 0);

const c2 = npCol('手建', '');
pass('c2 manual src=""', c2.source === '');

const c3 = npCol('长长长长长长长长长长长长长长长长长长长长长长长长长长长长名字', 'kb|kitchen');
pass('c3 name 截到 30', c3.name.length === 30, c3.name);

const v1 = npClipI('video', '施工1.mp4');
pass('v1 id 前缀 kc', /^kc[a-z0-9]+$/.test(v1.id), v1.id);
pass('v1 kind=video', v1.kind === 'video');
pass('v1 ref 保留', v1.ref === '施工1.mp4');

const i1 = npClipI('image', 'data:image/jpeg;base64,/9j/...');
pass('i1 kind=image', i1.kind === 'image');

// 写读
npColW([c1, c2, c3]);
pass('写 cols 后 store 有', store[NP_C].length === 3);
pass('读 cols 拿回 3', npColR().length === 3);
npClipW([v1, i1]);
pass('写 clips 后 store 有', store[NP_K].length === 2);

// 挂载
c1.clips = [v1.id, i1.id];
pass('c1 挂两个 clip', c1.clips.length === 2);

// gaps 三种情况
const gaps = npAsGaps();
pass('gaps 数 = 3', gaps.length === 3);
pass('c1 sell 命中', gaps[0].missing === false && gaps[0].needId === 'n1');
pass('c2 manual 不参与', gaps[1].missing === false && !gaps[1].needId);
pass('c3 kb 命中', gaps[2].missing === false && gaps[2].needId === 'n2');

const c4 = npCol('孤儿', 'sell|tenyear');
npColW([c1, c2, c3, c4]);
const gaps2 = npAsGaps();
pass('c4 need 未建 → missing', gaps2[3].missing === true && !gaps2[3].needId);

const c5 = npCol('错格式', '随便写的串');
npColW([c1, c5]);
const gaps4 = npAsGaps();
pass('c5 不带 | → missing', gaps4[1].missing === true);

// ObjectURL 生命周期
const log = [];
globalThis.URL = {
  _counter: 0,
  createObjectURL(blob) { this._counter++; const u = 'blob:fake/' + this._counter; log.push('create ' + u); return u; },
  revokeObjectURL(u) { log.push('revoke ' + u); }
};
const u1 = npClipPlay(new Blob(['x']));
pass('npClipPlay 返回 url', /^blob:fake\/\d/.test(u1));
pass('ObjectURL 已记录', _npCurClipUrl === u1);
const u2 = npClipPlay(new Blob(['y']));
pass('第二次返回新 url', u2 !== u1);
pass('revoke 上一个', log[0] === 'create ' + u1 && log[1] === 'revoke ' + u1 && log[2] === 'create ' + u2);
npClipPlayRelease();
pass('release 后清空', _npCurClipUrl === null);
pass('release 记录 revoke', log[3] === 'revoke ' + u2);
const u3 = npClipPlay(null);
pass('非 Blob → 空串', u3 === '');
pass('非 Blob 不动 cur', _npCurClipUrl === null);

// coerce 加 collectionIds
const old1 = npArchiveCoerce({ id: 'a1' });
pass('coerce 空 默认 []', Array.isArray(old1.collectionIds) && old1.collectionIds.length === 0);
const old2 = npArchiveCoerce({ id: 'a2', collectionIds: ['colabc', null, 'colxyz', 42] });
pass('coerce 过滤非 string', old2.collectionIds.length === 2 && old2.collectionIds[0] === 'colabc' && old2.collectionIds[1] === 'colxyz');
const old3 = npArchiveCoerce(null);
pass('coerce(null) → null', old3 === null);

console.log('\n📋 A4 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);