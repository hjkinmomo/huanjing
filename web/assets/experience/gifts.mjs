import '../shared-state.js';
import '../companion_core.js';
import '../gift-catalog.js';

const shared = globalThis.HermesSharedState;
const core = globalThis.HermesCompanionCore;
export const giftCatalog = globalThis.HermesGiftCatalog.gifts;
export const tiers = globalThis.HermesGiftCatalog.tiers;
export const readCompanion = storage => shared.read(storage).state;
export const tierFor = score => [...tiers].reverse().find(tier => score >= tier.min) || tiers[0];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function ownedGifts(state) {
  return Object.entries(state.inventory || {}).filter(([,n]) => count(n)>0).map(([id,n]) => ({
    ...(giftCatalog.find(gift => gift.id === id) || {id,name:'未识别物品',rarityLabel:'保留物品',unknown:true}), count:n
  }));
}
export function giftPreview(state, gift, roleId, at = new Date().toISOString()) {
  const favorite = gift.favoriteRoles?.includes(roleId) || false;
  const base = Number(gift.affection || 0), bonus = favorite ? Number(gift.favoriteBonus || 0) : 0;
  const stageBonus = favorite && gift.rarity === 'stage' ? Number(gift.stageBonus || 0) : 0;
  return {base, bonus, stageBonus, favorite, requested:base+bonus+stageBonus,
    ...core.relationshipDelta({roleId,sourceType:'gift',sourceId:gift.id,requested:base+bonus+stageBonus,ledger:state.relationshipLedger,now:at})};
}
export function giftReason(reason) {
  return ({accepted:'已计入关系记录',cooldown:'同一礼物冷却中，本次好感不增加',daily_cap:'今日赠礼成长已达上限，本次好感不增加'})[reason] || '本次好感不增加';
}
export function prepareGift(source, {giftId, role, operationId, at,note='',automaticResponse}) {
  if (!role?.id || !role.name || !/^[A-Za-z0-9_.:-]{1,80}$/.test(role.id)) throw new Error('没有可赠送的角色。');
  if (!operationId || !/^[A-Za-z0-9_-]{8,100}$/.test(operationId) || !Number.isFinite(Date.parse(at))) throw new Error('赠礼记录无效。');
  if(typeof note!=='string'||note.length>300)throw new Error('礼物留言最多 300 字。');
  const prior = source.giftOperations?.[operationId];
  if (prior) {
    if (prior.role !== role.id || prior.giftId !== giftId) throw new Error('赠礼请求冲突，请重新选择。');
    return {state:source,receipt:prior,duplicate:true};
  }
  const gift = giftCatalog.find(item => item.id === giftId);
  if (!gift) throw new Error('这个物品尚不支持赠送，原库存已保留。');
  if (!count(source.inventory?.[giftId])) throw new Error('这件礼物已没有库存，请重新选择。');
  const score = source.affection?.[role.id] ?? 0;
  if (!Number.isFinite(score) || score < 0 || (source.giftLog && !Array.isArray(source.giftLog)) || (source.relationshipLedger && !Array.isArray(source.relationshipLedger))) throw new Error('关系记录格式异常，未扣除礼物。');
  const next = structuredClone(source), preview = giftPreview(source,gift,role.id,at);
  next.inventory = {...next.inventory,[giftId]:source.inventory[giftId]-1};
  if (!next.inventory[giftId]) delete next.inventory[giftId];
  next.affection = {...next.affection,[role.id]:score+preview.accepted};
  const tier = tierFor(next.affection[role.id]);
  let remainder = preview.accepted;
  const base = Math.min(remainder,preview.base); remainder -= base;
  const bonus = Math.min(remainder,preview.bonus); remainder -= bonus;
  const stage = Math.min(remainder,preview.stageBonus);
  const receipt = {id:`gift-${operationId}`,operationId,giftId,giftName:gift.name,giftImage:gift.image,
    role:role.id,roleName:role.name,affection:preview.accepted,totalAffection:preview.accepted,
    baseAffection:base,favoriteBonus:bonus,stageBonus:stage,requestedAffection:preview.requested,
    relationshipReason:preview.reason,relationshipReasonLabel:giftReason(preview.reason),
    tierId:tier.id,tierLabel:tier.label,at,source:'experience',scoreAfter:next.affection[role.id],
    ...(automaticResponse?{automaticResponse:structuredClone(automaticResponse)}:{}),note:note.trim(),reactionTitle:`已赠送${gift.name}`,reactionBody:`已将${gift.name}赠送给${role.name}。`,
    stageEffectId:stage ? gift.stageEffect || '' : '',stageEffectLabel:stage ? gift.stageEffectLabel || '' : ''};
  next.relationshipLedger = [{id:`relationship-${operationId}`,roleId:role.id,sourceType:'gift',sourceId:giftId,
    requested:preview.requested,accepted:preview.accepted,reason:preview.reason,label:`赠送${gift.name}`,at},...(next.relationshipLedger || [])];
  next.giftLog = [receipt,...(next.giftLog || [])];
  next.giftOperations = {...next.giftOperations,[operationId]:receipt};
  // Facts only: no scripted dialogue, invented emotion, or copying another role's memory.
  return {state:next,receipt,duplicate:false};
}
export async function sendOwnedGift(storage, locks, request) {
  return shared.exclusive(locks, async () => {
    if(request.beforeCommit)await request.beforeCommit(request);
    const snapshot = shared.read(storage), result = prepareGift(snapshot.state,request);
    if (result.duplicate) return {...result,warning:''};
    const committed={...result,...shared.commit(storage,snapshot,result.state,request.at)};
    if(request.afterCommit)try{await request.afterCommit(committed);}catch(e){committed.replySyncError=e.message;}
    return committed;
  });
}
