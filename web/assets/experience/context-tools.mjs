import {mountWorldbookView} from './worldbook-view.mjs';
import {SCENE_FIELDS} from './scene-state.mjs';
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export function mountContextTools({api,getRole,getSession,getSettings,getUsage,onOpen,onChanged}){
 const dialog=make('dialog');dialog.className='role-workspace-dialog context-inspector';dialog.setAttribute('aria-label','场景与上下文');
 const header=make('header'),title=make('h2','场景与上下文'),close=make('button','×');close.type='button';close.setAttribute('aria-label','关闭场景与上下文');close.onclick=()=>dialog.close();header.append(title,close);
 const status=make('p');status.setAttribute('role','status');const form=make('form'),fields=make('fieldset'),legend=make('legend','角色此刻的场景');fields.append(legend);
 for(const [key,[label,limit]]of Object.entries(SCENE_FIELDS)){const row=make('label',label),input=make(key==='setting'?'textarea':'input');input.name=key;input.maxLength=limit;input.setAttribute('aria-label',label);if(key==='setting')input.rows=3;row.append(input);fields.append(row);}
 const save=make('button','保存场景');save.type='submit';form.append(fields,make('p','这里只改变本会话的虚构场景。角色人格与长期用户记忆保持独立。'),save);
 const stats=make('p'),summaries=make('section');summaries.append(make('h3','分段归纳与来源'));
 const branch=make('fieldset');branch.append(make('legend','从这里继续另一种走向'));const select=make('select');select.setAttribute('aria-label','分支起点');
 const trialLabel=make('label'),trial=make('input');trial.type='checkbox';trial.checked=true;trialLabel.append(trial,document.createTextNode('试聊：读取角色记忆，不写入长期记忆，不使用外部工具'));
 const branchButton=make('button','创建聊天分支');branchButton.type='button';branch.append(select,trialLabel,branchButton);
 dialog.append(header,status,form,stats,summaries,branch);document.body.append(dialog);
 const worldHost=make('section');form.before(worldHost);
 const worldReader=mountWorldbookView(worldHost,p=>{form.elements.location.value=p.name;form.elements.setting.value=p.description;form.elements.activity.value='';status.textContent='已预填地点，保存场景后才更新；角色穿着与心情保留。';});
 let owner=null,state=null,generation=0;
 async function load(){
  const request=++generation,target={roleId:getRole().id,sessionId:getSession().sessionId};owner=target;state=null;worldReader.disable();fields.disabled=true;save.disabled=true;branchButton.disabled=true;status.textContent='正在读取这段会话…';
  try{
   const [context,history]=await Promise.all([api.contextState(owner.roleId,owner.sessionId),api.history(owner.roleId,owner.sessionId)]);
   if(request!==generation||!dialog.open||target.roleId!==getRole().id||target.sessionId!==getSession().sessionId)return;
   state=context;worldReader.update(context.world,context.scene,getSession().mode==='assistant');fields.disabled=getSession().mode==='assistant';save.disabled=fields.disabled;for(const key of Object.keys(SCENE_FIELDS))form.elements[key].value=context.scene?.state?.[key]||'';
   const usage=getUsage(),plan=usage?.plan,actual=usage?.usage;
   stats.textContent=[`窗口按会话独立；${context.memoryPolicy==='readonly'?'这是一段不写长期记忆的试聊':'长期记忆仅在同一角色内共享'}。`,plan?`最近一次组装约 ${plan.requestTokens||plan.used} token；窗口 ${plan.window} token，回复预留 ${plan.outputReserve}。估算不是模型的精确分词。${plan.summaryAvailable>plan.summaryCount?`本次选入 ${plan.summaryCount}/${plan.summaryAvailable} 段归纳，优先最近状态与相关内容；其余原始记录仍可查阅。`:''}`:'还没有本轮预算记录。',actual?.prompt_tokens?`模型回报输入 ${actual.prompt_tokens} token，输出 ${actual.completion_tokens||0} token。`:'模型尚未返回 token 用量。'].join(' ');
   summaries.replaceChildren(make('h3','分段归纳与来源'));
   const historyById=new Map(history.map(m=>[m.id,m]));
   for(const chunk of context.chunks){
    const details=make('details'),summary=make('summary',`消息 ${chunk.startOrdinal+1}–${chunk.throughOrdinal+1} · ${chunk.evidence.length} 条来源`),text=make('textarea');text.value=chunk.text;text.maxLength=1400;text.rows=5;text.setAttribute('aria-label','编辑分段归纳');details.append(summary,text);
    for(const e of chunk.evidence)details.append(make('small',`${e.speaker==='user'?'用户':'角色'} · ${e.messageId}：${historyById.get(e.messageId)?.text||e.quote}`));
    for(const remove of [false,true]){const action=make('button',remove?'移除这段归纳':'保存归纳更正');action.type='button';action.onclick=async()=>{action.disabled=true;try{await api.tool('chat_context_summary_edit',{...owner,chunkId:chunk.id,expectedUpdatedAt:chunk.updatedAt,text:text.value,remove});await load();onChanged?.();status.textContent=remove?'归纳已移除，原始消息仍保留。':'归纳已更正，来源保持可追溯。';}catch(e){status.textContent=e.message;}finally{action.disabled=false;}};details.append(action);}summaries.append(details);
   }
   if(!context.chunks.length)summaries.append(make('p','尚未接近预算，不需要分段压缩。原始聊天完整保留。'));
   for(const job of context.jobs||[]){
    if(!['failed','interrupted','running','discarded'].includes(job.status))continue;
    const row=make('p',job.status==='running'?'一段归纳仍在生成，请稍后重新打开。':job.status==='discarded'?'这段归纳已移除，不会自动重建；原始记录仍在。':`消息 ${job.throughOrdinal+1} 之前的归纳未完成（${job.error}）。原始记录仍在。`);
    if(job.status!=='running'){const retry=make('button','重新生成这段归纳');retry.type='button';retry.onclick=async()=>{retry.disabled=true;status.textContent='正在重新归纳，会调用一次当前模型…';try{await api.compactContext(owner.roleId,owner.sessionId,job.throughOrdinal,getSettings(),undefined,true);await load();onChanged?.();}catch(e){status.textContent='归纳失败：'+e.message;}finally{retry.disabled=false;}};row.append(retry);}summaries.append(row);
   }
   select.replaceChildren();for(const m of history.filter(m=>m.sender==='assistant')){const preview=m.text.replace(/\[\[scene-state\]\][\s\S]*?\[\[\/scene-state\]\]/g,'').replace(/\[\[.*?\]\]/g,'');const option=make('option',`${m.ordinal+1} · ${preview.slice(0,70)}`);option.value=m.id;select.append(option);}select.value=select.options[select.options.length-1]?.value||'';branchButton.disabled=!select.options.length;status.textContent=context.scene?.state?'场景可修改；后续回复会按这份场景继续。':'首次角色回复将建立场景，也可以先在这里填写。';
  }catch(e){if(request===generation)status.textContent='读取失败：'+e.message;}
 }
 form.onsubmit=async e=>{e.preventDefault();if(!state||!owner)return;save.disabled=true;try{const scene=Object.fromEntries(Object.keys(SCENE_FIELDS).map(k=>[k,form.elements[k].value]));await api.tool('chat_scene_update',{...owner,state:scene,expectedRevision:state.scene.revision});await load();onChanged?.();status.textContent='场景已保存，下次回复生效。';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
 branchButton.onclick=async()=>{branchButton.disabled=true;try{const item=await api.tool('chat_session_branch',{...owner,messageId:select.value,readOnly:trial.checked});await onOpen(item);dialog.close();}catch(e){status.textContent=e.message;branchButton.disabled=false;}};
 return {open(){dialog.showModal();load();},close(){dialog.close();}};
}
