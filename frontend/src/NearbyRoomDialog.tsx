import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {nearbyRoom} from '../../web/assets/experience/nearby-room.mjs';
import type {NearbyRoomRequest} from '../../web/assets/experience/nearby-room.mjs';
import type {ChatActions,ChatSnapshot} from './chat-types';

// 同场景点击房间 = 直接移动（momo 指定，2026-10-15）：成功由应用层轻提示“已到 X”，失败才回退本对话框展示原因。
export function NearbyRoomDialog({snapshot:s,actions}:{snapshot:ChatSnapshot;actions:ChatActions}){
 const [request,setRequest]=useState<NearbyRoomRequest|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),current=useRef(request),trigger=useRef<HTMLElement|null>(null),inFlight=useRef(false);
 current.current=request;
 const origin=s.worldLife?.user?.locationId||s.worldMap?.actorLocations?.user||'',mode=s.personaMode||'normal',identity=s.worldLife?.identityBank?.active?.id||'';
 const latest=useRef({s,actions,origin,mode,identity});latest.current={s,actions,origin,mode,identity};
 function close(){setRequest(null);setError('');}
 async function attempt(req:NearbyRoomRequest){
  if(inFlight.current)return;
  const act=latest.current.actions;
  inFlight.current=true;setBusy(true);
  try{if(!act.moveNearbyRoom)throw Error('位置服务尚未连接，请稍后再试。');await act.moveNearbyRoom(req);if(current.current===req||!current.current)close();}
  catch(e){setRequest(req);setError(e instanceof Error?e.message:'位置未切换，请重试。');}
  finally{inFlight.current=false;setBusy(false);}
 }
 useEffect(()=>{const receive=(e:Event)=>{if(inFlight.current)return;const detail=(e as CustomEvent).detail,now=latest.current;
  if(!detail||detail.mode!==now.mode||detail.originId!==now.origin||detail.identityId!==now.identity||!nearbyRoom(now.s.worldMap?.locations||[],now.origin,detail.locationId))return;
  if(now.s.busy||now.s.worldLife?.transport?.current||detail.locationId===now.origin)return;
  trigger.current=document.activeElement as HTMLElement;setError('');
  void attempt({...detail,requestId:crypto.randomUUID()});
 };window.addEventListener('huanjing:nearby-room',receive);return()=>window.removeEventListener('huanjing:nearby-room',receive);},[]);
 useEffect(()=>{close();},[origin,mode,identity]);
 useEffect(()=>{const node=dialog.current;if(!node)return;if(request&&!node.open)node.showModal();else if(!request&&node.open){node.close();if(trigger.current?.isConnected)trigger.current.focus?.({preventScroll:true});}},[request]);
 const place=request?nearbyRoom(s.worldMap?.locations||[],origin,request.locationId):null,here=request?.locationId===origin;
 return createPortal(<dialog ref={dialog} className="nearby-room-dialog" aria-labelledby="nearby-room-title" onCancel={e=>{e.preventDefault();if(!inFlight.current)close();}}>
  <h3 id="nearby-room-title">{here?'你就在这里':(error?'未能前往':'前往')+(place?.name||'这个房间')+(error?'':'？')}</h3>
  {here?<p>可以继续留在当前房间。</p>:error?<p className="nearby-room-error" role="alert">{error}</p>:<p>同场景移动不增加时间或消耗金币。</p>}
  <footer><button type="button" disabled={busy} onClick={close}>留在这里</button><button type="button" className="primary" disabled={busy||s.busy||here||!place} onClick={()=>{if(request)void attempt(request);}}>{busy?'正在切换位置…':error?'重试前往':'前往这里'}</button></footer>
 </dialog>,document.body);
}
