"""Owner-UI fictional commerce, work and explicit location-sharing consent.

No model or external service calls. Wallet mutations share the client snapshot's
SQLite transaction and revision; messages retain their local-event provenance.
"""
from contextlib import closing
from datetime import datetime,timedelta,timezone
from pathlib import Path
import json,re,hashlib
from role_workspace import identifier
from persona_modes import role_mode
from scene_locations import schedule_area,location_label

def date(value):return datetime.fromisoformat(value.replace('Z','+00:00'))
def plain_binding_text(text):
    return re.sub(r'```[\s\S]*?```|“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|\x27[^\x27]*\x27|`[^`]*`','',text or '').strip()
def binding_question(text):
    if not isinstance(text,str) or len(text)>12000:return False
    if any(word in text for word in ['如果','假如','举例','比如','引用','演示','说一句','台词','小说','不要绑定','不想绑定']):return False
    value=plain_binding_text(text)
    return bool(re.search(r'(?:绑定|共享.{0,8}(?:行迹|行动轨迹|位置))',value) and (re.search(r'你|我们|咱们',value) or re.search(r'(?:愿意|可以|能不能)[^。！？]*[吗?？]',value)) and re.search(r'申请|我想|我希望|愿意|可以|能不能|好吗|好不好|行吗|吗[？?]?$',value))
def binding_control(text,request):
    value=plain_binding_text(text)
    if any(word in value for word in ['如果','假如','举例','比如','演示','台词']):return None
    if re.search(r'我(?:要|想|决定|现在)?(?:解除绑定|停止共享|不再共享)',value):return 'revoke'
    if re.search(r'我.{0,6}(?:不同意|不愿意|拒绝|不想|不接受|不会).{0,12}(?:绑定|共享)',value):return 'decline'
    markers=re.findall(r'\[\[binding:([^:\]]+):(accept|decline|revoke)\]\]',value)
    marker=re.search(r'\[\[binding:'+re.escape(request)+r':(accept|decline|revoke)\]\]\s*$',value)
    if marker and len(markers)==1:return marker.group(1)
    if re.search(r'(?:^|[。！？!?，,：:\n])\s*我(?:明确)?(?:同意|愿意).{0,16}(?:绑定|共享.{0,4}(?:行迹|位置|行动轨迹))',value):return 'accept'
    if re.fullmatch(r'\s*(?:可以|好呀|好的|好啊|当然可以)[，,。！! ]*(?:那就)?(?:绑定吧|共享行迹吧)[。！! ]*',value):return 'accept'
    return None

def meal_notice(text,items):
    value=plain_binding_text(text)
    if re.search(r'引用|举例|假设|假如|如果|小说|台词|演示',value):return None
    relevant='外卖' in value or any(i['name'] in text for i in items)
    if not relevant:return None
    if re.search(r'(?:我|给你|帮你|替你).{0,5}(?:没有|没|并未|不想|不要|不会).{0,8}(?:点|订|买)',value) or re.search(r'不是我.{0,5}(?:点|买|订)',value):return False
    return True if re.search(r'(?:我.{0,8}(?:给你|帮你|替你).{0,8}(?:点|订|买)|(?:给你|帮你|替你).{0,8}(?:点|订|买)了|我.{0,4}(?:点|订|买)了)',value) else None

