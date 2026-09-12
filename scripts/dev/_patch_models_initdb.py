# -*- coding: utf-8 -*-
"""一次性脚本：将 models.py 的 init_db 默认 Prompt 改为委托给 ai_engine._get_default_prompts()
这样 Prompt 只有一个数据源，启动时 init_db 不会再用旧产品(房奴计算器)覆盖数据库。
"""
import io
import os

PATH = os.path.join(os.path.dirname(__file__), "app", "models", "models.py")

with io.open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

start_marker = "    default_prompts = [\n"
end_marker = "    # 插入/更新默认 Prompt\n"

i = content.find(start_marker)
j = content.find(end_marker)

if i == -1 or j == -1 or j <= i:
    raise SystemExit("未找到标记，patch 失败 i=%s j=%s" % (i, j))

replacement = (
    "    from app.core.ai_engine import ai_engine\n"
    "    default_prompts = ai_engine._get_default_prompts()\n"
    "\n"
)

new_content = content[:i] + replacement + content[j:]

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(new_content)

print("[patch] models.py init_db 已改为委托 ai_engine._get_default_prompts()")
print("[patch] 剩余是否还含 '房奴计算器':", "房奴计算器" in new_content)
