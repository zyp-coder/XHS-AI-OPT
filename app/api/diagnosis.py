"""账号诊断 API - 频率建议 + 选题 + 笔记规划 + 笔记结构符合度 + 单篇笔记检查（断症 + 练剑）"""
import json
import re
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models.models import engine, Note, KnowledgeBase, Account
from app.core.browser import browser_engine
from app.core.ai_engine import ai_engine

router = APIRouter()

# 品类→笔记结构关键词（用于复用后端判定 + 决定注入哪套笔记结构）
# 依据「小红书品类与笔记结构匹配矩阵表」：判断这条产品/内容属于哪个品类，就用该品类的页数与每页功能
_CATEGORY_KEYWORDS = {
    "虚拟资料/知识付费": ["资料", "模板", "课程", "付费", "电子书", "文档", "教程包", "资料包", "知识付费"],
    "实物测评/红黑榜": ["测评", "实测", "红黑榜", "横评", "避坑指南", "开箱", "对比"],
    "场景种草/生活方式": ["种草", "好物", "家居", "改造", "氛围", "生活", "带娃", "穿搭", "空间"],
    "干货教程/技能教学": ["教程", "步骤", "教学", "实操", "技巧", "操作", "方法", "上手"],
    "合集盘点/资源整理": ["合集", "盘点", "清单", "整理", "汇总", "书单", "10件", "平价好物"],
    "个人经历/情感共鸣": ["经历", "裸辞", "复盘", "感悟", "故事", "真实", "分享经历", "职场"],
}

# 内置品类矩阵全文（知识库里有「笔记架构」条目则优先用知识库原文）
_BUILTIN_MATRIX = (
    "【小红书品类与笔记结构匹配矩阵表】发图文笔记前，先判断这条内容属于哪个品类，就按该品类的「页数」和「每页功能(P1..Pn)」来排版，每页的构图/选图也按该页功能来定。\n\n"
    "一、虚拟资料/知识付费（如：笔记、课程、模板）{p}决策痛点：决策成本低，看重「直观价值感」和「真实感」。{s}推荐结构：极简 1-3 页（大字报/目录展示）{d}P1 封面：痛点+结果（如：提分逆袭）+ 真实笔记实拍图\nP2 价值：目录展示/内页拼图（证明干货满满）\nP3 引导：简单粗暴的购买/获取指令\n案例：家教提分笔记、自媒体排版模板\n\n"
    "二、实物测评/红黑榜（如：美妆、数码、家电）{p}痛点：选择困难，看重「真实对比」和「客观中立」。{s}结构：4-5 页（测评对比型）{d}P1 封面：多款产品对比图/红黑榜大字报\nP2 痛点：选购避坑指南或常见误区\nP3 实测：核心维度横评（质地、性能等）+ 真实数据\nP4 结论：明确给出购买建议（谁适合买哪款）\n案例：3款网红速食面实测、平价粉底液实测\n\n"
    "三、场景种草/生活方式（如：家居、母婴、穿搭）{p}痛点：需要代入感，看重「情绪价值」和「氛围感」。{s}结构：4-6 页（场景种草型）{d}P1 封面：高颜值场景图/痛点发问（如：带娃出门太狼狈？）\nP2 场景：还原真实生活痛点场景\nP3 方案：产品融入场景，展示使用过程\nP4 感受：真实体验分享（优缺点坦诚）+ 推荐理由\n案例：租房改造好物、解放双手的带娃神器\n\n"
    "四、干货教程/技能教学（如：软件操作、菜谱、健身）{p}痛点：需要实操性，看重「步骤清晰」和「易学」。{s}结构：5-7 页（教程步骤型）{d}P1 封面：目标+效果（如：3步画出野生眉）+ 效果对比\nP2 准备：所需工具/前置条件清单\nP3 步骤：分步拆解（一步一图，小白也能看懂）\nP4 避坑：新手常见错误预警\nP5 总结：核心要点回顾 + 引导收藏\n案例：微胖女生显瘦穿搭、新手养猫避坑指南\n\n"
    "五、合集盘点/资源整理（如：书单、APP、平价好物）{p}痛点：怕麻烦，看重「信息密度」和「收藏价值」。{s}结构：4-6 页（合集清单型）{d}P1 封面：数字+人群（如：租房党必看10件好物）\nP2 清单：核心清单概览（一图列出要点）\nP3 详述：逐一介绍优缺点（可多图拼接）\nP4 排序：给出明确的推荐优先级\nP5 结尾：引导收藏（“赶紧码住试试”）\n案例：提升幸福感的家居好物、冷门副业网站盘点\n\n"
    "六、个人经历/情感共鸣（如：职场复盘、情感故事）{p}痛点：寻求认同，看重「真实人设」和「情绪共鸣」。{s}结构：4-6 页（经验复盘型）{d}P1 封面：反差/情绪标签（如：裸辞3个月，我悟了）\nP2 经历：真实故事开端与冲突升级\nP3 观点：提炼核心感悟（金句输出）\nP4 价值：升华到普遍价值，给他人启发\nP5 互动：抛出问题，引导评论区分享经历\n案例：从月薪3k到3w的职场真相、反向消费感悟"
).format(p="\n", s="\n", d="\n")


