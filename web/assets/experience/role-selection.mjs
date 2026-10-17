export function chosenRoleIds(state){
 const ids=new Set(Object.keys(state.selectedRoles||{}));
 for(const [id,s]of Object.entries(state.activeSessions||{}))if(s?.mode!=='assistant'&&s?.sessionId&&s.sessionId!==`role:${id}:primary`)ids.add(id);
 for(const [id,at]of Object.entries(state.rosterCreated||{}))if(Number(at)>0)ids.add(id);
 return ids;
}
export function chooseRole(state,id,at=Date.now()){state.selectedRoles||={};state.selectedRoles[id]||=at;state.currentRole=id;return state;}
export function initializeRoleSelection(state){state.roleSelectionVersion=1;state.selectedRoles||={};for(const id of chosenRoleIds(state))state.selectedRoles[id]||=state.rosterCreated?.[id]||Date.now();return state;}
export function selectedRoleForView(state,roles){const chosen=chosenRoleIds(state),available=new Set(roles.map(r=>r.id));if(chosen.has(state.currentRole)&&available.has(state.currentRole))return state.currentRole;return [...chosen].filter(id=>available.has(id)).sort((a,b)=>(state.rosterCreated?.[b]||state.selectedRoles?.[b]||0)-(state.rosterCreated?.[a]||state.selectedRoles?.[a]||0))[0]||null;}
