import {getInstrument,sampleForNote} from './instrument-catalog.mjs';
import {roomImpulse,sustainBuffer,sampleLevel} from './instrument-dsp.mjs';

// Local acoustic multisamples. note() preserves rhythm scheduling; attack() and
// release() own independent held voices for keyboard keys and multitouch.
export function createPianoAudio({AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext,fetchSample=globalThis.fetch?.bind(globalThis),context:providedContext=null}={}){
 let context=providedContext,master=null,bus=null,wet=null,closed=false,volume=.35,ambience=.24,releaseSeconds=null,overtones=0,overtoneBus=null,instrument=getInstrument('piano'),serial=0;
 const banks=new Map(),loading=new Map(),voices=new Map();
 function ensureContext(){
  if(closed)throw Error('琴房已关闭。');
  if(!context){if(!AudioContext)throw Error('此浏览器不支持音频，请换一个现代浏览器。');context=new AudioContext({latencyHint:'interactive'});}
  if(!master){
   bus=context.createGain();overtoneBus=context.createGain();overtoneBus.gain.value=overtones;overtoneBus.connect(bus);master=context.createGain();master.gain.value=volume*.7;
   const compressor=context.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.004;compressor.release.value=.18;
   const dry=context.createGain();dry.gain.value=.9;bus.connect(dry);dry.connect(compressor);
   const room=context.createConvolver();room.buffer=roomImpulse(context);wet=context.createGain();wet.gain.value=ambience;
   bus.connect(room);room.connect(wet);wet.connect(compressor);compressor.connect(master);master.connect(context.destination);
  }
 }
 async function prepare(id=instrument.id){
  const target=getInstrument(id);ensureContext();if(banks.has(target.id))return true;if(loading.has(target.id))return loading.get(target.id);
  const activeContext=context;
  const pending=(async()=>{
   try{
    if(!fetchSample)throw Error('无法读取本机音源。');
    const entries=await Promise.all(target.samples.map(async sample=>{
     const response=await fetchSample(sample.url);if(!response.ok)throw Error(`${sample.note} 读取失败`);
     const original=await activeContext.decodeAudioData(await response.arrayBuffer());
     return [sample.note,{original,...(target.kind==='sustain'?sustainBuffer(activeContext,original):{buffer:original,loop:false}),level:sampleLevel(original)}];
    }));
    if(closed||activeContext!==context)return false;banks.set(target.id,new Map(entries));return true;
   }catch(error){throw Error(`${target.name}音源未就绪：${error.message}。请重试或选择其他乐器。`);}finally{loading.delete(target.id);}
  })();loading.set(target.id,pending);return pending;
 }
 function remove(voice){if(voice.removed)return;voice.removed=true;voices.delete(voice.id);voice.source.disconnect();voice.envelope.disconnect();for(const node of voice.harmonics||[])node.disconnect();voice.harmonicEnvelope?.disconnect();}
 function release(id,at=context?.currentTime,{quick=false}={}){
  const voice=voices.get(id);if(!voice||!context)return false;
  if(voice.released&&!quick)return false;
  const time=quick?context.currentTime:Math.max(voice.start+.08,context.currentTime,Number.isFinite(at)?at:context.currentTime);voice.released=true;
  const releaseTime=quick? .035:releaseSeconds??voice.instrument.release,param=voice.envelope.gain;
  if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(time);else{param.cancelScheduledValues(time);param.setValueAtTime(voice.level,time);}
  param.setTargetAtTime(0,time,releaseTime/5);voice.source.stop(time+releaseTime+.04);
  if(voice.harmonicEnvelope){const gain=voice.harmonicEnvelope.gain;if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(time);else{gain.cancelScheduledValues(time);gain.setValueAtTime(voice.level*.055,time);}gain.setTargetAtTime(0,time,releaseTime/5);for(const osc of voice.harmonics)osc.stop(time+releaseTime+.04);}
  voice.until=time+releaseTime+.04;return true;
 }
 function attack(index,at=null){
  if(!context||(context.state!=='running'&&!providedContext?.startRendering)||closed||!banks.has(instrument.id))return null;
  const mapping=sampleForNote(instrument,index);if(!mapping)return null;
  const sample=banks.get(instrument.id).get(mapping.note);if(!sample)return null;
  for(const voice of [...voices.values()])if(voice.until<=context.currentTime)remove(voice);
  while(voices.size>=24){const oldest=voices.values().next().value;release(oldest.id,context.currentTime,{quick:true});voices.delete(oldest.id);}
  const time=Math.max(context.currentTime,Number.isFinite(at)?at:context.currentTime),source=context.createBufferSource(),envelope=context.createGain(),level=instrument.level*sample.level;
  source.buffer=sample.buffer;source.playbackRate.value=mapping.rate;source.loop=sample.loop;
  if(sample.loop){source.loopStart=sample.loopStart;source.loopEnd=sample.loopEnd;}
  envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(level,time+instrument.attack);
  source.connect(envelope);envelope.connect(bus);const id=++serial;
  const voice={id,source,envelope,instrument,level,start:time,released:false,until:time+(sample.loop?120:sample.buffer.duration/mapping.rate),harmonics:[]};
  if(context.createOscillator){
   const harmonicEnvelope=context.createGain();harmonicEnvelope.gain.setValueAtTime(0,time);harmonicEnvelope.gain.linearRampToValueAtTime(level*.055,time+Math.max(.012,instrument.attack));harmonicEnvelope.connect(overtoneBus);voice.harmonicEnvelope=harmonicEnvelope;
   for(const multiple of [2,3]){const osc=context.createOscillator();osc.type='sine';osc.frequency.value=440*2**((mapping.midi-69)/12)*multiple;osc.connect(harmonicEnvelope);osc.start(time);osc.stop(voice.until);voice.harmonics.push(osc);}
  }
  source.onended=()=>remove(voice);voices.set(id,voice);source.start(time);source.stop(voice.until);return id;
 }
 function silence(){if(!context)return;for(const voice of [...voices.values()])release(voice.id,context.currentTime,{quick:true});}
 return {
  prepare,
  async unlock(){ensureContext();if(!providedContext?.startRendering){if(context.state==='suspended')await context.resume();if(context.state!=='running')throw Error('音频未开启，请再次点击琴键。');}await prepare(instrument.id);},
  setVolume(v){volume=Math.max(0,Math.min(1,Number(v)||0));if(master)master.gain.setTargetAtTime(volume*.7,context.currentTime,.025);},
  setAmbience(v){ambience=Math.max(0,Math.min(.65,Number(v)||0));if(wet)wet.gain.setTargetAtTime(ambience,context.currentTime,.04);},
  setRelease(value){releaseSeconds=Math.max(.15,Math.min(3,Number(value)||1.2));},
  setOvertones(value){overtones=Math.max(0,Math.min(1,Number(value)||0));if(overtoneBus)overtoneBus.gain.setTargetAtTime(overtones,context.currentTime,.04);},
  setInstrument(id){silence();instrument=getInstrument(id);return prepare(instrument.id);},
  setTone(value){return this.setInstrument(value==='bell'?'xylophone':value==='soft'?'piano':value);},
  clock:()=>context?.currentTime||0,
  attack,release,
  note(index,at=null,duration=null){const id=attack(index,at);if(id===null)return false;const voice=voices.get(id);release(id,voice.start+(Number.isFinite(duration)?Math.max(.06,Math.min(120,duration)):voice.instrument.ring));return true;},
  silence,
  snapshot:()=>({release:releaseSeconds,overtones,instrument:instrument.id,ready:banks.has(instrument.id),voices:voices.size,held:[...voices.values()].filter(v=>!v.released).length,state:context?.state||'not-started'}),
  close(){silence();closed=true;loading.clear();banks.clear();if(context&&!providedContext)context.close();context=null;master=null;bus=null;wet=null;}
 };
}
