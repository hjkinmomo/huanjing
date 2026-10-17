import {objectFor} from './story-objects.mjs';
import {packFor,sceneFor,journeyDetails} from './story-core.mjs';
import {dialogueFor} from './story-dialogue.mjs';
import {availableBackgrounds,STORY_POSES,scenePresentation} from './story-media.mjs';
import {createStoryImage} from './story-image.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,run)=>{const b=el('button',text);b.type='button';b.onclick=run;return b;};
export function mountStoryTheater({host,getRole,getSession,onChoice,music,soundHome,onError}){
 const dialog=el('dialog',undefined,'vn-theater');dialog.setAttribute('aria-label','视觉小说演出');host.append(dialog);
 const toolbar=el('header',undefined,'vn-toolbar'),heading=el('div'),stage=el('div',undefined,'vn-stage'),body=el('div',undefined,'vn-body');
 const musicDetails=el('details',undefined,'vn-music'),musicSummary=el('summary','♫ 配乐'),musicState=el('span','','vn-music-state');musicSummary.append(musicState);musicDetails.append(musicSummary);
 const settings=el('details',undefined,'vn-settings');settings.append(el('summary','布景与动作'));const settingsBody=el('div',undefined,'vn-settings-body');settings.append(settingsBody);
 toolbar.append(heading,settings,musicDetails,button('退出演出',close));dialog.append(toolbar,stage,body);
 // Keep native audio mounted across dialogue and choice changes.
 const unsubscribe=music.subscribe?.(s=>{musicState.textContent=s.error?' · 未播放':s.state==='playing'?' · 播放中':s.state==='paused'?' · 已暂停':'';musicSummary.title=s.error||'';});
 const inspection=el('dialog',undefined,'vn-object-dialog');inspection.setAttribute('aria-label','场景观察');host.append(inspection);let lookTrigger=null;
 inspection.addEventListener('close',()=>lookTrigger?.isConnected&&lookTrigger.focus({preventScroll:true}));
 function inspect(item){inspection.dataset.storyRole=owner;lookTrigger=document.activeElement;inspection.replaceChildren();inspection.append(button('返回剧情',()=>inspection.close()),el('small','场景观察'),el('h2',item.title));if(item.materials)inspection.append(el('span',item.materials,'vn-materials'));if(item.image){const img=el('img');img.src=item.image;img.alt=item.title;img.onerror=()=>{img.hidden=true;};inspection.append(img);}inspection.append(el('p',item.detail));inspection.showModal();}
 let owner=null,page=0,origin=null,imageLoader=null,castSource='',backgroundSource='';const overrides=new Map();
 function close(){if(dialog.open)dialog.close();else if(owner)cleanup();}
 function cleanup(){if(inspection.open)inspection.close();music.stop();imageLoader?.close();imageLoader=null;castSource='';backgroundSource='';soundHome.append(music.root);owner=null;(origin?.isConnected?origin:host.querySelector('.story-play'))?.focus({preventScroll:true});}
 dialog.addEventListener('close',cleanup);
 function advance(){if(page===0){page=1;render();body.querySelector('.vn-next,.vn-choices button,.vn-end')?.focus({preventScroll:true});}}
 dialog.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&e.target===dialog){e.preventDefault();advance();}});
 function configuration(presentation){
  settingsBody.replaceChildren();const selected=overrides.get(owner)||{};
  function select(label,entries,key){const wrap=el('label',label),input=el('select');input.setAttribute('aria-label',label);const auto=el('option','跟随剧情');auto.value='';input.append(auto);for(const item of entries){const o=el('option',item.title);o.value=item.id;input.append(o);}input.value=selected[key]||'';input.onchange=()=>{overrides.set(owner,{...overrides.get(owner),[key]:input.value});render();};wrap.append(input);settingsBody.append(wrap);}
  select('地点',availableBackgrounds(owner),'background');select('人物动作',STORY_POSES[owner]||[],'pose');
  settingsBody.append(button(presentation.side==='right'?'人物移到左侧':'人物移到右侧',()=>{overrides.set(owner,{...overrides.get(owner),side:presentation.side==='right'?'left':'right'});render();}),el('small','切换布景不改变剧情进度。'));
 }
 function renderStage({background,pose,side}){
  stage.dataset.castSide=side;stage.dataset.lighting=background.id.includes('night')||background.id.startsWith('lantern')||background.id==='old-platform'?'evening':'day';
  if(backgroundSource!==background.image||!imageLoader){
   imageLoader?.close();stage.replaceChildren();backgroundSource=background.image;
   const notice=el('div',undefined,'vn-image-notice');notice.setAttribute('role','status');stage.append(notice);
   imageLoader=createStoryImage(background.image,{className:'vn-background',alt:background.title,changed:state=>{stage.dataset.imageState=state;notice.replaceChildren();notice.hidden=state==='ready';if(state==='loading'||state==='fallback-loading')notice.append(el('span',state==='loading'?'正在准备场景…':'正在准备备用场景…'));else if(state==='fallback'||state==='error')notice.append(el('span','场景暂时无法读取。可以重试，剧情仍可继续。'),button('重试场景',()=>imageLoader.retry()));}});stage.prepend(imageLoader.image);
   if(document.documentElement.dataset.reduced!=='true'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)imageLoader.image.animate?.([{opacity:.2},{opacity:1}],{duration:360,easing:'ease-out'});castSource='';
  }
  if(castSource!==(pose?.image||'')){stage.querySelector('.vn-cast')?.remove();stage.querySelector('.vn-cast-notice')?.remove();castSource=pose?.image||'';if(pose){const cast=el('img',undefined,'vn-cast');cast.src=pose.image;cast.alt=`${getRole().name} · ${pose.title}`;cast.decoding='async';cast.onload=()=>stage.querySelector('.vn-cast-notice')?.remove();cast.onerror=()=>{cast.hidden=true;stage.querySelector('.vn-cast-notice')?.remove();const notice=el('div',undefined,'vn-image-notice vn-cast-notice');notice.setAttribute('role','status');notice.append(el('span','人物图暂时无法读取。'),button('重试人物',()=>{cast.hidden=false;cast.src=pose.image;}));stage.append(notice);};stage.append(cast);}}
  const cast=stage.querySelector('.vn-cast');if(cast){cast.dataset.speaking=String(page===1);cast.dataset.pose=pose?.id||'';}
  stage.querySelectorAll('.vn-hotspot').forEach(n=>n.remove());for(const item of background.objects){const b=button('观察 · '+item.title,()=>inspect(item));b.className='vn-hotspot';b.style.left=`${item.x*100}%`;b.style.top=`${item.y*100}%`;b.dataset.object=item.id;stage.append(b);}
 }
 function render(){
  if(getRole().id!==owner){close();return;}
  const saved=getSession(),pack=packFor(owner),scene=sceneFor(saved,pack),line=dialogueFor(owner,saved.node),detail=journeyDetails(saved,pack),presentation=scenePresentation(owner,scene,saved,overrides.get(owner));
  dialog.dataset.storyMotif=pack.motif;dialog.dataset.storyRole=owner;heading.replaceChildren(el('small',`${getRole().name} · ${detail.chapter}`),el('strong',scene.episodeTitle||pack.title));configuration(presentation);renderStage(presentation);body.replaceChildren();
  const box=el('section',undefined,'vn-dialogue');box.setAttribute('aria-label','当前剧情');body.append(box);box.append(el('span',page===0?'旁白':getRole().name,'vn-speaker'),el('h2',scene.title));
  const text=el('p',page===0?scene.text:(line||scene.text),'vn-copy');text.setAttribute('aria-live','polite');box.append(text);const actions=el('div',undefined,'vn-actions');box.append(actions);
  if(page===0){const next=button(line?'继续 · 看对白':'继续 · 做出选择',advance);next.className='vn-next';actions.append(next,el('small','进度自动保留'));}
  else if(scene.choices.length){const choices=el('div',undefined,'vn-choices');for(const c of scene.choices){const b=button(c.label,()=>{try{onChoice(c.id);page=0;render();body.querySelector('.vn-next')?.focus({preventScroll:true});}catch(e){onError(e.message);close();}});b.dataset.choice=c.id;choices.append(b);}actions.append(choices);}
  else{const end=button('收好这一幕 · 返回手记',close);end.className='vn-end';actions.append(end,el('small','回到手记后，可以写下感想。'));}
  const log=el('details',undefined,'vn-log');log.append(el('summary',`回看 · ${saved.trail.length} 个选择`));const entries=el('div');for(const step of saved.trail){const n=pack.nodes[step.node];entries.append(el('strong',n.title),el('p',n.text),el('p',dialogueFor(owner,step.node)),el('small',`你的选择：${n.choices.find(c=>c.id===step.choiceId).label}`));}if(!saved.trail.length)entries.append(el('p','这一段刚刚开始。'));log.append(entries);box.append(log);
  const item=objectFor(owner,saved);if(item){const look=button('细看物件 · '+item.title,()=>inspect(item));look.className='vn-object-trigger';box.append(look);}
 }
 return {open(){owner=getRole().id;origin=document.activeElement;page=0;musicDetails.append(music.root);render();dialog.showModal();body.querySelector('.vn-next')?.focus();music.play();},close,isOpen:()=>dialog.open,destroy(){close();unsubscribe?.();dialog.remove();inspection.remove();}};
}
