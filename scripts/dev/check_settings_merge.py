"""设置页去重 + 合并的回归检查（真浏览器 + 临时 profile + 未打包 extension/）。

盯的是这些容易再犯的点：
  · 共享表（服务商/模型/知识库八分类/拟人挡位）在弹窗、设置 iframe、向导、后台四处都能拿到
  · 设置各页正文挂 TAB_MOUNT：弹窗左栏是 settingsOpenTab(tab) 直切、不点侧栏，
    只挂 click 的页在弹窗里会落成空 body（AI客服/日志/日常浏览踩过）
  · 配置按业务分家（2026-10-01 五十二改再调整）：设置页只留系统级页（租户/AI/日常浏览/日志/备份）；
    🤖 拟人化与频率＝获客 → ⚙️ 设置（#tab-delays），
    🔔 线索 → ⚙️ 设置（#tab-leadtouch，扫描节奏＝整轮扫描间隔 + 🛰 新消息监听）/ 📮 线索 → 任务配置（#tab-leadtask，
    🎙 渠道基调 + 💰 成交引导 + 🗨 话术配置 + 🧪 试问答四个横 tab——后两节就是原「诊断 客服话术」整块搬来）；
    诊断&配置只剩 6 页、节点号全废（说话风格并进「人设」当第二个横 tab，内容基调整页搬去「发笔记 → 任务配置」）
    —— 这些页都是内嵌同一份 settings.html（各有自己的 iframe 实例），入口不再挂在设置页侧栏
  · 拟人化与频率（2026-09-25 三次改）：主界面只留一个挡位滑块（拖完即生效），
    灌水频率与去重 / 各环节停留 / 互动行为整块收进「⚙️ 高级配置」弹窗（#delayAdvBtn → #delayAdvModal，底部一个保存）
  · 线索 → 任务配置：页内四个横 tab（#ltCfgTabs，🎙 渠道基调 / 💰 成交引导 / 🗨 话术配置 / 🧪 试问答，一次只开一节），
    成交引导存 aiCs.guide（默认「私信我」，只留一个输入框，预设下拉/优惠活动行已撤）；
    渠道基调每条可补一句自己的话（aiCs.channels.<k>.tone，落库时整对象覆盖、别冲掉 promptScene 等原字段）；
    字数真源在「诊断&配置 → 人设 → 说话风格」，这页只读显示
  · Bot 间隔只有一处写入口（线索 → 设置 #ltScanFreq）：弹窗顶栏「更多」菜单里那个 #plScanFreq2 已撤
    （当年还摆 2 分 / 10 分，后台实际下限 20 分钟）；拟人化与频率页里不再有「后台定时扫描」勾选框
  · 🛰 新消息监听（2026-09-27 加）：线索 → 设置同页第二个开关（#mwFreq off/30/60/120，共用 #ltSaveBtn），
    存 msg_watch_on / msg_watch_tick，后台排一次性闹钟 'msg-watch'（跑完再排，不用 periodInMinutes）；
    版本闸门与「线索」一致（prospectList），没线索的版本整片 #tab-leadtouch 已 remove
  · 杂项配置页已撤（2026-09-25）：产品名称 / 推广目标 / 评论区承接 / 昵称 / 同城挡位整页并进
    「诊断&配置 → 基础配置」（#tab-product / #diagMiscFrame 都不该再出现）；
    推广目标 + 评论区承接再下沉到「👥 获客 → 📮 任务配置 → 🎯 推广目标」（#sxGoalGuide，弹窗侧、
    settings 内嵌实例里不该有）；两处引导分工不重叠——评论区承接＝那边，私信/触达成交引导＝线索任务配置的 #trGuideDeliver
  · 「灌水规则」页已撤（2026-09-25）：灌水频率与去重并进「拟人化与频率」一页（#delayWaterFreq），
    搜索范围（未看过筛选）整条下线（#tab-autowater / #awFilterScope 都不该再出现）
  · 设置侧栏一层平铺：不再有分组标题（.rail-glbl / .tab-group 都该是 0）
  · 租户切换只在弹窗顶栏：内嵌设置页不出「切换」按钮，独立设置页保留
  · 每轮篇数一份真源（note_trend_config.maxPerRound，0=不限）并镜像到 auto_water_config.schedule.perRound
  · 知识库只有一个家＝诊断&配置 → 知识库：设置版那页已撤，角色 / 配图 / 导出 / 清空都搬进那一页
  · 2026-09-25 三十一改：线索 → 任务配置的 🎙 渠道基调改成一张表的填空
    （渠道 / 系统怎么说 / 你的基调三列，第三列直接填；说明进列头、字数口径进表脚）；
    线索 → 设置 与 获客 → 设置 统一成同一套卡框（标题行右侧挂状态字、控件在卡里、
    卡下才是按钮行），两页 computed style 对齐
"""
import base64
import pathlib
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
ERRORS = []


def sframe(page, tab, timeout=10000):
    """当前停在 #tab 的那个 settings 内嵌实例（各宿主是独立文档，靠 hash 认）"""
    end = time.time() + timeout / 1000
    while time.time() < end:
        for f in page.frames:
            if 'settings.html' in (f.url or '') and (f.url or '').endswith('#' + tab):
                return f
        page.wait_for_timeout(200)
    raise AssertionError('没找到停在 #%s 的 settings 内嵌实例' % tab)


