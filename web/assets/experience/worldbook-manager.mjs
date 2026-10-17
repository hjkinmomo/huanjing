import {applyRuntimeCatalog} from './runtime-catalog.mjs';
const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const cleanPlace=p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='available'));
export function packTemplates(){
 const place={id:'home',name:'庭院',aliases:['小院'],description:'一处安静的小院，石桌在树荫下，门边摆着浇水壶。',objects:['树荫石桌','浇水壶'],actions:['坐下聊天','照料花草'],exits:[],ambience:'树叶轻响，光线随时间自然变化。'};
 return {
  world:{schemaVersion:1,id:'my-world-pack',label:'我的新世界',priority:10,worlds:[{id:'my-world',name:'我的世界',summary:'一个可以继续补充地点的日常世界。',rules:['物件与人物动作保持空间连续，场景不替用户作决定。'],defaultLocation:'home',locations:[place]}]},
  scene:{schemaVersion:1,id:'urban-extra-place',label:'都市新增地点',priority:10,patches:[{worldId:'urban',locations:[{...place,id:'courtyard',exits:['cafe']}]}]},
  narration:{schemaVersion:1,id:'my-narration',label:'我的旁白与共同指导',priority:20,presentation:{sharedGuidance:'',reveal:{intervalMs:40,sceneCharacters:3,dialogueDelayMs:400},narrationRules:['旁白关注空间、物件和角色自己的动作；普通对白不重复环境，不代替用户决定。']}}
 };
}
export function mountWorldbookManager({api,trigger,onChanged=()=>{}}){
 const dialog=element('dialog');dialog.className='role-workspace-dialog worldbook-manager';dialog.setAttribute('aria-labelledby','worldbook-manager-title');
 dialog.innerHTML='<header><div><h2 id="worldbook-manager-title">世界与旁白扩展</h2><p>供当前人格模式的角色使用；两个模式的世界书与公共指导分别保存。</p></div><button type="button" aria-label="关闭世界与旁白扩展">×</button></header><p role="status" data-status></p><div class="pack-toolbar"><button type="button" data-reload>重新加载</button><button type="button" data-world-template>世界模板</button><button type="button" data-scene-template>场景模板</button><button type="button" data-narration-template>旁白模板</button><label class="pack-import-label">导入 JSON<input type="file" accept=".json,application/json" data-import></label></div><p class="workspace-hint">模板只打开编辑器。保存后即时生效，无需重启。卸载保留备份和旧聊天使用的地点快照。</p><section><h3>已安装数据包</h3><div data-packs></div></section><details open><summary>编辑世界里的场景</summary><div class="field-pair"><label>世界<select data-world aria-label="编辑的世界"></select></label><label>场景<select data-place aria-label="编辑的场景"></select></label></div><label>地点条目（JSON）<textarea data-place-editor spellcheck="false" maxlength="65536" rows="8"></textarea></label><div class="pack-toolbar"><button type="button" data-new-place>新增场景</button><button type="button" data-save-place>保存场景到世界书</button></div></details><details data-editor-panel><summary>数据包编辑器与公共提示词</summary><label>数据包 JSON<textarea data-pack-editor spellcheck="false" maxlength="524288" rows="12"></textarea></label><div class="pack-toolbar"><button type="button" data-save-pack>校验并保存数据包</button><button type="button" data-export-pack>导出编辑器内容</button></div><p class="workspace-hint">presentation.sharedGuidance 是公共补充提示词；presentation.narrationRules 控制旁白；reveal 控制出现节奏。人物提示词仍在角色人格页修改。</p></details>';
 document.body.append(dialog);const status=dialog.querySelector('[data-status]'),list=dialog.querySelector('[data-packs]'),world=dialog.querySelector('[data-world]'),place=dialog.querySelector('[data-place]'),packEditor=dialog.querySelector('[data-pack-editor]'),placeEditor=dialog.querySelector('[data-place-editor]');
 let snapshot=null,busy=false,newPlace=false;
 const button=(text,fn)=>{const b=element('button',text);b.type='button';b.onclick=fn;return b;};
 const download=(value,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download=name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function editPack(p){packEditor.value=JSON.stringify(p,null,2);dialog.querySelector('[data-editor-panel]').open=true;}
 function currentWorld(){return snapshot?.worlds.find(w=>w.id===world.value);}
 function populatePlace(){newPlace=false;const p=currentWorld()?.locations.find(p=>p.id===place.value);placeEditor.value=p?JSON.stringify(cleanPlace(p),null,2):'';}
 function populateWorld(){place.replaceChildren();for(const p of currentWorld()?.locations.filter(p=>p.available!==false)||[]){const o=element('option',p.name);o.value=p.id;place.append(o);}populatePlace();}
 function render(){
  const previous=world.value;world.replaceChildren();for(const w of snapshot.worlds.filter(w=>w.available!==false)){const o=element('option',w.name);o.value=w.id;world.append(o);}if([...world.options].some(o=>o.value===previous))world.value=previous;populateWorld();
  list.replaceChildren();if(!snapshot.packs.length)list.append(element('p','尚未安装扩展包，当前模式的内置都市仍可使用。'));
  for(const p of snapshot.packs){const row=element('article');row.className='worldbook-pack-row';row.append(element('strong',p.label),element('small',p.id+' · 优先级 '+p.priority));
   row.append(button('编辑',()=>run(async()=>{editPack(await api.tool('worldbook_pack_get',{id:p.id}));})),button('导出',()=>run(async()=>download(await api.tool('worldbook_pack_get',{id:p.id}),p.id))),button('卸载',()=>run(async()=>{snapshot=applyRuntimeCatalog(await api.tool('worldbook_remove',{id:p.id,expectedVersion:snapshot.version}));render();onChanged();status.textContent='已卸载并保留备份；旧聊天仍可读取已有地点。';})));list.append(row);
  }
  if(snapshot.errors.length)status.textContent='部分配置未生效，继续使用上一有效版本：'+snapshot.errors.join('；');
 }
 async function run(action){if(busy)return;busy=true;const controls=[...dialog.querySelectorAll('button,input,select')];controls.forEach(c=>c.disabled=true);try{await action();}catch(e){status.textContent=e.message==='worldbook_revision_conflict'?'资料已被其他窗口修改。先重新加载，再合并修改；编辑器内容保留。':e.message;}finally{busy=false;controls.forEach(c=>c.disabled=false);}}
 async function reload(){snapshot=await api.runtimeCatalog(true);render();onChanged();if(!snapshot.errors.length)status.textContent=(api.personaMode==='special'?'特殊模式':'正常模式')+' · 已重新加载 · '+snapshot.worlds.filter(w=>w.available!==false).length+' 个可用世界。';}
 world.onchange=populateWorld;place.onchange=populatePlace;
 dialog.querySelector('[aria-label="关闭世界与旁白扩展"]').onclick=()=>dialog.close();dialog.querySelector('[data-reload]').onclick=()=>run(reload);
 for(const [key,name] of [['world','world'],['scene','scene'],['narration','narration']])dialog.querySelector(`[data-${key}-template]`).onclick=()=>{editPack(packTemplates()[name]);status.textContent='模板已打开，编辑后保存即可安装。';};
 dialog.querySelector('[data-import]').onchange=e=>run(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>524288)throw Error('数据包不能超过512KB。');editPack(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));status.textContent='已载入编辑器；点击“校验并保存数据包”安装。';e.target.value='';});
 dialog.querySelector('[data-save-pack]').onclick=()=>run(async()=>{const pack=JSON.parse(packEditor.value);snapshot=applyRuntimeCatalog(await api.tool('worldbook_import',{pack,expectedVersion:snapshot.version}));render();onChanged();status.textContent='数据包已保存并生效。';});
 dialog.querySelector('[data-export-pack]').onclick=()=>run(async()=>{const p=JSON.parse(packEditor.value);download(p,p.id||'worldbook-pack');});
 dialog.querySelector('[data-new-place]').onclick=()=>{newPlace=true;placeEditor.value=JSON.stringify({...packTemplates().scene.patches[0].locations[0],id:'new-place',name:'新地点',exits:[]},null,2);status.textContent='填写独立ID、名称、物件和可做的事，再保存。';};
 dialog.querySelector('[data-save-place]').onclick=()=>run(async()=>{
  const p=JSON.parse(placeEditor.value);if(!newPlace&&p.id!==place.value)throw Error('已有场景的ID请保持稳定；修改名称用 name 字段，新增地点用“新增场景”。');
  let pack=snapshot.packs.some(p=>p.id==='local-scenes')?await api.tool('worldbook_pack_get',{id:'local-scenes'}):{schemaVersion:1,id:'local-scenes',label:'我修改的场景',priority:100,patches:[]};
  pack.patches||=[];let patch=pack.patches.find(x=>x.worldId===world.value);if(!patch){patch={worldId:world.value,locations:[]};pack.patches.push(patch);}patch.locations||=[];patch.locations=patch.locations.filter(x=>x.id!==p.id);patch.locations.push(p);
  snapshot=applyRuntimeCatalog(await api.tool('worldbook_import',{pack,expectedVersion:snapshot.version}));render();place.value=p.id;populatePlace();onChanged();status.textContent='世界书地点已更新，下一轮聊天读取新内容；旧回复保留。';
 });
 trigger.onclick=async()=>{dialog.showModal();status.textContent='正在读取世界与旁白资料…';await run(reload);};
 return {open:()=>trigger.click(),dialog};
}
