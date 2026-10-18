"""Scoped appointment candidates and decisions from the genuine event model.

The owner may propose/cancel, but cannot forge the role's decision endpoint.
Decision receipt and reply are committed in the same transaction by the worker.
"""
from contextlib import closing
from datetime import datetime,timedelta,timezone
import hashlib,json
from persona_modes import role_mode
from role_workspace import identifier
from scene_locations import location_accessible,location_label,scene_container
from world_transport import route_distance,route_terms,METHODS
from chat_commitment_source import ChatCommitmentSource

def parse_decision(content):
 if not isinstance(content,str):raise ValueError('commitment_model_json_required')
 value=content.strip()
 if value.startswith('```'):
  value=value[value.find('\n')+1:];value=value.rsplit('```',1)[0].strip()
 try:result=json.loads(value)
 except (ValueError,TypeError):raise ValueError('commitment_model_json_required')
 if not isinstance(result,dict) or not isinstance(result.get('text'),str) or not result['text'].strip() or not isinstance(result.get('decision'),dict):raise ValueError('commitment_model_decision_required')
 decision=result['decision']
 if set(decision)-{'action','reason','method'} or decision.get('action') not in ['accept','decline','negotiate']:raise ValueError('commitment_model_decision_invalid')
 if not isinstance(decision.get('reason',''),str) or len(decision.get('reason',''))>800 or decision.get('method','walk') not in METHODS:raise ValueError('commitment_model_decision_invalid')
 return result['text'],decision

