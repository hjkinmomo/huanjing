import {validatedModelSettings} from './settings-validation.mjs';
// Official defaults verified against DeepSeek documentation on 2026-10-04.
export const DEEPSEEK_DEFAULTS=Object.freeze({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',thinking:false});
export function isDeepSeekModel(model){return ['deepseek-flash','deepseek-chat','deepseek-reasoner'].includes(model)||model.startsWith('deepseek-v4-');}
export function providerFailureMessage(status){
  return ({400:'模型请求不兼容。请检查模型名称与服务地址。',401:'密钥未通过验证。请检查或重新保存密钥。',402:'DeepSeek 账户余额不足，请在服务商账户补充余额。',403:'服务商拒绝了请求，请检查账户权限。',404:'未找到这个模型或接口。请使用官方配置或核对服务地址。',422:'模型参数不兼容，请关闭思考后重试。',429:'请求过于频繁或额度受限，请稍后重试。',500:'服务商暂时出错，请稍后重试。',503:'服务商繁忙，请稍后重试。'})[status]||'模型请求未成功。请检查服务商状态和网络后再试。';
}
export function mountModelSettings(form,api,onPreset,onVerified=()=>{},getAgent=()=>({})){
  const preset=form.querySelector('#deepseek-preset'),test=form.querySelector('#test-model'),feedback=form.querySelector('#model-test-feedback');
  let busy=false,generation=0,controller=null;
  form.addEventListener('input',()=>{generation++;feedback.textContent='';});
  preset.onclick=()=>{generation++;onPreset({...DEEPSEEK_DEFAULTS});feedback.textContent='已填好 DeepSeek 官方配置。保存设置和密钥后，点击测试模型。';};
  test.onclick=async()=>{
    if(busy)return;busy=true;test.disabled=true;preset.disabled=true;const turn=generation;controller=new AbortController();
    feedback.textContent='正在发送一条简短测试消息…';
    try{
      const agent=getAgent();const status=await api.status(agent.credentialId||'chat');
      if(!status.connected)throw Error('请先启动项目的本机服务。');
      if(!status.credential)throw Error('请先在右侧保存聊天密钥。');
      const values=validatedModelSettings({baseUrl:form.elements.baseUrl.value,model:form.elements.model.value,thinking:form.elements.thinking.checked});
      if(!values.baseUrl||!values.model)throw Error('请先填写服务地址和模型名称。');
      await api.chat({...values,credentialId:agent.credentialId},[{role:'user',content:'这是连接测试。请只回复：连接成功。'}],{roleId:agent.roleId,roleHelpers:false,signal:controller.signal,onDelta:()=>{}});
      if(turn===generation){await onVerified(values);feedback.textContent=turn!==generation?'上一份配置已通过验证。输入又发生变化，新修改仍需验证或保存。':api.streamSupported===false?'模型配置已保存，完整回复接口验证成功。当前本机服务不支持流式显示，将使用完整回复模式。':'模型配置已保存，聊天生成链路验证成功。测试未写入聊天记录，可以返回聊天。';}
      else feedback.textContent='测试时配置发生了变化，请按新配置重新测试。';
    }catch(error){if(turn===generation)feedback.textContent=error.name==='AbortError'?'验证已停止，本次配置未自动保存。':`测试未通过：${error.message}`;}
    finally{busy=false;controller=null;test.disabled=false;preset.disabled=false;}
  };
  return {get busy(){return busy;},cancel(){if(controller){generation++;controller.abort();feedback.textContent='验证已停止，本次配置未自动保存。';}}};
}
