// Never persist a secret, expose a provider error, or infer model connectivity here.
export function createCredentialWriter(request,getSlot=()=> 'chat') {
  let busy=false;
  return {
    get busy(){return busy;},
    async save(secret) {
      if(busy)return {ok:false,message:'正在保存，请稍候。'};
      if(typeof secret!=='string'||!secret.trim()||secret.length>8192)return {ok:false,message:'请输入有效的密钥（不超过 8192 字符）。'};
      busy=true;
      try {
        const slot=getSlot();
        const result=await request('/v1/credentials',{slot,secret:secret.trim()},15000);
        if(result?.ok!==true||result?.slot!==slot||result?.configured!==true)return {ok:false,message:'服务没有确认保存结果。请重新检查凭据状态，勿连续重复提交。'};
        return {ok:true,message:'聊天凭据已保存到本机加密库。实际连接以模型回复为准。'};
      } catch {
        return {ok:false,message:'未能确认凭据保存结果。请检查本机服务并重新检查状态；已有凭据不会由本页面主动删除。'};
      } finally {busy=false;}
    },
  };
}

export function mountCredentialSettings(host,request,onSaved,getSlot) {
  const writer=createCredentialWriter(request,getSlot);
  const input=host.querySelector('#chat-secret');
  const button=host.querySelector('button[type="submit"]');
  const feedback=host.querySelector('[role="status"]');
  host.addEventListener('submit',async event=>{
    event.preventDefault();
    if(writer.busy)return;
    // Existing credential replacement requires an explicit choice within this form.
    if(!host.querySelector('#replace-chat-credential').checked){feedback.textContent='请先确认保存或替换本机聊天凭据。';return;}
    button.disabled=true;input.disabled=true;feedback.textContent='正在保存到本机…';
    const result=await writer.save(input.value);
    input.value='';input.disabled=false;button.disabled=false;
    host.querySelector('#replace-chat-credential').checked=false;
    feedback.textContent=result.message;
    if(result.ok)await onSaved();
  });
  return {get busy(){return writer.busy;},clear(){input.value='';host.querySelector('#replace-chat-credential').checked=false;}};
}
