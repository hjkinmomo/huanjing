import {mayPlayNotification} from './notification-policy.mjs';
import {localMedia} from './phone-local.mjs';
const KEY='huanjing_phone_preferences_v2';
export function phonePreferences(){try{return {brightness:1,volume:.35,sound:true,doNotDisturb:false,quietHours:true,nickname:'',signature:'',wallpaper:'sage',chatWallpaper:'paper',contacts:{},...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{return {brightness:1,volume:.35,sound:true,doNotDisturb:false,quietHours:true,wallpaper:'sage',chatWallpaper:'paper',contacts:{}};}}
export function savePhonePreferences(patch){const next={...phonePreferences(),...patch};localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new Event('huanjing:phone-preferences'));return next;}
export async function importWallpaper(file,options={}){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw Error('请选择 12 MB 以内的 PNG、JPEG 或 WebP 图片。');
 const bitmap=await createImageBitmap(file),ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));if(bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('图片尺寸过大，请先缩小。');}
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('图片没有保存成功')),'image/jpeg',.85));
 const record={id:crypto.randomUUID(),name:file.name.slice(0,100),at:new Date().toISOString(),blob,...(['normal','special'].includes(options.mode)?{mode:options.mode}:{}),source:options.source||'import'};await localMedia.save(record);return record;
}
let audio,unlocked=false,last=0,worldHour=null;
export function notificationWorldClock(worldUtc,offset=480){const at=Date.parse(worldUtc);worldHour=Number.isFinite(at)?new Date(at+offset*60000).getUTCHours():null;}
export function unlockPhoneAudio(){unlocked=true;try{audio||=new AudioContext();audio.resume().catch(()=>{});}catch{}}
export function notificationSound(preview=false){const p=phonePreferences();if(!unlocked||!mayPlayNotification(p,worldHour,last,performance.now(),preview===true))return;last=performance.now();try{audio||=new AudioContext();const t=audio.currentTime;for(const [i,f] of [740,980].entries()){const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,t+i*.13);g.gain.linearRampToValueAtTime(Math.min(.15,p.volume*.18),t+i*.13+.01);g.gain.exponentialRampToValueAtTime(.001,t+i*.13+.17);o.connect(g);g.connect(audio.destination);o.start(t+i*.13);o.stop(t+i*.13+.19);}}catch{}}
if(typeof window!=='undefined'){window.addEventListener('pointerdown',unlockPhoneAudio,{once:true});window.addEventListener('keydown',unlockPhoneAudio,{once:true});window.addEventListener('huanjing:notification',notificationSound);}
