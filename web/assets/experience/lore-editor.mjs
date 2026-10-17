import '../shared-state.js';
import {modeRoleRecord} from './persona-modes.mjs';
import {readState,changeState} from './state.mjs';
const shared=globalThis.HermesSharedState;
const record=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function cardFor(source,catalog,id) {
  if(source.roleCards!==undefined && !record(source.roleCards))throw Error('角色资料格式异常，未作修改。');
  const {role,card}=modeRoleRecord(source,catalog,id);
  if(!record(card))throw Error('角色卡格式异常，未作修改。');
  return card;
}
function check(entries) {
  if(!Array.isArray(entries) || entries.some(e=>!record(e) || typeof e.content!=='string' || (e.keys!==undefined && (!Array.isArray(e.keys) || e.keys.some(k=>typeof k!=='string')))))throw Error('世界书格式异常，请在原入口检查；原始资料没有被改写。');
}
export function beginLoreEdit(source,catalog,roleId) {
  const base=structuredClone(cardFor(source,catalog,roleId).loreBook ?? []);check(base);
  return {roleId,base,values:structuredClone(base)};
}
export function prepareLoreEdit(source,catalog,draft) {
  check(draft.base);check(draft.values);
  const current=cardFor(source,catalog,draft.roleId),latest=current.loreBook ?? [];check(latest);
  if(equal(draft.base,draft.values) || equal(latest,draft.values))return {state:source,changed:false};
  if(!equal(latest,draft.base))throw Error('世界书已被其他窗口修改。草稿已保留；请重新打开并对照后再保存。');
  if(draft.values.length>200)throw Error('最多保留 200 个条目，请先在原入口整理。');
  draft.values.forEach((e,i)=>{
    if(equal(e,draft.base[i]))return;
    if(e.content.length>8000 || !e.content.trim())throw Error(`第 ${i+1} 条请填写正文，最多 8000 字。`);
    if(e.keys?.length>40 || e.keys?.some(k=>k.length>160))throw Error(`第 ${i+1} 条关键词过多或过长。`);
    if(e.priority!==undefined&&(!Number.isInteger(e.priority)||e.priority<-100||e.priority>100))throw Error(`第 ${i+1} 条优先级须为 -100 到 100 的整数。`);
    if(e.scanDepth!==undefined&&(!Number.isInteger(e.scanDepth)||e.scanDepth<0||e.scanDepth>12))throw Error(`第 ${i+1} 条历史扫描须为 0 到 12 的整数。`);
    if(e.title!==undefined && (typeof e.title!=='string' || e.title.length>100))throw Error(`第 ${i+1} 条标题最多 100 字。`);
  });
  return {changed:true,state:{...source,roleCards:{...source.roleCards,[draft.roleId]:{...current,loreBook:structuredClone(draft.values)}}}};
}
export async function saveLoreEdit(storage,locks,catalog,draft) {
  return shared.exclusive(locks,()=>{
    const snapshot=shared.read(storage);
    if(snapshot.recovered)throw Error('正在读取恢复副本，请先在原入口恢复资料。');
    const result=prepareLoreEdit(snapshot.state,catalog,draft);
    if(!result.changed)return {...result,warning:''};
    try {return {...shared.commit(storage,snapshot,result.state,new Date().toISOString()),changed:true};}
    catch(error){throw Error(error.message.replaceAll('赠礼','世界书').replaceAll('重新选择礼物','重新打开世界书'));}
  });
}
export function readLoreDraft(storage,id) {
  const drafts=readState(storage).loreDrafts;
  if(drafts!==undefined && !record(drafts))throw Error('世界书草稿格式异常，未作修改。');
  const draft=drafts?.[id] ?? null;
  if(draft){if(draft.roleId!==id)throw Error('世界书草稿所属角色异常。');check(draft.base);check(draft.values);}
  return draft;
}
export function writeLoreDraft(storage,id,expected,next) {
  return changeState(storage,state=>{
    if(state.loreDrafts!==undefined && !record(state.loreDrafts))throw Error('世界书草稿格式异常，未作修改。');
    const drafts={...state.loreDrafts};
    if(!equal(drafts[id]??null,expected))throw Error('另一个窗口修改了世界书草稿，当前内容仍在页面，请不要关闭。');
    if(next)drafts[id]=structuredClone(next);else delete drafts[id];
    state.loreDrafts=drafts;
  });
}
export function mountLoreEditor(host,storage,locks,catalog,onSaved) {
  let draft=null,expected=null,busy=false,failed=false;
  const list=host.querySelector('.lore-list'),status=host.querySelector('.lore-feedback'),save=host.querySelector('.lore-save'),add=host.querySelector('.lore-add');
  const reload=document.createElement('button');reload.type='button';reload.textContent='放弃世界书草稿';host.querySelector('.lore-actions').append(reload);
  const dialog=document.createElement('dialog');dialog.className='editor-conflict-dialog';dialog.setAttribute('aria-labelledby','lore-discard-title');
  const dialogTitle=document.createElement('h2');dialogTitle.id='lore-discard-title';dialogTitle.textContent='放弃世界书草稿？';
  const explanation=document.createElement('p');explanation.textContent='只放弃此角色尚未保存的世界书草稿。已保存的世界书和人格设定不会改变。';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='继续编辑';cancel.onclick=()=>dialog.close();
  const discard=document.createElement('button');discard.type='button';discard.textContent='放弃并重新载入';
  const dialogActions=document.createElement('div');dialogActions.className='lore-actions';dialogActions.append(cancel,discard);dialog.append(dialogTitle,explanation,dialogActions);host.append(dialog);
  const feedback=text=>{status.textContent=text;};
  const dirty=()=>draft && !equal(draft.base,draft.values);
  function persist(){
    const next=dirty()?draft:null;
    try{writeLoreDraft(storage,draft.roleId,expected,next);expected=structuredClone(next);failed=false;feedback(dirty()?'未保存的世界书草稿已保留。':'');}
    catch(error){failed=true;feedback(error.message);}
    save.disabled=busy || !dirty() || failed;reload.disabled=busy || !dirty();
  }
  function field(label,control){const node=document.createElement('label');node.append(document.createTextNode(label),control);return node;}
  function render(openIndex=-1){
    list.replaceChildren();
    draft.values.forEach((entry,index)=>{
      const row=document.createElement('details');row.className='lore-entry';row.open=index===openIndex;
      const summary=document.createElement('summary'),name=document.createElement('span'),badge=document.createElement('small');
      name.textContent=entry.title || entry.comment || entry.content.slice(0,22) || `条目 ${index+1}`;
      badge.textContent=entry.enabled===false?'已停用':entry.constant?'始终启用':'关键词触发';summary.append(name,badge);row.append(summary);
      const body=document.createElement('div');body.className='lore-entry-body';
      const title=document.createElement('input');title.type='text';title.maxLength=100;title.value=entry.title || entry.comment || '';
      const keys=document.createElement('input');keys.type='text';keys.value=(entry.keys || []).join('，');keys.placeholder='用逗号分隔，例如：咖啡，书房';
      const content=document.createElement('textarea');content.rows=4;content.maxLength=8000;content.value=entry.content;
      const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=entry.enabled!==false;
      const constant=document.createElement('input');constant.type='checkbox';constant.checked=!!entry.constant;
      const toggles=document.createElement('div');toggles.className='lore-toggles';toggles.append(field('启用',enabled),field('始终启用',constant));
      const priority=document.createElement('input');priority.type='number';priority.min='-100';priority.max='100';priority.step='1';priority.value=String(entry.priority??0);
      const depth=document.createElement('input');depth.type='number';depth.min='0';depth.max='12';depth.step='1';depth.value=String(entry.scanDepth??0);
      priority.oninput=()=>{entry.priority=priority.value===''?NaN:Number(priority.value);persist();};
      depth.oninput=()=>{entry.scanDepth=depth.value===''?NaN:Number(depth.value);persist();};
      body.append(field('优先级（-100 至 100）',priority),field('历史扫描条数（0 至 12）',depth));
      keys.disabled=constant.checked;
      body.append(field('标题',title),field('触发词',keys),field('设定正文',content),toggles);row.append(body);list.append(row);
      title.oninput=()=>{entry.title=title.value;name.textContent=title.value || `条目 ${index+1}`;persist();};
      keys.oninput=()=>{entry.keys=keys.value.split(/[,，\n]/).map(k=>k.trim()).filter(Boolean);persist();};
      content.oninput=()=>{entry.content=content.value;persist();};
      enabled.onchange=constant.onchange=()=>{entry.enabled=enabled.checked;entry.constant=constant.checked;keys.disabled=constant.checked;badge.textContent=!enabled.checked?'已停用':constant.checked?'始终启用':'关键词触发';persist();};
    });
    host.querySelector('.lore-count').textContent=`${draft.values.length} 个条目`;
    host.querySelector('.lore-empty').hidden=!!draft.values.length;
    save.disabled=busy || !dirty() || failed;reload.disabled=busy || !dirty();add.disabled=busy || draft.values.length>=200;
  }
  host.addEventListener('input',event=>event.stopPropagation());
  host.addEventListener('keydown',event=>{if(event.key==='Enter' && event.target.tagName==='INPUT')event.preventDefault();});
  reload.onclick=()=>{
    if(!draft || busy)return;dialog.showModal();cancel.focus();
  };
  discard.onclick=()=>{
    try{writeLoreDraft(storage,draft.roleId,expected,null);expected=null;failed=false;draft=beginLoreEdit(shared.read(storage).state,catalog,draft.roleId);render();feedback('已重新载入保存的世界书。');}catch(error){feedback(error.message);}
    dialog.close();reload.focus();
  };
  add.onclick=()=>{draft.values.push({id:`lore-${crypto.randomUUID()}`,title:'',keys:[],content:'',enabled:true,constant:false});persist();render(draft.values.length-1);list.lastElementChild?.querySelector('input')?.focus();};
  save.onclick=async()=>{
    if(busy || !draft)return;persist();if(failed)return;
    busy=true;save.disabled=true;add.disabled=true;reload.disabled=true;
    const controls=[...list.querySelectorAll('input,textarea')],disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);save.textContent='正在保存…';
    const submitted=structuredClone(draft),savedExpected=structuredClone(expected);
    try{
      const result=await saveLoreEdit(storage,locks,catalog,submitted);
      draft=beginLoreEdit(result.state,catalog,submitted.roleId);
      let warning=result.warning.replaceAll('赠礼','世界书');
      try{writeLoreDraft(storage,submitted.roleId,savedExpected,null);expected=null;}catch{warning='已保存，但草稿未清理，请勿反复添加条目。';}
      onSaved(result.state);feedback(warning || '世界书已保存，将用于之后发送的消息。');render();
    }catch(error){feedback(error.message);}
    finally{busy=false;save.textContent='保存世界书';controls.forEach((c,i)=>c.disabled=disabled[i]);save.disabled=!dirty() || failed;reload.disabled=!dirty();add.disabled=draft.values.length>=200;}
  };
  return {open(id){
    if(busy || (failed && draft?.roleId===id))return;
    try{const fresh=beginLoreEdit(shared.read(storage).state,catalog,id);expected=readLoreDraft(storage,id);draft=structuredClone(expected || fresh);failed=false;list.hidden=false;add.hidden=save.hidden=reload.hidden=false;feedback(dirty()?'未保存的世界书草稿已恢复。':'');render();}
    catch(error){draft=null;list.replaceChildren();add.hidden=save.hidden=reload.hidden=true;feedback(error.message);}
  },closeDialog:()=>{if(dialog.open)dialog.close();},pending:()=>busy || failed};
}
