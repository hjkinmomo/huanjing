import {userIdentity,userOverview,saveUserIdentity,avatarFromFile} from './user-profile.mjs';
import {readCompanion} from './gifts.mjs';
import {games} from './leisure-core.mjs';
const $=(host,selector)=>host.querySelector(selector);
const node=(tag,text,className='')=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;el.className=className;return el;};
const format=n=>n.toLocaleString('zh-CN');
function dateText(at){const date=new Date(at);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'时间未记录';}
function paintAvatar(host,identity){
 host.replaceChildren();if(identity.avatar){const img=document.createElement('img');img.src=identity.avatar;img.alt='';img.onerror=()=>{host.replaceChildren(node('span',Array.from(identity.name)[0]||'你'));};host.append(img);}else host.append(node('span',Array.from(identity.name)[0]||'你'));
}
export function paintUserNavigation(identity,button){
 if(!button)return;paintAvatar(button.querySelector('.user-nav-avatar'),identity);
 button.title=identity.name?`${identity.name} · 我的资料`:'我的资料';
}
export function mountUserPanel({host,onChange,onOpen,storage=localStorage,locks=navigator.locks}){
 let expected=null,draft=null,dirty=false,saving=false,uploading=false,active=false,view='all',limit=20;
 const form=$(host,'#user-profile-form'),name=$(host,'#user-display-name'),share=$(host,'#user-name-sharing'),upload=$(host,'#user-avatar-upload'),feedback=$(host,'#user-profile-feedback');
 function status(text,error=false){feedback.textContent=text;feedback.dataset.error=String(error);feedback.hidden=!text;}
 function mark(){dirty=!!draft&&JSON.stringify(draft)!==JSON.stringify(expected);$(host,'#user-save').disabled=saving||uploading||!dirty;$(host,'#user-draft-status').textContent=dirty?'修改尚未保存':'资料已保存';}
 function updateDraft(){draft={...draft,name:name.value,shareNameWithCharacters:share.checked};mark();}
 function paintDraft(){name.value=draft.name;share.checked=draft.shareNameWithCharacters;paintAvatar($(host,'.user-avatar-preview'),draft);$(host,'#user-avatar-remove').disabled=saving||uploading||!draft.avatar;mark();}
 function readForm(){expected=userIdentity(readCompanion(storage));draft={...expected};dirty=false;paintDraft();status('');}
 function data(){
  const model=userOverview(readCompanion(storage));
  $(host,'#user-coin-balance').textContent=format(model.coins);$(host,'#user-item-count').textContent=format(model.itemCount);$(host,'#user-game-count').textContent=format(model.gameCount);
  const inventory=$(host,'#user-inventory');inventory.replaceChildren();
  for(const item of model.inventory){const el=node('li',undefined,'user-inventory-item');
   if(typeof item.image==='string'&&/^\.?\/assets\//.test(item.image)){const img=node('img');img.src=item.image;img.alt='';img.loading='lazy';img.onerror=()=>{img.hidden=true;};el.append(img);}
   const text=node('div');text.append(node('strong',item.name),node('small',`持有 ${item.count} 件${item.unknown?' · 暂不支持赠送':''}`));el.append(text);inventory.append(el);
  }
  $(host,'#user-inventory-empty').hidden=!!model.inventory.length;
  const scores=$(host,'#user-game-scores');scores.replaceChildren();
  for(const score of model.scores){const row=node('li');row.append(node('strong',score.name),node('span',`最高 ${score.best===null?'未记录':format(score.best)} 分`),node('small',`${score.count} 局`));scores.append(row);}
  $(host,'#user-scores-empty').hidden=!!model.scores.length;
  const rows=model.history.filter(r=>view==='all'||r.type===view),history=$(host,'#user-activity-list');history.replaceChildren();
  for(const record of rows.slice(0,limit)){
   const row=node('li',undefined,'user-activity'),type={game:'游戏',purchase:'购买',gift:'赠礼'}[record.type];
   let title='',detail='';
   if(record.type==='game'){title=games[record.kind]?.name||record.kind||'游戏';detail=`${Number.isFinite(record.score)?format(record.score)+' 分':'得分未记录'}${record.grade?' · '+record.grade+' 级':''} · 金币 +${record.reward??0}${record.roleName?' · 与'+record.roleName:''}`;}
   if(record.type==='purchase'){title=record.giftName||'物品';detail=`×${record.quantity??1} · 花费 ${record.total??'未记录'} 金币`;}
   if(record.type==='gift'){title=record.giftName||'礼物';detail=`送给 ${record.roleName||'历史角色'}${record.relationshipReasonLabel?' · '+record.relationshipReasonLabel:''}`;}
   const copy=node('div'),time=node('time',dateText(record.at));if(Number.isFinite(Date.parse(record.at)))time.dateTime=new Date(record.at).toISOString();
   copy.append(node('strong',title),node('small',detail));row.append(node('span',type,'activity-type'),copy,time);history.append(row);
  }
  $(host,'#user-history-empty').hidden=!!rows.length;$(host,'#user-history-more').hidden=rows.length<=limit;
  $(host,'#user-history-count').textContent=rows.length?`${rows.length} 条已保存记录`:'';
  paintUserNavigation(model.identity,document.querySelector('#open-user-panel'));
 }
 name.addEventListener('input',updateDraft);share.addEventListener('change',updateDraft);
 $(host,'#user-profile-reload').onclick=()=>{if(saving||uploading)return;readForm();data();};
 $(host,'#user-avatar-remove').onclick=()=>{if(saving||uploading)return;draft={...draft,avatar:''};paintDraft();status('头像已移除，保存后生效。');};
 upload.onchange=async()=>{
  if(!upload.files?.[0]||saving)return;uploading=true;mark();upload.disabled=true;
  try{const avatar=await avatarFromFile(upload.files[0]);draft={...draft,avatar};paintDraft();status('头像已准备好，保存后生效。');}catch(e){status(e.message,true);}finally{uploading=false;upload.disabled=false;upload.value='';paintDraft();}
 };
 form.onsubmit=async event=>{
  event.preventDefault();if(saving||uploading||!dirty)return;saving=true;mark();
  const controls=[...form.elements];controls.forEach(el=>el.disabled=true);
  try{const result=await saveUserIdentity(storage,locks,draft,expected);expected=userIdentity(result.state);draft={...expected};dirty=false;onChange(result.state);paintDraft();data();status(result.warning?'资料已保存；恢复副本暂未更新，请不要清除浏览器数据。':'已保存。下次发送消息时会使用新的名字分享设置。');}
  catch(e){status(e.message,true);}finally{saving=false;controls.forEach(el=>el.disabled=false);paintDraft();}
 };
 host.querySelectorAll('[data-user-open]').forEach(button=>button.onclick=()=>onOpen(button.dataset.userOpen));
 host.querySelectorAll('[data-history-filter]').forEach(button=>button.onclick=()=>{view=button.dataset.historyFilter;limit=20;host.querySelectorAll('[data-history-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));data();});
 $(host,'#user-history-more').onclick=()=>{limit+=20;data();};
 return {enter(){active=true;if(!draft||!dirty)readForm();try{data();}catch(e){status(e.message,true);}},leave(){active=false;},refresh(){if(active)try{data();if(!dirty&&!saving&&!uploading)readForm();}catch(e){status(e.message,true);}else paintUserNavigation(userIdentity(readCompanion(storage)),document.querySelector('#open-user-panel'));},pending:()=>dirty||saving||uploading};
}
