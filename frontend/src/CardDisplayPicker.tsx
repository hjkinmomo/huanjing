import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {CARD_DISPLAYS,cardDisplayAsset} from '../../web/assets/experience/card-display-config.mjs';
import {assembleDisplay,drawDisplayPreview,type DisplaySpec} from '../../web/assets/experience/role-card/display-assembly.mjs';
function DisplayPreview({spec,name}:{spec:DisplaySpec;name:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let active=true;const image=new Image();image.src=cardDisplayAsset(spec.id);image.decode().then(()=>{if(active&&canvas.current)drawDisplayPreview(canvas.current,assembleDisplay(image,spec,name));}).catch(()=>{});return()=>{active=false;};},[spec,name]);
 return <canvas ref={canvas} className="display-sample-frame" aria-hidden="true"/>;
}
export function CardDisplayPicker({name,portrait,art,value,onChoose,onClose}:{name:string;portrait:string;art?:{subject:string;background:string;fit:number[];offset:number[];scale:number};value:string;onChoose:(id:string)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const fit=art?.fit||[1,1],offset=art?.offset||[0,0],scale=art?.scale||1,subjectStyle=art?{left:((1-fit[0]/scale)*50+offset[0]*100/scale)+'%',top:((1-fit[1]/scale)*50+offset[1]*100/scale)+'%',width:fit[0]/scale*100+'%',height:fit[1]/scale*100+'%',objectFit:'fill' as const}:undefined;
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return createPortal(<dialog ref={dialog} className="card-display-picker" aria-labelledby="card-display-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
  <header><div><h2 id="card-display-title">卡片展示</h2><p>先看样式，再挑一套。选择只改变当前角色的卡面。</p></div><button type="button" aria-label="关闭卡面预览" onClick={onClose}>×</button></header>
  <div className="card-display-grid">{CARD_DISPLAYS.map(p=><article key={p.id} className="card-display-sample" data-selected={p.id===value}>
   <div className="card-display-thumbnail">{art?.background&&<img className="display-sample-background" src={art.background} alt=""/>}<img className="display-sample-art" src={art?.subject||portrait||undefined} style={subjectStyle} alt=""/>{p.id!=='none'?<DisplayPreview spec={p} name={name}/>:<span className="display-sample-name" data-frame="false">{name}</span>}</div>
   <h3>{p.label}</h3><p>{p.description}</p><button type="button" aria-pressed={p.id===value} onClick={()=>onChoose(p.id)}>{p.id===value?'正在使用':'使用这套'}</button>
  </article>)}</div>
  <footer>预览是正面排版。选中后可在角色卡上拖动，查看实际悬浮层次和材质。</footer>
 </dialog>,document.body);
}
