# 五十一改自检（2026-10-12）：引流图文线六站重排——挑稿 → 改稿 → 🎯 挑重点 → ✍️ 配文 → 📋 整组提示词 → 发布。
#   ① 原 ⑤「本机压字 / 配图文字」整块撤掉：字不再本地压图，改由「把字写进生图提示词、AI 连字带图一起出」；
#   ②（承接三十→四十九改：造图片并进写稿流 / 四十四改整组提示词 / 四十八改传图与张数档 / 四十九改配文并站）——
#   ③ 重点句＝AI 从正文原文里摘（一个字不许改），新增 📐 挑几条（3/4/5/6/8 ＋ AI 自己定）；
#   ④ 句子行上直接改（改句＝本地按句重拼画面描述＋整组提示词）、✕ 删掉不要的；
#   ⑤ cvTxt 老字段迁移（老档案封面字 → items[0].text，落到档里不再出现 cvTxt）。
# 覆盖：档案「下一步」→ 直落 ⑤ 挑重点站 / 进站自动提炼（忙态卡不用点）＋新配置行（📐 挑几条 ＋ ↻ 换一组，无生成钮、无配文方式排）/
#       AI 契约（宁少勿多约 4~6 条；指定条数＝「正好 N 条」）＋角色兜底＋配图主题截断＋重点句原样照抄 /
#       句子上直接改（画面描述与整组提示词跟着重拼）＋ ✕ 删一条 / 点档位按新条数重提炼 / 换流派＝本地重拼零 AI /
#       批量传图进素材库（shotOf 引用）＋ 粘贴进选中格 ＋ 全满＝选中换图 / ⑥ 配文方式四档＋每张配文当场改（第 1 张＝标题默认）/
#       ⑦ 整组提示词＋传图口＋每张格子（封面标） / 存好回档案（「代发」、图齐）＋预览（封面标＋图上字说明；缺图引用也占格）/
#       cvTxt 迁移纯测 / 重进分镜原样（不重提炼、不再烧 AI）＋重来一组（故事线重切·角色兜底链）
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

# 重点句＝正文原文里原样摘的 4 句（AI 不许改字）
K4_POINTS = [
    '我前前后后换过七个，踩的坑一个比一个贵。',
    '后来又买过带冰袋的，刚开始凉，半个小时就回温，还得擦水。',
    '第三种是架高的铝合金，散热一般，但打字角度是真舒服。',
    '如果你也想给本子找个能装包里的散热支架，主页有我自己在用的那款。',
]
# 知识线：4 条重点。第 2 条角色留空（考兜底「展开」）、配图主题 14 字（考截断到 12）
K4 = {'分镜': [
    {'角色': '开场', '重点句': K4_POINTS[0], '画面描述': '画面：桌面上摊着七个旧散热垫，一个比一个灰。这一张要让人看明白：踩坑踩了一串。', '配图主题': '一排散热垫'},
    {'角色': '', '重点句': K4_POINTS[1], '画面描述': '画面：抽屉里躺着带冰袋的旧垫子，边上还有一圈水渍。这一张要让人看清楚：凉得快也回得快。', '配图主题': LONGTOPIC},
    {'角色': '细节', '重点句': K4_POINTS[2], '画面描述': '画面：铝合金支架垫在本子底下，打字的手搭在键盘上。这一张要让人分出来：角度舒服。', '配图主题': '铝合金支架'},
    {'角色': '收束', '重点句': K4_POINTS[3], '画面描述': '画面：拼装支架放在窗边，晨光照在卡扣上。这一张要让人落住：主页有同款。', '配图主题': '窗边支架'},
]}

