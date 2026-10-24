# 🪟 门面笔记（个人介绍 / 成交承接）批 1 点检 —— 公网那份（web/）的入口与数据层。
# 老板定稿（2026-10-19）：主页顶上两篇必配、单独一条流、提纲钉死、案例不做门面条目（已发的挑最强的手动置顶）。
# 需求档案：资料/发笔记-门面挑稿封面字幕设计.md（第四轮，站序与封面&字幕以它为准）；上一轮 资料/发笔记-门面笔记设计.md
# 这一支只看批 1：新建弹层那行两颗方块 → 建篇落 fkind → 档案方向小标与横幅 → 行尾认领 → 翻新顶旧版 → 存档不擦门面身份。
# 门面那条流的六站（批 2）、照提纲出稿（批 3）、下一步状态机（批 4）不在这一支里。
# 本机：node 起一台只用临时账本的服务器（DEMO_DATA_DIR 指 tmp/，绝不碰 server/data/），AI 出口拨到小桩。
# 用法：python3 -X utf8 scripts/dev/check_facade_web.py
import os
import sys
import time
import socket
import threading
import subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from _guide_gate import goto_big

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
PORT = 8901
BASE = 'http://127.0.0.1:%d' % PORT
DATA = REPO / 'tmp' / 'facade-check' / 'data'
fails = 0


def ok(msg):
    print('  PASS ' + msg, flush=True)


def bad(msg):
    global fails
    fails += 1
    print('  FAIL ' + msg, flush=True)


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length') or 0))
        body = b'{"choices":[{"message":{"content":"{}"}}]}'
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


