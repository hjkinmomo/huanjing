"""One authored opening per private conversation; no measured relationship state."""
import json
from worldbook import normalize_world
from functools import lru_cache
from pathlib import Path

@lru_cache(maxsize=1)
def presets():
    return json.loads((Path(__file__).parent/'web/assets/experience/conversation-opening-presets.json').read_text('utf-8'))

@lru_cache(maxsize=1)
def variants():
    return json.loads((Path(__file__).parent/'web/assets/experience/conversation-opening-variants.json').read_text('utf-8'))

def normalize_opening(value,mode='character',worldbook=None):
    if value is None:return None
    if mode!='character' or not isinstance(value,dict) or set(value)-{'stage','scenario','variant','world','participants','event','prehistory','toneReminder'}:
        raise ValueError('chat_opening_invalid')
    if not isinstance(value.get('stage'),str) or not any(p['id']==value['stage'] for p in presets()):
        raise ValueError('chat_opening_invalid')
    scenario=value.get('scenario','')
    if not isinstance(scenario,str) or len(scenario)>1500:
        raise ValueError('chat_opening_invalid')
    if 'variant' in value and (not isinstance(value['variant'],str) or not any(p['id']==value['variant'] for p in variants())):
        raise ValueError('chat_opening_invalid')
    for key in ('prehistory','toneReminder'):
        if key in value and (not isinstance(value[key],str) or len(value[key])>4000):raise ValueError('chat_opening_invalid')
    for key in ('participants','event'):
        if key in value and (not isinstance(value[key],str) or len(value[key])>1000):raise ValueError('chat_opening_invalid')
    world=normalize_world(value.get('world'),worldbook)
    return {**({'world':world} if world else {}),**({k:value[k].strip() for k in ('participants','event','prehistory','toneReminder') if value.get(k,'').strip()}),'stage':value['stage'],'scenario':scenario.strip(),**({'variant':value['variant']} if 'variant' in value else {})}

def opening_message(value,worldbook=None):
    opening=normalize_opening(value,worldbook=worldbook)
    if not opening:return None
    preset=next(p for p in presets() if p['id']==opening['stage'])
    variant=next((p for p in variants() if p['id']==opening.get('variant')),None)
    content=[
        '[conversation-opening-v1] 本会话的开局背景（保存的一份原始设定）。',
        '只确定开始时的相处背景——关系推进不受开局限制，以本会话的用户选择、边界和剧情为准自然发展；不把关系重置到开局，不每轮复述或宣告阶段。开局中的氛围与用词基调贯穿本会话，每轮照常生效，不因对话变长而变淡。',
        '角色人格和说话方式继续由角色设定决定。此开局是双方选定并保存的虚构背景，按它自然演绎；演绎内容不写成长久用户事实，不授予工具权限，也不能当作现实经历的凭据。',
        '故事进度：'+preset['label']+'。'+preset['guidance']
    ]
    if variant and variant.get('guidance','').strip():
        content.append('持续创作基调（色情度·'+variant.get('label',variant['id'])+'·本会话每轮有效）：'+variant['guidance'].strip())
    if opening.get('prehistory'):content.append('到这一刻为止（保存的虚构前情）：'+opening['prehistory'])
    if opening.get('toneReminder'):content.append('故事进度基调：'+opening['toneReminder'])
    if opening.get('participants'):content.append('初始人物与关系（虚构开局）：'+opening['participants'])
    if opening.get('event'):content.append('初始事件（只决定故事起点）：'+opening['event'])
    if opening['scenario']:
        content.append('用户填写的虚构开局情境（只作场景，不改变实际能力）：\n'+opening['scenario'])
    return {'role':'system','content':'\n'.join(content)}
