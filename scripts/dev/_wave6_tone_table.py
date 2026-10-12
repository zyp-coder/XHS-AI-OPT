# -*- coding: utf-8 -*-
"""2026-10-01 老板「任务配置」两条形状改动·第一步：

「📄 五条线与写法」这一节改成 **① 叫「内容基调」（横 tab 标签已在 popup.js 里改）② 内容做成表格列表**。
原来是「线一行 + 底下缩进一堆 div」，读起来像说明文不像表。这里整块换成一张真表格：
表头 线·写法 / 📐 铺垫·展开·产品 / 🖋 字数 / 来源 / 操作；线一行、它底下的写法各一行（缩进），
点「改」才在这一行底下撑开旋钮（维护界面先查看、编辑按需展开的既有口径）。

只重写 popup.js 里那三个函数（_diagLinesHtml / _diagLineRowHtml / _diagKindRowHtml），
编辑本体 `_diagShapeEditorHtml`、绑定 `_diagStyleBind`、类名 diagLineEdit / diagShapeStep 一字不动。
跑一次即生效（重复跑会因为找不到旧版函数体而拒绝）。
"""
import io
import re

PATH = r'D:\AIproject\小红书运营\extension\popup.js'

START = 'function _diagLinesHtml() {'
END = '/** 一格的内联编辑器：📐 三段 −/＋（步进 5，永远凑 100）+ 🖋 字数档 + 实时配比条 */'

TIP = ('一行＝一条线，底下缩进那几行是这条线能用的写法。'
       '📐 ＝铺垫 / 展开 / 产品 各占多少（产品段还会被「🎚 话术比例」那一节盖一次）；🖋 ＝这一篇写多长。'
       '整张表＝账号默认，发笔记写哪一条都先按它走；点「改」才在这一行底下撑开旋钮。')

