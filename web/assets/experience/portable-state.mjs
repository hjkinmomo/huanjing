import {LEGACY_KEY,STATE_KEY} from './state.mjs';
import {RECORDING_KEY} from './piano-core.mjs';
const sanitize=value=>Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!(/api.?key|secret|password|authorization|token$/i.test(k)||['__proto__','prototype','constructor'].includes(k))).map(([k,v])=>[k,sanitize(v)])):value;
const encode=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
export async function recoverPortableState(api,storage=localStorage){
 const saved=await api.tool('client_workspace_get',{});
 const localState=JSON.parse(storage.getItem(STATE_KEY)||'null'),localLegacy=JSON.parse(storage.getItem(LEGACY_KEY)||'{}');
 const latest=payload=>Math.max(Date.parse(payload?.experience?.updatedAt)||0,Date.parse(payload?.legacy?.persistence?.lastSavedAt)||0,Date.parse(payload?.legacy?.pianoRoom?.updatedAt)||0);
 const restore=saved.payload&&(saved.payload.experience?.dataEpoch&&saved.payload.experience.dataEpoch!==localState?.dataEpoch||!localState&&!storage.getItem(LEGACY_KEY)||latest(saved.payload)>latest({experience:localState,legacy:localLegacy}));
 if(restore){
  if(saved.payload.experience?.dataEpoch&&saved.payload.experience.dataEpoch!==localState?.dataEpoch){storage.removeItem('hermes_before_portable_recovery');storage.removeItem(RECORDING_KEY);storage.removeItem(`${LEGACY_KEY}:shadow_v1`);storage.removeItem(`${LEGACY_KEY}:memory_journal_v1`);}
  const previous=[storage.getItem(LEGACY_KEY),storage.getItem(STATE_KEY),storage.getItem(RECORDING_KEY)];
  if(previous.some(Boolean)&&!saved.payload.experience?.dataEpoch)storage.setItem('hermes_before_portable_recovery',JSON.stringify({legacy:previous[0],experience:previous[1],pianoRoom:previous[2],at:new Date().toISOString()}));
  try{storage.setItem(LEGACY_KEY,JSON.stringify(saved.payload.legacy||{}));storage.setItem(STATE_KEY,JSON.stringify(saved.payload.experience));if(saved.payload.legacy?.pianoRoom)storage.setItem(RECORDING_KEY,JSON.stringify(saved.payload.legacy.pianoRoom));}
  catch(e){[LEGACY_KEY,STATE_KEY,RECORDING_KEY].forEach((k,i)=>previous[i]===null?storage.removeItem(k):storage.setItem(k,previous[i]));throw e;}
 }
 return saved;
}
export function portableStateSync({api,repository,initial,onError,onStatus=()=>{},storage=localStorage,locks=navigator.locks}){
 let revision=initial.revision,last='',timer=null,running=false,again=false,stopped=false,lastError=null;const uploaded=new Set();
 const revisionKey='hermes_portable_revision';storage.setItem(revisionKey,String(revision));
 const fingerprint=payload=>JSON.stringify({...payload,experience:{...payload.experience,updatedAt:''}});
 const capture=()=>sanitize({legacy:{...JSON.parse(storage.getItem(LEGACY_KEY)||'{}'),pianoRoom:JSON.parse(storage.getItem(RECORDING_KEY)||'null')},experience:JSON.parse(storage.getItem(STATE_KEY)||'null')});
 async function synchronize(){
  if(stopped)return;if(running){again=true;return;}running=true;lastError=null;onStatus('正在保存本机档案…');
  try{await locks.request('hermes-portable-state',async()=>{
    const legacy=JSON.parse(storage.getItem(LEGACY_KEY)||'{}'),experience=JSON.parse(storage.getItem(STATE_KEY)||'null');if(!experience)return;
    const payload=capture(),encoded=JSON.stringify(payload),identity=fingerprint(payload);if(identity===last){onStatus('本机档案已保存，可随项目目录迁移。');return;}
    const metas=Object.values(legacy.customRoleAssets||{}).flatMap(bucket=>[bucket.avatar,...(bucket.portraits||[])]).filter(Boolean);
    for(const meta of metas){if(uploaded.has(meta.id))continue;const record=await repository.get(meta.id);if(record?.blob instanceof Blob){await api.tool('role_asset_save',{roleId:meta.roleId,metadata:meta,base64:await encode(record.blob)});uploaded.add(meta.id);}}
    // Compare server revision under the browser lock: stale windows must not replace newer data.
    // Windows on this origin share browser storage and the same writer lock.
    // A different origin has no receipt here and still fails the server CAS.
    revision=Math.max(revision,Number(storage.getItem(revisionKey))||0);
    const result=await api.tool('client_workspace_save',{payload:JSON.parse(encoded),expectedRevision:revision});revision=result.revision;storage.setItem(revisionKey,String(revision));last=identity;
    onStatus('本机档案已保存，可随项目目录迁移。');
   });
  }catch(e){lastError=e;onStatus('本机档案尚未同步完成；迁移前请检查提示。');if(['client_snapshot_conflict','client_snapshot_reset'].includes(e.message)){stopped=true;onError('另一个地址的窗口已保存更新的本机档案。当前窗口资料保留；请刷新后继续同步，避免覆盖新记录。');}else onError('本机档案同步未完成，浏览器原数据保留：'+e.message);}
  finally{running=false;if(again){again=false;schedule();}}
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(synchronize,1200);}
 const interval=setInterval(synchronize,30000);window.addEventListener('storage',schedule);document.addEventListener('hermes:piano-change',schedule);document.addEventListener('visibilitychange',()=>{if(document.hidden)synchronize();});
 return {schedule,async flush(){while(running)await new Promise(r=>setTimeout(r,25));await synchronize();while(running)await new Promise(r=>setTimeout(r,25));if(lastError)throw lastError;if(stopped)throw Error('client_snapshot_conflict');},adoptRevision(next){revision=next;storage.setItem(revisionKey,String(next));last='';schedule();},pending(){try{return running||fingerprint(capture())!==last;}catch{return true;}},close(){clearTimeout(timer);clearInterval(interval);document.removeEventListener?.('hermes:piano-change',schedule);stopped=true;}};
}
export async function restoreRoleAsset(api,repository,meta){
 const record=await repository.get(meta.id);if(record?.blob instanceof Blob)return record;
 const saved=await api.tool('role_asset_get',{roleId:meta.roleId,id:meta.id});if(!saved.found)return null;
 const bytes=Uint8Array.from(atob(saved.base64),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:saved.metadata.type});await repository.put(saved.metadata,blob);return {...saved.metadata,blob};
}
