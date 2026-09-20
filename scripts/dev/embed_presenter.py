# -*- coding: utf-8 -*-
"""把形象图以 base64 内嵌进两个 HTML（替换 __HOST_SRC__ 占位符或已内嵌的旧图）"""
import base64, pathlib, re

D = pathlib.Path(r'd:\AIproject\小红书运营\资料\视频\AI雕兄口播稿')
img = (D / 'AI雕兄-形象-透明.webp').read_bytes()
uri = 'data:image/webp;base64,' + base64.b64encode(img).decode()
print('data uri %.0f KB' % (len(uri) / 1024))

for f in ('AI雕兄-动效演示-竖屏.html', 'AI雕兄-动效演示.html'):
    p = D / f
    t = p.read_text(encoding='utf-8')
    t2, n1 = re.subn(r'__HOST_SRC__', uri, t)
    t2, n2 = re.subn(r'data:image/webp;base64,[A-Za-z0-9+/=]+', uri, t2)
    if n1 or n2:
        p.write_text(t2, encoding='utf-8')
        print('embedded ->', f, '(占位符 %d / 旧图 %d) %.0f KB' % (n1, n2, p.stat().st_size / 1024))
    else:
        print('!! 未替换 ->', f)
