import {authoredScene} from './worldbook.mjs';
import {normalizeScene} from './scene-state.mjs';
import {decodeSceneJSON} from './scene-json.mjs';
import {SCENE_FIELDS} from './scene-state.mjs';
function sceneFail(message){const error=Error(message);error.code='scene_invalid';return error;}
export function sceneWirePrompt(name,mode='scene',initial=false){
 return '[scene-response-v1] '+(initial?'这是本会话首次建立场景，本轮需要完整 scene 状态与人物旁白。':'')+'本轮应用响应协议（覆盖前面的标记写法，不改变角色人格）：只返回 JSON 对象，不加代码围栏。格式 {"character":'+JSON.stringify(name)+',"parts":[{"kind":"scene","text":"一段关于角色本人所在地点、动作、服饰及心情的自然旁白"},{"kind":"text","text":"角色实际说出口的对白"}],"scene":{"location":"角色本人的地点","setting":"环境概况","activity":"角色正在做什么","outfit":"角色本人穿着","mood":"角色本人的心情"}}。'
  +'parts 维持发生顺序，可多段，text 保留用户所需的 Markdown 或代码。每段只写 kind 和 text 两个键，各写一次；贴纸也用 kind=text。不写 scene/inner/scene-state 展示标记。JSON 必须严格合法：正确配对括号，用逗号分隔字段，用冒号分隔键和值，换行写成转义序列。对白引号优先用「」；必要的英文双引号必须转义。先完成简短对白，不堆积旁白以免截断。'+(mode==='inner'?'可用 kind=inner 写少量虚构人物心里话；不含模型推理。':'不用 inner。')
  +'首次建立场景必须有 scene 旁白和非空地点。场景只属于 '+name+'，勿把角色的头发、衣服、性别或动作安在用户身上；旁白可用角色名字或“她”，避免歧义的“你”。'
  +'后续每轮都可以带一段 kind=scene 的旁白：只写新发生的动作、神态与这轮里实际发生的事；场景没有变化时不要重复环境描写与开场句；状态变化时返回完整 scene，没变化可返回 null。只写已经确认的转场，用户提议与确认分开。最多一张合法贴纸标记，可独占 text 段；不强制表情。';
}
export function decodeSceneResponse(input,{name,mode='scene',initial=false,world=null,previousScene=null,finishReason='stop'}={}){
 const notices=new Set();let value=input,truncated=finishReason==='length';
 if(typeof input==='string'){
  let decoded;try{decoded=decodeSceneJSON(input);}catch{
   const recovered=partialSceneResponse(input,mode);
   if(recovered.trim())return {text:recovered,notices:['format_repaired','scene_retained']};
   // Plain dialogue is usable. Never display a broken JSON envelope as dialogue.
   const plain=input.trim();if(plain&&!/^[{[]|^```(?:json)?/i.test(plain))return {text:plain,notices:['scene_retained']};
   throw sceneFail('回复格式不完整，没有可显示的正文；已有记录保留。');
  }
  value=decoded.value;if(decoded.repairs)notices.add('format_repaired');truncated ||= decoded.truncated;
 }
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.parts)||value.parts.length>24)throw sceneFail('模型的场景回复格式无效，未保存为正式聊天。');
 if(value.character!==undefined&&value.character!==name)throw sceneFail('模型的场景回复角色格式无效，未保存为正式聊天。');
 if(value.character===undefined)notices.add('format_repaired');
 const valid=[];
 for(const part of value.parts){
  if(!part||typeof part.text!=='string'||part.text.length>18000){notices.add('parts_skipped');continue;}
  let kind=part.kind;
  if(kind==='sticker'&&/^\[\[sticker:[a-z]+\]\]$/.test(part.text.trim())){kind='text';notices.add('format_repaired');}
  if(!['text','scene',...(mode==='inner'?['inner']:[])].includes(kind)){notices.add('parts_skipped');continue;}
  if(part.text.trim())valid.push({kind,text:part.text});
 }
 // A broken envelope cannot turn unfinished words or narration-only output into a reply.
 if(!valid.length)throw sceneFail('回复没有可显示的内容；已有记录保留。');
 const previous=normalizeScene(previousScene?.state),current=world?authoredScene(world,previous?.location||''):null;
 let state=null;
 if(value.scene!=null&&!truncated){
  if(!value.scene||typeof value.scene!=='object'||Array.isArray(value.scene)){notices.add('scene_retained');}
  else{
   state={...normalizeScene({}),...previous};
   if(Object.keys(value.scene).some(key=>!Object.hasOwn(SCENE_FIELDS,key)))notices.add('scene_fields_retained');
   for(const [key,[,limit]] of Object.entries(SCENE_FIELDS)){
    const field=value.scene[key];
    if(typeof field==='string'&&field.trim()&&field.length<=limit)state[key]=field.trim();
    else if(field===undefined||typeof field!=='string'||field.length>limit||state[key])notices.add('scene_fields_retained');
   }
   if(!state.location){state=null;notices.add('scene_retained');}
  }
 }
 if(truncated){notices.add('reply_partial');notices.add('scene_retained');}
 if(state?.location&&state.location!==previous?.location&&!value.scene?.setting?.trim()) {state.setting='';notices.add('scene_fields_retained');}
 let authored=world?authoredScene(world,state?.location||current?.name||''):null;
 // An unlisted place is a valid fictional transition. Keep narration and its
 // state; the session controller registers it in the separate temporary library.
 if(world&&state&&!authored&&state.location===previous?.location&&!state.setting)state.setting=previous?.setting||'';
 if(authored&&state)state={...state,location:authored.name,setting:authored.description.slice(0,500)};
 if(authored&&initial&&!state)state={...normalizeScene({}),...previous,location:authored.name,setting:authored.description.slice(0,500)};
 const parts=valid.map(p=>p.kind==='text'?p.text:`[[${p.kind}]]\n${p.text}\n[[/${p.kind}]]`);
 if(authored&&(initial||state&&state.location!==previous?.location))parts.unshift('[[scene]]\n场景资料 · '+authored.name+'\n'+authored.description+'\n[[/scene]]');
 if(initial&&(!state?.location||!authored&&!valid.some(p=>p.kind==='scene')))notices.add('scene_pending');
 if(state)parts.push('[[scene-state]]\n'+JSON.stringify(state)+'\n[[/scene-state]]');
 const text=parts.join('\n');if(text.length>20000)throw sceneFail('模型回复超过存储上限，未写入截断消息。');
 return {text,notices:[...notices]};
}
export function renderSceneResponse(value,options={}){return decodeSceneResponse(value,options).text;}
// Narration can reveal a safely decoded string prefix; dialogue waits for a complete part.
export function partialSceneResponse(source,mode='scene'){
 const at=source.indexOf('"parts"');if(at<0)return '';
 const start=source.indexOf('[',at);if(start<0)return '';
 const parts=[];let quoted=false,escaped=false,depth=0,begin=-1;
 for(let i=start+1;i<source.length;i++){const ch=source[i];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}if(ch==='"'){quoted=true;continue;}if(ch==='{'){if(depth++===0)begin=i;}else if(ch==='}'&&--depth===0&&begin>=0){try{const p=decodeSceneJSON(source.slice(begin,i+1)).value;if(p&&typeof p.text==='string'&&['text','scene',...(mode==='inner'?['inner']:[])].includes(p.kind))parts.push(p.kind==='text'?p.text:`[[${p.kind}]]\n${p.text}\n[[/${p.kind}]]`);}catch{}begin=-1;}else if(ch===']'&&depth===0)break;}
 if(begin>=0){
  const incomplete=source.slice(begin),kind=/"kind"\s*:\s*"(scene)"/.exec(incomplete)?.[1],match=/"text"\s*:\s*"/.exec(incomplete);
  if(kind&&match){const raw=incomplete.slice(match.index+match[0].length);let decoded='';
   for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"')break;if(c.charCodeAt(0)!==92){decoded+=c;continue;}
    const next=raw[++i];if(next===undefined)break;
    if(next==='u'){const hex=raw.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(hex))break;decoded+=String.fromCharCode(parseInt(hex,16));i+=4;}
    else{const escapes={'"':'"',[String.fromCharCode(92)]:String.fromCharCode(92),'/':'/','n':'\n','r':'\r','t':'\t','b':'\b','f':'\f'};if(!Object.hasOwn(escapes,next))break;decoded+=escapes[next];}
   }
   decoded=decoded.replace(/[\uD800-\uDBFF]$/,'');if(decoded.trim())parts.push(`[[scene]]\n${decoded}\n[[/scene]]`);
  }
 }
 return parts.join('\n');
}
