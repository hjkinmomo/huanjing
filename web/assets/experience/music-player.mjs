import {MUSIC_TRACKS} from './music-library.mjs';
let owner=null;
// One active listening source; never fetch audio before a user requests play.
export function createMusicPlayer({mediaFactory=()=>new Audio(),onMedia=()=>{},original=null,changed=()=>{},volume=.22}={}){
 let media=null,state='off',trackId='',error='',epoch=0,closed=false,loop=true,roleId='';
 volume=clamp(volume);
 const snapshot=()=>({state,trackId,volume,loop,error,currentTime:Number.isFinite(media?.currentTime)?media.currentTime:0,duration:Number.isFinite(media?.duration)?media.duration:0,readyState:media?.readyState||0,paused:media?.paused??true});
 const notify=()=>changed(snapshot());
 function disposeMedia(){if(!media)return;const old=media;media=null;for(const event of ['onended','onerror','ontimeupdate','onloadedmetadata','onplaying','onpause','onvolumechange'])old[event]=null;old.pause();old.removeAttribute('src');old.load();onMedia(null);}
 function stop(){epoch++;state='off';error='';disposeMedia();original?.stop();if(owner===api)owner=null;notify();}
 const api={
  async start(id,role=''){
   if(closed)throw Error('配乐已关闭，请重新打开页面。');
   const track=MUSIC_TRACKS.find(t=>t.id===id);
   if(!track&&!(id==='original'&&original))throw Error('这首音乐暂不可用。');
   owner?.stop();stop();owner=api;const token=epoch;trackId=id;roleId=role;state='starting';notify();
   try{
    if(id==='original'){original.setVolume(volume);if(!await original.start(roleId)){if(token===epoch)stop();return false;}}
    else{
     const current=mediaFactory();media=current;current.preload='none';current.volume=volume;current.loop=loop;
     onMedia(current);
     current.onended=()=>{if(media===current&&!loop){state='off';if(owner===api)owner=null;notify();}};
     current.onerror=()=>{if(media===current){const code=current.error?.code;const message=code===4?'浏览器不支持这份音频格式，或文件未能读取；请换曲目或打开音频文件。':code===2?'音乐读取中断，请重新播放。':'音乐文件未能解码，请换曲目或重试。';stop();error=message;notify();}};
     current.ontimeupdate=current.onloadedmetadata=()=>{if(media===current)notify();};
     current.onplaying=()=>{if(media!==current)return;if(owner&&owner!==api)owner.stop();owner=api;state='playing';error='';notify();};
     current.onpause=()=>{if(media===current&&state==='playing'){state='paused';notify();}};
     current.onvolumechange=()=>{if(media===current){volume=clamp(current.volume);notify();}};
     current.src=new URL(track.src.replace('./assets/experience/','./'),import.meta.url).href;
     await current.play();
    }
    if(closed||token!==epoch)return false;state=media?.paused===true?'paused':'playing';notify();return true;
   }catch(e){if(token!==epoch)return false;stop();error='配乐未能开启，请再点一次播放或换一首。';notify();throw Error(error,{cause:e});}
  },
  stop,snapshot,
  setVolume(value){volume=clamp(value);if(media)media.volume=volume;original?.setVolume(volume);notify();},
  setLoop(value){loop=!!value;if(media)media.loop=loop;notify();},
  close(){if(closed)return;stop();closed=true;original?.close?.();},
 };
 return api;
}
function clamp(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
