"""每个页面/后台各自共用一个全局作用域：同组文件里的顶层 const/let/var/function 不能重名，
否则整页（或整个 service worker）直接 SyntaxError 起不来。改完代码跑一次这个。"""
import io
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
RE = re.compile(r'^(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b')
RE_EXTRA = re.compile(r'^(?:const|let|var)\s+[^=;]+,\s*([A-Za-z_$][\w$]*)\s*=')

EXT = 'extension/'
SW = ['lib/crypto-box.js', 'lib/data-privacy.js', 'lib/storage.js', 'lib/edition.js', 'lib/license-guard.js',
      'lib/tenant.js', 'lib/utils.js', 'lib/ai-client.js', 'lib/ai-providers.js', 'lib/default-prompts.js',
      'lib/knowledge-search.js', 'lib/prompt-renderer.js']
# 后台剩下的 importScripts 条目按 background.js 里实际的顺序读出来
sw_src = io.open(EXT + 'background.js', encoding='utf-8').read()
m = re.search(r'importScripts\(([^)]*)\)', sw_src)
SW = re.findall(r"'([^']+)'", m.group(1))

GROUPS = {
    '弹窗 popup.html': ['theme.js', 'lib/icons.js', 'lib/crypto-box.js', 'lib/data-privacy.js', 'lib/delay-presets.js',
                    'lib/ai-providers.js', 'lib/note-trend.js', 'lib/note-tags.js', 'lib/kb-file.js',
                    'lib/platforms.js',
                    'popup.js', 'lib/scenario-drain.js', 'auto-water-app.js', 'auto-bot.js', 'dropdown-ui.js'],
    '设置 settings.html': ['theme.js', 'lib/icons.js', 'lib/crypto-box.js', 'lib/data-privacy.js', 'lib/delay-presets.js',
                       'lib/ai-providers.js', 'settings.js'],
    '向导 wizard.html': ['lib/ai-providers.js', 'wizard.js'],
    '后台 service worker': SW,
}

bad = 0
for label, files in GROUPS.items():
    seen = {}
    for f in files:
        try:
            src = io.open(EXT + f, encoding='utf-8').read()
        except OSError:
            print('! 缺文件', f); bad += 1; continue
        for i, line in enumerate(src.split('\n'), 1):
            if not line.strip() or line[0].isspace():
                continue
            mm = RE.match(line) or RE_EXTRA.match(line)
            if not mm:
                continue
            name = mm.group(1)
            if name in seen:
                print('✗ %s：%s 在 %s:%d 与 %s:%d 重名' % (label, name, seen[name][0], seen[name][1], f, i))
                bad += 1
            else:
                seen[name] = (f, i)
    print('—— %s：%d 个顶层名，%d 处冲突' % (label, len(seen), bad))

print('CLASH CHECK ' + ('FAIL' if bad else 'OK'))
