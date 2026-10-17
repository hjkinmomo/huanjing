import {NearbyPlan} from './NearbyPlan';
import {UiIcon} from './UiIcon';
import {TimeControls} from './TimeControls';
import {useState} from 'react';
import {RoleCard} from './RoleCard';
import {FloorPlan} from './FloorPlan';
import {NearbyRoomDialog} from './NearbyRoomDialog';
import {requestNearbyRoom} from '../../web/assets/experience/nearby-room.mjs';
import {locationHierarchy} from '../../web/assets/experience/location-tree.mjs';
import {minimapScope} from '../../web/assets/experience/minimap-scope.mjs';
import type {ChatActions,ChatSnapshot} from './chat-types';
export function CharacterRail({snapshot:s,actions}:{snapshot:ChatSnapshot;actions:ChatActions}){
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('huanjing_rail_card_fold_v1')==='true';}catch{return false;}});
 const life=s.worldLife,map=s.worldMap,tree=map?locationHierarchy(map.locations):null;
 const roleId=life?.user?.locationId||map?.actorLocations?.user||map?.currentId;
 const mini=map?minimapScope(map,roleId):null;
 const userPlace=life?.enabled?life.user?.name:'未记录位置',rolePlace=life?.enRoute?'在路上 · '+life.enRoute.remainingMinutes+' 分钟后到达':life?.enabled?life.character?.name:s.scene?.location;
 function fold(){setCollapsed(!collapsed);try{localStorage.setItem('huanjing_rail_card_fold_v1',String(!collapsed));}catch{}}
 return <>{s.hasSelectedRole!==false&&<section className="rail-card-fold" data-collapsed={collapsed}><div className="rail-card-gutter"><button type="button" aria-label={collapsed?'展开闪光卡':'收起闪光卡'} aria-expanded={!collapsed} onClick={fold}><UiIcon name={collapsed?'right':'left'}/></button></div><div className="rail-card-content" inert={collapsed} aria-hidden={collapsed}><div><RoleCard snapshot={s} actions={actions} active={!collapsed}/></div></div>{collapsed&&<span className="rail-card-fold-label">闪光卡已收起</span>}</section>}
 <section className="rail-status rail-current" aria-label="此刻的位置与心情"><h2>此刻</h2>{life?.enabled&&<div className="rail-world-clock"><time>{life.worldTime}</time><button type="button" title="查看角色日程" aria-label="查看角色日程" onClick={()=>actions.openPhone?.('schedule')}><UiIcon name="clock"/></button></div>}{life?.enabled&&<TimeControls compact actions={actions} disabled={s.busy}/>}<dl>{[['你的位置',userPlace],['角色位置',rolePlace||'未记录位置'],['心情',s.scene?.mood||'尚未描述']].map(([label,value])=><div key={label}><dt>{label!=='心情'&&<i className="location-dot" data-actor={label==='你的位置'?'user':'character'}/>} {label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>
 {mini&&<section className="rail-minimap" aria-label="用户所在室内区域的小地图"><header><span>你的附近</span><button type="button" title="展开地图" aria-label="展开地图" onClick={()=>actions.openPhone?.('map')}><UiIcon name="expand"/></button></header><NearbyPlan snapshot={s} actions={actions}/></section>}<NearbyRoomDialog snapshot={s} actions={actions}/></>;
}
