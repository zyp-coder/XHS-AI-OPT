"""🛰 新消息监听（哨兵）行为回归：真浏览器 + 临时 profile + 未打包 extension/，用桩页面喂 DOM。

盯的是这条链上的七件事（都是读一眼就能验的）：
  · 哨兵只看不滚：watchPeek 从已渲染的 DOM 读出「会话数 / 未读数 / 带 * 的 convId」，页面上零改动
  · 变化才动手：同一页面第一次只建基线；DOM 真变了才升级去抓（runMsgCenterCycle / handleCollectLikersFromNotif）
  · 顺手跟单：真抓完跑一次 runAutoTouchCycle（命中一次只跑一次；建基线 / 没变化 / 冷却期都不跑）
  · 冷却不抖：60s 内再来变化只记 cooling，不再连发真抓
  · 外显：私信未读数上扩展图标角标；关掉时清空角标 + 清闹钟 + 收掉监听页
  · 分页分工：💧灌水工作台（队列页）采集永不碰；🎧客服工作台 / 🛰监听页只有「本就停在目标页」时才借（零导航）
  · 专属监听页：开监听才建（后台待命停在 /chat、归页组「🛰 监听页」）；哨兵和采集都优先用它；
    别的引擎不许认领它；绑定丢了按页组标题认回来；关监听收掉它；页面全关光时哨兵也绝不开窗

/xiaohongshu.com/chat 由 route 应答成桩页（content.js 由 manifest 自动注入），
直接调 SW 里的 runMsgWatchTick() —— 闹钟到点走的就是它，省掉等 30s。
用法：python3 scripts/dev/check_msg_watch.py
"""
import pathlib
import re
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'

CHAT_BODY = """<div id="list">
  <div class="xhs-im-conv-item" data-conv-id="c1"><span class="name">张三</span><span class="unread-badge">2</span></div>
  <div class="xhs-im-conv-item" data-conv-id="c2"><span class="name">李四</span></div>
  <div class="xhs-im-conv-item" data-conv-id="c3"><span class="name">王五</span></div>
</div>"""

CHAT_HTML = ('<!doctype html><html><head><meta charset="utf-8"><title>chat stub</title></head><body>'
             + CHAT_BODY + '</body></html>')

EXPLORE_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>explore stub</title></head><body>
<a aria-label="消息" href="/chat"><span class="badge-count">5</span></a>
</body></html>"""

NOTIF_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>notification stub</title></head><body>
<div id="notif-list"><div class="notification-item"><span class="name">小张</span><span>赞了你的笔记</span></div></div>
</body></html>"""


def snap(sw, url_has):
    """地址里含 url_has 的那个 tab 的 watchPeek 结果（content.js 还没注入时返回 None）"""
    return sw.evaluate('''async (frag) => {
        const ts = await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' });
        const t = ts.find(x => (x.url || '').includes(frag));
        if (!t) return null;
        return await new Promise(r => chrome.tabs.sendMessage(t.id, { action: 'watchPeek' }, res => r(res || null)));
    }''', url_has)


