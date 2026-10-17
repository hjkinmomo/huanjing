import {locationHierarchy} from './location-tree.mjs';
// Every catalog entry has a visible level; no fixed landmark allowlist.
export function cityMapPoints(locations,parent=null){
 const tree=locationHierarchy(locations),entries=tree.children(parent),inside=!!parent,cols=inside?2:Math.min(12,Math.max(6,Math.ceil(Math.sqrt(entries.length*1.5)))),rows=Math.ceil(entries.length/cols);
 return entries.map((p,i)=>{
   const map=p.metadata?.map;
   let x=inside?180+(i%cols)*340:55+(i%cols)*(700/(cols-1)),y=inside?95+Math.floor(i/cols)*105:60+Math.floor(i/cols)*Math.min(70,400/Math.max(1,rows-1));
   if(!inside&&map&&Number.isFinite(map.x)&&Number.isFinite(map.y)){x=50+map.x*7;y=30+map.y*4.4;}
   return {id:p.id,name:p.name,x:Math.max(40,Math.min(760,x)),y:inside?y:Math.max(55,Math.min(460,y)),children:tree.children(p.id).length,temporary:!!p.temporary};
 });
}
