import '../shared-state.js';
import {modeRoleRecord} from './persona-modes.mjs';
import {readState,changeState} from './state.mjs';
const shared=globalThis.HermesSharedState;
const record=value=>value && typeof value==='object' && !Array.isArray(value);
export const EDIT_FIELDS={persona:['人格与经历',8000],personality:['性格与偏好',4000],speechStyle:['说话方式',4000],exampleMode:['示例对白方式',20],dialogueExamples:['自定义示例对白',4000],scenario:['当前情境',2000],greeting:['开场白',2000],systemPrompt:['角色系统提示词',8000],postHistoryInstructions:['后置表达指令',4000],emotionGuidance:['情感表达规则',2000],expressionMode:['本轮表达辅助',20],roleSkillMode:['预置扮演规则',20]};
function cardFor(source,catalog,id) {
  if(source.roleCards!==undefined && !record(source.roleCards))throw new Error('角色资料格式异常，原内容未改动。');
  const {role,card}=modeRoleRecord(source,catalog,id);
  if(!record(card))throw new Error('角色卡格式异常，原内容未改动。');
  return {role,card};
}
function fieldsFrom(card) {
  return Object.fromEntries(Object.keys(EDIT_FIELDS).map(key=>{
    if(card[key]!==undefined && typeof card[key]!=='string')throw new Error('角色文字格式异常，原内容未改动。');
    return [key,card[key] || (['expressionMode','roleSkillMode','exampleMode'].includes(key)?'inherit':'')];
  }));
}
export function beginRoleEdit(source,catalog,id) {
  const {role,card}=cardFor(source,catalog,id),base=fieldsFrom(card);
  return {roleId:id,name:role.name,base,values:{...base}};
}
export function changedFields(draft) {
  if(!record(draft?.base) || !record(draft?.values))throw new Error('编辑草稿格式异常，未覆盖原资料。');
  return Object.keys(EDIT_FIELDS).filter(key=>Object.hasOwn(draft.values,key)&&draft.values[key]!==draft.base[key]);
}
export function prepareRoleEdit(source,catalog,draft) {
  const {card}=cardFor(source,catalog,draft.roleId),current=fieldsFrom(card),changed=changedFields(draft);
  for(const key of changed) {
    const [label,max]=EDIT_FIELDS[key],value=draft.values[key];
    if((key==='expressionMode'&&!['inherit','adaptive','off'].includes(value)) || (key==='roleSkillMode'&&!['inherit','off'].includes(value)))throw new Error('请选择有效的角色表达方式。');
    if(key==='exampleMode'&&!['inherit','custom','off'].includes(value))throw new Error('请选择有效的示例对白方式。');
    if(typeof value!=='string' || value.length>max || (key==='persona'&&!value.trim()))throw new Error(`请检查“${label}”：${key==='persona'?'不能为空，且':''}最多 ${max} 字。`);
    if(current[key]!==draft.base[key] && current[key]!==value)throw Object.assign(new Error(`“${label}”已在其他页面修改。你的草稿仍保留，请对照后决定。`),{code:'role_conflict'});
  }
  const updates=changed.filter(key=>current[key]!==draft.values[key]);
  if(!updates.length)return {state:source,changed:[]};
  const next=structuredClone(source);next.roleCards ||= {};
  // Patch only edited fields onto the latest card: retain lore, media and extension fields.
  next.roleCards[draft.roleId]={...structuredClone(card),...Object.fromEntries(updates.map(key=>[key,draft.values[key]]))};
  return {state:next,changed:updates};
}
export function rebaseRoleEdit(source,catalog,draft) {
  const fresh=beginRoleEdit(source,catalog,draft.roleId);
  for(const key of changedFields(draft))fresh.values[key]=draft.values[key];
  return fresh;
}
export async function saveRoleEdit(storage,locks,catalog,draft) {
  return shared.exclusive(locks,()=>{
    const snapshot=shared.read(storage);
    if(snapshot.recovered)throw new Error('当前资料来自恢复快照，请先在旧入口恢复，再保存角色。');
    const result=prepareRoleEdit(snapshot.state,catalog,draft);
    if(!result.changed.length)return {...result,warning:''};
    const saved=shared.commit(storage,snapshot,result.state,new Date().toISOString());
    return {...result,...saved,warning:saved.warning.replace('赠礼','角色资料')};
  });
}
export function readEditDraft(storage,id) {
  const drafts=readState(storage).roleEditDrafts;
  if(drafts!==undefined && !record(drafts))throw new Error('编辑草稿格式异常，未覆盖。');
  const draft=drafts?.[id];
  if(draft){if(draft.roleId!==id)throw new Error('草稿与角色不匹配，未覆盖。');changedFields(draft);}
  return draft || null;
}
// Compare only this role's draft; other roles and chat drafts can update independently.
export function writeEditDraft(storage,id,expected,next) {
  return changeState(storage,state=>{
    if(state.roleEditDrafts!==undefined && !record(state.roleEditDrafts))throw new Error('编辑草稿格式异常，未覆盖。');
    state.roleEditDrafts ||= {};
    if(JSON.stringify(state.roleEditDrafts[id] || null)!==JSON.stringify(expected))throw new Error('另一个窗口更新了这位角色的草稿。当前文字仍在页面，请先复制保留，再重新打开。');
    if(next)state.roleEditDrafts[id]=structuredClone(next);else delete state.roleEditDrafts[id];
  });
}
