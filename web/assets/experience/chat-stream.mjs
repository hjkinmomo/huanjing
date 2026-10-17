import {providerFailureMessage} from './provider-settings.mjs';
export const STREAM_ERRORS={stream_interrupted:'回复连接中断，片段没有作为正式回复保存。',stream_incomplete_reply:'模型没有正常完成回复，片段未作为正式回复保存。',stream_reply_too_large:'回复超过 20000 字符的存储上限。',stream_timeout:'生成超时，请稍后重试。',stream_not_found:'生成任务已失效，请重新发送。',stream_role_busy:'上一段回复还在生成，稍等片刻再试一次。',stream_content_type_invalid:'模型服务没有返回流式或 JSON 回复。',skill_context_budget_exceeded:'读取技能后超出当前上下文预算，请先归纳上下文或提高窗口；原有记录保留。',skill_tool_call_limit:'本轮读取方法过多，未保存不完整回复。',stream_incomplete_tool_call:'模型的技能调用没有完整结束，请重试；原有记录保留。'};
const pause=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);function abort(){clearTimeout(timer);reject(signal.reason);}signal.addEventListener('abort',abort,{once:true});});
export async function streamChat(request,payload,{signal,onDelta,onUsage,onReasoning,onFinish,onSkillActivity,allowLength=false}){
  let job=null;const requestId=crypto.randomUUID().replaceAll('-','');
  // Keep the start request alive just long enough to learn its id even if stopped
  // during the handshake, then send explicit cancellation. No orphan job retry.
  try{
    // A previous generation for this role may still be finishing (e.g. an unreachable
    // job after a page reload). Wait it out instead of surfacing a hard failure.
    for(let waited=0;;){
      try{
        signal.throwIfAborted();
        job=await request('/v1/providers/chat-stream/start',{...payload,requestId},10000);
        break;
      }catch(error){
        if(error?.code!=='stream_role_busy'||waited>=130000)throw error;
        await pause(3000,signal);waited+=3000;
      }
    }
    for(;;){
      signal.throwIfAborted();
      if(job.roleId!==payload.roleId)throw Error('生成任务的角色归属不匹配。');
      if(typeof job.text!=='string'||job.text.length>20000)throw Error('生成响应格式或长度异常。');
      if(job.reasoning!==undefined&&(typeof job.reasoning!=='string'||Array.from(job.reasoning).length>40000))throw Error('推理响应格式异常。');
      onReasoning?.(job.reasoning||'',job.reasoningTruncated===true);
      onSkillActivity?.(job.skillActivity||[]);
      onDelta(job.text);
      if(job.state==='complete'){if(!job.text.trim())throw Error('模型没有返回正文。');if(job.finishReason==='length'&&!allowLength)throw Error(STREAM_ERRORS.stream_incomplete_reply);if(job.finishReason&&!['stop','length'].includes(job.finishReason))throw Error(STREAM_ERRORS.stream_incomplete_reply);onFinish?.(job.finishReason||'stop');if(job.usage)onUsage?.(job.usage);return job.text;}
      if(job.state==='cancelled')throw new DOMException('已停止生成','AbortError');
      if(job.state==='failed')throw Error(job.httpStatus?providerFailureMessage(job.httpStatus):(STREAM_ERRORS[job.error]||'生成失败，请检查服务连接后重试。'));
      if(job.state!=='running')throw Error('生成状态异常。');
      await pause(250,signal);
      job=await request(`/v1/providers/chat-stream/status?id=${encodeURIComponent(job.id)}&roleId=${encodeURIComponent(payload.roleId)}`,null,10000,signal);
    }
  }catch(error){
    error.streamStarted=!!job;
    if(!(error.status===404&&error.code==='not_found'&&!error.origin&&!job))try{await request('/v1/providers/chat-stream/cancel',{id:job?.id||requestId,roleId:payload.roleId},3000);}catch{}
    throw error;
  }
}
