import {UiIcon} from './UiIcon';
import {useEffect,useRef,useState} from 'react';
import {WorldDirectory} from './WorldDirectory';
import type {ChatActions,ChatSnapshot} from './chat-types';

// One directory and one renderer, displayed inline or in the native top layer.
export function PhoneWorldMap({snapshot:s,actions,close,focusId='',active=true}:{focusId?:string;active?:boolean;snapshot:ChatSnapshot;actions:ChatActions;close:()=>void}){
 const [expanded,setExpanded]=useState(false),dialog=useRef<HTMLDialogElement>(null),expectedClose=useRef(0);
 useEffect(()=>{const node=dialog.current;if(!node)return;if(node.open){expectedClose.current++;node.close();}if(active){if(expanded)node.showModal();else node.show();}},[expanded,active]);
 useEffect(()=>()=>{const node=dialog.current;if(node?.open){expectedClose.current++;node.close();}},[]);
 const main=()=>{close();actions.navigate('chat');};
 return <dialog ref={dialog} className="phone-world-dialog" aria-label="都市地图" data-expanded={expanded} onCancel={e=>{e.stopPropagation();e.preventDefault();setExpanded(false);}} onClose={e=>{e.stopPropagation();if(expectedClose.current){expectedClose.current--;return;}setExpanded(false);}}>
  <header className="phone-map-nav"><button type="button" onClick={()=>setExpanded(!expanded)} title={expanded?'收起全屏地图':'展开全屏地图'} aria-label={expanded?'收起全屏地图':'展开全屏地图'}><UiIcon name={expanded?'left':'expand'}/></button><strong>{s.worldMap?.name||'地图'}</strong>{expanded&&<><button type="button" className="dialog-main-chat" aria-label="回到主聊天" onClick={main}>回到聊天</button><button type="button" aria-label="关闭全屏地图" onClick={()=>setExpanded(false)}><UiIcon name="close"/></button></>}</header>
  <div className="phone-map-content">
   {s.worldMap?<WorldDirectory focusId={focusId} map={s.worldMap} actions={actions} busy={s.busy} embedded/>:<div className="phone-no-world"><h3>这段对话还没有选择世界</h3><p>新建聊天时选择都市与起点，地图就会显示其中的建筑与房间。</p><button type="button" onClick={()=>{close();actions.newConversation?.();}}>新建有地图的对话</button></div>}
  </div>
  <footer className="phone-map-footer"><span>{s.personaMode==='special'?'特殊都市 · 包含基础城区与特殊地点':'都市 · 基础城区'}</span><button type="button" onClick={()=>{close();actions.openWorldEditor?.();}}>增加／编辑场景</button></footer>
 </dialog>;
}

