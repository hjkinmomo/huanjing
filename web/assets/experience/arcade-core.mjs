// Fixed-step deterministic classics. Only input changes and checkpoints persist.
export const ARCADE_GAMES=Object.freeze({flight:{name:'星港守卫',note:'自动射击 · 移动躲避外星舰队',mark:'✦'},snake:{name:'青庭贪吃蛇',note:'转向采果 · 避开自己的尾巴',mark:'◌'}});
export function seeded(seed){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function food(state){const rand=seeded(state.seed+state.eaten*997),free=[];for(let y=0;y<16;y++)for(let x=0;x<24;x++)if(!state.body.some(p=>p[0]===x&&p[1]===y))free.push([x,y]);return free[Math.floor(rand()*free.length)]||null;}
export function arcadeInitial(kind,seed,difficulty='calm'){
 if(!ARCADE_GAMES[kind]||!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('游戏种子无效。');
 const base={kind,seed,difficulty,tick:0,score:0,status:'playing'};
 if(kind==='snake'){const s={...base,body:[[8,8],[7,8],[6,8]],direction:'right',eaten:0};s.food=food(s);return s;}
 return {...base,x:12,y:13,health:3,invincible:0,enemies:[],bullets:[],shots:[],wave:0,kills:0};
}
const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]},opposite={up:'down',down:'up',left:'right',right:'left'};
export function arcadeStep(s,input={}){
 if(s.status!=='playing')return s;
 s.tick++;
 if(s.kind==='snake'){
  const speed=Math.max(s.difficulty==='challenge'?5:7,14-Math.floor(s.eaten/3));
  if(s.tick%speed)return s;
  if(directions[input.direction]&&input.direction!==opposite[s.direction])s.direction=input.direction;
  const [dx,dy]=directions[s.direction],head=[s.body[0][0]+dx,s.body[0][1]+dy],eat=s.food&&head[0]===s.food[0]&&head[1]===s.food[1];
  if(head[0]<0||head[0]>=24||head[1]<0||head[1]>=16||s.body.slice(0,eat?s.body.length:-1).some(p=>p[0]===head[0]&&p[1]===head[1])){s.status='finished';return s;}
  s.body.unshift(head);if(!eat)s.body.pop();else{s.eaten++;s.score+=100;s.food=food(s);if(!s.food)s.status='finished';}return s;
 }
 const mx=Math.max(-1,Math.min(1,input.x||0)),my=Math.max(-1,Math.min(1,input.y||0)),norm=Math.max(1,Math.hypot(mx,my));s.x=Math.max(.6,Math.min(23.4,s.x+mx/norm*.17));s.y=Math.max(1,Math.min(15,s.y+my/norm*.17));
 if(s.invincible)s.invincible--;
 if(s.tick%12===0)s.bullets.push({x:s.x,y:s.y-.6});
 if(!s.enemies.length){s.wave++;const rand=seeded(s.seed+s.wave);for(let row=0;row<3;row++)for(let col=0;col<5;col++)s.enemies.push({x:3+col*4.5,y:1+row*1.2,base:3+col*4.5,phase:rand()*6.28,health:s.wave>=4?2:1});}
 for(const e of s.enemies){e.x=e.base+Math.sin(s.tick/90+e.phase)*1.1;e.y+=.0008*Math.min(s.wave,8);}
 const shotRate=Math.max(16,(s.difficulty==='challenge'?35:65)-s.wave*3);
 if(s.tick%shotRate===0){const rand=seeded(s.seed+s.tick),e=s.enemies[Math.floor(rand()*s.enemies.length)];if(e){const dx=s.x-e.x,dy=s.y-e.y,n=Math.max(1,Math.hypot(dx,dy));s.shots.push({x:e.x,y:e.y,dx:dx/n*.085,dy:Math.max(.025,dy/n*.085)});}}
 for(const b of s.bullets){b.y-=.27;const hit=s.enemies.find(e=>e.health>0&&Math.abs(e.x-b.x)<.7&&Math.abs(e.y-b.y)<.55);if(hit){hit.health--;b.y=-10;if(hit.health<=0){s.score+=100;s.kills++;}}}
 s.enemies=s.enemies.filter(e=>e.health>0);s.bullets=s.bullets.filter(b=>b.y>-.5);
 for(const b of s.shots){b.x+=b.dx;b.y+=b.dy;if(!s.invincible&&Math.hypot(b.x-s.x,b.y-s.y)<.5){s.health--;s.invincible=80;b.y=30;}}
 s.shots=s.shots.filter(b=>b.y<17&&b.x>-1&&b.x<25);
 if(!s.invincible&&s.enemies.some(e=>Math.hypot(e.x-s.x,e.y-s.y)<.8)){s.health--;s.invincible=80;}
 if(s.health<=0||s.enemies.some(e=>e.y>14.5)||s.tick>=10800)s.status='finished';return s;
}
export function replayArcade(kind,seed,difficulty,proof){
 if(!proof||!Number.isInteger(proof.ticks)||proof.ticks<0||proof.ticks>10800||!Array.isArray(proof.events)||proof.events.length>4000)throw Error('游戏回放无效，未结算。');
 let last=-1;for(const e of proof.events){if(!Number.isInteger(e.tick)||e.tick<0||e.tick<=last||e.tick>=proof.ticks||!e.input||typeof e.input!=='object'||(kind==='snake'?!directions[e.input.direction]:![-1,0,1].includes(e.input.x)||![-1,0,1].includes(e.input.y)))throw Error('游戏操作回放无效。');last=e.tick;}
 const s=arcadeInitial(kind,seed,difficulty);let input={},index=0;
 for(let tick=0;tick<proof.ticks;tick++){if(s.status!=='playing')throw Error('结束后的回放不能继续结算。');if(proof.events[index]?.tick===tick)input=proof.events[index++].input;arcadeStep(s,input);}
 return s;
}
export function arcadeAction(game,action){
 if(!['arcade-checkpoint','arcade-result'].includes(action.type))return game;
 const sim=replayArcade(game.kind,game.seed,game.difficulty,action.proof);
 if(action.type==='arcade-result'&&sim.status!=='finished')throw Error('这局尚未结束，未结算奖励。');
 return {...game,checkpoint:structuredClone(action.proof),moves:action.proof.events.length,score:sim.score,...(sim.status==='finished'?{status:'finished',grade:sim.score>=2000?'S':sim.score>=600?'A':'B'}:{})};
}
