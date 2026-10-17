import {locationHierarchy} from './location-tree.mjs';
import {minimapScope} from './minimap-scope.mjs';

export function nearbyRoom(locations,originId,locationId){
 const tree=locationHierarchy(locations||[]),scope=minimapScope({locations:locations||[]},originId),place=tree.byId.get(locationId);
 return scope&&place&&place.available!==false&&place.enabled!==false&&!tree.path(locationId).some(p=>p.metadata?.locked)&&tree.path(locationId).some(p=>p.id===scope.parent)?place:null;
}
export function requestNearbyRoom(request){window.dispatchEvent(new CustomEvent('huanjing:nearby-room',{detail:request}));}
export function openWorldDestination(life,mode,locationId,openTravel,openRoom=requestNearbyRoom){
 const originId=life?.user?.locationId;
 if(nearbyRoom(life?.worldLocations||[],originId,locationId)){openRoom({locationId,originId,mode,identityId:life?.identityBank?.active?.id||''});return 'room';}
 openTravel(locationId);return 'travel';
}
export async function applyRoomMove({api,request,exclusive,validate=()=>{},refresh=()=>{}}){
 const result=await exclusive(async()=>{validate();return moveNearbyRoom({api,...request});});
 // Refresh settles income and parcels using their own shared-state lock.
 // The movement lock must have ended before either settlement begins.
 await refresh(result);return result;
}
export async function moveNearbyRoom({api,...request}){
 const {mode,originId,locationId,identityId,requestId}=request,scope={global:true,mode},life=await api.tool('world_life_get',scope);
 if((life.identityBank?.active?.id||'')!==(identityId||''))throw Error('身份已变化，请重新选择房间。');
 if(life.user?.locationId===locationId&&life.events?.some(e=>e.id===requestId&&e.kind==='travel'&&e.locationId===locationId))return {...life,duplicate:true};
 if(life.user?.locationId!==originId)throw Error('你的位置已经变化，请在当前小地图重新选择。');
 if(life.transport?.current)throw Error('正在出行途中，请抵达后再切换房间。');
 if(!nearbyRoom(life.worldLocations,originId,locationId))throw Error('这里需要通过手机出行应用前往。');
 if(locationId===originId)return {...life,duplicate:true};
 // Existing owned movement updates the shared position, without a fare or
 // clock mutation. City travel continues to use WorldTransport.
 try{return await api.tool('world_life_travel',{...scope,locationId,expectedRevision:life.revision,requestId});}
 catch(e){if(e.message==='world_life_revision_conflict')throw Error('位置刚刚发生变化，请重新选择房间。');throw e;}
}
