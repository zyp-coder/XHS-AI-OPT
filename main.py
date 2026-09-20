# -*- coding: utf-8 -*-
"""FastAPI 应用入口"""
import logging
import os
import re
import sys
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
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
    # 启动时：清一轮过期数据（客户数据 90 天 / 运行数据 30 天，与插件端口径一致）
    from app.core.retention import sweep_expired
    try:
        sweep_expired()
    except Exception as e:
        print(f"[main] 过期数据清除失败: {e}")
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

# ── 本地服务入口加固 ────────────────────────────────────────
# 服务只监听 127.0.0.1，但仍有两类浏览器侧风险，仅靠「监听本机」挡不住：
#   1) DNS 重绑定：外部域名解析到 127.0.0.1 后，页面就成了「同源」，绕过同源策略直连本服务
#      → 校验 Host 头只在放行名单内（浏览器无法伪造 Host）
#   2) 跨站页面直连：任意网页 fetch 本机端口（POST 一律带 Origin，表单提交也带）
#      → /api/ 下带 Origin 的请求必须来自本机页面或浏览器扩展，否则拒绝
# 本机命令行/脚本调用不带 Origin，照常放行（这类调用本就能直接读 data/ 目录，无需设防）。
_ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
_ALLOWED_ORIGINS = {"http://%s:%d" % (HOST, PORT), "http://localhost:%d" % PORT}
# Chrome 扩展 ID 固定为 32 位 a–p 字母；开发期免打包加载的 ID 会变，故按形态放行
_EXT_ORIGIN_RE = re.compile(r"^chrome-extension://[a-p]{32}$")
_guard_log = logging.getLogger("uvicorn.error")

# CORS 配置：只放行本机页面与浏览器扩展（原先的 * 会让任意网站在浏览器里读写本机数据）
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_ALLOWED_ORIGINS),
    allow_origin_regex=_EXT_ORIGIN_RE.pattern,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def local_access_guard(request: Request, call_next):
    if request.url.hostname not in _ALLOWED_HOSTS:
        _guard_log.warning("[guard] blocked non-local host: %r", request.headers.get("host"))
        return JSONResponse({"detail": "仅允许本机访问"}, status_code=403)
    if request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and origin not in _ALLOWED_ORIGINS and not _EXT_ORIGIN_RE.match(origin):
            _guard_log.warning("[guard] blocked non-local origin: %s %s origin=%s",
                               request.method, request.url.path, origin)
            return JSONResponse({"detail": "来源未被允许"}, status_code=403)
    return await call_next(request)

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
from app.api import accounts, notes, comments, drain, analytics, ai, materials, extension, knowledge_base, comment_logs, script_library, schedule, diagnosis, customers, messages, intercept

app.include_router(accounts.router, prefix="/api/accounts", tags=["账号管理"])
app.include_router(notes.router, prefix="/api/notes", tags=["笔记管理"])
app.include_router(comments.router, prefix="/api/comments", tags=["评论互动"])
app.include_router(drain.router, prefix="/api/drain", tags=["引流任务"])
app.include_router(intercept.router, prefix="/api/intercept", tags=["全场景截流"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["数据分析"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI 配置"])
app.include_router(materials.router, prefix="/api/materials", tags=["素材库"])
app.include_router(extension.router, prefix="/api/extension", tags=["扩展"])
app.include_router(knowledge_base.router, prefix="/api/knowledge", tags=["知识库"])
app.include_router(comment_logs.router, prefix="/api/comment-logs", tags=["回复日志"])
app.include_router(script_library.router, prefix="/api/scripts", tags=["话术库"])
app.include_router(schedule.router, prefix="/api/schedule", tags=["定时发布"])

app.include_router(diagnosis.router, prefix="/api/diagnosis", tags=["账号诊断"])
app.include_router(customers.router, prefix="/api/customers", tags=["客户邮箱"])
app.include_router(messages.router, prefix="/api/messages", tags=["消息中心"])


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
