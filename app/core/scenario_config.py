"""截流场景默认配置。

供 init_db 播种 ScenarioConfig，也供 RadarEngine/WashEngine 读取。
本模块不 import 任何 app 内部模块，避免循环依赖；读写数据库在调用方进行。
"""
def build_default_scenario_configs() -> list[dict]:
    """返回六场景的默认配置字典列表。"""
    return [
        {
            "scenario": "burst",
            "scene_name": "爆发狙击(抓推荐流)",
            "enabled": True,
            "top_n": 20,
            "max_candidates": 20,
            "scan_interval_min": 5,
            "entry_ttl_hours": 24,
            "no_climb_strikes": 3,
            "climb_likes_delta": 50,
            "emotion_ratio": 0.0,
            "intent_keywords": [],
            "target_comments": 1,
            "max_comments": 1,
            "wash_hours": 24,
            "wash_interval_days": 1,
            "wash_likes_threshold": 50,
            "wash_replies_threshold": 10,
            "exit_wait_weeks": 0,
            "region_hint": "",
        },
        {
            "scenario": "evergreen",
            "scene_name": "长尾常青(抓搜索流)",
            "enabled": True,
            "top_n": 20,
            "max_candidates": 20,
            "scan_interval_min": 30,
            "entry_ttl_hours": -1,   # -1 表示长期
            "no_climb_strikes": 5,
            "climb_likes_delta": 0,
            "emotion_ratio": 0.0,
            "intent_keywords": [],
            "target_comments": 3,
            "max_comments": 5,
            "wash_hours": 24,
            "wash_interval_days": 7,
            "wash_likes_threshold": 50,
            "wash_replies_threshold": 10,
            "exit_wait_weeks": 2,
            "region_hint": "",
        },
        {
            "scenario": "city",
            "scene_name": "同城精准(抓LBS流)",
            "enabled": True,
            "top_n": 20,
            "max_candidates": 20,
            "scan_interval_min": 10,
            "entry_ttl_hours": 24,
            "no_climb_strikes": 3,
            "climb_likes_delta": 30,
            "emotion_ratio": 0.0,
            "intent_keywords": [],
            "target_comments": 1,
            "max_comments": 1,
            "wash_hours": 24,
            "wash_interval_days": 1,
            "wash_likes_threshold": 50,
            "wash_replies_threshold": 10,
            "exit_wait_weeks": 0,
            "region_hint": "同城",
        },
        {
            "scenario": "pain",
            "scene_name": "痛点猎杀(抓精准转化)",
            "enabled": True,
            "top_n": 20,
            "max_candidates": 20,
            "scan_interval_min": 15,
            "entry_ttl_hours": 48,
            "no_climb_strikes": 3,
            "climb_likes_delta": 0,
            "emotion_ratio": 0.0,
            "intent_keywords": ["求推荐", "听劝", "怎么办", "求建议", "求助", "避雷", "怎么选"],
            "target_comments": 1,
            "max_comments": 2,
            "wash_hours": 24,
            "wash_interval_days": 1,
            "wash_likes_threshold": 50,
            "wash_replies_threshold": 10,
            "exit_wait_weeks": 0,
            "region_hint": "",
        },
        {
            "scenario": "topic",
            "scene_name": "话题吃瓜(抓高曝光)",
            "enabled": True,
            "top_n": 20,
            "max_candidates": 20,
            "scan_interval_min": 20,
            "entry_ttl_hours": -1,   # 长期
            "no_climb_strikes": 4,
            "climb_likes_delta": 0,
            "emotion_ratio": 1.0,    # 评论/点赞 > 1 判定高活跃
            "intent_keywords": [],
            "target_comments": 1,
            "max_comments": 1,
            "wash_hours": 24,
            "wash_interval_days": 1,
            "wash_likes_threshold": 50,
            "wash_replies_threshold": 10,
            "exit_wait_weeks": 0,
            "region_hint": "",
        },
        {
            "scenario": "highv",
            "scene_name": "高V狙击(抓溢出流量)",
            "enabled": True,
            "top_n": 10,
            "max_candidates": 10,
            "scan_interval_min": 15,
            "entry_ttl_hours": -1,   # 长期
            "no_climb_strikes": 4,
            "climb_likes_delta": 0,
            "emotion_ratio": 0.0,
            "intent_keywords": [],
            "target_comments": 3,
            "max_comments": 3,
            "wash_hours": 12,        # 高V 12小时审查
            "wash_interval_days": 1,
            "wash_likes_threshold": 50,   # 已爆: 赞>50
            "wash_replies_threshold": 10, # 已爆: 回复>10
            "exit_wait_weeks": 1,
            "region_hint": "",
        },
    ]


def default_config_map() -> dict:
    """返回 {scenario: config_dict} 便于快速取用。"""
    return {c["scenario"]: c for c in build_default_scenario_configs()}


def scenario_order() -> list[str]:
    """六场景展示顺序。"""
    return ["burst", "evergreen", "city", "pain", "topic", "highv"]