"""A mode owns time and user location; characters retain their private schedules.

No dialogue or user records are rewritten during migration. Existing phase is
adopted from the most recently evaluated life instance, not the wall clock.
"""
from datetime import datetime,timedelta,timezone
import json
from persona_modes import role_mode,checked_mode
from scene_locations import arrival_area

PROFILES={
 'student':{'name':'普通大学生','initial':0,'monthly':1500,'daily':0},
 'student-comfortable':{'name':'宽裕家庭学生','initial':0,'monthly':2500,'daily':0},
 'merchant':{'name':'商人','initial':3000,'monthly':0,'daily':100},
 'heir':{'name':'贵公子／贵小姐','initial':10000,'monthly':5000,'daily':200},
 'independent':{'name':'独立生活','initial':0,'monthly':0,'daily':0},
}

class SharedWorld:
 def __init__(self,life,db):
  self.life=life
  db.execute('CREATE TABLE IF NOT EXISTS shared_world_state(mode TEXT PRIMARY KEY,payload_json TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL)')
  db.execute('CREATE TABLE IF NOT EXISTS character_connections(role_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,opened_at TEXT NOT NULL)')
  # Migrate actual created conversations, never catalog-click timestamps.
  db.execute("DELETE FROM character_connections WHERE session_id='role:'||role_id||':primary'")
  rows=db.execute("SELECT role_id,session_id,created_at FROM role_sessions WHERE mode='character' AND deleted_at='' AND archived=0 AND session_id!='role:'||role_id||':primary' ORDER BY created_at DESC").fetchall()
  for row in rows:db.execute('INSERT OR IGNORE INTO character_connections VALUES(?,?,?)',(row['role_id'],row['session_id'],row['created_at']))
  self.life.runtime.registry.register('world_connection_open','Owner explicitly opens a character relationship.',mutating=True)(self.connect)
 def connect(self,args):
  from contextlib import closing
  role=args.get('roleId');session=args.get('sessionId');meta=self.life.runtime.role_workspace.session({'roleId':role,'sessionId':session})
  if meta.get('mode')!='character' or session==f'role:{role}:primary':return {'connected':False,'roleId':role}
  with closing(self.life.runtime.connect()) as db,db:
   db.execute('INSERT INTO character_connections VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET session_id=excluded.session_id,opened_at=excluded.opened_at',(role,session,meta.get('createdAt') or self.life.stamp()))
  self.life.runtime.backup_manager.mark_dirty()
  return {'connected':True,'roleId':role,'sessionId':session}
 def owner(self,mode):
  mode=checked_mode(mode);role=('special.' if mode=='special' else '')+'world-user'
  return role,'world:'+mode
 def world(self,mode):
  worlds=self.life.runtime.worldbook_for_mode(mode).catalog()['worlds']
  world=next((w for w in worlds if w['id']=='urban' and w.get('available',True)),next(w for w in worlds if w.get('available',True)))
  world=json.loads(json.dumps(world));ids={p['id'] for p in world['locations']}
  if 'home' in ids:
   for i in [1,2]:
    if 'guest-room-'+str(i) not in ids:world['locations'].append({'id':'guest-room-'+str(i),'name':'家中客房'+('一' if i==1 else '二'),'aliases':['客房'+str(i)],'description':'家中的独立客房，门窗与床、衣柜按房间固定布局。','ambience':'安静的私人房间。','objects':['床','衣柜','窗户'],'actions':['休息','整理物品'],'exits':['living-room'],'metadata':{'parentId':'home','kind':'room'}})
  return world
 def meta(self,world):return {'mode':'character','opening':{'world':{'id':world['id'],'location':world['defaultLocation']}}}
 def read(self,db,mode,stamp,world):
  row=db.execute('SELECT * FROM shared_world_state WHERE mode=?',(mode,)).fetchone()
  if row:
   value=json.loads(row['payload_json']);revision=row['revision'];places={p['id']:p for p in world['locations']};exact=arrival_area(places,value['userLocation'],'world-user:'+mode)
   if exact!=value['userLocation']:
    old=value['userLocation'];value['userLocation']=exact
    if (value.get('lastJourney') or {}).get('locationId')==old:value['lastJourney']['locationId']=exact
    revision+=1;self.write(db,mode,value,revision,stamp)
   return value,revision
  # Role ID rather than world ID isolates the migration across banks.
  candidates=db.execute('SELECT role_id,state_json FROM world_life_instances WHERE world_id=? ORDER BY updated_at DESC,rowid DESC',(world['id'],)).fetchall()
  old=next((json.loads(r['state_json']) for r in candidates if role_mode(r['role_id'])==mode),None)
  real=datetime.fromisoformat(stamp)
  policy=(old or {}).get('timePolicy',{})
  offset=policy.get('clockOffsetSeconds') if policy.get('calendarVersion') else None
  if offset is None:offset=(real.replace(year=2001,month=5,day=1)-real).total_seconds()
  seed='home' if any(p['id']=='home' for p in world['locations']) else world['defaultLocation']
  if not old:
   for row in self.sessions(db,mode):
    if db.execute("SELECT 1 FROM conversation_messages WHERE role_id=? AND session_id=? AND deleted_at='' LIMIT 1",(row['role_id'],row['session_id'])).fetchone():
     binding=(json.loads(row['opening_json']) or {}).get('world') or {}
     if binding.get('id')==world['id']:seed=binding.get('location',seed);break
  value={'worldId':world['id'],'userLocation':(old or {}).get('userLocation',seed),
   'timePolicy':{**policy,'clockOffsetSeconds':offset,'calendarVersion':1,'mode':'fictional','era':'新历','yearOffset':1700,'utcOffsetMinutes':480},'lastAdvance':(old or {}).get('lastAdvance'),'profile':None,'incomeStartedAt':None,'incomeClaimedThrough':None,'identityGranted':False}
  value['userLocation']=arrival_area({p['id']:p for p in world['locations']},value['userLocation'],'world-user:'+mode)
  db.execute('INSERT INTO shared_world_state VALUES(?,?,1,?)',(mode,json.dumps(value,ensure_ascii=False),stamp))
  return value,1
 def write(self,db,mode,value,revision,stamp):
  db.execute('UPDATE shared_world_state SET payload_json=?,revision=?,updated_at=? WHERE mode=?',(json.dumps(value,ensure_ascii=False),revision,stamp,mode))
 def adopt(self,db,role,state,world,stamp):
  shared,rev=self.read(db,role_mode(role),stamp,world)
  old=state['timePolicy'].get('clockOffsetSeconds',0);new=shared['timePolicy']['clockOffsetSeconds']
  if state.get('override'):state['override']['until']-=new-old
  state['_sharedChanged']=state.get('userLocation')!=shared['userLocation'] or old!=new
  state['timePolicy']=dict(shared['timePolicy']);state['userLocation']=shared['userLocation'];state['lastAdvance']=shared.get('lastAdvance')
  state['_sharedOriginal']={'userLocation':state['userLocation'],'offset':new};state['personaMode']=role_mode(role)
  return state
 def save_changes(self,db,role,state,stamp):
  original=state.pop('_sharedOriginal',None)
  if not original:return
  mode=role_mode(role);shared,rev=self.read(db,mode,stamp,self.world(mode));changed=False
  if state['userLocation']!=original['userLocation']:shared['userLocation']=state['userLocation'];changed=True
  if state['timePolicy']['clockOffsetSeconds']!=original['offset']:
   shared['timePolicy']=dict(state['timePolicy']);shared['lastAdvance']=state.get('lastAdvance');changed=True
  if changed:self.write(db,mode,shared,rev+1,stamp)
 def sessions(self,db,mode):
  rows=db.execute("SELECT * FROM role_sessions WHERE mode='character' AND deleted_at='' AND archived=0 ORDER BY updated_at DESC,created_at DESC").fetchall()
  active={r['role_id']:r['session_id'] for r in db.execute('SELECT role_id,session_id FROM character_connections')}
  rows=sorted(rows,key=lambda r:(active.get(r['role_id'])==r['session_id'],r['updated_at'],r['created_at']),reverse=True)
  seen=set();result=[]
  for row in rows:
   if role_mode(row['role_id'])!=mode or row['role_id'] in seen:continue
   if row['session_id']==f"role:{row['role_id']}:primary":continue
   seen.add(row['role_id']);result.append(dict(row))
  return result
 def settle(self,db,mode,stamp,exclude=None):
  world=self.world(mode);actors=[];prepared=[]
  if hasattr(self.life,'transport'):self.life.transport.settle(db,mode,stamp)
  for row in self.sessions(db,mode):
   role,session=row['role_id'],row['session_id'];opening=json.loads(row['opening_json']) or {}
   meta={'mode':'character','opening':{**opening,'world':opening.get('world') or self.meta(world)['opening']['world']}}
   places=self.life.places(role,session,world,db)
   state,rev=self.life._state(db,role,session,world,meta,stamp)
   changed=False
   if (role,session)!=exclude:
    changed=self.life.residences.tick(db,role,session,state,stamp,places)
    if self.life._tick(state,stamp,places):changed=True
    if self.life.journal.tick(db,role,session,state,stamp,places):changed=True
    if self.life.services.process(db,role,session,state,stamp,places):changed=True
   self.life._save(db,role,session,state,rev+int(changed),stamp)
   binding=self.life.services.output(db,role,session,state)['binding']
   actors.append({'roleId':role,'sessionId':session,'locationId':state['roleLocation'],'enRoute':self.life.journeys.output(state,stamp),'activity':state['activity'],'binding':binding,'journal':self.life.journal.output(db,role,session,state)['journal'],**self.life.day_journals.output(db,role,session,state)})
   prepared.append((role,session,state,rev+int(changed),places))
  for role,session,state,rev,places in prepared:
   if self.life.living.tick(db,role,session,state,stamp,places,actors):
    self.life._save(db,role,session,state,rev+1,stamp)
    for actor in actors:
     if actor['roleId']==role:actor.update(locationId=state['roleLocation'],activity=state['activity'],enRoute=self.life.journeys.output(state,stamp))
  # Observe only after every actor has finished this tick, including wish departures.
  for role,session,state,rev,places in prepared:
   if self.life.social.observe(db,role,session,state,stamp,places,actors):
    current=db.execute('SELECT revision FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()[0]
    self.life._save(db,role,session,state,current+1,stamp)
  return actors
 def income(self,value,now):
  profile=value.get('profile');start=value.get('incomeClaimedThrough') or value.get('incomeStartedAt')
  if not profile or not start:return {'pending':0,'days':0,'months':0}
  then=datetime.fromisoformat(start)+timedelta(hours=8);local=now+timedelta(hours=8)
  days=max(0,(local.date()-then.date()).days);months=max(0,(local.year-then.year)*12+local.month-then.month)
  return {'pending':days*PROFILES[profile]['daily']+months*PROFILES[profile]['monthly'],'days':days,'months':months}
 def output(self,db,role,stamp,actors):
  mode=role_mode(role);value,rev=self.read(db,mode,stamp,self.world(mode));now=datetime.fromisoformat(stamp)+timedelta(seconds=value['timePolicy']['clockOffsetSeconds'])
  return {'actors':actors,'sharedRevision':rev,'identityBank':self.life.identities.list_in(db,mode),'userEconomy':{'profile':value.get('profile'),'profiles':[{'id':key,**p} for key,p in PROFILES.items()],**self.income(value,now),'initialGranted':value['identityGranted']}}
