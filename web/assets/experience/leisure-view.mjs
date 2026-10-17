import {products,games,balance,productLock,buyProduct,playTransaction,rewardDay,slideWithTrace} from './leisure-core.mjs?v=1';
import {giftPreview,giftReason} from './gifts.mjs';
import {createLeisureMotion,capturePieces,gameMotionState} from './leisure-motion.mjs';
import {gameGuide,lightHint,reviewGame,liveMetric,modeDescription,personalBest} from './leisure-guidance.mjs';
import {mountPuzzleDrag,isPuzzleNeighbor} from './puzzle-drag.mjs';
import {PUZZLE_SCENES,puzzleScene,tilePosition,MEMORY_BACK} from './play-art.mjs';
import {KLOTSKI_NAMES,klotskiMove} from './klotski.mjs';
import {mountArcadeGame} from './arcade-view.mjs';
import {ARCADE_GAMES} from './arcade-core.mjs';
import {mountPiano} from './piano-view.mjs';
import {roleMode} from './persona-modes.mjs';
const shared=globalThis.HermesSharedState;
const symbols=['✿','☾','♧','♡','◇','♫','☀','❖','♠','✦','❀','☕'];
const memoryFaces=['violet_letter','rabbit_cookie','tea_tin','bow_pin','coffee','pressed_flower','strawberry_cake','blue_ink','silk_bookmark','amber_candle','postcard','star_ticket'].map(id=>products.find(p=>p.id===id));
const gameArt=Object.freeze({memory:'memory',tiles:'tiles',puzzle:'puzzle',lights:'lights',piano:'expression-art-v1/piano-entry',klotski:'expression-art-v1/klotski-entry'});
function illustration(kind,fallback){const box=el('span',undefined,'game-pick-mark'),image=el('img');image.src=new URL(ARCADE_GAMES[kind]?`./media/arcade-v2/${kind}.png`:`./media/${gameArt[kind]}.png`,import.meta.url).href;image.alt='';image.loading='lazy';image.onerror=()=>box.replaceChildren(document.createTextNode(fallback));box.append(image);return box;}
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
export function mountLeisure({shop,arcade,getRole,getRoles,getWorld=()=>null,onChange,onDiscuss,onSubmit,onEncourage,onExitGame,storage=localStorage,locks=navigator.locks}){
  let gameOpen=false,gameView=0,selected=null,busy=false,filter='all',query='',difficulty='calm',timer=null,currentPage='',snapshot={},autoPaused=false,previousBoard=null;
  const motion=createLeisureMotion();let previousGame=null,pendingTileTrace=null;
  const status=shop.querySelector('[data-shop-status]'),playStatus=arcade.querySelector('[data-play-status]');
  const dialog=shop.querySelector('[data-product-detail]');let shopScroll=0;const showBuy=()=>{shopScroll=shop.closest('.phone-shop-slot')?.scrollTop||0;shop.dataset.detail='true';dialog.hidden=false;shop.closest('.phone-shop-slot')?.scrollTo(0,0);};const closeBuy=()=>{if(busy)return;dialog.hidden=true;delete shop.dataset.detail;shop.closest('.phone-shop-slot')?.scrollTo(0,shopScroll);};dialog.querySelector('[data-buy-cancel]').onclick=closeBuy;const shippingLabel=el('label','收货方式'),shippingSelect=el('select');shippingSelect.setAttribute('aria-label','礼物收货方式');for(const [id,text] of [['0','即刻取货，放入背包'],['30','快递配送，30分钟后到'],['60','快递配送，1小时后到']]){const o=el('option',text);o.value=id;shippingSelect.append(o);}shippingLabel.append(shippingSelect);dialog.querySelector('[data-buy-count]').closest('label').after(shippingLabel);
  const read=()=>{snapshot=shared.read(storage).state;return snapshot;};
  function feedback(node,message){node.textContent=message;node.hidden=!message;}
  function money(){const coins=balance(snapshot);shop.querySelector('[data-coins]').textContent=`${coins} 金币`;arcade.querySelector('[data-coins]').textContent=`${coins} 金币`;}
  function art(gift){const box=el('div',undefined,'shop-art'),img=el('img');img.src=new URL(gift.image,new URL('../../experience.html',import.meta.url)).href;img.alt='';img.loading='lazy';img.onerror=()=>{img.remove();box.append(el('span','礼'));};box.append(img);return box;}
  function renderShop(){
    try{read();money();}catch(e){feedback(status,e.message);return;}
    const role=getRole(),host=shop.querySelector('[data-products]');host.replaceChildren();shop.querySelector('[data-shop-role]').textContent=`给 ${role.name} 挑一点心意`;
    const ids=getRoles().map(r=>r.id);let parcels=shop.querySelector('.shop-parcels');if(!parcels){parcels=el('details',undefined,'shop-parcels');host.before(parcels);}parcels.replaceChildren(el('summary','我的快递'));const values=Object.values(snapshot.shoppingParcels||{}).filter(p=>p.mode===roleMode(role.id)).slice(-20).reverse();parcels.hidden=!values.length;for(const p of values)parcels.append(el('p',p.giftName+' ×'+p.quantity+' · '+(p.status==='delivered'?'已送达，放入背包':'配送中 · '+new Date(Date.parse(p.dueUtc)+480*60000).toISOString().slice(11,16)+' 到达')));
    const list=products.filter(g=>g.rarity!=='role'&&g.rarity!=='stage'||g.favoriteRoles?.some(id=>ids.includes(id))).filter(g=>filter!=='favorite'||g.favoriteRoles?.includes(role.id)).filter(g=>filter!=='affordable'||g.price<=balance(snapshot)).filter(g=>`${g.name} ${g.description||''} ${g.rarityLabel||''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(b.favoriteRoles?.includes(role.id))-Number(a.favoriteRoles?.includes(role.id))||a.price-b.price);
    shop.querySelector('[data-shop-empty]').hidden=!!list.length;
    for(const gift of list){
      const card=el('article',undefined,'shop-product'),lock=productLock(gift,snapshot),owned=snapshot.inventory?.[gift.id]||0;
      card.dataset.giftId=gift.id;
      const favorite=gift.favoriteRoles?.includes(role.id);card.dataset.favorite=String(!!favorite);card.dataset.rarity=gift.rarity;
      const ribbon=el('div',undefined,'shop-product-label');ribbon.append(el('span',favorite?`${role.name}偏爱`:gift.rarityLabel));if(owned)ribbon.append(el('small',`已拥有 ${owned}`,'shop-owned'));card.append(ribbon);
      const display=button('',()=>openBuy(gift),'shop-display');display.setAttribute('aria-label',`查看${gift.name}`);display.append(art(gift));card.append(display);
      card.append(el('h2',gift.name),el('p',gift.description||gift.reactionCue||'一件可以收进背包的小礼物。','shop-story'));
      const preview=giftPreview(snapshot,gift,role.id);
      card.append(el('p',lock||`赠送时 ${preview.accepted?'一份小心意':giftReason(preview.reason)}`,'shop-effect'));
      const buy=button('',()=>openBuy(gift),'shop-buy');buy.setAttribute('aria-label',lock||`${gift.price} 金币 · 选购${gift.name}`);if(lock){buy.textContent=lock;}else{buy.append(el('span','◈','price-coin'),el('strong',String(gift.price)),el('small','金币'),el('span','选购 →','shop-buy-label'));}buy.disabled=!!lock||busy;display.disabled=busy;card.append(buy);host.append(card);
    }
  }
  function openBuy(gift){
    if(busy)return;read();selected={gift,id:crypto.randomUUID()};
    dialog.querySelector('[data-buy-name]').textContent=gift.name;
    const detail=dialog.querySelector('[data-buy-description]')||el('p');detail.dataset.buyDescription='';detail.textContent=gift.description||gift.reactionCue||'';detail.hidden=!detail.textContent;dialog.querySelector('[data-buy-name]').after(detail);
    dialog.querySelector('[data-buy-art]').replaceChildren(art(gift));
    dialog.querySelector('[data-buy-count]').value='1';shippingSelect.value='0';shippingSelect.disabled=!getWorld()?.worldUtc;feedback(dialog.querySelector('[data-buy-error]'),'');updateTotal();showBuy();
    const effect=dialog.querySelector('[data-buy-effect]');if(effect){const role=getRole(),preview=giftPreview(snapshot,gift,role.id);effect.textContent=`若现在送给${role.name}：${preview.accepted?'一份小心意':giftReason(preview.reason)}`;}
  }
  function updateTotal(){if(!selected)return;const q=Number(dialog.querySelector('[data-buy-count]').value),cost=q*selected.gift.price,shortfall=Math.max(0,cost-balance(snapshot));dialog.querySelector('[data-buy-total]').textContent=`合计 ${cost} 金币${shortfall?` · 还差 ${shortfall} 金币`:shippingSelect.value==='0'?' · 购买后放入背包':' · 快递到达后放入背包'}`;dialog.querySelector('[data-buy-confirm]').disabled=busy||!!shortfall||!Number.isInteger(q)||q<1||q>5;} 
  dialog.querySelector('[data-buy-count]').onchange=updateTotal;shippingSelect.onchange=()=>{if(selected)delete selected.shipping;updateTotal();};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.querySelector('[data-buy-confirm]').onclick=async()=>{
    if(busy||!selected)return;busy=true;const b=dialog.querySelector('[data-buy-confirm]');b.disabled=true;
    b.textContent='正在收好…';dialog.setAttribute('aria-busy','true');
    dialog.querySelector('[data-buy-cancel]').disabled=true;dialog.querySelector('[data-buy-count]').disabled=true;
    try{if(shippingSelect.value!=='0'&&!selected.shipping){const world=getWorld();if(!world?.worldUtc)throw Error('先读取世界时间，再安排配送。');selected.shipping={mode:roleMode(getRole().id),worldUtc:world.worldUtc,dueUtc:new Date(Date.parse(world.worldUtc)+Number(shippingSelect.value)*60000).toISOString()};}const result=await buyProduct(storage,locks,{shipping:selected.shipping,giftId:selected.gift.id,quantity:Number(dialog.querySelector('[data-buy-count]').value),operationId:selected.id,at:new Date().toISOString()});if(currentPage==='shop'&&!result.duplicate)motion.purchase(dialog.querySelector('[data-buy-art] img'),shop.querySelector('[data-go="bag"]'));busy=false;closeBuy();busy=true;feedback(status,`已购 ${result.receipt.giftName} ×${result.receipt.quantity} · ${result.warning||(result.receipt.parcelStatus==='shipping'?'正在配送，到达后放入背包':'已放入背包')}`);onChange(result.state);if(!result.duplicate)window.dispatchEvent(new CustomEvent('huanjing:notification',{detail:{kind:'shopping'}}));}
    catch(e){feedback(dialog.querySelector('[data-buy-error]'),e.message);}
    finally{busy=false;b.disabled=false;b.textContent='确认购买';dialog.removeAttribute('aria-busy');dialog.querySelector('[data-buy-cancel]').disabled=false;dialog.querySelector('[data-buy-count]').disabled=false;renderShop();if(!dialog.hidden)updateTotal();}
  };
  shop.querySelector('[data-shop-query]').oninput=e=>{query=e.target.value.trim();renderShop();};
  shop.querySelectorAll('[data-shop-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.shopFilter;shop.querySelectorAll('[data-shop-filter]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));renderShop();});
  const abandonDialog=arcade.querySelector('dialog');
  const gameArea=arcade.querySelector('[data-game-area]');
  const puzzleDrag=mountPuzzleDrag({host:gameArea,getGame:()=>snapshot.leisure?.active,isBusy:()=>busy||currentPage!=='games',onPick:index=>run('action',{type:'pick',index})});
  let puzzleNumbers=false,selectedScene='bunny',selectedSize=3,setupOpen=false,selectedPiece=1;
  const setup=el('section',undefined,'puzzle-setup');setup.hidden=true;gameArea.before(setup);
  const sceneImage=active=>new URL(puzzleScene(active.roleId,active.sceneId).image,import.meta.url).href;
  const pianoHost=el('div');arcade.querySelector('.arcade-layout').before(pianoHost);
  const classicHost=el('div');arcade.querySelector('.arcade-layout').before(classicHost);
  const classic=mountArcadeGame(classicHost,{onCheckpoint:(proof,id)=>run('action',{type:'arcade-checkpoint',proof},null,{throwErrors:true,expectedId:id}),onFinish:(proof,id)=>run('action',{type:'arcade-result',proof},null,{throwErrors:true,expectedId:id}),onBack(){classic.leave();if(onExitGame?.())return;gameOpen=false;renderGames();},onReplay:kind=>run('start',null,{kind,difficulty,role:{id:getRole().id,name:getRole().name},id:crypto.randomUUID(),at:new Date().toISOString()}),onShare:r=>onSubmit?.(r)});
  const piano=mountPiano({host:pianoHost,getRole,storage,onDiscuss:text=>onDiscuss(text,getRole().id),onBack(){if(onExitGame?.())return;arcade.querySelector('.leisure-top').hidden=false;arcade.querySelector('.arcade-layout').hidden=false;arcade.querySelector('.leisure-heading').hidden=false;renderGames();picks.querySelector('[data-open-piano]')?.focus({preventScroll:true});}});
  abandonDialog.querySelector('[data-abandon-confirm]').onclick=()=>run('abandon');
  function renderGames(){
    puzzleDrag.cancel();clearTimeout(timer);timer=null;
    try{read();money();}catch(e){feedback(playStatus,e.message);return;}
    const active=gameOpen?snapshot.leisure?.active:null,host=arcade.querySelector('[data-game-area]'),chooser=arcade.querySelector('[data-game-chooser]');host.dataset.gameKind=active?.kind||'';if(active&&ARCADE_GAMES[active.kind]&&['playing','finished'].includes(active.status)){piano.leave();arcade.querySelector('.arcade-layout').hidden=true;arcade.querySelector('.leisure-top').hidden=true;arcade.querySelector('.leisure-heading').hidden=true;classic.open(active);return;}classic.leave();arcade.querySelector('.arcade-layout').hidden=false;arcade.querySelector('.leisure-top').hidden=false;arcade.querySelector('.leisure-heading').hidden=false;const before=capturePieces(host),nextGame=gameMotionState(active),transition={entered:!!active&&active.status==='playing'&&previousGame?.id!==active.id,finished:active?.status==='finished'&&(previousGame?.id!==active.id||previousGame?.status!=='finished'),changed:previousGame?.id===nextGame?.id&&previousGame?.signature!==nextGame?.signature};previousGame=nextGame;motion.stop();host.dataset.motionManaged='true';host.replaceChildren();
    const replyPanel=arcade.querySelector('[data-game-response]');if(replyPanel&&replyPanel.dataset.gameId!==active?.id){replyPanel.textContent='';replyPanel.hidden=true;}
    transition.tileTrace=pendingTileTrace&&pendingTileTrace.id===active?.id?pendingTileTrace.trace:null;pendingTileTrace=null;
    setup.hidden=!setupOpen;host.hidden=setupOpen;chooser.hidden=setupOpen||!!active&&['playing','finished'].includes(active.status);
    const partner=active?.status==='playing'||active?.status==='finished'?active.roleName:getRole().name;
    arcade.querySelector('[data-play-role]').textContent=active?.status==='playing'?`这一局 · ${partner}`:`与 ${getRole().name}，换个节奏`;
    const companion=arcade.querySelector('[data-game-companion]');if(companion){companion.textContent=`${partner} · 本局分享对象`;const avatar=arcade.querySelector('[data-game-avatar]'),role=getRoles().find(r=>r.id===(active?.roleId||getRole().id));if(role?.avatar){avatar.src=new URL(role.avatar,new URL('../../experience.html',import.meta.url)).href;avatar.hidden=false;avatar.onerror=()=>avatar.hidden=true;}else avatar.hidden=true;}
    const records=snapshot.leisure?.records||[],history=arcade.querySelector('[data-play-records]');history.replaceChildren();
    for(const r of records.slice(0,5)){const item=el('li');item.append(el('span',`${games[r.kind]?.name||'游戏'} · ${r.roleName}`),el('strong',`${r.score} 分`),el('small',`+${r.reward} 金币`));if(onSubmit){const share=button('分享成绩',()=>onSubmit(r),'game-record-share');share.setAttribute('aria-label',`分享${games[r.kind]?.name||'游戏'}成绩给${r.roleName}`);item.append(share);}history.append(item);}
    arcade.querySelector('[data-record-empty]').hidden=!!records.length;
    const earned=snapshot.leisure?.daily?.[rewardDay(new Date())]||0;arcade.querySelector('[data-reward-limit]').textContent=`今日游戏奖励 ${earned}/60 金币`;
    const dailyProgress=arcade.querySelector('[data-reward-progress]');if(dailyProgress)dailyProgress.value=Math.min(60,earned);
    arcade.querySelector('.game-home-resume')?.remove();
    if(!gameOpen){const saved=snapshot.leisure?.active;if(saved&&['playing','finished'].includes(saved.status)){const resume=el('section',undefined,'game-home-resume');resume.append(el('strong',saved.status==='playing'?`留在这里的一局 · ${games[saved.kind]?.name}`:'上一局已完成'),el('p',`${saved.roleName} · ${saved.moves} 步 · ${saved.score} 分`),button(saved.status==='playing'?'继续这一局':'查看结算',()=>{gameOpen=true;renderGames();},'primary'));if(saved.status==='playing')resume.append(button('放弃这一局',()=>abandonDialog.showModal()));chooser.prepend(resume);}}
    if(setupOpen){host.hidden=true;return;}
    if(!active||active.status==='abandoned'){host.hidden=true;return;}
    const guide=gameGuide[active.kind],rules=el('details',undefined,'game-rules');rules.append(el('summary',`${guide.goal} · 规则与评分`));for(const text of [guide.controls,guide.score,guide.tip,'每局奖励只结算一次，今日游戏奖励上限 60 金币。提示不会自动走棋，也不额外扣分。'])rules.append(el('p',text));host.append(rules);
    const heading=el('div',undefined,'game-scorebar'),identity=el('div');identity.append(el('small',active.difficulty==='challenge'?'挑战模式':'放松模式'),el('h2',games[active.kind].name));const hud=el('div',undefined,'game-hud');for(const [label,value] of [['得分',active.score],['步数',active.moves]]){const stat=el('div');stat.append(el('small',label),el('strong',String(value)));hud.append(stat);}heading.append(identity,hud);host.append(heading);
    rules.append(el('p',modeDescription(active.kind,active.difficulty),'game-mode-note'));
    rules.append(el('p','暂停会保留棋盘。放松模式的拼图和数字棋盘可撤回最近 20 步，累计操作步数仍保留；翻牌和挑战模式不提供撤回。'));
    if(active.paused&&active.status==='playing'){
      const paused=el('section',undefined,'game-paused');paused.setAttribute('aria-label','游戏已暂停');
      paused.append(illustration(active.kind,games[active.kind].mark),el('h3','这一局，先留在这里。'),el('p',`${active.roleName} · 已保留棋盘与 ${active.moves} 步进度`),button('继续这一局',()=>run('action',{type:'resume'}),'primary'),button('放弃这一局',()=>abandonDialog.showModal()));host.append(paused);return;
    }
    if(active.status==='finished'){
      const result=el('section',undefined,'game-result');if(active.kind==='puzzle'){const picture=el('img',undefined,'puzzle-finished-art');picture.src=sceneImage(active);picture.alt=`已拼好的${puzzleScene(active.roleId,active.sceneId).name}`;result.append(picture);}result.append(el('small','本局已结算','result-eyebrow'),el('div',active.grade,'game-grade'),el('h3',active.kind==='memory'?'所有心意，都找到另一半。':active.kind==='lights'?'灯都熄了，留一点安静。':active.kind==='puzzle'?'这幅画，终于拼完整了。':active.kind==='klotski'?'归舟过桥，慢慢抵达。':active.maxTile>=2048?'合成 2048！':'这一局，先停在这里。'));const reward=el('div',undefined,'game-reward');reward.append(el('span','◈'),el('strong',`+${active.receipt?.reward||0}`),el('small','金币 · 已收好'));result.append(reward,el('p',`${active.moves} 步 · ${active.score} 分`));
      const review=el('div',undefined,'game-review');reviewGame(active).forEach(t=>review.append(el('span',t)));result.append(review);
      result.append(el('p',personalBest(records,active).label,'game-best'),el('small','与同角色、同游戏、同模式比较 · 最近 50 局'));
      if(active.undos)review.append(el('span',`撤回 ${active.undos} 次 · 步数未减少`));
      const text=`刚刚玩了${games[active.kind].name}，${active.moves}步拿到${active.score}分。想和你聊聊这一局。`;
      if(onSubmit)result.append(button(`通过微聊发给${active.roleName}`,()=>onSubmit(active.receipt),'primary'));
      result.append(button('留作聊天草稿',()=>onDiscuss(text,active.roleId)));
      const replay=button('再来一局',()=>{if(busy)return;run('start',null,{kind:active.kind,difficulty:active.difficulty,sceneId:active.sceneId,size:active.size||Math.sqrt(active.board?.length||9),role:{id:active.roleId,name:active.roleName},id:crypto.randomUUID(),at:new Date().toISOString()});},'primary game-replay');result.append(replay);
      result.append(button('再选一款',()=>{if(onExitGame?.())return;gameOpen=false;setupOpen=false;renderGames();chooser.querySelector('button')?.focus({preventScroll:true});}));
      const next=el('a','去走一段，让这一局慢慢落下来 →','game-story-link');next.href='#/life';result.append(next);host.append(result);motion.game(host,before,transition);return;
    }
    const metric=liveMetric(active),meter=el('label',`${metric.label} ${metric.value}/${metric.max}`,'game-progress');const progress=el('progress');progress.max=metric.max;progress.value=metric.value;progress.setAttribute('aria-label',metric.label);meter.append(progress);host.append(meter);
    if(active.kind==='memory'){
      const grid=el('div',undefined,'memory-board');grid.dataset.difficulty=active.difficulty;
      active.deck.forEach((value,index)=>{const visible=active.matched.includes(index)||active.open.includes(index),face=memoryFaces[value],card=button(visible?symbols[value]:'',()=>run('action',{type:'flip',index}),'memory-card');if(visible&&face){const img=el('img',undefined,'memory-face');img.src=new URL(face.image,new URL('../../experience.html',import.meta.url)).href;img.alt='';img.onerror=()=>card.replaceChildren(document.createTextNode(symbols[value]));card.replaceChildren(img);}if(!visible){const back=el('img',undefined,'memory-back-art');back.src=new URL(MEMORY_BACK,import.meta.url).href;back.alt='';back.draggable=false;back.onerror=()=>{back.remove();card.append(el('span','✧','memory-back-fallback'));};card.replaceChildren(back);}card.dataset.piece=`memory:${index}`;card.dataset.matched=String(active.matched.includes(index));card.dataset.open=String(visible);card.dataset.cell=String(index);card.setAttribute('aria-label',visible?`第${index+1}张，${face?.name||symbols[value]}${active.matched.includes(index)?'，已配对':''}`:`翻开第${index+1}张`);card.disabled=busy||active.matched.includes(index)||active.open.length===2;grid.append(card);});host.append(grid);
      host.append(el('p',`已找到 ${active.matched.length/2}/${active.deck.length/2} 对 · 失配 ${active.mismatches} 次`,'game-hint'));
      if(active.open.length===2){host.append(button('翻下一组',()=>{autoPaused=false;run('action',{type:'close'});},'game-next-pair'));if(currentPage==='games'&&!autoPaused)timer=setTimeout(()=>run('action',{type:'close'}),1100);}
    }else if(active.kind==='klotski'){
      const grid=el('div',undefined,'klotski-board');grid.setAttribute('aria-label','华容道棋盘');
      for(const id of new Set(active.board.filter(Boolean))){const cells=active.board.flatMap((v,i)=>v===id?[i]:[]),first=Math.min(...cells),cols=cells.map(i=>i%4),rows=cells.map(i=>Math.floor(i/4));const b=button(KLOTSKI_NAMES[id],()=>{selectedPiece=id;renderGames();},'klotski-piece');b.dataset.pieceId=String(id);b.dataset.piece=`wood:${id}`;b.setAttribute('aria-pressed',String(selectedPiece===id));b.setAttribute('aria-label',`选择${KLOTSKI_NAMES[id]}木块`);b.style.gridColumn=`${first%4+1} / span ${Math.max(...cols)-Math.min(...cols)+1}`;b.style.gridRow=`${Math.floor(first/4)+1} / span ${Math.max(...rows)-Math.min(...rows)+1}`;grid.append(b);}
      host.append(grid,el('p','出口 · 下方中央','klotski-exit'));const controls=el('div',undefined,'game-directions');
      for(const [d,t] of [['up','↑'],['left','←'],['down','↓'],['right','→']]){const b=button(t,()=>run('action',{type:'slide',piece:selectedPiece,direction:d}));b.setAttribute('aria-label',`${KLOTSKI_NAMES[selectedPiece]}向${{up:'上',down:'下',left:'左',right:'右'}[d]}移动`);b.disabled=busy||!klotskiMove(active.board,selectedPiece,d);controls.append(b);}host.append(el('p',`已选：${KLOTSKI_NAMES[selectedPiece]} · 用方向按钮或方向键移动`,'game-hint'),controls);
    }else if(active.kind==='puzzle'||active.kind==='lights'){
      const size=Math.sqrt(active.board.length),grid=el('div',undefined,`puzzle-board ${active.kind}-board`);grid.style.setProperty('--puzzle-size',size);grid.dataset.size=String(size);grid.setAttribute('aria-label',games[active.kind].name+'棋盘');
      active.board.forEach((v,i)=>{const b=button(active.kind==='puzzle'?'':v?'●':'○',()=>run('action',{type:'pick',index:i}),'puzzle-cell');b.dataset.cell=String(i);b.dataset.lit=String(v===1);b.dataset.changed=String(previousBoard?.id===active.id&&previousBoard.board[i]!==v);b.disabled=busy||(active.kind==='puzzle'&&v===0);
       if(active.kind==='puzzle'){b.dataset.tile=String(v);b.dataset.movable=String(isPuzzleNeighbor(active.board,i));const position=tilePosition(v,size);if(position){b.style.backgroundImage=`url("${sceneImage(active)}")`;b.style.backgroundSize=`${size*100}% ${size*100}%`;b.style.backgroundPosition=`${position.x}% ${position.y}%`;const badge=el('span',String(v),'puzzle-number');badge.setAttribute('aria-hidden','true');b.append(badge);}else{const mark=el('span','✦','puzzle-empty-mark');mark.setAttribute('aria-hidden','true');b.append(mark);}b.setAttribute('aria-label',v?`第${v}块图画，目标第${Math.floor((v-1)/size)+1}行第${(v-1)%size+1}列${isPuzzleNeighbor(active.board,i)?'，可移向空位':''}`:'空位');}
       else b.setAttribute('aria-label',`第 ${i+1} 盏灯，${v?'亮':'暗'}`);grid.append(b);
      });previousBoard={id:active.id,board:[...active.board]};
      if(active.kind==='puzzle'){
       grid.dataset.numbers=String(puzzleNumbers);const layout=el('div',undefined,'picture-puzzle-layout'),reference=el('aside',undefined,'puzzle-reference'),picture=el('img');picture.src=sceneImage(active);picture.alt=`拼图参考画面：${puzzleScene(active.roleId,active.sceneId).name}`;picture.draggable=false;
       picture.onerror=()=>{grid.dataset.numbers='true';grid.dataset.artMissing='true';picture.hidden=true;};reference.append(el('span','画面参考','puzzle-reference-kicker'),picture,el('strong',puzzleScene(active.roleId,active.sceneId).name),el('p','把图画拼完整。空位最后留在右下角。'));const numberLabel=el('label',undefined,'puzzle-number-toggle'),numbers=el('input');numbers.type='checkbox';numbers.checked=puzzleNumbers;numbers.onchange=()=>{puzzleNumbers=numbers.checked;grid.dataset.numbers=String(puzzleNumbers);};numberLabel.append(numbers,document.createTextNode('显示位置编号'));reference.append(numberLabel);layout.append(grid,reference);host.append(layout,el('p','拖动空位旁的拼块 · 也可点击或用方向键 / WASD · 拖动不足距离会回到原位','game-hint'));
      }else host.append(grid,el('p','点击一盏灯会切换它与上下左右的灯 · 全部熄灭即完成','game-hint'));
    }else{
      const grid=el('div',undefined,'tiles-board');grid.setAttribute('aria-label','2048 棋盘');
      active.board.forEach((v,i)=>{const cell=el('div',v||'',`tile tile-${Math.min(v,2048)}`);cell.dataset.changed=String(!!v&&previousBoard?.id===active.id&&previousBoard.board[i]!==v);grid.append(cell);});previousBoard={id:active.id,board:[...active.board]};host.append(grid);
      const controls=el('div',undefined,'game-directions');for(const [d,t]of [['up','↑'],['left','←'],['down','↓'],['right','→']]){const b=button(t,()=>run('action',{type:'move',direction:d}));b.setAttribute('aria-label',`向${{up:'上',left:'左',down:'下',right:'右'}[d]}移动`);b.disabled=busy;controls.append(b);}host.append(controls,el('p','方向键 / WASD · 相同数字相遇时合并','game-hint'));
    }
    const actions=el('div',undefined,'game-actions');
    actions.append(button('返回游乐室',()=>{if(onExitGame?.())return;gameOpen=false;setupOpen=false;renderGames();}),button('暂停',()=>run('action',{type:'pause'})));
    if(active.kind!=='memory'&&active.difficulty!=='challenge'){const undo=button('撤回一步',()=>run('action',{type:'undo'}));undo.disabled=busy||!active.undoHistory?.length;undo.title='回退棋盘和得分，累计操作步数仍保留';actions.append(undo);}
    if(active.kind==='lights')actions.append(button('给我一个提示',()=>{try{const hint=lightHint(active.board);feedback(playStatus,hint?`可以试试第 ${hint.index+1} 盏灯；从当前棋盘出发，最少还需 ${hint.remaining} 次点击。`:'当前灯阵没有可给出的下一步。');}catch(e){feedback(playStatus,e.message);}}));
    if(active.kind==='tiles'){const finish=button('结算这一局',()=>run('action',{type:'finish'}));finish.disabled=busy||active.moves<5;actions.append(finish);}
    actions.append(button('放弃这一局',()=>abandonDialog.showModal()));host.append(actions);

    host.querySelectorAll('.puzzle-cell').forEach(n=>{n.dataset.piece=active.kind==='puzzle'?`puzzle:${n.dataset.tile}`:`lights:${n.dataset.cell}`;});host.querySelectorAll('.tile').forEach((n,i)=>n.dataset.piece=`tiles:${i}`);
    motion.game(host,before,transition);
  }
  async function run(type,action,request,options={}){
    if(busy)return;busy=true;clearTimeout(timer);const view=gameView,focused=document.activeElement?.dataset.cell;
    try{read();const source=snapshot.leisure?.active;if(options.expectedId&&source?.id!==options.expectedId)throw Error('游戏已经变化，未放弃新的进度。请重新打开游戏选择。');const trace=type==='action'&&source?.kind==='tiles'&&action?.type==='move'?slideWithTrace(source.board,action.direction):null;const result=await playTransaction(storage,locks,{type,sessionId:source?.id,action,request,at:new Date().toISOString()},()=>{const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296;});if(trace?.changed&&result.state.leisure?.active?.id===source.id&&result.state.leisure.active.moves===source.moves+1)pendingTileTrace={id:source.id,trace};feedback(playStatus,result.warning||'');onChange(result.state);if(view===gameView&&currentPage==='games')gameOpen=type!=='abandon';if(abandonDialog.open)abandonDialog.close();return result;}
    catch(e){autoPaused=true;feedback(playStatus,e.message);if(options.throwErrors)throw e;}
    finally{busy=false;if(currentPage==='games')renderGames();if(view===gameView&&currentPage==='games'){if(action?.type==='pause')arcade.querySelector('.game-paused .primary')?.focus({preventScroll:true});else if(focused!==undefined)arcade.querySelector(`[data-cell="${focused}"]`)?.focus({preventScroll:true});}}
  }
  const picks=arcade.querySelector('.game-picks');picks.replaceChildren();const categories={flight:'街机 · 星港',snake:'采果 · 生长',klotski:'木作 · 推演',memory:'观察 · 记忆',tiles:'数字 · 合并',puzzle:'排列 · 拼图',lights:'逻辑 · 解谜'};for(const [kind,game]of Object.entries(games)){const b=button('',()=>{if(kind==='puzzle'){setupOpen=true;renderGames();setup.querySelector('h2')?.focus();return;}run('start',null,{kind,difficulty,role:{id:getRole().id,name:getRole().name},id:crypto.randomUUID(),at:new Date().toISOString()});});b.dataset.startGame=kind;const text=el('span',undefined,'game-pick-copy');text.append(el('span',categories[kind],'game-category'),el('strong',game.name),el('small',game.note),el('span','开始一局 →','game-pick-action'));b.append(text,illustration(kind,game.mark));picks.append(b);}
  const setupTop=el('div',undefined,'puzzle-setup-top'),setupTitle=el('h2','拼图小憩');setupTitle.tabIndex=-1;setupTop.append(button('← 返回游乐室',()=>{if(onExitGame?.())return;setupOpen=false;renderGames();picks.querySelector('[data-start-game="puzzle"]')?.focus();}),el('span','01 / 选画与难度'));
  setup.append(setupTop,setupTitle,el('p','选一幅喜欢的画，再决定今天想挑战几格。','puzzle-setup-note'));
  const scenePicker=el('fieldset',undefined,'puzzle-scene-picker');scenePicker.append(el('legend','选择图画'));
  for(const scene of Object.values(PUZZLE_SCENES)){const label=el('label'),input=el('input'),img=el('img'),copy=el('span');input.type='radio';input.name='puzzle-scene';input.value=scene.id;input.checked=scene.id===selectedScene;input.onchange=()=>{selectedScene=scene.id;};img.src=new URL(scene.image,import.meta.url).href;img.alt='';img.loading='lazy';copy.append(el('strong',scene.name),el('small',scene.group||'角色场景'));label.append(input,img,copy);scenePicker.append(label);}setup.append(scenePicker);
  const sizes=el('fieldset',undefined,'puzzle-size-picker');sizes.append(el('legend','棋盘格数'));
  for(const size of [3,4,5]){const label=el('label'),input=el('input');input.type='radio';input.name='puzzle-size';input.value=String(size);input.checked=size===selectedSize;input.onchange=()=>selectedSize=size;label.append(input,el('strong',`${size} × ${size}`),el('small',size===3?'九格 · 轻松起步':size===4?'十六格 · 稍作思考':'二十五格 · 耐心挑战'));sizes.append(label);}setup.append(sizes);
  const modeLabel=el('label','打乱程度','game-difficulty'),mode=el('select');mode.setAttribute('aria-label','拼图打乱程度');for(const [value,text] of [['calm','放松'],['challenge','挑战']]){const o=el('option',text);o.value=value;mode.append(o);}mode.onchange=()=>{difficulty=mode.value;arcade.querySelector('[data-game-difficulty]').value=difficulty;updateModes();};modeLabel.append(mode);setup.append(modeLabel);
  setup.append(button('开始拼图 →',()=>{setupOpen=false;run('start',null,{kind:'puzzle',difficulty,size:selectedSize,sceneId:selectedScene,role:{id:getRole().id,name:getRole().name},id:crypto.randomUUID(),at:new Date().toISOString()});},'primary puzzle-scene-start'));
  const pianoEntry=button('',()=>{arcade.querySelector('.leisure-top').hidden=true;arcade.querySelector('.arcade-layout').hidden=true;arcade.querySelector('.leisure-heading').hidden=true;piano.open();});pianoEntry.dataset.openPiano='';const pianoEntryText=el('span',undefined,'game-pick-copy');pianoEntryText.append(el('span','旋律 · 演奏','game-category'),el('strong','星音琴房'),el('small','六种乐器 · 长按延音、和弦与旋律录制'),el('span','走进琴房 →','game-pick-action'));pianoEntry.append(pianoEntryText,illustration('piano','♫'));picks.append(pianoEntry);
  function updateModes(){picks.querySelectorAll('[data-start-game]').forEach(b=>{const note=b.querySelector('small'),kind=b.dataset.startGame;note.textContent=kind==='memory'?`${difficulty==='challenge'?12:8} 对图案 · 找到每一份心意的另一半`:games[kind].note;});}
  updateModes();arcade.querySelector('[data-game-difficulty]').onchange=e=>{difficulty=e.target.value;mode.value=difficulty;updateModes();};
const keyboard=e=>{if(currentPage!=='games'||!gameOpen||setupOpen||piano.isOpen()||classic.isOpen()||busy||snapshot.leisure?.active?.paused||e.repeat||e.altKey||e.ctrlKey||e.metaKey||document.querySelector('dialog[open]')||e.target.closest?.('[contenteditable=true]')||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',a:'left',d:'right',w:'up',s:'down'}[e.key.length===1?e.key.toLowerCase():e.key];if(direction&&snapshot.leisure?.active?.kind==='tiles'&&snapshot.leisure.active.status==='playing'){e.preventDefault();run('action',{type:'move',direction});}else if(direction&&snapshot.leisure?.active?.kind==='klotski'&&snapshot.leisure.active.status==='playing'){e.preventDefault();run('action',{type:'slide',piece:selectedPiece,direction});}else if(direction&&snapshot.leisure?.active?.kind==='puzzle'&&snapshot.leisure.active.status==='playing'){e.preventDefault();const board=snapshot.leisure.active.board,size=Math.sqrt(board.length),empty=board.indexOf(0),index=empty+{up:-size,down:size,left:-1,right:1}[direction];if(isPuzzleNeighbor(board,index))run('action',{type:'pick',index});}};
  document.addEventListener('keydown',keyboard);
  return {backShop(){if(dialog.hidden)return false;if(!busy)closeBuy();return true;},async openGame(kind,{abandonPreviousId}={}){
    if(currentPage!=='games')throw Error('游戏页面尚未就绪。');if(busy)throw Error('上一操作尚未完成。');
    if(kind==='piano'){pianoEntry.click();return;}
    if(!games[kind])throw Error('游戏不存在。');read();const active=snapshot.leisure?.active;
    if(active?.status==='playing'){
      if(active.kind===kind){gameOpen=true;setupOpen=false;renderGames();return;}
      if(!abandonPreviousId||active.id!==abandonPreviousId)throw Error('请先确认是否放弃上一局。');
      await run('abandon',null,null,{throwErrors:true,expectedId:abandonPreviousId});
    }else if(abandonPreviousId&&active?.id!==abandonPreviousId)throw Error('旧局已经变化，请重新选择。');
    if(kind==='puzzle'){gameOpen=false;setupOpen=true;renderGames();return;}
    await run('start',null,{kind,difficulty,role:{id:getRole().id,name:getRole().name},id:crypto.randomUUID(),at:new Date().toISOString()},{throwErrors:true});
  },home(){gameView++;gameOpen=false;setupOpen=false;piano.leave();classic.leave();arcade.querySelector('.leisure-top').hidden=false;arcade.querySelector('.arcade-layout').hidden=false;arcade.querySelector('.leisure-heading').hidden=false;renderGames();},enter(page){currentPage=page;if(page==='shop'){renderShop();motion.arrive(shop.querySelectorAll('.shop-product'));}if(page==='games'){gameView++;gameOpen=false;setupOpen=false;renderGames();motion.arrive(arcade.querySelectorAll('.game-picks>button'));}},leave(){gameView++;puzzleDrag.cancel();currentPage='';piano.leave();classic.leave();arcade.querySelector('.leisure-top').hidden=false;arcade.querySelector('.arcade-layout').hidden=false;arcade.querySelector('.leisure-heading').hidden=false;motion.stop();clearTimeout(timer);timer=null;if(!dialog.hidden&&!busy)closeBuy();if(abandonDialog.open)abandonDialog.close();},refresh(){if(currentPage==='shop')renderShop();if(currentPage==='games'&&!piano.isOpen()&&!classic.isOpen())renderGames();}};
}
