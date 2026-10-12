"""重截 资料/视频/pdf素材/ 的演示截图：造一份数据 + 一个假 AI 服务，
把 02 / 02b / 03 / 04 / 05 / 06 / 08 / 09 这 8 张按**现行界面**重拍一遍。
01_笔记评论区.png 是真实小红书页面，脚本拍不了，沿用旧图不动。

用法：python3 scripts/dev/shot_pdf_assets.py [输出目录]
默认输出：资料/视频/pdf素材/
"""
import json
import os
import pathlib
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(os.environ.get('XHS_ROOT') or '.').resolve()
EXT = ROOT / 'extension'
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / '资料' / '视频' / 'pdf素材')
OUT.mkdir(parents=True, exist_ok=True)

NOTE_TITLE = '月供 8000 怎么提前还款最省——把两个坑先避开'

# ── 假 AI：只回「商机话术」那一发（工作台扫描），别的场景一律回空对象 ──
PROSPECTS = {
    'summary': '评论区里 3 条有明显需求：一条在问怎么算、一条被中介坑过、一条在纠结要不要提前还。',
    'prospects': [
        {
            'comment_index': 0,
            'author': '小柚子妈妈',
            'original_comment': '完全看不懂，等额本息和等额本金到底哪个划算啊，求个能算明白的办法',
            'opportunity': '求助型：直接求「怎么算」，把自己的账算不清摆在明面上，等于开口要方法。',
            'location': '广东',
            'same_city': True,
            'suggested_copies': [
                '我一开始也绕不明白这个，后来是拿计算器把两种还款方式按自己真实的贷款额、年限各跑了一遍，月供差和总利息差一下就出来了。你要是懒得比，把你的贷款额和年限发我，我帮你把两组数拉出来对比。',
                '这个别听人讲，一讲就晕。我自己是把两种方式的月供和总利息都算了一遍，差多少一眼就看出来了——你也可以先自己算一遍，算完就知道该怎么选。',
            ],
            'copy_labels': ['获客·实用教程流', '获客·数据科普流'],
        },
        {
            'comment_index': 3,
            'author': '拆迁户老周',
            'original_comment': '上次中介给我算的跟银行对不上，多算了小两万，气死我了',
            'opportunity': '被坑型：已经吃过亏、带着情绪，需要的是避坑依据和一句「怎么自己核」。',
            'location': '浙江',
            'same_city': False,
            'suggested_copies': [
                '这种最气人，中介拿的是约数还往高了报，签之前一定要自己核一遍：把贷款额、利率、年限输进去，月供和总利息当场出来，跟银行给的数对一下，差得多就当场问。我每次都这么核，没再吃过这种亏。',
            ],
            'copy_labels': ['获客·避雷防坑流'],
        },
        {
            'comment_index': 5,
            'author': '不想上班了',
            'original_comment': '手里有 30 万，是提前还款好还是留着好，纠结好几个月了',
            'opportunity': '纠结型：钱已经到位、只差一个判断，给一个能自己算出口径的方法就能推他一把。',
            'location': '江苏',
            'same_city': False,
            'suggested_copies': [
                '这个纠结我懂，我当年也这么卡了半年。后来想通一个口径：先把提前还省下的利息和这笔钱留在手里的收益各算一遍，哪个高就选哪个——数字一出来，纠结就没了。',
                '别凭感觉，凭数字。你按自己的利率把「提前还省多少利息」算出来，再跟这笔钱放别处的收益比一下，高低立判。',
            ],
            'copy_labels': ['获客·反向共情流', '获客·对比测评流'],
        },
    ],
}


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _cors(self):
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()

    def do_GET(self):
        self.send_response(200)
        self._cors()
        self.wfile.write(b'{"ok":true}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        system = body['messages'][0]['content']
        if '快速筛选员' in system:      # 快筛：判定价值评论编号
            content = json.dumps({
                'capture_ok': True, 'capture_problem': '',
                'valuable_indexes': [p['comment_index'] for p in PROSPECTS['prospects']],
                'selected_kb_ids': [],
                'summary': '有 3 条明确需求，其余是围观和感慨。',
            }, ensure_ascii=False)
        elif '选稿人' in system:      # best_picker：给多版话术挑一版
            picks = [{'comment_index': p['comment_index'], 'best': 0} for p in PROSPECTS['prospects']]
            content = json.dumps(picks, ensure_ascii=False)
        elif '商机' in system or '话术' in system:
            content = json.dumps(PROSPECTS, ensure_ascii=False)
        else:
            content = '{}'
        print('  ai:', ('筛选员' if '快速筛选员' in system else '选稿人' if '选稿人' in system else '商机' if '商机' in system else '其它'), flush=True)
        payload = json.dumps({'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}], 'usage': {}}, ensure_ascii=False).encode()
        self.send_response(200)
        self._cors()
        self.wfile.write(payload)


# ── 页面内造数据：队列 / 笔记池 / 评论记录 / 诊断报告 / 产品卖点 ──
SEED_PAGE = r"""
async (noteTitle) => {
  const NOTE_TITLE = noteTitle;
  const now = Date.now(), H = 3600000, M = 60000, D = 86400000;
  /* 统计口径：今天灌了多少（评论记录 + 队列顶栏的「今日评论」） */
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const scan = {
    v: 4, city: '深圳', painWords: ['求推荐', '听劝'],
    typeRun: {
      latest: { mode: 'each' }, top: { mode: 'interval', hours: 6 },
      local: { mode: 'interval', hours: 6 }, pain: { mode: 'interval', hours: 12 },
      rival: { mode: 'off' },
    },
    acctRun: { highv: { mode: 'interval', hours: 12 }, rival: { mode: 'off' } },
    kwRuns: {
      '房贷计算': { top: now - 8 * H, local: now - 3 * H, pain: now - 30 * M },
      '提前还款划算吗': { latest: now - 22 * M, top: now - 2 * H, pain: now - 26 * H },
    },
    keywords: [
      { k: '房贷计算', on: true, src: 'manual', types: { latest: true, top: true, local: true, pain: true, rival: false } },
      { k: '提前还款划算吗', on: true, src: 'ai', types: { latest: true, top: true, local: true, pain: true, rival: false } },
      { k: '公积金贷款额度', on: true, src: 'topic', types: { latest: true, top: true, local: false, pain: true, rival: false } },
      { k: '装修报价', on: true, src: 'topic', types: { latest: true, top: true, local: true, pain: false, rival: false } },
    ],
    accounts: [
      { k: 'https://www.xiaohongshu.com/user/profile/5f1a2b3c0000000001007a1b?xsec_token=ABtok1', name: '房奴自救指南', on: true, scenario: 'highv' },
      { k: 'https://www.xiaohongshu.com/user/profile/6a2b3c4d0000000002008b2c?xsec_token=ABtok2', name: '深圳楼市观察', on: true, scenario: 'rival' },
    ],
  };
  const queue = {
    v: 1,
    running: { k: '房贷计算', scenario: 'latest', at: now - 3 * M, note: '正在跑' },
    carry: [{ k: '装修报价', scenario: 'top', at: now - 2 * H, note: '上一轮还剩 2 篇没跑' }],
    manual: [],
    done: [
      { k: '房贷计算', scenario: 'top', at: now - 3 * H, foundN: 9, commentN: 3,
        notes: [{ t: '等额本息和等额本金到底选哪个', s: 2 }, { t: '贷款 100 万 30 年真实月供', s: 1 }] },
      { k: '提前还款划算吗', scenario: 'latest', at: now - 70 * M, foundN: 12, commentN: 4,
        notes: [{ t: '月供 8000 怎么提前还款最省', s: 2 }, { t: '30 年 vs 20 年，差的不是利息', s: 1 }] },
      { k: '公积金贷款额度', scenario: 'latest', at: now - 5 * H, foundN: 7, commentN: 3,
        notes: [{ t: '公积金能贷多少？一算就清楚', s: 2 }, { t: '深圳公积金基数上调了', s: 1 }] },
    ],
  };
  /* 笔记池：四种状态各来一篇（含作废、含我的评论） */
  const mkNote = (i, o) => Object.assign({
    id: 'n' + i, scenario: 'latest', noteId: '65f0' + i + 'aabbccdd',
    url: 'https://www.xiaohongshu.com/explore/65f0' + i + 'aabbccdd',
    title: NOTE_TITLE, author: '房奴自救指南', addedAt: now - i * H, lastJudgedAt: now - i * 20 * M,
    signals: { rank: 0, delta: 0 },
  }, o);
  const notes = [
    mkNote(1, { scenario: 'latest', signals: { likes: 12800, comments: 342, subComments: 89, delta: 260, rank: 2 } }),
    mkNote(2, { scenario: 'top', title: '等额本息和等额本金到底选哪个？我把 30 年账单拉出来算了一遍',
      signals: { likes: 45210, comments: 1204, subComments: 366, delta: -12, rank: 7, myComment: { found: true, checked: true, rank: 3, likes: 41, seen: true } } }),
    mkNote(3, { scenario: 'local', title: '深圳买房组合贷怎么走流程（附我踩过的 3 个点）', author: '深圳楼市观察',
      signals: { likes: 862, comments: 47, subComments: null, delta: 15, rank: 5 } }),
    mkNote(4, { scenario: 'pain', title: '求推荐！提前还款到底划不划算，听劝', author: '小柚子妈妈',
      signals: { likes: 233, comments: 96, subComments: 12, delta: 4, rank: 1, myComment: { checked: true, found: false } } }),
    mkNote(5, { scenario: 'highv', title: '手里 30 万，提前还款还是留着？', author: '不想上班了', dead: true, deadAt: now - 2 * H, deadReason: '标题+作者都搜不到',
      signals: { likes: 99000, comments: 888, subComments: 210, delta: 0, rank: 0 } }),
  ];
  /* 评论记录：今天 7 条 · 昨天 5 条 */
  const logs = [];
  const pushLog = (hoursAgo, title, author, comment, reply) => logs.push({
    ts: now - hoursAgo * H, noteTitle: title, author: author, comment: comment, replyText: reply,
    source: hoursAgo < 1 ? 'batch' : 'single',
  });
  pushLog(0.3, NOTE_TITLE, '小柚子妈妈', '完全看不懂，等额本息和等额本金到底哪个划算啊', '我一开始也绕不明白这个，后来是拿计算器把两种还款方式按自己真实的贷款额各跑了一遍，月供差和总利息差一下就出来了。');
  pushLog(0.6, NOTE_TITLE, '拆迁户老周', '上次中介给我算的跟银行对不上，多算了小两万', '这种最气人，签之前一定要自己核一遍：贷款额、利率、年限输进去，跟银行给的数对一下，差得多就当场问。');
  pushLog(1.2, NOTE_TITLE, '不想上班了', '手里有 30 万，是提前还款好还是留着好', '先把提前还省下的利息和这笔钱留在手里的收益各算一遍，哪个高选哪个，数字一出来就不纠结了。');
  pushLog(2.4, NOTE_TITLE, '一只柠檬', '同问，我也有这个疑问', '你现在是等额本息吧？把月供和剩余本金算出来，提前还的划算程度一眼就看出来了。');
  pushLog(3.1, '等额本息和等额本金到底选哪个？', '阿May', '求个能直接算的链接', '自己算更放心：把贷款额、年限填进去，两种方式的月供和总利息并排列出来对比。');
  pushLog(4.5, '深圳买房组合贷怎么走流程', '深漂第七年', '组合贷是不是很麻烦', '流程是有点绕，但把商贷和公积金的额度、利率分开算清楚就不慌了，我把当时算的过程整理过。');
  pushLog(5.2, NOTE_TITLE, '大熊猫', '收藏了，慢慢看', '先算一遍自己的数最有用，算完再来选方式就简单了。');
  pushLog(26, NOTE_TITLE, '小柚子妈妈', '听劝，先不提前还了', '可以，先把现金流稳住，后面随时能还。');
  pushLog(28, NOTE_TITLE, '拆迁户老周', '学到了，谢谢', '不客气，核一遍就不怕被糊弄了。');
  pushLog(30, '提前还款手续费怎么算', '小满', '手续费是一次性的吗', '多数是一次性收，具体看你合同那一条，算之前先翻出来看一眼。');
  pushLog(31, '月供 8000 怎么提前还款最省', '石榴', '等额本息提前还划算吗', '看你剩余期数，后面几年利息占比低，提前还的收益就小了，先算一遍再决定。');
  pushLog(33, NOTE_TITLE, '一只柠檬', '谢谢分享', '希望能帮上忙，算完有问题再问。');
  /* 诊断：内容规划 + 深度评估报告（⑦ 规划页的两块） */
  const plan = {
    accountType: '经验分享型', contentFocus: '房贷算法与还款策略', targetPeople: '正在还房贷、想算清楚的家庭',
    pageCount: 3, perPage: ['问题', '方法', '总结'], frequency: '每周三篇', timing: '晚上 8-10 点',
    topics: [
      { title: '月供 8000，提前还款到底省多少', angle: '用真实数字算给你看' },
      { title: '等额本息和等额本金，我该怎么选', angle: '两种方式并排算一遍' },
      { title: '公积金能贷多少？一算就清楚', angle: '把额度口径讲明白' },
      { title: '中介算的数和银行对不上，怎么核', angle: '手把手教你自己核一遍' },
    ],
  };
  const report = {
    overall: '定位清楚、方向对，缺的是稳定的更新节奏和更直白的开头。',
    summary: '账号处在起步期，内容方向已经聚焦在房贷算法上，接下来把节奏固定住、把每条笔记的第一句改得更像人话，就能稳步起量。',
    positioning: { issue: '简介没讲清为谁服务', suggestion: '补一句「帮还房贷的人把账算清楚」，让人一眼知道你能解决什么' },
    personaReview: { issue: '人设偏泛', suggestion: '加一条真实经历——比如自己当年也算错过多还了小两万，可信度立刻不一样' },
    kbReview: { issue: '知识条目偏少', suggestion: '把常被问到的利率口径、提前还款规则补进知识库，回复更有干货' },
    sections: [
      { name: '选题', issue: '偏泛', suggestion: '按「问题-方法-总结」固定结构，每条只讲一件事' },
      { name: '开头', issue: '前两句太平', suggestion: '第一条评论就抛数字，让人停住' },
    ],
    structure: '问题-方法-总结',
    frequency: '每周三篇，晚上 8-10 点发',
    priorities: ['补齐简介里的服务对象', '固定每周三篇的更新节奏', '把常被问到的口径补进知识库'],
    risks: ['起步期别频繁改定位', '别为了量牺牲每条的干货密度'],
  };
  /* 产品卖点：发笔记向导第一屏要挑的那几个 */
  const cfgData = await chrome.storage.local.get('config');
  const cfg = (cfgData && cfgData.config) || {};
  cfg.product = Object.assign({}, cfg.product || {}, {
    name: '房奴计算器',
    guideText: '私信我「算账」，帮你把月供和提前还款的账拉出来对比',
    description: '把房贷的月供、总利息、提前还款收益一次算清楚，不用记公式。',
    sellPoints: [
      { id: 'sp1', title: '两种还款方式并排算', content: '等额本息 / 等额本金各跑一遍，月供和总利息差多少一屏看清。' },
      { id: 'sp2', title: '提前还款省多少直接出', content: '输入剩余本金和期数，提前还省下的利息当场算出来。' },
      { id: 'sp3', title: '不用记公式，填数就行', content: '按真实贷款额、利率、年限填进去，结果自己出来，不用翻条款。' },
      { id: 'sp4', title: '跟银行给的数能对上', content: '用的就是标准口径，算完可以拿去和银行核对，不怕被糊弄。' },
    ],
  });
  cfg.commentPurpose = 'sell';
  chrome.storage.local.set({ config: cfg });

  chrome.storage.local.set({
    drain_scan_cfg: scan,
    drain_queue: queue,
    drain_notes: notes,
    watering_logs: logs,
    note_plan: plan,
    deep_report: report,
    auto_water_config: { schedule: { dailyMax: 30, perRound: 10 } },
    auto_water_daily: (() => { const d = {}; d[new Date().toISOString().slice(0, 10)] = 7; return d; })(),
    auto_water_state: { live: { kw: '房贷计算', scenario: 'latest', title: NOTE_TITLE, idx: 2, total: 5, author: '小柚子妈妈', ci: 3, cTotal: 7, sent: 3, at: now - 40 * 1000 } },
  });
  return 'seeded';
}
"""

# 线索清单：走 Storage.addProspect（跨租户、字段默认值都靠它），6 个人覆盖高/中/低意向 + 三种状态
SEED_PEOPLE = r"""
async () => {
  const now = Date.now(), H = 3600000, D = 86400000;
  const people = [
    { userId: '5f1a1111aaaa000000010001', nickname: '小柚子妈妈', charCount: 0,
      profile: { intentLevel: 'high', identity: '宝妈', tags: ['提前还款', '纠结'], need: '想算清提前还款到底省多少' },
      source: { stageEntry: '评论', signalType: '回复', noteTitle: '求推荐！提前还款到底划不划算，听劝',
                comment: '完全看不懂，等额本息和等额本金到底哪个划算啊，求个能算明白的办法',
                userUrl: 'https://www.xiaohongshu.com/user/profile/5f1a1111aaaa000000010001', signalText: '求个能算明白的办法' },
      origin: '评论跟进', intentLevel: 'high', status: '谈单中', dmStatus: 'sent', awaitingReply: true,
      nTime: now - 3 * H, nTimeStr: '3 小时前',
      chatHistory: [
        { role: 'assistant', content: '我一开始也绕不明白，后来把两种还款方式按自己的贷款额各跑了一遍，差多少一眼就看出来了。' },
        { role: 'user', content: '那提前还呢？我手里有点闲钱，一直在纠结。' },
      ] },
    { userId: '5f1a2222bbbb000000020002', nickname: '拆迁户老周',
      profile: { intentLevel: 'high', identity: '自由职业', tags: ['被坑过'], need: '想自己核一遍中介给的数' },
      source: { stageEntry: '评论', signalType: '互动', noteTitle: '中介算的数和银行对不上',
                comment: '上次中介给我算的跟银行对不上，多算了小两万，气死我了',
                userUrl: 'https://www.xiaohongshu.com/user/profile/5f1a2222bbbb000000020002', signalText: '多算了小两万' },
      origin: '互动', intentLevel: 'high', status: '已触达', dmStatus: 'sent', awaitingReply: true,
      nTime: now - 6 * H, nTimeStr: '6 小时前' },
    { userId: '5f1a3333cccc000000030003', nickname: '不想上班了',
      profile: { intentLevel: 'medium', identity: '上班族', tags: ['手里有闲钱'], need: '纠结提前还款还是留着' },
      source: { stageEntry: '评论', signalType: '回复', noteTitle: '手里 30 万，提前还款还是留着？',
                comment: '手里有 30 万，是提前还款好还是留着好，纠结好几个月了',
                userUrl: 'https://www.xiaohongshu.com/user/profile/5f1a3333cccc000000030003', signalText: '纠结好几个月' },
      origin: '评论', intentLevel: 'medium', status: '待触达', dmStatus: 'pending',
      nTime: now - 9 * H, nTimeStr: '9 小时前' },
    { userId: '5f1a4444dddd000000040004', nickname: '一只柠檬',
      profile: { intentLevel: 'medium', identity: '深圳 / 首次置业', tags: ['同城'], need: '想找能直接填数算的工具' },
      source: { stageEntry: '评论', signalType: '回复', noteTitle: '等额本息和等额本金到底选哪个？',
                comment: '求个能直接算的链接，自己算太麻烦',
                userUrl: 'https://www.xiaohongshu.com/user/profile/5f1a4444dddd000000040004', signalText: '求个能直接算的链接' },
      origin: '评论', intentLevel: 'medium', status: '已触达', dmStatus: 'sent',
      nTime: now - D, nTimeStr: '昨天' },
    { userId: '5f1a5555eeee000000050005', nickname: '深漂第七年',
      profile: { intentLevel: 'low', identity: '深圳 / 准备买房', tags: ['组合贷'], need: '想了解组合贷流程' },
      source: { stageEntry: '点赞', signalType: '点赞', noteTitle: '深圳买房组合贷怎么走流程',
                comment: '收藏了，慢慢看',
                userUrl: 'https://www.xiaohongshu.com/user/profile/5f1a5555eeee000000050005', signalText: '收藏了' },
      origin: '点赞', intentLevel: 'low', status: '待触达', dmStatus: 'pending',
      nTime: now - 2 * D, nTimeStr: '2 天前' },
    { userId: '5f1a6666ffff000000060006', nickname: '石榴',
      profile: { intentLevel: 'medium', identity: '老师', tags: ['公积金'], need: '问提前还款的手续费' },
      source: { stageEntry: 'AI路由', signalType: '关键词命中', noteTitle: '提前还款手续费怎么算',
                comment: '手续费是一次性的吗',
                userUrl: 'https://www.xiaohongshu.com/user/profile/5f1a6666ffff000000060006', signalText: '手续费' },
      origin: 'AI筛选', intentLevel: 'medium', status: '谈单中', dmStatus: 'sent', convId: 'chat_5f1a6666',
      nTime: now - 3 * D, nTimeStr: '3 天前' },
  ];
  let added = 0;
  for (const p of people) { try { const r = await Storage.addProspect(p); if (r && r.added) added++; } catch (e) {} }
  return 'people added: ' + added;
}
"""

# 评论跟进会话：通知回访队列的「待回」从这份状态现场派生
SEED_FOLLOW = r"""
async () => {
  const now = Date.now(), H = 3600000, M = 60000;
  const conv = (userId, userName, turnCount, incoming, extra) => [userId, Object.assign({
    userName, turnCount, needReply: true, pendingIncoming: incoming,
    pendingIdx: 0, lastReplyAt: now - 6 * H,
    history: [
      { role: 'context', content: '我此前的评论/回复：先把提前还省下的利息和这笔钱留在手里的收益各算一遍，哪个高选哪个。' },
      { role: 'user', content: incoming },
    ],
  }, extra || {})];
  const conversations = Object.fromEntries([
    conv('5f1a1111aaaa000000010001', '小柚子妈妈', 2, '听你的去算了一下，手里这 30 万提前还掉能省多少啊？'),
    conv('5f1a2222bbbb000000020002', '拆迁户老周', 1, '自己核了一遍确实对不上，你这个表能发我一份吗'),
    conv('5f1a3333cccc000000030003', '不想上班了', 3, '那我还是先不提前还了，钱留着应急'),
    conv('5f1a7777aaaa000000070007', '阿May', 1, '求个能直接算的链接，自己算太麻烦'),
    conv('5f1a8888bbbb000000080008', '大熊猫', 2, '同问，我也有这个疑问', { needReply: false, pendingIncoming: '', lastRepliedIncoming: '同问，我也有这个疑问' }),
    conv('5f1a9999cccc000000090009', '小满', 4, '谢谢，算清楚了', { needReply: false, pendingIncoming: '', sold: true, lastRepliedIncoming: '谢谢，算清楚了' }),
  ]);
  await chrome.storage.local.set({ chat_follow_state: { conversations, lastSyncAt: now - 4 * M } });
  return 'conversations: ' + Object.keys(conversations).length;
}
"""

SHOTS = []


def shot(page, name, clip=None, selector=None, full=False):
    """截图落盘：目标 PNG 可能正被看图器/WPS 占着（Windows 会给 EINVAL），重试几次。"""
    path = OUT / name
    tmp = OUT / (path.stem + '.tmp.png')   # 扩展名必须留着，Playwright 靠它判图片格式
    err = None
    for attempt in range(5):
        try:
            if selector:
                page.locator(selector).first.screenshot(path=str(tmp))
            else:
                page.screenshot(path=str(tmp), clip=clip, full_page=full)
            os.replace(tmp, path)
            SHOTS.append((name, True, ''))
            print('shot', name, flush=True)
            return
        except Exception as e:
            err = e
            try:
                tmp.unlink()
            except OSError:
                pass
            time.sleep(0.8)
    SHOTS.append((name, False, str(err)[:160]))
    print('FAIL', name, str(err)[:160], flush=True)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/v1'
    errors = []
    with tempfile.TemporaryDirectory(prefix='xhs-pdf-') as profile, sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            profile, headless=False, channel='msedge',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        try:
            sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            worker = sw
            worker.evaluate('''async (base) => {
                await ensureTenantInit();
                const cfg = await Storage.getConfig();
                cfg.ai = { apiBaseUrl: base, apiKey: 'shot-only', model: 'fixture', _modelLocked: true };
                await Storage.setConfig(cfg);
            }''', base)
            print('ai ->', base)

            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(sw.url.replace('background.js', 'popup.html?mode=big'))
            page.wait_for_function('typeof switchMainTab === "function"')
            page.set_viewport_size({'width': 1160, 'height': 900})
            print('page seed:', page.evaluate(SEED_PAGE, NOTE_TITLE))
            print('worker seed:', worker.evaluate(SEED_PEOPLE))
            print('follow seed:', page.evaluate(SEED_FOLLOW))
            page.wait_for_timeout(800)

            rail = page.evaluate('() => Math.round(document.getElementById("mainTabs").getBoundingClientRect().right)')
            print('left rail width =', rail)
            pane_w = 1160 - rail

            def pane(name, y=0, h=880):
                shot(page, name, clip={'x': rail, 'y': y, 'width': pane_w, 'height': h})

            def dismiss():
                try:
                    page.evaluate('() => { const b = document.getElementById("fsClose"); if (b) b.click(); }')
                except Exception:
                    pass

            def go(tab, wait=1200):
                dismiss()
                page.evaluate(f'switchMainTab("{tab}")')
                page.wait_for_timeout(wait)
                dismiss()

            # ── 02 / 02b 队列：「口径 × 节奏」执行器 + 正在跑 / 已完成两段 ──
            go('queue', 1600)
            bar = page.locator('#queueBar')
            print('queue bar:', bar.inner_text().replace('\n', ' | ')[:160])
            pane('02_队列_口径节奏.png', 0, 430)
            # 顶栏标成运行中（只看 UI，不动机器人）→ 暂停键现身 + 「▶ 正在跑」+ live 行
            page.evaluate('() => { window.AutoBot.running = true; window.AutoBot._updateUI(true); }')
            page.wait_for_timeout(500)
            live = page.locator('#queueBody .q-live')
            print('live rows:', live.count(), '|', (live.first.inner_text().replace('\n', ' ')[:120] if live.count() else ''))
            pane('02b_队列_运行中.png', 0, 660)
            page.evaluate('() => { window.AutoBot.running = false; window.AutoBot._updateUI(false); }')

            # ── 03 工作台：造一篇笔记的评论 → 假 AI 出 3 条商机（带打法标签 + 前置分析） ──
            go('comment', 800)
            page.evaluate('''(title) => {
              pageData = {
                url: 'https://www.xiaohongshu.com/explore/65f0aabbccdd112233445566',
                platform: 'xhs',
                title: title,
                author: '房奴自救指南',
                noteData: { title: title, author: '房奴自救指南' },
                comments: [
                  { author: '小柚子妈妈', content: '完全看不懂，等额本息和等额本金到底哪个划算啊，求个能算明白的办法', location: '广东', userLink: 'https://www.xiaohongshu.com/user/profile/5f1a1111aaaa000000010001' },
                  { author: '路过的风', content: '已收藏', location: '北京' },
                  { author: '大熊猫', content: '同问，我也有这个疑问', location: '四川' },
                  { author: '拆迁户老周', content: '上次中介给我算的跟银行对不上，多算了小两万，气死我了', location: '浙江', userLink: 'https://www.xiaohongshu.com/user/profile/5f1a2222bbbb000000020002' },
                  { author: '石榴', content: '学到了', location: '山东' },
                  { author: '不想上班了', content: '手里有 30 万，是提前还款好还是留着好，纠结好几个月了', location: '江苏', userLink: 'https://www.xiaohongshu.com/user/profile/5f1a3333cccc000000030003' },
                  { author: '一只柠檬', content: '求个能直接算的链接', location: '广东' },
                  { author: '南风知我意', content: '已经还了三年，现在提前还划不划算啊', location: '福建' },
                  { author: '沉默的大多数', content: '公积金贷款是不是不能这么算', location: '湖北' },
                  { author: '小城故事', content: '写得太清楚了，转发给我老公看了', location: '河南' },
                  { author: '会飞的鱼', content: '等额本金前期压力是真的大', location: '陕西' },
                  { author: '阿May', content: '我算完发现差了三万多，还是提前还吧', location: '广东' },
                ],
              };
            }''', NOTE_TITLE)
            page.evaluate('() => loadProspecting(document.getElementById("mainContent"))')
            try:
                page.wait_for_selector('#mainContent .prospect-card', timeout=45000)
                page.wait_for_timeout(1200)
                print('cards:', page.locator('#mainContent .prospect-card').count())
                page.evaluate('''() => { const d = document.querySelector('#mainContent details'); if (d) d.style.display = 'none'; }''')
                page.wait_for_timeout(200)
                pane('03_挖商机_话术卡.png', 0, 880)
            except Exception as e:
                SHOTS.append(('03_挖商机_话术卡.png', False, str(e)[:160]))
                print('FAIL 03:', str(e)[:160], flush=True)
                print('FAIL 03 body:', page.locator('#mainContent').inner_text().replace('\n', ' | ')[:400], flush=True)

            # ── 04 / 05 线索 → 通知：回访队列 + 获客清单表 ──
            go('prospect', 1800)
            print('notif:', page.locator('#prospectContent').inner_text().replace('\n', ' | ')[:220])
            pane('04_通知回访.png', 0, 470)
            page.evaluate('''() => { const t = document.querySelector('#prospectContent .pl-table'); if (t) t.scrollIntoView({ block: 'start' }); }''')
            page.wait_for_timeout(400)
            pane('05_获客清单.png', 0, 880)

            # ── 06 笔记池页尾的「评论记录」折叠块 ──
            go('scenarioDrain', 1800)
            page.evaluate('''() => { const f = document.getElementById('sxWaterFold'); if (f) { f.style.display = ''; f.open = true; } }''')
            page.wait_for_timeout(1400)
            print('water fold:', page.locator('#sxWaterN').inner_text() if page.locator('#sxWaterN').count() else '-')
            page.evaluate('''() => { const f = document.getElementById('sxWaterFold'); if (f) f.scrollIntoView({ block: 'start' }); }''')
            page.wait_for_timeout(400)
            pane('06_评论记录.png', 0, 880)

            # ── 08 诊断&配置「规划」：内容规划 + 深度评估报告 ──
            go('diagnose', 1400)
            page.locator('#diagSubTabs [data-go="6"]').first.click()
            page.wait_for_timeout(1600)
            print('plan page:', page.locator('#diagnoseContent').inner_text().replace('\n', ' | ')[:220])
            pane('08_账号诊断.png', 0, 880)

            # ── 09 发笔记向导（写文案）：六步条 + ① 挑卖点 ──
            go('notePublish', 1600)
            print('wizard:', page.locator('#notePublishContent').inner_text().replace('\n', ' | ')[:220])
            pane('09_发笔记向导.png', 0, 820)

            if errors:
                print('page errors:', errors[:3], flush=True)
        finally:
            ctx.close()
    server.shutdown()
    bad = [s for s in SHOTS if not s[1]]
    print('\n--- 合计 %d 张：成 %d / 败 %d ---' % (len(SHOTS), len(SHOTS) - len(bad), len(bad)), flush=True)
    for n, ok, err in bad:
        print('  ✗', n, err, flush=True)
    print('输出目录：', OUT)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
