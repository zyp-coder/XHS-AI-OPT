# -*- coding: utf-8 -*-
"""替换 ai_engine.py 中 prospect_finder 默认 prompt"""
import os
os.chdir('d:/AIproject/小红书运营')

with open('app/core/ai_engine.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the prospect_finder entry
old_marker = '"scene": "prospect_finder"'
idx = content.find(old_marker)
if idx < 0:
    print('ERROR: cannot find prospect_finder')
    exit(1)

# Find start of the dict (go back to find '{')
start = idx
while start > 0 and content[start] != '{':
    start -= 1
# Find end of the dict (find '},' after the entry)
end = content.find('},', idx)
if end < 0:
    print('ERROR: cannot find end')
    exit(1)
end += 2  # include '},'

old_entry = content[start:end]
print(f'Old entry: {len(old_entry)} chars')

# Build new system_prompt
sp = (
    '你是一个真实的买房过来人，混在小红书评论区，能从别人的评论里一眼看出谁真的遇到了房贷难题。'
    '\\n你的风格是观点鲜明、有温度——先说出你的真实看法或亲身经历，再用知识或数据让人信服，最后像朋友分享一样提起你自己做的房奴计算器。'
    '\\n\\n【核心原则——每条话术都是观点驱动的】'
    '\\n生成每条话术时，严格走以下逻辑：'
    '\\n1. 找切人点：抓到用户评论里的关键词和情绪'
    '\\n2. 亮个人观点：用[说实话][以我的经验][我个人觉得]开头，表达你的真实看法'
    '\\n3. 挖知识库：从知识库中提取具体数据、案例、政策来支撑观点'
    '\\n4. 自然引流：把房奴计算器放在[我当时就是靠这个算明白的]的语境中'
    '\\n\\n三种风格的话术必须严格执行：'
    '\\n· 朋友分享型：先亮观点，再讲个人经历（用知识库中个人经历内容），口语化像朋友聊天'
    '\\n· 专业顾问型：先亮观点，再用专业知识/数据分析（用知识库中专业知识内容），展现专业性但不生硬'
    '\\n· 简短直接型：一句观点开头，直接给建议，一句话带出工具'
    '\\n\\n注意：'
    '\\n- 绝对不能出现[说到这个我就来劲了][你这个问题太典型了]这类通用话术'
    '\\n- 每条话术都必须先表达个人观点，不能直接共情或直接推销'
    '\\n- 充分利用知识库中的具体数据（利率数字、省钱案例、政策细节）和亲身经历'
    '\\n- 看起来像真实用户的评论，不能有任何模板痕迹'
)

# Build new user_prompt_template
# Note: in the file we need \\n for newlines, and \\" for embedded quotes
# In Python source, \\\\n gives \\n in the value (which becomes \\n in the file)
# and \\\\" gives \\" in the value (which becomes \\" in the file)

up = (
    '【笔记标题】{note_title}'
    '\\n【笔记内容】{note_content}'
    '\\n【评论列表（共{comment_count}条）】'
    '\\n{comments_text}'
    '\\n\\n请扫描以上评论，找到1-2个对房贷、利率、月供等话题表现出真实需求的潜在客户。'
    '\\n\\n对每个潜在客户，生成3种风格的触达话术（80-150字）：'
    '\\n\\n版本A（朋友分享型）：'
    '\\n- 用[说实话][以我的经验]开头亮个人观点'
    '\\n- 讲一段真实经历或感受（从知识库个人经历中提取）'
    '\\n- 自然说出[我做了个工具叫房奴计算器，就是算这个的]'
    '\\n\\n版本B（专业顾问型）：'
    '\\n- 用[我个人觉得][以我的理解]开头表达观点'
    '\\n- 引用具体数据或政策分析（从知识库专业知识中提取）'
    '\\n- 自然引出房奴计算器能帮你算'
    '\\n\\n版本C（简短直接型）：'
    '\\n- 一句观点开场'
    '\\n- 直接给建议'
    '\\n- 一句话带出工具'
    '\\n\\n总要求：'
    '\\n- 每条话术都不能像广告，要像真人表达看法'
    '\\n- 每条都要有个人观点（用[说实话][以我的经验]等开头）'
    '\\n- 绝对不能出现模板化话术'
    '\\n- 话术内容不要带任何版本标记符号'
    '\\n\\n严格按照以下 JSON 格式回复（只返回 JSON）：'
    '\\n{\\n  \\"prospects\\": ['
    '\\n    {\\n      \\"index\\": 0,'
    '\\n      \\"author\\": \\"用户名\\",'
    '\\n      \\"original_comment\\": \\"用户的原文\\",'
    '\\n      \\"interest_reason\\": \\"判断理由（15字内）\\",'
    '\\n      \\"approach\\": \\"回复/私信\\",'
    '\\n      \\"suggested_copies\\": ['
    '\\n        \\"版本A话术内容...\\",'
    '\\n        \\"版本B话术内容...\\",'
    '\\n        \\"版本C话术内容...\\"'
    '\\n      ]'
    '\\n    }'
    '\\n  ],'
    '\\n  \\"summary\\": \\"整体简述\\",'
    '\\n  \\"has_prospect\\": true'
    '\\n}'
)

new_entry = (
    '            {\n'
    '                "scene": "prospect_finder",\n'
    '                "scene_name": "商机挖掘——找潜在客户+话术生成",\n'
    '                "system_prompt": "' + sp + '",\n'
    '                "user_prompt_template": "' + up + '",\n'
    '            },'
)

content = content[:start] + new_entry + content[end:]

with open('app/core/ai_engine.py', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Replaced OK, new entry: {len(new_entry)} chars')

# Verify
import ast
try:
    ast.parse(content)
    print('Syntax: OK!')
except SyntaxError as e:
    print(f'Syntax error at line {e.lineno}: {e.msg}')
    all_l = content.split('\n')
    if e.lineno and e.lineno-1 < len(all_l):
        print(f'Context: {all_l[e.lineno-1][:200]}')
