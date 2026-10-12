"""发布队列冒烟（二十六改「视频号三家」落进真实扩展后的第一道端到端）。

盯的是刚接上的那条链：周排 → 队列行 → 到点闹钟（background）→ 适配稿（无 Key 时走 retry）
→ 队列页渲染（视频篇 📕🎵🎥 三家 / 图文篇 📕🎵 两家）→ 平台章点暗写库 → 时间改点后闹钟重排
→ ▶ 手动跑（无 Key 应报「这趟没改成」且不落假回执）。

跑法：python3 scripts/dev/_smoke_pub_queue.py（需要 msedge；临时 profile，不动真身数据）
"""
import datetime
import os
import pathlib
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

try:  # Windows 控制台默认 GBK，print 里带 📕🎵🎥 会直接炸；切 UTF-8
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(os.environ.get('XHS_ROOT') or '.').resolve()
EXT = ROOT / 'extension'

# 期望到点 = 第 2 周周三 19:00：与 npQueueRows / _npPubBgSlotDay 同口径算一遍
# （JS getDay：周日=0，周一=1…周六=6；nextMon=((1-tIdx+7)%7)||7；w2:wed = nextMon + 2 天）
_today = datetime.date.today()
_t_idx = _today.isoweekday() % 7
_next_mon = ((1 - _t_idx + 7) % 7) or 7
W2_WED = _today + datetime.timedelta(days=_next_mon + 2)
EXPECT_19 = datetime.datetime.combine(W2_WED, datetime.time(19, 0)).timestamp() * 1000
EXPECT_08 = EXPECT_19 - 11 * 3600 * 1000
VID_LINE = 'w2:wed:知识|nvid001'


def near(a, b, tol=2000):
    return bool(a) and abs(a - b) <= tol


