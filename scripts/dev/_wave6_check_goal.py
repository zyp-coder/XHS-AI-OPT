# -*- coding: utf-8 -*-
"""五十三改自检对齐（第二批）：check_diagnosis_ui.py 里「🎯 推广目标」那一段还指着已删的下拉框。

scenario-drain.js 2026-10-01 那一批把目标收成一个固定值（引流到个人主页），页面上只剩
「评论区承接（30 字）+ 引导话术（可选，40 字）」两个输入框——`#sxGoalSel` / `#sxGoalGuideRow` /
「要写清评论区承接去向」那条拦截都不存在了，所以原断言在第 2129 行就停住（与本轮任务配置改版无关）。
整段改到新形状，并保留后面用例依赖的收尾状态（guideText 最终＝「私信我，先给你做个免费测评」）。
"""
import io

PATH = r'D:\AIproject\小红书运营\scripts\dev\check_diagnosis_ui.py'
A, B = 2127, 2157          # 1-based，含两端

NEW = [
    "            # 🎯 推广目标（2026-10-01 简：目标固定＝引流到个人主页，页上只剩两句引导文案）",
    "            cfg.locator('#sxCfgTabs [data-sec=\"goal\"]').click()",
    "            expect(cfg.locator('#sxGoalGuide')).to_be_visible(timeout=10000)",
    "            assert cfg.locator('#sxGoalSel').count() == 0, '下拉已删——目标不再可选，固定引流到个人主页'",
    "            assert cfg.locator('#sxGoalGuideRow').count() == 0, '「品牌不引流就藏承接」那套随下拉一起撤了'",
    "            expect(cfg).to_contain_text('引流到个人主页')",
    "            expect(cfg.locator('#sxGoalGuide')).to_have_value('私信我了解')   # 读的就是 product.guideText（老 ① 的数据原地复用）",
    "            cfg.locator('#sxGoalGuide').fill('私信我，先给你做个免费测评')",
    "            cfg.locator('#sxGoalPhrase').fill('更多干货我平时发在主页')",
    "            cfg.locator('#sxGoalSave').click()",
    "            expect(cfg.locator('#sxGoalMsg')).to_contain_text('已保存', timeout=10000)",
    "            goal_saved = worker.evaluate('() => Storage.getConfig().then(c => c.product)')",
    "            assert goal_saved['promoGoal'] == 'profile' and goal_saved['guideText'] == '私信我，先给你做个免费测评' \\",
    "                and goal_saved['guidePhrase'] == '更多干货我平时发在主页', goal_saved",
    "            # 切走再回来：读回刚存的（真源＝config.product，不是页面内存）",
    "            cfg.locator('#sxCfgTabs [data-sec=\"kw\"]').click()",
    "            expect(cfg.locator('#sxKwAdd')).to_be_visible(timeout=10000)",
    "            cfg.locator('#sxCfgTabs [data-sec=\"goal\"]').click()",
    "            expect(cfg.locator('#sxGoalGuide')).to_have_value('私信我，先给你做个免费测评')",
    "            expect(cfg.locator('#sxGoalPhrase')).to_have_value('更多干货我平时发在主页')",
    "            # 承接清空也落得下去（评论里就不带承接），再填回来给后面的用例用",
    "            cfg.locator('#sxGoalGuide').fill('')",
    "            cfg.locator('#sxGoalSave').click()",
    "            expect(cfg.locator('#sxGoalMsg')).to_contain_text('已保存', timeout=10000)",
    "            assert worker.evaluate('() => Storage.getConfig().then(c => c.product.guideText)') == '', '清空要落得下去'",
    "            cfg.locator('#sxGoalGuide').fill('私信我，先给你做个免费测评')",
    "            cfg.locator('#sxGoalSave').click()",
    "            expect(cfg.locator('#sxGoalMsg')).to_contain_text('已保存', timeout=10000)",
    "            check(page, '🎯 推广目标（获客·任务配置第三 tab）＝固定目标「引流到个人主页」+ 两句引导（承接 30 字 / 话术 40 字）：读写 product.promoGoal / guideText / guidePhrase，切走回来原样读回、清空也落得下去')",
]


def main():
    raw = io.open(PATH, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in raw else '\n'
    lines = raw.split(eol)

    assert 'sxGoalPhrase' not in raw, '已经打过补丁'
    seg = eol.join(lines[A - 1:B])
    assert "expect(cfg.locator('#sxGoalSel')).to_be_visible" in seg and '工具/应用引流：去向得自己写' in seg, seg[:200]
    assert lines[B].lstrip().startswith("cfg.locator('#sxCfgTabs [data-sec=\"kw\"]').click()"), lines[B][:120]
    lines[A - 1:B] = NEW

    body = eol.join(lines)
    for dead in ("expect(cfg.locator('#sxGoalSel')).to_be_visible", "to_have_value('tool')",
                 "select_option('brand')", '要写清评论区承接去向', '老数据认成工具引流'):
        assert dead not in body, '旧断言还留着：' + dead
    assert body.count("fill('私信我，先给你做个免费测评')") == 2, '收尾状态要留给后面的承接真源用例'

    io.open(PATH, 'w', encoding='utf-8', newline='').write(body)
    print('✅ check_diagnosis_ui.py「🎯 推广目标」段已改到无下拉的新形状')


if __name__ == '__main__':
    main()
