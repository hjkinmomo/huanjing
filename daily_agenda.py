"""One-day fictional plans, separate from actual positions and spoken history.

Calendar variants affect only untouched default routines. No model calls, new
conversation, appointment inference or completed-event fabrication happens here.
"""
from datetime import datetime,timedelta
from pathlib import Path
import copy,hashlib,json
from scene_locations import location_label,scene_container,schedule_area

class DailyAgenda:
 def __init__(self,life):
  self.life=life;self.root=Path(__file__).parent/'web/assets/experience';self.cache={};self.issues=set()
 def config(self,name):
  file=self.root/name
  try:
   signature=(file.stat().st_mtime_ns,file.stat().st_size)
   if self.cache.get(name,{}).get('signature')!=signature:
    if signature[1]>524288:raise ValueError('agenda_config_too_large')
    value=json.loads(file.read_text('utf8'))
    if value.get('schema')!=1:raise ValueError('agenda_config_version')
    if name=='world-calendar.json':
     for mode in ['normal']:
      config=value['modes'][mode];days=config.get('weekendDays',[6,7]);holidays=config.get('holidays',[])
      if not isinstance(days,list) or len(days)>7 or any(type(d) is not int or not 1<=d<=7 for d in days) or not isinstance(holidays,list) or len(holidays)>64:raise ValueError('agenda_calendar_invalid')
      for h in holidays:
       if not isinstance(h,dict) or set(h)-{'month','day','year','name'} or type(h.get('month')) is not int or type(h.get('day')) is not int or not isinstance(h.get('name'),str) or not 1<=len(h['name'])<=60:raise ValueError('agenda_holiday_invalid')
       if h.get('year') is not None and (type(h['year']) is not int or not 1<=h['year']<=999):raise ValueError('agenda_holiday_year_invalid')
       datetime(h['year']+1700 if h.get('year') else 2000,h['month'],h['day'])
    elif not isinstance(value.get('roles'),dict):raise ValueError('agenda_roles_invalid')
    self.cache[name]={'signature':signature,'value':value};self.issues.discard(name)
   return copy.deepcopy(self.cache[name]['value'])
  except (OSError,ValueError,KeyError,TypeError,AttributeError):
   self.issues.add(name)
   if name in self.cache:return copy.deepcopy(self.cache[name]['value'])
   return {'schema':1,'modes':{m:{'weekendDays':[6,7],'holidays':[]} for m in ['normal']},'roles':{}}
 def day(self,state,stamp,mode):
  policy=state['timePolicy'];local=datetime.fromisoformat(stamp)+timedelta(seconds=policy.get('clockOffsetSeconds',0),minutes=policy['utcOffsetMinutes']);config=self.config('world-calendar.json')['modes'][mode]
  holidays=config.get('holidays',[])
  if not isinstance(holidays,list) or len(holidays)>64:raise ValueError('agenda_holiday_config_invalid')
  holiday=next((h for h in holidays if h.get('month')==local.month and h.get('day')==local.day and (h.get('year') is None or h['year']==local.year-1700)),None)
  kind='holiday' if holiday else 'weekend' if local.isoweekday() in config.get('weekendDays',[6,7]) else 'weekday'
  return local,kind,str((holiday or {}).get('name',''))[:60]
 def prepare(self,db,role,session,state,world,stamp):
  if role in ['world-user','special.world-user'] or session==f'role:{role}:primary':return
  from persona_modes import role_mode
  mode=role_mode(role);local,kind,holiday=self.day(state,stamp,mode);places=self.life.places(role,session,world,db)
  customized=db.execute('SELECT 1 FROM character_content WHERE role_id=?',(role,)).fetchone()
  source='manual' if state.get('scheduleManual') else 'saved-content' if customized else 'default'
  if source=='default' and state.get('autonomy',{}).get('enabled'):
   content,_=self.life.living.content(db,role);base=content.get('life',{}).get('schedule');variants=self.config('role-agenda-config.json').get('roles',{}).get(role,{})
   if base:state['agendaRoutineBase']=copy.deepcopy(base)
   chosen=variants.get(kind) if kind!='weekday' else base
   if not chosen:chosen=base
   if chosen:
    try:
     self.life.validate_schedule(chosen,places)
     if not self.issues:state['schedule']={**copy.deepcopy(chosen),'enabled':state['schedule']['enabled']}
    except (ValueError,TypeError,KeyError):self.issues.add('role-agenda-config.json')
  schedule=state['schedule'];day=local.date().isoformat();entries=[]
  for slot in schedule['slots']:
   destination=self.destination(state,slot,local,places)
   at=local.replace(hour=int(slot['at'][:2]),minute=int(slot['at'][3:]),second=0,microsecond=0)-timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
   entries.append({'id':'plan-'+day+'-'+slot['at'],'at':slot['at'],'worldUtc':at.isoformat(),'locationId':destination,'placeName':location_label(places,destination),'activity':slot['activity'],'kind':'plan'})
  self.merge(db,role,state,local,places,entries)
  value={'day':day,'displayDate':'新历'+str(local.year-1700)+local.strftime('年%m月%d日'),'weekday':local.isoweekday(),'dayKind':kind,'holidayName':holiday,'source':source,'enabled':schedule['enabled'],'entries':entries,'configWarning':'日历或作息初稿未读取，保留当前有效日程。' if self.issues else ''}
  signature=hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
  if (state.get('dailyAgenda') or {}).get('version')!=signature:state['dailyAgenda']={**value,'version':signature,'generatedAt':stamp,'scope':'current-day-plan-only'}
 def schedule_at(self,state,at,places):
  """Read-only future routine for delivery/route prediction; never changes today."""
  if state.get('scheduleManual') or state.get('dailyAgenda',{}).get('source')!='default' or not state.get('autonomy',{}).get('enabled'):return state['schedule']
  from persona_modes import role_mode
  role=state.get('scheduleActorId','');shifted={**state,'timePolicy':{**state['timePolicy'],'clockOffsetSeconds':0}}
  _,kind,_=self.day(shifted,at.isoformat(),role_mode(role));base=state.get('agendaRoutineBase') or state['schedule'];variants=self.config('role-agenda-config.json').get('roles',{}).get(role,{})
  candidate=base if kind=='weekday' else variants.get(kind) or base
  try:self.life.validate_schedule(candidate,places)
  except (ValueError,TypeError,KeyError):return state['schedule']
  return {**candidate,'enabled':state['schedule']['enabled']} if not self.issues else state['schedule']
 def destination(self,state,slot,local,places):
  destination=slot['locationId'];default=state.get('defaultHomeLocation');home=state.get('homeLocation')
  if not state.get('scheduleManual') and default and home and home!=default and scene_container(places,destination)==scene_container(places,default):destination=home
  return schedule_area(places,destination,state.get('scheduleActorId',''),local.date().isoformat()+'|'+slot['at'])
 def output(self,state,stamp,places):
  cache=state.get('dailyAgenda')
  if not cache:return None
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));shared=state.get('binding',{}).get('status')=='accepted'
  entries=[{**entry,'timePassed':datetime.fromisoformat(entry.get('endWorldUtc',entry['worldUtc']))<=now} for entry in cache['entries'] if shared or entry['kind']=='commitment']
  candidates=[v for v in entries if not v['timePassed'] and not v.get('conflict') and (v['kind']=='commitment' or cache['enabled'])]
  next_item=next(iter(sorted(candidates,key=lambda e:(e['kind']=='wish-window',e['worldUtc']))),None)
  return {**{k:v for k,v in cache.items() if k not in ['entries','generatedAt']},'entries':entries,'sharingRequired':not shared,'next':next_item,'current':{'locationId':state['roleLocation'],'placeName':location_label(places,state['roleLocation']),'activity':state['activity'],'enRoute':bool(state.get('enRoute'))},'executionContract':'plan-is-not-arrival'}
 def merge(self,db,role,state,local,places,entries):
  zone=timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);day=local.date();accepted=[]
  for c in state.get('commitments',[]):
   if c.get('status') not in ['accepted','completed']:continue
   when=datetime.fromisoformat(c['at'])
   if (when+zone).date()!=day:continue
   accepted.append(c)
   entries.append({'id':c['id'],'at':(when+zone).strftime('%H:%M'),'worldUtc':c['at'],'locationId':c['locationId'],'placeName':location_label(places,c['locationId']),'activity':'我们的约定','kind':'commitment','status':c['status'],'timeKind':c['timeKind'],'actualArrival':c.get('arrivedAt')})
  for entry in entries:
   if entry['kind']=='plan':entry['conflict']=any(c.get('departureAt','z')<=entry['worldUtc']<c.get('endAt','') for c in accepted)
  content,_=self.life.living.content(db,role);living=self.life.living.state(db,role)
  for draft in content.get('life',{}).get('wishes',[]):
   wish={**draft,**living.get('wishes',{}).get(draft['id'],{})}
   if wish.get('status') in ['fulfilled','shelved'] or wish.get('lastDay')==day.isoformat() and wish.get('declines',0):continue
   start=local.replace(hour=wish['minHour'],minute=0,second=0,microsecond=0)-zone;end=local.replace(hour=wish['maxHour'],minute=59,second=59,microsecond=0)-zone
   dest=wish.get('destination');title=wish['title']
   entries.append({'id':'wish-window-'+draft['id']+'-'+day.isoformat(),'at':(start+zone).strftime('%H:%M'),'worldUtc':start.isoformat(),'endWorldUtc':end.isoformat(),'windowEnd':(end+zone).strftime('%H:%M'),'locationId':dest,'placeName':location_label(places,dest) if dest else '地点未定','activity':title,'kind':'wish-window','status':'window','channel':wish['channel'],'conditional':True})
  entries.sort(key=lambda e:(e['worldUtc'],0 if e['kind']=='commitment' else 1))
 def model_note(self,role,session):
  """Only this character's own next plan; never deliver private plans to UI."""
  from contextlib import closing
  from persona_modes import role_mode
  if not session or session==f'role:{role}:primary':return ''
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   row=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
   if not row:return ''
   state=json.loads(row[0]);world=self.life.shared.world(role_mode(role));stamp=self.life.stamp();state['commitments']=self.life.commitments.load(db,role,session);self.prepare(db,role,session,state,world,stamp)
   now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));entries=state.get('dailyAgenda',{}).get('entries',[])
   candidates=[e for e in entries if datetime.fromisoformat(e.get('endWorldUtc',e['worldUtc']))>now and not e.get('conflict') and (e['kind']=='commitment' or state['schedule']['enabled'])]
   next_item=next(iter(sorted(candidates,key=lambda e:(e['kind']=='wish-window',e['worldUtc']))),None)
   if not next_item:return ''
   return '[own-day-plan] 本角色自己的下一段：'+next_item['at']+' '+next_item['activity'][:35]+'；'+next_item['placeName'][:25]+'。'+('只是心愿窗口，条件符合也可不去。' if next_item['kind']=='wish-window' else '仍是计划，按实际账本判定到达，可改变主意。')
