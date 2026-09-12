# -*- coding: utf-8 -*-
# 从通知页快照提取通知项（模拟 content.js extractNotifications 的提取逻辑）
import re
import json

h = open(r'd:\AIproject\小红书运营\_notification_dom2.html', encoding='utf-8').read()

# 用简单的标签平衡扫描提取每个 div.container 的完整片段
# 先找所有 class="container" 的位置，然后按 <div ...> 与 </div> 配对截取
items_raw = []
pos = 0
while True:
    i = h.find('class="container"', pos)
    if i < 0:
        break
    # 找到该 div 起始（往前找 <div）
    start = h.rfind('<div', 0, i)
    # 配对 </div>
    depth = 0
    j = start
    k = start
    while k < len(h):
        next_open = h.find('<div', k)
        next_close = h.find('</div>', k)
        if next_close < 0:
            break
        if next_open >= 0 and next_open < next_close:
            depth += 1
            k = next_open + 4
        else:
            depth -= 1
            k = next_close + 6
            if depth <= 0:
                break
    items_raw.append(h[start:k])
    pos = i + len('class="container"')

print('找到 container 数量:', len(items_raw))

def extract(seg, cls):
    # 找 class 包含 cls 的元素，提取其文本（去标签）
    m = re.search(r'class="[^"]*' + cls + r'[^"]*"[^>]*>', seg)
    if not m:
        return ''
    inner_start = m.end()
    # 配对到该元素结束（div 或 span 都可能，简化：截到下一个同级 class 或固定长度内找闭合）
    # 这里直接取到该 class 元素的后继文本，用简单方式：找到 <div class=" 或段末
    nxt = seg.find('<div class="', inner_start)
    if nxt < 0:
        nxt = len(seg)
    inner = seg[inner_start:nxt]
    # 去掉内部嵌套标签
    txt = re.sub(r'<[^>]+>', '', inner)
    txt = re.sub(r'\s+', ' ', txt).strip()
    return txt

def extract_href(seg, pattern):
    m = re.search(r'href="([^"]*' + pattern + r'[^"]*)"', seg)
    return m.group(1) if m else ''

items = []
for idx, seg in enumerate(items_raw):
    user_href = extract_href(seg, r'/user/profile/')
    m = re.search(r'/user/profile/([0-9a-fA-F]+)', user_href)
    user_id = m.group(1) if m else ''
    # 昵称：user-info 里的 a 文本
    m2 = re.search(r'class="[^"]*user-info[^"]*"[^>]*>.*?<a[^>]*>([^<]+)</a>', seg, re.S)
    user_name = m2.group(1).strip() if m2 else ''
    time = extract(seg, 'interaction-time')
    incoming = extract(seg, 'interaction-content')
    my_reply = extract(seg, 'quote-info')
    has_reply_btn = 'action-reply' in seg
    items.append({
        'idx': idx, 'userId': user_id, 'userName': user_name,
        'time': time, 'incoming': incoming, 'myReply': my_reply, 'hasReplyBtn': has_reply_btn,
    })

print(json.dumps(items, ensure_ascii=False, indent=1)[:4000])
print('...')
print('总条数:', len(items))
print('有回复按钮:', sum(1 for x in items if x['hasReplyBtn']))
print('有 myReply:', sum(1 for x in items if x['myReply']))
print('有 userId:', sum(1 for x in items if x['userId']))
