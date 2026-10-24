# -*- coding: utf-8 -*-
"""一次性：资料/推广物料/使用说明.md 跟上 2026-10-19 两件事——
① 门面「成交承接」出口由图文改为一篇长文（改当日那块的现状句）；
② 玩法并进「🔥 引流」＋📝 长文两条线分腔，立一条当日记录 + 口径表补一行。
纪律：备份 → 逐处断言命中数 → 全中才落盘（临时文件 + os.replace）→ 终检。
"""
import os
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOC = ROOT / '资料' / '推广物料' / '使用说明.md'
BAK_DIR = ROOT / 'tmp' / 'backup'

NEW_BLOCK = (
    '**2026-10-19 玩法并进「🔥 引流」＋📝 长文分两条线腔（产品侧 + 资料口径；物料四件一个字未动）**：'
    '老板定的「🎭 IP 玩法不该是进门的第一道闸」——`✍️ 新建笔记` 弹层由**四个方向**收成**三个方向**'
    '（📚 知识 / 🔥 引流 / 🎬 案例），玩法挪到写稿第一屏顶上那一栏「🎭 这一篇用哪一招」（点一行钉上、不挑也行）；'
    '引流那一格只剩两张出口卡 **🖼 AI 图文笔记 / 📝 长文笔记**（🎬 图生视频不再有新建入口，早先建的照旧走完）；'
    '写稿那一站的「挑稿」改口 **📄 出几版（换写法挑）**。'
    '**📝 长文按线分两腔**：知识线科普口吻、分小标题段，600~1200 字；引流线拿你这行的身份说、开头先把人钉住，800~1500 字'
    '（后台提示词两套：`server/bg/lib/platforms.js` 的 `longform` / `longformD`，稿子存 `note.longform`；'
    '发的时候走小红书长文模式、平台自己排版——**系统只把稿备好，发布那一下仍是人手点**）。'
    '门面同日收口：**🪟 成交承接**走三站（不选出口、不配图），最后一站把整篇存成一篇长文。'
    '自检＝`scripts/dev/check_play_merge_web.py`（24 项）＋ `scripts/dev/check_facade_web.py`（17 项），'
    '都对 `web/` 主本跑（公网那台 `popup.js` / `background.js` / `platforms.js` 已推平；后台两份要重启才生效，静态那份不用）。'
    '**资料侧同步三件**：①知识库**补 1 条（drain058「📝 长文笔记」）＋ 改口 18 处**'
    '（drain037 / 041 / 042 / 048 / 049 / 055 / 057 / nav005），脚本＝`scripts/dev/_kb_drain2_longform_sync.py`、'
    '`scripts/dev/_kb_longform_entry_add.py`，**全库 71 条全启用**——'
    '**老板要在「设置 → 备份/导入」重新导入一次才到得了运行那台**（覆盖式、无回滚，导前先备份）；'
    '②`功能与界面总表.md` 口径跟上（表头一条 + 表2 五行 + 十处改口，脚本＝`scripts/dev/_doc_drain2_longform.py`）；'
    '③`IP玩法改版-确认单.md` 追记「这一版先落了玩法不当第一道闸那半」，剩下的（IP 定位卡、主题库/玩法库两表）仍待圈。'
    '`extension/` 自测副本、执行器包与给客户的知识包 zip **本轮没动**（要发客户得重跑 `scripts/dev/_refresh_knowledge_pack.py`）。'
    '**一处数对不上（待圈）**：知识线那张 📝 长文卡的卡片文案写「800~1500 字」，后台提示词按知识线 600~1200 字排——'
    '先按后台走，改哪一头等老板定。'
    '**物料侧待圈**：`功能总览.html` / `功能架构图.html` / 落地页内容稿仍按**四个内容方向**摆'
    '（含 2026-10-13 加的 IP 玩法卡），产品侧现在只有三个方向、玩法挪进了写稿那一屏——要不要跟改等老板圈；'
    '传单、名片、PDF、视频四件一字未改（它们没写方向数）。'
)