with tempfile.TemporaryDirectory(prefix='xhs-pubq-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        sw.on('console', lambda m: print('[SW]', m.type, m.text[:300]))
        page = ctx.new_page()
        page_errors = []
        page.on('pageerror', lambda e: (page_errors.append(str(e)[:300]), print('[popup pageerror]', str(e)[:300])))
        page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof switchMainTab === "function" && typeof npWeekPlanSave === "function"')

        # ── 备料：两篇档案（视频篇待发＋已交片 / 图文篇草稿）＋队列两行＋视频行定 19:00 ──
        page.evaluate('''async () => {
            await chrome.storage.local.set({
                np_notes: [
                    { id: 'nvid001', title: '冒烟·视频篇', status: '待发', form: '视频', draft: '视频篇的标题\\n\\n视频篇的正文' },
                    { id: 'nimg001', title: '冒烟·图文篇', status: '草稿', form: '图文', draft: '图文篇的标题\\n\\n图文篇的正文' },
                ],
                note_queue: { 'w2:wed:知识': ['nvid001'], 'w3:thu:引流': ['nimg001'] },
                np_queue_times: { 'w2:wed:知识|nvid001': '19:00' },
                np_pub_files: { nvid001: { kind: 'video', n: 1, need: 1 } },
                np_pub_plats: {}, np_pub_watch: {}, np_pub_log: [], np_pub_ran: {},
            });
            await npWeekPlanSave({ wed: ['知识'], thu: ['引流'] });
        }''')
        # 临时 profile 没配 AI → 首次设置那块全屏罩子会压住队列、挡真点击；摘掉它（真实用户配过 Key 后不长这样）
        page.evaluate("document.getElementById('firstSetupPanel')?.remove()")

        # ── ① 后台重排闹钟：下一篇到点 = 第 2 周周三 19:00 ──
        alarm = sw.evaluate('''async () => {
            await _npPubBgRearm();
            const a = await chrome.alarms.get('np-pub-tick');
            return a ? a.scheduledTime : 0;
        }''')
        assert near(alarm, EXPECT_19), f'① 闹钟没排到第2周周三19:00：got {alarm} want {EXPECT_19}（{W2_WED}）'
        rows = sw.evaluate('async () => (await _npPubBgRows()).map(r => r.lineKey).sort()')
        assert rows == ['w2:wed:知识|nvid001', 'w3:thu:引流|nimg001'], rows
        print('PASS ① 到点闹钟 = %s 19:00；后台两行：%s' % (W2_WED, rows))

        # ── ② 队列页渲染：视频篇三家、图文篇两家；状态章 / 时间 / 回执区 ──
        page.evaluate("switchMainTab('noteQueue')")
        page.wait_for_selector('[data-np="npq-pushi"][data-id="nvid001"]')
        page.wait_for_selector('[data-np="npq-pushi"][data-id="nimg001"]')
        dom = page.evaluate('''() => {
            const rowOf = (id) => document.querySelector('[data-np="npq-pushi"][data-id="' + id + '"]').closest('.npq-row');
            const info = (id) => {
                const r = rowOf(id);
                const chip = r.querySelector('.pub-chip');
                const tm = r.querySelector('[data-np="npq-time"]');
                return {
                    plats: [...r.querySelectorAll('.pub-plat-btn')].map(b => b.getAttribute('data-p')),
                    badge: chip ? chip.textContent.trim() : '',
                    time: tm ? tm.textContent.trim() : '',
                };
            };
            return {
                vid: info('nvid001'), img: info('nimg001'),
                head: document.querySelector('#noteQueueContent .page-hd').innerText,
                log: document.body.innerText.includes('📜 最近发过'),
            };
        }''')
        assert dom['vid']['plats'] == ['xhs', 'douyin', 'channels'], dom['vid']
        assert dom['img']['plats'] == ['xhs', 'douyin'], dom['img']
        assert dom['vid']['badge'] == '到点自动发', dom['vid']
        assert dom['img']['badge'] == '还没定稿', dom['img']
        assert '19:00' in dom['vid']['time'], dom['vid']
        assert '12:00' in dom['img']['time'], dom['img']
        assert '视频号' in dom['head'], dom['head']
        assert dom['log'], '页底「📜 最近发过」没渲染'
        print('PASS ② 视频篇三家/图文篇两家、状态章「到点自动发」「还没定稿」、时间 19:00/12:00 全对')

        # ── ③ 平台章点暗 📕：写 np_pub_plats（这家先不发）＋重渲染 ──
        page.click('[data-np="npq-plat"][data-line="%s"][data-p="xhs"]' % VID_LINE)
        page.wait_for_function('''() => {
            const b = document.querySelector('[data-np="npq-pushi"][data-id="nvid001"]');
            if (!b) return false;
            const chip = b.closest('.npq-row').querySelector('.pub-plat-btn[data-p="xhs"]');
            return chip && !chip.classList.contains('on');
        }''')
        rec = page.evaluate("async () => (await chrome.storage.local.get('np_pub_plats')).np_pub_plats")
        assert rec and rec.get(VID_LINE) == ['douyin', 'channels'], rec
        print('PASS ③ 点暗 📕 → np_pub_plats 记下「先不发」：%s' % rec)

        # ── ④ 改时间 19:00 → 08:00：闹钟跟着重排（popup → 后台 npPubRearm 那条回路） ──
        page.click('[data-np="npq-time"][data-line="%s"]' % VID_LINE)
        page.click('[data-np="npq-settime"][data-line="%s"][data-v="08:00"]' % VID_LINE)
        deadline = time.time() + 8
        a4 = 0
        while time.time() < deadline:
            a4 = sw.evaluate("async () => { const a = await chrome.alarms.get('np-pub-tick'); return a ? a.scheduledTime : 0; }")
            if near(a4, EXPECT_08):
                break
            time.sleep(0.25)
        assert near(a4, EXPECT_08), f'④ 改点后闹钟没跟着走：got {a4} want {EXPECT_08}'
        t4 = page.evaluate("async () => (await chrome.storage.local.get('np_queue_times')).np_queue_times")
        assert t4.get(VID_LINE) == '08:00', t4
        print('PASS ④ 改点 08:00 → np_queue_times 落库、闹钟同步重排')

        # ── ⑤ 后台直跑：草稿篇挡回、无 Key 走 retry（不落假回执） ──
        r5a = sw.evaluate('''async () => {
            try { await npPubRunBg({ id: 'nimg001', key: 'w3:thu:引流' }); return 'NO-THROW'; }
            catch (e) { return String((e && e.message) || e); }
        }''')
        assert '草稿' in r5a, r5a
        r5b = sw.evaluate('''async () => {
            try { return JSON.stringify(await npPubRunBg({ id: 'nvid001', key: 'w2:wed:知识' })); }
            catch (e) { return 'THROW ' + String((e && e.message) || e); }
        }''')
        assert r5b.startswith('{'), r5b
        import json as _json
        j5 = _json.loads(r5b)
        assert j5.get('wired') is False, j5
        assert (j5.get('res') or {}).get('retry') is True, j5
        assert 'API Key' in str((j5.get('res') or {}).get('why') or ''), j5
        print('PASS ⑤ 草稿挡回「%s」；无 Key → res.retry=true wired=false（why=%s）' % (r5a, j5['res']['why']))

        # ── ⑥ ▶ 手动跑：popup 弹「这趟没改成」错弹（不再是那句错误的乐观话）；回执/料/账都不动 ──
        page.click('[data-np="npq-pushi"][data-id="nvid001"]')
        page.wait_for_function(
            "() => { const b = document.getElementById('popToastBox'); return b && b.innerText.includes('这趟没改成'); }",
            timeout=12000)
        st6 = page.evaluate('''async () => {
            const d = await chrome.storage.local.get(['np_pub_log', 'np_pub_ran', 'np_notes', 'np_pub_files']);
            const n = (d.np_notes || []).find(x => x.id === 'nvid001') || {};
            return {
                log: (d.np_pub_log || []).length,
                ran: Object.keys(d.np_pub_ran || {}).length,
                adapted: !!(n.pub && n.pub.adapted),
                files: Object.keys(d.np_pub_files || {}).length,
            };
        }''')
        assert st6 == {'log': 0, 'ran': 0, 'adapted': False, 'files': 1}, st6
        print('PASS ⑥ ▶ 报「这趟没改成」；无假回执/假适配稿，料还在（%s）' % st6)

        # ── ⑦ 全程 popup 无未捕获异常（有一条就是消息路由/渲染哪处漏了兜底） ──
        assert not page_errors, 'popup 有未捕获异常：%s' % page_errors
        print('PASS ⑦ popup 全程零未捕获异常')
        print('ALL PASS')
    finally:
        ctx.close()
