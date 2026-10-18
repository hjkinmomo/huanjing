"""Role-owned fictional journeys. No user fare, no synthetic spoken lines."""
from datetime import datetime,timedelta
from persona_modes import role_mode
import hashlib,math
from world_transport import METHODS,route_distance,route_terms
from scene_locations import scene_container,location_label,location_accessible,schedule_area,arrival_area

class CharacterJourney:
 def __init__(self,life):self.life=life
 def start(self,state,stamp,places,destination,key,method='walk',activity='赴约',source='invitation'):
  if method not in METHODS:raise ValueError('travel_method_invalid')
  if destination not in places:raise ValueError('world_life_location_missing')
  if not location_accessible(places,destination):raise ValueError('world_life_location_locked')
  if source=='wish':
   at=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));destination=schedule_area(places,destination,state.get('scheduleActorId',''),at.date().isoformat()+'|'+key)
  destination=arrival_area(places,destination,state.get('scheduleActorId',''))
  existing=state.get('enRoute')
  if existing:
   if existing['id']==key:return existing
   raise ValueError('character_travel_in_progress')
  origin=state['roleLocation'];now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));hour=(now+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])).hour
  km=route_distance(places,origin,destination);minutes,_=route_terms(method,km,hour)
  if scene_container(places,origin)==scene_container(places,destination):minutes=0
  trip={'id':key,'origin':origin,'destination':destination,'departAt':now.isoformat(),'dueAt':(now+timedelta(minutes=minutes)).isoformat(),'method':method,'methodName':METHODS[method]['name'],'durationMinutes':minutes,'distanceKm':km,'activity':activity,'source':source,'returnLocation':origin,'returnActivity':state['activity']}
  state['enRoute']=trip;state['activity']='在路上 · 前往 '+location_label(places,destination);return trip
 def tick(self,state,stamp,places):
  trip=state.get('enRoute')
  if not trip:return False
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));due=datetime.fromisoformat(trip['dueAt'])
  if trip['destination'] not in places:
   state['enRoute']=None;state['activity']=trip['returnActivity'];state['journeyCancelled']={'id':trip['id'],'reason':'destination_removed'};return True
  if now<due:return False
  state['roleLocation']=trip['destination'];state['activity']=trip['activity'];state['enRoute']=None
  state.pop('overrideWorldUntil',None)
  state['override']={'locationId':trip['destination'],'activity':trip['activity'],'until':datetime.fromisoformat(stamp).timestamp()+(due-now).total_seconds()+7200,'returnLocation':trip['returnLocation'],'returnActivity':trip['returnActivity']}
  if trip.get('source')=='routine':state['override']=None
  if trip.get('holdUntil'):
   state['overrideWorldUntil']=trip['holdUntil'];state['override']['until']=datetime.fromisoformat(stamp).timestamp()+(datetime.fromisoformat(trip['holdUntil'])-now).total_seconds()
  state['lastArrival']={**trip,'arrivedAt':trip['dueAt']};state.setdefault('arrivalsPending',[]).append(state['lastArrival']);return True
 def output(self,state,stamp):
  trip=state.get('enRoute')
  if not trip:return None
  now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
  return {**trip,'remainingMinutes':max(0,math.ceil((datetime.fromisoformat(trip['dueAt'])-now).total_seconds()/60))}
 def record(self,db,role,session,state,stamp):
  pending=state.pop('arrivalsPending',[])
  legacy=state.pop('arrivalPending',None)
  if legacy:pending.append(legacy)
  for trip in pending:self.record_one(db,role,session,state,stamp,trip)
 def record_one(self,db,role,session,state,stamp,trip):
  key='arrival-'+hashlib.sha256((role+'|'+session+'|'+trip['id']).encode()).hexdigest()[:40]
  if db.execute('SELECT 1 FROM world_life_events WHERE role_id=? AND session_id=? AND event_id=?',(role,session,key)).fetchone():return
  self.life.event(db,role,session,key,'character-arrival',{'locationId':trip['destination'],'journeyId':trip['id'],'worldUtc':trip['dueAt']},stamp)
  if trip.get('goalPlanId'):
   living=self.life.living.state(db,role)
   if not living.get('outline'):
    content,_=self.life.living.content(db,role);living['outline']=content.get('life',{}).get('outline',{})
   step=next((s for s in living['outline'].get('steps',[]) if s.get('id')==trip.get('outlineStepId')),None)
   if step and step.get('status') in ['planned','reconsider']:step['status']='active';step['startedAt']=trip['dueAt']
   living['events']=[{'kind':'goal-step-started','stepId':trip.get('outlineStepId'),'at':trip['dueAt'],'source':'recorded-arrival','planId':trip['goalPlanId']},*living.get('events',[])][:80]
   living['lastGoalArrival']=trip['id'];self.life.living.store(db,role,living,stamp)
  self.life.journal.log(db,role,session,key,state,datetime.fromisoformat(trip['dueAt']),'抵达 '+next((p['name'] for p in self.life.shared.world(role_mode(role))['locations'] if p['id']==trip['destination']),trip['destination']),'character-arrival',trip['destination'])
  if trip.get('source') not in ['routine','goal-plan','room-reply'] and hasattr(self.life.runtime,'character_events'):
   self.life.runtime.character_events.enqueue_in(db,role,session,'outreach',key,{'origin':'character-arrival-v1','contextGuidance':'角色已经实际抵达约定地点。依据当前对话自主联系用户，迟到处理时以实际到达时间为准，不复读平台通知。','destination':trip['destination'],'receivedWorldAt':trip['dueAt']},stamp)
