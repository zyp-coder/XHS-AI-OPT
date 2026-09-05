"""数据分析 API"""
from datetime import datetime, timedelta
from fastapi import APIRouter
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import engine, Note, Comment, DrainTask, DrainRecord, PromptLog
from app.schemas.schemas import DashboardStats
from app.core.browser import browser_engine

router = APIRouter()

@router.get("/browser-status")
async def get_browser_status():
    """获取浏览器引擎状态"""
    return await browser_engine.get_status()


@router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard():
    """获取看板统计数据"""
    with Session(engine) as session:
        # 笔记统计
        total_notes = session.query(Note).count()
        total_likes = session.query(func.sum(Note.likes)).scalar() or 0
        total_comments = session.query(func.sum(Note.comments_count)).scalar() or 0
        total_collects = session.query(func.sum(Note.collects)).scalar() or 0

        # 引流统计（当日）
        today_start = datetime.now().strftime("%Y-%m-%d 00:00:00")
        today_drains = session.query(DrainRecord).filter(
            DrainRecord.created_at >= today_start
        ).count()

        # 引流总计
        total_drains = session.query(DrainRecord).count()

        # 活跃任务数
        active_tasks = session.query(DrainTask).filter_by(
            status="running"
        ).count()

        # AI 调用统计（当日）
        api_calls_today = session.query(PromptLog).filter(
            PromptLog.created_at >= today_start
        ).count()

        return DashboardStats(
            total_notes=total_notes,
            total_likes=total_likes,
            total_comments=total_comments,
            total_collects=total_collects,
            today_drains=today_drains,
            total_drains=total_drains,
            active_tasks=active_tasks,
            api_calls_today=api_calls_today,
        )


@router.get("/notes-trend")
async def get_notes_trend(days: int = 7):
    """获取笔记发布趋势"""
    with Session(engine) as session:
        start_date = datetime.now() - timedelta(days=days)
        notes = session.query(Note).filter(
            Note.published_at >= start_date
        ).order_by(Note.published_at).all()

        # 按天分组
        trend = {}
        for n in notes:
            if n.published_at:
                day = n.published_at.strftime("%Y-%m-%d")
                if day not in trend:
                    trend[day] = {"count": 0, "likes": 0, "comments": 0}
                trend[day]["count"] += 1
                trend[day]["likes"] += n.likes or 0
                trend[day]["comments"] += n.comments_count or 0

        return {
            "days": list(trend.keys()),
            "counts": [v["count"] for v in trend.values()],
            "likes": [v["likes"] for v in trend.values()],
            "comments": [v["comments"] for v in trend.values()],
        }


@router.get("/drain-trend")
async def get_drain_trend(days: int = 7):
    """获取引流趋势"""
    with Session(engine) as session:
        start_date = datetime.now() - timedelta(days=days)
        records = session.query(DrainRecord).filter(
            DrainRecord.created_at >= start_date
        ).order_by(DrainRecord.created_at).all()

        trend = {}
        for r in records:
            day = r.created_at.strftime("%Y-%m-%d")
            if day not in trend:
                trend[day] = 0
            trend[day] += 1

        return {
            "days": list(trend.keys()),
            "counts": list(trend.values()),
        }


@router.get("/ai-stats")
async def get_ai_stats():
    """获取 AI 使用统计"""
    with Session(engine) as session:
        today_start = datetime.now().strftime("%Y-%m-%d 00:00:00")

        total_calls = session.query(PromptLog).count()
        today_calls = session.query(PromptLog).filter(
            PromptLog.created_at >= today_start
        ).count()

        total_tokens = session.query(
            func.sum(PromptLog.tokens_in + PromptLog.tokens_out)
        ).scalar() or 0

        today_tokens = session.query(
            func.sum(PromptLog.tokens_in + PromptLog.tokens_out)
        ).filter(PromptLog.created_at >= today_start).scalar() or 0

        # 按场景统计
        scene_stats = session.query(
            PromptLog.scene,
            func.count(PromptLog.id),
            func.sum(PromptLog.tokens_in + PromptLog.tokens_out),
        ).group_by(PromptLog.scene).all()

        return {
            "total_calls": total_calls,
            "today_calls": today_calls,
            "total_tokens": int(total_tokens),
            "today_tokens": int(today_tokens),
            "by_scene": [
                {"scene": s[0] or "未知", "count": s[1], "tokens": int(s[2] or 0)}
                for s in scene_stats
            ],
        }
