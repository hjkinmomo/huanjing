import {useEffect,useState} from 'react';
export function Avatar({src,name,className='',id}:{src:string;name:string;className?:string;id?:string}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src]);
 return <span id={id} className={`chat-avatar ${className}`} aria-hidden="true" data-fallback={!src||failed}>
  <span className="avatar-initial">{Array.from(name)[0]||'人'}</span>
  {src&&!failed&&<img src={src} alt="" width={64} height={64} decoding="async" onError={()=>setFailed(true)}/>}
 </span>;
}
