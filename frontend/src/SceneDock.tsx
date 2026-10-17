import {appViewport} from '../../web/assets/experience/app-scale.mjs';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {DockStatus,DockBag} from './DockContents';
import {WorldDirectory} from './WorldDirectory';
import type {ChatSnapshot,ChatActions} from './chat-types';
const key='huanjing_scene_dock_v2';
export function SceneDock({snapshot:s,actions}:{snapshot:ChatSnapshot;actions:ChatActions;container?:RefObject<HTMLDivElement|null>}){
 const prefs=s.sceneDock||{enabled:true,coins:true,locked:false,size:'standard'},size={compact:58,standard:74,large:90}[prefs.size]||74,height=size;
 const home=()=>({left:appViewport().w-size-24,top:(document.querySelector('.app-header')?.getBoundingClientRect().bottom||76)/appViewport().scale+18});
 const dock=useRef<HTMLDivElement>(null),gesture=useRef<{x:number;y:number;left:number;top:number;pointer:number;moved:boolean}|null>(null),skipClick=useRef(false);
 const [tab,setTab]=useState('status');
 useEffect(()=>{const show=(e:Event)=>{setTab((e as CustomEvent).detail?.tab||'status');setOpen(true);};window.addEventListener('huanjing:dock-open',show);return()=>window.removeEventListener('huanjing:dock-open',show);},[]);
 const [open,setOpen]=useState(false),[peek,setPeek]=useState(false),[dragging,setDragging]=useState(false),[position,setPosition]=useState(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')||home();}catch{return home();}}),[viewport,setViewport]=useState(()=>appViewport());
 const fit=(left:number,top:number)=>({left:Math.min(Math.max(8,Number(left)||8),Math.max(8,appViewport().w-size-8)),top:Math.min(Math.max(8,Number(top)||8),Math.max(8,appViewport().h-height-8))});
 const persist=(p:{left:number;top:number})=>{try{localStorage.setItem(key,JSON.stringify(p));}catch{}};
 useEffect(()=>{setOpen(false);},[s.roleId,s.conversationId,prefs.enabled]);
 useEffect(()=>{const resize=()=>{setViewport(appViewport());setPosition((p:{left:number;top:number})=>fit(p.left,p.top));};const reset=()=>{const start=home(),p=fit(start.left,start.top);setPosition(p);persist(p);};resize();window.addEventListener('resize',resize);window.addEventListener('huanjing:scale-change',resize);window.addEventListener('huanjing:scene-dock-reset',reset);return()=>{window.removeEventListener('resize',resize);window.removeEventListener('huanjing:scale-change',resize);window.removeEventListener('huanjing:scene-dock-reset',reset);};},[size,height]);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!dock.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);dock.current?.querySelector<HTMLButtonElement>('button')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 const place=s.worldMap?.locations.find(p=>p.id===s.worldMap?.currentId)?.name||s.scene?.location||'未设地点',peekWidth=Math.min(180,viewport.w-24),peekLeft=Math.max(12-position.left,Math.min(position.left>viewport.w/2?-peekWidth-10:size+10,viewport.w-position.left-peekWidth-12)),peekTop=Math.max(12-position.top,Math.min(4,viewport.h-position.top-72-12));
 const above=position.top>viewport.h/2,panelWidth=Math.min(tab==='map'?620:440,viewport.w-24),left=Math.max(12-position.left,Math.min(0,viewport.w-position.left-panelWidth-12)),coins=s.initializing||s.coins===undefined?'…':Intl.NumberFormat('zh-CN').format(Math.max(0,s.coins));
 if(!prefs.enabled)return null;
 return createPortal(<div ref={dock} className="scene-dock" data-open={open} data-side={above?'above':'below'} data-dragging={dragging} data-locked={prefs.locked} style={{left:position.left,top:position.top,width:size,height}}>
  <button type="button" className="scene-dock-toggle" style={{width:size,height}} aria-label={open?'收起场景与世界':'展开场景与世界'} aria-expanded={open} aria-controls="scene-dock-panel" aria-describedby={peek&&!open&&!dragging?'scene-dock-peek':undefined} onPointerEnter={e=>{if(e.pointerType!=='touch')setPeek(true);}} onPointerLeave={()=>setPeek(false)} onFocus={e=>{if(e.currentTarget.matches(':focus-visible'))setPeek(true);}} onBlur={()=>setPeek(false)} onPointerDown={e=>{setPeek(false);skipClick.current=false;if(e.button!==0||prefs.locked)return;gesture.current={x:e.clientX,y:e.clientY,...position,pointer:e.pointerId,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>5)g.moved=true;if(g.moved){setDragging(true);setPosition(fit(g.left+(e.clientX-g.x)/appViewport().scale,g.top+(e.clientY-g.y)/appViewport().scale));}}} onPointerUp={e=>{const g=gesture.current;if(!g)return;skipClick.current=g.moved;gesture.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);const p=fit(g.left+(e.clientX-g.x)/appViewport().scale,g.top+(e.clientY-g.y)/appViewport().scale);setPosition(p);persist(p);}} onPointerCancel={()=>{gesture.current=null;setDragging(false);skipClick.current=true;}} onClick={()=>{setPeek(false);if(skipClick.current){skipClick.current=false;return;}setOpen(!open);}} onKeyDown={e=>{const d:Record<string,number[]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(d[e.key]){e.preventDefault();if(prefs.locked)return;const p=fit(position.left+d[e.key][0],position.top+d[e.key][1]);setPosition(p);persist(p);}}}>
   <img className="scene-dock-carrier" style={{width:size,height:size}} src="/assets/experience/media/huanjing/map-badge.png" alt="" draggable={false} onDragStart={e=>e.preventDefault()} onError={e=>{e.currentTarget.hidden=true;}}/><span className="dock-emblem" aria-hidden="true">⌖</span>

  </button>
  {peek&&!open&&!dragging&&<div id="scene-dock-peek" className="scene-dock-peek" role="tooltip" style={{width:peekWidth,left:peekLeft,top:peekTop}}><span className="dock-peek-place">{place}</span>{prefs.coins&&<span className="dock-peek-coins"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M12.5 6.5h-4v3h3v3h-4"/></svg><span>{coins} 金币</span></span>}</div>}
  {open&&<section id="scene-dock-panel" className="scene-dock-panel" aria-label="场景与世界" style={{width:panelWidth,left,...(above?{bottom:height+8,maxHeight:Math.max(150,position.top-20)}:{top:height+8,maxHeight:Math.max(150,viewport.h-position.top-height-20)})}}>
   <header><strong>随身面板</strong><button type="button" aria-label="关闭场景与世界" onClick={()=>setOpen(false)}>×</button></header>
   <nav className="dock-view-tabs" aria-label="随身面板内容">{[['status','当前状态'],['map','地图'],['bag','背包']].map(([value,label])=><button type="button" key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}</button>)}</nav>
   {tab==='status'&&<DockStatus snapshot={s} actions={actions} coins={coins} showMap={()=>setTab('map')} close={()=>setOpen(false)}/>}
   {tab==='map'&&(s.worldMap?<WorldDirectory map={s.worldMap} actions={actions} busy={s.busy} embedded/>:<p>这段聊天尚未绑定世界。新建聊天时可选择都市与初始地点。</p>)}
   {tab==='bag'&&<DockBag snapshot={s} actions={actions} close={()=>setOpen(false)}/>}
   <button type="button" className="dock-reset" onClick={()=>{const start=home(),p=fit(start.left,start.top);setPosition(p);persist(p);}}>复位位置</button>
  </section>}
 </div>,document.body);
}
