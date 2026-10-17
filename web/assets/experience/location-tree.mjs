export function locationHierarchy(locations){
 const byId=new Map(locations.map(p=>[p.id,p]));
 const parent=p=>{const id=p?.metadata?.parentId;return typeof id==='string'&&id!==p.id&&byId.has(id)?id:null;};
 const path=id=>{const items=[];const seen=new Set();for(let p=byId.get(id);p&&!seen.has(p.id);p=byId.get(parent(p))){seen.add(p.id);items.unshift(p);}return items;};
 const children=id=>locations.filter(p=>parent(p)===(id||null));
 return {byId,parent,path,children,roots:children(null),label:id=>path(id).map(p=>p.name).join(' / ')};
}
export function mountLocationCascade(host,{getWorld,onChange=()=>{}}){
 host.classList.add('location-cascade');let selected='';
 function render(){
  const world=getWorld(),tree=locationHierarchy(world?.locations.filter(p=>p.available!==false)||[]);host.replaceChildren();
  if(!world)return;
  const target=tree.byId.get(selected)||tree.byId.get(world.defaultLocation)||tree.roots[0];
  if(!target)return;selected=target.id;
  const path=tree.path(selected),district=path[0]?.metadata?.district||'未分区';
  const area=document.createElement('label');area.textContent='区域';const areas=document.createElement('select');areas.setAttribute('aria-label','起点区域');
  for(const d of new Set(tree.roots.map(p=>p.metadata?.district||'未分区'))){const o=new Option(d,d);areas.append(o);}areas.value=district;
  areas.onchange=()=>{selected=tree.roots.find(p=>(p.metadata?.district||'未分区')===areas.value)?.id||'';render();onChange(selected);};area.append(areas);host.append(area);
  for(let depth=0;depth<=path.length;depth++){
   const parent=depth?path[depth-1]:null,choices=tree.children(parent?.id).filter(p=>depth||(p.metadata?.district||'未分区')===district);
   if(!choices.length)break;
   const label=document.createElement('label');label.textContent=depth===0?'建筑 / 地点':parent?.metadata?.kind==='building'?'楼层 / 分区':'内部地点';
   const select=document.createElement('select');select.setAttribute('aria-label','起点层级 '+(depth+1));
   if(depth)select.append(new Option('停留在'+parent.name,''));
   for(const p of choices)select.append(new Option(p.name,p.id));select.value=path[depth]?.id||'';
   select.onchange=()=>{selected=select.value||parent?.id;render();onChange(selected);};label.append(select);host.append(label);
   if(!path[depth])break;
  }
 }
 return {reset(id){selected=id||getWorld()?.defaultLocation||'';render();},get value(){return selected;}};
}
