(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.HermesLegacyStateCompat=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const maps=['messages','typedMemories','memories','roleCards','customRoleAssets','relationshipProfiles','userProfile','settings','inventory','affection','experienceRoleImports','leisure'];
  function validSnapshot(snapshot,knownRoles=[]){
    if(!record(snapshot)||maps.some(key=>Object.hasOwn(snapshot,key)&&!record(snapshot[key])))return false;
    if(Object.hasOwn(snapshot,'customRoles')&&(!Array.isArray(snapshot.customRoles)||snapshot.customRoles.some(role=>!record(role)||!/^custom-[a-z0-9_-]{1,57}$/.test(role.id||'')||typeof role.name!=='string'||!role.name.trim())))return false;
    if(Object.hasOwn(snapshot,'coins')&&(!Number.isSafeInteger(snapshot.coins)||snapshot.coins<0))return false;
    if(['messages','typedMemories','memories'].some(key=>snapshot[key]&&Object.values(snapshot[key]).some(value=>!Array.isArray(value))))return false;
    const ids=new Set([...knownRoles,'shuyun',...(snapshot.customRoles||[]).map(role=>role.id)]);
    const legacy=ids.has(snapshot.role)&&record(snapshot.messages)&&record(snapshot.typedMemories);
    const shared=snapshot.sharedStateVersion===1||['experienceRoleImports','roleCards','customRoleAssets','relationshipProfiles','userProfile','leisure','typedMemories'].some(key=>record(snapshot[key])&&Object.keys(snapshot[key]).length>0)||snapshot.customRoles?.length>0;
    return legacy||!!shared;
  }
  function prepareSnapshot(snapshot,knownRoles=[]){
    if(!validSnapshot(snapshot,knownRoles))throw Error('invalid shared snapshot shape');
    const next=structuredClone(snapshot);
    next.role ||= knownRoles[0]||'shira';
    for(const key of ['messages','memories','typedMemories'])next[key]||={};
    next.coins ??=0;
    return next;
  }
  function mayWrite(loadFailure){return !loadFailure||loadFailure.recovered===true;}
  function savedLore(card,fallback){return Array.isArray(card?.loreBook)?structuredClone(card.loreBook):fallback();}
  return Object.freeze({validSnapshot,prepareSnapshot,mayWrite,savedLore});
});
