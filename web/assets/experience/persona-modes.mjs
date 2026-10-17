// Public edition contains ordinary role data only.
export const SPECIAL_PREFIX='special.';
export const personaMode=()=> 'normal';
export const modeLabel=()=> '普通模式';
export const roleMode=id=>String(id).startsWith(SPECIAL_PREFIX)?'special':'normal';
export const baseRoleId=id=>roleMode(id)==='special'?id.slice(SPECIAL_PREFIX.length):id;
export const roleInMode=(id,mode='normal')=>mode==='normal'&&roleMode(id)==='normal';
export function modeSessionFromHash(hash,mode){
 const [path,query]=String(hash).split('?'),[,page,id,session]=path.split('/');
 if(page!=='chat'||!id||!session)return null;
 try{const roleId=decodeURIComponent(id),sessionId=decodeURIComponent(session);
  if(!roleInMode(roleId,mode)||!sessionId.startsWith(`role:${roleId}:`))return null;
  return {roleId,sessionId,mode:new URLSearchParams(query).get('mode')==='assistant'?'assistant':'character',title:'聊天'};
 }catch{return null;}
}

export function specialRoleId(){throw Error('此公开版仅包含普通模式。');}
export function modeRoles(roles,source,mode='normal'){
 if(mode!=='normal')throw Error('此公开版仅包含普通模式。');
 return roles.filter(r=>roleMode(r.id)==='normal');
}
export function modeRoleRecord(source,catalog,id){
 if(roleMode(id)!=='normal')throw Error('此公开版不包含该人格资料。');
 const role=(source.customRoles||[]).find(r=>r.id===id)||catalog.roles.find(r=>r.id===id);
 if(!role)throw Error('这个角色已不在资料中。草稿保留，未覆盖。');
 return {role,card:source.roleCards?.[id]||role.card||catalog.cards?.[id]||{}};
}
export function modeCreation(fields,mode='normal'){
 if(mode!=='normal')throw Error('此公开版仅包含普通模式。');
 return {...fields,personaMode:'normal'};
}
export function switchPersonaMode(state,next){
 if(next!=='normal')throw Error('此公开版仅包含普通模式。');
 state.settings.personaMode='normal';
}
