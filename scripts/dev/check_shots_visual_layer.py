# -*- coding: utf-8 -*-
"""图文分镜「视觉层」自检（2026-10-31：场景 / 动作 / 表情 / 按张出场 四样新字段接没接上）。

口径（只查这几条，别的不碰）：
  1) 数据形状：npShotsShape / npShotsPack 都带 scene / act / face / chars，落档往返不丢；
  2) 切分镜那一发：popup 把账号的角色名单（chars）＋主角（mainChar）递给后台，后台按名字点人；
  3) 后台出的每一条带 场景 / 动作 / 表情 / 出场，JSON 口径对得上；老字段（desc）还留着兜底；
  4) 单张提示词：三格拆开时说【在哪、桌上有什么】【人在干什么】【什么表情】，三格全空就回退老的【配图画面】【背景】；
     每张再点名【谁出场】（整组里报名字、单张里连外形一起带，复制单张出去也认得到人）；
  5) 按张点人：这一张点过人就用点的人（多人同框写明主次），没点过仍是整篇主角；
  6) ⑤ 那页：默认一行摘要，点「✎ 改这张」才展开三格＋谁出场；改一格整组提示词当场重拼；
  7) 出图带参考图：点过人的按这一张的人递定妆照，没点过按整篇主角。

跑法：python3 -X utf8 scripts/dev/check_shots_visual_layer.py
纯静态（读 web/popup.js ＋ server/bg/background.js），不开浏览器、不烧 AI。
"""
import pathlib
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
POPUP = ROOT / 'web' / 'popup.js'
BG = ROOT / 'server' / 'bg' / 'background.js'

ERRORS = []


def must(name, src, needle, n=1):
    got = src.count(needle)
    if got != n:
        ERRORS.append('%s：应命中 %d 次，实际 %d 次 —— %s' % (name, n, got, needle))


