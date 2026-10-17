export function mountToast(host){
 let timer;return function announce(text,{action,label='查看详情',duration=action?10000:5000}={}){
  clearTimeout(timer);host.replaceChildren();host.hidden=!text;if(!text)return;
  const dismiss=()=>{host.hidden=true;clearTimeout(timer);},arm=()=>{clearTimeout(timer);timer=setTimeout(dismiss,duration);};
  const content=document.createElement(action?'button':'span');content.className='toast-content';content.textContent=text;
  if(action){content.type='button';content.setAttribute('aria-label',text+'，'+label);content.onclick=()=>{dismiss();action();};}
  const close=document.createElement('button');close.className='toast-close';close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭提示');close.onclick=dismiss;
  host.append(content,close);host.onpointerenter=null;host.onpointerleave=null;host.onfocusin=null;host.onfocusout=null;arm();
  window.dispatchEvent(new CustomEvent('huanjing:notification',{detail:{kind:'tip'}}));
 };
}
