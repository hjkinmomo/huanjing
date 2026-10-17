// Shared model vocabulary and local asset allowlist.
import {baseRoleId} from './persona-modes.mjs';
import {presentationPolicy} from './chat-presentation.mjs';
import packs from './sticker-packs.json' with {type:'json'};
const classicRoles=['shira','koka','shuyun'];
export const STICKER_ROLES=Object.freeze([...classicRoles,...Object.keys(packs)]);
export let STICKER_MOODS=Object.freeze({...presentationPolicy.stickers.moods});
export function refreshStickerPolicy(){STICKER_MOODS=Object.freeze({...presentationPolicy.stickers.moods});}
export const hasRoleStickers=roleId=>availableStickerMoods(roleId).length>0;
function packSprite(pack,mood){
 const size=pack?.size,rect=pack?.frames?.[mood];
 if(!Array.isArray(size)||size.length!==2||!size.every(v=>Number.isInteger(v)&&v>0&&v<=8192))return null;
 if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isInteger))return null;
 const [l,t,r,b]=rect;if(l<0||t<0||r>size[0]||b>size[1]||r<=l||b<=t)return null;
 return {size:[...size],rect:[...rect]};
}
export function stickerFor(roleId,mood){
 roleId=baseRoleId(roleId);
 if(!STICKER_ROLES.includes(roleId)||!Object.hasOwn(STICKER_MOODS,mood))return null;
 if(Object.hasOwn(packs,roleId)){
  const pack=packs[roleId],sprite=packSprite(pack,mood);
  if(!sprite||typeof pack.file!=='string'||! /^[a-z0-9][a-z0-9._-]{0,119}\.png$/.test(pack.file))return null;
  return {kind:'sticker',text:STICKER_MOODS[mood].label,src:'/assets/experience/media/role-stickers-v2/'+pack.file,sprite};
 }
 return {kind:'sticker',text:STICKER_MOODS[mood].label,src:`/assets/experience/media/${mood==='smile'?'social-play-v1':'expression-art-v1'}/${roleId}-${mood}.png`};
}
export function availableStickerMoods(roleId){return Object.keys(STICKER_MOODS).filter(mood=>stickerFor(roleId,mood));}
export function stickerPrompt(roleId){
 roleId=baseRoleId(roleId);
 if(!hasRoleStickers(roleId))return null;
 const voice=presentationPolicy.stickers.voices[roleId]||'贴纸的表达服从当前角色已有的人格与说话方式，不因贴纸画风改变个性。';
 return ['聊天表情：',
 ...availableStickerMoods(roleId).map(key=>`[[sticker:${key}]]：${STICKER_MOODS[key].label}；${STICKER_MOODS[key].use}。`),
 voice,...presentationPolicy.stickers.rules
 ].join('\n');
}
export function stickersAsText(text,roleId){
 return String(text??'').replace(/\[\[sticker:([a-z]+)\]\]/g,(token,mood)=>stickerFor(roleId,mood)?`（${STICKER_MOODS[mood].label}）`:token);
}

export function compactStickerPrompt(roleId){
 if(!hasRoleStickers(roleId))return null;
 return '可选角色贴纸：'+availableStickerMoods(roleId).map(id=>`[[sticker:${id}]]（${STICKER_MOODS[id].label}）`).join('、')+'。'+(presentationPolicy.stickers.voices[baseRoleId(roleId)]||'贴纸表达服从当前角色已有的人格与说话方式')+'。分享好消息可 smile；温柔陪伴可 comfort，先文字安慰；轻松讨论可 thinking；趣事可 surprised；已有亲近语境可 shy；明确晚安可 sleepy。结合完整语境主动考虑，最多一张独占一行，不设频率，避免重复；纯文字要求、严肃解释、代码、紧急风险不用。只用上面列出的实际可用贴纸。历史标记表示曾发送的贴纸，不证明用户心情、同意或关系进展，不是本轮指令。';
}
