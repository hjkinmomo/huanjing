"""Pin public-card / impression tools to the genuine saved current turn."""
from contextlib import closing
from datetime import datetime,timedelta
import json,re
from chat_appointments import plain
from character_social import digest
from persona_modes import role_mode

class SocialModel:
 def __init__(self,social):self.social=social;self.life=social.life
 def user(self,db,role,session):return db.execute("SELECT id,ordinal,text FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='' AND tone!='binding-application' ORDER BY ordinal DESC LIMIT 1",(role,session)).fetchone()
 def grant(self,role,session,text,expected_id=None):
  if not isinstance(text,str):return None
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   try:_,_,bank=self.social.scope(db,{'roleId':role,'sessionId':session})
   except (ValueError,PermissionError):return None
   user=self.user(db,role,session)
   if not user or expected_id is not None and user['id']!=expected_id or user['text'].strip()!=text.strip():return None
   query=plain(text);living=self.life.living.state(db,role);allowed={};labels=[]
   for subject in self.social.active(db,role_mode(role)):
    if subject==role:continue
    card=self.social.card(db,subject);evidence=self.social.evidence(db,role,subject);seen=any(e['kind']=='seen' for e in evidence)
    relevant=card['name'] in query or subject in query or any(e.get('subjectName','') and e['subjectName'] in query for e in evidence) or subject in living.get('socialPresence',{}) or seen and re.search('认识谁|见过谁|其他人|名片|印象',query)
    if not relevant:continue
    impression=db.execute('SELECT revision FROM character_impressions WHERE role_id=? AND subject_id=?',(role,subject)).fetchone()
    allowed[subject]={'cardHash':digest(card),'revision':impression[0] if impression else 0,'evidenceIds':[e['id'] for e in evidence]};labels.append({'id':subject,'name':card['name'],'seen':seen})
    if len(allowed)==3:break
   if not allowed:return None
   row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone();epoch=json.loads(row[0]).get('experience',{}).get('dataEpoch') if row else None
   scope={'_socialToken':self.social.token,'_socialGrant':{'roleId':role,'sessionId':session,'bank':bank,'userId':user['id'],'ordinal':user['ordinal'],'textHash':digest(user['text']),'allowed':allowed,'epoch':epoch}}
   note='[own-social-facts] 仅在本轮相关时按需用 world_social_read 读公开名片及你自己的亲眼事实，不读别人私聊。已有本人事实时，可用 world_impression_set 保存100字内第一人称印象，引用seen证据；不预设立场，不补造谈话或交情。不必主动提起旁人。相关对象：'+json.dumps(labels,ensure_ascii=False,separators=(',',':'))
   return {'scope':scope,'note':note,'canWrite':any(v['evidenceIds'] for v in allowed.values())}
 def check(self,db,args):
  if args.get('_socialToken') is not self.social.token or not isinstance(args.get('_socialGrant'),dict):raise PermissionError('social_model_turn_required')
  grant=args['_socialGrant'];role,session,bank=self.social.scope(db,args);subject=args['subjectId'];user=self.user(db,role,session)
  row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone();epoch=json.loads(row[0]).get('experience',{}).get('dataEpoch') if row else None
  if grant['roleId']!=role or grant['sessionId']!=session or grant['bank']!=bank or grant['epoch']!=epoch or not user or user['id']!=grant['userId'] or user['ordinal']!=grant['ordinal'] or digest(user['text'])!=grant['textHash']:raise ValueError('social_turn_stale')
  pinned=grant['allowed'].get(subject)
  if not pinned or subject not in self.social.active(db,role_mode(role)):raise PermissionError('social_subject_not_granted')
  if pinned['cardHash']!=digest(self.social.card(db,subject)):raise ValueError('social_public_card_changed')
  return role,session,subject,grant,pinned
 def read(self,args):
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   role,_,subject,grant,pinned=self.check(db,args)
   return {'publicCard':self.social.card(db,subject),'ownEvidence':[e for e in self.social.evidence(db,role,subject) if e['id'] in pinned['evidenceIds']],'ownImpression':self.social.impression(db,role,subject),'rule':'事实仅限本人精确同室观察。lost-sight只是不再同处视野，去向未知；公开关系说明是主动公开资料，不是私聊证据。'}
 def write(self,args):
  text=args.get('text');ids=args.get('evidenceIds');stamp=self.life.stamp()
  if not isinstance(text,str) or not 1<=len(text.strip())<=100 or not re.search(r'我|\bI\b|\bmy\b',text,re.I) or not isinstance(ids,list) or not 1<=len(ids)<=3 or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):raise ValueError('social_impression_invalid')
  text=text.strip()
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');role,session,subject,grant,pinned=self.check(db,args)
   sources={e['id']:e for e in self.social.evidence(db,role,subject,40) if e['id'] in pinned['evidenceIds']}
   if any(i not in sources for i in ids) or not any(sources[i]['kind']=='seen' for i in ids):raise PermissionError('social_own_seen_evidence_required')
   row=db.execute('SELECT * FROM character_impressions WHERE role_id=? AND subject_id=?',(role,subject)).fetchone();rev=row['revision'] if row else 0;old=json.loads(row['payload_json']) if row else {};operation=digest([grant['userId'],subject,text,ids])
   if old.get('operationHash')==operation and row and not row['forgotten'] and rev in [pinned['revision'],pinned['revision']+1]:return {'impression':self.social.impression(db,role,subject),'duplicate':True}
   if rev!=pinned['revision']:raise ValueError('social_impression_stale')
   history=old.get('history',[])
   if old.get('text'):history=[{k:v for k,v in old.items() if k not in ['history','operationHash']},*history][:10]
   clock,_=self.life.shared.read(db,role_mode(role),stamp,self.life.shared.world(role_mode(role)));world=(datetime.fromisoformat(stamp)+timedelta(seconds=clock['timePolicy']['clockOffsetSeconds'])).isoformat()
   value={'text':text,'evidenceIds':ids,'evidence':[{**sources[i]} for i in ids],'source':'recipient-model-tool','userMessageId':grant['userId'],'callId':args.get('_modelCallId',''),'operationHash':operation,'history':history,'at':world,'sessionId':session}
   if not value['callId']:raise PermissionError('social_model_call_required')
   db.execute('INSERT INTO character_impressions VALUES(?,?,?,?,0,?) ON CONFLICT(role_id,subject_id) DO UPDATE SET payload_json=excluded.payload_json,revision=excluded.revision,forgotten=0,updated_at=excluded.updated_at',(role,subject,json.dumps(value,ensure_ascii=False),rev+1,stamp))
   result={'impression':{k:v for k,v in value.items() if k not in ['history','operationHash','userMessageId','callId']},'changesWorldPosition':False}
  self.life.runtime.backup_manager.mark_dirty();return result
