"""笔记管理 API"""
import json
import re
from fastapi import APIRouter, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.models.models import engine, Note, NoteStatus, Material, KnowledgeBase
from app.schemas.schemas import (
    NoteCreate, NoteDraft, NoteResponse, MessageResponse, AINoteGenerate,
    AIProductNoteBatch,
)
from app.core.ai_engine import ai_engine
from app.core.browser import browser_engine
from config import UPLOAD_DIR

router = APIRouter()


@router.get("/", response_model=list[NoteResponse])
async def list_notes(status: str = None):
    """获取笔记列表"""
    with Session(engine) as session:
        query = session.query(Note)
        if status:
            query = query.filter_by(status=status)
        notes = query.order_by(Note.created_at.desc()).all()
        return notes


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(note_id: int):
    """获取单篇笔记"""
    with Session(engine) as session:
        note = session.query(Note).filter_by(id=note_id).first()
        if not note:
            raise HTTPException(404, "笔记不存在")
        return note


@router.post("/", response_model=NoteResponse)
async def create_note(data: NoteCreate):
    """创建笔记（存为草稿）"""
    with Session(engine) as session:
        # 获取图片路径
        image_ids = data.image_ids
        images = []
        if image_ids:
            materials = session.query(Material).filter(
                Material.id.in_(image_ids)
            ).all()
            images = [m.file_path for m in materials]

        note = Note(
            account_id=data.account_id,
            product_id=data.product_id,
            title=data.title,
            content=data.content,
            images=images,
            tags=data.tags,
            status=NoteStatus.DRAFT,
        )
        session.add(note)
        session.commit()
        session.refresh(note)
        return note


@router.put("/{note_id}", response_model=NoteResponse)
async def update_note(note_id: int, data: NoteDraft):
    """更新笔记"""
    with Session(engine) as session:
        note = session.query(Note).filter_by(id=note_id).first()
        if not note:
            raise HTTPException(404, "笔记不存在")

        if data.title:
            note.title = data.title
        if data.content:
            note.content = data.content
        if data.product_id is not None:
            note.product_id = data.product_id
        if data.image_ids:
            materials = session.query(Material).filter(
                Material.id.in_(data.image_ids)
            ).all()
            note.images = [m.file_path for m in materials]
        if data.tags:
            note.tags = data.tags

        session.commit()
        return note


@router.post("/{note_id}/publish", response_model=MessageResponse)
async def publish_note(note_id: int):
    """发布笔记到小红书"""
    with Session(engine) as session:
        note = session.query(Note).filter_by(id=note_id).first()
        if not note:
            raise HTTPException(404, "笔记不存在")

    if not browser_engine.page:
        raise HTTPException(400, "浏览器未启动，请先登录账号")

    # 准备发布
    image_paths = note.images or []
    success = await browser_engine.publish_note(
        title=note.title or "",
        content=note.content or "",
        image_paths=image_paths,
        tags=note.tags or [],
    )

    if not success:
        raise HTTPException(500, "发布失败")

    # 更新状态
    with Session(engine) as session:
        note = session.query(Note).filter_by(id=note_id).first()
        note.status = NoteStatus.PUBLISHED
        from datetime import datetime
        note.published_at = datetime.now()
        session.commit()

    return {"message": "发布成功"}


@router.delete("/{note_id}", response_model=MessageResponse)
async def delete_note(note_id: int):
    """删除笔记"""
    with Session(engine) as session:
        note = session.query(Note).filter_by(id=note_id).first()
        if not note:
            raise HTTPException(404, "笔记不存在")
        session.delete(note)
        session.commit()
    return {"message": "删除成功"}


@router.post("/ai-generate", response_model=dict)
async def ai_generate_note(data: AINoteGenerate):
    """AI 生成笔记文案"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")
    try:
        result = ai_engine.generate_comment("generate_note", {
            "topic": data.topic,
            "description": data.description,
        })
        return {"content": result}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/ai-generate-batch", response_model=dict)
async def ai_generate_batch(data: AIProductNoteBatch):
    """按产品库（知识库条目）批量生成笔记草稿"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")
    if not data.product_ids:
        raise HTTPException(400, "请至少选择一个产品")
    if data.count_per_product < 1 or data.count_per_product > 10:
        raise HTTPException(400, "每个产品生成的草稿数量需在 1-10 之间")

    created = []
    errors = []
    with Session(engine) as session:
        products = session.query(KnowledgeBase).filter(
            KnowledgeBase.id.in_(data.product_ids)
        ).all()
        if not products:
            raise HTTPException(404, "产品库中没有找到对应条目")

        for p in products:
            for i in range(data.count_per_product):
                try:
                    result = ai_engine.generate_comment(
                        "generate_note_from_product",
                        {
                            "title": p.title or "未命名产品",
                            "content": p.content or "",
                            "tags": "、".join(p.tags or []),
                            "description": data.description,
                        },
                    )
                    parsed = _parse_ai_note(result)
                    note = Note(
                        account_id=data.account_id,
                        product_id=p.id,
                        title=parsed["title"],
                        content=parsed["content"],
                        tags=[t for t in parsed["tags"] if t],
                        images=[],
                        status=NoteStatus.DRAFT,
                    )
                    session.add(note)
                    created.append({
                        "product_id": p.id,
                        "product_title": p.title,
                        "title": note.title,
                        "content": note.content,
                        "tags": note.tags,
                    })
                except Exception as e:
                    errors.append({"product_id": p.id, "title": p.title, "error": str(e)})
        session.commit()

    return {"created": created, "errors": errors}


def _parse_ai_note(text: str) -> dict:
    """解析 AI 返回的笔记 JSON，兼容代码块和多余说明的干扰"""
    # 去掉可能包裹的代码块标记
    text = re.sub(r"```(?:json)?", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # 提取第一个 {...}
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise ValueError("AI 返回格式无法解析")
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            raise ValueError("AI 返回的不是有效 JSON")
    title = str(data.get("title") or data.get("titel") or "未命名笔记").strip()
    content = str(data.get("content") or "").strip()
    raw_tags = data.get("tags") or []
    tags = []
    if isinstance(raw_tags, list):
        for t in raw_tags:
            t = str(t).strip().lstrip("#")
            if t and t not in tags:
                tags.append(t)
    if not content:
        raise ValueError("AI 未生成正文")
    return {"title": title, "content": content, "tags": tags}
