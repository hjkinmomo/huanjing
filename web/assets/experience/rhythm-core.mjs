// Timing and scoring are independent of rendering frequency and audio playback.
export function createRhythmRound(song,{offset=0}={}){
 if(!song?.events?.length||song.events.length>256||!Number.isFinite(song.bpm)||song.bpm<40||song.bpm>160)throw Error('无效曲谱');
 const beat=60/song.bpm,lead=beat*3,window=.18,correction=Math.max(-.12,Math.min(.12,Number(offset)||0));
 const notes=song.events.map((e,i)=>{if(!Number.isInteger(e.note)||e.note<0||e.note>14||!Number.isFinite(e.beat)||e.beat<0||e.beat>600||(i&&e.beat<song.events[i-1].beat))throw Error('无效音符');return {note:e.note,time:lead+e.beat*beat,judgment:null,delta:null};});
 let points=0,extras=0,combo=0,bestCombo=0,lastTime=0,last=null;
 const duration=notes.at(-1).time+beat;
 function advance(time){if(!Number.isFinite(time))return;lastTime=Math.max(lastTime,time);for(const n of notes){if(!n.judgment&&lastTime>n.time+window+correction){n.judgment='miss';combo=0;last={kind:'miss',delta:null};}}}
 function tap(time){if(!Number.isFinite(time)||time<0||time>duration)return null;advance(time);const adjusted=time-correction;
  // Count-in taps are harmless; the playable chart starts with its first window.
  if(adjusted<notes[0].time-window)return null;
  const n=notes.find(n=>!n.judgment&&Math.abs(adjusted-n.time)<=window);
  if(!n){extras++;combo=0;last={kind:'extra',delta:null};return last;}
  const delta=adjusted-n.time,abs=Math.abs(delta),kind=abs<=.055?'perfect':abs<=.11?'good':'near';
  n.judgment=kind;n.delta=delta;points+=kind==='perfect'?100:kind==='good'?70:35;combo++;bestCombo=Math.max(bestCombo,combo);last={kind,delta};return last;
 }
 function snapshot(time=lastTime){advance(time);const counts={perfect:0,good:0,near:0,miss:0};for(const n of notes)if(n.judgment)counts[n.judgment]++;return {notes:notes.map(n=>({...n})),counts,extras,combo,bestCombo,last: last&&{...last},duration,lead,beat,finished:lastTime>=duration,score:Math.max(0,points-extras*25),accuracy:Math.round(100*points/(100*(notes.length+extras)))};}
 return {tap,advance,snapshot};
}
