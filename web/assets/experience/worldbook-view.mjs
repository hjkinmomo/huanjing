import {worldById,locationByName,sceneAddress} from './worldbook.mjs';
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function mountWorldbookView(host,onChoose){
 const details=node('details');details.className='worldbook-reader';const summary=node('summary','世界书 · 查看地点与可互动内容');
 const info=node('p'),label=node('label','浏览地点'),select=node('select');select.setAttribute('aria-label','世界书地点');label.append(select);
 const content=node('section'),use=node('button','将这个地点预填到场景');use.type='button';const hint=node('p','浏览不会转场。预填后点击“保存场景”，才会更改当前地点。');hint.className='workspace-hint';
 details.append(summary,info,label,content,use,hint);host.append(details);let world=null;
 function render(){content.replaceChildren();const p=world?.locations.find(x=>x.id===select.value);if(!p)return;
  content.append(node('h3',p.name),node('code',sceneAddress(world.id,p.id)),node('p',p.description),node('p',p.ambience));
  for(const [title,values]of [['可用物件',p.objects],['可以做什么',p.actions],['相邻地点',p.exits.map(id=>world.locations.find(x=>x.id===id)?.name||id)]]){content.append(node('h4',title));const list=node('ul');for(const value of values)list.append(node('li',value));content.append(list);}
 }
 select.onchange=render;use.onclick=()=>{const p=world?.locations.find(x=>x.id===select.value);if(p)onChoose(p);};
 return {update(binding,scene,disabled=false){world=worldById(binding?.id);details.hidden=!world;if(!world)return;info.textContent=world.summary+' '+world.rules.join(' ');select.replaceChildren();for(const p of world.locations){const o=node('option',p.name);o.value=p.id;select.append(o);}select.value=locationByName(binding,scene?.state?.location)?.id||binding.location;use.disabled=disabled;render();},disable(){use.disabled=true;}};
}
