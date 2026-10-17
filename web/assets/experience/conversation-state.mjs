import {roleMode,baseRoleId} from './persona-modes.mjs';
import {DEFAULT_CONTEXT_WINDOW} from './token-budget.mjs';
export const primarySession=id=>`role:${id}:primary`;
export const conversationKey=(id,session=primarySession(id))=>session===primarySession(id)?id:`conversation:${session}`;
export function activeSession(state,id){return state.activeSessions?.[id]||{roleId:id,sessionId:primarySession(id),title:'之前的聊天',mode:'character'};}
export function privateSettings(legacy,state,id){return {contextWindow:DEFAULT_CONTEXT_WINDOW,...(state.agentSettings?.[id]||{...legacy.settings,...state.settings})};}
export function privateSource(source,id,context={}){
 const next={...source,typedMemories:{...source.typedMemories},runtimeSummaries:{[id]:context.summaries||[]}};
 const normalize=text=>String(text||'').toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]/gu,''),excluded=new Set((context.excludedTexts||[]).map(normalize));
 const local=(source.typedMemories?.[id]||[]).filter(m=>!excluded.has(normalize(m.text))),ids=new Set(local.map(m=>m.id));next.typedMemories[id]=[...local,...(context.memories||[]).filter(m=>!ids.has(m.id))];
 return next;
}
export function initializeAgents(state,legacy,roles,currentId){
 state.agentSettings||={};
 const defaults={replyStyle:'natural',memoryContext:true,roleSkills:true,replyStickers:true,replyNarration:'scene',contextCompression:true,contextBudget:24000,contextWindow:DEFAULT_CONTEXT_WINDOW};
 const permitted=['baseUrl','model','thinking','temperature','maxTokens','replyStyle','memoryContext','roleSkills','replyStickers','replyNarration','contextCompression','contextBudget','contextWindow'];
 const old={...legacy.settings,...state.settings};
 for(const role of roles)if(!state.agentSettings[role.id]){const source=roleMode(role.id)==='special'?Object.fromEntries(['baseUrl','model','thinking','temperature','maxTokens','contextWindow'].filter(k=>state.agentSettings[baseRoleId(role.id)]?.[k]!==undefined).map(k=>[k,state.agentSettings[baseRoleId(role.id)][k]])):old;state.agentSettings[role.id]={...defaults,...Object.fromEntries(permitted.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]))};}
 state.activeSessions||={};
}
