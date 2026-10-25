# 图文线 ⑤「🖋 分镜确认」＋ ⑥「👀 预览」自检（按 2026-10-25 现界面重写）
#   现口径：档案「下一步」直落 ⑤ → 进站自动切一版（忙态卡，不用点）→ 一条整组提示词（📋 复制）
#           ＋ 传图口（⬆ 多选 / Ctrl+V 贴 / 全满换图）＋ 封面那一格 ＋ 📐 分几张（3/4/5/6/8 ＋ AI 自己定）＋ ↻ 再来一组
#           → 存好落档「代发」→ ⑥ 预览（封面那张＋四屏合成卡＋正文）。
#   覆盖 18 节：
#     ① 档案「下一步」＝✏️ 编辑，提示指「接着出这一套」② 点进直落 ⑤、五站条 ③ 自动切＋忙态卡＋配置行四颗
#     ④ 4 张落地（重点句照抄 / 角色兜底 / 主题截 12 字 / 整组提示词 / AI 契约）
#     ⑤ 📐 6 张重切（忙态「按「6 张」重切」＋正好 N 条）⑥ 📐 4 张回切
#     ⑦ 画面风格那颗（本地重拼零 AI）＋整组提示词手改 ⑧ ↻ 再来一组
#     ⑨ ⬆ 多选 2 张铺空格 ⑩ Ctrl+V 贴进选中格 ⑪ 补最后一格 ⑫ ⬆ 传封面
#     ⑬ 点图看大图＋选中，全满再传＝换掉那张 ⑭ 下一步 ⑥ 预览 ⑮ ✓ 完成落档「代发」
#     ⑯ 存档两本账（imgDocs 那一行 ＋ 条目级镜像）⑰ 档案 👀 预览（5 张）⑱ 重新打开不重切、不烧 AI
import base64
import json
import pathlib
import struct
import sys
import tempfile
import zlib

from playwright.sync_api import expect, sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')  # GBK 控制台打 PASS 行里的 emoji 会炸

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'

DRAFT1 = ('知道吧，很多人买电脑散热垫都是随手搜一个销量高的就下单。我前前后后换过七个，踩的坑一个比一个贵。'
          '第一个是那种大风扇直吹的，风是够大，可我的笔记本底部是整块塑料，根本吃不上风。'
          '后来又买过带冰袋的，刚开始凉，半个小时就回温，还得擦水。'
          '第三种是架高的铝合金，散热一般，但打字角度是真舒服。'
          '我们家两个孩子都上网课，两台本子并排跑，桌面上一放就挤成一团。'
          '于是我自己动手改了一个能拼装的支架，风速三挡可调，底座能拆开塞进书包，上周带出去开会，放在小桌板上也稳。'
          '装的时候不用拧螺丝，卡扣一按就合。如果你也想给本子找个能装包里的散热支架，主页有我自己在用的那款。')
TURN = '于是我自己动手改了一个能拼装的支架'

LONGTOPIC = '一段特别长的配图主题要截断考'
LONGTOPIC_CUT = '一段特别长的配图主题要截'

# 4 条重点：句子＝正文原话（一个字不许改）；第 2 条角色留空（考兜底「展开」）、配图主题 14 字（考截到 12）
K4_POINTS = [
    '我前前后后换过七个，踩的坑一个比一个贵。',
    '后来又买过带冰袋的，刚开始凉，半个小时就回温，还得擦水。',
    '第三种是架高的铝合金，散热一般，但打字角度是真舒服。',
    '如果你也想给本子找个能装包里的散热支架，主页有我自己在用的那款。',
]
K4 = {'分镜': [
    {'角色': '开场', '重点句': K4_POINTS[0], '画面描述': '画面：桌面上摊着七个旧散热垫，一个比一个灰。这一张要让人看明白：踩坑踩了一串。', '配图主题': '一排散热垫'},
    {'角色': '', '重点句': K4_POINTS[1], '画面描述': '画面：抽屉里躺着带冰袋的旧垫子，边上还有一圈水渍。这一张要让人看清楚：凉得快也回得快。', '配图主题': LONGTOPIC},
    {'角色': '细节', '重点句': K4_POINTS[2], '画面描述': '画面：铝合金支架垫在本子底下，打字的手搭在键盘上。这一张要让人分出来：角度舒服。', '配图主题': '铝合金支架'},
    {'角色': '收束', '重点句': K4_POINTS[3], '画面描述': '画面：拼装支架放在窗边，晨光照在卡扣上。这一张要让人落住：主页有同款。', '配图主题': '窗边支架'},
]}

