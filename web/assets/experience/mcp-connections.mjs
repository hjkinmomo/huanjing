import {roleHelpersEnabled} from './character-layers.mjs';
// Remote descriptions and results are data: use textContent throughout this view.
export function mountMCPConnections(host,{api,getRole,getSettings,explain}){
  let servers=[],generation=0,task=null,selected='',operation=null,lastResult=null,analysisController=null,viewRoleId='';
  const $=s=>host.querySelector(s);
  const note=$('[data-mcp-feedback]'),list=$('[data-mcp-servers]'),editor=$('[data-mcp-editor]');
  const say=text=>note.textContent=text;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,action)=>{const b=node('button',text);b.type='button';b.onclick=action;return b;};
  const request=(path,body,timeout=45000)=>api.request('/v1/agent/'+path,body,timeout);
  function current(){return servers.find(s=>s.id===selected);}
  async function refresh(){
    const roleId=getRole().id;
    if(viewRoleId!==roleId){viewRoleId=roleId;lastResult=null;analysisController?.abort();for(const selector of ['[data-mcp-result]','[data-mcp-result-json]','[data-mcp-task-result]','[data-mcp-source]'])$(selector).textContent='';$('[data-mcp-result]').removeAttribute('data-result');$('[data-mcp-explain]').hidden=true;}
    const token=++generation;try{const value=await request('mcp/servers');if(token!==generation||getRole().id!==roleId)return;servers=value.servers||[];render();await approvals();}catch(e){if(token===generation)say(e.message);}
  }
  function render(){
    const role=getRole();$('[data-mcp-role]').textContent=role?.name||'当前角色';list.replaceChildren();
    if(!servers.length)list.append(node('p','尚未添加外部工具。可以先连接免费、无需密钥的 DeepWiki。','field-help'));
    for(const server of servers){const item=node('article',undefined,'mcp-server');item.append(node('strong',server.name),node('small',server.url));const count=server.selectedTools?.length||0;
      item.append(node('p',`${server.enabled?'已启用':'已停用'} · ${count} 个已选工具 · ${server.roleIds?.includes(role.id)?'当前角色可用':'未绑定当前角色'}`));
      const row=node('div',undefined,'mcp-actions');row.append(button('管理',()=>{selected=server.id;fill();}),button('发现工具',()=>discover(server.id)),button(server.enabled?'停用':'启用',()=>save({...server,enabled:!server.enabled})),button('删除连接',async()=>{try{await request('mcp/servers/delete',{serverId:server.id});if(selected===server.id){selected='';editor.hidden=true;}say('连接已删除。');await refresh();}catch(e){say(e.message);}}));item.append(row);list.append(item);
    }
    if(selected&&current())fill();else editor.hidden=true;
    const scope=$('[data-mcp-task-scope]');scope.replaceChildren();
    for(const server of servers.filter(s=>s.enabled&&s.roleIds?.includes(role.id)&&s.selectedTools?.length)){const label=node('label',undefined,'mcp-check');const input=node('input');input.type='checkbox';input.value=server.id;label.append(input,node('span',`${server.name} · ${server.selectedTools.length} 个工具`));scope.append(label);}
    if(!scope.children.length)scope.append(node('p','先启用连接、选择工具，并绑定当前角色。','field-help'));
  }
  async function save(server){try{await request('mcp/servers/save',{id:server.id,name:server.name,url:server.url,enabled:server.enabled,roleIds:server.roleIds||[],selectedTools:server.selectedTools||[]});say('连接设置已保存。');await refresh();}catch(e){say(e.message);}}
  async function discover(serverId){say('正在连接并读取工具说明…');try{await request('mcp/servers/discover',{serverId},20000);selected=serverId;say('已读取工具，请选择需要的项目，再保存角色授权。');await refresh();}catch(e){say(`发现失败：${e.message}`);}}
  function fill(){
    const server=current();if(!server)return;editor.hidden=false;$('[data-mcp-title]').textContent=server.name;$('[data-mcp-enabled]').checked=server.enabled;$('[data-mcp-bind]').checked=server.roleIds?.includes(getRole().id);
    const tools=$('[data-mcp-tools]');tools.replaceChildren();
    for(const tool of server.tools||[]){const row=node('div',undefined,'mcp-tool'),label=node('label',undefined,'mcp-check'),input=node('input');input.type='checkbox';input.value=tool.name;input.checked=server.selectedTools?.includes(tool.name);input.disabled=!tool.supported;label.append(input,node('strong',tool.name));row.append(label,node('p',String(tool.description||'无工具说明').slice(0,1800)));if(!tool.supported)row.append(node('small',`暂不支持：${tool.unsupportedReason||'参数规范超出现有支持范围'}`));
      const details=node('details'),summary=node('summary','查看参数规范'),pre=node('pre',JSON.stringify(tool.inputSchema,null,2));details.append(summary,pre);row.append(details);tools.append(row);
    }
    if(!tools.children.length)tools.append(node('p','点击“发现工具”读取服务提供的项目。','field-help'));
    const select=$('[data-mcp-call-tool]');select.replaceChildren();for(const tool of server.tools||[])if(tool.supported&&server.selectedTools?.includes(tool.name)){const option=node('option',tool.name);option.value=tool.name;select.append(option);}fields();
  }
  function fields(){const server=current(),name=$('[data-mcp-call-tool]').value,tool=server?.tools?.find(t=>t.name===name),target=$('[data-mcp-arguments]');target.replaceChildren();if(!tool)return;
    for(const [key,schema] of Object.entries(tool.inputSchema?.properties||{})){const label=node('label',undefined,'mcp-argument'),required=tool.inputSchema.required?.includes(key);label.append(node('span',`${key}${required?' *':''}`));let input;
      if(Array.isArray(schema.enum)){input=node('select');const blank=node('option','请选择');blank.value='';input.append(blank);for(const value of schema.enum){const option=node('option',String(value));option.value=JSON.stringify(value);input.append(option);}input.dataset.enum='true';}
      else if(schema.type==='boolean'){input=node('select');for(const [v,t] of [['','未指定'],['true','是'],['false','否']]){const o=node('option',t);o.value=v;input.append(o);}}
      else if(['object','array'].includes(schema.type)){input=node('textarea');input.rows=3;input.placeholder=schema.type==='array'?'[]':'{}';}
      else{input=node('input');input.type=['number','integer'].includes(schema.type)?'number':'text';if(input.type==='number')input.step=schema.type==='integer'?'1':'any';input.maxLength=Math.min(schema.maxLength||16000,16000);}
      input.dataset.arg=key;input.dataset.argType=schema.type||'string';input.required=!!required;if(schema.default!==undefined)input.value=input.dataset.enum==='true'||['array','object','boolean'].includes(schema.type)?JSON.stringify(schema.default):String(schema.default);label.append(input);if(schema.description)label.append(node('small',String(schema.description).slice(0,600)));target.append(label);
    }
  }
  async function approvals(){
    try{const value=await request('approvals?status=pending&limit=50');const container=$('[data-mcp-approvals]');container.replaceChildren();for(const p of value.items||value.proposals||[]){if((p.action_type||p.actionType)!=='mcp_tool_call'||(p.role_id||p.roleId)!==getRole().id)continue;const card=node('article',undefined,'mcp-approval');card.append(node('strong',p.summary||'待批准的外部工具调用'),node('pre',JSON.stringify(p.args,null,2)));const actions=node('div',undefined,'mcp-actions');actions.append(button('批准并调用',()=>resolve(p,'approve')),button('拒绝',()=>resolve(p,'deny')));card.append(actions);container.append(card);}if(!container.children.length)container.append(node('p','暂无待批准调用。','field-help'));}
    catch(e){say(`批准列表暂不可用：${e.message}`);}
  }
  async function resolve(proposal,decision){
    if(operation)return;const roleId=getRole().id;operation={id:proposal.args?.operationId,roleId};$('[data-mcp-stop-call]').hidden=decision!=='approve';say(decision==='approve'?'正在调用外部工具…':'正在拒绝…');
    try{const value=await request('approvals/resolve',{id:proposal.id,decision},45000);if(getRole().id===roleId){const result=value.receipt?.result||value.proposal?.result||value;lastResult=result.ok?{roleId,result}:null;const output=$('[data-mcp-result]');output.dataset.result=JSON.stringify(result);output.textContent=result.result?.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n\n')||result.error||'无文本结果';$('[data-mcp-result-json]').textContent=JSON.stringify(result,null,2);$('[data-mcp-explain]').hidden=!lastResult;const source=result.result?.source;$('[data-mcp-source]').textContent=source?`来源：${source.url} · ${source.toolName}`:'';say(decision==='deny'?'调用已拒绝。':result.ok===false?`调用失败：${result.error||'请查看结果'}`:'调用结束，结果已显示。');await approvals();}}
    catch(e){if(getRole().id===roleId)say(`调用未完成：${e.message}`);}finally{operation=null;$('[data-mcp-stop-call]').hidden=true;}
  }
  async function stopCall(){if(!operation?.id)return;try{await request('mcp/cancel',{operationId:operation.id,roleId:operation.roleId});say('已请求停止外部调用。');}catch(e){say(e.message);}}
  $('[data-mcp-add]').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target);try{const value=await request('mcp/servers/save',{name:data.get('name'),url:data.get('url'),enabled:false,roleIds:[],selectedTools:[]});selected=value.server?.id||'';event.target.reset();say('已添加，尚未授权任何工具。');await refresh();if(selected)await discover(selected);}catch(e){say(e.message);}};
  $('[data-mcp-deepwiki]').onclick=()=>{const f=$('[data-mcp-add]');f.elements.name.value='DeepWiki · 开源项目资料';f.elements.url.value='https://mcp.deepwiki.com/mcp';f.elements.name.focus();say('示例地址已填入；添加后会读取真实工具说明。');};
  $('[data-mcp-refresh]').onclick=refresh;$('[data-mcp-discover]').onclick=()=>selected&&discover(selected);$('[data-mcp-call-tool]').onchange=fields;
  $('[data-mcp-save]').onclick=()=>{const server=current();if(!server)return;const roleId=getRole().id,roleIds=(server.roleIds||[]).filter(id=>id!==roleId);if($('[data-mcp-bind]').checked)roleIds.push(roleId);save({...server,enabled:$('[data-mcp-enabled]').checked,roleIds,selectedTools:[...$('[data-mcp-tools]').querySelectorAll('input:checked:not(:disabled)')].map(i=>i.value)});};
  $('[data-mcp-call]').onsubmit=async event=>{event.preventDefault();const server=current();if(!server)return;try{const args={};for(const input of $('[data-mcp-arguments]').querySelectorAll('[data-arg]')){const value=input.value.trim();if(!value&&!input.required)continue;args[input.dataset.arg]=input.dataset.enum==='true'||['object','array','boolean','integer','number'].includes(input.dataset.argType)?JSON.parse(value):value;}
      await request('mcp/propose',{serverId:server.id,toolName:$('[data-mcp-call-tool]').value,arguments:args,roleId:getRole().id,summary:`调用 ${server.name} 的 ${$('[data-mcp-call-tool]').value}`,reason:'用户在外部工具面板准备的单次调用'});say('调用已准备，请在下方核对参数并批准。');await approvals();}catch(e){say(`未准备调用：${e.message}`);}};
  $('[data-mcp-stop-call]').onclick=stopCall;
  $('[data-mcp-task]').onsubmit=async event=>{event.preventDefault();if(task)return;const role=getRole(),settings=getSettings(),scope=[...$('[data-mcp-task-scope]').querySelectorAll('input:checked')].map(i=>i.value),query=$('[data-mcp-query]').value.trim();
    if(!scope.length){say('请勾选本次任务可使用的连接。');return;}if(!settings.baseUrl||!settings.model){say('请先保存并验证聊天模型配置。');return;}
    try{const endpoint=new URL(settings.baseUrl);if(!/\/chat\/completions\/?$/.test(endpoint.pathname))endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/chat/completions';const id=`mcp-task-${crypto.randomUUID()}`;task={id,roleId:role.id};$('[data-mcp-task-stop]').hidden=false;$('[data-mcp-task-start]').disabled=true;say('角色正在查看本次任务与已授权工具…');
      const card=role.card||{};const value=await request('runs/execute',{id,roleId:role.id,title:query.slice(0,120),query,roleHelpers:roleHelpersEnabled(role,settings),mcpServerIds:scope,sourcePaths:[],sourceUrls:[],maxIterations:4,provider:{endpoint:endpoint.href,credentialId:settings.credentialId||'chat',model:settings.model,timeoutSeconds:90},characterProfile:{...card,name:role.name,initiativeMode:card.initiativeMode||'off'}},120000);
      if(getRole().id===role.id){$('[data-mcp-task-result]').textContent=value.output?.result?.text||value.output?.text||value.text||JSON.stringify(value,null,2);say('角色任务已结束；工具提议需要在下方单独批准。');await approvals();}
    }catch(e){if(task?.roleId===getRole().id)say(`任务未完成：${e.message}`);}finally{task=null;$('[data-mcp-task-stop]').hidden=true;$('[data-mcp-task-start]').disabled=false;}
  };
  async function stopTask(){if(!task)return;await request('runs/cancel',{id:task.id});say('已请求停止角色任务。');}
  $('[data-mcp-task-stop]').onclick=()=>stopTask().catch(e=>say(e.message));
  $('[data-mcp-explain]').onclick=async()=>{if(!lastResult||lastResult.roleId!==getRole().id||analysisController)return;const roleId=getRole().id,controller=new AbortController();analysisController=controller;$('[data-mcp-explain]').disabled=true;say('角色正在阅读这次结果…');try{const text=await explain(lastResult.result,$('[data-mcp-query]').value.trim(),roleId,controller.signal);if(!controller.signal.aborted&&getRole().id===roleId){$('[data-mcp-task-result]').textContent=text;say('角色解读已完成。');}}catch(e){if(!controller.signal.aborted)say(`解读未完成：${e.message}`);}finally{if(analysisController===controller)analysisController=null;$('[data-mcp-explain]').disabled=false;}};
  return {refresh,leave(){generation++;analysisController?.abort();stopTask().catch(()=>{});stopCall().catch(()=>{});},pending:()=>!!task||!!operation||!!analysisController};
}
