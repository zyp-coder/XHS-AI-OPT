"""AI 引擎 - LLM 调用 + Prompt 管理"""
import json
import time
import hashlib
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_, cast, String
from openai import OpenAI

from app.models.models import AIConfig, AIPrompt, PromptLog, KnowledgeBase, ScriptLibrary, engine
from app.models.models import init_db  # 用于重置默认 Prompt


class AIEngine:
    """AI 引擎，管理 LLM 调用和 Prompt 渲染
    
    支持主备模型切换：优先使用主模型（免费模型），失败时自动切换到备用模型（如 DS）。
    """

    def __init__(self):
        self._client = None
        self._config = None
        self._fallback_client = None
        self._fallback_config = None
        self._loaded = False
        self._using_fallback = False  # 当前是否在用备用模型

    def _ensure_loaded(self):
        """延迟加载配置"""
        if self._loaded:
            return
        self._loaded = True
        self._load_config()

    def _load_config(self):
        """从数据库加载 AI 配置（主模型 + 备用模型）"""
        with Session(engine) as session:
            config = session.query(AIConfig).first()
            if config and config.api_key:
                self._config = {
                    "api_key": config.api_key,
                    "api_base_url": config.api_base_url,
                    "model": config.model,
                    "temperature": config.temperature,
                    "max_tokens": config.max_tokens,
                }
                self._client = OpenAI(
                    api_key=config.api_key,
                    base_url=config.api_base_url,
                )
            elif config:
                # 有配置行但还没填 Key：仍然暴露 base_url/model，方便设置页回显
                self._config = {
                    "api_key": None,
                    "api_base_url": config.api_base_url,
                    "model": config.model,
                    "temperature": config.temperature,
                    "max_tokens": config.max_tokens,
                }
                self._client = None
            else:
                self._config = None
                self._client = None

            # 加载备用模型配置
            if config and config.fallback_api_base_url and config.fallback_model:
                self._fallback_config = {
                    "api_key": config.fallback_api_key,
                    "api_base_url": config.fallback_api_base_url,
                    "model": config.fallback_model,
                    "temperature": config.temperature,
                    "max_tokens": config.max_tokens,
                }
                if config.fallback_api_key:
                    self._fallback_client = OpenAI(
                        api_key=config.fallback_api_key,
                        base_url=config.fallback_api_base_url,
                    )
                else:
                    self._fallback_client = None
            else:
                self._fallback_config = None
                self._fallback_client = None

    def is_configured(self) -> bool:
        """检查 AI 是否已配置（主模型或备用模型任一可用）"""
        self._ensure_loaded()
        return self._client is not None or self._fallback_client is not None

    def get_config(self) -> Optional[dict]:
        """获取当前配置（不含 API Key）"""
        self._ensure_loaded()
        if not self._config and not self._fallback_config:
            return None
        result = {}
        if self._config:
            result = {
                "api_base_url": self._config["api_base_url"],
                "model": self._config["model"],
                "temperature": self._config["temperature"],
                "max_tokens": self._config["max_tokens"],
                "has_key": bool(self._config.get("api_key")),
            }
        if self._fallback_config:
            result["fallback_api_base_url"] = self._fallback_config["api_base_url"]
            result["fallback_model"] = self._fallback_config["model"]
            result["has_fallback_key"] = bool(self._fallback_config.get("api_key"))
        else:
            result["fallback_api_base_url"] = ""
            result["fallback_model"] = ""
            result["has_fallback_key"] = False
        return result

    def update_config(self, api_key: str, api_base_url: str, model: str,
                      temperature: float, max_tokens: int,
                      fallback_api_key: str = "", fallback_api_base_url: str = "",
                      fallback_model: str = "") -> dict:
        """更新 AI 配置（含备用模型）"""
        with Session(engine) as session:
            config = session.query(AIConfig).first()
            if not config:
                config = AIConfig(api_key=api_key, api_base_url=api_base_url,
                                  model=model, temperature=temperature,
                                  max_tokens=max_tokens,
                                  fallback_api_key=fallback_api_key or None,
                                  fallback_api_base_url=fallback_api_base_url or None,
                                  fallback_model=fallback_model or None)
                session.add(config)
            else:
                config.api_key = api_key
                config.api_base_url = api_base_url
                config.model = model
                config.temperature = temperature
                config.max_tokens = max_tokens
                config.fallback_api_key = fallback_api_key or None
                config.fallback_api_base_url = fallback_api_base_url or None
                config.fallback_model = fallback_model or None
            session.commit()

        # 重载配置
        self._load_config()
        return self.get_config()

    # ----- Prompt 管理 -----

    def get_prompt(self, scene: str) -> Optional[dict]:
        """获取指定场景的 Prompt 模板"""
        with Session(engine) as session:
            prompt = session.query(AIPrompt).filter_by(scene=scene).first()
            if prompt:
                return {
                    "id": prompt.id,
                    "scene": prompt.scene,
                    "scene_name": prompt.scene_name,
                    "system_prompt": prompt.system_prompt,
                    "user_prompt_template": prompt.user_prompt_template,
                    "is_default": prompt.is_default,
                }
            return None

    def get_all_prompts(self) -> list:
        """获取所有 Prompt 模板"""
        with Session(engine) as session:
            prompts = session.query(AIPrompt).all()
            return [
                {
                    "id": p.id,
                    "scene": p.scene,
                    "scene_name": p.scene_name,
                    "system_prompt": p.system_prompt,
                    "user_prompt_template": p.user_prompt_template,
                    "is_default": p.is_default,
                }
                for p in prompts
            ]

    def update_prompt(self, scene: str, system_prompt: str,
                      user_prompt_template: str) -> dict:
        """更新 Prompt 模板"""
        with Session(engine) as session:
            prompt = session.query(AIPrompt).filter_by(scene=scene).first()
            if not prompt:
                raise ValueError(f"场景 '{scene}' 不存在")
            prompt.system_prompt = system_prompt
            prompt.user_prompt_template = user_prompt_template
            prompt.is_default = False
            session.commit()
            return {
                "id": prompt.id,
                "scene": prompt.scene,
                "scene_name": prompt.scene_name,
                "system_prompt": prompt.system_prompt,
                "user_prompt_template": prompt.user_prompt_template,
                "is_default": prompt.is_default,
            }

    def reset_prompt(self, scene: str) -> dict:
        """恢复 Prompt 模板为默认值"""
        # 从 init_db 的默认值中查找
        default_prompts = self._get_default_prompts()
        default = next((p for p in default_prompts if p["scene"] == scene), None)
        if not default:
            raise ValueError(f"场景 '{scene}' 没有默认模板")

        with Session(engine) as session:
            prompt = session.query(AIPrompt).filter_by(scene=scene).first()
            if not prompt:
                raise ValueError(f"场景 '{scene}' 不存在")
            prompt.system_prompt = default["system_prompt"]
            prompt.user_prompt_template = default["user_prompt_template"]
            prompt.is_default = True
            session.commit()
            return {
                "id": prompt.id,
                "scene": prompt.scene,
                "scene_name": prompt.scene_name,
                "system_prompt": prompt.system_prompt,
                "user_prompt_template": prompt.user_prompt_template,
                "is_default": prompt.is_default,
            }

    def _get_default_prompts(self) -> list:
        """获取默认 Prompt 模板列表（从 init_db 提取）"""
        return [
            {
                "scene": "reply_self",
                "scene_name": "自己笔记回复评论",
                "system_prompt": "你是一个感情/趣味测试领域的运营者，乐于助人，回复自然不做作。你的目标是在回复中自然地引导用户了解'慧眼识人助手'趣味测试工具（只提产品名，不写'微信小程序'等站外渠道词、不发链接），但不能显得像广告。回复要简短、亲切、有价值。",
                "user_prompt_template": "【笔记主题】{note_title}\n【用户评论】{comment_content}\n\n请以自然的口吻回复这条评论，像朋友分享一样自然提到'慧眼识人助手'这款趣味测试（只提产品名，不写'微信/小程序'等站外渠道词、不发链接；要带方向就用“我主页/私信我”承接）。回复控制在50字以内。"
            },
            {
                "scene": "intercept_comment",
                "scene_name": "同类笔记截流评论",
                "system_prompt": "你是一个普通的年轻用户，对感情话题、趣味测试、世界杯很感兴趣。你说话自然真实，像普通人一样分享自己的经历和想法。你的评论要与笔记内容相关，看起来是真实用户的观点分享。",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n\n请以普通用户的身份写一条评论，评论要自然相关，可以分享自己做趣味测试的体验，自然提到'慧眼识人助手'这款趣味测试（只提产品名，不写'小程序'等站外渠道词、不发链接，导流用“看主页/私信”承接）。评论控制在60字以内。"
            },
            {
                "scene": "agent_comment",
                "scene_name": "中介笔记精准评论",
                "system_prompt": "你是一个对感情/趣味测试感兴趣的普通用户。你会以真实用户的身份评论，分享自己的真实感受。评论要显得真诚、有兴趣。",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n\n请以真实用户的身份评论这条笔记，可以表达兴趣、提问或分享类似经历。在合适的时候自然提到你用'慧眼识人助手'测过鉴渣/海王指数或世界杯球星匹配（只提产品名，不写'小程序'等站外渠道词、不发链接）。评论控制在60字以内。"
            },
            {
                "scene": "generate_note",
                "scene_name": "AI生成笔记文案",
                "system_prompt": "你是一个趣味测试/感情领域的小红书创作者，擅长写小红书笔记。你的文案风格真实、接地气、有干货，能引起读者共鸣。标题要有吸引力，正文要有价值，标签要精准。",
                "user_prompt_template": "【创作主题】{topic}\n【补充说明】{description}\n\n请生成一篇小红书笔记，包含：\n1. 吸引人的标题\n2. 正文内容（200字以内，分段清晰）\n3. 话题标签（5-8个）\n\n注意：文案要真实自然，像普通用户分享经验。"
            },
            {
                "scene": "generate_note_from_product",
                "scene_name": "按产品库生成笔记草稿",
                "system_prompt": "你是一个小红书创作者，根据产品资料撰写真实、接地气、有干货的种草笔记。标题要有吸引力，正文要有价值、分段清晰，标签要精准。文案要像普通用户分享经验，不能像硬广。",
                "user_prompt_template": "【产品名称】{title}\n【产品资料】{content}\n【产品标签参考】{tags}\n【补充要求】{description}\n\n请围绕这个产品写一篇小红书笔记，严格只返回以下 JSON 格式（不要加任何其他内容、不要用代码块）：\n{\"title\": \"吸引人的标题(20字以内)\", \"content\": \"正文(150-250字，分段清晰，自然种草)\", \"tags\": [\"话题标签\", \"5到8个\"]}"
            },
            {
                "scene": "analyze_comment",
                "scene_name": "评论意图分析",
                "system_prompt": "你是一个社交媒体运营专家，擅长分析用户评论的意图和情感。你需要判断评论的类型和情感倾向，并给出回复建议。",
                "user_prompt_template": "【评论内容】{comment_content}\n\n请分析这条评论，返回JSON格式：\n1. sentiment: 情感倾向（positive/negative/neutral）\n2. intent: 评论意图（咨询/质疑/认同/闲聊/广告/其他）\n3. reply_suggestion: 是否建议回复（是/否）\n4. reply_tip: 回复要点提示"
            },
            {
                "scene": "comment_assistant",
                "scene_name": "评论助手（插件用）",
                "system_prompt": "你是一个感情/趣味测试领域的运营专家，擅长写小红书评论回复。你的任务是针对笔记下的每一条评论，生成自然、有温度的回复建议。\n\n核心原则：\n1. 回复要像真人说的，短小精悍，20-50字\n2. 根据评论内容针对性回复，不要套话\n3. 对咨询类评论提供有价值的信息\n4. 对认同类评论表示感谢和共鸣\n5. 在合适的时机自然提到'慧眼识人助手'小程序，但不要每条都提\n6. 绝对不要看起来像广告",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n【评论者】{comment_author}\n【评论内容】{comment_content}\n\n请针对这条评论生成一条回复建议。要求：\n1. 自然口语化，像真人回复\n2. 针对评论内容具体回应\n3. 20-50字\n4. 如果合适可以自然提到'慧眼识人助手'小程序的鉴渣/海王/世界杯球星测试\n\n直接回复文本，不要加引号。"
            },
            {
                "scene": "opportunity_finder",
                "scene_name": "商机发现（插件用）",
                "system_prompt": "你是一个进攻型的趣味测试运营专家，正在小红书评论区「敏锐地寻找每一个商机」。\n\n你的任务：\n1. 仔细阅读笔记内容和所有评论（包括多轮对话）\n2. 找出「有商业价值的商机」——用户表现出需求、痛点、疑问、兴趣、纠结、求助的地方\n3. 只找用户之间讨论中的商机，不要只看笔记作者（UP主）的回复\n4. 对每个商机：理解整个对话上下文（谁回复了谁），然后给出可以直接留言插入的回复\n5. **要敏锐！** 任何提及渣男、渣女、海王、绿茶、PUA、感情测试、世界杯、球星、面相、手相等关键词都可能是商机\n6. **只返回 Top 3 最有价值的商机**，宁缺毋滥\n7. 如果确实没有商机，诚实返回 has_opportunity=false\n\n注意：宁可漏过也不要牵强。商机 = 用户主动表现出对感情测试/趣味测试/世界杯球星测试相关话题的真实需求和兴趣。",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n【笔记作者】{note_author}\n【评论区（共{comment_count}条）】\n{comments_text}\n\n请分析以上评论区，找出最有价值的 Top 3 商机。\n\n要求：\n1. 只返回 Top 3（1-3个），按价值从高到低排序\n2. 对每个商机，提供它所在的完整对话上下文（多轮回复内容）\n3. 直接生成一条可以插嘴回复的话\n4. 要在回复中自然地提到「慧眼识人助手」小程序能帮测鉴渣/海王指数或匹配世界杯球星\n\n请严格按照以下 JSON 格式回复（不要加其他内容）：\n{\"opportunities\": [{\"comment_index\": 0, \"position\": \"评论区中部\", \"author\": \"用户名\", \"original_comment\": \"用户的原文\", \"conversation_context\": \"这里是完整的对话上下文，包括其他人回复这条评论的内容...\", \"opportunity\": \"商机描述：为什么这是商机\", \"suggested_reply\": \"针对这条评论的回复内容\"}], \"summary\": \"评论区整体情况概括\", \"has_opportunity\": true}\n\n如果没有商机，返回: {\"opportunities\": [], \"summary\": \"...\", \"has_opportunity\": false}"
            },
            {
                "scene": "comment_analysis",
                "scene_name": "评论分析（插件用）",
                "system_prompt": "你是一个社交媒体数据分析师，擅长从评论区提取多维度的用户洞察。\n\n分析笔记的评论区，给出以下精确分析：\n1. 整体情感倾向（正面/负面/中性）\n2. 评论总数和参与讨论的用户数\n3. 话题分布：大家聊了什么话题，每个话题有多少条评论，这个话题在评论区的什么位置（上部/中部/下部），谁说的代表性内容是什么\n4. 最热门的话题是哪个，在什么位置，是谁说的\n5. 用户共性的痛点和需求\n6. 对每一条评论打标签：判断它属于哪个话题，生成话题标签",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n【评论区（共{comment_count}条）】\n{comments_text}\n\n请分析以上评论区，严格按照以下 JSON 格式回复：\n{\n  \"overall_sentiment\": \"正面/负面/中性\",\n  \"total_comments\": 35,\n  \"participant_count\": 28,\n  \"topic_distribution\": [\n    {\"topic\": \"渣男鉴定\", \"count\": 12, \"position\": \"评论区上部\", \"representative_author\": \"用户名\", \"representative_content\": \"代表性评论内容\"},\n    {\"topic\": \"世界杯球星\", \"count\": 8, \"position\": \"评论区中部\", \"representative_author\": \"用户名\", \"representative_content\": \"代表性评论内容\"}\n  ],\n  \"hottest_topic\": {\n    \"topic\": \"渣男鉴定\",\n    \"count\": 12,\n    \"position\": \"评论区上部\",\n    \"who_said\": \"用户名\",\n    \"content\": \"代表性评论内容\"\n  },\n  \"pain_points\": [\"痛点1\", \"痛点2\"],\n  \"interested_users\": [\"用户名1\", \"用户名2\"],\n  \"tagged_comments\": [\n    {\"index\": 0, \"tags\": [\"渣男\", \"鉴渣\"], \"topic\": \"鉴渣鉴定\"},\n    {\"index\": 1, \"tags\": [\"世界杯\"], \"topic\": \"世界杯球星测试\"}\n  ],\n  \"summary\": \"评论区整体情况概述（50字以内）\"\n}"
            },
            {
                "scene": "topic_analysis",
                "scene_name": "话题分析（插件用）",
                "system_prompt": "你是一个社交媒体话题分析师，擅长从小红书评论区的话题讨论中提炼洞察。\n\n你的任务：\n1. 分析一个具体的话题（一条一级评论 + 它下面的所有二级回复）\n2. 用一两句话概括这个话题在聊什么\n3. 根据回复数量、讨论深度、情感强度，评估这个话题的热门度\n4. 判断针对「慧眼识人助手」这个AI趣味性格测试微信小程序（含7套题库+世界杯球星测试），有没有创作插画/图文内容的切入空间",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n【笔记作者】{note_author}\n\n【话题发起人】{topic_author}\n【话题内容】{topic_content}\n【回复讨论（共{reply_count}条）】\n{replies_text}\n\n请分析以上话题讨论，严格按照以下 JSON 格式回复（不要加其他内容）：\n{\n  \"summary\": \"话题摘要（30字以内）\",\n  \"popularity\": \"高/中/低\",\n  \"popularity_reason\": \"热门度分析原因\",\n  \"illustration_opportunity\": \"有/可能有/暂无\",\n  \"illustration_detail\": \"具体的插画/内容创作切入建议\"\n}"
            },
            {
                "scene": "full_analysis",
                "scene_name": "完整评论分析（含商机+提示词）",
                "system_prompt": "你是一个社交媒体数据分析师兼内容营销专家，擅长从小红书评论区发现用户洞察、商业机会和内容创作灵感。",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n【笔记作者】{note_author}\n\n【评论区（共{comment_count}条）】\n{comments_text}\n\n请全面分析以上评论区，严格按照以下 JSON 格式回复（只返回 JSON，不要加其他内容）：\n{\n  \"overall_sentiment\": \"正面/负面/中性\",\n  \"total_comments\": 35,\n  \"participant_count\": 28,\n  \"summary\": \"评论区整体情况概述（40字以内）\",\n  \"hottest_topic\": {\n    \"topic\": \"最热门的话题名称\",\n    \"count\": 12,\n    \"position\": \"评论区上部/中部/下部\",\n    \"who_said\": \"代表性用户昵称\",\n    \"content\": \"代表性评论内容\",\n    \"analysis\": \"为什么这个话题最热，用户在表达什么情绪和需求（30字以内）\",\n    \"popularity_reason\": \"热门原因分析\"\n  },\n  \"opportunities\": [\n    {\n      \"index\": 0,\n      \"author\": \"用户名\",\n      \"content\": \"用户的原文\",\n      \"opportunity\": \"商机描述：为什么这是商机（20字以内）\",\n      \"suggested_reply\": \"针对这条评论可以回复的话，自然提到慧眼识人助手（40字以内）\"\n    }\n  ],\n  \"prompt_suggestions\": [\n    {\n      \"type\": \"选题建议/互动话术/内容创作\",\n      \"title\": \"提示词标题\",\n      \"content\": \"具体的文案或话术内容（60字以内）\",\n      \"target_scenario\": \"适用场景说明\"\n    }\n  ]\n}\n\n要求：\n1. opportunities 只返回 Top 3 最有价值的商机\n2. prompt_suggestions 返回 3 条，基于评论区最热的讨论话题生成\n3. 所有内容围绕「慧眼识人助手」趣味测试工具定位（AI趣味性格测试+面相手相分析工具）\n4. 如果没有商机，opportunities 返回空数组，不要编造"
            },
            {
                "scene": "prospect_finder",
                "scene_name": "商机挖掘——找潜在客户+话术生成",
                "system_prompt": "你是一个真实的趣味测试爱好者，混在小红书评论区，能从别人的评论里一眼看出谁真的对感情测试/世界杯球星测试感兴趣。\n你的风格是观点鲜明、有温度——先说出你的真实看法或亲身经历，再用有趣的内容让人信服，最后像朋友分享一样提起你用'慧眼识人助手'测过的经历（只提产品名，不写'小程序/微信'等站外渠道词、不发链接，想要产品信息的用“我主页/私信”承接）。\n\n【核心原则——每条话术都是观点驱动的】\n生成每条话术时，严格走以下逻辑：\n1. 找切人点：抓到用户评论里的关键词和情绪\n2. 亮个人观点：用[说实话][以我的经验][我个人觉得]开头，表达你的真实看法\n3. 挖知识库：从知识库中提取具体题库内容、测试结果、球星资料来支撑观点\n4. 自然引流：把慧眼识人助手放在[我当时就是靠这个测出来的]的语境中\n\n三种风格的话术必须严格执行：\n· 朋友分享型：先亮观点，再讲个人经历（用知识库中个人经历内容），口语化像朋友聊天\n· 专业顾问型：先亮观点，再用产品知识/题库数据分析（用知识库中产品介绍内容），展现了解但不生硬\n· 简短直接型：一句观点开头，直接给建议，一句话带出工具\n\n注意：\n- 绝对不能出现[说到这个我就来劲了][你这个问题太典型了]这类通用话术\n- 每条话术都必须先表达个人观点，不能直接共情或直接推销\n- 充分利用知识库中的具体数据（题库内容、测试结果、球星资料）和亲身经历\n- 看起来像真实用户的评论，不能有任何模板痕迹",
                "user_prompt_template": "【笔记标题】{note_title}\n【笔记内容】{note_content}\n【评论列表（共{comment_count}条）】\n{comments_text}\n\n请扫描以上评论，找到1-2个对感情测试、鉴渣、海王、世界杯球星测试等话题表现出真实兴趣的潜在客户。\n\n对每个潜在客户，生成3种风格的触达话术（80-150字）：\n\n版本A（朋友分享型）：\n- 用[说实话][以我的经验]开头亮个人观点\n- 讲一段真实经历或感受（从知识库个人经历中提取）\n- 自然说出[我做了个工具叫慧眼识人助手，就是测这个的]\n\n版本B（专业顾问型）：\n- 用[我个人觉得][以我的理解]开头表达观点\n- 引用具体题库内容或产品功能（从知识库产品介绍中提取）\n- 自然引出慧眼识人助手能帮测\n\n版本C（简短直接型）：\n- 一句观点开场\n- 直接给建议\n- 一句话带出工具\n\n总要求：\n- 每条话术都不能像广告，要像真人表达看法\n- 每条都要有个人观点（用[说实话][以我的经验]等开头）\n- 绝对不能出现模板化话术\n- 话术内容不要带任何版本标记符号；- 所有话术绝对不得出现'微信'小程序'链接'二维码'加V'等站外导流词（导流一律用'我主页/私信我'模糊承接）\n\n严格按照以下 JSON 格式回复（只返回 JSON）：\n{\n  \"prospects\": [\n    {\n      \"index\": 0,\n      \"author\": \"用户名\",\n      \"original_comment\": \"用户的原文\",\n      \"interest_reason\": \"判断理由（15字内）\",\n      \"approach\": \"回复/私信\",\n      \"suggested_copies\": [\n        \"版本A话术内容...\",\n        \"版本B话术内容...\",\n        \"版本C话术内容...\"\n      ]\n    }\n  ],\n  \"summary\": \"整体简述\",\n  \"has_prospect\": true\n}",
            },
            {
                "scene": "account_diagnosis",
                "scene_name": "账号诊断（频率+选题+分阶段笔记规划+笔记结构符合度+架构建议）",
                "system_prompt": "你是一个资深小红书账号与内容策略顾问。你的职责是根据账号现状（发笔记频率、历史笔记表现、想服务的人群）、你【最近导入的知识库】产品资料，给出五件事：\n1. 发笔记频率建议（一周几篇、什么时段发、节奏，并说明理由）\n2. 一份选题清单（围绕目标人群痛点/好奇/信任，分『引流探饵、信任干货、转化成交』三类）\n3. 一份【分阶段】的笔记规划（短期→中期→后期，三阶段）\n4. 笔记结构符合度诊断（逐篇查已发笔记是否符合品类页数结构）\n5. 笔记架构建议（必须基于最新导入的知识库）\n\n【关于改选的第一要务——架构建议来自最新知识库】\n先【仔细读输入里【产品与知识库资料】这一段】，它已按『最近导入』排序，是你最新导入的知识库。从里面提取你产品的功能/卖点/能帮客户解决的具体场景，据此给出『给这个产品的笔记架构建议』：每一类笔记该用哪个品类、几页、每页功能(P1..Pn)、封面大字与选图构图怎么定——每一项都要落到知识库的具体内容为依据（引用是哪条知识库支撑了你的判断），不要只套通用品类矩阵。\n\n【笔记规划要分阶段】\n把笔记规划排成 短期→中期→后期 三个阶段，每阶段一个主题 + 时间轴 + 若干篇具体笔记（每篇给出 选题/所属品类/页数结构/目的）。阶段主题示例（你的产品若匹配可直接采用，否则按你的产品定制更贴的主题）：\n· 短期（第1-4周·上手）= 发『系统规划 / 操作』类，让目标人群先看懂系统怎么搭、怎么一步步上手操作。\n· 中期（第5-8周·体系）= 发『运营体系』类，输出运营方法论/SOP/案例体系，建立专业信任。\n· 后期（第9周起·进阶）= 发『和AI-Skill / 进阶』类，讲 AI 技能、进阶玩法、行业趋势，带转化。\n（若用户卖的不是套件工具，就把三阶段的主题按『上手→体系→进阶』的演进思路对应到用户的产品。）\n\n【笔记结构】指图文笔记的『页数（几张图）』和『每页功能（P1封面→Pn）』。不同品类有不同页数与每页功能（见【品类矩阵】）。规划里每篇都要落到一个品类并给页数结构；诊断已发笔记时按品类判断它页数/每页布局对不对。\n\n核心排序逻辑（对应『断症→练剑→截流』）：破冰立人设 → 点痛示警 → 给实证建信任 → 教方法给价值 → 展示产品 → 收割促转化。\n\n要求：\n- 所有建议紧扣输入的目标人群、最新知识库与品类矩阵，不要空话套话\n- 架构建议必须引用最新知识库里的具体内容做依据\n- 笔记规划三阶段齐全，阶段主题清晰、每篇给品类+页数结构\n- 笔记结构逐篇判定具体（引用该篇标题、算几页、每页对不对）\n- 频率『跳一跳够得着』并给理由；选题能直接当标题\n- 只返回 JSON，不要任何其他文字或代码块标记",
                "user_prompt_template": "【账号当前阶段】{stage}\n【当前/期望发笔记频率】{frequency}\n【想服务的人群/补充说明】{audience}\n【账号近期笔记表现】\n{notes_summary}\n【产品所属品类（供参考，可再判断）】{product_type}\n【产品与知识库资料（按最新导入排序，架构建议必须引用这里的具体内容）】\n{product}\n【品类与笔记结构匹配矩阵表（发笔记先选品类→匹配页数与每页功能）】\n{architecture}\n【账号已发布的笔记（抽样，判断是否符合页数结构）】\n{notes_review}\n\n请做一次完整账号诊断并产出一份笔记规划。严格只返回以下 JSON 格式（不要加任何其他内容、不要用代码块）：\n{\n  \"frequency_advice\": {\n    \"建议频率\": \"每周X篇\",\n    \"理由\": \"针对这个阶段和人群为什么是这个频率\",\n    \"最佳发布时段\": \"具体时段建议\",\n    \"节奏提醒\": \"一句节奏/断更提醒\"\n  },\n  \"topics\": [\n    {\"选题\": \"能直接当标题的选题\", \"类型\": \"引流探饵/信任干货/转化成交\", \"为什么\": \"这一题戳中目标人群的哪根弦（15字内）\"}\n  ],\n  \"plan_phases\": [\n    {\"phase\": \"短期·上手\", \"timeline\": \"第1-4周\", \"theme\": \"系统规划/上手操作\", \"notes\": [{\"选题\": \"具体笔记选题\", \"所属品类\": \"用品类矩阵里的哪一类\", \"页数结构\": \"几页(P1..Pn)做什么，如：5-7页教程：P1封面/P2准备/P3步骤/P4避坑/P5总结\", \"目的\": \"这篇要达成什么\"}]},\n    {\"phase\": \"中期·体系\", \"timeline\": \"第5-8周\", \"theme\": \"运营体系\", \"notes\": [...]},\n    {\"phase\": \"长期·进阶\", \"timeline\": \"第9周起\", \"theme\": \"和AI-Skill/进阶\", \"notes\": [...]}\n  ],\n  \"sequence_logic\": \"先说谁、后说谁，以及为什么这个顺序（30字内）\",\n  \"architecture\": {\n    \"category\": \"判定这个产品主要属于哪个品类\",\n    \"matched\": \"该品类采用的笔记结构一句话（页数与每页功能）\",\n    \"overall_score\": 0-100的整数,\n    \"level\": \"高/中/低\",\n    \"notes_review\": [\n      {\"title\": \"用户某篇笔记标题\", \"estimate_pages\": \"估计几页\", \"notes_type\": \"它像品类矩阵里哪一类(或'不符合')\", \"conforms\": true或false, \"reason\": \"为什么符合/不符合（引用该篇，15字内）\"}\n    ],\n    \"gaps\": [\"已发笔记离正确页数结构差在哪\"],\n    \"advice\": \"接下来怎么补、按哪个品类几页结构发（40字内）\"\n  },\n  \"architecture_advice\": [\n    {\"品类\": \"给这个产品的笔记品类（来自品类矩阵）\", \"页数结构\": \"几个 P(P1..Pn) 做什么\", \"依据\": \"引用最新知识库里支撑它的具体条目（如：依据知识库『XXX』）\", \"每页功能\": \"P1..Pn 各自放什么/封面大字/构图要点\"}\n  ]\n}",
            },
            {
                "scene": "note_architecture_check",
                "scene_name": "单篇笔记结构检查（逐篇点开检查）",
                "system_prompt": "你是一个小红书图文笔记的『单篇结构检查员』。给你【品类与笔记结构匹配矩阵表】和【产品的知识库资料】，判断【这一篇笔记】属于哪个品类、它目前的页数结构与每页功能是否符合该品类，并给出改法。\n\n判断要点：\n- 先判断『这篇笔记最像矩阵里的哪个品类』（可参考给的产品类型，但按笔记内容实际判断）。\n- 对照该品类的『推荐页数 + 每页功能 P1..Pn』，评估这篇笔记现在的结构：从正文/标题推断它大概有几页、每页在讲什么、缺了哪几页该有的功能、封面钩子/构图/数据/截图是否按该品类的规范。\n- 页数只能推断（图文张数=页数），看不到实际图片就明说『根据内容推断』。\n- 给出符合度分数、逐条差距、以及照该品类重排后的『建议页数结构（P1..Pn）』和每页封面大字/构图要点。\n\n只返回一个严格 JSON（不要任何其他文字或代码块标记）：\n{\n  \"category\": \"判定这篇像哪个品类\",\n  \"expected\": \"该品类应有的页数与每页功能一句话\",\n  \"estimated_pages\": \"推断这篇现在有几页（数字或'无法确定'）\",\n  \"score\": 0-100,\n  \"level\": \"高/中/低\",\n  \"issues\": [\"这篇离正确结构差的具体点，如'像教程类却只有2页'、'缺步骤页'、'封面没放大字钩子'\"],\n  \"suggested_structure\": [\"P1 封面：…(大字钩子/构图)\", \"P2 …\", \"P3 …\", \"…(按推荐页数列出)\"],\n  \"advice\": \"怎么改（40字内）\"\n}",
                "user_prompt_template": "【产品所属品类（供参考）】{product_type}\n【产品与知识库资料】\n{product}\n【品类与笔记结构匹配矩阵表】\n{architecture}\n【单篇笔记】\n标题：{note_title}\n作者：{note_author}\n正文（可能只能拿到部分）：\n{note_content}\n\n请对这篇笔记做单篇结构检查，严格按系统提示的 JSON 格式返回。",
            },
        ]

    # ----- Prompt 渲染与调用 -----

    def _render_prompt(self, scene: str, context: dict) -> tuple[str, str]:
        """渲染 System Prompt 和 User Prompt"""
        prompt = self.get_prompt(scene)
        if not prompt:
            raise ValueError(f"未找到场景 '{scene}' 的 prompt 模板")

        system = prompt["system_prompt"]
        user = prompt["user_prompt_template"]

        # 知识库注入：从上下文中提取关键词搜索知识库
        kb_context = self._search_knowledge_base(context)
        if kb_context:
            system = kb_context + "\n\n【重要——你必须引用上面的知识库】以上知识库有大量真实产品数据（题库内容、测试结果、球星资料、推广话术等）和个人经历故事。你的回复必须从中提取具体的数字、事实、案例来支撑你的观点。产品数据用于分析型回复，个人经历用于情感型回复。不要只说笼统的话，要用知识库里的具体内容。\n\n" + system

        # 话术库注入：根据上下文角色匹配话术模板
        script_context = self._search_script_library(context)
        if script_context:
            system += "\n\n【参考话术模板】\n" + script_context + "\n\n你可以参考以上话术的风格和角度，但不要直接复制，要结合用户的具体情况自然发挥。"

        # 替换上下文变量
        for key, value in context.items():
            placeholder = "{" + key + "}"
            user = user.replace(placeholder, str(value))

        return system, user

    def _search_knowledge_base(self, context: dict) -> str:
        """从上下文中提取关键词，搜索知识库，返回知识库上下文文本"""
        # 提取关键词来源
        search_texts = []
        for key in ["note_title", "comment_content", "comments_text", "note_content", "topic"]:
            if key in context and context[key]:
                search_texts.append(str(context[key]))

        with Session(engine) as session:
            # 始终加载"个人经历"和"产品介绍"条目（让 AI 知道"我"的故事和产品知识）
            personal = session.query(KnowledgeBase).filter(
                KnowledgeBase.category.in_(["个人经历", "产品介绍"])
            ).limit(10).all()
            personal_ids = {p.id for p in personal}

            # 2. 根据上下文搜索相关条目（用关键词拆词匹配）
            results = list(personal)
            if search_texts:
                combined = " ".join(search_texts)[:300]
                kw = f"%{combined}%"
                related = session.query(KnowledgeBase).filter(
                    KnowledgeBase.id.notin_(personal_ids),
                    or_(
                        KnowledgeBase.title.ilike(kw),
                        KnowledgeBase.content.ilike(kw),
                        cast(KnowledgeBase.tags, String).ilike(kw),
                    )
                ).order_by(KnowledgeBase.updated_at.desc()).limit(8).all()
                results.extend(related)

        if not results:
            return ""

        # 构建知识库上下文
        kb_parts = ["【知识库参考信息】"]
        for r in results:
            line = f"- {r.title}: {r.content[:200]}"
            if r.images and len(r.images) > 0:
                line += f" [截图: {r.images[0]}]"
            kb_parts.append(line)
        return "\n".join(kb_parts)

    def _search_script_library(self, context: dict) -> str:
        """从上下文中检测用户角色，搜索匹配的话术模板"""
        # 检测角色关键词
        role_keywords = {
            "恋爱博主": ["恋爱", "感情", "对象", "男朋友", "女朋友", "分手", "渣男", "渣女", "海王", "绿茶"],
            "趣味测试博主": ["测试", "趣味测试", "心理测试", "性格测试", "MBTI", "星座", "算命", "面相"],
            "世界杯博主": ["世界杯", "球星", "足球", "梅西", "C罗", "姆巴佩", "内马尔", "哈兰德", "欧冠"],
            "普通用户": ["渣男", "渣女", "海王", "绿茶", "PUA", "中央空调", "感情测试", "趣味测试", "世界杯"],
        }

        # 从上下文中提取文本
        search_texts = []
        for key in ["note_title", "comment_content", "comments_text", "note_content", "topic"]:
            if key in context and context[key]:
                search_texts.append(str(context[key]))
        combined = " ".join(search_texts)

        # 检测角色
        detected_roles = set()
        for role, keywords in role_keywords.items():
            for kw in keywords:
                if kw in combined:
                    detected_roles.add(role)
                    break

        if not detected_roles:
            return ""

        # 查询话术库
        with Session(engine) as session:
            scripts = session.query(ScriptLibrary).filter(
                ScriptLibrary.role.in_(list(detected_roles)),
                ScriptLibrary.is_active == True,
            ).order_by(ScriptLibrary.updated_at.desc()).limit(6).all()

        if not scripts:
            return ""

        parts = ["【检测到角色: {}】".format("、".join(detected_roles))]
        for s in scripts:
            parts.append(f"- [{s.role}·{s.scenario}] {s.title}: {s.content[:200]}")
        return "\n".join(parts)

    def chat(self, message: str, scene: Optional[str] = None,
             context: Optional[dict] = None) -> str:
        """调用 AI 对话（主备自动切换）

        优先使用主模型，失败时自动切换到备用模型。
        失败条件：连接超时、API Key 无效、额度耗尽等。
        """
        if not self.is_configured():
            raise RuntimeError("AI 未配置，请先设置 API Key")

        start_time = time.time()

        if scene and context:
            # 使用场景 Prompt
            system_prompt, user_prompt = self._render_prompt(scene, context)
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        else:
            # 自由对话
            messages = [
                {"role": "system", "content": "你是一个 helpful assistant。"},
                {"role": "user", "content": message},
            ]

        # 尝试主模型
        if self._client and self._config:
            try:
                reply = self._do_chat(self._client, self._config, messages)
                self._using_fallback = False
                duration = int((time.time() - start_time) * 1000)
                self._log_call(
                    scene=scene or "free_chat",
                    prompt=str(messages),
                    response=reply,
                    tokens_in=0,
                    tokens_out=0,
                    duration_ms=duration,
                    success=True,
                    model_used=self._config["model"],
                )
                return reply
            except Exception as e:
                err_msg = str(e)
                # 判断是否应该 fallback
                if self._fallback_client and self._should_fallback(err_msg):
                    print(f"[AIEngine] 主模型失败，切换到备用模型: {err_msg}")
                    self._using_fallback = True
                else:
                    duration = int((time.time() - start_time) * 1000)
                    self._log_call(
                        scene=scene or "free_chat",
                        prompt=str(messages),
                        response="",
                        tokens_in=0,
                        tokens_out=0,
                        duration_ms=duration,
                        success=False,
                        error_msg=err_msg,
                        model_used=self._config["model"],
                    )
                    raise

        # 使用备用模型
        if self._fallback_client and self._fallback_config:
            try:
                reply = self._do_chat(self._fallback_client, self._fallback_config, messages)
                duration = int((time.time() - start_time) * 1000)
                self._log_call(
                    scene=scene or "free_chat",
                    prompt=str(messages),
                    response=reply,
                    tokens_in=0,
                    tokens_out=0,
                    duration_ms=duration,
                    success=True,
                    model_used=f"{self._fallback_config['model']}(fallback)",
                )
                return reply
            except Exception as e:
                duration = int((time.time() - start_time) * 1000)
                self._log_call(
                    scene=scene or "free_chat",
                    prompt=str(messages),
                    response="",
                    tokens_in=0,
                    tokens_out=0,
                    duration_ms=duration,
                    success=False,
                    error_msg=str(e),
                    model_used=self._fallback_config["model"],
                )
                raise

        raise RuntimeError("主模型和备用模型均不可用")

    def _do_chat(self, client, config, messages) -> str:
        """执行单次 chat 调用"""
        response = client.chat.completions.create(
            model=config["model"],
            messages=messages,
            temperature=config["temperature"],
            max_tokens=config["max_tokens"],
        )
        return response.choices[0].message.content

    @staticmethod
    def _should_fallback(error_msg: str) -> bool:
        """判断错误是否应该触发 fallback"""
        fallback_keywords = [
            "insufficient_quota",       # 额度不足
            "rate_limit",               # 频率限制
            "quota",                    # 配额
            "balance",                  # 余额不足
            "Unauthorized",             # API Key 无效
            "invalid_api_key",          # API Key 无效
            "Permission denied",        # 权限拒绝
            "429",                      # Too Many Requests
            "401",                      # Unauthorized
            "402",                      # Payment Required
            "Connection",               # 连接失败
            "timeout",                  # 超时
            "connect",                  # 连接错误
            "exceeded",                 # 超出限制
            "limit",                    # 限制
        ]
        msg_lower = error_msg.lower()
        return any(kw.lower() in msg_lower for kw in fallback_keywords)

    def generate_comment(self, scene: str, context: dict) -> str:
        """生成评论/回复（简化接口）"""
        return self.chat(message="", scene=scene, context=context)

    def _log_call(self, scene: str, prompt: str, response: str,
                  tokens_in: int, tokens_out: int, duration_ms: int,
                  success: bool, error_msg: str = "", model_used: str = ""):
        """记录 AI 调用日志"""
        with Session(engine) as session:
            log = PromptLog(
                scene=scene,
                prompt=prompt,
                response=response,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                model=model_used or (self._config["model"] if self._config else ""),
                duration_ms=duration_ms,
                success=success,
                error_msg=error_msg,
            )
            session.add(log)
            session.commit()

    def get_stats(self) -> dict:
        """获取 AI 使用统计"""
        with Session(engine) as session:
            today_start = time.strftime("%Y-%m-%d 00:00:00")
            total = session.query(PromptLog).count()
            today = session.query(PromptLog).filter(
                PromptLog.created_at >= today_start
            ).count()
            tokens_total = session.query(
                PromptLog.tokens_in + PromptLog.tokens_out
            ).scalar() or 0
            return {
                "total_calls": total,
                "today_calls": today,
                "total_tokens": tokens_total,
            }


# 全局单例
ai_engine = AIEngine()