# 6 条那套：角色兜底链全走一遍（开场 / 转折 / 细节 / 对照 / 展开 / 收束）
S6 = {'分镜': [
    {'角色': '', '重点句': K4_POINTS[0], '画面描述': '画面：桌面上摊着七个旧散热垫，一个比一个灰。这一张要让人看明白：踩坑踩了一串。', '配图主题': '一排散热垫'},
    {'角色': '转折', '重点句': TURN + '，风速三挡可调。', '画面描述': '画面：手把拼装支架的卡扣按合。这一张要让人看明白：自己动手改。', '配图主题': LONGTOPIC},
    {'角色': '', '重点句': K4_POINTS[1], '画面描述': '画面：抽屉里躺着带冰袋的旧垫子，边上还有一圈水渍。这一张要让人看清楚：凉得快也回得快。', '配图主题': '旧冰袋'},
    {'角色': '', '重点句': '底座能拆开塞进书包，上周带出去开会，放在小桌板上也稳。', '画面描述': '画面：支架折起来塞进书包侧袋。这一张要让人分出来：能装包。', '配图主题': '塞进书包'},
    {'角色': '', '重点句': '装的时候不用拧螺丝，卡扣一按就合。', '画面描述': '画面：小桌板上的支架稳稳架着本子。这一张要让人看清楚：出门也稳。', '配图主题': '小桌板'},
    {'角色': '', '重点句': K4_POINTS[3], '画面描述': '画面：拼装支架放在窗边，晨光照在卡扣上。这一张要让人落住：主页有同款。', '配图主题': '窗边支架'},
]}

def seed_note():
    now = 1759000000000
    return {
        'id': 'dsh1', 'createdAt': now, 'updatedAt': now, 'platform': 'xhs',
        'title': '散热垫换了七个', 'topic': '', 'people': [], 'sellPoints': [], 'kb': [],
        'form': '图文', 'style': '', 'filmKind': '',
        'draft': DRAFT1, 'titles': ['散热垫换了七个'], 'tags': ['散热'], 'timeTip': '',
        'visual': None, 'shots': None, 'imgDocs': None, 'filmDocs': None,
        'voice': DRAFT1, 'thumb': None, '_sv': 2,
        'dir': 'd', 'kOut': '', 'dOut': 'img',
        'mind': None, 'voiceUrl': '', 'voiceError': None, 'dgenDocs': [], 'dgen': None, 'asm': None,
        'wip': {'step': 4, 'path': 'image', 'noteStyle': {}, 'write': None, 'planItem': None,
                'drainPick': {'cat': '踩坑', 'title': '散热垫换了七个', 'line': '干货经验', 'turn': TURN, 'body': DRAFT1}},
        'status': '草稿', 'statusAt': {},
    }

def png(path, w=160, h=200, rgb=(120, 200, 140)):
    """写一张纯色 PNG（只用来验传图回素材库＋预览合成读得到底图）"""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw, 6))
                     + chunk(b'IEND', b''))
    return path

def clear_toasts(page):
    page.evaluate('() => { const b = document.getElementById("popToastBox"); if (b) b.innerHTML = ""; }')

def calls(sw):
    return sw.evaluate('self.testDshCalls')

def shot_state(page):
    return page.evaluate('() => ({ n: (_npWiz.shots.items || []).length, roles: (_npWiz.shots.items || []).map(x => x.role).join("/"), points: (_npWiz.shots.items || []).map(x => x.text).join("|") })')

