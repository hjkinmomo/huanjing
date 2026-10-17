"""Atomic named whole-mode play saves, independent of user identity banks."""
from contextlib import closing
from datetime import datetime,timedelta
import copy,hashlib,json,re,uuid
from persona_modes import checked_mode,role_mode
from world_identities import MODE_TABLES,ROLE_TABLES,ALLOWED
import play_client

IDENTITY_TABLES=('world_identities','world_identity_active','world_identity_session_owners','world_identity_wallets')
CONFIG_TABLES={'character_content','proactive_policy'}
PROFILE_TABLES={'auto_moment_roles','moment_reaction_roles','character_event_roles','phone_group_profiles'}

def sha(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class PlayRuns:
    def __init__(self,runtime):
        self.runtime=runtime;self.life=runtime.world_life
        with closing(runtime.connect()) as db,db:
            db.executescript('''CREATE TABLE IF NOT EXISTS play_mode_state(mode TEXT PRIMARY KEY,run_id TEXT NOT NULL,started INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS play_saves(id TEXT PRIMARY KEY,mode TEXT NOT NULL,name TEXT NOT NULL,name_key TEXT NOT NULL,snapshot_json TEXT NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(mode,name_key));
            CREATE TABLE IF NOT EXISTS play_session_owners(role_id TEXT NOT NULL,session_id TEXT NOT NULL,mode TEXT NOT NULL,run_id TEXT NOT NULL,PRIMARY KEY(role_id,session_id));''')
        for name,fn,write in [('play_run_status',self.status,True),('play_run_start',self.start,True),('play_run_load',self.load,True),('play_run_export',self.export,False),('play_run_import',self.import_save,True)]:
            runtime.registry.register(name,'Owner UI named whole-game save slots; never model/MCP tools.',mutating=write)(fn)
        runtime.registry.play_guard=self.guard

    def guard(self,name,args):
        if name in {'world_identity_create','world_identity_switch','world_user_identity'}:
            with closing(self.runtime.connect()) as db:self.require(db,'special.shira' if args.get('mode')=='special' else 'shira')
        if name not in {'conversation_sync','chat_session_create','chat_session_import','client_workspace_save','play_run_start','play_run_load','play_run_import'}:return
        mode=role_mode(args['roleId']) if args.get('roleId') else checked_mode(args.get('mode','normal'))
        with closing(self.runtime.connect()) as db:
            if not db.execute('SELECT 1 FROM play_mode_state WHERE mode=?',(mode,)).fetchone():return
            row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone();epoch=json.loads(row[0]).get('experience',{}).get('dataEpoch') if row else None
            if epoch and args.get('expectedDataEpoch')!=epoch:raise ValueError('play_refresh_required')

    def require(self,db,role,session=None):
        state=db.execute('SELECT * FROM play_mode_state WHERE mode=?',(role_mode(role),)).fetchone()
        # Legacy integrations are migrated when the owner first opens this feature.
        if not state:return
        if not state['started']:raise ValueError('play_not_started')
        if session:
            owner=db.execute('SELECT run_id FROM play_session_owners WHERE role_id=? AND session_id=?',(role,session)).fetchone()
            if owner and owner[0]!=state['run_id']:raise ValueError('play_session_inactive')

    def attach(self,db,role,session):
        self.require(db,role,session);state=db.execute('SELECT * FROM play_mode_state WHERE mode=?',(role_mode(role),)).fetchone()
        if state:db.execute('INSERT OR IGNORE INTO play_session_owners VALUES(?,?,?,?)',(role,session,role_mode(role),state['run_id']))

    def state(self,db,mode):
        row=db.execute('SELECT * FROM play_mode_state WHERE mode=?',(mode,)).fetchone()
        return dict(row) if row else {'mode':mode,'run_id':'','started':0,'revision':0,'updated_at':''}

    def default_name(self,db,mode):
        n=1
        while db.execute('SELECT 1 FROM play_saves WHERE mode=? AND name_key=?',(mode,'存档'+str(n))).fetchone():n+=1
        return '存档'+str(n)

    def status_in(self,db,mode):
        state=self.state(db,mode);saves=[]
        for row in db.execute('SELECT id,name,created_at,snapshot_json FROM play_saves WHERE mode=? ORDER BY rowid DESC',(mode,)):
            snap=json.loads(row['snapshot_json']);records=snap['story']['records'];saves.append({'id':row['id'],'name':row['name'],'createdAt':row['created_at'],'messages':len(records.get('conversation_messages',[])),'memories':len(records.get('role_memories',[])),'summaries':len(records.get('role_summaries',[])),'roles':len({v['role_id'] for v in records.get('role_sessions',[]) if v['session_id']!=f"role:{v['role_id']}:primary" and not v['deleted_at']})})
        return {'mode':mode,'started':bool(state['started']),'runId':state['run_id'],'revision':state['revision'],'defaultName':self.default_name(db,mode),'saves':saves}

    def status(self,args):
        mode=checked_mode(args.get('mode','normal'))
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('INSERT OR IGNORE INTO play_mode_state VALUES(?,\'\',0,0,?)',(mode,self.life.stamp()))
            return self.status_in(db,mode)

    def busy(self,db,mode):
        for table,statuses in [('tasks',['running','cancelling']),('phone_group_receipts',['generating']),('auto_moment_roles',['generating']),('moment_reaction_queue',['generating']),('character_event_queue',['generating']),('role_memory_jobs',['running']),('chat_context_jobs',['running'])]:
            if table in self.life.identities.tables(db):
                where,values=self.life.identities.scope_sql('role_id',mode)
                if db.execute('SELECT 1 FROM '+table+' WHERE '+where+' AND status IN ('+','.join('?' for _ in statuses)+')',[*values,*statuses]).fetchone():raise ValueError('play_mode_busy')

    def drafts(self,args,mode):
        value=args.get('browserDrafts',{})
        if not isinstance(value,dict) or len(value)>100 or any(not isinstance(k,str) or not k.startswith('huanjing_group_draft:'+mode+':') or not isinstance(v,str) or len(v)>6000 for k,v in value.items()):raise ValueError('play_drafts_invalid')
        return value

    def capture(self,db,mode,payload,drafts=None):
        story=self.life.identities.capture(db,mode,payload)
        for name in CONFIG_TABLES:story['records'].pop(name,None);story['columns'].pop(name,None)
        for table in IDENTITY_TABLES:
            story['columns'][table]=[r[1] for r in db.execute('PRAGMA table_info('+table+')')]
            story['records'][table]=[dict(r) for r in db.execute('SELECT * FROM '+table+' WHERE mode=?',(mode,))]
        sessions={v['session_id'] for v in story['records'].get('role_sessions',[])}
        wallet={k:copy.deepcopy(payload.get('legacy',{}).get(k)) for k in play_client.WALLET if k in payload.get('legacy',{})}
        if payload.get('legacy',{}).get('economyMode') not in [None,mode]:
            active=self.life.identities.current(db,mode);row=db.execute('SELECT payload_json FROM world_identity_wallets WHERE mode=? AND identity_id=?',(mode,active['id'])).fetchone() if active else None
            wallet={k:v for k,v in (json.loads(row[0]) if row else {}).items() if k in play_client.WALLET}
        story['wallet']=wallet
        return {'version':1,'mode':mode,'capturedAt':self.life.stamp(),'story':story,'client':play_client.capture(payload,mode,sessions),'browserDrafts':drafts or {}}

    def clean(self,db,snapshot):
        story=copy.deepcopy(snapshot['story'])
        for table in IDENTITY_TABLES:story['records'].pop(table,None)
        self.life.identities.delete_records(db,story)
        for table in reversed(IDENTITY_TABLES):db.execute('DELETE FROM '+table+' WHERE mode=?',(snapshot['mode'],))
        # Keep user switches, but remove cached prompts and all old speech/activity.
        for table in ['auto_moment_roles','moment_reaction_roles']:
            for row in snapshot['story']['records'].get(table,[]):
                if table=='auto_moment_roles':db.execute("INSERT OR IGNORE INTO auto_moment_roles(role_id,enabled) VALUES(?,?)",(row['role_id'],row['enabled']))
                else:db.execute("INSERT OR IGNORE INTO moment_reaction_roles VALUES(?,?,'{}')",(row['role_id'],row['enabled']))

    def name(self,db,mode,name):
        if not isinstance(name,str):raise ValueError('play_save_name_invalid')
        name=re.sub(r'\s+',' ',name).strip()
        if not 1<=len(name)<=60:raise ValueError('play_save_name_invalid')
        if db.execute('SELECT 1 FROM play_saves WHERE mode=? AND name_key=?',(mode,name.casefold())).fetchone():raise ValueError('play_save_name_exists')
        return name

    def save_in(self,db,snapshot,name):
        name=self.name(db,snapshot['mode'],name);sid=uuid.uuid4().hex
        db.execute('INSERT INTO play_saves VALUES(?,?,?,?,?,?,?)',(sid,snapshot['mode'],name,name.casefold(),json.dumps(snapshot,ensure_ascii=False),sha(snapshot),self.life.stamp()))
        return sid

    def reset_client(self,payload,outgoing,incoming,mode):
        payload=play_client.apply(payload,outgoing.get('client',{}),incoming.get('client',{}),mode);legacy=payload.setdefault('legacy',{});exp=payload.setdefault('experience',{})
        for key in play_client.WALLET:legacy.pop(key,None)
        legacy.update(copy.deepcopy(incoming.get('story',{}).get('wallet',{'coins':520,'inventory':{},'walletLedger':[],'shoppingParcels':{},'leisure':{}})));legacy['economyMode']=mode
        exp.setdefault('identityBanks',{}).pop(mode,None)
        active=incoming.get('story',{}).get('records',{}).get('world_identity_active',[])
        if active:exp['identityBanks'][mode]=active[0]['identity_id']
        exp['dataEpoch']=uuid.uuid4().hex;exp['updatedAt']=self.life.stamp();exp['currentRole']='special.shira' if mode=='special' else 'shira'
        return payload

    def finish(self,db,row,payload,mode,run_id,started):
        stamp=self.life.stamp();old=self.state(db,mode)
        db.execute('INSERT INTO play_mode_state VALUES(?,?,?,?,?) ON CONFLICT(mode) DO UPDATE SET run_id=excluded.run_id,started=excluded.started,revision=excluded.revision,updated_at=excluded.updated_at',(mode,run_id,int(started),old['revision']+1,stamp))
        db.execute("UPDATE client_workspace SET payload_json=?,revision=revision+1,updated_at=? WHERE id='experience'",(json.dumps(payload,ensure_ascii=False),stamp))
        return {'clientLegacy':payload['legacy'],'clientExperience':payload['experience'],'clientRevision':row['revision']+1,**self.status_in(db,mode)}

    def start(self,args):
        mode=checked_mode(args.get('mode','normal'))
        with self.life.lock,self.runtime.role_workspace.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');row,payload=self.life.identities.client(db,args.get('expectedClientRevision'));self.busy(db,mode)
            state=self.state(db,mode)
            if type(args.get('expectedPlayRevision'))is not int or args['expectedPlayRevision']!=state['revision']:raise ValueError('play_revision_conflict')
            snapshot=self.capture(db,mode,payload,self.drafts(args,mode));has_story=state['started'] or bool(snapshot['story']['records'].get('conversation_messages'))
            saved=self.save_in(db,snapshot,args.get('name')) if has_story else None
            if saved:self.attach_all(db,snapshot,'saved:'+saved)
            self.clean(db,snapshot);payload=self.reset_client(payload,snapshot,{},mode);run=uuid.uuid4().hex
            result=self.finish(db,row,payload,mode,run,True);result.update(savedId=saved,browserDrafts={})
        self.runtime.backup_manager.mark_dirty();return result

    def validate(self,db,snapshot,mode):
        def deny():raise ValueError('play_save_scope_invalid')
        if not isinstance(snapshot,dict) or snapshot.get('version')!=1 or snapshot.get('mode')!=mode:deny()
        try:datetime.fromisoformat(snapshot['capturedAt'])
        except (KeyError,TypeError,ValueError):deny()
        def rows_valid(story,allowed):
            if not isinstance(story,dict) or story.get('version')!=1 or story.get('mode')!=mode:deny()
            records=story.get('records');columns=story.get('columns')
            if not isinstance(records,dict) or not isinstance(columns,dict) or set(records)-allowed or set(columns)-allowed:deny()
            for table,rows in records.items():
                info=list(db.execute('PRAGMA table_info('+table+')'));known={r[1] for r in info};required={r[1] for r in info if r[5] or r[3] and r[4] is None}
                if not isinstance(rows,list):deny()
                for row in rows:
                    if not isinstance(row,dict) or not set(row)<=known or not required<=set(row):deny()
                    if 'role_id' in row and (not isinstance(row['role_id'],str) or role_mode(row['role_id'])!=mode):deny()
                    if 'mode' in row and row['mode'] not in (['character','assistant'] if table in ['role_sessions','work_item_conversation_links'] else [mode]):deny()
                    if table=='moments' and row.get('author_id') not in ['user','self','owner'] and role_mode(row.get('author_id',''))!=mode:deny()
                    if any(isinstance(v,(dict,list)) for v in row.values()):deny()
            # Child rows must belong to parents inside this save, never other-mode live rows.
            mids={r['id'] for r in records.get('conversation_messages',[])};posts={r['id'] for r in records.get('moments',[])}
            from world_identities import MESSAGE_TABLES
            for table in MESSAGE_TABLES:
                if any(r['message_id'] not in mids for r in records.get(table,[])):deny()
            if any(r['moment_id'] not in posts for r in records.get('moment_comments',[])):deny()
            return records
        def maps_valid(maps,sessions):
            if not isinstance(maps,dict):deny()
            for field,mapping in maps.items():
                if field not in play_client.MAPS or not isinstance(mapping,dict) or any(not play_client.owned(k,mode,sessions) for k in mapping):deny()
        story=snapshot.get('story');records=rows_valid(story,(ALLOWED-CONFIG_TABLES)|set(IDENTITY_TABLES));sessions={r['session_id'] for r in records.get('role_sessions',[])}
        if not isinstance(story.get('wallet'),dict) or set(story['wallet'])-set(play_client.WALLET):deny()
        client=snapshot.get('client')
        if not isinstance(client,dict):deny()
        for branch,part in client.items():
            if branch not in ['legacy','experience'] or not isinstance(part,dict) or set(part)-{'maps','moments','stories','memories','conversationJournal'}:deny()
            maps_valid(part.get('maps',{}),sessions)
            for name,items in [('moments','posts'),('stories','cards')]:
                value=part.get(name,{})
                if not isinstance(value,dict) or not isinstance(value.get(items,[]),list):deny()
                if any(not isinstance(v,dict) or not v.get('id') or role_mode(v.get('roleId',''))!=mode for v in value.get(items,[])):deny()
                if name=='stories' and (not isinstance(value.get('sessions',{}),dict) or any(role_mode(k)!=mode for k in value.get('sessions',{}))):deny()
                if name=='moments':
                    ids={v['id'] for v in value.get(items,[])}
                    if not isinstance(value.get('commentDrafts',{}),dict) or set(value.get('commentDrafts',{}))-ids or not isinstance(value.get('pendingDeletes',[]),list) or any(not isinstance(v,dict) or v.get('id') not in ids for v in value.get('pendingDeletes',[])):deny()
            for name in ['memories','conversationJournal']:
                values=part.get(name,[])
                if not isinstance(values,list) or any(isinstance(v,dict) and role_mode(v.get('roleId') or v.get('role_id') or v.get('role') or '')!=mode or not isinstance(v,dict) and mode!='normal' for v in values):deny()
        for identity in records.get('world_identities',[]):
            try:nested=json.loads(identity['snapshot_json'])
            except (TypeError,ValueError):deny()
            # Legacy placeholder identities are empty, never executable snapshots.
            if nested=={}:continue
            inner=rows_valid(nested,ALLOWED);ss={r['session_id'] for r in inner.get('role_sessions',[])}
            for branch,maps in nested.get('clientMaps',{}).items():
                if branch not in ['legacy','experience']:deny()
                maps_valid(maps,ss)
            from world_identities import WALLET_FIELDS
            if not isinstance(nested.get('wallet',{}),dict) or set(nested.get('wallet',{}))-set(WALLET_FIELDS):deny()
        ids={r['id'] for r in records.get('world_identities',[])}
        for table in IDENTITY_TABLES[1:]:
            for row in records.get(table,[]):
                if row['identity_id'] not in ids:deny()
                if table=='world_identity_wallets':
                    from world_identities import WALLET_FIELDS
                    try:wallet=json.loads(row['payload_json'])
                    except (TypeError,ValueError):deny()
                    if not isinstance(wallet,dict) or set(wallet)-set(WALLET_FIELDS):deny()
        self.drafts({'browserDrafts':snapshot.get('browserDrafts',{})},mode)

    def restore(self,db,snapshot):
        story=copy.deepcopy(snapshot['story']);identities={k:story['records'].pop(k,[]) for k in IDENTITY_TABLES}
        # Pause world time while a save is not active, matching identity-bank behavior.
        elapsed=max(0,(datetime.fromisoformat(self.life.stamp())-datetime.fromisoformat(snapshot['capturedAt'])).total_seconds())
        for record in story['records'].get('shared_world_state',[]):
            value=json.loads(record['payload_json']);policy=value.setdefault('timePolicy',{});policy['clockOffsetSeconds']=policy.get('clockOffsetSeconds',0)-elapsed;record['payload_json']=json.dumps(value,ensure_ascii=False)
        for record in story['records'].get('world_life_instances',[]):
            value=json.loads(record['state_json']);policy=value.setdefault('timePolicy',{});policy['clockOffsetSeconds']=policy.get('clockOffsetSeconds',0)-elapsed
            if value.get('override'):value['override']['until']+=elapsed
            value['lastEvaluatedAt']=self.life.stamp();record['state_json']=json.dumps(value,ensure_ascii=False)
        # Empty configuration placeholders kept by clean() must not conflict on restore.
        for table in PROFILE_TABLES:
            for row in story['records'].get(table,[]):db.execute('DELETE FROM '+table+' WHERE role_id=?',(row['role_id'],))
        self.life.identities.restore_records(db,story)
        for table in IDENTITY_TABLES:
            for row in identities[table]:
                cols=list(row);db.execute('INSERT INTO '+table+'('+','.join(cols)+') VALUES('+','.join('?' for _ in cols)+')',[row[k] for k in cols])

    def attach_all(self,db,snapshot,run):
        sessions=list(snapshot['story']['records'].get('role_sessions',[]))
        for row in snapshot['story']['records'].get('world_identities',[]):sessions+=json.loads(row['snapshot_json']).get('records',{}).get('role_sessions',[])
        for item in sessions:db.execute('INSERT INTO play_session_owners VALUES(?,?,?,?) ON CONFLICT(role_id,session_id) DO UPDATE SET run_id=excluded.run_id',(item['role_id'],item['session_id'],snapshot['mode'],run))

    def load(self,args):
        mode=checked_mode(args.get('mode','normal'))
        with self.life.lock,self.runtime.role_workspace.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');row,payload=self.life.identities.client(db,args.get('expectedClientRevision'));self.busy(db,mode);state=self.state(db,mode)
            if args.get('expectedPlayRevision')!=state['revision']:raise ValueError('play_revision_conflict')
            saved=db.execute('SELECT * FROM play_saves WHERE id=? AND mode=?',(args.get('id'),mode)).fetchone()
            if not saved:raise ValueError('play_save_missing')
            incoming=json.loads(saved['snapshot_json'])
            if sha(incoming)!=saved['sha256']:raise ValueError('play_save_hash_invalid')
            self.validate(db,incoming,mode);outgoing=self.capture(db,mode,payload,self.drafts(args,mode));saved_id=None
            if state['started'] or outgoing['story']['records'].get('conversation_messages'):saved_id=self.save_in(db,outgoing,args.get('name'))
            if saved_id:self.attach_all(db,outgoing,'saved:'+saved_id)
            self.clean(db,outgoing);self.restore(db,incoming);payload=self.reset_client(payload,outgoing,incoming,mode);run=uuid.uuid4().hex;self.attach_all(db,incoming,run)
            result=self.finish(db,row,payload,mode,run,True);result.update(savedId=saved_id,loadedName=saved['name'],browserDrafts=incoming.get('browserDrafts',{}))
        self.runtime.backup_manager.mark_dirty();return result

    def export(self,args):
        mode=checked_mode(args.get('mode','normal'))
        with self.life.lock,closing(self.runtime.connect()) as db:
            row=db.execute('SELECT * FROM play_saves WHERE id=? AND mode=?',(args.get('id'),mode)).fetchone()
            if not row:raise ValueError('play_save_missing')
            snapshot=json.loads(row['snapshot_json'])
            if sha(snapshot)!=row['sha256']:raise ValueError('play_save_hash_invalid')
            return {'format':'huanjing-play-save','version':1,'mode':mode,'name':row['name'],'sha256':row['sha256'],'snapshot':snapshot}

    def import_save(self,args):
        mode=checked_mode(args.get('mode','normal'));value=args.get('save')
        if not isinstance(value,dict) or value.get('format')!='huanjing-play-save' or value.get('version')!=1 or value.get('mode')!=mode or len(json.dumps(value,ensure_ascii=False).encode())>32*1024*1024:raise ValueError('play_save_format_invalid')
        snapshot=value.get('snapshot')
        if value.get('sha256')!=sha(snapshot):raise ValueError('play_save_hash_invalid')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            self.validate(db,snapshot,mode);sid=self.save_in(db,snapshot,args.get('name') or value.get('name'));result=self.status_in(db,mode)
        self.runtime.backup_manager.mark_dirty();return {**result,'importedId':sid}

    def first_use_reset(self,args):
        """Maintenance-only, explicitly authorized cleanup; no filesystem deletion."""
        mode=checked_mode(args['mode'])
        with self.life.lock,self.runtime.role_workspace.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');row,payload=self.life.identities.client(db,args['expectedClientRevision']);self.busy(db,mode)
            snapshot=self.capture(db,mode,payload);sid=self.save_in(db,snapshot,args['name']);self.attach_all(db,snapshot,'saved:'+sid);self.clean(db,snapshot);payload=self.reset_client(payload,snapshot,{},mode)
            result=self.finish(db,row,payload,mode,'',False);result['savedId']=sid
        self.runtime.backup_manager.mark_dirty();return result
