# -*- coding: utf-8 -*-
"""全面修复 models.py 中 default_prompts 内部的ASCII双引号"""
import os, re
os.chdir('d:/AIproject/小红书运营')

with open('app/models/models.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 找到 default_prompts 定义的范围
start_idx = content.find('default_prompts = [')
if start_idx < 0:
    print('ERROR: cannot find default_prompts')
    exit(1)

# 只修复 default_prompts 内的内容（590行及以后）
# 策略：找到所有 "X" 模式的ASCII双引号，替换为花引号
# 但只替换出现在文本内容中的，不替换作为Python分隔符的

# 更简单的方法：找到所有出现在中文/字母之间的 ASCII "
# 这些必然是在文本内容中的
replacements = [
    # reply_self system_prompt 中
    ('"个人经历"', '\u201c个人经历\u201d'),
    ('"我当初也经历过..."', '\u201c我当初也经历过...\u201d'),
    ('"我就是用这个算明白的"', '\u201c我就是用这个算明白的\u201d'),
    # reply_self user_prompt_template 中
    ('"说实话""以我的经验""我个人觉得"', '\u201c说实话\u201d\u201c以我的经验\u201d\u201c我个人觉得\u201d'),
    # comment_assistant system_prompt 中
    ('"说实话""以我的经验""我个人觉得"', '\u201c说实话\u201d\u201c以我的经验\u201d\u201c我个人觉得\u201d'),
    ('"说到这个我就来劲了""你这个问题太典型了"', '\u201c说到这个我就来劲了\u201d\u201c你这个问题太典型了\u201d'),
    ('"个人经历"', '\u201c个人经历\u201d'),  # 重复出现在其他位置
    # comment_assistant user_prompt_template 中
    ('"说实话""以我的经验""我觉得"', '\u201c说实话\u201d\u201c以我的经验\u201d\u201c我觉得\u201d'),
]

for old, new in replacements:
    count = content.count(old)
    if count > 0:
        content = content.replace(old, new)
        print(f'Replaced {count}x: {old[:30]}...')

with open('app/models/models.py', 'w', encoding='utf-8') as f:
    f.write(content)

# 验证语法
import ast
try:
    ast.parse(content)
    print('Syntax check: PASSED')
except SyntaxError as e:
    print(f'Syntax error still at line {e.lineno}:')
    lines = content.split('\n')
    if e.lineno and e.lineno <= len(lines):
        print(f'  {lines[e.lineno-1][:200]}')
