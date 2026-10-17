import '../shared-state.js';
const shared=globalThis.HermesSharedState;
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function validateMediaFile(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file?.type))throw Error('请选择 PNG、JPG 或 WebP 图片。');
  if(!file.size||file.size>8*1024*1024)throw Error('图片不能超过 8 MB，请先压缩。');
}
export function prepareRoleMedia(source,catalog,roleId,metadata,expectedAvatar){
  if(![...catalog.roles,...(source.customRoles||[])].some(r=>r.id===roleId))throw Error('角色已不存在，未保存图片。');
  if(source.customRoleAssets!==undefined&&!record(source.customRoleAssets))throw Error('资源资料格式异常，原内容保留。');
  const bucket=source.customRoleAssets?.[roleId]||{avatar:null,portraits:[]};
  if(!record(bucket)||!Array.isArray(bucket.portraits))throw Error('角色资源格式异常，原内容保留。');
  if(!metadata||metadata.roleId!==roleId||!['avatar','portrait'].includes(metadata.kind)||!/^role-asset-(avatar|portrait)-[a-z0-9-]+$/.test(metadata.id)||!metadata.id.startsWith(`role-asset-${metadata.kind}-`))throw Error('图片归属或编号不正确。');
  const next=structuredClone(source);next.customRoleAssets||={};next.customRoleAssets[roleId]=structuredClone(bucket);
  if(metadata.kind==='avatar'){
    if((bucket.avatar?.id||null)!==expectedAvatar)throw Error('头像已在其他窗口修改，请重新打开资源页后再保存。');
    next.customRoleAssets[roleId].avatar=metadata;
  }else{
    if(bucket.portraits.length>=12)throw Error('每个角色最多添加 12 张自定义立绘。');
    if(bucket.portraits.some(p=>p.id===metadata.id))throw Error('这张图片已保存，请勿重复添加。');
    next.customRoleAssets[roleId].portraits.push(metadata);next.portraitMood||={};next.portraitMood[roleId]=`custom:${metadata.id}`;
  }
  return next;
}
export function attachmentRepository(){
  const open=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('hermes_project5_attachments_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('images'))r.result.createObjectStore('images',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('图片存储打不开，请检查浏览器存储空间。'));r.onblocked=()=>reject(Error('图片库被旧页面占用，请关闭旧页面重试。'));});
  const run=async(mode,operation)=>{const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('images',mode),request=operation(tx.objectStore('images'));let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(Error('图片写入未完成，原资料没有替换。'));});}finally{db.close();}};
  return {get:id=>run('readonly',store=>store.get(id)),put:(meta,blob)=>run('readwrite',store=>store.put({...meta,blob}))};
}
export async function saveRoleMedia({storage,locks,catalog,repository,metadata,blob,expectedAvatar}){
  return shared.exclusive(locks,async()=>{
    const snapshot=shared.read(storage);if(snapshot.recovered)throw Error('请先恢复资料，再更换图片。');
    const next=prepareRoleMedia(snapshot.state,catalog,metadata.roleId,metadata,expectedAvatar);
    await repository.put(metadata,blob); // Await transaction commit before referencing a durable blob.
    const saved=shared.commit(storage,snapshot,next,new Date().toISOString());
    return {...saved,warning:saved.warning.replace('赠礼','图片')};
  });
}
export function applyRoleMedia(roles,source,urls){
  for(const role of roles){const bucket=source.customRoleAssets?.[role.id];if(!bucket)continue;
    if(urls.has(bucket.avatar?.id))role.avatar=urls.get(bucket.avatar.id);
    role.portraits=(role.portraits||[]).filter(p=>!String(p?.id||'').startsWith('custom:'));
    for(const meta of bucket.portraits||[]){const src=urls.get(meta.id);if(src)role.portraits.push({id:`custom:${meta.id}`,src,label:meta.label||'自定义立绘',unlockAt:0,custom:true});}
    const chosen=role.portraits.find(p=>p.id===source.portraitMood?.[role.id]);if(chosen)role.portrait=chosen.src;
  }
}
export function mountRoleMedia(host,{storage,locks,catalog,repository,getRole,getSource,urls,onSaved}){
  let id='',expectedAvatar=null,busy=false;const drafts=new Map();
  const feedback=host.querySelector('[data-media-feedback]');
  const render=()=>{
    const role=getRole(id);if(!role)return;host.querySelector('[data-media-role]').textContent=`${role.name}的图片`;
    for(const kind of ['avatar','portrait']){const draft=drafts.get(`${id}:${kind}`),image=host.querySelector(`[data-media-preview=${kind}]`);image.hidden=!draft;if(draft)image.src=draft.url;host.querySelector(`[data-media-save=${kind}]`).disabled=busy||!draft;}
    const list=host.querySelector('[data-media-list]');list.replaceChildren();
    for(const p of role.portraits||[]){if(!urls.has(p.id.replace(/^custom:/,'')))continue;const img=document.createElement('img');img.src=p.src;img.alt=p.label;list.append(img);}
  };
  host.addEventListener('input',event=>event.stopPropagation());
  for(const kind of ['avatar','portrait']){
    const input=host.querySelector(`[data-media-file=${kind}]`);
    input.onchange=async()=>{const roleId=id,file=input.files?.[0];input.value='';if(!file)return;
      try{validateMediaFile(file);const bitmap=await createImageBitmap(file);const {width,height}=bitmap;bitmap.close();if(!width||!height||width>8192||height>8192||width*height>24000000)throw Error('图片尺寸过大，请缩小后再试。');
        const key=`${roleId}:${kind}`,previous=drafts.get(key);if(previous)URL.revokeObjectURL(previous.url);
        drafts.set(key,{blob:file,url:URL.createObjectURL(file),expectedAvatar:getSource().customRoleAssets?.[roleId]?.avatar?.id||null,metadata:{id:`role-asset-${kind}-${crypto.randomUUID()}`,kind,roleId,label:file.name.replace(/\.[^.]+$/,'').slice(0,60),name:file.name.slice(0,160),type:file.type,size:file.size,width,height,createdAt:new Date().toISOString()}});
        feedback.textContent='预览已准备好，点击保存后生效。';render();
      }catch(error){feedback.textContent=error.message;}
    };
    host.querySelector(`[data-media-save=${kind}]`).onclick=async()=>{
      if(busy)return;const roleId=id,key=`${roleId}:${kind}`,draft=drafts.get(key);if(!draft)return;busy=true;render();feedback.textContent='正在保存图片…';
      try{const saved=await saveRoleMedia({storage,locks,catalog,repository,metadata:draft.metadata,blob:draft.blob,expectedAvatar:draft.expectedAvatar});
        urls.set(draft.metadata.id,draft.url);drafts.delete(key);if(kind==='avatar')expectedAvatar=draft.metadata.id;await onSaved(saved,draft.metadata);
        feedback.textContent=`已保存到本浏览器。原素材保留。${saved.warning||''}`;
      }catch(error){feedback.textContent=`未保存：${error.message} 预览保留，可以重试。`;}
      finally{busy=false;render();}
    };
  }
  host.querySelector('[data-media-cancel]').onclick=()=>{if(busy)return;for(const kind of ['avatar','portrait']){const key=`${id}:${kind}`,draft=drafts.get(key);if(draft){URL.revokeObjectURL(draft.url);drafts.delete(key);}}feedback.textContent='预览已取消，已保存图片未改变。';render();};
  return {open(roleId){id=roleId;expectedAvatar=getSource().customRoleAssets?.[id]?.avatar?.id||null;feedback.textContent='';render();},pending:()=>busy||drafts.size>0};
}