def main():
    popup = POPUP.read_text(encoding='utf-8')
    bg = BG.read_text(encoding='utf-8')

    # 1) 数据形状
    must('形状·scene', popup, "scene: String((x && x.scene) || '')", 1)
    must('形状·act', popup, "act: String((x && x.act) || '')", 1)
    must('形状·face', popup, "face: String((x && x.face) || '')", 1)
    must('形状·chars', popup, "chars: (Array.isArray(x && x.chars) ? x.chars : []).map(String).filter(Boolean)", 1)
    must('落档·scene', popup, "scene: String(i.scene || ''), act: String(i.act || ''), face: String(i.face || '')", 1)
    must('落档·chars', popup, "chars: (Array.isArray(i.chars) ? i.chars : []).map(String).filter(Boolean)", 1)

    # 2) 切分镜那一发带名单
    must('递名单', popup, "chars: ((_npChars && _npChars.list) || []).map(c => ({ id: c.id, name: c.name }))", 2)
    must('递主角', popup, "mainChar: (npCharFor(w) || {}).name || ''", 2)
    must('名字→id', popup, 'function npCharIdByName(nm)', 1)
    must('接出场', popup, "const castRaw = (x && x['出场'] != null) ? x['出场'] : (x && x.chars);", 1)
    must('接场景', popup, "scene: String((x && (x['场景'] || x.scene)) || '')", 2)
    must('接动作', popup, "act: String((x && (x['动作'] || x.act)) || '')", 2)
    must('接表情', popup, "face: String((x && (x['表情'] || x.face)) || '')", 2)

    # 3) 后台：名单进提示词 + 每条带四样
    must('后台·名单', bg, "const chars = (Array.isArray(data && data.chars) ? data.chars : [])", 1)
    must('后台·主角', bg, "const mainChar = String((data && data.mainChar) || chars[0] || '').trim();", 1)
    must('后台·人人可出场', bg, "'【可出场的人】'", 1)
    must('后台·规则4场景', bg, "'4) 「场景」", 1)
    must('后台·规则5动作', bg, "'5) 「动作」", 1)
    must('后台·规则6表情', bg, "'6) 「表情」", 1)
    must('后台·规则7出场', bg, "'7) 「出场」", 1)
    must('后台·JSON口径', bg, '{"角色":"…","重点句":"…","场景":"…","动作":"…","表情":"…","出场":"…","配图主题":"…"}', 1)
    must('后台·回场景', bg, "scene: String((s && (s['场景'] || s.scene)) || '').trim(),", 1)
    must('后台·回动作', bg, "act: String((s && (s['动作'] || s.act)) || '').trim(),", 1)
    must('后台·回表情', bg, "face: String((s && (s['表情'] || s.face)) || '').trim(),", 1)
    must('后台·回出场', bg, "chars: cast,", 1)
    must('后台·老的兜底串还在', bg, "desc: String((s && (s['画面描述'] || s.desc)) || '').trim(),", 1)
    must('后台·旧规则已撤', bg, "'4) 「画面描述」", 0)

    # 4) 单张提示词：拆开三格 + 回退老写法
    must('提示词·在哪', popup, "'【在哪、桌上有什么】'", 1)
    must('提示词·动作', popup, "'【人在干什么】'", 1)
    must('提示词·表情', popup, "'【什么表情】'", 1)
    must('提示词·老画面回退', popup, "'【配图画面】'", 3)   # 单张两处（拆开回退 / 全空回退）＋封面一处
    must('提示词·老背景回退', popup, "'【背景】'", 4)
    must('提示词·每张谁出场', popup, "'【谁出场】'", 2)   # 图文单张 + 视频每段（11-01 加的视频那条）
    must('提示词·单张带外形', popup, "cs.map(npCharLine).join('；') + tail", 1)
    must('出图头不重复报人', popup, 'npShotPromptText(w, it, i, total, false, true)', 1)

    # 5) 按张点人
    must('按张·取人', popup, 'function npCharsOfItem(w, it)', 1)
    must('按张·取参考图', popup, 'function npCharRefsOfItem(w, it)', 1)
    must('按张·多人同框', popup, "'这一张出场的是这几个人（'", 1)
    must('按张·单人', popup, "'这一张出场的是这一个人（跟整组同一张脸", 1)
    must('按张·组头交代', popup, 'const anyCast = on.some(it => (it.chars || []).length);', 1)
    must('组头·块名跟着换', popup, 'const anyParts = on.some(it => it.scene || it.act || it.face);', 1)
    must('组头·新块名', popup, '【在哪、桌上有什么】【人在干什么】【什么表情】', 1)
    must('组头·块名含谁出场', popup, '【人在干什么】【什么表情】【谁出场】', 1)

    # 7) 出图递参考图
    must('出图·带参考图', popup, "refs: (job.refs && job.refs.length ? job.refs : npCharRefIds(npCharFor(w)))", 2)
    must('出图·按张递参考图', popup, 'refs: npCharRefsOfItem(w, it)', 2)   # 一键出图那条 + 单张重出那条

    # 6) ⑤ 那页
    must('界面·一行摘要', popup, 'function npShotListHtml(w)', 1)
    must('界面·挂进⑤', popup, "(on.length ? npShotListHtml(w) : '')", 1)
    must('界面·改这张', popup, "if (t && t.closest('.np-dsh-pen'))", 1)
    must('界面·谁出场', popup, "if (t && t.closest('.np-dsh-cast'))", 1)
    must('界面·三格输入', popup, "classList.contains('np-dsh-fld')", 1)
    must('界面·改完重拼', popup, 'function npDshGroupRefresh(w)', 1)
    must('界面·整组文本现拼', popup, 'function npDshGroupText(w)', 1)
    must('界面·⑤ 读现拼', popup, 'esc(npDshGroupText(w))', 1)

    if ERRORS:
        print('FAIL（%d 条）：' % len(ERRORS))
        for e in ERRORS:
            print('  ✗ ' + e)
        sys.exit(1)
    print('PASS：视觉层四样（场景/动作/表情/按张出场）数据、提示词、⑤ 界面都接上了')
    print('ALL PASS')


if __name__ == '__main__':
    main()
