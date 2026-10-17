import {useEffect,useRef,useState} from 'react';
import {UiIcon} from './UiIcon';
import type {ChatSnapshot,ChatActions} from './chat-types';
const messages:Record<string,string>={public_card_conflict:'公开资料刚在别处更新；当前草稿已保留，请对照最新资料后再保存。',social_memory_conflict:'这段印象刚有变化，请重新打开后查看。',public_card_invalid:'姓名最多40字，公开身份和关系说明各最多80字。',social_subject_inactive:'这位角色当前没有启用，原记录仍保留。',identity_session_inactive:'身份存档已切换，请重新打开当前对话。'};
function useSocial(s:ChatSnapshot,actions:ChatActions,publicOnly=false){
 const [data,setData]=useState<any>(null),[dataKey,setDataKey]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),generation=useRef(0);
 const owner={roleId:s.roleId,sessionId:s.conversationId},key=s.roleId+':'+s.conversationId+':'+(s.worldLife?.identityBank?.active?.id||'');
 useEffect(()=>{let active=true;const seq=++generation.current;setData(null);setDataKey(key);setNote('');setBusy(true);
  if(!actions.socialAction){setBusy(false);return;}
  actions.socialAction(publicOnly?'character_public_get':'character_social_get',owner).then(value=>{if(active&&seq===generation.current)setData(value);}).catch(e=>{if(active&&seq===generation.current)setNote(messages[e.message]||e.message||'资料暂未读取。');}).finally(()=>{if(active&&seq===generation.current)setBusy(false);});
  return()=>{active=false;generation.current++;};
 },[key]);
 async function run(name:string,args:any){if(busy||!actions.socialAction)return false;const seq=generation.current;setBusy(true);setNote('');try{const value=await actions.socialAction(name,{...owner,...args});if(seq!==generation.current)return false;setData(value);setNote(name==='character_public_save'?'公开名片已保存。':args.action==='forget'?'已忘记，可在这里恢复。':'已恢复原有记录。');return true;}catch(e){if(seq===generation.current)setNote(e instanceof Error?messages[e.message]||e.message:'操作未完成，原记录保留。');return false;}finally{if(seq===generation.current)setBusy(false);}}
 return {data:dataKey===key?data:null,busy,note:dataKey===key?note:'',run};
}
function PublicCard({card,editor,busy,save}:{card:any;editor?:boolean;busy?:boolean;save?:(value:any)=>Promise<boolean>}){
 const [draft,setDraft]=useState({name:'',identity:'',relation:''});
 useEffect(()=>{setDraft({name:card.name||'',identity:card.identity||'',relation:card.relation||''});},[card.roleId,card.revision]);
 if(!editor)return <section className="phone-public-card" aria-label="公开名片"><header><UiIcon name="user"/><h4>公开名片</h4></header><strong>{card.name}</strong><p>{card.identity||'尚未公开身份'}</p><small>{card.relation?`公开关系说明：${card.relation}`:'尚未主动公开关系说明'}</small></section>;
 return <section className="phone-public-editor" aria-label="编辑公开名片"><h4>公开名片</h4><p>以下内容可被其他已启用的角色认识。联系人备注、私聊与私人设定不会自动公开。</p>{[['name','公开姓名',40],['identity','公开身份',80],['relation','主动公开的关系说明',80]].map(([key,label,max])=><label key={key}><span>{label}</span><input value={(draft as any)[key]} maxLength={Number(max)} disabled={busy} onChange={e=>setDraft(v=>({...v,[key]:e.target.value}))}/></label>)}<button disabled={busy||!draft.name.trim()} onClick={()=>void save?.(draft)}>保存公开名片</button></section>;
}
export function PhonePublicCard({s,actions}:{s:ChatSnapshot;actions:ChatActions}){
 const {data,busy,note}=useSocial(s,actions,true);
 return <>{data?.eligible&&<PublicCard card={data.ownCard}/>} {busy&&<p className="phone-social-note" role="status">正在读取公开名片…</p>}{note&&<p role="status">{note}</p>}</>;
}
function worldDate(at:string,offset:number){const d=new Date(Date.parse(at)+offset*60000);return Number.isNaN(d.getTime())?'世界时间未记录':`新历${d.getUTCFullYear()-1700}年${d.toISOString().slice(5,10).replace('-','月')}日 ${d.toISOString().slice(11,16)}`;}
export function PhoneSocialLedger({s,actions}:{s:ChatSnapshot;actions:ChatActions}){
 const {data,busy,note,run}=useSocial(s,actions),[confirm,setConfirm]=useState('');
 return <section className="phone-social-ledger" aria-label="公开资料与相遇记录">
  {busy&&!data&&<p role="status">正在读取资料…</p>}
  {data?.eligible===false&&<p>{data.reason==='readonly_social_disabled'?'只读试聊不参与互识。':'先创建这位角色的新对话，再管理公开资料与相遇。'}</p>}
  {data?.eligible&&<><PublicCard card={data.ownCard} editor busy={busy} save={card=>run('character_public_save',{card,expectedRevision:data.ownCard.revision})}/>
   <h4>从{data.ownCard.name}的视角</h4><p>公开资料与亲眼观察分开保存。印象来自相处，不预设亲疏；这些私人记录不会自动对外公开。</p>
   {!data.subjects.length&&<p>其他角色建立新对话后，公开名片会出现在这里。</p>}
   {data.subjects.map((item:any)=><article className="social-subject" key={item.card.roleId}>
    <header><strong>{item.card.name}</strong><small>{item.card.identity||'尚未公开身份'}</small></header>
    <p className="social-impression">{item.impression?.text||'还没有形成印象。'}</p>
    {item.impression?.text&&<small>这份印象由角色根据自己的相遇形成。</small>}
    <details><summary>本人观察的来源</summary>{!item.evidence.length?<p>还没有可用的亲眼记录。</p>:<ol>{item.evidence.map((e:any)=><li key={e.id}><time>{worldDate(e.at,s.worldLife?.utcOffsetMinutes??480)}</time><p>{e.kind==='seen'?`在${e.placeName}见到${e.subjectName}`:e.observerMoved?'离开原房间后不再同处视野，去向未知':'不再同处视野，去向未知'}</p></li>)}</ol>}</details>
    <footer>{(item.evidence.length>0||item.impression?.text)&&<button disabled={busy} onClick={()=>setConfirm(item.card.roleId)}>忘记这段相遇与印象</button>}{item.canRestore&&<button disabled={busy} onClick={()=>void run('character_social_memory',{subjectId:item.card.roleId,action:'restore',expectedRevision:item.memoryRevision})}>恢复已忘记记录</button>}</footer>
    {confirm===item.card.roleId&&<div className="social-forget-confirm"><p>只让{data.ownCard.name}暂时忘记关于{item.card.name}的这些记录，可恢复。</p><button disabled={busy} onClick={async()=>{if(await run('character_social_memory',{subjectId:item.card.roleId,action:'forget',expectedRevision:item.memoryRevision}))setConfirm('');}}>确定忘记</button><button disabled={busy} onClick={()=>setConfirm('')}>取消</button></div>}
   </article>)}
  </>}{note&&<p role="status">{note}</p>}
 </section>;
}
