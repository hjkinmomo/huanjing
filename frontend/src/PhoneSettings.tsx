import {PhoneAlbum} from './PhoneAlbum';
import {useEffect,useState} from 'react';
import {localMedia} from '../../web/assets/experience/phone-local.mjs';
import {importWallpaper,savePhonePreferences,notificationSound} from '../../web/assets/experience/phone-preferences.mjs';
import {UiIcon} from './UiIcon';
export function PhoneSettings({preferences:p,quick=false,embedded=false,close,mode='normal'}:{preferences:any;quick?:boolean;embedded?:boolean;close?:()=>void;mode?:string}){
 const [media,setMedia]=useState<any[]>([]),[error,setError]=useState(''),[target,setTarget]=useState('wallpaper'),[album,setAlbum]=useState(false);
 useEffect(()=>{localMedia.list().then(setMedia).catch(e=>setError(e.message));},[]);
 async function upload(file?:File){if(!file)return;setError('');try{const record=await importWallpaper(file);setMedia(await localMedia.list());savePhonePreferences({[target]:record.id});}catch(e){setError(e instanceof Error?e.message:'图片未保存');}}
 return <section className={quick?'phone-control-sheet':'phone-settings'} aria-label={embedded?'控制选项':quick?'手机控制中心':'手机设置'}>
 {quick&&!embedded&&<header><h3>控制中心</h3><button title="收起" aria-label="收起控制中心" onClick={close}><UiIcon name="up"/></button></header>}
 <label className="phone-dnd-setting"><span><UiIcon name="clock"/>免打扰</span><input type="checkbox" aria-label="免打扰" checked={p.doNotDisturb===true} onChange={e=>savePhonePreferences({doNotDisturb:e.target.checked})}/></label><small>开启后静音全部消息提示，通知和红点仍保留。</small>
 <label><span><UiIcon name="sun"/>屏幕亮度</span><input type="range" min=".45" max="1" step=".05" value={p.brightness} onChange={e=>savePhonePreferences({brightness:Number(e.target.value)})}/></label>
 <label><span><UiIcon name="volume"/>提示音</span><input type="checkbox" checked={p.sound} onChange={e=>savePhonePreferences({sound:e.target.checked})}/></label>
 <label><span>音量</span><input type="range" min="0" max="1" step=".05" value={p.volume} onChange={e=>savePhonePreferences({volume:Number(e.target.value)})}/></label><button onClick={()=>notificationSound(true)}>试听提示音</button><label><span><UiIcon name="clock"/>夜间免打扰</span><input type="checkbox" checked={p.quietHours!==false} onChange={e=>savePhonePreferences({quietHours:e.target.checked})}/></label><small>按故事时间 23:00 至 08:00 静音，红点仍会保留。</small>
 {!quick&&<><h3>壁纸</h3><div className="phone-segment"><button aria-pressed={target==='wallpaper'} onClick={()=>setTarget('wallpaper')}>主屏幕</button><button aria-pressed={target==='chatWallpaper'} onClick={()=>setTarget('chatWallpaper')}>微聊背景</button></div><div className="phone-wallpapers">{['sage','paper','rose','night'].map(id=><button className="phone-wallpaper-swatch" data-wallpaper={id} aria-label={'使用'+({sage:'青绿',paper:'米白',rose:'蔷薇',night:'夜色'} as any)[id]+'壁纸'} aria-pressed={p[target]===id} key={id} onClick={()=>savePhonePreferences({[target]:id})}/>)}</div>
 <button className="phone-profile-row" onClick={()=>setAlbum(true)}><UiIcon name="image"/>打开相册<UiIcon name="right"/></button>{album&&<PhoneAlbum mode={mode} close={()=>setAlbum(false)} choose={id=>{savePhonePreferences({[target]:id});setAlbum(false);}}/>}
</>}{error&&<p role="alert">{error}</p>}
 </section>;
}
function SavedWallpaper({item,choose,remove}:{item:any;choose:()=>void;remove:()=>void}){const [url,setUrl]=useState('');useEffect(()=>{const u=URL.createObjectURL(item.blob);setUrl(u);return()=>URL.revokeObjectURL(u);},[item]);return <article><button title={item.name} onClick={choose}><img src={url} alt={item.name}/></button><button title="删除壁纸" aria-label={'删除 '+item.name} onClick={remove}><UiIcon name="close"/></button></article>;}
