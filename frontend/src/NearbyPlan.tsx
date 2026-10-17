import {useEffect,useMemo,useState} from 'react';
import {UiIcon} from './UiIcon';
import {FloorPlan} from './FloorPlan';
import {indoorNavigation} from '../../web/assets/experience/indoor-navigation.mjs';
import {minimapScope} from '../../web/assets/experience/minimap-scope.mjs';
import {locationHierarchy} from '../../web/assets/experience/location-tree.mjs';
import {nearbyRoom,requestNearbyRoom} from '../../web/assets/experience/nearby-room.mjs';
import type {ChatSnapshot,ChatActions} from './chat-types';
export function NearbyPlan({snapshot:s,actions}:{snapshot:ChatSnapshot;actions:ChatActions}){
 const map=s.worldMap!,origin=s.worldLife?.user?.locationId||map.actorLocations?.user||map.currentId;
 const scope=minimapScope(map,origin),[view,setView]=useState(scope?.parent||origin);
 useEffect(()=>{setView(scope?.parent||origin);},[origin,map.worldId]);
 const tree=useMemo(()=>locationHierarchy(map.locations),[map.locations]),nav=indoorNavigation(map.locations,view,origin);
 function choose(id:string){if(tree.children(id).length){setView(id);return;}if(nearbyRoom(map.locations,origin,id))requestNearbyRoom({locationId:id,originId:origin,mode:s.personaMode||'normal',identityId:s.worldLife?.identityBank?.active?.id||''});else actions.selectWorldScene?.(id);}
 return <><div className="nearby-plan-tools"><div className="nearby-level-tools"><button type="button" title="上一级场景" aria-label="上一级场景" disabled={!nav.parent} onClick={()=>nav.parent&&setView(nav.parent)}><UiIcon name="back"/></button><button type="button" title="回到我的位置" aria-label="回到我的位置" onClick={()=>setView(scope?.parent||origin)}><UiIcon name="pin"/></button><button type="button" title="进入下一级场景" aria-label="进入下一级场景" disabled={!nav.children.some(p=>tree.children(p.id).length)} onClick={()=>{const target=nav.children.find(p=>tree.path(origin).some(q=>q.id===p.id)&&tree.children(p.id).length)||nav.children.find(p=>tree.children(p.id).length);if(target)setView(target.id);}}><UiIcon name="forward"/></button></div>{nav.floors.length>1&&<div className="nearby-floor-tools"><button type="button" title="查看上一楼层" aria-label="查看上一楼层" disabled={!nav.previousFloor} onClick={()=>nav.previousFloor&&setView(nav.previousFloor.id)}><UiIcon name="up"/></button><label><span className="sr-only">查看楼层</span><select aria-label="查看楼层" value={nav.floor?.id||''} onChange={e=>setView(e.target.value)}>{nav.floors.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button type="button" title="查看下一楼层" aria-label="查看下一楼层" disabled={!nav.nextFloor} onClick={()=>nav.nextFloor&&setView(nav.nextFloor.id)}><UiIcon name="down"/></button></div>}</div>
 <FloorPlan map={map} parent={view} selected={origin} compact onSelect={choose}/>
 <nav className="nearby-scene-tools" aria-label="相邻场景"><button type="button" title={nav.previousScene?.name||'没有上一场景'} disabled={!nav.previousScene} onClick={()=>nav.previousScene&&setView(nav.previousScene.id)}><UiIcon name="left"/><span>上一场景</span></button><button type="button" title={nav.nextScene?.name||'没有下一场景'} disabled={!nav.nextScene} onClick={()=>nav.nextScene&&setView(nav.nextScene.id)}><span>下一场景</span><UiIcon name="right"/></button></nav>
 <small className="nearby-browse-label">正在查看：{tree.label(view)}</small><small className="nearby-origin-label">你在：{tree.label(origin)}</small></>;
}
