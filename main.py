# -*- coding: utf-8 -*-
"""FastAPI 应用入口"""
import os
import re
import sys
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# 将项目根目录加入 sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import HOST, PORT, UPLOAD_DIR
from app.models.models import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期"""
    # 启动时：初始化数据库
    init_db()
    # 启动调度器（定时发布等）
    from app.core.scheduler import scheduler
    try:
        scheduler.start()
    except Exception as e:
        print(f"[main] 调度器启动失败: {e}")
    yield
    # 关闭时：清理资源
    from app.core.browser import browser_engine
    try:
        await browser_engine.close()
    except Exception:
        pass
    try:
        scheduler.stop()
    except Exception:
        pass


app = FastAPI(
    title="小红书智慧运维工具",
    description="小红书智慧运维工具 — 知识库驱动评论回复",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件（前端 SPA）— 禁用 JS 缓存

class NoCacheStaticFiles(StaticFiles):
    """不缓存 JS 文件"""
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if path.endswith(".js"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app.mount("/static", NoCacheStaticFiles(directory="app/static"), name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# 启动时间戳，用于 JS 缓存破坏
_BOOT_TS = str(int(time.time()))


# ====== API 路由注册 ======
from app.api import accounts, notes, comments, drain, analytics, ai, materials, extension, knowledge_base, comment_logs, script_library, schedule, diagnosis

app.include_router(accounts.router, prefix="/api/accounts", tags=["账号管理"])
app.include_router(notes.router, prefix="/api/notes", tags=["笔记管理"])
app.include_router(comments.router, prefix="/api/comments", tags=["评论互动"])
app.include_router(drain.router, prefix="/api/drain", tags=["引流任务"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["数据分析"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI 配置"])
app.include_router(materials.router, prefix="/api/materials", tags=["素材库"])
app.include_router(extension.router, prefix="/api/extension", tags=["扩展"])
app.include_router(knowledge_base.router, prefix="/api/knowledge", tags=["知识库"])
app.include_router(comment_logs.router, prefix="/api/comment-logs", tags=["回复日志"])
app.include_router(script_library.router, prefix="/api/scripts", tags=["话术库"])
app.include_router(schedule.router, prefix="/api/schedule", tags=["定时发布"])

app.include_router(diagnosis.router, prefix="/api/diagnosis", tags=["账号诊断"])


@app.get("/")
async def root():
    """返回前端页面，JS 链接注入版本号防缓存"""
    html = Path("app/static/index.html").read_text(encoding="utf-8")
    html = re.sub(
        r'(<script src="/static/js/[^"]+\.js)(")',
        lambda m: f'{m.group(1)}?v={_BOOT_TS}"',
        html,
    )
    return HTMLResponse(html)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/favicon.ico")
async def favicon():
    return Response(content="", media_type="image/x-icon")


if __name__ == "__main__":
    import uvicorn
    print(f"  → 启动服务: http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT)
