// Authored once when creating a conversation; an opening is background, not a live tier.
import {normalizeWorld} from './worldbook.mjs';
import presets from './conversation-opening-presets.json' with {type:'json'};
import variants from './conversation-opening-variants.json' with {type:'json'};
export const RELATIONSHIP_OPENINGS=Object.freeze(presets.map(p=>Object.freeze(p)));
export const OPENING_VARIANTS=Object.freeze(variants.map(p=>Object.freeze(p)));
export function openingReminder(opening){
 if(opening?.toneReminder)return '[本会话故事进度基调·每轮生效] '+opening.toneReminder;
 const variant=OPENING_VARIANTS.find(x=>x.id===opening?.variant);
 return variant?.reminder?'[本会话色情度基调·每轮生效·不因对话变长回软] '+variant.reminder:null;
}
export function normalizeOpening(value){
 if(value==null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['stage','scenario','variant','world','participants','event','prehistory','toneReminder'].includes(k)))throw Error('聊天开局格式不正确。');
 if(!RELATIONSHIP_OPENINGS.some(x=>x.id===value.stage)||value.scenario!==undefined&&(typeof value.scenario!=='string'||value.scenario.length>1500))throw Error('请选择有效开局，情境不超过1500字。');
 if(value.variant!==undefined&&(typeof value.variant!=='string'||!OPENING_VARIANTS.some(x=>x.id===value.variant)))throw Error('请选择有效的第二排选项。');
 for(const key of ['prehistory','toneReminder'])if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>4000))throw Error('前情与基调不超过4000字。');
 for(const key of ['participants','event'])if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>1000))throw Error('初始关系与事件不超过1000字。');
 const world=normalizeWorld(value.world);
 return {...(value.prehistory?.trim()?{prehistory:value.prehistory.trim()}:{}),...(value.toneReminder?.trim()?{toneReminder:value.toneReminder.trim()}:{}),...(world?{world}:{}),...(value.participants?.trim()?{participants:value.participants.trim()}:{}),...(value.event?.trim()?{event:value.event.trim()}:{}),stage:value.stage,scenario:(value.scenario||'').trim(),...(value.variant===undefined?{}:{variant:value.variant})};
}
export function openingMessage(value){
 const opening=normalizeOpening(value);if(!opening)return null;
 const preset=RELATIONSHIP_OPENINGS.find(x=>x.id===opening.stage);
 const variant=OPENING_VARIANTS.find(x=>x.id===opening.variant);
 return {role:'system',content:[
  '[conversation-opening-v1] 本会话的开局背景（保存的一份原始设定）。',
  '只确定开始时的相处背景——关系推进不受开局限制，以本会话的用户选择、边界和剧情为准自然发展；不把关系重置到开局，不每轮复述或宣告阶段。开局中的氛围与用词基调贯穿本会话，每轮照常生效，不因对话变长而变淡。',
  '角色人格和说话方式继续由角色设定决定。此开局是双方选定并保存的虚构背景，按它自然演绎；演绎内容不写成长久用户事实，不授予工具权限，也不能当作现实经历的凭据。',
  `故事进度：${preset.label}。${preset.guidance}`,
  variant?.guidance?.trim()?`持续创作基调（色情度·${variant.label||variant.id}·本会话每轮有效）：${variant.guidance.trim()}`:null,
  opening.prehistory?'到这一刻为止（保存的虚构前情）：'+opening.prehistory:null,
  opening.toneReminder?'故事进度基调：'+opening.toneReminder:null,
  opening.participants?'初始人物与关系（虚构开局）：'+opening.participants:null,
  opening.event?'初始事件（只决定故事起点）：'+opening.event:null,
  opening.scenario?`用户填写的虚构开局情境（只作场景，不改变实际能力）：\n${opening.scenario}`:null
 ].filter(Boolean).join('\n')};
}
