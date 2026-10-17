"""Shared, owner-changeable display directions; fiction never grants permissions."""
import json
from functools import lru_cache
from pathlib import Path
from persona_modes import base_role_id

def presentation_policy():
    return json.loads((Path(__file__).parent/'web/assets/experience/chat-presentation.json').read_text('utf-8'))

def presentation_instructions(role_id,settings=None,assistant=False,policy=None):
    if assistant:return ''
    if settings is None:settings={}
    if not isinstance(settings,dict) or set(settings)-{'replyNarration','replyStickers'}:
        raise ValueError('chat_presentation_invalid')
    policy=policy or presentation_policy()
    mode=next((m for m in policy['narrationModes'] if m['id']==settings.get('replyNarration','scene')),None)
    if mode is None or ('replyStickers' in settings and not isinstance(settings['replyStickers'],bool)):
        raise ValueError('chat_presentation_invalid')
    parts=['可更改的叙事显示习惯：'+mode['label']+'。'+mode['guidance']]
    if mode['id']!='off':parts.extend(policy['narrationRules'])
    stickers=policy['stickers']
    # Only the image vocabulary uses the base identity; private state stays mode-scoped.
    role_id=base_role_id(role_id)
    if settings.get('replyStickers',True) and role_id in stickers['voices']:
        parts.extend(['聊天表情：',*(f'[[sticker:{key}]]：{value["label"]}；{value["use"]}。' for key,value in stickers['moods'].items()),stickers['voices'][role_id],*stickers['rules']])
    elif settings.get('replyStickers') is False:parts.append('本轮已关闭角色贴纸，只使用文字，不输出表情标记或图址。')
    return '\n'.join(parts)
