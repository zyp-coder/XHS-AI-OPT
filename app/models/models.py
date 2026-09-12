"""数据库模型定义"""

import enum

from datetime import datetime

from sqlalchemy import (

    Column, Integer, String, Text, DateTime, Float, Boolean, Enum,

    ForeignKey, JSON, create_engine, UniqueConstraint

)

from sqlalchemy.orm import DeclarativeBase, relationship

from config import DATABASE_URL





class Base(DeclarativeBase):

    pass





# ---------- 枚举 ----------



class TaskType(str, enum.Enum):

    """引流任务类型"""

    SELF_REPLY = "self_reply"        # 自营笔记自动回复

    KEYWORD_INTERCEPT = "keyword"    # 关键词截流

    ACCOUNT_TRACK = "account"        # 账号追踪





class TaskStatus(str, enum.Enum):

    """任务状态"""

    RUNNING = "running"

    PAUSED = "paused"

    STOPPED = "stopped"





class NoteStatus(str, enum.Enum):

    """笔记状态"""

    DRAFT = "draft"

    PUBLISHED = "published"





class CommentDirection(str, enum.Enum):

    """评论方向"""

    RECEIVED = "received"   # 收到的评论

    SENT = "sent"          # 发出的评论


class ConversationStatus(str, enum.Enum):
    """会话/客户销售状态"""
    CHUNTING = "chunting"        # 触达中(默认)
    SELLING = "selling"          # 销售中
    WON = "won"                  # 已成单
    COMPLETED = "completed"      # 已完成(交付完毕)
    FOLLOWUP = "followup"        # 需跟进(7-15天无互动/变冷淡)
    LOST = "lost"                # 流失


class MessageDirection(str, enum.Enum):
    """消息方向"""
    THEM = "them"    # 对方发送
    ME = "me"        # 我方发送





# ---------- 账号 ----------



class Account(Base):

    __tablename__ = "accounts"



    id = Column(Integer, primary_key=True, autoincrement=True)

    nickname = Column(String(100), comment="小红书昵称")

    phone = Column(String(20), comment="手机号")

    cookies = Column(Text, comment="Cookies JSON")

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.now)

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)



    # 关系

    notes = relationship("Note", back_populates="account")

    drain_tasks = relationship("DrainTask", back_populates="account")





# ---------- 笔记 ----------



class Note(Base):

    __tablename__ = "notes"



    id = Column(Integer, primary_key=True, autoincrement=True)

    account_id = Column(Integer, ForeignKey("accounts.id"))

    product_id = Column(Integer, ForeignKey("knowledge_base.id"), nullable=True, comment="所属产品(知识库ID)")

    xhs_note_id = Column(String(100), unique=True, comment="小红书笔记ID")

    title = Column(String(300), comment="标题")

    content = Column(Text, comment="正文")

    images = Column(JSON, comment="图片列表")

    tags = Column(JSON, comment="话题标签")

    status = Column(Enum(NoteStatus), default=NoteStatus.PUBLISHED)

    views = Column(Integer, default=0)

    likes = Column(Integer, default=0)

    comments_count = Column(Integer, default=0)

    collects = Column(Integer, default=0)

    shares = Column(Integer, default=0)

    published_at = Column(DateTime, comment="发布时间")

    created_at = Column(DateTime, default=datetime.now)

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)



    # 关系

    account = relationship("Account", back_populates="notes")

    comments = relationship("Comment", back_populates="note")





# ---------- 评论 ----------



class Comment(Base):

    __tablename__ = "comments"



    id = Column(Integer, primary_key=True, autoincrement=True)

    note_id = Column(Integer, ForeignKey("notes.id"))

    xhs_comment_id = Column(String(100), unique=True, comment="小红书评论ID")

    direction = Column(Enum(CommentDirection), comment="评论方向")

    author_name = Column(String(100), comment="评论者昵称")

    content = Column(Text, comment="评论内容")

    reply_content = Column(Text, comment="回复内容")

    ai_generated = Column(Boolean, default=False, comment="是否AI生成")

    sentiment = Column(String(20), comment="情感分析结果")

    commented_at = Column(DateTime, comment="评论时间")

    created_at = Column(DateTime, default=datetime.now)



    # 关系

    note = relationship("Note", back_populates="comments")





# ---------- AI 配置 ----------



