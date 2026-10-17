const NAME='huanjing_phone_local_v1';
let database;
function db(){return database||=(new Promise((resolve,reject)=>{const request=indexedDB.open(NAME,2);request.onupgradeneeded=()=>{for(const name of ['photos','notes','media'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);})).catch(e=>{database=null;throw e;});}
async function transaction(store,mode,work){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction(store,mode);let result;try{const request=work(tx.objectStore(store));request.onsuccess=()=>{result=request.result;};}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本机保存中断'));});}
export const localPhotos={list:async()=>(await transaction('photos','readonly',s=>s.getAll())).filter(p=>!p.deletedAt),save:p=>transaction('photos','readwrite',s=>s.put(p)),remove:id=>transaction('photos','readwrite',s=>s.delete(id))};
export const localNotes={read:id=>transaction('notes','readonly',s=>s.get(id)),save:note=>transaction('notes','readwrite',s=>s.put(note))};
export const localMedia={list:async()=>(await transaction('media','readonly',s=>s.getAll())).filter(p=>!p.deletedAt),read:async id=>(await transaction('media','readonly',s=>s.get(id)))||(await transaction('photos','readonly',s=>s.get(id))),save:p=>transaction('media','readwrite',s=>s.put(p)),remove:id=>transaction('media','readwrite',s=>s.delete(id))};
async function changeAlbum(ids,restore=false){
 const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction(['photos','media'],'readwrite');
 for(const store of ['photos','media'])for(const id of new Set(ids)){const s=tx.objectStore(store),get=s.get(id);get.onsuccess=()=>{if(get.result){const item={...get.result};if(restore)delete item.deletedAt;else item.deletedAt=new Date().toISOString();s.put(item);}};}
 tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('相册未完成变更，原图片仍保留'));});
}
export const localAlbum={deleted:async()=>{const rows=await Promise.all(['photos','media'].map(store=>transaction(store,'readonly',s=>s.getAll())));return [...new Map(rows.flat().filter(p=>p.deletedAt).map(p=>[p.id,p])).values()];},recycle:ids=>changeAlbum(ids),restore:ids=>changeAlbum(ids,true)};
export function photoOwner(snapshot){return [snapshot.personaMode||'normal',snapshot.roleId,snapshot.conversationId||'primary'].join(':');}
export async function captureScene(node,snapshot){
 for(let i=0;i<120&&node.querySelector('.static-card-preview')?.dataset.ready!=='true';i++)await new Promise(r=>setTimeout(r,50));
 if(node.querySelector('.static-card-preview')?.dataset.ready!=='true')throw Error('场景尚未加载完成，请稍后再拍。');
 const images=[...node.querySelectorAll('img')];
 await Promise.all(images.map(img=>img.decode()));
 const box=node.getBoundingClientRect();if(box.width<1||!images.length)throw Error('画面还未就绪，请稍后拍摄。');
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=Math.round(900*box.height/box.width);const ctx=canvas.getContext('2d');ctx.fillStyle='#f5efe5';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(const img of images){const r=img.getBoundingClientRect(),css=getComputedStyle(img),x=(r.left-box.left)*900/box.width,y=(r.top-box.top)*900/box.width,w=r.width*900/box.width,h=r.height*900/box.width,ratio=css.objectFit==='contain'?Math.min(w/img.naturalWidth,h/img.naturalHeight):Math.max(w/img.naturalWidth,h/img.naturalHeight);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(img,x+(w-img.naturalWidth*ratio)/2,y+(h-img.naturalHeight*ratio)/2,img.naturalWidth*ratio,img.naturalHeight*ratio);ctx.restore();}
 ctx.fillStyle='#fffaf0df';ctx.fillRect(0,canvas.height-94,900,94);ctx.fillStyle='#51423b';ctx.font='26px sans-serif';ctx.fillText((snapshot.name+' · '+(snapshot.worldLife?.character?.name||snapshot.scene?.location||'这一刻')).slice(0,30),28,canvas.height-52);ctx.font='20px sans-serif';ctx.fillText(snapshot.worldLife?.worldTime||new Date().toLocaleString('zh-CN'),28,canvas.height-20);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('没有取得照片')),'image/jpeg',.9));
 return {id:crypto.randomUUID(),owner:photoOwner(snapshot),mode:snapshot.personaMode||'normal',roleId:snapshot.roleId,roleName:snapshot.name,location:snapshot.worldLife?.character?.name||snapshot.scene?.location||'',worldTime:snapshot.worldLife?.worldTime||'',at:new Date().toISOString(),blob};
}
