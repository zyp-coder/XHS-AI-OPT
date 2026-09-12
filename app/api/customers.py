# -*- coding: utf-8 -*-
"""客户邮箱接口 — AI客服检测到用户留邮箱后，扩展上报 / 查询 / 打包 / 通知

客户端IF:
- POST   /api/customers/report        扩展上报一个「已留邮箱的客户」（按 email+nickname 去重，已存在则更新）
- GET    /api/customers               查询客户列表（可按 pack_status / notify_status / 关键词过滤）
- GET    /api/customers/{id}          单个客户详情
- PUT    /api/customers/{id}/mark-pack    标记打包（pack_status / pack_batch）
- PUT    /api/customers/{id}/mark-notify  标记通知（notify_status）
- POST   /api/customers/batch-mark    批量标记打包/通知（body: { ids: [...], action: "pack"|"notify", batch? }）

后续「打包资料发给客户 + 通知客户」可直接基于这些客户记录/状态来做。
"""
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.models import CustomerLead, engine

router = APIRouter(tags=["客户邮箱"])

VALID_PACK = {"pending", "packed"}
VALID_NOTIFY = {"pending", "notified"}


class ReportLeadRequest(BaseModel):
    email: str
    xhs_user_id: str = ""
    nickname: str = ""
    text: str = ""
    scene: str = "chat_follow"
    product: str = ""
    note_title: str = ""
    note_url: str = ""


class MarkRequest(BaseModel):
    status: str = ""
    batch: str = ""


class BatchMarkRequest(BaseModel):
    ids: list[int] = []
    action: str = ""          # "pack" | "notify"
    status: str = ""          # 目标状态，如 "packed"/"notified"；留空用默认
    pack_batch: str = ""


EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


def _normalize_email(raw: str) -> str:
    m = EMAIL_RE.search((raw or "").strip())
    return m.group(0).lower() if m else (raw or "").strip().lower()


def _lead_dict(l: CustomerLead) -> dict:
    return {
        "id": l.id,
        "xhs_user_id": l.xhs_user_id,
        "nickname": l.nickname,
        "email": l.email,
        "email_source_text": l.email_source_text,
        "detected_scene": l.detected_scene,
        "product": l.product,
        "note_title": l.note_title,
        "note_url": l.note_url,
        "pack_status": l.pack_status,
        "pack_batch": l.pack_batch,
        "pack_at": l.pack_at.isoformat() if l.pack_at else None,
        "notify_status": l.notify_status,
        "notify_at": l.notify_at.isoformat() if l.notify_at else None,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "updated_at": l.updated_at.isoformat() if l.updated_at else None,
    }


# ========== 扩展上报 ==========

@router.post("/report")
async def report_lead(req: ReportLeadRequest):
    email = _normalize_email(req.email)
    if not email:
        raise HTTPException(400, "未检测到有效邮箱")

    with Session(engine) as session:
        # 去重：同一邮箱（且尽量认到同一个人）→ 更新，否则新增
        lead = None
        if req.xhs_user_id:
            lead = session.query(CustomerLead).filter(
                CustomerLead.xhs_user_id == req.xhs_user_id,
                CustomerLead.email == email,
            ).first()
        if not lead:
            lead = session.query(CustomerLead).filter(CustomerLead.email == email).first()

        created = lead is None
        if created:
            lead = CustomerLead(
                email=email,
                xhs_user_id=req.xhs_user_id or "",
                nickname=req.nickname or "",
                email_source_text=(req.text or "")[:500],
                detected_scene=req.scene or "chat_follow",
                product=req.product or "",
                note_title=req.note_title or "",
                note_url=req.note_url or "",
            )
            session.add(lead)
        else:
            # 补全缺失信息，不覆盖已有状态
            if req.nickname and not lead.nickname:
                lead.nickname = req.nickname
            if req.product and not lead.product:
                lead.product = req.product
            if not lead.email_source_text and req.text:
                lead.email_source_text = (req.text or "")[:500]
            lead.nickname = lead.nickname or (req.nickname or "")
        session.commit()
        session.refresh(lead)
        return {"ok": True, "created": created, "lead": _lead_dict(lead)}


# ========== 查询 ==========

@router.get("")
async def list_leads(
    pack_status: str = Query("", description="按打包状态过滤: pending/packed"),
    notify_status: str = Query("", description="按通知状态过滤: pending/notified"),
    keyword: str = Query("", description="按昵称/邮箱模糊搜索"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    with Session(engine) as session:
        q = session.query(CustomerLead)
        if pack_status in VALID_PACK:
            q = q.filter(CustomerLead.pack_status == pack_status)
        if notify_status in VALID_NOTIFY:
            q = q.filter(CustomerLead.notify_status == notify_status)
        if keyword:
            kw = f"%{keyword.strip()}%"
            q = q.filter(
                (CustomerLead.nickname.like(kw)) | (CustomerLead.email.like(kw))
            )
        total = q.count()
        rows = q.order_by(CustomerLead.id.desc()).offset(offset).limit(limit).all()
        return {"total": total, "items": [_lead_dict(r) for r in rows]}


@router.get("/{lead_id}")
async def get_lead(lead_id: int):
    with Session(engine) as session:
        lead = session.query(CustomerLead).get(lead_id)
        if not lead:
            raise HTTPException(404, "客户不存在")
        return _lead_dict(lead)


# ========== 打包 / 通知标记 ==========

@router.put("/{lead_id}/mark-pack")
async def mark_pack(lead_id: int, req: MarkRequest):
    with Session(engine) as session:
        lead = session.query(CustomerLead).get(lead_id)
        if not lead:
            raise HTTPException(404, "客户不存在")
        status = (req.status or "packed").lower()
        if status not in VALID_PACK:
            raise HTTPException(400, "打包状态只能是 pending / packed")
        lead.pack_status = status
        if status == "packed":
            lead.pack_at = datetime.now()
            if req.batch:
                lead.pack_batch = req.batch
        else:
            lead.pack_at = None
        session.commit()
        session.refresh(lead)
        return {"ok": True, "lead": _lead_dict(lead)}


@router.put("/{lead_id}/mark-notify")
async def mark_notify(lead_id: int, req: MarkRequest):
    with Session(engine) as session:
        lead = session.query(CustomerLead).get(lead_id)
        if not lead:
            raise HTTPException(404, "客户不存在")
        status = (req.status or "notified").lower()
        if status not in VALID_NOTIFY:
            raise HTTPException(400, "通知状态只能是 pending / notified")
        lead.notify_status = status
        lead.notify_at = datetime.now() if status == "notified" else None
        session.commit()
        session.refresh(lead)
        return {"ok": True, "lead": _lead_dict(lead)}


@router.post("/batch-mark")
async def batch_mark(req: BatchMarkRequest):
    if not req.ids:
        raise HTTPException(400, "请提供要操作的用户 id 列表")
    action = (req.action or "").lower()
    if action not in ("pack", "notify"):
        raise HTTPException(400, "action 只能是 pack / notify")
    now = datetime.now()
    with Session(engine) as session:
        rows = session.query(CustomerLead).filter(CustomerLead.id.in_(req.ids)).all()
        for lead in rows:
            if action == "pack":
                lead.pack_status = req.status or "packed"
                lead.pack_at = now
                if req.pack_batch:
                    lead.pack_batch = req.pack_batch
            else:
                lead.notify_status = req.status or "notified"
                lead.notify_at = now
        session.commit()
    return {"ok": True, "done": len(rows), "action": action}