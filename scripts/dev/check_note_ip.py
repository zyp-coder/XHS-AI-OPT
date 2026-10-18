# 五十二改自检（2026-10-13）：IP 玩法线首进扩展——档案「新建笔记」进线 → ① 挑组合 / ② AI 编故事 /
#   ④ 改稿（骨架段锁住、逐句改 / 整篇改）→ 出料走图文（挑重点 → 配文 → 整组提示词）→ 发布台「🆕 写好等排期」。
#   ⚠ IP 篇排期方式还没定：标「代发」后不做自动排位子，只提示去「📅 自己选位子」。
# 覆盖：档案入口四卡（IP 卡两行＋方向行）→ ①（IP 卡＋AI 配 5 套＋🔀 换一批 111 池 23 批＋🎲＋✍️ 自己配 37 主题×21 方式＋空态 toast）/
#      ②（进站自动编 3 段＋AI 契约＋🔀 再换＋✍️ 自己写一段空态）/
#      ④（简报行 / 风格行 / 🔒 骨架 banner / 锁行不挡手改 / 逐句改＋撤销 / 整篇改＋骨架补位 / 手改模式）/
#      出料（标「代发」→ 图文线 ⑤ 自动提炼 → ⑥⑦ 站点往返）＋档案落档（imgDocs[0].shots）/
#      发布台待排（🆕 写好等排期 ＋ 📅 自己选位子；存储无自动排位）/
#      复盘第三签「🎭 玩法效果」（账号平均 / 好用 / 该换 / 停 / 开跑 / 加频次 / 换玩法 / 开写新篇唤醒 IP 线）。
import json
import pathlib
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')  # GBK 控制台打 PASS 行里的 emoji 会炸

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'

PERSONA = '干防水十二年，专治老漏水'
LOCK0 = '这单防水摊开算：材料三千二，人工两千八，机器租金八百。'
TGT1 = '材料花了三千二，防水涂料两桶，配料四袋。'
T2 = '后来我自己开车去仓库拉的料，省了一趟运费。'
T3 = '这单收尾的时候，业主还问下次能不能还找我。'
DRAFT = LOCK0 + TGT1 + T2 + T3
SENT_FIX = '材料一共花了三千二。'
EXPECT1 = LOCK0 + SENT_FIX + T2 + T3
FULL_FIX = '改后的新正文，语气更顺。'
EXPECT_FULL = LOCK0 + FULL_FIX
HANDEDIT = LOCK0 + '手改后的第一句。手改后的第二句。手改后的第三句。'
DRAFT_TITLES = ['摊开算这单防水账', '这单活我摊开跟你算', '一单防水的账本']
DRAFT_TAGS = ['防水报价', '装修账本', '记录单']
LONGTOPIC = '一段特别长的配图主题要截断考'
LONGTOPIC_CUT = '一段特别长的配图主题要截'

# 手改后的正文里原样摘的 4 条重点（AI 不许改字）
K4_POINTS = [LOCK0, '手改后的第一句。', '手改后的第二句。', '手改后的第三句。']
K4 = {'分镜': [
    {'角色': '开场', '重点句': K4_POINTS[0], '画面描述': '画面：工地上摊着这单的几沓单据，手按在计算器上。这一张要让人看明白：这单的账摊开算。', '配图主题': '一单防水账'},
    {'角色': '', '重点句': K4_POINTS[1], '画面描述': '画面：墙角的料桶和工具排成一排。这一张要让人看清楚：料都用在了哪。', '配图主题': LONGTOPIC},
    {'角色': '细节', '重点句': K4_POINTS[2], '画面描述': '画面：仓库门口搬料上车。这一张要让人分出来：料是自己拉的。', '配图主题': '仓库搬料'},
    {'角色': '收束', '重点句': K4_POINTS[3], '画面描述': '画面：收尾的工地上，业主站在门口目送。这一张要让人落住：下次还找我。', '配图主题': '收尾工地'},
]}

# AI 桩：五条分支＝编故事 / 出整篇 / 逐句改 / 提炼重点 / 整篇改；每条都记调用数与最近一回的 prompt
MOCK_JS = '''async (m) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const config = await Storage.getConfig();
    config.ai.apiKey = 'test-local-only';
    config.imgLook = null;
    config.diagnosis = config.diagnosis || {};
    config.diagnosis.answers = [{ q: '用一句话介绍你自己', answer: m.persona }];
    await Storage.setConfig(config);
    self.testIpCalls = 0;
    self.testIpStoryN = 0;
    self.testIpLastSystem = '';
    self.testIpLastUser = '';
    const K4 = m.k4;
    AiClient.chatCompletion = async (cfg, system, user) => {
        self.testIpCalls++;
        self.testIpLastSystem = String(system || '');
        self.testIpLastUser = String(user || '');
        await new Promise(resolve => setTimeout(resolve, 400));
        const sys = String(system || '');
        const usr = String(user || '');
        if (sys.indexOf('IP 玩法编剧') >= 0) {
            self.testIpStoryN++;
            const N = self.testIpStoryN;
            const stories = [1, 2, 3].map((k, i) => ({
                '梗概': '第' + N + '批·第' + (i + 1) + '段事的梗概',
                '开头': '第' + N + '批·第' + (i + 1) + '段开头第一句',
                '标题': '第' + N + '批标题' + (i + 1),
                '备选': ['备选甲' + (i + 1), '备选乙' + (i + 1)]
            }));
            return { content: JSON.stringify({ '故事': stories }) };
        }
        if (usr.indexOf('【这段故事】') >= 0) {
            return { content: JSON.stringify({ content: m.draft, titles: m.titles, tags: m.tags }) };
        }
        if (usr.indexOf('【要点的那一句】') >= 0) {
            return { content: JSON.stringify({ sentence: m.sentFix }) };
        }
        if (sys.indexOf('图文笔记分镜师') >= 0) {
            return { content: JSON.stringify(K4) };
        }
        return { content: JSON.stringify({ content: m.fullFix }) };
    };
}'''