def _detect_category(session) -> str:
    """识别当前卖的产品/内容最像哪个品类（供判断该用哪套页数结构）。先看知识库，再看已发笔记兜底。"""
    kb = session.query(KnowledgeBase).filter(
        KnowledgeBase.category.in_(["产品介绍", "产品", "专业知识", "通用"])
    ).order_by(KnowledgeBase.updated_at.desc()).limit(20).all()
    text = " ".join([(k.title or "") + " " + (k.content or "") for k in kb])
    if not text:
        notes = session.query(Note).limit(20).all()
        text = " ".join([(n.title or "") + " " + (n.content or "") for n in notes])

    best = ("", 0)
    for name, kws in _CATEGORY_KEYWORDS.items():
        cnt = sum(1 for kw in kws if kw in text)
        if cnt > best[1]:
            best = (name, cnt)
    return best[0]


def _architecture_context(session, category: str) -> str:
    """取笔记结构指引。优先知识库「笔记架构」条目（品类矩阵表），其次内置矩阵兜底。"""
    arch = session.query(KnowledgeBase).filter(
        KnowledgeBase.category == "笔记架构"
    ).order_by(KnowledgeBase.id).first()
    if arch:
        return arch.title + "\n" + arch.content
    return _BUILTIN_MATRIX


class DiagnosisRequest(BaseModel):
    """账号诊断请求

    - stage: 账号当前阶段（起步期 / 成长期 / 成熟期）
    - frequency: 当前或期望的发笔记频率，如 "每周2篇"
    - audience: 想服务的人群 / 补充说明
    - target_url: 可选。留空=分析自己（本账号笔记）；填他人主页/某篇笔记链接=分析别人的号
    """
    stage: str = "起步期"
    frequency: str = ""
    audience: str = ""
    target_url: str = ""


class NoteCheckRequest(BaseModel):
    """单篇笔记检查请求（点击某篇笔记 → 抓取全文 + AI 按品类判断是否符合结构）"""
    url: str = ""
    title: str = ""


def _first_account_id(session):
    """取第一个可用账号（用于浏览器登录会话）"""
    acc = session.query(Account).filter_by(is_active=True).order_by(Account.id).first()
    if not acc:
        acc = session.query(Account).order_by(Account.id).first()
    return acc.id if acc else None


async def _ensure_browser(session) -> str:
    """确保浏览器就绪且已登录，返回 'ok' 或错误信息"""
    acc = _first_account_id(session)
    if acc is None:
        return "no_account"
    ready = await browser_engine.ensure_ready(acc)
    if ready == "ok":
        return "ok"
    if ready == "need_login":
        return "need_login"
    return ready


def _looks_like_note_url(url: str) -> bool:
    """判断是不是单篇笔记链接（筛选 /explore/{id} 或含 note 语义的路径）"""
    try:
        return "/explore/" in url or "note-" in url or "/item/" in url or "/discovery/" in url
    except Exception:
        return False


