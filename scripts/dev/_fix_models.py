# -*- coding: utf-8 -*-
"""修复 models.py 中 reply_self 和 comment_assistant 默认prompt内的双引号问题"""
import os
os.chdir('d:/AIproject/小红书运营')

with open('app/models/models.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 替换 reply_self 和 comment_assistant 内部的双引号为花引号
# 注意：这些替换只针对两层嵌套的字符串内部

# 修复 reply_self system_prompt 中的双引号
old = '用"说实话""以我的经验""我个人觉得""我一直认为"开头'
new = '用\u201c说实话\u201d\u201c以我的经验\u201d\u201c我个人觉得\u201d\u201c我一直认为\u201d开头'
content = content.replace(old, new)

# 修复 reply_self system_prompt 中的其他双引号
old2 = '不要用"说到这个我就来劲了""你这个问题太典型了"这类'
new2 = '不要用\u201c说到这个我就来劲了\u201d\u201c你这个问题太典型了\u201d这类'
content = content.replace(old2, new2)

# 修复 reply_self user_prompt_template 中的双引号
old3 = '先用"说实话""以我的经验""我个人觉得"开头'
new3 = '先用\u201c说实话\u201d\u201c以我的经验\u201d\u201c我个人觉得\u201d开头'
content = content.replace(old3, new3)

# 修复 comment_assistant system_prompt 中的双引号
old4 = '用"说实话""以我的经验""我个人觉得"开头'
new4 = '用\u201c说实话\u201d\u201c以我的经验\u201d\u201c我个人觉得\u201d开头'
content = content.replace(old4, new4)

old5 = '如"说到这个我就来劲了""你这个问题太典型了"'
new5 = '如\u201c说到这个我就来劲了\u201d\u201c你这个问题太典型了\u201d'
content = content.replace(old5, new5)

# 修复 comment_assistant user_prompt_template 中的双引号
old6 = '先用"说实话""以我的经验""我觉得"开头'
new6 = '先用\u201c说实话\u201d\u201c以我的经验\u201d\u201c我觉得\u201d开头'
content = content.replace(old6, new6)

with open('app/models/models.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed models.py')

# 验证语法
import ast
ast.parse(content)
print('Syntax check: OK')
