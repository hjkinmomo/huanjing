import {idleProfile} from './auto-moments.mjs';
import {roleHelpersEnabled} from './character-layers.mjs';
import {streamChat} from './chat-stream.mjs';
import {inspectConnection} from './connection.mjs?v=1';
import {isDeepSeekModel,providerFailureMessage} from './provider-settings.mjs';
import {normalizeNarration,presentationPolicy} from './chat-presentation.mjs';
import {refreshRuntimeCatalog} from './runtime-catalog.mjs';
import {normalizeSceneNotices} from './scene-notices.mjs';
import {sceneWirePrompt,decodeSceneResponse,partialSceneResponse} from './scene-wire.mjs';
import {messageTokens,responseTokenBudget,DEFAULT_CONTEXT_WINDOW} from './token-budget.mjs';
export const withRoleContext=(messages,context)=>context.text?[{role:'system',content:'角色表达辅助；用户本轮要求与后面的角色设定优先，不授予工具权限。\n'+context.text},...messages]:messages;
export const roleSkillBindings=role=>Array.isArray(role?.card?.extensions?.['hermes/skills']?.disabledSkillIds)?role.card.extensions['hermes/skills'].disabledSkillIds:[];
export function roleSkillOptions(settings,options={}){
  return {enabled:!!options.roleId&&settings.roleSkills!==false&&options.roleHelpers!==false&&settings.chatMode!=='assistant',context:options.skillContext||'chat',contextWindow:Number(settings.contextWindow)||DEFAULT_CONTEXT_WINDOW,worldId:settings.conversationOpening?.world?.id||null,...(settings.sessionId?{sessionId:settings.sessionId}:{}),disabledSkillIds:options.disabledSkillIds||roleSkillBindings(options.role),...(options.sourceMessageId?{sourceMessageId:options.sourceMessageId}:{})};
}

