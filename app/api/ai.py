"""AI 配置与测试 API"""
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from app.models.models import engine, AIConfig, AIPrompt
from app.schemas.schemas import (
    AIConfigUpdate, AIConfigResponse, AIChatRequest, AIChatResponse,
    PromptUpdate, PromptResponse, MessageResponse,
)
from app.core.ai_engine import ai_engine

router = APIRouter()


# ====== AI 配置 ======

@router.get("/config", response_model=AIConfigResponse)
async def get_ai_config():
    """获取 AI 配置（含备用模型）"""
    config = ai_engine.get_config()
    if not config:
        return AIConfigResponse(
            api_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            model="qwen-plus",
            temperature=0.8,
            max_tokens=500,
            has_key=False,
            fallback_api_base_url="",
            fallback_model="",
            has_fallback_key=False,
        )
    return AIConfigResponse(
        api_base_url=config["api_base_url"],
        model=config["model"],
        temperature=config["temperature"],
        max_tokens=config["max_tokens"],
        has_key=config["has_key"],
        fallback_api_base_url=config.get("fallback_api_base_url", ""),
        fallback_model=config.get("fallback_model", ""),
        has_fallback_key=config.get("has_fallback_key", False),
    )


@router.put("/config", response_model=AIConfigResponse)
async def update_ai_config(data: AIConfigUpdate):
    """更新 AI 配置（含备用模型）"""
    config = ai_engine.update_config(
        api_key=data.api_key,
        api_base_url=data.api_base_url,
        model=data.model,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        fallback_api_key=data.fallback_api_key,
        fallback_api_base_url=data.fallback_api_base_url,
        fallback_model=data.fallback_model,
    )
    return AIConfigResponse(
        api_base_url=config["api_base_url"],
        model=config["model"],
        temperature=config["temperature"],
        max_tokens=config["max_tokens"],
        has_key=config["has_key"],
        fallback_api_base_url=config.get("fallback_api_base_url", ""),
        fallback_model=config.get("fallback_model", ""),
        has_fallback_key=config.get("has_fallback_key", False),
    )


# ====== AI 对话测试 ======

@router.post("/chat", response_model=AIChatResponse)
async def ai_chat(data: AIChatRequest):
    """AI 对话测试"""
    if not ai_engine.is_configured():
        raise HTTPException(400, "AI 未配置，请先设置 API Key")

    try:
        reply = ai_engine.chat(
            message=data.message,
            scene=data.scene,
            context=data.context,
        )
        return AIChatResponse(reply=reply)
    except Exception as e:
        raise HTTPException(500, f"AI 调用失败: {str(e)}")


# ====== Prompt 管理 ======

@router.get("/prompts", response_model=list[PromptResponse])
async def list_prompts():
    """获取所有 Prompt 模板"""
    prompts = ai_engine.get_all_prompts()
    return prompts


@router.get("/prompts/{scene}", response_model=PromptResponse)
async def get_prompt(scene: str):
    """获取指定场景的 Prompt 模板"""
    prompt = ai_engine.get_prompt(scene)
    if not prompt:
        raise HTTPException(404, f"场景 '{scene}' 不存在")
    return prompt


@router.put("/prompts/{scene}", response_model=PromptResponse)
async def update_prompt(scene: str, data: PromptUpdate):
    """更新 Prompt 模板"""
    try:
        prompt = ai_engine.update_prompt(
            scene=scene,
            system_prompt=data.system_prompt,
            user_prompt_template=data.user_prompt_template,
        )
        return prompt
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/prompts/{scene}/reset", response_model=PromptResponse)
async def reset_prompt(scene: str):
    """恢复 Prompt 模板为默认值"""
    try:
        prompt = ai_engine.reset_prompt(scene)
        return prompt
    except ValueError as e:
        raise HTTPException(404, str(e))
