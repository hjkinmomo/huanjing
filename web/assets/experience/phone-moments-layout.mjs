export function preparePhoneMoments(host){
 for(const [selector,title,cls] of [['.idle-moments','自动动态设置','phone-social-settings'],['.moment-composer','发布一条动态','phone-social-compose']]){
  const node=host.querySelector(selector);if(!node||node.parentElement.classList.contains(cls))continue;
  const details=document.createElement('details'),summary=document.createElement('summary');details.className=cls;summary.textContent=title;details.append(summary);
  if(cls==='phone-social-settings')host.append(details);else host.querySelector('.moments-hero').after(details);details.append(node);
 }
 if(!host.querySelector('.phone-social-manage')){const details=document.createElement('details'),summary=document.createElement('summary');details.className='phone-social-manage';summary.textContent='动态管理';details.append(summary);for(const node of [...host.querySelector('.moment-filters').children].slice(3))details.append(node);host.append(details);}
 if(!host.querySelector('.moments-settings-entry')){
  const gear=document.createElement('button');gear.className='moments-settings-entry';gear.title='动态设置';gear.setAttribute('aria-label','动态设置');gear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.2 2.2m8.4 8.4 2.2 2.2M5.6 18.4l2.2-2.2m8.4-8.4 2.2-2.2"/></svg>';
  const back=document.createElement('button');back.className='moments-settings-back';back.textContent='返回朋友圈';gear.onclick=()=>{host.dataset.management='true';host.scrollTop=0;};back.onclick=()=>{delete host.dataset.management;host.scrollTop=0;};host.prepend(gear,back);
 }
 delete host.dataset.management;
}
