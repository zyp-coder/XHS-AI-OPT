"""Pydantic 请求/响应模型"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ====== 账号 ======

class AccountCreate(BaseModel):
    nickname: str
    phone: Optional[str] = None


class AccountResponse(BaseModel):
    id: int
    nickname: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    cookies_exists: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 笔记 ======

class NoteCreate(BaseModel):
    account_id: int
    product_id: Optional[int] = None
    title: str = Field(max_length=300)
    content: str
    image_ids: list[int] = []
    tags: list[str] = []


class NoteDraft(BaseModel):
    account_id: int
    product_id: Optional[int] = None
    title: Optional[str] = ""
    content: Optional[str] = ""
    image_ids: list[int] = []
    tags: list[str] = []


class NoteResponse(BaseModel):
    id: int
    account_id: int
    product_id: Optional[int] = None
    xhs_note_id: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    images: Optional[list] = None
    tags: Optional[list] = None
    status: str
    views: int = 0
    likes: int = 0
    comments_count: int = 0
    collects: int = 0
    shares: int = 0
    published_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 评论 ======

class CommentResponse(BaseModel):
    id: int
    note_id: int
    xhs_comment_id: Optional[str] = None
    direction: str
    author_name: Optional[str] = None
    content: str
    reply_content: Optional[str] = None
    ai_generated: bool = False
    sentiment: Optional[str] = None
    commented_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CommentReply(BaseModel):
    comment_id: int
    reply_text: str


class AICommentReply(BaseModel):
    comment_ids: list[int]


class ActiveCommentCreate(BaseModel):
    note_url: str
    comment_text: str


# ====== AI 配置 ======

class AIConfigUpdate(BaseModel):
    api_key: str
    api_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "qwen-plus"
    temperature: float = 0.8
    max_tokens: int = 500
    # 备用模型（主模型不可用时自动切换）
    fallback_api_key: str = ""
    fallback_api_base_url: str = ""
    fallback_model: str = ""


class AIConfigResponse(BaseModel):
    api_base_url: str
    model: str
    temperature: float
    max_tokens: int
    has_key: bool = False
    # 备用模型
    fallback_api_base_url: str = ""
    fallback_model: str = ""
    has_fallback_key: bool = False

    class Config:
        from_attributes = True


class AIChatRequest(BaseModel):
    message: str
    scene: Optional[str] = None
    context: Optional[dict] = None


class AIChatResponse(BaseModel):
    reply: str


# ====== Prompt ======

class PromptUpdate(BaseModel):
    scene: str
    system_prompt: str
    user_prompt_template: str


class PromptResponse(BaseModel):
    id: int
    scene: str
    scene_name: str
    system_prompt: str
    user_prompt_template: str
    is_default: bool

    class Config:
        from_attributes = True


# ====== 目标账号 ======

class TargetAccountCreate(BaseModel):
    xhs_user_id: str
    nickname: str
    note_url: Optional[str] = None
    category: str = "agent"  # agent=中介 compete=竞品


class TargetAccountResponse(BaseModel):
    id: int
    xhs_user_id: Optional[str] = None
    nickname: Optional[str] = None
    note_url: Optional[str] = None
    category: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 目标关键词 ======

class KeywordCreate(BaseModel):
    keyword: str


class KeywordResponse(BaseModel):
    id: int
    keyword: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 引流任务 ======

class DrainTaskCreate(BaseModel):
    account_id: int
    name: str
    task_type: str  # self_reply / keyword / account
    keywords: list[str] = []
    target_account_ids: list[int] = []
    note_ids: list[int] = []
    daily_limit: int = 30
    interval_min: int = 180
    interval_max: int = 600
    time_start: str = "09:00"
    time_end: str = "22:00"
    comment_style: str = "自然"


class DrainTaskUpdate(BaseModel):
    name: Optional[str] = None
    daily_limit: Optional[int] = None
    interval_min: Optional[int] = None
    interval_max: Optional[int] = None
    time_start: Optional[str] = None
    time_end: Optional[str] = None
    comment_style: Optional[str] = None
    keywords: Optional[list[str]] = None
    target_account_ids: Optional[list[int]] = None


class DrainTaskResponse(BaseModel):
    id: int
    account_id: Optional[int] = None
    name: str
    task_type: str
    status: str
    keywords: Optional[list] = None
    target_account_ids: Optional[list] = None
    note_ids: Optional[list] = None
    daily_limit: int
    interval_min: int
    interval_max: int
    time_start: str
    time_end: str
    comment_style: Optional[str] = None
    today_count: int = 0
    total_count: int = 0
    last_run_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 引流记录 ======

class DrainRecordResponse(BaseModel):
    id: int
    task_id: int
    target_note_url: Optional[str] = None
    target_note_title: Optional[str] = None
    target_author: Optional[str] = None
    ai_prompt: Optional[str] = None
    ai_response: Optional[str] = None
    comment_text: Optional[str] = None
    success: bool
    error_msg: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 素材 ======

class MaterialResponse(BaseModel):
    id: int
    file_name: str
    file_path: str
    file_type: str
    file_size: int
    category: str
    tags: Optional[list] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 排期 ======

class ScheduleCreate(BaseModel):
    note_id: int
    publish_at: datetime


class ScheduleResponse(BaseModel):
    id: int
    note_id: Optional[int] = None
    account_id: Optional[int] = None
    product_id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    image_ids: Optional[list] = None
    tags: Optional[list] = None
    publish_at: Optional[datetime] = None
    is_published: bool
    last_error: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 数据分析 ======

class DashboardStats(BaseModel):
    total_notes: int = 0
    total_likes: int = 0
    total_comments: int = 0
    total_collects: int = 0
    today_drains: int = 0
    total_drains: int = 0
    active_tasks: int = 0
    api_calls_today: int = 0


# ====== AI 生成笔记 ======

class AINoteGenerate(BaseModel):
    topic: str
    description: str = ""


class AIProductNoteBatch(BaseModel):
    """按产品库批量生成笔记草稿"""
    account_id: int
    product_ids: list[int]
    count_per_product: int = 1
    description: str = ""


# ====== 通用 ======

class MessageResponse(BaseModel):
    message: str


# ====== 知识库 ======

class KnowledgeBaseCreate(BaseModel):
    title: str = Field(max_length=300)
    content: str
    category: str = "通用"
    keywords: list[str] = []
    tags: list[str] = []
    images: list[str] = []


class KnowledgeBaseUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    keywords: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    images: Optional[list[str]] = None


class KnowledgeBaseResponse(BaseModel):
    id: int
    title: str
    content: str
    category: str
    keywords: Optional[list] = None
    tags: Optional[list] = None
    images: Optional[list] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ====== 评论回复日志 ======

class CommentLogCreate(BaseModel):
    note_url: str = Field(max_length=500)
    note_title: str = Field(max_length=300)
    target_author: str = Field(max_length=200)
    target_comment: str
    reply_text: str
    screenshot_url: str = ""
    source: str = "extension"
    status: str = "sent"


class CommentLogResponse(BaseModel):
    id: int
    note_url: str
    note_title: str
    target_author: str
    target_comment: str
    reply_text: str
    screenshot_url: Optional[str] = None
    source: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ====== 话术库 ======

class ScriptLibraryCreate(BaseModel):
    role: str = Field(max_length=100)
    scenario: str = Field(max_length=100)
    title: str = Field(max_length=300)
    content: str
    tags: list[str] = []


class ScriptLibraryUpdate(BaseModel):
    role: Optional[str] = None
    scenario: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[list[str]] = None
    is_active: Optional[bool] = None


class ScriptLibraryResponse(BaseModel):
    id: int
    role: str
    scenario: str
    title: str
    content: str
    tags: Optional[list] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

