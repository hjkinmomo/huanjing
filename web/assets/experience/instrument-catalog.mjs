import {SAMPLE_TUNING} from './instrument-tuning.mjs';
const natural=['C','D','E','F','G','A','B'];
const diatonic=octaves=>[...octaves.flatMap(o=>natural.map(n=>`${n}${o}`)),`C${octaves.at(-1)+1}`];
export function noteMidi(name){const match=/^([A-G])([#b]?)(\d)$/.exec(name);if(!match)throw Error('音名无效');return (Number(match[3])+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1]])+({ '':0,'#':1,b:-1}[match[2]]);}
const asset=name=>new URL(`./instruments/${name}`,import.meta.url).href;
export const INSTRUMENTS=Object.freeze([
 {id:'piano',name:'钢琴',description:'温暖琴弦 · 自然余韵',range:'C4 — C6',transpose:0,kind:'decay',attack:.006,release:1.25,ring:2.8,level:.65,notes:diatonic([4,5])},
 {id:'harp',name:'竖琴',description:'轻盈拨弦 · 晶莹泛音',range:'C4 — C6',transpose:0,kind:'decay',attack:.005,release:1.7,ring:3.5,level:.7,notes:['B3','D4','F4','A4','C5','E5','G5','B5','D6']},
 {id:'guitar',folder:'guitar-acoustic',name:'木吉他',description:'木质共鸣 · 温柔回响',range:'C3 — C5',transpose:-12,kind:'decay',attack:.004,release:1.2,ring:2.6,level:.75,notes:diatonic([3,4])},
 {id:'flute',name:'长笛',description:'柔和气息 · 按住延音',range:'C4 — C6',transpose:0,kind:'sustain',attack:.035,release:.48,ring:.7,level:.65,notes:['C4','E4','A4','C5','E5','A5','C6']},
 {id:'cello',name:'大提琴',description:'醇厚弓弦 · 按住延音',range:'C3 — C5',transpose:-12,kind:'sustain',attack:.06,release:.7,ring:.8,level:.7,notes:diatonic([3,4])},
 {id:'xylophone',name:'木琴',description:'清亮木音 · 玲珑余响',range:'C5 — C7',transpose:12,kind:'decay',attack:.004,release:1.1,ring:2,level:.65,notes:['G4','C5','G5','C6','G6','C7']}
].map(instrument=>{
 const samples=instrument.notes.map(note=>{const path=`${instrument.folder||instrument.id}/${note.replace('#','s')}.wav`;return Object.freeze({note,midi:noteMidi(note),tuning:SAMPLE_TUNING[path]||1,url:asset(path)});});
 return Object.freeze({...instrument,image:asset(`art/${instrument.id}.webp`),samples:Object.freeze(samples)});
}));
export const getInstrument=id=>INSTRUMENTS.find(instrument=>instrument.id===id)||INSTRUMENTS[0];
export function sampleForNote(instrument,index){if(!Number.isInteger(index)||index<0||index>14)return null;const midi=60+[0,2,4,5,7,9,11,12,14,16,17,19,21,23,24][index]+instrument.transpose;const sample=instrument.samples.reduce((best,candidate)=>Math.abs(candidate.midi-midi)<Math.abs(best.midi-midi)?candidate:best);return {...sample,midi,rate:2**((midi-sample.midi)/12)*sample.tuning};}
