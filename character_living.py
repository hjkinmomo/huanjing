"""Editable fictional role content and bounded living decisions.

No model, billing or real-world action. Observations require exact co-location;
these records are fictional context, never durable facts about the human user.
"""
from contextlib import closing
from datetime import datetime,timedelta
from functools import lru_cache
from pathlib import Path
import hashlib,json,re,copy
from role_workspace import identifier
from persona_modes import role_mode
from phone_life_services import plain_binding_text
from scene_locations import location_accessible,location_path

@lru_cache(maxsize=1)
def drafts():
 root=Path(__file__).parent/'web/assets/experience'
 return (json.loads((root/'character-opening-config.json').read_text('utf-8'))['roles'],json.loads((root/'character-life-config.json').read_text('utf-8'))['roles'])

class CharacterLiving:
 def __init__(self,life,db):
  self.life=life
  db.executescript('''CREATE TABLE IF NOT EXISTS character_content(role_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS character_living(role_id TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS role_living_tasks(id TEXT PRIMARY KEY,role_id TEXT NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);''')
  for name,fn,write in [('role_content_get',self.get,False),('role_content_save',self.save,True),('role_living_action',self.action,True)]:
   life.runtime.registry.register(name,'Owner UI editable fictional character life; not a model/MCP tool.',mutating=write)(fn)
 def content(self,db,role):
  row=db.execute('SELECT * FROM character_content WHERE role_id=?',(role,)).fetchone()
  if row:return json.loads(row['payload_json']),row['revision']
  opening,life=drafts();return copy.deepcopy({'openings':opening.get(role,{}),'life':life.get(role,{}),'source':'user-authorized-editable-draft-20261014'}),0
 def get(self,args):
  role=identifier(args.get('roleId'),80)
  with closing(self.life.runtime.connect()) as db:
   value,rev=self.content(db,role);row=db.execute('SELECT state_json FROM character_living WHERE role_id=?',(role,)).fetchone()
  return {'roleId':role,'content':value,'revision':rev,'living':json.loads(row['state_json']) if row else {}}
 def validate(self,value,places):
  if not isinstance(value,dict) or set(value)-{'openings','life','source'}:raise ValueError('role_content_invalid')
  if len(json.dumps(value,ensure_ascii=False))>60000:raise ValueError('role_content_too_large')
  openings=value.get('openings',{})
  if not isinstance(openings,dict) or set(openings)-{'new','familiar','trusted','intimate','romantic'}:raise ValueError('role_content_stage_invalid')
  for item in openings.values():
   if not isinstance(item,dict) or set(item)-{'label','prehistory','toneReminder'}:raise ValueError('role_content_stage_invalid')
   for key,text in item.items():
    if not isinstance(text,str) or len(text)>(40 if key=='label' else 4000):raise ValueError('role_content_stage_invalid')
  life=value.get('life',{})
  if not isinstance(life,dict) or set(life)-{'source','basis','schedule','greetingText','mealText','reactionTones','dailyOptions','wishes','outline','transportMethod','homeLocation'}:raise ValueError('role_content_life_invalid')
  if life.get('homeLocation') is not None and not location_accessible(places,life['homeLocation']):raise ValueError('role_home_location_invalid')
  if life.get('transportMethod','walk') not in ['walk','bike','bus','taxi']:raise ValueError('role_transport_method_invalid')
  if life.get('schedule'):self.life.validate_schedule(life['schedule'],places)
  for k in ['greetingText','mealText']:
   if k in life and (not isinstance(life[k],str) or len(life[k])>300):raise ValueError('role_content_template_invalid')
  tones=life.get('reactionTones',[])
  if not isinstance(tones,list) or len(tones)>8 or any(not isinstance(t,dict) or set(t) not in ({'minScore','text'},{'context','text'}) or 'minScore' in t and (type(t['minScore']) not in (int,float) or not 0<=t['minScore']<=1000) or 'context' in t and (not isinstance(t['context'],str) or not 1<=len(t['context'])<=40) or not isinstance(t['text'],str) or len(t['text'])>4000 for t in tones):raise ValueError('role_content_tone_invalid')
  options=life.get('dailyOptions',{})
  if not isinstance(options,dict) or set(options)-{'outfits','moods','gestures'} or any(not isinstance(v,list) or len(v)>12 or any(not isinstance(s,str) or not 1<=len(s)<=200 for s in v) for v in options.values()):raise ValueError('role_content_daily_invalid')
  wishes=life.get('wishes',[])
  if not isinstance(wishes,list) or len(wishes)>12:raise ValueError('role_content_wish_invalid')
  ids=set()
  for w in wishes:
   if not isinstance(w,dict) or set(w)-{'id','title','channel','status','minHour','maxHour','destination','locations','moods','declines'}:raise ValueError('role_content_wish_invalid')
   wid=identifier(w.get('id'),60)
   if wid in ids or not isinstance(w.get('title'),str) or not 1<=len(w['title'])<=300 or w.get('channel') not in ['proposal','self','hint']:raise ValueError('role_content_wish_invalid')
   ids.add(wid)
   if type(w.get('minHour')) is not int or type(w.get('maxHour')) is not int or not 0<=w['minHour']<=w['maxHour']<=23:raise ValueError('role_content_wish_time_invalid')
   if w.get('destination') and not location_accessible(places,w['destination']):raise ValueError('role_content_wish_location_invalid')
   for k in ['locations','moods']:
    if not isinstance(w.get(k,[]),list) or len(w.get(k,[]))>12 or any(not isinstance(s,str) for s in w.get(k,[])):raise ValueError('role_content_wish_condition_invalid')
   if any(s not in places for s in w.get('locations',[])):raise ValueError('role_content_wish_location_invalid')
  outline=life.get('outline',{})
  if not isinstance(outline,dict) or set(outline)-{'goal','steps'} or not isinstance(outline.get('goal',''),str) or len(outline.get('goal',''))>1000:raise ValueError('role_content_outline_invalid')
  if not isinstance(outline.get('steps',[]),list) or len(outline.get('steps',[]))>12:raise ValueError('role_content_outline_invalid')
  for s in outline.get('steps',[]):
   if not isinstance(s,dict) or set(s)-{'id','text','status'} or not isinstance(s.get('text'),str) or len(s['text'])>500 or s.get('status') not in ['planned','active','complete','reconsider']:raise ValueError('role_content_outline_invalid')
   identifier(s.get('id'),60)
 def save(self,args):
  role=identifier(args.get('roleId'),80);stamp=self.life.stamp();world=self.life.shared.world(role_mode(role));places={p['id']:p for p in world['locations']};value=args.get('content');self.validate(value,places)
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');old,rev=self.content(db,role)
   if type(args.get('expectedRevision')) is not int or args['expectedRevision']!=rev:raise ValueError('role_content_revision_conflict')
   value={**value,'source':'user-edited'}
   db.execute('INSERT INTO character_content VALUES(?,?,?,?) ON CONFLICT(role_id) DO UPDATE SET payload_json=excluded.payload_json,revision=excluded.revision,updated_at=excluded.updated_at',(role,json.dumps(value,ensure_ascii=False),rev+1,stamp))
   key='content-'+role+'-'+str(rev+1)
   db.execute('INSERT INTO role_living_tasks VALUES(?,?,?,?,?,?)',(key,role,'life-outline',json.dumps(value.get('life',{}).get('outline',{}),ensure_ascii=False),'ready',stamp))
  self.life.runtime.backup_manager.mark_dirty();return self.get({'roleId':role})
 def sync_outline_memory(self,db,role,task,outline,stamp):
  # Use the existing scoped memory pipeline. Respect owner edits/forgetting;
  # a generated fictional goal must never restore a removed memory.
  key='outline-'+hashlib.sha256(role.encode()).hexdigest()[:40]
  prior=db.execute('SELECT state,origin FROM role_memories WHERE id=? AND role_id=?',(key,role)).fetchone()
  if prior and (prior['state']!='active' or prior['origin']!='owner-world-outline'):return
  text=('在这个虚构世界中，你当前的人生目标是：'+str(outline.get('goal',''))+'。下一步：'+'；'.join(str(s.get('text','')) for s in outline.get('steps',[]))+ '。这是角色故事大纲，不是现实用户事实。')[:1600]
  evidence=json.dumps([{'taskId':task['id'],'source':'role-living-task','kind':task['kind'],'fictional':True}],ensure_ascii=False)
  db.execute("INSERT INTO role_memories(id,role_id,topic,kind,text,state,evidence_json,origin,supersedes,revision,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?,'',1,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,evidence_json=excluded.evidence_json,revision=role_memories.revision+1,updated_at=excluded.updated_at",(key,role,'故事人生大纲','fiction',text,evidence,'owner-world-outline',stamp,stamp))
 def state(self,db,role):
  row=db.execute('SELECT state_json FROM character_living WHERE role_id=?',(role,)).fetchone()
  return json.loads(row['state_json']) if row else {'daily':{},'wishes':{},'knowledge':{},'events':[],'outline':{}}
 def store(self,db,role,state,stamp):
  db.execute('INSERT INTO character_living VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at',(role,json.dumps(state,ensure_ascii=False),stamp))
 def action(self,args):
  role=identifier(args.get('roleId'),80);action=args.get('action');stamp=self.life.stamp()
  if action not in ['accept','decline','complete','shelve','reconsider']:raise ValueError('role_living_action_invalid')
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');state=self.state(db,role);wid=args.get('wishId');wish=state['wishes'].get(wid)
   if action=='reconsider':
    goal=args.get('goal','').strip()
    if not goal or len(goal)>1000:raise ValueError('role_content_outline_invalid')
    state['outline']={**state.get('outline',{}),'goal':goal,'needsRevision':False,'source':'user-edited'}
    key='reconsider-'+role+'-'+hashlib.sha256(stamp.encode()).hexdigest()[:16]
    db.execute('INSERT OR IGNORE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(key,role,'life-outline',json.dumps(state['outline'],ensure_ascii=False),'ready',stamp))
   else:
    if not wish or wish.get('status') not in ['triggered','brewing','shelved']:raise ValueError('role_living_wish_not_active')
    if action=='decline':
     wish['declines']=wish.get('declines',0)+1;wish['status']='shelved' if wish['declines']>=2 else 'brewing';wish['lastDay']=state['daily'].get('day');state['outline']['needsRevision']=True;state['outline']['rejectedWish']=wish['title']
     key='rewrite-'+role+'-'+str(len(state['events']))+'-'+hashlib.sha256(stamp.encode()).hexdigest()[:12]
     db.execute('INSERT OR IGNORE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(key,role,'life-outline-rewrite',json.dumps({'rejectedWish':wish['title'],'instruction':'保留角色自己的目标，重新选择不需要用户参与的下一步。'},ensure_ascii=False),'ready',stamp))
    elif action=='accept':wish['status']='brewing';wish['accepted']=True;wish['lastDay']=state['daily'].get('day')
    else:wish['status']='fulfilled' if action=='complete' else 'shelved'
   state['events']=[{'kind':action,'wishId':wid,'at':stamp,'source':'owner-choice'},*state['events']][:80];self.store(db,role,state,stamp)
  self.life.runtime.backup_manager.mark_dirty();return self.get({'roleId':role})
 def tick(self,db,role,session,worldstate,stamp,places,actors):
  if role in ['world-user','special.world-user']:return False
  content,_=self.content(db,role);config=content.get('life',{});state=self.state(db,role);old=json.dumps(state,sort_keys=True);world=datetime.fromisoformat(stamp)+timedelta(seconds=worldstate['timePolicy'].get('clockOffsetSeconds',0));local=world+timedelta(minutes=worldstate['timePolicy']['utcOffsetMinutes']);day=local.date().isoformat()
  if worldstate.get('autonomy',{}).get('enabled') and state['daily'].get('day')!=day:
   daily={'day':day,'source':'editable-persona-draft','at':world.isoformat()}
   for key,items in config.get('dailyOptions',{}).items():
    if items:daily[key]=items[int(hashlib.sha256((role+day+key).encode()).hexdigest()[:8],16)%len(items)]
   state['daily']=daily
  arrival=worldstate.get('lastArrival')
  if arrival and arrival.get('source')=='wish' and state.get('lastWishArrival')!=arrival['id']:
   wish=state['wishes'].get(arrival.get('wishId'))
   if wish:
    wish['status']='fulfilled';self.publish_wish(db,role,worldstate,stamp,arrival['id'],wish)
   state['lastWishArrival']=arrival['id']
  state['outline']=state.get('outline') or {**config.get('outline',{}),'source':'editable-persona-draft'}
  if arrival and arrival.get('goalPlanId') and state.get('lastGoalArrival')!=arrival['id']:
   step=next((s for s in state['outline'].get('steps',[]) if s.get('id')==arrival.get('outlineStepId')),None)
   if step and step.get('status') in ['planned','reconsider']:step['status']='active';step['startedAt']=arrival['dueAt']
   state['events'].insert(0,{'kind':'goal-step-started','stepId':arrival.get('outlineStepId'),'at':arrival['dueAt'],'source':'recorded-arrival','planId':arrival['goalPlanId']})
   state['lastGoalArrival']=arrival['id']
  goal_active=arrival and arrival.get('goalPlanId') and arrival.get('holdUntil','')>world.isoformat() and worldstate['activity']==arrival.get('activity')
  if worldstate.get('autonomy',{}).get('enabled') and not worldstate.get('enRoute') and not goal_active and 8<=local.hour<23:
   own={p['id'] for p in location_path(places,worldstate['roleLocation'])}
   count=sum(1 for w in state['wishes'].values() if w.get('lastDay')==day)
   for draft in config.get('wishes',[]):
    wish=state['wishes'].setdefault(draft['id'],{**draft,'status':'thinking','declines':0})
    for field in ['title','channel','minHour','maxHour','destination','locations','moods']:
     if field in draft:wish[field]=draft[field]
    if wish['status'] in ['fulfilled','shelved'] or wish.get('accepted') or wish.get('lastDay')==day:continue
    if wish['status']=='thinking':wish['status']='brewing';continue
    if count>=1 or not draft['minHour']<=local.hour<=draft['maxHour'] or draft.get('locations') and not own.intersection(draft['locations']) or draft.get('moods') and state['daily'].get('moods') not in draft['moods']:continue
    wish['status']='triggered';wish['lastDay']=day;wish['at']=world.isoformat();count+=1
    key='wish-'+draft['id']+'-'+day
    if draft['channel']=='proposal':self.life.journal.message(db,role,session,worldstate,stamp,key,'今天有个小想法：'+wish['title']+'。你愿意一起吗？')
    elif draft['channel']=='self' and draft.get('destination') in places:
     self.life.journeys.start(worldstate,stamp,places,draft['destination'],key,config.get('transportMethod','walk'),wish['title'],'wish');wish['status']='en-route'
     worldstate['enRoute']['wishId']=draft['id']
     self.life.journal.log(db,role,session,key,worldstate,world,'出发 · '+wish['title'],'wish-departure',draft['destination'])
    # hint remains in private prompt; it does not become a remote message.
    state['events'].insert(0,{'kind':'wish-'+draft['channel'],'title':wish['title'],'at':world.isoformat(),'source':'editable-persona-draft'})
    break
  # Direct, unquoted user refusals can rewrite an active proposal, once per turn.
  last=db.execute("SELECT id,text,ordinal FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='' ORDER BY ordinal DESC LIMIT 1",(role,session)).fetchone()
  if last and last['id']!=state.get('lastChoiceMessage'):
   text=plain_binding_text(last['text']);state['lastChoiceMessage']=last['id']
   if not re.search(r'引用|举例|假设|小说|台词|演示',text) and re.search(r'不想|不去|不了|没空|取消|不要',text):
    target=next((w for w in state['wishes'].values() if w['status']=='triggered' and w['channel']=='proposal'),None)
    prior=db.execute("SELECT o.event_id FROM conversation_messages c LEFT JOIN world_message_origins o ON o.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.sender='assistant' AND c.deleted_at='' AND c.ordinal<? ORDER BY c.ordinal DESC LIMIT 1",(role,session,last['ordinal'])).fetchone()
    relevant=target and (prior and (prior['event_id'] or '').startswith('wish-'+target['id']+'-') or re.search(r'(?:这个|那个|刚才的)(?:愿望|邀请)',text))
    if relevant:
     target['declines']+=1;target['status']='shelved' if target['declines']>=2 else 'brewing';state['outline']['needsRevision']=True;state['outline']['rejectedWish']=target['title']
     db.execute('INSERT OR IGNORE INTO role_living_tasks VALUES(?,?,?,?,?,?)',('refusal-'+last['id'],role,'life-outline-rewrite',json.dumps({'rejectedWish':target['title']},ensure_ascii=False),'ready',stamp))
  tasks=db.execute("SELECT * FROM role_living_tasks WHERE role_id=? AND kind IN ('life-outline','life-outline-rewrite') AND status='ready' ORDER BY created_at LIMIT 4",(role,)).fetchall()
  for task in tasks:
   payload=json.loads(task['payload_json'])
   if task['kind']=='life-outline':state['outline']={**payload,'source':'user-edited'}
   else:
    ownstep=next((w['title'] for w in config.get('wishes',[]) if w['channel']=='self'),'留出自己的休息时间')
    state['outline']['steps']=[{'id':'after-refusal','text':ownstep,'status':'planned'}];state['outline']['needsRevision']=False;state['outline']['revisedAfterRejection']=payload.get('rejectedWish');state['outline']['source']='bounded-event-rewrite'
   self.sync_outline_memory(db,role,task,state['outline'],stamp)
   db.execute("UPDATE role_living_tasks SET status='done' WHERE id=?",(task['id'],))
  state['events']=state['events'][:80]
  changed=old!=json.dumps(state,sort_keys=True)
  if changed:self.store(db,role,state,stamp)
  return changed
 def publish_wish(self,db,role,worldstate,stamp,key,wish):
  # Existing social schema and snapshot audience; never a new looping engine.
  mid='wish-'+hashlib.sha256((role+key).encode()).hexdigest()[:40]
  source='social:'+mid
  db.execute("INSERT OR IGNORE INTO life_events VALUES(?,?,?,?,?,?,?,'','')",(source,'fiction-moment',mid,role,'shared',json.dumps({'origin':'local-fiction','worldUtc':wish['at'],'automatic':True,'source':'editable-persona-draft'},ensure_ascii=False),stamp))
  db.execute("INSERT OR IGNORE INTO moments VALUES(?,?,?,?,?,?,?,?,?,'')",(mid,role,'shared',wish['title'],json.dumps([source]),'[]','published',stamp,stamp))
  db.execute('INSERT OR IGNORE INTO moment_client_state VALUES(?,?,?,?,?,1)',(mid,role,'','local-fiction',0))
  if hasattr(self.life.runtime,'moment_reactions'):self.life.runtime.moment_reactions.publish_in(db,mid,role,role,stamp)
 def output(self,db,role):
  state=self.state(db,role)
  return {'daily':state.get('daily',{}),'wishes':list(state.get('wishes',{}).values()),'outline':state.get('outline',{}),'present':state.get('present',[]),'knowledge':state.get('knowledge',{}),'events':state.get('events',[])[:12]}
