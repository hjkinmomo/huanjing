"""Local fictional activity ledger with queued model-authored outreach.

Rules produce explicitly attributed fictional events and bounded phone outreach.
Future trajectory records require consent; catch-up preserves the story clock.
"""
from datetime import datetime, timedelta, timezone
import hashlib, json
from persona_modes import role_mode


def dt(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) if datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is None else datetime.fromisoformat(value.replace('Z', '+00:00'))


class LifeJournal:
    def __init__(self, life, db):
        self.life=life
        db.executescript('''CREATE TABLE IF NOT EXISTS world_activity_log(
          role_id TEXT NOT NULL, session_id TEXT NOT NULL, event_id TEXT NOT NULL,
          payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY(role_id,session_id,event_id));
        CREATE TABLE IF NOT EXISTS world_message_origins(
          message_id TEXT PRIMARY KEY, source TEXT NOT NULL, event_id TEXT NOT NULL);''')

    def log(self, db, role, session, key, state, at, title, kind, location=None):
        if state.get('binding',{}).get('status')!='accepted':return
        if state['binding'].get('sharedFromWorldUtc') and at<dt(state['binding']['sharedFromWorldUtc']):return
        entry={'id':key,'title':title,'kind':kind,'locationId':location or state['roleLocation'],
               'together':self.life.co_located(state,{p['id']:p for p in self.life.shared.world(role_mode(role))['locations']}),'worldUtc':at.isoformat(),
               'source':'local-schedule-v1'}
        db.execute('INSERT OR IGNORE INTO world_activity_log VALUES(?,?,?,?,?)',
                   (role,session,key,json.dumps(entry,ensure_ascii=False),at.isoformat()))

    def message(self, db, role, session, state, stamp, key, text, world_at=None, source='local-schedule-v1'):
        mid='life-'+hashlib.sha256((role+'|'+session+'|'+key).encode()).hexdigest()[:40]
        if db.execute('SELECT 1 FROM conversation_messages WHERE id=?',(mid,)).fetchone():return
        world=world_at or dt(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
        self.life.runtime.character_events.enqueue_in(db,role,session,'outreach',key,{'occasionKey':key,'contextGuidance':text,'receivedWorldAt':world.isoformat(),'origin':source,'legacyReplyId':mid},stamp)

    def tick(self, db, role, session, state, stamp, places):
        a=state.get('autonomy')
        if not a or not a['enabled']:return False
        now=dt(stamp);world=now+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
        previous=dt(a['lastWorldUtc']);real_previous=dt(a['lastRealUtc'])
        online_gap=0<=(now-real_previous).total_seconds()<=120
        changed=False
        if world>previous and state['schedule']['enabled'] and state.get('binding',{}).get('status')=='accepted':
            # Record at most two days, with a summary for a longer absence.
            floor=max(previous,world-timedelta(days=2));offset=timedelta(minutes=state['timePolicy']['utcOffsetMinutes'])
            day=(floor+offset).replace(hour=0,minute=0,second=0,microsecond=0)
            if floor>previous:self.log(db,role,session,'gap-'+previous.isoformat(),state,floor,'较长时段按原日程继续生活；只摘要记录较早的日常。' if (world-previous).days<=7 else '较长时间后重新联系；旧日常收为摘要，等待新的共同安排。','catch-up')
            # Real arrival records are written by CharacterJourney.record.
            # A planned slot is not an observed completed activity.
            if floor>previous:changed=True
        last=db.execute("SELECT c.id,c.text,c.created_at,h.channel,h.world_time FROM conversation_messages c LEFT JOIN conversation_channels h ON h.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.sender='user' AND c.deleted_at='' ORDER BY c.ordinal DESC LIMIT 1",(role,session)).fetchone()
        idle=(now-dt(last['created_at'] if last else a['startedAt'])).total_seconds()
        if last and last['id']!=a.get('lastUserId'):
            if dt(last['created_at'])>=dt(a['startedAt']):
                interaction=dt(last['world_time']) if last['world_time'] else dt(last['created_at'])+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0))
                title='通过手机联系' if last['channel']=='phone' else '面对面交谈' if self.life.co_located(state,places) else '留下聊天消息'
                self.log(db,role,session,'interaction-'+last['id'],state,interaction,title,'interaction');changed=True
            a['lastUserId']=last['id']
        pending=a.get('pending')
        if pending:
            replied=last and dt(last['created_at'])>dt(pending['sentAt'])
            text=last['text'] if replied else ''
            accepted=state['userLocation']==pending['locationId'] or replied and any(w in text for w in ['一起吃','好的','好啊','可以','我来','等我','马上到'])
            declined=replied and any(w in text for w in ['不去','不了','不用等','你先吃','没空'])
            if declined:accepted=False
            expired=world>=dt(pending['until'])
            moved=state['roleLocation']!=pending['locationId']
            if moved:accepted=False
            if accepted or declined or expired or moved:
                title='改变地点，结束原邀约' if moved else '约好一起用餐，等待见面' if accepted else '按原计划用餐，不再等待'
                self.log(db,role,session,'resolved-'+pending['id'],state,world,title,'invitation-accepted' if accepted else 'invitation-ended')
                state['activity']=title;a['pending']=None;changed=True
                if expired and not replied and not moved and online_gap and a.get('sentCount',0)<3:
                    self.message(db,role,session,state,stamp,'end-'+pending['id'],'我先去吃饭啦，等你有空再聊。')
                    a['sentCount']+=1
            else:
                state['activity']='等你一起吃饭（五分钟）'
        local=world+timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);daily=local.date().isoformat()
        if a.get('day')!=daily:a['day']=daily;a['sentCount']=0
        cooldown=not a.get('lastSentAt') or (now-dt(a['lastSentAt'])).total_seconds()>=7200
        quiet=local.hour<8 or local.hour>=23 or any(w in state['activity'] for w in ['睡','休息中'])
        if online_gap and not state.get('enRoute') and a.get('outreach',True) and state['schedule']['enabled'] and not a.get('pending') and idle>=3600 and cooldown and a['sentCount']<3 and not quiet and not self.life.co_located(state,places):
            meal=any(w in state['activity'] for w in ['吃饭','午餐','晚餐','用餐'])
            key='outreach-'+daily+'-'+str(a['sentCount'])
            place=places.get(state['roleLocation'],{}).get('name','当前地点')
            template=a.get('mealText') if meal else a.get('greetingText')
            text=(template or ('我准备在{地点}吃饭，要不要一起？我等你五分钟。' if meal else '我在{地点}。你有空的话，我们聊一会儿？')).replace('{地点}',place).replace('{活动}',state['activity'])
            self.message(db,role,session,state,stamp,key,text)
            self.log(db,role,session,key,state,world,'发来用餐邀请' if meal else '主动发来手机消息','phone-outreach')
            a['lastSentAt']=stamp;a['sentCount']+=1;changed=True
            if meal:a['pending']={'id':key,'sentAt':stamp,'until':(world+timedelta(minutes=5)).isoformat(),'locationId':state['roleLocation']};state['activity']='等你一起吃饭（五分钟）'
        if world>previous and a.get('outreach',True) and not self.life.co_located(state,places) and ((now-real_previous).total_seconds()>300 or (world-previous).total_seconds()>3600):
            offset=timedelta(minutes=state['timePolicy']['utcOffsetMinutes']);gap=(world-previous).total_seconds();template=a.get('greetingText')
            if template:
                if gap<=2*86400:
                    candidates=[];day=(previous+offset).replace(hour=0,minute=0,second=0,microsecond=0)
                    while day<=world+offset:
                        for hour,minute in [(9,30),(17,30),(20,30)]:
                            at=day+timedelta(hours=hour,minutes=minute)-offset
                            if previous<at<=world:candidates.append(at)
                        day+=timedelta(days=1)
                    if len(candidates)>5:candidates=[candidates[round(i*(len(candidates)-1)/4)] for i in range(5)]
                    for at in candidates:
                        event_day=(at+offset).date().isoformat()
                        count=db.execute("SELECT COUNT(*) FROM conversation_channels h JOIN conversation_messages c ON c.id=h.message_id JOIN world_message_origins o ON o.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.deleted_at='' AND o.source IN ('local-schedule-v1','local-offline-v2','local-offline-summary-v2') AND date(h.world_time,?)=?",(role,session,'+'+str(state['timePolicy']['utcOffsetMinutes'])+' minutes',event_day)).fetchone()[0]
                        count+=db.execute("SELECT COUNT(*) FROM character_event_queue WHERE role_id=? AND session_id=? AND kind='outreach' AND status!='stale' AND date(json_extract(payload_json,'$.receivedWorldAt'),?)=?",(role,session,'+'+str(state['timePolicy']['utcOffsetMinutes'])+' minutes',event_day)).fetchone()[0]
                        if count>=3:continue
                        minute=(at+offset).hour*60+(at+offset).minute;slot=state['schedule']['slots'][-1]
                        for candidate in state['schedule']['slots']:
                            if int(candidate['at'][:2])*60+int(candidate['at'][3:])<=minute:slot=candidate
                        if any(w in slot['activity'] for w in ['睡','就寝']):continue
                        place=places.get(slot['locationId'],{}).get('name','当前地点')
                        text=template.replace('{地点}',place).replace('{活动}',slot['activity'])
                        self.message(db,role,session,state,stamp,'offline-'+at.isoformat(),text,at,'local-offline-v2');changed=True
                        if event_day==daily:a['sentCount']=min(3,a.get('sentCount',0)+1);a['lastSentAt']=stamp
                else:
                    prefix='这几天按原来的安排过日子，今天有空想聊聊。' if gap<=7*86400 else '好久没一起聊了。可以从今天的小事重新说起。'
                    text=prefix+template.replace('{地点}',places.get(state['roleLocation'],{}).get('name','当前地点')).replace('{活动}',state['activity'])
                    if 8<=local.hour<23:
                        self.message(db,role,session,state,stamp,'offline-summary-'+previous.isoformat(),text,world,'local-offline-summary-v2');changed=True
                        a['lastSentAt']=stamp;a['sentCount']=min(3,a.get('sentCount',0)+1)
                    else:a['pendingCatchUp']={'text':text,'key':'offline-summary-'+previous.isoformat()}
        if a.get('pendingCatchUp') and 8<=local.hour<23:
            pending=a.pop('pendingCatchUp');self.message(db,role,session,state,stamp,pending['key'],pending['text'],world,'local-offline-summary-v2');changed=True
            a['lastSentAt']=stamp;a['sentCount']=min(3,a.get('sentCount',0)+1)
        a['lastWorldUtc']=world.isoformat();a['lastRealUtc']=stamp
        return changed

    def output(self,db,role,session,state):
        rows=db.execute('SELECT payload_json FROM world_activity_log WHERE role_id=? AND session_id=? ORDER BY rowid DESC LIMIT 80',(role,session))
        messages=db.execute("SELECT c.id FROM conversation_messages c JOIN world_message_origins o ON o.message_id=c.id WHERE c.role_id=? AND c.session_id=? AND c.deleted_at='' ORDER BY c.ordinal DESC LIMIT 6",(role,session))
        return {'autonomy':state.get('autonomy',{'enabled':False}),'journal':[v for v in (json.loads(r['payload_json']) for r in rows) if state.get('binding',{}).get('status')=='accepted' and v.get('worldUtc','')>=state['binding'].get('sharedFromWorldUtc','')], 'outreachIds':[r['id'] for r in messages],**self.life.day_journals.output(db,role,session,state)}
