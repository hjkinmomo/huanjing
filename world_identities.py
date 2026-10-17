"""Named, immutable user identities and recoverable per-mode story banks.

Inactive banks are SQLite snapshots, not visible active memories. Configuration,
credentials and uploaded assets remain outside story resets. No model calls.
"""
from contextlib import closing
from datetime import datetime,timedelta
import copy,json,re,uuid
from persona_modes import checked_mode,role_mode
from shared_world import PROFILES

ROLE_TABLES=('phone_group_profiles','phone_group_memories','character_public_cards','character_observations','character_impressions','world_day_journals','world_commitments','character_event_queue','character_event_roles','memories','memory_relations','conversation_messages','tasks','schedules','events','proactive_policy','proactive_receipts','work_item_conversation_links','life_events','action_proposals','action_receipts','roleplay_lessons','moment_client_state','auto_moment_roles','role_sessions','role_memories','role_summaries','role_memory_jobs','chat_session_options','chat_context_chunks','chat_context_jobs','chat_branch_sources','temporary_places','world_life_instances','world_life_events','character_connections','character_residences','world_activity_log','character_bindings','world_delivery_orders','world_work_jobs','character_content','character_living','role_living_tasks','phone_read_receipts','moment_reaction_queue','moment_role_likes','moment_reaction_roles')
MESSAGE_TABLES=('conversation_scene_notices','conversation_reasoning','conversation_reasoning_translations','conversation_channels','world_message_origins')
MODE_TABLES=('phone_groups','phone_group_messages','phone_group_turns','phone_group_receipts','shared_world_state','world_trips','moment_audience')
MOMENT_TABLES=('moments','moment_comments')
ALLOWED=set(ROLE_TABLES+MESSAGE_TABLES+MODE_TABLES+MOMENT_TABLES)
WALLET_FIELDS=('coins','inventory','walletLedger','walletLedgerSeen','shoppingParcels','deliveryLog','purchaseLog','giftLog','giftOperations','relationshipLedger','leisure','pianoRoom','userProfile')
CONFIG_TABLES={'proactive_policy','character_content'}
STORY_MAPS=('selectedRoles','affection','relationshipProfiles','typedMemories','userProfiles','messages','roleChats','drafts','phoneDrafts','activeSessions','rosterCreated','rosterOpened','rosterActivity','unreadReplies','phoneUnreadReplies','interruptedReplies','positions','chatScroll','sessionScene','sceneStates')

