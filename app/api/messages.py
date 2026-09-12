# -*- coding: utf-8 -*-
"""消息中心 API — 私信会话管理（会话工作台）

扩展侧(Chrome)负责从小红书抓取会话/消息并上报、以及从出站队列拉取发送指令并真实发出。
后端负责存储、增量 diff(判断哪些会话有更新需点开)、意图分类(只打标不筛选)、状态建议、AI回复生成。

核心设计：
- 所有会话一律保留可见，AI 只做【标签】不筛选（intent 意图 + label 有效/待定/待复核）。
- 状态按【最后活跃时间】驱动：对方刚回→销售中；N天无互动→需跟进；达流失阈值→建议流失(人工确认)。
- 激活/流失天数可通过 /api/messages/settings 配置。

扩展上报：
- POST /api/messages/sync                        批量轻量上报会话列表 → 返回需要完整同步的 conv_id
- POST /api/messages/{conv_id}/messages          上报完整消息时间线
- POST /api/messages/outbox/{task_id}/done       发送结果回写
- GET  /api/messages/outbox                       拉取待发送私信任务
- GET  /api/messages/sync-request / POST /sync-ack   查询/确认"待同步"信号

Web 端：
- GET  /api/messages                       会话列表(状态/意图/时间激活/关键词/待确认 筛选)
- GET  /api/messages/{conv_id}             会话详情
- GET  /api/messages/{conv_id}/messages    完整消息时间线
- PUT  /api/messages/{conv_id}/status      改状态 / 确认建议状态
- POST /api/messages/{conv_id}/analyze     重跑意图+标签+建议状态
- POST /api/messages/{conv_id}/ai-reply    AI 生成回复建议
- POST /api/messages/{conv_id}/send        一键发送(入队待扩展发送)
- POST /api/messages/classify-pending      批量补标签
- GET/PUT /api/messages/settings           激活/流失机制参数
- POST /api/messages/request-sync          请求扩展同步(Web→扩展)
- 快捷话术 CRUD /api/messages/quick-replies
"""
import json
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.models import (
    Conversation, Message, IntentionTemplate, SendTask, Setting,
    MessageDirection, ConversationStatus, engine,
)
from app.core.ai_engine import ai_engine

router = APIRouter(tags=["消息中心"])

VALID_INTENTS = ["logistics", "product_detail", "suitability", "price_compare", "order", "chat", "other"]
VALID_STATUS = [s.value for s in ConversationStatus]
# 激活/流失机制默认参数（可直接在设置里改）
DEF_SETTINGS = {
    "msg_active_days": 3,      # 对方刚回话、且最后活跃在 N 天内 → 视为激活
    "msg_followup_days": 5,    # 对方 N 天无互动 → 建议"需跟进"
    "msg_lost_days": 10,       # 对方 N 天无互动 → 建议"流失"
    "msg_label_enable": "1",   # 是否启用 AI 标签（只打标不筛选）
}
# 意图→AI标签（只打标、不删除/不筛选；所有会话始终可见）
INTENT_LABEL_MAP = {
    "order": "有效商机", "price_compare": "有效商机",
    "product_detail": "有效商机", "suitability": "有效商机",
    "logistics": "待定", "chat": "待定", "other": "待定",
}


# ========== 设置读写 ==========

def _get_setting(session, key: str, default):
    if key not in DEF_SETTINGS and key != "msg_sync_request":
        return default
    row = session.query(Setting).filter(Setting.key == key).first()
    if row is None or row.value in (None, ""):
        return default
    return row.value


def _get_int(session, key: str, default: int) -> int:
    try:
        return int(_get_setting(session, key, default))
    except (TypeError, ValueError):
        return default


def _set_setting(session, key: str, value):
    if key not in DEF_SETTINGS and key != "msg_sync_request":
        return
    row = session.query(Setting).filter(Setting.key == key).first()
    if row is None:
        session.add(Setting(key=key, value=str(value)))
    else:
        row.value = str(value)


# ========== 请求模型 ==========

class SyncItem(BaseModel):
    conv_id: str
    partner_id: str = ""
    partner_name: str = ""
    avatar: str = ""
    source: str = ""
    note_title: str = ""
    note_url: str = ""
    last_msg: str = ""
    last_from: str = ""          # them / me
    last_at: str = ""
    unread_count: int = 0
    dm_count: int = 0
    last_dm_at: str = ""
    them_replied: bool = False
    direction: str = "outbound"
    ai_tag: str = ""
    fp: str = ""


