"""全场景截流后端 API：场景配置 / 监控列表 / 退出日志 / 手动触发"""
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import (
    engine, ScenarioConfig, NoteMonitor, ExitLog,
)
from app.core import intercept_common as ic
from app.core.scenario_config import scenario_order

router = APIRouter()


class ScenarioConfigUpdate(BaseModel):
    scene_name: Optional[str] = None
    enabled: Optional[bool] = None
    top_n: Optional[int] = None
    max_candidates: Optional[int] = None
    scan_interval_min: Optional[int] = None
    entry_ttl_hours: Optional[int] = None
    no_climb_strikes: Optional[int] = None
    climb_likes_delta: Optional[int] = None
    emotion_ratio: Optional[float] = None
    intent_keywords: Optional[list] = None
    target_comments: Optional[int] = None
    max_comments: Optional[int] = None
    wash_hours: Optional[int] = None
    wash_interval_days: Optional[int] = None
    wash_likes_threshold: Optional[int] = None
    wash_replies_threshold: Optional[int] = None
    exit_wait_weeks: Optional[int] = None
    region_hint: Optional[str] = None


def _config_response(sc):
    return {c.name: getattr(sc, c.name) for c in ScenarioConfig.__table__.columns}


@router.get("/configs")
async def list_configs():
    """列出六个场景配置。"""
    with Session(engine) as s:
        rows = s.query(ScenarioConfig).all()
        by_name = {r.scenario: r for r in rows}
    out = []
    for sc in scenario_order():
        row = by_name.get(sc)
        out.append(_config_response(row) if row else ic.get_scenario_config(sc))
    return {"scenarios": out}


@router.post("/configs/{scenario}")
async def update_config(scenario: str, data: ScenarioConfigUpdate):
    if scenario not in scenario_order():
        raise HTTPException(400, f"未知场景: {scenario}")
    with Session(engine) as s:
        row = s.query(ScenarioConfig).filter_by(scenario=scenario).first()
        if not row:
            raise HTTPException(404, "场景配置不存在，请先初始化数据库")
        for k, v in data.model_dump(exclude_none=True).items():
            setattr(row, k, v)
        s.commit()
        s.refresh(row)
        return _config_response(row)


@router.get("/monitors")
async def list_monitors(scenario: str = None, active: int = 1, limit: int = 200):
    """查询笔记监控列表。active=1 只看监控中，active=0 含已退出。"""
    with Session(engine) as s:
        q = s.query(NoteMonitor)
        if scenario:
            q = q.filter_by(scenario=scenario)
        if active:
            q = q.filter_by(is_active=True)
        rows = q.order_by(NoteMonitor.entry_at.desc()).limit(limit).all()
    return [
        {
            "id": m.id, "scenario": m.scenario, "note_url": m.note_url,
            "title": m.title, "author": m.author, "state": m.state,
            "entry_at": m.entry_at, "expire_at": m.expire_at,
            "last_likes": m.last_likes, "last_comments": m.last_comments,
            "last_collects": m.last_collects, "last_view_rank": m.last_view_rank,
            "last_delta_likes": m.last_delta_likes,
            "our_comment_count": m.our_comment_count,
            "consecutive_no_climb": m.consecutive_no_climb,
            "exit_reason": m.exit_reason, "exited_at": m.exited_at,
        }
        for m in rows
    ]


@router.get("/exits")
async def list_exits(limit: int = 100):
    """退出日志。"""
    with Session(engine) as s:
        rows = s.query(ExitLog).order_by(ExitLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": e.id, "scenario": e.scenario, "exit_reason": e.exit_reason,
            "detail": e.detail, "note_url": e.target_note_url,
            "created_at": e.created_at,
        }
        for e in rows
    ]


@router.post("/run-once")
async def run_once():
    """手动触发一轮雷达扫描+清洗（开发调试用）。"""
    from app.core.radar_engine import radar_engine
    from app.core.action_engine import action_engine
    from app.core.wash_engine import wash_engine
    radar_engine.action_cb = action_engine.on_event
    from app.core.scheduler import scheduler
    try:
        await radar_engine.run_once()
    except Exception as e:
        raise HTTPException(500, f"Radar: {e}")
    try:
        await wash_engine.sweep()
    except Exception as e:
        raise HTTPException(500, f"Wash: {e}")
    return {"message": "已触发一轮截流扫描"}


class DebugProbeBody(BaseModel):
    url: str
    list_url: str = ""