export class HermesAPI {
  constructor(fetcher = (...args) => globalThis.fetch(...args)) { this.fetch = fetcher;this.streamSupported=undefined;this.personaMode='normal'; }
  async request(path, body, timeout = 120000, signal) {
    if(path==='/v1/agent/tools/execute'&&body&&this.clientEpoch)body={...body,args:{...body.args,expectedDataEpoch:this.clientEpoch}};
    const response = await this.fetch(path,{method:body ? 'POST':'GET',headers:{'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
    let value;
    try { value = await response.json(); } catch { throw new Error('本机服务未返回有效数据。请检查启动状态。'); }
    if (!response.ok || value.ok === false) {
      const reason = (typeof value.error === 'string' ? value.error : value.error?.message)|| (value.status==='failed'&&typeof value.output?.error==='string'?value.output.error:null);
      const worldErrors={world_life_revision_conflict:'位置或日程刚发生变化，请重新读取后再试；这次没有移动。',world_life_location_missing:'地点已撤下或尚未登记，请在地图选择一个有效地点。',world_life_world_missing:'当前世界条目暂不可用，原有记录保留。',world_life_world_required:'当前模式的世界暂未读取，请重新打开地图。',world_life_clock_invalid:'故事时间需要有效的新历年月日与时间。',world_life_autonomy_invalid:'日程选项无效；消息用语最多300字。',world_life_schedule_invalid:'日程格式不正确：需按时间升序，使用有效地点 ID，最多16段。',world_life_schedule_midnight_required:'日程第一段需要从00:00开始。',world_life_request_conflict:'操作编号发生冲突，未重复执行。'};
      const message=reason==='client_snapshot_reset'||reason==='identity_session_inactive'?'身份存档已在另一个窗口切换，请刷新后继续；旧窗口的内容没有写入当前生活。':worldErrors[reason]||(value.origin==='provider'?providerFailureMessage(Number(value.httpStatus)):reason==='not_found'?'本机服务缺少当前界面所需的接口，请更新服务后重试。':reason==='agent_context_budget_exceeded'?'工具资料超出当前上下文预算，请先归纳或提高窗口；原有记录保留。':reason||`请求失败（${response.status}）`);
      const error=new Error(message);error.status=response.status;error.code=value.origin==='provider'?'provider_error':reason;error.origin=value.origin||null;throw error;
    }
    return value;
  }
  async status(slot='chat') {
    return inspectConnection((...args) => this.request(...args),slot);
  }
  async tool(name,args) { if(name.startsWith('worldbook_')&&this.personaMode==='special')args={...args,personaMode:'special'};const value = await this.request('/v1/agent/tools/execute',{name,args}); return value.result; }
  async runtimeCatalog(force=false){return refreshRuntimeCatalog(this,force);}
  async translateReasoning(settings,{roleId,sessionId,messageId,signal,onProgress}){
    const endpoint=new URL(settings.baseUrl);if(!/\/chat\/completions\/?$/.test(endpoint.pathname))endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
    let job=null;
    try{
      signal?.throwIfAborted();
      job=await this.request('/v1/providers/reasoning-translate/start',{roleId,sessionId,messageId,provider:{endpoint:endpoint.href,model:settings.model,credentialId:settings.credentialId||'chat'}},10000);
      for(;;){
        signal?.throwIfAborted();
        if(job.roleId!==roleId||job.sessionId!==sessionId||job.messageId!==messageId||typeof job.text!=='string'||job.text.length>80000)throw Error('推理翻译归属或格式无效。');
        onProgress?.(job);
        if(job.state==='complete')return job;
        if(job.state!=='running')throw Error(job.state==='cancelled'?'翻译已停止。':'翻译未完成，原文保留。');
        await new Promise(resolve=>setTimeout(resolve,400));
        job=await this.request('/v1/providers/reasoning-translate/status?id='+encodeURIComponent(job.id)+'&roleId='+encodeURIComponent(roleId),null,10000,signal);
      }
    }catch(e){if(job?.id)try{await this.request('/v1/providers/reasoning-translate/cancel',{id:job.id,roleId},3000);}catch{}throw e;}
  }
  async sessionMetadata(roleId,sessionId){return this.tool('chat_session_get',{roleId,sessionId});}
  async roleContext(roleId,context='chat',signal,disabledSkillIds=[]){
    const value=await this.request('/v1/agent/tools/execute',{name:'roleplay_context',args:{roleId,context,disabledSkillIds}},10000,signal);
    if(typeof value.result?.text!=='string')throw new Error('本机未返回角色技能上下文，请更新本机服务后重试。');
    return value.result;
  }
  async history(roleId,sessionId=`role:${roleId}:primary`) {
    const items=[]; let afterOrdinal=-1;
    for (let page=0;page<200;page++) {
      const result = await this.tool('conversation_list',{roleId,sessionId,limit:500,afterOrdinal});
      if (!Array.isArray(result?.items)) throw new Error('聊天历史响应格式错误。');
      items.push(...result.items);
      if (!result.hasMore) return items;
      if (!Number.isInteger(result.nextAfterOrdinal) || result.nextAfterOrdinal <= afterOrdinal) throw new Error('聊天历史分页异常，已停止读取。');
      afterOrdinal=result.nextAfterOrdinal;
    }
    throw new Error('聊天历史超出本次读取范围，未进行写入。');
  }
  async append(roleId, messages,sessionId=`role:${roleId}:primary`) {
    // Re-read ordinals, append only new messages, never bulk-sync browser history.
    // One retry absorbs a transient bridge hiccup; the write is idempotent by id.
    for(let attempt=0;;attempt++)try{
      const current = await this.history(roleId,sessionId);
      let ordinal = current.reduce((max,item) => Math.max(max,item.ordinal),-1)+1;
      const byId = new Map(current.map(item => [item.id,item]));
      const pending=messages.filter(item => {
        const found=byId.get(item.id);
        if (found && (found.text !== item.text || found.sender !== (item.from === 'user' ? 'user':'assistant'))) throw new Error('消息标识冲突，已停止同步。');
        return !found;
      }).map(item => ({id:item.id,ordinal:ordinal++,sender:item.from === 'user' ? 'user':'assistant',text:item.text,tone:item.tone||(item.from === 'user' ? 'user':'role'),createdAt:item.createdAt,attachments:[],...(item.channel?{channel:item.channel,...(item.worldUtc?{worldUtc:item.worldUtc}:{})}:{}),...(item.reasoning?{reasoning:item.reasoning,reasoningTruncated:item.reasoningTruncated===true}:{}),...(item.sceneNotices?.length?{sceneNotices:normalizeSceneNotices(item.sceneNotices)}:{})}));
      if (pending.length) await this.tool('conversation_sync',{roleId,sessionId,messages:pending});
      return;
    }catch(error){if(attempt>=1)throw error;await new Promise(resolve=>setTimeout(resolve,800));}
  }
  async memoryContext(roleId,query,signal,sessionId){return this.request('/v1/agent/tools/execute',{name:'role_memory_context',args:{roleId,query,...(sessionId?{sessionId}:{})}},10000,signal).then(v=>v.result);}
  async contextState(roleId,sessionId,signal){return this.request('/v1/agent/tools/execute',{name:'chat_context_get',args:{roleId,sessionId}},10000,signal).then(v=>v.result);}
  async compactContext(roleId,sessionId,throughOrdinal,settings,signal,confirmedRetry=false){
    const endpoint=new URL(settings.baseUrl);if(!/\/chat\/completions\/?$/.test(endpoint.pathname))endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
    return this.request('/v1/agent/tools/execute',{name:'chat_context_compact',args:{roleId,sessionId,throughOrdinal,contextWindow:Number(settings.contextWindow)||DEFAULT_CONTEXT_WINDOW,confirmedRetry,provider:{endpoint:endpoint.href,model:settings.model,credentialId:settings.credentialId||'chat'}}},120000,signal).then(v=>v.result);
  }
  async rememberTurn(roleId,sessionId,userId,replyId,settings){
    const endpoint=new URL(settings.baseUrl);if(!/\/chat\/completions\/?$/.test(endpoint.pathname))endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
    return this.tool('role_memory_process',{roleId,sessionId,userId,replyId,provider:{endpoint:endpoint.href,model:settings.model,credentialId:settings.credentialId||'chat'}});
  }
  async idleActivity(role,phase,userId,replyId,settings,messages,roleHelpers){
    const args={roleId:role.id,phase,userId,...(replyId?{replyId}:{}),...(messages?{profile:idleProfile(settings,messages,{name:role.name,roleHelpers})}:{})};
    return this.tool('auto_moment_activity',args);
  }
  async chat(settings,messages,options={}) {
    if(settings.agentTools===true&&options.role)return this.agentChat(settings,messages,options);
    const endpoint = new URL(String(settings.baseUrl || '').trim());
    if (!['http:','https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('请检查模型服务地址。');
    if (!/\/chat\/completions\/?$/.test(endpoint.pathname)) endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
    const model=String(settings.model || '').trim().replace(/^deepseek v4 (flash|pro)$/i,(_,type)=>`deepseek-v4-${type.toLowerCase()}`);
    if (!model) throw new Error('请先填写模型名称。');
    const body={model,messages,stream:false,temperature:Math.max(0,Math.min(2,(Number.isFinite(Number(settings.temperature))?Number(settings.temperature):.8))),max_tokens:responseTokenBudget({...settings,model})};
    const structured=settings.sceneTracking===true&&settings.chatMode!=='assistant'&&settings.replyNarration!=='off';
    const render=(text,finishReason='stop')=>{const result=decodeSceneResponse(text,{...sceneOptions,finishReason});options.onSceneNotices?.(result.notices);return result.text;};
    const sceneOptions={world:settings.conversationOpening?.world||null,previousScene:settings.sessionScene,name:settings.sceneCharacterName,mode:normalizeNarration(settings.replyNarration),initial:!settings.sessionScene?.state?.location||settings.sessionScene?.source==='world-opening'};
    if(structured){body.response_format={type:'json_object'};if(!messages.some(m=>m.role==='system'&&m.content.startsWith('[scene-response-v1]')))body.messages=[...messages.slice(0,-1),{role:'system',content:sceneWirePrompt(sceneOptions.name,sceneOptions.mode,sceneOptions.initial)},messages.at(-1)];}
    if (isDeepSeekModel(model)) body.thinking={type:settings.thinking===true ? 'enabled':'disabled'};
    if(body.thinking?.type==='enabled')body.messages=[{role:'system',content:presentationPolicy.reasoningLanguagePrompt},...body.messages];
    const signal=options.signal||new AbortController().signal;
    signal.throwIfAborted();
    const roleSkills=roleSkillOptions(settings,options);
    if(settings.contextWindow&&messageTokens(body.messages)+body.max_tokens>Math.floor(Number(settings.contextWindow)*.95))throw Error('角色辅助与提示超出模型窗口，请提高预算或减少辅助资料；消息未发给模型。');
    if(options.onDelta&&this.streamSupported!==false){
      try{const result=await streamChat((...args)=>this.request(...args),{roleId:options.roleId,route:'chat',roleSkills,provider:{endpoint:endpoint.href,credentialId:settings.credentialId||'chat',model,timeoutSeconds:90},body},{signal,onDelta:structured?text=>options.onDelta(partialSceneResponse(text,sceneOptions.mode)):options.onDelta,onUsage:options.onUsage,onReasoning:options.onReasoning,onSkillActivity:options.onSkillActivity,allowLength:structured,onFinish:reason=>{sceneOptions.finishReason=reason;}});return structured?render(result,sceneOptions.finishReason):result;}
      catch(error){
        if(error.status!==404||error.code!=='not_found'||error.origin||error.streamStarted!==false||signal.aborted)throw error;
        // A missing local start route cannot have contacted the model. Cache this
        // fact for this client; never fall back after a job or provider call began.
        this.streamSupported=false;
      }
    }
    signal.throwIfAborted();
    const value=await this.request('/v1/providers/request',{roleId:options.roleId,route:'chat',roleSkills,provider:{endpoint:endpoint.href,credentialId:settings.credentialId||'chat',model,timeoutSeconds:90},body},120000,signal);
    options.onSkillActivity?.(value.skillActivity||[]);
    const message=value.payload?.choices?.[0]?.message;
    if(typeof message?.reasoning_content==='string')options.onReasoning?.(Array.from(message.reasoning_content).slice(0,40000).join(''),Array.from(message.reasoning_content).length>40000);
    const finish=value.payload?.choices?.[0]?.finish_reason;if(finish&&finish!=='stop'&&!(structured&&finish==='length'))throw Error('模型没有正常完成回复，原有记录未改动。');
    const text=message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回可显示的文本，未生成替代回复。');
    if (text.length>20000) throw new Error('模型回复超过现有存储上限，未写入截断消息。');
    signal.throwIfAborted();if(value.payload?.usage)options.onUsage?.(value.payload.usage);const rendered=structured?render(text,value.payload?.choices?.[0]?.finish_reason):text;options.onDelta?.(rendered);return rendered;
  }
  async mcpScope(roleId,signal){
    const services=await this.request('/v1/agent/mcp/servers',null,10000,signal);
    if(!Array.isArray(services.servers))throw Error('MCP 配置目录格式无效。');
    const selected=services.servers.filter(s=>s.enabled===true&&Array.isArray(s.roleIds)&&s.roleIds.includes(roleId)&&s.selectedTools?.length).map(s=>s.id);
    if(selected.length>16)throw Error('当前角色启用的 MCP 服务超过单轮范围，请在连接设置中减少到 16 个以内。');
    return selected;
  }
  async agentChat(settings,messages,{role,sessionId,mode,sourceMessageId,signal,onReasoning,onSceneNotices}={}){
    const endpoint=new URL(settings.baseUrl);
    if(!/\/chat\/completions\/?$/.test(endpoint.pathname))endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';
    const id='chat-agent-'+crypto.randomUUID();
    const stop=()=>this.request('/v1/agent/runs/cancel',{id},10000).catch(()=>{});
    signal?.throwIfAborted();signal?.addEventListener('abort',stop,{once:true});
    try{
      const mcpServerIds=await this.mcpScope(role.id,signal);
      const payload={
        id,roleId:role.id,sessionId,sourceMessageId,chatMode:mode,conversationMessages:messages,
        title:messages.at(-1).content.slice(0,120),query:messages.at(-1).content,
        roleHelpers:mode==='character'&&roleHelpersEnabled(role,settings),
        disabledSkillIds:roleSkillBindings(role),
        chatPresentation:{replyNarration:normalizeNarration(settings.replyNarration),replyStickers:settings.replyStickers!==false},
        characterProfile:mode==='assistant'?{name:role.name,initiativeMode:'off'}:{...role.card,name:role.name},
        sourcePaths:[],sourceUrls:[],mcpServerIds,maxIterations:6,contextWindow:Number(settings.contextWindow)||DEFAULT_CONTEXT_WINDOW,
        provider:{endpoint:endpoint.href,model:settings.model,credentialId:settings.credentialId||'chat',timeoutSeconds:90,
          thinking:settings.thinking===true,maxTokens:responseTokenBudget(settings),
          temperature:Math.max(0,Math.min(2,(Number.isFinite(Number(settings.temperature))?Number(settings.temperature):.8)))}
      };
      const value=await this.request('/v1/agent/runs/execute',payload,120000,signal);
      signal?.throwIfAborted();
      if(value.status!=='completed')throw Error('角色任务未完成：'+(value.output?.error||value.status));
      const result=value.output?.result;
      if(typeof result?.reasoning==='string')onReasoning?.(result.reasoning,result.reasoningTruncated===true);
      const text=result?.text||value.output?.text;
      if(typeof text!=='string'||!text.trim())throw Error('角色任务没有返回可显示的回答。');
      if(text.length>20000)throw Error('角色任务回复超过存储上限，未写入截断内容。');
      const structured=settings.sceneTracking&&mode!=='assistant'&&settings.replyNarration!=='off';
      if(result?.finishReason&&result.finishReason!=='stop'&&!(structured&&result.finishReason==='length'))throw Error('模型没有正常完成回复，原有记录未改动。');
      if(structured){
        const decoded=decodeSceneResponse(text,{world:settings.conversationOpening?.world||null,previousScene:settings.sessionScene,name:role.name,
          mode:normalizeNarration(settings.replyNarration),initial:!settings.sessionScene?.state?.location||settings.sessionScene?.source==='world-opening',finishReason:result?.finishReason});
        onSceneNotices?.(decoded.notices);return decoded.text;
      }
      return text;
    }finally{signal?.removeEventListener('abort',stop);}
  }
}