class SyncRequest(BaseModel):
    product: str = ""
    items: list[SyncItem] = []


class MsgItem(BaseModel):
    xhs_msg_id: str = ""
    direction: str = "them"
    author: str = ""
    text: str = ""
    msg_at: str = ""
    ai_generated: bool = False


class MsgReport(BaseModel):
    product: str = ""
    messages: list[MsgItem] = []


class StatusRequest(BaseModel):
    status: str = ""
    source: str = "manual"
    reason: str = ""


class SendRequest(BaseModel):
    text: str = ""
    product: str = ""


class QuickReplyCreate(BaseModel):
    intent: str = "other"
    title: str = ""
    content: str = ""
    product: str = ""
    is_active: bool = True


class SettingsUpdate(BaseModel):
    msg_active_days: str = ""
    msg_followup_days: str = ""
    msg_lost_days: str = ""


# ========== 工具 ==========

def _parse_dt(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        if v > 10_000_000_000:
            v /= 1000
        return datetime.fromtimestamp(v)
    if isinstance(value, datetime):
        return value
    s = str(value).strip()
    if not s:
        return None
    s = re.sub(r"(Z|[+-]\d{2}:\d{2})$", "", s)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _speaker_zh(v: str) -> str:
    return {"them": "对方", "me": "我"}.get(v, v)


def _int_or_zero(v):
    try:
        return int(v)
    except (ValueError, TypeError):
        return -1


def _conv_dict(c: Conversation) -> dict:
    now = datetime.now()
    inactive_days = None
    if c.last_at:
        inactive_days = max(0, (now - c.last_at).days)

    def _bucket():
        if not c.last_at:
            return "older"
        if inactive_days == 0:
            return "today"
        if inactive_days <= 3:
            return "3d"
        if inactive_days <= 7:
            return "week"
        return "older"

    return {
        "id": c.id,
        "product": c.product,
        "conv_id": c.conv_id,
        "partner_id": c.partner_id,
        "partner_name": c.partner_name,
        "avatar": c.avatar,
        "source": c.source,
        "note_title": c.note_title,
        "note_url": c.note_url,
        "status": c.status.value if c.status else ConversationStatus.CHUNTING.value,
        "status_source": c.status_source or "manual",
        "suggested_status": c.suggested_status.value if c.suggested_status else None,
        "suggested_reason": c.suggested_reason or "",
        "has_pending_suggestion": bool(c.suggested_status and (not c.status or c.suggested_status != c.status)),
        "intent": c.intent or "other",
        "intent_confidence": c.intent_confidence or 0,
        "intent_reason": c.intent_reason or "",
        "intent_at": c.intent_at.isoformat() if c.intent_at else None,
        "label": c.label or "",
        "last_msg": c.last_msg or "",
        "last_from": _speaker_zh(c.last_from),
        "last_at": c.last_at.isoformat() if c.last_at else None,
        "inactive_days": inactive_days,
        "active_bucket": _bucket(),
        "unread_count": c.unread_count or 0,
        "dm_count": c.dm_count or 0,
        "last_dm_at": c.last_dm_at.isoformat() if c.last_dm_at else None,
        "them_replied": c.them_replied,
        "direction": c.direction or "outbound",
        "ai_tag": c.ai_tag or "",
        "lost_at": c.lost_at.isoformat() if c.lost_at else None,
        "sync_at": c.sync_at.isoformat() if c.sync_at else None,
        "full_synced_at": c.full_synced_at.isoformat() if c.full_synced_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def c_has_them_msgs(conv: Conversation) -> bool:
    if conv.messages is None:
        return False
    return any(m.direction == MessageDirection.THEM for m in conv.messages)


def _extract_json(text) -> dict:
    if not text:
        return {}
    try:
        return json.loads(text.strip().strip("`").lstrip("json"))
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return {}


def _classify(session: Session, conv: Conversation) -> None:
    """意图分类 + AI 标签。只打标、不筛选——所有会话始终保留可见。"""
    if not c_has_them_msgs(conv):
        return
    theirs = "\n".join(m.text for m in conv.messages if m.direction == MessageDirection.THEM and m.text)[-1500:]
    if not theirs:
        return
    try:
        raw = ai_engine.chat("", "intent_classify", {"their_recent": theirs})
        data = _extract_json(raw) or {}
        intent = (data.get("intent") or "other").strip()
        if intent not in VALID_INTENTS:
            intent = "other"
        conv.intent = intent
        try:
            conf = float(data.get("confidence", 0))
        except (TypeError, ValueError):
            conf = 0
        conv.intent_confidence = conf
        conv.intent_reason = str(data.get("rationale") or "")
        conv.intent_at = datetime.now()
        if _get_setting(session, "msg_label_enable", DEF_SETTINGS["msg_label_enable"]) in ("1", "true", "True"):
            base = INTENT_LABEL_MAP.get(intent, "待定")
            conv.label = "待复核" if (base != "待定" and conf < 0.5) else base
            conv.label_at = datetime.now()
    except Exception:
        pass


def _apply_loss(conv: Conversation) -> None:
    cur = conv.status.value if conv.status else None
    if cur == "lost" and not conv.lost_at:
        conv.lost_at = datetime.now()
    # 复活：对方又回话了，清除流失标记
    if conv.them_replied or (conv.last_from in ("them", "对方")):
        conv.lost_at = None


def _suggest_status(session: Session, c: Conversation) -> None:
    """按最后活跃时间驱动状态建议 + 流失机制。只给建议，人工一键确认。"""
    now = datetime.now()
    cur = c.status.value if c.status else ConversationStatus.CHUNTING.value
    if cur in ("won", "completed", "lost"):
        c.suggested_status = None
        c.suggested_reason = ""
        return

    active_days = _get_int(session, "msg_active_days", DEF_SETTINGS["msg_active_days"])
    followup_days = _get_int(session, "msg_followup_days", DEF_SETTINGS["msg_followup_days"])
    lost_days = _get_int(session, "msg_lost_days", DEF_SETTINGS["msg_lost_days"])

    if not c.last_at:
        c.suggested_status = None
        c.suggested_reason = ""
        return

    inactive = max(0, (now - c.last_at).days)
    them_just_replied = c.them_replied and (c.last_from in ("them", "对方"))

    # 对方刚回(激活窗口) → 进入销售中
    if them_just_replied and inactive <= active_days:
        c.suggested_status = ConversationStatus.SELLING
        c.suggested_reason = f"对方刚回话({inactive}天内)，进入销售跟进"
        c.status_source = "ai"
        return

    # 流失机制：达到流失阈值且未在销售中
    if inactive >= lost_days and cur != "selling":
        c.suggested_status = ConversationStatus.LOST
        c.suggested_reason = f"已有 {inactive} 天无互动(≥{lost_days}天)，标记流失"
        c.status_source = "rule"
        return

    # 需跟进
    if inactive >= followup_days and cur in ("chunting", "selling", ""):
        c.suggested_status = ConversationStatus.FOLLOWUP
        c.suggested_reason = f"已有 {inactive} 天无推进(≥{followup_days}天)，建议触达一次"
        c.status_source = "rule"
        return

    c.suggested_status = None
    c.suggested_reason = ""


def _find_conv(session: Session, product: str, conv_id: str):
    q = session.query(Conversation)
    if product:
        q = q.filter(Conversation.product == product, Conversation.conv_id == conv_id)
    else:
        q = q.filter(Conversation.conv_id == conv_id)
    return q.first()


# ========== 扩展上报 ==========

@router.post("/sync")
async def sync_conversations(req: SyncRequest):
    with Session(engine) as session:
        need_full = []
        created = 0
        updated = 0
        for item in req.items:
            if not item.conv_id:
                continue
            conv = _find_conv(session, req.product, item.conv_id)
            last_at = _parse_dt(item.last_at)
            if conv is None:
                conv = Conversation(
                    product=req.product or "", conv_id=item.conv_id,
                    partner_id=item.partner_id or "", partner_name=item.partner_name or "",
                    avatar=item.avatar or "", source=item.source or "",
                    note_title=item.note_title or "", note_url=item.note_url or "",
                    last_msg=item.last_msg or "", last_from=item.last_from or "",
                    last_at=last_at, unread_count=item.unread_count or 0,
                    dm_count=item.dm_count or 0, last_dm_at=_parse_dt(item.last_dm_at),
                    them_replied=item.them_replied or (item.last_from == "them"),
                    direction=item.direction or "outbound", ai_tag=item.ai_tag or "",
                    fp=item.fp or "", sync_at=datetime.now(),
                )
                session.add(conv)
                created += 1
                need_full.append(item.conv_id)
                session.flush()
            else:
                changed = (
                    (item.last_msg or "") != (conv.last_msg or "")
                    or last_at != conv.last_at
                    or (item.unread_count or 0) != (conv.unread_count or 0)
                    or (bool(item.last_from) and item.last_from != (conv.last_from or ""))
                )
                if changed:
                    conv.last_msg = item.last_msg or conv.last_msg
                    if item.last_from:
                        conv.last_from = item.last_from
                    conv.last_at = last_at or conv.last_at
                    conv.unread_count = item.unread_count or 0
                    if item.partner_name:
                        conv.partner_name = item.partner_name
                    if item.avatar:
                        conv.avatar = item.avatar
                    conv.them_replied = item.them_replied or (conv.them_replied or item.last_from == "them")
                    conv.dm_count = item.dm_count or conv.dm_count
                    conv.last_dm_at = _parse_dt(item.last_dm_at) or conv.last_dm_at
                    conv.fp = item.fp or conv.fp
                    updated += 1
                    need_full.append(item.conv_id)

            conv.sync_at = datetime.now()
            _apply_loss(conv)
            _suggest_status(session, conv)
        session.commit()
    return {"ok": True, "created": created, "updated": updated, "need_full": need_full}


@router.post("/{conv_id}/messages")
async def report_messages(conv_id: str, req: MsgReport):
    added = 0
    new_them = False
    with Session(engine) as session:
        conv = _find_conv(session, req.product, conv_id)
        if conv is None:
            conv = Conversation(product=req.product or "", conv_id=conv_id, sync_at=datetime.now())
            session.add(conv)
            session.flush()

        seen = set(m.xhs_msg_id for m in conv.messages if m.xhs_msg_id)
        for m in req.messages:
            if m.xhs_msg_id and m.xhs_msg_id in seen:
                continue
            if m.xhs_msg_id:
                seen.add(m.xhs_msg_id)
            direction = MessageDirection.THEM if m.direction == "them" else MessageDirection.ME
            session.add(Message(
                conversation_id=conv.id, xhs_msg_id=m.xhs_msg_id or "",
                direction=direction, author=m.author or (conv.partner_name or ""),
                text=m.text or "", msg_at=_parse_dt(m.msg_at), ai_generated=m.ai_generated,
            ))
            added += 1
            if direction == MessageDirection.THEM:
                new_them = True

        if req.messages:
            ms = sorted(req.messages, key=lambda x: _parse_dt(x.msg_at) or datetime.min)
            last = ms[-1]
            conv.last_msg = last.text or conv.last_msg
            conv.last_from = last.direction or conv.last_from
            if last.msg_at:
                conv.last_at = _parse_dt(last.msg_at) or conv.last_at
            if last.direction == "them":
                conv.them_replied = True

        conv.full_synced_at = datetime.now()
        conv.sync_at = datetime.now()
        _apply_loss(conv)
        session.commit()
        session.refresh(conv)

        if new_them:
            _classify(session, conv)
            _suggest_status(session, conv)
            _apply_loss(conv)
            session.commit()
    return {"ok": True, "added": added, "new_them": new_them}


@router.post("/{conv_id}/mark-sent")
async def mark_sent(conv_id: str, req: MsgItem):
    with Session(engine) as session:
        conv = _find_conv(session, req.product, conv_id)
        if conv is None:
            raise HTTPException(404, "会话不存在")
        session.add(Message(
            conversation_id=conv.id, xhs_msg_id=req.xhs_msg_id or "",
            direction=MessageDirection.ME, author="我", text=req.text or "",
            msg_at=datetime.now(), ai_generated=req.ai_generated, sent_at=datetime.now(),
        ))
        conv.last_msg = req.text or conv.last_msg
        conv.last_from = "me"
        conv.last_at = datetime.now()
        conv.dm_count = (conv.dm_count or 0) + 1
        conv.last_dm_at = datetime.now()
        session.commit()
    return {"ok": True}


# ========== 出站发送任务(扩展拉取) ==========

@router.get("/outbox")
async def outbox_pending(limit: int = Query(10, ge=1, le=50)):
    with Session(engine) as session:
        tasks = session.query(SendTask).filter(
            SendTask.status == "pending",
        ).order_by(SendTask.id.asc()).limit(limit).all()
        now = datetime.now()
        for t in tasks:
            t.picked_at = now
        conv_ids = {}
        for t in tasks:
            conv = session.query(Conversation).get(t.conversation_id)
            conv_ids[t.id] = conv.conv_id if conv else None
        session.commit()
        return {
            "ok": True,
            "tasks": [{
                "id": t.id, "conversation_id": t.conversation_id,
                "conv_id": conv_ids.get(t.id), "partner_id": t.partner_id, "text": t.text,
            } for t in tasks],
        }


@router.post("/outbox/{task_id}/done")
async def outbox_done(task_id: int, req: dict = None):
    req = req or {}
    success = bool(req.get("success", True))
    with Session(engine) as session:
        t = session.query(SendTask).get(task_id)
        if not t:
            raise HTTPException(404, "任务不存在")
        t.status = "sent" if success else "failed"
        t.sent_at = datetime.now()
        t.error_msg = req.get("error", "")
        conv = session.query(Conversation).get(t.conversation_id)
        if conv and success:
            session.add(Message(
                conversation_id=conv.id, direction=MessageDirection.ME, author="我",
                text=t.text or "", msg_at=datetime.now(), ai_generated=True, sent_at=datetime.now(),
            ))
            conv.last_msg = t.text or conv.last_msg
            conv.last_from = "me"
            conv.last_at = datetime.now()
            conv.dm_count = (conv.dm_count or 0) + 1
            conv.last_dm_at = datetime.now()
        session.commit()
    return {"ok": True}


# ========== 同步信号(Web 请求 → 扩展执行) ==========

@router.post("/request-sync")
async def request_sync():
    with Session(engine) as session:
        _set_setting(session, "msg_sync_request", datetime.now().isoformat())
        session.commit()
    return {"ok": True}


@router.post("/sync-ack")
async def sync_ack():
    with Session(engine) as session:
        _set_setting(session, "msg_sync_request", "0")
        session.commit()
    return {"ok": True}


@router.get("/sync-request")
async def sync_request():
    with Session(engine) as session:
        v = _get_setting(session, "msg_sync_request", "0")
        pending = str(v) not in ("0", "", "None", None)
    return {"pending": pending, "ts": v if pending else None}


# ========== 激活/流失机制参数 ==========

@router.get("/settings")
async def get_settings():
    with Session(engine) as session:
        data = {}
        for k, default in DEF_SETTINGS.items():
            data[k] = _get_setting(session, k, default)
        data["intent_labels"] = INTENT_LABEL_MAP
    return data


@router.put("/settings")
async def update_settings(req: SettingsUpdate):
    with Session(engine) as session:
        for k in ("msg_active_days", "msg_followup_days", "msg_lost_days"):
            v = getattr(req, k, "")
            if str(v).strip() != "":
                _set_setting(session, k, str(v).strip())
        session.commit()
    return await get_settings()


# ========== 意图快捷话术（须在 /{conv_id} 动态段之前注册，避免被吞） ==========

@router.get("/quick-replies")
async def list_quick_replies(intent: str = "", product: str = ""):
    with Session(engine) as session:
        q = session.query(IntentionTemplate).filter(IntentionTemplate.is_active == True)
        if intent:
            q = q.filter(IntentionTemplate.intent == intent)
        if product:
            q = q.filter(IntentionTemplate.product.in_(["", product]))
        rows = q.order_by(IntentionTemplate.id.asc()).all()
        return [{
            "id": r.id, "intent": r.intent or "other", "title": r.title or "",
            "content": r.content or "", "product": r.product or "", "is_active": r.is_active,
        } for r in rows]


@router.post("/quick-replies")
async def create_quick_reply(req: QuickReplyCreate):
    if (req.intent or "other") not in VALID_INTENTS:
        raise HTTPException(400, "意图不合法")
    with Session(engine) as session:
        row = IntentionTemplate(intent=req.intent, title=req.title, content=req.content,
                                product=req.product or "", is_active=req.is_active)
        session.add(row)
        session.commit()
        session.refresh(row)
        return {"ok": True, "id": row.id}


@router.put("/quick-replies/{tid}")
async def update_quick_reply(tid: int, req: QuickReplyCreate):
    with Session(engine) as session:
        row = session.query(IntentionTemplate).get(tid)
        if not row:
            raise HTTPException(404, "模板不存在")
        row.intent = req.intent
        row.title = req.title
        row.content = req.content
        row.product = req.product or row.product
        row.is_active = req.is_active
        session.commit()
        return {"ok": True}


@router.delete("/quick-replies/{tid}")
async def delete_quick_reply(tid: int):
    with Session(engine) as session:
        row = session.query(IntentionTemplate).get(tid)
        if not row:
            raise HTTPException(404, "模板不存在")
        session.delete(row)
        session.commit()
    return {"ok": True}


# ========== Web: 会话列表 & 详情 ==========

@router.get("")
async def list_conversations(
    status: str = Query("", description="按销售状态过滤"),
    intent: str = Query("", description="按意图过滤"),
    label: str = Query("", description="按AI标签过滤(仅打标不筛选，可过滤查看)"),
    recency: str = Query("", description="按时间/激活过滤: today/3d/week/older"),
    keyword: str = Query("", description="按昵称/消息搜索"),
    pending_confirmation: bool = Query(False),
    product: str = Query("", description="按产品过滤"),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    with Session(engine) as session:
        q = session.query(Conversation)
        if status and status in VALID_STATUS:
            q = q.filter(Conversation.status == status)
        if intent and intent in VALID_INTENTS:
            q = q.filter(Conversation.intent == intent)
        if label:
            q = q.filter(Conversation.label == label)
        if product:
            q = q.filter(Conversation.product == product)
        if pending_confirmation:
            q = q.filter(Conversation.suggested_status.isnot(None))
        if keyword:
            kw = f"%{keyword.strip()}%"
            q = q.filter(
                (Conversation.partner_name.like(kw)) | (Conversation.last_msg.like(kw)) | (Conversation.conv_id.like(kw))
            )
        # 激活/时间过滤
        if recency:
            rows = q.all()
            now = datetime.now()
            def in_bucket(c):
                if not c.last_at:
                    return recency == "older"
                d = (now - c.last_at).days
                if recency == "today":
                    return d == 0
                if recency == "3d":
                    return 0 <= d <= 3
                if recency == "week":
                    return 0 <= d <= 7
                if recency == "older":
                    return d > 7 if c.last_at else True
                return True
            rows = [r for r in rows if in_bucket(r)]
            total = len(rows)
            rows = rows[offset:offset + limit]
        else:
            total = q.count()
            rows = q.order_by(
                Conversation.suggested_status.isnot(None).desc(),
                Conversation.last_at.desc(),
            ).offset(offset).limit(limit).all()
        return {"total": total, "items": [_conv_dict(r) for r in rows]}


@router.get("/{conv_id}")
async def get_conversation(conv_id: str):
    with Session(engine) as session:
        conv = session.query(Conversation).filter(
            (Conversation.conv_id == conv_id) | (Conversation.id == _int_or_zero(conv_id))
        ).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        return _conv_dict(conv)


@router.get("/{conv_id}/messages")
async def get_messages(conv_id: str):
    with Session(engine) as session:
        conv = session.query(Conversation).filter(
            (Conversation.conv_id == conv_id) | (Conversation.id == _int_or_zero(conv_id))
        ).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        msgs = session.query(Message).filter(
            Message.conversation_id == conv.id
        ).order_by(Message.id.asc()).all()
        return [{
            "id": m.id, "direction": m.direction.value if m.direction else "them",
            "author": m.author or "", "text": m.text or "",
            "msg_at": m.msg_at.isoformat() if m.msg_at else None,
            "received_at": m.received_at.isoformat() if m.received_at else None,
            "ai_generated": m.ai_generated,
        } for m in msgs]


# ========== Web: 状态 / 意图 / 回复 / 发送 ==========

@router.put("/{conv_id}/status")
async def set_status(conv_id: str, req: StatusRequest):
    status = (req.status or "").lower()
    if status not in VALID_STATUS:
        raise HTTPException(400, f"状态只能是 {'/'.join(VALID_STATUS)}")
    with Session(engine) as session:
        conv = session.query(Conversation).filter(Conversation.conv_id == conv_id).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        conv.status = status
        conv.status_source = req.source or "manual"
        if conv.suggested_status and conv.suggested_status.value == status:
            conv.suggested_status = None
            conv.suggested_reason = ""
        elif status in ("won", "completed", "lost"):
            conv.suggested_status = None
            conv.suggested_reason = ""
        _apply_loss(conv)
        session.commit()
        session.refresh(conv)
        return _conv_dict(conv)


@router.put("/{conv_id}/suggested")
async def confirm_status(conv_id: str):
    with Session(engine) as session:
        conv = session.query(Conversation).filter(Conversation.conv_id == conv_id).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        if not conv.suggested_status:
            raise HTTPException(400, "该会话没有待确认的建议状态")
        conv.status = conv.suggested_status
        conv.status_source = conv.status_source or "ai"
        conv.suggested_status = None
        conv.suggested_reason = ""
        _apply_loss(conv)
        session.commit()
        session.refresh(conv)
        return _conv_dict(conv)


@router.post("/{conv_id}/analyze")
async def analyze(conv_id: str):
    with Session(engine) as session:
        conv = session.query(Conversation).filter(
            (Conversation.conv_id == conv_id) | (Conversation.id == _int_or_zero(conv_id))
        ).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        _classify(session, conv)
        _suggest_status(session, conv)
        _apply_loss(conv)
        session.commit()
        session.refresh(conv)
        return _conv_dict(conv)


@router.post("/classify-pending")
async def classify_pending(limit: int = Query(50, ge=1, le=300)):
    done = 0
    with Session(engine) as session:
        rows = session.query(Conversation).filter(
            Conversation.intent.in_(["other", ""]) | Conversation.intent.is_(None),
        ).order_by(Conversation.last_at.desc()).limit(limit).all()
        for conv in rows:
            _classify(session, conv)
            _suggest_status(session, conv)
            done += 1
        session.commit()
    return {"ok": True, "processed": done}


@router.post("/{conv_id}/ai-reply")
async def ai_reply(conv_id: str, req: SendRequest = None):
    req = req or SendRequest()
    with Session(engine) as session:
        conv = session.query(Conversation).filter(
            (Conversation.conv_id == conv_id) | (Conversation.id == _int_or_zero(conv_id))
        ).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        msgs = session.query(Message).filter(Message.conversation_id == conv.id).order_by(Message.id.asc()).limit(30).all()
        history = "\n".join(
            (("我" if m.direction == MessageDirection.ME else (m.author or "对方")) + "：" + (m.text or ""))
            for m in msgs[::-1]
        )[:2000]
        theirs = "\n".join(m.text for m in msgs if m.direction == MessageDirection.THEM)[-1000:]
        try:
            reply = ai_engine.chat("", "dm_reply", {
                "intent": conv.intent or "other",
                "their_recent": theirs or (conv.last_msg or ""),
                "conversation_history": history,
            })
        except Exception as e:
            raise HTTPException(500, f"AI 生成失败: {e}")
        return {"conv_id": conv_id, "intent": conv.intent or "other", "reply": (reply or "").strip()}


@router.post("/{conv_id}/send")
async def send_message(conv_id: str, req: SendRequest = None):
    req = req or SendRequest()
    with Session(engine) as session:
        conv = session.query(Conversation).filter(
            (Conversation.conv_id == conv_id) | (Conversation.id == _int_or_zero(conv_id))
        ).first()
        if not conv:
            raise HTTPException(404, "会话不存在")
        text = (req.text or "").strip()
        if not text:
            msgs = session.query(Message).filter(Message.conversation_id == conv.id).order_by(Message.id.asc()).limit(30).all()
            theirs = "\n".join(m.text for m in msgs if m.direction == MessageDirection.THEM)[-1500:]
            reply = ai_engine.chat("", "dm_reply", {
                "intent": conv.intent or "other",
                "their_recent": theirs or (conv.last_msg or ""),
                "conversation_history": "".join((("我" if m.direction == MessageDirection.ME else "对方") + (m.text or "")) for m in msgs[::-1])[:2000],
            })
            text = (reply or "").strip()
        if not text:
            raise HTTPException(400, "待发送内容为空")
        task = SendTask(conversation_id=conv.id, partner_id=conv.partner_id or "", text=text, status="pending")
        session.add(task)
        session.add(Message(
            conversation_id=conv.id, direction=MessageDirection.ME, author="我",
            text=text, msg_at=datetime.now(), ai_generated=True,
        ))
        session.commit()
        session.refresh(task)
        return {"ok": True, "task_id": task.id, "text": text, "status": task.status}