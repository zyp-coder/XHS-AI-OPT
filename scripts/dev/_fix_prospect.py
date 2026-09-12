# -*- coding: utf-8 -*-
"""修复 models.py prospect_finder 条目"""
with open('app/models/models.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f'File has {len(lines)} lines')

# Find the broken user_prompt_template line
for i, line in enumerate(lines):
    if 'user_prompt_template' in line and '"请找出' in line and '\\n' not in line:
        print(f'Found broken line at index {i}: {line[:80]!r}')
        # Merge subsequent lines until we hit the closing '        }'
        merged = line.rstrip('\n').rstrip()
        j = i + 1
        while j < len(lines):
            stripped = lines[j].strip()
            if stripped == '},' or stripped == '}' or stripped.startswith('        },'):
                break
            # Add content with \n escape
            content_part = stripped.rstrip(',').strip('"')
            if content_part:
                merged += '\\n' + content_part
            j += 1
        # Add closing quote and comma
        # Remove trailing quote if present
        if merged.endswith('"'):
            merged = merged[:-1]
        merged += '",\n'
        print(f'Fixed: {merged[:120]!r}')
        # Replace the range
        lines[i:j] = [merged]
        break

with open('app/models/models.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)

# Verify
import ast
with open('app/models/models.py', 'r', encoding='utf-8') as f:
    content = f.read()
try:
    ast.parse(content)
    print('Syntax: OK!')
except SyntaxError as e:
    print(f'Syntax error at line {e.lineno}: {e.msg}')
    all_l = content.split('\n')
    if e.lineno:
        print(f'Context: {all_l[e.lineno-1][:200]!r}')
