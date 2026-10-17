import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {UiIcon} from './UiIcon';
import {locationHierarchy} from '../../web/assets/experience/location-tree.mjs';
import {sceneContainer} from '../../web/assets/experience/scene-container.mjs';
import {roomPlanPages} from '../../web/assets/experience/room-plan.mjs';
import {floorGeometry,wallSegments,labelLines,containsPoint} from '../../web/assets/experience/floor-plan-geometry.mjs';
import type {WorldMap} from './chat-types';
const furniture:Record<string,string>={weights:'M3 10v4m3-7v10m12-10v10m3-7v4M6 12h12',plant:'M12 21V10m0 4C4 14 3 6 5 4c5 0 7 5 7 10Zm0-2c0-5 3-8 8-8 1 5-1 9-8 9',fountain:'M3 17h18l-2 4H5ZM12 17V5m0 3C8 3 5 5 5 9m7-1c4-5 7-3 7 1',stairs:'M3 21h5v-5h5v-5h5V5h3M3 3h18',bed:'M3 9h18v12M3 14h18M5 9V4h14v5M7 6h3m4 0h3',sofa:'M4 10V6h16v4M2 10h4v8H2Zm16 0h4v8h-4M6 16h12M5 18v3m14-3v3',table:'M3 5h18v10H3ZM5 15v6m14-6v6',bath:'M3 10h18v5a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-5ZM5 10V4a2 2 0 0 1 4 0M6 19v2m12-2v2',book:'M4 3h16v18H4Zm4 4h8m-8 4h8m-8 4h8',kitchen:'M3 4h18v16H3ZM3 12h18M8 4v8m8-8v8M7 16h2m6 0h2'};

