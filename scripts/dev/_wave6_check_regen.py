# -*- coding: utf-8 -*-
"""五十三改自检对齐（第三批）：④ 挑稿那一段里 `.npVarGen`（旧「🔁 重新 AI 生成这批」那颗）已随四十七／四十九改
换成页脚常驻的「🔀 重写这批」（`.np-wiz-again`），这条脚本里五处断言还指着旧那颗，所以在 2234 行就停住
（与本轮任务配置改版无关）。同时把「这条线底下的几种写法」从旧的只读文字清单断言改成并排的样稿手机。

顺带修 popup.js 一处话术：缺料那台手机让人「点上面『🔁 重新 AI 生成这批』」，那颗按钮已经不在了 → 改成页脚「🔀 重写这批」。
"""
import io

CHECK = r'D:\AIproject\小红书运营\scripts\dev\check_diagnosis_ui.py'
POPUP = r'D:\AIproject\小红书运营\extension\popup.js'

# (行号, 这一行必须含的旧片段, 新整行)
EDITS = [
    (2234, '.npVarGen',
     "            assert page.locator('.np-wiz-again').count() == 1, '④ 页脚要常驻那颗「🔀 重写这批」'"),
    (2235, '.npVarGen',
        "            expect(page.locator('.np-wiz-again')).to_have_text('🔀 重写这批')"),
    (2236, '上一批不满意',
        "            expect(page.locator('#npWizBody')).to_contain_text('点一条就换，换完自动按它的几种写法各出一篇')"),
    (2287, '.npVarGen',
        "            page.locator('.np-wiz-again').click()"),
    (2310, '.npVarGen',
        "            assert page.locator('#npWizBody .npPhone').count() == 4, '热梗线 4 种写法＝四台手机并排'"),
    (2351, '.npVarGen',
        "            assert page.locator('#npWizBody .npPhone').count() == 0, '没定线＝一台样稿都没有，也不该烧 AI'"),
]

# 2233 那行注释跟着改口径
NOTE = (2233, '常驻的重新生成入口', '常驻的重新生成入口＝页脚那颗「🔀 重写这批」（换线 / 刚改过口径 / 上一批不满意都点它）')


def main():
    raw = io.open(CHECK, encoding='utf-8', newline='').read()
    lines = raw.split('\n')
    assert '.npVarGen' in raw, '没有找到旧断言'

    for no, must, new in EDITS:
        assert must in lines[no - 1], '第 %d 行没命中 %s（现在：%s）' % (no, must, lines[no - 1][:90])
        lines[no - 1] = new

    assert NOTE[1] in lines[NOTE[0] - 1], lines[NOTE[0] - 1]
    lines[NOTE[0] - 1] = '            # ' + NOTE[2]

    body = '\n'.join(lines)
    assert '.npVarGen' not in body, '还有 .npVarGen 残留'
    assert body.count('.np-wiz-again') >= 4, '页脚那颗至少要有 计数/文案/点击 三处新断言 + 原有那一处'

    io.open(CHECK, 'w', encoding='utf-8', newline='').write(body)

    src = io.open(POPUP, encoding='utf-8', newline='').read()
    old = '再点上面「🔁 重新 AI 生成这批」'
    new = '再点页脚「🔀 重写这批」'
    if old in src:
        src2 = src.replace(old, new)
        assert '🔁' not in src2, '改完不该再有 🔁 的残留引用'
        io.open(POPUP, 'w', encoding='utf-8', newline='\n').write(src2)
    else:
        assert '🔁 重新 AI 生成这批' not in src, '另有 🔁 残留：%s' % [l for l in src.split('\n') if '🔁' in l][:2]
        print('（popup.js 那句缺料话术此前已改，跳过）')
    print('✅ ④ 段五处旧按钮断言已换到页脚「🔀 重写这批」，缺料话术同步')


if __name__ == '__main__':
    main()
