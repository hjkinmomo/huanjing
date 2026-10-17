const finite=v=>typeof v==='number'&&Number.isFinite(v);
const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>finite(v)&&v>=0&&v<=100);
const rectangle=p=>p&&['x','y','w','h'].every(k=>finite(p[k]))&&p.w>0&&p.h>0&&p.x>=0&&p.y>=0&&p.x+p.w<=100.00001&&p.y+p.h<=100.00001;
const polygon=p=>Array.isArray(p)&&p.length>=3&&p.length<=24&&p.every(point);
export function containsPoint(shape,p){
 let inside=false;const [x,y]=p;
 for(let i=0,j=shape.length-1;i<shape.length;j=i++){
  const [a,b]=shape[i],[c,d]=shape[j],cross=(x-a)*(d-b)-(y-b)*(c-a);
  if(Math.abs(cross)<.00001&&x>=Math.min(a,c)-.00001&&x<=Math.max(a,c)+.00001&&y>=Math.min(b,d)-.00001&&y<=Math.max(b,d)+.00001)return true;
  if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
 }
 return inside;
}
export function roomShape(room){
 const p=room.metadata?.plan;if(!rectangle(p))return null;
 const shape=room.metadata?.planShape;
 return polygon(shape)&&shape.every(([x,y])=>x>=p.x-.001&&x<=p.x+p.w+.001&&y>=p.y-.001&&y<=p.y+p.h+.001)?shape:[[p.x,p.y],[p.x+p.w,p.y],[p.x+p.w,p.y+p.h],[p.x,p.y+p.h]];
}
export function roomAnchor(room,shape,kind='label'){
 const p=room.metadata.plan,key=kind==='marker'?'planMarkerAt':kind==='furniture'?'planFurnitureAt':'planLabelAt',candidate=room.metadata[key];
 if(point(candidate)&&containsPoint(shape,candidate))return candidate;
 const center=[p.x+p.w/2,p.y+p.h*(kind==='marker'?.45:kind==='furniture'?.23:.74)];
 if(containsPoint(shape,center))return center;
 // Concave rooms need an interior point, not the center of their bounding box.
 for(let y=p.y+p.h*.25;y<p.y+p.h;y+=p.h*.25)for(let x=p.x+p.w*.25;x<p.x+p.w;x+=p.w*.25)if(containsPoint(shape,[x,y]))return [x,y];
 return shape[0];
}
function openings(items){return Array.isArray(items)?items.filter(d=>d&&point([d.x,d.y])&&['x','y'].includes(d.axis)&&finite(d.span)&&d.span>0&&d.span<=30&&d[d.axis]+d.span<=100.001):[];}
export function floorGeometry(page){
 const plan=page?.plan;
 if(!plan||plan.schema!==1||!finite(plan.width)||!finite(plan.height)||plan.width<2||plan.height<2||plan.width>100||plan.height>100||!polygon(plan.outline)||!['interior','open-interior','site'].includes(plan.kind))return null;
 const rooms=page.rooms.map(room=>{const shape=roomShape(room);return shape?{room,shape,label:roomAnchor(room,shape),marker:roomAnchor(room,shape,'marker'),furniture:roomAnchor(room,shape,'furniture')}:null;});
 if(rooms.some(r=>!r))return null;
 const circulation=Array.isArray(plan.circulation)?plan.circulation.filter(c=>c&&point(c.at)&&typeof c.text==='string'&&c.text.length<=50):[];
 const path=Array.isArray(plan.path)&&plan.path.length<=30&&plan.path.every(point)?plan.path:null;
 return {...plan,circulation,path,doors:openings(plan.doors),windows:openings(plan.windows),rooms};
}
export function wallSegments(geometry){
 if(!geometry||geometry.kind==='site')return [];
 const lines=new Map();
 const add=(shape,outer)=>{shape.forEach((a,i)=>{const b=shape[(i+1)%shape.length];if(a[0]!==b[0]&&a[1]!==b[1])return;const axis=a[1]===b[1]?'x':'y',fixed=axis==='x'?a[1]:a[0],start=Math.min(a[axis==='x'?0:1],b[axis==='x'?0:1]),end=Math.max(a[axis==='x'?0:1],b[axis==='x'?0:1]);if(end-start<.0001)return;const key=axis+':'+fixed,entry=lines.get(key)||{axis,fixed,intervals:[]};entry.intervals.push({start,end,outer});lines.set(key,entry);});};
 add(geometry.outline,true);if(geometry.kind==='interior')geometry.rooms.forEach(r=>add(r.shape,false));
 const result=[];
 for(const line of lines.values()){
  const breaks=[...new Set(line.intervals.flatMap(i=>[i.start,i.end]))].sort((a,b)=>a-b);
  for(let i=0;i<breaks.length-1;i++){
   const low=breaks[i],high=breaks[i+1],cover=line.intervals.filter(v=>v.start<=low+.0001&&v.end>=high-.0001);if(!cover.length)continue;
   let pieces=[[low,high]];
   for(const d of [...geometry.doors,...geometry.windows])if(d.axis===line.axis&&Math.abs((line.axis==='x'?d.y:d.x)-line.fixed)<.001){const start=d[d.axis],end=start+d.span;pieces=pieces.flatMap(([a,b])=>end<=a||start>=b?[[a,b]]:[[a,Math.max(a,start)],[Math.min(b,end),b]].filter(([x,y])=>y-x>.0001));}
   for(const [a,b] of pieces)result.push({axis:line.axis,fixed:line.fixed,start:a,end:b,outer:cover.some(v=>v.outer)});
  }
 }
 return result;
}
export function labelLines(value,characters=6){
 const all=Array.from(String(value)),result=[];for(let i=0;i<all.length;i+=Math.max(2,characters))result.push(all.slice(i,i+Math.max(2,characters)).join(''));return result;
}
