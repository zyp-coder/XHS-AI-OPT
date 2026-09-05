"""引流任务 API"""
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from app.models.models import engine, DrainTask, DrainRecord, TaskType
from app.schemas.schemas import (
    DrainTaskCreate, DrainTaskUpdate, DrainTaskResponse,
    DrainRecordResponse, MessageResponse,
)
from app.core.drain_engine import drain_engine
from app.core.browser import browser_engine

router = APIRouter()


@router.get("/tasks", response_model=list[DrainTaskResponse])
async def list_tasks():
    """获取所有引流任务"""
    with Session(engine) as session:
        tasks = session.query(DrainTask).order_by(DrainTask.created_at.desc()).all()
        results = []
        for t in tasks:
            r = DrainTaskResponse(
                id=t.id, account_id=t.account_id, name=t.name,
                task_type=t.task_type, status=t.status,
                keywords=t.keywords, target_account_ids=t.target_account_ids,
                note_ids=t.note_ids,
                daily_limit=t.daily_limit, interval_min=t.interval_min,
                interval_max=t.interval_max, time_start=t.time_start,
                time_end=t.time_end, comment_style=t.comment_style,
                today_count=t.today_count, total_count=t.total_count,
                last_run_at=t.last_run_at, created_at=t.created_at,
            )
            results.append(r)
        return results


@router.post("/tasks", response_model=DrainTaskResponse)
async def create_task(data: DrainTaskCreate):
    """创建引流任务"""
    if data.task_type not in [t.value for t in TaskType]:
        raise HTTPException(400, f"无效的任务类型: {data.task_type}")

    with Session(engine) as session:
        task = DrainTask(
            account_id=data.account_id,
            name=data.name,
            task_type=data.task_type,
            status="stopped",
            keywords=data.keywords,
            target_account_ids=data.target_account_ids,
            note_ids=data.note_ids,
            daily_limit=data.daily_limit,
            interval_min=data.interval_min,
            interval_max=data.interval_max,
            time_start=data.time_start,
            time_end=data.time_end,
            comment_style=data.comment_style,
        )
        session.add(task)
        session.commit()
        session.refresh(task)

        return DrainTaskResponse(
            id=task.id, account_id=task.account_id, name=task.name,
            task_type=task.task_type, status=task.status,
            keywords=task.keywords, target_account_ids=task.target_account_ids,
            note_ids=task.note_ids,
            daily_limit=task.daily_limit, interval_min=task.interval_min,
            interval_max=task.interval_max, time_start=task.time_start,
            time_end=task.time_end, comment_style=task.comment_style,
            today_count=task.today_count, total_count=task.total_count,
            last_run_at=task.last_run_at, created_at=task.created_at,
        )


@router.put("/tasks/{task_id}", response_model=DrainTaskResponse)
async def update_task(task_id: int, data: DrainTaskUpdate):
    """更新引流任务"""
    with Session(engine) as session:
        task = session.query(DrainTask).filter_by(id=task_id).first()
        if not task:
            raise HTTPException(404, "任务不存在")

        if data.name is not None:
            task.name = data.name
        if data.daily_limit is not None:
            task.daily_limit = data.daily_limit
        if data.interval_min is not None:
            task.interval_min = data.interval_min
        if data.interval_max is not None:
            task.interval_max = data.interval_max
        if data.time_start is not None:
            task.time_start = data.time_start
        if data.time_end is not None:
            task.time_end = data.time_end
        if data.comment_style is not None:
            task.comment_style = data.comment_style
        if data.keywords is not None:
            task.keywords = data.keywords
        if data.target_account_ids is not None:
            task.target_account_ids = data.target_account_ids

        session.commit()
        session.refresh(task)

        return DrainTaskResponse(
            id=task.id, account_id=task.account_id, name=task.name,
            task_type=task.task_type, status=task.status,
            keywords=task.keywords, target_account_ids=task.target_account_ids,
            note_ids=task.note_ids,
            daily_limit=task.daily_limit, interval_min=task.interval_min,
            interval_max=task.interval_max, time_start=task.time_start,
            time_end=task.time_end, comment_style=task.comment_style,
            today_count=task.today_count, total_count=task.total_count,
            last_run_at=task.last_run_at, created_at=task.created_at,
        )


@router.delete("/tasks/{task_id}", response_model=MessageResponse)
async def delete_task(task_id: int):
    """删除引流任务"""
    # 先停止
    if drain_engine.is_task_running(task_id):
        await drain_engine.stop_task(task_id)

    with Session(engine) as session:
        task = session.query(DrainTask).filter_by(id=task_id).first()
        if not task:
            raise HTTPException(404, "任务不存在")
        session.delete(task)
        session.commit()
    return {"message": "删除成功"}


