const STATUS={scheduled:'已预约',pending:'等待配送',preparing:'准备中',delivered:'已送达',cancelled:'已取消',waiting:'等待收件人',travelling:'正在路上',arrived:'已抵达',working:'进行中',complete:'已完成，可领取报酬',claimed:'报酬已到账'};
export function phoneNotificationScope(s){return (s.personaMode||'normal')+':'+(s.worldLife?.identityBank?.active?.id||'unnamed')+':'+(s.dataEpoch||'unstarted');}
export function phoneNotificationCandidates(s,groups={}){
 const out=[],mode=s.personaMode||'normal',life=s.worldLife||{};
 const add=(key,app,title,body,extra={})=>out.push({key,app,title,body,...extra});
 for(const r of s.roleRoster||[])if(r.phoneUnread&&r.online!==false)add('chat:'+r.id,'chat',r.name+'发来消息','有新的微聊消息，点按查看。',{roleId:r.id});
 for(const g of groups.groups||[])if(g.unread>0)add('group:'+g.id,'groups',g.title+' · '+g.unread+'条未读',g.lastMessage?g.lastMessage.speaker_name+'：'+g.lastMessage.text:'微聊群有新消息',{groupId:g.id});
 for(const o of s.deliveries||[]){const state=o.waitingForRecipient?'waiting':o.status||'scheduled';add('delivery:'+o.id,'delivery','美兔 · '+(STATUS[state]||state),(o.foodName||'外卖')+' · '+(o.placeName||o.roleName||'所选收件处'));}
 for(const trip of life.transport?.trips||[])if(trip.status!=='quoted')add('travel:'+trip.id,'travel','轻途出行 · '+(STATUS[trip.status]||trip.status),(trip.methodName||'出行')+' · '+(trip.placeName||'所选目的地'));
 for(const job of life.workJobs||[])add('work:'+job.id,'work','兼职 · '+(STATUS[job.status]||job.status),job.name+(job.reward!=null?' · '+job.reward+'金币':''));
 for(const parcel of s.shoppingParcels||[])if(!parcel.mode||parcel.mode===mode)add('shop:'+parcel.id,'shop','淘乐乐 · '+(STATUS[parcel.status]||parcel.status||'订单更新'),parcel.giftName||'商品物流有更新');
 return out.map(item=>({...item,body:String(item.body).slice(0,220),signature:JSON.stringify([item.title,item.body])}));
}
export function mergePhoneNotifications(prior={},candidates=[],now=Date.now()){
 const active=new Set(candidates.map(v=>v.key)),dismissed=Object.fromEntries(Object.entries(prior.dismissed||{}).filter(([k])=>active.has(k)));
 const items=new Map((prior.items||[]).map(v=>[v.key,v]));
 // Reading a conversation removes its live unread card. Other receipts remain
 // available until explicitly cleared, with a bounded history.
 for(const [key]of items)if((key.startsWith('chat:')||key.startsWith('group:'))&&!active.has(key))items.delete(key);
 for(const candidate of candidates){
  if(dismissed[candidate.key]===candidate.signature)continue;
  const current=items.get(candidate.key);
  if(current?.signature===candidate.signature)continue;
  delete dismissed[candidate.key];items.set(candidate.key,{...candidate,observedAt:now});
 }
 const ordered=[...items.values()].sort((a,b)=>b.observedAt-a.observedAt);
 for(const item of ordered.slice(80))dismissed[item.key]=item.signature;
 return {items:ordered.slice(0,80),dismissed};
}
export function dismissPhoneNotifications(feed,keys){
 const selected=new Set(keys),dismissed={...feed.dismissed};
 for(const item of feed.items)if(selected.has(item.key))dismissed[item.key]=item.signature;
 return {items:feed.items.filter(v=>!selected.has(v.key)),dismissed};
}
