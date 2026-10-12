# -*- coding: utf-8 -*-
"""2026-10-01 老板「任务配置」第二条·话术比例：「这个字太多了。其实就是 4 个按钮。再加一个选择建议就好了」

原来那一节是「标题 + 一段解释 + 四颗胶囊 + 当前：X（约占正文 N成）——一长句提示词口径」，
整块砍成：**四颗按钮（选中那颗高亮）+ 一句「💡 建议」**。
说明句子全进问号气泡；长句口径（选完会盖产品段那件事）也进气泡。

规则：建议按当前账号阶段给（冷启动→轻带一句 / 成长→自然安利 / 成熟→主打推荐），
没抓到主页（没有阶段）时给「轻带一句」并说明为什么。不烧 AI、不写第二个真源——
真源仍是 config.noteStyle.sellTalk，写入口仍是 _diagStyleSetTalk（点按钮走 .npStyleTalk 那条绑定）。
"""
import io

PATH = r'D:\AIproject\小红书运营\extension\popup.js'

START = 'function _diagTalkDefaultHtml() {'
END = 'function _diagStyleBind(box) {'

TIP = ('这一档管「这篇里卖占多少」。选好之后，「内容基调」那张表里每一格的产品段都按它重切（铺垫与展开照原比例分剩下的）。'
       '发笔记 ④ 挑稿那一页可以就手改那一条的，不改就跟这里。括号里的成数＝产品大约占正文多少。')

NEW = '''function _diagTalkDefaultHtml() {
  const ns = _diagState.noteStyle || {};
  const now = NotePlan.sellTalkOf(ns.sellTalk || '');
  const ad = _diagTalkAdvice();
  const btn = function (t) {
    const on = t.key === now.key;
    return '<button type="button" class="npStyleTalk ntTalkBtn' + (on ? ' on' : '') + '" data-talk="' + t.key + '"' +
      ' title="' + escAttr(_talkLineText(t)) + '">' + esc(t.name) + (t.share === '0' ? '' : ' · ' + esc(t.share)) + '</button>';
  };
  return '<div style="border:1px solid #e5e8ee;border-radius:10px;padding:12px;background:#fff;margin-top:10px;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-weight:700;font-size:14px;">🎚 话术比例 · 账号默认</span>' +
    '<span class="qhelp" tabindex="0" data-tip="' + escAttr('TIPTEXT') + '">?</span></div>' +
    '<div class="ntTalkRow">' + NotePlan.SELL_TALK.map(btn).join('') + '</div>' +
    '<div class="ntTalkTip">💡 建议：<b>' + esc(ad.talk.name) + '</b>——' + esc(ad.why) +
    (ad.talk.key === now.key ? '<span style="color:#0a7b5a;">（已是这一档）</span>'
      : '<button type="button" class="npStyleTalk ntTalkUse" data-talk="' + ad.talk.key + '">就按建议改</button>') + '</div>' +
    '</div>';
}
/** 这一档该选哪一档：只看当前账号阶段（冷启动 / 成长 / 成熟），不烧 AI */
function _diagTalkAdvice() {
  const stages = NotePlan.STAGES || [];
  let stageKey = (_diagState.notePlan && _diagState.notePlan.stage) || '';
  if (!stageKey) { try { stageKey = NotePlan.detectStage(_diagState.profile) || ''; } catch (_) {} }
  const stage = stages.filter(function (s) { return s.key === stageKey; })[0] || null;
  const byKey = {};
  NotePlan.SELL_TALK.forEach(function (t) { byKey[t.key] = t; });
  if (!stage) return { talk: byKey.light, why: '还没抓到你的主页（不知道粉丝量），先按「轻带一句」走——去「诊断&配置 → 基础配置」抓一次主页再定。' };
  if (stage.key === 'cold') return { talk: byKey.light, why: '冷启动期还没有信任资产，先把人认下：产品出现一句就够，别在正文里推。' };
  if (stage.key === 'grow') return { talk: byKey.mid, why: '成长期有人认你了，可以用两三成篇幅自然带出产品——讲它怎么解决前面说的那个问题。' };
  return { talk: byKey.strong, why: '成熟期信任够了，可以主推：产品当主角，但另一半篇幅仍要留真实的经验与判断。' };
}
'''


def main():
    raw = io.open(PATH, encoding='utf-8', newline='').read()
    assert '\r' not in raw, 'popup.js 必须是 LF'
    assert raw.count(START) == 1 and raw.count(END) == 1
    assert '_diagTalkAdvice' not in raw, '已经打过了'
    a, b = raw.index(START), raw.index(END)
    js = NEW.replace('TIPTEXT', TIP)
    body = raw[:a] + js + raw[b:]
    assert body.count("class=\"npStyleTalk ntTalkBtn") == 1
    assert body.count('_diagTalkAdvice') == 2          # 用一次 + 定义一次
    assert '_styleTalkHtml(ns, {})' not in body        # 任务配置那一节不再共用长文案版
    assert '_styleTalkHtml(cur, def)' in body          # ④ 挑稿那一页照旧
    io.open(PATH, 'w', encoding='utf-8', newline='').write(body)
    print('✅ 话术比例已砍成 4 颗按钮 + 一句建议（④ 挑稿页那套旋钮未动）')


if __name__ == '__main__':
    main()
