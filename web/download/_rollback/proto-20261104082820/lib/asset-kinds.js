/**
 * asset-kinds.js — 素材 18 类底层标签池（素材库「这类该不该有料」那一层的唯一真源）
 *
 * 纯数据 + 纯函数：不发请求、不碰 DOM、不写 window（顶层 const，popup 的 script 与后台 importScripts 共用同一份）。
 *
 * 口径（2026-10-15 老板给的池子 + 两条改版令）：
 *   扁平标签池 —— 一条素材可挂多个类；「归哪一类」打在集合这一层（一个集合一个类），只为报缺口准，不做分类树。
 *   两类问题分开问：本文件这一层管「这类该不该有料」（AI 按账号诊断判：该备 / 不用备 / 待你定）；
 *                   集合上的 use 管「这一集这次用不用」（用 / 停用 / 还没定），由类判定 + 有没有料 + 账号阶段推出来。
 *   判据吃诊断已有的格子 —— 问卷第 1 题身份、第 3 题凭据、第 11 题手上有什么真实素材 ＋ 知识库八分类 ＋ 账号类型 ＋ 产品形态；不新开问题。
 *   灰档三类（标题/封面模板、热点时效、品牌视觉）—— 不是「手上有没有」的事（版式当场排、时效归排期、调性归内容基调），
 *                   默认判「不用备」，账号真需要时人可翻案（产地直发那种：时令强时效 + 包装就是招牌）。
 *   出图那侧的引用 —— 「这一派要什么料」打在 lib/visual-motif.js 每条流派的 kind 上（流派 → 类 id），本文件扫那张表反推出
 *                   每个类被哪些流派用；那边改了这里自动跟上，不两处各写一份。
 *
 *   2026-10-24 另加一层「素材库标签」NP_LIB_TAGS（8 个）：只管素材库页怎么平铺 / 怎么筛 / 给人打标。
 *   18 类不动（缺料分析、AI 判据还按 18 类），旧标签进 8 个时走 NP_LIB_TAG_MAP 归并。
 */

const NP_ASSET_KINDS = [
  { k: 'team',   n: '团队/个人照片', why: '问卷「你是这行里的什么人」＋「手上有什么真实素材」勾了真实照片', need: '你本人/师傅/店里的真人画面，横版为主' },
  { k: 'prod',   n: '产品实拍', why: '产品形态＝实物/材料（读产品名称与账号简介判）', need: '东西本身摊开拍，能看清型号与质感' },
  { k: 'before', n: '前后对比', why: '卖点里带「改前改后/不返工/一次搞定」这类差异点', need: '同一处同一角度的两张，别换机位' },
  { k: 'case',   n: '案例截图', why: '凭据题勾了「服务过 100+ 顾客」', need: '做过谁的、结果什么样，名字打码' },
  { k: 'tool',   n: '工具/界面录屏', why: '产品形态＝软件/小程序/系统', need: '先想好截哪个界面、圈哪一处' },
  { k: 'chart',  n: '图表/流程图', why: '账号类型是干货分享/资料整理/教程 ＋ 知识库有「数据·成本」条', need: '有真实数据才画；没数据让 AI 画示意图' },
  { k: 'scene',  n: '场景空镜', why: '问卷「顾客在什么场景想起你」＋同城挡位开着', need: '现场环境、楼道、门口，不放人也行' },
  { k: 'tpl',    n: '标题/封面模板', why: '版式件：AI 每次出图当场排，不在你手上', need: '不用备（想固定版式在「内容基调」里定）', gray: 1 },
  { k: 'qual',   n: '资质/背书', why: '凭据题勾了「有资质证书」', need: '证照、检测报告、合同页，敏感号打码' },
  { k: 'ship',   n: '发货/物流', why: '身份题勾了「源头（工厂·产地·农户）」＋实物类', need: '打包、装车、面单（挡住收件人）' },
  { k: 'make',   n: '生产/制作过程', why: '素材题勾了「老物件·工具·原料」', need: '一道工序一段，3~10 秒就够剪' },
  { k: 'store',  n: '门店/线下场景', why: '身份题勾了「老板·店主」＋城市有值', need: '门头、店内、人来人往那一段' },
  { k: 'ugc',    n: '用户UGC', why: '素材题勾了「顾客反馈截图·聊天记录」', need: '别人拍的/写的：评价、返图、聊天' },
  { k: 'hot',    n: '热点/时效素材', why: '时效轴：归五条线的热点线与排期管，不是「手上有没有」', need: '不用备（真要备的是节点表）', gray: 1 },
  { k: 'price',  n: '价格/优惠信息', why: '知识库有「数据·成本」分类的条', need: '真实报价口径，带条件（几平/几件起）' },
  { k: 'risk',   n: '风险提示/避坑', why: '问卷「这行你最看不惯什么」有勾 ＋ 知识库「避坑经验」', need: '踩坑现场照、翻车图，最出信任' },
  { k: 'qa',     n: '问答/互动', why: '问卷「顾客最常问你哪 3 个问题」有答 ＋ 知识库「顾客痛点」', need: '一问一答一张图，问题照顾客原话写' },
  { k: 'brand',  n: '品牌视觉', why: '调性轴：已在「内容基调 / 出图默认」里定，不占你备料', need: '不用备（logo 与标准色要传的话走「资质/背书」）', gray: 1 },
];

