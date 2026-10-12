# -*- coding: utf-8 -*-
"""🎯 分镜一段三条候选自检（老板 2026-10-02 五十八改③：「图描述你可以多出几个，让用户选好了再出提示词」）。

口径：
  1) 🔁 照这一派重出分镜＝一屏回三条摆法（主推／换视角／极简；那一发 AI 内部仍按「本段」喂稿，段＝屏），角度名单只有一份（lib/visual-motif.js 的 DESC_ANGLES），
     后台写 prompt 跟界面摆挑条都读它；
  2) 回来先在「分镜」那一格里用「主推」那条，另外两条收在同一格下面的「🎯 3 条候选」折叠块里；
  3) 点「→ 用这条」＝零 AI：上面那格换成它、那一行的提示词当场重拼、已传回来的图不动；
  4) 自己在那格动过手＝标「自己改的那份」并挂 🔒；🔁 跳过带锁的那一格，点掉锁才跟着重出；
  5) 老写法（AI 只回一条分镜）也认：只有一条时不摆候选块，别在表上挂个空壳；
  6) cands／pick 进档案：切走再回来还是那几条、还在用同一条，一次 AI 都不重烧。

跑法：python3 -X utf8 scripts/dev/check_desc_candidates.py
临时 profile 加载真扩展（msedge headful），全程 AI 走桩、不烧真接口。
"""
import pathlib
import shutil
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = ROOT / 'extension'
OUT = pathlib.Path(tempfile.gettempdir())
ERRORS = []

BODY = ('开场钩子一句。\n\n第一个卖点这一句比较长，中间有个停顿。\n\n它后面紧跟一句补充。\n'
        '第二个卖点这一句。\n\n再补一句实证。\n\n第三段是个提醒。\n\n收尾这一句。')
MOTIF_A = '方案页'
NOTES = "async () => (await chrome.storage.local.get('np_notes')).np_notes || []"

# 桩回来的三条摆法：各带自己的角度名 + 第几轮（R1/R2…）——「换一条」「带锁跳过」都靠这两个标记判
PICS = ['桌面上一沓纸被抽走三张，右边一块界面亮着，箭头从左指到右',
        '一个人站在白板前圈出两个方格，旁边贴着一张便利贴',
        '画面正中一只秒表，四周全留白，只右下角一句短字']

STATE = r'''() => {
  const w = npS() || {};
  const s = w.shots || {};
  const items = s.items || [], sents = s.sents || [];
  const pos = {};
  sents.forEach((x, i) => { pos[x.id] = i; });
  return {
    motif: String(npLookOf(w).motif || ''),
    segs: items.map(it => ({
      id: it.id,
      lines: (it.sids || []).map(id => pos[id]).filter(v => typeof v === 'number'),
      text: String(it.text || ''),
      desc: String(it.desc || ''),
      dlock: !!it.dlock,
      pick: (typeof it.pick === 'number' ? it.pick : -1),
      cands: (it.cands || []).slice(),
    })),
  };
}'''

SEED = r'''async (payload) => {
    await Storage.initializeDefaults(DEFAULT_PROMPTS);
    await ensureTenantInit();
    const cfg = await Storage.getConfig();
    cfg.product.name = '候选测试产品';
    cfg.product.sellPoints = [{title: '省时间', content: '把重复步骤压掉'}];
    cfg.ai.apiKey = 'test-local-only';
    await Storage.setConfig(cfg);
    await chrome.storage.local.set({
        np_notes: [{id: 'desc-1', title: '省时间三步', status: '待发', platform: 'xhs', form: '图文',
                    draft: payload.body, createdAt: Date.now()}],
        np_assets: [],
    });
    self.aiCalls = 0;
    self.otherCalls = [];
    self.descSystems = [];
    self.descUsers = [];
    self.descRound = 0;
    self.descReply = 'cands';        // cands＝一段三条摆法；one＝老写法只回一条
    AiClient.chatCompletion = async (cfg2, system, user) => {
        const sys = String(system || '');
        const us = String(user || '');
        if (sys.indexOf('你在改一条') < 0) {
            self.otherCalls.push(sys.slice(0, 24));
            return {content: '{"__stub":"不该烧的这一发"}'};
        }
        self.descSystems.push(sys);
        self.descUsers.push(us);
        self.aiCalls++;
        self.descRound++;
        const parts = us.split('—— 第 ').slice(1);
        const segs = parts.map(seg => {
            const no = Number(String(seg).replace(/[^0-9].*$/s, '')) || 0;   // 「第 N 张」＝全局那一张
            const m = /本段（要写的就是它）：([^\n]+)/.exec(seg);
            return { no: no, text: m ? m[1] : '' };
        }).filter(x => x.text);
        const r = self.descRound;
        const arr = segs.map((x) => {
            if (self.descReply === 'one') {
                return {'句': x.text, '分镜': '【R' + r + '-' + x.no + '】' + payload.pics[0]};
            }
            return {
                '句': x.text,
                '候选': payload.angles.map((a, k) => '【R' + r + '-' + x.no + '-' + a + '】' + payload.pics[k]),
            };
        });
        return {content: JSON.stringify({'风格': '', '画面': arr})};
    };
    return true;
}'''