NEW_ROW = (
    '| 内容方向（功能总览图 / 功能架构图 / 落地页，2026-10-19 起） | '
    '产品侧现在**三个方向**：📚 知识 / 🔥 引流 / 🎬 案例；🎭 玩法不再是进门那一道闸，改在写稿第一屏顶上那一栏挑（不挑也行）；'
    '引流的出口两档＝**🖼 AI 图文 / 📝 长文**（长文发的时候走小红书长文模式）。'
    '物料三件仍按**四个内容方向**摆（含 2026-10-13 的 IP 玩法卡）——**待圈要不要跟改**。'
    '传单 / 名片 / PDF / 视频没写方向数，不受影响。 | '
    '2026-10-19 玩法并进「🔥 引流」（详见第五节当日记录）。'
    '上一行「平台口径」里 2026-10-13 那条「四类」描述自此只对物料那三件成立，产品侧已不是四类。 |'
)

REPL = [
    # ① 当日门面块里的现状句：承接出口已由图文改为一篇长文
    ('**🪟 成交承接**（五段提纲、出口锁死图文）',
     '**🪟 成交承接**（五段提纲、收口把整篇存成一篇长文、不配图）', 1),
    # ② 当日记录块立在门面那块之前（本文件这一节按新→旧排）
    ('**2026-10-19 门面笔记落地（产品侧 + 资料口径；物料四件一个字未动）**：',
     NEW_BLOCK + '@@BLANK@@' + '**2026-10-19 门面笔记落地（产品侧 + 资料口径；物料四件一个字未动）**：', 1),
]


def main():
    raw_bytes = DOC.read_bytes()
    raw = raw_bytes.decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    assert raw.count('\n') == raw.count('\r\n'), '本文件应为纯 CRLF'

    lines = raw.split(eol)
    assert lines[-1] == '', '文件应以换行结尾'
    assert lines[-2].startswith('| '), '口径表最后一行应是表行'

    text = raw
    hits = []
    for needle, new, expect in REPL:
        n = text.count(needle)
        hits.append((needle[:24], n, expect))
        assert n == expect, '命中 %d 处、期望 %d 处：%s' % (n, expect, needle[:40])
        text = text.replace(needle, new.replace('@@BLANK@@', eol * 2), 1)

    # ③ 追加表行（按行插，避免长行子串歧义）
    lines2 = text.split(eol)
    idx = len(lines2) - 2  # 最后一行表行（末尾空串前面）
    assert lines2[idx].startswith('| 平台口径'), '表末行不是「平台口径」行：%s' % lines2[idx][:30]
    lines2.insert(idx + 1, NEW_ROW)
    text = eol.join(lines2)

    # 终检
    assert '出口锁死图文' not in text, '旧句仍在'
    assert 'drain058' in text
    assert NEW_ROW in text
    for forbidden in ['防封', '反爬', '养号', '规避']:
        assert forbidden not in NEW_BLOCK + NEW_ROW, '新增文字含禁用词：' + forbidden
    assert text.count('\n') == text.count('\r\n'), '换行风格被破坏'

    BAK_DIR.mkdir(parents=True, exist_ok=True)
    bak = BAK_DIR / ('使用说明_pre-playmerge-longform_20261019.md')
    shutil.copyfile(DOC, bak)
    tmp = DOC.with_name(DOC.name + '.tmp')
    with open(tmp, 'wb') as f:
        f.write(text.encode('utf-8'))
    os.replace(tmp, DOC)

    print('OK 2 处替换 + 1 行表行；备份 =', bak.relative_to(ROOT))
    print('   hits:', hits)
    print('   bytes', len(raw.encode('utf-8')), '->', len(text.encode('utf-8')))


if __name__ == '__main__':
    sys.exit(main())
