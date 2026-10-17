import {roleMode} from './persona-modes.mjs';
import {phoneAvatar} from './phone-avatars.mjs';
import {momentReply,cleanMomentLabels} from './moment-reply.mjs';
import {mountIdleMoments} from './auto-moments.mjs';
import {createMomentsSync} from './moments-sync.mjs';
import {readMoments,addMoment,changeMoment} from './moments-core.mjs';
import {PUZZLE_SCENES} from './play-art.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
export function mountMoments({host,getUser=()=>({name:'你',avatar:''}),getRole,getRoles,read,mutate,generate,onDiscuss,safeMedia,api,getIdleProfile}){
 let pollTimer=null,active=false,filter='all',profileRole=null,pending=null;const replyTargets=new Map(),queue=new Map(),likedReplies=new Set(),commentOpen=new Set();
 const sync=api?createMomentsSync({api,read,mutate,onStatus:message=>{if(!pending)status.textContent=message;},onChange:()=>{if(active)renderFeed();}}):null;
 const status=el('p','','moments-status');status.setAttribute('role','status');
 const hero=el('header',undefined,'moments-hero'),heroCopy=el('div');heroCopy.append(el('span','朋友圈','moments-eyebrow'),el('h1','留住日常的小片刻'),el('p','写给自己，也让故事里的角色来回应。'));hero.append(heroCopy);host.append(hero);
 heroCopy.querySelector('h1').tabIndex=-1;hero.classList.add('social-cover');hero.style.setProperty('--social-cover',`url(${new URL(PUZZLE_SCENES.lighthouse.image,import.meta.url).href})`);const heroAvatar=el('span',undefined,'social-owner-avatar');hero.append(heroAvatar);
 function paintOwner(){const user=getUser();heroCopy.querySelector('h1').textContent=user.name||'你';heroCopy.querySelector('p').textContent='';heroAvatar.replaceChildren();const src=safeMedia(user.avatar);if(src){const img=el('img');img.src=src;img.alt='';img.onerror=()=>{heroAvatar.textContent=Array.from(user.name||'你')[0];};heroAvatar.append(img);}else heroAvatar.textContent=Array.from(user.name||'你')[0];}
 const idle=api&&getIdleProfile?mountIdleMoments({host,api,getRole,getProfile:getIdleProfile,onRefresh:()=>sync?.flush()}):null;
 const composer=el('form',undefined,'moment-composer'),input=el('textarea'),picture=el('select');input.placeholder='今天有什么想分享的？';input.maxLength=2000;input.rows=3;input.setAttribute('aria-label','动态内容');picture.setAttribute('aria-label','动态配图');
 for(const [id,name] of [['','不配图'],...Object.values(PUZZLE_SCENES).map(s=>[s.id,s.name])]){const o=el('option',name);o.value=id;picture.append(o);}
 const tools=el('div',undefined,'moment-composer-tools'),send=el('button','发布动态','primary');send.type='submit';
 const invite=button('邀请角色写一条',()=>request(null),'moment-invite'),cancel=button('停止生成',()=>{cancelRequest('已停止，没有发布未完成内容。');renderFeed();});cancel.hidden=true;
 tools.append(picture,send,invite,cancel);if(sync)tools.append(button('同步本机动态',()=>sync.flush()));composer.append(input,tools,el('small','本机服务可用时同步到本机数据库，离线内容仍保留在浏览器。角色动态属于虚构；邀请时使用当前配置的模型。'));host.append(composer,status);
 const filters=el('div',undefined,'moment-filters'),feed=el('div',undefined,'moment-feed');
 const all=button('全部',()=>{filter='all';renderFeed();}),mine=button('我的',()=>{filter='user';renderFeed();}),roleOnly=button('当前角色',()=>{filter='role';renderFeed();});const archived=button('旧角色动态',()=>{filter='archived';renderFeed();});filters.append(all,mine,roleOnly,archived,button('导出动态',()=>{try{const blob=new Blob([JSON.stringify(readMoments(read()),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='幻境-朋友圈.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status.textContent=e.message;}}));host.append(filters,feed);
 function save(fn,synchronize=true){try{mutate(fn);if(synchronize)sync?.flush();return true;}catch(e){status.textContent=e.message;return false;}}
 input.oninput=()=>save(s=>{s.moments={...readMoments(s),draft:input.value};},false);
 composer.onsubmit=e=>{e.preventDefault();const role=getRole();if(save(s=>{addMoment(s,{id:crypto.randomUUID(),roleId:role.id,text:input.value,image:picture.value,at:new Date().toISOString()});s.moments.draft='';})){input.value='';picture.value='';status.textContent='动态已保存在浏览器，正在同步本机。';renderFeed();}};
 function cancelRequest(message){
  if(!pending)return;
  const operation=pending;pending=null;
  operation.controller.abort();status.textContent=message;
 }
 function renderFeed(){
  paintOwner();const focused=document.activeElement,focusedId=focused?.closest?.('[data-moment-id]')?.dataset.momentId,selection=focusedId&&focused.tagName==='INPUT'?[focused.selectionStart,focused.selectionEnd]:null;
  feed.replaceChildren();const role=getRole();if(pending&&pending.viewerRoleId!==role.id)cancelRequest('切换角色后，已停止生成，没有发布未完成内容。');invite.textContent=pending?'正在写…':`邀请${role.name}写一条`;invite.disabled=!!pending;cancel.hidden=!pending;
  all.setAttribute('aria-pressed',String(filter==='all'));mine.setAttribute('aria-pressed',String(filter==='user'));roleOnly.setAttribute('aria-pressed',String(filter==='role'));
  let data;try{data=readMoments(read());}catch(e){status.textContent=e.message;return;}
  const existing=new Set(getRoles().map(r=>r.id));
  const orphan=p=>p.author==='role'&&!existing.has(p.roleId);
  const bankPosts=data.posts.filter(p=>roleMode(p.roleId)===roleMode(role.id));
  const count=bankPosts.filter(orphan).length;archived.hidden=count===0;archived.textContent=`旧角色动态 · ${count}`;archived.setAttribute('aria-pressed',String(filter==='archived'));
  const list=bankPosts.filter(p=>filter==='archived'?orphan(p):!orphan(p)&&(filter==='all'||filter==='user'&&p.author==='user'||filter==='role'&&p.author==='role'&&p.roleId===(profileRole||role.id)));
  composer.hidden=filter==='role'&&!!profileRole;
  if(filter==='archived'){const note=el('p','这里保留已离开角色的旧动态。可以导出或删除，不会再请求这些角色回应。','moment-archive-note');feed.append(note);}
  if(!list.length){const empty=el('section',undefined,'moments-empty');empty.append(el('span','✧'),el('h2','还没有动态'),el('p','发一条日常，照片或一两句话都可以。'));feed.append(empty);return;}
  for(const post of list){const owner=getRoles().find(r=>r.id===post.roleId),ownerName=owner?.name||'过往角色';const item=el('article',undefined,'moment-post');item.dataset.momentId=post.id;const head=el('header'),avatar=el('span',post.author==='user'?'你':ownerName.slice(0,1),'moment-avatar');if(post.author==='role'){const src=safeMedia(phoneAvatar(owner?.id||post.roleId,owner?.avatar));if(src){const img=el('img');img.src=src;img.alt='';img.onerror=()=>{avatar.replaceChildren(document.createTextNode(ownerName.slice(0,1)));avatar.dataset.fallback='true';};avatar.replaceChildren(img);}}
   if(post.author==='user'){const user=getUser(),src=safeMedia(user.avatar);if(src){const img=el('img');img.src=src;img.alt='';img.onerror=()=>{avatar.textContent=Array.from(user.name||'你')[0];};avatar.replaceChildren(img);}}
   const identity=el('div');identity.append(el('strong',post.author==='user'?(getUser().name||'我'):ownerName));head.append(avatar,identity);item.append(head,el('p',post.text,'moment-text'),el('small',post.runtimeRevision&&post.needsSync===false?'已同步本机':'浏览器保存 · 等待本机同步','moment-sync-state'));
   if(PUZZLE_SCENES[post.image]){const img=el('img',undefined,'moment-picture');img.src=new URL(PUZZLE_SCENES[post.image].image,import.meta.url).href;img.alt=PUZZLE_SCENES[post.image].name;img.loading='lazy';item.append(img);}
   const actionsRow=el('div',undefined,'moment-meta-row'),time=el('time',new Date(post.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}));time.dateTime=post.at;const menu=el('details',undefined,'moment-action-menu'),summary=el('summary','···');summary.setAttribute('aria-label','动态操作');menu.append(summary);const controls=el('div',undefined,'moment-actions'),like=button(post.liked?'取消赞':'♡ 赞',()=>{const wasLiked=post.liked;if(save(s=>changeMoment(s,post.id,{type:'like'}))){renderFeed();if(!wasLiked&&post.author==='role'&&owner&&!likedReplies.has(post.id)){likedReplies.add(post.id);if(api)api.tool('social_reaction_request',{momentId:post.id,roleId:post.roleId}).catch(e=>status.textContent=e.message);else enqueue(post.id,'like');}}});like.setAttribute('aria-pressed',String(post.liked));controls.append(like,button('评论',()=>{if(commentOpen.has(post.id))commentOpen.delete(post.id);else commentOpen.add(post.id);renderFeed();feed.querySelector(`[data-moment-id="${post.id}"] .moment-comment-form input`)?.focus({preventScroll:true});}));if(owner)controls.append(button('带去聊天',()=>onDiscuss(`我想和你聊聊这条${post.author==='role'?'虚构动态':'我发布的动态'}：\n${post.text}`,post.roleId)));
   const remove=button('删除',()=>{const confirm=button('确认移除这条动态',()=>{if(save(s=>changeMoment(s,post.id,{type:'delete'})))renderFeed();});remove.replaceWith(confirm);controls.append(button('取消',()=>renderFeed()));});controls.append(remove);menu.append(controls);actionsRow.append(time,menu);item.append(actionsRow);
   const comments=el('div',undefined,'moment-comments');if(post.liked){const likes=el('p','♡ '+(getUser().name||'我'),'moment-likes');comments.append(likes);}for(const c of post.comments){const commenter=getRoles().find(r=>r.id===(c.roleId||post.roleId));const row=el('p');row.append(el('strong',c.author==='user'?'我：':`${commenter?.name||ownerName}：`),document.createTextNode(c.author==='role'?(cleanMomentLabels(c.text)||'这条旧回应没有可显示的正文。'):c.text));if(c.author==='role'){row.append(button('回复',()=>{replyTargets.set(post.id,{id:c.id,roleId:c.roleId||post.roleId});commentOpen.add(post.id);renderFeed();feed.querySelector(`[data-moment-id="${post.id}"] input`)?.focus();},'moment-comment-reply'),button('♡',()=>api?.tool('social_reaction_request',{momentId:post.id,commentId:c.id}).catch(e=>status.textContent=e.message),'moment-comment-like'));}comments.append(row);}if(post.roleLikes?.length)comments.prepend(el('p','♡ '+post.roleLikes.map(id=>getRoles().find(r=>r.id===id)?.name||id).join('、'),'moment-likes'));item.append(comments);
   const form=el('form',undefined,'moment-comment-form'),text=el('input'),submit=el('button','评论');text.placeholder='写一条评论…';text.maxLength=1000;text.setAttribute('aria-label','评论内容');text.value=data.commentDrafts?.[post.id]||'';text.oninput=()=>save(s=>{const m=readMoments(s);s.moments={...m,commentDrafts:{...m.commentDrafts,[post.id]:text.value}};},false);submit.type='submit';form.hidden=!commentOpen.has(post.id)&&!data.commentDrafts?.[post.id];form.append(text,submit);form.onsubmit=e=>{e.preventDefault();if(save(s=>{changeMoment(s,post.id,{type:'comment',id:crypto.randomUUID(),text:text.value,author:'user',at:new Date().toISOString(),targetRoleId:replyTargets.get(post.id)?.roleId||post.roleId,replyTo:replyTargets.get(post.id)?.id});if(s.moments.commentDrafts)delete s.moments.commentDrafts[post.id];})){commentOpen.delete(post.id);renderFeed();replyTargets.delete(post.id);if(owner&&!api)enqueue(post.id,'comment');}};item.append(form);feed.append(item);
  }
  if(selection){const target=[...feed.querySelectorAll('[data-moment-id]')].find(n=>n.dataset.momentId===focusedId)?.querySelector('.moment-comment-form input');target?.focus({preventScroll:true});target?.setSelectionRange(...selection);}
 }
 function enqueue(id,trigger){queue.set(id,trigger);drain();}
 function drain(){
  if(!active||pending||!queue.size)return;
  const [id,trigger]=queue.entries().next().value;queue.delete(id);
  const post=readMoments(read()).posts.find(p=>p.id===id);
  if(post&&getRoles().some(r=>r.id===post.roleId))request({...structuredClone(post),trigger});else queueMicrotask(drain);
 }
 async function request(post){
  if(!active||pending)return;const role=post?getRoles().find(r=>r.id===post.roleId):getRole();if(!role){status.textContent='这位角色已移除，原动态仍保留。';return;}const controller=new AbortController(),operation={roleId:role.id,viewerRoleId:getRole().id,controller};pending=operation;status.textContent=`${role.name}正在写…`;renderFeed();
  try{const text=momentReply(await generate(role,post,controller.signal));
   // Some providers resolve after abort. A detached operation must never publish,
   // clear a newer request, or overwrite the newer request's status.
   if(pending!==operation)return;
   if(!active||getRole().id!==operation.viewerRoleId){cancelRequest('切换页面或角色后，已停止生成，没有发布未完成内容。');return;}
   controller.signal.throwIfAborted();if(typeof text!=='string'||!text.trim())throw Error('模型未返回内容。');
   const ok=save(s=>post?changeMoment(s,post.id,{type:'comment',id:crypto.randomUUID(),text,author:'role',at:new Date().toISOString()}):addMoment(s,{id:crypto.randomUUID(),roleId:role.id,author:'role',text,at:new Date().toISOString(),origin:'model-fiction'}));if(ok)status.textContent=`${role.name}的${post?'回应':'动态'}已保存。`;
  }catch(e){if(pending===operation)status.textContent=controller.signal.aborted?'已停止，没有发布未完成内容。':`未发布：${e.message}`;}finally{if(pending===operation){pending=null;if(active){renderFeed();queueMicrotask(drain);}}}
 }
 return {poll:()=>sync?.poll(),setFilter(kind='all',id=null){filter=kind;profileRole=id;if(active)renderFeed();},enter(page){clearInterval(pollTimer);active=page==='moments';if(active&&api)pollTimer=setInterval(()=>{if(document.visibilityState==='visible')sync?.poll();},5000);if(!active){queue.clear();idle?.leave();cancelRequest('离开朋友圈后，已停止生成，没有发布未完成内容。');return;}try{input.value=readMoments(read()).draft||'';}catch(e){status.textContent=e.message;}renderFeed();sync?.flush();idle?.enter();},leave(){clearInterval(pollTimer);active=false;queue.clear();idle?.leave();cancelRequest('离开朋友圈后，已停止生成，没有发布未完成内容。');},refresh(){if(pending&&getRole().id!==pending.viewerRoleId)cancelRequest('切换角色后，已停止生成，没有发布未完成内容。');if(active){renderFeed();idle?.refresh();}}};
}


