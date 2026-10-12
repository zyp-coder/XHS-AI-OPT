// demo KB 录入页 + v-audit 自检（mock DOM，验证 demo 函数逻辑）
// 覆盖：_diagKbParseTagsDemo / _diagKbValidateEditDemo / npAuditTopicsAlgoDemo

const KB_CATEGORIES = ['产品介绍', '玩法与机制', '数据·成本', '客户痛点', '避坑经验', '个人经历', '使用技巧', '笔记架构'];
const KB_DEFAULT = '默认';

// === mock DOM ===
function makeEl(tag) {
  return {
    tag, value: '', classList: { _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); return this._set.has(c); },
      contains(c) { return this._set.has(c); },
    },
  };
}
function makeTip() { return { textContent: '', classList: { _set: new Set(),
  add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
  toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); return this._set.has(c); },
  contains(c) { return this._set.has(c); },
} }; }

const dom = {
  kbEditTitle: makeEl('input'),
  kbEditContent: makeEl('textarea'),
  kbEditCat: makeEl('input'),
  kbEditTags: makeEl('input'),
  kbEditTitleCnt: makeTip(),
  kbEditCatTip: makeTip(),
  kbEditTagsTip: makeTip(),
};
global.document = { getElementById(id) { return dom[id] || null; } };

// === 复刻 demo 函数 ===
function _diagKbParseTagsDemo(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, tags: [] };
  try {
    const v = text.startsWith('[') ? JSON.parse(text) : text.split(/[,，、\n]/).map(t => String(t).trim()).filter(Boolean);
    if (!Array.isArray(v) || v.some(t => typeof t !== 'string')) throw new Error();
    return { ok: true, tags: v };
  } catch (_) { return { ok: false, tags: [] }; }
}
function _diagKbValidateEditDemo() {
  const required = ['kbEditTitle', 'kbEditContent', 'kbEditCat'];
  required.forEach(id => {
    const el = dom[id]; if (!el) return;
    const bad = !String(el.value || '').trim();
    el.classList.toggle('diag-kb-input-bad', bad);
  });
  const tEl = dom.kbEditTitle, cnt = dom.kbEditTitleCnt;
  if (tEl && cnt) {
    const len = String(tEl.value || '').length;
    const near = len >= 64;
    cnt.textContent = len + '/80';
    cnt.classList.toggle('warn', near);
  }
  const cEl = dom.kbEditCat, cTip = dom.kbEditCatTip;
  if (cEl) {
    const empty = !String(cEl.value || '').trim();
    const isDefault = !empty && String(cEl.value || '').trim() === '默认';
    cEl.classList.toggle('diag-kb-input-warn', isDefault);
    if (cTip) {
      if (isDefault) { cTip.textContent = '⚠ 默认=未分类...'; cTip.classList.add('warn'); }
      else { cTip.textContent = ''; cTip.classList.remove('warn'); }
    }
  }
  const tagEl = dom.kbEditTags, tagTip = dom.kbEditTagsTip;
  if (tagEl && tagTip) {
    const raw = String(tagEl.value || '');
    const r = _diagKbParseTagsDemo(raw);
    if (raw.trim() && !r.ok) {
      tagEl.classList.add('diag-kb-input-bad');
      tagTip.textContent = '❌ 标签格式有误...';
      tagTip.classList.add('warn');
    } else {
      tagEl.classList.remove('diag-kb-input-bad');
      tagTip.classList.remove('warn');
      tagTip.textContent = raw.trim() ? ('已解析 ' + r.tags.length + ' 个标签') : '示例：流量焦虑、付费转化、复购';
    }
  }
}

