import {useEffect,useRef,useState} from 'react';
import {UiIcon} from './UiIcon';
import {PhoneSettings} from './PhoneSettings';
import {phoneNotificationScope,phoneNotificationCandidates,mergePhoneNotifications,dismissPhoneNotifications} from '../../web/assets/experience/phone-notifications.mjs';
import type {PhoneFeed,PhoneNotice} from '../../web/assets/experience/phone-notifications.mjs';
import type {ChatSnapshot} from './chat-types';
export function usePhoneNotifications(s:ChatSnapshot,groups:any){
 const scope=phoneNotificationScope(s),storageKey='huanjing_phone_notifications_v1:'+scope;
 const candidates=phoneNotificationCandidates(s,groups),signature=JSON.stringify(candidates);
 const [value,setValue]=useState<{scope:string;feed:PhoneFeed}>({scope:'',feed:{items:[],dismissed:{}}});
 useEffect(()=>{
  let previous:Partial<PhoneFeed>={};try{previous=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
  const feed=mergePhoneNotifications(previous,candidates);setValue({scope,feed});try{localStorage.setItem(storageKey,JSON.stringify(feed));}catch{}
 },[scope,signature]);
 function dismiss(keys:string[]){setValue(prior=>{if(prior.scope!==scope)return prior;const feed=dismissPhoneNotifications(prior.feed,keys);try{localStorage.setItem(storageKey,JSON.stringify(feed));}catch{}return {scope,feed};});}
 return {items:value.scope===scope?value.feed.items:[],dismiss};
}
export function PhoneSystemPanel({kind,preferences,mode,items,close,openNotice,dismiss}:{kind:'notifications'|'controls';preferences:any;mode:string;items:PhoneNotice[];close:()=>void;openNotice:(item:PhoneNotice)=>void;dismiss:(keys:string[])=>void}){
 const back=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const trigger=document.activeElement as HTMLElement;back.current?.focus({preventScroll:true});return()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
 return <section className="phone-system-panel" aria-label={kind==='notifications'?'手机通知中心':'手机控制中心'} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
  <header><button ref={back} type="button" aria-label="返回手机" title="返回手机" onClick={close}><UiIcon name="back"/></button><h2>{kind==='notifications'?'通知中心':'控制中心'}</h2>{kind==='notifications'&&items.length>0&&<button type="button" className="phone-notices-clear" onClick={()=>dismiss(items.map(n=>n.key))}>清除全部</button>}</header>
  <div className="phone-system-panel-content">{kind==='controls'?<PhoneSettings mode={mode} preferences={preferences} quick embedded/>:<>{items.length===0?<div className="phone-notices-empty"><UiIcon name="message"/><h3>暂时没有通知</h3><p>微聊、外卖、出行和兼职有更新时，会显示在这里。</p></div>:<div className="phone-notices-list">{items.map(item=><article key={item.key} data-notice-app={item.app}><button type="button" className="phone-notice-open" onClick={()=>openNotice(item)}><small>{({chat:'微聊',groups:'微聊群',delivery:'美兔',travel:'轻途出行',work:'兼职',shop:'淘乐乐'} as any)[item.app]}</small><strong>{item.title}</strong><p>{item.body}</p></button><button type="button" className="phone-notice-dismiss" title="清除此通知" aria-label={'清除通知：'+item.title} onClick={()=>dismiss([item.key])}><UiIcon name="close"/></button></article>)}</div>}</> }</div>
 </section>;
}
