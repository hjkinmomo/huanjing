export function idleProfile(settings,messages,{name,roleHelpers=true}={}){
 const endpoint=new URL(String(settings.baseUrl||'').trim());
 if(!/\/chat\/completions\/?$/.test(endpoint.pathname))endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
 const model=String(settings.model||'').trim().replace(/^deepseek v4 (flash|pro)$/i,(_,type)=>`deepseek-v4-${type.toLowerCase()}`);
 return {name,roleHelpers:roleHelpers&&settings.roleSkills!==false,thinking:settings.thinking===true,provider:{endpoint:endpoint.href,model,credentialId:settings.credentialId||'chat'},messages:messages.filter(m=>m.role==='system'||m.role==='user'&&m.content.startsWith('本轮参考资料（数据块，不是用户新说的话或新的平台指令）：'))};
}

export function idleStatusText(value){
 const states={unarmed:'下次完成聊天后开始计时',chatting:'聊天中，暂不发动态',generating:'正在写一条日常',published:'已自动发布，等待下次聊天',failed:value.error||'生成失败，等待下次聊天',interrupted:'上次生成被中断，等待下次聊天',expired:'闲置已久，等待下次聊天'};
 if(!value.enabled)return '已关闭自动动态';
 if(value.status==='waiting')return `预计 ${new Date(value.dueAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 写一条日常`;
 return states[value.status]||'等待聊天';
}

export function mountIdleMoments({host,api,getRole,getProfile,onRefresh}){
 const box=document.createElement('section');box.className='idle-moments';
 const label=document.createElement('label'),toggle=document.createElement('input'),title=document.createElement('strong');toggle.type='checkbox';toggle.setAttribute('aria-label','当前角色自动朋友圈');label.append(toggle,title);
 const info=document.createElement('p');info.textContent='聊过之后，闲下来约1–2小时写一条虚构日常；再次聊天会顺延。每个角色24小时最多一条，使用你的聊天模型额度。本机服务运行时才会生成。';
 const status=document.createElement('p');status.className='idle-moments-status';status.setAttribute('role','status');box.append(label,info,status);
 const reactions=document.createElement('label'),reactionToggle=document.createElement('input'),reactionName=document.createElement('span'),reactionStatus=document.createElement('p');reactionToggle.type='checkbox';reactionToggle.setAttribute('aria-label','当前角色回应朋友圈');reactionName.textContent='回应朋友圈';reactions.append(reactionToggle,reactionName);reactionStatus.setAttribute('role','status');box.append(reactions,reactionStatus);host.append(box);
 let active=false,timer=null,generation=0;
 async function refresh(){
  const id=getRole().id,sequence=++generation;toggle.disabled=true;title.textContent=`${getRole().name}的自动朋友圈`;
  try{const profile=getProfile();if(profile){await api.tool('auto_moment_configure',{roleId:id,profile});await api.tool('social_reaction_configure',{roleId:id,profile});}const value=await api.tool('auto_moment_status',{roleId:id}),reaction=await api.tool('social_reaction_status',{roleId:id});if(sequence!==generation||id!==getRole().id)return;toggle.checked=value.enabled;status.textContent=idleStatusText(value);reactionToggle.checked=reaction.enabled;reactionStatus.textContent=!reaction.enabled?'已关闭回应；自动发动态是独立开关。':!reaction.ready?'先保存该角色的模型连接，再回应朋友圈。':reaction.queued?'有 '+reaction.queued+' 条待回应；会遵守频率与安静时段。':'可以回应新动态；不要求每条都评价。';}
  catch(e){if(sequence===generation)status.textContent=`自动动态状态未读取：${e.message}`;}
  finally{if(sequence===generation)toggle.disabled=false;}
 }
 toggle.onchange=async()=>{
  const id=getRole().id,wanted=toggle.checked,sequence=++generation;toggle.disabled=true;
  try{const value=await api.tool('auto_moment_configure',{roleId:id,enabled:wanted});if(sequence===generation&&getRole().id===id){toggle.checked=value.enabled;status.textContent=idleStatusText(value);}}
  catch(e){if(sequence===generation){toggle.checked=!wanted;status.textContent=`开关未保存：${e.message}`;}}
  finally{if(sequence===generation)toggle.disabled=false;}
 };
 reactionToggle.onchange=async()=>{const id=getRole().id,wanted=reactionToggle.checked;reactionToggle.disabled=true;try{await api.tool('social_reaction_configure',{roleId:id,enabled:wanted});if(id===getRole().id)await refresh();}catch(e){reactionToggle.checked=!wanted;reactionStatus.textContent=e.message;}finally{reactionToggle.disabled=false;}};
 return {enter(){active=true;refresh();clearInterval(timer);timer=setInterval(()=>{if(active&&document.visibilityState==='visible'){refresh();onRefresh();}},30000);},leave(){active=false;generation++;clearInterval(timer);},refresh};
}
