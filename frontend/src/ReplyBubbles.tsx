import {phoneReplyParts} from '../../web/assets/experience/phone-core.mjs';
import {useEffect,useState} from 'react';
import {normalizeReveal,revealCost,revealedParts,type RevealConfig} from '../../web/assets/experience/reply-reveal.mjs';
import {MessageContent} from './MessageContent';
import {replyParts} from '../../web/assets/experience/reply-parts.mjs';
import {StickerArt} from './StickerArt';
export function ReplyBubbles({text,roleId,phone=false,streaming=false,presentation=true,animate=false,reveal,onRevealDone}:{text:string;roleId:string;phone?:boolean;streaming?:boolean;presentation?:boolean;animate?:boolean;reveal?:RevealConfig;onRevealDone?:()=>void}){
 text=text.replace(/\[\[binding:[A-Za-z0-9_.:-]+:(?:accept|decline|revoke)\]\]/g,'');
 const parts=phone?phoneReplyParts(text,roleId,streaming):replyParts(text,roleId,streaming,presentation);
 const [cursor,setCursor]=useState(0),[skip,setSkip]=useState(false);
 const [config]=useState(()=>normalizeReveal(reveal));
 const [reduced,setReduced]=useState(()=>document.documentElement.dataset.reduced==='true');
 useEffect(()=>{const observer=new MutationObserver(()=>setReduced(document.documentElement.dataset.reduced==='true'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced']});return()=>observer.disconnect();},[]);
 const total=revealCost(parts,config),playing=animate&&!skip&&!reduced&&cursor<total;
 useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setCursor(n=>n+1),config.intervalMs);return()=>clearInterval(timer);},[playing,config.intervalMs]);
 const shown=animate&&!skip&&!reduced?revealedParts(parts,cursor,config):parts;
 useEffect(()=>{if(animate&&!playing&&!streaming&&parts.length)onRevealDone?.();},[animate,playing,streaming,parts.length,onRevealDone]);
  return <><div className="reply-bubbles" data-revealing={playing}>{shown.map((part,i)=>part.kind==='scene'?<aside className="reply-scene" key={i} data-part="scene" aria-label="场景旁白"><MessageContent text={part.text}/></aside>:part.kind==='inner'?<details className="reply-inner" key={i} data-part="inner"><summary title="角色在这一幕中的内心描写">心里话</summary><MessageContent text={part.text}/></details>:<div className="reply-bubble" key={i} data-part={part.kind} data-segment={i}>{part.kind==='sticker'?<StickerArt src={part.src!} sprite={part.sprite} label={`${part.text}表情`} className="reply-sticker"/>:<MessageContent text={part.text}/>}</div> )}</div>{playing&&<button type="button" className="reveal-skip" onClick={()=>setSkip(true)}>立即显示整条回复</button>}</>;
}
