# -*- coding: utf-8 -*-
"""精确修复 models.py 中 default_prompts 内部的引号问题"""
import ast, os
os.chdir('d:/AIproject/小红书运营')

with open('app/models/models.py', 'r', encoding='utf-8') as f:
    content = f.read()

dp_start = content.find('default_prompts = [')
dp_end = content.find('default_kb = [')
if dp_start < 0 or dp_end < 0:
    print('ERROR: cannot find sections')
    exit(1)

before = content[:dp_start]
dp_section = content[dp_start:dp_end]
after = content[dp_end:]
lines = dp_section.split('\n')
fixed_lines = []

for line in lines:
    colon_idx = line.find(':')
    if colon_idx >= 0:
        before_colon = line[:colon_idx+1]
        after_colon = line[colon_idx+1:]
        first_q = after_colon.find('"')
        last_q = after_colon.rfind('"')
        if first_q >= 0 and last_q > first_q:
            outer_open = after_colon[:first_q+1]
            middle = after_colon[first_q+1:last_q]
            outer_close = after_colon[last_q:]
            new_middle = ''
            in_quote = False
            for ch in middle:
                if ch == '"':
                    if not in_quote:
                        new_middle += '\u201c'
                        in_quote = True
                    else:
                        new_middle += '\u201d'
                        in_quote = False
                else:
                    new_middle += ch
            line = before_colon + outer_open + new_middle + outer_close
    fixed_lines.append(line)
dp_fixed = '\n'.join(fixed_lines)
new_content = before + dp_fixed + after

with open('app/models/models.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

try:
    ast.parse(new_content)
    print('Syntax: OK')
except SyntaxError as e:
    print(f'Syntax error at line {e.lineno}: {e.msg}')
    all_lines = new_content.split('\n')
    if e.lineno:
        start = max(0, e.lineno - 3)
        for i in range(start, min(len(all_lines), e.lineno + 2)):
            marker = '>>>' if i == e.lineno - 1 else '   '
            print(f'{marker} {i+1}: {all_lines[i][:150]}')
