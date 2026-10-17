import {PIANO_SONGS,validateEvents} from './piano-core.mjs';
// Original arrangements for this instrument; old version-1 event scores remain valid.
function arrangement(id,name,bpm,bars){
 const events=[];let beat=0;
 for(const bar of bars){
  for(const note of bar.chord)events.push({note,beat,duration:2.5});
  bar.melody.forEach((note,i)=>{if(note!==null)events.push({note,beat:beat+i*.5,duration:i===bar.melody.length-1?1:.42});});beat+=4;
 }
 events.sort((a,b)=>a.beat-b.beat||a.note-b.note);
 return Object.freeze({id,name,bpm,events:Object.freeze(validateEvents(events).map(Object.freeze)),beats:beat,arrangement:'旋律与和弦 · 原创'});
}
export const PIANO_ARRANGEMENTS=Object.freeze([
 arrangement('after-rain','雨后归途',76,[
  {chord:[0,2,4],melody:[7,9,11,9,8,7,null,9]},
  {chord:[1,3,5],melody:[8,10,12,10,9,8,null,7]},
  {chord:[2,4,6],melody:[9,11,13,12,11,9,null,8]},
  {chord:[0,3,5],melody:[7,8,10,9,8,7,null,8]},
  {chord:[1,4,6],melody:[8,9,11,10,9,8,null,9]},
  {chord:[0,2,4],melody:[11,9,8,7,null,null,7,null]},
 ]),
 arrangement('little-waltz','两人的小步舞',96,[
  {chord:[0,2,4],melody:[7,null,9,11,12,11,9,7]},
  {chord:[0,3,5],melody:[8,null,10,12,13,12,10,8]},
  {chord:[1,4,6],melody:[9,null,11,13,12,11,9,8]},
  {chord:[0,2,4],melody:[7,null,8,9,11,9,8,7]},
 ]),
]);
export const PIANO_LIBRARY=Object.freeze([...PIANO_ARRANGEMENTS,...PIANO_SONGS]);
export function scoreGroups(events){
 const valid=validateEvents(events),groups=[];
 valid.forEach((event,index)=>{
  let group=groups.at(-1);
  if(!group||event.beat-group.beat>.04){group={beat:event.beat,notes:[],events:[],start:index,end:index,duration:0};groups.push(group);}
  if(!group.notes.includes(event.note))group.notes.push(event.note);
  group.events.push(event);group.end=index;group.duration=Math.max(group.duration,event.duration??1);
 });
 return groups;
}
export function createChordPractice(events,{windowMs=750}={}){
 const groups=scoreGroups(events);let index=0,pressed=new Set(),started=null;
 const snapshot=()=>({index,total:groups.length,complete:index>=groups.length,wanted:groups[index]?.notes||[],pressed:[...pressed]});
 return {snapshot,press(note,at){
  if(index>=groups.length||!Number.isInteger(note)||!Number.isFinite(at))return {...snapshot(),accepted:false};
  const group=groups[index];if(!group.notes.includes(note))return {...snapshot(),accepted:false};
  if(started===null||at-started>windowMs){pressed.clear();started=at;}
  pressed.add(note);const completed=group.notes.every(n=>pressed.has(n));
  if(completed){index++;pressed.clear();started=null;}
  return {...snapshot(),accepted:true,completed};
 }};
}
