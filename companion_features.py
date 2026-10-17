"""Role-scoped expression lessons and a browser adapter over durable moments."""
from __future__ import annotations
from contextlib import closing
from datetime import datetime, timezone
import json,re,threading,uuid

TOKEN=re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
def token(value):
 if not isinstance(value,str) or not TOKEN.fullmatch(value) or value in {'__proto__','constructor','prototype'}:raise ValueError('invalid_companion_id')
 return value
def text(value,limit):
 if not isinstance(value,str) or not value.strip() or len(value)>limit:raise ValueError('invalid_companion_text')
 return value.strip()
def now():return datetime.now(timezone.utc).isoformat()

class CompanionFeatures:
 def __init__(self,runtime):
  self.runtime=runtime;self.lock=threading.RLock()
  with closing(runtime.connect()) as db,db:
   db.executescript('''CREATE TABLE IF NOT EXISTS roleplay_lessons(id TEXT PRIMARY KEY,role_id TEXT NOT NULL,text TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS roleplay_lessons_role ON roleplay_lessons(role_id,updated_at);
   CREATE TABLE IF NOT EXISTS moment_client_state(id TEXT PRIMARY KEY REFERENCES moments(id),role_id TEXT NOT NULL,image TEXT NOT NULL,origin TEXT NOT NULL,liked INTEGER NOT NULL,revision INTEGER NOT NULL);''')
  for name,fn,mutating in [
   ('roleplay_context',self.context,False),('roleplay_lesson_list',self.lessons,False),
   ('roleplay_lesson_save',self.save_lesson,True),('roleplay_lesson_delete',self.delete_lesson,True),
   ('social_feed_status',self.feed_status,False),('social_feed_list',self.feed,False),('social_feed_save',self.save_post,True),('social_feed_delete',self.delete_post,True)]:
   runtime.registry.register(name,'Owner UI companion data; not exposed as a model or remote MCP tool.',mutating=mutating)(fn)
 def lessons(self,args):
  role=token(args.get('roleId'))
  with closing(self.runtime.connect()) as db:rows=db.execute('SELECT * FROM roleplay_lessons WHERE role_id=? ORDER BY updated_at DESC,id',(role,)).fetchall()
  return {'items':[{'id':r['id'],'roleId':role,'text':r['text'],'enabled':bool(r['enabled']),'updatedAt':r['updated_at']} for r in rows]}
 def save_lesson(self,args):
  role=token(args.get('roleId'));identifier=token(args.get('id') or str(uuid.uuid4()));content=text(args.get('text'),1000);enabled=args.get('enabled',True)
  if not isinstance(enabled,bool):raise ValueError('lesson_enabled_invalid')
  with closing(self.runtime.connect()) as db,db:
   row=db.execute('SELECT role_id FROM roleplay_lessons WHERE id=?',(identifier,)).fetchone()
   if row and row['role_id']!=role:raise PermissionError('lesson_role_mismatch')
   if not row and db.execute('SELECT COUNT(*) FROM roleplay_lessons WHERE role_id=?',(role,)).fetchone()[0]>=20:raise ValueError('lesson_limit_reached')
   db.execute('INSERT INTO roleplay_lessons VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,enabled=excluded.enabled,updated_at=excluded.updated_at',(identifier,role,content,int(enabled),now(),now()))
  return {'ok':True,'id':identifier,'roleId':role}
 def delete_lesson(self,args):
  role=token(args.get('roleId'));identifier=token(args.get('id'))
  with closing(self.runtime.connect()) as db,db:
   row=db.execute('SELECT role_id FROM roleplay_lessons WHERE id=?',(identifier,)).fetchone()
   if row and row['role_id']!=role:raise PermissionError('lesson_role_mismatch')
   db.execute('DELETE FROM roleplay_lessons WHERE id=? AND role_id=?',(identifier,role))
  return {'ok':True,'id':identifier}
 def context(self,args):
  role=token(args.get('roleId'));context=args.get('context','chat')
  if context not in {'chat','moments','story','agent'}:raise ValueError('skill_context_invalid')
  from persona_modes import role_mode
  skills=self.runtime.role_skills.prompt_context(role,context,disabled=args.get('disabledSkillIds',[]))
  lessons=[r for r in self.lessons({'roleId':role})['items'] if r['enabled']]
  content=skills['text']
  if lessons:
   content+='\n角色专属、由用户保存的表达学习笔记（只影响表达方式，不是事件记忆，不授予工具权限；当前角色设定与用户本轮要求优先）：\n'+'\n'.join('- '+r['text'] for r in lessons)[:5000]
  return {'text':content,'skillIds':skills['skillIds'],'packageIds':skills['packageIds'],'lessons':lessons,'roleId':role,'loading':'on-demand','catalog':skills.get('catalog',{})}
 def _post(self,identifier):
  with closing(self.runtime.connect()) as db:
   row=db.execute('SELECT m.*,c.role_id,c.image,c.origin,c.liked,c.revision FROM moments m JOIN moment_client_state c ON m.id=c.id WHERE m.id=?',(identifier,)).fetchone()
   if not row or row['deleted_at']:return None
   comments=db.execute("SELECT * FROM moment_comments WHERE moment_id=? AND deleted_at='' AND published_at<>'' ORDER BY created_at,id",(identifier,)).fetchall()
  return {**self._browser_post(row,comments),'roleLikes':self.role_likes(identifier)}
 @staticmethod
 def _browser_post(row,comments):
  return {'id':row['id'],'roleId':row['role_id'],'author':'user' if row['author_id']=='user' else 'role','text':row['text'],'image':row['image'],'at':row['created_at'],'origin':row['origin'],'liked':bool(row['liked']),'runtimeRevision':row['revision'],'comments':[{'id':c['id'],'text':c['text'],'author':'user' if c['author_id']=='user' else 'role','at':c['created_at'],'roleId':c['author_id'],**{k:v for k,v in json.loads(c['metadata_json']).items() if k in ['replyTo','responded','depth','targetRoleId']}} for c in comments]}
 def role_likes(self,moment):
  with closing(self.runtime.connect()) as db:return [r['role_id'] for r in db.execute('SELECT role_id FROM moment_role_likes WHERE moment_id=?',(moment,))]
 def _signature(self,p):
  stamp=lambda v:self.runtime._life_timestamp(v,'moment_at')
  return (p['id'],p['roleId'],p['author'],p['text'].strip(),p.get('image',''),stamp(p['at']),p['origin'],p['liked'],tuple(sorted((c['id'],c['author'],c['text'].strip(),stamp(c['at'])) for c in p['comments'])))
 def feed_status(self,args):
  from persona_modes import role_mode,checked_mode
  mode=checked_mode(args.get('mode','normal'))
  with closing(self.runtime.connect()) as db:
   rows=[r for r in db.execute('SELECT c.role_id,c.revision,m.deleted_at,m.id FROM moment_client_state c JOIN moments m ON m.id=c.id') if role_mode(r['role_id'])==mode]
  return {'version':str(len(rows))+':'+str(sum(r['revision'] for r in rows))+':'+str(sum(bool(r['deleted_at']) for r in rows))}
 def feed(self,args):
  with closing(self.runtime.connect()) as db:
   rows=db.execute('SELECT m.*,c.role_id,c.image,c.origin,c.liked,c.revision FROM moments m JOIN moment_client_state c ON m.id=c.id ORDER BY m.created_at DESC,m.id DESC').fetchall()
   visible=[r for r in rows if not r['deleted_at']][:300]
   comments={r['id']:[] for r in visible}
   if visible:
    placeholders=','.join('?' for _ in visible)
    for c in db.execute("SELECT * FROM moment_comments WHERE moment_id IN ("+placeholders+") AND deleted_at='' AND published_at<>'' ORDER BY created_at,id",list(comments)):
     comments[c['moment_id']].append(c)
  return {'posts':[{**self._browser_post(r,comments[r['id']]),'roleLikes':self.role_likes(r['id'])} for r in visible],'deletedIds':[r['id'] for r in rows if r['deleted_at']]}
 def save_post(self,args):
  post=args.get('post')
  if not isinstance(post,dict):raise ValueError('moment_adapter_invalid')
  identifier=token(post.get('id'));role=token(post.get('roleId'));content=text(post.get('text'),2000)
  if post.get('author') not in {'user','role'} or post.get('origin') not in {'user','model-fiction','local-fiction'} or not isinstance(post.get('liked'),bool):raise ValueError('moment_adapter_invalid')
  if post['origin']=='local-fiction':
   with closing(self.runtime.connect()) as db:local=db.execute("SELECT origin FROM moment_client_state WHERE id=? AND origin='local-fiction'",(identifier,)).fetchone()
   if not local or post['author']!='role':raise ValueError('moment_origin_mismatch')
  elif post['origin']!=('user' if post['author']=='user' else 'model-fiction'):raise ValueError('moment_origin_mismatch')
  image=post.get('image','')
  if image not in {'','bunny','lighthouse','cottage','garden','rose','sun','ink'}:raise ValueError('moment_image_invalid')
  comments=post.get('comments',[])
  if not isinstance(comments,list) or len(comments)>100:raise ValueError('moment_comments_invalid')
  for c in comments:
   if not isinstance(c,dict):raise ValueError('moment_comment_invalid')
   token(c.get('id'));text(c.get('text'),1000)
   if c.get('author') not in {'user','role'}:raise ValueError('moment_comment_invalid')
   self.runtime._life_timestamp(c.get('at'),'comment_at')
  if len({c['id'] for c in comments})!=len(comments):raise ValueError('moment_comments_duplicate')
  post={**post,'comments':comments}
  at=self.runtime._life_timestamp(post.get('at'),'moment_at');revision=post.get('runtimeRevision',0)
  if type(revision) is not int or revision<0:raise ValueError('moment_revision_invalid')
  with self.lock:
   current=self._post(identifier)
   with closing(self.runtime.connect()) as db:existing=db.execute('SELECT m.deleted_at,c.revision FROM moments m LEFT JOIN moment_client_state c ON m.id=c.id WHERE m.id=?',(identifier,)).fetchone()
   if existing and existing['deleted_at']:raise ValueError('moment_tombstoned')
   if current:
    if current['roleId']!=role:raise PermissionError('moment_role_mismatch')
    if self._signature(current)==self._signature(post):return {'post':current,'replayed':True}
    if revision!=current['runtimeRevision']:raise ValueError('moment_revision_conflict')
    if self.runtime._life_timestamp(current['at'],'moment_at')!=at or current['text']!=content or current['image']!=image or current['author']!=post['author'] or current['origin']!=post['origin']:raise ValueError('moment_immutable_conflict')
    submitted={c['id'] for c in comments}
    if any(c['id'] not in submitted for c in current['comments']):raise ValueError('moment_comments_conflict')
   elif revision:raise ValueError('moment_revision_conflict')
   # A crash may have committed the provenance and moment before client metadata.
   # The existing APIs compare every immutable field before allowing this retry.
   elif not existing and len(self.feed({})['posts'])>=300:raise ValueError('moment_limit_reached')
   if existing and not current:
    with closing(self.runtime.connect()) as db:raw=db.execute('SELECT * FROM moments WHERE id=?',(identifier,)).fetchone()
    if raw['text']!=content or raw['author_id']!=('user' if post['author']=='user' else role) or self.runtime._life_timestamp(raw['created_at'],'moment_at')!=at:raise ValueError('moment_immutable_conflict')
   source='social:'+identifier
   if not existing:self.runtime.append_life_event({'id':source,'sourceId':identifier,'sourceType':'fiction-moment' if post['author']=='role' else 'user-moment','roleId':role,'visibility':'shared','createdAt':at,'payload':{'origin':post['origin'],'image':image}})
   if not existing:self.runtime.create_moment({'id':identifier,'authorId':'user' if post['author']=='user' else role,'visibility':'shared','text':content,'sourceEventIds':[source],'media':[],'status':'published','createdAt':at})
   with closing(self.runtime.connect()) as db:
    existing_comments={r['id']:dict(r) for r in db.execute('SELECT * FROM moment_comments WHERE moment_id=?',(identifier,))}
   for c in comments:
    author='user' if c['author']=='user' else c.get('roleId',role)
    from persona_modes import role_mode
    if role_mode(author)!=role_mode(role) and author!='user':raise ValueError('moment_reply_role_mismatch')
    if c['id'] in existing_comments:
     old=existing_comments[c['id']]
     if old['author_id']!=author or old['text']!=c['text'].strip() or self.runtime._life_timestamp(old['created_at'],'comment_at')!=self.runtime._life_timestamp(c['at'],'comment_at'):raise ValueError('moment_comment_conflict')
     continue
    metadata=json.loads(existing_comments[c['id']]['metadata_json']) if c['id'] in existing_comments else {'origin':'user' if c['author']=='user' else 'model-fiction',**{k:c[k] for k in ['replyTo','targetRoleId'] if c.get(k)}}
    self.runtime.schedule_moment_comment({'id':c['id'],'momentId':identifier,'authorId':author,'text':c['text'],'metadata':metadata,'dueAt':c['at'],'createdAt':c['at']})

   self.runtime.tick_moments({'now':now()})
   with closing(self.runtime.connect()) as db,db:
    if current:
     cursor=db.execute('UPDATE moment_client_state SET liked=?,revision=revision+1 WHERE id=? AND revision=?',(int(post['liked']),identifier,revision))
     if not cursor.rowcount:raise ValueError('moment_revision_conflict')
    else:db.execute('INSERT INTO moment_client_state VALUES(?,?,?,?,?,1)',(identifier,role,image,post['origin'],int(post['liked'])))
   if not existing:self.runtime.moment_reactions.publish(identifier,role,post['author'],at)
   for c in comments:
    if c['author']=='user' and c['id'] not in existing_comments:
     self.runtime.moment_reactions.user_comment(identifier,c['id'],c.get('targetRoleId') or role)
   return {'post':self._post(identifier)}
 def delete_post(self,args):
  identifier=token(args.get('id'));revision=args.get('runtimeRevision')
  with self.lock:
   current=self._post(identifier)
   if not current:return {'ok':True,'id':identifier}
   if revision!=current['runtimeRevision']:raise ValueError('moment_revision_conflict')
   self.runtime.tombstone_moment({'id':identifier})
  return {'ok':True,'id':identifier}