# 故事线：7 条重点。第 2/4/6 条角色留空（考位置兜底链 展开/对照/细节）
S7 = {'分镜': [
    {'角色': '开场', '重点句': '我们家两个孩子都上网课，两台本子并排跑，桌面上一放就挤成一团。', '画面描述': '画面：桌上并排两台笔记本挤成一团。这一张要让人看明白：桌面太挤。', '配图主题': '挤桌面'},
    {'角色': '', '重点句': '第一个是那种大风扇直吹的，风是够大，可我的笔记本底部是整块塑料，根本吃不上风。', '画面描述': '画面：一箱没拆的散热垫堆在墙角。这一张要让人看清楚：买过一箱都没用。', '配图主题': '一箱散热垫'},
    {'角色': '转折', '重点句': '于是我自己动手改了一个能拼装的支架，风速三挡可调', '画面描述': '画面：手把拼装支架的卡扣按合。这一张要让人看明白：自己动手改。', '配图主题': '卡扣按合'},
    {'角色': '', '重点句': '底座能拆开塞进书包，上周带出去开会，放在小桌板上也稳。', '画面描述': '画面：支架折起来塞进书包侧袋。这一张要让人分出来：能装包。', '配图主题': '塞进书包'},
    {'角色': '对照', '重点句': '装的时候不用拧螺丝，卡扣一按就合。', '画面描述': '画面：小桌板上的支架稳稳架着本子，旁边是会议牌。这一张要让人看清楚：出门也稳。', '配图主题': '小桌板'},
    {'角色': '', '重点句': '知道吧，很多人买电脑散热垫都是随手搜一个销量高的就下单。', '画面描述': '画面：手机屏幕上滑过一排销量榜。这一张要让人分出来：随手买容易踩坑。', '配图主题': '销量榜'},
    {'角色': '收束', '重点句': '如果你也想给本子找个能装包里的散热支架，主页有我自己在用的那款。', '画面描述': '画面：支架放在窗边，晨光照在卡扣上。这一张要让人落住：主页有同款。', '配图主题': '窗边支架'},
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
        'status': '代发', 'statusAt': {'代发': now},
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


with tempfile.TemporaryDirectory(prefix='xhs-note-dsh-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate('''async () => {
            await Storage.initializeDefaults(DEFAULT_PROMPTS);
            await ensureTenantInit();
            const config = await Storage.getConfig();
            config.ai.apiKey = 'test-local-only';
            config.product.name = '分镜测试产品';
            config.imgLook = null;
            await Storage.setConfig(config);
            self.testDshCalls = 0;
            self.testDshMode = 'k';
            self.testDshLastSystem = '';
            self.testDshLastUser = '';
            const K4 = %s;
            const S7 = %s;
            AiClient.chatCompletion = async (cfg, system, user) => {
                self.testDshCalls++;
                self.testDshLastSystem = String(system || '');
                self.testDshLastUser = String(user || '');
                await new Promise(resolve => setTimeout(resolve, 400));
                return { content: JSON.stringify(self.testDshMode === 's' ? S7 : K4) };
            };
        }''' % (json.dumps(K4, ensure_ascii=False), json.dumps(S7, ensure_ascii=False)))
        sw.evaluate('''async (entry) => {
            await chrome.storage.local.set({ np_notes: [entry] });
            await chrome.storage.local.remove(['np_assets', 'note_dgens']);
        }''', seed_note())

        png1 = png(pathlib.Path(profile) / 'shot1.png')
        png2 = png(pathlib.Path(profile) / 'shot2.png', rgb=(88, 150, 210))

        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda d: d.accept())
        page.set_default_timeout(20000)
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof _npWiz !== "undefined"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()

        # ① 档案「下一步」：没挑过重点＝「✏️ 编辑」，title 指去挑重点（img 线，还没图所以不带「还缺」）
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('.npar-next[data-id="dsh1"]')
        nb1 = page.locator('.npar-next[data-id="dsh1"]')
        expect(nb1).to_have_text('✏️ 编辑')
        tip1 = nb1.get_attribute('title') or ''
        assert '接着出这套：挑重点 → 配文 → 整组提示词' in tip1 and '还缺' not in tip1, tip1
        print('PASS: archive next-step reads 编辑 and the tip points to 挑重点 → 配文 → 整组提示词')

        # ② 点「下一步」直落 ⑤ 🎯 挑重点站：六站条＋出图页不出现
        nb1.click()
        page.wait_for_function('() => _npWiz && _npWiz.step === 5 && _npWiz.dOut === "img"')
        assert page.evaluate('_npWiz.path') == 'image'
        steps = page.locator('#npSteps').inner_text()
        for t in ['挑稿', '改稿', '🎯 挑重点', '✍️ 配文', '📋 整组提示词', '发布']:
            assert t in steps, f'六站条缺「{t}」: {steps}'
        assert '🎬 分镜出词' not in steps, steps
        assert page.locator('#noteOutputContent').is_hidden()
        print('PASS: archive jump lands on the 6-station img line inside the wizard (挑稿→改稿→挑重点→配文→整组提示词→发布)')

        # ③ 进站自动提炼（忙态卡自己到、不用点任何钮）＋新配置行（无生成钮、无配文方式排）
        page.wait_for_function('''() => {
            const b = document.getElementById("npWizBody");
            const n = document.getElementById('npWizNav');
            return !!b && b.innerText.includes("AI 正在从正文里提炼重点句") && b.innerText.includes("自动跑一版，不用点")
                && !!n && n.innerText.includes("AI 正在从正文里提炼重点——等它提炼好");
        }''')
        assert page.locator('.np-dsh-gen').count() == 0, '生成钮该撤了——进站就自动跑'
        assert page.locator('.np-dsh-cap').count() == 0, '配文方式那排只在 ⑥——⑤ 里不该有'
        assert page.locator('.np-dsh-motif').count() == 0, '换流派那颗在 ⑦——⑤ 里不该有'
        assert page.locator('.np-dsh-n').count() == 6, '挑几条＝3/4/5/6/8 ＋ AI 自己定'
        assert page.locator('.np-dsh-n[data-k="0"]').count() == 1
        assert page.locator('.np-dsh-again').count() == 1
        body = page.locator('#npWizBody').inner_text()
        for t in ['🎯 挑重点', '一条重点＝后面一张图，第 1 条兼封面', '📐 挑几条',
                  'AI 自己定＝看内容挑、宁少勿多（约 4~6 条；这篇算「知识 / 干货」）',
                  '句子上直接改，不要的 ✕ 删掉']:
            assert t in body, f'⑤ 配置行缺「{t}」: {body[:500]}'
        assert '配文方式' not in body, body[:500]
        print('PASS: entering the station auto-extracts (busy card on its own); 📐 挑几条 in, 配文方式/换流派 out')

        # ④ 自动那一发落地：4 条重点——句子照抄、角色兜底、主题截断、本地拼整组提示词、AI 契约
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4 && !_npDshBusy')
        assert page.locator('.np-dsh-point').count() == 4
        assert page.locator('.np-dsh-pdel').count() == 4
        assert page.locator('#npDshGroup').count() == 0, '整组提示词格只在 ⑦'
        assert page.locator('.np-dsh-upmany').count() == 0, '传图口只在 ⑦'
        assert page.locator('.np-dsh-cell').count() == 0, '每张格子只在 ⑦'
        body = page.locator('#npWizBody').inner_text()
        assert '✓ 这一套挑了 4 条重点' in body, body[:500]
        assert '兼封面' in body and '画面怎么摆 AI 按句自己配' in body, body[:500]
        points = page.evaluate('_npWiz.shots.items.map(x => x.point).join("|")')
        assert points == '|'.join(K4_POINTS), points
        roles = page.evaluate('_npWiz.shots.items.map(x => x.role).join("/")')
        assert roles == '开场/展开/细节/收束', roles
        assert page.evaluate('_npWiz.shots.items[1].topic') == LONGTOPIC_CUT
        assert page.evaluate('_npWiz.shots.shotN') == 0
        assert page.evaluate('typeof _npWiz.shots.cvTxt') == 'undefined', 'cvTxt 老字段该没了'
        assert page.evaluate('_npWiz.shots.items[0].text') == '', '图上字没配过＝空——第 1 条兼封面跟标题走'
        gv = page.evaluate('_npWiz.shots.groupPrompt')
        for t in ('一组 4 张小红书图文配图（手机随拍；暗调实拍·单一暖光源，真人工作场景）',
                  '第 1 张（画面主角：一排散热垫）：',
                  '图上直接把字排好：「散热垫换了七个」（大字一句＋承接两三行，连起来读是一句完整的话；这是封面，字再做大一点、留白足）。',
                  '第 2 张（画面主角：一段特别长的配图主题要截）：',
                  '每张都照上面标的字写进图里——字要清楚、不许错字，不要加别的字。',
                  '第 1 张兼做封面（它和其余几张风格要连得上）。⚠ 以上是这一套 4 张的说明：一张一张出，顺序不要乱。'):
            assert t in gv, f'整组提示词缺「{t}」: {gv[:400]}'
        # 2026-10-18 老板「复制整组出去的图还是没随拍味」：硬约束从前只加在逐张那一份上，
        # 整组这条非空就优先——所以这条自己也得钉住「一次只交一张」＋随拍那七条。
        assert gv.count('一次只交一张完整画面') == 1, '整组那条开头得钉住一次只交一张：%s' % gv[:200]
        assert gv.count('手机随拍必须照做') == 1, '整组那条得带随拍硬约束：%s' % gv[-200:]
        sys_tx = sw.evaluate('self.testDshLastSystem')
        for t in ('你是一名图文笔记分镜师', '把一篇正文剪成一条「重点线」', '宁少勿多（约 4~6 条',
                  '绝对不许按字数均分', '一个字都不许改'):
            assert t in sys_tx, f'AI 提示词缺「{t}」: {sys_tx[:400]}'
        assert '这一套正好' not in sys_tx, sys_tx[:400]
        user_tx = sw.evaluate('self.testDshLastUser')
        assert '【标题】散热垫换了七个' in user_tx and '【正文】' in user_tx, user_tx[:300]
        assert '【这篇算】知识 / 干货（宁少勿多约 4~6 条重点）' in user_tx, user_tx[:300]
        assert '【转法那句】' + TURN in user_tx, user_tx[:300]
        assert sw.evaluate('self.testDshCalls') == 1
        expect(page.locator('#popToastBox')).to_contain_text('提炼好了 4 条重点')
        expect(page.locator('#popToastBox')).to_contain_text('AI 自己定的，知识 / 干货料型')
        expect(page.locator('#npWizNav')).to_contain_text('改完 / 删完 = 这套图就定了——下一步去配文')
        print('PASS: auto-extraction lands 4 points — verbatim 重点句, role fallback, topic sliced, group prompt assembled, AI contract right')

        # ⑤ 句子上直接改：画面描述与整组提示词跟着重拼（零 AI）
        page.fill('.np-dsh-point[data-i="1"]', '改过的第二条重点')
        page.wait_for_function('() => _npWiz.shots.items[1].point === "改过的第二条重点"')
        desc = page.evaluate('_npWiz.shots.items[1].desc')
        assert '这一张要证明：改过的第二条重点。' in desc, desc
        assert '「改过的第二条重点」' in page.evaluate('_npWiz.shots.groupPrompt')
        assert sw.evaluate('self.testDshCalls') == 1
        print('PASS: editing a point rewrites its 画面描述 and the group prompt locally (zero AI)')

        # ⑥ ✕ 删一条：剩 3 条，整组提示词跟着重拼（零 AI）
        page.locator('.np-dsh-pdel[data-i="2"]').click()
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 3')
        points = page.evaluate('_npWiz.shots.items.map(x => x.point).join("|")')
        assert points == K4_POINTS[0] + '|改过的第二条重点|' + K4_POINTS[3], points
        expect(page.locator('#popToastBox')).to_contain_text('还剩 3 条')
        assert '一组 3 张小红书图文配图' in page.evaluate('_npWiz.shots.groupPrompt')
        assert sw.evaluate('self.testDshCalls') == 1
        print('PASS: ✕ removes a point — 3 left, group prompt re-assembled locally')

        # ⑦ 📐 挑几条：点「5 条」＝按新条数重提炼一版（AI 契约改成「正好 5 条」）
        page.locator('.np-dsh-n[data-k="5"]').click()
        page.wait_for_function('() => _npWiz.shots.shotN === 5')
        page.wait_for_function('() => document.getElementById("npWizBody").innerText.includes("按「5 条」重新提炼一版")')
        page.wait_for_function('() => !_npDshBusy && (_npWiz.shots.items || []).length === 4')
        sys_tx = sw.evaluate('self.testDshLastSystem')
        assert '这一套正好 5 条——一条不多、一条不少' in sys_tx and '宁少勿多' not in sys_tx, sys_tx[:400]
        user_tx = sw.evaluate('self.testDshLastUser')
        assert '【这篇算】知识 / 干货（正好 5 条重点）' in user_tx, user_tx[:300]
        assert sw.evaluate('self.testDshCalls') == 2
        expect(page.locator('#popToastBox')).to_contain_text('提炼好了 4 条重点（你定的条数')
        print('PASS: the 挑几条 chip re-extracts on the spot — busy card reads 按「5 条」重新提炼一版, AI contract carries 正好 5 条')

        # ⑧ 去 ⑥ ✍️ 配文站：配文方式四档＋每张一格（第 1 张＝标题默认、带「封面」标）
        page.locator('.np-dsh-next').click()
        page.wait_for_function('() => _npWiz.step === 6')
        expect(page.locator('#popToastBox')).to_contain_text('进 ✍️ 配文')
        body = page.locator('#npWizBody').inner_text()
        assert '现在是「说一次」——大字一句＋承接两三行，连起来读是一句完整的话' in body, body[:500]
        assert page.locator('.np-dsh-cap').count() == 4, '配文方式四档＝说一次 / 辅助标注 / 整段上屏 / 只一句大字'
        assert page.locator('.np-dsh-captext').count() == 4
        assert page.locator('#npDshCw0').count() == 0 and page.locator('#npDshCw3').count() == 0, '本机压字那块该撤了'
        ph0 = page.locator('.np-dsh-captext[data-i="0"]').get_attribute('placeholder') or ''
        assert '不给就按标题「散热垫换了七个」走——想换就改这里' in ph0, ph0
        ph1 = page.locator('.np-dsh-captext[data-i="1"]').get_attribute('placeholder') or ''
        assert '不给就按上面那条重点走——想换就改这里' in ph1, ph1
        assert '第 1 张（兼封面）' in body and '重点：' + K4_POINTS[0] in body, body[:600]
        expect(page.locator('#npWizNav')).to_contain_text('改的全是「字」——写进提示词，AI 连字带图一起出')
        expect(page.locator('#npWizNav')).to_contain_text('📋 去整组提示词 →')
        print('PASS: ⑥ 配文站 — four caption chips + per-shot caption boxes (第 1 张 follows the title), no local compositing block')

        # ⑨ ⑥ 换配文方式：辅助标注 → 整组提示词随档重拼（零 AI）＋ 每张配文当场改
        page.locator('.np-dsh-cap[data-k="label"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('配文方式换成「辅助标注」')
        assert '引线标注' in page.evaluate('_npWiz.shots.groupPrompt')
        page.fill('.np-dsh-captext[data-i="1"]', '改过的第二屏字')
        page.wait_for_function('() => _npWiz.shots.items[1].text === "改过的第二屏字"')
        page.fill('.np-dsh-captext[data-i="0"]', '大标题换了')
        page.wait_for_function('() => _npWiz.shots.items[0].text === "大标题换了"')
        assert sw.evaluate('self.testDshCalls') == 2
        gv = page.evaluate('_npWiz.shots.groupPrompt')
        assert '「大标题换了」（大字一句＋2~4 条引线标注，每条绑一个画面里的东西；这是封面，字再做大一点、留白足）。' in gv, gv[:500]
        assert '「改过的第二屏字」（大字一句＋2~4 条引线标注，每条绑一个画面里的东西）。' in gv, gv[:500]
        print('PASS: caption chip rewrites the group prompt; per-shot caption edits land in items[].text (zero AI)')

        # ⑩ 去 ⑦ 📋 整组提示词站：格子里一串文本＋换流派四颗＋传图口＋每张的格子
        page.locator('.np-dsh-togo').click()
        page.wait_for_function('() => _npWiz.step === 7')
        expect(page.locator('#popToastBox')).to_contain_text('进 📋 整组提示词')
        assert page.locator('#npDshGroup').input_value() == page.evaluate('_npWiz.shots.groupPrompt')
        assert page.locator('.np-dsh-gcopy').count() == 1
        assert page.locator('.np-dsh-motif').count() == 4, '换流派＝跟账号默认＋三个流派'
        assert page.locator('.np-dsh-motif[data-k="方案页"]').count() == 1
        assert page.locator('.np-dsh-motif[data-k=""]').count() == 1
        assert page.locator('.np-dsh-upmany').count() == 1
        assert page.locator('.np-dsh-cell').count() == 4
        body = page.locator('#npWizBody').inner_text()
        assert '已传 0/4' in body, body[:500]
        expect(page.locator('#npWizNav')).to_contain_text('还差 4 张图——整组提示词复制去生成；图回来「⬆ 传图」多选一次传，或直接 Ctrl+V 贴')
        expect(page.locator('#npWizNav')).to_contain_text('← 回配文')
        t0 = page.locator('.np-dsh-cell[data-i="0"]').first.get_attribute('title') or ''
        assert '（封面）' in t0 and '还空着' in t0, t0
        print('PASS: ⑦ 整组提示词站 — group text box + motif chips + upload mouth + per-shot cells (封面 tag, 还空着)')

        # ⑪ 换流派：选「方案页」→ 整组提示词重拼；点「跟账号默认」→ 清掉回真人工作场景（零 AI）
        page.locator('.np-dsh-motif[data-k="方案页"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('这一套按「方案页」摆画面——整组提示词重拼了')
        assert page.evaluate('(_npWiz.shots.look || {}).motif') == '方案页'
        assert '，方案页）' in page.locator('#npDshGroup').input_value()
        page.fill('#npDshGroup', '手改的一条整组提示词')
        page.wait_for_function('() => _npWiz.shots.groupPrompt === "手改的一条整组提示词"')
        page.locator('.np-dsh-motif[data-k=""]').click()
        expect(page.locator('#popToastBox')).to_contain_text('跟账号默认走了')
        assert not page.evaluate('(_npWiz.shots.look || {}).motif')
        assert '，真人工作场景）' in page.evaluate('_npWiz.shots.groupPrompt')
        assert sw.evaluate('self.testDshCalls') == 2
        print('PASS: motif chips re-assemble the group prompt locally; edits to the text box stick; 跟账号默认 clears the suite motif')

        # ⑫ ⬆ 传图（可多选）：两颗文件按顺序铺进空格 → 进素材库（shotOf 引用）＋缩略图＋计数
        page.set_input_files('.np-dsh-upmany', [str(png1), str(png2)])
        expect(page.locator('#popToastBox')).to_contain_text('传了 2 张——还差 2 张')
        page.wait_for_function('() => (_npWiz.shots.items[0].imgs || []).length === 1 && (_npWiz.shots.items[1].imgs || []).length === 1')
        assert '已传 2/4' in page.locator('#npWizBody').inner_text()
        assert page.locator('.np-dsh-cell img').count() == 2, '传过的那两张该有小缩略图'
        id0 = page.evaluate('_npWiz.shots.items[0].id')
        id1 = page.evaluate('_npWiz.shots.items[1].id')
        assets = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_assets');
            return (d.np_assets || []).filter(a => a && String(a.shotOf || '').indexOf('dsh1#') === 0).map(a => a.shotOf);
        }''')
        assert ('dsh1#' + id0) in assets and ('dsh1#' + id1) in assets, assets
        print('PASS: ⬆ 传图（可多选）lays files into the empty slots — refs in the asset lib, thumbs + 已传 2/4 on screen')

        # ⑬ 粘贴：点第 3 张选中 → Ctrl+V（合成 clipboard 事件）贴上 → 进选中那张
        page.locator('.np-dsh-cell[data-i="2"]').click()
        assert page.evaluate('_npDshSel') == 2
        b64 = base64.b64encode(png1.read_bytes()).decode()
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
        print('PASS: Ctrl+V pastes into the selected cell — 第 3 张贴上了——还差 1 张')

        # ⑭ 补最后一个空格 → 齐了；全满后再传＝选中那张换图
        page.set_input_files('.np-dsh-upmany', str(png2))
        expect(page.locator('#popToastBox')).to_contain_text('传了 1 张——图齐了——「✓ 存好，回档案」')
        page.wait_for_function('() => (_npWiz.shots.items[3].imgs || []).length === 1')
        expect(page.locator('#npWizNav')).to_contain_text('✓ 图齐了——存好就回档案；传错点图换')
        page.locator('.np-dsh-cell[data-i="0"]').click()
        page.set_input_files('.np-dsh-upmany', str(png1))
        expect(page.locator('#popToastBox')).to_contain_text('第 1 张换成新图了')
        page.wait_for_function('() => (_npWiz.shots.items[0].imgs || []).length === 2')
        print('PASS: last slot fills in one shot; once all full, a file goes onto the selected cell as a replace')

        # ⑮ 存好回档案：标「代发」、图齐——到档里看两本账（imgDocs 一轮 ＋ top-level shots 镜像）
        page.locator('.np-dsh-done').click()
        page.wait_for_selector('#noteArchiveContent .npar-stsel[data-id="dsh1"]')
        expect(page.locator('#noteArchiveContent .npar-stsel[data-id="dsh1"]')).to_have_value('代发')
        expect(page.locator('#popToastBox')).to_contain_text('这套齐了——到发布台到点自己发')
        nb = page.locator('.npar-next[data-id="dsh1"]')
        expect(nb).to_have_text('👀 预览')
        tip2 = nb.get_attribute('title') or ''
        assert '图齐了——点开看看这一篇' in tip2, tip2
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
        assert sh.get('shotN') == 5, sh.get('shotN')
        assert (sh.get('look') or {}).get('cap') == 'label', sh.get('look')
        assert not (sh.get('look') or {}).get('motif'), sh.get('look')
        assert 'cvTxt' not in sh, sh.keys()
        assert [x.get('text') for x in its] == ['大标题换了', '改过的第二屏字', '', ''], [x.get('text') for x in its]
        assert [x.get('point') for x in its] == K4_POINTS, [x.get('point') for x in its]
        assert [len(x.get('imgs') or []) for x in its] == [2, 1, 1, 1], [x.get('imgs') for x in its]
        assert [len(x.get('imgs') or []) for x in (entry['shots']['items'] or [])] == [2, 1, 1, 1], entry['shots']['items']
        print('PASS: 存好 marks 代发 with all 4 images in — texts / points / image refs ride into the archive, cvTxt gone')

        # ⑯ 档案「👀 预览」：这一套图（4 张）＋封面标＋图上字说明；缺图引用也占格
        page.evaluate('(e) => npArPreview(e, null)', entry)
        page.wait_for_selector('.npar-prev-mask')
        mask = page.locator('.npar-prev-mask').inner_text()
        assert '🖼 这一套图（4 张 · 图上字是出图时 AI 写上去的）' in mask, mask[:400]
        assert '第 1 张 · 封面' in mask and '第 4 张' in mask, mask[:400]
        assert '老档案里传过的' not in mask, mask[:400]
        assert page.locator('.npar-prev-mask [style*="center/cover"]').count() == 4
        page.locator('.npar-prev-close').click()
        entry['shots']['items'][3]['imgs'] = ['__missing__']
        entry['imgDocs'][0]['shots']['items'][3]['imgs'] = ['__missing__']
        page.evaluate('(e) => npArPreview(e, null)', entry)
        page.wait_for_selector('.npar-prev-mask')
        mask = page.locator('.npar-prev-mask').inner_text()
        assert '🖼 这一套图（4 张 · 图上字是出图时 AI 写上去的）' in mask, mask[:400]
        assert page.locator('.npar-prev-mask [style*="center/cover"]').count() == 3
        page.locator('.npar-prev-close').click()
        print('PASS: 🖼 预览 lists all 4 with the cover tag; a dangling image ref still takes its slot')

        # ⑰ cvTxt 迁移纯测：老字段 → items[0].text（已有 text 的不覆盖）
        mig = page.evaluate('''() => {
            const s1 = npShotsShape({ cvTxt: '老封面字', items: [{ id: 'a', point: 'p1' }] });
            const s2 = npShotsShape({ cvTxt: '旧值', items: [{ id: 'a', point: 'p1', text: '新封面字' }] });
            return {
                t1: (s1.items[0] || {}).text || '', has1: Object.prototype.hasOwnProperty.call(s1.items[0] || {}, 'cvTxt'),
                t2: (s2.items[0] || {}).text || '',
            };
        }''')
        assert mig['t1'] == '老封面字' and not mig['has1'], mig
        assert mig['t2'] == '新封面字', mig
        print('PASS: cvTxt migrates into items[0].text (existing text wins) and the old key is gone')

        # ⑱ 重进：挑重点原样在（不重提炼、不再烧 AI）；配文读回；再来一组（故事线重切）
        calls = sw.evaluate('self.testDshCalls')
        page.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_notes');
            const entry = (d.np_notes || []).find(x => x && x.id === 'dsh1');
            [2, 3].forEach(i => {
                if (entry.shots && entry.shots.items && entry.shots.items[i]) entry.shots.items[i].imgs = [];
                if (entry.imgDocs && entry.imgDocs[0] && entry.imgDocs[0].shots && entry.imgDocs[0].shots.items[i]) entry.imgDocs[0].shots.items[i].imgs = [];
            });
            entry.updatedAt = Date.now();
            await chrome.storage.local.set({ np_notes: [entry] });
        }''')
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('.npar-next[data-id="dsh1"]')
        nb2 = page.locator('.npar-next[data-id="dsh1"]')
        expect(nb2).to_have_text('✏️ 编辑')
        tip3 = nb2.get_attribute('title') or ''
        assert '接着出这套：挑重点 → 配文 → 整组提示词' in tip3 and '还缺 2 张' in tip3, tip3
        nb2.click()
        page.wait_for_function('() => _npWiz && _npWiz.step === 7 && _npWiz.dOut === "img"')
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4')
        page.wait_for_timeout(900)
        assert sw.evaluate('self.testDshCalls') == calls, '重进不该再烧 AI'
        page.locator('.np-dsh-back2').click()
        page.wait_for_function('() => _npWiz.step === 6')
        assert page.locator('.np-dsh-captext[data-i="0"]').input_value() == '大标题换了'
        assert page.locator('.np-dsh-captext[data-i="1"]').input_value() == '改过的第二屏字'
        page.locator('.np-dsh-back').click()
        page.wait_for_function('() => _npWiz.step === 5')
        points = page.evaluate('_npWiz.shots.items.map(x => x.point).join("|")')
        assert points == '|'.join(K4_POINTS), points
        page.evaluate('() => { _npWiz.drainPick.line = "情绪故事"; }')
        sw.evaluate('self.testDshMode = "s"')
        page.locator('.np-dsh-again').click()
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 7 && !_npDshBusy')
        roles = page.evaluate('_npWiz.shots.items.map(x => x.role).join("/")')
        assert roles == '开场/展开/转折/对照/对照/细节/收束', roles
        sys_tx = sw.evaluate('self.testDshLastSystem')
        assert '这一套正好 5 条' in sys_tx, sys_tx[:400]
        user_tx = sw.evaluate('self.testDshLastUser')
        assert '【这篇算】故事 / 情绪（正好 5 条重点）' in user_tx, user_tx[:300]
        assert sw.evaluate('self.testDshCalls') == calls + 1
        assert page.evaluate('_npWiz.shots.items[0].text') == ''
        print('PASS: reopened station reuses the saved points without re-extracting — 再点一轮 re-extracts 7 with the story line')

        assert not errors, f'页面报错: {errors}'
        print('ALL PASS: check_note_dsh（五十一改 图文线六站重排＋撤本机压字）')
    finally:
        ctx.close()
