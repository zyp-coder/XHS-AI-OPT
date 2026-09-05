"""评论互动 API"""
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from app.models.models import engine, Comment, CommentDirection
from app.schemas.schemas import (
    CommentResponse, CommentReply, AICommentReply,
    MessageResponse,
)
from app.core.ai_engine import ai_engine
from app.core.browser import browser_engine

router = APIRouter()


@router.get("/", response_model=list[CommentResponse])
async def list_comments(direction: str = None, note_id: int = None):
    """获取评论列表"""
    with Session(engine) as session:
        query = session.query(Comment)
        if direction:
            query = query.filter_by(direction=direction)
        if note_id:
            query = query.filter_by(note_id=note_id)
        comments = query.order_by(Comment.created_at.desc()).all()
        return comments


@router.get("/{comment_id}", response_model=CommentResponse)
async def get_comment(comment_id: int):
    """获取单条评论"""
    with Session(engine) as session:
        comment = session.query(Comment).filter_by(id=comment_id).first()
        if not comment:
            raise HTTPException(404, "评论不存在")
        return comment


@router.post("/reply", response_model=MessageResponse)
async def reply_comment(data: CommentReply):
    """回复评论"""
    with Session(engine) as session:
        comment = session.query(Comment).filter_by(id=data.comment_id).first()
        if not comment:
            raise HTTPException(404, "评论不存在")

        # 获取笔记 URL
        from app.models.models import Note
        note = session.query(Note).filter_by(id=comment.note_id).first()
        note_url = f"https://www.xiaohongshu.com/explore/{note.xhs_note_id}" if note and note.xhs_note_id else ""

    if note_url and browser_engine.page:
        await browser_engine.reply_to_comment(note_url, data.reply_text)

    # 保存回复
    with Session(engine) as session:
        comment = session.query(Comment).filter_by(id=data.comment_id).first()
        comment.reply_content = data.reply_text
        session.commit()

    return {"message": "回复成功"}


@router.post("/ai-reply", response_model=list[CommentResponse])
async def ai_reply_comments(data: AICommentReply):
    """AI 批量回复评论"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    results = []
    with Session(engine) as session:
        for cid in data.comment_ids:
            comment = session.query(Comment).filter_by(id=cid).first()
            if not comment:
                continue

            from app.models.models import Note
            note = session.query(Note).filter_by(id=comment.note_id).first()

            try:
                reply = ai_engine.generate_comment("reply_self", {
                    "note_title": note.title if note else "",
                    "comment_content": comment.content,
                })
                if reply:
                    reply = reply.strip().strip('"').strip("'")
                    comment.reply_content = reply
                    comment.ai_generated = True
                    results.append(comment)
            except Exception as e:
                print(f"AI 回复失败: {e}")

        session.commit()

    return results


@router.post("/active-comment", response_model=dict)
async def active_comment(note_url: str, scene: str = "intercept_comment"):
    """主动评论（在指定笔记下评论）"""
    if not browser_engine.page:
        raise HTTPException(400, "浏览器未启动")

    # 获取笔记内容
    note_detail = await browser_engine.get_note_content(note_url)

    # AI 生成评论
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    try:
        comment = ai_engine.generate_comment(scene, {
            "note_title": note_detail.get("title", ""),
            "note_content": note_detail.get("content", ""),
        })
    except Exception as e:
        raise HTTPException(500, str(e))

    if not comment:
        raise HTTPException(500, "AI 生成评论失败")

    comment = comment.strip().strip('"').strip("'")

    # 发布评论
    success = await browser_engine.comment_on_note(note_url, comment)
    if not success:
        raise HTTPException(500, "发布评论失败（可能是风控或页面变化）")

    return {
        "comment": comment,
        "success": True,
    }
