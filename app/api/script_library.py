"""话术库管理 API"""
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.models import engine, ScriptLibrary
from app.schemas.schemas import (
    ScriptLibraryCreate, ScriptLibraryUpdate,
    ScriptLibraryResponse, MessageResponse
)

router = APIRouter()


@router.get("/", response_model=list[ScriptLibraryResponse])
async def list_scripts(
    role: str = None,
    scenario: str = None,
    keyword: str = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """获取话术库列表，支持角色/场景筛选和关键词搜索"""
    with Session(engine) as session:
        query = session.query(ScriptLibrary)
        if role:
            query = query.filter_by(role=role)
        if scenario:
            query = query.filter_by(scenario=scenario)
        if keyword:
            kw = f"%{keyword}%"
            query = query.filter(
                or_(
                    ScriptLibrary.title.ilike(kw),
                    ScriptLibrary.content.ilike(kw),
                )
            )
        items = query.order_by(ScriptLibrary.updated_at.desc()) \
                     .offset((page - 1) * page_size) \
                     .limit(page_size) \
                     .all()
        return items


@router.post("/", response_model=ScriptLibraryResponse, status_code=201)
async def create_script(data: ScriptLibraryCreate):
    """新增话术条目"""
    with Session(engine) as session:
        item = ScriptLibrary(**data.model_dump())
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


@router.get("/{item_id}", response_model=ScriptLibraryResponse)
async def get_script(item_id: int):
    """获取单条话术"""
    with Session(engine) as session:
        item = session.query(ScriptLibrary).filter_by(id=item_id).first()
        if not item:
            raise HTTPException(404, "话术不存在")
        return item


@router.put("/{item_id}", response_model=ScriptLibraryResponse)
async def update_script(item_id: int, data: ScriptLibraryUpdate):
    """更新话术条目"""
    with Session(engine) as session:
        item = session.query(ScriptLibrary).filter_by(id=item_id).first()
        if not item:
            raise HTTPException(404, "话术不存在")
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(item, key, value)
        session.commit()
        session.refresh(item)
        return item


@router.delete("/{item_id}", response_model=MessageResponse)
async def delete_script(item_id: int):
    """删除话术条目"""
    with Session(engine) as session:
        item = session.query(ScriptLibrary).filter_by(id=item_id).first()
        if not item:
            raise HTTPException(404, "话术不存在")
        session.delete(item)
        session.commit()
    return {"message": "删除成功"}


@router.post("/init-default")
async def init_default_scripts():
    """初始化默认话术（各角色基础话术模板）"""
    defaults = [
        {
            "role": "恋爱博主",
            "scenario": "评论回复",
            "title": "鉴渣测试引导",
            "content": "说实话，感情这种事真的要擦亮眼睛。我之前用'慧眼识人助手'小程序测了鉴渣指数，7道题从回消息、吵架、前任等7个维度鉴定，结果准到我惊呆了。微信搜就能用，免费的。",
            "tags": ["鉴渣", "感情测试"],
        },
        {
            "role": "恋爱博主",
            "scenario": "私信触达",
            "title": "感情测试推荐",
            "content": "看到你在聊感情话题，我之前也踩过不少坑。后来发现个小程序叫'慧眼识人助手'，里面7套题库：鉴渣、海王、绿茶、PUA全都有，还能看全国排名。你对象要不要测测？",
            "tags": ["感情", "测试推荐"],
        },
        {
            "role": "趣味测试博主",
            "scenario": "评论回复",
            "title": "趣味测试分享",
            "content": "说到测试我就来精神了！最近发现个超上瘾的AI测试小程序'慧眼识人助手'，除了7套感情题库，还能AI面相分析、手相分析，拍个脸就能测性格，太好玩了。",
            "tags": ["趣味测试", "AI测试"],
        },
        {
            "role": "趣味测试博主",
            "scenario": "私信触达",
            "title": "综合测试推荐",
            "content": "你喜欢做测试的话一定要试试'慧眼识人助手'！7套题库免费测，每套都有全国排名。我最喜欢的是AI面相分析，上传照片就能测性格，准确率还挺高的。",
            "tags": ["测试", "面相"],
        },
        {
            "role": "世界杯博主",
            "scenario": "评论回复",
            "title": "世界杯球星测试引导",
            "content": "世界杯期间我测了个球星匹配，10道题测出我是梅西🐐20个球星可选：梅西、C罗、内马尔、姆巴佩、哈兰德...每个球星都有专属梗语录。微信搜'慧眼识人助手'就能测，免费的。",
            "tags": ["世界杯", "球星测试"],
        },
        {
            "role": "世界杯博主",
            "scenario": "私信触达",
            "title": "球星测试推荐",
            "content": "看你也在聊世界杯，推荐你做个超好玩的测试！'慧眼识人助手'小程序里有个世界杯球星测试，10道题测出你是哪个球星。我测出来是哈兰德🤖你试试？",
            "tags": ["世界杯", "球星"],
        },
        {
            "role": "普通用户",
            "scenario": "评论回复",
            "title": "共情分享话术",
            "content": "我也是过来人，感情路上确实不容易。后来发现了个小程序叫'慧眼识人助手'，7道题就能测出对方是不是渣男/海王，还有全国排名。推荐你也试试。",
            "tags": ["共情", "推荐"],
        },
        {
            "role": "普通用户",
            "scenario": "截流评论",
            "title": "自然推荐话术",
            "content": "说得对！我之前也是瞎了眼，后来用了'慧眼识人助手'一测，发现对方真的是海王😭微信搜就能用，免费的，姐妹们都去测测。",
            "tags": ["推荐", "体验"],
        },
    ]

    with Session(engine) as session:
        count = 0
        for d in defaults:
            exists = session.query(ScriptLibrary).filter_by(
                role=d["role"], title=d["title"]
            ).first()
            if not exists:
                session.add(ScriptLibrary(**d))
                count += 1
        session.commit()
    return {"message": f"已初始化 {count} 条默认话术"}