@router.post("/tasks/{task_id}/start", response_model=MessageResponse)
async def start_task(task_id: int):
    """启动引流任务"""
    # 先检查浏览器是否就绪
    with Session(engine) as session:
        task = session.query(DrainTask).filter_by(id=task_id).first()
        if not task:
            raise HTTPException(404, "任务不存在")
        account_id = task.account_id
        task_type = task.task_type
        keywords = task.keywords or []
        target_ids = task.target_account_ids or []
        note_ids = task.note_ids or []

    if not account_id:
        raise HTTPException(400, "任务未关联小红书账号")

    # 校验任务配置
    if task_type == "keyword" and not keywords:
        raise HTTPException(400, "关键词截流任务需要至少设置一个关键词")
    elif task_type == "account" and not target_ids:
        raise HTTPException(400, "账号追踪任务需要至少添加一个目标账号")
    elif task_type == "self_reply" and not note_ids:
        raise HTTPException(400, "自营回复任务需要至少关联一篇笔记")

    ready = await browser_engine.ensure_ready(account_id)
    if ready == "need_login":
        raise HTTPException(400, "小红书未登录，请先在「账号管理」中扫码登录")
    elif ready.startswith("error"):
        raise HTTPException(500, f"浏览器异常: {ready}")

    try:
        await drain_engine.start_task(task_id)
        return {"message": "任务已启动"}
    except (RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.post("/tasks/{task_id}/stop", response_model=MessageResponse)
async def stop_task(task_id: int):
    """停止引流任务"""
    await drain_engine.stop_task(task_id)
    return {"message": "任务已停止"}


@router.post("/tasks/{task_id}/pause", response_model=MessageResponse)
async def pause_task(task_id: int):
    """暂停引流任务"""
    await drain_engine.pause_task(task_id)
    return {"message": "任务已暂停"}


@router.get("/tasks/{task_id}", response_model=DrainTaskResponse)
async def get_task(task_id: int):
    """获取单个任务详情"""
    with Session(engine) as session:
        task = session.query(DrainTask).filter_by(id=task_id).first()
        if not task:
            raise HTTPException(404, "任务不存在")
        return DrainTaskResponse(
            id=task.id, account_id=task.account_id, name=task.name,
            task_type=task.task_type, status=task.status,
            keywords=task.keywords, target_account_ids=task.target_account_ids,
            note_ids=task.note_ids,
            daily_limit=task.daily_limit, interval_min=task.interval_min,
            interval_max=task.interval_max, time_start=task.time_start,
            time_end=task.time_end, comment_style=task.comment_style,
            today_count=task.today_count, total_count=task.total_count,
            last_run_at=task.last_run_at, created_at=task.created_at,
        )


# ====== 引流记录 ======

@router.get("/records", response_model=list[DrainRecordResponse])
async def list_records(task_id: int = None, limit: int = 100):
    """获取引流记录"""
    with Session(engine) as session:
        query = session.query(DrainRecord)
        if task_id:
            query = query.filter_by(task_id=task_id)
        records = query.order_by(DrainRecord.created_at.desc()).limit(limit).all()
        return records


# ====== 目标账号 ======

from app.models.models import TargetAccount
from app.schemas.schemas import TargetAccountCreate, TargetAccountResponse


@router.get("/target-accounts", response_model=list[TargetAccountResponse])
async def list_target_accounts():
    """获取目标账号列表"""
    with Session(engine) as session:
        accounts = session.query(TargetAccount).order_by(
            TargetAccount.created_at.desc()
        ).all()
        return accounts


@router.post("/target-accounts", response_model=TargetAccountResponse)
async def create_target_account(data: TargetAccountCreate):
    """添加目标账号"""
    with Session(engine) as session:
        account = TargetAccount(**data.model_dump())
        session.add(account)
        session.commit()
        session.refresh(account)
        return account


@router.delete("/target-accounts/{account_id}", response_model=MessageResponse)
async def delete_target_account(account_id: int):
    """删除目标账号"""
    with Session(engine) as session:
        account = session.query(TargetAccount).filter_by(id=account_id).first()
        if not account:
            raise HTTPException(404, "账号不存在")
        session.delete(account)
        session.commit()
    return {"message": "删除成功"}


# ====== 目标关键词 ======

from app.models.models import TargetKeyword
from app.schemas.schemas import KeywordCreate, KeywordResponse


@router.get("/keywords", response_model=list[KeywordResponse])
async def list_keywords():
    """获取关键词列表"""
    with Session(engine) as session:
        keywords = session.query(TargetKeyword).order_by(
            TargetKeyword.created_at.desc()
        ).all()
        return keywords


@router.post("/keywords", response_model=KeywordResponse)
async def create_keyword(data: KeywordCreate):
    """添加关键词"""
    with Session(engine) as session:
        kw = TargetKeyword(keyword=data.keyword)
        session.add(kw)
        session.commit()
        session.refresh(kw)
        return kw


@router.delete("/keywords/{keyword_id}", response_model=MessageResponse)
async def delete_keyword(keyword_id: int):
    """删除关键词"""
    with Session(engine) as session:
        kw = session.query(TargetKeyword).filter_by(id=keyword_id).first()
        if not kw:
            raise HTTPException(404, "关键词不存在")
        session.delete(kw)
        session.commit()
    return {"message": "删除成功"}
