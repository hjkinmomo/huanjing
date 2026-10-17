import '../shared-state.js';
import {ownedGifts} from './gifts.mjs';
import {balance,games} from './leisure-core.mjs';
const shared=globalThis.HermesSharedState;
export const IDENTITY_FIELDS=Object.freeze(['name','avatar','shareNameWithCharacters']);
export function userIdentity(source){
 const value=source?.userIdentity||{};
 return {name:typeof value.name==='string'?value.name.slice(0,60):'',avatar:validUserAvatar(value.avatar)?value.avatar:'',shareNameWithCharacters:value.shareNameWithCharacters===undefined?true:value.shareNameWithCharacters===true};
}
export function validUserAvatar(value){return typeof value==='string'&&value.length<=400000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);}
export function publicUserName(source){const identity=userIdentity(source);return identity.shareNameWithCharacters?identity.name.trim():'';}
export function prepareUserIdentity(source,patch,expected,at){
 if(!patch||!IDENTITY_FIELDS.every(key=>Object.hasOwn(patch,key))||!Number.isFinite(Date.parse(at)))throw Error('用户资料格式不完整。');
 if(typeof patch.name!=='string'||Array.from(patch.name).length>60||/[\u0000-\u001f\u007f]/.test(patch.name))throw Error('名字最多 60 字，请不要使用换行或控制符。');
 if(patch.avatar!==''&&!validUserAvatar(patch.avatar))throw Error('头像格式无效，请重新上传 PNG、JPG 或 WebP。');
 if(typeof patch.shareNameWithCharacters!=='boolean')throw Error('名字分享设置无效。');
 const current=userIdentity(source);
 if(!expected||IDENTITY_FIELDS.some(key=>current[key]!==expected[key]))throw Error('用户资料已在另一个窗口修改。草稿已保留，请重新读取后再保存。');
 const next=structuredClone(source);
 next.userIdentity={...source.userIdentity,name:patch.name.trim(),avatar:patch.avatar,shareNameWithCharacters:patch.shareNameWithCharacters,updatedAt:at};
 return next;
}
export async function saveUserIdentity(storage,locks,patch,expected,at=new Date().toISOString()){
 return shared.exclusive(locks,()=>{const snapshot=shared.read(storage);return shared.commit(storage,snapshot,prepareUserIdentity(snapshot.state,patch,expected,at),at);});
}
export function userOverview(source){
 const records=source.leisure?.records??[],shop=source.shopLog??[],gifts=source.giftLog??[];
 if(![records,shop,gifts].every(Array.isArray))throw Error('活动记录格式异常，原资料保留。');
 const inventory=ownedGifts(source),byGame=new Map();
 for(const record of records){
  if(!record||typeof record.kind!=='string')continue;
  const entry=byGame.get(record.kind)||{kind:record.kind,name:games[record.kind]?.name||record.kind,count:0,best:null};
  entry.count++;
  if(Number.isFinite(record.score)&&(entry.best===null||record.score>entry.best))entry.best=record.score;
  byGame.set(record.kind,entry);
 }
 const history=[...records.map(r=>({...r,type:'game'})),...shop.map(r=>({...r,type:'purchase'})),...gifts.map(r=>({...r,type:'gift'}))].filter(r=>r&&typeof r==='object').sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
 return {identity:userIdentity(source),coins:balance(source),inventory,itemCount:inventory.reduce((sum,item)=>sum+item.count,0),gameCount:records.length,scores:[...byGame.values()],history};
}

// Avatar uploads are resized by the browser before the single canonical identity is saved.
// They are never sent to a model and never used as an executable/remote URL.
export async function avatarFromFile(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024||file.size===0)throw Error('请选择 5 MB 以内的 PNG、JPG 或 WebP 图片。');
 const url=URL.createObjectURL(file),image=new Image();
 try{
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('图片无法解码，请换一张图片。'));image.src=url;});
  if(!image.naturalWidth||!image.naturalHeight)throw Error('图片尺寸无效。');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=320;
  const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂时无法处理图片。');
  context.fillStyle='#f5eee8';context.fillRect(0,0,320,320);
  const side=Math.min(image.naturalWidth,image.naturalHeight);
  context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,320,320);
  const avatar=canvas.toDataURL('image/jpeg',.86);if(!validUserAvatar(avatar))throw Error('头像处理后仍过大，请换一张图片。');
  return avatar;
 }finally{image.src='';URL.revokeObjectURL(url);}
}