JS = r'''async () => {
  // 顶层 const（那几张表）不挂在 window 上，只能按名字直接引；函数声明才在 window 上
  const miss = [];
  if (typeof NP_DIR_META === 'undefined') miss.push('NP_DIR_META');
  if (typeof NP_DIR_EFFECTS === 'undefined') miss.push('NP_DIR_EFFECTS');
  if (typeof FACADE_OUTLINE === 'undefined') miss.push('FACADE_OUTLINE');
  if (typeof FACADE_QUESTIONS === 'undefined') miss.push('FACADE_QUESTIONS');
  if (typeof FACADE_STEPS === 'undefined') miss.push('FACADE_STEPS');
  if (typeof FACADE_STYLES === 'undefined') miss.push('FACADE_STYLES');
  if (typeof NP_WEEK_KINDS === 'undefined') miss.push('NP_WEEK_KINDS');
  ['npDirPageHtml', 'npDirNewNote', 'npFacadeBar', 'npFacadeOf', 'npFacadeClaimDo', 'npFacadeMarkPinned',
    'npArDirCell', 'npArRow', 'npArchiveCoerce', 'npArchiveSave', 'npNotesAll'].forEach(k => {
    if (typeof window[k] !== 'function') miss.push(k);
  });
  if (miss.length) return { err: '页面里没有 ' + miss.join(' / '), url: location.href };
  const r = {};
  // ① 弹层：门面那行排在最上面，两颗方块各带自己的落点
  const html = npDirPageHtml();
  r.rowOrder = [...html.matchAll(/🪟 门面|🔥 引流|🎬 案例|📚 知识/g)].map(x => x[0]);
  r.cards = [...html.matchAll(/data-direff="(f\|[^"]*)"/g)].map(x => x[1]);
  r.facadeCards = NP_DIR_EFFECTS.f.map(e => e.fk + '/' + e.f + '/' + e.t);
  // ② 建篇：两颗卡各落一格，字段齐
  const ni = await npDirNewNote('f', '口播稿', 'intro');
  const nd = await npDirNewNote('f', '长文', 'deal');
  let list = await npNotesAll();
  const gi = list.find(x => x.id === ni.id), gd = list.find(x => x.id === nd.id);
  r.intro = { dir: gi.dir, fkind: gi.fkind, form: gi.form, title: gi.title, pinned: gi.pinned, seed: gi.fSeed, gate: gi.fGate };
  r.deal = { dir: gd.dir, fkind: gd.fkind, form: gd.form, title: gd.title };
  // ③ 提纲是死表：段名摊开给界面用
  r.segs = { intro: FACADE_OUTLINE.intro.segs.map(s => s.k), deal: FACADE_OUTLINE.deal.segs.map(s => s.k) };
  r.steps = FACADE_STEPS;
  // ③b 五种版式各带一套「怎么分段」（2026-10-20 老板：版式都差不多 → struct 是给 AI 的分法指令，五张必须各不相同）
  r.styles = FACADE_STYLES.map(s => ({ key: s.key, t: s.t, struct: String(s.struct || ''),
                                       lead: String(s.lead || ''), hook: String(s.hook || ''),
                                       demoParas: String(s.demo || '').split('\n\n').length }));
  r.qCount = { intro: FACADE_QUESTIONS.intro.length, deal: FACADE_QUESTIONS.deal.length };
  r.qAuto = { intro: FACADE_QUESTIONS.intro.filter(q => q.from).length, deal: FACADE_QUESTIONS.deal.filter(q => q.from).length };
  // ④ 横幅：两篇都在＝两格都有「编辑这一篇」；缺一篇＝那格「去建这一篇」
  const barBoth = npFacadeBar(list);
  const barMiss = npFacadeBar(list.filter(x => x.fkind !== 'deal'));
  r.barBoth = { edit: (barBoth.match(/npar-fopen/g) || []).length, build: (barBoth.match(/npar-fnew/g) || []).length,
                pin: (barBoth.match(/npar-fpin/g) || []).length, done: /两篇齐了/.test(barBoth) };
  r.barMiss = { edit: (barMiss.match(/npar-fopen/g) || []).length, build: (barMiss.match(/npar-fnew/g) || []).length,
                miss: /还缺/.test(barMiss), done: /两篇齐了/.test(barMiss) };
  // ⑤ 档案行：方向小标带格子名；置顶了才出「📌 已置顶」
  const defMotif = '';
  r.dirCell = { intro: npArDirCell(gi).replace(/<[^>]+>/g, ''), pinOff: /已置顶/.test(npArRow(gi, [], null, defMotif)) };
  await npFacadeMarkPinned(gi.id);
  list = await npNotesAll();
  const gi2 = list.find(x => x.id === ni.id);
  r.pinOn = { pinned: gi2.pinned, cell: /📌 已置顶/.test(npArRow(gi2, [], null, defMotif)), bar: /✓ 已置顶/.test(npFacadeBar(list)) };
  // ⑥ 认领：引流老篇直接顶到承接格，旧的自动归档
  const old = await npDirNewNote('d', '图文', '');
  await npFacadeClaimDo(old.id, 'deal');
  list = await npNotesAll();
  const claimed = list.find(x => x.id === old.id), superseded = list.find(x => x.id === nd.id);
  r.claim = { dir: claimed.dir, fkind: claimed.fkind, oldStatus: superseded.status,
              nowIn: (npFacadeOf(list, 'deal') || {}).id === old.id, bar: /「/.test(npFacadeBar(list)) };
  // ⑦ 非门面那行才有「🪟 门面」认领颗，门面自己的行不重复挂
  const plain = await npDirNewNote('d', '图文', '');
  r.claimBtn = { onDeal: /npar-claim/.test(npArRow(list.find(x => x.id === old.id), [], null, defMotif)),
                 onPlain: /npar-claim/.test(npArRow(plain, [], null, defMotif)) };
  // ⑧ 存档不擦门面身份：走一遍别处的存档（快照里没有 fkind）也得留着
  const wiz = { arId: claimed.id, platform: 'xhs', dir: 'f', fkind: '', kOut: '', dOut: '',
    form: claimed.form, style: '', filmKind: '', title: claimed.title, draft: { content: '认领的那篇正文。', titles: [], tags: [] },
    voice: '认领的那篇正文。', people: [], sellPoints: [], kb: [], visual: null, shots: null, imgDocs: null, filmDocs: null,
    wip: { step: 1, path: '', noteStyle: {}, write: null, planItem: null } };
  await npArchiveSave(wiz, '代发', { wip: true });
  list = await npNotesAll();
  const after = list.find(x => x.id === claimed.id);
  r.sticky = { dir: after.dir, fkind: after.fkind, pinned: after.pinned, status: after.status };
  // ⑨ 读档规整：老档（没这些键）读进来不炸、默认值齐
  const c0 = npArchiveCoerce({ id: 'x', dir: 'k' });
  r.coerce = { fkind: c0.fkind, seed: c0.fSeed, segs: c0.fSegs, imgs: Array.isArray(c0.fImgs), pinned: c0.pinned };
  // ⑩ 不进每周排法：周排种类表里没有门面
  r.weekKinds = (typeof NP_WEEK_KINDS !== 'undefined') ? NP_WEEK_KINDS.map(x => x.line) : 'no-table';
  return r;
}'''