class WorldCommitments:
 def __init__(self,life,db):
  self.life=life;self.chat_source=ChatCommitmentSource(self)
  db.execute('CREATE TABLE IF NOT EXISTS world_commitments(id TEXT PRIMARY KEY,role_id TEXT NOT NULL,session_id TEXT NOT NULL,mode TEXT NOT NULL,identity_id TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)')
  for name,fn in [('world_commitment_propose',self.propose),('world_commitment_cancel',self.cancel),('world_commitment_confirm',self.confirm)]:life.runtime.registry.register(name,'Owner appointment candidate; only genuine recipient model can consent.',mutating=True)(fn)
 def load(self,db,role,session):
  return [{**json.loads(r['payload_json']),'status':r['status'],'revision':r['revision']} for r in db.execute("SELECT * FROM world_commitments WHERE role_id=? AND session_id=? ORDER BY CASE WHEN status IN ('proposed','accepted','negotiate') THEN 0 ELSE 1 END,created_at DESC,rowid DESC LIMIT 60",(role,session))]
 def output(self,db,role,session):
  values=self.load(db,role,session)
  for c in values:
   event=db.execute("SELECT id,status,error FROM character_event_queue WHERE role_id=? AND session_id=? AND kind='commitment' AND source_id=?",(role,session,c['id'])).fetchone()
   if event:c['response']={'id':event['id'],'status':event['status'],'error':event['error']}
  return values
 def save(self,db,state,stamp):
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
  for c in state.get('commitments',[]):
   row=db.execute('SELECT status,payload_json FROM world_commitments WHERE id=?',(c['id'],)).fetchone()
   if not row:continue
   old=json.loads(row['payload_json'])
   if row['status'] in ['proposed','awaiting_owner'] and datetime.fromisoformat(c['at'])<=now:
    c.update(status='missed',outcomeReason='提议时间已过，尚未确认，没有自动出发。')
    db.execute("UPDATE world_commitments SET status='missed',payload_json=?,revision=revision+1,updated_at=? WHERE id=?",(json.dumps(c,ensure_ascii=False),stamp,c['id']))
    db.execute("UPDATE character_event_queue SET status='superseded',error='提议时间已过。' WHERE kind='commitment' AND source_id=? AND status IN ('queued','waiting_configuration')",(c['id'],))
   if row['status']=='accepted' and (c['status']!='accepted' or c.get('startedAt')!=old.get('startedAt')):
    db.execute('UPDATE world_commitments SET status=?,payload_json=?,revision=revision+1,updated_at=? WHERE id=?',(c['status'],json.dumps(c,ensure_ascii=False),stamp,c['id']))
 def scope(self,args,db,stamp):
  role,session,world,meta=self.life.scope(args)
  if not world or not any(r['role_id']==role and r['session_id']==session for r in self.life.shared.sessions(db,role_mode(role))):raise ValueError('commitment_conversation_required')
  if meta.get('memoryPolicy')=='readonly':raise PermissionError('readonly_commitment_disabled')
  identity=self.life.identities.current(db,role_mode(role))
  state,rev=self.life._state(db,role,session,world,meta,stamp);places=self.life.places(role,session,world,db);self.life._tick(state,stamp,places)
  return role,session,world,state,rev,places,identity['id'] if identity else ''
 def propose(self,args):
  stamp=self.life.stamp()
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');scope=self.scope(args,db,stamp);result=self.insert_in(db,args,scope,stamp)
  self.life.runtime.backup_manager.mark_dirty();return result
 def insert_in(self,db,args,scope,stamp,source=None,enqueue=True):
  role,session,world,state,rev,places,bank=scope
  key=identifier(args.get('requestId'));note=args.get('note','');when=args.get('at');semantic=args.get('timeKind','arrival');dest=args.get('locationId');duration=args.get('durationMinutes',60)
  if not isinstance(note,str) or len(note)>800 or semantic not in ['arrival','departure'] or type(duration) is not int or not 15<=duration<=240:raise ValueError('commitment_proposal_invalid')
  try:at=datetime.fromisoformat(when.replace('Z','+00:00'));assert at.tzinfo is not None;at=at.astimezone(timezone.utc)
  except (ValueError,TypeError,AttributeError,AssertionError):raise ValueError('commitment_time_invalid')
  if not location_accessible(places,dest):raise ValueError('world_life_location_locked')
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
  cid='commitment-'+hashlib.sha256((role+'|'+session+'|'+key).encode()).hexdigest()[:36]
  proposal={'id':cid,'locationId':dest,'placeName':location_label(places,dest),'at':at.isoformat(),'timeKind':semantic,'durationMinutes':duration,'note':note,'activity':'赴约','status':'proposed','revision':1}
  row=db.execute('SELECT * FROM world_commitments WHERE id=?',(cid,)).fetchone()
  if row:
   old=json.loads(row['payload_json'])
   if any(old.get(k)!=proposal[k] for k in ['locationId','at','timeKind','durationMinutes','note']):raise ValueError('commitment_request_conflict')
   return {'commitment':{**old,'status':row['status']},'duplicate':True}
  if not now<at<=now+timedelta(days=7):raise ValueError('commitment_time_invalid')
  if db.execute("SELECT COUNT(*) FROM world_commitments WHERE role_id=? AND session_id=? AND status IN ('proposed','accepted','negotiate','awaiting_owner')",(role,session)).fetchone()[0]>=20:raise ValueError('commitment_inbox_full')
  if source:proposal['source']=source
  db.execute('INSERT INTO world_commitments VALUES(?,?,?,?,?,?,?,1,?,?)',(cid,role,session,role_mode(role),bank,json.dumps(proposal,ensure_ascii=False),'proposed',stamp,stamp))
  eid=self.life.runtime.character_events.enqueue_in(db,role,session,'commitment',cid,{'commitmentId':cid,'proposalRevision':1,'proposal':proposal,'origin':'commitment-v1','receivedWorldAt':now.isoformat()},stamp) if enqueue else ''
  state['commitments']=self.load(db,role,session)
  self.life._save(db,role,session,state,rev+1,stamp)
  return {'commitment':proposal,'eventId':eid}
 def cancel(self,args):
  stamp=self.life.stamp();key=identifier(args.get('id'))
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');role,session,world,state,rev,places,bank=self.scope(args,db,stamp)
   row=db.execute('SELECT * FROM world_commitments WHERE id=? AND role_id=? AND session_id=? AND identity_id=?',(key,role,session,bank)).fetchone()
   if not row:raise ValueError('commitment_missing')
   self.save(db,state,stamp);row=db.execute('SELECT * FROM world_commitments WHERE id=?',(key,)).fetchone();c=json.loads(row['payload_json'])
   if row['status'] in ['completed','missed','declined']:raise ValueError('commitment_closed')
   db.execute("UPDATE world_commitments SET status='cancelled',revision=revision+1,updated_at=? WHERE id=?",(stamp,key))
   db.execute("UPDATE character_event_queue SET status='superseded',finished_at=?,error='提议已取消，未插入旧回应。' WHERE kind='commitment' AND source_id=? AND status IN ('queued','waiting_configuration','generating')",(stamp,key))
   state['commitments']=self.load(db,role,session);self.life._save(db,role,session,state,rev+1,stamp)
  self.life.runtime.backup_manager.mark_dirty();return {'id':key,'status':'cancelled','alreadyTravelling':(state.get('enRoute') or {}).get('id')==key}
 def preview(self,row,event):
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   role,session,world,state,rev,places,bank=self.scope({'roleId':row['role_id'],'sessionId':row['session_id']},db,self.life.stamp())
   c_row=db.execute('SELECT * FROM world_commitments WHERE id=?',(event['commitmentId'],)).fetchone()
   if bank!=row['identity_id'] or not c_row or c_row['status']!='proposed' or c_row['revision']!=event['proposalRevision']:raise ValueError('commitment_stale')
   now=datetime.fromisoformat(self.life.stamp())+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));c=json.loads(c_row['payload_json']);routes={}
   for method in METHODS:
    try:routes[method]={'feasible':True,**self.plan(state,c,now,places,method)}
    except ValueError as e:routes[method]={'feasible':False,'reason':str(e)}
   return {'worldNow':now.isoformat(),'routes':routes,'rule':'不可行的路线只能拒绝或协商，不可用台词强行同意。'}
 def grant(self,role,session,expected_text=None,expected_message_id=None):
  try:meta=self.life.runtime.role_workspace.session({'roleId':role,'sessionId':session})
  except (ValueError,PermissionError):return None
  if meta.get('memoryPolicy')=='readonly' or meta.get('mode')!='character':return None
  with closing(self.life.runtime.connect()) as db:
   if expected_text is not None:
    saved=db.execute("SELECT id,text FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='' ORDER BY ordinal DESC LIMIT 1",(role,session)).fetchone()
    if not isinstance(expected_text,str) or not saved or saved['text'].strip()!=expected_text.strip() or expected_message_id is not None and saved['id']!=expected_message_id:return None
   active=self.life.identities.current(db,role_mode(role));records=[c for c in self.load(db,role,session) if c['status'] in ['proposed','accepted','negotiate','awaiting_owner']]
   if not records:return None
   row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone();epoch=json.loads(row[0]).get('experience',{}).get('dataEpoch') if row else None
   last=db.execute("SELECT COALESCE(MAX(ordinal),-1) FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at=''",(role,session)).fetchone()[0]
   return {'_commitmentRecords':records,'_commitmentRevisions':{c['id']:c['revision'] for c in records},'_commitmentBank':active['id'] if active else '', '_commitmentUserOrdinal':last,'expectedDataEpoch':epoch}
 def model_brief(self,grant):
  records=grant.get('_commitmentRecords',[]);out=[]
  for c in sorted(records,key=lambda c:(c['status']!='proposed',c['at'])):
   item={k:c[k] for k in ['id','status','at','timeKind','locationId'] if k in c}
   if len(json.dumps(out+[item],ensure_ascii=False,separators=(',',':')))<=720:out.append(item)
   if len(out)==3:break
  return json.dumps(out,ensure_ascii=False,separators=(',',':'))
 def model_decide(self,args):
  stamp=self.life.stamp();key=args['id'];action=args['action'];role=args['roleId'];session=args['sessionId'];decision={k:args[k] for k in ['action','reason','method'] if k in args}
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');_,_,_,current,_,_,bank=self.scope({'roleId':role,'sessionId':session},db,stamp);self.save(db,current,stamp)
   row=db.execute('SELECT * FROM world_commitments WHERE id=? AND role_id=? AND session_id=? AND identity_id=?',(key,role,session,bank)).fetchone()
   last=db.execute("SELECT COALESCE(MAX(ordinal),-1) FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at=''",(role,session)).fetchone()[0]
   if bank!=args['_commitmentBank'] or not row or row['revision']!=args['_commitmentRevisions'].get(key) or last!=args['_commitmentUserOrdinal']:raise ValueError('commitment_stale')
   c=json.loads(row['payload_json']);evidence={'source':'recipient-model-tool','callId':args['_commitmentCallId'],'at':stamp,'decision':action}
   if action in ['cancel','negotiate'] and row['status'] in ['accepted','negotiate','awaiting_owner'] or action=='cancel' and row['status']=='proposed':
    c.update(status='cancelled' if action=='cancel' else 'negotiate',reason=args['reason'],evidence=evidence)
    db.execute('UPDATE world_commitments SET payload_json=?,status=?,revision=revision+1,updated_at=? WHERE id=?',(json.dumps(c,ensure_ascii=False),c['status'],stamp,key))
   elif row['status']=='proposed' and action in ['accept','decline','negotiate']:
    c=self.decide_in(db,{'id':'model-tool-'+args['_commitmentCallId'],'role_id':role,'session_id':session,'identity_id':bank},{'commitmentId':key,'proposalRevision':row['revision']},decision,'',stamp)
    c['evidence']=evidence;db.execute('UPDATE world_commitments SET payload_json=? WHERE id=?',(json.dumps(c,ensure_ascii=False),key))
   else:raise ValueError('commitment_decision_invalid_for_status')
   db.execute("UPDATE character_event_queue SET status='superseded',error='角色已在当前聊天回应此约定。',finished_at=? WHERE kind='commitment' AND source_id=? AND status IN ('queued','waiting_configuration','generating')",(stamp,key))
  self.life.runtime.backup_manager.mark_dirty();return {'commitment':c,'changesUserLocation':False,'rule':'决定已记录；仍未出发或抵达，以后续实际在途账本为准。'}
 def plan(self,state,c,now,places,method):
  target=datetime.fromisoformat(c['at']);departure=target
  for _ in range(12):
   # Confirmed appointments have priority over a routine beginning at the same
   # instant. Forecast its origin just BEFORE that not-yet-started routine;
   # an actual earlier journey or overlapping accepted appointment still wins.
   projected=self.life.timeline.project(state,departure-timedelta(microseconds=1),places)
   if projected.get('enRoute'):raise ValueError('约定时间与当前在途行程冲突，需要重新商量。')
   origin=projected['roleLocation'];minutes=0 if scene_container(places,origin)==scene_container(places,c['locationId']) else route_terms(method,route_distance(places,origin,c['locationId']),(departure+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])).hour)[0]
   candidate=target-timedelta(minutes=minutes) if c['timeKind']=='arrival' else target
   if candidate==departure:break
   departure=candidate
  else:raise ValueError('路线与出发地点不稳定，需要重新商量。')
  if departure<=max(now,datetime.fromisoformat(state.get('timeline',{}).get('cursor',now.isoformat()))):raise ValueError('按当前路线或已推进的世界时间已来不及准时到达，需要重新商量。')
  arrival=departure+timedelta(minutes=minutes);end=arrival+timedelta(minutes=c['durationMinutes'])
  for old in state.get('commitments',[]):
   if old['id']!=c['id'] and old['status']=='accepted' and departure<datetime.fromisoformat(old['endAt']) and end>datetime.fromisoformat(old['departureAt']):raise ValueError('与已确认约定重叠，需要重新商量。')
  return {'origin':origin,'departureAt':departure.isoformat(),'arrivalAt':arrival.isoformat(),'endAt':end.isoformat(),'durationTravelMinutes':minutes,'method':method}
 def decide_in(self,db,row,event,decision,message_id,stamp):
  c_row=db.execute('SELECT * FROM world_commitments WHERE id=? AND role_id=? AND session_id=? AND identity_id=?',(event['commitmentId'],row['role_id'],row['session_id'],row['identity_id'])).fetchone()
  if not c_row or c_row['status']!='proposed' or c_row['revision']!=event['proposalRevision']:raise ValueError('commitment_stale')
  c=json.loads(c_row['payload_json']);role,session,world,meta=self.life.scope({'roleId':row['role_id'],'sessionId':row['session_id']})
  if meta.get('memoryPolicy')=='readonly':raise PermissionError('readonly_commitment_disabled')
  state,rev=self.life._state(db,role,session,world,meta,stamp);places=self.life.places(role,session,world,db);self.life._tick(state,stamp,places)
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));status={'accept':'accepted','decline':'declined','negotiate':'negotiate'}[decision['action']]
  if status=='accepted':
   # Fail closed if the model accepted an impossible request. Never publish a
   # misleading agreement, and do not silently turn its text into negotiation.
   c.update(self.plan(state,c,now,places,decision.get('method',state.get('transportMethod','walk'))))
   if c.get('source',{}).get('type')=='chat':status='awaiting_owner'
  c.update(status=status,reason=decision.get('reason',''),evidence={'source':'recipient-model','eventId':row['id'],'messageId':message_id,'at':stamp,'decision':decision['action']})
  db.execute('UPDATE world_commitments SET status=?,payload_json=?,revision=revision+1,updated_at=? WHERE id=?',(status,json.dumps(c,ensure_ascii=False),stamp,c['id']))
  state['commitments']=self.load(db,role,session);self.life._save(db,role,session,state,rev+1,stamp)
  return c
 def confirm(self,args):
  stamp=self.life.stamp();key=identifier(args.get('id'))
  if type(args.get('confirm')) is not bool:raise ValueError('commitment_confirmation_required')
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');role,session,world,state,rev,places,bank=self.scope(args,db,stamp)
   row=db.execute('SELECT * FROM world_commitments WHERE id=? AND role_id=? AND session_id=? AND identity_id=?',(key,role,session,bank)).fetchone()
   if not row or row['status']!='awaiting_owner' or row['revision']!=args.get('expectedRevision'):raise ValueError('commitment_confirmation_stale')
   c=json.loads(row['payload_json']);evidence=c.get('evidence',{})
   if c.get('source',{}).get('type')!='chat' or evidence.get('source') not in ['recipient-model','recipient-model-tool'] or evidence.get('decision')!='accept':raise PermissionError('commitment_recipient_consent_required')
   now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
   if args['confirm']:
    c.update(self.plan(state,c,now,places,c.get('method','walk')));status='accepted'
   else:status='cancelled'
   c.update(status=status,ownerConfirmedAt=stamp if args['confirm'] else '',ownerDecision='confirm' if args['confirm'] else 'keep-existing-schedule')
   db.execute('UPDATE world_commitments SET status=?,payload_json=?,revision=revision+1,updated_at=? WHERE id=?',(status,json.dumps(c,ensure_ascii=False),stamp,key))
   state['commitments']=self.load(db,role,session);self.life._save(db,role,session,state,rev+1,stamp)
  self.life.runtime.backup_manager.mark_dirty();return {'status':status,'changesUserLocation':False,'commitment':c}
