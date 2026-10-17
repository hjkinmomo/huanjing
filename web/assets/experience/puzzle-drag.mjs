// Pointer presentation never writes the board; moves go through the existing transaction.
export function projectedDrag(dx,dy,from,to){
 const x=to.left-from.left,y=to.top-from.top,length=Math.hypot(x,y);
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||!length)return {progress:0,x:0,y:0,offAxis:Infinity};
 const progress=Math.max(0,Math.min(1,(dx*x+dy*y)/(length*length)));
 return {progress,x:x*progress,y:y*progress,offAxis:Math.abs(dx*y-dy*x)/length};
}
export function isPuzzleNeighbor(board,index){const empty=board?.indexOf(0),size=Math.sqrt(board?.length);return [3,4,5].includes(size)&&empty>=0&&board[index]>0&&Math.abs(Math.floor(index/size)-Math.floor(empty/size))+Math.abs(index%size-empty%size)===1;}
export function mountPuzzleDrag({host,getGame,isBusy,onPick}){
 let drag=null,pendingClick=null;
 function cancel(){if(!drag)return;const d=drag;drag=null;delete d.node.dataset.dragging;d.node.style.removeProperty('transform');try{d.node.releasePointerCapture(d.pointerId);}catch{}}
 function down(e){const node=e.target.closest?.('.puzzle-board:not(.lights-board) .puzzle-cell[data-tile]'),game=getGame();if(e.button!==0||!node||!host.contains(node)||isBusy()||game?.kind!=='puzzle'||game.paused||game.status!=='playing')return;
  const index=Number(node.dataset.cell);if(!isPuzzleNeighbor(game.board,index))return;const empty=host.querySelector(`.puzzle-cell[data-cell="${game.board.indexOf(0)}"]`);if(!empty)return;
  cancel();drag={node,index,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,from:node.getBoundingClientRect(),to:empty.getBoundingClientRect(),gameId:game.id,board:game.board.join(','),moved:false,projection:null};node.setPointerCapture(e.pointerId);
 }
 function move(e){if(!drag||e.pointerId!==drag.pointerId)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;if(!drag.moved&&Math.hypot(dx,dy)<7)return;drag.moved=true;e.preventDefault();drag.projection=projectedDrag(dx,dy,drag.from,drag.to);drag.node.dataset.dragging='true';drag.node.style.transform=`translate(${drag.projection.x}px,${drag.projection.y}px)`;}
 function up(e){if(!drag||e.pointerId!==drag.pointerId)return;const d=drag,game=getGame();drag=null;try{d.node.releasePointerCapture(e.pointerId);}catch{}if(!d.moved)return;
  pendingClick={pointerId:e.pointerId,cell:d.index,until:performance.now()+500};const commit=d.projection?.progress>=.35&&d.projection.offAxis<d.from.width*.65&&!isBusy()&&game?.id===d.gameId&&game.board.join(',')===d.board&&!game.paused&&game.status==='playing';
  if(commit)Promise.resolve(onPick(d.index)).finally(()=>{delete d.node.dataset.dragging;d.node.style.removeProperty('transform');});
  else{delete d.node.dataset.dragging;d.node.style.removeProperty('transform');}
 }
 function click(e){if(!pendingClick)return;const p=pendingClick;if(performance.now()>p.until){pendingClick=null;return;}if(e.detail>0&&Number(e.target.closest?.('[data-cell]')?.dataset.cell)===p.cell&&(e.pointerId===undefined||e.pointerId===p.pointerId)){pendingClick=null;e.preventDefault();e.stopPropagation();}}
 const hidden=()=>{if(document.hidden)cancel();};host.addEventListener('pointerdown',down);host.addEventListener('pointermove',move);host.addEventListener('pointerup',up);host.addEventListener('pointercancel',cancel);host.addEventListener('lostpointercapture',cancel);host.addEventListener('click',click,true);window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);document.addEventListener('visibilitychange',hidden);
 return {cancel,destroy(){cancel();host.removeEventListener('pointerdown',down);host.removeEventListener('pointermove',move);host.removeEventListener('pointerup',up);host.removeEventListener('pointercancel',cancel);host.removeEventListener('lostpointercapture',cancel);host.removeEventListener('click',click,true);window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);document.removeEventListener('visibilitychange',hidden);}};
}
