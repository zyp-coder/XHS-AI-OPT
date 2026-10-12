# -*- coding: utf-8 -*-
import io, difflib
bg = io.open(r'D:\AIproject\小红书运营\extension\background.js', encoding='utf-8', newline='').read()
pa = io.open(r'D:\AIproject\小红书运营\scripts\dev\_tmp_patch34.py', encoding='utf-8', newline='').read()
base = bg.find('async function planNoteShotsBg')
i = bg.find("  const system = [", base)
j = bg.find("].filter(Boolean).join(", i)
j = bg.find("\n", j)
actual = bg[i:j].rstrip()
k = pa.find("  const system = [")
l = pa.find('"""', k)
want = pa[k:l].rstrip()
print('SAME' if actual == want else 'DIFF')
for d in difflib.unified_diff(want.splitlines(), actual.splitlines(), 'patch', 'file', lineterm=''):
    print(d)
