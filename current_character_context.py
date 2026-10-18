"""Current, role-private facts for every chat transport, independent of skills."""
from contextlib import closing
from datetime import datetime
import json

def current_character_note(runtime,role,session):
 if not role or not session or session==f'role:{role}:primary':return ''
 with closing(runtime.connect()) as db:
  row=db.execute("SELECT s.mode,COALESCE(o.memory_policy,'normal') policy FROM role_sessions s LEFT JOIN chat_session_options o ON o.role_id=s.role_id AND o.session_id=s.session_id WHERE s.role_id=? AND s.session_id=? AND s.deleted_at=''",(role,session)).fetchone()
 if not row or row['mode']!='character' or row['policy']=='readonly':return ''
 life=runtime.world_life.get({'roleId':role,'sessionId':session})
 if not life.get('enabled'):return ''
 facts={'now':life['worldTime'],'worldUtc':life['worldUtc'],'location':life['character']['name'][:70],'activity':life['character']['activity'][:90]}
 if life.get('coLocated'):
  facts['userLocation']=life['user']['name'][:100];facts['sameRoom']=life['user']['locationId']==life['character']['locationId']
 if life.get('enRoute'):facts['enRoute']={k:life['enRoute'].get(k) for k in ['destination','dueAt']}
 living=life.get('living',{});outline=living.get('outline',{});goal=outline.get('goal','')
 step=next((s for s in outline.get('steps',[]) if s.get('status')=='active'),None) or next((s for s in outline.get('steps',[]) if s.get('status') in ['planned','reconsider']),None)
 if goal:facts['ownGoal']=goal[:180]
 if step:facts['ownNextStep']={'text':step.get('text','')[:140],'status':step.get('status')}
 plan=runtime.world_life.agenda.model_note(role,session)
 if plan:facts['ownPlan']=plan[:240]
 orders=[o for o in life.get('deliveries',[]) if o.get('roleId')==role and o.get('sessionId')==session and o.get('status')=='delivered' and o.get('deliveredWorldAt')]
 if orders:
  meal=max(orders,key=lambda o:o['deliveredWorldAt']);at=meal['deliveredWorldAt'];minutes=max(0,int((datetime.fromisoformat(life['worldUtc'])-datetime.fromisoformat(at.replace('Z','+00:00'))).total_seconds()/60))
  facts['pastDelivery']={'receivedAt':at,'elapsedMinutes':minutes,'items':[str(i.get('name') or i.get('title') or '')[:24] for i in meal.get('items',[])[:2]],'eatingStatus':'not-recorded'}
 text=json.dumps(facts,ensure_ascii=False,separators=(',',':'))
 return '[current-character-world-v1] 当前角色自己的实时账本，优先于旧聊天里当时的状态：\n'+text+'\n同一住宅不等于同一房间，sameRoom=false 时不能直接描写触碰或双方已经一起进入另一个房间。用户在同场景内的具体房间以 userLocation 为准；是否实际看见或听见仍结合场景，不能凭位置读心。世界时间已前进；旧聊天的等待、收货和食物温度不是现在事实。收货不等于此刻还未吃，隔夜不能仍说刚送到、一直热着或无期限等人。没有新约定就按自己的作息继续生活。目标和下一步是真实计划依据，可自主调整；没有执行记录不能声称目标已完成。只知道本角色的资料，不得推断其他角色私聊。'

def add_current_character_context(runtime,body,role,options):
 if not isinstance(options,dict) or options.get('context','chat')!='chat':return body
 note=current_character_note(runtime,role,options.get('sessionId'))
 if not note:return body
 messages=[dict(m) for m in body['messages'] if not (m.get('role')=='system' and m.get('content','').startswith('[current-character-world-v1]'))]
 # The freshest system note follows historical context and precedes this turn.
 index=len(messages)-1 if messages and messages[-1].get('role')=='user' else len(messages)
 messages.insert(index,{'role':'system','content':note})
 return {**body,'messages':messages}
