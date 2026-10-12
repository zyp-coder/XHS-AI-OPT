// _kb 输入实时校验自检（不依赖扩展运行时，模拟三个 DOM + 校验函数）
// 覆盖：标题 / 正文 / 分类（必填红框 + 默认软警示 + 标题字数）
//      + tag 格式校验（错 → 红；空 → 示例；正常 → 已解析 N 个）

const BAD = 'diag-kb-input-bad';
const WARN = 'diag-kb-input-warn';

// === mock DOM ===
function makeEl(tag) {
  return {
    tag, value: '', classList: { _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); return this._set.has(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener() {},
    _diagKbValidateBound: false,
  };
}
function makeTip() {
  return { textContent: '', classList: { _set: new Set(),
    add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
    toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); return this._set.has(c); },
    contains(c) { return this._set.has(c); },
  } };
}
const dom = {
  diagKEditTitleIn: makeEl('input'),
  diagKEditContent: makeEl('textarea'),
  diagKEditCat: makeEl('input'),
  diagKEditTags: makeEl('input'),
  diagKEditTitleCnt: makeTip(),
  diagKEditCatTip: makeTip(),
  diagKEditTagsTip: makeTip(),
};
global.document = { getElementById(id) { return dom[id] || null; } };

// === 复刻校验函数（与 popup.js 等价） ===
function _diagKbParseTags(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, tags: [] };
  try {
    const v = text.startsWith('[') ? JSON.parse(text) : text.split(/[,，、\n]/).map(t => String(t).trim()).filter(Boolean);
    if (!Array.isArray(v) || v.some(t => typeof t !== 'string')) throw new Error();
    return { ok: true, tags: v };
  } catch (_) { return { ok: false, tags: [] }; }
}
function _diagKbValidateEdit() {
  const required = ['diagKEditTitleIn', 'diagKEditContent', 'diagKEditCat'];
  required.forEach(id => {
    const el = dom[id]; if (!el) return;
    const bad = !String(el.value || '').trim();
    el.classList.toggle(BAD, bad);
  });
  const tEl = dom.diagKEditTitleIn, cnt = dom.diagKEditTitleCnt;
  if (tEl && cnt) {
    const len = String(tEl.value || '').length;
    const near = len >= 64;
    cnt.textContent = len + '/80';
    cnt.classList.toggle('warn', near);
  }
  const cEl = dom.diagKEditCat, cTip = dom.diagKEditCatTip;
  if (cEl) {
    const empty = !String(cEl.value || '').trim();
    const isDefault = !empty && String(cEl.value || '').trim() === '默认';
    cEl.classList.toggle(WARN, isDefault);
    if (cTip) {
      if (isDefault) { cTip.textContent = '⚠ 「默认」= 未分类…'; cTip.classList.add('warn'); }
      else { cTip.textContent = ''; cTip.classList.remove('warn'); }
    }
  }
  const tagEl = dom.diagKEditTags, tagTip = dom.diagKEditTagsTip;
  if (tagEl && tagTip) {
    const raw = String(tagEl.value || '');
    const r = _diagKbParseTags(raw);
    if (raw.trim() && !r.ok) {
      tagEl.classList.add(BAD);
      tagTip.textContent = '❌ 标签格式有误…';
      tagTip.classList.add('warn');
    } else {
      tagEl.classList.remove(BAD);
      tagTip.classList.remove('warn');
      tagTip.textContent = raw.trim() ? ('已解析 ' + r.tags.length + ' 个标签') : '示例：流量焦虑、付费转化、复购';
    }
  }
}

// === 跑 ===
let total = 0, fail = 0;
const pass = (n, c, det) => { total++; if (!c) fail++; console.log((c ? '✅' : '❌') + ' ' + n + (det ? ' — ' + det : '')); };

// ---- 1) 正常三必填 + 不默认 cat → 不红不黄 + 字数小 ----
dom.diagKEditTitleIn.value = '标题';
dom.diagKEditContent.value = '正文';
dom.diagKEditCat.value = '产品介绍';
dom.diagKEditTags.value = '';
_diagKbValidateEdit();
pass('正常态：title 不红', !dom.diagKEditTitleIn.classList.contains(BAD));
pass('正常态：content 不红', !dom.diagKEditContent.classList.contains(BAD));
pass('正常态：cat 不红', !dom.diagKEditCat.classList.contains(BAD));
pass('正常态：cat 不黄', !dom.diagKEditCat.classList.contains(WARN));
pass('正常态：catTip 空', dom.diagKEditCatTip.textContent === '');
pass('正常态：tag 不红', !dom.diagKEditTags.classList.contains(BAD));
pass('正常态：tag tip 示例', dom.diagKEditTagsTip.textContent.indexOf('示例') === 0);

// ---- 2) 标题字数提示：0、63、64、80 ----
dom.diagKEditTitleIn.value = '';
_diagKbValidateEdit();
pass('标题空：cnt 显示 0/80', dom.diagKEditTitleCnt.textContent === '0/80');
pass('标题空：cnt 不 warn', !dom.diagKEditTitleCnt.classList.contains('warn'));

