"""Pure, bounded movement projection, used for both settlement and forecasts.

Plans are departures, commitments explicitly choose arrival/departure semantics.
No clock, database, model, wallet or message writes occur in this module.
"""
from datetime import datetime,timedelta
import copy,hashlib

def dt(value):return datetime.fromisoformat(value)

class WorldTimeline:
 def __init__(self,life):self.life=life
 def seed(self,state,at):
  state.setdefault('timeline',{'cursor':at.isoformat(),'version':1})
 def project(self,state,at,places):
  value=copy.deepcopy(state)
  cursor=dt(value.get('timeline',{}).get('cursor',at.isoformat()))
  if at<cursor:
   past=[t for t in value.get('timeline',{}).get('trace',[]) if dt(t['at'])<=at]
   if past:
    item=max(past,key=lambda t:dt(t['at']));value.update(roleLocation=item['location'],activity=item['activity'],enRoute=copy.deepcopy(item.get('enRoute')))
   return value
  self.advance(value,at,places);return value
 def advance(self,state,at,places):
  cursor=dt(state.get('timeline',{}).get('cursor',at.isoformat()))
  self.seed(state,cursor)
  if at<=cursor:return False
  before=(state['roleLocation'],state['activity'],copy.deepcopy(state.get('enRoute')))
  trace=state['timeline'].setdefault('trace',[])
  def remember(when):
   record={'at':when.isoformat(),'location':state['roleLocation'],'activity':state['activity'],'enRoute':copy.deepcopy(state.get('enRoute'))}
   if trace and trace[-1]['at']==record['at']:trace[-1]=record
   elif not trace or any(trace[-1].get(k)!=record.get(k) for k in ['location','activity','enRoute']):trace.append(record)
  remember(cursor)
  start=max(cursor,at-timedelta(days=2));events=[];zone=timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
  # A bounded high-water cursor prevents replay on rollback or restart.
  for i in range(4):
   local=(start+zone).replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=i)
   if local-zone>at:break
   schedule=self.life.agenda.schedule_at(state,local-zone,places)
   if not schedule.get('enabled'):continue
   for slot in schedule['slots']:
    when=local.replace(hour=int(slot['at'][:2]),minute=int(slot['at'][3:]))-zone
    if start<when<=at:
     dest=self.life.agenda.destination(state,slot,local,places)
     events.append((when,1,'routine',{'locationId':dest,'activity':slot['activity'],'id':'routine-'+hashlib.sha256((state.get('scheduleActorId','')+when.isoformat()).encode()).hexdigest()[:24],**{k:slot[k] for k in ['outlineStepId','goalPlanId','until'] if k in slot}}))
  commitments=state.get('commitments',[])
  ends=[c['endAt'] for c in commitments if c['status']=='accepted' and c.get('endAt')]
  if state.get('enRoute'):
   trip=state['enRoute'];ends.append(trip.get('holdUntil') or (dt(trip['dueAt'])+timedelta(hours=2)).isoformat())
  if state.get('overrideWorldUntil'):ends.append(state['overrideWorldUntil'])
  elif state.get('override'):ends.append((datetime.fromtimestamp(state['override']['until'],at.tzinfo)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat())
  for end in set(ends):
   when=dt(end)
   if start<when<=at:
    schedule=self.life.agenda.schedule_at(state,when,places);local=when+zone
    if schedule.get('enabled'):
     slot=schedule['slots'][-1]
     for item in schedule['slots']:
      if item['at']<=local.strftime('%H:%M'):slot=item
     events.append((when,1,'routine',{'id':'resume-'+hashlib.sha256(end.encode()).hexdigest()[:24],'locationId':self.life.agenda.destination(state,slot,local,places),'activity':slot['activity']}))
  for c in commitments:
   if c['status']!='accepted':continue
   departure=dt(c['departureAt'])
   if departure<=cursor and not c.get('startedAt') and not (state.get('enRoute') or {}).get('id')==c['id']:
    c.update(status='missed',outcomeReason='出发时刻已过，未补演旧行程。');continue
   if cursor<departure<=at:
    if departure<start:c.update(status='missed',outcomeReason='超过离线补算范围，保留原约定。')
    else:events.append((departure,0,'commitment',c))
  def real_stamp(when):return (when-timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat()
  def settle(when):
   if state.get('enRoute') and self.life.journeys.tick(state,real_stamp(when),places):
    arrived=state.get('lastArrival') or {}
    if arrived:remember(dt(arrived['dueAt']))
    for c in commitments:
     if c['id']==arrived.get('id') and c['status']=='accepted':c.update(status='completed',arrivedAt=arrived['dueAt'])
   override=state.get('override')
   if override and not state.get('overrideWorldUntil'):
    state['overrideWorldUntil']=(datetime.fromtimestamp(override['until'],when.tzinfo)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat()
   if state.get('overrideWorldUntil') and when>=dt(state['overrideWorldUntil']):state['override']=None;state.pop('overrideWorldUntil',None)
  for when,_,kind,item in sorted(events,key=lambda e:(e[0],e[1]))[:64]:
   settle(when)
   blocked=bool(state.get('enRoute') or state.get('override') and state.get('overrideWorldUntil') and when<dt(state['overrideWorldUntil']))
   if kind=='commitment':
    if item.get('startedAt'):continue
    if blocked or state['roleLocation']!=item['origin']:
     item.update(status='negotiate',outcomeReason='当前行程或实际出发地点已变化，需要重新商量。');continue
   elif blocked:continue
   dest=item['locationId']
   try:
    trip=self.life.journeys.start(state,real_stamp(when),places,dest,item['id'],item.get('method',state.get('transportMethod','walk')),item.get('activity','赴约'),'goal-plan' if item.get('goalPlanId') else kind)
   except ValueError:
    if kind=='commitment':item.update(status='negotiate',outcomeReason='目的地或路线暂不可用。')
    continue
   if kind=='commitment':
    item['startedAt']=when.isoformat();trip['holdUntil']=item['endAt']
   if item.get('goalPlanId'):
    goal_end=(when+zone).replace(hour=int(item['until'][:2]),minute=int(item['until'][3:]))-zone
    trip.update(goalPlanId=item['goalPlanId'],outlineStepId=item['outlineStepId'],holdUntil=goal_end.isoformat())
   remember(when)
   settle(when)
  settle(at);state['timeline']['cursor']=at.isoformat()
  state['timeline']['trace']=trace[-128:]
  if (at-cursor).total_seconds()>172800:state['catchUp']='只补算最近两天的行程；更早约定标为错过，没有补写角色台词。'
  return before!=(state['roleLocation'],state['activity'],state.get('enRoute')) or any(c.get('outcomeReason') for c in commitments)
