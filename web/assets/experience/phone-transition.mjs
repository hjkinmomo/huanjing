import {appViewport} from './app-scale.mjs';
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const reduced=()=>document.documentElement.dataset.reduced==='true';
const px=rect=>Object.fromEntries(Object.entries(rect).map(([k,n])=>[k,n+'px']));
function rectangle(rect){const {scale}=appViewport();return {left:rect.left/scale,top:rect.top/scale,width:rect.width/scale,height:rect.height/scale};}
export function landscapeTransition(v){
 const width=Math.min(v.w-32,(v.h-60)*1.7),height=width/1.7;
 // The portrait device really turns ninety degrees; its projected bounds stay inside the viewport.
 return {middle:{left:(v.w-height)/2,top:(v.h-width)/2,width:height,height:width},full:{left:(v.w-v.h)/2,top:(v.h-v.w)/2,width:v.h,height:v.w}};
}
function overlay(game){
 const dialog=document.createElement('dialog');dialog.className='phone-app-transition';dialog.setAttribute('aria-label',`正在切换${game.name}`);dialog.setAttribute('aria-busy','true');dialog.addEventListener('cancel',e=>e.preventDefault());
 const shell=document.createElement('div');shell.className='phone-transition-shell';const icon=document.createElement('img');icon.src=game.image;icon.alt='';icon.className='phone-transition-icon';
 const hardware=document.createElement('span');hardware.className='phone-transition-hardware';hardware.setAttribute('aria-hidden','true');const loading=document.createElement('div');loading.className='phone-game-loading';loading.innerHTML='<span class="phone-loading-symbol" aria-hidden="true">◇</span><strong></strong><small>正在进入游戏</small>';loading.querySelector('strong').textContent=game.name;shell.append(icon,hardware,loading);dialog.append(shell);document.body.append(dialog);dialog.showModal();
 return {dialog,shell,icon,loading,destroy(){dialog.close();dialog.remove();}};
}
async function animate(node,frames,ms){
 const animation=node.animate(frames,{duration:reduced()?1:ms,easing:'cubic-bezier(.22,.78,.24,1)',fill:'forwards'});
 try{await animation.finished;}finally{if(node.isConnected)Object.assign(node.style,frames.at(-1));animation.cancel();}
}
export async function expandPhoneGame({game,rect,onCovered}){
 if(reduced()){await onCovered();return;}
 const fx=overlay(game),v=appViewport(),from=rectangle(rect),{middle,full}=landscapeTransition(v);
 Object.assign(fx.shell.style,px(from),{borderRadius:'22px'});fx.dialog.dataset.phase='turning';
 try{
  await Promise.all([
   animate(fx.shell,[{...px(from),transform:'rotate(0deg)',borderRadius:'22px'},{...px(middle),transform:'rotate(-90deg)',borderRadius:'38px',offset:.78},{...px(full),transform:'rotate(-90deg)',borderRadius:'0px'}],720),
   animate(fx.loading,[{transform:'rotate(0deg)',opacity:0},{transform:'rotate(90deg)',opacity:1}],720),
  ]);
  fx.dialog.dataset.phase='opening';await onCovered();await frame();await animate(fx.dialog,[{opacity:1},{opacity:0}],190);
 }finally{fx.destroy();}
}
export async function collapsePhoneGame({game,preview,onCovered,findIcon}){
 if(reduced()){await onCovered();return;}
 const fx=overlay(game),v=appViewport(),{middle,full}=landscapeTransition(v);Object.assign(fx.shell.style,px(full),{borderRadius:'0px',transform:'rotate(-90deg)'});fx.icon.style.opacity='0';fx.icon.style.transform='rotate(90deg)';fx.loading.hidden=true;
 const clone=preview?.cloneNode(true);
 if(clone){clone.classList.add('phone-transition-preview');clone.removeAttribute('id');clone.style.width=v.w+'px';clone.style.height=v.h+'px';clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));clone.querySelectorAll('dialog').forEach(n=>n.remove());clone.querySelectorAll('input,textarea,select,button,a').forEach(n=>n.tabIndex=-1);fx.shell.append(clone);}
 try{
  await onCovered();let rect;
  for(let i=0;i<18;i++){await frame();const candidate=findIcon()?.getBoundingClientRect();if(candidate?.width>40&&candidate?.height>40){rect=candidate;break;}}
  const to=rect?rectangle(rect):{left:18,top:v.h-110,width:70,height:88};fx.dialog.dataset.destination=JSON.stringify(to);fx.dialog.dataset.phase='returning';
  const shrink=animate(fx.shell,[{...px(full),transform:'rotate(-90deg)',borderRadius:'0px'},{...px(middle),transform:'rotate(-90deg)',borderRadius:'38px',offset:.3},{...px(to),transform:'rotate(0deg)',borderRadius:'22px'}],650);
  const image=animate(fx.icon,[{opacity:0,transform:'rotate(90deg)'},{opacity:0,transform:'rotate(90deg)',offset:.3},{opacity:1,transform:'rotate(0deg)'}],650);
  const fade=clone?animate(clone,[{opacity:1},{opacity:0}],300):Promise.resolve();await Promise.all([shrink,image,fade]);await animate(fx.dialog,[{opacity:1},{opacity:0}],100);
 }finally{fx.destroy();}
}
