import {nearbyRoom} from '../../web/assets/experience/nearby-room.mjs';
import {cityPlaceKind} from '../../web/assets/experience/city3d-core.mjs';
import {FloorPlan} from './FloorPlan';
import {CityMap3D} from './CityMap3D';
import {UiIcon} from './UiIcon';
import {useEffect,useMemo,useRef,useState} from 'react';
import {cityMapPoints} from '../../web/assets/experience/city-map.mjs';
import {locationHierarchy} from '../../web/assets/experience/location-tree.mjs';
import type {WorldMap} from './chat-types';
type Place=WorldMap['locations'][number];
export function WorldNavigator({map,selected,onSelect,onMove,focusId=''}:{onMove?:(id:string)=>void;focusId?:string;map:WorldMap;selected:string;onSelect:(id:string)=>void}){
 const tree=useMemo(()=>locationHierarchy(map.locations),[map.locations]);
 const [parent,setParent]=useState<string|null>(null),[district,setDistrict]=useState('全部'),[query,setQuery]=useState(''),[mapOpen,setMapOpen]=useState(true);
 const host=useRef<HTMLElement>(null);
 useEffect(()=>{const scroll=host.current?.closest('.phone-map-content');if(scroll)scroll.scrollTop=0;},[parent]);
 useEffect(()=>{setParent(null);setDistrict('全部');setQuery('');},[map.worldId]);
 const path=parent?tree.path(parent):[],choices=query.trim()?map.locations.filter(p=>[p.name,...(p.aliases||[])].some(v=>v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))):tree.children(parent).filter(p=>district==='全部'||parent||(p.metadata?.district||'临时地点')===district);
 const districts=[...new Set(tree.roots.map(p=>p.metadata?.district||'临时地点'))];
 const focus=(p:Place)=>{onSelect(p.id);setQuery('');if(tree.children(p.id).length)setParent(p.id);else if(p.metadata?.parentId||!['park','square','river','beach','station','amusement'].includes(cityPlaceKind(p)))setParent(tree.parent(p)||p.id);};
 useEffect(()=>{const p=tree.byId.get(focusId);if(p)focus(p);},[focusId,map.worldId]);
 const roomZoom=(direction:number,id?:string)=>{if(direction<0){setParent(parent?tree.parent(tree.byId.get(parent)):null);return;}const place=tree.byId.get(id||selected);if(place&&place.id!==parent&&tree.path(place.id).some(p=>p.id===parent)){onSelect(place.id);setParent(place.id);}};
 const points=cityMapPoints(map.locations,parent),pointById=new Map(points.map(p=>[p.id,p]));
 const shownId=(id?:string)=>{const path=id?tree.path(id):[];return parent?path[path.findIndex(p=>p.id===parent)+1]?.id:path[0]?.id;};
 const userId=shownId(map.actorLocations?.user),roleId=shownId(map.actorLocations?.character),selectedId=shownId(selected);
 const viewHeight=parent?Math.max(390,160+Math.ceil(points.length/2)*105):530;
 const chosen=points.find(p=>p.id===selectedId);
 return <section ref={host} className="world-navigator" aria-label="分级地点导航">
  <div className="atlas-position-tools"><button type="button" onClick={()=>{setParent(null);setQuery('');setMapOpen(true);}}>城市总览</button>{[['user','我的位置'],['character','角色位置']].map(([actor,label])=>{const id=map.actorLocations?.[actor as 'user'|'character'];return id&&tree.byId.has(id)?<button type="button" key={actor} onClick={()=>{setParent(tree.parent(tree.byId.get(id)));onSelect(id);setQuery('');setMapOpen(true);}}>{label}</button>:null;})}</div>
  <div className="city-atlas-heading"><div><span>生活地图</span><h3>{map.name}</h3></div><small>先选区域，再进入建筑与房间</small></div>
  <details className="city-atlas-view atlas-connected" open={mapOpen} onToggle={e=>setMapOpen(e.currentTarget.open)}><summary>{parent?tree.byId.get(parent)?.name+' · 内部布局':'夏城 · 城市地图'} <span><UiIcon name={mapOpen?'up':'down'}/></span></summary>
   {parent?<FloorPlan map={map} parent={parent} selected={selectedId||selected} onZoom={roomZoom} onSelect={id=>{const place=tree.byId.get(id);if(!place)return;if(nearbyRoom(map.locations,map.actorLocations?.user,id)&&onMove){onSelect(id);onMove(id);}else focus(place);}}/>:<CityMap3D parent={null} map={map} selected={selectedId||selected} district={district==='全部'?'':district} onSelect={id=>{const place=tree.byId.get(id);if(place)focus(place);}}/>}{parent&&<button className="map-level-control" title="返回上一级地图" aria-label="返回上一级地图" onClick={()=>roomZoom(-1)}><UiIcon name="back"/></button>}<div className="atlas-key"><span><i data-actor="user"/>你的位置</span><span><i data-actor="character"/>角色位置</span><span><i/>可点击地点</span></div>
   <p className="atlas-selection">{chosen?chosen.name:'悬停查看地点，点击选择'}<small>{points.length} 个地点 · 同场景点击前往，跨地点通过出行应用</small></p>
  </details>
  <details className="map-place-directory"><summary><UiIcon name="search"/>查找地点与房间</summary><div className="world-district-tabs" role="group" aria-label="城市区域">{['全部',...districts].map(d=><button type="button" key={d} aria-pressed={district===d} onClick={()=>{setDistrict(d);setParent(null);setQuery('');}}>{d}</button>)}</div>
  <label className="world-place-search">查找地点<input type="search" value={query} placeholder="地点名或别名" onChange={e=>setQuery(e.target.value)}/></label>
  <nav className="world-breadcrumbs" aria-label="地点路径"><button type="button" onClick={()=>{setParent(null);setQuery('');}}>城市{district==='全部'?'':' · '+district}</button>{path.map(p=><span key={p.id}><UiIcon name="forward"/><button type="button" onClick={()=>{setParent(p.id);onSelect(p.id);setQuery('');}}>{p.name}</button></span>)}</nav>
  {parent&&<button type="button" className="world-level-back" onClick={()=>roomZoom(-1)}><UiIcon name="back"/>返回上一级</button>}
  <div className="world-directory-choices world-tree-choices" role="group" aria-label="这个世界的场景">{choices.map(p=>{const count=tree.children(p.id).length;return <button type="button" key={p.id} aria-pressed={p.id===selected} onClick={()=>focus(p)}><UiIcon name={count?'building':'pin'}/><span><strong>{p.name}</strong><small>{query?tree.label(p.id):count?count+' 个内部地点':p.id===map.currentId?'当前地点':p.temporary?'临时地点':'场景资料'}</small></span>{count>0&&<UiIcon name="forward"/>}</button>;})}</div>
  {!choices.length&&<p className="field-help">没有匹配的地点。</p>}
 </details></section>;
}