// === v-audit 算法 mock（二十三改：数据对齐 demo 现库——KB_ITEMS 11 条 / rows 引用 / RV_STATS 日均赞） ===
const NOW = Date.now();
const KB_ITEMS = [
  /* 玩法与机制 */
  { id: 'k_mech_1', title: '闭水试验要做多久才合格', cat: '玩法与机制' },
  { id: 'k_mech_2', title: '防水施工前基层要怎么处理', cat: '玩法与机制' },
  { id: 'k_mech_3', title: '为什么卷材搭接要留 10 公分', cat: '玩法与机制' },
  /* 数据·成本 */
  { id: 'k_data_1', title: '质保卡到底保什么', cat: '数据·成本' },
  { id: 'k_data_2', title: '楼上漏水维修费用谁出', cat: '数据·成本' },
  /* 客户痛点 */
  { id: 'k_pain_1', title: '楼上漏水到底该谁出钱', cat: '客户痛点' },
  /* 避坑经验 */
  { id: 'k_pit_1', title: '国标卷材与非标的差异', cat: '避坑经验' },
  { id: 'k_pit_2', title: '工人最容易跳过的 3 道工序', cat: '避坑经验' },
  /* 使用技巧 */
  { id: 'k_skill_1', title: '免费测漏是怎么测的', cat: '使用技巧' },
  { id: 'k_skill_2', title: '验收现场要带的三件工具', cat: '使用技巧' },
  /* 默认类 */
  { id: 'k_legacy_1', title: '社区团购的两种返点模式', cat: KB_DEFAULT },
];
const rows = [
  { id: 1, status: '草稿', title: '闭水试验到底要做多久才合格', w: { kb: ['闭水试验要做多久才合格'] } },
  { id: 2, status: '已发', title: '不是材料买不起，是工艺不对等', w: { kb: ['为什么卷材搭接要留 10 公分', '国标卷材与非标的差异'] } },
  { id: 3, status: '已归档', title: '屋顶漏水三次没修好的真相', w: { kb: ['楼上漏水到底该谁出钱'] } },
  { id: 4, status: '已发', title: '楼上漏水到底该谁出钱，一句话讲清', w: { kb: ['楼上漏水到底该谁出钱'] } },
  { id: 5, status: '已发', title: '质保卡到底保什么，别等出事才翻', w: { kb: ['质保卡到底保什么'] } },
  { id: 6, status: '待发', title: '质保卡上的十年，从哪天开始算', w: { kb: ['质保卡到底保什么'] } },
  { id: 7, status: '草稿', title: '一张质保卡，能挡掉三次扯皮', w: { kb: ['质保卡到底保什么'] } },
  { id: 8, status: '待发', title: '防水前基层处理：这三处不弄干净就白做', w: { kb: ['防水施工前基层要怎么处理'] } },
];
const RV_STATS = [
  { title: '不是材料买不起，是工艺不对等', likes: 1286, pubAt: NOW - 2 * 86400e3 },
  { title: '楼上漏水到底该谁出钱，一句话讲清', likes: 903, pubAt: NOW - 10 * 86400e3 },
  { title: '质保卡到底保什么，别等出事才翻', likes: 158, pubAt: NOW - 19 * 86400e3 },
  { title: '屋顶漏水三次没修好的真相', likes: null, pubAt: 0, dead: true },
];
const rvDays = s => Math.max(1, Math.floor((NOW - s.pubAt) / 86400e3));
const rvDayLike = s => s.likes / rvDays(s);
function _kbItemHits(it) {
  return rows.filter(r => {
    const kb = (r.w && r.w.kb) || [];
    return kb.indexOf(it.title) >= 0 || kb.indexOf(it.id) >= 0;
  });
}
function _kbItemCovered(it) { return _kbItemHits(it).length > 0; }
function npAuditTopicsAlgoDemo() {
  const all = [].concat(KB_CATEGORIES, [KB_DEFAULT]);
  return all.map(cat => {
    const items = KB_ITEMS.filter(x => x.cat === cat);
    const coveredIds = items.filter(_kbItemCovered);
    const blankIds = items.filter(it => !_kbItemCovered(it));
    /* 二十三改：pub/avgDay——被哪篇「已发/已归档」写过（已发优先、先到先得），再求日均赞均值 */
    const pubItems = items.filter(it => _kbItemHits(it).some(r => r.status === '已发' || r.status === '已归档'));
    const dayLikes = [];
    pubItems.forEach(it => {
      const hits = _kbItemHits(it);
      const pubRow = hits.filter(r => r.status === '已发')[0] || hits.filter(r => r.status === '已归档')[0] || null;
      const st = pubRow ? RV_STATS.filter(s => s.title === pubRow.title && !s.dead)[0] : null;
      if (st) dayLikes.push(rvDayLike(st));
    });
    const total = items.length;
    const covered = coveredIds.length;
    const blank = blankIds.length;
    let conclusion;
    if (cat === KB_DEFAULT) conclusion = '🟧 待归类';
    else if (covered === 0) conclusion = '全空白';
    else if (blank === 0) conclusion = '全讲过';
    else conclusion = '有空白 + 有表现';
    return { catTitle: cat, total, covered, blank, conclusion, blankIds: blankIds, coveredIds: coveredIds,
             pub: pubItems.length, avgDay: dayLikes.length ? dayLikes.reduce((a, b) => a + b, 0) / dayLikes.length : null };
  });
}

