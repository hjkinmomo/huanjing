import {setWorldCatalog,worldCatalogIdentity} from './worldbook.mjs';
import {setPresentationPolicy} from './chat-presentation.mjs';
import {refreshStickerPolicy} from './sticker-catalog.mjs';
let version='',appliedMode='normal',inflight=null,inflightMode='normal';
export function applyRuntimeCatalog(snapshot){
 if(snapshot?.schemaVersion!==1||typeof snapshot.version!=='string'||!snapshot.presentation?.reveal||!Array.isArray(snapshot.presentation?.narrationModes)||typeof snapshot.presentation.reasoningLanguagePrompt!=='string'||!Array.isArray(snapshot.worlds))throw Error('扩展目录格式无效，原有内容保留。');
 const mode=snapshot.personaMode||'normal';
 if(snapshot.version!==version||mode!==appliedMode){
  setWorldCatalog(snapshot.worlds);worldCatalogIdentity(mode,snapshot.version);setPresentationPolicy(snapshot.presentation);refreshStickerPolicy();version=snapshot.version;appliedMode=mode;
  globalThis.dispatchEvent?.(new Event('hermes-runtime-catalog'));
 }
 return snapshot;
}
export async function refreshRuntimeCatalog(api,force=false){
 const mode=api.personaMode||'normal';if(inflight&&inflightMode===mode&&!force)return inflight;
 const task=api.tool('worldbook_catalog',{force}).then(snapshot=>{if((api.personaMode||'normal')!==mode||snapshot.personaMode&&snapshot.personaMode!==mode)throw Error('世界书模式已经改变，请重新读取。');return applyRuntimeCatalog(snapshot);});inflight=task;inflightMode=mode;
 try{return await task;}finally{if(inflight===task)inflight=null;}
}