@router.post("/debug/probe", status_code=200)
async def debug_probe(data: DebugProbeBody):
    """干跑调试：真机打开一篇笔记/一个列表页，把抓到的原始指标原样返回，供校准采集器。

    - 给 note_url → 点进级 point_metrics + 热评 hot_comment_top
    - 给 list_url → 列表级 list_metrics
    只读，不评论、不写库。
    """
    from app.core.browser import browser_engine, safe_print
    result = {"note": None, "hot_comment": None, "list": []}
    note_url = (data.url or "").strip()
    list_url = (data.list_url or "").strip()
    try:
        if note_url:
            pm = await browser_engine.point_metrics(note_url)
            result["note"] = pm
            if pm.get("_blocked"):
                result["note_detail"] = await browser_engine.get_note_content(note_url)
            hot = None
            if not pm.get("_blocked") and pm.get("likes", 0) >= 0:
                hot = await browser_engine.hot_comment_top(note_url)
            result["hot_comment"] = hot
        if list_url:
            result["list"] = await browser_engine.list_metrics(list_url, max_results=15)
    except Exception as e:
        raise HTTPException(500, f"探测失败: {e}")
    if result["note"] is None and not result["list"]:
        raise HTTPException(400, "请提供 note_url 或 list_url")
    return result


class ScenarioTryBody(BaseModel):
    scenario: str


class CommentPreviewBody(BaseModel):
    scenario: str
    note_title: str = ""
    note_content: str = ""
    note_author: str = ""
    extra: dict = {}


@router.post("/experience/try-scenario")
async def experience_try_scenario(data: ScenarioTryBody):
    """真机试跑：只跑指定场景的"发现+采集"，返回该场景会抓到的笔记(不评论、不写干预)。

    目的是让用户直观感受这个场景到底在盯什么、抓什么。
    """
    if data.scenario not in scenario_order():
        raise HTTPException(400, f"未知场景: {data.scenario}")
    from app.core.browser import browser_engine
    from app.core.radar_engine import radar_engine
    from app.core import intercept_common as ic
    from app.models.models import Account
    cfg = ic.get_scenario_config(data.scenario)
    try:
        with Session(engine) as sid:
            acc = sid.query(Account).filter_by(is_active=True).first()
        if acc:
            await browser_engine.ensure_ready(acc.id)
    except Exception:
        pass
    try:
        await radar_engine.scan_scenario(data.scenario, cfg)
    except Exception as e:
        raise HTTPException(500, f"试跑失败: {e}")
    # 汇总该场景监控池(含刚入列的)
    import sqlalchemy as sa
    with Session(engine) as s:
        rows = s.query(NoteMonitor).filter(NoteMonitor.scenario == data.scenario,
                                           NoteMonitor.is_active == True).order_by(
            NoteMonitor.updated_at.desc()).limit(10).all()
        notes = [
            {"title": m.title, "author": m.author, "likes": m.last_likes,
             "comments": m.last_comments, "rank": m.last_view_rank,
             "url": m.note_url, "state": m.state}
            for m in rows
        ]
    return {"scenario": data.scenario, "count": len(notes), "notes": notes}


@router.post("/experience/preview-comment")
async def experience_preview_comment(data: CommentPreviewBody):
    """AI 评论预览：按场景生成一条评论(不发布)。让用户直接看到每个场景会怎么说。"""
    if data.scenario not in scenario_order():
        raise HTTPException(400, f"未知场景: {data.scenario}")
    from app.core.ai_engine import ai_engine
    from app.core import intercept_common as ic
    cfg = ic.get_scenario_config(data.scenario)
    scene = f"{data.scenario}_comment"
    ctx = {
        "note_title": data.note_title or "示例：这篇笔记讲的是什么，请自行脑补主题",
        "note_content": data.note_content or "（未提供正文，可基于标题发挥）",
        "note_author": data.note_author or "示例博主",
    }
    # 命中场景补充字段
    if data.scenario in ("evergreen", "city"):
        kws = ic.active_keywords()
        ctx["keyword"] = (data.extra.get("keyword") or (kws[0] if kws else "")) or "示例关键词"
    region = cfg.get("region_hint")
    if data.scenario == "city":
        ctx["city"] = region or "深圳"
        ctx["region"] = region or "欢乐海岸"
    if data.scenario == "pain":
        ctx["pain_text"] = data.extra.get("pain_text") or data.note_title or "用户正在求助的原文"
    if data.scenario == "topic":
        ctx["topic_context"] = data.extra.get("topic_context") or "评论区正在激烈争论的问题"
    try:
        comment = ai_engine.generate_comment(scene, ctx)
    except Exception as e:
        raise HTTPException(500, f"生成失败: {e}")
    return {"scenario": data.scenario, "comment": (comment or "").strip().strip('"').strip("'")}