class AIConfig(Base):

    __tablename__ = "ai_config"



    id = Column(Integer, primary_key=True, autoincrement=True)

    api_key = Column(String(500), comment="API Key (加密存储)")

    api_base_url = Column(String(300), default="https://dashscope.aliyuncs.com/compatible-mode/v1")

    model = Column(String(100), default="qwen-plus")

    temperature = Column(Float, default=0.8)

    max_tokens = Column(Integer, default=500)

    # 备用模型（主模型不可用时自动切换）
    fallback_api_key = Column(String(500), nullable=True, comment="备用 API Key")
    fallback_api_base_url = Column(String(300), nullable=True, comment="备用 API Base URL")
    fallback_model = Column(String(100), nullable=True, comment="备用模型名称")

    created_at = Column(DateTime, default=datetime.now)

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)





# ---------- Prompt 模板 ----------



class AIPrompt(Base):

    __tablename__ = "ai_prompts"



    id = Column(Integer, primary_key=True, autoincrement=True)

    scene = Column(String(50), unique=True, comment="场景标识")

    scene_name = Column(String(100), comment="场景名称")

    system_prompt = Column(Text, comment="系统提示词")

    user_prompt_template = Column(Text, comment="用户提示词模板")

    is_default = Column(Boolean, default=True, comment="是否默认")

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)





# ---------- AI 调用日志 ----------



class PromptLog(Base):

    __tablename__ = "prompt_logs"



    id = Column(Integer, primary_key=True, autoincrement=True)

    scene = Column(String(50), comment="场景")

    prompt = Column(Text, comment="完整提示词")

    response = Column(Text, comment="AI 响应")

    tokens_in = Column(Integer, default=0)

    tokens_out = Column(Integer, default=0)

    model = Column(String(100))

    duration_ms = Column(Integer, comment="耗时毫秒")

    success = Column(Boolean, default=True)

    error_msg = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.now)





# ---------- 评论回复日志 ----------

class CommentLog(Base):
    """评论回复日志"""
    __tablename__ = "comment_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    note_url = Column(String(500), comment="笔记链接")
    note_title = Column(String(300), comment="笔记标题")
    target_author = Column(String(200), comment="目标用户")
    target_comment = Column(Text, comment="目标评论")
    reply_text = Column(Text, comment="回复内容")
    screenshot_url = Column(String(500), default="", comment="截图链接")
    source = Column(String(50), default="extension", comment="来源")
    status = Column(String(20), default="sent", comment="状态")
    created_at = Column(DateTime, default=datetime.now)


# ---------- 目标账号 ----------



class TargetAccount(Base):

    __tablename__ = "target_accounts"



    id = Column(Integer, primary_key=True, autoincrement=True)

    xhs_user_id = Column(String(100), comment="小红书用户ID")

    nickname = Column(String(100), comment="昵称")

    note_url = Column(String(500), comment="主页链接")

    category = Column(String(50), comment="分类:agent/compete")

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.now)

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)





# ---------- 目标关键词 ----------



class TargetKeyword(Base):

    __tablename__ = "target_keywords"



    id = Column(Integer, primary_key=True, autoincrement=True)

    keyword = Column(String(100), comment="关键词")

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.now)





# ---------- 引流任务 ----------



class DrainTask(Base):

    __tablename__ = "drain_tasks"



    id = Column(Integer, primary_key=True, autoincrement=True)

    account_id = Column(Integer, ForeignKey("accounts.id"))

    name = Column(String(200), comment="任务名称")

    task_type = Column(Enum(TaskType, values_callable=lambda x: [e.value for e in x]), comment="任务类型")

    status = Column(Enum(TaskStatus, values_callable=lambda x: [e.value for e in x]), default=TaskStatus.STOPPED)



    # 关键词截流配置

    keywords = Column(JSON, comment="关键词列表")

    # 账号追踪配置

    target_account_ids = Column(JSON, comment="目标账号ID列表")

    # 自营笔记配置

    note_ids = Column(JSON, comment="笔记ID列表")



    # 通用配置

    daily_limit = Column(Integer, default=50, comment="每日操作上限")

    interval_min = Column(Integer, default=30, comment="操作间隔最小值(秒)")

    interval_max = Column(Integer, default=120, comment="操作间隔最大值(秒)")

    time_start = Column(String(10), default="09:00", comment="开始时段")

    time_end = Column(String(10), default="22:00", comment="结束时段")

    comment_style = Column(String(100), default="自然", comment="评论风格")

    today_count = Column(Integer, default=0, comment="今日已执行次数")

    total_count = Column(Integer, default=0, comment="总执行次数")

    last_run_at = Column(DateTime, nullable=True, comment="最后执行时间")

    created_at = Column(DateTime, default=datetime.now)

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)



    # 关系

    account = relationship("Account", back_populates="drain_tasks")

    records = relationship("DrainRecord", back_populates="task")





