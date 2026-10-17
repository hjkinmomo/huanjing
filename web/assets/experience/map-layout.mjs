export function mapZoomLevel(ratio){return ratio>.78?'city':ratio>.40?'district':'building';}
export function mapLabelActors(layout,actorsByPlace){return layout.members.flatMap(id=>actorsByPlace.get(id)||[]);}
export function placeMapLabels(items,width,height){
 const placed=[];const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 const overlap=(a,b)=>Math.abs(a.x-b.x)<(a.width+b.width)/2+6&&Math.abs(a.y-b.y)<30;
 for(const item of items){const w=Math.min(width-16,Math.max(35,item.width));let choice;
  search:for(const distance of [0,30,60,90,120,150,180,210,240])for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]]){const value={id:item.id,members:[item.id],width:w,x:clamp(item.x+dx*distance,w/2+8,width-w/2-8),y:clamp(item.y+dy*distance,20,height-20)};if(!placed.some(other=>overlap(value,other))){choice=value;break search;}}
  if(choice)placed.push(choice);else{const nearest=[...placed].sort((a,b)=>Math.hypot(a.x-item.x,a.y-item.y)-Math.hypot(b.x-item.x,b.y-item.y))[0];if(nearest)nearest.members.push(item.id);}
 }
 return placed;
}