dom.diagKEditTitleIn.value = 'a'.repeat(63);
_diagKbValidateEdit();
pass('标题 63：cnt 显示 63/80', dom.diagKEditTitleCnt.textContent === '63/80');
pass('标题 63：cnt 不 warn（阈值 64）', !dom.diagKEditTitleCnt.classList.contains('warn'));

dom.diagKEditTitleIn.value = 'a'.repeat(64);
_diagKbValidateEdit();
pass('标题 64：cnt 显示 64/80', dom.diagKEditTitleCnt.textContent === '64/80');
pass('标题 64：cnt warn（>=64）', dom.diagKEditTitleCnt.classList.contains('warn'));

dom.diagKEditTitleIn.value = 'a'.repeat(80);
_diagKbValidateEdit();
pass('标题 80：cnt 显示 80/80', dom.diagKEditTitleCnt.textContent === '80/80');
pass('标题 80：cnt warn', dom.diagKEditTitleCnt.classList.contains('warn'));

// ---- 3) cat =「默认」：软警示（黄边 + tip 含「未分类」）----
dom.diagKEditTitleIn.value = '标题';
dom.diagKEditContent.value = '正文';
dom.diagKEditCat.value = '默认';
_diagKbValidateEdit();
pass('cat=默认：cat 不红（不是 bad，是 warn）', !dom.diagKEditCat.classList.contains(BAD));
pass('cat=默认：cat 黄（warn）', dom.diagKEditCat.classList.contains(WARN));
pass('cat=默认：catTip 含「未分类」', dom.diagKEditCatTip.textContent.indexOf('未分类') >= 0);
pass('cat=默认：catTip warn 态', dom.diagKEditCatTip.classList.contains('warn'));

// 切回 8 类之一 → 软警示消失
dom.diagKEditCat.value = '玩法与机制';
_diagKbValidateEdit();
pass('cat 换 8 类：cat 不黄', !dom.diagKEditCat.classList.contains(WARN));
pass('cat 换 8 类：catTip 空', dom.diagKEditCatTip.textContent === '');

// cat 空 → 红（不是黄）
dom.diagKEditCat.value = '';
_diagKbValidateEdit();
pass('cat 空：红（不是黄）', dom.diagKEditCat.classList.contains(BAD) && !dom.diagKEditCat.classList.contains(WARN));
pass('cat 空：catTip 空（提示是空分类时不该给软警示）', dom.diagKEditCatTip.textContent === '');

// ---- 4) tag 校验 ----
// 空 → 显示示例
dom.diagKEditTags.value = '';
_diagKbValidateEdit();
pass('tag 空：tip 显示示例', dom.diagKEditTagsTip.textContent.indexOf('示例') === 0);
pass('tag 空：tag 不红', !dom.diagKEditTags.classList.contains(BAD));

// 正常逗号分隔 → 已解析 N 个
dom.diagKEditTags.value = '流量焦虑、付费转化、复购';
_diagKbValidateEdit();
pass('tag 正常：tip 显示已解析 3 个', dom.diagKEditTagsTip.textContent.indexOf('已解析 3 个') >= 0);
pass('tag 正常：tag 不红', !dom.diagKEditTags.classList.contains(BAD));

// JSON 数组
dom.diagKEditTags.value = '["a","b"]';
_diagKbValidateEdit();
pass('tag JSON 数组：tip 已解析 2 个', dom.diagKEditTagsTip.textContent.indexOf('已解析 2 个') >= 0);

// JSON 数字（非 string）→ 错
dom.diagKEditTags.value = '[1,2,3]';
_diagKbValidateEdit();
pass('tag JSON 含数字：tag 红', dom.diagKEditTags.classList.contains(BAD));
pass('tag JSON 含数字：tip 报错', dom.diagKEditTagsTip.textContent.indexOf('❌') === 0);

// 顿号 / 换行（合法）
dom.diagKEditTags.value = '流量焦虑、付费转化\n复购。';
_diagKbValidateEdit();
pass('tag 混合分隔符：tip 已解析 3 个', dom.diagKEditTagsTip.textContent.indexOf('已解析 3 个') >= 0);

// 半坏 JSON
dom.diagKEditTags.value = '[a,b';
_diagKbValidateEdit();
pass('tag 半坏 JSON：tag 红', dom.diagKEditTags.classList.contains(BAD));

// 修正后红框消失
dom.diagKEditTags.value = '干净';
_diagKbValidateEdit();
pass('tag 修正：红框消失', !dom.diagKEditTags.classList.contains(BAD));
pass('tag 修正：tip 改回已解析 1 个', dom.diagKEditTagsTip.textContent.indexOf('已解析 1 个') >= 0);

console.log('\n📋 KB 录入页 UX 自检完成: ' + (total - fail) + '/' + total + ' 通过');
if (fail > 0) process.exit(1);