class WorldIdentities:
 def __init__(self,life,db):
  self.life=life
  db.executescript('''CREATE TABLE IF NOT EXISTS world_identities(id TEXT PRIMARY KEY,mode TEXT NOT NULL,name TEXT NOT NULL,name_key TEXT NOT NULL,profile TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(mode,name_key));
  CREATE TABLE IF NOT EXISTS world_identity_active(mode TEXT PRIMARY KEY,identity_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS world_identity_session_owners(role_id TEXT NOT NULL,session_id TEXT NOT NULL,mode TEXT NOT NULL,identity_id TEXT NOT NULL,PRIMARY KEY(role_id,session_id));
  CREATE TABLE IF NOT EXISTS world_identity_wallets(mode TEXT NOT NULL,identity_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(mode,identity_id));''')
  life.runtime.registry.identity_guard=self.owner_guard
  for name,fn,write in [('world_identity_list',self.list,False),('world_identity_create',self.create,True),('world_identity_switch',self.switch,True),('world_identity_activate_mode',self.activate_mode,True),('world_identity_history',self.history,False)]:life.runtime.registry.register(name,'Owner UI identity save banks; no model can reset or switch stories.',mutating=write)(fn)
 def owner_guard(self,args,handler):
  # The new UI pins its story epoch until an explicit identity operation or
  # refresh. Serialize the check and owner operation with bank swaps.
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone()
   actual=json.loads(row[0]).get('experience',{}).get('dataEpoch') if row else None
   if args.get('expectedDataEpoch')!=actual:raise ValueError('client_snapshot_reset')
   return handler(args)
 def current(self,db,mode):
  row=db.execute('SELECT i.* FROM world_identities i JOIN world_identity_active a ON a.identity_id=i.id WHERE a.mode=?',(mode,)).fetchone()
  return dict(row) if row else None
 def public(self,row):return {k:row[k] for k in ['id','mode','name','profile','created_at','updated_at']}
 def list_in(self,db,mode):
  active=self.current(db,mode);rows=db.execute('SELECT * FROM world_identities WHERE mode=? ORDER BY updated_at DESC',(mode,)).fetchall()
  return {'mode':mode,'active':self.public(active) if active else None,'ready':bool(active and active['profile'] in PROFILES),'identities':[self.public(dict(r)) for r in rows],'profiles':[{'id':key,**v} for key,v in PROFILES.items()]}
 def list(self,args):
  mode=checked_mode(args.get('mode','normal'))
  with closing(self.life.runtime.connect()) as db:return self.list_in(db,mode)
 def scope_sql(self,column,mode):return f'"{column}"!=\'\' AND ("{column}" LIKE \'special.%\')=?',[int(mode=='special')]
 def tables(self,db):return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 def capture(self,db,mode,payload):
  available=self.tables(db);records={};columns={}
  for table in ROLE_TABLES:
   if table not in available or table in CONFIG_TABLES:continue
   columns[table]=[c[1] for c in db.execute('PRAGMA table_info("'+table+'")')]
   where,args=self.scope_sql('role_id',mode);records[table]=[dict(r) for r in db.execute('SELECT * FROM "'+table+'" WHERE '+where,args)]
  message_ids={r['id'] for r in records.get('conversation_messages',[])}
  # Social user posts are owned by their mode/audience and client owner, even
  # though their author is the generic user ID.
  mids={r['id'] for r in records.get('moment_client_state',[])}
  if 'moment_audience' in available:
   for r in db.execute('SELECT * FROM moment_audience WHERE mode=?',(mode,)):mids.add(r['moment_id'])
  where,args=self.scope_sql('author_id',mode)
  mids.update(r[0] for r in db.execute("SELECT id FROM moments WHERE author_id NOT IN ('user','self','owner') AND "+where,args))
  for table in MESSAGE_TABLES:
   if table not in available:continue
   columns[table]=[c[1] for c in db.execute('PRAGMA table_info("'+table+'")')];records[table]=[dict(r) for r in db.execute('SELECT * FROM "'+table+'"') if r['message_id'] in message_ids]
  for table in MODE_TABLES:
   if table not in available:continue
   columns[table]=[c[1] for c in db.execute('PRAGMA table_info("'+table+'")')];records[table]=[dict(r) for r in db.execute('SELECT * FROM "'+table+'" WHERE mode=?',(mode,))]
  for table in MOMENT_TABLES:
   columns[table]=[c[1] for c in db.execute('PRAGMA table_info("'+table+'")')];records[table]=[dict(r) for r in db.execute('SELECT * FROM "'+table+'"') if r['id' if table=='moments' else 'moment_id'] in mids]
  session_keys={r['session_id'] for r in records.get('role_sessions',[])}
  def owned(key):
   if key.startswith('conversation:'):return key[13:] in session_keys
   return role_mode(key)==mode
  maps={}
  for branch in ['legacy','experience']:
   data=payload.get(branch,{})
   maps[branch]={k:{key:copy.deepcopy(v) for key,v in data[k].items() if owned(key)} for k in STORY_MAPS if isinstance(data.get(k),dict)}
  wallet={k:copy.deepcopy(payload.get('legacy',{}).get(k)) for k in WALLET_FIELDS if k in payload.get('legacy',{})}
  return {'version':1,'mode':mode,'records':records,'columns':columns,'clientMaps':maps,'wallet':wallet,'capturedAt':self.life.stamp()}
 def busy(self,db,mode):
  for table,statuses in [('phone_group_receipts',['generating']),('tasks',['running','cancelling']),('role_memory_jobs',['queued','running']),('chat_context_jobs',['running']),('auto_moment_roles',['generating']),('moment_reaction_queue',['generating']),('character_event_queue',['generating'])]:
   if table not in self.tables(db):continue
   where,args=self.scope_sql('role_id',mode);sql='SELECT 1 FROM "'+table+'" WHERE '+where+' AND status IN ('+','.join('?' for _ in statuses)+') LIMIT 1'
   if db.execute(sql,[*args,*statuses]).fetchone():raise ValueError('identity_mode_busy')
 def delete_records(self,db,snapshot):
  # Delete children before parents; use captured primary keys so later deletions
  # do not rely on a join whose parent has already disappeared.
  order=['moment_comments',*MESSAGE_TABLES,*[t for t in ROLE_TABLES if t not in ['conversation_messages','role_sessions']],*MODE_TABLES,'moments','conversation_messages','role_sessions']
  for table in dict.fromkeys(order):
   if table in CONFIG_TABLES:continue
   rows=snapshot['records'].get(table,[])
   if not rows:continue
   info=list(db.execute('PRAGMA table_info("'+table+'")'));pk=[r[1] for r in sorted(info,key=lambda x:x[5]) if r[5]]
   if not pk:raise ValueError('identity_snapshot_primary_key_required')
   for row in rows:db.execute('DELETE FROM "'+table+'" WHERE '+' AND '.join('"'+k+'"=?' for k in pk),[row[k] for k in pk])
 def restore_records(self,db,snapshot):
  if snapshot.get('version')!=1:raise ValueError('identity_snapshot_version')
  order=['role_sessions','conversation_messages','moments',*[t for t in snapshot['records'] if t not in ['role_sessions','conversation_messages','moments','moment_comments']],'moment_comments']
  for table in dict.fromkeys(order):
   if table not in ALLOWED:raise ValueError('identity_snapshot_table_invalid')
   if table in CONFIG_TABLES:continue
   known={c[1] for c in db.execute('PRAGMA table_info("'+table+'")')}
   for row in snapshot['records'].get(table,[]):
    cols=list(row)
    if not set(cols)<=known:raise ValueError('identity_snapshot_columns_invalid')
    db.execute('INSERT INTO "'+table+'"('+','.join('"'+c+'"' for c in cols)+') VALUES('+','.join('?' for _ in cols)+')',[row[c] for c in cols])
 def client(self,db,expected):
  row=db.execute("SELECT * FROM client_workspace WHERE id='experience'").fetchone()
  if not row or type(expected) is not int or row['revision']!=expected:raise ValueError('client_snapshot_conflict')
  return row,json.loads(row['payload_json'])
 def preserve_current(self,db,mode,payload):
  active=self.current(db,mode);snapshot=self.capture(db,mode,payload)
  if not active:
   profile=next((json.loads(r['payload_json']).get('profile') for r in snapshot['records'].get('shared_world_state',[])),None) or ''
   key='legacy-'+mode;name='原有生活';stamp=self.life.stamp();db.execute('INSERT INTO world_identities VALUES(?,?,?,?,?,?,?,?)',(key,mode,name,name.casefold(),profile,'{}',stamp,stamp));db.execute('INSERT INTO world_identity_active VALUES(?,?)',(mode,key));active=self.current(db,mode)
  for session in snapshot['records'].get('role_sessions',[]):
   if session['session_id']!=f"role:{session['role_id']}:primary":db.execute('INSERT INTO world_identity_session_owners VALUES(?,?,?,?) ON CONFLICT(role_id,session_id) DO UPDATE SET identity_id=excluded.identity_id',(session['role_id'],session['session_id'],mode,active['id']))
  # A previously unnamed life obtains its bank ID during first preservation.
  # Keep already queued event receipts attached to that newly named old bank.
  for event in snapshot['records'].get('character_event_queue',[]):
   if not event['identity_id']:event['identity_id']=active['id']
  if 'character_event_queue' in self.tables(db):db.execute("UPDATE character_event_queue SET identity_id=? WHERE mode=? AND identity_id=''",(active['id'],mode))
  for item in snapshot['records'].get('world_commitments',[]):
   if not item['identity_id']:item['identity_id']=active['id']
  if 'world_commitments' in self.tables(db):db.execute("UPDATE world_commitments SET identity_id=? WHERE mode=? AND identity_id=''",(active['id'],mode))
  for table in ['phone_groups','phone_group_turns']:
   for item in snapshot['records'].get(table,[]):
    if not item['identity_id']:item['identity_id']=active['id']
   if table in self.tables(db):db.execute('UPDATE '+table+" SET identity_id=? WHERE mode=? AND identity_id=''",(active['id'],mode))
  for receipt in snapshot['wallet'].get('giftLog',[]):
   request=receipt.get('automaticResponse')
   if isinstance(request,dict) and not request.get('identityId') and role_mode(receipt.get('role',''))==mode:request['identityId']=active['id']
  db.execute('UPDATE world_identities SET snapshot_json=?,updated_at=? WHERE id=?',(json.dumps(snapshot,ensure_ascii=False),self.life.stamp(),active['id']))
  wallet=snapshot['wallet'];db.execute('INSERT INTO world_identity_wallets VALUES(?,?,?) ON CONFLICT(mode,identity_id) DO UPDATE SET payload_json=excluded.payload_json',(mode,active['id'],json.dumps(wallet,ensure_ascii=False)))
  return active,snapshot
 def merge_client(self,payload,outgoing,incoming,mode):
  for branch in ['legacy','experience']:
   data=payload.setdefault(branch,{})
   for field in STORY_MAPS:
    mapping=data.get(field)
    if not isinstance(mapping,dict):continue
    for key in outgoing.get('clientMaps',{}).get(branch,{}).get(field,{}):mapping.pop(key,None)
    mapping.update(copy.deepcopy(incoming.get('clientMaps',{}).get(branch,{}).get(field,{})))
   for field,values in incoming.get('clientMaps',{}).get(branch,{}).items():data.setdefault(field,{}).update(copy.deepcopy(values))
  for field in WALLET_FIELDS:payload['legacy'].pop(field,None)
  payload['legacy'].update(copy.deepcopy(incoming.get('wallet',{})));payload['legacy']['economyMode']=mode
  payload['experience']['dataEpoch']=uuid.uuid4().hex
  payload['experience'].setdefault('identityBanks',{})[mode]=incoming.get('identityId')
  return payload
 def finish(self,db,row,payload,mode,key):
  db.execute('INSERT INTO world_identity_active VALUES(?,?) ON CONFLICT(mode) DO UPDATE SET identity_id=excluded.identity_id',(mode,key))
  payload['experience'].setdefault('identityBanks',{})[mode]=key
  db.execute('INSERT INTO world_identity_wallets VALUES(?,?,?) ON CONFLICT(mode,identity_id) DO UPDATE SET payload_json=excluded.payload_json',(mode,key,json.dumps({k:payload['legacy'][k] for k in WALLET_FIELDS if k in payload['legacy']},ensure_ascii=False)))
  db.execute("UPDATE client_workspace SET payload_json=?,revision=revision+1,updated_at=? WHERE id='experience'",(json.dumps(payload,ensure_ascii=False),self.life.stamp()))
  return {'clientLegacy':payload['legacy'],'clientExperience':payload['experience'],'clientRevision':row['revision']+1,**self.list_in(db,mode)}
 def prepare_wallet_mode(self,db,payload,mode):
  legacy=payload.setdefault('legacy',{});oldmode=legacy.get('economyMode')
  if not oldmode or oldmode==mode:return
  old=self.current(db,oldmode)
  if old:db.execute('INSERT INTO world_identity_wallets VALUES(?,?,?) ON CONFLICT(mode,identity_id) DO UPDATE SET payload_json=excluded.payload_json',(oldmode,old['id'],json.dumps({k:legacy[k] for k in WALLET_FIELDS if k in legacy},ensure_ascii=False)))
  target=self.current(db,mode);wallet=db.execute('SELECT payload_json FROM world_identity_wallets WHERE mode=? AND identity_id=?',(mode,target['id'])).fetchone() if target else None
  for field in WALLET_FIELDS:legacy.pop(field,None)
  legacy.update(json.loads(wallet[0]) if wallet else {'coins':520,'inventory':{},'walletLedger':[],'shoppingParcels':{},'leisure':{}});legacy['economyMode']=mode
 def create(self,args):
  mode=checked_mode(args.get('mode','normal'));name=re.sub(r'\s+',' ',str(args.get('name',''))).strip();profile=args.get('profile')
  if not name or len(name)>60 or profile not in PROFILES:raise ValueError('identity_name_or_profile_invalid')
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');row,payload=self.client(db,args.get('expectedClientRevision'));self.busy(db,mode)
   if db.execute('SELECT 1 FROM world_identities WHERE mode=? AND name_key=?',(mode,name.casefold())).fetchone():raise ValueError('identity_name_exists')
   active=self.current(db,mode)
   if active and active['profile'] in PROFILES and args.get('restart') is not True:raise ValueError('identity_already_chosen')
   self.prepare_wallet_mode(db,payload,mode);outgoing,snapshot=self.preserve_current(db,mode,payload);self.delete_records(db,snapshot);stamp=self.life.stamp();key=uuid.uuid4().hex
   empty={'version':1,'mode':mode,'records':{},'columns':{},'clientMaps':{'legacy':{},'experience':{}},'wallet':{'coins':520+PROFILES[profile]['initial'],'inventory':{},'walletLedger':[],'shoppingParcels':{},'giftLog':[],'leisure':{}}}
   if not args.get('restart'):
    for branch in ['legacy','experience']:
     selected=snapshot.get('clientMaps',{}).get(branch,{}).get('selectedRoles',{})
     if selected:empty['clientMaps'][branch]['selectedRoles']=copy.deepcopy(selected)
   db.execute('INSERT INTO world_identities VALUES(?,?,?,?,?,?,?,?)',(key,mode,name,name.casefold(),profile,json.dumps(empty),stamp,stamp))
   world=self.life.shared.world(mode);value,rev=self.life.shared.read(db,mode,stamp,world);now=datetime.fromisoformat(stamp)+timedelta(seconds=value['timePolicy']['clockOffsetSeconds']);value.update(profile=profile,identityGranted=True,incomeStartedAt=now.isoformat(),incomeClaimedThrough=now.isoformat());self.life.shared.write(db,mode,value,rev+1,stamp)
   payload=self.merge_client(payload,snapshot,empty,mode);result=self.finish(db,row,payload,mode,key)
  self.life.runtime.backup_manager.mark_dirty();return result
 def switch(self,args):
  mode=checked_mode(args.get('mode','normal'));key=str(args.get('id',''))
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');row,payload=self.client(db,args.get('expectedClientRevision'));self.busy(db,mode);target=db.execute('SELECT * FROM world_identities WHERE id=? AND mode=?',(key,mode)).fetchone()
   if not target:raise ValueError('identity_slot_missing')
   active=self.current(db,mode)
   if active and active['id']==key:return {'duplicate':True,'clientLegacy':payload['legacy'],'clientExperience':payload['experience'],'clientRevision':row['revision'],**self.list_in(db,mode)}
   self.prepare_wallet_mode(db,payload,mode);_,snapshot=self.preserve_current(db,mode,payload);self.delete_records(db,snapshot);incoming=json.loads(target['snapshot_json'])
   wallet=db.execute('SELECT payload_json FROM world_identity_wallets WHERE mode=? AND identity_id=?',(mode,key)).fetchone()
   if wallet:incoming['wallet']=json.loads(wallet[0])
   # Inactive story banks are paused saves; restore their phase without
   # fabricating all the time spent playing another identity.
   elapsed=max(0,(datetime.fromisoformat(self.life.stamp())-datetime.fromisoformat(incoming.get('capturedAt',self.life.stamp()))).total_seconds())
   for record in incoming.get('records',{}).get('shared_world_state',[]):
    value=json.loads(record['payload_json']);policy=value.setdefault('timePolicy',{});policy['clockOffsetSeconds']=policy.get('clockOffsetSeconds',0)-elapsed;record['payload_json']=json.dumps(value,ensure_ascii=False)
   for record in incoming.get('records',{}).get('world_life_instances',[]):
    value=json.loads(record['state_json']);policy=value.setdefault('timePolicy',{});policy['clockOffsetSeconds']=policy.get('clockOffsetSeconds',0)-elapsed
    if value.get('override'):value['override']['until']+=elapsed
    value['lastEvaluatedAt']=self.life.stamp();record['state_json']=json.dumps(value,ensure_ascii=False)
   self.restore_records(db,incoming)
   payload=self.merge_client(payload,snapshot,incoming,mode);result=self.finish(db,row,payload,mode,key)
  self.life.runtime.backup_manager.mark_dirty();return result
 def activate_mode(self,args):
  mode=checked_mode(args.get('mode','normal'))
  with self.life.lock,closing(self.life.runtime.connect()) as db,db:
   db.execute('BEGIN IMMEDIATE');row,payload=self.client(db,args.get('expectedClientRevision'));legacy=payload.get('legacy',{});oldmode=legacy.get('economyMode') or args.get('previousMode')
   if oldmode in ['normal','special'] and oldmode!=mode:
    active=self.current(db,oldmode)
    if not active:active,_=self.preserve_current(db,oldmode,payload)
    if active:db.execute('INSERT INTO world_identity_wallets VALUES(?,?,?) ON CONFLICT(mode,identity_id) DO UPDATE SET payload_json=excluded.payload_json',(oldmode,active['id'],json.dumps({k:legacy[k] for k in WALLET_FIELDS if k in legacy},ensure_ascii=False)))
   active=self.current(db,mode)
   if active:
    wallet=db.execute('SELECT payload_json FROM world_identity_wallets WHERE mode=? AND identity_id=?',(mode,active['id'])).fetchone()
    if wallet and oldmode!=mode:
     for field in WALLET_FIELDS:legacy.pop(field,None)
     legacy.update(json.loads(wallet[0]))
   elif oldmode and oldmode!=mode:
    for field in WALLET_FIELDS:legacy.pop(field,None)
    legacy.update(coins=520,inventory={},walletLedger=[],shoppingParcels={},leisure={})
   legacy['economyMode']=mode;payload['legacy']=legacy
   db.execute("UPDATE client_workspace SET payload_json=?,revision=revision+1,updated_at=? WHERE id='experience'",(json.dumps(payload,ensure_ascii=False),self.life.stamp()))
   result={'clientLegacy':legacy,'clientExperience':payload['experience'],'clientRevision':row['revision']+1,**self.list_in(db,mode)}
  return result
 def history(self,args):
  mode=checked_mode(args.get('mode','normal'));role=str(args.get('roleId',''));items=[]
  if role_mode(role)!=mode:raise ValueError('identity_mode_mismatch')
  with closing(self.life.runtime.connect()) as db:
   active=self.current(db,mode)
   for slot in db.execute('SELECT * FROM world_identities WHERE mode=?',(mode,)):
    if active and slot['id']==active['id']:continue
    snap=json.loads(slot['snapshot_json']);messages=snap.get('records',{}).get('conversation_messages',[])
    for session in snap.get('records',{}).get('role_sessions',[]):
     if session['role_id']==role and not session['deleted_at']:items.append({'roleId':role,'sessionId':session['session_id'],'title':session['title'],'mode':session['mode'],'identityId':slot['id'],'identityName':slot['name'],'messageCount':sum(m['session_id']==session['session_id'] and not m['deleted_at'] and m.get('tone')!='binding-application' for m in messages),'updatedAt':session['updated_at'],'archived':True})
  return {'items':items}