SW_STUB = '''async () => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const config = await Storage.getConfig();
    config.ai.apiKey = 'test-local-only';
    config.product.name = '分镜测试产品';
    config.imgLook = null;
    await Storage.setConfig(config);
    self.testDshCalls = 0;
    self.testDshLastSystem = '';
    self.testDshLastUser = '';
    const K4 = %s;
    const S6 = %s;
    AiClient.chatCompletion = async (cfg, system, user) => {
        self.testDshCalls++;
        self.testDshLastSystem = String(system || '');
        self.testDshLastUser = String(user || '');
        await new Promise(r => setTimeout(r, 2500));
        const m = String(user || '').match(/正好 (\\d+) 条/);
        const want = m ? parseInt(m[1], 10) : 0;
        let out = K4;
        if (want === 6) out = S6;
        else if (want) out = { '分镜': K4['分镜'].slice(0, want) };
        return { content: JSON.stringify(out) };
    };
}''' % (json.dumps(K4, ensure_ascii=False), json.dumps(S6, ensure_ascii=False))

with tempfile.TemporaryDirectory(prefix='xhs-note-dsh-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate(SW_STUB)
        sw.evaluate('''async (entry) => {
            await chrome.storage.local.set({ np_notes: [entry] });
            await chrome.storage.local.remove(['np_assets', 'note_dgens']);
        }''', seed_note())

        pic = {}
        for name, rgb in [('a', (230, 90, 90)), ('b', (90, 160, 230)), ('c', (110, 200, 130)),
                          ('d', (240, 200, 90)), ('e', (170, 120, 230)), ('f', (120, 220, 210))]:
            pic[name] = png(pathlib.Path(profile) / (name + '.png'), rgb=rgb)

        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda d: d.accept())
        page.set_default_timeout(20000)
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof _npWiz !== "undefined"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()

        # ① 档案「下一步」：没出过图＝「✏️ 编辑」，提示指「接着出这一套」，还没图所以不带「还缺」
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('.npar-next[data-id="dsh1"]')
        nb1 = page.locator('.npar-next[data-id="dsh1"]')
        expect(nb1).to_have_text('✏️ 编辑')
        tip1 = nb1.get_attribute('title') or ''
        assert '接着出这一套：拆分镜 → 整组提示词复制去生成 → 图一张张传回格子' in tip1, tip1
        assert '还缺' not in tip1, tip1
        print('PASS ①: 档案下一步读「✏️ 编辑」，提示指 拆分镜 → 整组提示词 → 图传回格子')

        # ② 点它直落 ⑤：五站条、图文线、不在 ⑥
        nb1.click()
        page.wait_for_function('() => _npWiz && _npWiz.step === 5 && _npWiz.dOut === "img"')
        assert page.evaluate('_npWiz.path') == 'image'
        steps = page.locator('#npSteps').inner_text()
        for t in ['📄 出几版', '改稿', '🖋 分镜确认', '👀 预览', '发布']:
            assert t in steps, f'五站条缺「{t}」: {steps}'
        assert '🎯 挑重点' not in steps and '🎬 分镜出词' not in steps, steps
        assert page.locator('#noteOutputContent').is_hidden()
        print('PASS ②: 档案直落 ⑤ 分镜确认（五站条：出几版 / 改稿 / 🖋 分镜确认 / 👀 预览 / 发布）')

        # ③ 进站自动切一版：忙态卡自己到（不用点任何钮）＋配置行（画面风格 4 颗 / 分几张 6 颗 / ↻，无生成钮、无配文方式）
        page.wait_for_function('''() => {
            const b = document.getElementById("npWizBody");
            const n = document.getElementById("npWizNav");
            return !!b && b.innerText.includes("AI 正在按正文把分镜切好") && b.innerText.includes("自动跑一版，不用点")
                && !!n && n.innerText.includes("AI 正在把这一套切出来——等它切好");
        }''')
        assert page.locator('.np-dsh-gen').count() == 0, '生成钮该撤了——进站就自动跑'
        assert page.locator('.np-dsh-cap').count() == 0, '配文方式那排已经撤了'
        assert page.locator('.np-dsh-motif').count() == 4, '画面风格＝三个流派 ＋ 跟账号默认'
        assert page.locator('.np-dsh-motif[data-k="方案页"]').count() == 1
        assert page.locator('.np-dsh-motif[data-k=""]').count() == 1
        assert page.locator('.np-dsh-n').count() == 6, '分几张＝3/4/5/6/8 ＋ AI 自己定'
        assert page.locator('.np-dsh-n[data-k="0"]').count() == 1
        assert page.locator('.np-dsh-again').count() == 1
        body = page.locator('#npWizBody').inner_text()
        for t in ['⚙ 生成前定一次', '🎨 画面风格（这一套）', '📐 分几张',
                  'AI 自己定＝看内容切、宁少勿多（约 4~6 张；这篇算「知识 / 干货」）']:
            assert t in body, f'⑤ 配置行缺「{t}」: {body[:600]}'
        print('PASS ③: 进站自动切（忙态卡自己到）；配置行＝画面风格 4 颗 / 分几张 6 颗 / ↻；生成钮与配文方式都不在')

        # ④ 那一发落地：4 张——重点句照抄、角色兜底、主题截断、整组提示词本地拼、AI 契约
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4 && !_npDshBusy')
        st = shot_state(page)
        assert st['points'] == '|'.join(K4_POINTS), st['points']
        assert st['roles'] == '开场/展开/细节/收束', st['roles']
        assert page.evaluate('_npWiz.shots.items[1].topic') == LONGTOPIC_CUT, page.evaluate('_npWiz.shots.items[1].topic')
        assert page.evaluate('_npWiz.shots.shotN') == 0, '没点档位＝AI 自己定'
        assert page.evaluate('typeof _npWiz.shots.cvTxt') == 'undefined', 'cvTxt 老字段该没了'
        # 传图口与整组提示词都在这一站（不再分两站）；封面那一格单独一颗
        assert page.locator('#npDshGroup').count() == 1
        assert page.locator('.np-dsh-gcopy').count() == 1
        assert page.locator('.np-dsh-upmany').count() == 1
        assert page.locator('.np-dsh-cv-file').count() == 1
        assert page.locator('.np-dsh-cell').count() == 4
        assert page.locator('.np-dsh-cvcell').count() == 1
        body = page.locator('#npWizBody').inner_text()
        assert '已传 0/4 · 封面缺' in body, body[:600]
        assert '还缺 4 张配图 + 封面' in body, body[:900]
        assert '一套 4 张就这一条' in body, body[:600]
        # 整组提示词：组头（营销配图 / 张数 / 尺寸 / 拍法 / 同一个人同一时段）＋每张六块
        gv = page.evaluate('_npWiz.shots.groupPrompt')
        assert page.locator('#npDshGroup').input_value() == gv
        for t in ['这是一组小红书知识笔记的营销配图：4 张，竖版 3:4。',
                  '画面形式＝手机随拍：像作者拿自己的手机在旁边顺手拍的，不是广告片，也不是影棚布景。',
                  '同一个人、同一部手机、同一个时段的光；一次出齐 4 张，按顺序来。',
                  '图上文案：像作者拍完随手打在手机上的一句大字',
                  '每张按【这段正文】【这张要说明】【配图画面】【背景】【机位】【图上文案】几块给：',
                  '第 1 张：\n【这段正文】' + K4_POINTS[0],
                  '【这张要说明】踩坑踩了一串。',
                  '【配图画面】桌面上摊着七个旧散热垫，一个比一个灰；别摆整齐，像干到一半。',
                  '【背景】一排散热垫，现场原样，别换成影棚或背景纸。',
                  '【机位】手机在桌边俯拍，离桌面四五十厘米，竖拍，桌面占大半，手从画面边上伸进来。',
                  '画面上只写「' + K4_POINTS[0] + '」这一句（可照参考句改写），只出现一次，别的字一个都不要；',
                  '写法照组头。',
                  '第 2 张：', '第 4 张：']:
            assert t in gv, f'整组提示词缺「{t}」: {gv[:900]}'
        assert '【背景】' + LONGTOPIC_CUT in gv, gv[:900]
        # 第 2 张场子里没有桌面/键盘 → 走人物那几档机位（别六张一个角度）
        assert '【机位】手机举到眼睛高' in gv, gv[:1400]
        assert '每一张的主角都是同一个人' not in gv, '账号没设形象（casting）就不该有这句'
        assert gv.count('第 1 张：') == 1 and gv.count('第 4 张：') == 1
        sys_tx = sw.evaluate('self.testDshLastSystem')
        for t in ['你是一名图文笔记分镜师', '宁少勿多（约 4~6 条', '绝对不许按字数均分',
                  '一个字都不许改', '第一条必须是「开场」，最后一条必须是「收束」']:
            assert t in sys_tx, f'AI 提示词缺「{t}」: {sys_tx[:500]}'
        assert '这一套正好' not in sys_tx, sys_tx[:400]
        user_tx = sw.evaluate('self.testDshLastUser')
        assert '【标题】散热垫换了七个' in user_tx, user_tx[:300]
        assert '【正文】\n' + DRAFT1 in user_tx, user_tx[:300]
        assert '【这篇算】知识 / 干货（宁少勿多约 4~6 条重点）' in user_tx, user_tx[:400]
        assert '【转法那句】' + TURN in user_tx, user_tx[:400]
        assert calls(sw) == 1
        expect(page.locator('#popToastBox')).to_contain_text('切好了 4 张（AI 自己定的，知识 / 干货料型）')
        print('PASS ④: 自动那一发落 4 张——重点句照抄 / 角色兜底 / 主题截 12 字 / 整组提示词六块齐 / AI 契约对')

        # ⑤ 📐 点「6 张」：忙态说「按「6 张」重切一版」，AI 契约换成「正好 6 条」，角色兜底链全走一遍
        clear_toasts(page)
        page.locator('.np-dsh-n[data-k="6"]').click()
        page.wait_for_function('() => document.getElementById("npWizBody").innerText.includes("按「6 张」重切一版")')
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 6 && !_npDshBusy')
        assert page.evaluate('_npWiz.shots.shotN') == 6
        st = shot_state(page)
        assert st['roles'] == '开场/转折/细节/对照/展开/收束', st['roles']
        sys_tx = sw.evaluate('self.testDshLastSystem')
        assert '这一套正好 6 条——一条不多、一条不少' in sys_tx and '宁少勿多' not in sys_tx, sys_tx[:500]
        user_tx = sw.evaluate('self.testDshLastUser')
        assert '【这篇算】知识 / 干货（正好 6 条重点）' in user_tx, user_tx[:400]
        assert calls(sw) == 2
        expect(page.locator('#popToastBox')).to_contain_text('切好了 6 张（你定的张数）')
        gv6 = page.evaluate('_npWiz.shots.groupPrompt')
        assert '：6 张，竖版 3:4。' in gv6 and '一次出齐 6 张' in gv6, gv6[:300]
        print('PASS ⑤: 📐「6 张」按新张数重切一版——忙态文案 / 正好 6 条契约 / 角色兜底链 / 组头跟着变 6 张')

        # ⑥ 📐 回「4 张」
        clear_toasts(page)
        page.locator('.np-dsh-n[data-k="4"]').click()
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4 && !_npDshBusy && _npWiz.shots.shotN === 4')
        assert calls(sw) == 3
        expect(page.locator('#popToastBox')).to_contain_text('切好了 4 张（你定的张数）')
        print('PASS ⑥: 📐 回「4 张」再切一版（第三发 AI，张数档记进这一套）')

        # ⑦ 画面风格那颗：只重拼、零 AI（流派不进整组提示词）；整组提示词手改当场回写；点「跟账号默认」清掉这一套的流派
        clear_toasts(page)
        page.locator('.np-dsh-motif[data-k="方案页"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('这一套按「方案页」摆画面——整组提示词重拼了')
        page.wait_for_function('() => ((_npWiz.shots.look || {}).motif || "") === "方案页"')
        assert calls(sw) == 3, '换画面风格不许烧 AI'
        page.fill('#npDshGroup', '手改的一条整组提示词')
        page.wait_for_function('() => _npWiz.shots.groupPrompt === "手改的一条整组提示词"')
        assert page.evaluate('_npWiz.shots.groupPromptOwn') is True
        clear_toasts(page)
        page.locator('.np-dsh-motif[data-k=""]').click()
        expect(page.locator('#popToastBox')).to_contain_text('跟账号默认走了')
        page.wait_for_function('() => !((_npWiz.shots.look || {}).motif || "")')
        gv = page.evaluate('_npWiz.shots.groupPrompt')
        assert gv != '手改的一条整组提示词' and '一次出齐 4 张' in gv, gv[:300]
        assert calls(sw) == 3, '跟账号默认也不许烧 AI'
        print('PASS ⑦: 画面风格那颗本地重拼（零 AI）；整组提示词手改回写；「跟账号默认」清掉这一套的流派并把提示词拼回来')

        # ⑧ ↻ 再来一组：同张数再切一版（第四发 AI）
        clear_toasts(page)
        page.locator('.np-dsh-again').click()
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4 && !_npDshBusy')
        assert calls(sw) == 4
        expect(page.locator('#popToastBox')).to_contain_text('切好了 4 张（你定的张数）')
        assert page.evaluate('_npWiz.shots.items.every(x => !(x.imgs || []).length)')
        print('PASS ⑧: ↻ 再来一组同张数再切一版（第四发 AI，四格图仍是空的）')

        # ⑨ ⬆ 传图（可多选）：两张按顺序铺进头两个空格 → 进素材库（shotOf 引用）
        clear_toasts(page)
        page.set_input_files('.np-dsh-upmany', [str(pic['a']), str(pic['b'])])
        expect(page.locator('#popToastBox')).to_contain_text('传了 2 张——还差 2 张')
        page.wait_for_function('() => (_npWiz.shots.items[0].imgs || []).length === 1 && (_npWiz.shots.items[1].imgs || []).length === 1')
        assert '已传 2/4 · 封面缺' in page.locator('#npWizBody').inner_text()
        assert page.locator('.np-dsh-cell img').count() == 2, '传过的两张该有小缩略图'
        id0 = page.evaluate('_npWiz.shots.items[0].id')
        id1 = page.evaluate('_npWiz.shots.items[1].id')
        assets = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_assets');
            return (d.np_assets || []).filter(a => a && String(a.shotOf || '').indexOf('dsh1#') === 0).map(a => a.shotOf);
        }''')
        assert ('dsh1#' + id0) in assets and ('dsh1#' + id1) in assets, assets
        print('PASS ⑨: ⬆ 多选两张按顺序铺进空格——素材库记 shotOf 引用、格子上出缩略图、读数 已传 2/4')

        # ⑩ Ctrl+V：点第 3 格选中 → 合成粘贴事件 → 贴进选中那张
        page.locator('.np-dsh-cell[data-i="2"]').click()
        assert page.evaluate('_npDshSel') == 2
        b64 = base64.b64encode(pic['c'].read_bytes()).decode()
        clear_toasts(page)
        page.evaluate('''(b64) => {
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const file = new File([arr], 'pasted.png', { type: 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);
            const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(ev, 'clipboardData', { value: dt });
            document.dispatchEvent(ev);
        }''', b64)
        page.wait_for_function('() => (_npWiz.shots.items[2].imgs || []).length === 1')
        expect(page.locator('#popToastBox')).to_contain_text('第 3 张贴上了——还差 1 张')
        assert page.evaluate('_npDshSel') == -1
        print('PASS ⑩: 点某一格选中 → Ctrl+V 贴进它（第 3 张贴上了——还差 1 张，贴完取消选中）')

        # ⑪ 补最后一个空格 → 配图齐了（封面还没传，页脚仍报还缺封面）
        clear_toasts(page)
        page.set_input_files('.np-dsh-upmany', str(pic['d']))
        expect(page.locator('#popToastBox')).to_contain_text('传了 1 张——图齐了，页脚进预览看合成')
        page.wait_for_function('() => (_npWiz.shots.items[3].imgs || []).length === 1')
        assert '已传 4/4 · 封面缺' in page.locator('#npWizBody').inner_text()
        body = page.locator('#npWizBody').inner_text()
        assert '还缺 封面' in body, body[:900]
        expect(page.locator('#npWizNav')).to_contain_text('✓ 图齐了——进预览看合成')
        print('PASS ⑪: 补最后一格——四屏都有图（页脚仍报还缺封面：封面单独一格）')

        # ⑫ ⬆ 传封面：预览第一张就是它
        clear_toasts(page)
        page.set_input_files('.np-dsh-cv-file', str(pic['f']))
        expect(page.locator('#popToastBox')).to_contain_text('封面传好了（f.png）——预览第一张就是它')
        page.wait_for_function('() => ((_npWiz.shots.cv || {}).imgs || []).length === 1')
        assert '已传 4/4 · 封面 ✓' in page.locator('#npWizBody').inner_text()
        assert '✓ 图齐了——页脚进预览看合成' in page.locator('#npWizBody').inner_text()
        print('PASS ⑫: ⬆ 传封面——封面那一格出缩略图、读数变「封面 ✓」、页脚变「图齐了」')

        # ⑬ 点图看大图（顺带选中这张）；全满后再传＝换掉选中那张
        page.locator('.np-dsh-cell[data-i="0"]').click()
        page.wait_for_selector('.np-imgview-close')
        assert page.evaluate('_npDshSel') == 0
        page.locator('.np-imgview-close').click()
        page.wait_for_selector('.np-imgview-close', state='detached')
        clear_toasts(page)
        page.set_input_files('.np-dsh-upmany', str(pic['e']))
        expect(page.locator('#popToastBox')).to_contain_text('第 1 张换成新图了')
        page.wait_for_function('() => (_npWiz.shots.items[0].imgs || []).length === 2')
        print('PASS ⑬: 点小图开大图并选中；全满后再传＝换掉选中那张（imgs 叠成 2，旧图留在素材库）')

        # ⑭ 下一步 → ⑥ 预览：缺口归零、五张卡（封面＋四屏）、正文在
        page.locator('.np-dsh-next').click()
        page.wait_for_function('() => _npWiz.step === 6')
        body = page.locator('#npWizBody').inner_text()
        assert '✓ 这一套齐了：4 屏都有图，封面也有了。' in body, body[:600]
        assert '📄 正文（' in body, body[:900]
        assert page.locator('.np-img-view').count() == 5, '封面 ＋ 四屏共 5 张卡'
        assert page.locator('.np-dsh-cv-prompt').count() == 1
        print('PASS ⑭: ⑥ 预览——「4 屏都有图，封面也有了」＋封面/四屏 5 张合成卡＋正文')

        # ⑮ ✓ 完成回档案：状态自己走到「代发」、下一步变「👀 预览」
        clear_toasts(page)
        page.locator('.np-dsh-done').click()
        page.wait_for_selector('#noteArchiveContent .npar-stsel[data-id="dsh1"]')
        expect(page.locator('#noteArchiveContent .npar-stsel[data-id="dsh1"]')).to_have_value('代发')
        expect(page.locator('#popToastBox')).to_contain_text('这套齐了——到发布台到点自己发')
        nb = page.locator('.npar-next[data-id="dsh1"]')
        expect(nb).to_have_text('👀 预览')
        assert '图齐了——点开看看这一篇' in (nb.get_attribute('title') or '')
        print('PASS ⑮: ✓ 完成——档里自己标「代发」、播报「这套齐了」、档案下一步变「👀 预览」')

        # ⑯ 存档两本账：imgDocs 那一行（真源）＋条目级 shots 镜像（老读数照旧）
        entry = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_notes');
            return (d.np_notes || []).find(x => x && x.id === 'dsh1') || null;
        }''')
        assert entry['status'] == '代发' and entry['dOut'] == 'img'
        rows = entry.get('imgDocs') or []
        assert len(rows) == 1, rows
        sh = rows[0].get('shots') or {}
        its = sh.get('items') or []
        assert len(its) == 4, its
        assert sh.get('shotN') == 4, sh.get('shotN')
        assert 'cvTxt' not in sh and 'cvTxt' not in (sh.get('cv') or {}), sh.keys()
        assert [x.get('text') for x in its] == K4_POINTS, [x.get('text') for x in its]
        assert [len(x.get('imgs') or []) for x in its] == [2, 1, 1, 1], [x.get('imgs') for x in its]
        assert [x.get('topic') for x in its] == ['一排散热垫', LONGTOPIC_CUT, '铝合金支架', '窗边支架']
        assert len((sh.get('cv') or {}).get('imgs') or []) == 1, sh.get('cv')
        assert '一次出齐 4 张' in (sh.get('groupPrompt') or ''), (sh.get('groupPrompt') or '')[:200]
        mir = entry.get('shots') or {}
        assert len(mir.get('items') or []) == 4
        assert [len(x.get('imgs') or []) for x in (mir.get('items') or [])] == [2, 1, 1, 1]
        print('PASS ⑯: 存档两本账对得上——imgDocs 一行（4 屏 / 封面 1 张 / 张数 4 / 提示词）＋条目级镜像')

        # ⑰ 档案 👀 预览：图文的图（封面 ＋ 四屏 ＝ 5 张）
        page.evaluate('(e) => npArPreview(e, null)', entry)
        page.wait_for_selector('.npar-prev-mask')
        mask = page.locator('.npar-prev-mask').inner_text()
        assert '🖼 图文的图（5 张）' in mask, mask[:400]
        assert '🖼 图齐' in mask, mask[:300]
        page.locator('.npar-prev-close').click()
        page.wait_for_selector('.npar-prev-mask', state='detached')
        print('PASS ⑰: 档案 👀 预览——「🖼 图文的图（5 张）」＋图齐标')

        # ⑱ 重新打开：图齐＝直落 ⑥，原样读回、不再烧 AI；回 ⑤ 也不重切
        before = calls(sw)
        page.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_notes');
            const n = (d.np_notes || []).find(x => x && x.id === 'dsh1');
            npArOpenImg(n);
        }''')
        page.wait_for_function('() => _npWiz && _npWiz.arId === "dsh1" && _npWiz.step === 6')
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4')
        assert page.evaluate('_npWiz.shots.shotN') == 4
        assert page.evaluate('_npWiz.shots.items.map(x => (x.imgs || []).length).join("/")') == '2/1/1/1'
        assert page.evaluate('_npWiz.shots.groupPrompt') == (sh.get('groupPrompt') or '')
        page.wait_for_timeout(1200)
        assert calls(sw) == before, '图齐重进不许再烧 AI'
        page.locator('.np-dsh-back').click()
        page.wait_for_function('() => _npWiz.step === 5')
        assert page.locator('#npDshGroup').input_value() == (sh.get('groupPrompt') or '')
        page.wait_for_timeout(1200)
        assert calls(sw) == before, '回 ⑤ 已有分镜也不许重切'
        print('PASS ⑱: 重新打开直落 ⑥、原样读回（张数 / 图 / 提示词）；回 ⑤ 也不重切、不烧 AI')

        assert not errors, f'页面报错: {errors}'
        print('ALL PASS: check_note_dsh（⑤ 分镜确认 ＋ ⑥ 预览 现界面 18 节）')
    finally:
        ctx.close()
