import {chosenRoleIds} from './role-selection.mjs';
import {activeSession,conversationKey} from './conversation-state.mjs';
import {mergedMessages} from './state.mjs';
import {rolePersonaReady} from './role-readiness.mjs';

// Presentation only. Full owner IDs and session keys also apply in special mode.
function preview(text){return String(text||'').replace(/\[\[scene-state\]\][\s\S]*?\[\[\/scene-state\]\]/g,'').replace(/\[\[sticker:[a-z]+\]\]/g,'[表情]').replace(/\[\[user-sticker:[a-z-]+\]\]/g,'[表情]').replace(/\[\[\/?(?:scene|inner)\]\]/g,'').replace(/[\r\n]+/g,' ').trim().slice(0,70);}
export function roleRosterSnapshot({roles,state,legacy={},historyCache=new Map(),busy=new Set(),sendErrors=new Map(),safeMedia=v=>v}){
 const selected=chosenRoleIds(state);
 return roles.filter(role=>state.roleSelectionVersion!==1||selected.has(role.id)).map((role,index)=>{
  const session=activeSession(state,role.id),key=conversationKey(role.id,session.sessionId);
  const messages=mergedMessages(legacy,state,historyCache.get(key)||[],role.id,session.sessionId).filter(m=>m.tone!=='binding-application'),last=messages.at(-1);
  const draft=String(state.drafts?.[key]||'').trim(),running=busy.has(key),unread=!!state.unreadReplies?.[key];
  const status=running?'正在回复…':unread?'有新回复':draft?'草稿 · '+preview(draft):sendErrors.has(key)?'回复未完成 · 点击查看':!rolePersonaReady({...role,card:legacy.roleCards?.[role.id]||role.card})?'人格待填写':last?(last.from==='user'?'你：':'')+preview(last.text):'开始一段对话';
  const activity=messages.reduce((latest,m)=>Math.max(latest,Number.isFinite(Date.parse(m.at||m.createdAt))?Date.parse(m.at||m.createdAt):0),state.rosterActivity?.[role.id]||0);
  const established=(state.rosterCreated?.[role.id]||0)>0||!!state.activeSessions?.[role.id]&&session.mode==='character'&&session.sessionId!==`role:${role.id}:primary`;const created=established?(state.rosterCreated?.[role.id]||Date.parse(session.createdAt||'')||0):0;
  return {opened:created,id:role.id,name:role.name,avatar:safeMedia(role.avatar),busy:running,unread,status,online:established,activity,index};
 }).sort((a,b)=>Number(b.online)-Number(a.online)||b.opened-a.opened||a.index-b.index);
}
export function recordRosterCompletion(state,key,{currentKey,chatVisible}){
 const last=state.messages?.[key]?.at(-1);
 if(!last||last.from!=='role'||last.syncPending||!last.inReplyTo)return;
 const user=state.messages[key].find(m=>m.id===last.inReplyTo);
 if(user?.replyState!=='received')return;
 if(chatVisible&&key===currentKey){if(state.unreadReplies)delete state.unreadReplies[key];return;}
 state.unreadReplies||={};state.unreadReplies[key]=last.id;
}

export function recordRosterActivity(state,owner,key){
 if(!owner)return;const at=(state.messages?.[key]||[]).filter(m=>!m.synthetic&&!m.demoReply).reduce((latest,m)=>Math.max(latest,Number.isFinite(Date.parse(m.at||m.createdAt))?Date.parse(m.at||m.createdAt):0),0);
 if(at){state.rosterActivity||={};state.rosterActivity[owner]=Math.max(state.rosterActivity[owner]||0,at);}
}
