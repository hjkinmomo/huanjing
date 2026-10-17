import {staticCardThumbnail} from './static-card-preview.mjs';
import {themeChoice,resolveTheme,THEME_IDS,CHARACTER_THEMES,setGlobalTheme} from './themes.mjs?v=stage-background-20261011';
import {characterMode} from './character-layers.mjs';
import {affinityArtwork,affinityUnlockHint} from './affinity-art.mjs';
export {changeCardFx,selectedCardFx} from './card-fx-config.mjs';
import {CARD_MATERIALS} from './card-display-config.mjs';
export {changeCardDisplay,selectedCardDisplay} from './card-display-config.mjs';
export const SCENES=Object.freeze(['auto','casual','creative','work','comfort']);
export const CARD_FINISHES=Object.freeze(CARD_MATERIALS.map(p=>p.id));
export const CARD_STAGES=Object.freeze(['none','halo','flow','portal','aurora','stars']);
export function selectedCardStage(state,role){
  const stage=state.display?.[role.id]?.cardStage;
  return CARD_STAGES.includes(stage)?stage:'halo';
}
export function changeCardStage(state,role,stage){
  if(!CARD_STAGES.includes(stage))throw new Error('展示效果选项无效。');
  state.display||={};state.display[role.id]={...state.display[role.id],cardStage:stage};
}
export function changeCardFinish(state,role,finish){
  if(!CARD_FINISHES.includes(finish))throw new Error('卡片材质选项无效。');
  state.display||={};state.display[role.id]={...state.display[role.id],cardFinish:finish};
}
export function portraitScene(role,state,history=[]){
  const manual=state.display?.[role.id]?.sceneMode;
  if(SCENES.includes(manual)&&manual!=='auto')return manual;
  const recent=[...history].reverse().find(m=>m?.from==='user'&&typeof m.text==='string'&&m.synthetic!==true&&!['demo','fallback'].includes(m.tone)&&m.status!=='failed'&&m.replyState!=='failed');
  return characterMode(recent?.text||'').id;
}
export function portraitOptions(role,score=0,unlockAll=false){
  const affinity=Number.isFinite(Number(score))?Math.max(0,Number(score)):0;
  const seen=new Set();
  return (Array.isArray(role.portraits)?role.portraits:[]).filter(p=>p&&typeof p.id==='string'&&p.id.trim().length>0&&p.id.length<=80&&p.id!=='__default'&&typeof p.src==='string'&&p.src.trim().length>0&&!seen.has(p.id)&&seen.add(p.id)).map(p=>{
    const threshold=Number.isFinite(Number(p.unlockAt))?Math.max(0,Number(p.unlockAt)):0;
    return {id:p.id,label:String(p.label||'立绘').slice(0,80),src:p.src,threshold,classic:p.collection==='classic',hint:String(p.availabilityHint||affinityUnlockHint(threshold)),available:unlockAll===true||affinity>=threshold};
  }).sort((a,b)=>Number(b.available)-Number(a.available)||a.threshold-b.threshold);
}
export function selectedPortrait(role,state,score,scene='casual'){
  const id=state.display?.[role.id]?.portraitId;
  const options=portraitOptions(role,score,state.settings?.unlockAllPortraits===true),fixed=options.find(p=>p.id===id&&p.available);
  if(fixed)return fixed.src;
  // Old custom selection remains the default; only a declared scene mapping can switch it.
  const varying=affinityArtwork(role,scene,options,score);if(varying)return varying.src;
  const mapped=role.scenePortraits?.[scene];
  return options.find(p=>p.id===mapped&&p.available)?.src||role.portrait||'';
}
export function changeScene(state,role,scene){
  if(!SCENES.includes(scene))throw new Error('场景选项无效。');
  state.display||={};state.display[role.id]={...state.display[role.id],sceneMode:scene,portraitId:'__default'};
}
export function changePortrait(state,role,id,score){
  if(id!=='__default'&&!portraitOptions(role,score,state.settings?.unlockAllPortraits===true).some(p=>p.id===id&&p.available))throw new Error('这张立绘尚未可用，请重新选择。');
  state.display||={};state.display[role.id]={...state.display[role.id],portraitId:id};
}
export function quickPreference(state,name,value){
  if(name==='theme'&&THEME_IDS.includes(value))setGlobalTheme(state,value);
  else if(name==='fontScale'&&['small','medium','large'].includes(value))state.settings.fontScale=value;
  else if(name==='density'&&['compact','comfortable','airy'].includes(value))state.settings.density=value;
  else if(name==='avatarStyle'&&['portrait','sticker'].includes(value))state.settings.avatarStyle=value;
  else if(name==='portraitSize'&&['compact','balanced','large'].includes(value))state.settings.portraitSize=value;
  else if(name==='portraitFit'&&['scene','full'].includes(value))state.settings.portraitFit=value;
  else if(['focusMode','reducedMotion','unlockAllPortraits'].includes(name)&&typeof value==='boolean')state.settings[name]=value;
  else throw new Error('显示选项无效。');
}
export function mountDisplayTools({dialog,getRole,getState,getPreferences,getScore,safeMedia,mutate,refresh}){
  let role=null,trigger=null;
  const find=s=>dialog.querySelector(s);
  const feedback=text=>find('[data-display-feedback]').textContent=text;
  function commit(action){const columns=[...dialog.querySelectorAll('.display-preferences,.display-gallery')].map(n=>[n,n.scrollTop]);const key=document.activeElement?.dataset.displayFocus;try{mutate(action);refresh();render();for(const [node,top]of columns)node.scrollTop=top;feedback('已保存');if(key)[...dialog.querySelectorAll('[data-display-focus]')].find(b=>b.dataset.displayFocus===key)?.focus({preventScroll:true});}catch(error){feedback(error.message);}}
  function chooseButtons(host,options,selected,select){const group=host.hasAttribute('data-theme-choices')?'theme':host.hasAttribute('data-size-choices')?'size':host.hasAttribute('data-density-choices')?'density':host.hasAttribute('data-avatar-choices')?'avatar':'font';host.replaceChildren();for(const o of options){const b=document.createElement('button');b.type='button';b.textContent=o.label;b.dataset.displayFocus=`${group}:${o.id}`;b.setAttribute('aria-pressed',String(selected===o.id));b.onclick=()=>select(o.id);host.append(b);}}
  function render(){
    const state=getState(),pref=getPreferences();find('[data-display-role]').textContent=role.name;
    const themes=[...([['light','简洁浅色'],['dark','简洁深色'],['system','系统'],['character','跟随角色']].map(([id,label])=>({id,label}))),...CHARACTER_THEMES];
    const host=find('[data-theme-choices]');
    if(!dialog.querySelector('.theme-scope-note')){const note=document.createElement('p');note.className='theme-scope-note';note.textContent='整体主题对所有角色和页面生效。只有选择“跟随角色”时，主题才会随角色切换。';host.before(note);}
    chooseButtons(host,themes,themeChoice(pref),id=>commit(s=>setGlobalTheme(s,id)));
    [...host.children].forEach((b,i)=>{const t=resolveTheme({theme:themes[i].id,themeChoiceVersion:1},role).tokens;b.style.setProperty('--swatch-bg',t.bg);b.style.setProperty('--swatch-ink',t.accent);});
    chooseButtons(find('[data-font-choices]'),[{id:'small',label:'小字'},{id:'medium',label:'标准'},{id:'large',label:'大字'}],pref.fontScale||'medium',id=>commit(s=>quickPreference(s,'fontScale',id)));
    chooseButtons(find('[data-density-choices]'),[{id:'compact',label:'紧凑'},{id:'comfortable',label:'舒适'},{id:'airy',label:'宽松'}],pref.density||'comfortable',id=>commit(s=>quickPreference(s,'density',id)));
    chooseButtons(find('[data-avatar-choices]'),[{id:'portrait',label:'角色肖像'},{id:'sticker',label:'手绘贴纸'}],pref.avatarStyle||'portrait',id=>commit(s=>quickPreference(s,'avatarStyle',id)));
    chooseButtons(find('[data-size-choices]'),[{id:'compact',label:'紧凑'},{id:'balanced',label:'均衡'},{id:'large',label:'宽幅'}],pref.portraitSize||'balanced',id=>commit(s=>quickPreference(s,'portraitSize',id)));
    find('[data-scene-mode]').value=SCENES.includes(state.display?.[role.id]?.sceneMode)?state.display[role.id].sceneMode:'auto';
    find('[data-portrait-fit]').value=pref.portraitFit==='full'?'full':'scene';
    find('[data-focus-mode]').checked=!!pref.focusMode;find('[data-motion-mode]').checked=!!pref.reducedMotion;
    const gallery=find('[data-portrait-choices]');gallery.replaceChildren();
    const unlocked=state.settings?.unlockAllPortraits===true;find('[data-unlock-art]').checked=unlocked;
    const options=[{id:'__default',label:'跟随场景与好感变化',src:role.portrait,available:true},...portraitOptions(role,getScore(role.id),unlocked)];
    const groups=new Map();
    for(const [key,title] of [['available','可使用'],['locked','待解锁']]){
      const section=document.createElement('section'),heading=document.createElement('h4'),body=document.createElement('div');
      section.className='portrait-group';section.dataset.portraitGroup=key;body.className='portrait-group-grid';
      const count=options.filter(o=>o.available===(key==='available')).length;heading.textContent=`${title} · ${count}`;
      section.append(heading,body);if(count)gallery.append(section);groups.set(key,body);
    }
    for(const option of options){const button=document.createElement('button');button.type='button';button.className='portrait-choice';button.disabled=!option.available;button.dataset.displayFocus=`portrait:${option.id}`;
      button.setAttribute('aria-pressed',String((state.display?.[role.id]?.portraitId||'__default')===option.id));
      const image=staticCardThumbnail(option.src,role.name,safeMedia);
      const label=document.createElement('span');label.textContent=option.label;const hint=document.createElement('small');hint.textContent=option.available?(option.classic?'可使用 · 经典':'可使用'):option.hint;button.append(image,label,hint);
      button.onclick=()=>commit(s=>changePortrait(s,role,option.id,getScore(role.id)));groups.get(option.available?'available':'locked').append(button);
    }
    find('[data-portrait-note]').textContent=options.length===1?'暂时没有更多立绘，可在角色资源编辑器中添加。':unlocked?'全部立绘已开放。手动选择可固定显示；好感和关系记录保持原样。':'手动选择会固定显示；跟随场景时，可随本角色的好感变化切换。关闭开放开关会恢复原解锁条件。';
  }
  find('[data-scene-mode]').onchange=e=>commit(s=>changeScene(s,role,e.target.value));
  find('[data-portrait-fit]').onchange=e=>commit(s=>quickPreference(s,'portraitFit',e.target.value));
  find('[data-focus-mode]').onchange=e=>commit(s=>quickPreference(s,'focusMode',e.target.checked));
  find('[data-motion-mode]').onchange=e=>commit(s=>quickPreference(s,'reducedMotion',e.target.checked));
  find('[data-unlock-art]').onchange=e=>commit(s=>quickPreference(s,'unlockAllPortraits',e.target.checked));
  dialog.addEventListener('close',()=>trigger?.isConnected&&trigger.focus({preventScroll:true}));
  return {open(button){role=getRole();trigger=button;feedback('');render();dialog.showModal();},close(){if(dialog.open)dialog.close();}};
}

