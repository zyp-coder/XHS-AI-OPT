"""扩展 API — Chrome 插件「小红书评论助手」后端"""
import asyncio
import json
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.ai_engine import ai_engine
from app.core.browser import browser_engine
from app.models.models import engine

router = APIRouter(tags=["扩展"])


class AnalyzeRequest(BaseModel):
    url: str = ""
    title: str = ""
    description: str = ""
    author: str = ""
    comments: list[dict] = []  # [{author, content, replyTo?}, ...]
    threads: list[dict] = []   # [{author, content, replies: [{author, content}, ...]}, ...]


class FetchRequest(BaseModel):
    url: str


class TopicAnalysisRequest(BaseModel):
    url: str = ""
    title: str = ""
    description: str = ""
    author: str = ""
    topic: dict = {}        # {author, content}
    replies: list[dict] = []  # [{author, content, replyTo}, ...]


# ========== 工具函数 ==========

def _build_comments_text(comments: list[dict]) -> str:
    """将评论列表格式化为文本"""
    lines = []
    for i, c in enumerate(comments):
        author = c.get("author", "用户")
        content = c.get("content", "")
        reply_to = c.get("replyTo", "")
        if reply_to:
            lines.append(f"{i}. @{author} 回复 @{reply_to}: {content}")
        else:
            lines.append(f"{i}. @{author}: {content}")
    return "\n".join(lines)


def _build_threads_text(threads: list[dict]) -> str:
    """将线程结构格式化为文本（含多轮对话上下文）"""
    if not threads:
        return ""
    parts = []
    for i, t in enumerate(threads, 1):
        parts.append(f"--- 对话 {i} ---")
        parts.append(f"@{t.get('author', '用户')}: {t.get('content', '')}")
        for r in t.get("replies", []):
            parts.append(f"  └ @{r.get('author', '用户')} 回复 @{r.get('replyTo', t.get('author', ''))}: {r.get('content', '')}")
    return "\n".join(parts)


