import {MUSIC_TRACKS,recommendedMusic} from './music-library.mjs';
import {createMusicPlayer} from './music-player.mjs';
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function mountMusicLibrary({host,title='配乐',getRole=()=>({id:''}),original=null,onBeforePlay=()=>{},volume=.22}={}){
 const listeners=new Set();
 const root=make('section',undefined,'music-library'),heading=make('h3',title),row=make('div',undefined,'music-row');root.setAttribute('aria-label',title);
 const label=make('label','曲目'),select=make('select');select.setAttribute('aria-label',title+'曲目');label.append(select);
 const tracks=[...MUSIC_TRACKS,...(original?[{id:'original',title:'角色原创小调',artist:'Hermes',mood:'本地钢琴采样 · 轻音乐'}]:[])];
 for(const track of tracks){const option=make('option',track.title);option.value=track.id;select.append(option);}
 const toggle=make('button','播放配乐','music-toggle');toggle.type='button';toggle.setAttribute('aria-pressed','false');
 const volumeLabel=make('label','音量'),range=make('input');range.type='range';range.min='0';range.max='100';range.value=String(volume*100);range.setAttribute('aria-label',title+'音量');volumeLabel.append(range);
 const loopLabel=make('label','循环','music-loop'),loop=make('input');loop.type='checkbox';loop.checked=true;loop.setAttribute('aria-label',title+'循环');loopLabel.prepend(loop);
 const info=make('p',undefined,'music-info'),status=make('p','点击播放后加载本地音乐。','music-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const attribution=make('a','来源与授权','music-credit');attribution.target='_blank';attribution.rel='noopener noreferrer';
 const native=make('div',undefined,'music-native'),file=make('a','直接打开音频文件','music-file');file.target='_blank';file.rel='noopener noreferrer';native.hidden=true;file.hidden=true;
 row.append(label,toggle,volumeLabel,loopLabel);root.append(heading,row,native,info,attribution,file,status);host.append(root);
 const choices=new Map();let roleId='';
 function describe(){const track=tracks.find(t=>t.id===select.value);info.textContent=`${track.mood} · ${track.artist}${track.id==='original'?' · 循环小调':''}`;loop.disabled=track.id==='original';loop.checked=track.id==='original'||player.snapshot().loop;attribution.hidden=!track.source;if(track.source){attribution.href=track.source;attribution.textContent=`${track.artist} · CC0 · 来源`;}else attribution.removeAttribute('href');file.hidden=!track.src;if(track.src)file.href=new URL(track.src.replace('./assets/experience/','./'),import.meta.url).href;else file.removeAttribute('href');}
 const time=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
 const player=createMusicPlayer({original,volume,onMedia:media=>{native.replaceChildren();native.hidden=!media;if(media){media.controls=true;media.setAttribute('aria-label',title+'音频播放器');native.append(media);}},changed:s=>{for(const fn of listeners)fn(s);toggle.textContent=s.state==='playing'||s.state==='paused'?'停止配乐':s.state==='starting'?'取消加载':'播放配乐';toggle.setAttribute('aria-pressed',String(s.state==='playing'));root.dataset.playState=s.state;root.dataset.playTime=String(s.currentTime);range.value=String(Math.round(s.volume*100));status.textContent=s.error||(s.state==='playing'||s.state==='paused'?`${s.state==='paused'?'已暂停':'正在播放'}《${tracks.find(t=>t.id===s.trackId)?.title||'小调'}》${s.duration?' · '+time(s.currentTime)+' / '+time(s.duration):''}${s.volume===0?' · 已静音':''}`:s.state==='starting'?'正在加载音乐…':'点击播放后加载本地音乐；若浏览器拦截，请点播放器的播放键。');}});
 toggle.onclick=async()=>{if(player.snapshot().state!=='off'){player.stop();return;}onBeforePlay();try{await player.start(select.value,getRole().id);}catch{}};
 select.onchange=()=>{choices.set(roleId,select.value);player.stop();describe();};
 range.oninput=()=>player.setVolume(Number(range.value)/100);loop.onchange=()=>player.setLoop(loop.checked);
 const hidden=()=>{if(document.hidden)player.stop();},pagehide=()=>player.stop();document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',pagehide);
 function configureRole(){const id=getRole().id;if(id===roleId)return;player.stop();roleId=id;select.value=choices.get(id)||recommendedMusic(id);describe();}
 configureRole();describe();
 return {root,configureRole,subscribe(fn){listeners.add(fn);fn(player.snapshot());return()=>listeners.delete(fn);},play:async()=>{if(player.snapshot().state==='off'){onBeforePlay();try{await player.start(select.value,getRole().id);}catch{}}},stop:()=>player.stop(),snapshot:()=>player.snapshot(),destroy(){player.close();listeners.clear();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',pagehide);root.remove();}};
}

