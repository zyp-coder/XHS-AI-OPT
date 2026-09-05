"""引流引擎 - 三种引流任务模式"""
import asyncio
import random
import time
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import (
    engine, DrainTask, DrainRecord, Note, TargetAccount, TargetKeyword,
    TaskType, TaskStatus, Account,
)
from app.core.browser import browser_engine
from app.core.ai_engine import ai_engine


def safe_print(*args, **kwargs):
    """安全打印：自动处理编码错误（Windows GBK 兼容）"""
    try:
        print(*args, **kwargs)
    except (UnicodeEncodeError, UnicodeError):
        text = " ".join(str(a) for a in args)
        try:
            print(text.encode("gbk", errors="replace").decode("gbk"), **kwargs)
        except Exception:
            pass


class DrainEngine:
    """引流引擎"""

    def __init__(self):
        self._running_tasks = {}  # task_id -> asyncio.Task

    # ----- 任务生命周期 -----

    async def start_task(self, task_id: int):
        """启动一个引流任务"""
        if task_id in self._running_tasks and not self._running_tasks[task_id].done():
            raise RuntimeError(f"任务 {task_id} 已在运行中")

        task_config = self._get_task(task_id)
        if not task_config:
            raise ValueError(f"任务 {task_id} 不存在")

        # 更新状态
        self._update_task_status(task_id, TaskStatus.RUNNING)

        # 启动异步任务
        loop = asyncio.get_event_loop()
        task = loop.create_task(self._execute_task(task_id))
        self._running_tasks[task_id] = task

    async def stop_task(self, task_id: int):
        """停止一个引流任务"""
        if task_id in self._running_tasks:
            self._running_tasks[task_id].cancel()
            del self._running_tasks[task_id]
        self._update_task_status(task_id, TaskStatus.STOPPED)

    async def pause_task(self, task_id: int):
        """暂停一个引流任务"""
        if task_id in self._running_tasks:
            self._running_tasks[task_id].cancel()
            del self._running_tasks[task_id]
        self._update_task_status(task_id, TaskStatus.PAUSED)

    def is_task_running(self, task_id: int) -> bool:
        """检查任务是否在运行"""
        return task_id in self._running_tasks and not self._running_tasks[task_id].done()

    # ----- 任务执行 -----

    async def _execute_task(self, task_id: int):
        """执行引流任务（主循环）"""
        try:
            task = self._get_task(task_id)
            if not task:
                return

            # 使用新的 ensure_ready 方法：自动启动浏览器+检查登录
            ready = await browser_engine.ensure_ready(task.account_id)
            if ready == "need_login":
                self._add_record(task_id, success=False,
                                 error_msg="小红书登录已过期，请在浏览器窗口中重新扫码登录")
                await self.stop_task(task_id)
                return
            elif ready.startswith("error"):
                self._add_record(task_id, success=False,
                                 error_msg=f"浏览器异常: {ready}")
                await self.stop_task(task_id)
                return

            # 校验任务配置
            config_ok = True
            task_type = task.task_type
            if isinstance(task_type, TaskType):
                task_type = task_type.value
            if task_type == "keyword" and not (task.keywords or []):
                config_ok = False
                err = "关键词截流任务未配置关键词"
            elif task_type == "account" and not (task.target_account_ids or []):
                config_ok = False
                err = "账号追踪任务未配置目标账号"
            elif task_type == "self_reply" and not (task.note_ids or []):
                config_ok = False
                err = "自营回复任务未关联笔记"
            if not config_ok:
                self._add_record(task_id, success=False, error_msg=err)
                await self.stop_task(task_id)
                return

            # 根据任务类型执行
            while self.is_task_running(task_id):
                task = self._get_task(task_id)
                if not task or task.status != TaskStatus.RUNNING.value:
                    break

                # 检查时段
                if not self._is_in_time_window(task.time_start, task.time_end):
                    await asyncio.sleep(60)  # 每分钟检查一次
                    continue

                # 检查每日上限
                if task.today_count >= task.daily_limit:
                    await asyncio.sleep(300)  # 5分钟后重试
                    continue

                # 执行一次引流操作（用 try 包裹，单次失败不影响整个任务）
                try:
                    if task.task_type == TaskType.KEYWORD_INTERCEPT.value:
                        await self._execute_keyword_intercept(task)
                    elif task.task_type == TaskType.ACCOUNT_TRACK.value:
                        await self._execute_account_track(task)
                    elif task.task_type == TaskType.SELF_REPLY.value:
                        await self._execute_self_reply(task)
                except Exception as e:
                    safe_print(f"单次操作失败（任务继续）: {e}")
                    self._add_record(task_id, success=False, error_msg=f"操作异常: {str(e)[:200]}")

                # 拟人化间隔：在配置间隔基础上增加随机波动
                task = self._get_task(task_id)
                if task and task.status == TaskStatus.RUNNING.value:
                    base = random.randint(task.interval_min, task.interval_max)
                    # 额外增加 30-180 秒的随机"思考时间"
                    extra = random.randint(30, 180)
                    # 10% 概率来个"摸鱼时间"（假装去倒水/上厕所）
                    if random.random() < 0.1:
                        extra += random.randint(120, 600)
                        safe_print(f"  ☕ 摸鱼中... 休息{extra//60}分钟")
                    delay = base + extra
                    safe_print(f"  等待 {delay} 秒后执行下一次操作")
                    await asyncio.sleep(delay)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            safe_print(f"任务 {task_id} 执行异常: {e}")
            self._add_record(task_id, success=False, error_msg=str(e))

    async def _execute_keyword_intercept(self, task: DrainTask):
        """关键词截流：搜索关键词 → AI生成评论 → 发布"""
        keywords = task.keywords or []
        if not keywords:
            return

        keyword = random.choice(keywords)
        safe_print(f"[关键词截流] 搜索: {keyword}")

        # 搜索笔记
        notes = await browser_engine.search_notes(keyword, max_results=5)
        if not notes:
            safe_print(f"  未搜到相关笔记")
            return

        # 随机选一篇
        target = random.choice(notes)
        title_safe = target.get("title", "").encode("gbk", errors="replace").decode("gbk")
        safe_print(f"[关键词截流] 目标: {title_safe}")

        # 获取笔记详情的上下文
        note_detail = await browser_engine.get_note_content(target["url"])

        # 如果笔记被限制访问，跳过
        if note_detail.get("_blocked"):
            safe_print(f"  ⛔ 笔记被限制访问，跳过: {title_safe}")
            return

        # AI 生成评论
        try:
            comment = ai_engine.generate_comment("intercept_comment", {
                "note_title": target["title"],
                "note_content": note_detail.get("content", ""),
            })
        except Exception as e:
            self._add_record(task.id, success=False, error_msg=str(e))
            return

        if not comment:
            return

        # 去掉可能的引号
        comment = comment.strip().strip('"').strip("'")

        # 发布评论
        success = await browser_engine.comment_on_note(target["url"], comment)

        # 记录
        self._add_record(
            task.id,
            target_note_url=target["url"],
            target_note_title=target["title"],
            target_author=target.get("author", ""),
            ai_response=comment,
            comment_text=comment,
            success=success,
        )

        if success:
            self._increment_task_count(task.id)

    async def _execute_account_track(self, task: DrainTask):
        """账号追踪：查看目标账号最新笔记 → AI评论"""
        target_ids = task.target_account_ids or []
        if not target_ids:
            return

        target_id = random.choice(target_ids)

        from app.models.models import TargetAccount
        with Session(engine) as session:
            ta = session.query(TargetAccount).filter_by(id=target_id).first()

        if not ta or not ta.note_url:
            return

        safe_print(f"[账号追踪] 目标: {ta.nickname}")

        # 访问目标账号主页
        await browser_engine.go_to(ta.note_url)
        await browser_engine.random_delay(3, 5)

        # 获取最新笔记
        try:
            # 找最新笔记链接
            note_links = await browser_engine.page.query_selector_all(
                'a[href*="/explore/"]'
            )
            if not note_links:
                return

            href = await note_links[0].get_attribute("href")
            if not href:
                return

            note_url = f"https://www.xiaohongshu.com{href}" if href.startswith("/") else href

            # 获取笔记内容
            note_detail = await browser_engine.get_note_content(note_url)

            # 如果笔记被限制访问，跳过
            if note_detail.get("_blocked"):
                safe_print(f"  ⛔ 笔记被限制访问，跳过: {note_url}")
                return

            # AI 生成评论（中介场景）
            try:
                comment = ai_engine.generate_comment("agent_comment", {
                    "note_title": note_detail.get("title", ""),
                    "note_content": note_detail.get("content", ""),
                })
            except Exception as e:
                self._add_record(task.id, success=False, error_msg=str(e))
                return

            if comment:
                comment = comment.strip().strip('"').strip("'")
                success = await browser_engine.comment_on_note(note_url, comment)

                self._add_record(
                    task.id,
                    target_note_url=note_url,
                    target_note_title=note_detail.get("title", ""),
                    target_author=ta.nickname,
                    ai_response=comment,
                    comment_text=comment,
                    success=success,
                )

                if success:
                    self._increment_task_count(task.id)

        except Exception as e:
            safe_print(f"账号追踪操作失败（跳过）: {e}")

    async def _execute_self_reply(self, task: DrainTask):
        """自营笔记回复：检查自己笔记的新评论 → AI回复"""
        note_ids = task.note_ids or []
        if not note_ids:
            return

        for note_id in note_ids:
            with Session(engine) as session:
                note = session.query(Note).filter_by(id=note_id).first()

            if not note or not note.xhs_note_id:
                continue

            note_url = f"https://www.xiaohongshu.com/explore/{note.xhs_note_id}"
            safe_print(f"[自营回复] 检查笔记: {note.title}")

            # 获取笔记页面上的评论
            await browser_engine.go_to(note_url)
            await browser_engine.random_delay(2, 4)

            try:
                # 尝试获取评论列表
                comment_items = await browser_engine.page.query_selector_all(
                    '[class*="comment-item"]'
                )

                for item in comment_items[:5]:  # 最多处理前5条
                    try:
                        user_el = await item.query_selector('[class*="username"]')
                        content_el = await item.query_selector('[class*="content"]')
                        reply_btn = await item.query_selector('[class*="reply"]')

                        if not user_el or not content_el:
                            continue

                        username = await user_el.inner_text()
                        comment_content = await content_el.inner_text()

                        if reply_btn:
                            # AI 生成回复
                            try:
                                reply = ai_engine.generate_comment("reply_self", {
                                    "note_title": note.title or "",
                                    "comment_content": comment_content,
                                })
                            except Exception as e:
                                continue

                            if reply:
                                reply = reply.strip().strip('"').strip("'")
                                await reply_btn.click()
                                await browser_engine.random_delay()

                                input_box = await browser_engine.page.query_selector(
                                    '[class*="comment-input"], textarea'
                                )
                                if input_box:
                                    await browser_engine.simulate_typing(input_box, reply)
                                    await browser_engine.random_delay()
                                    submit = await browser_engine.page.query_selector(
                                        'button:has-text("发布"), button:has-text("发送")'
                                    )
                                    if submit:
                                        await submit.click()
                                    await browser_engine.random_delay()

                                self._add_record(
                                    task.id,
                                    target_note_url=note_url,
                                    target_note_title=note.title,
                                    ai_response=reply,
                                    comment_text=reply,
                                    success=True,
                                )
                                self._increment_task_count(task.id)

                    except Exception:
                        continue

            except Exception as e:
                safe_print(f"自营回复操作失败（跳过）: {e}")

    # ----- 辅助方法 -----

    def _get_task(self, task_id: int) -> Optional[DrainTask]:
        """获取任务配置"""
        with Session(engine) as session:
            return session.query(DrainTask).filter_by(id=task_id).first()

    def _update_task_status(self, task_id: int, status: TaskStatus):
        """更新任务状态"""
        with Session(engine) as session:
            task = session.query(DrainTask).filter_by(id=task_id).first()
            if task:
                task.status = status
                session.commit()

    def _increment_task_count(self, task_id: int):
        """增加任务计数"""
        with Session(engine) as session:
            task = session.query(DrainTask).filter_by(id=task_id).first()
            if task:
                # 检查是否需要重置今日计数
                today = datetime.now().strftime("%Y-%m-%d")
                last_run = task.last_run_at
                if last_run and last_run.strftime("%Y-%m-%d") != today:
                    task.today_count = 0
                task.today_count += 1
                task.total_count += 1
                task.last_run_at = datetime.now()
                session.commit()

    def _add_record(self, task_id: int, target_note_url: str = "",
                    target_note_title: str = "", target_author: str = "",
                    ai_prompt: str = "", ai_response: str = "",
                    comment_text: str = "", success: bool = True,
                    error_msg: str = ""):
        """添加引流记录"""
        with Session(engine) as session:
            record = DrainRecord(
                task_id=task_id,
                target_note_url=target_note_url,
                target_note_title=target_note_title,
                target_author=target_author,
                ai_prompt=ai_prompt,
                ai_response=ai_response,
                comment_text=comment_text,
                success=success,
                error_msg=error_msg,
            )
            session.add(record)
            session.commit()

    def _is_in_time_window(self, time_start: str, time_end: str) -> bool:
        """检查当前时间是否在允许的时间窗口内"""
        now = datetime.now()
        start_h, start_m = map(int, time_start.split(":"))
        end_h, end_m = map(int, time_end.split(":"))
        start_min = start_h * 60 + start_m
        end_min = end_h * 60 + end_m
        current_min = now.hour * 60 + now.minute
        return start_min <= current_min <= end_min


# 全局单例
drain_engine = DrainEngine()
