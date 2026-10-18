"""Bounded, model-authored goal plans using the existing scoped life task bank.

Only validated future blocks become departures. No model output completes an
outline, writes dialogue, moves the user, or changes another role's routine.
"""
from contextlib import closing
from datetime import datetime,timedelta
import copy,hashlib,json,re
from persona_modes import role_mode
from scene_locations import scene_container,location_accessible,location_label
from character_event_context import messages_with_context

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def minute(value):
 if not isinstance(value,str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',value):raise ValueError('day_plan_time_invalid')
 return int(value[:2])*60+int(value[3:])

def protected(activity):
 if re.search('睡|就寝',activity):return True
 if re.search('下班|休假|休息|自由|闲暇|午餐|晚餐|简餐|把工作留在',activity):return False
 return bool(re.search('工作|办公|上班|值班|课程|上课|选修课|教学|课堂|上学|直播|出诊|授课',activity))

class DayPlanning:
 def __init__(self,life,db):
  self.life=life
  for row in db.execute("SELECT id,payload_json FROM role_living_tasks WHERE kind='day-plan' AND status='running'").fetchall():
   p=json.loads(row['payload_json']);p['error']='day_plan_interrupted';db.execute("UPDATE role_living_tasks SET status='failed',payload_json=? WHERE id=?",(json.dumps(p,ensure_ascii=False),row['id']))
  life.runtime.registry.register('world_day_plan_retry','Owner explicitly retries a failed current-day role plan; not a model tool.',mutating=True)(self.retry)
 def outline(self,db,role):
  state=self.life.living.state(db,role);content,_=self.life.living.content(db,role)
  return state.get('outline') or content.get('life',{}).get('outline',{})
 def version(self,db,role):
  content,revision=self.life.living.content(db,role)
  outline=self.outline(db,role)
  # Arrival changes planned -> active; it must not schedule another model call.
  canonical={'goal':outline.get('goal',''),'steps':[{'id':s.get('id'),'text':s.get('text'),'state':'complete' if s.get('status')=='complete' else 'open'} for s in outline.get('steps',[])]}
  return digest({'outline':canonical,'contentRevision':revision,'schedule':content.get('life',{}).get('schedule'),'home':content.get('life',{}).get('homeLocation')})
 def allowed(self,db,role,state,places):
  content,_=self.life.living.content(db,role);config=content.get('life',{});ids={s['locationId'] for s in state['schedule']['slots']}
  ids.update(w['destination'] for w in config.get('wishes',[]) if w.get('destination'));ids.add(state.get('homeLocation'))
  ids.update(p for p in ['cafe','library','park','bookstore'] if p in places)
  containers={scene_container(places,p) for p in ids if p in places}
  return {pid for pid in places if location_accessible(places,pid) and (pid in ids or scene_container(places,pid) in containers)}
 def windows(self,state,now,places,allowed):
  zone=timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);local=now+zone;origin=local.replace(hour=0,minute=0,second=0,microsecond=0);blocked=[];slots=state['schedule']['slots']
  for i,slot in enumerate(slots):
   if protected(slot['activity']):blocked.append((minute(slot['at']),minute(slots[i+1]['at']) if i+1<len(slots) else 1440))
  for c in state.get('commitments',[]):
   if c.get('status')=='accepted':blocked.append(((datetime.fromisoformat(c['departureAt'])+zone-origin).total_seconds()/60,(datetime.fromisoformat(c['endAt'])+zone-origin).total_seconds()/60))
  trip=state.get('enRoute');hold=state.get('overrideWorldUntil')
  if trip:hold=trip.get('holdUntil') or (datetime.fromisoformat(trip['dueAt'])+timedelta(hours=0 if trip.get('source')=='routine' else 2)).isoformat()
  if hold:blocked.append((0,(datetime.fromisoformat(hold)+zone-origin).total_seconds()/60))
  free=[(max(480,local.hour*60+local.minute+5),1380)]
  for a,b in sorted(blocked):
   free=[part for x,y in free for part in [(x,min(a,y)),(max(b,x),y)] if part[1]-part[0]>=30]
  windows=[]
  for a,b in free:
   start=int(a)
   while b-start>=30 and len(windows)<6:
    end=min(int(b),start+90);at=origin+timedelta(minutes=start)-zone;projected=self.life.timeline.project(state,at,places)
    if not projected.get('enRoute') and not (projected.get('overrideWorldUntil') and datetime.fromisoformat(projected['overrideWorldUntil'])>at):
     destinations=[]
     for pid in sorted(allowed):
      trial=copy.deepcopy(projected);route=self.life.journeys.start(trial,(at-timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat(),places,pid,'goal-window-check',state.get('transportMethod','walk'),'规划试算','goal-plan')
      if route['durationMinutes']+10<=end-start:destinations.append(pid)
     if destinations:windows.append({'id':'free-'+str(start)+'-'+str(end),'at':f'{start//60:02d}:{start%60:02d}','until':f'{end//60:02d}:{end%60:02d}','placeIds':destinations})
    start=end+15
  return windows
 def capture(self,db,role,session,state,stamp,places):
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));local=now+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
  outline=copy.deepcopy(self.outline(db,role));steps=[s for s in outline.get('steps',[]) if s.get('status') in ['planned','active','reconsider']]
  allowed=self.allowed(db,role,state,places);identity=self.life.identities.current(db,role_mode(role))
  return {'sessionId':session,'day':local.date().isoformat(),'goalVersion':self.version(db,role),'identityId':identity['id'] if identity else '',
    'worldUtc':now.isoformat(),'localTime':local.strftime('%H:%M'),'utcOffsetMinutes':state['timePolicy']['utcOffsetMinutes'],
    'goal':str(outline.get('goal',''))[:1000],'steps':steps[:12],'locationId':state['roleLocation'],'activity':state['activity'],'enRoute':state.get('enRoute'),
    'routine':state['schedule']['slots'],'commitments':[c for c in state.get('commitments',[]) if c.get('status')=='accepted'],
    'places':[{'id':pid,'name':location_label(places,pid)} for pid in sorted(allowed)][:100],'freeWindows':self.windows(state,now,places,allowed)}
 def prepare(self,db,role,session,state,stamp,places,queue=True):
  outline=self.outline(db,role);now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));local=now+timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);day=local.date().isoformat()
  rows=db.execute("SELECT * FROM role_living_tasks WHERE role_id=? AND kind='day-plan' ORDER BY rowid DESC LIMIT 80",(role,)).fetchall()
  plans={};version=self.version(db,role)
  for row in rows:
   p=json.loads(row['payload_json'])
   if p.get('sessionId')!=session:continue
   if row['status']=='done' and p.get('day') not in plans and p.get('day','')>=(local.date()-timedelta(days=2)).isoformat():
    blocks=p.get('blocks',[])
    if p['day']==day and p.get('goalVersion')!=version:blocks=[b for b in blocks if b['until']<=local.strftime('%H:%M')]
    plans[p['day']]={'day':p['day'],'blocks':blocks,'goalVersion':p.get('goalVersion'),'taskId':row['id']}
  state['goalPlans']=list(plans.values())[:3]
  if not state.get('autonomy',{}).get('enabled') or not state['schedule']['enabled']:
   state['dayPlanning']={'status':'disabled'};return
  if state.get('scheduleManual'):
   state['dayPlanning']={'status':'manual'};return
  options=db.execute('SELECT memory_policy FROM chat_session_options WHERE role_id=? AND session_id=?',(role,session)).fetchone()
  if options and options[0]=='readonly':return
  if not outline.get('goal') or not any(s.get('status') in ['planned','active','reconsider'] for s in outline.get('steps',[])):
   state['dayPlanning']={'status':'no-active-goal'};return
  key='day-plan-'+digest([role,session,day,version])[:40]
  row=next((r for r in rows if r['id']==key),None)
  if not row:
   if not queue:state['dayPlanning']={'status':'ready'};return
   # Owner edits may invalidate a plan, but polling cannot create a model loop.
   count=sum(json.loads(r['payload_json']).get('sessionId')==session and json.loads(r['payload_json']).get('day')==day for r in rows)
   if count>=3:state['dayPlanning']={'status':'revision-limit','message':'今天目标修改较多，保留已知作息，稍后可手动安排。'};return
   payload=self.capture(db,role,session,state,stamp,places)
   db.execute('INSERT OR IGNORE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(key,role,'day-plan',json.dumps(payload,ensure_ascii=False),'ready',stamp))
   status='ready'
  else:status=row['status'];payload=json.loads(row['payload_json'])
  error=payload.get('error','');issue='model' if error.startswith('day_plan_model_failed') else 'interrupted' if error=='day_plan_interrupted' else 'plan'
  state['dayPlanning']={'id':key,'day':day,'status':status,'message':error,'issue':issue if status=='failed' else '', 'plannedBlocks':len(payload.get('blocks',[])),'source':'model-goal-plan' if status=='done' else 'persona-routine-fallback'}
 def claim(self,db):
  rows=db.execute("SELECT t.*,p.profile_json FROM role_living_tasks t LEFT JOIN character_event_roles p ON p.role_id=t.role_id WHERE t.kind='day-plan' AND t.status IN ('ready','waiting_configuration') ORDER BY t.created_at LIMIT 80").fetchall()
  for row in rows:
   job=dict(row);p=json.loads(job['payload_json']);role=job['role_id'];session=p['sessionId']
   if not self.life.runtime.character_events.session_valid(db,role,session):db.execute("UPDATE role_living_tasks SET status='stale' WHERE id=?",(job['id'],));continue
   record=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
   if not record:continue
   state=json.loads(record[0]);places=self.life.places(role,session,self.life.shared.world(role_mode(role)),db);current=self.capture(db,role,session,state,self.life.stamp(),places)
   if not state.get('autonomy',{}).get('enabled') or not state['schedule']['enabled'] or any(current.get(k)!=p.get(k) for k in ['day','goalVersion','identityId']):db.execute("UPDATE role_living_tasks SET status='stale' WHERE id=?",(job['id'],));continue
   if not job.get('profile_json') or job['profile_json']=='{}' or not self.life.runtime.auto_moments.resolve_provider:
    db.execute("UPDATE role_living_tasks SET status='waiting_configuration' WHERE id=?",(job['id'],));continue
   if db.execute("SELECT 1 FROM tasks WHERE role_id=? AND status IN ('running','cancelling')",(role,)).fetchone():continue
   db.execute("UPDATE role_living_tasks SET status='running',payload_json=? WHERE id=?",(json.dumps(current,ensure_ascii=False),job['id']));job['payload_json']=json.dumps(current,ensure_ascii=False);return job
 def validate(self,value,payload,state,places):
  if not isinstance(value,dict) or set(value)!={'blocks'} or not isinstance(value['blocks'],list) or len(value['blocks'])>3:raise ValueError('day_plan_format_invalid')
  current=datetime.fromisoformat(self.life.stamp())+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0),minutes=state['timePolicy']['utcOffsetMinutes'])
  if current.date().isoformat()!=payload['day']:raise ValueError('day_plan_day_changed')
  allowed={p['id'] for p in payload['places']};stepids={s['id'] for s in payload['steps']};result=[];last=current.hour*60+current.minute
  slots=state['schedule']['slots'];day=current.replace(hour=0,minute=0,second=0,microsecond=0)
  for block in sorted(value['blocks'],key=lambda b:next((w['at'] for w in payload.get('freeWindows',[]) if w['id']==b.get('windowId')),b.get('at','')) if isinstance(b,dict) else ''):
   if isinstance(block,dict) and set(block)=={'windowId','locationId','activity','outlineStepId'}:
    window=next((w for w in payload.get('freeWindows',[]) if w['id']==block['windowId']),None)
    if not window or block['locationId'] not in window['placeIds']:raise ValueError('day_plan_window_invalid')
    block={k:v for k,v in block.items() if k!='windowId'};block.update(at=window['at'],until=window['until'])
   if not isinstance(block,dict) or set(block)!={'at','until','locationId','activity','outlineStepId'}:raise ValueError('day_plan_block_invalid')
   start,end=minute(block['at']),minute(block['until'])
   if not max(8*60,last+1)<=start<end<=23*60 or not 15<=end-start<=180:raise ValueError('day_plan_window_invalid')
   if block['locationId'] not in allowed or not location_accessible(places,block['locationId']) or block['outlineStepId'] not in stepids:raise ValueError('day_plan_scope_invalid')
   if not isinstance(block['activity'],str) or not 1<=len(block['activity'].strip())<=80:raise ValueError('day_plan_activity_invalid')
   for i,slot in enumerate(slots):
    a=minute(slot['at']);b=minute(slots[i+1]['at']) if i+1<len(slots) else 1440
    if protected(slot['activity']) and max(a,start)<min(b,end):raise ValueError('day_plan_routine_conflict')
   for c in payload.get('commitments',[]):
    a=datetime.fromisoformat(c['departureAt'])+timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);b=datetime.fromisoformat(c['endAt'])+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
    if day+timedelta(minutes=start)<b and a<day+timedelta(minutes=end):raise ValueError('day_plan_commitment_conflict')
   world_at=day+timedelta(minutes=start-state['timePolicy']['utcOffsetMinutes']);projected=self.life.timeline.project(state,world_at,places)
   if projected.get('enRoute') or projected.get('overrideWorldUntil') and datetime.fromisoformat(projected['overrideWorldUntil'])>world_at:raise ValueError('day_plan_route_conflict')
   trial=copy.deepcopy(projected);trip=self.life.journeys.start(trial,(world_at-timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat(),places,block['locationId'],'goal-route-check',state.get('transportMethod','walk'),block['activity'],'goal-plan')
   if trip['durationMinutes']+10>end-start:raise ValueError('day_plan_travel_too_long')
   result.append({**block,'activity':block['activity'].strip()});last=end
  return result
 def generate(self,job):
  try:
   p=json.loads(job['payload_json']);profile=json.loads(job['profile_json']);role=job['role_id'];session=p['sessionId']
   context={k:p[k] for k in ['day','worldUtc','localTime','goal','steps','locationId','activity','enRoute','routine','commitments','places','freeWindows']}
   context['protectedRoutineRule']='不得占用工作、课程、直播和睡眠时段；保留已经答应的约定。'
   instruction='你在这个虚构世界中自主安排自己的今天。依据自己的人设、人生目标和未完成步骤，从freeWindows中自主选择0至3个具体活动，也可以选择休息、不推进。窗口已避开工作、睡眠、约定和已知行程，时间由窗口决定，不另填at或until。每个窗口最多选一次，按窗口时间先后返回；地点只选该窗口placeIds里的id，步骤只选steps里的id。不可修改人格、替用户安排动作或声称目标已完成。只返回JSON：{"blocks":[{"windowId":"freeWindows里的id","locationId":"这个窗口可达的地点id","activity":"本次具体活动","outlineStepId":"步骤id"}]}。没有合适窗口或今天不想推进则返回{"blocks":[]}。'
   with closing(self.life.runtime.connect()) as db:
    agent=db.execute('SELECT settings_json FROM role_agents WHERE role_id=?',(role,)).fetchone();settings=json.loads(agent[0]) if agent else {}
   provider=self.life.runtime.auto_moments.resolve_provider({**profile['provider'],'roleId':role})
   messages=messages_with_context(profile,context,instruction,{**settings,'maxTokens':1200})
   response=self.life.runtime.proxy_provider_request({'route':'chat','roleId':role,'provider':provider,'body':{'model':provider['model'],'messages':messages,'stream':False,'max_tokens':1200},'roleSkills':{'enabled':False,'context':'story'}})
   if response.get('ok') is False:
    status=response.get('httpStatus');raise ValueError('day_plan_model_failed'+('_http_'+str(status) if type(status) is int and 400<=status<=599 else ''))
   choice=response.get('payload',{}).get('choices',[{}])[0]
   if choice.get('finish_reason')=='length':raise ValueError('day_plan_truncated')
   raw=choice.get('message',{}).get('content','').strip()
   if raw.startswith('```'):raw=re.sub(r'^```(?:json)?\s*|\s*```$','',raw)
   value=json.loads(raw)
   with self.life.lock,closing(self.life.runtime.connect()) as db,db:
    if self.life.runtime._stop.is_set():return
    row=db.execute('SELECT status FROM role_living_tasks WHERE id=?',(job['id'],)).fetchone();saved=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone();identity=self.life.identities.current(db,role_mode(role))
    if not row or row[0]!='running' or not saved or not self.life.runtime.character_events.session_valid(db,role,session) or p['identityId']!=(identity['id'] if identity else '') or p['goalVersion']!=self.version(db,role):return self.stale(db,job['id'])
    state=json.loads(saved[0]);places=self.life.places(role,session,self.life.shared.world(role_mode(role)),db)
    if not state.get('autonomy',{}).get('enabled') or not state['schedule']['enabled']:return self.stale(db,job['id'])
    # Re-read commitments after generation; a new appointment wins the race.
    p['commitments']=self.life.commitments.load(db,role,session);p['blocks']=self.validate(value,p,state,places);p['acceptedWorldAt']=(datetime.fromisoformat(self.life.stamp())+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat();p['source']='model-goal-plan'
    db.execute("UPDATE role_living_tasks SET status='done',payload_json=? WHERE id=?",(json.dumps(p,ensure_ascii=False),job['id']))
   self.life.runtime.backup_manager.mark_dirty()
  except Exception as error:
   # No credentials, provider text or private prompts are saved in diagnostics.
   code=str(error) if isinstance(error,ValueError) and str(error).startswith('day_plan_') else 'day_plan_generation_failed'
   with closing(self.life.runtime.connect()) as db,db:
    row=db.execute('SELECT payload_json FROM role_living_tasks WHERE id=? AND status=\'running\'',(job['id'],)).fetchone()
    if row:
     p=json.loads(row[0]);p['error']=code;db.execute("UPDATE role_living_tasks SET status='failed',payload_json=? WHERE id=?",(json.dumps(p,ensure_ascii=False),job['id']))
 def stale(self,db,key):db.execute("UPDATE role_living_tasks SET status='stale' WHERE id=?",(key,))
 def schedule(self,state,base,at):
  week=self.life.weekly.schedule(state,base,at)
  if week:return week
  local=at+timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);plan=next((p for p in state.get('goalPlans',[]) if p['day']==local.date().isoformat()),None)
  if not base['enabled'] or not plan:return base
  blocks=plan['blocks'];slots=[copy.deepcopy(s) for s in base['slots'] if not any(minute(b['at'])<=minute(s['at'])<minute(b['until']) for b in blocks)]
  for block in blocks:
   slots.append({'at':block['at'],'locationId':block['locationId'],'activity':block['activity'],'until':block['until'],'outlineStepId':block['outlineStepId'],'goalPlanId':plan['taskId']})
   resume=next((s for s in reversed(base['slots']) if s['at']<=block['until']),base['slots'][0])
   if not any(s['at']==block['until'] for s in slots):slots.append({**copy.deepcopy(resume),'at':block['until']})
  return {'enabled':True,'slots':sorted(slots,key=lambda s:s['at'])}
 def retry(self,args):
  role,session,world,_=self.life.scope(args)
  if not world:raise ValueError('day_plan_story_required')
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   row=db.execute("SELECT * FROM role_living_tasks WHERE id=? AND role_id=? AND kind='day-plan' AND status='failed'",(args.get('id'),role)).fetchone()
   if not row or json.loads(row['payload_json']).get('sessionId')!=session:raise ValueError('day_plan_retry_invalid')
   db.execute("UPDATE role_living_tasks SET status='ready' WHERE id=?",(row['id'],))
  return {'queued':True}
