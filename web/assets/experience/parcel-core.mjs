// Fictional shopping parcels use the selected world's clock. Old instant
// purchases retain their original inventory and receipts.
export function shippingRequest(value){
 if(value==null)return null;
 if(!value||!['normal','special'].includes(value.mode)||!Number.isFinite(Date.parse(value.worldUtc))||!Number.isFinite(Date.parse(value.dueUtc))||Date.parse(value.dueUtc)-Date.parse(value.worldUtc)<900000||Date.parse(value.dueUtc)-Date.parse(value.worldUtc)>86400000)throw Error('配送时间须晚于现在至少15分钟，且在24小时内。');
 return {mode:value.mode,worldUtc:value.worldUtc,dueUtc:value.dueUtc};
}
export function settleParcels(source,worldUtc,mode='normal'){
 if(!Number.isFinite(Date.parse(worldUtc)))throw Error('世界时间尚未读取，快递仍保留。');
 const due=Object.values(source.shoppingParcels||{}).filter(p=>p.mode===mode&&p.status==='shipping'&&Date.parse(p.dueUtc)<=Date.parse(worldUtc));
 if(!due.length)return {state:source,arrivals:[]};
 const next=structuredClone(source);next.inventory||={};
 for(const parcel of due){const owned=next.inventory[parcel.giftId]||0;if(!Number.isSafeInteger(owned)||owned<0||!Number.isSafeInteger(parcel.quantity)||parcel.quantity<1||!Number.isSafeInteger(owned+parcel.quantity))throw Error('快递库存记录异常，物品仍保留。');next.inventory[parcel.giftId]=owned+parcel.quantity;next.shoppingParcels[parcel.id]={...parcel,status:'delivered',arrivedUtc:parcel.dueUtc};if(next.shopOperations?.[parcel.id])next.shopOperations[parcel.id].parcelStatus='delivered';for(const receipt of next.shopLog||[])if(receipt.id===parcel.id)receipt.parcelStatus='delivered';}
 return {state:next,arrivals:due};
}
