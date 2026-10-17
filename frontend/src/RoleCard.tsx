import {UiIcon} from './UiIcon';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {FX_PALETTES,normalizeCardFx} from '../../web/assets/experience/card-fx-config.mjs';
import {CARD_MATERIALS,CARD_DISPLAYS,normalizeCardDisplay} from '../../web/assets/experience/card-display-config.mjs';
import {CardDisplayPicker} from './CardDisplayPicker';
import type {ChatSnapshot,ChatActions} from './chat-types';
const stages=[['none','素净'],['halo','柔光'],['flow','流光'],['portal','传送门'],['aurora','极光'],['stars','星幕']] as const;
export function RoleCard({snapshot:s,actions,imageId='portrait',active:requestedActive=true}:{snapshot:ChatSnapshot;actions:ChatActions;imageId?:string;active?:boolean}){
  const frame=useRef<HTMLIFrameElement>(null),host=useRef<HTMLDivElement>(null),latest=useRef(s),request=useRef(0);
  const environment=useRef<()=>void>(()=>{});
  const identity=JSON.stringify([s.roleId,s.name,s.portrait]);
  const [status,setStatus]=useState('loading'),[plainIdentity,setPlainIdentity]=useState<string|null>(null),[readyIdentity,setReadyIdentity]=useState(''),[errorIdentity,setErrorIdentity]=useState(''),[flipped,setFlipped]=useState(false);
  const plain=plainIdentity===identity,failed=errorIdentity===identity,loading=!!s.portrait&&!failed&&readyIdentity!==identity;
  latest.current=s;
  const fx=normalizeCardFx(s.cardFx);
  const display=normalizeCardDisplay(s.cardDisplay),[picker,setPicker]=useState(false);
  const [previewArt,setPreviewArt]=useState<{subject:string;background:string;fit:number[];offset:number[];scale:number}|undefined>();
  const send=(data:object)=>frame.current?.contentWindow?.postMessage(data,location.origin);
  const effects=()=>{const v=latest.current;send({type:'hermes-card:effects',style:v.cardStage||'halo',...normalizeCardFx(v.cardFx),themeColor:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),scheme:getComputedStyle(document.documentElement).colorScheme});};
  const update=()=>{const v=latest.current;send({type:'hermes-card:update',roleId:v.roleId,name:v.name,portrait:v.portrait,finish:v.cardFinish||'pearl',display:normalizeCardDisplay(v.cardDisplay),relationship:v.relationship,affinity:v.affinity,request:request.current});effects();};
  useEffect(()=>{
    function receive(e:MessageEvent){
      if(e.origin!==location.origin||e.source!==frame.current?.contentWindow)return;
      if(e.data?.type==='hermes-card:boot'){update();environment.current();}
      if(e.data?.type==='hermes-card:ready'&&e.data.request===request.current){setStatus(e.data.mode);setReadyIdentity(JSON.stringify([latest.current.roleId,latest.current.name,latest.current.portrait]));setErrorIdentity('');setFlipped(false);if(e.data.art)setPreviewArt(e.data.art);}
      if(e.data?.type==='hermes-card:error'&&(e.data.request===undefined||e.data.request===request.current)){setStatus('error');setErrorIdentity(JSON.stringify([latest.current.roleId,latest.current.name,latest.current.portrait]));}
      if(e.data?.type==='hermes-card:state')setFlipped(e.data.flipped===true);
    }
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[]);
  useLayoutEffect(()=>{request.current++;setStatus('loading');setErrorIdentity('');setFlipped(false);setPlainIdentity(null);setPreviewArt(undefined);update();},[s.roleId,s.name,s.portrait]);
  useEffect(()=>{if(!loading)return;const timer=setTimeout(()=>{setStatus('error');setErrorIdentity(identity);},15000);return()=>clearTimeout(timer);},[loading,identity]);
  useEffect(()=>{send({type:'hermes-card:metadata',relationship:s.relationship,affinity:s.affinity});},[s.relationship,s.affinity]);
  useEffect(()=>{send({type:'hermes-card:command',command:'finish',finish:s.cardFinish||'pearl'});},[s.cardFinish]);
  useEffect(()=>{send({type:'hermes-card:command',command:'display',display});},[display]);
  useEffect(()=>setPicker(false),[s.roleId]);
  useEffect(()=>effects(),[s.cardStage,fx.palette,fx.color,fx.dragEffects]);
  useEffect(()=>{
    let visible=false;let layoutFrame=0;const media=matchMedia('(prefers-reduced-motion: reduce)');
    const notify=()=>{const css=getComputedStyle(document.documentElement),active=requestedActive&&visible&&!document.hidden&&!plain;if(host.current)host.current.dataset.active=String(active);send({type:'hermes-card:environment',active,reduced:media.matches||document.documentElement.dataset.reduced==='true',fit:document.documentElement.dataset.portraitFit,background:'transparent',scheme:css.colorScheme});effects();};
    environment.current=notify;notify();
    const resized=()=>{cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{notify();send({type:'hermes-card:resize'});});};
    const box=new ResizeObserver(resized);if(host.current)box.observe(host.current);
    window.addEventListener('huanjing:scale-change',resized);window.addEventListener('resize',resized);
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;notify();if(visible)resized();});if(host.current)observer.observe(host.current);
    const attrs=new MutationObserver(notify);attrs.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced','data-portrait-fit','data-theme','style']});
    document.addEventListener('visibilitychange',notify);media.addEventListener('change',notify);frame.current?.addEventListener('load',notify);
    return()=>{cancelAnimationFrame(layoutFrame);box.disconnect();window.removeEventListener('huanjing:scale-change',resized);window.removeEventListener('resize',resized);observer.disconnect();attrs.disconnect();document.removeEventListener('visibilitychange',notify);media.removeEventListener('change',notify);frame.current?.removeEventListener('load',notify);};
  },[plain,requestedActive]);
  const loaded=readyIdentity===identity&&['webgl','css3d'].includes(status)&&!plain,frameVisible=!!readyIdentity&&!plain&&!failed;
  return <div className="role-card" ref={host} data-loaded={loaded} data-loading={loading&&!plain} data-stage={s.cardStage||'halo'} data-plain={plain}>
    <div className="role-card-art">
      {!s.portrait&&<div className="card-empty" aria-label="尚未添加角色图片"><span>{s.name.slice(0,1)}</span></div>}<img key={s.portrait} id={imageId} className="card-original" src={(plain||failed)?s.portrait||undefined:undefined} alt={`${s.name}的立绘`} hidden={!s.portrait||(!plain&&!failed)} onError={e=>{e.currentTarget.hidden=true;}}/>
    {s.portrait&&<iframe ref={frame} title={`${s.name}的可互动角色卡`} src="./assets/experience/role-card/index.html?v=gap-closure-20261014" className="role-card-frame" style={{visibility:frameVisible?'visible':'hidden',pointerEvents:loaded?'auto':'none'}} onLoad={()=>{update();environment.current();}}/>}
    {loading&&!plain&&<div className="card-loading" data-retained={!!readyIdentity} role="status"><span>正在装裱…</span></div>}
    </div>
    <details className="role-card-settings"><summary>闪光卡设置<UiIcon name="down"/></summary><div className="role-card-toolbar" aria-label="角色卡操作">
      <div className="card-buttons"><button type="button" disabled={!loaded} aria-pressed={flipped} onClick={()=>send({type:'hermes-card:command',command:'flip'})}>翻面</button><button type="button" disabled={!loaded} onClick={()=>{send({type:'hermes-card:command',command:'reset'});setFlipped(false);}}>复位</button><button type="button" disabled={!s.portrait} aria-pressed={plain} onClick={()=>setPlainIdentity(plain?null:identity)}>{plain?'显示卡片':'查看原图'}</button></div>
      <div className="card-appearance"><label className="card-stage-label">背景<select aria-label="立绘区域背景" value={s.cardStage||'halo'} onChange={e=>actions.cardStageChanged?.(e.target.value)}>{stages.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label className="card-finish-label">材质<select aria-label="角色卡材质" value={s.cardFinish||'pearl'} onChange={e=>actions.cardFinishChanged?.(e.target.value)}>{CARD_MATERIALS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="card-display-label">卡面<select aria-label="卡面选择" value={display} onChange={e=>actions.cardDisplayChanged?.(e.target.value)}>{CARD_DISPLAYS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label></div>
      <button type="button" className="card-display-preview" disabled={!s.portrait} onClick={()=>setPicker(true)}>预览卡面</button>
      <div className="card-fx-options">
        <label className="card-palette-label">配色<select aria-label="角色卡光效配色" value={fx.palette} disabled={s.cardStage==='none'} onChange={e=>actions.cardFxChanged?.({palette:e.target.value})}>{FX_PALETTES.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        {fx.palette==='custom'&&<input className="card-fx-color" aria-label="自选光效颜色" type="color" value={fx.color} disabled={s.cardStage==='none'} onChange={e=>actions.cardFxChanged?.({color:e.target.value})}/>}
        <label className="card-drag-fx"><input type="checkbox" aria-label="拖动光效" checked={fx.dragEffects} disabled={s.cardStage==='none'} onChange={e=>actions.cardFxChanged?.({dragEffects:e.target.checked})}/>拖动光效</label>
      </div>
      <span className="card-hint">{!s.portrait?'可在角色资料中添加图片':plain?'原始立绘':status==='css3d'?'轻量显示 · 拖动转动':status==='error'?'卡片暂不可用，显示原图':status==='loading'?'正在装裱…':'轻拖倾斜 · 用力横拖翻面'}</span>
    </div></details>
    {picker&&<CardDisplayPicker name={s.name} portrait={s.portrait} art={previewArt} value={display} onChoose={id=>actions.cardDisplayChanged?.(id)} onClose={()=>setPicker(false)}/>}
  </div>;
}