/* 类这一层的三档；集合那一层的「用不用」另三档（on/off/ask），两边词别混 */
const NP_KIND_TEXT = { need: '该备', no: '不用备', ask: '? 待你定', gray: '灰档' };
const NP_USE_TEXT = { on: '用', off: '停用', ask: '还没定' };

const NP_ASSET_KIND_MAP = {};
NP_ASSET_KINDS.forEach(function (x, i) { x.i = i + 1; NP_ASSET_KIND_MAP[x.k] = x; });

/* ── 素材库那层的 8 个标签（2026-10-24 老板定的；只管库里怎么摆 / 怎么筛 / 怎么打标，
   跟上面 18 类「这类该不该备料」是两回事，别互相替换）──
   旧标签（18 类名或早年手写的）进来一律按 old 归到这 8 个上；认不出的落「其他」，不许自己编新标签。 */
const NP_LIB_TAGS = [
  { n: '人物', old: ['团队/个人照片'] },
  { n: '产品/材料', old: ['产品实拍'] },
  { n: '现场/场景', old: ['场景空镜', '门店/线下场景', '发货/物流'] },
  { n: '干活过程', old: ['生产/制作过程', '工具/界面录屏'] },
  { n: '前后对比', old: ['前后对比'] },
  { n: '客户反馈', old: ['用户UGC', '案例截图', '问答/互动'] },
  { n: '资质/凭据', old: ['资质/背书'] },
  { n: '其他', old: ['标题/封面模板', '图表/流程图', '热点/时效素材', '价格/优惠信息', '风险提示/避坑', '品牌视觉'] },
];
const NP_LIB_TAG_MAP = {};
NP_LIB_TAGS.forEach(function (x) {
  NP_LIB_TAG_MAP[x.n] = x.n;
  x.old.forEach(function (o) { NP_LIB_TAG_MAP[o] = x.n; });
});
/** 一条标签 → 8 个里的哪个；空的仍返回空，认不出的落「其他」 */
function npLibTag8(txt) {
  const s = String(txt || '').trim();
  if (!s) return '';
  if (NP_LIB_TAG_MAP[s]) return NP_LIB_TAG_MAP[s];
  const hit = NP_LIB_TAGS.find(function (x) { return s.indexOf(x.n) >= 0 || x.n.indexOf(s) >= 0; });
  return hit ? hit.n : '其他';
}
/** 一串标签 → 归并去重（顺序照原样） */
function npLibTags8(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (t) {
    const n = npLibTag8(t);
    if (n && out.indexOf(n) < 0) out.push(n);
  });
  return out;
}
function npLibTagPool8() { return NP_LIB_TAGS.map(function (x) { return x.n; }); }

