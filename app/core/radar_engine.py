"""DataRadar·监控引擎：六来源发现 → 入列监控列表 → 两级采集 → 爬坡判定 → 退出。

纯后端，由 Scheduler 周期调用 run_once()。浏览器能力从 app.core.browser 注入。
命中事件通过传入的 action_cb 触发 ActionEngine 干预。
"""
import asyncio
import random
from datetime import datetime, timedelta
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.models.models import (
    engine, NoteMonitor, MonitorState, ExitReason, RadarSnapshot,
)
from app.core.browser import browser_engine
from app.core import intercept_common as ic


SRCH = "https://www.xiaohongshu.com/search_result?keyword={}"


def safe_print(*a, **k):
    try:
        print(*a, **k)
    except UnicodeError:
        pass


def _id_from_url(url: str) -> str:
    """从笔记 URL 提取 note_id 作为对账主键。"""
    import re
    m = re.search(r"/explore/([^/?#]+)", url or "")
    return m.group(1) if m else ""


class RadarEngine:
    def __init__(self, action_cb=None):
        self.action_cb = action_cb          # async (scenario, monitor_id) -> ()
        self._triggered = set()             # monitor_id 已触发过干预
        self._scan_meta = {}                # scenario -> {last_seen_top set}

    # ============ 对外主入口(被调度调用) ============

    async def run_once(self):
        enabled = ic.get_enabled_scenarios()
        for scenario in enabled:
            try:
                await self.scan_scenario(scenario, ic.get_scenario_config(scenario))
            except Exception as e:
                safe_print(f"[Radar] {scenario} 扫描异常: {e}")
            await asyncio.sleep(random.uniform(1, 3))
        await self.refresh_active_monitors()
        await self.sweep_exits()

    # ============ 一、六来源发现入列 ============

    async def scan_scenario(self, scenario, cfg):
        if scenario == "burst":
            await self._scan_by_keywords(scenario, cfg, mode="latest")
        elif scenario == "city":
            await self._scan_by_keywords(scenario, cfg, mode="latest")
        elif scenario == "pain":
            await self._scan_pain(cfg)
        elif scenario == "evergreen":
            await self._scan_evergreen(cfg)
        elif scenario == "topic":
            await self._scan_topic(cfg)
        elif scenario == "highv":
            await self._scan_highv(cfg)
        else:
            safe_print(f"[Radar] 未知场景 {scenario}")

    # ---- 进入监控池：带 note_id + 收集本轮 seen 集合 ----

    def _monitor_from_note(self, scenario, cfg, n):
        """把一条抓取结果入池；返回 (monitor, True/False是否本轮seen)。"""
        url = n.get("url") or ""
        if not url:
            return None, False
        nid = n.get("note_id") or _id_from_url(url)
        new = ic.add_monitor(
            scenario, None, nid, url, n.get("title"), n.get("author"), cfg,
        )
        if new:
            safe_print(f"[Radar][{scenario}] 新入列: {n.get('title','')[:24]}")
        return None, True

    async def _scan_by_keywords(self, scenario, cfg, mode="latest"):
        """burst/city：按关键词(或带城市词)扫列表，新笔记入列。"""
        keywords = ic.active_keywords()
        if not keywords:
            keywords = ["测试"] if scenario == "burst" else []
        limit = cfg.get("max_candidates", 20)
        for kw in keywords:
            notes = await browser_engine.list_metrics(SRCH.format(quote(kw)), max_results=limit)
            for n in notes:
                self._monitor_from_note(scenario, cfg, n)
            if not notes:
                break

    async def _scan_pain(self, cfg):
        limit = cfg.get("max_candidates", 20)
        intents = cfg.get("intent_keywords") or ["求推荐", "听劝", "怎么办", "求建议", "求助"]
        seen = set()
        for kw in intents:
            notes = await browser_engine.list_metrics(SRCH.format(quote(kw)), max_results=limit)
            for n in notes:
                if not (n.get("title") or ""):
                    continue
                if not any(k in n["title"] for k in intents):
                    continue
                nid = n.get("note_id") or _id_from_url(n.get("url", ""))
                seen.add(n.get("url", ""))
                ic.add_monitor("pain", None, nid, n.get("url"), n.get("title"),
                               n.get("author"), cfg)
        # 对账补齐：池里在想没被刷到的求助帖子，按标题搜回来刷新
        await self._reconcile("pain", cfg, seen)

    async def _scan_evergreen(self, cfg):
        """长尾常青：固定关键词 TopN 长期驻留 + 卡位更新。"""
        top_n = cfg.get("top_n", 20)
        seen = set()
        for kw in ic.active_keywords():
            notes = await browser_engine.list_metrics(SRCH.format(quote(kw)), max_results=max(top_n, 20))
            for n in notes[:top_n]:
                url = n.get("url", "")
                if not url:
                    continue
                seen.add(url)
                nid = n.get("note_id") or _id_from_url(url)
                mon = ic.find_monitor_by_url(url, "evergreen")
                if not mon:
                    ic.add_monitor(
                        "evergreen", None, nid, url, n.get("title"),
                        n.get("author"), cfg,
                    )
                else:
                    ic.update_monitor_fields(
                        mon.id, last_likes=n.get("likes", 0),
                        last_view_rank=n.get("rank", 0),
                        last_snapshot_at=datetime.now(),
                    )
        # 对账补齐：池里在、但本轮没被关键词搜索刷到的，用标题/ID搜回来刷新
        await self._reconcile("evergreen", cfg, seen)

    async def _scan_topic(self, cfg):
        """话题吃瓜：对候选点进拿评论，评论/点赞 情绪指数>阈值 才入列(长期)。"""
        limit = max(cfg.get("max_candidates", 20), 5)
        ratio = cfg.get("emotion_ratio", 1.0)
        seen = set()
        for kw in (ic.active_keywords() or ["测试"]):
            notes = await browser_engine.list_metrics(SRCH.format(quote(kw)), max_results=limit)
            for n in notes[:8]:
                pm = await browser_engine.point_metrics(n["url"])
                if pm.get("_blocked") or pm.get("likes", 0) < 0:
                    continue
                likes = pm.get("likes") or 0
                comments = pm.get("comments") or 0
                if likes <= 0:
                    continue
                seen.add(n["url"])
                r = comments / likes
                if r >= ratio:
                    nid = n.get("note_id") or _id_from_url(n["url"])
                    ic.add_monitor(
                        "topic", None, nid, n.get("url"), pm.get("title") or n.get("title"),
                        n.get("author"), cfg,
                    )
            break
        await self._reconcile("topic", cfg, seen)

    async def _scan_highv(self, cfg):
        """高V狙击：从白名单用户清单取最新笔记入列(长期)。"""
        for ta in ic.active_target_accounts():
            prof = ta.get("note_url")
            if not prof:
                continue
            latest = await browser_engine.latest_note_of_user(prof)
            if not latest:
                continue
            ic.add_monitor(
                "highv", None, "", latest.get("url"), latest.get("title"),
                ta.get("nickname") or latest.get("author"), cfg,
            )

    # ============ 二、两级采集 + 爬坡判定 ============

    async def refresh_active_monitors(self):
        """对监控中的笔记做快照，判爬坡，命中触发 Action 干预。"""
        monitors = ic.get_monitors(active_only=True)
        for mon in monitors:
            scenario = mon.scenario
            cfg = ic.get_scenario_config(scenario)
            try:
                await self._refresh_one(mon, cfg)
            except Exception as e:
                safe_print(f"[Radar] 刷新 {mon.id} 异常: {e}")
            await asyncio.sleep(random.uniform(0.5, 1.5))

    async def _refresh_one(self, mon, cfg):
        pm = await browser_engine.point_metrics(mon.note_url)
        if pm.get("_blocked") or pm.get("likes", 0) < 0:
            return
        prev_likes = mon.last_likes or 0
        likes = pm.get("likes") or 0
        delta = likes - prev_likes
        ratio = 0.0
        if likes > 0:
            ratio = (pm.get("comments") or 0) / likes
        ic.update_monitor_fields(
            mon.id, last_likes=likes, last_comments=pm.get("comments", 0),
            last_collects=pm.get("collects", 0), last_shares=pm.get("shares", 0),
            last_interaction_ratio=round(ratio, 3), last_snapshot_at=datetime.now(),
        )
        ic.add_snapshot(
            mon.id, "point_in", likes, pm.get("comments") or 0,
            pm.get("collects") or 0, pm.get("shares") or 0,
            mon.last_view_rank, max(0, delta),
        )
        now_climbed = False
        if scenario in ("burst", "city"):
            thr = cfg.get("climb_likes_delta", 50) or 0
            now_climbed = delta >= thr if thr else False
        elif scenario == "topic":
            now_climbed = ratio >= cfg.get("emotion_ratio", 1.0)
        elif scenario == "pain":
            # pain: 入列即意图确认，首快照后触发
            now_climbed = prev_likes == 0
        elif scenario == "highv":
            hot = await browser_engine.hot_comment_top(mon.note_url)
            now_climbed = bool(hot and hot.get("found"))

        # 连续无爬坡累计(判死)
        sync_no_climb = 0 if now_climbed else (mon.consecutive_no_climb or 0) + 1
        if mon.consecutive_no_climb != sync_no_climb:
            ic.update_monitor_fields(mon.id, consecutive_no_climb=sync_no_climb)

        if now_climbed and mon.id not in self._triggered:
            self._triggered.add(mon.id)
            ic.update_monitor_fields(mon.id, state=MonitorState.ACTIONED.value)
            if self.action_cb:
                try:
                    await self.action_cb(scenario, mon.id)
                except Exception as e:
                    safe_print(f"[Radar] 触发干预失败: {e}")

    # ============ 三、对账补齐(存续笔记轮转刷掉后搜回刷新) + 退出夹持 ============

    async def _reconcile(self, scenario, cfg, seen_now):
        """把笔记池存量 vs 本轮搜索结果对账。

        - 本轮被刷到的 → 存活，清空掉位计数。
        - 本轮没被刷到(搜索轮转把TA抖掉了) → 用标题/ID重新搜回来补回并刷新状态；
          只有真搜不回来了(已删/被下架) → 才累计掉位，留给退出判定。
        """
        for mon in ic.get_monitors(active_only=True):
            if mon.scenario != scenario:
                continue
            if mon.note_url in seen_now:
                if mon.consecutive_off_rank_weeks:
                    ic.update_monitor_fields(mon.id, consecutive_off_rank_weeks=0)
                continue
            alive = await self._backfill_note(mon)
            if alive:
                if mon.consecutive_off_rank_weeks:
                    ic.update_monitor_fields(mon.id, consecutive_off_rank_weeks=0)
            else:
                ic.update_monitor_fields(
                    mon.id, consecutive_off_rank_weeks=(mon.consecutive_off_rank_weeks or 0) + 1
                )

    async def _backfill_note(self, mon) -> bool:
        """把一份没被本轮刷到的笔记补回来。优先按 note_id 直算，退而求其次按标题重新搜索。

        Returns: 是否还在(True=存活并已刷新状态, False=真没了)。"""
        if not (mon.note_id or mon.title):
            return False
        try:
            # 1) 有 note_id：按 ID 直开顺笔记(最可靠，不依赖搜索轮转)
            if mon.note_id:
                url = f"https://www.xiaohongshu.com/explore/{mon.note_id}"
                pm = await browser_engine.point_metrics(url)
                if pm.get("_blocked") or pm.get("likes", 0) < 0:
                    return False
                self._apply_metrics(mon, pm, url)
                return True
            # 2) 退而求其次：按标题重新搜索，定位回这篇
            notes = await browser_engine.list_metrics(SRCH.format(quote(mon.title)), max_results=8)
            hit = next(
                (n for n in notes
                 if n.get("note_id") and n.get("note_id") == mon.note_id
                 or (n.get("url") == mon.note_url)),
                None,
            )
            if not hit:
                return False
            pm = await browser_engine.point_metrics(hit["url"])
            if pm.get("_blocked") or pm.get("likes", 0) < 0:
                return False
            self._apply_metrics(mon, pm, hit["url"])
            return True
        except Exception as e:
            safe_print(f"[Radar] 补回异常({mon.id}): {e}")
            return False

    def _apply_metrics(self, mon, pm, url):
        """回写一篇笔记的两级采集快照(不触发干预，仅刷新状态)。"""
        prev_likes = mon.last_likes or 0
        likes = pm.get("likes") or 0
        ratio = (pm.get("comments") or 0) / likes if likes > 0 else 0.0
        ic.update_monitor_fields(
            mon.id, last_likes=likes, last_comments=pm.get("comments", 0),
            last_collects=pm.get("collects", 0), last_shares=pm.get("shares", 0),
            last_interaction_ratio=round(ratio, 3), last_snapshot_at=datetime.now(),
        )
        ic.add_snapshot(
            mon.id, "point_in", likes, pm.get("comments") or 0,
            pm.get("collects") or 0, pm.get("shares") or 0,
            0, max(0, likes - prev_likes),
        )

    async def sweep_exits(self):
        for mon in ic.get_monitors(active_only=True):
            scenario = mon.scenario
            cfg = ic.get_scenario_config(scenario)
            if mon.expire_at and datetime.now() >= mon.expire_at:
                ic.exit_monitor(mon.id, ExitReason.TIME_EXPIRED.value, "监控期(24h)到期退出")
                continue
            if scenario in ("evergreen", "topic", "highv"):
                # 长期驻留：连续无爬坡判死
                strikes = cfg.get("no_climb_strikes", 4)
                if (mon.consecutive_no_climb or 0) >= strikes:
                    ic.exit_monitor(mon.id, ExitReason.NO_POTENTIAL.value, "连续N次无爬坡判死退出")
                    continue
                if scenario == "evergreen":
                    weeks = cfg.get("exit_wait_weeks", 2)
                    if weeks and (mon.consecutive_off_rank_weeks or 0) >= weeks:
                        ic.exit_monitor(mon.id, ExitReason.REPLACED.value, "连续被新TopN挤出黄金位, 抢救无效淘汰")
                        continue
            # 爆发/同城: 若在到期前已连续多次无爬坡 → 提前判死省资源
            elif scenario in ("burst", "city"):
                total_scans = max(1, mon.consecutive_no_climb or 0)
                if mon.consecutive_no_climb and mon.consecutive_no_climb >= cfg.get("no_climb_strikes", 3):
                    # 已消耗 70% 有效期以上才提前死，避免误杀早期
                    if mon.expire_at and datetime.now() >= (mon.expire_at - timedelta(hours=6)):
                        ic.exit_monitor(mon.id, ExitReason.NO_POTENTIAL.value, "接近到期仍无爬坡, 提前判死")


# 全局单例
radar_engine = RadarEngine()