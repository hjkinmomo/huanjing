import {useState,useRef,useEffect} from 'react';
import type {Message,ChatActions} from './chat-types';
export function ReasoningPanel({message,actions}:{message:Message;actions:ChatActions}){
 const [translation,setTranslation]=useState(message.reasoningTranslation||''),[translated,setTranslated]=useState(!!message.reasoningTranslation);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[complete,setComplete]=useState(!!message.reasoningTranslation);const control=useRef<AbortController|null>(null);
 useEffect(()=>()=>control.current?.abort(),[]);
 useEffect(()=>{if(message.reasoningTranslation){setTranslation(message.reasoningTranslation);setTranslated(true);setComplete(true);}},[message.reasoningTranslation]);
 const original=message.reasoning||'',han=(original.match(/[\u4e00-\u9fff]/g)||[]).length,latin=(original.match(/[A-Za-z]/g)||[]).length;
 if(!original)return <details className="reply-reasoning reasoning-unavailable" data-part="reasoning"><summary>{message.generating?'等待模型推理':'本条未返回推理'} <span>说明</span></summary><p className="reasoning-note">在聊天右上角「更多」开启「请求模型推理」。只有服务商实际返回的推理会显示；开启前的旧回复不会补出推理。</p></details>;
 const chinese=han>0&&han>=latin*.25;
 async function translate(){
  if(busy||!actions.translateReasoning)return;const c=new AbortController();control.current=c;setBusy(true);setComplete(false);setStatus('正在译成中文…');
  try{const result=await actions.translateReasoning(message.id,{signal:c.signal,onProgress:j=>{if(c.signal.aborted)return;setTranslation(j.text);setTranslated(true);setStatus(`正在翻译 ${j.done}/${j.total} 段…`);}});
   if(!c.signal.aborted){setTranslation(result.text);setTranslated(true);setComplete(true);setStatus('中文译文已缓存。');}
  }catch(e){if(!c.signal.aborted)setStatus(e instanceof Error?e.message:'翻译未完成，原文保留。');}
  finally{if(control.current===c){control.current=null;setBusy(false);}}
 }
 return <details className="reply-reasoning" data-part="reasoning"><summary>{message.generating?'模型推理 · 生成中':'模型推理'} <span>{translated&&translation?(complete?'中文译文':'未完成译文'):chinese?'中文':'服务商原文'} · 可展开</span></summary>
  <p className="reasoning-note">{translated&&translation?'这是模型辅助翻译，可能有误；原文保留，与角色心里话分开。':'服务商返回的原始推理，与角色心里话分开显示。'}</p>
  <div className="reasoning-actions">
   {!message.incomplete&&!chinese&&actions.translateReasoning&&(!translation||!complete)&&<button type="button" onClick={translate} disabled={busy}>译成中文 · 调用当前模型</button>}
   {!!translation&&<button type="button" onClick={()=>setTranslated(v=>!v)}>{translated?'查看原文':'查看中文译文'}</button>}
   {busy&&<button type="button" onClick={()=>{control.current?.abort();setStatus('已停止翻译，原文保留。');}}>停止翻译</button>}
  </div>
  {!translation&&!chinese&&!message.incomplete&&<p className="reasoning-note">翻译会使用本角色已配置的模型额度；长推理会分段处理，完成后缓存。</p>}
  <pre>{translated&&translation?translation:original}</pre>
  {status&&<p className="reasoning-note" role="status">{status}</p>}
  {message.reasoningTruncated&&<p className="reasoning-note">原始推理达到40000字符上限，仅保留已收到的部分。</p>}
 </details>;
}