NEW = '''function _diagLinesHtml() {
  const st = _diagStyleEdit();
  const types = NotePlan.TYPES || [];
  const cnt = {};
  ((_diagState.notePlan && Array.isArray(_diagState.notePlan.mix)) ? _diagState.notePlan.mix : []).forEach(function (r) {
    if (r && r.type) cnt[r.type] = Number(r.count) || 0;
  });
  const hasPlan = Object.keys(cnt).length > 0;
  let h = '<div style="border:1px solid #e5e8ee;border-radius:10px;padding:12px;background:#fff;margin-top:10px;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><div style="font-weight:700;font-size:14px;">📄 内容基调 · 五条线 × 写法</div>' +
    '<span class="qhelp" tabindex="0" data-tip="' + escAttr('TIPTEXT') + '">?</span>' +
    '<button type="button" id="diagLinesToggle" class="btn btn-outline" style="margin:0 0 0 auto;font-size:11px;">' + (st.linesOpen ? '收起' : '展开看') + '</button></div>';
  if (st.err) h += '<div style="font-size:11px;color:#c62828;margin-top:4px;">' + _dEsc(st.err) + '</div>';
  if (!st.linesOpen) return h + '</div>';
  h += '<table class="ntToneTbl"><thead><tr><th>线 · 写法<span style="font-weight:400;color:#8a929e;">（这一张表＝账号默认，发笔记按它写）</span></th><th>📐 铺垫 / 展开 / 产品</th><th>🖋 字数</th><th>来源</th><th></th></tr></thead><tbody>' +
    types.map(function (t) { return _diagLineRowHtml(t, cnt, hasPlan, st); }).join('') +
    '</tbody></table></div>';
  return h;
}
/** 某一格现在的配比与字数（＋来源：出厂 / 账号改过）；线级与写法级共用 */
function _diagToneCells(target) {
  const cur = _diagTargetCur(target);
  if (!cur) return null;
  const sh = NotePlan.shapeOf(cur.base, _diagTalkNow());
  const wd = NotePlan.wordsOf(cur.words) || NotePlan.wordsOf(NotePlan.WORDS_DEFAULT);
  return { sh: sh, range: wd ? wd.range : '—', from: cur.from };
}
function _diagLineRowHtml(t, cnt, hasPlan, st) {
  const target = 't:' + t.key;
  const c = _diagToneCells(target);
  if (!c) return '';
  const n = hasPlan ? (cnt[t.key] || 0) : null;
  const badge = (n == null) ? ''
    : (n > 0 ? '<span class="ntNum">本阶段 ' + n + ' 篇</span>' : '<span class="ntNum ntNumOff">本阶段没排</span>');
  const editing = st.editing === target;
  let h = '<tr class="ntLine"><td><b>' + _dEsc(t.name) + '</b> ' + badge +
    '<div class="ntWhat">' + _dEsc(t.what || '') + '</div></td>' +
    '<td class="ntShape">' + (c.sh ? c.sh.build + ' / ' + c.sh.core + ' / ' + c.sh.sell : '—') + '</td>' +
    '<td>' + _dEsc(c.range) + '</td>' +
    '<td class="' + (c.from === '账号改过' ? 'ntFromEdit' : 'ntFrom') + '">' + _dEsc(c.from) + '</td>' +
    '<td class="ntAct"><button type="button" class="btn btn-outline diagLineEdit" data-target="' + target + '">' + (editing ? '收起' : '✏️ 改这条线') + '</button></td></tr>';
  if (editing) h += '<tr class="ntEditor"><td colspan="5">' + _diagShapeEditorHtml(target) + '</td></tr>';
  (NotePlan.kindsOfType(t.key) || []).forEach(function (k) { h += _diagKindRowHtml(k, st); });
  return h;
}
function _diagKindRowHtml(k, st) {
  const target = 'k:' + k.key;
  const c = _diagToneCells(target);
  if (!c) return '';
  const editing = st.editing === target;
  let h = '<tr class="ntKind"><td><span class="ntDot">·</span>' + _dEsc(k.name) +
    '<div class="ntWhat">' + _dEsc(k.form || '') + '</div></td>' +
    '<td class="ntShape">' + (c.sh ? c.sh.build + ' / ' + c.sh.core + ' / ' + c.sh.sell : '—') + '</td>' +
    '<td>' + _dEsc(c.range) + '</td>' +
    '<td class="' + (c.from === '账号改过' ? 'ntFromEdit' : 'ntFrom') + '">' + _dEsc(c.from) + '</td>' +
    '<td class="ntAct"><button type="button" class="btn btn-outline diagLineEdit" data-target="' + target + '">' + (editing ? '收起' : '改') + '</button></td></tr>';
  if (editing) h += '<tr class="ntEditor"><td colspan="5">' + _diagShapeEditorHtml(target) + '</td></tr>';
  return h;
}
'''


def main():
    raw = io.open(PATH, encoding='utf-8', newline='').read()
    assert '\r' not in raw, 'popup.js 必须是 LF'
    assert raw.count(START) == 1, '没找到旧版 _diagLinesHtml（已经打过了？）'
    assert raw.count(END) == 1
    a, b = raw.index(START), raw.index(END)
    decls = re.findall(r'(?m)^function (\w+)', raw[a:b])
    assert decls == ['_diagLinesHtml', '_diagLineRowHtml', '_diagKindRowHtml'], decls

    js = NEW.replace('TIPTEXT', TIP.replace("'", ''))
    body = raw[:a] + js + raw[b:]
    assert '_diagToneCells' in body and body.count('function _diagLinesHtml') == 1
    assert 'ntToneTbl' in body and body.count('_diagToneCells(target)') == 3 and body.count('class="ntLine"') == 1
    io.open(PATH, 'w', encoding='utf-8', newline='').write(body)
    print('✅ 内容基调已换成表格列表（三函数重写；编辑器 _diagShapeEditorHtml 与绑定不动）')


if __name__ == '__main__':
    main()
