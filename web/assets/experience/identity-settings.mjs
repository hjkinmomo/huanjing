import '../shared-state.js';
import {roleMode,baseRoleId} from './persona-modes.mjs';
import {readState,changeState} from './state.mjs';
const shared=globalThis.HermesSharedState;
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const PROFILE_FIELDS={name:60,preferredAddress:60,preferences:800,boundaries:800};
export const RELATIONSHIP_FIELDS={label:60,nickname:60,origin:1000,dynamic:1000,boundaries:800,userPersona:2000};
function fields(source,limits){return Object.fromEntries(Object.keys(limits).map(key=>{if(source?.[key]!==undefined&&typeof source[key]!=='string')throw Error('个人或关系资料格式异常，原内容未覆盖。');return [key,source?.[key]||''];}));}
export function beginIdentity(source,roleId){
  if(!/^[-\w:.]{1,80}$/.test(roleId||'') || source.userProfile!==undefined&&!record(source.userProfile) || source.relationshipProfiles!==undefined&&!record(source.relationshipProfiles))throw Error('个人或关系资料格式异常，原内容未覆盖。');
  const relationship=source.relationshipProfiles?.[roleId];if(relationship!==undefined&&!record(relationship))throw Error('关系资料格式异常。');
  const profile=source.userProfiles?source.userProfiles[roleId]:roleMode(roleId)==='special'?null:source.userProfile;
  const base={user:{...fields(profile,PROFILE_FIELDS),shareWithModel:profile?.shareWithModel===true},relationship:{...fields(relationship,RELATIONSHIP_FIELDS),stage:relationship?.stage||'',emotionState:relationship?.emotionState||'auto'}};
  return {roleId,base,values:structuredClone(base)};
}
export function prepareIdentity(source,draft){
  if(baseRoleId(draft.roleId||'').startsWith('custom-')&&!(source.customRoles||[]).some(r=>r.id===draft.roleId||r.id===baseRoleId(draft.roleId)))throw Error('这位自设角色已移除，未写入关系资料。');
  const current=beginIdentity(source,draft.roleId).base,next=structuredClone(source),changed=[];
  for(const group of ['user','relationship'])for(const [key,limit]of Object.entries(group==='user'?{...PROFILE_FIELDS,shareWithModel:null}:{...RELATIONSHIP_FIELDS,stage:null,emotionState:null})){
    const value=draft.values?.[group]?.[key];if(value===draft.base?.[group]?.[key])continue;
    if(key==='shareWithModel'?typeof value!=='boolean':key==='emotionState'?!['auto','calm','bright','warm','thoughtful','reserved'].includes(value):key==='stage'?!['','new','familiar','trusted','intimate'].includes(value):typeof value!=='string'||value.length>limit)throw Error('请检查资料长度与关系阶段。');
    if(current[group][key]!==draft.base?.[group]?.[key]&&current[group][key]!==value)throw Error('这项资料已在其他窗口修改。草稿已保留，请重新载入后对照。');
    if(current[group][key]===value)continue;
    if(group==='user'){next.userProfiles||={};next.userProfiles[draft.roleId]||=roleMode(draft.roleId)==='special'?{}:{...source.userProfile};next.userProfiles[draft.roleId][key]=value;}
    else {next.relationshipProfiles||={};next.relationshipProfiles[draft.roleId]||={};next.relationshipProfiles[draft.roleId][key]=value;}
    changed.push(`${group}.${key}`);
  }
  return {state:next,changed};
}
export async function saveIdentity(storage,locks,draft){return shared.exclusive(locks,()=>{const snapshot=shared.read(storage);if(snapshot.recovered)throw Error('资料来自恢复快照，请先恢复后保存。');const result=prepareIdentity(snapshot.state,draft);if(!result.changed.length)return {...result,warning:''};const saved=shared.commit(storage,snapshot,result.state,new Date().toISOString());return {...result,...saved,warning:saved.warning.replace('赠礼','个人与关系资料')};});}
export function mountIdentity({form,getRole,onChange,storage=localStorage,locks=navigator.locks}){
  let draft=null,expected=null,busy=false;const feedback=form.querySelector('[data-identity-feedback]');
  const stored=id=>readState(storage).identityDrafts?.[id]||null;
  function fill(){for(const input of form.elements){const [group,key]=(input.name||'').split('.');if(!key)continue;const value=draft.values[group][key];if(input.type==='checkbox')input.checked=value===true;else input.value=value;}form.querySelector('[data-identity-role]').textContent=`你与${getRole().name}的关系`;}
  function collect(){for(const input of form.elements){const [group,key]=(input.name||'').split('.');if(key)draft.values[group][key]=input.type==='checkbox'?input.checked:input.value;}}
  function persist(next){changeState(storage,s=>{s.identityDrafts||={};if(JSON.stringify(s.identityDrafts[draft.roleId]||null)!==JSON.stringify(expected))throw Error('另一窗口更新了资料草稿。当前输入仍在页面，请先复制保留。');if(next)s.identityDrafts[draft.roleId]=structuredClone(next);else delete s.identityDrafts[draft.roleId];});expected=next?structuredClone(next):null;}
  function open(){try{const id=getRole().id;expected=structuredClone(stored(id));draft=structuredClone(expected||beginIdentity(shared.read(storage).state,id));draft.values.relationship.emotionState??='auto';draft.base.relationship.emotionState??='auto';fill();feedback.textContent=expected?'草稿已恢复，尚未应用。':'';}catch(e){feedback.textContent=e.message;}}
  form.oninput=()=>{if(!draft||busy)return;try{collect();persist(draft);feedback.textContent='草稿已保留，尚未应用。';}catch(e){feedback.textContent=e.message;}};
  form.querySelector('[data-identity-reload]').onclick=()=>{try{persist(null);open();}catch(e){feedback.textContent=e.message;}};
  form.onsubmit=async e=>{e.preventDefault();if(!draft||busy)return;collect();busy=true;const controls=[...form.elements];controls.forEach(n=>n.disabled=true);try{const result=await saveIdentity(storage,locks,structuredClone(draft));onChange(result.state);let warning=result.warning;try{persist(null);}catch{warning='资料已保存，草稿未清理；可重新载入查看。';}open();feedback.textContent=warning||'资料已保存，将用于之后发送的消息。';}catch(err){feedback.textContent=err.message;}finally{busy=false;controls.forEach(n=>n.disabled=false);}};
  return {open,pending:()=>busy};
}
