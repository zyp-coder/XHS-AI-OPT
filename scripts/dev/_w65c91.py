# -*- coding: utf-8 -*-
import io, os
p = 'extension/popup.js'
src = io.open(p, encoding='utf-8', newline='').read()
assert '\r\n' not in src
lines = src.split('\n')

def cut(a, b, expect):            # 1-based inclusive
    assert expect in lines[a-1], 'ANCHOR MISS %d: %r' % (a, lines[a-1][:60])
    del lines[a-1:b]

NEW_HEAD = """/* ── 👀 ① 那一档底下的「所见即所得」小样（六十三改：老板「风格那里的选择项，最后能有演示，所见即所得」）────
   纯 CSS 画一张 3:4 的假画面，不生成图、不进提示词、一次 AI 都不烧：它只把上面那排旋钮此刻的读数摆成一张图。
   跟得动的有三处——主题轴换那张底图的倾向，配文档决定屏上有几种字（说一次＝大字＋短色条＋两行承接；
   辅助标注＝大字＋两条引线标注；整段上屏＝整段分行；只一句大字＝就一句），博主印记轴决定角上那颗小标；
   出图张数决定底下那一排几个格子。字占多大地方、压在哪一格不在风格这儿拨：这一层直接读 ④ 那一屏的配文与
   字位九宫格，跟 ⑤ 合成视图、⬇ 导出是同一份几何（npInkLayerHtml ＋ NP_ZONE_SCRIM），不另排第二套版式。
   配色口径跟提示词尾巴 NP_FILM_PALETTE 一致：字只用白，强调色只用那一种暖橙黄，而且只出现在短色条／小方点上。 */""".split('\n')

NEW_CARD = """/** 这一档还没写配文时的占位那一叠字：只让人看清「这一档屏上有几种字、字压在哪一格」，不编内容
 *  （真字在 ④ 那一屏的配文栏里写，写了这张小样当场换成真的）。 */
function npDemoPlanStub(mode) {
  const zone = VisualMotif.zoneDefault(mode);
  if (mode === 'whole') return { mode: mode, zone: zone, labels: [], note: '', rows: [
    { t: 'body', s: '整段原文上屏：这一屏那几句', em: [] },
    { t: 'body', s: '由本地按句号分行、一条色条压着', em: [] }] };
  if (mode === 'only') return { mode: mode, zone: zone, labels: [], note: '', rows: [
    { t: 'big', s: '这一屏就压那一句大字', em: [] }] };
  if (mode === 'label') return { mode: mode, zone: zone, note: '', rows: [
    { t: 'big', s: '这一屏那句大字', em: [] }], labels: [
    { at: '这里', s: '一条短标注', em: [] }, { at: '那里', s: '另一条', em: [] }] };
  return { mode: mode, zone: zone, labels: [], note: '', rows: [
    { t: 'big', s: '这一屏那句大字', em: [] },
    { t: 'line', s: '把那句说圆的第一行承接', em: [] },
    { t: 'line', s: '第二行承接', em: [] }] };
}
/** 一张 3:4 的小样画面（① 底下那张大的读它）：底图＋字位那一格的暗角＋压上去的字——
 *  这三层跟 ⑤ 合成视图、⬇ 导出同一真源（npInkLayerHtml ＋ NP_ZONE_SCRIM[zone]），这儿不另排一套版式几何。
 *  o.plan＝这一张此刻要压的那一叠字（npCapPlan／npCoverPlan）；没得读就按这一档给占位（npDemoPlanStub）。 */
function npDemoCardHtml(eff, opt) {
  const o = opt || {};
  const W = o.W || 150, H = o.H || 200;
  const px = (v) => Math.max(2, Math.round(v * W / 150));
  const th = NP_DEMO_THEME[String((eff && eff.theme) || '')] || NP_DEMO_THEME['暗调实拍·单一暖光源'];
  const plan = o.plan || npDemoPlanStub(npCapOf(eff));
  const mark = String((eff && eff.mark) || '').trim();
  const corner = !mark ? '' : (mark === '左上角小图标'
    ? '<div style="position:absolute;left:5px;top:5px;width:' + px(10) + 'px;height:' + px(10) + 'px;border-radius:3px;border:1.5px solid rgba(255,255,255,.85);"></div>'
    : mark === '统一左下署名' ? '<div style="position:absolute;left:6px;bottom:4px;color:rgba(255,255,255,.7);font-size:' + px(6) + 'px;">署名位</div>'
      : mark === '常驻卡通形象' ? '<div style="position:absolute;right:5px;bottom:5px;width:' + px(13) + 'px;height:' + px(13) + 'px;border-radius:50%;border:1.5px solid rgba(255,255,255,.8);"></div>'
        : '<div style="position:absolute;left:5px;top:5px;width:' + px(11) + 'px;height:' + px(11) + 'px;border-radius:50%;background:' + NP_DEMO_ACCENT + ';color:#1d1a17;font-size:' + px(7) + 'px;font-weight:800;text-align:center;line-height:' + px(11) + 'px;">1</div>');
  return '<div style="position:relative;width:' + W + 'px;height:' + H + 'px;border-radius:' + px(8) + 'px;overflow:hidden;background:#14100e;border:1px solid ' + (mark ? 'var(--line)' : 'var(--line)') + ';flex:none;">' +
    '<div style="position:absolute;inset:0;background:' + th.pic + ';"></div>' +
    '<div style="position:absolute;inset:0;background:' + (NP_ZONE_SCRIM[plan.zone] || NP_ZONE_SCRIM.bc) + ';"></div>' +
    npInkLayerHtml(plan, W) + corner + '</div>';
}""".split('\n')

