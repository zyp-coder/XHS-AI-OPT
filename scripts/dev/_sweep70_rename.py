# -*- coding: utf-8 -*-
"""七十改编号追认（2026-10-10）：当天那批（字效编辑器收口 + 出片完成回流 + 🎬 渲染任务表前端撤）
在代码注释里误标成了「六十九改」——六十九改已被 2026-10-09 的产品侧改口波占用，本批追认为「七十改」。

范围（改前逐个备份到 tmp/_sweep70_bak/，字节级替换、不动换行符）：
  - extension/popup.js ×3（注释里的 2026-10-10 六十九改）
  - scripts/dev 19 个自检脚本 ×30（同批注释）
  - scripts/dev/check_note_draft.py：只改「── 19) 六十九改：」这一处；
    L508「六十九改白话化后」指代不明，先留（跑完应只剩这 1 处）
  - scripts/dev/check_film_cards.py：三十三改→七十改 ×1（demo 自己的 ?v=53 三十三改保留）

不动的：tmp/ 下 .bak、demo 的三十三改、资料里的历史记录。
跑法：python3 -X utf8 scripts/dev/_sweep70_rename.py
"""
import shutil
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
BAK = ROOT / 'tmp' / '_sweep70_bak'
BAK.mkdir(parents=True, exist_ok=True)

OLD = '六十九改'.encode('utf-8')
NEW = '七十改'.encode('utf-8')
OLD33 = '三十三改'.encode('utf-8')

# 文件 → 期望替换次数（六十九改→七十改）
JOBS = {
    'extension/popup.js': 3,
    'scripts/dev/check_desc_candidates.py': 1,
    'scripts/dev/check_desc_deep.py': 3,
    'scripts/dev/check_cold_pages.py': 2,
    'scripts/dev/check_diagnosis_ui.py': 2,
    'scripts/dev/check_archive_motif.py': 3,
    'scripts/dev/check_film_kinds.py': 3,
    'scripts/dev/check_note_cover.py': 1,
    'scripts/dev/check_note_cut.py': 1,
    'scripts/dev/check_note_imgwork.py': 1,
    'scripts/dev/check_note_look.py': 1,
    'scripts/dev/check_note_motif.py': 2,
    'scripts/dev/check_note_look_gallery.py': 2,
    'scripts/dev/check_note_shots.py': 1,
    'scripts/dev/check_np_film_entry.py': 2,
    'scripts/dev/check_np_composite.py': 1,
    'scripts/dev/check_voice_rewrite.py': 2,
    'scripts/dev/_cmp_prompts.py': 1,
    'scripts/dev/_probe_look_demo.py': 1,
}

total = 0
for rel, want in JOBS.items():
    p = ROOT / rel
    data = p.read_bytes()
    got = data.count(OLD)
    assert got == want, '%s 期望 %d 处六十九改，实际 %d 处' % (rel, want, got)
    assert p.name.encode('utf-8').decode('utf-8')  # noop
    bak = BAK / p.name
    if not bak.exists():
        shutil.copy2(p, bak)
    p.write_bytes(data.replace(OLD, NEW))
    total += got
    print('OK  %-46s %d 处 → 七十改' % (rel, got))

# check_note_draft.py：只动 L527 那处（「── 19) 六十九改：」），L508 指代不明先留
p = ROOT / 'scripts/dev/check_note_draft.py'
data = p.read_bytes()
assert data.count(OLD) == 2, 'check_note_draft.py 期望 2 处六十九改，实际 %d' % data.count(OLD)
needle = '── 19) '.encode('utf-8') + OLD + '：'.encode('utf-8')
assert data.count(needle) == 1, 'L527 的定位串没找到'
shutil.copy2(p, BAK / p.name)
data = data.replace(needle, '── 19) '.encode('utf-8') + NEW + '：'.encode('utf-8'))
assert data.count(OLD) == 1, '改完 check_note_draft.py 应只剩 L508 那 1 处'
p.write_bytes(data)
total += 1
print('OK  %-46s 1 处 → 七十改（L508 那处先留）' % 'scripts/dev/check_note_draft.py')

# check_film_cards.py：三十三改（本批前身编号）→ 七十改
p = ROOT / 'scripts/dev/check_film_cards.py'
data = p.read_bytes()
assert data.count(OLD33) == 1, 'check_film_cards.py 期望 1 处三十三改，实际 %d' % data.count(OLD33)
shutil.copy2(p, BAK / p.name)
p.write_bytes(data.replace(OLD33, NEW))
total += 1
print('OK  %-46s 1 处（三十三改）→ 七十改' % 'scripts/dev/check_film_cards.py')

print('共替换 %d 处；备份在 tmp/_sweep70_bak/' % total)
