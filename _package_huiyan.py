# -*- coding: utf-8 -*-
"""打包脚本：将「慧眼识人助手」运营系统打包成独立 zip。
- 白名单复制：app/、main.py、config.py、requirements.txt、extension/、data/xhs_ops.db
- 清除数据库中的账号 Cookie 与 AI api_key（避免凭证泄露），保留产品资料(KB/话术/Prompt)
- 自动排除 __pycache__、*.pyc 等
"""
import io
import os
import shutil
import sqlite3
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
STAGE = os.path.join(ROOT, "_dist_stage")
PKG_NAME = "慧眼识人助手运营系统_v1.0"
ZIP_PATH = os.path.join(ROOT, PKG_NAME + ".zip")

# 清理旧的 staging / zip
if os.path.exists(STAGE):
    shutil.rmtree(STAGE)
if os.path.exists(ZIP_PATH):
    os.remove(ZIP_PATH)

os.makedirs(STAGE)

_IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo")


def copy_tree(rel):
    src = os.path.join(ROOT, rel)
    dst = os.path.join(STAGE, rel)
    shutil.copytree(src, dst, ignore=_IGNORE)
    print("  [dir ] ", rel)


def copy_file(rel):
    src = os.path.join(ROOT, rel)
    dst = os.path.join(STAGE, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("  [file] ", rel)


print("[1/4] 复制项目文件...")
copy_tree("app")
copy_tree("extension")
copy_file("main.py")
copy_file("config.py")
copy_file("requirements.txt")
copy_file(os.path.join("data", "xhs_ops.db"))

print("[2/4] 清除数据库中的账号 Cookie 与 API Key...")
db = os.path.join(STAGE, "data", "xhs_ops.db")
conn = sqlite3.connect(db)
cur = conn.cursor()
# 清 accounts 表 cookies
try:
    cur.execute("UPDATE accounts SET cookies = NULL")
    print("     已清空 accounts.cookies:", cur.rowcount, "行")
except sqlite3.OperationalError as e:
    print("     accounts 表跳过:", e)
# 清 AI api_key
try:
    cur.execute("UPDATE ai_config SET api_key = NULL")
    print("     已清空 ai_config.api_key:", cur.rowcount, "行")
except sqlite3.OperationalError as e:
    print("     ai_config 表跳过:", e)
# 清评论日志中的截图/敏感数据（可选，保持轻量）
conn.commit()
cur.execute("VACUUM")
conn.commit()
conn.close()

print("[3/4] 生成 zip...")
with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
    for base, dirs, files in os.walk(STAGE):
        for fn in files:
            full = os.path.join(base, fn)
            arc = os.path.join(PKG_NAME, os.path.relpath(full, STAGE))
            zf.write(full, arc)

print("[4/4] 清理临时目录...")
shutil.rmtree(STAGE)

size_mb = os.path.getsize(ZIP_PATH) / 1024.0 / 1024.0
print("完成！输出:", ZIP_PATH)
print("大小: %.2f MB" % size_mb)
