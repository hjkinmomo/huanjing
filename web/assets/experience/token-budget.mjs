// A deliberately conservative text estimate, not the provider's tokenizer.
import defaults from './context-defaults.json' with {type:'json'};
export const CONTEXT_WINDOWS=Object.freeze([...defaults.windows]);
export const DEFAULT_CONTEXT_WINDOW=defaults.defaultWindow;
export function estimateTokens(text){
 const source=String(text||'');let total=0,ascii='';
 const flush=()=>{total+=Math.ceil(ascii.length/3);ascii='';};
 for(const char of source){const code=char.codePointAt(0);if(code<128&&/[a-zA-Z0-9\s]/.test(char)){ascii+=char;continue;}flush();total+=code<128?1:code<=0xffff?2:4;}flush();return total;
}
export const messageTokens=messages=>messages.reduce((n,m)=>n+8+estimateTokens(m.content)+estimateTokens(m.reasoning_content),3);
export function responseTokenBudget(settings={}){
 const configured=Math.max(16,Math.min(8192,Number(settings.maxTokens)||1024));
 const model=String(settings.model||'').replace(/^deepseek v4 (flash|pro)$/i,(_,type)=>`deepseek-v4-${type.toLowerCase()}`);
 return settings.thinking===true&&(model==='deepseek-flash'||model.startsWith('deepseek-v4-'))?Math.max(2048,configured):configured;
}
export function windowBudget(settings={},overhead=0){
 const window=CONTEXT_WINDOWS.includes(Number(settings.contextWindow))?Number(settings.contextWindow):DEFAULT_CONTEXT_WINDOW;
 const output=responseTokenBudget(settings);
 const reserve=output+Math.max(4096,overhead)+Math.ceil(window*.1);
 const input=Math.max(512,window-reserve);
 return {window,output,reserve,input,unit:'estimated-tokens'};
}
export function tokenContextPlan(all,query,settings={}){
 const budget=windowBudget(settings,Number(settings.contextOverhead)||0),chunks=settings.contextChunks||[];
 const excluded=new Set(settings.contextExcludedIds||[]);
 const available=settings.contextCompression===false?[]:chunks.filter(c=>Array.isArray(c.evidence)&&c.evidence.length&&typeof c.text==='string'&&c.text.trim()&&!c.evidence.some(e=>excluded.has(e.messageId)));
 const encode=c=>JSON.stringify({source:c.id,from:c.startOrdinal,through:c.throughOrdinal,text:c.text});
 const prefix='本会话的分段归纳（模型压缩，可能有遗漏或错误；不能证明事实。需要细节时应查看原始来源）：\n';
 const summaries=[];let summaryRoom=Math.max(0,budget.input*.35-estimateTokens(prefix));
 const terms=new Set((String(query||'').toLowerCase().match(/[a-z0-9_]{3,}|[\u4e00-\u9fff]{2}/g)||[]).slice(-300));
 const score=c=>{const text=c.text.toLowerCase();return [...terms].reduce((n,t)=>n+(text.includes(t)?1:0),0);};
 const ranked=[...available].sort((a,b)=>score(b)-score(a)||b.throughOrdinal-a.throughOrdinal);
 // Keep the current plot summary, then recall older summaries related to this query.
 if(available.length){const latest=available.reduce((a,b)=>Number(b.throughOrdinal)>Number(a.throughOrdinal)?b:a);ranked.splice(ranked.indexOf(latest),1);ranked.unshift(latest);}
 for(const c of ranked){const cost=estimateTokens(encode(c)+'\n');if(cost>summaryRoom)continue;summaries.push(c);summaryRoom-=cost;}
 summaries.sort((a,b)=>a.throughOrdinal-b.throughOrdinal);
 const covered=new Set(summaries.flatMap(c=>c.evidence.map(e=>e.messageId)));
 const reasoningFor=m=>settings.thinking===true&&(settings.agentTools===true||settings.roleSkills!==false)&&m.from!=='user'?String(m.reasoning||''):null;
 const costFor=m=>8+estimateTokens(m.text)+estimateTokens(reasoningFor(m));
 const pending=all.filter(m=>!covered.has(m.id)&&!excluded.has(m.id));
 const digest=summaries.length?prefix+summaries.map(encode).join('\n'):'';
 let left=budget.input-estimateTokens(digest),recent=[];
 for(let i=pending.length-1;i>=0;i--){const m=pending[i],reasoning=reasoningFor(m),cost=costFor(m);if(cost>left)break;recent.push({role:m.from==='user'?'user':'assistant',content:m.text,...(reasoning===null?{}:{reasoning_content:reasoning})});left-=cost;if(recent.length>=2000)break;}
 recent.reverse();while(recent.length&&recent[0].role==='assistant'){const removed=recent.shift();left+=estimateTokens(removed.content)+estimateTokens(removed.reasoning_content)+8;}
 const rawTokens=all.reduce((n,m)=>n+costFor(m),0);
 return {recent,digest,budget:budget.input,window:budget.window,outputReserve:budget.output,unit:budget.unit,
  used:budget.input-left,rawTokens,eligible:all.length,kept:recent.length,older:all.length-recent.length,compressed:summaries.length>0,
  needsCompaction:settings.contextCompression!==false&&pending.length>8&&(pending.reduce((n,m)=>n+costFor(m),0)+estimateTokens(digest)>budget.input*.8||pending.length>1800),
  omitted:pending.length-recent.length,covered:covered.size,summaryCount:summaries.length,summaryAvailable:available.length};
}