def _extract_json(text: str) -> dict:
    """从 AI 输出中稳健提取 JSON"""
    if not text:
        raise ValueError("AI 返回为空")
    text = text.strip()
    # 去掉 ```json ... ``` 代码块
    text = re.sub(r"^```(?:json)?\s*", "", text).rstrip("`").strip()
    # 找到第一个 { 到最后一个 }
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("AI 输出中没有合法 JSON")
    obj = json.loads(text[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("AI 输出 JSON 不是对象")
    return obj


def _notes_summary(session) -> str:
    """汇总账号近期笔记表现"""
    today = datetime.now()
    start = today - timedelta(days=30)
    notes = session.query(Note).filter(
        Note.published_at >= start
    ).order_by(Note.published_at).all()

    all_notes = session.query(Note).order_by(Note.published_at.desc()).all()
    total = len(all_notes)

    if not notes and not all_notes:
        return "（暂无笔记数据。若你还没有发布过笔记，建议规划从第 0 篇开始。）"

    lines = [f"30 天内发布笔记：{len(notes)} 篇；历史累计：{total} 篇。"]

    # 发笔记密度（近30天）
    if notes:
        days = max((today - notes[0].published_at).days or 1, 1)
        lines.append(f"近 30 天发笔记密度：约每 {days / max(len(notes), 1):.1f} 天一篇。")

    # 表现最好的几篇
    top = sorted(all_notes, key=lambda n: (n.likes or 0), reverse=True)[:5]
    if top:
        lines.append("表现较好的笔记：")
        for n in top:
            likes = n.likes or 0
            fmt = (n.published_at.strftime("%m-%d") if n.published_at else "未知日期")
            lines.append(f"- {fmt} 《{n.title or '(无标题)'}》 点赞 {likes} 评论 {n.comments_count or 0} 收藏 {n.collects or 0}")

    return "\n".join(lines)


def _product_context(session) -> str:
    """从知识库取产品介绍 + 个人经历 + 专业知识，作为产品场景

    按『最近导入（updated_at 倒序）』取，让架构建议跟最新知识库走。
    """
    kb = session.query(KnowledgeBase).filter(
        KnowledgeBase.category.in_(["产品介绍", "个人经历", "产品", "通用", "专业知识"])
    ).order_by(KnowledgeBase.updated_at.desc(), KnowledgeBase.id.desc()).limit(20).all()
    if not kb:
        return "（知识库暂未录入产品资料，请先在知识库补充产品介绍，诊断会更精准。）"
    parts = ["- " + (k.title or "未命名") + ": " + (k.content[:160]) for k in kb]
    return "\n".join(parts)


def _notes_review_list(session):
    """抽样本账号近期笔记（标题+正文节选+可点击链接）。

    Returns: (text, items) — text 喂给 AI 判断，items 供前端点开单篇检查。
    items[i] = {title, url(可空), author}
    """
    today = datetime.now()
    start = today - timedelta(days=60)
    notes = session.query(Note).filter(
        Note.published_at >= start,
        (Note.title.isnot(None) & (Note.title != ""))
    ).order_by(Note.published_at).all()

    if not notes:
        alln = session.query(Note).order_by(Note.published_at.desc()).limit(8).all()
        notes = [n for n in alln if n.title]
    if not notes:
        return "（暂无已发布笔记，无法做架构符合度检查。建议先发布几篇，或输入他人主页链接来诊断。）", []

    notes = notes[:8]
    items = []
    lines = []
    for i, n in enumerate(notes):
        title = n.title or "(无标题)"
        content = (n.content or "").strip()
        url = ("https://www.xiaohongshu.com/explore/" + n.xhs_note_id) if n.xhs_note_id else ""
        items.append({"title": title, "url": url, "author": ""})
        if len(content) > 160:
            content = content[:160] + "…"
        lines.append(f"[{i}] 标题：{title}")
        if content:
            lines.append(f"    正文：{content.replace(chr(10), ' / ')}")
    return "\n".join(lines), items


async def _scrape_target(session, target_url: str, max_notes: int = 8):
    """输入他人主页或某篇笔记链接 → 采样该账号的笔记（含可点击链接）。

    单篇链接：抓取这一篇全文；主页链接：抓笔记列表 + 尽量补前几篇正文。
    Returns: (text, items)
    """
    ok = await _ensure_browser(session)
    if ok != "ok":
        msg = {
            "need_login": "分析他人主页需要浏览器已登录。请先在【账号管理】登录你的小红书账号后重试。",
            "no_account": "请先添加小红书账号并登录，再输入他人主页链接进行分析。",
        }.get(ok, f"浏览器未就绪：{ok}（请先在【账号管理】启动并登录小红书）")
        raise HTTPException(status_code=400, detail=msg)

    if _looks_like_note_url(target_url):
        # 单篇笔记
        note = await browser_engine.get_note_content(target_url)
        content = (note.get("content") or "").strip()
        title = (note.get("title") or "").strip()
        item = {"title": title, "url": target_url, "author": note.get("author") or ""}
        lines = [f"[0] 标题：{title or '(无标题)'}"]
        if content:
            lines.append("    正文：" + (content[:500] + "…" if len(content) > 500 else content).replace(chr(10), " / "))
        items = [item] if title else []
        return "\n".join(lines), items or [{"title": title or "(未取到标题，可点开检查)", "url": target_url, "author": ""}]

    # 主页链接：采集笔记列表，尽量补齐前几篇正文
    scraped = await browser_engine.get_user_notes(target_url, max_results=max_notes)
    if not scraped:
        return "（无法从该主页采集到笔记，可能是链接不是用户主页、或需要登录。）", []

    items = []
    lines = []
    for i, it in enumerate(scraped):
        items.append({"title": it.get("title") or "(无标题)", "url": it.get("url") or "", "author": it.get("author") or ""})
        lines.append(f"[{i}] 标题：{it.get('title') or '(无标题)'}")

    # 逐个进笔记补正文（只补前5篇，避免太慢）
    for i, it in enumerate(items[:5]):
        if not it["url"]:
            continue
        try:
            note = await browser_engine.get_note_content(it["url"])
            content = (note.get("content") or "").strip()
            if content:
                it["content"] = content[:300]
                lines.append(f"    正文：{(content[:300] + '…' if len(content) > 300 else content).replace(chr(10), ' / ')}")
        except Exception:
            pass

    return "\n".join(lines), items


def _architecture_payload(session):
    """取品类 + 架构文本，供诊断与单篇检查共用"""
    category = _detect_category(session)
    architecture = _architecture_context(session, category)
    product = _product_context(session)
    return category, architecture, product


@router.post("/account")
async def diagnose_account(req: DiagnosisRequest):
    """执行一次账号诊断，输出频率建议 + 选题 + 笔记规划 + 笔记结构符合度

    - 默认分析自己（本账号已发布笔记）
    - 填 target_url（他人主页 / 某篇笔记链接）→ 分析别人的号
    """
    if not ai_engine.is_configured():
        raise HTTPException(status_code=400, detail="AI 未配置，请先在【AI 配置】填入 API Key")

    target_url = (req.target_url or "").strip()

    with Session(engine) as session:
        notes_summary = _notes_summary(session)
        category, architecture, product = _architecture_payload(session)

        if target_url:
            # 分析他人主页 / 指定笔记
            notes_review, review_items = await _scrape_target(session, target_url)
            notes_summary_note = "（本次为分析输入链接对应账号的笔记，非本账号历史数据。）"
        else:
            notes_review, review_items = _notes_review_list(session)
            notes_summary_note = notes_summary

    context = {
        "stage": req.stage or "起步期",
        "frequency": req.frequency or "未说明（按当前账号数据分析）",
        "audience": req.audience or "未说明（请描述想服务的人群）",
        "notes_summary": notes_summary_note if not target_url else f"【分析对象】{target_url}\n{notes_summary_note}",
        "product": product,
        "product_type": category or "未明确（请 AI 判断）",
        "architecture": architecture,
        "notes_review": notes_review,
    }

    raw = ai_engine.chat(message="", scene="account_diagnosis", context=context)
    try:
        data = _extract_json(raw)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 输出解析失败：{e}")

    # 把抽样笔记的物品（含可点击链接）拼到 architecture.notes_review 便于前端点开
    arch = data.get("architecture", {}) or {}
    arch["source"] = "target" if target_url else "self"
    arch["target_url"] = target_url
    arch["review_items"] = review_items
    data["architecture"] = arch

    return {
        "context": context,
        "frequency_advice": data.get("frequency_advice", {}),
        "topics": data.get("topics", []),
        "plan": data.get("plan", []),
        "plan_phases": data.get("plan_phases", []),
        "sequence_logic": data.get("sequence_logic", ""),
        "architecture": arch,
        "architecture_advice": data.get("architecture_advice", []),
    }


class _NoteCheckOut(BaseModel):
    """单篇笔记检查输出（前端直接透传）"""
    ok: bool = False
    note: dict = Field(default_factory=dict)
    check: dict = Field(default_factory=dict)
    message: str = ""


@router.post("/check-note", response_model=_NoteCheckOut)
async def check_note(req: NoteCheckRequest):
    """点击某篇笔记 → 抓取该笔记全文 + AI 按品类判断是否符合页数结构（逐篇检查）"""
    if not ai_engine.is_configured():
        raise HTTPException(status_code=400, detail="AI 未配置，请先在【AI 配置】填入 API Key")

    url = (req.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="请提供笔记链接")

    with Session(engine) as session:
        ok = await _ensure_browser(session)
        if ok != "ok":
            raise HTTPException(status_code=400, detail="检查他人笔记需要浏览器已登录。请先在【账号管理】登录小红书账号后重试。")
        category, architecture, product = _architecture_payload(session)
        note = await browser_engine.get_note_content(url)

    title = (note.get("title") or req.title or "").strip()
    content = (note.get("content") or "").strip()[0:1200]

    # 只抓到了标题、没抓到正文时，正文用标题兜底也能判断
    if not content and title:
        content = title

    context = {
        "note_title": title or "(无标题)",
        "note_content": content,
        "note_author": note.get("author") or "",
        "architecture": architecture,
        "product": product,
        "product_type": category or "未明确（请 AI 判断）",
    }
    raw = ai_engine.chat(message="", scene="note_architecture_check", context=context)
    check = {}
    try:
        check = _extract_json(raw)
    except Exception:
        check = {"raw": raw}

    return _NoteCheckOut(
        ok=True,
        note={"title": title, "content": content, "author": note.get("author") or "", "url": url, "blocked": bool(note.get("_blocked"))},
        check=check,
        message="",
    )