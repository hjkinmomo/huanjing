import '../shared-state.js';
import {roleMode} from './persona-modes.mjs';
import {readState} from './state.mjs';
const shared=globalThis.HermesSharedState;
export const ROLE_BACKUP_KEY='hermes_project5_experience_roles_backup_v1';
const record=value=>value && typeof value==='object' && !Array.isArray(value);
const builtInNames=['希拉','可卡','书韵','六花','雷姆'];
function commitRoles(storage,snapshot,state,at) {
  const result=shared.commit(storage,snapshot,state,at);
  return {...result,warning:result.warning.replace('赠礼','角色资料')};
}
function validateRole(role) {
  if(!record(role) || !/^(?:special\.)?custom-[a-z0-9_-]{1,57}$/.test(role.id) || !role.name?.trim() || role.name.length>40 || !record(role.card))throw new Error('角色格式与旧版不兼容，原资料已保留。');
}
export function prepareRoles(source,incoming,{at,origin='migration'}={}) {
  if(!Array.isArray(incoming) || (source.customRoles!==undefined && !Array.isArray(source.customRoles)))throw new Error('角色列表格式异常，未修改资料。');
  for(const key of ['roleCards','experienceRoleImports'])if(source[key]!==undefined && !record(source[key]))throw new Error('角色记录格式异常，未修改资料。');
  const next=structuredClone(source);next.customRoles ||= [];next.roleCards ||= {};next.experienceRoleImports ||= {};
  const added=[];
  for(const role of incoming) {
    validateRole(role);
    const receipt=next.experienceRoleImports[role.id];
    if(receipt) {
      if(receipt.original!==JSON.stringify(role))throw new Error(`“${role.name}”的旧副本发生变化，需要手动核对，未覆盖共同资料。`);
      // A previously shared role deleted in the old editor must never be resurrected.
      if(origin==='create' && !next.customRoles.some(item=>item.id===role.id))throw new Error('该角色已被删除，请修改草稿后重新创建。');
      continue;
    }
    if(next.customRoles.some(item=>item.id===role.id) || Object.hasOwn(next.roleCards,role.id))throw new Error(`“${role.name}”的编号与现有资料冲突，未覆盖。`);
    if([...builtInNames,...next.customRoles.filter(item=>roleMode(item.id)===roleMode(role.id)).map(item=>item.name)].some(name=>String(name).trim().toLocaleLowerCase()===role.name.trim().toLocaleLowerCase()))throw new Error(`已有同名角色“${role.name}”，请先核对两份资料。`);
    if(next.customRoles.filter(item=>roleMode(item.id)===roleMode(role.id)).length>=12)throw new Error('共同角色库最多保存 12 个自建角色，原资料已保留。');
    const {card,...identity}=structuredClone(role);
    next.customRoles.push({...identity,custom:true});
    next.roleCards[role.id]=card;
    next.experienceRoleImports[role.id]={original:JSON.stringify(role),at,origin};
    added.push(role.id);
  }
  return {state:next,added};
}
function backupRoles(storage,roles) {
  const raw=storage.getItem(ROLE_BACKUP_KEY);
  let archive;
  try{archive=raw?JSON.parse(raw):{schema:1,versions:[]};}catch{throw new Error('角色备份无法读取，未开始迁移。');}
  if(archive.schema!==1 || !Array.isArray(archive.versions))throw new Error('角色备份格式异常，未开始迁移。');
  const original=JSON.stringify(roles);
  if(!archive.versions.some(version=>version.original===original)) {
    archive.versions.push({at:new Date().toISOString(),original});
    const serialized=JSON.stringify(archive);storage.setItem(ROLE_BACKUP_KEY,serialized);
    if(storage.getItem(ROLE_BACKUP_KEY)!==serialized)throw new Error('角色备份校验失败，未开始迁移。');
  }
}
export async function sharePendingRoles(storage,locks) {
  const initial=readState(storage),snapshot=shared.read(storage);
  const pending=initial.roles.filter(role=>!snapshot.state.experienceRoleImports?.[role.id]);
  if(!pending.length)return {state:snapshot.state,added:[],warning:''};
  return shared.exclusive(locks,()=>{
    const current=shared.read(storage),ui=readState(storage),at=new Date().toISOString();
    const result=prepareRoles(current.state,ui.roles,{at});
    if(!result.added.length)return {...result,warning:''};
    if(current.recovered)throw new Error('请先恢复原资料，再迁移角色。');
    backupRoles(storage,ui.roles);
    return {...result,...commitRoles(storage,current,result.state,at)};
  });
}
export async function saveSharedRole(storage,locks,role) {
  return shared.exclusive(locks,()=>{
    const snapshot=shared.read(storage),at=new Date().toISOString();
    if(snapshot.recovered)throw new Error('请先恢复共同资料，再创建角色。');
    const result=prepareRoles(snapshot.state,[role],{at,origin:'create'});
    if(!result.added.length)return {...result,warning:''};
    return {...result,...commitRoles(storage,snapshot,result.state,at)};
  });
}
