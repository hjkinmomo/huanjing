// Explanations and hints do not mutate game state or grant rewards.
export const gameGuide={
 klotski:{goal:'让最大的归舟木块抵达下方中央出口',controls:'先选木块，再用方向按钮或方向键移动；每次移动一格。',score:'完成得分 max(100,1500 − 步数 × 5)。100 步内 S，180 步内 A。',tip:'两格空位是周转空间。先试一试临近出口的入门局，再挑战经典布局。'},
 memory:{goal:'找出全部相同图案',controls:'点击翻牌；两张不相同时稍后盖回，可手动继续。',score:'得分按配对效率计算；失配不超过 2 次为 S，不超过 6 次为 A。放松 8 对，挑战 12 对。',tip:'先记住位置，不必急着猜。一次只确认一对；遇见第二张时再回去找它。'},
 tiles:{goal:'合成 2048，或至少移动 5 步后主动结算',controls:'方向键、WASD 或屏幕方向按钮；无效移动不计步。',score:'合并产生的数字计入得分。合成 2048 为 S；主动结算时最大数字达到 512 为 A。',tip:'尽量让最大数字留在一个角落，先保持排列方向，再考虑合并。'},
 puzzle:{goal:'拼完整幅画，空位留在右下角',controls:'拖动或点击空位邻近拼块；方向键 / WASD 移动的是空位。可显示小编号辅助定位。',score:'完成得分为 max(100, 1000 − 步数 × 10)。12 步内 S，35 步内 A。',tip:'先安置第一行，再处理余下区域；不要为了眼前的一格破坏已经排好的行。'},
 lights:{goal:'让九盏灯全部熄灭',controls:'点击会切换本格和上下左右，不切换斜对角。',score:'完成得分为 max(100, 1000 − 步数 × 10)。12 步内 S，35 步内 A。',tip:'同一位置按两次会抵消。“给我一个提示”只提示下一步，不替你操作。'}
};
export function lightHint(board){
 if(!Array.isArray(board)||board.length!==9||board.some(v=>v!==0&&v!==1))throw Error('灯阵格式异常。');
 let best=null;
 for(let mask=0;mask<512;mask++){
  const result=[...board],picks=[];
  for(let i=0;i<9;i++)if(mask&(1<<i)){picks.push(i);for(let j=0;j<9;j++)if(i===j||Math.abs(Math.floor(i/3)-Math.floor(j/3))+Math.abs(i%3-j%3)===1)result[j]=1-result[j];}
  if(!result.some(Boolean)&&(!best||picks.length<best.length))best=picks;
 }
 return best?.length?{index:best[0],remaining:best.length}:null;
}
export function reviewGame(game){
 if(['flight','snake'].includes(game.kind))return [`${game.score} 分`,game.kind==='flight'?'星港守卫 · 击退舰队':'青庭贪吃蛇 · 采果增长'];
 if(game.kind==='memory'){const pairs=game.deck?.length/2||0;return [`配对 ${pairs} 对`,`失配 ${game.mismatches||0} 次`,`效率 ${game.moves?Math.round(pairs/game.moves*100):0}%`];}
 if(game.kind==='tiles')return [`最大数字 ${game.maxTile||0}`,`合并得分 ${game.score||0}`];
 return [`完成用步 ${game.moves}`,game.moves<=12?'12 步内完成':game.moves<=35?'35 步内完成':'坚持完成这一局'];
}
export function liveMetric(game){
 if(game.kind==='memory')return {label:'已配对',value:game.matched.length/2,max:game.deck.length/2};
 if(game.kind==='puzzle')return {label:'已在目标位置的方块',value:game.board.filter((v,i)=>v!==0&&v===i+1).length,max:game.board.length-1};
 if(game.kind==='klotski')return {label:'归舟向出口前进',value:Math.floor(game.board.indexOf(1)/4),max:3};
 if(game.kind==='lights')return {label:'已熄灭的灯',value:game.board.filter(v=>v===0).length,max:9};
 return {label:'最大数字',value:Math.max(...game.board),max:2048};
}
export function modeDescription(kind,difficulty){
 const hard=difficulty==='challenge';
 const description={klotski:hard?'多种经典局面，合法移动随机展开':'临岸或镜岸局面，合法移动随机展开',memory:hard?'12 对图案，练习更长的记忆':'8 对图案，慢慢记住位置',puzzle:hard?'深度打乱，至少需要 10 步':'九格最多 6 步可解；十六和二十五格增加打乱深度',lights:hard?'最少需要 5–7 次点击':'最少需要 1–3 次点击',tiles:hard?'新方块为 4 的概率是 25%':'新方块为 4 的概率是 10%'}[kind];
 return `${hard?'挑战':'放松'} · ${description}${kind==='memory'?'':hard?' · 不提供撤回':' · 可撤回最近 20 步'}`;
}
export function personalBest(records,game){
 const others=records.filter(r=>r.id!==game.id&&r.roleId===game.roleId&&r.kind===game.kind&&(game.kind!=='puzzle'||(r.size||3)===(game.size||3))&&(r.difficulty||'calm')===(game.difficulty||'calm'));
 const previous=others.reduce((best,r)=>!best||r.score>best.score||r.score===best.score&&r.moves<best.moves?r:best,null);
 return {previous,label:!previous?'近期首次完成这款模式':game.score>previous.score?'刷新近期最佳':game.score===previous.score&&game.moves<previous.moves?'同分，用步更少':game.score===previous.score?'追平近期最佳':`本次 ${game.score} 分 · 近期最佳 ${previous.score} 分`};
}
