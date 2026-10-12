import pathlib
import re
import tempfile
import time

from playwright.sync_api import expect, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'


def people(prefix):
    return {'people_options': [
        {'name': f'{prefix}人群{i}', 'pain': '选择困难', 'scene': '准备购买', 'timing': '购买前'}
        for i in range(1, 4)
    ]}


def topics(prefix):
    return {'topics': [{'topic': f'{prefix}话题', 'angle': '选择方法', 'target': '购买前', 'rationale': '解决实际问题'}]}


def reply_people(worker, value, error=''):
    worker.evaluate('''({value, error}) => { self.testPeopleRaw = JSON.stringify(value); self.testPeopleError = error; }''',
                    {'value': value, 'error': error})


def reply_topics(worker, value, error=''):
    worker.evaluate('''({value, error}) => { self.testTopicsRaw = JSON.stringify(value); self.testTopicsError = error; }''',
                    {'value': value, 'error': error})


def goto_pool(page):
    """笔记池已独立成「获客 · 笔记池」二级 rail 项"""
    page.locator('#tabHuoke').click()
    page.locator('#tabPool').click()


with tempfile.TemporaryDirectory(prefix='xhs-note-flows-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.evaluate('''async () => {
            await Storage.initializeDefaults(DEFAULT_PROMPTS);
            await ensureTenantInit();
            const config = await Storage.getConfig();
            config.product.name = '流程测试产品';
            config.product.sellPoints = [
                {title: '省时间', content: '简化重复步骤'},
                {title: '看清选择', content: '比较不同方案'}
            ];
            config.ai.apiKey = 'test-local-only';
            await Storage.setConfig(config);
            self.testPeopleCalls = 0;
            self.testTopicsCalls = 0;
            AiClient.chatCompletion = async (cfg, system) => {
                const isTopics = String(system || '').includes('候选话题');
                if (isTopics) self.testTopicsCalls++; else self.testPeopleCalls++;
                const err = isTopics ? self.testTopicsError : self.testPeopleError;
                await new Promise(resolve => setTimeout(resolve, 200));
                if (err) throw new Error(err);
                return {content: isTopics ? self.testTopicsRaw : self.testPeopleRaw};
            };
        }''')
        reply_people(sw, people('首批'))
        reply_topics(sw, topics('首批'))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof _npWiz !== "undefined" && typeof switchMainTab === "function"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()
        page.locator('#tabNotePublish').click()
        # 发笔记一级项现在落在「笔记档案」，写文案是它的衍生页：从档案页顶那颗按钮起新的一篇
        page.wait_for_function('() => !!document.querySelector("#noteArchiveContent .npar-new")')
        page.evaluate('() => switchMainTab("notePublish", "new")')
        expect(page.locator('.np-spk')).to_have_count(2)
        page.locator('.np-spk').first.check()
        page.locator('.np-wiz-next').click()
        expect(page.locator('.np-ppc')).to_have_count(3)
        expect(page.locator('#npWizBody')).to_contain_text('首批人群1')
        # 用户还没挑人群：这一发只该打「人群」，不该顺手把话题的钱也花了
        assert sw.evaluate('self.testTopicsCalls') == 0, '未选人群就打了话题请求'
        assert sw.evaluate('self.testPeopleCalls') >= 1
        print('PASS: audience step renders from its own AI call and asks for no topics yet')

        page.locator('.np-ppc').first.check()
        page.locator('.np-wiz-next').click()
        expect(page.locator('.np-tpc')).to_have_count(1)
        expect(page.locator('#npWizBody')).to_contain_text('首批话题')
        assert sw.evaluate('self.testTopicsCalls') >= 1
        print('PASS: topics are fetched only after audiences are chosen')

        reply_topics(sw, topics('新批'))
        people_calls, topic_calls = sw.evaluate('[self.testPeopleCalls, self.testTopicsCalls]')
        page.locator('.np-wiz-again').click()
        expect(page.locator('.np-tpc')).to_have_count(1)
        expect(page.locator('#npWizBody')).to_contain_text('新批话题')
        assert page.evaluate('_npWiz.step === 2 && _npWiz.chosenPeople.length === 1'), '换话题不该踢回人群步骤、也不该丢已选人群'
        assert sw.evaluate('self.testTopicsCalls') == topic_calls + 1, '换话题只该打一发'
        assert sw.evaluate('self.testPeopleCalls') == people_calls, '换话题不该再打人群那一发'
        print('PASS: changing topics keeps the chosen audience and stays on the topic step')

        reply_topics(sw, {}, '测试接口失败 <img src=x onerror=alert(1)>')
        page.locator('.np-wiz-again').click()
        expect(page.locator('#npWizBody [role=alert]')).to_contain_text('测试接口失败')
        expect(page.locator('#npWizBody img')).to_have_count(0)
        expect(page.locator('.np-wiz-again')).to_be_enabled()
        # 报错后话题没得选：下一步亮着可点，点了弹提示、原地不跳步（守门按钮软提示化）
        assert page.evaluate('_npWiz.chosenTopicIdx < 0'), '报错后不该有已选话题'
        expect(page.locator('.np-wiz-next')).to_be_enabled()
        page.locator('.np-wiz-next').click()
        expect(page.locator('#popToastBox')).to_contain_text('请先选一个话题')
        assert page.evaluate('_npWiz.step === 2'), '话题没选就点下一步不该走'
        topic_calls = sw.evaluate('self.testTopicsCalls')
        reply_topics(sw, topics('首批'))
        page.locator('.np-wiz-again').click()
        expect(page.locator('.np-tpc')).to_have_count(1)
        assert sw.evaluate('self.testTopicsCalls') == topic_calls + 1, '报错后重试只该再打一发'
        print('PASS: backend error is visible, escaped, and retry remains usable')

        page.locator('.np-wiz-prev').click()   # 回到第②步：人群还在，不用重算
        expect(page.locator('.np-ppc')).to_have_count(3)
        reply_people(sw, {'people_options': []})
        page.locator('.np-wiz-again').click()
        expect(page.locator('#npWizBody [role=alert]')).to_contain_text('未返回有效人群')
        reply_people(sw, people('恢复'))
        page.locator('.np-wiz-again').click()
        expect(page.locator('.np-ppc')).to_have_count(3)
        expect(page.locator('#npWizBody')).to_contain_text('恢复人群1')
        page.locator('.np-ppc').first.check()
        reply_topics(sw, topics('恢复'))
        page.locator('.np-wiz-next').click()
        expect(page.locator('#npWizBody')).to_contain_text('恢复话题')
        print('PASS: empty AI result reports an error and a new batch recovers')

        page.locator('.np-wiz-prev').click()
        page.locator('.np-wiz-prev').click()
        page.locator('.np-spk').first.uncheck()
        page.locator('.np-spk').nth(1).check()
        reply_people(sw, people('改卖点'))
        page.locator('.np-wiz-next').click()
        expect(page.locator('#npWizBody')).to_contain_text('改卖点人群1')
        print('PASS: changing selling points invalidates the previous audience list')

        first = {'noteId': 'a' * 24, 'title': '搜索首屏测试笔记', 'likes': '1.2万'}
        second = {'noteId': 'b' * 24, 'title': '搜索首屏测试笔记', 'likes': '23'}
        third = {'noteId': 'c' * 24, 'title': '翻屏测试笔记', 'likes': '56'}
        sw.evaluate('''async notes => {
            self.testSearchNotes = notes;
            AutoWater._searchGen = 1;
            AutoWater._getXhsTab = async () => ({id: 123, url: 'https://www.xiaohongshu.com/search_result?keyword=test'});
            chrome.tabs.update = async (id, value) => ({id, ...value});
            AutoWater._waitForTabLoad = async () => {};
            AutoWater._sleep = async () => {};
            AutoWater._send = async (id, message) => {
                if (message.action === 'extractSearchResults') return {notes: self.testSearchNotes};
                if (message.action === 'scrollLoadMore') return {notes: self.testNextNotes, hasMore: true};
                throw new Error('Unexpected test page action: ' + message.action);
            };
            // 搜索动作清单（关键词 × 派生类型）由 startSearch 生成，这里直接种一份等价的：
            // _doSearchNotes 只认 searchState.plan，没有 plan 会直接 return（啥也扫不到）
            await Storage.setAutoWaterState({phase: 'IDLE', searchState: {
                keywords: ['测试词'], searching: true, foundNotes: [], completedKeywords: 0,
                currentKeyword: '测试词',
                plan: [{k: '测试词', scenario: 'top', term: '测试词', sort: 'top'}],
            }});
            await AutoWater._doSearchNotes();
        }''', [first, second])
        goto_pool(page)
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(2)
        print('PASS: search discoveries enter interception before opening or extracting comments')

        sw.evaluate('notes => { self.testNextNotes = notes; }', [third])
        result = page.evaluate('async () => chrome.runtime.sendMessage({action: "advanceResults"})')
        assert result['ok'], result
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(3)
        expect(page.locator('#drainContent #sxList')).to_contain_text('翻屏测试笔记')
        assert sw.evaluate('async () => (await Storage.getAutoWaterState()).searchResults.map(n => n.noteId)') == [third['noteId']]
        print('PASS: next screen updates the acquisition snapshot and the visible interception list')

        # 数据列拆成三列（2026-09-25 二十九改）：点赞 / 评论 / 二级评论 各占一列，别再并回一格
        expect(page.locator('#drainContent #sxList thead th')).to_have_text(
            ['类型', '笔记', '点赞', '评论', '二级评论', '判定 · 我的评论', '操作'])
        pool_row = page.locator('#drainContent #sxList tbody tr').first
        expect(pool_row.locator('td.sx-t-num')).to_have_count(3)
        assert pool_row.locator('td.sx-t-num.sx-t-sub').count() == 1, '二级评论那一列要能单独认出来'
        assert page.locator('#drainContent #sxList td.sx-t-num').first.get_attribute('title') == '打开这篇时从评论区数到的点赞数'
        print('PASS: note-pool data column splits into likes / comments / sub-comments')

        page.locator('#sxFilter').select_option('pain')
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(0)
        page.locator('#sxFilter').select_option('all')
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(3)
        print('PASS: scenario filtering remains usable after live storage updates')

        # 关键词 × 筛选 → 笔记类型：行内可改类型，改完落库并参与列表过滤
        types = page.locator('#drainContent #sxList tbody tr select[data-scenario]')
        assert types.count() == 3, types.count()
        assert types.first.input_value() == 'top', 'no sort filter (综合) derives 搜索TOP'
        # 「全部类型」+ SCENARIO_DRAIN 的每一类；从源头数，别再跟着类型模型改版一起烂
        _sd = (EXT / 'lib' / 'scenario-drain.js').read_text(encoding='utf-8')
        _sd = _sd.split('const SCENARIO_DRAIN = [', 1)[1].split('\n];', 1)[0]
        expect(page.locator('#sxFilter').locator('option')).to_have_count(1 + len(re.findall(r"scenario: '", _sd)))
        types.first.select_option('latest')
        assert page.evaluate('async () => (await drainLoad())[0].scenario') == 'latest'
        page.locator('#sxFilter').select_option('latest')
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(1)
        page.locator('#sxFilter').select_option('top')
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(2)
        page.locator('#sxFilter').select_option('all')
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(3)
        print('PASS: pool rows carry the search-derived type and can be re-typed in place')

        # 扫描来源 = 关键词池 × 派生类型（属地/求助词/TOP 排序）；配置在左栏「获客 · ⚙️ 任务配置」
        # （2026-09-25：三级 tab 的「⋯ 更多设置」已撤，页内只剩 📚关键词池 / 👤盯的账号 两节；
        #   「本轮将扫描 N 个来源」那行预览也一并撤了——来源数直接按真源 drainBuildSources 算）
        def cfg_sec(name):
            page.locator(f'#sxCfgTabs [data-sec="{name}"]').click()

        def sources():
            return page.evaluate('''async () => drainBuildSources(await drainGetScanCfg())
                .map(s => s.scenario + '|' + s.term + '|' + (s.sort || ''))''')

        def wait_src(pred, msg, timeout=10000):
            end = time.time() + timeout / 1000
            last = None
            while time.time() < end:
                last = sources()
                if pred(last):
                    return last
                page.wait_for_timeout(200)
            raise AssertionError('%s（实测 %s）' % (msg, last))

        page.locator('#tabTaskCfg').click()
        expect(page.locator('#tabTaskCfg')).to_have_class(re.compile(r'\bactive\b'))
        cfg = page.locator('#drainCfgContent')
        expect(cfg.locator('#sxCfgTabs [data-sec="kw"]')).to_have_class(re.compile(r'\bactive\b'))
        assert cfg.locator('#sxCfgTabs [data-sec="more"]').count() == 0, '「⋯ 更多设置」三级 tab 该已撤'
        # 四节固定：📚关键词池 / 👤盯的账号 / 🎯推广目标（2026-09-25 从诊断 ① 搬来）+ 🌿 日常浏览（2026-09-27 落地）
        expect(cfg.locator('#sxCfgTabs .sx-cfgtab')).to_have_text(
            ['📚 关键词池', '👤 盯的账号', '🎯 推广目标', '🌿 日常浏览'])
        expect(cfg.locator('#sxKwAdd')).to_be_visible(timeout=20000)

        # 属地真源＝诊断&配置 ①「同城城市」，配置页里不该有第二个入口。
        # 写配置走后台（弹窗页没有 storage.js 的 Storage，只有原生 DOM Storage；页面侧读的是 readConfigPlain）
        sw.evaluate('''async () => {
            const c = await Storage.getConfig();
            c.myCity = c.myCity || {};
            c.myCity.city = '深圳';
            await Storage.setConfig(c);
        }''')
        assert cfg.locator('#sxCity').count() == 0, '任务配置页还有属地输入框（该跟诊断 ① 共用一份）'

        cfg.locator('#sxKwAdd').fill('装修')
        cfg.locator('#sxKwAdd').press('Enter')
        got = wait_src(lambda s: any('装修' in x for x in s), '加词后没派生出搜索来源')
        scen = {}
        for x in got:
            scen.setdefault(x.split('|')[0], []).append(x)
        assert len(scen.get('top', [])) == 3, '「搜索TOP」该派生三种排序: %s' % got
        assert scen.get('local') == ['local|装修 深圳|latest'], '「本地」没带诊断 ① 的属地: %s' % got
        assert len(scen.get('pain', [])) == 4, '「求助」该按 4 个求助词各派一搜: %s' % got
        assert 'rival' not in scen, '🕵️竞对那列默认不勾，不该有来源: %s' % got
        n_all = len(got)
        print('PASS: 扫描来源按词 × 类型派生（%d 个：最新 1 + TOP 3 + 本地 1 + 求助 4，属地取自诊断 ①）' % n_all)

        # 关一类＝把那一列的「节奏」设成不跑（v4 起 typeRun 是真源，不再有整类勾选框）
        cfg_sec('kw')
        cfg.locator('select[data-trun="top"]').select_option('off')
        wait_src(lambda s: not any(x.startswith('top|') for x in s), 'TOP 那列设成「不跑」后来源没少掉')
        cfg.locator('select[data-trun="top"]').select_option('each')
        back = wait_src(lambda s: len(s) == n_all, 'TOP 改回「每轮跑」后来源没回来')
        # 列表页那行概览跟真源同数：词池 N 个启用 · 本轮到点 M 个来源
        goto_pool(page)
        line = page.locator('#sxSrcLine')
        expect(line).to_contain_text('本轮到点')
        expect(line).to_contain_text(str(n_all))
        print('PASS: 节奏一列管一类（TOP 关掉 %d→%d，开回 %d）；列表页概览行跟真源同数' % (n_all, n_all - 3, len(back)))

        legacy = {'noteId': 'd' * 24, 'title': '已缓存获客笔记', 'likes': '7'}
        page.locator('#tabNotePublish').click()
        sw.evaluate('''async note => {
            const state = await Storage.getAutoWaterState();
            state.searchState.foundNotes = [note];
            state.searchResults = [note];
            await Storage.setAutoWaterState(state);
        }''', legacy)
        goto_pool(page)
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(4)
        expect(page.locator('#drainContent #sxList')).to_contain_text('已缓存获客笔记')
        print('PASS: opening interception imports existing cached acquisition results without scanning')
        sw.evaluate('async note => handleDrainTrackNote({...note, likes: 99})', legacy)
        page.locator('#tabNotePublish').click()
        goto_pool(page)
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(4)
        expect(page.locator('#drainContent #sxList tbody tr').filter(has_text='已缓存获客笔记')).to_contain_text('99')
        print('PASS: re-entering interception does not overwrite fresh metrics with cached discoveries')

        opened = {'noteId': 'e' * 24, 'title': '未提取评论的笔记'}
        sw.evaluate('''async note => {
            AutoWater._getXhsTab = async () => null;
            await AutoWater.openNote(note);
        }''', opened)
        expect(page.locator('#drainContent #sxList tbody tr')).to_have_count(5)
        print('PASS: opening a known note registers it even before comment extraction')

        # 活水读取器（content.js extractMyComment）：在评论区里定位「我的评论」的位置与点赞
        content_src = (EXT / 'content.js').read_text(encoding='utf-8')
        water = ctx.new_page()
        water.set_content('''
          <div style="height:100vh;overflow:auto;">
            <div style="height:50vh;">笔记正文</div>
            <div class="comments" style="min-height:70vh;">
              <div class="total">共 3 条评论</div>
              <div class="comment-item"><a href="/user/u1">路人甲</a><div class="content">先收藏了</div><span class="like">12</span></div>
              <div class="comment-item"><a href="/user/u2">我的账号</a><div class="content">我去年也踩过这个坑</div><span class="like">1.2万</span></div>
              <div class="comment-item"><a href="/user/u3">路人乙</a><div class="content">同问</div><span class="like">3</span></div>
            </div>
          </div>''')
        water.evaluate('''src => {
            window.__msgs = [];
            window.chrome = {
                runtime: { onMessage: { addListener: fn => window.__msgs.push(fn) }, sendMessage: async () => ({ ok: true }) },
                storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {}, removeListener: () => {} } },
            };
            eval(src);
        }''', content_src)
        ask = '''names => new Promise(resolve => {
            const handled = window.__msgs.some(fn => fn({ action: 'extractMyComment', names }, {}, resolve) === true);
            if (!handled) resolve(null);
        })'''
        hit = water.evaluate(ask, ['我的账号'])
        assert hit['ok'] and hit['found'], hit
        assert (hit['rank'], hit['likes'], hit['total']) == (2, 12000, 3), hit
        assert '踩过这个坑' in hit['excerpt'], hit
        miss = water.evaluate(ask, ['并不存在的昵称'])
        assert miss['ok'] and not miss['found'] and miss['rank'] == 0 and miss['total'] == 3, miss
        water.close()
        print('PASS: liveness reader reports my comment position/likes and misses cleanly')

        assert not errors, errors
        screenshot = pathlib.Path(tempfile.gettempdir()) / 'xhs-note-flows-drain.png'
        page.screenshot(path=str(screenshot), full_page=True)
        print('PASS: no browser page errors')
        print('SCREENSHOT:', screenshot)
    finally:
        ctx.close()
