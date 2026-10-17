const labels={saved:'历史礼物记录已保存。',queued:'礼物已送出，回应会自动处理。',generating:'角色正在自主回应…',waiting_configuration:'角色已收到礼物；模型连接尚未配置，配置后会自动回应。',done:'角色已自主回应。',failed:'模型回应未完成，礼物记录保留。',interrupted:'上次生成被中断，结果未知；未自动重复调用。',stale:'原对话已关闭，礼物记录保留。',superseded:'你已发送新消息，未把过时的回应插入聊天。'};
export function giftResponseState(event){
 const status=event?.status||'saved';return {text:labels[status]||'礼物记录已保存。',action:status==='done'&&event.replyId?'open':['failed','interrupted'].includes(status)?'retry':null,label:status==='done'?'查看回应':'重试角色回应'};
}
export function updateGiftResponseView(button,event,{open,retry,onError=()=>{}}={}){
 let status=button.parentElement.querySelector('[data-gift-response-status]');if(!status){status=document.createElement('p');status.dataset.giftResponseStatus='';status.setAttribute('role','status');button.before(status);}const view=giftResponseState(event);status.textContent=view.text;button.hidden=!view.action;button.disabled=false;button.textContent=view.label;button.onclick=view.action?async()=>{button.disabled=true;try{await (view.action==='open'?open:retry)?.(event);}catch(e){onError(e.message);}finally{button.disabled=false;}}:null;
}
