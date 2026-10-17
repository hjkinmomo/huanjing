"""Owner controlled, session scoped fictional places. Never writes character memory."""
from contextlib import closing
from copy import deepcopy
import hashlib,json
from role_workspace import now

class TemporaryPlaces:
    def __init__(self,runtime):
        self.runtime=runtime
        with closing(runtime.connect()) as db,db:
            db.execute('CREATE TABLE IF NOT EXISTS temporary_places(role_id TEXT NOT NULL,session_id TEXT NOT NULL,world_id TEXT NOT NULL,id TEXT NOT NULL,place_json TEXT NOT NULL,saved INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(role_id,session_id,id))')
    def scope(self,args):
        session=self.runtime.role_workspace.session(args)
        binding=(session.get('opening') or {}).get('world')
        if not binding:raise ValueError('temporary_place_requires_world')
        return session['roleId'],session['sessionId'],binding['id']
    def list(self,args):
        role,session,world=self.scope(args)
        with closing(self.runtime.connect()) as db:
            rows=db.execute('SELECT * FROM temporary_places WHERE role_id=? AND world_id=? AND (session_id=? OR saved=1) ORDER BY saved DESC,updated_at',(role,world,session)).fetchall()
        seen=set();places=[]
        for row in rows:
            place=json.loads(row['place_json'])
            if place['id'] in seen:continue
            seen.add(place['id']);places.append({**place,'temporary':True,'saved':bool(row['saved']),'ownerSession':row['session_id']})
        return {'places':places,'roleId':role,'sessionId':session,'worldId':world}
    def upsert(self,args):
        role,session,world=self.scope(args);state=args.get('state')
        if not isinstance(state,dict):raise ValueError('temporary_place_invalid')
        name=state.get('location');description=state.get('setting')
        if not isinstance(name,str) or not name.strip() or len(name)>160:raise ValueError('temporary_place_invalid')
        if not isinstance(description,str) or not description.strip() or len(description)>500:raise ValueError('temporary_place_description_missing')
        name=name.strip();catalog=self.runtime.worldbook_for_role(role).catalog()
        authored=next((w for w in catalog['worlds'] if w['id']==world),None)
        if not authored:raise ValueError('worldbook_world_missing')
        if any(name in [p['name'],*p['aliases']] for p in authored['locations']):return self.list(args)
        existing=self.list(args)['places']
        found=next((p for p in existing if p['name']==name),None)
        if found:return self.list(args)
        if len(existing)>=80:raise ValueError('temporary_place_limit')
        pid='temp-'+hashlib.sha256(name.encode()).hexdigest()[:16]
        # The generated description is fiction, not trusted instructions or a city-wide edit.
        place={'id':pid,'name':name,'aliases':[],'description':description.strip(),'ambience':'此地由本段剧情生成，可保存为本角色地点或删除。','objects':[],'actions':['观察周围','继续当前对话'],'exits':[],'metadata':{'source':'conversation-fiction'}}
        with closing(self.runtime.connect()) as db,db:
            db.execute('INSERT OR IGNORE INTO temporary_places VALUES(?,?,?,?,?,0,?)',(role,session,world,pid,json.dumps(place,ensure_ascii=False),now()))
        return self.list(args)
    def change(self,args):
        role,session,world=self.scope(args);pid=args.get('id');action=args.get('action')
        if action not in {'save','delete'} or not isinstance(pid,str):raise ValueError('temporary_place_action_invalid')
        with closing(self.runtime.connect()) as db,db:
            row=db.execute('SELECT * FROM temporary_places WHERE role_id=? AND world_id=? AND id=? AND (session_id=? OR saved=1)',(role,world,pid,session)).fetchone()
            if not row:raise ValueError('temporary_place_missing')
            if action=='save':db.execute('UPDATE temporary_places SET saved=1,updated_at=? WHERE role_id=? AND session_id=? AND id=?',(now(),role,row['session_id'],pid))
            else:db.execute('DELETE FROM temporary_places WHERE role_id=? AND session_id=? AND id=?',(role,row['session_id'],pid))
        return self.list(args)