# ---------- 引流执行记录 ----------



class DrainRecord(Base):

    __tablename__ = "drain_records"



    id = Column(Integer, primary_key=True, autoincrement=True)

    task_id = Column(Integer, ForeignKey("drain_tasks.id"))

    target_note_url = Column(String(500), comment="目标笔记链接")

    target_note_title = Column(String(300), comment="目标笔记标题")

    target_author = Column(String(100), comment="目标笔记作者")

    ai_prompt = Column(Text, comment="AI 提示词")

    ai_response = Column(Text, comment="AI 生成的评论内容")

    comment_text = Column(Text, comment="实际发布的评论")

    success = Column(Boolean, default=True)

    error_msg = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.now)



    # 关系

    task = relationship("DrainTask", back_populates="records")





# ---------- 素材 ----------



class Material(Base):

    __tablename__ = "materials"



    id = Column(Integer, primary_key=True, autoincrement=True)

    file_name = Column(String(200), comment="文件名")

    file_path = Column(String(500), comment="文件路径")

    file_type = Column(String(20), comment="文件类型:image/video")

    file_size = Column(Integer, comment="文件大小(字节)")

    category = Column(String(50), default="通用", comment="分类")

    tags = Column(JSON, comment="标签")

    created_at = Column(DateTime, default=datetime.now)





# ---------- 排期任务 ----------



class Schedule(Base):

    __tablename__ = "schedules"



    id = Column(Integer, primary_key=True, autoincrement=True)

    note_id = Column(Integer, ForeignKey("notes.id"), nullable=True)

    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, comment="发布账号")

    product_id = Column(Integer, ForeignKey("knowledge_base.id"), nullable=True, comment="所属产品(知识库ID)")

    title = Column(String(300), comment="标题")

    content = Column(Text, comment="正文")

    image_ids = Column(JSON, comment="素材ID列表")

    tags = Column(JSON, comment="话题标签")

    publish_at = Column(DateTime, comment="定时发布时间")

    last_error = Column(Text, nullable=True, comment="上次发布失败原因")

    is_published = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.now)

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)





# ---------- 系统设置 ----------



class Setting(Base):

    __tablename__ = "settings"



    id = Column(Integer, primary_key=True, autoincrement=True)

    key = Column(String(100), unique=True, comment="配置键")

    value = Column(Text, comment="配置值")

    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)





# ---------- 知识库 ----------

class KnowledgeBase(Base):
    """知识库条目"""
    __tablename__ = "knowledge_base"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(300), nullable=False, comment="标题")
    content = Column(Text, nullable=False, comment="内容")
    category = Column(String(50), default="通用", comment="分类: 个人经历/专业知识/政策/通用")
    keywords = Column(JSON, default=list, comment="关键词")
    tags = Column(JSON, default=list, comment="标签")
    images = Column(JSON, default=list, comment="截图列表")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ---------- 话术库 ----------

class ScriptLibrary(Base):
    """话术库模板"""
    __tablename__ = "script_library"

    id = Column(Integer, primary_key=True, autoincrement=True)
    role = Column(String(100), nullable=False, comment="角色: 中介/装修博主/房贷科普博主/普通用户")
    scenario = Column(String(100), nullable=False, comment="场景: 评论回复/私信触达/截流评论")
    title = Column(String(300), nullable=False, comment="标题")
    content = Column(Text, nullable=False, comment="话术内容")
    tags = Column(JSON, default=list, comment="标签")
    is_active = Column(Boolean, default=True, comment="是否启用")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ---------- 消息中心：会话 ----------

