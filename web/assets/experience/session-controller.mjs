import {mergedMessages,modelMessages,modelMessagePlan} from './state.mjs';
import {roleHelpersEnabled} from './character-layers.mjs';
import {conversationKey,primarySession,privateSource} from './conversation-state.mjs';
import {rolePersonaReady} from './role-readiness.mjs';
import {roleSkillBindings} from './api.mjs?v=group-chat-20261016';
import {worldLifePrompt,contactScene,worldStamp} from './world-life.mjs?v=time-life-20261017';

// Session work owns a captured role; the view is notified, never queried or mutated.
export function createSessionController({api,read,mutate,legacy,settings,ready,lock,changed,draftCleared,volatileReply,canUseSession=()=>true}) {
  const busy=new Set(),historyCache=new Map(),historyErrors=new Map(),sendErrors=new Map(),memoryErrors=new Map(),contextStates=new Map();
  const generations=new Map(),controllers=new Map(),revealIds=new Set();
  const partials=new Map(Object.entries(read().interruptedReplies||{}).filter(([,v])=>v&&typeof v.text==='string'&&v.text.length<=20000));
  function cancel(id){const controller=controllers.get(id);if(!controller)return false;controller.abort(new DOMException('已停止生成','AbortError'));changed(id);return true;}
  function cancelAll(){for(const id of controllers.keys())cancel(id);}
  async function history(owner,{preserveReading=false,sessionId=primarySession(owner)}={}) {
    const id=conversationKey(owner,sessionId);
    const generation=(generations.get(id)||0)+1;generations.set(id,generation);
    try {
      const items=await api.history(owner,sessionId);
      if(generations.get(id)!==generation)return;
      if(api.contextState)try{const context=await api.contextState(owner,sessionId);if(generations.get(id)!==generation)return;contextStates.set(id,{...contextStates.get(id),...context});}catch{}
      if(!busy.has(id))for(const item of items)revealIds.delete(item.id);
      historyCache.set(id,items);historyErrors.delete(id);
    }catch(error){if(generations.get(id)===generation)historyErrors.set(id,{text:`历史恢复失败：${error.message} 原有记录未改动。`});}
    changed(id,{history:true,preserveReading});
  }
  async function sync(owner,{sessionId=primarySession(owner)}={}) {
    const id=conversationKey(owner,sessionId);
    if(busy.has(id))return;
    busy.add(id);changed(id);
    try {
      await lock(async()=>{
        const pending=(read().messages[id]||[]).filter(item=>item.syncPending);
        await api.append(owner,pending,sessionId);
        const ids=new Set(pending.map(item=>item.id));
        mutate(s=>{(s.messages[id]||[]).forEach(item=>{if(ids.has(item.id))item.syncPending=false;});});
      });
      sendErrors.delete(id);await history(owner,{preserveReading:true,sessionId});
      const messages=read().messages[id]||[],reply=messages.findLast(m=>m.from==='role'&&m.inReplyTo&&!m.syncPending);
      if(reply&&api.resolveRoomReply)try{await api.resolveRoomReply(owner,sessionId,reply.inReplyTo,reply.id,settings(owner));}catch{}
      if(reply&&messages.find(m=>m.id===reply.inReplyTo)?.tone!=='binding-application')try{await api.rememberTurn?.(owner,sessionId,reply.inReplyTo,reply.id,settings(owner));}catch{memoryErrors.set(id,'消息已同步，但记忆整理未排队。');}
    }catch(error){sendErrors.set(id,{text:`同步未完成：${error.message} 消息保留在本浏览器。`,retry:'sync'});}
    finally{busy.delete(id);changed(id);}
  }
  async function send({role,text,retry=null,preserveDraft=false,activity=null,sessionId=primarySession(role.id),mode='character',channel='offline'}) {
    channel=retry?.channel||channel;
    role=structuredClone(role);const owner=role.id,id=conversationKey(owner,sessionId);text=(retry?.text||text||'').trim();
    if(!text)return;
    if(!canUseSession(owner,sessionId,mode)){sendErrors.set(id,{text:'先创建这位角色的新对话，再开始交流。草稿已保留。'});changed(id);return;}
    if(busy.has(id))return {user:null,reply:null,busy:true};
    const retained=activity?'活动记录已保留；设置完成后，可从背包或游戏历史再次请求回应。':'草稿已保留。';
    if(mode!=='assistant'&&!rolePersonaReady({...role,card:legacy().roleCards?.[owner]||role.card})){
      sendErrors.set(id,{text:`这位角色的人格尚未填写。请在“角色资料”填写人格并应用，或新建“普通 AI 助手”会话。${retained}`});changed(id);return;
    }
    if(!ready()){sendErrors.set(id,{text:`模型尚未连接。请在设置中检查连接。${retained}`});changed(id);return;}
    const controller=new AbortController(),signal=controller.signal;controllers.set(id,controller);
    partials.delete(id);
    busy.add(id);sendErrors.delete(id);changed(id);
    let user=null,phase='prepare',reply=null,readonly=false,reasoning='',reasoningTruncated=false,sceneNotices=[];
    const replyId=`experience-${crypto.randomUUID()}`;revealIds.add(replyId);
    try {
      await lock(async()=>{
        signal.throwIfAborted();
        const current=read();
        if(activity){if(typeof activity.id!=='string'||!['gift','game','binding','delivery'].includes(activity.type))throw Error('活动请求无效。');const prior=current.messages[id]?.find(m=>m.activityId===activity.id&&m.from==='user');if(prior?.replyState==='received')return;if(prior){retry=prior;text=prior.text;}}
        if(retry){
          user=current.messages[id]?.find(item=>item.id===retry.id&&item.from==='user'&&item.text===retry.text);
          if(!user)throw Error('重试消息不属于当前角色，已停止发送。');
          if(user.replyState==='received')return;
        }
        if(api.runtimeCatalog)await api.runtimeCatalog();
        const runtime=await api.history(owner,sessionId);historyCache.set(id,runtime);
        signal.throwIfAborted();
        const existing=mergedMessages(legacy(),read(),runtime,owner,sessionId).filter(item=>item.id!==retry?.id);
        const config={...structuredClone(settings(owner)),chatMode:mode,sessionId};
        // Read immutable per-session background, never infer it from another active role/window.
        const metadata=api.sessionMetadata?await api.sessionMetadata(owner,sessionId):null;
        if(metadata&&(metadata.roleId!==owner||metadata.sessionId!==sessionId||metadata.mode!==mode))throw Error('聊天归属或方式已变化，请重新打开这段聊天。');
        config.conversationOpening=metadata?.opening||null;
        config.sceneTracking=mode==='character';config.sessionScene=metadata?.scene||null;
        config.sceneCharacterName=role.name;
        if(mode==='character'&&channel==='phone'){config.sceneTracking=false;config.replyNarration='off';config.worldStatePrompt=worldLifePrompt(null,'phone');}
        if(mode==='character'&&api.tool){
          let life=await api.tool('world_life_get',{roleId:owner,sessionId})||{enabled:false};
          if(life.binding&&life.binding.status!=='accepted'&&/绑定|共享.{0,8}(?:位置|行迹)/.test(text)&&!/(?:解除|取消|不想|不要).{0,8}(?:绑定|共享)/.test(text)){await api.tool('world_life_binding',{roleId:owner,sessionId,action:'ask',requestId:crypto.randomUUID()});life=await api.tool('world_life_get',{roleId:owner,sessionId});}
          if(life.enabled&&channel==='offline'&&(!life.valid||!life.coLocated))throw Error('你们不在同一地点，请用手机联系或在地图前往角色所在地点。草稿已保留。');
          config.worldLife=life;config.worldStatePrompt=worldLifePrompt(life,channel);
          config.sessionScene=contactScene(life,metadata.scene);
          if(channel==='phone'){config.sceneTracking=false;config.replyNarration='off';}
        }
        if(metadata?.opening?.world)try{config.temporaryPlaces=(await api.tool('temporary_place_list',{roleId:owner,sessionId})).places;}catch{config.temporaryPlaces=[];}
        if(mode==='character'&&channel==='phone')config.worldStatePrompt+='\n[phone-render-v1] 像即时消息一样，用自然短句回应。只写角色发给用户的文字，可选一个当前角色可用的表情；不写旁白、心里话、场景状态或长篇动作描写。\n';
        config.memoryPolicy=metadata?.memoryPolicy||'normal';
        readonly=config.memoryPolicy==='readonly';
        if(config.memoryPolicy==='readonly')config.agentTools=false;
        if(!user){
          user={id:`experience-${crypto.randomUUID()}`,from:'user',text,channel,worldUtc:worldStamp(config.worldLife),sessionId,createdAt:new Date().toISOString(),syncPending:true,replyState:'pending',...(activity?{activityId:activity.id,activityType:activity.type,...(activity.type==='binding'?{tone:'binding-application'}:{})}:{})};
          mutate(s=>{(s.messages[id]||=[]).push(user);if(!preserveDraft){if(channel==='phone'){s.phoneDrafts||={};if(s.phoneDrafts[id]===text)s.phoneDrafts[id]='';}else s.drafts[id]='';}});if(!preserveDraft)draftCleared(id,channel);
        }
        phase='user-sync';await api.append(owner,[user],sessionId);
        let roomOffer=null;
        if(mode==='character'&&!readonly&&config.worldLife?.enabled&&api.tool){
          try{roomOffer=await api.tool('world_room_offer',{roleId:owner,sessionId,userId:user.id});if(roomOffer?.candidate)config.worldStatePrompt+='\n'+roomOffer.note;}catch{}
        }
        mutate(s=>{const item=s.messages[id]?.find(m=>m.id===user.id);if(item)item.syncPending=false;if(s.interruptedReplies)delete s.interruptedReplies[id];});
        changed(id,{bottom:true});
        signal.throwIfAborted();
        let recalled={};memoryErrors.delete(id);
        if(config.memoryContext===true&&api.memoryContext)try{recalled=await api.memoryContext(owner,text,signal,sessionId);}catch(error){if(signal.aborted)throw error;memoryErrors.set(id,'记忆读取暂不可用，本轮只使用已在本机的资料。');}
        const source=privateSource(legacy(),owner,recalled),latest={...role,card:source.roleCards?.[owner]||role.card};
        if(config.contextWindow&&api.contextState){
          try{const state=await api.contextState(owner,sessionId,signal);config.contextChunks=state.chunks;config.contextExcludedIds=state.excludedMessageIds;contextStates.set(id,state);}catch(error){if(signal.aborted)throw error;memoryErrors.set(id,'会话归纳读取失败；本轮保留近期原话，完整历史仍在。');}
        }
        let plan=modelMessagePlan(role,existing,text,source,config);
        if(plan.context.needsCompaction&&api.compactContext){
          const originals=existing.filter(m=>Number.isInteger(m.ordinal)),boundary=originals.at(-9)?.ordinal;
          if(boundary!==undefined)try{
            for(let batch=0;batch<4;batch++){
              changed(id,{compression:true});const compact=await api.compactContext(owner,sessionId,boundary,config,signal);
              config.contextChunks=compact.chunks;contextStates.set(id,compact);
              config.contextExcludedIds=compact.excludedMessageIds;
              if(!compact.created||compact.remaining<2)break;
            }
            plan=modelMessagePlan(role,existing,text,source,config);
          }catch(error){if(signal.aborted)throw error;memoryErrors.set(id,'自动归纳未完成；本轮按预算发送近期原话，原记录没有删除。');}
        }
        contextStates.set(id,{...contextStates.get(id),plan:plan.context,temporaryPlaces:config.temporaryPlaces||[],scene:config.sessionScene,world:metadata?.opening?.world||null,memoryPolicy:config.memoryPolicy});
        if(plan.context.omitted>0&&!memoryErrors.has(id))memoryErrors.set(id,`本轮有 ${plan.context.omitted} 条原话未进入窗口；完整历史仍可查阅。`);
        const planned=plan.messages,helpers=roleHelpersEnabled(latest,config);
        // Auxiliary scheduling failure must not turn a successful chat into a send failure.
        try{if(mode==='character'&&config.memoryPolicy!=='readonly')await api.idleActivity?.(role,'start',user.id,null,config,planned,helpers);}catch{}
        phase='model';const chatOptions={roleId:owner,sourceMessageId:user.id,roleHelpers:mode==='character'&&roleHelpersEnabled(latest,config),disabledSkillIds:roleSkillBindings(latest),signal,onSceneNotices:notices=>{sceneNotices=notices;},onUsage:usage=>{contextStates.set(id,{...contextStates.get(id),usage});changed(id,{usage:true});},onReasoning:(content,truncated)=>{
          if(signal.aborted)return;reasoning=content;reasoningTruncated=truncated;
          const partial=partials.get(id)||{id:replyId,text:'',status:'generating',channel,userId:user.id};
          partials.set(id,{...partial,reasoning,reasoningTruncated});changed(id,{partial:true});
        },onDelta:content=>{
          if(signal.aborted)return;
          partials.set(id,{id:replyId,text:content,status:'generating',channel,userId:user.id,reasoning,reasoningTruncated});changed(id,{partial:true});
        }};
        let response=null;
        // Recover locally first. Regenerate only when no usable dialogue remains; never retry transport failures.
        for(let attempt=1;;attempt++){
          try{
            const attemptMessages=attempt===1?planned:[...planned.slice(0,-1),{role:'system',content:'上次输出无法识别完整对白。本次缩短旁白，严格完成 scene-response-v1 JSON：parts 每段包含 kind 和 text 各一次；先保证至少一段完整对白；未知场景字段留空。不要解释格式错误或引用上次失败输出。'},planned.at(-1)];
            response=config.agentTools===true&&api.agentChat?await api.agentChat(config,attemptMessages,{role:latest,sessionId,mode,sourceMessageId:user.id,signal,onReasoning:chatOptions.onReasoning,onSceneNotices:chatOptions.onSceneNotices}):await api.chat(config,attemptMessages,chatOptions);
            break;
          }catch(error){
            if(error?.code!=='scene_invalid'||signal.aborted||attempt>=1)throw error;
          }
        }
        signal.throwIfAborted();controllers.delete(id);
        reply={id:replyId,from:'role',text:response,channel,worldUtc:worldStamp(config.worldLife),...(sceneNotices.length?{sceneNotices}:{}),...(reasoning?{reasoning,reasoningTruncated}:{}),sessionId,inReplyTo:user.id,createdAt:new Date().toISOString(),syncPending:true};
        phase='reply-save';mutate(s=>{(s.messages[id]||=[]).push(reply);if(s.interruptedReplies)delete s.interruptedReplies[id];const item=s.messages[id].find(m=>m.id===user.id);if(item)item.replyState='received';});partials.delete(id);
        phase='reply-sync';await api.append(owner,[reply],sessionId);
        if(roomOffer?.candidate&&api.resolveRoomReply)try{await api.resolveRoomReply(owner,sessionId,user.id,reply.id,config);}catch{memoryErrors.set(id,'回复已保存；房间位置尚未核对完成，不能视为已经到达。');}
        if(config.worldLife?.enabled)await api.tool('world_life_get',{roleId:owner,sessionId}).catch(()=>{});
        if(metadata?.opening?.world)try{
          const {sceneFromReply}=await import('./scene-state.mjs');
          const state=sceneFromReply(response);
          if(state?.location&&state?.setting){const temporary=await api.tool('temporary_place_upsert',{roleId:owner,sessionId,state});contextStates.set(id,{...contextStates.get(id),temporaryPlaces:temporary.places});}
        }catch{memoryErrors.set(id,'回复已保存；临时地点暂未登记，可稍后在场景面板重试。');}
        mutate(s=>{const item=s.messages[id]?.find(m=>m.id===reply.id);if(item)item.syncPending=false;});
        try{if(mode==='character'&&config.memoryPolicy!=='readonly')await api.idleActivity?.(role,'complete',user.id,reply.id);}catch{}
        try{if(user.tone!=='binding-application')await api.rememberTurn?.(owner,sessionId,user.id,reply.id,config);}catch{memoryErrors.set(id,'聊天已保存，但记忆提炼未排队；可在记忆页检查。');}
        await history(owner,{preserveReading:true,sessionId});
      });
    }catch(error){
      const stopped=signal.aborted||error.name==='AbortError';
      revealIds.delete(replyId);
      const partial=partials.get(id);
      if(partial?.text){partial.status=stopped?'interrupted':'failed';try{mutate(s=>{s.interruptedReplies||={};s.interruptedReplies[id]=structuredClone(partial);});}catch{partial.volatile=true;}}
      if(user&&phase!=='reply-save'&&phase!=='reply-sync')try{mutate(s=>{const item=s.messages[id]?.find(m=>m.id===user.id);if(item)item.replyState='failed';});}catch{}
      if(stopped){sendErrors.set(id,{text:'已停止生成。未完成片段不会进入模型上下文或正式历史。',retry:user?'reply':null,message:user});}
      else if(phase==='reply-save'&&reply){
        partials.delete(id);
        volatileReply(id,{...reply,volatile:true});sendErrors.set(id,{text:'模型已回复，但浏览器保存失败。请先复制这条回复，不要关闭页面。'});
      }else sendErrors.set(id,{text:phase==='reply-sync'?`模型已回复，持久化同步失败：${error.message}`:`发送未完成：${error.message}`,retry:phase==='reply-sync'?'sync':user?'reply':null,message:user});
    }finally{if(user&&!reply&&mode==='character'&&!readonly)try{await api.idleActivity?.(role,'stop',user.id);}catch{}controllers.delete(id);busy.delete(id);changed(id,{settled:true});}
    return {user,reply};
  }
  return {busy,controllers,partials,contextStates,revealIds,cancel,cancelAll,historyCache,historyErrors,sendErrors,memoryErrors,history,sync,send};
}
