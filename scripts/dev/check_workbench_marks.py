"""获客 · 工作台笔记列表（2026-09-25 三十一改）回归：

  ① 每篇的标记从「👀 已打开」换成「✅ 队列已跑过 · 发 N 条」
     —— 真源＝drain_queue.done[].notes[]（按 noteId 认；老记录退化成标题前 20 字；同一篇取最近一次）
  ② 每篇右侧多了 🗑（只动列表快照 searchResults / searchState.foundNotes；
     笔记池与灌水记录都不动；执行器跑着时拦住不让删）
  ③ 执行器逐屏推进时，队列里跑过的这一篇不再打开重评（已灌水的照旧跳过）

用法：python3 scripts/dev/check_workbench_marks.py
"""
import pathlib
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'

NIDS = {k: k * 24 for k in 'abcd'}
TITLES = {
    'a': '队列跑过的笔记',
    'b': '只按标题认领的旧记录笔记',
    'c': '已经灌过水的笔记',
    'd': '待处理的干净笔记',
}

SEED = '''async ({ now, nids, titles }) => {
  await Storage.initializeDefaults(DEFAULT_PROMPTS);
  await ensureTenantInit();
  const notes = ['a', 'b', 'c', 'd'].map(k => ({
    noteId: nids[k], title: titles[k], author: '作者' + k, likes: '10',
    url: 'https://www.xiaohongshu.com/explore/' + nids[k],
  }));
  // 队列执行记录：a 被两轮跑过（近的赢 5 条）、b 只有老记录（没 id，按标题前 20 字认）
  await chrome.storage.local.set({ drain_queue: { running: null, carry: [], manual: [], done: [
    { k: 'kw1', label: '测试词', scenario: 'latest', at: now - 3600000, foundN: 5, commentN: 3, note: '', notes: [
      { id: nids.a, t: titles.a, s: 3 },
      { id: '', t: titles.b.slice(0, 20), s: 1 },
    ] },
    { k: 'kw2', label: '更晚那轮', scenario: 'top', at: now - 600000, foundN: 2, commentN: 5, note: '', notes: [
      { id: nids.a, t: titles.a, s: 5 },
    ] },
  ] } });
  // 笔记池（删一篇时不该被碰）
  await chrome.storage.local.set({ drain_notes: [{ id: 'n1', noteId: nids.d }, { id: 'n2', noteId: nids.a }] });
  // c 已灌水；d 只是"打开过"——老标记该彻底消失
  await chrome.storage.local.set({ watered_notes: [notes[2].url], opened_notes: [notes[3].url] });
  await Storage.setAutoWaterState({ phase: 'IDLE',
    searchState: { searching: false, foundNotes: notes }, searchResults: notes });
  return notes.map(n => n.noteId);
}'''

