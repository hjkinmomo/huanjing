import {createPianoAudio} from './piano-audio.mjs';
import {PIANO_SONGS,createTransport} from './piano-core.mjs';
// Reuse the project's original local scores. No network, autoplay or microphone.
export function createStoryMusic({audio=createPianoAudio(),transportFactory=createTransport,changed=()=>{},schedule=setTimeout,cancel=clearTimeout}={}){
 let state='off',volume=.22,roleId='',generation=0,loop=null,closed=false;
 const songFor=id=>PIANO_SONGS.find(s=>s.id===(id==='shuyun'?'letter':id==='koka'?'garden':'evening'));
 const notify=()=>changed({state,volume,roleId,song:songFor(roleId)?.name||''});
 const transport=transportFactory({play:(n,duration)=>audio.note(n,null,duration),changed:s=>{
  if(s.state==='finished'&&state==='playing'){
   const token=generation;loop=schedule(()=>{loop=null;if(!closed&&token===generation&&state==='playing'){const song=songFor(roleId);transport.start(song.events,song.bpm);}},900);
  }
 }});
 function stop(){generation++;if(loop!==null)cancel(loop);loop=null;state='off';transport.stop();audio.silence();notify();}
 return {
  async start(id){
   if(closed)throw Error('音乐已关闭，请重新打开页面。');
   stop();const token=generation;roleId=id;state='starting';notify();
   try{audio.setVolume(0);await (audio.setInstrument?audio.setInstrument('piano'):audio.setTone('soft'));if(closed||token!==generation)return false;await audio.unlock();if(closed||token!==generation)return false;
    audio.setVolume(volume);state='playing';const song=songFor(id);transport.start(song.events,song.bpm);notify();return true;
   }catch(error){if(token===generation){stop();throw error;}return false;}
  },
  stop,
  setVolume(value){volume=Math.max(0,Math.min(1,Number(value)||0));audio.setVolume(volume);notify();},
  snapshot:()=>({state,volume,roleId,song:songFor(roleId)?.name||''}),
  close(){if(closed)return;stop();closed=true;audio.close();}
 };
}
