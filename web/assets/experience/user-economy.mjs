const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export function mountUserEconomy(host,{getLife,transact,newConversation=()=>{}}){
 const section=el('section');section.className='user-economy-panel';section.setAttribute('aria-label','我的身份');const identity=host.querySelector('.user-identity-panel');let column=host.querySelector('.user-identity-column');if(!column){column=el('div');column.className='user-identity-column';identity.before(column);column.append(identity);}column.append(section);let busy=false;
 const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
 async function run(name,args,status){if(busy)return;busy=true;section.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);try{await transact(name,args,true);busy=false;render();}catch(e){status.textContent=({identity_name_exists:'这个身份名称已经存在，请换一个名字。',identity_mode_busy:'本模式有任务还在进行，完成后再切换身份。'})[e.message]||e.message;busy=false;section.querySelectorAll('button,input,select').forEach(n=>n.disabled=false);}}
 function render(){if(busy)return;const life=getLife(),data=life?.userEconomy,bank=life?.identityBank;section.replaceChildren(el('h2','我的身份'));if(!data||!bank){section.append(el('p','正在读取身份存档…'));return;}const status=el('p');status.setAttribute('role','status');
  if(!bank.ready){section.append(el('p','在本模式第一次创建角色新聊天时，命名并选择你的身份。'),button('创建第一段角色聊天',newConversation));}
  else{const active=bank.active,profile=bank.profiles.find(p=>p.id===active.profile);section.append(el('strong',active.name),el('p',profile?.name||'世界身份'),el('p',`每日收入 ${profile?.daily||0} 金币 · 每月生活费 ${profile?.monthly||0} 金币`),el('small','当前模式的所有角色共享这个身份。身份类型固定，重开会保存这段生活，恢复旧身份时也会恢复它的角色记忆。'));
   const manage=el('details');manage.className='identity-bank-manager';manage.append(el('summary','重开或恢复身份'));
   const name=el('input');name.maxLength=60;name.setAttribute('aria-label','新身份名称');name.placeholder='给新的生活起一个不重复的名字';const profileSelect=el('select');profileSelect.setAttribute('aria-label','新身份类型');profileSelect.append(new Option('选择新身份类型',''),...bank.profiles.map(p=>new Option(p.name,p.id)));
   const label=el('label','新身份名称');label.append(name);const typeLabel=el('label','身份类型');typeLabel.append(profileSelect);manage.append(el('p','重开仅作用于本模式。当前身份与全部角色的生活会保存为存档；新身份的聊天、记忆、关系、金币和物品从头开始。'),label,typeLabel,button('保存当前生活并重开',()=>{if(!name.value.trim()||!profileSelect.value){status.textContent='请填写不重复的身份名称并选择类型。';return;}run('world_identity_create',{name:name.value.trim(),profile:profileSelect.value,restart:true},status);}));
   const previous=bank.identities.filter(i=>i.id!==active.id);if(previous.length){manage.append(el('h3','以前的身份'));for(const item of previous){const row=el('article');row.className='identity-bank-row';row.append(el('strong',item.name),el('small',bank.profiles.find(p=>p.id===item.profile)?.name||'原有生活'));const restore=button('恢复这个身份',()=>{row.querySelector('.identity-restore-confirm')?.remove();const confirm=el('div');confirm.className='identity-restore-confirm';confirm.append(el('p',`保存当前生活，然后恢复“${item.name}”的全部角色、聊天和记忆？`),button('取消',()=>confirm.remove()),button('确认恢复',()=>run('world_identity_switch',{id:item.id},status)));row.append(confirm);});row.append(restore);manage.append(row);}}
   section.append(manage);
  }
  section.append(status);
 }
 render();return {refresh:render};
}
