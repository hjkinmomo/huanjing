import {cityMapPoints} from './city-map.mjs';
import {locationHierarchy} from './location-tree.mjs';
export const CITY_MODELS=Object.freeze({house:'suburban/building-type-a',apartment:'commercial/building-skyscraper-a',office:'commercial/building-skyscraper-e',shop:'commercial/building-e',cafe:'commercial/building-a',school:'suburban/building-type-d',library:'commercial/low-detail-building-g',hotel:'commercial/building-skyscraper-a',special:'suburban/building-type-h'});
export const specialCityPlace=place=>place?.metadata?.special===true||place?.metadata?.district==='特殊区域';
export function cityPlaceKind(place,inside=false){
 if(inside)return 'room';
 const hint=place.metadata?.modelKind;
 if(['house','apartment','office','shop','cafe','school','library','hotel','special','park','amusement','station','beach','river','square'].includes(hint))return hint;
 const text=place.id+' '+place.name;
 for(const [kind,rx] of [['amusement',/amusement|ferris|游乐|摩天轮/],['station',/station|地铁|车站/],['beach',/beach|海边|海滩/],['river',/river|河边|河岸/],['library',/library|图书馆/],['school',/school|学校|校园/],['park',/park|公园/],['apartment',/apartment|公寓/],['office',/office|公司|商务|写字楼/],['hotel',/hotel|酒店/],['cafe',/cafe|咖啡|餐厅|餐馆/],['shop',/shop|store|商店|市场|商城/],['square',/square|广场/],['house',/home|家|住宅/]])if(rx.test(text))return kind;
 return specialCityPlace(place)?'special':'house';
}
export function cityLayout(map,parent=null){
 const tree=locationHierarchy(map.locations),points=cityMapPoints(map.locations,parent);
 const cols=parent?Math.min(3,Math.max(1,points.length)):0,rows=parent?Math.ceil(points.length/cols):0,occupied=[];
 return points.map((p,i)=>{let x=parent?((i%cols)-(cols-1)/2)*8:(p.x-410)/10,z=parent?(Math.floor(i/cols)-(rows-1)/2)*7:(p.y-255)/10;
  // Keep declared neighborhoods, but don't stack two buildings on one lot.
  if(!parent){let step=0;while(occupied.some(q=>Math.abs(q.x-x)<6.6&&Math.abs(q.z-z)<6)){step++;const a=step*2.4,r=Math.sqrt(step)*2.3;x=(p.x-410)/10+Math.cos(a)*r;z=(p.y-255)/10+Math.sin(a)*r;if(step>250)break;}}
  occupied.push({x,z});return {...p,kind:cityPlaceKind(tree.byId.get(p.id),!!parent),x,z,place:tree.byId.get(p.id)};
 });
}
export function visibleCityActor(locations,id,parent=null){
 const tree=locationHierarchy(locations),path=tree.path(id);
 return parent?path[path.findIndex(p=>p.id===parent)+1]?.id||null:path[0]?.id||null;
}
