"""全场景截流公共数据访问。

被 RadarEngine / ActionEngine / WashEngine 复用。只负责 DB 读写，不触浏览器。
"""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import (
    engine, ScenarioConfig, NoteMonitor, RadarSnapshot, ExitLog,
    DrainRecord, TargetKeyword, TargetAccount, WashStatus,
    ExitReason, MonitorState,
)


def get_scenario_config(scenario: str) -> dict:
    """读取某场景配置；表里没播种时用默认值兜底。"""
    with Session(engine) as session:
        row = session.query(ScenarioConfig).filter_by(scenario=scenario).first()
    if row:
        d = {c.name: getattr(row, c.name) for c in row.__table__.columns}
        if d.get("entry_ttl_hours") == -1:
            d["entry_ttl_hours"] = None
        return d
    from app.core.scenario_config import default_config_map
    d = dict(default_config_map().get(scenario) or {})
    if d.get("entry_ttl_hours") == -1:
        d["entry_ttl_hours"] = None
    return d


def get_scenario_configs() -> dict:
    """读取全部场景配置 {scenario: dict}。"""
    out = {}
    from app.core.scenario_config import scenario_order
    for s in scenario_order():
        out[s] = get_scenario_config(s)
    return out


def get_enabled_scenarios() -> list:
    """返回启用的场景列表。"""
    with Session(engine) as session:
        rows = session.query(ScenarioConfig).filter_by(enabled=True).all()
        names = {r.scenario for r in rows}
    from app.core.scenario_config import scenario_order
    return [s for s in scenario_order() if s in names]


def get_monitors(scenario: str = None, active_only: bool = True) -> list:
    """查询监控列表。"""
    with Session(engine) as session:
        q = session.query(NoteMonitor)
        if scenario:
            q = q.filter_by(scenario=scenario)
        if active_only:
            q = q.filter_by(is_active=True)
        return list(q.order_by(NoteMonitor.entry_at.desc()).limit(500).all())


def find_monitor_by_url(note_url: str, scenario: str = None) -> Optional[NoteMonitor]:
    with Session(engine) as session:
        q = session.query(NoteMonitor).filter_by(note_url=note_url)
        if scenario:
            q = q.filter_by(scenario=scenario)
        return q.first()


def add_monitor(scenario: str, account_id: Optional[int], note_id: str, note_url: str,
                title: str = "", author: str = "", cfg: dict = None) -> Optional[NoteMonitor]:
    """入列一条笔记到监控列表。已在列则不动。cfg 用于计算过期时间。"""
    if find_monitor_by_url(note_url, scenario):
        return None
    cfg = cfg or get_scenario_config(scenario)
    ttl = cfg.get("entry_ttl_hours")
    expire = (datetime.now() + timedelta(hours=ttl)) if ttl else None
    with Session(engine) as session:
        m = NoteMonitor(
            scenario=scenario, account_id=account_id, note_id=note_id,
            note_url=note_url, title=title or "", author=author or "",
            expire_at=expire, state=MonitorState.MONITORING.value, is_active=True,
        )
        session.add(m)
        session.commit()
        session.refresh(m)
        return m


def update_monitor_fields(mid: int, **fields):
    with Session(engine) as session:
        m = session.query(NoteMonitor).filter_by(id=mid).first()
        if not m:
            return
        for k, v in fields.items():
            setattr(m, k, v)
        session.commit()


def add_snapshot(mid: int, level: str, likes: int, comments: int, collects: int,
                 shares: int, view_rank: int, delta_likes: int):
    with Session(engine) as session:
        session.add(RadarSnapshot(
            monitor_id=mid, level=level, likes=likes, comments=comments,
            collects=collects, shares=shares, view_rank=view_rank,
            delta_likes=delta_likes,
        ))
        session.commit()


def exit_monitor(mid: int, reason: str, detail: str = ""):
    """退出监控：标记退出 + 写 ExitLog。"""
    with Session(engine) as session:
        m = session.query(NoteMonitor).filter_by(id=mid).first()
        if not m:
            return
        m.state = MonitorState.EXPIRED.value
        m.is_active = False
        m.exit_reason = reason
        m.exited_at = datetime.now()
        session.add(ExitLog(
            monitor_id=mid, scenario=m.scenario, exit_reason=reason,
            detail=(detail or "")[:1000], target_note_url=m.note_url,
        ))
        session.commit()


def active_keywords() -> list:
    with Session(engine) as session:
        rows = session.query(TargetKeyword).filter_by(is_active=True).all()
        return [r.keyword for r in rows]


def active_target_accounts() -> list:
    with Session(engine) as session:
        rows = session.query(TargetAccount).filter_by(is_active=True).all()
        return [{"id": r.id, "nickname": r.nickname, "note_url": r.note_url} for r in rows]


def due_wash_records(minutes_overdue: int = 15) -> list:
    """活水到期待审的评论记录。按时长计算 deadline，避免频繁轮询时反复命中。"""
    with Session(engine) as session:
        now = datetime.now()
        return list(session.query(DrainRecord).filter(
            DrainRecord.wash_status == WashStatus.PENDING.value,
            DrainRecord.wash_at.isnot(None),
            DrainRecord.wash_at <= now,
        ).order_by(DrainRecord.wash_at.asc()).limit(100).all())