def wait_peek(sw, url_has, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        r = snap(sw, url_has)
        if r:
            return r
        time.sleep(0.4)
    raise AssertionError('%s 上 content.js 没应答 watchPeek（注入失败？）' % url_has)


def store(sw):
    return sw.evaluate('''async () => {
        const d = await chrome.storage.local.get(['msg_watch_on', 'msg_watch_state', 'msg_watch_log']);
        const badge = await new Promise(r => chrome.action.getBadgeText({}, r));
        const arm = await new Promise(r => chrome.alarms.get('msg-watch', a => r(a || null)));
        return { on: d.msg_watch_on, state: d.msg_watch_state || {}, log: d.msg_watch_log || [], badge, arm };
    }''')


def evs(s, ev):
    return [e for e in s['log'] if e['ev'] == ev]


def mw_tab(sw):
    """当前绑定的 🛰监听页（带页组标题）；没绑定返回 None，绑定在页没了返回 {gone:True}"""
    return sw.evaluate('''async () => {
        const b = (await chrome.storage.session.get('_engine_tabs'))._engine_tabs || {};
        if (!b.mw) return null;
        let t = null;
        try { t = await chrome.tabs.get(b.mw); } catch (_) { return { id: b.mw, gone: true }; }
        let group = '';
        if (t.groupId != null && t.groupId >= 0) {
            group = await new Promise(r => chrome.tabGroups.get(t.groupId, g => r((g || {}).title || '')));
        }
        return { id: t.id, url: t.url, active: !!t.active, group };
    }''')


def n_xhs(sw):
    return sw.evaluate("async () => (await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' })).length")


def bind(sw, obj):
    sw.evaluate('(b) => chrome.storage.session.set({ _engine_tabs: b })', obj)


def add_conv(sw, tab_id, cid, name='新同学'):
    """在指定页的会话列表顶部插一条带未读的会话（从扩展侧注入改 DOM，不经过 Playwright 的 page 对象）"""
    sw.evaluate('''async (a) => {
        await chrome.scripting.executeScript({ target: { tabId: a.id }, func: (cid, name) => {
            const d = document.createElement('div');
            d.className = 'xhs-im-conv-item';
            d.setAttribute('data-conv-id', cid);
            d.innerHTML = '<span class="name">' + name + '</span><span class="unread-badge">1</span>';
            document.getElementById('list').prepend(d);
        }, args: [a.cid, a.name] });
    }''', {'id': tab_id, 'cid': cid, 'name': name})


def seed_stub(sw, tab_id, body=CHAT_BODY):
    """扩展自建的页「首次导航」跑在 Playwright 的 route 拦截之外（真机上本来就是真页面，逻辑一样）：
    把同一份桩 DOM 注进那页，后面哨兵读到的就是我们要喂的内容"""
    sw.evaluate('''async (a) => {
        await chrome.scripting.executeScript({ target: { tabId: a.id }, func: (html) => {
            document.body.innerHTML = html;
        }, args: [a.html] });
    }''', {'id': tab_id, 'html': body})


def stub_sendtab(sw, on):
    if on:
        sw.evaluate('''() => {
            globalThis.__sentTo = [];
            globalThis.__sendTabMsg = sendTabMsg;
            sendTabMsg = async (id, msg) => { globalThis.__sentTo.push([id, (msg || {}).action]); return { success: false, error: 'stub' }; };
        }''')
    else:
        sw.evaluate('() => { sendTabMsg = globalThis.__sendTabMsg; }')


with tempfile.TemporaryDirectory(prefix='xhs-mw-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        ctx.route(re.compile(r'^https://www\.xiaohongshu\.com/chat'), lambda route: route.fulfill(
            status=200, content_type='text/html; charset=utf-8', body=CHAT_HTML))
        ctx.route(re.compile(r'^https://www\.xiaohongshu\.com/explore'), lambda route: route.fulfill(
            status=200, content_type='text/html; charset=utf-8', body=EXPLORE_HTML))
        ctx.route(re.compile(r'^https://www\.xiaohongshu\.com/notification'), lambda route: route.fulfill(
            status=200, content_type='text/html; charset=utf-8', body=NOTIF_HTML))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        errors, logs = [], []
        sw.on('console', lambda m: (errors if m.type == 'error' else logs).append(m.text))

        page = ctx.new_page()
        page.goto('https://www.xiaohongshu.com/chat')
        peek = wait_peek(sw, '/chat')
        assert peek['page'] == 'chat' and peek['n'] == 3, '哨兵没读出会话列表: %s' % peek
        assert peek['unread'] == 1 and peek['convIds'][0] == 'c1*', '未读标记没认出来: %s' % peek
        assert page.evaluate('''() => [document.scrollingElement.scrollTop,
            document.querySelectorAll('div.xhs-im-conv-item').length]''') == [0, 3], '哨兵动了页面（滚动/增删节点）'
        print('PASS 哨兵读一眼：会话 %s 条 / 未读 %s（%s）· 页面零改动' % (peek['n'], peek['unread'], peek['convIds'][0]))

        # 其它页：左侧导航角标兜底信号（选择器未定时用来探路）
        # 这个 tab 留着不关：一会儿把它切到前台，让别的页变成「后台 tab」——真抓只碰后台页，不碰你正在看的页
        page2 = ctx.new_page()
        page2.goto('https://www.xiaohongshu.com/explore')
        peek2 = wait_peek(sw, '/explore')
        assert peek2['page'] == 'other' and peek2['navBadges'], '别的页没抓导航角标: %s' % peek2
        assert any('5' in b for b in peek2['navBadges']), '导航角标数字没抓到: %s' % peek2['navBadges']
        print('PASS 其它页：只读导航角标做兜底信号（%s）' % peek2['navBadges'][0])

        # 开监听：写 storage + 排一次性闹钟 + 建「🛰 监听页」（后台待命、停在 /chat、归自己的页组）
        n_before_enable = n_xhs(sw)
        sw.evaluate('() => handleSetMsgWatch({ enabled: true, tickSec: 30 })')
        s = store(sw)
        assert s['on'] is True and s['arm'] and 'periodInMinutes' not in s['arm'], '开监听没排一次性闹钟: %s' % s['arm']
        mw = mw_tab(sw)
        assert mw and '/chat' in mw['url'], '开监听没建出自己的监听页: %s' % mw
        assert mw['active'] is False, '监听页建出来抢了前台: %s' % mw
        assert mw['group'] == '🛰 监听页', '监听页没归页组「🛰 监听页」: %s' % mw
        assert n_xhs(sw) == n_before_enable + 1, '建监听页多开了/少开了页: %s → %s' % (n_before_enable, n_xhs(sw))
        seed_stub(sw, mw['id'])          # 让这页有会话 DOM 可读（首次导航躲开了 route 拦截）
        sw.evaluate('() => new Promise(r => chrome.alarms.clear("msg-watch", r))')   # 后面手工 tick，别让 30s 闹钟插进来
        time.sleep(0.5)
        print('PASS 开监听建监听页：%s 后台待命停在 /chat，归页组「%s」' % (mw['url'], mw['group']))

        # 给「顺手跟单」装计数桩：真跑在测试环境里是空跑（无 prospect / 无 AI 通路）读不出「跑没跑」，
        # 换成桩数次数；先自检桩确实顶掉了真函数（runAutoTouchCycle 是顶层的可改绑定）
        sw.evaluate('''() => {
            globalThis.__touchCalls = 0;
            const _orig = runAutoTouchCycle;
            runAutoTouchCycle = async () => { globalThis.__touchCalls++; return { sent: 0, queued: 0 }; };
            globalThis.__touchOrig = _orig;
        }''')
        assert sw.evaluate('''async () => {
            globalThis.__touchCalls = 0;
            await runAutoTouchCycle();
            const ok = globalThis.__touchCalls === 1;
            globalThis.__touchCalls = 0;
            return ok;
        }'''), '跟单计数桩没装上（runAutoTouchCycle 不是可改的全局绑定？）'
        calls = lambda: sw.evaluate('() => globalThis.__touchCalls')

        # 第一眼只建基线：不该升级去抓（读的就是自己那一页）
        sw.evaluate('() => runMsgWatchTick()')
        s = store(sw)
        assert s['badge'] == '1', '未读数没上角标: %r' % s['badge']
        assert s['state'].get('chat', {}).get('unread') == 1 and s['state']['chat'].get('page') == 'chat', 'chat 通道基线没建: %s' % s['state']
        assert not evs(s, 'hit'), '第一次就误判成变化: %s' % evs(s, 'hit')
        assert calls() == 0, '建基线就顺手跑了跟单'

        # 别的 /chat 页（诱饵）变了不算变化：哨兵只读自己那一页
        page.wait_for_timeout(300)
        decoy_id = sw.evaluate('''async (exc) => {
            const ts = await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' });
            return (ts.find(t => /\\/chat/.test(t.url || '') && t.id !== exc) || {}).id;
        }''', mw['id'])
        assert decoy_id, '没找到诱饵 /chat 页'
        add_conv(sw, decoy_id, 'cX', '诱饵')
        sw.evaluate('() => runMsgWatchTick()')
        s = store(sw)
        assert not evs(s, 'hit'), '读了诱饵页（不是自己的监听页）: %s' % s['log'][:3]
        assert s['state']['chat'].get('unread') == 1, '基线被诱饵页带偏: %s' % s['state']['chat']
        print('PASS 无变化不打扰：两次 tick 只建基线（角标 %s，零抓取；诱饵页变了也不算）' % s['badge'])

        # DOM 真变了（自己的监听页上新来一条未读）：才升级去抓，并记 lastEscalateAt
        page2.bring_to_front()          # 把别的 xhs 页放前台 → 监听页成后台页（真抓只动后台页，不抢前台）
        page.wait_for_timeout(300)
        add_conv(sw, mw['id'], 'c9')
        sw.evaluate('() => runMsgWatchTick()')
        s = store(sw)
        hits = evs(s, 'hit')
        assert len(hits) == 1 and hits[0]['hit'] == 'chat', '有变化没升级: %s' % s['log'][:3]
        assert s['state'].get('lastEscalateAt'), '升级了没记冷却时间: %s' % s['state']
        assert s['badge'] == '2', '角标没跟着涨: %r' % s['badge']
        first_esc = s['state']['lastEscalateAt']
        # 升级真抓了：采集器读过一遍监听页（3 条基线 + 新来的 c9 = 4 条；诱饵页那 4+1 条没被读）
        merged = [t for t in logs if '合并周期：读列表=' in t]
        assert merged and int(merged[-1].split('读列表=')[1].split()[0]) == 4, '升级没真去读监听页的列表: %s' % logs[-2:]
        front = sw.evaluate('async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url')
        assert '/explore' in front, '真抓时把前台抢到 %s 去了' % front
        assert calls() == 1, '命中抓完没顺手跑跟单（或跑多了）: %s 次' % calls()
        print('PASS 有变化才抓 + 顺手跟单：命中 chat → 用自己的监听页静默读一次列表（4 条）+ 跑一次跟单（角标 %s）' % s['badge'])

        # 60s 冷却：再来一条也只记 cooling，不再连发真抓
        add_conv(sw, mw['id'], 'c10', '又一位')
        sw.evaluate('() => runMsgWatchTick()')
        s = store(sw)
        assert len(evs(s, 'hit')) == 1 and evs(s, 'cooling'), '冷却没拦住连发: %s' % s['log'][:3]
        assert s['state']['lastEscalateAt'] == first_esc, '冷却期还是升级了'
        assert len([t for t in logs if '合并周期：读列表=' in t]) == 1, '冷却期又抓了一次'
        assert calls() == 1, '冷却期却顺手跑了跟单: %s 次' % calls()
        print('PASS 冷却 60s：变化不断也只记 cooling（不再连发真抓、不重复跟单）')

        # 浏览器重启后绑定会丢：按页组标题把监听页认回来（认不回来才补建）——这里模拟"绑定丢了、页还在"
        bind(sw, {})
        n0 = n_xhs(sw)
        back = sw.evaluate('''async () => { const t = await _mwOwnTab(); return t ? t.id : null; }''')
        assert back == mw['id'], '绑定丢了没按页组标题认回监听页: %s（期望 %s）' % (back, mw['id'])
        assert n_xhs(sw) == n0, '认回时多开了一页: %s → %s' % (n0, n_xhs(sw))
        print('PASS 重启认回：绑定丢了也能按页组标题「🛰 监听页」认回原页（不重复开窗）')

        # 后面分页分工要干净的现场：只留监听页（+ 一个非小红书的前台页）
        page.close(); page2.close()
        time.sleep(0.5)

        # 工作台页归业务：💧灌水工作台（队列执行器）即使是非前台，silent 采集也不挑它、不导航它
        pa = ctx.new_page(); pa.goto('https://www.xiaohongshu.com/explore?bench=1')
        blank = ctx.new_page()          # 把 pa 挤到后台（非前台）
        time.sleep(0.3)
        pa_id = sw.evaluate('''async () => {
            const ts = await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' });
            return (ts.find(t => (t.url || '').includes('bench=1')) || {}).id;
        }''')
        assert pa_id, '没造出工作台页'
        bind(sw, {'water': pa_id, 'mw': mw['id']})
        stub_sendtab(sw, True)
        sw.evaluate('''async () => {
            try { await handleGetChatConversations({ silent: true }); } catch (e) {}
        }''')
        sent_a = sw.evaluate('() => globalThis.__sentTo')
        stub_sendtab(sw, False)
        url_after = sw.evaluate('(id) => new Promise(r => chrome.tabs.get(id, t => r((t || {}).url || "")))', pa_id)
        assert 'bench=1' in url_after, '采集把工作台页导航走了: %s' % url_after
        assert not any(i == pa_id for i, a in sent_a), '采集挑了工作台页: %s' % sent_a
        assert any(i == mw['id'] and a == 'collectChatConversations' for i, a in sent_a), '采集没去用监听页: %s' % sent_a
        print('PASS 工作台页归业务：💧队列工作台不被采集挑中/导航（采集改走 🛰监听页）')

        # 🎧 例外要窄：绑成客服工作台、但停在别的地址 → 照样不借、不导航
        blank.bring_to_front()
        bind(sw, {'touch': pa_id, 'mw': mw['id']})
        r2 = sw.evaluate('''async () => {
            try { await handleCollectLikersFromNotif({ silent: true }); return 'ran'; }
            catch (e) { return 'skip'; }
        }''')
        url2 = sw.evaluate('(id) => new Promise(r => chrome.tabs.get(id, t => r((t || {}).url || "")))', pa_id)
        assert r2 == 'skip' and 'bench=1' in url2, '客服工作台停在别的地址时也不该被借: %s / %s' % (r2, url2)
        print('PASS 例外很窄：🎧客服工作台停在别的地址时，采集照样不借（不导航它）')

        # 🎧 例外本尊：本就停在 /notification 的客服工作台可以借它读一遍（零导航＝不打断它自己的活）
        pn = ctx.new_page(); pn.goto('https://www.xiaohongshu.com/notification?bench=2')
        time.sleep(0.3)
        pn_id = sw.evaluate('''async () => {
            const ts = await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' });
            return (ts.find(t => (t.url || '').includes('bench=2')) || {}).id;
        }''')
        assert pn_id, '没造出通知桩页'
        bind(sw, {'touch': pn_id, 'mw': mw['id']})
        blank.bring_to_front()          # pn 变后台
        time.sleep(0.3)
        stub_sendtab(sw, True)
        sw.evaluate('() => handleCollectLikersFromNotif({ silent: true }).catch(() => {})')
        time.sleep(1.5)
        sent = sw.evaluate('() => globalThis.__sentTo')
        stub_sendtab(sw, False)
        url3 = sw.evaluate('(id) => new Promise(r => chrome.tabs.get(id, t => r((t || {}).url || "")))', pn_id)
        assert any(i == pn_id and a == 'collectLikers' for i, a in sent), '停在目标页的客服工作台没被借: %s' % sent
        assert 'bench=2' in url3, '借它读的时候把页导航走了: %s' % url3
        print('PASS 例外本尊：🎧客服工作台本就停在 /notification 时借它读一遍（零导航，读完原地不动）')

        # 🛰 监听页也归业务：卡在 /chat 待命的监听页不得被通知采集搬去 /notification（搬走＝私信通道没了）
        pa.close(); pn.close(); blank.close()
        time.sleep(0.4)
        bind(sw, {'mw': mw['id']})
        front2 = ctx.new_page()         # 非小红书的前台页：让监听页是唯一的小红书页、又在后台
        r4 = sw.evaluate('''async () => {
            try { await handleCollectLikersFromNotif({ silent: true }); return 'ran'; }
            catch (e) { return 'skip'; }
        }''')
        mw4 = mw_tab(sw)
        assert r4 == 'skip' and '/chat' in mw4['url'], '通知采集把待命的监听页搬走了: %s / %s' % (r4, mw4)
        print('PASS 监听页归业务：🛰待在 /chat 的监听页不被通知采集搬走（不导航它）')

        # 谁都不认领谁：监听页是唯一的小红书页时，💧引擎要页也不许认领它——宁可自建一页
        n_before_new = n_xhs(sw)
        t2 = sw.evaluate('''async () => { const t = await getEngineTab('water'); return { id: t.id }; }''')
        assert t2['id'] != mw['id'], '灌水引擎把监听页认领走了: %s' % t2
        assert n_xhs(sw) == n_before_new + 1, '灌水引擎没有自建新页: %s → %s' % (n_before_new, n_xhs(sw))
        sw.evaluate('(id) => chrome.tabs.remove(id)', t2['id'])
        bind(sw, {'mw': mw['id']})
        time.sleep(0.4)
        assert '/chat' in mw_tab(sw)['url'], '监听页被动过: %s' % mw_tab(sw)
        print('PASS 谁都不认领谁：💧引擎要页时自建新页，不搬 🛰监听页')

        # 没有可用的小红书页：本轮直接跳过——绝不替你开窗（tick 不报错、tab 数不变）
        sw.evaluate('(id) => chrome.tabs.remove(id)', mw['id'])
        front2.close()
        time.sleep(0.5)
        n_before = n_xhs(sw)
        sw.evaluate('() => runMsgWatchTick()')
        time.sleep(1.0)
        n_after = n_xhs(sw)
        s = store(sw)
        assert n_before == 0 and n_after == 0, '没页面时哨兵自己开窗了: %s → %s' % (n_before, n_after)
        assert evs(s, 'no-page'), '没页面时没记 no-page: %s' % s['log'][:3]
        assert not errors, '没页面时 tick 报错: %s' % errors[:3]
        print('PASS 没开着小红书页：本轮跳过，不开窗、不报错')

        # 关掉：收掉监听页 + 清绑定 + 清闹钟 + 清角标
        sw.evaluate('() => _mwOwnTab()')
        time.sleep(1.0)
        assert mw_tab(sw), '监听页没建回来'
        sw.evaluate('() => handleSetMsgWatch({ enabled: false })')
        time.sleep(0.5)
        s = store(sw)
        assert s['on'] is False and s['arm'] is None, '关监听没清闹钟: %s' % s['arm']
        assert s['badge'] == '', '关监听没清角标: %r' % s['badge']
        assert not mw_tab(sw), '关监听没解绑监听页: %s' % mw_tab(sw)
        assert n_xhs(sw) == 0, '关监听没收掉监听页: %s 个小红书页还开着' % n_xhs(sw)
        print('PASS 关掉：收掉监听页、绑定已清、闹钟已清、角标已清')

        assert not errors, 'SW 里冒了 error: %s' % errors[:3]
        print('ALL PASS')
    finally:
        ctx.close()
