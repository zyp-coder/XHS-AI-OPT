import base64
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parents[2]
STATE = {'requests': [], 'fail_knowledge': False}
TEXT_RELEASE = threading.Event()
TEXT_RELEASE.set()
PLAN = {
    'accountType': '教程/步骤型',
    'contentFocus': '小工具使用教程',
    'targetPeople': '初次使用的客户',
    'stageNote': '粉丝还少，先攒同类再谈转化',
    'rhythm': '每周两篇，晚上发',
    'perWeek': 2,
    'timing': '晚上',
    'pinned': {'title': '我是谁 + 我能给你什么 + 去哪找我', 'outline': '人设一句话｜价值清单｜私信我'},
    'items': [
        {'no': 1, 'title': '怎样先体验', 'angle': '先试再选', 'type': 'tale', 'kind': 'scene', 'scope': 'related', 'credential': '做这行 5 年'},
        {'no': 2, 'title': '我自己踩过的坑', 'angle': '真实经历', 'type': 'tale', 'kind': 'myway', 'scope': 'samePeople', 'credential': '亲身经历'},
        {'no': 3, 'title': '行业内幕三句话', 'angle': '反常识', 'type': 'howto', 'kind': 'pitfall', 'scope': 'related', 'credential': '做这行 5 年'},
    ],
}
ENTRY = {'title': '先体验再决定', 'category': '使用技巧', 'content': '可以先体验工具，再决定是否购买。', 'tags': ['工具试用', '体验']}
# 诊断 6 个节点在 popup.html #diagSubTabs 里的 data-go 序号：改号/换序只动这一行
# 2026-10-01 五十二改（老板）：序号在界面上全废，左栏只留名字；
#   「说话风格」并进「人设」页（页内两个横 tab），
#   「客服话术」整块搬到「线索 → 任务配置」（第 3、4 个横 tab），
#   「内容基调」整页搬到「发笔记 → 任务配置」（页内三个横 tab）。
GO = {'base': 1, 'quiz': 2, 'persona': 3, 'sell': 4, 'kb': 5, 'plan': 6}


def go(name):
    return f'[data-go="{GO[name]}"]'


def _zip_bytes(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


def _xml_esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def docx_bytes(paragraphs, table=None):
    """一个真 .docx（正文段落 + 可选表格），验证 Word 解包抽文字。"""
    body = ''.join(f'<w:p><w:r><w:t xml:space="preserve">{_xml_esc(p)}</w:t></w:r></w:p>' for p in paragraphs)
    if table:
        rows = ''.join('<w:tr>' + ''.join(f'<w:tc><w:p><w:r><w:t>{_xml_esc(c)}</w:t></w:r></w:p></w:tc>' for c in row) + '</w:tr>' for row in table)
        body += f'<w:tbl>{rows}</w:tbl>'
    return _zip_bytes({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                               '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                               '<Default Extension="xml" ContentType="application/xml"/></Types>',
        'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                             '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                             f'<w:body>{body}<w:sectPr/></w:body></w:document>',
    })


def xlsx_bytes(*sheets):
    """一个真 .xlsx（共享字符串 + 多张工作表），验证 Excel 解包抽文字。"""
    shared, index = [], {}

    def sid(v):
        if v not in index:
            index[v] = len(shared)
            shared.append(v)
        return index[v]

    files = {}
    for n, rows in enumerate(sheets, start=1):
        out = []
        for r, row in enumerate(rows, start=1):
            cells = ''.join(f'<c r="{chr(65 + c)}{r}" t="s"><v>{sid(v)}</v></c>' for c, v in enumerate(row) if v != '')
            out.append(f'<row r="{r}">{cells}</row>')
        files[f'xl/worksheets/sheet{n}.xml'] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            + ''.join(out) + '</sheetData></worksheet>')
    files['xl/sharedStrings.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        + ''.join(f'<si><t>{_xml_esc(v)}</t></si>' for v in shared) + '</sst>')
    return _zip_bytes(files)


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def headers_for(self):
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.headers_for()

    def do_GET(self):
        self.send_response(200)
        self.headers_for()
        self.wfile.write(b'{"ok":true}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        system = body['messages'][0]['content']
        user = body['messages'][1]['content']
        STATE['requests'].append(body)
        if '账号人设梳理师' in system:
            content = json.dumps({
                'card': {'identity': '产品设计师', 'proof': '做这行 5 年', 'story': '', 'stance': '反对夸大宣传',
                         'catchphrase': '我实际用下来', 'taboo': '不承诺效果', 'address': '你'},
                'text': '我是一名产品设计师，耐心分享真实体验与使用方法。',
                'coverHook': '耐心的工具分享者',
            }, ensure_ascii=False)
        elif '产品卖点提炼师' in system:
            point = {'title': '先试再选', 'content': '提供试用，适合先体验的用户。'}
            if 'Word 卖点' in user:
                point = {'title': '来自 Word 的卖点', 'content': 'Word 文档里的优势已提炼成卖点。'}
            elif 'Excel 卖点' in user:
                point = {'title': '来自 Excel 的卖点', 'content': 'Excel 表格里的价格已提炼成卖点。'}
            content = json.dumps({'productName': '体验工具', 'guideText': '私信我了解', 'sellPoints': [point]}, ensure_ascii=False)
        elif '知识库整理师' in system:
            if STATE['fail_knowledge']:
                content = '{"entries":[{"title":"截断'
            else:
                e = dict(ENTRY)
                if '散乱素材' in user:
                    TEXT_RELEASE.wait(timeout=15)
                    e.update(title='不必先学格式', content='可直接提供聊天记录和经验，由系统整理成知识。', tags=['散乱素材'])
                if '文件经验' in user:
                    e.update(title='来自文件的经验', content='文件中的经验可以整理为知识条目。')
                if 'Word 说明书' in user:
                    e.update(title='来自 Word 的说明', content='Word 文档里的产品说明已入库。', tags=['word'])
                if 'Excel 价格' in user:
                    e.update(title='来自 Excel 的价格', content='Excel 表格里的价格已入库。', tags=['excel'])
                content = '整理如下：\n' + json.dumps({'entries': [e]}, ensure_ascii=False) + '\n整理完成。'
        elif '内容规划师' in system:
            content = json.dumps(PLAN, ensure_ascii=False)
        elif '同题写一批' in system:
            # 发笔记 ④ 挑稿：照 user 里那份「kind=key（写法名）」清单一种一篇回，篇数与顺序都跟着这条线走
            content = json.dumps({'variants': [
                {'kind': k, 'title': '样稿·' + n, 'content': '【' + n + '】这一篇的开头。\n\n中间一段。\n\n收尾那一句。',
                 'tags': ['样稿标签', n]}
                for k, n in re.findall(r'kind=([a-zA-Z]+)（([^）]*)）', user)]}, ensure_ascii=False)
        elif '料 → 转 → 专业' in system:
            # 🔥 引流行 ③ 挑稿：照 user 里那份「N. 料类」清单每类回 3 版（骨架「料 → 转 → 专业」）；
            #   near 只给第一批的那个热点版——验证查重第二层「撞相近挂 ⚠」
            cats = re.findall(r'^\d+\. (.+)$', user, re.M)
            hists = re.findall(r'\d{2}-\d{2}《([^》]+)》', user)
            variants = []
            for c in cats:
                for j in range(3):
                    variants.append({
                        'cat': c,
                        'title': c + '·稿' + str(j + 1),
                        'line': '情绪 · 干货' if j == 0 else '知识·干货',
                        'body': ('【' + c + '·稿' + str(j + 1) + '】开头三句讲这条料，具体、有画面。\n\n'
                                 '一句转法，落到这行的门道。\n\n后面全是专业的话，取材知识库。'),
                        'turn': '料由头「' + c + '」→ 转到这行的门道，先看三处',
                        'tags': ['引流', c],
                        'near': ('撞过：《' + hists[0] + '》') if (hists and c == '🔥 热点' and j == 0) else '',
                    })
            content = json.dumps({'variants': variants}, ensure_ascii=False)
        elif '按重点个数定段数' in system:
            # 🎬 引流线拆段出词（三十一改）：照契约回 3 段（1 重点 → 3 段；段原文连续；提示词带硬约束收尾）
            content = json.dumps({
                '重点': [
                    {'句': '随手下单踩坑多', '为什么': '先勾住同样纠结的人'},
                ],
                '段': [
                    {'角色': '开场钩子', '原文': '开头三句讲这条料，具体、有画面。',
                     '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：桌面上几个没拆的包装盒。镜头：从虚到实缓缓推近。不要出现人脸口型；画面里不要出现任何文字。'},
                    {'角色': '把料讲完', '原文': '一句转法，落到这行的门道。',
                     '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：手把料翻过来看细节。镜头：缓慢横移。不要出现人脸口型；画面里不要出现任何文字。'},
                    {'角色': '收束引主页', '原文': '后面全是专业的话，取材知识库。',
                     '提示词': '竖屏 9:16 实拍短片，时长 5 秒左右。画面：成品放进书包侧袋。镜头：缓慢拉远定格。不要出现人脸口型；画面里不要出现任何文字。'},
                ],
            }, ensure_ascii=False)
        elif '图文笔记分镜师' in system:
            # 🖋 引流图文线分镜（三十改·造图片并进写稿流）：照契约回 3 屏（开场 → 展开 → 收束；提示词由前端本地拼）
            content = json.dumps({'分镜': [
                {'角色': '开场', '画面描述': '画面：卫生间地面刚泼过水，门口挡着一圈沙袋。这一张要让人看明白：闭水试验开始了。', '每页文案': '闭水试验这一关，先从泼水开始。', '配图主题': '闭水现场'},
                {'角色': '展开', '画面描述': '画面：手电照向楼下管井，水痕印在墙上。这一张要让人看清楚：水痕到哪一层。', '每页文案': '手电一打，楼下那道水痕看得清清楚楚。', '配图主题': '管井水痕'},
                {'角色': '收束', '画面描述': '画面：验收单压在工具箱上，旁边一支笔。这一张要让人落住：下一步先看楼下。', '每页文案': '先看楼下，再回填。', '配图主题': '验收单'},
            ]}, ensure_ascii=False)
        elif '资深的小红书账号运营顾问' in system:
            content = json.dumps({
                'overall': '定位清楚，简介还差一句给谁看',
                'summary': '账号处于起步阶段，内容方向已经聚焦。',
                'positioning': {'issue': '简介没讲清为谁服务', 'suggestion': '补一句服务对象'},
                'personaReview': {'issue': '人设偏泛', 'suggestion': '加一条真实经历'},
                'kbReview': {'issue': '知识条目偏少', 'suggestion': '把常用问答补进来'},
                'sections': [{'name': '简介', 'issue': '缺钩子', 'suggestion': '加一句引导'}],
                'structure': '问题-方法-总结',
                'frequency': '每周两篇，晚上发',
                'priorities': ['补齐简介钩子', '固定更新节奏'],
                'risks': ['起步期别频繁改定位'],
            }, ensure_ascii=False)
        elif '排班师' in system:
            # 🧬 笔记规划 →「🧠 AI规划」：照后台 aiWeekPlan 的契约回一份七天排班（值是 知识/引流/案例 数组）
            content = json.dumps({
                'mon': ['知识'], 'tue': [], 'wed': ['知识'], 'thu': [],
                'fri': ['引流'], 'sat': ['知识'], 'sun': [],
            }, ensure_ascii=False)
        elif '口吻分析师' in system:
            content = json.dumps({
                'profile': '说话直接、句子短，爱用「我实际用下来」这种亲测口吻，讨厌客服腔和喊口号。',
                'mannerisms': ['我实际用下来', '别急'],
                'samples': ['我实际用下来，这个尺寸刚好，不夹手。', '别急，先看自己平时怎么用。', '我一般先试一周再决定。'],
            }, ensure_ascii=False)
        elif '只输出严格 JSON：{"topics"' in system:
            content = json.dumps({'topics': [
                {'topic': '闭水试验到底在等什么', 'fact': '邻居闭水试了两天，楼下天花板还是见潮。', 'target': '正在装修的人',
                 'rationale': '高频疑问，好承接', 'type': 'howto', 'kind': 'pitfall', 'alone': '装修人人都要过的验收关'},
                {'topic': '防水验收少看一处就白做', 'fact': '有人验收只看墙角，漏了管根。', 'target': '自装的人',
                 'rationale': '有反差', 'type': 'howto', 'kind': 'pitfall', 'alone': '验收盲点自查'},
            ]}, ensure_ascii=False)
        elif '小红书爆款图文笔记写手' in system:
            content = json.dumps({
                'titles': ['闭水试验那 48 小时到底在等什么', '等的不只是时间', '闭水试验为什么要等两天'],
                'content': '闭水试验那 48 小时，等的不是时间。\n\n第一件事要说清：水要泡透防水层。\n\n收尾就一句：别急着回填，先看楼下。',
                'tags': ['装修', '闭水试验', '防水'], 'timeTip': '12:00-13:00',
            }, ensure_ascii=False)
        elif '导图结构整理师' in system:
            if '用户没点到的地方不许动' in system:
                content = json.dumps({'md': '# 改过的闭水试验\n## 为什么要等\n- 泡透防水层\n## 怎么看结果\n- 复看楼下天花板'}, ensure_ascii=False)
            else:
                content = json.dumps({'md': '# 闭水试验 48 小时\n## 为什么要等\n- 泡透防水层才看得见漏\n## 怎么看结果\n- 楼下天花板要复看'}, ensure_ascii=False)
        elif '蒸环节轴' in system:
            # 🎬 案例流 ①：照 user 里的【知识库标题】清单挑真标题回环节轴（前端只认原样抄的标题，编的一律滤掉）
            titles = [t.strip() for t in user.split('【知识库标题】')[-1].split('\n') if t.strip()]
            k1 = titles[0] if titles else ''
            k2 = titles[1] if len(titles) > 1 else k1
            content = json.dumps({'stages': [
                {'stage': '🚪 进场看现场', 'kb': [k1]},
                {'stage': '💧 闭水试验', 'kb': [k2]},
                {'stage': '✅ 验收交付', 'kb': [k1, k2]},
            ]}, ensure_ascii=False)
        elif '「案例成片」写讲解词' in system:
            # 🎬 案例流 ①：讲解词两句固定台词（点「↻ 换一版」时换个说法，验证 voAlt 真的走了 alt 通道）
            content = '换个讲法：先看再做。' if '【上一版写法' in user else '现场先看一遍再动手。'
        elif '提名三张封面' in system:
            # 🎬 案例流 ②：大组装封面提名三张
            content = json.dumps({'covers': ['过程实拍', '细节特写', '成果全景']}, ensure_ascii=False)
        else:
            content = '{}'
        payload = json.dumps({'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}], 'usage': {}}, ensure_ascii=False).encode()
        self.send_response(200)
        self.headers_for()
        self.wfile.write(payload)


def send(page, action, data=None):
    return page.evaluate('(m) => chrome.runtime.sendMessage(m)', {'action': action, 'data': data or {}})


def check(page, text):
    print('PASS:', text, flush=True)


def kb_pick_click(page, pick_i):
    """三十六改：挑知识清单按类收成堆——要勾的那条若收在组里（display:none），先点它那类的
    组头摊开再勾（单开互斥：组开着不重复点，点了反而收起）。"""
    cb = page.locator('.np-kbk[data-i="%d"]' % pick_i)
    if not cb.is_visible():
        cat = cb.evaluate('(el) => el.closest(".np-kb-item").getAttribute("data-cat")')
        page.locator('.np-kb-grp[data-c="%s"]' % cat).click()
    cb.click()


def is_done(page, name):
    """左栏节点有没有打勾：完成圈＝tab 上的 .done 类（2026-09-25 起不再往标签里塞「✓」，免得
    跟行首图标叠成两个）。注意当前节点不画 .done —— 要断言当前节点，先用 park_done 切走。"""
    return bool(page.locator(go(name)).evaluate('(el) => el.classList.contains("done")'))


def park_done(page, name, park='kb'):
    """切到 park 那页（知识库：不被断言占用、也不触发 AI）再看 name 的完成圈。"""
    page.locator(go(park)).click()
    return is_done(page, name)


def wait_store(page, worker, expr, timeout=8000):
    """等 worker 里一个 async 表达式为真——点完 UI 是「先刷界面、再异步写库」，读盘断言前先等它落地。"""
    waited = 0
    while waited < timeout:
        if worker.evaluate('async () => { try { return !!(await (%s)); } catch (e) { return false; } }' % expr):
            return True
        page.wait_for_timeout(100)
        waited += 100
    return False


def note_tone(page, sec='lines'):
    """进「发笔记 → 任务配置」并把页内横 tab 切到 sec 那一节（两签：📄 内容基调 / 🎨 出图风格）。
    已经是 active 就不重点——重绘会打断正在编辑的那一格。"""
    page.locator('#tabNotePublish').click()
    page.locator('#tabNoteTaskCfg').click()
    tab = page.locator('#ntCfgTabs [data-sec="%s"]' % sec)
    expect(tab).to_be_visible()
    if 'active' not in (tab.get_attribute('class') or ''):
        tab.click()
    return tab


def note_plan(page):
    """进「发笔记 → 发布台」并把页内横 tab 切到「🧬 笔记规划」那一节（页内两签：📅 发布队列 / 🧬 笔记规划）。
    规划这一块（怎么用发笔记＋每周排法＋阶段计划＋AI规划）是 2026-10-09 从任务配置整块搬来的。"""
    page.locator('#tabNotePublish').click()
    page.locator('#tabNoteQueue').click()
    tab = page.locator('#nqTabs [data-sec="plan"]')
    expect(tab).to_be_visible()
    if 'active' not in (tab.get_attribute('class') or ''):
        tab.click()
    expect(page.locator('#diagPersonaBox')).to_be_visible()
    return tab


def persona_tab(page, sec='persona'):
    """进「人设」节点并把页内横 tab 切到 sec 那一节（👤 人设 / 🗣 说话风格）。
    停留状态是全局的 _diagPersonaSec：只点左栏节点不一定停在上次那一节，所以进页都走这里。"""
    page.locator(go('persona')).click()
    tab = page.locator('#diagPersonaTabs .dg-tab[data-sec="%s"]' % sec)
    expect(tab).to_be_visible()
    if 'active' not in (tab.get_attribute('class') or ''):
        tab.click()
    return tab


def q9_picked(page):
    """「问卷」第 9 题（人设）＝一句话自述题：没有选项，答案直接落在 textarea 里。"""
    return page.locator('#diagQuizQ8')


def check_sell_points(page, worker, out):
    # 放在知识库及问卷重试之后，所有临时卖点都在本阶段清理。
    ai_before = len(STATE['requests'])
    dialog = page.locator('dialog#diagSellDialog')
    rows = page.locator('#diagSellList tbody.diag-sell-item')
    visible_rows = page.locator('#diagSellList tbody.diag-sell-item:visible')
    nonempty = re.compile(r'\S')

    def product():
        return worker.evaluate('async () => (await Storage.getConfig()).product')

    def row(title):
        return rows.filter(has=page.get_by_text(title, exact=True))

    def assert_stats(total, matched=None):
        # 2026-09-25（二十九改）：条数不再重复报——不搜索时 #diagSellStats 留空，字数并进「同步状态」行；
        # 搜索时这里只报命中数（总数照旧在同步状态行里）
        stats = page.locator('#diagSellStats')
        if matched is None:
            expect(stats).to_have_text('')
        else:
            expect(stats).to_have_text('匹配 ' + str(matched) + ' 条')
        expect(page.locator('#diagSellSyncLine')).to_contain_text(re.compile(rf'卖点 {total}/10 条'))

    def assert_unchanged(snapshot):
        assert product() == snapshot, '取消或校验失败不得修改产品配置'
        assert len(STATE['requests']) == ai_before, '卖点维护不得调用AI'

    def assert_saved_data(expected):
        expect(rows).to_have_count(len(expected))
        saved = product()
        assert [(p['title'], p['content']) for p in saved['sellPoints']] == expected
        assert isinstance(saved.get('description'), str)
        assert all(content in saved['description'] for _, content in expected)
        assert saved['sellPoints'][0]['image'] == image
        assert saved['sellPoints'][0]['id'] == original_id
        assert_stats(len(expected))
        return saved

    def assert_saved(expected):
        expect(dialog).to_be_hidden()
        saved = assert_saved_data(expected)
        assert len(STATE['requests']) == ai_before, '卖点保存不得调用AI'
        return saved

    def assert_error(selector, snapshot):
        expect(page.locator('dialog#diagSellDialog:modal')).to_have_count(1)
        expect(page.locator(selector)).to_be_visible()
        expect(page.locator(selector)).to_have_text(nonempty)
        assert_unchanged(snapshot)

    def assert_methods():
        expect(page.locator('dialog#diagSellDialog:modal')).to_have_count(1)
        expect(page.locator('#diagSellDialogTitle')).to_have_text('你想用哪种方式新增卖点？')
        expect(page.locator('#diagSellMethods')).to_be_visible()
        # 问卷答案只在「问卷」提交时同步生成，卖点页里不再有「问卷输入」入口；「从问卷同步」只是拿问卷的答案重提炼
        expect(dialog.locator('[data-sell-method]:visible')).to_have_count(3)
        expect(page.locator('#diagSellQuiz')).to_have_count(0)
        for method in ('quiz', 'file', 'manual'):
            expect(dialog.locator(f'[data-sell-method="{method}"]')).to_be_visible()
        expect(dialog.locator('[data-sell-method]')).to_have_text([
            '从问卷同步按问卷的内容重新提炼卖点，同标题更新、其他保留',
            '文件导入一次丢一批 Word / Excel / TXT / JSON 文件，系统整理成卖点',
            '录入添加手动填写一条卖点的标题和内容',
        ])
        expect(dialog.locator('[data-sell-form]:visible')).to_have_count(0)
        expect(page.locator('#diagSellBack')).to_have_count(0)      # 「重新选择方式」整排撤了
        expect(page.locator('#diagSellClose')).to_be_visible()
        expect(page.locator('#diagSellSubmit')).to_be_hidden()      # 停在方式页时没有「保存」

    def open_add():
        page.locator('#diagSellAdd').click()
        assert_methods()

    def assert_form(method, editing=False):
        expect(page.locator('dialog#diagSellDialog:modal')).to_have_count(1)
        expect(page.locator('#diagSellMethods')).to_be_hidden()
        expect(dialog.locator('[data-sell-form]:visible')).to_have_count(1)
        expect(dialog.locator(f'[data-sell-form="{method}"]')).to_be_visible()
        # 选了方式就停在这一种：没有回退按钮，要换方式先「关闭」再点「新增卖点」
        expect(page.locator('#diagSellBack')).to_have_count(0)
        expect(page.locator('#diagSellClose')).to_be_visible()
        if method == 'manual':
            expect(page.locator('#diagSellSubmit')).to_be_visible()   # 关闭 + 保存并排在右下角
            expect(dialog.locator('#diagSellTitle.diagSellTitle')).to_be_visible()
            expect(dialog.locator('#diagSellContent.diagSellContent')).to_be_visible()
            expect(page.locator('#diagSellTitle')).to_be_focused()
        elif method == 'file':
            expect(page.locator('#diagSellSubmit')).to_be_hidden()
            expect(dialog.locator('#diagSellFileBtn')).to_be_visible()
            expect(dialog.locator('#diagSellFileImport')).to_be_visible()
            expect(page.locator('#diagSellFileName')).to_have_text('尚未选择文件')
            expect(page.locator('#diagSellFileBtn')).to_be_focused()
        elif method == 'quiz':
            expect(page.locator('#diagSellSubmit')).to_be_hidden()
            expect(dialog.locator('#diagSellQuizRun')).to_be_visible()
            expect(page.locator('#diagSellQuizRun')).to_be_focused()

    def choose(method):
        dialog.locator(f'[data-sell-method="{method}"]').click()
        assert_form(method)

    def open_edit(title):
        row(title).locator('.diag-sell-edit').click()
        assert_form('manual', editing=True)
        expect(page.locator('#diagSellTitle')).to_have_value(title)

    def delete(title, accept):
        seen = []

        def on_dialog(prompt):
            seen.append(prompt.type)
            if accept:
                prompt.accept()
            else:
                prompt.dismiss()

        page.once('dialog', on_dialog)
        try:
            with page.expect_event('dialog'):
                row(title).locator('.diag-sell-delete').click()
        finally:
            page.remove_listener('dialog', on_dialog)
        assert seen == ['confirm'], '删除必须使用原生confirm'

    initial = product()
    assert len(initial['sellPoints']) == 1
    original_title = initial['sellPoints'][0]['title']
    expected = [(original_title, initial['sellPoints'][0]['content'])]
    expect(page.locator('#diagSellList table')).to_be_visible()
    expect(page.locator('#diagSellList thead th')).to_have_text(['卖点标题', '内容摘要', '操作'])
    # ③ 不再自带「去 ① 基础配置」按钮；引导方式也搬走了（获客/截流侧配置）
    expect(page.locator('#diagSellGoto')).to_have_count(0)
    expect(page.locator('#diagGuideOpts')).to_have_count(0)
    expect(page.locator('#diagGuideCustom')).to_have_count(0)
    expect(page.locator('#diagSellSyncLine')).to_contain_text('已随问卷自动生成并保存')
    expect(rows).to_have_count(1)
    expect(dialog).to_be_hidden()
    expect(page.locator('#diagSellTitle')).to_be_hidden()
    expect(page.locator('#diagSellContent')).to_be_hidden()
    expect(row(original_title).locator('.diag-sell-detail')).to_be_hidden()
    for action in ('view', 'edit', 'delete'):
        expect(row(original_title).locator(f'.diag-sell-{action}')).to_be_visible()
    assert_stats(1)
    page.screenshot(path=str(out / 'product-table.png'), full_page=True)

    # 仅修改隔离profile中的配置；补上固定id以实际验证旧记录元数据保真。
    image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    seeded = worker.evaluate('''async (image) => {
        const cfg = await Storage.getConfig();
        cfg.product.sellPoints[0].image = image;
        if (!cfg.product.sellPoints[0].id) cfg.product.sellPoints[0].id = 'sell-fixture-preserved-id';
        await Storage.setConfig(cfg);
        return (await Storage.getConfig()).product;
    }''', image)
    original_id = seeded['sellPoints'][0]['id']
    page.locator('#diagSellRefresh').click()
    assert_saved(expected)

    table_before = page.locator('#diagSellList').bounding_box()
    open_add()
    page.screenshot(path=str(out / 'product-add-modal.png'), full_page=True)
    assert page.locator('#diagSellList').bounding_box() == table_before
    page.locator('#diagSellSearch').evaluate('(el) => el.focus()')
    assert dialog.evaluate('(el) => el.contains(document.activeElement)')
    for _ in range(8):
        page.keyboard.press('Tab')
        assert dialog.evaluate('(el) => el.contains(document.activeElement) || document.activeElement === document.body')
    choose('manual')
    expect(page.locator('#diagSellTitle')).to_have_value('')
    expect(page.locator('#diagSellContent')).to_have_value('')
    for title, content in (('', ''), ('只有标题', ''), ('', '只有内容'), ('   ', '   ')):
        page.locator('#diagSellTitle').fill(title)
        page.locator('#diagSellContent').fill(content)
        page.locator('#diagSellSubmit').click()
        assert_error('#diagSellFormMsg', seeded)
    draft_title = '临时手动新增卖点'
    draft_content = '关闭和重新打开后仍应保留的手动草稿内容'
    page.locator('#diagSellTitle').fill(draft_title)
    page.locator('#diagSellContent').fill(draft_content)
    # 没有「重新选择方式」：换方式＝关闭再点「新增卖点」，草稿不丢
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()
    assert_unchanged(seeded)
    saved = assert_saved_data(expected)
    open_add()
    choose('manual')
    expect(page.locator('#diagSellTitle')).to_have_value(draft_title)
    expect(page.locator('#diagSellContent')).to_have_value(draft_content)
    page.locator('#diagSellClose').click()
    open_add()
    choose('file')
    expect(page.locator('#diagSellFile')).to_have_count(1)
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()
    assert_unchanged(seeded)
    saved = assert_saved_data(expected)
    page.locator(go('quiz')).click()
    expect(q9_picked(page)).to_have_value('我是做体验工具的设计师，做了 5 年，擅长把功能讲成大白话，能帮你选对工具')   # ② 第 9 题＝一句话人设
    page.locator(go('sell')).click()
    for dismiss in ('close', 'escape', 'backdrop'):
        open_add()
        choose('manual')
        expect(page.locator('#diagSellTitle')).to_have_value(draft_title)
        expect(page.locator('#diagSellContent')).to_have_value(draft_content)
        if dismiss == 'close':
            page.locator('#diagSellClose').click()
        elif dismiss == 'escape':
            page.keyboard.press('Escape')
        else:
            page.mouse.click(5, 5)
        expect(dialog).to_be_hidden()
        expect(page.locator('#diagSellAdd')).to_be_focused()
        assert_unchanged(seeded)
    open_add()
    choose('manual')
    expect(page.locator('#diagSellTitle')).to_have_value(draft_title)
    expect(page.locator('#diagSellContent')).to_have_value(draft_content)
    page.locator('#diagSellSubmit').click()
    expected.append((draft_title, draft_content))
    saved = assert_saved(expected)
    expect(page.locator('#diagSellAdd')).to_be_focused()
    assert saved['sellPoints'][0] == seeded['sellPoints'][0]
    open_add()
    choose('manual')
    expect(page.locator('#diagSellTitle')).to_have_value('')
    expect(page.locator('#diagSellContent')).to_have_value('')
    page.locator('#diagSellTitle').fill(original_title)
    page.locator('#diagSellContent').fill('重复标题不得新增或覆盖旧卖点')
    page.locator('#diagSellSubmit').click()
    assert_error('#diagSellFormMsg', saved)
    page.locator('#diagSellClose').click()
    check(page, '卖点默认表格、三种新增方式（问卷同步/文件导入/录入添加）单表单、焦点与关闭、空值校验、草稿保留、即时新增和重复标题拒绝')

    open_edit(original_title)
    expect(page.locator('#diagSellContent')).to_have_value(expected[0][1])
    page.locator('#diagSellTitle').fill('取消编辑不得入库')
    page.locator('#diagSellContent').fill('取消编辑的内容')
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()
    expect(row(original_title).locator('.diag-sell-edit')).to_be_focused()
    assert_unchanged(saved)
    open_add()
    choose('manual')
    expect(page.locator('#diagSellTitle')).to_have_value(original_title)
    expect(page.locator('#diagSellContent')).to_have_value('重复标题不得新增或覆盖旧卖点')
    page.locator('#diagSellClose').click()
    assert_unchanged(saved)
    open_edit(original_title)
    expect(page.locator('#diagSellContent')).to_have_value(expected[0][1])
    page.locator('#diagSellTitle').fill(draft_title)
    page.locator('#diagSellSubmit').click()
    assert_error('#diagSellFormMsg', saved)
    page.locator('#diagSellTitle').fill(original_title)
    page.locator('#diagSellContent').fill('编辑弹窗即时保存的卖点内容')
    untouched = saved['sellPoints'][1:]
    page.locator('#diagSellSubmit').click()
    expected[0] = (original_title, '编辑弹窗即时保存的卖点内容')
    saved = assert_saved(expected)
    assert saved['sellPoints'][1:] == untouched

    open_add()
    choose('file')
    page.locator('#diagSellFileImport').click()
    assert_error('#diagSellFMsg', saved)
    page.locator('#diagSellFile').set_input_files({'name': '坏卖点.json', 'mimeType': 'application/json', 'buffer': b'{not json'})
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('坏卖点.json：JSON 解析失败')
    assert_unchanged(saved)
    appended_title = '临时文件导入追加'
    appended_content = 'JSON 文件追加的临时卖点内容'
    page.locator('#diagSellFile').set_input_files({'name': '卖点.json', 'mimeType': 'application/json', 'buffer': json.dumps([
        {'title': original_title, 'content': '同名文件导入更新后的卖点'},
        {'name': appended_title, 'desc': appended_content},
    ], ensure_ascii=False).encode()})
    expect(page.locator('#diagSellFileName')).to_contain_text('已选择 1 个文件')
    untouched = saved['sellPoints'][1:]
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('更新 1 条', timeout=15000)
    expected[0] = (original_title, '同名文件导入更新后的卖点')
    expected.append((appended_title, appended_content))
    saved = assert_saved_data(expected)
    assert saved['sellPoints'][1:2] == untouched
    assert '编辑弹窗即时保存的卖点内容' not in saved['description']
    expect(page.locator('#diagSellFileName')).to_have_text('尚未选择文件')
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()

    hostile_title = '临时安全<img src=x onerror="window.sellInjected=1">'
    hostile_content = '独有全文检索词 ' + '长文本' * 80 + 'W' * 400 + '\n<img src=x onerror="window.sellInjected=2"> & "引号" <script>window.sellInjected=3</script>'
    open_add()
    choose('file')
    page.locator('#diagSellFile').set_input_files({'name': '安全卖点.json', 'mimeType': 'application/json', 'buffer': json.dumps([
        {'title': original_title, 'content': 'JSON同名更新后的卖点'},
        {'title': hostile_title, 'content': hostile_content},
    ], ensure_ascii=False).encode()})
    untouched = saved['sellPoints'][1:]
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('新增 1 条', timeout=15000)
    expected[0] = (original_title, 'JSON同名更新后的卖点')
    expected.append((hostile_title, hostile_content))
    saved = assert_saved_data(expected)
    assert saved['sellPoints'][1:3] == untouched
    assert '同名文件导入更新后的卖点' not in saved['description']
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()
    safe_row = row(hostile_title)
    expect(safe_row.locator('td').first).to_contain_text(hostile_title)
    expect(safe_row.locator('td').first.locator('img, script')).to_have_count(0)
    expect(safe_row.locator('td').nth(1)).to_have_text(nonempty)
    expect(safe_row.locator('td').nth(1).locator('img, script')).to_have_count(0)
    expect(safe_row.locator('.diag-sell-detail')).to_be_hidden()
    safe_row.locator('.diag-sell-view').click()
    expect(safe_row.locator('.diag-sell-detail')).to_be_visible()
    expect(safe_row.locator('.diag-sell-full')).to_be_visible()
    expect(safe_row.locator('.diag-sell-full')).to_have_text(hostile_content)
    expect(safe_row.locator('.diag-sell-full img, .diag-sell-full script')).to_have_count(0)
    assert page.evaluate('() => window.sellInjected') is None
    safe_row.locator('.diag-sell-view').click()
    expect(safe_row.locator('.diag-sell-detail')).to_be_hidden()
    for query, title in ((original_title, original_title), ('独有全文检索词', hostile_title)):
        page.locator('#diagSellSearch').fill(query)
        expect(visible_rows).to_have_count(1)
        expect(visible_rows).to_contain_text(title)
        assert_stats(4, 1)
    page.locator('#diagSellSearch').fill('完全不存在的卖点检索词')
    expect(visible_rows).to_have_count(0)
    expect(page.locator('#diagSellList table')).to_be_visible()
    assert_stats(4, 0)
    page.locator('#diagSellSearch').fill('')
    expect(visible_rows).to_have_count(4)
    assert_stats(4)
    assert_unchanged(saved)
    check(page, '编辑取消与即时保存、文本及JSON合并、坏JSON不写、旧条目图片/id保真、全文搜索及HTML文字安全')

    try:
        page.set_viewport_size({'width': 500, 'height': 900})
        safe_row.locator('.diag-sell-view').click()
        expect(safe_row.locator('.diag-sell-full')).to_have_text(hostile_content)
        page.locator('#diagSellList').scroll_into_view_if_needed()
        page.screenshot(path=str(out / 'product-narrow.png'), full_page=True)
        assert page.locator('#diagStepBody').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
        # 只约束诊断区自身：页面头部的常驻控件行在 500px 下本就横向超出（历史行为，与诊断无关）。
        narrow = page.evaluate('''() => {
            const box = document.getElementById('diagBody');
            const rect = box.getBoundingClientRect();
            return { scroll: box.scrollWidth, client: box.clientWidth, left: Math.round(rect.left), right: Math.round(rect.right) };
        }''')
        assert narrow['scroll'] <= narrow['client'] + 1, narrow
        assert narrow['left'] >= -1 and narrow['right'] <= 501, narrow
        assert page.locator('#diagSellList').evaluate('''(el) => {
            if (el.scrollWidth <= el.clientWidth || !['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) return false;
            el.scrollLeft = 40;
            const scrolled = el.scrollLeft > 0;
            el.scrollLeft = 0;
            return scrolled;
        }''')
        assert safe_row.locator('.diag-sell-full').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
        open_edit(hostile_title)
        expect(page.locator('#diagSellContent')).to_have_value(hostile_content)
        assert dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
        rect = dialog.bounding_box()
        assert rect['x'] >= 0 and rect['x'] + rect['width'] <= 500
        page.locator('#diagSellClose').click()
        expect(dialog).to_be_hidden()
        assert_unchanged(saved)
    finally:
        page.set_viewport_size({'width': 1180, 'height': 1000})
    check(page, '窄窗口仅卖点表格横向滚动，长文本换行且编辑弹窗不溢出')

    # 4条已有卖点 + 7条新卖点超限，连同同名更新必须整批拒绝。
    capacity = [{'title': f'临时容量卖点{i}', 'content': f'容量验证的临时内容{i}'} for i in range(1, 8)]
    open_add()
    choose('file')
    page.locator('#diagSellFile').set_input_files({'name': '超限卖点.json', 'mimeType': 'application/json', 'buffer': json.dumps([
        {'title': original_title, 'content': '超限批次不得写入的同名更新'},
        *capacity,
    ], ensure_ascii=False).encode()})
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('超过 10 条上限')
    assert_unchanged(saved)
    expect(rows).to_have_count(4)
    page.locator('#diagSellFile').set_input_files({'name': '容量卖点.json', 'mimeType': 'application/json', 'buffer': json.dumps(capacity[:6], ensure_ascii=False).encode()})
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('新增 6 条', timeout=15000)
    previous_points = saved['sellPoints']
    expected.extend((p['title'], p['content']) for p in capacity[:6])
    saved = assert_saved_data(expected)
    assert saved['sellPoints'][:4] == previous_points
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()
    if page.locator('#diagSellAdd').is_enabled():
        open_add()
        choose('manual')
        page.locator('#diagSellTitle').fill('不应入库的第十一条卖点')
        page.locator('#diagSellContent').fill('手动新增也不得突破十条上限')
        page.locator('#diagSellSubmit').click()
        assert_error('#diagSellFormMsg', saved)
        page.locator('#diagSellClose').click()
        expect(dialog).to_be_hidden()
    else:
        expect(page.locator('#diagSellAdd')).to_be_disabled()
        assert_unchanged(saved)
    delete(hostile_title, accept=False)
    expect(rows).to_have_count(10)
    assert_unchanged(saved)
    # 先确认删除刚才取消的同一条目；只删临时条目，保留首条供最终断言。
    temporary = [(hostile_title, hostile_content)] + [p for p in expected[1:] if p[0] != hostile_title]
    for title, content in temporary:
        previous_points = saved['sellPoints']
        delete(title, accept=True)
        expected.remove((title, content))
        saved = assert_saved(expected)
        assert saved['sellPoints'] == [p for p in previous_points if p['title'] != title]
        assert content not in saved['description']
        expect(page.locator('#diagSellMsg')).to_be_visible()
        expect(page.locator('#diagSellMsg')).to_have_text(nonempty)
    expect(page.locator('#diagSellAdd')).to_be_enabled()
    check(page, '十条上限与整批拒绝、原生删除确认及取消、删除即时落盘并清理临时卖点')

    # 文件导入：Word / Excel 在本机解包抽文字后才交给 AI（原文件不上传），坏文件逐个点名、不阻断整批。
    open_add()
    choose('file')
    docx_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    xlsx_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    word_title, excel_title = '来自 Word 的卖点', '来自 Excel 的卖点'
    page.locator('#diagSellFile').set_input_files([
        {'name': '旧版卖点.doc', 'mimeType': 'application/msword', 'buffer': b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy'},
        {'name': '坏卖点.docx', 'mimeType': docx_mime, 'buffer': b'PK\x03\x04\x00\x00binary'},
        {'name': '空卖点.txt', 'mimeType': 'text/plain', 'buffer': b'   '},
        {'name': 'Word 卖点.docx', 'mimeType': docx_mime, 'buffer': docx_bytes(
            ['Word 卖点：配置一次就能长期自动运行。', '第二条说明文字。'],
            table=[['优势', '说明'], ['省时间', '不用盯着后台']])},
        {'name': 'Excel 卖点.xlsx', 'mimeType': xlsx_mime, 'buffer': xlsx_bytes(
            [['Excel 卖点', '备注'], ['每月 239', '含后续更新']], [['第二张表', '也要一起读']])},
    ])
    expect(page.locator('#diagSellFileName')).to_contain_text('已选择 5 个文件')
    ai_before = len(STATE['requests'])
    # 清掉上一次导入留下的摘要，确保等到的是本批结果。
    page.locator('#diagSellFMsg').evaluate('(el) => { el.textContent = ""; }')
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('成功 2 个', timeout=60000)
    expect(page.locator('#diagSellFMsg')).to_contain_text('失败 3 个')
    expect(page.locator('#diagSellFMsg')).to_contain_text('旧版卖点.doc：旧版 Office 格式读不了')
    expect(page.locator('#diagSellFMsg')).to_contain_text('坏卖点.docx：文件已损坏')
    expect(page.locator('#diagSellFMsg')).to_contain_text('空卖点.txt：文件为空')
    assert len(STATE['requests']) == ai_before + 2, len(STATE['requests']) - ai_before
    # 喂给 AI 的是解包后的正文（含 Word 表格行、Excel 多张表），不是原文件或二进制垃圾。
    word_call = next(r['messages'][1]['content'] for r in STATE['requests'][ai_before:] if 'Word 卖点：配置一次' in r['messages'][1]['content'])
    assert '省时间\t不用盯着后台' in word_call, word_call
    excel_call = next(r['messages'][1]['content'] for r in STATE['requests'][ai_before:] if 'Excel 卖点' in r['messages'][1]['content'])
    assert '每月 239\t含后续更新' in excel_call and '第二张表\t也要一起读' in excel_call, excel_call
    expected.append((word_title, 'Word 文档里的优势已提炼成卖点。'))
    expected.append((excel_title, 'Excel 表格里的价格已提炼成卖点。'))
    # 本批已经调用过 AI，后面的“不得调用 AI”断言以此为基准。
    ai_before = len(STATE['requests'])
    saved = assert_saved_data(expected)
    expect(dialog).to_be_visible()
    check(page, 'Word / Excel 在本机解包成文字后才交给 AI：段落、表格行、多张工作表都能读到')
    # 失败文件留在选择里可重试；已入库的不会再被处理。
    expect(page.locator('#diagSellFileName')).to_contain_text('已选择 3 个文件')
    page.locator('#diagSellFMsg').evaluate('(el) => { el.textContent = ""; }')
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('失败 3 个', timeout=30000)
    assert_unchanged(saved)
    # 一次超过 20 个：整批拒绝，不读文件也不写库。
    page.locator('#diagSellFile').set_input_files([{'name': f'批量卖点{i}.txt', 'mimeType': 'text/plain', 'buffer': b'x'} for i in range(21)])
    page.locator('#diagSellFileImport').click()
    expect(page.locator('#diagSellFMsg')).to_contain_text('一次最多导入 20 个文件')
    assert_unchanged(saved)
    page.locator('#diagSellClose').click()
    expect(dialog).to_be_hidden()
    check(page, '批量导入：坏文件逐个点名不阻断整批、失败保留可重试、超 20 个整批拒绝')

    open_edit(original_title)
    page.locator('#diagSellContent').fill('手工补充的真实产品卖点')
    page.locator('#diagSellSubmit').click()
    expected[0] = (original_title, '手工补充的真实产品卖点')
    saved = assert_saved(expected)
    assert 'JSON同名更新后的卖点' not in saved['description']
    # 产品名称在「基础配置」跟账号类型一起保存（说话风格已并进「人设」页）：不动引导方式（引导方式已归获客/截流侧），也不覆盖最新卖点/图片。
    guide_before = product()['guideText']
    page.locator(go('base')).click()
    expect(page.locator('#diagProdName')).to_have_value(initial['name'])   # 等异步回填完成，别和预填抢
    for name in ('手工维护的测试产品名', initial['name']):
        page.locator('#diagProdName').fill(name)
        # 清掉上次显示状态，确保等待的是本次异步保存完成。
        page.locator('#diagS1Msg').evaluate('(el) => { el.textContent = ""; }')
        page.locator('#diagS1Save').click()
        expect(page.locator('#diagS1Msg')).to_contain_text('已保存')
        updated = product()
        assert updated['name'] == name and updated['guideText'] == guide_before
        assert updated['sellPoints'] == saved['sellPoints']
        assert updated['description'] == saved['description']
    # 五十二改：产品名称支持多个——每行一个（逗号/分号也切），第一行＝主名、后面＝别名。
    page.locator('#diagProdName').fill('体验工具\n小过助手，体验版')
    page.locator('#diagS1Msg').evaluate('(el) => { el.textContent = ""; }')
    page.locator('#diagS1Save').click()
    expect(page.locator('#diagS1Msg')).to_contain_text('已保存')
    multi = product()
    assert multi['name'] == '体验工具', multi['name']
    assert multi['names'] == ['体验工具', '小过助手', '体验版'], multi['names']
    # 喂提示词的是「主名（又名：别名 / 别名）」，只有一个名字时不带括号
    assert worker.evaluate('() => prodLabelOf({ names: ["体验工具", "小过助手", "体验版"], name: "体验工具" })') == '体验工具（又名：小过助手 / 体验版）'
    assert worker.evaluate('() => prodLabelOf({ names: ["体验工具"], name: "体验工具" })') == '体验工具'
    assert worker.evaluate('() => prodLabelOf(null)') == '我的产品'
    page.locator('#diagProdName').fill('体验工具')
    page.locator('#diagS1Msg').evaluate('(el) => { el.textContent = ""; }')
    page.locator('#diagS1Save').click()
    expect(page.locator('#diagS1Msg')).to_contain_text('已保存')
    assert product()['names'] == ['体验工具'], '只留主名时别名要跟着清掉'
    page.locator(go('sell')).click()
    page.locator('#diagSellRefresh').click()
    assert_saved(expected)
    assert page.evaluate('() => window.sellInjected') is None
    assert len(STATE['requests']) == ai_before
    check(page, '最终首条通过编辑弹窗保存；保存产品基本配置不覆盖卖点和图片（产品名多值＝主名+别名，提示词拼「又名」，全程不调用AI）')


def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    out = pathlib.Path(tempfile.mkdtemp(prefix='xhs-diagnosis-'))
    print('Artifacts:', out, flush=True)
    errors = []
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(str(out / 'profile'), channel='msedge', headless=False, accept_downloads=True, viewport={'width': 1180, 'height': 1000}, args=[f'--disable-extensions-except={ROOT / "extension"}', f'--load-extension={ROOT / "extension"}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            eid = worker.url.split('/')[2]
            worker.evaluate('''async (base) => {
                await ensureTenantInit();
                const cfg = await Storage.getConfig();
                cfg.ai = { apiBaseUrl: base, apiKey: 'isolated-test-only', model: 'fixture', _modelLocked: true };
                await Storage.setConfig(cfg);
                handleExtractOwnProfile = async () => ({ profile: { name: '测试账号', xhsId: 'fixture', desc: '工具使用经验', notes: [] } });
            }''', f'http://127.0.0.1:{server.server_port}/v1')
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'chrome-extension://{eid}/popup.html?mode=big')
            page.wait_for_load_state('domcontentloaded')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabDiagnose').click()
            expect(page.locator('#diagSubTabs')).to_be_visible(timeout=10000)   # 点完等它真展开再量几何（左栏刚起来就点，事件可能被还没撤掉的遮罩吃掉）
            # 诊断的 6 个节点是左栏「诊断&配置」正下方的二级 tab（不是页内导航圈）；「诊断&配置」本身排在最前
            # 它下面紧跟一级「发笔记」：中间再插别的东西，就会被读成诊断的下一个节点。
            sub_tabs = page.evaluate('''() => {
                const main = document.getElementById('mainTabs');
                const sub = document.getElementById('diagSubTabs');
                const setTabs = document.getElementById('setTabs');
                const sep = sub.nextElementSibling;
                return {
                    tops: [...main.querySelectorAll(':scope > .main-tab .rail-tx')].map(e => e.textContent).join('|'),
                    diagBottom: Math.round(document.getElementById('tabDiagnose').getBoundingClientRect().bottom),
                    subTop: Math.round(sub.getBoundingClientRect().top),
                    nextIsNote: !!(sep && sep.id === 'tabNotePublish'),
                    setLast: setTabs.nextElementSibling === null,
                    labels: [...sub.querySelectorAll('.sub-tab .rail-tx')].map(e => e.textContent).join('|'),
                    icons: sub.querySelectorAll('.ic').length,
                };
            }''')
            # 配色只认三种既定色：未选中=灰(--c-ink-3) / 已走完=绿(.done 的 #0a7b5a) / 当前节点=红(--c-brand-ink)，
            # 谁都不许再有自己的专用色。
            # 颜色可能正落在上一种状态的颜色过渡里（刚点进诊断那一下），连读两次一致才算稳
            def sub_colors():
                return page.evaluate('''() => [...document.querySelectorAll('#diagSubTabs .sub-tab .rail-tx')]
                    .map(e => getComputedStyle(e).color)''')
            prev = None
            for _ in range(15):
                cur = sub_colors()
                if prev is not None and cur == prev:
                    break
                prev = cur
                page.wait_for_timeout(120)
            sub_tabs['colors'] = sorted(set(prev or []))
            sub_tabs['palette'] = page.evaluate('''() => {
                const p = document.createElement('span');
                p.style.position = 'absolute';
                document.body.appendChild(p);
                const read = (v) => { p.style.color = 'var(' + v + ')'; return getComputedStyle(p).color; };
                const out = { ink3: read('--c-ink-3'), brandInk: read('--c-brand-ink') };
                p.remove();
                return out;
            }''')
            assert sub_tabs['tops'] == '诊断&配置|发笔记|获客|线索|设置', sub_tabs
            assert sub_tabs['subTop'] >= sub_tabs['diagBottom'] - 2, ('二级栏必须紧贴「诊断&配置」下方', sub_tabs)
            assert sub_tabs['nextIsNote'], ('诊断二级栏下面必须直接是一级「发笔记」，否则会被读成诊断的下一个节点', sub_tabs)
            assert sub_tabs['setLast'], ('「设置」这组得钉在左栏最底下', sub_tabs)
            assert sub_tabs['labels'] == '基础配置|问卷|人设|产品卖点|知识库|规划', sub_tabs
            assert sub_tabs['icons'] == 6, sub_tabs                      # 6 个节点各有图标，窄栏也要认得出
            assert not re.search(r'[①②③④⑤⑥⑦⑧⑨]', sub_tabs['labels']), \
                ('节点号在界面上整批废掉（说话风格并入「人设」、客服话术去「线索 → 任务配置」、内容基调去「发笔记 → 任务配置」），左栏只留名字', sub_tabs)
            assert '✓' not in sub_tabs['labels'], ('完成状态只走 .done 变绿，标签里别再塞「✓」跟图标叠成两个', sub_tabs)
            assert set(sub_tabs['colors']) <= {sub_tabs['palette']['ink3'], sub_tabs['palette']['brandInk'], 'rgb(10, 123, 90)'}, \
                ('6 个节点只许「未选中灰 / 已走完绿 / 当前节点红」三种既定色，谁都不许有自己的专用色', sub_tabs)
            page.locator('#tabHuoke').click()
            expect(page.locator('#diagSubTabs')).to_be_hidden()          # 切到别的一级项，这组就收起来
            expect(page.locator('#subTabs')).to_be_visible()
            page.locator('#tabDiagnose').click()
            expect(page.locator('#diagSubTabs')).to_be_visible()
            check(page, '诊断&配置排左栏最前、6 节点是它正下方的二级 tab：紧贴其下、随一级项显隐')
            # 嵌在诊断页里的老宿主整批撤：杂项并进「基础配置」、客服话术去「线索 → 任务配置」、内容基调去「发笔记 → 任务配置」
            for gone in ('#diagMiscContent', '#diagMiscFrame', '#diagAicsContent', '#diagAicsFrame'):
                expect(page.locator(gone)).to_have_count(0)
            page.locator(go('base')).click()
            expect(page.locator('#diagnoseContent')).to_be_visible()
            expect(page.locator('#diagBody')).to_be_visible()
            check(page, '诊断左栏只剩 6 个节点：话术 / 基调的入口与宿主都不在诊断里了')
            # ── 客户话术搬到「线索 → 任务配置」：整页嵌 settings.html?embed=1#leadtask，页内四个横 tab ──
            page.locator('#tabProspect').click()
            page.locator('#tabLeadTaskCfg').click()
            lead_frame = page.frame_locator('#leadTaskCfgFrame')
            lead_frame.locator('#tab-leadtask.tab-panel.active').wait_for(state='attached', timeout=20000)
            expect(lead_frame.locator('#ltCfgTabs .cfgtab')).to_have_text(
                ['🎙 渠道基调', '💰 成交引导', '🗨 话术配置', '🧪 试问答'])
            expect(lead_frame.locator('#ltCfgTabs .cfgtab.active')).to_have_text('🎙 渠道基调')
            expect(lead_frame.locator('.cfgsec[data-sec="ch"] #trChannels')).to_be_visible()
            expect(lead_frame.locator('#aicsChannels')).to_have_count(0)   # 渠道基调只在横 tab 那一节，不再单挂一块
            # 「🗨 话术配置」点进去才挂载（一次只画那一节，别的 tab 不抢 AI 也不抢读盘）
            expect(lead_frame.locator('#aicsQa')).to_have_count(0)
            lead_frame.locator('#ltCfgTabs .cfgtab[data-sec="qa"]').click()
            lead_frame.locator('#aicsQa').wait_for(state='visible', timeout=20000)
            expect(lead_frame.locator('.cfgsec[data-sec="qa"]')).to_be_visible()
            expect(lead_frame.locator('.cfgsec[data-sec="ch"]')).to_be_hidden()
            # 「话术 → 知识库」的按钮和功能整批撤（老板：不要了）
            assert '转知识库' not in lead_frame.locator('#aicsBody').inner_text(), '话术配置页不该再有转知识库入口'
            # 客服话术＝卡片列表 + 编辑弹窗：一条一行卡（分类 + 关键词 + 模式·处理 + 启用 + ✏️/🗑），
            # 改与新增都进弹窗，页面上不再铺表格式表单。
            # 新库自带内置话术（DEFAULT_CONFIG.aiCustomerService.qa，当前 9 条），所以条数是加一/删一/清零来验，
            # 空态提示靠删光内存里的行看（没点「保存全部」，不落盘）
            n0 = lead_frame.locator('#aicsQa .aics-row').count()
            assert n0 >= 1, '新库该自带内置客服话术（否则下面加一条/删光的验法要改）'
            assert lead_frame.locator('#aicsQa table').count() == 0, '话术库该是卡片列表，不再是一张可编辑表'
            for cls in ('.aics-qa-on', '.aics-qa-edit', '.aics-qa-del'):
                assert lead_frame.locator('#aicsQa ' + cls).count() == n0, '%s 该每条一个（%d 条）' % (cls, n0)
            for cls in ('.aics-qa-cat', '.aics-qa-kw', '.aics-qa-ans', '.aics-qa-mode', '.aics-qa-auto'):
                assert lead_frame.locator('#aicsQa ' + cls).count() == 0, '列表页不该再铺 %s 这种表单控件' % cls
            # ➕ 新增一条 → 弹窗；列表不跟着长，点「保存这条」才进列表
            lead_frame.locator('#aicsAdd').click()
            expect(lead_frame.locator('#aicsQaModal')).to_be_visible()
            expect(lead_frame.locator('#aicsQaModalTitle')).to_have_text('➕ 新增话术')
            expect(lead_frame.locator('#aicsQa .aics-row')).to_have_count(n0)
            lead_frame.locator('#aicsQaModalOk').click()
            expect(lead_frame.locator('#aicsQaModalMsg')).to_contain_text('话术不能空着')     # 空话术不给存
            lead_frame.locator('#aicsQaCat').fill('测试分类')
            lead_frame.locator('#aicsQaKw').fill('测试词一，测试词二')
            lead_frame.locator('#aicsQaAns').fill('这条是自检写进去的测试话术。')
            lead_frame.locator('#aicsQaAuto').select_option('auto')
            lead_frame.locator('#aicsQaModalOk').click()
            expect(lead_frame.locator('#aicsQaModal')).to_be_hidden()
            expect(lead_frame.locator('#aicsQa .aics-row')).to_have_count(n0 + 1)
            newrow = lead_frame.locator('#aicsQa .aics-row').last
            expect(newrow).to_contain_text('测试分类')
            expect(newrow).to_contain_text('测试词一')
            expect(newrow).to_contain_text('模板 · 自动')
            check(page, '线索 → 任务配置 四个横 tab；🗨 话术配置＝卡片列表（分类 / 关键词 / 模式·处理 / 启用 / ✏️ / 🗑），新增走弹窗、空话术不给存')
            # ✏️ 编辑：弹窗回填原值，改完回列表（脏数据先落在内存）
            newrow.locator('.aics-qa-edit').click()
            expect(lead_frame.locator('#aicsQaModalTitle')).to_have_text('✏️ 编辑话术')
            expect(lead_frame.locator('#aicsQaCat')).to_have_value('测试分类')
            expect(lead_frame.locator('#aicsQaKw')).to_have_value('测试词一，测试词二')
            expect(lead_frame.locator('#aicsQaAns')).to_have_value('这条是自检写进去的测试话术。')
            lead_frame.locator('#aicsQaAns').fill('改过之后的测试话术。')
            lead_frame.locator('#aicsQaModalOk').click()
            expect(lead_frame.locator('#aicsQa .aics-row')).to_have_count(n0 + 1)
            expect(lead_frame.locator('#aicsQa .aics-row').last).to_contain_text('改过之后的测试话术。')
            # 启停开关直接在列表上改（记进内存，保存全部才落盘）
            newrow = lead_frame.locator('#aicsQa .aics-row').last
            newrow.locator('.aics-qa-on').uncheck()
            lead_doc = next(f for f in page.frames
                            if 'settings.html' in (f.url or '') and (f.url or '').endswith('#leadtask'))
            assert lead_doc.evaluate('() => _aics.qa[_aics.qa.length - 1].enabled') is False
            newrow.locator('.aics-qa-on').check()
            # 🧪 试问答＝会话形式（多次问、多次答，记录留着）：先测问答——内置话术还在库里，命中模板不该烧 AI
            lead_frame.locator('#ltCfgTabs .cfgtab[data-sec="test"]').click()
            expect(lead_frame.locator('.cfgsec[data-sec="test"] #aicsChat')).to_contain_text('还没有对话')
            expect(lead_frame.locator('#aicsTest')).to_be_visible()
            expect(lead_frame.locator('#aicsChatClear')).to_be_visible()
            expect(lead_frame.locator('#aicsQa')).to_be_hidden()       # 一次只显那一节（cfgsec 用 display:none 收起，元素仍在 DOM）
            ai_before = len(STATE['requests'])
            lead_frame.locator('#aicsIn').fill('几号发货')
            lead_frame.locator('#aicsTest').click()
            expect(lead_frame.locator('#aicsChat > div')).to_have_count(2, timeout=20000)
            expect(lead_frame.locator('#aicsChat')).to_contain_text('物流')
            lead_frame.locator('#aicsIn').fill('多少钱')
            lead_frame.locator('#aicsTest').click()
            expect(lead_frame.locator('#aicsChat > div')).to_have_count(4, timeout=20000)
            expect(lead_frame.locator('#aicsChat')).to_contain_text('比价')
            expect(lead_frame.locator('#aicsIn')).to_have_value('')      # 发完清空输入框，接着问下一句
            assert len(STATE['requests']) == ai_before, '命中模板话术不该调用 AI'
            # 切走再回来：会话记录与话术列表都还在（内嵌页不重载）
            lead_frame.locator('#ltCfgTabs .cfgtab[data-sec="qa"]').click()
            lead_frame.locator('#ltCfgTabs .cfgtab[data-sec="test"]').click()
            expect(lead_frame.locator('#aicsChat > div')).to_have_count(4)
            check(page, '🧪 试问答＝会话形式：一问一答各一条气泡、多轮都留着、命中模板不烧 AI')
            # 删与启停都在「🗨 话术配置」那一节：先把 tab 切回 qa（cfgsec 用 display:none 收着，不切回来点不到）
            lead_frame.locator('#ltCfgTabs .cfgtab[data-sec="qa"]').click()
            newrow = lead_frame.locator('#aicsQa .aics-row').last
            # 🗑 删除有 confirm：先「取消」不删，再「确认」删掉；删光只落在内存（没点「保存全部」，不落盘）
            reply = {'accept': False}
            seen = []
            def _dlg(d):
                seen.append(d.type)
                d.accept() if reply['accept'] else d.dismiss()
            page.on('dialog', _dlg)
            try:
                newrow.locator('.aics-qa-del').click()
                expect(lead_frame.locator('#aicsQa .aics-row')).to_have_count(n0 + 1)
                reply['accept'] = True
                newrow.locator('.aics-qa-del').click()
                expect(lead_frame.locator('#aicsQa .aics-row')).to_have_count(n0)
                for _ in range(n0):
                    lead_frame.locator('#aicsQa .aics-qa-del').first.click()
            finally:
                page.remove_listener('dialog', _dlg)
            assert seen and all(t == 'confirm' for t in seen), seen
            expect(lead_frame.locator('#aicsQa')).to_contain_text('还没有客服话术')
            expect(lead_frame.locator('#aicsChat')).to_be_hidden()      # 一次只显那一节：会话跟着 tab 收起
            lead_frame.locator('#ltCfgTabs .cfgtab[data-sec="test"]').click()
            lead_frame.locator('#aicsChatClear').click()
            expect(lead_frame.locator('#aicsChat')).to_contain_text('还没有对话')
            check(page, '🗨 话术配置：✏️ 回填原值、启停即改即显、🗑 带原生 confirm（取消不删/确认才删），删光给引导提示；🧪 清空只清会话')
            # 宿主在「线索」这一组里：切到别的一级项收起，回线索不重载（内存里删光的话术又回列表＝读盘重挂）
            page.locator('#tabHuoke').click()
            expect(page.locator('#leadTaskCfgContent')).to_be_hidden()
            expect(page.locator('#leadTabs')).to_be_hidden()
            page.locator('#tabProspect').click()
            page.locator('#tabLeadTaskCfg').click()
            expect(page.locator('#leadTaskCfgContent')).to_be_visible()
            expect(lead_frame.locator('#ltCfgTabs .cfgtab.active')).to_have_text('🧪 试问答')
            check(page, '任务配置内嵌页随一级项显隐：切到获客收起、回线索还停在原 tab（不重载）')
            page.locator('#tabDiagnose').click()
            expect(page.locator('#diagSubTabs')).to_be_visible()
            page.locator(go('base')).click()
            expect(page.locator('#diagnoseContent')).to_be_visible()
            check(page, '话术搬走后诊断回到「只有 6 个节点」的链上')
            page.locator(go('kb')).click()
            expect(page.locator('#diagKList')).to_contain_text('暂无知识', timeout=20000)   # 全新 profile 首次读库含租户初始化，给足冷启动时间
            assert not is_done(page, 'base'), '① 还没抓主页，不该打勾'
            assert not is_done(page, 'plan'), '⑨ 的报告还没生成，不该打勾'
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            expect(page.locator('#diagKImp')).to_be_hidden()
            expect(page.locator('#diagKFileImport')).to_be_hidden()
            expect(page.locator('#diagKQuiz')).to_have_count(0)
            expect(page.locator('#diagKList table')).to_be_visible()
            expect(page.locator('#diagKList thead th')).to_have_text(['知识标题 / 正文 / 标签', '分类', '状态', '操作'])
            table_before = page.locator('#diagKList').bounding_box()
            page.locator('#diagKAddBtn').click()
            expect(page.locator('#diagKAddPanel:modal')).to_have_count(1)
            expect(page.locator('#diagKAddTitle')).to_have_text('你想用哪种方式新增知识？')
            # 问卷答案由「问卷」页提交时自动整理入库，知识库里只剩「随意输入」与「文件导入」。
            expect(page.locator('[data-kb-method]:visible')).to_have_count(2)
            expect(page.locator('[data-kb-method]')).to_have_text([
                '随意输入，AI 整理直接输入或粘贴经验、聊天记录、产品说明',
                '文件导入一次丢一批 Word / Excel / TXT / MD / CSV 文件，系统整理后入库',
            ])
            expect(page.locator('[data-kb-form]:visible')).to_have_count(0)
            # 选完方式不再给「重新选择方式」的退路（老板：那个按钮很奇怪）——只有关闭
            expect(page.locator('#diagKAddBack')).to_have_count(0)
            expect(page.locator('#diagKAddCancel')).to_be_visible()
            assert page.locator('#diagKList').bounding_box() == table_before
            page.locator('#diagKSearch').evaluate('(el) => el.focus()')
            assert page.evaluate('() => document.getElementById("diagKAddPanel").contains(document.activeElement)')
            for _ in range(8):
                page.keyboard.press('Tab')
                assert page.evaluate('() => document.getElementById("diagKAddPanel").contains(document.activeElement) || document.activeElement === document.body')
            page.locator('#diagKAddCancel').click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            expect(page.locator('#diagKAddBtn')).to_be_focused()
            page.locator('#diagKAddBtn').click()
            page.keyboard.press('Escape')
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            expect(page.locator('#diagKAddBtn')).to_be_focused()
            page.locator('#diagKAddBtn').click()
            page.mouse.click(5, 5)
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            expect(page.locator('#diagKAddBtn')).to_be_focused()
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="file"]').click()
            expect(page.locator('#diagKMethods')).to_be_hidden()
            expect(page.locator('[data-kb-form]:visible')).to_have_count(1)
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('请先选择')
            assert page.locator('#diagKFileImport').bounding_box()['height'] >= 34
            page.locator('#diagKAddCancel').click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            assert not STATE['requests']
            check(page, '默认查看列表；点击新增才选择方式；取消不调用AI且返回列表')
            # 知识库页不再挂「去 ① 基础配置」，也没有「问卷同步」入口（问卷由 ② 提交时自动整理）。
            expect(page.locator('#diagKGoto')).to_have_count(0)
            # 标题下的说明行整段撤（2026-09-25 二十九改）：没随问卷同步过时这行是空的，
            # 空态只在列表里说一次（别在标题下再说一遍「还没有知识…」）
            expect(page.locator('#diagKSyncLine')).to_have_text('')
            expect(page.locator('#diagKList')).to_contain_text('暂无知识')
            assert not STATE['requests']
            check(page, '知识库页无「去 ① 基础配置」按钮与问卷入口；标题下说明行已撤（空库时该行为空），空态只在列表里说一次')
            page.locator(go('base')).click()
            # ① 基础配置 = 产品名称 + 账号类型 + 抓主页；说话风格整组搬到 ⑥，问卷在 ②
            for sel in ('#diagProdName', '#diagAcctChips', '#diagAcctCustom', '#diagS1Save', '#diagS1Profile'):
                expect(page.locator(sel)).to_be_visible()
            expect(page.locator('#diagAcctChips .diag-acct-chip')).to_have_count(7)
            expect(page.locator('.diagQuiz_Q')).to_have_count(0)
            for sel in ('#diagMinC', '#diagMaxC', '#diagToneRun', '#diagTq0'):
                expect(page.locator(sel)).to_have_count(0)      # 说话风格不在 ① 了
            # 「下一步」整批下线：① 不再有它，换节点只走左侧栏
            expect(page.locator('#diagStepBody button:has-text("下一步")')).to_have_count(0)
            # 说话风格不再是左栏节点：它并进了「人设」页当第二个横 tab（2026-09-25 起口癖池 / 口吻样本那套输入框已撤，
            # 换成 3 个问题（大白话答完 →「🧠 识别我的口吻」由 AI 认）+ 字数两栏）
            # 先停在 👤 人设：没答过问卷时不给同步按钮、不给提示行，只在输入框 placeholder 里提示先去答问卷
            persona_tab(page)
            expect(page.locator('#diagPSync')).to_have_count(0)
            expect(page.locator('#diagPSyncLine')).to_have_count(0)
            expect(page.locator('#diagPEdit')).to_have_attribute('placeholder', re.compile('还没答过问卷'))
            expect(page.locator('#diagPStatus')).to_have_text('', timeout=15000)   # 框上方不再重复一句「还没有人设…」
            persona_tab(page, 'style')
            for sel in ('#diagMinC', '#diagMaxC', '#diagToneRun', '#diagStyleSave'):
                expect(page.locator(sel)).to_be_visible()
            for sel in ('#diagTq0', '#diagTq1', '#diagTq2'):
                expect(page.locator(sel)).to_be_visible()
            for gone in ('#diagTone', '#diagSample'):
                expect(page.locator(gone)).to_have_count(0)     # 口癖池 / 口吻样本那两个输入框不在了
            style_txt = page.locator('#diagStepBody').inner_text()
            assert '口癖池' not in style_txt and '口吻样本' not in style_txt, style_txt[:200]
            expect(page.locator('.diagQuiz_Q')).to_have_count(0)
            # 「问卷」不再等「先抓主页」：进页就是 13 问（选择题优先）；简介字段也已下线（简介取基础配置抓到的本人主页）
            page.locator(go('quiz')).click()
            expect(page.locator('.diagQuiz_Q')).to_have_count(13)
            expect(page.locator('.diagQuiz_chip').first).to_be_visible()   # 选择题优先：chips 点选 + textarea 补充
            expect(page.locator('#diagS2GoSetup')).to_have_count(0)
            expect(page.locator('#diagQuizBio')).to_have_count(0)
            page.locator('#diagQuizNext').click()
            expect(page.locator('#diagQuizMsg')).to_contain_text('至少')
            assert not STATE['requests']
            check(page, '基础配置＝产品名称+账号类型+抓主页、全页无「下一步」；说话风格住在「人设」页第二个横 tab；问卷不依赖抓主页、无简介输入框，空问卷不调用AI')
            # 抓主页照旧：抓完基础配置打勾；问卷已填的答案切走再回来不丢
            page.locator(go('base')).click()
            expect(page.locator('#diagFetchBtn')).to_be_visible()
            page.locator('#diagFetchBtn').click()
            assert park_done(page, 'base'), '抓到主页 ① 该打勾'
            page.locator(go('quiz')).click()
            expect(page.locator('.diagQuiz_Q')).to_have_count(13)
            answers = ['我是产品设计师', '体验工具', '亲自使用过', '最常问多少钱', '同行乱报价', '拆解使用方法', '初学者', '分享教程', '我是做体验工具的设计师，做了 5 年，擅长把功能讲成大白话，能帮你选对工具', '你', '真实照片（只有几张）', '私信我', '每周两篇']
            for i, value in enumerate(answers):
                page.locator('.diagQuiz_Q').nth(i).fill(value)
            page.locator('#diagQuizNext').click()
            expect(page.locator('#diagQuizNext')).to_be_enabled(timeout=30000)
            cfg = worker.evaluate('() => Storage.getConfig()')
            assert all(v['status'] == 'done' for v in cfg['diagnosis']['results'].values()), cfg['diagnosis']['results']
            assert len(STATE['requests']) == 4, len(STATE['requests'])
            assert cfg['product']['name'] == '体验工具'
            assert cfg['product']['coverHook'] == '耐心的工具分享者'
            assert len(cfg['product']['sellPoints']) == 1
            # ① 抓到主页、② 提交问卷 → 左栏各节点跟着打勾（站在 ⑥ 上看，当前节点不画 .done）
            assert park_done(page, 'quiz', park='base'), '提交问卷后 ② 该打勾'   # 停在「基础配置」看：kb 紧跟在后面要被断言，不能当停靠页（当前节点不画 .done）
            for t in ('persona', 'sell', 'kb'):
                assert is_done(page, t), '%s 该打勾' % t
            # ⑨ 规划含深度报告：报告还没生成就不打勾
            assert not is_done(page, 'plan'), '⑨ 还没生成报告，不该打勾'
            assert worker.evaluate('async () => (await chrome.storage.local.get("deep_report")).deep_report') is None
            page.locator(go('quiz')).click()   # 回 ②：切走再回来答案不丢（下面要验重复提交不再调 AI）
            page.screenshot(path=str(out / 'quiz-synced.png'), full_page=True)
            check(page, '提交问卷一次同步四项并保存产品与封面短语；导航即时打勾（⑨ 等报告）')
            page.locator('#diagQuizNext').click()
            expect(page.locator('#diagQuizNext')).to_be_enabled()
            assert len(STATE['requests']) == 4
            check(page, '相同问卷重复提交不重复调用AI')
            # 问卷是唯一生成口：卖点/知识库各留一行同步状态文字，都不再挂「去 基础配置」跳转按钮；
            # 人设页的同步按钮与同步状态行整块撤（提交问卷就自动带出人设），规划页的同步说明段也已撤
            persona_tab(page)
            expect(page.locator('#diagStepBody')).not_to_contain_text('去 ① 基础配置')
            expect(page.locator('#diagStepBody .diag-sync-line')).to_have_count(0)
            for step in ('sell', 'kb'):
                page.locator(go(step)).click()
                expect(page.locator('#diagStepBody')).not_to_contain_text('去 ① 基础配置')
                expect(page.locator('#diagStepBody .diag-sync-line')).to_have_count(1)
            page.locator(go('plan')).click()
            expect(page.locator('#diagStepBody')).not_to_contain_text('去 ① 基础配置')
            expect(page.locator('#diagStepBody .diag-sync-line')).to_have_count(0)
            check(page, '卖点/知识库只留一行问卷同步状态、都没有「去基础配置」按钮；人设页同步行整块撤，规划的同步说明段已撤')
            persona_tab(page)
            expect(page.locator('#diagPEdit')).to_have_value('我是一名产品设计师，耐心分享真实体验与使用方法。')
            page.locator(go('base')).click()               # 产品名称/账号类型在「基础配置」维护，说话风格在「人设」页里
            expect(page.locator('#diagProdName')).to_have_value('体验工具')
            expect(page.locator('#diagAcctCustom')).to_have_value('教程/步骤型')   # AI 判断的类型回填到 ①
            page.locator(go('sell')).click()
            expect(page.locator('#diagSellList table')).to_be_visible()
            expect(page.locator('#diagSellList table')).to_be_visible()
            expect(page.locator('#diagSellList thead th')).to_have_text(['卖点标题', '内容摘要', '操作'])
            expect(page.locator('#diagSellList tbody.diag-sell-item')).to_have_count(1)
            expect(page.locator('#diagSellList tbody.diag-sell-item')).to_contain_text('先试再选')
            expect(page.locator('#diagSellDialog')).to_be_hidden()
            expect(page.locator('#diagSellTitle')).to_be_hidden()
            expect(page.locator('#diagSellContent')).to_be_hidden()
            assert len(STATE['requests']) == 4
            # 「从问卷同步」收在「新增卖点」弹窗里（页面不再单挂按钮）：选方式 → 开始同步 → 收弹窗回到表格
            assert page.locator('#diagSellSync').count() == 0
            page.locator('#diagSellAdd').click()
            expect(page.locator('#diagSellDialog')).to_be_visible()
            expect(page.locator('#diagSellMethods [data-sell-method]')).to_have_count(3)
            expect(page.locator('[data-sell-method="quiz"]')).to_contain_text('从问卷同步')
            page.locator('[data-sell-method="quiz"]').click()
            expect(page.locator('#diagSellDialogTitle')).to_have_text('从问卷同步')
            expect(page.locator('#diagSellQuizRun')).to_be_focused()
            page.screenshot(path=str(out / 'product-quiz-sync.png'), full_page=True)
            assert len(STATE['requests']) == 4
            page.locator('#diagSellQuizRun').click()
            expect(page.locator('#diagSellMsg')).to_contain_text('已按问卷同步', timeout=30000)
            expect(page.locator('#diagSellMsg')).to_contain_text('新增 0 条、更新 1 条')
            assert len(STATE['requests']) == 5, len(STATE['requests'])
            assert '产品卖点提炼师' in STATE['requests'][-1]['messages'][0]['content']
            expect(page.locator('#diagSellDialog')).to_be_hidden()
            expect(page.locator('#diagSellSyncLine')).to_contain_text('已从问卷重新提炼')
            expect(page.locator('#diagSellList tbody.diag-sell-item')).to_have_count(1)
            # 人设不再挂「🔄 从问卷同步」：提交问卷那一次就把人设带出来了，这一页只能查看与手改
            persona_tab(page)
            expect(page.locator('#diagPSync')).to_have_count(0)
            expect(page.locator('#diagPSyncLine')).to_have_count(0)
            expect(page.locator('#diagPersonaTabs .dg-tab')).to_have_text(['👤 人设', '🗣 说话风格'])
            expect(page.locator('#diagPersonaTabs .dg-tab.active')).to_have_text('👤 人设')
            expect(page.locator('#diagPEdit')).to_have_value('我是一名产品设计师，耐心分享真实体验与使用方法。')
            # 🧩 人设卡：结构化字段要露出来（规划和写稿按它约束），手改正文不能把它抹掉
            expect(page.locator('#diagPCard')).to_contain_text('人设卡')
            expect(page.locator('#diagPCard')).to_contain_text('做这行 5 年')
            page.locator('#diagPEdit').fill('我是一名产品设计师，耐心分享真实体验与使用方法。')
            page.locator('#diagPEditSave').click()
            expect(page.locator('#diagPEditMsg')).to_contain_text('已保存修改后的人设')
            assert worker.evaluate('async () => (await Storage.getConfig()).persona.card.proof') == '做这行 5 年', '手改正文不该抹掉人设卡'
            check(page, '🧩 人设卡：身份/凭据/立场/口头禅/雷区/称呼结构化落盘；手改正文保留卡')
            page.locator(go('sell')).click()
            assert len(STATE['requests']) == 5, '同步只重生成这一项，另三项资料不得回炉'
            page.locator(go('base')).click()      # 站到「基础配置」看完成圈：当前节点不画 .done，被断言的那三页都不是它
            for t in ('persona', 'sell', 'kb'):
                assert is_done(page, t), '%s 该打勾' % t
            check(page, '卖点「新增卖点」弹窗里的「从问卷同步」只重生成这一项并落盘打勾；人设不再有同步按钮，页内是 人设/说话风格 两个横 tab')
            page.locator(go('plan')).click()
            expect(page.locator('#diagPlanResult')).to_contain_text('小工具使用教程')
            check(page, '人设卖点规划无需再生成，直接显示已保存结果')
            # ⑨ 规划与深度评估合并成一个动作：点一次＝先出规划、再基于新规划出评估（两次 AI 调用）
            report_before = len(STATE['requests'])
            page.locator('#diagPlanBuild').click()
            expect(page.locator('#diagPlanMsg')).to_contain_text('已重新生成', timeout=30000)
            assert len(STATE['requests']) == report_before + 2, len(STATE['requests']) - report_before
            assert '内容规划师' in STATE['requests'][-2]['messages'][0]['content']
            assert '资深的小红书账号运营顾问' in STATE['requests'][-1]['messages'][0]['content']
            assert '小工具使用教程' in STATE['requests'][-1]['messages'][1]['content'], '报告要吃到刚生成的规划'
            expect(page.locator('#diagReportResult')).to_contain_text('定位清楚', timeout=15000)
            expect(page.locator('#diagReportResult')).to_contain_text('补齐简介钩子')
            stored_report = worker.evaluate('async () => (await chrome.storage.local.get("deep_report")).deep_report')
            assert stored_report['priorities'] == ['补齐简介钩子', '固定更新节奏'], stored_report
            page.locator(go('sell')).click()      # 让开当前节点：.done 只在非当前节点上画（下面本来就要去 ④）
            assert is_done(page, 'plan'), '报告落盘后 ⑨ 该打勾'
            page.locator(go('plan')).click()
            page.screenshot(path=str(out / 'plan-report.png'), full_page=True)
            page.locator(go('sell')).click()
            page.locator(go('plan')).click()
            expect(page.locator('#diagReportResult')).to_contain_text('补齐简介钩子')
            assert len(STATE['requests']) == report_before + 2
            check(page, '规划与评估一次生成、都落盘，重进直接回显不回炉，规划节点随报告打勾')
            # ⚖️ 配比条：按阶段给默认权重 → 就地折算篇数；± 调权重、保存后落 note_plan_mix、可恢复默认
            expect(page.locator('#diagPlanResult')).to_contain_text('内容排产表')
            expect(page.locator('#diagPlanResult')).to_contain_text('感悟 · 现场故事')
            expect(page.locator('#diagPlanResult')).not_to_contain_text('档位')
            expect(page.locator('#diagPlanResult')).to_contain_text('配比')
            expect(page.locator('#diagPlanResult button[data-mix]')).to_have_count(10)   # 五条线 × (＋/−)
            mix_before = worker.evaluate('async () => (await chrome.storage.local.get("note_plan_mix")).note_plan_mix || null')
            assert mix_before is None, '没调过时不该有 note_plan_mix'
            stage_key = worker.evaluate('async () => (await chrome.storage.local.get("note_plan")).note_plan.stage')
            hot_plus = page.locator('#diagPlanResult button[data-mix="hot"][data-d="5"]')
            before_text = hot_plus.evaluate('el => el.closest("div").innerText')
            hot_plus.click()
            after_text = hot_plus.evaluate('el => el.closest("div").innerText')
            assert before_text != after_text, '调权重后这一类的篇数/占比应该跟着变：%s' % before_text
            expect(page.locator('#diagPlanResult')).to_contain_text('有改动还没保存')
            page.locator('#diagMixSave').click()
            expect(page.locator('#diagMixMsg')).to_contain_text('已保存')
            mix_saved = worker.evaluate('async () => (await chrome.storage.local.get("note_plan_mix")).note_plan_mix')
            assert mix_saved and mix_saved.get(stage_key, {}).get('hot') == 15, mix_saved   # 五条线冷启动默认 hot 10，点一次 ＋5
            plan_after = worker.evaluate('async () => (await chrome.storage.local.get("note_plan")).note_plan')
            assert plan_after['mixWeights']['hot'] == 15 and plan_after['mix'], plan_after.get('mixWeights')
            expect(page.locator('#diagPlanResult')).not_to_contain_text('有改动还没保存')
            page.locator('#diagMixReset').click()
            expect(page.locator('#diagMixMsg')).to_contain_text('已恢复默认')
            mix_reset = worker.evaluate('async () => (await chrome.storage.local.get("note_plan_mix")).note_plan_mix')
            assert not mix_reset.get(stage_key), mix_reset
            check(page, '⚖️ 配比条：五条线权重可 ± 调、就地折算出下一批篇数，保存落 note_plan_mix（本批目标同步更新），可恢复默认')
            # 📅 栏目表：长期设定（一个栏目＝每周固定一天发那一类；具体发布＝每周照排一篇）
            expect(page.locator('#diagPlanResult')).to_contain_text('📅 栏目表')
            expect(page.locator('#diagPlanResult')).to_contain_text('长期设定，定完每周照发')
            assert worker.evaluate('async () => (await chrome.storage.local.get("note_columns")).note_columns || null') is None, '没配过时不该有 note_columns'
            assert page.locator('#diagPlanResult .diag-col-row').count() == 0, '没配过时不该有栏目行'
            page.locator('#diagColAdd').click()
            expect(page.locator('#diagPlanResult .diag-col-form')).to_be_visible()
            page.locator('.diag-col-f-name').fill('')
            page.locator('.diag-col-save').click()      # 名字空：当场拦下，不落盘
            expect(page.locator('#diagPlanResult .diag-col-msg')).to_contain_text('栏目名不能空')
            page.locator('.diag-col-f-name').fill('每周一拍')
            page.locator('.diag-col-f-day').select_option('4')
            page.locator('.diag-col-f-type').select_option('tale')
            assert page.locator('.diag-col-f-route').count() == 0, '调子已退市：栏目不再挑调子'
            page.locator('.diag-col-save').click()
            expect(page.locator('#diagColMsg')).to_contain_text('已加一栏')
            cols = worker.evaluate('async () => (await chrome.storage.local.get("note_columns")).note_columns')
            assert len(cols) == 1 and cols[0]['name'] == '每周一拍' and cols[0]['day'] == 4 \
                and cols[0]['type'] == 'tale' and cols[0]['id'], cols
            assert 'route' not in cols[0], '栏目落盘不再带 route：' + str(cols)
            row = page.locator('#diagPlanResult .diag-col-row')
            expect(row).to_have_count(1)
            expect(row).to_contain_text('📅 周四')
            expect(row).to_contain_text('每周一拍')
            expect(row).to_contain_text('感悟')
            expect(row).not_to_contain_text('调子')
            # 同一栏再来一天撞上：只提示不拦人（同一天两个栏目发出来会挤在一起）
            page.locator('#diagColAdd').click()
            page.locator('.diag-col-f-name').fill('老友测评')
            page.locator('.diag-col-f-day').select_option('4')
            page.locator('.diag-col-f-type').select_option('howto')
            page.locator('.diag-col-save').click()
            expect(page.locator('#diagPlanResult')).to_contain_text('都排在周四')
            # 编辑：改掉撞车的日子 → 提示消失，名字/类型都换了
            page.locator('#diagPlanResult .diag-col-row').nth(1).locator('.diag-col-edit').click()
            assert page.locator('.diag-col-f-name').input_value() == '老友测评', '编辑要带出这一栏原来的值'
            page.locator('.diag-col-f-day').select_option('1')
            page.locator('.diag-col-save').click()
            expect(page.locator('#diagColMsg')).to_contain_text('已保存这一栏')
            expect(page.locator('#diagPlanResult')).not_to_contain_text('都排在周四')
            assert page.locator('#diagPlanResult .diag-col-row').count() == 2
            # 长期设定与这批排产表脱钩：改完要重新生成才会排进表里（当场给提示）
            expect(page.locator('#diagPlanResult')).to_contain_text('才会按新栏目重排这张排产表')
            # 删掉第二栏 → 回到一栏（按名字点，别按下标：改成周一后它会排到「每周一拍」前面去）
            page.locator('#diagPlanResult .diag-col-row', has_text='老友测评').locator('.diag-col-del').click()
            expect(page.locator('#diagColMsg')).to_contain_text('已删掉这一栏')
            expect(page.locator('#diagPlanResult .diag-col-row')).to_have_count(1)
            assert len(worker.evaluate('async () => (await chrome.storage.local.get("note_columns")).note_columns')) == 1
            check(page, '📅 栏目表：增/改/删当场落盘（名字空拦下；同一天撞车只提示不拦人），并提示要重新生成才排进表')
            # 重新生成：栏目进提示词，每个栏目每周正好排 1 篇（AI 没排到也由后台补上）
            col_before = len(STATE['requests'])
            page.locator('#diagPlanBuild').click()
            expect(page.locator('#diagPlanMsg')).to_contain_text('已重新生成', timeout=30000)
            assert len(STATE['requests']) == col_before + 2, len(STATE['requests']) - col_before
            plan_sys = STATE['requests'][-2]['messages'][0]['content']
            plan_user = STATE['requests'][-2]['messages'][1]['content']
            assert '【栏目表（长期设定，用户定死的，一个栏目每周正好一篇）】' in plan_user, plan_user[:500]
            assert '· 周四｜感悟｜栏目名「每周一拍」' in plan_user, plan_user[:500]
            assert '每个栏目这一轮排 1 篇' in plan_sys, plan_sys[-800:]
            assert '"col"' in plan_sys and '"day"' in plan_sys, '排产的 JSON 结构里要有 col/day'
            plan_col = worker.evaluate('async () => (await chrome.storage.local.get("note_plan")).note_plan')
            assert plan_col['weekText'] == '周四 每周一拍（感悟）', plan_col.get('weekText')
            placed = [it for it in plan_col['items'] if it.get('col')]
            assert len(placed) == 1 and placed[0]['col'] == '每周一拍' and placed[0]['day'] == 4 \
                and placed[0]['type'] == 'tale' and placed[0]['colId'] == cols[0]['id'], placed
            assert plan_col['columns'][0]['name'] == '每周一拍' and plan_col['colProblems'] == [], plan_col.get('colProblems')
            assert [it['no'] for it in plan_col['items']] == list(range(1, len(plan_col['items']) + 1)), '栏目篇排完要重编号'
            expect(page.locator('#diagPlanResult')).to_contain_text('每个栏目每周排 1 篇')
            check(page, '📅 栏目进排产：栏目表进提示词（长期设定），后台保证每个栏目每周排 1 篇并带上 col/day/colId，weekText 与重编号都对')
            # 收尾：把栏目删干净——这一页后面的用例按"没配栏目"的排产表跑
            page.locator('#diagPlanResult .diag-col-row').first.locator('.diag-col-del').click()
            expect(page.locator('#diagPlanResult .diag-col-row')).to_have_count(0)
            assert worker.evaluate('async () => (await chrome.storage.local.get("note_columns")).note_columns') == [], '删完要落盘成空表'
            # 内容基调（五十二改搬进「发笔记 → 任务配置」；二十八改 ?v=47 后这里只剩两签——
            # 🧬 笔记规划整块搬去「发布台」页内签）：
            # 页内两个横 tab＝📄 内容基调（4 基调卡：铺垫/广告拖条＋字数）/
            # 🎨 出图风格（画面风格＋印记＋笔记分类＋配文版式 15 种，面板改了按 💾 才落盘）
            page.locator('#tabNotePublish').click()   # 先看二级排序与默认落点（进了任务配置 active 就换人了）
            order = [t.strip() for t in page.locator('#noteTabs .sub-tab .rail-tx').all_inner_texts()]
            assert order == ['任务配置', '笔记档案', '发布台', '素材库', '复盘'], '发笔记二级＝任务配置排第一、发布台紧跟档案、出片台已不是二级项：' + str(order)
            assert 'active' in (page.locator('#tabNoteArchive').get_attribute('class') or ''), '排第一 ≠ 默认落点——打开这一块仍落「笔记档案」'
            note_tone(page)
            expect(page.locator('#noteTaskCfgContent .page-hd .ph-t')).to_contain_text('任务配置')
            assert [t.strip() for t in page.locator('#ntCfgTabs .nt-tab').all_inner_texts()] == \
                ['📄 内容基调', '🎨 出图风格'], '两签的排法与名字（🧬 笔记规划已搬去「发布台」）'
            expect(page.locator('#ntCfgBadge')).to_have_text('已保存')
            check(page, '发笔记 → 任务配置＝两签（📄 内容基调 / 🎨 出图风格）；🧬 笔记规划不再在这——整块搬去了「发布台」页内签')
            # 🧬 签在「发笔记 → 发布台」：一段「怎么用发笔记」＋🗓 每周排法（一天可勾多种、空＝休）＋📌 阶段计划＋🧠 AI规划；真源＝config.product.weekPlan
            note_plan(page)
            expect(page.locator('#diagPersonaBox')).to_contain_text('怎么用发笔记')
            expect(page.locator('#diagPersonaBox')).to_contain_text('前期先攒干货')
            expect(page.locator('#diagPersonaBox')).to_contain_text('🗓 每周排法')
            expect(page.locator('#diagPersonaBox')).to_contain_text('一天可以同时勾几种；都不勾＝那天休')
            assert page.locator('#diagPersonaBox .ntShapeDrag').count() == 0, '一次只画选中的那一签：🧬 上不该摆出 📄 的拖条'
            assert page.locator('#diagPersonaBox .ntWeekChip').count() == 21, '一周七天 × 三类（知识/引流/案例）都摆出来'
            assert page.locator('#diagPersonaBox .ntWeekChip.on').count() == 0, '还没排过＝一颗都没勾'
            expect(page.locator('#diagPersonaBox')).to_contain_text('休 7 天')   # 都没勾＝七天全休（demo 同款）
            assert worker.evaluate('async () => ((await Storage.getConfig()).product || {}).weekPlan') is None, '还没排过：盘上不该有半截周排'
            # 勾一天里的一类（同一格可勾多种；再点一下＝取消）：落 config.product.weekPlan
            page.locator('#diagPersonaBox .ntWeekChip[data-day="mon"][data-k="知识"]').click()
            expect(page.locator('#diagPersonaBox')).to_contain_text('📚 知识 1 天')
            page.locator('#diagPersonaBox .ntWeekChip[data-day="wed"][data-k="知识"]').click()
            page.locator('#diagPersonaBox .ntWeekChip[data-day="fri"][data-k="引流"]').click()
            expect(page.locator('#diagPersonaBox')).to_contain_text('📚 知识 2 天 · 🔥 引流 1 天 · 休 4 天')
            assert page.locator('#diagPersonaBox .ntWeekChip.on').count() == 3, '勾上的三颗点亮'
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const wp = (c.product || {}).weekPlan || {}; return (wp.mon || []).indexOf('知识') >= 0 && (wp.wed || []).indexOf('知识') >= 0 && (wp.fri || []).indexOf('引流') >= 0; })"), '周排要即时落 config.product.weekPlan'
            got_wp = worker.evaluate('async () => ((await Storage.getConfig()).product || {}).weekPlan')
            assert got_wp == {'mon': ['知识'], 'tue': [], 'wed': ['知识'], 'thu': [], 'fri': ['引流'], 'sat': [], 'sun': []}, got_wp
            page.locator('#diagPersonaBox .ntWeekChip[data-day="mon"][data-k="知识"]').click()
            expect(page.locator('#diagPersonaBox')).to_contain_text('📚 知识 1 天 · 🔥 引流 1 天 · 休 5 天')
            check(page, '🧬 笔记规划（发布台页内签）·每周排法：一天可勾多种、再点＝取消；勾完即时落 config.product.weekPlan')
            # 📌 阶段计划小编辑块（六十六改 #29）：当前阶段那档的发频三拨（主发/常发/少发）＋ 多发方面两份输入；
            #   改完即时落 config.product.stagePlan——K 线「挑知识」顶上那行读的就是知识这条
            assert page.locator('#diagPersonaBox .spRate').count() == 9, '阶段计划＝三条线各一拨三档'
            assert page.locator('#diagPersonaBox .spCats').count() == 2, '多发知识/多发引流两份输入'
            expect(page.locator('#diagPersonaBox')).to_contain_text('📌 阶段计划')
            expect(page.locator('#diagPersonaBox')).to_contain_text('当前「冷启动期」')
            expect(page.locator('#diagPersonaBox')).to_contain_text('发笔记「挑知识」顶上那行读的就是知识这条')
            # 冷启动默认：知识 常发 / 引流 主发 / 案例 少发；两份清单也是默认那对
            assert page.locator('#diagPersonaBox .spRate[data-line="k"][data-v="常发"].on').count() == 1
            assert page.locator('#diagPersonaBox .spRate[data-line="d"][data-v="主发"].on').count() == 1
            assert page.locator('#diagPersonaBox .spRate[data-line="c"][data-v="少发"].on').count() == 1
            assert page.locator('#diagPersonaBox .spCats[data-field="kbCats"]').input_value() == '免费测漏、材料保真'
            assert page.locator('#diagPersonaBox .spCats[data-field="drainCats"]').input_value() == '🔥 热点、😹 热梗'
            # 拨知识这条到「主发」：即时落 config.product.stagePlan.cold.k
            page.locator('#diagPersonaBox .spRate[data-line="k"][data-v="主发"]').click()
            assert page.locator('#diagPersonaBox .spRate[data-line="k"][data-v="主发"].on').count() == 1
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const d = ((c.product || {}).stagePlan || {}).cold || {}; return d.k === '主发'; })"), '发频要即时落 config.product.stagePlan'
            # 多发知识清单：顿号分隔拆数组落库，回读重画后分隔符统一成「、」
            page.locator('#diagPersonaBox .spCats[data-field="kbCats"]').evaluate(
                "el => { el.value = '免费测漏、材料保真、质保十年'; el.dispatchEvent(new Event('change', { bubbles: true })); }")
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const d = ((c.product || {}).stagePlan || {}).cold || {}; const k = d.kbCats || []; return k.length === 3 && k[2] === '质保十年'; })"), '多发知识清单要落库'
            assert page.locator('#diagPersonaBox .spCats[data-field="kbCats"]').input_value() == '免费测漏、材料保真、质保十年'
            check(page, '📌 阶段计划（发布台页内签）：当前阶段那档三条线的发频（主发/常发/少发）＋两份多发清单，改完即时落 config.product.stagePlan（冷启动默认＝知识常发/引流主发/案例少发）')
            # 还原成默认口径（后面 K 线 ① 那行按默认读）
            page.locator('#diagPersonaBox .spRate[data-line="k"][data-v="常发"]').click()
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const d = ((c.product || {}).stagePlan || {}).cold || {}; return d.k === '常发'; })")
            page.locator('#diagPersonaBox .spCats[data-field="kbCats"]').evaluate(
                "el => { el.value = '免费测漏、材料保真'; el.dispatchEvent(new Event('change', { bubbles: true })); }")
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const d = ((c.product || {}).stagePlan || {}).cold || {}; const k = d.kbCats || []; return k.length === 2 && k[0] === '免费测漏' && k[1] === '材料保真'; })")
            # 🧠 AI规划：按账号资料与阶段把一周七天各排哪几类（后台 aiWeekPlan，system 是「排班师」那一发）
            wk_ai = len(STATE['requests'])
            page.locator('#diagStyleRun').click()
            expect(page.locator('#diagPersonaBox')).to_contain_text('📚 知识 3 天 · 🔥 引流 1 天 · 休 3 天', timeout=30000)
            assert len(STATE['requests']) == wk_ai + 1, 'AI规划只发一发'
            wk_sys = STATE['requests'][-1]['messages'][0]['content']
            wk_user = STATE['requests'][-1]['messages'][1]['content']
            assert '你是小红书账号的排班师' in wk_sys and '七天的键固定是 mon / tue / wed / thu / fri / sat / sun' in wk_sys, wk_sys[:300]
            assert '【账号阶段】' in wk_user and '【一句话人设】我是做体验工具的设计师' in wk_user, wk_user[:400]
            assert page.locator('#diagPersonaBox .ntWeekChip.on').count() == 4, 'AI 排上的格子点亮：周一/周三/周六＝知识、周五＝引流'
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const wp = (c.product || {}).weekPlan || {}; return (wp.sat || []).indexOf('知识') >= 0 && (wp.mon || []).indexOf('知识') >= 0 && (wp.tue || []).length === 0; })"), 'AI 排完要落到周排里'
            page.screenshot(path=str(out / 'plan-week-plan.png'), full_page=True)
            check(page, '🧬 🧠 AI规划（发布台页内签）：一发『排班师』把一周七天排好（只认知识/引流/案例），落周排后格子点亮；提示词带阶段与一句话人设')
            # 📄 内容基调（两签第一张，设计源＝demo _diagLinesHtml）：一条基调一张卡——主行一根条拨「铺垫/广告」，
            #   卡里 🖋 三档字数；写法折角点开只拨各自字数；广告占比跟账号阶段走（不烧 AI）
            note_tone(page, 'lines')
            expect(page.locator('#diagStyleResult')).to_contain_text('📄 内容基调 · 热点 / 热梗 / 情绪 / 感悟')
            assert page.locator('#diagStyleResult .qhelp[data-tip*="全系统内容基调就 4 种"]').count() == 1, '口径收在问号气泡里'
            assert page.locator('#diagStyleResult .ntToneFold').count() == 5, '五张卡（热点/热梗/情绪/感悟 + 知识·干货）各带一个「N 种写法」折角'
            assert page.locator('#diagStyleResult .ntShapeDrag').count() == 5, '主行各一根条＝铺垫/广告'
            assert page.locator('#diagStyleResult .ntShapeWords').count() == 15, '写法折角都收着：只剩五张卡各三档字数'
            assert page.locator('#diagStyleResult .ntWeekChip').count() == 0, '一次只画选中的那一签'
            for chip in ('🔥 热点', '😹 热梗', '💢 情绪', '🧭 感悟', '🧰 知识·干货'):
                expect(page.locator('#diagStyleResult')).to_contain_text(chip)
            expect(page.locator('#diagStyleResult')).to_contain_text('引流取料：🔥 热点')
            expect(page.locator('#diagStyleResult')).to_contain_text('引流取料：😹 热梗')
            expect(page.locator('#diagStyleResult')).to_contain_text('不占基调')
            # 本阶段篇数＝冷启动配比 4/3/2/2/1（知识·干货 4 / 感悟 3 / 情绪 2 / 热梗 2 / 热点 1）
            expect(page.locator('#diagStyleResult')).to_contain_text('本阶段 4 篇')
            expect(page.locator('#diagStyleResult')).to_contain_text('本阶段 3 篇')
            assert page.locator('#diagStyleResult .ntNum', has_text='本阶段 2 篇').count() == 2
            expect(page.locator('#diagStyleResult')).to_contain_text('本阶段 1 篇')
            # 冷启动话术「轻带一句」：每张卡初值＝铺垫 90% / 广告 10%；字数档按线（中/短）点亮
            assert page.locator('#diagStyleResult [id="shb_t:howto"]').inner_text() == '90%'
            assert page.locator('#diagStyleResult [id="shs_t:howto"]').inner_text() == '10%'
            assert page.locator('#diagStyleResult .ntShapeReset').count() == 0, '没改过就不该有 ↺'
            assert page.locator('#diagStyleResult .ntShapeWords[data-target="t:howto"][data-w="mid"].on').count() == 1
            assert page.locator('#diagStyleResult .ntShapeWords[data-target="t:echo"][data-w="short"].on').count() == 1
            expect(page.locator('#diagStyleResult')).to_contain_text('500-800 字')
            expect(page.locator('#diagStyleResult')).to_contain_text('300-500 字')
            expect(page.locator('#diagStyleResult')).to_contain_text('🎚 广告占比跟账号阶段走')
            expect(page.locator('#diagStyleResult')).to_contain_text('这篇现在按「冷启动期」走「轻带一句」')
            assert '调子' not in page.locator('#diagStyleResult').inner_text(), '📄 这一节通篇不该再出现「调子」'
            check(page, '📄 内容基调＝一条基调一张卡（五张：热点/热梗/情绪/感悟 + 知识·干货不占基调）：本阶段篇数读冷启动配比、主行初值＝阶段话术「轻带一句」90/10、各卡自带 🖋 字数档')
            # ✏️ 拖主行那根条：铺垫/广告两段联动（拖到 40 → 广告 60），松手才落 config.noteStyle.lines
            page.locator('#diagStyleResult .ntShapeDrag[data-target="t:howto"]').evaluate(
                "el => { el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }")
            assert page.locator('#diagStyleResult [id="shb_t:howto"]').inner_text() == '40%'
            assert page.locator('#diagStyleResult [id="shs_t:howto"]').inner_text() == '60%'
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const l = ((c.noteStyle || {}).lines || {}).howto; return !!l && l.shape && l.shape.build === 40 && l.shape.sell === 60; })"), '拖完要落到 config.noteStyle.lines.howto'
            got_line = worker.evaluate('async () => (await Storage.getConfig()).noteStyle')
            assert got_line['lines']['howto'] == {'shape': {'build': 40, 'sell': 60}, 'words': 'mid'}, got_line
            assert page.locator('#diagStyleResult .ntShapeReset').count() == 1, '这条线自己定过 → 主行出现 ↺'
            check(page, '✏️ 主行拖条＝铺垫/广告两段联动（拖 40 → 广告 60），松手落 config.noteStyle.lines＝这条线的账号默认')
            # ↺ 恢复默认＝这条线的覆盖整条删掉（回到跟阶段那套走），不是存个 0
            page.locator('#diagStyleResult .ntShapeReset').click()
            assert wait_store(page, worker, "Storage.getConfig().then(c => !(((c.noteStyle || {}).lines || {}).howto))"), '↺ 要把这条线的覆盖整条删掉'
            back_ns = worker.evaluate('async () => (await Storage.getConfig()).noteStyle')
            assert 'howto' not in (back_ns.get('lines') or {}), back_ns
            assert page.locator('#diagStyleResult [id="shb_t:howto"]').inner_text() == '90%', '回到阶段话术的 90/10'
            assert page.locator('#diagStyleResult .ntShapeReset').count() == 0
            # 写法折角：点开「热梗」→ 四种写法各一行，行里只拨各自字数（配比跟所在那条线走）
            page.locator('#diagStyleResult .ntToneFold[data-t="meme"]').click()
            expect(page.locator('#diagStyleResult .ntToneFold[data-t="meme"]')).to_contain_text('▾ 4 种写法')
            assert page.locator('#diagStyleResult .ntShapeWords[data-target="k:docform"]').count() == 3, '折角里这一种写法带三档字数'
            assert page.locator('#diagStyleResult .ntShapeWords[data-target="k:docform"][data-w="short"].on').count() == 1, '没设过＝跟所在那条线（热梗线短档）'
            page.locator('#diagStyleResult .ntShapeWords[data-target="k:docform"][data-w="long"]').click()
            assert wait_store(page, worker, "Storage.getConfig().then(c => ((((c.noteStyle || {}).kinds || {}).docform || {}).words) === 'long')"), '这一种写法的字数要落 config.noteStyle.kinds'
            got_kind = worker.evaluate('async () => (await Storage.getConfig()).noteStyle')
            assert got_kind['kinds']['docform'] == {'words': 'long'}, got_kind
            assert 'howto' not in (got_kind.get('lines') or {}), '改一种写法不该动那条线'
            assert page.locator('#diagStyleResult .ntShapeWords[data-target="k:docform"][data-w="long"].on').count() == 1
            page.locator('#diagStyleResult .ntShapeWords[data-target="k:docform"][data-w="short"]').click()   # 拨回热梗线的短档＝还原
            assert wait_store(page, worker, "Storage.getConfig().then(c => ((((c.noteStyle || {}).kinds || {}).docform || {}).words) === 'short')")
            page.locator('#diagStyleResult .ntToneFold[data-t="meme"]').click()   # 折角收回去
            assert page.locator('#diagStyleResult .ntShapeWords').count() == 15
            check(page, '✏️ 写法折角：点开一条基调看它底下几种写法，行里只拨各自 🖋 字数（没设过吃所在那条线），落 config.noteStyle.kinds')
            # 整张表可折起来（默认展开）：收起只剩头，展开回来还在
            page.locator('#diagLinesToggle').click()
            assert page.locator('#diagStyleResult .ntToneFold').count() == 0, '点「收起」五张卡全折回去'
            expect(page.locator('#diagStyleResult')).to_contain_text('📄 内容基调 · 热点 / 热梗 / 情绪 / 感悟')
            page.locator('#diagLinesToggle').click()
            expect(page.locator('#diagStyleResult')).to_contain_text('本阶段 4 篇')
            page.screenshot(path=str(out / 'plan-tone-cards.png'), full_page=True)
            # 🎨 出图风格 · 账号默认（两签第二张，设计源＝demo _diagLookDefaultHtml）：画面风格＋印记＋笔记分类＋配文版式；
            #   面板上改的先进内存（徽标转「有没保存的改动」），按「💾 保存出图风格」才落 config.imgLook
            note_tone(page, 'look')
            expect(page.locator('#diagStyleResult')).to_contain_text('🎨 出图风格 · 账号默认')
            expect(page.locator('#diagStyleResult')).to_contain_text('打底＝统一小红书那一挂（真人工作场景）')
            assert page.locator('#diagStyleResult .ntMotifChip').count() == 3, '画面风格＝内置三颗小样'
            expect(page.locator('#diagStyleResult .ntMotifChip[data-k="真人工作场景"]')).to_contain_text('✓ 在用')
            expect(page.locator('#diagStyleResult')).to_contain_text('引流笔记不限风格')
            assert page.locator('#diagStyleResult .ntMarkPick').count() == 2 and page.locator('#diagStyleResult .ntMarkUp').count() == 1, '印记三选：不印记 / 文字印记 / 传图'
            assert page.locator('#diagStyleResult .ntClassifyPick').count() == 2, '🗂 笔记分类＝关 / 开两颗'
            assert page.locator('#diagStyleResult .ntLayoutTile').count() == 15, '配文版式 15 种'
            assert page.locator('#diagStyleResult [id="lpMarkHost"]').count() == 1, '一张 172×230 预览，印记层挂在它里面'
            expect(page.locator('#diagStyleResult')).to_contain_text('预览 · 大字说一句')
            expect(page.locator('#diagStyleResult')).to_contain_text('版式定了配文引擎（说一次）')
            assert page.locator('#diagStyleResult .ntShapeDrag').count() == 0, '一次只画选中的那一签'
            check(page, '🎨 出图风格·账号默认＝画面风格三颗小样（在用那颗标 ✓、引流笔记不限风格）、印记三选、笔记分类开关、版式 15 种 + 一张预览')
            # 面板上点一下＝进内存（徽标「有没保存的改动」），没按 💾 之前盘上不该动
            page.locator('#diagStyleResult .ntMotifChip[data-k="方案页"]').click()
            expect(page.locator('#diagStyleResult .ntMotifChip[data-k="方案页"]')).to_contain_text('✓ 在用')
            expect(page.locator('#ntCfgBadge')).to_have_text('有没保存的改动')
            assert worker.evaluate('async () => String(((await Storage.getConfig()).imgLook || {}).motif || "")') == '', '没按 💾 之前不许落盘'
            # ＋ 自己加一种：空名与重名当场拦下；存下来只落 config.imgMotifs（名字 ≤16，配方在造图片那页补）
            page.locator('#diagStyleResult .ntMotifAdd').first.click()
            expect(page.locator('#diagStyleResult .ntMotifSave')).to_be_visible()
            page.locator('#diagStyleResult .ntMotifSave').click()
            expect(page.locator('#diagStyleResult')).to_contain_text('先给它起个名字')
            page.locator('#diagStyleResult #ntMotifK').fill('方案页')
            page.locator('#diagStyleResult .ntMotifSave').click()
            expect(page.locator('#diagStyleResult')).to_contain_text('这一种内置里已经有了，换个名字')
            page.locator('#diagStyleResult #ntMotifK').fill('门店实拍＋大字')
            page.locator('#diagStyleResult .ntMotifSave').click()
            assert wait_store(page, worker, "Storage.getConfig().then(c => (c.imgMotifs || []).some(m => m.k === '门店实拍＋大字'))"), '自加的画面风格当场落 config.imgMotifs'
            expect(page.locator('#diagStyleResult .ntMotifChip[data-k="门店实拍＋大字"]')).to_contain_text('✓ 在用')
            assert page.locator('#diagStyleResult .ntMotifChip').count() == 4
            # 印记＝文字：行内输入当场刷预览的印记层（只刷 #lpMarkHost，不整页重画）
            page.locator('#diagStyleResult .ntMarkPick[data-mode="text"]').click()
            expect(page.locator('#diagStyleResult .ntMarkText')).to_be_visible()
            page.locator('#diagStyleResult .ntMarkText').fill('张师傅 · 防水 10 年')
            expect(page.locator('#diagStyleResult [id="lpMarkHost"]')).to_contain_text('张师傅 · 防水 10 年')
            # 🗂 笔记分类＝开：预览上自动盖「知识」小标（跟印记互不占位）
            page.locator('#diagStyleResult .ntClassifyPick[data-v="1"]').click()
            expect(page.locator('#diagStyleResult [id="lpMarkHost"]')).to_contain_text('知识')
            assert 'on' in (page.locator('#diagStyleResult .ntClassifyPick[data-v="1"]').get_attribute('class') or '')
            # 配文版式挑「步骤清单」：预览与底注跟着换（配文引擎＝整段上屏）
            page.locator('#diagStyleResult .ntLayoutTile[data-k="steps"]').click()
            expect(page.locator('#diagStyleResult')).to_contain_text('预览 · 步骤清单')
            expect(page.locator('#diagStyleResult')).to_contain_text('版式定了配文引擎（整段上屏）')
            # 💾 一次落齐：画面风格 / 印记文字 / 笔记分类 / 版式 → config.imgLook，徽标回「已保存」
            page.locator('#diagStyleResult .ntLookSave').click()
            expect(page.locator('#diagStyleResult #ntLookMsg')).to_contain_text('已保存')
            expect(page.locator('#ntCfgBadge')).to_have_text('已保存')
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const l = c.imgLook || {}; return l.motif === '门店实拍＋大字' && l.layout === 'steps' && l.cap === 'whole' && l.mark === 'text' && l.markText === '张师傅 · 防水 10 年' && l.classify === true; })"), '💾 一次落齐 config.imgLook'
            # 切走再回：四样都从盘上读回
            note_tone(page, 'lines')
            note_tone(page, 'look')
            expect(page.locator('#diagStyleResult .ntMotifChip[data-k="门店实拍＋大字"]')).to_contain_text('✓ 在用')
            assert page.locator('#diagStyleResult .ntMarkText').input_value() == '张师傅 · 防水 10 年'
            expect(page.locator('#diagStyleResult [id="lpMarkHost"]')).to_contain_text('知识')
            expect(page.locator('#diagStyleResult')).to_contain_text('预览 · 步骤清单')
            expect(page.locator('#ntCfgBadge')).to_have_text('已保存')
            page.screenshot(path=str(out / 'plan-look-style.png'), full_page=True)
            check(page, '🎨 面板改动＝先进内存（徽标转「有没保存的改动」）、💾 才落 config.imgLook；自加画面风格落 config.imgMotifs（空名/重名拦下）；文字印记、笔记分类、版式都当场刷预览；切走再回原样读回')
            # ↺ 改回统一小红书：整块重置进内存（同样要 💾 才落盘）
            page.locator('#diagStyleResult .ntLookClear').click()
            expect(page.locator('#diagStyleResult .ntMotifChip[data-k="真人工作场景"]')).to_contain_text('✓ 在用')
            expect(page.locator('#ntCfgBadge')).to_have_text('有没保存的改动')
            assert worker.evaluate('async () => String(((await Storage.getConfig()).imgLook || {}).motif || "")') == '门店实拍＋大字', '↺ 也不许自动落盘'
            page.locator('#diagStyleResult .ntLookSave').click()
            expect(page.locator('#diagStyleResult #ntLookMsg')).to_contain_text('已保存')
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const l = c.imgLook || {}; return l.motif === '真人工作场景' && l.layout === 'big' && l.mark === 'none' && !l.classify && !l.markText; })"), '改回后 💾 落默认那一挂'
            check(page, '🎨 ↺ 改回统一小红书＝面板整块重置（同样要 💾 才落盘），落回默认那一挂')
            # 收口回显：🧬 的周排（＝AI 排好的那一周）与 📄 的本阶段篇数都还在；这一段除 AI规划外零 AI 调用
            note_plan(page)
            expect(page.locator('#diagPersonaBox')).to_contain_text('📚 知识 3 天 · 🔥 引流 1 天 · 休 3 天')
            assert page.locator('#diagPersonaBox .ntWeekChip.on').count() == 4
            note_tone(page, 'lines')
            expect(page.locator('#diagStyleResult')).to_contain_text('本阶段 4 篇')
            assert page.locator('#diagStyleResult .ntShapeReset').count() == 0, '两处覆盖都 ↺ 回去了'
            assert len(STATE['requests']) == wk_ai + 1, '这一段除 AI规划外不该再烧 AI'
            check(page, '📄/🎨（任务配置）＋🧬（发布台）切走再回都用盘上那份回显（周排＝AI 排好的那一周、基调＝本阶段篇数）；整段除 AI规划外零 AI 调用')
            kb_ai = len(STATE['requests'])   # 知识库维护全程不调用AI，用当前次数做基线
            page.locator('#tabDiagnose').click()
            page.locator(go('kb')).click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            expect(page.locator('#diagKList')).to_contain_text('先体验再决定')
            page.screenshot(path=str(out / 'knowledge-list.png'), full_page=True)
            page.locator('#diagKAddBtn').click()
            page.screenshot(path=str(out / 'knowledge-add-methods.png'), full_page=True)
            # ⑤ 里没有问卷入口；问卷答案在 ② 提交问卷时就已自动整理入库（上面的同步用例已覆盖）。
            expect(page.locator('[data-kb-method]:visible')).to_have_count(2)
            expect(page.locator('#diagKQuiz')).to_have_count(0)
            assert len(STATE['requests']) == kb_ai
            check(page, '已有问卷的知识库页只有两种新增方式，没有问卷入口')
            page.locator('#diagKAddCancel').click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="text"]').click()
            expect(page.locator('#diagKImp')).to_be_focused()
            expect(page.locator('#diagKFileImport')).to_be_hidden()
            page.locator('#diagKImport').click()
            expect(page.locator('#diagKIMsg')).to_contain_text('先')
            draft = '散乱素材：我想把随口说的经验和聊天记录直接交给系统，不想自己写标题和标签。'
            page.locator('#diagKImp').fill(draft)
            # 没有「重新选择方式」的退路：换方式＝关闭再开，开着的表单不收（草稿跟着 _diagState.kbDraft 留着）
            page.locator('#diagKAddCancel').click()
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="file"]').click()
            expect(page.locator('#diagKFileImport')).to_be_visible()
            page.locator('#diagKAddCancel').click()
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="text"]').click()
            expect(page.locator('#diagKImp')).to_have_value(draft)
            assert len(STATE['requests']) == kb_ai
            TEXT_RELEASE.clear()
            try:
                page.locator('#diagKImport').click()
                # 新增面板刚展开时首点可能落空（动画没停，点到了面板上），落空的话补点一次再断言
                page.wait_for_timeout(400)
                if page.locator('#diagKImport').is_enabled():
                    page.locator('#diagKImport').click()
                expect(page.locator('#diagKImport')).to_be_disabled()
                expect(page.locator('#diagKAddCancel')).to_be_disabled()
                page.keyboard.press('Escape')
                expect(page.locator('#diagKAddPanel:modal')).to_have_count(1)
                page.mouse.click(5, 5)
                expect(page.locator('#diagKAddPanel:modal')).to_have_count(1)
            finally:
                TEXT_RELEASE.set()
            expect(page.locator('#diagKImport')).to_be_enabled(timeout=15000)
            expect(page.locator('#diagKList')).to_contain_text('不必先学格式')
            page.locator('#diagKAddCancel').click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            check(page, '切换方式不丢草稿；取消后再开草稿还在；文本入库刷新列表')
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="file"]').click()
            payload = [{'title': '文件导入知识', 'content': '完整内容' * 70, 'category': '避坑经验', 'tags': ['文件标签'], 'isActive': False}]
            page.locator('#diagKFile').set_input_files({'name': 'knowledge.json', 'mimeType': 'application/json', 'buffer': json.dumps(payload, ensure_ascii=False).encode()})
            expect(page.locator('#diagKFileName')).to_contain_text('已选择 1 个文件')
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('新增 1', timeout=10000)
            entries = send(page, 'getKnowledgeBase')['entries']
            imported = next(e for e in entries if e['title'] == '文件导入知识')
            assert imported['isActive'] is False and imported['tags'] == ['文件标签']
            expect(page.locator('#diagKFileName')).to_contain_text('尚未选择文件')
            # 同一份文件重选再导一次：内容没变就跳过，不重复写。
            page.locator('#diagKFile').set_input_files({'name': 'knowledge.json', 'mimeType': 'application/json', 'buffer': json.dumps(payload, ensure_ascii=False).encode()})
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('跳过 1')
            assert len(send(page, 'getKnowledgeBase')['entries']) == len(entries)
            # 一批里混入坏文件：好文件照常入库，坏文件逐个点名且不阻断整批。
            # Word / Excel 用真 .docx / .xlsx（zipfile 现造）：本机解包抽文字后才交给 AI。
            page.locator('#diagKFile').set_input_files([
                {'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{not valid'},
                {'name': 'empty.txt', 'mimeType': 'text/plain', 'buffer': b''},
                {'name': 'notes.md', 'mimeType': 'text/markdown', 'buffer': '文件经验：总结我在实际操作中学到的方法。'.encode()},
                {'name': '老文档.doc', 'mimeType': 'application/msword', 'buffer': b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy'},
                {'name': 'broken.docx', 'mimeType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'buffer': b'PK\x03\x04\x00\x00binary'},
                {'name': '产品手册.docx', 'mimeType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'buffer': docx_bytes(['Word 说明书：先在设置页填好账号资料。', '第二步是发笔记，向导一路点到造图片。'],
                                      table=[['问题', '做法'], ['不会写标题', '用向导生成']])},
                {'name': '价格表.xlsx', 'mimeType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 'buffer': xlsx_bytes([['Excel 价格', '备注'], ['基础版', '每月 239']], [['第二张表', '也一起读']])},
            ])
            expect(page.locator('#diagKFileName')).to_contain_text('已选择 7 个文件')
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('成功 3 个', timeout=20000)
            expect(page.locator('#diagKFMsg')).to_contain_text('失败 4 个')
            expect(page.locator('#diagKFMsg')).to_contain_text('bad.json：JSON 文件格式错误')
            expect(page.locator('#diagKFMsg')).to_contain_text('empty.txt：文件为空')
            expect(page.locator('#diagKFMsg')).to_contain_text('老文档.doc：旧版 Office 格式读不了')
            expect(page.locator('#diagKFMsg')).to_contain_text('broken.docx：文件已损坏')
            assert len(send(page, 'getKnowledgeBase')['entries']) == len(entries) + 3
            # 解包抽出的是正文文字（含 Word 表格、Excel 两张表），不是二进制垃圾。
            word_call = next(r['messages'][1]['content'] for r in STATE['requests'] if 'Word 说明书' in r['messages'][1]['content'])
            assert '先在设置页填好账号资料' in word_call and '不会写标题\t用向导生成' in word_call, word_call
            excel_call = next(r['messages'][1]['content'] for r in STATE['requests'] if 'Excel 价格' in r['messages'][1]['content'])
            assert '基础版\t每月 239' in excel_call and '第二张表\t也一起读' in excel_call, excel_call
            check(page, 'Word / Excel 在本机解包成文字后才交给 AI：段落、表格行、多张工作表都能读到')
            # 失败文件留在选择里可重试，成功的不会再被处理。
            expect(page.locator('#diagKFileName')).to_contain_text('已选择 4 个文件')
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('失败 4 个', timeout=15000)
            assert len(send(page, 'getKnowledgeBase')['entries']) == len(entries) + 3
            # 一次超过 20 个：整批拒绝，不读文件不写库。
            page.locator('#diagKFile').set_input_files([{'name': f'bulk{i}.txt', 'mimeType': 'text/plain', 'buffer': b'x'} for i in range(21)])
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('最多导入 20 个文件')
            assert len(send(page, 'getKnowledgeBase')['entries']) == len(entries) + 3
            page.locator('#diagKAddCancel').click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            page.screenshot(path=str(out / 'knowledge.png'), full_page=True)
            check(page, '批量文件导入：Word/Excel 本机解包抽文字后再入库，坏文件逐个点名不阻断、失败保留可重试、超20个整批拒绝')
            page.locator('#diagKSearch').fill('文件标签')
            expect(page.locator('.diag-kb-item')).to_have_count(1)
            row = page.locator('.diag-kb-item')
            # 正文就在行里（限 80 字）：原来那颗「查看」点开了也只看正文（老板口径）
            expect(row.locator('.diag-kb-view')).to_have_count(0)
            expect(row.locator('.diag-kb-detail')).to_have_count(0)
            peek_cell = row.locator('.diag-kb-note').first
            assert peek_cell.inner_text() == '完整内容' * 20 + '…', peek_cell.inner_text()
            assert '完整内容' * 21 not in row.inner_text()
            row.locator('.diag-kb-edit-btn').click()
            expect(page.locator('#diagKEditPanel:modal')).to_have_count(1)
            expect(page.locator('#diagKEditTitleIn')).to_be_focused()
            expect(page.locator('#diagKEditTitleIn')).to_have_value('文件导入知识')
            expect(page.locator('#diagKEditContent')).to_have_value('完整内容' * 70)
            page.locator('#diagKEditCancel').click()
            expect(page.locator('#diagKEditPanel')).to_be_hidden()
            expect(row.locator('.diag-kb-row')).to_contain_text('文件导入知识')
            row.locator('.diag-kb-edit-btn').click()
            expect(page.locator('#diagKEditTitleIn')).to_have_value('文件导入知识')
            page.locator('#diagKEditTitleIn').fill('')
            page.locator('#diagKEditSave').click()
            expect(page.locator('#diagKEditMsg')).to_contain_text('不能为空')
            expect(page.locator('#diagKEditPanel:modal')).to_have_count(1)
            page.locator('#diagKEditTitleIn').fill('文件导入知识')
            page.locator('#diagKEditTags').fill('[不是JSON]')
            page.locator('#diagKEditSave').click()
            expect(page.locator('#diagKEditMsg')).to_contain_text('标签格式有误')
            page.locator('#diagKEditTags').fill('["文件标签", "带,逗号"]')
            hostile = '<img src=x onerror="window.injected=1"> & "引号" <script>window.injected=2</script>'
            page.locator('#diagKEditContent').fill(hostile)
            page.locator('#diagKEditSave').click()
            expect(page.locator('#diagKEditPanel')).to_be_hidden()
            expect(page.locator('#diagKRefresh')).to_be_enabled()
            row = page.locator('.diag-kb-item')
            expect(row.locator('.diag-kb-note').first).to_contain_text(hostile[:40])
            expect(row.locator('td').first.locator('img, script')).to_have_count(0)
            assert page.evaluate('() => window.injected') is None
            row.locator('.diag-kb-edit-btn').click()
            expect(page.locator('#diagKEditContent')).to_have_value(hostile)
            expect(page.locator('#diagKEditTags')).to_have_value('文件标签、带,逗号')
            page.locator('#diagKEditCancel').click()
            expect(page.locator('#diagKRefresh')).to_be_enabled()
            updated = next(e for e in send(page, 'getKnowledgeBase')['entries'] if e['id'] == imported['id'])
            assert updated['content'] == hostile and updated['tags'] == ['文件标签', '带,逗号']
            row.locator('.diag-kb-toggle').click()
            expect(page.locator('#diagKRefresh')).to_be_enabled()
            expect(row.locator('.diag-kb-status')).to_contain_text('启用中')
            row.locator('.diag-kb-toggle').click()
            expect(page.locator('#diagKRefresh')).to_be_enabled()
            expect(row.locator('.diag-kb-status')).to_contain_text('已停用')
            page.locator('#diagKSearch').fill('完全不存在的检索词')
            expect(page.locator('#diagKList')).to_contain_text('没有匹配')
            page.locator('#diagKSearch').fill('')
            check(page, '行内正文预览（限 80 字）、弹窗编辑校验保存、标签保真、启停和HTML安全显示')
            # ④ 分类 / 状态筛选：分类选项按库里的分类自动生成（先按分类收窄，再叠状态与搜索词）
            cat_sel = page.locator('#diagKFilterCat')
            expect(cat_sel.locator('option')).not_to_have_count(1)
            cat_val = cat_sel.locator('option').nth(1).get_attribute('value')
            cat_sel.select_option(cat_val)
            expect(cat_sel).to_have_value(cat_val)
            assert page.locator('.diag-kb-item').count() > 0
            for i in range(page.locator('.diag-kb-item').count()):
                expect(page.locator('.diag-kb-item').nth(i).locator('td').nth(1)).to_have_text(cat_val)
            status_sel = page.locator('#diagKFilterStatus')
            status_sel.select_option('off')
            for i in range(page.locator('.diag-kb-item').count()):
                expect(page.locator('.diag-kb-item').nth(i).locator('.diag-kb-status')).to_have_text('已停用')
            status_sel.select_option('on')
            for i in range(page.locator('.diag-kb-item').count()):
                expect(page.locator('.diag-kb-item').nth(i).locator('.diag-kb-status')).to_have_text('启用中')
            status_sel.select_option('')
            cat_sel.select_option('')
            assert page.locator('.diag-kb-item').count() > 0
            check(page, '④ 分类/状态筛选：选项随库生成、可与搜索叠加，切回「全部」恢复')
            # 加密备份不再走「文件导入」，而是引导到旁边「📦 备份 ▾」里的「导入备份」（备份与导入拆开后的口径）
            encrypted = page.evaluate('(text) => CryptoBox.encryptFile(text, "test-password")', json.dumps([{'title': '加密备份知识', 'content': '备份里的正文'}], ensure_ascii=False))
            before_count = len(send(page, 'getKnowledgeBase')['entries'])
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="file"]').click()
            page.locator('#diagKFile').set_input_files({'name': 'encrypted.json', 'mimeType': 'application/json', 'buffer': encrypted.encode()})
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('请用旁边「📦 备份 ▾」里的「导入备份」恢复')
            expect(page.locator('dialog:modal')).to_have_count(1)
            assert len(send(page, 'getKnowledgeBase')['entries']) == before_count
            page.locator('#diagKAddCancel').click()
            expect(page.locator('#diagKAddPanel')).to_be_hidden()
            check(page, '批量导入识别加密备份并引导到「📦 备份 ▾ › 导入备份」')

            # 导出：「📦 备份」点一下就走——读资料 → 设口令 → 直接出文件，中间不再摆一页备份面板
            with page.expect_download() as dl_info:
                page.locator('#diagKBackupBtn').click()
                expect(page.locator('#diagKListMsg')).to_contain_text('请设置导出口令', timeout=15000)
                expect(page.locator('#cbPwd')).to_be_focused()
                page.locator('#cbPwd').fill('backup-pass')
                page.locator('#cbPwd2').fill('backup-pass')
                page.locator('#cbOk').click()
            backup = dl_info.value
            assert re.fullmatch(r'xhs_profile_backup_enc_\d+\.json', backup.suggested_filename), backup.suggested_filename
            backup_bytes = pathlib.Path(backup.path()).read_bytes()
            envelope = json.loads(backup_bytes.decode('utf-8'))
            assert envelope['fmt'] == 'xhs-enc-v1' and envelope['salt'] and envelope['data']
            # 备份是整套账号资料：问卷答案、人设、卖点、知识库、规划与评估都在摘要里，摘要就在状态行说一次
            expect(page.locator('#diagKListMsg')).to_contain_text('已导出全套账号资料')
            expect(page.locator('#diagKListMsg')).to_contain_text('问卷 13 题')
            expect(page.locator('#diagKListMsg')).to_contain_text('人设已生成')
            expect(page.locator('#diagKListMsg')).to_contain_text('知识库 ' + str(before_count) + ' 条')
            expect(page.locator('#diagKListMsg')).to_contain_text('规划已生成')
            expect(page.locator('#diagKListMsg')).to_contain_text('评估报告已生成')
            expect(page.locator('#diagKHistory')).to_contain_text('备份导出')
            expect(page.locator('dialog:modal')).to_have_count(0)     # 出完文件不留页，回到列表
            page.screenshot(path=str(out / 'knowledge-backup.png'), full_page=True)
            # 解开看一眼：整套资料都在，且不含 AI Key。
            bundle = json.loads(page.evaluate('(payload) => CryptoBox.decryptFile(payload, "backup-pass")',
                                               backup_bytes.decode('utf-8')))
            assert bundle['type'] == 'xhs_profile_backup' and bundle['version'] == 1
            assert [a['answer'] for a in bundle['diagnosis']['answers']][:2] == ['我是产品设计师', '体验工具']
            assert bundle['diagnosis']['profile']['name'] == '测试账号'
            assert bundle['persona']['text'] == '我是一名产品设计师，耐心分享真实体验与使用方法。'
            assert bundle['persona']['coverHook'] == '耐心的工具分享者'
            assert bundle['product']['name'] == '体验工具'
            assert [p['title'] for p in bundle['product']['sellPoints']][:1] == ['先试再选']
            assert bundle['notePlan']['contentFocus'] == '小工具使用教程'
            assert bundle['deepReport']['priorities'] == ['补齐简介钩子', '固定更新节奏']
            assert len(bundle['knowledgeBase']) == before_count
            assert 'ai' not in bundle and 'apiKey' not in json.dumps(bundle)
            check(page, '点「📦 备份」＝设完口令直接出文件：问卷/人设/卖点/知识库/规划+评估都在，状态行摘要说一次，且不含 AI Key')

            # 备份之后改动一条 + 新增一条，用来分辨合并与覆盖。
            page.locator('#diagKAddBtn').click()
            page.locator('[data-kb-method="file"]').click()
            page.locator('#diagKFile').set_input_files({'name': 'tweak.json', 'mimeType': 'application/json', 'buffer': json.dumps([
                {'title': '文件导入知识', 'content': '备份之后被改动的正文'},
                {'title': '备份之后新增的知识', 'content': '覆盖导入后应当消失'},
            ], ensure_ascii=False).encode()})
            page.locator('#diagKFileImport').click()
            expect(page.locator('#diagKFMsg')).to_contain_text('更新 1', timeout=10000)
            expect(page.locator('#diagKFMsg')).to_contain_text('新增 1')
            page.locator('#diagKAddCancel').click()
            tweaked = send(page, 'getKnowledgeBase')['entries']
            assert len(tweaked) == before_count + 1
            assert next(e for e in tweaked if e['title'] == '文件导入知识')['content'] == '备份之后被改动的正文'

            def confirm_next(accept):
                page.once('dialog', lambda prompt: prompt.accept() if accept else prompt.dismiss())

            # 模拟换电脑：把本机账号资料清空并刷新，备份里的问卷/人设/卖点/规划本该被补回来。
            worker.evaluate('''async () => {
                const cfg = await Storage.getConfig();
                cfg.persona = null; cfg.diagnosis = null; cfg.product = null; cfg.myCity = null;
                await Storage.setConfig(cfg);
                await chrome.storage.local.remove(['note_plan', 'deep_report']);
            }''')
            page.reload()
            page.locator('#tabDiagnose').click()
            ai_before = len(STATE['requests'])
            page.locator(go('sell')).click()
            # 「产品卖点」不再被基础配置拦着：没问卷也进得来、能手工维护；「新增卖点」里的同步只提示、不调用 AI
            expect(page.locator('#diagSellList table')).to_be_visible()
            # 二十九改：空库不再在标题下报「总数 0 条」，条数只在同步状态行/列表里说
            expect(page.locator('#diagSellStats')).to_have_text('')
            expect(page.locator('#diagSellSyncLine')).to_contain_text('还没有卖点')
            expect(page.locator('#diagStepBody')).not_to_contain_text('这一页要靠「基础配置」抓主页')
            expect(page.locator('#diagGoto1')).to_have_count(0)
            page.locator('#diagSellAdd').click()
            page.locator('[data-sell-method="quiz"]').click()
            page.locator('#diagSellQuizRun').click()
            expect(page.locator('#diagSellQuizMsg')).to_contain_text('还没填过问卷')
            assert len(STATE['requests']) == ai_before, STATE['requests'][ai_before:]
            expect(page.locator('#diagSellDialog')).to_be_visible()
            page.locator('#diagSellClose').click()
            # 五十二改：人设页没有「从问卷同步」按钮了——问卷答完提交就自动带出人设；
            # 没问卷时只在输入框占位符里提示先去「问卷」，人设/说话风格两个 tab 都进得来、改得动。
            persona_tab(page)
            expect(page.locator('#diagPEdit')).to_have_value('')
            expect(page.locator('#diagPEdit')).to_have_attribute('placeholder', re.compile('还没答过问卷'))
            expect(page.locator('#diagPStatus')).to_have_text('')   # 只靠占位符，不重复一句提示
            assert len(STATE['requests']) == ai_before, STATE['requests'][ai_before:]
            check(page, '问卷清空后「人设 / 产品卖点」仍可直接进入与手工维护；卖点弹窗里的「从问卷同步」只提示、不调用AI，人设页只靠占位符提示')
            page.locator(go('kb')).click()
            expect(page.locator('#diagKList')).to_contain_text('文件导入知识')   # 知识库没被清，仍留着本地这份
            def bk_import(mode, name, buffer):
                """「📦 备份 ▾ › 导入备份（合并 / 覆盖）」＝点菜单项直接开系统文件框，选完立刻导入。
                旧版那颗「先选文件、再点合并/覆盖」的两步按钮已撤（老板：点了就做事）。"""
                page.locator('#diagKBkMenuBtn').click()
                expect(page.locator('#diagKBkPop')).to_be_visible()
                with page.expect_file_chooser() as chooser:
                    page.locator('#diagKBkPop [data-bk="%s"]' % mode).click()
                expect(page.locator('#diagKBkPop')).to_be_hidden()
                chooser.value.set_files({'name': name, 'mimeType': 'application/json', 'buffer': buffer})

            bk_import('merge', 'kb-backup.json', backup_bytes)
            expect(page.locator('#cbPwd')).to_be_focused(timeout=15000)
            # 口令没输完时列表也能刷新：不打断弹窗、不锁输入
            page.evaluate('() => diagKbRefresh()')
            expect(page.locator('#cbPwd')).to_be_enabled()
            expect(page.locator('#cbOk')).to_be_enabled()
            page.screenshot(path=str(out / 'knowledge-backup-password.png'), full_page=True)
            page.locator('#cbCancel').click()
            expect(page.locator('#diagKListMsg')).to_contain_text('已取消解密')
            expect(page.locator('#diagKEditPanel:modal')).to_have_count(0)
            assert len(send(page, 'getKnowledgeBase')['entries']) == before_count + 1
            bk_import('merge', 'kb-backup.json', backup_bytes)
            expect(page.locator('#cbPwd')).to_be_focused(timeout=15000)
            page.keyboard.press('Escape')
            expect(page.locator('#cbPwd')).to_have_count(0)
            expect(page.locator('#diagKListMsg')).to_contain_text('已取消解密')
            expect(page.locator('#diagKBkMenuBtn')).to_be_enabled()
            bk_import('merge', 'kb-backup.json', backup_bytes)
            expect(page.locator('#cbPwd')).to_be_focused(timeout=15000)
            page.locator('#cbPwd').fill('wrong-password')
            page.locator('#cbOk').click()
            expect(page.locator('#diagKListMsg')).to_contain_text('解密失败', timeout=15000)
            assert len(send(page, 'getKnowledgeBase')['entries']) == before_count + 1
            assert worker.evaluate('async () => (await Storage.getConfig()).persona') is None
            # 正确口令合并：知识按标题合并（改动那条回到备份内容、未变化的跳过、备份后新增的留着），
            # 账号资料只补本机缺的——清空的问卷/人设/卖点/规划都要补回来。
            bk_import('merge', 'kb-backup.json', backup_bytes)
            expect(page.locator('#cbPwd')).to_be_focused(timeout=15000)
            page.locator('#cbPwd').fill('backup-pass')
            page.locator('#cbOk').click()
            # 成功摘要走「本次录入记录」：导入成功后立刻刷新列表，#diagKListMsg 会被清空
            expect(page.locator('#diagKHistory')).to_contain_text('已合并账号资料：补上 问卷答案、人设、产品卖点', timeout=15000)
            expect(page.locator('#diagKHistory')).to_contain_text('内容规划')
            expect(page.locator('#diagKHistory')).to_contain_text('评估报告')
            expect(page.locator('#diagKHistory')).to_contain_text('更新 1')
            expect(page.locator('#diagKHistory')).to_contain_text('跳过 ' + str(before_count - 1))
            merged = send(page, 'getKnowledgeBase')['entries']
            assert len(merged) == before_count + 1
            assert '备份之后新增的知识' in [e['title'] for e in merged]
            restored = next(e for e in merged if e['title'] == '文件导入知识')
            assert restored['content'] == hostile
            assert restored['tags'] == ['文件标签', '带,逗号'] and restored['isActive'] is False
            got_cfg = worker.evaluate('() => Storage.getConfig()')
            assert got_cfg['diagnosis']['profile']['name'] == '测试账号'
            assert [a['answer'] for a in got_cfg['diagnosis']['answers']][:2] == ['我是产品设计师', '体验工具']
            assert got_cfg['persona']['text'] == '我是一名产品设计师，耐心分享真实体验与使用方法。'
            assert got_cfg['product']['name'] == '体验工具'
            assert [p['title'] for p in got_cfg['product']['sellPoints']] == ['先试再选']
            assert worker.evaluate('async () => (await chrome.storage.local.get("note_plan")).note_plan')['contentFocus'] == '小工具使用教程'
            assert worker.evaluate('async () => (await chrome.storage.local.get("deep_report")).deep_report')['priorities'] == ['补齐简介钩子', '固定更新节奏']
            assert got_cfg['ai']['apiKey'] != '', '恢复资料不该动 AI 配置'
            expect(page.locator('#diagKStats')).to_contain_text('总数 ' + str(before_count + 1) + ' 条', timeout=15000)
            expect(page.locator('#diagKBkMenuBtn')).to_be_enabled()
            # 页面也要跟着活过来：导航圈就地补勾，回访各节点能看到恢复的资料。（当前在知识库，三个目标都不是当前节点）
            for step in ('base', 'sell', 'plan'):
                assert is_done(page, step), '%s 该打勾' % step
            page.locator(go('quiz')).click()
            expect(q9_picked(page)).to_have_value('我是做体验工具的设计师，做了 5 年，擅长把功能讲成大白话，能帮你选对工具')   # 第 9 题＝一句话人设
            persona_tab(page)
            expect(page.locator('#diagPEdit')).to_have_value('我是一名产品设计师，耐心分享真实体验与使用方法。')
            page.locator(go('sell')).click()
            expect(page.locator('#diagSellList tbody.diag-sell-item')).to_contain_text('先试再选')
            page.locator(go('kb')).click()
            check(page, '合并导入：取消/错口令不写入；知识按标题合并、跳过未变化、保留新增；账号资料只补本机缺的并即时打勾回显')

            # 手写的 JSON 数组也能当备份导入（合并；未加密不会弹口令）。
            bk_import('merge', 'plain.json', json.dumps([{'title': '手写备份知识', 'content': '没有加密的 JSON 数组备份'}], ensure_ascii=False).encode())
            expect(page.locator('#diagKHistory')).to_contain_text('新增 1', timeout=15000)
            expect(page.locator('#cbPwd')).to_have_count(0)
            assert len(send(page, 'getKnowledgeBase')['entries']) == before_count + 2
            # 坏备份：不写库并说明原因。
            bk_import('merge', 'notbackup.json', b'{oops')
            expect(page.locator('#diagKListMsg')).to_contain_text('JSON 解析失败', timeout=15000)
            bk_import('merge', 'obj.json', json.dumps({'hello': 'world'}).encode())
            expect(page.locator('#diagKListMsg')).to_contain_text('没有知识条目', timeout=15000)
            assert len(send(page, 'getKnowledgeBase')['entries']) == before_count + 2
            # 覆盖导入：二次确认取消不写库，确认后整库与账号资料都按备份替换。
            confirm_next(False)
            bk_import('replace', 'kb-backup.json', backup_bytes)
            expect(page.locator('#cbPwd')).to_be_focused(timeout=15000)
            page.locator('#cbPwd').fill('backup-pass')
            page.locator('#cbOk').click()
            expect(page.locator('#diagKListMsg')).to_contain_text('已取消覆盖', timeout=15000)
            assert len(send(page, 'getKnowledgeBase')['entries']) == before_count + 2
            # 覆盖会整份替换：本机先改成备份里没写的样子，导入后必须回到备份内容。
            worker.evaluate('''async () => {
                const cfg = await Storage.getConfig();
                cfg.persona = { text: '覆盖前被改坏的人设', bio: '' };
                cfg.product = { name: '被改坏的品名', sellPoints: [] };
                await Storage.setConfig(cfg);
                await chrome.storage.local.set({ note_plan: { contentFocus: '被改坏的规划' }, deep_report: { priorities: ['被改坏的评估'] } });
            }''')
            confirm_next(True)
            bk_import('replace', 'kb-backup.json', backup_bytes)
            expect(page.locator('#cbPwd')).to_be_focused(timeout=15000)
            page.locator('#cbPwd').fill('backup-pass')
            page.locator('#cbOk').click()
            expect(page.locator('#diagKHistory')).to_contain_text('备份覆盖导入 / kb-backup.json', timeout=15000)
            expect(page.locator('#diagKHistory')).to_contain_text('已用备份替换账号资料', timeout=15000)
            expect(page.locator('#diagKHistory')).to_contain_text('知识库已覆盖，共 ' + str(before_count) + ' 条')
            replaced = send(page, 'getKnowledgeBase')['entries']
            assert len(replaced) == before_count
            assert '备份之后新增的知识' not in [e['title'] for e in replaced]
            assert next(e for e in replaced if e['title'] == '文件导入知识')['content'] == hostile
            assert worker.evaluate('async () => (await chrome.storage.local.get("knowledge_base")).knowledge_base').startswith('enc:v1:')
            got_cfg = worker.evaluate('() => Storage.getConfig()')
            assert got_cfg['persona']['text'] == '我是一名产品设计师，耐心分享真实体验与使用方法。'
            assert got_cfg['product']['name'] == '体验工具'
            assert [p['title'] for p in got_cfg['product']['sellPoints']] == ['先试再选']
            assert worker.evaluate('async () => (await chrome.storage.local.get("note_plan")).note_plan')['contentFocus'] == '小工具使用教程'
            assert worker.evaluate('async () => (await chrome.storage.local.get("deep_report")).deep_report')['priorities'] == ['补齐简介钩子', '固定更新节奏']
            page.screenshot(path=str(out / 'knowledge-backup-import.png'), full_page=True)
            check(page, '覆盖导入：二次确认可取消、确认后整库与账号资料按备份替换且落盘加密')
            expect(page.locator('dialog:modal')).to_have_count(0)   # 选完文件就一路做到底，做完不留一页

            page.set_viewport_size({'width': 500, 'height': 900})
            page.locator('#diagKAddBtn').click()
            page.screenshot(path=str(out / 'knowledge-modal-narrow.png'), full_page=True)
            assert page.locator('#diagKAddPanel').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
            rect = page.locator('#diagKAddPanel').bounding_box()
            assert rect['x'] >= 0 and rect['x'] + rect['width'] <= 500
            page.locator('#diagKAddCancel').click()
            page.locator('#diagKList').scroll_into_view_if_needed()
            page.screenshot(path=str(out / 'knowledge-narrow.png'), full_page=True)
            assert page.locator('#diagStepBody').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
            assert page.locator('#diagKList').evaluate('(el) => el.scrollWidth > el.clientWidth')
            page.locator('#diagKBkMenuBtn').click()
            expect(page.locator('#diagKBkPop')).to_be_visible()
            page.screenshot(path=str(out / 'knowledge-backup-narrow.png'), full_page=True)
            assert page.locator('#diagKBkPop').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
            rect = page.locator('#diagKBkPop').bounding_box()
            assert rect['x'] >= 0 and rect['x'] + rect['width'] <= 500
            pop_rect = page.locator('#diagKBkPop').bounding_box()
            page.mouse.click(250, pop_rect['y'] + pop_rect['height'] + 30)   # 浮层下面那片才是「外面」：点它就收起（导入/备份不再铺一整页）
            expect(page.locator('#diagKBkPop')).to_be_hidden()
            page.locator('.diag-kb-edit-btn').first.click()
            expect(page.locator('#diagKEditPanel:modal')).to_have_count(1)
            page.screenshot(path=str(out / 'knowledge-edit-narrow.png'), full_page=True)
            assert page.locator('#diagKEditPanel').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
            rect = page.locator('#diagKEditPanel').bounding_box()
            assert rect['x'] >= 0 and rect['x'] + rect['width'] <= 500
            page.keyboard.press('Escape')
            expect(page.locator('#diagKEditPanel')).to_be_hidden()
            expect(page.locator('.diag-kb-edit-btn').first).to_be_focused()
            page.set_viewport_size({'width': 1180, 'height': 1000})
            check(page, '窄窗口：「📦 备份 ▾」贴边不溢出、点外面收起；编辑弹窗不溢出，Escape 关闭并回到那颗「编辑」')
            page.locator('#diagKAddBtn').focus()
            page.evaluate('''() => {
                window.passwordResult = null;
                CryptoBox.askPassword({ confirm: true, title: '<b>导出口令</b>' }).then(r => { window.passwordResult = r; });
            }''')
            expect(page.locator('dialog:modal')).to_have_count(1)
            expect(page.locator('#cbTitle')).to_have_text('<b>导出口令</b>')
            expect(page.locator('#cbTitle b')).to_have_count(0)
            page.locator('#cbPwd').fill('short')
            page.locator('#cbOk').click()
            expect(page.locator('#cbErr')).to_contain_text('至少 6 位')
            page.locator('#cbPwd').fill('test-password')
            page.locator('#cbPwd2').fill('different-password')
            page.locator('#cbOk').click()
            expect(page.locator('#cbErr')).to_contain_text('不一致')
            page.locator('#cbPwd2').fill('test-password')
            page.keyboard.press('Enter')
            expect(page.locator('#cbPwd')).to_have_count(0)
            assert page.evaluate('() => window.passwordResult') == {'ok': True, 'password': 'test-password'}
            expect(page.locator('#diagKAddBtn')).to_be_focused()
            check(page, '独立口令框确认校验、Enter 提交和关闭后焦点恢复')
            page.reload()
            page.locator('#tabDiagnose').click()
            page.locator(go('quiz')).click()
            expect(q9_picked(page)).to_have_value('我是做体验工具的设计师，做了 5 年，擅长把功能讲成大白话，能帮你选对工具')   # ② 第 9 题＝一句话人设
            STATE['fail_knowledge'] = True
            page.locator('.diagQuiz_Q').nth(0).fill('我是新的产品设计师')
            before = len(STATE['requests'])
            page.locator('#diagQuizNext').click()
            expect(page.locator('#diagQuizNext')).to_be_enabled(timeout=30000)
            failed = worker.evaluate('async () => (await Storage.getConfig()).diagnosis')
            assert failed['results']['persona']['status'] == 'done'
            assert failed['results']['knowledge']['status'] == 'error'
            assert failed['results']['plan']['status'] == 'error'
            assert len(STATE['requests']) - before == 4
            # 失败项的明细只写在这一条消息里（② 底部那 4 行「查看」块已删）
            expect(page.locator('#diagSyncResults')).to_have_count(0)
            fail_msg = page.locator('#diagQuizMsg').inner_text()
            assert '知识库' in fail_msg and '内容规划' in fail_msg and '只补失败项' in fail_msg, fail_msg
            assert '人设：' not in fail_msg, fail_msg        # 成功的项不进失败清单
            STATE['fail_knowledge'] = False
            before = len(STATE['requests'])
            page.locator('#diagQuizNext').click()
            expect(page.locator('#diagQuizNext')).to_be_enabled(timeout=30000)
            assert len(STATE['requests']) - before == 2
            assert all(v['status'] == 'done' for v in worker.evaluate('async () => (await Storage.getConfig()).diagnosis.results').values())
            expect(page.locator('#diagQuizMsg')).to_contain_text('都已同步')
            check(page, '刷新恢复问卷；局部失败在顶部消息里点名、成功项不进失败清单，重试只补知识和规划')
            before = len(STATE['requests'])
            persona_tab(page)
            expect(page.locator('#diagPEdit')).to_have_value('我是一名产品设计师，耐心分享真实体验与使用方法。')
            page.locator('#diagPEdit').fill('手工维护的人设正文')
            page.locator('#diagPEditSave').click()
            expect(page.locator('#diagPEditMsg')).to_contain_text('已保存')
            # 说话风格（五十二改进「人设」页第二个 tab）：没有摘要表也没有弹窗；3 问问卷 + 字数直接改，
            # AI 认口吻只由「🧠 识别我的口吻」触发（保存按钮只落盘）
            persona_tab(page, 'style')
            expect(page.locator('#diagStylePanel')).to_have_count(0)
            expect(page.locator('#diagToneResult')).not_to_have_text('', timeout=15000)   # 异步预填跑完（它会按已存的回答重设输入框）再填，免得刚填的被清掉
            expect(page.locator('#diagTq0')).to_have_value('')
            page.locator('#diagMinC').fill('120')
            page.locator('#diagMaxC').fill('260')
            page.locator('#diagStyleSave').click()
            expect(page.locator('#diagStyleMsg')).to_contain_text('已保存', timeout=15000)
            assert len(STATE['requests']) == before, '「说话风格」的「保存」只落盘，不得调用 AI'
            # 答不满 2 个问题 → 不许烧 AI
            page.locator('#diagTq0').fill('我实际用下来，别急，先看自己平时怎么用')
            page.locator('#diagToneRun').click()
            expect(page.locator('#diagStyleMsg')).to_contain_text('先答 2 个以上问题')
            assert len(STATE['requests']) == before, '答不满 2 题不许调 AI'
            page.locator('#diagTq1').fill('爱开玩笑、先共情再给建议，常挂嘴边的是「别急」')
            page.locator('#diagTq2').fill('客服腔，比如「亲」「宝子」，一听就烦')
            # 三问都在（被清掉就是 0 题，点按钮只会又提示「先答 2 个以上问题」）
            for i, v in enumerate(('我实际用下来，别急，先看自己平时怎么用', '爱开玩笑、先共情再给建议，常挂嘴边的是「别急」', '客服腔，比如「亲」「宝子」，一听就烦')):
                expect(page.locator('#diagTq' + str(i))).to_have_value(v)
            page.locator('#diagToneRun').click()
            # 成功写「口吻已识别并保存」、失败把原因也写在同一条消息里 —— 先等这条，别干盯结果框
            expect(page.locator('#diagStyleMsg')).to_contain_text('口吻已识别', timeout=25000)
            expect(page.locator('#diagToneResult')).to_contain_text('我识别到的口吻')
            expect(page.locator('#diagToneResult')).to_contain_text('我实际用下来')
            assert len(STATE['requests']) == before + 1, '识别口吻该只打一发 AI'
            tone_sys = STATE['requests'][-1]['messages'][0]['content']
            tone_user = STATE['requests'][-1]['messages'][1]['content']
            assert '口吻分析师' in tone_sys, tone_sys[:120]
            assert '先看自己平时怎么用' in tone_user and '一听就烦' in tone_user, tone_user
            check(page, '「人设 → 说话风格」＝3 问大白话问卷：「识别我的口吻」一发 AI 出档案；保存不烧 AI、答不满 2 题不烧 AI')
            before = len(STATE['requests'])
            # 基础配置＝产品名称（可多行：主名+别名）+ 账号类型 + 昵称 + 同城挡位（杂项配置整页并进来的）；
            # 推广目标 & 评论区承接 2026-09-25 搬去「获客 → 任务配置 → 🎯 推广目标」，这里不该再有；
            # 说话风格那一组也不该再出现（它在「人设」页的第二个 tab）
            page.locator(go('base')).click()
            expect(page.locator('#diagProdName')).to_have_value('体验工具')
            for sel in ('#diagToneRun', '#diagTq0', '#diagMinC', '#diagMaxC'):
                expect(page.locator(sel)).to_have_count(0)
            expect(page.locator('#diagPurp')).to_have_count(0)      # 评论目的一直在卖点页，基础配置里从来没有它
            for sel in ('#diagPromoGoal', '#diagProdGuide'):
                expect(page.locator(sel)).to_have_count(0)          # 推广目标/评论区承接已搬去获客·任务配置
            for sel in ('#diagAccountNames', '#diagSameCity', '#diagCityInp'):
                expect(page.locator(sel)).to_have_count(1)          # 并进来的那几张卡都在
            # 账号类型没手选过 → 把 AI 判断出来的那个填进自填框
            expect(page.locator('#diagAcctCustom')).to_have_value('教程/步骤型')
            page.locator('#diagAcctCustom').fill('自定义教程类型')
            page.set_viewport_size({'width': 500, 'height': 900})
            page.locator('#diagS1Save').scroll_into_view_if_needed()
            page.screenshot(path=str(out / 'setup-inline-narrow.png'), full_page=True)
            assert page.locator('#diagStepBody').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
            page.set_viewport_size({'width': 1180, 'height': 1000})
            page.locator('#diagS1Save').click()
            expect(page.locator('#diagS1Msg')).to_contain_text('已保存', timeout=15000)
            assert len(STATE['requests']) == before, '保存说话风格/基础配置都不得调用 AI'
            saved = worker.evaluate('() => Storage.getConfig()')
            assert saved['scriptStyle']['toneAnswers'][0].startswith('我实际用下来'), saved['scriptStyle'].get('toneAnswers')
            assert saved['scriptStyle']['toneProfile'].startswith('说话直接'), saved['scriptStyle'].get('toneProfile')
            assert saved['scriptStyle']['toneMannerisms'] == '我实际用下来、别急'
            assert saved['scriptStyle']['purposeMinChars'] == 120
            assert saved['scriptStyle']['purposeMaxChars'] == 260
            assert saved['product']['name'] == '体验工具'
            assert saved['diagnosis']['accountType'] == '自定义教程类型'
            # 类型换了 → ⑨ 的规划作废，完成圈当场掉（当前在 ①，⑨ 不是当前节点）
            assert not is_done(page, 'plan'), '账号类型换了，⑨ 不该还打勾'
            check(page, '说话风格独立成 ⑥（3 问问卷 + 识别口吻 + 字数）写回 scriptStyle；① 收着产品名称+账号类型+昵称/同城（整页一个保存，推广目标/评论区承接已搬去获客·任务配置），账号类型手选落盘并作废旧规划，两页保存都不调用 AI')
            page.locator(go('sell')).click()
            # 进入 ④ 只读取并渲染，不得自动调用 AI；后续 AI 只由显式点击触发（由 check_sell_points 自行记账）。
            assert len(STATE['requests']) == before, '进入 ④ 不得调用 AI'
            check_sell_points(page, worker, out)
            page.locator(go('plan')).click()
            # 封面设置已从 ⑨ 挪到发笔记：这里不该再有它，规划+评估只有一个按钮；账号类型选择器也搬去 ① 了
            expect(page.locator('#diagCoverSave')).to_have_count(0)
            expect(page.locator('#diagReportBuild')).to_have_count(0)
            expect(page.locator('#diagPlanTypeCustom')).to_have_count(0)
            expect(page.locator('#diagPlanTypeNow')).to_have_count(0)   # 账号类型只在 ①，⑨ 不再重复展示
            expect(page.locator('#diagPlanBuild')).to_have_text('🔄 重新生成规划与评估')
            # 2026-09-29：调子 / 人设三阶段表 / 五条线 × 写法 整块搬去「发笔记 → 任务配置」，这一页只剩排产与报告
            # 2026-10-01 五十二改：连「这一页只按…定下的基调排版」那行指路也整句撤掉（老板：这个提示不要了）
            assert page.locator('#diagStyleResult').count() == 0 and page.locator('#diagToneSummary').count() == 0, \
                '规划页不该再摆基调内容（它们住在「发笔记 → 任务配置」）'
            expect(page.locator('#diagStepBody')).not_to_contain_text('定下的基调排版')
            check(page, '规划＝只有排产表 + 报告：基调内容都在「发笔记 → 任务配置」，这一页连指路那行话也不摆')
            # 标题下那段落说明整段撤（2026-09-25 二十九改）：别再摆「还没随问卷同步过…只更新规划与评估…」
            plan_txt = page.locator('#diagStepBody').inner_text()
            assert '还没随' not in plan_txt and '不动人设/卖点/知识库' not in plan_txt, plan_txt[:200]
            plan_before = len(STATE['requests'])
            page.locator('#diagPlanBuild').click()
            expect(page.locator('#diagPlanMsg')).to_contain_text('已重新生成', timeout=30000)
            assert len(STATE['requests']) == plan_before + 2, len(STATE['requests']) - plan_before
            # 重新生成会补回被 ① 清掉的规划标记：⑨ 的完成圈回来，别再要一次问卷同步（切走才看得见 .done）
            assert park_done(page, 'plan', park='base'), '重生成规划后 ⑨ 该打勾'
            manual = worker.evaluate('() => Storage.getConfig()')
            assert manual['persona']['text'] == '手工维护的人设正文'
            assert manual['scriptStyle']['toneMannerisms'] == '我实际用下来、别急'
            assert manual['diagnosis']['accountType'] == '自定义教程类型'
            assert manual['product']['guideText'] == '私信我了解'
            # 评论目的已退出诊断流程（只在获客助手顶部改），走完向导应保持默认空值
            assert manual['product']['commentPurpose'] == ''
            assert manual['product']['sellPoints'][0]['content'] == '手工补充的真实产品卖点'
            assert '手工维护的人设正文' in STATE['requests'][-1]['messages'][1]['content']
            assert '自定义教程类型' in STATE['requests'][-1]['messages'][1]['content']
            check(page, '人设风格卖点手工维护回归；⑨ 只剩规划+评估一次生成，重生成不动其他资料')
            # 评论目的不再作为产品级配置：杂项配置里没有它
            # （杂项配置整页已撤、并进「诊断&配置 → ① 基础配置」，这里按面板本体深链打开）
            page.goto(f'chrome-extension://{eid}/settings.html#product')
            page.wait_for_load_state('domcontentloaded')
            expect(page.locator('#tab-product')).to_have_count(0)
            expect(page.locator('#scriptPurposeSelect')).to_have_count(0)
            expect(page.locator('#saveProductBtn')).to_have_count(0)
            check(page, '设置页「杂项配置」整页已撤（并进「诊断&配置 → ① 基础配置」），评论目的也不在设置页')
            # 入口搬到「获客助手」（找商机）顶部：改完立即落 product.commentPurpose，并清掉旧字段
            page.goto(f'chrome-extension://{eid}/popup.html?mode=big')
            page.wait_for_load_state('domcontentloaded')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabHuoke').click()
            expect(page.locator('#purposeBar')).to_be_visible()
            expect(page.locator('#purposeSel')).to_have_value('sell')
            page.locator('#purposeSel').select_option('trend')
            expect(page.locator('#purposeMsg')).to_contain_text('已保存')
            purpose_saved = worker.evaluate('() => Storage.getConfig()')
            assert purpose_saved['product']['commentPurpose'] == 'trend'
            assert 'scriptPurpose' not in (purpose_saved.get('scriptStyle') or {})
            # 切到同属获客分组的「任务配置 / 队列 / 笔记池」时，这条只服务找商机的控制条要收起来
            page.locator('#tabTaskCfg').click()
            expect(page.locator('#purposeBar')).to_be_hidden()
            page.locator('#tabQueue').click()
            expect(page.locator('#purposeBar')).to_be_hidden()
            page.locator('#tabPool').click()
            expect(page.locator('#purposeBar')).to_be_hidden()
            check(page, '评论目的搬到获客助手（找商机）：改即落 product.commentPurpose、清旧字段，换 Tab 隐藏')
            # 引导方式收敛（2026-09-25）：截流页不再有自己的输入框——评论承接的唯一真源＝
            # 「诊断&配置 → ① 基础配置 → 评论区承接」（product.guideText），没填才回落默认站内承接。
            # 注：四类+高V 改版后，只有「竞对笔记」的私信会用到承接（{guide}），其余场景是露脸评论、不带引导
            page.locator('#tabHuoke').click()
            page.locator('#tabTaskCfg').click()
            expect(page.locator('#tabTaskCfg')).to_have_class(re.compile(r'\bactive\b'))
            cfg = page.locator('#drainCfgContent')
            # 页内四节 tab（2026-09-27 起加「🌿 日常浏览」）：默认落「关键词池」（词 × 类型表；加词入口就在「找词/话题」旁边），
            # 「⋯ 更多设置」整节已撤——东西都内置了：属地跟诊断①、求助词内置、TOP 三排序固定；
            # 推广目标/评论区承接（product.promoGoal / guideText）同日搬来当第三节；日常浏览＝队列里的一种流程项
            expect(cfg.locator('#sxCfgTabs .sx-cfgtab')).to_have_count(4)
            expect(cfg.locator('#sxCfgTabs [data-sec="more"]')).to_have_count(0)
            expect(cfg.locator('#sxCfgTabs [data-sec="kw"]')).to_have_class(re.compile(r'\bactive\b'))
            expect(cfg.locator('#sxKwAdd')).to_be_visible(timeout=20000)
            expect(cfg.locator('#sxAcctAdd')).to_have_count(0)
            cfg.locator('#sxCfgTabs [data-sec="acct"]').click()
            expect(cfg.locator('#sxAcctAdd')).to_be_visible(timeout=10000)
            expect(cfg.locator('#sxKwAdd')).to_have_count(0)
            expect(cfg.locator('#sxCity')).to_have_count(0)
            check(page, '「任务配置」是获客的第一个二级 tab，页内三节（关键词池 / 盯的账号 / 🎯 推广目标），同一时间只渲染一节')
            # 🎯 推广目标（2026-10-01 简：目标固定＝引流到个人主页，页上只剩两句引导文案）
            cfg.locator('#sxCfgTabs [data-sec="goal"]').click()
            expect(cfg.locator('#sxGoalGuide')).to_be_visible(timeout=10000)
            assert cfg.locator('#sxGoalSel').count() == 0, '下拉已删——目标不再可选，固定引流到个人主页'
            assert cfg.locator('#sxGoalGuideRow').count() == 0, '「品牌不引流就藏承接」那套随下拉一起撤了'
            expect(cfg).to_contain_text('引流到个人主页')
            expect(cfg.locator('#sxGoalGuide')).to_have_value('私信我了解')   # 读的就是 product.guideText（老 ① 的数据原地复用）
            cfg.locator('#sxGoalGuide').fill('私信我，先给你做个免费测评')
            cfg.locator('#sxGoalPhrase').fill('更多干货我平时发在主页')
            cfg.locator('#sxGoalSave').click()
            expect(cfg.locator('#sxGoalMsg')).to_contain_text('已保存', timeout=10000)
            goal_saved = worker.evaluate('() => Storage.getConfig().then(c => c.product)')
            assert goal_saved['promoGoal'] == 'profile' and goal_saved['guideText'] == '私信我，先给你做个免费测评' \
                and goal_saved['guidePhrase'] == '更多干货我平时发在主页', goal_saved
            # 切走再回来：读回刚存的（真源＝config.product，不是页面内存）
            cfg.locator('#sxCfgTabs [data-sec="kw"]').click()
            expect(cfg.locator('#sxKwAdd')).to_be_visible(timeout=10000)
            cfg.locator('#sxCfgTabs [data-sec="goal"]').click()
            expect(cfg.locator('#sxGoalGuide')).to_have_value('私信我，先给你做个免费测评')
            expect(cfg.locator('#sxGoalPhrase')).to_have_value('更多干货我平时发在主页')
            # 承接清空也落得下去（评论里就不带承接），再填回来给后面的用例用
            cfg.locator('#sxGoalGuide').fill('')
            cfg.locator('#sxGoalSave').click()
            expect(cfg.locator('#sxGoalMsg')).to_contain_text('已保存', timeout=10000)
            assert worker.evaluate('() => Storage.getConfig().then(c => c.product.guideText)') == '', '清空要落得下去'
            cfg.locator('#sxGoalGuide').fill('私信我，先给你做个免费测评')
            cfg.locator('#sxGoalSave').click()
            expect(cfg.locator('#sxGoalMsg')).to_contain_text('已保存', timeout=10000)
            check(page, '🎯 推广目标（获客·任务配置第三 tab）＝固定目标「引流到个人主页」+ 两句引导（承接 30 字 / 话术 40 字）：读写 product.promoGoal / guideText / guidePhrase，切走回来原样读回、清空也落得下去')
            cfg.locator('#sxCfgTabs [data-sec="kw"]').click()
            expect(cfg.locator('#sxKwAdd')).to_be_visible(timeout=10000)
            cfg_txt = cfg.inner_text()
            for gone in ('更多设置', '搜索口径', '搜索默认', '额外来源'):
                assert gone not in cfg_txt, f'「{gone}」应已下线'
            expect(cfg.locator('#sxGuide')).to_have_count(0)
            assert worker.evaluate('async () => ((await chrome.storage.local.get("drain_scan_cfg")).drain_scan_cfg || {}).guide') is None
            check(page, '「⋯ 更多设置」整节已撤：页面不再有搜索口径/属地输入框，截流配置里也不存 guide（引导只在 获客 → 任务配置 → 🎯 推广目标）')
            prompt_before = len(STATE['requests'])
            worker.evaluate("async () => await handleDrainComment({ scenario: 'rival', noteTitle: '测试笔记', painText: '求推荐一款工具' })")
            assert len(STATE['requests']) == prompt_before + 1
            fallback_prompt = STATE['requests'][-1]['messages'][0]['content'] + STATE['requests'][-1]['messages'][1]['content']
            assert '私信我，先给你做个免费测评' in fallback_prompt, '截流评论的承接真源＝获客·任务配置的评论区承接（product.guideText）'
            check(page, '截流评论的承接只认「获客 → 任务配置 → 🎯 推广目标」这一处（product.guideText）')
            worker.evaluate('''async () => { const c = await Storage.getConfig(); c.product.guideText = ''; await Storage.setConfig(c); }''')
            last_before = len(STATE['requests'])
            worker.evaluate("async () => await handleDrainComment({ scenario: 'rival', noteTitle: '测试笔记' })")
            assert len(STATE['requests']) == last_before + 1
            last_prompt = STATE['requests'][-1]['messages'][0]['content'] + STATE['requests'][-1]['messages'][1]['content']
            assert '我主页/私信' in last_prompt, '评论区承接没填时回到默认站内承接'
            worker.evaluate('''async () => { const c = await Storage.getConfig(); c.product.guideText = '私信我了解'; await Storage.setConfig(c); }''')
            check(page, '评论区承接没填时回到默认站内承接（我主页/私信）')
            # 「搜索默认 / 额外来源」整块早已下线：属地跟随「诊断&配置 → ① 基础配置」的同城城市，
            # 求助词与 TOP 排序内置，这一页只该剩 词池 / 盯的账号 两张表
            assert cfg.locator('#sxKwAdd').count() == 1, '回到词池那节该是词表在'
            # 词表在批次卡展开区里，且空批次只显示提示语（2026-10-02 批次化改版）——
            # 先加一个词（回车进「当前」批并自动展开），再断言表头那排节奏下拉在
            cfg.locator('#sxKwAdd').fill('闭水试验')
            cfg.locator('#sxKwAdd').press('Enter')
            expect(cfg.locator('.sx-kwgrp-body')).to_be_visible(timeout=10000)
            expect(cfg.locator('select[data-trun]').first).to_be_visible(timeout=10000)
            # ✍️ 发笔记①：除了选卖点，还要能选知识库素材（选中→只喂这几条；不选→按卖点筛出相关几条）
            send(page, 'saveKnowledgeBase', {'mode': 'merge', 'entries': [
                {'title': '点选素材测试条', 'content': '上架前的三段式盘点清单，先讲人群再讲场景', 'tags': ['点选']},
                {'title': '未点选素材测试条', 'content': '客服话术口径与退款说明，只在内训里用', 'tags': ['未选']},
            ]})
            page.goto(f'chrome-extension://{eid}/popup.html?mode=big')
            page.wait_for_load_state('domcontentloaded')
            if page.locator('#fsClose').is_visible():
                page.locator('#fsClose').click()
            page.locator('#tabNotePublish').click()
            expect(page.locator('.npar-new')).to_be_visible()         # 一级项落在「笔记档案」（这一块的主页），新建笔记是它页顶那颗
            # ✍️ 新建笔记＝六卡一页（2026-10-08 档案核心）：三方向（📚 知识/🔥 引流/🎬 案例）× 各自最终效果＝6 张卡，点哪张当场建篇
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            expect(page.locator('#dirBox')).to_contain_text('这一篇按哪个组合做？——点一张卡直接开工')
            assert page.locator('#dirBox [data-direff]').count() == 6, '六卡一页：三方向 × 各自最终效果'
            for card_txt in ('📚 知识', '🔥 引流', '🎬 案例', '思维导图图文', '字体动效视频', '真人口播', '文案直出视频', '图文笔记', '案例成片'):
                expect(page.locator('#dirBox')).to_contain_text(card_txt)
            expect(page.locator('#dirBox')).to_contain_text('✕ 先不建，回档案')
            check(page, '「✍️ 新建笔记」＝六卡一页：三方向 × 最终效果共 6 张卡，点一张直接开工（卡面与 demo 一致）')
            page.locator('#dirBox [data-direff="k|图文"]').click()
            expect(page.locator('#npWizBody')).to_be_visible()
            dir_note = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || [])[0] || null')
            assert dir_note and dir_note['dir'] == 'k' and dir_note['form'] == '图文' and dir_note['kOut'] == 'img' and dir_note['status'] == '草稿' and dir_note['title'] == '（还没定稿）', dir_note
            check(page, '点「🧠 思维导图图文」卡：当场建一篇草稿进档案（dir=k · form=图文 · kOut=img），并进这条路的工作流')
            kb_rows = [e for e in send(page, 'getKnowledgeBase')['entries']
                       if e.get('isActive') is not False and (str(e.get('title') or '').strip() or str(e.get('content') or '').strip())]
            expect(page.locator('.np-kbk')).to_have_count(len(kb_rows), timeout=15000)
            # 🔮 提名卡（六十六改 #28）：一条「没写过、所在类最薄」的条目＋「就用这条」一键勾上；📌 阶段计划行报
            #   当前阶段的知识发频与多发方面（与 发布台 · 🧬 读同一份 config.product.stagePlan）
            nom28 = page.evaluate('() => { const n = npKbNomOf(); return n ? { title: n.title, cat: n.cat } : null; }')
            assert nom28 and nom28['title'], '这几条知识里该有一条能被提名（没写过、所在类最薄）'
            expect(page.locator('#npWizBody')).to_contain_text('🔮 AI 提名：「' + nom28['title'] + '」')
            expect(page.locator('#npWizBody')).to_contain_text('「' + nom28['cat'] + '」')
            expect(page.locator('#npWizBody')).to_contain_text('正补薄')
            assert page.locator('#npWizBody .np-kb-nom').count() == 1
            plan28 = page.evaluate('''() => {
                const pkey = (NP_STAGES.indexOf(_npWiz.stageKey) >= 0) ? _npWiz.stageKey : 'cold';
                const kp = (_npWiz.stagePlan || {})[pkey] || npStagePlanDefaults(pkey);
                let pname = '';
                try { const s = (NotePlan.STAGES || []).filter(x => x.key === pkey)[0]; pname = s ? s.name : ''; } catch (_) {}
                return { pkey: pkey, pname: pname, k: String(kp.k || ''), kbCats: (kp.kbCats || []).join('、') };
            }''')
            assert plan28['pkey'] == 'cold' and plan28['pname'] == '冷启动期' and plan28['k'] == '常发' and plan28['kbCats'] == '免费测漏、材料保真', plan28
            expect(page.locator('#npWizBody')).to_contain_text('📌 按「冷启动期」的阶段计划：知识')
            expect(page.locator('#npWizBody')).to_contain_text('免费测漏、材料保真')
            expect(page.locator('#npWizBody')).to_contain_text('（在发布台 · 🧬 里改）')
            # 「就用这条」＝把提名的这条勾上（「已挑」出 chip），提名卡就此收起（kbNomUsed）
            page.locator('#npWizBody .np-kb-nom').click()
            assert page.evaluate('() => _npWiz.chosenKb.map(e => e.title)') == [nom28['title']]
            assert page.evaluate('() => _npWiz.kbNomUsed') is True
            assert page.locator('#npWizBody .np-kb-nom').count() == 0, '用过的提名卡要收起'
            expect(page.locator('#npWizBody')).to_contain_text('已挑（最多 3 条）：')
            assert page.locator('.np-kb-x').count() == 1
            # ✕ 拿掉：选择清空、清单那格也放掉；提名卡不回巢
            page.locator('.np-kb-x').click()
            assert page.evaluate('() => _npWiz.chosenKb.length') == 0
            assert page.locator('#npWizBody .np-kbk:checked').count() == 0
            assert page.locator('#npWizBody .np-kb-nom').count() == 0
            check(page, '🔮 挑知识提名卡＝从「没写过、所在类最薄」的那类里提名一条（报类别与补薄缘由）：「就用这条」一键勾上、卡片收起，✕ 拿掉不回巢；📌 阶段计划行报「冷启动期：知识 常发，多发免费测漏、材料保真」并指路发布台·🧬')
            # 知识线 ①（老板 2026-10-10 拍板）：挑知识是唯一主角——没有产品卖点折叠区；清单放开（报共 N 条、不套 220px 滚动）
            expect(page.locator('#npWizBody')).to_contain_text('📚 这篇讲哪条知识')
            expect(page.locator('#npWizBody')).to_contain_text('共 %d 条' % len(kb_rows))
            expect(page.locator('#npWizBody')).to_contain_text('1~3 条，讲透不贪多')
            expect(page.locator('#npWizBody')).to_contain_text('未点选素材测试条')
            assert page.locator('#npWizBody details.fdet').count() == 0, '产品卖点折叠区已撤——出稿时 AI 自动挑 1~2 个带进正文'
            assert page.locator('#npWizBody .np-spk').count() == 0, 'K 线挑知识页不再摆卖点勾选'
            kb_wrap_style = page.evaluate('''() => {
                const cb = document.querySelector('#npWizBody .np-kbk');
                let el = cb && cb.parentElement;
                while (el && el.tagName !== 'DIV') el = el.parentElement;
                return el ? (el.getAttribute('style') || '') : null;
            }''')
            assert kb_wrap_style is not None and 'max-height' not in kb_wrap_style, '挑知识清单放开：不该再套滚动框：%s' % kb_wrap_style
            check(page, '知识线 ①＝「挑知识」当主角：抬头📚这篇讲哪条知识报「共 N 条」、清单放开不套滚动；产品卖点折叠区已撤（出稿时 AI 从卖点里自动挑 1~2 个带进正文）')
            # 挑一条知识：勾它即记进本次选择、「下一步」当场放行——点下去直接出稿（二十九改撤了「定话题」站），
            # 「上一步」4 回 0 回挑知识站；✕ 拿掉重新禁上、再挑回来
            # 三十六改（老板 2026-10-10 拍板）：清单按 8 类收成堆——进门全收着，点开哪类看哪类
            grp_n = page.locator('#npWizBody .np-kb-grp').count()
            assert grp_n >= 2, '这么多条知识该按类收成几堆，只收到 %d 堆' % grp_n
            assert page.evaluate('() => String(_npKbOpenCat || "")') == '', '进门该全收着'
            assert page.locator('#npWizBody .np-kb-item:visible').count() == 0, '收着的时候条目一条不露'
            expect(page.locator('#npWizBody .np-kb-grp-ar').first).to_have_text('▸')
            pick_k = [i for i, e in enumerate(kb_rows) if e['title'] == '点选素材测试条'][0]
            kb_pick_click(page, pick_k)
            pick_cat = page.locator('.np-kbk[data-i="%d"]' % pick_k).evaluate('(el) => el.closest(".np-kb-item").getAttribute("data-cat")')
            assert page.evaluate('() => _npKbOpenCat') == pick_cat, '点类头摊开的该正是这条所在的类：%s' % pick_cat
            assert page.locator('#npWizBody .np-kb-item:visible').count() == \
                int(page.locator('.np-kb-grp[data-c="%s"]' % pick_cat).get_attribute('data-n')), '摊开的类要把这类全露出来'
            check(page, '挑知识清单按类收成堆：进门全收着（一条不露）、点类头摊开哪类看哪类（单开互斥、摊开即全露）')
            assert page.evaluate('() => _npWiz.chosenKb.map(e => e.title)') == ['点选素材测试条']
            expect(page.locator('.np-wiz-next')).to_be_enabled()   # 挑了知识，「下一步」要放行
            page.locator('.np-wiz-next').click()
            expect(page.locator('#npWizBody')).to_contain_text('⑤ 改稿', timeout=25000)   # 撤站后：挑了知识直接出稿
            assert page.evaluate('() => _npWiz.step') == 4, '挑完知识 → 直接到 ⑤ 改稿（「定话题」站已撤）'
            page.wait_for_function('() => _npWiz && _npWiz.draft && _npWiz.draft.content', timeout=25000)   # 等成稿落地（按钮复位才点得动「上一步」）
            # ③ K 线撤了挑卖点（老板 2026-10-10 拍板）：出稿请求把全部候选交给 AI 自己挑 1~2 个轻带——
            #    提示词 user 里带【候选卖点】段（含卖点库的「先试再选」）；界面上不再摆勾选（上一条 check 已验）
            _hit3 = [r for r in STATE['requests']
                     if any('【候选卖点（挑 1~2 个最贴这篇的自然轻带；都不合适就不带）】' in (m.get('content') or '')
                            for m in r.get('messages', []))]
            assert _hit3 and '先试再选' in json.dumps(_hit3[-1], ensure_ascii=False), 'K 线出稿请求该把卖点候选交给 AI（含卖点库的「先试再选」）'
            page.locator('.np-wiz-prev').click()   # k 线「上一步」＝4 回 0（不是 step-- 落到不存在的 1 站）
            expect(page.locator('#npWizBody')).to_contain_text('📚 这篇讲哪条知识', timeout=10000)
            assert page.evaluate('() => _npWiz.step') == 0
            expect(page.locator('#npWizBody')).to_contain_text('已挑（最多 3 条）：')
            expect(page.locator('.np-kb-x')).to_have_count(1)
            # ✕ 拿掉那条：chosenKb 清空、「下一步」亮着但点了弹提示、原地不动（守门软提示化）
            page.locator('.np-kb-x').click()
            assert page.evaluate('() => _npWiz.chosenKb.length') == 0
            expect(page.locator('.np-wiz-next')).to_be_enabled()
            page.locator('.np-wiz-next').click()
            expect(page.locator('#popToastBox')).to_contain_text('先挑 1~3 条知识')
            assert page.evaluate('() => _npWiz.step') == 0, '没挑知识点下一步不该走'
            kb_pick_click(page, pick_k)   # 挑回来（收在类堆里，先摊开再勾），后面接着走
            assert page.evaluate('() => _npWiz.chosenKb.map(e => e.title)') == ['点选素材测试条']
            check(page, '知识线挑知识：勾一条即记进本次选择、「下一步」常亮放行（二十九改：直出稿、没有②）；「上一步」4→0 回挑知识站并排已挑 chip；✕ 拿掉后点下一步＝toast「先挑 1~3 条知识」原地不动、再挑回来')
            # 六卡页页脚记「上次建的」；「✕ 先不建」不建篇、弹层收起
            page.locator('#tabNotePublish').click()
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            expect(page.locator('#dirBox')).to_contain_text('上次建的：📚 知识 · 图文笔记。')
            page.locator('#dirBox .np-dir-close').click()
            assert page.locator('#dirModal.open').count() == 0, '点了「先不建」弹层要收'
            notes_cnt = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || []).length')
            assert notes_cnt == 1, '「先不建」不许建篇：' + str(notes_cnt)
            check(page, '六卡页脚记「上次建的：📚 知识 · 图文笔记。」；「✕ 先不建」不建篇、弹层收起')
            # 🗂 档案列表（2026-10-10 老板拍板五点）：八列＝缩略图/篇目/方向/最终形式/内容/时间/状态/下一步——
            # 状态挪到行末（四色，可就地改）；操作列只剩一颗按钮：中间态＝「✏️ 编辑」（细粒度去向在 title）、走完＝「👀 预览」（本机存过片子的＝「🎬 成片预览」）
            row = page.locator('.npar-list .npar-row').nth(1)          # 第 0 行是表头
            expect(row).to_contain_text('📚 知识')                     # 方向那一格＝六卡选的那条路
            expect(row).to_contain_text('图文笔记')                    # 最终形式那一格＝🖼 图文笔记（六卡那份叫法）
            expect(row).to_contain_text('等的不是时间')                # 内容那一格：① 挑完知识已直出稿（二十九改），铺的是正文开头
            assert row.locator('.npar-next').count() == 1, '操作列收成一颗按钮'
            expect(row.locator('.npar-next')).to_have_text('✏️ 编辑')   # 出过稿但还没画面/口播料：中间态统一「编辑」
            assert row.locator('.npar-stsel').count() == 1, '状态＝行末那颗可就地改的下拉（四色）'
            assert page.locator('.npar-list .npar-edit, .npar-list .npar-task, .npar-list .npar-guide').count() == 0, '旧按钮要全撤'
            head = page.locator('.npar-list .npar-head').text_content()   # 用 text_content：窗口窄时 CSS 会隐藏「时间」列，inner_text 读不到
            cols = ('篇目', '方向', '最终形式', '内容（正文开头 / 已出哪些料）', '时间', '状态', '下一步')
            idxs = [head.find(c) for c in cols]
            assert all(i >= 0 for i in idxs), '表头缺列：%s' % head
            assert idxs == sorted(idxs), '列序该是 方向→最终形式→内容→时间→状态→下一步（状态挪行末）：%s' % head
            check(page, '档案列表＝方向＋最终形式＋一颗按钮（状态挪行末·四色可就地改）：中间态统一「✏️ 编辑」（去向在 title），旧按钮全撤')
            # ▶️ 下一步＝状态机（2026-10-10 老板拍板后收成两态）：给每一档「做到哪了」造一篇，回档案看那颗按钮对不对——
            #   中间态一律「✏️ 编辑」＋细粒度去向/进度在 title；走完＝「👀 预览」（本机存过片子的叫「🎬 成片预览」）；已归档＝dim 的「— 已归档」
            now_ms = int(time.time() * 1000)
            matrix = [
                ('tm1', '矩阵·知识图文没导图', '✏️ 编辑', '导图工作区', {'dir': 'k', 'form': '图文', 'kOut': 'mind', 'voice': '样例稿子'}),
                ('tm2', '矩阵·知识图文导图结构已有图未出', '✏️ 编辑', '导图工作区', {'dir': 'k', 'form': '图文', 'voice': '样例稿子', 'mind': {'md': '# 中心\n## 主干'}}),
                ('tm2c', '矩阵·知识图文导图长图已出', '👀 预览', '导图长图已出', {'dir': 'k', 'form': '图文', 'voice': '样例稿子', 'imgDocs': [{'id': 'tm2c-mind', 'kind': 'mind', 'img': 'data:image/png;base64,AA'}]}),
                ('tm3', '矩阵·图文还没进过出图', '✏️ 编辑', '接着出这一套', {'dir': 'd', 'form': '图文', 'dOut': 'img', 'voice': '样例稿子'}),
                ('tm4', '矩阵·图文还缺三张', '✏️ 编辑', '还缺 3 张', {'dir': 'd', 'form': '图文', 'dOut': 'img', 'voice': '样例稿子', 'imgDocs': [{'id': 'td1', 'shots': {'total': 3}}]}),
                ('tm5', '矩阵·视频没进字效', '✏️ 编辑', '进字效', {'dir': 'k', 'form': '视频', 'voice': '样例稿子'}),
                ('tm6', '矩阵·视频有分幕没出片', '✏️ 编辑', '▶️ 出片', {'dir': 'k', 'form': '视频', 'voice': '样例稿子'}),
                ('tm7', '矩阵·视频片已出', '🎬 成片预览', '片已出', {'dir': 'k', 'form': '视频', 'voice': '样例稿子'}),
                ('tm8', '矩阵·引流视频没拆段', '✏️ 编辑', '拆成几段', {'dir': 'd', 'form': '视频', 'voice': '样例稿子'}),
                ('tm9', '矩阵·引流视频待拼片', '✏️ 编辑', '拼片配音', {'dir': 'd', 'form': '视频', 'voice': '样例稿子', 'dgen': {'segs': [{'text': '一句', 'done': True}]}}),
                ('tm10', '矩阵·引流视频已拼好', '🎬 成片预览', '片已出', {'dir': 'd', 'form': '视频', 'voice': '样例稿子', 'dgen': {'segs': [{'text': '一句', 'done': True}]}}),
                ('tm11', '矩阵·口播稿', '👀 预览', '口播稿已出', {'dir': 'k', 'form': '口播稿', 'voice': '样例口播稿'}),
                ('tm12', '矩阵·已发', '👀 预览', '发完了', {'status': '已发', 'dir': 'k', 'form': '图文', 'voice': '样例稿子'}),
                ('tm13', '矩阵·已归档', None, '', {'status': '已归档', 'dir': 'k', 'form': '图文', 'voice': '样例稿子'}),
                ('tm14', '矩阵·案例待做片', '✏️ 编辑', '丢素材', {'dir': 'c', 'form': '案例成片'}),
                ('tm14b', '矩阵·案例剪了一半', '✏️ 编辑', '接着剪', {'dir': 'c', 'form': '案例成片',
                    'asm': {'mats': [{'id': 'm1', 'name': '样例.mp4', 'dur': 10, 'segs': [{'a': 0, 'b': 50}]}]}}),
                ('tm15', '矩阵·案例片已成', '🎬 成片预览', '成片已存', {'dir': 'c', 'form': '案例成片',
                    'asm': {'mats': [{'id': 'm1', 'name': '样例.mp4', 'dur': 10, 'segs': [{'a': 0, 'b': 50, 'done': True}]}],
                            'film': {'name': '样例成片', 'dur': 5, 'at': now_ms}}}),
            ]
            matrix_notes = []
            for mid, mtitle, lab, _tip, extra in matrix:
                mm = {'id': mid, 'title': mtitle, 'status': '草稿', 'dir': 'old', 'form': '图文', 'voice': '', 'updatedAt': now_ms}
                mm.update(extra)
                matrix_notes.append(mm)
            worker.evaluate('''async (data) => {
                const d = await chrome.storage.local.get("np_notes");
                await chrome.storage.local.set({ np_notes: (d.np_notes || []).concat(data.notes) });
                const f = await chrome.storage.local.get("xhsFilmDocs");
                const m = (f.xhsFilmDocs || {});
                Object.assign(m, data.films);
                await chrome.storage.local.set({ xhsFilmDocs: m });
            }''', {'notes': matrix_notes, 'films': {
                'tm6': {'script': '样例稿子', 'scenes': [{'t': '一句'}], 'cfg': {}, 'voice': '', 'rate': 1, 'outAt': 0},
                'tm7': {'script': '样例稿子', 'scenes': [{'t': '一句'}], 'cfg': {}, 'voice': '', 'rate': 1, 'outAt': now_ms},
                'tm10': {'script': '样例稿子', 'scenes': [], 'cfg': {}, 'voice': '', 'rate': 1, 'outAt': now_ms},
            }})
            page.locator('#tabNotePublish').click()            # 同 tab 再点＝重渲染（switchMainTab 每次切入都重画）
            for mid, mtitle, lab, tipkw, _ in matrix:
                mrow = page.locator('.npar-list .npar-row', has_text=mtitle)
                expect(mrow).to_have_count(1, timeout=15000)
                if lab is None:
                    assert mrow.locator('.npar-next').count() == 0, '已归档不给「下一步」按钮'
                    expect(mrow).to_contain_text('— 已归档')
                else:
                    btn = mrow.locator('.npar-next')
                    expect(btn).to_have_text(lab)
                    tip = btn.get_attribute('title') or ''
                    assert tipkw in tip, '%s：title 该含「%s」，实际「%s」' % (mtitle, tipkw, tip)
            check(page, '▶️ 下一步＝状态机十七档逐一走对（中间态一律「✏️ 编辑」：导图工作区 / 接着出这一套·还缺 3 张 / 进字效·▶️ 出片 / 拆成几段·拼片配音 / 丢素材·接着剪；走完的预览分两档：「🎬 成片预览」（片已出 / 成片已存，点开能看片再下一遍）与「👀 预览」（导图长图已出 / 口播稿已出 / 发完了）；已归档＝dim「— 已归档」）')
            # 清场：矩阵篇撤掉，回到「只有六卡那一篇」，接着走「下一步 → 写稿」
            worker.evaluate('''async (ids) => {
                const d = await chrome.storage.local.get("np_notes");
                await chrome.storage.local.set({ np_notes: (d.np_notes || []).filter(n => ids.indexOf(n.id) < 0) });
                const f = await chrome.storage.local.get("xhsFilmDocs");
                const m = (f.xhsFilmDocs || {});
                ids.forEach(k => { delete m[k]; });
                await chrome.storage.local.set({ xhsFilmDocs: m });
            }''', [mid for mid, _, _, _, _ in matrix])
            page.locator('#tabNotePublish').click()            # 重渲染，只剩六卡那一篇
            # 🧩 知识线三张卡各走通一遍（六卡建的 dir='k'：🧠 图文→导图长图 / ✨ 视频→进字效 / 🎙 口播稿→收稿回档案）
            def drive_ktalk(what):
                # 二十九改撤站后：出过稿的篇重开会直落 ⑤（wip.step 收到 4）——先回 ① 再走
                if page.locator('#npWizBody .np-kbk').count() == 0:
                    page.locator('.np-wiz-prev').click()
                expect(page.locator('.np-kbk')).to_have_count(len(kb_rows), timeout=15000)   # ①：等知识清单摆出来
                cb_k = page.locator('.np-kbk[data-i="%d"]' % pick_k)   # 已挑过的（回开的篇）别再点——点了会把这条放掉
                if not cb_k.is_checked():
                    kb_pick_click(page, pick_k)   # 收在类堆里：先点类头摊开再勾
                assert page.evaluate('() => _npWiz.chosenKb.length') >= 1, what
                page.locator('.np-wiz-next').click()   # 撤站后：挑完知识直接出稿，没有「定话题」这一脚
                expect(page.locator('#npWizBody')).to_contain_text('⑤ 改稿', timeout=20000)
                page.wait_for_function('() => _npWiz && _npWiz.draft && _npWiz.draft.content', timeout=25000)
                assert '闭水试验那 48 小时' in page.evaluate('() => _npWiz.draft.content'), what
            # 卡1·🧠 图文：重开这一篇（✏️ 编辑 → 知识线两站），走通到出导图长图
            row1 = page.locator('.npar-list .npar-row', has_text='闭水试验那 48 小时')
            expect(row1).to_have_count(1, timeout=15000)
            expect(row1.locator('.npar-next')).to_have_text('✏️ 编辑')
            row1.locator('.npar-next').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            expect(page.locator('#npSteps')).to_contain_text('🧠 出导图', timeout=15000)   # 步骤条到位（等一次渲染）
            steps_k1 = page.locator('#npSteps').inner_text()
            for lab in ('挑知识', '改稿', '🧠 出导图', '发布'):
                assert lab in steps_k1, f'知识线步骤条缺「{lab}」：{steps_k1}'
            for lab in ('定话题', '人群', '挑稿', '自己拍发布', '✨ 出片'):
                assert lab not in steps_k1, f'知识线（图文）不该有「{lab}」：{steps_k1}'
            drive_ktalk('卡1 图文')
            # ⑤ → 回 ① 再回来（二十九改：k 线「上一步」＝4 回 0，跳空站才是 bug）：回来成稿还在、不重烧
            req_prev = len(STATE['requests'])
            page.locator('.np-wiz-prev').click()
            expect(page.locator('#npWizBody')).to_contain_text('📚 这篇讲哪条知识', timeout=10000)
            assert page.evaluate('() => _npWiz.step') == 0
            page.locator('.np-wiz-next').click()
            expect(page.locator('#npWizBody')).to_contain_text('⑤ 改稿', timeout=10000)
            assert page.evaluate('() => _npWiz.step') == 4
            assert len(STATE['requests']) == req_prev, '成稿还在，回 ① 再过来不许重烧'
            # ✏️ 换个写法重写（#22）：题与站都不动，这条线的写法轮下一格，就地在 ⑤ 重烧一版
            rot = page.evaluate('''() => {
                const now = npWritePickNow(_npWiz);
                const t = NotePlan.typeOf(now.type);
                const kinds = NotePlan.kindsOfType(t.key) || [];
                const i = kinds.map(k => k.key).indexOf(now.kind);
                const nx = kinds[(i + 1) % kinds.length];
                return { from: String(now.kind || ''), tName: String(t.name || ''),
                         next: String((nx || {}).key || ''), name: String((nx || {}).name || ''), step: _npWiz.step };
            }''')
            assert rot['next'] and rot['next'] != rot['from'], rot
            req0 = len(STATE['requests'])
            page.locator('#npKRewrite').click()
            page.wait_for_function('() => _npWiz && _npWiz.write && _npWiz.write.kind === %s' % json.dumps(rot['next']), timeout=15000)
            t0 = time.time()
            while time.time() - t0 < 20 and len(STATE['requests']) == req0:
                page.wait_for_timeout(200)
            assert len(STATE['requests']) > req0, '换写法没重烧（一发 AI 都没烧）'
            sys_new = next((r['messages'][0]['content'] for r in STATE['requests'][req0:]
                            if '这一篇是「' in r['messages'][0]['content']), '')
            assert '「' + rot['tName'] + ' · ' + rot['name'] + '」' in sys_new, \
                '重烧那一发要按轮到的写法（%s · %s）写：%s' % (rot['tName'], rot['name'], sys_new[:160])
            assert page.evaluate('() => _npWiz.step') == rot['step'], '换写法原地重烧，不许跳站'
            assert '⑤ 改稿' in page.locator('#npWizBody').inner_text()
            check(page, '知识线·✏️ 换个写法重写：题与站不动，写法轮下一格（%s → %s），就地在 ⑤ 重烧一版' % (rot['from'], rot['next']))
            # 🎲 换个角度重写（二十九改）：撤站后 AI 自挑角度出稿，角度不对的出口——站不动，把上一版开头
            #   喂给写手当"别再这么写"，就地在 ⑤ 重烧一版；喂过即清，不粘住之后的每次出稿
            page.wait_for_function('() => !_npDraftBusy', timeout=15000)
            req_g = len(STATE['requests'])
            page.locator('#npKAngle').click()
            t0 = time.time()
            while time.time() - t0 < 20 and len(STATE['requests']) == req_g:
                page.wait_for_timeout(200)
            assert len(STATE['requests']) > req_g, '换角度没重烧（一发 AI 都没烧）'
            sys_g = next((r['messages'][0]['content'] for r in STATE['requests'][req_g:]
                          if '换一个角度重写' in r['messages'][0]['content']), '')
            assert '闭水试验那 48 小时' in sys_g, \
                '换角度那一发要把上一版开头带进 system 当"别再这么写"：%s' % sys_g[:160]
            assert page.evaluate('() => _npWiz.step') == 4, '换角度原地重烧，不许跳站'
            assert page.evaluate('() => String(_npWiz.kAvoidDraft || "")') == '', '上一版开头喂过一发就该清'
            check(page, '知识线·🎲 换个角度重写：同一条知识换切入角度就地重烧（上一版开头进 system 当"别再这么写"、喂完即清）')
            page.locator('.np-k-fin-img').click()
            # 🧠 导图工作区（三十六改）：进门种子先落档 → AI 自动出结构＝第 2 版（手改过的不再自动覆盖）；
            #   📄 正文卡摆着这篇正文（跟着正文改 MD）；✨ AI 再出＝第 3 版；跟 AI 说一句改＝第 4 版
            expect(page.locator('#noteMindContent')).to_be_visible(timeout=15000)
            # 进门自动烧：等它烧完（版号到 2、src=ai、不在忙）；只烧这一版，多种子不重烧
            page.wait_for_function('() => _npMind && !_npMind.aiBusy && _npMind.src === "ai" && _npMind.ver >= 2', timeout=25000)
            assert page.evaluate('() => _npMind.ver') == 2, '进门只该自动烧一版＝第 2 版'
            assert page.evaluate('() => String(_npMind.md || "")').startswith('# 闭水试验 48 小时')
            assert page.evaluate('() => _npMind.src') == 'ai'
            assert page.evaluate('() => !!_npMind.stale') is False, '刚出完结构不该挂着「⚡ 正文改了」'
            check(page, '导图进门自动烧：机械种子先进档（第 1 版）→ AI 自动出结构＝第 2 版（md 换成 AI 版、src=ai、不挂「按新稿重出」）；老档/手改过的不被自动覆盖（src 门控）')
            # 📄 正文卡：进门默认摊开、摆着这篇的正文（对着正文改 MD）；点卡头可收可摊
            expect(page.locator('.np-mind-doc-box')).to_be_visible()
            assert '闭水试验那 48 小时' in page.locator('.np-mind-doc-box').inner_text()
            page.locator('.np-mind-doc-head').click()
            assert page.evaluate('() => _npMind.docOpen') is False
            expect(page.locator('.np-mind-doc-box')).to_be_hidden()
            page.locator('.np-mind-doc-head').click()
            expect(page.locator('.np-mind-doc-box')).to_be_visible()
            check(page, '导图工作区·📄 正文卡：进门默认摊开摆着这篇正文（对着正文改 MD），点卡头可收可摊')
            # ✨ AI 再出一版＝第 3 版；跟 AI 说一句就地改＝第 4 版
            page.locator('.np-mind-redistill').click()
            expect(page.locator('#npMindVer')).to_contain_text('第 3 版', timeout=15000)
            assert page.evaluate('() => String(_npMind.md || "")').startswith('# 闭水试验 48 小时')
            page.locator('.np-mind-aiin').fill('第二支再细一层')
            page.locator('.np-mind-aigo').click()
            expect(page.locator('#npMindVer')).to_contain_text('第 4 版', timeout=15000)
            assert page.evaluate('() => String(_npMind.md || "")').startswith('# 改过的闭水试验')
            assert page.evaluate('() => _npMind.src') == 'ai'
            # 竖式画布：5 主干各带 2 分支量出来必须高过 1440（旧三列版会截断第 4 根、且画布写死 1440）
            dims = page.evaluate('''() => {
              const cv = document.createElement('canvas'); cv.width = 1080;
              const old = _npMind.md;
              _npMind.md = '# 中心\\n## 坑一\\n- a1\\n- a2\\n## 坑二\\n- b1\\n- b2\\n## 坑三\\n- c1\\n- c2\\n## 坑四\\n- d1\\n- d2\\n## 坑五\\n- e1\\n- e2\\n';
              npMindPaint(cv, 2);
              const out = { w: cv.width, h: cv.height };
              _npMind.md = old;
              return out;
            }''')
            assert dims['w'] == 1080 and dims['h'] > 1440, dims
            page.locator('.np-mind-export').click()
            expect(page.locator('.npar-list')).to_be_visible(timeout=15000)
            row_mind = page.locator('.npar-list .npar-row', has_text='闭水试验那 48 小时')
            expect(row_mind).to_have_count(1, timeout=15000)
            expect(row_mind.locator('.npar-next')).to_have_text('👀 预览')
            expect(row_mind).to_contain_text('🧠 导图')
            expect(row_mind).to_contain_text('🎙 口播稿')
            n1 = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', dir_note['id'])
            assert n1 and n1['status'] == '代发' and n1['form'] == '图文', n1
            assert n1['imgDocs'] and n1['imgDocs'][0]['kind'] == 'mind' and str(n1['imgDocs'][0].get('img') or '').startswith('data:image/png'), n1.get('imgDocs')
            assert str((n1.get('mind') or {}).get('md') or '').startswith('# 改过的闭水试验'), n1.get('mind')
            assert (n1.get('mind') or {}).get('ver') == 4 and (n1.get('mind') or {}).get('src') == 'ai' \
                and str((n1.get('mind') or {}).get('sig') or ''), '导图落档要带 版号/src/正文指纹：%s' % n1.get('mind')
            assert '闭水试验那 48 小时' in str(n1.get('voice') or '')
            check(page, '知识线·🧠 图文卡走通：① 挑知识（按类收堆·摊开再勾）→ 直出稿 → ⑤ 改稿（上一步 4→0 不落空站）→ 导图工作区（进门自动烧＝第 2 版、📄 正文卡摊着正文、AI 再出＝第 3 版、AI 改＝第 4 版）→ 竖式长图 1080 宽、高随内容（5 主干量高 >1440）：档案标「代发」+ imgDocs 认导图 + mind 留档（md/ver/src/sig）（下一步＝👀 预览）')
            # 卡2·✨ 视频：新建这一篇（kOut=film），走通到进字效（片台让开＝#filmGate 收起、#filmBar 亮出）
            page.locator('#tabNotePublish').click()
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            page.locator('#dirBox [data-direff="k|视频"]').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            note2 = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || [])[0] || null')
            assert note2 and note2['dir'] == 'k' and note2['kOut'] == 'film' and note2['form'] == '视频' and note2['title'] == '（还没定稿）', note2
            expect(page.locator('#npSteps')).to_contain_text('✨ 出片', timeout=15000)
            steps_k2 = page.locator('#npSteps').inner_text()
            for lab in ('挑知识', '改稿', '✨ 出片', '发布'):
                assert lab in steps_k2, f'知识线（视频）步骤条缺「{lab}」：{steps_k2}'
            for lab in ('定话题', '人群', '挑稿', '自己拍发布', '🧠 出导图'):
                assert lab not in steps_k2, f'知识线（视频）不该有「{lab}」：{steps_k2}'
            drive_ktalk('卡2 视频')
            page.locator('.np-k-fin-film').click()
            expect(page.locator('#filmBar')).to_be_visible(timeout=15000)
            expect(page.locator('#filmGate')).to_be_hidden()
            assert page.evaluate('() => _npFilmNote && _npFilmNote.kind') == 'PPT字体动效'
            n2 = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', note2['id'])
            assert n2 and n2['status'] == '代发' and n2['form'] == '视频' and n2['kOut'] == 'film' and n2['filmKind'] == 'PPT字体动效', n2
            assert n2['filmDocs'] and n2['filmDocs'][0]['kind'] == 'PPT字体动效', n2.get('filmDocs')
            assert '闭水试验那 48 小时' in str(n2.get('voice') or '')
            check(page, '知识线·✨ 视频卡走通：挑知识 → 直出稿 → 改稿 → 「进字效出片」：片台盖板收、#filmBar 亮出（本机出片档 PPT字体动效），档案标「代发」+ filmDocs 排片')
            # 卡3·🎙 口播稿：新建这一篇（kOut=voice），走通到收稿回档案
            page.locator('#tabNotePublish').click()
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            page.locator('#dirBox [data-direff="k|口播稿"]').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            note3 = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || [])[0] || null')
            assert note3 and note3['dir'] == 'k' and note3['kOut'] == 'voice' and note3['form'] == '口播稿' and note3['title'] == '（还没定稿）', note3
            expect(page.locator('#npSteps')).to_contain_text('🎙 自己拍发布', timeout=15000)
            steps_k3 = page.locator('#npSteps').inner_text()
            for lab in ('挑知识', '改稿定稿', '🎙 自己拍发布'):
                assert lab in steps_k3, f'知识线（口播稿）步骤条缺「{lab}」：{steps_k3}'
            for lab in ('定话题', '人群', '挑稿', '🧠 出导图', '✨ 出片'):
                assert lab not in steps_k3, f'知识线（口播稿）不该有「{lab}」：{steps_k3}'
            drive_ktalk('卡3 口播稿')
            page.locator('.np-k-fin-voice').click()
            expect(page.locator('.npar-list')).to_be_visible(timeout=15000)
            n3 = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', note3['id'])
            assert n3 and n3['status'] == '代发' and n3['form'] == '口播稿' and n3['kOut'] == 'voice', n3
            assert '闭水试验那 48 小时' in str(n3.get('voice') or '')
            check(page, '知识线·🎙 口播稿卡走通：挑知识 → 直出稿 → 改稿定稿 → 「收好口播稿，回档案」：档案标「代发」+ form=口播稿 + 稿子进 voice')
            # 🔥 引流行（六卡建 dir='d'）：③ 挑稿＝AI 照行业＋料池出 18 版（六类料每类 3 版）→ 挑一篇 → 改稿（转法硬约束）
            #   → 出口「🎬 拆段出词」→ 写稿⑤站：AI 按重点拆 3 段（全 ✅ 拼片）→ 回档案（下一步＝🎬 成片预览）
            worker.evaluate('''async (data) => {
                const d = await chrome.storage.local.get("np_notes");
                const list = (d.np_notes || []);
                list.unshift(data.note);
                await chrome.storage.local.set({ np_notes: list });
            }''', {'note': {'id': 'drain-hist', 'title': '旧引流稿·屋顶渗水那篇', 'status': '已发', 'dir': 'd', 'dOut': 'img', 'form': '图文', 'voice': '', 'draft': '', 'titles': [], 'tags': [], 'updatedAt': now_ms}})
            drain_before = len(STATE['requests'])
            page.locator('#tabNotePublish').click()
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            page.locator('#dirBox [data-direff="d|视频"]').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            dnote = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || [])[0] || null')
            assert dnote and dnote['dir'] == 'd' and dnote['dOut'] == 'film' and dnote['form'] == '视频' and dnote['title'] == '（还没定稿）', dnote
            expect(page.locator('#npSteps')).to_contain_text('挑稿', timeout=15000)
            steps_d = page.locator('#npSteps').inner_text()
            for lab in ('挑稿', '改稿', '🎬 拆段出词', '拼片配音', '发布'):
                assert lab in steps_d, f'引流线步骤条缺「{lab}」：{steps_d}'
            for lab in ('挑知识', '人群', '🧠 出导图'):
                assert lab not in steps_d, f'引流线步骤条不该有「{lab}」：{steps_d}'
            # ③：出稿器分 3 批发（六类分 2 类一批）→ 18 台料稿摆出来；查重徽只挂与历史稿相近的那一版
            expect(page.locator('#npWizBody .npPhone')).to_have_count(18, timeout=90000)
            drain_reqs = [r for r in STATE['requests'][drain_before:] if '料 → 转 → 专业' in r['messages'][0]['content']]
            assert len(drain_reqs) == 3, f'出稿器应发 3 批（六类分 2 类一批），实际 {len(drain_reqs)}'
            sys0 = drain_reqs[0]['messages'][0]['content']
            assert '通篇不带产品' in sys0 and '零承接' in sys0, '出稿提示词要压住「通篇不卖、零承接」'
            u0 = drain_reqs[0]['messages'][1]['content']
            assert '1. 🔥 热点' in u0 and '2. 😹 热梗' in u0, '第一批＝热点＋热梗'
            u2 = drain_reqs[2]['messages'][1]['content']
            assert '1. 🎯 被生活打了一下' in u2 and '2. 🏘 本地感悟' in u2, '最后一批排到「被生活打了一下＋本地感悟」'
            assert '【已发过的选题清单' in u0 and '旧引流稿·屋顶渗水那篇' in u0, '出稿前要把历史引流稿的选题清单喂给 AI 规避'
            expect(page.locator('#npWizBody .npPhoneScreen[style*="dashed"]')).to_have_count(1)
            expect(page.locator('#npWizBody .npPhoneScreen[style*="dashed"]')).to_contain_text('⚠ 与')
            # 挑一篇：这版记进档案（草稿）、正文当改稿底稿、转法那句进改稿当硬约束
            pick0 = page.evaluate('''() => {
                const b = document.querySelector('#npWizBody .np-drain-pick');
                const di = parseInt(b.getAttribute('data-i'), 10);
                const v = _npWiz.drainVariants[di];
                return { di: di, cat: v.cat, title: v.title, line: v.line, turn: v.turn, body: v.body };
            }''')
            page.locator('#npWizBody .np-drain-pick').first.click()
            expect(page.locator('#npWizBody')).to_contain_text('转法那句', timeout=10000)
            dp = page.evaluate('() => ({ step: _npWiz.step, pick: _npWiz.drainPick, content: (_npWiz.draft || {}).content || "" })')
            assert dp['step'] == 4 and dp['pick']['cat'] == pick0['cat'] and dp['pick']['title'] == pick0['title'] and dp['pick']['turn'] == pick0['turn'], dp
            assert dp['content'] == pick0['body'], '挑中那版的正文要是改稿页的底稿'
            assert pick0['turn'] in page.locator('#npWizBody').inner_text(), '转法那句要摆在改稿页当硬约束'
            pl = page.evaluate('() => npRevisePayload(_npWiz, {})')
            assert pl['talkKey'] == 'none' and pl['drainTurn'] == pick0['turn'] and pl['drainLine'] == pick0['line'], pl
            assert pl['sellPoint'] == '' and pl['planItem'] is None and pl['topic'] == pick0['title'], pl
            # 出口「🎬 拆段出词」→ 写稿⑤站：AI 按重点拆 3 段（重点卡＋每段贴豆包提示词），三段都 ⬆ 传回来才能拼片——
            #   守门按钮常亮，没传齐点了弹提示（老板 2026-10-10：别摆禁用符号）
            page.locator('.np-d-fin-film').click()
            page.wait_for_function('() => _npWiz && _npWiz.step === 5 && _npWiz.dOut === "film"')
            expect(page.locator('.np-dv-prompt')).to_have_count(3, timeout=30000)
            expect(page.locator('.np-dv-asm')).to_be_enabled()
            page.locator('.np-dv-asm').click()
            expect(page.locator('#popToastBox')).to_contain_text('还有段没传回来')
            assert page.evaluate('() => _npWiz.dgen.segs.every(s => !s.done)')
            # 三段「豆包导出的片段」用 ffmpeg 现造（真 mp4、时长有限——拼片那步要读得到 duration），一段一格传回来
            ff_d = shutil.which('ffmpeg')
            assert ff_d, '自检需要 ffmpeg 造片段（拼片链路要真 mp4）'
            for i, col in enumerate(('0x123A2B', '0x2B1A3A', '0x3A2B1A')):
                segf = out / ('dvseg%d.mp4' % (i + 1))
                subprocess.run([ff_d, '-y', '-f', 'lavfi', '-i', 'color=c=%s:s=320x568:d=0.9:r=24' % col,
                                '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', str(segf)],
                               check=True, capture_output=True)
                page.locator('.np-dv-file[data-i="%d"]' % i).set_input_files(str(segf))
                page.wait_for_function('() => _npWiz.dgen.segs[%d].done' % i)
            # 配音走 Edge 免费口子——这里桩掉（不联网，走无声容忍），只验真录真存的落档
            page.evaluate('() => { EdgeTTS.synth = async () => { throw new Error("自检：配音桩"); }; }')
            page.locator('.np-dv-asm').click()
            # 拼片（真录一遍）→ 回档案：这篇标「代发」、排一行「文案直出视频」的片、下一步＝🎬 成片预览
            expect(page.locator('.npar-list')).to_be_visible(timeout=120000)
            nd = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', dnote['id'])
            assert nd and nd['status'] == '代发' and nd['form'] == '视频' and nd['title'] == pick0['title'], nd
            assert nd['filmDocs'] and nd['filmDocs'][0]['kind'] == '文案直出视频', nd.get('filmDocs')  # 三十一改落档名＝文案直出视频（gen:true）
            assert nd['dgen'] and len(nd['dgen']['segs']) == 3 and all(c.get('done') for c in nd['dgen']['segs']), nd.get('dgen')
            assert pick0['body'] in str(nd.get('voice') or ''), '定稿时正文要编进 voice'
            fd = worker.evaluate('async (id) => (((await chrome.storage.local.get("xhsFilmDocs")).xhsFilmDocs) || {})[id] || null', dnote['id'])
            assert fd and fd['script'] == pick0['body'], fd
            row_d = page.locator('.npar-list .npar-row', has_text=pick0['title'])
            expect(row_d).to_have_count(1, timeout=15000)
            expect(row_d.locator('.npar-next')).to_have_text('🎬 成片预览')
            check(page, '引流行·🎬 视频卡走通：六卡建篇 → ③ 挑稿（3 批 6 类×3 版＝18 台；查重两层：历史清单喂 AI＋撞相近挂 ⚠）→ 挑中进改稿（转法硬约束 + 话术「不提产品」）→「🎬 拆段出词」＝写稿⑤站按重点拆 3 段配提示词（三段都「⬆ 传回来」才能拼片，没传齐点了弹提示，不摆禁用符号）→ 档案标「代发」+ filmDocs 排「文案直出视频」（下一步＝🎬 成片预览）')
            # 🖼 引流·图文卡：同一套挑稿页，改稿页出口换「🖋 拆分镜，标成「代发」」——不切页，
            #   原地进写稿 ⑤ 站「🖋 分镜确认」（三十改：造图片并进写稿流；提示词一张张复制去生成、图传回格子）
            page.locator('#tabNotePublish').click()
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            page.locator('#dirBox [data-direff="d|图文"]').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            dnote2 = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || [])[0] || null')
            assert dnote2 and dnote2['dir'] == 'd' and dnote2['dOut'] == 'img' and dnote2['form'] == '图文' and dnote2['title'] == '（还没定稿）', dnote2
            expect(page.locator('#npWizBody .npPhone')).to_have_count(18, timeout=90000)
            page.locator('#npWizBody .np-drain-pick').first.click()
            expect(page.locator('#npWizBody')).to_contain_text('转法那句', timeout=10000)
            page.locator('.np-d-fin-img').click()
            page.wait_for_function('() => _npWiz && _npWiz.step === 5 && _npWiz.dOut === "img"')
            assert page.locator('#noteOutputContent').is_hidden(), '三十改：改完稿不切去造图片页，原地进 ⑤'
            expect(page.locator('#popToastBox')).to_contain_text('标成「代发」', timeout=10000)
            steps_d2 = page.locator('#npSteps').inner_text()
            for lab in ('挑稿', '改稿', '🖋 分镜确认', '👀 预览', '发布'):
                assert lab in steps_d2, f'图文线五站条缺「{lab}」：{steps_d2}'
            assert '断句' not in steps_d2, '断句站已整个去掉（分镜＝带重点的断句）'
            body5 = page.locator('#npWizBody').inner_text()
            assert '生成前定一次' in body5 and '画面风格' in body5 and '配文方式' in body5, body5[:300]
            assert page.locator('#npWizBody .np-dsh-gen').count() == 1, '还没切过＝摆「🧠 生成分镜」入口'
            nd2 = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', dnote2['id'])
            assert nd2 and nd2['status'] == '代发' and nd2['form'] == '图文' and nd2['dOut'] == 'img', nd2
            # ⑤ 站生成分镜：走后台 genNoteShots 那一发（桩服务器照契约切 3 屏）——5 列表格铺开、落进档案 imgDocs
            page.locator('#npWizBody .np-dsh-gen').click()
            page.wait_for_function('() => document.querySelectorAll(".np-dsh-set").length === 9', timeout=30000)
            assert page.locator('.np-dsh-prompt').count() == 3 and page.locator('.np-dsh-copy').count() == 3
            assert page.evaluate('() => _npWiz.shots.items.map(x => x.role).join("/")') == '开场/展开/收束'
            nd2b = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', dnote2['id'])
            doc0 = ((nd2b or {}).get('imgDocs') or [None])[0] or {}
            items2b = ((doc0.get('shots') or {}).get('items')) or []
            assert nd2b and nd2b['status'] == '代发' and len(items2b) == 3, (nd2b or {}).get('imgDocs')
            check(page, '引流行·🖼 图文卡走通：同一套 18 台挑稿 → 挑一篇 → 改稿 → 「🖋 拆分镜，标成「代发」」＝不切页、原地进写稿 ⑤「🖋 分镜确认」（点「🧠 生成分镜」切出 3 屏 → 5 列表格落档 imgDocs；断句站已去掉）')
            # 🚶 老路放行：六卡之前的老笔记（dir='old'）点开＝原六步向导，一切照旧
            worker.evaluate('''async (data) => {
                const d = await chrome.storage.local.get("np_notes");
                const list = (d.np_notes || []);
                list.unshift(data.note);
                await chrome.storage.local.set({ np_notes: list });
            }''', {'note': {'id': 'flow-old', 'title': '老路测试篇', 'status': '草稿', 'dir': 'old', 'form': '图文', 'voice': '', 'draft': '', 'titles': [], 'tags': [], 'updatedAt': now_ms}})
            page.locator('#tabNotePublish').click()
            row_old = page.locator('.npar-list .npar-row', has_text='老路测试篇')
            expect(row_old).to_have_count(1, timeout=15000)
            expect(row_old.locator('.npar-next')).to_have_text('✏️ 编辑')
            row_old.locator('.npar-next').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            expect(page.locator('#npWizBody .np-spk').first).to_be_visible(timeout=15000)   # ① 的卖点拉回来（顺带把这一发等完，后面计数不受它干扰）
            # ④ 挑稿（四十五改）＝先用「🔀 内容类型（五条线）」换线，进页自动把这条线底下的几种写法各写一篇，点中哪篇挑哪篇；
            #   📐 篇幅配比与 🖋 字数的账号默认挂在「发笔记 → 任务配置 → 内容基调」那几张卡上，这里只剩 🎚 广告占比 / 🖋 字数两个「就改这一条」的旋钮
            stepbar = page.locator('#npSteps').inner_text()
            for lab in ('卖点', '人群', '话题', '挑稿', '改稿', '发稿'):
                assert lab in stepbar, f'六步条缺「{lab}」：{stepbar}'
            check(page, '🚶 老路篇（六卡之前的老笔记）照旧放行：点开＝原六步向导（卖点/人群/话题/挑稿/改稿/发稿），不动新流程')
            # 底子：③ 里 AI 按题判的那条线（情绪线），没有排产项；先清干净，进 ④ 才是确定行为
            var_before = len(STATE['requests'])   # ★ 先记基线：这一渲染就会自动烧那发 AI
            page.evaluate('''() => { _npWiz.step = 3; _npWiz.planItem = null; _npWiz.write = null;
                _npWiz.topics = [{ topic: '先别急着发笔记', type: 'echo', kind: 'hidden' }]; _npWiz.chosenTopicIdx = 0;
                _npWiz.variants = null; _npWiz.variantsError = ''; _npWiz.variantsKey = ''; _npWiz.variantsSig = ''; _npWiz.picked = null;
                _npWiz.noteStyle = {}; _npWiz.styleOpen = false; _npWiz.draft = null;
                return npWizRender(document.getElementById('notePublishContent')); }''')
            expect(page.locator('#npWizBody')).to_contain_text('④ 挑稿', timeout=10000)
            expect(page.locator('#npWizBody')).to_contain_text('先挑内容类型')
            expect(page.locator('#npWizBody')).to_contain_text('挑中哪篇就按那篇进 ⑤ 接着改')
            assert page.locator('#npWizBody .npWriteKind').count() == 0, '写法不再在这一步挑——由样稿卡来挑'
            # 🔀 内容类型：五条线一排都能切（老板：怎么只有热点能选？）；这一条线底下的写法只读列出（下面各出一篇）
            expect(page.locator('#npWizBody')).to_contain_text('🔀 内容类型（五条线）· 这条讲哪一类')
            for _lk in ('tale', 'echo', 'meme', 'hot', 'howto'):
                assert page.locator('#npWizBody .npWriteType[data-type="%s"]' % _lk).count() == 1, '五条线每条都要能点：%s' % _lk
            # 四十七改起这条线底下的几种写法＝并排的几台「手机」样稿（不再是只读文字清单）
            assert page.locator('#npWizBody .npPhone').count() == 5, '情绪线底下 5 种写法＝五台手机并排'
            for _kn in ('不敢承认的情绪', '处境对号入座', '替你说出口', '生活切片', '一句能被转发的话'):
                assert page.locator('#npWizBody .npPhone', has_text=_kn).count() == 1, f'每种写法各出一篇：{_kn}'
            expect(page.locator('#npWizBody')).to_contain_text('● 情绪')   # 当前那条线点亮（AI 按题判的那条）
            expect(page.locator('#npWizBody')).to_contain_text('配比 90/10')   # 这条线没被账号默认单独定过 → 按话术档「轻带一句」切 90/10
            expect(page.locator('#npWizBody')).to_contain_text('字数 300-500 字')  # 情绪线建议短档（任务配置那张表里没改过它）
            assert page.locator('#npWizBody .npWriteRestore').count() == 0, '跟底子一致＝没换过，不给「回默认」'
            assert '调子' not in page.locator('#npWizBody').inner_text(), '调子已退市：④ 通篇不该再出现「调子」'
            # 常驻的重新生成入口＝页脚那颗「🔀 重写这批」（换线 / 刚改过口径 / 上一批不满意都点它）
            assert page.locator('.np-wiz-again').count() == 1, '④ 页脚要常驻那颗「🔀 重写这批」'
            expect(page.locator('.np-wiz-again')).to_have_text('🔀 重写这批')
            expect(page.locator('#npWizBody')).to_contain_text('点一条就换，换完自动按它的几种写法各出一篇')
            # 进页就自己烧这一批：**按字数档分批打**（情绪线短档 → 5 篇一批打完；长档才 2 篇一批），不是一种一发
            expect(page.locator('#npWizBody .npVarPick')).to_have_count(5, timeout=30000)
            assert len(STATE['requests']) == var_before + 1, '短档 5 篇一批：情绪线 5 种写法一发打完'
            var_sys = STATE['requests'][var_before]['messages'][0]['content']
            var_user = STATE['requests'][var_before]['messages'][1]['content']
            assert '同题写一批' in var_sys and '每一种写法各写一篇' in var_sys, var_sys[:400]
            assert '★ 本条线：情绪' in var_sys, var_sys[:400]
            assert '必须走过的节拍' in var_sys, '这批也要带上这条线的节拍'
            assert '第一优先级：正文**怎么讲**按这一类' in var_sys, '怎么讲、占多少字都由这一类（这种写法）说话'
            assert '调子' not in var_sys, '批量提示词里不该再有调子口径：' + var_sys[:300]
            assert '篇幅配比（按整篇正文字数算）' in var_sys, '📐 配比要钉进这一批'
            assert '只有写法在变' in var_sys and '每篇都要能独立发出去' in var_sys, var_sys[:800]
            assert '每篇字数控制在 300-500' in var_sys, '字数档跟着这条线／这种写法走'
            assert '按这档的中值收口' in var_sys, '分批之后要写明别每篇顶上限（否则一批写不动、被截断）'
            assert '卖货话术比例＝轻带一句' in var_sys, '话术比例跟账号默认（任务配置那一档）'
            assert '"variants"' in var_sys, '输出契约：一次回一批'
            assert '【本次选题】先别急着发笔记' in var_user, var_user[:400]
            assert '【本条线底下的写法：一种一篇】' in var_user and 'kind=hidden' in var_user and 'kind=quote' in var_user, var_user[:600]
            expect(page.locator('#npWizBody')).to_contain_text('样稿·替你说出口')   # 卡片副标＝这篇的标题（一种写法一篇）
            check(page, '📄 发笔记 ④ 挑稿：🔀 内容类型五条线都能切 + 页脚常驻「🔀 重写这批」；进页自动把这条线底下的几种写法各出一篇（并排摆成几台手机）（短档 5 篇一批、长档 2 篇一批；提示词钉死「同题＋只有写法在变＋线节拍＋📐 配比＋🖋 字数＋按中值收口」，调子已退市）')
            # 🎚 这一条：一行摘要 + 折起来的「就改这一条」（📐 配比在这里只读预览，改它要去「发笔记 → 任务配置」那张表）
            assert page.locator('#npWizBody .npStyleTalk').count() == 0 and page.locator('#npWizBody .npStyleWords').count() == 0, '旋钮折着呢：没展开不该铺出话术档/字数档'
            expect(page.locator('#npWizBody')).to_contain_text('🎚 这一条')
            expect(page.locator('#npWizBody')).to_contain_text('配比 90/10 · 广告占比 轻带一句 · 字数 300-500 字')
            assert page.locator('#npWizBody .qhelp[data-tip*="账号默认在「发笔记 → 任务配置 → 内容基调」那几张卡上改"]').count() == 1, '那句指路收在问号气泡里，不铺成长句'
            page.locator('#npWizBody .npStyleToggle').click()
            expect(page.locator('#npWizBody .npStyleToggle')).to_contain_text('收起', timeout=10000)
            assert page.locator('#npWizBody .npStyleTalk').count() == 4, '展开后四档卖货话术比例都在'
            assert page.locator('#npWizBody .npStyleWords').count() == 3, '展开后三档字数都在'
            expect(page.locator('#npWizBody')).to_contain_text('📐 篇幅配比')          # 只读预览条（跟着话术比例与字数重切）
            expect(page.locator('#npWizBody')).to_contain_text('（铺垫 / 广告 各占多少字，账号默认在「发笔记 → 任务配置 → 内容基调」）')
            expect(page.locator('#npWizBody')).to_contain_text('当前：轻带一句（约占正文 1 成）（跟账号阶段建议的「轻带一句」）')
            expect(page.locator('#npWizBody')).to_contain_text('当前：短（300-500 字）（跟这条线／写法建议的）')
            assert page.locator('#npWizBody .npStyleRestore').count() == 0, '没改过就不该有「回到跟账号默认」'
            assert page.locator('#npWizBody .npStylePickRaw, #npWizBody .npStyleSub, #npWizBody .npStyleRatio').count() == 0, '调子卡／主副调子／混合比例整套控件已退市'
            # 改这一条的话术比例与字数：只影响这一条（账号默认不动），且只提示重写，不自动再烧一发
            page.locator('#npWizBody .npStyleTalk[data-talk="none"]').click()
            assert page.evaluate('() => _npWiz.noteStyle.sellTalk') == 'none'
            assert worker.evaluate('async () => (((await Storage.getConfig()).noteStyle || {}).sellTalk)') in (None, 'light'), '④ 里改话术比例不许写账号默认（新三签 UI 不再单独存 sellTalk，缺省即轻带一句）'
            page.locator('#npWizBody .npStyleWords[data-words="long"]').click()
            assert page.evaluate('() => _npWiz.noteStyle.words') == 'long'
            assert worker.evaluate('async () => !((await Storage.getConfig()).noteStyle || {}).words') is True, '④ 里改字数不许写账号默认（账号字数挂在任务配置那张表的这条线／这个写法上）'
            expect(page.locator('#npWizBody')).to_contain_text('配比 100/0')      # 「不提产品」把广告段归 0，整篇全给铺垫
            expect(page.locator('#npWizBody')).to_contain_text('（这条改过）')
            expect(page.locator('#npWizBody')).to_contain_text('↺ 这两个回到跟账号默认')
            expect(page.locator('#npWizBody')).to_contain_text('⚠️ 这批还是按「配比 90/10 · 话术 轻带一句 · 字数 short」写的')
            assert len(STATE['requests']) == var_before + 1, '话术比例/字数改了只提示，不许自动重烧这批'
            assert page.locator('#npWizBody .npVarPick').count() == 5, '没点重写就还是原来那五篇（样稿留着，钱不乱花）'
            check(page, '📄 ④「就改这一条」＝🎚 广告占比 + 🖋 字数（📐 配比只读预览）：改了只标「这批还是按旧口径写的」，不自动重烧、也不写账号默认')
            # 真按新口径重出：字数已换长档 → 2 篇一批，情绪线 5 种写法＝3 批
            page.locator('.np-wiz-again').click()
            page.wait_for_function('() => _npVariantsBusy === true', timeout=5000)
            page.wait_for_function('() => _npVariantsBusy === false && (_npWiz.variants || []).length === 5', timeout=90000)
            _vreq = [r for r in STATE['requests'][var_before:] if '同题写一批' in r['messages'][0]['content']]
            assert len(_vreq) == 4, ('进页 1 批（短档 5 篇）+ 重烧 3 批（长档 2 篇一批），实际 %d 批：%s'
                % (len(_vreq), [re.findall(r'kind=([a-z]+)', r['messages'][1]['content']) for r in _vreq]))
            assert '卖货话术比例＝不提产品' in STATE['requests'][-1]['messages'][0]['content'], '重烧要按刚改的话术比例'
            assert '每篇字数控制在 800-1500' in STATE['requests'][-1]['messages'][0]['content'], '重烧要按刚改的字数档'
            assert '这批还是按「' not in page.locator('#npWizBody').inner_text(), '重烧后这批就是新的了，提示该消失'
            # ↺ 这两个回到跟账号默认：清空这一条的两个旋钮，账号默认仍不动，也不自动重烧
            page.locator('#npWizBody .npStyleRestore').click()
            assert page.evaluate('() => JSON.stringify(_npWiz.noteStyle)') == '{}', '回默认＝这条不再自己定话术/字数'
            assert worker.evaluate('async () => (((await Storage.getConfig()).noteStyle || {}).sellTalk)') in (None, 'light'), '↺ 回默认也不许写账号默认（缺省即轻带一句）'
            expect(page.locator('#npWizBody')).to_contain_text('配比 90/10 · 广告占比 轻带一句 · 字数 300-500 字')
            expect(page.locator('#npWizBody')).to_contain_text('⚠️ 这批还是按「配比 100/0 · 话术 不提产品 · 字数 long」写的')
            assert len(STATE['requests']) == var_before + 4, '↺ 回默认也不自动重烧这批'
            # 换一条线＝上一批作废重出（别的线的写法不能混进来）
            page.locator('#npWizBody .npWriteType[data-type="meme"]').click()
            assert page.evaluate('() => (_npWiz.write || {}).type') == 'meme'
            assert page.evaluate('() => _npWiz.variantsLine') == 'meme'
            page.wait_for_function('() => _npVariantsBusy === false && (_npWiz.variants || []).length === 4', timeout=90000)
            assert len(STATE['requests']) == var_before + 5, '热梗线 4 种写法、短档一批打完'
            assert '★ 本条线：热梗' in STATE['requests'][-1]['messages'][0]['content'], '换线要重出一批，且按新那条线出'
            assert page.locator('#npWizBody .npPhone').count() == 4, '热梗线 4 种写法＝四台手机并排'
            expect(page.locator('#npWizBody')).to_contain_text('↺ 回默认「情绪 · 不敢承认的情绪」')
            # 一键回到底子那条线：这条线的样稿还留着（四十三改后每条线各记一份，切回来不重烧）
            page.locator('#npWizBody .npWriteRestore').click()
            assert page.evaluate('() => _npWiz.write') is None, '回默认＝这条不再自己定线/写法'
            assert page.evaluate('() => JSON.stringify(npWritePickNow(_npWiz))') == '{"type":"echo","kind":"hidden"}', '回默认＝回到 ③ 里 AI 判的那条线'
            page.wait_for_function('() => _npVariantsBusy === false && (_npWiz.variants || []).length === 5', timeout=90000)
            assert len(STATE['requests']) == var_before + 5, '回默认＝用这条线那批样稿、不重烧'
            assert page.evaluate('() => (_npWiz.variantsLine)') == 'echo' and page.evaluate('() => (_npWiz.variants || []).length') == 5
            assert '⚠️ 这批还是按「' in page.locator('#npWizBody').inner_text(), '缓存那批是按旧口径（长档·不提产品）写的，回默认后要照旧标出不一样'
            check(page, '📄 ④ 换线来回看＝每条线各记一份样稿：切走再切回不重烧 AI（这批是缓存那批，口径不同照样标 ⚠️）')
            # 点中一篇＝定死这条的线 × 写法，并把那篇正文当 ⑤ 的底稿（不再让 AI 从零写一篇）
            page.locator('#npWizBody .npVarPick').nth(1).click()
            assert page.evaluate('() => (_npWiz.write || {}).kind') == 'mirror', '挑中「处境对号入座」＝把这篇的写法定下来'
            assert page.evaluate('() => !!_npWiz.draft && _npWiz.draft.fromVar === true') is True, '挑中的那篇要当底稿带进 ⑤'
            assert page.evaluate('() => _npWiz.draft.content').startswith('【处境对号入座】'), page.evaluate('() => _npWiz.draft.content')
            assert page.evaluate('() => _npWiz.draft.tags') == ['样稿标签', '处境对号入座']
            assert page.evaluate('() => _npWiz.step') == 4 and page.evaluate('() => _npNote.title') == '样稿·处境对号入座'
            assert page.evaluate('() => _npStyleState.dirty') is False, '挑中的这篇就是按当前这套写的，不该标「改过了」'
            assert bool(page.evaluate('() => !!_npWiz.arId')), '挑中即当场进档案（草稿），关掉弹窗不丢'
            stepbar5 = page.locator('#npWizBody').inner_text()
            assert '情绪 · 处境对号入座（这条换过）' in stepbar5, stepbar5[:400]
            assert '📐 90/10' in stepbar5 and '广告占比 轻带一句' in stepbar5 and '300-500' in stepbar5, stepbar5[:400]
            assert '占比／字数这条改过' not in stepbar5, '两个旋钮已 ↺ 回账号默认，⑤ 那行不该再标改过'
            assert '✏️ 换内容类型和写法' in stepbar5, '⑤ 要给一点就回 ④ 的入口'
            assert '调子' not in stepbar5, '⑤ 那行不再有调子口径'
            # ⑤ 默认「逐句」摆（点某一句→只改那一句），切「✍️ 全文手改」才出 textarea
            assert page.locator('#npWizBody .np-sent-row').first.inner_text().startswith('【处境对号入座】'), '逐句第一句就是挑中那篇的开头'
            page.locator('#npWizBody .np-draft-mode').click()
            expect(page.locator('#npResult')).to_be_visible(timeout=10000)
            assert page.locator('#npResult').input_value().startswith('【处境对号入座】')
            page.locator('#npWizBody .np-draft-mode').click()   # 回逐句，后面用例仍按默认那面看
            expect(page.locator('#npTags span')).to_have_count(2)
            check(page, '📄 ④ 折叠的「就改这一条」＝🎚 话术比例/🖋 字数（改了指望「🔀 重写这批」，不自动烧 AI、也不写账号默认；↺ 那两个旋钮能一键跟回账号默认）；🔀 换内容类型＝作废重出一批；点中一篇＝定死线×写法并带稿进 ⑤（不重新生成）；⑤ 那行标出本条线·写法/📐 配比/话术/字数')
            # ④ 的前进路只有一条：点中哪台就走哪篇（「先不挑 · 让 AI 写一篇」已撤）
            page.evaluate('''() => { _npWiz.step = 3; return npWizRender(document.getElementById('notePublishContent')); }''')
            expect(page.locator('#npWizBody')).to_contain_text('④ 挑稿', timeout=10000)
            assert page.locator('.np-wiz-next').count() == 0, '④ 不再有「下一步」：挑稿才是唯一直通 ⑤ 的动作'
            assert page.locator('.np-wiz-again').count() == 1, '④ 的「重写这批」在导航条上'
            expect(page.locator('#npWizNav')).to_contain_text('挑中哪篇就走哪篇')
            assert page.locator('#npWizBody .npVarPick').count() == page.locator('#npWizBody .npPhone').count(), \
                '④ 不许有走不下去的死路：摆出来的每台手机都要带「就用这篇 →」'
            # 没底子（没排产项也没话题）时：④ 先让挑线，不自动烧钱
            reqs_noline = len(STATE['requests'])
            page.evaluate('''() => { _npWiz.step = 3; _npWiz.topics = []; _npWiz.chosenTopicIdx = -1; _npWiz.write = null;
                _npWiz.variants = null; _npWiz.variantsError = ''; _npWiz.variantsKey = '';
                return npWizRender(document.getElementById('notePublishContent')); }''')
            expect(page.locator('#npWizBody')).to_contain_text('先在上面的「🔀 内容类型」里挑一条线', timeout=10000)
            assert page.locator('#npWizBody .npVarPick').count() == 0, '没定线就不该出稿，也不该烧 AI'
            assert page.locator('#npWizBody .npPhone').count() == 0, '没定线＝一台样稿都没有，也不该烧 AI'
            assert len(STATE['requests']) == reqs_noline, '没定线这一页不能自己打 AI'
            check(page, '④ 没底子（没线）时不烧 AI、只让挑一条线；定了线后每台样稿都带「就用这篇 →」＝没有死路（「先不挑 · 让 AI 写一篇」已撤）')
            page.screenshot(path=str(out / 'notepublish-style-step.png'), full_page=True)
            # 回到 ①（后面还要在 ① 的素材清单上点勾）
            page.evaluate('''() => { _npWiz.step = 0; return npWizRender(document.getElementById('notePublishContent')); }''')
            expect(page.locator('#npWizBody .np-kbk')).to_have_count(len(kb_rows), timeout=10000)   # ① 清单摆出来（三十六改：按类收着，只认数不认可见）
            # ⑨ 规划接进发笔记：③ 选话题那一步要能摆出「📚 按规划发」的下一篇
            assert page.evaluate('''() => {
                _npPlanCache = { stage: 'cold', stageName: '冷启动期', items: [
                    { no: 1, title: '怎样先体验', type: 'tale', kind: 'scene', scope: 'related', credential: '做这行 5 年' }] };
                const h = npPlanCardHtml();
                return h.includes('按规划发') && h.includes('怎样先体验') && h.includes('感悟 · 现场故事') && h.includes('npPlanUse');
            }'''), '发笔记要能摆出规划里还没写的那一篇，并标出类型与具体写法'
            assert page.evaluate('''() => {
                _npPlanCache = { stage: 'mature', stageName: '成熟期', items: [
                    { no: 2, title: '行业泛话题', type: 'hot', kind: 'hotFit', scope: 'breakout', credential: '同行聊过' }] };
                return npPlanCardHtml().includes('破圈');
            }'''), '破圈内容要能标出来（不再被档位闸门挡掉）'
            # 📅 栏目（长期设定）：规划里那一篇属于哪个栏目、每周几发，③ 的卡上要看得见
            assert page.evaluate('''() => {
                _npPlanCache = { stage: 'cold', stageName: '冷启动期', weekText: '周四 每周一拍（感悟）', items: [
                    { no: 1, title: '怎样先体验', type: 'tale', kind: 'scene', scope: 'related', credential: '做这行 5 年',
                      col: '每周一拍', day: 4, colId: 'c1' }] };
                const h = npPlanCardHtml();
                return h.includes('📅 每周固定：周四 每周一拍（感悟）') && h.includes('📅 周四 · 每周一拍');
            }'''), '③ 的「按规划发」要显示一周固定位与这一篇的栏目/星期'
            # 撤档位：都卖——成稿只按「这一类 · 这种写法」写：节拍、📐 篇幅配比、🖋 字数都从这一块下来（调子已退市）
            base_req = {'topic': '怎样先体验', 'productName': '体验工具', 'sellPoint': '先试再选', 'planStage': 'cold', 'kbList': []}
            plan_item = {'no': 1, 'title': '怎样先体验', 'type': 'howto', 'kind': 'calc', 'goal': '用真实对比立懂行', 'scope': 'related', 'credential': '做这行 5 年'}
            send(page, 'aiRewriteNote', dict(base_req, planItem=plan_item))
            draft_system = STATE['requests'][-1]['messages'][0]['content']
            assert '档位' not in draft_system, '成稿提示词里不该再有档位口径：' + draft_system[:300]
            assert '调子' not in draft_system, '成稿提示词里不该再有调子口径：' + draft_system[:300]
            assert '属于「知识·干货」' in draft_system and '具体写法用「算账对比」' in draft_system, draft_system[:400]
            assert '这一篇是「知识·干货 · 算账对比」' in draft_system, '类型块要报出这一类 + 这种写法：' + draft_system[:400]
            assert '第一优先级：正文**怎么讲**按这一类' in draft_system, '成稿要写明「怎么讲」以这一类为准'
            assert '必须走过的节拍' in draft_system, '成稿要按这一类的节拍走'
            assert '这一类在这一轮是要干嘛：用真实对比立懂行' in draft_system, '成稿要按这一类的目标落'
            assert '卖货话术的比例＝轻带一句（约占正文 1 成）' in draft_system, '成稿要按卖货话术比例写（没设过＝账号默认那一档）'
            assert '产品名[体验工具]在正文里自然出现一次即可' in draft_system, '都卖：任何一篇都允许自然出现一次产品名'
            assert '这篇的价值核心是卖点【先试再选】' in draft_system, '都卖：卖点仍是全篇的价值核心'
            assert '它在正文里什么时候出现、占多少篇幅，按上面【这一篇】的篇幅配比来' in draft_system, '卖点的位置与篇幅交给这一类（这种写法）的配比管'
            assert '这是「账号人设」' in draft_system and '知识库参考' in draft_system, '人设与知识库口径不受影响'
            # 📐 配比：这条线（知识·干货）没被账号默认单独定过 → 按话术档「轻带一句」切 90/10（字数＝写法「算账对比」的长档，中值 1150）
            assert '篇幅配比（按整篇正文字数算）' in draft_system, '成稿要把这条线／这种写法的篇幅配比带进去'
            assert '铺垫 ≈ 90%（约 1040 字）' in draft_system, '配比里的字数估算跟着字数档走（长档中值 1150）：' + draft_system[:600]
            assert '本条产品篇幅按「轻带一句」走（约占正文 10%）' in draft_system, '没有账号默认覆盖时按话术档改口'
            assert '这一类的戒条（违反＝写错了这一类）' in draft_system, '成稿要带上这一类的戒条'
            assert '字数：这篇写 800-1500 字（长档' in draft_system, '成稿要按字数档写（没设过＝任务配置那张表里这条线/这个写法建议的）'
            (ROOT / 'tmp').mkdir(exist_ok=True)
            (ROOT / 'tmp' / 'tone-system.txt').write_text(draft_system, encoding='utf-8')
            check(page, '发笔记按规划写稿：撤掉档位闸门（都卖），成稿带类型/具体写法/这一类要干嘛 + 这一类的节拍、📐 篇幅配比与 🖋 字数（调子已退市）')
            # 📅 栏目那篇：成稿要守住"这是本账号长期栏目里的一篇，别串成别的栏目"
            send(page, 'aiRewriteNote', dict(base_req, planItem={'no': 1, 'title': '怎样先体验', 'type': 'tale', 'kind': 'scene',
                                                                 'scope': 'related', 'credential': '做这行 5 年', 'col': '每周一拍', 'day': 4}))
            col_draft = STATE['requests'][-1]['messages'][0]['content']
            assert '★ 本篇是本账号长期栏目「每周一拍」的一篇（每周周四发）' in col_draft, col_draft[:500]
            assert '内容要一直贴着这个名字与该栏目的那一类写法走，别串成别的栏目。' in col_draft, col_draft[:500]
            check(page, '📅 栏目篇成稿守住长期栏目定位（提示词点名「本账号长期栏目「X」（每周周四发）」）')
            # 这条改了话术比例/字数时，payload 里带 noteStyle：成稿与话题都按这条写，账号默认（config）不动
            send(page, 'aiRewriteNote', dict(base_req, planItem=plan_item, noteStyle={'sellTalk': 'strong', 'words': 'long'}))
            draft_strong = STATE['requests'][-1]['messages'][0]['content']
            assert '卖货话术的比例＝主打推荐（约占正文 5 成）' in draft_strong, draft_strong[:400]
            assert '是这篇的主角' in draft_strong, draft_strong[:400]
            assert '广告 ≈ 50%（约 580 字）' in draft_strong and '本条产品篇幅按「主打推荐」走（约占正文 50%）' in draft_strong, '比例一放大，配比那句话也要跟着改口'
            assert '产品出现在哪一步、占多少篇幅，按上面【这一篇】的篇幅配比来' in draft_strong, '产品位置与篇幅仍交给这一类（这种写法）的配比管'
            assert '字数：这篇写 800-1500 字（长档' in draft_strong, '这条点了长档就按长档写'
            send(page, 'aiRewriteNote', dict(base_req, planItem=plan_item, noteStyle={'sellTalk': 'none'}))
            draft_none = STATE['requests'][-1]['messages'][0]['content']
            assert '卖货话术的比例＝不提产品（这篇不卖）' in draft_none, draft_none[:400]
            assert '正文不出现产品名[体验工具]' in draft_none, draft_none[:400]
            assert '广告 ≈ 0%（不出现）' in draft_none and '设为不出现产品' in draft_none, '不提产品：配比里产品段归 0，节拍里提产品的动作全跳过'
            assert '产品名[体验工具]在正文里自然出现一次即可' not in draft_none, '不提产品就不该再要求产品名露面'
            assert worker.evaluate('async () => (((await Storage.getConfig()).noteStyle || {}).sellTalk)') in (None, 'light'), '这条的话术比例不许动账号默认（缺省即轻带一句）'
            check(page, '🎚 卖货话术比例随 payload 进成稿提示词：主打推荐/不提产品各按各写，配比里的产品段跟着改口，账号默认不动')
            # 🖋 字数也随 payload 进成稿：这条要写短就按短档写，配比里的字数估算跟着缩，账号默认不动
            send(page, 'aiRewriteNote', dict(base_req, planItem=plan_item, noteStyle={'words': 'short'}))
            draft_short = STATE['requests'][-1]['messages'][0]['content']
            assert '字数：这篇写 300-500 字（短档' in draft_short, draft_short[:400]
            assert '铺垫 ≈ 90%（约 360 字）' in draft_short, '配比里的字数估算要跟着字数档走：' + draft_short[:600]
            assert worker.evaluate('async () => !((await Storage.getConfig()).noteStyle || {}).words') is True, '这条的字数不许动账号默认（账号字数挂在任务配置那张表的这条线／这个写法上）'
            check(page, '🖋 字数随 payload 进成稿提示词：写到短档，配比里的字数估算跟着变，账号默认不动')
            # 话题那一发同样按这条的话术比例与五条线出选题
            send(page, 'aiGenerateTopics', {'noteStyle': {'sellTalk': 'none'}, 'sellPoints': [{'point': '体验工具'}], 'people': [{'name': '准备提前还房贷的上班族'}], 'kbList': []})
            assert '卖货话术比例＝不提产品' in STATE['requests'][-1]['messages'][0]['content'], '不提产品时话题别出种草/测评向'
            assert '归到下面五条线里最贴的一条' in STATE['requests'][-1]['messages'][0]['content'], '话题要按五条线归类（线×写法）'
            send(page, 'aiGenerateTopics', {'noteStyle': {'sellTalk': 'strong'}, 'sellPoints': [{'point': '体验工具'}], 'people': [{'name': '准备提前还房贷的上班族'}], 'kbList': []})
            assert '卖货话术比例＝主打推荐' in STATE['requests'][-1]['messages'][0]['content'], '话题那一发也要按卖货话术比例出选题'
            check(page, '这条改的话术比例随 payload 进话题提示词：不提产品/主打推荐各按各出选题，账号默认不动')
            page.screenshot(path=str(out / 'notepublish-kb-picker.png'), full_page=True)
            # 勾一条 → 只喂这一条：未勾的那条不许出现在【知识库资料】/【知识库参考】里
            key_before = page.evaluate('() => npTopicsKeyOf(_npWiz)')
            pick_idx = [i for i, e in enumerate(kb_rows) if e['title'] == '点选素材测试条'][0]
            kb_pick_click(page, pick_idx)   # 三十六改：按 data-i 认条（分组后 DOM 次序变了），收在类堆里先摊开
            assert page.evaluate('() => _npWiz.chosenKb.map(e => e.title)') == ['点选素材测试条']
            key_after = page.evaluate('() => npTopicsKeyOf(_npWiz)')
            assert key_after != key_before and key_after.endswith(str(kb_rows[pick_idx].get('id') or pick_idx)), (key_before, key_after)
            check(page, '勾中素材即记进本次选择，并同步改掉话题的缓存键（素材一换，话题要重算）')
            picked_list = [{'title': '点选素材测试条', 'content': '上架前的三段式盘点清单，先讲人群再讲场景'}]
            send(page, 'aiGenerateTopics', {'sellPoints': [{'point': '体验工具'}], 'people': [{'name': '准备提前还房贷的上班族'}], 'kbList': picked_list})
            topics_user = STATE['requests'][-1]['messages'][1]['content']
            topics_system = STATE['requests'][-1]['messages'][0]['content']
            assert '归到下面五条线里最贴的一条' in topics_system, '话题那一发也要按五条线归类出选题'
            assert '上架前的三段式盘点清单' in topics_user, topics_user
            assert '客服话术口径与退款说明' not in topics_user, '只该喂点选的素材，没勾的不能进提示词'
            assert '用户为本篇点选的素材' in topics_system, topics_system
            send(page, 'aiGenerateTopics', {'sellPoints': [{'point': '体验工具'}], 'people': [{'name': '准备提前还房贷的上班族'}], 'kbList': []})
            topics_fallback = STATE['requests'][-1]['messages'][1]['content']
            assert '【相关素材' in topics_fallback, '不选素材时要按本次卖点/人群筛库'
            assert '客服话术口径与退款说明' not in topics_fallback, '没点选、又跟本次卖点无关的素材不该进提示词'
            check(page, '话题：点了素材只喂点选的几条（并提示围绕它出选题）；不点则按卖点/人群筛出相关几条')
            send(page, 'aiRewriteNote', {'topic': '测试话题', 'sellPoint': '体验工具', 'people': [{'name': '准备提前还房贷的上班族'}],
                                         'productName': '体验工具', 'kbList': picked_list})
            draft_ref = STATE['requests'][-1]['messages'][1]['content']
            assert '【知识库参考】' in draft_ref and '上架前的三段式盘点清单' in draft_ref, draft_ref
            assert '客服话术口径与退款说明' not in draft_ref, '成稿的【知识库参考】只能用它点选的素材'
            check(page, '成稿：【知识库参考】用①里点选的素材（整条喂进去），没勾的不进提示词')
            # ═══ 🎬 案例流全链路（2026-10-08 #7）：六卡建篇 → ① 进料·剪切·定义 → ② 大组装 → 真出片 → 存回档案 ═══
            page.locator('#tabNotePublish').click()
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible()
            page.locator('#dirBox [data-direff="c|案例成片"]').click()
            expect(page.locator('#noteCaseContent')).to_be_visible(timeout=15000)
            case_note = worker.evaluate('async () => (((await chrome.storage.local.get("np_notes")).np_notes) || [])[0] || null')
            assert case_note and case_note['dir'] == 'c' and case_note['form'] == '案例成片' and case_note['asm'] in (None, {}), case_note
            # ① 进来就按知识库蒸环节轴（mock 照【知识库标题】清单挑真标题回）
            page.wait_for_function('() => _npCase && _npCase.stages.length >= 2 && !_npCase.stageBusy', timeout=25000)
            assert page.evaluate('() => _npCase.stages.map(s => s.name)') == ['🚪 进场看现场', '💧 闭水试验', '✅ 验收交付']
            distill_user = [r for r in STATE['requests'] if '蒸环节轴' in r['messages'][0]['content']][-1]['messages'][1]['content']
            assert '【知识库标题】' in distill_user and '点选素材测试条' in distill_user, distill_user[:300]
            page.wait_for_function('() => _npCase.kbTitles.length > 0', timeout=15000)
            # 📼 进料：当场合成一段真 mp4（canvas + MediaRecorder ≈7 秒）喂进 #npcFile——走真 change 委托 → npCaseAddFiles
            clip_b64 = page.evaluate('''async () => {
                const cv = document.createElement('canvas');
                cv.width = 480; cv.height = 854;
                const cx = cv.getContext('2d');
                const stream = cv.captureStream(30);
                const rec = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', videoBitsPerSecond: 800000 });
                const chunks = [];
                rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
                const stopped = new Promise((res) => { rec.onstop = res; });
                rec.start(250);
                const t0 = performance.now();
                await new Promise((res) => {
                    const tick = () => {
                        const t = performance.now() - t0;
                        cx.fillStyle = '#20313f'; cx.fillRect(0, 0, cv.width, cv.height);
                        cx.fillStyle = '#8fd0ff'; cx.fillRect(60, 120 + (t / 8) % 300, 360, 160);
                        if (t > 7000) return res();
                        requestAnimationFrame(tick);
                    };
                    tick();
                });
                rec.stop();
                await stopped;
                const u8 = new Uint8Array(await new Blob(chunks, { type: 'video/mp4' }).arrayBuffer());
                let s = '';
                for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
                return btoa(s);
            }''')
            clip_bytes = base64.b64decode(clip_b64)
            assert len(clip_bytes) > 5000, ('合成素材太小：%d' % len(clip_bytes))
            page.locator('#npcFile').set_input_files(files=[{'name': '现场实拍.mp4', 'mimeType': 'video/mp4', 'buffer': clip_bytes}])
            page.wait_for_function('() => _npCase && _npCase.mats.length === 1 && _npCase.mats[0].dur > 0', timeout=30000)
            clip_dur = page.evaluate('() => _npCase.mats[0].dur')
            assert 6 < clip_dur < 9, clip_dur
            # 掐第一段：A=0 B=45 → 存为一段 → 段卡当场弹出：点环节 → 点知识 → 讲解词当场出
            page.evaluate('() => { _npCase.ab = { a: 0, b: 45 }; return true; }')
            page.locator('#noteCaseContent [data-npc="saveseg"]').click()
            page.wait_for_function('() => _npCase.mats[0].segs.length === 1 && _npCase.segOpen === 0', timeout=15000)
            # ⚙ 段卡开着时手改环节轴：改个名字、再挂一条知识——入口就在定义面板里（改完段卡那排 chip 跟着变）
            page.locator('#noteCaseContent [data-npc="seopen"]').click()
            expect(page.locator('#noteCaseContent .npc-stagedit')).to_be_visible(timeout=10000)
            page.locator('#noteCaseContent .npc-se-name').first.fill('🚪 进场对表')
            assert page.evaluate('() => _npCase.stages[0].name') == '🚪 进场对表'
            extra_k = page.evaluate('() => (_npCase.kbTitles || []).find(k => _npCase.stages[0].kb.indexOf(k) < 0) || ""')
            assert extra_k, '知识库里得有一条还没挂上的知识'
            kb_add = page.locator('#noteCaseContent .npc-st-kbadd').first
            kb_add.select_option(extra_k)
            assert extra_k in page.evaluate('() => _npCase.stages[0].kb')
            # ⚙ 拆几个环节＝用户自己拨的档（六十六改 #33）：四档 chip、默认 3~6；拨 4~8 即时落 config.product.caseSplit（一份，所有案例篇共用）
            assert page.locator('#noteCaseContent .npc-stagedit [data-npc="sesplit"]').count() == 4
            assert page.locator('#noteCaseContent .npc-stagedit [data-npc="sesplit"]').all_inner_texts() == ['3~4', '3~6', '4~8', '5~10']
            assert page.locator('#noteCaseContent .npc-stagedit [data-npc="sesplit"][data-v="3~6"].on').count() == 1, '默认 3~6'
            page.locator('#noteCaseContent .npc-stagedit [data-npc="sesplit"][data-v="4~8"]').click()
            assert page.evaluate('() => _npCase.split') == [4, 8]
            assert page.locator('#noteCaseContent .npc-stagedit [data-npc="sesplit"][data-v="4~8"].on').count() == 1
            assert wait_store(page, worker, "Storage.getConfig().then(c => { const s = (c.product || {}).caseSplit || []; return s[0] === 4 && s[1] === 8; })"), '拆档要落 config.product.caseSplit'
            # ↻ 重蒸先过 confirm：取消＝一发不烧、轴原样；确定＝按拨的档真蒸（提示词报「拆成 4~8 个环节」）
            dlgs33 = []
            def _dlg33(d):
                dlgs33.append(d.message)
                d.accept() if len(dlgs33) > 1 else d.dismiss()
            page.on('dialog', _dlg33)
            try:
                req33 = len(STATE['requests'])
                page.locator('#noteCaseContent .npc-stagedit [data-npc="redistill"]').click()
                page.wait_for_timeout(300)
                assert len(dlgs33) == 1 and '按你拨的档拆成 4~8 个' in dlgs33[0], dlgs33
                assert len(STATE['requests']) == req33, '取消＝不许烧 AI'
                assert page.evaluate('() => _npCase.stages.map(s => s.name)') == ['🚪 进场对表', '💧 闭水试验', '✅ 验收交付'], '取消＝环节轴原样'
                page.locator('#noteCaseContent .npc-stagedit [data-npc="redistill"]').click()
                page.wait_for_function("() => _npCase && !_npCase.stageBusy && _npCase.stages.length === 3 && _npCase.stages[0].name === '🚪 进场看现场'", timeout=25000)
            finally:
                page.remove_listener('dialog', _dlg33)
            assert len(dlgs33) == 2 and all('重新蒸一遍环节轴' in m for m in dlgs33), dlgs33
            dist33 = [r for r in STATE['requests'] if '蒸环节轴' in r['messages'][0]['content']][-1]
            assert '拆成 4~8 个环节' in dist33['messages'][0]['content'], dist33['messages'][0]['content'][:300]
            assert page.evaluate('() => _npCase.stages.map(s => s.name)') == ['🚪 进场看现场', '💧 闭水试验', '✅ 验收交付'], '重蒸后的轴＝AI 回的新轴'
            # 顶回环节名：收起面板那一下会重画，段定义那排 chip 就认这个名字了（后面的流程照旧）
            page.locator('#noteCaseContent .npc-se-name').first.fill('🚪 进场对表')
            assert page.evaluate('() => _npCase.stages[0].name') == '🚪 进场对表'
            check(page, '🎬 ⚙ 拆几个环节＝用户可调（3~4/3~6/4~8/5~10）：拨 4~8 即落 config.product.caseSplit；↻ 重蒸先过 confirm——取消＝零 AI、轴原样，确定＝按拨的档拆、提示词报「拆成 4~8 个环节」')
            # 拆档还原成未设（config 不留本用例痕迹）
            worker.evaluate('async () => { const c = await Storage.getConfig(); if (c.product) delete c.product.caseSplit; await Storage.setConfig(c); }')
            page.locator('#noteCaseContent [data-npc="seclose"]').click()
            page.locator('#noteCaseContent .chip[data-npc="stage"]').first.click()
            expect(page.locator('#noteCaseContent .chip[data-npc="kb"]').first).to_be_visible(timeout=10000)
            page.locator('#noteCaseContent .chip[data-npc="kb"]').first.click()
            page.wait_for_function('() => _npCase.mats[0].segs[0].done === true && !!_npCase.mats[0].segs[0].vo', timeout=25000)
            seg1 = page.evaluate('() => _npCase.mats[0].segs[0]')
            assert seg1['stage'] == '🚪 进场对表' and seg1['kb'], seg1
            assert seg1['vo'] == '现场先看一遍再动手。', seg1
            vo_sys = [r for r in STATE['requests'] if '「案例成片」写讲解词' in r['messages'][0]['content']][-1]['messages'][0]['content']
            assert '字数红线：最多' in vo_sys, '讲解词提示词要钉死铁律字数'
            # ↻ 换一版：走 alt 通道，讲解词换成另一句
            page.locator('#noteCaseContent [data-npc="revo"][data-i="0"]').click()
            page.wait_for_function("() => _npCase.mats[0].segs[0].vo === '换个讲法：先看再做。'", timeout=25000)
            assert page.evaluate('() => _npCase.mats[0].segs[0].voAlt') is True
            revo_user = [r for r in STATE['requests'] if '「案例成片」写讲解词' in r['messages'][0]['content']][-1]['messages'][1]['content']
            assert '【上一版写法' in revo_user, '换一版要把上一版带进提示词'
            # 掐第二段：只留原声当过渡（🌫），排到队尾
            page.evaluate('() => { _npCase.ab = { a: 55, b: 100 }; return true; }')
            page.locator('#noteCaseContent [data-npc="saveseg"]').click()
            page.wait_for_function('() => _npCase.mats[0].segs.length === 2 && _npCase.segOpen === 1', timeout=15000)
            page.locator('#noteCaseContent [data-npc="mute"]').click()
            page.wait_for_function('() => _npCase.mats[0].segs[1].done === true', timeout=15000)
            assert page.evaluate('() => _npCase.mats[0].segs[1].stage') == '🌫'
            expect(page.locator('#noteCaseContent .npc-mat')).to_contain_text('已剪 2 段')
            check(page, '🎬 案例流 ①：六卡建篇即蒸环节轴（可改名、可从知识库再挂知识）→ 合成真 mp4 进料 → 掐两段：一段点环节＋知识当场出讲解词（↻ 换一版走 alt 通道）、一段留原声当过渡')
            # ② 大组装：段序（段1 在前、过渡段排队尾）＋ BGM 换安静钢琴 ＋ AI 提名三张封面
            page.locator('#noteCaseContent [data-npc="tostep2"]').click()
            expect(page.locator('#noteCaseContent .npc-asm')).to_be_visible(timeout=10000)
            page.wait_for_function('() => _npCase.coversAI === true', timeout=25000)
            assert page.evaluate('() => _npCase.covers') == ['过程实拍', '细节特写', '成果全景']
            cov_user = [r for r in STATE['requests'] if '提名三张封面' in r['messages'][0]['content']][-1]['messages'][1]['content']
            assert '💧 闭水试验' in cov_user, '封面提名要把环节轴带上'
            assert page.locator('#noteCaseContent .npc-qrow').count() == 2
            assert page.evaluate('() => _npCase.queue[0].s.stage') == '🚪 进场对表'
            page.locator('#noteCaseContent [data-npc="qmove"][data-x="-1"][data-i="1"]').click()
            assert page.evaluate('() => _npCase.queue[0].s.stage') == '🌫', '↑ 上移要立刻换序'
            page.locator('#noteCaseContent [data-npc="qreset"]').click()
            assert page.evaluate('() => _npCase.queue[0].s.stage') == '🚪 进场对表', '↻ AI 重排要按环节序回来'
            page.locator('#noteCaseContent .chip[data-npc="bgm"][data-i="1"]').click()
            assert page.evaluate('() => _npCase.bgm') == 1
            # 🎬 组装出片：画面/混音/录制全走真管线（只有 TTS 打 stub——合成一段 wav 顶晓晓的 mp3，浏览器离线解不了真 mp3）
            assert page.evaluate('''() => {
                EdgeTTS.synth = async () => {
                    const sr = 24000, n = Math.round(sr * 0.5);
                    const ab = new ArrayBuffer(44 + n * 2);
                    const dv = new DataView(ab);
                    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
                    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
                    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
                    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
                    w(36, 'data'); dv.setUint32(40, n * 2, true);
                    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(i / sr * 440 * 2 * Math.PI) * 6000), true);
                    return new Uint8Array(ab);
                };
                return EdgeTTS.isEdge();
            }''') is True
            with page.expect_download(timeout=180000) as dl_info:
                page.locator('#noteCaseContent [data-npc="assemble"]').click()
                page.wait_for_function('() => _npCase && _npCase.asmStep >= 0', timeout=30000)
            page.wait_for_function('() => _npCase && _npCase.film && _npCase.film.at > 0', timeout=180000)
            film = page.evaluate('() => ({ dur: _npCase.film.dur, name: _npCase.film.name, type: _npCase.film.blob.type, size: _npCase.film.blob.size })')
            assert film['type'] == 'video/mp4' and film['size'] > 10000, film
            assert 5 < film['dur'] < 9, film
            film_dl = dl_info.value
            assert film_dl.suggested_filename.endswith('.mp4'), film_dl.suggested_filename
            film_file = pathlib.Path(str(out / film_dl.suggested_filename))
            film_dl.save_as(str(film_file))
            assert film_file.stat().st_size > 10000, ('下载的成片太小', film_file.stat().st_size)
            blob_size = page.evaluate('async (id) => { const b = await npCaseGet("film:" + id); return b ? b.size : 0; }', case_note['id'])
            assert blob_size > 10000, ('成片没进 IndexedDB', blob_size)
            check(page, '🎬 案例流 ② 组装出片：段序可调（↑↓ 立刻换序、↻ AI 重排按环节序）、BGM 换安静钢琴、AI 提名三张封面；点「组装出片」＝真录一支 mp4（自动下载＋落 IndexedDB）')
            # 📥 存回档案：弹原生 prompt 定名 → 这篇标「代发」、form 落「案例成片」、asm 跟落档
            def _dlg_name(d):
                assert d.type == 'prompt', d.type
                d.accept('案例成片·回归测试')
            page.once('dialog', _dlg_name)
            page.locator('#noteCaseContent [data-npc="savearc"]').click()
            page.wait_for_function('() => _npCase && _npCase.saved === true', timeout=30000)
            case_final = worker.evaluate('async (id) => (((await chrome.storage.local.get("np_notes")).np_notes) || []).find(x => x && x.id === id) || null', case_note['id'])
            assert case_final and case_final['title'] == '案例成片·回归测试' and case_final['form'] == '案例成片' and case_final['dir'] == 'c', case_final
            assert case_final['status'] == '代发', case_final.get('status')
            asm_final = case_final.get('asm') or {}
            assert len(asm_final.get('mats') or []) == 1 and len(asm_final['mats'][0]['segs']) == 2, asm_final
            assert asm_final['mats'][0]['segs'][0]['vo'] == '换个讲法：先看再做。', asm_final['mats'][0]['segs'][0]
            assert (asm_final.get('film') or {}).get('at'), asm_final
            # 回档案：这颗「下一步」变「🎬 成片预览」（成片已存回，点开能看片、也能再下一遍），内容格标成片已出、带「▶ 生成台」入口
            page.locator('#noteCaseContent .npc-fdone [data-npc="toarchive"]').click()
            expect(page.locator('.npar-list')).to_be_visible(timeout=15000)
            row_case = page.locator('.npar-list .npar-row', has_text='案例成片·回归测试')
            expect(row_case).to_have_count(1, timeout=15000)
            expect(row_case.locator('.npar-next')).to_have_text('🎬 成片预览')
            expect(row_case).to_contain_text('🎬 成片已出')
            assert row_case.locator('.npar-case-open').count() == 1, '做过的案例篇在档案里要带「▶ 生成台」入口'
            # ▶ 生成台：从档案回工作台，素材与成片从 IndexedDB 捡回来，成片能回看
            row_case.locator('.npar-case-open').click()
            expect(page.locator('#noteCaseContent')).to_be_visible(timeout=15000)
            page.wait_for_function('() => _npCase && _npCase.film && _npCase.film.at > 0', timeout=15000)
            assert page.evaluate('() => _npCase.mats[0].segs.length') == 2
            page.locator('#noteCaseContent [data-npc="tostep2"]').click()
            expect(page.locator('#noteCaseContent .npc-fdone')).to_be_visible(timeout=15000)
            expect(page.locator('#noteCaseContent')).to_contain_text('成片回看')   # 「成片回看」是卡头标题（.npc-fdone 里是「✓ 成片 + 按钮行」）
            assert page.locator('#noteCaseContent video.npc-filmvid').count() == 1, '成片重进要从 IndexedDB 捞回来能回看'
            page.screenshot(path=str(out / 'notepublish-case-flow.png'), full_page=True)
            check(page, '🎬 案例流收口：存回档案＝原生 prompt 定名、状态提到「代发」、form=案例成片、asm 落档；档案行「🎬 成片预览」＋「🎬 成片已出」＋「▶ 生成台」重进可回看成片')
            # 📅 #8 发布队列独立页（镜像 demo v41 二十二改）：位子从周排滚 3 周、一行一篇；排篇/拿下、已发变绿
            # 形状迁移：老扁平项 → 新对象（只迁不丢）；此时队列本来就空，迁完清回去
            mig = page.evaluate('''async () => {
                await chrome.storage.local.set({ note_queue: [{ id: 'q1', week: 1, day: 'thu', kind: '知识', noteId: 'n-old', status: 'planned', at: 1 }] });
                const n = await npNoteQueueShapeMigrate();
                const q = await npNoteQueueRead();
                await chrome.storage.local.set({ note_queue: {} });
                return { n: n, q: q };
            }''')
            assert mig == {'n': 1, 'q': {'w1:thu:知识': ['n-old']}}, mig
            # 周排：把今天排上「知识」，队列页就出今天这个位子（这一页只读周排；结束时恢复原值）
            wp_prev = page.evaluate('async () => await npWeekPlanRead()')
            today_key = page.evaluate('() => NP_WEEK_DAYS[(new Date().getDay() + 6) % 7]')
            today_lab = {'mon': '周一', 'tue': '周二', 'wed': '周三', 'thu': '周四', 'fri': '周五', 'sat': '周六', 'sun': '周日'}[today_key]
            page.evaluate('''async (day) => { const wp = await npWeekPlanRead(); wp[day] = ['知识']; await npWeekPlanSave(wp); }''', today_key)
            page.locator('#tabNoteQueue').click()
            expect(page.locator('#noteQueueContent')).to_be_visible(timeout=15000)
            expect(page.locator('#noteQueueContent .ph-t')).to_contain_text('📅 发布台')
            # 页内还停在上次点过的「🧬 笔记规划」签——先切回「📅 发布队列」再验队列
            queue_tab = page.locator('#nqTabs [data-sec="queue"]')
            if 'active' not in (queue_tab.get_attribute('class') or ''):
                queue_tab.click()
            empty_slot = page.locator('#noteQueueContent .npq-empty', has_text='今天 · ' + today_lab)   # 今天那个位子按「今天」口径标（二十五改）
            expect(empty_slot).to_have_count(1, timeout=10000)
            expect(empty_slot).to_contain_text('这天该发知识，还没排')
            expect(page.locator('#noteQueueContent')).to_contain_text('往后 3 周共排')
            # ＋ 排一篇：picker 列档案里草稿/代发的篇；点一篇＝排进这个位子（一行一篇）
            empty_slot.locator('[data-np="npq-pick"]').click()
            picker = page.locator('#noteQueueContent .npq-picker')
            expect(picker).to_be_visible(timeout=10000)
            expect(picker).to_contain_text('挑档案里的篇排进这个位子')
            cand = picker.locator('[data-np="npq-take"]', has_text='案例成片·回归测试')
            assert cand.count() == 1, '代发的案例篇要能挑进队列'
            cand.click()
            row_q = page.locator('#noteQueueContent .npq-row', has_text='案例成片·回归测试')
            expect(row_q).to_have_count(1, timeout=10000)
            expect(row_q).to_contain_text('今天 · ' + today_lab)
            expect(row_q).to_contain_text('🎬 案例')
            expect(row_q).to_contain_text('缺料 片 0/1')   # 代发＋还没交片：行里标缺料章（视频篇 0/1 口径）
            assert page.evaluate('async () => { const q = await npNoteQueueRead(); return JSON.stringify(q); }') != '{}', '排进后队列要落盘'
            expect(page.locator('#noteQueueContent')).to_contain_text('共排 1 篇')
            # 档案那边跟着出「📅 W1·周X·知识」小标
            page.locator('#tabNoteArchive').click()
            expect(page.locator('.npar-list')).to_be_visible(timeout=15000)
            row_arc = page.locator('.npar-list .npar-row', has_text='案例成片·回归测试')
            expect(row_arc.locator('.npar-queue')).to_have_count(1, timeout=10000)
            expect(row_arc.locator('.npar-queue')).to_contain_text('📅 W1·' + today_lab + '·知识')
            # 回队列：把这篇标成「已发」→ 一行变绿打勾、没有 ✕；再标回「代发」
            page.locator('#tabNoteQueue').click()
            expect(page.locator('#noteQueueContent .npq-row')).to_be_visible(timeout=15000)
            page.evaluate('''async (id) => {
                await npNotesSync(async () => {
                    const list = await npNotesAll();
                    const i = list.findIndex(x => x && x.id === id);
                    if (i >= 0) { list[i].status = '已发'; list[i].statusAt = Object.assign({}, list[i].statusAt, { '已发': Date.now() }); await chrome.storage.local.set({ [NP_NOTES_KEY]: list }); }
                });
            }''', case_note['id'])
            page.evaluate('async () => { await renderNoteQueue(document.getElementById("noteQueueContent")); }')
            row_done = page.locator('#noteQueueContent .npq-row', has_text='案例成片·回归测试')
            expect(row_done).to_contain_text('✅', timeout=10000)
            expect(row_done).to_contain_text('今天 · ' + today_lab)
            assert row_done.locator('[data-np="npq-drop"]').count() == 0, '发过的篇不给「拿下来」'
            expect(page.locator('#noteQueueContent')).to_contain_text('已发 1')
            page.screenshot(path=str(out / 'notepublish-queue.png'), full_page=True)
            check(page, '📅 发布台页：位子从周排滚出（第 1 周＝今天起）、空位细行「＋ 排一篇」、picker 只列草稿/代发；排进＝一行一篇＋档案出「📅 W1·周X·知识」小标；已发变绿打勾、✕ 收掉')
            # 点篇名＝按这篇做到哪去下一步（七十改：收口的案例篇弹「🎬 成片预览」，不再直落教程页）；回队列改回「代发」，✕ 拿下来＝位子回到空位细行
            page.evaluate('''async (id) => {
                await npNotesSync(async () => {
                    const list = await npNotesAll();
                    const i = list.findIndex(x => x && x.id === id);
                    if (i >= 0) { list[i].status = '代发'; if (list[i].statusAt) delete list[i].statusAt['已发']; await chrome.storage.local.set({ [NP_NOTES_KEY]: list }); }
                });
            }''', case_note['id'])
            page.evaluate('async () => { await renderNoteQueue(document.getElementById("noteQueueContent")); }')
            row_q.locator('[data-np="npq-open"]').click()
            expect(page.locator('.npar-prev-mask')).to_be_visible(timeout=15000)
            expect(page.locator('.npar-prev-mask')).to_contain_text('案例成片·回归测试')
            page.locator('.npar-prev-close').click()
            expect(page.locator('.npar-prev-mask')).to_have_count(0)
            page.locator('#tabNoteQueue').click()
            expect(page.locator('#noteQueueContent .npq-row')).to_be_visible(timeout=15000)
            row_q.locator('[data-np="npq-drop"]').click()
            expect(page.locator('#noteQueueContent .npq-empty', has_text='今天 · ' + today_lab)).to_be_visible(timeout=10000)
            assert page.evaluate('async () => { const q = await npNoteQueueRead(); return JSON.stringify(q); }') == '{}', '拿下来＝队列里没这一项了'
            expect(page.locator('#noteQueueContent')).to_contain_text('共排 0 篇')
            page.evaluate('''async (prev) => { await npWeekPlanSave(prev); }''', wp_prev)
            check(page, '📅 发布台收口：点篇名＝按这篇做到哪去下一步（收口的案例篇弹「🎬 成片预览」）；✕ 拿下来＝位子回到细行、队列清空；形状迁移只迁不丢')
            # 👀 预览弹窗 / 🎬 成片预览（老板 2026-10-10 拍板＋七十改）：三种走完的篇各造一篇点「下一步」——
            #   图文走完＝👀 预览（只摆正文）；成片没存本机＝文字说明「成片没存在本机（升级前拼的）——传回来再拼一版」；存了本机＝播放器＋「💾 再下一遍」
            now_pv = int(time.time() * 1000)
            worker.evaluate('''async (data) => {
                const d = await chrome.storage.local.get("np_notes");
                await chrome.storage.local.set({ np_notes: (d.np_notes || []).concat(data.notes) });
                const f = await chrome.storage.local.get("xhsFilmDocs");
                const m = (f.xhsFilmDocs || {});
                Object.assign(m, data.films);
                await chrome.storage.local.set({ xhsFilmDocs: m });
            }''', {'notes': [
                {'id': 'pv1', 'title': '预览·图文图齐那篇', 'status': '代发', 'dir': 'd', 'form': '图文',
                 'voice': '第一屏讲清一件事，第二屏给做法。', 'updatedAt': now_pv,
                 'imgDocs': [{'id': 'pv1-img', 'kind': '', 'shots': {'items': [{'text': '一屏', 'imgs': ['data:image/png;base64,AA']}], 'cv': {'on': True, 'imgs': ['data:image/png;base64,AA']}}}]},
                {'id': 'pv2', 'title': '预览·成片没存本机那篇', 'status': '代发', 'dir': 'd', 'form': '视频',
                 'voice': '拆了三段拼起来的口播。', 'updatedAt': now_pv,
                 'dgen': {'segs': [{'text': '一句', 'done': True}]},
                 'filmDocs': [{'id': 'pv2-f', 'kind': '文案直出视频', 'key': 'pv2'}]},
                {'id': 'pv3', 'title': '预览·成片存了本机那篇', 'status': '代发', 'dir': 'k', 'form': '视频',
                 'voice': '字效那篇的稿子。', 'updatedAt': now_pv, 'kOut': 'film',
                 'filmDocs': [{'id': 'pv3-f', 'kind': '字体动效视频', 'key': 'pv3'}]},
            ], 'films': {
                'pv2': {'script': '一句', 'scenes': [], 'cfg': {}, 'voice': '', 'rate': 1, 'outAt': now_pv},
                'pv3': {'script': '一句', 'scenes': [{'t': '一句'}], 'cfg': {}, 'voice': '', 'rate': 1, 'outAt': now_pv},
            }})
            page.evaluate("async () => { await npCasePut('film:pv3', new Blob(['回归测试用假片'], { type: 'video/mp4' })); }")
            page.locator('#tabNotePublish').click()
            expect(page.locator('.npar-list')).to_be_visible(timeout=15000)
            mask_pv = page.locator('.npar-prev-mask')
            row_pv1 = page.locator('.npar-list .npar-row', has_text='预览·图文图齐那篇')
            expect(row_pv1.locator('.npar-next')).to_have_text('👀 预览', timeout=15000)
            row_pv1.locator('.npar-next').click()
            expect(mask_pv).to_be_visible()
            expect(mask_pv).to_contain_text('预览·图文图齐那篇')
            expect(mask_pv).to_contain_text('第一屏讲清一件事')
            assert mask_pv.locator('.npar-prev-v').count() == 0 and mask_pv.locator('.npar-prev-dl').count() == 0, '图文篇没片：不摆播放器、也不给「再下一遍」'
            mask_pv.locator('.npar-prev-close').click()
            expect(mask_pv).to_have_count(0)
            row_pv2 = page.locator('.npar-list .npar-row', has_text='预览·成片没存本机那篇')
            expect(row_pv2.locator('.npar-next')).to_have_text('🎬 成片预览', timeout=15000)
            row_pv2.locator('.npar-next').click()
            expect(mask_pv).to_be_visible()
            expect(mask_pv).to_contain_text('成片没存在本机')
            expect(mask_pv).to_contain_text('把片段重新传回来再拼一版')
            assert mask_pv.locator('.npar-prev-dl').count() == 0, '没存片子就别给「💾 再下一遍」'
            assert mask_pv.locator('.npar-prev-edit').count() == 1, '视频篇留「✏️ 再改一版」'
            mask_pv.locator('.npar-prev-close').click()
            expect(mask_pv).to_have_count(0)
            row_pv3 = page.locator('.npar-list .npar-row', has_text='预览·成片存了本机那篇')
            expect(row_pv3.locator('.npar-next')).to_have_text('🎬 成片预览', timeout=15000)
            row_pv3.locator('.npar-next').click()
            expect(mask_pv).to_be_visible()
            expect(mask_pv.locator('video.npar-prev-v')).to_have_count(1)
            expect(mask_pv.locator('.npar-prev-dl')).to_have_text('💾 再下一遍')
            mask_pv.locator('.npar-prev-close').click()
            expect(mask_pv).to_have_count(0)
            check(page, '👀/🎬 预览弹窗：走完的篇点「下一步」＝弹窗看全文（标题/状态/正文）；成片类＝「🎬 成片预览」——本机存过片子当场能播＋「💾 再下一遍」、没存就说明「成片没存在本机（升级前拼的）」并指路回「🎬 拆段出词」；视频篇留「✏️ 再改一版」')
            # 清场：三篇预览桩＋films 撤掉，片子 blob 一并删
            worker.evaluate('''async (ids) => {
                const d = await chrome.storage.local.get("np_notes");
                await chrome.storage.local.set({ np_notes: (d.np_notes || []).filter(n => ids.indexOf(n.id) < 0) });
                const f = await chrome.storage.local.get("xhsFilmDocs");
                const m = (f.xhsFilmDocs || {});
                ids.forEach(k => { delete m[k]; });
                await chrome.storage.local.set({ xhsFilmDocs: m });
            }''', ['pv1', 'pv2', 'pv3'])
            page.evaluate("async () => { try { await npCaseDel('film:pv3'); } catch (_) {} }")
            # 🆕 #37 写好自动排位子：篇标「代发」那一刻按方向找最早的未来同类空位；没空位 / 没方向 → 待排区兜底 + 🎯 重试
            ap = page.evaluate('''async () => {
                const list = await npNotesAll();
                const t = Date.now();
                const mk = (id, title, dir) => ({ id: id, title: title, dir: dir, form: '图文', status: '草稿', statusAt: {}, updatedAt: t });
                list.push(mk('n-auto1-' + t, '自动排位·回归知识篇', 'k'));
                list.push(mk('n-auto2-' + t, '自动排位·回归案例篇', 'c'));
                list.push(mk('n-auto3-' + t, '自动排位·回归无方向篇', ''));
                await chrome.storage.local.set({ [NP_NOTES_KEY]: list });
                return { n1: 'n-auto1-' + t, n2: 'n-auto2-' + t, n3: 'n-auto3-' + t };
            }''')
            wp_ap_prev = page.evaluate('async () => await npWeekPlanRead()')
            page.evaluate('''async () => { const wp = await npWeekPlanRead(); Object.keys(wp).forEach(d => { wp[d] = ['知识']; }); await npWeekPlanSave(wp); }''')
            # 标「代发」＝自动排：只进 1 个位子，且就是最早的未来知识位
            page.evaluate('''async (id) => { await npNoteSetStatus(id, '代发'); }''', ap['n1'])
            # wait_store 跑在 background worker 上下文（没有 popup.js 的函数）——按盘上 note_queue 原生轮询
            assert wait_store(page, worker, "chrome.storage.local.get('note_queue').then(d => { const q = d.note_queue || {}; return Object.keys(q).some(k => (q[k] || []).indexOf('%s') >= 0); })" % ap['n1']), '标「代发」＝自动排进最早的未来知识空位'
            ap_info = page.evaluate('''async (id) => {
                const q = await npNoteQueueRead();
                const keys = Object.keys(q).filter(k => (q[k] || []).indexOf(id) >= 0);
                const wp = await npWeekPlanRead();
                const times = await npPubGet(NP_PUB_TIMES_KEY, {});
                const first = npQueueRows(wp).filter(c => c.kind === '知识' && npSlotWhen(c, times) > Date.now())[0];
                return { keys: keys, firstKey: first ? first.key : '' };
            }''', ap['n1'])
            assert ap_info['keys'] == [ap_info['firstKey']] and ap_info['firstKey'], ap_info
            page.evaluate('''async (id) => { await npAutoPlaceNote(id); }''', ap['n1'])
            ap_again = page.evaluate('''async (id) => { const q = await npNoteQueueRead(); return Object.keys(q).filter(k => (q[k] || []).indexOf(id) >= 0); }''', ap['n1'])
            assert ap_again == ap_info['keys'], '再排一次＝不动（幂等）'
            # 标「代发」48 小时内＝行上挂「🆕 刚写好」（老板 2026-10-10：刚写的要一眼认出来）
            # ——趁周排还全勾着看：行是跟着周排位子滚出来的，清空周排后这篇的位子没有对应格子，行也就没有了
            page.locator('#tabNotePublish').click()
            page.locator('#tabNoteQueue').click()
            expect(page.locator('#noteQueueContent')).to_be_visible(timeout=15000)
            queue_tab = page.locator('#nqTabs [data-sec="queue"]')
            if 'active' not in (queue_tab.get_attribute('class') or ''):
                queue_tab.click()
            row_auto1 = page.locator('#noteQueueContent .npq-row', has_text='自动排位·回归知识篇')
            expect(row_auto1).to_contain_text('🆕 刚写好', timeout=10000)
            # 没空位：排法清空 → 案例篇待在「🆕 写好等排期」，行里带「🎯 排进空位」
            page.evaluate('''async () => { const wp = await npWeekPlanRead(); Object.keys(wp).forEach(d => { wp[d] = []; }); await npWeekPlanSave(wp); }''')
            page.evaluate('''async (id) => { await npNoteSetStatus(id, '代发'); await npAutoPlaceNote(id); }''', ap['n2'])
            ap_hit2 = page.evaluate('''async (id) => { const q = await npNoteQueueRead(); return Object.keys(q).some(k => (q[k] || []).indexOf(id) >= 0); }''', ap['n2'])
            assert ap_hit2 is False, '没空位＝不硬塞'
            page.locator('#tabNoteQueue').click()
            expect(page.locator('#noteQueueContent')).to_be_visible(timeout=15000)
            queue_tab2 = page.locator('#nqTabs [data-sec="queue"]')
            if 'active' not in (queue_tab2.get_attribute('class') or ''):
                queue_tab2.click()
            pend2 = page.locator('#noteQueueContent .npq-pendrow', has_text='自动排位·回归案例篇')
            expect(pend2).to_be_visible(timeout=10000)
            expect(pend2).to_contain_text('🎬 案例')
            pend2.locator('[data-np="npq-autoplace"]').click()   # 没空位：点了也排不进
            expect(pend2).to_be_visible(timeout=10000)
            assert page.evaluate('''async (id) => { const q = await npNoteQueueRead(); return Object.keys(q).some(k => (q[k] || []).indexOf(id) >= 0); }''', ap['n2']) is False
            # 去「🧬 笔记规划」加一天（这里直接写周排同效）→ 回来点 🎯 ＝排进最早的未来案例位
            page.evaluate('''async () => { const wp = await npWeekPlanRead(); Object.keys(wp).forEach(d => { wp[d] = ['知识', '案例']; }); await npWeekPlanSave(wp); }''')
            pend2.locator('[data-np="npq-autoplace"]').click()
            assert wait_store(page, worker, "chrome.storage.local.get('note_queue').then(d => { const q = d.note_queue || {}; return Object.keys(q).some(k => (q[k] || []).indexOf('%s') >= 0 && k.indexOf('案例') >= 0); })" % ap['n2']), '有了空位：🎯 一点就排进最早的未来案例位'
            # 没方向：不排、待在待排区标「（还没定方向）」
            page.evaluate('''async (id) => { await npNoteSetStatus(id, '代发'); await npAutoPlaceNote(id); }''', ap['n3'])
            page.evaluate('async () => { await renderNoteQueue(document.getElementById("noteQueueContent")); }')
            pend3 = page.locator('#noteQueueContent .npq-pendrow', has_text='自动排位·回归无方向篇')
            expect(pend3).to_be_visible(timeout=10000)
            expect(pend3).to_contain_text('（还没定方向）')
            assert page.evaluate('''async (id) => { const q = await npNoteQueueRead(); return Object.keys(q).some(k => (q[k] || []).indexOf(id) >= 0); }''', ap['n3']) is False, '没方向＝不排'
            page.screenshot(path=str(out / 'notepublish-autoplace.png'), full_page=True)
            check(page, '🆕 写好自动排位子：标「代发」＝排进最早的未来同类空位（幂等）；没空位/没方向 → 发布台顶「🆕 写好等排期」＋🎯 排进空位（加了排法再点就进）')
            # 清场：删三篇种子、清队列、周排还原
            page.evaluate('''async (ids) => {
                const list = (await npNotesAll()).filter(x => !x || ids.indexOf(x.id) < 0);
                await chrome.storage.local.set({ [NP_NOTES_KEY]: list, note_queue: {} });
            }''', [ap['n1'], ap['n2'], ap['n3']])
            page.evaluate('''async (prev) => { await npWeekPlanSave(prev); }''', wp_ap_prev)
            # ═══════ 📚 #9 素材库＝集合（镜像 demo v41 十五改）═══════════════════════
            # 案例流定义完段就自动入库：验「剪段入库|篇id」集合、段 ref 指回本篇素材、存档定名后集合跟着改名
            auto_col = page.evaluate('''async (caseId) => {
                const cols = await npCollectionsRead();
                const clips = await npClipsRead();
                const col = cols.filter(c => c && String(c.source || '') === '剪段入库|' + caseId)[0] || null;
                if (!col) return null;
                const mine = clips.filter(c => c && c.col === col.id);
                return { name: col.name, segs: mine.length, ref: String((mine[0] || {}).ref || '') };
            }''', case_note['id'])
            assert auto_col and auto_col['segs'] >= 2, auto_col
            assert auto_col['ref'].startswith('mat:' + case_note['id'] + ':'), auto_col
            assert auto_col['name'] == '案例成片·回归测试', auto_col
            check(page, '📚 案例剪段自动入库：「剪段入库|篇id」集合＋段 ref 指回本篇素材；存回档案定名＝集合跟着改名')
            # 种现场：两个缺口集合（一个对卖点带图、一个对知识库是空的）＋ 一篇挂这两条来源的草稿
            seed9 = page.evaluate('''async () => {
                const prevCols = await npCollectionsRead();
                const prevClips = await npClipsRead();
                window.__np9prev = { cols: prevCols, clips: prevClips };
                const thumb = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
                const colA = { id: 'col9-sell', name: '缺口卖点X', desc: '回归测试：对卖点「缺口卖点X」的集合（有 1 张图）', source: 'sell|缺口卖点X', manual: false, link: null, at: 1 };
                const colB = { id: 'col9-kb', name: '缺口知识X', desc: '回归测试：对知识库《缺口知识X》的空集合（待补充）', source: 'kb|缺口知识X', manual: false, link: null, at: 2 };
                await npCollectionsWrite(prevCols.concat([colA, colB]));
                await npClipsWrite(prevClips.concat([
                    { id: 'clip9-img', col: 'col9-sell', imgOnly: true, src: '现场图1.jpg', stage: '', kb: null, vo: '', tags: [], fo: [], thumb: thumb, w: 120, h: 80, ref: '', at: 3 },
                ]));
                const d = await chrome.storage.local.get(NP_NOTES_KEY);
                await chrome.storage.local.set({ [NP_NOTES_KEY]: (d.np_notes || []).concat([
                    { id: 'n9-gap', title: '缺口篇·回归测试', status: '草稿', dir: 'k', form: '图文', voice: '',
                      sellPoints: [{ point: '缺口卖点X' }], kb: [{ title: '缺口知识X' }], draft: '回归测试用的篇。',
                      createdAt: Date.now(), updatedAt: Date.now() },
                ]) });
                const cols = await npCollectionsRead();
                const clips = await npClipsRead();
                return { nCols: cols.length, nSegs: clips.filter(c => c && !c.imgOnly).length, nImgs: clips.filter(c => c && c.imgOnly).length };
            }''')
            assert seed9['nSegs'] >= 2 and seed9['nImgs'] >= 1, seed9
            # 集合墙：计数现算（案例剪段那个集合也在），一行一集＝名字＋来源 chip＋计数/待补充＋说明
            page.locator('#tabNoteAssets').click()
            expect(page.locator('#noteAssetsContent')).to_be_visible(timeout=15000)
            expect(page.locator('#noteAssetsContent')).to_contain_text('📚 素材库')
            expect(page.locator('#noteAssetsContent')).to_contain_text(
                f"{seed9['nCols']} 个集合 · {seed9['nSegs']} 段视频 · {seed9['nImgs']} 张图")
            expect(page.locator('#noteAssetsContent .npas-gen')).to_have_text('🤖 AI 整理素材')
            expect(page.locator('#noteAssetsContent .npas-new-open')).to_have_text('➕ 新建集合')
            rowA = page.locator('#noteAssetsContent .npas-col-open', has_text='缺口卖点X')
            rowB = page.locator('#noteAssetsContent .npas-col-open', has_text='缺口知识X')
            expect(rowA).to_have_count(1, timeout=10000)
            expect(rowA).to_contain_text('卖点「缺口卖点X」')
            expect(rowA).to_contain_text('0 段视频 · 1 张图')
            expect(rowB).to_have_count(1)
            expect(rowB).to_contain_text('知识库「缺口知识X」')
            expect(rowB).to_contain_text('🖼 待补充 · 还没料')
            # 搜集合名 / 说明 / 素材词一起搜
            page.locator('#noteAssetsContent #npasQ').fill('缺口知识')
            expect(page.locator('#noteAssetsContent .npas-col-open')).to_have_count(1, timeout=10000)
            page.locator('#noteAssetsContent #npasQ').fill('')
            expect(page.locator('#noteAssetsContent .npas-col-open')).to_have_count(seed9['nCols'], timeout=10000)
            # 档案那侧：「⚠ 还缺 1 项」点进素材库＝红框高亮缺料集合（有料的集合不算缺）
            page.locator('#tabNoteArchive').click()
            expect(page.locator('.npar-list')).to_be_visible(timeout=15000)
            row9 = page.locator('.npar-list .npar-row', has_text='缺口篇·回归测试')
            expect(row9).to_have_count(1, timeout=10000)
            gap9 = row9.locator('.npar-gap')
            expect(gap9).to_have_count(1)
            expect(gap9).to_contain_text('⚠ 还缺 1 项（缺口知识X）')
            gap9.click()
            expect(page.locator('#popToastBox')).to_contain_text('还缺料的 1 个集合在下面（红框）')
            expect(page.locator('#noteAssetsContent')).to_be_visible(timeout=15000)
            expect(page.locator('#noteAssetsContent .npas-focus')).to_have_count(1, timeout=10000)
            expect(page.locator('#noteAssetsContent')).to_contain_text('还缺料的 1 个集合在下面（红框）')
            assert page.locator('#noteAssetsContent .npas-col-open.npas-focus', has_text='缺口卖点X').count() == 0, '有 1 张图的集合不算缺口，不该被红框'
            page.screenshot(path=str(out / 'notepublish-assets-wall.png'), full_page=True)
            check(page, '📚 素材库集合墙：一行一集（名字＋来源 chip＋「N 段视频 · N 张图」/「🖼 待补充 · 还没料」＋说明）；搜集合名/说明/素材词一起搜；档案「⚠ 还缺 N 项」点击＝跳素材库红框高亮缺料集合')
            # 内页：空集合＝amber 空态；非手工集合不出「🔗 关联」，也没连播卡
            expect(rowB).to_be_visible(timeout=10000)
            rowB.click()
            expect(page.locator('#noteAssetsContent .npas-back')).to_have_text('← 返回素材库', timeout=10000)
            expect(page.locator('#noteAssetsContent')).to_contain_text('🕐 这个集合还没料')
            expect(page.locator('#noteAssetsContent .npas-up')).to_have_text('📁 传本机图')
            expect(page.locator('#noteAssetsContent .npas-col-del')).to_have_text('✕ 删集合')
            assert page.locator('#noteAssetsContent .npas-assoc').count() == 0, '非手工集合不出「🔗 关联」'
            assert page.locator('#noteAssetsContent #npasStage').count() == 0, '没视频段不出连播卡'
            page.locator('#noteAssetsContent .npas-back').click()
            expect(rowA).to_be_visible(timeout=10000)
            # 有图的集合：图墙出「🖼 只有图 · 还没剪」＋缩略图；× 删条＝回到空态
            rowA.click()
            expect(page.locator('#noteAssetsContent .npas-item-del')).to_have_count(1, timeout=10000)
            expect(page.locator('#noteAssetsContent')).to_contain_text('🖼 只有图 · 还没剪')
            assert page.locator('#noteAssetsContent img[src^="data:image/"]').count() >= 1, '缩略图要显示出来'
            assert page.locator('#noteAssetsContent #npasStage').count() == 0, '只有图也不出连播卡'
            page.screenshot(path=str(out / 'notepublish-assets-inner.png'), full_page=True)
            page.locator('#noteAssetsContent .npas-item-del').click()
            expect(page.locator('#popToastBox')).to_contain_text('删掉了这条素材记录')
            expect(page.locator('#noteAssetsContent')).to_contain_text('🕐 这个集合还没料', timeout=10000)
            assert page.locator('#noteAssetsContent .npas-item-del').count() == 0, '删掉的条不再出现'
            page.locator('#noteAssetsContent .npas-back').click()
            expect(rowB).to_be_visible(timeout=10000)
            # ✕ 删集合＝原生 confirm；删完回墙，这个集合没了
            rowB.click()
            expect(page.locator('#noteAssetsContent .npas-col-del')).to_be_visible(timeout=10000)
            def on_dlg9(d):
                assert d.type == 'confirm', d.type
                d.accept()
            page.once('dialog', on_dlg9)
            try:
                with page.expect_event('dialog'):
                    page.locator('#noteAssetsContent .npas-col-del').click()
            finally:
                page.remove_listener('dialog', on_dlg9)
            expect(page.locator('#popToastBox')).to_contain_text('集合删掉了')
            expect(page.locator('#noteAssetsContent .npas-col-open', has_text='缺口知识X')).to_have_count(0, timeout=10000)
            check(page, '📚 集合内页：← 返回 / 📁 传本机图 / ✕ 删集合（原生 confirm）；空集合＝「🕐 这个集合还没料」；纯图条＝「🖼 只有图 · 还没剪」＋ × 删条；非手工集合不出「🔗 关联」')
            # 清场：种的两个集合与那篇撤掉
            cleaned = page.evaluate('''async () => {
                const p = window.__np9prev || null;
                if (p) { await npCollectionsWrite(p.cols); await npClipsWrite(p.clips); }
                const d = await chrome.storage.local.get(NP_NOTES_KEY);
                await chrome.storage.local.set({ [NP_NOTES_KEY]: (d.np_notes || []).filter(n => !(n && n.id === 'n9-gap')) });
                window.__np9prev = null;
                const cols = await npCollectionsRead();
                return { left: cols.filter(c => String(c.name || '').indexOf('缺口') === 0).length };
            }''')
            assert cleaned['left'] == 0, cleaned
            # 老「备图清单」（np_asset_needs / np_assets）→ 集合：只迁不删、幂等
            m9 = page.evaluate('''async () => {
                const prevCols = await npCollectionsRead();
                const prevClips = await npClipsRead();
                const prevNeeds = ((await chrome.storage.local.get(NP_NEED_KEY))[NP_NEED_KEY]) || null;
                const prevAssets = await npAsAssetsRead();
                const cfg = await readConfigPlain();
                cfg.product = cfg.product || {};
                const sellsPrev = JSON.parse(JSON.stringify(cfg.product.sellPoints || []));
                cfg.product.sellPoints = sellsPrev.concat([{ title: '迁移卖点X', content: '迁移回归种子' }]);
                await writeConfigPlain(cfg);
                const kbRes = await chrome.runtime.sendMessage({ action: 'getKnowledgeBase' });
                const sellNames = cfg.product.sellPoints.map(s => String((s && s.title) || '').trim()).filter(Boolean);
                const kbTitle = (((kbRes && kbRes.entries) || [])
                    .filter(e => e && e.isActive !== false && e.title).map(e => String(e.title).trim())
                    .find(t => t && !sellNames.some(s => s === t || s.includes(t) || t.includes(s)))) || '';
                const thumb = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
                await chrome.storage.local.set({ [NP_NEED_KEY]: { needs: [
                    { id: 'nd-m1', title: '迁移手工项X', spec: '手工加的，说明一句', manual: true, createdAt: 1 },
                    { id: 'nd-m2', title: '迁移卖点项X', spec: '对卖点的', source: '迁移卖点X', createdAt: 2 },
                    { id: 'nd-m3', title: '迁移知识项X', spec: '对知识库的', source: kbTitle, createdAt: 3 },
                ] } });
                await npAsAssetsWrite(prevAssets.concat([
                    { id: 'as-m1', needId: 'nd-m2', name: '本机图A.jpg', thumb: thumb, w: 120, h: 80, addedAt: 4 },
                ]));
                const n1 = await npAssetsMigrate();
                const n2 = await npAssetsMigrate();
                const cols = await npCollectionsRead();
                const clips = await npClipsRead();
                const needsAfter = ((await chrome.storage.local.get(NP_NEED_KEY))[NP_NEED_KEY]) || {};
                const assetsAfter = await npAsAssetsRead();
                const pick = (nm) => cols.filter(c => c && c.name === nm)[0] || null;
                const out = {
                    n1: n1, n2: n2, kbUsed: kbTitle,
                    manual: pick('迁移手工项X'), sell: pick('迁移卖点项X'), kb: pick('迁移知识项X'),
                    clip: clips.filter(c => c && c.id === 'as-m1')[0] || null,
                    needsKept: (needsAfter.needs || []).length,
                    assetsKept: assetsAfter.filter(a => a && a.id === 'as-m1').length,
                };
                await npCollectionsWrite(prevCols);
                await npClipsWrite(prevClips);
                if (prevNeeds === null) await chrome.storage.local.remove(NP_NEED_KEY);
                else await chrome.storage.local.set({ [NP_NEED_KEY]: prevNeeds });
                await npAsAssetsWrite(prevAssets);
                const cfg2 = await readConfigPlain();
                cfg2.product.sellPoints = sellsPrev;
                await writeConfigPlain(cfg2);
                return out;
            }''')
            assert m9['n1'] == 4 and m9['n2'] == 0, m9           # 3 个集合 + 1 张老图 进库；重跑 0 新增
            assert m9['manual'] and m9['manual']['source'] == '自己加的' and m9['manual']['manual'] is True and m9['manual']['link'] is None, m9['manual']
            assert m9['sell'] and m9['sell']['source'] == 'sell|迁移卖点X', m9['sell']
            expected_kb9 = ('kb|' + m9['kbUsed']) if m9['kbUsed'] else ''
            assert m9['kb'] and m9['kb']['source'] == expected_kb9, (m9['kb'], m9['kbUsed'])
            clip9 = m9['clip'] or {}
            assert clip9.get('imgOnly') is True and clip9.get('src') == '本机图A.jpg', clip9
            assert clip9.get('thumb') and clip9.get('col') == m9['sell']['id'], clip9
            assert m9['needsKept'] == 3 and m9['assetsKept'] == 1, m9   # 老键只迁不删
            check(page, '📚 老「备图清单」→ 集合：3 个需求建成集合（manual→「自己加的」、认卖点/kb 来源）、老图带缩略图进纯图段；再跑 0 新增（幂等）；老键原样保留（只迁不删）')
            # ═══════ 📊 #10 复盘增补：表现列＋勾选排进本周计划（镜像 demo 二十改）═══════════
            # 种现场：知识库 2 条「笔记架构」（一条被已发篇写过、一条没写过）＋一篇已发（2 天前、120 赞）
            # ＋抓主页 stats；排产表 items 先清空（快照留着，用完原样还回去）。
            # 知识库在存储里是加密的（enc:v1:），只能走消息接口：整份快照 → merge 两条 → 用完 replace 还原
            kb_prev10 = send(page, 'getKnowledgeBase')['entries']
            merge10 = send(page, 'saveKnowledgeBase', {'mode': 'merge', 'entries': [
                {'id': 'kb10-pub', 'title': '已发过的知识X', 'content': '回归测试：这条已被一篇已发笔记写过。', 'category': '笔记架构', 'tags': [], 'isActive': True},
                {'id': 'kb10-never', 'title': '没写过的知识X', 'content': '回归测试：这条还没写过，等着排进本周。', 'category': '笔记架构', 'tags': [], 'isActive': True},
            ]})
            assert merge10.get('added') == 2, merge10
            seed10 = page.evaluate('''async () => {
                const st = await chrome.storage.local.get(['note_plan', 'note_stats', NP_NOTES_KEY]);
                window.__np10prev = {
                    plan: st.note_plan || null,
                    stats: st.note_stats || null,
                    noteIds: ((st[NP_NOTES_KEY] || []).map(n => n && n.id)).filter(Boolean),
                };
                const now = Date.now();
                const p = (st.note_plan && typeof st.note_plan === 'object') ? st.note_plan : {};
                p.items = [];
                await chrome.storage.local.set({ note_plan: p });
                await chrome.storage.local.set({ [NP_NOTES_KEY]: ((st[NP_NOTES_KEY] || []).filter(n => !(n && n.id === 'n10-pubtest'))).concat([
                    { id: 'n10-pubtest', title: '回归测试·已发知识篇', status: '已发', dir: 'k', form: '图文', voice: '样例稿子',
                      url: 'https://www.xiaohongshu.com/explore/n10exp01', statusAt: { '已发': now - 2 * 86400e3 },
                      kb: [{ id: 'kb10-pub', title: '已发过的知识X' }], draft: '回归测试用的篇。',
                      createdAt: now, updatedAt: now },
                ]) });
                await chrome.storage.local.set({ note_stats: Object.assign({}, st.note_stats || {}, {
                    n10exp01: { likes: 120, collects: 5, comments: 1, raw: '120', fetchedAt: now },
                }) });
                return { ok: true };
            }''')
            assert seed10['ok'] is True, seed10
            wp10 = json.loads(page.evaluate('async () => JSON.stringify(await npWeekPlanRead())'))
            _d10 = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
            _lab10 = {'mon': '周一', 'tue': '周二', 'wed': '周三', 'thu': '周四', 'fri': '周五', 'sat': '周六', 'sun': '周日'}
            pool10 = [d for d in _d10 if '知识' in (wp10.get(d) or [])] or ['mon']
            exp_day10 = _d10.index(pool10[0]) + 1
            exp_lab10 = _lab10[pool10[0]]
            # 进复盘页：类表出「表现」列——这一行＝已发 1 篇 · 日均赞 ≈60（120 赞 ÷ 2 天）
            page.locator('#tabNoteReview').click()
            row10 = page.locator('#auditTopicsPane tr[data-cat="笔记架构"]').first
            expect(row10).to_be_visible(timeout=15000)
            expect(page.locator('#auditTopicsPane thead th').last).to_have_text('表现')
            expect(row10.locator('td').last).to_contain_text('已发 1 篇 · 日均赞 ≈60')
            expect(row10).to_contain_text('有空白 + 有表现')
            expect(page.locator('#auditTopicsPane tr[data-cat="笔记架构"] td.audit-tbl-sub')).to_contain_text('没写过的知识X')
            page.screenshot(path=str(out / 'notepublish-review-perf.png'), full_page=True)
            check(page, '📊 选题盘点「表现」列：这类条目被已发篇写过＝已发 N 篇 · 日均赞 ≈X（120 赞 ÷ 2 天＝≈60）')
            # 「—」档（还没抓过主页的口径）：抽掉 stats → 两个横 tab 换回来重画 → 表现位只剩「—」
            page.evaluate('async () => { await chrome.storage.local.remove("note_stats"); }')
            page.locator('#noteReviewContent .audit-tab[data-atab="sent"]').click()
            page.locator('#noteReviewContent .audit-tab[data-atab="topics"]').click()
            expect(page.locator('#auditTopicsPane tr[data-cat="笔记架构"]').first.locator('td').last).to_have_text('—', timeout=15000)
            check(page, '📊 没抓过主页时「表现」列给「—」；复盘两个横 tab（选题盘点 / 已发复盘）换页重画都通')
            # 「没写过」条目勾选 →「📅 排进本周计划」：写回排产表 note_plan＋重开 modal 挂「📅 已排 周X」
            page.locator('#auditTopicsPane tr[data-cat="笔记架构"]').first.click()
            modal10 = page.locator('.audit-modal')
            expect(modal10).to_be_visible(timeout=10000)
            expect(modal10).to_contain_text('还没写过（1 条）')
            cb10 = modal10.locator('.audit-pick[data-pkey="没写过的知识X"]')
            expect(cb10).to_have_count(1)
            push10 = modal10.locator('.audit-plan-push')
            expect(push10).to_be_disabled()
            cb10.click()
            expect(push10).to_contain_text('已勾 1 条')
            expect(push10).to_be_enabled()
            push10.click()
            expect(page.locator('#popToastBox')).to_contain_text('已把 1 条排进本周计划——写回排产表了', timeout=10000)
            expect(page.locator('.audit-modal .audit-planned-badge')).to_contain_text('📅 已排 ' + exp_lab10, timeout=10000)
            li10 = page.locator('.audit-modal li', has_text='没写过的知识X')
            expect(li10).to_contain_text('📅 已排 ' + exp_lab10)
            assert li10.locator('.audit-pick').count() == 0, '排过的条目不再给勾选框'
            items10 = worker.evaluate('async () => (((await chrome.storage.local.get("note_plan")).note_plan) || {}).items || []')
            assert len(items10) == 1, items10
            assert items10[0]['no'] == 1 and items10[0]['title'] == '没写过的知识X' and items10[0]['type'] == 'howto' and items10[0]['done'] is False, items10
            assert items10[0]['day'] == exp_day10, (items10, pool10)
            check(page, '📊 「没写过」条目勾选 →「📅 排进本周计划」：写回排产表（note_plan 追加 title/type=howto/day=知识日池首位）；重开 modal 该条转「📅 已排 周X」、勾选框收走')
            page.locator('.audit-modal').click(position={'x': 5, 'y': 5})   # 点浮层边＝关掉
            expect(page.locator('.audit-modal')).to_have_count(0, timeout=5000)
            # 写文案 ① 挑知识：顶上「📚 按规划发」把刚排进本周的条目摆成「下一篇该发」
            #   （二十九改：卡从撤掉的「定话题」站挪到 ① 挑知识页顶上——不再点 next 到下一站看，直接在这一页验）
            page.locator('#tabNotePublish').click()
            expect(page.locator('.npar-new')).to_be_visible(timeout=10000)
            page.locator('.npar-new').click()
            expect(page.locator('#dirModal.open')).to_be_visible(timeout=10000)
            page.locator('#dirBox [data-direff="k|图文"]').click()
            expect(page.locator('#npWizBody')).to_be_visible(timeout=15000)
            expect(page.locator('#npWizBody')).to_contain_text('📚 这篇讲哪条知识', timeout=15000)   # ① 摆出来（三十六改：清单默认收着，别等可见的勾选框）
            expect(page.locator('#npWizBody')).to_contain_text('📚 按规划发', timeout=25000)
            expect(page.locator('#npWizBody')).to_contain_text('下一篇该发：')
            expect(page.locator('#npWizBody')).to_contain_text('1. 没写过的知识X')
            expect(page.locator('#npWizBody')).to_contain_text('知识·干货')   # meta＝typeOf('howto').name（emoji 在字段里，不拼进字符串）
            check(page, '📚 写文案 ① 挑知识：「📚 按规划发」把刚排进本周的条目摆成「下一篇该发：1. 没写过的知识X（知识·干货）」（二十九改：卡从撤掉的「定话题」站挪来）')
            # 清场：知识（replace 还快照）/已发篇/stats/排产表全数还原（只留早前用例的档）
            clean10 = page.evaluate('''async () => {
                const p = window.__np10prev; window.__np10prev = null;
                if (!p) return { ok: false };
                if (p.plan === null) await chrome.storage.local.remove('note_plan');
                else await chrome.storage.local.set({ note_plan: p.plan });
                if (p.stats === null) await chrome.storage.local.remove('note_stats');
                else await chrome.storage.local.set({ note_stats: p.stats });
                const nd = await chrome.storage.local.get(NP_NOTES_KEY);
                const kept = (nd.np_notes || []).filter(n => n && p.noteIds.indexOf(n.id) >= 0);
                await chrome.storage.local.set({ [NP_NOTES_KEY]: kept });
                return { ok: true, left: kept.filter(n => n.id === 'n10-pubtest').length };
            }''')
            assert clean10['ok'] is True and clean10['left'] == 0, clean10
            if kb_prev10:
                send(page, 'saveKnowledgeBase', {'mode': 'replace', 'entries': kb_prev10})
            else:
                send(page, 'clearKnowledgeBase')
            left10 = [e['title'] for e in send(page, 'getKnowledgeBase')['entries'] if e['title'] in ('已发过的知识X', '没写过的知识X')]
            assert left10 == [], left10
            check(page, '#10 清场：种的知识（replace 还快照）/已发篇/抓主页 stats 全撤，排产表 items 还原（第内向导草稿也随手清掉）')

            # 封面设置已整体删除（2026-09-22 用户拍板）：向导里没有、设置页也没有
            expect(page.locator('#npCoverCfg')).to_have_count(0)
            page.goto(f'chrome-extension://{eid}/settings.html#product')
            page.wait_for_load_state('domcontentloaded')
            expect(page.locator('.tab-item[data-tab="cover"]')).to_have_count(0)
            expect(page.locator('#tab-cover')).to_have_count(0)
            expect(page.locator('#saveCoverBtn')).to_have_count(0)
            expect(page.locator('#coverGenBtn')).to_have_count(0)
            cover_ai = len(STATE['requests'])
            # 设置页去重：产品名称/卖点/人设/说话风格都在「诊断&配置」（① 基础配置 / ④ 产品卖点 / ③ 人设 / ⑥ 说话风格）
            # 「杂项配置」整页已并进 ①（原 persona 页整块并入，不再单开 tab），设置页连面板都没有
            expect(page.locator('#tab-product')).to_have_count(0)
            expect(page.locator('.tab-item[data-tab="persona"]')).to_have_count(0)
            expect(page.locator('#styleTemplateSelect')).to_have_count(0)
            expect(page.locator('#myAccountNames')).to_have_count(0)
            expect(page.locator('#sameCityModeSelect')).to_have_count(0)
            expect(page.locator('#diagProdGuide')).to_have_count(0)      # 评论区承接只在弹窗 ①
            expect(page.locator('#productName')).to_have_count(0)
            expect(page.locator('#sellPointList')).to_have_count(0)
            expect(page.locator('#addSellPointBtn')).to_have_count(0)
            expect(page.locator('#personaBuildWrap')).to_have_count(0)   # AI 建人设收进「诊断&配置 → ③ 人设」
            expect(page.locator('#personaBio')).to_have_count(0)
            expect(page.locator('#toneMannerisms')).to_have_count(0)     # 字数/3 问口吻问卷都在「诊断&配置 → ⑥ 说话风格」
            expect(page.locator('#purposeMinChars')).to_have_count(0)
            expect(page.locator('#personaSample')).to_have_count(0)
            page.goto(f'chrome-extension://{eid}/settings.html#leadtask')
            expect(page.locator('#tab-leadtask.tab-panel.active')).to_be_visible()
            expect(page.locator('#tab-aics')).to_have_count(0)            # 客服话术不再是设置页的独立 Tab
            expect(page.locator('#ltCfgTabs .cfgtab')).to_have_text(
                ['🎙 渠道基调', '💰 成交引导', '🗨 话术配置', '🧪 试问答'])
            expect(page.locator('#aicsChannels')).to_have_count(0)        # 渠道基调收成横 tab 里的一节，不再单挂一块
            expect(page.locator('#trGuideDeliver')).to_be_hidden()        # 💰 成交引导也在同一页，只是横 tab 先停在第一节
            expect(page.locator('#aicsQa')).to_have_count(0)              # 点「🗨 话术配置」才挂载
            page.locator('#ltCfgTabs .cfgtab[data-sec="qa"]').click()
            expect(page.locator('#aicsQa')).to_be_visible(timeout=20000)
            assert len(STATE['requests']) == cover_ai
            assert not errors, errors
            page.screenshot(path=str(out / 'settings-no-cover.png'), full_page=True)
            check(page, '封面设置已删干净：向导与设置页都没有该 Tab / 面板 / 按钮；设置页与诊断页不重复配置（产品名称/卖点/人设/话术风格只管一处）')
            assert not errors, errors
            print('PASS: no page errors', flush=True)
        finally:
            context.close()
            server.shutdown()


if __name__ == '__main__':
    run()
