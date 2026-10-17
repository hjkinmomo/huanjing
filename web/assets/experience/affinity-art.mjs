// Scores choose artwork only. They never grant relationship consent or agent permissions.
export function affinityUnlockHint(threshold){
 return threshold>=65?'更多相处后可用':threshold>=35?'相处更亲近时可用':threshold>0?'相处渐熟时可用':'随时可用';
}
export function affinityArtwork(role,scene,options,score){
 const value=Number.isFinite(Number(score))?Math.max(0,Number(score)):0;
 return [...(Array.isArray(role.affinityScenes?.[scene])?role.affinityScenes[scene]:[])]
  .filter(v=>v&&typeof v.id==='string'&&Number.isFinite(v.from)&&v.from>=0&&v.from<=value)
  .sort((a,b)=>b.from-a.from).map(v=>options.find(p=>p.id===v.id&&p.available)).find(Boolean);
}
export function createAffinityChanges(){
 const values=new Map();
 return {update(roleId,score){
  if(typeof roleId!=='string'||!roleId)return '';
  if(!Number.isFinite(score))return values.get(roleId)?.text||'随相处变化';
  const next=Math.max(0,score),old=values.get(roleId);
  const delta=old?Math.round((next-old.value)*100)/100:0;
  const text=old&&next===old.value?old.text:delta===0?'随相处变化':`好感变化 ${delta>0?'+':''}${delta}`;
  values.set(roleId,{value:next,text});return text;
 }};
}

