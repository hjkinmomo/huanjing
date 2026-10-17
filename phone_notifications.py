"""Durable phone reading receipts; all saved phone replies count, any origin."""
from contextlib import closing
import json
from role_workspace import identifier
from persona_modes import role_mode

class PhoneNotifications:
 def __init__(self,life,db):
  self.life=life
  db.execute('CREATE TABLE IF NOT EXISTS phone_read_receipts(role_id TEXT NOT NULL,session_id TEXT NOT NULL,through_ordinal INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(role_id,session_id))')
  # Recover only an old explicitly non-unread browser receipt. Missing evidence
  # leaves replies unread, rather than acknowledging them at first polling.
  saved=db.execute("SELECT payload_json FROM client_workspace WHERE id='experience'").fetchone()
  ui=json.loads(saved[0]).get('experience',{}) if saved else {}
  for key,mid in ui.get('lifeSeenMessages',{}).items():
   if key in ui.get('phoneUnreadReplies',{}):continue
   row=db.execute("SELECT c.* FROM conversation_messages c JOIN conversation_channels h ON h.message_id=c.id WHERE c.id=? AND c.sender='assistant' AND h.channel='phone'",(mid,)).fetchone()
   if row:db.execute('INSERT OR IGNORE INTO phone_read_receipts VALUES(?,?,?,?)',(row['role_id'],row['session_id'],row['ordinal'],row['created_at']))
  life.runtime.registry.register('phone_unread_status','Owner UI durable phone unread count.')(self.status)
  life.runtime.registry.register('phone_unread_mark','Owner UI acknowledges only displayed phone replies.',mutating=True)(self.mark)
 def status_in(self,db,mode):
  established={r['role_id'] for r in self.life.shared.sessions(db,mode)}
  rows=db.execute("""SELECT c.role_id,c.session_id,COUNT(*) count,MAX(c.ordinal) latestOrdinal
    FROM conversation_messages c JOIN conversation_channels h ON h.message_id=c.id
    JOIN role_sessions s ON s.role_id=c.role_id AND s.session_id=c.session_id
    LEFT JOIN phone_read_receipts r ON r.role_id=c.role_id AND r.session_id=c.session_id
    WHERE c.sender='assistant' AND h.channel='phone' AND c.deleted_at=''
    AND s.deleted_at='' AND s.archived=0 AND s.mode='character'
    AND c.ordinal>COALESCE(r.through_ordinal,-1) GROUP BY c.role_id,c.session_id""").fetchall()
  sessions=[]
  for row in rows:
   if row['role_id'] not in established:continue
   item=dict(row);item['latestId']=db.execute('SELECT id FROM conversation_messages WHERE role_id=? AND session_id=? AND ordinal=?',(item['role_id'],item['session_id'],item['latestOrdinal'])).fetchone()[0]
   sessions.append({'roleId':item['role_id'],'sessionId':item['session_id'],'count':item['count'],'latestId':item['latestId']})
  return {'mode':mode,'count':sum(s['count'] for s in sessions),'sessions':sessions}
 def status(self,args):
  mode=args.get('mode') or role_mode(args.get('roleId',''))
  if mode not in ['normal','special']:raise ValueError('phone_mode_invalid')
  with closing(self.life.runtime.connect()) as db:return self.status_in(db,mode)
 def mark(self,args):
  role=identifier(args.get('roleId'),80);session=identifier(args.get('sessionId'));mid=identifier(args.get('messageId'))
  with closing(self.life.runtime.connect()) as db,db:
   row=db.execute("SELECT c.ordinal FROM conversation_messages c JOIN conversation_channels h ON h.message_id=c.id WHERE c.id=? AND c.role_id=? AND c.session_id=? AND c.deleted_at='' AND c.sender='assistant' AND h.channel='phone'",(mid,role,session)).fetchone()
   if not row:raise ValueError('phone_read_message_missing')
   db.execute('INSERT INTO phone_read_receipts VALUES(?,?,?,?) ON CONFLICT(role_id,session_id) DO UPDATE SET through_ordinal=MAX(through_ordinal,excluded.through_ordinal),updated_at=excluded.updated_at',(role,session,row['ordinal'],self.life.stamp()))
  self.life.runtime.backup_manager.mark_dirty();return self.status({'mode':role_mode(role)})
