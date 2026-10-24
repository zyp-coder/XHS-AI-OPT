# 三十一改自检：引流视频线「🎬 文案直出视频」——分镜出词并进写稿流
# 四十四改（2026-10-12）：拆段出词 → 排全片分镜、照豆包 15 秒切条（小条并入相邻条）；断言按新形状
# 覆盖：档案「下一步」两态（✏️ 编辑→🎬 成片预览，方向细节在 title）/ 五站条 / 七十三改：AI 排几个分镜就照几个走（段数长短不卡）/
#       照 15 秒切条＋≤5 秒小条并入（优先并前一条）/ 提示词硬约束兜底（缺了就补尾）＋拆分/并入交代 /
#       角色按位置兜底 / 转法句透传 / ⬆ 传回来回写 / 音色落档 /
#       拼片软守门（没传齐弹提示）/ 真拼片落 filmDocs＋xhsFilmDocs＋标「代发」/ 改稿后 src 对不上自动重排 / note_dgens 纯文本索引
import json
import pathlib
import shutil
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright
from _guide_gate import goto_big

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
DRAFT2 = DRAFT1.replace('我前前后后换过七个', '我前前后后换过八个')

# 第一版：AI 排 4 段＝台面 4 个分镜（七十三改：不并段不压段）；第 1 段提示词带旧硬约束（考换成新收尾那句、并把 AI 写的秒数抹掉）；第 2 段角色留空（考兜底）、且只有 5 秒（考并进前一条）；第 3 段提示词整段空（考通用词）
P4 = {
    '重点': [
        {'句': '随手下单踩坑多', '为什么': '先勾住同样纠结的人'},
        {'句': '三种散热方案都不行', '为什么': '讲料的主体'},
        {'句': '自己改的可拼装支架', '为什么': '转到讲述人的做法'},
        {'句': '能装包里也稳当', '为什么': '收束引主页'},
    ],
    '段': [
        {'角色': '开场钩子', '原文': '知道吧，很多人买电脑散热垫都是随手搜一个销量高的就下单。',
         '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：桌面上三四个没拆的包装盒。镜头：从虚到实缓缓推近。'},
        {'角色': '', '原文': '我前前后后换过七个，踩的坑一个比一个贵。',
         '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：手把散热垫翻过来看底部。'},
        {'角色': '把料讲完', '原文': '第一个是那种大风扇直吹的，风是够大，可我的笔记本底部是整块塑料，根本吃不上风。',
         '提示词': ''},
        {'角色': '收束引主页', '原文': '如果你也想给本子找个能装包里的散热支架，主页有我自己在用的那款。',
         '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：支架折起来放进书包侧袋。镜头：缓慢拉远定格。不要出现人脸口型；画面里不要出现任何文字。'},
    ],
}
P3 = {
    '重点': [
        {'句': '随手下单踩坑多', '为什么': '先勾住同样纠结的人'},
        {'句': '自己改的可拼装支架', '为什么': '转到讲述人的做法'},
        {'句': '能装包里也稳当', '为什么': '收束引主页'},
    ],
    '段': [
        {'角色': '开场钩子', '原文': '知道吧，很多人买电脑散热垫都是随手搜一个销量高的就下单。',
         '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：桌面上没拆的包装盒。镜头：从虚到实缓缓推近。不要出现人脸口型；画面里不要出现任何文字。'},
        {'角色': '转折到你这行', '原文': '于是我自己动手改了一个能拼装的支架，风速三挡可调，底座能拆开塞进书包。',
         '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：手把支架卡扣按合。镜头：横移过半，从生活场擦到作业场。不要出现人脸口型；画面里不要出现任何文字。'},
        {'角色': '收束引主页', '原文': '如果你也想给本子找个能装包里的散热支架，主页有我自己在用的那款。',
         '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：支架放进书包侧袋。镜头：缓慢拉远定格。不要出现人脸口型；画面里不要出现任何文字。'},
    ],
}

