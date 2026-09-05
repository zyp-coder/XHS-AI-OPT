"""知识库管理 API"""
import os
import uuid
import aiofiles
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.models import engine, KnowledgeBase
from app.schemas.schemas import (
    KnowledgeBaseCreate, KnowledgeBaseUpdate,
    KnowledgeBaseResponse, MessageResponse
)
from config import UPLOAD_DIR

router = APIRouter()


@router.get("/", response_model=list[KnowledgeBaseResponse])
async def list_knowledge(
    category: str = None,
    keyword: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """获取知识库列表，支持分类筛选和关键词搜索"""
    with Session(engine) as session:
        query = session.query(KnowledgeBase)
        if category:
            query = query.filter_by(category=category)
        if keyword:
            kw = f"%{keyword}%"
            query = query.filter(
                or_(
                    KnowledgeBase.title.ilike(kw),
                    KnowledgeBase.content.ilike(kw),
                )
            )
        total = query.count()
        items = query.order_by(KnowledgeBase.updated_at.desc()) \
                     .offset((page - 1) * page_size) \
                     .limit(page_size) \
                     .all()
        return items


@router.post("/", response_model=KnowledgeBaseResponse, status_code=201)
async def create_knowledge(data: KnowledgeBaseCreate):
    """新增知识库条目"""
    with Session(engine) as session:
        item = KnowledgeBase(**data.model_dump())
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


@router.get("/{item_id}", response_model=KnowledgeBaseResponse)
async def get_knowledge(item_id: int):
    """获取单条知识库"""
    with Session(engine) as session:
        item = session.query(KnowledgeBase).filter_by(id=item_id).first()
        if not item:
            raise HTTPException(404, "条目不存在")
        return item


@router.put("/{item_id}", response_model=KnowledgeBaseResponse)
async def update_knowledge(item_id: int, data: KnowledgeBaseUpdate):
    """更新知识库条目"""
    with Session(engine) as session:
        item = session.query(KnowledgeBase).filter_by(id=item_id).first()
        if not item:
            raise HTTPException(404, "条目不存在")
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(item, key, value)
        session.commit()
        session.refresh(item)
        return item


@router.delete("/{item_id}", response_model=MessageResponse)
async def delete_knowledge(item_id: int):
    """删除知识库条目"""
    with Session(engine) as session:
        item = session.query(KnowledgeBase).filter_by(id=item_id).first()
        if not item:
            raise HTTPException(404, "条目不存在")
        session.delete(item)
        session.commit()
    return {"message": "删除成功"}


@router.post("/upload-image")
async def upload_kb_image(file: UploadFile = File(...)):
    """上传知识库截图"""
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(400, f"不支持的文件类型: {file.content_type}")

    file_ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    file_name = f"kb_{uuid.uuid4().hex}.{file_ext}"
    file_path = UPLOAD_DIR / file_name

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    return {"url": "/uploads/" + file_name}


@router.get("/search/query", response_model=list[KnowledgeBaseResponse])
async def search_knowledge(
    q: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=20),
):
    """搜索知识库（给 AI 调用用）"""
    with Session(engine) as session:
        kw = f"%{q}%"
        items = session.query(KnowledgeBase).filter(
            or_(
                KnowledgeBase.title.ilike(kw),
                KnowledgeBase.content.ilike(kw),
            )
        ).order_by(KnowledgeBase.updated_at.desc()).limit(limit).all()
        return items
