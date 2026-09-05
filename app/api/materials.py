"""素材库 API"""
import os
import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.models.models import engine, Material
from app.schemas.schemas import MaterialResponse, MessageResponse
from config import UPLOAD_DIR

router = APIRouter()


@router.get("/", response_model=list[MaterialResponse])
async def list_materials(category: str = None):
    """获取素材列表"""
    with Session(engine) as session:
        query = session.query(Material)
        if category:
            query = query.filter_by(category=category)
        materials = query.order_by(Material.created_at.desc()).all()
        return materials


@router.post("/upload", response_model=MaterialResponse)
async def upload_material(file: UploadFile = File(...), category: str = "通用"):
    """上传素材"""
    # 验证文件类型
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(400, f"不支持的文件类型: {file.content_type}")

    # 保存文件
    file_ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    import uuid
    file_name = f"{uuid.uuid4().hex}.{file_ext}"
    file_path = UPLOAD_DIR / file_name

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # 数据库记录
    with Session(engine) as session:
        material = Material(
            file_name=file.filename,
            file_path=str(file_path),
            file_type="image",
            file_size=len(content),
            category=category,
        )
        session.add(material)
        session.commit()
        session.refresh(material)
        return material


@router.delete("/{material_id}", response_model=MessageResponse)
async def delete_material(material_id: int):
    """删除素材"""
    with Session(engine) as session:
        material = session.query(Material).filter_by(id=material_id).first()
        if not material:
            raise HTTPException(404, "素材不存在")

        # 删除文件
        if os.path.exists(material.file_path):
            os.remove(material.file_path)

        session.delete(material)
        session.commit()
    return {"message": "删除成功"}