# —— 自下而上删（行号取当前文件的）——
cut(16902, 16902, "npCapExplainHtml('这儿定的是全账号的默认档")
cut(7072, 7088, "/** 版式那一排底下的画廊")
cut(6847, 6899, "/** 一张 3:4 的小样画面")
lines[6846:6846] = NEW_CARD
cut(6786, 6846, "/** 小样卡上摆的骨架字")   # bars+list+cols（插入后行号已顺次下移）
cut(6741, 6777, "/** 小样上摆的那几句字")
cut(6728, 6740, "/* 版式那一轴的 8 套真排")
cut(6712, 6717, "/* ── 👀 ① 那一档底下的")
lines[6711:6711] = NEW_HEAD
cut(4366, 4366, "  layout: ")
cut(4352, 4352, "  { k: 'layout', t: '版式'")

src = '\n'.join(lines)

REPS = [
 ("人在这四类客观轴上定", "人在这三类客观轴上定", 1),
 ("画面出身 · 主题 · 版式 · 博主印记", "画面出身 · 主题 · 博主印记", 1),
 ("（画面流派 ＋ 四类轴 ＋ 配文方式四档 ＋ 出图张数）", "（画面流派 ＋ 三类轴 ＋ 配文方式四档 ＋ 出图张数）", 1),
 ("/ 四类轴 chips /", "/ 三类轴 chips /", 1),
 ("尾巴只出「怎么画」那四类轴（npLookToken）", "尾巴只出「怎么画」那三类轴（npLookToken）", 1),
 ("/** 只留四类轴 + 配文方式默认档 + 画面流派", "/** 只留三类轴 + 配文方式默认档 + 画面流派", 1),
 ("/** 尾巴那一行令牌＝只出「怎么画」四类轴", "/** 尾巴那一行令牌＝只出「怎么画」三类轴", 1),
 ("// 四轴交回默认", "// 三轴交回默认", 1),
 ("这一块留给字 + 四轴 + 底图与留白", "这一块留给字 + 三轴 + 底图与留白", 1),
 ("/** ① 这一套图的风格：画面流派 + 四类轴 + 出图张数 + 配文方式默认档（真源看面板，尾巴那一行令牌只出四轴） */",
  "/** ① 这一套图的风格：画面流派 + 三类轴 + 出图张数 + 配文方式默认档（真源看面板，尾巴那一行令牌只出三轴） */", 1),
 ("中间四类轴管", "中间三类轴管", 1),
 ("改四轴或配文方式", "改三轴或配文方式", 1),
 ("那两颗「每一派大概长这样」「这 8 套版式都长这样」点开，是把每一档各画一张给你比着挑：流派那排画的是画面怎么摆、字位留哪儿（具体摆什么东西还得 ④ 的分镜写），版式那排画的是字占多大地方、摆在哪一边。",
  "那颗「每一派大概长这样」点开，是把每一派各画一张给你比着挑：画的是画面怎么摆、字位留哪儿（具体摆什么东西还得 ④ 的分镜写）。小样上那几行字的大小与落点跟着 ④ 的字位九宫格走，这儿不另给一颗版式旋钮。", 1),
 ("跟下面四类轴各走一条通道", "跟下面三类轴各走一条通道", 1),
 ("尾巴只带「怎么画」那四轴", "尾巴只带「怎么画」那三轴", 1),
 ("画面流派管「画面上摆什么」，四类轴管「长什么样、看着像谁家的」，配文方式管",
  "画面流派管「画面上摆什么」，三类轴管「长什么样、看着像谁家的」，配文方式管", 1),
 ("暗调单一暖光源 · 字压暗角一侧，配文默认走「说一次」", "暗调单一暖光源，配文默认走「说一次」", 1),
 ("四轴都退回统一小红书档", "三轴都退回统一小红书档", 1),
 ("// 🎨 出图默认：四类轴 + 配文方式默认档", "// 🎨 出图默认：三类轴 + 配文方式默认档", 1),
 ("（跟四类轴一样按「💾 保存出图默认」才落库）", "（跟三类轴一样按「💾 保存出图默认」才落库）", 1),
 ("/** ① 那一档的画廊开关：「每一派大概长这样」「这 8 套版式都长这样」点开才铺，收着不占地方。",
  "/** ① 那一档的画廊开关：「每一派大概长这样」点开才铺，收着不占地方。", 1),
 ("    (a.k === 'layout' ? npGalBt('layout', '这 8 套版式都长这样') : '') + '</div>' +\n    (a.k === 'layout' && _npLookGal === 'layout' ? npLayoutGalleryHtml(w, eff) : '');",
  "    '</div>';", 1),
 ("  const txt = String((demo && demo.text) || npCoverText(w) || '').trim();\n  const mode = npCapOf(eff);\n  const card = npDemoCardHtml(eff, { cap: demo && demo.cap, txt: txt });",
  "  const mode = npCapOf(eff);\n  // 小样压的就是这一张此刻真正要压的那一叠字：排多大、落哪一格，跟 ⑤ 与 ⬇ 同一份（npCapPlan／npCoverPlan）\n  const plan = demo ? (demo === cv ? npCoverPlan(w) : npCapPlan(w, demo)) : null;\n  const zoneTxt = VisualMotif.zoneTitle((plan && plan.zone) || VisualMotif.zoneDefault(mode)) || '下中';\n  const card = npDemoCardHtml(eff, { plan: plan });", 1),
 ("· 版式（' + esc(String(eff.layout || '默认')) + '）· 主题", "· 字位（' + esc(zoneTxt) + '）· 主题", 1),
 ("这儿只演示版式与字）", "这儿只演示字与字位）", 1),
]
for old, new, n in REPS:
    c = src.count(old)
    assert c == n, 'REP count=%d want=%d :: %r' % (c, n, old[:70])
    src = src.replace(old, new)

tmp = p + '.t91'
with io.open(tmp, 'w', encoding='utf-8', newline='') as f:
    f.write(src)
os.replace(tmp, p)
print('OK lines=%d' % src.count('\n'))