class PhoneLifeServices:
    def __init__(self,life,db):
        self.life=life;self.runtime=life.runtime
        db.execute('CREATE TABLE IF NOT EXISTS character_bindings(role_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL)')
        db.executescript('''CREATE TABLE IF NOT EXISTS world_delivery_orders(
          id TEXT PRIMARY KEY,role_id TEXT NOT NULL,session_id TEXT NOT NULL,
          world_id TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL,
          due_at TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS world_work_jobs(
          id TEXT PRIMARY KEY,role_id TEXT NOT NULL,session_id TEXT NOT NULL,
          world_id TEXT NOT NULL,mode TEXT NOT NULL,payload_json TEXT NOT NULL,
          status TEXT NOT NULL,due_at TEXT NOT NULL,created_at TEXT NOT NULL);''')
        for name,fn in [('world_delivery_order',self.order),('world_delivery_cancel',self.cancel_order),
                        ('world_work_start',self.work_start),('world_work_claim',self.work_claim),
                        ('world_work_cancel',self.work_cancel),('world_life_binding',self.binding),('world_user_identity',self.identity),('world_income_claim',self.income_claim)]:
            self.runtime.registry.register(name,'Owner UI fictional life transaction; not a model/MCP tool.',mutating=True)(fn)
    def catalog(self):
        return json.loads((Path(__file__).parent/'web/assets/experience/food-catalog.json').read_text('utf8'))
    def snapshot(self,db,expected=None):
        row=db.execute("SELECT * FROM client_workspace WHERE id='experience'").fetchone()
        if not row:raise ValueError('phone_wallet_not_synced')
        if expected is not None and row['revision']!=expected:raise ValueError('client_snapshot_conflict')
        payload=json.loads(row['payload_json']);legacy=payload.get('legacy') or {}
        coins=legacy.get('coins',520)
        if type(coins) is not int or coins<0:raise ValueError('phone_wallet_invalid')
        return row,payload,legacy,coins
    def wallet(self,db,expected,delta,key,kind,stamp,record=None,mode=None):
        if type(expected) is not int or expected<0:raise ValueError('client_revision_required')
        row,payload,legacy,coins=self.snapshot(db,expected)
        visible=mode is None or legacy.get('economyMode',mode)==mode;active=self.life.identities.current(db,mode) if mode and hasattr(self.life,'identities') else None
        full_legacy=legacy
        if active and not visible:
            stored=db.execute('SELECT payload_json FROM world_identity_wallets WHERE mode=? AND identity_id=?',(mode,active['id'])).fetchone()
            legacy=json.loads(stored[0]) if stored else {'coins':520,'inventory':{},'walletLedger':[]}
            coins=legacy.get('coins',520)
            if coins+delta<0:raise ValueError('phone_wallet_insufficient')
        if coins+delta<0:raise ValueError('phone_wallet_insufficient')
        ledger=legacy.get('walletLedger',[])
        if not isinstance(ledger,list):raise ValueError('phone_wallet_invalid')
        if any(e.get('id')==key for e in ledger):return {'clientRevision':row['revision'],'clientLegacy':legacy if visible else full_legacy}
        legacy['coins']=coins+delta
        entry={'id':key,'delta':delta,'kind':kind,'at':stamp}
        if kind=='automatic-income':entry.update(baseRevision=row['revision'],clientRevision=row['revision']+1)
        legacy['walletLedger']=[entry,*ledger][:500]
        legacy['persistence']={**legacy.get('persistence',{}),'lastSavedAt':stamp}
        if record:legacy['deliveryLog']=[record,*[r for r in legacy.get('deliveryLog',[]) if r.get('id')!=record['id']]][:100]
        if active:db.execute('INSERT INTO world_identity_wallets VALUES(?,?,?) ON CONFLICT(mode,identity_id) DO UPDATE SET payload_json=excluded.payload_json',(mode,active['id'],json.dumps({k:legacy[k] for k in __import__('world_identities').WALLET_FIELDS if k in legacy},ensure_ascii=False)))
        if not visible:return {'clientRevision':row['revision'],'clientLegacy':full_legacy}
        payload['legacy']=legacy
        db.execute("UPDATE client_workspace SET payload_json=?,revision=revision+1,updated_at=? WHERE id='experience'",(json.dumps(payload,ensure_ascii=False),stamp))
        return {'clientRevision':row['revision']+1,'clientLegacy':legacy}
    def scope(self,args):
        role,session,world,meta=self.life.scope(args)
        if not world:raise ValueError('world_life_world_required')
        return role,session,world,meta
    def predicted(self,state,at,places):
        return self.life.timeline.project(state,at,places)['roleLocation']
    def order(self,args):
        role,session,world,meta=self.scope(args)
        if args.get('recipientRoleId'):
            with closing(self.runtime.connect()) as db:
                target=next((r for r in self.life.shared.sessions(db,role_mode(role)) if r['role_id']==args['recipientRoleId']),None)
            if not target:raise ValueError('phone_recipient_offline')
            role,session,world,meta=self.scope({'roleId':target['role_id'],'sessionId':target['session_id']})
        key=identifier(args.get('requestId'));stamp=self.life.stamp();places=self.life.places(role,session,world)
        lines=args.get('items');destination=args.get('destination',{'mode':'follow'})
        if not isinstance(lines,list) or not 1<=len(lines)<=32:raise ValueError('phone_cart_invalid')
        foods={p['id']:p for p in self.catalog()};items=[];seen=set()
        for line in lines:
            if not isinstance(line,dict) or set(line)!={'foodId','quantity'} or line['foodId'] not in foods or line['foodId'] in seen or type(line['quantity']) is not int or not 1<=line['quantity']<=10:raise ValueError('phone_cart_invalid')
            p=foods[line['foodId']];seen.add(p['id']);items.append({'foodId':p['id'],'name':p['name'],'quantity':line['quantity'],'price':p['price'],'merchantId':p['merchantId']})
        stores_catalog=json.loads((Path(__file__).parent/'web/assets/experience/merchants.json').read_text('utf8'));store_ids={i['merchantId'] for i in items};stores=[{'id':m['id'],'name':m['name'],'locationId':m.get('locationId','')} for m in stores_catalog if m['id'] in store_ids]
        if not isinstance(destination,dict) or destination.get('mode') not in ['follow','fixed'] or set(destination)-{'mode','locationId'}:raise ValueError('phone_delivery_destination_invalid')
        if destination['mode']=='fixed' and destination.get('locationId') not in places:raise ValueError('world_life_location_missing')
        try:due=date(args['dueAt'])
        except (ValueError,TypeError,KeyError):raise ValueError('phone_delivery_time_invalid')
        if due.tzinfo is None:raise ValueError('phone_delivery_time_invalid')
        due=due.astimezone(timezone.utc)
        fingerprint=json.dumps({'role':role,'session':session,'items':items,'due':due.isoformat(),'destination':destination},sort_keys=True)
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT * FROM world_delivery_orders WHERE id=?',(key,)).fetchone()
            if prior:
                receipt=json.loads(prior['payload_json'])
                if receipt['fingerprint']!=fingerprint:raise ValueError('phone_order_conflict')
                row,payload,legacy,coins=self.snapshot(db);return {'order':receipt,'duplicate':True,'clientRevision':row['revision'],'clientLegacy':legacy}
            state,rev=self.life._state(db,role,session,world,meta,stamp);self.life._tick(state,stamp,places)
            current=date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
            if not 900<=(due-current).total_seconds()<=86400:raise ValueError('phone_delivery_time_invalid')
            total=sum(i['price']*i['quantity'] for i in items)
            receipt={'id':key,'roleId':role,'roleName':args.get('roleName',role)[:80],'sessionId':session,'worldId':world['id'],'stores':stores,'items':items,'foodName':'、'.join(i['name'] for i in items),'total':total,'at':stamp,'orderedWorldAt':current.isoformat(),'dueAt':due.isoformat(),'destination':destination,'status':'scheduled','announced':False,'afterOrdinal':db.execute('SELECT COALESCE(MAX(ordinal),-1) n FROM conversation_messages WHERE role_id=? AND session_id=?',(role,session)).fetchone()['n'],'source':'fictional-meal-v3','fingerprint':fingerprint}
            wallet=self.wallet(db,args.get('expectedClientRevision'),-total,'order:'+key,'delivery',stamp,receipt,mode=role_mode(role))
            db.execute('INSERT INTO world_delivery_orders VALUES(?,?,?,?,?,?,?,?)',(key,role,session,world['id'],json.dumps(receipt,ensure_ascii=False),'scheduled',due.isoformat(),stamp))
            self.life._save(db,role,session,state,rev+1,stamp)
        self.runtime.backup_manager.mark_dirty();return {'order':receipt,**wallet}
    def cancel_order(self,args):
        role,session,world,meta=self.scope(args);key=identifier(args.get('orderId'));stamp=self.life.stamp()
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM world_delivery_orders WHERE id=?',(key,)).fetchone()
            if not row or role_mode(row['role_id'])!=role_mode(role):raise ValueError('phone_order_missing')
            receipt=json.loads(row['payload_json'])
            if row['status']=='cancelled':
                saved,payload,legacy,coins=self.snapshot(db);return {'order':receipt,'duplicate':True,'clientRevision':saved['revision'],'clientLegacy':legacy}
            state,rev=self.life._state(db,role,session,world,meta,stamp);now=date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
            if row['status']!='scheduled' or date(row['due_at'])<=now:raise ValueError('phone_order_already_delivered')
            receipt['status']='cancelled';wallet=self.wallet(db,args.get('expectedClientRevision'),receipt['total'],'cancel:'+key,'delivery-refund',stamp,receipt,mode=role_mode(role))
            db.execute('UPDATE world_delivery_orders SET status=?,payload_json=? WHERE id=?',('cancelled',json.dumps(receipt,ensure_ascii=False),key))
        self.runtime.backup_manager.mark_dirty();return {'order':receipt,**wallet}
    def adopt_binding(self,db,role,state):
        if role in ['world-user','special.world-user']:return state
        row=db.execute('SELECT payload_json FROM character_bindings WHERE role_id=?',(role,)).fetchone()
        if row:state['binding']=json.loads(row['payload_json'])
        else:
            old=db.execute('SELECT session_id,state_json FROM world_life_instances WHERE role_id=? ORDER BY updated_at DESC,rowid DESC',(role,)).fetchall()
            value=next(((json.loads(r['state_json']).get('binding'),r['session_id']) for r in old if json.loads(r['state_json']).get('binding',{}).get('status') in ['pending','accepted','declined','revoked']),None)
            if value:state['binding']={**value[0],'sourceSessionId':value[0].get('sourceSessionId',value[1])}
        return state
    def save_binding(self,db,role,state,stamp):
        if role in ['world-user','special.world-user'] or not state.get('binding'):return
        payload=json.dumps(state['binding'],ensure_ascii=False,sort_keys=True)
        db.execute('INSERT INTO character_bindings VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at WHERE character_bindings.payload_json!=excluded.payload_json',(role,payload,stamp))
    def binding(self,args):
        role,session,world,meta=self.scope(args);stamp=self.life.stamp();places=self.life.places(role,session,world);action=args.get('action');key=identifier(args.get('requestId'))
        if action not in ['ask','revoke']:raise ValueError('phone_binding_action_invalid')
        if session==f'role:{role}:primary':raise ValueError('phone_binding_conversation_required')
        if meta.get('memoryPolicy')=='readonly':raise ValueError('phone_binding_readonly')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');state,rev=self.life._state(db,role,session,world,meta,stamp);self.life._tick(state,stamp,places)
            current=state.get('binding',{})
            if action=='revoke':state['binding']={**current,'status':'revoked','endedAt':stamp};self.life.journal.log(db,role,session,'unbind-'+key,state,date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0)),'解除行迹共享','binding')
            elif current.get('status') in ['pending','accepted']:return self.output(db,role,session,state)
            else:
                ordinal=db.execute('SELECT COALESCE(MAX(ordinal),-1) n FROM conversation_messages WHERE role_id=? AND session_id=?',(role,session)).fetchone()['n']
                state['binding']={'id':key,'status':'pending','askedAt':stamp,'afterOrdinal':ordinal,'sourceSessionId':session}
            self.life._save(db,role,session,state,rev+1,stamp);result=self.output(db,role,session,state)
        self.runtime.backup_manager.mark_dirty();return result
    def resolve_binding(self,db,role,session,state,stamp):
        binding=state.get('binding',{});changed=False
        users=db.execute("SELECT id,text,ordinal FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='' ORDER BY ordinal DESC LIMIT 10",(role,session)).fetchall()
        option=db.execute('SELECT memory_policy FROM chat_session_options WHERE role_id=? AND session_id=?',(role,session)).fetchone()
        if not option or option['memory_policy']!='readonly':
            question=next((u for u in users if binding_question(u['text'])),None)
            if question and question['id']!=binding.get('questionMessageId') and binding.get('status')!='accepted' and (binding.get('sourceSessionId',session)!=session or question['ordinal']>binding.get('afterOrdinal',-1)):
                if binding.get('status')!='pending':binding={'id':'binding-'+hashlib.sha256((role+'|'+question['id']).encode()).hexdigest()[:32],'status':'pending','askedAt':stamp}
                binding.update(questionMessageId=question['id'],sourceSessionId=session,afterOrdinal=question['ordinal']-1);state['binding']=binding;changed=True
        if binding.get('status') not in ['pending','accepted'] or binding.get('status')=='pending' and binding.get('sourceSessionId',session)!=session:return changed
        if not binding.get('id'):return changed
        after=binding.get('afterOrdinal',-1) if binding.get('sourceSessionId',session)==session else -1
        replies=db.execute("SELECT * FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='assistant' AND tone NOT IN ('life-event','character-event') AND deleted_at='' AND ordinal>? ORDER BY ordinal DESC LIMIT 10",(role,session,after)).fetchall()
        for reply in replies:
            decision=binding_control(reply['text'],binding['id'])
            if decision is None or binding.get('evidenceMessageId')==reply['id']:continue
            user=db.execute("SELECT text FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND ordinal<? AND ordinal>? AND deleted_at='' ORDER BY ordinal DESC LIMIT 1",(role,session,reply['ordinal'],binding.get('afterOrdinal',-1))).fetchone()
            if binding['status']=='pending' and (not user or not binding_question(user['text'])):continue
            if binding['status']=='accepted' and decision!='revoke':continue
            binding.update(status={'accept':'accepted','decline':'declined','revoke':'revoked'}[decision],evidenceMessageId=reply['id'],decisionSource='saved-character-reply',decidedAt=stamp,afterOrdinal=reply['ordinal'],sourceSessionId=session)
            if decision=='accept':binding['sharedFromWorldUtc']=(date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))).isoformat()
            self.life.journal.log(db,role,session,'binding-'+reply['id'],state,date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0)),'角色同意共享行迹' if decision=='accept' else '行迹共享未开启','binding')
            return True
        return changed
    def process(self,db,role,session,state,stamp,places):
        changed=self.resolve_binding(db,role,session,state,stamp);now=date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
        orders=db.execute("SELECT * FROM world_delivery_orders WHERE role_id=? AND session_id=? AND status='scheduled' AND due_at<=? ORDER BY due_at,id LIMIT 100",(role,session,now.isoformat())).fetchall()
        for row in orders:
            order=json.loads(row['payload_json']);at=date(order['dueAt'])
            floor=date(order.get('orderedWorldAt',order['dueAt']))-timedelta(hours=1)
            announced=db.execute("SELECT c.text,h.world_time FROM conversation_messages c JOIN conversation_channels h ON h.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.sender='user' AND c.deleted_at='' AND c.ordinal>? AND h.world_time>=? AND h.world_time<? ORDER BY c.ordinal DESC LIMIT 30",(role,session,max(-1,order.get('afterOrdinal',-1)-10),floor.isoformat(),at.isoformat())).fetchall()
            order['announced']=next((decision for decision in (meal_notice(r['text'],order['items']) for r in announced) if decision is not None),False)
            if order['destination']['mode']=='follow':
                # Follow the person to a real arrival, never deliver to an origin
                # they already left. A delayed settlement uses the same trace.
                if now-at>timedelta(days=2):at=now;order['lateCatchUp']=True
                projected=self.life.timeline.project(state,at,places)
                for _ in range(12):
                    trip=projected.get('enRoute')
                    if not trip:break
                    at=max(at,date(trip['dueAt']));projected=self.life.timeline.project(state,at,places)
                if projected.get('enRoute') or at>now:
                    order.update(waitingForRecipient=True,estimatedDeliveryAt=at.isoformat())
                    db.execute('UPDATE world_delivery_orders SET payload_json=? WHERE id=?',(json.dumps(order,ensure_ascii=False),row['id']));changed=True;continue
                location=projected['roleLocation'];order['waitingForRecipient']=False
            else:location=order['destination']['locationId']
            order.update(status='delivered',locationId=location,placeName=location_label(places,location) or '原收件地点',deliveredWorldAt=at.isoformat())
            db.execute('UPDATE world_delivery_orders SET status=?,payload_json=? WHERE id=?',('delivered',json.dumps(order,ensure_ascii=False),row['id']))
            description='、'.join(i['name']+('×'+str(i['quantity']) if i['quantity']>1 else '') for i in order['items'])
            key='delivery-'+row['id']
            self.life.runtime.character_events.enqueue_in(db,role,session,'delivery',row['id'],{'items':order['items'],'placeName':order['placeName'],'announced':order['announced'],'receivedWorldAt':at.isoformat(),'sourceReceiptId':row['id']},stamp)
            self.life.journal.log(db,role,session,key,state,at,'收到外卖 · '+description,'delivery',location);changed=True
        completed=db.execute("UPDATE world_work_jobs SET status='complete' WHERE mode=? AND world_id=? AND status='working' AND due_at<=?",(role_mode(role),state['worldId'],now.isoformat())).rowcount
        return changed or bool(completed)
    def work_catalog(self,places):
        def find(word,fallback):return next((id for id,p in places.items() if word in p['name']),fallback)
        first=next(iter(places))
        return [{'id':'cafe-shift','name':'咖啡店帮忙','minutes':60,'reward':45,'locationId':find('咖啡',first),'description':'整理吧台、接待来客，一小时的小班。'},
                {'id':'library-sort','name':'整理图书','minutes':90,'reward':60,'locationId':find('图书馆',first),'description':'归还书籍、整理书架，安静的短时工作。'},
                {'id':'neighborhood','name':'社区跑腿','minutes':30,'reward':22,'locationId':find('广场',first),'description':'帮附近住户送一份小包裹。'}]
    def work_start(self,args):
        role,session,world,meta=self.scope({**args,'global':True});key=identifier(args.get('requestId'));stamp=self.life.stamp();places=self.life.places(role,session,world)
        job=next((j for j in self.work_catalog(places) if j['id']==args.get('jobId')),None)
        if not job:raise ValueError('phone_work_invalid')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');prior=db.execute('SELECT * FROM world_work_jobs WHERE id=?',(key,)).fetchone()
            if prior:
                saved=json.loads(prior['payload_json'])
                if saved['roleId']!=role or saved['sessionId']!=session or saved['jobId']!=job['id']:raise ValueError('phone_work_conflict')
                return {'job':{**saved,'status':prior['status']},'duplicate':True}
            self.life.transport.settle(db,role_mode(role),stamp)
            if db.execute("SELECT 1 FROM world_trips WHERE mode=? AND status='travelling'",(role_mode(role),)).fetchone():raise ValueError('phone_work_travelling')
            if db.execute("SELECT 1 FROM world_work_jobs WHERE mode=? AND world_id=? AND status IN ('working','complete')",(role_mode(role),world['id'])).fetchone():raise ValueError('phone_work_active')
            state,rev=self.life._state(db,role,session,world,meta,stamp);self.life._tick(state,stamp,places);now=date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));local=now+timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);day=local.date().isoformat()
            used=db.execute("SELECT payload_json FROM world_work_jobs WHERE mode=? AND world_id=? AND status='claimed'",(role_mode(role),world['id'])).fetchall();daily=sum(json.loads(r['payload_json'])['reward'] for r in used if json.loads(r['payload_json'])['workDay']==day)
            if daily+job['reward']>120:raise ValueError('phone_work_daily_limit')
            state['userLocation']=job['locationId'];receipt={**job,'id':key,'jobId':job['id'],'roleId':role,'sessionId':session,'worldId':world['id'],'startedAt':now.isoformat(),'dueAt':(now+timedelta(minutes=job['minutes'])).isoformat(),'workDay':day,'status':'working'}
            db.execute('INSERT INTO world_work_jobs VALUES(?,?,?,?,?,?,?,?,?)',(key,role,session,world['id'],role_mode(role),json.dumps(receipt,ensure_ascii=False),'working',receipt['dueAt'],stamp));self.life._save(db,role,session,state,rev+1,stamp)
            self.life.journal.log(db,role,session,'work-'+key,state,now,'开始兼职 · '+job['name'],'work',job['locationId'])
        self.runtime.backup_manager.mark_dirty();return {'job':receipt}
    def work_claim(self,args):
        role,session,world,meta=self.scope({**args,'global':True});key=identifier(args.get('jobId'));stamp=self.life.stamp();places=self.life.places(role,session,world)
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM world_work_jobs WHERE id=? AND mode=?',(key,role_mode(role))).fetchone()
            if not row:raise ValueError('phone_work_missing')
            job=json.loads(row['payload_json']);state,rev=self.life._state(db,role,session,world,meta,stamp);now=date(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
            if row['status']=='claimed':
                saved,payload,legacy,coins=self.snapshot(db);return {'job':{**job,'status':'claimed'},'duplicate':True,'clientRevision':saved['revision'],'clientLegacy':legacy}
            if row['status'] not in ['working','complete'] or now<date(row['due_at']):raise ValueError('phone_work_not_complete')
            paid=db.execute("SELECT payload_json FROM world_work_jobs WHERE mode=? AND world_id=? AND status='claimed'",(role_mode(role),world['id'])).fetchall();daily=sum(json.loads(r['payload_json'])['reward'] for r in paid if json.loads(r['payload_json'])['workDay']==job['workDay'])
            if daily+job['reward']>120:raise ValueError('phone_work_daily_limit')
            wallet=self.wallet(db,args.get('expectedClientRevision'),job['reward'],'work:'+key,'work-income',stamp,mode=role_mode(role));job['status']='claimed';db.execute("UPDATE world_work_jobs SET status='claimed',payload_json=? WHERE id=?",(json.dumps(job,ensure_ascii=False),key))
        self.runtime.backup_manager.mark_dirty();return {'job':job,**wallet}
    def work_cancel(self,args):
        role,session,world,meta=self.scope({**args,'global':True});key=identifier(args.get('jobId'))
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            row=db.execute("SELECT * FROM world_work_jobs WHERE id=? AND mode=?",(key,role_mode(role))).fetchone()
            if not row or row['status']!='working':raise ValueError('phone_work_not_active')
            db.execute("UPDATE world_work_jobs SET status='cancelled' WHERE id=?",(key,))
        self.runtime.backup_manager.mark_dirty();return {'ok':True}
    def output(self,db,role,session,state):
        binding={k:v for k,v in state.get('binding',{'status':'unbound'}).items() if k not in ['threshold','score']}
        row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone();legacy=(json.loads(row['payload_json']).get('legacy') or {}) if row else {}
        score=legacy.get('affection',{}).get(role,0);score=score if isinstance(score,(int,float)) and not isinstance(score,bool) else 0
        orders=[{**json.loads(r['payload_json']),'status':r['status']} for r in db.execute('SELECT * FROM world_delivery_orders WHERE world_id=? ORDER BY created_at DESC LIMIT 200',(state['worldId'],))]
        jobs=[{**json.loads(r['payload_json']),'status':r['status']} for r in db.execute('SELECT * FROM world_work_jobs WHERE mode=? AND world_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20',(role_mode(role),state['worldId']))]
        return {'binding':{**binding,'eligible':True},'deliveries':[r for r in orders if role_mode(r['roleId'])==role_mode(role)],'workJobs':jobs}

    def identity(self,args):
        from shared_world import PROFILES
        role,session,world,meta=self.scope({**args,'global':True});mode=role_mode(role);stamp=self.life.stamp();profile=args.get('profile')
        if profile not in PROFILES:raise ValueError('phone_identity_invalid')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');value,rev=self.life.shared.read(db,mode,stamp,world)
            if value.get('profile') and value['profile']!=profile:raise ValueError('phone_identity_already_chosen')
            if value.get('profile')==profile:
                row,payload,legacy,coins=self.snapshot(db);return {'duplicate':True,'clientRevision':row['revision'],'clientLegacy':legacy}
            now=date(stamp)+timedelta(seconds=value['timePolicy']['clockOffsetSeconds'])
            wallet=self.wallet(db,args.get('expectedClientRevision'),PROFILES[profile]['initial'],'identity:'+mode,'identity-capital',stamp,mode=mode)
            value.update(profile=profile,incomeStartedAt=now.isoformat(),incomeClaimedThrough=now.isoformat(),identityGranted=True)
            self.life.shared.write(db,mode,value,rev+1,stamp)
        self.runtime.backup_manager.mark_dirty();return wallet

    def income_claim(self,args):
        role,session,world,meta=self.scope({**args,'global':True});mode=role_mode(role);stamp=self.life.stamp()
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');value,rev=self.life.shared.read(db,mode,stamp,world)
            now=date(stamp)+timedelta(seconds=value['timePolicy']['clockOffsetSeconds']);income=self.life.shared.income(value,now)
            if income['pending']<=0:
                row,payload,legacy,coins=self.snapshot(db);return {'duplicate':True,'clientRevision':row['revision'],'clientLegacy':legacy}
            key='income:'+mode+':'+value['incomeClaimedThrough']+':'+now.isoformat()
            wallet=self.wallet(db,args.get('expectedClientRevision'),income['pending'],key,'periodic-income',stamp,mode=mode)
            value['incomeClaimedThrough']=now.isoformat();self.life.shared.write(db,mode,value,rev+1,stamp)
        self.runtime.backup_manager.mark_dirty();return wallet

    def automatic_income(self,db,role,stamp):
        mode=role_mode(role);world=self.life.shared.world(mode);value,rev=self.life.shared.read(db,mode,stamp,world)
        now=date(stamp)+timedelta(seconds=value['timePolicy']['clockOffsetSeconds']);income=self.life.shared.income(value,now)
        row=db.execute("SELECT * FROM client_workspace WHERE id='experience'").fetchone()
        if not row:return []
        if income['pending']>0:
            key='auto-income:'+mode+':'+str(value.get('incomeClaimedThrough'))+':'+now.isoformat()
            self.wallet(db,row['revision'],income['pending'],key,'automatic-income',stamp,mode=mode)
            value['incomeClaimedThrough']=now.isoformat();self.life.shared.write(db,mode,value,rev+1,stamp)
            self.runtime.backup_manager.mark_dirty()
        if self.snapshot(db)[2].get('economyMode',mode)!=mode:return []
        return [entry for entry in self.snapshot(db)[2].get('walletLedger',[]) if entry.get('kind')=='automatic-income']