MOCK_ARG = {
    'persona': PERSONA, 'draft': DRAFT, 'titles': DRAFT_TITLES, 'tags': DRAFT_TAGS,
    'sentFix': SENT_FIX, 'k4': K4, 'fullFix': FULL_FIX,
}

# 玩法效果账的样本篇：A 组「出题纠错」3 条（💬30，跑 10/9/8 天）＝好用；B 组「猜价猜量」3 条（💬2，跑 4/4/3 天）＝该换；
# C 组无玩法标 3 条（💬2）＝只并进账号平均（9 篇平均 💬11.3）
SEED_NOTES_JS = '''async () => {
    const d = await chrome.storage.local.get(['np_notes', 'note_stats']);
    const list = Array.isArray(d.np_notes) ? d.np_notes : [];
    const stats = d.note_stats || {};
    const now = Date.now();
    const mk = (id, play, days, comments) => {
        const t = now - days * 86400000 - 3600000;
        list.push({
            id: id, createdAt: t, updatedAt: t, platform: 'xhs',
            title: '玩法账样本 ' + id, topic: '', people: [], sellPoints: [], kb: [],
            form: '图文', style: '', filmKind: '',
            draft: '样本文正文。', titles: [], tags: [], timeTip: '',
            visual: null, shots: null, imgDocs: null, filmDocs: null,
            voice: '', thumb: null, _sv: 2,
            dir: 'i', kOut: '', dOut: 'img',
            mind: null, voiceUrl: '', voiceError: null, dgenDocs: [], dgen: null, asm: null,
            wip: play ? { ipPlay: play } : {},
            status: '已发', statusAt: { '已发': t },
            url: 'https://www.xiaohongshu.com/explore/' + id,
        });
        stats[id] = { likes: 60, collects: 10, comments: comments, raw: '', fetchedAt: now - 3600000 };
    };
    mk('ipsta1', '出题纠错', 10, 30); mk('ipsta2', '出题纠错', 9, 30); mk('ipsta3', '出题纠错', 8, 30);
    mk('ipstb1', '猜价猜量', 4, 2); mk('ipstb2', '猜价猜量', 4, 2); mk('ipstb3', '猜价猜量', 3, 2);
    mk('ipstc1', '', 3, 2); mk('ipstc2', '', 3, 2); mk('ipstc3', '', 3, 2);
    await chrome.storage.local.set({ np_notes: list, note_stats: stats });
    return list.length;
}'''


def row_text(page, xpath):
    return page.locator('xpath=' + xpath).inner_text()


