import merchants from '../../web/assets/experience/merchants.json';
import {locationHierarchy} from '../../web/assets/experience/location-tree.mjs';
import {WorldNavigator} from './WorldNavigator';
import {useEffect,useState} from 'react';
import type {WorldMap,ChatActions} from './chat-types';

export function WorldDirectory({map,actions,busy,embedded=false,focusId=''}:{focusId?:string;map:WorldMap;actions:ChatActions;busy:boolean;embedded?:boolean}){
 const [selected,setSelected]=useState(focusId||map.currentId),[error,setError]=useState(''),[saving,setSaving]=useState(false),[district,setDistrict]=useState('全部');
 useEffect(()=>{setSelected(map.currentId);setError('');},[map.worldId,map.currentId,map.version]);
 useEffect(()=>{if(focusId&&map.locations.some(p=>p.id===focusId))setSelected(focusId);},[focusId,map.version]);
 const tree=locationHierarchy(map.locations),store=merchants.find(m=>tree.path(selected).some(p=>p.id===m.locationId));
 const place=map.locations.find(p=>p.id===selected)||map.locations[0];
 const body=<div className="world-directory-body"><p className="world-directory-rule">{map.name} · {map.locations.length} 个场景。查看资料不会转场。</p>
   <WorldNavigator map={map} selected={selected} focusId={focusId} onMove={id=>{if(!busy)actions.selectWorldScene?.(id);}} onSelect={id=>{setSelected(id);setError('');}}/>
   {place&&<section className="world-directory-record" aria-label="所选场景资料"><h3>{place.name}</h3><code>{place.address}</code><p>{place.description}</p><p>{place.ambience}</p>
    <dl><dt>场景物件</dt><dd>{place.objects.join('、')||'未填写'}</dd><dt>可以做什么</dt><dd>{place.actions.join('、')||'未填写'}</dd><dt>相邻场景</dt><dd>{place.exits.map(id=>map.locations.find(p=>p.id===id)?.name||id).join('、')||'未填写'}</dd></dl>
    <button type="button" className="world-scene-go" disabled={busy||saving||place.metadata?.locked||place.id===map.currentId} onClick={async()=>{setSaving(true);setError('');try{await actions.selectWorldScene?.(place.id);}catch(e){setError(e instanceof Error?e.message:'场景未切换。');}finally{setSaving(false);}}}>{place.metadata?.locked?'房门暂未开放':saving?'正在读取…':place.id===map.currentId?'当前场景':'前往这个场景'}</button>
    {store&&<button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('huanjing:phone-open',{detail:{app:'delivery',merchantId:store.id}}))}>打开{store.name}的外卖菜单</button>}
    {place.temporary&&<div className="temporary-place-actions">{!place.saved&&<button type="button" disabled={busy||saving} onClick={async()=>{setSaving(true);try{await actions.changeTemporaryPlace?.(place.id,'save');}catch(e){setError(String(e));}finally{setSaving(false);}}}>保存到本角色地点</button>}<button type="button" disabled={busy||saving} onClick={async()=>{setSaving(true);try{await actions.changeTemporaryPlace?.(place.id,'delete');setSelected(map.currentId);}catch(e){setError(String(e));}finally{setSaving(false);}}}>删除地点条目</button><small>删除不会改写已发生的聊天；其他角色没有此地点。</small></div>}
   </section>}<p role="status">{error}</p>
  </div>;
 return embedded?<section className="world-directory" aria-label="世界地图">{body}</section>:<details className="world-directory"><summary>世界地图 · {map.name} <span>{map.locations.length} 个场景</span></summary>{body}</details>;
}
