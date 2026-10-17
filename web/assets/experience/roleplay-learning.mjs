import {roleSkillBindings} from './api.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function mountRoleplayLearning({host,api,getRole,suggest}){
 let generation=0,controller=null,activeRole='';
 const heading=el('h2','角色表达学习'),description=el('p','保留你认可的表达技巧，下次聊天会读取。与事件记忆分开，每个角色单独保存。'),state=el('p','','field-help'),list=el('div'),form=el('form'),draft=el('textarea'),save=el('button','保存学习笔记','primary'),learn=el('button','从最近对话提炼'),cancel=el('button','停止提炼'),status=el('p');
 draft.rows=3;draft.maxLength=1000;draft.placeholder='例如：普通闲聊回答一两句；演绎时不要替我写台词。';draft.setAttribute('aria-label','角色表达学习笔记');save.type='submit';learn.type=cancel.type='button';cancel.hidden=true;status.setAttribute('role','status');form.append(draft,save,learn,cancel);host.append(heading,description,state,list,form,status);host.classList.add('roleplay-learning');
 const feedback=e=>status.textContent=e.message;
 async function change(role,action,message){const seq=generation;try{await action();if(seq!==generation||role.id!==getRole().id)return;const expected=generation+1;await refresh();if(expected===generation&&role.id===getRole().id)status.textContent=message;}catch(e){if(seq===generation&&role.id===getRole().id)feedback(e);}}
 function stop(){controller?.abort();controller=null;cancel.hidden=true;learn.disabled=false;}
 async function refresh(){const role=getRole(),seq=++generation;activeRole=role.id;stop();draft.value='';status.textContent='';list.replaceChildren();save.disabled=false;heading.textContent=`${role.name}的表达学习`;
  try{const [notes,context]=await Promise.all([api.tool('roleplay_lesson_list',{roleId:role.id}),api.tool('roleplay_context',{roleId:role.id,context:'chat',disabledSkillIds:roleSkillBindings(role)})]);if(seq!==generation||role.id!==getRole().id)return;
   state.textContent=`当前可用扮演技能：${context.catalog?.total??context.skillIds.length} 项。模型按需读取方法，不会每轮加载全部正文；你确认的表达笔记仍直接生效。关闭“角色扮演辅助”后，技能和笔记都不参与回复。`;list.replaceChildren();
   for(const note of notes.items){const row=el('form',undefined,'roleplay-lesson'),text=el('textarea'),enabled=el('label','启用这条技巧 '),check=el('input'),update=el('button','保存修改'),remove=el('button','删除');text.value=note.text;text.maxLength=1000;text.rows=2;text.setAttribute('aria-label','已保存的表达技巧');check.type='checkbox';check.checked=note.enabled;enabled.append(check);update.type='submit';remove.type='button';
    row.append(text,enabled,update,remove);row.onsubmit=async e=>{e.preventDefault();if(role.id!==getRole().id)return;await change(role,()=>api.tool('roleplay_lesson_save',{roleId:role.id,id:note.id,text:text.value,enabled:check.checked}),'修改已保存，下一次回复会读取。');};
    remove.onclick=async()=>{if(role.id!==getRole().id)return;await change(role,()=>api.tool('roleplay_lesson_delete',{roleId:role.id,id:note.id}),'已删除，下一次回复不再使用。');};list.append(row);
   }
  }catch(e){if(seq===generation)feedback(e);}
 }
 form.onsubmit=async e=>{e.preventDefault();const role=getRole();if(activeRole!==role.id)return;const value=draft.value;save.disabled=true;try{await change(role,()=>api.tool('roleplay_lesson_save',{roleId:role.id,text:value,enabled:true}),'已保存为这位角色的表达技巧。');}finally{save.disabled=false;}};
 learn.onclick=async()=>{const role=getRole();if(activeRole!==role.id||controller)return;const operation=new AbortController();controller=operation;learn.disabled=true;cancel.hidden=false;status.textContent='正在提炼候选技巧，完成后由你修改和决定是否保存…';
  try{const text=await suggest(role,operation.signal);if(controller!==operation||role.id!==getRole().id)return;draft.value=text.slice(0,1000);status.textContent='候选技巧已放入编辑框；尚未保存或改变角色。';}catch(e){if(controller===operation)feedback(e);}finally{if(controller===operation)stop();}
 };
 cancel.onclick=()=>{stop();status.textContent='提炼已停止，没有新增笔记。';};
 return {refresh,leave(){generation++;stop();},roleChanged(){if(activeRole!==getRole().id){generation++;stop();draft.value='';list.replaceChildren();}},pending:()=>!!controller};
}
