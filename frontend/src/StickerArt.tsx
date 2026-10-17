import {useEffect,useState} from 'react';
import type {StickerSprite} from '../../web/assets/experience/sticker-catalog.mjs';
export function StickerArt({src,label,sprite,className='',loading}:{src:string;label:string;sprite?:StickerSprite;className?:string;loading?:'lazy'|'eager'}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src,sprite?.rect.join(',')]);
 if(failed)return <span className={`sticker-fallback ${className}`}>{label}</span>;
 if(!sprite)return <img className={className} src={src} alt={label} loading={loading} onError={()=>setFailed(true)}/>;
 const [l,t,r,b]=sprite.rect,[w,h]=sprite.size,fw=r-l,fh=b-t;
 return <span className={`sticker-atlas ${className}`} role="img" aria-label={label} style={{aspectRatio:`${fw} / ${fh}`}} data-sticker-frame={`${l},${t},${r},${b}`}><img src={src} alt="" loading={loading} onError={()=>setFailed(true)} style={{position:'absolute',width:`${w/fw*100}%`,height:`${h/fh*100}%`,maxWidth:'none',maxHeight:'none',left:`${-l/fw*100}%`,top:`${-t/fh*100}%`,objectFit:'fill'}}/></span>;
}
