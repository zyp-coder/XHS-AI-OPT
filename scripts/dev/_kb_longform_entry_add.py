# 知识库补一条「📝 长文笔记」——这条形式 2026-10-19 落地（知识线第四张卡／引流两卡之一／门面承接那篇），全库 70 条零命中。
# 纪律：追加前先做风格复刻自检（重建整份必须与现文件逐字节相等，不等就拒写）；键序与尾随空格照旧、纯 CRLF；条目插在 drain057 之后。
# 用法：python3 -X utf8 scripts/dev/_kb_longform_entry_add.py
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
REPO = Path(__file__).resolve().parents[2]
KB = REPO / '资料' / '小红书AI引流工具知识库.json'

CONTENT = '\n\n'.join([
    '🔥 处理什么问题：一篇稿子想讲透、想发得长，自己分小标题排版费劲；小红书长文模式吃的是整篇文字，正好不用配图、也不用做图。',
    '📐 怎么算：三个地方出这一篇——① 「✍️ 新建笔记」→ 📚 知识 → 📝 长文笔记；② 「✍️ 新建笔记」→ 🔥 引流 → 📝 长文笔记；'
    '③ 「🪟 门面」那条流的「成交承接」，走完收口那站自动把这篇存成一篇长文。前两条先把正文定稿（知识线＝挑知识 → 改稿，引流线＝📄 出几版（换写法挑）→ 改稿），'
    '到改稿那一站底下摆着长文面板，点「✨ 出长文」把整篇重排一版。'
    '送后台时带上「这一篇是哪条线」，两条线两种腔——知识＝科普口吻、客观讲透、第一人称尽量弱、不编经历故事；'
    '引流＝拿你这行的身份说、开头两三句先把人钉住、成段叙述（不是一行一句的口播旁白）。'
    '排出来能整篇手改，也能「🔁 再出一版」（上一版留着对照），点「📝 存好，去排期」就地收口。',
    '⌨️ 输入什么：一篇定好的正文——正文还没整出来时那块面板不铺，点钮只会提示「长文要有成稿打底——先把正文整出来」；之后重排一版或直接改字都行。',
    '📤 得出什么结果：一篇长文存进这一档（稿子落在这一篇的长文字段），档案那行的最终形式标成「📝 长文笔记」。'
    '发的时候走小红书长文模式、排版交给平台，系统只把稿备好——知识／引流那两篇发稿那步照版本条「📋 复制这版发布文案」，'
    '门面承接那篇收口那站有「📋 复制整篇」＋「📅 自己挑个位子发」；发布那一下仍是人手点（排进发布台到点也只是开页填字、留在页上等您点，效果因人而异）。',
    '📊 真实数据：两条线的篇幅各按自己的腔定——知识＝600~1200 字、3~6 个小标题段；引流＝800~1500 字、分 3~6 段，'
    '小标题可有可无（连着讲完更顺就别硬切，要切就单独占一行、短）。抖音那版走文字模式；闲鱼那版不卡「不报价」那条。',
    '📱 操作路径：发笔记 → ✍️ 新建笔记 → 📚 知识 或 🔥 引流 → 📝 长文笔记 → 出稿、改稿 → 改稿那站底下「✨ 出长文」→「📝 存好，去排期」→ 发布台。',
])

raw = KB.read_bytes().decode('utf-8')
assert '\n' not in raw.replace('\r\n', ''), '不是纯 CRLF，停'
ents = json.loads(raw)
assert len(ents) == 70, '条目数不是 70，先核对'
assert not any('长文笔记' in e.get('title', '') for e in ents), '已经有长文那条条目了，别重复加'
assert all(e['id'] != 'drain058' for e in ents), 'drain058 已存在'

dumped = json.dumps(ents, ensure_ascii=False, indent=2, separators=(', ', ': '))
if dumped.replace('\n', '\r\n') != raw and dumped != raw.replace('\r\n', '\n'):
    sys.exit('── 风格复刻自检不过（重建与现文件不等），拒写 ──')

anchor = [i for i, e in enumerate(ents) if e['id'] == 'drain057'][0]
entry = {
    'category': '产品介绍',
    'tags': ['发笔记', '长文', '长文模式', '小红书', '引流线', '知识线'],
    'image': None,
    'title': '📝 长文笔记：稿子定了排成整篇，发的时候走小红书长文模式——知识讲透、引流拿本行身份说',
    'content': CONTENT,
    'role': '运营顾问',
    'createdAt': ents[anchor]['createdAt'] + 1000,
    'id': 'drain058',
    'isActive': True,
}

bak = REPO / 'tmp' / 'backup' / ('知识库_pre-longform-add_%s.json' % time.strftime('%Y%m%d-%H%M'))
bak.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(KB, bak)

old_ids = [e['id'] for e in ents]
ents2 = ents[:anchor + 1] + [entry] + ents[anchor + 1:]
new_raw = json.dumps(ents2, ensure_ascii=False, indent=2, separators=(', ', ': ')).replace('\n', '\r\n')
tmp = KB.with_name(KB.name + '.kbtmp')
tmp.write_bytes(new_raw.encode('utf-8'))
os.replace(tmp, KB)

check = json.loads(KB.read_bytes().decode('utf-8'))
assert len(check) == 71, '没插上'
assert [e['id'] for e in check][:anchor + 1] == old_ids[:anchor + 1]
assert check[anchor + 1]['id'] == 'drain058' and check[anchor + 2]['id'] == old_ids[anchor + 1]
assert '\n' not in KB.read_bytes().decode('utf-8').replace('\r\n', ''), '落盘不是纯 CRLF'
print('  ✓ drain058「📝 长文笔记」插在 drain057 之后（70 → 71 条，备份 %s）' % bak.name)
print('── 结果：全过 ──')
