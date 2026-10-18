"""Pin natural-language candidates to the latest saved user turn and story bank."""
from contextlib import closing
from datetime import datetime,timedelta
import hashlib,json
from chat_appointments import extract,intent,destination
from persona_modes import role_mode

def request_key(mid):return 'chat-'+hashlib.sha256(mid.encode()).hexdigest()[:32]
def candidate_key(role,session,mid):return 'commitment-'+hashlib.sha256((role+'|'+session+'|'+request_key(mid)).encode()).hexdigest()[:36]
def latest(db,role,session):
 return db.execute("SELECT c.id,c.text,c.ordinal,c.tone,h.world_time FROM conversation_messages c LEFT JOIN conversation_channels h ON h.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.sender='user' AND c.deleted_at='' ORDER BY c.ordinal DESC LIMIT 1",(role,session)).fetchone()

class ChatCommitmentSource:
 def __init__(self,commitments):self.owner=commitments;self.life=commitments.life
 def grant(self,role,session,messages,expected_id=None):
  text=next((m.get('content') for m in reversed(messages) if m.get('role')=='user'),None)
  if not isinstance(text,str):return None
  if not intent(text):
   with closing(self.life.runtime.connect()) as db:
    pending=db.execute("SELECT 1 FROM role_living_tasks WHERE role_id=? AND kind='appointment-draft' AND status='waiting_place' AND json_extract(payload_json,'$.messageId') IN (SELECT id FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='') LIMIT 1",(role,role,session)).fetchone()
   if not pending:return None
  stamp=self.life.stamp()
  try:
   with self.life.lock,closing(self.life.runtime.connect()) as db,db:
    role,session,world,state,rev,places,bank=self.owner.scope({'roleId':role,'sessionId':session},db,stamp)
    saved=latest(db,role,session)
    if not saved or expected_id is not None and saved['id']!=expected_id or saved['text'].strip()!=text.strip() or saved['tone']=='binding-application' or not saved['world_time']:return None
    anchor=datetime.fromisoformat(saved['world_time'].replace('Z','+00:00'))
    if anchor.tzinfo is None:return None
    clarified=None;proposal_text=text;draft_key='appointment-draft-'+hashlib.sha256((role+'|'+session+'|'+bank).encode()).hexdigest()[:32]
    if not intent(text):
     draft=db.execute("SELECT payload_json FROM role_living_tasks WHERE id=? AND kind='appointment-draft' AND status='waiting_place'",(draft_key,)).fetchone()
     if not draft:return None
     draft=json.loads(draft[0]);previous=db.execute("SELECT id FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='' AND ordinal<? ORDER BY ordinal DESC LIMIT 1",(role,session,saved['ordinal'])).fetchone()
     if not previous or previous[0]!=draft['messageId'] or len(text)>160 or not destination(text,state,places)[0]:return None
     proposal_text=draft['quote']+' '+text
     if not intent(proposal_text):return None
     old_anchor=datetime.fromisoformat(draft['worldUtc'].replace('Z','+00:00'))
     if not 0<=(anchor-old_anchor).total_seconds()<=86400:return None
     anchor=old_anchor;clarified=draft
    digest=hashlib.sha256(saved['text'].encode()).hexdigest();cid=candidate_key(role,session,saved['id']);prior=db.execute('SELECT * FROM world_commitments WHERE id=? AND role_id=? AND session_id=? AND identity_id=?',(cid,role,session,bank)).fetchone()
    state['_userTravelling']=bool(self.life.transport.output(db,role_mode(role))['current'])
    state['_appointmentRoutines']={}
    for i in range(3):
     at=anchor+timedelta(days=i);date=(at+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])).date().isoformat()
     state['_appointmentRoutines'][date]=self.life.agenda.schedule_at(state,at,places)['slots']
    facts={**json.loads(prior['payload_json']),'eligible':True,'status':prior['status']} if prior else extract(proposal_text,anchor,state['timePolicy']['utcOffsetMinutes'],state,places)
    now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
    if not prior and facts.get('eligible') and datetime.fromisoformat(facts['at'])<=now:facts={'eligible':False,'reason':'time_elapsed','needsClarification':True}
    if not prior and facts.get('eligible') and datetime.fromisoformat(facts['at'])>now+timedelta(days=7):facts={'eligible':False,'reason':'time_outside_window','needsClarification':True}
    if not facts['eligible']:
     if intent(text) and facts.get('reason') in ['place_missing','place_ambiguous']:
      draft={'messageId':saved['id'],'ordinal':saved['ordinal'],'worldUtc':saved['world_time'],'quote':saved['text'],'textHash':hashlib.sha256(saved['text'].encode()).hexdigest()}
      db.execute('INSERT OR REPLACE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(draft_key,role,'appointment-draft',json.dumps(draft,ensure_ascii=False),'waiting_place',stamp))
     return {'facts':facts}
    row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone();epoch=json.loads(row[0]).get('experience',{}).get('dataEpoch') if row else None
    source={'messageId':saved['id'],'ordinal':saved['ordinal'],'textHash':digest,'worldUtc':saved['world_time'],'quote':saved['text'][:800],'type':'chat'}
    if clarified:source['clarifiedFrom']=clarified
    return {'facts':facts,'scope':{'_chatProposalGrant':{'facts':facts,'source':source,'identityId':bank},'_commitmentBank':bank,'_commitmentUserOrdinal':saved['ordinal'],'_commitmentRevisions':{},'expectedDataEpoch':epoch}}
  except (ValueError,PermissionError):return None
 def propose(self,args):
  grant=args.get('_chatProposalGrant')
  if not isinstance(grant,dict):raise PermissionError('chat_commitment_turn_required')
  stamp=self.life.stamp();role=args['roleId'];session=args['sessionId'];source=grant['source'];facts=grant['facts']
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');scope=self.owner.scope({'roleId':role,'sessionId':session},db,stamp)
   saved=latest(db,role,session)
   if not saved or scope[-1]!=grant['identityId'] or saved['id']!=source['messageId'] or saved['ordinal']!=source['ordinal'] or saved['world_time']!=source['worldUtc'] or hashlib.sha256(saved['text'].encode()).hexdigest()!=source['textHash']:raise ValueError('chat_commitment_source_stale')
   parent=source.get('clarifiedFrom')
   if parent:
    old=db.execute("SELECT text,world_time FROM conversation_messages c JOIN conversation_channels h ON h.message_id=c.id WHERE c.id=? AND c.role_id=? AND c.session_id=? AND c.sender='user' AND c.deleted_at=''",(parent['messageId'],role,session)).fetchone()
    if not old or old['world_time']!=parent['worldUtc'] or hashlib.sha256(old['text'].encode()).hexdigest()!=parent['textHash']:raise ValueError('chat_commitment_source_stale')
   result=self.owner.insert_in(db,{**facts,'requestId':request_key(source['messageId']),'note':source['quote']},scope,stamp,source=source,enqueue=False)
   if parent:db.execute("UPDATE role_living_tasks SET status='resolved' WHERE id=? AND role_id=? AND kind='appointment-draft' AND status='waiting_place'",('appointment-draft-'+hashlib.sha256((role+'|'+session+'|'+grant['identityId']).encode()).hexdigest()[:32],role))
  self.life.runtime.backup_manager.mark_dirty();return {**result,'fromChat':True,'changesUserLocation':False,'rule':'只保存用户本轮提议，尚未自动同意或出发。用 world_commitment_decide 记录角色本轮真实决定；条件不清楚就先协商。'}
