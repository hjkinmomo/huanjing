"""Explicit story fragments. Authored personas, settings and media are not reset."""
import copy
from persona_modes import role_mode
from world_identities import STORY_MAPS,WALLET_FIELDS

MAPS=tuple(dict.fromkeys((*STORY_MAPS,'lifeSeenMessages','runtimeSummaries','identityDrafts','portraitMood','chatQuality','roleConsistency')))
WALLET=tuple(k for k in WALLET_FIELDS if k not in ['userProfile','pianoRoom'])+('shopOperations','shopLog','gameStats','gameScoreHistory','gameReceipts','gameBestResults','gameLastOrders')

def owned(key,mode,sessions):
    if not isinstance(key,str):return False
    if key.startswith('conversation:role:'):return role_mode(key.split(':',3)[2])==mode
    return key[13:] in sessions if key.startswith('conversation:') else role_mode(key)==mode

def capture(payload,mode,sessions):
    result={}
    for branch in ['legacy','experience']:
        data=payload.get(branch,{});maps={}
        for name in MAPS:
            if isinstance(data.get(name),dict):maps[name]={k:copy.deepcopy(v) for k,v in data[name].items() if owned(k,mode,sessions)}
        part={'maps':maps}
        for name in ['moments','stories']:
            source=data.get(name)
            if not isinstance(source,dict):continue
            items='posts' if name=='moments' else 'cards';selected=[copy.deepcopy(v) for v in source.get(items,[]) if isinstance(v,dict) and role_mode(v.get('roleId',''))==mode]
            entry={items:selected}
            if name=='moments':
                ids={v['id'] for v in selected};entry['commentDrafts']={k:v for k,v in source.get('commentDrafts',{}).items() if k in ids}
                entry['pendingDeletes']=[v for v in source.get('pendingDeletes',[]) if v.get('id') in ids]
                if payload.get('experience',{}).get('settings',{}).get('personaMode','normal')==mode:entry['draft']=source.get('draft','')
            else:
                entry['schema']=source.get('schema',1)
                entry['sessions']={k:copy.deepcopy(v) for k,v in source.get('sessions',{}).items() if role_mode(k)==mode}
            part[name]=entry
        for name in ['memories','conversationJournal']:
            if isinstance(data.get(name),list):part[name]=[copy.deepcopy(v) for v in data[name] if not isinstance(v,dict) and mode=='normal' or isinstance(v,dict) and role_mode(v.get('roleId') or v.get('role_id') or v.get('role') or '')==mode]
        result[branch]=part
    return result

def apply(payload,outgoing,incoming,mode):
    for branch in ['legacy','experience']:
        data=payload.setdefault(branch,{})
        for name in MAPS:
            mapping=data.get(name)
            if not isinstance(mapping,dict):
                if name not in incoming.get(branch,{}).get('maps',{}):continue
                mapping={};data[name]=mapping
            for key in outgoing.get(branch,{}).get('maps',{}).get(name,{}):mapping.pop(key,None)
            mapping.update(copy.deepcopy(incoming.get(branch,{}).get('maps',{}).get(name,{})))
        for name in ['moments','stories']:
            if not isinstance(data.get(name),dict) and name not in incoming.get(branch,{}):continue
            source=data.setdefault(name,{'version':1,'posts':[]} if name=='moments' else {'schema':1,'sessions':{},'cards':[]});items='posts' if name=='moments' else 'cards'
            old=outgoing.get(branch,{}).get(name,{});new=incoming.get(branch,{}).get(name,{});ids={v['id'] for v in old.get(items,[])}
            source[items]=[v for v in source.get(items,[]) if v.get('id') not in ids]+copy.deepcopy(new.get(items,[]))
            if name=='moments':
                source['commentDrafts']={k:v for k,v in source.get('commentDrafts',{}).items() if k not in ids};source['commentDrafts'].update(new.get('commentDrafts',{}))
                source['pendingDeletes']=[v for v in source.get('pendingDeletes',[]) if v.get('id') not in ids]+new.get('pendingDeletes',[])
                if 'draft' in old:source['draft']=new.get('draft','')
            else:
                source.setdefault('schema',1)
                for key in old.get('sessions',{}):source.get('sessions',{}).pop(key,None)
                source.setdefault('sessions',{}).update(copy.deepcopy(new.get('sessions',{})))
        for name in ['memories','conversationJournal']:
            if name in data:data[name]=[v for v in data[name] if v not in outgoing.get(branch,{}).get(name,[])]+copy.deepcopy(incoming.get(branch,{}).get(name,[]))
    return payload
