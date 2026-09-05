"""定时发布笔记 API"""
from datetime import datetime
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from app.models.models import engine, Schedule, Note
from app.schemas.schemas import ScheduleCreate, ScheduleResponse, MessageResponse
from app.core.scheduler import scheduler

router = APIRouter()


def _to_local_naive(dt: datetime) -> datetime:
    """前端传 ISO(UTC)，转为本地无时区时间，与库内 datetime.now() 口径一致"""
    if dt.tzinfo is not None:
        return dt.astimezone().replace(tzinfo=None)
    return dt


def _to_response(s: Schedule) -> ScheduleResponse:
    return ScheduleResponse(
        id=s.id, note_id=s.note_id, account_id=s.account_id,
        product_id=s.product_id, title=s.title, content=s.content,
        image_ids=s.image_ids, tags=s.tags, publish_at=s.publish_at,
        is_published=s.is_published, last_error=s.last_error,
        created_at=s.created_at,
    )


@router.get("/", response_model=list[ScheduleResponse])
async def list_schedules():
    """获取所有定时发布任务"""
    with Session(engine) as session:
        schedules = session.query(Schedule).order_by(
            Schedule.publish_at.asc()
        ).all()
        return [_to_response(s) for s in schedules]


@router.post("/", response_model=ScheduleResponse)
async def create_schedule(data: ScheduleCreate):
    """创建定时发布任务（关联一篇笔记草稿）"""
    publish_at = _to_local_naive(data.publish_at)
    if publish_at <= datetime.now():
        raise HTTPException(400, "发布时间需要是未来的时间")

    with Session(engine) as session:
        note = session.query(Note).filter_by(id=data.note_id).first()
        if not note:
            raise HTTPException(404, "笔记不存在")
        if note.status != "draft":
            raise HTTPException(400, "只能对草稿笔记设置定时发布")
        if not note.account_id:
            raise HTTPException(400, "该笔记未关联小红书账号")

        # 防止同一笔记重复排期
        dup = session.query(Schedule).filter(
            Schedule.note_id == data.note_id,
            Schedule.is_published == False,  # noqa: E712
        ).first()
        if dup:
            raise HTTPException(400, "该笔记已存在一个未执行的排期")

        schedule = Schedule(
            note_id=note.id,
            account_id=note.account_id,
            product_id=note.product_id,
            title=note.title,
            content=note.content,
            image_ids=note.images,
            tags=note.tags,
            publish_at=publish_at,
            is_published=False,
        )
        session.add(schedule)
        session.commit()
        session.refresh(schedule)
        schedule_id = schedule.id
        publish_at = schedule.publish_at

    # 注册到调度器
    try:
        scheduler.add_note_publish(schedule_id, publish_at)
    except Exception as e:
        raise HTTPException(500, f"调度器注册失败: {e}")

    with Session(engine) as session:
        schedule = session.query(Schedule).filter_by(id=schedule_id).first()
        return _to_response(schedule)


@router.delete("/{schedule_id}", response_model=MessageResponse)
async def delete_schedule(schedule_id: int):
    """删除定时发布任务"""
    with Session(engine) as session:
        schedule = session.query(Schedule).filter_by(id=schedule_id).first()
        if not schedule:
            raise HTTPException(404, "排期不存在")
        session.delete(schedule)
        session.commit()
    scheduler.remove_note_publish(schedule_id)
    return {"message": "已删除"}