def main():
    print('── 🪟 门面笔记批 1：入口两颗方块 + 档案横幅 + 认领 + 数据层（公网那份）──', flush=True)
    import shutil
    if DATA.exists():
        shutil.rmtree(DATA)   # 每次从空账本起（横幅那几颗的计数才准）
    DATA.mkdir(parents=True, exist_ok=True)
    stub = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env['DEMO_DATA_DIR'] = str(DATA)
    env['PORT'] = str(PORT)
    env['DEMO_AI_KEY'] = 'check-only'
    env['DEMO_AI_BASE'] = 'http://127.0.0.1:%d/v1' % stub.server_port
    env['DEMO_SIGNUP_MAX'] = '60'
    logf = open(REPO / 'tmp' / 'facade-check.server.log', 'w', encoding='utf-8')
    srv = subprocess.Popen(['node', str(REPO / 'server' / 'dev-server.mjs')], env=env, stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            socket.create_connection(('127.0.0.1', PORT), 1).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        bad('服务器没起来（看 tmp/facade-check.server.log）')
        return
    time.sleep(2)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=True)
            page = br.new_context(viewport={'width': 1500, 'height': 950}).new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/start.html', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(2500)
            who = page.evaluate('''async (a) => await (await fetch('/api/auth/demo', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: a.key }) })).json()''',
                {'key': 'deco'})
            if not who.get('ok'):
                bad('演示号没进上：%r' % (who,))
                br.close()
                return
            goto_big(page, BASE + '/popup.html?mode=big', wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(5000)
            r = page.evaluate(JS)
            shot_dir = REPO / 'tmp' / 'facade-check'
            shot_dir.mkdir(parents=True, exist_ok=True)
            page.evaluate('''() => { const m = document.getElementById('dirModal');
                if (m) { document.getElementById('dirBox').innerHTML = npDirPageHtml(); m.classList.add('open'); } }''')
            page.wait_for_timeout(500)
            try:
                page.screenshot(path=str(shot_dir / 'dir-modal.png'))
            except Exception as e:
                print('  （弹层照片没拍成：%s）' % e, flush=True)
            page.evaluate('''async () => { const m = document.getElementById('dirModal');
                if (m) m.classList.remove('open'); switchMainTab('noteArchive'); }''')
            page.wait_for_timeout(2000)
            try:
                page.screenshot(path=str(shot_dir / 'archive.png'))
            except Exception as e:
                print('  （档案照片没拍成：%s）' % e, flush=True)
            br.close()
        if isinstance(r, dict) and r.get('err'):
            bad(r['err'])
            return
        if errs:
            bad('页面报错 %d 条：%s' % (len(errs), errs[0][:160]))

        if r['rowOrder'] and r['rowOrder'][0] == '🪟 门面':
            ok('新建弹层第一行就是「🪟 门面」（另外三行 知识／引流／案例 照旧在它下面）')
        else:
            bad('弹层行序不对：%s' % r['rowOrder'])
        if r['cards'] == ['f|口播稿', 'f|长文']:
            ok('门面行两颗方块：个人介绍（口播稿）/ 成交承接（长文）')
        else:
            bad('门面那行的卡不对：%s' % r['cards'])
        if r['facadeCards'] == ['intro/口播稿/个人介绍', 'deal/长文/成交承接']:
            ok('门面行就两颗方块：个人介绍（口播稿）/ 成交承接（长文）——案例没做成门面条目')
        else:
            bad('门面那行的卡不对：%s' % r['facadeCards'])

        if r['intro'] == {'dir': 'f', 'fkind': 'intro', 'form': '口播稿', 'title': '（个人介绍·还没定稿）',
                          'pinned': False, 'seed': None, 'gate': ''}:
            ok('点「个人介绍」当场建一篇：dir=f、fkind=intro、形式口播稿、字段齐')
        else:
            bad('介绍篇落档形状不对：%s' % r['intro'])
        if r['deal'] == {'dir': 'f', 'fkind': 'deal', 'form': '长文', 'title': '（成交承接·还没定稿）'}:
            ok('点「成交承接」当场建一篇：fkind=deal、形式是一篇长文')
        else:
            bad('承接篇落档形状不对：%s' % r['deal'])

        exp_i = ['我是谁', '我天天在干什么', '我能帮你办什么事', '我做事的规矩', '凭什么信我', '你来找我怎么走']
        exp_d = ['这篇是干什么的', '你最常问我的几件事', '钱怎么算', '什么情况我不接', '怎么找我']
        if r['segs']['intro'] == exp_i and r['segs']['deal'] == exp_d:
            ok('两张表：介绍那六件事（现在只当「要讲全」的清单，段序交给版式）/ 承接那五段仍是钉死的提纲，名字与 demo 逐字一致')
        else:
            bad('提纲串了：%s' % r['segs'])
        if r['steps'] == {'intro': ['补底料', '挑稿', '改稿', '选出口', '封面&字幕', '收口置顶'],
                          'deal': ['补底料', '挑稿', '改稿', '👀 预览', '收口置顶']}:
            ok('站序：介绍六站（② 挑稿 → ③ 改稿 → ④ 选出口 → ⑤ 封面&字幕）/ 承接五站（挑稿、改稿也分成两站，收口前多一眼「👀 预览」）——配图那站已经撤掉')
        else:
            bad('站序不对：%s' % r['steps'])
        st = r['styles']
        if len(st) == 5 and all(len(x['struct']) >= 30 and '段' in x['struct'] for x in st) \
                and len({x['struct'] for x in st}) == 5 and len({x['t'] for x in st}) == 5 \
                and all(len(x['lead']) >= 10 and len(x['hook']) >= 10 and x['demoParas'] >= 3 for x in st):
            ok('五种版式各带一套自己的分法（struct 五份互不相同、每份都写明分几段怎么排），开头／收口／样板三样也齐——「版式都差不多」那个病根有表顶着')
        else:
            bad('版式表分法不齐：%s' % [(x['key'], len(x['struct'])) for x in st])
        if r['qCount'] == {'intro': 7, 'deal': 5} and r['qAuto'] == {'intro': 2, 'deal': 1}:
            ok('补底料那几问：介绍 7 问（2 问自动带，第 7 问「同行里你不认同的做法」给对比型开头用）/ 承接 5 问（承接句那格全站统一）')
        else:
            bad('底料问题数不对：%s / 自动带 %s' % (r['qCount'], r['qAuto']))

        if r['barBoth'] == {'edit': 2, 'build': 0, 'pin': 2, 'done': True}:
            ok('横幅：两篇都在＝两格各一颗「编辑这一篇」＋没置顶的各一颗「去置顶」＋「两篇齐了」')
        else:
            bad('两篇齐的横幅不对：%s' % r['barBoth'])
        if r['barMiss'] == {'edit': 1, 'build': 1, 'miss': True, 'done': False}:
            ok('横幅：缺哪格哪颗变「✍️ 去建这一篇」，不再说「两篇齐了」')
        else:
            bad('缺一格的横幅不对：%s' % r['barMiss'])

        if r['dirCell']['intro'] == '🪟 介绍':
            ok('档案方向那一格：🪟 介绍 / 🪟 承接（那一列只有 58px，全称挂在悬停上）')
        else:
            bad('方向小标不对：%r' % r['dirCell'])
        if r['dirCell']['pinOff'] is False and r['pinOn']['cell'] and r['pinOn']['bar'] and r['pinOn']['pinned'] is True:
            ok('那颗「✓ 我在小红书置顶好了」标下去：行上出「📌 已置顶」、横幅变「✓ 已置顶」')
        else:
            bad('置顶标记没跟上：标前 %s 标后 %s' % (r['dirCell']['pinOff'], r['pinOn']))

        if r['claim']['dir'] == 'f' and r['claim']['fkind'] == 'deal' and r['claim']['oldStatus'] == '已归档' \
                and r['claim']['nowIn']:
            ok('认领：引流老篇顶进承接格，原来那篇自动标「已归档」，横幅认的是新这篇')
        else:
            bad('认领不对：%s' % r['claim'])
        if r['claimBtn']['onDeal'] is False and r['claimBtn']['onPlain'] is True:
            ok('「🪟 门面」认领颗只挂在还没进面门的篇上（门面自己的行不重复挂）')
        else:
            bad('认领颗位置不对：%s' % r['claimBtn'])

        if r['sticky'] == {'dir': 'f', 'fkind': 'deal', 'pinned': False, 'status': '代发'} or \
                (r['sticky']['dir'] == 'f' and r['sticky']['fkind'] == 'deal'):
            ok('别处存这一笔（快照里没有门面字段）不会擦掉「这一格是承接」')
        else:
            bad('存档把门面身份擦了：%s' % r['sticky'])

        if r['coerce'] == {'fkind': '', 'seed': None, 'segs': None, 'imgs': True, 'pinned': False}:
            ok('老档读进来补默认（没这些键也不炸）')
        else:
            bad('读档规整不对：%s' % r['coerce'])
        if r['weekKinds'] == ['k', 'd', 'c']:
            ok('每周排法还是只认知识 / 引流 / 案例——门面这两篇天生不会被自动抓进格子')
        else:
            bad('周排种类表变了：%s' % r['weekKinds'])
    finally:
        srv.terminate()
        logf.close()
    print('── 结果：%s ──' % ('全过' if not fails else '%d 条没过' % fails), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
