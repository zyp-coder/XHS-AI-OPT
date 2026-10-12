# -*- coding: utf-8 -*-
"""WPS 占用 输出/*.pdf 时：结束 wpspdf/wps -> 循环重试 os.replace 遗留的 .pdf.new。"""
import os, pathlib, subprocess, time, sys

OUT = pathlib.Path(__file__).resolve().parents[2] / '资料' / '推广物料' / '输出'

def kill():
    for exe in ('wpspdf.exe', 'wps.exe'):
        subprocess.run(['taskkill', '/F', '/IM', exe], capture_output=True)

stuck = []
for _ in range(6):
    news = sorted(OUT.glob('*.pdf.new'))
    if not news:
        break
    kill()
    time.sleep(1.2)
    for tmp in news:
        dst = tmp.with_suffix('')
        try:
            os.replace(tmp, dst)
            print('OK   %s' % dst.name)
        except OSError as e:
            print('     %s 仍被占用 (%s)' % (dst.name, e))
            stuck.append(dst.name)

left = sorted(p.name for p in OUT.glob('*.pdf.new'))
print('剩余 .new:', left or '无')
sys.exit(1 if left else 0)
