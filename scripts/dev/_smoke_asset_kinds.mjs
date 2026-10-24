// 素材 18 类自检：标签池 + 用/停用推导 + 出图流派引用 + 真实文件接线
// 不依赖扩展运行时；跑法：node scripts/dev/_smoke_asset_kinds.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, 'extension');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '　← ' + extra : '')); }
};

globalThis.VisualMotif = require(path.join(EXT, 'lib', 'visual-motif.js'));
const AK = require(path.join(EXT, 'lib', 'asset-kinds.js'));
const K = AK.NP_ASSET_KINDS, KM = {};
K.forEach(x => { KM[x.k] = x; });

console.log('〔1〕18 类池本身');
ok('类数＝18', K.length === 18, K.length);
ok('序号 1..18 连续', K.every((x, i) => x.i === i + 1));
ok('没有重名 id', new Set(K.map(x => x.k)).size === 18);
ok('每类四格齐（名/判据/要什么料）', K.every(x => x.k && x.n && x.why && x.need));
const gray = K.filter(x => x.gray).map(x => x.k).sort();
ok('灰档正好三类：tpl / hot / brand', JSON.stringify(gray) === JSON.stringify(['brand', 'hot', 'tpl']), gray.join(','));
ok('灰档那句都写着「不用备」', K.filter(x => x.gray).every(x => x.need.indexOf('不用备') === 0));
ok('文本限长不超标（名≤16／要料≤220）', K.every(x => x.n.length <= 16 && x.need.length <= 220));

console.log('〔2〕认类（宁缺勿滥，AI 编的类名一律不认）');
ok('按 id 认', AK.of('team') === KM.team);
ok('按中文名认', AK.of('产品实拍') === null && AK.match('产品实拍') === 'prod');
ok('半截名也算命中', AK.match('前后对比的图') === 'before');
ok('编出来的类名 → 空串', AK.match('赛博朋克实拍') === '');
ok('空值 → 空串', AK.match('') === '' && AK.match(null) === '');
ok('id 清单 18 个', AK.ids().length === 18);
ok('给人看的那句带序号', AK.name('risk') === '16. 风险提示/避坑', AK.name('risk'));

console.log('〔3〕类这一层：该不该有料');
ok('AI 没判过的普通类 → 待你定', AK.verdict({}, 'team') === 'ask');
ok('AI 没判过的灰档类 → 灰档', AK.verdict({}, 'hot') === 'gray');
ok('AI 判 need 就 need', AK.verdict({ team: { v: 'need' } }, 'team') === 'need');
ok('AI 只给一句话没给档 → 回落默认', AK.verdict({ team: { why: '有真人照' } }, 'team') === 'ask');
ok('不存在的类 → 空串', AK.verdict({}, 'nope') === '');

console.log('〔4〕集合这一层：这一集这次用不用（纯推，不看人改没改）');
const V = AK.useVerdict;
ok('还没归类 → 还没定 + 指着那个 chip', V({}).use === 'ask' && V({}).why.indexOf('还没归类') >= 0);
ok('不用备 → 停用不删', V({ v: 'no' }).use === 'off' && V({ v: 'no' }).why.indexOf('不删') >= 0);
ok('灰档 → 停用', V({ v: 'gray' }).use === 'off');
ok('待你定 → 还没定', V({ v: 'ask' }).use === 'ask');
ok('该备但这一集空的 → 还没定 + 标待补充', V({ v: 'need', has: 0 }).use === 'ask' && V({ v: 'need', has: 0 }).why.indexOf('待补充') >= 0);
const s1 = V({ v: 'need', has: 3, source: 'sell|省时间', stageTxt: '起号' });
ok('该备＋有料＋卖点来的 → 用，理由带卖点', s1.use === 'on' && s1.why.indexOf('卖点「省时间」') >= 0 && s1.why.indexOf('起号') >= 0, s1.why);
const s2 = V({ v: 'need', has: 1, source: 'kb|施工避坑' });
ok('知识库来的 → 理由带那条知识', s2.use === 'on' && s2.why.indexOf('知识库「施工避坑」') >= 0, s2.why);
ok('剪段入库的 → 理由说已经剪进来', V({ v: 'need', has: 2, source: '剪段入库|n1' }).why.indexOf('已经剪进来了') >= 0);
ok('自己建的 → 理由说你自己建的集', V({ v: 'need', has: 2, source: '自己加的' }).why.indexOf('你自己建的集') >= 0);

