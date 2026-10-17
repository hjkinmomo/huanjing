// Legal whole-piece moves; randomized openings are reached by reversible legal walks.
export const KLOTSKI_OPENING=Object.freeze([2,1,1,3,2,1,1,3,4,6,6,5,4,7,8,5,9,0,0,10]);
export const KLOTSKI_NEAR_EXIT=Object.freeze([2,6,6,3,2,7,8,3,4,1,1,5,4,1,1,5,9,0,0,10]);
export const KLOTSKI_NAMES=Object.freeze({1:'归舟',2:'松',3:'竹',4:'梅',5:'兰',6:'长桥',7:'云',8:'月',9:'星',10:'露'});
export function klotskiMove(board,piece,direction){
 const delta={up:-4,down:4,left:-1,right:1}[direction];
 if(!Array.isArray(board)||board.length!==20||!Number.isInteger(piece)||piece<1||piece>10||!delta)return null;
 const cells=board.flatMap((v,i)=>v===piece?[i]:[]);if(!cells.length)return null;
 const targets=cells.map(i=>i+delta);
 if(targets.some((t,n)=>t<0||t>=20||Math.abs(t%4-cells[n]%4)+Math.abs(Math.floor(t/4)-Math.floor(cells[n]/4))!==1||board[t]!==0&&board[t]!==piece))return null;
 const next=[...board];cells.forEach(i=>next[i]=0);targets.forEach(i=>next[i]=piece);return next;
}
export function klotskiSolved(board){return [13,14,17,18].every(i=>board[i]===1);}
export function klotskiAction(game,action){
 if(action.type!=='slide')return game;
 const board=klotskiMove(game.board,action.piece,action.direction);if(!board)return game;
 const moves=game.moves+1,solved=klotskiSolved(board);
 return {...game,board,moves,score:solved?Math.max(100,1500-moves*5):0,...(solved?{status:'finished',grade:moves<=100?'S':moves<=180?'A':'B'}:{})};
}

export function klotskiOpening(random=Math.random,difficulty='calm'){
 const mirror=board=>Array.from({length:20},(_,i)=>board[Math.floor(i/4)*4+3-i%4]);
 const entries=difficulty==='challenge'?[['横渡木桥',KLOTSKI_OPENING],['临岸回舟',KLOTSKI_NEAR_EXIT],['镜岸木桥',mirror(KLOTSKI_OPENING)]]:[['临岸回舟',KLOTSKI_NEAR_EXIT],['镜岸回舟',mirror(KLOTSKI_NEAR_EXIT)]];
 const [name,start]=entries[Math.min(entries.length-1,Math.floor(random()*entries.length))];let board=[...start],last='',trail=[];const visited=new Set([board.join(',')]);
 for(let step=0;step<(difficulty==='challenge'?100:18);step++){
  let choices=[];for(let piece=1;piece<=10;piece++)for(const direction of ['left','right','up','down']){const next=klotskiMove(board,piece,direction);if(next&&!klotskiSolved(next)&&next.join(',')!==last)choices.push({piece,direction,next});}
  if(!choices.length)break;const fresh=choices.filter(c=>!visited.has(c.next.join(',')));if(fresh.length)choices=fresh;
  const chosen=choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];last=board.join(',');board=chosen.next;visited.add(board.join(','));trail.push({piece:chosen.piece,direction:chosen.direction});
 }
 return {name,board,origin:[...start],trail};
}