class Conversation(Base):
    """私信会话（消息工作台的数据主语，由扩展从小红书同步）"""
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("product", "conv_id", name="uq_conv_product_conv"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    product = Column(String(200), default="", comment="所属产品/租户名")
    conv_id = Column(String(200), comment="小红书会话ID")
    partner_id = Column(String(200), default="", comment="对方小红书userId")
    partner_name = Column(String(200), default="", comment="对方昵称")
    avatar = Column(String(500), default="", comment="头像URL")
    source = Column(String(50), default="", comment="来源: 关键词截流/评论/点赞/私信触达/主动进线")
    note_title = Column(String(300), default="", comment="来源笔记标题")
    note_url = Column(String(500), default="", comment="来源笔记链接")

    # 销售状态（多级 + 半自动）
    status = Column(Enum(ConversationStatus, values_callable=lambda x: [e.value for e in x]), default=ConversationStatus.CHUNTING)
    status_source = Column(String(20), default="manual", comment="状态来源: manual/ai/rule")
    suggested_status = Column(Enum(ConversationStatus, values_callable=lambda x: [e.value for e in x]), nullable=True, default=None, comment="AI/规则建议状态(待人工确认)")
    suggested_reason = Column(Text, default="", comment="建议理由")

    # 意图
    intent = Column(String(30), default="other", comment="意图: logistics/product_detail/suitability/price_compare/order/chat/other")
    intent_confidence = Column(Float, default=0.0)
    intent_reason = Column(Text, default="")
    intent_at = Column(DateTime, nullable=True)

    # AI 标签（只打标、不筛选；所有会话始终保留可见）
    label = Column(String(20), default="", comment="AI标签: 有效商机/待定/无效/待复核，仅用于展示")
    label_at = Column(DateTime, nullable=True)

    # 激活/流失机制（按 last_at 时间驱动）
    lost_at = Column(DateTime, nullable=True, comment="被判定流失(对方N天未回)的时间")

    # 会话态（轻量字段）
    last_msg = Column(Text, default="")
    last_from = Column(String(10), default="", comment="最后说话方: them/me")
    last_at = Column(DateTime, nullable=True)
    unread_count = Column(Integer, default=0)
    dm_count = Column(Integer, default=0, comment="我方已发私信条数")
    last_dm_at = Column(DateTime, nullable=True)
    them_replied = Column(Boolean, default=False, comment="对方是否回过")
    direction = Column(String(20), default="outbound", comment="会话方向: inbound/outbound")
    ai_tag = Column(String(50), default="", comment="AI备注/标签")

    # 同步
    fp = Column(String(200), default="", comment="最近一次同步指纹(用于diff判断是否有更新)")
    sync_at = Column(DateTime, nullable=True, comment="最近轻量同步时间")
    full_synced_at = Column(DateTime, nullable=True, comment="最近完整消息同步时间")

    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    messages = relationship("Message", back_populates="conversation")


# ---------- 消息中心：单条消息 ----------

class Message(Base):
    """会话内的单条消息时间线"""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), index=True)
    xhs_msg_id = Column(String(200), default="", comment="小红书消息ID(可用于去重)")
    direction = Column(Enum(MessageDirection, values_callable=lambda x: [e.value for e in x]), comment="方向: them=对方/me=我方")
    author = Column(String(200), default="", comment="消息作者昵称")
    text = Column(Text, default="")
    msg_at = Column(DateTime, nullable=True, comment="消息时间")
    received_at = Column(DateTime, default=datetime.now, comment="入库时间")
    ai_generated = Column(Boolean, default=False, comment="是否AI生成")
    sent_at = Column(DateTime, nullable=True, comment="我方实际发送时间")

    conversation = relationship("Conversation", back_populates="messages")


# ---------- 消息中心：意图快捷回复模板 ----------

class IntentionTemplate(Base):
    """按意图配置的快捷回复话术模板"""
    __tablename__ = "intention_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    intent = Column(String(30), default="other", comment="意图: logistics/product_detail/suitability/price_compare/order/chat/other")
    title = Column(String(300), default="", comment="标题")
    content = Column(Text, default="", comment="话术内容(支持 {name} 等占位)")
    product = Column(String(200), default="", comment="所属产品/租户名")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ---------- 消息中心：发送任务(出站队列，Web创建→扩展拉取执行→回写) ----------

class SendTask(Base):
    """待发送私信队列：Web端一键发送后在此排队，扩展轮询拉取并用 chatSendMessage 真实发出"""
    __tablename__ = "send_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), index=True)
    partner_id = Column(String(200), default="", comment="对方userId(扩展发送时用 openUid 直达)")
    text = Column(Text, default="")
    status = Column(String(20), default="pending", comment="状态: pending/sent/failed")
    created_at = Column(DateTime, default=datetime.now, comment="创建时间")
    picked_at = Column(DateTime, nullable=True, comment="扩展拉取时间")
    sent_at = Column(DateTime, nullable=True, comment="实际发送时间")
    error_msg = Column(Text, default="")