// === 跑 ===
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- KB 录入页 demo ----
dom.kbEditTitle.value = '标题示例';
dom.kbEditContent.value = '正文示例';
dom.kbEditCat.value = '产品介绍';
dom.kbEditTags.value = '';
_diagKbValidateEditDemo();
pass('demo 三字段都有值：title 不红', !dom.kbEditTitle.classList.contains('diag-kb-input-bad'));
pass('demo 三字段都有值：cat 不黄', !dom.kbEditCat.classList.contains('diag-kb-input-warn'));
pass('demo 标题 4 字：cnt 4/80', dom.kbEditTitleCnt.textContent === '4/80');

// 默认类 → 软警示
dom.kbEditCat.value = '默认';
_diagKbValidateEditDemo();
pass('demo cat=默认：黄边软警示', dom.kbEditCat.classList.contains('diag-kb-input-warn'));
pass('demo cat=默认：catTip 含未分类', dom.kbEditCatTip.textContent.indexOf('未分类') >= 0);

// 字数 64 → warn
dom.kbEditCat.value = '产品介绍';
dom.kbEditTitle.value = 'a'.repeat(64);
_diagKbValidateEditDemo();
pass('demo 标题 64：cnt warn', dom.kbEditTitleCnt.classList.contains('warn'));

dom.kbEditTitle.value = 'a'.repeat(63);
_diagKbValidateEditDemo();
pass('demo 标题 63：cnt 不 warn（阈值 64）', !dom.kbEditTitleCnt.classList.contains('warn'));

// tag 解析
dom.kbEditTags.value = '流量焦虑、付费转化、复购';
_diagKbValidateEditDemo();
pass('demo tag 正常：已解析 3 个', dom.kbEditTagsTip.textContent.indexOf('已解析 3 个') >= 0);
pass('demo tag 正常：tagTip 无 warn', !dom.kbEditTagsTip.classList.contains('warn'));

dom.kbEditTags.value = '[1,2,3]';
_diagKbValidateEditDemo();
pass('demo tag JSON 含数字：tag 红', dom.kbEditTags.classList.contains('diag-kb-input-bad'));
pass('demo tag JSON 含数字：tip 含 ❌', dom.kbEditTagsTip.textContent.indexOf('❌') === 0);

dom.kbEditTags.value = '';
_diagKbValidateEditDemo();
pass('demo tag 空：回到示例', dom.kbEditTagsTip.textContent.indexOf('示例') === 0);

// ---- v-audit 算法（二十三改数据） ----
const algo = npAuditTopicsAlgoDemo();
const findC = name => algo.find(c => c.catTitle === name);

// 玩法与机制：3 条全讲过 + 表现＝搭接篇（1286 赞 ÷ 2 天 ≈ 643）
const mech = findC('玩法与机制');
pass('玩法与机制：3 条', mech.total === 3);
pass('玩法与机制：全讲过', mech.conclusion === '全讲过');
pass('玩法与机制：pub=1（只有搭接挂已发篇）', mech.pub === 1);
pass('玩法与机制：avgDay≈643', Math.abs(mech.avgDay - 643) < 1e-9);

