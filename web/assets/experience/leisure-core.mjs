import '../shared-state.js';
import '../gift-catalog.js';
import {ARCADE_GAMES,arcadeAction} from './arcade-core.mjs';
import {PUZZLE_SCENES} from './play-art.mjs';
import {puzzleGames,puzzleStart,puzzleAction} from './puzzle-games.mjs';
import {shippingRequest} from './parcel-core.mjs';
const shared=globalThis.HermesSharedState;
export const products=globalThis.HermesGiftCatalog.gifts;
export const games=Object.freeze({memory:{name:'记忆花园',note:'翻开、记住、找到另一半',mark:'✿'},tiles:{name:'2048',note:'滑动合并，把数字慢慢变大',mark:'2048'},...puzzleGames,...ARCADE_GAMES});
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function rewardDay(at){const d=new Date(at);if(!Number.isFinite(d.getTime()))throw new Error('游戏时间无效。');return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function balance(state){if(state.coins===undefined)return 520;if(!integer(state.coins))throw new Error('金币记录异常，未更改资料。');return state.coins;}
export function productLock(gift,state){
  if(!gift.unlockTier)return '';
  const tier=globalThis.HermesGiftCatalog.tiers.find(t=>t.id===gift.unlockTier);
  if(!tier) return '此物品暂未开放';
  return (state.affection?.[gift.unlockRole]||0)>=tier.min?'':'随好感变化解锁';
}
export function purchase(source,{giftId,quantity=1,operationId,at,shipping}){
  shipping=shippingRequest(shipping);
  const gift=products.find(g=>g.id===giftId);
  if(!gift||!integer(quantity)||quantity<1||quantity>5||!Number.isFinite(Date.parse(at))||!/^[\w-]{8,100}$/.test(operationId||''))throw new Error('购买请求无效。');
  const previous=source.shopOperations?.[operationId];
  if(previous){if(previous.giftId!==giftId||previous.quantity!==quantity||(previous.parcelDueUtc||'')!==(shipping?.dueUtc||'')||(previous.parcelMode||'')!==(shipping?.mode||''))throw new Error('购买请求冲突。');return {state:source,receipt:previous,duplicate:true};}
  const lock=productLock(gift,source);if(lock)throw new Error(lock);
  if(source.inventory&&(!source.inventory||typeof source.inventory!=='object'||Array.isArray(source.inventory))||source.shopLog&&!Array.isArray(source.shopLog))throw new Error('库存或购买记录异常，未扣款。');
  const total=gift.price*quantity,coins=balance(source),owned=source.inventory?.[giftId]??0;
  if(!integer(owned)||!integer(total)||!Number.isSafeInteger(owned+quantity))throw new Error('库存记录异常，未扣款。');
  if(coins<total)throw new Error('金币不足，先去游乐室玩一局吧。');
  const next=structuredClone(source),receipt={id:operationId,giftId,giftName:gift.name,quantity,total,at};
  next.coins=coins-total;
  if(shipping){Object.assign(receipt,{parcelDueUtc:shipping.dueUtc,parcelMode:shipping.mode,parcelStatus:'shipping'});next.shoppingParcels={...next.shoppingParcels,[operationId]:{id:operationId,giftId,giftName:gift.name,quantity,mode:shipping.mode,status:'shipping',dueUtc:shipping.dueUtc,orderedUtc:shipping.worldUtc}};}
  else next.inventory={...next.inventory,[giftId]:owned+quantity};
  next.shopOperations={...next.shopOperations,[operationId]:receipt};
  next.shopLog=[receipt,...(next.shopLog||[])].slice(0,100);
  return {state:next,receipt,duplicate:false};
}
export async function buyProduct(storage,locks,request){return shared.exclusive(locks,()=>{const snapshot=shared.read(storage),result=purchase(snapshot.state,request);return result.duplicate?result:{...result,...shared.commit(storage,snapshot,result.state,request.at)};});}
export function shuffle(items,random=Math.random){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
function spawn(board,random,difficulty='calm'){const empty=board.map((v,i)=>v===0?i:-1).filter(i=>i>=0);if(!empty.length)return board;const result=[...board];result[empty[Math.floor(random()*empty.length)]]=random()<(difficulty==='challenge'?.75:.9)?2:4;return result;}
export function startGame({kind,difficulty='calm',role,id,at,sceneId,size=3},random=Math.random){
  if(!games[kind]||!role?.id||!/^[A-Za-z0-9_.:-]{1,80}$/.test(role.id)||!/^[\w-]{8,100}$/.test(id||'')||!Number.isFinite(Date.parse(at))||!['calm','challenge'].includes(difficulty))throw new Error('无法开始这局游戏。');
  const game={id,kind,difficulty,roleId:role.id,roleName:role.name,at,status:'playing',moves:0,score:0};
  if(kind==='puzzle'&&sceneId!==undefined){if(typeof sceneId!=='string'||!Object.hasOwn(PUZZLE_SCENES,sceneId))throw new Error('这张拼图暂时不可用。');game.sceneId=sceneId;}
  if(ARCADE_GAMES[kind])return {...game,seed:Math.floor(random()*4294967296),checkpoint:null};
  if(puzzleGames[kind])return {...game,...puzzleStart(kind,random,difficulty,size)};
  if(kind==='memory'){const pairs=difficulty==='challenge'?12:8;return {...game,deck:shuffle(Array.from({length:pairs*2},(_,i)=>i%pairs),random),matched:[],open:[],mismatches:0};}
  const board=spawn(spawn(Array(16).fill(0),random,difficulty),random,difficulty);return {...game,board,maxTile:Math.max(...board)};
}
export function slide(board,direction){
  const {motions,...result}=slideWithTrace(board,direction);return result;
}
// Display provenance is returned, never written into saved game records.
export function slideWithTrace(board,direction){
  if(!['left','right','up','down'].includes(direction))return {board,score:0,changed:false,motions:[]};
  const result=[...board],motions=[];let score=0;
  for(let row=0;row<4;row++){
    let ids=Array.from({length:4},(_,i)=>['left','right'].includes(direction)?row*4+i:i*4+row);
    if(['right','down'].includes(direction))ids.reverse();
    const compact=ids.filter(i=>board[i]).map(i=>({value:board[i],from:i})),merged=[];
    for(let i=0;i<compact.length;i++){const first=compact[i],second=compact[i+1],to=ids[merged.length];if(first.value===second?.value){merged.push(first.value*2);score+=first.value*2;motions.push({from:first.from,to,value:first.value,merged:true},{from:second.from,to,value:second.value,merged:true});i++;}else{merged.push(first.value);motions.push({from:first.from,to,value:first.value,merged:false});}}
    while(merged.length<4)merged.push(0);ids.forEach((id,i)=>result[id]=merged[i]);
  }
  return {board:result,score,changed:result.some((v,i)=>v!==board[i]),motions};
}
export function tileOver(board){return ['left','right','up','down'].every(d=>!slide(board,d).changed);}
export function gameAction(game,action,random=Math.random){
  if(!game||game.status!=='playing')return game;
  if(action.type==='pause')return game.paused?game:{...game,paused:true};
  if(action.type==='resume')return game.paused?{...game,paused:false}:game;
  if(game.paused)return game;
  if(ARCADE_GAMES[game.kind])return arcadeAction(game,action);
  if(action.type==='undo'){
    if(game.difficulty==='challenge'||game.kind==='memory'||!game.undoHistory?.length)return game;
    const history=game.undoHistory.slice(0,-1),previous=game.undoHistory.at(-1);
    if(!previous||!Array.isArray(previous.board)||previous.board.length!==game.board.length||!integer(previous.score)||previous.board.some(v=>!integer(v)))throw new Error('撤回记录异常，棋盘未更改。');
    return {...game,board:[...previous.board],score:previous.score,...(game.kind==='tiles'?{maxTile:Math.max(...previous.board)}:{}),moves:game.moves,undoHistory:history,undos:(game.undos||0)+1};
  }
  if(puzzleGames[game.kind]){
    const next=puzzleAction(game,action);
    return withUndo(game,next);
  }
  const next=structuredClone(game);
  if(next.kind==='memory'){
    if(action.type==='close'){if(next.open.length===2)next.open=[];return next;}
    if(action.type!=='flip'||!integer(action.index)||action.index>=next.deck.length||next.open.length===2||next.matched.includes(action.index)||next.open.includes(action.index))return game;
    next.open.push(action.index);
    if(next.open.length===2){next.moves++;const [a,b]=next.open;if(next.deck[a]===next.deck[b]){next.matched.push(a,b);next.open=[];}else next.mismatches++;}
    next.score=next.matched.length/2*100;
    if(next.matched.length===next.deck.length){next.status='finished';next.score=Math.max(100,Math.round(1000*(next.deck.length/2)/next.moves));next.grade=next.mismatches<=2?'S':next.mismatches<=6?'A':'B';}
  }else if(action.type==='move'){
    const moved=slide(next.board,action.direction);if(!moved.changed)return game;
    next.board=spawn(moved.board,random,next.difficulty);next.moves++;next.score+=moved.score;next.maxTile=Math.max(...next.board);
    if(next.maxTile>=2048||tileOver(next.board)){next.status='finished';next.grade=next.maxTile>=2048?'S':next.maxTile>=512?'A':'B';}
  }else if(action.type==='finish'&&next.kind==='tiles'&&next.moves>=5){next.status='finished';next.grade=next.maxTile>=512?'A':'B';}
  return withUndo(game,next);
}
function withUndo(previous,next){
  if(next===previous||next.status!=='playing'||next.moves===previous.moves||previous.kind==='memory'||previous.difficulty==='challenge')return next;
  const saved={board:[...previous.board],score:previous.score};if(previous.maxTile!==undefined)saved.maxTile=previous.maxTile;
  return {...next,undoHistory:[...(previous.undoHistory||[]),saved].slice(-20)};
}
export function recordGame(source,game,at){
  if(game.status!=='finished'||game.receipt)return {state:source,game};
  const coins=balance(source),day=rewardDay(at),records=source.leisure?.records||[];
  const earned=source.leisure?.daily?.[day]||0;
  if(!integer(earned)||!Array.isArray(records))throw new Error('游戏奖励记录异常，未更改资料。');
  const asked=game.kind==='memory'?(game.difficulty==='challenge'?18:12)+(game.grade==='S'?6:0):puzzleGames[game.kind]?12+(game.grade==='S'?6:0):Math.min(24,Math.floor(game.score/100));
  const reward=Math.max(0,Math.min(asked,60-earned));if(!Number.isSafeInteger(coins+reward))throw new Error('金币已达安全上限。');
  const receipt={id:game.id,kind:game.kind,...(game.kind==='puzzle'?{size:game.size||3,sceneId:game.sceneId}:{}),difficulty:game.difficulty||'calm',undos:game.undos||0,roleId:game.roleId,roleName:game.roleName,score:game.score,moves:game.moves,grade:game.grade,reward,day,at};
  const next=structuredClone(source);next.coins=coins+reward;
  // Keep reward totals independently from the capped visible history.
  next.leisure={...next.leisure,daily:{...(next.leisure?.daily||{}),[day]:(next.leisure?.daily?.[day]||0)+reward},records:[receipt,...records].slice(0,50)};
  return {state:next,game:{...game,receipt}};
}
export async function playTransaction(storage,locks,{type,sessionId,action,request,at},random=Math.random){
  if(!Number.isFinite(Date.parse(at)))throw new Error('游戏时间无效。');
  return shared.exclusive(locks,()=>{
    const snapshot=shared.read(storage);let next=structuredClone(snapshot.state),active=next.leisure?.active;
    if(next.leisure?.records&&!Array.isArray(next.leisure.records))throw new Error('游戏记录异常，未更改资料。');
    if(type==='start'){
      if(active?.status==='playing')throw new Error('先完成当前一局，再开始新游戏。');
      active=startGame(request,random);
    }else{
      if(!active||active.id!==sessionId)throw new Error('游戏已在另一个窗口变化，请刷新。');
      if(type==='abandon'){active={...active,status:'abandoned'};}
      else if(type==='action')active=gameAction(active,action,random);
      else throw new Error('操作无效。');
    }
    if(active.status==='finished'&&!active.receipt){
      const result=recordGame(next,active,at);next=result.state;active=result.game;
    }
    next.leisure={...next.leisure,active};
    return {...shared.commit(storage,snapshot,next,at),game:active};
  });
}