with tempfile.TemporaryDirectory(prefix='xhs-wb-marks-') as profile, sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        profile, headless=False, channel='msedge',
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        seeded = sw.evaluate(SEED, {'now': int(__import__('time').time() * 1000), 'nids': NIDS, 'titles': TITLES})
        assert seeded == [NIDS[k] for k in 'abcd'], seeded
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_default_timeout(15000)
        goto_big(page, sw.url.replace('background.js', 'popup.html?mode=big'))
        page.wait_for_function('typeof AutoWaterApp !== "undefined" && typeof switchMainTab === "function"')
        if page.locator('#fsClose').is_visible():
            page.locator('#fsClose').click()
        page.locator('#tabCommentAssistant').click()
        expect(page.locator('#noteList .note-item')).to_have_count(4)

        def chips():
            return page.evaluate('''() => [...document.querySelectorAll('#noteList .note-item')].map(li => {
              const q = li.querySelector('.note-q');
              const btn = li.querySelector('.btn-open-note');
              return {
                id: li.dataset.noteId,
                qdone: q ? q.dataset.qdone : '',
                shown: !!(q && q.style.display !== 'none'),
                text: q ? (q.textContent || '').trim() : '',
                tip: q ? (q.title || '') : '',
                watered: btn ? btn.dataset.watered : '',
                btnText: btn ? (btn.textContent || '').trim() : '',
              };
            })''')

        got = {}
        for _ in range(50):
            got = {c['id']: c for c in chips()}
            if got.get(NIDS['a'], {}).get('qdone') == 'true':
                break
            page.wait_for_timeout(200)
        a, b, c, d = (got.get(NIDS[k], {}) for k in 'abcd')
        assert a.get('shown') and a['text'] == '✅ 队列已跑过 · 发 5 条', a
        assert '发了 5 条评论' in a['tip'], a
        assert b.get('shown') and b['text'] == '✅ 队列已跑过 · 发 1 条', b
        assert not c.get('shown') and c.get('qdone') == 'false', c
        assert not d.get('shown') and d.get('qdone') == 'false', d
        assert c.get('watered') == 'true' and c['btnText'] == '✅ 已灌水', c
        assert '👀' not in page.locator('#leftContent').inner_text() and 'opened' not in page.locator('#leftContent').inner_html()
        # 标单占一行（左栏窄，挤进作者/点赞那行会把「发 N 条」折断）
        assert page.evaluate('!document.querySelector("#noteList .note-q").closest(".note-meta")')
        h = page.evaluate('''() => { const li = document.querySelector('#noteList .note-item'); const q = li.querySelector('.note-q');
          return { row: Math.round(li.getBoundingClientRect().height),
                   qLine: Math.round(q.getBoundingClientRect().height) }; }''')
        assert h['qLine'] <= 20, h
        print('PASS: 标记换成「队列已跑过」（id 认领 / 老记录按标题前 20 字 / 同篇取最近一次），👀 已打开彻底下线')

        expect(page.locator('#filterStats')).to_have_text('✅已灌水 1 | ✅队列已跑过 2 | 📝待处理 1')
        print('PASS: 列表上方分类统计跟标记同源')

        # ② 删一篇：只动列表快照
        page.locator('#noteList .note-item[data-note-id="%s"] .btn-del-note' % NIDS['a']).click()
        expect(page.locator('#noteList .note-item')).to_have_count(3)
        expect(page.locator('#resultsCount')).to_have_text('共 3 篇笔记（按评论数降序）')
        expect(page.locator('#filterStats')).to_have_text('✅已灌水 1 | ✅队列已跑过 1 | 📝待处理 1')
        left = sw.evaluate('''async () => {
          const st = await Storage.getAutoWaterState();
          const drain = (await chrome.storage.local.get('drain_notes')).drain_notes || [];
          const watered = (await chrome.storage.local.get('watered_notes')).watered_notes || [];
          return { res: (st.searchResults || []).map(n => n.noteId),
                   found: ((st.searchState || {}).foundNotes || []).map(n => n.noteId),
                   pool: drain.length, watered: watered.length };
        }''')
        assert left['res'] == [NIDS[k] for k in 'bcd'], left
        assert left['found'] == [NIDS[k] for k in 'bcd'], left
        assert left['pool'] == 2 and left['watered'] == 1, left
        assert page.evaluate('AutoWaterApp.getNoteById("%s") === null' % NIDS['a'])
        print('PASS: 🗑 只从列表快照里删（搜索结果 + 缓存笔记），笔记池与灌水记录都没动')

        # 执行器跑着时不许删
        dialogs = []
        page.on('dialog', lambda dlg: (dialogs.append(dlg.message), dlg.dismiss()))
        page.evaluate('AutoWaterApp.setBotLock(true)')
        page.locator('#noteList .note-item[data-note-id="%s"] .btn-del-note' % NIDS['b']).click()
        page.wait_for_timeout(500)
        assert dialogs and '执行器正在跑' in dialogs[-1], dialogs
        expect(page.locator('#noteList .note-item')).to_have_count(3)
        page.evaluate('AutoWaterApp.setBotLock(false)')
        print('PASS: 执行器跑着时点 🗑 被拦下（列表正跟着页面在同步）')

        # ③ 逐屏推进：队列跑过的跳过，没跑过的才打开
        opened = page.evaluate('''async () => {
          const opened = [];
          const b = window.AutoBot;
          b._checkStop = async () => {};
          b._cqLive = async () => {};
          b._advanceScreen = async () => false;
          b._goBackToList = async () => {};
          b._waterCurrentNote = async () => ({});
          b._openNote = async (note) => { opened.push((note && note.noteId) || ''); return false; };
          await b._roundAll();
          return opened;
        }''')
        assert opened == [NIDS['d']], opened
        print('PASS: 执行器只打开「队列没跑过」的那一篇（跑过的与已灌水的都跳过）')

        assert not errors, errors
        screenshot = pathlib.Path(tempfile.gettempdir()) / 'xhs-workbench-marks.png'
        page.screenshot(path=str(screenshot), full_page=True)
        print('PASS: no browser page errors')
        print('SCREENSHOT:', screenshot)
    finally:
        ctx.close()
