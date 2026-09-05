"""评论回复日志 API"""
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.orm import Session

from app.models.models import engine, CommentLog
from app.schemas.schemas import CommentLogCreate, CommentLogResponse, MessageResponse

router = APIRouter()


@router.get("/", response_model=list[CommentLogResponse])
async def list_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    source: str = None,
    status: str = None,
):
    """获取回复日志列表，支持分页和筛选"""
    with Session(engine) as session:
        query = session.query(CommentLog)
        if source:
            query = query.filter_by(source=source)
        if status:
            query = query.filter_by(status=status)
        total = query.count()
        items = query.order_by(CommentLog.created_at.desc()) \
                     .offset((page - 1) * page_size) \
                     .limit(page_size) \
                     .all()
        return items


@router.post("/", response_model=CommentLogResponse, status_code=201)
async def create_log(data: CommentLogCreate):
    """新增回复日志"""
    with Session(engine) as session:
        log = CommentLog(**data.model_dump())
        session.add(log)
        session.commit()
        session.refresh(log)
        return log


@router.get("/{log_id}", response_model=CommentLogResponse)
async def get_log(log_id: int):
    """获取单条日志"""
    with Session(engine) as session:
        log = session.query(CommentLog).filter_by(id=log_id).first()
        if not log:
            raise HTTPException(404, "日志不存在")
        return log


@router.delete("/{log_id}", response_model=MessageResponse)
async def delete_log(log_id: int):
    """删除日志"""
    with Session(engine) as session:
        log = session.query(CommentLog).filter_by(id=log_id).first()
        if not log:
            raise HTTPException(404, "日志不存在")
        session.delete(log)
        session.commit()
    return {"message": "删除成功"}


@router.delete("/", response_model=MessageResponse)
async def clear_logs():
    """清空所有日志"""
    with Session(engine) as session:
        session.query(CommentLog).delete()
        session.commit()
    return {"message": "已清空"}
