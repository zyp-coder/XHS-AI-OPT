# -*- coding: utf-8 -*-
"""两处失效断言按当前界面口径改写：
   1) check_note_draft.py ③：话题已是四列表格（题+线名徽标 / 一句真事那一列 / 状态），
      「📌」「🧍」那两个前缀随卡片版一起没了——真事改看第三列，瞄/不提产品立得住看行 title。
   2) check_wiz_back.py ⑤：改稿页默认摆「逐句」，全文框 #npResult 要先点「✍️ 全文手改」才出来。
"""
import io

def load(p):
    raw = io.open(p, "rb").read()
    eol = "\r\n" if b"\r\n" in raw else "\n"
    return raw.decode("utf-8").replace("\r\n", "\n"), eol

def save(p, src, eol):
    io.open(p, "w", encoding="utf-8", newline="").write(src.replace("\n", eol))

# ── 1) check_note_draft.py ──
P1 = r"D:\AIproject\小红书运营\scripts\dev\check_note_draft.py"
s1, e1 = load(P1)
OLD1 = """        card0 = page.locator('.np-tp').first.inner_text()
        assert '干货线' in card0, '话题卡该带 AI 判的线名徽标：%s' % card0
        assert '📌 这个题底下的一句真事：有客户在评论区问' in card0, '四十六改：卡上要把那句真事显示出来：%s' % card0
        assert '🧍 不提产品也立得住：找客户的路子' in card0, card0
        card1 = page.locator('.np-tp').nth(1).inner_text()
        assert '线' not in card1.split('📌')[0], '没判出线的话题不该硬塞徽标：%s' % card1
"""
NEW1 = """        # ③ 是一张表：第二列＝题（带 AI 判的线名徽标），第三列＝这句真事，行 title 里挂「瞄 / 不提产品也立得住」
        card0 = page.locator('.np-tp').first.inner_text()
        assert '干货线' in card0, '话题行该带 AI 判的线名徽标（④ 就按这条线出写法）：%s' % card0
        assert '有客户在评论区问' in card0, '四十六改：这一行要把那句真事摆在第三列：%s' % card0
        assert '这个题底下的一句真事' in page.locator('#npWizBody table thead').first.inner_text(), '表头要点明第三列是什么'
        tip0 = page.locator('.np-tp').first.get_attribute('title') or ''
        assert '不提产品也立得住：找客户的路子' in tip0 and '瞄：购买前' in tip0, tip0
        card1 = page.locator('.np-tp').nth(1).inner_text()
        assert '线' not in card1, '没判出线的话题不该硬塞徽标：%s' % card1
"""
assert s1.count(OLD1) == 1, s1.count(OLD1)
s1 = s1.replace(OLD1, NEW1)
assert "📌 这个题底下的一句真事：" not in s1 and "🧍 不提产品也立得住" not in s1
save(P1, s1, e1)

# ── 2) check_wiz_back.py ──
P2 = r"D:\AIproject\小红书运营\scripts\dev\check_wiz_back.py"
s2, e2 = load(P2)
OLD2 = """        assert page.locator('#npResult').count(), '这篇有正文，灌回来该停在能改正文那一屏'
        page.locator('#npResult').fill(EDITED + '改过的。')
"""
NEW2 = """        # ⑤ 默认摆「逐句」：全文框要先点一下「✍️ 全文手改」才出来
        page.wait_for_selector('#npWizBody .np-draft-mode', timeout=20000)
        page.locator('#npWizBody .np-draft-mode').click()
        page.wait_for_selector('#npResult', timeout=20000)
        page.locator('#npResult').fill(EDITED + '改过的。')
"""
assert s2.count(OLD2) == 1, s2.count(OLD2)
s2 = s2.replace(OLD2, NEW2)
save(P2, s2, e2)
print("ok  eol1=%r eol2=%r" % (e1, e2))
