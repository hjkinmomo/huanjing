import apps from './phone-apps.json' with {type:'json'};
import {replyParts} from './reply-parts.mjs';
import {conversationKey} from './conversation-state.mjs';
export const PHONE_APPS=Object.freeze(apps.filter(a=>a.enabled!==false).map(a=>Object.freeze(a)));
export const PHONE_GAMES=Object.freeze([
 {id:'memory',name:'记忆花园',note:'翻牌配对',image:'/assets/experience/media/memory.png'},
 {id:'tiles',name:'2048',note:'滑动合并',image:'/assets/experience/media/tiles.png'},
 {id:'puzzle',name:'拼图小憩',note:'挑选图画',image:'/assets/experience/media/puzzle.png'},
 {id:'lights',name:'熄灯晚安',note:'九格灯阵',image:'/assets/experience/media/lights.png'},
 {id:'klotski',name:'木间华容道',note:'木块推演',image:'/assets/experience/media/expression-art-v1/klotski-entry.png'},
 {id:'flight',name:'星港守卫',note:'飞机与外星人',image:'/assets/experience/media/arcade-v2/flight.png'},
 {id:'snake',name:'青庭贪吃蛇',note:'转向采果',image:'/assets/experience/media/arcade-v2/snake.png'},
 {id:'piano',name:'星音琴房',note:'乐器与旋律',image:'/assets/experience/media/expression-art-v1/piano-entry.png'}
].map(Object.freeze));
export function phoneReplyParts(text,roleId='',streaming=false){
 const result=[];
 for(const part of replyParts(text.replace(/\[\[binding:[A-Za-z0-9_.:-]+:(?:accept|decline|revoke)\]\]/g,''),roleId,streaming,true)){
  if(part.kind==='sticker'){result.push(part);continue;}
  if(part.kind!=='text')continue;
  // Markdown/code remain one complete unit; plain dialogue breaks at sentence
  // endings, never mid-word, inside a URL or between a decimal number.
  if(/[`*_\[\]<>|]|https?:\/\/|(^|\n)\s*[-#]/.test(part.text)){result.push(part);continue;}
  const sentences=part.text.match(/[^。！？!?；;\n]+[。！？!?；;]*|[^\n]+$/gu)||[];
  for(const sentence of sentences){const value=sentence.trim();if(value)result.push({...part,text:value});}
 }
 return result;
}
export function phoneMessages(messages){return messages.filter(m=>m.channel==='phone'&&m.tone!=='binding-application');}
export function offlineMessages(messages){return messages.filter(m=>m.channel!=='phone'&&m.tone!=='binding-application');}
export function phoneReplyOwner(state,key,sessions=new Map()){
 for(const [owner,item] of [...sessions,...Object.entries(state.activeSessions||{})])if(item?.sessionId&&conversationKey(owner,item.sessionId)===key)return owner;
 return key.startsWith('conversation:')?null:key;
}
export function phoneUnreadSession(state,owner,historyCache=new Map()){
 const candidates=Object.entries(state.phoneUnreadReplies||{}).filter(([key,id])=>id===owner&&(key===owner||/^conversation:[A-Za-z0-9_.:-]{1,160}$/.test(key)));
 const at=key=>[...(state.messages?.[key]||[]),...(historyCache.get(key)||[])].filter(m=>m.channel==='phone'&&m.from!=='user'&&m.sender!=='user').reduce((latest,m)=>Math.max(latest,Date.parse(m.createdAt||m.at)||0),0);
 candidates.sort(([a],[b])=>at(b)-at(a));
 const key=candidates[0]?.[0];return key?{key,sessionId:key===owner?`role:${owner}:primary`:key.slice('conversation:'.length)}:null;
}
export function gameLaunchChoice(active,kind){
 if(!PHONE_GAMES.some(g=>g.id===kind))throw Error('这款游戏尚未开放。');
 if(kind==='piano')return 'open';
 if(active?.status==='playing')return active.kind===kind?'resume':'confirm';
 return 'start';
}