export function RoomPlan({map,parent,selected,onSelect,onZoom,compact=false}:{map:WorldMap;parent:string;selected?:string;onSelect?:(id:string)=>void;onZoom?:(direction:number,id?:string)=>void;compact?:boolean}){
 const tree=useMemo(()=>locationHierarchy(map.locations),[map.locations]),place=tree.byId.get(parent),children=tree.children(parent);
 const layout=useMemo(()=>roomPlanPages(map.locations,parent,map.actorLocations?.user),[map.locations,parent,map.actorLocations?.user]),[page,setPage]=useState(layout.initial);
 useEffect(()=>setPage(layout.initial),[parent,map.actorLocations?.user]);
 const current=layout.pages[Math.min(page,layout.pages.length-1)],rooms=current?.rooms||[],geometry=useMemo(()=>floorGeometry(current),[current]);
 const turn=(d:number)=>setPage(p=>(p+d+layout.pages.length)%layout.pages.length);
 const actors=map.actors!==undefined?map.actors:[{roleId:'current',name:'角色',locationId:map.actorLocations?.character||'',activity:'',enRoute:null}];
 const contains=(room:any,id:string)=>tree.path(id).some((p:any)=>p.id===room.id);
 const userUnplaced=children.length>0&&(map.actorLocations?.user===parent||map.actorLocations?.user===current?.id.split(':')[0]);
 const unplaced=children.length?actors.filter(a=>!a.enRoute&&(a.locationId===parent||a.locationId===current?.id.split(':')[0])):[];
 const svg=useRef<SVGSVGElement>(null),[canvasWidth,setCanvasWidth]=useState(300),[textSize,setTextSize]=useState(16),uid=useId().replace(/:/g,'');
 useEffect(()=>{const node=svg.current;if(!node)return;const measure=()=>{if(node.clientWidth)setCanvasWidth(node.clientWidth);setTextSize(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-size'))||16);};const observer=new ResizeObserver(measure);observer.observe(node);measure();return()=>observer.disconnect();},[!!geometry,parent]);
 const width=(geometry?.width||10)*60,height=(geometry?.height||7)*60,unit=width/Math.max(160,canvasWidth),font=unit*Math.min(compact?14:17,Math.max(compact?11:12,textSize*.7));
 const xy=(p:number[])=>[p[0]*width/100,p[1]*height/100],points=(shape:number[][])=>shape.map(p=>xy(p).join(',')).join(' '),walls=useMemo(()=>wallSegments(geometry),[geometry]);
 const activate=(room:any)=>{if(!room.metadata?.locked)onSelect?.(room.id);};
 const description=(room:any,user:boolean,here:any[])=>room.name+(user?'，你在此':'')+(here.length?'，'+here.map(a=>a.name).join('、'):'');
 return <div className="room-plan architectural-plan" data-compact={compact} data-kind={geometry?.kind||'unconfigured'}><header><strong>{place?.name||'所在位置'}</strong><small>{geometry?.name||current?.name||'场景平面'}</small>{layout.pages.length>1&&<nav aria-label="平面图分页"><button type="button" aria-label="上一区" title="上一区" onClick={()=>turn(-1)}><UiIcon name="left"/></button><span>{page+1}/{layout.pages.length}</span><button type="button" aria-label="下一区" title="下一区" onClick={()=>turn(1)}><UiIcon name="right"/></button></nav>}</header>
 {(unplaced.length>0||userUnplaced)&&<p className="room-plan-present">{userUnplaced&&<span><i className="location-dot" data-actor="user"/>你 · 在场</span>}{unplaced.map(a=><span key={a.roleId}><i className="location-dot" data-actor="character"/>{a.name} · 在场</span>)}</p>}
 {geometry?<svg ref={svg} viewBox={`0 0 ${width} ${height}`} role={onSelect?'group':'img'} aria-label={place?.name+'的比例平面图'}>
  <defs>{geometry.rooms.map((r:any)=><clipPath key={r.room.id} id={uid+'-'+r.room.id}><polygon points={points(r.shape)}/></clipPath>)}</defs>
  <polygon className="plan-floor" points={points(geometry.outline)}/>
  {geometry.kind==='site'&&geometry.path&&<polyline className="plan-walkway" points={points(geometry.path)} fill="none" strokeWidth={unit*12}/>}
  {geometry.rooms.map((r:any,index:number)=>{
   const room=r.room,rect=room.metadata.plan,user=contains(room,map.actorLocations?.user||''),here=actors.filter(a=>!a.enRoute&&contains(room,a.locationId));
   const kind=room.metadata?.furniture||(/bed|guest|卧室|客房/.test(room.id+room.name)?'bed':/bath|洗浴/.test(room.id+room.name)?'bath':/kitchen|厨房/.test(room.id+room.name)?'kitchen':'sofa');
   const label=xy(r.label),mark=xy(r.marker),art=xy(r.furniture),roomWidth=rect.w/100*canvasWidth,roomHeight=rect.h/100*canvasWidth*height/width;
   const size=unit*Math.min(24,Math.max(12,roomWidth*.32)),count=Math.max(1,Math.min(4,Math.floor(roomWidth/12))),marks=[...(user?[{id:'user',name:'你',color:'#418bda'}]:[]),...here.map(a=>({id:a.roleId,name:a.name,color:'#32926b'}))].slice(0,count);
   const lines=labelLines(room.metadata.planLabel||room.name,Math.max(2,Math.floor(roomWidth/(font/unit))));
   return <g key={room.id} data-location-id={room.id} role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} aria-label={description(room,user,here)} aria-disabled={room.metadata?.locked||undefined} onClick={()=>activate(room)} onKeyDown={e=>{if(onSelect&&!room.metadata?.locked&&(e.key==='Enter'||e.key===' ')){e.preventDefault();activate(room);}}} className="room-plan-region" data-selected={selected===room.id} data-occupied={user?'user':here.length?'character':undefined}>
    <title>{room.name}{room.metadata?.locked?' · 房门锁着':''}{onSelect?(sceneContainer(map.locations,map.actorLocations?.user)===sceneContainer(map.locations,room.id)?' · 点击前往':' · 点击查看'):''}{here.length?' · '+here.map(a=>a.name+'：'+a.activity).join('；'):''}</title>
    <polygon className="plan-room-fill" points={points(r.shape)} data-tone={index%3}/>
    <g clipPath={`url(#${uid+'-'+room.id})`}>
     {roomHeight>font/unit*3.4&&<path className="plan-furniture" d={furniture[kind]||furniture.table} transform={`translate(${art[0]-size/2},${art[1]-size/2}) scale(${size/24})`} fill="none" strokeWidth={1.2}/>} 
     <text className="room-name" x={label[0]} y={label[1]-(lines.length-1)*font*.57} textAnchor="middle" dominantBaseline="middle" fontSize={font}>{lines.map((line:string,i:number)=><tspan key={i} x={label[0]} dy={i?font*1.14:0}>{line}</tspan>)}</text>
     {marks.map((actor:any,i:number)=>{const x=mark[0]+(i-(marks.length-1)/2)*unit*11,y=mark[1],p=[x/width*100,y/height*100];return containsPoint(r.shape,p)?<g key={actor.id}><circle className="map-presence" data-actor-id={actor.id} cx={x} cy={y} r={unit*4} fill={actor.color} stroke="#fff" strokeWidth={unit*1.4}/><title>{actor.name+' · '+room.name}</title></g>:null;})}
    </g>
   </g>;
  })}
  <g className="plan-structure" pointerEvents="none">{walls.map((wall,index)=>{const start=xy(wall.axis==='x'?[wall.start,wall.fixed]:[wall.fixed,wall.start]),end=xy(wall.axis==='x'?[wall.end,wall.fixed]:[wall.fixed,wall.end]);return <line key={index} className={wall.outer?'plan-wall plan-wall-outer':'plan-wall'} x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} strokeWidth={unit*(wall.outer?2.3:1.4)}/>;})}
   {geometry.windows.map((d:any,i:number)=>{const a=xy([d.x,d.y]),b=xy(d.axis==='x'?[d.x+d.span,d.y]:[d.x,d.y+d.span]);return <line className="plan-window" key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={unit*2.5}/>;})}
   {geometry.doors.map((d:any,i:number)=>{const a=xy([d.x,d.y]),end=xy(d.axis==='x'?[d.x+d.span,d.y]:[d.x,d.y+d.span]),r=d.axis==='x'?end[0]-a[0]:end[1]-a[1],swing=d.swing===-1?-1:1,b=d.axis==='x'?[a[0],a[1]+r*swing]:[a[0]+r*swing,a[1]],sweep=d.axis==='x'?(swing>0?1:0):(swing>0?0:1);return <g key={i} className="plan-door" data-axis={d.axis}><path d={`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`} strokeWidth={unit*.9}/><path className="plan-door-arc" d={`M ${end[0]} ${end[1]} A ${r} ${r} 0 0 ${sweep} ${b[0]} ${b[1]}`} strokeWidth={unit*.75}/></g>;})}
   {(geometry.circulation||[]).map((c:any,i:number)=>{const at=xy(c.at);return <text key={i} className="plan-circulation" x={at[0]} y={at[1]} textAnchor="middle" dominantBaseline="middle" fontSize={font*.8}>{c.text}</text>;})}
  </g>
 </svg>:<div className="room-plan-unconfigured"><p>空间布局尚未设定</p><small>先按地点查看；有户型数据后显示比例平面。</small><div>{rooms.map((room:any)=><button key={room.id} disabled={room.metadata?.locked} onClick={()=>activate(room)}>{room.name}</button>)}</div></div>}
 <footer><span><i className="location-dot" data-actor="user"/>你的位置</span><span><i className="location-dot" data-actor="character"/>角色位置</span></footer>{geometry&&<small className="plan-scale-note">按场景设定比例 · 点击区域查看或前往</small>}
 <div className="room-actor-details" aria-label="具体位置">{contains({id:parent},map.actorLocations?.user||'')&&<p data-actor-id="user"><i className="location-dot" data-actor="user"/><strong>你</strong><span>{tree.byId.get(map.actorLocations?.user||'')?.name||'具体区域未定位'}</span></p>}{actors.filter(a=>!a.enRoute&&contains({id:parent},a.locationId)).map(a=><p key={a.roleId} data-actor-id={a.roleId}><i className="location-dot" data-actor="character"/><strong>{a.name}</strong><span>{compact?tree.byId.get(a.locationId)?.name:tree.label(a.locationId)}{!compact&&a.activity?' · '+a.activity:''}</span></p>)}</div></div>;
}
