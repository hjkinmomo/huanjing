"""Explicit fictional residence assignments, with saved user evidence."""
import re,json,hashlib
from scene_locations import location_accessible

def residence_request(text,places,occupied=()):
 if not isinstance(text,str) or len(text)>12000:return None
 if any(w in text for w in ['不要','别住','不许','不能','不用','如果','假如','要是','比如','举例','小说里','梦里','明天','后天','下周','“','”','「','」','"','\'']):return None
 if not re.search(r'(?:你|以后你|今后你).{0,6}(?:住在|住到|住进|入住|住)',text):return None
 if '客房' in text:
  return 'guest-room-2' if re.search(r'另(?:一间|一个|间|个)|第二|二号',text) or 'guest-room-1' in occupied else 'guest-room-1'
 matches=[pid for pid,p in places.items() if any(name and name in text for name in [p['name'],*p.get('aliases',[])])]
 return matches[0] if len(matches)==1 else None

class CharacterResidence:
 def __init__(self,life,db):
  self.life=life
  db.execute('CREATE TABLE IF NOT EXISTS character_residences(role_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,location_id TEXT NOT NULL,message_id TEXT NOT NULL,updated_at TEXT NOT NULL)')
 def adopt(self,db,role,state):
  row=db.execute('SELECT * FROM character_residences WHERE role_id=?',(role,)).fetchone()
  if row and row['world_id']==state['worldId']:state['homeLocation']=row['location_id']
 def tick(self,db,role,session,state,stamp,places):
  self.adopt(db,role,state)
  rows=db.execute("SELECT * FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND ordinal>? AND deleted_at='' ORDER BY ordinal LIMIT 100",(role,session,state.get('residenceThroughOrdinal',-1))).fetchall();changed=False
  for row in rows:
   occupied=[r['location_id'] for r in db.execute('SELECT location_id FROM character_residences WHERE world_id=? AND role_id!=?',(state['worldId'],role))]
   target=residence_request(row['text'],places,occupied)
   if location_accessible(places,target):
    state['homeLocation']=target
    db.execute('INSERT INTO character_residences VALUES(?,?,?,?,?) ON CONFLICT(role_id) DO UPDATE SET world_id=excluded.world_id,location_id=excluded.location_id,message_id=excluded.message_id,updated_at=excluded.updated_at',(role,state['worldId'],target,row['id'],stamp))
    key='residence-'+hashlib.sha256((role+row['id']).encode()).hexdigest()[:40]
    evidence=[{'messageId':row['id'],'speaker':'user','quote':row['text'],'sessionId':session}]
    db.execute("UPDATE role_memories SET state='superseded',revision=revision+1,updated_at=? WHERE role_id=? AND origin='owner-world-residence' AND state='active'",(stamp,role))
    db.execute("INSERT OR IGNORE INTO role_memories(id,role_id,topic,kind,text,state,evidence_json,origin,supersedes,revision,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?, '',1,?,?)",(key,role,'故事居所','fiction','在这个虚构世界中，你的长期居所是'+places[target]['name']+'。这不是现实用户身份或地址。',json.dumps(evidence,ensure_ascii=False),'owner-world-residence',stamp,stamp))
    self.life.event(db,role,session,key,'residence',{'locationId':target,'messageId':row['id'],'fictional':True},stamp)
    changed=True
   state['residenceThroughOrdinal']=row['ordinal']
  return changed