/** 出图流派（lib/visual-motif.js）→ 类 id；那张表读不到时返回空对象，界面照常画，只是「哪个流派要用它」那行空着 */
function npAssetKindMotifs() {
  const out = {};
  let motifs = null;
  try { motifs = (typeof VisualMotif !== 'undefined' && VisualMotif.all) ? VisualMotif.all() : null; } catch (_) { motifs = null; }
  if (!motifs || !motifs.length) return out;
  motifs.forEach(function (m) {
    const ks = (m && m.kind) || [];
    ks.forEach(function (k) {
      if (!NP_ASSET_KIND_MAP[k]) return;
      if (!out[k]) out[k] = [];
      if (out[k].indexOf(m.k) < 0) out[k].push(m.k);
    });
  });
  return out;
}
/** 这一类被出图那侧的哪几派用到（给人看的一句话） */
function npAssetKindMotifText(k) {
  const ms = npAssetKindMotifs()[k];
  return (ms && ms.length) ? ms.join('、') : '（不占料）';
}

function npAssetKindOf(k) { return NP_ASSET_KIND_MAP[String(k || '').trim()] || null; }
function npAssetKindIds() { return NP_ASSET_KINDS.map(function (x) { return x.k; }); }
/** 认 AI 或人给的类名：先按 id，再按中文名，都对不上返回空串（宁缺勿滥，不许自己编类） */
function npAssetKindMatch(txt) {
  const s = String(txt || '').trim();
  if (!s) return '';
  if (NP_ASSET_KIND_MAP[s]) return s;
  const hit = NP_ASSET_KINDS.find(function (x) { return x.n === s || s.indexOf(x.n) >= 0 || x.n.indexOf(s) >= 0; });
  return hit ? hit.k : '';
}
function npAssetKindName(k) { const x = npAssetKindOf(k); return x ? (x.i + '. ' + x.n) : ''; }

/** 这一类该不该有料（人没翻案时按 AI 判的，AI 也没判过的灰档＝不用备）
 *  kinds 那份两种形状都认：{k:'need'}（纯档）或 {k:{v:'need',why:'…'}}（AI 回的那种） */
function npKindVerdict(kinds, k) {
  const x = npAssetKindOf(k);
  if (!x) return '';
  const one = kinds && kinds[k];
  const v = (one && typeof one === 'object') ? one.v : one;
  if (v === 'need' || v === 'no' || v === 'ask') return v;
  return x.gray ? 'gray' : 'ask';
}

/** 这一集这次用不用（纯推：类判定 + 有没有料 + 来源 + 账号阶段），人改过的由调用方按 lock 挡在前面
 *  ctx = { v: 这一类的判定(need|no|ask|gray), why: AI 给这一类的判据一句话, has: 料数, source: 集合来源, stageTxt: 账号阶段 } */
function npAssetVerdict(ctx) {
  const c = ctx || {};
  const v = String(c.v || '');
  if (!v) return { use: 'ask', why: '这一集还没归类——点行上那个类 chip 归一类，AI 才知道它该不该上' };
  if (v === 'no' || v === 'gray') return { use: 'off', why: '这一类你账号用不上（' + (c.why || 'AI 判：不用备') + '），集合先停用，不删' };
  if (v === 'ask') return { use: 'ask', why: '这一类 AI 判不准（' + (c.why || '跨形态') + '）——你勾一下' };
  if (!c.has) return { use: 'ask', why: '这一类该备，但这一集空的——拍得出来就启用，拍不出来先放着（标待补充）' };
  const s = String(c.source || '');
  const from = s.indexOf('sell|') === 0 ? '卖点「' + s.slice(5) + '」要它'
    : s.indexOf('kb|') === 0 ? '知识库「' + s.slice(3) + '」要它'
    : s.indexOf('剪段入库') === 0 ? '已经剪进来了' : '你自己建的集';
  return { use: 'on', why: '这一类该备（' + from + '）＋ 你现在是' + (c.stageTxt || '本阶段') + ' ＋ 已经有 ' + c.has + ' 条料：排进挑料池' };
}

const AssetKinds = {
  NP_ASSET_KINDS,
  NP_KIND_TEXT,
  NP_USE_TEXT,
  of: npAssetKindOf,
  ids: npAssetKindIds,
  match: npAssetKindMatch,
  name: npAssetKindName,
  motifText: npAssetKindMotifText,
  verdict: npKindVerdict,
  useVerdict: npAssetVerdict,
  NP_LIB_TAGS,
  tag8: npLibTag8,
  tags8: npLibTags8,
  tagPool8: npLibTagPool8,
};

if (typeof module !== 'undefined') { module.exports = AssetKinds; }
