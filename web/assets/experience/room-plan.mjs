import {locationHierarchy} from './location-tree.mjs';
export function roomPlanPages(locations,parent,userId){
 const tree=locationHierarchy(locations),place=tree.byId.get(parent),children=tree.children(parent);
 if(!place)return {pages:[],initial:0};
 const floors=children.filter(p=>p.metadata?.kind==='floor');let pages=[];
 const add=(id,name,rooms)=>{const groups=[...new Set(rooms.map(p=>p.metadata?.planPage||0))].sort((a,b)=>a-b);if(!groups.length)groups.push(0);for(const group of groups){const items=rooms.filter(p=>(p.metadata?.planPage||0)===group);for(let i=0;i<Math.max(1,items.length);i+=8){const plan=tree.byId.get(id)?.metadata?.floorPlan?.pages?.[group+':'+i];pages.push({id:id+':'+group+':'+i,name:name+(group===1?' · 特别区域':group>1?' · '+(plan?.name||'分层平面'):''),rooms:items.slice(i,i+8),plan});}}};
 if(floors.length){const other=children.filter(p=>p.metadata?.kind!=='floor');if(other.length)add(parent,place.name,other);for(const floor of floors)add(floor.id,floor.name,tree.children(floor.id).length?tree.children(floor.id):[floor]);}
 else add(parent,place.name,children.length?children:[place]);
 const belongs=(p,id)=>tree.path(id).some(n=>n.id===p.id);
 const initial=Math.max(0,pages.findIndex(page=>page.rooms.some(p=>belongs(p,userId))));
 return {pages,initial};
}
export function roomRect(room,index,count){
 const p=room.metadata?.plan;
 if(p&&['x','y','w','h'].every(k=>Number.isFinite(p[k]))&&p.w>0&&p.h>0&&p.x>=0&&p.y>=0&&p.x+p.w<=100&&p.y+p.h<=100)return p;
 const cols=count===1?1:count<=4?2:3,rows=Math.ceil(count/cols),w=(94-(cols-1)*3)/cols,h=(94-(rows-1)*3)/rows;
 return {x:3+index%cols*(w+3),y:3+Math.floor(index/cols)*(h+3),w,h};
}
