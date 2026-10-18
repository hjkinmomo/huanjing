"""Owner-visible weekly planner; model work and time-driven movement stay separate."""
from contextlib import closing
from datetime import datetime,timedelta
from urllib.parse import urlparse
import copy,hashlib,json,re
from persona_modes import role_mode
from world_identities import checked_mode
from world_calendar import local_time,day_info,month_grid,LAWS
from scene_locations import location_accessible,location_label
from character_event_context import messages_with_context
from day_planning import protected,minute,digest

class WeeklyPlanner:
 def __init__(self,life,db):
  self.life=life;self.resolve_provider=None
  db.execute('CREATE TABLE IF NOT EXISTS week_planner_settings(mode TEXT PRIMARY KEY,payload_json TEXT NOT NULL,revision INTEGER NOT NULL)')
  for r in db.execute("SELECT id,payload_json FROM role_living_tasks WHERE kind='week-plan' AND status='running'").fetchall():
   p=json.loads(r['payload_json']);p['error']='week_plan_interrupted';db.execute("UPDATE role_living_tasks SET status='failed',payload_json=? WHERE id=?",(json.dumps(p,ensure_ascii=False),r['id']))
  for name,fn,write in [('world_week_get',self.get,False),('world_week_configure',self.configure,True),('world_week_generate',self.request,True),('world_week_edit',self.edit,True)]:
   life.runtime.registry.register(name,'Owner weekly calendar and planner controls; never a character/model tool.',mutating=write)(fn)
 @staticmethod
 def slot(mode):return 'ext.week-planner.'+mode+'.chat'
 def credential_definitions(self):return {self.slot(m):{'packageId':'week-planner','packageName':'周历规划器','label':('普通' if m=='normal' else '特殊')+'模式周规划模型','active':True,'enabled':True,'requiresReview':False} for m in ['normal']}
 def config(self,db,mode):
  r=db.execute('SELECT * FROM week_planner_settings WHERE mode=?',(mode,)).fetchone()
  return {**(json.loads(r['payload_json']) if r else {'source':'role','endpoint':'','model':'','autoNextWeek':True}),'revision':r['revision'] if r else 0,'credentialId':self.slot(mode)}
 def configure(self,args):
  mode=checked_mode(args.get('mode','normal'));value=args.get('config')
  if not isinstance(value,dict) or set(value)-{'source','endpoint','model','autoNextWeek'} or value.get('source') not in ['role','dedicated'] or type(value.get('autoNextWeek')) is not bool:raise ValueError('week_config_invalid')
  value={**value,'endpoint':str(value.get('endpoint','')).strip(),'model':str(value.get('model','')).strip()}
  if len(value['model'])>160 or len(value['endpoint'])>1000:raise ValueError('week_config_invalid')
  if value['source']=='dedicated':
   u=urlparse(value['endpoint'])
   if not value['model'] or not u.hostname or u.scheme not in ['https','http'] or u.username or u.password or u.query or u.fragment or u.scheme=='http' and u.hostname not in ['localhost','127.0.0.1','::1']:raise ValueError('week_endpoint_invalid')
   value['endpoint']=value['endpoint'].rstrip('/')
   if not value['endpoint'].endswith('/chat/completions'):value['endpoint']+='/chat/completions'
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   old=self.config(db,mode)
   if args.get('expectedRevision')!=old['revision']:raise ValueError('week_config_changed')
   db.execute('INSERT OR REPLACE INTO week_planner_settings VALUES(?,?,?)',(mode,json.dumps(value,ensure_ascii=False),old['revision']+1))
  self.life.runtime.backup_manager.mark_dirty();return {'saved':True,'revision':old['revision']+1}
 def owner_scope(self,args,db,stamp):
  scope=self.life.commitments.scope(args,db,stamp)
  role,session,world,state,rev,places,bank=scope
  if args.get('mode',role_mode(role))!=role_mode(role):raise ValueError('week_mode_mismatch')
  return scope
 def base_days(self,db,role,state,stamp,places):
  now=local_time(state,stamp);start=now.replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=now.weekday())
  config=self.life.agenda.config('world-calendar.json')['modes'][role_mode(role)];content,_=self.life.living.content(db,role);base=content.get('life',{}).get('schedule') or state['schedule']
  variants=self.life.agenda.config('role-agenda-config.json').get('roles',{}).get(role,{})
  days=[]
  for i in range(7):
   date=start+timedelta(days=i);info=day_info(config,date);candidate=copy.deepcopy(base if info['kind']=='weekday' else variants.get(info['kind']) or variants.get('weekend') or self.rest_day(state))
   self.life.validate_schedule(candidate,places)
   if date.date()==now.date():candidate=self.life.planning.schedule({**state,'weeklyPlans':[]},candidate,now-timedelta(minutes=state['timePolicy']['utcOffsetMinutes']))
   slots=[{k:s[k] for k in ['at','locationId','activity']} for s in candidate['slots']]
   if slots[0]['at']!='00:00':slots.insert(0,{**slots[-1],'at':'00:00'})
   days.append({**info,'slots':slots,'note':''})
  return days
 def rest_day(self,state):return {'enabled':True,'slots':[{'at':'00:00','locationId':state['homeLocation'],'activity':'休息'},{'at':'09:00','locationId':state['homeLocation'],'activity':'自由安排'},{'at':'23:00','locationId':state['homeLocation'],'activity':'准备休息'}]}
 def capture(self,db,scope,stamp):
  role,session,world,state,rev,places,bank=scope;days=self.base_days(db,role,state,stamp,places);outline=copy.deepcopy(self.life.planning.outline(db,role))
  commitments=self.life.commitments.load(db,role,session);essential={s['locationId'] for d in days for s in d['slots']};essential.add(state['homeLocation']);essential.update(c['locationId'] for c in commitments if c['status']=='accepted')
  allowed=self.life.planning.allowed(db,role,state,places)|essential;ids=sorted(essential)+sorted(allowed-essential)
  return {'sessionId':session,'identityId':bank,'weekStart':days[0]['date'],'weekEnd':days[-1]['date'],'revision':1,'goalVersion':self.life.planning.version(db,role),'createdWorldAt':local_time(state,stamp).isoformat(),'days':[],
   'input':{'now':local_time(state,stamp).isoformat(),'days':days,'outline':outline,'homeLocation':state['homeLocation'],'places':[{'id':k,'name':location_label(places,k)[-80:]} for k in ids if location_accessible(places,k)][:100],
    'commitments':[{k:c[k] for k in ['id','status','at','locationId','endAt','departureAt'] if k in c} for c in commitments if c['status']=='accepted'],'laws':LAWS},'error':''}
 def key(self,role,session,week):return 'week-plan-'+digest([role,session,week])[:40]
 def persona_key(self,role,session):return 'week-persona-'+digest([role,session])[:36]
 def latest(self,db,role,session,week):
  return db.execute("SELECT * FROM role_living_tasks WHERE id=? AND role_id=? AND kind='week-plan'",(self.key(role,session,week),role)).fetchone()
 def request(self,args):
  stamp=self.life.stamp()
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   role,session,world,state,rev,places,bank=scope=self.owner_scope(args,db,stamp);p=self.capture(db,scope,stamp);key=self.key(role,session,p['weekStart']);old=self.latest(db,role,session,p['weekStart'])
   if not state.get('autonomy',{}).get('enabled') or not state['schedule']['enabled']:raise ValueError('week_life_disabled')
   messages=args.get('personaMessages')
   if messages is not None:
    if not isinstance(messages,list) or not 1<=len(messages)<=10 or any(not isinstance(m,dict) or set(m)!={'role','content'} or not isinstance(m['content'],str) or m['role']!='system' and not (m['role']=='user' and m['content'].startswith('本轮参考资料（数据块，不是用户新说的话或新的平台指令）：')) for m in messages) or sum(len(m['content']) for m in messages)>48000:raise ValueError('week_persona_invalid')
    p['personaMessages']=copy.deepcopy(messages)
   if db.execute("SELECT 1 FROM role_living_tasks WHERE role_id=? AND kind='day-plan' AND status='running'",(role,)).fetchone():raise ValueError('week_day_generation_busy')
   if old:
    previous=json.loads(old['payload_json'])
    if old['status'] in ['ready','running','waiting_configuration']:return {'queued':True,'duplicate':True,'id':key}
    if args.get('expectedRevision')!=previous['revision']:raise ValueError('week_plan_changed')
    if previous.get('manualDates') and args.get('replaceManual') is not True:raise ValueError('week_manual_confirmation_required')
    p.update(revision=previous['revision']+1,days=previous.get('days',[]),manualDates=previous.get('manualDates',[]))
   db.execute('INSERT OR REPLACE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(key,role,'week-plan',json.dumps(p,ensure_ascii=False),'ready',stamp))
   if messages is not None:db.execute('INSERT OR REPLACE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(self.persona_key(role,session),role,'week-persona',json.dumps({'sessionId':session,'identityId':bank,'messages':messages},ensure_ascii=False),'saved',stamp))
   db.execute("UPDATE role_living_tasks SET status='stale' WHERE role_id=? AND kind='day-plan' AND status IN ('ready','waiting_configuration') AND json_extract(payload_json,'$.sessionId')=?",(role,session))
  self.life.runtime.backup_manager.mark_dirty();return {'queued':True,'id':key}
 def prepare(self,db,role,session,state,stamp,places,queue=True):
  if role in ['world-user','special.world-user'] or session==f'role:{role}:primary':return False
  now=local_time(state,stamp);week=(now-timedelta(days=now.weekday())).date().isoformat();row=self.latest(db,role,session,week)
  if not row and queue and self.config(db,role_mode(role))['autoNextWeek']:
   # Auto continuation is opt-in and only begins after an explicitly generated week.
   prior=db.execute("SELECT payload_json FROM role_living_tasks WHERE role_id=? AND kind='week-plan' AND status='done' ORDER BY rowid DESC LIMIT 8",(role,)).fetchall()
   if any(json.loads(r[0]).get('sessionId')==session and json.loads(r[0]).get('generatedAt') for r in prior):
    policy=db.execute('SELECT memory_policy FROM chat_session_options WHERE role_id=? AND session_id=?',(role,session)).fetchone()
    if not policy or policy[0]!='readonly':
     bank=self.life.identities.current(db,role_mode(role));scope=(role,session,self.life.shared.world(role_mode(role)),state,0,places,bank['id'] if bank else '')
     p=self.capture(db,scope,stamp);key=self.key(role,session,week);db.execute('INSERT OR IGNORE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(key,role,'week-plan',json.dumps(p,ensure_ascii=False),'ready',stamp));row=self.latest(db,role,session,week)
  rows=db.execute("SELECT id,status,payload_json FROM role_living_tasks WHERE role_id=? AND kind='week-plan' ORDER BY rowid DESC LIMIT 8",(role,)).fetchall();plans=[]
  for r in rows:
   p=json.loads(r['payload_json'])
   if p.get('sessionId')==session and p.get('days'):plans.append({'id':r['id'],'days':p['days'],'revision':p['revision']})
  state['weeklyPlans']=plans;state['weekManaged']=bool(rows and any(json.loads(r['payload_json']).get('sessionId')==session for r in rows))
  if row:
   p=json.loads(row['payload_json']);error=p.get('error','');state['weekPlanning']={'id':row['id'],'status':row['status'],'revision':p['revision'],'weekStart':week,'error':error,'issue':'model' if error.startswith('week_model') else 'interrupted' if error=='week_plan_interrupted' else 'plan'}
  else:state['weekPlanning']={'status':'not-generated'}
  return state['weekManaged']
 def schedule(self,state,base,at):
  day=(at+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])).date().isoformat()
  for plan in state.get('weeklyPlans',[]):
   entry=next((d for d in plan['days'] if d['date']==day),None)
   if entry:
    slots=[]
    for i,s in enumerate(entry['slots']):
     slot={**s,'weekEntryId':plan['id']+'|'+day+'|'+s['at']}
     if s.get('outlineStepId'):slot.update(goalPlanId=plan['id'],until=entry['slots'][i+1]['at'] if i+1<len(entry['slots']) else '23:59')
     slots.append(slot)
    return {'enabled':base['enabled'],'slots':slots}
  return None
 def validate(self,value,p,state,places,manual=False):
  if not isinstance(value,dict) or set(value)!={'days'} or not isinstance(value['days'],list) or len(value['days'])!=7:raise ValueError('week_plan_format_invalid')
  now=local_time(state,self.life.stamp());result=[];steps={s['id'] for s in p['input']['outline'].get('steps',[]) if manual or s.get('status')!='complete'}
  for actual,base in zip(value['days'],p['input']['days']):
   if not isinstance(actual,dict) or set(actual)-{'date','slots','note'} or actual.get('date')!=base['date'] or not isinstance(actual.get('note',''),str) or len(actual.get('note',''))>240:raise ValueError('week_day_invalid')
   slots=actual.get('slots');self.life.validate_schedule({'enabled':True,'slots':[{k:s[k] for k in ['at','locationId','activity']} for s in slots] if isinstance(slots,list) and all(isinstance(s,dict) and all(k in s for k in ['at','locationId','activity']) for s in slots) else []},places)
   if not 2<=len(slots)<=16 or slots[0]['at']!='00:00':raise ValueError('week_slots_invalid')
   for s in slots:
    future=base['date']>now.date().isoformat() or base['date']==now.date().isoformat() and s['at']>now.strftime('%H:%M')
    if set(s)-{'at','locationId','activity','outlineStepId'} or not location_accessible(places,s['locationId']) or future and s.get('outlineStepId') and s['outlineStepId'] not in steps:raise ValueError('week_slot_scope_invalid')
    if not manual and s['locationId'] not in {q['id'] for q in p['input']['places']}:raise ValueError('week_slot_scope_invalid')
   if base['date']<now.date().isoformat():
    result.append(copy.deepcopy(base));continue  # prior dates are plans only, never retroactive movement
   if base['date']==now.date().isoformat():
    cutoff=now.strftime('%H:%M');old=[{k:s[k] for k in ['at','locationId','activity']} for s in base['slots'] if s['at']<=cutoff];new=[{k:s[k] for k in ['at','locationId','activity']} for s in slots if s['at']<=cutoff]
    if old!=new:raise ValueError('week_past_time_locked')
    slots=[copy.deepcopy(next(b for b in base['slots'] if b['at']==s['at'])) if s['at']<=cutoff else s for s in slots]
   if not manual:
    work=sum((minute(slots[i+1]['at']) if i+1<len(slots) else 1440)-minute(s['at']) for i,s in enumerate(slots) if protected(s['activity']) and not re.search('睡|就寝',s['activity']))
    note=actual.get('note','')
    if work>480:raise ValueError('week_work_hours_invalid')
    if base['off'] and work and not ('轮班' in note and '补休' in note):raise ValueError('week_holiday_work_invalid')
    # Preserve fixed work/school and sleep spans; model chooses free-time activities.
    for i,b in enumerate(base['slots']):
     if not protected(b['activity']):continue
     if not re.search('睡|就寝',b['activity']) and re.search('请假|调班|轮班|补休',note):continue
     end=base['slots'][i+1]['at'] if i+1<len(base['slots']) else '24:00'
     relevant=[s for s in slots if b['at']<=s['at']<end]
     if not relevant or relevant[0]['at']!=b['at'] or any(s['locationId']!=b['locationId'] or not protected(s['activity']) for s in relevant):raise ValueError('week_fixed_routine_conflict')
   for i,s in enumerate(slots[1:],1):
    at=datetime.fromisoformat(base['date']+'T'+s['at']+':00').replace(tzinfo=now.tzinfo)
    if at<=now:continue
    until=minute(slots[i+1]['at']) if i+1<len(slots) else 1440
    trial=copy.deepcopy(state);trial.update(roleLocation=slots[i-1]['locationId'],enRoute=None,override=None);trial.pop('overrideWorldUntil',None)
    real=at-timedelta(minutes=state['timePolicy']['utcOffsetMinutes'],seconds=state['timePolicy'].get('clockOffsetSeconds',0))
    trip=self.life.journeys.start(trial,real.isoformat(),places,s['locationId'],'weekly-route-validation',state.get('transportMethod','walk'),s['activity'],'routine')
    if trip['durationMinutes']>until-minute(s['at']):raise ValueError('week_travel_window_invalid')
   result.append({**base,'slots':copy.deepcopy(slots),'note':actual.get('note',''),'source':'manual' if manual else 'model'})
  return result
 def claim(self,db):
  for r in db.execute("SELECT t.*,e.profile_json FROM role_living_tasks t LEFT JOIN character_event_roles e ON e.role_id=t.role_id WHERE t.kind='week-plan' AND t.status IN ('ready','waiting_configuration') ORDER BY t.created_at LIMIT 40").fetchall():
   job=dict(r);p=json.loads(r['payload_json']);role=r['role_id'];session=p['sessionId'];state_row=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone();bank=self.life.identities.current(db,role_mode(role))
   if not state_row or not self.life.runtime.character_events.session_valid(db,role,session) or p['identityId']!=(bank['id'] if bank else ''):db.execute("UPDATE role_living_tasks SET status='stale' WHERE id=?",(r['id'],));continue
   state=json.loads(state_row[0]);now=local_time(state,self.life.stamp());week=(now-timedelta(days=now.weekday())).date().isoformat()
   if week!=p['weekStart'] or not state.get('autonomy',{}).get('enabled') or not state['schedule']['enabled']:db.execute("UPDATE role_living_tasks SET status='stale' WHERE id=?",(r['id'],));continue
   config=self.config(db,role_mode(role))
   profile=json.loads(r['profile_json']) if r['profile_json'] and r['profile_json']!='{}' else None
   persona=p.get('personaMessages')
   if not persona and not profile:
    saved_persona=db.execute("SELECT payload_json FROM role_living_tasks WHERE id=? AND role_id=? AND kind='week-persona'",(self.persona_key(role,session),role)).fetchone()
    if saved_persona:
     saved_persona=json.loads(saved_persona[0]);persona=saved_persona['messages'] if saved_persona['identityId']==p['identityId'] else None
   if persona:profile={**(profile or {'provider':{}}),'messages':persona}
   if not profile or config['source']=='dedicated' and not self.resolve_provider or config['source']=='role' and (not profile.get('provider') or not self.life.runtime.auto_moments.resolve_provider):
    db.execute("UPDATE role_living_tasks SET status='waiting_configuration' WHERE id=?",(r['id'],));continue
   if db.execute("SELECT 1 FROM tasks WHERE role_id=? AND status IN ('running','cancelling')",(role,)).fetchone():continue
   places=self.life.places(role,session,self.life.shared.world(role_mode(role)),db);fresh=self.capture(db,(role,session,None,state,0,places,p['identityId']),self.life.stamp());fresh.update(revision=p['revision'],days=p.get('days',[]),manualDates=p.get('manualDates',[]),configRevision=config['revision'])
   # Existing manual/generated future slots are the baseline for retry and conflict checks.
   if p.get('days'):fresh['input']['days']=copy.deepcopy(p['days'])
   db.execute("UPDATE role_living_tasks SET status='running',payload_json=? WHERE id=?",(json.dumps(fresh,ensure_ascii=False),r['id']));job.update(payload_json=json.dumps(fresh,ensure_ascii=False),profile_json=json.dumps(profile,ensure_ascii=False),config=config);return job
 def generate(self,job):
  p=json.loads(job['payload_json']);role=job['role_id'];session=p['sessionId']
  try:
   profile=json.loads(job['profile_json']);config=job['config'];provider=self.resolve_provider(role_mode(role),config) if config['source']=='dedicated' else self.life.runtime.auto_moments.resolve_provider({**profile['provider'],'roleId':role})
   instruction='为这个角色制定当前一整周七天的日程。参考自己的有效人设、人生大纲、作息、夏城历则、节假日和已答应约定。只安排位置与活动，不写台词、情绪或已完成经历。保留已过时段、固定工作/课程/睡眠及对应结束时间；休息日不安排常规工作。可以在自由时间安排吃饭、咖啡、朋友、休息和推进人生目标；正常生活优先，不必每天完成目标。地点仅用places的id；若推进目标，可加outlineStepId，只能引用未完成步骤。每一天从00:00起，时间递增，2至16段。地点变化表示该时刻开始出发，留出通勤与用餐空档。note可注明轮班与补休，最多240字。只返回JSON，七天日期必须与输入相同：{"days":[{"date":"输入日期","slots":[{"at":"00:00","locationId":"地点id","activity":"具体活动","outlineStepId":"可选步骤id"}],"note":"说明或空串"}]}。'
   with closing(self.life.runtime.connect()) as db:
    agent=db.execute('SELECT settings_json FROM role_agents WHERE role_id=?',(role,)).fetchone();settings=json.loads(agent[0]) if agent else {}
   messages=messages_with_context(profile,p['input'],instruction,{'contextWindow':settings.get('contextWindow',32768) if config['source']=='role' else 32768,'maxTokens':8192})
   response=self.life.runtime.proxy_provider_request({'route':'chat','roleId':role,'provider':provider,'body':{'model':provider['model'],'messages':messages,'stream':False,'max_tokens':8192},'roleSkills':{'enabled':False,'context':'story'}})
   if response.get('ok') is False:raise ValueError('week_model_failed_http_'+str(response.get('httpStatus') or 'unknown'))
   choice=response.get('payload',{}).get('choices',[{}])[0]
   if choice.get('finish_reason')=='length':raise ValueError('week_plan_truncated')
   raw=choice.get('message',{}).get('content','').strip();raw=re.sub(r'^```(?:json)?\s*|\s*```$','',raw) if raw.startswith('```') else raw;value=json.loads(raw)
   with self.life.lock,closing(self.life.runtime.connect()) as db,db:
    saved=db.execute('SELECT status,payload_json FROM role_living_tasks WHERE id=?',(job['id'],)).fetchone()
    if not saved or saved['status']!='running' or json.loads(saved['payload_json'])['revision']!=p['revision'] or self.life.runtime._stop.is_set():return
    bank=self.life.identities.current(db,role_mode(role));record=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
    if not record or not self.life.runtime.character_events.session_valid(db,role,session) or p['identityId']!=(bank['id'] if bank else '') or p['goalVersion']!=self.life.planning.version(db,role) or self.config(db,role_mode(role))['revision']!=p['configRevision']:
     db.execute("UPDATE role_living_tasks SET status='stale' WHERE id=?",(job['id'],));return
    state=json.loads(record[0]);places=self.life.places(role,session,self.life.shared.world(role_mode(role)),db);p['days']=self.validate(value,p,state,places);p.update(error='',source='model-week-plan',generatedAt=self.life.stamp(),manualDates=[])
    db.execute("UPDATE role_living_tasks SET status='done',payload_json=? WHERE id=?",(json.dumps(p,ensure_ascii=False),job['id']))
   self.life.runtime.backup_manager.mark_dirty()
  except Exception as error:
   code=str(error) if isinstance(error,ValueError) and str(error).startswith('week_') else {'event_context_budget_exceeded':'week_context_budget_exceeded','credential_not_configured':'week_model_credential_not_configured','credential_decrypt_failed':'week_model_credential_unavailable'}.get(str(error),'week_plan_generation_failed')
   with closing(self.life.runtime.connect()) as db,db:
    saved=db.execute("SELECT payload_json FROM role_living_tasks WHERE id=? AND status='running'",(job['id'],)).fetchone()
    if saved and json.loads(saved[0])['revision']==p['revision']:p['error']=code;db.execute("UPDATE role_living_tasks SET status='failed',payload_json=? WHERE id=?",(json.dumps(p,ensure_ascii=False),job['id']))
 def edit(self,args):
  stamp=self.life.stamp()
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   role,session,world,state,rev,places,bank=scope=self.owner_scope(args,db,stamp);fresh=self.capture(db,scope,stamp);row=self.latest(db,role,session,fresh['weekStart']);p=json.loads(row['payload_json']) if row else fresh
   if args.get('expectedRevision')!=(p['revision'] if row else 0):raise ValueError('week_plan_changed')
   date=args.get('date');now=local_time(state,stamp)
   if not isinstance(date,str) or date<now.date().isoformat() or date not in [d['date'] for d in fresh['input']['days']]:raise ValueError('week_past_date_locked')
   days=copy.deepcopy(p.get('days') or fresh['input']['days']);original=copy.deepcopy(days)
   for i,d in enumerate(days):
    if d['date']==date:days[i]={**d,'slots':args.get('slots'),'note':args.get('note','')}
   check={**p,'input':{**fresh['input'],'days':original}};p['days']=self.validate({'days':[{k:d[k] for k in ['date','slots','note']} for d in days]},check,state,places,manual=True)
   p.update(revision=(p['revision'] if row else 0)+1,source='owner-week-edit',error='',manualDates=sorted(set(p.get('manualDates',[])+[date])))
   db.execute('INSERT OR REPLACE INTO role_living_tasks VALUES(?,?,?,?,?,?)',(self.key(role,session,p['weekStart']),role,'week-plan',json.dumps(p,ensure_ascii=False),'done',stamp))
   db.execute("UPDATE role_living_tasks SET status='stale' WHERE role_id=? AND kind='day-plan' AND status IN ('ready','waiting_configuration') AND json_extract(payload_json,'$.sessionId')=?",(role,session))
   self.prepare(db,role,session,state,stamp,places,queue=False);self.life._save(db,role,session,state,rev+1,stamp)
  self.life.runtime.backup_manager.mark_dirty();return {'saved':True,'revision':p['revision']}
 def get(self,args):
  mode=checked_mode(args.get('mode','normal'));stamp=self.life.stamp()
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   roles=[];sessions=self.life.shared.sessions(db,mode)
   for s in sessions:
    a=db.execute('SELECT name FROM role_agents WHERE role_id=?',(s['role_id'],)).fetchone();roles.append({'roleId':s['role_id'],'sessionId':s['session_id'],'name':a[0] if a else s['role_id']})
   selected=next((s for s in sessions if s['role_id']==args.get('roleId') and (not args.get('sessionId') or s['session_id']==args.get('sessionId'))),None) if args.get('roleId') else (sessions[0] if sessions else None)
   state=None;detail=None;places=[]
   if selected:
    role=selected['role_id'];session=selected['session_id'];r=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
    if r:
     state=json.loads(r[0]);world=self.life.shared.world(mode);mapping=self.life.places(role,session,world,db);base=self.base_days(db,role,state,stamp,mapping);row=self.latest(db,role,session,base[0]['date']);p=json.loads(row['payload_json']) if row else None
     detail={'roleId':role,'sessionId':session,'name':next(x['name'] for x in roles if x['roleId']==role),'status':row['status'] if row else 'not-generated','id':row['id'] if row else None,'revision':p['revision'] if p else 0,'days':p.get('days') or base if p else base,'error':p.get('error','') if p else '', 'manualDates':p.get('manualDates',[]) if p else [],'commitments':self.life.commitments.output(db,role,session)}
     places=[{'id':k,'name':location_label(mapping,k)} for k in sorted(mapping) if location_accessible(mapping,k)]
   if state:now=local_time(state,stamp)
   else:
    owner,session=self.life.shared.owner(mode);r=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(owner,session)).fetchone();now=local_time(json.loads(r[0]),stamp) if r else datetime(2001,5,1,8)
   year=args.get('year',now.year-1700);month=args.get('month',now.month)
   if type(year) is not int or not 1<=year<=999 or type(month) is not int or not 1<=month<=12:raise ValueError('week_calendar_month_invalid')
   config=self.life.agenda.config('world-calendar.json')['modes'][mode]
   return {'mode':mode,'today':day_info(config,now),'now':now.isoformat(),'month':month,'year':year,'calendarName':'夏城新历','calendar':month_grid(config,year+1700,month),'holidays':config['holidays'],'laws':LAWS,'roles':roles,'selected':detail,'places':places,'config':self.config(db,mode),'readOnly':True}