with tempfile.TemporaryDirectory(prefix='xhs-merge-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.on('console', lambda m: print('[SW]', m.type, m.text[:200]))
        assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上（lib 顶层抛错？）'
        print('PASS 后台路由已注册')

        page = ctx.new_page()
        page.on('pageerror', lambda e: ERRORS.append('popup: ' + str(e)[:200]))
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function"')

        # 1) 共享表在弹窗页可用（模型表 + 分类表 + 挡位表）
        shared = page.evaluate('''() => ({
            providers: typeof PROVIDER_CONFIG === 'object' ? Object.keys(PROVIDER_CONFIG).length : -1,
            quicks: typeof QUICK_MODELS === 'object' ? QUICK_MODELS.normal.length : -1,
            kbs: typeof KB_CATEGORIES === 'object' ? KB_CATEGORIES.length : -1,
            presets: typeof DELAY_PRESETS === 'object' ? DELAY_PRESETS.length : -1,
            fs: typeof fsFillModel === 'function' && typeof fsProviderOf === 'function',
        })''')
        assert shared['providers'] >= 10, 'PROVIDER_CONFIG 没共享出来: %s' % shared
        assert shared['quicks'] == 7 and shared['kbs'] == 8 and shared['presets'] == 6, '共享表内容不对: %s' % shared
        print('PASS 弹窗页共享表：%d 家服务商 / %d 常用模型 / %d 分类 / %d 挡位' % (shared['providers'], shared['quicks'], shared['kbs'], shared['presets']))

        # 2) 首次设置面板的模型下拉（用共享表渲染）
        filled = page.evaluate('''() => {
            const d = document.createElement('select'); d.id = 'tmpSel'; document.body.appendChild(d);
            fsFillModel('deepseek', '', 'tmpSel');
            const n = d.options.length; const first = d.options[0] && d.options[0].textContent;
            d.remove(); return { n, first };
        }''')
        assert filled['n'] == 2 and 'deepseek-v4-flash' in filled['first'], 'fsFillModel 没读共享表: %s' % filled
        print('PASS 首次设置模型下拉：%s' % filled['first'])

        # 3) 逐个点开设置页留下的 4 个系统级页（走 iframe），确认无 pageerror
        #    新 profile 没有 AI Key，弹窗会盖一层「首次设置」，先关掉
        if page.locator('#firstSetupPanel').count():
            page.click('#firstSetupPanel #fsClose')
            page.wait_for_selector('#firstSetupPanel', state='detached')
        page.click('#tabSettings')
        page.wait_for_selector('#settingsFrame', state='attached')
        fr = page.frame_locator('#settingsFrame')
        # 日常浏览 2026-09-26 整块搬进「获客 → 任务配置」，设置页这条侧栏已撤，别再点它
        tabs = ['tenant', 'ai', 'logs', 'backup']
        for t in tabs:
            page.click('#setTabs [data-stab="%s"]' % t)
            page.wait_for_timeout(450)
            active = fr.locator('#tab-%s.active' % t).count()
            assert active == 1, '设置页 #tab-%s 没激活' % t
        print('PASS 设置 %d 个系统级页逐个点开都正常' % len(tabs))

        # 3b) 业务侧页面都搬了家：设置页左栏不该再有它们的入口，弹窗侧栏也不该有分组标题（一层平铺）
        for t in ['product', 'aics', 'autowater', 'prompts', 'knowledge']:
            assert page.locator('#setTabs [data-stab="%s"]' % t).count() == 0, '弹窗设置左栏还有 %s 入口' % t
            assert fr.locator('.tab-item[data-tab="%s"]' % t).count() == 0, '设置页侧栏还有 %s 项' % t
        assert page.locator('#setTabs .rail-glbl').count() == 0 and fr.locator('.tab-group').count() == 0, \
            '设置侧栏又冒出分组标题（应该一层平铺）'
        print('PASS 设置左栏只剩系统级 + 一层平铺：业务页（杂项/话术/触达）+ 提示词/知识库都不在、无分组名')

        # 3c) 新家逐个进：获客 → 设置（#delays）/ 线索 → 设置（#leadtouch）/ 线索 → 任务配置，各自的 iframe 实例停在对应页
        page.click('#tabHuoke')
        page.wait_for_timeout(300)
        assert page.locator('#tabHuokeCfg').count() == 1, '获客二级少了「设置」（拟人化与频率）'
        assert page.locator('#subTabs button').count() == 5, '获客二级应恰好 5 项，实际 %d' % page.locator('#subTabs button').count()
        page.click('#tabHuokeCfg')
        sframe(page, 'delays')
        hf = page.frame_locator('#huokeCfgFrame')
        hf.locator('#tab-delays.active').wait_for(timeout=15000)
        assert hf.locator('#delayTickRow').count() == 1, '获客设置没落到拟人化与频率页'
        hf.locator('#delayTickRow').locator('span').first.wait_for(timeout=10000)   # 挡位刻度也是 JS 画的
        # 2026-09-25 改版：这一页主界面只留一个挡位滑块（拖完即生效），
        # 灌水频率与去重 / 各环节停留 / 互动行为整块收进「⚙️ 高级配置」弹窗——主页面不该再有数字框/下拉
        assert hf.locator('#delayAdvBtn').count() == 1, '拟人化页少了「⚙️ 高级配置」入口'
        assert hf.locator('#tab-delays input[type="number"]').count() == 0, '拟人化页又平铺出数字输入框（细项该在弹窗里）'
        assert hf.locator('#tab-delays select').count() == 0, '拟人化页还有下拉（细项该在弹窗里）'
        assert hf.locator('#tab-delays #touchTone').count() == 0, '「渠道基调与成交引导」该已搬去 线索 → 任务配置，这里不该再有'
        assert hf.locator('#bhAutoScanChat').count() == 0, '「后台定时扫描」勾选框该已撤（Bot 间隔归 线索 → 设置）'
        hf.locator('#delayAdvBtn').click()
        hf.locator('#delayAdvModal').wait_for(state='visible', timeout=10000)
        assert hf.locator('#delayWaterFreq').is_visible(), '弹窗里「灌水频率与去重」那半截没显示'
        for fid in ['ntMaxPerRound', 'ntMaxPerNote', 'ntCooldownHours', 'ntCheckedHours', 'ntScanIntervalMin',
                    'dl_browseDwell_min', 'bhAutoFollow']:
            assert hf.locator('#delayAdvModal #%s' % fid).count() == 1, '高级配置弹窗缺字段 #%s' % fid
        assert hf.locator('#ntMaxPerRound').input_value() != '', '高级配置弹窗正文没挂载（每轮篇数没填上）'
        adv_txt = hf.locator('#delayAdvModal').inner_text()
        assert '灌水频率与去重' in adv_txt and '关键词池' in adv_txt and '灌水历史' in adv_txt, \
            '弹窗没指路关键词池/灌水历史: %s' % adv_txt[:160]
        hf.locator('#delayAdvCancel').click()
        hf.locator('#delayAdvModal').wait_for(state='hidden', timeout=8000)
        print('PASS 获客 → 设置：主页只管挡位（零平铺细项）·「⚙️ 高级配置」弹窗里灌水频率与去重 5 项 + 停留 + 互动行为齐全')

        page.click('#tabProspect')
        page.wait_for_timeout(400)
        # 线索二级恰好四条，紧贴一级项下方、顺序固定：任务配置 / 通知 / 消息 / 设置（任务配置最前，2026-09-25 改）
        lead_ids = page.locator('#leadTabs button').evaluate_all('els => els.map(e => e.id)')
        assert lead_ids == ['tabLeadTaskCfg', 'tabLeadNotif', 'tabLeadMsg', 'tabLeadCfg'], lead_ids
        lead_labels = page.locator('#leadTabs button').evaluate_all('els => els.map(e => e.innerText.trim())')
        assert lead_labels == ['任务配置', '通知', '消息', '设置'], lead_labels
        print('PASS 线索二级：%s' % ' / '.join(lead_labels))

        # 3c-1) 线索 → 设置：扫描节奏两件（整轮扫描间隔 + 🛰 新消息监听；渠道基调 / 成交引导拆去任务配置）
        page.click('#tabLeadCfg')
        sframe(page, 'leadtouch')
        lf = page.frame_locator('#leadCfgFrame')
        lf.locator('#tab-leadtouch.active').wait_for(timeout=15000)
        lscope = lf.locator('#tab-leadtouch')
        assert lf.locator('#ltScanFreq').count() == 1, '线索设置少了 Bot 间隔下拉'
        # 控件本身还在这份 settings.html 里（任务配置那页的），所以只查「设置这一页」范围内不该有
        for gone in ['#trChannels', '#trGuideDeliver', '#trGuideTips', '#trGuidePre', '#ltToneSaveBtn', '#ltCfgTabs', '.cfgsec']:
            assert lscope.locator(gone).count() == 0, '%s 还在「设置」这一页里（该已搬去 任务配置）' % gone
        # 2026-09-27 起页头说明收进标题旁的问号气泡，改成读 data-tip（指路不能丢）
        set_tip = lscope.locator('.panel-header h2 .qhelp').get_attribute('data-tip') or ''
        assert '多久整轮扫一次新线索' in set_tip and '任务配置' in set_tip, '设置页问号没指路任务配置: %s' % set_tip[:160]
        # 2026-09-27 监听：同页第二个开关，选项不许低于 30s（chrome.alarms 硬下限）
        assert lf.locator('#mwFreq').count() == 1, '线索设置少了 🛰 新消息监听下拉'
        mw_opts = lf.locator('#mwFreq option').evaluate_all('els => els.map(e => e.value)')
        assert mw_opts == ['off', '30', '60', '120'], '监听节拍选项不对: %s' % mw_opts
        lf.locator('#ltScanFreq').select_option('30')
        lf.locator('#mwFreq').select_option('30')
        lf.locator('#ltSaveBtn').click()
        # 保存要连打两次后台（扫描间隔 + 监听闹钟），冷启动能到几秒；等提示自己冒出来，别用固定 sleep
        sframe(page, 'leadtouch').wait_for_function(
            "() => /保存/.test((document.getElementById('ltSaveMsg') || {}).textContent || '')", timeout=20000)
        bot = sframe(page, 'leadtouch').evaluate('''async () => ({
            on: await getStorage('prospect_scan_auto'),
            iv: await getStorage('prospect_scan_interval_min'),
            mwOn: await getStorage('msg_watch_on'),
            mwTick: await getStorage('msg_watch_tick'),
            arm: (await new Promise(r => chrome.alarms.get('msg-watch', a => r(a)))) || null,
            msg: (document.getElementById('ltSaveMsg') || {}).textContent || '' })''')
        assert bot['on'] is True and bot['iv'] == 30, 'Bot 间隔没落盘: %s' % bot
        assert bot['mwOn'] is True and bot['mwTick'] == 30, '监听开关没落盘: %s' % bot
        # 一次性闹钟：只有 scheduledTime，没有 periodInMinutes（周期的会带）
        assert bot['arm'] and 'periodInMinutes' not in bot['arm'], '监听该是一次性闹钟（跑完再排）: %s' % bot['arm']
        assert '已保存' in bot['msg'], 'Bot 间隔保存没出提示: %s' % bot
        print('PASS 线索 → 设置：扫描节奏两件（整轮间隔 %s 分钟 / 监听 %ss，开关 %s）· 基调/引导控件都不在这页'
              % (bot['iv'], bot['mwTick'], bot['on']))

        # 2026-09-25 三十一改：两个「设置」页统一成一个观感（获客·设置＝拟人化挡位卡，线索·设置＝Bot 间隔卡）——
        # 同一套卡框（描边 / 圆角 / 底色 / 内边距），状态字挂在卡里的标题行右侧，动作按钮在卡外下面一行
        def card_box(fr, ctrl):
            return fr.locator(ctrl).evaluate('''el => {
              let n = el.parentElement;   // 从控件外面往上找：控件自己（select/range）也有描边
              while (n && n !== document.body) {
                const cs = getComputedStyle(n);
                if (parseFloat(cs.borderTopWidth) > 0) break;
                n = n.parentElement;
              }
              if (!n) return null;
              const cs = getComputedStyle(n);
              return { r: cs.borderTopLeftRadius, bg: cs.backgroundColor, bd: cs.borderTopColor,
                       pad: cs.paddingTop + '/' + cs.paddingLeft,
                       hasMsg: !!n.querySelector('.save-msg'),
                       hasTitle: !!n.querySelector('div[style*="font-weight:700"]') };
            }''')
        lcard, hcard = card_box(lf, '#ltScanFreq'), card_box(hf, '#delayPreset')
        assert lcard and hcard and lcard == hcard, '线索 / 获客 两个设置页的卡框不一致: %s vs %s' % (lcard, hcard)
        assert lcard['hasMsg'] and lcard['hasTitle'], '卡里该是「标题行 + 右侧状态字」: %s' % lcard
        assert lf.locator('#ltSaveBtn').count() == 1 and hf.locator('#delayAdvBtn').count() == 1, '两页卡下的按钮行不见了'
        print('PASS 线索 / 获客 两个「设置」页同一套卡框（%s · 状态字在卡里 · 按钮在卡下）' % lcard['r'])
        # Bot 间隔的旧入口已撤：顶栏「更多」菜单里不该再有扫新线索那排（含撒谎的 2 分 / 10 分）
        page.click('#hdrMoreBtn')
        page.wait_for_timeout(250)
        assert page.locator('#plScanFreq2').count() == 0, '顶栏「更多」菜单还留着扫新线索那排（该只在线索 → 设置）'
        assert '扫新线索' not in page.locator('#hdrMoreMenu').inner_text(), '顶栏「更多」菜单还写着「扫新线索」'
        page.keyboard.press('Escape')
        page.wait_for_timeout(200)
        print('PASS Bot 间隔唯一入口：顶栏「更多」菜单已撤扫新线索那排')

        # 3c-2) 线索 → 任务配置：四个横 tab（🎙 渠道基调 / 💰 成交引导 / 🗨 话术配置 / 🧪 试问答），一次只开一节
        page.click('#tabLeadTaskCfg')
        sframe(page, 'leadtask')
        tf = page.frame_locator('#leadTaskCfgFrame')
        tf.locator('#tab-leadtask.active').wait_for(timeout=15000)
        tf.locator('#trChannels div').first.wait_for(timeout=10000)   # 渠道基调卡片 + 字数由 loadTouchTone 现画
        lttabs = tf.locator('#ltCfgTabs .cfgtab').evaluate_all('els => els.map(e => [e.innerText.trim(), e.classList.contains("active")])')
        assert [t[0] for t in lttabs] == ['🎙 渠道基调', '💰 成交引导', '🗨 话术配置', '🧪 试问答'], '任务配置三级 tab 不对: %s' % lttabs
        assert lttabs[0][1] is True and all(t[1] is False for t in lttabs[1:]), '默认该只点亮 🎙 渠道基调: %s' % lttabs
        ltsecs = tf.locator('#tab-leadtask .cfgsec').evaluate_all('els => els.map(e => [e.dataset.sec, e.offsetParent !== null])')
        assert ltsecs == [['ch', True], ['guide', False], ['qa', False], ['test', False]], '默认该只显示渠道基调: %s' % ltsecs
        ch_txt = tf.locator('#trChannels').inner_text()
        assert '评论/回复' in ch_txt and '字数跟随' in ch_txt, '渠道基调没现画: %s' % ch_txt[:120]
        # 2026-09-25 三十一改：四张卡改成一张表的填空——渠道 / 系统怎么说 / 你的基调（第三列直接填）
        chead = tf.locator('#trChannels thead th').evaluate_all('els => els.map(e => e.innerText.trim())')
        assert chead == ['渠道', '系统怎么说', '你的基调'], '渠道基调表头不对: %s' % chead
        assert tf.locator('#trChannels tbody tr').count() == 4, '渠道基调该一行一个渠道'
        assert tf.locator('#trChannels tbody .tr-ch-desc').count() == 4, '「系统怎么说」那列没填上'
        print('PASS 线索 → 任务配置：四个横 tab（%s）· 默认渠道基调（表格填空 %s + 字数口径）' % (' / '.join(t[0] for t in lttabs), ' / '.join(chead)))

        # 切到 💰 成交引导：只显示引导块；默认填「私信我」、不留预设下拉/优惠活动（2026-09-25 简化）
        tf.locator('#ltCfgTabs [data-sec="guide"]').click()
        page.wait_for_timeout(250)
        ltsecs2 = tf.locator('#tab-leadtask .cfgsec').evaluate_all('els => els.map(e => [e.dataset.sec, e.offsetParent !== null])')
        assert ltsecs2 == [['ch', False], ['guide', True], ['qa', False], ['test', False]], '切 tab 后显示不对: %s' % ltsecs2
        assert tf.locator('#trGuidePre').count() == 0 and tf.locator('#trGuideTips').count() == 0, \
            '成交引导还留着预设下拉 / 优惠活动输入'
        assert tf.locator('#trGuideDeliver').input_value() == '私信我', \
            '成交引导默认没落成「私信我」: %r' % tf.locator('#trGuideDeliver').input_value()
        tf.locator('#trGuideDeliver').fill('私信我留个邮箱，我把资料发你')

        # 渠道基调（🎙 那节）：每条可补一句自己的基调；保存时 channels 是整对象覆盖，原字段不能被冲掉
        tf.locator('#ltCfgTabs [data-sec="ch"]').click()
        page.wait_for_timeout(250)
        tones = tf.locator('#trChannels .tr-ch-tone')
        assert tones.count() == 4, '渠道基调输入不是四条: %s' % tones.count()
        assert tones.nth(0).input_value() == '', '渠道基调默认该留空（＝只用系统那套）'
        tf.locator('#trChannels .tr-ch-tone[data-ch="comment"]').fill('先问一句对方在哪刷到的，再聊正事')
        tf.locator('#ltToneSaveBtn').click()
        page.wait_for_timeout(1200)
        tone_msg = tf.locator('#ltToneMsg').inner_text().strip()
        assert '已保存' in tone_msg, '任务配置保存没提示: %s' % tone_msg
        saved = page.evaluate('''async () => {
            const r = await chrome.runtime.sendMessage({ action: 'getAiCsConfig', data: {} });
            const c = (r && r.ok && r.config) || null;
            return c ? { guide: c.guide, ch: c.channels } : null; }''')
        assert saved and saved['guide'] and saved['guide']['deliver'] == '私信我留个邮箱，我把资料发你', \
            '成交引导没落盘: %s' % (saved and saved['guide'])
        sch = (saved or {}).get('ch') or {}
        assert (sch.get('comment') or {}).get('tone') == '先问一句对方在哪刷到的，再聊正事', '渠道基调没落盘: %s' % sch.get('comment')
        assert (sch.get('comment') or {}).get('promptScene') == 'scen_ch_comment' \
            and (sch.get('like') or {}).get('promptScene') == 'scen_ch_like' \
            and (sch.get('like') or {}).get('tone') == '', '改一条基调把别的渠道字段冲掉了: %s' % sch
        tf.locator('#ltCfgTabs [data-sec="guide"]').click()   # 留给下面「切走再回来停在哪」那步
        page.wait_for_timeout(200)
        print('PASS 线索 → 任务配置：成交引导默认「私信我」、无预设下拉/优惠活动，保存落盘 deliver=%s；'
              '渠道基调四输入可改（comment.tone 已存、其余渠道原字段未动）' % saved['guide']['deliver'])

        # 切走再回来：iframe 不重载、还停在上次的 🎙/💰 那一节（写一半的不会被冲掉）
        sframe(page, 'leadtask').evaluate('() => { window.__lt_mark = 777; }')
        page.click('#tabLeadCfg')
        page.wait_for_timeout(400)
        page.click('#tabLeadTaskCfg')
        page.wait_for_timeout(600)
        mark = sframe(page, 'leadtask').evaluate('() => window.__lt_mark || 0')
        assert mark == 777, '来回切把任务配置实例重载了'
        ltsecs3 = tf.locator('#tab-leadtask .cfgsec').evaluate_all('els => els.map(e => [e.dataset.sec, e.offsetParent !== null])')
        assert ltsecs3 == [['ch', False], ['guide', True], ['qa', False], ['test', False]], '回来没停在上次那一节: %s' % ltsecs3
        # 两份内嵌实例各停各页（同一份 settings.html 的两个 iframe，互不串页）
        st_task = sframe(page, 'leadtask').evaluate('''() => ({
            mine: !!document.querySelector('#tab-leadtask.active'),
            other: !!document.querySelector('#tab-leadtouch.active'),
            hash: location.hash })''')
        st_cfg = sframe(page, 'leadtouch').evaluate('''() => ({
            mine: !!document.querySelector('#tab-leadtouch.active'),
            other: !!document.querySelector('#tab-leadtask.active'),
            hash: location.hash })''')
        assert st_task == {'mine': True, 'other': False, 'hash': '#leadtask'}, st_task
        assert st_cfg == {'mine': True, 'other': False, 'hash': '#leadtouch'}, st_cfg
        print('PASS 任务配置：切走再回来不重载、停在上次的 💰 那节；两份内嵌实例各停各页（互不串页）')

        page.click('#tabDiagnose')
        page.wait_for_timeout(400)
        # 诊断&配置只剩 6 页：节点号全废，客服话术 / 内容基调 / 说话风格都不再挂诊断
        diag_nodes = page.locator('#diagSubTabs [data-go]').evaluate_all('els => els.map(e => e.dataset.go)')
        assert diag_nodes == ['1', '2', '3', '4', '5', '6'], '诊断二级页不是 6 个: %s' % diag_nodes
        assert '杂项配置' not in page.locator('#diagSubTabs').inner_text(), '还留着「杂项配置」（它已并进基础配置）'
        # 诊断页里的老内嵌宿主整批撤：这一页不该再有任何 settings iframe
        assert page.locator('#diagMiscFrame').count() == 0 and page.locator('#diagMiscContent').count() == 0, \
            '还在往杂项宿主里放 iframe'
        assert page.locator('#diagAicsFrame').count() == 0 and page.locator('#diagAicsContent').count() == 0, \
            '客服话术还留在诊断页里（已整块搬去「线索 → 任务配置」）'
        assert page.locator('#diagnoseContent iframe').count() == 0, '诊断正文里还嵌着 settings 实例'
        page.click('#diagSubTabs [data-go="1"]')
        page.wait_for_selector('#diagStepBody', timeout=15000)
        print('PASS 诊断&配置只剩 6 页：内嵌宿主（杂项 / 客服话术）整批撤，诊断正文里不再有 settings iframe')

        # 客服话术的新家＝「线索 → 任务配置 · 🗨 话术配置」：同一个 iframe 实例里换节，不重载
        page.click('#tabProspect')
        page.wait_for_timeout(300)
        page.click('#tabLeadTaskCfg')
        page.wait_for_timeout(500)
        tf.locator('#ltCfgTabs [data-sec="qa"]').click()
        tf.locator('#aicsQa div').first.wait_for(timeout=20000)   # 问答话术库由 renderAiCsSettings 现画
        assert sframe(page, 'leadtask').evaluate('() => window.__lt_mark || 0') == 777, '切到 🗨 话术配置把实例重载了'
        ltsecs4 = tf.locator('#tab-leadtask .cfgsec').evaluate_all('els => els.map(e => [e.dataset.sec, e.offsetParent !== null])')
        assert ltsecs4 == [['ch', False], ['guide', False], ['qa', True], ['test', False]], '🗨 节没只开自己: %s' % ltsecs4
        tf.locator('#ltCfgTabs [data-sec="ch"]').click()   # 留给下面看字数口径那一节
        page.wait_for_timeout(250)
        print('PASS 客服话术并进「线索 → 任务配置」：🗨 节现画话术库、切节不重载实例')

        # 4) 设置版「知识库」页已撤（并进诊断 ⑤）：tab + 面板都不该再有
        assert fr.locator('#tab-knowledge').count() == 0, '设置页还有 #tab-knowledge 面板'
        print('PASS 设置版知识库页已撤（tab + 面板都没了）')

        # 5) AI 页模型下拉用的是共享表
        page.click('#tabSettings')
        page.wait_for_timeout(400)
        page.click('#setTabs [data-stab="ai"]')
        page.wait_for_timeout(500)
        n_opts = fr.locator('#apiModel option').count()
        first_ai = fr.locator('#apiModel option').first.get_attribute('value') or ''
        assert n_opts >= 2 and first_ai.startswith('deepseek-'), 'AI 页模型下拉没按共享表填: %d / %s' % (n_opts, first_ai)
        print('PASS AI 页模型下拉 %d 项（首项 %s）' % (n_opts, first_ai))

        # 6) 拟人化与频率（获客 → 设置）：主页面只有挡位行，细项全在「⚙️ 高级配置」弹窗里
        page.click('#tabHuoke')
        page.wait_for_timeout(300)
        page.click('#tabHuokeCfg')
        page.wait_for_timeout(700)
        assert hf.locator('#delayTickRow').count() == 1, '挡位刻度行丢了'
        assert hf.locator('#tab-delays input[type="number"]').count() == 0, '拟人化页又平铺出数字输入框（细项该在弹窗里）'
        # 排序 / 范围筛选已全下线，成交引导搬去了线索任务配置：这一页不该再有 select
        sel_ids = hf.locator('#tab-delays select').evaluate_all('els => els.map(e => e.id)')
        assert sel_ids == [], '拟人化与频率页下拉不对（排序/范围死控件？成交引导该已搬走）：%s' % sel_ids
        opts_all = hf.locator('#tab-delays option').evaluate_all('els => els.map(e => e.textContent)')
        assert not [t for t in opts_all if '排序' in t or '最热' in t or '未看过' in t or '邮箱' in t], \
            '还留着排序/范围/成交引导相关选项: %s' % opts_all
        dl_txt = hf.locator('#tab-delays').inner_text()
        assert '挡位' in dl_txt and '高级配置' in dl_txt, '主页面没讲清「只留挡位 + 高级配置」: %s' % dl_txt[:120]
        assert '关键词池' in dl_txt, '没指路「扫哪些词」去哪配: %s' % dl_txt[-160:]
        assert '灌水历史' in dl_txt, '没指路灌水历史搬到哪'
        assert '搜索范围' not in dl_txt and '未看过' not in dl_txt, '搜索范围的残留文案还在'
        # 弹窗里：灌水频率与去重 5 项 + 两处指路
        hf.locator('#delayAdvBtn').click()
        hf.locator('#delayAdvModal').wait_for(state='visible', timeout=10000)
        for fid in ['ntMaxPerRound', 'ntMaxPerNote', 'ntCooldownHours', 'ntCheckedHours', 'ntScanIntervalMin']:
            assert hf.locator('#delayAdvModal #%s' % fid).count() == 1, '灌水频率与去重缺字段 #%s' % fid
        adv_txt = hf.locator('#delayAdvModal').inner_text()
        assert '灌水频率与去重' in adv_txt, '弹窗里「灌水频率与去重」小标题丢了: %s' % adv_txt[:120]
        assert '关键词池' in adv_txt and '灌水历史' in adv_txt, '弹窗没指路关键词池/灌水历史: %s' % adv_txt[:160]
        hf.locator('#delayAdvCancel').click()
        hf.locator('#delayAdvModal').wait_for(state='hidden', timeout=8000)
        print('PASS 获客 → 设置：挡位行 + 零平铺细项 + 无死下拉；灌水频率与去重 5 项与指路都在高级配置弹窗里')

        # 7) 租户页：内嵌时不出「切换」按钮，且文案指向顶栏
        page.click('#tabSettings')
        page.wait_for_timeout(300)
        page.click('#setTabs [data-stab="tenant"]')
        page.wait_for_timeout(700)
        sw_btns = fr.locator('#tenantList button', has_text='切换').count()
        # 2026-09-27 起这段说明收进标题旁的问号气泡，正文只在 hover 时出：改成读 data-tip
        intro = fr.locator('#tenantIntro').get_attribute('data-tip') or ''
        assert sw_btns == 0, '内嵌设置页还留着「切换」按钮（%d 个）' % sw_btns
        assert '弹窗顶栏' in intro, '内嵌时的租户文案没指向顶栏: %s' % intro
        rows = fr.locator('#tenantList > div').count()
        assert rows >= 1, '租户列表没渲染出条目'
        print('PASS 租户页：内嵌无「切换」按钮、文案指向顶栏（%d 条租户）' % rows)

        # 7b) 从内嵌页新建一个租户：多租户下依然没有「切换」按钮
        fr.locator('#newTenantName').fill('测试产品B')
        fr.locator('#createTenantBtn').click()
        page.wait_for_timeout(1200)
        rows2 = fr.locator('#tenantList > div').count()
        assert rows2 >= 2, '新建租户后列表没变成 2 条（%d）' % rows2
        sw_btns2 = fr.locator('#tenantList button', has_text='切换').count()
        cur_marks = fr.locator('#tenantList').inner_text().count('✅ 当前')
        assert sw_btns2 == 0, '多租户时内嵌页冒出「切换」按钮（%d 个）' % sw_btns2
        assert cur_marks == 1, '「✅ 当前」标记应恰好 1 个，实际 %d' % cur_marks
        msg = fr.locator('#tenantSaveMsg').inner_text()
        assert '顶栏' in msg, '新建后的提示没指到顶栏: %s' % msg
        print('PASS 内嵌新建租户：%d 条、0 个「切换」按钮、提示「%s」' % (rows2, msg.strip()))

        # 8) 弹窗顶栏的切换器才是唯一入口，并且真的能切
        sel = page.locator('#tenantSwitcher')
        assert sel.count() == 1, '顶栏租户下拉不见了'
        opts2 = sel.locator('option').count()
        assert opts2 >= 2, '顶栏下拉没跟上新建的租户（%d 项）' % opts2
        before = sel.evaluate("e => e.selectedOptions[0].textContent")
        target = sel.evaluate("e => Array.from(e.options).find(o => o.selected === false).value")
        page.select_option('#tenantSwitcher', target)
        page.wait_for_load_state('load')
        page.wait_for_timeout(2500)
        after = page.evaluate("() => { const s = document.getElementById('tenantSwitcher'); return s && s.selectedOptions[0] && s.selectedOptions[0].textContent; }")
        assert after and after != before, '顶栏切换没生效：%s → %s' % (before, after)
        print('PASS 顶栏下拉可切换：%s → %s' % (before, after))

        # 9) 向导页（首次设置）也能起来：独立页面，走 lib 的服务商表
        wiz = ctx.new_page()
        wiz.on('pageerror', lambda e: ERRORS.append('wizard: ' + str(e)[:200]))
        wiz.goto(sw.url.replace('background.js', 'wizard.html'))
        wiz.wait_for_selector('#apiModel option', state='attached', timeout=15000)  # 向导逻辑在 IIFE 里，只从 DOM 验
        w = wiz.evaluate('''() => ({
            providers: typeof PROVIDER_CONFIG === 'object' ? Object.keys(PROVIDER_CONFIG).length : -1,
            kbs: typeof KB_CATEGORIES === 'object' ? KB_CATEGORIES.length : -1,
            prov: document.getElementById('apiProvider').value,
            models: Array.from(document.getElementById('apiModel').options).map(o => o.value),
            base: document.getElementById('customBaseUrl').value,
        })''')
        assert w['providers'] >= 10 and w['kbs'] == 8, '向导页没拿到共享表: %s' % w
        assert w['prov'] == 'deepseek' and w['models'] == ['deepseek-v4-flash', 'deepseek-v4-pro'], '向导页模型联动不对: %s' % w
        assert w['base'] == 'https://api.deepseek.com/v1', '向导页 BaseURL 没按共享表反填: %s' % w['base']
        print('PASS 向导页：共享表 + 自动识别 %s + 模型 %s' % (w['prov'], w['models']))
        wiz.close()

        # 10) 独立设置页（options_page 那条路）：2 个租户时应保留「切换」按钮（内嵌才收）
        solo = ctx.new_page()
        solo.on('pageerror', lambda e: ERRORS.append('settings-solo: ' + str(e)[:200]))
        solo.goto(sw.url.replace('background.js', 'settings.html'))
        solo.wait_for_selector('#tenantList > div', timeout=15000)
        solo.wait_for_timeout(600)
        solo_rows = solo.locator('#tenantList > div').count()
        solo_switch = solo.locator('#tenantList button', has_text='切换').count()
        solo_intro = solo.locator('#tenantIntro').inner_text()
        assert solo_rows >= 2 and solo_switch >= 1, '独立设置页丢了「切换」按钮（%d 条 / %d 个）' % (solo_rows, solo_switch)
        assert '弹窗顶栏' not in solo_intro, '独立页不该出现弹窗顶栏提示: %s' % solo_intro
        print('PASS 独立设置页保留切换：%d 条租户 / %d 个「切换」按钮' % (solo_rows, solo_switch))
        solo.close()

        # 11) 回头验：多模态折叠 / 引导去向两处分场合 / AICS 只读字数 / 备份互指
        #     前面切过租户 → 弹窗整页重载过（新租户没 AI Key，又会盖一层首次设置），先收干净
        page.wait_for_timeout(1500)
        if page.locator('#firstSetupPanel').count():
            page.click('#firstSetupPanel #fsClose')
            page.wait_for_selector('#firstSetupPanel', state='detached')
        page.wait_for_selector('#tabSettings')

        page.click('#tabSettings')
        page.wait_for_timeout(300)
        page.click('#setTabs [data-stab="ai"]')
        page.wait_for_timeout(500)
        mm = fr.locator('#tab-ai details summary', has_text='备用 / 看图模型').count()
        ai_txt = fr.locator('#tab-ai details').first.inner_text()
        assert mm == 1, '多模态配置块没压成「备用 / 看图模型（高级 · 可选）」折叠'
        assert '默认不用管' in ai_txt, '折叠摘要没写「默认不用管」'
        print('PASS AI 页：多模态块已压成折叠「备用 / 看图模型（高级 · 可选）」')

        # 引导两处分场合（杂项配置撤掉后不再有第三个口）：
        #   评论区承接＝弹窗「获客 → 任务配置 → 🎯 推广目标」的 #sxGoalGuide（公开场合，合规口径）；
        #   私信/触达成交引导＝线索设置 #trGuideDeliver
        page.click('#tabDiagnose')
        page.wait_for_selector('#diagSubTabs [data-go="1"]', state='visible', timeout=15000)
        page.click('#diagSubTabs [data-go="1"]')
        page.wait_for_selector('#diagStepBody', timeout=15000)
        page.wait_for_timeout(700)
        b1 = page.evaluate('''() => ({
            guide: !!document.getElementById('diagProdGuide'),
            promo: !!document.getElementById('diagPromoGoal'),
            prod: !!document.getElementById('diagProdName'),
            acct: !!document.getElementById('diagAcctChips'),
            city: !!document.getElementById('diagSameCity'),
            names: !!document.getElementById('diagAccountNames'),
            misc: !!document.getElementById('diagMiscFrame'),
        })''')
        assert all(b1[k] for k in ('prod', 'acct', 'city', 'names')), '「基础配置」缺了并进来的控件: %s' % b1
        assert not b1['guide'] and not b1['promo'], '推广目标/评论区承接 2026-09-25 已搬去「获客 → 任务配置」，基础配置里不该再有: %s' % b1
        assert not b1['misc'], '杂项配置宿主还在（整页应并进基础配置）'
        print('PASS 「基础配置」：产品名/账号类型/昵称/同城挡位都在（杂项宿主已撤；推广目标与评论区承接已搬去获客·任务配置）')

        guide = page.evaluate('''() => {
            const out = [];
            document.querySelectorAll('iframe').forEach(f => {
                const doc = (() => { try { return f.contentDocument; } catch (_) { return null; } })();
                if (!doc || !doc.getElementById('tab-leadtask')) return;
                out.push({
                    misc: !!doc.getElementById('tab-product'),
                    tips: doc.querySelectorAll('#trGuideTips').length,
                    ins: Array.from(doc.querySelectorAll('input[type="text"]'))
                        .filter(i => /微信小程序|引导去向|公众号|私信我|邮箱/.test(i.placeholder || '') || /guide/i.test(i.id))
                        .map(i => ({ id: i.id, tab: (i.closest('.tab-panel') || {}).id || '' })),
                });
            });
            return out;
        }''')
        assert guide, '没扫到 settings 内嵌实例（线索任务配置那份该在）'
        assert all(not g['misc'] for g in guide), 'settings 里还有 #tab-product（杂项配置整页应已撤）'
        # 引导类输入只剩「成交引导」那一块（#trGuideDeliver，优惠活动行 2026-09-25 已撤），且落在 #tab-leadtask；
        # 评论区承接（获客 → 任务配置 → 🎯 推广目标的 #sxGoalGuide）只属于弹窗，不该出现在 settings 的任何实例里
        assert all([i['id'] for i in g['ins']].count('trGuideDeliver') == 1
                   and all(i['tab'] == 'tab-leadtask' for i in g['ins'])
                   and g['tips'] == 0
                   for g in guide), '成交引导入口不是每份实例恰好一个（且落在 #tab-leadtask、无优惠活动行）：%s' % guide
        print('PASS 引导分场合各一处：获客·任务配置 · 评论区承接 #sxGoalGuide（弹窗侧）· 线索任务配置成交引导 #trGuideDeliver（%d 份内嵌实例，实测 %s）'
              % (len(guide), [i['id'] for i in guide[0]['ins']]))

        # 字数只读：真源＝「诊断&配置 → 人设 → 说话风格」；「线索 → 任务配置 · 🎙 渠道基调」表脚只显示、不给输入口
        page.click('#tabProspect')
        page.wait_for_timeout(300)
        page.click('#tabLeadTaskCfg')
        page.wait_for_timeout(500)
        tf.locator('#ltCfgTabs [data-sec="ch"]').click()   # 上一节停在 🎙，这里显式点一次免得停在别处
        page.wait_for_timeout(250)
        chars = sframe(page, 'leadtask').evaluate('''async () => {
            const c = deepMerge(DEFAULT_CONFIG, (await getStorage('config')) || {});
            const ss = c.scriptStyle || {};
            return { mn: ss.purposeMinChars, mx: ss.purposeMaxChars };
        }''')
        tone_txt = tf.locator('#tab-leadtask').inner_text()
        assert '字数跟随' in tone_txt and '人设 → 说话风格' in tone_txt, \
            '渠道基调没标注字数真源（要指回「人设 → 说话风格」）: %s' % tone_txt[-200:]
        assert ('%s~%s' % (chars['mn'], chars['mx'])) in tone_txt, \
            '任务配置页显示的字数（%s）与 scriptStyle 不一致: %s' % (chars, tone_txt[-200:])
        tf.locator('#ltCfgTabs [data-sec="qa"]').click()
        page.wait_for_timeout(400)
        assert tf.locator('#aicsQa input[type="number"]').count() == 0, '话术配置里还留着能改字数的输入框'
        assert tf.locator('#aicsChannels').count() == 0, '话术配置里还留着「渠道基调」块（同页 🎙 那一节才有）'
        tf.locator('#ltCfgTabs [data-sec="ch"]').click()
        print('PASS 字数只读：渠道基调表脚指路「人设 → 说话风格」并显示 %s~%s（跟 scriptStyle 一致），话术配置无字数输入口' % (chars['mn'], chars['mx']))

        page.click('#tabSettings')
        page.wait_for_timeout(300)
        page.click('#setTabs [data-stab="backup"]')
        page.wait_for_timeout(400)
        bk_txt = fr.locator('#tab-backup').inner_text()
        assert '整机' in bk_txt, '整机备份页文案没改名'
        assert '某一个产品' in bk_txt and '诊断&配置 → 知识库 → 📦 备份' in bk_txt, '整机备份页没跟知识库「📦 备份」互指: %s' % bk_txt[:120]
        print('PASS 备份两条路互指（整机 ↔ 单产品「📦 备份」）')

        # 12) 每轮篇数 = 一份真源，0=不限 要落盘（含 mirrors 到 auto_water_config）—— 弹窗底部那一个「保存」
        page.click('#tabHuoke')
        page.wait_for_timeout(300)
        page.click('#tabHuokeCfg')
        page.wait_for_timeout(600)
        hf.locator('#delayAdvBtn').click()
        hf.locator('#delayAdvModal').wait_for(state='visible', timeout=10000)
        hf.locator('#ntMaxPerRound').fill('0')
        hf.locator('#delayAdvSave').click()
        page.wait_for_timeout(1200)
        saved = sframe(page, 'delays').evaluate('''async () => {
            const nt = await getStorage('note_trend_config');
            const aw = await getStorage('auto_water_config');
            return { perRound: nt.maxPerRound, awPerRound: aw && aw.schedule ? aw.schedule.perRound : null,
                     filter: aw ? Object.keys(aw).filter(k => /filter/i.test(k)) : [],
                     msg: (document.getElementById('delayAdvMsg') || {}).textContent || '' };
        }''')
        assert saved['perRound'] == 0, '每轮篇数 0=不限 没存住: %s' % saved
        assert saved['awPerRound'] == 0, 'schedule.perRound 没跟着镜像成 0: %s' % saved
        assert saved['filter'] == [], '老的范围筛选字段还留在 auto_water_config 里: %s' % saved['filter']
        assert '已保存' in saved['msg'], '保存提示没出: %s' % saved
        print('PASS 每轮篇数：0=不限 落盘 %s（mirror %s）· 旧范围筛选字段已清 · 提示「%s」' % (saved['perRound'], saved['awPerRound'], saved['msg'].strip()))
        hf.locator('#ntMaxPerRound').fill('3')
        hf.locator('#delayAdvSave').click()
        page.wait_for_timeout(900)

        # 12b) 高级配置弹窗：停留改动能存（同一个 delay_config），主页面挡位行随时看得到生效的挡位
        hf.locator('#dl_browseDwell_min').fill('400')
        hf.locator('#delayAdvSave').click()
        # 落盘 + 回写提示要几秒（跟上面「线索 → 设置」同一个道理），轮询等提示，别用固定 sleep
        sframe(page, 'delays').wait_for_function(
            "() => /保存/.test((document.getElementById('delayAdvMsg') || {}).textContent || '')", timeout=20000)
        delay_txt = hf.locator('#tab-delays').inner_text()
        assert '每轮处理' in delay_txt, '挡位行没显示「每轮处理」: %s' % delay_txt[:120]
        dc = sframe(page, 'delays').evaluate('''async () => {
            const d = await getStorage('delay_config');
            return { min: d && d.browseDwell ? d.browseDwell.min : null,
                     msg: (document.getElementById('delayAdvMsg') || {}).textContent || '' };
        }''')
        assert dc['min'] == 400, '高级配置弹窗里改的停留没落盘: %s' % dc
        print('PASS 高级配置弹窗：改停留落盘 delay_config.browseDwell.min=%s（频率与节奏一个保存按钮）· 提示「%s」' % (dc['min'], dc['msg'].strip()))
        hf.locator('#delayAdvCancel').click()
        hf.locator('#delayAdvModal').wait_for(state='hidden', timeout=8000)

        # 13) 诊断&配置「知识库」页：设置版那页撤掉后，角色 / 配图 / 清空都要在这页跑得通
        page.click('#tabDiagnose')
        page.wait_for_selector('#diagSubTabs [data-go="5"]', state='visible', timeout=15000)
        page.click('#diagSubTabs [data-go="5"]')
        page.wait_for_selector('#diagKList', timeout=15000)
        page.wait_for_timeout(900)
        cats = page.locator('#diagKCatList option').evaluate_all('els => els.map(e => e.value)')
        roles = page.locator('#diagKRoleList option').evaluate_all('els => els.map(e => e.value)')
        assert len(cats) == 8 and '笔记架构' in cats, '知识库分类下拉没吃 KB_CATEGORIES: %s' % cats
        assert len(roles) >= 3 and '中介' in roles, '知识库角色下拉没吃 config.roleKeywords: %s' % roles
        print('PASS 知识库下拉：分类 %d 项（共享表）· 角色 %s' % (len(cats), '/'.join(roles)))

        seed = page.evaluate('''async () => await chrome.runtime.sendMessage({ action: 'saveKnowledgeBase',
            data: { mode: 'merge', entries: [{ title: '回归测试条目', content: '回归用：一条知识。', category: '使用技巧', tags: ['回归'] }] } })''')
        assert seed and seed.get('ok'), '种一条知识失败: %s' % seed
        page.click('#diagKRefresh')
        row = page.locator('#diagKList .diag-kb-row', has_text='回归测试条目').first
        row.wait_for(timeout=10000)
        # 编辑＝弹窗（不在列表原位改）
        row.locator('.diag-kb-edit-btn').click()
        page.wait_for_selector('#diagKEditPanel:modal', timeout=10000)
        png = pathlib.Path(profile) / 'kb-test.png'
        png.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='))
        page.fill('#diagKEditRole', '中介')
        with page.expect_file_chooser() as chooser:
            page.click('#diagKEditImgPick')
        chooser.value.set_files(str(png))
        page.wait_for_timeout(700)
        assert page.locator('#diagKEditImgWrap:not([hidden])').count() == 1, '上传配图后没出预览'
        page.click('#diagKEditSave')
        page.wait_for_timeout(1800)
        got = page.evaluate('''async () => {
            const r = await chrome.runtime.sendMessage({ action: 'getKnowledgeBase' });
            const e = (r.entries || []).find(x => x.title === '回归测试条目');
            return e ? { role: e.role, img: String(e.image || '').slice(0, 22) } : null;
        }''')
        assert got and got['role'] == '中介', '弹窗保存角色没落盘: %s' % got
        assert got['img'].startswith('data:image/png;base64'), '弹窗保存配图没落盘: %s' % got
        print('PASS 知识库编辑弹窗：角色「%s」+ 配图（%s…）都存住了' % (got['role'], got['img'][:18]))

        # 「📦 备份 ▾」＝备份/导入/只导出知识库/清空知识库收在一个下拉里（点了就走，不再开弹窗）
        page.click('#diagKBkMenuBtn')
        page.wait_for_selector('#diagKBkPop:not([hidden])', timeout=8000)
        bks = page.locator('#diagKBkPop [data-bk]').evaluate_all('els => els.map(e => e.dataset.bk)')
        assert bks == ['merge', 'replace', 'kb', 'clear'], '「📦 备份 ▾」菜单项不对: %s' % bks
        page.on('dialog', lambda d: d.accept())   # 清空有两次 confirm
        page.click('#diagKBkPop [data-bk="clear"]')
        page.wait_for_timeout(2200)
        left = page.evaluate('''async () => (await chrome.runtime.sendMessage({ action: 'getKnowledgeBase' })).entries.length''')
        assert left == 0, '「🗑 清空知识库」后还剩 %d 条' % left
        print('PASS 知识库「📦 备份 ▾」：四项就位，「🗑 清空知识库」把库清零（0 条）')

        if ERRORS:
            print('PAGEERRORS:'); [print('  ', e) for e in ERRORS]
            raise SystemExit('有 pageerror，见上')
        print('ALL PASS')
    finally:
        ctx.close()
