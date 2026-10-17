import '../shared-state.js';
import catalogue from './food-catalog.json' with {type:'json'};
export const DELIVERY_MENU=Object.freeze(catalogue.map(p=>Object.freeze(p)));
const shared=globalThis.HermesSharedState;
export function prepareDelivery(source,request){
 const {operationId,foodId,role,placeName,sessionId,at}=request,food=DELIVERY_MENU.find(p=>p.id===foodId);
 if(!food||!role?.id||typeof role.name!=='string'||typeof sessionId!=='string'||!sessionId||sessionId.length>120||typeof placeName!=='string'||!placeName.trim()||placeName.length>160||!Number.isFinite(Date.parse(at))||!/^[\w-]{8,100}$/.test(operationId||''))throw Error('送达地点或餐品无效，未扣款。');
 const previous=source.deliveryOperations?.[operationId];
 if(previous){if(previous.foodId!==foodId||previous.roleId!==role.id||previous.sessionId!==sessionId||previous.placeName!==placeName)throw Error('外卖订单冲突。');return {state:source,receipt:previous,duplicate:true};}
 if(source.deliveryLog!==undefined&&!Array.isArray(source.deliveryLog)||source.deliveryOperations!==undefined&&(!source.deliveryOperations||typeof source.deliveryOperations!=='object'||Array.isArray(source.deliveryOperations)))throw Error('订单记录异常，未扣款。');
 const coins=source.coins===undefined?520:source.coins;
 if(!Number.isSafeInteger(coins)||coins<0)throw Error('金币记录异常，未扣款。');
 if(coins<food.price)throw Error('金币不足，未下单。');
 const next=structuredClone(source),receipt={id:operationId,foodId,foodName:food.name,roleId:role.id,roleName:role.name,sessionId,placeName,total:food.price,at,source:'fictional-meal-v2'};
 next.coins=coins-food.price;next.deliveryOperations={...next.deliveryOperations,[operationId]:receipt};next.deliveryLog=[receipt,...(next.deliveryLog||[])].slice(0,100);
 return {state:next,receipt,duplicate:false};
}
export async function orderDelivery(storage,locks,request){return shared.exclusive(locks,()=>{const snap=shared.read(storage);if(snap.recovered)throw Error('请先恢复资料后下单。');const result=prepareDelivery(snap.state,request);return result.duplicate?result:{...result,...shared.commit(storage,snap,result.state,request.at)};});}