console.log('〔5〕出图那侧的引用（真源在 visual-motif.js，这边只反推）');
const motifs = AK.NP_ASSET_KINDS.length ? globalThis.VisualMotif.all() : [];
const badRef = [];
motifs.forEach(m => (m.kind || []).forEach(k => { if (!KM[k]) badRef.push(m.k + '→' + k); }));
ok('流派挂的类 id 全在池里', badRef.length === 0, badRef.join(','));
ok('流派那条 kind 字段有内容（不是全空）', motifs.some(m => (m.kind || []).length > 0));
ok('团队照片被真人那派用到', AK.motifText('team').indexOf('真人工作场景') >= 0, AK.motifText('team'));
ok('没派用到的类说「不占料」', AK.motifText('nope') === '（不占料）');
const covered = {};
motifs.forEach(m => (m.kind || []).forEach(k => { covered[k] = 1; }));
ok('灰档那三类里只有品牌视觉不占料（版式与时次那两样出图那侧要用到位子）',
  !covered.brand && !!covered.tpl && !!covered.hot, JSON.stringify(Object.keys(covered)));
ok('品牌视觉那句写「不占料」', AK.motifText('brand') === '（不占料）', AK.motifText('brand'));
ok('18 类里被引用的不少于 12 类', Object.keys(covered).length >= 12, Object.keys(covered).length);

console.log('〔6〕真实文件接线（ popup / 后台 / 页面 三头都对上）');
const popup = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');
const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const html = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
ok('后台 importScripts 带了这份表', bg.indexOf("'lib/asset-kinds.js'") >= 0);
ok('popup.html 引了这份表', html.indexOf('lib/asset-kinds.js') >= 0);
ok('后台注册了那一发（走发笔记闸门）', /configAssetKinds:\s*\(data\)\s*=>\s*requireNotePublish\(/.test(bg));
ok('后台那一发吃账号诊断（没答就问不了）', bg.indexOf('还没答账号诊断问卷') >= 0);
ok('界面按诊断答完顺手配一轮', /if \(r\.complete\)[\s\S]{0,200}npAsConfigKinds\(null/.test(popup));
ok('集合表字段清单写了 kind/use/why/mine', /kind\s+＝\s*18 类里的一个 id/.test(popup) && /外账 np_asset_kinds|np_asset_kinds/.test(popup));
ok('缺口只算明确在用的集合（停用与还没定都不报）', /if \(npAsUseOf\(col\) !== 'on'\) return;/.test(popup));
ok('同一版诊断只配一次（没配上也不反复烧，重来走那颗按钮）', /st\.tried !== fp/.test(popup) && /st\.tried = fp;/.test(popup) && !/!Object\.keys\(st\.kinds\)\.length/.test(popup));
ok('两签的签名都在界面上', popup.indexOf('🗂 集合配置') >= 0 && popup.indexOf('🎞 素材内容') >= 0);
ok('新建集合不给类不让存', popup.indexOf('给这一集挑个类') >= 0);
ok('人改过的集合打标（AI 重算挡在前面）', /col\.mine = 1;/.test(popup) && /if \(c\.mine\) \{ kept\+\+/.test(popup));
const wired = [];
['.nt-tab', '.npas-tabback', '.npas-cfg', '.npas-chk', '.npas-kv2', '.npas-kv', '.npas-sw', '.npas-usetoggle', '.npas-kd', '.npas-ed',
  '.npas-mk', '.npas-mu', '.npas-ed-save', '.npas-ed-cancel', '.npas-go', '.npas-pk', '.npas-miss-open', '.npas-miss-no', '.npas-nk', '.npas-nu',
  '.npas-gen', '.npas-new-open', '.npas-new-cancel', '.npas-new-save', '.npas-new-pick', '.npas-new-unpick', '.npas-up', '.npas-assoc',
  '.npas-col-del', '.npas-item-del', '.npas-jump', '.npas-imgonly', '.npas-toggle', '.npas-seek']
  .forEach(sel => { if (popup.indexOf("cl('" + sel + "')") < 0) wired.push(sel); });
ok('界面画出来的按钮都有人接（点下去不空响）', wired.length === 0, wired.join(','));
ok('旧的内页返回按钮已撤（换成签）', popup.indexOf('npas-back') < 0);
ok('签 A 的样式挂在素材库容器里（不污染别页）', /#noteAssetsContent \.nt-tab\{/.test(popup));

console.log('\n' + (fail ? 'FAIL ' + fail + ' / ' : 'ALL PASS ') + pass + ' 项');
process.exit(fail ? 1 : 0);
