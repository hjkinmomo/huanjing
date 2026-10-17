import catalog from './worldbook-catalog.json' with {type:'json'};
import {mountLocationCascade} from './location-tree.mjs';
export let WORLDS=catalog.worlds;let catalogVersion='',catalogMode='normal';
export function worldCatalogIdentity(mode,version){catalogMode=mode||'normal';catalogVersion=version||'';}
export const sceneAddress=(worldId,locationId)=>`worldbook://${catalogMode}/${worldId}/${locationId}`;
export function worldMapSnapshot(binding,scene,temporaryPlaces=[]){const world=worldById(binding?.id);if(!world)return null;return {worldId:world.id,name:world.name,currentId:locationByName(binding,scene?.state?.location)?.id||temporaryPlaces.find(p=>p.name===scene?.state?.location)?.id||binding.location,version:catalogVersion,locations:[...world.locations.filter(p=>p.available!==false),...temporaryPlaces].map(p=>({...p,address:sceneAddress(world.id,p.id)}))};}
export function authoredScene(binding,name){const world=worldById(binding?.id);if(!world)return null;const place=name?locationByName(binding,name):world.locations.find(p=>p.id===binding.location);if(!place)return null;return {...place,address:sceneAddress(world.id,place.id),worldName:world.name};}
export function setWorldCatalog(worlds){
 if(!Array.isArray(worlds)||!worlds.length||worlds.length>64)throw Error('世界目录格式无效。');
 for(const w of worlds){if(typeof w.id!=='string'||typeof w.name!=='string'||!Array.isArray(w.locations)||!w.locations.length)throw Error('世界目录格式无效。');}
 WORLDS=structuredClone(worlds);
}
export const worldById=id=>WORLDS.find(w=>w.id===id)||null;
export function normalizeWorld(value){
 if(value===undefined||value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['id','location'].includes(k)))throw Error('世界选择格式不正确。');
 const world=worldById(value.id),location=world?.locations.find(p=>p.id===value.location);
 if(!location)throw Error('请选择这个世界中的有效起点。');
 return {id:world.id,location:location.id};
}
export function worldLocations(binding){return worldById(binding?.id)?.locations||[];}
export function locationByName(binding,name){
 const places=worldLocations(binding),value=String(name||'').trim();
 const exact=places.find(p=>p.name===value||p.aliases.includes(value));if(exact)return exact;
 const matches=places.filter(p=>[p.name,...p.aliases].some(key=>key.length>=2&&value.includes(key)));
 return matches.length===1?matches[0]:null;
}
export function worldReference(binding,scene,query='',temporaryPlaces=[]){
 const world=worldById(binding?.id);if(!world)return null;
 const current=locationByName(binding,scene?.state?.location)||(scene?.state?.location?null:world.locations.find(p=>p.id===binding.location));
 const available=[...world.locations,...temporaryPlaces];
 const requested=available.filter(p=>[p.name,...p.aliases].some(k=>query.includes(k)));
 const places=[current,...requested].filter((p,i,a)=>p&&a.findIndex(x=>x?.id===p.id)===i).slice(0,4);
 return {world:world.name,summary:world.summary,rules:world.rules,currentLocation:scene?.state?.location||current?.name,locations:places.length?places:temporaryPlaces.filter(p=>p.name===scene?.state?.location),
  directory:available.map(p=>({id:p.id,name:p.name,aliases:p.aliases})),
  readOnlyEnvironment:true,address:current?sceneAddress(world.id,current.id):null,
  guidance:'这是当前会话的虚构世界资料，不是人格或现实用户事实。环境、物件位置与交通以当前条目为准；条目被修改后采用新的固定环境资料，人物已经发生的行动和当前位置保持连续，不重写旧回复。柜台、窗门、固定家具保持条目中的位置与支点，不把甜点柜放上双人桌等不合尺度的位置；人物设定和本轮指示优先。用户只提议去某处时先回应，明确出发/抵达后再更新场景。进入已写地点时用自然旁白介绍相关环境和可互动事物，不逐条复读，不替用户行动。进入已收录地点时，环境旁白由应用读取条目；scene 段补充人物动作、衣着、心情，不改写该地点的环境、家具或道路。未收录地点可以进入，生成符合本都市区域、距离与现实尺度的简短环境；scene.location 写清地点名，scene.setting 必须写出真实可读的环境概况，应用将它登记为本角色会话的临时地点；不修改已有地点。已收录地点的 scene.location 用完整 name，scene.setting 沿用 description；临时地点用自己的名称与环境概况，人物状态自然发展。关键词命中只表示提取资料，不表示已经转场。世界开局只决定起点，后续不重置地点。'};
}
export function mountWorldPicker(fields){
 const host=document.createElement('div');host.className='world-picker';
 host.innerHTML='<label>当前世界<select name="world" aria-label="当前世界"></select></label><label>起点<select name="location" aria-label="世界起点"></select></label><p class="workspace-hint" data-world-description></p>';
 fields.querySelector('[name=scenario]').closest('label').before(host);
 const select=host.querySelector('[name=world]'),locations=host.querySelector('[name=location]'),hint=host.querySelector('[data-world-description]');
 locations.closest('label').hidden=true;const cascadeHost=document.createElement('div');hint.before(cascadeHost);
 const cascade=mountLocationCascade(cascadeHost,{getWorld:()=>worldById(select.value),onChange:id=>{locations.value=id;preview();}});
 function choices(){select.replaceChildren();for(const w of [{id:'',name:'自由场景 · 沿用角色设定'},...WORLDS.filter(w=>w.available!==false)]){const o=document.createElement('option');o.value=w.id;o.textContent=w.name;select.append(o);}}
 choices();
 function update(){const world=worldById(select.value);locations.replaceChildren();locations.disabled=!world;for(const p of (world?.locations||[]).filter(p=>p.available!==false)){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;locations.append(o);}if(world)locations.value=world.defaultLocation;cascade.reset(locations.value);preview();}
 function preview(){const world=worldById(select.value),p=world?.locations.find(x=>x.id===locations.value);hint.textContent=p?world.summary+' '+p.description:'不套用预置世界，由角色背景和你的开局情境建立场景。';}
 select.onchange=update;locations.onchange=preview;
 return {reset(){choices();select.value='';update();},value(){return select.value?normalizeWorld({id:select.value,location:locations.value}):null;}};
}