# ---------- 客户邮箱线索（AI客服检测到用户留邮箱后由扩展上报） ----------
class CustomerLead(Base):
    """已留邮箱的客户线索（用于后续打包资料发给客户 + 通知客户）"""
    __tablename__ = "customer_leads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    xhs_user_id = Column(String(200), comment="小红书用户ID")
    nickname = Column(String(200), comment="昵称")
    email = Column(String(200), nullable=False, comment="客户留下的邮箱")
    email_source_text = Column(Text, default="", comment="检测到邮箱的原文（上下文）")
    detected_scene = Column(String(50), default="chat_follow", comment="检测到邮箱的 AI客服场景")
    product = Column(String(200), default="", comment="所属产品/租户名")
    note_title = Column(String(300), default="", comment="来源笔记标题")
    note_url = Column(String(500), default="", comment="来源笔记链接")
    pack_status = Column(String(20), default="pending", comment="打包状态: pending(未打包)/packed(已打包)")
    pack_batch = Column(String(100), default="", comment="打包批次号")
    pack_at = Column(DateTime, nullable=True, comment="打包时间")
    notify_status = Column(String(20), default="pending", comment="通知状态: pending(未通知)/notified(已通知)")
    notify_at = Column(DateTime, nullable=True, comment="通知时间")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ---------- 初始化数据库 ----------



engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})





def init_db():

    """创建所有表并插入默认数据"""

    Base.metadata.create_all(engine)

    # 迁移：给已有 ai_config 表加备用模型字段
    import sqlalchemy as sa
    with engine.connect() as conn:
        inspector = sa.inspect(engine)
        existing_cols = {c['name'] for c in inspector.get_columns('ai_config')}
        for col_name, col_type in [
            ('fallback_api_key', 'VARCHAR(500)'),
            ('fallback_api_base_url', 'VARCHAR(300)'),
            ('fallback_model', 'VARCHAR(100)'),
        ]:
            if col_name not in existing_cols:
                conn.execute(sa.text(f'ALTER TABLE ai_config ADD COLUMN {col_name} {col_type}'))
                print(f'[init_db] 已迁移 ai_config.{col_name}')
        conn.commit()

    with engine.connect() as conn:
        inspector = sa.inspect(engine)
        # notes.product_id（所属产品/知识库）
        if 'notes' in inspector.get_table_names():
            note_cols = {c['name'] for c in inspector.get_columns('notes')}
            if 'product_id' not in note_cols:
                conn.execute(sa.text('ALTER TABLE notes ADD COLUMN product_id INTEGER'))
                print('[init_db] 已迁移 notes.product_id')
        # messages 中心：conversations 新增列
        if 'conversations' in inspector.get_table_names():
            cc = {c['name'] for c in inspector.get_columns('conversations')}
            for col_name, col_type in [
                ('label', 'VARCHAR(20)'),
                ('label_at', 'DATETIME'),
                ('lost_at', 'DATETIME'),
            ]:
                if col_name not in cc:
                    conn.execute(sa.text(f'ALTER TABLE conversations ADD COLUMN {col_name} {col_type}'))
                    print(f'[init_db] 已迁移 conversations.{col_name}')
        # schedules.account_id / product_id / last_error
        if 'schedules' in inspector.get_table_names():
            sched_cols = {c['name'] for c in inspector.get_columns('schedules')}
            for col_name, col_type in [
                ('account_id', 'INTEGER'),
                ('product_id', 'INTEGER'),
                ('last_error', 'TEXT'),
            ]:
                if col_name not in sched_cols:
                    conn.execute(sa.text(f'ALTER TABLE schedules ADD COLUMN {col_name} {col_type}'))
                    print(f'[init_db] 已迁移 schedules.{col_name}')
        conn.commit()

    from sqlalchemy.orm import Session

    session = Session(engine)



    # 默认 Prompt 模板

    from app.core.ai_engine import ai_engine
    default_prompts = ai_engine._get_default_prompts()

    # 插入/更新默认 Prompt
    for p in default_prompts:
        existing = session.query(AIPrompt).filter_by(scene=p["scene"]).first()
        if existing:
            existing.system_prompt = p["system_prompt"]
            existing.user_prompt_template = p["user_prompt_template"]
            existing.scene_name = p["scene_name"]
            existing.is_default = True
        else:
            session.add(AIPrompt(**p))
    session.commit()
    print(f"[init_db] 已同步 {len(default_prompts)} 个默认 Prompt")
