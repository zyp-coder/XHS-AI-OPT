"""任务调度器 - 定时任务管理"""
import asyncio
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app.models.models import engine, DrainTask, Schedule, Note, NoteStatus, TaskStatus


class Scheduler:
    """任务调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self._started = False

    def start(self):
        """启动调度器"""
        if self._started:
            return
        self.scheduler.start()
        self._started = True
        print("[调度器] 已启动")

        # 加载持久化的定时任务
        self._load_scheduled_tasks()

    def stop(self):
        """停止调度器"""
        if self._started:
            self.scheduler.shutdown(wait=False)
            self._started = False
            print("[调度器] 已停止")

    def _load_scheduled_tasks(self):
        """从数据库加载并注册定时任务"""
        with Session(engine) as session:
            # 定时发布笔记
            schedules = session.query(Schedule).filter_by(is_published=False).all()
            for s in schedules:
                if s.publish_at and s.publish_at > datetime.now():
                    self._schedule_note_publish(s.id, s.publish_at)

    def _schedule_note_publish(self, schedule_id: int, publish_at: datetime):
        """注册定时发布笔记任务"""
        run_date = publish_at
        self.scheduler.add_job(
            func=self._publish_note_job,
            trigger="date",
            run_date=run_date,
            args=[schedule_id],
            id=f"publish_note_{schedule_id}",
            replace_existing=True,
            misfire_grace_time=300,
        )
        print(f"[调度器] 已注册定时发布: {schedule_id} @ {run_date}")

    async def _publish_note_job(self, schedule_id: int):
        """执行定时发布笔记"""
        from app.core.browser import browser_engine

        with Session(engine) as session:
            schedule = session.query(Schedule).filter_by(id=schedule_id).first()
            if not schedule or schedule.is_published:
                return
            schedule_id_ = schedule.id
            account_id = schedule.account_id
            if schedule.note_id:
                note = session.query(Note).filter_by(id=schedule.note_id).first()
            else:
                note = None

        try:
            if not account_id:
                raise RuntimeError("该排期未关联小红书账号")
            if not note:
                raise RuntimeError("关联的笔记已不存在")

            # 先确保浏览器就绪
            ready = await browser_engine.ensure_ready(account_id)
            if ready != "ok":
                raise RuntimeError(f"浏览器未就绪: {ready}")

            # 真实发布
            success = await browser_engine.publish_note(
                title=note.title or schedule.title or "",
                content=note.content or schedule.content or "",
                image_paths=note.images or schedule.image_ids or [],
                tags=note.tags or schedule.tags or [],
            )
            if not success:
                raise RuntimeError("小红书发布返回失败")

            # 更新排期与笔记状态
            with Session(engine) as session:
                s = session.query(Schedule).filter_by(id=schedule_id_).first()
                if s:
                    s.is_published = True
                    s.last_error = None
                n = session.query(Note).filter_by(id=note.id).first()
                if n and n.status == NoteStatus.DRAFT:
                    n.status = NoteStatus.PUBLISHED
                    n.published_at = datetime.now()
                session.commit()
            print(f"[调度器] 定时发布成功: {schedule_id_}")
        except Exception as e:
            print(f"[调度器] 定时发布失败 {schedule_id_}: {e}")
            with Session(engine) as session:
                s = session.query(Schedule).filter_by(id=schedule_id_).first()
                if s and not s.is_published:
                    s.last_error = str(e)
                    session.commit()

    def add_note_publish(self, schedule_id: int, publish_at: datetime):
        """添加定时发布任务"""
        self._schedule_note_publish(schedule_id, publish_at)

    def remove_note_publish(self, schedule_id: int):
        """移除定时发布任务"""
        job_id = f"publish_note_{schedule_id}"
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

    def get_jobs(self) -> list[dict]:
        """获取所有定时任务"""
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": str(job.next_run_time) if job.next_run_time else None,
                "trigger": str(job.trigger),
            })
        return jobs


# 全局单例
scheduler = Scheduler()