def _call_ai(system_prompt: str, user_prompt: str, max_tokens: int = 1500) -> str:
    """直接调用 AI（绕过模板系统）"""
    from openai import OpenAI
    from app.models.models import AIConfig, engine
    from sqlalchemy.orm import Session

    with Session(engine) as session:
        config = session.query(AIConfig).first()
        if not config or not config.api_key:
            raise RuntimeError("AI 未配置")

        client = OpenAI(
            api_key=config.api_key,
            base_url=config.api_base_url,
        )
        response = client.chat.completions.create(
            model=config.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=config.temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content


async def _call_ai_async(system: str, user: str, max_tokens: int = 1500) -> str:
    """异步调用 AI"""
    return await asyncio.to_thread(_call_ai, system, user, max_tokens)


def _render_template(template: str, **kwargs) -> str:
    """安全渲染模板：用 .replace() 代替 .format()，避免花括号冲突"""
    for key, value in kwargs.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _extract_json(text: str) -> dict:
    """从 AI 回复中提取 JSON"""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return json.loads(match.group())
    raise ValueError("AI 回复中未找到 JSON")


def _parse_reply_versions(text: str) -> list:
    """从 AI 回复中解析多版本回复建议"""
    if not text:
        return []
    versions = []
    # 兼容两种格式：
    # 1. 【版本X】...【版本X】... (带括号，旧格式)
    # 2. 版本X：...版本X：... (不带括号，新格式)
    # 先尝试匹配带括号的
    pattern1 = r'【版本[一二三][^】]*】.*?(?=【版本[一二三][^】]*】|$)'
    matches = re.findall(pattern1, text, re.DOTALL)
    if not matches:
        # 尝试匹配不带括号的：版本一：/版本一（/版本一\n 等变体
        pattern2 = r'版本[一二三][：）)．.].*?(?=版本[一二三][：）)．.]|$)'
        matches = re.findall(pattern2, text, re.DOTALL)
    for m in matches:
        m = m.strip().strip('"').strip("'").strip()
        if m and len(m) > 5:
            versions.append(m)
    return versions if versions else [text.strip().strip('"').strip("'").strip()]


# ========== 健康检查 ==========

@router.get("/health")
async def health():
    """检查 AI 是否已配置"""
    return {"status": "ok", "ai_configured": ai_engine.is_configured()}


# ========== 逐条回复建议（已有） ==========

@router.post("/analyze")
async def analyze_comments(req: AnalyzeRequest):
    """逐条生成 AI 回复建议（并行处理）"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    if not req.comments:
        return {"url": req.url, "suggestions": []}

    async def process_one(comment: dict) -> dict:
        author = comment.get("author", "用户")
        content = comment.get("content", "")
        try:
            context = {
                "note_title": req.title or "(无标题)",
                "note_content": req.description or "",
                "note_author": req.author or "作者",
                "comment_author": author,
                "comment_content": content,
            }
            reply = await asyncio.to_thread(
                ai_engine.generate_comment, "comment_assistant", context
            )
            # 解析多版本回复
            versions = _parse_reply_versions(reply)
            return {
                "author": author,
                "original_comment": content,
                "suggested_reply": versions[0] if versions else reply.strip('"').strip("'").strip(),
                "versions": versions,
            }
        except Exception as e:
            return {"author": author, "original_comment": content, "suggested_reply": "", "versions": [], "error": str(e)}

    sem = asyncio.Semaphore(5)

    async def limited(c):
        async with sem:
            return await process_one(c)

    suggestions = await asyncio.gather(*[limited(c) for c in req.comments])
    return {"url": req.url, "suggestions": suggestions}


# ========== 商机发现（新增） ==========

@router.post("/find-opportunities")
async def find_opportunities(req: AnalyzeRequest):
    """发现评论区中的商业机会（一次 API 调用分析所有评论）"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    if not req.comments:
        return {"url": req.url, "opportunities": [], "summary": "暂无评论", "has_opportunity": False}

    comments_text = _build_comments_text(req.comments)
    threads_text = _build_threads_text(req.threads)

    # 从数据库加载 prompt
    prompt = ai_engine.get_prompt("opportunity_finder")
    if not prompt:
        raise HTTPException(500, "商机发现场景未配置")

    system_prompt = prompt["system_prompt"]
    user_prompt = _render_template(
        prompt["user_prompt_template"],
        note_title=req.title or "(无标题)",
        note_content=req.description or "",
        note_author=req.author or "作者",
        comment_count=str(len(req.comments)),
        comments_text=comments_text,
        threads_text=threads_text or "(无多轮对话)",
    )

    try:
        reply = await _call_ai_async(system_prompt, user_prompt)
        data = _extract_json(reply)
        opportunities = data.get("opportunities", [])
        for opp in opportunities:
            if "conversation_context" not in opp:
                opp["conversation_context"] = opp.get("original_comment", "")
        return {
            "url": req.url,
            "opportunities": opportunities,
            "summary": data.get("summary", ""),
            "has_opportunity": data.get("has_opportunity", False),
        }
    except Exception as e:
        raise HTTPException(500, f"商机分析失败: {e}")


# ========== 评论分析（新增） ==========

@router.post("/analyze-comments")
async def analyze_comments_overall(req: AnalyzeRequest):
    """分析评论区整体情况（情感、热点、痛点）"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    if not req.comments:
        return {"url": req.url, "overall_sentiment": "中性", "hot_topics": [], "summary": "暂无评论"}

    comments_text = _build_comments_text(req.comments)

    prompt = ai_engine.get_prompt("comment_analysis")
    if not prompt:
        raise HTTPException(500, "评论分析场景未配置")

    system_prompt = prompt["system_prompt"]
    user_prompt = _render_template(
        prompt["user_prompt_template"],
        note_title=req.title or "(无标题)",
        note_content=req.description or "",
        comment_count=str(len(req.comments)),
        comments_text=comments_text,
    )

    try:
        reply = await _call_ai_async(system_prompt, user_prompt)
        data = _extract_json(reply)
        return {
            "url": req.url,
            "overall_sentiment": data.get("overall_sentiment", "中性"),
            "total_comments": data.get("total_comments", len(req.comments)),
            "participant_count": data.get("participant_count", 0),
            "topic_distribution": data.get("topic_distribution", []),
            "hottest_topic": data.get("hottest_topic", {}),
            "hot_topics": data.get("hot_topics", []),
            "pain_points": data.get("pain_points", []),
            "interested_users": data.get("interested_users", []),
            "tagged_comments": data.get("tagged_comments", []),
            "summary": data.get("summary", ""),
        }
    except Exception as e:
        raise HTTPException(500, f"评论分析失败: {e}")


# ========== 话题分析（新增） ==========

def _build_replies_text(replies: list[dict]) -> str:
    """将回复列表格式化为文本"""
    lines = []
    for i, r in enumerate(replies, 1):
        author = r.get("author", "用户")
        content = r.get("content", "")
        reply_to = r.get("replyTo", "")
        if reply_to:
            lines.append(f"{i}. @{author} 回复 @{reply_to}: {content}")
        else:
            lines.append(f"{i}. @{author}: {content}")
    return "\n".join(lines)


@router.post("/analyze-topic")
async def analyze_topic(req: TopicAnalysisRequest):
    """分析单个话题的讨论（一级评论 + 二级回复）"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    topic = req.topic or {}
    replies = req.replies or []
    if not topic.get("content"):
        raise HTTPException(400, "话题内容不能为空")

    replies_text = _build_replies_text(replies)

    prompt = ai_engine.get_prompt("topic_analysis")
    if not prompt:
        raise HTTPException(500, "话题分析场景未配置")

    system_prompt = prompt["system_prompt"]
    user_prompt = _render_template(
        prompt["user_prompt_template"],
        note_title=req.title or "(无标题)",
        note_content=req.description or "",
        note_author=req.author or "作者",
        topic_author=topic.get("author", "用户"),
        topic_content=topic.get("content", ""),
        reply_count=str(len(replies)),
        replies_text=replies_text or "(无回复)",
    )

    try:
        reply = await _call_ai_async(system_prompt, user_prompt, max_tokens=800)
        data = _extract_json(reply)
        return {
            "summary": data.get("summary", ""),
            "popularity": data.get("popularity", "中"),
            "popularity_reason": data.get("popularity_reason", ""),
            "illustration_opportunity": data.get("illustration_opportunity", "暂无"),
            "illustration_detail": data.get("illustration_detail", ""),
        }
    except Exception as e:
        raise HTTPException(500, f"话题分析失败: {e}")


# ========== 完整分析（分析+商机+提示词，一步到位） ==========

@router.post("/full-analysis")
async def full_analysis(req: AnalyzeRequest):
    """一站式分析：评论区情感/话题分析 + Top商机 + AI内容提示词"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    if not req.comments:
        return {
            "overall_sentiment": "中性", "total_comments": 0, "participant_count": 0,
            "summary": "暂无评论", "hottest_topic": None, "opportunities": [],
            "prompt_suggestions": [],
        }

    comments_text = _build_comments_text(req.comments)

    prompt = ai_engine.get_prompt("full_analysis")
    if not prompt:
        raise HTTPException(500, "完整分析场景未配置")

    system_prompt = prompt["system_prompt"]
    user_prompt = _render_template(
        prompt["user_prompt_template"],
        note_title=req.title or "(无标题)",
        note_content=req.description or "",
        note_author=req.author or "作者",
        comment_count=str(len(req.comments)),
        comments_text=comments_text,
    )

    try:
        reply = await _call_ai_async(system_prompt, user_prompt, max_tokens=2000)
        data = _extract_json(reply)
        return {
            "overall_sentiment": data.get("overall_sentiment", "中性"),
            "total_comments": data.get("total_comments", len(req.comments)),
            "participant_count": data.get("participant_count", 0),
            "summary": data.get("summary", ""),
            "hottest_topic": data.get("hottest_topic"),
            "opportunities": data.get("opportunities", []),
            "prompt_suggestions": data.get("prompt_suggestions", []),
        }
    except Exception as e:
        raise HTTPException(500, f"完整分析失败: {e}")


# ========== 已回复评论检查 ==========

@router.post("/check-replied")
async def check_replied(req: AnalyzeRequest):
    """检查哪些评论已经回复过，返回已回复的评论标识列表"""
    from sqlalchemy.orm import Session
    from app.models.models import CommentLog

    if not req.comments:
        return {"replied": []}

    replied = []
    with Session(engine) as session:
        for c in req.comments:
            author = c.get("author", "")
            content = c.get("content", "")
            if not author or not content:
                continue
            exists = session.query(CommentLog).filter_by(
                note_url=req.url,
                target_author=author,
                target_comment=content,
            ).first()
            if exists:
                replied.append(author + "||" + content)
    return {"replied": replied}


# ========== 博文评论次数检查 ==========

@router.post("/check-note-comments")
async def check_note_comments(req: AnalyzeRequest):
    """检查对某篇博文已经评论过多少次，防止被博主拉黑"""
    from sqlalchemy.orm import Session
    from app.models.models import CommentLog

    if not req.url:
        return {"count": 0, "warning": False, "message": ""}

    with Session(engine) as session:
        count = session.query(CommentLog).filter_by(
            note_url=req.url,
        ).count()

    warning = False
    message = ""
    if count >= 5:
        warning = True
        message = f"⚠️ 你已在这篇博文下评论过 {count} 次，建议不要再回复了，容易被博主拉黑！"
    elif count >= 3:
        warning = True
        message = f"⚠️ 你已在这篇博文下评论过 {count} 次，注意控制频率"
    elif count > 0:
        message = f"📝 你在这篇博文下评论过 {count} 次"

    return {"count": count, "warning": warning, "message": message}


# ========== 商机挖掘——找潜在客户+话术生成 ==========

@router.post("/find-prospects")
async def find_prospects(req: AnalyzeRequest):
    """找出评论区中对慧眼识人助手最感兴趣的1-2个潜在客户，并生成触达话术"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置")

    if not req.comments:
        return {"prospects": [], "summary": "暂无评论"}

    comments_text = _build_comments_text(req.comments)

    try:
        # 通过 ai_engine._render_prompt 注入知识库和话术库
        context = {
            "note_title": req.title or "(无标题)",
            "note_content": req.description or "",
            "note_author": req.author or "作者",
            "comment_count": str(len(req.comments)),
            "comments_text": comments_text,
        }
        system_prompt, user_prompt = ai_engine._render_prompt("prospect_finder", context)
        reply = await _call_ai_async(system_prompt, user_prompt, max_tokens=2000)
        data = _extract_json(reply)
        prospects = data.get("prospects", [])
        # 兼容新旧字段：suggested_copies（新）vs suggested_copy（旧）
        for p in prospects:
            if "suggested_copies" not in p or not p["suggested_copies"]:
                old_copy = p.get("suggested_copy", "")
                p["suggested_copies"] = [old_copy] if old_copy else []
        return {
            "prospects": prospects,
            "summary": data.get("summary", ""),
        }
    except Exception as e:
        raise HTTPException(500, f"商机挖掘失败: {e}")


# ========== 回退抓取 ==========

@router.post("/fetch")
async def fetch_page(req: FetchRequest):
    """回退方案：用服务器浏览器读取页面数据"""
    if not req.url or "xiaohongshu.com" not in req.url:
        raise HTTPException(400, "请提供有效的小红书链接")

    result = await browser_engine.start()
    if result.startswith("error"):
        raise HTTPException(500, f"浏览器启动失败: {result}")

    try:
        note_data = await browser_engine.get_note_content(req.url)
        return {
            "url": req.url,
            "title": note_data.get("title", ""),
            "description": note_data.get("content", ""),
            "author": note_data.get("author", ""),
            "comments": [],
        }
    except Exception as e:
        raise HTTPException(500, str(e))
