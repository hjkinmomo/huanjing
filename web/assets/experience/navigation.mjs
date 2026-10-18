// Experience organization only. This is not an authorization or storage boundary.
export const APPLICATION_PAGES=Object.freeze(['chat','characters','bag','shop','games','manage','create','edit','settings','life','moments','profile']);
export const MANAGEMENT_PAGES=Object.freeze(['diagnostics']);
export function experienceLayer(page){return MANAGEMENT_PAGES.includes(page)?'management':'application';}
// A preference is part of its route, so direct links, refresh and Back agree.
export function preferenceFromHash(hash){
  const [page,section]=String(hash).replace(/^#\//,'').split('/');
  return page==='settings'&&['reading','appearance','connection','role','memory'].includes(section)?section:'reading';
}
export function preferenceHash(section){
  return ['appearance','connection','role','memory'].includes(section)?`#/settings/${section}`:'#/settings';
}
export function managementTarget(section,roleId){
  if(['voice','lore','layers'].includes(section))return {page:'edit',studio:section,hash:`#/edit/${encodeURIComponent(roleId)}`};
  if(section==='settings')return {page:'settings',hash:'#/settings'};
  if(section==='interaction')return {page:'settings',preference:'role',hash:'#/settings'};
  if(section==='create')return {page:'create',hash:'#/create'};
  throw new Error('Unknown management destination');
}
export function mountLayerNavigation({root,header,roleName,roleId,onOpen}){
  header.querySelectorAll('[data-manage-section]').forEach(button=>button.addEventListener('click',()=>onOpen(button.dataset.manageSection)));
  document.querySelectorAll('#page-manage [data-manage-section]').forEach(button=>button.addEventListener('click',()=>onOpen(button.dataset.manageSection)));
  return {update(page){
    const layer=experienceLayer(page);root.dataset.layer=layer;
    header.querySelectorAll('[data-layer-only]').forEach(node=>node.hidden=node.dataset.layerOnly!==layer);
    const settings=header.querySelector('[data-go="manage"]');
    if(['manage','edit','create','settings'].includes(page))settings.setAttribute('aria-current','page');else settings.removeAttribute('aria-current');
    document.querySelector('#manage-role-name').textContent=roleName();
    document.querySelector('#manage-assets').href=`#/edit/${encodeURIComponent(roleId())}`;
  }};
}

// Native modal dialogs make the outer navigation inert. Give each owned dialog
// the same escape route and let its existing close handlers release its state.
export function mountDialogChatReturn({onChat}){
 const decorate=dialog=>{
  if(dialog.dataset.ownedNavigation==='true'||dialog.dataset.systemNotice==='true'||dialog.id==='phone-window'||dialog.classList.contains('phone-app-transition')||dialog.classList.contains('phone-world-dialog'))return;
  const existing=dialog.querySelector('.dialog-main-nav');if(existing){const busy=dialog.getAttribute('aria-busy')==='true';existing.querySelectorAll('button').forEach(n=>n.disabled=busy);return;}if(dialog.querySelector('.dialog-main-chat'))return;
  const bar=document.createElement('nav');bar.className='dialog-main-nav';bar.setAttribute('aria-label','窗口返回导航');
  const back=document.createElement('button');back.type='button';back.className='dialog-back';back.textContent='← 返回上一步';back.setAttribute('aria-label','返回上一步');back.addEventListener('click',()=>{if(dialog.getAttribute('aria-busy')!=='true')dialog.close('cancel');});
  const button=document.createElement('button');button.type='button';button.className='dialog-main-chat';button.textContent='回到聊天';button.setAttribute('aria-label','回到主聊天');
  button.addEventListener('click',()=>{if(dialog.getAttribute('aria-busy')==='true')return;for(const open of [...document.querySelectorAll('dialog[open]')].reverse())if(open.open)open.close('cancel');onChat();});
  bar.append(back,button);dialog.prepend(bar);

 };
 document.querySelectorAll('dialog').forEach(decorate);
 const observer=new MutationObserver(records=>{for(const record of records){const owner=record.target.closest?.('dialog');if(owner)decorate(owner);for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.tagName==='DIALOG')decorate(node);else node.querySelectorAll('dialog').forEach(decorate);}}});
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','aria-busy']});
 return {destroy:()=>observer.disconnect()};
}
