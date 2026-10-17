import {PIANO_SONGS} from './piano-core.mjs';
import {createPianoAudio} from './piano-audio.mjs';
import {createRhythmRound} from './rhythm-core.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
export function mountRhythm({host,getRole,onExit,onStart}){
 const audio=createPianoAudio(),root=el('section',null,'rhythm-room');root.hidden=true;root.setAttribute('aria-label','节拍落星');
 let visible=false,state='idle',round=null,origin=0,elapsed=0,raf=0,epoch=0,role=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const top=el('div',null,'rhythm-top'),back=el('button','← 返回琴房');back.type='button';back.onclick=()=>{leave();onExit();};top.append(back,el('span','STARFALL / 01','rhythm-kicker'));
 const header=el('header',null,'rhythm-heading'),eyebrow=el('p',''),title=el('h2','节拍落星');header.append(eyebrow,title,el('p','星光抵达横线时，轻轻接住这一拍。'));
 const layout=el('div',null,'rhythm-layout'),field=el('div',null,'rhythm-field'),sky=el('div',null,'rhythm-sky');sky.setAttribute('aria-hidden','true');
 const lane=el('div',null,'rhythm-lane'),line=el('div',null,'rhythm-line');lane.setAttribute('aria-hidden','true');lane.append(line);
 const feedback=el('div','准备好了，就听一段小调。','rhythm-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
 const hit=el('button',null,'rhythm-hit');hit.type='button';hit.setAttribute('aria-label','接住节拍');hit.append(el('span','✦','rhythm-hit-mark'),el('strong','接住'),el('small','点击 / 空格'));hit.disabled=true;
 const count=el('span','16 音 · 单键节奏','rhythm-count');field.append(sky,lane,feedback,hit,count);
 const side=el('aside',null,'rhythm-side'),label=el('label','选一段小调'),song=el('select');song.setAttribute('aria-label','节拍曲目');for(const s of PIANO_SONGS){const o=el('option',`${s.name} · ${s.bpm} BPM`);o.value=s.id;song.append(o);}label.append(song);
 const stats=el('div',null,'rhythm-stats'),score=el('strong','0'),accuracy=el('strong','0%'),combo=el('strong','0');for(const [name,node]of [['得分',score],['准度',accuracy],['连拍',combo]]){const item=el('div');item.append(el('span',name),node);stats.append(item);}
 const controls=el('div',null,'rhythm-controls'),start=el('button','开始一段'),pause=el('button','暂停','rhythm-pause');start.type=pause.type='button';start.className='primary';pause.disabled=true;controls.append(start);field.append(pause);
 const result=el('div',null,'rhythm-result');result.hidden=true;result.setAttribute('role','status');
 const tuning=el('details',null,'rhythm-tuning');tuning.append(el('summary','声音与延迟校准'));
 const volumeLabel=el('label','音量'),volume=el('input');volume.type='range';volume.min='0';volume.max='100';volume.value='35';volume.setAttribute('aria-label','节拍音量');volume.oninput=()=>audio.setVolume(Number(volume.value)/100);volumeLabel.append(volume);
 const offsetLabel=el('label','输入延迟'),offset=el('input'),offsetValue=el('output','0 ms');offset.type='range';offset.min='-120';offset.max='120';offset.step='10';offset.value='0';offset.setAttribute('aria-label','节拍输入延迟');offset.oninput=()=>offsetValue.textContent=`${offset.value} ms`;offsetLabel.append(offset,offsetValue);tuning.append(volumeLabel,offsetLabel,el('p','经常点晚了就调正值，点早了调负值。每段开始时生效。蓝牙耳机可能需要校准。'));
 side.append(el('span','一首歌的片刻','rhythm-kicker'),label,stats,controls,result,el('p','每颗星只接一次。连续乱按会扣分；长按不会连发。漏拍可以继续，没有体力或金币消耗。','rhythm-rules'),tuning);layout.append(field,side);root.append(top,header,layout);host.append(root);
 const names={perfect:'正好落在这一拍',good:'接住了',near:'靠近了，再慢一点',miss:'这一拍飘过去了',extra:'等星光靠近再接'};
 function time(){return state==='playing'?Math.max(elapsed,audio.clock()-origin):elapsed;}
 function paint(t){if(!round)return;const s=round.snapshot(t);text(score,String(s.score));text(accuracy,`${s.accuracy}%`);text(combo,String(s.combo));text(count,`${Object.values(s.counts).reduce((a,b)=>a+b,0)} / ${s.notes.length} 音`);
  if(t<s.lead-.18){text(feedback,`预备 · ${Math.max(1,Math.ceil((s.lead-t)/s.beat))}`);}else if(s.last)text(feedback,names[s.last.kind]);else text(feedback,'看准横线，接住第一颗星。');
  root.dataset.judgment=s.last?.kind||'';
  for(let i=0;i<s.notes.length;i++){const n=s.notes[i],node=lane.children[i+1],remaining=n.time-t;node.hidden=!!n.judgment||remaining>1.8;node.style.top=`${78-remaining/1.8*68}%`;}
  if(s.finished&&state==='playing'){state='finished';elapsed=t;audio.silence();hit.disabled=true;pause.disabled=true;start.disabled=false;song.disabled=false;offset.disabled=false;start.textContent='再听再接一段';root.dataset.state=state;result.hidden=false;result.replaceChildren(el('strong',s.accuracy>=85?'这一小段，接得很稳。':'旋律已经走完。再来一段也好。'),el('p',`准拍 ${s.counts.perfect} · 接住 ${s.counts.good} · 擦边 ${s.counts.near} · 漏拍 ${s.counts.miss} · 多按 ${s.extras}`),el('small',`最高连拍 ${s.bestCombo} · 本段 ${s.score} 分`));feedback.textContent='旋律结束，星光留在这里。';}
 }
 function frame(){raf=0;if(!visible||state!=='playing')return;paint(time());if(state==='playing')raf=requestAnimationFrame(frame);}
 function schedule(){const s=round.snapshot(elapsed);origin=audio.clock()-elapsed;for(const n of s.notes)if(n.time>=elapsed)audio.note(n.note,origin+n.time);}
 function suspend(){if(state!=='playing'){epoch++;start.disabled=false;pause.disabled=state!=='paused';return;}elapsed=time();state='paused';cancelAnimationFrame(raf);raf=0;audio.silence();paint(elapsed);feedback.textContent='已暂停，星光和旋律一起等你。';root.dataset.state=state;hit.disabled=true;pause.textContent='继续';}
 async function begin(resume=false){const token=++epoch;start.disabled=true;pause.disabled=true;try{onStart();await audio.unlock();if(!visible||token!==epoch||document.hidden)return;
   if(!resume){hit.classList.remove('is-hit');const s=PIANO_SONGS.find(s=>s.id===song.value);round=createRhythmRound(s,{offset:Number(offset.value)/1000});elapsed=0;lane.replaceChildren(line);for(const n of round.snapshot().notes){const star=el('span','✦','rhythm-star');star.dataset.note=String(n.note);star.style.setProperty('--star-x',`${24+(n.note%5)*13}%`);lane.append(star);}result.hidden=true;}
   schedule();state='playing';root.dataset.state=state;hit.disabled=false;pause.disabled=false;pause.textContent='暂停';start.textContent='正在演奏';song.disabled=true;offset.disabled=true;frame();hit.focus({preventScroll:true});if(matchMedia('(max-width:720px)').matches)field.scrollIntoView({block:'center',behavior:'instant'});
  }catch(e){state='idle';feedback.textContent=e.message;start.disabled=false;pause.disabled=true;hit.disabled=true;}}
 start.onclick=()=>begin();pause.onclick=()=>state==='playing'?suspend():state==='paused'&&begin(true);
 function tap(){if(state!=='playing'||!round)return;const judged=round.tap(time());paint(time());if(judged){root.dataset.judgment=judged.kind;hit.classList.remove('is-hit');if(judged.kind!=='extra'&&!reduced.matches){void hit.offsetWidth;hit.classList.add('is-hit');}}}
 hit.onclick=()=>tap();
 const key=e=>{if(!visible||e.code!=='Space'||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.closest?.('[contenteditable=true]'))return;if(e.target.tagName==='BUTTON'&&e.target!==hit)return;e.preventDefault();if(!e.repeat)tap();};
 const hidden=()=>{if(document.hidden)suspend();};const pagehide=()=>{suspend();audio.silence();};document.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',pagehide);
 function leave(){epoch++;visible=false;state='idle';elapsed=0;cancelAnimationFrame(raf);raf=0;audio.silence();round=null;hit.classList.remove('is-hit');lane.replaceChildren(line);root.hidden=true;start.disabled=false;pause.disabled=true;song.disabled=false;offset.disabled=false;hit.disabled=true;pause.textContent='暂停';start.textContent='开始一段';root.dataset.state='idle';}
 return {open(){leave();visible=true;role={...getRole()};eyebrow.textContent=`与 ${role.name} · 星音琴房`;root.hidden=false;feedback.textContent='准备好了，就听一段小调。';result.hidden=true;score.textContent='0';accuracy.textContent='0%';combo.textContent='0';count.textContent='16 音 · 单键节奏';start.focus({preventScroll:true});},leave,isOpen:()=>visible,destroy(){leave();audio.close();document.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',pagehide);root.remove();}};
}