// 数据·成本：1 讲过 / 1 没讲 → 有空白 + 有表现；表现＝质保卡篇（158 ÷ 19 天）
const data = findC('数据·成本');
pass('数据·成本：total 2', data.total === 2);
pass('数据·成本：covered 1', data.covered === 1);
pass('数据·成本：blank 1', data.blank === 1);
pass('数据·成本：有空白 + 有表现', data.conclusion === '有空白 + 有表现');
pass('数据·成本：pub=1', data.pub === 1);
pass('数据·成本：avgDay＝158/19', Math.abs(data.avgDay - 158 / 19) < 1e-9);
pass('数据·成本：avgDay 显示 8.3', data.avgDay.toFixed(1) === '8.3');

// 客户痛点：已归档 + 已发都挂过 → 已发优先，表现＝903 ÷ 10 天
const pain = findC('客户痛点');
pass('客户痛点：全讲过', pain.conclusion === '全讲过');
pass('客户痛点：pub=1', pain.pub === 1);
pass('客户痛点：avgDay≈90.3（已发优先于已归档）', Math.abs(pain.avgDay - 90.3) < 1e-9);

// 避坑经验：国标非标挂已发篇2 → 有空白 + 有表现
const pitfall = findC('避坑经验');
pass('避坑经验：total=2', pitfall.total === 2);
pass('避坑经验：有空白 + 有表现', pitfall.conclusion === '有空白 + 有表现');
pass('避坑经验：pub=1 avgDay≈643', pitfall.pub === 1 && Math.abs(pitfall.avgDay - 643) < 1e-9);
pass('避坑经验：blankIds 剩跳工序', pitfall.blankIds.length === 1 && pitfall.blankIds[0].id === 'k_pit_2');

// 使用技巧：2 条都没讲 → 全空白 + 没表现（pub=0 → avgDay null）
const skill = findC('使用技巧');
pass('使用技巧：total 2', skill.total === 2);
pass('使用技巧：全空白', skill.conclusion === '全空白');
pass('使用技巧：pub=0 avgDay=null', skill.pub === 0 && skill.avgDay === null);

// 默认类：1 条老档 → 🟧 待归类，没表现
const def = findC(KB_DEFAULT);
pass('默认类：🟧 待归类', def.conclusion === '🟧 待归类');
pass('默认类：pub=0 avgDay=null', def.pub === 0 && def.avgDay === null);

// 产品介绍 / 个人经历 / 笔记架构 是空类目（保留旧断言：空类目＝全空白）
const productInt = findC('产品介绍');
pass('产品介绍 空类目=0', productInt.total === 0);
pass('产品介绍 空类目=全空白', productInt.conclusion === '全空白');
pass('产品介绍 空类目 pub=0 avgDay=null', productInt.pub === 0 && productInt.avgDay === null);

const personal = findC('个人经历');
pass('个人经历 空类目=0', personal.total === 0);

const noteStruct = findC('笔记架构');
pass('笔记架构 空类目=0', noteStruct.total === 0);
pass('笔记架构 空类目 pub=0 avgDay=null', noteStruct.pub === 0 && noteStruct.avgDay === null);

// ---- demo 源文件级守卫：二十三改曾因 demo 未定义 escAttr，复盘 kb 页签一渲染就崩（浏览器才暴露） ----
import { readFileSync } from 'fs';
const demoHtml = readFileSync(new URL('../../tmp/三方向demo.html', import.meta.url), 'utf8');
pass('demo 源文件已定义 escAttr（防复盘页渲染崩）', /function escAttr\(/.test(demoHtml));
pass('demo v-audit 家族仍在调用 escAttr（防定义被误删）', demoHtml.indexOf('escAttr(c.catTitle)') >= 0);

console.log('\n📋 demo KB 录入页 + v-audit 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);