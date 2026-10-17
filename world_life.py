"""Shared mode clock/user position with private character schedules and consent.

Settlement is bounded and model-free. Local events keep their provenance; phone
and in-person turns retain the original conversation and channel ownership.
"""
from contextlib import closing
from datetime import datetime, timezone, timedelta
import hashlib, json, threading
from role_workspace import identifier
from persona_modes import role_mode
from life_journal import LifeJournal
from phone_life_services import PhoneLifeServices
from shared_world import SharedWorld
from character_residence import CharacterResidence
from character_living import CharacterLiving
from phone_notifications import PhoneNotifications
from world_transport import WorldTransport
from world_identities import WorldIdentities
from scene_locations import scene_container,location_label,schedule_area,location_accessible,arrival_area
from character_journey import CharacterJourney
from daily_agenda import DailyAgenda
from daily_settlement import DailySettlement
from character_social import CharacterSocial
from world_timeline import WorldTimeline
from world_commitments import WorldCommitments


class WorldLife:
    def __init__(self, runtime, clock=None):
        self.runtime=runtime;self.clock=clock or (lambda:datetime.now(timezone.utc));self.lock=threading.RLock()
        with closing(runtime.connect()) as db,db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS world_life_instances(
              role_id TEXT NOT NULL,session_id TEXT NOT NULL,world_id TEXT NOT NULL,
              state_json TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,
              PRIMARY KEY(role_id,session_id));
            CREATE TABLE IF NOT EXISTS world_life_events(
              role_id TEXT NOT NULL,session_id TEXT NOT NULL,event_id TEXT NOT NULL,
              kind TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,
              PRIMARY KEY(role_id,session_id,event_id));
            CREATE TABLE IF NOT EXISTS conversation_channels(
              message_id TEXT PRIMARY KEY,channel TEXT NOT NULL,world_time TEXT NOT NULL);
            ''')
            self.shared=SharedWorld(self,db)
            self.residences=CharacterResidence(self,db)
            self.journal=LifeJournal(self,db)
            self.services=PhoneLifeServices(self,db)
            self.living=CharacterLiving(self,db)
            self.notifications=PhoneNotifications(self,db)
            self.transport=WorldTransport(self,db)
            self.identities=WorldIdentities(self,db)
            self.journeys=CharacterJourney(self)
            self.agenda=DailyAgenda(self)
            self.timeline=WorldTimeline(self)
            self.commitments=WorldCommitments(self,db)
            self.day_journals=DailySettlement(self,db)
            self.social=CharacterSocial(self,db)
        for name,fn,write in [('world_life_get',self.get,True),('world_life_travel',self.travel,True),
                              ('world_life_schedule',self.schedule,True),('world_life_invite',self.invite,True),('world_life_clock',self.clock_change,True),('world_life_autonomy',self.autonomy,True)]:
            runtime.registry.register(name,'Owner UI fictional world ledger; not a model/MCP tool.',mutating=write)(fn)

    def scope(self,args):
        if args.get('global') or not args.get('roleId') or not args.get('sessionId'):
            mode=args.get('mode') or role_mode(args.get('roleId',''))
            role,session=self.shared.owner(mode);world=self.shared.world(mode)
            return role,session,world,self.shared.meta(world)
        role=identifier(args.get('roleId'),80);session=identifier(args.get('sessionId'))
        metadata=self.runtime.role_workspace.session({'roleId':role,'sessionId':session})
        if metadata['mode']!='character':return role,session,None,metadata
        world=self.shared.world(role_mode(role))
        if not (metadata.get('opening') or {}).get('world'):
            metadata={**metadata,'opening':{**(metadata.get('opening') or {}),'world':{'id':world['id'],'location':world['defaultLocation']}}}
        return role,session,world,metadata

    def places(self,role,session,world,db=None):
        places={p['id']:p for p in world['locations'] if p.get('available',True) and p.get('enabled',True)}
        if not session.startswith('world:'):
            # The caller already validated the session. Re-entering session()
            # for a legacy primary would ensure its agent on another connection
            # while the shared settlement transaction holds the writer lock.
            def read(connection):
                rows=connection.execute('SELECT * FROM temporary_places WHERE role_id=? AND world_id=? AND (session_id=? OR saved=1) ORDER BY saved DESC,updated_at',(role,world['id'],session)).fetchall()
                seen=set()
                for row in rows:
                    place=json.loads(row['place_json'])
                    if place['id'] in seen:continue
                    seen.add(place['id']);places[place['id']]={**place,'temporary':True,'saved':bool(row['saved']),'ownerSession':row['session_id']}
            if db is not None:read(db)
            else:
                with closing(self.runtime.connect()) as connection:read(connection)
        return places

    def stamp(self):return self.clock().astimezone(timezone.utc).isoformat()

    def event(self,db,role,session,event,kind,payload,stamp):
        db.execute('INSERT INTO world_life_events VALUES(?,?,?,?,?,?)',(role,session,event,kind,json.dumps(payload,ensure_ascii=False),stamp))

    def refine_position(self,state,places):
        if state.get('enRoute'):return
        old=state['roleLocation'];exact=arrival_area(places,old,state.get('scheduleActorId',''))
        if exact==old:return
        state['roleLocation']=exact
        if (state.get('override') or {}).get('locationId')==old:state['override']['locationId']=exact
        for item in state.get('commitments',[]):
            if item.get('status')=='accepted' and not item.get('startedAt') and item.get('origin')==old:item['origin']=exact

    def _state(self,db,role,session,world,metadata,stamp):
        row=db.execute('SELECT * FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
        if row:
            state=json.loads(row['state_json']);state['scheduleActorId']=role;policy=state['timePolicy']
            if not policy.get('calendarVersion'):
                current=datetime.fromisoformat(stamp)+timedelta(seconds=policy.get('clockOffsetSeconds',0))
                if not policy.get('clockOffsetSeconds'):
                    target=current.replace(year=2001,month=5,day=1)
                    policy['clockOffsetSeconds']=(target-datetime.fromisoformat(stamp)).total_seconds()
                policy.update(mode='fictional',calendarVersion=1,era='新历',yearOffset=1700)
                if state.get('autonomy'):
                    state['autonomy'].update(lastWorldUtc=(datetime.fromisoformat(stamp)+timedelta(seconds=policy.get('clockOffsetSeconds',0))).isoformat(),lastRealUtc=stamp,pending=None)
            if state.get('autonomy',{}).get('enabled') and not state.get('personaScheduleVersion'):
                manual=self.manual_schedule(db,role,session)
                if not manual:
                    configured=self.configured_schedule(role,self.places(role,session,world,db),db)
                    if configured:state['schedule']=configured
                    config,_=self.living.content(db,role)
                    for key in ['greetingText','mealText']:
                        if not state['autonomy'].get(key) and config.get('life',{}).get(key):state['autonomy'][key]=config['life'][key]
                state['personaScheduleVersion']=2
            self.timeline.seed(state,datetime.fromisoformat(state['lastEvaluatedAt'])+timedelta(seconds=policy.get('clockOffsetSeconds',0)))
            self.adopt_home_defaults(db,role,session,state,world)
            state=self.services.adopt_binding(db,role,self.shared.adopt(db,role,state,world,stamp))
            state['commitments']=self.commitments.load(db,role,session)
            self.refine_position(state,self.places(role,session,world,db))
            self.agenda.prepare(db,role,session,state,world,stamp)
            return state,row['revision']
        places=self.places(role,session,world,db);binding=metadata['opening']['world']
        start=binding.get('location') if binding.get('location') in places else world['defaultLocation']
        if start not in places:raise ValueError('world_life_location_missing')
        start=arrival_area(places,start,role)
        # Existing conversations migrate together; a new distant opening starts at home.
        prior=db.execute("SELECT 1 FROM conversation_messages WHERE role_id=? AND session_id=? AND deleted_at='' LIMIT 1",(role,session)).fetchone()
        home='home' if 'home' in places else start
        slots=[{'at':'00:00','locationId':'bedroom' if 'bedroom' in places else home,'activity':'休息'},
               {'at':'08:00','locationId':home,'activity':'整理日常'},
               {'at':'10:00','locationId':'cafe' if 'cafe' in places else home,'activity':'外出休息'},
               {'at':'18:00','locationId':home,'activity':'在家休息'},
               {'at':'23:00','locationId':'bedroom' if 'bedroom' in places else home,'activity':'准备睡觉'}]
        state={'scheduleActorId':role,'userLocation':start if prior else home,'roleLocation':start,'activity':'当前场景',
               'schedule':{'enabled':False,'slots':slots},'override':None,'lastEvaluatedAt':stamp,'catchUp':None,
               'timePolicy':{'mode':'fictional','utcOffsetMinutes':480,'calendarVersion':1,'era':'新历','yearOffset':1700,'clockOffsetSeconds':(datetime.fromisoformat(stamp).replace(year=2001,month=5,day=1)-datetime.fromisoformat(stamp)).total_seconds()},'worldId':world['id']}
        self.adopt_home_defaults(db,role,session,state,world)
        state=self.services.adopt_binding(db,role,self.shared.adopt(db,role,state,world,stamp))
        state['commitments']=self.commitments.load(db,role,session)
        self.agenda.prepare(db,role,session,state,world,stamp)
        self.timeline.seed(state,datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0)))
        state['commitments']=self.commitments.load(db,role,session)
        db.execute('INSERT INTO world_life_instances VALUES(?,?,?,?,1,?)',(role,session,world['id'],json.dumps(state,ensure_ascii=False),stamp))
        self.event(db,role,session,'initialize','initialize',{'locationId':start,'existingConversation':bool(prior)},stamp)
        return state,1

    def _tick(self,state,stamp,places):
        stamp_dt=datetime.fromisoformat(stamp);last=datetime.fromisoformat(state['lastEvaluatedAt'])
        inherited=state.pop('_sharedChanged',False)
        if stamp_dt==last and not inherited:return False
        changed=inherited;state['catchUp']=None;state['clockCorrection']=None
        if stamp_dt<last:
            offset=(last-stamp_dt).total_seconds()
            state['timePolicy']['clockOffsetSeconds']=state['timePolicy'].get('clockOffsetSeconds',0)+offset
            state['clockCorrection']={'previousRealUtc':last.isoformat(),'currentRealUtc':stamp,'offsetSeconds':offset}
            changed=True
        at=stamp_dt+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
        changed=self.timeline.advance(state,at,places) or changed
        state['lastEvaluatedAt']=stamp
        return changed

    def _save(self,db,role,session,state,revision,stamp):
        self.refine_position(state,self.places(role,session,self.shared.world(role_mode(role)),db))
        self.agenda.prepare(db,role,session,state,self.shared.world(role_mode(role)),stamp)
        self.commitments.save(db,state,stamp)
        self.journeys.record(db,role,session,state,stamp)
        self.day_journals.settle(db,role,session,state,stamp)
        self.services.save_binding(db,role,state,stamp)
        self.shared.save_changes(db,role,state,stamp)
        db.execute('UPDATE world_life_instances SET state_json=?,revision=?,updated_at=? WHERE role_id=? AND session_id=?',
                   (json.dumps(state,ensure_ascii=False),revision,stamp,role,session))

    def _output(self,db,role,session,world,state,revision,places):
        self.transport.settle(db,role_mode(role),state['lastEvaluatedAt'])
        self.shared.adopt(db,role,state,world,state['lastEvaluatedAt'])
        income_receipts=self.services.automatic_income(db,role,state['lastEvaluatedAt'])
        actors=self.shared.settle(db,role_mode(role),state['lastEvaluatedAt'],exclude=(role,session))
        current=db.execute('SELECT state_json,revision FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
        if current:state=json.loads(current['state_json']);revision=current['revision']
        self.shared.adopt(db,role,state,world,state['lastEvaluatedAt'])
        established=any(a['roleId']==role for a in actors)
        valid=state['userLocation'] in places and state['roleLocation'] in places
        stamp=state['lastEvaluatedAt'];worldutc=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));local=worldutc+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
        worldtime='新历'+str(local.year-1700)+local.strftime('年%m月%d日 %H:%M')+' · 星期'+'一二三四五六日'[local.weekday()]
        previous=db.execute("SELECT c.created_at,h.world_time FROM conversation_messages c LEFT JOIN conversation_channels h ON h.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.sender='user' AND c.tone!='binding-application' AND c.deleted_at='' ORDER BY c.ordinal DESC LIMIT 1",(role,session)).fetchone()
        previous_time=datetime.fromisoformat(previous['created_at'].replace('Z','+00:00')) if previous else None
        if previous_time and previous_time.tzinfo is None:previous_time=previous_time.replace(tzinfo=timezone.utc)
        previous_world=datetime.fromisoformat(previous['world_time'].replace('Z','+00:00')) if previous and previous['world_time'] else None
        elapsed=max(0,int((worldutc-previous_world).total_seconds())) if previous_world and previous_world<=worldutc else max(0,int((datetime.fromisoformat(stamp)-previous_time).total_seconds())) if previous_time else None
        def actor(pid,activity):return {'locationId':pid,'name':location_label(places,pid) or '地点已撤下','activity':activity,'description':places.get(pid,{}).get('description','')}
        events=[{**json.loads(r['payload_json']),'id':r['event_id'],'kind':r['kind'],'at':r['created_at']} for r in db.execute('SELECT * FROM world_life_events WHERE role_id=? AND session_id=? ORDER BY rowid DESC LIMIT 8',(role,session))]
        if state.get('binding',{}).get('status')!='accepted':
            events=[e if e['kind']=='travel' else {k:v for k,v in e.items() if k!='locationId'} for e in events if e['kind'] in ['travel','clock-correction','character-arrival','character-travel','invite']]
        return {'receivedGifts':self.runtime.character_events.gifts_in(db,role) if hasattr(self.runtime,'character_events') else [],'responseEvents':self.runtime.character_events.output_in(db,role_mode(role)) if hasattr(self.runtime,'character_events') else [],'transport':self.transport.output(db,role_mode(role)),'established':any(a['roleId']==role for a in actors),'phoneInbox':self.notifications.status_in(db,role_mode(role)),'living':self.living.output(db,role),'incomeReceipts':income_receipts,'enabled':True,'valid':valid,'roleId':role,'sessionId':session,'personaMode':role_mode(role),'worldId':world['id'],
                'worldLocations':list(places.values()),'homeLocation':{'id':state.get('homeLocation'),'name':places.get(state.get('homeLocation'),{}).get('name')},'calendar':{'era':'新历','year':local.year-1700,'localDateTime':local.replace(tzinfo=None).isoformat()},'lastAdvance':state.get('lastAdvance'),'revision':revision,'worldTime':worldtime,'worldUtc':worldutc.isoformat(),'realUtc':stamp,'utcOffsetMinutes':state['timePolicy']['utcOffsetMinutes'],
                'user':actor(state['userLocation'],''),'character':actor(state['roleLocation'],state['activity']) if established else {'locationId':'','name':'尚未创建新对话','activity':''},
                'transportMethod':state.get('transportMethod','walk'),'enRoute':self.journeys.output(state,stamp),'lastArrival':state.get('lastArrival'),'coLocated':established and valid and self.co_located(state,places) and not self.transport.output(db,role_mode(role))['current'],'elapsedSeconds':elapsed,
                'commitments':self.commitments.output(db,role,session),'agenda':self.agenda.output(state,stamp,places),'schedule':state['schedule'],'catchUp':state['catchUp'],'events':events,**self.journal.output(db,role,session,state),**self.services.output(db,role,session,state),'workCatalog':self.services.work_catalog(places),**self.shared.output(db,role,stamp,actors)}

    def get(self,args):
        role,session,world,metadata=self.scope(args)
        if not world:return {'enabled':False,'roleId':role,'sessionId':session,'reason':'自由场景或普通助手：暂不启用位置门控。'}
        stamp=self.stamp();places=self.places(role,session,world)
        with self.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');state,rev=self._state(db,role,session,world,metadata,stamp)
            if session!=f'role:{role}:primary':
                if self.residences.tick(db,role,session,state,stamp,places):rev+=1
                if self._tick(state,stamp,places):
                    rev+=1
                    if state.get('binding',{}).get('status')=='accepted' or state.get('clockCorrection'):
                        payload={'catchUp':state['catchUp'],'clockCorrection':state.get('clockCorrection')}
                        if state.get('binding',{}).get('status')=='accepted':payload['locationId']=state['roleLocation']
                        self.event(db,role,session,'tick-'+hashlib.sha256((stamp+str(rev)).encode()).hexdigest()[:24],'clock-correction' if state.get('clockCorrection') else 'schedule',payload,stamp)
                if self.journal.tick(db,role,session,state,stamp,places):rev+=1
                if self.services.process(db,role,session,state,stamp,places):rev+=1
            self._save(db,role,session,state,rev,stamp);out=self._output(db,role,session,world,state,rev,places)
        self.runtime.backup_manager.mark_dirty();return out

    def _mutate(self,args,kind):
        role,session,world,metadata=self.scope(args)
        if not world:raise ValueError('world_life_world_required')
        if session==f'role:{role}:primary' and kind not in ['clock','travel']:raise ValueError('world_character_conversation_required')
        event=identifier(args.get('requestId'));stamp=self.stamp();places=self.places(role,session,world)
        with self.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');state,rev=self._state(db,role,session,world,metadata,stamp)
            prior=db.execute('SELECT * FROM world_life_events WHERE role_id=? AND session_id=? AND event_id=?',(role,session,event)).fetchone()
            dest=args.get('locationId');payload={'schedule':args.get('schedule')} if kind=='schedule' else {'clock':args.get('clock')} if kind=='clock' else {'autonomy':args.get('autonomy')} if kind=='autonomy' else {'locationId':dest}
            if kind in ('invite','character-travel'):payload.update(method=args.get('method',state.get('transportMethod','walk')))
            if prior:
                if prior['kind']!=kind or json.loads(prior['payload_json'])!=payload:raise ValueError('world_life_request_conflict')
                return {**self._output(db,role,session,world,state,rev,places),'duplicate':True}
            if self._tick(state,stamp,places):rev+=1
            if args.get('expectedRevision')!=rev:raise ValueError('world_life_revision_conflict')
            if kind=='schedule':
                value=args.get('schedule');self.validate_schedule(value,places);state['schedule']=value;state['scheduleManual']=True;state['override']=None
                self._tick(state,(datetime.fromisoformat(stamp)+timedelta(microseconds=1)).isoformat(),places)
            elif kind=='clock':
                value=args.get('clock');real=datetime.fromisoformat(stamp);old=real+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
                local=old+timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
                if value=={'action':'next-day'}:
                    target=(local+timedelta(days=1)).replace(hour=8,minute=0,second=0,microsecond=0)-timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
                elif isinstance(value,dict) and set(value)=={'advanceMinutes'} and type(value['advanceMinutes']) is int and 1<=value['advanceMinutes']<=1440:
                    target=old+timedelta(minutes=value['advanceMinutes'])
                elif isinstance(value,dict) and set(value) in ({'localDateTime'},{'storyLocalDateTime'}):
                    try:
                        chosen=datetime.fromisoformat(value.get('localDateTime',value.get('storyLocalDateTime')))
                        if 'storyLocalDateTime' in value:
                            if not 1<=chosen.year<=999:raise ValueError()
                            chosen=chosen.replace(year=chosen.year+1700)
                        if chosen.tzinfo is not None or not 1701<=chosen.year<=2699 or 'localDateTime' in value and not 1900<=chosen.year<=2200:raise ValueError()
                        target=chosen.replace(tzinfo=timezone.utc)-timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
                    except (ValueError,TypeError):raise ValueError('world_life_clock_invalid')
                else:raise ValueError('world_life_clock_invalid')
                delta=(target-old).total_seconds()
                if state.get('override'):
                    if delta<0:state['override']=None
                    else:state['override']['until']-=delta
                state['timePolicy']['clockOffsetSeconds']=(target-real).total_seconds()
                self.agenda.prepare(db,role,session,state,world,stamp)
                self._tick(state,(real+timedelta(microseconds=1)).isoformat(),places)
                state['lastAdvance']={'from':old.isoformat(),'to':target.isoformat(),'minutes':int(delta/60)}
                self.journal.tick(db,role,session,state,stamp,places)
                self.journal.log(db,role,session,event,state,target,'度过 '+str(int(delta/60))+' 分钟','clock')
            elif kind=='autonomy':
                manual_schedule=json.loads(json.dumps(state['schedule'])) if state.get('scheduleManual') else None
                value=args.get('autonomy')
                if not isinstance(value,dict) or set(value)-{'enabled','outreach','mealText','greetingText'} or type(value.get('enabled')) is not bool or type(value.get('outreach',True)) is not bool:raise ValueError('world_life_autonomy_invalid')
                if any(k in value and (not isinstance(value[k],str) or len(value[k])>300) for k in ['mealText','greetingText']):raise ValueError('world_life_autonomy_invalid')
                fictional_at=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
                previous=state.get('autonomy')
                state['autonomy']={**(previous or {'startedAt':stamp,'lastWorldUtc':fictional_at.isoformat(),'lastRealUtc':stamp,'sentCount':0,'pending':None}),**value}
                if not value['enabled']:
                    state['autonomy']['scheduleWasEnabled']=state['schedule']['enabled']
                    state['schedule']['enabled']=False;state['autonomy']['pending']=None
                elif previous and not previous['enabled']:
                    state['schedule']['enabled']=previous.get('scheduleWasEnabled',True)
                if value['enabled'] and not previous:
                    configured=self.configured_schedule(role,places,db)
                    if configured:
                        self.validate_schedule(configured,places);state['schedule']=configured
                    else:
                        home=state.get('homeLocation',state['roleLocation'])
                        state['schedule']={'enabled':True,'slots':[{'at':'00:00','locationId':home,'activity':'自己的日常'}]}
                    state['schedule']['source']='configured' if configured else 'awaiting-persona-template'
                    state['schedule'].pop('source',None)
                    config,_=self.living.content(db,role)
                    for key in ['greetingText','mealText']:
                        if key not in value and config.get('life',{}).get(key):state['autonomy'][key]=config['life'][key]
                if manual_schedule and value['enabled']:state['schedule']={**manual_schedule,'enabled':True}
            else:
                if dest not in places:raise ValueError('world_life_location_missing')
                if not location_accessible(places,dest):raise ValueError('world_life_location_locked')
                if kind=='travel':
                    dest=arrival_area(places,dest,'world-user:'+role_mode(role))
                    state['userLocation']=dest
                    now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
                    db.execute("UPDATE world_work_jobs SET status='cancelled' WHERE mode=? AND world_id=? AND status='working' AND due_at>? AND json_extract(payload_json,'$.locationId')!=?",(role_mode(role),world['id'],now.isoformat(),dest))
                else:
                    self.journeys.start(state,stamp,places,dest,event,args.get('method',state.get('transportMethod','walk')),'到访新地点' if kind=='character-travel' else '赴约聊天')
                    self.journeys.tick(state,stamp,places)
            state['lastEvaluatedAt']=stamp;rev+=1
            if self.co_located(state,places):
                place=places[dest] if dest in places else places[state['roleLocation']]
                previous=self.runtime.role_workspace.chat_context.scene(role,session).get('state') or {}
                scene={**{k:previous.get(k,'') for k in ('outfit','mood')},'location':place['name'],'setting':place['description'][:500],'activity':state['activity']}
                ordinal=db.execute("SELECT COALESCE(MAX(ordinal),-1) n FROM conversation_messages WHERE role_id=? AND session_id=? AND deleted_at=''",(role,session)).fetchone()['n']
                db.execute('INSERT OR IGNORE INTO chat_session_options(role_id,session_id) VALUES(?,?)',(role,session))
                db.execute('UPDATE chat_session_options SET scene_json=?,scene_ordinal=?,revision=revision+1 WHERE role_id=? AND session_id=?',(json.dumps(scene,ensure_ascii=False),ordinal,role,session))
            if self.services.process(db,role,session,state,stamp,places):rev+=1
            self._save(db,role,session,state,rev,stamp);self.event(db,role,session,event,kind,payload,stamp)
            if kind in ('travel','invite','character-travel','schedule'):
                fictional_at=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
                title='调整一天的安排' if kind=='schedule' else ('你来到' if kind=='travel' else '角色出发前往')+' '+places[dest]['name']
                self.journal.log(db,role,session,event,state,fictional_at,title,kind,dest)
            out=self._output(db,role,session,world,state,rev,places)
        self.runtime.backup_manager.mark_dirty();return out

    def adopt_home_defaults(self,db,role,session,state,world):
        if role in ['world-user','special.world-user']:return
        places=self.places(role,session,world,db);config,_=self.living.content(db,role);home=config.get('life',{}).get('homeLocation');state['transportMethod']=config.get('life',{}).get('transportMethod','walk')
        if home in places:
            state['defaultHomeLocation']=home
            explicit=db.execute('SELECT location_id FROM character_residences WHERE role_id=? AND world_id=?',(role,world['id'])).fetchone()
            if explicit:state['homeLocation']=explicit['location_id']
            elif not state.get('homeLocation') or state.get('homeSource')=='data-default':state['homeLocation']=home;state['homeSource']='data-default'
        if 'scheduleManual' not in state:state['scheduleManual']=bool(self.manual_schedule(db,role,session))
        if state.get('sceneScheduleVersion')!=3 and state.get('autonomy',{}).get('enabled'):
            manual=self.manual_schedule(db,role,session)
            customized=db.execute('SELECT 1 FROM character_content WHERE role_id=?',(role,)).fetchone()
            if not manual and not customized:
                configured=self.configured_schedule(role,places,db)
                if configured:state['schedule']=configured
            state['sceneScheduleVersion']=3

    @staticmethod
    def manual_schedule(db,role,session):
        # Automatic ticks share the legacy event kind, but have no authored schedule.
        return db.execute("SELECT 1 FROM world_life_events WHERE role_id=? AND session_id=? AND kind='schedule' AND json_type(payload_json,'$.schedule')='object' LIMIT 1",(role,session)).fetchone()

    def configured_schedule(self,role,places,db=None):
        if db is None:
            with closing(self.runtime.connect()) as connection:config,_=self.living.content(connection,role)
        else:config,_=self.living.content(db,role)
        value=config.get('life',{}).get('schedule')
        if value:self.validate_schedule(value,places)
        return value

    @staticmethod
    def validate_schedule(value,places):
        if not isinstance(value,dict) or set(value)!={'enabled','slots'} or type(value['enabled']) is not bool:raise ValueError('world_life_schedule_invalid')
        slots=value['slots'];previous=-1
        if not isinstance(slots,list) or not 1<=len(slots)<=16:raise ValueError('world_life_schedule_invalid')
        for s in slots:
            if not isinstance(s,dict) or set(s)!={'at','locationId','activity'}:raise ValueError('world_life_schedule_invalid')
            at=s['at']
            if not isinstance(at,str) or len(at)!=5 or at[2]!=':' or not (at[:2]+at[3:]).isdigit():raise ValueError('world_life_schedule_invalid')
            hour,minute=int(at[:2]),int(at[3:]);m=hour*60+minute
            if hour>23 or minute>59 or m<=previous or not location_accessible(places,s['locationId']) or not isinstance(s['activity'],str) or not 1<=len(s['activity'])<=160:raise ValueError('world_life_schedule_invalid')
            previous=m
        if slots[0]['at']!='00:00':raise ValueError('world_life_schedule_midnight_required')

    @staticmethod
    def co_located(state,places):
        container=scene_container(places,state['userLocation'])
        return bool(container) and not state.get('enRoute') and container==scene_container(places,state['roleLocation'])

    def travel(self,args):return self._mutate(args,'travel')
    def invite(self,args):
        if args.get('decision')!='accept':return {**self.get(args),'invitationDecision':args.get('decision','pending'),'changesCurrentLocation':False}
        return self._mutate(args,'invite')
    def schedule(self,args):return self._mutate(args,'schedule')

    def clock_change(self,args):return self._mutate(args,'clock')
    def autonomy(self,args):return self._mutate(args,'autonomy')

    def character_travel(self,args):return self._mutate(args,'character-travel')