with tempfile.TemporaryDirectory(prefix='xhs-note-ip-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate(MOCK_JS, MOCK_ARG)
        sw.evaluate('''async () => {
            await chrome.storage.local.remove(['np_notes', 'note_queue', 'np_ip_play_acts', 'note_stats', 'np_assets', 'note_dgens']);
        }''')

        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda d: d.accept())
        page.set_default_timeout(20000)
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof _npWiz !== "undefined"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()

        def seed_persona():
            line = page.evaluate('''(persona) => {
                _diagState.unifiedAnswers = [{ q: '用一句话介绍你自己', answer: persona }];
                return _ntPersonaLine();
            }''', PERSONA)
            assert line == PERSONA, f'人设播种没生效: {line}'

        seed_persona()

        # ① 档案「新建笔记」：四卡弹层——🎭 IP 玩法 卡在第一位
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('.npar-new')
        page.locator('.npar-new').click()
        page.wait_for_selector('#dirModal.open')
        box = page.locator('#dirBox').inner_text()
        for t in ['这一篇按哪个组合做？——点一张卡直接开工', '🎭 IP玩法', '立人设：挑一招招牌，AI 编故事你挑',
                  'IP 玩法', '一条有梗、有人味的内容']:
            assert t in box, f'新建弹层缺「{t}」: {box[:500]}'

        # ② 点 IP 卡进线：① 挑组合站——IP 卡（人设一句话＋招牌）＋5 套组合（卡 0＝平替和消费降级 × 公开账本）
        page.locator('.np-dir-eff[data-direff="i|"]').click()
        page.wait_for_function('() => _npWiz && _npWiz.dir === "i" && _npWiz.step === 0 && _npIpCard && _npIpCard.line === "干防水十二年，专治老漏水"')
        body = page.locator('#npWizBody').inner_text()
        for t in ['🎭 你的账号 IP', PERSONA, '⭐ 招牌：', '猜价猜量', '🎯 AI 给你配好的组合', '✍️ 自己配']:
            assert t in body, f'① 挑组合站缺「{t}」: {body[:600]}'
        expect(page.locator('.np-ip-reip')).to_have_text('🔄 重出 IP')
        steps = page.locator('#npSteps').inner_text()
        for t in ['挑组合', 'AI 编故事', '改稿', '出料', '发布']:
            assert t in steps, f'IP 步骤条缺「{t}」: {steps}'
        assert page.locator('.np-ip-use').count() == 5
        card0 = page.locator('.np-ip-use').first.inner_text()
        for t in ['这两天好几个业主来问，便宜料到底能不能用', '平替和消费降级', '公开账本',
                  '把一单的收支摊开算——透明得让人服', '每月 1 条（数字要真）', '🔒 有骨架段', '就用这套 →']:
            assert t in card0, f'批次 0 第一张组合卡缺「{t}」: {card0}'
        page.locator('.np-ip-next').click()
        expect(page.locator('#popToastBox')).to_contain_text('上面点一套组合、或自己配一套——点了 AI 就按它编 3 段故事')
        assert sw.evaluate('self.testIpCalls') == 0
        print('PASS: archive dir-card enters the IP line — ① combo pane: IP card + persona + 5 combo cards (batch 0 = 平替和消费降级 × 公开账本)')

        # ③ 组合池巡检：111 套 / 23 批；🔀 换一批翻页；末批 1 套；回绕到批次 0
        pool = page.evaluate('() => [npIpComboPool().length, npIpBatchCount(), NP_IP_THEMES.reduce((n, g) => n + g.items.length, 0), NP_IP_THEMES.length]')
        assert pool == [111, 23, 37, 7], pool
        page.locator('.np-ip-swap').click()
        expect(page.locator('#popToastBox')).to_contain_text('换了一批组合——再看 5 套')
        assert page.evaluate('_npIp.batch') == 1
        card0 = page.locator('.np-ip-use').first.inner_text()
        for t in ['说好八千的活，结账变一万二——这种吐槽天天有', '报价刺客', '行业黑话解密']:
            assert t in card0, f'批次 1 第一张组合卡缺「{t}」: {card0}'
        page.evaluate('() => { _npIp.batch = npIpBatchCount() - 2; npWizRender(npActiveC()); }')
        page.wait_for_function('() => _npIp && _npIp.batch === npIpBatchCount() - 2')
        page.locator('.np-ip-swap').click()
        expect(page.locator('#popToastBox')).to_contain_text('换了一批组合——再看 1 套')
        assert page.locator('.np-ip-use').count() == 1
        page.locator('.np-ip-swap').click()
        expect(page.locator('#popToastBox')).to_contain_text('换了一批组合——再看 5 套')
        assert page.locator('.np-ip-use').count() == 5
        assert '平替和消费降级' in page.locator('.np-ip-use').first.inner_text()

        # ④ ✍️ 自己配：挑主题（37 个按 7 类）→ 挑方式（21 招）——空态 toast、预览句、回退重挑
        page.locator('.np-ip-selfopen').first.click()
        body = page.locator('#npWizBody').inner_text()
        for t in ['① 挑主题', '这篇讲什么——37 个主题按 7 类码好']:
            assert t in body, f'自己配主题页缺「{t}」: {body[:600]}'
        assert page.locator('.np-ip-theme').count() == 37
        page.locator('.np-ip-theme[data-g="0"][data-i="0"]').click()
        page.wait_for_selector('.np-ip-method')
        body = page.locator('#npWizBody').inner_text()
        for t in ['② 挑方式', '平替和消费降级', '挑一个方式——这行字就是这篇大概长什么样。']:
            assert t in body, f'自己配方式页缺「{t}」: {body[:600]}'
        assert page.locator('.np-ip-method').count() == 21
        page.locator('.np-ip-selfconfirm').click()
        expect(page.locator('#popToastBox')).to_contain_text('先挑一个方式——这行字就是这篇大概长什么样')
        page.locator('.np-ip-method[data-m="选边投票"]').click()
        page.wait_for_function('() => document.querySelectorAll(".np-ip-method[data-m=\\"选边投票\\"]").length === 1')
        assert '这篇大概长这样：这两天好几个业主来问，便宜料到底能不能用，抛个争论让大家站队。' in page.locator('#npWizBody').inner_text()
        page.locator('.np-ip-themeback').click()
        page.wait_for_function('() => document.querySelectorAll(".np-ip-theme").length === 37')
        page.locator('.np-ip-selfopen').first.click()
        page.wait_for_function('() => document.querySelectorAll(".np-ip-theme").length === 0')
        assert sw.evaluate('self.testIpCalls') == 0
        print('PASS: ① self-pair path — 111-combo pool / 23 batches / last batch holds 1 / self-pair 37 themes × 21 methods with empty-state toast')

        # ⑤ 点卡 0 进 ② 编故事：自动编 3 段——契约、UI、卡片
        seed_persona()
        page.locator('.np-ip-use[data-i="0"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('就用这套「平替和消费降级 × 公开账本」——AI 正按它编故事')
        page.wait_for_function('() => _npWiz.step === 1 && (_npWiz.ipStories || []).length === 3 && !_npIpStoryBusy && _npWiz.ipStories[0].t === "第1批·第1段事的梗概"')
        body = page.locator('#npWizBody').inner_text()
        for t in ['🎭 平替和消费降级 × 公开账本', '把一单的收支摊开算——透明得让人服', '节奏 每月 1 条（数字要真）',
                  '📌 账目照真实单据写——AI 编的账别当账报。', '编了 3 段（梗概＋开头第一句）',
                  '第 1 段', '第1批·第1段事的梗概', '开头先这样写：', '第1批·第1段开头第一句', '✍️ 用这段，出稿 →']:
            assert t in body, f'② 编故事站缺「{t}」: {body[:700]}'
        assert page.locator('.np-ip-pick').count() == 3
        sys_tx = sw.evaluate('self.testIpLastSystem')
        for t in ['你是一名小红书账号的「IP 玩法编剧」：账号主做（人设：干防水十二年，专治老漏水）。按指定的玩法方式，编 3 段能拿来发笔记的「故事底子」。',
                  '这一招的规矩：把一单的收支摊开算——透明得让人服',
                  '发布节奏：每月 1 条（数字要真）。',
                  '写的时候注意：账目照真实单据写——AI 编的账别当账报。',
                  '{"故事":[{"梗概"']:
            assert t in sys_tx, f'编故事 system 缺「{t}」: {sys_tx[:500]}'
        user_tx = sw.evaluate('self.testIpLastUser')
        for t in ['【账号人设】干防水十二年，专治老漏水',
                  '【这一段的主题】平替和消费降级（这两天好几个业主来问，便宜料到底能不能用）',
                  '【这次用的方式】公开账本',
                  '【方式怎么玩】把一单的收支摊开算——透明得让人服']:
            assert t in user_tx, f'编故事 user 缺「{t}」: {user_tx[:500]}'
        assert sw.evaluate('self.testIpCalls') == 1
        print('PASS: ② story station auto-writes 3 candidates — header/hint/cards on screen, AI contract carries persona/theme/method/how/rhythm/hint')

        # ⑥ 🔀 再换 3 段（第二批）＋ ✍️ 自己写一段空态（不烧 AI）
        page.locator('.np-ip-reroll').click()
        expect(page.locator('#popToastBox')).to_contain_text('又编了一批——挑一段')
        page.wait_for_function('() => (_npWiz.ipStories || []).length === 3 && !_npIpStoryBusy && _npWiz.ipStories[0].t === "第2批·第1段事的梗概"')
        page.locator('#npWizNav .np-ip-selftoggle').click()
        page.wait_for_selector('.np-ip-useself')
        page.locator('.np-ip-useself').click()
        expect(page.locator('#popToastBox')).to_contain_text('先把你那段写两句——一句话也行，AI 顺着写')
        assert sw.evaluate('self.testIpCalls') == 2
        page.locator('#npWizNav .np-ip-selftoggle').click()
        page.wait_for_function('() => document.querySelectorAll(".np-ip-useself").length === 0')
        print('PASS: reroll drafts a fresh batch (no extra UI burn); self-write empty guard toasts and stays on the house')

        # ⑦ ✍️ 用这段，出稿：AI 出整篇（60~150 字口径＋骨架说明＋标签池）→ ④ 改稿站
        seed_persona()
        page.locator('.np-ip-pick[data-i="0"]').click()
        page.wait_for_function('() => _npWiz.step === 4 && _npWiz.draft && _npWiz.draft.content === ' + json.dumps(DRAFT))
        page.wait_for_function('() => { const el = document.getElementById("npDraftStatus"); return !!el && el.textContent.indexOf("✅") === 0; }')
        assert '✅ 就用这段——AI 按「平替和消费降级 × 公开账本」的调子把整篇写出来了，进改稿' in page.locator('#npDraftStatus').inner_text()
        body = page.locator('#npWizBody').inner_text()
        for t in ['🎯 主题', '平替和消费降级', '🎭 方式', '公开账本', '⏱ 节奏', '每月 1 条（数字要真）',
                  '🎭 平替和消费降级 × 公开账本 · D 人设型 · AI 按这套的调子直出 · 📝 字数 60~150',
                  '🔒 账目数字是骨架——AI 改稿不碰；发布前照真实单据核一遍。']:
            assert t in body, f'④ 改稿站缺「{t}」: {body[:800]}'
        expect(page.locator('#npWizBody .np-ip-backstory')).to_have_text('↩ 换一段故事')
        expect(page.locator('#npWizBody .np-ip-rewrite')).to_have_text('🔄 再出一版')
        assert page.locator('.np-ip-lock').count() == 1
        lock = page.locator('.np-ip-lock').first
        assert lock.inner_text().strip() == '🔒 ' + LOCK0
        assert lock.get_attribute('title') == '骨架段：AI 改稿不碰；手改可以'
        assert page.locator('.np-sent-row').count() == 3
        sys_tx = sw.evaluate('self.testIpLastSystem')
        for t in ['你是一名小红书账号的写手：账号主做（人设：干防水十二年，专治老漏水）。把下面这段「故事底子」写成一篇完整的小红书笔记正文。',
                  '★ 这一招有骨架段：账目数字是骨架——AI 改稿不碰；发布前照真实单据核一遍。——这一处必须原样出现在正文里、就放在开头这一带的原位',
                  '1) 开头第一句用给出的「开头第一句」原文起步，一个字都别改；']:
            assert t in sys_tx, f'出稿 system 缺「{t}」: {sys_tx[:500]}'
        user_tx = sw.evaluate('self.testIpLastUser')
        for t in ['【这段故事】梗概：第2批·第1段事的梗概\n开头第一句：第2批·第1段开头第一句',
                  '【标签池】防水报价、装修账本',
                  '【骨架段说明】账目数字是骨架——AI 改稿不碰；发布前照真实单据核一遍。']:
            assert t in user_tx, f'出稿 user 缺「{t}」: {user_tx[:500]}'
        assert sw.evaluate('self.testIpCalls') == 3
        print('PASS: picking a story drafts the full note — status line, brief/style rows, 🔒 banner + lock row (not a clickable 逐句 row), contract carries story/tagSeed/lock')

        # ⑧ 🔒 骨架段点一下只提示（手改走「✍️ 全文手改」），AI 一发都不烧
        page.locator('.np-ip-lock').first.click()
        expect(page.locator('#popToastBox')).to_contain_text('🔒 骨架段——AI 改稿不碰它；想改点右上「✍️ 全文手改」')
        assert sw.evaluate('self.testIpCalls') == 3
        print('PASS: lock row click only hints — AI sentence tool refuses to touch it')

        # ⑨ 逐句改：点第 2 句 → 填要求 → 改这句（骨架原位保住；只改那一句的契约）
        page.locator('.np-sent-row[data-i="1"]').click()
        page.wait_for_selector('.np-sent-go')
        page.fill('#npSentAsk', '短一半，别绕')
        page.locator('.np-sent-go').click()
        page.wait_for_function('() => _npWiz.draft && _npWiz.draft.content === ' + json.dumps(EXPECT1))
        expect(page.locator('#npSentMsg')).to_contain_text('✅ 这句换好了')
        assert page.locator('.np-rv-undo').first.is_visible(), '逐句改完 ↩ 那颗要亮出来（不满意能整篇退回）'
        sys_tx = sw.evaluate('self.testIpLastSystem')
        for t in ['★ 这是一篇「IP 玩法」稿（主题「平替和消费降级」× 方式「公开账本」）',
                  '通篇不出现任何承接——不写微信/小程序/公众号/加V/链接/二维码/电话，也不提主页或私信']:
            assert t in sys_tx, f'逐句改 system 缺「{t}」: {sys_tx[:500]}'
        assert '标了骨架的段一个字都不许动' not in sys_tx
        user_tx = sw.evaluate('self.testIpLastUser')
        assert '【整篇正文（只当上下文，别重写）】\n' + DRAFT in user_tx, user_tx[:400]
        assert '【要点的那一句】' + TGT1 in user_tx, user_tx[:400]
        assert '【这次要怎么改】短一半，别绕' in user_tx, user_tx[:400]
        assert sw.evaluate('self.testIpCalls') == 4
        print('PASS: sentence revision changes only that one sentence — lock untouched, IP-line contract (no CTA words) rides along')

        # ⑩ 整篇改：点常用改法 → AI 回来没抄骨架 → 原位补回（keepGuard）；↩ 改回上一版
        page.locator('.np-rv-chip[data-ask="更口语一点"]').click()
        page.wait_for_function('() => _npWiz.draft && _npWiz.draft.content === ' + json.dumps(EXPECT_FULL))
        page.wait_for_function('() => { const u = document.querySelector(".np-rv-undo"); return !!u && !u.hidden; }')
        # 整篇改成功后那句提示已清空（改稿站收口：不铺长句），「不满意可退回」由 ↩ 那颗按钮承载
        assert page.locator('#npReviseMsg').inner_text() == '', page.locator('#npReviseMsg').inner_text()
        assert page.locator('.np-rv-undo').first.is_visible(), '整篇改完 ↩ 那颗要亮出来'
        sys_tx = sw.evaluate('self.testIpLastSystem')
        assert '标了骨架的段一个字都不许动' in sys_tx, sys_tx[:500]
        assert '「' + LOCK0 + '」' in sys_tx, sys_tx[:500]
        assert sw.evaluate('self.testIpCalls') == 5
        page.locator('.np-rv-undo').click()
        page.wait_for_function('() => _npWiz.draft && _npWiz.draft.content === ' + json.dumps(EXPECT1))
        expect(page.locator('#npReviseMsg')).to_contain_text('已改回上一版')
        print('PASS: full revision protects the lock (keepGuard re-splices it verbatim) and undo restores the previous version')

        # ⑪ ✍️ 全文手改：手改不受锁限制；切回逐句后重新拆句（锁 1 ＋ 可改 3）
        page.locator('.np-draft-mode').click()
        page.wait_for_selector('#npResult')
        page.fill('#npResult', HANDEDIT)
        page.locator('.np-draft-mode').click()
        page.wait_for_function('() => _npWiz.draft && _npWiz.draft.content === ' + json.dumps(HANDEDIT))
        assert page.locator('.np-ip-lock').count() == 1
        assert page.locator('.np-sent-row').count() == 3
        assert sw.evaluate('self.testIpCalls') == 5
        print('PASS: hand-edit mode frees the lock — after switching back the sentence view re-splits (1 locked + 3 editable)')

        # ⑫ 出料：点「🖼 出图文」＝标「代发」进图文线 ⑤——自动提炼 4 条重点；IP 篇不排位子只提示
        page.locator('.np-ip-toout').click()
        page.wait_for_function('() => _npWiz.step === 8')
        body = page.locator('#npWizBody').inner_text()
        for t in ['🎭 平替和消费降级 × 公开账本 · 出料', '🖼 出图文', '出一套卡图']:
            assert t in body, f'出料站缺「{t}」: {body[:600]}'
        expect(page.locator('#npWizNav')).to_contain_text('点这张卡＝标「代发」并进「造图片」')
        page.locator('.np-ip-fin').click()
        page.wait_for_function('''() => {
            const t = document.getElementById('popToastBox');
            if (!t) return false;
            const s = t.innerText;
            return s.indexOf('标成「代发」了——出料走图文') >= 0 && s.indexOf('是 🎭 玩法篇') >= 0;
        }''')
        page.wait_for_function('() => _npWiz.step === 5')
        page.wait_for_function('''() => {
            const b = document.getElementById('npWizBody');
            const n = document.getElementById('npWizNav');
            return !!b && b.innerText.includes('AI 正在从正文里提炼重点句') && b.innerText.includes('自动跑一版，不用点')
                && !!n && n.innerText.includes('AI 正在从正文里提炼重点——等它提炼好');
        }''')
        page.wait_for_function('() => (_npWiz.shots.items || []).length === 4 && !_npDshBusy')
        body = page.locator('#npWizBody').inner_text()
        assert '✓ 这一套挑了 4 条重点' in body, body[:600]
        assert '兼封面' in body and '画面怎么摆 AI 按句自己配' in body, body[:600]
        points = page.evaluate('_npWiz.shots.items.map(x => x.point).join("|")')
        assert points == '|'.join(K4_POINTS), points
        roles = page.evaluate('_npWiz.shots.items.map(x => x.role).join("/")')
        assert roles == '开场/展开/细节/收束', roles
        assert page.evaluate('_npWiz.shots.items[1].topic') == LONGTOPIC_CUT
        assert page.locator('.np-dsh-point').count() == 4
        gv = page.evaluate('_npWiz.shots.groupPrompt')
        for t in ('一组 4 张小红书图文配图（手机随拍；暗调实拍·单一暖光源，真人工作场景）',
                  '第 1 张（画面主角：一单防水账）：',
                  '「摊开算这单防水账」（大字一句＋承接两三行，连起来读是一句完整的话；这是封面，字再做大一点、留白足）。',
                  '第 2 张（画面主角：一段特别长的配图主题要截）：',
                  '第 1 张兼做封面（它和其余几张风格要连得上）。⚠ 以上是这一套 4 张的说明：一张一张出，顺序不要乱。'):
            assert t in gv, f'整组提示词缺「{t}」: {gv[:500]}'
        user_tx = sw.evaluate('self.testIpLastUser')
        assert '【标题】摊开算这单防水账' in user_tx and '【正文】\n' + HANDEDIT in user_tx, user_tx[:300]
        assert '【这篇算】知识 / 干货（宁少勿多约 4~6 条重点）' in user_tx, user_tx[:300]
        assert '【转法那句】' not in user_tx, user_tx[:300]  # IP 线不带走料那句
        expect(page.locator('#popToastBox')).to_contain_text('提炼好了 4 条重点')
        expect(page.locator('#popToastBox')).to_contain_text('AI 自己定的，知识 / 干货料型')
        entry = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_notes');
            const list = Array.isArray(d.np_notes) ? d.np_notes : [];
            const n = list.filter(x => x && x.dir === 'i' && x.status === '代发')[0] || null;
            if (!n) return null;
            const sh = (n.imgDocs && n.imgDocs[0] && n.imgDocs[0].shots && n.imgDocs[0].shots.items) || null;
            return { id: n.id, title: n.title, dOut: n.dOut, draft: String(n.draft || ''),
                     ipPlay: (n.wip && n.wip.ipPlay) || '', step: (n.wip && n.wip.step) || 0,
                     pts: sh ? sh.map(x => x.point) : null };
        }''')
        assert entry and entry['title'] == '摊开算这单防水账' and entry['dOut'] == 'img', entry
        assert entry['draft'] == HANDEDIT and entry['ipPlay'] == '公开账本' and entry['step'] == 5, entry
        assert entry['pts'] == K4_POINTS, entry
        ip_note_id = entry['id']
        assert sw.evaluate('self.testIpCalls') == 6
        print('PASS: 出料走图文 —「代发」+ ⑤ auto-extracts 4 points (verbatim sentences, topic cut, group prompt), archive row keeps shots & draft')

        # ⑬ ⑤ → ⑥ 配文 → ⑦ 整组提示词 → 回退（零 AI）
        page.locator('.np-dsh-next').click()
        page.wait_for_function('() => _npWiz.step === 6')
        expect(page.locator('#popToastBox')).to_contain_text('进 ✍️ 配文')
        page.locator('.np-dsh-togo').click()
        page.wait_for_function('() => _npWiz.step === 7')
        expect(page.locator('#popToastBox')).to_contain_text('进 📋 整组提示词')
        page.locator('.np-dsh-back2').click()
        page.wait_for_function('() => _npWiz.step === 6')
        page.locator('.np-dsh-back').click()
        page.wait_for_function('() => _npWiz.step === 5')
        assert sw.evaluate('self.testIpCalls') == 6
        print('PASS: the img line stations ⑤→⑥→⑦ and back walk through without any AI burn')

        # ⑭ 发布台：IP 篇待在「🆕 写好等排期」（🎭 IP玩法 标 ＋ 两颗钮）；存储里没有被自动排进位子
        page.evaluate('() => switchMainTab("noteQueue")')
        page.wait_for_selector('.npq-pendrow')
        body = page.locator('#noteQueueContent').inner_text()
        for t in ['🆕 写好等排期', '摊开算这单防水账', '🎭 IP玩法']:
            assert t in body, f'发布台待排区缺「{t}」: {body[:800]}'
        row = page.locator('.npq-pendrow').first
        expect(row.locator('[data-np="npq-autoplace"]')).to_have_text('🎯 排进空位')
        expect(row.locator('[data-np="npq-slotpick"]')).to_have_text('📅 自己选位子')
        queued = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('note_queue');
            const q = d.note_queue || {};
            return Object.keys(q).reduce((acc, k) => acc.concat(q[k] || []), []);
        }''')
        assert ip_note_id not in queued, '排期方式还没定——IP 篇不该被自动排进位子'
        print('PASS: 发布台 pending area —「🎭 IP玩法」note waits in「🆕 写好等排期」(no auto slot, per the undecided scheduling rule)')

        # ⑮ 复盘第三签「🎭 玩法效果」：空态（还没抓过主页的数）
        page.evaluate('() => switchMainTab("noteReview")')
        page.evaluate('() => npAuditGo("play")')
        page.wait_for_function('() => { const p = document.getElementById("auditPlayPane"); return !!p && p.innerText.includes("玩法效果 —— 哪招带评论、哪招该换"); }')
        pane = page.locator('#auditPlayPane').inner_text()
        assert '还没抓过主页的数——先去「📈 已发复盘」页抓一次（点赞 / 收藏 / 评论都是抓主页时顺带读的），这页才算得出账。' in pane, pane[:500]
        assert page.locator('.np-pl-start').count() == 21
        assert '还没发过的玩法' in pane and '挑一个开写' in pane, pane[:500]
        print('PASS: play tab empty state — points to the snapshot flow and lists all 21 idle plays')

        # ⑯ 播种 9 篇已发（A 组好用 / B 组该换 / C 组无标）：账号平均、两行账、结论
        assert sw.evaluate(SEED_NOTES_JS) >= 10
        page.evaluate('() => npAuditPlayPaint()')
        page.wait_for_function('() => { const p = document.getElementById("auditPlayPane"); return !!p && p.innerText.includes("就着 9 篇已发"); }')
        pane = page.locator('#auditPlayPane').inner_text()
        for t in ['账号平均：就着 9 篇已发（玩法篇 + 平常篇一起算）', '平均 💬11.3 评', '👍60 赞']:
            assert t in pane, f'玩法效果账缺「{t}」: {pane[:800]}'
        rowA = row_text(page, '//button[contains(@class,"np-pl-boost") and @data-n="出题纠错"]/ancestor::div[contains(@style,"margin-bottom:8px")][1]')
        for t in ['跑了 10 天', '💬30 评', '2.65×', '✅ 好用，主推']:
            assert t in rowA, f'「出题纠错」行缺「{t}」: {rowA}'
        rowB = row_text(page, '//button[contains(@class,"np-pl-stop") and @data-n="猜价猜量"]/ancestor::div[contains(@style,"margin-bottom:8px")][1]')
        for t in ['跑了 4 天', '💬2 评', '0.18×', '⚠ 该换一个']:
            assert t in rowB, f'「猜价猜量」行缺「{t}」: {rowB}'
        assert '💡 玩法结论：最带得动评论的是「出题纠错」——平均 💬30，是账号平均的 2.65 倍，主推它、可以加频次；「猜价猜量」只有账号平均的 0.18 倍——别再加更了，换一个试试。' in pane, pane[:900]
        print('PASS: 9 sent notes pile into the account average —「出题纠错」2.65× 好用 /「猜价猜量」0.18× 该换, with both actions attached')

        # ⑰ 停 / 开跑 / 加频次：动作只记本机账（np_ip_play_acts），页面记号跟着走
        page.locator('.np-pl-stop[data-n="猜价猜量"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('「猜价猜量」先停了——这页记上，挑组合时别挑它')
        page.wait_for_function('() => document.getElementById("auditPlayPane").innerText.includes("⏸ 已停")')
        pane = page.locator('#auditPlayPane').inner_text()
        assert '最带得动评论的是「出题纠错」' in pane and '换一个试试' not in pane, pane[:900]
        page.locator('.np-pl-stop[data-n="猜价猜量"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('「猜价猜量」重新开跑了——下一条照常排')
        page.wait_for_function('() => !document.getElementById("auditPlayPane").innerText.includes("⏸ 已停")')
        page.locator('.np-pl-boost[data-n="出题纠错"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('给「出题纠错」加了频次——这页记上，写稿时这类多排一条')
        page.wait_for_function('() => { const p = document.getElementById("auditPlayPane"); return p.innerText.includes("📈 已加频次") && document.querySelectorAll(".np-pl-boost").length === 0; }')
        print('PASS: stop / restart / boost — toasts fire and the pane re-marks (⏸ 已停 toggles, 📈 已加频次 locks the button)')

        # ⑱ 换玩法：面板 3 个接位 → 选「选边投票」＝停旧开新（只记本机）＋空玩法卡挂「🔁 从「猜价猜量」换过来」
        page.locator('.np-pl-swapopen[data-n="猜价猜量"]').click()
        page.wait_for_selector('.np-pl-swap')
        assert page.locator('.np-pl-swap').count() == 3
        swaps = page.locator('.np-pl-swap')
        assert swaps.first.get_attribute('data-n') == '选边投票', swaps.first.get_attribute('data-n')
        assert '选边投票' in swaps.first.inner_text() and '抛一个同行天天吵的问题，两派自己来站队' in swaps.first.inner_text()
        swaps.first.click()
        expect(page.locator('#popToastBox')).to_contain_text('「猜价猜量」停了，接上「选边投票」——去「🎭 IP 玩法」发新的一条，它就从 0 起跑')
        page.wait_for_function('() => { const p = document.getElementById("auditPlayPane"); const b = p.querySelector(".np-pl-start[data-n=\\"选边投票\\"]"); return !!b && b.innerText.includes("🔁 从「猜价猜量」换过来"); }')
        assert page.locator('.np-pl-start').count() == 19
        acts = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('np_ip_play_acts');
            return d.np_ip_play_acts || null;
        }''')
        assert acts == {'stopped': ['猜价猜量'], 'boosted': ['出题纠错'], 'swapTo': {'猜价猜量': '选边投票'}}, acts
        print('PASS: swap panel offers 3 successors — picking one stops the old play, records it locally, and tags the new play card')

        # ⑲ 从空玩法卡开写新篇：按这招配对味主题（报价刺客）直接落到 ② 编故事站
        page.locator('.np-pl-start[data-n="选边投票"]').click()
        expect(page.locator('#popToastBox')).to_contain_text('开了新的一篇「选边投票」——AI 这就按这招编 3 段故事，稍等')
        page.wait_for_function('() => _npWiz && _npWiz.dir === "i" && _npWiz.step === 1 && _npWiz.ipPlay === "选边投票" && _npWiz.ipTheme === "报价刺客" && (_npWiz.ipStories || []).length === 3 && !_npIpStoryBusy && _npWiz.ipStories[0].t === "第3批·第1段事的梗概"')
        body = page.locator('#npWizBody').inner_text()
        for t in ['🎭 报价刺客 × 选边投票', '抛一个同行天天吵的问题，两派自己来站队', '节奏 每周 1~2 条']:
            assert t in body, f'唤醒的编故事站缺「{t}」: {body[:600]}'
        assert '📌' not in body, body[:600]
        sys_tx = sw.evaluate('self.testIpLastSystem')
        assert '写的时候注意' not in sys_tx, sys_tx[:400]
        user_tx = sw.evaluate('self.testIpLastUser')
        assert '【这一段的主题】报价刺客（说好八千的活，结账变一万二——这种吐槽天天有）' in user_tx, user_tx[:400]
        assert sw.evaluate('self.testIpCalls') == 7
        print('PASS: play-tab「开写新篇」 wakes the IP line — new note lands straight on ② with a matching theme (报价刺客 × 选边投票)')

        # ⑳ 回 ① ＋ 🎲：让 AI 拍板也从批次 0 里挑一套并开编（第 4 批）
        page.locator('.np-ip-backcombo').click()
        page.wait_for_function('() => _npWiz.step === 0 && document.querySelectorAll(".np-ip-use").length === 5')
        assert '平替和消费降级' in page.locator('.np-ip-use').first.inner_text()
        page.locator('.np-ip-dice').click()
        expect(page.locator('#popToastBox')).to_contain_text('🎲 让 AI 拍板了——')
        page.wait_for_function('() => (_npWiz.ipStories || []).length === 3 && !_npIpStoryBusy && _npWiz.ipStories[0].t === "第4批·第1段事的梗概"')
        assert page.evaluate('_npWiz.ipPlay') in ['公开账本', '测评对比', '省钱攻略', '避坑指南', '选边投票']
        assert sw.evaluate('self.testIpCalls') == 8
        assert sw.evaluate('self.testIpStoryN') == 4
        print('PASS: 🎲 picks from the current batch and starts writing — 8 AI calls / 4 story batches total, exactly as planned')

        assert not errors, f'页面报错: {errors}'
        print('ALL PASS: check_note_ip（五十二改 IP 玩法线首进扩展：挑组合→编故事→改稿锁骨架→出料走图文→发布台待排＋玩法效果账）')
    finally:
        ctx.close()
