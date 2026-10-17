// Animation observes committed UI state; it never writes game or shop data.
export function motionProfile(motif='none'){
  return motif==='koka'?{duration:300,ease:'cubic-bezier(.2,.85,.3,1.12)'}:motif==='shira'?{duration:340,ease:'cubic-bezier(.22,1,.36,1)'}:{duration:240,ease:'cubic-bezier(.2,0,.2,1)'};
}
export function motionAllowed(root=globalThis.document?.documentElement,media=globalThis.matchMedia){
  return root?.dataset.reduced!=='true'&&!media?.('(prefers-reduced-motion: reduce)').matches;
}
export function capturePieces(host){
  const positions=new Map();
  for(const node of host.querySelectorAll('[data-piece]'))positions.set(node.dataset.piece,{rect:node.getBoundingClientRect(),open:node.dataset.open,matched:node.dataset.matched,lit:node.dataset.lit,text:node.textContent,clone:node.cloneNode?.(true),color:globalThis.getComputedStyle?.(node).backgroundColor});
  return positions;
}
export function gameMotionState(game){return game?{id:game.id,status:game.status,signature:JSON.stringify([game.board,game.open,game.matched,game.moves,game.status])}:null;}
export function purchaseFrames(x,y){
  const apex=Math.min(y-70,-70);
  return Array.from({length:21},(_,i)=>{const t=i/20,u=1-t;return {offset:t,transform:`translate(${2*u*t*x*.4+t*t*x}px,${2*u*t*apex+t*t*y}px) scale(${1-.82*t})`,opacity:t<.7?1:Math.max(0,(1-t)/.3)};});
}
export function createLeisureMotion(root=document.documentElement){
  const active=new Set(),temporary=new Set();
  const stop=()=>{for(const a of active)a.cancel();active.clear();for(const node of temporary)node.remove();temporary.clear();};
  const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reducedChanged=()=>{if(!motionAllowed(root))stop();};media?.addEventListener('change',reducedChanged);
  const observer=typeof MutationObserver==='function'?new MutationObserver(reducedChanged):null;observer?.observe(root,{attributes:true,attributeFilter:['data-reduced']});
  function play(node,frames,options={}){
    if(!node?.isConnected||!motionAllowed(root)||typeof node.animate!=='function')return null;
    const p=motionProfile(root.dataset.motif);let a;try{a=node.animate(frames,{duration:p.duration,easing:p.ease,...options});}catch{return null;}active.add(a);
    const done=()=>active.delete(a);a.addEventListener('finish',done,{once:true});a.addEventListener('cancel',done,{once:true});return a;
  }
  function arrive(nodes){[...nodes].slice(0,12).forEach((n,i)=>play(n,[{opacity:.3,transform:'translateY(9px)'},{opacity:1,transform:'none'}],{delay:i*18}));}
  function game(host,before,{entered=false,finished=false,changed=false,tileTrace=null}={}){
    if(entered){arrive(host.querySelectorAll('.game-scorebar,.memory-board,.tiles-board,.puzzle-board'));return;}
    if(finished){const panel=host.querySelector('.game-result');play(panel,[{opacity:0,transform:'translateY(12px) scale(.98)'},{opacity:1,transform:'none'}]);play(panel?.querySelector('.game-grade'),[{transform:'scale(.9) rotate(-4deg)',opacity:0},{transform:'scale(1.025)',opacity:1,offset:.7},{transform:'none',opacity:1}],{duration:360});return;}
    if(!changed)return;
    if(tileTrace?.changed&&motionAllowed(root)){tileTravel(host,before,tileTrace);return;}
    // Read all new rectangles first, then write transforms: no layout thrashing.
    const pieces=[...host.querySelectorAll('[data-piece]')].map(n=>({n,old:before.get(n.dataset.piece),rect:n.getBoundingClientRect()}));
    for(const {n,old,rect} of pieces){
      if(!old)continue;
      if(n.dataset.piece.startsWith('puzzle:')){const x=old.rect.left-rect.left,y=old.rect.top-rect.top;if(x||y)play(n,[{transform:`translate(${x}px,${y}px)`},{transform:'none'}],{duration:200});}
      else if(n.dataset.piece.startsWith('memory:')){
        const turned=old.open!==n.dataset.open;
        if(turned&&motionAllowed(root))flipFace(n,old,rect);
        if(old.matched!=='true'&&n.dataset.matched==='true'){
          play(n,[{transform:'scale(1)'},{transform:'scale(1.025)',offset:.4},{transform:'none'}],{delay:turned?320:0,duration:210});
          pairGlints(rect,turned?320:0);
        }
      }else if(n.dataset.piece.startsWith('lights:')&&old.lit!==n.dataset.lit)play(n,[{backgroundColor:old.color,transform:'scale(1)'},{transform:'scale(.97)',offset:.45},{backgroundColor:getComputedStyle(n).backgroundColor,transform:'none'}],{duration:240});
      else if(n.dataset.piece.startsWith('tiles:')&&old.text!==n.textContent&&n.textContent)play(n,[{transform:'scale(.86)',opacity:.65},{transform:'scale(1.04)',opacity:1,offset:.7},{transform:'none',opacity:1}],{duration:230});
    }
  }
  function pairGlints(rect,delay){
    if(!motionAllowed(root)||temporary.size>=12)return;
    // At most four short glints per matched card; never alter input or scoring.
    for(const [x,y] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
      const glint=document.createElement('span');glint.textContent='✦';glint.className='memory-pair-glint';glint.setAttribute('aria-hidden','true');glint.inert=true;
      Object.assign(glint.style,{position:'fixed',left:`${rect.left+rect.width/2+x*rect.width*.32}px`,top:`${rect.top+rect.height/2+y*rect.height*.28}px`,pointerEvents:'none',zIndex:'21',fontSize:'15px',lineHeight:'1',color:'var(--accent)',textShadow:'0 0 8px var(--accent)',transform:'translate(-50%,-50%)'});
      document.body.append(glint);temporary.add(glint);
      const a=play(glint,[{opacity:0,transform:'translate(-50%,-50%) scale(.4)'},{opacity:.8,transform:'translate(-50%,-50%) scale(1)',offset:.25},{opacity:0,transform:`translate(calc(-50% + ${x*17}px),calc(-50% + ${y*17}px)) scale(.45)`}],{duration:460,delay,easing:'ease-out',fill:'both'});
      const clean=()=>{glint.remove();temporary.delete(glint);};if(a){a.addEventListener('finish',clean,{once:true});a.addEventListener('cancel',clean,{once:true});}else clean();
    }
  }
  function flipFace(node,old,rect){
    const ghost=old.clone;if(!ghost)return;
    ghost.removeAttribute('id');ghost.removeAttribute('data-piece');ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.classList.add('memory-flip-ghost');
    Object.assign(ghost.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',zIndex:'20',pointerEvents:'none'});
    document.body.append(ghost);temporary.add(ghost);
    const clean=()=>{ghost.remove();temporary.delete(ghost);};
    const a=play(ghost,[{transform:'perspective(650px) rotateY(0deg)'},{transform:'perspective(650px) rotateY(90deg)'}],{duration:150,easing:'cubic-bezier(.55,0,1,.45)'});
    play(node,[{transform:'perspective(650px) rotateY(-90deg)',opacity:0},{transform:'perspective(650px) rotateY(0deg)',opacity:1}],{delay:150,duration:170,fill:'backwards',easing:'cubic-bezier(0,.55,.45,1)'});
    if(a){a.addEventListener('finish',clean,{once:true});a.addEventListener('cancel',clean,{once:true});}else clean();
  }
  function tileTravel(host,before,trace){
    const board=host.querySelector('.tiles-board');if(!board)return;
    const cells=[...board.querySelectorAll('.tile')],origin=board.getBoundingClientRect(),rects=cells.map(n=>n.getBoundingClientRect()),targets=new Set(trace.motions.map(m=>m.to)),popped=new Set();
    for(const target of targets)play(cells[target],[{opacity:0},{opacity:1}],{fill:'backwards',delay:160,duration:100});
    cells.forEach((n,i)=>{if(n.textContent&&!targets.has(i))play(n,[{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'none'}],{fill:'backwards',delay:160,duration:160});});
    for(const move of trace.motions){const old=before.get(`tiles:${move.from}`)?.rect,to=rects[move.to];if(!old||!to)continue;
      const ghost=document.createElement('span');ghost.className=`tile tile-${Math.min(move.value,2048)} tile-traveler`;ghost.textContent=String(move.value);ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{left:`${old.left-origin.left}px`,top:`${old.top-origin.top}px`,width:`${old.width}px`,height:`${old.height}px`});board.append(ghost);temporary.add(ghost);
      const a=play(ghost,[{transform:'translate(0,0)',opacity:1},{transform:`translate(${to.left-old.left}px,${to.top-old.top}px)`,opacity:1}],{duration:180,easing:'cubic-bezier(.2,0,.2,1)'});
      const clean=()=>{ghost.remove();temporary.delete(ghost);};if(a){a.addEventListener('finish',()=>{clean();if(move.merged&&!popped.has(move.to)){popped.add(move.to);play(cells[move.to],[{transform:'scale(1.12)'},{transform:'none'}],{duration:140});}},{once:true});a.addEventListener('cancel',clean,{once:true});}else clean();
    }
  }
  function purchase(image,target){
    if(!image?.complete||!image.naturalWidth||!target||!motionAllowed(root))return;
    const from=image.getBoundingClientRect(),to=target.getBoundingClientRect();
    if(!from.width||!to.width)return;
    const ghost=document.createElement('img');ghost.src=image.currentSrc;ghost.alt='';ghost.className='purchase-flight';ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{left:`${from.left}px`,top:`${from.top}px`,width:`${from.width}px`,height:`${from.height}px`});document.body.append(ghost);temporary.add(ghost);
    const x=to.left+to.width/2-from.left-from.width/2,y=to.top+to.height/2-from.top-from.height/2;
    const a=play(ghost,purchaseFrames(x,y),{duration:520,easing:'cubic-bezier(.22,1,.36,1)'});
    const clean=()=>{ghost.remove();temporary.delete(ghost);};if(a){a.addEventListener('finish',()=>{clean();play(target,[{transform:'scale(1)'},{transform:'scale(1.07)',offset:.5},{transform:'none'}],{duration:200});},{once:true});a.addEventListener('cancel',clean,{once:true});}else clean();
  }
  return {stop,play,arrive,game,purchase,dispose(){stop();observer?.disconnect();media?.removeEventListener('change',reducedChanged);}};
}
