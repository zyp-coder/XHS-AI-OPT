# -*- coding: utf-8 -*-
"""五十三改自检对齐：把 scripts/dev/check_diagnosis_ui.py 里「发笔记 → 任务配置」那一段的断言
改到新形状（二级顺序 任务配置/笔记档案/素材库、📄 横 tab 改名「内容基调」+ 表格列表、🎚 话术比例＝4 按钮 + 一句建议）。

行号是**改之前**的 1-based，应用顺序＝从尾部往头部（单行替换 → 整段替换），避免行号漂移。
纪律：只动这一段的断言与它的 check 文案，别的用例（尤其 ④ 挑稿里 `_styleTalkHtml` 那套「当前：X（约占正文 N 成）」）一字不动。
"""
import io
import re

PATH = r'D:\AIproject\小红书运营\scripts\dev\check_diagnosis_ui.py'

# ── 单行片段替换（整文件必须恰好命中 N 次）──────────────────────────────
SUBS = [
    ("and '卖货话术的比例' not in _stage_txt", "and '话术比例' not in _stage_txt", 1),
    ("('📄 五条线 × 写法')", "('📄 内容基调 · 五条线 × 写法')", 2),
    ("'发笔记 ④ 挑稿就按这张表走'", "'这一张表＝账号默认，发笔记按它写'", 1),
    ("'（出厂默认）'", "'出厂默认'", 1),
    ("'（账号改过）'", "'账号改过'", 2),
    ("'（跟所在那条线）'", "'跟所在那条线'", 2),
    ("'📐 11/79/10'", "'11 / 79 / 10'", 1),
    ("'📐 10/80/10'", "'10 / 80 / 10'", 3),
    ("'📐 6/44/50'", "'6 / 44 / 50'", 1),
    ("'🖋 500-800 字'", "'500-800 字'", 1),
    ("'🖋 800-1500 字'", "'800-1500 字'", 2),
]

# ── 整段替换：(起始行, 结束行, 新行) 含两端 ────────────────────────────
BLOCKS = []

# 3) 🎚 话术比例那一节：砍成 4 颗按钮 + 一句按阶段给的建议（原 1420~1437 行）
BLOCKS.append((1420, 1437, [
    "            # 🎚 话术比例 · 账号默认（页内第三个横 tab）：老板要的是「四个字太多——就是 4 个按钮，再加一个选择建议」",
    "            note_tone(page, 'talk')",
    "            assert page.locator('#diagStyleResult .ntTalkBtn').count() == 4, '四档话术比例＝四颗按钮，不再铺一大段话'",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('🎚 话术比例 · 账号默认')",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('💡 建议：')",
    "            assert '轻带一句' in page.locator('#diagStyleResult .ntTalkBtn.on').inner_text(), '当前那一档点亮'",
    "            assert page.locator('#diagStyleResult .ntTalkUse').count() == 0, '冷启动的建议＝轻带一句，已经是这一档时不该再给「就按建议改」'",
    "            assert page.locator('#diagStyleResult').inner_text().count('📐') == 0, '🎚 这一节只管档位，每格的 📐 数字在 📄 那张表上'",
    "            page.locator('#diagStyleResult .ntTalkBtn[data-talk=\"strong\"]').click()",
    "            assert '主打推荐' in page.locator('#diagStyleResult .ntTalkBtn.on').inner_text(), '点一下就换档'",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('💡 建议：轻带一句')   # 建议跟着账号阶段，不跟着手改的档位跑",
    "            assert page.locator('#diagStyleResult .ntTalkUse').count() == 1, '建议与当前档不同时要给一颗「就按建议改」'",
    "            got_talk = worker.evaluate('async () => (await Storage.getConfig()).noteStyle')",
    "            assert got_talk['sellTalk'] == 'strong', got_talk",
    "            assert got_talk['lines']['howto']['shape'] == {'build': 9, 'core': 71, 'sell': 20}, '话术默认只改 sellTalk：线里那套基配比不能被盖掉（切回轻带就还原）'",
    "            note_tone(page, 'lines')",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('6 / 44 / 50')   # 9:71 分剩下的 50%，产品 50%",
    "            note_tone(page, 'talk')",
    "            page.locator('#diagStyleResult .ntTalkUse').click()   # 一句建议直接点走",
    "            assert worker.evaluate('async () => (await Storage.getConfig()).noteStyle')['sellTalk'] == 'light', '「就按建议改」＝落盘到建议那一档'",
    "            note_tone(page, 'lines')",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('10 / 80 / 10')",
    "            check(page, '🎚 话术比例＝4 颗按钮 + 一句选择建议（按阶段给、不烧 AI，已是那一档就不给按钮）：一改每格产品段重切、拨回来还原，不覆盖线／写法存的基配比')",
]))