def boot(p):
    for i in range(5):
        prof = OUT / ('desccand-profile%d' % i)
        shutil.rmtree(prof, ignore_errors=True)
        ctx = p.chromium.launch_persistent_context(
            str(prof), headless=False, channel='msedge',
            ignore_default_args=['--disable-extensions'],
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        t0 = time.time()
        while time.time() - t0 < 25 and not ctx.service_workers:
            time.sleep(0.3)
        if ctx.service_workers:
            return ctx
        print('  扩展没装起来（第 %d 趟），重来' % (i + 1), flush=True)
        ctx.close()
    raise RuntimeError('扩展装不上：连试 5 趟都没有 service worker')


def main():
    with sync_playwright() as p:
        ctx = boot(p)
        try:
            run(ctx)
        finally:
            ctx.close()


def run(ctx):
    sw = ctx.service_workers[0]
    assert sw.evaluate('chrome.runtime.onMessage.hasListeners()'), '后台路由没注册上'
    sw.evaluate(SEED, {'body': BODY, 'pics': PICS, 'angles': ['主推', '换视角', '极简']})

    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)[:220]))
    page.set_viewport_size({'width': 1280, 'height': 1400})
    page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
    page.wait_for_function('typeof switchMainTab === "function" && typeof npDescCandsHtml === "function"')
    page.set_default_timeout(25000)

    def st():
        return page.evaluate(STATE)

    def gut_box(n):
        el = page.locator('#npCutWrap .np-cutline').nth(n).locator('.np-cut-gut')
        el.scroll_into_view_if_needed()
        return el.bounding_box()

    def pull(a, b):
        pa = gut_box(a)
        page.mouse.move(pa['x'] + pa['width'] / 2, pa['y'] + pa['height'] / 2)
        page.mouse.down()
        pb = gut_box(b)
        page.mouse.move(pb['x'] + pb['width'] / 2, pb['y'] + pb['height'] / 2, steps=8)
        page.mouse.up()
        page.wait_for_timeout(320)

    def calls():
        return sw.evaluate('self.aiCalls')

    def regen():
        n = calls()
        page.locator('.np-desc-regen').click()
        t0 = time.time()
        while True:
            if calls() > n and page.evaluate('() => _npDescBusy === false'):
                break
            if time.time() - t0 > 25:
                raise AssertionError('🔁 这一发没走完（出去 %s 次、台上还 busy=%s）' % (calls(), page.evaluate('() => _npDescBusy')))
            page.wait_for_timeout(200)
        page.wait_for_timeout(600)

    def no_cover():
        """② 那一档点「不出封面」：这一支只管 ④ 的候选，别拿封面当路障"""
        page.locator('#npCoverBox .np-cover-on[data-v="0"]').click()
        page.wait_for_function('() => npS().shots.cv.on === false')

    def cand(k=0):
        return page.locator('details.np-desccand').nth(k)

    def inuse(k=0):
        return cand(k).locator('.np-desc-inuse').inner_text()

    def open_cand(k=0):
        """候选块收着的时候里面不渲染（读不到、按钮也点不动）：要读/要点就先把它展开"""
        if not cand(k).evaluate('e => e.open'):
            cand(k).locator('summary').click()
            page.wait_for_timeout(200)

    def goto_tab(t):
        page.locator('#npImgTabs .np-imgtab[data-t="%s"]' % t).click()
        page.wait_for_timeout(260)

    def cur_tab():
        return page.evaluate('() => npTabOf(npS())')

    def goto_out(add_row=False, tab=None):
        """直开这一篇的「🖼 出图」（档案那一行「下一步」走的同一条路，别再过旧的行选择器；七十改：渲染任务表已撤）；
        加一行＝④ 分镜 空态那颗「＋ 起一套图」＋ ① 风格 挑流派，加完再进一次这一页（npImgLand 照旧算落档，保住下面 cur_tab() 那批断言）"""
        def enter():
            page.evaluate('''async () => {
                const list = await npNotesAll();
                const n = list.find(x => x && x.id === 'desc-1') || null;
                switchMainTab('noteOut', n);
            }''')
            page.wait_for_function('() => _npMode === "out" && !!document.querySelector("#npImgTabs .np-imgtab")')
        enter()
        if add_row:
            goto_tab('desc')
            page.wait_for_function('() => !!document.querySelector("#npShotTable .np-img-add")')
            page.locator('#npShotTable .np-img-add').click()
            page.wait_for_function('() => (npS().imgDocs || []).length === 1 && !!npS().imgOpen')
            goto_tab('look')
            page.locator('#npLookBox .np-motif[data-k="%s"]' % MOTIF_A).click()
            page.wait_for_function('(m) => String(((npS().shots || {}).look || {}).motif || "") === m', arg=MOTIF_A)
            enter()
        if tab:
            goto_tab(tab)

    # ── 1) 冷启动：两段圈出来、还没有候选（表上不摆空壳）、🔁 那颗说清一段出三条 ──
    goto_out(add_row=True)
    assert cur_tab() == 'cover', '新加的一行（封面那一份还没写）先停在 ②：%s' % cur_tab()
    no_cover()
    goto_tab('cut')
    assert cur_tab() == 'cut', '关掉封面才往 ③ 划重点走：%s' % cur_tab()
    pull(0, 1)
    pull(2, 4)
    assert calls() == 0, '划重点、圈屏一次 AI 都没烧：%s' % calls()
    goto_tab('desc')
    assert cur_tab() == 'desc'
    s = st()
    assert s['motif'] == MOTIF_A, '这一行的流派＝任务表上加的那一派：%s' % s['motif']
    assert len(s['segs']) == 2 and [x['lines'] for x in s['segs']] == [[0, 1], [2, 3, 4]], '%s' % s['segs']
    assert all(not x['cands'] for x in s['segs']), '没点 🔁 之前不该凭空有候选'
    assert page.locator('details.np-desccand').count() == 0, '没有候选就别在格子里摆一块空的'
    btn = page.locator('#npRegenBar .np-desc-regen')
    assert '3 条挑一条' in btn.inner_text(), '🔁 那颗要说清一屏出几条：%s' % btn.inner_text()
    assert '每屏 3 条' in btn.inner_text() and '每段' not in btn.inner_text(), '🔁 表头的话要读到「屏」这一档：%s' % btn.inner_text()
    assert btn.is_enabled(), '两段都没带锁，🔁 该能点'
    assert page.locator('#npImgTabs .np-imgtab').count() == 5, '横置五档：风格／封面／划重点／分镜／预览'
    goto_tab('look')
    assert page.locator('#npLookBox').count() == 1 and page.locator('.np-desc-regen').count() == 0, '🔁 不在风格那一档了（它在 ④ 那张表头上）'
    goto_tab('desc')
    print('PASS: 冷启动（2 屏零 AI、无候选块不摆空的、🔁 在 ④ 表头且文案写明「每屏 3 条挑一条」）', flush=True)

    # ── 2) 点 🔁：一发回来三条摆法，格里先用主推，另外两条收在同一格下面的折叠块里 ──
    regen()
    assert calls() == 1, '2 段在一批里＝一发 AI：%s' % calls()
    assert sw.evaluate('self.otherCalls') == [], '除了那一发不该碰别的 AI：%s' % sw.evaluate('self.otherCalls')
    sys0 = sw.evaluate('self.descSystems')[0]
    assert '每段回 3 条候选' in sys0 and '主推' in sys0 and '换视角' in sys0 and '极简' in sys0, 'prompt 里三条角度都得点名'
    assert '"候选":["...","...","..."]' in sys0, '回传格式要写死 3 个候选'
    s = st()
    for k, it in enumerate(s['segs'], start=1):
        assert len(it['cands']) == 3, '第 %d 段该有 3 条候选：%s' % (k, it['cands'])
        assert all(('R1-%d-' % k) in c for c in it['cands']), '三条都是这一轮、这一段回的：%s' % it['cands']
        assert it['desc'] == it['cands'][0] and it['pick'] == 0, '第 %d 段先用主推那条' % k
        assert not it['dlock'], 'AI 填的不算手改'
    assert page.locator('details.np-desccand').count() == 2, '一格一块候选'
    assert '3 条候选' in cand(0).locator('summary').inner_text() and inuse(0) == '主推', cand(0).locator('summary').inner_text()
    assert cand(0).locator('.np-desc-pick').count() == 2, '在用的那条不给按钮，另外两条给'
    open_cand(0)
    blk = cand(0).inner_text()
    assert '✓ 在用' in blk and all(a in blk for a in ('主推', '换视角', '极简')), '块里要标出在用哪条、三条各是什么摆法：%s' % blk[:120]
    pout = page.locator('.np-shot-pout').first.evaluate('(el) => el.textContent')
    assert 'R1-1-主推' in pout, '提示词读的是在用那条候选：%s' % pout[:90]
    print('PASS: 🔁 一屏回三条摆法（主推／换视角／极简），格里用主推、提示词跟着它，另两条在折叠块里待选', flush=True)

    # ── 3) 换一条＝零 AI：那格换成它、提示词当场重拼、块还开着 ──
    before = st()
    cand(0).locator('.np-desc-pick[data-i="1"]').click()
    page.wait_for_timeout(500)
    assert calls() == 1, '点「→ 用这条」不烧 AI：%s' % calls()
    s = st()
    assert s['segs'][0]['desc'] == before['segs'][0]['cands'][1], '上面那格换成第二条'
    assert s['segs'][0]['pick'] == 1 and not s['segs'][0]['dlock'], '记住在用第二条'
    assert s['segs'][1]['pick'] == 0, '另一段没被牵连'
    assert 'R1-1-换视角' in page.locator('.np-shot-pout').first.evaluate('(el) => el.textContent'), '提示词当场重拼'
    assert cand(0).evaluate('e => e.open') is True, '重画这张表不该把人正看着的候选块塌回去'
    assert inuse(0) == '换视角', '在用那条要说清：%s' % inuse(0)
    assert cand(0).locator('.np-desc-pick[data-i="1"]').count() == 0, '换成它之后那条只标 ✓，不再给按钮'
    assert cand(0).locator('.np-desc-pick[data-i="0"]').count() == 1, '原来在用那条改回可点'
    print('PASS: 挑一条（零 AI、提示词跟着换、块的展开还在），在用状态两头都对调', flush=True)

    # ── 4) 手改那格＝标「自己改的那份」＋挂 🔒；点掉锁才回到候选口径 ──
    ta = page.locator('textarea.np-shot-desc').first
    ta.scroll_into_view_if_needed()
    ta.fill('自己随手写的：桌上两只手把四张纸摊成一排，右下角一块界面亮着，中间留一条白带。')
    page.wait_for_timeout(400)
    s = st()
    assert s['segs'][0]['dlock'], '手改过＝带锁'
    assert page.locator('.np-shot').first.locator('.np-shot-lock').count() == 1, '那一格要摆 🔒'
    assert inuse(0) == '自己改的那份', '手改时不能还挂着旧候选名：%s' % inuse(0)
    page.locator('.np-shot').first.locator('.np-shot-lock').click()
    page.wait_for_function('() => !((npS().shots.items||[])[0] || {}).dlock')
    page.wait_for_timeout(400)
    assert inuse(0) == '换视角', '放开锁回到在用那条候选：%s' % inuse(0)
    print('PASS: 手改那格＝标「自己改的那份」＋挂 🔒，点掉锁回到候选口径', flush=True)

    # ── 5) 带 🔒 的那一格 🔁 跳过，没锁的跟着重出（第二轮标记 R2）──
    page.locator('textarea.np-shot-desc').first.scroll_into_view_if_needed()
    page.locator('textarea.np-shot-desc').first.fill('这一段我要自己攒：一个人把三张纸拍在桌上，右边屏幕上一格一格亮。')
    page.wait_for_timeout(400)
    before = st()
    bar = page.locator('#npRegenBar').inner_text().replace(' ', '')
    assert '1屏带🔒' in bar and '这一发不碰' in bar, '表头要说清几屏带锁、这一发不碰：%s' % bar[:120]
    regen()
    assert calls() == 2, '跳过带锁那格也只是一发：%s' % calls()
    s = st()
    assert s['segs'][0]['desc'] == before['segs'][0]['desc'], '带 🔒 那格一个字不动'
    assert 'R2' not in ''.join(s['segs'][0]['cands']), '带 🔒 那格连候选都没被顶掉'
    assert s['segs'][1]['desc'].startswith('【R2-2-主推】'), '没锁那格跟着重出：%s' % s['segs'][1]['desc'][:24]
    assert s['segs'][1]['pick'] == 0, '重出之后从主推那条重新开始用'
    sent = sw.evaluate('self.descUsers')[-1]
    assert '本段（要写的就是它）：' in sent and sent.count('本段（要写的就是它）：') == 1, '那一发只问没锁的那一段：%s' % sent.count('本段')
    print('PASS: 带 🔒 手改的那格 🔁 跳过（只把没锁的那几屏发给 AI），没锁那屏重出并从主推起用', flush=True)

    # ── 6) 老写法只回一条：认，且不摆候选块（表上不留空壳）──
    for _ in range(4):
        lk = page.locator('.np-shot-lock')
        if not lk.count():
            break
        lk.first.click()
        page.wait_for_timeout(400)
    sw.evaluate('() => { self.descReply = "one"; return true; }')
    regen()
    assert calls() == 3, '又是一发：%s' % calls()
    s = st()
    assert all(len(x['cands']) == 1 for x in s['segs']), '老写法回一条就记一条：%s' % [x['cands'] for x in s['segs']]
    assert all(x['desc'] == x['cands'][0] for x in s['segs']), '那一格用的就是它'
    assert page.locator('details.np-desccand').count() == 0, '只有一条时不摆「挑一条」那块'
    print('PASS: 老写法（AI 只回一条分镜）照收，且只有一条时不摆候选块', flush=True)

    # ── 7) 落档往返：cands／pick 进档案，切走再回来一样，零重烧 ──
    sw.evaluate('() => { self.descReply = "cands"; return true; }')
    regen()
    before = st()
    assert len(before['segs'][0]['cands']) == 3, '重新出成三条候选'
    open_cand(0)
    cand(0).locator('.np-desc-pick[data-i="2"]').click()
    page.wait_for_timeout(500)
    before = st()
    calls_now = calls()
    page.evaluate('() => npArchiveFlushTouch()')
    got = None
    t0 = time.time()
    while time.time() - t0 < 15:
        got = next((x for x in page.evaluate(NOTES) if x and x.get('id') == 'desc-1'), {}).get('imgDocs')
        if got and (got[0].get('shots') or {}).get('items'):
            break
        page.wait_for_timeout(300)
    assert got and len(got) == 1, '这一行要落进档案：%s' % got
    row = got[0]['shots']
    assert len(row['items'][0].get('cands') or []) == 3, '三条候选进档：%s' % row['items'][0].get('cands')
    assert row['items'][0].get('pick') == 2, '在用第几条也进档'
    goto_out()
    assert cur_tab() == 'preview', '分镜齐了、图一张没传＝落 ⑤ 那条检查（② 这一版关了，不拦人）：%s' % cur_tab()
    assert set((row.get('cv') or {}).keys()) == {'on', 'copy', 'prompt', 'cap', 'imgs'},         '落档的 cv 只这几样（分镜／候选／配文／锁不进档）：%s' % row.get('cv')
    assert row['cv']['on'] is False, '「不出封面」这一版关着也照实落档'
    goto_tab('preview')
    chk = page.locator('#npPreviewBox').inner_text()
    assert '检查这一套' in chk and '缺 2 张图' in chk, '预览顶上那条检查要说清缺什么：%s' % chk[:160]
    assert '封面那一份还没写' not in chk, chk[:160]
    page.locator('#npPreviewBox .np-check-go[data-t="desc"]').first.click()
    page.wait_for_timeout(400)
    assert cur_tab() == 'desc', '点「跳到第一个缺图的段」＝切到 ④ 那一档：%s' % cur_tab()
    s = st()
    assert [x['cands'] for x in s['segs']] == [x['cands'] for x in before['segs']], '回来的候选一份不差'
    assert [x['pick'] for x in s['segs']] == [x['pick'] for x in before['segs']], '回来还在用同一条'
    assert s['segs'][0]['desc'] == before['segs'][0]['desc'], '那一格里还是那份字'
    assert inuse(0) == '极简', '块头的在用什么：%s' % inuse(0)
    assert calls() == calls_now, '从档案再进来一次 AI 都没重烧：%s' % calls()
    print('PASS: 落档往返（cands／pick 进档、回来候选与在用那条不散、零重烧）', flush=True)

    assert sw.evaluate('self.otherCalls') == [], '全程没碰过别的 AI：%s' % sw.evaluate('self.otherCalls')
    assert sw.evaluate('self.aiCalls') == 4, '全程 4 发 AI＝四次 🔁，其余（划重点／挑条／锁／落档）都在本地：%s' % sw.evaluate('self.aiCalls')
    assert not ERRORS, '页面报错：%s' % ERRORS[:3]
    print('\n分镜候选链路全绿：④ 一段三条摆法（主推／换视角／极简）→ 挑一条（零 AI、提示词跟着换）→ 手改挂 🔒 跳过 → 老写法只回一条 → 落档往返', flush=True)


if __name__ == '__main__':
    main()
