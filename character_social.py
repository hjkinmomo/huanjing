"""Public cards and source-backed private observations, never shared dialogue."""
from contextlib import closing
from datetime import datetime,timedelta
from pathlib import Path
import copy,hashlib,json
from persona_modes import role_mode,base_role_id
from role_workspace import identifier
from scene_locations import location_label

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

class CharacterSocial:
 def __init__(self,life,db):
  self.life=life;self.token=object();self.assets=Path(__file__).parent/'web/assets/experience';self.file_cache={};self.name_cache=None
  db.executescript('''CREATE TABLE IF NOT EXISTS character_public_cards(role_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS character_observations(id TEXT PRIMARY KEY,role_id TEXT NOT NULL,session_id TEXT NOT NULL,subject_id TEXT NOT NULL,kind TEXT NOT NULL,world_at TEXT NOT NULL,location_id TEXT NOT NULL,payload_json TEXT NOT NULL,forgotten INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS character_observation_owner ON character_observations(role_id,subject_id,world_at);
  CREATE TABLE IF NOT EXISTS character_impressions(role_id TEXT NOT NULL,subject_id TEXT NOT NULL,payload_json TEXT NOT NULL,revision INTEGER NOT NULL,forgotten INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(role_id,subject_id));''')
  for name,fn,write in [('character_public_get',self.public_get,False),('character_social_get',self.get,False),('character_public_save',self.save,True),('character_social_memory',self.memory,True)]:life.runtime.registry.register(name,'Owner UI public cards and private observation management; no dialogue sharing.',mutating=write)(fn)
  from character_social_model import SocialModel
  self.model=SocialModel(self)
 def scope(self,db,args):
  role=identifier(args.get('roleId'),80);session=identifier(args.get('sessionId'))
  if session==f'role:{role}:primary':raise ValueError('social_conversation_required')
  row=db.execute("SELECT * FROM role_sessions WHERE role_id=? AND session_id=? AND mode='character' AND deleted_at='' AND archived=0",(role,session)).fetchone()
  if not row or not any(r['role_id']==role and r['session_id']==session for r in self.life.shared.sessions(db,role_mode(role))):raise ValueError('social_conversation_required')
  option=db.execute('SELECT memory_policy FROM chat_session_options WHERE role_id=? AND session_id=?',(role,session)).fetchone()
  if option and option[0]=='readonly':raise PermissionError('readonly_social_disabled')
  active=self.life.identities.current(db,role_mode(role));owner=db.execute('SELECT identity_id FROM world_identity_session_owners WHERE role_id=? AND session_id=?',(role,session)).fetchone()
  if owner and (not active or owner[0]!=active['id']):raise ValueError('identity_session_inactive')
  return role,session,active['id'] if active else ''
 def active(self,db,mode):
  return [r['role_id'] for r in self.life.shared.sessions(db,mode) if not db.execute("SELECT 1 FROM chat_session_options WHERE role_id=? AND session_id=? AND memory_policy='readonly'",(r['role_id'],r['session_id'])).fetchone()]
 def config(self,name):
  path=self.assets/name;signature=(path.stat().st_mtime_ns,path.stat().st_size)
  if self.file_cache.get(name,{}).get('signature')!=signature:self.file_cache[name]={'signature':signature,'value':json.loads(path.read_text('utf8'))}
  return self.file_cache[name]['value']
 def names(self,db):
  # Read names only. No system prompt, roleCards, messages, memory or nickname.
  roles=self.config('catalog.json').get('roles',[]);names={r['id']:r['name'] for r in roles}
  names.update({'special.'+key:value for key,value in list(names.items())})
  row=db.execute("SELECT payload_json,revision FROM client_workspace WHERE id='experience'").fetchone()
  if row:
   if not self.name_cache or self.name_cache[0]!=row['revision']:self.name_cache=(row['revision'],json.loads(row['payload_json']).get('legacy',{}).get('customRoles',[]))
   custom=self.name_cache[1]
   for r in custom:
    if isinstance(r,dict) and isinstance(r.get('id'),str) and isinstance(r.get('name'),str):names[r['id']]=r['name'][:40]
  return names
 def card(self,db,role):
  names=self.names(db);row=db.execute('SELECT * FROM character_public_cards WHERE role_id=?',(role,)).fetchone()
  try:defaults=self.config('character-public-cards.json').get('roles',{}).get(base_role_id(role),{})
  except (OSError,ValueError,AttributeError):defaults={}
  identity=defaults.get('identity','') if isinstance(defaults,dict) else ''
  value={'name':names.get(role,role),'identity':identity[:80] if isinstance(identity,str) else '','relation':''}
  if row:value.update(json.loads(row['payload_json']))
  return {**value,'roleId':role,'revision':row['revision'] if row else 0,'source':'owner-public' if row else 'editable-public-draft','mode':role_mode(role)}
 def impression(self,db,role,subject,include_forgotten=False):
  row=db.execute('SELECT * FROM character_impressions WHERE role_id=? AND subject_id=?',(role,subject)).fetchone()
  if not row:return None
  if row['forgotten'] and not include_forgotten:return None
  value=json.loads(row['payload_json'])
  return {k:v for k,v in {**value,'revision':row['revision'],'forgotten':bool(row['forgotten'])}.items() if k not in ['history','operationHash','callId','userMessageId']}
 def evidence(self,db,role,subject,limit=6):
  return [json.loads(r[0]) for r in db.execute('SELECT payload_json FROM character_observations WHERE role_id=? AND subject_id=? AND forgotten=0 ORDER BY rowid DESC LIMIT ?',(role,subject,limit))]
 def public_get(self,args):
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   try:role,session,_=self.scope(db,args)
   except (ValueError,PermissionError) as error:
    if str(error) not in ['social_conversation_required','readonly_social_disabled']:raise
    return {'eligible':False,'reason':str(error)}
   return {'eligible':True,'roleId':role,'sessionId':session,'ownCard':self.card(db,role)}
 def get(self,args):
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   try:role,session,bank=self.scope(db,args)
   except (ValueError,PermissionError) as error:
    if str(error) not in ['social_conversation_required','readonly_social_disabled']:raise
    return {'eligible':False,'reason':str(error),'subjects':[]}
   subjects=[]
   for subject in self.active(db,role_mode(role)):
    if subject==role:continue
    row=db.execute('SELECT revision,forgotten FROM character_impressions WHERE role_id=? AND subject_id=?',(role,subject)).fetchone()
    forgotten=db.execute('SELECT COUNT(*) FROM character_observations WHERE role_id=? AND subject_id=? AND forgotten=1',(role,subject)).fetchone()[0]
    subjects.append({'card':self.card(db,subject),'evidence':self.evidence(db,role,subject),'impression':self.impression(db,role,subject),'memoryRevision':row['revision'] if row else 0,'canRestore':bool(forgotten or row and row['forgotten'])})
   return {'eligible':True,'roleId':role,'sessionId':session,'identityId':bank,'ownCard':self.card(db,role),'subjects':subjects,'modelRule':'Only a genuine current character model may write an impression from its own active evidence.'}
 def save(self,args):
  value=args.get('card');stamp=self.life.stamp()
  if not isinstance(value,dict) or set(value)!={'name','identity','relation'} or any(not isinstance(value[k],str) or len(value[k])>n for k,n in [('name',40),('identity',80),('relation',80)]) or not value['name'].strip():raise ValueError('public_card_invalid')
  value={k:v.strip() for k,v in value.items()}
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');role,session,_=self.scope(db,args);old=self.card(db,role)
   if type(args.get('expectedRevision'))is not int or args['expectedRevision']!=old['revision']:raise ValueError('public_card_conflict')
   db.execute('INSERT INTO character_public_cards VALUES(?,?,?,?) ON CONFLICT(role_id) DO UPDATE SET payload_json=excluded.payload_json,revision=excluded.revision,updated_at=excluded.updated_at',(role,json.dumps(value,ensure_ascii=False),old['revision']+1,stamp))
  self.life.runtime.backup_manager.mark_dirty();return self.get(args)
 def memory(self,args):
  action=args.get('action');subject=identifier(args.get('subjectId'),80);stamp=self.life.stamp()
  if action not in ['forget','restore']:raise ValueError('social_memory_action_invalid')
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');role,session,_=self.scope(db,args)
   if subject==role or subject not in self.active(db,role_mode(role)):raise ValueError('social_subject_inactive')
   row=db.execute('SELECT * FROM character_impressions WHERE role_id=? AND subject_id=?',(role,subject)).fetchone();rev=row['revision'] if row else 0
   if type(args.get('expectedRevision'))is not int or args['expectedRevision']!=rev:raise ValueError('social_memory_conflict')
   value=json.loads(row['payload_json']) if row else {};forgotten=int(action=='forget')
   db.execute('INSERT INTO character_impressions VALUES(?,?,?,?,?,?) ON CONFLICT(role_id,subject_id) DO UPDATE SET payload_json=excluded.payload_json,revision=excluded.revision,forgotten=excluded.forgotten,updated_at=excluded.updated_at',(role,subject,json.dumps(value,ensure_ascii=False),rev+1,forgotten,stamp))
   db.execute('UPDATE character_observations SET forgotten=? WHERE role_id=? AND subject_id=?',(forgotten,role,subject))
   living=self.life.living.state(db,role);muted=set(living.get('socialMuted',[]))
   if forgotten:muted.add(subject);living.get('knowledge',{}).pop(subject,None)
   else:
    muted.discard(subject);seen=next((e for e in self.evidence(db,role,subject) if e['kind']=='seen'),None)
    if seen:living.setdefault('knowledge',{})[subject]={'lastObservedLocation':seen['locationId'],'lastObservedAt':seen['at'],'currentlyTogether':living.get('socialPresence',{}).get(subject)==seen['locationId'],'source':'exact-room-v2','evidenceId':seen['id']}
   living['socialMuted']=sorted(muted);self.life.living.store(db,role,living,stamp)
  self.life.runtime.backup_manager.mark_dirty();return self.get(args)
 def observe(self,db,role,session,worldstate,stamp,places,actors):
  try:self.scope(db,{'roleId':role,'sessionId':session})
  except (ValueError,PermissionError):return False
  living=self.life.living.state(db,role);before=json.dumps(living,sort_keys=True);own=worldstate['roleLocation'];world=datetime.fromisoformat(stamp)+timedelta(seconds=worldstate['timePolicy'].get('clockOffsetSeconds',0))
  place=places.get(own,{});kind=place.get('metadata',{}).get('kind');precise=bool(place) and kind not in ['building','floor','home','district'] and (kind in ['room','area'] or not any(p.get('metadata',{}).get('parentId')==own for p in places.values()))
  active=set(self.active(db,role_mode(role)))
  present={} if worldstate.get('enRoute') or not precise else {a['roleId']:own for a in actors if a['roleId']!=role and a['roleId'] in active and not a.get('enRoute') and a['locationId']==own}
  if precise and not worldstate.get('enRoute') and not self.life.transport.output(db,role_mode(role))['current'] and worldstate['userLocation']==own:present['user']=own
  previous=living.get('socialPresence',{});muted=set(living.get('socialMuted',[]));muted.intersection_update(present)
  for who,known in living.get('knowledge',{}).items():
   known['currentlyTogether']=who in present and who not in muted
   if known.get('source')!='exact-room-v2':known['source']='legacy-unverified'
  for who,place in present.items():
   if who in muted:continue
   if previous.get(who)==place:continue
   living['socialSequence']=living.get('socialSequence',0)+1;key='observed-'+digest([role,session,living['socialSequence'],who,'seen'])[:36]
   name='你' if who=='user' else self.card(db,who)['name']
   fact={'id':key,'subjectId':who,'subjectName':name,'kind':'seen','at':world.isoformat(),'locationId':place,'placeName':location_label(places,place),'source':'exact-room-v2','destinationKnown':False}
   db.execute('INSERT OR IGNORE INTO character_observations VALUES(?,?,?,?,?,?,?,?,0)',(key,role,session,who,'seen',world.isoformat(),place,json.dumps(fact,ensure_ascii=False)))
   living.setdefault('knowledge',{})[who]={'lastObservedLocation':place,'lastObservedAt':world.isoformat(),'currentlyTogether':True,'source':'exact-room-v2','evidenceId':key}
   living.setdefault('events',[]).insert(0,{'kind':'noticed-arrival','actorId':who,'locationId':place,'at':world.isoformat(),'source':'exact-room-v2','evidenceId':key})
  for who,place in previous.items():
   if who in present:continue
   if not db.execute("SELECT 1 FROM character_observations WHERE role_id=? AND subject_id=? AND kind='seen' AND forgotten=0",(role,who)).fetchone():continue
   living['socialSequence']=living.get('socialSequence',0)+1;key='observed-'+digest([role,session,living['socialSequence'],who,'lost-sight'])[:36]
   fact={'id':key,'subjectId':who,'subjectName':'你' if who=='user' else self.card(db,who)['name'],'kind':'lost-sight','at':world.isoformat(),'locationId':place,'placeName':location_label(places,place),'source':'exact-room-v2','destinationKnown':False,'observerMoved':bool(worldstate.get('enRoute') or own!=place)}
   db.execute('INSERT OR IGNORE INTO character_observations VALUES(?,?,?,?,?,?,?,?,0)',(key,role,session,who,'lost-sight',world.isoformat(),place,json.dumps(fact,ensure_ascii=False)))
   living.setdefault('events',[]).insert(0,{'kind':'noticed-departure','actorId':who,'at':world.isoformat(),'source':'exact-room-v2','destinationKnown':False,'evidenceId':key})
  living['socialPresence']=present;living['socialMuted']=sorted(muted);living['present']=sorted(w for w in present if w not in muted);living['events']=living.get('events',[])[:80]
  changed=before!=json.dumps(living,sort_keys=True)
  if changed:self.life.living.store(db,role,living,stamp)
  return changed