# 2) 📄 五条线 × 写法 → 表格列表（原 1366~1382 行）
BLOCKS.append((1366, 1382, [
    "            # 📄 内容基调（表格列表）：一行＝一条线、底下缩进那几行是写法，列是 📐 配比 / 🖋 字数 / 来源；这一张表＝账号默认",
    "            note_tone(page, 'lines')",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('📄 内容基调 · 五条线 × 写法')",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('这一张表＝账号默认，发笔记按它写')",
    "            assert page.locator('#diagStyleResult table.ntToneTbl').count() == 1, '做成表格列表'",
    "            assert page.locator('#diagStyleResult thead th').count() == 5, '线·写法 / 📐 / 🖋 / 来源 / 操作 五列'",
    "            for line_name, k_name in (('故事线', '古代叙事'), ('共鸣线', '不敢承认的情绪'), ('热梗线', '文体切换'),",
    "                                      ('热点线', '热点借势破圈'), ('干货线', '教程步骤')):",
    "                txt = page.locator('#diagStyleResult').inner_text()",
    "                assert line_name in txt and k_name in txt, f'默认展开：要列出「{line_name}」底下的「{k_name}」'",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('分步、编号、一步一个动作')   # 每种写法都带着\"它换的是哪一样\"",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('本阶段')                      # 每条线标出本阶段排几篇（读 ⑨ 那份配比）",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('出厂默认')                    # 来源单列，不再括在数字后面",
    "            # 干货线出厂 {10,75,15}，产品段先被下面 🎚 话术默认「轻带一句」(10%) 盖一次 → 11/79/10",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('11 / 79 / 10')",
    "            expect(page.locator('#diagStyleResult')).to_contain_text('500-800 字')",
    "            assert page.locator('#diagStyleResult .npWriteType').count() == 0 and page.locator('#diagStyleResult .npWriteKind').count() == 0, '④ 的「切线／挑写法」不该出现在这一页：这里只管每格占多少字'",
    "            assert page.locator('#diagStyleResult .npStylePick, #diagStyleResult .npStylePickRaw, #diagStyleResult .npStyleWords').count() == 0, '调子卡（含 8 条手挑与整账号字数旋钮）已退市'",
    "            check(page, '📄 内容基调＝表格列表：每条线一行、写法缩进一行，各带 📐 配比与 🖋 字数＋来源列；旧的调子卡与整账号字数旋钮都不在')",
]))

# 1) note_tone(page) 之后补二级顺序 + 横 tab 改名（原 1310 行之后插入）
BLOCKS.append((1310, 1310, [
    "            page.locator('#tabNotePublish').click()   # 先看二级排序与默认落点（进了任务配置 active 就换人了）",
    "            order = [t.strip() for t in page.locator('#noteTabs .sub-tab .rail-tx').all_inner_texts()]",
    "            assert order == ['任务配置', '笔记档案', '素材库'], '发笔记二级＝任务配置排第一：' + str(order)",
    "            assert 'active' in (page.locator('#tabNoteArchive').get_attribute('class') or ''), '排第一 ≠ 默认落点——打开这一块仍落「笔记档案」'",
    "            note_tone(page)",
    "            assert page.locator('#noteToneTabs [data-sec=\"lines\"]').inner_text().strip() == '📄 内容基调', '第二个横 tab 改名「内容基调」'",
    "            assert page.locator('#noteToneTabs [data-sec=\"talk\"]').inner_text().strip() == '🎚 话术比例', '第三个横 tab 只剩五个字'",
]))

# 1449 那行注释跟着改名：整段替换后行号会变，main() 里按内容搜索替换


def main():
    raw = io.open(PATH, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.split(eol)

    assert '💡 建议：' not in raw, '已经打过补丁'
    # 单行片段先替（不改变行数）
    for old, new, n in SUBS:
        assert raw.count(old) == n, '片段命中 %d 次（应为 %d）：%s' % (raw.count(old), n, old)
        raw = raw.replace(old, new)
    lines = raw.split(eol)

    for a, b, new in sorted(BLOCKS, reverse=True):
        seg = eol.join(lines[a - 1:b])
        if a == 1310:
            assert seg.strip() == 'note_tone(page)', repr(seg)
        elif a == 1366:
            assert "'📄 内容基调 · 五条线 × 写法'" in seg and 'ntToneTbl' not in seg, seg[:120]
        else:
            assert '当前：轻带一句（约占正文 1 成）' in seg, seg[:120]
        lines[a - 1:b] = new

    # 1449 注释跟着改名（整段替换后行号已变，按内容找）
    for i, l in enumerate(lines):
        if '横 tab 仍停在 📄 五条线与写法' in l:
            lines[i] = l.replace('横 tab 仍停在 📄 五条线与写法', '横 tab 仍停在 📄 内容基调')
            break
    else:
        raise AssertionError('没找到 1449 那行注释')

    body = eol.join(lines)
    # ④ 挑稿那套话术行没被误伤（它仍用「当前：X（约占正文 N 成）」）
    assert body.count('当前：轻带一句（约占正文 1 成）') == 1, '④ 挑稿那一处「当前：…」断言要留着'
    for dead in ('📐 11/79/10', '（出厂默认）', '🎚 卖货话术的比例'):
        assert dead not in body, '还有旧断言：' + dead
    assert body.count(".npStyleTalk').count() == 4") == 1, '④ 挑稿那一处四档断言要留着，任务配置这节改用 .ntTalkBtn'
    assert body.count(".ntTalkBtn').count() == 4") == 1

    io.open(PATH, 'w', encoding='utf-8', newline='').write(body)
    print('✅ check_diagnosis_ui.py 已对齐五十三改（%d 处片段 + 3 段重写）' % len(SUBS))


if __name__ == '__main__':
    main()
