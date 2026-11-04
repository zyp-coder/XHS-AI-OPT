# -*- coding: utf-8 -*-
"""视频线「用 IP 主角出片」自检（2026-11-01：出镜人一条 / 每段【谁出场】/ 按段加配角 / 定妆照下载）。

口径（只查这几条，别的不碰）：
  1) 顶上一条「这条片出镜」：下拉换人、视觉锤、定妆照状态、⬇ 下载定妆照；
  2) 每段提示词：显示/复制/出图拿到的都是「行首【谁出场】＋底稿」，落库只存底稿；
  3) 按段加人：主角默认在里面，点别人＝这一段多一个配角，写明主次；
  4) 换人 / 再排一次不丢挑的人：dgen.charId 存住，charLine 按他递；
  5) 老片 / 没建角色：不报错、不挡路，照整篇主角或原样。
  6) 图文那条不受影响：npCharFor 仍认 shots.charId；后台规则 5.5 还在。

跑法：PYTHONIOENCODING=utf-8 py -3 scripts/dev/check_video_ip_cast.py
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

    # 1) 顶上那一条
    must('界面·出镜人一条', popup, 'function npDvCharBarHtml(w)', 1)
    must('界面·挂进分镜页', popup, 'return npDvCharBarHtml(w) +', 3)   # 生成中 / 排队中 / 出过分镜 三处
    must('界面·下拉', popup, '<select id="npDvCharSel"', 1)
    must('界面·换人事件', popup, "if (t && t.id === 'npDvCharSel')", 1)
    must('界面·视觉锤', popup, '视觉锤：', 2)   # 图文 ⑤ 一条 + 视频一条
    must('界面·下载定妆照', popup, 'class="np-dv-dlportrait btn btn-soft btn-sm"', 1)
    must('界面·下载事件', popup, "t.closest('.np-dv-dlportrait')", 1)
    must('界面·没建角色也能看', popup, '这条片还没定出镜人', 1)

    # 2) 每段提示词：显示 / 复制 / 落库
    must('规则·拼行', popup, 'function npDvCastLine(w, s)', 1)
    must('规则·取人', popup, 'function npDvCastOf(w, s)', 1)
    must('规则·剥旧行', popup, 'function npDvStripCast(txt)', 1)
    must('规则·取整段', popup, 'function npDvPromptText(w, s)', 1)
    must('显示·用现拼', popup, 'esc(npDvPromptText(w, s))', 1)
    must('复制·用现拼', popup, 'npDvPromptText(_npWiz, g.segs[i]).trim()', 1)
    must('落库·只存底稿', popup, 'g.segs[i].prompt = npDvStripCast(v);', 1)
    must('提示词·整片同一人', popup, '整片同一个人，从开场到收尾同一张脸、同一身衣服', 1)
    must('提示词·主角配角主次', popup, '两个人不是同一个人，大小主次分得清', 1)

    # 3) 按段加人
    must('按段·加人按钮', popup, 'class="np-dv-plus btn btn-sm"', 1)
    must('按段·加人事件', popup, "if (t && t.closest('.np-dv-plus'))", 1)
    must('按段·角色胶囊', popup, 'class="np-dv-castchip btn btn-sm"', 1)
    must('按段·点人事件', popup, "if (t && t.closest('.np-dv-castchip'))", 1)
    must('按段·点人函数', popup, 'function npDvCastToggle(i, cid, container)', 1)
    must('按段·整片主角不可点', popup, '他是整片主角，已经在里面了', 2)   # 胶囊禁用提示 + 误点 toast
    must('按段·每段标出镜', popup, '>出镜：', 1)

    # 4) 换人 / 再排一次不丢
    must('换人·存 dgen.charId', popup, "w.dgen.charId = String(t.value || '');", 1)
    must('再排·记住挑的人', popup, "const keepChar = String((w.dgen && w.dgen.charId) || '');", 1)
    must('再排·按他递', popup, "charLine: castC ? npCharLine(castC) : ''", 1)
    must('再排·写回 charId', popup, 'charId: npCharById(keepChar) ? keepChar : \'\',', 1)
    must('再排·收起加人面板', popup, '_npDvCastOpen = -1;', 2)   # 声明处 + 再排

    # 5) 老片 / 没建角色
    must('兼容·图文认 shots', popup, "const id = String((w && w.dgen && w.dgen.charId) || (w && w.shots && w.shots.charId) || '');", 1)
    must('兼容·没建角色不挡', popup, '没建 IP 角色就照稿子写', 1)

    # 6) 后台：出镜人照旧递进 AI（规则 5.5 不许撤）
    must('后台·规则5.5', bg, "'5.5) 这一条片子出镜的就是这一个人", 1)
    must('后台·表单没改', bg, "const charLine = String((data && data.charLine) || '').trim();", 1)

    if ERRORS:
        print('FAIL（%d 条）：' % len(ERRORS))
        for e in ERRORS:
            print('  ✗ ' + e)
        sys.exit(1)
    print('PASS：视频出镜人（换人 / 每段【谁出场】/ 按段加人 / 定妆照下载 / 老片兼容）都接上了')
    print('ALL PASS')


if __name__ == '__main__':
    main()
