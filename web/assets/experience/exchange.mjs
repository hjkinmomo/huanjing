import {saveSharedRole} from './roles.mjs';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const limits={name:40,description:8000,personality:4000,scenario:2000,first_mes:2000,mes_example:4000,system_prompt:8000,post_history_instructions:4000};
function string(data,key,max){const value=data[key]??'';if(typeof value!=='string'||value.length>max)throw Error(`${key} 必须是文字，最多 ${max} 字。`);return value;}
function readExpression(extensions){const e=extensions?.['hermes/expression'];if(!record(e))return {};return {expressionMode:['inherit','adaptive','off'].includes(e.mode)?e.mode:'inherit',roleSkillMode:e.presets==='off'?'off':'inherit',emotionGuidance:string(e,'guidance',2000),...(['inherit','custom','off'].includes(e.examples)?{exampleMode:e.examples}:{}),...(Object.hasOwn(e,'speechStyle')?{speechStyle:string(e,'speechStyle',4000)}:{})};}
export function parseCharacterCard(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>512*1024)throw Error('角色卡最多 512 KB。');
  let raw;try{raw=JSON.parse(text);}catch{throw Error('不是有效的 JSON 文件。');}
  if(!record(raw)||raw.spec!=='chara_card_v2'||raw.spec_version!=='2.0'||!record(raw.data))throw Error('请选择 Character Card V2 JSON；暂不支持 PNG 或 V3。');
  if(raw.data.extensions!==undefined&&!record(raw.data.extensions))throw Error('角色卡 extensions 必须是对象。');
  const data=raw.data,fields=Object.fromEntries(Object.entries(limits).map(([k,max])=>[k,string(data,k,max)]));
  if(!fields.name.trim()||!fields.description.trim())throw Error('角色名与 description 不能为空。');
  const book=data.character_book;
  if(book!==undefined&&(!record(book)||!Array.isArray(book.entries)||book.entries.length>200))throw Error('世界书格式不正确，最多 200 个条目。');
  const loreBook=(book?.entries||[]).map((entry,index)=>{
    if(!record(entry)||typeof entry.content!=='string'||!entry.content.trim()||entry.content.length>8000||!Array.isArray(entry.keys)||entry.keys.length>40||entry.keys.some(k=>typeof k!=='string'||k.length>160))throw Error(`世界书第 ${index+1} 条不符合正文/关键词限制。`);
    if(entry.enabled!==undefined&&typeof entry.enabled!=='boolean')throw Error(`世界书第 ${index+1} 条 enabled 格式不正确。`);
    // Unsupported selective/recursive/case-sensitive semantics stay in exchange metadata.
    // Disable such entries until the user deliberately edits/enables them here.
    const unsupported=entry.selective===true||entry.case_sensitive===true;
    const depth=entry.extensions?.['hermes/scanDepth']??book.scan_depth;
    return {title:String(entry.name||entry.comment||'').slice(0,100),keys:clone(entry.keys),content:entry.content,enabled:entry.enabled!==false&&!unsupported,constant:entry.constant===true,priority:Number.isInteger(entry.priority)?Math.max(-100,Math.min(100,entry.priority)):0,scanDepth:Number.isInteger(depth)?Math.max(0,Math.min(12,depth)):0};
  });
  return {name:fields.name.trim(),card:{persona:fields.description,personality:fields.personality,speechStyle:fields.mes_example,...(fields.mes_example?{dialogueExamples:fields.mes_example,exampleMode:'custom'}:{}),scenario:fields.scenario,greeting:fields.first_mes,systemPrompt:fields.system_prompt,postHistoryInstructions:fields.post_history_instructions,loreBook,...readExpression(data.extensions),extensions:{},exchangeSource:clone(raw)}};
}
export function exportCharacterCard(role){
  const card=role.card||{},raw=record(card.exchangeSource)?clone(card.exchangeSource):{spec:'chara_card_v2',spec_version:'2.0',data:{}};
  const data=raw.data;
  Object.assign(data,{name:role.name,description:card.persona||'',personality:card.personality||'',scenario:card.scenario||'',first_mes:card.greeting||'',mes_example:Object.hasOwn(card,'exampleMode')?card.dialogueExamples||'':card.speechStyle||'',system_prompt:card.systemPrompt||'',post_history_instructions:card.postHistoryInstructions||''});
  data.creator_notes ??='';data.creator ??='Hermes User';data.character_version ??='1.0';data.tags ??=[];data.alternate_greetings ??=[];data.extensions ??={};
  if(['expressionMode','roleSkillMode','emotionGuidance','exampleMode','dialogueExamples'].some(key=>Object.hasOwn(card,key)))data.extensions['hermes/expression']={...(record(data.extensions['hermes/expression'])?data.extensions['hermes/expression']:{}),mode:card.expressionMode||'inherit',presets:card.roleSkillMode||'inherit',guidance:card.emotionGuidance||'',examples:card.exampleMode||'inherit',speechStyle:card.speechStyle||''};
  const originals=data.character_book?.entries||[];
  data.character_book={...(data.character_book||{}),extensions:data.character_book?.extensions||{},entries:(card.loreBook||[]).map((e,i)=>({...originals[i],keys:clone(e.keys||[]),content:e.content,enabled:e.enabled!==false,insertion_order:i,constant:!!e.constant,name:e.title||'',priority:e.priority||0,extensions:{...originals[i]?.extensions,'hermes/scanDepth':e.scanDepth||0}}))};
  return raw;
}
export function conversationExport(role,messages,format='json'){
  const records=messages.filter(m=>m.tone!=='binding-application').map(m=>({id:String(m.id),speaker:m.from==='user'?'user':'assistant',text:typeof m.text==='string'?m.text:'',createdAt:typeof m.createdAt==='string'?m.createdAt:null,attachments:(Array.isArray(m.attachments)?m.attachments:[]).map(a=>({name:typeof a.name==='string'?a.name:'图片'}))}));
  if(format==='markdown')return `# 和${role.name}的对话\n\n`+records.map(m=>`## ${m.speaker==='user'?'你':role.name}${m.createdAt?' · '+m.createdAt:''}\n\n${m.text}${m.attachments.length?'\n\n附件（未包含文件）：'+m.attachments.map(a=>a.name).join('、'):''}`).join('\n\n---\n\n');
  return JSON.stringify({schema:'hermes-conversation-v1',role:{id:role.id,name:role.name},exportedAt:new Date().toISOString(),messages:records},null,2);
}
export function downloadText(name,text,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function mountCharacterExchange({host,getRole,onImported,storage=localStorage,locks=navigator.locks}){
  const panel=document.createElement('section');panel.className='exchange-panel';
  const exchangeDialog=document.createElement('dialog');exchangeDialog.className='editor-conflict-dialog exchange-dialog';exchangeDialog.setAttribute('aria-label','角色卡交换');
  const trigger=document.createElement('button');trigger.type='button';trigger.className='exchange-trigger';trigger.textContent='角色卡交换';trigger.onclick=()=>exchangeDialog.showModal();
  const close=document.createElement('button');close.type='button';close.textContent='关闭角色卡交换';close.onclick=()=>exchangeDialog.close();
  const title=document.createElement('h2');title.textContent='角色卡交换';
  const hint=document.createElement('p');hint.textContent='导入 V2 JSON 创建新角色；不包含聊天、记忆、图片或模型凭据。未知扩展仅保留作再次导出。';
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','选择 V2 JSON 角色卡');
  const output=document.createElement('button');output.type='button';output.textContent='导出当前角色卡';
  const feedback=document.createElement('p');feedback.setAttribute('role','status');
  const dialog=document.createElement('dialog');dialog.className='editor-conflict-dialog';dialog.setAttribute('aria-label','预览导入角色卡');
  const preview=document.createElement('p'),nameLabel=document.createElement('label'),name=document.createElement('input');name.type='text';name.maxLength=40;nameLabel.textContent='新角色名称';nameLabel.append(name);
  const confirm=document.createElement('button');confirm.type='button';confirm.textContent='创建这个角色';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>dialog.close();
  const error=document.createElement('p');error.setAttribute('role','status');dialog.append(preview,nameLabel,error,cancel,confirm);
  let pending=null,busy=false;
  input.onchange=async()=>{try{const file=input.files?.[0];if(!file)return;if(file.size>512*1024)throw Error('角色卡最多 512 KB。');pending=parseCharacterCard(await file.text());name.value=pending.name;preview.textContent=`${pending.name} · ${pending.card.loreBook.length} 个世界书条目。人格摘要：${pending.card.persona.slice(0,200)}。导入的选择性/大小写触发条目默认停用，请在世界书中核对。`;error.textContent='';dialog.showModal();name.focus();}catch(e){feedback.textContent=e.message;}finally{input.value='';}};
  confirm.onclick=async()=>{if(busy||!pending)return;busy=true;confirm.disabled=cancel.disabled=name.disabled=true;try{if(!name.value.trim())throw Error('请填写新角色名称。');const role={id:`custom-${crypto.randomUUID()}`,name:name.value.trim(),subtitle:'导入的角色',custom:true,card:clone(pending.card)};const result=await saveSharedRole(storage,locks,role);dialog.close();exchangeDialog.close();pending=null;feedback.textContent=result.warning||'角色已导入。';onImported(role,result.state);}catch(e){error.textContent=e.message;}finally{busy=false;confirm.disabled=cancel.disabled=name.disabled=false;}};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  output.onclick=()=>{try{const role=getRole();downloadText(`${role.name}-角色卡.json`,JSON.stringify(exportCharacterCard(role),null,2));feedback.textContent='已导出当前角色卡。';}catch(e){feedback.textContent=e.message;}};
  panel.append(title,hint,input,output,feedback,dialog);exchangeDialog.append(panel,close);host.append(trigger,exchangeDialog);
}
