"""Owned fictional travel with paid-once fares and the existing shared clock."""
from contextlib import closing
from datetime import datetime,timedelta
import hashlib,json,math,uuid
from persona_modes import checked_mode
from scene_locations import location_accessible,arrival_area,location_label
from role_workspace import identifier

METHODS={'walk':{'name':'步行','speed':4.5,'wait':0},'bike':{'name':'共享单车','speed':11,'wait':1},'bus':{'name':'公交','speed':18,'wait':5},'taxi':{'name':'打车','speed':32,'wait':2}}
def route_distance(places,origin,destination):
 def root(pid):
  seen=set()
  while pid in places and places[pid].get('metadata',{}).get('parentId') in places and pid not in seen:seen.add(pid);pid=places[pid]['metadata']['parentId']
  return pid
 a,b=root(origin),root(destination)
 if a==b:return .12
 def point(pid):
  m=places[pid].get('metadata',{}).get('map',{})
  if type(m.get('x')) in (int,float) and type(m.get('y')) in (int,float):return m['x'],m['y']
  h=int(hashlib.sha256(pid.encode()).hexdigest()[:8],16);return 10+(h%7)*12,10+(h//7%6)*12
 x,y=point(a);xx,yy=point(b);return round(max(.4,math.hypot(x-xx,y-yy)/18),2)
def route_terms(method,km,hour):
 m=METHODS[method];rush=7<=hour<9 or 17<=hour<19;speed=m['speed']*(.7 if method=='taxi' and rush else .8 if method=='bus' and rush else 1)
 minutes=max(2,math.ceil(km/speed*60)+m['wait']);fare=0 if method=='walk' else 2 if method=='bike' else 3 if method=='bus' else 10+math.ceil(km*3)+(3 if hour>=23 or hour<6 else 0)
 return minutes,fare

class WorldTransport:
 def __init__(self,life,db):
  self.life=life
  db.execute('CREATE TABLE IF NOT EXISTS world_trips(id TEXT PRIMARY KEY,mode TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL,due_at TEXT NOT NULL,created_at TEXT NOT NULL)')
  for name,fn,write in [('world_transport_get',self.get,False),('world_transport_quote',self.quote,True),('world_transport_start',self.start,True),('world_transport_skip',self.skip,True)]:life.runtime.registry.register(name,'Owner fictional travel; fares and arrival use the shared world, not real transport.',mutating=write)(fn)
 def now(self,value,stamp):return datetime.fromisoformat(stamp)+timedelta(seconds=value['timePolicy']['clockOffsetSeconds'])
 def output(self,db,mode):
  trips=[{**json.loads(r['payload_json']),'status':r['status']} for r in db.execute("SELECT * FROM world_trips WHERE mode=? AND status!='quoted' ORDER BY created_at DESC LIMIT 20",(mode,))]
  return {'methods':[{'id':key,**v} for key,v in METHODS.items()],'current':next((p for p in trips if p['status']=='travelling'),None),'trips':trips}
 def get(self,args):
  mode=checked_mode(args.get('mode','normal'))
  with closing(self.life.runtime.connect()) as db:return self.output(db,mode)
 def quote(self,args):
  mode=checked_mode(args.get('mode','normal'));method=args.get('method');stamp=self.life.stamp();key=identifier(args.get('requestId'))
  if method not in METHODS:raise ValueError('travel_method_invalid')
  world=self.life.shared.world(mode);places={p['id']:p for p in world['locations']}
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');value,rev=self.life.shared.read(db,mode,stamp,world);now=self.now(value,stamp);dest=args.get('locationId');role=args.get('targetRoleId');target=None
   if role:
    row=next((r for r in self.life.shared.sessions(db,mode) if r['role_id']==role),None)
    if not row:raise ValueError('travel_character_not_created')
    meta={'mode':'character','opening':json.loads(row['opening_json']) or self.life.shared.meta(world)['opening']};target,_=self.life._state(db,role,row['session_id'],world,meta,stamp);self.life._tick(target,stamp,places);dest=target['roleLocation']
   if dest not in places:raise ValueError('travel_destination_invalid')
   requested=dest
   if not target:dest=arrival_area(places,dest,'world-user:'+mode)
   if not location_accessible(places,dest):raise ValueError('world_life_location_locked')
   if dest==value['userLocation']:raise ValueError('travel_already_here')
   hour=(now+timedelta(minutes=value['timePolicy']['utcOffsetMinutes'])).hour
   # Find a route whose travel duration and scheduled destination agree.
   # A schedule that oscillates between homes cannot be quoted reliably.
   seen=set()
   for _ in range(12):
    if dest==value['userLocation']:raise ValueError('travel_target_comes_here')
    km=route_distance(places,value['userLocation'],dest);minutes,fare=route_terms(method,km,hour);due=now+timedelta(minutes=minutes)
    predicted=self.life.services.predicted(target,due,places) if target else dest
    if predicted==dest:break
    if predicted in seen:raise ValueError('travel_character_route_changed')
    seen.add(dest);dest=predicted
   else:raise ValueError('travel_character_route_changed')
   if not location_accessible(places,dest):raise ValueError('world_life_location_locked')
   q={'id':key,'method':method,'methodName':METHODS[method]['name'],'origin':value['userLocation'],'requestedDestination':requested,'destination':dest,'placeName':location_label(places,dest),'targetRoleId':role,'distanceKm':km,'durationMinutes':minutes,'fare':fare,'departureWorldUtc':now.isoformat(),'dueAt':due.isoformat(),'quotedRealUtc':stamp,'sharedRevision':rev}
   old=db.execute('SELECT payload_json FROM world_trips WHERE id=?',(key,)).fetchone()
   if old:raise ValueError('travel_quote_id_reused')
   db.execute('INSERT INTO world_trips VALUES(?,?,?,?,?,?)',(key,mode,json.dumps(q,ensure_ascii=False),'quoted',due.isoformat(),stamp))
  return q
 def start(self,args):
  mode=checked_mode(args.get('mode','normal'));key=identifier(args.get('id'));stamp=self.life.stamp()
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM world_trips WHERE id=? AND mode=?',(key,mode)).fetchone()
   if not row:raise ValueError('travel_quote_missing')
   q=json.loads(row['payload_json'])
   if row['status']!='quoted':
    snapshot,_,legacy,_=self.life.services.snapshot(db)
    return {'trip':{**q,'status':row['status']},'duplicate':True,'clientRevision':snapshot['revision'],'clientLegacy':legacy}
   if db.execute("SELECT 1 FROM world_trips WHERE mode=? AND status='travelling'",(mode,)).fetchone():raise ValueError('travel_in_progress')
   if db.execute("SELECT 1 FROM world_work_jobs WHERE mode=? AND status='working'",(mode,)).fetchone():raise ValueError('travel_work_in_progress')
   world=self.life.shared.world(mode)
   if not location_accessible({p['id']:p for p in world['locations']},q['destination']):raise ValueError('world_life_location_locked')
   value,rev=self.life.shared.read(db,mode,stamp,world)
   if value['userLocation']!=q['origin'] or rev!=q['sharedRevision'] or (datetime.fromisoformat(stamp)-datetime.fromisoformat(q['quotedRealUtc'])).total_seconds()>120:raise ValueError('travel_quote_expired')
   now=self.now(value,stamp);q.update(departureWorldUtc=now.isoformat(),dueAt=(now+timedelta(minutes=q['durationMinutes'])).isoformat())
   wallet=self.life.services.wallet(db,args.get('expectedClientRevision'),-q['fare'],'travel:'+key,'transport-fare',stamp,mode=mode)
   db.execute("UPDATE world_trips SET payload_json=?,status='travelling',due_at=? WHERE id=?",(json.dumps(q,ensure_ascii=False),q['dueAt'],key))
  self.life.runtime.backup_manager.mark_dirty();return {'trip':{**q,'status':'travelling'},**wallet}
 def settle(self,db,mode,stamp):
  world=self.life.shared.world(mode);value,rev=self.life.shared.read(db,mode,stamp,world);now=self.now(value,stamp)
  for row in db.execute("SELECT * FROM world_trips WHERE mode=? AND status='travelling' AND due_at<=? ORDER BY due_at",(mode,now.isoformat())).fetchall():
   q=json.loads(row['payload_json']);places={p['id']:p for p in world['locations']};q.setdefault('requestedDestination',q['destination']);q['destination']=arrival_area(places,q['destination'],'world-user:'+mode);q['placeName']=location_label(places,q['destination']);value['userLocation']=q['destination'];value['lastJourney']={'id':row['id'],'arrivedAt':q['dueAt'],'locationId':q['destination'],'method':q['method']};rev+=1;self.life.shared.write(db,mode,value,rev,stamp);db.execute("UPDATE world_trips SET status='arrived',payload_json=? WHERE id=?",(json.dumps(q,ensure_ascii=False),row['id']))
 def skip(self,args):
  mode=checked_mode(args.get('mode','normal'));key=identifier(args.get('id'));stamp=self.life.stamp()
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM world_trips WHERE id=? AND mode=?',(key,mode)).fetchone()
   if not row:raise ValueError('travel_trip_missing')
   if row['status']=='quoted':raise ValueError('travel_not_started')
   world=self.life.shared.world(mode);value,rev=self.life.shared.read(db,mode,stamp,world);now=self.now(value,stamp);due=datetime.fromisoformat(row['due_at']);seconds=max(0,(due-now).total_seconds())
   if seconds:value['timePolicy']['clockOffsetSeconds']+=seconds;value['lastAdvance']={'from':now.isoformat(),'to':due.isoformat(),'minutes':math.ceil(seconds/60)};self.life.shared.write(db,mode,value,rev+1,stamp)
   self.settle(db,mode,stamp);self.life.shared.settle(db,mode,stamp)
  self.life.runtime.backup_manager.mark_dirty();return {**self.get({'mode':mode}),'advancedSeconds':seconds}
