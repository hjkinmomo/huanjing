// Pure, turn-based puzzles: no timers or side effects; persisted by the shared game transaction.
import {KLOTSKI_OPENING,KLOTSKI_NEAR_EXIT,klotskiAction,klotskiOpening} from './klotski.mjs';
export const puzzleGames={klotski:{name:'木间华容道',note:'移动木块，让归舟抵达下方出口',mark:'舟'},puzzle:{name:'拼图小憩',note:'拖动拼块，把散落的画面拼完整',mark:'8'},lights:{name:'熄灯晚安',note:'点亮与熄灭，寻找安静的全暗',mark:'☾'}};
export function puzzleStart(kind,random,difficulty='calm',size=3){
 if(kind==='klotski'){const opening=klotskiOpening(random,difficulty);return {board:opening.board,openingName:opening.name};}
 if(![3,4,5].includes(size))throw Error('拼图仅支持 3×3、4×4、5×5。');
 if(kind==='puzzle'){
  const solved=()=>Array.from({length:size*size},(_,i)=>(i+1)%(size*size));
  let board=solved(),last=-1;
  const steps=difficulty==='challenge'?size*size*8:size===3?6:size*size*2;
  for(let attempt=0;attempt<12;attempt++){
   board=solved();last=-1;
   for(let n=0;n<steps;n++){const empty=board.indexOf(0),choices=neighbors(empty,size).filter(i=>i!==last),pick=choices[Math.floor(random()*choices.length)];[board[empty],board[pick]]=[board[pick],board[empty]];last=empty;}
   const distance=board.reduce((sum,v,i)=>sum+(v?Math.abs(Math.floor(i/size)-Math.floor((v-1)/size))+Math.abs(i%size-(v-1)%size):0),0);
   if(difficulty!=='challenge'||distance>=10)break;
   if(attempt===11&&size===3)board=[8,6,7,2,5,4,3,0,1];
  }
  if(board.every((v,i)=>v===(i+1)%board.length)){const last=board.length-1;[board[last-1],board[last]]=[board[last],board[last-1]];}
  return {board,size};
 }
 let board=Array(9).fill(0);
 const picks=Array.from({length:9},(_,i)=>i);
 for(let i=8;i>0;i--){const j=Math.floor(random()*(i+1));[picks[i],picks[j]]=[picks[j],picks[i]];}
 const count=(difficulty==='challenge'?5:1)+Math.floor(random()*3);
 for(const i of picks.slice(0,count))board=toggle(board,i);
 return {board};
}
export function neighbors(i,size=3){return Array.from({length:size*size},(_,j)=>j).filter(j=>Math.abs(Math.floor(j/size)-Math.floor(i/size))+Math.abs(j%size-i%size)===1);}
export function toggle(board,i){const result=[...board];for(const j of [i,...neighbors(i)])result[j]=1-result[j];return result;}
export function puzzleAction(game,action){
 if(game.kind==='klotski')return klotskiAction(game,action);
 const size=game.kind==='puzzle'?Math.sqrt(game.board.length):3;
 if(action.type!=='pick'||!Number.isInteger(action.index)||action.index<0||action.index>=game.board.length)return game;
 const i=action.index;let board;
 if(game.kind==='puzzle'){const empty=game.board.indexOf(0);if(!neighbors(empty,size).includes(i))return game;board=[...game.board];[board[empty],board[i]]=[board[i],board[empty]];}
 else board=toggle(game.board,i);
 const moves=game.moves+1,solved=game.kind==='puzzle'?board.every((v,i)=>v===(i+1)%board.length):!board.some(Boolean);
 return {...game,board,moves,score:solved?Math.max(100,1000-moves*10):0,...(solved?{status:'finished',grade:moves<=12?'S':moves<=35?'A':'B'}:{})};
}
