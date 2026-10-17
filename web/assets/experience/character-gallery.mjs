// Pointer motion belongs to the cover only. No permanent render loop or layout reads on each event.
export function mountCharacterGallery(host) {
  const fine=matchMedia('(hover: hover) and (pointer: fine)'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let active=null,frame=0,point=null,bounds=null;
  const allowed=()=>fine.matches&&!reduce.matches&&document.documentElement.dataset.reduced!=='true'&&!document.hidden;
  function reset(){if(frame)cancelAnimationFrame(frame);frame=0;point=null;bounds=null;if(active){delete active.dataset.coverActive;for(const name of ['--cover-x','--cover-y','--cover-rx','--cover-ry'])active.style.removeProperty(name);}active=null;}
  function move(event){
    const card=event.target.closest?.('.character-card');if(!allowed()||!card||!host.contains(card)){reset();return;}
    if(card!==active){reset();active=card;bounds=card.querySelector('.character-card-visual').getBoundingClientRect();card.dataset.coverActive='true';}
    point={x:event.clientX,y:event.clientY};if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;if(!active||!bounds||!point||!allowed()){reset();return;}const x=Math.max(0,Math.min(1,(point.x-bounds.left)/Math.max(1,bounds.width))),y=Math.max(0,Math.min(1,(point.y-bounds.top)/Math.max(1,bounds.height)));active.style.setProperty('--cover-x',`${x*100}%`);active.style.setProperty('--cover-y',`${y*100}%`);active.style.setProperty('--cover-rx',`${(0.5-y)*4}deg`);active.style.setProperty('--cover-ry',`${(x-0.5)*4}deg`);});
  }
  const out=event=>{if(active&&!active.contains(event.relatedTarget))reset();};
  host.addEventListener('pointermove',move);host.addEventListener('pointerleave',reset);host.addEventListener('pointerout',out);
  window.addEventListener('resize',reset);document.addEventListener('visibilitychange',reset);fine.addEventListener('change',reset);reduce.addEventListener('change',reset);
  const observer=new MutationObserver(()=>{if(!allowed())reset();});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced']});
  return {reset,destroy(){reset();observer.disconnect();host.removeEventListener('pointermove',move);host.removeEventListener('pointerleave',reset);host.removeEventListener('pointerout',out);window.removeEventListener('resize',reset);document.removeEventListener('visibilitychange',reset);fine.removeEventListener('change',reset);reduce.removeEventListener('change',reset);}};
}
