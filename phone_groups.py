"""User-started bounded group turns, isolated from private direct messages."""
from contextlib import closing
from datetime import datetime,timedelta
import hashlib,json,re,threading
from persona_modes import checked_mode,role_mode
from role_workspace import identifier
from character_event_context import messages_with_context,output_budget,clean_event_reply

def key(*values):
    return hashlib.sha256(json.dumps(values,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:40]

def reply_payload(raw):
    if not isinstance(raw,str):raise ValueError('phone_group_reply_invalid')
    raw=re.sub(r'<think>[\s\S]*?</think>','',raw,flags=re.I).strip()
    raw=re.sub(r'^```(?:json)?\s*|\s*```$','',raw)
    if raw in ('null','true','false'):raise ValueError('phone_group_reply_invalid')
    memory=''
    if raw.startswith(('{','[')):
        try:parsed=json.loads(raw)
        except ValueError:raise ValueError('phone_group_reply_invalid')
        if isinstance(parsed,dict) and 'reply' in parsed:
            text=clean_event_reply(parsed['reply'],'phone');memory=parsed.get('memory','')
        else:text=clean_event_reply(raw,'phone')
    else:text=clean_event_reply(raw,'phone')
    # An optional malformed memory must never discard a genuine spoken reply.
    if not isinstance(memory,str) or len(memory)>100 or memory and not re.search(r'我|\bI\b|\bmy\b',memory,re.I):memory=''
    return text,memory

def failure_text(error):
    code=str(error)
    if code.startswith('phone_group_http_'):
        status=code.removeprefix('phone_group_http_')
        return {'401':'模型密钥验证失败，请检查模型连接。','403':'模型服务拒绝了请求，请检查账户权限。','402':'模型账户余额不足。','429':'模型服务限流或额度不足，请稍后手动重试。'}.get(status,'模型服务暂时不可用，请稍后手动重试。')
    return {'credential_unavailable':'尚未配置可用的模型密钥。','event_context_budget_exceeded':'当前上下文容量不足以容纳群里本轮发言，请增大上下文窗口。','phone_group_reply_truncated':'模型回复被输出长度限制截断，请调高输出上限后重试。','phone_group_reply_invalid':'模型返回的群聊文字格式不完整，请手动重试。','character_reply_missing':'模型没有返回群聊正文，请手动重试。','character_reply_invalid':'模型返回的群聊正文格式不完整，请手动重试。','phone_group_profile_changed':'模型配置已变化，请使用当前配置手动重试。','phone_group_turn_stale':'这轮群聊或身份已变化，旧回复未写入。'}.get(code,'模型请求未完成，原记录保留。请检查模型连接后手动重试。')

class PhoneGroups:
    def __init__(self,runtime):
        self.runtime=runtime;self.life=runtime.world_life;self.worker=None
        with closing(runtime.connect()) as db,db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS phone_groups(id TEXT PRIMARY KEY,mode TEXT NOT NULL,identity_id TEXT NOT NULL,title TEXT NOT NULL,members_json TEXT NOT NULL,revision INTEGER NOT NULL,read_ordinal INTEGER NOT NULL DEFAULT -1,closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS phone_group_messages(id TEXT PRIMARY KEY,mode TEXT NOT NULL,group_id TEXT NOT NULL,ordinal INTEGER NOT NULL,speaker_id TEXT NOT NULL,speaker_name TEXT NOT NULL,text TEXT NOT NULL,world_at TEXT NOT NULL,source_id TEXT NOT NULL,UNIQUE(group_id,ordinal));
            CREATE TABLE IF NOT EXISTS phone_group_turns(id TEXT PRIMARY KEY,mode TEXT NOT NULL,group_id TEXT NOT NULL,user_message_id TEXT NOT NULL,identity_id TEXT NOT NULL,epoch TEXT NOT NULL,selected_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS phone_group_receipts(id TEXT PRIMARY KEY,mode TEXT NOT NULL,group_id TEXT NOT NULL,turn_id TEXT NOT NULL,role_id TEXT NOT NULL,session_id TEXT NOT NULL,status TEXT NOT NULL,reply_id TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS phone_group_profiles(role_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS phone_group_memories(id TEXT PRIMARY KEY,role_id TEXT NOT NULL,group_id TEXT NOT NULL,source_id TEXT NOT NULL,text TEXT NOT NULL,world_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS phone_group_history ON phone_group_messages(group_id,ordinal);
            ''')
            db.execute("UPDATE phone_group_receipts SET status='interrupted',error='上次生成中断，结果未知；未自动重试。' WHERE status='generating'")
            db.execute("UPDATE phone_group_turns SET status='interrupted' WHERE status='generating'")
        for name,fn,write in [('phone_group_list',self.list,False),('phone_group_get',self.get,False),('phone_group_create',self.create,True),('phone_group_send',self.send,True),('phone_group_control',self.control,True),('phone_group_configure',self.configure,True)]:
            runtime.registry.register(name,'Owner UI group chat; never a model or MCP capability.',mutating=write)(fn)

    def bank(self,db,mode):
        active=self.life.identities.current(db,mode)
        return active['id'] if active else ''

    def epoch(self,db):
        row=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone()
        return str(json.loads(row[0]).get('experience',{}).get('dataEpoch') or '') if row else ''

    def stamp(self,db,mode):
        real=self.life.stamp();state,_=self.life.shared.read(db,mode,real,self.life.shared.world(mode))
        return (datetime.fromisoformat(real)+timedelta(seconds=state['timePolicy']['clockOffsetSeconds'])).isoformat()

    def group(self,db,args,open_only=False):
        mode=checked_mode(args.get('mode','normal'));gid=identifier(args.get('groupId'))
        row=db.execute('SELECT * FROM phone_groups WHERE id=? AND mode=?',(gid,mode)).fetchone()
        if not row or row['identity_id']!=self.bank(db,mode):raise ValueError('phone_group_missing')
        if open_only and row['closed']:raise ValueError('phone_group_closed')
        return dict(row)

    def members(self,db,group,validate=False):
        members=json.loads(group['members_json'])
        if validate:
            for member in members:self.life.social.scope(db,member)
        return members

    def configure(self,args):
        role,session=args.get('roleId'),args.get('sessionId')
        profile=self.runtime.auto_moments._profile(args.get('profile'))
        # Group configuration accepts persona systems only, never cached reference data.
        if any(m['role']!='system' for m in profile['messages']):raise ValueError('phone_group_private_reference_forbidden')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            self.life.social.scope(db,{'roleId':role,'sessionId':session})
            db.execute('INSERT INTO phone_group_profiles VALUES(?,?) ON CONFLICT(role_id) DO UPDATE SET profile_json=excluded.profile_json',(role,json.dumps(profile,ensure_ascii=False)))
        self.runtime.backup_manager.mark_dirty();return {'ready':True}

    def describe(self,db,row):
        members=self.members(db,row)
        last=db.execute('SELECT * FROM phone_group_messages WHERE group_id=? ORDER BY ordinal DESC LIMIT 1',(row['id'],)).fetchone()
        unread=db.execute("SELECT COUNT(*) FROM phone_group_messages WHERE group_id=? AND speaker_id!='user' AND ordinal>?",(row['id'],row['read_ordinal'])).fetchone()[0]
        return {'id':row['id'],'title':row['title'],'closed':bool(row['closed']),'revision':row['revision'],'members':[{'roleId':m['roleId'],'name':self.life.social.card(db,m['roleId'])['name']} for m in members],'lastMessage':dict(last) if last else None,'unread':unread}

    def list(self,args):
        mode=checked_mode(args.get('mode','normal'))
        with self.life.lock,closing(self.runtime.connect()) as db:
            rows=db.execute('SELECT * FROM phone_groups WHERE mode=? AND identity_id=? ORDER BY rowid DESC',(mode,self.bank(db,mode))).fetchall()
            groups=[self.describe(db,row) for row in rows];eligible=[]
            for row in self.life.shared.sessions(db,mode):
                member={'roleId':row['role_id'],'sessionId':row['session_id']}
                try:self.life.social.scope(db,member)
                except (ValueError,PermissionError):continue
                eligible.append(member)
        return {'groups':groups,'eligible':eligible,'unread':sum(g['unread'] for g in groups),'inboxToken':'|'.join(g['id']+':'+g['lastMessage']['id'] for g in groups if g['unread'] and g['lastMessage'])}

    def get(self,args):
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            g=self.group(db,args);before=args.get('beforeOrdinal');limit=40
            if before is not None and (type(before)is not int or before<0):raise ValueError('phone_group_page_invalid')
            rows=db.execute('SELECT * FROM phone_group_messages WHERE group_id=?'+(' AND ordinal<?' if before is not None else '')+' ORDER BY ordinal DESC LIMIT ?',(g['id'],*([before] if before is not None else []),limit+1)).fetchall()
            page=list(reversed(rows[:limit]));turn=db.execute('SELECT * FROM phone_group_turns WHERE group_id=? ORDER BY rowid DESC LIMIT 1',(g['id'],)).fetchone()
            receipts=[{k:r[k] for k in ['id','role_id','status','error']} for r in db.execute('SELECT * FROM phone_group_receipts WHERE turn_id=? ORDER BY rowid',(turn['id'],))] if turn else []
            if args.get('markRead') is True and before is None:
                high=rows[0]['ordinal'] if rows else -1
                db.execute('UPDATE phone_groups SET read_ordinal=MAX(read_ordinal,?) WHERE id=?',(high,g['id']));g['read_ordinal']=max(g['read_ordinal'],high)
            result={'group':self.describe(db,g),'messages':[dict(r) for r in page],'hasMore':len(rows)>limit,'nextBefore':page[0]['ordinal'] if page else 0,'turn':{'id':turn['id'],'status':turn['status'],'receipts':receipts} if turn else None}
        return result

    def create(self,args):
        mode=checked_mode(args.get('mode','normal'));title=args.get('title','');roles=args.get('roleIds');request=identifier(args.get('requestId'))
        if not isinstance(title,str) or not 1<=len(title.strip())<=40 or not isinstance(roles,list) or not 2<=len(roles)<=5 or any(not isinstance(r,str) for r in roles) or len(set(roles))!=len(roles):raise ValueError('phone_group_members_invalid')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            active={r['role_id']:r['session_id'] for r in self.life.shared.sessions(db,mode)}
            members=[]
            for role in roles:
                if role_mode(role)!=mode or role not in active:raise ValueError('phone_group_member_inactive')
                member={'roleId':role,'sessionId':active[role]};self.life.social.scope(db,member);members.append(member)
            bank=self.bank(db,mode);gid='group-'+key(mode,bank,request)
            previous=db.execute('SELECT * FROM phone_groups WHERE id=?',(gid,)).fetchone()
            if previous and (previous['title']!=title.strip() or previous['members_json']!=json.dumps(members)):raise ValueError('phone_group_request_conflict')
            db.execute('INSERT OR IGNORE INTO phone_groups VALUES(?,?,?,?,?,1,-1,0,?)',(gid,mode,bank,title.strip(),json.dumps(members),self.life.stamp()))
        self.runtime.backup_manager.mark_dirty();return self.get({'mode':mode,'groupId':gid})

    def choose(self,db,g,text,mentions):
        members=self.members(db,g,True);roles=[m['roleId'] for m in members]
        if not isinstance(mentions,list) or any(not isinstance(r,str) for r in mentions) or len(set(mentions))!=len(mentions) or any(r not in roles for r in mentions):raise ValueError('phone_group_mention_invalid')
        if len(mentions)>1:raise ValueError('phone_group_one_mention_only')
        named=[]
        for role in roles:
            match=re.search('@'+re.escape(self.life.social.card(db,role)['name'])+r'(?:\s|[，,：:。!?！？]|$)',text)
            if match:named.append((match.start(),role))
        target=mentions[0] if mentions else min(named)[1] if named else None
        # members_json preserves the order chosen when creating this group.
        return [m for m in members if m['roleId']==target] if target else members

    def predecessors(self,db,row,turn):
        selected=json.loads(turn['selected_json']);index=next(i for i,m in enumerate(selected) if m['roleId']==row['role_id'])
        result=[]
        for member in selected[:index]:
            prior=db.execute('SELECT * FROM phone_group_receipts WHERE turn_id=? AND role_id=?',(turn['id'],member['roleId'])).fetchone()
            if not prior or prior['status'] not in ('done','silent'):return None
            if prior['status']=='done':
                reply=db.execute('SELECT id,speaker_id,speaker_name,text,world_at FROM phone_group_messages WHERE id=? AND group_id=? AND source_id=?',(prior['reply_id'],row['group_id'],turn['user_message_id'])).fetchone()
                if not reply:return None
                result.append(dict(reply))
        return result

    def send(self,args):
        text=args.get('text');request=identifier(args.get('requestId'))
        if not isinstance(text,str) or not 1<=len(text.strip())<=6000:raise ValueError('phone_group_text_invalid')
        text=text.strip()
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');g=self.group(db,args,True);turn_id='group-turn-'+key(g['id'],request)
            old=db.execute('SELECT * FROM phone_group_turns WHERE id=?',(turn_id,)).fetchone()
            if old:
                message=db.execute('SELECT text FROM phone_group_messages WHERE id=?',(old['user_message_id'],)).fetchone()
                requested=args.get('mentionIds',[])
                if not message or message[0]!=text or requested and set(requested)!={m['roleId'] for m in json.loads(old['selected_json'])}:raise ValueError('phone_group_request_conflict')
            else:
                selected=self.choose(db,g,text,args.get('mentionIds',[]))
                self.cancel_in(db,g['id']);ordinal=db.execute('SELECT COALESCE(MAX(ordinal),-1)+1 FROM phone_group_messages WHERE group_id=?',(g['id'],)).fetchone()[0]
                mid='group-user-'+key(turn_id);identity=self.life.identities.current(db,g['mode']);stamp=self.stamp(db,g['mode'])
                db.execute('INSERT INTO phone_group_messages VALUES(?,?,?,?,?,?,?,?,?)',(mid,g['mode'],g['id'],ordinal,'user',identity['name'] if identity else '你',text,stamp,request))
                db.execute('INSERT INTO phone_group_turns VALUES(?,?,?,?,?,?,?,?,?)',(turn_id,g['mode'],g['id'],mid,g['identity_id'],self.epoch(db),json.dumps(selected),'queued',self.life.stamp()))
                for member in selected:db.execute('INSERT INTO phone_group_receipts(id,mode,group_id,turn_id,role_id,session_id,status) VALUES(?,?,?,?,?,?,?)',('group-call-'+key(turn_id,member['roleId']),g['mode'],g['id'],turn_id,member['roleId'],member['sessionId'],'queued'))
                db.execute('UPDATE phone_groups SET revision=revision+1 WHERE id=?',(g['id'],))
        self.runtime.backup_manager.mark_dirty();return self.get({**args,'markRead':True})

    def cancel_in(self,db,gid):
        db.execute("UPDATE phone_group_receipts SET status='cancelled',error='已停止，本轮未发出的回复不会再插入。' WHERE group_id=? AND status IN ('queued','generating','waiting_configuration')",(gid,))
        db.execute("UPDATE phone_group_turns SET status='cancelled' WHERE group_id=? AND status IN ('queued','generating','waiting_configuration')",(gid,))

    def control(self,args):
        action=args.get('action')
        if action not in ['cancel','retry','close']:raise ValueError('phone_group_control_invalid')
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            db.execute('BEGIN IMMEDIATE');g=self.group(db,args)
            if action in ['cancel','close']:
                self.cancel_in(db,g['id'])
                if action=='close':db.execute('UPDATE phone_groups SET closed=1,revision=revision+1 WHERE id=?',(g['id'],))
            else:
                if g['closed']:raise ValueError('phone_group_closed')
                turn=db.execute('SELECT * FROM phone_group_turns WHERE group_id=? ORDER BY rowid DESC LIMIT 1',(g['id'],)).fetchone()
                if not turn or turn['id']!=args.get('turnId') or turn['epoch']!=self.epoch(db):raise ValueError('phone_group_turn_stale')
                self.members(db,g,True)
                if not db.execute("SELECT 1 FROM phone_group_receipts WHERE turn_id=? AND status IN ('failed','interrupted')",(turn['id'],)).fetchone():raise ValueError('phone_group_retry_invalid')
                db.execute("UPDATE phone_group_receipts SET status='queued',error='' WHERE turn_id=? AND status IN ('failed','interrupted')",(turn['id'],))
                db.execute("UPDATE phone_group_turns SET status='queued' WHERE id=?",(turn['id'],))
        self.runtime.backup_manager.mark_dirty();return self.get(args)

    def valid_call(self,db,row):
        g=self.group(db,{'mode':row['mode'],'groupId':row['group_id']},True)
        turn=db.execute('SELECT * FROM phone_group_turns WHERE id=?',(row['turn_id'],)).fetchone()
        latest=db.execute("SELECT id FROM phone_group_messages WHERE group_id=? AND speaker_id='user' ORDER BY ordinal DESC LIMIT 1",(g['id'],)).fetchone()
        if not turn or turn['identity_id']!=g['identity_id'] or turn['epoch']!=self.epoch(db) or not latest or latest[0]!=turn['user_message_id']:raise ValueError('phone_group_turn_stale')
        self.members(db,g,True)
        return g,dict(turn)

    def tick(self):
        with self.life.lock,closing(self.runtime.connect()) as db,db:
            if self.runtime._stop.is_set() or self.worker and self.worker.is_alive():return
            rows=db.execute("SELECT r.*,p.profile_json FROM phone_group_receipts r LEFT JOIN phone_group_profiles p ON p.role_id=r.role_id WHERE r.status IN ('queued','waiting_configuration') ORDER BY r.rowid LIMIT 100").fetchall()
            chosen=None
            for row in rows:
                try:
                    g,turn=self.valid_call(db,row)
                except (ValueError,PermissionError):
                    db.execute("UPDATE phone_group_receipts SET status='stale',error='原身份、群成员或聊天已变化。' WHERE id=?",(row['id'],));continue
                if self.predecessors(db,row,turn) is None:continue
                if not row['profile_json']:
                    db.execute("UPDATE phone_group_receipts SET status='waiting_configuration',error='尚未配置该角色的群聊模型连接。' WHERE id=?",(row['id'],));continue
                if db.execute("SELECT 1 FROM tasks WHERE role_id=? AND status IN ('running','cancelling')",(row['role_id'],)).fetchone():continue
                chosen=dict(row);db.execute("UPDATE phone_group_receipts SET status='generating',error='' WHERE id=?",(row['id'],));db.execute("UPDATE phone_group_turns SET status='generating' WHERE id=?",(row['turn_id'],));break
            if not chosen:return
        self.worker=threading.Thread(target=self.generate,args=(chosen,),daemon=True,name='hermes-phone-group');self.worker.start()

    def context(self,db,row,g,turn):
        previous=self.predecessors(db,row,turn)
        if previous is None:raise ValueError('phone_group_wait_for_previous')
        # No role_context(): that function intentionally includes private DMs/opening/summary.
        current=db.execute('SELECT id,speaker_id,speaker_name,text,world_at FROM phone_group_messages WHERE id=? AND group_id=?',(turn['user_message_id'],g['id'])).fetchone()
        context={'group':{'id':g['id'],'title':g['title']},'currentUserMessageId':turn['user_message_id'],'currentUserMessage':dict(current),'members':[self.life.social.card(db,m['roleId']) for m in self.members(db,g)],'selfRoleId':row['role_id'],'orderedTurn':[dict(current),*previous],'ownMemories':[dict(r) for r in db.execute('SELECT source_id,text FROM phone_group_memories WHERE role_id=? AND group_id=? ORDER BY rowid DESC LIMIT 6',(row['role_id'],g['id']))]}
        # orderedTurn is mandatory context, never silently trimmed by the shared
        # automatic-event budget helper. Too small a window fails before billing.
        return context

    def generate(self,row):
        try:
            profile=json.loads(row['profile_json']);resolver=self.runtime.auto_moments.resolve_provider
            if not resolver:raise ValueError('credential_unavailable')
            provider={**resolver({**profile['provider'],'roleId':row['role_id']}),'timeoutSeconds':90}
            with closing(self.runtime.connect()) as db:
                g,turn=self.valid_call(db,row);context=self.context(db,row,g,turn)
                settings_row=db.execute('SELECT settings_json FROM role_agents WHERE role_id=?',(row['role_id'],)).fetchone();settings=json.loads(settings_row[0]) if settings_row else {}
            instruction='你正在微聊小群中，按固定成员顺序轮到你回应用户。orderedTurn只包含本轮用户原话和在你之前已经完成的角色回答，带有说话者与来源。结合自己的性格回答，也可接续前面真实说过的话，不替尚未回答的人发言。群外私聊和私密经历不在本轮资料内，不能自行补全、暗示或冒充知道；公开身份不等于亲密关系。不要播报轮次或套用固定感谢话。请给出自己的实际回答，不返回null或空白；允许自然表达不想回答或不知道，但仍用自己的话回应。返回JSON：{"reply":"发到群里的非空文字","memory":"与我相关的本轮群经历，第一人称100字内；无须记忆则空字符串"}。memory只依据本轮可见资料与自己的回应，不代表旁人同意，不提取私聊。角色回复不会启动下一轮，用户发言才会。'
            thinking=profile.get('thinking') is True
            deepseek=provider['model'].startswith('deepseek')
            settings={**settings,'maxTokens':max(2048,output_budget(settings)) if deepseek and thinking else output_budget(settings)}
            transport={**profile,'messages':[*profile['messages'],{'role':'system','content':'本次为群聊输出协议：优先返回 JSON 对象，包含非空 reply 和可选 memory 字符串。reply 只放角色实际发送的聊天文字；不写旁白、思考或工具调用。此协议规定传输格式，不改变角色人格。'}]}
            messages=messages_with_context(transport,context,instruction,settings)
            body={'model':provider['model'],'messages':messages,'stream':False,'max_tokens':output_budget(settings)}
            if deepseek:body['thinking']={'type':'enabled' if thinking else 'disabled'}
            result=self.runtime.proxy_provider_request({'route':'chat','roleId':row['role_id'],'provider':provider,'body':body,'roleSkills':{'enabled':False,'context':'group','sessionId':row['session_id']}})
            if result.get('ok') is False:
                status=result.get('httpStatus')
                raise ValueError('phone_group_http_'+str(status) if type(status)is int else 'phone_group_model_failed')
            choice=result.get('payload',{}).get('choices',[{}])[0]
            if choice.get('finish_reason')=='length':raise ValueError('phone_group_reply_truncated')
            text,memory=reply_payload(choice.get('message',{}).get('content',''))
            with self.life.lock,closing(self.runtime.connect()) as db,db:
                db.execute('BEGIN IMMEDIATE');current=db.execute('SELECT status FROM phone_group_receipts WHERE id=?',(row['id'],)).fetchone()
                if self.runtime._stop.is_set() or not current or current[0]!='generating':return
                g,turn=self.valid_call(db,row)
                config=db.execute('SELECT profile_json FROM phone_group_profiles WHERE role_id=?',(row['role_id'],)).fetchone()
                if not config or config[0]!=row['profile_json']:raise ValueError('phone_group_profile_changed')
                stamp=self.stamp(db,g['mode']);mid='group-reply-'+key(row['id'])
                if text:
                    ordinal=db.execute('SELECT COALESCE(MAX(ordinal),-1)+1 FROM phone_group_messages WHERE group_id=?',(g['id'],)).fetchone()[0]
                    db.execute('INSERT OR IGNORE INTO phone_group_messages VALUES(?,?,?,?,?,?,?,?,?)',(mid,g['mode'],g['id'],ordinal,row['role_id'],self.life.social.card(db,row['role_id'])['name'],text,stamp,turn['user_message_id']))
                if memory:db.execute('INSERT OR IGNORE INTO phone_group_memories VALUES(?,?,?,?,?,?)',('group-memory-'+key(row['id']),row['role_id'],g['id'],turn['user_message_id'],memory,stamp))
                db.execute("UPDATE phone_group_receipts SET status=?,reply_id=? WHERE id=?",('done' if text else 'silent',mid if text else '',row['id']))
                db.execute('UPDATE phone_groups SET revision=revision+1 WHERE id=?',(g['id'],))
                pending=db.execute("SELECT 1 FROM phone_group_receipts WHERE turn_id=? AND status IN ('queued','waiting_configuration','generating')",(turn['id'],)).fetchone()
                if not pending:db.execute("UPDATE phone_group_turns SET status='done' WHERE id=?",(turn['id'],))
            self.runtime.backup_manager.mark_dirty()
        except Exception as error:
            with self.life.lock,closing(self.runtime.connect()) as db,db:
                db.execute("UPDATE phone_group_receipts SET status='failed',error=? WHERE id=? AND status='generating'",(failure_text(error),row['id']))
                db.execute("UPDATE phone_group_turns SET status='failed' WHERE id=? AND status='generating'",(row['turn_id'],))
