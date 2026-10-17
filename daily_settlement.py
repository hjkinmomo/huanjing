"""One factual receipt per closed story day; raw events remain queryable."""
from contextlib import closing
from datetime import datetime,timedelta,timezone
import json
from role_workspace import identifier

class DailySettlement:
 def __init__(self,life,db):
  self.life=life
  db.execute('CREATE TABLE IF NOT EXISTS world_day_journals(role_id TEXT NOT NULL,session_id TEXT NOT NULL,day TEXT NOT NULL,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(role_id,session_id,day))')
  life.runtime.registry.register('world_day_journal_get','Owner-only paged factual day journal; explicit trajectory sharing required.',mutating=False)(self.page)
 def bounds(self,day,offset):
  local=datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
  start=local-timedelta(minutes=offset)
  return start.isoformat(),(start+timedelta(days=1)).isoformat()
 def settle(self,db,role,session,state,stamp):
  if role in ['world-user','special.world-user'] or session==f'role:{role}:primary':return
  options=db.execute('SELECT memory_policy FROM chat_session_options WHERE role_id=? AND session_id=?',(role,session)).fetchone()
  if options and options[0]=='readonly':return
  offset=state['timePolicy']['utcOffsetMinutes'];now=datetime.fromisoformat(stamp)+timedelta(seconds=state['timePolicy'].get('clockOffsetSeconds',0));today=(now+timedelta(minutes=offset)).date()
  book=state.setdefault('daySettlement',{'startedDay':today.isoformat(),'through':(today-timedelta(days=1)).isoformat()})
  if today.isoformat()<=book['through']:return
  start=max(datetime.fromisoformat(book['startedDay']).date(),today-timedelta(days=2))
  for i in range(2):
   day=start+timedelta(days=i)
   if day>=today:break
   label=day.isoformat();lo,hi=self.bounds(label,offset)
   rows=db.execute("SELECT json_extract(payload_json,'$.kind') kind,COUNT(*) n FROM world_activity_log WHERE role_id=? AND session_id=? AND created_at>=? AND created_at<? GROUP BY kind",(role,session,lo,hi)).fetchall()
   kinds={r['kind']:r['n'] for r in rows};count=sum(kinds.values())
   value={'day':label,'displayDate':'新历'+str(day.year-1700)+day.strftime('年%m月%d日'),'eventCount':count,'kinds':kinds,'factsOnly':True,'source':'world-activity-log','note':'只汇总已记录的事实；未记录不代表没有生活，也不证明计划已完成。'}
   encoded=json.dumps(value,ensure_ascii=False)
   old=db.execute('SELECT payload_json FROM world_day_journals WHERE role_id=? AND session_id=? AND day=?',(role,session,label)).fetchone()
   if not old or old[0]!=encoded:db.execute('INSERT INTO world_day_journals VALUES(?,?,?,?,?) ON CONFLICT(role_id,session_id,day) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at',(role,session,label,encoded,stamp))
  missing=(today-datetime.fromisoformat(book['through']).date()).days-1
  if missing>2:book['boundedCatchUp']=missing-2
  book['through']=max(book['through'],(today-timedelta(days=1)).isoformat())
 def output(self,db,role,session,state):
  binding=state.get('binding',{})
  if binding.get('status')!='accepted':return {'dayJournals':[]}
  shared=binding.get('sharedFromWorldUtc','');offset=state['timePolicy']['utcOffsetMinutes'];result=[]
  for row in db.execute('SELECT payload_json FROM world_day_journals WHERE role_id=? AND session_id=? ORDER BY day DESC LIMIT 30',(role,session)):
   value=json.loads(row[0]);_,end=self.bounds(value['day'],offset)
   if shared and end<=shared:continue
   # Re-consent must not expose receipts of the previous sharing period.
   start,_=self.bounds(value['day'],offset)
   groups=db.execute("SELECT json_extract(payload_json,'$.kind') kind,COUNT(*) n FROM world_activity_log WHERE role_id=? AND session_id=? AND created_at>=? AND created_at<? GROUP BY kind",(role,session,max(start,shared),end)).fetchall()
   kinds={r['kind']:r['n'] for r in groups};result.append({**value,'eventCount':sum(kinds.values()),'kinds':kinds})
  return {'dayJournals':result,'dayJournalCatchUpLimited':bool(state.get('daySettlement',{}).get('boundedCatchUp'))}
 def page(self,args):
  role,session,world,meta=self.life.scope(args)
  if not world or session==f'role:{role}:primary' or args.get('global'):raise ValueError('journal_conversation_required')
  day=args.get('day');cursor=args.get('after',0);limit=args.get('limit',30)
  if not isinstance(day,str) or len(day)!=10 or datetime.fromisoformat(day).date().isoformat()!=day:raise ValueError('journal_day_invalid')
  if type(cursor)is not int or cursor<0 or type(limit)is not int or not 1<=limit<=50:raise ValueError('journal_page_invalid')
  with self.life.lock,closing(self.life.runtime.connect()) as db:
   from persona_modes import role_mode
   active=self.life.identities.current(db,role_mode(role));owner=db.execute('SELECT identity_id FROM world_identity_session_owners WHERE role_id=? AND session_id=?',(role,session)).fetchone()
   if owner and (not active or owner[0]!=active['id']):raise ValueError('identity_session_inactive')
   row=db.execute('SELECT state_json FROM world_life_instances WHERE role_id=? AND session_id=?',(role,session)).fetchone()
   if not row:raise ValueError('journal_conversation_required')
   state=json.loads(row[0]);binding=self.life.services.adopt_binding(db,role,state).get('binding',{})
   if binding.get('status')!='accepted':raise PermissionError('journal_sharing_required')
   lo,hi=self.bounds(day,state['timePolicy']['utcOffsetMinutes']);lo=max(lo,binding.get('sharedFromWorldUtc',''))
   rows=db.execute('SELECT rowid,payload_json FROM world_activity_log WHERE role_id=? AND session_id=? AND created_at>=? AND created_at<? AND rowid>? ORDER BY rowid LIMIT ?',(role,session,lo,hi,cursor,limit+1)).fetchall()
   items=[json.loads(r['payload_json']) for r in rows[:limit]]
   return {'day':day,'items':items,'hasMore':len(rows)>limit,'nextAfter':rows[min(len(rows),limit)-1]['rowid'] if rows else cursor,'source':'actual-events-only'}
