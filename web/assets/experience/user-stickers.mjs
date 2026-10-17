import {stickerFor} from './sticker-catalog.mjs';
// A portable text envelope keeps semantics even on text-only providers and history exports.
// This vocabulary describes a present expression, never a biography or lasting preference.
const extra=Object.freeze([
 {id:'cheer',label:'好耶',meaning:'表达此刻开心、赞同或庆祝',file:'cheer'},
 {id:'thanks',label:'谢谢你',meaning:'表达此刻感谢对方',file:'thanks'},
 {id:'hug',label:'抱抱',meaning:'表达此刻想得到温柔陪伴或送出安慰',file:'hug'},
 {id:'question',label:'没听懂',meaning:'表达此刻困惑，希望解释得更清楚',file:'question'},
 {id:'tired',label:'有点累',meaning:'表达此刻疲倦，想放慢节奏',file:'tired'},
 {id:'tea',label:'歇一会',meaning:'表达此刻想一起休息、轻松聊聊',file:'tea'}
]);
const roleMoods=[['smile','开心','表达此刻开心'],['comfort','陪陪我','表达此刻需要陪伴'],['thinking','让我想想','表达此刻正在思考'],['surprised','哇','表达此刻惊讶'],['shy','有点害羞','表达此刻害羞'],['sleepy','晚安','表达此刻想休息或道别']];
export function userStickerOptions(roleId){
 return [...extra.map(s=>({...s,src:`/assets/experience/media/user-stickers-v1/${s.file}.png`})),
 ...roleMoods.flatMap(([mood,label,meaning])=>{const s=stickerFor(roleId,mood);return s?[{id:`role-${mood}`,label,meaning,src:s.src,...(s.sprite?{sprite:s.sprite}:{})}]:[];})];
}
export function userStickerText(roleId,id){
 const sticker=userStickerOptions(roleId).find(s=>s.id===id);if(!sticker)throw Error('表情不存在，请重新选择。');
 return `[[user-sticker:${id}]]\n【用户表情：${sticker.label}】${sticker.meaning}。这只是一条即时表情，不代表真实经历、长期偏好或关系授权。`;
}
export function parseUserSticker(text,roleId){
 const id=/^\[\[user-sticker:([a-z-]+)\]\]\n/.exec(String(text||''))?.[1];
 if(!id)return null;
 const sticker=userStickerOptions(roleId).find(s=>s.id===id);
 return sticker&&text===userStickerText(roleId,id)?sticker:null;
}
