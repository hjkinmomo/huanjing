import {INSTRUMENTS} from './instrument-catalog.mjs';
export const PIANO_NOTES=Object.freeze([0,2,4,5,7,9,11,12,14,16,17,19,21,23,24].map((semitone,i)=>Object.freeze({index:i,frequency:261.625565*2**(semitone/12),name:['Do','Re','Mi','Fa','Sol','La','Si'][i%7],octave:4+Math.floor(i/7),key:'qwertasdfgzxcvb'[i]})));
// Original short melodies; not extracted game audio or scores.
export const PIANO_SONGS=Object.freeze([
 {id:'evening',name:'晚风小调',bpm:84,notes:[0,2,4,7,6,4,2,1,0,2,4,6,7,4,2,0]},
 {id:'letter',name:'蓝笺回声',bpm:72,notes:[4,6,7,9,7,6,4,2,4,6,9,11,9,7,6,4]},
 {id:'garden',name:'花园散步',bpm:104,notes:[0,1,2,4,2,1,0,4,5,7,9,7,5,4,2,0]}
].map(s=>Object.freeze({...s,events:Object.freeze(s.notes.map((note,i)=>Object.freeze({note,beat:i}))),beats:s.notes.length})));
export const RECORDING_KEY='hermes-piano-recordings-v1';
export function validateEvents(events){
 if(!Array.isArray(events)||events.length<1||events.length>256)throw Error('曲谱需要 1–256 个音符。');
 let previous=-1;
 return events.map(e=>{if(!e||!Number.isInteger(e.note)||e.note<0||e.note>=15||!Number.isFinite(e.beat)||e.beat<0||e.beat>600||e.beat<previous||('duration' in e&&(!Number.isFinite(e.duration)||e.duration<.04||e.duration>168)))throw Error('曲谱音符或时间无效。');previous=e.beat;return {note:e.note,beat:e.beat,...('duration' in e?{duration:e.duration}:{})};});
}
export function playbackPlan(events,bpm=84,from=0){
 if(!Number.isFinite(bpm)||bpm<40||bpm>160||!Number.isInteger(from)||from<0||from>events.length)throw Error('播放速度或进度无效。');
 const valid=validateEvents(events),base=valid[from]?.beat||0;
 return valid.slice(from).map((e,i)=>({...e,index:from+i,delay:(e.beat-base)*60000/bpm}));
}
export function readRecording(storage,roleId){
 const raw=storage.getItem(RECORDING_KEY);if(raw===null)return null;
 let store;try{store=JSON.parse(raw);}catch{throw Error('录音存档损坏，原资料未覆盖。');}
 if(!store||typeof store!=='object'||Array.isArray(store)||store.version!==1||!store.roles||typeof store.roles!=='object'||Array.isArray(store.roles))throw Error('录音存档格式异常，原资料未覆盖。');
 const item=Object.hasOwn(store.roles,roleId)?store.roles[roleId]:null;if(!item)return null;
 if(item.bpm!==84||typeof item.name!=='string'||item.name.length>60)throw Error('录音存档格式异常。');
 return {...item,events:validateEvents(item.events)};
}
export function saveRecording(storage,roleId,events,at=new Date().toISOString(),options={}){
 if(!/^[A-Za-z0-9_.:-]{1,80}$/.test(roleId)||!Number.isFinite(Date.parse(at)))throw Error('角色或录制时间无效。');
 const valid=validateEvents(events),raw=storage.getItem(RECORDING_KEY);let store={version:1,roles:{}};
 if(raw!==null){try{store=JSON.parse(raw);}catch{throw Error('录音存档损坏，原资料未覆盖。');}if(!store||store.version!==1||!store.roles||typeof store.roles!=='object'||Array.isArray(store.roles))throw Error('录音存档格式异常，原资料未覆盖。');}
 const item={name:'我的小旋律',bpm:84,events:valid,at,...(INSTRUMENTS.some(i=>i.id===options.instrument)?{instrument:options.instrument}:{})};
 // Computed own property avoids prototype-key collisions without changing other role recordings.
 storage.setItem(RECORDING_KEY,JSON.stringify({...store,updatedAt:new Date().toISOString(),roles:{...store.roles,[roleId]:item}}));globalThis.document?.dispatchEvent?.(new Event('hermes:piano-change'));return item;
}
export function readPianoSettings(storage,roleId){
 const raw=storage.getItem(RECORDING_KEY);if(raw===null)return {instrument:'piano',volume:.35,ambience:.24,release:1.2,overtones:.16};
 let store;try{store=JSON.parse(raw);}catch{throw Error('琴房存档损坏，原资料未覆盖。');}
 if(store?.version!==1||!store.roles||typeof store.roles!=='object'||Array.isArray(store.roles)||(store.preferences!==undefined&&(!store.preferences||typeof store.preferences!=='object'||Array.isArray(store.preferences))))throw Error('琴房存档格式异常。');
 const value=Object.hasOwn(store.preferences||{},roleId)?store.preferences[roleId]:{};
 return {instrument:INSTRUMENTS.some(i=>i.id===value?.instrument)?value.instrument:'piano',volume:Number.isFinite(value?.volume)?Math.max(0,Math.min(1,value.volume)):.35,ambience:Number.isFinite(value?.ambience)?Math.max(0,Math.min(.65,value.ambience)):.24,release:Number.isFinite(value?.release)?Math.max(.15,Math.min(3,value.release)):1.2,overtones:Number.isFinite(value?.overtones)?Math.max(0,Math.min(1,value.overtones)):.16};
}
export function savePianoSettings(storage,roleId,settings){
 if(!/^[A-Za-z0-9_.:-]{1,80}$/.test(roleId))throw Error('角色无效。');
 readPianoSettings(storage,roleId);
 const raw=storage.getItem(RECORDING_KEY),store=raw===null?{version:1,roles:{}}:JSON.parse(raw);
 if(!INSTRUMENTS.some(i=>i.id===settings.instrument)||!Number.isFinite(settings.volume)||settings.volume<0||settings.volume>1||!Number.isFinite(settings.ambience)||settings.ambience<0||settings.ambience>.65)throw Error('乐器设置无效。');
 if(settings.release!==undefined&&(!Number.isFinite(settings.release)||settings.release<.15||settings.release>3)||settings.overtones!==undefined&&(!Number.isFinite(settings.overtones)||settings.overtones<0||settings.overtones>1))throw Error('音色设置无效。');
 storage.setItem(RECORDING_KEY,JSON.stringify({...store,updatedAt:new Date().toISOString(),preferences:{...store.preferences,[roleId]:{...settings}}}));globalThis.document?.dispatchEvent?.(new Event('hermes:piano-change'));
}
export function createTransport({play,changed=()=>{},now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}){
 let timers=[],generation=0,events=[],bpm=84,cursor=0,state='idle',endAt=0;
 const clear=()=>{generation++;timers.forEach(cancel);timers=[];};
 const notify=()=>changed({state,cursor,total:events.length,bpm});
 function start(sequence,tempo=84,from=0){
  const plan=playbackPlan(sequence,tempo,from);clear();events=validateEvents(sequence);bpm=tempo;cursor=from;state='playing';const token=generation;
  const endDelay=Math.max(0,...plan.map(e=>e.delay+(e.duration??1)*60000/bpm));endAt=now()+endDelay;notify();
  const groups=[];for(const e of plan){let group=groups.at(-1);if(!group||group[0].delay!==e.delay){group=[];groups.push(group);}group.push(e);}
  for(const group of groups)timers.push(schedule(()=>{if(token!==generation)return;for(const e of group)play(e.note,e.duration===undefined?null:e.duration*60/bpm);cursor=group.at(-1).index+1;notify();},group[0].delay));
  timers.push(schedule(()=>{if(token!==generation)return;clear();state='finished';cursor=events.length;notify();},endDelay));
 }
 return {start,pause(){if(state!=='playing')return;clear();state='paused';notify();},resume(){if(state==='paused'&&cursor<events.length)start(events,bpm,cursor);else if(state==='paused'){clear();state='finished';notify();}},stop(){clear();state='idle';cursor=0;notify();},snapshot:()=>({state,cursor,total:events.length,bpm,endAt})};
}
