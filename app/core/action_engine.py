"""ActionEngine·评论执行引擎。

消费 Radar 命中事件，按场景生成评论并发布，写 DrainRecord。
被 WashEngine 复用于"删除后重发"。浏览器与 AI 来自全局单例。
"""
import asyncio
import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.models import (
    engine, NoteMonitor, DrainRecord, Account, WashStatus,
)
from app.core.browser import browser_engine
from app.core.ai_engine import ai_engine
from app.core import intercept_common as ic


def safe_print(*a, **k):
    try:
        print(*a, **k)
    except UnicodeError:
        pass


class ActionEngine:
    def __init__(self):
        self._busy_monitors = set()   # 防止同一笔记并发重复评论

    # ============ 事件入口(Radar 调用) ============

    async def on_event(self, scenario: str, monitor_id: int):
        if monitor_id in self._busy_monitors:
            return
        self._busy_monitors.add(monitor_id)
        try:
            with Session(engine) as s:
                mon = s.query(NoteMonitor).filter_by(id=monitor_id).first()
            if not mon or not mon.is_active:
                return
            account_id = self._pick_account()
            if not account_id:
                safe_print("[Action] 无可用小红书账号, 跳过干预")
                return
            cfg = ic.get_scenario_config(scenario)
            # 计数控制: 达到上限不再追加
            if (mon.our_comment_count or 0) >= (cfg.get("max_comments", 5) or 999):
                return
            await self._post(
                scenario=scenario, monitor=mon, account_id=account_id, cfg=cfg,
                keyword=self._keyword_for(scenario), region=self._region_for(cfg),
            )
        finally:
            self._busy_monitors.discard(monitor_id)

    # ============ 发布(评论生成 + 发送 + 记录) ============

    async def _post(self, scenario, monitor, account_id, cfg,
                    keyword: str = "", region: str = "", is_repost: bool = False):
        # 拟人: 保证浏览器就绪
        ready = await browser_engine.ensure_ready(account_id)
        if ready == "need_login":
            safe_print("[Action] 登录过期")
            return
        note_detail = await browser_engine.get_note_content(monitor.note_url)
        if note_detail.get("_blocked"):
            return

        note_title = note_detail.get("title") or monitor.title or ""
        note_content = note_detail.get("content") or ""
        scene = f"{scenario}_comment"
        ctx = {
            "note_title": note_title,
            "note_content": note_content,
            "note_author": monitor.author or "",
        }
        if keyword:
            ctx["keyword"] = keyword
        if region:
            ctx["city"] = region
            ctx["region"] = region
        if scenario == "pain":
            ctx["pain_text"] = note_title[:120]
        if scenario == "topic":
            hot = await browser_engine.hot_comment_top(monitor.note_url)
            ctx["topic_context"] = (hot.get("content") or note_title)[:200]

        try:
            comment = ai_engine.generate_comment(scene, ctx)
        except Exception as e:
            safe_print(f"[Action][{scenario}] AI 生成失败: {e}")
            return
        if not comment:
            return
        comment = comment.strip().strip('"').strip("'")

        success = await browser_engine.comment_on_note(monitor.note_url, comment, skip_goto=True)

        if success:
            ic.update_monitor_fields(monitor.id, our_comment_count=(monitor.our_comment_count or 0) + 1)
            with Session(engine) as s:
                rec = DrainRecord(
                    task_id=None, monitor_id=monitor.id, scenario=scenario,
                    target_note_url=monitor.note_url,
                    target_note_title=note_title[:280],
                    target_author=monitor.author or "",
                    ai_response=comment, comment_text=comment,
                    success=True,
                    wash_status=WashStatus.PENDING.value,
                    wash_at=datetime.now() + timedelta(hours=self._wash_hours(cfg)),
                )
                s.add(rec)
                s.commit()
            safe_print(f"[Action][{scenario}] 已评论: {note_title[:20]} {'重发' if is_repost else ''}")

    # ============ 供 WashEngine 使用的重发 ============

    async def repost(self, monitor_id: int, old_record_id: int = None,
                     scenario: str = None):
        with Session(engine) as s:
            mon = s.query(NoteMonitor).filter_by(id=monitor_id).first()
        if not mon:
            return
        scenario = scenario or mon.scenario
        cfg = ic.get_scenario_config(scenario)
        account_id = self._pick_account()
        if not account_id:
            return
        await self._post(
            scenario=scenario, monitor=mon, account_id=account_id, cfg=cfg,
            keyword=self._keyword_for(scenario), region=self._region_for(cfg),
            is_repost=True,
        )

    # ============ 工具 ============

    @staticmethod
    def _wash_hours(cfg) -> int:
        h = cfg.get("wash_hours")
        if h:
            return int(h)
        return int(cfg.get("wash_interval_days", 7) or 7) * 24

    @staticmethod
    def _pick_account() -> int:
        with Session(engine) as s:
            a = s.query(Account).filter_by(is_active=True).first()
            return a.id if a else None

    @staticmethod
    def _keyword_for(scenario) -> str:
        if scenario in ("evergreen", "city"):
            kws = ic.active_keywords()
            return random.choice(kws) if kws else ""
        return ""

    @staticmethod
    def _region_for(cfg) -> str:
        return cfg.get("region_hint") or ""


# 全局单例
action_engine = ActionEngine()