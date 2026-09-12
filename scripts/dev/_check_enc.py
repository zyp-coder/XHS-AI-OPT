# -*- coding: utf-8 -*-
import os, sys
os.chdir('d:/AIproject/小红书运营')
with open('app/models/models.py', 'rb') as f:
    lines = f.readlines()
for i in range(592, min(596, len(lines))):
    line = lines[i]
    print(f'Line {i+1} ({len(line)} bytes): {line[:120]!r}')
    ascii_quote_positions = [j for j, b in enumerate(line) if b == 0x22]
    if ascii_quote_positions:
        print(f'  ASCII " at byte positions: {ascii_quote_positions}')
    # check for curly quotes
    curly_positions = [(j, b) for j, b in enumerate(line) if b in (0xe2,)]
    if curly_positions:
        print(f'  0xe2 (start of UTF-8 multi-byte) at positions: {[p[0] for p in curly_positions]}')
