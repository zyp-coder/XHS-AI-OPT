"""WashEngine·活水清洗引擎。

周期审查自己发的评论：判死(0赞0回复)→删+换话术重发；高V已爆→主动撤换钩子；
长尾掉位→删+重抢位；话题→不删只去重（去重在生成侧保证，这里只 KEPT）。
"""
import asyncio
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.models import engine, DrainRecord, WashStatus
from app.core.browser import browser_engine
from app.core.action_engine import action_engine
from app.core import intercept_common as ic


def safe_print(*a, **k):
    try:
        print(*a, **k)
    except UnicodeError:
        pass


class WashEngine:
    async def sweep(self):
        records = ic.due_wash_records()
        if not records:
            return
        safe_print(f"[Wash] 待审查 {len(records)} 条评论")
        for rec in records:
            try:
                await self._review_one(rec)
            except Exception as e:
                safe_print(f"[Wash] 审查 {rec.id} 异常: {e}")
            await asyncio.sleep(1)

    async def _review_one(self, rec: DrainRecord):
        scenario = rec.scenario or ""
        cfg = ic.get_scenario_config(scenario) if scenario else {}
        if not rec.target_note_url:
            self._finish(rec.id, WashStatus.KEPT.value, "keep", "无笔记链接, 保留")
            return

        await browser_engine.safe_go_to(rec.target_note_url)
        await browser_engine.human_pause(1, 2)
        status = await browser_engine.my_comment_status(rec.comment_text or "")
        likes = status.get("likes", 0)
        rank = status.get("rank", 0)

        # ---- 话题: 只保留, 不删 ----
        if scenario == "topic":
            self._finish(rec.id, WashStatus.KEPT.value, "keep", "话题不删评论, 只保证去重")
            return

        # ---- 高V: 已爆 → 主动撤换 ----
        if scenario == "highv":
            like_th = int(cfg.get("wash_likes_threshold", 50) or 50)
            rep_th = int(cfg.get("wash_replies_threshold", 10) or 10)
            exploded = likes >= like_th or (status.get("replies", 0) >= rep_th)
            if exploded:
                await self._remove_and_repost(rec, WashStatus.ACTIVE_REMOVED.value,
                                              "active_remove", "已爆, 主动撤换钩子")
                return
            if not status.get("found") or likes == 0:
                await self._remove_and_repost(rec, WashStatus.REPOSTED.value,
                                              "delete_repost", "高V死评论, 删后重发")
                return
            self._finish(rec.id, WashStatus.KEPT.value, "keep", f"高V评论存活(赞{likes})")
            return

        # ---- 爆发/同城/痛点/长尾: 死评论 → 删+重发 ----
        if not status.get("found") or likes == 0:
            await self._remove_and_repost(rec, WashStatus.REPOSTED.value,
                                          "delete_repost", "0赞0回复死评论, 删后重发")
            return
        self._finish(rec.id, WashStatus.KEPT.value, "keep", f"评论存活(赞{likes})")

    async def _remove_and_repost(self, rec: DrainRecord, wash_status: str,
                                 action: str, detail: str):
        # 尽力删除旧评论
        deleted = False
        try:
            await browser_engine.safe_go_to(rec.target_note_url)
            deleted = await browser_engine.delete_comment(rec.comment_text or "")
        except Exception as e:
            safe_print(f"[Wash] 删除评论失败: {e}")
        self._finish(rec.id, wash_status, action, detail + (f"[已删]" if deleted else "[未删]"))
        # 重发新话术
        if rec.monitor_id and action != "keep":
            try:
                await action_engine.repost(
                    rec.monitor_id, old_record_id=rec.id, scenario=rec.scenario)
            except Exception as e:
                safe_print(f"[Wash] 重发失败: {e}")

    def _finish(self, record_id: int, wash_status: str, action: str, detail: str):
        with Session(engine) as s:
            r = s.query(DrainRecord).filter_by(id=record_id).first()
            if not r:
                return
            cfg = ic.get_scenario_config(r.scenario or "")
            h = int(cfg.get("wash_hours") or 24) if cfg.get("wash_hours") else (int(cfg.get("wash_interval_days", 7) or 7) * 24)
            r.wash_status = wash_status
            r.wash_action = action
            r.washed_at = datetime.now()
            r.wash_at = datetime.now() + timedelta(hours=(h or 24))
            s.commit()
        safe_print(f"[Wash] 记录#{record_id} → {action}: {detail}")


# 全局单例
wash_engine = WashEngine()