def seed_note():
    now = 1759000000000
    return {
        'id': 'ndv1', 'createdAt': now, 'updatedAt': now, 'platform': 'xhs',
        'title': '散热垫换了七个', 'topic': '', 'people': [], 'sellPoints': [], 'kb': [],
        'form': '视频', 'style': '口播讲解', 'filmKind': '',
        'draft': DRAFT1, 'titles': ['散热垫换了七个'], 'tags': ['散热'], 'timeTip': '',
        'visual': None, 'shots': None, 'imgDocs': None, 'filmDocs': None,
        'voice': DRAFT1, 'thumb': None, '_sv': 2,
        'dir': 'd', 'kOut': '', 'dOut': 'film',
        'mind': None, 'voiceUrl': '', 'voiceError': None, 'dgenDocs': [], 'dgen': None, 'asm': None,
        'wip': {'step': 4, 'path': 'video', 'noteStyle': {}, 'write': None, 'planItem': None,
                'drainPick': {'cat': '踩坑', 'title': '散热垫换了七个', 'line': '避坑经验', 'turn': TURN, 'body': DRAFT1}},
        'status': '代发', 'statusAt': {'代发': now},
    }

with tempfile.TemporaryDirectory(prefix='xhs-note-dv-') as tmp, sync_playwright() as p:
    seg_dir = pathlib.Path(tmp) / 'segs'
    seg_dir.mkdir()
    ctx = p.chromium.launch_persistent_context(
        str(pathlib.Path(tmp) / 'profile'), headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate('''async () => {
            await Storage.initializeDefaults(DEFAULT_PROMPTS);
            await ensureTenantInit();
            const config = await Storage.getConfig();
            config.ai.apiKey = 'test-local-only';
            config.product.name = '拆段测试产品';
            await Storage.setConfig(config);
            self.testDvCalls = 0;
            self.testDvMode = 'p4';
            self.testDvLastSystem = '';
            self.testDvLastUser = '';
            const P4 = %s;
            const P3 = %s;
            AiClient.chatCompletion = async (cfg, system, user) => {
                self.testDvCalls++;
                self.testDvLastSystem = String(system || '');
                self.testDvLastUser = String(user || '');
                await new Promise(resolve => setTimeout(resolve, 500));
                return { content: JSON.stringify(self.testDvMode === 'p3' ? P3 : P4) };
            };
        }''' % (json.dumps(P4, ensure_ascii=False), json.dumps(P3, ensure_ascii=False)))
        sw.evaluate('async () => { try { await chrome.storage.local.remove("np_notes"); } catch(_) {} }')
        sw.evaluate('''async (entry) => {
            await chrome.storage.local.set({ np_notes: [entry] });
            await chrome.storage.local.remove('note_dgens');
        }''', seed_note())

        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof _npWiz !== "undefined"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()

        # ① 档案「下一步」：排过分镜之前＝「✏️ 编辑」（title 指去分镜出词）
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('.npar-next[data-id="ndv1"]')
        nb1 = page.locator('.npar-next[data-id="ndv1"]')
        expect(nb1).to_have_text('✏️ 编辑')
        assert '照讲到哪儿切到哪儿排成分镜' in (nb1.get_attribute('title') or ''), nb1.get_attribute('title')
        print('PASS: archive next-step reads 编辑 before splitting (title points to the dv station)')

        # ② 点「下一步」直落写稿⑤站：五站条 + 自动排分镜（等待条→生成条表）
        page.locator('.npar-next[data-id="ndv1"]').click()
        page.wait_for_function('() => _npWiz && _npWiz.step === 5 && _npWiz.dOut === "film"')
        steps = page.locator('#npSteps').inner_text()
        for t in ['挑稿', '改稿', '🎬 分镜出词', '拼片配音', '发布']:
            assert t in steps, f'五站条缺「{t}」: {steps}'
        print('PASS: archive jump lands on the 5-station film line and the station bar shows all five')

        page.wait_for_selector('#npDvWait')
        page.wait_for_selector('.np-dv-prompt')
        page.wait_for_function('() => document.querySelectorAll(".np-dv-prompt").length === 3')

        # ③ AI 契约：先标重点按重点数定分镜 / 转法句透传 / 照 15 秒切条＋小条并入 / 提示词硬约束兜底 / 角色按位置兜底
        assert page.evaluate('_npWiz.dgen.points.length') == 4, '重点没按 AI 给的 4 个落档（七十三改：上限放到 6）'
        sys_tx = sw.evaluate('self.testDvLastSystem')
        assert '绝对不许按字数均分' in sys_tx and '分镜几个你自己定' in sys_tx and '同一个场' in sys_tx, '拆段口径没进系统提示（段数交回 AI／同一个场）'
        user_tx = sw.evaluate('self.testDvLastUser')
        assert '【转法那句】' in user_tx and TURN in user_tx, '转法句没透传给 AI'
        assert page.evaluate('_npWiz.dgen.shots.length') == 4, 'AI 排的 4 段没收成 4 个分镜'
        assert page.evaluate('_npWiz.dgen.segs.length') == 3, '4 个分镜没照 15 秒切成 3 条'
        assert page.evaluate('_npWiz.dgen.segs[1].role') == '把料讲完', '角色空值时没按位置兜底'
        assert page.evaluate('_npWiz.dgen.total') == 28, '全片时长没按 4.6 字/秒估'
        assert page.evaluate('_npWiz.dgen.segs.map(s => s.secs).join("/")') == '11.5/9/7.5', '切条时长不对'
        assert page.evaluate('JSON.stringify(_npWiz.dgen.segs[0].ab)') == '[1]', '5 秒的小条没并进前一条'
        prompts = page.eval_on_selector_all('.np-dv-prompt', 'els => els.map(e => e.value)')
        for i, v in enumerate(prompts):
            assert '不要出现人脸口型' in v and '能被读出来的整句话' in v, f'第 {i+1} 条提示词缺新收尾那句: {v}'
            assert '时长' not in v, f'第 {i+1} 条提示词还写着时长（七十三改：不卡几秒，AI 写的也抹掉）: {v}'
        assert '时长 5 秒左右' not in prompts[0] and '第 2 个分镜并进来一起拍' in prompts[0], 'AI 写的秒数没抹掉或并入注没拼进第 1 条'
        assert prompts[1].startswith('竖屏 9:16') and '同一个地方、同一双手' in prompts[1], '空提示词没兜出「同一个场」那版通用词'
        assert '缓慢拉远定格' in prompts[2]
        print('PASS: AI contract honored — 4 段就排 4 个分镜、照 15 秒切成 3 条、转法句透传、秒数抹掉、新收尾补齐')

        # ④ src 快照 + note_dgens 纯文本索引
        assert page.evaluate('_npWiz.dgen.src') == DRAFT1
        page.wait_for_function('''async () => {
            const d = await chrome.storage.local.get('note_dgens');
            const flat = ((d && d.note_dgens) || {})['ndv1'];
            return !!(flat && flat.flat && flat.flat.indexOf('【1】开场钩子') >= 0);
        }''')
        idx = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get('note_dgens');
            return (((d && d.note_dgens) || {})['ndv1'] || {}).flat || '';
        }''')
        assert '重点：' in idx and '不要出现人脸口型' in idx, 'note_dgens 索引内容不对'
        print('PASS: dgen src snapshot set and the plain-text index (note_dgens) is refreshed')

        # ⑤ 回档案：中途态＝「✏️ 编辑」（title 带还差几条）＋ 已分记号
        page.evaluate('() => switchMainTab("noteArchive")')
        page.wait_for_selector('.npar-next[data-id="ndv1"]')
        nb5 = page.locator('.npar-next[data-id="ndv1"]')
        expect(nb5).to_have_text('✏️ 编辑')
        assert '还差 3 条' in (nb5.get_attribute('title') or ''), nb5.get_attribute('title')
        assert '🎬 分了 3 条' in page.locator('.npar-list').inner_text()
        print('PASS: mid-state archive row shows 编辑 with 还差 3 条 in the tip, plus the split-count chip')

        # ⑥ 再点「下一步」回来：分镜原样在（不重排）
        calls = sw.evaluate('self.testDvCalls')
        page.locator('.npar-next[data-id="ndv1"]').click()
        page.wait_for_function('() => _npWiz && _npWiz.step === 5')
        page.wait_for_function('() => document.querySelectorAll(".np-dv-prompt").length === 3')
        assert sw.evaluate('self.testDvCalls') == calls, '分镜还在却又排了一遍'
        print('PASS: reopened station reuses the saved segments without re-splitting')

        # ⑦ 改稿后 src 对不上＝自动重排（换成一版 3 段）
        sw.evaluate('self.testDvMode = "p3"')
        page.evaluate('''() => {
            _npWiz.draft.content = %s;
            _npWiz.voice = %s;
            npWizRender(npActiveC());
        }''' % (json.dumps(DRAFT2), json.dumps(DRAFT2)))
        page.wait_for_function('(d) => _npWiz.dgen && _npWiz.dgen.src === d', arg=DRAFT2)
        assert page.evaluate('_npWiz.dgen.src') == DRAFT2, '重排后 src 没换成新稿'
        assert sw.evaluate('self.testDvCalls') == calls + 1
        assert page.evaluate('_npWiz.dgen.segs.map(s => s.role).join("/")') == '开场钩子/转折到你这行/收束引主页'
        print('PASS: edited draft invalidates src and auto re-splits into 3 segments')

        # ⑧ 守门：没传齐时点拼片＝弹提示原地不动；三条「⬆ 传回来」后可以拼
        assert page.locator('.np-dv-asm[disabled]').count() == 0, '拼片钮该常亮可点（软提示守门）'
        page.locator('.np-dv-asm').click()
        expect(page.locator('#popToastBox')).to_contain_text('还有条没传回来')
        assert page.evaluate('_npWiz.step === 5 && !_npWiz.dgen.segs.some(s => s.done)'), '没传齐时不该拼片'
        # 三段「豆包导出的片段」用 ffmpeg 现造（真 mp4、时长有限——拼片那步要读得到 duration），一段一格传回来
        ff = shutil.which('ffmpeg')
        assert ff, '自检需要 ffmpeg 造片段（拼片链路要真 mp4）'
        for i, col in enumerate(('0x123A2B', '0x2B1A3A', '0x3A2B1A')):
            out = seg_dir / ('seg%d.mp4' % (i + 1))
            subprocess.run([ff, '-y', '-f', 'lavfi', '-i', 'color=c=%s:s=320x568:d=0.9:r=24' % col,
                            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', str(out)],
                           check=True, capture_output=True)
            page.locator('.np-dv-file[data-i="%d"]' % i).set_input_files(str(out))
            page.wait_for_function('() => _npWiz.dgen.segs[%d].done' % i)
        page.wait_for_function('() => document.getElementById("npWizBody").innerText.indexOf("3 条都传回来了") >= 0')
        print('PASS: assemble is soft-guarded (toast when incomplete), uploading all segments readies it')

        # ⑨ 音色选择：点「云希」并回写档案
        page.locator('.np-dv-voice[data-v="zh-CN-YunxiNeural"]').click()
        assert page.evaluate('_npWiz.dgen.voice') == 'zh-CN-YunxiNeural'
        page.wait_for_function('''async () => {
            const d = await chrome.storage.local.get('np_notes');
            const n = (d.np_notes || []).find(x => x && x.id === 'ndv1');
            return !!(n && n.dgen && n.dgen.voice === 'zh-CN-YunxiNeural');
        }''')
        print('PASS: voice chip writes through to the archive')

        # ⑩ 真拼片：三段片段按稿子顺序接＋字幕烧进画面＋配音——配音走 Edge 免费口子，这里桩掉（不联网，走无声容忍）；
        #    真录真存：落 filmDocs／xhsFilmDocs／标「代发」／档案自动回列表
        page.evaluate('() => { EdgeTTS.synth = async () => { throw new Error("自检：配音桩"); }; }')
        page.locator('.np-dv-asm').click()
        page.wait_for_selector('#noteArchiveContent .npar-stsel[data-id="ndv1"]', timeout=120000)
        expect(page.locator('#noteArchiveContent .npar-stsel[data-id="ndv1"]')).to_have_value('代发')
        entry = sw.evaluate('''async () => {
            const d = await chrome.storage.local.get(['np_notes', 'xhsFilmDocs']);
            const n = (d.np_notes || []).find(x => x && x.id === 'ndv1');
            return { note: n, doc: ((d.xhsFilmDocs || {})['ndv1']) || null };
        }''')
        n, doc = entry['note'], entry['doc']
        assert n['filmKind'] == '文案直出视频' and ((n.get('wip') or {}).get('path') == 'video'), n.get('filmKind')
        assert n['filmDocs'] and n['filmDocs'][0]['kind'] == '文案直出视频'
        assert n['dgen'] and len(n['dgen']['segs']) == 3 and n['dgen']['voice'] == 'zh-CN-YunxiNeural'
        assert doc and doc['outAt'] > 0 and len(doc['scenes']) == 3 and doc['voice'] == 'zh-CN-YunxiNeural'
        assert doc['scenes'][0]['text'] == n['dgen']['segs'][0]['text']
        expect(page.locator('.npar-next[data-id="ndv1"]')).to_have_text('🎬 成片预览')
        assert '🎬 已出片' in page.locator('.npar-list').inner_text()
        print('PASS: assemble writes filmDocs + xhsFilmDocs, marks 代发, and the next-step flips to 成片预览')

        assert not errors, f'页面报错: {errors}'
        print('ALL PASS: check_note_dv')
    finally:
        ctx.close()
