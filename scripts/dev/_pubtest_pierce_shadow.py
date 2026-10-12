# -*- coding: utf-8 -*-
"""侦察 xhs-publish-btn 封闭 shadow 内部结构（CDP pierce，仅测试用；扩展侧走 attachShadow hook）。
① 截当前底栏图 ② DOM.getDocument(pierce) 递归找 shadow 内元素 + 含「发布/暂存」的按钮 box。"""
import json
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SHOT = r'D:\AIproject\小红书运营\tmp\pubtest_shots\xhs_bottom_now.png'


def subtree_text(node, acc):
    if node.get('nodeType') == 3:
        acc.append(node.get('nodeValue') or '')
    for sr in (node.get('shadowRoots') or []):
        subtree_text(sr, acc)
    for ch in (node.get('children') or []):
        subtree_text(ch, acc)
    return ''.join(acc)


with sync_playwright() as p:
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    ctx = b.contexts[0]
    page = None
    for pg in ctx.pages:
        if 'creator.xiaohongshu.com/publish' in pg.url:
            page = pg
            break
    if not page:
        print('!! 没找到 xhs 发布页')
        sys.exit(1)

    page.screenshot(path=SHOT)
    print('shot ->', SHOT)

    cdp = ctx.new_cdp_session(page)
    doc = cdp.send('DOM.getDocument', {'depth': -1, 'pierce': True})
    root = doc['root']

    # 迭代遍历，记录 shadow 内元素 & 全部 button
    stack = [(root, 'doc')]
    shadow_nodes = []
    buttons = []
    while stack:
        node, path = stack.pop()
        for sr in (node.get('shadowRoots') or []):
            stack.append((sr, path + '>#shadow'))
        for ch in (node.get('children') or []):
            stack.append((ch, path))
        if node.get('nodeType') != 1:
            continue
        rec = {
            'nodeName': node.get('nodeName'),
            'path': path,
            'class': (node.get('attributes') or {}),
        }
        # attributes 在 CDP 里是扁平数组
        attrs = node.get('attributes') or []
        attr_map = dict(zip(attrs[0::2], attrs[1::2]))
        rec['class'] = attr_map.get('class', '')
        rec['backendNodeId'] = node.get('backendNodeId')
        if '#shadow' in path:
            shadow_nodes.append(rec)
        if (node.get('nodeName') or '').upper() in ('BUTTON', 'A', 'SPAN', 'DIV'):
            t = subtree_text(node, [])
            if t and ('发布' in t or '暂存' in t) and len(t) <= 40:
                rec['t'] = t
                buttons.append(rec)

    print('== shadow 内元素数(前 60 条) ==')
    for r in shadow_nodes[:60]:
        print(f"  [{r['path'].count('#shadow')}] {r['nodeName']} class={r['class'][:60]!r} bid={r['backendNodeId']}")

    print('== 含发布/暂存文本的节点 ==')
    for r in buttons:
        try:
            box = cdp.send('DOM.getBoxModel', {'backendNodeId': r['backendNodeId']})
            quad = box['model']['border']
            x, y = min(quad[0::2]), min(quad[1::2])
            w, h = max(quad[0::2]) - x, max(quad[1::2]) - y
            line = f"  {r['nodeName']} {r['class'][:50]!r} text={r['t'][:20]!r} box=({x:.0f},{y:.0f},{w:.0f},{h:.0f})"
        except Exception as e:
            line = f"  {r['nodeName']} {r['class'][:50]!r} text={r['t'][:20]!r} box=ERR {str(e)[:60]}"
        print(line)
