export function showCatchupDialog(count,{openPhone,host=document.body}={}){
 if(!Number.isInteger(count)||count<=0)return null;
 const dialog=document.createElement('dialog');dialog.className='world-catchup-dialog';dialog.dataset.systemNotice='true';dialog.setAttribute('aria-label','离线消息提醒');
 const title=document.createElement('h3');title.textContent=`这段时间你收到了 ${count} 条消息`;
 const description=document.createElement('p');description.textContent='打开微聊，看看他们发来的消息。';
 const actions=document.createElement('div');actions.className='catchup-actions';
 const open=document.createElement('button');open.type='button';open.className='primary';open.textContent='打开微聊';open.onclick=()=>{dialog.close();openPhone?.('contacts');};
 const later=document.createElement('button');later.type='button';later.textContent='稍后查看';later.onclick=()=>dialog.close();actions.append(open,later);dialog.append(title,description,actions);host.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();return dialog;
}
