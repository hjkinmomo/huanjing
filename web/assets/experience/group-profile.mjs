import {modelMessagePlan} from './state.mjs';
import {idleProfile} from './auto-moments.mjs';
// Rebuild from the authored persona. Never reuse the private idle reference block.
export function groupPersonaProfile(role,settings,source={}){
 const clean={roleCards:{[role.id]:source.roleCards?.[role.id]||role.card||{}}};
 const plan=modelMessagePlan(role,[],'',clean,{...settings,chatMode:'character',replyNarration:'off',replyStickers:false,memoryContext:false,conversationOpening:null,sessionScene:null,sceneTracking:false,worldStatePrompt:''});
 return idleProfile(settings,plan.messages.filter(m=>m.role==='system'),{name:role.name,roleHelpers:false});
}
// Configure only members selected for this turn, matching the server's @ rule.
export function groupResponseMembers(members,args={}){
 if(args.mentionIds?.length)return members.filter(m=>m.roleId===args.mentionIds[0]);
 const named=members.map(m=>{const escaped=m.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=new RegExp('@'+escaped+'(?:\\s|[，,：:。!?！？]|$)').exec(args.text||'');return {member:m,at:match?.index??Infinity};}).sort((a,b)=>a.at-b.at);
 return named[0]?.at<Infinity?[named[0].member]:members;
}
