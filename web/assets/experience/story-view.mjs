import {packFor,readStories,validateSession,newSession,choose,rewind,updateStory,recordCard,storyPrompt,journeyDetails,sceneFor} from './story-core.mjs';
import {scenePresentation} from './story-media.mjs';
import {createStoryImage} from './story-image.mjs';
import {mountStoryTheater} from './story-theater.mjs';
import {companionPath} from './companion-path.mjs';
import {dialogueFor,sceneContext} from './story-dialogue.mjs';
import {createStoryMusic} from './story-music.mjs';
import {mountMusicLibrary} from './music-view.mjs';
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(name,action,className)=>{const b=el('button',name,className);b.type='button';b.addEventListener('click',action);return b;};
export function mountStories({host,getRole,read,mutate,onDiscuss}){
 let mode='journey',expected=null,activeRole=null,active=false,animation=null,lastImageSource='';
 const main=host.querySelector('[data-story-main]'),status=host.querySelector('[data-story-status]');
 const music=mountMusicLibrary({host,title:'同行配乐',getRole,original:createStoryMusic()});
 const sound=el('details',undefined,'story-sound-drawer');sound.append(el('summary','♫ 同行配乐 · 点开播放'),music.root);main.before(sound);
 const theater=mountStoryTheater({host,getRole,getSession:session,onChoice:id=>{edit(s=>choose(s,activeRole,id));render();},music,soundHome:sound,onError:report});
 function play(){try{if(!session()){edit(()=>newSession(getRole().id,crypto.randomUUID()));render();}theater.open();}catch(e){report(e.message);}}
 const tabs=[...host.querySelectorAll('[data-story-mode]')];
 const dialog=el('dialog',undefined,'story-reset-dialog');dialog.setAttribute('aria-labelledby','story-reset-title');
 dialog.append(el('h2','重新开始这段路线？'));dialog.firstChild.id='story-reset-title';dialog.append(el('p','当前路线与未收好的笔记将被替换。已保存的纪念卡、聊天和背包不受影响。'));
 const controls=el('div',undefined,'story-actions');let resetRole=null,resetExpected=null;
 controls.append(button('继续这段',()=>dialog.close()),button('重新开始',()=>{try{if(getRole().id!==resetRole)throw Error('角色已切换，未重置。');mutate(s=>updateStory(s,resetRole,resetExpected,()=>newSession(resetRole,crypto.randomUUID())));dialog.close();render();}catch(e){report(e.message);}},'primary'));dialog.append(controls);host.append(dialog);
 function report(text){status.textContent=text;status.hidden=!text;}
 function session(){const s=readStories(read()),id=getRole().id;return Object.hasOwn(s.sessions,id)?s.sessions[id]:null;}
 function edit(transform){const id=activeRole;mutate(s=>updateStory(s,id,expected,transform));expected=structuredClone(session());}
 function art(src,description,className){return createStoryImage(src,{className,alt:description}).image;}
 function animateImage(image){animation?.cancel();const changed=lastImageSource!==image.src;lastImageSource=image.src;if(!changed||document.documentElement.dataset.reduced==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;animation=image.animate?.([{opacity:.3},{opacity:1}],{duration:320,easing:'ease-out'});}
 function discuss(value){if(getRole().id!==activeRole){report('角色已切换，请重新进入这段旅程。');return;}try{onDiscuss(storyPrompt(value,activeRole),activeRole);}catch(e){report(e.message);}}
 function renderJourney(role){
  const pack=packFor(role.id);host.dataset.storyMotif=pack.motif;
  const saved=session();expected=saved?structuredClone(validateSession(saved,role.id)):null;
  const current=saved?sceneFor(saved,pack):null,details=saved?journeyDetails(saved,pack):null;
  const frame=el('div',undefined,'story-frame'),image=art(saved?current.image:pack.nodes.end.image,`${role.name}的同行场景 · ${saved?current.title:pack.title}`,'story-art');frame.append(image);
  const presentation=scenePresentation(role.id,current||pack.nodes.end,saved);
  if(presentation.pose){const cast=el('img',undefined,'story-preview-cast');cast.src=presentation.pose.image;cast.alt='';cast.decoding='async';cast.onerror=()=>{cast.hidden=true;};frame.append(cast);}
  const caption=el('div',undefined,'story-caption');caption.append(el('span',`${role.name} · 剧情插画`,'story-kicker'),el('h2',saved?current.title:pack.title),el('p',saved?`${details.chapter} · 进度自动保留`:pack.subtitle));frame.append(caption);main.append(frame);
  const panel=el('section',undefined,'story-panel');main.append(panel);
  panel.append(button(saved?'▶ 继续演出':'▶ 播放演出',play,'primary story-play'));
  if(!saved){panel.append(el('span','留一点时间给散步','story-kicker'),el('h3',pack.title),el('p',role.id==='shira'||role.id==='koka'||role.id==='shuyun'?'新增专属篇章、大场景演出与分支结局。也可以沿街道、购物、甜品、夜归走完四章；进度会自动保留。':'选一条路，慢慢走。随时离开，下次可以继续。'));panel.append(button('开始同行',()=>{try{edit(()=>newSession(role.id,crypto.randomUUID()));render();}catch(e){report(e.message);}},'primary'));return;}
  const heading=el('h3',current.title);heading.tabIndex=-1;
  panel.append(el('span',`${details.chapter} · 第 ${saved.trail.length+1} 幕`,'story-kicker'));
  if(details.extended){const rail=el('ol',undefined,'story-chapters');for(const label of ['街道','挑选','甜品','夜归']){const step=el('li',label);step.dataset.current=String(details.chapter.includes(label));if(details.chapter.includes(label))step.setAttribute('aria-current','step');rail.append(step);}panel.append(rail);}
  panel.append(heading,el('p',current.text,'story-narration'));
  const line=dialogueFor(role.id,saved.node);if(line){const speech=el('blockquote',undefined,'story-dialogue');speech.append(el('span',role.name+' · 剧情对白','story-speaker'),el('p',line));panel.append(speech);}
  const echoes=sceneContext(saved,pack);if(echoes.length){const echo=el('aside',undefined,'story-echo');echo.setAttribute('aria-label','前情');echo.append(el('small','从刚才的选择继续'));echoes.forEach(text=>echo.append(el('p',text)));panel.append(echo);}
  if(details.outcomes.length){const outcome=el('div',undefined,'story-outcomes');outcome.setAttribute('aria-label','本段已做的选择');details.outcomes.forEach(t=>outcome.append(el('span',t)));panel.append(outcome);}
  const choices=el('div',undefined,'story-choices');if(current.choices.length)panel.append(el('p','接下来，由你决定','story-choice-label'));panel.append(choices);
  for(const option of current.choices){const b=button(option.label,()=>{try{edit(s=>choose(s,role.id,option.id));render();main.querySelector('h3')?.focus({preventScroll:true});}catch(e){report(e.message);}},'story-choice');b.dataset.choice=option.id;choices.append(b);}
  if(!current.choices.length){
   const recorded=readStories(read()).cards.find(c=>c.id===saved.id);
   const label=el('label',recorded?'已收好的那句话':'留一句自己的话','story-note-label'),input=el('textarea');input.rows=3;input.maxLength=800;input.placeholder=role.id==='shuyun'?'窗外的灯亮了，而……':'想记住的发现、感想或问题';input.value=recorded?.note||saved.note;input.readOnly=!!recorded;
   if(!recorded)input.addEventListener('input',()=>{try{edit(s=>({...s,note:input.value,revision:s.revision+1}));report('笔记已保留在本机。');}catch(e){report(e.message);}});label.append(input);panel.append(label);
   const already=readStories(read()).cards.some(c=>c.id===saved.id),keep=button(already?'已收进手记':'收进同行手记',()=>{try{let added=false;mutate(s=>{added=recordCard(s,role.id,expected,new Date().toISOString());});render();report(added?'已保存到本机同行手记，未对外发布。':'这张纪念卡已经保存。');}catch(e){report(e.message);}},'primary');keep.disabled=already;panel.append(keep);
  }
  const actions=el('div',undefined,'story-actions');actions.append(button('带回聊天',()=>discuss(expected)));
  if(saved.trail.length)actions.append(button('上一个选择',()=>{try{edit(s=>rewind(s,role.id));render();}catch(e){report(e.message);}}));
  actions.append(button('重新开始',()=>{resetRole=role.id;resetExpected=structuredClone(expected);dialog.showModal();}));panel.append(actions);
  if(saved.trail.length){const history=el('details',undefined,'story-history');history.append(el('summary',`回看这段同行 · ${saved.trail.length} 个选择`));const list=el('ol');for(const step of saved.trail){const node=pack.nodes[step.node],item=el('li');item.append(el('strong',node.title),el('p',node.text));const spoken=dialogueFor(role.id,step.node);if(spoken)item.append(el('p',`${role.name}：${spoken}`));item.append(el('span',`你的选择 · ${node.choices.find(c=>c.id===step.choiceId).label}`));list.append(item);}history.append(list);panel.append(history);}
  if(!current.choices.length){const next=el('nav',undefined,'story-next');next.setAttribute('aria-label','同行之后');for(const [route,label]of [['games','再玩一会儿'],['shop','去挑一份心意']]){const a=el('a',label+' →');a.href='#/'+route;next.append(a);}panel.append(next);}
  const detail=el('details',undefined,'story-details');detail.append(el('summary','路线与插画说明'));detail.append(el('p',saved.trail.map(s=>pack.nodes[s.node].choices.find(c=>c.id===s.choiceId).label).join(' → ')||'还没有选择路线。'));detail.append(el('p','本页旁白和署名对白均为预写的虚构剧情，不是实时模型回复。插画使用内置形象；自创角色走通用路线。故事不会自动修改好感、库存或现实记忆。重选不会覆盖已收好的纪念卡，重新开始可以留另一张。'));panel.append(detail);animateImage(image);
 }
 function renderCards(role){
  host.dataset.storyMotif=packFor(role.id).motif;main.classList.add('story-journal');
  const entries=readStories(read()).cards.filter(c=>c?.roleId===role.id&&c.source==='story'&&c.fiction===true&&c.packId===packFor(role.id).id&&c.version===1);
  if(!entries.length){const empty=el('div',undefined,'story-empty');empty.append(el('h2','还有一些空白，留给下一段散步。'),el('p','完成路线后，可以收好自己的感想。这里不会自动生成角色帖子。'),button('去走一段',()=>{mode='journey';render();},'primary'));main.append(empty);return;}
  const list=el('div',undefined,'story-card-list');main.append(list);
  for(const card of entries){
   const item=el('article',undefined,'story-card');let cardSession;try{cardSession=validateSession({...card,node:card.node||'end',revision:0},role.id);}catch{continue;}
   const detail=journeyDetails(cardSession,packFor(role.id));
   item.append(art(sceneFor(cardSession,packFor(role.id)).image,`${role.name} · ${card.title}`,'story-card-art'));
   const body=el('div',undefined,'story-card-body');body.append(el('span',`${role.name} · 本机剧情手记`,'story-kicker'),el('h2',card.title),el('p',typeof card.note==='string'&&card.note?card.note:'这段散步，暂时留白。'));
   if(detail.outcomes.length){const tags=el('div',undefined,'story-outcomes');detail.outcomes.forEach(t=>tags.append(el('span',t)));body.append(tags);}
   const time=el('time');if(Number.isFinite(Date.parse(card.at))){time.dateTime=card.at;time.textContent=new Date(card.at).toLocaleDateString('zh-CN');}body.append(time);
   body.append(button(role.id==='shuyun'?'邀请她接一句':'聊聊这张纪念卡',()=>{try{discuss(validateSession({...card,node:card.node||'end',revision:0},role.id));}catch(e){report(e.message);}}));item.append(body);list.append(item);
  }
 }
 function render(){
  if(activeRole!==getRole().id||mode==='journal'){theater.close();music.stop();}sound.hidden=mode==='journal';
  active=true;activeRole=getRole().id;music.configureRole();report('');animation?.cancel();main.replaceChildren();main.classList.remove('story-journal');host.scrollTop=0;
  host.querySelector('[data-story-role]').textContent=`和${getRole().name}，去走一段。`;
  tabs.forEach(t=>t.setAttribute('aria-pressed',String(t.dataset.storyMode===mode)));
  try{if(mode==='home'){const role=getRole(),pack=packFor(role.id),entry=el('section',undefined,'story-home');const cover=el('div',undefined,'story-home-cover');cover.append(art(pack.nodes.end.image,pack.title,'story-home-art'));const copy=el('div',undefined,'story-home-copy');copy.append(el('span','同行故事 · 进度保留在本机','story-kicker'));entry.append(cover,copy);copy.append(el('h2',pack.title||'同行故事'),el('p','选择一段旅程。上次的进度会保留，打开后再继续。'),button(session()?'继续同行':'开始同行',()=>{mode='journey';render();},'primary'));const routes=el('div',undefined,'story-home-routes');for(const [i,label] of ['街道散步','挑一份心意','甜品小憩','灯火夜归'].entries()){const route=el('span');route.append(el('small',String(i+1).padStart(2,'0')),el('strong',label));routes.append(route);}copy.append(routes);main.append(entry);}else if(mode==='journal')renderCards(getRole());else renderJourney(getRole());companionPath('life',getRole(),read());}catch(e){report(e.message);}
 }
 tabs.forEach(t=>t.addEventListener('click',()=>{mode=t.dataset.storyMode;render();}));
 return {enter(page){if(page==='life'){mode='home';render();}},open(next){mode=next==='journal'?'journal':'home';render();},leave(){active=false;theater.close();music.stop();animation?.cancel();if(dialog.open)dialog.close();},refresh(){if(active){theater.close();render();}}};
}
